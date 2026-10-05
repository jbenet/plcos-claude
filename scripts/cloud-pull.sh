#!/usr/bin/env bash
# A local copy of the cloud database, for testing quickly on the Mac (docs/deploy/railway.md §6).
# One way only: the cloud is the source of truth, the copy is a read-only preview, and nothing here
# writes to the cloud. The pull reads the app's own snapshot endpoint (GET /api/sync/snapshot) with a
# snapshot token, which only an Admin makes: there is no public database port (Juan, 4 Oct 2026, decision G).
#
#   bash scripts/cloud-pull.sh init  --to <local url> [--dir <folder>]                once: a Postgres cluster for copies
#   bash scripts/cloud-pull.sh pull  --to <local url> [--from <app url>] [--keep]     a fresh copy, replacing the last one
#   bash scripts/cloud-pull.sh serve --to <local url> [--port <n>]                    the app on the copy, as a preview
#
# <local url> is postgres://<user>@127.0.0.1:<port>/<database>: loopback, not the Mac's live cluster
# (57433), and a database named plcos_copy…, for example postgres://plcos@127.0.0.1:57434/plcos_copy.
# <app url> is the cloud app, https://… (http only on this machine, for tests).
#
# --keep also keeps the pull as the off-site copy (decision D: no S3): the dump and a tar of the working
# files (GET /api/sync/snapshot?files=1), packed and encrypted into ~/plcos-backups exactly as
# scripts/backup-real.sh does (same passphrase, plcos-backup / passphrase), named plcos-cloud-<time>-daily,
# and thinned by scripts/backup-prune.py with the Mac's own backups. Restore one with
# npm run backup:restore -- <file> <empty dir>: it holds cloud/database.dump and cloud/files.tar.gz.
#
# Secrets, never printed and never on a command line:
#   the snapshot token   Keychain item plcos-railway / snapshot-token (CLOUD_SNAPSHOT_TOKEN for tests).
#                        It reaches curl through a config on a file descriptor, not its arguments.
#   the app URL          --from, else CLOUD_APP_URL, else Keychain item plcos-railway / app-url.
#   COPY_PGPASSWORD      the local copy cluster's password. Unset: the Keychain item plcos-railway / copy;
#                        set but empty: no password (a trust cluster, such as the invented-data test one).
#
# A pull restores into <database>_incoming, checks it, and only then replaces <database>, so a failed pull
# leaves the last good copy. The dump is deleted afterwards. The copy's database comment records when it
# was taken; serve passes that time as PREVIEW_COPY_AT, so the app shows the copy banner, refuses every
# write and runs no connector (the preview rules, lib/mutation-policy.ts), and has no keys.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
LIVE_PORT=57433
pg() { "$PG_BIN/$1" "${@:2}"; }
say() { printf '[cloud-pull] %s\n' "$*"; }
die() { printf '[cloud-pull] STOPPED: %s\n' "$*" >&2; exit 1; }
now() { date +%s; }

cmd="${1:-}"; [ $# -gt 0 ] && shift
TO=""; DIR="$HERE/../plcos-data/real/cloud-copy"; PORT_ARG="${PORT:-}"; FROM=""; KEEP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --to) TO="$2"; shift 2 ;;
    --dir) DIR="$2"; shift 2 ;;
    --port) PORT_ARG="$2"; shift 2 ;;
    --from) FROM="$2"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    *) die "unknown argument $1" ;;
  esac
done
case "$cmd" in init|pull|serve) ;; *) awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0" >&2; exit 2 ;; esac


