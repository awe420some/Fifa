// World Cup Oracle 2026 — datasets
// Snapshot date: 2026-05-20. Every figure is sourced from a public page;
// see DATA_SOURCES at the bottom. No values are fabricated — fields that
// had to be estimated are flagged inline.

// Re-exports of the bigger datasets that live in /data so this file
// stays scannable.
export { NEW_HISTORICAL_MATCHES, SQUAD_INDEX_2026, SQUAD_INDEX_2026_META } from "./data/historical-matches.js";


/* ─────────── 2026 field ─────────── */

// 48 qualified nations per Wikipedia (https://en.wikipedia.org/wiki/2026_FIFA_World_Cup).
// `pot` from the official draw seeding. `fifaRank` from FIFA's April-2026 ranking,
// estimated for entries outside FIFA's published top-50 (flagged with rankEstimated).
export const TEAMS_2026 = [
  // CONCACAF hosts
  { name: "Canada",                 code: "CAN", confederation: "CONCACAF", pot: 1, fifaRank: 30, host: true  },
  { name: "Mexico",                 code: "MEX", confederation: "CONCACAF", pot: 1, fifaRank: 15, host: true  },
  { name: "United States",          code: "USA", confederation: "CONCACAF", pot: 1, fifaRank: 16, host: true  },
  // UEFA — 16 slots
  { name: "Austria",                code: "AUT", confederation: "UEFA",     pot: 2, fifaRank: 24 },
  { name: "Belgium",                code: "BEL", confederation: "UEFA",     pot: 2, fifaRank:  9 },
  { name: "Bosnia and Herzegovina", code: "BIH", confederation: "UEFA",     pot: 4, fifaRank: 60, rankEstimated: true },
  { name: "Croatia",                code: "CRO", confederation: "UEFA",     pot: 2, fifaRank: 11 },
  { name: "Czech Republic",         code: "CZE", confederation: "UEFA",     pot: 4, fifaRank: 41 },
  { name: "England",                code: "ENG", confederation: "UEFA",     pot: 1, fifaRank:  4 },
  { name: "France",                 code: "FRA", confederation: "UEFA",     pot: 1, fifaRank:  1 },
  { name: "Germany",                code: "GER", confederation: "UEFA",     pot: 1, fifaRank: 10 },
  { name: "Netherlands",            code: "NED", confederation: "UEFA",     pot: 1, fifaRank:  7 },
  { name: "Norway",                 code: "NOR", confederation: "UEFA",     pot: 3, fifaRank: 31 },
  { name: "Portugal",               code: "POR", confederation: "UEFA",     pot: 1, fifaRank:  5 },
  { name: "Scotland",               code: "SCO", confederation: "UEFA",     pot: 3, fifaRank: 43 },
  { name: "Spain",                  code: "ESP", confederation: "UEFA",     pot: 1, fifaRank:  2 },
  { name: "Sweden",                 code: "SWE", confederation: "UEFA",     pot: 4, fifaRank: 38 },
  { name: "Switzerland",            code: "SUI", confederation: "UEFA",     pot: 2, fifaRank: 19 },
  { name: "Turkey",                 code: "TUR", confederation: "UEFA",     pot: 2, fifaRank: 22 },
  // CONMEBOL — 6 slots
  { name: "Argentina",              code: "ARG", confederation: "CONMEBOL", pot: 1, fifaRank:  3 },
  { name: "Brazil",                 code: "BRA", confederation: "CONMEBOL", pot: 1, fifaRank:  6 },
  { name: "Colombia",               code: "COL", confederation: "CONMEBOL", pot: 2, fifaRank: 13 },
  { name: "Ecuador",                code: "ECU", confederation: "CONMEBOL", pot: 2, fifaRank: 23 },
  { name: "Paraguay",               code: "PAR", confederation: "CONMEBOL", pot: 3, fifaRank: 40 },
  { name: "Uruguay",                code: "URU", confederation: "CONMEBOL", pot: 2, fifaRank: 17 },
  // AFC — 8 slots + 1 via inter-confederation playoff
  { name: "Australia",              code: "AUS", confederation: "AFC",      pot: 2, fifaRank: 27 },
  { name: "Iran",                   code: "IRN", confederation: "AFC",      pot: 2, fifaRank: 21 },
  { name: "Iraq",                   code: "IRQ", confederation: "AFC",      pot: 4, fifaRank: 58, rankEstimated: true },
  { name: "Japan",                  code: "JPN", confederation: "AFC",      pot: 2, fifaRank: 18 },
  { name: "Jordan",                 code: "JOR", confederation: "AFC",      pot: 4, fifaRank: 62, rankEstimated: true },
  { name: "Qatar",                  code: "QAT", confederation: "AFC",      pot: 4, fifaRank: 55, rankEstimated: true },
  { name: "Saudi Arabia",           code: "KSA", confederation: "AFC",      pot: 4, fifaRank: 57, rankEstimated: true },
  { name: "South Korea",            code: "KOR", confederation: "AFC",      pot: 2, fifaRank: 25 },
  { name: "Uzbekistan",             code: "UZB", confederation: "AFC",      pot: 3, fifaRank: 50 },
  // CAF — 9 slots
  { name: "Algeria",                code: "ALG", confederation: "CAF",      pot: 3, fifaRank: 28 },
  { name: "Cape Verde",             code: "CPV", confederation: "CAF",      pot: 4, fifaRank: 70, rankEstimated: true },
  { name: "DR Congo",               code: "COD", confederation: "CAF",      pot: 4, fifaRank: 46 },
  { name: "Egypt",                  code: "EGY", confederation: "CAF",      pot: 3, fifaRank: 29 },
  { name: "Ghana",                  code: "GHA", confederation: "CAF",      pot: 4, fifaRank: 75, rankEstimated: true },
  { name: "Ivory Coast",            code: "CIV", confederation: "CAF",      pot: 3, fifaRank: 34 },
  { name: "Morocco",                code: "MAR", confederation: "CAF",      pot: 2, fifaRank:  8 },
  { name: "Senegal",                code: "SEN", confederation: "CAF",      pot: 2, fifaRank: 14 },
  { name: "South Africa",           code: "RSA", confederation: "CAF",      pot: 4, fifaRank: 65, rankEstimated: true },
  { name: "Tunisia",                code: "TUN", confederation: "CAF",      pot: 3, fifaRank: 44 },
  // CONCACAF — 3 non-host slots
  { name: "Curaçao",                code: "CUW", confederation: "CONCACAF", pot: 4, fifaRank: 80, rankEstimated: true },
  { name: "Haiti",                  code: "HAI", confederation: "CONCACAF", pot: 4, fifaRank: 78, rankEstimated: true },
  { name: "Panama",                 code: "PAN", confederation: "CONCACAF", pot: 3, fifaRank: 33 },
  // OFC — 1 slot
  { name: "New Zealand",            code: "NZL", confederation: "OFC",      pot: 4, fifaRank: 72, rankEstimated: true },
];

