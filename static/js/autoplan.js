// Auto stage planning: split a routed track into stages — by target distance
// or by count. Pure geometry functions (no network), hence testable in Node.
// Coordinates are consistently [lng, lat] (GeoJSON).

const EARTH_RADIUS_M = 6371000;
const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance of two [lng,lat] points in metres (haversine). */
export function haversineMeters(a, b) {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Total length of a polyline in metres. */
export function routeLength(coords) {
  let sum = 0;
  for (let i = 1; i < coords.length; i++) sum += haversineMeters(coords[i - 1], coords[i]);
  return sum;
}

/** Index of the `coords` point nearest to `point` ([lng,lat]). */
export function nearestIndex(coords, point) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = haversineMeters(coords[i], point);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * Splits the track every `targetMeters` and returns both the boundary points
 * (cut points without start/destination) and the partial polylines (segments,
 * each incl. their endpoints). A final stage that is too short (< 30 % of the
 * target distance) is merged with the second-to-last one.
 *
 * @returns {{ points: number[][], segments: number[][][] }}
 */
export function splitRoute(coords, targetMeters) {
  if (!coords || coords.length < 2 || targetMeters <= 0) {
    return { points: [], segments: coords && coords.length >= 2 ? [coords.slice()] : [] };
  }
  const total = routeLength(coords);
  const points = [];
  const segments = [];
  let current = [coords[0]];
  let acc = 0;
  let threshold = targetMeters;

  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const segLen = haversineMeters(a, b);
    while (segLen > 0 && acc + segLen >= threshold && threshold < total) {
      const t = (threshold - acc) / segLen;
      const cut = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      current.push(cut);
      segments.push(current);
      points.push(cut);
      current = [cut];
      threshold += targetMeters;
    }
    current.push(b);
    acc += segLen;
  }
  segments.push(current);

  if (points.length && segments.length >= 2) {
    const last = segments[segments.length - 1];
    if (routeLength(last) < targetMeters * 0.3) {
      segments.pop();
      points.pop();
      segments[segments.length - 1].push(...last.slice(1)); // append at the shared cut
    }
  }
  return { points, segments };
}

/** Only the cut points (without start/destination) — every `targetMeters`. */
export function splitRouteByDistance(coords, targetMeters) {
  return splitRoute(coords, targetMeters).points;
}

/** Only the cut points for `count` stages of as-equal-as-possible length (count ≥ 1). */
export function splitRouteIntoCount(coords, count) {
  if (!coords || coords.length < 2 || count <= 1) return [];
  return splitRoute(coords, routeLength(coords) / count).points;
}

/** Partial polylines for `count` stages (for per-stage routes). */
export function segmentsIntoCount(coords, count) {
  if (!coords || coords.length < 2) return [];
  if (count <= 1) return [coords.slice()];
  return splitRoute(coords, routeLength(coords) / count).segments;
}
