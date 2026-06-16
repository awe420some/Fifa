---
title: WC26 / Brian Bet Brothers — Redesign & Performance Overhaul
date: 2026-06-15
branch: redesign/wc26-overhaul
status: in-progress
---

# WC26 Redesign — Design & Implementation Spec

## Problem (vom Nutzer)
Die App ist **unübersichtlich**, man **muss suchen**, die Darstellung ist **nicht
verständlich**, und sie **läuft langsam**. Konkret vermisst: die Per-Match-Prognose
(vorhergesagtes Ergebnis, Torschützen, Tor-Timing) ist nicht sichtbar — sie steckt
3 Klicks tief im „Schedule"-Tab.

## Aktueller Stand (Ist-Architektur)
- Vanilla-JS-SPA, **kein Bundler**, native ES-Module (`<script type="module">`).
- `app.js` ≈ 200 KB Monolith, `data.js` 62 KB, `styles.css` 53 KB — unminifiziert.
- `runEnsembleMonteCarlo(...)` in `predictor.js` läuft **synchron im Haupt-Thread**
  (10 000 Iterationen beim Laden; Scenario-Recompute erneut). Blockiert die UI.
- Player-Predictions: ~30 s on-demand.
- `models/matchForecast.js` liefert pro Spiel bereits: predicted scoreline (Modus der
  Dixon-Coles-Verteilung via `forecastScore`), 1X2, λ/xG, Top-Torschützen (%),
  Top-Assists, Tor-Zeit-Bins (`GOAL_MINUTE_BINS`). → Datenseite ist fertig, nur vergraben.
- `scripts/snapshot-forecast.mjs` rechnet den Forecast in Node (25 000 Iter.), schreibt
  aber NUR `data/title-history.json` + nutzt `data/market-snapshot.json`.
- Deploy: Vercel, `main` = live (`fifa-orpin.vercel.app`), stündliche GitHub-Action.

## Designentscheidungen
1. **Kein Bundler einführen.** Module bleiben nativ; `app.js` wird in fokussierte
   ES-Module zerlegt — kein neues Tooling, kein Build-Risiko.
2. **Snapshot-first vor Live-Compute.** Vorberechnetes JSON sofort rendern; Worker
   rechnet nur bei Pro-Modus-Änderungen nach.
3. **Progressive Disclosure.** Klartext per Default (Einfach), Fachjargon hinter „Pro".
4. **Branch + Preview pro Phase.** Nichts auf `main` ohne Abnahme.

## Phasen

### Phase 1 — Performance
- **1a Web Worker:** `runEnsembleMonteCarlo` (+ Bootstrap) in `forecast.worker.js`
  auslagern (importiert `predictor.js`/`data.js` als Modul-Worker). app.js postet
  Optionen, erhält serialisierbares MC-Ergebnis. UI bleibt sofort bedienbar.
  Loading-Card → echter Fortschritt statt Freeze.
- **1b Snapshot-first:** `snapshot-forecast.mjs` schreibt zusätzlich
  `data/forecast-snapshot.json` (top3, distribution, stages, groups, market-summary,
  + pro Spiel die `matchForecast`-Felder). Browser lädt das Snapshot-JSON und rendert
  sofort; Worker-Recompute nur bei Scenario-Änderung. GitHub-Action committet das JSON.
- **1c Assets:** große PNGs → WebP (mit PNG-Fallback für OG/Social/Icons), `loading="lazy"`.

### Phase 2 — Prognose nach vorne
- Predicted scoreline + Torschützen-% + Tor-Timing aus Tab 4 → Übersicht + jede Spielzeile.
- „Heute / nächstes Spiel"-Karte auf der Übersicht, automatisch mit Detail-Panel.
- Match-Detail-Ansicht aufgeräumt (Layout wie das freigegebene Mockup).

### Phase 3 — Informationsarchitektur
- 7 Tabs → 5 Klartext-Bereiche (Übersicht · Spiele · Quoten · Spieler · Wetten & Freunde),
  Methodik dezent.
- **Einfach/Pro-Umschalter** (versteckt Dixon-Coles/γ/Bootstrap/Kovariaten im Einfach-Modus).
- Echte Suche (Team/Spieler/Spiel).

### Phase 4 — Politur
- Konsistenz, Touch-Targets ≥44px, Kontrast 4.5:1, `prefers-reduced-motion`,
  Fokus-States, sauberes Grün/Dark.

## Verifikation
- Lokaler Static-Server; App muss laden (Login-Gate, Dashboard, Tabs, Match-Panel).
- Nach jeder Phase: Playwright-Smoke (lädt? rendert Übersicht? Match-Panel öffnet?).
- Modell-Output vor/nach Worker-Umzug identisch (gleicher Seed → gleiche Zahlen).

## Risiken
- MC nutzt seeded RNG (`rng.js`) — Worker muss denselben Seed/Determinismus wahren.
- Service Worker cached Assets — Cache-Version bei Asset-/JS-Änderungen hochziehen.
- Auth-Gate (Supabase) darf nie hinter dem Forecast warten (ist heute schon entkoppelt).
