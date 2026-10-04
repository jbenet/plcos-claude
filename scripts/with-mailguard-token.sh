#!/usr/bin/env bash
# Run a command with the mailguard token and address for email drafts taken from the macOS Keychain
# (docs/25-email-drafts.md §12).
#
#   scripts/with-mailguard-token.sh <command…>
#
# Keychain items, stored once with npm run secret:store (service "plcos-claude"):
#   mailguard-token  Juan's mailguard key (mg_…), for the handle in config.email.mailguard.keychainTokenFor
#   mailguard-url    mailguard's address, e.g. https://mail.example.com (optional: config.email.mailguard.url)
# Each read asks first unless "Always Allow" was chosen. The values go from the Keychain into this
# process's environment and the command's: never a file, never echoed, never a command line. Without
# them the command still runs and Preferences → Email says why drafting is off. Only
# lib/connectors/mailguard/ reads them, and it refuses a token that can send.
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

token="$(read_item MAILGUARD_TOKEN mailguard-token)"
url="$(read_item MAILGUARD_URL mailguard-url)"
if [ -z "$token" ]; then
  # Not set up yet (docs/25 §12.5): start without, quietly. People can still paste their own in Preferences.
  if [ -n "$url" ]; then MAILGUARD_URL="$url" exec "$@"; fi
  exec "$@"
fi
[ -n "${MAILGUARD_TOKEN:-}" ] || echo "[mailguard] Token read from the macOS Keychain. Held by the server process only; checked for drafts-only at start." >&2
if [ -n "$url" ]; then MAILGUARD_TOKEN="$token" MAILGUARD_URL="$url" exec "$@"; fi
MAILGUARD_TOKEN="$token" exec "$@"
