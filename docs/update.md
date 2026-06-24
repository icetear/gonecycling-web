# Update the Docker container from the remote repo

How to bring the running GoneCycling Web instance on the server (e.g.
`https://example.com/gonecycling`) up to date after changes have been pushed to
the remote repository. Prerequisite: the initial installation per
[`deploy.md`](deploy.md) is done (repo clone + `.env` + a running container).

> Short version: **`git pull` → `docker compose -f docker-compose.prod.yml up -d --build`**.
> The image is rebuilt with the new code, the container is replaced; the data
> (SQLite on the volume) is preserved.

---

## Step by step

```bash
# 1) Onto the server
ssh your-user@example.com

# 2) Into the project folder (adjust the path if needed)
cd /opt/gonecycling-web

# 3) Fetch the latest state from the remote
git pull
#    Cleaner (discards local changes, exactly to the remote state):
#    git fetch origin && git reset --hard origin/master

# 4) Rebuild + replace the container (in the background)
docker compose -f docker-compose.prod.yml up -d --build

# 5) Check
docker compose -f docker-compose.prod.yml logs -f      # Ctrl+C to stop
curl -s http://127.0.0.1:8071/gonecycling/api/v1/health # -> {"status": "ok", ...}
```

Then verify in the browser: <https://example.com/gonecycling/>.

## What happens automatically

- **`--build`** rebuilds the image — within it the **static files** are collected
  (`collectstatic`, including the manifest).
- On **container start** the **database migrations** run automatically
  (`manage.py migrate`, see the `Dockerfile` CMD).
- **Data is preserved:** the encrypted sync blobs live in SQLite on the Docker
  volume `gonecycling-web_gcdata` (`/data/db.sqlite3`), not in the image.
- **`up -d`** replaces only the `web` container; a brief restart (a few seconds)
  is normal.

## Cleanup (optional)

Remove old, unused images after several updates:

```bash
docker image prune -f
```

## Only `.env` changed (no new code)?

Then a restart **without** a rebuild is enough:

```bash
docker compose -f docker-compose.prod.yml up -d
```

## Rollback (back to the previous state)

```bash
git log --oneline -n 5                 # find the desired commit
git checkout <commit-hash>             # or: git reset --hard <commit-hash>
docker compose -f docker-compose.prod.yml up -d --build
```

## Notes

- If only `docker-compose` (v1, with a hyphen) is available on the server instead
  of the `docker compose` plugin, just write `docker-compose` — the arguments are
  identical.
- Before a larger update, a **data backup** of the volume is worthwhile (see the
  "Operation" section in [`deploy.md`](deploy.md)).
- The app is offline-first and stateless-light — an update loses no trips/tours
  (they live encrypted in the volume and additionally in the app).
