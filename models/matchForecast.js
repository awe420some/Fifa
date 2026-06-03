// Per-match player forecasts for the 2026 World Cup.
//
// Pure analytic layer on top of the existing MC + per-team Multinomial:
//
//   - matchProbs() supplies lambda_team for each match (Poisson rate),
//     already adjusted for Elo / Dixon-Coles / squad delta / covariates.
//   - precomputeShares() supplies the per-team {names, probs} Multinomial
//     for "given my team scores, who scored?".
//
// Player-level: P(player_i scores >= 1 goal in match) = 1 - exp(-lambda * p_i).
// Assists: same form using the xA-derived shares + the 0.72 assist-on-goal
// rate baked into samplePlayerEvents (we apply it once at the team level).
//
// KO matches contain placeholder slots ("1A", "2B", "3CEFHI", "W73", "L101")
// because participants depend on group results. We resolve each slot into a
// probability distribution over team codes using the MC's existing outputs:
//   - state.mc.groupPositionDistribution[code].pN for direct slots
//   - recursive expansion of Wnnn/Lnnn via matchProbs of the upstream slots
// Then enumerate the top-3 most-likely (teamA, teamB) pairings by joint
// probability and compute a per-matchup forecast. The same-group bracket
// constraint (two group-mates can't meet at R32) is enforced as a hard zero
// in the cartesian product; at R16+ the constraint relaxes but joint
// probabilities of group-mate matchups are vanishingly small anyway.

import { precomputeShares, GOAL_MINUTE_BINS } from "./players.js";
import { matchProbs } from "../predictor.js";

const ASSIST_RATE = 0.72;   // empirical share of goals with a primary assist

// ─────────── KO slot resolution ───────────

// Resolve a single slot string into Map<teamCode, prob>. Memoised inside
// builder.
function resolveSlot(slot, groupsByLetter, groupPos, mc, schedule, matchProbsFn, cache) {
  if (cache.has(slot)) return cache.get(slot);
  let out;
  // "1A" / "2A" / "3A" / "4A" — direct group position
  const direct = /^([1-4])([A-L])$/.exec(slot);
  if (direct) {
    const pos = Number(direct[1]);
    const letter = direct[2];
    out = resolveDirectGroupPos(pos, letter, groupsByLetter, groupPos);
    cache.set(slot, out);
    return out;
  }
  // "3CEFHI" — best 3rd from one of the listed groups
  const best3 = /^3([A-L]{2,})$/.exec(slot);
  if (best3) {
    out = resolveBestThird(best3[1].split(""), groupsByLetter, groupPos);
    cache.set(slot, out);
    return out;
  }
  // "W73" or "L73" — winner/loser of match 73 (recursive)
  const wl = /^([WL])(\d+)$/.exec(slot);
  if (wl) {
    const isWin = wl[1] === "W";
    const upstreamNo = Number(wl[2]);
    const upstream = schedule.find((m) => m.matchNo === upstreamNo);
    if (!upstream) { out = new Map(); cache.set(slot, out); return out; }
    const distA = resolveSlot(upstream.teamA, groupsByLetter, groupPos, mc, schedule, matchProbsFn, cache);
    const distB = resolveSlot(upstream.teamB, groupsByLetter, groupPos, mc, schedule, matchProbsFn, cache);
    out = resolveWinnerLoser(distA, distB, isWin, matchProbsFn);
    cache.set(slot, out);
    return out;
  }
  // Already a real team code — singleton distribution.
  out = new Map([[slot, 1]]);
  cache.set(slot, out);
  return out;
}

function resolveDirectGroupPos(pos, letter, groupsByLetter, groupPos) {
  const codes = groupsByLetter[letter] || [];
  const dist = new Map();
  const key = pos === 1 ? "p1" : pos === 2 ? "p2" : pos === 3 ? "p3" : "p4";
  let total = 0;
  for (const code of codes) {
    const gp = groupPos[code];
    if (!gp || !gp.total) continue;
    const p = (gp[key] || 0) / gp.total;
    if (p > 0) { dist.set(code, p); total += p; }
  }
  // Renormalise to handle rounding / missing entries.
  if (total > 0) for (const [k, v] of dist) dist.set(k, v / total);
  return dist;
}

