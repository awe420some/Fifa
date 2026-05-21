# World Cup 2026 — Methodology

A short technical writeup for the forecast at
**https://awe420some.github.io/Fifa/**.
Snapshot date: 2026-05-20.

## TL;DR

We produce a 48-team title-probability distribution for the 2026 World
Cup by Monte-Carlo-simulating the tournament 10 000 times under an
**ensemble** of four sub-models: Elo, Dixon-Coles bivariate Poisson,
a squad-strength delta, and a de-vigged market consensus.
Per-match results are sampled from the ensemble's blended three-outcome
probability; group standings and bracket outcomes are aggregated to
estimate each team's title chance, semi-final chance, and group-survival
chance.

We validate the model against 372 historical matches across
1994–2022 with the Ranked Probability Score, the standard match-outcome
metric in the academic literature.

## 1. Data

| Asset                    | Source                                             | Snapshot   |
|--------------------------|----------------------------------------------------|------------|
| 48 qualified teams + pots| Wikipedia, *2026 FIFA World Cup*                   | 2026-05-20 |
| Elo per team             | Wikipedia mirror of eloratings.net                 | 2026-01-19 |
| Bookmaker odds aggregate | Polymarket + FoxSports + Oddschecker (top-4 only)  | 2026-05-20 |
| 2026 group draw          | Wikipedia, *2026 FIFA World Cup seeding* (Dec 2025) | 2026-05-20 |
| 26-man squad share       | Wikipedia, *2026 FIFA World Cup squads*            | 2026-05-21 |
| Historical matches       | Wikipedia per-group + knockout articles, 1994–2022 | 2026-05-20 |
| Pre-WM Elo per year      | Rounded reconstruction from public archives        | various    |

All snapshots are committed in `data.js` and `data/historical-matches.js`.

## 2. Models

### 2.1 Elo

Win probability of A vs B with home-advantage `H`:

```
P(A wins) = 1 / (1 + 10^(-(eloA - eloB + H) / 400))
```

Expected goals (linear fit calibrated to mean WM scoring):

```
λ = max(0.15, min(5, 1.42 + 0.55 · (eloA - eloB + H) / 400))
```

Per-team home advantage `H = 80` when the team is playing in its
host country, `0` otherwise. Goals are sampled from a Poisson with
mean `λ`. This is the baseline of the ensemble.

References: Elo (1978); eloratings.net methodology;
Hvattum & Arntzen (2010).

### 2.2 Dixon-Coles bivariate Poisson

Per team `i`: attack `α_i` and defense `β_i`. Per match (home `i`, away `j`):

```
λ_home = exp(μ + α_i + β_j + γ)
λ_away = exp(μ + α_j + β_i)
P(X=x, Y=y) = τ(x, y, λ_home, λ_away, ρ) · Pois(x; λ_home) · Pois(y; λ_away)
```

where `τ` applies the low-score correction Dixon & Coles introduced
to fix the independent-Poisson model's underestimation of 0-0 and
1-1 results:

```
τ(0,0) = 1 - λ_home · λ_away · ρ
τ(0,1) = 1 + λ_home · ρ
τ(1,0) = 1 + λ_away · ρ
τ(1,1) = 1 - ρ
τ(x,y) = 1   otherwise
```

`ρ` is constrained to `(-0.4, 0.4)`. Parameters
`α, β, γ, μ, ρ` are fitted by gradient ascent on the weighted
log-likelihood over all 372 historical matches. Time-decay weights
`w_t = exp(-0.06 · (2026 - year))` make 2022 matches count more than
1994 matches, per Dixon & Coles' weighting scheme.

The fit recenters `α` and `β` (mean = 0) every four iterations to
enforce identification. The likelihood typically converges in
60 iterations on this dataset.

References: Dixon & Coles (1997); Karlis & Ntzoufras (2003).

### 2.3 Squad-strength delta

Per team, a "squad-strength index" measures the share of the 26-man
squad playing in a top-5 European league (Premier League, La Liga,
Bundesliga, Serie A, Ligue 1). This is a coarse proxy — a player on
Bayern's bench counts the same as Mbappé — but it correlates
reasonably well with FIFA / Transfermarkt ratings at the team
aggregate level.

The index is mapped to an additive Elo adjustment:

```
δ = clamp(-60, 60, (index - eraMedian) · 100)
```

The adjustment is applied before the Elo and Dixon-Coles models see
the rating. Toggling "Squad strength" off zeroes the delta.

Reference: McHale, Scarf & Folker (2012).

### 2.4 Market consensus

Decimal odds `o` from each bookmaker imply a probability `1/o`.
Summed across all 48 teams these exceed 1 — the bookmaker's "overround"
margin. We de-vig by dividing each prob by the source's total, so each
source's de-vigged probs sum to 1.

Multi-source aggregation takes the per-team median across all
reachable sources, then renormalises. As of 2026-05-20 we have two
working sources: Polymarket and FoxSports (5 of 7 attempted sources
were geo-blocked or client-rendered). Coverage is documented in
`MARKET_ODDS_2026_META`.

The market enters at the tournament-level title-probability stage, not
per match — bookmakers don't publish a complete WM match-by-match book
months in advance. The blend with the Monte-Carlo output is:

```
P̂(team) = (1 - w_market) · P_mc(team) + w_market · P_market(team)
```

with `w_market = 0.30` by default. Toggling "Market consensus" off
sets `w_market = 0`.

References: Forrest, Goddard & Simmons (2005); Constantinou (2019).

### 2.5 Ensemble

Per-match three-outcome probabilities are linearly blended:

```
P_ens(home) = w_elo · P_elo(home) + w_dc · P_dc(home) + w_squad · P_squad(home)
```

