// Regression test: a newly added map quick target must NOT be lost
// when an already saved POI carries the same "new-N" ID (happens
// after a reload, because the counter starts at 0 but the saved IDs are
// named "new-0"…). Earlier cause: wirePoiAdd wired the new row via
// querySelector(data-poi-id) → on ID collision hit the OLD row → new row
// without a save handler → input discarded.
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
    addControl(c) {
      try {
        c && c.onAdd && c.onAdd();
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
  "Karten-Schnellziel mit ID-Kollision (new-0) wird trotzdem gespeichert",
  { skip: JSDOM ? false : "jsdom nicht installiert" },
  async () => {
    const ls = new MemoryStorage();
    // Already saved POI with "new-0" ID (as after a reload).
    ls.setItem("gc.poi.categories", JSON.stringify([{ id: "new-0", query: "AltesZiel", enabled: true }]));
    globalThis.localStorage = ls;

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

    // Open settings → list renders "AltesZiel" with data-poi-id="new-0".
    document.getElementById("settings-modal").dispatchEvent(new window.Event("show.bs.modal"));
    const list = document.getElementById("poi-list");

    // "+ POI" → new row also gets (counter from 0) id="new-0" (collision).
    document.getElementById("poi-add").click();
    const rows = list.querySelectorAll("[data-poi-id]");
    const newInput = rows[rows.length - 1].querySelector("[data-poi-query]");
    newInput.value = "NeuesZiel";
    newInput.dispatchEvent(new window.Event("input", { bubbles: true }));

    const saved = JSON.parse(localStorage.getItem("gc.poi.categories") || "[]").map((p) => p.query);
    assert.ok(saved.includes("NeuesZiel"), `„NeuesZiel" muss trotz ID-Kollision gespeichert sein, war: ${JSON.stringify(saved)}`);
    assert.ok(saved.includes("AltesZiel"), "bestehendes Ziel darf nicht verloren gehen");
  },
);
