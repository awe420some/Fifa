// UI orchestrator for the ensemble forecast.
import {
  TEAMS_2026, GROUPS_2026, ELO_2026, ELO_2026_META,
  MARKET_ODDS_2026, MARKET_ODDS_2026_META,
  HISTORICAL_KNOCKOUTS, HISTORICAL_ELO,
  SQUAD_INDEX_2026, NEW_HISTORICAL_MATCHES,
  STATS, NAMES_DE, I18N, DATA_SOURCES,
} from "./data.js";
import {
  runEnsembleMonteCarlo, runEnsembleMonteCarloBootstrap, matchProbs,
  fitDCOnHistorical, runRPSBacktest, calibrationBins,
  blendWithMarket, flattenHistoricalMatches,
} from "./predictor.js";
import { bootstrapDC } from "./models/dixonColes.js";
import { squadEloAdjustments } from "./models/squad.js";
import { DEFAULT_WEIGHTS } from "./models/ensemble.js";
import { aggregateMarket, deVig } from "./models/market.js";
import { buildCovariateProvider } from "./predictor.js";
import { PLAYERS_2026, BIG5_LEAGUES } from "./data/players-2026.js";
import { GOAL_MINUTE_BINS, DEFAULT_MIN_SHARE, LEAGUE_STRENGTH, teamScoringShares } from "./models/players.js";

async function loadMarketSnapshot() {
  try {
    const resp = await fetch("./data/market-snapshot.json", { cache: "no-store" });
    if (!resp.ok) return null;
    const snap = await resp.json();
    if (!snap?.aggregated || Object.keys(snap.aggregated).length === 0) return null;
    return snap;
  } catch {
    return null;
  }
}

async function loadSchedule() {
  try {
    const resp = await fetch("./data/schedule-2026.json", { cache: "no-store" });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.SCHEDULE_2026 || data;
  } catch {
    return null;
  }
}

