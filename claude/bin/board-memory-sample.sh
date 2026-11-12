#!/bin/bash
#
# board-memory-sample.sh — record Session Board's memory once an hour, to tell a
# leak (memory climbs with uptime) from load (memory follows the number of open
# windows). launchd runs it hourly (launchd/com.sideshift.board-memory.plist).
#
# Each line: time, app uptime in hours, processes, total footprint GB,
# biggest process GB and its kind, renderers (windows, tiles, panes).
# Footprint is what Activity Monitor shows (top's MEM), not RSS.
#
# Usage:  board-memory-sample.sh            append one sample
#         board-memory-sample.sh --report   print the log with GB gained per uptime hour
set -uo pipefail
LOG="${BOARD_MEMORY_LOG:-$HOME/.claude/logs/session-board-memory.log}"

if [ "${1:-}" = "--report" ]; then
	[ -s "$LOG" ] || { echo "no samples yet in $LOG"; exit 0; }
	awk -F'\t' '
		{ print }
		$2 + 0 > 0 { if (!seen || $2 + 0 < up) { first = $4; up0 = $2 }; up = $2; last = $4; lastup = $2; seen = 1 }
		END {
			if (seen && lastup > up0)
				printf "\nsince the last app start: %.2f GB over %.1f h = %.2f GB per hour\n", last - first, lastup - up0, (last - first) / (lastup - up0)
		}' "$LOG"
	exit 0
fi

# The relay and stream helpers run the same binary with a script argument; the app has none.
main=$(pgrep -fx "/Applications/Session Board.app/Contents/MacOS/Session Board" | head -1)
if [ -z "$main" ]; then
	printf '%s\tnot running\n' "$(date '+%F %H:%M')" >>"$LOG"
	exit 0
fi
etime=$(ps -o etime= -p "$main" | tr -d ' ')
pids=$(pgrep -f "/Applications/Session Board.app/" | tr '\n' ' ')

top -l 1 -n 5000 -stats pid,mem 2>/dev/null | awk -v want=" $pids" -v etime="$etime" -v when="$(date '+%F %H:%M')" '
	function gb(v) { if (v ~ /G/) return v + 0; if (v ~ /M/) return (v + 0) / 1024; if (v ~ /K/) return (v + 0) / 1048576; return (v + 0) / 1073741824 }
	function hours(e,   d, p, n) {
		d = 0
		if (index(e, "-")) { split(e, p, "-"); d = p[1]; e = p[2] }
		n = split(e, p, ":")
		if (n == 3) return d * 24 + p[1] + p[2] / 60
		return d * 24 + p[1] / 60
	}
	/^PID/ { on = 1; next }
	on && $1 ~ /^[0-9]+$/ && index(want, " " $1 " ") { g = gb($2); total += g; n++; mem[$1] = g; if (g > big) { big = g; bigpid = $1 } }
	END { printf "%s\t%.1f\t%d\t%.2f\t%.2f\t%s\n", when, hours(etime), n, total, big, bigpid }
' >"$LOG.tmp"

read -r when_d when_t up n total big bigpid <"$LOG.tmp"
kind=$(ps -o command= -p "$bigpid" 2>/dev/null | grep -oE -- '--type=[a-z-]+' | head -1)
renderers=$(pgrep -f "Session Board Helper \(Renderer\)" | wc -l | tr -d ' ')
printf '%s %s\t%s\t%s\t%s\t%s\t%s\trenderers=%s\n' "$when_d" "$when_t" "$up" "$n" "$total" "$big" "${kind:-main}" "$renderers" >>"$LOG"
rm -f "$LOG.tmp"
