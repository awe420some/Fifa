// Vercel Edge Function — /api/live
//
// Returns a normalized live-match snapshot for the 2026 World Cup. Called
// both by the dashboard's 30-second browser polling and by the Vercel cron
// (every 5 minutes, see vercel.json) so the edge cache always has a warm,
// recent entry.
//
// Configure via Vercel project ENV vars:
//   LIVE_PROVIDER = "football-data" | "none"     (default "none")
//   LIVE_API_KEY  = your football-data.org API token
//
// With LIVE_PROVIDER unset, this returns { status: "no-source", matches: [] }
// gracefully — the dashboard's freshness banner then shows
// "Live-Mode pending — no source configured yet" honestly.

export const config = { runtime: "edge" };

const WC_START = "2026-06-11";
const WC_END   = "2026-07-19";

export default async function handler() {
  const provider = (typeof process !== "undefined" && process.env?.LIVE_PROVIDER) || "none";
  const apiKey   = (typeof process !== "undefined" && process.env?.LIVE_API_KEY)  || "";

  let payload;
  try {
    if (provider === "football-data" && apiKey) {
      payload = await fetchFootballData(apiKey);
    } else {
      payload = { status: "no-source", matches: [] };
    }
  } catch (err) {
    payload = { status: "error", error: String(err?.message || err), matches: [] };
  }

  return new Response(
    JSON.stringify({
      asOf: new Date().toISOString(),
      provider,
      ...payload,
    }),
    {
      headers: {
        "content-type": "application/json",
        // 30 s edge cache so concurrent visitors share one upstream call.
        "cache-control": "public, s-maxage=30, stale-while-revalidate=60",
      },
    },
  );
}

// football-data.org free-tier integration. The competition code for the
// FIFA World Cup is "WC". Free tier is 10 req/min, 100 req/day — fine when
// combined with the 30-second edge cache + Vercel cron sharing the same
// response.
async function fetchFootballData(apiKey) {
  const url = `https://api.football-data.org/v4/competitions/WC/matches?dateFrom=${WC_START}&dateTo=${WC_END}`;
  const resp = await fetch(url, {
    headers: { "X-Auth-Token": apiKey, accept: "application/json" },
  });
  if (!resp.ok) {
    return { status: "upstream-error", code: resp.status, matches: [] };
  }
  const json = await resp.json();
  const matches = (json?.matches || []).map((m) => normaliseFootballDataMatch(m));
  return { status: "ok", matches };
}

function normaliseFootballDataMatch(m) {
  // football-data.org status: SCHEDULED | LIVE | IN_PLAY | PAUSED | FINISHED |
  // POSTPONED | SUSPENDED | CANCELLED. Map to a small enum.
  const liveStates = new Set(["LIVE", "IN_PLAY", "PAUSED"]);
  let status = "scheduled";
  if (liveStates.has(m.status)) status = "live";
  else if (m.status === "FINISHED") status = "finished";
  return {
    matchNo: m.id,
    kickoffUTC: m.utcDate,
    status,
    teamA: m.homeTeam?.tla || m.homeTeam?.name || "",
    teamB: m.awayTeam?.tla || m.awayTeam?.name || "",
    scoreA: m.score?.fullTime?.home ?? m.score?.halfTime?.home ?? 0,
    scoreB: m.score?.fullTime?.away ?? m.score?.halfTime?.away ?? 0,
    minute: m.minute || null,
    events: [],
  };
}
