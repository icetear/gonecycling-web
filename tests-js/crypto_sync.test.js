// Node tests for the browser crypto and sync modules (run headless via
// `node --test`). The pure crypto tests always run; the integration tests
// only when the dev server is reachable (otherwise skipped).
import { test } from "node:test";
import assert from "node:assert/strict";

import * as gcCrypto from "../static/js/crypto.js";
import { ConflictError, SyncClient } from "../static/js/sync.js";

const BASE = process.env.GC_BASE_URL || "http://127.0.0.1:8011/api/v1";

// Server reachability (top-level await is allowed in the ES module).
let serverUp = false;
try {
  const res = await fetch(BASE + "/health");
  serverUp = res.ok;
} catch {
  serverUp = false;
}
const skipIntegration = serverUp ? false : `Server nicht erreichbar (${BASE})`;

// --- Crypto ----------------------------------------------------------------

test("Envelope-Roundtrip ver-/entschlüsselt korrekt", async () => {
  const { encKey } = await gcCrypto.deriveKeys(gcCrypto.generateMasterSecret());
  const payload = { titel: "Donauradweg", n: 3, neg: -12.5, list: [1, 2] };
  const blob = await gcCrypto.encryptJSON(encKey, "trips", payload);
  // Check the header: magic "GCS" + version 1.
  assert.equal(String.fromCharCode(blob[0], blob[1], blob[2]), "GCS");
  assert.equal(blob[3], 1);
  assert.deepEqual(await gcCrypto.decryptJSON(encKey, "trips", blob), payload);
});

test("deriveKeys ist deterministisch", async () => {
  const secret = gcCrypto.generateMasterSecret();
  const a = await gcCrypto.deriveKeys(secret);
  const b = await gcCrypto.deriveKeys(secret);
  assert.equal(a.authToken, b.authToken);
  assert.ok(a.authToken.length >= 32);
});

test("falscher Namespace entschlüsselt nicht (AAD-Bindung)", async () => {
  const { encKey } = await gcCrypto.deriveKeys(gcCrypto.generateMasterSecret());
  const blob = await gcCrypto.encryptJSON(encKey, "trips", { x: 1 });
  await assert.rejects(() => gcCrypto.decryptJSON(encKey, "rides", blob));
});

test("anderer Schlüssel entschlüsselt nicht", async () => {
  const { encKey } = await gcCrypto.deriveKeys(gcCrypto.generateMasterSecret());
  const { encKey: other } = await gcCrypto.deriveKeys(gcCrypto.generateMasterSecret());
  const blob = await gcCrypto.encryptJSON(encKey, "trips", { x: 1 });
  await assert.rejects(() => gcCrypto.decryptJSON(other, "trips", blob));
});

test("manipulierter Blob entschlüsselt nicht", async () => {
  const { encKey } = await gcCrypto.deriveKeys(gcCrypto.generateMasterSecret());
  const blob = await gcCrypto.encryptJSON(encKey, "trips", { x: 1 });
  blob[blob.length - 1] ^= 0xff; // flip GCM tag/ciphertext
  await assert.rejects(() => gcCrypto.decryptJSON(encKey, "trips", blob));
});

test("Token-Roundtrip über base64url", () => {
  const secret = gcCrypto.generateMasterSecret();
  assert.deepEqual(gcCrypto.decodeMasterSecret(gcCrypto.encodeMasterSecret(secret)), secret);
});

// --- Integration against the running server --------------------------------

test("Integration: verschlüsselter Roundtrip, Konflikt & Löschen", { skip: skipIntegration }, async () => {
  const { authToken, encKey } = await gcCrypto.deriveKeys(gcCrypto.generateMasterSecret());
  const client = new SyncClient(BASE, authToken);

  const pair = await client.pair();
  assert.equal(pair.paired, true);

  const payload = { hello: "welt", liste: [1, 2, 3] };
  const put = await client.push("demo", await gcCrypto.encryptJSON(encKey, "demo", payload));
  assert.equal(put.revision, 1);

  const pulled = await client.pull("demo");
  assert.equal(pulled.revision, 1);
  assert.deepEqual(await gcCrypto.decryptJSON(encKey, "demo", pulled.blob), payload);

  // Server only stores ciphertext: the plaintext marker must not be in it.
  assert.ok(!Buffer.from(pulled.blob).toString("latin1").includes("welt"));

  // Optimistic lock: stale base_revision → 409 → ConflictError.
  await client.push("demo", await gcCrypto.encryptJSON(encKey, "demo", { v: 2 })); // rev 2
  await assert.rejects(
    () => client.push("demo", new Uint8Array([1, 2, 3]), { baseRevision: 1 }),
    (err) => err instanceof ConflictError && err.currentRevision === 2,
  );

  // Delete vault → namespace gone.
  await client.deleteVault();
  assert.equal(await client.pull("demo"), null);
});
