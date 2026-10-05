#!/usr/bin/env bash
# Record a workflow run made on the Mac in the cloud app's ledger (docs/28-cloud-workflows.md §5), now that
# the Mac's ledger is frozen. The same metadata and result files as scripts/workflow-run.ts:
#
#   bash scripts/cloud-run.sh [--to <app url>] begin <metadata.json>            prints the run id
#   bash scripts/cloud-run.sh [--to <app url>] finish <runId> <result.json>
#
# The server validates each line with the ledger's own writer; source is claude-code, chatgpt or script, and
# only the person who began a run finishes it. Nothing about the run's content is printed.
#
# Secrets, never printed and never on a command line, as for scripts/cloud-push.sh:
#   the push token   Keychain item plcos-railway / push-token (CLOUD_PUSH_TOKEN for tests).
#   the app URL      --to, else CLOUD_APP_URL, else Keychain item plcos-railway / app-url.
set -euo pipefail
die() { printf '[cloud-run] STOPPED: %s\n' "$*" >&2; exit 1; }
keychain() { command -v security >/dev/null 2>&1 && security find-generic-password -s plcos-railway -a "$1" -w 2>/dev/null; }
usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0" >&2; exit 2; }

TO=""
[ "${1:-}" = "--to" ] && { TO="${2:-}"; shift 2; }
cmd="${1:-}"
case "$cmd" in
  begin) [ $# -eq 2 ] && [ -f "$2" ] || usage ;;
  finish) [ $# -eq 3 ] && [ -f "$3" ] || usage
    [[ "$2" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] || die "finish needs the run id begin printed" ;;
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
  || die "no push token: make one in Preferences → MCP access and store it as Keychain item plcos-railway / push-token"

body() {
  node -e '
const fs = require("fs"), [cmd, a, b] = process.argv.slice(1);
let x; try { x = JSON.parse(fs.readFileSync(cmd === "begin" ? a : b, "utf8")); } catch { console.error("[cloud-run] STOPPED: the file is not JSON"); process.exit(1); }
process.stdout.write(JSON.stringify(cmd === "begin" ? { event: "begin", run: x } : { event: "finish", runId: a, result: x }));
' "$@"
}
payload="$(body "$@")" || exit 1

set +e
answer="$(printf '%s' "$payload" | curl -sS --proto "$proto" --connect-timeout 20 --max-time 60 \
  -K <(printf 'header = "Authorization: Bearer %s"\nheader = "Content-Type: application/json"\n' "$token") \
  --data-binary @- -w '\n%{http_code}' "$TO/api/sync/runs")"
rc=$?
set -e
[ "$rc" = 0 ] || die "the call did not complete (curl exit $rc)"
code="${answer##*$'\n'}"; reply="${answer%$'\n'*}"
printf '%s' "$reply" | node -e '
const code = Number(process.argv[1]), cmd = process.argv[2];
let a; try { a = JSON.parse(require("fs").readFileSync(0, "utf8")); } catch { console.error(`[cloud-run] the server answered ${code} with no readable reason`); process.exit(1); }
if (!a.ok) { console.error(`[cloud-run] REFUSED (${code}): ${a.error || "no reason given"}`); process.exit(1); }
if (cmd === "begin") console.log(a.runId); else console.log(`[cloud-run] run ${a.runId} finished: ${a.outcome}`);
' "$code" "$cmd"
