#!/usr/bin/env bash
# Encrypted backups of the real data (Juan, 27 Sep 2026: "snapshot and targz and encrypt it,
# store in another directory"). docs/22-backups.md has the plan and the restore steps.
#
#   npm run backup                       the daily backup
#   npm run backup -- event "<reason>"   before or after a very large update (kept 2 days)
#   npm run backup:key       says whether the passphrase is stored (never prints it)
#   npm run backup:restore -- <file.tar.gz.gpg> <empty dir>   decrypts and unpacks for a restore
#
# The snapshot is an APFS clone of plcos-data/real taken while live runs, so it is
# crash-consistent at best. It only counts once a separate process has opened the cloned database
# and read from it. The passphrase is random, kept in the login keychain as plcos-backup /
# passphrase, and never printed or put on a command line. Keep a copy in 1Password or nothing
# can be restored. Backups go to ~/plcos-backups, outside every repository. They hold Dakota data,
# which must not leave our systems (docs/20-dakota.md): an off-machine copy needs Juan's decision.
set -euo pipefail

REAL="${PLCOS_REAL:-$HOME/git/plc-os/plcos-data/real}"
OUT="${PLCOS_BACKUPS:-$HOME/plcos-backups}"
MAX_GB="${MAX_GB:-300}"            # Juan, 27 Sep: a 300 GB ceiling for now
KIND="daily"; REASON=""            # run [daily | event <reason>]
SERVICE="plcos-backup"
HERE="$(cd "$(dirname "$0")/.." && pwd)"

passphrase() {
  security find-generic-password -s "$SERVICE" -a passphrase -w 2>/dev/null
}

case "${1:-run}" in
  key)
    if passphrase >/dev/null; then echo "Passphrase stored as $SERVICE / passphrase."; else echo "No passphrase stored yet; the first backup makes one."; fi
    exit 0 ;;
  restore)
    file="${2:?give the .tar.gz.gpg file}"; dest="${3:?give an empty directory}"
    [ -z "$(ls -A "$dest" 2>/dev/null)" ] || { echo "Refusing: $dest is not empty." >&2; exit 1; }
    mkdir -p "$dest"
    passphrase | gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 0 --decrypt "$file" | tar -xz -C "$dest"
    echo "Unpacked into $dest. Check it (docs/22-backups.md) before pointing anything at it."
    exit 0 ;;
  run)
    case "${2:-daily}" in daily) ;; event) KIND="event"; REASON="${3:-}";; *) echo "run takes daily or event <reason>" >&2; exit 2;; esac ;;
  *) echo "usage: backup-real.sh [run|key|restore <file> <dir>]" >&2; exit 2 ;;
esac

if ! passphrase >/dev/null; then
  # Default access list: the security tool that made it can read it back without a prompt.
  security add-generic-password -s "$SERVICE" -a passphrase -l "PLC Raise Tools — backup passphrase" \
    -j "Encrypts ~/plcos-backups (docs/22-backups.md). Keep a copy in 1Password." \
    -w "$(openssl rand -base64 36)"
  echo "Made a new backup passphrase in the keychain ($SERVICE / passphrase). Copy it to 1Password." >&2
fi

mkdir -p "$OUT"; chmod 700 "$OUT"
stamp="$(date -u +%Y%m%dT%H%MZ)"
stage="$OUT/.stage-$stamp"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/real"

# 1. Snapshot: clone every entry (copy-on-write, near-instant), skipping locks and the Postgres rehearsal cluster.
for entry in "$REAL"/* "$REAL"/.[!.]*; do
  [ -e "$entry" ] || continue
  name="$(basename "$entry")"
  case "$name" in *.lock|postgres|.real-copy-*) continue ;; esac
  cp -cR "$entry" "$stage/real/$name" 2>/dev/null || cp -R "$entry" "$stage/real/$name"
done

# 2. It only counts if it opens: read it from a separate process.
tables="$(cd "$HERE" && BACKUP_DB="$stage/real/database" npx tsx -e '
  import { openPglite } from "./lib/db/pglite";
  (async () => {
    const db = await openPglite(process.env.BACKUP_DB!);
    const t = await db.one<{ n: string }>(`select count(*)::text n from information_schema.tables where table_schema not in (\x27pg_catalog\x27,\x27information_schema\x27)`);
    const v = await db.one<{ n: string }>(`select count(*)::text n from platform.vehicle`);
    console.log(`${t?.n} tables, ${v?.n} vehicles`);
    await db.close?.();
  })().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
')" || { echo "Backup refused: the snapshot does not open. Nothing was written." >&2; exit 1; }

# 3. Pack and encrypt in one stream; nothing unencrypted is written.
file="$OUT/plcos-real-$stamp-$KIND.tar.gz.gpg"
tar -C "$stage" -cz real | passphrase_in=1 gpg --batch --quiet --pinentry-mode loopback \
  --passphrase-fd 3 --symmetric --cipher-algo AES256 --compress-algo none -o "$file" 3< <(passphrase)
chmod 600 "$file"
shasum -a 256 "$file" | awk '{print $1}' > "$file.sha256"

# 4. Thin old backups (scripts/backup-prune.py): events kept 2 days; dailies thinned with age; 300 GB cap.
python3 "$HERE/scripts/backup-prune.py" "$OUT" "$MAX_GB"
size="$(du -h "$file" | awk '{print $1}')"
[ -n "$REASON" ] && printf '%s\n' "$REASON" > "$file.reason"
echo "Backup $file ($size, $KIND${REASON:+: $REASON}), snapshot opened: $tables. Kept $(ls -1 "$OUT"/plcos-real-*.tar.gz.gpg | wc -l | tr -d ' ') backups in $OUT."
