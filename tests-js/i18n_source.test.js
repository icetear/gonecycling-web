// Contract "render code ↔ dictionary": every string in the planner/app code
// that dynamically runs through the translation function (tr("…") or t("…")) must
// actually be translated. Fails as soon as a new translated
// call is added WITHOUT a dictionary entry (= would stay German in EN mode).
// Covers the dynamically rendered views that a pure template scan
// does not see (map popups, detail panels, guided planner, dialogs …).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
  removeItem() {}
}
globalThis.localStorage = new MemoryStorage();

const { t, setLang } = await import("../static/js/i18n.js");

const SOURCES = ["planner.js", "app.js", "basemaps.js"];

// Removes block and pure line comments so that German comment text with
// a stray `t(...)` is not mistakenly treated as a translation key.
function stripComments(src) {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlock
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

// Collects the string literals from tr("…")/t("…") calls (both quote styles).
function collectLiterals() {
  const out = new Set();
  for (const f of SOURCES) {
    const src = stripComments(readFileSync(new URL("../static/js/" + f, import.meta.url), "utf8"));
    for (const m of src.matchAll(/\b(?:tr|t)\(\s*(["'])((?:\\.|(?!\1).)*)\1/g)) {
      const raw = m[2]
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "\t")
        .replace(/\\(["'\\])/g, "$1");
      out.add(raw);
    }
  }
  return [...out];
}

const LITERALS = collectLiterals();

// Terms whose English version is DELIBERATELY identical to the German one.
const IDENTICAL_OK = new Set(["Original", "Start", "Tour", "Route", "Status"]);

test("Render-Code enthält viele Übersetzungsaufrufe (breite Abdeckung)", () => {
  assert.ok(LITERALS.length >= 100, `nur ${LITERALS.length} tr()/t()-Literale gefunden`);
});

test("jedes Übersetzungs-Literal liefert im EN-Modus einen nichtleeren String", () => {
  setLang("en");
  for (const k of LITERALS) {
    const v = t(k);
    assert.equal(typeof v, "string", `t(${JSON.stringify(k)}) ist kein String`);
    assert.ok(v.length > 0, `t(${JSON.stringify(k)}) ist leer`);
  }
});

test("jedes Übersetzungs-Literal ist im EN-Modus übersetzt (oder bewusst identisch)", () => {
  setLang("en");
  const untranslated = LITERALS.filter((k) => t(k) === k && !IDENTICAL_OK.has(k));
  assert.deepEqual(
    untranslated,
    [],
    `Diese im Code übersetzten Strings bleiben im EN-Modus deutsch — Eintrag in i18n.js ergänzen ` +
      `(oder, falls EN==DE beabsichtigt, in IDENTICAL_OK aufnehmen):\n  ${untranslated
        .map((s) => JSON.stringify(s))
        .join("\n  ")}`,
  );
});

test("im DE-Modus gibt jedes Literal sich selbst zurück (Passthrough)", () => {
  setLang("de");
  for (const k of LITERALS) assert.equal(t(k), k);
});

test("ausgewählte dynamische Strings übersetzen wie erwartet", () => {
  setLang("en");
  const expected = {
    Zwischenpunkt: "Intermediate point",
    Gesamtdistanz: "Total distance",
    "✏️ Tour bearbeiten": "✏️ Edit tour",
  };
  for (const [de, en] of Object.entries(expected)) {
    assert.ok(LITERALS.includes(de), `Literal "${de}" nicht im Code gefunden`);
    assert.equal(t(de), en);
  }
});
