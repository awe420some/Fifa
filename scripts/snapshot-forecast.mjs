#!/usr/bin/env node
// Runs the forecast in Node, appends a daily title-probability point to
// data/title-history.json. Wired from the scrape-odds GitHub Action so
// every odds refresh also produces a fresh forecast snapshot.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const { TEAMS_2026, GROUPS_2026, ELO_2026, MARKET_ODDS_2026,
        HISTORICAL_KNOCKOUTS, HISTORICAL_ELO, NEW_HISTORICAL_MATCHES,
        SQUAD_INDEX_2026 } = await import("../data.js");
const { runEnsembleMonteCarlo, fitDCOnHistorical, buildCovariateProvider,
        blendWithMarket, matchProbs } = await import("../predictor.js");
const { squadEloAdjustments } = await import("../models/squad.js");
const { DEFAULT_WEIGHTS } = await import("../models/ensemble.js");
const { buildAllMatchForecasts } = await import("../models/matchForecast.js");
const { dcScoreProb } = await import("../models/dixonColes.js");

const HISTORY_PATH = resolve(process.cwd(), "data/title-history.json");
const SNAPSHOT_PATH = resolve(process.cwd(), "data/market-snapshot.json");
const SCHEDULE_PATH = resolve(process.cwd(), "data/schedule-2026.json");
const FORECAST_SNAPSHOT_PATH = resolve(process.cwd(), "data/forecast-snapshot.json");
const MATCH_ODDS_PATH = resolve(process.cwd(), "data/match-odds.json");
const ITERATIONS = 25_000;
const MAX_HISTORY = 90;

const market = (() => {
  if (!existsSync(SNAPSHOT_PATH)) return MARKET_ODDS_2026;
  try {
    const snap = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf-8"));
    return snap.aggregated && Object.keys(snap.aggregated).length > 0 ? snap.aggregated : MARKET_ODDS_2026;
  } catch { return MARKET_ODDS_2026; }
})();

const schedule = (() => {
  if (!existsSync(SCHEDULE_PATH)) return null;
  try {
    const j = JSON.parse(readFileSync(SCHEDULE_PATH, "utf-8"));
    return j.SCHEDULE_2026 || j;
  } catch { return null; }
})();

const dcParams = fitDCOnHistorical(HISTORICAL_KNOCKOUTS, HISTORICAL_ELO, NEW_HISTORICAL_MATCHES);
const squadDelta = SQUAD_INDEX_2026 ? squadEloAdjustments(SQUAD_INDEX_2026) : null;
const covariateProvider = schedule ? buildCovariateProvider(schedule) : null;
const hostCodes = TEAMS_2026.filter((x) => x.host).map((x) => x.code);

const mc = runEnsembleMonteCarlo(
  TEAMS_2026, GROUPS_2026, hostCodes, ELO_2026,
  { squadDelta, dcParams, covariateProvider,
    useHost: true, useSquad: true, useDC: true, useMarket: true, useCovariates: !!covariateProvider },
  ITERATIONS,
);
const blended = blendWithMarket(mc.titleProbability, market, DEFAULT_WEIGHTS.market);

// Keep only the top-15 to keep the file small (the UI only plots top-6 anyway).
const sorted = Object.entries(blended).sort((a, b) => b[1] - a[1]).slice(0, 15);
const titles = Object.fromEntries(sorted.map(([k, v]) => [k, +v.toFixed(5)]));

const today = new Date().toISOString().slice(0, 10);
let history = [];
if (existsSync(HISTORY_PATH)) {
  try { history = JSON.parse(readFileSync(HISTORY_PATH, "utf-8")) || []; }
  catch { history = []; }
}
const filtered = history.filter((h) => h.date !== today);
filtered.push({ date: today, titles });
filtered.sort((a, b) => a.date.localeCompare(b.date));
const capped = filtered.slice(-MAX_HISTORY);
writeFileSync(HISTORY_PATH, JSON.stringify(capped, null, 0));

const top3 = sorted.slice(0, 3).map(([k, v]) => `${k} ${(v * 100).toFixed(1)}%`).join(" · ");
console.log(`Snapshot for ${today}: ${top3} (${capped.length} points in history)`);

