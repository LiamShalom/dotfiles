#!/bin/bash
# Every session runs this on each refresh, so ~30 sessions run it at once. Keep it
# to one jq and shell builtins: on 2026-10-21 the old version started ~50
# processes per run (a cut per field, git status every second), which at
# refreshInterval 1 was ~1,400 processes/s and 80% kernel CPU on this Mac.

ESC=$'\033'

# One jq pass over stdin. @sh quotes each value, so the eval is safe.
eval "$(jq -r '
  def pct: if . == null or . == "" then "" else (tonumber | round | tostring) end;
  (.rate_limits.five_hour.resets_at // null | tonumber? // null) as $rst
  | @sh "model=\(.model.display_name // "?")",
    @sh "effort=\(.effort.level // "")",
    @sh "ctx=\(.context_window.used_percentage | pct)",
    @sh "five_h=\(.rate_limits.five_hour.used_percentage | pct)",
    @sh "clock=\(if $rst then ($rst | strflocaltime("%l:%M%p") | ascii_downcase | gsub(" "; "")) else "" end)",
    @sh "weekly=\(.rate_limits.seven_day.used_percentage | pct)",
    @sh "added=\(.cost.total_lines_added // 0 | tostring)",
    @sh "removed=\(.cost.total_lines_removed // 0 | tostring)",
    @sh "sess=\(.session_name // "")",
    @sh "cwd=\(.cwd // "")",
    @sh "sess_id=\(.session_id // "")",
    @sh "now_s=\(now | floor | tostring)",
    # --- usage sensor (weekly cap) ---------------------------------------------
    # statusLine stdin is the ONLY place rate_limits.* is exposed; hooks never see
    # it, so it is mirrored to a state file for the cap hook. Only when present:
    # through the gateway it is always null, and rewriting nulls every run is churn.
    @sh "usage_json=\(if .rate_limits then {
        ts: (now | floor),
        seven_day: (.rate_limits.seven_day.used_percentage // null),
        seven_day_resets_at: (.rate_limits.seven_day.resets_at // null),
        five_hour: (.rate_limits.five_hour.used_percentage // null)
      } | tojson else "" end)"
' 2>/dev/null)"

if [ -n "$usage_json" ]; then
  printf '%s' "$usage_json" > "$HOME/.claude/usage-state.json.tmp" 2>/dev/null \
    && mv -f "$HOME/.claude/usage-state.json.tmp" "$HOME/.claude/usage-state.json" 2>/dev/null
fi

# --- Colors -----------------------------------------------------------------
# Every item between the | separators is a single flat color of its own.
RST="${ESC}[0m"
BOLD="${ESC}[1m"
DIM="${ESC}[38;5;244m"          # grey — separators only

C_MODEL="${ESC}[38;5;39m"       # azure
C_CTX="${ESC}[38;5;221m"        # gold
C_5H="${ESC}[38;5;79m"          # aqua
C_WK="${ESC}[38;5;141m"         # purple
C_GIT="${ESC}[38;5;213m"        # orchid
GREEN="${ESC}[38;5;78m"         # lines added
RED="${ESC}[38;5;203m"          # lines removed
C_DIR="${ESC}[38;5;215m"        # orange
C_SESS="${ESC}[38;5;180m"       # tan
C_ID="${ESC}[38;5;108m"         # sage
SEP="${DIM} │ ${RST}"

# Render "<label> N%" (or "<label> --") entirely in one color into $REPLY.
pct_str() { # $1=label $2=value $3=color $4=suffix
  if [ -n "$2" ]; then
    REPLY="${3}$1 $2%${4}${RST}"
  else
    REPLY="${3}$1 --${RST}"
  fi
}

# Model + effort — one color
model_str="${C_MODEL}${BOLD}${model}${RST}"
if [ -n "$effort" ]; then
  model_str="${C_MODEL}${BOLD}${model}${RST}${C_MODEL} ${effort}${RST}"
fi

# 5h reset clock (local time, e.g. ↻9:10pm) — same color as the 5h item
reset_str=""
[ -n "$clock" ] && reset_str=" ↻${clock}"

pct_str "ctx" "$ctx" "$C_CTX"; ctx_str=$REPLY
pct_str "5h" "$five_h" "$C_5H" "$reset_str"; five_h_str=$REPLY
pct_str "wk" "$weekly" "$C_WK"; weekly_str=$REPLY

# Git branch + dirty marker — one color. The branch is read from HEAD directly.
# The dirty check is the one expensive part (git status stats every tracked
# file), so it runs at most every 30 s per checkout, shared by every session in
# it, and without the optional index lock that blocks other git commands.
git_str=""
top=$cwd
while [ -n "$top" ] && [ ! -e "$top/.git" ]; do top=${top%/*}; done
if [ -n "$top" ]; then
  gd="$top/.git"
  if [ -f "$gd" ]; then
    IFS= read -r gd < "$gd"
    gd=${gd#gitdir: }
    case $gd in /*) ;; *) gd="$top/$gd" ;; esac
  fi
  head=""
  IFS= read -r head < "$gd/HEAD" 2>/dev/null
  case $head in
    "ref: refs/heads/"*)
      branch=${head#ref: refs/heads/}
      dir="$HOME/.claude/statusline-cache/git"
      key=${gd//\//%}
      ts=0 mark=""
      [ -f "$dir/$key" ] && read -r ts mark < "$dir/$key"
      if [ -z "$mark" ] || [ $((now_s - ts)) -ge 30 ]; then
        if [ -n "$(git --no-optional-locks -C "$top" status --porcelain --untracked-files=no 2>/dev/null)" ]; then
          mark="✗"
        else
          mark="✓"
        fi
        [ -d "$dir" ] || mkdir -p "$dir" 2>/dev/null
        printf '%s %s\n' "$now_s" "$mark" > "$dir/$key" 2>/dev/null
      fi
      git_str="${C_GIT}${branch} ${mark}${RST}"
      ;;
  esac
fi

# Lines changed this session — green added / red removed
lines_str="${GREEN}+${added}${RST}${DIM}/${RST}${RED}-${removed}${RST}"

# Directory: ~ for $HOME, keep only last 2 segments if deep
if [ -n "$cwd" ]; then
  short_cwd="${cwd#"$HOME"}"
  [ "$short_cwd" != "$cwd" ] && short_cwd="~$short_cwd"
else
  short_cwd="$PWD"
fi
not_slash='[!/]'
slashes=${short_cwd//$not_slash/}
if [ $(( ${#slashes} + 1 )) -gt 4 ]; then
  rest=${short_cwd%/*}
  short_cwd="…/${rest##*/}/${short_cwd##*/}"
fi
dir_str="${C_DIR}${short_cwd}${RST}"

# Assemble (skip empty optional segments)
line="${model_str}${SEP}${ctx_str}${SEP}${five_h_str}${SEP}${weekly_str}"
[ -n "$git_str" ] && line="${line}${SEP}${git_str}"
line="${line}${SEP}${lines_str}${SEP}${dir_str}"
[ -n "$sess" ] && line="${line}${SEP}${C_SESS}${sess}${RST}"
[ -n "$sess_id" ] && line="${line}${SEP}${C_ID}${sess_id}${RST}"

# --- cache for the session-chrome mod ----------------------------------------
# Claude Code hides this bar while a question dialog is open; the mod draws the
# cached line there, and reads the name to make a bare /clear drop it. Written
# only when it changes; JSON is escaped here to avoid a second jq.
json_str() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$ESC/\\u001b}
  s=${s//$'\t'/\\t}
  s=${s//$'\n'/\\n}
  REPLY="\"$s\""
}
if [ -n "$sess_id" ]; then
  cache="$HOME/.claude/statusline-cache"
  json_str "$line"; j_line=$REPLY
  json_str "$sess"; j_name=$REPLY
  new="{\"line\":${j_line},\"name\":${j_name}}"
  old=""
  [ -f "$cache/$sess_id.json" ] && IFS= read -r old < "$cache/$sess_id.json"
  if [ "$old" != "$new" ]; then
    [ -d "$cache" ] || mkdir -p "$cache" 2>/dev/null
    printf '%s\n' "$new" > "$cache/$sess_id.json.tmp" 2>/dev/null \
      && mv -f "$cache/$sess_id.json.tmp" "$cache/$sess_id.json" 2>/dev/null
  fi
fi
# ----------------------------------------------------------------------------

printf '%s' "$line"
