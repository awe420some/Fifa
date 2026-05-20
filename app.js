import { decode } from "./decoder.js";
import { I18N, NAMES_DE } from "./data.js";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const HISTORY_KEY = "oracle:history:v1";
const HISTORY_MAX = 20;

const state = {
  mode: "text",
  locale: "en",
  lastResult: null,
  koOverrides: {},
  history: loadHistory(),
};

const teamName = (name) => (state.locale === "de" && NAMES_DE[name]) || name;
const t = () => I18N[state.locale];

function escape(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

function setMode(mode) {
  state.mode = mode;
  state.koOverrides = {};
  $$(".mode-tab").forEach((el) => el.classList.toggle("active", el.dataset.mode === mode));
  $("#text-panel").hidden = mode !== "text";
  $("#seed-panel").hidden = mode !== "seed";
  $("#date-panel").hidden = mode !== "date";
}

function setLocale(locale) {
  state.locale = locale;
  document.documentElement.lang = locale;
  $$(".lang-btn").forEach((el) => el.classList.toggle("active", el.dataset.lang === locale));
  applyI18n();
  if (state.lastResult && !state.lastResult.empty) {
    run({ skipUrlUpdate: true });
  } else if (state.lastResult && state.lastResult.empty) {
    render(state.lastResult);
  }
  renderHistory();
}

function applyI18n() {
  const dict = t();
  $$("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (typeof dict[key] === "string") el.textContent = dict[key];
  });
  $$("[data-i18n-attr]").forEach((el) => {
    const spec = el.getAttribute("data-i18n-attr");
    const [attr, key] = spec.split(":");
    if (typeof dict[key] === "string") el.setAttribute(attr, dict[key]);
  });
  document.title = `${dict.title} — Decoder of Hidden Predictions`;
}

function renderHidden(hidden) {
  const dict = t();
  if (!hidden.direct.length && !hidden.acrostic.length) {
    return `<p class="muted">${escape(dict.hiddenNone)}</p>`;
  }
  const direct = hidden.direct.length
    ? `<div><strong>${escape(dict.hiddenDirect)}:</strong> ${hidden.direct.map((n) => `<span class="chip">${escape(teamName(n))}</span>`).join("")}</div>`
    : "";
  const acrostic = hidden.acrostic.length
    ? `<div><strong>${escape(dict.hiddenAcrostic)}:</strong> ${hidden.acrostic.map((n) => `<span class="chip alt">${escape(teamName(n))}</span>`).join("")}</div>`
    : "";
  return direct + acrostic;
}

function renderNumerology(n) {
  const dict = t();
  if (!n.team) return `<p class="muted">${escape(dict.numerologyNone)}</p>`;
  return `
    <p>${dict.numerologySum(n.sum, n.letters)}</p>
    <p>${escape(dict.numerologyLucky)}: <strong class="lucky">${n.luckyDigit}</strong></p>
    <p>${dict.numerologyPick(escape(teamName(n.team.name)), escape(n.team.confederation), n.team.tier)}</p>
  `;
}

