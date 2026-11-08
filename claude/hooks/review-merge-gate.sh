#!/bin/bash
#
# review-merge-gate.sh — PreToolUse hook on Bash. Before a sideshift-monorepo PR merges, the session must
# have run /code-review (bugs and gaps in the change) and fixed what it found. It refuses a merge
# through gh-approve until code-review-mark.sh has recorded a review in this session, and refuses a
# merge that skips gh-approve (gh pr merge, the merge API, auto-merge). Other repositories and other
# commands pass through.
#
# Why: Liam 2026-11-08, "Its just supposed to be a code review that looks for bugs and gaps in the
# feature and then fixes before merging".
#
# Usage (settings): bash ~/.claude/hooks/review-merge-gate.sh
input=$(cat)
case "$input" in
	*merge*) ;;
	*) exit 0 ;;
esac
{ IFS= read -r session; IFS= read -r cwd; IFS= read -r -d '' cmd; } < <(jq -r '(.session_id // "unknown"), (.cwd // ""), (.tool_input.command // "" | tostring)' <<<"$input" 2>/dev/null)
# Quoted text (a commit message, a note) only mentions a merge; it does not run one.
cmd=$(printf '%s' "$cmd" | sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g")

deny() {
	jq -nc --arg r "$1" '{hookSpecificOutput: {hookEventName: "PreToolUse",
		permissionDecision: "deny", permissionDecisionReason: $r}}'
	exit 0
}

# The repository a gh command targets: a named -R/--repo, else a cd in the command, else the folder.
in_monorepo() {
	if [[ $cmd =~ (-R|--repo)[[:space:]=]+([^[:space:]]+) ]]; then
		[[ ${BASH_REMATCH[2]} == *sideshift-monorepo* ]]
	elif [[ $cmd =~ cd[[:space:]]+([^[:space:]\;\&\|]+) ]]; then
		[[ ${BASH_REMATCH[1]} == *sideshift-monorepo* ]]
	else
		[[ $cwd == *sideshift-monorepo* ]]
	fi
}

review="Run /code-review on the PR (high effort, with --fix) and fix every real bug it finds. Also check the diff against what was asked: a promised behaviour that is missing, or a state the change does not handle (empty, error, loading, a role without access), is a gap to fix. Push the fixes, let CI finish, then merge."

if [[ $cmd =~ (^|[^[:alnum:]_-])gh[[:space:]]+pr[[:space:]]+merge([[:space:]]|$) ]] && in_monorepo; then
	deny "Merge sideshift-monorepo PRs only with gh-approve (.claude/skills/pr-approve/scripts/gh-approve <pr> --merge). Before that: $review"
fi
if [[ $cmd =~ repos/[^/[:space:]]+/sideshift-monorepo/pulls/[0-9]+/merge ]] || [[ $cmd =~ mergePullRequest|enablePullRequestAutoMerge ]]; then
	deny "Merge sideshift-monorepo PRs only with gh-approve (.claude/skills/pr-approve/scripts/gh-approve <pr> --merge). Before that: $review"
fi
if [[ $cmd =~ gh-approve([^|;&]*)--merge ]] && in_monorepo; then
	[ -e "$HOME/.cache/claude-code-review/$session" ] && exit 0
	deny "This session has not run /code-review yet. Before merging: $review"
fi
exit 0
