#!/bin/bash
# Ship claude/main to the live folder: the gate first, then an ff-merge, an optional restart, a smoke test of
# real pages, and an automatic rollback if they fail (docs/deploy/03). A local-machine tool; see docs/COLLAB.md.
# Usage: ship.sh [--restart] [--deploy]
#   --deploy  then push master to `deploy`, which Railway builds, and wait until Railway serves that commit
#             (its /api/health names the commit). The URL comes from PLCOS_CLOUD_URL or ~/.plcos-helpers/cloud-url.
# Once the real data has moved to the cloud (data/real/moved-to-cloud, 5 Oct 2026) the Mac serves no real data:
# the ff-merge still updates the Mac checkout (its scripts push and pull), but there is no restart and no local
# smoke test, and the cloud check is the one that counts.
set -u
LIVE="${LIVE:-$HOME/git/plc-os/plcos-claude-live}"
HERE="$(cd "$(dirname "$0")" && pwd)"
RESTART=0; DEPLOY=0
for a in "$@"; do case "$a" in --restart) RESTART=1 ;; --deploy) DEPLOY=1 ;; *) echo "usage: ship.sh [--restart] [--deploy]"; exit 2 ;; esac; done
cd "$LIVE" || exit 1
CLOUD=0; [ -e "$LIVE/data/real/moved-to-cloud" ] && CLOUD=1
CLOUD_URL="${PLCOS_CLOUD_URL:-$(cat "$HOME/.plcos-helpers/cloud-url" 2>/dev/null)}"; CLOUD_URL="${CLOUD_URL%/}"
[ "$DEPLOY" = 0 ] || [ -n "$CLOUD_URL" ] || { echo "SHIP refused: --deploy needs PLCOS_CLOUD_URL or ~/.plcos-helpers/cloud-url"; exit 1; }
# The gate runs here, so a failing gate can never ship (27 Sep: a chained command shipped past one).
GATE_DIR="${GATE_DIR:-$HOME/git/plc-os/plcos-claude-dev}" bash "$HERE/gate.sh" > /tmp/ship-gate.log 2>&1 || { echo "SHIP refused: the gate failed (see /tmp/ship-gate.log)"; exit 1; }
prev=$(git rev-parse HEAD)
git merge -q --ff-only claude/main || { echo "SHIP: ff-merge failed"; exit 1; }
now=$(git rev-parse --short HEAD)
# A changed lockfile needs its packages in live, and a restart to load them (2 Oct 2026).
deps=0
if ! git diff --quiet "$prev" HEAD -- package-lock.json; then
  bash "$HERE/deps-sync.sh" "$LIVE" || { echo "SHIP: dependencies failed; rolling back"; git reset -q --hard "$prev"; bash "$HERE/deps-sync.sh" "$LIVE"; exit 1; }
  deps=1
fi
# Push master to `deploy` and wait until Railway serves it. No automatic rollback in the cloud: a bad deploy is
# rolled back in Railway (Deployments → an earlier one → Redeploy), which this prints.
deploy() {
  local sha; sha=$(git rev-parse HEAD)
  git push -q origin master:deploy || { echo "DEPLOY: the push to deploy failed"; return 1; }
  # GUESS: a Railway build and start takes 4–8 min; 25 min covers a slow queue.
  for i in $(seq 75); do
    sleep 20
    served=$(curl -s -m 15 "$CLOUD_URL/api/health" | sed -n 's/.*"commit":"\([0-9a-f]*\)".*/\1/p')
    [ -n "$served" ] && [ "${sha#$served}" != "$sha" ] && break
    served=""
  done
  [ -n "$served" ] || { echo "DEPLOY: Railway is not serving ${sha:0:12} after 25 min; check the build in Railway"; return 1; }
  code=$(curl -s -o /dev/null -m 60 -w '%{http_code}' "$CLOUD_URL/signin")
  [ "$code" = 200 ] || { echo "DEPLOY: /signin answered $code on ${sha:0:12}; roll back in Railway: Deployments → the previous one → Redeploy"; return 1; }
  echo "DEPLOY ok ${sha:0:12}"
}
[ "$CLOUD" = 1 ] && {
  echo "SHIP ok $now (Mac checkout only: the real data is in the cloud)"
  [ "$DEPLOY" = 1 ] || exit 0
  deploy && exit 0 || exit 3
}
restart() {
  kill $(pgrep -f "npm run dev:real") $(pgrep -f "next dev --hostname 0.0.0.0 --port 3000") \
    $(pgrep -f "^next-server" | while read p; do lsof -a -p $p -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1 && echo $p; done) 2>/dev/null
  # Relaunch it here when nothing else does (28 Sep: a rollback restart left live down). A terminal loop
  # that relaunches on its own gets 15 s first.
  sleep 15
  if ! lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
    (cd "$LIVE" && nohup npm run dev:real >> "$LIVE/data/real/logs/live-3000.log" 2>&1 &)
  fi
}
{ [ "$RESTART" = 1 ] || [ "$deps" = 1 ]; } && restart
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
for i in 1 2 3 4 5 6; do ok && { echo "SHIP ok $now"; [ "$DEPLOY" = 1 ] || exit 0; deploy && exit 0 || exit 3; }; sleep 20; done
echo "SHIP FAILED at $now: rolling live back to $(git rev-parse --short $prev)"
git reset -q --hard "$prev"
[ "$deps" = 1 ] && bash "$HERE/deps-sync.sh" "$LIVE"
restart
exit 2
