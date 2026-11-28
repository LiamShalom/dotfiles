#!/usr/bin/env bash
# Replays the real 2026-11-27 command (PR #4759 body "None until TikTok approves the app") and a
# real user-visible body against prod-change-none-check.sh. Run from a branch that changes components/.
hook="$(dirname "$0")/prod-change-none-check.sh"
wt=${1:-/Users/liamshalom/sideshift-monorepo/.claude/worktrees/feat+tiktok-shop-creator-collab}
tmp=$(mktemp -d)
printf '## Rollout\n\nOff.\n\n## Prod change\n\nNone until TikTok approves the app: only allowlisted test creators see the card.\n' > "$tmp/none.md"
printf '## Prod change\n\nBrands see a TikTok Shop section on creator profiles.\n' > "$tmp/visible.md"
run() { jq -n --arg c "$1" --arg d "$wt" '{tool_name:"Bash",tool_input:{command:$c},cwd:$d}' | bash "$hook"; }
fail=0
out=$(run "gh pr edit 4759 --repo SideShiftApp/sideshift-monorepo --body-file $tmp/none.md")
printf '%s' "$out" | grep -q 'Prod change: none' && echo "PASS none body fires" || { echo "FAIL none body silent"; fail=1; }
out=$(run "gh pr edit 4759 --repo SideShiftApp/sideshift-monorepo --body-file $tmp/visible.md")
[ -z "$out" ] && echo "PASS visible body silent" || { echo "FAIL visible body fired"; fail=1; }
out=$(run "gh pr view 4759 --json body")
[ -z "$out" ] && echo "PASS gh pr view silent" || { echo "FAIL gh pr view fired"; fail=1; }
rm -rf "$tmp"
exit $fail
