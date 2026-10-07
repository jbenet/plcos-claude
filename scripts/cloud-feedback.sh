#!/usr/bin/env bash
# Read and close the cloud app's feedback by token (lib/sync/feedback.ts; docs/deploy/07-feedback-signal.md §6).
# Run on the Mac, like scripts/cloud-push.sh. Issue text is real data: it lands under data/real/feedback/ and is
# never printed, so only ids and counts reach the terminal.
#
#   bash scripts/cloud-feedback.sh open                  the untouched issues: ids and metadata, no text
#   bash scripts/cloud-feedback.sh active                every issue not done
#   bash scripts/cloud-feedback.sh get 0201,0202         writes data/real/feedback/<id>.md and its screenshots
#   bash scripts/cloud-feedback.sh take 0201             sets in-progress, so the next `open` skips it
#   bash scripts/cloud-feedback.sh close 0201 ['note']   sets done; the note (e.g. '**Done (N123).** …') is appended
#
# The token needs the sync:admin scope, which only an Admin holds (Preferences → MCP access → "Admin").
# Secrets, never printed and never on a command line, as for scripts/cloud-push.sh:
#   the token     Keychain item plcos-railway / push-token (CLOUD_PUSH_TOKEN for tests).
#   the app URL   CLOUD_APP_URL, else Keychain item plcos-railway / app-url.
set -euo pipefail
die() { printf '[cloud-feedback] STOPPED: %s\n' "$*" >&2; exit 1; }
keychain() { command -v security >/dev/null 2>&1 && security find-generic-password -s plcos-railway -a "$1" -w 2>/dev/null; }
usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0" >&2; exit 2; }

TO="${CLOUD_APP_URL:-}"
[ -n "$TO" ] || TO="$(keychain app-url || true)"
[ -n "$TO" ] || die "no destination: set CLOUD_APP_URL, or store it as Keychain item plcos-railway / app-url"
TO="${TO%/}"
if [[ "$TO" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]]; then proto='=https'
elif [[ "$TO" =~ ^http://(127\.0\.0\.1|localhost)(:[0-9]+)?$ ]]; then proto='=http'
else die "CLOUD_APP_URL must be https://<host> (http only on 127.0.0.1, for tests)"; fi
if [ -n "${CLOUD_PUSH_TOKEN+set}" ]; then token="$CLOUD_PUSH_TOKEN"; else token="$(keychain push-token || true)"; fi
[[ "$token" =~ ^plcos_mcp_[A-Za-z0-9_-]{30,80}$ ]] \
  || die "no token: make an \"Admin\" token in Preferences → MCP access and store it as Keychain item plcos-railway / push-token"

OUT="data/real/feedback"
call() { curl -sS --proto "$proto" --connect-timeout 20 --max-time 60 -K <(printf 'header = "Authorization: Bearer %s"\n' "$token") "$@"; }
# A JSON answer: refused calls say why; `summary` prints only what is safe to show.
answer() {
  local code="${1##*$'\n'}" reply="${1%$'\n'*}"
  printf '%s' "$reply" | node -e '
const [code, mode, out] = process.argv.slice(1);
let a; try { a = JSON.parse(require("fs").readFileSync(0, "utf8")); } catch { console.error(`[cloud-feedback] the server answered ${code} with no readable reason`); process.exit(1); }
if (!a.ok) { console.error(`[cloud-feedback] REFUSED (${code}): ${a.error || "no reason given"}`); process.exit(1); }
if (mode === "list") {
  console.log(`[cloud-feedback] ${a.items.length} ${a.view}`);
  for (const i of a.items) console.log(`${i.id}\t${i.status}\t${i.kind}\t${i.priority}\t${i.created}\t${i.page}\t${i.attachments} file(s)`);
} else if (mode === "get") {
  const fs = require("fs"), path = require("path");
  fs.mkdirSync(out, { recursive: true });
  for (const i of a.items) {
    fs.writeFileSync(path.join(out, `${i.id}.md`), i.markdown ?? "");
    console.log(`${i.id}\t${path.join(out, i.id + ".md")}\t${i.attachments.join(" ")}`);
  }
  if (a.missing.length) console.log(`[cloud-feedback] not on the server: ${a.missing.join(", ")}`);
} else console.log(`[cloud-feedback] ${a.issue.id} is ${a.issue.status}${a.issue.closedAt ? `, closed ${a.issue.closedAt}` : ""}`);
' "$code" "$2" "${3:-}"
}
enc() { node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"; }
status() {
  local body
  body="$(node -e 'const [id, status, note] = process.argv.slice(1); process.stdout.write(JSON.stringify(note ? { id, status, note } : { id, status }))' "$1" "$2" "${3:-}")"
  answer "$(printf '%s' "$body" | call -H 'Content-Type: application/json' --data-binary @- -w '\n%{http_code}' "$TO/api/sync/feedback")" status
}

case "${1:-}" in
  open|active) [ $# -eq 1 ] || usage; answer "$(call -w '\n%{http_code}' "$TO/api/sync/feedback?view=$1")" list ;;
  get)
    [ $# -eq 2 ] && [[ "$2" =~ ^[0-9]{4,6}(,[0-9]{4,6})*$ ]] || usage
    files="$(answer "$(call -w '\n%{http_code}' "$TO/api/sync/feedback?ids=$2")" get "$OUT")"
    printf '%s\n' "$files" | cut -f1,2
    # Each issue's screenshots, beside its markdown, under the same relative path the issue uses.
    while IFS=$'\t' read -r id _ atts; do
      [[ "$id" =~ ^[0-9]+$ ]] || continue
      for f in $atts; do
        [[ "$f" =~ ^[A-Za-z0-9._/-]+$ && "$f" != *..* ]] || { echo "[cloud-feedback] skipped an odd file name on $id" >&2; continue; }
        mkdir -p "$OUT/$(dirname "$f")"
        call -f -o "$OUT/$f" "$TO/api/sync/feedback?id=$id&file=$(enc "$f")" && echo "$id	$OUT/$f"
      done
    done <<< "$files" ;;
  take) [ $# -eq 2 ] || usage; status "$2" in-progress ;;
  close) [ $# -ge 2 ] && [ $# -le 3 ] || usage; status "$2" done "${3:-}" ;;
  *) usage ;;
esac
