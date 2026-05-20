// World Cup Oracle — static datasets

// 48-team 2026 field. As of May 2026 some slots were still being finalised
// through inter-confederation playoffs; this list is the realistic best
// reconstruction, not an official roster. Tier 1–4 (1 = strongest) is used
// for match weighting.
export const TEAMS_2026 = [
  // Hosts — CONCACAF
  { name: "United States", code: "USA", confederation: "CONCACAF", tier: 2 },
  { name: "Canada",        code: "CAN", confederation: "CONCACAF", tier: 3 },
  { name: "Mexico",        code: "MEX", confederation: "CONCACAF", tier: 2 },

  // UEFA — 16 slots
  { name: "France",        code: "FRA", confederation: "UEFA", tier: 1 },
  { name: "England",       code: "ENG", confederation: "UEFA", tier: 1 },
  { name: "Spain",         code: "ESP", confederation: "UEFA", tier: 1 },
  { name: "Portugal",      code: "POR", confederation: "UEFA", tier: 1 },
  { name: "Germany",       code: "GER", confederation: "UEFA", tier: 1 },
  { name: "Italy",         code: "ITA", confederation: "UEFA", tier: 1 },
  { name: "Netherlands",   code: "NED", confederation: "UEFA", tier: 1 },
  { name: "Belgium",       code: "BEL", confederation: "UEFA", tier: 2 },
  { name: "Croatia",       code: "CRO", confederation: "UEFA", tier: 2 },
  { name: "Denmark",       code: "DEN", confederation: "UEFA", tier: 2 },
  { name: "Switzerland",   code: "SUI", confederation: "UEFA", tier: 2 },
  { name: "Austria",       code: "AUT", confederation: "UEFA", tier: 3 },
  { name: "Poland",        code: "POL", confederation: "UEFA", tier: 3 },
  { name: "Serbia",        code: "SRB", confederation: "UEFA", tier: 3 },
  { name: "Turkey",        code: "TUR", confederation: "UEFA", tier: 3 },
  { name: "Norway",        code: "NOR", confederation: "UEFA", tier: 3 },

  // CONMEBOL — 6 direct slots
  { name: "Brazil",        code: "BRA", confederation: "CONMEBOL", tier: 1 },
  { name: "Argentina",     code: "ARG", confederation: "CONMEBOL", tier: 1 },
  { name: "Uruguay",       code: "URU", confederation: "CONMEBOL", tier: 2 },
  { name: "Colombia",      code: "COL", confederation: "CONMEBOL", tier: 2 },
  { name: "Ecuador",       code: "ECU", confederation: "CONMEBOL", tier: 3 },
  { name: "Paraguay",      code: "PAR", confederation: "CONMEBOL", tier: 3 },

  // CONCACAF — 3 non-host slots
  { name: "Costa Rica",    code: "CRC", confederation: "CONCACAF", tier: 4 },
  { name: "Panama",        code: "PAN", confederation: "CONCACAF", tier: 4 },
  { name: "Jamaica",       code: "JAM", confederation: "CONCACAF", tier: 4 },

  // CAF — 9 slots
  { name: "Morocco",       code: "MAR", confederation: "CAF", tier: 2 },
  { name: "Senegal",       code: "SEN", confederation: "CAF", tier: 2 },
  { name: "Egypt",         code: "EGY", confederation: "CAF", tier: 3 },
  { name: "Algeria",       code: "ALG", confederation: "CAF", tier: 3 },
  { name: "Nigeria",       code: "NGA", confederation: "CAF", tier: 3 },
  { name: "Cameroon",      code: "CMR", confederation: "CAF", tier: 3 },
  { name: "Tunisia",       code: "TUN", confederation: "CAF", tier: 4 },
  { name: "Ghana",         code: "GHA", confederation: "CAF", tier: 4 },
  { name: "Ivory Coast",   code: "CIV", confederation: "CAF", tier: 4 },

  // AFC — 8 slots
  { name: "Japan",         code: "JPN", confederation: "AFC", tier: 2 },
  { name: "South Korea",   code: "KOR", confederation: "AFC", tier: 2 },
  { name: "Iran",          code: "IRN", confederation: "AFC", tier: 3 },
  { name: "Australia",     code: "AUS", confederation: "AFC", tier: 3 },
  { name: "Saudi Arabia",  code: "KSA", confederation: "AFC", tier: 4 },
  { name: "Qatar",         code: "QAT", confederation: "AFC", tier: 4 },
  { name: "Iraq",          code: "IRQ", confederation: "AFC", tier: 4 },
  { name: "Uzbekistan",    code: "UZB", confederation: "AFC", tier: 4 },

  // OFC — 1 slot
  { name: "New Zealand",   code: "NZL", confederation: "OFC", tier: 4 },

  // Inter-confederation playoff winners — 2 slots
  { name: "Bolivia",       code: "BOL", confederation: "CONMEBOL", tier: 4 },
  { name: "DR Congo",      code: "COD", confederation: "CAF",      tier: 4 },
];

