// Tests of the i18n engine (static/js/i18n.js): language state, translation `t()`,
// and the POI preset mechanism `poiLabel()`. Pure logic, no DOM needed.
import { test } from "node:test";
import assert from "node:assert/strict";

// Mini localStorage for Node (i18n.js only uses get/set/Item, each in try/catch).
class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
}
globalThis.localStorage = new MemoryStorage();

const { t, getLang, setLang, poiLabel } = await import("../static/js/i18n.js");

test("setLang/getLang: nur de|en, Default-Fallback bei Unsinn", () => {
  setLang("en");
  assert.equal(getLang(), "en");
  setLang("de");
  assert.equal(getLang(), "de");
  setLang("klingon"); // everything ≠ 'en' → 'de'
  assert.equal(getLang(), "de");
});

test("setLang merkt die Wahl in localStorage (gc.lang)", () => {
  setLang("en");
  assert.equal(localStorage.getItem("gc.lang"), "en");
  setLang("de");
  assert.equal(localStorage.getItem("gc.lang"), "de");
});

test("t(): de gibt den Schlüssel unverändert zurück", () => {
  setLang("de");
  assert.equal(t("Reisen"), "Reisen");
  assert.equal(t("Irgendein unübersetzter Text"), "Irgendein unübersetzter Text");
});

test("t(): en übersetzt bekannte Schlüssel, unbekannte bleiben (graceful fallback)", () => {
  setLang("en");
  assert.equal(t("Reisen"), "Trips");
  assert.equal(t("Touren"), "Tours");
  assert.equal(t("Einstellungen"), "Settings");
  assert.equal(t("Diesen Text gibt es nicht im Wörterbuch"), "Diesen Text gibt es nicht im Wörterbuch");
});

test("t(): Umschalten de→en→de liefert konsistente Resultate", () => {
  setLang("de");
  assert.equal(t("Speichern"), "Speichern");
  setLang("en");
  assert.equal(t("Speichern"), "Save");
  setLang("de");
  assert.equal(t("Speichern"), "Speichern");
});

test("t(): zentrale UI-Schlüssel haben die erwartete englische Entsprechung", () => {
  setLang("en");
  const pairs = {
    Verbinden: "Connect",
    Trennen: "Disconnect",
    Abbrechen: "Cancel",
    Entfernen: "Remove",
    Löschen: "Delete",
    Wegpunkt: "Waypoint",
    "Route berechnen": "Compute route",
    "Nächste Etappe": "Next stage",
    Gesamtkosten: "Total cost",
    "Als Ziel": "As destination", // was previously untranslated (regression)
  };
  for (const [de, en] of Object.entries(pairs)) {
    assert.equal(t(de), en, `t("${de}") sollte "${en}" sein`);
  }
});

// --- poiLabel: known categories bidirectional, custom terms verbatim ----

test("poiLabel(): Presets werden in der aktuellen Sprache angezeigt", () => {
  setLang("en");
  assert.equal(poiLabel("Bäckerei"), "Bakery");
  assert.equal(poiLabel("Bahnhof"), "Train station");
  assert.equal(poiLabel("Tankstelle"), "Gas station");
  assert.equal(poiLabel("Jugendherberge"), "Youth hostel");
  setLang("de");
  assert.equal(poiLabel("Bäckerei"), "Bäckerei");
  assert.equal(poiLabel("Bahnhof"), "Bahnhof");
});

test("poiLabel(): erkennt ein bereits englisch gespeichertes Preset (Rückrichtung)", () => {
  setLang("de");
  assert.equal(poiLabel("Bakery"), "Bäckerei");
  assert.equal(poiLabel("Train station"), "Bahnhof");
  setLang("en");
  assert.equal(poiLabel("Bakery"), "Bakery");
  assert.equal(poiLabel("Train station"), "Train station");
});

test("poiLabel(): in beiden Sprachen identische Kategorien bleiben gleich", () => {
  for (const lang of ["de", "en"]) {
    setLang(lang);
    assert.equal(poiLabel("Café"), "Café");
    assert.equal(poiLabel("Restaurant"), "Restaurant");
    assert.equal(poiLabel("Hotel"), "Hotel");
  }
});

test("poiLabel(): eigene (nicht-Preset) Begriffe bleiben unverändert", () => {
  setLang("en");
  assert.equal(poiLabel("Eisdiele"), "Eisdiele");
  assert.equal(poiLabel("Lieblingsbäcker XY"), "Lieblingsbäcker XY");
  setLang("de");
  assert.equal(poiLabel("Eisdiele"), "Eisdiele");
});

test("poiLabel(): leere/falsche Eingaben werden unverändert durchgereicht", () => {
  setLang("en");
  assert.equal(poiLabel(""), "");
  assert.equal(poiLabel(null), null);
  assert.equal(poiLabel(undefined), undefined);
});
