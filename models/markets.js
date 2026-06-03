// Derive every supported betting market from a single per-match forecast.
//
// Input is one of the entries in matchForecast.matchups[]:
//   { teamA, teamB, winA, draw, winB, lambdaA, lambdaB, scorersA, scorersB, ... }
//
// Output is a flat object: marketId → { label, p, fairOdds, type, group, outcome }.
//   - marketId is unique and stable across renders (used as the React-like
//     selection key in the slip).
//   - type = "match" | "score" | "player" — drives auto-settlement.
//   - group = "main" | "specials" | "scorers" — drives UI collapse.
//   - p in [0,1]. fairOdds = 1/p. p < 0.01 or p > 0.99 yields fairOdds = null
//     (too thin to bet sensibly).

import { dcScoreProb } from "./dixonColes.js";
import { poissonPmf, pTotalGoalsOver } from "./poisson.js";
import { GOAL_MINUTE_BINS } from "./players.js";

const MAX_SCORE_GRID = 6;  // sum probability up to 6×6 — captures ~99.99% of realistic Poisson mass
const MIN_BETTABLE_P = 0.01;
const MAX_BETTABLE_P = 0.99;
const DEFAULT_RHO = 0;     // when caller doesn't have the fitted DC ρ, fall back to independent Poisson

function odds(p) {
  if (!Number.isFinite(p) || p < MIN_BETTABLE_P || p > MAX_BETTABLE_P) return null;
  return 1 / p;
}

function add(out, id, label, p, type, group, outcome) {
  out[id] = { label, p, fairOdds: odds(p), type, group, outcome };
}

// Cumulative goal probability up to the end of the first half (≤ minute 45).
// Approximated by summing the prior weights for bins whose center ≤ 45.
function firstHalfFraction() {
  let s = 0;
  for (const b of GOAL_MINUTE_BINS) {
    // bin labels look like "1-15", "16-30", ..., "76-90" — use the upper
    // bound to decide if the bin lies fully in the first half.
    const upper = parseInt(b.label.split("-")[1] || b.label, 10);
    if (upper <= 45) s += b.p;
  }
  return s;
}

const FH_FRAC = firstHalfFraction();

