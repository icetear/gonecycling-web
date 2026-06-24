import { test } from "node:test";
import assert from "node:assert/strict";

import { estimateRideSeconds, formatDuration } from "../static/js/ridetime.js";

test("estimateRideSeconds: Tempo + Höhen-Zuschlag", () => {
  assert.equal(estimateRideSeconds(16000, 0, "cycling"), 3600); // 16 km / 16 km/h = 1 h
  assert.equal(estimateRideSeconds(16000, 500, "cycling"), 7200); // + 500 hm / 500 m/h = +1 h
  assert.equal(estimateRideSeconds(60000, 1000, "car"), 3600); // motorized: no elevation surcharge
  assert.equal(estimateRideSeconds(0, 100, "cycling"), 0);
  // unknown transport mode → default cycling
  assert.equal(estimateRideSeconds(16000, 0, "unicorn"), 3600);
});

test("formatDuration", () => {
  assert.equal(formatDuration(3600), "1 h");
  assert.equal(formatDuration(5400), "1 h 30 min");
  assert.equal(formatDuration(600), "10 min");
  assert.equal(formatDuration(0), "0 min");
});
