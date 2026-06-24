// Contract "template ↔ dictionary": every translation key statically marked in the
// HTML template (data-i18n / data-i18n-ph / data-i18n-title) must be cleanly
// translated by the i18n engine. Fails as soon as a new
// translatable element is added WITHOUT a matching dictionary entry (= the element
// would stay German in EN mode). Pure text analysis, no DOM needed.
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

// Pull all statically marked keys from the real template.
const html = readFileSync(new URL("../templates/index.html", import.meta.url), "utf8");
const keys = new Set();
for (const m of html.matchAll(/data-i18n(?:-ph|-title)?="([^"]+)"/g)) keys.add(m[1]);
const KEYS = [...keys];

// Keys whose English version is DELIBERATELY identical to the German one
// (same word / proper name): allowed, so not a "missing from dictionary".
const IDENTICAL_OK = new Set(["+ POI", "Token", "Token …", "Tour", "🧭 Routing", "Upgrade"]);

test("Template enthält eine substanzielle Anzahl markierter Schlüssel", () => {
  assert.ok(KEYS.length >= 50, `nur ${KEYS.length} data-i18n-Schlüssel gefunden`);
});

test("jeder Template-Schlüssel liefert im EN-Modus einen nichtleeren String", () => {
  setLang("en");
  for (const k of KEYS) {
    const v = t(k);
    assert.equal(typeof v, "string", `t("${k}") ist kein String`);
    assert.ok(v.trim().length > 0, `t("${k}") ist leer`);
  }
});

test("im DE-Modus gibt jeder Template-Schlüssel sich selbst zurück (Passthrough)", () => {
  setLang("de");
  for (const k of KEYS) assert.equal(t(k), k, `t("${k}") (de) sollte unverändert sein`);
});

test("jeder Template-Schlüssel ist im EN-Modus übersetzt (oder bewusst identisch)", () => {
  setLang("en");
  const untranslated = KEYS.filter((k) => t(k) === k && !IDENTICAL_OK.has(k));
  assert.deepEqual(
    untranslated,
    [],
    `Diese Template-Schlüssel bleiben im EN-Modus deutsch — Wörterbucheintrag in i18n.js ergänzen ` +
      `(oder, falls EN==DE beabsichtigt, in IDENTICAL_OK aufnehmen):\n  ${untranslated.join("\n  ")}`,
  );
});

test("ausgewählte Navigations-/Einstellungs-Schlüssel übersetzen wie erwartet", () => {
  setLang("en");
  const expected = {
    Reisen: "Trips",
    Touren: "Tours",
    Einstellungen: "Settings",
    Verbinden: "Connect",
    Suchen: "Search",
    Trennen: "Disconnect",
  };
  for (const [de, en] of Object.entries(expected)) {
    assert.ok(keys.has(de), `Schlüssel "${de}" fehlt im Template`);
    assert.equal(t(de), en);
  }
});
