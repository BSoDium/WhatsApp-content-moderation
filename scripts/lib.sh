#!/usr/bin/env bash
# Shared helpers for setup.sh, preflight.sh, and update.sh. Not meant to be
# run directly.

CONTAINER_UID=1000
CONTROL_PORT_DEFAULT=4756

log() { printf '\n==> %s\n' "$1"; }
warn() { printf '\n!! %s\n' "$1" >&2; }

owner_uid() {
  stat -c '%u' "$1" 2>/dev/null || stat -f '%u' "$1" 2>/dev/null || echo unknown
}

# Reads a single KEY=value out of .env without sourcing the whole file —
# values like WARNING_MESSAGE contain unquoted spaces/apostrophes that would
# break `source`.
read_env_var() {
  grep -E "^$1=" .env 2>/dev/null | tail -n1 | cut -d'=' -f2-
}

# Best-effort: this host's own Tailscale login. Used to pre-fill
# ALLOWED_TAILSCALE_LOGIN during setup and to sanity-check it during
# preflight. Assumes a single-user tailnet (the common case for this kind of
# personal self-hosted setup), where the host and the device opening the
# control app belong to the same Tailscale account — that assumption is what
# makes this a useful default, not a proof of what a live request will send.
detect_tailscale_login() {
  command -v tailscale >/dev/null 2>&1 || return 1
  local self_ip login
  self_ip="$(tailscale ip -4 2>/dev/null | head -n1)"
  [ -n "$self_ip" ] || return 1
  if command -v jq >/dev/null 2>&1; then
    login="$(tailscale status --json 2>/dev/null | jq -r '.User[(.Self.UserID|tostring)].LoginName // empty' 2>/dev/null)"
  fi
  if [ -z "${login:-}" ]; then
    login="$(tailscale whois "$self_ip" 2>/dev/null | grep -m1 -oE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+')"
  fi
  [ -n "${login:-}" ] || return 1
  printf '%s' "$login"
}

# Replaces "KEY=..." or "#KEY=..." with "KEY=<value>" in .env, or appends it
# if the key isn't present at all. Only ever touches the exact key given.
upsert_env_var() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  if grep -qE "^#?${key}=" .env; then
    awk -v k="$key" -v v="$value" '$0 ~ "^#?" k "=" { print k "=" v; next } { print }' .env > "$tmp"
  else
    cp .env "$tmp"
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  mv "$tmp" .env
}
