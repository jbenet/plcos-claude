#!/usr/bin/env bash
# Cutover between two Postgres databases, and its reverse (docs/deploy/rev2/00-plan-rev2.md §2;
# docs/deploy/rev2/image-and-cutover.md). Build item 13. A full-database move, never a sync.
#
#   bash scripts/cutover.sh run --from <url> --to <url> [--reverse] [--keep-dakota] [--grants <file.sql>] [--work <dir>]
#   bash scripts/cutover.sh unfreeze --db <url>     rollback before any write on the target
#   bash scripts/cutover.sh status --db <url>       frozen or not, READ_ONLY_MODE, table count
#   bash scripts/cutover-reverse.sh --from <service url> --to <new database url>
#
# `run`, in order; any failure stops it with the source still frozen and the target read-only:
#   1. preflight  both reachable; not the same database; the target has no tables (never overwrites);
#                 with --reverse, the target must not be a frozen or *_precutover database.
#   2. freeze     READ_ONLY_MODE on in the source (build item 9's platform.set_read_only_mode, when it
#                 exists), then the database itself read-only for new transactions, then every other
#                 session on it terminated. Nothing writes to the source after this line.
#   3. dump       pg_dump -Fc of the frozen source; pg_restore --list must list every table's data.
#   4. restore    pg_restore --no-owner --no-acl --single-transaction into the target, then the
#                 optional grants file; the target is set read-only until it verifies.
#   5. verify     scripts/pg-verify.ts: per-table row counts and ordered-row checksums, sequences, and
#                 object counts. Any mismatch blocks the cutover.
#   6. sanitize  strip Dakota on target by default (--keep-dakota skips); fail copied active jobs.
#   7. flip       the target made writable and READ_ONLY_MODE cleared there. The source stays frozen
#                 (keep it untouched for 14 days). Pointing the processes at the target is a config
#                 change this script prints but does not make.
#
# URLs carry no passwords here (use ~/.pgpass or PGPASSWORD). The roles need ALTER DATABASE on both
# (the owner role in the service). The report written to the work directory holds counts only.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-}"
pg() { "${PG_BIN:+$PG_BIN/}$1" "${@:2}"; }
say() { printf '[cutover] %s\n' "$*"; }
die() { printf '[cutover] STOPPED: %s\n' "$*" >&2; exit 1; }
sql() { pg psql "$1" -XAtq -v ON_ERROR_STOP=1 -c "$2"; }
# Writes need to get past the database-level read-only default this script sets.
sqlw() { PGOPTIONS="-c default_transaction_read_only=off" pg psql "$1" -XAtq -v ON_ERROR_STOP=1 -c "$2"; }

USER_TABLES="select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname <> 'information_schema' and n.nspname !~ '^pg_'"
FROZEN="select coalesce(bool_or(cfg = 'default_transaction_read_only=on'), false) from pg_db_role_setting s, unnest(s.setconfig) cfg where s.setdatabase = (select oid from pg_database where datname = current_database()) and s.setrole = 0"
HAS_FLAG="select to_regprocedure('platform.set_read_only_mode(boolean)') is not null"
flag_state() { # the function is resolved at parse time, so look before calling it
  if [ "$(sql "$1" "select to_regprocedure('platform.read_only_mode()') is not null")" = t ]; then
    [ "$(sql "$1" "select platform.read_only_mode()")" = t ] && echo on || echo off
  else
    echo "not-built"
  fi
}

