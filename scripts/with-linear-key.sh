#!/usr/bin/env bash
# Run a command with the Linear API key taken from the macOS Keychain (docs/24-linear.md).
#
#   scripts/with-linear-key.sh <command…>
#
# One Keychain item holds it: service "plcos-linear", account "api-key" (npm run linear:store). It is
# stored with no app trusted to read it, so a read asks first; "Always Allow" stops the asking for
# that one item. The key goes from the Keychain into this process's environment and from there into
# the command's: never written to a file, never echoed, never on a command line. Without it the
# command still runs, and Developer → Linear says why nothing syncs. Only lib/connectors/linear/ reads it.
set -euo pipefail

SERVICE="plcos-linear"
ACCOUNT="api-key"

if ! command -v security >/dev/null 2>&1; then
  echo "[linear] No macOS Keychain on this machine. Starting without a Linear key." >&2
  exec "$@"
fi

status=0
key="$(security find-generic-password -s "$SERVICE" -a "$ACCOUNT" -w 2>/dev/null)" || status=$?

if [ "$status" -eq 44 ]; then
  echo "[linear] No Linear key in the Keychain yet. Store it once with: npm run linear:store" >&2
  echo "[linear] Starting without a Linear key." >&2
  exec "$@"
fi
if [ "$status" -ne 0 ] || [ -z "$key" ]; then
  echo "[linear] The Keychain did not hand over the key (exit $status). Starting without a Linear key." >&2
  exec "$@"
fi

echo "[linear] Key read from the macOS Keychain. Held by the server process only." >&2
LINEAR_API_KEY="$key" exec "$@"
