#!/usr/bin/env bash
# Guided first-time setup for the Debian/Docker Compose deployment described
# in README "Debian install and updates". Safe to re-run: every step is
# idempotent and never overwrites a value you've already set.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=./lib.sh
. ./scripts/lib.sh

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    warn "'$1' is required but not found on PATH. Install it and re-run this script."
    exit 1
  fi
}

log "Checking prerequisites"
require_cmd docker
require_cmd openssl
if ! docker compose version >/dev/null 2>&1; then
  warn "'docker compose' (the Compose v2 plugin) is required but not found."
  exit 1
fi
if ! command -v tailscale >/dev/null 2>&1; then
  warn "Tailscale isn't on PATH — install it and run 'tailscale up' before continuing (see README)."
fi

log "Setting up config files"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
else
  echo ".env already exists, leaving it alone"
fi

if [ ! -f config/policy.md ]; then
  cp config/policy.example.md config/policy.md
  echo "Created config/policy.md from the template — fill in your real moderation policy before going live"
else
  echo "config/policy.md already exists, leaving it alone"
fi

log "Creating persistent data directories"
mkdir -p auth_info data
chmod 600 .env

for path in auth_info data config/policy.md; do
  owner="$(owner_uid "$path")"
  if [ "$owner" = "$CONTAINER_UID" ]; then
    echo "$path is already owned by UID $CONTAINER_UID, leaving it alone"
    continue
  fi
  case "$path" in
    config/policy.md) chmod 600 "$path" ;;
    *) chmod 700 "$path" ;;
  esac
  if [ "$(id -u)" -eq 0 ]; then
    chown -R "$CONTAINER_UID:$CONTAINER_UID" "$path"
  elif command -v sudo >/dev/null 2>&1; then
    echo "The app container runs as UID $CONTAINER_UID — requesting sudo to chown $path"
    sudo chown -R "$CONTAINER_UID:$CONTAINER_UID" "$path"
  else
    warn "Could not chown $path to UID $CONTAINER_UID (no sudo available). Do this manually before starting the app: sudo chown -R $CONTAINER_UID:$CONTAINER_UID $path"
  fi
done

log "Configuring the web control app"
if ! grep -qE '^CONTROL_SERVER_TOKEN=.+' .env; then
  TOKEN="$(openssl rand -hex 24)"
  upsert_env_var CONTROL_SERVER_TOKEN "$TOKEN"
  echo "Generated a new CONTROL_SERVER_TOKEN"
else
  echo "CONTROL_SERVER_TOKEN already set, leaving it alone"
fi

if ! grep -qE '^WEB_CONTROL_PORT=.+' .env; then
  upsert_env_var WEB_CONTROL_PORT "$CONTROL_PORT_DEFAULT"
  echo "Set WEB_CONTROL_PORT=$CONTROL_PORT_DEFAULT"
else
  echo "WEB_CONTROL_PORT already set, leaving it alone"
fi

if ! grep -qE '^ALLOWED_TAILSCALE_LOGIN=.+' .env; then
  if DETECTED_LOGIN="$(detect_tailscale_login)"; then
    upsert_env_var ALLOWED_TAILSCALE_LOGIN "$DETECTED_LOGIN"
    echo "Detected this host's Tailscale login as '$DETECTED_LOGIN' and set ALLOWED_TAILSCALE_LOGIN — double-check this is the account you'll open the control app from."
  else
    warn "Could not auto-detect your Tailscale login (needs jq, and only applies to a personal, non-tagged node). Run 'tailscale status' and set ALLOWED_TAILSCALE_LOGIN in .env to the exact login it reports for your own account — not the host's, if this host is Tailscale-tagged (e.g. tag:server)."
  fi
else
  echo "ALLOWED_TAILSCALE_LOGIN already set, leaving it alone"
fi

log "Setup complete"
cat <<EOF
Before starting:
  - Review config/policy.md — it still has placeholder text.
  - SHADOW_MODE defaults to 1 in .env: the app will classify and log but
    take no action until you flip it to 0.

Next steps:
  docker compose up -d --build
  docker compose exec ollama ollama pull llama3.2:3b
  docker compose logs -f app        # scan the QR code shown here
  ./scripts/preflight.sh            # verify everything before pairing/going live
  sudo tailscale serve --bg $CONTROL_PORT_DEFAULT
EOF
