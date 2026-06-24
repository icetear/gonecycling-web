// Rough travel-time estimate for stages/rides: flat-terrain speed per transport mode
// plus an elevation-gain surcharge (Naismith-style). Only a guideline, not an exact ETA.

// Average speed in km/h (flat terrain).
const SPEED_KMH = {
  cycling: 16,
  eBike: 20,
  eScooter: 18,
  hiking: 4.5,
  skateboard: 12,
  car: 60,
  motorcycle: 70,
};
// Climb rate (elevation meters/hour) for the time surcharge; motorized without.
const CLIMB_MH = {
  cycling: 500,
  eBike: 700,
  eScooter: 500,
  hiking: 600,
  skateboard: 400,
};

/**
 * Estimated travel time in seconds from distance + elevation gain + transport mode.
 * Example: 16 km by bike ≈ 1 h; +500 m of climb ≈ +1 h.
 */
export function estimateRideSeconds(distanceMeters, gainMeters = 0, mode = "cycling") {
  if (!(distanceMeters > 0)) return 0;
  const v = SPEED_KMH[mode] || SPEED_KMH.cycling;
  let hours = distanceMeters / 1000 / v;
  const climb = CLIMB_MH[mode]; // undefined for car/motorcycle → no elevation surcharge
  if (climb && gainMeters > 0) hours += gainMeters / climb;
  return Math.round(hours * 3600);
}

/** Seconds → "1 h 30 min" / "45 min" / "2 h". */
export function formatDuration(seconds) {
  const totalMin = Math.round((seconds || 0) / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  return `${m} min`;
}
