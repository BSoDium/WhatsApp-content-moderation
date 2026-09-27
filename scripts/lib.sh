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
# preflight. Assumes a single-user tailnet, where the host and the device
# opening the control app belong to the same Tailscale account — that
# assumption is what makes this a useful default, not a proof of what a live
# request will send.
#
# Requires jq, and deliberately returns nothing (rather than guess) when this
# host is Tailscale-tagged (`tailscale status --json .Self.Tags` non-empty)
# instead of owned by a personal account — the standard setup for an
# always-on server. A tagged node's own "login" in that JSON is a machine
# identity (e.g. `<host>.<tailnet>.ts.net`), not a human's, so using it here
# would confidently write the wrong value into ALLOWED_TAILSCALE_LOGIN.
# Confirmed against a real tagged deployment (`tag:server`): without this
# guard, this would have suggested the host's own machine identity in place
# of the actual operator's login.
detect_tailscale_login() {
  command -v tailscale >/dev/null 2>&1 || return 1
  command -v jq >/dev/null 2>&1 || return 1
  # Named ts_status, not status — status is a reserved special parameter in
  # zsh (holds the last exit code) and `local status` errors out if this
  # file is ever sourced interactively from a zsh shell.
  local ts_status login
  ts_status="$(tailscale status --json 2>/dev/null)"
  [ -n "$ts_status" ] || return 1
  if echo "$ts_status" | jq -e '(.Self.Tags // []) | length > 0' >/dev/null 2>&1; then
    return 1
  fi
  login="$(echo "$ts_status" | jq -r '.User[(.Self.UserID|tostring)].LoginName // empty' 2>/dev/null)"
  [ -n "$login" ] || return 1
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
