// Statistics over rides (RideSession). Pure functions (no network/DOM), testable.

/** Sum of the positive elevation differences along the samples (elevation gain in meters). */
export function elevationGain(samples) {
  let gain = 0;
  for (let i = 1; i < (samples?.length || 0); i++) {
    const d = (samples[i].altitude || 0) - (samples[i - 1].altitude || 0);
    if (d > 0) gain += d;
  }
  return gain;
}

/**
 * Aggregates a list of rides into { count, distanceMeters, elevationGainMeters }.
 */
export function rideStats(rides) {
  let count = 0;
  let distanceMeters = 0;
  let elevationGainMeters = 0;
  for (const r of rides || []) {
    count += 1;
    distanceMeters += r.totalDistanceMeters || 0;
    elevationGainMeters += elevationGain(r.samples);
  }
  return { count, distanceMeters, elevationGainMeters };
}

/** Statistics grouped by transport mode: { mode: {count,distanceMeters,…} }. */
export function rideStatsByMode(rides) {
  const groups = {};
  for (const r of rides || []) {
    const mode = r.transportMode || "cycling";
    (groups[mode] ||= []).push(r);
  }
  const out = {};
  for (const [mode, list] of Object.entries(groups)) out[mode] = rideStats(list);
  return out;
}