// ─────────── Full forecast snapshot ───────────
// The browser renders this JSON instantly on load (snapshot-first); it only
// re-runs the Monte-Carlo when the user changes a Pro-mode scenario toggle.
// Same inputs as app.js recompute() default scenario (all factors on).
const fcCtx = {
  weights: mc.weights || DEFAULT_WEIGHTS,
  squadDelta, dcParams, eloMap: ELO_2026, hostCodes,
  options: { useHost: true, useSquad: true, useDC: true, useMarket: true, useCovariates: !!covariateProvider },
  covariateProvider,
};
const probsFn = (a, b) => matchProbs({ code: a }, { code: b }, fcCtx);
const rho = dcParams?.rho || 0;
// Predicted scoreline = mode (argmax) of the Dixon-Coles joint distribution,
// consistent with app.js forecastScore().
function predScore(lambdaA, lambdaB) {
  let best = { a: 0, b: 0, p: -Infinity };
  for (let x = 0; x <= 6; x++) for (let y = 0; y <= 6; y++) {
    const p = dcScoreProb(x, y, lambdaA, lambdaB, rho);
    if (p > best.p) best = { a: x, b: y, p };
  }
  return { a: best.a, b: best.b };
}
const matchOdds = (() => {
  if (!existsSync(MATCH_ODDS_PATH)) return null;
  try { return JSON.parse(readFileSync(MATCH_ODDS_PATH, "utf-8")); } catch { return null; }
})();
const matchForecasts = schedule
  ? buildAllMatchForecasts(schedule, mc, probsFn, { groupsByLetter: GROUPS_2026, marketByMatchNo: matchOdds?.matches || null })
  : new Map();
const r4 = (n) => +(+n).toFixed(4);
const perMatch = {};
for (const [matchNo, fc] of matchForecasts) {
  const matchups = (fc.matchups || []).map((m) => ({
    teamA: m.teamA, teamB: m.teamB,
    matchupProb: r4(m.matchupProb ?? 1),
    predScore: predScore(m.lambdaA, m.lambdaB),
    lambdaA: +(+m.lambdaA).toFixed(3), lambdaB: +(+m.lambdaB).toFixed(3),
    winA: r4(m.winA), draw: r4(m.draw), winB: r4(m.winB),
    marketBlended: !!m.marketBlended,
    scorersA: m.scorersA.map((s) => ({ name: s.name, prob: r4(s.prob) })),
    scorersB: m.scorersB.map((s) => ({ name: s.name, prob: r4(s.prob) })),
    assistsA: m.assistsA.map((s) => ({ name: s.name, prob: r4(s.prob) })),
    assistsB: m.assistsB.map((s) => ({ name: s.name, prob: r4(s.prob) })),
  }));
  perMatch[matchNo] = { stage: fc.stage, matchups };
}
// Full (untrimmed) raw MC distributions so the browser can drive every view
// (incl. "show all 48 teams") and compute its own market-blend + γ client-side.
const roundAll = (obj) =>
  Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, +v.toFixed(6)]));
const forecastSnapshot = {
  generatedAt: new Date().toISOString(),
  iterations: ITERATIONS,
  titleProbability: roundAll(mc.titleProbability),
  finalsProbability: roundAll(mc.finalsProbability),
  semisProbability: roundAll(mc.semisProbability),
  quartersProbability: roundAll(mc.quartersProbability),
  r16Probability: roundAll(mc.r16Probability),
  r32Probability: roundAll(mc.r32Probability),
  groupAdvanceProbability: roundAll(mc.groupAdvanceProbability),
  groupPositionDistribution: mc.groupPositionDistribution,
  weights: mc.weights,
  matchForecasts: perMatch,
};
writeFileSync(FORECAST_SNAPSHOT_PATH, JSON.stringify(forecastSnapshot, null, 0));
const kb = (JSON.stringify(forecastSnapshot).length / 1024).toFixed(0);
console.log(`Forecast snapshot: ${Object.keys(perMatch).length} matches, ${kb} KB → data/forecast-snapshot.json`);
