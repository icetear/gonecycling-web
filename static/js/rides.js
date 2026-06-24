// RideSession model of the web app — minimal, interop-compatible port from iOS
// (RideSession.swift / CoordinateSample.swift) for per-stage persisted
// routes in the "rides" namespace. Pure ES module, Swift-JSONEncoder-compatible
// (Dates = 2001-reference double, UUID uppercase, Enum rawValue, nil omitted).

const SWIFT_EPOCH_OFFSET = 978307200;
const dateToSwift = (d) => (d instanceof Date ? d.getTime() : new Date(d).getTime()) / 1000 - SWIFT_EPOCH_OFFSET;
const swiftToDate = (v) => new Date((v + SWIFT_EPOCH_OFFSET) * 1000);
const newId = () => globalThis.crypto.randomUUID().toUpperCase();

// --- Factory ---------------------------------------------------------------

export function makeSample(p) {
  return {
    id: p.id ?? newId(),
    latitude: p.latitude,
    longitude: p.longitude,
    timestamp: p.timestamp ?? new Date(),
    horizontalAccuracy: p.horizontalAccuracy ?? 0,
    altitude: p.altitude ?? 0,
    speed: p.speed ?? 0,
    course: p.course ?? 0,
  };
}

export function makeRide(p = {}) {
  return {
    id: p.id ?? newId(),
    startedAt: p.startedAt ?? new Date(),
    endedAt: p.endedAt ?? null,
    samples: p.samples ?? [],
    totalDistanceMeters: p.totalDistanceMeters ?? 0,
    title: p.title ?? "",
    kind: p.kind ?? "planned",
    transportMode: p.transportMode ?? "cycling",
    rating: p.rating ?? null, // 1…5 or null
    notes: p.notes ?? null,
    tags: p.tags ?? null, // [String] or null
    // Unknown iOS fields (photoFileNames/regionSummary/battery…) are
    // passed through losslessly (interop), see `_extra`.
    _extra: p._extra ?? {},
  };
}

// Fields the web explicitly models; everything else goes into `_extra`.
const KNOWN_RIDE_KEYS = new Set([
  "id", "startedAt", "endedAt", "samples", "totalDistanceMeters",
  "title", "kind", "transportMode", "rating", "notes", "tags",
]);

function extraOf(obj) {
  const extra = {};
  for (const key of Object.keys(obj)) {
    if (!KNOWN_RIDE_KEYS.has(key)) extra[key] = obj[key];
  }
  return extra;
}

// --- Serialization (CoordinateSample: all fields mandatory) ----------------

function sampleToJSON(s) {
  return {
    id: s.id,
    latitude: s.latitude,
    longitude: s.longitude,
    timestamp: dateToSwift(s.timestamp),
    horizontalAccuracy: s.horizontalAccuracy,
    altitude: s.altitude,
    speed: s.speed,
    course: s.course,
  };
}

function sampleFromJSON(o) {
  return {
    id: o.id,
    latitude: o.latitude,
    longitude: o.longitude,
    timestamp: o.timestamp != null ? swiftToDate(o.timestamp) : new Date(),
    horizontalAccuracy: o.horizontalAccuracy ?? 0,
    altitude: o.altitude ?? 0,
    speed: o.speed ?? 0,
    course: o.course ?? 0,
  };
}

export function rideToJSON(r) {
  // Unknown fields first, so the known ones override them (interop).
  const o = { ...(r._extra || {}) };
  o.id = r.id;
  o.startedAt = dateToSwift(r.startedAt);
  o.samples = r.samples.map(sampleToJSON);
  o.totalDistanceMeters = r.totalDistanceMeters;
  o.title = r.title;
  o.kind = r.kind;
  if (r.endedAt != null) o.endedAt = dateToSwift(r.endedAt);
  if (r.transportMode != null) o.transportMode = r.transportMode;
  if (r.rating != null) o.rating = r.rating;
  if (r.notes != null && r.notes !== "") o.notes = r.notes;
  if (r.tags != null && r.tags.length) o.tags = r.tags;
  return o;
}

export function rideFromJSON(o) {
  return {
    id: o.id,
    startedAt: o.startedAt != null ? swiftToDate(o.startedAt) : new Date(),
    endedAt: o.endedAt != null ? swiftToDate(o.endedAt) : null,
    samples: (o.samples ?? []).map(sampleFromJSON),
    totalDistanceMeters: o.totalDistanceMeters ?? 0,
    title: o.title ?? "",
    kind: o.kind ?? "planned",
    transportMode: o.transportMode ?? "cycling",
    rating: o.rating ?? null,
    notes: o.notes ?? null,
    tags: o.tags ?? null,
    _extra: extraOf(o),
  };
}

export function ridesToArray(rides) {
  return rides.map(rideToJSON);
}
export function ridesFromArray(arr) {
  return (arr ?? []).map(rideFromJSON);
}

/**
 * Builds a **planned** RideSession from a route geometry (coords
 * [lng,lat]). Timestamps advance second by second from `startedAt`, only so
 * they are strictly monotonic (planned routes have no real times) — exactly
 * like the iOS "Route berechnen" (calculate route) path does.
 */
export function plannedRideFromCoords(coords, opts = {}) {
  const { title = "", distanceMeters = 0, transportMode = "cycling" } = opts;
  const base = opts.startedAt instanceof Date ? opts.startedAt : new Date();
  const samples = coords.map((c, i) =>
    makeSample({
      latitude: c[1],
      longitude: c[0],
      timestamp: new Date(base.getTime() + i * 1000),
      horizontalAccuracy: 0,
      // 3rd coordinate element = elevation (from routing or the elevation service), otherwise 0.
      altitude: typeof c[2] === "number" ? c[2] : 0,
      speed: 0,
      course: 0,
    }),
  );
  return makeRide({ startedAt: base, samples, totalDistanceMeters: distanceMeters, title, kind: "planned", transportMode });
}
