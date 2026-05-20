// UI orchestrator for the data-driven 2026 forecast.
import {
  TEAMS_2026, GROUPS_2026, ELO_2026, ELO_2026_META,
  MARKET_ODDS_2026, MARKET_ODDS_2026_META,
  HISTORICAL_KNOCKOUTS, HISTORICAL_ELO, HISTORICAL_ELO_META,
  WINNERS_1930_2022, STATS, NAMES_DE, I18N, DATA_SOURCES,
} from "./data.js";
import { runMonteCarlo, runKnockoutBacktest } from "./predictor.js";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const ITERATIONS = 10000;
const BACKTEST_ITERATIONS = 2000;

const state = {
  locale: "en",
  mc: null,            // 2026 Monte-Carlo result
  backtest: null,      // backtest result
  showAll: false,
};

const t = () => I18N[state.locale];
const teamByCode = Object.fromEntries(TEAMS_2026.map((x) => [x.code, x]));
const hostCodes = TEAMS_2026.filter((x) => x.host).map((x) => x.code);

const teamName = (code) => {
  const t = teamByCode[code];
  if (!t) return code;
  return state.locale === "de" && NAMES_DE[t.name] ? NAMES_DE[t.name] : t.name;
};

function escape(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function pct(p, digits = 1) {
  return `${(p * 100).toFixed(digits)}%`;
}

function applyI18n() {
  const dict = t();
  $$("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (typeof dict[key] === "string") el.textContent = dict[key];
  });
  document.title = dict.title;
  $("#snapshot-line").textContent = dict.snapshot(ELO_2026_META.asOf);
  $("#footer-line").textContent = dict.footer;
}

/* ─────────── Render: Top 3 ─────────── */

function renderTop3() {
  const dict = t();
  const ranked = Object.entries(state.mc.titleProbability)
    .map(([code, p]) => ({ code, p }))
    .sort((a, b) => b.p - a.p);
  const top3 = ranked.slice(0, 3);
  $("#top3").innerHTML = top3.map((row, i) => `
    <div class="top-card top-rank-${i + 1}">
      <div class="top-rank">${i + 1}</div>
      <div class="top-team">${escape(teamName(row.code))}</div>
      <div class="top-meta">${escape(teamByCode[row.code]?.confederation || "")}</div>
      <div class="top-prob">${pct(row.p, 1)}</div>
      <div class="top-bar"><div class="top-bar-fill" style="width:${Math.min(100, row.p * 300)}%"></div></div>
      <div class="top-sub">
        <span>SF ${pct(state.mc.semisProbability[row.code] || 0, 0)}</span>
        <span>QF ${pct(state.mc.quartersProbability[row.code] || 0, 0)}</span>
      </div>
    </div>
  `).join("");
}

/* ─────────── Render: Full distribution ─────────── */

function renderDistribution() {
  const dict = t();
  const ranked = Object.entries(state.mc.titleProbability)
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
  const btn = $("#toggle-distribution");
  btn.textContent = state.showAll ? dict.hideAll : dict.showAll;
}

/* ─────────── Render: Model vs Market ─────────── */

function renderMarket() {
  const dict = t();
  const teams = TEAMS_2026.map((team) => ({
    code: team.code,
    model: state.mc.titleProbability[team.code] || 0,
    market: MARKET_ODDS_2026[team.code] || 0,
  }));
  // Top 15 by max(model, market)
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
  const r = pearsonCorrelation(top.map((x) => x.model), top.map((x) => x.market));
  $("#market-summary").innerHTML = dict.correlation(r.toFixed(2));
}

function pearsonCorrelation(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const xd = xs[i] - mx;
    const yd = ys[i] - my;
    num += xd * yd;
    dx += xd * xd;
    dy += yd * yd;
  }
  if (dx === 0 || dy === 0) return 0;
  return num / Math.sqrt(dx * dy);
}

/* ─────────── Render: Expected groups ─────────── */

