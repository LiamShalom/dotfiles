#!/bin/bash
#
# qa-merge-gate.sh — PreToolUse hook on Bash. Refuses a merge of a sideshift-monorepo PR that does
# not go through gh-approve, which requires the browser QA suite (qa-agents/qa-pr.mjs) to have
# passed on the PR head. Other repositories and other commands pass through.
#
# Why: Liam 2026-11-08, "ensure that every session does this full suite before merging". The gate
# lives in gh-approve; this hook closes the way around it (gh pr merge, the merge API, auto-merge).
#
# Usage (settings): bash ~/.claude/hooks/qa-merge-gate.sh
input=$(cat)
case "$input" in
	*merge*) ;;
	*) exit 0 ;;
esac
[ -e "${XDG_CONFIG_HOME:-$HOME/.config}/qa-agents/required" ] || exit 0
{ IFS= read -r cwd; IFS= read -r -d '' cmd; } < <(jq -r '(.cwd // ""), (.tool_input.command // "" | tostring)' <<<"$input" 2>/dev/null)
# Quoted text (a commit message, a note) only mentions a merge; it does not run one.
cmd=$(printf '%s' "$cmd" | sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g")

merges=
if [[ $cmd =~ (^|[^[:alnum:]_-])gh[[:space:]]+pr[[:space:]]+merge([[:space:]]|$) ]]; then
	# A named repository decides; otherwise the folder the command runs in.
	if [[ $cmd =~ (-R|--repo)[[:space:]=]+([^[:space:]]+) ]]; then
		[[ ${BASH_REMATCH[2]} == *sideshift-monorepo* ]] && merges=1
	elif [[ $cmd =~ cd[[:space:]]+([^[:space:]\;\&\|]+) ]]; then
		[[ ${BASH_REMATCH[1]} == *sideshift-monorepo* ]] && merges=1
	else
		[[ $cwd == *sideshift-monorepo* ]] && merges=1
	fi
fi
if [[ $cmd =~ repos/[^/[:space:]]+/sideshift-monorepo/pulls/[0-9]+/merge ]] || [[ $cmd =~ mergePullRequest|enablePullRequestAutoMerge ]]; then
	merges=1
fi
[ -n "$merges" ] || exit 0

reason="Merge sideshift-monorepo PRs only with gh-approve (.claude/skills/pr-approve/scripts/gh-approve <pr> --merge). It refuses a PR until the browser QA suite has passed on its head commit: run \`node qa-agents/qa-pr.mjs <pr>\` first, fix its findings, or accept an intended one with \`node qa-agents/qa-pr.mjs <pr> --accept \"<why>\"\`."
jq -nc --arg r "$reason" '{hookSpecificOutput: {hookEventName: "PreToolUse",
	permissionDecision: "deny", permissionDecisionReason: $r}}'