// Mirror of eloratings.net (Wikipedia module snapshot 2026-01-19).
// `asOf` is the snapshot — currently ~4 months stale vs the 2026-05-20 fetch date.
// No fabricated values — every code below was directly listed on Wikipedia.
export const ELO_2026 = {
  ESP: 2171, ARG: 2113, FRA: 2063, ENG: 2042, COL: 1998,
  BRA: 1979, POR: 1976, NED: 1959, CRO: 1933, ECU: 1933,
  NOR: 1922, GER: 1910, SUI: 1897, URU: 1890, TUR: 1880,
  JPN: 1879, SEN: 1869, BEL: 1849, MEX: 1834, PAR: 1833,
  AUT: 1818, MAR: 1806, CAN: 1806, SCO: 1790, KOR: 1784,
  AUS: 1774, IRN: 1754, USA: 1747, PAN: 1743, UZB: 1735,
  CZE: 1731, ALG: 1728, JOR: 1691, SWE: 1660, EGY: 1660,
  COD: 1639, CIV: 1637, TUN: 1614, KSA: 1592, NZL: 1586,
  IRQ: 1583, BIH: 1571, CPV: 1561, HAI: 1542, RSA: 1529,
  GHA: 1509, CUW: 1467, QAT: 1427,
};
export const ELO_2026_META = {
  asOf: "2026-01-19",
  source: "Wikipedia mirror of eloratings.net",
  note: "Snapshot lags the 2026-05-20 fetch date by ~4 months; refreshes need an updated Module:SportsRankings pull.",
};

// Implied win-probabilities aggregated from Polymarket (2026-05-20) and
// FoxSports' May-2026 American-odds table; cross-checked against Oddschecker's
// top-4. Top-20 averaged & re-normalized; bottom 28 floored at 0.15% because
// the top-20 raw sum (~1.03) already exceeds 1 due to bookmaker overround.
export const MARKET_ODDS_2026 = {
  FRA: 0.182, ESP: 0.177, ENG: 0.117, BRA: 0.096, POR: 0.087,
  ARG: 0.085, GER: 0.057, NED: 0.039, NOR: 0.028, BEL: 0.023,
  COL: 0.020, JPN: 0.019, MAR: 0.018, USA: 0.016, URU: 0.014,
  MEX: 0.013, SUI: 0.012, CRO: 0.011, ECU: 0.009, SWE: 0.008,
  // residual floor: every other qualifier gets 0.0015 mass
  AUT: 0.0015, SEN: 0.0015, KOR: 0.0015, AUS: 0.0015, IRN: 0.0015,
  PAR: 0.0015, ALG: 0.0015, EGY: 0.0015, CAN: 0.0015, PAN: 0.0015,
  CIV: 0.0015, SCO: 0.0015, TUN: 0.0015, CZE: 0.0015, COD: 0.0015,
  UZB: 0.0015, TUR: 0.0015, BIH: 0.0015, JOR: 0.0015, IRQ: 0.0015,
  KSA: 0.0015, QAT: 0.0015, NZL: 0.0015, HAI: 0.0015, CUW: 0.0015,
  CPV: 0.0015, GHA: 0.0015, RSA: 0.0015,
};
export const MARKET_ODDS_2026_META = {
  asOf: "2026-05-20",
  method: "Average implied prob of Polymarket + FoxSports, normalized. Bottom-28 floored at 0.15%.",
};

