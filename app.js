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
import { bootstrapDC, dcScoreProb } from "./models/dixonColes.js";
import { squadEloAdjustments } from "./models/squad.js";
import { DEFAULT_WEIGHTS } from "./models/ensemble.js";
import { aggregateMarket, deVig } from "./models/market.js";
import { buildCovariateProvider } from "./predictor.js";
import { PLAYERS_2026, BIG5_LEAGUES } from "./data/players-2026.js";
import { GOAL_MINUTE_BINS, DEFAULT_MIN_SHARE, LEAGUE_STRENGTH, teamScoringShares } from "./models/players.js";
import { buildAllMatchForecasts } from "./models/matchForecast.js";
import { deriveMarkets, settleMarket } from "./models/markets.js";

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

async function loadFreshness() {
  try {
    const resp = await fetch("./data/freshness.json", { cache: "no-store" });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

async function loadMatchOdds() {
  try {
    const resp = await fetch("./data/match-odds.json", { cache: "no-store" });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

async function loadForecastSnapshot() {
  try {
    const resp = await fetch("./data/forecast-snapshot.json", { cache: "no-store" });
    if (!resp.ok) return null;
    const snap = await resp.json();
    if (!snap?.matchForecasts || !snap?.titleProbability) return null;
    return snap;
  } catch {
    return null;
  }
}

async function loadLive(signal) {
  try {
    const resp = await fetch("/api/live", { cache: "no-store", signal });
    if (!resp.ok) return null;
    return await resp.json();
  } catch (err) {
    if (err?.name === "AbortError") return null;
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
  // Freshness + diff + live
  freshness: null,
  prev: null,                   // baseline snapshot for inline diff arrows
  diff: null,                   // { totalChanges, title:{}, stages:{}, market:{} }
  live: null,                   // /api/live payload
  livePolling: null,            // setInterval handle
  liveAbort: null,              // AbortController for in-flight fetch
  refreshing: false,            // refresh-button spinner gate
  liveOverride: false,          // force live-polling regardless of schedule window
  liveError: null,              // last /api/live fetch error message (null on success)
  liveScheduleMap: null,        // Map<providerMatchNo → internalMatchNo (1-104)>
  // Tab navigation
  activeTab: "overview",
  // Multiplayer (Supabase) — null until /api/config.js says we're configured
  supabase: null,
  supabaseUser: null,
  activeRoom: null,         // { id, code, name }
  roomMembers: [],          // [{ user_id, nickname, joined_at }]
  roomBets: [],             // [{ id, user_id, room_id, ... }] for active room
  roomChannel: null,        // realtime subscription handle
  authPending: false,
  // Real-money pools (PR C)
  pools: [],                // active pools in the current room
  poolMembers: {},          // pool_id → [members]
  poolPredictions: {},      // pool_id → [predictions]
  paymentHandles: {},       // own handles row
  roomHandles: {},          // user_id → handles row (for "pay to" links)
  // Bet simulator
  matchOdds: null,              // data/match-odds.json payload (per-match bookmaker quotes)
  betSlip: [],                  // [{matchNo, marketId, label, modelP, modelOdds, marketOdds, outcome}]
  betHistory: [],               // placed bets — see settleFinishedBets()
  betStake: 10,
  betSlipCollapsed: false,
  // Push notifications (PR F)
  notifyEnabled: false,         // user opted in
  notifiedKickoffs: new Set(),  // matchNo's we've already pre-kickoff-pinged
  notifiedSettled: new Set(),   // bet IDs we've already settle-pinged
  notifiedFriendBets: new Set(),
  // Single-open explainer slots — one per surface
  expandedTeam: null,
  expandedStage: null,
  expandedMatrix: null,         // { code, stageKey }
  expandedBacktestYear: null,
  expandedCalibrationBin: null,
  expandedHistoryDate: null,
  expandedGroupTeam: null,
  // Match-forecast state
  matchForecasts: null,         // Map<matchNo, { stage, matchups: [...] }>
  expandedMatch: null,          // currently-open match number
  scheduleFilter: { stage: "", group: "", date: "" },
  backtestPerMatch: {},         // lazy cache: { [year]: [matches] }
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
  // Dot-path lookup so attributes can reference nested keys like
  // `freshness.liveToggleStart` without hoisting every string to top-level.
  const lookup = (key) => key.split(".").reduce((d, k) => d?.[k], dict);
  $$("[data-i18n]").forEach((el) => {
    const val = lookup(el.getAttribute("data-i18n"));
    if (typeof val === "string") el.textContent = val;
  });
  $$("[data-i18n-placeholder]").forEach((el) => {
    const val = lookup(el.getAttribute("data-i18n-placeholder"));
    if (typeof val === "string") el.setAttribute("placeholder", val);
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
    <div class="top-card top-rank-${i + 1}${state.expandedTeam === row.code ? " expanded" : ""}" data-team="${row.code}">
      <div class="top-rank">${i + 1}</div>
      <div class="top-team">${escape(teamName(row.code))}</div>
      <div class="top-meta">${escape(teamByCode[row.code]?.confederation || "")}</div>
      <div class="top-prob">${pct(row.p, 1)}${trendArrow(row.code, "title")}</div>
      <div class="top-bar"><div class="top-bar-fill" style="width:${Math.min(100, row.p * 350)}%"></div></div>
      <div class="top-sub">
        <span>SF ${pct(state.mc.semisProbability[row.code] || 0, 0)}</span>
        <span>QF ${pct(state.mc.quartersProbability[row.code] || 0, 0)}</span>
      </div>
      ${state.expandedTeam === row.code ? `<div class="explain-panel">${renderTeamExplainPanel(row.code)}</div>` : ""}
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
    <tr class="stage-row${state.expandedStage === r.code ? " expanded" : ""}" data-team="${r.code}">
      <td>${escape(teamName(r.code))}</td>
      <td class="num">${pct(r.market, 1)}</td>
      <td class="num">${pct(r.r32, 0)}</td>
      <td class="num">${pct(r.r16, 0)}</td>
      <td class="num">${pct(r.qf, 0)}</td>
      <td class="num">${pct(r.sf, 0)}</td>
      <td class="num">${pct(r.finalP, 1)}</td>
      <td class="num accent">${pct(r.tp, 2)}${trendArrow(r.code, "titleProbability")}</td>
      <td class="num small">${pct(r.sd, 2)}</td>
      <td class="num small">${r.totalSD == null ? "—" : pct(r.totalSD, 2)}</td>
      <td class="num small">[${pct(r.ciLow, 1)}, ${pct(r.ciHigh, 1)}]</td>
      <td class="num">${r.surprise === Infinity ? "—" : r.surprise.toFixed(1)}</td>
    </tr>${state.expandedStage === r.code ? `<tr class="explain-detail"><td colspan="12">${renderStageExplainPanel(r.code)}</td></tr>` : ""}
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
    <div class="dist-row${state.expandedTeam === r.code ? " expanded" : ""}" data-team="${r.code}">
      <div class="dist-team">${escape(teamName(r.code))}</div>
      <div class="dist-bar"><div class="dist-fill" style="width:${(r.p / maxP) * 100}%"></div></div>
      <div class="dist-prob">${pct(r.p, r.p < 0.01 ? 2 : 1)}${trendArrow(r.code, "title")}</div>
      <div class="dist-extra muted">SF ${pct(r.semi, 0)} · Adv ${pct(r.advance, 0)}</div>
      ${state.expandedTeam === r.code ? `<div class="explain-panel">${renderTeamExplainPanel(r.code)}</div>` : ""}
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
      <div class="market-row${state.expandedTeam === r.code ? " expanded" : ""}" data-team="${r.code}">
        <div class="market-team">${escape(teamName(r.code))}</div>
        <div class="market-bars">
          <div class="market-bar"><div class="market-fill model" style="width:${(r.model / maxV) * 100}%"></div><span class="market-val">${pct(r.model, 1)}${trendArrow(r.code, "title")}</span></div>
          <div class="market-bar"><div class="market-fill market" style="width:${(r.market / maxV) * 100}%"></div><span class="market-val">${pct(r.market, 1)}${trendArrow(r.code, "market")}</span></div>
        </div>
        ${state.expandedTeam === r.code ? `<div class="explain-panel">${renderTeamExplainPanel(r.code)}</div>` : ""}
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
      <tbody>${rows.map((row) => {
        const isExpanded = state.expandedMatrix?.code === row.code;
        const expandedStage = state.expandedMatrix?.stageKey;
        const cells = MATRIX_STAGES.map((stage) => {
          const s = row.stages[stage.key];
          const open = isExpanded && expandedStage === stage.modelKey ? " open" : "";
          return `<td class="matrix-cell-wrap${open}" data-team="${row.code}" data-stage="${stage.modelKey}">
              <div class="matrix-cell">
                <span class="mc-model">${pct(s.model, s.model < 0.01 ? 2 : 1)}</span>
                <span class="mc-market">${s.market != null ? pct(s.market, s.market < 0.01 ? 2 : 1) : "n/v"}</span>
                <span class="mc-diff">${renderDiff(s.diff)}</span>
              </div>
            </td>`;
        }).join("");
        const explainRow = isExpanded
          ? `<tr class="explain-detail"><td colspan="${MATRIX_STAGES.length + 1}">${renderMatrixCellExplain(row.code, expandedStage || "titleProbability")}</td></tr>`
          : "";
        return `<tr><td class="team-name">${escape(row.name)}</td>${cells}</tr>${explainRow}`;
      }).join("")}</tbody>
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
            ${rows.map((r, i) => {
              const expanded = state.expandedGroupTeam === r.code;
              return `<tr class="group-team-row${i < 2 ? " advance" : ""}${expanded ? " expanded" : ""}" data-team="${r.code}">
                <td>${i + 1}</td>
                <td>${escape(teamName(r.code))}</td>
                <td>${r.avg.toFixed(2)}</td>
                <td>${pct(r.adv || 0, 0)}</td>
              </tr>${expanded ? `<tr class="explain-detail"><td colspan="4">${renderGroupTeamExplain(r.code)}</td></tr>` : ""}`;
            }).join("")}
          </tbody>
        </table>
        ${renderGroupMatchList(letter)}
      </div>
    `;
  }).join("");
}

/* ─────────── Backtest (RPS + log-loss) ─────────── */

function renderBacktest() {
  const dict = t();
  const rows = state.backtest.perTournament.map((r) => {
    const expanded = state.expandedBacktestYear === r.year;
    return `<tr class="bt-row-click${expanded ? " expanded" : ""}" data-year="${r.year}">
      <td class="bt-year">${r.year}</td>
      <td>${escape(teamNameEN(r.actualChampion))}</td>
      <td>${r.n}</td>
      <td class="num">${r.rpsElo?.toFixed(3) ?? "—"}</td>
      <td class="num">${r.rpsDC?.toFixed(3) ?? "—"}</td>
      <td class="num accent">${r.rpsEnsemble?.toFixed(3) ?? "—"}</td>
    </tr>${expanded ? `<tr class="explain-detail"><td colspan="6">${renderBacktestYearExplain(r.year)}</td></tr>` : ""}`;
  }).join("");
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
  const dots = cells.map((c, i) => {
    if (c.observed === null || !c.n) return "";
    return `<circle class="cal-dot" data-bin="${i}" cx="${x(c.midPred)}" cy="${y(c.observed)}" r="${Math.min(6, 2 + c.n / 25)}" fill="var(--accent)" opacity="0.9" />`;
  }).join("");
  const explain = state.expandedCalibrationBin != null
    ? `<div class="explain-panel">${renderCalibrationBinExplain(state.expandedCalibrationBin)}</div>` : "";
  $("#calibration").innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" class="calibration-chart" aria-label="Calibration chart">
      <line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" stroke="rgba(127,168,150,0.4)" stroke-dasharray="4 3" />
      ${bars}
      ${dots}
      <text x="${m}" y="${h - 4}" font-size="10" fill="var(--muted)">predicted →</text>
      <text x="${m + 4}" y="${m}" font-size="10" fill="var(--muted)">observed ↑</text>
    </svg>
    <p class="muted small">logit(observed) = <strong>${fit.a.toFixed(2)}</strong> + <strong>${fit.b.toFixed(2)}</strong> · logit(predicted) — ideal is (0, 1). Wilson 95% intervals shown. Click a dot to drill in.</p>
    ${explain}
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
      await recompute();
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
      await recompute();
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
      await recompute();
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
  // Schedule-section filters (stage / group / date)
  const schStage = $("#schedule-stage");
  if (schStage) {
    schStage.addEventListener("change", () => {
      state.scheduleFilter.stage = schStage.value;
      renderScheduleSection();
    });
  }
  const schGroup = $("#schedule-group");
  if (schGroup) {
    schGroup.addEventListener("change", () => {
      state.scheduleFilter.group = schGroup.value;
      renderScheduleSection();
    });
  }
  const schDate = $("#schedule-date");
  if (schDate) {
    schDate.addEventListener("change", () => {
      state.scheduleFilter.date = schDate.value;
      renderScheduleSection();
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
  // Single delegated click handler on the whole dashboard for the
  // aggregate-surface explainers. Order matters — the most specific
  // selectors come first so they short-circuit.
  const dash = $("#dashboard");
  if (dash) {
    dash.addEventListener("click", (e) => {
      // (-1) Tab switching — fires before form-control early-return so the
      // <button.tab-link> can be picked up via delegation.
      const tabLink = e.target.closest(".tab-link[data-tab]");
      if (tabLink) {
        switchTab(tabLink.dataset.tab);
        return;
      }
      // (0) Click-to-bet — fires BEFORE the form-control early-return so
      // the <button.bet-cell> can be picked up via delegation.
      const betCell = e.target.closest(".bet-cell[data-bet]");
      if (betCell) {
        toggleBetSelection(betCell.dataset.bet);
        renderBetSlip();
        // Re-render the open match panel so the .selected class updates.
        if (state.expandedMatch != null) { renderGroups(); renderScheduleSection(); }
        return;
      }
      // Skip clicks on form controls inside any handled surface.
      if (e.target.closest("input,button,select,a,textarea")) {
        // Allow pin checkboxes & refresh button to handle themselves.
        return;
      }
      // (1) Player Top-N link → mega-table jump. .player-link can be in
      // the players-card, in a match panel, in a compare tray, etc.
      const playerLink = e.target.closest(".player-link[data-player]");
      if (playerLink) { jumpToPlayer(playerLink.dataset.player); return; }
      // (2) Calibration dot
      const calDot = e.target.closest("#calibration .cal-dot");
      if (calDot) {
        const b = Number(calDot.dataset.bin);
        state.expandedCalibrationBin = state.expandedCalibrationBin === b ? null : b;
        renderCalibration();
        return;
      }
      // (3) History fan dot
      const histDot = e.target.closest("#title-history .hist-dot");
      if (histDot) {
        const d = histDot.dataset.date;
        state.expandedHistoryDate = state.expandedHistoryDate === d ? null : d;
        renderHistoryFanChart();
        return;
      }
      // (4) Backtest year
      const btRow = e.target.closest("#backtest tr.bt-row-click");
      if (btRow) {
        const y = Number(btRow.dataset.year);
        state.expandedBacktestYear = state.expandedBacktestYear === y ? null : y;
        renderBacktest();
        return;
      }
      // (5) Group standings team row
      const grpRow = e.target.closest("#groups tr.group-team-row");
      if (grpRow) {
        const code = grpRow.dataset.team;
        state.expandedGroupTeam = state.expandedGroupTeam === code ? null : code;
        renderGroups();
        return;
      }
      // (6) Team Market Matrix cell
      const mxCell = e.target.closest("#team-matrix td.matrix-cell-wrap");
      if (mxCell) {
        const next = { code: mxCell.dataset.team, stageKey: mxCell.dataset.stage };
        const open = state.expandedMatrix;
        state.expandedMatrix = (open?.code === next.code && open?.stageKey === next.stageKey) ? null : next;
        renderTeamMarketMatrix();
        return;
      }
      // (7) Stage row
      const stRow = e.target.closest("#stages tr.stage-row");
      if (stRow) {
        const code = stRow.dataset.team;
        state.expandedStage = state.expandedStage === code ? null : code;
        renderStages();
        return;
      }
      // (8a) Match row (in any group-card or in #schedule-card)
      const matchRow = e.target.closest("[data-match-no]");
      if (matchRow) {
        const no = Number(matchRow.dataset.matchNo);
        state.expandedMatch = state.expandedMatch === no ? null : no;
        renderGroups();
        renderScheduleSection();
        return;
      }
      // (9) Generic team item (Top-3 card / Distribution row / Market row)
      const teamEl = e.target.closest("[data-team]");
      if (teamEl) {
        const code = teamEl.dataset.team;
        state.expandedTeam = state.expandedTeam === code ? null : code;
        renderTop3(); renderDistribution(); renderMarket();
        return;
      }
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

/* ─────────── Match-level forecasts (104 matches, group + KO) ─────────── */

// Returns the schedule entry for a match number (or null).
function getMatch(matchNo) {
  return state.schedule?.find((m) => m.matchNo === matchNo) || null;
}

// Resolve a placeholder slot like "1A" / "W73" into a human label.
function slotLabel(slot) {
  if (/^[1-4][A-L]$/.test(slot)) {
    const dict = t();
    const pos = slot[0]; const grp = slot[1];
    const labels = dict.slotPos || { "1": "1st", "2": "2nd", "3": "3rd", "4": "4th" };
    return `${labels[pos] || pos}. ${dict.slotGroup || "Group"} ${grp}`;
  }
  if (/^3[A-L]+$/.test(slot)) {
    const letters = slot.slice(1).split("").join("/");
    const dict = t();
    return `${dict.slotBest3 || "Best 3rd"} (${letters})`;
  }
  if (/^W\d+$/.test(slot)) {
    const dict = t();
    return `${dict.slotWinner || "Winner"} #${slot.slice(1)}`;
  }
  if (/^L\d+$/.test(slot)) {
    const dict = t();
    return `${dict.slotLoser || "Loser"} #${slot.slice(1)}`;
  }
  return teamName(slot) || slot;
}

// Compact one-line summary of a match used in lists.
// The model's single best scoreline guess = the MODE of the Dixon-Coles
// score distribution (argmax over the joint P(x,y)). Uses the same
// dcScoreProb that powers the "correct score" market, so the Prognose is
// consistent with the odds/probabilities shown in the panel — not a naive
// round() of the expected goals.
function forecastScore(lambdaA, lambdaB, rho = (state.dcParams?.rho || 0)) {
  const MAX = 6; // the mode is always low-scoring; a 6×6 grid is ample
  let best = { a: 0, b: 0, p: -Infinity };
  for (let x = 0; x <= MAX; x++) {
    for (let y = 0; y <= MAX; y++) {
      const p = dcScoreProb(x, y, lambdaA, lambdaB, rho);
      if (p > best.p) best = { a: x, b: y, p };
    }
  }
  return { a: best.a, b: best.b, p: best.p };
}

function matchSummaryLine(match) {
  const fc = state.matchForecasts?.get(match.matchNo);
  const teams = (() => {
    if (match.stage === "group") {
      return `${teamName(match.teamA)} – ${teamName(match.teamB)}`;
    }
    // KO: show "most-likely matchup or placeholder labels"
    const primary = fc?.matchups?.[0];
    if (primary) {
      return `${teamName(primary.teamA)} – ${teamName(primary.teamB)} <span class="muted small">· ${(primary.matchupProb * 100).toFixed(0)}%</span>`;
    }
    return `${escape(slotLabel(match.teamA))} – ${escape(slotLabel(match.teamB))}`;
  })();
  const primaryFc = fc?.matchups?.[0];
  const lambdas = primaryFc ? `${primaryFc.lambdaA.toFixed(1)}–${primaryFc.lambdaB.toFixed(1)}` : "—";
  const predScore = primaryFc
    ? (() => { const s = forecastScore(primaryFc.lambdaA, primaryFc.lambdaB); return `${s.a}:${s.b}`; })()
    : null;
  const d = new Date(match.kickoffUTC);
  const dateStr = isNaN(d.getTime()) ? match.date : d.toISOString().slice(5, 10) + " " + d.toISOString().slice(11, 16) + "Z";
  return { teams, lambdas, dateStr, predScore };
}

function renderGroupMatchList(letter) {
  if (!state.schedule || !state.matchForecasts) return "";
  const dict = t();
  const matches = state.schedule
    .filter((m) => m.stage === "group" && m.group === letter)
    .sort((a, b) => new Date(a.kickoffUTC) - new Date(b.kickoffUTC));
  if (!matches.length) return "";
  const rows = matches.map((m) => {
    const open = state.expandedMatch === m.matchNo;
    const sum = matchSummaryLine(m);
    return `
      <div class="match-row${open ? " expanded" : ""}" data-match-no="${m.matchNo}">
        <span class="match-date">${escape(sum.dateStr)}</span>
        <span class="match-teams">${sum.teams}</span>
        <span class="match-lambdas"><b class="pred-pill" title="${state.locale === "de" ? "erwartete Tore" : "expected goals"}">⌀ ${escape(sum.lambdas)}</b>${sum.predScore ? `<span class="muted small"> ${sum.predScore}</span>` : ""}</span>
      </div>
      ${open ? `<div class="match-panel">${renderMatchPanel(m.matchNo)}</div>` : ""}
    `;
  }).join("");
  return `<div class="group-matches">
    <h5 class="muted small">${escape(dict.groupMatchesHeader || "Group matches")}</h5>
    ${rows}
  </div>`;
}

function renderMatchPanel(matchNo) {
  const dict = t();
  const ex = dict.matchExp || {};
  const match = getMatch(matchNo);
  const fc = state.matchForecasts?.get(matchNo);
  if (!match || !fc) return `<p class="muted small">—</p>`;
  if (!fc.matchups.length) {
    return `<p class="muted small">${escape(ex.noMatchups || "No matchup data — needs MC group-position output.")}</p>`;
  }
  // Primary matchup + alternatives
  const primary = fc.matchups[0];
  const alts = fc.matchups.slice(1);
  // Model's predicted scoreline ("Prognose 2:1") — shown next to the live
  // score and at the top of the outcome block.
  const ps = forecastScore(primary.lambdaA, primary.lambdaB);
  const de = state.locale === "de";
  const predLbl = de ? "Prognose" : "Forecast";
  const exactLbl = de ? "Wahrscheinlichstes exaktes Ergebnis" : "Most likely exact score";
  const varianceNote = de
    ? "Fußball ist hochvariabel — das exakte Ergebnis ist nur der wahrscheinlichste Einzelwert, keine sichere Vorhersage. Aussagekräftig sind Siegchance + erwartete Tore."
    : "Football is high-variance — the exact score is just the single most-likely value, not a confident call. The meaningful read is win probability + expected goals.";
  // Show the mode's probability so it's clear the exact score is a low-confidence point.
  const predChip = `<span class="pred-chip">${predLbl} <b>${ps.a}:${ps.b}</b> <span class="muted small">${pct(ps.p, 0)}</span></span>`;
  // Header
  const d = new Date(match.kickoffUTC);
  const dateStr = isNaN(d.getTime()) ? match.date : d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const stageLabel = dict.stageLabels?.[match.stage] || match.stage.toUpperCase();
  const headerPrefix = match.stage === "group"
    ? `${escape(stageLabel)} ${match.group} · ${escape(dateStr)}`
    : `${escape(stageLabel)} · ${escape(dateStr)}`;
  const koMatchupNote = match.stage !== "group"
    ? `<p class="muted small matchup-prob">${escape(ex.likeliestMatchup || "Most-likely matchup")}: ${escape(teamName(primary.teamA))} – ${escape(teamName(primary.teamB))} <strong>${(primary.matchupProb * 100).toFixed(1)}%</strong></p>` : "";
  // Live / final score badge, populated once real data flows from /api/live
  // (the matchNo map joins provider IDs to our internal schedule IDs).
  const liveMatch = getLiveForSchedule(matchNo);
  const hasScore = liveMatch && liveMatch.scoreA != null && liveMatch.scoreB != null;
  let liveBadge;
  if (hasScore && liveMatch.status === "live") {
    liveBadge = `<p class="live-line"><span class="live-badge">● ${escape(ex.live || "LIVE")}${liveMatch.minute ? " " + liveMatch.minute + "'" : ""}</span><span class="live-score">${liveMatch.scoreA}–${liveMatch.scoreB}</span><span class="score-sep">·</span>${predChip}</p>`;
  } else if (hasScore && liveMatch.status === "finished") {
    liveBadge = `<p class="live-line"><span class="final-badge">${escape(ex.fulltime || "FT")}</span><span class="live-score">${liveMatch.scoreA}–${liveMatch.scoreB}</span><span class="score-sep">·</span>${predChip}</p>`;
  } else {
    liveBadge = `<p class="live-line">${predChip}</p>`;
  }
  // Outcome block
  const outcomeBlock = `
    <div class="detail-block">
      <h5>${escape(ex.outcome || "Match outcome")}</h5>
      <ul class="detail-list">
        <li><span>${escape(teamName(primary.teamA))}</span><b>${pct(primary.winA, 0)}</b></li>
        <li><span>${escape(ex.draw || "Draw")}</span><b>${pct(primary.draw, 0)}</b></li>
        <li><span>${escape(teamName(primary.teamB))}</span><b>${pct(primary.winB, 0)}</b></li>
        <li><span>${escape(ex.expGoals || "Expected goals")}</span><b>${primary.lambdaA.toFixed(2)} – ${primary.lambdaB.toFixed(2)}</b></li>
        <li><span>${escape(ex.totalGoals || "Total expected")}</span><b>${(primary.lambdaA + primary.lambdaB).toFixed(2)}</b></li>
        <li class="pred-row"><span>${escape(exactLbl)}</span><b>${ps.a}:${ps.b} <span class="muted small">${pct(ps.p, 0)}</span></b></li>
      </ul>
      <p class="muted small">${escape(varianceNote)}</p>
    </div>`;
  const scorerBlock = (teamCode, scorers) => `
    <div class="detail-block">
      <h5>${escape(ex.topScorers || "Top scorers")} · ${escape(teamName(teamCode))}</h5>
      <ul class="detail-list">
        ${scorers.length === 0 ? `<li><span class="muted">${escape(ex.noScorers || "n/v")}</span></li>` :
          scorers.map((s) => `<li class="player-link" data-player="${escape(s.name)}"><span>${escape(s.name)}</span><b>${pct(s.prob, 0)}</b></li>`).join("")}
      </ul>
    </div>`;
  const assistBlock = `
    <div class="detail-block">
      <h5>${escape(ex.topAssists || "Top assists")}</h5>
      <ul class="detail-list">
        ${primary.assistsA.slice(0, 3).map((a) => `<li class="player-link" data-player="${escape(a.name)}"><span>${escape(a.name)} <span class="muted small">${escape(teamName(primary.teamA))}</span></span><b>${pct(a.prob, 0)}</b></li>`).join("")}
        ${primary.assistsB.slice(0, 3).map((a) => `<li class="player-link" data-player="${escape(a.name)}"><span>${escape(a.name)} <span class="muted small">${escape(teamName(primary.teamB))}</span></span><b>${pct(a.prob, 0)}</b></li>`).join("")}
      </ul>
    </div>`;
  // Minute heatmap — scale each bin's prior by total expected goals to give
  // expected number of goals per bin.
  const total = primary.lambdaA + primary.lambdaB;
  const maxBin = Math.max(...GOAL_MINUTE_BINS.map((b) => b.p), 0.01);
  const minuteBlock = `
    <div class="detail-block">
      <h5>${escape(ex.minuteHeatmap || "Goal-time distribution")}</h5>
      <div class="minute-grid">
        ${GOAL_MINUTE_BINS.map((b) => {
          const intensity = (b.p / maxBin).toFixed(3);
          const expBin = (b.p * total).toFixed(2);
          return `<div class="minute-cell" style="--p:${intensity}">
            <div class="minute-label">${escape(b.label)}</div>
            <div class="minute-val">${expBin}</div>
          </div>`;
        }).join("")}
      </div>
      <p class="muted small">${escape(ex.minuteLegend || "Cell value = expected goals in bin")}</p>
    </div>`;
  // Betting markets block (click-to-bet, sends selections to the sticky slip)
  const betsBlock = renderBetsBlock(matchNo, primary);
  // Alternatives
  const altsBlock = alts.length === 0 ? "" : `
    <div class="detail-block" style="grid-column: 1 / -1">
      <h5>${escape(ex.alternatives || "Alternative matchups")}</h5>
      <ul class="detail-list">
        ${alts.map((a) => `<li><span>${escape(teamName(a.teamA))} – ${escape(teamName(a.teamB))}</span><b>${(a.matchupProb * 100).toFixed(1)}%</b></li>`).join("")}
      </ul>
    </div>`;
  return `
    <h4 style="margin:0 0 8px">${headerPrefix}</h4>
    ${liveBadge}
    ${koMatchupNote}
    <div class="detail-grid">
      ${outcomeBlock}
      ${scorerBlock(primary.teamA, primary.scorersA.slice(0, 5))}
      ${scorerBlock(primary.teamB, primary.scorersB.slice(0, 5))}
      ${assistBlock}
      ${minuteBlock}
      ${altsBlock}
      ${betsBlock}
    </div>`;
}

// Returns the HTML for the "Wetten" block inside a match-panel: model
// fair-odds + (when available) aggregated bookmaker odds + edge %, grouped
// into Hauptmärkte / Spezialmärkte / Spieler. Each odds cell is a button
// the delegated #dashboard click handler picks up via [data-bet].
function renderBetsBlock(matchNo, primary) {
  const dict = t();
  const bets = dict.bets || {};
  const rho = state.dcParams?.rho || 0;
  const markets = deriveMarkets(primary, rho);
  if (!Object.keys(markets).length) return "";
  // Look up bookmaker quotes by internal matchNo. The scraper joins by
  // (kickoffUTC + team-pair) so this just hits matchNo as the key.
  const bookie = state.matchOdds?.matches?.[matchNo] || null;
  const bookieOddsFor = (marketId) => {
    if (!bookie) return null;
    const map = {
      "wld.home": bookie.home, "wld.draw": bookie.draw, "wld.away": bookie.away,
      "totals.over_2.5": bookie.over25, "totals.under_2.5": bookie.under25,
      "btts.yes": bookie.btts_yes, "btts.no": bookie.btts_no,
    };
    const p = map[marketId];
    return Number.isFinite(p) && p > 0.01 && p < 0.99 ? 1 / p : null;
  };
  const slipIds = new Set(state.betSlip.map((s) => `${s.matchNo}|${s.marketId}`));
  const renderRow = (id, mk) => {
    if (!mk.fairOdds) return "";
    const sel = slipIds.has(`${matchNo}|${id}`) ? " selected" : "";
    const modelOdds = mk.fairOdds;
    const marketOdds = bookieOddsFor(id);
    const edge = marketOdds ? ((modelOdds / marketOdds) - 1) : null;
    const edgeCell = edge == null
      ? `<span class="muted small">—</span>`
      : `<span class="bet-edge ${edge < 0 ? "edge-pos" : "edge-neg"}">${edge < 0 ? "+" : ""}${(-edge * 100).toFixed(1)}%</span>`;
    const marketCell = marketOdds ? marketOdds.toFixed(2) : `<span class="muted">—</span>`;
    return `<tr>
      <td>${escape(mk.label)}</td>
      <td><button class="bet-cell${sel}" data-bet="${matchNo}|${id}" type="button">${modelOdds.toFixed(2)}</button></td>
      <td>${marketCell}</td>
      <td>${edgeCell}</td>
    </tr>`;
  };
  const ids = Object.keys(markets);
  const idsInGroup = (g) => ids.filter((id) => markets[id].group === g);
  const headerCells = `<thead><tr>
    <th>${escape(bets.market || "Markt")}</th>
    <th>${escape(bets.modelOdds || "Modell")}</th>
    <th>${escape(bets.marketOdds || "Markt")}</th>
    <th>${escape(bets.edge || "Edge")}</th>
  </tr></thead>`;
  const mainRows  = idsInGroup("main").map((id) => renderRow(id, markets[id])).join("");
  const specialsRows = idsInGroup("specials").map((id) => renderRow(id, markets[id])).join("");
  const scorerRows = idsInGroup("scorers").map((id) => renderRow(id, markets[id])).join("");
  const hint = bookie
    ? escape(bets.bookieHint || "Modell vs aggregierte Bookmaker-Quote — Edge = Modell-Quote ÷ Markt-Quote − 1 (positiv = Wert).")
    : escape(bets.modelOnlyHint || "Nur Modell-Quoten — Bookmaker-Vergleich erscheint sobald data/match-odds.json gefüllt ist.");
  return `<div class="detail-block bets-block" style="grid-column: 1 / -1">
    <h5>${escape(bets.title || "Wetten (simuliert)")}</h5>
    <p class="muted small">${hint}</p>
    <details open><summary>${escape(bets.main || "Hauptmärkte")}</summary>
      <table class="bets-table">${headerCells}<tbody>${mainRows}</tbody></table>
    </details>
    <details><summary>${escape(bets.specials || "Spezialmärkte (BTTS, Correct Score, HT/FT, Handicap)")}</summary>
      <table class="bets-table">${headerCells}<tbody>${specialsRows}</tbody></table>
    </details>
    ${scorerRows ? `<details><summary>${escape(bets.scorers || "Anytime-Scorer")}</summary>
      <table class="bets-table">${headerCells}<tbody>${scorerRows}</tbody></table>
    </details>` : ""}
  </div>`;
}

const STAGE_ORDER = ["group", "R32", "R16", "QF", "SF", "third", "final"];

function populateScheduleFilters() {
  const dict = t();
  const stageSel = $("#schedule-stage");
  if (stageSel && !stageSel.dataset.filled) {
    const opts = ["", ...STAGE_ORDER];
    stageSel.innerHTML = opts.map((s) => `<option value="${s}">${escape(s === "" ? (dict.scheduleAllStages || "— all stages —") : (dict.stageLabels?.[s] || s.toUpperCase()))}</option>`).join("");
    stageSel.dataset.filled = "1";
  }
  const groupSel = $("#schedule-group");
  if (groupSel && !groupSel.dataset.filled) {
    const groups = Object.keys(GROUPS_2026);
    groupSel.innerHTML = `<option value="">${escape(dict.scheduleAllGroups || "— all groups —")}</option>` +
      groups.map((g) => `<option value="${g}">${escape(dict.sectionGroups || "Group")} ${g}</option>`).join("");
    groupSel.dataset.filled = "1";
  }
}

function renderScheduleSection() {
  if (!state.schedule || !state.matchForecasts) {
    $("#schedule-card")?.setAttribute("hidden", "");
    return;
  }
  $("#schedule-card")?.removeAttribute("hidden");
  populateScheduleFilters();
  const dict = t();
  const f = state.scheduleFilter;
  const matches = state.schedule
    .filter((m) => !f.stage || m.stage === f.stage)
    .filter((m) => !f.group || m.group === f.group)
    .filter((m) => !f.date || m.date === f.date)
    .sort((a, b) => new Date(a.kickoffUTC) - new Date(b.kickoffUTC));
  $("#schedule-count").textContent = String(matches.length);
  const rows = matches.map((m) => {
    const open = state.expandedMatch === m.matchNo;
    const sum = matchSummaryLine(m);
    const stageLabel = dict.stageLabels?.[m.stage] || m.stage.toUpperCase();
    return `
      <div class="match-row${open ? " expanded" : ""}" data-match-no="${m.matchNo}">
        <span class="match-date">${escape(sum.dateStr)}</span>
        <span class="match-stage muted small">${escape(stageLabel)}${m.group ? " · " + m.group : ""}</span>
        <span class="match-teams">${sum.teams}</span>
        <span class="match-lambdas"><b class="pred-pill" title="${state.locale === "de" ? "erwartete Tore" : "expected goals"}">⌀ ${escape(sum.lambdas)}</b>${sum.predScore ? `<span class="muted small"> ${sum.predScore}</span>` : ""}</span>
      </div>
      ${open ? `<div class="match-panel">${renderMatchPanel(m.matchNo)}</div>` : ""}
    `;
  }).join("");
  $("#schedule-list").innerHTML = rows || `<p class="muted small">${escape(dict.scheduleEmpty || "No matches match the current filter.")}</p>`;
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
    const dotsHtml = points.map((p) => {
      const px = x(new Date(p.date).getTime());
      const py = y(p.titles?.[code] || 0);
      return `<circle class="hist-dot" data-date="${escape(p.date)}" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3" fill="${colors[i]}" opacity="0.85"/>`;
    }).join("");
    return `<g><path d="${path}" stroke="${colors[i]}" fill="none" stroke-width="2" opacity="0.85"/>
       ${dotsHtml}
       <text x="${w - m + 4}" y="${y(points[points.length - 1].titles?.[code] || 0) + 4}" font-size="10" fill="${colors[i]}">${escape(teamName(code))}</text></g>`;
  }).join("");
  const explainHtml = state.expandedHistoryDate
    ? `<div class="explain-panel">${renderHistoryPointExplain(state.expandedHistoryDate)}</div>` : "";
  $("#title-history").innerHTML = `
    <svg viewBox="0 0 ${w + 60} ${h}" class="history-chart" aria-label="Title history">
      <line x1="${m}" y1="${h - m}" x2="${w - m}" y2="${h - m}" stroke="rgba(127,168,150,0.3)"/>
      <line x1="${m}" y1="${m}" x2="${m}" y2="${h - m}" stroke="rgba(127,168,150,0.3)"/>
      ${series}
      <text x="${m}" y="${h - 6}" font-size="10" fill="var(--muted)">${escape(new Date(xMin).toISOString().slice(0, 10))}</text>
      <text x="${w - m - 60}" y="${h - 6}" font-size="10" fill="var(--muted)">${escape(new Date(xMax).toISOString().slice(0, 10))}</text>
      <text x="${m - 22}" y="${m + 10}" font-size="10" fill="var(--muted)">${(yMax * 100).toFixed(0)}%</text>
    </svg>
    ${explainHtml}
  `;
}

/* ─────────── Compute pipeline ─────────── */

/* ─────────── Forecast Web Worker (keeps the Monte-Carlo off the main thread) ─────────── */
let _fcWorker = null;            // null = not created yet, false = disabled, Worker = live
let _fcJobId = 0;
const _fcJobs = new Map();
function getForecastWorker() {
  if (_fcWorker !== null) return _fcWorker || null;
  try {
    _fcWorker = new Worker(new URL("./forecast.worker.js", import.meta.url), { type: "module" });
    _fcWorker.onmessage = (e) => {
      const { id, ok, result, error } = e.data || {};
      const job = _fcJobs.get(id);
      if (!job) return;
      _fcJobs.delete(id);
      if (ok) job.resolve(result); else job.reject(new Error(error || "worker error"));
    };
    _fcWorker.onerror = () => {
      for (const [, job] of _fcJobs) job.reject(new Error("forecast worker crashed"));
      _fcJobs.clear();
      _fcWorker = false; // fall back to the synchronous path from now on
    };
  } catch {
    _fcWorker = false;
  }
  return _fcWorker || null;
}
function runForecastJob(type, payload) {
  const w = getForecastWorker();
  if (!w) return Promise.reject(new Error("no forecast worker"));
  const id = ++_fcJobId;
  return new Promise((resolve, reject) => {
    _fcJobs.set(id, { resolve, reject });
    w.postMessage({ id, type, payload });
  });
}

// Recompute the forecast for the CURRENT scenario, off the main thread via the
// worker (falls back to the synchronous path if the worker is unavailable).
// The initial page load doesn't call this — it paints from the precomputed
// snapshot (see applyForecastSnapshot); this runs only on scenario / γ /
// bootstrap changes and the Refresh button.
async function recompute() {
  const payload = {
    schedule: state.schedule,
    dcParams: state.dcParams,
    squadDelta: state.squadDelta,
    options: { ...state.options },
    bootstrap: !!(state.bootstrap && state.bootstrapFits),
    bootstrapFits: (state.bootstrap && state.bootstrapFits) ? state.bootstrapFits : null,
    iterations: ITERATIONS,
    bootstrapIterations: 5000,
    marketByMatchNo: state.matchOdds?.matches || null,
  };
  let res;
  try {
    res = await runForecastJob("main", payload);
  } catch {
    recomputeSync();
    return;
  }
  state.mc = res.mc;
  state.matchForecasts = (res.matchForecasts instanceof Map)
    ? res.matchForecasts
    : new Map(Object.entries(res.matchForecasts || {}).map(([k, v]) => [Number(k), v]));
  state.blendedTitle = state.options.useMarket
    ? blendWithMarket(state.mc.titleProbability, state.marketProbs || MARKET_ODDS_2026, DEFAULT_WEIGHTS.market)
    : state.mc.titleProbability;
}

function recomputeSync() {
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
  // Per-match player forecasts — analytic layer on top of the MC outputs.
  if (state.schedule) {
    const ctx = {
      weights: state.mc.weights || DEFAULT_WEIGHTS,
      squadDelta: state.options.useSquad ? state.squadDelta : null,
      dcParams: state.options.useDC ? state.dcParams : null,
      eloMap: ELO_2026,
      hostCodes,
      options: state.options,
      covariateProvider: state.options.useCovariates ? state.covariateProvider : null,
    };
    const probsFn = (a, b) => matchProbs({ code: a }, { code: b }, ctx);
    state.matchForecasts = buildAllMatchForecasts(state.schedule, state.mc, probsFn, { groupsByLetter: GROUPS_2026, marketByMatchNo: state.matchOdds?.matches || null });
  }
}

// Snapshot-first: hydrate state from the precomputed forecast JSON so the
// dashboard paints instantly on load — no main-thread Monte-Carlo. Mirrors
// exactly what recompute() produces for the default scenario (all factors on),
// which is always the initial scenario (options aren't restored from storage).
// The raw MC distributions are blended with the *current* market client-side,
// so the headline title odds stay live-accurate.
function applyForecastSnapshot(snap) {
  state.mc = {
    iterations: snap.iterations,
    titleProbability: snap.titleProbability,
    finalsProbability: snap.finalsProbability,
    semisProbability: snap.semisProbability,
    quartersProbability: snap.quartersProbability,
    r16Probability: snap.r16Probability,
    r32Probability: snap.r32Probability,
    groupAdvanceProbability: snap.groupAdvanceProbability,
    groupPositionDistribution: snap.groupPositionDistribution,
    weights: snap.weights || DEFAULT_WEIGHTS,
  };
  const mf = new Map();
  for (const [k, v] of Object.entries(snap.matchForecasts || {})) mf.set(Number(k), v);
  state.matchForecasts = mf;
  state.blendedTitle = state.options.useMarket
    ? blendWithMarket(state.mc.titleProbability, state.marketProbs || MARKET_ODDS_2026, DEFAULT_WEIGHTS.market)
    : state.mc.titleProbability;
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
  // Restore manual live-override from localStorage so polling can start
  // immediately on reload without waiting for the user to flip the toggle.
  try { state.liveOverride = localStorage.getItem("wc26_live_override") === "1"; } catch {}
  // Restore active tab: URL hash beats localStorage beats default.
  try {
    const fromHash = location.hash.replace(/^#/, "");
    if (TAB_NAMES.includes(fromHash)) state.activeTab = fromHash;
    else {
      const fromLs = localStorage.getItem("wc26_active_tab");
      if (TAB_NAMES.includes(fromLs)) state.activeTab = fromLs;
    }
  } catch {}
  // Restore bet-simulator state from localStorage (slip + history + stake).
  try {
    const slip = JSON.parse(localStorage.getItem("wc26_betslip_v1") || "[]");
    if (Array.isArray(slip)) state.betSlip = slip;
    const hist = JSON.parse(localStorage.getItem("wc26_bet_history_v1") || "[]");
    if (Array.isArray(hist)) state.betHistory = hist;
    const stake = Number(localStorage.getItem("wc26_bet_stake") || "10");
    if (Number.isFinite(stake) && stake > 0) state.betStake = stake;
    state.betSlipCollapsed = localStorage.getItem("wc26_betslip_collapsed") === "1";
  } catch {}
  const combined = buildCombinedTournaments();
  state.marketSnapshot = await loadMarketSnapshot();
  const rawMarket = state.marketSnapshot?.aggregated || MARKET_ODDS_2026;
  state.marketProbs = powerTransform(rawMarket, state.marketGamma);
  state.schedule = await loadSchedule();
  state.covariateProvider = state.schedule ? buildCovariateProvider(state.schedule) : null;
  state.titleHistory = await loadTitleHistory();
  state.playerProps = await loadPlayerProps();
  state.freshness = await loadFreshness();
  // Live data is best-effort and may 404 on platforms without the function.
  state.live = await loadLive().catch(() => null);
  state.liveScheduleMap = buildLiveScheduleMap();
  state.matchOdds = await loadMatchOdds();
  // 1. Fit DC on ALL historical matches (group + KO across all years).
  state.dcParams = fitDCOnHistorical(HISTORICAL_KNOCKOUTS, HISTORICAL_ELO, NEW_HISTORICAL_MATCHES);
  // 2. Squad-strength deltas.
  state.squadDelta = SQUAD_INDEX_2026 ? squadEloAdjustments(SQUAD_INDEX_2026) : null;
  // 3. RPS backtest + calibration on combined data.
  state.backtest = runRPSBacktest(combined, HISTORICAL_ELO, state.dcParams, state.squadDelta);
  state.calibration = calibrationBins(combined, HISTORICAL_ELO, state.dcParams, 8);
  // 4. Forecast for 2026 — snapshot-first (instant paint), fall back to a
  // live main-thread Monte-Carlo only if the precomputed snapshot is missing.
  state.forecastSnapshot = await loadForecastSnapshot();
  if (state.forecastSnapshot) {
    applyForecastSnapshot(state.forecastSnapshot);
  } else {
    await recompute();
  }
  // Diff against the previous visit (localStorage). Must run AFTER
  // recompute() so state.blendedTitle / state.mc exist.
  state.prev = restorePrev();
  state.diff = state.prev ? diffSnapshots(state.prev, cloneCurrentSnapshot()) : null;
}

function renderAll() {
  renderFreshnessBanner();
  renderTop3();
  renderModelBreakdown();
  renderDistribution();
  renderStages();
  renderMarket();
  renderTeamMarketMatrix();
  renderGroups();
  renderScheduleSection();
  renderPlayers();
  renderBacktest();
  renderCalibration();
  renderHistoryFanChart();
  renderContext();
  renderMethodology();
  renderWallet();
  renderBetSlip();
  fireConfetti();
}

/* ─────────── Tab navigation ─────────── */

const TAB_NAMES = ["overview", "stages", "markets", "schedule", "players", "bets", "methodology"];

function switchTab(name) {
  if (!TAB_NAMES.includes(name)) name = "overview";
  state.activeTab = name;
  // Toggle visibility on every section tagged with data-tab. The schedule
  // and history cards keep their own hidden attribute as "not yet ready"
  // gating — we only flip the tab visibility, not those.
  document.querySelectorAll("section[data-tab]").forEach((el) => {
    const matches = el.dataset.tab === name;
    el.classList.toggle("tab-hidden", !matches);
  });
  document.querySelectorAll(".tab-link").forEach((b) => {
    const matches = b.dataset.tab === name;
    b.classList.toggle("active", matches);
    b.setAttribute("aria-selected", matches ? "true" : "false");
  });
  try { localStorage.setItem("wc26_active_tab", name); } catch {}
  if (location.hash !== "#" + name) {
    history.replaceState(null, "", "#" + name);
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function wireTabs() {
  window.addEventListener("hashchange", () => {
    const name = location.hash.replace(/^#/, "");
    if (TAB_NAMES.includes(name)) switchTab(name);
  });
}

/* ─────────── Freshness banner + diff + live polling ─────────── */

const PREV_STORAGE_KEY = "wc26_prev_snapshot_v1";
const DIFF_THRESHOLD = 0.0005;  // 0.05 pp — below this we treat as noise

function cloneCurrentSnapshot() {
  if (!state.mc) return null;
  const blended = state.blendedTitle || state.mc.titleProbability;
  const stagesMap = {};
  for (const key of ["r32Probability", "r16Probability", "quartersProbability", "semisProbability", "finalsProbability", "titleProbability"]) {
    stagesMap[key] = { ...(state.mc[key] || {}) };
  }
  return {
    asOf: state.freshness?.writtenAt || new Date().toISOString(),
    title: { ...blended },
    stages: stagesMap,
    market: { ...(state.marketProbs || {}) },
  };
}

function persistPrev(snap) {
  if (!snap) return;
  try { localStorage.setItem(PREV_STORAGE_KEY, JSON.stringify(snap)); } catch { /* quota */ }
}

function restorePrev() {
  try {
    const raw = localStorage.getItem(PREV_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function diffSnapshots(prev, current) {
  if (!prev || !current) return null;
  const out = { totalChanges: 0, title: {}, stages: {}, market: {} };
  const diffMap = (a, b, target) => {
    let n = 0;
    const codes = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const code of codes) {
      const d = (b[code] || 0) - (a[code] || 0);
      if (Math.abs(d) > DIFF_THRESHOLD) {
        target[code] = d;
        n++;
      }
    }
    return n;
  };
  out.totalChanges += diffMap(prev.title, current.title, out.title);
  for (const key of Object.keys(current.stages || {})) {
    out.stages[key] = {};
    out.totalChanges += diffMap(prev.stages?.[key] || {}, current.stages[key] || {}, out.stages[key]);
  }
  out.totalChanges += diffMap(prev.market, current.market, out.market);
  return out;
}

function trendArrow(code, kind = "title") {
  const d = state.diff;
  if (!d) return "";
  const map = kind === "market" ? d.market
    : kind === "title" ? d.title
    : d.stages?.[kind];  // pass a stage key like "titleProbability"
  const delta = map?.[code];
  if (delta == null) return "";
  const sign = delta >= 0 ? "↑" : "↓";
  const cls = delta >= 0 ? "trend-up" : "trend-down";
  return `<span class="trend ${cls}">${sign} ${(Math.abs(delta) * 100).toFixed(1)} pp</span>`;
}

// Contract from api/live.js normaliseFootballDataMatch — single source of
// truth for the lowercase enum the front-end checks against.
const LIVE_STATUS_ACTIVE = "live";

function hasActiveLiveMatch(live) {
  return live?.status === "ok" && live?.matches?.some?.((m) => m.status === LIVE_STATUS_ACTIVE);
}

// Returns [i18nKey, isActiveBadge]. Order encodes precedence explicitly.
function liveBannerState() {
  const live = state.live;
  const noSource = live?.status === "no-source";
  if (state.liveOverride && state.liveError) return ["liveErrorOverride", false];
  if (state.liveOverride && noSource)         return ["liveOverrideNoSource", false];
  if (noSource)                                return ["liveNoSource", false];
  // Only trust "live matches" while we're actually polling — otherwise a
  // stale state.live from a previous override session can falsely badge.
  if (state.livePolling && hasActiveLiveMatch(live)) return ["liveActive", true];
  if (state.livePolling)                              return ["livePolling", true];
  if (liveWindowActive())                             return ["liveActive", true];
  return ["liveIdle", false];
}

function renderFreshnessBanner() {
  const dict = t();
  const banner = $("#freshness-banner");
  if (!banner) return;
  const fr = state.freshness;
  if (!fr) { banner.hidden = true; return; }
  banner.hidden = false;
  const writtenAt = fr.writtenAt || fr.market || fr.titleHistory;
  const mins = writtenAt ? Math.max(0, Math.round((Date.now() - new Date(writtenAt).getTime()) / 60000)) : null;
  const changes = state.diff?.totalChanges || 0;
  const fb = dict.freshness || {};
  const minsLabel = mins == null ? "—" : `${mins}`;
  const bannerText = typeof fb.banner === "function" ? fb.banner(minsLabel, changes) : `Last update ${minsLabel} min ago · ${changes} changes since your last visit`;
  $("#fb-text").textContent = bannerText;
  const refreshLabel = state.refreshing ? (fb.refreshing || "Refreshing…") : (fb.refreshBtn || "Refresh now");
  const btn = $("#fb-refresh");
  if (btn) { btn.textContent = refreshLabel; btn.classList.toggle("spinning", !!state.refreshing); }
  // Live status sub-line — derived state → (i18nKey, isActiveBadge)
  const liveStatusEl = $("#fb-live-status");
  if (liveStatusEl) {
    const [key, active] = liveBannerState();
    liveStatusEl.textContent = fb[key] || "";
    liveStatusEl.classList.toggle("active", active);
  }
  // Live-mode toggle button
  const liveBtn = $("#fb-live-toggle");
  if (liveBtn) {
    liveBtn.textContent = state.liveOverride
      ? (fb.liveToggleStop || "Live-Mode stoppen")
      : (fb.liveToggleStart || "Live-Mode aktivieren");
    liveBtn.classList.toggle("active", !!state.liveOverride);
  }
}

function wireRefreshButton() {
  const btn = $("#fb-refresh");
  if (!btn || btn.dataset.wired) return;
  btn.dataset.wired = "1";
  btn.addEventListener("click", async () => {
    if (state.refreshing) return;
    state.refreshing = true;
    renderFreshnessBanner();
    // Persist current as the new baseline BEFORE refreshing, so the next
    // diff is "since this refresh click", not "since first boot".
    persistPrev(cloneCurrentSnapshot());
    state.prev = restorePrev();
    // Re-fetch all volatile data in parallel.
    const [market, history, props, freshness, live, matchOdds] = await Promise.all([
      loadMarketSnapshot(),
      loadTitleHistory(),
      loadPlayerProps(),
      loadFreshness(),
      loadLive().catch(() => null),
      loadMatchOdds(),
    ]);
    if (market) {
      state.marketSnapshot = market;
      const raw = market.aggregated || MARKET_ODDS_2026;
      state.marketProbs = powerTransform(raw, state.marketGamma);
    }
    if (history) state.titleHistory = history;
    if (props) state.playerProps = props;
    if (freshness) state.freshness = freshness;
    if (live) state.live = live;
    if (matchOdds) state.matchOdds = matchOdds;
    await recompute();
    state.diff = diffSnapshots(state.prev, cloneCurrentSnapshot());
    state.refreshing = false;
    renderAll();
    startLivePollingIfActive();
  });
  // Live-mode override toggle. ON → pollLive() reuses state.liveAbort so
  // rapid ON→OFF→ON clicks chain cleanly via the abort signal. OFF →
  // abort any in-flight fetch so a late response can't repaint the badge
  // back to "live" after the user disabled.
  const liveBtn = $("#fb-live-toggle");
  if (liveBtn) {
    liveBtn.addEventListener("click", async () => {
      state.liveOverride = !state.liveOverride;
      try {
        localStorage.setItem("wc26_live_override", state.liveOverride ? "1" : "0");
      } catch { /* quota */ }
      startLivePollingIfActive();
      if (state.liveOverride) {
        await pollLive();           // shared abort controller; renders banner
      } else {
        if (state.liveAbort) state.liveAbort.abort();
        state.liveError = null;
        renderFreshnessBanner();
      }
    });
  }
}

// Build a Map<providerMatchNo → internalMatchNo> by joining state.live.matches
// against state.schedule on (kickoffUTC, sorted teamA/B pair). football-data.org
// emits provider IDs starting at 537327; our schedule uses 1–104. KO matches
// with empty team codes in the live feed are skipped — they get joined on a
// later poll once the bracket fills in.
function buildLiveScheduleMap() {
  const map = new Map();
  if (!state.live?.matches || !state.schedule) return map;
  const pairKey = (a, b) => [a, b].sort().join(":");
  const byKey = new Map();
  for (const s of state.schedule) {
    if (s.kickoffUTC && s.teamA && s.teamB) {
      byKey.set(`${s.kickoffUTC}|${pairKey(s.teamA, s.teamB)}`, s.matchNo);
    }
  }
  for (const m of state.live.matches) {
    if (!m.kickoffUTC || !m.teamA || !m.teamB) continue;
    const internal = byKey.get(`${m.kickoffUTC}|${pairKey(m.teamA, m.teamB)}`);
    if (internal != null) map.set(m.matchNo, internal);
  }
  return map;
}

// Reverse lookup: given an internal schedule matchNo, return the live-match
// snapshot from state.live (or null). Useful once renderMatchPanel starts
// surfacing live scores.
function getLiveForSchedule(internalMatchNo) {
  if (!state.live?.matches || !state.liveScheduleMap) return null;
  for (const [providerNo, internal] of state.liveScheduleMap) {
    if (internal === internalMatchNo) {
      return state.live.matches.find((m) => m.matchNo === providerNo) || null;
    }
  }
  return null;
}

// Predicate: any scheduled match where now is between kickoff and kickoff+2h.
function liveWindowActive() {
  if (state.liveOverride) return true;   // manual override forces polling
  if (!state.schedule) return false;
  const now = Date.now();
  const twoHours = 2 * 3600 * 1000;
  for (const m of state.schedule) {
    if (!m.kickoffUTC) continue;
    const k = new Date(m.kickoffUTC).getTime();
    if (k <= now && now - k <= twoHours) return true;
  }
  return false;
}

function startLivePollingIfActive() {
  const active = liveWindowActive();
  if (active && !state.livePolling) {
    state.livePolling = setInterval(pollLive, 30_000);
  } else if (!active && state.livePolling) {
    clearInterval(state.livePolling);
    state.livePolling = null;
  }
}

async function pollLive() {
  // Self-stop once the last live window has naturally closed. Without this
  // the 30 s interval would keep firing past the last kickoff+2h forever.
  if (!liveWindowActive()) {
    if (state.livePolling) { clearInterval(state.livePolling); state.livePolling = null; }
    renderFreshnessBanner();
    return;
  }
  if (state.liveAbort) state.liveAbort.abort();
  state.liveAbort = new AbortController();
  try {
    const live = await loadLive(state.liveAbort.signal);
    if (live) {
      state.live = live;
      state.liveError = null;
      state.liveScheduleMap = buildLiveScheduleMap();
    } else {
      state.liveError = "fetch-failed";
    }
  } catch (e) {
    if (e?.name !== "AbortError") state.liveError = String(e?.message || e);
  }
  settleFinishedBets();
  notifyForOwnSettledBets();
  notifyForKickoffSoon();
  settleFinishedPoolPredictions().catch(() => {});
  renderFreshnessBanner();
}

/* ─────────── Local notifications (PR F) ─────────── */
//
// In-app notifications via the Web Notifications API. Three triggers:
//  - own bet settled (won/lost/void)
//  - room friend's bet settled (via Supabase realtime callback)
//  - match starting in ≤ 15 min (own preferred teams not required)
//
// True background push (delivered when tab closed) needs VAPID + a server
// endpoint to send push messages and a SW push handler. That's a bigger
// lift; this PR ships local notifications which fire whenever the app
// is open OR the installed PWA is running, which covers the typical
// friend-watching-the-match use case.

function notifyAvailable() {
  return typeof Notification !== "undefined";
}

async function requestNotifyPermission() {
  if (!notifyAvailable()) return false;
  if (Notification.permission === "granted") { state.notifyEnabled = true; return true; }
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission().catch(() => "default");
  state.notifyEnabled = result === "granted";
  try { localStorage.setItem("wc26_notify_enabled", state.notifyEnabled ? "1" : "0"); } catch {}
  return state.notifyEnabled;
}

function notify(title, body, tag) {
  if (!notifyAvailable() || !state.notifyEnabled) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, {
      body,
      tag: tag || undefined,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
    });
  } catch { /* some browsers throw if rate-limited */ }
}

function notifyForOwnSettledBets() {
  if (!state.notifyEnabled) return;
  for (const b of state.betHistory) {
    if (b.status === "open") continue;
    if (state.notifiedSettled.has(b.id)) continue;
    const label = b.items?.map((i) => i.label).filter(Boolean).slice(0, 1).join(" · ") || "Combo";
    const heading = b.status === "won"  ? `Wette gewonnen · +€${((b.payout || 0) - b.stake).toFixed(2)}`
                  : b.status === "lost" ? `Wette verloren · −€${b.stake.toFixed(2)}`
                  : "Wette storniert";
    notify(heading, label, `bet-${b.id}`);
    state.notifiedSettled.add(b.id);
  }
}

function notifyForKickoffSoon() {
  if (!state.notifyEnabled || !state.schedule) return;
  const now = Date.now();
  for (const m of state.schedule) {
    if (!m.kickoffUTC) continue;
    if (state.notifiedKickoffs.has(m.matchNo)) continue;
    const k = new Date(m.kickoffUTC).getTime();
    const mins = (k - now) / 60_000;
    if (mins > 0 && mins <= 15) {
      const teamA = teamName(m.teamA) || m.teamA;
      const teamB = teamName(m.teamB) || m.teamB;
      notify(`Anpfiff in ${Math.round(mins)} Min`, `${teamA} vs ${teamB}`, `kickoff-${m.matchNo}`);
      state.notifiedKickoffs.add(m.matchNo);
    }
  }
}

function notifyFriendBetSettled(bet) {
  if (!state.notifyEnabled) return;
  if (!bet || bet.status === "open") return;
  if (bet.user_id === state.supabaseUser?.id) return;  // own bets handled separately
  if (state.notifiedFriendBets.has(bet.id)) return;
  const nick = state.roomMembers.find((m) => m.user_id === bet.user_id)?.nickname || "Friend";
  const result = bet.status === "won" ? "gewinnt" : bet.status === "lost" ? "verliert" : "void";
  const label = bet.items?.[0]?.label || "Combo";
  notify(`${nick} ${result}`, label, `friend-bet-${bet.id}`);
  state.notifiedFriendBets.add(bet.id);
}

function wireNotifications() {
  const btn = $("#notify-toggle");
  if (!btn || btn.dataset.wired) return;
  btn.dataset.wired = "1";
  // Restore enabled flag (but verify with current Permission state).
  try {
    if (localStorage.getItem("wc26_notify_enabled") === "1"
        && notifyAvailable()
        && Notification.permission === "granted") {
      state.notifyEnabled = true;
    }
  } catch {}
  renderNotifyToggle();
  btn.addEventListener("click", async () => {
    if (state.notifyEnabled) {
      state.notifyEnabled = false;
      try { localStorage.setItem("wc26_notify_enabled", "0"); } catch {}
    } else {
      await requestNotifyPermission();
    }
    renderNotifyToggle();
  });
}

function renderNotifyToggle() {
  const btn = $("#notify-toggle");
  const status = $("#notify-status");
  if (!btn) return;
  const dict = t().notify || {};
  if (!notifyAvailable()) {
    btn.hidden = true;
    if (status) status.textContent = dict.unsupported || "Notifications unsupported in this browser.";
    return;
  }
  if (Notification.permission === "denied") {
    btn.disabled = true;
    btn.textContent = dict.denied || "Notifications blockiert (Browser-Einstellung)";
    if (status) status.textContent = "";
    return;
  }
  btn.disabled = false;
  btn.textContent = state.notifyEnabled
    ? (dict.disable || "Notifications aus")
    : (dict.enable || "Notifications an");
  btn.classList.toggle("active", state.notifyEnabled);
  if (status) status.textContent = state.notifyEnabled
    ? (dict.enabledHint || "Du wirst bei Anpfiff (≤15 Min), eigenen Settlements und Friend-Wetten gepingt.")
    : "";
}

/* ─────────── Bet simulator ─────────── */

function persistBetState() {
  try {
    localStorage.setItem("wc26_betslip_v1", JSON.stringify(state.betSlip));
    localStorage.setItem("wc26_bet_history_v1", JSON.stringify(state.betHistory));
    localStorage.setItem("wc26_bet_stake", String(state.betStake));
    localStorage.setItem("wc26_betslip_collapsed", state.betSlipCollapsed ? "1" : "0");
  } catch { /* quota */ }
}

// Toggle a selection in the slip. dataset.bet = "matchNo|marketId".
function toggleBetSelection(payload) {
  const [matchNoStr, marketId] = String(payload || "").split("|");
  const matchNo = Number(matchNoStr);
  if (!Number.isFinite(matchNo) || !marketId) return;
  const fc = state.matchForecasts?.get(matchNo);
  if (!fc?.matchups?.[0]) return;
  const primary = fc.matchups[0];
  const rho = state.dcParams?.rho || 0;
  const markets = deriveMarkets(primary, rho);
  const mk = markets[marketId];
  if (!mk || !mk.fairOdds) return;
  // Remove any existing selection for the same matchNo (one bet per match
  // in the slip — no contradictory selections like "Home Win + Draw").
  const idx = state.betSlip.findIndex((s) => s.matchNo === matchNo && s.marketId === marketId);
  if (idx >= 0) {
    state.betSlip.splice(idx, 1);
  } else {
    // Drop any prior selection on the same match before adding the new one.
    state.betSlip = state.betSlip.filter((s) => s.matchNo !== matchNo);
    const bookie = state.matchOdds?.matches?.[matchNo] || null;
    const bookieMap = bookie ? {
      "wld.home": bookie.home, "wld.draw": bookie.draw, "wld.away": bookie.away,
      "totals.over_2.5": bookie.over25, "totals.under_2.5": bookie.under25,
      "btts.yes": bookie.btts_yes, "btts.no": bookie.btts_no,
    } : {};
    const marketP = bookieMap[marketId];
    state.betSlip.push({
      matchNo, marketId,
      label: mk.label,
      teamA: primary.teamA, teamB: primary.teamB,
      modelP: mk.p,
      modelOdds: mk.fairOdds,
      marketOdds: (Number.isFinite(marketP) && marketP > 0.01 && marketP < 0.99) ? 1 / marketP : null,
      outcome: mk.outcome,
    });
  }
  persistBetState();
}

function renderBetSlip() {
  const dict = t();
  const bets = dict.bets || {};
  const aside = $("#bet-slip");
  if (!aside) return;
  const items = state.betSlip;
  if (!items.length) {
    aside.hidden = true;
    return;
  }
  aside.hidden = false;
  aside.classList.toggle("collapsed", !!state.betSlipCollapsed);
  $("#bet-slip-count").textContent = String(items.length);
  $("#bet-slip-toggle").textContent = state.betSlipCollapsed ? "+" : "−";
  $("#bet-slip-items").innerHTML = items.map((s) => `
    <div class="slip-item">
      <div class="slip-line"><b>${escape(s.teamA)} – ${escape(s.teamB)}</b>
        <button class="slip-remove" data-bet="${s.matchNo}|${s.marketId}" type="button" title="${escape(bets.remove || "Entfernen")}">×</button></div>
      <div class="slip-line muted small">${escape(s.label)}</div>
      <div class="slip-line"><span>${escape(bets.modelOdds || "Modell")}: <b>${s.modelOdds.toFixed(2)}</b></span>
        ${s.marketOdds ? `<span class="muted">${escape(bets.marketOdds || "Markt")}: ${s.marketOdds.toFixed(2)}</span>` : ""}</div>
    </div>`).join("");
  // Combo math
  const comboModel = items.reduce((p, s) => p * s.modelOdds, 1);
  const haveAllMarket = items.every((s) => s.marketOdds);
  const comboMarket = haveAllMarket ? items.reduce((p, s) => p * s.marketOdds, 1) : null;
  const stake = state.betStake || 1;
  $("#bet-combo-odds").textContent = comboModel.toFixed(2);
  $("#bet-return").textContent = `€${(stake * comboModel).toFixed(2)}`;
  $("#bet-edge").textContent = comboMarket ? `${((comboModel / comboMarket - 1) * 100).toFixed(1)}%` : "—";
  $("#bet-edge").className = comboMarket
    ? (comboModel > comboMarket ? "edge-pos" : "edge-neg")
    : "";
}

function placeBet() {
  const items = state.betSlip;
  if (!items.length) return;
  const stake = state.betStake || 1;
  const comboOdds = items.reduce((p, s) => p * s.modelOdds, 1);
  const comboMarketOdds = items.every((s) => s.marketOdds)
    ? items.reduce((p, s) => p * s.marketOdds, 1)
    : null;
  const bet = {
    id: `bet_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    placedAt: new Date().toISOString(),
    stake,
    comboOdds,
    comboMarketOdds,
    items: items.map((s) => ({ ...s })),
    status: "open",      // open | won | lost | void
    payout: null,
    settledAt: null,
  };
  state.betHistory.unshift(bet);
  state.betSlip = [];
  persistBetState();
  renderBetSlip();
  renderWallet();
  // Push to Supabase (if logged in + in a room) so friends see it live.
  // Fire-and-forget; never blocks the local flow.
  pushBetToRoom(bet).then(() => renderFriends()).catch(() => {});
  // Re-render any open match panels so the now-deselected cells lose .selected.
  if (state.expandedMatch != null) renderGroups();
  renderScheduleSection();
}

function clearSlip() {
  state.betSlip = [];
  persistBetState();
  renderBetSlip();
  if (state.expandedMatch != null) renderGroups();
  renderScheduleSection();
}

// Auto-settle bets whose matches have finished. Called from pollLive().
function settleFinishedBets() {
  let changed = false;
  for (const bet of state.betHistory) {
    if (bet.status !== "open") continue;
    const verdicts = [];
    let undetermined = false;
    for (const item of bet.items) {
      const live = getLiveForSchedule(item.matchNo);
      if (!live || live.status !== "finished" || live.scoreA == null || live.scoreB == null) {
        undetermined = true;
        verdicts.push(null);
        continue;
      }
      const v = settleMarket(item, {
        scoreA: live.scoreA, scoreB: live.scoreB,
        htScoreA: live.htScoreA, htScoreB: live.htScoreB,
        goalScorers: live.goalScorers,
      });
      verdicts.push(v);
    }
    if (undetermined) continue;       // wait for all legs to settle
    // A null verdict (e.g. DNB on a drawn match) voids that leg but the
    // remaining legs still settle; combo combos drop the voided leg from
    // the odds product. If ALL legs are null, the whole bet is void.
    const liveLegs = verdicts.filter((v) => v !== null);
    if (liveLegs.length === 0) {
      bet.status = "void";
      bet.payout = bet.stake;
    } else if (liveLegs.every((v) => v === true)) {
      // Recompute combo from non-void legs.
      const liveOdds = bet.items.reduce((acc, item, i) => verdicts[i] === null ? acc : acc * item.modelOdds, 1);
      bet.status = "won";
      bet.payout = bet.stake * liveOdds;
    } else {
      bet.status = "lost";
      bet.payout = 0;
    }
    bet.settledAt = new Date().toISOString();
    changed = true;
  }
  if (changed) {
    persistBetState();
    renderWallet();
    // Mirror settlement to Supabase so the leaderboard stays in sync.
    pushSettledBets().then(() => renderFriends()).catch(() => {});
  }
}

function fmtPL(n) {
  const s = n >= 0 ? "+" : "−";
  return `${s}€${Math.abs(n).toFixed(2)}`;
}

function renderWallet() {
  const dict = t();
  const w = dict.wallet || {};
  const root = $("#wallet-card");
  if (!root) return;
  const hist = state.betHistory;
  const settled = hist.filter((b) => b.status !== "open");
  const open = hist.filter((b) => b.status === "open");
  let pl = 0, wins = 0, losses = 0;
  let edgeSum = 0, edgeCount = 0;
  for (const b of settled) {
    pl += (b.payout || 0) - b.stake;
    if (b.status === "won") wins++;
    if (b.status === "lost") losses++;
    if (b.comboMarketOdds && b.comboOdds) {
      edgeSum += (b.comboOdds / b.comboMarketOdds) - 1;
      edgeCount++;
    }
  }
  const decided = wins + losses;
  const plEl = $("#wallet-pl");
  if (plEl) {
    plEl.textContent = fmtPL(pl);
    plEl.classList.toggle("edge-pos", pl > 0);
    plEl.classList.toggle("edge-neg", pl < 0);
  }
  if ($("#wallet-count")) $("#wallet-count").textContent = String(hist.length);
  if ($("#wallet-hitrate")) $("#wallet-hitrate").textContent = decided ? `${((wins / decided) * 100).toFixed(0)}%` : "—";
  if ($("#wallet-edge")) $("#wallet-edge").textContent = edgeCount ? `${((edgeSum / edgeCount) * 100).toFixed(1)}%` : "—";
  const renderRows = (list, isHistory) => {
    if (!list.length) return `<p class="empty-state">${escape(w.empty || "Noch keine Wetten.")}</p>`;
    return `<table class="wallet-table">
      <thead><tr>
        <th>${escape(w.colPlaced || "Platziert")}</th>
        <th>${escape(w.colItems || "Auswahl")}</th>
        <th>${escape(w.colStake || "Einsatz")}</th>
        <th>${escape(w.colOdds || "Kombi-Quote")}</th>
        <th>${escape(w.colStatus || "Status")}</th>
        ${isHistory ? `<th>${escape(w.colPL || "P&L")}</th>` : ""}
      </tr></thead>
      <tbody>
      ${list.slice(0, 50).map((b) => {
        const items = b.items.map((it) => `${it.teamA}–${it.teamB} · ${it.label}`).join("<br>");
        const statusCls = b.status === "won" ? "edge-pos" : b.status === "lost" ? "edge-neg" : "muted";
        const statusLbl = b.status === "open" ? (w.open || "Offen")
                         : b.status === "won" ? (w.won || "Gewonnen")
                         : b.status === "lost" ? (w.lost || "Verloren")
                         : (w.void || "Storniert");
        const plCell = isHistory ? `<td class="${b.payout > b.stake ? "edge-pos" : b.payout < b.stake ? "edge-neg" : "muted"}">${fmtPL((b.payout || 0) - b.stake)}</td>` : "";
        return `<tr>
          <td class="muted small">${b.placedAt.slice(0, 16).replace("T", " ")}</td>
          <td class="small">${items}</td>
          <td>€${b.stake.toFixed(2)}</td>
          <td>${b.comboOdds.toFixed(2)}</td>
          <td class="${statusCls}">${escape(statusLbl)}</td>
          ${plCell}
        </tr>`;
      }).join("")}
      </tbody></table>`;
  };
  if ($("#wallet-open")) $("#wallet-open").innerHTML = renderRows(open, false);
  if ($("#wallet-history")) $("#wallet-history").innerHTML = renderRows(settled, true);
}

function wireBetSlip() {
  const slipEl = $("#bet-slip");
  if (!slipEl || slipEl.dataset.wired) return;
  slipEl.dataset.wired = "1";
  // Toggle (collapse / expand)
  $("#bet-slip-toggle")?.addEventListener("click", () => {
    state.betSlipCollapsed = !state.betSlipCollapsed;
    persistBetState();
    renderBetSlip();
  });
  // Remove single item (via × button inside slip)
  slipEl.addEventListener("click", (e) => {
    const rm = e.target.closest(".slip-remove[data-bet]");
    if (rm) { toggleBetSelection(rm.dataset.bet); renderBetSlip();
      if (state.expandedMatch != null) renderGroups();
      renderScheduleSection();
      return; }
  });
  // Stake input
  $("#bet-stake")?.addEventListener("input", (e) => {
    const v = Number(e.target.value);
    state.betStake = Number.isFinite(v) && v > 0 ? v : 1;
    persistBetState();
    renderBetSlip();
  });
  $("#bet-place")?.addEventListener("click", placeBet);
  $("#bet-clear")?.addEventListener("click", clearSlip);
  $("#wallet-reset")?.addEventListener("click", () => {
    if (!confirm(t().wallet?.confirmReset || "P&L wirklich zurücksetzen? Alle Wetten werden gelöscht.")) return;
    state.betHistory = [];
    persistBetState();
    renderWallet();
  });
}

/* ─────────── Multiplayer (Supabase) ─────────── */

// Loaded lazily — only when /api/config.js says WC26_SUPABASE is set.
// Otherwise the entire #friends-card stays hidden and the bets pipeline
// remains pure localStorage (single-player).
async function initSupabase() {
  const cfg = (typeof window !== "undefined") ? window.WC26_SUPABASE : null;
  if (!cfg || !cfg.url || !cfg.anonKey) return null;
  // Defensive normalisation: users sometimes copy the "Data API" URL which
  // ends in /rest/v1 or has a trailing slash. createClient expects the bare
  // project host, so strip those tails before passing it through.
  let url = String(cfg.url).trim();
  url = url.replace(/\/+$/, "");                    // trailing slashes
  url = url.replace(/\/rest\/v1$/i, "");            // /rest/v1 suffix
  url = url.replace(/\/auth\/v1$/i, "");            // /auth/v1 suffix (just in case)
  try {
    // Supabase is self-hosted (vendor/supabase.js — loaded via <script> before
    // app.js and precached by the service worker), so window.supabase is ready
    // synchronously at boot. No runtime CDN import → the login gate never hangs
    // waiting on a slow/cold esm.sh fetch and never wrongly fails open.
    const lib = (typeof window !== "undefined") ? window.supabase : null;
    if (!lib || typeof lib.createClient !== "function") {
      console.warn("Supabase library not loaded (vendor/supabase.js missing?) — multiplayer hidden.");
      return null;
    }
    const client = lib.createClient(url, cfg.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    return client;
  } catch (e) {
    console.warn("Supabase init failed (multiplayer hidden):", e?.message || e);
    return null;
  }
}

async function refreshSupabaseUser() {
  if (!state.supabase) return;
  try {
    const { data } = await state.supabase.auth.getUser();
    state.supabaseUser = data?.user || null;
  } catch {
    state.supabaseUser = null;
  }
}

async function sendMagicLink(email) {
  if (!state.supabase || !email) return false;
  state.authPending = true;
  renderFriends();
  try {
    const { error } = await state.supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.origin + location.pathname },
    });
    state.authPending = false;
    renderFriends();
    return !error;
  } catch {
    state.authPending = false;
    renderFriends();
    return false;
  }
}

// Password reset — sends a recovery email. Needs working SMTP (Resend).
async function sendPasswordReset(email) {
  if (!state.supabase || !email) return { ok: false, error: "missing" };
  try {
    const { error } = await state.supabase.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin + location.pathname,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// Completes a reset after the PASSWORD_RECOVERY auth event fires: sets a new
// password on the recovery session, then the user is fully signed in.
async function completePasswordReset(password) {
  if (!state.supabase || !password) return { ok: false, error: "missing" };
  if (password.length < 6) return { ok: false, error: t().friends?.pwTooShort || "Passwort braucht ≥ 6 Zeichen." };
  try {
    const { error } = await state.supabase.auth.updateUser({ password });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// App-level membership profile (app_status, is_admin) for the current user.
// Drives the approval gate + admin panel visibility.
async function loadProfile() {
  state.profile = null;
  if (!state.supabase || !state.supabaseUser) return;
  try {
    const { data } = await state.supabase
      .from("profiles")
      .select("app_status,is_admin,display_name,email")
      .eq("id", state.supabaseUser.id)
      .maybeSingle();
    state.profile = data || null;
  } catch { state.profile = null; }
}

function isAppApproved() { return state.profile?.app_status === "approved"; }
function isAppAdmin() { return !!state.profile?.is_admin; }

// ─────────── Membership approvals ───────────

// Admin: pending app-membership requests (only loads for admins).
async function loadPendingApprovals() {
  state.pendingApprovals = [];
  if (!state.supabase || !isAppAdmin()) return;
  try {
    const { data } = await state.supabase
      .from("profiles").select("id,email,display_name,requested_at")
      .eq("app_status", "pending").order("requested_at", { ascending: true });
    state.pendingApprovals = Array.isArray(data) ? data : [];
  } catch { state.pendingApprovals = []; }
}

// Admin: approve or reject a user for the whole app.
async function approveAppMember(userId, approved) {
  if (!state.supabase || !userId) return;
  await state.supabase.from("profiles")
    .update({ app_status: approved ? "approved" : "rejected", decided_at: new Date().toISOString(), decided_by: state.supabaseUser?.id })
    .eq("id", userId);
  await loadPendingApprovals();
  renderFriends();
}

// Room owner: approve a pending join request for the active room.
async function approveRoomMember(roomId, userId) {
  if (!state.supabase || !roomId || !userId) return;
  await state.supabase.from("room_members")
    .update({ status: "approved" }).eq("room_id", roomId).eq("user_id", userId);
  await loadRoomData();
  renderFriends();
}

// Room owner: reject (remove) a pending join request.
async function rejectRoomMember(roomId, userId) {
  if (!state.supabase || !roomId || !userId) return;
  await state.supabase.from("room_members")
    .delete().eq("room_id", roomId).eq("user_id", userId);
  await loadRoomData();
  renderFriends();
}

// Admin realtime: re-load pending requests when any profile changes.
function subscribeApprovalsRealtime() {
  if (!state.supabase || !isAppAdmin() || state.approvalsChannel) return;
  state.approvalsChannel = state.supabase
    .channel("app-approvals")
    .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, async () => {
      await loadPendingApprovals();
      renderFriends();
    })
    .subscribe();
}

// Email + password — classic persistent login. Supabase persists the session
// in localStorage automatically via persistSession:true so users stay logged
// in across reloads and devices (when they sign in on each one).
async function signInWithPassword(email, password) {
  if (!state.supabase || !email || !password) return { ok: false, error: "missing" };
  try {
    const { error } = await state.supabase.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function signUpWithPassword(email, password, displayName) {
  if (!state.supabase || !email || !password) return { ok: false, error: "missing" };
  if (password.length < 6) return { ok: false, error: t().friends?.pwTooShort || "Passwort braucht ≥ 6 Zeichen." };
  try {
    const { data, error } = await state.supabase.auth.signUp({
      email,
      password,
      options: { data: displayName ? { display_name: displayName } : {} },
    });
    if (error) return { ok: false, error: error.message };
    // With "Confirm email" OFF, signUp returns an active session immediately
    // and the DB trigger has created a profiles row with app_status='pending'.
    // If confirmation is ON, data.session is null → ask them to confirm first.
    if (!data?.session) {
      return { ok: false, error: t().friends?.confirmHint || "Account erstellt — bitte Email bestätigen." };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function supabaseSignOut() {
  if (!state.supabase) return;
  await leaveActiveRoom();
  await state.supabase.auth.signOut().catch(() => {});
  state.supabaseUser = null;
  state.activeRoom = null;
  state.roomMembers = [];
  state.roomBets = [];
  try { localStorage.removeItem("wc26_active_room"); } catch {}
  renderFriends();
}

function genRoomCode() {
  // 6-char base32, A–Z + 2–9 minus easily-confused chars.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

async function createRoom(nickname) {
  if (!state.supabase || !state.supabaseUser || !nickname) return null;
  if (!isAppApproved()) return null;  // app-level gate
  const code = genRoomCode();
  const { data: room, error: roomErr } = await state.supabase
    .from("rooms").insert({ code, name: null, owner_id: state.supabaseUser.id }).select().single();
  if (roomErr || !room) return null;
  // The owner is an approved member of their own room immediately.
  const { error: memberErr } = await state.supabase
    .from("room_members").insert({ room_id: room.id, user_id: state.supabaseUser.id, nickname, status: "approved" });
  if (memberErr) return null;
  return room;
}

async function joinRoomByCode(code, nickname) {
  if (!state.supabase || !state.supabaseUser || !nickname || !code) return null;
  if (!isAppApproved()) return null;  // app-level gate
  const { data: room } = await state.supabase
    .from("rooms").select().eq("code", code.toUpperCase()).maybeSingle();
  if (!room) return null;
  // Owner is already an approved member.
  if (room.owner_id === state.supabaseUser.id) return room;
  // Don't reset an existing membership's status; only create a pending one.
  const { data: existing } = await state.supabase
    .from("room_members").select("status")
    .eq("room_id", room.id).eq("user_id", state.supabaseUser.id).maybeSingle();
  if (!existing) {
    await state.supabase
      .from("room_members")
      .insert({ room_id: room.id, user_id: state.supabaseUser.id, nickname, status: "pending" });
  }
  return room;  // room-level approval still pending until the owner approves
}

async function activateRoom(room) {
  state.activeRoom = room;
  try { localStorage.setItem("wc26_active_room", JSON.stringify(room)); } catch {}
  await loadRoomData();
  await loadActivePools();
  subscribeRoomRealtime();
  renderFriends();
  renderPools();
}

async function leaveActiveRoom() {
  if (!state.activeRoom) return;
  if (state.roomChannel) {
    try { await state.supabase.removeChannel(state.roomChannel); } catch {}
    state.roomChannel = null;
  }
  if (state.supabase && state.supabaseUser) {
    await state.supabase
      .from("room_members")
      .delete()
      .match({ room_id: state.activeRoom.id, user_id: state.supabaseUser.id });
  }
  state.activeRoom = null;
  state.roomMembers = [];
  state.roomBets = [];
  try { localStorage.removeItem("wc26_active_room"); } catch {}
  renderFriends();
}

async function loadRoomData() {
  if (!state.supabase || !state.activeRoom) return;
  const roomId = state.activeRoom.id;
  const [{ data: members }, { data: bets }] = await Promise.all([
    state.supabase.from("room_members").select().eq("room_id", roomId),
    state.supabase.from("bets").select().eq("room_id", roomId).order("placed_at", { ascending: false }).limit(500),
  ]);
  state.roomMembers = Array.isArray(members) ? members : [];
  state.roomBets = Array.isArray(bets) ? bets : [];
}

function subscribeRoomRealtime() {
  if (!state.supabase || !state.activeRoom) return;
  if (state.roomChannel) { try { state.supabase.removeChannel(state.roomChannel); } catch {} state.roomChannel = null; }
  const roomId = state.activeRoom.id;
  const ch = state.supabase.channel(`room:${roomId}`)
    .on("postgres_changes",
      { event: "*", schema: "public", table: "bets", filter: `room_id=eq.${roomId}` },
      (payload) => {
        // Notify on friend-bet settlement (status changed from open).
        const newRow = payload?.new;
        if (newRow && newRow.status && newRow.status !== "open") notifyFriendBetSettled(newRow);
        loadRoomData().then(renderFriends);
      })
    .on("postgres_changes",
      { event: "*", schema: "public", table: "room_members", filter: `room_id=eq.${roomId}` },
      () => loadRoomData().then(renderFriends))
    .on("postgres_changes",
      { event: "*", schema: "public", table: "pools", filter: `room_id=eq.${roomId}` },
      () => loadActivePools().then(renderPools))
    .on("postgres_changes",
      { event: "*", schema: "public", table: "pool_members" },
      () => loadActivePools().then(renderPools))
    .subscribe();
  state.roomChannel = ch;
}

// Sync a placed bet to Supabase if the user is in a room.
async function pushBetToRoom(bet) {
  if (!state.supabase || !state.supabaseUser || !state.activeRoom) return;
  try {
    const row = {
      id: bet.id,
      user_id: state.supabaseUser.id,
      room_id: state.activeRoom.id,
      placed_at: bet.placedAt,
      stake: bet.stake,
      combo_odds: bet.comboOdds,
      combo_market_odds: bet.comboMarketOdds,
      items: bet.items,
      status: bet.status,
      payout: bet.payout,
      settled_at: bet.settledAt,
    };
    await state.supabase.from("bets").upsert(row, { onConflict: "id" });
  } catch (e) {
    console.warn("pushBetToRoom failed:", e?.message || e);
  }
}

// After settlement, push status + payout updates for our own bets to Supabase.
async function pushSettledBets() {
  if (!state.supabase || !state.supabaseUser || !state.activeRoom) return;
  const ours = state.betHistory.filter((b) => b.status !== "open");
  for (const b of ours) {
    try {
      await state.supabase
        .from("bets")
        .update({ status: b.status, payout: b.payout, settled_at: b.settledAt })
        .match({ id: b.id });
    } catch { /* ignore */ }
  }
}

// Tiny DOM builder — avoids innerHTML with user-supplied content (XSS-safe).
function makeEl(tag, opts = {}, kids = []) {
  const n = document.createElement(tag);
  if (opts.class) n.className = opts.class;
  if (opts.text != null) n.textContent = opts.text;
  if (opts.style) n.style.cssText = opts.style;
  if (opts.type) n.type = opts.type;
  if (opts.data) for (const [k, v] of Object.entries(opts.data)) n.dataset[k] = v;
  for (const k of kids) if (k) n.appendChild(k);
  return n;
}

// Replace an element's content with a single muted note paragraph.
function setNote(el, text) {
  if (el) el.replaceChildren(makeEl("p", { class: "empty-state", text }));
}

// One approve/reject row used by both the admin + room-owner panels.
function approvalRow(label, sublabel, approveData, rejectData, f) {
  const left = makeEl("span", { text: label });
  if (sublabel) left.appendChild(makeEl("span", { class: "muted small", text: " · " + sublabel }));
  const actions = makeEl("span", { style: "display:flex;gap:6px" }, [
    makeEl("button", { class: "primary", type: "button", text: f.approve || "Freigeben", data: approveData }),
    makeEl("button", { class: "copy-btn", type: "button", text: f.reject || "Ablehnen", data: rejectData }),
  ]);
  return makeEl("div", { style: "display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 0" }, [left, actions]);
}

// Admin panel: pending app-membership requests.
function renderAdminPanel(el, f) {
  if (!el) return;
  if (!isAppAdmin()) { el.hidden = true; el.replaceChildren(); return; }
  const reqs = state.pendingApprovals || [];
  el.hidden = false;
  el.replaceChildren();
  if (!reqs.length) {
    el.appendChild(makeEl("p", { class: "muted small", text: f.adminNoRequests || "Keine offenen Mitglieds-Anfragen." }));
    return;
  }
  el.appendChild(makeEl("h4", { text: (f.adminHeader || "Mitglieds-Anfragen") + ` (${reqs.length})` }));
  for (const r of reqs) {
    el.appendChild(approvalRow(
      r.display_name || r.email || r.id.slice(0, 8),
      (r.email && r.display_name) ? r.email : "",
      { approveApp: r.id }, { rejectApp: r.id }, f));
  }
}

// Room-owner panel: pending join requests for the active room.
function renderRoomRequests(f) {
  const el = $("#friends-room-requests");
  if (!el) return;
  const isOwner = !!(state.activeRoom && state.supabaseUser && state.activeRoom.owner_id === state.supabaseUser.id);
  const pending = isOwner ? state.roomMembers.filter((m) => m.status === "pending") : [];
  el.replaceChildren();
  if (!pending.length) { el.hidden = true; return; }
  el.hidden = false;
  el.appendChild(makeEl("h4", { text: (f.roomRequestsHeader || "Beitritts-Anfragen") + ` (${pending.length})` }));
  for (const m of pending) {
    el.appendChild(approvalRow(m.nickname || m.user_id.slice(0, 8), "", { approveRoom: m.user_id }, { rejectRoom: m.user_id }, f));
  }
}

// ─────────── Full-screen login gate ───────────
// New presentation layer in front of the existing auth handlers. Decides what
// the #auth-gate overlay shows (loading / login / signup / recovery / pending)
// and unlocks the app once the user is approved. No new auth logic — it wires to
// signInWithPassword / signUpWithPassword / sendPasswordReset / completePasswordReset.
function renderAuthGate() {
  const gate = $("#auth-gate");
  if (!gate) return;
  const a = t().auth || {};
  const f = t().friends || {};
  const chip = $("#account-chip");
  const setView = (name) => gate.querySelectorAll("[data-auth-view]").forEach((el) => {
    el.hidden = el.getAttribute("data-auth-view") !== name;
  });
  const lock = (on) => {
    gate.hidden = !on;
    document.body.classList.toggle("auth-locked", on);
  };

  // Distinguish "backend not configured" from "client still initializing".
  const configured = !!(typeof window !== "undefined" && window.WC26_SUPABASE && window.WC26_SUPABASE.url);
  if (!configured) { lock(false); if (chip) chip.hidden = true; return; }   // no backend → no gate
  if (!state.supabase) {
    // Configured but client not ready: spinner while initializing; once init has
    // finished without a client (failed / timed out), fail OPEN so a flaky CDN or
    // network never bricks the whole app behind the gate.
    if (state.supabaseInitDone) { lock(false); if (chip) chip.hidden = true; return; }
    setView("loading"); lock(true); if (chip) chip.hidden = true; return;
  }
  // Password-recovery link landed → new-password form.
  if (state.passwordRecovery) { setView("recovery"); lock(true); if (chip) chip.hidden = true; return; }

  // Logged out → login / signup form (toggled via state.authMode).
  if (!state.supabaseUser) {
    const signup = state.authMode === "signup";
    setView("auth");
    const heading = $("#auth-heading");
    if (heading) heading.textContent = signup ? (a.signupHeading || "Konto erstellen") : (a.signinHeading || "Anmelden");
    const nameField = $("#auth-name-field");
    if (nameField) nameField.hidden = !signup;
    const submit = $("#auth-submit");
    if (submit) submit.textContent = signup ? (a.signupBtn || "Konto erstellen") : (a.signinBtn || "Anmelden");
    const toggle = $("#auth-toggle");
    if (toggle) toggle.textContent = signup ? (a.toSignin || "Schon dabei? Anmelden") : (a.toSignup || "Noch kein Konto? Konto erstellen");
    // One-time autofocus on the email field for a normal login feel.
    if (!state._authFocused) { state._authFocused = true; setTimeout(() => { const em = $("#auth-email"); if (em && !em.value) em.focus(); }, 60); }
    lock(true); if (chip) chip.hidden = true; return;
  }

  // Profile still loading (fetch in flight or failed) → spinner, NOT "pending".
  // The boot safety-net fails open if it never arrives, so a stalled profile
  // fetch can't lock a logged-in user out behind the gate.
  if (!state.profile) { setView("loading"); lock(true); if (chip) chip.hidden = true; return; }

  // Logged in but not yet approved (and not admin) → pending screen.
  if (!isAppApproved() && !isAppAdmin()) {
    const body = $("#auth-pending-body");
    if (body) body.textContent = state.profile?.app_status === "rejected"
      ? (a.rejected || f.rejected || "Dein Zugang wurde abgelehnt.")
      : (a.pendingBody || f.awaitingApproval || "Warte auf Freigabe durch den Admin.");
    setView("pending"); lock(true); if (chip) chip.hidden = true; return;
  }

  // Approved / admin → unlock the app, show the account chip in the header.
  lock(false);
  if (chip) {
    chip.hidden = false;
    const nameEl = $("#account-name");
    if (nameEl) nameEl.textContent = state.profile?.display_name || state.supabaseUser.email || state.supabaseUser.id.slice(0, 8);
  }
}

function wireAuthGate() {
  const gate = $("#auth-gate");
  if (!gate || gate.dataset.wired) return;
  gate.dataset.wired = "1";
  if (!state.authMode) state.authMode = "login";

  const status = $("#auth-status");
  const setStatus = (msg, ok) => {
    if (!status) return;
    status.textContent = msg || "";
    status.classList.toggle("is-error", !!msg && !ok);
    status.classList.toggle("is-ok", !!ok);
  };

  const submit = async () => {
    const email = $("#auth-email")?.value?.trim();
    const password = $("#auth-password")?.value || "";
    const name = $("#auth-name")?.value?.trim();
    if (!email || !password) { setStatus(t().friends?.pwMissing || "Email + Passwort eintragen."); return; }
    const btn = $("#auth-submit");
    const label = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "…"; }
    try {
      if (state.authMode === "signup") {
        const r = await signUpWithPassword(email, password, name);
        setStatus(r.ok ? (t().auth?.signupOk || "Anfrage gesendet — warte auf Freigabe.") : (r.error || "Sign-up fehlgeschlagen."), r.ok);
      } else {
        const r = await signInWithPassword(email, password);
        if (!r.ok) setStatus(r.error || "Login fehlgeschlagen.");
        // success → onAuthStateChange repaints the gate (unlocks if approved).
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  };

  $("#auth-form")?.addEventListener("submit", (e) => { e.preventDefault(); submit(); });
  $("#auth-toggle")?.addEventListener("click", (e) => {
    e.preventDefault();
    state.authMode = state.authMode === "signup" ? "login" : "signup";
    setStatus("");
    renderAuthGate();
  });
  $("#auth-forgot")?.addEventListener("click", async (e) => {
    e.preventDefault();
    const email = $("#auth-email")?.value?.trim();
    if (!email) { setStatus(t().friends?.emailMissing || "Email eintragen."); return; }
    const r = await sendPasswordReset(email);
    setStatus(r.ok ? (t().friends?.resetSent || "Reset-Mail gesendet — check deine Inbox.") : (r.error || "Fehler."), r.ok);
  });
  $("#auth-newpw-btn")?.addEventListener("click", async () => {
    const pw = $("#auth-newpw")?.value || "";
    const s = $("#auth-newpw-status");
    const r = await completePasswordReset(pw);
    if (r.ok) { state.passwordRecovery = false; if (s) { s.textContent = ""; s.classList.remove("is-error"); } renderFriends(); }
    else if (s) { s.textContent = r.error || "Fehler."; s.classList.add("is-error"); }
  });
  $("#auth-logout")?.addEventListener("click", supabaseSignOut);
  $("#account-logout")?.addEventListener("click", supabaseSignOut);

  // Language switch inside the gate → delegate to the header's already-wired lang buttons.
  gate.querySelectorAll(".auth-langs [data-lang]").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelector(`.hero-tools .lang-btn[data-lang="${b.dataset.lang}"]`)?.click();
      renderAuthGate();
    });
  });
}

function renderFriends() {
  renderAuthGate();
  const dict = t();
  const f = dict.friends || {};
  const card = $("#friends-card");
  if (!card) return;
  if (!state.supabase) {
    // Multiplayer not configured — hide entirely.
    card.hidden = true;
    return;
  }
  card.hidden = false;
  const loginEl = $("#friends-login");
  const recoveryEl = $("#friends-recovery");
  const accountEl = $("#friends-account");
  const roomEl = $("#friends-room");
  const pendingEl = $("#friends-pending");
  const adminEl = $("#friends-admin");
  const lb = $("#friends-leaderboard");
  const hide = (el) => { if (el) el.hidden = true; };
  const show = (el) => { if (el) el.hidden = false; };

  // 0) Password-recovery flow takes over the whole card.
  if (state.passwordRecovery) {
    show(recoveryEl); hide(loginEl); hide(accountEl); hide(roomEl); hide(pendingEl); hide(adminEl);
    if (lb) lb.replaceChildren();
    return;
  }
  hide(recoveryEl);

  // 1) Logged out → login form only.
  if (!state.supabaseUser) {
    show(loginEl); hide(accountEl); hide(roomEl); hide(pendingEl); hide(adminEl);
    const status = $("#friends-login-status");
    if (status && !status.textContent) status.textContent = state.authPending ? (f.loginPending || "Check your inbox.") : "";
    if (lb) lb.replaceChildren();
    return;
  }

  // 2) Logged in → account header (display name or email).
  hide(loginEl); show(accountEl);
  const emailEl = $("#friends-user-email");
  if (emailEl) emailEl.textContent = state.profile?.display_name || state.supabaseUser.email || state.supabaseUser.id.slice(0, 8);

  // 3) Admin approval panel (independent of room membership).
  renderAdminPanel(adminEl, f);

  // 4) App-level gate: not approved (and not admin) → block multiplayer.
  if (!isAppApproved() && !isAppAdmin()) {
    hide(roomEl);
    if (pendingEl) {
      show(pendingEl);
      pendingEl.textContent = state.profile?.app_status === "rejected"
        ? (f.rejected || "Dein Zugang wurde leider abgelehnt.")
        : (f.awaitingApproval || "Anfrage gesendet — warte auf Freigabe durch den Admin.");
    }
    if (lb) lb.replaceChildren();
    return;
  }
  hide(pendingEl); show(roomEl);

  // 5) One global round — no room-management UI to render.

  // 6) Leaderboard — everyone in the round.
  if (!lb) return;
  if (!state.activeRoom) { setNote(lb, f.loadingRound || "Wettrunde wird geladen…"); return; }
  const approvedMembers = state.roomMembers.filter((m) => m.status !== "pending");
  if (!approvedMembers.length) { setNote(lb, f.noMembers || "Noch keine Mitspieler in der Runde."); return; }
  // Compute per-member aggregates from state.roomBets.
  const byUser = new Map();
  for (const m of approvedMembers) byUser.set(m.user_id, { nick: m.nickname, total: 0, won: 0, lost: 0, open: 0, pl: 0, edgeSum: 0, edgeN: 0, last5: [] });
  for (const b of state.roomBets) {
    const agg = byUser.get(b.user_id);
    if (!agg) continue;
    agg.total++;
    if (b.status === "won") agg.won++;
    else if (b.status === "lost") agg.lost++;
    else if (b.status === "open") agg.open++;
    if (b.status !== "open") agg.pl += (Number(b.payout) || 0) - Number(b.stake);
    if (b.combo_market_odds && b.combo_odds) {
      agg.edgeSum += (Number(b.combo_odds) / Number(b.combo_market_odds)) - 1;
      agg.edgeN++;
    }
    if (agg.last5.length < 5) {
      const it = b.items?.[0];
      const labels = (b.items || []).map((i) => i?.label).filter(Boolean).join(" · ");
      agg.last5.push({ status: b.status, odds: b.combo_odds, label: labels || "—" });
    }
  }
  const rows = Array.from(byUser.values())
    .sort((a, b) => b.pl - a.pl || b.won - a.won);
  lb.innerHTML = `
    <h4>${escape(f.leaderboardHeader || "Leaderboard")}</h4>
    <table class="wallet-table">
      <thead><tr>
        <th>${escape(f.colRank || "#")}</th>
        <th>${escape(f.colNick || "Nick")}</th>
        <th>${escape(f.colBets || "Bets")}</th>
        <th>${escape(f.colHitrate || "Hit")}</th>
        <th>${escape(f.colPL || "P&L")}</th>
        <th>${escape(f.colEdge || "Edge")}</th>
        <th>${escape(f.last5 || "Last 5")}</th>
      </tr></thead>
      <tbody>
        ${rows.map((r, i) => {
          const decided = r.won + r.lost;
          const hit = decided ? `${Math.round((r.won / decided) * 100)}%` : "—";
          const edge = r.edgeN ? `${((r.edgeSum / r.edgeN) * 100).toFixed(1)}%` : "—";
          const plCls = r.pl > 0 ? "edge-pos" : r.pl < 0 ? "edge-neg" : "muted";
          const last = r.last5.map((b) => {
            const ico = b.status === "won" ? "✓" : b.status === "lost" ? "✗" : b.status === "void" ? "○" : "·";
            const cls = b.status === "won" ? "edge-pos" : b.status === "lost" ? "edge-neg" : "muted";
            return `<span class="${cls}" title="${escape(b.label)}">${ico} ${Number(b.odds).toFixed(2)}</span>`;
          }).join(" ");
          return `<tr>
            <td>${i < 3 ? ["🥇", "🥈", "🥉"][i] : (i + 1) + "."}</td>
            <td><b>${escape(r.nick)}</b></td>
            <td>${r.total}</td>
            <td>${hit}</td>
            <td class="${plCls}">${fmtPL(r.pl)}</td>
            <td>${edge}</td>
            <td class="small">${last || "—"}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;
}

function wireFriends() {
  const card = $("#friends-card");
  if (!card || card.dataset.wired) return;
  card.dataset.wired = "1";

  $("#friends-login-btn")?.addEventListener("click", async () => {
    const email = $("#friends-email")?.value?.trim();
    if (!email) return;
    const ok = await sendMagicLink(email);
    const s = $("#friends-login-status");
    if (s && !ok) s.textContent = t().friends?.magicErr || "Magic-Link fehlgeschlagen.";
  });
  $("#friends-reset-btn")?.addEventListener("click", async () => {
    const email = $("#friends-email")?.value?.trim();
    const s = $("#friends-login-status");
    if (!email) { if (s) s.textContent = t().friends?.emailMissing || "Email eintragen."; return; }
    const r = await sendPasswordReset(email);
    if (s) s.textContent = r.ok ? (t().friends?.resetSent || "Reset-Mail gesendet — check deine Inbox.") : (r.error || "Fehler.");
  });
  // Email + password (primary path)
  $("#friends-signin-btn")?.addEventListener("click", async () => {
    const email = $("#friends-email")?.value?.trim();
    const password = $("#friends-password")?.value || "";
    if (!email || !password) {
      const s = $("#friends-login-status"); if (s) s.textContent = t().friends?.pwMissing || "Email + Passwort eintragen.";
      return;
    }
    const r = await signInWithPassword(email, password);
    if (!r.ok) {
      const s = $("#friends-login-status"); if (s) s.textContent = r.error || "Login failed.";
    }
  });
  $("#friends-signup-btn")?.addEventListener("click", async () => {
    const email = $("#friends-email")?.value?.trim();
    const password = $("#friends-password")?.value || "";
    const name = $("#friends-name")?.value?.trim();
    if (!email || !password) {
      const s = $("#friends-login-status"); if (s) s.textContent = t().friends?.pwMissing || "Email + Passwort eintragen.";
      return;
    }
    const r = await signUpWithPassword(email, password, name);
    const s = $("#friends-login-status");
    if (s) s.textContent = r.ok ? (t().friends?.signupOk || "Anfrage gesendet — warte auf Freigabe.") : (r.error || "Sign-up failed.");
  });
  $("#friends-newpw-btn")?.addEventListener("click", async () => {
    const pw = $("#friends-newpw")?.value || "";
    const s = $("#friends-newpw-status");
    const r = await completePasswordReset(pw);
    if (r.ok) { state.passwordRecovery = false; if (s) s.textContent = ""; renderFriends(); }
    else if (s) s.textContent = r.error || "Fehler.";
  });
  $("#friends-signout")?.addEventListener("click", supabaseSignOut);
  // Delegated approve/reject for the admin + room-owner panels (survives re-render).
  $("#friends-card")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-approve-app],[data-reject-app],[data-approve-room],[data-reject-room]");
    if (!btn) return;
    if (btn.dataset.approveApp) await approveAppMember(btn.dataset.approveApp, true);
    else if (btn.dataset.rejectApp) await approveAppMember(btn.dataset.rejectApp, false);
    else if (btn.dataset.approveRoom) await approveRoomMember(state.activeRoom?.id, btn.dataset.approveRoom);
    else if (btn.dataset.rejectRoom) await rejectRoomMember(state.activeRoom?.id, btn.dataset.rejectRoom);
  });
  // Room create/join/copy/leave handlers removed — one global round, no room management.
}

// Fallback when localStorage has no active room (new device / cleared cache /
// after an update): find a room where the user is an approved member and
// activate the most recent one. The room lives in the DB, not just the browser.
async function restoreRoomFromDb() {
  // One global "main round" — load it directly via the is_main flag.
  // RLS only returns it to app-approved users (auto-joined as approved
  // members by the DB trigger), so this is also the membership gate.
  if (!state.supabase || !state.supabaseUser) return;
  try {
    const { data: rooms } = await state.supabase
      .from("rooms").select().eq("is_main", true).limit(1);
    if (rooms?.length) await activateRoom(rooms[0]);
  } catch {}
}

async function bootstrapMultiplayer() {
  state.supabase = await initSupabase();
  state.supabaseInitDone = true;   // init finished (success or fail) — lets the gate fail open
  if (!state.supabase) { renderFriends(); return; }
  // Register the auth listener BEFORE the first session lookup so we never
  // miss the SIGNED_IN event that fires asynchronously from
  // detectSessionInUrl after a magic-link redirect lands on /#access_token=…
  state.supabase.auth.onAuthStateChange(async (event, session) => {
    state.supabaseUser = session?.user || null;
    // A password-reset link lands here with a recovery session — show the
    // new-password form instead of the normal UI until it's set.
    if (event === "PASSWORD_RECOVERY") {
      state.passwordRecovery = true;
      renderFriends();
      return;
    }
    await loadProfile();
    renderFriends();
    // If the landing established a session, hydrate admin approvals + the
    // active room from localStorage and (re)load pools — those skip steps
    // ran with supabaseUser = null on first paint.
    if (session?.user) {
      if (isAppAdmin()) { await loadPendingApprovals(); subscribeApprovalsRealtime(); renderFriends(); }
      if (!state.activeRoom) await restoreRoomFromDb();
      await loadPaymentHandles();
      await loadActivePools();
      renderPools();
    }
  });
  // Belt-and-braces: also explicitly call getSession() so any session
  // payload in the URL hash is processed deterministically. Some
  // supabase-js versions delay detectSessionInUrl until the first auth
  // method is called.
  try { await state.supabase.auth.getSession(); } catch {}
  await refreshSupabaseUser();
  await loadProfile();
  if (isAppAdmin()) { await loadPendingApprovals(); subscribeApprovalsRealtime(); }
  // Load the one global main round (RLS gates it to approved users).
  if (!state.activeRoom && state.supabaseUser) await restoreRoomFromDb();
  renderFriends();
  // Also kick off pools / handles loading and render the pools card.
  await loadPaymentHandles();
  await loadActivePools();
  renderPools();
}

/* ─────────── Pools (real-money buy-ins, 3 game types) ─────────── */

// Payment deep-link generators. The app doesn't touch money — it builds
// a URL that opens the user's native payment app with the recipient and
// amount pre-filled, then offers a "mark as paid" button after they're
// back. Privacy-/legal-safe: we are a ledger, not a money transmitter.
const PAYMENT_LINKS = {
  venmo: (amount, handle) => `https://venmo.com/${encodeURIComponent(handle.replace(/^@/, ""))}?txn=pay&amount=${amount}&note=WC2026%20Pool`,
  paypal: (amount, handle) => {
    // accept "paypal.me/foo", "@foo", or "foo"
    const h = handle.replace(/^@/, "").replace(/^https?:\/\/(www\.)?paypal\.me\//, "");
    return `https://paypal.me/${encodeURIComponent(h)}/${amount}EUR`;
  },
  revolut: (amount, handle) => `https://revolut.me/${encodeURIComponent(handle.replace(/^@/, ""))}?amount=${amount}`,
  sepa: (amount, iban) => `bitcoin:?label=WC2026%20Pool&amount=${amount}&iban=${encodeURIComponent(iban)}`,
};

async function loadPaymentHandles() {
  if (!state.supabase || !state.supabaseUser) return;
  const { data } = await state.supabase
    .from("payment_handles").select().eq("user_id", state.supabaseUser.id).maybeSingle();
  state.paymentHandles = data || {};
}

async function savePaymentHandles(handles) {
  if (!state.supabase || !state.supabaseUser) return false;
  const row = {
    user_id: state.supabaseUser.id,
    venmo: handles.venmo || null,
    paypal: handles.paypal || null,
    revolut: handles.revolut || null,
    sepa_iban: handles.sepa_iban || null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await state.supabase.from("payment_handles").upsert(row);
  if (!error) state.paymentHandles = row;
  return !error;
}

async function loadActivePools() {
  if (!state.supabase || !state.supabaseUser || !state.activeRoom) {
    state.pools = []; state.poolMembers = {}; return;
  }
  const { data: pools } = await state.supabase
    .from("pools").select().eq("room_id", state.activeRoom.id).order("created_at", { ascending: false });
  state.pools = Array.isArray(pools) ? pools : [];
  // Load all members for these pools in one query.
  if (state.pools.length === 0) { state.poolMembers = {}; return; }
  const ids = state.pools.map((p) => p.id);
  const { data: members } = await state.supabase
    .from("pool_members").select().in("pool_id", ids);
  const byPool = {};
  for (const m of (members || [])) (byPool[m.pool_id] ||= []).push(m);
  state.poolMembers = byPool;
  // Also load other members' payment handles (room mates).
  const memberIds = (state.roomMembers || []).map((m) => m.user_id);
  if (memberIds.length) {
    const { data: handles } = await state.supabase
      .from("payment_handles").select().in("user_id", memberIds);
    state.roomHandles = (handles || []).reduce((acc, h) => { acc[h.user_id] = h; return acc; }, {});
  }
  // Also pull all predictions for these pools so the picks-UI can render
  // current values without one query per pool.
  const { data: preds } = await state.supabase
    .from("pool_predictions").select().in("pool_id", ids);
  const predsByPool = {};
  for (const p of (preds || [])) (predsByPool[p.pool_id] ||= []).push(p);
  state.poolPredictions = predsByPool;
}

async function createPool(args) {
  if (!state.supabase || !state.supabaseUser || !state.activeRoom) return null;
  const { name, type, buyIn, endsAt } = args;
  if (!name || !type || !buyIn || !endsAt) return null;
  const { data: pool, error } = await state.supabase.from("pools").insert({
    room_id: state.activeRoom.id,
    created_by: state.supabaseUser.id,
    name, pool_type: type, buy_in: buyIn,
    starts_at: new Date().toISOString(),
    ends_at: new Date(endsAt).toISOString(),
  }).select().single();
  if (error || !pool) return null;
  // Creator auto-joins.
  await state.supabase.from("pool_members").insert({
    pool_id: pool.id, user_id: state.supabaseUser.id,
  });
  return pool;
}

async function joinPool(poolId) {
  if (!state.supabase || !state.supabaseUser) return false;
  const { error } = await state.supabase.from("pool_members").upsert({
    pool_id: poolId, user_id: state.supabaseUser.id,
  }, { onConflict: "pool_id,user_id" });
  return !error;
}

async function markBuyInPaid(poolId, paidVia, paidTo) {
  if (!state.supabase || !state.supabaseUser) return false;
  const { error } = await state.supabase.from("pool_members").update({
    buy_in_status: "paid",
    paid_at: new Date().toISOString(),
    paid_via: paidVia || "other",
    paid_to: paidTo || null,
  }).match({ pool_id: poolId, user_id: state.supabaseUser.id });
  if (!error) await loadActivePools();
  return !error;
}

async function deletePool(poolId) {
  if (!state.supabase || !state.supabaseUser) return false;
  const { error } = await state.supabase.from("pools").delete().match({
    id: poolId, created_by: state.supabaseUser.id,
  });
  if (!error) await loadActivePools();
  return !error;
}

// Settle a pool: compute scores from local bet history (for P&L race),
// pick the winner, update status. NOTE: for V1, settlement is creator-
// initiated (button on the pool card after ends_at passes). Bracket and
// CTP settlement uses pool_predictions which is hooked up but the
// evaluation against finished matches is left as a manual "settle" for
// V1 — automatic settlement of bracket/CTP needs match-result joining
// (out-of-scope for this PR).
async function settlePool(pool) {
  if (!state.supabase || !state.supabaseUser) return false;
  const members = state.poolMembers[pool.id] || [];
  if (members.length === 0) return false;
  let winnerId = null;
  if (pool.pool_type === "pnl") {
    // Score = each member's P&L from room-level bets in [starts_at, ends_at].
    const within = state.roomBets.filter((b) =>
      b.status !== "open"
      && b.placed_at >= pool.starts_at
      && b.placed_at <= pool.ends_at
    );
    const score = new Map();
    for (const m of members) score.set(m.user_id, 0);
    for (const b of within) {
      if (!score.has(b.user_id)) continue;
      score.set(b.user_id, score.get(b.user_id) + ((Number(b.payout) || 0) - Number(b.stake)));
    }
    // Persist scores per member.
    for (const m of members) {
      await state.supabase.from("pool_members").update({ score: score.get(m.user_id) || 0 })
        .match({ pool_id: pool.id, user_id: m.user_id });
    }
    winnerId = [...score.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  } else {
    // For bracket / CTP: use existing pool_members.score, which the user
    // updates manually (or a future cron computes from pool_predictions).
    const sorted = members.slice().sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
    winnerId = sorted[0]?.user_id || null;
  }
  await state.supabase.from("pools").update({
    status: "settled",
    winner_id: winnerId,
  }).match({ id: pool.id });
  await loadActivePools();
  return true;
}

// ─────────── Pool prediction scoring ───────────
//
// Closest-to-Pin: 5 pts exact score, 3 pts correct outcome + total, 1 pt
// correct outcome, 0 wrong. Champion (bracket): 1 pt if your pick lifts
// the trophy, 0 otherwise. group_first is left as future work — needs
// computing group standings from match results, which the existing MC
// already does but not exposed in a settle-friendly shape.

function scoreCtp(predicted, actual) {
  const pa = Number(predicted?.scoreA), pb = Number(predicted?.scoreB);
  const aa = Number(actual?.scoreA),    ab = Number(actual?.scoreB);
  if (![pa, pb, aa, ab].every(Number.isFinite)) return 0;
  if (pa === aa && pb === ab) return 5;
  const po = pa > pb ? "H" : pa < pb ? "A" : "D";
  const ao = aa > ab ? "H" : aa < ab ? "A" : "D";
  if (po !== ao) return 0;
  if (pa + pb === aa + ab) return 3;
  return 1;
}

function scoreChampion(predicted, finalMatch) {
  if (!finalMatch || finalMatch.status !== "finished") return null;
  const winner = finalMatch.scoreA > finalMatch.scoreB ? finalMatch.teamA
               : finalMatch.scoreA < finalMatch.scoreB ? finalMatch.teamB
               : null;  // shouldn't happen — KO resolves via ET+pens
  return predicted?.team === winner ? 1 : 0;
}

// Walk every finished live match, evaluate matching pool_predictions
// whose settled_at is still null, persist the points, then recompute
// each affected pool's member-score from the sum of their predictions.
async function settleFinishedPoolPredictions() {
  if (!state.supabase || !state.supabaseUser || !state.activeRoom) return;
  if (!state.live?.matches || !state.liveScheduleMap) return;
  // Find all finished matches with scores.
  const finishedByInternal = new Map();  // internalMatchNo → live match obj
  for (const m of state.live.matches) {
    if (m.status !== "finished" || m.scoreA == null || m.scoreB == null) continue;
    // Reverse-lookup internal matchNo from the provider→internal map.
    for (const [providerNo, internalNo] of state.liveScheduleMap) {
      if (providerNo === m.matchNo) { finishedByInternal.set(internalNo, m); break; }
    }
  }
  if (!finishedByInternal.size) return;
  // Get pending predictions for matches in finishedByInternal (CTP) plus
  // any champion predictions if the final (matchNo 104) is finished.
  const finalMatch = finishedByInternal.get(104);
  const matchNos = Array.from(finishedByInternal.keys());
  const { data: pending } = await state.supabase
    .from("pool_predictions")
    .select()
    .is("settled_at", null)
    .or(matchNos.length ? `match_no.in.(${matchNos.join(",")})` : "match_no.is.null");
  if (!Array.isArray(pending) || !pending.length) return;
  const affectedPoolIds = new Set();
  for (const pred of pending) {
    let pts = null;
    if (pred.pred_type === "match_score" && pred.match_no != null) {
      const live = finishedByInternal.get(pred.match_no);
      if (live) pts = scoreCtp(pred.prediction, live);
    } else if (pred.pred_type === "champion" && finalMatch) {
      pts = scoreChampion(pred.prediction, finalMatch);
    }
    if (pts != null) {
      await state.supabase.from("pool_predictions").update({
        points: pts,
        settled_at: new Date().toISOString(),
      }).match({ id: pred.id });
      affectedPoolIds.add(pred.pool_id);
    }
  }
  // Recompute pool_members.score for each touched pool.
  for (const poolId of affectedPoolIds) {
    const { data: preds } = await state.supabase
      .from("pool_predictions").select("user_id, points").eq("pool_id", poolId);
    const byUser = new Map();
    for (const p of (preds || [])) byUser.set(p.user_id, (byUser.get(p.user_id) || 0) + (Number(p.points) || 0));
    for (const [uid, total] of byUser) {
      await state.supabase.from("pool_members").update({ score: total })
        .match({ pool_id: poolId, user_id: uid });
    }
  }
  await loadActivePools();
  renderPools();
}

// ─────────── Pool predictions: create / load ───────────

async function loadPoolPredictions(poolId) {
  if (!state.supabase || !state.supabaseUser) return [];
  const { data } = await state.supabase
    .from("pool_predictions").select().eq("pool_id", poolId);
  return Array.isArray(data) ? data : [];
}

async function setChampionPick(poolId, teamCode) {
  if (!state.supabase || !state.supabaseUser || !teamCode) return false;
  const { error } = await state.supabase.from("pool_predictions").upsert({
    pool_id: poolId,
    user_id: state.supabaseUser.id,
    pred_type: "champion",
    match_no: 104,
    prediction: { team: teamCode },
  }, { onConflict: "pool_id,user_id,pred_type,match_no" });
  return !error;
}

async function setMatchScorePick(poolId, matchNo, scoreA, scoreB) {
  if (!state.supabase || !state.supabaseUser) return false;
  const { error } = await state.supabase.from("pool_predictions").upsert({
    pool_id: poolId,
    user_id: state.supabaseUser.id,
    pred_type: "match_score",
    match_no: matchNo,
    prediction: { scoreA: Number(scoreA), scoreB: Number(scoreB) },
  }, { onConflict: "pool_id,user_id,pred_type,match_no" });
  return !error;
}

function renderPools() {
  const dict = t();
  const p = dict.pools || {};
  const card = $("#pools-card");
  if (!card) return;
  // Pools card is gated on Supabase being configured + user being logged
  // in + having an active room. Otherwise hide entirely.
  if (!state.supabase || !state.supabaseUser || !state.activeRoom) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  // Hydrate payment-handles inputs with stored values.
  const ph = state.paymentHandles || {};
  if ($("#ph-venmo")   && !$("#ph-venmo").dataset.hydrated)   { $("#ph-venmo").value   = ph.venmo   || ""; $("#ph-venmo").dataset.hydrated   = "1"; }
  if ($("#ph-paypal")  && !$("#ph-paypal").dataset.hydrated)  { $("#ph-paypal").value  = ph.paypal  || ""; $("#ph-paypal").dataset.hydrated  = "1"; }
  if ($("#ph-revolut") && !$("#ph-revolut").dataset.hydrated) { $("#ph-revolut").value = ph.revolut || ""; $("#ph-revolut").dataset.hydrated = "1"; }
  if ($("#ph-sepa")    && !$("#ph-sepa").dataset.hydrated)    { $("#ph-sepa").value    = ph.sepa_iban || ""; $("#ph-sepa").dataset.hydrated    = "1"; }

  // Render the pool list.
  const listEl = $("#pools-list");
  if (!listEl) return;
  if (!state.pools?.length) {
    listEl.innerHTML = `<h4>${escape(p.activePools || "Active pools")}</h4>
      <p class="muted small">${escape(p.noPools || "No active pools.")}</p>`;
    return;
  }
  const nickFor = (uid) => (state.roomMembers.find((m) => m.user_id === uid)?.nickname) || "—";
  listEl.innerHTML = `<h4>${escape(p.activePools || "Active pools")}</h4>` +
    state.pools.map((pool) => {
      const members = state.poolMembers[pool.id] || [];
      const me = members.find((m) => m.user_id === state.supabaseUser.id);
      const inPool = !!me;
      const statusLbl = pool.status === "open" ? (p.poolStatusOpen || "Open")
                       : pool.status === "locked" ? (p.poolStatusLocked || "Locked")
                       : (p.poolStatusSettled || "Settled");
      const winnerLine = pool.winner_id
        ? `<p>${escape(p.winner || "Winner")}: <b>${escape(nickFor(pool.winner_id))}</b> · €${Number(pool.pot_total).toFixed(2)}</p>` : "";
      const typeLbl = pool.pool_type === "pnl" ? (p.typePnl || "P&L race")
                     : pool.pool_type === "bracket" ? (p.typeBracket || "Bracket")
                     : (p.typeCtp || "CTP");
      // Ranking: sort by score desc → rank + crown for the settled winner.
      const ranked = [...members].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
      // What each member tipped (visible to everyone — the social hook).
      const tipFor = (uid) => {
        const preds = (state.poolPredictions?.[pool.id] || []).filter((x) => x.user_id === uid);
        if (pool.pool_type === "bracket") {
          const c = preds.find((x) => x.pred_type === "champion");
          return c?.prediction?.team ? escape(teamName(c.prediction.team) || c.prediction.team) : "—";
        }
        if (pool.pool_type === "ctp") {
          const n = preds.filter((x) => x.pred_type === "match_score").length;
          return n ? `${n} ${escape(p.tipsCount || "Tipps")}` : "—";
        }
        return "—"; // pnl: no picks — the score column IS their P&L
      };
      const membersTable = `<table class="wallet-table">
        <thead><tr>
          <th>#</th>
          <th>${escape(p.colNick || "Nick")}</th>
          <th>${escape(p.colTip || "Tipp")}</th>
          <th>${escape(p.colStatus || "Status")}</th>
          <th>${escape(p.colScore || "Score")}</th>
          <th>${escape(p.payTo || "Pay to")}</th>
        </tr></thead><tbody>
        ${ranked.map((m, i) => {
          const nick = escape(nickFor(m.user_id));
          const rank = pool.winner_id === m.user_id ? "👑" : `${i + 1}.`;
          const statusCls = m.buy_in_status === "paid" ? "edge-pos" : "muted";
          const statusTxt = m.buy_in_status === "paid"
            ? `${escape(p.buyInPaid || "Paid")}${m.paid_via ? " · " + escape(m.paid_via) : ""}`
            : (p.buyInPending || "Pending");
          // Payment links for OTHER members (we pay them, not ourselves).
          const handles = state.roomHandles?.[m.user_id] || {};
          const showPayLinks = m.user_id !== state.supabaseUser.id
                              && me && me.buy_in_status !== "paid"
                              && pool.status === "open";
          const payLinks = showPayLinks ? [
            handles.venmo && `<a class="pay-link" href="${PAYMENT_LINKS.venmo(pool.buy_in, handles.venmo)}" target="_blank" rel="noopener">Venmo</a>`,
            handles.paypal && `<a class="pay-link" href="${PAYMENT_LINKS.paypal(pool.buy_in, handles.paypal)}" target="_blank" rel="noopener">PayPal</a>`,
            handles.revolut && `<a class="pay-link" href="${PAYMENT_LINKS.revolut(pool.buy_in, handles.revolut)}" target="_blank" rel="noopener">Revolut</a>`,
            handles.sepa_iban && `<button class="pay-link" data-copy-iban="${escape(handles.sepa_iban)}" type="button">IBAN</button>`,
          ].filter(Boolean).join(" · ") : "—";
          const meRow = m.user_id === state.supabaseUser.id ? ' class="pool-me-row"' : "";
          return `<tr${meRow}>
            <td>${rank}</td>
            <td><b>${nick}</b></td>
            <td>${tipFor(m.user_id)}</td>
            <td class="${statusCls}">${statusTxt}</td>
            <td>${Number(m.score || 0).toFixed(2)}</td>
            <td class="small">${payLinks}</td>
          </tr>`;
        }).join("")}
      </tbody></table>`;
      const meActions = inPool && me.buy_in_status !== "paid" && pool.status === "open"
        ? `<button class="copy-btn" data-pool-mark-paid="${pool.id}" type="button">${escape(p.markPaid || "Mark as paid")}</button>`
        : "";
      const settleBtn = (pool.created_by === state.supabaseUser.id && pool.status !== "settled")
        ? `<button class="copy-btn" data-pool-settle="${pool.id}" type="button">${escape(p.settleNow || "Settle now")}</button>`
        : "";
      const deleteBtn = (pool.created_by === state.supabaseUser.id)
        ? `<button class="copy-btn" data-pool-delete="${pool.id}" type="button">${escape(p.delete || "Delete")}</button>`
        : "";
      const joinBtn = !inPool
        ? `<button class="primary" data-pool-join="${pool.id}" type="button">Join</button>`
        : "";
      // Picks UI — only when this user is a member of the pool.
      let picksBlock = "";
      if (inPool && pool.status === "open") {
        const myPreds = (state.poolPredictions?.[pool.id] || []).filter((x) => x.user_id === state.supabaseUser.id);
        if (pool.pool_type === "bracket") {
          const myChamp = myPreds.find((x) => x.pred_type === "champion");
          const teamOpts = state.schedule
            ? Array.from(new Set(state.schedule.filter((m) => m.stage === "group" && m.teamA && m.teamB).flatMap((m) => [m.teamA, m.teamB]))).sort()
            : [];
          picksBlock = `<div class="pool-picks">
            <h5>${escape(p.pickChampionHeader || "Your champion pick")}</h5>
            <div class="friends-row">
              <select data-pool-champion="${pool.id}">
                <option value="">— ${escape(p.pickChampionPrompt || "pick a team")} —</option>
                ${teamOpts.map((c) => `<option value="${c}" ${myChamp?.prediction?.team === c ? "selected" : ""}>${escape(teamName(c) || c)}</option>`).join("")}
              </select>
              <span class="muted small">${escape(p.pickChampionHint || "Worth 1 point if your team lifts the trophy.")}</span>
            </div>
          </div>`;
        } else if (pool.pool_type === "ctp") {
          // Show matches inside [starts_at, ends_at] (limit to next 6 unseeded).
          const start = new Date(pool.starts_at).getTime();
          const end = new Date(pool.ends_at).getTime();
          const elig = (state.schedule || [])
            .filter((m) => m.kickoffUTC && m.teamA && m.teamB)
            .filter((m) => { const k = new Date(m.kickoffUTC).getTime(); return k >= start && k <= end; })
            .slice(0, 6);
          const rows = elig.map((m) => {
            const mine = myPreds.find((x) => x.pred_type === "match_score" && x.match_no === m.matchNo);
            const date = (m.kickoffUTC || "").slice(5, 10);
            return `<div class="ctp-row" data-ctp-match="${m.matchNo}" data-ctp-pool="${pool.id}">
              <span class="muted small">${date}</span>
              <span>${escape(teamName(m.teamA))} – ${escape(teamName(m.teamB))}</span>
              <input class="ctp-score-a" type="number" min="0" max="9" value="${mine?.prediction?.scoreA ?? ""}" placeholder="0" />
              <span>:</span>
              <input class="ctp-score-b" type="number" min="0" max="9" value="${mine?.prediction?.scoreB ?? ""}" placeholder="0" />
              <button class="copy-btn ctp-save" type="button">${escape(p.pickScoreSave || "Save")}</button>
              ${mine?.settled_at ? `<span class="${mine.points > 0 ? "edge-pos" : "muted"}">${escape(p.pickScorePoints || "pts")}: ${mine.points}</span>` : ""}
            </div>`;
          }).join("");
          picksBlock = `<div class="pool-picks">
            <h5>${escape(p.pickScoreHeader || "Your score predictions")}</h5>
            <p class="muted small">${escape(p.pickScoreHint || "5 pts exact · 3 pts outcome + total · 1 pt outcome.")}</p>
            ${rows || `<p class="muted small">${escape(p.pickScoreNone || "No matches in this pool window.")}</p>`}
          </div>`;
        }
      }
      return `<div class="pool-card">
        <header>
          <h4>${escape(pool.name)} <span class="muted small">· ${escape(typeLbl)}</span></h4>
          <span class="pool-status pool-status-${pool.status}">${escape(statusLbl)}</span>
        </header>
        <p class="muted small">${escape(p.buyIn || "Buy-in")}: <b>€${Number(pool.buy_in).toFixed(2)}</b> · ${escape(p.potTotal || "Pot")}: <b>€${Number(pool.pot_total).toFixed(2)}</b> · ${escape(p.endsAt || "Ends")}: ${new Date(pool.ends_at).toISOString().slice(0, 10)}</p>
        ${winnerLine}
        ${membersTable}
        ${picksBlock}
        <div class="pool-actions">${joinBtn} ${meActions} ${settleBtn} ${deleteBtn}</div>
      </div>`;
    }).join("");
}

function wirePools() {
  const card = $("#pools-card");
  if (!card || card.dataset.wired) return;
  card.dataset.wired = "1";

  $("#ph-save")?.addEventListener("click", async () => {
    const handles = {
      venmo: $("#ph-venmo")?.value?.trim() || "",
      paypal: $("#ph-paypal")?.value?.trim() || "",
      revolut: $("#ph-revolut")?.value?.trim() || "",
      sepa_iban: $("#ph-sepa")?.value?.trim() || "",
    };
    const ok = await savePaymentHandles(handles);
    const status = $("#ph-status");
    if (status) status.textContent = ok ? (t().pools?.handlesSaved || "Saved.") : "Error.";
    renderPools();
  });

  $("#pool-create-btn")?.addEventListener("click", async () => {
    const name = $("#pool-name")?.value?.trim();
    const type = $("#pool-type")?.value;
    const buyIn = Number($("#pool-buyin")?.value);
    const endsAt = $("#pool-ends")?.value;
    if (!name || !type || !buyIn || !endsAt) return;
    const pool = await createPool({ name, type, buyIn, endsAt });
    if (pool) {
      $("#pool-name").value = "";
      await loadActivePools();
      renderPools();
    }
  });

  card.addEventListener("click", async (e) => {
    const joinBtn = e.target.closest("[data-pool-join]");
    if (joinBtn) { await joinPool(joinBtn.dataset.poolJoin); await loadActivePools(); renderPools(); return; }
    const markBtn = e.target.closest("[data-pool-mark-paid]");
    if (markBtn) { await markBuyInPaid(markBtn.dataset.poolMarkPaid); renderPools(); return; }
    const settleBtn = e.target.closest("[data-pool-settle]");
    if (settleBtn) {
      const pool = state.pools.find((p) => p.id === settleBtn.dataset.poolSettle);
      if (pool && confirm("Settle this pool now?")) { await settlePool(pool); renderPools(); }
      return;
    }
    const delBtn = e.target.closest("[data-pool-delete]");
    if (delBtn) {
      if (confirm(t().pools?.confirmDelete || "Delete?")) { await deletePool(delBtn.dataset.poolDelete); renderPools(); }
      return;
    }
    const iban = e.target.closest("[data-copy-iban]");
    if (iban) { try { await navigator.clipboard.writeText(iban.dataset.copyIban); } catch {} return; }
    // CTP save button — reads sibling inputs in the same .ctp-row
    const ctpSave = e.target.closest(".ctp-save");
    if (ctpSave) {
      const row = ctpSave.closest(".ctp-row");
      if (!row) return;
      const poolId = row.dataset.ctpPool;
      const matchNo = Number(row.dataset.ctpMatch);
      const a = Number(row.querySelector(".ctp-score-a")?.value);
      const b = Number(row.querySelector(".ctp-score-b")?.value);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return;
      await setMatchScorePick(poolId, matchNo, a, b);
      await loadActivePools(); renderPools();
      return;
    }
  });
  // Champion-dropdown change → save immediately (no separate button)
  card.addEventListener("change", async (e) => {
    const champ = e.target.closest("[data-pool-champion]");
    if (champ) {
      const poolId = champ.dataset.poolChampion;
      const team = champ.value;
      if (team) { await setChampionPick(poolId, team); await loadActivePools(); renderPools(); }
    }
  });
}

/* ─────────── Onboarding tour ─────────── */
//
// 7-step welcome tour for friends arriving for the first time. Auto-switches
// tabs as needed when the highlighted target lives in a different tab.
// Persisted via wc26_tour_done so it shows exactly once; the Methodology tab
// has a "Restart tour" button so it can be re-run any time.

const TOUR_STEPS = [
  { tab: "overview",    target: null,                       i18n: "step1" },
  { tab: "overview",    target: ".tab-strip",               i18n: "step2" },
  { tab: "overview",    target: "#top3",                    i18n: "step3" },
  { tab: "schedule",    target: "#schedule-list",           i18n: "step4" },
  { tab: "bets",        target: "#wallet-card",             i18n: "step5" },
  { tab: "bets",        target: "#bet-slip",                i18n: "step6" },
  { tab: "methodology", target: "#tour-restart",            i18n: "step7" },
];

let tourIndex = 0;

function startTour() {
  tourIndex = 0;
  const ov = $("#tour-overlay");
  if (ov) ov.hidden = false;
  renderTourStep();
}

function endTour() {
  const ov = $("#tour-overlay");
  if (ov) ov.hidden = true;
  try { localStorage.setItem("wc26_tour_done", "1"); } catch {}
}

function renderTourStep() {
  const dict = t().tour || {};
  const step = TOUR_STEPS[tourIndex];
  if (!step) { endTour(); return; }
  // Auto-switch tab if needed.
  if (step.tab && step.tab !== state.activeTab) switchTab(step.tab);
  $("#tour-step-counter").textContent = `${tourIndex + 1} / ${TOUR_STEPS.length}`;
  const stepI18n = dict[step.i18n] || {};
  $("#tour-title").textContent = stepI18n.title || step.i18n;
  $("#tour-body").textContent  = stepI18n.body  || "";
  $("#tour-prev").style.visibility = tourIndex === 0 ? "hidden" : "visible";
  $("#tour-next").textContent = tourIndex === TOUR_STEPS.length - 1 ? (dict.done || "Fertig") : (dict.next || "Weiter");
  // Position spotlight + bubble. Defer one frame so any auto-switched tab
  // has rendered its sections.
  requestAnimationFrame(() => {
    const spot = $("#tour-spotlight");
    const bubble = $("#tour-bubble");
    if (!spot || !bubble) return;
    const target = step.target ? document.querySelector(step.target) : null;
    if (target) {
      const r = target.getBoundingClientRect();
      // Pad the spotlight slightly so the highlight reads.
      const pad = 8;
      spot.style.cssText =
        `display:block;` +
        `top:${r.top - pad + window.scrollY}px;` +
        `left:${r.left - pad + window.scrollX}px;` +
        `width:${r.width + pad * 2}px;` +
        `height:${r.height + pad * 2}px;`;
      // Bubble preferentially below the target, fallback above.
      const bw = 360, bh = 180;
      const fitsBelow = r.bottom + bh + 24 < window.innerHeight;
      const top = fitsBelow ? r.bottom + 12 + window.scrollY : Math.max(12 + window.scrollY, r.top - bh - 12 + window.scrollY);
      const left = Math.max(12, Math.min(window.innerWidth - bw - 12, r.left + r.width / 2 - bw / 2)) + window.scrollX;
      bubble.style.cssText = `display:block; top:${top}px; left:${left}px; width:${bw}px;`;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      // Centered intro / no target.
      spot.style.display = "none";
      const bw = 420;
      const top = Math.max(80, window.innerHeight / 2 - 100) + window.scrollY;
      const left = Math.max(12, window.innerWidth / 2 - bw / 2) + window.scrollX;
      bubble.style.cssText = `display:block; top:${top}px; left:${left}px; width:${bw}px;`;
    }
  });
}

function wireTour() {
  const ov = $("#tour-overlay");
  if (!ov || ov.dataset.wired) return;
  ov.dataset.wired = "1";
  $("#tour-prev")?.addEventListener("click", () => { if (tourIndex > 0) { tourIndex--; renderTourStep(); } });
  $("#tour-next")?.addEventListener("click", () => {
    if (tourIndex >= TOUR_STEPS.length - 1) endTour();
    else { tourIndex++; renderTourStep(); }
  });
  $("#tour-skip")?.addEventListener("click", endTour);
  $("#tour-restart")?.addEventListener("click", startTour);
  // Re-position on resize so the spotlight tracks responsive shifts.
  window.addEventListener("resize", () => { if (!ov.hidden) renderTourStep(); });
}

function maybeStartTour() {
  let done = false;
  try { done = localStorage.getItem("wc26_tour_done") === "1"; } catch {}
  if (done) return;
  // Wait a beat so the dashboard is fully painted before the overlay shows.
  setTimeout(startTour, 600);
}

/* ─────────── iOS install banner ─────────── */
//
// iOS Safari doesn't show a Chrome-style install button — users have to
// know about Share → "Add to Home Screen". Friends won't discover that
// on their own. This banner nudges them once, dismissable, never shown
// again. Only triggers for iOS Safari NOT already in standalone mode.

function isIosSafari() {
  const ua = navigator.userAgent || "";
  // Require an actual touch device too — guards against odd desktop UAs that
  // happen to contain "iPad"/"Safari", so the install banner can never show on desktop.
  const touch = (navigator.maxTouchPoints || 0) > 0;
  const isIos = /iPhone|iPad|iPod/.test(ua) && !window.MSStream;
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return isIos && isSafari && touch;
}

function isStandalone() {
  return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches)
    || window.navigator.standalone === true;
}

function maybeShowIosInstallBanner() {
  const banner = $("#ios-install-banner");
  if (!banner) return;
  try { if (localStorage.getItem("wc26_install_banner_dismissed") === "1") return; } catch {}
  if (!isIosSafari() || isStandalone()) return;
  banner.hidden = false;
  $("#ios-install-dismiss")?.addEventListener("click", () => {
    banner.hidden = true;
    try { localStorage.setItem("wc26_install_banner_dismissed", "1"); } catch {}
  });
}

/* ─────────── Explainer panels (shared by all aggregate surfaces) ─────────── */

// Renders a 4-block decomposition of a team's title forecast: model
// components, raw inputs, surprise/CI, trend vs last visit.
function renderTeamExplainPanel(code) {
  const dict = t();
  const exp = dict.explain || {};
  const titleP = (state.blendedTitle || state.mc.titleProbability)[code] || 0;
  const ensembleP = state.mc.titleProbability[code] || 0;
  const marketP = state.marketProbs?.[code] ?? MARKET_ODDS_2026[code] ?? 0;
  const elo = ELO_2026[code] || 0;
  const squad = SQUAD_INDEX_2026?.[code];
  const squadDelta = state.squadDelta?.[code] || 0;
  const host = hostCodes.includes(code);
  const iter = state.mc.iterations || 0;
  const se = iter > 0 ? Math.sqrt(titleP * (1 - titleP) / iter) : 0;
  const ci = se ? `[${pct(Math.max(0, titleP - 1.96 * se), 1)}, ${pct(Math.min(1, titleP + 1.96 * se), 1)}]` : "—";
  const bits = titleP > 0 ? -Math.log2(titleP) : Infinity;
  const trend = state.diff?.title?.[code];
  const w = (state.mc.weights || DEFAULT_WEIGHTS);
  return `
    <div class="detail-grid">
      <div class="detail-block">
        <h5>${escape(exp.componentBreakdown || "Component decomposition")}</h5>
        <ul class="detail-list">
          <li><span>${escape(exp.squadAdj || "Ensemble (current)")} <span class="muted small">(${(w.elo * 100).toFixed(0)}+${(w.dc * 100).toFixed(0)}+${(w.squad * 100).toFixed(0)} %)</span></span><b>${pct(ensembleP, 2)}</b></li>
          <li><span>${escape(exp.marketShare || "Market")} <span class="muted small">(${(w.market * 100).toFixed(0)} %)</span></span><b>${pct(marketP, 2)}</b></li>
          <li><span>${escape(exp.blended || "Blended")}</span><b>${pct(titleP, 2)}</b></li>
        </ul>
      </div>
      <div class="detail-block">
        <h5>${escape(exp.componentBreakdown ? "Inputs" : "Inputs")}</h5>
        <ul class="detail-list">
          <li><span>${escape(exp.eloRating || "Elo rating")}</span><b>${Math.round(elo)}</b></li>
          ${squad != null ? `<li><span>${escape(exp.squadIndex || "Squad index")}</span><b>${(squad * 100).toFixed(1)} %</b></li>` : ""}
          <li><span>${escape(exp.squadDelta || "Squad delta")}</span><b>${squadDelta >= 0 ? "+" : ""}${squadDelta.toFixed(0)} Elo</b></li>
          ${host ? `<li><span>${escape(exp.hostBonus || "Host bonus")}</span><b>+80 Elo</b></li>` : ""}
        </ul>
      </div>
      <div class="detail-block">
        <h5>Uncertainty</h5>
        <ul class="detail-list">
          <li><span>${escape(exp.surpriseBits || "Surprise (bits)")}</span><b>${Number.isFinite(bits) ? bits.toFixed(2) : "∞"}</b></li>
          <li><span>${escape(exp.ci95 || "95% CI")}</span><b>${ci}</b></li>
          <li><span>MC iterations</span><b>${iter.toLocaleString()}</b></li>
        </ul>
      </div>
      <div class="detail-block">
        <h5>${escape(exp.trendSnapshot || "Change since last visit")}</h5>
        <p class="muted small" style="margin:0">${trend == null ? (dict.freshness?.liveIdle || "—") : (trend >= 0 ? "+" : "−") + (Math.abs(trend) * 100).toFixed(2) + " pp"}</p>
      </div>
    </div>`;
}

function renderStageExplainPanel(code) {
  const dict = t();
  const exp = dict.explain || {};
  const stages = [
    { key: "r32Probability",     label: "R32" },
    { key: "r16Probability",     label: "R16" },
    { key: "quartersProbability",label: "QF" },
    { key: "semisProbability",   label: "SF" },
    { key: "finalsProbability",  label: "F" },
    { key: "titleProbability",   label: "Title" },
  ];
  const probs = stages.map((s) => state.mc[s.key]?.[code] || 0);
  const chainRows = stages.map((s, i) => {
    const p = probs[i];
    const cond = i === 0 ? p : (probs[i - 1] > 0 ? probs[i] / probs[i - 1] : 0);
    const tr = state.diff?.stages?.[s.key]?.[code];
    const trHtml = tr == null ? "" : `<span class="trend ${tr >= 0 ? "trend-up" : "trend-down"}">${tr >= 0 ? "↑" : "↓"} ${(Math.abs(tr) * 100).toFixed(1)} pp</span>`;
    return `<li><span>${s.label}</span><b>${pct(p, 2)} ${i > 0 ? `<span class="muted small">×${(cond * 100).toFixed(0)} %</span>` : ""}${trHtml}</b></li>`;
  }).join("");
  const elo = ELO_2026[code] || 0;
  const squadDelta = state.squadDelta?.[code] || 0;
  const gpd = state.mc.groupPositionDistribution?.[code];
  let groupRows = "";
  if (gpd && gpd.total) {
    const positions = ["p1","p2","p3","p4"];
    groupRows = positions.map((k, i) => `<li><span>P${i + 1}</span><b>${((gpd[k] || 0) / gpd.total * 100).toFixed(1)} %</b></li>`).join("");
  }
  return `
    <div class="detail-grid">
      <div class="detail-block">
        <h5>${escape(exp.stageChain || "Stage-by-stage conditional drop")}</h5>
        <ul class="detail-list">${chainRows}</ul>
      </div>
      <div class="detail-block">
        <h5>${escape(exp.positionDist || "Final-position distribution")}</h5>
        ${groupRows ? `<ul class="detail-list">${groupRows}</ul>` : `<p class="muted small">${escape(dict.freshness?.liveIdle || "—")}</p>`}
      </div>
      <div class="detail-block">
        <h5>Inputs</h5>
        <ul class="detail-list">
          <li><span>${escape(exp.eloRating || "Elo rating")}</span><b>${Math.round(elo)}</b></li>
          <li><span>${escape(exp.squadDelta || "Squad delta")}</span><b>${squadDelta >= 0 ? "+" : ""}${squadDelta.toFixed(0)} Elo</b></li>
          ${hostCodes.includes(code) ? `<li><span>${escape(exp.hostBonus || "Host bonus")}</span><b>+80 Elo</b></li>` : ""}
        </ul>
      </div>
    </div>`;
}

function renderMatrixCellExplain(code, stageKey) {
  const dict = t();
  const exp = dict.explain || {};
  const modelP = state.mc[stageKey]?.[code] ?? 0;
  // Match the team-matrix mapping for market keys.
  const stageToMarket = {
    titleProbability: "titleAggregated",
    finalsProbability: "finalsAggregated",
    semisProbability: "semisAggregated",
    quartersProbability: "quartersAggregated",
    r16Probability: "r16Aggregated",
    groupAdvanceProbability: "topTwoAggregated",
    groupPositionDistribution: "groupWinnerAggregated",
  };
  const snap = state.marketSnapshot;
  const marketKey = stageToMarket[stageKey];
  const marketP = (snap?.[marketKey] || snap?.aggregated || {})[code];
  const sources = Array.isArray(snap?.sources) ? snap.sources : [];
  const perBook = sources.map((s) => {
    const dec = s.odds?.[code];
    if (dec == null) return null;
    return `<li><span>${escape(s.book || s.name || "?")}</span><b>${typeof dec === "number" ? dec.toFixed(2) : dec}</b></li>`;
  }).filter(Boolean).join("");
  const diff = marketP == null ? null : (modelP - marketP);
  return `
    <div class="detail-grid">
      <div class="detail-block">
        <h5>${escape(exp.componentBreakdown || "Component decomposition")}</h5>
        <ul class="detail-list">
          <li><span>Model</span><b>${pct(modelP, 2)}</b></li>
          <li><span>${escape(exp.marketShare || "Market")}</span><b>${marketP == null ? "n/v" : pct(marketP, 2)}</b></li>
          ${diff == null ? "" : `<li><span>Diff</span><b>${diff >= 0 ? "+" : "−"}${(Math.abs(diff) * 100).toFixed(1)} pp</b></li>`}
        </ul>
      </div>
      <div class="detail-block">
        <h5>${escape(exp.perBookmaker || "Per-bookmaker quotes")}</h5>
        ${perBook ? `<ul class="detail-list">${perBook}</ul>` : `<p class="muted small">${escape(exp.sourcesNote || "Per-source breakdown not available for this stage")}</p>`}
      </div>
      <div class="detail-block">
        <h5>${escape(exp.aggregation || "Aggregation")}</h5>
        <ul class="detail-list">
          <li><span>${escape(exp.logitMean || "Logit-mean across books")}</span><b>${escape(snap?.method ? "✓" : "—")}</b></li>
          <li><span>${escape(exp.gammaTransform || "γ-transform")}</span><b>${(state.marketGamma || 1).toFixed(2)}</b></li>
        </ul>
      </div>
    </div>`;
}

function renderGroupTeamExplain(code) {
  const dict = t();
  const exp = dict.explain || {};
  // Find this team's group + opponents.
  let opponents = [];
  for (const [, codes] of Object.entries(GROUPS_2026)) {
    if (codes.includes(code)) { opponents = codes.filter((c) => c !== code); break; }
  }
  // Use matchProbs with current ensemble context.
  const ctx = {
    weights: state.mc?.weights || DEFAULT_WEIGHTS,
    squadDelta: state.options.useSquad ? state.squadDelta : null,
    dcParams: state.options.useDC ? state.dcParams : null,
    eloMap: ELO_2026,
    hostCodes,
    options: state.options,
  };
  let expPts = 0;
  const pairwiseRows = opponents.map((opp) => {
    let probs = { home: 0, draw: 0, away: 0 };
    try {
      const res = matchProbs({ code }, { code: opp }, ctx);
      if (res?.ensemble) probs = res.ensemble;
    } catch { /* leave zero */ }
    const ePts = 3 * probs.home + 1 * probs.draw;
    expPts += ePts;
    return `<tr>
      <td>${escape(teamName(opp))}</td>
      <td class="num">${pct(probs.home, 0)}</td>
      <td class="num">${pct(probs.draw, 0)}</td>
      <td class="num">${pct(probs.away, 0)}</td>
      <td class="num">${ePts.toFixed(2)}</td>
    </tr>`;
  }).join("");
  const gpd = state.mc.groupPositionDistribution?.[code];
  let posRows = "";
  if (gpd && gpd.total) {
    const positions = [["p1","P1"],["p2","P2"],["p3","P3"],["p4","P4"]];
    posRows = positions.map(([k, lab]) => `<li><span>${lab}</span><b>${((gpd[k] || 0) / gpd.total * 100).toFixed(1)} %</b></li>`).join("");
  }
  return `
    <div class="detail-grid">
      <div class="detail-block" style="grid-column:span 2">
        <h5>${escape(exp.pairwise || "Pairwise expected results")}</h5>
        <table class="stages-table">
          <thead><tr><th>Opp</th><th>W</th><th>D</th><th>L</th><th>E[Pts]</th></tr></thead>
          <tbody>${pairwiseRows}</tbody>
        </table>
      </div>
      <div class="detail-block">
        <h5>${escape(exp.expectedPoints || "Expected points")}</h5>
        <ul class="detail-list"><li><span>Total</span><b>${expPts.toFixed(2)}</b></li></ul>
      </div>
      <div class="detail-block">
        <h5>${escape(exp.positionDist || "Final-position distribution")}</h5>
        ${posRows ? `<ul class="detail-list">${posRows}</ul>` : `<p class="muted small">—</p>`}
      </div>
    </div>`;
}

function renderBacktestYearExplain(year) {
  const dict = t();
  const exp = dict.explain || {};
  // Per-match recompute, lazy + cached.
  if (!state.backtestPerMatch[year]) {
    const combined = buildCombinedTournaments();
    const tour = (combined || []).find((t) => t.year === year);
    const matches = tour?.matches || [];
    const eloMap = HISTORICAL_ELO[year] || ELO_2026;
    const tourHosts = Array.isArray(tour?.host) ? tour.host : [tour?.host].filter(Boolean);
    const ctx = {
      dcParams: state.dcParams,
      squadDelta: state.squadDelta,
      eloMap,
      hostCodes: tourHosts,
      options: { useHost: true, useSquad: true, useDC: true, useCovariates: false },
    };
    const out = [];
    for (const m of matches) {
      try {
        const res = matchProbs({ code: m.teamA }, { code: m.teamB }, ctx);
        const probs = res?.ensemble;
        if (!probs) continue;
        const outcome = m.scoreA > m.scoreB ? 0 : m.scoreA < m.scoreB ? 2 : 1;
        const triplet = [probs.home, probs.draw, probs.away];
        const cumPred = [triplet[0], triplet[0] + triplet[1]];
        const obs = [outcome === 0 ? 1 : 0, outcome <= 1 ? 1 : 0];
        const rps = 0.5 * ((cumPred[0] - obs[0]) ** 2 + (cumPred[1] - obs[1]) ** 2);
        out.push({ teamA: m.teamA, teamB: m.teamB, scoreA: m.scoreA, scoreB: m.scoreB, probs: triplet, rps });
      } catch { /* skip */ }
    }
    state.backtestPerMatch[year] = out;
  }
  const matches = state.backtestPerMatch[year];
  const best = matches.slice().sort((a, b) => a.rps - b.rps).slice(0, 3);
  const worst = matches.slice().sort((a, b) => b.rps - a.rps).slice(0, 3);
  const renderRow = (m) => `<tr>
    <td>${escape(teamName(m.teamA))} ${m.scoreA}–${m.scoreB} ${escape(teamName(m.teamB))}</td>
    <td class="num">${pct(m.probs[0], 0)}/${pct(m.probs[1], 0)}/${pct(m.probs[2], 0)}</td>
    <td class="num">${m.rps.toFixed(3)}</td>
  </tr>`;
  return `
    <div class="detail-grid">
      <div class="detail-block">
        <h5>${escape(exp.matchByMatch || "Per-match predictions")}</h5>
        <p class="muted small">${matches.length} matches analysed</p>
      </div>
      <div class="detail-block">
        <h5>${escape(exp.bestPredicted || "Best-predicted")}</h5>
        <table class="stages-table"><tbody>${best.map(renderRow).join("")}</tbody></table>
      </div>
      <div class="detail-block">
        <h5>${escape(exp.worstPredicted || "Worst-predicted")}</h5>
        <table class="stages-table"><tbody>${worst.map(renderRow).join("")}</tbody></table>
      </div>
    </div>`;
}

function renderCalibrationBinExplain(binIdx) {
  const dict = t();
  const exp = dict.explain || {};
  const cells = state.calibration || [];
  const bin = cells[binIdx];
  if (!bin) return `<p class="muted small">—</p>`;
  const total = cells.length || 8;
  const lo = binIdx / total;
  const hi = (binIdx + 1) / total;
  // Wilson 95% CI on observed
  const n = bin.n || 0;
  const p = n > 0 ? (bin.observed || 0) : 0;
  const z = 1.96;
  const denom = 1 + z * z / Math.max(1, n);
  const centre = (p + z * z / (2 * Math.max(1, n))) / denom;
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * Math.max(1, n))) / Math.max(1, n)) / denom;
  const wLo = Math.max(0, centre - margin);
  const wHi = Math.min(1, centre + margin);
  return `
    <div class="detail-grid">
      <div class="detail-block">
        <h5>${escape(exp.binRange || "Predicted-probability range")}</h5>
        <ul class="detail-list">
          <li><span>Range</span><b>[${(lo * 100).toFixed(1)}%, ${(hi * 100).toFixed(1)}%]</b></li>
          <li><span>n</span><b>${n}</b></li>
          <li><span>Mean predicted</span><b>${pct(bin.midPred || 0, 1)}</b></li>
          <li><span>Observed</span><b>${pct(bin.observed || 0, 1)}</b></li>
        </ul>
      </div>
      <div class="detail-block">
        <h5>${escape(exp.wilsonDeriv || "Wilson 95% interval")}</h5>
        <ul class="detail-list">
          <li><span>z</span><b>1.96</b></li>
          <li><span>Lower</span><b>${pct(wLo, 1)}</b></li>
          <li><span>Upper</span><b>${pct(wHi, 1)}</b></li>
        </ul>
        <p class="muted small">p̂ ± z·√(p̂(1−p̂)/n) (Wilson form)</p>
      </div>
    </div>`;
}

function renderHistoryPointExplain(date) {
  const dict = t();
  const exp = dict.explain || {};
  const points = state.titleHistory || [];
  const pt = points.find((p) => p.date === date);
  if (!pt) return `<p class="muted small">—</p>`;
  const titles = pt.titles || {};
  const rows = Object.entries(titles)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([code, p]) => `<li><span>${escape(teamName(code))}</span><b>${pct(p, 1)}</b></li>`)
    .join("");
  return `
    <div class="detail-grid">
      <div class="detail-block">
        <h5>${escape(exp.snapshotTitles || "All title probabilities at this date")}</h5>
        <p class="muted small">${date}</p>
        <ul class="detail-list">${rows}</ul>
      </div>
      <div class="detail-block">
        <h5>${escape(exp.sourcesAtDate || "Sources contributing")}</h5>
        <p class="muted small">${escape(exp.sourcesNote || "Per-source breakdown not preserved for historical dates")}</p>
      </div>
    </div>`;
}

// Player Top-N link → scroll mega-table to the player + auto-expand.
function jumpToPlayer(name) {
  state.expandedPlayer = name;
  renderPlayerMegaTable();
  requestAnimationFrame(() => {
    const sel = `tr.player-row[data-player="${CSS.escape(name)}"]`;
    const row = document.querySelector(sel);
    if (row) {
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      row.classList.add("row-flash");
      setTimeout(() => row.classList.remove("row-flash"), 1300);
    }
  });
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
    <div class="dist-row player-link" data-player="${escape(r.name)}">
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
  let players;
  try {
    const res = await runForecastJob("players", {
      schedule: state.schedule,
      dcParams: state.dcParams,
      squadDelta: state.squadDelta,
      options: { ...state.options },
      iterations: 8000,
    });
    players = res.players;
  } catch {
    // Fallback: run the per-player MC synchronously on the main thread.
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
    players = runEnsembleMonteCarlo(
      TEAMS_2026, GROUPS_2026, hostCodes, ELO_2026,
      playerOpts, 8000,
    ).players;
  }
  state.players = players;
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
        <tr class="player-link" data-player="${escape(row.name)}">
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
        <tr class="player-link" data-player="${escape(r.name)}">
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

// ─────────── Theme (dark default, light opt-in, persisted) ───────────
function applyTheme(theme) {
  const t = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem("wc26_theme", t); } catch {}
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t === "light" ? "#eef1f6" : "#05080d");
  document.querySelectorAll(".theme-toggle").forEach((b) => { b.textContent = t === "light" ? "☾" : "☀"; });
}
function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem("wc26_theme"); } catch {}
  applyTheme(saved === "light" ? "light" : "dark");   // default dark; light is opt-in
  document.querySelectorAll(".theme-toggle").forEach((b) => b.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    applyTheme(cur === "light" ? "dark" : "light");
  }));
}
function applyAccent(name) {
  const a = ["blue", "violet", "cyan", "pink"].includes(name) ? name : "bbb";
  if (a === "bbb") document.documentElement.removeAttribute("data-accent");
  else document.documentElement.setAttribute("data-accent", a);
  try { localStorage.setItem("wc26_accent", a); } catch {}
  document.querySelectorAll(".accent-dot").forEach((d) => d.setAttribute("aria-pressed", d.dataset.accent === a ? "true" : "false"));
}
function initAccent() {
  let saved = null;
  try { saved = localStorage.getItem("wc26_accent"); } catch {}
  applyAccent(saved || "bbb");
  document.querySelectorAll(".accent-dot").forEach((d) => d.addEventListener("click", () => applyAccent(d.dataset.accent)));
}

document.addEventListener("DOMContentLoaded", async () => {
  // Register the PWA service worker so the app is installable + works
  // offline. Fail-safe: any error (private mode, SW disabled) is swallowed
  // and the app runs normally as a plain page.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  }
  applyI18n();
  initTheme();
  initAccent();
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

  // Resolve the login gate IMMEDIATELY, in parallel with the heavy forecast
  // compute below — the login screen must never wait behind the Monte-Carlo.
  wireAuthGate();
  bootstrapMultiplayer();
  // Safety net: never let the gate hang on "Lädt…" (slow init / stalled profile).
  setTimeout(() => {
    const g = document.querySelector("#auth-gate");
    if (!g || g.hidden) return;
    const loadingEl = g.querySelector('[data-auth-view="loading"]');
    if (!loadingEl || loadingEl.hidden) return;
    state.supabaseInitDone = true;
    renderAuthGate();
    const stuck = loadingEl && !loadingEl.hidden;
    if (stuck && !g.hidden) { g.hidden = true; document.body.classList.remove("auth-locked"); }
  }, 8000);

  let _booted = false;
  const boot = async () => {
    if (_booted) return;
    _booted = true;
    await bootstrap();
    $("#loading").hidden = true;
    $("#dashboard").hidden = false;
    renderAll();
    wireRefreshButton();
    wireBetSlip();
    wireFriends();
    wirePools();
    wireTabs();
    wireTour();
    wireNotifications();
    switchTab(state.activeTab);
    maybeStartTour();
    maybeShowIosInstallBanner();
    startLivePollingIfActive();
    // Persist the current snapshot so the NEXT visit can diff against it.
    persistPrev(cloneCurrentSnapshot());
    // Auto-run the per-player MC so players/cards/markets show up
    // immediately without the user having to flip a toggle.
    const playersToggle = $("#players-toggle");
    if (playersToggle) {
      playersToggle.checked = true;
      await computePlayerMC();
    }
  };
  // Fast path: run just after first paint. Fallback: a plain timeout fires
  // even in a hidden / backgrounded tab (where requestAnimationFrame is
  // paused), so the dashboard still loads — PWA relaunch, background open, etc.
  requestAnimationFrame(() => setTimeout(boot, 30));
  setTimeout(boot, 800);
});
