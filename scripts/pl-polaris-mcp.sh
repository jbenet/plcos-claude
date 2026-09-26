#!/usr/bin/env bash
# Registers PL Polaris, the PL Data Warehouse (Google's hosted BigQuery MCP server), with Claude Code
# and with ChatGPT's Codex, using the OAuth client stored by `npm run secret:store`. Juan runs it:
# each Keychain read asks him, and neither value is printed or written to a file by this script.
# Read-only use only (AGENTS.md, "PL Polaris").
set -euo pipefail
URL="https://bigquery.googleapis.com/mcp"
NAME="pl-polaris"
SERVICE="plcos-claude"
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
# Google requires a scope. Read-only by default, so Google itself refuses writes; if queries are refused
# for want of scope, run again with POLARIS_SCOPE=https://www.googleapis.com/auth/bigquery.
SCOPE="${POLARIS_SCOPE:-https://www.googleapis.com/auth/bigquery.readonly}"

id=$(security find-generic-password -s "$SERVICE" -a pl-polaris-client-id -w)
secret=$(security find-generic-password -s "$SERVICE" -a pl-polaris-client-secret -w)

# Claude Code, user scope, so every Claude folder and its sub-agents see it. Claude keeps the secret.
claude mcp remove --scope user "$NAME" >/dev/null 2>&1 || true
MCP_CLIENT_SECRET="$secret" claude mcp add-json --scope user --client-secret "$NAME" \
  "{\"type\":\"http\",\"url\":\"$URL\",\"oauth\":{\"clientId\":\"$id\",\"scopes\":\"$SCOPE\"}}"

# ChatGPT's Codex takes the client ID only, and the scope at login; Google may also want the secret there.
"$CODEX" mcp remove "$NAME" >/dev/null 2>&1 || true
"$CODEX" mcp add "$NAME" --url "$URL" --oauth-client-id "$id"
unset id secret

cat <<NEXT >&2

Registered $NAME with Claude Code and with Codex. Sign in with Google once in each:
  Claude:  in a terminal, run claude, then /mcp, choose $NAME and authenticate.
  ChatGPT: $CODEX mcp login $NAME --scopes $SCOPE
NEXT
