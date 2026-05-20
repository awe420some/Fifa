// World Cup Oracle — static datasets

export const TEAMS_2026 = [
  // Hosts
  { name: "United States", code: "USA", confederation: "CONCACAF", tier: 2 },
  { name: "Canada",        code: "CAN", confederation: "CONCACAF", tier: 3 },
  { name: "Mexico",        code: "MEX", confederation: "CONCACAF", tier: 2 },

  // UEFA — Europe
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
  { name: "Ukraine",       code: "UKR", confederation: "UEFA", tier: 3 },
  { name: "Norway",        code: "NOR", confederation: "UEFA", tier: 3 },

  // CONMEBOL — South America
  { name: "Brazil",        code: "BRA", confederation: "CONMEBOL", tier: 1 },
  { name: "Argentina",     code: "ARG", confederation: "CONMEBOL", tier: 1 },
  { name: "Uruguay",       code: "URU", confederation: "CONMEBOL", tier: 2 },
  { name: "Colombia",      code: "COL", confederation: "CONMEBOL", tier: 2 },
  { name: "Ecuador",       code: "ECU", confederation: "CONMEBOL", tier: 3 },
  { name: "Paraguay",      code: "PAR", confederation: "CONMEBOL", tier: 3 },

  // CONCACAF — North/Central America
  { name: "Costa Rica",    code: "CRC", confederation: "CONCACAF", tier: 4 },
  { name: "Panama",        code: "PAN", confederation: "CONCACAF", tier: 4 },
  { name: "Jamaica",       code: "JAM", confederation: "CONCACAF", tier: 4 },

  // CAF — Africa
  { name: "Morocco",       code: "MAR", confederation: "CAF", tier: 2 },
  { name: "Senegal",       code: "SEN", confederation: "CAF", tier: 2 },
  { name: "Egypt",         code: "EGY", confederation: "CAF", tier: 3 },
  { name: "Algeria",       code: "ALG", confederation: "CAF", tier: 3 },
  { name: "Nigeria",       code: "NGA", confederation: "CAF", tier: 3 },
  { name: "Cameroon",      code: "CMR", confederation: "CAF", tier: 3 },
  { name: "Tunisia",       code: "TUN", confederation: "CAF", tier: 4 },
  { name: "Ghana",         code: "GHA", confederation: "CAF", tier: 4 },
  { name: "Ivory Coast",   code: "CIV", confederation: "CAF", tier: 4 },

  // AFC — Asia
  { name: "Japan",         code: "JPN", confederation: "AFC", tier: 2 },
  { name: "South Korea",   code: "KOR", confederation: "AFC", tier: 2 },
  { name: "Iran",          code: "IRN", confederation: "AFC", tier: 3 },
  { name: "Australia",     code: "AUS", confederation: "AFC", tier: 3 },
  { name: "Saudi Arabia",  code: "KSA", confederation: "AFC", tier: 4 },
  { name: "Qatar",         code: "QAT", confederation: "AFC", tier: 4 },
  { name: "Iraq",          code: "IRQ", confederation: "AFC", tier: 4 },
  { name: "Uzbekistan",    code: "UZB", confederation: "AFC", tier: 4 },

  // OFC — Oceania
  { name: "New Zealand",   code: "NZL", confederation: "OFC", tier: 4 },
];

// 22 past finals — winners since the first World Cup in 1930.
// 1942 and 1946 were cancelled due to WWII.
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
  ukrainian: "Ukraine",
  norwegian: "Norway",
  brazilian: "Brazil", brazilians: "Brazil", brasil: "Brazil", samba: "Brazil", selecao: "Brazil",
  argentine: "Argentina", argentinian: "Argentina", argentines: "Argentina", albiceleste: "Argentina",
  uruguayan: "Uruguay", charrua: "Uruguay",
  colombian: "Colombia", colombians: "Colombia",
  ecuadorian: "Ecuador",
  paraguayan: "Paraguay",
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
