import { test } from "node:test";
import assert from "node:assert/strict";

import { pairingUri } from "../static/js/pairing.js";

test("pairingUri baut den Protokoll-URI gonecycling://pair?v=1&s=<token>", () => {
  assert.equal(pairingUri("abcDEF-_0123"), "gonecycling://pair?v=1&s=abcDEF-_0123");
  assert.equal(pairingUri("  x  "), "gonecycling://pair?v=1&s=x");
  assert.equal(pairingUri(""), "gonecycling://pair?v=1&s=");
  assert.equal(pairingUri(null), "gonecycling://pair?v=1&s=");
});
