#!/bin/bash
#
# merge-reach-check.sh — PreToolUse hook on Bash for Claude Code. The first time a
# session merges a PR with gh-approve, it refuses once and asks who the change
# reaches. Running the same command again merges. Other commands pass through.
#
# Why: #7121 (2026-10-23) was merged on the operator's approval of one customer's
# case and would have started overdue emails to five other brands. The list was in
# the PR body; the operator never saw it before the merge. Ledger row 2026-10-23.
#
# Usage (settings): bash ~/.claude/hooks/merge-reach-check.sh
input=$(cat)
case "$input" in
	*gh-approve*--merge*) ;;
	*) exit 0 ;;
esac
IFS=$'\t' read -r session cmd < <(jq -r '[.session_id // "unknown", (.tool_input.command // "" | tostring)] | @tsv' <<<"$input" 2>/dev/null)
# Only a command that runs gh-approve: at the start of a command (or after && || ; |),
# optionally behind env assignments and a path. A commit message that mentions it does not count.
run='(^|[|][[:space:]]*)[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*([^[:space:]|]*/)?gh-approve([[:space:]][^|]*)'
merge='[[:space:]]--merge([[:space:]]|$)'
parts=${cmd//&&/$'\n'}
parts=${parts//||/$'\n'}
parts=${parts//;/$'\n'}
segment=
while IFS= read -r part; do
	[[ $part =~ $run ]] || continue
	args=${BASH_REMATCH[4]}
	if [[ $args =~ $merge ]]; then
		segment=$args
		break
	fi
done <<<"$parts"
[ -n "$segment" ] || exit 0

pr=current
if [[ $segment =~ ^[[:space:]]+(-R[[:space:]]+[^[:space:]]+[[:space:]]+)?([0-9]+) ]]; then
	pr=${BASH_REMATCH[2]}
fi
state="$HOME/.cache/claude-merge-reach"
mark="$state/${session}-${pr}"
[ -e "$mark" ] && exit 0
mkdir -p "$state"
: >"$mark"

reason="Before you merge PR #${pr}, answer two questions in your reply to the operator.
1. Which real accounts does this change reach? List every account whose emails, notices, cancellations, charges or access change, from live data (Stripe, Postgres, Firestore), not from a derived flag. For a cron, billing or email change, the blast-radius skill finds the list.
2. Did the operator approve each of them? Approval for the case that prompted the change does not cover other accounts. If any account is not covered, stop and ask, with the list.
If the change reaches no one beyond what the operator approved, run the same command again."
jq -nc --arg r "$reason" '{hookSpecificOutput: {hookEventName: "PreToolUse",
	permissionDecision: "deny", permissionDecisionReason: $r}}'
