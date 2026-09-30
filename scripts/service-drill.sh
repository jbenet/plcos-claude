#!/usr/bin/env bash
# Backup → restore drill for the service, on invented demo data only (docs/deploy/status-2026-09-30.md).
#
#   bash scripts/service-drill.sh [<loopback Postgres base url>]    default postgres://plcos@127.0.0.1:5434
#
# 1. Creates a scratch database plcos_test_drill_src_<id> on the invented-data test cluster and seeds the
#    demo into it, plus a few invented working files under data/demo/drill-<id>.
# 2. Makes a throwaway GPG key with rev 3's exact command (rsa3072, encrypt only) and checks preflight's
#    backup-key check accepts its public half and refuses its private half.
# 3. Runs scripts/backup-service.sh as the service would, with BACKUP_DRY_RUN=1 and BACKUP_KEEP_DIR, so
#    nothing is uploaded and the encrypted files are kept.
# 4. Restores them with scripts/backup-service-restore.sh into a second scratch database and folder,
#    then compares: scripts/pg-verify.ts must say MATCH, and every working file's SHA-256 must match.
# 5. Checks the restore refuses a non-empty database and a non-empty folder.
# Everything it made is dropped and deleted on exit. No network beyond the loopback database.
set -euo pipefail
cd "$(dirname "$0")/.."
base="${1:-postgres://plcos@127.0.0.1:5434}"
host="$(node -e 'console.log(new URL(process.argv[1]).hostname + ":" + new URL(process.argv[1]).port)' "$base")"
case "$host" in 127.0.0.1:*|localhost:*|'[::1]':*) ;; *) echo "Refused: the drill runs on a loopback test cluster only." >&2; exit 2;; esac
case "$host" in *:57433) echo "Refused: 57433 is the live cluster." >&2; exit 2;; esac

id="$(date -u +%Y%m%d%H%M%S)_$$"
src="plcos_test_drill_src_$id"; dst="plcos_test_drill_dst_$id"
work="$(mktemp -d)"; files="data/demo/drill-$id"
export GNUPGHOME="$work/g"
cleanup() {
  for db in "$src" "$dst"; do psql "$base/postgres" -XAtq -c "drop database if exists $db with (force)" >/dev/null 2>&1 || true; done
  gpgconf --kill all >/dev/null 2>&1 || true
  rm -rf "$work" "$files"
}
trap cleanup EXIT
t=$(date +%s); lap() { local now; now=$(date +%s); printf '  (%ss)\n' $((now - t)); t=$now; }
ok() { echo "PASS $*"; }
bad() { echo "FAIL $*" >&2; exit 1; }

echo "1. Invented source: $src, and $files"
psql "$base/postgres" -XAtq -v ON_ERROR_STOP=1 -c "create database $src" -c "create database $dst" >/dev/null
DATA_PROFILE=demo DATABASE_URL="$base/$src" node --import tsx --input-type=module -e '
  import { openFresh } from "./lib/db/index.ts";
  const db = await openFresh();
  const n = await db.one("select count(*)::int as n from platform.app_user");
  console.log(`  seeded the demo: ${n.n} users`);
  await db.close(); process.exit(0);'
mkdir -p "$files/enrich/raw" "$files/issues"
printf '{"key":"invented-a","fact":"Invented Capital is a fictional allocator."}\n' > "$files/enrich/raw/invented-a.json"
printf '{"id":"0001","title":"Invented feedback"}\n' > "$files/issues/0001.json"
head -c 262144 /dev/urandom > "$files/enrich/raw/invented-binary.bin"
lap

echo "2. Throwaway key (rev 3's command) and preflight's key check"
mkdir -m 700 "$GNUPGHOME"
gpg --batch --quiet --passphrase '' --quick-gen-key 'Drill invented key <drill@invalid>' rsa3072 encr 0 2>/dev/null
pub="$(gpg --batch --armor --export 'Drill invented key')"
priv="$(gpg --batch --armor --pinentry-mode loopback --passphrase '' --export-secret-keys 'Drill invented key')"
check_key() { BACKUP_GPG_PUBLIC_KEY="$1" DATA_PROFILE=demo DATABASE_URL= bash scripts/preflight.sh --dry 2>/dev/null | grep ' backup-key ' || true; }
check_key "$pub" | grep -q '^PASS' && ok "preflight accepts the public key" || bad "preflight did not accept the public key"
check_key "$priv" | grep -q '^FAIL.*PRIVATE' && ok "preflight refuses a private key" || bad "preflight accepted a private key"
unset priv
lap

echo "3. Backup, as the service runs it (dry: no AWS)"
mkdir "$work/keep"
BACKUP_DRY_RUN=1 BACKUP_KEEP_DIR="$work/keep" DATA_PROFILE=demo DATABASE_URL="$base/$src" \
  BACKUP_BUCKET=drill-invented BACKUP_GPG_PUBLIC_KEY="$pub" bash scripts/backup-service.sh | sed 's/^/  /'
dump="$(ls "$work"/keep/*.dump.gpg)"; tarball="$(ls "$work"/keep/*.tar.gz.gpg)"
printf '  encrypted: database %s KiB, files %s KiB\n' $(( $(wc -c < "$dump") / 1024 )) $(( $(wc -c < "$tarball") / 1024 ))
head -c 5 "$dump" | grep -q 'PGDMP' && bad "the database file is not encrypted" || ok "the kept database file is encrypted"
lap

echo "4. Restore into $dst and a new folder, then compare"
bash scripts/backup-service-restore.sh "$dump" "$base/$dst" "$tarball" "$work/restored" | sed 's/^/  /'
node --import tsx scripts/pg-verify.ts "$base/$src" "$base/$dst" | sed 's/^/  /' && ok "pg-verify: the restored database matches" || bad "pg-verify found a mismatch"
manifest() { (cd "$1" && find . \( -path ./database -o -path ./postgres -o -path ./backups \) -prune -o -type f -print0 | sort -z | xargs -0 shasum -a 256); }
a="$(manifest data/demo)"; b="$(manifest "$work/restored")"
[ "$a" = "$b" ] && ok "working files: $(printf '%s\n' "$a" | wc -l | tr -d ' ') files, every SHA-256 matches" || bad "working files differ after restore"
lap

echo "5. Refusals"
bash scripts/backup-service-restore.sh "$dump" "$base/$dst" >/dev/null 2>&1 && bad "restore overwrote a non-empty database" || ok "restore refuses a non-empty database"
psql "$base/postgres" -XAtq -c "drop database $dst with (force)" -c "create database $dst" >/dev/null
bash scripts/backup-service-restore.sh "$dump" "$base/$dst" "$tarball" "$work/restored" >/dev/null 2>&1 && bad "restore wrote into a non-empty folder" || ok "restore refuses a non-empty folder"
lap
echo "Drill passed."
