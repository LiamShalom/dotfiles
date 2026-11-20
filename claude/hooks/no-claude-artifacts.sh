#!/usr/bin/env bash
# PreToolUse on Artifact: refuse to publish a claude.ai Artifact unless the operator's latest
# message asks for one (an artifact, a claude.ai page, a link to share, or a page for someone
# else). Pages for the operator to look at or approve are local HTML files opened in Session
# Board's pane. On 2026-11-19 an agent published a contract-check screenshot page as a claude.ai
# Artifact twice while CLAUDE.md said to use the pane; the operator: "open it in session pane.
# You shouldnt be making actual claude artifacts". Read, list, open, delete and quickstart pass.
input=$(cat)
action=$(printf '%s' "$input" | jq -r '.tool_input.action // "publish"')
[ "$action" = "publish" ] || exit 0

transcript=$(printf '%s' "$input" | jq -r '.transcript_path // ""')
if [ -n "$transcript" ] && [ -f "$transcript" ]; then
  # The latest prompt the operator typed (origin.kind "human"; skill text, hook feedback and
  # task notices are user entries too, but not typed).
  last=$(tail -n 600 "$transcript" | jq -rs '
    [ .[] | select(.type == "user" and .origin.kind == "human" and (.isMeta | not)) | .message.content
      | if type == "string" then . else ([ .[]? | select(.type == "text") | .text ] | join(" ")) end
      | select(. != "" and (test("^<(system-reminder|task-notification|local-command)") | not)) ]
    | last // ""' 2>/dev/null)
  # A message that says not to make one ("shouldnt be making artifacts") never counts as a request.
  if ! printf '%s' "$last" | grep -qiE "(shouldn.?t|should not|don.?t|do not|stop|never|no)[^.]{0,30}artifact" \
    && printf '%s' "$last" | grep -qiE '((make|publish|create|post|put)( it| this| that)? (as |into |in )?(an? |the )?(claude )?artifact)|artifact link|claude\.ai/|shareable|share (it|this|that|the page)|send (it|this|that) to|for (the team|my team|don|drew|a teammate|the client)'; then
    exit 0
  fi
fi

cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Do not publish a claude.ai Artifact for a page the operator looks at or approves. Write it as a local .html file and open it in Session Board's pane: `node ~/session-board/scripts/board-browser.mjs <file.html> \"<what to look at>\"` (in the Claude desktop app: SendUserFile). Publish an Artifact only when the operator's latest message asks for one, a link to share, or a page for someone else."}}
JSON
