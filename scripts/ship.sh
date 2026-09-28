#!/bin/bash
# Ship claude/main to the live folder: the gate first, then an ff-merge, an optional restart, a smoke test of
# real pages, and an automatic rollback if they fail (docs/deploy/03). A local-machine tool; see docs/COLLAB.md.
# Usage: ship.sh [--restart]
set -u
LIVE="${LIVE:-$HOME/git/plc-os/plcos-claude-live}"
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$LIVE" || exit 1
# The gate runs here, so a failing gate can never ship (27 Sep: a chained command shipped past one).
GATE_DIR="${GATE_DIR:-$HOME/git/plc-os/plcos-claude-dev}" bash "$HERE/gate.sh" > /tmp/ship-gate.log 2>&1 || { echo "SHIP refused: the gate failed (see /tmp/ship-gate.log)"; exit 1; }
prev=$(git rev-parse HEAD)
git merge -q --ff-only claude/main || { echo "SHIP: ff-merge failed"; exit 1; }
now=$(git rev-parse --short HEAD)
restart() {
  kill $(pgrep -f "npm run dev:real") $(pgrep -f "next dev --hostname 0.0.0.0 --port 3000") \
    $(pgrep -f "^next-server" | while read p; do lsof -a -p $p -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1 && echo $p; done) 2>/dev/null
}
[ "${1:-}" = "--restart" ] && restart
sleep 20
ok() {
  for p in /today /neurotech/pipeline /developer/enrich; do
    body=$(curl -s -m 180 -w '\n%{http_code}' "http://localhost:3000$p") || return 1
    code=$(printf '%s' "$body" | tail -1)
    [ "$code" = 200 ] || { echo "SHIP: $p answered $code"; return 1; }
    printf '%s' "$body" | grep -q "Unknown module\|Module not found\|Application error" && { echo "SHIP: $p has a build error"; return 1; }
  done
  return 0
}
for i in 1 2 3 4 5 6; do ok && { echo "SHIP ok $now"; exit 0; }; sleep 20; done
echo "SHIP FAILED at $now: rolling live back to $(git rev-parse --short $prev)"
git reset -q --hard "$prev"
restart
exit 2
