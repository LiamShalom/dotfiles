#!/bin/bash
#
# config-intent-check.sh — PreToolUse hook on Edit/Write/MultiEdit. The first time a session edits
# global agent config (CLAUDE.md, hooks, rules, settings.json), it refuses once and asks for the
# operator's own words. Running the same edit again goes through.
#
# Why: 2026-11-08, asked to "ensure that every session does this full suite before merging", I read
# "this full suite" as the browser-agent harness built earlier in the session and rewrote the global
# rules, a merge gate and hooks around it. He meant "a code review that looks for bugs and gaps in
# the feature and then fixes before merging". Ledger rows 2026-10-27, 2026-11-02, 2026-11-08.
#
# Usage (settings): bash ~/.claude/hooks/config-intent-check.sh
input=$(cat)
case "$input" in
	*CLAUDE.md* | */hooks/* | */rules/* | *settings.json*) ;;
	*) exit 0 ;;
esac
{ IFS= read -r session; IFS= read -r file; } < <(jq -r '(.session_id // "unknown"), (.tool_input.file_path // "")' <<<"$input" 2>/dev/null)
case "$file" in
	"$HOME/.claude/CLAUDE.md" | "$HOME/.claude/settings.json" | "$HOME/.claude/hooks/"* | "$HOME/.claude/rules/"* | \
		"$HOME/dotfiles/claude/CLAUDE.md" | "$HOME/dotfiles/claude/hooks/"* | "$HOME/dotfiles/claude/rules/"*) ;;
	*) exit 0 ;;
esac
state="$HOME/.cache/claude-config-intent"
mark="$state/$session"
[ -e "$mark" ] && exit 0
mkdir -p "$state"
: >"$mark"
reason="You are about to change global agent config, which every later session follows. Before you edit it, in your reply to the operator: quote his own words that ask for this change. If they point at something by reference (\"this\", \"the suite\", \"that check\") and it could mean more than one thing, ask him which before you change any rule, hook or gate. (2026-11-08: \"ensure every session does this full suite\" meant a code review, not the browser-agent harness I wired in.) If his words name exactly this change, make the same edit again."
jq -nc --arg r "$reason" '{hookSpecificOutput: {hookEventName: "PreToolUse",
	permissionDecision: "deny", permissionDecisionReason: $r}}'
