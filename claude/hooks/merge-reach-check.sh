#!/bin/bash
#
# merge-reach-check.sh — PreToolUse hook on Bash for Claude Code. The first time a
# session merges a PR with gh-approve, it refuses once and asks who the change
# reaches. Running the same command again merges. Other commands pass through.
#
# Why: #7121 (2026-10-23) was merged on the operator's approval of one customer's
# case and would have started overdue emails to five other brands. The list was in
# the PR body; the operator never saw it before the merge. Ledger row 2026-10-23.
# It also asks whether the diff adds UI the operator has not chosen, and, when no
# copy-sweep ran in the session, for a whole-repo sweep. Ledger rows 2026-10-27.
#
# Usage (settings): bash ~/.claude/hooks/merge-reach-check.sh
input=$(cat)
case "$input" in
	*gh-approve*--merge*) ;;
	*) exit 0 ;;
esac
# One jq: the session, the working folder, then the command exactly as written (newlines kept).
{ IFS= read -r session; IFS= read -r cwd; IFS= read -r -d '' cmd; } < <(jq -r '(.session_id // "unknown"), (.cwd // ""), (.tool_input.command // "" | tostring)' <<<"$input" 2>/dev/null)
case "$cmd" in
	*gh-approve*--merge*) ;;
	*) exit 0 ;;
esac

# A command that runs gh-approve: at the start of a line or after && || ; |, optionally
# behind env assignments and a path.
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

# The PR: a bare number or a pull link anywhere in the arguments, not the -R value.
pr=
if [ -n "$segment" ]; then
	read -ra words <<<"$segment"
	skip=
	for word in "${words[@]}"; do
		if [ -n "$skip" ]; then
			skip=
			continue
		fi
		case "$word" in
			-R | --repo) skip=1 ;;
			*/pull/*) [[ $word =~ /pull/([0-9]+) ]] && pr=${BASH_REMATCH[1]} && break ;;
			*) [[ $word =~ ^#?([0-9]+)$ ]] && pr=${BASH_REMATCH[1]} && break ;;
		esac
	done
fi
if [ -n "$pr" ]; then
	key="pr-$pr"
else
	# The current branch's PR, or a mention this cannot parse: key on the folder and the
	# exact command, so another branch or another command is asked again.
	sum=$(printf '%s\n%s' "$cwd" "$cmd" | cksum)
	key="cmd-${sum%% *}"
fi
state="$HOME/.cache/claude-merge-reach"
mark="$state/${session}-${key}"
[ -e "$mark" ] && exit 0
mkdir -p "$state"
: >"$mark"

questions="1. Which real accounts does this change reach? List every account whose emails, notices, cancellations, charges or access change, from live data (Stripe, Postgres, Firestore), not from a derived flag. For a cron, billing or email change, the blast-radius skill finds the list.
2. Did the operator approve each of them? Approval for the case that prompted the change does not cover other accounts. For each account, quote the operator's own words that name it; your reading of a word like \"either\" or \"them\" is not approval. If any account is not covered, stop and ask, with the list. (2026-11-02: #8261 removed the operator from 49 channels on a reading of \"either\"; he wanted to stay.)
3. Does the diff put a modal, popup, sheet, new screen or new component where there was none, or change what a click on a visible element does? Then it is large UI unless the operator saw it and chose it: you choosing between ways to read the request does not count. Open the preview in Session Board and stop. (2026-10-27: #7422 merged a video popup; the operator wanted the video to play in place.)"
count=three
if [ ! -e "$HOME/.cache/claude-copy-sweep/$session" ]; then
	questions="$questions
4. If this fixes a bug: you have not run copy-sweep in this session. Run \`copy-sweep '<broken pattern>' ['<file also has>']\` (whole repo, never only the folders you are in) and fix every surface it lists with the same bug in this PR, or say why one is not. (2026-10-27: a sweep of components/portfolio only missed five surfaces.)"
	count=four
fi
if [ -n "$segment" ]; then
	label="this PR"
	[ -n "$pr" ] && label="PR #$pr"
	reason="Before you merge $label, answer $count questions in your reply to the operator.
$questions
If the change reaches no one beyond what the operator approved, run the same command again."
else
	reason="This command mentions gh-approve and --merge. If it merges a PR, first answer $count questions in your reply to the operator.
$questions
If it only mentions the command (a commit message, a note), or the change reaches no one beyond what the operator approved, run the same command again."
fi
jq -nc --arg r "$reason" '{hookSpecificOutput: {hookEventName: "PreToolUse",
	permissionDecision: "deny", permissionDecisionReason: $r}}'
