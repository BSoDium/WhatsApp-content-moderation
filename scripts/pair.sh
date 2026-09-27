#!/usr/bin/env bash
# Watches the app container's log for WhatsApp pairing (the QR code) and
# returns control as soon as it connects, instead of blocking the terminal
# forever like `docker compose logs -f app` does. The app itself is
# unaffected either way — it already runs detached from `docker compose up
# -d`; this is only a spectator on its log, and killing it (Ctrl+C, or the
# timeout below) never touches the running container.
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1
# shellcheck source=./lib.sh
. ./scripts/lib.sh

PAIR_TIMEOUT_S=300
CONNECTED_PATTERN='moderating monitored contacts'

# Pino writes one JSON object per line; pull out the human-readable message
# if we can parse it, otherwise print the line as-is (this also covers the
# QR code itself and the "[qr] saved to..." line, which are plain text, not
# JSON).
print_line() {
  local line="$1" msg=""
  if command -v jq >/dev/null 2>&1; then
    msg="$(printf '%s' "$line" | jq -r '.msg // empty' 2>/dev/null)"
  fi
  if [ -n "$msg" ]; then
    printf '  %s\n' "$msg"
  else
    printf '%s\n' "$line"
  fi
}

log "Watching for WhatsApp pairing — scan the QR code below with WhatsApp → Linked devices"

tmp_log="$(mktemp)"
docker compose logs -f --no-log-prefix app >"$tmp_log" 2>&1 &
LOGS_PID=$!
trap 'kill "$LOGS_PID" 2>/dev/null; rm -f "$tmp_log"' EXIT

printed=0
elapsed=0
while kill -0 "$LOGS_PID" 2>/dev/null; do
  total="$(wc -l <"$tmp_log" 2>/dev/null || echo 0)"
  if [ "$total" -gt "$printed" ]; then
    tail -n "+$((printed + 1))" "$tmp_log" | while IFS= read -r line; do
      print_line "$line"
    done
    printed="$total"
  fi
  if grep -q "$CONNECTED_PATTERN" "$tmp_log"; then
    ok "Connected. The app keeps running in the background — safe to close this terminal."
    exit 0
  fi
  if [ "$elapsed" -ge "$PAIR_TIMEOUT_S" ]; then
    warn "Still not connected after $((PAIR_TIMEOUT_S / 60)) minutes. The app is still running in the background regardless — check 'docker compose logs -f app' manually, or re-run this script."
    exit 1
  fi
  sleep 1
  elapsed=$((elapsed + 1))
done

warn "The app's log stream ended unexpectedly — check 'docker compose ps' and 'docker compose logs app'."
exit 1
