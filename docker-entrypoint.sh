#!/bin/sh
# Runs as root (the image's default USER, see Dockerfile) so it can fix
# ownership of the bind-mounted auth_info/ and data/ volumes before the app
# itself ever runs as the unprivileged `node` user. Docker creates a missing
# bind-mount source directory owned by root, which `node` (UID 1000) can't
# write to — this replaces the old host-side `sudo chown` step in
# scripts/setup.sh entirely: a fresh, empty ./auth_info and ./data just work.
set -e

mkdir -p /app/auth_info /app/data
chown -R node:node /app/auth_info /app/data

exec su-exec node "$@"