`w_squad` activates only when "Squad strength" is toggled on; squad
acts on the Elo branch, so the "squad" weight effectively up-weights
Elo-with-squad relative to vanilla Elo.

Default weights (printed in the dashboard, can be over-ridden by the
backtest weight-fitter): Elo 0.30, DC 0.30, Squad 0.10, Market 0.30.

## 3. Monte-Carlo

For each of `N = 10 000` simulated tournaments:
1. Run the round-robin group stage with the assumed 12-group draw,
   sampling each match's outcome from the ensemble. Group ties resolve
   on points → goal diff → goals for → Elo.
2. Pick the 12 winners + 12 runners-up + 8 best third-placed teams.
3. Place them in the classical 32-slot bracket (1v32, 16v17, 8v25, …)
   by their group rank and ordinary performance.
4. Run R32 → R16 → QF → SF → Final, with knockout ties resolved by an
   Elo-dampened penalty shootout.
5. Record each team's title, finals appearance, semi-final reach,
   quarter-final reach, and group position.

Aggregated to empirical probabilities, this is the "Elo+DC MC" column
in the dashboard. The "Ensemble" column applies the market blend on top.

## 4. Backtest

We replay every historical match in the 372-match dataset with the
fitted model and that year's pre-WM Elo snapshot. For each match we
compute the **Ranked Probability Score**:

```
RPS = (1 / (K - 1)) · Σ_{k=1..K-1} (Σ_{i=1..k} p_i - I{actual ≤ k})²
```

with `K = 3` for the home/draw/away outcome. Lower is better.

We report avg RPS per model (Elo only, Dixon-Coles only, ensemble) per
tournament and aggregated. Calibration is checked by binning matches
by predicted ensemble probability and plotting predicted-vs-observed
win rate.

Reference: Constantinou & Fenton (2012) for RPS in soccer;
Murphy (1969) for the RPS definition.

## 5. Limitations (honest list)

- **Group draw**: official, scraped from Wikipedia's *2026 FIFA World
  Cup seeding* article (Final Draw at the Kennedy Center, Washington
  D.C., 5 December 2025). Cross-checked against MLSSoccer's draw
  results writeup. Every probability is conditional on this exact draw
  and the assumed pot structure.
- **Market sources**: Five of seven attempted bookmaker / prediction
  market sources are blocked from our runtime (Pinnacle 404, Bet365 /
  DraftKings 403/503, Kalshi 429, Smarkets client-rendered SPA,
  William Hill redirect-to-USA-500, Oddschecker top-4 only). We rely on
  the two reachable sources (Polymarket + FoxSports) and a
  partial-Oddschecker cross-check.
- **Squad data**: 15 of 48 teams hadn't announced their preliminary
  squad yet at snapshot time — they get the era-median placeholder
  (zero Elo adjustment). The top-5-league share is a structural proxy,
  not a market-value lookup; a player on the bench counts the same as
  the captain. Transfermarkt is unreachable from our runtime.
- **Pre-WM Elo precision**: historical Elos are rounded to the nearest
  5 (±25 precision). Fine for top-N ranking, not for fine-grained
  log-loss calibration.
- **Player-level state**: injuries and form aren't modelled
  individually. Strength sits at the team-Elo level.
- **Bracket re-fit on what-if**: we don't expose per-match "flip the
  winner" interaction. The Monte-Carlo aggregates over a large enough
  number of paths that single-match flips are statistically absorbed.

## 6. Reproducibility

- All code is plain JavaScript with no build step. Deterministic seeds
  (FNV-1a hash → Mulberry32 PRNG) ensure that identical inputs produce
  identical outputs across reloads and machines.
- All data lives in `data.js` and `data/historical-matches.js` —
  committed JSON-like literals, not live API calls.
- To reproduce a forecast for a different snapshot date, swap the
  values in `ELO_2026`, `MARKET_ODDS_2026`, `SQUAD_INDEX_2026` and
  re-run.

## References

1. Elo, A. E. (1978). *The Rating of Chessplayers, Past and Present.*
   Arco Publishing.
2. Dixon, M. J., & Coles, S. G. (1997). Modelling Association Football
   Scores and Inefficiencies in the Football Betting Market.
   *Journal of the Royal Statistical Society: Series C*, 46(2), 265–280.
3. Karlis, D., & Ntzoufras, I. (2003). Analysis of sports data by using
   bivariate Poisson models. *The Statistician*, 52(3), 381–393.
4. Hvattum, L. M., & Arntzen, H. (2010). Using Elo ratings for match
   result prediction in association football.
   *International Journal of Forecasting*, 26(3), 460–470.
5. Forrest, D., Goddard, J., & Simmons, R. (2005). Odds-setters as
   forecasters: The case of English football.
   *International Journal of Forecasting*, 21(3), 551–564.
6. Constantinou, A. C., & Fenton, N. E. (2012). Solving the
   Problem of Inadequate Scoring Rules for Assessing Probabilistic
   Football Forecast Models. *Journal of Quantitative Analysis in
   Sports*, 8(1).
7. Constantinou, A. C. (2019). Dolores: A model that predicts football
   match outcomes from all over the world. *Machine Learning*, 108,
   49–75.
8. Boshnakov, G., Kharrat, T., & McHale, I. G. (2017). A bivariate
   Weibull count model for forecasting association football scores.
   *International Journal of Forecasting*, 33(2), 458–466.
9. McHale, I. G., Scarf, P. A., & Folker, D. E. (2012). On the
   development of a player performance rating system for the English
   Premier League. *Interfaces*, 42(4), 339–351.
10. Goddard, J. (2005). Regression models for forecasting goals and
    match results in association football.
    *International Journal of Forecasting*, 21(2), 331–340.
11. Murphy, A. H. (1969). On the ranked probability score.
    *Journal of Applied Meteorology*, 8(6), 988–989.