export function deriveMarkets(fc, rho = DEFAULT_RHO) {
  const out = {};
  if (!fc || !Number.isFinite(fc.lambdaA) || !Number.isFinite(fc.lambdaB)) return out;
  const { teamA, teamB, winA = 0, draw = 0, winB = 0, lambdaA, lambdaB } = fc;

  // ── Match result (1X2) ───────────────────────────────────────────────
  add(out, "wld.home", `${teamA}`,        winA, "match", "main", { kind: "wld", side: "home" });
  add(out, "wld.draw", `Draw`,            draw, "match", "main", { kind: "wld", side: "draw" });
  add(out, "wld.away", `${teamB}`,        winB, "match", "main", { kind: "wld", side: "away" });

  // ── Double chance ────────────────────────────────────────────────────
  add(out, "dc.1X", `${teamA} or Draw`, winA + draw, "match", "main", { kind: "dc", side: "1X" });
  add(out, "dc.X2", `Draw or ${teamB}`, draw + winB, "match", "main", { kind: "dc", side: "X2" });
  add(out, "dc.12", `${teamA} or ${teamB}`, winA + winB, "match", "main", { kind: "dc", side: "12" });

  // ── Draw no bet ──────────────────────────────────────────────────────
  const dnbDen = winA + winB;
  if (dnbDen > 0) {
    add(out, "dnb.home", `${teamA} (DNB)`, winA / dnbDen, "match", "main", { kind: "dnb", side: "home" });
    add(out, "dnb.away", `${teamB} (DNB)`, winB / dnbDen, "match", "main", { kind: "dnb", side: "away" });
  }

  // ── Totals (O/U 1.5, 2.5, 3.5) ───────────────────────────────────────
  for (const k of [1.5, 2.5, 3.5]) {
    const over = pTotalGoalsOver(k, lambdaA, lambdaB);
    add(out, `totals.over_${k}`,  `Over ${k}`,  over,     "match", "main", { kind: "totals", line: k, side: "over"  });
    add(out, `totals.under_${k}`, `Under ${k}`, 1 - over, "match", "main", { kind: "totals", line: k, side: "under" });
  }

  // ── Build the 6×6 score grid once for BTTS / correct-score / AH ──────
  const grid = [];
  let gridTotal = 0;
  for (let x = 0; x <= MAX_SCORE_GRID; x++) {
    grid[x] = [];
    for (let y = 0; y <= MAX_SCORE_GRID; y++) {
      const p = Math.max(0, dcScoreProb(x, y, lambdaA, lambdaB, rho));
      grid[x][y] = p;
      gridTotal += p;
    }
  }
  // Renormalise so the 6×6 truncation sums to 1 — protects against
  // small ρ-driven negative cells leaking into derived markets.
  if (gridTotal > 0) {
    for (let x = 0; x <= MAX_SCORE_GRID; x++) {
      for (let y = 0; y <= MAX_SCORE_GRID; y++) grid[x][y] /= gridTotal;
    }
  }

  // ── BTTS ─────────────────────────────────────────────────────────────
  let bttsYes = 0;
  for (let x = 1; x <= MAX_SCORE_GRID; x++) {
    for (let y = 1; y <= MAX_SCORE_GRID; y++) bttsYes += grid[x][y];
  }
  add(out, "btts.yes", `Both teams to score: Yes`, bttsYes,     "match", "specials", { kind: "btts", side: "yes" });
  add(out, "btts.no",  `Both teams to score: No`,  1 - bttsYes, "match", "specials", { kind: "btts", side: "no"  });

  // ── Correct score (top 12 by probability, plus the "Any other" bucket) ──
  const scoreList = [];
  for (let x = 0; x <= MAX_SCORE_GRID; x++) {
    for (let y = 0; y <= MAX_SCORE_GRID; y++) scoreList.push({ x, y, p: grid[x][y] });
  }
  scoreList.sort((a, b) => b.p - a.p);
  let pTop12 = 0;
  for (let i = 0; i < Math.min(12, scoreList.length); i++) {
    const { x, y, p } = scoreList[i];
    add(out, `cs.${x}-${y}`, `${x}–${y}`, p, "score", "specials", { kind: "cs", x, y });
    pTop12 += p;
  }
  if (pTop12 < 0.95) {
    add(out, "cs.other", "Any other score", Math.max(0, 1 - pTop12), "score", "specials", { kind: "cs", other: true });
  }

  // ── Asian handicap ±0.5, ±1.5 ─────────────────────────────────────────
  // -0.5: home must win outright (= winA). +0.5: away must NOT lose (= 1-winA).
  // -1.5: home must win by ≥2. +1.5: away must lose by ≤1 (draw or away win or home by 1).
  add(out, "ah.home_-0.5", `${teamA} -0.5`,  winA,     "match", "specials", { kind: "ah", line: -0.5, side: "home" });
  add(out, "ah.away_+0.5", `${teamB} +0.5`,  1 - winA, "match", "specials", { kind: "ah", line: -0.5, side: "away" });
  let homeBy2 = 0;
  for (let x = 0; x <= MAX_SCORE_GRID; x++) {
    for (let y = 0; y <= MAX_SCORE_GRID; y++) if (x - y >= 2) homeBy2 += grid[x][y];
  }
  add(out, "ah.home_-1.5", `${teamA} -1.5`, homeBy2,     "match", "specials", { kind: "ah", line: -1.5, side: "home" });
  add(out, "ah.away_+1.5", `${teamB} +1.5`, 1 - homeBy2, "match", "specials", { kind: "ah", line: -1.5, side: "away" });

  // ── HT/FT (9-way) ────────────────────────────────────────────────────
  // Split each team's lambda into first-half / second-half independent
  // Poissons via the empirical bin fractions. P(HT outcome, FT outcome)
  // = sum over half-1 score × half-2 score giving the matching ordering.
  const lhA1 = lambdaA * FH_FRAC,    lhB1 = lambdaB * FH_FRAC;
  const lhA2 = lambdaA * (1 - FH_FRAC), lhB2 = lambdaB * (1 - FH_FRAC);
  const HM = 4;  // 4×4 inner-grid per half is plenty
  function halfGrid(la, lb) {
    const g = [];
    for (let x = 0; x <= HM; x++) {
      g[x] = [];
      for (let y = 0; y <= HM; y++) g[x][y] = poissonPmf(x, la) * poissonPmf(y, lb);
    }
    return g;
  }
  const g1 = halfGrid(lhA1, lhB1);
  const g2 = halfGrid(lhA2, lhB2);
  const htft = { HH: 0, HD: 0, HA: 0, DH: 0, DD: 0, DA: 0, AH: 0, AD: 0, AA: 0 };
  for (let x1 = 0; x1 <= HM; x1++) for (let y1 = 0; y1 <= HM; y1++) {
    const p1 = g1[x1][y1]; if (!p1) continue;
    const htCmp = x1 > y1 ? "H" : x1 < y1 ? "A" : "D";
    for (let x2 = 0; x2 <= HM; x2++) for (let y2 = 0; y2 <= HM; y2++) {
      const p2 = g2[x2][y2]; if (!p2) continue;
      const ftX = x1 + x2, ftY = y1 + y2;
      const ftCmp = ftX > ftY ? "H" : ftX < ftY ? "A" : "D";
      htft[`${htCmp}${ftCmp}`] += p1 * p2;
    }
  }
  const htftLabel = { H: teamA, D: "Draw", A: teamB };
  let htftTotal = 0;
  for (const k of Object.keys(htft)) htftTotal += htft[k];
  if (htftTotal > 0) for (const k of Object.keys(htft)) htft[k] /= htftTotal;
  for (const k of Object.keys(htft)) {
    add(out, `htft.${k}`, `${htftLabel[k[0]]} / ${htftLabel[k[1]]} (HT/FT)`, htft[k], "match", "specials", { kind: "htft", code: k });
  }

  // ── Anytime scorer (per-player) ──────────────────────────────────────
  // P(player scores at least once) = 1 - exp(-lambda_team × player_share).
  // scorersA/B already supply expGoals = lambda * p, so we just convert.
  const scorerLine = (sc, teamCode) => {
    for (const s of (sc || [])) {
      const p = 1 - Math.exp(-s.expGoals);
      const id = `scorer.${teamCode}.${s.name.replace(/\s+/g, "_")}`;
      add(out, id, `${s.name} (anytime)`, p, "player", "scorers", { kind: "scorer", team: teamCode, name: s.name });
    }
  };
  scorerLine(fc.scorersA, teamA);
  scorerLine(fc.scorersB, teamB);

  return out;
}

