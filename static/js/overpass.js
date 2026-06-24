// Supply POIs along a route via the Overpass API (keyless). Builds the
// query (testable) and fetches hits in the corridor around the thinned-out route. Graceful:
// on error/empty → empty array.

// Multiple Overpass endpoints: the public main server is often overloaded
// (504/timeout) → on error the next one is tried.
export const SUPPLY_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

// Display per category (amenity/shop) as an emoji.
export const SUPPLY_ICONS = {
  drinking_water: "🚰",
  cafe: "☕",
  restaurant: "🍽",
  fast_food: "🍔",
  pharmacy: "💊",
  fuel: "⛽",
  supermarket: "🛒",
  convenience: "🏪",
  bakery: "🥐",
  bicycle: "🚲",
};

/** Evenly distributed sample-point indices (≤ max), including first/last. */
export function sampleIdx(n, max) {
  if (n <= 0) return [];
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const m = Math.max(2, max);
  const out = [];
  for (let k = 0; k < m; k++) out.push(Math.round((k * (n - 1)) / (m - 1)));
  return [...new Set(out)];
}

/** Overpass-QL: supply within the `radius` corridor (meters) around the [lat,lon] points. */
export function buildSupplyQuery(latlons, radius = 250) {
  const around = latlons.map(([lat, lon]) => `${lat.toFixed(5)},${lon.toFixed(5)}`).join(",");
  return `[out:json][timeout:25];
(
  nwr(around:${radius},${around})["amenity"~"^(drinking_water|cafe|restaurant|fast_food|pharmacy|fuel)$"];
  nwr(around:${radius},${around})["shop"~"^(supermarket|convenience|bakery|bicycle)$"];
);
out center 120;`;
}

/**
 * Supply POIs along the route (`samples` with latitude/longitude).
 * Tries multiple Overpass endpoints with a timeout.
 * @returns {Promise<null|Array<{name,lat,lon,category,icon}>>}
 *   `null` = no endpoint reachable; `[]` = reachable, but nothing found.
 */
export async function supplyAlongRoute(samples, { url, urls, radius = 300, maxPoints = 30, timeoutMs = 30000 } = {}) {
  if (!Array.isArray(samples) || samples.length < 2) return [];
  const endpoints = url ? [url] : urls || SUPPLY_URLS;
  const idx = sampleIdx(samples.length, maxPoints);
  const latlons = idx.map((i) => [samples[i].latitude, samples[i].longitude]);
  const body = "data=" + encodeURIComponent(buildSupplyQuery(latlons, radius));
  for (const ep of endpoints) {
    try {
      const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
      const res = await fetch(ep, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: ctrl ? ctrl.signal : undefined,
      });
      if (timer) clearTimeout(timer);
      if (!res.ok) continue; // overloaded/error → next endpoint
      const data = await res.json();
      const out = [];
      for (const el of (data && data.elements) || []) {
        const lat = el.lat != null ? el.lat : el.center && el.center.lat;
        const lon = el.lon != null ? el.lon : el.center && el.center.lon;
        if (lat == null || lon == null) continue;
        const cat = (el.tags && (el.tags.amenity || el.tags.shop)) || "";
        out.push({ name: (el.tags && el.tags.name) || "", lat, lon, category: cat, icon: SUPPLY_ICONS[cat] || "📍" });
      }
      return out; // success (even if empty)
    } catch {
      // timeout/network error → next endpoint
    }
  }
  return null; // all endpoints failed
}

/**
 * Overpass-QL: places (city/town/village) WITH a population tag within the
 * `radius` (meters) around lat/lon. Forcing `["population"]` returns only places
 * with a known population — matching "largest cities with population".
 */
export function buildCitiesQuery(lat, lon, radius = 40000) {
  return `[out:json][timeout:25];
node["place"~"^(city|town|village)$"]["population"](around:${radius},${lat.toFixed(5)},${lon.toFixed(5)});
out 200;`;
}

/**
 * Parses Overpass `elements` into places and sorts by population descending
 * (largest first). Robust number detection: "10.000"/"10,000"/"approx 5000" →
 * digits only. Removes name duplicates (highest population wins) and returns at
 * most `limit` hits.
 * @returns {Array<{name,population,lat,lon,place}>}
 */
export function parseCities(elements, limit = 10) {
  const seen = new Set();
  return ((elements || []))
    .map((el) => {
      const tags = el.tags || {};
      const lat = el.lat != null ? el.lat : el.center && el.center.lat;
      const lon = el.lon != null ? el.lon : el.center && el.center.lon;
      const pop = parseInt(String(tags.population || "").replace(/[^\d]/g, ""), 10);
      return {
        name: (tags.name || "").trim(),
        place: tags.place || "",
        population: Number.isFinite(pop) ? pop : null,
        lat,
        lon,
      };
    })
    .filter((c) => c.name && c.lat != null && c.lon != null)
    .sort((a, b) => (b.population || 0) - (a.population || 0))
    .filter((c) => {
      const k = c.name.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, limit);
}

/**
 * Fetches the largest places (with population) around a center `[lon, lat]`
 * (same mirror/timeout strategy as supplyAlongRoute).
 * @returns {Promise<null|Array<{name,population,lat,lon,place}>>}
 *   `null` = no endpoint reachable; `[]` = reachable, but nothing found.
 */
export async function largestCities(center, { url, urls, radius = 40000, limit = 10, timeoutMs = 20000 } = {}) {
  if (!Array.isArray(center) || center.length < 2) return [];
  const endpoints = url ? [url] : urls || SUPPLY_URLS;
  const [lon, lat] = center;
  const body = "data=" + encodeURIComponent(buildCitiesQuery(lat, lon, radius));
  for (const ep of endpoints) {
    try {
      const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
      const res = await fetch(ep, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: ctrl ? ctrl.signal : undefined,
      });
      if (timer) clearTimeout(timer);
      if (!res.ok) continue; // overloaded/error → next endpoint
      const data = await res.json();
      return parseCities(data && data.elements, limit);
    } catch {
      // timeout/network error → next endpoint
    }
  }
  return null; // all endpoints failed
}
