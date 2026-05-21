// Ensemble — linear weighted blend of model outputs at match and
// tournament level. Weights fitted by minimizing the ranked probability
// score on a backtest training set.
//
// References:
//   Constantinou, A. (2019). Dolores: a model that predicts football
//     match outcomes from all over the world.
//   Goddard, J. (2005). Regression models for forecasting goals and match
//     results in association football.
//
// Per-match: prob_ensemble[outcome] = Σ w_m × prob_m[outcome]
// Per-tournament title prob: weighted log-blend → renormalize
//   p̂(team) = exp(Σ w_m · log p_m(team))   then normalize

export function blendOutcome(probs, weights) {
  const out = { home: 0, draw: 0, away: 0 };
  let wsum = 0;
  for (const k of Object.keys(probs)) {
    const w = weights[k] ?? 0;
    if (w === 0 || !probs[k]) continue;
    out.home += w * probs[k].home;
    out.draw += w * probs[k].draw;
    out.away += w * probs[k].away;
    wsum += w;
  }
  if (wsum === 0) return { home: 1 / 3, draw: 1 / 3, away: 1 / 3 };
  out.home /= wsum;
  out.draw /= wsum;
  out.away /= wsum;
  return out;
}

// Tournament-level title probability blend. Log-space mean keeps long-tail
// teams from collapsing to zero when one model rounded them out.
export function blendTitleDistribution(distributionsByModel, weights) {
  const teams = new Set();
  for (const d of Object.values(distributionsByModel)) for (const t of Object.keys(d)) teams.add(t);
  const log = {};
  let wsum = 0;
  for (const [model, dist] of Object.entries(distributionsByModel)) {
    const w = weights[model] ?? 0;
    if (w === 0) continue;
    for (const team of teams) {
      const p = dist[team] || 1e-5;
      log[team] = (log[team] || 0) + w * Math.log(p);
    }
    wsum += w;
  }
  if (wsum === 0) {
    // Fall back to uniform across all teams.
    const out = {};
    const u = 1 / teams.size;
    for (const t of teams) out[t] = u;
    return out;
  }
  const out = {};
  let total = 0;
  for (const t of teams) {
    out[t] = Math.exp(log[t] / wsum);
    total += out[t];
  }
  for (const t of teams) out[t] /= total;
  return out;
}

// Ranked Probability Score for three-outcome match.
// outcomeIdx: 0 = home, 1 = draw, 2 = away.
// probs: { home, draw, away }
// RPS = (1/(K-1)) Σ_{k=1..K-1} (Σ_{i=1..k} p_i - I_{actual≤k})²
// For K=3 this is two cumulative diffs.
export function rpsMatch(probs, outcomeIdx) {
  const p = [probs.home, probs.draw, probs.away];
  const a = [0, 0, 0];
  a[outcomeIdx] = 1;
  let cumP = 0, cumA = 0, sum = 0;
  for (let k = 0; k < 2; k++) {
    cumP += p[k];
    cumA += a[k];
    sum += (cumP - cumA) ** 2;
  }
  return sum / 2;
}

// Default weights — research starting point. Should be over-ridden by
// the fitted weights once the backtest runs.
export const DEFAULT_WEIGHTS = {
  elo: 0.30,
  dc: 0.30,
  squad: 0.10,
  market: 0.30,
};

// Find weights minimizing average RPS across a training set of matches.
// Grid search over the 4D weight simplex with step 0.05 is ~6500 evals;
// each eval is O(matches × models). Cheap enough to run client-side.
export function fitWeights(trainingMatches, modelProbs, opts = {}) {
  const { step = 0.10, modelKeys = ["elo", "dc", "squad", "market"] } = opts;
  let best = { rps: Infinity, weights: null };
  const grid = [];
  for (let v = 0; v <= 1.001; v += step) grid.push(Math.round(v / step) * step);
  // Iterate over simplices.
  function* enumerate(remaining, n, sum) {
    if (n === 1) {
      const last = Math.round((1 - sum) / step) * step;
      if (last >= -1e-6 && last <= 1 + 1e-6) yield [last];
      return;
    }
    for (const v of grid) {
      if (sum + v > 1 + 1e-6) break;
      for (const tail of enumerate(remaining - v, n - 1, sum + v)) {
        yield [v, ...tail];
      }
    }
  }
  for (const combo of enumerate(1, modelKeys.length, 0)) {
    const w = {};
    modelKeys.forEach((k, i) => { w[k] = combo[i]; });
    let total = 0;
    for (const m of trainingMatches) {
      const probsByModel = modelProbs(m);
      const ens = blendOutcome(probsByModel, w);
      total += rpsMatch(ens, m.actualOutcome);
    }
    const avg = total / trainingMatches.length;
    if (avg < best.rps) {
      best = { rps: avg, weights: w };
    }
  }
  return best;
}
