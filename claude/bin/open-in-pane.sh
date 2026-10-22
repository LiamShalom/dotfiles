#!/bin/bash
#
# open-in-pane.sh — show pages and files in Session Board's browser pane, not in the
# default browser (Arc). A target the pane cannot take, or every target when the
# board is not running, opens with macOS `open` as before.
#
# The open-to-pane hook rewrites a session's `open <page>` to this, and the visual
# companion runs it through BRAINSTORM_OPEN_CMD.
#
# Usage:  open-in-pane.sh [--note "what to look at"] <url | file | folder>...
note=""
if [ "${1:-}" = "--note" ]; then
	note="$2"
	shift 2
fi
board="$HOME/session-board/scripts/board-browser.mjs"
status=0
for target in "$@"; do
	if [ -f "$board" ] && node "$board" "$target" "$note"; then
		continue
	fi
	echo "open-in-pane: opening $target with macOS open instead" >&2
	/usr/bin/open "$target" || status=1
done
exit $status
