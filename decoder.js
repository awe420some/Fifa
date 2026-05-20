import { TEAMS_2026, GROUPS_2026, WINNERS_1930_2022, STATS, DEMONYMS, I18N, NAMES_DE } from "./data.js";

// Per-tier scoring strength. Higher = expected to score more, harder to score against.
// Tuned so T1 vs T4 averages ~3-0 (T1 wins ~92%), T2 vs T3 averages ~1.5-0.7.
const TIER_STRENGTH = { 1: 2.4, 2: 1.7, 3: 1.1, 4: 0.6 };

const localName = (name, locale) => (locale === "de" && NAMES_DE[name]) || name;

const localHost = (host, locale) => {
  if (locale !== "de") return host;
  // "South Korea/Japan" (2002) — translate each side.
  return host.split("/").map((s) => NAMES_DE[s.trim()] || s.trim()).join("/");
};

// FNV-1a 32-bit hash — deterministic, fast, no deps.
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Mulberry32 PRNG seeded from a 32-bit int.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle(arr, seed) {
  const rng = mulberry32(seed);
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Scan input for team names hidden as substrings + demonyms + acrostic.
export function findHiddenCountries(text, teams) {
  const lower = text.toLowerCase();
  const compact = lower.replace(/[^a-z]/g, "");
  const directHits = new Set();
  for (const t of teams) {
    const key = t.name.toLowerCase().replace(/[^a-z]/g, "");
    if (key.length >= 4 && compact.includes(key)) directHits.add(t.name);
  }
  const words = lower.split(/[^a-z]+/).filter(Boolean);
  for (const w of words) {
    if (DEMONYMS[w]) directHits.add(DEMONYMS[w]);
  }
  const initials = words.map((w) => w[0]).join("");
  const acrostic = [];
  if (initials.length >= 3) {
    for (const t of teams) {
      const key = t.name.toLowerCase().replace(/[^a-z]/g, "");
      if (key.length >= 4 && initials.includes(key)) acrostic.push(t.name);
    }
  }
  return { direct: [...directHits], acrostic };
}

// Letter-value numerology: a=1..z=26.
export function numerologyPick(text, teams) {
  const lower = text.toLowerCase();
  let sum = 0;
  let letters = 0;
  for (const ch of lower) {
    const code = ch.charCodeAt(0);
    if (code >= 97 && code <= 122) {
      sum += code - 96;
      letters += 1;
    }
  }
  if (letters === 0) return { sum: 0, letters: 0, luckyDigit: 0, team: null };
  const idx = sum % teams.length;
  let lucky = sum;
  while (lucky > 9) {
    lucky = String(lucky)
      .split("")
      .reduce((a, c) => a + Number(c), 0);
  }
  return { sum, letters, luckyDigit: lucky, team: teams[idx] };
}

// Simulate one head-to-head: returns { scoreA, scoreB }.
// Each side's expected goals comes from its tier strength minus the opponent's,
// then we sample from a Poisson cumulative — including the 0-bucket, so shutouts
// are possible (a previous version skipped k=0 and inflated weak-team scores).
function simulateMatch(a, b, matchSeed) {
  const rng = mulberry32(matchSeed);
  const expectedGoals = (own, opp) => {
    const ownStrength = TIER_STRENGTH[own.tier] ?? 1.0;
    const oppStrength = TIER_STRENGTH[opp.tier] ?? 1.0;
    return Math.max(0.15, ownStrength - 0.55 * oppStrength + 0.55);
  };
  const goalsFor = (lambda) => {
    const r = rng();
    let cum = 0;
    let p = Math.exp(-lambda);
    for (let k = 0; k <= 6; k++) {
      cum += p;
      if (r < cum) return k;
      p = (p * lambda) / (k + 1);
    }
    return 6;
  };
  return {
    scoreA: goalsFor(expectedGoals(a, b)),
    scoreB: goalsFor(expectedGoals(b, a)),
  };
}

// 3 points for a win, 1 each for a draw. Tie-break: GD, then GF, then seed-stable.
export function simulateGroupStage(seed, groups, teamsByCode) {
  const out = {};
  for (const [letter, codes] of Object.entries(groups)) {
    const teams = codes.map((c) => teamsByCode[c]);
    const stats = Object.fromEntries(teams.map((t) => [t.code, { team: t, p: 0, gf: 0, ga: 0, gd: 0, w: 0, d: 0, l: 0 }]));
    // 6 fixtures per group: pairings (0,1) (2,3) (0,2) (1,3) (0,3) (1,2)
    const pairs = [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]];
    for (let i = 0; i < pairs.length; i++) {
      const [ai, bi] = pairs[i];
      const a = teams[ai];
      const b = teams[bi];
      const ms = hash32(`${seed}|group|${letter}|${i}|${a.code}-${b.code}`);
      const { scoreA, scoreB } = simulateMatch(a, b, ms);
      stats[a.code].gf += scoreA; stats[a.code].ga += scoreB;
      stats[b.code].gf += scoreB; stats[b.code].ga += scoreA;
      if (scoreA > scoreB)      { stats[a.code].p += 3; stats[a.code].w += 1; stats[b.code].l += 1; }
      else if (scoreB > scoreA) { stats[b.code].p += 3; stats[b.code].w += 1; stats[a.code].l += 1; }
      else                       { stats[a.code].p += 1; stats[b.code].p += 1; stats[a.code].d += 1; stats[b.code].d += 1; }
    }
    const table = Object.values(stats).map((r) => ({ ...r, gd: r.gf - r.ga }));
    // Stable sort: points → GD → GF → original group order.
    const originalIdx = Object.fromEntries(codes.map((c, i) => [c, i]));
    table.sort((x, y) =>
      y.p - x.p ||
      y.gd - x.gd ||
      y.gf - x.gf ||
      originalIdx[x.team.code] - originalIdx[y.team.code]
    );
    out[letter] = table;
  }
  return out;
}

