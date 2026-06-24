import { test } from "node:test";
import assert from "node:assert/strict";

import { elevationGain, rideStats, rideStatsByMode } from "../static/js/ridestats.js";

const ride = (dist, alts, mode = "cycling") => ({
  totalDistanceMeters: dist,
  transportMode: mode,
  samples: alts.map((a) => ({ altitude: a })),
});

test("elevationGain summiert nur Anstiege", () => {
  assert.equal(elevationGain([{ altitude: 100 }, { altitude: 120 }, { altitude: 110 }, { altitude: 130 }]), 40);
});

test("rideStats aggregiert Anzahl/Distanz/Höhenmeter", () => {
  const s = rideStats([ride(1000, [0, 10]), ride(2000, [5, 0, 15])]);
  assert.equal(s.count, 2);
  assert.equal(s.distanceMeters, 3000);
  assert.equal(s.elevationGainMeters, 25); // +10 and (+15, -5 ignored)
});

test("rideStatsByMode gruppiert nach Transportmittel", () => {
  const g = rideStatsByMode([ride(1000, [0], "cycling"), ride(500, [0], "hiking")]);
  assert.equal(g.cycling.distanceMeters, 1000);
  assert.equal(g.hiking.distanceMeters, 500);
});
