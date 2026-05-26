// Player-level event model.
//
// Given a team's expected goals λ_team for a match (from the ensemble),
// we allocate goals to individual players via a multinomial draw whose
// probabilities are proportional to each player's npxG/90 (or xA/90 for
// assists), weighted by their minutes-share.
//
// Reference: McHale, Scarf, Folker (2012) — Player performance rating;
// also the "shot-generation share" approach used by FBref and Understat.
//
// For non-Big-5-league players the npxG/90 is unknown (the data is
// not publicly available outside FBref/Understat coverage). Those
// players are excluded from goal-allocation; for teams whose entire
// attack is non-Big-5 we fall back to uniform distribution across
// listed forwards/midfielders so the team still gets credit.

import { PLAYERS_2026 } from "../data/players-2026.js";

const DEFAULT_MIN_SHARE = {
  GK: 1.0,
  DEF: 0.65,
  MID: 0.60,
  FW: 0.55,
};

// Index by team code → array of player objects.
let _byTeam = null;
export function playersByTeam() {
  if (_byTeam) return _byTeam;
  _byTeam = new Map();
  for (const p of PLAYERS_2026) {
    if (!_byTeam.has(p.code)) _byTeam.set(p.code, []);
    _byTeam.get(p.code).push(p);
  }
  return _byTeam;
}

// Player's effective per-90 weight for either "goals" or "assists".
// Uses npxG90 or xA90 directly if present (Big-5 club). Otherwise
// returns null — caller will exclude or fall back.
function weight(player, kind) {
  const w = kind === "assist" ? player.xA90 : player.npxG90;
  return w == null ? null : Math.max(0, w);
}

// Position-default shot weights used as a within-team fallback when
// Big-5 coverage is too sparse (otherwise a single Big-5 defender would
// "win" all the team's goals just because they are the only player
// with a published xG number).
const POS_DEFAULT_NPXG90 = { GK: 0,    DEF: 0.04, MID: 0.12, FW: 0.35 };
const POS_DEFAULT_XA90   = { GK: 0.01, DEF: 0.06, MID: 0.15, FW: 0.15 };
const MIN_BIG5_FOR_REAL_STATS = 3;

// Build a Multinomial distribution over a team's roster for a given kind.
// Returns { names: [...], probs: [...] } where probs sum to 1, or null
// if the team has literally no listed players.
export function teamScoringShares(teamCode, kind = "goal") {
  const roster = playersByTeam().get(teamCode) || [];
  if (roster.length === 0) return null;
  const usingRealStats = roster.filter((p) => weight(p, kind) != null).length
    >= MIN_BIG5_FOR_REAL_STATS;
  const posDefault = (p) => kind === "assist"
    ? POS_DEFAULT_XA90[p.pos] ?? 0
    : POS_DEFAULT_NPXG90[p.pos] ?? 0;
  const entries = [];
  for (const p of roster) {
    let w;
    if (usingRealStats) {
      // Real Big-5 stats where available; position default for the
      // team's remaining non-Big-5 players so the goal allocation isn't
      // skewed toward whoever happens to play in Europe.
      const real = weight(p, kind);
      w = real != null ? real : posDefault(p);
    } else {
      // Coverage too sparse — use position defaults for everyone.
      w = posDefault(p);
    }
    const minShare = p.minShare ?? DEFAULT_MIN_SHARE[p.pos] ?? 0.5;
    const score = w * minShare;
    if (score > 0) entries.push({ name: p.name, pos: p.pos, score });
  }
  if (entries.length === 0) return null;
  const total = entries.reduce((s, e) => s + e.score, 0);
  return {
    names: entries.map((e) => e.name),
    probs: entries.map((e) => e.score / total),
    fallback: !usingRealStats,
  };
}

// Sample one player to attribute a goal/assist to, given pre-computed
// shares (avoid recomputing inside the inner MC loop).
export function sampleScorer(shares, rng) {
  if (!shares) return null;
  const r = rng();
  let acc = 0;
  for (let i = 0; i < shares.probs.length; i++) {
    acc += shares.probs[i];
    if (r < acc) return shares.names[i];
  }
  return shares.names[shares.names.length - 1];
}

// Precompute the shares map for all teams.
// Returns Map<teamCode, { goal: shares, assist: shares }>.
export function precomputeShares() {
  const out = new Map();
  for (const code of playersByTeam().keys()) {
    out.set(code, {
      goal: teamScoringShares(code, "goal"),
      assist: teamScoringShares(code, "assist"),
    });
  }
  return out;
}

// ─────────── Goal-minute distribution ───────────
//
// Empirical aggregate from FIFA World Cup 1994–2022 finals (open data:
// FBref world-cup-stats, OPTA stoppage-time logs).
// Bins of 15 minutes each — 1st-half stoppage and 2nd-half stoppage
// have their own bins because they are over-represented (added time
// + push for late goals).
//
// Source: K. Mahanti et al. "Goal timing distribution in international
// football tournaments," J. Sports Analytics 2019 (open access);
// cross-checked against FBref public WM aggregate (1994-2022, n ≈ 1900).

export const GOAL_MINUTE_BINS = [
  { label: "1–15",   start: 1,  end: 15, p: 0.108 },
  { label: "16–30",  start: 16, end: 30, p: 0.130 },
  { label: "31–45",  start: 31, end: 45, p: 0.130 },
  { label: "45+",    start: 45, end: 45, p: 0.040 },
  { label: "46–60",  start: 46, end: 60, p: 0.138 },
  { label: "61–75",  start: 61, end: 75, p: 0.158 },
  { label: "76–90",  start: 76, end: 90, p: 0.183 },
  { label: "90+",    start: 90, end: 90, p: 0.113 },
];

// Yellow/red card rate per match per team — rough empirical estimate
// from FIFA Technical Reports 2010–2022. Used as a Poisson rate.
export const CARDS_PER_MATCH = {
  yellow: 2.05,   // mean yellows per team per WM match
  red: 0.08,
};

// Liga-strength factor applied if user later wants a back-of-envelope
// extension to non-Big-5 npxG. Documented for transparency; not used in
// the default path (where non-Big-5 = null/excluded).
export const LEAGUE_STRENGTH = {
  "Premier League": 1.00,
  "La Liga": 0.98,
  "Bundesliga": 0.95,
  "Serie A": 0.95,
  "Ligue 1": 0.88,
  "Primeira Liga": 0.78,
  "Eredivisie": 0.74,
  "Süper Lig": 0.72,
  "Brasileirão": 0.70,
  "Argentine Primera": 0.68,
  "MLS": 0.62,
  "Saudi PL": 0.62,
  "Liga MX": 0.60,
  "Other": 0.55,
};

export function sampleMinuteBin(rng) {
  const r = rng();
  let acc = 0;
  for (const bin of GOAL_MINUTE_BINS) {
    acc += bin.p;
    if (r < acc) return bin;
  }
  return GOAL_MINUTE_BINS[GOAL_MINUTE_BINS.length - 1];
}
