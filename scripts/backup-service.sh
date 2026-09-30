#!/usr/bin/env bash
# Service only: BACKUP_COMMAND="bash scripts/backup-service.sh". Mac backups are unchanged.
# Restore with scripts/backup-service-restore.sh; scripts/service-drill.sh rehearses both on invented data.
set -euo pipefail
: "${DATABASE_URL:?required}" "${BACKUP_BUCKET:?required}" "${BACKUP_GPG_PUBLIC_KEY:?required}"
cd "$(dirname "$0")/.."
umask 077
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
export GNUPGHOME="$stage/gnupg"
mkdir "$GNUPGHOME"
# Read the data root without opening or validating a database connection.
root="$(DATABASE_URL= POSTGRES_REHEARSAL=0 node --import tsx --input-type=module -e 'import {config} from "./config/deployment.ts"; console.log(config.data.root)')"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
pg_dump -Fc "$DATABASE_URL" > "$stage/database.dump"
pg_restore --list "$stage/database.dump" > "$stage/toc"
tables="$(grep -c ' TABLE DATA ' "$stage/toc" || true)"
[ "$tables" -gt 0 ] || { echo 'Backup refused: dump has no TABLE DATA.' >&2; exit 1; }
printf '%s\n' "$BACKUP_GPG_PUBLIC_KEY" | gpg --batch --quiet --import
recipient="$(gpg --batch --with-colons --list-keys | awk -F: '$1 == "fpr" {print $10; exit}')"
gpg --batch --trust-model always --recipient "$recipient" --encrypt --output "$stage/database.dump.gpg" "$stage/database.dump"
tar -C "$root" --exclude='./postgres' --exclude='./database' --exclude='./backups' -czf - . |
  gpg --batch --trust-model always --recipient "$recipient" --encrypt --output "$stage/files.tar.gz.gpg"
for item in database.dump files.tar.gz; do
  prefix="plcos-${DATA_PROFILE:-demo}/${item%%.*}"
  target="s3://$BACKUP_BUCKET/$prefix"
  if [ "${BACKUP_DRY_RUN:-0}" = 1 ]; then
    echo "Would upload encrypted $item ($tables TABLE DATA entries) to $target/$stamp.${item#*.}.gpg"
    echo "Would list $target/ and delete objects dropped by backup-prune.py (300 GB per prefix)."
    # The restore drill (scripts/service-drill.sh) keeps the encrypted files; nothing unencrypted leaves $stage.
    if [ -n "${BACKUP_KEEP_DIR:-}" ]; then cp "$stage/$item.gpg" "$BACKUP_KEEP_DIR/$stamp.${item#*.}.gpg"; echo "Kept $BACKUP_KEEP_DIR/$stamp.${item#*.}.gpg"; fi
    continue
  fi
  aws s3 cp - "$target/$stamp.${item#*.}.gpg" < "$stage/$item.gpg"
done
# Only prune after both uploads succeed; each archive type keeps its own newest copy.
if [ "${BACKUP_DRY_RUN:-0}" != 1 ]; then
  for prefix in "plcos-${DATA_PROFILE:-demo}/database" "plcos-${DATA_PROFILE:-demo}/files"; do
    aws s3 ls "s3://$BACKUP_BUCKET/$prefix/" > "$stage/list"
    python3 scripts/backup-prune.py --list-stdin "$prefix" 300 < "$stage/list" > "$stage/drop"
    while IFS= read -r key; do aws s3 rm "s3://$BACKUP_BUCKET/$key"; done < "$stage/drop"
  done
fi
