// Bookmaker market model — de-vigging + multi-source aggregation.
//
// References:
//   Forrest, D., Goddard, J., & Simmons, R. (2005). Odds-setters as
//     forecasters: The case of English football. International Journal
//     of Forecasting.
//   Šťastný, M. (2018). The accuracy and informational efficiency of
//     football betting markets. (Recent meta-analysis — market consensus
//     beats single-bookmaker quotes after de-vigging.)
//
// Decimal odds: o_i = 1 / p_i where p_i is the implied probability *with*
// the bookmaker's margin. Sum of p_i across all outcomes = 1 + overround.
// De-vigging: p̂_i = p_i / Σ p_j  -- divides out the overround uniformly.

export function impliedProb(decimalOdds) {
  if (!decimalOdds || decimalOdds <= 1) return 0;
  return 1 / decimalOdds;
}

export function overround(probs) {
  return Object.values(probs).reduce((s, p) => s + p, 0);
}

// De-vig one bookmaker's implied-prob set so it sums to 1.
export function deVig(probs) {
  const total = overround(probs);
  if (total <= 0) return {};
  const out = {};
  for (const [k, v] of Object.entries(probs)) out[k] = v / total;
  return out;
}

// Aggregate de-vigged distributions across N sources using the logit-
// mean approach recommended by the WM-forecasting literature
// (Henery 1999; Constantinou & Fenton 2013). Extreme values get less
// pull than under an arithmetic mean — important when one source has
// a sharper consensus and another is more diffuse.
const _logit = (p) => Math.log(p / (1 - p));
const _expit = (x) => 1 / (1 + Math.exp(-x));
export function aggregateMarket(sources) {
  if (sources.length === 0) return {};
  const allTeams = new Set();
  for (const s of sources) for (const t of Object.keys(s.probs)) allTeams.add(t);
  const out = {};
  for (const team of allTeams) {
    const vals = sources
      .map((s) => s.probs[team])
      .filter((v) => v !== undefined && v !== null && !Number.isNaN(v) && v > 0 && v < 1);
    if (vals.length === 0) { out[team] = 0; continue; }
    const m = vals
      .map((p) => _logit(Math.max(1e-6, Math.min(1 - 1e-6, p))))
      .reduce((a, b) => a + b, 0) / vals.length;
    out[team] = _expit(m);
  }
  // Renormalize so probabilities sum to 1.
  const total = Object.values(out).reduce((s, v) => s + v, 0);
  if (total === 0) return out;
  for (const k of Object.keys(out)) out[k] /= total;
  return out;
}

// Convenience: build the per-match (home/draw/away) market input from a
// pre-computed aggregated probability map. For outright-winner markets
// we don't have per-match odds, so this is only useful for the few WMs
// where we DO have match-by-match odds. For now we treat market input as
// a tournament-level prior on title probability.
export function buildMarketPrior(aggregatedProbs) {
  return aggregatedProbs;
}
