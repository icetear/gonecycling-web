// Tests of the account HTTP client (accounts.js): correct URL, method,
// CSRF header and error handling. Browser globals (location/window/document/
// fetch) are stubbed — no DOM/server needed.
import { test } from "node:test";
import assert from "node:assert/strict";

// Set globals BEFORE the import (accounts.js reads location/window on load).
globalThis.window = { GC_BASE_PATH: "" };
globalThis.location = { origin: "https://example.test" };
globalThis.document = { cookie: "csrftoken=abc123" };

let lastCall = null;
function stubFetch(response) {
  globalThis.fetch = async (url, opts) => {
    lastCall = { url, opts };
    return response;
  };
}
stubFetch({ ok: true, status: 200, json: async () => ({ ok: true }) });

const accounts = await import("../static/js/accounts.js");

test("register postet JSON an /accounts/register mit CSRF-Header", async () => {
  stubFetch({ ok: true, status: 201, json: async () => ({ detail: "ok" }) });
  await accounts.register({ email: "a@b.de", password: "x" });
  assert.equal(lastCall.url, "https://example.test/accounts/register");
  assert.equal(lastCall.opts.method, "POST");
  assert.equal(lastCall.opts.headers["X-CSRFToken"], "abc123");
  assert.equal(lastCall.opts.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(lastCall.opts.body), { email: "a@b.de", password: "x" });
});

test("login sendet email/password", async () => {
  stubFetch({ ok: true, status: 200, json: async () => ({ email: "a@b.de", master_secret: "S" }) });
  const data = await accounts.login("a@b.de", "geheim");
  assert.equal(lastCall.url, "https://example.test/accounts/login");
  assert.deepEqual(JSON.parse(lastCall.opts.body), { email: "a@b.de", password: "geheim" });
  assert.equal(data.master_secret, "S");
});

test("deleteProfile postet an /accounts/delete mit CSRF-Header", async () => {
  stubFetch({ ok: true, status: 200, json: async () => ({ detail: "Profile deleted." }) });
  await accounts.deleteProfile();
  assert.equal(lastCall.url, "https://example.test/accounts/delete");
  assert.equal(lastCall.opts.method, "POST");
  assert.equal(lastCall.opts.headers["X-CSRFToken"], "abc123");
});

test("me liefert authenticated:false bei !ok", async () => {
  stubFetch({ ok: false, status: 401, json: async () => ({}) });
  assert.deepEqual(await accounts.me(), { authenticated: false });
});

test("Fehler trägt detail-Message, status und reason", async () => {
  stubFetch({ ok: false, status: 403, json: async () => ({ detail: "bitte bestätigen", reason: "inactive" }) });
  await assert.rejects(
    () => accounts.login("a@b.de", "x"),
    (e) => e.message === "bitte bestätigen" && e.status === 403 && e.reason === "inactive",
  );
});
