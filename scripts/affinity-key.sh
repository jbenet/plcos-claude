#!/usr/bin/env bash
# The Affinity key's one Keychain item (docs/15).
#
#   npm run key:store    asks for the key, hidden as you type, and stores it (replacing any old one)
#   npm run key:status   says whether it is stored, without reading it
#   npm run key:forget   deletes it
#
# Local development only. A deployment gets its own secret store when there is one.
set -euo pipefail

SERVICE="plcos-claude"
ACCOUNT="affinity-api-key"
LABEL="PLC Raise Tools — Affinity API key"

case "${1:-status}" in
  store)
    echo "Paste the Affinity API key and press Enter. Nothing shows as you type." >&2
    # -w goes last, with no value, so the Keychain asks for the key itself: it never passes
    # through this script, the shell's history or ps. -T "" trusts no app to read it, so
    # every read asks you first.
    security add-generic-password -s "$SERVICE" -a "$ACCOUNT" -l "$LABEL" \
      -j "Read by scripts/with-affinity-key.sh when npm run dev:real starts." -T "" -U -w
    echo "Stored as $SERVICE / $ACCOUNT in the login keychain." >&2
    echo "Each start of npm run dev:real asks to read it. Allow keeps it asking; Always Allow stops the asking for this one item." >&2
    ;;
  status)
    # Without -w or -g this reads the item's attributes only, which needs no permission.
    if security find-generic-password -s "$SERVICE" -a "$ACCOUNT" >/dev/null 2>&1; then
      echo "Stored as $SERVICE / $ACCOUNT in the login keychain."
    else
      echo "Not stored. Run: npm run key:store"
    fi
    ;;
  forget)
    security delete-generic-password -s "$SERVICE" -a "$ACCOUNT" >/dev/null && echo "Deleted $SERVICE / $ACCOUNT."
    ;;
  *)
    echo "usage: scripts/affinity-key.sh store|status|forget" >&2
    exit 2
    ;;
esac
