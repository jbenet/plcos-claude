#!/usr/bin/env bash
# Restore one service backup (scripts/backup-service.sh) into an EMPTY database, and optionally its
# working files into an empty folder. Run it wherever the backup's private GPG key is: Juan's machine,
# with the key imported from his password manager. The service never holds that key.
#
#   bash scripts/backup-service-restore.sh <stamp.dump.gpg> <empty database url> [<stamp.tar.gz.gpg> <empty dir>]
#
# Fetch the two files first, for example:
#   aws s3 cp s3://<bucket>/plcos-real/database/<stamp>.dump.gpg .
#   aws s3 cp s3://<bucket>/plcos-real/files/<stamp>.tar.gz.gpg .
# The URL carries no password (use ~/.pgpass or PGPASSWORD). GNUPGHOME picks the keyring. It refuses a
# database that has any table, and a folder that has any file, so it can never overwrite anything.
# Prints counts only. Then compare with scripts/pg-verify.ts if the source still exists.
set -euo pipefail
dump="${1:?usage: backup-service-restore.sh <dump.gpg> <empty db url> [<files.tar.gz.gpg> <empty dir>]}"
url="${2:?target database url required}"
files="${3:-}"; into="${4:-}"
[ -z "$files" ] || [ -n "$into" ] || { echo "Refused: a files archive needs a target folder." >&2; exit 2; }
PG_BIN="${PG_BIN:-}"
pg() { "${PG_BIN:+$PG_BIN/}$1" "${@:2}"; }
umask 077
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

tables="$(pg psql "$url" -XAtq -v ON_ERROR_STOP=1 -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname <> 'information_schema' and n.nspname !~ '^pg_'")" \
  || { echo "Refused: cannot reach the target database (the URL is not printed)." >&2; exit 1; }
[ "$tables" = 0 ] || { echo "Refused: the target database has $tables tables; restore only into an empty one." >&2; exit 1; }
if [ -n "$into" ] && [ -e "$into" ] && [ -n "$(find "$into" -mindepth 1 -print -quit)" ]; then
  echo "Refused: $into is not empty." >&2; exit 1
fi

gpg --batch --quiet --decrypt --output "$stage/database.dump" "$dump"
n="$(pg pg_restore --list "$stage/database.dump" | grep -c ' TABLE DATA ' || true)"
[ "$n" -gt 0 ] || { echo "Refused: the dump lists no TABLE DATA." >&2; exit 1; }
start="$(date +%s)"
pg pg_restore --no-owner --no-acl --single-transaction --exit-on-error -d "$url" "$stage/database.dump"
echo "Database restored: $n tables of data in $(( $(date +%s) - start )) s."

if [ -n "$files" ]; then
  mkdir -p "$into"
  gpg --batch --quiet --decrypt "$files" | tar -xzf - -C "$into"
  echo "Working files restored: $(find "$into" -type f | wc -l | tr -d ' ') files, $(du -sk "$into" | cut -f1) KiB."
fi
