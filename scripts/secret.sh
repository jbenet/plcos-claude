#!/usr/bin/env bash
# Named secrets in the login Keychain, one item each, like the Affinity key (docs/15).
#
#   npm run secret:store -- <name>    asks for the value, hidden as you type, and stores it
#   npm run secret:status -- <name>   says whether it is stored, without reading it
#   npm run secret:forget -- <name>   deletes it
#
# Items are trusted to no app (-T ""), so every read asks Juan. Local development only.
set -euo pipefail
SERVICE="plcos-claude"
cmd="${1:-}"; name="${2:-}"
usage() { echo "Usage: scripts/secret.sh store|status|forget <name>, the name in lowercase letters, digits and dashes." >&2; exit 2; }
[[ "$name" =~ ^[a-z0-9][a-z0-9-]*$ ]] || usage
[ "$name" != "affinity-api-key" ] || { echo "The Affinity key has its own commands: npm run key:store" >&2; exit 2; }
case "$cmd" in
  store)
    echo "Paste the value for $name and press Enter. Nothing shows as you type." >&2
    # -w goes last, with no value, so the Keychain asks for it: it never passes through this script.
    security add-generic-password -s "$SERVICE" -a "$name" -l "PLC Raise Tools — $name" -T "" -U -w
    echo "Stored as $SERVICE / $name in the login keychain." >&2 ;;
  status)
    if security find-generic-password -s "$SERVICE" -a "$name" >/dev/null 2>&1; then echo "Stored as $SERVICE / $name."
    else echo "Not stored. Run: npm run secret:store -- $name"; fi ;;
  forget)
    security delete-generic-password -s "$SERVICE" -a "$name" >/dev/null && echo "Deleted $SERVICE / $name." ;;
  *) usage ;;
esac
