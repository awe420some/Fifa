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
        blendWithMarket } = await import("../predictor.js");
const { squadEloAdjustments } = await import("../models/squad.js");
const { DEFAULT_WEIGHTS } = await import("../models/ensemble.js");

const HISTORY_PATH = resolve(process.cwd(), "data/title-history.json");
const SNAPSHOT_PATH = resolve(process.cwd(), "data/market-snapshot.json");
const SCHEDULE_PATH = resolve(process.cwd(), "data/schedule-2026.json");
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
