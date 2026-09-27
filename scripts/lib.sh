#!/usr/bin/env bash
# Shared helpers for pair.sh and update.sh. Not meant to be run directly.

# No color on a pipe/redirect (docker compose logs, CI) or when NO_COLOR is set
# (https://no-color.org) — only decorate an interactive terminal.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'
  C_RESET=$'\033[0m'
else
  C_BOLD=''; C_DIM=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_RESET=''
fi

log() { printf '\n%s==> %s%s\n' "$C_BOLD" "$1" "$C_RESET"; }
warn() { printf '%s!! %s%s\n' "$C_YELLOW" "$1" "$C_RESET" >&2; }
# A real change just made — the lines worth reading.
ok() { printf '%s✓%s %s\n' "$C_GREEN" "$C_RESET" "$1"; }
