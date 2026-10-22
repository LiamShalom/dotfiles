#!/bin/bash
# Stop: when the reply asks the operator to decide or do something, have the agent check once that every ask explains
# itself (what the thing is, why it matters, its pick) before the turn ends. The operator reads each message on its
# own, often hours later; bare asks that leaned on earlier explanations cost three "wdym" questions on 10-20 and 10-22
# (learning ledger).
# Same pass for an email draft (a "Subject:" line) that has a [BRACKETED] placeholder or runs past 250 words: on 10-22
# a reply to Google said "the screencast is attached" before any recording existed and read like a spec ("I dont have
# the recoirding here Im confused. This is also a terrible email").
# Runs at every turn end in every session, so it stays at one jq call: no grep, no node.
# Headless runs (claude -p: compaction, reviews, the weekly pass) report as `sdk-*` and are skipped: their final
# message is a result another program reads, and a continuation would replace it.

case "${CLAUDE_CODE_ENTRYPOINT:-}" in "" | sdk*) exit 0 ;; esac
jq -c 'if .stop_hook_active then empty else
  (.last_assistant_message // "") as $m
  | ($m | test("what i need from you|waiting on (you|liam)|needs? your|your (call|decision|yes|ok|okay|go-ahead|approval|answer)\\b|reply [\"“]|want me to|want it\\?|do you want|should i "; "i")) as $ask
  | (if ($m | test("(^|\\n)[ \\t>*_`#]*subject:"; "i")) then ($m | capture("subject:(?<d>[\\s\\S]*?)(```|\\z)"; "i").d) else null end) as $draft
  | ($draft != null and ($draft | test("\\[[A-Z]{3,}[^\\]\\n]{0,80}\\]"))) as $gap
  | (if $draft == null then 0 else ($draft | [scan("\\S+")] | length) end) as $words
  | [ (if $ask then "Your message asks the operator to decide or do something. The operator reads each message on its own, often hours later, and has had to ask \"wdym\" when an ask leaned on an earlier explanation. Check every ask in it: does that same item say, in plain words, what the thing is (no bare name, identifier or shorthand from earlier), why it matters, and what you recommend? If every ask does, reply with exactly: Asks checked. If one does not, write only that ask again, complete." else empty end),
      (if $gap or $words > 250 then "Your message hands over an email draft for someone outside the team, and it " + ([(if $gap then "has [BRACKETED] placeholders" else empty end), (if $words > 250 then "runs \($words) words" else empty end)] | join(" and ")) + ". A draft with gaps confuses the operator (10-22: \"the screencast is attached\" before any recording existed), and a long one reads like a spec. Produce what each placeholder stands for, or say plainly in chat that the draft is not ready and why. Make it answer only what the recipient asked, in their order, in plain words, in under 250 words: cut internal names, numbers and caveats they did not ask for. Then show the fixed draft once; if it already passes, reply with exactly: Draft checked." else empty end) ]
  | if length == 0 then empty else {hookSpecificOutput: {hookEventName: "Stop", additionalContext: join("\n\n")}} end
end' 2>/dev/null
exit 0