// Country names in German — used when the UI locale is `de`.
export const NAMES_DE = {
  "United States": "USA",
  "Canada": "Kanada",
  "Mexico": "Mexiko",
  "France": "Frankreich",
  "England": "England",
  "Spain": "Spanien",
  "Portugal": "Portugal",
  "Germany": "Deutschland",
  "Italy": "Italien",
  "Netherlands": "Niederlande",
  "Belgium": "Belgien",
  "Croatia": "Kroatien",
  "Denmark": "Dänemark",
  "Switzerland": "Schweiz",
  "Austria": "Österreich",
  "Poland": "Polen",
  "Serbia": "Serbien",
  "Turkey": "Türkei",
  "Norway": "Norwegen",
  "Brazil": "Brasilien",
  "Argentina": "Argentinien",
  "Uruguay": "Uruguay",
  "Colombia": "Kolumbien",
  "Ecuador": "Ecuador",
  "Paraguay": "Paraguay",
  "Bolivia": "Bolivien",
  "Costa Rica": "Costa Rica",
  "Panama": "Panama",
  "Jamaica": "Jamaika",
  "Morocco": "Marokko",
  "Senegal": "Senegal",
  "Egypt": "Ägypten",
  "Algeria": "Algerien",
  "Nigeria": "Nigeria",
  "Cameroon": "Kamerun",
  "Tunisia": "Tunesien",
  "Ghana": "Ghana",
  "Ivory Coast": "Elfenbeinküste",
  "DR Congo": "DR Kongo",
  "Japan": "Japan",
  "South Korea": "Südkorea",
  "Iran": "Iran",
  "Australia": "Australien",
  "Saudi Arabia": "Saudi-Arabien",
  "Qatar": "Katar",
  "Iraq": "Irak",
  "Uzbekistan": "Usbekistan",
  "New Zealand": "Neuseeland",
};

// 12 groups of 4 — pot-balanced plausible draw. Codes must exist in TEAMS_2026.
export const GROUPS_2026 = {
  A: ["MEX", "GER", "MAR", "AUS"],
  B: ["CAN", "BEL", "ALG", "QAT"],
  C: ["USA", "POR", "EGY", "BOL"],
  D: ["FRA", "DEN", "NGA", "IRN"],
  E: ["ARG", "CRO", "SEN", "NZL"],
  F: ["BRA", "SUI", "CMR", "JPN"],
  G: ["ESP", "URU", "TUN", "KOR"],
  H: ["ENG", "COL", "GHA", "IRQ"],
  I: ["ITA", "ECU", "CIV", "PAN"],
  J: ["NED", "PAR", "COD", "KSA"],
  K: ["POR" /* placeholder fixed below */, "AUT", "SRB", "CRC"],
  L: ["TUR", "POL", "NOR", "UZB"],
};

// Patch group K — it had a duplicate POR by mistake during authoring;
// replace with Jamaica so each code appears exactly once.
GROUPS_2026.K[0] = "JAM";

