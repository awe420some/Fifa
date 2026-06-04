# Spec: Echtgeld-Pools — Tipps sichtbar + Rangliste (2026-06-04)

## Problem
Brians Pools (Buy-in, echter Einsatz) zeigen die Tipps der Mitglieder nicht und haben
keine klare Rangliste. Champion-/Score-Tipps sind in einer versteckten Dropdown-UI; die
Pool-Typen sind verwirrend (sein Pool „CHAMPION" war versehentlich Typ **P&L** → gar keine
Champion-Tipp-UI sichtbar).

## Entscheidung (Brian)
- **Alles mit Einsatz** (kein Gratis-/Spaß-Teil). Das bestehende Pool-System
  (`pools` + `pool_predictions` + `pool_members`, Buy-in) ist die Basis — **kein Neubau**.
- **Winner-takes-all** (kein Pot-Split).
- 3 Modi pro Pool bleiben: **Weltmeister** (`bracket`), **Ergebnis-Tippen** (`ctp`),
  **Quoten-Wetten** (`pnl`).

## Scope

**Etappe 1 — Sichtbarkeit (schnell, der Haupt-Schmerz):**
1. **Rangliste** — Pool-Mitglieder nach Score absteigend sortiert, mit Platz (1./2./3.),
   Krone für Platz 1.
2. **Tipps der anderen sichtbar** — pro Mitglied sein Champion-Tipp bzw. seine Score-Tipps
   direkt in der Mitglieder-Tabelle (nicht nur die eigene Pick-UI).
3. **Pool-Typ klarer** — Beschriftung beim Erstellen, was jeder Modus bedeutet.

**Etappe 2 — Tipp-UX (danach):**
4. Champion-/Spiel-Tipp prominenter in der Pool-Card (übersichtlicher als das versteckte
   Dropdown).

## Nicht im Scope (YAGNI)
Keine neue Tabelle · kein kostenloses Tippspiel · kein Pot-Split · kein Chat ·
keine Player-Props.

## Kern-Dateien
- `app.js`: `renderPools` (3213), `membersTable` (3254), `picksBlock` (3299),
  `loadActivePools` (2970). Tipps liegen bereits in `state.poolPredictions` — nur nie für
  andere gerendert.
- `data.js`: `pools`-i18n-Sektion (en + de).

## Verifikation
- Pool mit ≥2 Mitgliedern + Tipps → Tabelle zeigt beide, sortiert nach Score, mit Platz +
  Tipp-Spalte.
- Pool-Typ-Beschriftung verständlich.
- Deploy → Brian sieht im echten Pool die Tipps der anderen + die Rangliste.
