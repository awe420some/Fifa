---
title: "WM 2026 Forecast — Session Log"
date: 2026-05-21
session-duration: "~3 days of iterations across multiple sessions"
status: "Live, fully instrumented"
tags: [worldcup, forecasting, monte-carlo, dixon-coles, notion, obsidian]
---

# WM 2026 Forecast — Session Log

**Live:** https://awe420some.github.io/Fifa/
**Repo:** https://github.com/awe420some/Fifa
**Methodik:** [`METHODOLOGY.md`](./METHODOLOGY.md)

---

## TL;DR (was es jetzt kann)

Eine statische SPA, die für die WM 2026 eine echte Datenprognose
liefert — kein Vibe-Orakel mehr, sondern ein dokumentiertes
probabilistisches System:

- **48-Team-Format mit echter Dezember-2025-Auslosung** und voller
  104-Match-Fixture-Liste (Wikipedia + offizielle FIFA-Quellen).
- **Ensemble:** Elo + Dixon-Coles + Squad-Strength-Delta + Markt-Konsens
  (Polymarket + FoxSports, logit-mean de-vigged).
- **Monte-Carlo:** 25 000 Turniere pro Recompute, klassisches Bracket-
  Seeding, 8-best-Thirds-Auswahl, 30-min Extra Time mit κ = 0.95,
  Elo-gedämpftes Elfmeterschießen.
- **Kovariaten** (Reise, Zeitzone, Erholung, Klima) aus 16-Venue × 48-
  Capital-Koordinaten + Klima-Normwerten für Juni-Juli.
- **Backtest:** 372 historische Matches 1994–2022 — RPS / Brier / Log-
  Loss pro Modell + Ensemble, Kalibrierungs-Diagramm mit Wilson-95%-
  Intervallen und logit(observed) = a + b·logit(predicted) Fit.
- **Standardabweichung** explizit: MC-SD-Spalte (≈0,2 pp pro Top-Team)
  und optional Total-SD via Bootstrap-Parameter-Unsicherheit (10
  Dixon-Coles-Fits, ~2 min Recompute, weitet CI um Faktor 5).
- **Stage-by-Stage**: P(R32) / P(R16) / P(QF) / P(SF) / P(Final) /
  P(Titel) + Surprise-Index = −log₂(P) pro Team.
- **Fan-Chart** der Titelwahrscheinlichkeit über die Zeit (gefüllt
  von der scrape-odds-GitHub-Action).
- **Methodik-Dokumentation:** METHODOLOGY.md mit Equations, 11 Refs,
  DiD-Worked-Example für den 2010-RSA-Host-Effekt, Limitations-Liste.

---

## Aktuelle Top-3-Prognose (Snapshot 2026-05-21)

| # | Team | P(Titel) | MC-SD | 95% CI | Marktquote |
|---|---|---:|---:|---|---:|
| 1 | Spanien | 14,5 % | 0,22 pp | [14,0; 14,9] | 17,7 % |
| 2 | Frankreich | 12,0 % | 0,21 pp | [11,6; 12,4] | 18,3 % |
| 3 | Argentinien | 10,7 % | 0,20 pp | [10,3; 11,1] | 8,5 % |

Modell-Markt-Korrelation: **0.95**.

---

## Architektur

```
data/
  teams-2026 (48 Nationen mit pot, fifaRank, host-Flag)
  ELO_2026 (Wikipedia-Mirror von eloratings.net, Stand Jan 2026)
  MARKET_ODDS_2026 (Polymarket + FoxSports aggregate)
  GROUPS_2026 (echte Auslosung 5. Dez 2025)
  SQUAD_INDEX_2026 (Top-5-Liga-Anteil je 26-Mann-Kader, 33/48 mit Daten)
  HISTORICAL_KNOCKOUTS (KO-Stage 2006-2022)
  NEW_HISTORICAL_MATCHES (372 Matches, voll 1994-2002 + Gruppen 2006-2022)
  HISTORICAL_ELO (Pre-WM-Snapshots, ±25 gerundet)
  venues-2026.js (16 Stadien mit Lat/Lon/TZ/Klima/Höhe)
  team-bases.js (48 Hauptstädte als Reise-Origin)
  schedule-2026.json (104 Fixtures mit Datum/UTC/Venue/Teams)
  market-snapshot.json (vom GitHub-Action-Scraper)
  title-history.json (täglicher Forecast-Snapshot)

models/
  elo.js (Elo-Math + Poisson-Sampling)
  dixonColes.js (bivariate Poisson mit τ-Korrektur + Bootstrap)
  squad.js (Top-5-Liga-Share → ±60-Elo-Adjustment)
  market.js (De-Vigging + Logit-Mean-Aggregation)
  covariates.js (Reise/TZ/Erholung/Klima → Δlog-λ)
  ensemble.js (Linear-Blend mit RPS-fitted Weights)

predictor.js (Monte-Carlo-Orchestrator, Bootstrap-MC-Wrapper)
app.js (UI + Toggles + Charts)
rng.js (hash32 + mulberry32 für deterministische Simulation)
scripts/scrape-bookmakers.mjs (Playwright-Scraper für Bookmaker-Quoten)
scripts/snapshot-forecast.mjs (Node-Predictor für tägliche Snapshots)
.github/workflows/scrape-odds.yml (Mo 06:00 UTC + Manual)
```

---

