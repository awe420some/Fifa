// Elo model — refined from the original predictor.js.
// References:
//   Elo, A. E. (1978). The Rating of Chessplayers, Past and Present.
//   eloratings.net methodology — K = 60 for World Cup matches, goal-margin
//     multiplier, home advantage as fixed bonus.
//   Hvattum & Arntzen (2010). Using Elo ratings for match result prediction
//     in association football. International Journal of Forecasting.

import { mulberry32 } from "../rng.js";

export const ELO_CONFIG = {
  homeAdvantage: 80,          // Elo points awarded for home-country matches
  goalBase: 1.42,             // intercept of the linear expected-goals fit
  goalSlope: 0.55,            // slope per 400 Elo of advantage
  goalFloor: 0.15,
  goalCeil: 5.0,
  kBase: 60,                  // K-factor for WM matches (eloratings.net spec)
  shootoutDamp: 0.4,          // (P-0.5) is multiplied by this in shootouts
};

export function winProbability(eloA, eloB, homeAdv = 0) {
  return 1 / (1 + Math.pow(10, -(eloA - eloB + homeAdv) / 400));
}

export function expectedGoals(eloFor, eloAgainst, homeAdv = 0) {
  const diff = (eloFor - eloAgainst + homeAdv) / 400;
  const lambda = ELO_CONFIG.goalBase + ELO_CONFIG.goalSlope * diff;
  return Math.min(ELO_CONFIG.goalCeil, Math.max(ELO_CONFIG.goalFloor, lambda));
}

// Three-outcome (home/draw/away) probabilities from Poisson goal expectations.
// Returns { home, draw, away } summing to 1.
export function eloOutcomeProbs(eloA, eloB, homeAdv = 0) {
  const lA = expectedGoals(eloA, eloB, homeAdv);
  const lB = expectedGoals(eloB, eloA, -homeAdv);
  return outcomeProbsFromPoisson(lA, lB);
}

// Discrete Poisson outcome probabilities up to MAX_GOALS each side.
const MAX_GOALS = 8;
function poissonPMF(lambda, k) {
  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
}
const factCache = [1];
function factorial(k) {
  for (let i = factCache.length; i <= k; i++) factCache[i] = factCache[i - 1] * i;
  return factCache[k];
}

export function outcomeProbsFromPoisson(lA, lB) {
  let home = 0, draw = 0, away = 0;
  for (let x = 0; x <= MAX_GOALS; x++) {
    const px = poissonPMF(lA, x);
    for (let y = 0; y <= MAX_GOALS; y++) {
      const p = px * poissonPMF(lB, y);
      if (x > y) home += p;
      else if (x < y) away += p;
      else draw += p;
    }
  }
  const total = home + draw + away;
  return { home: home / total, draw: draw / total, away: away / total };
}

export function poissonSample(lambda, rng) {
  const r = rng();
  let cum = 0;
  let p = Math.exp(-lambda);
  for (let k = 0; k <= MAX_GOALS; k++) {
    cum += p;
    if (r < cum) return k;
    p = (p * lambda) / (k + 1);
  }
  return MAX_GOALS;
}

// Sample a score (x, y) under the independent-Poisson assumption.
export function sampleScore(eloA, eloB, homeAdv, rng) {
  const lA = expectedGoals(eloA, eloB, homeAdv);
  const lB = expectedGoals(eloB, eloA, -homeAdv);
  return { scoreA: poissonSample(lA, rng), scoreB: poissonSample(lB, rng) };
}

// Time-decay weight φ(t) = exp(-ξ · t) used during Dixon-Coles-style fitting.
// `tYears` is years between the match and the prediction date.
export function timeDecayWeight(tYears, xi = 0.0065) {
  return Math.exp(-xi * tYears * 52); // ξ in 1/week, converted via 52
}
