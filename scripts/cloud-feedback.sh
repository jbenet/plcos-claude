#!/usr/bin/env bash
# Read and close the cloud app's feedback by token (lib/sync/feedback.ts; docs/deploy/07-feedback-signal.md §6).
#
#   bash scripts/cloud-feedback.sh open                       the untouched issues: ids and metadata, no text
#   bash scripts/cloud-feedback.sh active                     every issue not done
#   bash scripts/cloud-feedback.sh read 0201,0202             those issues with their text (JSON)
#   bash scripts/cloud-feedback.sh file 0201 <path> <out>     one of that issue's screenshots, saved to <out>
#   bash scripts/cloud-feedback.sh status 0201 done ['note']  set a status; the note is appended to the issue
#
# The token needs the sync:admin scope, which only an Admin holds (Preferences → MCP access → "Admin").
# Secrets, never printed and never on a command line:
#   the token     PLCOS_ADMIN_TOKEN (the cloud environment), else Keychain item plcos-railway / push-token.
#   the app URL   CLOUD_APP_URL, else Keychain item plcos-railway / app-url, else the Railway app.
set -euo pipefail
die() { printf '[cloud-feedback] STOPPED: %s\n' "$*" >&2; exit 1; }
keychain() { command -v security >/dev/null 2>&1 && security find-generic-password -s plcos-railway -a "$1" -w 2>/dev/null; }
usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0" >&2; exit 2; }

TO="${CLOUD_APP_URL:-}"
[ -n "$TO" ] || TO="$(keychain app-url || true)"
[ -n "$TO" ] || TO="https://plcos-production.up.railway.app"
TO="${TO%/}"
if [[ "$TO" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]]; then proto='=https'
elif [[ "$TO" =~ ^http://(127\.0\.0\.1|localhost)(:[0-9]+)?$ ]]; then proto='=http'
else die "CLOUD_APP_URL must be https://<host> (http only on 127.0.0.1, for tests)"; fi
if [ -n "${PLCOS_ADMIN_TOKEN:-}" ]; then token="$PLCOS_ADMIN_TOKEN"; else token="$(keychain push-token || true)"; fi
[[ "$token" =~ ^plcos_mcp_[A-Za-z0-9_-]{30,80}$ ]] \
  || die "no token: set PLCOS_ADMIN_TOKEN, or store an \"Admin\" token as Keychain item plcos-railway / push-token"

call() { curl -sS --proto "$proto" --connect-timeout 20 --max-time 60 -K <(printf 'header = "Authorization: Bearer %s"\n' "$token") "$@"; }
enc() { node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"; }

case "${1:-}" in
  open|active) [ $# -eq 1 ] || usage; call "$TO/api/sync/feedback?view=$1" ;;
  read) [ $# -eq 2 ] || usage; call "$TO/api/sync/feedback?ids=$(enc "$2")" ;;
  file) [ $# -eq 4 ] || usage; call -f -o "$4" "$TO/api/sync/feedback?id=$(enc "$2")&file=$(enc "$3")" && echo "[cloud-feedback] saved $4" ;;
  status)
    [ $# -ge 3 ] && [ $# -le 4 ] || usage
    body="$(node -e 'const [id, status, note] = process.argv.slice(1); process.stdout.write(JSON.stringify(note ? { id, status, note } : { id, status }))' "$2" "$3" "${4:-}")"
    printf '%s' "$body" | call -H 'Content-Type: application/json' --data-binary @- "$TO/api/sync/feedback" ;;
  *) usage ;;
esac
echo
