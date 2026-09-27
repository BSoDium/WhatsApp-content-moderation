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
if ! docker compose version >/dev/null 2>&1; then
  warn "'docker compose' (the Compose v2 plugin) is required but not found."
  exit 1
fi
if ! command -v tailscale >/dev/null 2>&1; then
  warn "Tailscale isn't on PATH — install it and run 'tailscale up' before continuing (see README)."
fi
if ! command -v jq >/dev/null 2>&1; then
  warn "jq isn't on PATH — install it if you want ALLOWED_TAILSCALE_LOGIN auto-detected, or set it manually in .env later."
fi

log "Setting up config files"
if [ ! -f .env ]; then
  cp .env.example .env
  ok "created .env"
else
  skip ".env already exists"
fi

if [ ! -f config/policy.md ]; then
  cp config/policy.example.md config/policy.md
  ok "created config/policy.md — fill in your real moderation policy before going live"
else
  skip "config/policy.md already exists"
fi

log "Creating persistent data directories"
mkdir -p auth_info data
chmod 600 .env

ALREADY_OWNED=()
for path in auth_info data config/policy.md; do
  case "$path" in
    config/policy.md) chmod 600 "$path" ;;
    *) chmod 700 "$path" ;;
  esac
  owner="$(owner_uid "$path")"
  if [ "$owner" = "$CONTAINER_UID" ]; then
    ALREADY_OWNED+=("$path")
    continue
  fi
  if [ "$(id -u)" -eq 0 ]; then
    chown -R "$CONTAINER_UID:$CONTAINER_UID" "$path"
    ok "chowned $path to UID $CONTAINER_UID"
  elif command -v sudo >/dev/null 2>&1; then
    echo "The app container runs as UID $CONTAINER_UID — requesting sudo to chown $path"
    sudo chown -R "$CONTAINER_UID:$CONTAINER_UID" "$path"
    ok "chowned $path to UID $CONTAINER_UID"
  else
    warn "Could not chown $path to UID $CONTAINER_UID (no sudo available). Do this manually before starting the app: sudo chown -R $CONTAINER_UID:$CONTAINER_UID $path"
  fi
done
if [ "${#ALREADY_OWNED[@]}" -gt 0 ]; then
  owned_list="$(printf ', %s' "${ALREADY_OWNED[@]}")"
  skip "${owned_list#, } already owned by UID $CONTAINER_UID"
fi

log "Configuring the web control app"
if ! grep -qE '^[[:space:]]*WEB_CONTROL_PORT=.+' .env; then
  upsert_env_var WEB_CONTROL_PORT "$CONTROL_PORT_DEFAULT"
  ok "set WEB_CONTROL_PORT=$CONTROL_PORT_DEFAULT"
else
  skip "WEB_CONTROL_PORT already set"
fi

if ! grep -qE '^[[:space:]]*ALLOWED_TAILSCALE_LOGIN=.+' .env; then
  if DETECTED_LOGIN="$(detect_tailscale_login)"; then
    upsert_env_var ALLOWED_TAILSCALE_LOGIN "$DETECTED_LOGIN"
    ok "detected Tailscale login '$DETECTED_LOGIN' and set ALLOWED_TAILSCALE_LOGIN — double-check this is the account you'll open the control app from"
  else
    warn "Could not auto-detect your Tailscale login — set ALLOWED_TAILSCALE_LOGIN in .env yourself. $TAILSCALE_LOGIN_HELP"
  fi
else
  skip "ALLOWED_TAILSCALE_LOGIN already set"
fi

CONFIGURED_PORT="$(read_env_var WEB_CONTROL_PORT)"
CONFIGURED_PORT="${CONFIGURED_PORT:-$CONTROL_PORT_DEFAULT}"
CONFIGURED_MODEL="$(read_env_var OLLAMA_MODEL)"
CONFIGURED_MODEL="${CONFIGURED_MODEL:-$DEFAULT_OLLAMA_MODEL}"
CONFIGURED_LOGIN="$(read_env_var ALLOWED_TAILSCALE_LOGIN)"

log "Setup complete"

# WEB_CONTROL_PORT is always set by this point (above), so an empty login here
# is a guaranteed crash under `restart: always` — index.ts refuses to start
# the control server unauthenticated. Block on it instead of letting it hide
# among the routine "Next steps".
if [ -z "$CONFIGURED_LOGIN" ]; then
  warn "ALLOWED_TAILSCALE_LOGIN is still unset. The app WILL crash-loop under Docker's restart policy until you fix this — don't run 'docker compose up' yet."
  echo "  $TAILSCALE_LOGIN_HELP"
  echo "  Then add it to .env: ALLOWED_TAILSCALE_LOGIN=you@example.com"
fi

printf '%sBefore starting:%s\n' "$C_YELLOW" "$C_RESET"
cat <<EOF
  - Review config/policy.md — it still has placeholder text.
  - SHADOW_MODE=1 by default: classifies and logs, takes no action.

Next steps:
EOF
printf '%s' "$C_BOLD"
cat <<EOF
  docker compose up -d --build
  docker compose exec ollama ollama pull $CONFIGURED_MODEL
  docker compose logs -f app        # scan the QR code shown here
  ./scripts/preflight.sh            # verify before pairing/going live
  sudo tailscale serve --bg $CONFIGURED_PORT
EOF
printf '%s\n' "$C_RESET"
