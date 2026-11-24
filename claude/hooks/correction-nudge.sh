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
  echo "This message may correct something you did earlier. If it does: fix the thing first, then run the in-session step of the \`correct\` skill (was this already a rule? if so it is a repeat, so move it up a level). The fix changes only what the message's words cover: every earlier decision they do not name (who can see it, a gate, a hidden or unlisted setting, a case such as signed-out) stays as it was, and your reply says in one line what you kept. If it is a new request or a product bug report, ignore this note."
fi
# 2026-11-22 SideShift School bootcamp: "No I want bootcamp to be an actual job that they open and
# apply to like a normal job" → I also dropped the spec's "hidden from the job feed" as a
# consequence → "But its not a public job you can only join if you have the link".

# Bringing one platform's design to another: the first build of #7581 (2026-10-27) cloned the
# iOS chrome onto the creator web instead of moving its design choices onto the web's own kit.
port_from='(^|[^a-z])(ios|iphone|android|native|mobile app)([^a-z]|$)'
# 2026-11-04: "replicate the mobile view of the brand portfolio side but on ios" named no "web" and
# used "replicate", so this missed it; the iOS copy then kept the web's narrow-column wrap.
port_to='(^|[^a-z])(web|webapp|website|mobile view|brand side|brand view)([^a-z]|$)'
port_ask='(^|[^a-z])(match|parity|same as|mirror|as well|port|bring|migrate|replicate|recreate|copy)([^a-z]|$)'
if [[ $prompt =~ $port_from ]] && [[ $prompt =~ $port_to ]] && [[ $prompt =~ $port_ask ]]; then
  printf '%s\t%s\n' "$(date -u +%FT%TZ)" "${prompt:0:300}" >>"$HOME/.claude/logs/platform-port-nudge.log"
  echo "If this asks to bring one platform's design to another (iOS app to web, or the reverse): carry over the design choices (structure, sections, content, behaviour) and build them from the target's own components, nav, type and colours. Do not rebuild the source platform's chrome (tab bars, glass, side menus, its font). Copy what each row shows, not how it wraps at the source's width: lay rows out for the target's space, with no empty gap beside a wrapped line. Keep the nav to five groups or fewer, with tabs inside pages, so it never scrolls."
fi

# Judging which features or gaps are worth building: on 2026-11-04 an ads teardown review ranked
# an Ads Overview checklist first from code reads alone; the live page already showed the prompt.
value_ask='(^|[^a-z])(determine which|which of (them|these)|worth (building|it)|have value|prioriti[sz]e|teardown|feature (list|requests?))([^a-z]|$)'
value_src='(^|[^a-z])(codebase|internal data|our data|the platform|the app|production)([^a-z]|$)'
if [[ $prompt =~ $value_ask ]] && [[ $prompt =~ $value_src ]]; then
  printf '%s\t%s\n' "$(date -u +%FT%TZ)" "${prompt:0:300}" >>"$HOME/.claude/logs/value-review-nudge.log"
  echo "If this asks you to judge which features or gaps are real or worth building: a code read (yours or a subagent's) is not proof that a screen lacks something. Before you report a UI gap, open the live app as a test brand in each state that matters (for example no account, connected but empty, active) and read what it shows. Mark every item as checked on screen, checked in code only, or not checked."
fi

# A request to redesign a surface built as one direction: on 2026-11-21 "Can we first work on
# redesigning it" (iOS creator onboarding) got a full one-direction rebuild shipped to TestFlight,
# and Liam: "This is all awful. I hate this entire new redesign." The Stop check (ask-check.sh)
# fired only at the end, hours after the build. This note lands when the work starts.
redesign_ask='(^|[^a-z])(redesign[a-z]*|re-?design[a-z]*|revamp[a-z]*|rework the (look|ui|design|screens?)|make it look|new look|restyle[a-z]*)([^a-z]|$)'
redesign_undo='(^|[^a-z])(revert|go back to|undo|roll back)([^a-z]|$)'
if [[ $prompt =~ $redesign_ask ]] && ! [[ $prompt =~ $redesign_undo ]]; then
  printf '%s\t%s\n' "$(date -u +%FT%TZ)" "${prompt:0:300}" >>"$HOME/.claude/logs/redesign-ask-nudge.log"
  echo "If this asks you to redesign a screen or flow: before building it, show two or three different directions (real screens on the canvas or in the pane, side by side, your pick named) and wait for Liam to choose one. Building one direction and asking for approval afterwards is the failure this note exists for (ledger 10-22, 10-23, 11-08, 11-21). Bug fixes inside the redesign request (taps, keyboard, a missing screen) can go ahead."
fi

# Short design feedback read one way without asking: on 2026-11-19 (brand v4 navbar) "the sort
# could be a little better" meant section structure, not item order; "instead of the weird logo
# lets just call it settings" meant the placeholder logo, not the brand row. The visual-companion
# step that covers this did not load, so the reminder fires here on every such prompt.
design_ask='(^|[^a-z])(nav|navbar|sidebar|section|sections|layout|design|logo|icon|menu|group|grouping|sort|structure|header|footer|switcher|inspo|cleaner|option)([^a-z]|$)'
if [ ${#prompt} -le 600 ] && [[ $prompt =~ $design_ask ]]; then
  printf '%s\t%s\n' "$(date -u +%FT%TZ)" "${prompt:0:300}" >>"$HOME/.claude/logs/design-feedback-nudge.log"
  echo "If this is feedback on a design or option you showed: before you change anything, say in one line what this message settles and what it leaves as it was. Keep every earlier decision in every option. If a phrase fits two readings (\"the logo\" = the placeholder image or the whole row; \"sort\" = item order or section structure), ask in one line, or build both and say so. Do not pick one reading silently."
fi

# "Our logo" has several meanings: on 2026-11-23 "update the slack space logo to the current logo"
# got the light-blue iOS app icon; Liam meant "the black one we use on the platform brand side".
logo_ask='(^|[^a-z])(logo|logos|brand ?mark|app icon|workspace icon|org icon|avatar)([^a-z]|$)'
if [[ $prompt =~ $logo_ask ]]; then
  printf '%s\t%s\n' "$(date -u +%FT%TZ)" "${prompt:0:300}" >>"$HOME/.claude/logs/logo-ask-nudge.log"
  echo "If this asks for 'the SideShift logo' or 'our current logo': SideShift has several (the brand sidebar tile SideshiftTileLogo: white plane on a black-to-graphite gradient with a sheen; the flat mark SideshiftMarkLogo; the black wordmark; the light-blue iOS/PWA app icon). For an app, workspace or avatar icon, default to SideshiftTileLogo, rendered from components/ui/icons/logos/sideshift-tile-logo.tsx (never a lookalike), unless the words name another one, and say which one you used in one line."
fi
exit 0
