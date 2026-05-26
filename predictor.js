// 2026 World Cup ensemble forecaster.
// Orchestrates: Elo + Dixon-Coles (fit on historical matches) +
// squad-strength delta + market prior, blended at match level for the
// Monte-Carlo and at tournament level for the title distribution.

import { hash32, mulberry32 } from "./rng.js";
import {
  winProbability,
  expectedGoals,
  poissonSample,
  eloOutcomeProbs,
  ELO_CONFIG,
} from "./models/elo.js";
import {
  fitDixonColes,
  bootstrapDC,
  dcMatchOutcome,
  dcInitFromElo,
} from "./models/dixonColes.js";
import {
  squadEloAdjustments,
} from "./models/squad.js";
import {
  blendOutcome,
  blendTitleDistribution,
  rpsMatch,
  DEFAULT_WEIGHTS,
  fitWeights,
} from "./models/ensemble.js";
import { outcomeProbsFromPoisson } from "./models/elo.js";
import { teamCovariateOffset } from "./models/covariates.js";
import {
  precomputeShares,
  sampleScorer,
  sampleMinuteBin,
  GOAL_MINUTE_BINS,
} from "./models/players.js";

// Build a lookup `(groupLetter, teamA.code, teamB.code) → { venueId, restA, restB }`
// from the official fixture list. Used to apply travel/timezone/rest/climate
// covariates inside the group stage simulation.
export function buildCovariateProvider(schedule, opts = {}) {
  if (!Array.isArray(schedule)) return null;
  const venue = new Map();
  const dates = {};       // teamCode → sorted match dates
  for (const m of schedule) {
    if (m.stage !== "group" || !m.group) continue;
    const k = `${m.group}|${[m.teamA, m.teamB].sort().join("|")}`;
    venue.set(k, m.venueId);
    (dates[m.teamA] ??= []).push(m.date);
    (dates[m.teamB] ??= []).push(m.date);
  }
  for (const code of Object.keys(dates)) dates[code].sort();
  const restDaysBefore = (code, date) => {
    const d = dates[code];
    if (!d || d.length === 0) return 4;
    const idx = d.indexOf(date);
    if (idx <= 0) return 4;
    const cur = new Date(d[idx]).getTime();
    const prev = new Date(d[idx - 1]).getTime();
    return Math.max(2, Math.round((cur - prev) / 86400000));
  };
  return (teamACode, teamBCode, group) => {
    const k = `${group}|${[teamACode, teamBCode].sort().join("|")}`;
    const venueId = venue.get(k);
    if (!venueId) return null;
    const fixtureDate = schedule.find(
      (m) => m.group === group && new Set([m.teamA, m.teamB]).has(teamACode) && new Set([m.teamA, m.teamB]).has(teamBCode),
    )?.date;
    const restA = fixtureDate ? restDaysBefore(teamACode, fixtureDate) : 4;
    const restB = fixtureDate ? restDaysBefore(teamBCode, fixtureDate) : 4;
    return {
      venueId,
      a: teamCovariateOffset(teamACode, teamBCode, venueId, restA, restB, opts.coefs),
      b: teamCovariateOffset(teamBCode, teamACode, venueId, restB, restA, opts.coefs),
    };
  };
}

const KO_ROUND_NAMES = ["R32", "R16", "QF", "SF", "Final"];
const ROUND_ROBIN_PAIRS = [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]];

/* ─────────── Bracket order ─────────── */

export function bracketOrder(n) {
  let order = [1, 2];
  while (order.length < n) {
    const size = order.length;
    const next = new Array(size * 2);
    for (let i = 0; i < size; i++) {
      next[i * 2] = order[i];
      next[i * 2 + 1] = size * 2 + 1 - order[i];
    }
    order = next;
  }
  return order;
}

/* ─────────── Per-match outcome probabilities (ensemble) ─────────── */

function effectiveElo(team, eloMap, squadDelta, options) {
  let elo = eloMap[team.code] ?? 1500;
  if (options.useSquad && squadDelta) elo += (squadDelta[team.code] || 0);
  return elo;
}

function hostBonusFor(team, hostCodes, useHost) {
  if (!useHost) return 0;
  return hostCodes.includes(team.code) ? ELO_CONFIG.homeAdvantage : 0;
}

