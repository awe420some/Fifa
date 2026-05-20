// Data-driven 2026 World Cup predictor — Elo + Monte-Carlo.
// Pure functions: every randomized step takes an injected `rng` so callers
// can reproduce a run with a fixed seed.

import { hash32, mulberry32 } from "./rng.js";

/* ─────────── Elo math ─────────── */

// Standard Elo win probability with optional home-advantage bias.
// homeAdv > 0 means team-A is at home (or has the boost).
export function winProbability(eloA, eloB, homeAdv = 0) {
  return 1 / (1 + Math.pow(10, -(eloA - eloB + homeAdv) / 400));
}

// Mean goals per side. Linear fit calibrated against the 1994–2022
// backtest dataset (slope and base set so a 200-Elo edge ≈ +0.7 expected goals).
// Clamped to keep Poisson sampling stable.
const GOAL_BASE = 1.42;
const GOAL_SLOPE = 0.55;
const GOAL_FLOOR = 0.15;
const GOAL_CEIL = 5.0;
const HOME_BONUS = 80;

export function expectedGoals(eloFor, eloAgainst, homeAdv = 0) {
  const diff = (eloFor - eloAgainst + homeAdv) / 400;
  return Math.min(GOAL_CEIL, Math.max(GOAL_FLOOR, GOAL_BASE + GOAL_SLOPE * diff));
}

function poissonSample(lambda, rng) {
  const r = rng();
  let cum = 0;
  let p = Math.exp(-lambda);
  for (let k = 0; k <= 8; k++) {
    cum += p;
    if (r < cum) return k;
    p = (p * lambda) / (k + 1);
  }
  return 8;
}

/* ─────────── Match simulation ─────────── */

function eloOf(team, eloMap) {
  return eloMap[team.code] ?? 1500;
}

function homeAdvFor(team, hostCodes) {
  return hostCodes.includes(team.code) ? HOME_BONUS : 0;
}

// Group / knockout-regulation match. Returns { scoreA, scoreB }.
export function simulateMatch(teamA, teamB, eloMap, hostCodes, rng) {
  const eA = eloOf(teamA, eloMap);
  const eB = eloOf(teamB, eloMap);
  const hA = homeAdvFor(teamA, hostCodes);
  const hB = homeAdvFor(teamB, hostCodes);
  const lambdaA = expectedGoals(eA, eB, hA - hB);
  const lambdaB = expectedGoals(eB, eA, hB - hA);
  return {
    scoreA: poissonSample(lambdaA, rng),
    scoreB: poissonSample(lambdaB, rng),
  };
}

// Knockout — resolves draws via Elo-biased shootout (dampened toward 50/50).
function knockoutResult(teamA, teamB, eloMap, hostCodes, rng) {
  const { scoreA, scoreB } = simulateMatch(teamA, teamB, eloMap, hostCodes, rng);
  if (scoreA !== scoreB) {
    return { winner: scoreA > scoreB ? teamA : teamB, scoreA, scoreB, penalty: false };
  }
  const pAelo = winProbability(eloOf(teamA, eloMap), eloOf(teamB, eloMap));
  // Shootouts are noisier than match play — dampen toward 50/50.
  const pAshootout = 0.5 + (pAelo - 0.5) * 0.4;
  return {
    winner: rng() < pAshootout ? teamA : teamB,
    scoreA, scoreB, penalty: true,
  };
}

/* ─────────── Bracket order (classical seeding) ─────────── */

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

/* ─────────── Group stage ─────────── */

const ROUND_ROBIN_PAIRS = [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]];

export function simulateGroupStage(teams, groups, hostCodes, eloMap, rng) {
  const out = {};
  const teamsByCode = Object.fromEntries(teams.map((t) => [t.code, t]));
  for (const [letter, codes] of Object.entries(groups)) {
    const groupTeams = codes.map((c) => teamsByCode[c]).filter(Boolean);
    if (groupTeams.length !== 4) continue;
    const stats = Object.fromEntries(groupTeams.map((t) => [
      t.code,
      { team: t, p: 0, gf: 0, ga: 0, w: 0, d: 0, l: 0 },
    ]));
    for (const [ai, bi] of ROUND_ROBIN_PAIRS) {
      const a = groupTeams[ai];
      const b = groupTeams[bi];
      const { scoreA, scoreB } = simulateMatch(a, b, eloMap, hostCodes, rng);
      stats[a.code].gf += scoreA; stats[a.code].ga += scoreB;
      stats[b.code].gf += scoreB; stats[b.code].ga += scoreA;
      if (scoreA > scoreB) { stats[a.code].p += 3; stats[a.code].w++; stats[b.code].l++; }
      else if (scoreB > scoreA) { stats[b.code].p += 3; stats[b.code].w++; stats[a.code].l++; }
      else { stats[a.code].p += 1; stats[b.code].p += 1; stats[a.code].d++; stats[b.code].d++; }
    }
    const table = Object.values(stats).map((r) => ({ ...r, gd: r.gf - r.ga }));
    // FIFA tie-break: points → GD → GF → Elo proxy (stable).
    table.sort((x, y) =>
      y.p - x.p ||
      y.gd - x.gd ||
      y.gf - x.gf ||
      eloOf(y.team, eloMap) - eloOf(x.team, eloMap)
    );
    out[letter] = table;
  }
  return out;
}

