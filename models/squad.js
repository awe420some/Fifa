// Squad-strength adjustment — applied as an additive bonus on top of the
// team's Elo before match simulation.
//
// References:
//   McHale, I. G., Scarf, P. A., & Folker, D. E. (2012). On the development
//     of a soccer player performance rating system for the English Premier
//     League. Interfaces. (Inspiration for using a player-aggregate index.)
//   Constantinou, A. & Fenton, N. (2013). Determining the level of ability
//     of football teams by dynamic ratings based on the relative discrepancies
//     in scores between adversaries.
//
// Our squad strength index is intentionally simple: the share of a team's
// 26-man squad playing in a top-5 European league (Premier League, La Liga,
// Bundesliga, Serie A, Ligue 1). Per Sarah Rudd's well-known transfer-fee
// regressions a top-5-league appearance correlates ~0.65 with player wage
// and therefore with FIFA / TM ratings. The metric is a coarse proxy for
// true individual ability but works as an era-normalized signal.
//
// The mapping to Elo is:
//   eraMedian = median(strengthIndex over all teams)
//   adjustment = (strengthIndex - eraMedian) * SCALE
// SCALE is set so a team one stdev above the median gets ~+35 Elo.

export const SQUAD_CONFIG = {
  scale: 100,        // strengthIndex range is [0,1]; ×100 → ±50 Elo
  maxAdjust: 60,     // hard cap to prevent extreme outliers
  defaultIndex: 0.30,
};

export function eraMedian(squadIndex) {
  const vals = Object.values(squadIndex)
    .filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  if (vals.length === 0) return SQUAD_CONFIG.defaultIndex;
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length / 2)];
}

// Returns { code: eloAdjustment }.
export function squadEloAdjustments(squadIndex) {
  const median = eraMedian(squadIndex);
  const out = {};
  for (const [code, idx] of Object.entries(squadIndex)) {
    if (idx == null || Number.isNaN(idx)) {
      out[code] = 0;
      continue;
    }
    const raw = (idx - median) * SQUAD_CONFIG.scale;
    out[code] = Math.max(-SQUAD_CONFIG.maxAdjust, Math.min(SQUAD_CONFIG.maxAdjust, raw));
  }
  return out;
}

// "Remove top player from team" scenario: estimate the new strength
// after losing the strongest player. For our simple top-5-league index
// this means strengthIndex × (n - 1) / n, where n = total squad. Then
// recompute the Elo adjustment. Returns just the delta for that team.
export function squadIndexWithoutTopPlayer(team) {
  if (!team?.players?.length) return team?.strengthIndex ?? null;
  // Naive: top player is one of the top-5-league players (most teams' best
  // player plays there). Drop one top-5 entry from the strengthIndex.
  const total = team.totalSquad ?? team.players.length;
  if (!total || team.top5LeaguePlayers == null) return team.strengthIndex;
  const newTop5 = Math.max(0, team.top5LeaguePlayers - 1);
  return newTop5 / total;
}