// Compute Elo + DC outcome probabilities and the blended ensemble.
// Optional ctx.covariateOffsets (function(codeA, codeB, group?) → {a, b, venueId})
// adds a per-team additive shift to log-λ for both Elo and DC paths.
export function matchProbs(teamA, teamB, ctx) {
  const eA = effectiveElo(teamA, ctx.eloMap, ctx.squadDelta, ctx.options);
  const eB = effectiveElo(teamB, ctx.eloMap, ctx.squadDelta, ctx.options);
  const hA = hostBonusFor(teamA, ctx.hostCodes, ctx.options.useHost);
  const hB = hostBonusFor(teamB, ctx.hostCodes, ctx.options.useHost);
  const homeAdv = hA - hB;

  let eloP = eloOutcomeProbs(eA, eB, homeAdv);
  const hostFlag = (hA > 0 ? 1 : 0) - (hB > 0 ? 1 : 0);
  let dcP = dcOutcomeWithFallback(teamA.code, teamB.code, ctx.dcParams, hostFlag, eA, eB);

  // Covariate hook — adjust both base λs in lock-step and recompute outcome
  // probs. Only used in the 2026 forward MC where the venue/schedule is known.
  let covInfo = null;
  if (ctx.options.useCovariates && ctx.covariateProvider && ctx.currentGroup) {
    covInfo = ctx.covariateProvider(teamA.code, teamB.code, ctx.currentGroup);
    if (covInfo) {
      const eA2 = expectedGoals(eA, eB, homeAdv) * Math.exp(covInfo.a);
      const eB2 = expectedGoals(eB, eA, -homeAdv) * Math.exp(covInfo.b);
      eloP = outcomeProbsFromPoisson(eA2, eB2);
      const lH2 = dcP.lambdaH * Math.exp(covInfo.a);
      const lA2 = dcP.lambdaA * Math.exp(covInfo.b);
      dcP = { ...outcomeProbsFromPoisson(lH2, lA2), lambdaH: lH2, lambdaA: lA2 };
    }
  }

  // Blend at match level. Market is title-level, not per-match.
  const w = ctx.weights || DEFAULT_WEIGHTS;
  const used = {
    elo: w.elo,
    dc: w.dc,
    // Squad already folded into effectiveElo — squad weight here keeps
    // the elo-with-squad branch's voice when toggled off.
    squad: ctx.options.useSquad ? (w.squad || 0) : 0,
  };
  // Squad acts on Elo internally; its "model" contribution is just the
  // Elo prob with squad enabled. We pass eloP twice in that branch.
  const probs = { elo: eloP, dc: dcP, squad: eloP };
  return {
    elo: eloP,
    dc: dcP,
    ensemble: blendOutcome(probs, used),
    lambdaH: dcP.lambdaH,
    lambdaA: dcP.lambdaA,
  };
}

function dcOutcomeWithFallback(codeA, codeB, dcParams, hostFlag, eloA, eloB) {
  if (dcParams && dcParams.attack[codeA] !== undefined && dcParams.attack[codeB] !== undefined) {
    return dcMatchOutcome(codeA, codeB, dcParams, hostFlag);
  }
  // Cold-start fallback: derive a synthetic DC outcome from Elo only.
  const elo = eloOutcomeProbs(eloA, eloB, hostFlag * 80);
  return { ...elo, lambdaH: expectedGoals(eloA, eloB, hostFlag * 80),
           lambdaA: expectedGoals(eloB, eloA, -hostFlag * 80) };
}

/* ─────────── Match simulation (sampling) ─────────── */

function sampleMatch(teamA, teamB, ctx, rng) {
  const probs = matchProbs(teamA, teamB, ctx);
  // Sample three-outcome from ensemble, then sample scores from DC's λ.
  const r = rng();
  let outcome;
  if (r < probs.ensemble.home) outcome = "home";
  else if (r < probs.ensemble.home + probs.ensemble.draw) outcome = "draw";
  else outcome = "away";
  let scoreA = poissonSample(probs.lambdaH, rng);
  let scoreB = poissonSample(probs.lambdaA, rng);
  if (outcome === "home" && scoreA <= scoreB) scoreA = scoreB + 1;
  else if (outcome === "away" && scoreB <= scoreA) scoreB = scoreA + 1;
  else if (outcome === "draw" && scoreA !== scoreB) {
    const mean = Math.round((scoreA + scoreB) / 2);
    scoreA = scoreB = mean;
  }
  const events = ctx.playerShares
    ? samplePlayerEvents(teamA.code, teamB.code, scoreA, scoreB, ctx, rng)
    : null;
  return { scoreA, scoreB, probs, outcome, events };
}

