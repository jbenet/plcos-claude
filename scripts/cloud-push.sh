#!/usr/bin/env bash
# Send one finished research output from the Mac up to the cloud app (docs/deploy/railway.md §7;
# Juan, 4 Oct 2026, decision F: research runs in the cloud and on the Mac, and the Mac pushes results up).
#
#   bash scripts/cloud-push.sh [--to <app url>] [--workflow W1|W1c|W5|W13] [--run <ledger run id>] <file>...
#   bash scripts/cloud-push.sh [--to <app url>] prospects <file.jsonl>...
#   bash scripts/cloud-push.sh [--to <app url>] status <import job id>
#
# <file> is a W1 finding (…/enrich/raw/<key>.json), a W5 strategy (…/enrich/strategy/[<vehicle>/]<key>.json),
# a W1c review (…/enrich/fact-review-<NN><part>.jsonl) with the findings it corrected, or W13 identity
# proposals (…/enrich/identity-decisions[-<name>].jsonl; the server appends them to its own file, and an Admin
# applies them with Merge duplicate identities) — one workflow's
# output per push; the workflow is read from the paths. --run names the Mac's ledger run, which the cloud
# records as the push's parent.
#
# `prospects` pushes researched prospects (docs/prospects-import.md), each file wherever it is. The server
# checks every line and every vehicle slug, refuses the whole push if one fails, writes the file under a new
# name in its enrich/prospects/ and queues Add prospects as you (the token's owner), so the pursuits are
# yours. The script waits up to two minutes for that import and prints its counts; `status <job id>` asks
# again later.
#
# Checked here first, with the importer's own validators, and nothing is sent if any check fails. The
# server checks again, refuses an older file over a newer one, keeps what arrived under
# enrich/inbox/<run>/, records a ledger run, and queues the findings import. The same push twice is
# taken once.
#
# Secrets, never printed and never on a command line:
#   the push token   Keychain item plcos-railway / push-token (CLOUD_PUSH_TOKEN for tests); a GP or an
#                    Admin makes one in Preferences → MCP access. It reaches curl through a config on a
#                    file descriptor.
#   the app URL      --to, else CLOUD_APP_URL, else Keychain item plcos-railway / app-url.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
die() { printf '[cloud-push] STOPPED: %s\n' "$*" >&2; exit 1; }
keychain() { command -v security >/dev/null 2>&1 && security find-generic-password -s plcos-railway -a "$1" -w 2>/dev/null; }
usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0" >&2; exit 2; }

TO=""; pass=(); files=(); mode=push; job=""; prospects=0
while [ $# -gt 0 ]; do
  case "$1" in
    --to) TO="$2"; shift 2 ;;
    --workflow|--run|--source|--agent|--model) pass+=("$1" "$2"); shift 2 ;;
    -h|--help) usage ;;
    -*) die "unknown argument $1" ;;
    prospects) [ "${#files[@]}" -eq 0 ] && [ "$prospects" = 0 ] || die "prospects comes before the files"; prospects=1; pass+=(--workflow prospects); shift ;;
    status) [ "${#files[@]}" -eq 0 ] || die "status takes a job id, not files"; mode=status; job="${2:-}"; shift; [ $# -gt 0 ] && shift ;;
    *) [ -f "$1" ] || die "$1 is not a file"; files+=("$(cd "$(dirname "$1")" && pwd -P)/$(basename "$1")"); shift ;;
  esac