// Demonyms / alternate spellings that should also reveal a hidden country.
// Lowercase keys, values match a `name` in TEAMS_2026.
export const DEMONYMS = {
  american: "United States", americans: "United States", yankee: "United States",
  canadian: "Canada", canadians: "Canada",
  mexican: "Mexico", mexicans: "Mexico", azteca: "Mexico",
  french: "France", francais: "France",
  english: "England", british: "England", brit: "England", brits: "England",
  spanish: "Spain", spaniard: "Spain", spaniards: "Spain", espana: "Spain",
  portuguese: "Portugal", luso: "Portugal",
  german: "Germany", germans: "Germany", deutsch: "Germany", deutschland: "Germany",
  italian: "Italy", italians: "Italy", azzurri: "Italy", italia: "Italy",
  dutch: "Netherlands", oranje: "Netherlands", holland: "Netherlands", hollander: "Netherlands",
  belgian: "Belgium", belgians: "Belgium",
  croatian: "Croatia", croat: "Croatia",
  danish: "Denmark", dane: "Denmark", danes: "Denmark",
  swiss: "Switzerland",
  austrian: "Austria",
  polish: "Poland", pole: "Poland", poles: "Poland",
  serbian: "Serbia", serb: "Serbia",
  turkish: "Turkey", turk: "Turkey", turks: "Turkey",
  norwegian: "Norway",
  brazilian: "Brazil", brazilians: "Brazil", brasil: "Brazil", samba: "Brazil", selecao: "Brazil",
  argentine: "Argentina", argentinian: "Argentina", argentines: "Argentina", albiceleste: "Argentina",
  uruguayan: "Uruguay", charrua: "Uruguay",
  colombian: "Colombia", colombians: "Colombia",
  ecuadorian: "Ecuador",
  paraguayan: "Paraguay",
  bolivian: "Bolivia",
  costarican: "Costa Rica", tico: "Costa Rica",
  panamanian: "Panama",
  jamaican: "Jamaica", reggae: "Jamaica",
  moroccan: "Morocco", atlas: "Morocco",
  senegalese: "Senegal", teranga: "Senegal",
  egyptian: "Egypt", pharaoh: "Egypt", pharaohs: "Egypt",
  algerian: "Algeria",
  nigerian: "Nigeria", naija: "Nigeria",
  cameroonian: "Cameroon",
  tunisian: "Tunisia",
  ghanaian: "Ghana",
  ivorian: "Ivory Coast",
  congolese: "DR Congo",
  japanese: "Japan", samurai: "Japan", nippon: "Japan",
  korean: "South Korea", koreans: "South Korea",
  iranian: "Iran", persian: "Iran", persians: "Iran",
  australian: "Australia", aussie: "Australia", socceroo: "Australia", socceroos: "Australia",
  saudi: "Saudi Arabia",
  qatari: "Qatar",
  iraqi: "Iraq",
  uzbek: "Uzbekistan",
  kiwi: "New Zealand", kiwis: "New Zealand",
};

export const WINNERS_1930_2022 = [
  { year: 1930, host: "Uruguay",       winner: "Uruguay",     runnerUp: "Argentina",    topScorer: "Guillermo Stábile" },
  { year: 1934, host: "Italy",         winner: "Italy",       runnerUp: "Czechoslovakia", topScorer: "Oldřich Nejedlý" },
  { year: 1938, host: "France",        winner: "Italy",       runnerUp: "Hungary",      topScorer: "Leônidas" },
  { year: 1950, host: "Brazil",        winner: "Uruguay",     runnerUp: "Brazil",       topScorer: "Ademir" },
  { year: 1954, host: "Switzerland",   winner: "Germany",     runnerUp: "Hungary",      topScorer: "Sándor Kocsis" },
  { year: 1958, host: "Sweden",        winner: "Brazil",      runnerUp: "Sweden",       topScorer: "Just Fontaine" },
  { year: 1962, host: "Chile",         winner: "Brazil",      runnerUp: "Czechoslovakia", topScorer: "Six players tied" },
  { year: 1966, host: "England",       winner: "England",     runnerUp: "Germany",      topScorer: "Eusébio" },
  { year: 1970, host: "Mexico",        winner: "Brazil",      runnerUp: "Italy",        topScorer: "Gerd Müller" },
  { year: 1974, host: "Germany",       winner: "Germany",     runnerUp: "Netherlands",  topScorer: "Grzegorz Lato" },
  { year: 1978, host: "Argentina",     winner: "Argentina",   runnerUp: "Netherlands",  topScorer: "Mario Kempes" },
  { year: 1982, host: "Spain",         winner: "Italy",       runnerUp: "Germany",      topScorer: "Paolo Rossi" },
  { year: 1986, host: "Mexico",        winner: "Argentina",   runnerUp: "Germany",      topScorer: "Gary Lineker" },
  { year: 1990, host: "Italy",         winner: "Germany",     runnerUp: "Argentina",    topScorer: "Salvatore Schillaci" },
  { year: 1994, host: "United States", winner: "Brazil",      runnerUp: "Italy",        topScorer: "Stoichkov / Salenko" },
  { year: 1998, host: "France",        winner: "France",      runnerUp: "Brazil",       topScorer: "Davor Šuker" },
  { year: 2002, host: "South Korea/Japan", winner: "Brazil",  runnerUp: "Germany",      topScorer: "Ronaldo" },
  { year: 2006, host: "Germany",       winner: "Italy",       runnerUp: "France",       topScorer: "Miroslav Klose" },
  { year: 2010, host: "South Africa",  winner: "Spain",       runnerUp: "Netherlands",  topScorer: "Thomas Müller" },
  { year: 2014, host: "Brazil",        winner: "Germany",     runnerUp: "Argentina",    topScorer: "James Rodríguez" },
  { year: 2018, host: "Russia",        winner: "France",      runnerUp: "Croatia",      topScorer: "Harry Kane" },
  { year: 2022, host: "Qatar",         winner: "Argentina",   runnerUp: "France",       topScorer: "Kylian Mbappé" },
];

