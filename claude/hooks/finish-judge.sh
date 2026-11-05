#!/bin/bash
# Stop + SubagentStop: a second model reads what the agent did this turn and sends it back to work when it stopped
# early, asked something it could do itself, claimed a result with no proof, or answered "why" with guesses.
# Regex checks (ask-check.sh, test-before-reply.sh) catch phrasings; a weaker model rewords around them and its second
# try always passes (they block once). Anthropic's harness research: agents grade their own work too kindly, and
# Sonnet/Haiku at low effort check in early and skip checks; a separate judge is the tested fix.
# The judge runs as `claude -p --safe-mode` because the account relay refuses raw API calls (429) from anything but
# Claude Code. Every verdict is logged to ~/.claude/logs/finish-judge.jsonl so the prompt can be tuned from real cases.
# At most 2 sends-back per user message (per subagent run); after that the turn ends normally.
# Headless runs (claude -p: compaction, reviews, this judge itself) are skipped; AUTONOMY_JUDGE=off turns it off.
case "${CLAUDE_CODE_ENTRYPOINT:-}" in "" | sdk*) exit 0 ;; esac
[ "${AUTONOMY_JUDGE:-on}" = off ] && exit 0
exec node "$HOME/.claude/hooks/finish-judge.mjs"
