#!/usr/bin/env bash
# Linear API key, held in the macOS Keychain (Juan, 27 Sep 2026: "grab the API key, keychain style").
#
#   npm run linear:store    asks for the key (hidden) and stores it
#   npm run linear:status   says whether it is stored, without reading it
#   npm run linear:forget   deletes it
#
# One item, service "plcos-linear", account "api-key", stored with no app trusted to read it (-T ""),
# so a read asks first; "Always Allow" stops the prompts for this item. Nothing is echoed, written to
# a file or put on a command line. Only lib/connectors/linear/ reads it. Read-only until Juan approves
# writes (docs/24-linear.md).
set -euo pipefail

SERVICE="plcos-linear"

case "${1:-status}" in
  store)
    echo "Paste the Linear personal API key and press Enter. Nothing shows as you type." >&2
    # -w last with no value: the Keychain prompts for it itself, so it never passes through this script.
    security add-generic-password -s "$SERVICE" -a "api-key" -l "PLC Raise Tools — Linear API key" \
      -j "Read by lib/connectors/linear (docs/24-linear.md). Read-only use until approved." -T "" -U -w
    echo "Stored as $SERVICE / api-key in the login keychain. The first read asks; Always Allow stops that." >&2
    ;;
  status)
    if security find-generic-password -s "$SERVICE" -a "api-key" >/dev/null 2>&1; then
      echo "Linear key: stored ($SERVICE / api-key)."
    else
      echo "Linear key: not stored. Run: npm run linear:store"
    fi
    ;;
  forget)
    security delete-generic-password -s "$SERVICE" -a "api-key" >/dev/null 2>&1 && echo "Deleted." || echo "Nothing stored."
    ;;
  *) echo "usage: linear-key.sh store|status|forget" >&2; exit 2 ;;
esac
