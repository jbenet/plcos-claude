#!/usr/bin/env bash
# Add a vehicle to the cloud app by token (lib/sync/vehicles.ts; docs/deploy/railway.md §7), the same checks
# and audit as Settings → Vehicles. The file is one vehicle:
#
#   { "name": "SPV - Example", "slug": "spv-example", "kind": "spv", "exemption": "506(c)", "phase": "active",
#     "target": null, "opens": null, "closes": null, "aliases": ["Example"] }
#
#   bash scripts/cloud-vehicle.sh [--to <app url>] <vehicle.json>
#
# The token needs the sync:admin scope, which only an Admin holds (Preferences → MCP access → "Admin").
# A taken slug or name is refused, never updated.
#
# Secrets, never printed and never on a command line, as for scripts/cloud-push.sh:
#   the token     Keychain item plcos-railway / push-token (CLOUD_PUSH_TOKEN for tests).
#   the app URL   --to, else CLOUD_APP_URL, else Keychain item plcos-railway / app-url.
set -euo pipefail
die() { printf '[cloud-vehicle] STOPPED: %s\n' "$*" >&2; exit 1; }
keychain() { command -v security >/dev/null 2>&1 && security find-generic-password -s plcos-railway -a "$1" -w 2>/dev/null; }
usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0" >&2; exit 2; }

TO=""
[ "${1:-}" = "--to" ] && { TO="${2:-}"; shift 2; }
[ $# -eq 1 ] && [ -f "$1" ] || usage
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
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$1" 2>/dev/null || die "the file is not JSON"

set +e
answer="$(curl -sS --proto "$proto" --connect-timeout 20 --max-time 60 \
  -K <(printf 'header = "Authorization: Bearer %s"\nheader = "Content-Type: application/json"\n' "$token") \
  --data-binary @"$1" -w '\n%{http_code}' "$TO/api/sync/vehicles")"
rc=$?
set -e
[ "$rc" = 0 ] || die "the call did not complete (curl exit $rc)"
code="${answer##*$'\n'}"; reply="${answer%$'\n'*}"
printf '%s' "$reply" | node -e '
const code = Number(process.argv[1]);
let a; try { a = JSON.parse(require("fs").readFileSync(0, "utf8")); } catch { console.error(`[cloud-vehicle] the server answered ${code} with no readable reason`); process.exit(1); }
if (!a.ok) { console.error(`[cloud-vehicle] REFUSED (${code}): ${a.error || "no reason given"}`); process.exit(1); }
console.log(`[cloud-vehicle] added ${a.slug} (${a.name})`);
' "$code"
