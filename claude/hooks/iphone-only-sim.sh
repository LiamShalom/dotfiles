#!/usr/bin/env bash
# PreToolUse on Bash: refuses a command that creates, boots, builds for, installs to, launches on or
# shows an iPad simulator. SideShift's iOS app is iPhone only (TARGETED_DEVICE_FAMILY = 1), so an
# iPad run shows the app in a phone-shaped window that is not what creators see.
# (2026-11-03/04: the operator said "so only test for iphone", and the agent kept testing the
# floating guide on an iPad simulator because the iPhone simulator has no Picture in Picture.)
#
# A test that needs something the iPhone simulator cannot do runs on a real iPhone, or is reported
# as not verified. It never moves to an iPad.
#
# Only the parts of a command that run simctl, xcodebuild or board-browser.mjs are checked, so text
# that mentions them (a note, a commit message) passes. A part that runs a script (bash/zsh/sh FILE)
# is checked with the script's text, which is where a test script keeps its simulator id.
cmd=$(jq -r '.tool_input.command // ""')
printf '%s' "$cmd" | grep -Eq 'simctl|xcodebuild|board-browser|(^|[[:space:]])(ba|z)?sh[[:space:]]' || exit 0

why='SideShift iOS is iPhone only: test, build for and show only iPhone simulators (or a real iPhone). This command targets an iPad simulator. If the iPhone simulator cannot do what the test needs (for example Picture in Picture), say it is not verified and what a real iPhone run needs; do not move to an iPad.'
deny() {
  jq -cn --arg why "$why" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$why}}'
  exit 0
}

# Leading variable settings and wrappers, then the program.
lead='^[[:space:]]*([({!][[:space:]]*)*(([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*|env|time|command|exec|nohup|then|do)[[:space:]]+)*'
runs_sim="${lead}"'(xcrun[[:space:]]+(simctl|xcodebuild)|([^[:space:]]*/)?xcodebuild|node[[:space:]]+[^[:space:]]*board-browser\.mjs)([[:space:]]|$)'
runs_script="${lead}"'([^[:space:]]*/)?(ba|z)?sh[[:space:]]+([^-[:space:]][^[:space:]]*)'

checked=""
while IFS= read -r part; do
  if printf '%s' "$part" | grep -Eq -- "$runs_sim"; then
    checked+="$part"$'\n'
  elif printf '%s' "$part" | grep -Eq -- "$runs_script"; then
    # Group 6 of runs_script is the script path (groups 1–3 are in lead).
    file=$(printf '%s' "$part" | sed -E "s#${runs_script}.*#\\6#")
    file=${file/#\~/$HOME}
    if [ -f "$file" ] && grep -Eq 'simctl|xcodebuild|board-browser' "$file"; then
      checked+="$part"$'\n'"$(grep -E 'simctl|xcodebuild|board-browser|[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-' "$file")"$'\n'
    fi
  fi
done < <(printf '%s\n' "$cmd" | tr ';&|' '\n\n\n')
[ -n "$checked" ] || exit 0

# By name or device type.
printf '%s' "$checked" | grep -Eqi 'ipad' && deny

# By UDID: compare against the iPad simulators on this Mac, cached for 10 minutes.
udids=$(printf '%s' "$checked" | grep -Eo '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}' | tr 'a-f' 'A-F')
[ -n "$udids" ] || exit 0
cache="$HOME/.cache/claude-hooks/ipad-udids.txt"
if [ ! -f "$cache" ] || [ -n "$(find "$cache" -mmin +10 2>/dev/null)" ]; then
  mkdir -p "${cache%/*}"
  xcrun simctl list devices -j 2>/dev/null \
    | jq -r '.devices[][] | select(.deviceTypeIdentifier | test("iPad")) | .udid' > "$cache.tmp" \
    && mv "$cache.tmp" "$cache"
fi
for u in $udids; do
  grep -qx "$u" "$cache" 2>/dev/null && deny
done
exit 0