function renderGroupStage(groupTables) {
  const dict = t();
  const cols = dict.standingsCols;
  const cards = Object.entries(groupTables).map(([letter, table]) => {
    const rows = table.map((row, i) => `
      <tr class="${i < 2 ? "advance" : i === 2 ? "third" : "out"}">
        <td>${i + 1}</td>
        <td>${escape(teamName(row.team.name))}</td>
        <td>${row.p}</td>
        <td>${row.gd > 0 ? "+" : ""}${row.gd}</td>
      </tr>
    `).join("");
    return `
      <div class="group-card">
        <h4>${escape(dict.groupHeader(letter))}</h4>
        <table>
          <thead><tr><th></th><th>${escape(cols.team)}</th><th>${escape(cols.pts)}</th><th>${escape(cols.gd)}</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }).join("");
  return `<div class="group-grid">${cards}</div>`;
}

function renderKnockout(knockout) {
  const dict = t();
  const cols = knockout.rounds.map((round) => {
    const matches = round.matches.map((m) => {
      const aWin = m.winner.code === m.a.code;
      const bWin = m.winner.code === m.b.code;
      const flipTag = m.flipped ? `<span class="ko-flip-tag" title="${escape(dict.whatIfBadge)}">${escape(dict.whatIfTag)}</span>` : "";
      return `
        <div class="ko-match${m.flipped ? " flipped" : ""}" data-match-key="${escape(m.key)}">
          ${flipTag}
          <button class="ko-team ${aWin ? "win" : ""}" data-match-key="${escape(m.key)}" data-team-code="${escape(m.a.code)}" type="button">
            <span class="ko-name">${escape(teamName(m.a.name))}</span>
            <span class="ko-score">${m.scoreA}</span>
          </button>
          <button class="ko-team ${bWin ? "win" : ""}" data-match-key="${escape(m.key)}" data-team-code="${escape(m.b.code)}" type="button">
            <span class="ko-name">${escape(teamName(m.b.name))}</span>
            <span class="ko-score">${m.scoreB}</span>
          </button>
        </div>
      `;
    }).join("");
    return `<div class="ko-col"><h4>${escape(dict[round.name])}</h4>${matches}</div>`;
  }).join("");
  return `
    <div class="ko-bracket">${cols}
      <div class="ko-col champion-col">
        <h4>${escape(dict.champion)}</h4>
        <div class="ko-match champion">
          <div class="ko-team win"><span class="ko-name">${escape(teamName(knockout.champion.name))}</span></div>
          <div class="muted">${escape(knockout.champion.confederation)}</div>
        </div>
      </div>
    </div>
  `;
}

function renderOmen(omen) {
  return `<p>${escape(omen.text)}</p>`;
}

function renderPrior(prior, champion) {
  const dict = t();
  const leader = dict.titlesLeader(escape(teamName(prior.leader.nation)), prior.leader.count);
  const champPart = prior.championTitles
    ? dict.championTitled(escape(teamName(champion.name)), prior.championTitles)
    : dict.championUntitled(escape(teamName(champion.name)));
  return `
    <ul>
      <li>${leader}</li>
      <li>${champPart}</li>
      <li>${dict.hostNote(prior.hostWins, prior.totalTournaments)}</li>
      <li>${dict.continental(prior.europeWins, prior.southAmericaWins)}</li>
    </ul>
  `;
}

function renderDateLens(info) {
  const dict = t();
  const weekday = dict.weekdays[info.weekdayIdx];
  const lucky = info.digitSum;
  let kickoffLine;
  if (info.daysToKickoff > 0) kickoffLine = dict.dateOmenFuture(info.daysToKickoff);
  else if (info.daysToKickoff === 0) kickoffLine = dict.dateAtKickoff;
  else kickoffLine = `${Math.abs(info.daysToKickoff)} ${dict.dateKickoffPast}`;
  return `
    <ul>
      <li><strong>${escape(dict.dateWeekday)}:</strong> ${escape(weekday)}</li>
      <li><strong>${escape(dict.dateLuckyDigit)}:</strong> <span class="lucky">${lucky}</span></li>
      <li>${escape(kickoffLine)}</li>
    </ul>
  `;
}

function renderVerdict(result) {
  const dict = t();
  const c = result.knockout.champion;
  return `
    <div class="verdict-card${result.flips > 0 ? " flipped" : ""}">
      <div class="verdict-label">${escape(dict.verdictLabel)}${result.flips > 0 ? ` · <span class="whatif-pill">${escape(dict.whatIfTag)}</span>` : ""}</div>
      <div class="verdict-champion">${escape(teamName(c.name))}</div>
      <div class="verdict-meta">${escape(c.confederation)} · tier ${c.tier}</div>
      <div class="verdict-bar"><div class="verdict-fill" style="width:0%"></div></div>
      <div class="verdict-confidence">${result.confidence}% ${escape(dict.confidence)}</div>
      <div class="verdict-actions">
        <button id="copy-btn" class="copy-btn" type="button">${escape(dict.copyReading)}</button>
        <button id="share-btn" class="copy-btn" type="button">${escape(dict.shareLink)}</button>
        ${result.flips > 0 ? `<button id="whatif-reset" class="copy-btn warn" type="button">${escape(dict.whatIfReset)}</button>` : ""}
      </div>
    </div>
  `;
}

function readingToText(result) {
  const dict = t();
  const c = result.knockout.champion;
  return [
    `🏆 ${dict.title}`,
    `${dict.verdictLabel}: ${teamName(c.name)} (${c.confederation})`,
    `${result.confidence}% ${dict.confidence}${result.flips > 0 ? ` (${dict.whatIfBadge})` : ""}`,
    `${dict.sectionNumerology}: ${result.numerology.team ? teamName(result.numerology.team.name) : "—"} · ${dict.numerologyLucky} ${result.numerology.luckyDigit}`,
    `${dict.sectionHidden}: ${result.hidden.direct.map(teamName).join(", ") || "—"}`,
    `${dict.sectionOmen}: ${result.omen.text}`,
    `Seed: ${result.seed.slice(0, 80)}${result.seed.length > 80 ? "…" : ""}`,
  ].join("\n");
}

function currentInputValue() {
  if (state.mode === "text") return $("#text-input").value;
  if (state.mode === "seed") return $("#seed-input").value;
  return $("#date-input").value;
}

function buildShareUrl() {
  const value = currentInputValue();
  if (!value.trim()) return location.href;
  const encoded = btoa(unescape(encodeURIComponent(value))).replace(/=+$/, "");
  const params = new URLSearchParams({ m: state.mode, l: state.locale, v: encoded });
  return `${location.origin}${location.pathname}#${params.toString()}`;
}

function applyUrlState() {
  if (!location.hash) return false;
  const params = new URLSearchParams(location.hash.slice(1));
  const m = params.get("m");
  const l = params.get("l");
  const v = params.get("v");
  if (!v) return false;
  let decoded;
  try {
    decoded = decodeURIComponent(escapeBin(atob(v)));
  } catch {
    return false;
  }
  if (l === "de" || l === "en") setLocale(l);
  if (m === "text" || m === "seed" || m === "date") setMode(m);
  if (state.mode === "text") $("#text-input").value = decoded;
  else if (state.mode === "seed") $("#seed-input").value = decoded;
  else $("#date-input").value = decoded;
  return true;
}

function escapeBin(str) {
  let out = "";
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    out += code < 128 ? str[i] : "%" + code.toString(16).padStart(2, "0").toUpperCase();
  }
  return out;
}

function render(result) {
  const out = $("#output");
  const dict = t();
  if (result.empty) {
    const msg = result.dateInvalid ? dict.dateInvalid : dict.nudge;
    out.innerHTML = `<div class="card nudge"><p>${escape(msg)}</p></div>`;
    return;
  }
  const dateLensCard = result.dateInfo
    ? `<section class="card reveal" style="--delay:0.20s">
         <h3>${escape(dict.sectionDateLens)}</h3>
         ${renderDateLens(result.dateInfo)}
       </section>`
    : "";
  const whatIfBanner = result.flips > 0
    ? `<div class="whatif-banner">${escape(dict.whatIfBanner(result.flips))} <button id="whatif-reset-inline" class="copy-btn warn" type="button">${escape(dict.whatIfReset)}</button></div>`
    : `<div class="whatif-hint muted">${escape(dict.whatIfHint)}</div>`;

  out.innerHTML = `
    ${renderVerdict(result)}
    ${dateLensCard}
    <section class="card wide reveal" style="--delay:0.05s">
      <h3>${escape(dict.sectionGroups)}</h3>
      ${renderGroupStage(result.groupTables)}
    </section>
    <section class="card wide reveal" style="--delay:0.15s">
      <h3>${escape(dict.sectionBracket)}</h3>
      ${whatIfBanner}
      ${renderKnockout(result.knockout)}
    </section>
    <div class="grid">
      <section class="card reveal" style="--delay:0.25s">
        <h3>${escape(dict.sectionHidden)}</h3>
        ${renderHidden(result.hidden)}
      </section>
      <section class="card reveal" style="--delay:0.35s">
        <h3>${escape(dict.sectionNumerology)}</h3>
        ${renderNumerology(result.numerology)}
      </section>
      <section class="card reveal" style="--delay:0.45s">
        <h3>${escape(dict.sectionOmen)}</h3>
        ${renderOmen(result.omen)}
      </section>
      <section class="card reveal" style="--delay:0.55s">
        <h3>${escape(dict.sectionStats)}</h3>
        ${renderPrior(result.prior, result.knockout.champion)}
      </section>
    </div>
  `;

  requestAnimationFrame(() => {
    const fill = $(".verdict-fill");
    if (fill) fill.style.width = `${result.confidence}%`;
  });

  // Confetti is the oracle's signature — skip it for what-if forks.
  if (result.flips === 0) fireConfetti(result.confidence);
  wireResultButtons(result);
  wireKnockoutClicks();
}

function wireResultButtons(result) {
  const copyBtn = $("#copy-btn");
  const shareBtn = $("#share-btn");
  const dict = t();
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(readingToText(result));
        copyBtn.textContent = dict.copied;
      } catch {
        copyBtn.textContent = "…";
      }
      setTimeout(() => (copyBtn.textContent = dict.copyReading), 1500);
    });
  }
  if (shareBtn) {
    shareBtn.addEventListener("click", async () => {
      const url = buildShareUrl();
      history.replaceState(null, "", url);
      try {
        await navigator.clipboard.writeText(url);
        shareBtn.textContent = dict.linkCopied;
      } catch {
        shareBtn.textContent = "…";
      }
      setTimeout(() => (shareBtn.textContent = dict.shareLink), 1500);
    });
  }
  ["whatif-reset", "whatif-reset-inline"].forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener("click", () => {
      state.koOverrides = {};
      run({ skipUrlUpdate: true, skipHistory: true });
    });
  });
}

