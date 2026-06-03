#!/usr/bin/env node
// Per-match betting odds scraper for the 2026 World Cup.
//
// Hits The Odds API (https://the-odds-api.com) — one REST call returns
// every booked match × {h2h, totals, btts} × all configured bookmakers.
// Free tier: 500 req/month. Workflow runs hourly, so one call per hour
// = 720/month — keep that in mind if you upgrade to the paid tier.
//
// Joins provider events to our internal matchNo (1–104) via the same
// (kickoffUTC, sorted team-pair) key that buildLiveScheduleMap uses on
// the client.
//
// Writes data/match-odds.json with the de-vigged + logit-mean aggregated
// odds per matchNo. Failure modes are silent (exit 0) so the rest of
// the cron continues to run; the app falls back to model-only odds when
// the file is absent or stale.

import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const OUTPUT_PATH = resolve(process.cwd(), "data/match-odds.json");
const SCHEDULE_PATH = resolve(process.cwd(), "data/schedule-2026.json");
const SPORT = "soccer_fifa_world_cup";
const REGIONS = "eu,uk,us";
const MARKETS = "h2h,totals,btts";
const ODDS_FORMAT = "decimal";

const API_KEY = process.env.THE_ODDS_API_KEY || "";
const FETCH_TIMEOUT_MS = 30_000;

function logitMean(values) {
  const eps = 1e-6;
  const ls = values.filter((p) => Number.isFinite(p) && p > eps && p < 1 - eps).map((p) => Math.log(p / (1 - p)));
  if (!ls.length) return null;
  const mean = ls.reduce((a, b) => a + b, 0) / ls.length;
  return 1 / (1 + Math.exp(-mean));
}

function devig(probs) {
  // probs is an object of named outcomes summing > 1 (bookmaker overround).
  // Normalise so they sum to 1.
  let s = 0;
  for (const k of Object.keys(probs)) if (Number.isFinite(probs[k])) s += probs[k];
  if (s <= 0) return probs;
  const out = {};
  for (const k of Object.keys(probs)) out[k] = Number.isFinite(probs[k]) ? probs[k] / s : null;
  return out;
}

function pairKey(a, b) {
  return [a, b].sort().join(":");
}

// Map ISO country / league names to the 3-letter TLA codes we use
// internally. The Odds API returns "home_team" / "away_team" as full
// country names — we need to look up by name OR by short code.
function buildScheduleIndex(schedule) {
  // We don't have a name→code map in this script; instead, use the
  // schedule's own teamA/teamB (which are TLA codes pre-tournament) and
  // their kickoffUTC. The join key is (kickoffUTC, sorted-team-pair).
  // For The Odds API events, we also build an alternative key by their
  // commenced_time and team names — matched in two passes.
  const byKey = new Map();
  for (const s of schedule) {
    if (!s.kickoffUTC || !s.teamA || !s.teamB) continue;
    byKey.set(`${s.kickoffUTC}|${pairKey(s.teamA, s.teamB)}`, s.matchNo);
  }
  return byKey;
}

// Loose name → code lookup. Extend as needed; absent mapping means
// the event is skipped for the join attempt.
const NAME_TO_TLA = {
  "Mexico": "MEX", "Canada": "CAN", "United States": "USA",
  "Argentina": "ARG", "Brazil": "BRA", "France": "FRA", "Spain": "ESP",
  "England": "ENG", "Germany": "GER", "Portugal": "POR", "Netherlands": "NED",
  "Belgium": "BEL", "Croatia": "CRO", "Italy": "ITA", "Switzerland": "SUI",
  "Austria": "AUT", "Norway": "NOR", "Sweden": "SWE", "Turkey": "TUR",
  "Czech Republic": "CZE", "Bosnia and Herzegovina": "BIH", "Scotland": "SCO",
  "Colombia": "COL", "Ecuador": "ECU", "Uruguay": "URU", "Paraguay": "PAR",
  "Australia": "AUS", "Iran": "IRN", "Iraq": "IRQ", "Japan": "JPN",
  "Jordan": "JOR", "Qatar": "QAT", "Saudi Arabia": "KSA", "South Korea": "KOR",
  "Korea Republic": "KOR", "Uzbekistan": "UZB",
  "Algeria": "ALG", "Cape Verde": "CPV", "DR Congo": "COD", "Egypt": "EGY",
  "Ghana": "GHA", "Ivory Coast": "CIV", "Morocco": "MAR", "Senegal": "SEN",
  "South Africa": "RSA", "Tunisia": "TUN",
  "Curaçao": "CUW", "Haiti": "HAI", "Panama": "PAN", "New Zealand": "NZL",
};

function eventToTla(name) {
  return NAME_TO_TLA[name] || NAME_TO_TLA[name?.trim()] || null;
}

