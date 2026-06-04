# Setup Guide — Friends, Membership & Pools

Die App nutzt ein **zweistufiges Mitglieder-Gate**:

1. **App-Ebene** — du (Admin, `briannothdurft@icloud.com`) gibst jeden neuen User frei, bevor er überhaupt mitspielen darf.
2. **Raum-Ebene** — der jeweilige Raum-Owner gibt app-freigegebene Leute für *seinen* Raum frei.

Login läuft über **Email + Passwort** (kein Anonymous mehr). Die DB-Migration `supabase/migrations/0003_membership.sql` ist bereits angewendet.

---

## Dashboard-Setup (Supabase `wc26`, einmalig, ~15 Min)

Alles im Supabase-Dashboard → Project `wc26` (`kfduunhhjdvxwgzgmhue`).

### 1. Custom SMTP via Resend (PFLICHT — sonst keine Reset-/Magic-Mails)

Der eingebaute Supabase-SMTP ist hart rate-limited (Familie kassiert `429`). Resend ist gratis (100 Mails/Tag):

1. <https://resend.com> → Sign up → **API Keys** → Create → `re_...` kopieren
2. **Project Settings → Authentication → SMTP Settings** → „Enable Custom SMTP" an:
   ```
   Sender email: onboarding@resend.dev   (oder eigene verifizierte Domain)
   Sender name:  WC 2026
   Host:         smtp.resend.com
   Port:         465
   Username:     resend
   Password:     re_...   (dein Resend API-Key)
   ```
3. Save

### 2. Email-Login konfigurieren

**Authentication → Providers → Email:**
- **„Confirm email" → AUS** — deine manuelle Freigabe ersetzt die Email-Bestätigung, der User ist nach Signup sofort (als `pending`) drin.
- **Anonymous-Provider → AUS** — nur echte Member.

### 3. URLs

**Authentication → URL Configuration:**
- Site URL: `https://fifa-orpin.vercel.app`
- Redirect URLs: `https://fifa-orpin.vercel.app/**`

### 4. Passwort-Sicherheit (empfohlen)

**Authentication → Password security → „Leaked password protection" → AN** (blockt via HaveIBeenPwned kompromittierte Passwörter — sinnvoll, da jetzt Passwörter genutzt werden).

---

## Wie das Gate funktioniert

- **Neuer User:** „Mitglied werden" (Name + Email + Passwort) → Account angelegt, `app_status = pending`. Er sieht *„Anfrage gesendet — warte auf Freigabe durch den Admin."*
- **Du (Admin):** im Friends-Tab erscheint „Mitglieds-Anfragen (n)" mit **Freigeben / Ablehnen** (live via Realtime).
- **Freigegebener User:** kann Räume erstellen (→ wird Owner) oder per Code beitreten.
- **Raum-Beitritt:** landet auf `pending`; der Raum-Owner sieht „Beitritts-Anfragen (n)" und gibt frei. Erst dann sieht der Beitretende Leaderboard + Bets.
- **Passwort vergessen:** „Passwort vergessen?" → Reset-Mail (via Resend) → neues Passwort setzen.

Admin = `briannothdurft@icloud.com` (in der Migration geseedet). Weitere Admins: in Supabase `update profiles set is_admin = true where email = '…'`.

---

## Optional: Per-Match Bookmaker Odds (The Odds API, 10 Min)

Für die „Bookies"-Vergleichsspalte in den Match-Panels:

1. <https://the-odds-api.com> → API-Key holen (gratis 500 req/mo)
2. GitHub Repo → Settings → Secrets and variables → Actions → New secret `THE_ODDS_API_KEY` → Key einfügen
3. Actions → „Scrape bookmaker odds" → Run workflow → `main`
4. Nach ~1 Min ist `data/match-odds.json` committed; Vercel redeployt; „Bookies"-Spalte erscheint

---

## Verify End-to-End

Nach dem Dashboard-Setup (Schritte 1–3):

1. <https://fifa-orpin.vercel.app> → Tab **Bets & Wallet** → Friends-Section
2. Mit einer **Zweit-Email** „Mitglied werden" → es erscheint *„Anfrage gesendet"*
3. Als **du** eingeloggt (`briannothdurft@icloud.com`) → „Mitglieds-Anfragen" → **Freigeben**
4. Zweit-Account: **Raum erstellen** → 6-Zeichen-Code; oder bestehendem Raum per Code beitreten → Owner gibt frei
5. Tipps abgeben → Leaderboard updated live (WebSocket-Realtime)
6. Pools-Section: Payment-Handles eintragen + Bracket/CTP/P&L-Pool starten

Wenn etwas klemmt: DevTools (F12) → Console + Supabase → Authentication → Logs (`get_logs auth`) prüfen.
