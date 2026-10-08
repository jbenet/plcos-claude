#!/usr/bin/env bash
# Queue a research export, a findings import or Merge duplicate identities on the cloud app, or read a job's state (lib/sync/jobs.ts),
# with an Admin token, as the buttons in Developer → Enrichment would. Counts only, never a name.
#
#   bash scripts/cloud-job.sh [--to <app url>] export|findings|duplicates   prints the job id
#   bash scripts/cloud-job.sh [--to <app url>] affinity slice|history|notes|meetings|translate   prints the job id
#   bash scripts/cloud-job.sh [--to <app url>] status <job id>
#
# For fresh Affinity statuses and emails: slice, then history, then translate, each after the last completes.
#
# Secrets, never printed and never on a command line, as for scripts/cloud-push.sh:
#   the token     Keychain item plcos-railway / push-token (CLOUD_PUSH_TOKEN for tests), an Admin token.
#   the app URL   --to, else CLOUD_APP_URL, else Keychain item plcos-railway / app-url.
set -euo pipefail
die() { printf '[cloud-job] STOPPED: %s\n' "$*" >&2; exit 1; }
keychain() { command -v security >/dev/null 2>&1 && security find-generic-password -s plcos-railway -a "$1" -w 2>/dev/null; }
usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0" >&2; exit 2; }

TO=""
[ "${1:-}" = "--to" ] && { TO="${2:-}"; shift 2; }
cmd="${1:-}"
case "$cmd" in
  export|findings|duplicates) [ $# -eq 1 ] || usage ;;
  affinity) [ $# -eq 2 ] && [[ "$2" =~ ^(slice|history|notes|meetings|translate)$ ]] || usage ;;
  status) [ $# -eq 2 ] && [[ "$2" =~ ^[0-9a-fA-F-]{36}$ ]] || usage ;;
  *) usage ;;
esac
[ -n "$TO" ] || TO="${CLOUD_APP_URL:-}"
[ -n "$TO" ] || TO="$(keychain app-url || true)"
[ -n "$TO" ] || die "no destination: give --to <app url>, set CLOUD_APP_URL, or store it as Keychain item plcos-railway / app-url"
TO="${TO%/}"
if [[ "$TO" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]]; then proto='=https'
elif [[ "$TO" =~ ^http://(127\.0\.0\.1|localhost)(:[0-9]+)?$ ]]; then proto='=http'
else die "--to must be https://<host> (http only on 127.0.0.1, for tests)"; fi
if [ -n "${CLOUD_PUSH_TOKEN+set}" ]; then token="$CLOUD_PUSH_TOKEN"; else token="$(keychain push-token || true)"; fi
[[ "$token" =~ ^plcos_mcp_[A-Za-z0-9_-]{30,80}$ ]] \
  || die "no token: make an \"Admin\" token in Preferences → MCP access and store it as Keychain item plcos-railway / push-token"

set +e
if [ "$cmd" = status ]; then
  answer="$(curl -sS --proto "$proto" --connect-timeout 20 --max-time 60 \
    -K <(printf 'header = "Authorization: Bearer %s"\n' "$token") -w '\n%{http_code}' "$TO/api/sync/jobs?job=$2")"
else
  if [ "$cmd" = affinity ]; then body="$(printf '{"kind":"affinity","operation":"%s"}' "$2")"; else body="$(printf '{"kind":"%s"}' "$cmd")"; fi
  answer="$(printf '%s' "$body" | curl -sS --proto "$proto" --connect-timeout 20 --max-time 60 \
    -K <(printf 'header = "Authorization: Bearer %s"\nheader = "Content-Type: application/json"\n' "$token") \
    --data-binary @- -w '\n%{http_code}' "$TO/api/sync/jobs")"
fi
rc=$?
set -e
[ "$rc" = 0 ] || die "the call did not complete (curl exit $rc)"
code="${answer##*$'\n'}"; reply="${answer%$'\n'*}"
printf '%s' "$reply" | node -e '
const code = Number(process.argv[1]);
let a; try { a = JSON.parse(require("fs").readFileSync(0, "utf8")); } catch { console.error(`[cloud-job] the server answered ${code} with no readable reason`); process.exit(1); }
if (!a.ok) { console.error(`[cloud-job] REFUSED (${code}): ${a.error || "no reason given"}`); process.exit(1); }
const j = a.job; if (process.argv[2] === "status") console.log(`[cloud-job] ${j.kind} ${j.status}: ${j.phase}${j.error ? ` (${j.error})` : ""} ${JSON.stringify(j.counts || {})}${j.decisions ? ` decisions ${JSON.stringify(j.decisions)}` : ""}`); else console.log(j.id);
' "$code" "$cmd"