function buildStats(finals) {
  const titles = {};
  let hostWins = 0;
  let europeWins = 0;
  let southAmericaWins = 0;
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
  return {
    titles,
    ranking,
    hostWins,
    totalTournaments: finals.length,
    europeWins,
    southAmericaWins,
  };
}

export const STATS = buildStats(WINNERS_1930_2022);

// UI strings — English + German.
export const I18N = {
  en: {
    title: "World Cup Oracle 2026",
    subtitle: "Paste a sentence or seed a name — the oracle reads hidden predictions for the 48-team field.",
    tabText: "Scan Text",
    tabSeed: "Personal Seed",
    textLabel: "Paste any text — tweet, headline, message",
    textPlaceholder: "Brazilian samba meets Argentine tango on a German autobahn...",
    seedLabel: "Enter a seed — name + birthday, lucky phrase, anything",
    seedPlaceholder: "Lionel 24-06-1987",
    decode: "Decode",
    decoding: "Decoding…",
    shortcutHint: "Tip: ⌘/Ctrl + Enter to decode",
    verdictLabel: "The Oracle reads",
    confidence: "confidence",
    copyReading: "Copy reading",
    copied: "Copied!",
    shareLink: "Share link",
    linkCopied: "Link copied!",
    sectionHidden: "Hidden Names",
    sectionNumerology: "Numerology",
    sectionGroups: "Group Stage",
    sectionBracket: "Knockout Bracket",
    sectionOmen: "Historical Omen",
    sectionStats: "96 Years of Statistics",
    hiddenNone: "No country names surfaced from the text. The signal is faint.",
    hiddenDirect: "Buried in plain sight",
    hiddenAcrostic: "Acrostic whispers",
    numerologyNone: "The text holds no letters to weigh.",
    numerologySum: (sum, letters) => `Letter sum: <strong>${sum}</strong> across ${letters} letters.`,
    numerologyLucky: "Lucky digit",
    numerologyPick: (name, conf, tier) => `Numerology points to <strong>${name}</strong> <span class="muted">(${conf}, tier ${tier})</span>.`,
    nudge: "Feed the oracle something — a sentence, a name, a date.",
    foot: "Deterministic readings · 96 years of finals baked in · for amusement, not for betting.",
    roundR32: "Round of 32",
    roundR16: "Round of 16",
    roundQF: "Quarter-finals",
    roundSF: "Semi-finals",
    roundFinal: "Final",
    champion: "Champion",
    titlesLeader: (nation, count) => `${nation} leads all nations with ${count} titles since 1930.`,
    championTitled: (name, count) => `Your champion <strong>${name}</strong> already has ${count} on the shelf.`,
    championUntitled: (name) => `Your champion <strong>${name}</strong> would be lifting their first trophy.`,
    hostNote: (hosts, total) => `${hosts} of ${total} tournaments have gone to a host nation.`,
    continental: (eu, sa) => `Europe ${eu} — South America ${sa} (rest of world: 0).`,
    omenEcho: (name, year, host, scorer) => `${name} last carried this glow in ${year}, lifting the trophy in ${host} with ${scorer} leading the scoring charts.`,
    omenParallel: (name, year, host, winner) => `No ${name} title in 96 years of finals — but the seed echoes ${year}, when ${winner} broke through in ${host}.`,
    groupHeader: (letter) => `Group ${letter}`,
    standingsCols: { team: "Team", pts: "Pts", gd: "GD" },
  },
  de: {
    title: "WM-Orakel 2026",
    subtitle: "Gib einen Satz oder einen persönlichen Seed ein — das Orakel liest versteckte Vorhersagen für die 48 Mannschaften.",
    tabText: "Text scannen",
    tabSeed: "Persönlicher Seed",
    textLabel: "Beliebigen Text einfügen — Tweet, Schlagzeile, Nachricht",
    textPlaceholder: "Brasilianischer Samba trifft argentinischen Tango auf einer deutschen Autobahn...",
    seedLabel: "Seed eingeben — Name + Geburtstag, Glücksspruch, alles",
    seedPlaceholder: "Lionel 24-06-1987",
    decode: "Entschlüsseln",
    decoding: "Entschlüssele…",
    shortcutHint: "Tipp: ⌘/Strg + Enter zum Entschlüsseln",
    verdictLabel: "Das Orakel verkündet",
    confidence: "Vertrauen",
    copyReading: "Deutung kopieren",
    copied: "Kopiert!",
    shareLink: "Link teilen",
    linkCopied: "Link kopiert!",
    sectionHidden: "Versteckte Namen",
    sectionNumerology: "Numerologie",
    sectionGroups: "Gruppenphase",
    sectionBracket: "K.-o.-Runde",
    sectionOmen: "Historisches Omen",
    sectionStats: "96 Jahre Statistik",
    hiddenNone: "Keine Ländernamen im Text gefunden. Das Signal ist schwach.",
    hiddenDirect: "Mitten im Text versteckt",
    hiddenAcrostic: "Akrostichon-Flüstern",
    numerologyNone: "Der Text enthält keine Buchstaben zum Wiegen.",
    numerologySum: (sum, letters) => `Buchstabensumme: <strong>${sum}</strong> über ${letters} Buchstaben.`,
    numerologyLucky: "Glückszahl",
    numerologyPick: (name, conf, tier) => `Numerologie deutet auf <strong>${name}</strong> <span class="muted">(${conf}, Stufe ${tier})</span>.`,
    nudge: "Füttere das Orakel mit etwas — ein Satz, ein Name, ein Datum.",
    foot: "Deterministische Deutungen · 96 Jahre Endspiele eingebaut · zur Unterhaltung, nicht zum Wetten.",
    roundR32: "Sechzehntelfinale",
    roundR16: "Achtelfinale",
    roundQF: "Viertelfinale",
    roundSF: "Halbfinale",
    roundFinal: "Finale",
    champion: "Weltmeister",
    titlesLeader: (nation, count) => `${nation} führt alle Nationen mit ${count} Titeln seit 1930.`,
    championTitled: (name, count) => `Dein Weltmeister <strong>${name}</strong> hat schon ${count} im Schrank.`,
    championUntitled: (name) => `Dein Weltmeister <strong>${name}</strong> würde den ersten Titel holen.`,
    hostNote: (hosts, total) => `${hosts} von ${total} Turnieren gingen an eine Gastgebernation.`,
    continental: (eu, sa) => `Europa ${eu} — Südamerika ${sa} (Rest der Welt: 0).`,
    omenEcho: (name, year, host, scorer) => `${name} trug diesen Glanz zuletzt ${year}, als sie in ${host} mit ${scorer} als Torschützenkönig den Pokal holten.`,
    omenParallel: (name, year, host, winner) => `Kein ${name}-Titel in 96 Jahren — doch der Seed klingt nach ${year}, als ${winner} in ${host} durchbrach.`,
    groupHeader: (letter) => `Gruppe ${letter}`,
    standingsCols: { team: "Team", pts: "Pkt", gd: "TD" },
  },
};