// Multinomial allocation of goals + assists + minute bins to players,
// given pre-computed per-team shares. Returns compact arrays of strings
// (player names) and small ints (minute bin index) so the MC loop can
// fold them into team counters cheaply.
function samplePlayerEvents(codeA, codeB, scoreA, scoreB, ctx, rng) {
  const sharesA = ctx.playerShares.get(codeA);
  const sharesB = ctx.playerShares.get(codeB);
  const scorersA = [], scorersB = [];
  const assistsA = [], assistsB = [];
  const minutesA = [], minutesB = [];
  for (let i = 0; i < scoreA; i++) {
    if (sharesA) {
      scorersA.push(sampleScorer(sharesA.goal, rng));
      const assistName = rng() < 0.72 ? sampleScorer(sharesA.assist, rng) : null;
      assistsA.push(assistName);
    } else {
      scorersA.push(null);
      assistsA.push(null);
    }
    minutesA.push(sampleMinuteBin(rng));
  }
  for (let i = 0; i < scoreB; i++) {
    if (sharesB) {
      scorersB.push(sampleScorer(sharesB.goal, rng));
      const assistName = rng() < 0.72 ? sampleScorer(sharesB.assist, rng) : null;
      assistsB.push(assistName);
    } else {
      scorersB.push(null);
      assistsB.push(null);
    }
    minutesB.push(sampleMinuteBin(rng));
  }
  return { scorersA, scorersB, assistsA, assistsB, minutesA, minutesB };
}

// Knockout — 90 min → 30 min ET (κ-scaled) → Elo-damped shootout.
// κ = 0.95 captures the empirical observation that ET is slightly
// more conservative than open play (Karlis–Ntzoufras 2003); the /3
// reflects ET length being 30/90 of regulation.
const ET_KAPPA = 0.95;
function knockoutResult(teamA, teamB, ctx, rng) {
  const result = sampleMatch(teamA, teamB, ctx, rng);
  let { scoreA, scoreB } = result;
  if (scoreA !== scoreB) {
    return { winner: scoreA > scoreB ? teamA : teamB, scoreA, scoreB, probs: result.probs, et: false, penalty: false, events: result.events };
  }
  const etScale = ET_KAPPA / 3;
  const etA = poissonSample(result.probs.lambdaH * etScale, rng);
  const etB = poissonSample(result.probs.lambdaA * etScale, rng);
  scoreA += etA;
  scoreB += etB;
  // Allocate ET goals to players too (using the same shares).
  if (ctx.playerShares && result.events) {
    const etEvents = samplePlayerEvents(teamA.code, teamB.code, etA, etB, ctx, rng);
    result.events.scorersA.push(...etEvents.scorersA);
    result.events.scorersB.push(...etEvents.scorersB);
    result.events.assistsA.push(...etEvents.assistsA);
    result.events.assistsB.push(...etEvents.assistsB);
    // Tag ET goals with a synthetic bin (90+).
    for (let i = 0; i < etA; i++) result.events.minutesA.push(GOAL_MINUTE_BINS[GOAL_MINUTE_BINS.length - 1]);
    for (let i = 0; i < etB; i++) result.events.minutesB.push(GOAL_MINUTE_BINS[GOAL_MINUTE_BINS.length - 1]);
  }
  if (scoreA !== scoreB) {
    return { winner: scoreA > scoreB ? teamA : teamB, scoreA, scoreB, probs: result.probs, et: true, penalty: false, events: result.events };
  }
  const eA = effectiveElo(teamA, ctx.eloMap, ctx.squadDelta, ctx.options);
  const eB = effectiveElo(teamB, ctx.eloMap, ctx.squadDelta, ctx.options);
  const pAelo = winProbability(eA, eB);
  const pShootout = 0.5 + (pAelo - 0.5) * ELO_CONFIG.shootoutDamp;
  return {
    winner: rng() < pShootout ? teamA : teamB,
    scoreA, scoreB, probs: result.probs, et: true, penalty: true, events: result.events,
  };
}

