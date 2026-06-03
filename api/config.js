// Vercel Edge Function — /api/config.js
//
// Returns a tiny script tag that injects window.WC26_SUPABASE = { url, anonKey }
// before app.js loads. Lets us ship the Supabase URL + anon-key without
// committing them to the repo, so different environments (prod / preview /
// local fork) can each point at their own Supabase project.
//
// Configure via Vercel project ENV vars:
//   NEXT_PUBLIC_SUPABASE_URL       https://<project>.supabase.co
//   NEXT_PUBLIC_SUPABASE_ANON_KEY  <anon key from Supabase Settings → API>
//
// With either env unset, the response still 200s with WC26_SUPABASE = null
// so app.js can gracefully hide multiplayer features.

export const config = { runtime: "edge" };

export default async function handler() {
  const url = (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_SUPABASE_URL) || "";
  const anonKey = (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_SUPABASE_ANON_KEY) || "";
  const payload = url && anonKey ? { url, anonKey } : null;
  const body = `window.WC26_SUPABASE = ${JSON.stringify(payload)};`;
  return new Response(body, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      // Short cache so config changes propagate within a minute.
      "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
