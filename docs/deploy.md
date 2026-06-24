# Deployment: GoneCycling Web behind nginx under `/gonecycling`

Guide to running the web app on the Ubuntu server inside a Docker container and
making it available under **`https://example.com/gonecycling`** — analogous to
the existing ORS server under `/ors`.

Architecture: one container (Django + Gunicorn + WhiteNoise) listens **only
locally** on `127.0.0.1:8071`; the existing **nginx** terminates TLS and forwards
`/gonecycling/` to the container. Data (encrypted sync blobs) lives in a SQLite
file on a Docker volume.

> The app is stateless-light: it stores only **ciphertext** per anonymous token
> (zero-knowledge). No account, no sessions.

---

## 1. Get the code onto the server

```bash
# e.g. into /opt
cd /opt
git clone <repo-url> gonecycling-web        # or: git pull in the existing clone
cd gonecycling-web
```

## 2. Create `.env`

```bash
cp .env.example .env
# Generate SECRET_KEY:
python3 -c "import secrets; print(secrets.token_urlsafe(64))"
```

Fill in `.env` — at minimum:

```ini
DEBUG=False
DJANGO_SECRET_KEY=<the generated random value>
DJANGO_ALLOWED_HOSTS=example.com
GC_BASE_PATH=/gonecycling
GC_PORT=8071
```

(`GC_PORT` is freely choosable, but must match the nginx snippet and must not
collide with ORS or similar.)

## 3. Start the container

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

This builds the image, collects the static files (with manifest), applies the
migrations and starts Gunicorn. Check:

```bash
docker compose -f docker-compose.prod.yml logs -f
curl -s http://127.0.0.1:8071/gonecycling/api/v1/health   # -> {"status": "ok", ...}
```

## 4. Configure the reverse proxy

Have the web server forward `/gonecycling/` to the container (where the `/ors`
proxy already is). The proxy passes the **full path including `/gonecycling`**
through (no stripping) — Django routes under this prefix itself and serves the
statics under `/gonecycling/static/`.

**Apache** (example.com runs on Apache) — insert the directives from
[`deploy/apache-gonecycling.conf`](../deploy/apache-gonecycling.conf) into the
`<VirtualHost *:443>` block:

```bash
sudo a2enmod proxy proxy_http headers
sudo apachectl configtest && sudo systemctl reload apache2
```

So that Django accepts the forwarded host, set
`DJANGO_ALLOWED_HOSTS=example.com,127.0.0.1,localhost` in the `.env` and restart
the container (`docker compose -f docker-compose.prod.yml up -d`).

**nginx** (alternative): insert [`deploy/nginx-gonecycling.conf`](../deploy/nginx-gonecycling.conf)
into the `server { … }` block, then `sudo nginx -t && sudo systemctl reload nginx`.

## 5. Test

- Browser: <https://example.com/gonecycling/> → map view.
- Health: <https://example.com/gonecycling/api/v1/health>.
- In the **iOS app**: Settings → **GoneCycling Web** →
  - **Host (URL):** `https://example.com/gonecycling`
  - **Unique ID:** generate a new one (or enter an existing one),
  - **Connect**, then sync under "Data sync".
  In the web app, enter the same Unique ID as the token → both share the same
  encrypted Vault.

---

## Operation

- **Update:** `git pull && docker compose -f docker-compose.prod.yml up -d --build` — in detail in [`update.md`](update.md).
- **Logs:** `docker compose -f docker-compose.prod.yml logs -f`
- **Stop:** `docker compose -f docker-compose.prod.yml down`
- **Data:** lives in the volume `gonecycling-web_gcdata` (SQLite). Back it up e.g. with
  `docker run --rm -v gonecycling-web_gcdata:/d -v "$PWD":/b alpine tar czf /b/gcdata-backup.tgz -C /d .`
- **PostgreSQL instead of SQLite** (optional): add a `db` service and set
  `DATABASE_URL=postgres://…` in `.env` (see `docker-compose.yml` as a template).

## Notes

- nginx handles HTTPS; Django trusts `X-Forwarded-Proto` (already set).
- If the app should run at the domain root, empty `GC_BASE_PATH` and adjust the
  nginx snippet accordingly.
- Throttling/blob size are adjustable via env variables (see `.env.example`).
