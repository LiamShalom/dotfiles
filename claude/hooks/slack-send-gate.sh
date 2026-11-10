#!/usr/bin/env bash
# PreToolUse on every Slack MCP tool that writes (messages, drafts, schedules, file uploads,
# reactions, canvases, lists, channels): once Liam's user token is in Keychain, write through
# slack-as-liam instead, so nothing carries the "Sent using Claude" tag the MCP adds.
# Without the token, the MCP call still runs. Reading Slack through the MCP is fine.
security find-generic-password -s claude-slack-user-token >/dev/null 2>&1 || exit 0

cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Never write to Slack through the Slack MCP: it tags messages and files 'Sent using Claude'. Use the CLI as Liam: `~/.claude/bin/slack-as-liam chat.postMessage channel=<id> text=\"...\"` (thread_ts=<ts> for a thread reply; chat.scheduleMessage post_at=<unix> to schedule; reactions.add for a reaction; conversations.open users=<U...> for a DM id), and `~/.claude/bin/slack-as-liam upload <channel-id> <file> [comment] [thread_ts]` for a file. If the CLI says missing_scope, tell Liam which scope the Liam CLI Slack app needs; do not fall back to the MCP. Reading Slack through the MCP is fine."}}
JSON
