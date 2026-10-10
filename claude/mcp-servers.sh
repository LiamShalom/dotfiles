#!/usr/bin/env bash
#
# mcp-servers.sh — register the remote (HTTP) MCP servers with Claude Code at
# user scope, so they work in every repo. Each one asks for an OAuth login the
# first time you use it (run /mcp in Claude Code to sign in).
#
# chrome-devtools is also added here, as a local server that drives the one
# shared agent Chrome (bin/chrome-devtools-mcp.sh). settings.json switches off
# the monorepo .mcp.json entry of the same name. The other local servers
# (sideshift-firestore, the Postgres read replica) ship in that .mcp.json.
#
# Re-running is safe: servers that already exist are skipped.
#
# Usage:  ./claude/mcp-servers.sh
set -euo pipefail

# Format: <name> <url>
SERVERS=(
	"linear https://mcp.linear.app/mcp"
	"Jam https://mcp.jam.dev/mcp"
	"posthog https://mcp.posthog.com/mcp"
	"figma https://mcp.figma.com/mcp"
	"vercel https://mcp.vercel.com"
	"notion https://mcp.notion.com/mcp"
	"intercom https://mcp.intercom.com/mcp"
	"internal-dashboard https://sideshift-internal-dashboard-lnab.vercel.app/mcp"
	"context7 https://mcp.context7.com/mcp/oauth"
)

add() {
	local name="$1"
	shift
	if claude mcp get "$name" >/dev/null 2>&1; then
		echo "ok       $name (already added)"
		return
	fi
	claude mcp add --scope user --transport http "$name" "$@" >/dev/null
	echo "added    $name"
}

for entry in "${SERVERS[@]}"; do
	add "${entry%% *}" "${entry#* }"
done

if claude mcp get chrome-devtools 2>/dev/null | grep -q "User config"; then
	echo "ok       chrome-devtools (already added)"
else
	claude mcp add --scope user chrome-devtools -- "$HOME/.claude/bin/chrome-devtools-mcp.sh" >/dev/null
	echo "added    chrome-devtools (shared agent Chrome)"
fi

echo
echo "Next: open Claude Code, run /mcp, and sign in to each server."
