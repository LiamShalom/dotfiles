#!/bin/bash
#
# mcp-shared-cloudsql.sh — one Postgres read-replica MCP server (MCP Toolbox) for every Claude Code
# session, on http://127.0.0.1:47801/mcp, instead of a copy per monorepo session (~80 MB each).
# launchd keeps it running (launchd/com.sideshift.mcp-cloudsql.plist). mcp-servers.sh registers it
# at user scope under the name the monorepo's .mcp.json gives it, and settings.json switches that
# .mcp.json entry off.
#
# It runs what that entry runs: the repo's tool file and instance settings, signed in with your own
# gcloud login. Toolbox serves HTTP itself: in stdio mode it answers one call at a time, so one slow
# query would hold up every session. It reloads the tool file when the file changes; the instance
# settings are read at start (launchctl kickstart -k gui/$(id -u)/com.sideshift.mcp-cloudsql).
#
# Web pages cannot use it: toolbox refuses a Host other than localhost or 127.0.0.1 (DNS rebinding)
# and a body that is not JSON, and gives no other origin a CORS grant.
set -euo pipefail

ROOT="${SIDESHIFT_REPO:-$HOME/sideshift-monorepo}"
PORT="${MCP_CLOUDSQL_PORT:-47801}"

while IFS='=' read -r key value; do
	export "$key=$value"
done < <(jq -r '.mcpServers["cloud-sql-postgres-read-replica"].env | to_entries[] | "\(.key)=\(.value)"' "$ROOT/.mcp.json")
unset GOOGLE_APPLICATION_CREDENTIALS

exec toolbox --config "$ROOT/mcp/cloud-sql-postgres/read-replica.tools.yaml" \
	--address 127.0.0.1 --port "$PORT" \
	--allowed-hosts localhost,127.0.0.1 --allowed-origins http://127.0.0.1 \
	--log-level warn
