#!/usr/bin/env bash
# Run a command with DAKOTA_USERNAME and DAKOTA_PASSWORD from the macOS Keychain (docs/20-dakota.md).
# Each read asks Juan. Values go into this process's environment only: never echoed, never in a file.
set -euo pipefail
SERVICE="plcos-dakota"
user="$(security find-generic-password -s "$SERVICE" -a username -w 2>/dev/null)" || { echo "[dakota] username not stored or not handed over (npm run dakota:store)" >&2; exit 1; }
pass="$(security find-generic-password -s "$SERVICE" -a password -w 2>/dev/null)" || { echo "[dakota] password not stored or not handed over (npm run dakota:store)" >&2; exit 1; }
DAKOTA_USERNAME="$user" DAKOTA_PASSWORD="$pass" exec "$@"
