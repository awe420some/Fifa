#!/usr/bin/env node
// Player-prop scraper for the 2026 World Cup — Top Goalscorer + Anytime Scorer.
// Hits DraftKings + Polymarket and writes data/player-props-2026.json.
//
// This is the player-level companion to scrape-bookmakers.mjs. Same
// principles: fresh Chromium per source, per-source timeout, de-vig
// per source, logit-mean across sources, graceful failure (keep existing
// manually-curated snapshot if all sources fail).
//
// Geo-block reality (May 2026): from a GitHub Actions runner (us-east),
// DraftKings is reachable but Polymarket requires a non-US egress.
// FanDuel / Pinnacle / Bet365 hard-block headless browsers entirely.

import { chromium } from "playwright";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const SNAPSHOT_DATE = new Date().toISOString().slice(0, 10);
const OUTPUT_PATH = resolve(process.cwd(), "data/player-props-2026.json");
const PER_SOURCE_TIMEOUT_MS = 60_000;

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

function withinTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout: ${label}`)), ms)),
  ]);
}

function americanToImplied(american) {
  const n = parseInt(american, 10);
  if (!Number.isFinite(n)) return null;
  const decimal = n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
  return 1 / decimal;
}

/* ─────────── Per-source scrapers ─────────── */

async function scrapeDraftKingsPlayerProps(browser) {
  // DraftKings posts top-scorer and anytime-scorer as separate
  // accordion sections on the World Cup outright page. We navigate
  // into each section's category page so the classification is
  // unambiguous — there's no reliable probability heuristic to split
  // them apart (Mbappé's top-scorer +600 ≈ 14% > 5%, which would
  // mis-classify favourites if we did).
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();
  const scrapeCategoryPage = async (url) => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const items = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll("a, div, span, li").forEach((el) => {
        const t = el.textContent;
        if (!t) return;
        const m = t.match(/^([A-ZÀ-Ý][\p{L}\s'.\-]{1,40})\s+([+\-]\d{2,5})$/u);
        if (m) {
          const name = m[1].trim();
          if (name.length >= 4 && name.split(/\s+/).length >= 2) {
            out.push({ name, american: m[2] });
          }
        }
      });
      return out;
    });
    const odds = {};
    for (const it of items) {
      const p = americanToImplied(it.american);
      if (p == null || p <= 0 || p >= 1) continue;
      odds[it.name] = p;
    }
    return odds;
  };
  // Category subpaths are best-effort and may 404 if DraftKings
  // restructures the navigation. We try both market types
  // independently — one failing doesn't poison the other.
  let topScorer = {};
  let anytimeScorer = {};
  try {
    topScorer = await scrapeCategoryPage("https://sportsbook.draftkings.com/leagues/soccer/world-cup?category=top-goalscorer");
  } catch { /* leave empty */ }
  try {
    anytimeScorer = await scrapeCategoryPage("https://sportsbook.draftkings.com/leagues/soccer/world-cup?category=anytime-goalscorer");
  } catch { /* leave empty */ }
  await ctx.close();
  if (Object.keys(topScorer).length === 0 && Object.keys(anytimeScorer).length === 0) {
    throw new Error("draftkings: no player props parsed from either market");
  }
  return { source: "DraftKings", topScorer, anytimeScorer };
}

async function scrapePolymarketPlayerProps(browser) {
  // Polymarket has individual outcome events per player, but also a
  // unified "Top Goalscorer" market. URL discovered from the public
  // events index.
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();
  await page.goto("https://polymarket.com/event/2026-world-cup-top-goalscorer", {
    waitUntil: "networkidle", timeout: 45000,
  });
  const rows = await page.$$eval('[role="row"], li, div[data-testid="outcome"]', (els) =>
    els.map((el) => el.textContent.trim()).filter((t) => /\d/.test(t)).slice(0, 60)
  );
  await ctx.close();
  const topScorer = {};
  for (const r of rows) {
    // "Kylian Mbappé Yes 14.2¢"
    const m = r.match(/^(.+?)\s+(?:Yes\s+)?(\d+(?:\.\d+)?)¢/);
    if (m) {
      const name = m[1].trim();
      const p = parseFloat(m[2]) / 100;
      if (p > 0 && p < 1 && name.split(/\s+/).length >= 2) topScorer[name] = p;
    }
  }
  if (Object.keys(topScorer).length < 3) throw new Error("polymarket: too few players parsed");
  // Polymarket doesn't post per-player anytime-scorer markets; return empty.
  return { source: "Polymarket", topScorer, anytimeScorer: {} };
}

/* ─────────── De-vigging + logit-mean per player ─────────── */

function deVigPlayerMarket(playerMap) {
  // For top-scorer / anytime-scorer, the "vig" is multiplicative across
  // the slate of all listed players. We normalize so probabilities sum to
  // a realistic total (top-scorer ≈ 1; anytime-scorer ≈ 4.0 since each
  // tournament has ~4 different goal scorers per match × ~6 matches).
  const total = Object.values(playerMap).reduce((s, p) => s + p, 0);
  if (total === 0) return {};
  const target = total > 2.5 ? total / 1.05 : 1;  // anytime keeps shape, top-scorer renormalizes to 1
  const out = {};
  for (const [k, v] of Object.entries(playerMap)) out[k] = (v / total) * target;
  return out;
}

const logit = (p) => Math.log(p / (1 - p));
const expit = (x) => 1 / (1 + Math.exp(-x));

function logitMean(probs) {
  if (probs.length === 0) return null;
  const m = probs.map((p) => logit(Math.max(1e-6, Math.min(1 - 1e-6, p)))).reduce((a, b) => a + b, 0) / probs.length;
  return expit(m);
}

function aggregateMarket(sourcesArr, key) {
  const players = new Set();
  const perSourceMaps = sourcesArr.map((s) => deVigPlayerMarket(s[key] || {}));
  for (const m of perSourceMaps) for (const k of Object.keys(m)) players.add(k);
  const out = {};
  for (const name of players) {
    const vals = perSourceMaps.map((m) => m[name]).filter((v) => v != null && v > 0 && v < 1);
    if (vals.length === 0) continue;
    out[name] = {};
    sourcesArr.forEach((s, i) => {
      if (s[key]?.[name] != null) out[name][s.source] = s[key][name];
    });
    out[name].aggregated = logitMean(vals);
  }
  return out;
}

/* ─────────── Main ─────────── */

const browser = await chromium.launch();
const scrapers = [
  { name: "DraftKings", fn: scrapeDraftKingsPlayerProps },
  { name: "Polymarket", fn: scrapePolymarketPlayerProps },
];
const results = await Promise.allSettled(
  scrapers.map((s) => withinTimeout(s.fn(browser), PER_SOURCE_TIMEOUT_MS, s.name))
);
await browser.close();

const sources = [];
const unreachable = [];
results.forEach((r, i) => {
  const name = scrapers[i].name;
  if (r.status === "fulfilled") {
    const v = r.value;
    sources.push(v);
    console.log(`✓ ${name}: ${Object.keys(v.topScorer).length} top-scorer, ${Object.keys(v.anytimeScorer).length} anytime`);
  } else {
    const reason = r.reason?.message || String(r.reason);
    unreachable.push({ name, reason });
    console.log(`✗ ${name}: ${reason}`);
  }
});

if (sources.length === 0) {
  console.error("No sources succeeded — keeping previous snapshot.");
  process.exit(1);
}

const topScorer = aggregateMarket(sources, "topScorer");
const anytimeScorer = aggregateMarket(sources, "anytimeScorer");

// Preserve any manually-curated entries that the scrapers didn't reach.
// Reading the existing file (if any) and merging by player name.
let existingTop = {};
let existingAny = {};
if (existsSync(OUTPUT_PATH)) {
  try {
    const prev = JSON.parse(readFileSync(OUTPUT_PATH, "utf8"));
    existingTop = prev.topScorer || {};
    existingAny = prev.anytimeScorer || {};
  } catch { /* ignore */ }
}

const mergedTop = { ...existingTop, ...topScorer };
const mergedAny = { ...existingAny, ...anytimeScorer };

const snapshot = {
  asOf: SNAPSHOT_DATE,
  fetchedAt: new Date().toISOString(),
  sources: sources.map((s) => s.source),
  unreachable,
  coverage: {
    topScorer: { players: Object.keys(mergedTop).length, books: sources.filter((s) => Object.keys(s.topScorer).length > 0).length },
    anytimeScorer: { players: Object.keys(mergedAny).length, books: sources.filter((s) => Object.keys(s.anytimeScorer).length > 0).length },
  },
  honestNote: "Auto-scraped from DraftKings + Polymarket. FanDuel/Pinnacle/Bet365 geo-blocked from the runner. Players outside the per-book slate are not listed.",
  topScorer: mergedTop,
  anytimeScorer: mergedAny,
};

writeFileSync(OUTPUT_PATH, JSON.stringify(snapshot, null, 2));
console.log(`\nWrote ${OUTPUT_PATH} — top-scorer: ${Object.keys(mergedTop).length}, anytime: ${Object.keys(mergedAny).length}`);
