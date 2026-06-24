import { test } from "node:test";
import assert from "node:assert/strict";

import { buildSupplyQuery, sampleIdx, supplyAlongRoute, buildCitiesQuery, parseCities, largestCities } from "../static/js/overpass.js";

test("sampleIdx: gleichmäßig, inkl. erstem/letztem", () => {
  assert.deepEqual(sampleIdx(3, 10), [0, 1, 2]);
  assert.deepEqual(sampleIdx(10, 4), [0, 3, 6, 9]);
});

test("buildSupplyQuery: around + amenity/shop-Filter + out center", () => {
  const q = buildSupplyQuery(
    [
      [50.0, 8.0],
      [50.1, 8.1],
    ],
    250,
  );
  assert.match(q, /around:250,50\.00000,8\.00000,50\.10000,8\.10000/);
  assert.match(q, /amenity.*drinking_water/);
  assert.match(q, /shop.*supermarket/);
  assert.match(q, /out center/);
});

test("supplyAlongRoute: parst Overpass-Elemente (node + way center)", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      elements: [
        { type: "node", lat: 50.05, lon: 8.05, tags: { amenity: "drinking_water" } },
        { type: "way", center: { lat: 50.06, lon: 8.06 }, tags: { shop: "supermarket", name: "Edeka" } },
        { type: "node", lat: null, lon: null, tags: {} }, // without coordinate → skipped
      ],
    }),
  });
  const samples = [
    { latitude: 50, longitude: 8 },
    { latitude: 50.1, longitude: 8.1 },
  ];
  const pois = await supplyAlongRoute(samples, {});
  assert.equal(pois.length, 2);
  assert.equal(pois[0].icon, "🚰");
  assert.equal(pois[1].name, "Edeka");
  assert.equal(pois[1].icon, "🛒");
});

test("supplyAlongRoute: alle Endpunkte fehlgeschlagen → null; zu wenig Punkte → []", async () => {
  globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });
  assert.equal(
    await supplyAlongRoute(
      [
        { latitude: 1, longitude: 1 },
        { latitude: 2, longitude: 2 },
      ],
      {},
    ),
    null,
  );
  assert.deepEqual(await supplyAlongRoute([{ latitude: 1, longitude: 1 }], {}), []); // < 2 points
});

test("buildCitiesQuery: place-Filter + erzwungenes population-Tag + around", () => {
  const q = buildCitiesQuery(50.12345, 8.67891, 40000);
  assert.match(q, /node\["place"~"\^\(city\|town\|village\)\$"\]\["population"\]/);
  assert.match(q, /around:40000,50\.12345,8\.67891/);
  // The out statement must be valid: "out qt 200;" returns HTTP 406 (Overpass).
  assert.match(q, /out 200;/);
  assert.doesNotMatch(q, /out qt/);
});

test("parseCities: parst Einwohnerzahl, sortiert absteigend, dedupliziert", () => {
  const cities = parseCities([
    { lat: 50.0, lon: 8.0, tags: { name: "Klein", place: "village", population: "1.200" } },
    { lat: 51.0, lon: 9.0, tags: { name: "Groß", place: "city", population: "120000" } },
    { lat: 51.0, lon: 9.0, tags: { name: "Groß", place: "city", population: "119000" } }, // duplicate → dropped
    { lat: 52.0, lon: 10.0, tags: { name: "OhneZahl", place: "town" } }, // no population → population null
    { lat: null, lon: null, tags: { name: "OhneCoord", population: "999" } }, // without coordinate → dropped
  ]);
  assert.deepEqual(cities.map((c) => c.name), ["Groß", "Klein", "OhneZahl"]);
  assert.equal(cities[0].population, 120000); // "120000" → 120000
  assert.equal(cities[1].population, 1200); // "1.200" (de thousands) → 1200
  assert.equal(cities[2].population, null); // no tag → null
});

test("parseCities: limit begrenzt die Trefferzahl", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ lat: i, lon: i, tags: { name: `Ort${i}`, population: String(i * 100) } }));
  assert.equal(parseCities(many, 5).length, 5);
});

test("largestCities: alle Endpunkte fehlgeschlagen → null; ungültiges Zentrum → []", async () => {
  globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });
  assert.equal(await largestCities([8, 50], {}), null);
  assert.deepEqual(await largestCities(null, {}), []);
});

test("largestCities: erfolgreicher Abruf liefert sortierte Orte", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      elements: [
        { lat: 50, lon: 8, tags: { name: "A", place: "town", population: "5000" } },
        { lat: 51, lon: 9, tags: { name: "B", place: "city", population: "90000" } },
      ],
    }),
  });
  const cities = await largestCities([8, 50], {});
  assert.equal(cities.length, 2);
  assert.equal(cities[0].name, "B"); // largest first
});
