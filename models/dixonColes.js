// Dixon-Coles bivariate Poisson model with τ-correction for low-score
// correlation, weighted maximum-likelihood fit.
//
// References:
//   Dixon, M. J. & Coles, S. G. (1997). Modelling Association Football Scores
//     and Inefficiencies in the Football Betting Market.
//     Journal of the Royal Statistical Society Series C, 46(2), 265–280.
//   Karlis, D. & Ntzoufras, I. (2003). Analysis of sports data by using
//     bivariate Poisson models. The Statistician, 52(3), 381–393.
//
// Per-team parameters: attack α_i, defense β_i.
// Match (i home vs j away):
//   λ_home = exp(μ + α_i + β_j + γ)
//   λ_away = exp(μ + α_j + β_i)
// With τ-correction for (0,0), (0,1), (1,0), (1,1):
//   τ(0,0) = 1 - λ·μ·ρ
//   τ(0,1) = 1 + λ·ρ
//   τ(1,0) = 1 + μ·ρ
//   τ(1,1) = 1 - ρ
// Identification constraint: mean(α) = 0 (recentred each step).

const MAX_GOALS = 8;
const factCache = [1];
function factorial(k) {
  for (let i = factCache.length; i <= k; i++) factCache[i] = factCache[i - 1] * i;
  return factCache[k];
}
function poissonPMF(lambda, k) {
  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
}