async function loadTitleHistory() {
  try {
    const resp = await fetch("./data/title-history.json", { cache: "no-store" });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

async function loadPlayerProps() {
  try {
    const resp = await fetch("./data/player-props-2026.json", { cache: "no-store" });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

// Power-method bias correction p_i^γ / Σ p_j^γ.
function powerTransform(probs, gamma) {
  if (!gamma || gamma === 1) return probs;
  const out = {};
  let total = 0;
  for (const [k, v] of Object.entries(probs)) {
    const t = Math.pow(Math.max(0, v), gamma);
    out[k] = t;
    total += t;
  }
  if (total === 0) return probs;
  for (const k of Object.keys(out)) out[k] /= total;
  return out;
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const ITERATIONS = 25000;

const state = {
  locale: "en",
  mc: null,
  backtest: null,
  calibration: null,
  dcParams: null,
  squadDelta: null,
  blendedTitle: null,
  showAll: false,
  schedule: null,
  covariateProvider: null,
  titleHistory: null,
  marketGamma: 1.0,
  bootstrap: false,
  bootstrapFits: null,
  players: null,
  playersComputing: false,
  playersTeamFilter: "",
  playerProps: null,
  // Mega-table state
  megaSort: { key: "expGoals", dir: "desc" },
  megaSearch: "",
  megaPos: "",
  megaLeague: "",
  expandedPlayer: null,
  comparePins: [],
  playerRowsCache: null,      // memoized buildPlayerRows output
  playerRowsCacheKey: null,   // identity of state.players it was built from
  options: {
    useHost: true,
    useSquad: true,
    useDC: true,
    useMarket: true,
    useCovariates: true,
  },
};

const t = () => I18N[state.locale];
const teamByCode = Object.fromEntries(TEAMS_2026.map((x) => [x.code, x]));
const hostCodes = TEAMS_2026.filter((x) => x.host).map((x) => x.code);

const teamName = (code) => {
  const team = teamByCode[code];
  if (!team) return code;
  return state.locale === "de" && NAMES_DE[team.name] ? NAMES_DE[team.name] : team.name;
};

const escape = (str) => String(str).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pct = (p, d = 1) => `${(p * 100).toFixed(d)}%`;

function applyI18n() {
  const dict = t();
  $$("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (typeof dict[key] === "string") el.textContent = dict[key];
  });
  $$("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (typeof dict[key] === "string") el.setAttribute("placeholder", dict[key]);
  });
  document.title = dict.title;
  $("#snapshot-line").textContent = dict.snapshot(ELO_2026_META.asOf);
  $("#footer-line").textContent = dict.footer;
}

/* ─────────── Top 3 ─────────── */

function rankedTitles() {
  const probs = state.blendedTitle || state.mc.titleProbability;
  return Object.entries(probs)
    .map(([code, p]) => ({ code, p }))
    .sort((a, b) => b.p - a.p);
}

function renderTop3() {
  const ranked = rankedTitles().slice(0, 3);
  $("#top3").innerHTML = ranked.map((row, i) => `
    <div class="top-card top-rank-${i + 1}">
      <div class="top-rank">${i + 1}</div>
      <div class="top-team">${escape(teamName(row.code))}</div>
      <div class="top-meta">${escape(teamByCode[row.code]?.confederation || "")}</div>
      <div class="top-prob">${pct(row.p, 1)}</div>
      <div class="top-bar"><div class="top-bar-fill" style="width:${Math.min(100, row.p * 350)}%"></div></div>
      <div class="top-sub">
        <span>SF ${pct(state.mc.semisProbability[row.code] || 0, 0)}</span>
        <span>QF ${pct(state.mc.quartersProbability[row.code] || 0, 0)}</span>
      </div>
    </div>
  `).join("");
}

/* ─────────── Model breakdown ─────────── */

function renderModelBreakdown() {
  const ranked = rankedTitles().slice(0, 5);
  const market = state.marketProbs || MARKET_ODDS_2026;
  const elo = state.mc.titleProbability;
  $("#model-breakdown").innerHTML = `
    <table class="breakdown-table">
      <thead>
        <tr>
          <th>Team</th>
          <th>Ensemble</th>
          <th>Elo+DC MC</th>
          <th>Markt</th>
        </tr>
      </thead>
      <tbody>
        ${ranked.map((row) => `
          <tr>
            <td>${escape(teamName(row.code))}</td>
            <td class="num accent">${pct(row.p, 1)}</td>
            <td class="num">${pct(elo[row.code] || 0, 1)}</td>
            <td class="num">${pct(market[row.code] || 0, 1)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

/* ─────────── Stage-by-stage table ─────────── */

function renderStages() {
  const dict = t();
  const cols = dict.stageCols;
  const market = state.marketProbs || MARKET_ODDS_2026;
  const hasBootstrap = state.bootstrap && state.mc.bootstrapVar;
  const teams = TEAMS_2026.map((team) => {
    const code = team.code;
    const tp = (state.blendedTitle || state.mc.titleProbability)[code] || 0;
    // Monte-Carlo sampling SD.
    const mcSE = Math.sqrt(Math.max(0, tp * (1 - tp)) / state.mc.iterations);
    // Total SD = sqrt(MC variance + bootstrap variance), when bootstrap is on.
    const bsVar = hasBootstrap ? (state.mc.bootstrapVar[code] || 0) : 0;
    const totalSD = hasBootstrap ? Math.sqrt(mcSE * mcSE + bsVar) : null;
    const ciHalfWidth = totalSD ?? mcSE;
    const ciLow = Math.max(0, tp - 1.96 * ciHalfWidth);
    const ciHigh = Math.min(1, tp + 1.96 * ciHalfWidth);
    const surprise = tp > 0 ? -Math.log2(tp) : Infinity;
    return {
      code, tp,
      market: market[code] || 0,
      r32: state.mc.r32Probability[code] || 0,
      r16: state.mc.r16Probability[code] || 0,
      qf: state.mc.quartersProbability[code] || 0,
      sf: state.mc.semisProbability[code] || 0,
      finalP: state.mc.finalsProbability[code] || 0,
      sd: mcSE,
      totalSD,
      surprise, ciLow, ciHigh,
    };
  })
    .sort((a, b) => b.tp - a.tp)
    .slice(0, 12);
  const rows = teams.map((r) => `
    <tr>
      <td>${escape(teamName(r.code))}</td>
      <td class="num">${pct(r.market, 1)}</td>
      <td class="num">${pct(r.r32, 0)}</td>
      <td class="num">${pct(r.r16, 0)}</td>
      <td class="num">${pct(r.qf, 0)}</td>
      <td class="num">${pct(r.sf, 0)}</td>
      <td class="num">${pct(r.finalP, 1)}</td>
      <td class="num accent">${pct(r.tp, 2)}</td>
      <td class="num small">${pct(r.sd, 2)}</td>
      <td class="num small">${r.totalSD == null ? "—" : pct(r.totalSD, 2)}</td>
      <td class="num small">[${pct(r.ciLow, 1)}, ${pct(r.ciHigh, 1)}]</td>
      <td class="num">${r.surprise === Infinity ? "—" : r.surprise.toFixed(1)}</td>
    </tr>
  `).join("");
  $("#stages").innerHTML = `
    <table class="stages-table">
      <thead><tr>
        <th>${escape(cols.team)}</th>
        <th>${escape(cols.market)}</th>
        <th>${escape(cols.r32)}</th>
        <th>${escape(cols.r16)}</th>
        <th>${escape(cols.qf)}</th>
        <th>${escape(cols.sf)}</th>
        <th>${escape(cols.final)}</th>
        <th>${escape(cols.title)}</th>
        <th>${escape(cols.sd)}</th>
        <th>${escape(cols.totalSd)}</th>
        <th>${escape(cols.ci)}</th>
        <th>${escape(cols.surprise)}</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

/* ─────────── Full distribution ─────────── */

function renderDistribution() {
  const dict = t();
  const ranked = Object.entries(state.blendedTitle || state.mc.titleProbability)
    .map(([code, p]) => ({
      code, p,
      semi: state.mc.semisProbability[code] || 0,
      advance: state.mc.groupAdvanceProbability[code] || 0,
    }))
    .sort((a, b) => b.p - a.p);
  const visible = state.showAll ? ranked : ranked.slice(0, 12);
  const maxP = ranked[0]?.p || 0.01;
  $("#distribution").innerHTML = visible.map((r) => `
    <div class="dist-row">
      <div class="dist-team">${escape(teamName(r.code))}</div>
      <div class="dist-bar"><div class="dist-fill" style="width:${(r.p / maxP) * 100}%"></div></div>
      <div class="dist-prob">${pct(r.p, r.p < 0.01 ? 2 : 1)}</div>
      <div class="dist-extra muted">SF ${pct(r.semi, 0)} · Adv ${pct(r.advance, 0)}</div>
    </div>
  `).join("");
  $("#toggle-distribution").textContent = state.showAll ? dict.hideAll : dict.showAll;
}

/* ─────────── Market panel ─────────── */

function renderMarket() {
  const dict = t();
  const teams = TEAMS_2026.map((team) => ({
    code: team.code,
    model: (state.blendedTitle || state.mc.titleProbability)[team.code] || 0,
    market: (state.marketProbs || MARKET_ODDS_2026)[team.code] || 0,
  }));
  const top = teams.sort((a, b) => Math.max(b.model, b.market) - Math.max(a.model, a.market)).slice(0, 15);
  const maxV = Math.max(...top.flatMap((x) => [x.model, x.market]));
  $("#market").innerHTML = `
    <div class="market-head muted">
      <span></span>
      <span><span class="legend-dot legend-model"></span>${escape(dict.modelLabel)}</span>
      <span><span class="legend-dot legend-market"></span>${escape(dict.marketLabel)}</span>
    </div>
    ${top.map((r) => `
      <div class="market-row">
        <div class="market-team">${escape(teamName(r.code))}</div>
        <div class="market-bars">
          <div class="market-bar"><div class="market-fill model" style="width:${(r.model / maxV) * 100}%"></div><span class="market-val">${pct(r.model, 1)}</span></div>
          <div class="market-bar"><div class="market-fill market" style="width:${(r.market / maxV) * 100}%"></div><span class="market-val">${pct(r.market, 1)}</span></div>
        </div>
      </div>
    `).join("")}
  `;
  const r = pearson(top.map((x) => x.model), top.map((x) => x.market));
  $("#market-summary").innerHTML = dict.correlation(r.toFixed(2));
}

/* ─────────── Team Market Matrix ─────────── */

const MATRIX_STAGES = [
  { key: "title",     modelKey: "titleProbability",         marketKey: "titleAggregated" },
  { key: "finals",    modelKey: "finalsProbability",        marketKey: "finalsAggregated" },
  { key: "semis",     modelKey: "semisProbability",         marketKey: "semisAggregated" },
  { key: "quarters",  modelKey: "quartersProbability",      marketKey: "quartersAggregated" },
  { key: "r16",       modelKey: "r16Probability",           marketKey: "r16Aggregated" },
  { key: "groupWin",  modelKey: "groupPositionDistribution", marketKey: "groupWinnerAggregated" },
  { key: "topTwo",    modelKey: "groupAdvanceProbability",  marketKey: "topTwoAggregated" },
];

let _matrixSort = { key: "title", dir: "diff" };  // diff | model | market

function matrixModelValue(code, stage) {
  const mc = state.mc;
  if (stage.key === "groupWin") {
    const gp = mc.groupPositionDistribution?.[code];
    return gp && gp.total ? gp.p1 / gp.total : 0;
  }
  const m = mc[stage.modelKey];
  if (!m) return 0;
  return m[code] || 0;
}

function matrixMarketValue(code, stage) {
  const snap = state.marketSnapshot;
  // Title falls back to aggregated/MARKET_ODDS_2026 for backward-compat.
  if (stage.key === "title") {
    return (snap?.titleAggregated || snap?.aggregated || MARKET_ODDS_2026)[code] ?? null;
  }
  return snap?.[stage.marketKey]?.[code] ?? null;
}

function renderTeamMarketMatrix() {
  const dict = t();
  const cols = dict.matrixCols;
  const rows = TEAMS_2026.map((team) => {
    const row = { code: team.code, name: teamName(team.code), stages: {} };
    for (const stage of MATRIX_STAGES) {
      const model = matrixModelValue(team.code, stage);
      const market = matrixMarketValue(team.code, stage);
      const diff = market != null ? model - market : null;
      row.stages[stage.key] = { model, market, diff };
    }
    return row;
  });
  const sortKey = _matrixSort.key;
  const sortDir = _matrixSort.dir;
  rows.sort((a, b) => {
    const sa = a.stages[sortKey];
    const sb = b.stages[sortKey];
    if (sortDir === "diff") {
      const da = sa?.diff;
      const db = sb?.diff;
      if (da == null && db == null) return (sb.model || 0) - (sa.model || 0);
      if (da == null) return 1;
      if (db == null) return -1;
      return db - da;
    }
    return (sb.model || 0) - (sa.model || 0);
  });
  const renderDiff = (d) => {
    if (d == null) return `<span class="muted">—</span>`;
    const sign = d >= 0 ? "+" : "−";
    const cls = d >= 0 ? "edge-up" : "edge-down";
    return `<span class="${cls}">${sign}${(Math.abs(d) * 100).toFixed(1)}</span>`;
  };
  const headerCell = (key, label) => `
    <th data-sort="${key}" class="${sortKey === key ? "sorted-desc" : ""}">${escape(label)}</th>
  `;
  $("#team-matrix").innerHTML = `
    <table class="team-matrix">
      <thead><tr>
        <th>${escape(cols.team)}</th>
        ${headerCell("title", cols.title)}
        ${headerCell("finals", cols.finals)}
        ${headerCell("semis", cols.semis)}
        ${headerCell("quarters", cols.quarters)}
        ${headerCell("r16", cols.r16)}
        ${headerCell("groupWin", cols.groupWin)}
        ${headerCell("topTwo", cols.topTwo)}
      </tr></thead>
      <tbody>${rows.map((row) => `
        <tr>
          <td class="team-name">${escape(row.name)}</td>
          ${MATRIX_STAGES.map((stage) => {
            const s = row.stages[stage.key];
            return `<td>
              <div class="matrix-cell">
                <span class="mc-model">${pct(s.model, s.model < 0.01 ? 2 : 1)}</span>
                <span class="mc-market">${s.market != null ? pct(s.market, s.market < 0.01 ? 2 : 1) : "n/v"}</span>
                <span class="mc-diff">${renderDiff(s.diff)}</span>
              </div>
            </td>`;
          }).join("")}
        </tr>
      `).join("")}</tbody>
    </table>
  `;
  // Wire up header clicks for sorting.
  $$("#team-matrix th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      _matrixSort = { key: th.dataset.sort, dir: "diff" };
      renderTeamMarketMatrix();
    });
  });
}

function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return (dx === 0 || dy === 0) ? 0 : num / Math.sqrt(dx * dy);
}

/* ─────────── Groups ─────────── */

function renderGroups() {
  $("#groups").innerHTML = Object.entries(GROUPS_2026).map(([letter, codes]) => {
    const rows = codes.map((code) => {
      const gp = state.mc.groupPositionDistribution[code];
      if (!gp || gp.total === 0) return { code, avg: 4 };
      const avg = (gp.p1 * 1 + gp.p2 * 2 + gp.p3 * 3 + gp.p4 * 4) / gp.total;
      const adv = (gp.p1 + gp.p2) / gp.total;
      return { code, avg, adv };
    }).sort((a, b) => a.avg - b.avg);
    return `
      <div class="group-card">
        <h4>Group ${letter}</h4>
        <table>
          <thead><tr><th></th><th>Team</th><th>Ø Pos</th><th>Adv</th></tr></thead>
          <tbody>
            ${rows.map((r, i) => `
              <tr class="${i < 2 ? "advance" : ""}">
                <td>${i + 1}</td>
                <td>${escape(teamName(r.code))}</td>
                <td>${r.avg.toFixed(2)}</td>
                <td>${pct(r.adv || 0, 0)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }).join("");
}

/* ─────────── Backtest (RPS + log-loss) ─────────── */

function renderBacktest() {
  const dict = t();
  const rows = state.backtest.perTournament.map((r) => `
    <tr>
      <td class="bt-year">${r.year}</td>
      <td>${escape(teamNameEN(r.actualChampion))}</td>
      <td>${r.n}</td>
      <td class="num">${r.rpsElo?.toFixed(3) ?? "—"}</td>
      <td class="num">${r.rpsDC?.toFixed(3) ?? "—"}</td>
      <td class="num accent">${r.rpsEnsemble?.toFixed(3) ?? "—"}</td>
    </tr>
  `).join("");
  $("#backtest").innerHTML = `
    <table class="bt-table">
      <thead>
        <tr>
          <th>Jahr</th>
          <th>Sieger</th>
          <th>Spiele</th>
          <th>RPS Elo</th>
          <th>RPS DC</th>
          <th>RPS Ensemble</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  $("#backtest-summary").innerHTML = dict.backtestSummary(
    state.backtest.perTournament.length,
    state.backtest.avgRPSElo?.toFixed(3) ?? "—",
    state.backtest.avgRPSDC?.toFixed(3) ?? "—",
    state.backtest.avgRPSEnsemble?.toFixed(3) ?? "—",
  );
}

function teamNameEN(name) {
  return state.locale === "de" && NAMES_DE[name] ? NAMES_DE[name] : name;
}

/* ─────────── Calibration chart (SVG) ─────────── */

function wilson(p, n) {
  if (n === 0) return [0, 1];
  const z = 1.96;
  const denom = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / denom;
  const half = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

const logit = (p) => Math.log(Math.max(1e-6, Math.min(1 - 1e-6, p)) / (1 - Math.max(1e-6, Math.min(1 - 1e-6, p))));

function fitCalibrationLine(cells) {
  const filtered = cells.filter((c) => c.observed !== null && c.n > 0);
  if (filtered.length < 2) return { a: 0, b: 1 };
  const xs = filtered.map((c) => logit(c.midPred));
  const ys = filtered.map((c) => logit(c.observed));
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const b = den === 0 ? 1 : num / den;
  const a = my - b * mx;
  return { a, b };
}

function renderCalibration() {
  const cells = state.calibration;
  const w = 320, h = 200, m = 22;
  const x = (v) => m + v * (w - 2 * m);
  const y = (v) => h - m - v * (h - 2 * m);
  const valid = cells.filter((c) => c.observed !== null && c.n > 0);
  const fit = fitCalibrationLine(cells);
  const bars = valid.map((c) => {
    const [lo, hi] = wilson(c.observed, c.n);
    return `<line x1="${x(c.midPred)}" y1="${y(lo)}" x2="${x(c.midPred)}" y2="${y(hi)}" stroke="rgba(0,217,126,0.4)" stroke-width="1.5" />`;
  }).join("");
  const dots = valid.map((c) =>
    `<circle cx="${x(c.midPred)}" cy="${y(c.observed)}" r="${Math.min(6, 2 + c.n / 25)}" fill="var(--accent)" opacity="0.9" />`
  ).join("");
  $("#calibration").innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" class="calibration-chart" aria-label="Calibration chart">
      <line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" stroke="rgba(127,168,150,0.4)" stroke-dasharray="4 3" />
      ${bars}
      ${dots}
      <text x="${m}" y="${h - 4}" font-size="10" fill="var(--muted)">predicted →</text>
      <text x="${m + 4}" y="${m}" font-size="10" fill="var(--muted)">observed ↑</text>
    </svg>
    <p class="muted small">logit(observed) = <strong>${fit.a.toFixed(2)}</strong> + <strong>${fit.b.toFixed(2)}</strong> · logit(predicted) — ideal is (0, 1). Wilson 95% intervals shown.</p>
  `;
}

/* ─────────── Context, methodology, sources ─────────── */

function renderContext() {
  const dict = t();
  const top = STATS.ranking[0];
  $("#context").innerHTML = `
    <ul>
      <li>${dict.statsLeader(escape(teamNameEN(top.nation)), top.count)}</li>
      <li>${dict.statsHost(STATS.hostWins, STATS.totalTournaments)}</li>
      <li>${dict.statsContinental(STATS.europeWins, STATS.southAmericaWins)}</li>
    </ul>
  `;
}

function renderMethodology() {
  const dict = t();
  $("#methodology-text").innerHTML = dict.methodologyBlurb;
  $("#limitations-text").innerHTML = dict.limitationsBody;
  $("#sources").innerHTML = DATA_SOURCES.map((s) => `
    <li><a href="${escape(s.url)}" target="_blank" rel="noopener">${escape(s.label)}</a>
      <span class="muted">· ${escape(s.fetched)}</span></li>
  `).join("");
  $("#references").innerHTML = REFERENCES.map((ref) => `
    <li><span>${escape(ref.author)} (${escape(ref.year)}). <em>${escape(ref.title)}</em>${ref.venue ? ". " + escape(ref.venue) : ""}.</span></li>
  `).join("");
  $("#weights-display").innerHTML = formatWeights();
}

const REFERENCES = [
  { author: "Elo, A. E.", year: 1978, title: "The Rating of Chessplayers, Past and Present" },
  { author: "Dixon, M. J. & Coles, S. G.", year: 1997, title: "Modelling Association Football Scores and Inefficiencies in the Football Betting Market", venue: "JRSS Series C 46(2): 265-280" },
  { author: "Karlis, D. & Ntzoufras, I.", year: 2003, title: "Analysis of sports data by using bivariate Poisson models", venue: "The Statistician 52(3)" },
  { author: "Hvattum, L. M. & Arntzen, H.", year: 2010, title: "Using Elo ratings for match result prediction in association football", venue: "Int. J. Forecasting" },
  { author: "Forrest, D., Goddard, J. & Simmons, R.", year: 2005, title: "Odds-setters as forecasters: The case of English football", venue: "Int. J. Forecasting" },
  { author: "Constantinou, A. C.", year: 2019, title: "Dolores: A model that predicts football match outcomes from all over the world", venue: "Machine Learning 108" },
  { author: "Boshnakov, G., Kharrat, T. & McHale, I. G.", year: 2017, title: "A bivariate Weibull count model for forecasting association football scores", venue: "Int. J. Forecasting" },
  { author: "Goddard, J.", year: 2005, title: "Regression models for forecasting goals and match results in association football", venue: "Int. J. Forecasting" },
];

function formatWeights() {
  const w = state.mc.weights || DEFAULT_WEIGHTS;
  return `<strong>Elo</strong> ${pct(w.elo, 0)} · <strong>Dixon-Coles</strong> ${pct(w.dc, 0)} · <strong>Squad</strong> ${pct(w.squad, 0)} · <strong>Markt</strong> ${pct(w.market, 0)}`;
}

/* ─────────── Scenario toggles ─────────── */

function setupScenarios() {
  $$(".scenario-toggle").forEach((el) => {
    const key = el.dataset.toggle;
    el.checked = state.options[key];
    el.addEventListener("change", async () => {
      state.options[key] = el.checked;
      $("#dashboard").classList.add("recomputing");
      await new Promise((r) => requestAnimationFrame(r));
      recompute();
      renderAll();
      $("#dashboard").classList.remove("recomputing");
      // If player tracking is on, the player projections are stale —
      // refresh them with the new scenario.
      if (state.players) await computePlayerMC();
    });
  });
  const bootstrapToggle = $("#bootstrap-toggle");
  if (bootstrapToggle) {
    bootstrapToggle.checked = state.bootstrap;
    bootstrapToggle.addEventListener("change", async () => {
      state.bootstrap = bootstrapToggle.checked;
      $("#dashboard").classList.add("recomputing");
      if (state.bootstrap && !state.bootstrapFits) {
        // Lazy-fit B=10 DC parameter sets — chunked so the UI doesn't
        // freeze. Each fit is a synchronous ~1.5 s job; we yield to
        // the event loop between fits.
        const { matches, teamCodes } = flattenHistoricalMatches(HISTORICAL_KNOCKOUTS, NEW_HISTORICAL_MATCHES);
        const eloMap = {};
        for (const y of Object.keys(HISTORICAL_ELO).map(Number).sort((a, b) => b - a)) {
          for (const [code, elo] of Object.entries(HISTORICAL_ELO[y])) {
            if (eloMap[code] === undefined) eloMap[code] = elo;
          }
        }
        const B = 10;
        state.bootstrapFits = [];
        for (let i = 0; i < B; i++) {
          await new Promise((r) => setTimeout(r, 0));
          const sample = new Array(matches.length);
          for (let j = 0; j < matches.length; j++) sample[j] = matches[Math.floor(Math.random() * matches.length)];
          state.bootstrapFits.push(bootstrapDC(sample, teamCodes, eloMap, 1, { iterations: 40 })[0]);
        }
      }
      await new Promise((r) => requestAnimationFrame(r));
      recompute();
      renderAll();
      $("#dashboard").classList.remove("recomputing");
    });
  }
  const gammaSel = $("#market-gamma");
  if (gammaSel) {
    gammaSel.value = String(state.marketGamma);
    gammaSel.addEventListener("change", async () => {
      state.marketGamma = parseFloat(gammaSel.value);
      const raw = state.marketSnapshot?.aggregated || MARKET_ODDS_2026;
      state.marketProbs = powerTransform(raw, state.marketGamma);
      $("#dashboard").classList.add("recomputing");
      await new Promise((r) => requestAnimationFrame(r));
      recompute();
      renderAll();
      $("#dashboard").classList.remove("recomputing");
    });
  }
  const playersToggle = $("#players-toggle");
  if (playersToggle) {
    playersToggle.addEventListener("change", async () => {
      if (!playersToggle.checked) {
        state.players = null;
        $("#players-team-pick").hidden = true;
        renderPlayers();
        return;
      }
      await computePlayerMC();
    });
  }
  const teamSel = $("#players-team-select");
  if (teamSel) {
    teamSel.addEventListener("change", () => {
      state.playersTeamFilter = teamSel.value;
      if (state.players) renderPlayers();
    });
  }
  // Mega-table search (debounced) + position/league filters.
  const searchInput = $("#players-search");
  if (searchInput) {
    let deb = null;
    searchInput.addEventListener("input", () => {
      clearTimeout(deb);
      deb = setTimeout(() => {
        state.megaSearch = searchInput.value;
        if (state.players) renderPlayerMegaTable();
      }, 120);
    });
  }
  const posSel = $("#players-pos-select");
  if (posSel) {
    posSel.addEventListener("change", () => {
      state.megaPos = posSel.value;
      if (state.players) renderPlayerMegaTable();
    });
  }
  const leagueSel = $("#players-league-select");
  if (leagueSel) {
    leagueSel.addEventListener("change", () => {
      state.megaLeague = leagueSel.value;
      if (state.players) renderPlayerMegaTable();
    });
  }
  // Delegated clicks on the mega-table: header sort, pin checkbox, row expand.
  const megaWrap = $("#players-table");
  if (megaWrap) {
    megaWrap.addEventListener("click", (e) => {
      const th = e.target.closest("th[data-sort]");
      if (th) {
        const key = th.dataset.sort;
        if (key === "rank") return;
        if (state.megaSort.key === key) {
          state.megaSort.dir = state.megaSort.dir === "asc" ? "desc" : "asc";
        } else {
          state.megaSort = { key, dir: "desc" };
        }
        renderPlayerMegaTable();
        return;
      }
      if (e.target.classList.contains("pin-box")) {
        const name = e.target.dataset.player;
        togglePin(name, e.target.checked);
        return;
      }
      const row = e.target.closest("tr.player-row");
      if (row) {
        const name = row.dataset.player;
        state.expandedPlayer = state.expandedPlayer === name ? null : name;
        renderPlayerMegaTable();
      }
    });
  }
  // Compare-tray remove buttons.
  const tray = $("#players-compare");
  if (tray) {
    tray.addEventListener("click", (e) => {
      const btn = e.target.closest(".compare-pin-remove");
      if (btn) togglePin(btn.dataset.player, false);
    });
  }
}

function togglePin(name, on) {
  const idx = state.comparePins.indexOf(name);
  if (on && idx === -1) {
    if (state.comparePins.length >= 4) return;  // cap at 4
    state.comparePins.push(name);
  } else if (!on && idx !== -1) {
    state.comparePins.splice(idx, 1);
  }
  renderPlayerMegaTable();
  renderCompareTray();
}

function renderHistoryFanChart() {
  if (!state.titleHistory || !Array.isArray(state.titleHistory) || state.titleHistory.length === 0) {
    $("#history-card").hidden = true;
    return;
  }
  $("#history-card").hidden = false;
  const points = state.titleHistory;
  const topCodes = Object.entries(state.blendedTitle || state.mc.titleProbability)
    .sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c]) => c);
  const w = 720, h = 240, m = 30;
  const dates = points.map((p) => new Date(p.date).getTime());
  const xMin = Math.min(...dates), xMax = Math.max(...dates);
  const ys = points.flatMap((p) => topCodes.map((c) => p.titles?.[c] || 0));
  const yMax = Math.max(0.01, ...ys, 0.25);
  const x = (d) => xMax === xMin ? w / 2 : m + (d - xMin) / (xMax - xMin) * (w - 2 * m);
  const y = (v) => h - m - (v / yMax) * (h - 2 * m);
  const colors = ["#00d97e", "#ffd166", "#ef476f", "#7fa896", "#9b87f5", "#f59e0b"];
  const series = topCodes.map((code, i) => {
    const path = points.map((p, idx) => `${idx === 0 ? "M" : "L"}${x(new Date(p.date).getTime())},${y(p.titles?.[code] || 0)}`).join(" ");
    return `<g><path d="${path}" stroke="${colors[i]}" fill="none" stroke-width="2" opacity="0.85"/>
       <text x="${w - m + 4}" y="${y(points[points.length - 1].titles?.[code] || 0) + 4}" font-size="10" fill="${colors[i]}">${escape(teamName(code))}</text></g>`;
  }).join("");
  $("#title-history").innerHTML = `
    <svg viewBox="0 0 ${w + 60} ${h}" class="history-chart" aria-label="Title history">
      <line x1="${m}" y1="${h - m}" x2="${w - m}" y2="${h - m}" stroke="rgba(127,168,150,0.3)"/>
      <line x1="${m}" y1="${m}" x2="${m}" y2="${h - m}" stroke="rgba(127,168,150,0.3)"/>
      ${series}
      <text x="${m}" y="${h - 6}" font-size="10" fill="var(--muted)">${escape(new Date(xMin).toISOString().slice(0, 10))}</text>
      <text x="${w - m - 60}" y="${h - 6}" font-size="10" fill="var(--muted)">${escape(new Date(xMax).toISOString().slice(0, 10))}</text>
      <text x="${m - 22}" y="${m + 10}" font-size="10" fill="var(--muted)">${(yMax * 100).toFixed(0)}%</text>
    </svg>
  `;
}

/* ─────────── Compute pipeline ─────────── */

function recompute() {
  const baseOpts = {
    squadDelta: state.squadDelta,
    dcParams: state.dcParams,
    covariateProvider: state.covariateProvider,
    weights: DEFAULT_WEIGHTS,
    useHost: state.options.useHost,
    useSquad: state.options.useSquad,
    useDC: state.options.useDC,
    useMarket: state.options.useMarket,
    useCovariates: state.options.useCovariates,
  };
  if (state.bootstrap && state.bootstrapFits) {
    state.mc = runEnsembleMonteCarloBootstrap(
      TEAMS_2026, GROUPS_2026, hostCodes, ELO_2026,
      baseOpts,
      state.bootstrapFits,
      5000,
    );
  } else {
    state.mc = runEnsembleMonteCarlo(
      TEAMS_2026, GROUPS_2026, hostCodes, ELO_2026,
      baseOpts,
      ITERATIONS,
    );
  }
  if (state.options.useMarket) {
    state.blendedTitle = blendWithMarket(state.mc.titleProbability, state.marketProbs || MARKET_ODDS_2026, DEFAULT_WEIGHTS.market);
  } else {
    state.blendedTitle = state.mc.titleProbability;
  }
}

function buildCombinedTournaments() {
  // Merge knockout-only and group-stage match sets per year, so the
  // backtest sees as many matches as we have.
  const byYear = {};
  for (const t of HISTORICAL_KNOCKOUTS) {
    byYear[t.year] = {
      year: t.year, host: t.host, champion: t.champion, runnerUp: t.runnerUp,
      matches: [...t.matches],
    };
  }
  if (NEW_HISTORICAL_MATCHES) {
    for (const [yearStr, list] of Object.entries(NEW_HISTORICAL_MATCHES)) {
      const year = Number(yearStr);
      const existing = byYear[year] || { year, host: [], champion: null, matches: [] };
      // Avoid double-counting: HISTORICAL_KNOCKOUTS already has KO for
      // 2006/2010/2014/2018/2022. NEW_HISTORICAL_MATCHES adds group matches
      // for those plus full data (group+KO) for 1994/1998/2002.
      const existingKeys = new Set(existing.matches.map((m) => `${m.stage}|${m.teamA}|${m.teamB}|${m.scoreA}|${m.scoreB}`));
      for (const m of list) {
        const k = `${m.stage}|${m.teamA}|${m.teamB}|${m.scoreA}|${m.scoreB}`;
        if (!existingKeys.has(k)) {
          existing.matches.push(m);
          existingKeys.add(k);
        }
      }
      // Hosts: derive from the year's data if not already known.
      if (!existing.host?.length) {
        const HOST = { 1994: ["United States"], 1998: ["France"], 2002: ["South Korea", "Japan"] };
        existing.host = HOST[year] || [];
      }
      if (!existing.champion) {
        const CH = { 1994: "Brazil", 1998: "France", 2002: "Brazil" };
        existing.champion = CH[year];
      }
      byYear[year] = existing;
    }
  }
  return Object.values(byYear).sort((a, b) => a.year - b.year);
}

async function bootstrap() {
  const combined = buildCombinedTournaments();
  state.marketSnapshot = await loadMarketSnapshot();
  const rawMarket = state.marketSnapshot?.aggregated || MARKET_ODDS_2026;
  state.marketProbs = powerTransform(rawMarket, state.marketGamma);
  state.schedule = await loadSchedule();
  state.covariateProvider = state.schedule ? buildCovariateProvider(state.schedule) : null;
  state.titleHistory = await loadTitleHistory();
  state.playerProps = await loadPlayerProps();
  // 1. Fit DC on ALL historical matches (group + KO across all years).
  state.dcParams = fitDCOnHistorical(HISTORICAL_KNOCKOUTS, HISTORICAL_ELO, NEW_HISTORICAL_MATCHES);
  // 2. Squad-strength deltas.
  state.squadDelta = SQUAD_INDEX_2026 ? squadEloAdjustments(SQUAD_INDEX_2026) : null;
  // 3. RPS backtest + calibration on combined data.
  state.backtest = runRPSBacktest(combined, HISTORICAL_ELO, state.dcParams, state.squadDelta);
  state.calibration = calibrationBins(combined, HISTORICAL_ELO, state.dcParams, 8);
  // 4. Monte-Carlo for 2026.
  recompute();
}

function renderAll() {
  renderTop3();
  renderModelBreakdown();
  renderDistribution();
  renderStages();
  renderMarket();
  renderTeamMarketMatrix();
  renderGroups();
  renderPlayers();
  renderBacktest();
  renderCalibration();
  renderHistoryFanChart();
  renderContext();
  renderMethodology();
  fireConfetti();
}

/* ─────────── Player predictions ─────────── */

const playerToTeam = new Map();
const teamCodeOf = (name) => playerToTeam.get(name) || "";
for (const p of PLAYERS_2026) playerToTeam.set(p.name, p.code);

function renderPlayers() {
  if (!state.players || !state.players.players) {
    $("#players-table-wrap").hidden = true;
    return;
  }
  $("#players-table-wrap").hidden = false;
  const all = state.players.players;
  // Full sortable/filterable mega-table of all 1163 players.
  populatePlayerFilterSelects();
  renderPlayerMegaTable();
  renderCompareTray();
  // Top Golden Boot probabilities
  const gb = all
    .filter((r) => r.pGoldenBoot > 0.005)
    .sort((a, b) => b.pGoldenBoot - a.pGoldenBoot)
    .slice(0, 10);
  const gbMax = gb[0]?.pGoldenBoot || 0.01;
  $("#players-goldenboot").innerHTML = gb.map((r) => `
    <div class="dist-row">
      <div class="dist-team">${escape(r.name)} <span class="muted small">${escape(teamName(teamCodeOf(r.name)) || "—")}</span></div>
      <div class="dist-bar"><div class="dist-fill" style="width:${(r.pGoldenBoot / gbMax) * 100}%"></div></div>
      <div class="dist-prob">${pct(r.pGoldenBoot, 2)}</div>
    </div>
  `).join("");
  // Cards section (yellow + red top-10)
  renderPlayerCards();
  // Player prop comparisons
  renderPlayerPropMarket("topscorer");
  renderPlayerPropMarket("anytime");
  // Goal-minute heatmap
  const md = state.players.minuteDistribution || {};
  const maxBin = Math.max(...Object.values(md), 0.01);
  $("#players-minutes").innerHTML = `
    <div class="minute-grid">
      ${GOAL_MINUTE_BINS.map((b) => {
        const p = md[b.label] || 0;
        const intensity = (p / maxBin).toFixed(3);
        return `<div class="minute-cell" style="--p:${intensity}">
          <div class="minute-label">${escape(b.label)}</div>
          <div class="minute-val">${pct(p, 1)}</div>
        </div>`;
      }).join("")}
    </div>
    <p class="muted small">Sampled from ${state.players.totalGoalsSampled.toLocaleString()} goals across ${state.mc.iterations.toLocaleString()} simulated tournaments.</p>
  `;
}

/* ─────────── Per-player mega-table ─────────── */

// Lazily-built per-team fallback flags (does the team use position-default
// goal shares because it has <3 Big-5 players?).
let _teamFallbackCache = null;
function teamUsesFallback(code) {
  if (!_teamFallbackCache) {
    _teamFallbackCache = new Map();
    const seen = new Set(PLAYERS_2026.map((p) => p.code));
    for (const c of seen) {
      const shares = teamScoringShares(c, "goal");
      _teamFallbackCache.set(c, shares ? !!shares.fallback : true);
    }
  }
  return _teamFallbackCache.get(code) || false;
}

// Master roster join: all 1163 PLAYERS_2026 left-joined with the sparse MC
// output. Memoized on state.players identity.
function buildPlayerRows() {
  if (state.playerRowsCache && state.playerRowsCacheKey === state.players) {
    return state.playerRowsCache;
  }
  const mcByName = new Map();
  for (const p of state.players.players) mcByName.set(p.name, p);
  const rows = PLAYERS_2026.map((p) => {
    const mc = mcByName.get(p.name) || null;
    const hasGoalBasis = p.npxG90 != null;
    const sampledGoals = mc?.goalDist?.sampled ?? 0;
    return {
      name: p.name,
      code: p.code,
      team: teamName(p.code),
      pos: p.pos,
      club: p.club,
      league: p.league,
      captain: !!p.captain,
      notes: p.notes || "",
      npxG90: p.npxG90,
      xA90: p.xA90,
      minShare: DEFAULT_MIN_SHARE[p.pos] ?? null,
      leagueStrength: LEAGUE_STRENGTH[p.league] ?? LEAGUE_STRENGTH.Other,
      fallback: teamUsesFallback(p.code),
      isBig5: BIG5_LEAGUES.has(p.league),
      expGoals: mc?.expGoals ?? 0,
      expAssists: mc?.expAssists ?? 0,
      pScoresAnyMatch: mc?.pScoresAnyMatch ?? 0,
      pGoldenBoot: mc?.pGoldenBoot ?? 0,
      expYellow: mc?.expYellow ?? 0,
      expRed: mc?.expRed ?? 0,
      pSuspended: mc?.pSuspended ?? 0,
      goalDist: mc?.goalDist ?? null,
      minuteBins: mc?.minuteBins ?? {},
      hasGoalBasis,
      sampledGoals,
      // A goal metric is "n/v" when there's no xG basis AND the player never
      // got a sampled goal (truly no information). Fallback-team players get
      // position-default sampled goals, so they show real numbers.
      goalNv: !hasGoalBasis && sampledGoals === 0,
    };
  });
  state.playerRowsCache = rows;
  state.playerRowsCacheKey = state.players;
  return rows;
}

// Column definitions for the mega-table. `num` = numeric sort; `nvGoal` =
// shows n/v when row.goalNv; `fmt` renders the cell value.
const MEGA_COLS = [
  { key: "name",            type: "str",  cls: "" },
  { key: "team",            type: "str",  cls: "muted" },
  { key: "pos",             type: "str",  cls: "muted" },
  { key: "club",            type: "str",  cls: "muted" },
  { key: "league",          type: "str",  cls: "muted" },
  { key: "npxG90",          type: "num",  cls: "num", fmt: (r) => r.npxG90 == null ? nv() : r.npxG90.toFixed(2) },
  { key: "xA90",            type: "num",  cls: "num", fmt: (r) => r.xA90 == null ? nv() : r.xA90.toFixed(2) },
  { key: "expGoals",        type: "num",  cls: "num", nvGoal: true, fmt: (r) => r.expGoals.toFixed(2) },
  { key: "expAssists",      type: "num",  cls: "num", nvGoal: true, fmt: (r) => r.expAssists.toFixed(2) },
  { key: "pScoresAnyMatch", type: "num",  cls: "num", nvGoal: true, fmt: (r) => pct(r.pScoresAnyMatch, 1) },
  { key: "pGoldenBoot",     type: "num",  cls: "num", nvGoal: true, fmt: (r) => pct(r.pGoldenBoot, 2) },
  { key: "p0",              type: "num",  cls: "num", nvGoal: true, fmt: (r) => r.goalDist ? pct(r.goalDist.p0, 1) : nv() },
  { key: "p2plus",          type: "num",  cls: "num", nvGoal: true, fmt: (r) => r.goalDist ? pct(r.goalDist.p2plus, 1) : nv() },
  { key: "expYellow",       type: "num",  cls: "num", fmt: (r) => r.expYellow.toFixed(2) },
  { key: "expRed",          type: "num",  cls: "num", fmt: (r) => r.expRed.toFixed(3) },
  { key: "pSuspended",      type: "num",  cls: "num", fmt: (r) => pct(r.pSuspended, 1) },
];

function nv() { return `<span class="muted nv">n/v</span>`; }

// Sort value for a column key; null/n-v sort to the end regardless of dir.
function megaSortVal(row, key) {
  switch (key) {
    case "name": return row.name;
    case "team": return row.team;
    case "pos": return row.pos;
    case "club": return row.club;
    case "league": return row.league;
    case "npxG90": return row.npxG90;
    case "xA90": return row.xA90;
    case "p0": return row.goalDist ? row.goalDist.p0 : null;
    case "p2plus": return row.goalDist ? row.goalDist.p2plus : null;
    default: return row[key];
  }
}

function filteredSortedRows() {
  const rows = buildPlayerRows();
  const q = state.megaSearch.trim().toLowerCase();
  const pos = state.megaPos;
  const league = state.megaLeague;
  const team = state.playersTeamFilter;
  let out = rows.filter((r) => {
    if (team && r.code !== team) return false;
    if (pos && r.pos !== pos) return false;
    if (league && r.league !== league) return false;
    if (q && !(r.name.toLowerCase().includes(q) || r.club.toLowerCase().includes(q))) return false;
    return true;
  });
  const { key, dir } = state.megaSort;
  const mult = dir === "asc" ? 1 : -1;
  const col = MEGA_COLS.find((c) => c.key === key);
  const isStr = col && col.type === "str";
  out = out.slice().sort((a, b) => {
    const va = megaSortVal(a, key);
    const vb = megaSortVal(b, key);
    const na = va == null, nb = vb == null;
    if (na && nb) return a.name.localeCompare(b.name);
    if (na) return 1;   // nulls always last
    if (nb) return -1;
    if (isStr) return mult * String(va).localeCompare(String(vb));
    return mult * (va - vb);
  });
  return out;
}

function megaTbodyHtml(rows) {
  return rows.map((r, i) => {
    const pinned = state.comparePins.includes(r.name);
    const expanded = state.expandedPlayer === r.name;
    const cells = MEGA_COLS.map((c) => {
      const showNv = c.nvGoal && r.goalNv;
      const val = showNv ? nv() : (c.fmt ? c.fmt(r) : escape(String(r[c.key] ?? "")));
      const cap = c.key === "name" && r.captain ? ` <span class="cap-badge" title="Captain">C</span>` : "";
      const fb = c.key === "name" && r.fallback && r.isBig5 === false ? "" : "";
      return `<td class="${c.cls}">${val}${cap}${fb}</td>`;
    }).join("");
    return `<tr class="player-row${expanded ? " expanded" : ""}" data-player="${escape(r.name)}">
      <td class="pin-cell"><input type="checkbox" class="pin-box" data-player="${escape(r.name)}"${pinned ? " checked" : ""}></td>
      <td class="num">${i + 1}</td>
      ${cells}
    </tr>${expanded ? renderPlayerDetailRow(r) : ""}`;
  }).join("");
}

function renderPlayerMegaTable() {
  const dict = t();
  const cols = dict.playerCols;
  const rows = filteredSortedRows();
  const { key, dir } = state.megaSort;
  const sortCls = (k) => k === key ? (dir === "asc" ? "sorted-asc" : "sorted-desc") : "";
  const labelFor = {
    name: cols.name, team: cols.team, pos: cols.pos, club: cols.club, league: cols.league,
    npxG90: cols.npxg, xA90: cols.xa, expGoals: cols.expGoals, expAssists: cols.expAssists,
    pScoresAnyMatch: cols.pAny, pGoldenBoot: cols.pBoot, p0: cols.p0, p2plus: cols.p2plus,
    expYellow: cols.yellow, expRed: cols.red, pSuspended: cols.suspended,
  };
  const headCells = MEGA_COLS.map((c) =>
    `<th data-sort="${c.key}" class="${sortCls(c.key)}">${escape(labelFor[c.key] || c.key)}</th>`
  ).join("");
  const totalCols = MEGA_COLS.length + 2;
  $("#players-table").innerHTML = `
    <p class="muted small">${escape(dict.playersMegaHint || "")} <strong>${rows.length}</strong></p>
    <div class="mega-scroll">
      <table class="team-matrix mega-table">
        <thead><tr>
          <th class="pin-col">${escape(cols.pin || "≡")}</th>
          <th data-sort="rank">#</th>
          ${headCells}
        </tr></thead>
        <tbody>${megaTbodyHtml(rows)}</tbody>
      </table>
    </div>
  `;
  $("#players-table").dataset.totalCols = String(totalCols);
}

function renderPlayerDetailRow(r) {
  const dict = t();
  const d = dict.detailLabels || {};
  const totalCols = MEGA_COLS.length + 2;
  // Model inputs
  const inputs = `
    <div class="detail-block">
      <h5>${escape(d.modelInputs || "Model inputs")}</h5>
      <ul class="detail-list">
        <li><span>npxG/90</span><b>${r.npxG90 == null ? nv() : r.npxG90.toFixed(2)}</b></li>
        <li><span>xA/90</span><b>${r.xA90 == null ? nv() : r.xA90.toFixed(2)}</b></li>
        <li><span>${escape(d.minShare || "Minute share")}</span><b>${r.minShare == null ? "—" : r.minShare.toFixed(2)}</b></li>
        <li><span>${escape(d.leagueStrength || "League strength")}</span><b>${r.leagueStrength.toFixed(2)}</b></li>
        <li><span>Club</span><b>${escape(r.club)}</b></li>
        <li><span>Liga</span><b>${escape(r.league)}</b></li>
      </ul>
      ${r.fallback && !r.isBig5 ? `<p class="muted small pos-default-note">${escape(d.fallbackNote || "Position-default weights")}</p>` : ""}
      ${r.goalNv ? `<p class="muted small">${escape(d.nvGoals || "n/v — no xG basis")}</p>` : ""}
    </div>`;
  // Goal-count distribution
  let goalDistBlock;
  if (r.goalDist && !r.goalNv) {
    const gd = r.goalDist;
    const bars = [
      { lab: "P(0)", v: gd.p0 },
      { lab: "P(1)", v: gd.p1 },
      { lab: "P(≥2)", v: gd.p2plus },
      { lab: d.hat || "P(hat-trick)", v: gd.pHat },
    ];
    const mx = Math.max(...bars.map((b) => b.v), 0.01);
    goalDistBlock = `
      <div class="detail-block">
        <h5>${escape(d.goalDist || "Goal-count distribution")}</h5>
        ${bars.map((b) => `
          <div class="dist-row">
            <div class="dist-team">${escape(b.lab)}</div>
            <div class="dist-bar"><div class="dist-fill" style="width:${(b.v / mx) * 100}%"></div></div>
            <div class="dist-prob">${pct(b.v, 1)}</div>
          </div>`).join("")}
      </div>`;
  } else {
    goalDistBlock = `<div class="detail-block"><h5>${escape(d.goalDist || "Goal-count distribution")}</h5><p class="muted small">${nv()}</p></div>`;
  }
  // Per-player minute heatmap
  const mb = r.minuteBins || {};
  const hasMin = Object.keys(mb).length > 0;
  const mbMax = hasMin ? Math.max(...Object.values(mb), 0.01) : 0.01;
  const minuteBlock = `
    <div class="detail-block">
      <h5>${escape(d.minuteDist || "This player's goal-time profile")}</h5>
      ${hasMin ? `<div class="minute-grid">
        ${GOAL_MINUTE_BINS.map((b) => {
          const p = mb[b.label] || 0;
          return `<div class="minute-cell" style="--p:${(p / mbMax).toFixed(3)}">
            <div class="minute-label">${escape(b.label)}</div>
            <div class="minute-val">${pct(p, 0)}</div>
          </div>`;
        }).join("")}
      </div>` : `<p class="muted small">${nv()}</p>`}
    </div>`;
  // Market comparison for this player
  const ts = state.playerProps?.topScorer?.[r.name]?.aggregated ?? null;
  const as = state.playerProps?.anytimeScorer?.[r.name]?.aggregated ?? null;
  const diffSpan = (model, market) => {
    if (market == null) return `<span class="muted">n/v</span>`;
    const dd = model - market;
    const sign = dd >= 0 ? "+" : "−";
    return `<span class="${dd >= 0 ? "edge-up" : "edge-down"}">${sign}${(Math.abs(dd) * 100).toFixed(1)} pp</span>`;
  };
  const marketBlock = `
    <div class="detail-block">
      <h5>${escape(d.marketComp || "Market comparison")}</h5>
      <ul class="detail-list">
        <li><span>Top scorer</span><b>${r.goalNv ? nv() : pct(r.pGoldenBoot, 2)} ${ts != null ? `· ${pct(ts, 2)} ${diffSpan(r.pGoldenBoot, ts)}` : "· n/v"}</b></li>
        <li><span>Anytime</span><b>${r.goalNv ? nv() : pct(r.pScoresAnyMatch, 1)} ${as != null ? `· ${pct(as, 1)} ${diffSpan(r.pScoresAnyMatch, as)}` : "· n/v"}</b></li>
      </ul>
    </div>`;
  return `<tr class="player-detail"><td colspan="${totalCols}">
    <div class="detail-grid">${inputs}${goalDistBlock}${minuteBlock}${marketBlock}</div>
  </td></tr>`;
}

function renderCompareTray() {
  const dict = t();
  const c = dict.compareLabels || {};
  const tray = $("#players-compare");
  if (!tray) return;
  if (state.comparePins.length === 0) {
    tray.hidden = true;
    tray.innerHTML = "";
    return;
  }
  tray.hidden = false;
  const rows = buildPlayerRows();
  const pinned = state.comparePins
    .map((name) => rows.find((r) => r.name === name))
    .filter(Boolean);
  const metricRows = [
    { lab: dict.playerCols.expGoals, fmt: (r) => r.goalNv ? nv() : r.expGoals.toFixed(2) },
    { lab: dict.playerCols.expAssists, fmt: (r) => r.goalNv ? nv() : r.expAssists.toFixed(2) },
    { lab: dict.playerCols.pAny, fmt: (r) => r.goalNv ? nv() : pct(r.pScoresAnyMatch, 1) },
    { lab: dict.playerCols.pBoot, fmt: (r) => r.goalNv ? nv() : pct(r.pGoldenBoot, 2) },
    { lab: dict.playerCols.p0, fmt: (r) => r.goalDist && !r.goalNv ? pct(r.goalDist.p0, 1) : nv() },
    { lab: dict.playerCols.p2plus, fmt: (r) => r.goalDist && !r.goalNv ? pct(r.goalDist.p2plus, 1) : nv() },
    { lab: (dict.detailLabels?.hat) || "P(hat-trick)", fmt: (r) => r.goalDist && !r.goalNv ? pct(r.goalDist.pHat, 1) : nv() },
    { lab: dict.playerCols.yellow, fmt: (r) => r.expYellow.toFixed(2) },
    { lab: dict.playerCols.red, fmt: (r) => r.expRed.toFixed(3) },
    { lab: dict.playerCols.suspended, fmt: (r) => pct(r.pSuspended, 1) },
    { lab: dict.playerCols.npxg, fmt: (r) => r.npxG90 == null ? nv() : r.npxG90.toFixed(2) },
    { lab: dict.playerCols.xa, fmt: (r) => r.xA90 == null ? nv() : r.xA90.toFixed(2) },
  ];
  tray.innerHTML = `
    <div class="compare-head">
      <strong>${escape(c.title || "Compare players")}</strong>
    </div>
    <div class="mega-scroll">
      <table class="team-matrix compare-table">
        <thead><tr>
          <th></th>
          ${pinned.map((r) => `<th>${escape(r.name)}<br><span class="muted small">${escape(r.team)}</span>
            <button class="compare-pin-remove" data-player="${escape(r.name)}" title="${escape(c.remove || "Remove")}">×</button></th>`).join("")}
        </tr></thead>
        <tbody>
          ${metricRows.map((m) => `<tr>
            <td class="metric-label">${escape(m.lab)}</td>
            ${pinned.map((r) => `<td class="num">${m.fmt(r)}</td>`).join("")}
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function populatePlayerFilterSelects() {
  const dict = t();
  const posSel = $("#players-pos-select");
  if (posSel && !posSel.dataset.filled) {
    const positions = ["GK", "DEF", "MID", "FW"];
    posSel.innerHTML = `<option value="">${escape(dict.playersPosAll || "— all —")}</option>` +
      positions.map((p) => `<option value="${p}">${p}</option>`).join("");
    posSel.dataset.filled = "1";
  }
  const leagueSel = $("#players-league-select");
  if (leagueSel && !leagueSel.dataset.filled) {
    const leagues = [...new Set(PLAYERS_2026.map((p) => p.league))].sort();
    leagueSel.innerHTML = `<option value="">${escape(dict.playersLeagueAll || "— all —")}</option>` +
      leagues.map((l) => `<option value="${escape(l)}">${escape(l)}</option>`).join("");
    leagueSel.dataset.filled = "1";
  }
}

async function computePlayerMC() {
  $("#dashboard").classList.add("recomputing");
  await new Promise((r) => requestAnimationFrame(r));
  // 8 000-iter MC with per-player goal allocation. We trade total
  // iterations for player detail; the main 25 000-MC numbers stay in
  // state.mc and still drive the headline title/stage tables.
  const playerOpts = {
    squadDelta: state.squadDelta,
    dcParams: state.dcParams,
    covariateProvider: state.covariateProvider,
    weights: DEFAULT_WEIGHTS,
    useHost: state.options.useHost,
    useSquad: state.options.useSquad,
    useDC: state.options.useDC,
    useMarket: state.options.useMarket,
    useCovariates: state.options.useCovariates,
    trackPlayers: true,
  };
  const res = runEnsembleMonteCarlo(
    TEAMS_2026, GROUPS_2026, hostCodes, ELO_2026,
    playerOpts, 8000,
  );
  state.players = res.players;
  $("#players-team-pick").hidden = false;
  populatePlayersTeamSelect();
  renderPlayers();
  $("#dashboard").classList.remove("recomputing");
}

function renderPlayerCards() {
  const dict = t();
  const all = state.players?.players || [];
  const byYellow = all
    .filter((r) => r.expYellow > 0.05)
    .slice()
    .sort((a, b) => b.expYellow - a.expYellow)
    .slice(0, 10);
  if (byYellow.length === 0) {
    $("#players-cards").innerHTML = `<p class="muted small">—</p>`;
    return;
  }
  const cols = dict.playerCols;
  $("#players-cards").innerHTML = `
    <table class="stages-table">
      <thead><tr>
        <th>${escape(cols.rank)}</th>
        <th>${escape(cols.name)}</th>
        <th>${escape(cols.team)}</th>
        <th>${escape(cols.yellow)}</th>
        <th>${escape(cols.red)}</th>
        <th>${escape(cols.suspended)}</th>
      </tr></thead>
      <tbody>${byYellow.map((row, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${escape(row.name)}</td>
          <td class="muted">${escape(teamName(teamCodeOf(row.name)) || "—")}</td>
          <td class="num">${row.expYellow.toFixed(2)}</td>
          <td class="num">${row.expRed.toFixed(3)}</td>
          <td class="num">${pct(row.pSuspended, 1)}</td>
        </tr>
      `).join("")}</tbody>
    </table>
  `;
}

function renderPlayerPropMarket(kind) {
  const dict = t();
  const propData = state.playerProps?.[kind === "topscorer" ? "topScorer" : "anytimeScorer"] || {};
  const containerId = kind === "topscorer" ? "#players-topscorer-market" : "#players-anytime-market";
  const allPlayers = state.players?.players || [];
  const modelKey = kind === "topscorer" ? "pGoldenBoot" : "pScoresAnyMatch";
  const filter = state.playersTeamFilter;
  // Build a row per player with model+market+diff. Filtered by team
  // dropdown like the top-30 table.
  const rows = allPlayers
    .filter((r) => !filter || teamCodeOf(r.name) === filter)
    .map((r) => {
      const market = propData[r.name]?.aggregated ?? null;
      const model = r[modelKey] || 0;
      return {
        name: r.name,
        team: teamCodeOf(r.name),
        model,
        market,
        diff: market != null ? model - market : null,
      };
    })
    // Sort: players with market quotes first by |diff|, rest by model.
    .sort((a, b) => {
      if (a.market != null && b.market != null) return Math.abs(b.diff) - Math.abs(a.diff);
      if (a.market != null) return -1;
      if (b.market != null) return 1;
      return b.model - a.model;
    })
    .slice(0, 25);
  const cols = dict.propCols;
  const formatDiff = (d) => {
    if (d == null) return `<span class="muted">—</span>`;
    const sign = d >= 0 ? "+" : "−";
    const cls = d >= 0 ? "edge-up" : "edge-down";
    return `<span class="${cls}">${sign}${(Math.abs(d) * 100).toFixed(1)} pp</span>`;
  };
  $(containerId).innerHTML = `
    <table class="stages-table">
      <thead><tr>
        <th>${escape(cols.rank)}</th>
        <th>${escape(cols.name)}</th>
        <th>${escape(cols.team)}</th>
        <th>${escape(cols.model)}</th>
        <th>${escape(cols.market)}</th>
        <th>${escape(cols.diff)}</th>
      </tr></thead>
      <tbody>${rows.map((r, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${escape(r.name)}</td>
          <td class="muted">${escape(teamName(r.team) || "—")}</td>
          <td class="num">${pct(r.model, kind === "topscorer" ? 2 : 1)}</td>
          <td class="num">${r.market != null ? pct(r.market, kind === "topscorer" ? 2 : 1) : `<span class="muted">n/v</span>`}</td>
          <td class="num">${formatDiff(r.diff)}</td>
        </tr>
      `).join("")}</tbody>
    </table>
    <p class="muted small">${escape(dict.propDiffLegend)}</p>
  `;
}

function populatePlayersTeamSelect() {
  const sel = $("#players-team-select");
  if (!sel) return;
  const codes = [...new Set(PLAYERS_2026.map((p) => p.code))]
    .map((c) => ({ c, name: teamName(c) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  sel.innerHTML = `<option value="">— all —</option>` +
    codes.map(({ c, name }) => `<option value="${c}">${escape(name)}</option>`).join("");
  sel.value = state.playersTeamFilter;
}

function fireConfetti() {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = $("#confetti");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  canvas.style.width = innerWidth + "px";
  canvas.style.height = innerHeight + "px";
  ctx.scale(dpr, dpr);
  const colors = ["#00d97e", "#ffd166", "#ef476f", "#7fa896", "#ffffff"];
  const parts = Array.from({ length: 100 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 80, y: 200,
    vx: (Math.random() - 0.5) * 8, vy: -Math.random() * 9 - 3,
    g: 0.25 + Math.random() * 0.15, size: 4 + Math.random() * 5,
    rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
    color: colors[Math.floor(Math.random() * colors.length)],
    life: 0, max: 90 + Math.random() * 40,
  }));
  let raf;
  function frame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = 0;
    for (const p of parts) {
      if (p.life > p.max) continue;
      alive++; p.life++; p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, 1 - p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.4);
      ctx.restore();
    }
    if (alive > 0) raf = requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  frame();
}

document.addEventListener("DOMContentLoaded", async () => {
  applyI18n();
  $$(".lang-btn").forEach((b) => b.addEventListener("click", () => {
    state.locale = b.dataset.lang;
    document.documentElement.lang = state.locale;
    $$(".lang-btn").forEach((el) => el.classList.toggle("active", el.dataset.lang === state.locale));
    applyI18n();
    if (state.mc) renderAll();
  }));
  $("#toggle-distribution").addEventListener("click", () => {
    state.showAll = !state.showAll;
    renderDistribution();
  });
  setupScenarios();
  requestAnimationFrame(async () => {
    await new Promise((r) => setTimeout(r, 30));
    await bootstrap();
    $("#loading").hidden = true;
    $("#dashboard").hidden = false;
    renderAll();
    // Auto-run the per-player MC so players/cards/markets show up
    // immediately without the user having to flip a toggle.
    const playersToggle = $("#players-toggle");
    if (playersToggle) {
      playersToggle.checked = true;
      await computePlayerMC();
    }
  });
});