function wireKnockoutClicks() {
  $$(".ko-team[data-match-key]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.matchKey;
      const code = btn.dataset.teamCode;
      if (!key || !code) return;
      if (state.koOverrides[key] === code) {
        // Clicking the already-overridden winner clears the override.
        delete state.koOverrides[key];
      } else {
        // Find the natural winner; if user clicks that one, just clear instead.
        const result = state.lastResult;
        if (result) {
          const match = result.knockout.rounds
            .flatMap((r) => r.matches)
            .find((m) => m.key === key);
          if (match && !match.flipped && match.winner.code === code) {
            delete state.koOverrides[key];
          } else {
            state.koOverrides[key] = code;
          }
        } else {
          state.koOverrides[key] = code;
        }
      }
      run({ skipUrlUpdate: true, skipHistory: true });
    });
  });
}

function run({ skipUrlUpdate, skipHistory } = {}) {
  const text = $("#text-input").value;
  const seed = $("#seed-input").value;
  const date = $("#date-input").value;
  const result = decode({
    text, seed, date,
    mode: state.mode,
    locale: state.locale,
    koOverrides: state.koOverrides,
  });
  state.lastResult = result;
  render(result);
  if (!skipUrlUpdate && !result.empty) {
    history.replaceState(null, "", buildShareUrl());
  }
  // Only record canonical readings (no what-if forks).
  if (!skipHistory && !result.empty && result.flips === 0) {
    pushHistory(result);
  }
}

