#!/usr/bin/env bash
# Host watcher for the GoneCycling web app. Runs OUTSIDE the container
# (systemd, as root or a Docker-authorized user) and reacts to ONE signal
# that the admin UI writes to deploy-state/request. The JSON file
# contains an `action` field:
#
#   "action": "check"   → git fetch + comparison (no rebuild) → version.json
#   "action": "deploy"  → git pull --ff-only + rebuild        → status.json
#
# ONLY this field (a fixed choice) is read, no arbitrary
# commands → via the web only "check" or "redeploy" can be triggered.
# Default = check (harmless); a deploy happens only on action=deploy.
set -euo pipefail

REPO_DIR="${GC_REPO_DIR:-/opt/gonecycling-web}"
COMPOSE="${GC_COMPOSE:-docker compose -f docker-compose.prod.yml}"
STATE_DIR="$REPO_DIR/deploy-state"

mkdir -p "$STATE_DIR"
cd "$REPO_DIR"

# --- Version check (lightweight: just fetch + count) -----------------------
do_version_check() {
    git fetch origin --quiet || true
    local branch remote installed installed_date origin_short origin_date behind ahead
    branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo master)"
    remote="origin/$branch"
    installed="$(git rev-parse --short HEAD 2>/dev/null || echo '?')"
    installed_date="$(git show -s --format=%ci HEAD 2>/dev/null || echo '')"
    origin_short="$(git rev-parse --short "$remote" 2>/dev/null || echo '?')"
    origin_date="$(git show -s --format=%ci "$remote" 2>/dev/null || echo '')"
    behind="$(git rev-list --count "HEAD..$remote" 2>/dev/null || echo '?')"
    ahead="$(git rev-list --count "$remote..HEAD" 2>/dev/null || echo '0')"
    cat > "$STATE_DIR/version.json" <<EOF
{"checked_at": "$(date -Is)", "branch": "$branch", "installed": "$installed", "installed_date": "$installed_date", "origin": "$origin_short", "origin_date": "$origin_date", "behind": "$behind", "ahead": "$ahead"}
EOF
    echo "$(date -Is) Version checked: $installed -> $origin_short ($behind behind)" >>"$STATE_DIR/deploy.log"
}

# --- Update (git pull + rebuild) -------------------------------------------
write_status() {  # $1=state  $2=message  $3=commit(optional)
    printf '{"state": "%s", "at": "%s", "message": "%s", "commit": "%s"}\n' \
        "$1" "$(date -Is)" "$2" "${3:-}" > "$STATE_DIR/status.json"
}

do_deploy() {
    write_status "running" "Update running …"
    echo "===== $(date -Is) Deploy started =====" >>"$STATE_DIR/deploy.log"
    if { git pull --ff-only && $COMPOSE up -d --build; } >>"$STATE_DIR/deploy.log" 2>&1; then
        write_status "ok" "Update successful." "$(git rev-parse --short HEAD)"
        echo "$(date -Is) Deploy ok." >>"$STATE_DIR/deploy.log"
        do_version_check  # write a fresh comparison right away
    else
        write_status "failed" "Deploy failed — see deploy.log." "$(git rev-parse --short HEAD 2>/dev/null || echo '')"
        echo "$(date -Is) Deploy FAILED." >>"$STATE_DIR/deploy.log"
    fi
}

# --- Dispatch (prevent multiple runs via flock) ----------------------------
exec 9>"$STATE_DIR/.lock"
if ! flock -n 9; then
    echo "$(date -Is) Watcher already running — skipped." >>"$STATE_DIR/deploy.log"
    exit 0
fi

[ -f "$STATE_DIR/request" ] || exit 0
action="check"
grep -q '"action"[[:space:]]*:[[:space:]]*"deploy"' "$STATE_DIR/request" 2>/dev/null && action="deploy"
rm -f "$STATE_DIR/request"

if [ "$action" = "deploy" ]; then
    do_deploy
else
    do_version_check
fi
