// Crypto building blocks of the GoneCycling sync per docs/sync-protocol.md.
//
// Pure ES module without dependencies: runs in the browser AND in Node (Web Crypto
// API + btoa/atob exist in both). The server never gets to see the master_secret
// or the enc_key — only the derived auth_token and finished ciphertext.

const subtle = globalThis.crypto.subtle;
const _enc = new TextEncoder();
const _dec = new TextDecoder();

// --- Byte/text/Base64 helpers ----------------------------------------------

/** UTF-8 string → Uint8Array. */
export function utf8(str) {
  return _enc.encode(str);
}

/** Uint8Array → UTF-8 string. */
export function fromUtf8(bytes) {
  return _dec.decode(bytes);
}

function _toBinaryString(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return bin;
}

function _fromBinaryString(bin) {
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Bytes → standard Base64. */
export function b64Encode(bytes) {
  return btoa(_toBinaryString(bytes));
}

/** Standard Base64 → bytes. */
export function b64Decode(str) {
  return _fromBinaryString(atob(str));
}

/** Bytes → URL-safe Base64 without padding (for token/QR). */
export function b64urlEncode(bytes) {
  return btoa(_toBinaryString(bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** URL-safe Base64 → bytes. */
export function b64urlDecode(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  return _fromBinaryString(atob(b64));
}

// --- Protocol constants (see docs/sync-protocol.md) ------------------------

const MAGIC = utf8("GCS"); // 3 bytes
const VERSION = 0x01;
const HEADER_LEN = 3 + 1 + 1 + 12; // magic + version + flags + nonce
const HKDF_SALT = utf8("gonecycling-sync/v1");
const INFO_AUTH = utf8("gonecycling/auth/v1");
const INFO_ENC = utf8("gonecycling/enc/v1");

// --- master_secret ----------------------------------------------------------

/** Generates a fresh 256-bit master_secret (32 bytes). */
export function generateMasterSecret() {
  const secret = new Uint8Array(32);
  globalThis.crypto.getRandomValues(secret);
  return secret;
}

/** master_secret → URL-safe code (for input/QR). */
export function encodeMasterSecret(secret) {
  return b64urlEncode(secret);
}

/** Code → master_secret (32 bytes); throws on wrong length. */
export function decodeMasterSecret(code) {
  const secret = b64urlDecode(code.trim());
  if (secret.length !== 32) {
    throw new Error("Invalid token (master_secret must be 32 bytes).");
  }
  return secret;
}

// --- Key derivation (HKDF-SHA256) ------------------------------------------

async function hkdf(masterSecret, info, lengthBytes) {
  const ikm = await subtle.importKey("raw", masterSecret, "HKDF", false, ["deriveBits"]);
  const bits = await subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info },
    ikm,
    lengthBytes * 8,
  );
  return new Uint8Array(bits);
}

/**
 * Derives the two keys from the master_secret:
 * - `authToken` (string): goes to the server as a Bearer (identifies the vault).
 * - `encKey` (CryptoKey, AES-256-GCM, **not** exportable): stays local.
 */
export async function deriveKeys(masterSecret) {
  const authRaw = await hkdf(masterSecret, INFO_AUTH, 32);
  const encRaw = await hkdf(masterSecret, INFO_ENC, 32);
  const authToken = b64urlEncode(authRaw);
  const encKey = await subtle.importKey("raw", encRaw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  return { authToken, encKey };
}

// --- AEAD-Envelope ----------------------------------------------------------

/** Additional authenticated data: magic || version || flags || namespace. */
function buildAAD(namespace, flags) {
  const ns = utf8(namespace);
  const aad = new Uint8Array(3 + 1 + 1 + ns.length);
  aad.set(MAGIC, 0);
  aad[3] = VERSION;
  aad[4] = flags;
  aad.set(ns, 5);
  return aad;
}

/**
 * Encrypts `plaintext` (Uint8Array) into an envelope blob (Uint8Array):
 * `magic | version | flags | nonce(12) | ciphertext+tag`.
 * `namespace` is bound into the AAD (protects against namespace swapping).
 */
export async function encryptEnvelope(encKey, namespace, plaintext) {
  const flags = 0x00; // v1: no compression
  const nonce = new Uint8Array(12);
  globalThis.crypto.getRandomValues(nonce);
  const ctTag = new Uint8Array(
    await subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: buildAAD(namespace, flags), tagLength: 128 },
      encKey,
      plaintext,
    ),
  );
  const blob = new Uint8Array(HEADER_LEN + ctTag.length);
  blob.set(MAGIC, 0);
  blob[3] = VERSION;
  blob[4] = flags;
  blob.set(nonce, 5);
  blob.set(ctTag, HEADER_LEN);
  return blob;
}

/** Decrypts an envelope blob; throws on tampering/wrong key/namespace. */
export async function decryptEnvelope(encKey, namespace, blob) {
  if (blob.length < HEADER_LEN + 16) throw new Error("Envelope too short.");
  for (let i = 0; i < 3; i++) {
    if (blob[i] !== MAGIC[i]) throw new Error("Invalid magic identifier.");
  }
  const version = blob[3];
  if (version !== VERSION) throw new Error("Unknown envelope version " + version + ".");
  const flags = blob[4];
  const nonce = blob.slice(5, HEADER_LEN);
  const ctTag = blob.slice(HEADER_LEN);
  const plaintext = new Uint8Array(
    await subtle.decrypt(
      { name: "AES-GCM", iv: nonce, additionalData: buildAAD(namespace, flags), tagLength: 128 },
      encKey,
      ctTag,
    ),
  );
  // flags bit0 (gzip) is not set in v1; possibly decompress here later.
  return plaintext;
}

// --- Convenient JSON wrappers ----------------------------------------------

/** Object → JSON → encrypted envelope. */
export async function encryptJSON(encKey, namespace, obj) {
  return encryptEnvelope(encKey, namespace, utf8(JSON.stringify(obj)));
}

/** Encrypted envelope → JSON → object. */
export async function decryptJSON(encKey, namespace, blob) {
  return JSON.parse(fromUtf8(await decryptEnvelope(encKey, namespace, blob)));
}
