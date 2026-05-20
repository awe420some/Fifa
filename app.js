import { decode } from "./decoder.js";

const $ = (sel) => document.querySelector(sel);

const state = { mode: "text" };

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".mode-tab").forEach((el) => {
    el.classList.toggle("active", el.dataset.mode === mode);
  });
  $("#text-panel").hidden = mode !== "text";
  $("#seed-panel").hidden = mode !== "seed";
}

function escape(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

function renderHidden(hidden) {
  if (!hidden.direct.length && !hidden.acrostic.length) {
    return `<p class="muted">No country names surfaced from the text. The signal is faint.</p>`;
  }
  const direct = hidden.direct.length
    ? `<div><strong>Buried in plain sight:</strong> ${hidden.direct.map((n) => `<span class="chip">${escape(n)}</span>`).join("")}</div>`
    : "";
  const acrostic = hidden.acrostic.length
    ? `<div><strong>Acrostic whispers:</strong> ${hidden.acrostic.map((n) => `<span class="chip alt">${escape(n)}</span>`).join("")}</div>`
    : "";
  return direct + acrostic;
}

function renderNumerology(n) {
  if (!n.team) {
    return `<p class="muted">The text holds no letters to weigh.</p>`;
  }
  return `
    <p>Letter sum: <strong>${n.sum}</strong> across ${n.letters} letters.</p>
    <p>Lucky digit: <strong class="lucky">${n.luckyDigit}</strong></p>
    <p>Numerology points to <strong>${escape(n.team.name)}</strong> <span class="muted">(${n.team.confederation}, tier ${n.team.tier})</span>.</p>
  `;
}

function renderBracket(bracket) {
  const cols = bracket.rounds
    .map((round) => {
      const matches = round.matches
        .map(([a, b]) => {
          if (!b) return `<div class="match solo"><span>${escape(a.name)}</span></div>`;
          return `<div class="match"><span>${escape(a.name)}</span><span class="vs">vs</span><span>${escape(b.name)}</span></div>`;
        })
        .join("");
      return `<div class="bracket-col"><h4>${round.name}</h4>${matches}</div>`;
    })
    .join("");
  return `
    <div class="bracket">${cols}
      <div class="bracket-col champion-col">
        <h4>Champion</h4>
        <div class="match champion">
          <span>${escape(bracket.champion.name)}</span>
          <span class="muted">${escape(bracket.champion.confederation)}</span>
        </div>
      </div>
    </div>
  `;
}

function renderOmen(omen) {
  return `<p>${escape(omen.text)}</p>`;
}

function renderPrior(prior, champion) {
  const leader = `${prior.leader.nation} leads all nations with ${prior.leader.count} titles since 1930.`;
  const champPart = prior.championTitles
    ? `Your champion <strong>${escape(champion.name)}</strong> already has ${prior.championTitles} on the shelf.`
    : `Your champion <strong>${escape(champion.name)}</strong> would be lifting their first trophy.`;
  const hostNote = `${prior.hostWins} of ${prior.totalTournaments} tournaments have gone to a host nation.`;
  const continental = `Europe ${prior.europeWins} — South America ${prior.southAmericaWins} (rest of world: 0).`;
  return `
    <ul>
      <li>${leader}</li>
      <li>${champPart}</li>
      <li>${hostNote}</li>
      <li>${continental}</li>
    </ul>
  `;
}

function renderVerdict(result) {
  const c = result.bracket.champion;
  return `
    <div class="verdict-card">
      <div class="verdict-label">The Oracle reads</div>
      <div class="verdict-champion">${escape(c.name)}</div>
      <div class="verdict-meta">${escape(c.confederation)} · tier ${c.tier}</div>
      <div class="verdict-bar"><div class="verdict-fill" style="width:${result.confidence}%"></div></div>
      <div class="verdict-confidence">${result.confidence}% confidence</div>
      <button id="copy-btn" class="copy-btn" type="button">Copy reading</button>
    </div>
  `;
}

function readingToText(result) {
  const c = result.bracket.champion;
  const lines = [
    `🏆 World Cup Oracle 2026 reading`,
    `Champion: ${c.name} (${c.confederation})`,
    `Confidence: ${result.confidence}%`,
    `Numerology pick: ${result.numerology.team ? result.numerology.team.name : "—"} · lucky digit ${result.numerology.luckyDigit}`,
    `Hidden in text: ${result.hidden.direct.join(", ") || "none"}`,
    `Omen: ${result.omen.text}`,
    `Seed: ${result.seed.slice(0, 80)}${result.seed.length > 80 ? "…" : ""}`,
  ];
  return lines.join("\n");
}

function render(result) {
  const out = $("#output");
  if (result.empty) {
    out.innerHTML = `<div class="card nudge"><p>Feed the oracle something — a sentence, a name, a date.</p></div>`;
    return;
  }
  out.innerHTML = `
    ${renderVerdict(result)}
    <div class="grid">
      <section class="card">
        <h3>Hidden Names</h3>
        ${renderHidden(result.hidden)}
      </section>
      <section class="card">
        <h3>Numerology</h3>
        ${renderNumerology(result.numerology)}
      </section>
      <section class="card wide">
        <h3>Knockout Bracket</h3>
        ${renderBracket(result.bracket)}
      </section>
      <section class="card">
        <h3>Historical Omen</h3>
        ${renderOmen(result.omen)}
      </section>
      <section class="card">
        <h3>96 Years of Statistics</h3>
        ${renderPrior(result.prior, result.bracket.champion)}
      </section>
    </div>
  `;

  const copyBtn = $("#copy-btn");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(readingToText(result));
        copyBtn.textContent = "Copied!";
        setTimeout(() => (copyBtn.textContent = "Copy reading"), 1500);
      } catch {
        copyBtn.textContent = "Copy failed";
      }
    });
  }
}

function run() {
  const text = $("#text-input").value;
  const seed = $("#seed-input").value;
  const result = decode({ text, seed, mode: state.mode });
  render(result);
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".mode-tab").forEach((tab) => {
    tab.addEventListener("click", () => setMode(tab.dataset.mode));
  });
  $("#decode-btn").addEventListener("click", run);
  // Allow Cmd/Ctrl+Enter to decode from either input.
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run();
  });
  setMode("text");
});