// 24 group winners/runners-up + 8 best third-placed = 32 advance.
export function pickQualifiers(groupTables) {
  const winners = [];
  const runnersUp = [];
  const thirds = [];
  for (const letter of Object.keys(groupTables)) {
    const t = groupTables[letter];
    winners.push({ ...t[0], group: letter, pos: 1 });
    runnersUp.push({ ...t[1], group: letter, pos: 2 });
    thirds.push({ ...t[2], group: letter, pos: 3 });
  }
  thirds.sort((a, b) => b.p - a.p || b.gd - a.gd || b.gf - a.gf || a.group.localeCompare(b.group));
  const bestThirds = thirds.slice(0, 8);
  return [...winners, ...runnersUp, ...bestThirds];
}

// Canonical bracket seed positions for a size-N single-elimination tournament:
// the classical 1v32, 16v17, 8v25, 9v24, ... arrangement built by halving recursion.
// Returns 1-indexed seed positions; index in returned array = bracket slot.
function bracketOrder(n) {
  let order = [1, 2];
  while (order.length < n) {
    const size = order.length;
    const next = new Array(size * 2);
    for (let i = 0; i < size; i++) {
      next[i * 2] = order[i];
      next[i * 2 + 1] = size * 2 + 1 - order[i];
    }
    order = next;
  }
  return order;
}

// Build a 32→1 knockout from the qualifier pool, ordered into a seeded bracket.
// Qualifiers are ranked by group position (winner → runner-up → third), then
// points / GD / GF / tier, then mapped onto a classical 32-slot bracket so the
// top-seeded teams meet weaker opponents in R32 and only collide later.
// `overrides` is a map of "r-m" → team-code that forces that match's winner.
// Downstream rounds re-simulate with the new pairings (different match seeds),
// so a flip rewrites the whole bracket from that point onward.
export function buildKnockout(seed, qualifiers, overrides = {}) {
  const seeded = qualifiers.slice().sort((x, y) =>
    x.pos - y.pos ||
    y.p - x.p ||
    y.gd - x.gd ||
    y.gf - x.gf ||
    x.team.tier - y.team.tier
  );
  const slots = bracketOrder(32).map((rank) => seeded[rank - 1]);
  const roundNames = ["roundR32", "roundR16", "roundQF", "roundSF", "roundFinal"];
  const rounds = [];
  let current = slots.map((q) => q.team);
  for (let r = 0; r < roundNames.length; r++) {
    const pairs = pair(current);
    const matches = [];
    const winners = [];
    for (let m = 0; m < pairs.length; m++) {
      const [a, b] = pairs[m];
      const ms = hash32(`${seed}|ko|${r}|${m}|${a.code}-${b.code}`);
      const result = simulateMatch(a, b, ms);
      let naturalWinner;
      if (result.scoreA === result.scoreB) {
        // Penalty shootout — coin flip biased by tier.
        const rng = mulberry32(ms ^ 0xdeadbeef);
        const strongA = a.tier <= b.tier;
        naturalWinner = rng() < (strongA ? 0.6 : 0.4) ? a : b;
      } else {
        naturalWinner = result.scoreA > result.scoreB ? a : b;
      }
      const key = `${r}-${m}`;
      const overrideCode = overrides[key];
      let winner = naturalWinner;
      let flipped = false;
      if (overrideCode && overrideCode !== naturalWinner.code) {
        const candidate = a.code === overrideCode ? a : (b.code === overrideCode ? b : null);
        if (candidate) {
          winner = candidate;
          flipped = true;
        }
      }
      matches.push({ a, b, scoreA: result.scoreA, scoreB: result.scoreB, winner, naturalWinner, flipped, key });
      winners.push(winner);
    }
    rounds.push({ name: roundNames[r], matches });
    current = winners;
  }
  return { rounds, champion: current[0] };
}

