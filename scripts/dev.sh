#!/usr/bin/env bash
# Start and stop the local services our dev setup needs (Juan, 27 Sep 2026): today, the Postgres
# cluster behind the live server (docs/21-postgres.md). Restarting the dev server never stops Postgres;
# only `npm run dev:stop` does.
#
#   npm run dev:start    start Postgres if it isn't running (then run npm run dev:real as usual)
#   npm run dev:stop     stop the live dev server if it's running, then stop Postgres
#   npm run dev:status   say what's running
set -uo pipefail
export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8
HERE="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
CLUSTER="$HERE/data/real/postgres"
URL_FILE="$HERE/data/real/postgres.url"

pg_running() { "$PG_BIN/pg_ctl" -D "$CLUSTER" status >/dev/null 2>&1; }

case "${1:-status}" in
  start)
    [ -f "$URL_FILE" ] || { echo "No data/real/postgres.url: live uses PGlite, nothing to start."; exit 0; }
    if pg_running; then echo "Postgres already running."; else
      "$PG_BIN/pg_ctl" -D "$CLUSTER" -l "$CLUSTER/server.log" -w -t 60 start >/dev/null && echo "Postgres started." || { echo "Postgres did not start; see $CLUSTER/server.log" >&2; exit 1; }
    fi ;;
  stop)
    [ "$(basename "$HERE")" = plcos-claude-live ] || { echo "dev:stop runs only in the live folder (plcos-claude-live)." >&2; exit 1; }
    pids=$(pgrep -f "npm run dev:real"; pgrep -f "next dev --hostname 0.0.0.0 --port 3000")
    [ -n "$pids" ] && { kill $pids 2>/dev/null; echo "Stopped the live dev server."; sleep 2; }
    if pg_running; then "$PG_BIN/pg_ctl" -D "$CLUSTER" -m fast -w -t 30 stop >/dev/null && echo "Postgres stopped."; else echo "Postgres was not running."; fi ;;
  status)
    pgrep -f "next dev --hostname 0.0.0.0 --port 3000" >/dev/null && echo "Live dev server: running" || echo "Live dev server: stopped"
    if [ -f "$URL_FILE" ]; then pg_running && echo "Postgres: running" || echo "Postgres: stopped"; else echo "Database: PGlite (no postgres.url)"; fi ;;
  *) echo "usage: dev.sh start|stop|status" >&2; exit 2 ;;
esac
