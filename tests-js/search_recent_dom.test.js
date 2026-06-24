// Test of the "recently searched" overlay: focusing the (empty) search field shows the
// last results again. Uses jsdom + the REAL Planner methods on a
// minimal context — _showRecentSearch/_renderSearchResults only render the list
// (no map marker), so it needs neither MapLibre nor the full app.
import { test } from "node:test";
import assert from "node:assert/strict";

let JSDOM = null;
try {
  ({ JSDOM } = await import("jsdom"));
} catch {
  /* jsdom optional → test is cleanly skipped */
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

test(
  "Fokus aufs leere Suchfeld öffnet das Overlay mit den letzten Treffern",
  { skip: JSDOM ? false : "jsdom nicht installiert (npm i -D jsdom)" },
  async () => {
    // Set localStorage BEFORE the import (planner.js → i18n.js reads it on load).
    globalThis.localStorage = new MemoryStorage();
    const dom = new JSDOM(
      `<input id="nav-search"><div id="nav-search-results" class="list-group d-none"></div>`,
      { url: "http://localhost/" },
    );
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;

    const { Planner } = await import("../static/js/planner.js");

    // Minimal context: only the methods/fields needed for _showRecentSearch.
    // Marker/click/save methods are no-ops here or are not triggered.
    const ctx = {
      trip: null,
      lastResults: [
        { name: "Bielefeld", displayName: "Bielefeld, DE", lat: 52.02, lon: 8.53 },
        { name: "Bremen", displayName: "Bremen, DE", lat: 53.07, lon: 8.8 },
      ],
      _showRecentSearch: Planner.prototype._showRecentSearch,
      _renderSearchResults: Planner.prototype._renderSearchResults,
      _saveRecentSearch() {},
      _setSearchMarkers() {},
      _flyToResult() {},
      _assignResultToTrip() {},
    };

    const box = document.getElementById("nav-search-results");
    assert.ok(box.classList.contains("d-none"), "Overlay startet verborgen");

    ctx._showRecentSearch();

    assert.ok(!box.classList.contains("d-none"), "Overlay sollte nach Fokus sichtbar sein");
    assert.match(box.textContent, /Zuletzt gesucht/, "Kopfzeile fehlt");
    assert.match(box.textContent, /Bielefeld/);
    assert.match(box.textContent, /Bremen/);
    assert.equal(box.querySelectorAll("[data-go]").length, 2, "beide Treffer anklickbar");

    // With text in the field the overlay stays closed (don't disturb the real search).
    box.classList.add("d-none");
    document.getElementById("nav-search").value = "Köln";
    ctx._showRecentSearch();
    assert.ok(box.classList.contains("d-none"), "bei Text im Feld kein Verlaufs-Overlay");

    // Without earlier results nothing happens.
    box.classList.add("d-none");
    document.getElementById("nav-search").value = "";
    ctx.lastResults = [];
    ctx._showRecentSearch();
    assert.ok(box.classList.contains("d-none"), "ohne Verlauf kein Overlay");
  },
);

test(
  "Klick auf einen Treffer leert das Suchfeld",
  { skip: JSDOM ? false : "jsdom nicht installiert (npm i -D jsdom)" },
  async () => {
    globalThis.localStorage = new MemoryStorage();
    const dom = new JSDOM(
      `<input id="nav-search" value="Bielefeld"><div id="nav-search-results" class="list-group"></div>`,
      { url: "http://localhost/" },
    );
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;

    const { Planner } = await import("../static/js/planner.js");

    // Minimal context: _flyToResult only needs map.flyTo/getZoom + _showMarkerInfo.
    const ctx = {
      map: { flyTo() {}, getZoom: () => 10 },
      _showMarkerInfo() {},
      _flyToResult: Planner.prototype._flyToResult,
    };
    const input = document.getElementById("nav-search");
    assert.equal(input.value, "Bielefeld");

    ctx._flyToResult({ name: "Bielefeld", displayName: "Bielefeld, DE", lat: 52.02, lon: 8.53 });

    assert.equal(input.value, "", "Suchfeld sollte nach Treffer-Klick geleert sein");
    assert.ok(
      document.getElementById("nav-search-results").classList.contains("d-none"),
      "Trefferliste sollte eingeklappt sein",
    );
  },
);
