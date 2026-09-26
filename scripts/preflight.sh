#!/usr/bin/env bash
# Read-only checklist that verifies Compose, the model, bind-mount
# permissions, the loopback port, and Tailscale Serve before you pair
# WhatsApp or open the control app. Never prints CONTROL_SERVER_TOKEN.
#
# Intentionally no `set -e`: every check should run and report, even if an
# earlier one fails.
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1
# shellcheck source=./lib.sh
. ./scripts/lib.sh

FAILURES=0
pass() { printf '  [ok]   %s\n' "$1"; }
fail() { printf '  [FAIL] %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
info() { printf '  [--]   %s\n' "$1"; }

if [ ! -f .env ]; then
  fail ".env not found — run ./scripts/setup.sh first"
fi
PORT="$(read_env_var WEB_CONTROL_PORT)"
PORT="${PORT:-$CONTROL_PORT_DEFAULT}"
MODEL="$(read_env_var OLLAMA_MODEL)"
MODEL="${MODEL:-llama3.2:3b}"
CONTROL_SERVER_TOKEN="$(read_env_var CONTROL_SERVER_TOKEN)"
ALLOWED_TAILSCALE_LOGIN="$(read_env_var ALLOWED_TAILSCALE_LOGIN)"

log "Docker"
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  pass "docker daemon is reachable"
else
  fail "docker daemon is not reachable — is it installed and running?"
fi
if docker compose version >/dev/null 2>&1; then
  pass "docker compose plugin is available"
else
  fail "docker compose plugin not found"
fi

log "Compose services"
RUNNING="$(docker compose ps --status running --services 2>/dev/null || true)"
if echo "$RUNNING" | grep -qx app; then
  pass "app service is running"
else
  fail "app service is not running (docker compose up -d --build)"
fi
if echo "$RUNNING" | grep -qx ollama; then
  pass "ollama service is running"
else
  fail "ollama service is not running"
fi

log "Ollama model"
if docker compose exec -T ollama ollama list 2>/dev/null | grep -q "$MODEL"; then
  pass "model '$MODEL' is pulled"
else
  fail "model '$MODEL' is not pulled (docker compose exec ollama ollama pull $MODEL)"
fi

log "Persisted paths (must be owned by UID $CONTAINER_UID for the container to read/write them)"
for path in auth_info data config/policy.md; do
  if [ ! -e "$path" ]; then
    fail "$path does not exist (run ./scripts/setup.sh)"
    continue
  fi
  owner="$(owner_uid "$path")"
  if [ "$owner" = "$CONTAINER_UID" ]; then
    pass "$path is owned by UID $CONTAINER_UID"
  else
    fail "$path is owned by UID $owner, not $CONTAINER_UID (sudo chown -R $CONTAINER_UID:$CONTAINER_UID $path)"
  fi
done

log "Control server port"
if command -v curl >/dev/null 2>&1; then
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/" --max-time 3 2>/dev/null)"
  code="${code:-000}"
  if [ "$code" != "000" ]; then
    pass "app answers on 127.0.0.1:${PORT} (HTTP $code)"
  else
    fail "nothing answering on 127.0.0.1:${PORT} — is WEB_CONTROL_PORT set and the app running?"
  fi
else
  info "curl not found, skipping port check"
fi

log "Control token"
if [ -n "${CONTROL_SERVER_TOKEN:-}" ]; then
  pass "CONTROL_SERVER_TOKEN is set (value not shown)"
else
  fail "CONTROL_SERVER_TOKEN is not set in .env"
fi

log "Tailscale Serve"
if command -v tailscale >/dev/null 2>&1; then
  serve_status="$(tailscale serve status 2>/dev/null || true)"
  if echo "$serve_status" | grep -q ":${PORT}"; then
    pass "tailscale serve is proxying to port ${PORT}"
  else
    fail "tailscale serve doesn't mention port ${PORT} — run: sudo tailscale serve --bg ${PORT}"
  fi

  if DETECTED_LOGIN="$(detect_tailscale_login)"; then
    if [ -n "${ALLOWED_TAILSCALE_LOGIN:-}" ]; then
      if [ "$DETECTED_LOGIN" = "$ALLOWED_TAILSCALE_LOGIN" ]; then
        pass "this host's Tailscale login ('$DETECTED_LOGIN') matches ALLOWED_TAILSCALE_LOGIN"
      else
        fail "this host's Tailscale login ('$DETECTED_LOGIN') does not match ALLOWED_TAILSCALE_LOGIN ('$ALLOWED_TAILSCALE_LOGIN') — this is a common cause of a 403 from the control app. Open it from the '$ALLOWED_TAILSCALE_LOGIN' account, or update ALLOWED_TAILSCALE_LOGIN in .env to '$DETECTED_LOGIN' if that's wrong. (Heuristic: assumes the host and your browser share one tailnet account — the real check is the Tailscale-User-Login header the app logs on rejection.)"
      fi
    else
      info "ALLOWED_TAILSCALE_LOGIN is not set in .env"
    fi
  else
    info "could not detect this host's Tailscale login (install jq for a more reliable check, or verify manually with 'tailscale status')"
  fi
else
  fail "tailscale not found on PATH"
fi

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "All checks passed."
  exit 0
else
  echo "$FAILURES check(s) failed — see [FAIL] lines above."
  exit 1
fi