/* ─────────── History (localStorage) ─────────── */

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
  } catch {
    // Storage may be unavailable (private mode, quota) — degrade silently.
  }
}

function pushHistory(result) {
  const entry = {
    ts: Date.now(),
    mode: result.mode,
    seed: result.seed,
    locale: state.locale,
    champion: result.knockout.champion.name,
    confederation: result.knockout.champion.confederation,
    confidence: result.confidence,
  };
  // Dedupe: same mode + seed within last 10 minutes collapses.
  const recent = state.history[0];
  if (recent && recent.mode === entry.mode && recent.seed === entry.seed && entry.ts - recent.ts < 10 * 60_000) {
    state.history[0] = entry;
  } else {
    state.history.unshift(entry);
  }
  state.history = state.history.slice(0, HISTORY_MAX);
  saveHistory();
  renderHistory();
}

function renderHistory() {
  const dict = t();
  const list = $("#history-list");
  const empty = $("#history-empty");
  if (!list || !empty) return;
  if (!state.history.length) {
    list.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  const now = Date.now();
  list.innerHTML = state.history.map((h, i) => {
    const ago = dict.historyRelative(Math.max(0, Math.floor((now - h.ts) / 1000)));
    const modeLabel = h.mode === "text" ? dict.historyFromText : h.mode === "seed" ? dict.historyFromSeed : dict.historyFromDate;
    const preview = escape(h.seed.length > 56 ? h.seed.slice(0, 56) + "…" : h.seed);
    return `
      <div class="history-row" data-index="${i}">
        <div class="history-main">
          <div class="history-champ">${escape(teamName(h.champion))} <span class="muted">· ${h.confidence}%</span></div>
          <div class="history-meta"><span class="history-pill">${escape(modeLabel)}</span> <span class="muted">${escape(ago)}</span></div>
          <div class="history-seed muted">${preview}</div>
        </div>
        <div class="history-row-actions">
          <button class="tool-btn" type="button" data-action="reopen" data-index="${i}">${escape(dict.historyReopen)}</button>
          <button class="tool-btn" type="button" data-action="delete" data-index="${i}" aria-label="${escape(dict.historyDelete)}">✕</button>
        </div>
      </div>
    `;
  }).join("");
}

function reopenHistory(i) {
  const h = state.history[i];
  if (!h) return;
  state.koOverrides = {};
  if (h.locale === "en" || h.locale === "de") setLocale(h.locale);
  setMode(h.mode);
  if (h.mode === "text") $("#text-input").value = h.seed;
  else if (h.mode === "seed") $("#seed-input").value = h.seed;
  else $("#date-input").value = h.seed;
  closeHistory();
  run({ skipHistory: true });
}

function deleteHistory(i) {
  state.history.splice(i, 1);
  saveHistory();
  renderHistory();
}

function openHistory() {
  const drawer = $("#history-drawer");
  const backdrop = $("#history-backdrop");
  drawer.hidden = false;
  backdrop.hidden = false;
  drawer.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => drawer.classList.add("open"));
}

