#!/bin/bash
#
# mcp-shared-auth.sh — the headersHelper of the shared MCP servers (mcp-http-bridge.mjs). Claude Code
# runs it each time a session connects to one, with the server's name in CLAUDE_CODE_MCP_SERVER_NAME.
# A session in the monorepo (its main checkout or one of its registered git worktrees) whose .mcp.json
# defines that server gets the bridge's token; any other session gets none, and the bridge shows it a
# server with no tools. A .mcp.json alone is not enough: any folder, such as a cloned repo, can carry
# one that names these servers.
#
# Claude Code runs the helper of a user-config server in ~/.claude, so the session's folder is the
# working folder of the helper's parent, the session's own process.
REPO="${SIDESHIFT_REPO:-$HOME/sideshift-monorepo}"
out=$(lsof -a -p "$PPID" -d cwd -Fn 2>/dev/null)
case $out in
*$'\n'n/*) session=${out##*$'\n'n} ;;
*) session= ;;
esac
token=
if [ -n "$session" ] && [ -n "${CLAUDE_CODE_MCP_SERVER_NAME:-}" ]; then
	paths=$(git -C "$session" rev-parse --path-format=absolute --git-common-dir --show-toplevel 2>/dev/null)
	common=${paths%%$'\n'*}
	top=${paths#*$'\n'}
	worktrees=$'\n'$(git -C "$REPO" worktree list --porcelain 2>/dev/null)$'\n'
	if [ "$common" = "$REPO/.git" ] && [[ $worktrees == *$'\n'"worktree $top"$'\n'* ]] &&
		jq -e --arg name "$CLAUDE_CODE_MCP_SERVER_NAME" '.mcpServers[$name]' "$top/.mcp.json" >/dev/null 2>&1; then
		read -r token <"$HOME/.config/mcp-shared/token" # read fails at a last line with no newline, yet sets token
	fi
fi
if [ -n "$token" ]; then
	printf '{"Authorization":"Bearer %s"}\n' "$token"
else
	echo '{}'
fi
