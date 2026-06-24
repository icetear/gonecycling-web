// Tests of the name selection from Nominatim results (pure, no network).
import { test } from "node:test";
import assert from "node:assert/strict";

import { pickName, pickPoiName } from "../static/js/geocode.js";

test("pickName bevorzugt Stadt/Ort vor display_name", () => {
  assert.equal(pickName({ address: { city: "Bielefeld", state: "NRW" } }), "Bielefeld");
  assert.equal(pickName({ address: { village: "Schildesche" } }), "Schildesche");
  assert.equal(pickName({ address: { county: "Kreis Lippe" } }), "Kreis Lippe");
});

test("pickName fällt auf name bzw. erstes display_name-Segment zurück", () => {
  assert.equal(pickName({ name: "Sparrenburg", address: {} }), "Sparrenburg");
  assert.equal(pickName({ display_name: "Altstadt, Mitte, Bielefeld, NRW" }), "Altstadt");
});

test("pickName: null bei leerem/fehlendem Ergebnis", () => {
  assert.equal(pickName(null), null);
  assert.equal(pickName({}), null);
});

test("pickPoiName bevorzugt den POI-/Objektnamen vor dem Ort", () => {
  // POI in a city → name, not the place (that was the bug in pickName).
  assert.equal(
    pickPoiName({ name: "Hotel Krone", address: { city: "Bielefeld" }, display_name: "Hotel Krone, Hauptstraße 5, Bielefeld" }),
    "Hotel Krone",
  );
  // Without an explicit name → first display_name segment (feature name first).
  assert.equal(pickPoiName({ address: { city: "Bielefeld" }, display_name: "Bahnhof, Bahnhofstraße, Bielefeld" }), "Bahnhof");
  // A pure locality stays the place.
  assert.equal(pickPoiName({ display_name: "Bielefeld, NRW", address: { city: "Bielefeld" } }), "Bielefeld");
  assert.equal(pickPoiName(null), null);
});
