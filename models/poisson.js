// Poisson utilities for derivable betting markets.
//
// The Dixon-Coles bivariate Poisson model already lives in dixonColes.js
// and supplies the score-cell helper we use for BTTS / correct-score /
// Asian-handicap. These helpers add the single-variable Poisson primitives
// (pmf, cdf, survival) and the "total goals over k" probability that the
// totals markets need — the sum of two independent Poissons is Poisson
// with rate λA+λB, so we ignore the DC ρ-correction for totals: it only
// re-weights (0,0)/(0,1)/(1,0)/(1,1) and is a second-order effect for
// O/U thresholds.

const FACT = [1];
function factorial(k) {
  for (let i = FACT.length; i <= k; i++) FACT[i] = FACT[i - 1] * i;
  return FACT[k];
}

export function poissonPmf(k, lambda) {
  if (k < 0 || lambda < 0) return 0;
  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
}

export function poissonCdf(k, lambda) {
  let s = 0;
  for (let i = 0; i <= k; i++) s += poissonPmf(i, lambda);
  return s;
}

export function poissonSurvival(k, lambda) {
  return Math.max(0, 1 - poissonCdf(k, lambda));
}

// P(X+Y > threshold) where X~Poisson(λA), Y~Poisson(λB), independent.
// threshold is typically 0.5, 1.5, 2.5, 3.5 — floor then survive.
export function pTotalGoalsOver(threshold, lambdaA, lambdaB) {
  return poissonSurvival(Math.floor(threshold), lambdaA + lambdaB);
}