/* ─────────── Group + knockout ─────────── */

function simulateGroupStage(teams, groups, ctx, rng) {
  const teamsByCode = Object.fromEntries(teams.map((t) => [t.code, t]));
  const out = {};
  const groupMatches = [];
  for (const [letter, codes] of Object.entries(groups)) {
    const groupTeams = codes.map((c) => teamsByCode[c]).filter(Boolean);
    if (groupTeams.length !== 4) continue;
    const stats = Object.fromEntries(groupTeams.map((t) => [
      t.code, { team: t, p: 0, gf: 0, ga: 0, w: 0, d: 0, l: 0 },
    ]));
    for (const [ai, bi] of ROUND_ROBIN_PAIRS) {
      const a = groupTeams[ai];
      const b = groupTeams[bi];
      ctx.currentGroup = letter;
      const sampled = sampleMatch(a, b, ctx, rng);
      ctx.currentGroup = null;
      const { scoreA, scoreB, events } = sampled;
      groupMatches.push({ group: letter, a, b, scoreA, scoreB, events });
      stats[a.code].gf += scoreA; stats[a.code].ga += scoreB;
      stats[b.code].gf += scoreB; stats[b.code].ga += scoreA;
      if (scoreA > scoreB) { stats[a.code].p += 3; stats[a.code].w++; stats[b.code].l++; }
      else if (scoreB > scoreA) { stats[b.code].p += 3; stats[b.code].w++; stats[a.code].l++; }
      else { stats[a.code].p += 1; stats[b.code].p += 1; stats[a.code].d++; stats[b.code].d++; }
    }
    const table = Object.values(stats).map((r) => ({ ...r, gd: r.gf - r.ga }));
    table.sort((x, y) =>
      y.p - x.p ||
      y.gd - x.gd ||
      y.gf - x.gf ||
      (ctx.eloMap[y.team.code] ?? 1500) - (ctx.eloMap[x.team.code] ?? 1500)
    );
    out[letter] = table;
  }
  return { tables: out, matches: groupMatches };
}

function pickQualifiers(groupTables) {
  const winners = [], runnersUp = [], thirds = [];
  for (const [letter, table] of Object.entries(groupTables)) {
    if (table[0]) winners.push({ ...table[0], group: letter, pos: 1 });
    if (table[1]) runnersUp.push({ ...table[1], group: letter, pos: 2 });
    if (table[2]) thirds.push({ ...table[2], group: letter, pos: 3 });
  }
  thirds.sort((a, b) => b.p - a.p || b.gd - a.gd || b.gf - a.gf || a.group.localeCompare(b.group));
  if (winners.length === 12) return [...winners, ...runnersUp, ...thirds.slice(0, 8)];
  return [...winners, ...runnersUp];
}

function simulateKnockout(qualifiers, ctx, rng) {
  const seeded = qualifiers.slice().sort((x, y) =>
    x.pos - y.pos || y.p - x.p || y.gd - x.gd || y.gf - x.gf ||
    (ctx.eloMap[y.team.code] ?? 1500) - (ctx.eloMap[x.team.code] ?? 1500)
  );
  const size = seeded.length;
  const bracketN = size === 32 ? 32 : 16;
  const order = bracketOrder(bracketN).map((rank) => seeded[rank - 1]?.team);
  const rounds = [];
  let current = order.filter(Boolean);
  const startIdx = bracketN === 32 ? 0 : 1;
  for (let r = startIdx; r < KO_ROUND_NAMES.length; r++) {
    const matches = [];
    const next = [];
    for (let m = 0; m < current.length; m += 2) {
      const a = current[m];
      const b = current[m + 1];
      if (!a || !b) { next.push(a || b); continue; }
      const result = knockoutResult(a, b, ctx, rng);
      matches.push({ round: KO_ROUND_NAMES[r], a, b, ...result, key: `${r}-${m / 2}` });
      next.push(result.winner);
    }
    rounds.push({ name: KO_ROUND_NAMES[r], matches });
    current = next;
    if (current.length <= 1) break;
  }
  return { rounds, champion: current[0] || null };
}

