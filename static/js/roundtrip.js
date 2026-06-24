// Round-trip waypoints: generate an approximate round trip from a start point +
// target distance (waypoints on a circle around the start). Pure geometry,
// testable. Coordinates are [lng, lat]. The real route is created afterwards via
// the routing provider (perimeter ≈ target distance, since roads are longer).

const EARTH_RADIUS_M = 6371000;

/** Destination point `distM` meters at `bearingDeg` from `[lng,lat]` (great circle). */
export function destinationPoint([lng, lat], distM, bearingDeg) {
  const br = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const dr = distM / EARTH_RADIUS_M;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dr) + Math.cos(lat1) * Math.sin(dr) * Math.cos(br));
  const lng2 = lng1 + Math.atan2(Math.sin(br) * Math.sin(dr) * Math.cos(lat1), Math.cos(dr) - Math.sin(lat1) * Math.sin(lat2));
  return [(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
}

/**
 * Waypoints for a round trip: start → `points` points evenly on a
 * circle (radius chosen so the circumference ≈ target distance) → back to the
 * start. A random initial rotation provides variety.
 * @returns {number[][]} [[lng,lat], …] beginning and ending at the start.
 */
export function roundTripWaypoints(center, targetMeters, points = 4, rotationDeg = 0) {
  const radius = targetMeters / (2 * Math.PI);
  const ring = [];
  for (let i = 0; i < points; i++) {
    ring.push(destinationPoint(center, radius, rotationDeg + (i * 360) / points));
  }
  return [center, ...ring, center];
}