async function fetchOdds() {
  const url = `https://api.the-odds-api.com/v4/sports/${SPORT}/odds?regions=${REGIONS}&markets=${MARKETS}&oddsFormat=${ODDS_FORMAT}&apiKey=${API_KEY}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
    }
    return await resp.json();
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

function aggregateEvent(ev) {
  // Per-bookmaker aggregation: dev-vig, then logit-mean across books.
  const perBookmaker = {};
  const collect = { home: [], draw: [], away: [], over25: [], under25: [], btts_yes: [], btts_no: [] };
  for (const bk of (ev.bookmakers || [])) {
    const entry = {};
    for (const mk of (bk.markets || [])) {
      if (mk.key === "h2h" && Array.isArray(mk.outcomes)) {
        const o = {};
        for (const out of mk.outcomes) {
          if (out.name === ev.home_team) o.home = 1 / out.price;
          else if (out.name === ev.away_team) o.away = 1 / out.price;
          else if (out.name === "Draw") o.draw = 1 / out.price;
        }
        const d = devig(o);
        if (d.home != null && d.away != null && d.draw != null) {
          entry.home = d.home; entry.draw = d.draw; entry.away = d.away;
          collect.home.push(d.home); collect.draw.push(d.draw); collect.away.push(d.away);
        }
      } else if (mk.key === "totals" && Array.isArray(mk.outcomes)) {
        for (const out of mk.outcomes) {
          if (out.point === 2.5 && out.name === "Over")  entry.over25  = 1 / out.price;
          if (out.point === 2.5 && out.name === "Under") entry.under25 = 1 / out.price;
        }
        if (entry.over25 != null && entry.under25 != null) {
          const d = devig({ over25: entry.over25, under25: entry.under25 });
          entry.over25 = d.over25; entry.under25 = d.under25;
          collect.over25.push(d.over25); collect.under25.push(d.under25);
        }
      } else if (mk.key === "btts" && Array.isArray(mk.outcomes)) {
        for (const out of mk.outcomes) {
          if (out.name === "Yes") entry.btts_yes = 1 / out.price;
          if (out.name === "No")  entry.btts_no  = 1 / out.price;
        }
        if (entry.btts_yes != null && entry.btts_no != null) {
          const d = devig({ btts_yes: entry.btts_yes, btts_no: entry.btts_no });
          entry.btts_yes = d.btts_yes; entry.btts_no = d.btts_no;
          collect.btts_yes.push(d.btts_yes); collect.btts_no.push(d.btts_no);
        }
      }
    }
    if (Object.keys(entry).length) perBookmaker[bk.key] = entry;
  }
  return {
    home:     logitMean(collect.home),
    draw:     logitMean(collect.draw),
    away:     logitMean(collect.away),
    over25:   logitMean(collect.over25),
    under25:  logitMean(collect.under25),
    btts_yes: logitMean(collect.btts_yes),
    btts_no:  logitMean(collect.btts_no),
    perBookmaker,
  };
}

async function main() {
  if (!API_KEY) {
    console.warn("THE_ODDS_API_KEY not set — skipping match-odds scrape (app uses model-only odds).");
    process.exit(0);
  }
  let schedule;
  try {
    const raw = JSON.parse(readFileSync(SCHEDULE_PATH, "utf8"));
    // schedule-2026.json is { SCHEDULE_2026: [...], notes: ... }
    schedule = Array.isArray(raw) ? raw : (raw.SCHEDULE_2026 || raw.schedule || raw.matches);
    if (!Array.isArray(schedule)) throw new Error("schedule JSON has no array payload");
  } catch (e) {
    console.error("Could not read schedule-2026.json:", e.message);
    process.exit(0);
  }
  const byKey = buildScheduleIndex(schedule);

  let events;
  try {
    events = await fetchOdds();
  } catch (e) {
    console.error("The Odds API fetch failed (continuing with prior snapshot):", e.message);
    process.exit(0);
  }
  if (!Array.isArray(events) || !events.length) {
    console.error("The Odds API returned no events — keeping prior snapshot.");
    process.exit(0);
  }

  const matches = {};
  const allBookmakers = new Set();
  let matched = 0;
  for (const ev of events) {
    const teamA = eventToTla(ev.home_team);
    const teamB = eventToTla(ev.away_team);
    if (!teamA || !teamB || !ev.commence_time) continue;
    const key = `${ev.commence_time}|${pairKey(teamA, teamB)}`;
    const matchNo = byKey.get(key);
    if (matchNo == null) continue;
    const agg = aggregateEvent(ev);
    matches[matchNo] = { teamA, teamB, ...agg };
    matched++;
    for (const bk of (ev.bookmakers || [])) allBookmakers.add(bk.title || bk.key);
  }

  const out = {
    asOf: new Date().toISOString().slice(0, 10),
    fetchedAt: new Date().toISOString(),
    sources: Array.from(allBookmakers).sort(),
    matchCount: matched,
    eventCount: events.length,
    matches,
  };
  writeFileSync(OUTPUT_PATH, JSON.stringify(out, null, 2));
  console.log(`Wrote ${OUTPUT_PATH} — ${matched}/${events.length} events joined to internal matchNo from ${allBookmakers.size} bookmakers.`);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(0);  // never block the rest of the cron pipeline
});