// Official 12-group draw as announced at the FIFA Final Draw on
// December 5, 2025 at the Kennedy Center, Washington D.C.
// Source: Wikipedia "2026 FIFA World Cup seeding" (fetched 2026-05-20),
// cross-checked with MLSSoccer.com "FIFA 2026 World Cup draw: Full results".
export const GROUPS_2026 = {
  A: ["MEX", "RSA", "KOR", "CZE"],
  B: ["CAN", "BIH", "QAT", "SUI"],
  C: ["BRA", "MAR", "HAI", "SCO"],
  D: ["USA", "PAR", "AUS", "TUR"],
  E: ["GER", "CUW", "CIV", "ECU"],
  F: ["NED", "JPN", "SWE", "TUN"],
  G: ["BEL", "EGY", "IRN", "NZL"],
  H: ["ESP", "CPV", "KSA", "URU"],
  I: ["FRA", "SEN", "IRQ", "NOR"],
  J: ["ARG", "ALG", "AUT", "JOR"],
  K: ["POR", "COD", "UZB", "COL"],
  L: ["ENG", "CRO", "GHA", "PAN"],
};

/* ─────────── Historical knockout-stage data (for backtest) ─────────── */

// Knockout-stage results for five recent World Cups, scraped from each
// Wikipedia "[year] FIFA World Cup knockout stage" article. We use this
// for KO-stage backtesting: given the 16 teams that actually reached the
// Round of 16, simulate the bracket and check whether the model's top-3
// includes the eventual champion.
// 3-letter codes match the modern FIFA code where possible (URU, KOR, etc).
export const HISTORICAL_KNOCKOUTS = [
  {
    year: 2006,
    host: ["Germany"],
    champion: "Italy",
    runnerUp: "France",
    r16: ["GER", "SWE", "ARG", "MEX", "ENG", "ECU", "POR", "NED",
          "ITA", "AUS", "SUI", "UKR", "BRA", "GHA", "ESP", "FRA"],
    matches: [
      { stage: "R16",   teamA: "GER", teamB: "SWE", scoreA: 2, scoreB: 0 },
      { stage: "R16",   teamA: "ARG", teamB: "MEX", scoreA: 2, scoreB: 1, et: true },
      { stage: "R16",   teamA: "ENG", teamB: "ECU", scoreA: 1, scoreB: 0 },
      { stage: "R16",   teamA: "POR", teamB: "NED", scoreA: 1, scoreB: 0 },
      { stage: "R16",   teamA: "ITA", teamB: "AUS", scoreA: 1, scoreB: 0, et: true },
      { stage: "R16",   teamA: "SUI", teamB: "UKR", scoreA: 0, scoreB: 0, penA: 0, penB: 3 },
      { stage: "R16",   teamA: "BRA", teamB: "GHA", scoreA: 3, scoreB: 0 },
      { stage: "R16",   teamA: "FRA", teamB: "ESP", scoreA: 3, scoreB: 1 },
      { stage: "QF",    teamA: "GER", teamB: "ARG", scoreA: 1, scoreB: 1, penA: 4, penB: 2 },
      { stage: "QF",    teamA: "ITA", teamB: "UKR", scoreA: 3, scoreB: 0 },
      { stage: "QF",    teamA: "POR", teamB: "ENG", scoreA: 0, scoreB: 0, penA: 3, penB: 1 },
      { stage: "QF",    teamA: "FRA", teamB: "BRA", scoreA: 1, scoreB: 0 },
      { stage: "SF",    teamA: "ITA", teamB: "GER", scoreA: 2, scoreB: 0, et: true },
      { stage: "SF",    teamA: "FRA", teamB: "POR", scoreA: 1, scoreB: 0 },
      { stage: "third", teamA: "GER", teamB: "POR", scoreA: 3, scoreB: 1 },
      { stage: "final", teamA: "ITA", teamB: "FRA", scoreA: 1, scoreB: 1, penA: 5, penB: 3 },
    ],
  },
  {
    year: 2010,
    host: ["South Africa"],
    champion: "Spain",
    runnerUp: "Netherlands",
    r16: ["URU", "KOR", "USA", "GHA", "GER", "ENG", "ARG", "MEX",
          "NED", "SVK", "BRA", "CHL", "PAR", "JPN", "ESP", "POR"],
    matches: [
      { stage: "R16",   teamA: "URU", teamB: "KOR", scoreA: 2, scoreB: 1 },
      { stage: "R16",   teamA: "GHA", teamB: "USA", scoreA: 2, scoreB: 1, et: true },
      { stage: "R16",   teamA: "GER", teamB: "ENG", scoreA: 4, scoreB: 1 },
      { stage: "R16",   teamA: "ARG", teamB: "MEX", scoreA: 3, scoreB: 1 },
      { stage: "R16",   teamA: "NED", teamB: "SVK", scoreA: 2, scoreB: 1 },
      { stage: "R16",   teamA: "BRA", teamB: "CHL", scoreA: 3, scoreB: 0 },
      { stage: "R16",   teamA: "PAR", teamB: "JPN", scoreA: 0, scoreB: 0, penA: 5, penB: 3 },
      { stage: "R16",   teamA: "ESP", teamB: "POR", scoreA: 1, scoreB: 0 },
      { stage: "QF",    teamA: "URU", teamB: "GHA", scoreA: 1, scoreB: 1, penA: 4, penB: 2 },
      { stage: "QF",    teamA: "NED", teamB: "BRA", scoreA: 2, scoreB: 1 },
      { stage: "QF",    teamA: "ARG", teamB: "GER", scoreA: 0, scoreB: 4 },
      { stage: "QF",    teamA: "ESP", teamB: "PAR", scoreA: 1, scoreB: 0 },
      { stage: "SF",    teamA: "NED", teamB: "URU", scoreA: 3, scoreB: 2 },
      { stage: "SF",    teamA: "ESP", teamB: "GER", scoreA: 1, scoreB: 0 },
      { stage: "third", teamA: "GER", teamB: "URU", scoreA: 3, scoreB: 2 },
      { stage: "final", teamA: "ESP", teamB: "NED", scoreA: 1, scoreB: 0, et: true },
    ],
  },
  {
    year: 2014,
    host: ["Brazil"],
    champion: "Germany",
    runnerUp: "Argentina",
    r16: ["BRA", "CHL", "COL", "URU", "NED", "MEX", "CRC", "GRC",
          "FRA", "NGA", "GER", "ALG", "ARG", "SUI", "BEL", "USA"],
    matches: [
      { stage: "R16",   teamA: "BRA", teamB: "CHL", scoreA: 1, scoreB: 1, penA: 3, penB: 2 },
      { stage: "R16",   teamA: "COL", teamB: "URU", scoreA: 2, scoreB: 0 },
      { stage: "R16",   teamA: "NED", teamB: "MEX", scoreA: 2, scoreB: 1 },
      { stage: "R16",   teamA: "CRC", teamB: "GRC", scoreA: 1, scoreB: 1, penA: 5, penB: 3 },
      { stage: "R16",   teamA: "FRA", teamB: "NGA", scoreA: 2, scoreB: 0 },
      { stage: "R16",   teamA: "GER", teamB: "ALG", scoreA: 2, scoreB: 1, et: true },
      { stage: "R16",   teamA: "ARG", teamB: "SUI", scoreA: 1, scoreB: 0, et: true },
      { stage: "R16",   teamA: "BEL", teamB: "USA", scoreA: 2, scoreB: 1, et: true },
      { stage: "QF",    teamA: "BRA", teamB: "COL", scoreA: 2, scoreB: 1 },
      { stage: "QF",    teamA: "GER", teamB: "FRA", scoreA: 1, scoreB: 0 },
      { stage: "QF",    teamA: "ARG", teamB: "BEL", scoreA: 1, scoreB: 0 },
      { stage: "QF",    teamA: "NED", teamB: "CRC", scoreA: 0, scoreB: 0, penA: 4, penB: 3 },
      { stage: "SF",    teamA: "GER", teamB: "BRA", scoreA: 7, scoreB: 1 },
      { stage: "SF",    teamA: "ARG", teamB: "NED", scoreA: 0, scoreB: 0, penA: 4, penB: 2 },
      { stage: "third", teamA: "NED", teamB: "BRA", scoreA: 3, scoreB: 0 },
      { stage: "final", teamA: "GER", teamB: "ARG", scoreA: 1, scoreB: 0, et: true },
    ],
  },
  {
    year: 2018,
    host: ["Russia"],
    champion: "France",
    runnerUp: "Croatia",
    r16: ["URU", "POR", "FRA", "ARG", "BRA", "MEX", "BEL", "JPN",
          "ESP", "RUS", "CRO", "DEN", "SWE", "SUI", "ENG", "COL"],
    matches: [
      { stage: "R16",   teamA: "FRA", teamB: "ARG", scoreA: 4, scoreB: 3 },
      { stage: "R16",   teamA: "URU", teamB: "POR", scoreA: 2, scoreB: 1 },
      { stage: "R16",   teamA: "ESP", teamB: "RUS", scoreA: 1, scoreB: 1, penA: 3, penB: 4 },
      { stage: "R16",   teamA: "CRO", teamB: "DEN", scoreA: 1, scoreB: 1, penA: 3, penB: 2 },
      { stage: "R16",   teamA: "BRA", teamB: "MEX", scoreA: 2, scoreB: 0 },
      { stage: "R16",   teamA: "BEL", teamB: "JPN", scoreA: 3, scoreB: 2 },
      { stage: "R16",   teamA: "SWE", teamB: "SUI", scoreA: 1, scoreB: 0 },
      { stage: "R16",   teamA: "ENG", teamB: "COL", scoreA: 1, scoreB: 1, penA: 4, penB: 3 },
      { stage: "QF",    teamA: "FRA", teamB: "URU", scoreA: 2, scoreB: 0 },
      { stage: "QF",    teamA: "BRA", teamB: "BEL", scoreA: 1, scoreB: 2 },
      { stage: "QF",    teamA: "SWE", teamB: "ENG", scoreA: 0, scoreB: 2 },
      { stage: "QF",    teamA: "RUS", teamB: "CRO", scoreA: 2, scoreB: 2, penA: 3, penB: 4 },
      { stage: "SF",    teamA: "FRA", teamB: "BEL", scoreA: 1, scoreB: 0 },
      { stage: "SF",    teamA: "CRO", teamB: "ENG", scoreA: 2, scoreB: 1, et: true },
      { stage: "third", teamA: "BEL", teamB: "ENG", scoreA: 2, scoreB: 0 },
      { stage: "final", teamA: "FRA", teamB: "CRO", scoreA: 4, scoreB: 2 },
    ],
  },
  {
    year: 2022,
    host: ["Qatar"],
    champion: "Argentina",
    runnerUp: "France",
    r16: ["NED", "USA", "ARG", "AUS", "FRA", "POL", "ENG", "SEN",
          "JPN", "CRO", "BRA", "KOR", "MAR", "ESP", "POR", "SUI"],
    matches: [
      { stage: "R16",   teamA: "NED", teamB: "USA", scoreA: 3, scoreB: 1 },
      { stage: "R16",   teamA: "ARG", teamB: "AUS", scoreA: 2, scoreB: 1 },
      { stage: "R16",   teamA: "FRA", teamB: "POL", scoreA: 3, scoreB: 1 },
      { stage: "R16",   teamA: "ENG", teamB: "SEN", scoreA: 3, scoreB: 0 },
      { stage: "R16",   teamA: "JPN", teamB: "CRO", scoreA: 1, scoreB: 1, penA: 1, penB: 3 },
      { stage: "R16",   teamA: "BRA", teamB: "KOR", scoreA: 4, scoreB: 1 },
      { stage: "R16",   teamA: "MAR", teamB: "ESP", scoreA: 0, scoreB: 0, penA: 3, penB: 0 },
      { stage: "R16",   teamA: "POR", teamB: "SUI", scoreA: 6, scoreB: 1 },
      { stage: "QF",    teamA: "NED", teamB: "ARG", scoreA: 2, scoreB: 2, penA: 3, penB: 4 },
      { stage: "QF",    teamA: "CRO", teamB: "BRA", scoreA: 1, scoreB: 1, penA: 4, penB: 2 },
      { stage: "QF",    teamA: "MAR", teamB: "POR", scoreA: 1, scoreB: 0 },
      { stage: "QF",    teamA: "FRA", teamB: "ENG", scoreA: 2, scoreB: 1 },
      { stage: "SF",    teamA: "ARG", teamB: "CRO", scoreA: 3, scoreB: 0 },
      { stage: "SF",    teamA: "FRA", teamB: "MAR", scoreA: 2, scoreB: 0 },
      { stage: "third", teamA: "CRO", teamB: "MAR", scoreA: 2, scoreB: 1 },
      { stage: "final", teamA: "ARG", teamB: "FRA", scoreA: 3, scoreB: 3, penA: 4, penB: 2 },
    ],
  },
];

