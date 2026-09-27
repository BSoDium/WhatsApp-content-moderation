#!/usr/bin/env bash
# Routine update: pull the latest commit (keeps scripts/*.sh and the compose
# files current) and restart the app service against the latest published
# image — pass --build to instead rebuild from your local source (needs
# docker-compose.override.yml, see docker-compose.override.yml.example).
# .env, config/policy.md, auth_info/, and data/ are all gitignored and
# untouched by this — see README "Debian install and updates".
set -euo pipefail

BUILD=0
if [ "${1:-}" = "--build" ]; then
  BUILD=1
elif [ -n "${1:-}" ]; then
  echo "Usage: $0 [--build]" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=./lib.sh
. ./scripts/lib.sh

log "Checking for local changes"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Tracked files have local changes — refusing to pull. Commit, stash, or discard them first:" >&2
  git status --short --untracked-files=no >&2
  exit 1
fi

log "Pulling latest source"
BEFORE_EXAMPLE="$(cat .env.example)"
git pull --ff-only
AFTER_EXAMPLE="$(cat .env.example)"

if [ "$BUILD" -eq 1 ]; then
  log "Rebuilding from source and restarting the app"
  docker compose up -d --build app
else
  log "Pulling the latest published image and restarting the app"
  docker compose pull app
  docker compose up -d app
fi

if [ "$BEFORE_EXAMPLE" != "$AFTER_EXAMPLE" ] && [ -f .env ]; then
  NEW_KEYS="$(comm -23 \
    <(grep -oE '^[A-Z_][A-Z0-9_]*=' .env.example | sed 's/=$//' | sort -u) \
    <(grep -oE '^[A-Z_][A-Z0-9_]*=' .env | sed 's/=$//' | sort -u))"
  if [ -n "$NEW_KEYS" ]; then
    echo
    echo "New .env.example settings not yet in your .env:"
    echo "$NEW_KEYS" | sed 's/^/  - /'
    echo "Review .env.example and add any you need."
  fi
fi

log "Update complete"
docker compose logs --tail 20 app
