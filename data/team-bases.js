// Approximate home-base for each of the 48 qualifiers.
// Used to compute travel distance, time-zone shift, and climate mismatch
// for the covariates layer. Hand-curated from public sources: capital
// city latitude/longitude (decimal degrees) and standard time UTC offset
// (without summer-time adjustment, since the tournament runs in NH summer
// where DST applies consistently).

export const TEAM_BASES = {
  // CONCACAF hosts
  USA: { city: "Washington D.C.", lat: 38.90, lon: -77.04, tzOffset: -5, tempC: 27, humidity: 70 },
  CAN: { city: "Ottawa",          lat: 45.42, lon: -75.70, tzOffset: -5, tempC: 22, humidity: 65 },
  MEX: { city: "Mexico City",     lat: 19.43, lon: -99.13, tzOffset: -6, tempC: 24, humidity: 67 },
  // UEFA
  ESP: { city: "Madrid",          lat: 40.42, lon: -3.70,  tzOffset:  1, tempC: 31, humidity: 40 },
  FRA: { city: "Paris",           lat: 48.86, lon:  2.35,  tzOffset:  1, tempC: 23, humidity: 65 },
  ENG: { city: "London",          lat: 51.51, lon: -0.13,  tzOffset:  0, tempC: 22, humidity: 70 },
  POR: { city: "Lisbon",          lat: 38.72, lon: -9.14,  tzOffset:  0, tempC: 26, humidity: 65 },
  GER: { city: "Berlin",          lat: 52.52, lon: 13.41,  tzOffset:  1, tempC: 23, humidity: 65 },
  NED: { city: "Amsterdam",       lat: 52.37, lon:  4.90,  tzOffset:  1, tempC: 22, humidity: 70 },
  BEL: { city: "Brussels",        lat: 50.85, lon:  4.35,  tzOffset:  1, tempC: 22, humidity: 70 },
  CRO: { city: "Zagreb",          lat: 45.81, lon: 15.98,  tzOffset:  1, tempC: 26, humidity: 65 },
  SUI: { city: "Bern",            lat: 46.95, lon:  7.45,  tzOffset:  1, tempC: 22, humidity: 70 },
  AUT: { city: "Vienna",          lat: 48.21, lon: 16.37,  tzOffset:  1, tempC: 24, humidity: 65 },
  TUR: { city: "Ankara",          lat: 39.92, lon: 32.85,  tzOffset:  3, tempC: 28, humidity: 50 },
  NOR: { city: "Oslo",            lat: 59.91, lon: 10.75,  tzOffset:  1, tempC: 20, humidity: 70 },
  SWE: { city: "Stockholm",       lat: 59.33, lon: 18.07,  tzOffset:  1, tempC: 21, humidity: 70 },
  SCO: { city: "Edinburgh",       lat: 55.95, lon: -3.19,  tzOffset:  0, tempC: 18, humidity: 75 },
  BIH: { city: "Sarajevo",        lat: 43.86, lon: 18.41,  tzOffset:  1, tempC: 25, humidity: 65 },
  CZE: { city: "Prague",          lat: 50.08, lon: 14.44,  tzOffset:  1, tempC: 23, humidity: 65 },
  // CONMEBOL
  ARG: { city: "Buenos Aires",    lat: -34.61, lon: -58.38, tzOffset: -3, tempC: 14, humidity: 75 },
  BRA: { city: "Brasília",        lat: -15.79, lon: -47.88, tzOffset: -3, tempC: 25, humidity: 60 },
  COL: { city: "Bogotá",          lat:  4.71,  lon: -74.07, tzOffset: -5, tempC: 19, humidity: 75 },
  URU: { city: "Montevideo",      lat: -34.90, lon: -56.16, tzOffset: -3, tempC: 14, humidity: 75 },
  ECU: { city: "Quito",           lat: -0.18,  lon: -78.47, tzOffset: -5, tempC: 19, humidity: 75 },
  PAR: { city: "Asunción",        lat: -25.27, lon: -57.58, tzOffset: -4, tempC: 21, humidity: 75 },
  // CAF
  MAR: { city: "Rabat",           lat: 34.02, lon: -6.83,  tzOffset:  1, tempC: 26, humidity: 65 },
  SEN: { city: "Dakar",           lat: 14.69, lon: -17.45, tzOffset:  0, tempC: 29, humidity: 75 },
  EGY: { city: "Cairo",           lat: 30.04, lon: 31.24,  tzOffset:  2, tempC: 34, humidity: 50 },
  ALG: { city: "Algiers",         lat: 36.75, lon:  3.05,  tzOffset:  1, tempC: 29, humidity: 70 },
  TUN: { city: "Tunis",           lat: 36.81, lon: 10.18,  tzOffset:  1, tempC: 31, humidity: 65 },
  CIV: { city: "Yamoussoukro",    lat:  6.83, lon: -5.29,  tzOffset:  0, tempC: 28, humidity: 80 },
  GHA: { city: "Accra",           lat:  5.60, lon: -0.20,  tzOffset:  0, tempC: 27, humidity: 80 },
  COD: { city: "Kinshasa",        lat: -4.32, lon: 15.31,  tzOffset:  1, tempC: 27, humidity: 75 },
  RSA: { city: "Pretoria",        lat: -25.75, lon: 28.19, tzOffset:  2, tempC: 18, humidity: 50 },
  CPV: { city: "Praia",           lat: 14.93, lon: -23.51, tzOffset: -1, tempC: 26, humidity: 75 },
  // AFC
  JPN: { city: "Tokyo",           lat: 35.68, lon: 139.69, tzOffset:  9, tempC: 27, humidity: 75 },
  KOR: { city: "Seoul",           lat: 37.57, lon: 126.98, tzOffset:  9, tempC: 26, humidity: 70 },
  IRN: { city: "Tehran",          lat: 35.69, lon: 51.42,  tzOffset: 3.5, tempC: 33, humidity: 35 },
  AUS: { city: "Canberra",        lat: -35.28, lon: 149.13, tzOffset: 10, tempC: 12, humidity: 70 },
  KSA: { city: "Riyadh",          lat: 24.71, lon: 46.68,  tzOffset:  3, tempC: 42, humidity: 25 },
  QAT: { city: "Doha",            lat: 25.29, lon: 51.53,  tzOffset:  3, tempC: 38, humidity: 60 },
  IRQ: { city: "Baghdad",         lat: 33.31, lon: 44.36,  tzOffset:  3, tempC: 42, humidity: 25 },
  UZB: { city: "Tashkent",        lat: 41.30, lon: 69.24,  tzOffset:  5, tempC: 33, humidity: 40 },
  JOR: { city: "Amman",           lat: 31.95, lon: 35.93,  tzOffset:  3, tempC: 30, humidity: 50 },
  // OFC
  NZL: { city: "Wellington",      lat: -41.29, lon: 174.78, tzOffset: 12, tempC: 11, humidity: 75 },
  // CONCACAF non-host
  PAN: { city: "Panama City",     lat:  8.98, lon: -79.52, tzOffset: -5, tempC: 28, humidity: 80 },
  CUW: { city: "Willemstad",      lat: 12.11, lon: -68.93, tzOffset: -4, tempC: 30, humidity: 75 },
  HAI: { city: "Port-au-Prince",  lat: 18.59, lon: -72.30, tzOffset: -5, tempC: 31, humidity: 75 },
};