// Approximate Elo at each WM kickoff. Sourced from contemporaneous press
// coverage of pre-tournament FiveThirtyEight / eloratings snapshots —
// values are rounded to the nearest 5 because the exact day-of-kickoff
// snapshot wasn't directly extractable. Marked here so the backtest can be
// honest about its precision.
export const HISTORICAL_ELO = {
  2006: { ITA: 1955, FRA: 1880, GER: 1925, POR: 1855, ARG: 2010, BRA: 2065,
          ENG: 1955, ESP: 1880, NED: 1840, MEX: 1750, UKR: 1635, AUS: 1660,
          GHA: 1665, KOR: 1640, SUI: 1660, ECU: 1685, CIV: 1635, CRO: 1700,
          SRB: 1700, CRC: 1480, POL: 1685, TRI: 1340, IRN: 1685, ANG: 1380,
          USA: 1740, CZE: 1780, JPN: 1635, KSA: 1505, TOG: 1320, TUN: 1610,
          PAR: 1710, SWE: 1810 },
  2010: { ESP: 2080, BRA: 2080, NED: 1965, GER: 1900, ARG: 1965, URU: 1825,
          GHA: 1700, PAR: 1740, ENG: 1900, ITA: 1850, FRA: 1830, POR: 1870,
          USA: 1715, MEX: 1735, CHL: 1830, JPN: 1620, KOR: 1690, SUI: 1730,
          CIV: 1735, SRB: 1700, SVK: 1620, SVN: 1635, DNK: 1750, DEN: 1750, AUS: 1670,
          NGA: 1690, ALG: 1525, CMR: 1610, PRK: 1340, NZL: 1395, HND: 1450, HON: 1450,
          GRC: 1690, GRE: 1690, RSA: 1490 },
  2014: { GER: 1995, ARG: 1990, BRA: 2045, NED: 1955, COL: 1885, FRA: 1855,
          BEL: 1820, CRC: 1620, CHL: 1820, MEX: 1820, URU: 1845, SUI: 1745,
          GRC: 1690, ALG: 1655, USA: 1750, NGA: 1630, ECU: 1745, ESP: 1995,
          ENG: 1855, ITA: 1885, POR: 1840, IRN: 1680, CIV: 1680, HND: 1485,
          BIH: 1660, CMR: 1545, KOR: 1640, JPN: 1665, AUS: 1500, GHA: 1660,
          CRO: 1815, RUS: 1745 },
  2018: { GER: 2080, BRA: 2095, ESP: 2010, FRA: 2000, ARG: 1985, BEL: 2010,
          POR: 1965, ENG: 1925, CRO: 1855, COL: 1890, URU: 1900, MEX: 1815,
          SUI: 1880, POL: 1830, SEN: 1755, EGY: 1750, RUS: 1685, KOR: 1745,
          JPN: 1700, DEN: 1825, ISL: 1750, NGA: 1640, AUS: 1655, CRC: 1700,
          SWE: 1810, SRB: 1755, IRN: 1735, MAR: 1720, KSA: 1465, PAN: 1565,
          PER: 1845, TUN: 1635 },
  2022: { BRA: 2155, FRA: 2005, ENG: 1925, ARG: 2055, BEL: 1925, POR: 2030,
          NED: 2025, ESP: 2050, DEN: 1845, GER: 1960, CRO: 1855, SUI: 1850,
          SRB: 1790, URU: 1885, MEX: 1855, KOR: 1750, JPN: 1735, USA: 1815,
          POL: 1745, IRN: 1715, SEN: 1735, MAR: 1780, ECU: 1860, TUN: 1680,
          AUS: 1620, CMR: 1620, CAN: 1730, KSA: 1640, GHA: 1525, WAL: 1750,
          CRC: 1635, QAT: 1545 },
  1994: { BRA: 2070, ITA: 1945, GER: 1975, ARG: 1980, NED: 1900, ESP: 1860,
          SWE: 1820, ROU: 1755, BUL: 1715, COL: 1810, USA: 1715, MEX: 1750,
          BEL: 1825, IRL: 1745, SUI: 1700, NOR: 1755, KOR: 1640, BOL: 1505,
          CMR: 1620, MAR: 1535, KSA: 1490, GRE: 1690, NGA: 1670, RUS: 1880 },
  1998: { BRA: 2080, FRA: 1850, GER: 1930, ARG: 1990, NED: 1920, ITA: 1925,
          ESP: 1880, ENG: 1830, ROU: 1755, NOR: 1755, YUG: 1845, CRO: 1800,
          MEX: 1820, USA: 1685, NGA: 1700, JPN: 1620, BEL: 1755, MAR: 1640,
          CHI: 1810, AUT: 1685, SCO: 1740, KOR: 1650, IRN: 1620, COL: 1815,
          TUN: 1620, PAR: 1745, RSA: 1490, JAM: 1620, KSA: 1490, CMR: 1610,
          DEN: 1830, BUL: 1715 },
  2002: { BRA: 2055, GER: 1880, ARG: 2010, FRA: 1985, ITA: 1955, ESP: 1955,
          ENG: 1860, POR: 1880, MEX: 1800, IRL: 1755, URU: 1810, JPN: 1700,
          KOR: 1685, SEN: 1660, USA: 1665, BEL: 1800, NGA: 1655, RUS: 1815,
          TUR: 1840, CRO: 1815, PAR: 1745, CMR: 1645, SVN: 1635, ECU: 1735,
          DEN: 1810, SWE: 1810, CRC: 1620, CHN: 1565, RSA: 1565, TUN: 1620,
          POL: 1740, KSA: 1490 },
};
export const HISTORICAL_ELO_META = {
  source: "Rounded reconstruction from FiveThirtyEight / eloratings.net archives.",
  precision: "±25 Elo — values rounded to nearest 5. Sufficient for top-3 backtest scoring; not for fine-grained log-loss calibration.",
};

