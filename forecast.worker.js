// Forecast Web Worker — runs the heavy ensemble Monte-Carlo (and the per-player
// MC) off the main thread so the UI never freezes on a scenario change or when
// player projections are computed.
//
// Determinism is preserved: the worker imports the SAME predictor.js + seeded
// RNG, so for identical inputs it produces byte-identical results to the old
// main-thread path. The main thread keeps a synchronous fallback, so if the
// worker is unavailable the app still works exactly as before.

import {
  runEnsembleMonteCarlo,
  runEnsembleMonteCarloBootstrap,
  buildCovariateProvider,
  matchProbs,
} from "./predictor.js";
import { buildAllMatchForecasts } from "./models/matchForecast.js";
import { DEFAULT_WEIGHTS } from "./models/ensemble.js";
import { TEAMS_2026, GROUPS_2026, ELO_2026 } from "./data.js";

const hostCodes = TEAMS_2026.filter((t) => t.host).map((t) => t.code);

// Only the mc fields the UI reads — drops sampleRun etc. to keep postMessage
// cloning small and safe.
function slimMc(mc) {
  return {
    iterations: mc.iterations,
    titleProbability: mc.titleProbability,
    finalsProbability: mc.finalsProbability,
    semisProbability: mc.semisProbability,
    quartersProbability: mc.quartersProbability,
    r16Probability: mc.r16Probability,
    r32Probability: mc.r32Probability,
    groupAdvanceProbability: mc.groupAdvanceProbability,
    groupPositionDistribution: mc.groupPositionDistribution,
    weights: mc.weights,
    bootstrapVar: mc.bootstrapVar, // present only in bootstrap mode
  };
}

function baseOptsFrom(payload, cov) {
  const o = payload.options;
  return {
    squadDelta: payload.squadDelta,
    dcParams: payload.dcParams,
    covariateProvider: cov,
    weights: DEFAULT_WEIGHTS,
    useHost: o.useHost,
    useSquad: o.useSquad,
    useDC: o.useDC,
    useMarket: o.useMarket,
    useCovariates: o.useCovariates,
  };
}

function runMain(payload) {
  const { schedule, options, bootstrap, bootstrapFits, iterations, bootstrapIterations, marketByMatchNo } = payload;
  const cov = schedule ? buildCovariateProvider(schedule) : null;
  const baseOpts = baseOptsFrom(payload, cov);
  let mc;
  if (bootstrap && bootstrapFits && bootstrapFits.length) {
    mc = runEnsembleMonteCarloBootstrap(
      TEAMS_2026, GROUPS_2026, hostCodes, ELO_2026,
      baseOpts, bootstrapFits, bootstrapIterations || 5000,
    );
  } else {
    mc = runEnsembleMonteCarlo(
      TEAMS_2026, GROUPS_2026, hostCodes, ELO_2026,
      baseOpts, iterations || 25000,
    );
  }
  // Per-match analytic forecasts — same ctx the main thread builds in recompute().
  let matchForecasts = new Map();
  if (schedule) {
    const ctx = {
      weights: mc.weights || DEFAULT_WEIGHTS,
      squadDelta: options.useSquad ? payload.squadDelta : null,
      dcParams: options.useDC ? payload.dcParams : null,
      eloMap: ELO_2026,
      hostCodes,
      options,
      covariateProvider: options.useCovariates ? cov : null,
    };
    const probsFn = (a, b) => matchProbs({ code: a }, { code: b }, ctx);
    matchForecasts = buildAllMatchForecasts(schedule, mc, probsFn, { groupsByLetter: GROUPS_2026, marketByMatchNo: marketByMatchNo || null });
  }
  return { mc: slimMc(mc), matchForecasts };
}

function runPlayers(payload) {
  const { schedule, iterations } = payload;
  const cov = schedule ? buildCovariateProvider(schedule) : null;
  const opts = baseOptsFrom(payload, cov);
  opts.trackPlayers = true;
  const res = runEnsembleMonteCarlo(
    TEAMS_2026, GROUPS_2026, hostCodes, ELO_2026,
    opts, iterations || 8000,
  );
  return { players: res.players };
}

self.onmessage = (e) => {
  const { id, type, payload } = e.data || {};
  try {
    const result = type === "players" ? runPlayers(payload) : runMain(payload);
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
