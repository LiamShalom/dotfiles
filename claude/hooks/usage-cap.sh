#!/bin/sh
# Weekly usage cap for Claude Code on the personal Claude subscription.
#
# WHY TWO PIECES: rate_limits.* is exposed ONLY to the statusLine command. It is
# absent from hook stdin (verified 2026-08-20, Claude Code 2.1.228). So
# statusline.sh acts as the sensor and mirrors it to ~/.claude/usage-state.json;
# this hook is the actuator that reads that file and blocks.
#
# FAIL-OPEN BY DESIGN: when .seven_day is null the session is not authenticated
# against the metered subscription (e.g. ANTHROPIC_AUTH_TOKEN points at a relay),
# so it cannot be spending the personal allowance and there is nothing to cap.
#
# Bypass:    touch ~/.claude/usage-cap-override
# Threshold: CLAUDE_WEEKLY_CAP_PCT=95 (default 90)

THRESHOLD="${CLAUDE_WEEKLY_CAP_PCT:-90}"
STATE="$HOME/.claude/usage-state.json"
OVERRIDE="$HOME/.claude/usage-cap-override"

in=$(cat)

[ -f "$OVERRIDE" ] && exit 0
[ -f "$STATE" ]    || exit 0

# Single jq pass. Stale state is only unsafe if it is OVER threshold, so an
# over-threshold reading is honoured until its reset timestamp has passed.
verdict=$(jq -r --argjson thr "$THRESHOLD" '
  (.seven_day // null) as $p
  | if   $p == null   then "allow"
    elif ($p < $thr)  then "allow"
    else
      (.seven_day_resets_at // null) as $r
      | ( if   $r == null        then null
          elif ($r | type) == "number" then $r
          else (try ($r | fromdateiso8601) catch null) end ) as $rt
      | if   $rt == null   then "block"
        elif (now >= $rt)  then "allow"
        else "block" end
    end' "$STATE" 2>/dev/null)

[ "$verdict" = "block" ] || exit 0

pct=$(jq -r '.seven_day // "?"' "$STATE" 2>/dev/null)
resets=$(jq -r '(.seven_day_resets_at // null)
  | if   . == null        then "unknown"
    elif type == "number" then strflocaltime("%a %d %b %H:%M")
    else (try (fromdateiso8601 | strflocaltime("%a %d %b %H:%M")) catch .) end' "$STATE" 2>/dev/null)
event=$(printf '%s' "$in" | jq -r '.hook_event_name // ""' 2>/dev/null)

msg="Weekly usage cap reached: ${pct}% of the weekly limit used, cap is ${THRESHOLD}%. Reserved headroom is being held for personal use on claude.ai. Resets at ${resets}. To override: touch ~/.claude/usage-cap-override"

case "$event" in
  PreToolUse)
    jq -nc --arg m "$msg. Stop now and report this to the user; do not retry." \
      '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$m}}'
    ;;
  *)
    jq -nc --arg m "$msg" '{decision:"block", reason:$m}'
    ;;
esac
exit 0
