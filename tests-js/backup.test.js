// Tests of the full backup (build export bundle, import, merge/replace).
import { test } from "node:test";
import assert from "node:assert/strict";

// Mini localStorage for Node (backup.js → routing.js/poi.js use get/set/Item).
class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
}
globalThis.localStorage = new MemoryStorage();

const { makeTrip } = await import("../static/js/trips.js");
const { makeRide } = await import("../static/js/rides.js");
const { buildBackup, applyBackup, isBackup } = await import("../static/js/backup.js");

/** Minimal store stub: holds an array + counts touch() calls. */
function stubStore(key, items) {
  return { [key]: items, touched: 0, touch() { this.touched += 1; } };
}

test("buildBackup: Struktur + Inhalte + Einstellungen", () => {
  const trips = stubStore("trips", [makeTrip({ title: "Nordsee" })]);
  const rides = stubStore("rides", [makeRide({ title: "Hausrunde" })]);
  const b = buildBackup(trips, rides, "2026-06-20T10:00:00.000Z");
  assert.equal(b.kind, "backup");
  assert.equal(b.version, 1);
  assert.equal(b.exportedAt, "2026-06-20T10:00:00.000Z");
  assert.equal(b.trips.length, 1);
  assert.equal(b.rides.length, 1);
  assert.ok(b.settings.routing && Array.isArray(b.settings.pois));
  assert.ok(isBackup(b));
});

test("isBackup: weist Fremdformate ab", () => {
  assert.equal(isBackup(null), false);
  assert.equal(isBackup({ kind: "other", trips: [], rides: [] }), false);
  assert.equal(isBackup({ kind: "backup", trips: [] }), false); // rides missing
});

test("applyBackup (merge): vereinigt nach id, Backup gewinnt bei Kollision", () => {
  const keep = makeTrip({ title: "Behalten" });
  const existingShared = makeTrip({ title: "Alt" });
  const trips = stubStore("trips", [keep, existingShared]);
  const rides = stubStore("rides", []);

  const incomingShared = { ...existingShared, title: "Neu (aus Backup)" };
  const backup = buildBackup(
    stubStore("trips", [incomingShared, makeTrip({ title: "Extra" })]),
    stubStore("rides", [makeRide({ title: "Importierte Tour" })]),
    "x",
  );

  const res = applyBackup(backup, trips, rides, { merge: true });
  assert.equal(res.trips, 2);
  assert.equal(res.rides, 1);
  assert.equal(trips.trips.length, 3); // keep + shared(1) + extra
  const shared = trips.trips.find((t) => t.id === existingShared.id);
  assert.equal(shared.title, "Neu (aus Backup)"); // Backup wins
  assert.equal(rides.rides.length, 1);
  assert.ok(trips.touched >= 1 && rides.touched >= 1);
});

test("applyBackup (replace): ersetzt den Bestand vollständig", () => {
  const trips = stubStore("trips", [makeTrip({ title: "Wird ersetzt" })]);
  const rides = stubStore("rides", [makeRide({ title: "Wird ersetzt" })]);
  const backup = buildBackup(stubStore("trips", [makeTrip({ title: "Einziger" })]), stubStore("rides", []), "x");

  applyBackup(backup, trips, rides, { merge: false });
  assert.equal(trips.trips.length, 1);
  assert.equal(trips.trips[0].title, "Einziger");
  assert.equal(rides.rides.length, 0);
});

test("applyBackup: ungültiges Objekt wirft", () => {
  assert.throws(() => applyBackup({ foo: 1 }, stubStore("trips", []), stubStore("rides", []), {}), /backup/i);
});