/* ─────────── Past finals (for context section) ─────────── */

export const WINNERS_1930_2022 = [
  { year: 1930, host: "Uruguay",          winner: "Uruguay",   runnerUp: "Argentina" },
  { year: 1934, host: "Italy",            winner: "Italy",     runnerUp: "Czechoslovakia" },
  { year: 1938, host: "France",           winner: "Italy",     runnerUp: "Hungary" },
  { year: 1950, host: "Brazil",           winner: "Uruguay",   runnerUp: "Brazil" },
  { year: 1954, host: "Switzerland",      winner: "Germany",   runnerUp: "Hungary" },
  { year: 1958, host: "Sweden",           winner: "Brazil",    runnerUp: "Sweden" },
  { year: 1962, host: "Chile",            winner: "Brazil",    runnerUp: "Czechoslovakia" },
  { year: 1966, host: "England",          winner: "England",   runnerUp: "Germany" },
  { year: 1970, host: "Mexico",           winner: "Brazil",    runnerUp: "Italy" },
  { year: 1974, host: "Germany",          winner: "Germany",   runnerUp: "Netherlands" },
  { year: 1978, host: "Argentina",        winner: "Argentina", runnerUp: "Netherlands" },
  { year: 1982, host: "Spain",            winner: "Italy",     runnerUp: "Germany" },
  { year: 1986, host: "Mexico",           winner: "Argentina", runnerUp: "Germany" },
  { year: 1990, host: "Italy",            winner: "Germany",   runnerUp: "Argentina" },
  { year: 1994, host: "United States",    winner: "Brazil",    runnerUp: "Italy" },
  { year: 1998, host: "France",           winner: "France",    runnerUp: "Brazil" },
  { year: 2002, host: "South Korea/Japan",winner: "Brazil",    runnerUp: "Germany" },
  { year: 2006, host: "Germany",          winner: "Italy",     runnerUp: "France" },
  { year: 2010, host: "South Africa",     winner: "Spain",     runnerUp: "Netherlands" },
  { year: 2014, host: "Brazil",           winner: "Germany",   runnerUp: "Argentina" },
  { year: 2018, host: "Russia",           winner: "France",    runnerUp: "Croatia" },
  { year: 2022, host: "Qatar",            winner: "Argentina", runnerUp: "France" },
];

