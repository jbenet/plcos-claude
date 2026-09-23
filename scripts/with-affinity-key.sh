#!/usr/bin/env bash
# Run a command with AFFINITY_API_KEY taken from the macOS Keychain (docs/15).
#
#   scripts/with-affinity-key.sh <command…>
#
# One Keychain item holds the key: service "plcos-claude", account "affinity-api-key". It is
# stored with no app trusted to read it (`-T ""`), so every read asks you first — for that one
# item, not for a vault. `npm run key:store` creates it; `npm run key:status` says whether it
# is there without reading it.
#
# The key goes from the Keychain into this process's environment, and from there into the
# command's. It is never written to a file, never echoed, and never put on a command line
# where `ps` would show it. Without it the command still runs, without a key, and
# Developer → Affinity says why.
set -euo pipefail

SERVICE="plcos-claude"
ACCOUNT="affinity-api-key"

if ! command -v security >/dev/null 2>&1; then
  echo "[affinity] No macOS Keychain on this machine. Starting without an Affinity key." >&2
  exec "$@"
fi

errors="$(mktemp)"
status=0
# Only the Keychain's error messages go to the file. The key itself only arrives on stdout.
key="$(security find-generic-password -s "$SERVICE" -a "$ACCOUNT" -w 2>"$errors")" || status=$?
why="$(head -1 "$errors")"
rm -f "$errors"

if [ "$status" -eq 44 ]; then
  echo "[affinity] No Affinity key in the Keychain yet. Store it once with: npm run key:store" >&2
  echo "[affinity] Starting without an Affinity key." >&2
  exec "$@"
fi
if [ "$status" -ne 0 ] || [ -z "$key" ]; then
  echo "[affinity] The Keychain did not hand over the key (${why:-exit $status})." >&2
  echo "[affinity] Starting without an Affinity key." >&2
  exec "$@"
fi

echo "[affinity] Key read from the macOS Keychain. Held by the server process only." >&2
AFFINITY_API_KEY="$key" exec "$@"