set_flag() { # <url> <true|false>: the application's READ_ONLY_MODE (build item 9), when it exists.
  if [ "$(sql "$1" "$HAS_FLAG")" = t ]; then
    sqlw "$1" "select platform.set_read_only_mode($2)" >/dev/null; echo "READ_ONLY_MODE=$2"
  else
    echo "READ_ONLY_MODE not built yet (build item 9); database-level freeze only"
  fi
}
freeze_db() { # <url>: new transactions read-only, other sessions ended.
  sqlw "$1" "do \$\$ begin execute format('alter database %I set default_transaction_read_only = on', current_database()); end \$\$" >/dev/null
  sql "$1" "select count(pg_terminate_backend(pid)) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and backend_type = 'client backend'"
}
thaw_db() {
  sqlw "$1" "do \$\$ begin execute format('alter database %I reset default_transaction_read_only', current_database()); end \$\$" >/dev/null
}
identity() { sql "$1" "select (select system_identifier from pg_control_system())::text || '/' || current_database()"; }

cmd="${1:-}"; shift || true
FROM=""; TO=""; DB=""; REVERSE=""; GRANTS=""; WORK=""; KEEP_DAKOTA=""
while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM="$2"; shift 2 ;;
    --to) TO="$2"; shift 2 ;;
    --db) DB="$2"; shift 2 ;;
    --reverse) REVERSE=1; shift ;;
    --keep-dakota) KEEP_DAKOTA=1; shift ;;
    --grants) GRANTS="$2"; shift 2 ;;
    --work) WORK="$2"; shift 2 ;;
    *) die "unknown argument $1" ;;
  esac
done

case "$cmd" in
  status)
    [ -n "$DB" ] || die "status needs --db"
    echo "frozen=$(sql "$DB" "$FROZEN") read_only_mode=$(flag_state "$DB") tables=$(sql "$DB" "$USER_TABLES")"
    exit 0 ;;
  unfreeze)
    [ -n "$DB" ] || die "unfreeze needs --db"
    thaw_db "$DB"; say "$(set_flag "$DB" false)"; say "unfrozen: $(identity "$DB" | cut -d/ -f2) takes writes again."
    exit 0 ;;
  run) ;;
  *) sed -n 2,30p "$0"; exit 2 ;;
esac

[ -n "$FROM" ] && [ -n "$TO" ] || die "run needs --from and --to"
[ -z "$GRANTS" ] || [ -f "$GRANTS" ] || die "no grants file at $GRANTS"
WORK="${WORK:-$(mktemp -d)}"; mkdir -p "$WORK"; chmod 700 "$WORK"
dump="$WORK/cutover.dump"; report="$WORK/cutover-report.json"
direction=$([ -n "$REVERSE" ] && echo reverse || echo forward)
t0=$(date +%s); step_at=$t0; steps=""
step() { local now; now=$(date +%s); steps="$steps\"$1\":$(( now - step_at )),"; step_at=$now; }

# ---- 1. preflight -----------------------------------------------------------------------------------
src_id="$(identity "$FROM")" || die "cannot connect to the source"
dst_id="$(identity "$TO")" || die "cannot connect to the target"
[ "$src_id" != "$dst_id" ] || die "source and target are the same database"
[ "$(sql "$FROM" "select to_regclass('platform.migration') is not null")" = t ] || die "the source has no migration ledger; is it a Capital OS database?"
if [ -n "$REVERSE" ]; then
  [ "$(sql "$TO" "$FROZEN")" = f ] || die "the target is a frozen database; a reverse cutover restores into a NEW database, never the frozen original"
  case "${dst_id#*/}" in *precutover*) die "the target is the kept pre-cutover database; restore into a new one" ;; esac
fi
dst_tables="$(sql "$TO" "$USER_TABLES")"
[ "$dst_tables" = 0 ] || die "the target already has $dst_tables tables; a cutover restores only into an empty database"
[ "$(sql "$FROM" "$FROZEN")" = f ] || say "the source is already frozen (a resumed cutover)"
src_tables="$(sql "$FROM" "$USER_TABLES")"
say "$direction: ${src_id#*/} ($src_tables tables) -> ${dst_id#*/} (empty)"
step preflight

