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
export function matchProbs(teamA, teamB, ctx) {
  const eA = effectiveElo(teamA, ctx.eloMap, ctx.squadDelta, ctx.options);
  const eB = effectiveElo(teamB, ctx.eloMap, ctx.squadDelta, ctx.options);
  const hA = hostBonusFor(teamA, ctx.hostCodes, ctx.options.useHost);
  const hB = hostBonusFor(teamB, ctx.hostCodes, ctx.options.useHost);
  const homeAdv = hA - hB;

  const eloP = eloOutcomeProbs(eA, eB, homeAdv);
  const hostFlag = (hA > 0 ? 1 : 0) - (hB > 0 ? 1 : 0);
  const dcP = dcOutcomeWithFallback(teamA.code, teamB.code, ctx.dcParams, hostFlag, eA, eB);

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
  return { scoreA, scoreB, probs, outcome };
}

function knockoutResult(teamA, teamB, ctx, rng) {
  const result = sampleMatch(teamA, teamB, ctx, rng);
  if (result.scoreA !== result.scoreB) {
    return { winner: result.scoreA > result.scoreB ? teamA : teamB, ...result, penalty: false };
  }
  // Penalty shootout — dampened toward 50/50.
  const eA = effectiveElo(teamA, ctx.eloMap, ctx.squadDelta, ctx.options);
  const eB = effectiveElo(teamB, ctx.eloMap, ctx.squadDelta, ctx.options);
  const pAelo = winProbability(eA, eB);
  const pShootout = 0.5 + (pAelo - 0.5) * ELO_CONFIG.shootoutDamp;
  return {
    winner: rng() < pShootout ? teamA : teamB,
    ...result, penalty: true,
  };
}

/* ─────────── Group + knockout ─────────── */

function simulateGroupStage(teams, groups, ctx, rng) {
  const teamsByCode = Object.fromEntries(teams.map((t) => [t.code, t]));
  const out = {};
  for (const [letter, codes] of Object.entries(groups)) {
    const groupTeams = codes.map((c) => teamsByCode[c]).filter(Boolean);
    if (groupTeams.length !== 4) continue;
    const stats = Object.fromEntries(groupTeams.map((t) => [
      t.code, { team: t, p: 0, gf: 0, ga: 0, w: 0, d: 0, l: 0 },
    ]));
    for (const [ai, bi] of ROUND_ROBIN_PAIRS) {
      const a = groupTeams[ai];
      const b = groupTeams[bi];
      const { scoreA, scoreB } = sampleMatch(a, b, ctx, rng);
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
  return out;
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
  const groupTables = simulateGroupStage(teams, groups, ctx, rng);
  const qualifiers = pickQualifiers(groupTables);
  const { rounds, champion } = simulateKnockout(qualifiers, ctx, rng);
  const lastRound = rounds[rounds.length - 1];
  const finalMatch = lastRound?.matches?.[0];
  const semis = rounds[rounds.length - 2]?.matches?.flatMap((m) => [m.a, m.b]) || [];
  const quarters = rounds[rounds.length - 3]?.matches?.flatMap((m) => [m.a, m.b]) || semis.slice();
  return {
    groupTables, qualifiers, rounds, champion,
    finalists: finalMatch ? [finalMatch.a, finalMatch.b] : [],
    semifinalists: semis,
    quarterfinalists: quarters,
  };
}

/* ─────────── Monte-Carlo over the ensemble ─────────── */

export function runEnsembleMonteCarlo(teams, groups, hostCodes, eloMap, options = {}, iterations = 10000) {
  const ctx = {
    eloMap,
    hostCodes,
    squadDelta: options.squadDelta || null,
    dcParams: options.dcParams || null,
    weights: options.weights || DEFAULT_WEIGHTS,
    options: {
      useHost: options.useHost !== false,
      useSquad: options.useSquad !== false,
      useDC: options.useDC !== false,
      useMarket: options.useMarket !== false,
    },
  };
  // If DC isn't desired in this scenario, set its weight to 0.
  if (!ctx.options.useDC) ctx.weights = { ...ctx.weights, dc: 0 };

  const masterRng = mulberry32(hash32(`mc|${iterations}|${options.seed || "main"}`));
  const blank = () => Object.fromEntries(teams.map((t) => [t.code, 0]));
  const counts = {
    title: blank(), finals: blank(), semis: blank(),
    quarters: blank(), groupAdvance: blank(),
  };
  const groupPos = Object.fromEntries(teams.map((t) => [t.code, { p1: 0, p2: 0, p3: 0, p4: 0, total: 0 }]));
  let sampleRun = null;

  for (let i = 0; i < iterations; i++) {
    const iterSeed = Math.floor(masterRng() * 0xffffffff) >>> 0;
    const rng = mulberry32(iterSeed);
    const r = simulateTournament(teams, groups, ctx, rng);
    if (r.champion) counts.title[r.champion.code] = (counts.title[r.champion.code] || 0) + 1;
    for (const t of r.finalists) counts.finals[t.code] = (counts.finals[t.code] || 0) + 1;
    for (const t of r.semifinalists) counts.semis[t.code] = (counts.semis[t.code] || 0) + 1;
    for (const t of r.quarterfinalists) counts.quarters[t.code] = (counts.quarters[t.code] || 0) + 1;
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
    if (i === 0) sampleRun = r;
  }
  const toProbs = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v / iterations]));
  return {
    iterations,
    titleProbability: toProbs(counts.title),
    finalsProbability: toProbs(counts.finals),
    semisProbability: toProbs(counts.semis),
    quartersProbability: toProbs(counts.quarters),
    groupAdvanceProbability: toProbs(counts.groupAdvance),
    groupPositionDistribution: groupPos,
    sampleRun,
    weights: ctx.weights,
  };
}

/* ─────────── DC fitting from historical matches ─────────── */

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
      weight: Math.exp(-(2026 - year) * 0.06),
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
