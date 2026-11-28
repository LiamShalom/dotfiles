#!/usr/bin/env bash
# PreToolUse on Bash: when `gh pr create|edit` sets "## Prod change" to "none" while the branch
# changes app/ or components/, remind the agent to prove it on the preview before saying it.
# 2026-11-27: PR #4759 said "None until TikTok approves the app" for a gated feature; nobody had
# loaded the changed screens as someone outside the gate. Every brand would have seen an empty
# "No TikTok Shop report shared" box on every creator profile, and every creator a card flash.
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r 'if .tool_name == "Bash" then .tool_input.command // "" else "" end')
printf '%s' "$cmd" | grep -qE '\bgh pr (create|edit)\b' || exit 0
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')

body="$cmd"
file=$(printf '%s' "$cmd" | grep -oE -- '(--body-file|-F) +[^ ]+' | head -1 | awk '{print $2}' | tr -d "'\"")
[ -n "$file" ] && [ -f "$file" ] && body=$(cat "$file")

# The first non-empty line under "## Prod change".
first=$(printf '%s\n' "$body" | awk 'f && NF {print; exit} /^##[[:space:]]+Prod change/ {f=1}')
printf '%s' "$first" | grep -qiE '^[[:space:]]*none' || exit 0

[ -n "$cwd" ] && cd "$cwd" 2>/dev/null
base=$(git merge-base HEAD origin/main 2>/dev/null) || exit 0
ui=$(git diff --name-only "$base" HEAD 2>/dev/null | grep -E '^(app|components)/' | grep -vE '(^|/)__tests__/|\.test\.' | head -5)
[ -n "$ui" ] || exit 0

msg="This PR says Prod change: none, but it changes UI files ($(printf '%s' "$ui" | tr '\n' ' ')). Before you claim none, open each changed screen on this commit's preview as users OUTSIDE any rollout gate (a brand and a creator not on any allowlist or flag; signed out where the page allows) and look at it while its data loads, after it loads, and when a request fails. Write none only if nothing new renders; otherwise say what users see. 2026-11-27: #4759 said none while every brand would have seen an empty TikTok Shop box on every creator profile."
jq -n --arg m "$msg" '{hookSpecificOutput:{hookEventName:"PreToolUse",additionalContext:$m}}'