function closeHistory() {
  const drawer = $("#history-drawer");
  const backdrop = $("#history-backdrop");
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  setTimeout(() => {
    drawer.hidden = true;
    backdrop.hidden = true;
  }, 200);
}

/* ─────────── Confetti ─────────── */

function fireConfetti(confidence) {
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = $("#confetti");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  canvas.style.width = innerWidth + "px";
  canvas.style.height = innerHeight + "px";
  ctx.scale(dpr, dpr);

  const count = Math.round(80 + confidence * 1.2);
  const colors = ["#00d97e", "#ffd166", "#ef476f", "#7fa896", "#ffffff"];
  const parts = Array.from({ length: count }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 80,
    y: 120 + Math.random() * 40,
    vx: (Math.random() - 0.5) * 8,
    vy: -Math.random() * 9 - 3,
    g: 0.25 + Math.random() * 0.15,
    size: 4 + Math.random() * 5,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.4,
    color: colors[Math.floor(Math.random() * colors.length)],
    life: 0,
    max: 90 + Math.random() * 40,
  }));

  let raf;
  function frame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = 0;
    for (const p of parts) {
      if (p.life > p.max) continue;
      alive++;
      p.life++;
      p.vy += p.g;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, 1 - p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.4);
      ctx.restore();
    }
    if (alive > 0) raf = requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  frame();
  return () => cancelAnimationFrame(raf);
}

/* ─────────── Boot ─────────── */

document.addEventListener("DOMContentLoaded", () => {
  $$(".mode-tab").forEach((tab) => tab.addEventListener("click", () => setMode(tab.dataset.mode)));
  $$(".lang-btn").forEach((b) => b.addEventListener("click", () => setLocale(b.dataset.lang)));
  $("#decode-btn").addEventListener("click", () => {
    state.koOverrides = {};
    run();
  });

  // Default date input to today so the "Date" tab is usable on first click.
  const today = new Date();
  const isoToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  $("#date-input").value = isoToday;

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      state.koOverrides = {};
      run();
    }
    if (e.key === "Escape") closeHistory();
  });

  // Changing input clears any pending what-if overrides — they belong to the previous reading.
  ["text-input", "seed-input", "date-input"].forEach((id) => {
    $(`#${id}`).addEventListener("input", () => { state.koOverrides = {}; });
  });

  // History drawer wiring
  $("#history-btn").addEventListener("click", openHistory);
  $("#history-close").addEventListener("click", closeHistory);
  $("#history-backdrop").addEventListener("click", closeHistory);
  $("#history-clear").addEventListener("click", () => {
    if (!state.history.length) return;
    if (confirm(t().historyClearConfirm)) {
      state.history = [];
      saveHistory();
      renderHistory();
    }
  });
  $("#history-list").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const i = Number(btn.dataset.index);
    if (btn.dataset.action === "reopen") reopenHistory(i);
    else if (btn.dataset.action === "delete") deleteHistory(i);
  });

  setMode("text");
  applyI18n();
  renderHistory();
  if (applyUrlState()) {
    run({ skipUrlUpdate: true });
  }
});
