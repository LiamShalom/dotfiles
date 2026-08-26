#!/bin/sh
input=$(cat)

# --- usage sensor (weekly cap) ----------------------------------------------
# statusLine stdin is the ONLY place rate_limits.* is exposed; hooks never see
# it. Mirror it to a state file so the UserPromptSubmit/PreToolUse cap hook can
# read it. Best-effort: never fail or slow the status line.
printf '%s' "$input" | jq -c '{
  ts: (now | floor),
  seven_day: (.rate_limits.seven_day.used_percentage // null),
  seven_day_resets_at: (.rate_limits.seven_day.resets_at // null),
  five_hour: (.rate_limits.five_hour.used_percentage // null)
}' > "$HOME/.claude/usage-state.json.tmp" 2>/dev/null \
  && mv -f "$HOME/.claude/usage-state.json.tmp" "$HOME/.claude/usage-state.json" 2>/dev/null
# ----------------------------------------------------------------------------

# Single jq pass (tab-separated fields)
parsed=$(echo "$input" | jq -r '[
  (.model.display_name // "?"),
  (.effort.level // ""),
  (.context_window.used_percentage // "" | tostring),
  (.rate_limits.five_hour.used_percentage // "" | tostring),
  (.rate_limits.five_hour.resets_at // "" | tostring),
  (.rate_limits.seven_day.used_percentage // "" | tostring),
  (.cost.total_lines_added // 0 | tostring),
  (.cost.total_lines_removed // 0 | tostring),
  (.session_name // ""),
  (.cwd // ""),
  (.session_id // "")
] | join("\t")')

model=$(echo "$parsed"      | cut -f1)
effort=$(echo "$parsed"     | cut -f2)
ctx=$(echo "$parsed"        | cut -f3)
five_h=$(echo "$parsed"     | cut -f4)
five_h_rst=$(echo "$parsed" | cut -f5)
weekly=$(echo "$parsed"     | cut -f6)
added=$(echo "$parsed"      | cut -f7)
removed=$(echo "$parsed"    | cut -f8)
sess=$(echo "$parsed"       | cut -f9)
cwd=$(echo "$parsed"        | cut -f10)
sess_id=$(echo "$parsed"    | cut -f11)

# --- Colors -----------------------------------------------------------------
# Every item between the | separators is a single flat color of its own.
ESC=$(printf '\033')
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

# Render "<label> N%" (or "<label> --") entirely in one color. $3 = suffix.
pct_str() { # $1=label $2=value $3=color $4=suffix
  if [ -n "$2" ]; then
    p=$(printf "%.0f" "$2")
    printf '%s' "${3}$1 ${p}%${4}${RST}"
  else
    printf '%s' "${3}$1 --${RST}"
  fi
}

# Model + effort — one color
model_str="${C_MODEL}${BOLD}${model}${RST}"
if [ -n "$effort" ]; then
  model_str="${C_MODEL}${BOLD}${model}${RST}${C_MODEL} ${effort}${RST}"
fi

# 5h reset clock (local time, e.g. ↻9:10pm) — same color as the 5h item
reset_str=""
if [ -n "$five_h_rst" ]; then
  clock=$(date -r "$five_h_rst" '+%l:%M%p' 2>/dev/null | tr 'APM' 'apm' | tr -d ' ')
  [ -n "$clock" ] && reset_str=" ↻${clock}"
fi

ctx_str=$(pct_str "ctx" "$ctx" "$C_CTX")
five_h_str=$(pct_str "5h" "$five_h" "$C_5H" "$reset_str")
weekly_str=$(pct_str "wk" "$weekly" "$C_WK")

# Git branch + dirty marker — one color
git_str=""
if [ -n "$cwd" ]; then
  branch=$(git -C "$cwd" branch --show-current 2>/dev/null)
  if [ -n "$branch" ]; then
    if [ -n "$(git -C "$cwd" status --porcelain --untracked-files=no 2>/dev/null | head -1)" ]; then
      mark="✗"
    else
      mark="✓"
    fi
    git_str="${C_GIT}${branch} ${mark}${RST}"
  fi
fi

# Lines changed this session — green added / red removed
lines_str="${GREEN}+${added}${RST}${DIM}/${RST}${RED}-${removed}${RST}"

# Directory: ~ for $HOME, keep only last 2 segments if deep
if [ -n "$cwd" ]; then
  short_cwd="${cwd#$HOME}"
  [ "$short_cwd" != "$cwd" ] && short_cwd="~$short_cwd"
else
  short_cwd="$(pwd)"
fi
depth=$(printf '%s' "$short_cwd" | awk -F/ '{print NF}')
if [ "$depth" -gt 4 ]; then
  tail_path=$(printf '%s' "$short_cwd" | awk -F/ '{print $(NF-1)"/"$NF}')
  short_cwd="…/$tail_path"
fi
dir_str="${C_DIR}${short_cwd}${RST}"

# Assemble (skip empty optional segments)
line="${model_str}${SEP}${ctx_str}${SEP}${five_h_str}${SEP}${weekly_str}"
[ -n "$git_str" ] && line="${line}${SEP}${git_str}"
line="${line}${SEP}${lines_str}${SEP}${dir_str}"
[ -n "$sess" ] && line="${line}${SEP}${C_SESS}${sess}${RST}"
[ -n "$sess_id" ] && line="${line}${SEP}${C_ID}${sess_id}${RST}"

printf '%s' "$line"
