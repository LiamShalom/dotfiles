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
# A Claude desktop app session's operator looks at the app's own browser pane, which only the session's
# own browser tools can open: neither the board nor Arc is where they are looking.
if [ "${CLAUDE_CODE_ENTRYPOINT:-}" = "claude-desktop" ]; then
	echo "open-in-pane: this is a Claude desktop session; open $* in the app's browser pane with mcp__Claude_Browser__preview_start" >&2
	exit 1
fi
status=0
for target in "$@"; do
	if [ -f "$board" ] && node "$board" "$target" "$note"; then
		continue
	fi
	echo "open-in-pane: opening $target with macOS open instead" >&2
	/usr/bin/open "$target" || status=1
done
exit $status