export function pickQualifiers(groupTables) {
  const winners = [];
  const runnersUp = [];
  const thirds = [];
  for (const [letter, table] of Object.entries(groupTables)) {
    if (table[0]) winners.push({ ...table[0], group: letter, pos: 1 });
    if (table[1]) runnersUp.push({ ...table[1], group: letter, pos: 2 });
    if (table[2]) thirds.push({ ...table[2], group: letter, pos: 3 });
  }
  thirds.sort((a, b) => b.p - a.p || b.gd - a.gd || b.gf - a.gf || a.group.localeCompare(b.group));
  // 12 groups → 24 + 8 best thirds = 32.
  // 8 groups (32-team WM) → 16 + 16 = 32; no thirds needed.
  if (winners.length === 12) return [...winners, ...runnersUp, ...thirds.slice(0, 8)];
  return [...winners, ...runnersUp];
}

/* ─────────── Knockout ─────────── */

const KO_ROUND_NAMES = ["R32", "R16", "QF", "SF", "Final"];

export function simulateKnockout(qualifiers, eloMap, hostCodes, rng) {
  // Sort by group rank, then performance, then Elo — strongest first.
  const seeded = qualifiers.slice().sort((x, y) =>
    x.pos - y.pos ||
    y.p - x.p ||
    y.gd - x.gd ||
    y.gf - x.gf ||
    eloOf(y.team, eloMap) - eloOf(x.team, eloMap)
  );
  const size = seeded.length;
  // Classical bracket order — 32 or 16 depending on qualifier count.
  const bracketN = size === 32 ? 32 : 16;
  const order = bracketOrder(bracketN).map((rank) => seeded[rank - 1]?.team);
  const rounds = [];
  let current = order.filter(Boolean);
  const startIdx = bracketN === 32 ? 0 : 1; // skip R32 if we only have 16
  for (let r = startIdx; r < KO_ROUND_NAMES.length; r++) {
    const matches = [];
    const next = [];
    for (let m = 0; m < current.length; m += 2) {
      const a = current[m];
      const b = current[m + 1];
      if (!a || !b) {
        next.push(a || b);
        continue;
      }
      const result = knockoutResult(a, b, eloMap, hostCodes, rng);
      matches.push({ round: KO_ROUND_NAMES[r], a, b, ...result, key: `${r}-${m / 2}` });
      next.push(result.winner);
    }
    rounds.push({ name: KO_ROUND_NAMES[r], matches });
    current = next;
    if (current.length <= 1) break;
  }
  return { rounds, champion: current[0] || null };
}

/* ─────────── Single tournament ─────────── */

export function simulateTournament(teams, groups, hostCodes, eloMap, rng) {
  const groupTables = simulateGroupStage(teams, groups, hostCodes, eloMap, rng);
  const qualifiers = pickQualifiers(groupTables);
  const { rounds, champion } = simulateKnockout(qualifiers, eloMap, hostCodes, rng);
  const lastRound = rounds[rounds.length - 1];
  const finalMatch = lastRound?.matches?.[0];
  const semis = rounds[rounds.length - 2]?.matches?.flatMap((m) => [m.a, m.b]) || [];
  const quarters = rounds[rounds.length - 3]?.matches?.flatMap((m) => [m.a, m.b]) || semis.slice();
  return {
    groupTables,
    qualifiers,
    rounds,
    champion,
    finalists: finalMatch ? [finalMatch.a, finalMatch.b] : [],
    semifinalists: semis,
    quarterfinalists: quarters,
  };
}

/* ─────────── Monte-Carlo aggregator ─────────── */

export function runMonteCarlo(teams, groups, hostCodes, eloMap, iterations, seed = 1) {
  const masterRng = mulberry32(hash32(`mc-master|${seed}|${iterations}`));
  const blank = () => Object.fromEntries(teams.map((t) => [t.code, 0]));
  const counts = {
    title: blank(),
    finals: blank(),
    semis: blank(),
    quarters: blank(),
    groupAdvance: blank(),
  };
  const groupPos = Object.fromEntries(teams.map((t) => [t.code, { p1: 0, p2: 0, p3: 0, p4: 0, total: 0 }]));
  let sampleRun = null;

  for (let i = 0; i < iterations; i++) {
    const iterSeed = Math.floor(masterRng() * 0xffffffff) >>> 0;
    const rng = mulberry32(iterSeed);
    const r = simulateTournament(teams, groups, hostCodes, eloMap, rng);
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

  const toProbabilities = (map) => Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v / iterations]));
  return {
    iterations,
    titleProbability: toProbabilities(counts.title),
    finalsProbability: toProbabilities(counts.finals),
    semisProbability: toProbabilities(counts.semis),
    quartersProbability: toProbabilities(counts.quarters),
    groupAdvanceProbability: toProbabilities(counts.groupAdvance),
    groupPositionDistribution: groupPos,
    sampleRun,
  };
}

