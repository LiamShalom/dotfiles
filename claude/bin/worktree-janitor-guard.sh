#!/bin/bash
# worktree-janitor-guard.sh — fire the janitor early when disk drops fast.
#
# Why this exists: the daily 04:00 run is not enough on heavy days. On 2026-08-19
# the volume went 88GB free (post-janitor, 08:19) -> 2.5GB free (17:47) in nine
# hours, because a handful of parallel Next dev builds each grew a 5-12GB .next.
# A once-a-day schedule cannot see that; by the time it runs, writes have already
# started failing with ENOSPC.
#
# This runs often but is nearly always a no-op: it exits immediately unless free
# space is already below TRIGGER_GB, so it costs one `df` most of the time.

export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

TRIGGER_GB="${TRIGGER_GB:-60}"
LOG="$HOME/.claude/logs/worktree-janitor.log"

free=$(df -g /System/Volumes/Data | awk 'NR==2 {print $4}')
[ -n "$free" ] || exit 0
[ "$free" -ge "$TRIGGER_GB" ] && exit 0

printf '%s guard: free %sGB < %sGB trigger — running janitor\n' \
  "$(date '+%Y-%m-%d %H:%M:%S')" "$free" "$TRIGGER_GB" >> "$LOG"

exec "$HOME/.claude/bin/worktree-janitor.sh"
