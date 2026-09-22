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

key=""
# An API Credential item keeps it in "credential"; a Password item in "password".
for field in credential password; do
  value="$(op item get "$ITEM" --fields "label=$field" --reveal 2>/dev/null || true)"
  # Older CLIs print a placeholder for a concealed field instead of failing.
  if [ -n "$value" ] && [ "${value#\[use }" = "$value" ]; then
    key="$value"
    break
  fi
done
unset value

if [ -z "$key" ]; then
  echo "[affinity] Could not read \"$ITEM\" from 1Password. Starting without an Affinity key." >&2
  exec "$@"
fi

echo "[affinity] Key read from 1Password. Held by the server process only." >&2
AFFINITY_API_KEY="$key" exec "$@"
