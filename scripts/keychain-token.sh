#!/usr/bin/env bash
# Ask for a token in a Mac popup and keep it in the Keychain, so nobody types a `security` command
# (Juan, 7 Oct 2026: "can you trigger getting the key from me with a tool? dont want to run that cmd myself").
#
#   bash scripts/keychain-token.sh [push-token|snapshot-token]      default push-token
#
# The popup hides what is typed. The token goes from the popup to `security -i` on its standard input, so it
# is never printed, never on a command line and never in a file. Only a well-formed Capital OS token is kept
# (plcos_mcp_…), as Keychain item plcos-railway / <item>, which scripts/cloud-*.sh read.
set -euo pipefail
die() { printf '[keychain-token] STOPPED: %s\n' "$*" >&2; exit 1; }
item="${1:-push-token}"
case "$item" in push-token|snapshot-token) ;; *) die "the item is push-token or snapshot-token" ;; esac
command -v osascript >/dev/null 2>&1 && command -v security >/dev/null 2>&1 || die "this runs on the Mac"

token="$(osascript <<APPLESCRIPT 2>/dev/null || true
set r to display dialog "Paste the Capital OS token (Preferences → MCP access). It goes straight into the Keychain as plcos-railway / $item; nothing else sees it." default answer "" with hidden answer with title "Capital OS token" buttons {"Cancel", "Save"} default button "Save"
return text returned of r
APPLESCRIPT
)"
token="$(printf '%s' "$token" | tr -d '[:space:]')"
[ -n "$token" ] || die "nothing saved: the popup was cancelled or left empty"
[[ "$token" =~ ^plcos_mcp_[A-Za-z0-9_-]{30,80}$ ]] || die "nothing saved: that is not a Capital OS token (they begin plcos_mcp_)"
printf 'add-generic-password -U -s plcos-railway -a %s -w "%s"\n' "$item" "$token" | security -i >/dev/null || die "the Keychain did not take it"
unset token
security find-generic-password -s plcos-railway -a "$item" >/dev/null 2>&1 || die "the Keychain item is not there after saving"
printf '[keychain-token] saved plcos-railway / %s\n' "$item"
