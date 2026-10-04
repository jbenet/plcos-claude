#!/usr/bin/env bash
# A local copy of the cloud database, for testing quickly on the Mac (docs/deploy/railway.md §6).
# One way only: the cloud is the source of truth, the copy is a read-only preview, and nothing here
# writes to the cloud. The pull reads with the read-only role (plcos_ro).
#
#   bash scripts/cloud-pull.sh init  --to <local url> [--dir <folder>]   once: a Postgres cluster for copies
#   bash scripts/cloud-pull.sh pull  --to <local url>                    a fresh copy, replacing the last one
#   bash scripts/cloud-pull.sh serve --to <local url> [--port <n>]       the app on the copy, as a preview
#
# <local url> is postgres://<user>@127.0.0.1:<port>/<database>: loopback, not the Mac's live cluster
# (57433), and a database named plcos_copy…, for example postgres://plcos@127.0.0.1:57434/plcos_copy.
#
# Secrets, never printed and never on a command line:
#   CLOUD_PULL_URL   the cloud database as plcos_ro, over Railway's public TCP proxy, password included.
#                    Unset: read from the Keychain item plcos-railway / pull-url.
#   COPY_PGPASSWORD  the local copy cluster's password. Unset: the Keychain item plcos-railway / copy;
#                    set but empty: no password (a trust cluster, such as the invented-data test one).
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
TO=""; DIR="$HERE/../plcos-data/real/cloud-copy"; PORT_ARG="${PORT:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --to) TO="$2"; shift 2 ;;
    --dir) DIR="$2"; shift 2 ;;
    --port) PORT_ARG="$2"; shift 2 ;;
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
if [ -n "${CLOUD_PULL_URL:-}" ]; then src_url="$CLOUD_PULL_URL"; else src_url="$(keychain pull-url || true)"; fi
[ -n "$src_url" ] || die "no source: set CLOUD_PULL_URL or store it as Keychain item plcos-railway / pull-url"
parse "$src_url" src; unset src_url
[ "$src_host:$src_port/$src_db" != "$to_host:$to_port/$to_db" ] || die "source and copy are the same database"
src_ssl="${PGSSLMODE:-}"
if ! loopback "$src_host"; then
  [ "$src_user" = plcos_ro ] || die "the cloud is read as plcos_ro, the read-only role, not $src_user"
  # Railway's proxy certificate is self-signed: encrypted, not verified (docs/deploy/railway.md §6).
  [ -n "$src_ssl" ] || src_ssl=require
fi
[[ "$src_query" =~ (^|&)sslmode=([a-z-]+) ]] && src_ssl="${BASH_REMATCH[2]}"
SRC_URL="postgres://$src_user@$src_host:$src_port/$src_db"
mkdir -p "$DIR"; chmod 700 "$DIR"
dump="$DIR/incoming.dump"; toc="$DIR/incoming.toc"
trap 'rm -f "$dump" "$toc"' EXIT
incoming="${to_db}_incoming"

lpsql "$MAINT_URL" -c "select 1" >/dev/null || die "cannot connect to the copy cluster on :$to_port: is it running (init, or pg_ctl start), and is the password right?"
taken="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; t0=$(now)
say "1/4 dump $src_db from $src_host:$src_port as $src_user"
( if [ -n "$src_ssl" ]; then export PGSSLMODE="$src_ssl"; fi
  PGPASSWORD="$src_pass" pg pg_dump -w -Fc --no-owner --no-acl -d "$SRC_URL" -f "$dump" ) \
  || die "pg_dump failed; the last copy is unchanged"
unset src_pass
pg pg_restore --list "$dump" > "$toc"
tables="$(grep -c ' TABLE DATA ' "$toc" || true)"
[ "$tables" -gt 0 ] || die "the dump holds no table data; the last copy is unchanged"
t1=$(now); say "    $(( $(wc -c < "$dump") / 1048576 )) MiB, $tables tables, $(( t1 - t0 )) s"

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
