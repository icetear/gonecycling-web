// Full backup: export all trips, tours/routes AND settings (routing + POIs)
// into a single JSON file, or restore them. The trip/route data is serialized
// in the **same** (Swift-compatible) format as the sync (tripsToArray/
// ridesToArray) — so an export can also be reused for the iPhone app, and the
// sync covers trips/rides continuously anyway. This bundle is the manual
// backup/handover.
import { tripsToArray, tripsFromArray } from "gc/trips";
import { ridesToArray, ridesFromArray } from "gc/rides";
import { loadRoutingConfig, saveRoutingConfig } from "gc/routing";
import { loadPOIs, savePOIs } from "gc/poi";

export const BACKUP_VERSION = 1;

/** Unions two lists by id; on collision `incoming` (the backup) wins. */
function unionById(existing, incoming) {
  const byId = new Map();
  for (const x of existing) byId.set(x.id, x);
  for (const x of incoming) byId.set(x.id, x);
  return [...byId.values()];
}

/**
 * Builds the backup object from the (loaded) stores + settings.
 * `nowISO` is passed in so the function stays pure/testable.
 */
export function buildBackup(tripsStore, ridesStore, nowISO = "") {
  return {
    app: "GoneCycling",
    kind: "backup",
    version: BACKUP_VERSION,
    exportedAt: nowISO,
    trips: tripsToArray(tripsStore.trips),
    rides: ridesToArray(ridesStore.rides),
    settings: { routing: loadRoutingConfig(), pois: loadPOIs("quick"), snapPois: loadPOIs("snap") },
  };
}

/** Checks whether `obj` is a plausible GoneCycling backup. */
export function isBackup(obj) {
  return !!(obj && obj.kind === "backup" && Array.isArray(obj.trips) && Array.isArray(obj.rides));
}

/**
 * Restores a backup.
 *  - merge=true  → union with existing data (backup wins on equal id)
 *  - merge=false → replace existing data completely
 * Settings (routing/POIs) are adopted if present in the backup.
 * Returns a small tally { trips, rides }.
 */
export function applyBackup(obj, tripsStore, ridesStore, { merge = true } = {}) {
  if (!isBackup(obj)) throw new Error("Not a valid GoneCycling backup.");

  const importedTrips = tripsFromArray(obj.trips);
  const importedRides = ridesFromArray(obj.rides);

  tripsStore.trips = merge ? unionById(tripsStore.trips, importedTrips) : importedTrips;
  ridesStore.rides = merge ? unionById(ridesStore.rides, importedRides) : importedRides;

  if (obj.settings && typeof obj.settings === "object") {
    if (obj.settings.routing) saveRoutingConfig(obj.settings.routing);
    if (Array.isArray(obj.settings.pois)) savePOIs(obj.settings.pois, "quick");
    if (Array.isArray(obj.settings.snapPois)) savePOIs(obj.settings.snapPois, "snap");
  }

  // touch(): save locally + refresh the UI + (if connected) upload.
  tripsStore.touch();
  ridesStore.touch();
  return { trips: importedTrips.length, rides: importedRides.length };
}