function renderGroups() {
  const html = Object.entries(GROUPS_2026).map(([letter, codes]) => {
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
  $("#groups").innerHTML = html;
}

/* ─────────── Render: Backtest ─────────── */

function renderBacktest() {
  const dict = t();
  const rows = state.backtest.perTournament.map((r) => {
    if (r.skipped) return `
      <div class="bt-row skipped">
        <span class="bt-year">${r.year}</span>
        <span class="bt-skipped muted">skipped (${escape(r.skipped)})</span>
      </div>
    `;
    const hitClass = r.championRank === 1 ? "hit-1" : r.championRank <= 3 ? "hit-3" : r.championRank <= 5 ? "hit-5" : "miss";
    return `
      <div class="bt-row ${hitClass}">
        <span class="bt-year">${r.year}</span>
        <span class="bt-host muted">${escape(r.host.join("/"))}</span>
        <span class="bt-actual">→ ${escape(teamNameFromEnglish(r.actualChampion))}</span>
        <span class="bt-top3">${r.modelTop3.map((m) => `<span class="bt-pick">${escape(teamNameFromCode(m.code))} ${pct(m.prob, 0)}</span>`).join("")}</span>
        <span class="bt-rank">#${r.championRank ?? "?"}</span>
      </div>
    `;
  }).join("");
  $("#backtest").innerHTML = rows;
  $("#backtest-summary").innerHTML = dict.backtestSummary(
    state.backtest.total,
    state.backtest.top3Hits,
    state.backtest.avgLogLoss?.toFixed(2) ?? "—",
  );
}

function teamNameFromEnglish(name) {
  return state.locale === "de" && NAMES_DE[name] ? NAMES_DE[name] : name;
}

function teamNameFromCode(code) {
  // Backtest uses historical codes that may not match TEAMS_2026 lookup.
  // Try direct first, fall back to known historical aliases.
  if (teamByCode[code]) return teamName(code);
  const HISTORICAL_ALIASES = {
    PRK: "North Korea", SVK: "Slovakia", SVN: "Slovenia",
    DNK: "Denmark", DEN: "Denmark", SWE: "Sweden",
    UKR: "Ukraine", SRB: "Serbia", GRC: "Greece",
    BIH: "Bosnia and Herzegovina", HND: "Honduras",
    POL: "Poland", CHL: "Chile", CHI: "Chile",
    URY: "Uruguay", CMR: "Cameroon", RUS: "Russia",
    NGA: "Nigeria", CRC: "Costa Rica", BUL: "Bulgaria",
    ITA: "Italy", AUS: "Australia", PER: "Peru",
    WAL: "Wales", ISL: "Iceland",
  };
  const englishName = HISTORICAL_ALIASES[code] || code;
  if (state.locale === "de" && NAMES_DE[englishName]) return NAMES_DE[englishName];
  return englishName;
}

/* ─────────── Render: Context (historical stats) ─────────── */

function renderContext() {
  const dict = t();
  const top = STATS.ranking[0];
  $("#context").innerHTML = `
    <ul>
      <li>${dict.statsLeader(escape(teamNameFromEnglish(top.nation)), top.count)}</li>
      <li>${dict.statsHost(STATS.hostWins, STATS.totalTournaments)}</li>
      <li>${dict.statsContinental(STATS.europeWins, STATS.southAmericaWins)}</li>
    </ul>
  `;
}

/* ─────────── Render: Methodology + sources ─────────── */

function renderMethodology() {
  const dict = t();
  $("#methodology").innerHTML = escape(dict.methodologyBlurb);
  $("#limitations").innerHTML = escape(dict.limitationsBody);
  $("#sources").innerHTML = DATA_SOURCES.map((s) => `
    <li><a href="${escape(s.url)}" target="_blank" rel="noopener">${escape(s.label)}</a>
      <span class="muted">· ${escape(s.fetched)}</span></li>
  `).join("");
}

/* ─────────── Helpers ─────────── */

// Map historical English country names to their FIFA code.
const NAME_TO_CODE = (() => {
  const m = {};
  for (const team of TEAMS_2026) m[team.name] = team.code;
  // Add codes referenced in historical data but not in 2026 field.
  const HISTORICAL = {
    "Italy": "ITA", "Sweden": "SWE", "Denmark": "DEN", "Poland": "POL",
    "Russia": "RUS", "Ukraine": "UKR", "Serbia": "SRB", "Greece": "GRC",
    "Czech Republic": "CZE", "Slovakia": "SVK", "Slovenia": "SVN",
    "Chile": "CHL", "Peru": "PER", "Honduras": "HND", "Costa Rica": "CRC",
    "Wales": "WAL", "Iceland": "ISL", "Bosnia and Herzegovina": "BIH",
    "Cameroon": "CMR", "Nigeria": "NGA",
    "Uruguay": "URU", "Australia": "AUS", "Algeria": "ALG",
  };
  for (const [name, code] of Object.entries(HISTORICAL)) {
    if (!m[name]) m[name] = code;
  }
  return m;
})();

function nameToCode(name) {
  return NAME_TO_CODE[name] || name;
}

/* ─────────── Boot ─────────── */

async function compute() {
  // 2026 Monte-Carlo
  state.mc = runMonteCarlo(TEAMS_2026, GROUPS_2026, hostCodes, ELO_2026, ITERATIONS, 2026);
  // Backtest 2006-2022
  state.backtest = runKnockoutBacktest(HISTORICAL_KNOCKOUTS, HISTORICAL_ELO, nameToCode, BACKTEST_ITERATIONS);
}

function renderAll() {
  renderTop3();
  renderDistribution();
  renderMarket();
  renderGroups();
  renderBacktest();
  renderContext();
  renderMethodology();
  fireConfetti();
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
  const parts = Array.from({ length: 120 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 80, y: 180,
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

  // Defer compute to next frame so the loading card paints first.
  requestAnimationFrame(async () => {
    await new Promise((r) => setTimeout(r, 16));
    await compute();
    $("#loading").hidden = true;
    $("#dashboard").hidden = false;
    renderAll();
  });
});
