// Geocoding via Nominatim (OpenStreetMap) — naming waypoints (reverse) and
// searching places (forward).
//
// Nominatim usage policy: fair use, max ~1 request/second, no bulk queries.
// For production, consider your own/commercial geocoder.
// (In the browser no User-Agent can be set; the page's Referer suffices.)
const NOMINATIM = "https://nominatim.openstreetmap.org";

/**
 * Picks a concise, sensible place name from a Nominatim result.
 * Pure function (no network) → unit-testable.
 */
export function pickName(result) {
  if (!result) return null;
  const a = result.address || {};
  const place =
    a.city || a.town || a.village || a.hamlet || a.municipality || a.suburb || a.county;
  if (place) return place;
  if (result.name) return result.name;
  if (result.display_name) return result.display_name.split(",")[0].trim();
  return null;
}

/**
 * Title for a **search hit/POI**: here the actual object name matters
 * (e.g. „Hotel Krone"), NOT the place. So first `result.name`, then the first
 * part of `display_name` (Nominatim puts the feature name first), and only
 * lastly the locality. Pure function → unit-testable.
 * (Unlike `pickName`, which deliberately prefers the place for reverse geocoding.)
 */
export function pickPoiName(result) {
  if (!result) return null;
  if (result.name) return result.name;
  if (result.display_name) {
    const first = result.display_name.split(",")[0].trim();
    if (first) return first;
  }
  const a = result.address || {};
  return a.city || a.town || a.village || a.hamlet || a.municipality || a.suburb || a.county || null;
}

/** Coordinate → place name (or null on error/offline). */
export async function reverseGeocode(lat, lon) {
  const url = `${NOMINATIM}/reverse?format=jsonv2&zoom=14&addressdetails=1&lat=${lat}&lon=${lon}`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return pickName(await res.json());
  } catch {
    return null;
  }
}

/** Raw Nominatim hits → compact result { name, displayName, lat, lon }. */
function mapResults(arr) {
  return (arr || []).map((r) => ({
    name: pickPoiName(r) || r.display_name, // search hit → object/POI name, not the place
    displayName: r.display_name,
    lat: Number(r.lat),
    lon: Number(r.lon),
    osmCategory: r.category, // Nominatim jsonv2: OSM key, e.g. "tourism"
    osmType: r.type, // OSM value, e.g. "hotel", "guest_house", "camp_site"
  }));
}

/** Fetches + maps a Nominatim /search URL (or [] on error/offline). */
async function fetchSearch(url) {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    return mapResults(await res.json());
  } catch {
    return [];
  }
}

/** Place search → list { name, displayName, lat, lon } (max `limit`). */
export async function searchPlaces(query, limit = 5) {
  const q = (query || "").trim();
  if (!q) return [];
  return fetchSearch(`${NOMINATIM}/search?format=jsonv2&addressdetails=1&limit=${limit}&q=${encodeURIComponent(q)}`);
}

/**
 * Place search **around a point** ([lng, lat]) using Nominatim's `viewbox`.
 *
 * Two modes (parameter `bounded`):
 *  - `bounded: false` (default) → the box is only **preferred** (bias), distant
 *    hits still appear. For the general place search, so that e.g. „Bayreuth"
 *    is found from Bielefeld, but local hits rank at the top.
 *  - `bounded: true` → **strictly** limited to the box. For POI quick targets
 *    („café/supermarket/gas station nearby"), which only want nearby hits.
 *
 * Examples:
 *   searchNear("Bayreuth", [8.53, 52.03])                 → finds Bayreuth (bias)
 *   searchNear("Café",     [8.53, 52.03], 8, {bounded:true}) → cafés around the point
 *
 * @param {string} query             search term
 * @param {[number,number]} center   [lng, lat] of the centre
 * @param {number} limit             max. hits
 * @param {{bounded?: boolean, radiusDeg?: number}} opts
 *        bounded   strictly limit (true) or only prefer (false)
 *        radiusDeg half the box edge length in degrees (~0.06° ≈ 6–7 km)
 */
export async function searchNear(query, center, limit = 8, { bounded = false, radiusDeg = 0.06 } = {}) {
  const q = (query || "").trim();
  if (!q) return [];
  const lng = center && center[0];
  const lat = center && center[1];
  if (typeof lng !== "number" || typeof lat !== "number") return searchPlaces(q, limit);
  // viewbox = two corner points as lon,lat (x1,y1,x2,y2); bounded=1 limits strictly,
  // without bounded the box only acts as a ranking preference.
  const vb = `${lng - radiusDeg},${lat - radiusDeg},${lng + radiusDeg},${lat + radiusDeg}`;
  const boundedParam = bounded ? "&bounded=1" : "";
  return fetchSearch(
    `${NOMINATIM}/search?format=jsonv2&addressdetails=1&limit=${limit}${boundedParam}&viewbox=${vb}&q=${encodeURIComponent(q)}`,
  );
}
