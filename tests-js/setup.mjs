// Test preamble: registers the "gc/" resolution hook (see gc-hooks.mjs),
// before test files are loaded. Wired in via `node --import` (package.json).
import { register } from "node:module";
register("./gc-hooks.mjs", import.meta.url);

// `navigator` has only been a global object since Node 21. In the browser it
// always exists, and some modules read `navigator.language` already at import time
// (e.g. planner.js for currency/date formatting). On older Node
// versions (e.g. Node 20 in CI) that would throw a ReferenceError, even
// before a test sets up a JSDOM environment. Hence a minimal stub here,
// in case the runtime does not yet provide `navigator`. If `navigator` already
// runs (newer Node versions, JSDOM), it is left untouched.
if (typeof globalThis.navigator === "undefined") {
  globalThis.navigator = { language: "de" };
}
