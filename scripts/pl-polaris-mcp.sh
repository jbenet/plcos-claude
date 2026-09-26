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

id=$(security find-generic-password -s "$SERVICE" -a pl-polaris-client-id -w)
secret=$(security find-generic-password -s "$SERVICE" -a pl-polaris-client-secret -w)

# Claude Code, user scope, so every Claude folder and its sub-agents see it. Claude keeps the secret.
claude mcp remove --scope user "$NAME" >/dev/null 2>&1 || true
MCP_CLIENT_SECRET="$secret" claude mcp add --scope user --transport http --client-id "$id" --client-secret "$NAME" "$URL"

# ChatGPT's Codex takes the client ID only; its login may ask for more if Google requires the secret.
"$CODEX" mcp remove "$NAME" >/dev/null 2>&1 || true
"$CODEX" mcp add "$NAME" --url "$URL" --oauth-client-id "$id"
unset id secret

cat <<NEXT >&2

Registered $NAME with Claude Code and with Codex. Sign in with Google once in each:
  Claude:  in a terminal, run claude, then /mcp, choose $NAME and authenticate.
  ChatGPT: $CODEX mcp login $NAME
NEXT
