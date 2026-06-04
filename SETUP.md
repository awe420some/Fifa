# Setup Guide — Friends & Pools

## Mandatory (5 min)

### 1. Supabase Anonymous Sign-Ins aktivieren

This is the **one toggle** that makes everything work without email/SMTP gefummel.

1. Supabase Dashboard → `wc26` project
2. Linke Sidebar → **Authentication** (Schloss-Icon)
3. **Sign In / Providers** (NOT "Providers" under Auth — exact name varies; look for the providers list)
4. Find **Anonymous** in the list → toggle it **ON**
5. Save

That's it. Friends can now click **"Anonymous login"** on the app — no email, no SMTP, no waiting.

---

## Optional (only if you want email-login working too)

### 2. Custom SMTP via Resend (15 min, if Magic-Link via email is needed)

iCloud + Supabase Built-in SMTP = unreliable. If you want Magic-Link emails to actually arrive, set up Resend (free 100 mails/day):

1. https://resend.com → Sign up
2. Resend Dashboard → "API Keys" → Create → copy `re_...` key
3. Supabase Dashboard → **Project Settings** → **Authentication** → **SMTP Settings**
4. Toggle "Enable Custom SMTP" on, enter:
   ```
   Sender email:    onboarding@resend.dev
   Sender name:     WC 2026
   Host:            smtp.resend.com
   Port:            465
   Username:        resend
   Password:        re_... (your Resend API key)
   ```
5. Save → test in Friends → Email → Send magic link

### 3. Per-Match Bookmaker Odds via The Odds API (optional, 10 min)

For the "Bookies" comparison column in match panels:

1. https://the-odds-api.com → Get API key (free 500 req/mo)
2. GitHub Repo → Settings → Secrets and variables → Actions → New secret `THE_ODDS_API_KEY` → paste key
3. Actions → "Scrape bookmaker odds" → Run workflow → main
4. After ~1 min, `data/match-odds.json` is committed; Vercel redeploys; "Bookies" column appears

---

## Verify End-to-End

After step 1 (Anonymous Sign-In enabled):

1. Open https://fifa-orpin.vercel.app on phone or desktop
2. Tab **Bets & Wallet** → Friends section
3. Click **"Anonymous login"** → you're logged in as `Gast · <8-char-id>`
4. Enter Nickname → click **"Raum erstellen"** → 6-char code appears
5. Share the code with family → they do the same on their device
6. Place bets → leaderboard updates live (WebSocket realtime)
7. Pools-section: payment-handles eintragen + Bracket/CTP/P&L pool starten

If anything's not working: open DevTools (F12) → Console → look for `Anonymous sign-in failed:` messages; usually a misconfiguration in Supabase Sign In / Providers.