# Split a postgres URL into parts; the password goes into a variable, never into a printed or passed URL.
URL_RE='^postgres(ql)?://([^:@/]+)(:([^@]*))?@([^:/?]+|\[[^]/]+\])(:([0-9]+))?/([^?/]+)(\?(.*))?$'
parse() { # <url> <prefix>: sets <prefix>_user _pass _host _port _db _query
  [[ "$1" =~ $URL_RE ]] || die "$2: not a postgres://user@host:port/database URL"
  local pass="${BASH_REMATCH[4]}"
  [[ "$pass" == *%* ]] && pass="$(printf '%b' "${pass//%/\\x}")"
  printf -v "$2_user" '%s' "${BASH_REMATCH[2]}"; printf -v "$2_pass" '%s' "$pass"
  printf -v "$2_host" '%s' "${BASH_REMATCH[5]}"; printf -v "$2_port" '%s' "${BASH_REMATCH[7]:-5432}"
  printf -v "$2_db" '%s' "${BASH_REMATCH[8]}"; printf -v "$2_query" '%s' "${BASH_REMATCH[10]}"
}
loopback() { [[ "$1" == 127.0.0.1 || "$1" == localhost || "$1" == "[::1]" ]]; }
keychain() { command -v security >/dev/null 2>&1 && security find-generic-password -s plcos-railway -a "$1" -w 2>/dev/null; }

[ -n "$TO" ] || die "$cmd needs --to <local url>"
parse "$TO" to
[ -z "$to_pass" ] || die "--to carries a password; give it in COPY_PGPASSWORD or the Keychain instead"
loopback "$to_host" || die "--to must be on this machine (127.0.0.1)"
[ "$to_port" != "$LIVE_PORT" ] || die "--to is the Mac's live cluster ($LIVE_PORT); copies go to their own cluster"
[[ "$to_db" =~ ^plcos_copy[a-z0-9_]*$ ]] || die "--to must name a database plcos_copy…, not $to_db"
TO_URL="postgres://$to_user@$to_host:$to_port/$to_db"
MAINT_URL="postgres://$to_user@$to_host:$to_port/postgres"
if [ -n "${COPY_PGPASSWORD+set}" ]; then copy_pw="$COPY_PGPASSWORD"; else copy_pw="$(keychain copy || true)"; fi
lpsql() { PGOPTIONS="-c client_min_messages=warning" PGPASSWORD="$copy_pw" pg psql "$1" -w -XAtq -v ON_ERROR_STOP=1 "${@:2}"; }

if [ "$cmd" = init ]; then
  [ ! -e "$DIR/postgres" ] || die "$DIR/postgres exists already"
  [ -d "$(dirname "$DIR")" ] || die "$(dirname "$DIR") does not exist; the copy belongs beside the real data"
  [ -n "$copy_pw" ] || die "init needs a password: store it first with security add-generic-password -s plcos-railway -a copy -T \"\" -U -w"
  mkdir -p "$DIR"; chmod 700 "$DIR"
  # The password reaches initdb through a pipe, never a file or an argument.
  pg initdb -D "$DIR/postgres" -U "$to_user" --auth=scram-sha-256 --pwfile=<(printf '%s\n' "$copy_pw") >/dev/null
  # TCP on loopback only, and no Unix socket at all: nothing outside this machine, nothing in /tmp.
  printf "port = %s\nlisten_addresses = '127.0.0.1'\nunix_socket_directories = ''\n" "$to_port" >> "$DIR/postgres/postgresql.conf"
  # Postgres on macOS refuses to start without a valid locale (as in scripts/dev.sh).
  LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 pg pg_ctl -D "$DIR/postgres" -l "$DIR/postgres/server.log" -w -t 60 start >/dev/null
  say "copy cluster on 127.0.0.1:$to_port in $DIR/postgres. Stop it with $PG_BIN/pg_ctl -D <that folder> stop; start it with LC_ALL=en_US.UTF-8 and pg_ctl start."
  exit 0
fi

if [ "$cmd" = serve ]; then
  [ ! -L "$HERE/data/real" ] || die "this is the live folder; serve a copy from a dev worktree"
  taken="$(lpsql "$TO_URL" -c "select shobj_description(oid, 'pg_database') from pg_database where datname = current_database()")" \
    || die "cannot open $to_db on :$to_port (is the copy cluster running?)"
  taken="${taken#cloud copy taken }"; taken="${taken%% *}"
  [[ "$taken" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z$ ]] || die "$to_db is not a copy made by this script"
  port="$PORT_ARG"
  [ -n "$port" ] || port="$(cd "$HERE" && node --import tsx --input-type=module -e 'import {readLayout} from "./config/ports.ts"; const r = readLayout().row; console.log(r?.preview ?? "")' 2>/dev/null || true)"
  [ -n "$port" ] || die "no preview port for this folder in .ports.json; give --port"
  say "serving the copy taken $taken on :$port. It refuses every write; pull again for fresher data."
  cd "$HERE"
  exec env -u AFFINITY_API_KEY -u LINEAR_API_KEY -u ANTHROPIC_API_KEY -u DAKOTA_USERNAME -u DAKOTA_PASSWORD \
    -u GOOGLE_OAUTH_CLIENT_ID -u GOOGLE_OAUTH_CLIENT_SECRET -u LABOS_ME_URL -u SCHEDULE_DAILY_AT -u BACKUP_COMMAND \
    DATA_PROFILE=real DATABASE_URL="$TO_URL" PGPASSWORD="$copy_pw" PREVIEW_COPY_AT="$taken" \
    NEXT_DIST_DIR=.next-cloud-copy PORT="$port" npx next dev --hostname 0.0.0.0 --port "$port"
fi

# pull
[ -n "$FROM" ] || FROM="${CLOUD_APP_URL:-}"
[ -n "$FROM" ] || FROM="$(keychain app-url || true)"
[ -n "$FROM" ] || die "no source: give --from <app url>, set CLOUD_APP_URL, or store it as Keychain item plcos-railway / app-url"
FROM="${FROM%/}"
if [[ "$FROM" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]]; then proto='=https'
elif [[ "$FROM" =~ ^http://(127\.0\.0\.1|localhost)(:[0-9]+)?$ ]]; then proto='=http'
else die "--from must be https://<host> (http only on 127.0.0.1, for tests)"; fi
src_host="${FROM#*://}"
if [ -n "${CLOUD_SNAPSHOT_TOKEN+set}" ]; then token="$CLOUD_SNAPSHOT_TOKEN"; else token="$(keychain snapshot-token || true)"; fi
[[ "$token" =~ ^plcos_snap_[A-Za-z0-9_-]{30,80}$ ]] \
  || die "no snapshot token: an Admin makes one in Preferences → MCP access, stored as Keychain item plcos-railway / snapshot-token"
mkdir -p "$DIR"; chmod 700 "$DIR"
dump="$DIR/incoming.dump"; toc="$DIR/incoming.toc"; heads="$DIR/incoming.headers"; files="$DIR/incoming-files.tar.gz"; stage="$DIR/keep-stage"
trap 'rm -rf "$dump" "$toc" "$heads" "$files" "$stage"' EXIT
incoming="${to_db}_incoming"

# One GET, the token in a curl config read from a file descriptor: never an argument, never a file.
fetch() { # <query> <out>: prints the HTTP status; a body cut short is curl exit 18
  curl -sS --proto "$proto" --connect-timeout 20 -K <(printf 'header = "Authorization: Bearer %s"\n' "$token") \
    -D "$heads" -o "$2" -w '%{http_code}' "$FROM/api/sync/snapshot$1"
}
refused() { # <status> <body file>: the server's own reason, which carries no secret
  local why; why="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("error",""))' "$2" 2>/dev/null || true)"
  printf 'the server answered %s%s' "$1" "${why:+: $why}"
}

lpsql "$MAINT_URL" -c "select 1" >/dev/null || die "cannot connect to the copy cluster on :$to_port: is it running (init, or pg_ctl start), and is the password right?"
t0=$(now)
say "1/4 snapshot from $src_host"
set +e; code="$(fetch "" "$dump")"; rc=$?; set -e
[ "$rc" = 0 ] || die "the download failed or was cut short (curl exit $rc); the last copy is unchanged"
[ "$code" = 200 ] || die "$(refused "$code" "$dump"); the last copy is unchanged"
taken="$(tr -d '\r' < "$heads" | awk -F': ' 'tolower($1) == "x-snapshot-taken" { print $2 }')"
[[ "$taken" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z$ ]] || taken="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
pg pg_restore --list "$dump" > "$toc" || die "the snapshot is not a readable dump; the last copy is unchanged"
tables="$(grep -c ' TABLE DATA ' "$toc" || true)"
[ "$tables" -gt 0 ] || die "the dump holds no table data; the last copy is unchanged"
t1=$(now); say "    $(( $(wc -c < "$dump") / 1048576 )) MiB, $tables tables, taken $taken, $(( t1 - t0 )) s"

if [ "$KEEP" = 1 ]; then
  # The off-site copy (decision D), before the restore, so a failed restore still leaves it kept.
  OUT="${PLCOS_BACKUPS:-$HOME/plcos-backups}"
  passphrase() {
    if [ -n "${CLOUD_KEEP_PASSPHRASE_FILE:-}" ]; then cat "$CLOUD_KEEP_PASSPHRASE_FILE"
    else security find-generic-password -s plcos-backup -a passphrase -w 2>/dev/null; fi
  }
  passphrase >/dev/null || die "--keep needs the backup passphrase (plcos-backup / passphrase); npm run backup makes it"
  say "    keep: the working files"
  set +e; code="$(fetch "?files=1" "$files")"; rc=$?; set -e
  [ "$rc" = 0 ] || die "the files download failed or was cut short (curl exit $rc); nothing kept, the last copy is unchanged"
  [ "$code" = 200 ] || die "files: $(refused "$code" "$files"); nothing kept, the last copy is unchanged"
  nfiles="$(tar -tzf "$files" | grep -vc '/$' || true)"
  want="$(tr -d '\r' < "$heads" | awk -F': ' 'tolower($1) == "x-snapshot-files" { print $2 }')"
  [ -z "$want" ] || [ "$nfiles" = "$want" ] || die "the files archive lists $nfiles files, the server sent $want; nothing kept"
  mkdir -p "$OUT" "$stage/cloud"; chmod 700 "$OUT" "$stage"
  ln "$dump" "$stage/cloud/database.dump" 2>/dev/null || cp "$dump" "$stage/cloud/database.dump"
  mv "$files" "$stage/cloud/files.tar.gz"
  kept="$OUT/plcos-cloud-$(date -u +%Y%m%dT%H%MZ)-daily.tar.gz.gpg"
  [ ! -e "$kept" ] || die "$kept exists; nothing kept"
  # backup-real.sh's method: pack and encrypt in one stream, the passphrase on a file descriptor.
  tar -C "$stage" -cz cloud | gpg --batch --quiet --pinentry-mode loopback \
    --passphrase-fd 3 --symmetric --cipher-algo AES256 --compress-algo none -o "$kept" 3< <(passphrase)
  chmod 600 "$kept"
  shasum -a 256 "$kept" | awk '{print $1}' > "$kept.sha256"
  rm -rf "$stage"
  python3 "$HERE/scripts/backup-prune.py" "$OUT" "${MAX_GB:-300}"
  say "    kept $(basename "$kept") ($(du -h "$kept" | awk '{print $1}'), $nfiles files and the dump)"
fi

say "2/4 restore into $incoming"
lpsql "$MAINT_URL" -c "drop database if exists \"$incoming\" with (force)" -c "create database \"$incoming\"" >/dev/null
PGPASSWORD="$copy_pw" pg pg_restore -w --no-owner --no-acl --exit-on-error --jobs 4 -d "postgres://$to_user@$to_host:$to_port/$incoming" "$dump" \
  || die "restore failed; $incoming is left for a look, the last copy is unchanged"
t2=$(now); say "    $(( t2 - t1 )) s"

say "3/4 check"
got="$(lpsql "postgres://$to_user@$to_host:$to_port/$incoming" -c "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r','p') and n.nspname <> 'information_schema' and n.nspname !~ '^pg_'")"
[ "$got" -ge "$tables" ] || die "restored $got tables, the dump has $tables; the last copy is unchanged"
say "    $got tables restored"

say "4/4 replace $to_db"
lpsql "$MAINT_URL" -c "drop database if exists \"$to_db\" with (force)" -c "alter database \"$incoming\" rename to \"$to_db\"" \
  -c "comment on database \"$to_db\" is 'cloud copy taken $taken from $src_host'" >/dev/null
say "done in $(( $(now) - t0 )) s. Serve it: bash scripts/cloud-pull.sh serve --to $TO_URL"
