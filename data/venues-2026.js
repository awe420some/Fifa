// 16 host venues for the 2026 FIFA World Cup.
// Sources: Wikipedia "2026 FIFA World Cup#Venues" (fetched 2026-05-20),
// FIFA official venue pages, NOAA climate normals (June-July) for each city.
//
// Climate normals are average daily maximum temperature (°C) and average
// relative humidity (%) for June 11 – July 19 of the tournament window.

export const VENUES_2026 = {
  AZTECA:     { city: "Mexico City",    country: "MEX", lat: 19.30, lon: -99.15, tzOffset: -6, tempC: 24, humidity: 67, altitudeM: 2240 },
  BBVA:       { city: "Monterrey",      country: "MEX", lat: 25.67, lon: -100.32, tzOffset: -6, tempC: 34, humidity: 60, altitudeM: 537 },
  AKRON:      { city: "Guadalajara",    country: "MEX", lat: 20.68, lon: -103.46, tzOffset: -6, tempC: 27, humidity: 65, altitudeM: 1566 },
  BC_PLACE:   { city: "Vancouver",      country: "CAN", lat: 49.28, lon: -123.11, tzOffset: -7, tempC: 22, humidity: 70, altitudeM: 1 },
  BMO:        { city: "Toronto",        country: "CAN", lat: 43.63, lon: -79.42, tzOffset: -4, tempC: 27, humidity: 65, altitudeM: 76 },
  METLIFE:    { city: "New York/New Jersey", country: "USA", lat: 40.81, lon: -74.07, tzOffset: -4, tempC: 29, humidity: 67, altitudeM: 2 },
  GILLETTE:   { city: "Boston",         country: "USA", lat: 42.09, lon: -71.26, tzOffset: -4, tempC: 27, humidity: 65, altitudeM: 19 },
  LINCOLN:    { city: "Philadelphia",   country: "USA", lat: 39.90, lon: -75.17, tzOffset: -4, tempC: 30, humidity: 65, altitudeM: 12 },
  MERCEDES:   { city: "Atlanta",        country: "USA", lat: 33.76, lon: -84.40, tzOffset: -4, tempC: 32, humidity: 70, altitudeM: 320 },
  HARD_ROCK:  { city: "Miami",          country: "USA", lat: 25.96, lon: -80.24, tzOffset: -4, tempC: 32, humidity: 76, altitudeM: 2 },
  ARROWHEAD:  { city: "Kansas City",    country: "USA", lat: 39.05, lon: -94.48, tzOffset: -5, tempC: 31, humidity: 68, altitudeM: 274 },
  NRG:        { city: "Houston",        country: "USA", lat: 29.68, lon: -95.41, tzOffset: -5, tempC: 33, humidity: 73, altitudeM: 14 },
  AT_T:       { city: "Dallas",         country: "USA", lat: 32.75, lon: -97.09, tzOffset: -5, tempC: 33, humidity: 65, altitudeM: 183 },
  LEVIS:      { city: "San Francisco Bay", country: "USA", lat: 37.40, lon: -121.97, tzOffset: -7, tempC: 24, humidity: 65, altitudeM: 4 },
  LUMEN:      { city: "Seattle",        country: "USA", lat: 47.59, lon: -122.33, tzOffset: -7, tempC: 23, humidity: 64, altitudeM: 9 },
  SOFI:       { city: "Los Angeles",    country: "USA", lat: 33.95, lon: -118.34, tzOffset: -7, tempC: 27, humidity: 70, altitudeM: 8 },
};
