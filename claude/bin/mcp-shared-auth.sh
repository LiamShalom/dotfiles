#!/bin/bash
#
# mcp-shared-auth.sh — the headersHelper of the shared MCP servers (mcp-http-bridge.mjs). Claude Code
# runs it each time a session connects to one, with the server's name in CLAUDE_CODE_MCP_SERVER_NAME.
# A session whose project's .mcp.json defines that server (the monorepo and its worktrees) gets the
# bridge's token; any other session gets none, and the bridge shows it a server with no tools. So the
# shared servers reach the sessions that ran their own copy before, and nothing else on this Mac can
# use them.
#
# Claude Code runs the helper of a user-config server in ~/.claude, so the session's folder is the
# working folder of the helper's parent, the session's own process.
out=$(lsof -a -p "$PPID" -d cwd -Fn 2>/dev/null)
case $out in
*$'\n'n/*) dir=${out##*$'\n'n} ;;
*) dir= ;;
esac
while [ -n "$dir" ] && [ ! -f "$dir/.mcp.json" ]; do dir=${dir%/*}; done
token=
if [ -n "$dir" ] && [ -n "${CLAUDE_CODE_MCP_SERVER_NAME:-}" ] &&
	jq -e --arg name "$CLAUDE_CODE_MCP_SERVER_NAME" '.mcpServers[$name]' "$dir/.mcp.json" >/dev/null 2>&1; then
	read -r token <"$HOME/.config/mcp-shared/token" # read fails at a last line with no newline, yet sets token
fi
if [ -n "$token" ]; then
	printf '{"Authorization":"Bearer %s"}\n' "$token"
else
	echo '{}'
fi