function resolveBestThird(letters, groupsByLetter, groupPos) {
  // For 48-team format, FIFA picks the 8 best 3rd-placed teams across all 12
  // groups. Each best-3rd KO slot ("3CEFHI") draws from a specific eligible
  // set (the 5 letters). Within that set, the team that finishes 3rd in any
  // of those groups can fill the slot. We approximate by pooling each team's
  // p3 (its probability of ending 3rd in its own group), then normalising
  // within the candidate pool — this matches "conditional on the 3rd-place
  // happening in one of these groups, who's there?". Bracket-resolution
  // ignores the joint constraint that only 8 of 12 third-place teams qualify
  // at all (which the MC's r32Probability captures); we accept the slight
  // overestimate here.
  const dist = new Map();
  let total = 0;
  for (const letter of letters) {
    const codes = groupsByLetter[letter] || [];
    for (const code of codes) {
      const gp = groupPos[code];
      if (!gp || !gp.total) continue;
      const p = (gp.p3 || 0) / gp.total;
      if (p > 0) { dist.set(code, (dist.get(code) || 0) + p); total += p; }
    }
  }
  if (total > 0) for (const [k, v] of dist) dist.set(k, v / total);
  return dist;
}

function resolveWinnerLoser(distA, distB, isWin, matchProbsFn) {
  // For each candidate pair (a,b) we know P(a in slotA) * P(b in slotB).
  // Given that pair plays, matchProbs gives P(a beats b). The winner of
  // the slot is then sum_{a,b} P(a) * P(b) * P(a wins). For an upstream KO
  // match, we use the ensemble outcome (no draws in KO — split draws 50/50
  // since this is an approximation; the MC's actual KO logic uses extra
  // time + penalties, but the per-match outcome over many sims still maps
  // to a binary win/loss for our analytic estimate).
  const winner = new Map();
  for (const [a, pa] of distA) {
    for (const [b, pb] of distB) {
      if (a === b) continue;  // can't play themselves
      const joint = pa * pb;
      if (joint < 1e-6) continue;  // prune
      let pWinA;
      try {
        const res = matchProbsFn(a, b);
        if (!res) continue;
        const { home, draw, away } = res.ensemble || res;
        pWinA = home + 0.5 * draw;  // KO: draws resolve in ET+pens → split
      } catch {
        continue;
      }
      const pWinForWinner = isWin ? pWinA : (1 - pWinA);
      const code = isWin ? a : a;   // both branches need same code; symmetric handled below
      // Actually we need to record contribution per CODE. For "isWin": a
      // contributes joint * pWinA, b contributes joint * (1 - pWinA). For
      // "isLoser": flip.
      const codeForA = isWin ? a : a;
      const codeForB = isWin ? b : b;
      const contribA = joint * (isWin ? pWinA : (1 - pWinA));
      const contribB = joint * (isWin ? (1 - pWinA) : pWinA);
      winner.set(codeForA, (winner.get(codeForA) || 0) + contribA);
      winner.set(codeForB, (winner.get(codeForB) || 0) + contribB);
    }
  }
  // Normalise.
  let total = 0;
  for (const v of winner.values()) total += v;
  if (total > 0) for (const [k, v] of winner) winner.set(k, v / total);
  return winner;
}

// ─────────── Per-match player forecast ───────────

// For a concrete matchup (teamA code, teamB code), compute the forecast.
// Returns:
//   { teamA, teamB, lambdaA, lambdaB,
//     winA, draw, winB, eGoalsTotal,
//     scorersA: [{name, prob, expGoals}], scorersB: [...],
//     assistsA: [{name, prob}], assistsB: [...],
//     minuteBins: GOAL_MINUTE_BINS (kept global) }
function forecastMatchup(teamA, teamB, sharesByCode, matchProbsFn) {
  const res = matchProbsFn(teamA, teamB);
  if (!res) return null;
  const lambdaA = res.lambdaH || 0;
  const lambdaB = res.lambdaA || 0;
  const { home, draw, away } = res.ensemble || res;
  const sharesA = sharesByCode.get(teamA);
  const sharesB = sharesByCode.get(teamB);
  const scorersA = topPlayers(sharesA?.goal, lambdaA, 6);
  const scorersB = topPlayers(sharesB?.goal, lambdaB, 6);
  // Assist: 72% of goals have a primary assist → effective assist-lambda
  // per team is ASSIST_RATE * lambda_team.
  const assistsA = topPlayers(sharesA?.assist, lambdaA * ASSIST_RATE, 4);
  const assistsB = topPlayers(sharesB?.assist, lambdaB * ASSIST_RATE, 4);
  return {
    teamA, teamB,
    lambdaA, lambdaB,
    winA: home, draw, winB: away,
    eGoalsTotal: lambdaA + lambdaB,
    scorersA, scorersB,
    assistsA, assistsB,
  };
}

