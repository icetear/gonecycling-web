import { test } from "node:test";
import assert from "node:assert/strict";

import { destinationPoint, roundTripWaypoints } from "../static/js/roundtrip.js";
import { haversineMeters } from "../static/js/autoplan.js";

test("destinationPoint liegt ~Distanz vom Ausgangspunkt entfernt", () => {
  const p = destinationPoint([8.5, 52.0], 1000, 90);
  assert.ok(Math.abs(haversineMeters([8.5, 52.0], p) - 1000) < 5);
});

test("roundTripWaypoints: Start = Ende, points+2 Einträge, ~Radius", () => {
  const center = [8.5, 52.0];
  const wps = roundTripWaypoints(center, 20000, 4);
  assert.equal(wps.length, 6); // start + 4 ring points + back to start
  assert.deepEqual(wps[0], center);
  assert.deepEqual(wps[wps.length - 1], center);
  const radius = 20000 / (2 * Math.PI);
  for (let i = 1; i <= 4; i++) {
    assert.ok(Math.abs(haversineMeters(center, wps[i]) - radius) < radius * 0.02);
  }
});
