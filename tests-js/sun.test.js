import { test } from "node:test";
import assert from "node:assert/strict";

import { sunTimes } from "../static/js/sun.js";

test("sunTimes: plausibler Auf-/Untergang (Greenwich, Tagundnachtgleiche)", () => {
  const { sunrise, sunset } = sunTimes(new Date(Date.UTC(2023, 2, 20)), 51.4769, -0.0005);
  assert.ok(sunrise instanceof Date && sunset instanceof Date);
  assert.ok(sunset.getTime() > sunrise.getTime());
  // At lon≈0 UTC ≈ local time; at the equinox sunrise ~6:00, sunset ~18:00.
  assert.ok(sunrise.getUTCHours() >= 5 && sunrise.getUTCHours() <= 7, `sunrise ${sunrise.toISOString()}`);
  assert.ok(sunset.getUTCHours() >= 17 && sunset.getUTCHours() <= 19, `sunset ${sunset.toISOString()}`);
});

test("sunTimes: Polartag (Nähe Nordpol im Sommer) → kein Untergang", () => {
  const r = sunTimes(new Date(Date.UTC(2023, 5, 21)), 89, 0);
  assert.equal(r.sunset, null);
  assert.equal(r.polar, "day");
});
