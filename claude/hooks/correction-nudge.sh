#!/bin/bash
# UserPromptSubmit: when a prompt reads like a correction of the agent's own work,
# remind it to run the `correct` skill's in-session step, and log the hit so the
# weekly `correct` pass can measure what repeats. Runs on every prompt in every
# session, so it stays at one jq call and bash matching: no grep, no node.

prompt=$(jq -r '.prompt // empty' 2>/dev/null | tr '\n' ' ')
[ -n "$prompt" ] || exit 0
# Corrections are short. Long prompts are pastes or tool-driven runs (recompact's compaction
# prompts quote whole transcripts), so skip them.
[ ${#prompt} -le 1500 ] || exit 0
case "$prompt" in "<"* | "Reply with"* | "LIVECHECK"* | "Call the "* | "Continue the work from"* | "You are compacting"*) exit 0 ;; esac

shopt -s nocasematch
lead='^(no|nope|wrong|stop)([ ,.!]|$)'
benign='^no (problem|worries|rush|thanks)'
signal="(^|[^a-z])(wdym|heads up|you already|no need to|i (said|told you|already)|as i said|still (dont|don't|doesnt|doesn't|isnt|isn't|not|getting|seeing)|why (did|are|would) you|you (forgot|missed|didnt|didn't|ignored|broke)|that'?s not (what|right)|not what i (asked|meant|wanted)|(in|already in) (the |my |your )?(instructions|claude|agents|rules|memory)|keeps? (appearing|happening|opening|failing)|i (need|want) you to (ensure|make sure|always|never|stop)|doesn'?t actually|every time)([^a-z]|$)"

if { [[ $prompt =~ $lead ]] && ! [[ $prompt =~ $benign ]]; } || [[ $prompt =~ $signal ]]; then
  printf '%s\t%s\n' "$(date -u +%FT%TZ)" "${prompt:0:300}" >>"$HOME/.claude/logs/corrections-flagged.log"
  echo "This message may correct something you did earlier. If it does: fix the thing first, then run the in-session step of the \`correct\` skill (was this already a rule? if so it is a repeat, so move it up a level). If it is a new request or a product bug report, ignore this note."
fi
exit 0
