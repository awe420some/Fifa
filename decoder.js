import { TEAMS_2026, WINNERS_1930_2022, STATS, DEMONYMS } from "./data.js";

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

// Scan input for team names hidden as substrings, plus an acrostic of word initials.
export function findHiddenCountries(text, teams) {
  const lower = text.toLowerCase();
  const compact = lower.replace(/[^a-z]/g, "");
  const directHits = new Set();
  for (const t of teams) {
    const key = t.name.toLowerCase().replace(/[^a-z]/g, "");
    if (key.length >= 4 && compact.includes(key)) directHits.add(t.name);
  }
  // Demonyms — "brazilian" → Brazil, "german" → Germany, etc.
  const words = lower.split(/[^a-z]+/).filter(Boolean);
  for (const w of words) {
    if (DEMONYMS[w]) directHits.add(DEMONYMS[w]);
  }
  // Acrostic from first letters of each word
  const initials = lower
    .split(/[^a-z]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("");
  const acrostic = [];
  if (initials.length >= 3) {
    for (const t of teams) {
      const key = t.name.toLowerCase().replace(/[^a-z]/g, "");
      if (key.length >= 4 && initials.includes(key)) acrostic.push(t.name);
    }
  }
  return {
    direct: [...directHits],
    acrostic,
  };
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
  if (letters === 0) {
    return { sum: 0, letters: 0, luckyDigit: 0, team: null };
  }
  const idx = sum % teams.length;
  let lucky = sum;
  while (lucky > 9) {
    lucky = String(lucky)
      .split("")
      .reduce((a, c) => a + Number(c), 0);
  }
  return { sum, letters, luckyDigit: lucky, team: teams[idx] };
}

// Build a 16-team knockout bracket from a seed.
export function bracketFromSeed(seed, teams) {
  const shuffled = seededShuffle(teams, seed);
  const sixteen = shuffled.slice(0, 16);
  const rounds = [{ name: "Round of 16", matches: pair(sixteen) }];

  let current = sixteen;
  const roundNames = ["Quarter-finals", "Semi-finals", "Final"];
  for (let r = 0; r < roundNames.length; r++) {
    const winners = [];
    const pairs = pair(current);
    for (let m = 0; m < pairs.length; m++) {
      const [a, b] = pairs[m];
      const matchSeed = hash32(`${seed}|${r}|${m}|${a.code}vs${b.code}`);
      winners.push(pickWinner(a, b, matchSeed));
    }
    rounds.push({ name: roundNames[r], matches: pair(winners) });
    current = winners;
  }
  // After the Final round entry we still need to know the champion.
  const finalSeed = hash32(`${seed}|champ|${current[0].code}vs${current[1].code}`);
  const champion = pickWinner(current[0], current[1], finalSeed);
  return { rounds, champion, finalists: current };
}

function pair(list) {
  const out = [];
  for (let i = 0; i < list.length; i += 2) out.push([list[i], list[i + 1]]);
  return out;
}

// Stronger tier wins ~65% of the time; same tier is 50/50.
function pickWinner(a, b, matchSeed) {
  const r = mulberry32(matchSeed)();
  if (a.tier === b.tier) return r < 0.5 ? a : b;
  const strong = a.tier < b.tier ? a : b;
  const weak = strong === a ? b : a;
  return r < 0.65 ? strong : weak;
}

// Pull an "omen" from the 22 past finals.
export function historicalOmen(seed, champion) {
  const matches = WINNERS_1930_2022.filter((f) => f.winner === champion.name);
  let pick;
  if (matches.length > 0) {
    pick = matches[hash32(`${seed}|omen|${champion.code}`) % matches.length];
    return {
      type: "echo",
      year: pick.year,
      host: pick.host,
      text: `${champion.name} last carried this glow in ${pick.year}, lifting the trophy in ${pick.host} with ${pick.topScorer} leading the scoring charts.`,
    };
  }
  pick = WINNERS_1930_2022[hash32(`${seed}|omen-x|${champion.code}`) % WINNERS_1930_2022.length];
  return {
    type: "parallel",
    year: pick.year,
    host: pick.host,
    text: `No ${champion.name} title in 96 years of finals — but the seed echoes ${pick.year}, when ${pick.winner} broke through in ${pick.host}.`,
  };
}

// Pull a couple of headline stats from the historical aggregate.
export function statisticalPrior(champion) {
  const top = STATS.ranking[0];
  const championTitles = STATS.titles[champion.name] || 0;
  return {
    leader: top,
    championTitles,
    hostWins: STATS.hostWins,
    totalTournaments: STATS.totalTournaments,
    europeWins: STATS.europeWins,
    southAmericaWins: STATS.southAmericaWins,
  };
}

// Orchestrator — returns one result object the UI renders.
export function decode({ text = "", seed = "", mode = "text" }) {
  const effective = (mode === "text" ? text : seed).trim();
  if (!effective) {
    return { empty: true };
  }
  const hidden = findHiddenCountries(effective, TEAMS_2026);
  const numerology = numerologyPick(effective, TEAMS_2026);
  const bracket = bracketFromSeed(hash32(effective), TEAMS_2026);
  const omen = historicalOmen(effective, bracket.champion);
  const prior = statisticalPrior(bracket.champion);

  // Confidence: bracket result is the spine. Add bumps for corroboration.
  let confidence = 55;
  if (numerology.team && numerology.team.name === bracket.champion.name) confidence += 15;
  if (hidden.direct.includes(bracket.champion.name)) confidence += 15;
  if (hidden.acrostic.includes(bracket.champion.name)) confidence += 5;
  confidence += Math.min(prior.championTitles * 2, 10);
  confidence = Math.min(confidence, 99);

  return {
    empty: false,
    seed: effective,
    hidden,
    numerology,
    bracket,
    omen,
    prior,
    confidence,
  };
}
