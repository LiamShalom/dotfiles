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
#
# Every session runs its own copy of this server, so its footprint is paid
# per session: the pinned version is installed once and run directly (an
# `npx` wrapper process costs ~200 MB per session), and usage statistics are
# off (they add a ~50 MB watchdog process per session).
set -uo pipefail

VERSION="${CHROME_DEVTOOLS_MCP_VERSION:-1.9.0}"
PROXY="$HOME/.claude/bin/chrome-devtools-mcp-proxy.mjs"
PKG="$HOME/.cache/agent-chrome/chrome-devtools-mcp-$VERSION"
BIN="$PKG/node_modules/.bin/chrome-devtools-mcp"

if [ ! -x "$BIN" ]; then
	# Sessions often start together; only one of them installs.
	mkdir -p "$(dirname "$PKG")"
	for _ in $(seq 1 150); do
		mkdir "$PKG.lock" 2>/dev/null && break
		sleep 0.2
	done
	[ -x "$BIN" ] || npm install --prefix "$PKG" --no-audit --no-fund --loglevel=error \
		"chrome-devtools-mcp@$VERSION" >&2
	rmdir "$PKG.lock" 2>/dev/null
fi

if [ -x "$BIN" ]; then
	server=("$BIN")
else
	server=(npx -y "chrome-devtools-mcp@$VERSION")
fi

if url=$("$HOME/.claude/bin/agent-chrome.sh" 2>/dev/null); then
	exec node "$PROXY" "${server[@]}" --no-usage-statistics --browserUrl "$url" "$@"
fi
exec node "$PROXY" "${server[@]}" --no-usage-statistics "$@"
