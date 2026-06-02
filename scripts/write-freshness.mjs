#!/usr/bin/env node
// Emits data/freshness.json — a single-source-of-truth for "when was each
// data file last refreshed?". Read by the dashboard's freshness banner
// so the UI can show "Letztes Update vor X Min" honestly. Run from the
// GitHub Action after the scrapers + snapshot-forecast steps.

import { statSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const cwd = process.cwd();
const tracked = {
  market: "data/market-snapshot.json",
  playerProps: "data/player-props-2026.json",
  titleHistory: "data/title-history.json",
};

const out = { writtenAt: new Date().toISOString() };
if (process.env.GITHUB_RUN_ID) out.actionRunId = process.env.GITHUB_RUN_ID;
if (process.env.GITHUB_SHA) out.commit = process.env.GITHUB_SHA;

for (const [key, path] of Object.entries(tracked)) {
  const full = resolve(cwd, path);
  if (!existsSync(full)) {
    out[key] = null;
    continue;
  }
  try {
    out[key] = statSync(full).mtime.toISOString();
  } catch {
    out[key] = null;
  }
}

const target = resolve(cwd, "data/freshness.json");
writeFileSync(target, JSON.stringify(out, null, 2) + "\n");
console.log("Wrote freshness manifest:", JSON.stringify(out));
