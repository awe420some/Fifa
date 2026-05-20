import { decode } from "./decoder.js";
import { I18N, NAMES_DE } from "./data.js";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const state = {
  mode: "text",
  locale: "en",
  lastResult: null,
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
  $$(".mode-tab").forEach((el) => el.classList.toggle("active", el.dataset.mode === mode));
  $("#text-panel").hidden = mode !== "text";
  $("#seed-panel").hidden = mode !== "seed";
}

function setLocale(locale) {
  state.locale = locale;
  document.documentElement.lang = locale;
  $$(".lang-btn").forEach((el) => el.classList.toggle("active", el.dataset.lang === locale));
  applyI18n();
  if (state.lastResult && !state.lastResult.empty) {
    // Re-decode so omen text + numerology phrasing use the new locale.
    run({ skipUrlUpdate: true });
  } else if (state.lastResult && state.lastResult.empty) {
    render(state.lastResult);
  }
}

function applyI18n() {
  const dict = t();
  $$("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (typeof dict[key] === "string") el.textContent = dict[key];
  });
  $$("[data-i18n-attr]").forEach((el) => {
    const spec = el.getAttribute("data-i18n-attr"); // "placeholder:textPlaceholder"
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
    const matches = round.matches.map((m) => `
      <div class="ko-match">
        <div class="ko-team ${m.winner === m.a ? "win" : ""}">${escape(teamName(m.a.name))} <span class="ko-score">${m.scoreA}</span></div>
        <div class="ko-team ${m.winner === m.b ? "win" : ""}">${escape(teamName(m.b.name))} <span class="ko-score">${m.scoreB}</span></div>
      </div>
    `).join("");
    return `<div class="ko-col"><h4>${escape(dict[round.name])}</h4>${matches}</div>`;
  }).join("");
  return `
    <div class="ko-bracket">${cols}
      <div class="ko-col champion-col">
        <h4>${escape(dict.champion)}</h4>
        <div class="ko-match champion">
          <div class="ko-team win">${escape(teamName(knockout.champion.name))}</div>
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

function renderVerdict(result) {
  const dict = t();
  const c = result.knockout.champion;
  return `
    <div class="verdict-card">
      <div class="verdict-label">${escape(dict.verdictLabel)}</div>
      <div class="verdict-champion">${escape(teamName(c.name))}</div>
      <div class="verdict-meta">${escape(c.confederation)} · tier ${c.tier}</div>
      <div class="verdict-bar"><div class="verdict-fill" style="width:0%"></div></div>
      <div class="verdict-confidence">${result.confidence}% ${escape(dict.confidence)}</div>
      <div class="verdict-actions">
        <button id="copy-btn" class="copy-btn" type="button">${escape(dict.copyReading)}</button>
        <button id="share-btn" class="copy-btn" type="button">${escape(dict.shareLink)}</button>
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
    `${result.confidence}% ${dict.confidence}`,
    `${dict.sectionNumerology}: ${result.numerology.team ? teamName(result.numerology.team.name) : "—"} · ${dict.numerologyLucky} ${result.numerology.luckyDigit}`,
    `${dict.sectionHidden}: ${result.hidden.direct.map(teamName).join(", ") || "—"}`,
    `${dict.sectionOmen}: ${result.omen.text}`,
    `Seed: ${result.seed.slice(0, 80)}${result.seed.length > 80 ? "…" : ""}`,
  ].join("\n");
}

function buildShareUrl() {
  const value = state.mode === "text" ? $("#text-input").value : $("#seed-input").value;
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
  if (m === "text" || m === "seed") setMode(m);
  if (state.mode === "text") $("#text-input").value = decoded;
  else $("#seed-input").value = decoded;
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
    out.innerHTML = `<div class="card nudge"><p>${escape(dict.nudge)}</p></div>`;
    return;
  }
  out.innerHTML = `
    ${renderVerdict(result)}
    <section class="card wide reveal" style="--delay:0.05s">
      <h3>${escape(dict.sectionGroups)}</h3>
      ${renderGroupStage(result.groupTables)}
    </section>
    <section class="card wide reveal" style="--delay:0.15s">
      <h3>${escape(dict.sectionBracket)}</h3>
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

  // Animate the confidence bar after paint.
  requestAnimationFrame(() => {
    const fill = $(".verdict-fill");
    if (fill) fill.style.width = `${result.confidence}%`;
  });

  fireConfetti(result.confidence);
  wireButtons(result);
}

function wireButtons(result) {
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
}

function run({ skipUrlUpdate } = {}) {
  const text = $("#text-input").value;
  const seed = $("#seed-input").value;
  const result = decode({ text, seed, mode: state.mode, locale: state.locale });
  state.lastResult = result;
  render(result);
  if (!skipUrlUpdate && !result.empty) {
    history.replaceState(null, "", buildShareUrl());
  }
}

// Lightweight canvas confetti — single burst, no deps. Skipped under reduced motion.
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
  // Cancel any in-flight burst on re-fire.
  return () => cancelAnimationFrame(raf);
}

document.addEventListener("DOMContentLoaded", () => {
  $$(".mode-tab").forEach((tab) => tab.addEventListener("click", () => setMode(tab.dataset.mode)));
  $$(".lang-btn").forEach((b) => b.addEventListener("click", () => setLocale(b.dataset.lang)));
  $("#decode-btn").addEventListener("click", () => run());
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run();
  });
  setMode("text");
  applyI18n();
  if (applyUrlState()) {
    // Auto-decode shared link.
    run({ skipUrlUpdate: true });
  }
});