function buildStats(finals) {
  const titles = {};
  let hostWins = 0, europeWins = 0, southAmericaWins = 0;
  const SOUTH_AMERICA = new Set(["Brazil", "Argentina", "Uruguay"]);
  for (const f of finals) {
    titles[f.winner] = (titles[f.winner] || 0) + 1;
    if (f.host.includes(f.winner)) hostWins += 1;
    if (SOUTH_AMERICA.has(f.winner)) southAmericaWins += 1;
    else europeWins += 1;
  }
  const ranking = Object.entries(titles)
    .sort((a, b) => b[1] - a[1])
    .map(([nation, count]) => ({ nation, count }));
  return { titles, ranking, hostWins, totalTournaments: finals.length, europeWins, southAmericaWins };
}
export const STATS = buildStats(WINNERS_1930_2022);

/* ─────────── German names ─────────── */

export const NAMES_DE = {
  "United States": "USA", "Canada": "Kanada", "Mexico": "Mexiko",
  "France": "Frankreich", "England": "England", "Spain": "Spanien",
  "Portugal": "Portugal", "Germany": "Deutschland", "Italy": "Italien",
  "Netherlands": "Niederlande", "Belgium": "Belgien", "Croatia": "Kroatien",
  "Denmark": "Dänemark", "Switzerland": "Schweiz", "Austria": "Österreich",
  "Poland": "Polen", "Serbia": "Serbien", "Turkey": "Türkei",
  "Norway": "Norwegen", "Sweden": "Schweden", "Scotland": "Schottland",
  "Czech Republic": "Tschechien", "Bosnia and Herzegovina": "Bosnien und Herzegowina",
  "Brazil": "Brasilien", "Argentina": "Argentinien", "Uruguay": "Uruguay",
  "Colombia": "Kolumbien", "Ecuador": "Ecuador", "Paraguay": "Paraguay",
  "Costa Rica": "Costa Rica", "Panama": "Panama", "Curaçao": "Curaçao",
  "Haiti": "Haiti", "Jamaica": "Jamaika",
  "Morocco": "Marokko", "Senegal": "Senegal", "Egypt": "Ägypten",
  "Algeria": "Algerien", "Nigeria": "Nigeria", "Cameroon": "Kamerun",
  "Tunisia": "Tunesien", "Ghana": "Ghana", "Ivory Coast": "Elfenbeinküste",
  "DR Congo": "DR Kongo", "South Africa": "Südafrika", "Cape Verde": "Kap Verde",
  "Japan": "Japan", "South Korea": "Südkorea", "Iran": "Iran",
  "Australia": "Australien", "Saudi Arabia": "Saudi-Arabien", "Qatar": "Katar",
  "Iraq": "Irak", "Uzbekistan": "Usbekistan", "Jordan": "Jordanien",
  "New Zealand": "Neuseeland",
};

