# CLAUDE.md

Guide for Claude Code (claude.ai/code) when working in this repository.

## Project overview

`gonecycling-web` is the **anonymous, end-to-end-encrypted sync backend** for the
planned GoneCycling Companion web app (plan trips/routes on your PC).
Stack: **Python 3.12 + Django 5.1 + Django REST Framework**.

In addition there is an **optional** classic account layer (app `accounts`,
"upgrade") for users who want to sign in via email/password instead of only an
anonymous token. It is **strictly separated** from the zero-knowledge sync and,
for signed-in users, deliberately gives up anonymity (see rule + exception below).

The accompanying iOS app lives in a **separate** repo:
`~/Documents/GIT/FreeCycling` (product name/bundle = "GoneCycling"). This repo is
deliberately separate (different language/toolchain, own deployment, own
visibility).

When in doubt, read the `README.md` first — it describes the security model, the
API and setup in detail.

## The most important rule: zero-knowledge stays zero-knowledge

Anonymity is the brand core (the iOS app advertises "no account, no forced
cloud"). The **sync core** (`sync`, `/api/v1`) is **deliberately "dumb"** and
must stay that way:

1. **In the sync core, identity = `SHA-256(Bearer token)`.** The raw token is
   **never** stored. The sync itself knows **no** PII, no user accounts, no
   sessions/cookies — it stays token-based and anonymous.
2. **The server stores only ciphertext** (`SyncBlob.ciphertext`). It
   encrypts/decrypts **nothing**. **Never** add server-side decryption,
   plaintext processing of trips/routes, or any key storage to `sync`.
3. **Crypto belongs in the clients** (iOS app + browser), not here. The
   key/AEAD/envelope scheme is defined in a dedicated protocol document; the
   server only moves bytes.
4. **Data minimization:** keep no IP logs/analytics. The deletion paths
   (`DELETE /vault`, `DELETE /blobs/<ns>`) must be preserved (including the GDPR
   path).

### Exception: the optional account layer (`accounts`)

By explicit request there is an **optional** classic account path (app
`accounts`, "upgrade"): email + password, email confirmation, login/logout via
Django's session auth. For **signed-in** users the server deliberately stores PII
(name/email) **and** the `master_secret` (so that signing in on new devices can
decrypt the trips) — this gives up zero-knowledge for those users.

This is **strictly isolated** and changes nothing about the sync core:

- `sync`/`/api/v1` stays token-based, anonymous and zero-knowledge.
- Anonymous use **without** an account remains fully available (connect via token).
- Account logic lives **only** in `accounts` (session/CSRF, separate from `/api/v1`).
- **Never** add PII/sessions to `sync`; extend `accounts` instead.

If a task would weaken the **sync core** (PII/plaintext/key storage in
`sync`/`/api/v1`), ask first.

## Architecture

- **`config/`** — Django project: `settings.py` (env-driven), `urls.py`
  (`/api/v1/` → `sync`, `/` → `web`), `wsgi.py`/`asgi.py`.
- **`web/`** — planner frontend. `HomeView` (TemplateView) serves the
  single-page shell (`templates/index.html`) with the MapLibre map view
  (`static/js/app.js`, `static/css/app.css`). Start: OSM raster, centered on
  Bielefeld or – with permission – on the user's location. Crypto/sync (see
  `docs/sync-protocol.md`) and the actual planning follow here.
- **`sync/`** — the sync API app:
  - `models.py` — `Vault` (token_hash) and `SyncBlob` (vault, namespace,
    ciphertext, content_version, revision).
  - `auth.py` — `VaultTokenAuthentication` (Bearer token → hash, **without**
    DB access; creates no Vaults). `VaultIdentity` carries only the token hash.
  - `throttling.py` — `VaultRateThrottle` (limit per Vault).
  - `serializers.py` — `BlobUploadSerializer` (Base64/size validation).
  - `views.py` — APIViews: health, pair, blobs manifest, blob GET/PUT/DELETE,
    vault DELETE. **Optimistic lock** in `BlobView.put` via `base_revision`
    → `409` on a stale base (last-write-wins with conflict detection;
    deliberately **no** CRDT/real-time sync).
  - `urls.py`, `migrations/`, `tests/`.

