#!/bin/bash
#
# heavy-gate.sh — PreToolUse hook on Bash for Claude Code and Codex. Caps
# Vitest workers and queues heavy jobs (see heavy-classify.mjs and bin/heavy).
# Commands that are not heavy pass through untouched.
#
# Claude Code replaces the whole tool input with updatedInput, so every
# original field is copied and only `command` changes. Codex applies a
# rewrite only together with an "allow" decision: pass --codex.
#
# Usage (settings): bash ~/.claude/hooks/heavy-gate.sh [--codex]
input=$(cat)
cmd=$(jq -r '.tool_input.command | if type == "string" then . else empty end' <<<"$input" 2>/dev/null)
[ -n "$cmd" ] || exit 0

# Cheap filter first: almost every command never names a heavy tool.
case "$cmd" in
	*vitest* | *npm\ test* | *npm\ t\ * | *"npm run"* | *pnpm* | *yarn* | *next\ build* | *tsc* | *eslint*) ;;
	*) exit 0 ;;
esac

cwd=$(jq -r '.cwd // empty' <<<"$input")
new=$(node "$HOME/.claude/hooks/heavy-classify.mjs" "$cmd" "${cwd:-$PWD}" 2>/dev/null) || exit 0
[ -n "$new" ] || exit 0

log="/tmp/agent-heavy-$(id -u)/hook.log"
mkdir -p "$(dirname "$log")"
printf '%s %s\n  before: %s\n  after:  %s\n' "$(date '+%F %T')" "${1:-claude}" "$cmd" "$new" >>"$log"

if [ "${1:-}" = "--codex" ]; then
	jq -c --arg c "$new" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "allow",
		updatedInput: (.tool_input + {command: $c})}}' <<<"$input"
else
	jq -c --arg c "$new" '{hookSpecificOutput: {hookEventName: "PreToolUse",
		updatedInput: (.tool_input + {command: $c})}}' <<<"$input"
fi
