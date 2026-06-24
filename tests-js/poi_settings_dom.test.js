// DOM test of the map quick targets / stage targets management: adds a new POI in
// the settings and checks that it lands in localStorage (saved)
// and shows up in the map POI bar (applied). Covers exactly the class
// "new quick targets are not saved/applied".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let JSDOM = null;
try {
  ({ JSDOM } = await import("jsdom"));
} catch {
  /* optional */
}

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

function chainStub(overrides = {}) {
  const proxy = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop in overrides) return overrides[prop];
      if (typeof prop === "symbol") return undefined;
      if (prop === "then") return undefined;
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
    isStyleLoaded: () => true,
    getSource: () => undefined,
    getLayer: () => undefined,
    queryRenderedFeatures: () => [],
    getCanvas: () => ({ style: {} }),
    getContainer: () => document.getElementById("map") || document.body,
    addControl(control) {
      try {
        control && control.onAdd && control.onAdd();
      } catch {
        /* doesn't matter */
      }
    },
    on: () => {},
    once: () => {},
    off: () => {},
  };
  function ctrl() {
    return chainStub({ onAdd: () => document.createElement("div"), onRemove: () => {}, on: () => {}, trigger: () => {} });
  }
  return {
    Map: function () {
      return chainStub(mapOverrides);
    },
    Marker: function () {
      return chainStub({ getElement: () => document.createElement("div"), getLngLat: () => ({ lng: 0, lat: 0 }) });
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
  "Einstellungen: neuer Karten-Schnellziel-POI wird gespeichert UND in die POI-Leiste übernommen",
  { skip: JSDOM ? false : "jsdom nicht installiert" },
  async () => {
    globalThis.localStorage = new MemoryStorage();
    const i18n = await import("../static/js/i18n.js");
    i18n.setLang("de");

    const html = readFileSync(new URL("../templates/index.html", import.meta.url), "utf8");
    const dom = new JSDOM(html, { url: "http://localhost/", pretendToBeVisual: true });
    const { window } = dom;
    const { document } = window;
    globalThis.window = window;
    globalThis.document = document;
    globalThis.location = window.location;
    globalThis.maplibregl = makeMaplibreStub(document);
    globalThis.bootstrap = makeBootstrapStub();
    globalThis.alert = () => {};
    globalThis.confirm = () => true;

    await import("../static/js/app.js");

    // Settings "opened" → renderPoiList fills #poi-list (show.bs.modal hook).
    document.getElementById("settings-modal").dispatchEvent(new window.Event("show.bs.modal"));
    const list = document.getElementById("poi-list");
    const before = list.querySelectorAll("[data-poi-id]").length;
    assert.ok(before >= 1, "Schnellziel-Liste sollte Vorgaben zeigen");

    // Click "+ POI" → new empty row, then type a term.
    document.getElementById("poi-add").click();
    const rows = list.querySelectorAll("[data-poi-id]");
    assert.equal(rows.length, before + 1, "neue Zeile sollte angehängt sein");
    const input = rows[rows.length - 1].querySelector("[data-poi-query]");
    input.value = "Spielplatz";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));

    // Saved?
    const saved = JSON.parse(localStorage.getItem("gc.poi.categories") || "[]");
    const queries = saved.map((p) => p.query);
    assert.ok(queries.includes("Spielplatz"), `gespeichert sein sollte „Spielplatz", war: ${JSON.stringify(queries)}`);

    // Applied? The POI bar on the map should show the new chip.
    const bar = document.getElementById("poi-bar");
    assert.match(bar.textContent, /Spielplatz/, "neuer POI sollte in der Karten-POI-Leiste erscheinen");

    // Close + reopen → the new POI must NOT be discarded.
    document.getElementById("settings-modal").dispatchEvent(new window.Event("hide.bs.modal"));
    document.getElementById("settings-modal").dispatchEvent(new window.Event("hidden.bs.modal"));
    document.getElementById("settings-modal").dispatchEvent(new window.Event("show.bs.modal"));
    const afterReopen = [...document.getElementById("poi-list").querySelectorAll("[data-poi-query]")].map((el) => el.value);
    assert.ok(afterReopen.includes("Spielplatz"), `nach Schließen+Öffnen sollte „Spielplatz" noch da sein, war: ${JSON.stringify(afterReopen)}`);
  },
);