/* ─────────── Knockout-only backtest ─────────── */

// Given the 16 teams that actually reached the Round of 16 in a historical
// tournament, plus their pre-tournament Elos, simulate the bracket many
// times and check how the model ranked the eventual champion. We use the
// actual KO bracket (R16 pairings reconstructed from match list) rather
// than re-seeding, because the user wants to evaluate KO prediction, not
// FIFA's bracket-seeding policy.
function pairsFromKnockoutMatches(matches) {
  // The R16 entries appear in order in the matches array; pair them off.
  const r16 = matches.filter((m) => m.stage === "R16");
  return r16.map((m) => [m.teamA, m.teamB]);
}

function simulateKnockoutFromPairs(pairs, eloMap, hostCodes, rng) {
  // current is a flat list of 16 teams in bracket order (winner of pair 0
  // faces winner of pair 1 in QF, etc).
  let current = pairs.flat();
  const roundNames = ["R16", "QF", "SF", "Final"];
  const rounds = [];
  for (let r = 0; r < roundNames.length; r++) {
    const matches = [];
    const next = [];
    for (let m = 0; m < current.length; m += 2) {
      const aCode = current[m];
      const bCode = current[m + 1];
      const a = { code: aCode };
      const b = { code: bCode };
      const result = knockoutResult(a, b, eloMap, hostCodes, rng);
      matches.push({ round: roundNames[r], aCode, bCode, ...result });
      next.push(result.winner.code);
    }
    rounds.push({ name: roundNames[r], matches });
    current = next;
  }
  return { rounds, champion: current[0] };
}

// Run the KO-only backtest. Returns per-tournament rows + aggregate metrics.
// `historicalKnockouts` is an array of { year, host, champion, matches, r16, ... }.
// `historicalElo` is { year: { code: elo } } map; `nameToCodeFn` maps
// English country names to FIFA codes (we need this to identify hosts).
export function runKnockoutBacktest(historicalKnockouts, historicalElo, nameToCodeFn, iterationsPerTournament = 2000) {
  const results = [];
  for (const t of historicalKnockouts) {
    const eloMap = historicalElo[t.year];
    if (!eloMap) {
      results.push({ year: t.year, skipped: "no Elo snapshot" });
      continue;
    }
    const hostCodes = (t.host || []).map((name) => nameToCodeFn(name)).filter(Boolean);
    const pairs = pairsFromKnockoutMatches(t.matches);
    if (pairs.length !== 8) {
      results.push({ year: t.year, skipped: `expected 8 R16 pairs, got ${pairs.length}` });
      continue;
    }
    const counts = {};
    const rng = mulberry32(hash32(`bt|${t.year}|${iterationsPerTournament}`));
    for (let i = 0; i < iterationsPerTournament; i++) {
      const iterSeed = Math.floor(rng() * 0xffffffff) >>> 0;
      const iterRng = mulberry32(iterSeed);
      const { champion } = simulateKnockoutFromPairs(pairs, eloMap, hostCodes, iterRng);
      counts[champion] = (counts[champion] || 0) + 1;
    }
    const ranked = Object.entries(counts)
      .map(([code, n]) => ({ code, prob: n / iterationsPerTournament }))
      .sort((a, b) => b.prob - a.prob);
    const champCode = nameToCodeFn(t.champion);
    const champEntry = ranked.find((r) => r.code === champCode);
    const champProb = champEntry ? champEntry.prob : 0;
    const champRank = ranked.findIndex((r) => r.code === champCode) + 1;
    results.push({
      year: t.year,
      host: t.host,
      actualChampion: t.champion,
      actualChampionCode: champCode,
      modelTop3: ranked.slice(0, 3),
      championProb: champProb,
      championRank: champRank > 0 ? champRank : null,
      logLoss: -Math.log(Math.max(1e-4, champProb)),
      brier: Math.pow(1 - champProb, 2),
      iterations: iterationsPerTournament,
    });
  }
  const valid = results.filter((r) => !r.skipped);
  const avgLogLoss = valid.length ? valid.reduce((s, r) => s + r.logLoss, 0) / valid.length : null;
  const avgBrier = valid.length ? valid.reduce((s, r) => s + r.brier, 0) / valid.length : null;
  const topNHits = (n) => valid.filter((r) => r.championRank && r.championRank <= n).length;
  return {
    perTournament: results,
    avgLogLoss,
    avgBrier,
    top1Hits: topNHits(1),
    top3Hits: topNHits(3),
    top5Hits: topNHits(5),
    total: valid.length,
  };
}
