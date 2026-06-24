// HTTP client for the GoneCycling sync API (/api/v1). Pure ES module without
// dependencies (uses `fetch`/`btoa`/`atob`, available in browser and Node).
//
// The client only knows the derived `authToken` (Bearer) and moves
// ciphertext bytes. En-/decryption happens in crypto.js at the caller.

/** Thrown on HTTP 409 (optimistic lock: stale base revision). */
export class ConflictError extends Error {
  constructor(currentRevision) {
    super("Conflict: stale revision (current: " + currentRevision + ").");
    this.name = "ConflictError";
    this.currentRevision = currentRevision;
  }
}

function bytesToB64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}

function b64ToBytes(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class SyncClient {
  /**
   * @param {string} baseUrl  e.g. "https://host/api/v1"
   * @param {string} authToken  derived Bearer token (see crypto.deriveKeys)
   */
  constructor(baseUrl, authToken) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.authToken = authToken;
  }

  _headers(withJson) {
    const headers = { Authorization: "Bearer " + this.authToken };
    if (withJson) headers["Content-Type"] = "application/json";
    return headers;
  }

  /** Create/"greet" the Vault and return the manifest. */
  async pair() {
    const res = await fetch(this.baseUrl + "/pair", { method: "POST", headers: this._headers() });
    if (!res.ok) throw new Error("pair failed: HTTP " + res.status);
    return res.json();
  }

  /** Manifest: existing namespaces + revisions. */
  async manifest() {
    const res = await fetch(this.baseUrl + "/blobs", { headers: this._headers() });
    if (!res.ok) throw new Error("manifest failed: HTTP " + res.status);
    return res.json();
  }

  /**
   * Loads the ciphertext of a namespace.
   * @returns {Promise<null|{blob:Uint8Array, revision:number, contentVersion:number, updatedAt:string}>}
   *          `null` if no blob exists (yet) (HTTP 404).
   */
  async pull(namespace) {
    const res = await fetch(this.baseUrl + "/blobs/" + namespace, { headers: this._headers() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("pull failed: HTTP " + res.status);
    const data = await res.json();
    return {
      blob: b64ToBytes(data.ciphertext),
      revision: data.revision,
      contentVersion: data.content_version,
      updatedAt: data.updated_at,
    };
  }

  /**
   * Uploads ciphertext. If `baseRevision` is passed and does not match the
   * server revision, the client throws `ConflictError`.
   * @returns {Promise<object>} Blob metadata including the new `revision`.
   */
  async push(namespace, blobBytes, { contentVersion = 1, baseRevision } = {}) {
    const body = { ciphertext: bytesToB64(blobBytes), content_version: contentVersion };
    if (baseRevision !== undefined) body.base_revision = baseRevision;
    const res = await fetch(this.baseUrl + "/blobs/" + namespace, {
      method: "PUT",
      headers: this._headers(true),
      body: JSON.stringify(body),
    });
    if (res.status === 409) {
      const data = await res.json();
      throw new ConflictError(data.current_revision);
    }
    if (!res.ok) throw new Error("push failed: HTTP " + res.status);
    return res.json();
  }

  /** Delete a single namespace. */
  async deleteNamespace(namespace) {
    const res = await fetch(this.baseUrl + "/blobs/" + namespace, {
      method: "DELETE",
      headers: this._headers(),
    });
    if (!res.ok) throw new Error("Delete failed: HTTP " + res.status);
  }

  /** Delete the entire Vault (token rotation / GDPR). */
  async deleteVault() {
    const res = await fetch(this.baseUrl + "/vault", { method: "DELETE", headers: this._headers() });
    if (!res.ok) throw new Error("Vault delete failed: HTTP " + res.status);
  }
}