function simulateTournament(teams, groups, ctx, rng) {
  const groupStage = simulateGroupStage(teams, groups, ctx, rng);
  const groupTables = groupStage.tables;
  const groupMatches = groupStage.matches;
  const qualifiers = pickQualifiers(groupTables);
  const { rounds, champion } = simulateKnockout(qualifiers, ctx, rng);
  const lastRound = rounds[rounds.length - 1];
  const finalMatch = lastRound?.matches?.[0];
  const semis = rounds[rounds.length - 2]?.matches?.flatMap((m) => [m.a, m.b]) || [];
  const quarters = rounds[rounds.length - 3]?.matches?.flatMap((m) => [m.a, m.b]) || semis.slice();
  // R16 = teams entering the round of 16 (= R32 winners for 48-team WM,
  // or the initial 16 for a 32-team WM).
  const r16 = rounds[rounds.length - 4]?.matches?.flatMap((m) => [m.a, m.b]) || quarters.slice();
  return {
    groupTables, groupMatches, qualifiers, rounds, champion,
    finalists: finalMatch ? [finalMatch.a, finalMatch.b] : [],
    semifinalists: semis,
    quarterfinalists: quarters,
    r16Teams: r16,
  };
}

/* ─────────── Monte-Carlo over the ensemble ─────────── */

export function runEnsembleMonteCarlo(teams, groups, hostCodes, eloMap, options = {}, iterations = 10000) {
  const ctx = {
    eloMap,
    hostCodes,
    squadDelta: options.squadDelta || null,
    dcParams: options.dcParams || null,
    covariateProvider: options.covariateProvider || null,
    weights: options.weights || DEFAULT_WEIGHTS,
    playerShares: options.trackPlayers ? precomputeShares() : null,
    options: {
      useHost: options.useHost !== false,
      useSquad: options.useSquad !== false,
      useDC: options.useDC !== false,
      useMarket: options.useMarket !== false,
      useCovariates: options.useCovariates !== false,
    },
  };
  // If DC isn't desired in this scenario, set its weight to 0.
  if (!ctx.options.useDC) ctx.weights = { ...ctx.weights, dc: 0 };

  const masterRng = mulberry32(hash32(`mc|${iterations}|${options.seed || "main"}`));
  const blank = () => Object.fromEntries(teams.map((t) => [t.code, 0]));
  const counts = {
    title: blank(), finals: blank(), semis: blank(),
    quarters: blank(), r16: blank(), reachR32: blank(),
    groupAdvance: blank(),
  };
  const groupPos = Object.fromEntries(teams.map((t) => [t.code, { p1: 0, p2: 0, p3: 0, p4: 0, total: 0 }]));
  // Player aggregation state (only if trackPlayers).
  const playerGoals = ctx.playerShares ? new Map() : null;
  const playerAssists = ctx.playerShares ? new Map() : null;
  const playerMinutes = ctx.playerShares ? new Map() : null;
  const playerMatchesWithGoal = ctx.playerShares ? new Map() : null;
  const goldenBoot = ctx.playerShares ? new Map() : null;
  let sampleRun = null;

  for (let i = 0; i < iterations; i++) {
    const iterSeed = Math.floor(masterRng() * 0xffffffff) >>> 0;
    const rng = mulberry32(iterSeed);
    const r = simulateTournament(teams, groups, ctx, rng);
    if (r.champion) counts.title[r.champion.code] = (counts.title[r.champion.code] || 0) + 1;
    for (const t of r.finalists) counts.finals[t.code] = (counts.finals[t.code] || 0) + 1;
    for (const t of r.semifinalists) counts.semis[t.code] = (counts.semis[t.code] || 0) + 1;
    for (const t of r.quarterfinalists) counts.quarters[t.code] = (counts.quarters[t.code] || 0) + 1;
    // P(reach R32) for the 48-team format — group top-2 OR best-third.
    for (const q of r.qualifiers || []) counts.reachR32[q.team.code] = (counts.reachR32[q.team.code] || 0) + 1;
    for (const t of r.r16Teams || []) counts.r16[t.code] = (counts.r16[t.code] || 0) + 1;
    for (const [, table] of Object.entries(r.groupTables)) {
      for (let pos = 0; pos < table.length; pos++) {
        const code = table[pos].team.code;
        if (!groupPos[code]) continue;
        groupPos[code].total++;
        if (pos === 0) groupPos[code].p1++;
        else if (pos === 1) groupPos[code].p2++;
        else if (pos === 2) groupPos[code].p3++;
        else groupPos[code].p4++;
        if (pos <= 1) counts.groupAdvance[code] = (counts.groupAdvance[code] || 0) + 1;
      }
    }
    if (ctx.playerShares) {
      aggregatePlayerEvents(r, { playerGoals, playerAssists, playerMinutes, playerMatchesWithGoal, goldenBoot });
    }
    if (i === 0) sampleRun = r;
  }
  const toProbs = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v / iterations]));
  const result = {
    iterations,
    titleProbability: toProbs(counts.title),
    finalsProbability: toProbs(counts.finals),
    semisProbability: toProbs(counts.semis),
    quartersProbability: toProbs(counts.quarters),
    r16Probability: toProbs(counts.r16),
    r32Probability: toProbs(counts.reachR32),
    groupAdvanceProbability: toProbs(counts.groupAdvance),
    groupPositionDistribution: groupPos,
    sampleRun,
    weights: ctx.weights,
  };
  if (ctx.playerShares) {
    result.players = summarizePlayers({
      playerGoals, playerAssists, playerMinutes,
      playerMatchesWithGoal, goldenBoot, iterations,
    });
  }
  return result;
}