## Akademische Referenzen (in der App verlinkt)

1. Elo (1978). *The Rating of Chessplayers, Past and Present.*
2. Dixon & Coles (1997). *Modelling Association Football Scores.* JRSS C.
3. Karlis & Ntzoufras (2003). *Bivariate Poisson for sports.*
4. Hvattum & Arntzen (2010). *Elo for football match prediction.* IJF.
5. Forrest, Goddard, Simmons (2005). *Odds-setters as forecasters.* IJF.
6. Constantinou & Fenton (2012). *Football probabilistic scoring rules.*
7. Constantinou (2019). *Dolores: world-wide football outcomes.*
8. Boshnakov, Kharrat, McHale (2017). *Bivariate Weibull goals model.*
9. McHale, Scarf, Folker (2012). *Player performance rating.*
10. Goddard (2005). *Regression models for football.*
11. Murphy (1969). *Ranked Probability Score.*

---

## Stell-Schrauben für den Nutzer (Live)

- **5 Szenario-Toggles** in der oberen Card: Heimvorteil, Kader-Stärke,
  Dixon-Coles, Marktkonsens, Reise/TZ/Erholung/Klima.
- **Markt-γ-Dropdown** (Power-Methode): 0.9 / 1.0 / 1.1 für
  Favorite-Longshot-Bias-Korrektur.
- **Parameter-Unsicherheit-Toggle** (Bootstrap): rechnet ~2 min im
  Browser, weitet 95%-CI typisch von [14,0; 14,9] auf [12,6; 16,7].
- **Sprachschalter** EN/DE; alle Sektionen lokalisiert.

---

## Offene Punkte (Backlog)

- **GitHub Action**: Erster manueller Run via "Run workflow" auf
  https://github.com/awe420some/Fifa/actions/workflows/scrape-odds.yml
  steht noch aus (oder läuft am ersten Mo 06:00 UTC automatisch).
- **Bookmaker-Sources expandieren**: 5 von 7 Quellen aus dem Claude-
  Code-Runtime geo/bot-geblockt — Playwright-Scraper aus GitHub-Runner
  sollte DraftKings + Kalshi zusätzlich erreichen.
- **Schiedsrichter-Random-Effects**: Refs werden ~2 Wochen pre-WM
  zugewiesen, dann nachziehbar.
- **Voll-Bayesianische Posterior-Propagierung**: Bootstrap deckt
  Parameter-Unsicherheit; PyMC/Stan-Port wäre Overkill für SPA.
- **Höhe als eigene Kovariate**: Höhenadjustment ist im Klima-Term
  implizit — Mexico City Estadio Azteca auf 2240 m wäre eigentlich
  einen separaten β-Term wert.

---

## Wichtige Commits (chronologisch, neueste oben)

- `01a9825` Add SD + Total SD columns and bootstrap toggle
- `0d67b47` Per-match covariates, ET pass, bootstrap, Wilson CIs, fan chart
- `381e3fe` Replace scenario draw with official December-2025 draw
- `445ece1` Playwright odds scraper + stage-by-stage + research-report refinements
- `cb6db13` Multi-model ensemble forecast — Elo + Dixon-Coles + squad + market
- `a7cb82d` Replace seed-decoder novelty with real Elo + Monte-Carlo forecast
- `e858b56` Add GitHub Pages workflow for static deploy
- `f8cd374` Add OG preview, history, what-if mode, date decoder
- `1c60c3f` Add real 2026 group stage, DE locale, share-link, animated reveal
- `f0e2258` Add World Cup Oracle 2026 — hidden-prediction decoder

---

## Methodik in einer Formel (für Obsidian-Notes)

Pro Spiel (Team i daheim vs j auswärts):

$$
\lambda_i = \exp\!\left(\mu + \alpha_i + \beta_j + \gamma_{home} + \delta_{cov,i}\right)
$$

mit Dixon-Coles-τ-Korrektur:

$$
P_{DC}(x,y) = \tau_\rho(x,y;\lambda,\mu)\cdot \text{Pois}(x;\lambda)\cdot \text{Pois}(y;\mu)
$$

Ensemble:

$$
P_{ens}(\text{outcome}) = w_{Elo}\,P_{Elo} + w_{DC}\,P_{DC} + w_{squad}\,P_{Elo+\Delta} \,+ \text{(market blend at title level)}
$$

Bootstrap-Total-SD:

$$
\text{Var}(\hat p) = \underbrace{\mathbb{E}_\theta[\text{Var}(\hat p\mid \theta)]}_{\text{MC-Sampling}} + \underbrace{\text{Var}_\theta(\mathbb{E}[\hat p \mid \theta])}_{\text{Bootstrap}}
$$

---

## Was beim nächsten Mal anfangen

1. Im Browser https://awe420some.github.io/Fifa/ öffnen — alle Toggles
   ausprobieren. Bootstrap-Toggle einmal aktivieren (Geduld: ~2 min)
   um Total-SD zu sehen.
2. METHODOLOGY.md gegen die App-Sektionen quervergleichen.
3. GitHub-Action manuell starten falls nicht schon gelaufen.
4. Falls Bookmaker-Sources noch sparsam sind: Action-Logs prüfen,
   Selektoren in `scripts/scrape-bookmakers.mjs` nachjustieren.

---

*Generiert am 2026-05-21 von Claude Code. Schlaf gut.* 🌙
