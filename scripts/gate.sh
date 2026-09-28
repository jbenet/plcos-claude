#!/bin/bash
# The gate every merge passes before it ships (docs/deploy/03, 27 Sep 2026): types, boundaries, the property
# suite on PGlite, and on Postgres when the local test cluster is up. Exits non-zero on any failure.
#
#   bash scripts/gate.sh            in the checkout to test (default: this repo)
#   GATE_DIR=<checkout> bash scripts/gate.sh
set -u
cd "${GATE_DIR:-$(cd "$(dirname "$0")/.." && pwd)}" || exit 1
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

if git grep -nE "^(<<<<<<<|>>>>>>>) " -- . ":!node_modules" >/dev/null 2>&1; then
  echo "FAIL conflict markers:"; git grep -lE "^(<<<<<<<|>>>>>>>) " -- . | head; exit 1
fi

echo "== tsc";        npm run -s check > "$tmp/tsc" 2>&1; rc1=$?; grep -E "error TS" "$tmp/tsc" | head -20; echo "tsc exit $rc1"
echo "== boundaries"; npm run -s boundaries > "$tmp/b" 2>&1; rc2=$?; tail -3 "$tmp/b"; echo "boundaries exit $rc2"
echo "== props (PGlite)"; npm run -s props > "$tmp/p" 2>&1; rc3=$?; grep -E "FAIL" "$tmp/p" | head -20; grep -E "properties hold" "$tmp/p"

rc4=0
# Postgres: the invented-data test cluster (docs/21-postgres.md), if it's running.
PG_TEST_URL="${PG_TEST_URL:-postgres://plcos@127.0.0.1:5434/plcos_test_props}"
if /opt/homebrew/opt/postgresql@17/bin/pg_isready -h 127.0.0.1 -p 5434 -q 2>/dev/null; then
  echo "== props (Postgres)"; DATABASE_URL="$PG_TEST_URL" npm run -s props > "$tmp/pg" 2>&1; rc4=$?
  grep -E "FAIL" "$tmp/pg" | head -20; grep -E "properties hold" "$tmp/pg"
else
  echo "== props (Postgres): test cluster not running, skipped"
fi
exit $(( rc1 || rc2 || rc3 || rc4 ))
