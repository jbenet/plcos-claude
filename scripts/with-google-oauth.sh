#!/usr/bin/env bash
# Run a command with the Google OAuth client for Gmail drafts taken from the macOS Keychain
# (docs/25-email-drafts.md, Setup).
#
#   scripts/with-google-oauth.sh <command…>
#
# Two Keychain items, stored once with npm run secret:store (service "plcos-claude"):
#   google-oauth-client-id      the client's id (not secret, kept beside its secret)
#   google-oauth-client-secret  the client's secret
# Each read asks first unless "Always Allow" was chosen. The values go from the Keychain into this
# process's environment and the command's: never a file, never echoed, never a command line. Without
# them the command still runs and Preferences says Gmail drafts are off. Only lib/connectors/gmail/
# reads them, and only when config.email.gmail.enabled is true.
set -euo pipefail
source "$(dirname "$0")/env-or-command.sh"

SERVICE="plcos-claude"

if ! command -v security >/dev/null 2>&1; then
  exec "$@"
fi

read_item() {
  local status=0 value
  value="$(env_or_command "$1" security find-generic-password -s "$SERVICE" -a "$2" -w 2>/dev/null)" || status=$?
  [ "$status" -eq 0 ] && printf '%s' "$value"
  return 0
}

id="$(read_item GOOGLE_OAUTH_CLIENT_ID google-oauth-client-id)"
if [ -z "$id" ]; then
  # Not set up yet (docs/25): start without, quietly.
  exec "$@"
fi
secret="$(read_item GOOGLE_OAUTH_CLIENT_SECRET google-oauth-client-secret)"
if [ -z "$secret" ]; then
  echo "[gmail] The OAuth client id is stored but its secret is not: npm run secret:store -- google-oauth-client-secret. Starting without Gmail drafts." >&2
  exec "$@"
fi
[ -n "${GOOGLE_OAUTH_CLIENT_SECRET:-}" ] || echo "[gmail] OAuth client read from the macOS Keychain. Held by the server process only." >&2
GOOGLE_OAUTH_CLIENT_ID="$id" GOOGLE_OAUTH_CLIENT_SECRET="$secret" exec "$@"