function pair(list) {
  const out = [];
  for (let i = 0; i < list.length; i += 2) out.push([list[i], list[i + 1]]);
  return out;
}

// Pull an "omen" from the 22 past finals. Country names get localized so the
// DE locale doesn't leak "Brazil" / "Mexico" through the formatted string.
export function historicalOmen(seed, champion, locale = "en") {
  const t = I18N[locale];
  const champLocal = localName(champion.name, locale);
  const matches = WINNERS_1930_2022.filter((f) => f.winner === champion.name);
  if (matches.length > 0) {
    const pick = matches[hash32(`${seed}|omen|${champion.code}`) % matches.length];
    return {
      type: "echo",
      year: pick.year,
      host: pick.host,
      text: t.omenEcho(champLocal, pick.year, localHost(pick.host, locale), pick.topScorer),
    };
  }
  const pick = WINNERS_1930_2022[hash32(`${seed}|omen-x|${champion.code}`) % WINNERS_1930_2022.length];
  return {
    type: "parallel",
    year: pick.year,
    host: pick.host,
    text: t.omenParallel(champLocal, pick.year, localHost(pick.host, locale), localName(pick.winner, locale)),
  };
}

export function statisticalPrior(champion) {
  const top = STATS.ranking[0];
  return {
    leader: top,
    championTitles: STATS.titles[champion.name] || 0,
    hostWins: STATS.hostWins,
    totalTournaments: STATS.totalTournaments,
    europeWins: STATS.europeWins,
    southAmericaWins: STATS.southAmericaWins,
  };
}

// Kickoff: opening match of the 2026 World Cup is June 11, 2026 (Mexico City).
const KICKOFF_2026 = Date.UTC(2026, 5, 11); // month is 0-indexed (5 = June)

function dateLens(iso, locale) {
  // Accept YYYY-MM-DD; bail cleanly on anything else.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return { valid: false };
  const y = Number(match[1]);
  const mo = Number(match[2]);
  const d = Number(match[3]);
  const utc = Date.UTC(y, mo - 1, d);
  const date = new Date(utc);
  // Round-trip check catches things like Feb 30.
  if (date.getUTCFullYear() !== y || date.getUTCMonth() + 1 !== mo || date.getUTCDate() !== d) {
    return { valid: false };
  }
  const weekdayIdx = date.getUTCDay();
  const digits = (match[1] + match[2] + match[3]).split("").map(Number);
  let digitSum = digits.reduce((a, c) => a + c, 0);
  while (digitSum > 9) {
    digitSum = String(digitSum).split("").reduce((a, c) => a + Number(c), 0);
  }
  const dayMs = 86400000;
  const daysToKickoff = Math.round((KICKOFF_2026 - utc) / dayMs);
  return {
    valid: true,
    iso,
    year: y,
    month: mo,
    day: d,
    weekdayIdx,
    digitSum,
    daysToKickoff,
  };
}

// Orchestrator.
export function decode({ text = "", seed = "", date = "", mode = "text", locale = "en", koOverrides = {} }) {
  let effective = "";
  let dateInfo = null;
  if (mode === "text") effective = text.trim();
  else if (mode === "seed") effective = seed.trim();
  else if (mode === "date") {
    dateInfo = dateLens(date, locale);
    if (!dateInfo.valid) return { empty: true, dateInvalid: true };
    effective = date.trim();
  }
  if (!effective) return { empty: true };

  const hidden = findHiddenCountries(effective, TEAMS_2026);
  const numerology = numerologyPick(effective, TEAMS_2026);

  const teamsByCode = Object.fromEntries(TEAMS_2026.map((t) => [t.code, t]));
  const groupTables = simulateGroupStage(hash32(effective), GROUPS_2026, teamsByCode);
  const qualifiers = pickQualifiers(groupTables);
  const knockout = buildKnockout(hash32(effective), qualifiers, koOverrides);

  const omen = historicalOmen(effective, knockout.champion, locale);
  const prior = statisticalPrior(knockout.champion);

  let confidence = 55;
  if (numerology.team && numerology.team.name === knockout.champion.name) confidence += 15;
  if (hidden.direct.includes(knockout.champion.name)) confidence += 15;
  if (hidden.acrostic.includes(knockout.champion.name)) confidence += 5;
  confidence += Math.min(prior.championTitles * 2, 10);
  // What-if forks aren't oracle visions — they're hypotheticals. Cap & dampen.
  const flips = Object.keys(koOverrides).length;
  if (flips > 0) {
    confidence = Math.max(15, confidence - flips * 12);
  }
  confidence = Math.min(confidence, 99);

  return {
    empty: false,
    seed: effective,
    mode,
    hidden,
    numerology,
    groupTables,
    knockout,
    omen,
    prior,
    confidence,
    dateInfo,
    flips,
  };
}
