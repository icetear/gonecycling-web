// Tests of GPX building/parsing (pure, no network/DOM).
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildGPX, parseGPX } from "../static/js/gpx.js";

test("buildGPX: trk/trkpt mit lat/lon + ele, escaped Namen", () => {
  const gpx = buildGPX([{ name: "A & B", coords: [[8.5, 52.0, 100], [8.6, 52.1]] }]);
  assert.match(gpx, /<gpx /);
  assert.match(gpx, /<name>A &amp; B<\/name>/);
  assert.match(gpx, /<trkpt lat="52" lon="8\.5"><ele>100<\/ele><\/trkpt>/);
  assert.match(gpx, /<trkpt lat="52\.1" lon="8\.6"><\/trkpt>/);
});

test("parseGPX: liest Name + trkpts als [lng,lat]", () => {
  const gpx = buildGPX([{ name: "Tour", coords: [[8.5, 52.0], [8.6, 52.1]] }]);
  const { name, points } = parseGPX(gpx);
  assert.equal(name, "Tour");
  assert.deepEqual(points, [[8.5, 52.0], [8.6, 52.1]]);
});

test("parseGPX: Attribut-Reihenfolge lon vor lat wird erkannt", () => {
  const xml = `<gpx><trk><trkseg><trkpt lon="7.6" lat="51.96"/></trkseg></trk></gpx>`;
  assert.deepEqual(parseGPX(xml).points, [[7.6, 51.96]]);
});

test("parseGPX: Fallback auf rtept", () => {
  const xml = `<gpx><rte><rtept lat="50" lon="8"/><rtept lat="50.1" lon="8.1"/></rte></gpx>`;
  assert.deepEqual(parseGPX(xml).points, [[8, 50], [8.1, 50.1]]);
});

test("buildGPX → parseGPX Round-trip erhält die Punkte", () => {
  const coords = [[8.5, 52.0], [8.55, 52.02], [8.6, 52.05]];
  const { points } = parseGPX(buildGPX([{ name: "RT", coords }]));
  assert.deepEqual(points, coords);
});
