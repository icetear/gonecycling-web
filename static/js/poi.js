// Predefined POI categories for two purposes (each editable, stored locally):
//   kind "quick" → map quick-targets (tap on the map → search nearby),
//                  e.g. Café/Supermarkt/Tankstelle.
//   kind "snap"  → stage targets of the guided planner ("Nächste Etappe"):
//                  snap points where a stage can end — Hotel, Bahnhof,
//                  Ferienwohnung … (port of iOS autoPlanPOITypes).
//
// A category is { id, query, enabled }: `query` is the Nominatim search term
// (also the label), `enabled` toggles it on/off without deleting it.

const STORE_KEYS = { quick: "gc.poi.categories", snap: "gc.poi.snap" };

/** Factory defaults for map quick-targets (supply POIs). */
export const DEFAULT_POIS = [
  "Café",
  "Supermarkt",
  "Tankstelle",
  "Restaurant",
  "Hotel",
  "Bäckerei",
  "Apotheke",
  "Fahrradladen",
  "Campingplatz",
];

/** Factory defaults for stage targets (lodging/transport) for the guided planner. */
export const DEFAULT_SNAP_POIS = ["Hotel", "Bahnhof", "Ferienwohnung", "Pension", "Jugendherberge", "Campingplatz"];

const DEFAULTS = { quick: DEFAULT_POIS, snap: DEFAULT_SNAP_POIS };

// Simple counter for IDs (no crypto needed; only has to be unique within the
// list). Deliberately without Math.random so the logic stays deterministic
// (and unit-testable).
let _seq = 0;
function newId() {
  _seq += 1;
  return `poi-${_seq}`;
}

/**
 * Cleans up a POI list: only entries with a non-empty search term are kept,
 * each gets an id (existing ones are preserved) and an `enabled` flag
 * (default true; only an explicit `false` disables → old entries without the
 * flag stay active). Accepts plain strings as well as older entries with
 * `label` (migration → `query`). Pure function → testable.
 */
export function normalizePOIs(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((p) => {
      const obj = p && typeof p === "object";
      // String directly; otherwise prefer query, migrate old format with label.
      const raw = typeof p === "string" ? p : (obj && (p.query || p.label)) || "";
      return {
        id: obj && p.id ? String(p.id) : newId(),
        query: String(raw).trim(),
        enabled: obj && p.enabled === false ? false : true,
      };
    })
    .filter((p) => p.query);
}

/** Default categories of a list as fresh, active entries with IDs. */
function defaults(kind) {
  return (DEFAULTS[kind] || DEFAULT_POIS).map((query) => ({ id: newId(), query, enabled: true }));
}

/** Loads the maintained POI list `kind` ("quick" | "snap") or the factory defaults. */
export function loadPOIs(kind = "quick") {
  const key = STORE_KEYS[kind] || STORE_KEYS.quick;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return defaults(kind);
    const list = normalizePOIs(JSON.parse(raw));
    return list.length ? list : defaults(kind);
  } catch {
    return defaults(kind);
  }
}

/** Saves the (cleaned-up) POI list `kind` locally. */
export function savePOIs(list, kind = "quick") {
  const key = STORE_KEYS[kind] || STORE_KEYS.quick;
  try {
    localStorage.setItem(key, JSON.stringify(normalizePOIs(list)));
  } catch (err) {
    console.error("localStorage (pois) failed:", err);
  }
}
