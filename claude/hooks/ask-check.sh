#!/bin/bash
# Stop: when the reply asks the operator to decide or do something, have the agent check once that every ask explains
# itself (what the thing is, why it matters, its pick) before the turn ends. The operator reads each message on its
# own, often hours later; bare asks that leaned on earlier explanations cost three "wdym" questions on 10-20 and 10-22
# (learning ledger). Runs at every turn end in every session, so it stays at one jq call: no grep, no node.
# Headless runs (claude -p: compaction, reviews, the weekly pass) report as `sdk-*` and are skipped: their final
# message is a result another program reads, and a continuation would replace it.

case "${CLAUDE_CODE_ENTRYPOINT:-}" in "" | sdk*) exit 0 ;; esac
hit=$(jq -r 'if .stop_hook_active then empty
  elif ((.last_assistant_message // "") | test("what i need from you|waiting on (you|liam)|needs? your|your (call|decision|yes|ok|okay|go-ahead|approval|answer)\\b|reply [\"“]|want me to|want it\\?|do you want|should i "; "i")) then "ask"
  else empty end' 2>/dev/null)
[ "$hit" = ask ] || exit 0
printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"Your message asks the operator to decide or do something. The operator reads each message on its own, often hours later, and has had to ask \"wdym\" when an ask leaned on an earlier explanation. Check every ask in it: does that same item say, in plain words, what the thing is (no bare name, identifier or shorthand from earlier), why it matters, and what you recommend? If every ask does, reply with exactly: Asks checked. If one does not, write only that ask again, complete."}}'
exit 0
