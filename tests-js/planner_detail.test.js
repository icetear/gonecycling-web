// Tests of the new trip detail building blocks: route thumbnail (SVG of the route shape),
// collapsible sections (_section) and remembering the collapse state. Pure
// string/logic tests over the Planner prototype methods (no DOM/map needed).
import { test } from "node:test";
import assert from "node:assert/strict";

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
// Set localStorage BEFORE the import (planner.js → i18n.js reads it on load).
globalThis.localStorage = new MemoryStorage();

const { Planner } = await import("../static/js/planner.js");

test("_routeThumbnail rendert SVG mit Pfad + Start/Ziel-Punkten", () => {
  const ride = {
    samples: [
      { latitude: 50.0, longitude: 11.0 },
      { latitude: 50.1, longitude: 11.1 },
      { latitude: 50.2, longitude: 11.05 },
    ],
  };
  const svg = Planner.prototype._routeThumbnail(ride);
  assert.match(svg, /<svg class="gc-route-thumb"/);
  assert.match(svg, /<path d="M/);
  assert.equal((svg.match(/<circle/g) || []).length, 2, "Start- + Ziel-Punkt");
  assert.match(svg, /<image href="https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png"/, "OSM-Kachel als Hintergrund");
  assert.match(svg, /© OSM/, "Attribution");
  // Too few/no points → empty result.
  assert.equal(Planner.prototype._routeThumbnail({ samples: [{ latitude: 1, longitude: 1 }] }), "");
  assert.equal(Planner.prototype._routeThumbnail(null), "");
});

test("_section markiert offene/eingeklappte Boxen korrekt", () => {
  const open = Planner.prototype._section.call({ _sectionState: {} }, "vorlage", "Vorlage", "INHALT");
  assert.match(open, /data-section="vorlage"/);
  assert.match(open, /class="gc-section-title"/);
  assert.match(open, /INHALT/);
  assert.match(open, /aria-expanded="true"/);
  assert.doesNotMatch(open, /gc-collapsed/);

  const collapsed = Planner.prototype._section.call({ _sectionState: { stages: true } }, "stages", "Etappen", "X");
  assert.match(collapsed, /gc-section gc-collapsed/);
  assert.match(collapsed, /aria-expanded="false"/);
});

test("_saveSectionState/_loadSectionState merken den Zustand über localStorage", () => {
  Planner.prototype._saveSectionState.call({ _sectionState: { vorlage: true, stages: false } });
  const loaded = Planner.prototype._loadSectionState.call({});
  assert.deepEqual(loaded, { vorlage: true, stages: false });
});

test("_discardEmptyTourDraft entfernt nur leere (0 km) Touren beim Schließen", () => {
  const run = (dist) => {
    const removed = [];
    const ride = { id: "r1", totalDistanceMeters: dist };
    const ctx = {
      tourDraft: { editRideId: "r1" },
      ridesStore: { getRide: (id) => (id === "r1" ? ride : null), removeRides: (ids) => removed.push(...ids) },
      renderTours() {},
    };
    Planner.prototype._discardEmptyTourDraft.call(ctx);
    return removed;
  };
  assert.deepEqual(run(0), ["r1"], "0-km-Tour wird entfernt");
  assert.deepEqual(run(12000), [], "Tour mit Strecke bleibt erhalten");

  // Without an open tour edit nothing happens.
  let touched = false;
  Planner.prototype._discardEmptyTourDraft.call({ tourDraft: null, ridesStore: { removeRides: () => (touched = true) } });
  assert.equal(touched, false);
});

test("_distanceToTemplateMeters: Abstand zur Vorlagen-Linie (oder null ohne Vorlage)", () => {
  // Template: a horizontal segment along the 50th parallel from 11.0 to 11.2.
  const tmpl = [
    [11.0, 50.0],
    [11.2, 50.0],
  ];
  const ctx = { _templateCoords: () => tmpl, _projectOnTemplate: Planner.prototype._projectOnTemplate };
  const d = Planner.prototype._distanceToTemplateMeters.call(ctx, {}, [11.1, 50.0]);
  assert.equal(d, 0, "point lies directly on the line");

  // ~0.1° latitude north of the line ≈ 11.1 km straight line (tolerance ±300 m).
  const off = Planner.prototype._distanceToTemplateMeters.call(ctx, {}, [11.1, 50.1]);
  assert.ok(Math.abs(off - 11119) < 300, `~11.1 km expected, was ${Math.round(off)} m`);

  // Without a template (too few points) → null.
  assert.equal(Planner.prototype._distanceToTemplateMeters.call({ _templateCoords: () => [] }, {}, [11.1, 50.0]), null);
});

test("_alongTemplateMeters: Distanz ENTLANG der Vorlage (nicht Luftlinie)", () => {
  // Template: a horizontal segment 11.0→11.2 along the 50th parallel (~14.3 km).
  const tmpl = [
    [11.0, 50.0],
    [11.2, 50.0],
  ];
  const ctx = { _templateCoords: () => tmpl, _projectOnTemplate: Planner.prototype._projectOnTemplate };
  const along = (from, to) => Planner.prototype._alongTemplateMeters.call(ctx, {}, from, to);

  const full = along([11.0, 50.0], [11.2, 50.0]); // entire segment
  assert.ok(Math.abs(full - 14300) < 300, `~14.3 km expected, was ${Math.round(full)} m`);

  const half = along([11.0, 50.0], [11.1, 50.0]); // up to the midpoint
  assert.ok(Math.abs(half - full / 2) < 50, "midpoint = half the distance");

  // Off-route target (0.1° north of the midpoint) projects onto the midpoint
  // → same along-distance; the perpendicular deviation does NOT count.
  const offRoute = along([11.0, 50.0], [11.1, 50.1]);
  assert.ok(Math.abs(offRoute - half) < 50, "deviation across the route does not change the along-distance");

  // Without a template → null.
  assert.equal(Planner.prototype._alongTemplateMeters.call({ _templateCoords: () => [] }, {}, [11, 50], [11.2, 50]), null);
});
