// Tests of the RideSession model (static/js/rides.js): building from geometry +
// Swift-compatible serialization + iOS interop.
import { test } from "node:test";
import assert from "node:assert/strict";

import * as R from "../static/js/rides.js";

const coords = [
  [8.5, 52.0],
  [8.6, 52.0],
  [8.7, 52.0],
];

test("plannedRideFromCoords: [lng,lat]→lat/lng, kind planned, monotone Zeit", () => {
  const ride = R.plannedRideFromCoords(coords, { title: "A – B", distanceMeters: 1234 });
  assert.equal(ride.kind, "planned");
  assert.equal(ride.samples.length, 3);
  assert.equal(ride.samples[0].latitude, 52.0);
  assert.equal(ride.samples[0].longitude, 8.5);
  assert.equal(ride.totalDistanceMeters, 1234);
  assert.ok(ride.samples[1].timestamp.getTime() > ride.samples[0].timestamp.getTime());
});

test("rideToJSON: Dates als Double, endedAt (nil) weggelassen, Samples vollständig", () => {
  const json = R.rideToJSON(R.plannedRideFromCoords(coords, { title: "X" }));
  assert.equal(typeof json.startedAt, "number");
  assert.ok(!("endedAt" in json));
  assert.equal(json.kind, "planned");
  assert.equal(json.transportMode, "cycling");
  const s = json.samples[0];
  for (const k of ["id", "latitude", "longitude", "timestamp", "horizontalAccuracy", "altitude", "speed", "course"]) {
    assert.ok(k in s, `Sample-Feld ${k} fehlt`);
  }
  assert.equal(typeof s.timestamp, "number");
});

test("Round-trip rideFromJSON(rideToJSON) erhält Felder + Samples", () => {
  const ride = R.plannedRideFromCoords(coords, { title: "Tour", distanceMeters: 5000 });
  const back = R.rideFromJSON(JSON.parse(JSON.stringify(R.rideToJSON(ride))));
  assert.equal(back.title, "Tour");
  assert.equal(back.totalDistanceMeters, 5000);
  assert.equal(back.samples.length, 3);
  assert.equal(back.samples[2].longitude, 8.7);
  assert.equal(back.samples[0].timestamp.getTime(), ride.samples[0].timestamp.getTime());
});

test("Interop: rating/notes/tags + unbekannte Felder (Fotos/Akku) bleiben erhalten", () => {
  const ios = {
    id: "11111111-1111-1111-1111-111111111111",
    startedAt: 0,
    samples: [{ id: "s", latitude: 52, longitude: 8, timestamp: 0, horizontalAccuracy: 0, altitude: 0, speed: 0, course: 0 }],
    totalDistanceMeters: 1000,
    title: "Feierabendrunde",
    kind: "completed",
    rating: 4,
    notes: "schön",
    tags: ["Pendeln", "Familie"],
    photoFileNames: ["a.jpg", "b.jpg"],
    batteryLevelAtStartPercent: 80,
  };
  const ride = R.rideFromJSON(ios);
  assert.equal(ride.rating, 4);
  assert.equal(ride.notes, "schön");
  assert.deepEqual(ride.tags, ["Pendeln", "Familie"]);
  // Unknown fields land losslessly in _extra …
  assert.deepEqual(ride._extra.photoFileNames, ["a.jpg", "b.jpg"]);
  assert.equal(ride._extra.batteryLevelAtStartPercent, 80);
  // … and survive the round trip (interop, no data loss).
  const json = R.rideToJSON(ride);
  assert.equal(json.rating, 4);
  assert.deepEqual(json.photoFileNames, ["a.jpg", "b.jpg"]);
  assert.equal(json.batteryLevelAtStartPercent, 80);
});

test("Web-Tour ohne rating/notes/tags lässt diese im JSON weg", () => {
  const json = R.rideToJSON(R.makeRide({ title: "Neu" }));
  assert.ok(!("rating" in json));
  assert.ok(!("notes" in json));
  assert.ok(!("tags" in json));
});

test("Interop: parst eine RideSession im iOS-Format", () => {
  const ios = {
    id: "11111111-1111-1111-1111-111111111111",
    startedAt: 0, // 2001-01-01T00:00:00Z
    samples: [{ id: "S1", latitude: 52, longitude: 8.5, timestamp: 0, horizontalAccuracy: 0, altitude: 100, speed: 0, course: 0 }],
    totalDistanceMeters: 42000,
    title: "München – Bad Tölz",
    kind: "planned",
    // endedAt/transportMode deliberately omitted (nil in Swift)
  };
  const ride = R.rideFromJSON(ios);
  assert.equal(ride.title, "München – Bad Tölz");
  assert.equal(ride.transportMode, "cycling"); // Default
  assert.equal(ride.samples[0].altitude, 100);
  assert.equal(ride.startedAt.getTime(), new Date(Date.UTC(2001, 0, 1)).getTime());
});
