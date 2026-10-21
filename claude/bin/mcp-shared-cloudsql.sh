#!/bin/bash
#
# mcp-shared-cloudsql.sh — starts the Postgres read-replica MCP server (MCP Toolbox) the way the
# monorepo's .mcp.json entry does: its tool file and instance settings, signed in with your own gcloud
# login. mcp-http-bridge.mjs runs it for every Claude Code session (launchd/com.sideshift.mcp-cloudsql.plist),
# a few copies at most, because toolbox answers one stdio call at a time.
set -euo pipefail

ROOT="${SIDESHIFT_REPO:-$HOME/sideshift-monorepo}"

while IFS='=' read -r key value; do
	export "$key=$value"
done < <(jq -r '.mcpServers["cloud-sql-postgres-read-replica"].env | to_entries[] | "\(.key)=\(.value)"' "$ROOT/.mcp.json")
unset GOOGLE_APPLICATION_CREDENTIALS

# In stdio mode toolbox serves no HTTP; the two --allowed flags only stop its start-up warning that
# its (unused) HTTP server would accept any site.
exec toolbox --config "$ROOT/mcp/cloud-sql-postgres/read-replica.tools.yaml" --disable-reload --stdio \
	--log-level warn --disable-version-check --allowed-hosts localhost,127.0.0.1 --allowed-origins http://127.0.0.1
