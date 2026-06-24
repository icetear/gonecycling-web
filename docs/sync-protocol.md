# GoneCycling Sync & Crypto Protocol v1

Binding specification that the **iOS app** and the **web client** agree on. The
server (`gonecycling-web`) is independent of it — it only moves bytes (see
`README.md`). Goal: convenient multi-device sync **without** the server being
able to read the trips/routes (zero-knowledge).

> Status: draft v1. Version bytes in the envelope allow later, backward-
> compatible extensions.

## 1. Terms

| Term              | Meaning |
|-------------------|---------|
| `master_secret`   | 256-bit random value. **The** user's secret (QR/code). Never leaves the device unencrypted and is **never** sent to the server. |
| `auth_token`      | Derived from `master_secret`. Sent to the server as `Authorization: Bearer`. Identifies the Vault. |
| `enc_key`         | AES-256 key derived from `master_secret`. **Always** stays local. |
| Vault             | Server-side area, identified via `SHA-256(auth_token)`. |
| Namespace         | Logical data set: `trips` or `rides`. |
| Blob              | Encrypted content of a namespace (one `trips.json`/`rides.json`). |
| `revision`        | Server-side counter per blob (optimistic lock). |
| `content_version` | Schema version of the **decrypted** content (maintained by the client). |

## 2. Key hierarchy

```
master_secret (32 bytes, random)
   │  HKDF-SHA256 (RFC 5869), salt = "gonecycling-sync/v1"
   ├── info = "gonecycling/auth/v1" ─► auth_token  (32 bytes → base64url) ──► server (Bearer)
   └── info = "gonecycling/enc/v1"  ─► enc_key      (32 bytes, AES-256)    ──► local only
```

Crucially: the server sees **only** `auth_token`. From one HKDF output you can
recompute neither `master_secret` nor the sibling output `enc_key` — which is why
even the server operator cannot decrypt the blobs.

- **KDF:** HKDF with SHA-256. `salt = UTF8("gonecycling-sync/v1")` (fixed, public).
- **Output length:** 32 bytes each.
- `master_secret` has full 256 bits of entropy → no password hashing (Argon2) needed.

## 3. Representation of the `master_secret`

- **Primary (QR):** URI `gonecycling://pair?v=1&s=<base64url(master_secret)>`.
- **Manual (fallback):** the `base64url` string (43 characters) — grouped in
  blocks of 4 for easier entry.
- Optionally append a 1-byte checksum (`crc8`) to the code to catch typos early
  (not security-relevant).

## 4. Envelope format (the stored blob)

The byte stream stored in `SyncBlob.ciphertext`:

```
Offset  Length  Field
0       3      magic   = ASCII "GCS"            (GoneCycling Sync)
3       1      version = 0x01
4       1      flags   (Bit0: payload gzip-compressed; remaining reserved = 0)
5       12     nonce   (AES-GCM IV, freshly random per encryption)
17      N      ciphertext || tag   (AES-256-GCM output, 16-byte tag at the end)
```

- **AEAD:** AES-256-GCM, 128-bit tag.
- **AAD (authenticated, not encrypted):** `magic || version || flags || UTF8(namespace)`.
  Among other things, this binds the namespace to the blob → a `trips` blob
  cannot be slipped in as a `rides` blob (decryption fails).
- **Plaintext:** `UTF8(JSON)` of the respective store, optionally gzipped first
  (then `flags` Bit0 = 1).
- **nonce:** 12 bytes from a CSPRNG, **never** reused (a GCM requirement).

## 5. Encrypt / decrypt (reference flow)

**Encrypt** (before `PUT`):
1. `plaintext = UTF8(JSON)` (optionally gzip → set flags).
2. `nonce = random(12)`.
3. `aad = magic || version || flags || UTF8(namespace)`.
4. `ct_tag = AES_GCM_Seal(enc_key, nonce, plaintext, aad)`.
5. `blob = magic || version || flags || nonce || ct_tag`.
6. `PUT /blobs/<namespace>` with `ciphertext = base64(blob)`, `content_version`,
   `base_revision` (= last known revision).

**Decrypt** (after `GET`):
1. `blob = base64decode(ciphertext)`; check the header (magic/version).
2. Read `aad`/`nonce`/`ct_tag` from the blob.
3. `plaintext = AES_GCM_Open(enc_key, nonce, ct_tag, aad)` (fails on
   tampering/wrong key/namespace).
4. optionally gunzip → `JSON`.

**Crypto mapping:**

| Step | Browser (WebCrypto) | iOS (CryptoKit) |
|------|----------------------|-----------------|
| HKDF   | `subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info}, …, 256)` | `HKDF<SHA256>.deriveKey(inputKeyMaterial:salt:info:outputByteCount:32)` |
| AES-GCM | `subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:aad}, key, pt)` | `AES.GCM.seal(pt, using:key, nonce:.init(data:nonce), authenticating:aad)` |

(CryptoKit's `.combined` includes the nonce — here use `ciphertext` + `tag`
instead and carry the nonce yourself in the envelope.)

## 6. Sync flow

1. **Pairing:** the client derives `auth_token` → `POST /pair`. Response =
   manifest (existing namespaces + `revision` + `updated_at`).
2. **Pull:** for each desired namespace `GET /blobs/<ns>` → decrypt.
3. **Push:** after a local change `PUT /blobs/<ns>` with `base_revision` = last
   known revision.
4. **Manifest reconciliation:** `GET /blobs` returns the current revision per
   namespace; if it differs from the locally known one, pull first.

### Conflict handling (two levels)

- **API level (detection):** if `base_revision` does not match the server
  revision, the server responds `409` + `current_revision`. The server merges
  nothing (it only sees ciphertext).
- **App level (resolution):** the client loads the current version, decrypts and
  resolves:
  - **v1 (simple):** whole-blob last-write-wins with a user choice
    ("keep/overwrite local" vs. "take remote").
  - **v2 (fine-grained):** object merge by `id` (union; on collision the object
    with the newer `updatedAt`). **Precondition:** every syncable object
    (Ride/Trip …) carries an `updatedAt`/`lastModified` — if not yet present in
    the iOS models, add it for this.

## 7. Schema versioning of the content

`content_version` is the version of the **decrypted** JSON schema. A client that
does not understand a newer version refuses the import (instead of corrupting
data) and asks for an app update. Migrations run client-side.

## 8. Token rotation & deletion

- **Rotation:** generate a new `master_secret` → new `auth_token` → new Vault.
  Remove the old one via `DELETE /vault` (with the **old** `auth_token`).
- **GDPR deletion:** `DELETE /vault` deletes everything for the token server-side.

## 9. Threat model

**The server learns:** `SHA-256(auth_token)`, blob **sizes**,
timestamps/revisions, access patterns (and the IP, if logged — so **do not**
log it).
**The server does NOT learn:** `master_secret`, `enc_key`, any plaintext of the
trips/routes.

Residual risks/assumptions: TLS protects `auth_token` in transit; an attacker who
has the `master_secret` has full access (it **is** the key) — so treat the
QR/code like a password. Size/timing metadata is not hidden (traffic analysis is
out of scope for v1).

## 10. Protocol versioning

`version` byte in the envelope + `v=1` in the pair URI. New AEAD/KDF methods or
fields are introduced as `version = 0x02 …`; clients must keep being able to
decrypt older envelopes.
