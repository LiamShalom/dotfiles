#!/bin/bash
#
# code-review-mark.sh — PostToolUse hook on Skill. Records that this session ran the code-review
# skill, so review-merge-gate.sh lets a merge through.
#
# Usage (settings): bash ~/.claude/hooks/code-review-mark.sh
input=$(cat)
{ IFS= read -r session; IFS= read -r skill; } < <(jq -r '(.session_id // "unknown"), (.tool_input.skill // "")' <<<"$input" 2>/dev/null)
case "$skill" in
	code-review | *:code-review) ;;
	*) exit 0 ;;
esac
mkdir -p "$HOME/.cache/claude-code-review"
: >"$HOME/.cache/claude-code-review/$session"
exit 0
