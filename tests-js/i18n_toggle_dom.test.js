// End-to-end test of the language toggle IN THE DOM: loads the real index.html into
// a JSDOM environment, runs the real app.js (with minimally stubbed
// MapLibre/Bootstrap) and clicks the navbar button #btn-lang. Checks that
// `<html lang>`, the statically marked texts and the button label toggle.
//
// Exactly this class of regression (toggle "dead" because app.js aborted on load with
// an error and the click handler was never registered) is NOT covered by the
// pure dictionary/source contract — that requires real
// module execution in the DOM. jsdom is an optional dev dependency: if it is missing,
// the test is cleanly skipped (instead of breaking the zero-dep suite).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Load jsdom optionally — if missing, skip the test.
let JSDOM = null;
try {
  ({ JSDOM } = await import("jsdom"));
} catch {
  /* jsdom not installed → test is skipped */
}

// Mini localStorage (app.js/stores/i18n only use get/set/remove).
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

// Chainable no-op stub: every unknown method returns the stub itself
// (allows `a().b().c()` chains), with targeted overrides for the few
// methods whose return value the code actually evaluates.
function chainStub(overrides = {}) {
  const proxy = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop in overrides) return overrides[prop];
      if (typeof prop === "symbol") return undefined; // no Symbol.iterator/toPrimitive
      if (prop === "then") return undefined; // not "thenable"
      return () => proxy;
    },
    apply() {
      return proxy;
    },
    construct() {
      return proxy;
    },
  });
  return proxy;
}

function makeMaplibreStub(document) {
  const mapOverrides = {
    isStyleLoaded: () => true, // → _ensureRouteLayer creates (no-op) layer
    getSource: () => undefined, // → _setRoute/_setTemplate abort cleanly
    getLayer: () => undefined,
    queryRenderedFeatures: () => [], // must be iterable
    getCanvas: () => ({ style: {} }),
    getContainer: () => document.getElementById("map") || document.body,
    addControl(control) {
      try {
        control && control.onAdd && control.onAdd();
      } catch {
        /* control setup is irrelevant for this test */
      }
    },
    on: () => {}, // "load" etc. doesn't fire in the test
    once: () => {},
    off: () => {},
  };
  const markerOverrides = {
    getElement: () => document.createElement("div"),
    getLngLat: () => ({ lng: 0, lat: 0, toArray: () => [0, 0] }),
  };
  // Constructors must be real functions (arrow functions are not
  // `new`-able). The returned object stub replaces `this`.
  function ctrl() {
    return chainStub({ onAdd: () => document.createElement("div"), onRemove: () => {}, on: () => {}, trigger: () => {} });
  }
  return {
    Map: function () {
      return chainStub(mapOverrides);
    },
    Marker: function () {
      return chainStub(markerOverrides);
    },
    Popup: function () {
      return chainStub({ isOpen: () => false });
    },
    NavigationControl: ctrl,
    ScaleControl: ctrl,
    GeolocateControl: ctrl,
    LngLatBounds: function () {
      return chainStub({});
    },
  };
}

function makeBootstrapStub() {
  const inst = { show() {}, hide() {} };
  return {
    Offcanvas: { getOrCreateInstance: () => inst, getInstance: () => inst },
    Modal: { getOrCreateInstance: () => inst, getInstance: () => null },
  };
}

test(
  "DE/EN-Umschalter: Klick auf #btn-lang schaltet Sprache, Texte und Knopf-Label um",
  { skip: JSDOM ? false : "jsdom nicht installiert (npm i -D jsdom)" },
  async () => {
    // localStorage first, then set i18n to a defined initial state (de)
    // (app.js reads getLang() on load).
    globalThis.localStorage = new MemoryStorage();
    const i18n = await import("../static/js/i18n.js");
    i18n.setLang("de");

    // Load the real template in JSDOM (without running its own <script> tags).
    const html = readFileSync(new URL("../templates/index.html", import.meta.url), "utf8");
    const dom = new JSDOM(html, { url: "http://localhost/", pretendToBeVisual: true });
    const { window } = dom;
    const { document } = window;

    // Globals that app.js/planner.js expect (browser globals + MapLibre/Bootstrap).
    globalThis.window = window;
    globalThis.document = document;
    globalThis.location = window.location;
    globalThis.maplibregl = makeMaplibreStub(document);
    globalThis.bootstrap = makeBootstrapStub();
    globalThis.alert = () => {};
    globalThis.confirm = () => true;
    globalThis.prompt = () => null;

    // Run the real app.js (module side effects: map/planner/handlers + applyLang()).
    await import("../static/js/app.js");

    const htmlEl = document.documentElement;
    const btnLang = document.getElementById("btn-lang");
    assert.ok(btnLang, "#btn-lang muss existieren");

    // Sample elements (statically marked keys).
    const sample = {
      Reisen: "Trips",
      Touren: "Tours",
      Einstellungen: "Settings",
    };
    const elFor = (key) => document.querySelector(`[data-i18n="${key}"]`);
    for (const key of Object.keys(sample)) assert.ok(elFor(key), `Element [data-i18n="${key}"] fehlt`);

    // Help modal content (injected from gc/help) as a sample.
    const helpText = () => document.getElementById("help-body").textContent;

    // --- Initial state: German ---
    assert.equal(htmlEl.getAttribute("lang"), "de", "Start sollte de sein");
    for (const [de] of Object.entries(sample)) {
      assert.equal(elFor(de).textContent, de, `"${de}" sollte initial deutsch sein`);
    }
    assert.equal(btnLang.textContent, "EN", "Knopf zeigt im de-Modus die Zielsprache EN");
    // Help modal is filled and German.
    assert.ok(document.querySelectorAll("#help-body .help-nav .nav-link").length >= 6, "Hilfe-Sidebar sollte Bereiche zeigen");
    assert.match(helpText(), /Grundlagen/, "Hilfe sollte initial deutsch sein");
    assert.match(helpText(), /Datenschutz/, "Datenschutz-Abschnitt fehlt");

    // --- Click → English ---
    btnLang.click();
    assert.equal(i18n.getLang(), "en", "Klick sollte auf en umschalten (Handler muss registriert sein!)");
    assert.equal(htmlEl.getAttribute("lang"), "en");
    for (const [de, en] of Object.entries(sample)) {
      assert.equal(elFor(de).textContent, en, `"${de}" sollte nun "${en}" sein`);
    }
    assert.equal(btnLang.textContent, "DE", "Knopf zeigt im en-Modus die Zielsprache DE");
    // Help modal switched to English.
    assert.match(helpText(), /Basics/, "Hilfe sollte nach Umschalten englisch sein");
    assert.match(helpText(), /Privacy/, "Privacy section missing");
    assert.doesNotMatch(helpText(), /Grundlagen/, "kein deutscher Resttext im en-Modus");

    // --- Another click → back to German ---
    btnLang.click();
    assert.equal(i18n.getLang(), "de");
    assert.equal(htmlEl.getAttribute("lang"), "de");
    for (const [de] of Object.entries(sample)) {
      assert.equal(elFor(de).textContent, de, `"${de}" sollte wieder deutsch sein`);
    }
    assert.equal(btnLang.textContent, "EN");
  },
);