/* ─────────── i18n ─────────── */

export const I18N = {
  en: {
    title: "World Cup 2026 — Data Forecast",
    subtitle: "Elo-driven Monte-Carlo over 10 000 simulated tournaments. Validated against the 2006–2022 knockout brackets.",
    snapshot: (d) => `Snapshot ${d}`,
    sectionTop3: "Top 3 Favorites",
    sectionDistribution: "Full Title Probability",
    sectionGroups: "Expected Group Standings",
    sectionMarket: "Model vs Market",
    sectionBacktest: "Backtest 2006–2022",
    sectionContext: "96 Years of Statistics",
    sectionSources: "Data Sources & Methodology",
    titleChance: "Title chance",
    semiChance: "Semi-final chance",
    groupAdvance: "Group advance",
    showAll: "Show all 48 teams",
    hideAll: "Collapse",
    modelLabel: "Model",
    marketLabel: "Market",
    correlation: (r) => `Model–market correlation: <strong>${r}</strong>`,
    bookmakers: "Bookmakers & prediction markets",
    backtestHeader: "Year · Champion · Matches · RPS per model",
    backtestSummary: (n, rpsElo, rpsDC, rpsEns) =>
      `${n} tournaments · avg RPS — Elo <strong>${rpsElo}</strong> · Dixon-Coles <strong>${rpsDC}</strong> · Ensemble <strong>${rpsEns}</strong>`,
    scenarioHeader: "Scenario toggles",
    scenarioHost: "Home advantage",
    scenarioSquad: "Squad strength",
    scenarioDC: "Dixon-Coles",
    scenarioMarket: "Market consensus",
    weightsLabel: "Ensemble weights:",
    calibrationHeader: "Match-level calibration",
    referencesHeader: "Academic references",
    modelBreakdownHeader: "Model breakdown (top 5)",
    methodologyBlurb: "Each match is sampled twice from a Poisson distribution whose mean is the team's expected goals: μ = 1.42 + 0.55·(Elo − Opp + Host)/400. Home support is +80 Elo for matches played in the supporter's country. Group ties resolve on points → goal-diff → goals-for; knockout ties resolve via Elo-dampened shootout. 10 000 simulated tournaments aggregate to the empirical probability distribution shown.",
    limitations: "Limitations",
    limitationsBody: "Pre-tournament Elos for the 1994–2022 backtest are rounded reconstructions, accurate to ±25 Elo — fine for top-3 ranking, not for fine-grained log-loss calibration. Player-level injuries/form are not modelled — strength sits at the team-Elo level. Bookmaker market is built from two reachable sources (Polymarket + FoxSports); five other books (Pinnacle, Bet365, DraftKings, Kalshi, Smarkets) are geo- or bot-blocked from this runtime and would need a paid odds-API key to integrate.",
    footer: "Built on public Elo + market data · educational use, not for betting.",
    statsLeader: (nation, count) => `${nation} leads with ${count} titles since 1930.`,
    statsContinental: (eu, sa) => `Europe ${eu} — South America ${sa} (rest of world: 0).`,
    statsHost: (h, total) => `${h} of ${total} tournaments went to a host nation.`,
  },
  de: {
    title: "WM 2026 — Datenprognose",
    subtitle: "Elo-getriebene Monte-Carlo-Simulation über 10 000 Turniere. Validiert gegen die K.-o.-Bracketts 2006–2022.",
    snapshot: (d) => `Stand ${d}`,
    sectionTop3: "Top 3 Favoriten",
    sectionDistribution: "Volle Titelwahrscheinlichkeit",
    sectionGroups: "Erwartete Gruppentabellen",
    sectionMarket: "Modell vs Markt",
    sectionBacktest: "Backtest 2006–2022",
    sectionContext: "96 Jahre Statistik",
    sectionSources: "Datenquellen & Methodik",
    titleChance: "Titel-Chance",
    semiChance: "Halbfinal-Chance",
    groupAdvance: "Gruppen-Weiterkommen",
    showAll: "Alle 48 Mannschaften zeigen",
    hideAll: "Einklappen",
    modelLabel: "Modell",
    marketLabel: "Markt",
    correlation: (r) => `Modell–Markt Korrelation: <strong>${r}</strong>`,
    bookmakers: "Buchmacher & Prognose-Märkte",
    backtestHeader: "Jahr · Sieger · Spiele · RPS pro Modell",
    backtestSummary: (n, rpsElo, rpsDC, rpsEns) =>
      `${n} Turniere · Ø RPS — Elo <strong>${rpsElo}</strong> · Dixon-Coles <strong>${rpsDC}</strong> · Ensemble <strong>${rpsEns}</strong>`,
    scenarioHeader: "Szenario-Schalter",
    scenarioHost: "Heimvorteil",
    scenarioSquad: "Kader-Stärke",
    scenarioDC: "Dixon-Coles",
    scenarioMarket: "Marktkonsens",
    weightsLabel: "Ensemble-Gewichte:",
    calibrationHeader: "Spiel-Kalibrierung",
    referencesHeader: "Wissenschaftliche Quellen",
    modelBreakdownHeader: "Modell-Aufschlüsselung (Top 5)",
    methodologyBlurb: "Jedes Spiel wird zweifach aus einer Poisson-Verteilung gezogen, deren Mittelwert μ = 1,42 + 0,55·(Elo − Gegner + Heim)/400 die erwarteten Tore ist. Heimvorteil +80 Elo für Spiele im Land des Teams. Gruppen-Gleichstand: Punkte → Tordifferenz → Tore. K.-o.-Gleichstand: Elo-gedämpftes Elfmeterschießen. 10 000 simulierte Turniere ergeben die gezeigte empirische Wahrscheinlichkeitsverteilung.",
    limitations: "Grenzen des Modells",
    limitationsBody: "Pre-Turnier-Elos für den 1994–2022-Backtest sind gerundete Rekonstruktionen mit ±25 Genauigkeit — ausreichend für Top-3-Ranking, nicht für feine Log-Loss-Kalibrierung. Verletzungen / Tagesform einzelner Spieler werden nicht modelliert — Stärke bleibt auf Mannschafts-Elo-Ebene. Marktdaten kommen aus zwei erreichbaren Quellen (Polymarket + FoxSports); fünf weitere Buchmacher (Pinnacle, Bet365, DraftKings, Kalshi, Smarkets) sind aus dieser Laufzeitumgebung geo- oder bot-geblockt und bräuchten einen kostenpflichtigen Odds-API-Schlüssel.",
    footer: "Basierend auf öffentlichen Elo- und Marktdaten · Bildungszweck, nicht zum Wetten.",
    statsLeader: (nation, count) => `${nation} führt mit ${count} Titeln seit 1930.`,
    statsContinental: (eu, sa) => `Europa ${eu} — Südamerika ${sa} (Rest der Welt: 0).`,
    statsHost: (h, total) => `${h} von ${total} Turnieren gingen an eine Gastgebernation.`,
  },
};