Vaults are created **only on write access** (`pair`, `PUT`) — read access
creates nothing (prevents empty-Vault spam from guessed tokens).

- **`accounts/`** — optional account layer ("upgrade", **not** zero-knowledge;
  see the exception above). Session/CSRF-based under `/accounts/`, separate from
  the token-based `/api/v1`:
  - `models.py` — `Profile` (OneToOne to Django's `User`; `username` = email,
    `first_name`/`last_name` = first/last name, `is_active` = email-confirmed)
    with a Vault binding (FK `sync.Vault`) + a server-held `master_secret`.
  - `views.py` — plain Django views (JSON): `register`, `activate/<token>`,
    `login`, `logout`, `me`, `resend` (password reset/change to follow).
    Activation token stateless via `django.core.signing`; Vault binding via
    `sync.auth.hash_token` (no second hash/crypto implementation).
  - `urls.py`, `migrations/`, `tests/`. Its frontend: `static/js/accounts.js`
    (CSRF cookie → `X-CSRFToken`) + burger menu/modals in `templates/index.html`.

## Build / Run / Test

There is no CLI build; it's a plain Django project. Locally SQLite is enough and
**no** environment variables are needed (DEBUG=True + dev key as default).

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
python manage.py migrate          # creates db.sqlite3
python manage.py runserver        # http://localhost:8000/api/v1/health
pytest                            # Tests
ruff check .                      # Lint
```

(Or via `Makefile`: `make install|migrate|run|test|lint`.)

Production: `docker compose up --build` (Gunicorn + PostgreSQL). In production
`DEBUG=False`, a real `DJANGO_SECRET_KEY` and `DJANGO_ALLOWED_HOSTS` **must** be
set (a guard in `settings.py` enforces this).

## Conventions

- **Comments/docs in English**, identifiers (classes/functions/variables) in
  English. Explain methods/classes/non-trivial logic (the purpose, not a repeat
  of the name); where helpful, a short example.
- **Settings env-driven** (`django-environ`); no secrets in code. Add new
  configuration via environment variables + `.env.example`.
- **Tests are pytest** (`pytest-django`, `pytest.ini` sets
  `DJANGO_SETTINGS_MODULE`). Cover new endpoints/logic with tests; prefer pure
  API/logic tests. The frontend additionally has **Node tests** in `tests-js/`
  (`npm test` or `node --import ./tests-js/setup.mjs --test`); the `gc/` importmap
  hook (`tests-js/gc-hooks.mjs`) maps to `static/js/`. Cover new `static/js/`
  modules and `data-i18n` strings there too (the i18n tests enforce translations).
- **Keep migrations current:** after model changes run `makemigrations` and
  commit the migration; `makemigrations --check --dry-run` must report
  "No changes".
- **Lint:** keep `ruff check .` clean (configuration in `pyproject.toml`).
- **JSON-only sync API:** the renderers/parsers of `sync`/`/api/v1` are limited
  to JSON (no Browsable API) and use exclusively the Vault token auth. The
  optional `accounts` layer lives **outside** `/api/v1` and uses Django's
  session/CSRF (the admin exists only for the operator, not for the sync).

## Roadmap (context)

Status: the sync backend (`sync`) is in place; the crypto/sync protocol is
specified in `docs/sync-protocol.md`; the planner frontend (`web`) has started
with the map view. Next up: the WebCrypto sync client in the browser (per the
protocol), the actual route/trip planning on the map (MapLibre + routing
provider OSRM/ORS/BRouter) and the iOS sync client. See `README.md`.