function aggregatePlayerEvents(r, agg) {
  const perIterGoals = new Map();
  const tally = (events) => {
    if (!events) return;
    for (const name of events.scorersA) if (name) bumpName(agg.playerGoals, name);
    for (const name of events.scorersB) if (name) bumpName(agg.playerGoals, name);
    for (const name of events.assistsA) if (name) bumpName(agg.playerAssists, name);
    for (const name of events.assistsB) if (name) bumpName(agg.playerAssists, name);
    for (const bin of events.minutesA) if (bin) bumpBin(agg.playerMinutes, bin.label);
    for (const bin of events.minutesB) if (bin) bumpBin(agg.playerMinutes, bin.label);
    // Per-iteration tournament goal count (used for Golden Boot + the
    // "scored at least once in this tournament" stat below).
    for (const name of events.scorersA) if (name) perIterGoals.set(name, (perIterGoals.get(name) || 0) + 1);
    for (const name of events.scorersB) if (name) perIterGoals.set(name, (perIterGoals.get(name) || 0) + 1);
  };
  for (const m of r.groupMatches || []) tally(m.events);
  for (const round of r.rounds || []) {
    for (const m of round.matches || []) tally(m.events);
  }
  // P(player scores ≥1 in the whole tournament): one bump per iteration
  // per player who got ≥1 goal anywhere.
  for (const name of perIterGoals.keys()) bumpName(agg.playerMatchesWithGoal, name);
  // Golden Boot: highest goal-count in this tournament (ties → all share).
  let topGoals = 0;
  for (const v of perIterGoals.values()) if (v > topGoals) topGoals = v;
  if (topGoals > 0) {
    for (const [name, g] of perIterGoals) {
      if (g === topGoals) bumpName(agg.goldenBoot, name);
    }
  }
}

function bumpName(map, name) {
  map.set(name, (map.get(name) || 0) + 1);
}
function bumpBin(map, label) {
  map.set(label, (map.get(label) || 0) + 1);
}

function summarizePlayers({ playerGoals, playerAssists, playerMinutes, playerMatchesWithGoal, goldenBoot, iterations }) {
  const out = {};
  // Expected tournament goals/assists per player = total / iterations
  // P(Golden Boot) = sharedGoldenBootCount / iterations
  const allNames = new Set([
    ...playerGoals.keys(),
    ...playerAssists.keys(),
    ...goldenBoot.keys(),
  ]);
  const players = [];
  for (const name of allNames) {
    const goals = playerGoals.get(name) || 0;
    const assists = playerAssists.get(name) || 0;
    const matchesScored = playerMatchesWithGoal.get(name) || 0;
    const gbCount = goldenBoot.get(name) || 0;
    players.push({
      name,
      expGoals: goals / iterations,
      expAssists: assists / iterations,
      pGoldenBoot: gbCount / iterations,
      pScoresAnyMatch: matchesScored / iterations,
    });
  }
  players.sort((a, b) => b.expGoals - a.expGoals);
  out.players = players;
  // Minute distribution aggregated over all goals.
  const minutes = {};
  let totalGoalsAcrossPlayers = 0;
  for (const [label, n] of playerMinutes) {
    minutes[label] = n;
    totalGoalsAcrossPlayers += n;
  }
  out.minuteDistribution = {};
  for (const label of Object.keys(minutes)) {
    out.minuteDistribution[label] = totalGoalsAcrossPlayers
      ? minutes[label] / totalGoalsAcrossPlayers
      : 0;
  }
  out.totalGoalsSampled = totalGoalsAcrossPlayers;
  return out;
}

