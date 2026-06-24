// Tests for the trip-planning mode indicator (_renderTripModeIndicator): the pill
// is visible while a trip is open, the exit button turns the mode off, a click
// reopens the detail panel, and during a map pick it yields to the banner.
// Called via Planner.prototype.<method>.call(ctx) with a real JSDOM element +
// spies — no full map/app setup needed.
import { test } from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}
// Set localStorage BEFORE the import (planner.js → i18n.js reads it on load).
globalThis.localStorage = new MemoryStorage();

const { Planner } = await import("../static/js/planner.js");
const { JSDOM } = await import("jsdom");

/**
 * Builds a fresh test context: a real JSDOM element as `tripModeEl` plus
 * counters for the triggered actions (open panel / exit mode).
 * `trip` = the currently open trip (or null), `pickMode` = an ongoing map pick.
 */
function makeCtx({ trip = null, pickMode = null } = {}) {
  const dom = new JSDOM('<!DOCTYPE html><div id="trip-mode-indicator" class="trip-mode-indicator d-none"></div>');
  const el = dom.window.document.getElementById("trip-mode-indicator");
  const calls = { show: 0, deselect: 0 };
  const ctx = {
    tripModeEl: el,
    trip,
    pickMode,
    tripOffcanvas: { show() { calls.show += 1; } },
    _deselectTrip() { calls.deselect += 1; },
  };
  return { ctx, el, calls };
}

const render = (ctx) => Planner.prototype._renderTripModeIndicator.call(ctx);

test("Modus-Pille zeigt den Reisetitel + ist sichtbar, wenn eine Reise offen ist", () => {
  const { ctx, el } = makeCtx({ trip: { title: "Nordsee" } });
  render(ctx);
  assert.equal(el.classList.contains("d-none"), false, "sichtbar");
  assert.match(el.innerHTML, /Nordsee/, "Titel als Kontext");
  assert.ok(el.querySelector("[data-trip-mode-exit]"), "Beenden-Knopf");
  assert.ok(el.querySelector("[data-trip-mode-open]"), "Öffnen-Knopf");
});

test("ohne offene Reise → Pille versteckt + geleert", () => {
  const { ctx, el } = makeCtx({ trip: null });
  render(ctx);
  assert.equal(el.classList.contains("d-none"), true);
  assert.equal(el.innerHTML, "");
});

test("während eines Karten-Picks weicht die Pille dem Pick-Banner", () => {
  const { ctx, el } = makeCtx({ trip: { title: "Nordsee" }, pickMode: "dest" });
  render(ctx);
  assert.equal(el.classList.contains("d-none"), true);
});

test("Beenden-Knopf (x) beendet den Reise-Modus (ruft _deselectTrip)", () => {
  const { ctx, el, calls } = makeCtx({ trip: { title: "Nordsee" } });
  render(ctx);
  el.querySelector("[data-trip-mode-exit]").click();
  assert.equal(calls.deselect, 1);
  assert.equal(calls.show, 0);
});

test("Klick auf die Pille öffnet das Detail-Panel wieder", () => {
  const { ctx, el, calls } = makeCtx({ trip: { title: "Nordsee" } });
  render(ctx);
  el.querySelector("[data-trip-mode-open]").click();
  assert.equal(calls.show, 1);
  assert.equal(calls.deselect, 0);
});

test("ohne Titel fällt die Pille auf den generischen Reise-Begriff zurück", () => {
  const { ctx, el } = makeCtx({ trip: { title: "   " } });
  render(ctx);
  assert.equal(el.classList.contains("d-none"), false);
  assert.match(el.innerHTML, /reise|trip/i, "generischer Reise-/Trip-Begriff");
});
