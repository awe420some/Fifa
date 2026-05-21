#!/usr/bin/env node
// Headless-browser scraper for 2026 World Cup winner odds.
// Runs in CI via the scrape-odds.yml workflow. Hits each bookmaker site
// in a fresh Chromium instance, extracts the top-team prices, and writes
// the aggregated snapshot to data/market-snapshot.json.
//
// Sources are scraped in parallel with per-source timeouts. Failures
// fall through silently — the snapshot's `sources` array records what
// succeeded and `unreachable` records what didn't, with reasons.

import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SNAPSHOT_DATE = new Date().toISOString().slice(0, 10);
const OUTPUT_PATH = resolve(process.cwd(), "data/market-snapshot.json");
const PER_SOURCE_TIMEOUT_MS = 60_000;

// Maps the raw team strings each site uses to our FIFA codes.
const NAME_TO_CODE = {
  // English long names
  "Spain": "ESP", "France": "FRA", "England": "ENG", "Brazil": "BRA",
  "Argentina": "ARG", "Portugal": "POR", "Germany": "GER", "Netherlands": "NED",
  "Belgium": "BEL", "Italy": "ITA", "Croatia": "CRO", "Morocco": "MAR",
  "Colombia": "COL", "Uruguay": "URU", "Switzerland": "SUI", "Japan": "JPN",
  "Senegal": "SEN", "Iran": "IRN", "Ecuador": "ECU", "Austria": "AUT",
  "South Korea": "KOR", "Korea Republic": "KOR", "Australia": "AUS",
  "Norway": "NOR", "Panama": "PAN", "Egypt": "EGY", "Algeria": "ALG",
  "Scotland": "SCO", "Paraguay": "PAR", "Tunisia": "TUN",
  "Ivory Coast": "CIV", "Côte d'Ivoire": "CIV", "Cote d'Ivoire": "CIV",
  "Uzbekistan": "UZB", "Qatar": "QAT", "Saudi Arabia": "KSA", "South Africa": "RSA",
  "Jordan": "JOR", "Cape Verde": "CPV", "Ghana": "GHA", "Curaçao": "CUW",
  "Curacao": "CUW", "Haiti": "HAI", "New Zealand": "NZL", "Iraq": "IRQ",
  "DR Congo": "COD", "Democratic Republic of the Congo": "COD",
  "Bosnia and Herzegovina": "BIH", "Bosnia": "BIH",
  "Czech Republic": "CZE", "Czechia": "CZE",
  "Sweden": "SWE", "Turkey": "TUR", "Türkiye": "TUR", "Turkiye": "TUR",
  "Mexico": "MEX", "United States": "USA", "USA": "USA", "Canada": "CAN",
};

function toCode(name) {
  if (!name) return null;
  const trim = name.trim();
  if (NAME_TO_CODE[trim]) return NAME_TO_CODE[trim];
  // Fuzzy fallback: try removing prefix "the ", "FC ", etc.
  const stripped = trim.replace(/^(the\s+|fc\s+)/i, "");
  if (NAME_TO_CODE[stripped]) return NAME_TO_CODE[stripped];
  return null;
}

function withinTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout: ${label}`)), ms)),
  ]);
}

/* ─────────── Per-source scrapers ─────────── */

async function scrapePolymarket(browser) {
  // Polymarket's outcome book is rendered into the DOM after hydration.
  // We use the public site URL and read the outcomes from the visible cards.
  const ctx = await browser.newContext({ userAgent: ua() });
  const page = await ctx.newPage();
  await page.goto("https://polymarket.com/event/2026-fifa-world-cup-winner-595", {
    waitUntil: "networkidle", timeout: 45000,
  });
  // Outcome rows usually contain a price like "18.2¢" or "0.182" with the team name nearby.
  const rows = await page.$$eval('[role="row"], li, div[data-testid="outcome"]', (els) =>
    els.map((el) => el.textContent.trim()).filter((t) => /\d/.test(t)).slice(0, 50)
  );
  await ctx.close();
  const odds = {};
  for (const r of rows) {
    const m = r.match(/^(.+?)\s+(?:Yes\s+)?(\d+(?:\.\d+)?)¢/);
    if (m) {
      const code = toCode(m[1]);
      const p = parseFloat(m[2]) / 100;
      if (code && p > 0 && p < 1) odds[code] = p;
    }
  }
  if (Object.keys(odds).length < 5) throw new Error("polymarket: parsed fewer than 5 outcomes");
  return { source: "Polymarket", url: "https://polymarket.com/event/2026-fifa-world-cup-winner-595", odds };
}

async function scrapeKalshi(browser) {
  // Kalshi's public JSON API. Tries the elections-style + the regular API.
  const ctx = await browser.newContext({ userAgent: ua() });
  const page = await ctx.newPage();
  const tryUrls = [
    "https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=KXWORLDCUP&limit=200",
    "https://api.elections.kalshi.com/trade-api/v2/markets?event_ticker=KXWC&limit=200",
    "https://trading-api.kalshi.com/trade-api/v2/markets?series_ticker=KXWORLDCUP&limit=200",
  ];
  let data = null;
  for (const u of tryUrls) {
    try {
      const resp = await page.goto(u, { waitUntil: "load", timeout: 20000 });
      const body = await resp.text();
      const parsed = JSON.parse(body);
      if (parsed?.markets?.length) { data = parsed; break; }
    } catch { /* try next */ }
  }
  await ctx.close();
  if (!data) throw new Error("kalshi: no markets returned");
  const odds = {};
  for (const m of data.markets) {
    const name = m.yes_subtitle || m.subtitle || m.title;
    const p = (m.last_price ?? m.yes_bid ?? 0) / 100;
    const code = toCode(name);
    if (code && p > 0 && p < 1) odds[code] = p;
  }
  if (Object.keys(odds).length < 5) throw new Error("kalshi: too few teams parsed");
  return { source: "Kalshi", url: tryUrls[0], odds };
}

async function scrapeDraftKings(browser) {
  const ctx = await browser.newContext({ userAgent: ua() });
  const page = await ctx.newPage();
  await page.goto("https://sportsbook.draftkings.com/leagues/soccer/world-cup", {
    waitUntil: "domcontentloaded", timeout: 30000,
  });
  // Outright winner table — selectors change frequently; use a tolerant scan.
  const items = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll("a,div").forEach((el) => {
      const t = el.textContent;
      if (!t) return;
      // Patterns like "Spain +500" or "France +550"
      const m = t.match(/^([A-Z][A-Za-zÀ-ÿ\s'-]+)\s+([+\-]\d{3,5})$/);
      if (m) out.push({ name: m[1].trim(), american: parseInt(m[2], 10) });
    });
    return out;
  });
  await ctx.close();
  const odds = {};
  for (const it of items) {
    const code = toCode(it.name);
    if (!code) continue;
    // American → decimal → implied prob
    const decimal = it.american > 0 ? 1 + it.american / 100 : 1 + 100 / Math.abs(it.american);
    odds[code] = 1 / decimal;
  }
  if (Object.keys(odds).length < 5) throw new Error("draftkings: too few teams");
  return { source: "DraftKings", url: "https://sportsbook.draftkings.com/leagues/soccer/world-cup", odds };
}

async function scrapeOddschecker(browser) {
  const ctx = await browser.newContext({ userAgent: ua() });
  const page = await ctx.newPage();
  await page.goto("https://www.oddschecker.com/football/world-cup/winner", {
    waitUntil: "networkidle", timeout: 30000,
  });
  await page.waitForTimeout(2000);
  // Best-odds column is rendered after hydration.
  const rows = await page.$$eval("tr, [data-testid*='row']", (els) =>
    els.map((el) => el.textContent.trim()).filter((t) => /\d/.test(t)).slice(0, 80)
  );
  await ctx.close();
  const odds = {};
  for (const r of rows) {
    // Patterns like "Spain 5/1" or "France 11/2" or "Spain 6.00"
    const fractional = r.match(/^(.+?)\s+(\d+)\/(\d+)/);
    const decimal = r.match(/^(.+?)\s+(\d+\.\d{1,2})$/);
    let name = null, dec = null;
    if (fractional) {
      name = fractional[1];
      dec = 1 + parseInt(fractional[2], 10) / parseInt(fractional[3], 10);
    } else if (decimal) {
      name = decimal[1]; dec = parseFloat(decimal[2]);
    }
    if (!name || !dec) continue;
    const code = toCode(name);
    if (code && dec > 1) odds[code] = 1 / dec;
  }
  if (Object.keys(odds).length < 4) throw new Error("oddschecker: too few teams");
  return { source: "Oddschecker", url: "https://www.oddschecker.com/football/world-cup/winner", odds };
}

function ua() {
  return "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";
}

/* ─────────── De-vigging + logit-mean aggregation ─────────── */

function deVig(odds) {
  const total = Object.values(odds).reduce((s, p) => s + p, 0);
  if (total === 0) return {};
  const out = {};
  for (const [k, v] of Object.entries(odds)) out[k] = v / total;
  return out;
}

const logit = (p) => Math.log(p / (1 - p));
const expit = (x) => 1 / (1 + Math.exp(-x));

function logitMean(probs) {
  if (probs.length === 0) return 0;
  const m = probs.map((p) => logit(Math.max(1e-6, Math.min(1 - 1e-6, p)))).reduce((a, b) => a + b, 0) / probs.length;
  return expit(m);
}

function aggregate(sources) {
  const teams = new Set();
  const devigged = sources.map((s) => deVig(s.odds));
  for (const d of devigged) for (const k of Object.keys(d)) teams.add(k);
  const out = {};
  for (const code of teams) {
    const vals = devigged.map((d) => d[code]).filter((v) => v != null && v > 0 && v < 1);
    if (vals.length === 0) continue;
    out[code] = logitMean(vals);
  }
  // Renormalize so probabilities sum to 1.
  const total = Object.values(out).reduce((s, v) => s + v, 0);
  if (total > 0) for (const k of Object.keys(out)) out[k] /= total;
  return out;
}

/* ─────────── Main ─────────── */

const browser = await chromium.launch();
const scrapers = [
  { name: "Polymarket", fn: scrapePolymarket },
  { name: "Kalshi", fn: scrapeKalshi },
  { name: "DraftKings", fn: scrapeDraftKings },
  { name: "Oddschecker", fn: scrapeOddschecker },
];
const results = await Promise.allSettled(
  scrapers.map((s) => withinTimeout(s.fn(browser), PER_SOURCE_TIMEOUT_MS, s.name))
);
await browser.close();

const sources = [];
const unreachable = [];
results.forEach((r, i) => {
  const name = scrapers[i].name;
  if (r.status === "fulfilled" && Object.keys(r.value.odds).length > 0) {
    sources.push({
      name: r.value.source,
      url: r.value.url,
      teams: Object.keys(r.value.odds).length,
      odds: r.value.odds,
    });
    console.log(`✓ ${name}: ${Object.keys(r.value.odds).length} teams`);
  } else {
    const reason = r.status === "rejected" ? r.reason?.message || String(r.reason) : "empty";
    unreachable.push({ name, reason });
    console.log(`✗ ${name}: ${reason}`);
  }
});

const aggregated = aggregate(sources);
const snapshot = {
  asOf: SNAPSHOT_DATE,
  fetchedAt: new Date().toISOString(),
  sources,
  unreachable,
  aggregated,
  method: "Per-source de-vigging (uniform) + logit-mean across sources + final renormalization",
};
writeFileSync(OUTPUT_PATH, JSON.stringify(snapshot, null, 2));
console.log(`\nWrote ${OUTPUT_PATH} — ${sources.length} source(s), ${Object.keys(aggregated).length} teams aggregated`);
if (sources.length === 0) {
  console.error("No sources succeeded — keeping previous snapshot.");
  process.exit(1);
}
