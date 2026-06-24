// Tests of the pure helpers of the guided stage planner (band + ranking).
import { test } from "node:test";
import assert from "node:assert/strict";

import { withinBand, dedupByName, rankCandidates } from "../static/js/guided.js";

test("withinBand: 0,6…1,4× der Wunschdistanz", () => {
  const desired = 60000;
  assert.equal(withinBand(60000, desired), true);
  assert.equal(withinBand(40000, desired), true); // 0,67×
  assert.equal(withinBand(80000, desired), true); // 1,33×
  assert.equal(withinBand(30000, desired), false); // 0,5× < 0,6×
  assert.equal(withinBand(90000, desired), false); // 1,5× > 1,4×
});

test("dedupByName: erster Treffer pro Name gewinnt, Namenlose raus", () => {
  const out = dedupByName([
    { name: "Hotel A", distanceMeters: 1 },
    { name: "hotel a", distanceMeters: 2 }, // same name (case-insensitive)
    { name: "", distanceMeters: 3 }, // without name → out
    { name: "Bahnhof", distanceMeters: 4 },
  ]);
  assert.deepEqual(out.map((c) => [c.name, c.distanceMeters]), [
    ["Hotel A", 1],
    ["Bahnhof", 4],
  ]);
});

test("rankCandidates: Pflicht zuerst, dann nächste an der Wunschdistanz", () => {
  const desired = 60000;
  const ranked = rankCandidates(
    [
      { name: "Weit", distanceMeters: 80000, mandatory: false },
      { name: "Genau", distanceMeters: 61000, mandatory: false },
      { name: "Pflichtstopp", distanceMeters: 95000, mandatory: true },
      { name: "Etwas daneben", distanceMeters: 50000, mandatory: false },
    ],
    desired,
  );
  assert.equal(ranked[0].name, "Pflichtstopp"); // mandatory always first
  assert.deepEqual(
    ranked.slice(1).map((c) => c.name),
    ["Genau", "Etwas daneben", "Weit"], // |dist - 60k|: 1k, 10k, 20k
  );
});

test("rankCandidates: begrenzt auf `limit`", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ name: `C${i}`, distanceMeters: 60000 + i, mandatory: false }));
  assert.equal(rankCandidates(many, 60000, 12).length, 12);
});
