#!/bin/bash
#
# heavy-gate.sh — PreToolUse hook on Bash for Claude Code and Codex. Caps
# Vitest workers and queues heavy jobs (see heavy-classify.mjs and bin/heavy),
# and refuses a new dev server when the machine already runs its
# share (launch-gate.mjs). Other commands pass through untouched.
#
# Claude Code replaces the whole tool input with updatedInput, so every
# original field is copied and only `command` changes. Codex applies a
# rewrite only together with an "allow" decision: pass --codex.
#
# Usage (settings): bash ~/.claude/hooks/heavy-gate.sh [--codex]
input=$(cat)
cmd=$(jq -r '.tool_input.command | if type == "string" then . else empty end' <<<"$input" 2>/dev/null)
[ -n "$cmd" ] || exit 0
log="/tmp/agent-heavy-$(id -u)/hook.log"

# Installs and dev servers write gigabytes but are not queued jobs, so the disk
# check for them happens here (queued jobs check it in bin/heavy).
# Match only where a command starts (start of line or after ; & | ( ), optionally
# after VAR=value prefixes, so a commit message or search text that names
# `npm ci` is not refused.
at_start='(^|[;&|(])[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*'
disk_level=""
if [[ "$cmd" =~ ${at_start}(npm[[:space:]]+ci|(pnpm|yarn|bun)[[:space:]]+(install|i))([[:space:]]|$) ]]; then
	disk_level=heavy
elif [[ "$cmd" =~ ${at_start}(npm[[:space:]]+(install|i|add)|(pnpm|yarn|bun)[[:space:]]+add)([[:space:]]|$) ]]; then
	dir=$(jq -r '.cwd // empty' <<<"$input")
	[ -d "${dir:-$PWD}/node_modules" ] && disk_level=light || disk_level=heavy
elif [[ "$cmd" =~ ${at_start}((npx[[:space:]]+)?next[[:space:]]+dev|(npm|pnpm|yarn|bun)[[:space:]]+(run[[:space:]]+)?dev)([[:space:]]|:|$) ]]; then
	disk_level=light
fi
if [ -n "$disk_level" ] && [ -x "$HOME/.claude/bin/disk-guard" ]; then
	reason=$("$HOME/.claude/bin/disk-guard" "$disk_level" 2>&1)
	if [ $? -ne 0 ]; then
		jq -nc --arg r "$reason" '{hookSpecificOutput: {hookEventName: "PreToolUse",
			permissionDecision: "deny", permissionDecisionReason: $r}}'
		exit 0
	fi
fi

# Cheap filters first: almost every command never names one of these tools.
case "$cmd" in
	*next\ dev* | *run\ dev* | *pnpm\ dev* | *yarn\ dev* | *bun\ dev* | *emulator\ *)
		reason=$(node "$HOME/.claude/hooks/launch-gate.mjs" "$cmd" 2>/dev/null)
		if [ -n "$reason" ]; then
			mkdir -p "$(dirname "$log")"
			printf '%s %s\n  refused: %s\n' "$(date '+%F %T')" "${1:-claude}" "$cmd" >>"$log"
			jq -nc --arg r "$reason" '{hookSpecificOutput: {hookEventName: "PreToolUse",
				permissionDecision: "deny", permissionDecisionReason: $r}}'
			exit 0
		fi
		;;
esac

# A command that names an iOS simulator or Android device records which session used it last, so
# Session Board shows it in the session's pane. sim-owner.mjs runs in the background: the command
# never waits for it.
case "$cmd" in
	*simctl* | *xcodebuild* | *adb\ * | *emulator\ *)
		owner="$HOME/session-board/scripts/sim-owner.mjs"
		session=$(jq -r '.session_id // empty' <<<"$input" 2>/dev/null)
		if [ "${1:-}" != "--codex" ] && [ -n "$session" ] && [ -f "$owner" ]; then
			(node "$owner" "$session" "$cmd" >/dev/null 2>&1 &)
		fi
		;;
esac

new=""
case "$cmd" in
	*vitest* | *npm\ test* | *npm\ t\ * | *"npm run"* | *pnpm* | *yarn* | *next\ build* | *tsc* | *eslint* | *xcodebuild* | *agent-preflight*)
		cwd=$(jq -r '.cwd // empty' <<<"$input")
		new=$(node "$HOME/.claude/hooks/heavy-classify.mjs" "$cmd" "${cwd:-$PWD}" 2>/dev/null)
		rc=$?
		# Exit 3: the classifier refuses the command (a whole-repo type check that CI runs).
		if [ "$rc" -eq 3 ] && [ -n "$new" ]; then
			mkdir -p "$(dirname "$log")"
			printf '%s %s\n  refused: %s\n' "$(date '+%F %T')" "${1:-claude}" "$cmd" >>"$log"
			jq -nc --arg r "$new" '{hookSpecificOutput: {hookEventName: "PreToolUse",
				permissionDecision: "deny", permissionDecisionReason: $r}}'
			exit 0
		fi
		[ "$rc" -eq 0 ] || new=""
		;;
esac

# Electron apps launched by an e2e run (Session Board's suite on any branch) stay invisible and
# never take focus. e2e-electron-hidden.cjs only touches the spawn of an Electron binary and that
# Electron's windows; any other command runs as before.
# Codex applies a rewrite only with an "allow", so there it rewrites only a plain e2e command
# (an optional `cd <dir> &&`, then the e2e command, with no other shell operators).
plain_e2e='^(cd [^;&|`$()<>]+ && )?(npx playwright test|npm run e2e|npm run test:e2e)([^;&|`$()]*)$'
case "$cmd" in
	*playwright\ test* | *run\ e2e* | *run\ test:e2e*)
		if [ "${1:-}" != "--codex" ] || [[ "$cmd" =~ $plain_e2e ]]; then
			hidden="$HOME/.claude/hooks/e2e-electron-hidden.cjs"
			new="export NODE_OPTIONS=\"--require=$hidden\${NODE_OPTIONS:+ \$NODE_OPTIONS}\"; ${new:-$cmd}"
		fi
		;;
esac
[ -n "$new" ] || exit 0

mkdir -p "$(dirname "$log")"
printf '%s %s\n  before: %s\n  after:  %s\n' "$(date '+%F %T')" "${1:-claude}" "$cmd" "$new" >>"$log"

if [ "${1:-}" = "--codex" ]; then
	jq -c --arg c "$new" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "allow",
		updatedInput: (.tool_input + {command: $c})}}' <<<"$input"
else
	jq -c --arg c "$new" '{hookSpecificOutput: {hookEventName: "PreToolUse",
		updatedInput: (.tool_input + {command: $c})}}' <<<"$input"
fi
