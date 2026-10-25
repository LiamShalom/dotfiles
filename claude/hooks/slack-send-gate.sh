#!/usr/bin/env bash
# PreToolUse on the Slack MCP send tools: once Liam's user token is in Keychain, send through
# slack-as-liam instead, so the message carries no "Sent using Claude" tag.
# Without the token, the MCP send still runs.
security find-generic-password -s claude-slack-user-token >/dev/null 2>&1 || exit 0

cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Do not send Slack messages through the Slack MCP: it tags them 'Sent using Claude'. Send as Liam with the CLI instead: `~/.claude/bin/slack-as-liam chat.postMessage channel=<id> text=\"...\"` (add thread_ts=<ts> to reply in a thread; chat.scheduleMessage with post_at=<unix> to schedule). Reading Slack through the MCP is fine."}}
JSON