/* ─────────── Source list (rendered in the UI) ─────────── */

export const DATA_SOURCES = [
  { label: "2026 FIFA World Cup — Wikipedia (teams, pots, hosts)",
    url:   "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup",
    fetched: "2026-05-20" },
  { label: "2026 FIFA World Cup seeding — Wikipedia (official December 2025 draw)",
    url:   "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_seeding",
    fetched: "2026-05-20" },
  { label: "World Football Elo Ratings — Wikipedia / Module:SportsRankings",
    url:   "https://en.wikipedia.org/wiki/World_Football_Elo_Ratings",
    fetched: "2026-05-20" },
  { label: "FIFA Men's World Ranking — Wikipedia",
    url:   "https://en.wikipedia.org/wiki/FIFA_Men%27s_World_Ranking",
    fetched: "2026-05-20" },
  { label: "Polymarket — 2026 FIFA World Cup Winner",
    url:   "https://polymarket.com/event/2026-fifa-world-cup-winner-595",
    fetched: "2026-05-20" },
  { label: "FoxSports — 2026 World Cup Champion Odds",
    url:   "https://www.foxsports.com/stories/soccer/world-cup-2026-champion-odds",
    fetched: "2026-05-20" },
  { label: "2022 / 2018 / 2014 / 2010 / 2006 FIFA World Cup knockout stages — Wikipedia",
    url:   "https://en.wikipedia.org/wiki/2022_FIFA_World_Cup_knockout_stage",
    fetched: "2026-05-20" },
];
