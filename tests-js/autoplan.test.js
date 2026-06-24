// Tests of the auto-stage geometry (Haversine + route splitting), no network.
import { test } from "node:test";
import assert from "node:assert/strict";

import { haversineMeters, nearestIndex, routeLength, splitRoute, splitRouteByDistance, splitRouteIntoCount } from "../static/js/autoplan.js";

// Straight line along the equator (lat=0) from lng 0 to 1.0, finely sampled.
const equator = [];
for (let i = 0; i <= 10; i++) equator.push([i / 10, 0]);
const totalLen = routeLength(equator); // ≈ 111 195 m

test("haversineMeters: 1° am Äquator ≈ 111,2 km", () => {
  const d = haversineMeters([0, 0], [1, 0]);
  assert.ok(Math.abs(d - 111195) < 80, `erwartet ~111195, war ${d}`);
});

test("routeLength summiert die Segmente", () => {
  assert.ok(Math.abs(totalLen - 111195) < 200);
});

test("splitRouteByDistance: alle 30 km → 3 Schnittpunkte", () => {
  const splits = splitRouteByDistance(equator, 30000);
  assert.equal(splits.length, 3);
  // on the line (lat≈0), monotonically increasing length
  for (const s of splits) assert.ok(Math.abs(s[1]) < 1e-6);
  assert.ok(splits[0][0] < splits[1][0] && splits[1][0] < splits[2][0]);
});

test("splitRouteIntoCount(3) → 2 Schnittpunkte (3 Etappen)", () => {
  assert.equal(splitRouteIntoCount(equator, 3).length, 2);
});

test("Randfälle: zu wenige Punkte / count ≤ 1", () => {
  assert.deepEqual(splitRouteByDistance([[0, 0]], 1000), []);
  assert.deepEqual(splitRouteIntoCount(equator, 1), []);
});

test("nearestIndex findet den nächstgelegenen Punkt", () => {
  assert.equal(nearestIndex(equator, [0.31, 0]), 3); // ~0.3 → index 3
  assert.equal(nearestIndex(equator, [0.99, 0]), 10); // near the end
  assert.equal(nearestIndex(equator, [-1, 0]), 0); // before the start → index 0
});

test("splitRoute: Punkte + lückenlos zusammenhängende Segmente", () => {
  const { points, segments } = splitRoute(equator, 30000);
  assert.equal(points.length, 3);
  assert.equal(segments.length, 4);
  // each segment starts at the end point of the previous one
  for (let i = 1; i < segments.length; i++) {
    assert.deepEqual(segments[i][0], segments[i - 1][segments[i - 1].length - 1]);
  }
  // sum of the segment lengths ≈ total length
  const sum = segments.reduce((acc, s) => acc + routeLength(s), 0);
  assert.ok(Math.abs(sum - totalLen) < 1);
});
