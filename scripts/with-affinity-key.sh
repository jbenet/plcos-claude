#!/usr/bin/env bash
# Run a command with AFFINITY_API_KEY taken from 1Password (docs/15).
#
#   scripts/with-affinity-key.sh <command…>
#
# The key goes from 1Password into this process's environment, and from there into the
# command's. It is never written to disk, never echoed, and never put on a command line
# where `ps` would show it.
#
# Without the 1Password CLI, or when 1Password says no, the command still runs, without a
# key, and Developer → Affinity says why. Needs: `brew install 1password-cli`, then in the
# 1Password app, Settings → Developer → "Integrate with 1Password CLI".
set -euo pipefail

ITEM="Affinity API - App: plcos-claude"

if ! command -v op >/dev/null 2>&1; then
  echo "[affinity] The 1Password CLI (op) is not installed. Starting without an Affinity key." >&2
  exec "$@"
fi

# With the app integration on, the CLI sees the app's accounts; without it, it sees none.
if [ -z "$(op account list 2>/dev/null)" ]; then
  echo "[affinity] The 1Password CLI can't see any account. In the 1Password app, turn on" >&2
  echo "[affinity] Settings → Developer → \"Integrate with 1Password CLI\", then restart this." >&2
  echo "[affinity] Starting without an Affinity key." >&2
  exec "$@"
fi

key=""
why=""
errors="$(mktemp)"
# An API Credential item keeps it in "credential"; a Password item in "password".
for field in credential password; do
  # Only op's error messages go to the file. The key itself only ever arrives on stdout.
  value="$(op item get "$ITEM" --fields "label=$field" --reveal 2>"$errors" || true)"
  # Older CLIs print a placeholder for a concealed field instead of failing.
  if [ -n "$value" ] && [ "${value#\[use }" = "$value" ]; then
    key="$value"
    break
  fi
  [ -z "$why" ] && why="$(head -1 "$errors")"
done
rm -f "$errors"
unset value

if [ -z "$key" ]; then
  echo "[affinity] Could not read \"$ITEM\" from 1Password: ${why:-no field named credential or password}." >&2
  echo "[affinity] Starting without an Affinity key." >&2
  exec "$@"
fi

echo "[affinity] Key read from 1Password. Held by the server process only." >&2
AFFINITY_API_KEY="$key" exec "$@"
