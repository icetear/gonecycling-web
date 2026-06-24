// Elevations for route points via a configurable service (default: OpenTopoData,
// keyless). This makes the elevation profile + gain work for routes planned on the
// PC too — OSRM provides no elevation (ORS with elevation=true and BRouter do;
// then nothing is fetched here). Graceful: on error/shutdown the coordinates stay
// 2D and the planner works unchanged.

export const DEFAULT_ELEVATION = {
  enabled: true,
  // OpenTopoData (public): GET ?locations=lat,lng|lat,lng → {results:[{elevation}]}
  url: "https://api.opentopodata.org/v1/srtm90m",
  maxPoints: 100, // OpenTopoData allows 100 points/request
};

/**
 * Evenly distributed sample-point indices over `n` points (at most `max`,
 * incl. first and last). Example: sampleIndices(10, 4) → [0, 3, 6, 9].
 */
export function sampleIndices(n, max) {
  if (n <= 0) return [];
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const m = Math.max(2, max);
  const out = [];
  for (let k = 0; k < m; k++) out.push(Math.round((k * (n - 1)) / (m - 1)));
  return [...new Set(out)];
}

/** Linear interpolation of the elevation at original index `i` from the sample points. */
function interp(idx, elev, i) {
  if (i <= idx[0]) return elev[0];
  if (i >= idx[idx.length - 1]) return elev[elev.length - 1];
  let k = 1;
  while (k < idx.length && idx[k] < i) k++;
  const i0 = idx[k - 1];
  const i1 = idx[k];
  const t = (i - i0) / (i1 - i0);
  return elev[k - 1] + t * (elev[k] - elev[k - 1]);
}

/**
 * Enriches `coords` ([lng,lat]) with elevation → [lng,lat,ele]. Queries only
 * sample points (≤ maxPoints) at the elevation service and interpolates linearly
 * onto all points. If the coordinates are already 3D (the provider supplied
 * elevation) or the service is disabled/unreachable, the original coordinates
 * are returned.
 */
export async function enrichWithElevation(coords, cfg = {}) {
  const c = { ...DEFAULT_ELEVATION, ...cfg };
  if (!c.enabled || !Array.isArray(coords) || coords.length < 2) return coords;
  if (coords.every((p) => typeof p[2] === "number")) return coords; // already 3D
  try {
    const idx = sampleIndices(coords.length, Math.max(2, c.maxPoints || 100));
    const locs = idx.map((i) => `${coords[i][1].toFixed(6)},${coords[i][0].toFixed(6)}`).join("|");
    const res = await fetch(`${String(c.url).replace(/\/+$/, "")}?locations=${locs}`);
    if (!res.ok) return coords;
    const data = await res.json();
    const elev = Array.isArray(data && data.results) ? data.results.map((r) => r && r.elevation) : [];
    if (elev.length !== idx.length || elev.some((e) => typeof e !== "number")) return coords;
    return coords.map((p, i) => [p[0], p[1], interp(idx, elev, i)]);
  } catch {
    return coords;
  }
}
