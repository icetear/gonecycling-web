// Tests of the pure routing request builders (OSRM/ORS/BRouter), no network.
import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_ROUTING, buildOsrmUrl, buildBrouterUrl, buildOrsRequest } from "../static/js/routing.js";

const pts = [
  { latitude: 52.0302, longitude: 8.5325 }, // Bielefeld
  { latitude: 51.9607, longitude: 7.6261 }, // Münster
];

test("OSRM-URL: Profil + lng,lat;… + geojson", () => {
  const url = buildOsrmUrl({ ...DEFAULT_ROUTING }, pts);
  assert.match(url, /\/route\/v1\/driving\/8\.5325,52\.0302;7\.6261,51\.9607\?/);
  assert.match(url, /geometries=geojson/);
  // no double slash from base with trailing slash
  assert.equal(buildOsrmUrl({ ...DEFAULT_ROUTING, osrmBase: "https://x/" }, pts).includes("x//route"), false);
});

test("BRouter-URL: lonlats mit | getrennt + Profil", () => {
  const url = buildBrouterUrl({ ...DEFAULT_ROUTING, brouterProfile: "fastbike" }, pts);
  assert.match(url, /lonlats=8\.5325,52\.0302\|7\.6261,51\.9607/);
  assert.match(url, /profile=fastbike/);
  assert.match(url, /format=geojson/);
});

test("ORS-Request: POST-Body [lng,lat], Profil im Pfad, Key im Header", () => {
  const req = buildOrsRequest({ ...DEFAULT_ROUTING, orsProfile: "cycling-regular", orsKey: "abc" }, pts);
  assert.match(req.url, /\/v2\/directions\/cycling-regular\/geojson$/);
  assert.equal(req.headers.Authorization, "abc");
  assert.deepEqual(req.body.coordinates, [
    [8.5325, 52.0302],
    [7.6261, 51.9607],
  ]);
});

test("ORS-Request: Basic-Auth-Modus setzt Authorization: Basic base64(user:pass)", () => {
  const req = buildOrsRequest({ ...DEFAULT_ROUTING, orsAuthMode: "basic", orsUser: "mario", orsPassword: "geheim", orsKey: "ignoriert" }, pts);
  // base64("mario:geheim")
  assert.equal(req.headers.Authorization, "Basic bWFyaW86Z2VoZWlt");
});
