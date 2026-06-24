// Tests of the POI quick targets (normalize + save/load locally).
import { test } from "node:test";
import assert from "node:assert/strict";

// Mini localStorage for Node (poi.js only uses get/set/Item).
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

const { DEFAULT_POIS, DEFAULT_SNAP_POIS, normalizePOIs, loadPOIs, savePOIs } = await import("../static/js/poi.js");

test("DEFAULT_POIS / DEFAULT_SNAP_POIS: nichtleere Suchbegriffe", () => {
  assert.ok(DEFAULT_POIS.length >= 3 && DEFAULT_SNAP_POIS.length >= 3);
  for (const p of [...DEFAULT_POIS, ...DEFAULT_SNAP_POIS]) {
    assert.ok(typeof p === "string" && p.trim(), `ungültig: ${JSON.stringify(p)}`);
  }
});

test("loadPOIs('snap'): eigene Liste, eigene Werkseinstellungen", () => {
  localStorage.removeItem("gc.poi.snap");
  const snap = loadPOIs("snap");
  assert.equal(snap.length, DEFAULT_SNAP_POIS.length);
  assert.ok(snap.some((p) => /hotel/i.test(p.query)));
});

test("quick und snap werden getrennt gespeichert", () => {
  savePOIs([{ query: "NurQuick" }], "quick");
  savePOIs([{ query: "NurSnap" }], "snap");
  assert.equal(loadPOIs("quick")[0].query, "NurQuick");
  assert.equal(loadPOIs("snap")[0].query, "NurSnap");
});

test("normalizePOIs: trimmt, vergibt ids, verwirft Leere; akzeptiert Strings + alte {label}", () => {
  const out = normalizePOIs([
    { query: "  Café " },
    { query: "" }, // discarded (empty)
    "Bahnhof", // plain string
    { id: "keep-1", label: "Apotheke" }, // old format (only label) → migrated to query
  ]);
  assert.deepEqual(
    out.map((p) => p.query),
    ["Café", "Bahnhof", "Apotheke"],
  );
  const ap = out.find((p) => p.query === "Apotheke");
  assert.equal(ap.id, "keep-1", "bestehende id bleibt erhalten");
  assert.ok(out[0].id, "fehlende id wird ergänzt");
});

test("normalizePOIs: enabled — Default true, explizit false bleibt, String aktiv", () => {
  const out = normalizePOIs([
    { query: "Hotel" }, // without flag → active
    { query: "Bahnhof", enabled: false }, // off
    "Pension", // string → active
  ]);
  assert.deepEqual(
    out.map((p) => [p.query, p.enabled]),
    [
      ["Hotel", true],
      ["Bahnhof", false],
      ["Pension", true],
    ],
  );
});

test("enabled überlebt save → load", () => {
  savePOIs([{ query: "Hotel", enabled: false }, { query: "Bahnhof", enabled: true }], "snap");
  const back = loadPOIs("snap");
  assert.equal(back.find((p) => p.query === "Hotel").enabled, false);
  assert.equal(back.find((p) => p.query === "Bahnhof").enabled, true);
});

test("normalizePOIs: kein Array → leere Liste", () => {
  assert.deepEqual(normalizePOIs(null), []);
  assert.deepEqual(normalizePOIs(undefined), []);
});

test("loadPOIs ohne Speicher → Werkseinstellungen", () => {
  localStorage.removeItem("gc.poi.categories");
  assert.equal(loadPOIs().length, DEFAULT_POIS.length);
});

test("save → load Rundlauf (nur nichtleere Einträge)", () => {
  savePOIs([{ query: "Eisdiele" }, { query: "" }]);
  const back = loadPOIs();
  assert.equal(back.length, 1);
  assert.equal(back[0].query, "Eisdiele");
});

test("leerer gespeicherter Stand fällt auf Werkseinstellungen zurück", () => {
  savePOIs([]); // normalizes to []
  assert.equal(loadPOIs().length, DEFAULT_POIS.length);
});
