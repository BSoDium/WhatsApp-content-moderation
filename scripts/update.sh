#!/usr/bin/env bash
# For a local checkout only (the "building from source" flow — see README):
# pull the latest commit (keeps scripts/*.sh and the compose files current)
# and restart the app service against the latest published image — pass
# --build to instead rebuild from your local source (needs
# docker-compose.override.yml, see docker-compose.override.yml.example).
# The packaged deploy (a bare docker-compose.yml with no repo checkout) has
# no local commits to pull — just `docker compose pull app && docker compose
# up -d app` directly. auth_info/ and data/ are gitignored and untouched by
# this either way.
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
git pull --ff-only

if [ "$BUILD" -eq 1 ]; then
  log "Rebuilding from source and restarting the app"
  docker compose up -d --build app
else
  log "Pulling the latest published image and restarting the app"
  docker compose pull app
  docker compose up -d app
fi

log "Update complete"
docker compose logs --tail 20 app
