#!/bin/bash
# chrome-reaper.sh — kill agent CDP browsers left running, and prune their profiles.
#
# The leak: a headless Chrome started for verification work
# (--headless --user-data-dir=/tmp/chrome-*) takes a "Capturing"
# NoDisplaySleepAssertion the first time anything screenshots through CDP, and
# never releases it. On 2026-09-18 one held that assertion for 93h48m; macOS
# watchdog-killed WindowServer three times in the four days that followed
# (Sep 18/19/21), each while the display was asleep, each surfacing at next
# login as "WindowServer experienced a problem". Every abandoned profile also
# parks ~100MB in /tmp (2.5GB across 25 dirs by day four).
#
# Safety rails — a browser is killed ONLY if ALL hold:
#   - its command line contains --headless      (never a real Chrome window)
#   - its --user-data-dir is under /tmp         (never a real profile)
#   - it is not a Helper/renderer subprocess    (kill the browser, children follow)
#   - it has been running longer than MAX_AGE_HOURS
#   - nothing is connected to its --remote-debugging-port
#
# That last rail is what makes this "idle for a day" rather than "old": a
# browser an agent is actively driving holds an ESTABLISHED connection on its
# debug port and is left alone however old it is.
#
# A profile dir is deleted ONLY if it matches /tmp/chrome-* or /tmp/cdp-*, is
# not the --user-data-dir of any live process, and has not been modified in
# MAX_AGE_HOURS. Note mtime is useless as an idle signal while the browser
# lives — Chrome keeps touching its own profile even when abandoned (the
# 4-day-old refdrive profile had an mtime of minutes ago). It only becomes
# meaningful once the process is gone, which is why the kill pass runs first.

set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

MAX_AGE_HOURS="${MAX_AGE_HOURS:-24}"
DRY_RUN="${DRY_RUN:-0}"

LOG_DIR="$HOME/.claude/logs"
LOG="$LOG_DIR/chrome-reaper.log"
mkdir -p "$LOG_DIR"

# Keep the log bounded: trim to the last 2000 lines on each run.
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 2000 ]; then
  tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"; }

MAX_AGE_SECS=$(( MAX_AGE_HOURS * 3600 ))
MAX_AGE_MINS=$(( MAX_AGE_HOURS * 60 ))
NOW=$(date +%s)

# Age of a pid in seconds. BSD ps has no etimes, so convert lstart to epoch.
proc_age() {
  local started start
  started=$(ps -o lstart= -p "$1" 2>/dev/null | tr -s ' ' | sed 's/^ *//;s/ *$//')
  [ -n "$started" ] || return 1
  start=$(date -j -f "%a %b %e %T %Y" "$started" +%s 2>/dev/null) || return 1
  echo $(( NOW - start ))
}

# True when some client holds a connection to the debug port. LISTEN alone does
# not count, so an abandoned browser reads as idle.
port_busy() {
  [ -n "$1" ] || return 1
  lsof -nP -iTCP:"$1" -sTCP:ESTABLISHED >/dev/null 2>&1
}

log "=== chrome-reaper start (max_age ${MAX_AGE_HOURS}h, dry_run=${DRY_RUN}) ==="

# ---------------------------------------------------------------------------
# Pass 1 — kill abandoned headless browsers.
# ---------------------------------------------------------------------------
KILLED=0
# `read pid cmd` and not a manual split: ps pads the pid column with leading
# spaces, which silently empties a "${line%% *}" style split.
while read -r pid cmd; do
  [ -n "$pid" ] || continue

  case "$cmd" in *--headless*) ;;           *) continue ;; esac
  case "$cmd" in *--user-data-dir=/tmp/*) ;; *) continue ;; esac
  case "$cmd" in *Helper*) continue ;; esac

  age=$(proc_age "$pid") || continue
  [ "$age" -ge "$MAX_AGE_SECS" ] || continue

  port=$(printf '%s\n' "$cmd" | sed -n 's/.*--remote-debugging-port=\([0-9]*\).*/\1/p')
  udd=$(printf '%s\n' "$cmd" | sed -n 's/.*--user-data-dir=\([^ ]*\).*/\1/p')

  if port_busy "$port"; then
    log "SKIP pid $pid ($((age/3600))h, $udd) — CDP client still attached on port $port"
    continue
  fi

  log "KILL pid $pid ($((age/3600))h idle, profile ${udd:-?}, port ${port:-none})"
  if [ "$DRY_RUN" = "1" ]; then
    log "  DRY-RUN would: kill $pid"
  else
    kill "$pid" 2>/dev/null
    sleep 3
    if kill -0 "$pid" 2>/dev/null; then
      log "  survived SIGTERM — escalating to SIGKILL"
      kill -9 "$pid" 2>/dev/null
    fi
  fi
  KILLED=$(( KILLED + 1 ))
done <<< "$(ps -ewwo pid=,command=)"

# ---------------------------------------------------------------------------
# Pass 2 — prune profiles no live browser owns.
# ---------------------------------------------------------------------------
LIVE_UDD=$(ps -ewwo command= | sed -n 's/.*--user-data-dir=\([^ ]*\).*/\1/p' | sort -u)

PRUNED=0
for path in /tmp/chrome-* /tmp/cdp-*; do
  [ -e "$path" ] || continue
  case "$path" in /tmp/chrome-*|/tmp/cdp-*) ;; *) continue ;; esac

  if [ -n "$LIVE_UDD" ] && printf '%s\n' "$LIVE_UDD" | grep -qxF "$path"; then
    log "SKIP $path — in use by a live browser"
    continue
  fi

  [ -n "$(find "$path" -maxdepth 0 -mmin +"$MAX_AGE_MINS" 2>/dev/null)" ] || continue

  size=$(du -sh "$path" 2>/dev/null | cut -f1)
  log "PRUNE $path (${size:-?})"
  if [ "$DRY_RUN" = "1" ]; then
    log "  DRY-RUN would: rm -rf $path"
  else
    rm -rf "$path"
  fi
  PRUNED=$(( PRUNED + 1 ))
done

log "=== chrome-reaper done (killed ${KILLED}, pruned ${PRUNED}, free $(df -g /System/Volumes/Data | awk 'NR==2 {print $4}')GB) ==="
