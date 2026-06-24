// Routing via configurable providers (OSRM / OpenRouteService / BRouter),
// analogous to the iOS app. Returns route geometry (GeoJSON coordinates [lng,lat])
// + distance in meters. Pure ES module (browser); the pure request builders
// are testable in Node.
import { enrichWithElevation, DEFAULT_ELEVATION } from "gc/elevation";

export const DEFAULT_ROUTING = {
  provider: "osrm", // "osrm" | "ors" | "brouter"
  osrmBase: "https://router.project-osrm.org",
  osrmProfile: "driving", // public demo server only has "driving"
  orsBase: "https://api.openrouteservice.org",
  orsAuthMode: "key", // "key" (API key) | "basic" (user/password, e.g. own server behind a reverse proxy)
  orsKey: "",
  orsUser: "",
  orsPassword: "",
  orsProfile: "cycling-regular", // e.g. cycling-regular | foot-walking | driving-car
  brouterBase: "https://brouter.de",
  brouterProfile: "trekking", // e.g. trekking | fastbike | shortest
  // Elevation data service (for elevation profile/gain on routes planned on the PC).
  elevation: { ...DEFAULT_ELEVATION },
};

const trimUrl = (u) => String(u || "").replace(/\/+$/, "");
const lngLat = (p) => `${p.longitude},${p.latitude}`;

// --- Pure request builders (no network → testable) ----------------------------

export function buildOsrmUrl(cfg, points) {
  const coords = points.map(lngLat).join(";");
  return `${trimUrl(cfg.osrmBase)}/route/v1/${cfg.osrmProfile}/${coords}?overview=full&geometries=geojson`;
}

export function buildBrouterUrl(cfg, points) {
  const lonlats = points.map(lngLat).join("|");
  return `${trimUrl(cfg.brouterBase)}/brouter?lonlats=${lonlats}&profile=${encodeURIComponent(cfg.brouterProfile)}&alternativeidx=0&format=geojson`;
}

/** base64 (browser: btoa, Node tests: Buffer fallback). */
function base64(s) {
  if (typeof btoa === "function") return btoa(s);
  return Buffer.from(s, "binary").toString("base64");
}

export function buildOrsRequest(cfg, points) {
  const headers = { "Content-Type": "application/json" };
  // Authentication: API key (public ORS) OR Basic auth (own
  // server, e.g. behind a reverse proxy with user/password).
  if (cfg.orsAuthMode === "basic" && (cfg.orsUser || cfg.orsPassword)) {
    headers.Authorization = `Basic ${base64(`${cfg.orsUser || ""}:${cfg.orsPassword || ""}`)}`;
  } else if (cfg.orsKey) {
    headers.Authorization = cfg.orsKey;
  }
  return {
    url: `${trimUrl(cfg.orsBase)}/v2/directions/${cfg.orsProfile}/geojson`,
    headers,
    // Deliberately WITHOUT elevation=true: a self-hosted ORS server without
    // elevation data would otherwise respond with an error. Elevation comes
    // uniformly via the elevation service (enrichWithElevation in route()).
    body: { coordinates: points.map((p) => [p.longitude, p.latitude]) },
  };
}

// --- Execution ------------------------------------------------------------

/**
 * Routes through `points` (≥2 waypoints with latitude/longitude).
 * @returns {Promise<null|{coordinates:number[][], distanceMeters:(number|null)}>}
 */
export async function route(cfg, points) {
  if (!points || points.length < 2) return null;
  try {
    let raw = null; // { coordinates, distanceMeters } from the provider
    if (cfg.provider === "ors") {
      const { url, headers, body } = buildOrsRequest(cfg, points);
      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      if (!res.ok) return null;
      const feat = (await res.json())?.features?.[0];
      if (feat) raw = { coordinates: feat.geometry.coordinates, distanceMeters: feat.properties?.summary?.distance ?? null };
    } else if (cfg.provider === "brouter") {
      const res = await fetch(buildBrouterUrl(cfg, points));
      if (!res.ok) return null;
      const feat = (await res.json())?.features?.[0];
      const len = feat?.properties?.["track-length"];
      if (feat) raw = { coordinates: feat.geometry.coordinates, distanceMeters: len != null ? Number(len) : null };
    } else {
      // Default: OSRM
      const res = await fetch(buildOsrmUrl(cfg, points));
      if (!res.ok) return null;
      const r = (await res.json())?.routes?.[0];
      if (r) raw = { coordinates: r.geometry.coordinates, distanceMeters: r.distance ?? null };
    }
    if (!raw) return null;
    // Load elevation (if enabled and not already delivered by the provider) → [lng,lat,ele].
    const coordinates = await enrichWithElevation(raw.coordinates, cfg.elevation);
    return { coordinates, distanceMeters: raw.distanceMeters };
  } catch {
    return null;
  }
}

// --- Configuration (localStorage) ------------------------------------------

const STORE_KEY = "gc.routing";

export function loadRoutingConfig() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? { ...DEFAULT_ROUTING, ...JSON.parse(raw) } : { ...DEFAULT_ROUTING };
  } catch {
    return { ...DEFAULT_ROUTING };
  }
}

export function saveRoutingConfig(cfg) {
  localStorage.setItem(STORE_KEY, JSON.stringify(cfg));
}
