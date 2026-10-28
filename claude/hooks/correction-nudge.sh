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

# Bringing one platform's design to another: the first build of #7581 (2026-10-27) cloned the
# iOS chrome onto the creator web instead of moving its design choices onto the web's own kit.
port_from='(^|[^a-z])(ios|iphone|android|native|mobile app)([^a-z]|$)'
port_to='(^|[^a-z])(web|webapp|website)([^a-z]|$)'
port_ask='(^|[^a-z])(match|parity|same as|mirror|as well|port|bring|migrate)([^a-z]|$)'
if [[ $prompt =~ $port_from ]] && [[ $prompt =~ $port_to ]] && [[ $prompt =~ $port_ask ]]; then
  printf '%s\t%s\n' "$(date -u +%FT%TZ)" "${prompt:0:300}" >>"$HOME/.claude/logs/platform-port-nudge.log"
  echo "If this asks to bring one platform's design to another (iOS app to web, or the reverse): carry over the design choices (structure, sections, content, behaviour) and build them from the target's own components, nav, type and colours. Do not rebuild the source platform's chrome (tab bars, glass, side menus, its font). Keep the nav to five groups or fewer, with tabs inside pages, so it never scrolls."
fi
exit 0
