#!/usr/bin/env bash
# PreToolUse on Bash, and on Write/Edit of scratch scripts under ~/.claude/jobs: refuse TikTok's
# oEmbed and /embed/v2 endpoints. Both answer 200 for any video id, even a made-up one, so they
# say nothing about whether a post is live. On 2026-11-11 an agent took oEmbed 200 as "public",
# told the operator ~195K live TikToks were missed, and sent Crawlzo a false bug report.
# Repo code is not checked: lib/analytics.ts still names oEmbed for a different purpose.
input=$(cat)
text=$(printf '%s' "$input" | jq -r '
  if .tool_name == "Bash" then .tool_input.command // ""
  elif (.tool_input.file_path // "") | test("/\\.claude/jobs/") then (.tool_input.content // .tool_input.new_string // "")
  else "" end')
printf '%s' "$text" | grep -qiE 'tiktok\.com/(oembed|embed/v2)' || exit 0
# Only a request, not a note or doc that names the endpoint.
printf '%s' "$text" | grep -qiE '\b(curl|wget|fetch|axios|requests\.|http\.get|https\.get|got\()' || exit 0

cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"TikTok's oEmbed and /embed/v2 answer 200 for ANY video id, even a made-up one, so they cannot tell whether a TikTok is live (2026-11-11: this produced a false '195K live TikToks missed' finding and a false bug report to Crawlzo). To check liveness run `~/.claude/bin/tiktok-live.mjs <url>...`: it opens each post logged out in the agent Chrome, checks a made-up control first, and prints live / unavailable / private / account_gone. Crawlzo's NOT_FOUND is also reliable."}}
JSON