/* ─────────── Bootstrap-MC for parameter uncertainty ─────────── */

// Re-runs the full ensemble Monte-Carlo B times, each with a different
// Dixon-Coles fit drawn from `bootstrapDC`. Returns per-team title prob
// (mean across bootstraps) plus the bootstrap-variance contribution.
// Stage probabilities (R32/R16/QF/SF/finals) come from the FIRST fit so
// they remain readable; only the title distribution carries the
// parameter-uncertainty signal that's interesting for SD purposes.
export function runEnsembleMonteCarloBootstrap(teams, groups, hostCodes, eloMap, options, dcFits, iterationsPerFit = 5000) {
  if (!Array.isArray(dcFits) || dcFits.length === 0) {
    throw new Error("runEnsembleMonteCarloBootstrap: dcFits must be a non-empty array");
  }
  const titlePerFit = dcFits.map((fit) => {
    const res = runEnsembleMonteCarlo(
      teams, groups, hostCodes, eloMap,
      { ...options, dcParams: fit },
      iterationsPerFit,
    );
    return res;
  });
  // First fit gives the canonical stage distribution we display.
  const base = titlePerFit[0];
  const codes = Object.keys(base.titleProbability);
  const meanTitle = {};
  const bootstrapVar = {};
  const mcVar = {};
  for (const c of codes) {
    const vals = titlePerFit.map((r) => r.titleProbability[c] || 0);
    const m = vals.reduce((s, v) => s + v, 0) / vals.length;
    meanTitle[c] = m;
    // Sample variance across bootstraps.
    if (vals.length > 1) {
      let v = 0;
      for (const x of vals) v += (x - m) ** 2;
      bootstrapVar[c] = v / (vals.length - 1);
    } else {
      bootstrapVar[c] = 0;
    }
    // Mean MC sampling variance across fits.
    let mv = 0;
    for (const x of vals) mv += x * (1 - x) / iterationsPerFit;
    mcVar[c] = mv / vals.length;
  }
  return {
    ...base,
    titleProbability: meanTitle,
    bootstrapVar,
    mcVar,
    B: dcFits.length,
    iterationsPerFit,
    iterations: dcFits.length * iterationsPerFit,
  };
}

// Builds the match list expected by fitDixonColes from BOTH the
// HISTORICAL_KNOCKOUTS records (knockout matches) and the bulk
// NEW_HISTORICAL_MATCHES dataset (group + KO).
export function flattenHistoricalMatches(historicalKnockouts, newMatchesByYear) {
  const matches = [];
  const codes = new Set();
  const add = (year, m) => {
    if (m.scoreA == null || m.scoreB == null) return;
    matches.push({
      year,
      teamA: m.teamA, teamB: m.teamB,
      scoreA: m.scoreA, scoreB: m.scoreB,
      weight: Math.exp(-(2026 - year) * DC_DECAY),
    });
    codes.add(m.teamA); codes.add(m.teamB);
  };
  for (const t of historicalKnockouts) for (const m of t.matches) add(t.year, m);
  if (newMatchesByYear) {
    for (const [year, list] of Object.entries(newMatchesByYear)) {
      for (const m of list) add(Number(year), m);
    }
  }
  return { matches, teamCodes: [...codes] };
}

// 4-year half-life: 2022 matches weigh ~1.7× the 2014 matches, ~2× the
// 2010 matches, ~3× the 2006 matches, ~6× the 1994 matches. Matches the
// medium-scale recommendation from Report 2 for WM-only data slices.
const DC_HALF_LIFE_YEARS = 4;
const DC_DECAY = Math.LN2 / DC_HALF_LIFE_YEARS;