done
if [ "$mode" = status ]; then
  [[ "$job" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] || die "status needs the import job id the push answered"
else
  [ "${#files[@]}" -gt 0 ] || usage
fi

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

# The import's state and counts (GET /api/sync/push?job=<id>). Prints one line; exit 0 finished, 3 still going, 1 refused or failed.
status_of() {
  local answer code body
  answer="$(curl -sS --proto "$proto" --connect-timeout 20 --max-time 60 \
    -K <(printf 'header = "Authorization: Bearer %s"\n' "$token") -w '\n%{http_code}' "$TO/api/sync/push?job=$1")" || return 1
  code="${answer##*$'\n'}"; body="${answer%$'\n'*}"
  printf '%s' "$body" | node -e '
const code = Number(process.argv[1]);
let a; try { a = JSON.parse(require("fs").readFileSync(0, "utf8")); } catch { console.log(`[cloud-push] the server answered ${code} with no readable reason`); process.exit(1); }
if (!a.ok) { console.error(`[cloud-push] status REFUSED (${code}): ${a.error || "no reason given"}`); process.exit(1); }
const j = a.job, c = j.counts || {};
const counts = ["added", "existing", "ambiguous", "invalid", "moved", "kept", "inProgress"].filter((k) => typeof c[k] === "number").map((k) => `${c[k]} ${k}`).join(", ");
const mine = (j.pushed || []).map((f) => `${f.won} rows won, ${f.lost} lost to another file`).join("; ");
if (j.status === "completed") { console.log(`[cloud-push] ${j.kind} import ${j.id} completed: ${counts || "no counts"}${mine ? ` (your file: ${mine})` : ""}`); process.exit(0); }
if (j.status === "failed") { console.error(`[cloud-push] ${j.kind} import ${j.id} FAILED: ${j.error || "no reason given"}`); process.exit(1); }
console.log(`[cloud-push] ${j.kind} import ${j.id} ${j.status}: ${j.phase}`); process.exit(3);
' "$code"
}

if [ "$mode" = status ]; then status_of "$job"; exit $?; fi

bundle() { (cd "$HERE" && node --import tsx scripts/cloud-push-bundle.ts "$@" ${pass[@]+"${pass[@]}"} "${files[@]}"); }
bundle --check || exit 1

set +e
answer="$(bundle | curl -sS --proto "$proto" --connect-timeout 20 --max-time 600 \
  -K <(printf 'header = "Authorization: Bearer %s"\nheader = "Content-Type: application/json"\n' "$token") \
  --data-binary @- -w '\n%{http_code}' "$TO/api/sync/push")"
rc=$?
set -e
[ "$rc" = 0 ] || die "the push did not complete (curl exit $rc); run it again: the same push is taken once"
code="${answer##*$'\n'}"; body="${answer%$'\n'*}"
set +e
taken="$(printf '%s' "$body" | node -e '
const code = Number(process.argv[1]);
let a; try { a = JSON.parse(require("fs").readFileSync(0, "utf8")); } catch { console.log(`[cloud-push] the server answered ${code} with no readable reason`); process.exit(1); }
if (a.duplicate) { console.log(`[cloud-push] already taken as run ${a.runId}; nothing was written again.`); process.exit(0); }
if (a.ok) {
  const imp = a.import;
  console.log(`[cloud-push] taken: run ${a.runId}, ${(a.files || []).length} files (${a.replaced || 0} replaced a server copy)`
    + (a.published && a.published.length ? `, written as ${a.published.join(", ")}` : "")
    + (imp ? `; ${a.published ? "prospects" : "findings"} import ${imp.jobId} ${imp.status}` : "; no import needed"));
  if (a.note) console.log(`[cloud-push] ${a.note}`);
  if (imp && a.published) console.log(`JOB ${imp.jobId}`);
  process.exit(0);
}
console.error(`[cloud-push] REFUSED (${code}): ${a.error || "no reason given"}`);
for (const r of a.rejected || []) console.error(`  ${r.path || "the push"}: ${(r.problems || []).join("; ")}`);
process.exit(1);
' "$code")"
rc=$?
set -e
printf '%s\n' "$taken" | grep -v '^JOB ' || true
[ "$rc" = 0 ] || exit "$rc"

# A prospects push: wait for its import (up to two minutes) and print the counts.
job="$(printf '%s\n' "$taken" | sed -n 's/^JOB //p')"
[ -n "$job" ] || exit 0
for _ in $(seq 1 24); do
  set +e; line="$(status_of "$job")"; s=$?; set -e
  if [ "$s" != 3 ]; then printf '%s\n' "$line"; exit "$s"; fi
  sleep 5
done
printf '%s\n[cloud-push] still running; ask again with: bash scripts/cloud-push.sh status %s\n' "$line" "$job"