function topPlayers(shares, lambda, topN) {
  if (!shares || !lambda) return [];
  const out = [];
  for (let i = 0; i < shares.names.length; i++) {
    const p = shares.probs[i];
    if (!p) continue;
    const expGoals = lambda * p;
    if (expGoals < 1e-4) continue;
    const prob = 1 - Math.exp(-expGoals);
    out.push({ name: shares.names[i], prob, expGoals });
  }
  out.sort((a, b) => b.prob - a.prob);
  return out.slice(0, topN);
}

// ─────────── Forecast a whole match ───────────

// For a group-stage match: returns { matchups: [{matchup}], primary }.
// For a KO match: enumerates top-3 (teamA, teamB) pairings by joint
// slot-probability and returns one forecast per matchup, sorted by joint p.
function forecastMatch(match, ctx) {
  const { groupsByLetter, groupPos, mc, schedule, matchProbsFn, sharesByCode, slotCache, groupOf } = ctx;
  if (match.stage === "group") {
    const fc = forecastMatchup(match.teamA, match.teamB, sharesByCode, matchProbsFn);
    if (!fc) return { stage: "group", matchups: [] };
    return { stage: "group", matchups: [{ ...fc, matchupProb: 1 }] };
  }
  // KO: resolve both slots, take top-3 joint pairings. Two teams that finished
  // in the same group cannot meet at R32 (structurally enforced by the bracket)
  // and meet only with vanishingly small joint probability at R16+; skip such
  // pairs and let the Top-N sort redistribute the mass to plausible matchups.
  const distA = resolveSlot(match.teamA, groupsByLetter, groupPos, mc, schedule, matchProbsFn, slotCache);
  const distB = resolveSlot(match.teamB, groupsByLetter, groupPos, mc, schedule, matchProbsFn, slotCache);
  const pairs = [];
  for (const [a, pa] of distA) {
    for (const [b, pb] of distB) {
      if (a === b) continue;
      const gA = groupOf?.get(a);
      const gB = groupOf?.get(b);
      if (gA && gB && gA === gB) continue;  // same-group bracket constraint
      pairs.push({ a, b, p: pa * pb });
    }
  }
  pairs.sort((x, y) => y.p - x.p);
  const TOP_PAIRS = 3;
  const matchups = [];
  for (const { a, b, p } of pairs.slice(0, TOP_PAIRS)) {
    if (p < 0.005) break;  // skip vanishingly unlikely
    const fc = forecastMatchup(a, b, sharesByCode, matchProbsFn);
    if (fc) matchups.push({ ...fc, matchupProb: p });
  }
  return { stage: match.stage, matchups };
}

// ─────────── Top-level builder ───────────

export function buildAllMatchForecasts(schedule, mc, makeMatchProbs, options = {}) {
  if (!schedule || !mc || !makeMatchProbs) return new Map();
  const groupsByLetter = options.groupsByLetter;  // { A: ["MEX","RSA",...], ... }
  const groupPos = mc.groupPositionDistribution || {};
  const sharesByCode = precomputeShares();
  const slotCache = new Map();
  // Invert groupsByLetter into Map<teamCode, groupLetter> for the R32+
  // same-group bracket-constraint filter in forecastMatch().
  const groupOf = new Map();
  for (const letter of Object.keys(groupsByLetter || {})) {
    for (const code of groupsByLetter[letter] || []) groupOf.set(code, letter);
  }
  const ctx = {
    groupsByLetter,
    groupPos,
    mc,
    schedule,
    matchProbsFn: makeMatchProbs,
    sharesByCode,
    slotCache,
    groupOf,
  };
  const out = new Map();
  for (const m of schedule) {
    out.set(m.matchNo, forecastMatch(m, ctx));
  }
  return out;
}

// Re-export for the UI to render the per-match heatmap.
export { GOAL_MINUTE_BINS };
