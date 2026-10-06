#!/bin/bash
#
# agent-chrome.sh — start the one Chrome that every agent session shares, or
# confirm it is already running. Prints its DevTools URL on success.
#
# Agents (the chrome-devtools MCP server and ad-hoc CDP scripts) attach to this
# browser instead of launching their own, so the Dock holds one agent Chrome
# however many sessions run. A second login goes in an isolated browser
# context inside it, not in a second browser.
#
# Chrome is started through LaunchServices (`open`), not as a child of the
# caller, so it outlives the Claude session that started it.
#
# Usage:  agent-chrome.sh          # prints http://127.0.0.1:9222
set -euo pipefail

PORT="${AGENT_CHROME_PORT:-9222}"
PROFILE="${AGENT_CHROME_PROFILE:-$HOME/.cache/agent-chrome/profile}"
URL="http://127.0.0.1:$PORT"
LOCK="$PROFILE.lock"

up() { curl -fsS --max-time 2 "$URL/json/version" >/dev/null 2>&1; }

if up; then
	echo "$URL"
	exit 0
fi

# Two sessions starting at once must not both launch Chrome.
mkdir -p "$(dirname "$PROFILE")"
for _ in $(seq 1 100); do
	mkdir "$LOCK" 2>/dev/null && break
	# A lock older than a minute belongs to a launcher that died.
	[ -n "$(find "$LOCK" -maxdepth 0 -mmin +1 2>/dev/null)" ] && rmdir "$LOCK" 2>/dev/null
	sleep 0.2
done
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

if ! up; then
	mkdir -p "$PROFILE"
	# The flags puppeteer gave the browser chrome-devtools-mcp used to launch,
	# so pages behave the same: background tabs are not throttled (screenshots
	# of a tab that is not in front still work), and the mock keychain stops
	# Chrome asking for Keychain access. --no-startup-window because Chrome
	# brings itself to the front when it opens its first window, even with
	# `open -g`; the first window now comes from a background tab instead.
	open -g -n -a "Google Chrome" --args \
		--remote-debugging-port="$PORT" \
		--user-data-dir="$PROFILE" \
		--no-startup-window \
		--no-first-run --no-default-browser-check \
		--allow-pre-commit-input --disable-background-networking \
		--disable-background-timer-throttling --disable-backgrounding-occluded-windows \
		--disable-breakpad --disable-client-side-phishing-detection \
		--disable-component-extensions-with-background-pages --disable-crash-reporter \
		--disable-default-apps --disable-dev-shm-usage --disable-hang-monitor \
		--disable-infobars --disable-ipc-flooding-protection --disable-popup-blocking \
		--disable-prompt-on-repost --disable-renderer-backgrounding \
		--disable-search-engine-choice-screen --disable-sync --enable-automation \
		--export-tagged-pdf --force-color-profile=srgb --generate-pdf-document-outline \
		--metrics-recording-only --password-store=basic --use-mock-keychain \
		--disable-features=Translate,AcceptCHFrame,MediaRouter,OptimizationHints,WebUIReloadButton,WebUIOmniboxPopup,WebUIOmniboxAimPopup,ProcessPerSiteUpToMainFrameThreshold,IsolateSandboxedIframes \
		--enable-features=PdfOopif --disable-extensions --hide-crash-restore-bubble
	for _ in $(seq 1 75); do
		up && break
		sleep 0.2
	done
fi

if up; then
	echo "$URL"
	exit 0
fi
echo "agent-chrome: Chrome did not open $URL" >&2
exit 1
