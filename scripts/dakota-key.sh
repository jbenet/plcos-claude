#!/usr/bin/env bash
# Dakota Marketplace sign-in, held in the macOS Keychain (docs/20-dakota.md).
#
#   npm run dakota:store    asks for the username, then the password (hidden), and stores both
#   npm run dakota:status   says whether they are stored, without reading them
#   npm run dakota:forget   deletes them
#
# Two items, service "plcos-dakota", accounts "username" and "password", stored with no app
# trusted to read them (-T ""), so every read asks Juan first. Nothing is echoed, written to a
# file or put on a command line. Only a workflow reads them, through lib/connectors/dakota/.
# Dakota is read-only for us, and its data stays in plcos-data/real and our database.
set -euo pipefail

SERVICE="plcos-dakota"

case "${1:-status}" in
  store)
    printf "Dakota username (usually your email) and Enter: " >&2
    IFS= read -r user
    [ -n "$user" ] || { echo "No username given; nothing stored." >&2; exit 1; }
    # The username is not secret, but it is kept with the password so a workflow finds both in one place.
    security add-generic-password -s "$SERVICE" -a "username" -l "PLC Raise Tools — Dakota username" \
      -j "Read by the Dakota workflow (docs/20-dakota.md)." -T "" -U -w "$user"
    unset user
    echo "Now the Dakota password and Enter. Nothing shows as you type." >&2
    # -w last with no value: the Keychain prompts for it itself, so it never passes through this script.
    security add-generic-password -s "$SERVICE" -a "password" -l "PLC Raise Tools — Dakota password" \
      -j "Read by the Dakota workflow (docs/20-dakota.md)." -T "" -U -w
    echo "Stored as $SERVICE / username and $SERVICE / password in the login keychain." >&2
    echo "Each Dakota workflow run asks to read them. Allow keeps it asking; Always Allow stops it for these items." >&2
    ;;
  status)
    for a in username password; do
      if security find-generic-password -s "$SERVICE" -a "$a" >/dev/null 2>&1; then echo "$a: stored"; else echo "$a: not stored (run npm run dakota:store)"; fi
    done
    ;;
  forget)
    for a in username password; do security delete-generic-password -s "$SERVICE" -a "$a" >/dev/null 2>&1 && echo "Deleted $SERVICE / $a."; done
    ;;
  *)
    echo "usage: scripts/dakota-key.sh store|status|forget" >&2
    exit 2
    ;;
esac
