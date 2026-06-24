# Update button in the admin (with host watcher)

Lets you trigger a server update (git pull + container rebuild) **from the web
interface** — after logging in as a Django superuser.

## Security model (important)

A container cannot rebuild itself. Therefore:

1. The protected page **`/gonecycling/deploy/`** (only for signed-in
   staff/superusers) only writes **a signal** on click — the file
   `deploy-state/request`. It runs **nothing** privileged itself.
2. A **systemd watcher on the host** (outside the container) detects the file
   and runs `git pull --ff-only` + `docker compose … up -d --build`.

This keeps git/docker outside the internet-exposed container; via the web you
can only trigger "redeploy the configured repo", not arbitrary commands. **The
Docker socket is NOT mounted into the container.**

## One-time setup on the server

### 1. Migrate Django auth/admin + create a superuser

After the next deploy the auth migrations run automatically. Then:

```bash
docker compose -f docker-compose.prod.yml exec web python manage.py createsuperuser
```

Test login: <https://example.com/gonecycling/admin/>.

### 2. Install the host watcher

If needed, adjust the paths in the two unit files to your repo location
(default: `/opt/gonecycling-web`); they must match the bind mount
`./deploy-state:/deploy` from `docker-compose.prod.yml`.

```bash
sudo cp deploy/host/gonecycling-deploy.service /etc/systemd/system/
sudo cp deploy/host/gonecycling-deploy.path    /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gonecycling-deploy.path
```

Prerequisites:
- The repo folder is a git clone with a remote; `git pull` must run without
  prompting (for a private repo, store a deploy key / token for root).
- The service runs as **root** (Docker access). Alternatively set
  `User=<docker-authorized-user>` in the `.service` file.
- `docker compose` (v2). With `docker-compose` (v1), set
  `Environment=GC_COMPOSE=docker-compose -f docker-compose.prod.yml` in the
  `.service` file.

### 3. Restart the container with the bind mount

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

(creates `deploy-state/` and mounts it as `/deploy` into the container.)

## Usage

On the **admin home page** (<https://example.com/gonecycling/admin/>) there is a
**"Server update"** panel at the top with two buttons:

- **Check version** — the watcher runs `git fetch` and compares the installed
  state against `origin` → shows "up to date" or "N commit(s) behind" (along with
  commit hashes/date).
- **Update now** — `git pull --ff-only` + rebuild. After one or two minutes,
  reload the page → status (`ok`/`failed`, commit). Log:
  `deploy-state/deploy.log`.

The panel shows a **spinner + live status** (AJAX polling) — no manual reload
needed. The standalone page <https://example.com/gonecycling/deploy/> shows the
same status.

> Both buttons use **the same** signal `deploy-state/request` (with an `action`
> field `check`/`deploy`). The `.path` unit therefore does **not** need to be
> recopied — `gonecycling-deploy.sh` is updated via `git pull`.

## Troubleshooting

```bash
systemctl status gonecycling-deploy.path gonecycling-deploy.service
journalctl -u gonecycling-deploy.service -n 50
cat deploy-state/deploy.log
cat deploy-state/status.json
```

## Future premium accounts

This lays the auth foundation (sessions/auth/admin). Premium features (own user
accounts, hosted plan storage, etc.) can build on it — the anonymous,
end-to-end-encrypted sync stays untouched by it.
