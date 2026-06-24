import { test } from "node:test";
import assert from "node:assert/strict";

import { sampleIndices, enrichWithElevation } from "../static/js/elevation.js";

test("sampleIndices: gleichmäßig, inkl. erstem/letztem, ≤ max", () => {
  assert.deepEqual(sampleIndices(3, 10), [0, 1, 2]); // n ≤ max → all
  assert.deepEqual(sampleIndices(10, 4), [0, 3, 6, 9]);
  const s = sampleIndices(1000, 100);
  assert.equal(s.length <= 100, true);
  assert.equal(s[0], 0);
  assert.equal(s[s.length - 1], 999);
});

const coords2d = [
  [8.0, 50.0],
  [8.1, 50.1],
  [8.2, 50.2],
];

test("enrichWithElevation: deaktiviert → unverändert", async () => {
  const out = await enrichWithElevation(coords2d, { enabled: false });
  assert.equal(out, coords2d);
});

test("enrichWithElevation: bereits 3D → unverändert (kein Netzaufruf)", async () => {
  const c3 = coords2d.map((p, i) => [p[0], p[1], 100 + i]);
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return { ok: true, json: async () => ({}) };
  };
  const out = await enrichWithElevation(c3, {});
  assert.equal(out, c3);
  assert.equal(called, false);
});

test("enrichWithElevation: hängt Höhe an (interpoliert) bei Erfolg", async () => {
  // Support points = all 3 (n ≤ maxPoints) → elevations 100/150/300 directly.
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ results: [{ elevation: 100 }, { elevation: 150 }, { elevation: 300 }] }),
  });
  const out = await enrichWithElevation(coords2d, { maxPoints: 100 });
  assert.deepEqual(
    out.map((p) => p[2]),
    [100, 150, 300],
  );
  // lng/lat unchanged
  assert.equal(out[0][0], 8.0);
  assert.equal(out[2][1], 50.2);
});

test("enrichWithElevation: Fehler/leere Antwort → 2D unverändert", async () => {
  globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });
  assert.equal(await enrichWithElevation(coords2d, {}), coords2d);
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  assert.equal(await enrichWithElevation(coords2d, {}), coords2d);
});
