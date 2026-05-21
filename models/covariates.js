// Per-match covariates: travel distance, time-zone shift, rest-day
// differential, and climate mismatch. Returns an additive offset on
// the log-goal-rate (log λ) scale, per Report 2's specification:
//
//   Δlog λ = β_d · (distance_km/1000) + β_tz · |Δtz|
//          + β_rest · rest_days_diff + β_climate · climate_mismatch
//
// The β coefficients are informative priors taken from the deep-research
// reports' literature review; they are NOT posterior-estimated against
// our 372-match WM-only backtest (which lacks per-match metadata
// before 2026). Documented as such in METHODOLOGY.md.

import { VENUES_2026 } from "../data/venues-2026.js";
import { TEAM_BASES } from "../data/team-bases.js";

export const COVARIATE_COEFS = {
  travel:  -0.030,  // per 1000 km
  timezone: -0.015, // per hour of |Δtz|
  rest:     0.020, // per extra rest day (favours rested team)
  climate: -0.040, // per "mismatch unit" (Δ°C / 5 + Δhumidity / 25 → unit ≈ 1)
};

const EARTH_KM = 6371;
const deg = (d) => (d * Math.PI) / 180;

export function haversineKm(latA, lonA, latB, lonB) {
  const dLat = deg(latB - latA);
  const dLon = deg(lonB - lonA);
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos(deg(latA)) * Math.cos(deg(latB)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(a));
}

export function climateMismatch(teamCode, venueId) {
  const base = TEAM_BASES[teamCode];
  const venue = VENUES_2026[venueId];
  if (!base || !venue) return 0;
  const tempDelta = Math.abs((base.tempC ?? 22) - (venue.tempC ?? 22)) / 5;
  const humDelta  = Math.abs((base.humidity ?? 65) - (venue.humidity ?? 65)) / 25;
  return tempDelta + humDelta;
}

// Per-team Δlog-λ for one fixture. `restDays` is the team's rest-days
// since its previous match (or a sensible default if first match).
// `oppRestDays` lets us compute the differential as `rest - oppRest`.
export function teamCovariateOffset(team, opponent, venueId, restDays, oppRestDays, coefs = COVARIATE_COEFS) {
  const base = TEAM_BASES[team];
  const venue = VENUES_2026[venueId];
  if (!base || !venue) return 0;
  const distance = haversineKm(base.lat, base.lon, venue.lat, venue.lon) / 1000;
  const tzShift = Math.abs((base.tzOffset ?? 0) - (venue.tzOffset ?? 0));
  const restDiff = (restDays ?? 4) - (oppRestDays ?? 4);
  const climate = climateMismatch(team, venueId);
  return (
    coefs.travel  * distance +
    coefs.timezone * tzShift +
    coefs.rest    * restDiff +
    coefs.climate * climate
  );
}

// Convenience: compute the asymmetric (A, B) offsets for one match.
export function matchOffsets(teamA, teamB, venueId, restA = 4, restB = 4, coefs = COVARIATE_COEFS) {
  return {
    a: teamCovariateOffset(teamA, teamB, venueId, restA, restB, coefs),
    b: teamCovariateOffset(teamB, teamA, venueId, restB, restA, coefs),
  };
}

// Sanity helper for the UI: print human-readable covariate breakdown.
export function explainCovariates(team, venueId, restDays, oppRestDays, coefs = COVARIATE_COEFS) {
  const base = TEAM_BASES[team];
  const venue = VENUES_2026[venueId];
  if (!base || !venue) return null;
  const distance = haversineKm(base.lat, base.lon, venue.lat, venue.lon);
  const tzShift = Math.abs((base.tzOffset ?? 0) - (venue.tzOffset ?? 0));
  const restDiff = (restDays ?? 4) - (oppRestDays ?? 4);
  const climate = climateMismatch(team, venueId);
  return {
    travelKm: Math.round(distance),
    tzShiftH: tzShift,
    restDayDiff: restDiff,
    climateMismatch: +climate.toFixed(2),
    deltaLogLambda: +(
      coefs.travel * (distance / 1000) +
      coefs.timezone * tzShift +
      coefs.rest * restDiff +
      coefs.climate * climate
    ).toFixed(3),
  };
}
