#!/bin/bash
#
# chrome-devtools-mcp.sh — the chrome-devtools MCP server, attached to the
# shared agent Chrome (agent-chrome.sh) instead of launching a browser per
# session. Registered at user scope by claude/mcp-servers.sh; the project
# .mcp.json entry of the same name is switched off in settings.json
# (disabledMcpjsonServers).
#
# If the shared browser cannot start, the server launches its own browser as
# it did before, so the tools keep working either way. Both paths go through
# chrome-devtools-mcp-proxy.mjs, which opens new tabs in the background.
set -uo pipefail

VERSION="${CHROME_DEVTOOLS_MCP_VERSION:-1.9.0}"
PROXY="$HOME/.claude/bin/chrome-devtools-mcp-proxy.mjs"

if url=$("$HOME/.claude/bin/agent-chrome.sh" 2>/dev/null); then
	exec node "$PROXY" npx -y "chrome-devtools-mcp@$VERSION" --browserUrl "$url" "$@"
fi
exec node "$PROXY" npx -y "chrome-devtools-mcp@$VERSION" "$@"
