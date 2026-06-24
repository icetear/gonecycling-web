# GoneCycling – Companion Sync Backend

Anonymous, **end-to-end-encrypted** sync backend for the planned GoneCycling
Companion web app (plan trips/routes on your PC). Django + Django REST Framework.

> Status: **Phase 1 – sync backend.** The planner frontend (MapLibre) follows
> separately. For now there is only the JSON API under `/api/v1/`.

## The idea in one sentence

The iOS app generates a random **256-bit token** (code + QR). You sign in to the
web app with that token. App and browser encrypt/decrypt the data **locally**;
the server stores only **ciphertext** under the **hash** of the token. The
operator of the server is technically **unable to read** users' trips/routes
(zero-knowledge) — this preserves the app's "no account, no forced cloud" DNA.

## Security & anonymity model

- **Identity = `SHA-256(auth_token)`.** From its secret `master_secret` the
  client derives two keys: an `auth_token` (sent to the server as a Bearer
  token) and an `enc_key` (stays local). The `master_secret` itself and the
  `enc_key` never leave the device. Whoever has the `master_secret` has the
  Vault.
- **No PII:** no email, no name, no password, no user accounts, no Django admin,
  no sessions/cookies.
- **The server stores only ciphertext.** Encryption (key derivation from the
  token, AES-GCM or similar) happens in the client/browser. **The server is
  deliberately "dumb".**
- **Revocation/rotation:** new token in the app → the old Vault can be deleted
  via `DELETE /vault` (this is also the GDPR deletion path).
- **Abuse protection:** rate limiting per IP (`AnonRateThrottle`) and per Vault
  (`VaultRateThrottle`).

> Note: the actual crypto scheme (key derivation, AEAD, envelope format) is the
> responsibility of the app and web client and is specified in
> [`docs/sync-protocol.md`](docs/sync-protocol.md). This backend stays
> independent of it — it only moves bytes.

## API

All endpoints under `/api/v1/`. Authentication via the
`Authorization: Bearer <token>` header (except `/health`).

| Method  | Path                 | Purpose |
|--------:|----------------------|---------|
| GET     | `/health`            | Health check (no token) |
| POST    | `/pair`              | Create/"greet" a Vault, return the manifest |
| GET     | `/blobs`             | Manifest: namespaces + revisions |
| GET     | `/blobs/<namespace>` | Load the ciphertext of a namespace |
| PUT     | `/blobs/<namespace>` | Upload ciphertext (optimistic lock) |
| DELETE  | `/blobs/<namespace>` | Delete a single namespace |
| DELETE  | `/vault`             | Delete the entire Vault (rotation/GDPR) |

`namespace` is e.g. `trips` or `rides` (allowed: `[a-z0-9_]`, max. 64).

**Upload body (`PUT`):**

```json
{
  "ciphertext": "<base64>",
  "content_version": 1,
  "base_revision": 3
}
```

`base_revision` is optional: if it is sent and does not match the server-side
revision, the server responds with **409 Conflict** and `current_revision` —
the client must reload/merge (last-write-wins with conflict detection;
deliberately no CRDT/real-time sync).

**Example:**

```bash
TOKEN=$(python -c "import secrets; print(secrets.token_hex(32))")
BASE=http://localhost:8000/api/v1

curl -s $BASE/health
curl -s -X POST $BASE/pair -H "Authorization: Bearer $TOKEN"
curl -s -X PUT $BASE/blobs/trips \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"ciphertext":"'"$(printf 'encrypted' | base64)"'"}'
curl -s $BASE/blobs/trips -H "Authorization: Bearer $TOKEN"
```

## Local setup (SQLite, without Docker)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
python manage.py migrate
python manage.py runserver
# Tests:
pytest
# Lint:
ruff check .
```

For local development **no** environment variables are needed — safe defaults
apply (`DEBUG=True`, SQLite file `db.sqlite3`).

## Production (Docker + PostgreSQL)

```bash
cp .env.example .env   # fill in (SECRET_KEY, ALLOWED_HOSTS, DATABASE_URL)
docker compose up --build
```

In production `DJANGO_SECRET_KEY` and `DJANGO_ALLOWED_HOSTS` **must** be set and
`DEBUG=False` must stay. Recommendation: run it behind a reverse proxy with TLS
(Caddy/nginx); EU hosting for GDPR.

## Privacy / GDPR

Once hosted, you are a controller within the meaning of the GDPR — including for
encrypted blobs + token hashes. Recommendations:

- E2EE keeps content exposure minimal (you cannot read the contents).
- Data minimization: keep no IP logs, no analytics.
- Deletion path available (`DELETE /vault`).
- Add a privacy policy + legal notice for the hosted instance.

## Relationship to the iOS app

The iOS app (GoneCycling) remains fully local and works without this server.
Sync is **opt-in**: users decide whether to connect their app to the web
platform via token. The source of truth for the data model is the app's
Codable JSON files (`trips.json`/`rides.json`); this backend only transports
their encrypted form.

## Roadmap

- [x] **Phase 1:** sync backend (this repo).
- [x] **Crypto/sync protocol** specified ([`docs/sync-protocol.md`](docs/sync-protocol.md)).
- [~] **Phase 2:** planner frontend (`web`) — map view (MapLibre + OSM)
      started; open: WebCrypto sync client + route/trip planning with the
      routing providers OSRM/ORS/BRouter.
- [ ] **iOS sync client:** generate token/QR, encrypt `trips.json`/`rides.json`
      and sync them against the API.
- [ ] **Phase 3:** optional premium features (sold on a separate website).