export function fitDCOnHistorical(historicalKnockouts, historicalElo, newMatchesByYear) {
  const { matches, teamCodes } = flattenHistoricalMatches(historicalKnockouts, newMatchesByYear);
  const eloMap = {};
  const sortedYears = Object.keys(historicalElo).map(Number).sort((a, b) => b - a);
  for (const y of sortedYears) {
    for (const [code, elo] of Object.entries(historicalElo[y])) {
      if (eloMap[code] === undefined) eloMap[code] = elo;
    }
  }
  return fitDixonColes(matches, teamCodes, eloMap, { iterations: 60 });
}

/* ─────────── RPS backtest (per-match outcome scoring) ─────────── */

export function runRPSBacktest(historicalKnockouts, historicalElo, dcParams, squadDelta = null) {
  const results = [];
  for (const t of historicalKnockouts) {
    const elos = historicalElo[t.year];
    if (!elos) continue;
    const hostCodes = (t.hostCodes || []);
    const ctx = {
      eloMap: elos,
      hostCodes,
      squadDelta,
      dcParams,
      weights: DEFAULT_WEIGHTS,
      options: { useHost: true, useSquad: false, useDC: true, useMarket: false },
    };
    let rpsElo = 0, rpsDC = 0, rpsEns = 0, n = 0;
    const champCounts = { elo: {}, dc: {}, ensemble: {} };
    for (const m of t.matches) {
      if (m.scoreA == null || m.scoreB == null) continue;
      const teamA = { code: m.teamA };
      const teamB = { code: m.teamB };
      const probs = matchProbs(teamA, teamB, ctx);
      const actual = m.scoreA > m.scoreB ? 0 : m.scoreA < m.scoreB ? 2 : 1;
      rpsElo += rpsMatch(probs.elo, actual);
      rpsDC += rpsMatch(probs.dc, actual);
      rpsEns += rpsMatch(probs.ensemble, actual);
      n++;
    }
    results.push({
      year: t.year,
      n,
      rpsElo: n ? rpsElo / n : null,
      rpsDC: n ? rpsDC / n : null,
      rpsEnsemble: n ? rpsEns / n : null,
      actualChampion: t.champion,
    });
  }
  const avg = (key) => results.reduce((s, r) => s + (r[key] || 0), 0) / results.length;
  return {
    perTournament: results,
    avgRPSElo: avg("rpsElo"),
    avgRPSDC: avg("rpsDC"),
    avgRPSEnsemble: avg("rpsEnsemble"),
  };
}

/* ─────────── Calibration: predicted vs observed bin frequencies ─────────── */

export function calibrationBins(historicalKnockouts, historicalElo, dcParams, bins = 10) {
  const cells = Array.from({ length: bins }, () => ({ predSum: 0, hitSum: 0, n: 0 }));
  for (const t of historicalKnockouts) {
    const elos = historicalElo[t.year];
    if (!elos) continue;
    const ctx = {
      eloMap: elos, hostCodes: [], squadDelta: null, dcParams,
      weights: DEFAULT_WEIGHTS,
      options: { useHost: true, useSquad: false, useDC: true, useMarket: false },
    };
    for (const m of t.matches) {
      if (m.scoreA == null || m.scoreB == null) continue;
      const probs = matchProbs({ code: m.teamA }, { code: m.teamB }, ctx);
      const actual = m.scoreA > m.scoreB ? "home" : m.scoreA < m.scoreB ? "away" : "draw";
      for (const out of ["home", "draw", "away"]) {
        const p = probs.ensemble[out];
        const hit = out === actual ? 1 : 0;
        const idx = Math.min(bins - 1, Math.floor(p * bins));
        cells[idx].predSum += p;
        cells[idx].hitSum += hit;
        cells[idx].n++;
      }
    }
  }
  return cells.map((c, i) => ({
    bin: i,
    midPred: c.n ? c.predSum / c.n : (i + 0.5) / bins,
    observed: c.n ? c.hitSum / c.n : null,
    n: c.n,
  }));
}

/* ─────────── Title-distribution blend with market ─────────── */

export function blendWithMarket(titleProb, marketProb, marketWeight = 0.25) {
  const teams = new Set([...Object.keys(titleProb), ...Object.keys(marketProb)]);
  const out = {};
  let total = 0;
  for (const code of teams) {
    const p = (1 - marketWeight) * (titleProb[code] || 0) + marketWeight * (marketProb[code] || 0);
    out[code] = p;
    total += p;
  }
  if (total > 0) for (const code of Object.keys(out)) out[code] /= total;
  return out;
}
