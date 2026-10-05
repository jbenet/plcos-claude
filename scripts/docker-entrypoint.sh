#!/bin/sh
# The image runs as uid 10001 (Dockerfile USER). Railway mounts volumes owned by root, so there the
# service sets RAILWAY_RUN_UID=0 (docs/deploy/railway.md §2): started as root, hand the data folder to
# 10001 and drop to it before anything else runs. Started as any other user, just run.
set -e
data=/app/data
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$data"
  chown -R 10001:10001 "$data"
  # Real records: no other user of the host reads them.
  chmod 700 "$data"
  exec setpriv --reuid=10001 --regid=10001 --clear-groups "$@"
fi
exec "$@"