# ---- 2. freeze --------------------------------------------------------------------------------------
say "freeze: $(set_flag "$FROM" true)"
ended="$(freeze_db "$FROM")"
[ "$(sql "$FROM" "$FROZEN")" = t ] || die "the source did not freeze"
if sql "$FROM" "create temporary table cutover_write_probe(x int)" >/dev/null 2>&1; then die "the source still accepts writes"; fi
say "freeze: source read-only; $ended other session(s) ended"
step freeze

# ---- 3. dump ----------------------------------------------------------------------------------------
pg pg_dump -Fc --no-owner --no-acl -f "$dump" "$FROM" || die "pg_dump failed"
chmod 600 "$dump"
listed="$(pg pg_restore --list "$dump" | grep -c ' TABLE DATA ' || true)"
[ "$listed" = "$src_tables" ] || die "the dump lists $listed tables of data, the source has $src_tables"
dump_bytes="$(wc -c < "$dump" | tr -d ' ')"
say "dump: $listed tables of data, $dump_bytes bytes"
step dump

# ---- 4. restore -------------------------------------------------------------------------------------
PGOPTIONS="-c default_transaction_read_only=off" pg pg_restore --no-owner --no-acl --exit-on-error --single-transaction -d "$TO" "$dump" \
  || die "pg_restore failed; the single transaction rolled back, the target is empty"
if [ -n "$GRANTS" ]; then
  PGOPTIONS="-c default_transaction_read_only=off" pg psql "$TO" -XAtq -v ON_ERROR_STOP=1 -1 -f "$GRANTS" >/dev/null || die "the grants file failed"
fi
freeze_db "$TO" >/dev/null
say "restore: done; target read-only until verified"
step restore

# ---- 5. verify --------------------------------------------------------------------------------------
verify_line="$(cd "$HERE" && node --import tsx scripts/pg-verify.ts "$FROM" "$TO" --json "$WORK/verify.json")" \
  || { say "$verify_line"; die "verification failed; the source stays frozen, the target read-only (see $WORK/verify.json)"; }
say "$verify_line"
step verify

# Transform only the verified TARGET. Keep it frozen until both steps commit.
# Verification above proves the restore; intentional removals have separate counts.
if [ -z "$KEEP_DAKOTA" ]; then
  (cd "$HERE" && PGOPTIONS="-c default_transaction_read_only=off" node --import tsx scripts/strip-dakota.ts "$TO") \
    || die "Dakota stripping failed; target remains read-only"
fi
PGOPTIONS="-c default_transaction_read_only=off" pg psql "$TO" -XAtq -v ON_ERROR_STOP=1 -1 \
  -f "$HERE/scripts/stop-cutover-jobs.sql" 2>/dev/null || die "copied jobs could not be stopped; target remains read-only"
step sanitize

# ---- 7. flip ----------------------------------------------------------------------------------------
thaw_db "$TO"
say "flip: $(set_flag "$TO" false)"
[ "$(sql "$TO" "$FROZEN")" = f ] || die "the target did not become writable"
step flip
rm -f "$dump"

python3 - "$WORK/verify.json" > "$report" <<PY
import json, sys
v = json.load(open(sys.argv[1]))
print(json.dumps({"direction": "$direction", "sourceTables": $src_tables, "tableDataListed": $listed, "dumpBytes": $dump_bytes,
  "tables": v["tables"], "rows": v["rows"], "sequences": v["sequences"], "mismatches": len(v["mismatchedTables"]) + len(v["missingTables"]) + len(v["extraTables"]) + len(v["mismatchedSequences"]),
  "objects": v["objects"], "seconds": {${steps%,}}, "totalSeconds": $(( $(date +%s) - t0 ))}))
PY
chmod 600 "$report"
say "done in $(( $(date +%s) - t0 ))s; report $report (counts only)"
if [ -n "$REVERSE" ]; then
  say "next: point the Mac live server at ${dst_id#*/}, re-enable the Mac's connector keys, and keep the service database frozen."
else
  say "next: point the app's DATABASE_URL at ${dst_id#*/}; enable schedules one connector at a time; keep ${src_id#*/} frozen for 14 days."
fi