// Settlement: given a placed bet item and the final match result, return
// true (won), false (lost), or null (cannot determine yet — e.g. anytime-
// scorer needs a goal-scorer list we may not have).
//
//   item   — { matchNo, marketId, outcome }
//   result — { scoreA, scoreB, htScoreA?, htScoreB?, goalScorers? }
//
// Pure function, no app/state dependency.
export function settleMarket(item, result) {
  const { outcome } = item;
  if (!outcome) return null;
  const { scoreA, scoreB, htScoreA, htScoreB, goalScorers } = result;
  if (scoreA == null || scoreB == null) return null;
  const total = scoreA + scoreB;
  const homeWin = scoreA > scoreB;
  const awayWin = scoreA < scoreB;
  const isDraw = scoreA === scoreB;

  switch (outcome.kind) {
    case "wld":
      return outcome.side === "home" ? homeWin
           : outcome.side === "away" ? awayWin
           : isDraw;
    case "dc":
      return outcome.side === "1X" ? (homeWin || isDraw)
           : outcome.side === "X2" ? (isDraw || awayWin)
           : (homeWin || awayWin);
    case "dnb":
      if (isDraw) return null;  // stake refunded — caller treats null as void
      return outcome.side === "home" ? homeWin : awayWin;
    case "totals":
      return outcome.side === "over" ? total > outcome.line : total < outcome.line;
    case "btts":
      return outcome.side === "yes" ? (scoreA > 0 && scoreB > 0) : !(scoreA > 0 && scoreB > 0);
    case "cs":
      if (outcome.other) return !(scoreA <= 6 && scoreB <= 6 && /* covered by top-12 */ true);
      return scoreA === outcome.x && scoreB === outcome.y;
    case "ah": {
      const adjHome = scoreA + outcome.line;
      if (outcome.side === "home") return adjHome > scoreB;
      return scoreB > adjHome;
    }
    case "htft": {
      if (htScoreA == null || htScoreB == null) return null;
      const htCmp = htScoreA > htScoreB ? "H" : htScoreA < htScoreB ? "A" : "D";
      const ftCmp = homeWin ? "H" : awayWin ? "A" : "D";
      return `${htCmp}${ftCmp}` === outcome.code;
    }
    case "scorer":
      if (!Array.isArray(goalScorers)) return null;
      return goalScorers.includes(outcome.name);
    default:
      return null;
  }
}
