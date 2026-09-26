#!/usr/bin/env bash
# Registers PL Polaris, the PL Data Warehouse (BigQuery project plrs-data-platform), with Claude Code and
# with ChatGPT's Codex through Google's MCP Toolbox for Databases, run locally over stdio. It signs in with
# Juan's Google Cloud application-default credentials (`gcloud auth application-default login`), so no
# OAuth client is involved. Read-only is enforced by the Toolbox (write mode blocked), and every query is
# capped in bytes billed. See AGENTS.md, "PL Polaris".
set -euo pipefail
NAME="pl-polaris"
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
TOOLBOX="@toolbox-sdk/server@1.13.1"   # pinned: a new version is a reviewed change, not a silent download
PROJECT="${POLARIS_PROJECT:-plrs-data-platform}"
MAX_BYTES="${POLARIS_MAX_BYTES:-10737418240}"   # 10 GB billed per query; a GUESS at a safe ceiling

command -v gcloud >/dev/null || { echo "Install the Google Cloud CLI first: brew install --cask google-cloud-sdk" >&2; exit 1; }
[ -f "$HOME/.config/gcloud/application_default_credentials.json" ] \
  || { echo "Sign in first: gcloud auth application-default login" >&2; exit 1; }

ENV=(BIGQUERY_PROJECT="$PROJECT" BIGQUERY_WRITE_MODE=blocked BIGQUERY_MAXIMUM_BYTES_BILLED="$MAX_BYTES" BIGQUERY_MAX_QUERY_RESULT_ROWS=200)

claude mcp remove --scope user "$NAME" >/dev/null 2>&1 || true
claude_env=(); for e in "${ENV[@]}"; do claude_env+=(-e "$e"); done
claude mcp add --scope user "$NAME" "${claude_env[@]}" -- npx -y "$TOOLBOX" --prebuilt bigquery --stdio

"$CODEX" mcp remove "$NAME" >/dev/null 2>&1 || true
codex_env=(); for e in "${ENV[@]}"; do codex_env+=(--env "$e"); done
"$CODEX" mcp add "$NAME" "${codex_env[@]}" -- npx -y "$TOOLBOX" --prebuilt bigquery --stdio

echo "Registered $NAME (project $PROJECT, writes blocked, $MAX_BYTES bytes billed per query at most) with Claude Code and Codex." >&2
echo "New sessions of each will see it; nothing else to sign in to." >&2