export function dcTau(x, y, lambdaH, lambdaA, rho) {
  if (x === 0 && y === 0) return 1 - lambdaH * lambdaA * rho;
  if (x === 0 && y === 1) return 1 + lambdaH * rho;
  if (x === 1 && y === 0) return 1 + lambdaA * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

// Per-match score-cell probability under the DC model.
export function dcScoreProb(x, y, lambdaH, lambdaA, rho) {
  const t = dcTau(x, y, lambdaH, lambdaA, rho);
  return t * poissonPMF(lambdaH, x) * poissonPMF(lambdaA, y);
}

// Three-outcome probabilities from DC.
export function dcOutcomeProbs(lambdaH, lambdaA, rho) {
  let home = 0, draw = 0, away = 0;
  for (let x = 0; x <= MAX_GOALS; x++) {
    for (let y = 0; y <= MAX_GOALS; y++) {
      const p = Math.max(0, dcScoreProb(x, y, lambdaH, lambdaA, rho));
      if (x > y) home += p;
      else if (x < y) away += p;
      else draw += p;
    }
  }
  const total = home + draw + away || 1;
  return { home: home / total, draw: draw / total, away: away / total };
}

// Cold-start parameters from Elo: attack/defense both ±(elo - mean)/400.
// This gives reasonable initial λ values before fitting.
export function dcInitFromElo(teamCodes, eloMap) {
  const elos = teamCodes.map((c) => eloMap[c] ?? 1500);
  const meanElo = elos.reduce((a, b) => a + b, 0) / elos.length;
  const params = {
    attack: {},
    defense: {},
    homeAdv: 0.30,    // γ
    intercept: 0.10,  // μ — adjusted so mean λ ≈ 1.4
    rho: -0.10,       // typical DC correction sign
  };
  for (const code of teamCodes) {
    const z = ((eloMap[code] ?? 1500) - meanElo) / 400;
    params.attack[code] = z;
    params.defense[code] = -z;
  }
  return params;
}

function safeLog(x) { return Math.log(Math.max(x, 1e-12)); }

// Log-likelihood of one match under given DC params.
export function dcMatchLogLik(match, params) {
  const { teamA, teamB, scoreA, scoreB, weight = 1 } = match;
  const aA = params.attack[teamA] ?? 0;
  const dA = params.defense[teamA] ?? 0;
  const aB = params.attack[teamB] ?? 0;
  const dB = params.defense[teamB] ?? 0;
  const lambdaH = Math.exp(params.intercept + aA + dB + params.homeAdv);
  const lambdaA = Math.exp(params.intercept + aB + dA);
  const p = dcScoreProb(scoreA, scoreB, lambdaH, lambdaA, params.rho);
  return weight * safeLog(p);
}

export function dcTotalLogLik(matches, params) {
  let s = 0;
  for (const m of matches) s += dcMatchLogLik(m, params);
  return s;
}

// Numerical gradient for fitting. Central difference per parameter.
function gradient(matches, params, eps = 1e-3) {
  const codes = Object.keys(params.attack);
  const grad = { attack: {}, defense: {}, homeAdv: 0, intercept: 0, rho: 0 };
  const base = dcTotalLogLik(matches, params);

  function deriv(setter, reset) {
    setter(eps);
    const up = dcTotalLogLik(matches, params);
    setter(-2 * eps);
    const down = dcTotalLogLik(matches, params);
    reset();
    return (up - down) / (2 * eps);
  }

  for (const c of codes) {
    grad.attack[c] = deriv(
      (d) => params.attack[c] += d,
      () => params.attack[c] += eps,
    );
    grad.defense[c] = deriv(
      (d) => params.defense[c] += d,
      () => params.defense[c] += eps,
    );
  }
  grad.homeAdv = deriv(
    (d) => params.homeAdv += d,
    () => params.homeAdv += eps,
  );
  grad.intercept = deriv(
    (d) => params.intercept += d,
    () => params.intercept += eps,
  );
  // ρ-derivative needs to stay in bounds; clamp via reduced eps.
  grad.rho = deriv(
    (d) => params.rho = Math.max(-0.4, Math.min(0.4, params.rho + d)),
    () => params.rho = Math.max(-0.4, Math.min(0.4, params.rho + eps)),
  );
  // Restore (defensive — round-trip via ±eps already cancels).
  return grad;
}

// Plain gradient ascent on log-likelihood. Lightweight by design — exact
// MLE isn't needed; we want a reasonable fit in <2s of browser CPU.
export function fitDixonColes(matches, teamCodes, eloMap, opts = {}) {
  const {
    iterations = 80,
    lr = 0.05,
    momentum = 0.85,
    centerEvery = 4,
  } = opts;
  const params = dcInitFromElo(teamCodes, eloMap);
  const velocity = { attack: {}, defense: {}, homeAdv: 0, intercept: 0, rho: 0 };
  for (const c of teamCodes) {
    velocity.attack[c] = 0;
    velocity.defense[c] = 0;
  }
  let bestLL = -Infinity;
  let bestParams = clone(params);
  for (let it = 0; it < iterations; it++) {
    const g = gradient(matches, params);
    for (const c of teamCodes) {
      velocity.attack[c] = momentum * velocity.attack[c] + lr * (g.attack[c] || 0);
      velocity.defense[c] = momentum * velocity.defense[c] + lr * (g.defense[c] || 0);
      params.attack[c] += velocity.attack[c];
      params.defense[c] += velocity.defense[c];
    }
    velocity.homeAdv = momentum * velocity.homeAdv + lr * g.homeAdv;
    velocity.intercept = momentum * velocity.intercept + lr * g.intercept;
    velocity.rho = momentum * velocity.rho + lr * g.rho;
    params.homeAdv += velocity.homeAdv;
    params.intercept += velocity.intercept;
    params.rho = Math.max(-0.4, Math.min(0.4, params.rho + velocity.rho));
    // Recenter attack/defense periodically — identification constraint.
    if (it % centerEvery === 0) {
      recenter(params.attack);
      recenter(params.defense);
    }
    const ll = dcTotalLogLik(matches, params);
    if (ll > bestLL) {
      bestLL = ll;
      bestParams = clone(params);
    }
  }
  recenter(bestParams.attack);
  recenter(bestParams.defense);
  bestParams.logLik = bestLL;
  bestParams.iterations = iterations;
  return bestParams;
}

function recenter(map) {
  const codes = Object.keys(map);
  const mean = codes.reduce((s, c) => s + map[c], 0) / codes.length;
  for (const c of codes) map[c] -= mean;
}

function clone(p) {
  return {
    attack: { ...p.attack },
    defense: { ...p.defense },
    homeAdv: p.homeAdv,
    intercept: p.intercept,
    rho: p.rho,
  };
}

// Bootstrap resample: returns B independently fitted parameter sets,
// each from a with-replacement resample of the input match list.
// Used by the dashboard's "parameter uncertainty" toggle to propagate
// fit uncertainty into the Monte-Carlo title distribution.
export function bootstrapDC(matches, teamCodes, eloMap, B = 20, opts = {}) {
  const fits = [];
  const n = matches.length;
  for (let b = 0; b < B; b++) {
    const sample = new Array(n);
    for (let i = 0; i < n; i++) sample[i] = matches[Math.floor(Math.random() * n)];
    fits.push(fitDixonColes(sample, teamCodes, eloMap, opts));
  }
  return fits;
}

// Given fitted params, compute outcome probabilities for an arbitrary match.
// hostFlag ∈ {+1, 0, -1}: +1 home for A, 0 neutral, -1 home for B.
export function dcMatchOutcome(teamA, teamB, params, hostFlag = 0) {
  const aA = params.attack[teamA] ?? 0;
  const dA = params.defense[teamA] ?? 0;
  const aB = params.attack[teamB] ?? 0;
  const dB = params.defense[teamB] ?? 0;
  const ha = params.homeAdv * hostFlag;
  const lambdaH = Math.exp(params.intercept + aA + dB + Math.max(0, ha));
  const lambdaA = Math.exp(params.intercept + aB + dA + Math.max(0, -ha));
  return { ...dcOutcomeProbs(lambdaH, lambdaA, params.rho), lambdaH, lambdaA };
}
