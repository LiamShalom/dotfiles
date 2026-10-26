#!/bin/bash
# Stop: when the reply asks the operator to decide or do something, have the agent check once that every ask explains
# itself (what the thing is, why it matters, its pick) before the turn ends. The operator reads each message on its
# own, often hours later; bare asks that leaned on earlier explanations cost three "wdym" questions on 10-20 and 10-22
# (learning ledger). The same check asks whether each ask is still needed: on 10-23 an ask relayed from another
# session's notes ("unlock the Studio key") was already done, and read as a second copy of a key Liam had given.
# The same pass reads the message's explaining passages too: on 10-23 a status line beside a checked ask said the worker
# "sends a model name your pool refuses" without saying what that meant, and got "wdym" (learning ledger).
# Same pass for an email draft (a "Subject:" line) that has a [BRACKETED] placeholder or runs past 250 words: on 10-22
# a reply to Google said "the screencast is attached" before any recording existed and read like a spec ("I dont have
# the recoirding here Im confused. This is also a terrible email").
# Same pass for a reply that asks the operator to approve a screen or design without naming any options: on 10-23 a new
# trial checkout went up as one design copied from the Get started cards ("This is awful... This is why I asked for you
# to provide options"), a day after the same miss in quick-fix (learning ledger).
# The injected text shows in the transcript on every flagged turn, so it stays a few lines; the incidents above stay here.
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
  | ($m | test("approv[a-z]*[^.\\n]{0,80}\\b(screen|ui|design|layout|page|modal|flow)\\b|\\b(screen|ui|design|layout|page|modal|flow)\\b[^.\\n]{0,80}approv"; "i")) as $uiApproval
  | ($m | test("\\boptions?\\b|\\bdirections\\b"; "i")) as $options
  | [ (if $ask then "Before you stop, check each ask: does it say in plain words what the thing is (no bare name or earlier shorthand), why it matters, and your pick? If it came from notes, memory or another session, check it is still needed now. Read the rest of the message the same way. All pass: reply exactly \"Asks checked.\" Otherwise rewrite only what fails." else empty end),
      (if $gap or $words > 250 then "Your message hands over an email draft for someone outside the team, and it " + ([(if $gap then "has [BRACKETED] placeholders" else empty end), (if $words > 250 then "runs \($words) words" else empty end)] | join(" and ")) + ". Fill each placeholder or say the draft is not ready and why. Answer only what the recipient asked, in their order, under 250 words, no internal names. Show the fixed draft once, or reply exactly \"Draft checked.\"" else empty end),
      (if $uiApproval and ($options | not) then "You ask for approval of a screen or design but name no options. A new or redesigned surface goes up as two or three different directions with your pick: build them first. Small change or direction already chosen: reply exactly \"Options checked.\"" else empty end) ]
  | if length == 0 then empty else {hookSpecificOutput: {hookEventName: "Stop", additionalContext: join("\n\n")}} end
end' 2>/dev/null
exit 0
