#!/bin/sh
# The image runs as uid 10001 (Dockerfile USER). Railway mounts volumes owned by root, so there the
# service sets RAILWAY_RUN_UID=0 (docs/deploy/railway.md §2): started as root, hand the data folder to
# 10001 and drop to it before anything else runs. Started as any other user, just run.
set -e
data=/app/data
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$data"
  # Only what 10001 does not already own: a plain chown -R rewrote every inode of the volume (tens of thousands of
  # research files) on each start, before the server could answer Railway's health check (14 Oct 2026).
  find "$data" \( ! -user 10001 -o ! -group 10001 \) -exec chown -h 10001:10001 {} +
  # Real records: no other user of the host reads them.
  chmod 700 "$data"
  exec setpriv --reuid=10001 --regid=10001 --clear-groups "$@"
fi
exec "$@"
