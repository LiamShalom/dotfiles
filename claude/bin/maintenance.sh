#!/bin/bash
#
# maintenance.sh — keep this Mac's disk and memory clean for Claude Code and
# Codex alike. launchd runs it (launchd/*.plist, loaded by install.sh); it can
# also be run by hand.
#
#   sweep   every 15 min  worktrees of merged/closed PRs, in every repo; abandoned
#                         headless agent Chromes (memory); a full janitor run if
#                         free disk drops under TRIGGER_GB
#   daily   04:00         stale .next caches, node_modules of worktrees idle
#                         IDLE_DAYS, old npx installs
#   weekly  Sun 03:30     retire worktrees idle RETIRE_DAYS (branch kept, changes
#                         archived); deep clean of every regenerable cache (all
#                         idle .next and node_modules, Xcode DerivedData, simulator
#                         clones, updater caches); Homebrew cleanup; Docker build
#                         cache; old worktree archives; a Brewfile drift report
#   status                last runs, free disk, worktree counts
#
# The janitor (worktree-janitor.sh) holds every safety rail: it never removes a
# worktree with an open PR, unpushed commits, a process inside, or recent edits,
# and archives uncommitted changes before any removal. Codex-managed worktrees
# are never removed here (the Codex app does that with its own snapshots).
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

MODE="${1:-status}"
REPOS_FILE="${REPOS_FILE:-$HOME/dotfiles/migrate/repos.txt}"
JANITOR="$HOME/.claude/bin/worktree-janitor.sh"
LOG="$HOME/.claude/logs/maintenance.log"
TRIGGER_GB="${TRIGGER_GB:-80}"
ARCHIVE_KEEP_DAYS="${ARCHIVE_KEEP_DAYS:-60}"
mkdir -p "$(dirname "$LOG")"

log() { printf '%s [%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$MODE" "$*" >>"$LOG"; }
free_gb() { df -g /System/Volumes/Data | awk 'NR==2 {print $4}'; }

# Run the janitor once per repo from repos.txt. Extra arguments are env settings.
janitor_all() {
	local name remote gh
	while read -r name remote; do
		case "$name" in '' | '#'*) continue ;; esac
		[ -d "$HOME/$name/.git" ] || continue
		gh=$(printf '%s' "$remote" | sed -E 's#^(git@github\.com:|https://github\.com/)##; s#\.git$##')
		env REPO="$HOME/$name" GH_REPO="$gh" "$@" "$JANITOR" >/dev/null 2>&1 ||
			log "janitor failed for $name ($*)"
	done <"$REPOS_FILE"
}

case "$MODE" in
sweep)
	janitor_all MODE=merged
	"$HOME/.claude/bin/chrome-reaper.sh" >/dev/null 2>&1
	if [ "$(free_gb)" -lt "$TRIGGER_GB" ]; then
		log "free $(free_gb)GB < ${TRIGGER_GB}GB: running a full janitor pass"
		janitor_all MODE=full
	fi
	;;
daily)
	start=$(free_gb)
	janitor_all MODE=full IDLE_DAYS="${IDLE_DAYS:-3}"
	log "free ${start}GB -> $(free_gb)GB"
	;;
weekly)
	start=$(free_gb)
	janitor_all MODE=idle RETIRE_DAYS="${RETIRE_DAYS:-14}"
	# PRESSURE_GB above any real free space forces the janitor's deep passes.
	janitor_all MODE=full PRESSURE_GB=1000000 PRESSURE_IDLE_DAYS=1

	drift=$(brew bundle cleanup --file="$HOME/dotfiles/Brewfile" 2>/dev/null |
		awk '/^Would uninstall/ {on=1; next} /^Would/ {on=0} on && $1 != "corepack"' | tr '\n' ' ')
	[ -n "$drift" ] && log "installed but not in the Brewfile: $drift"
	old_archives=$(find "$HOME/.claude/worktree-archive" -mindepth 1 -maxdepth 1 -type d \
		-mtime "+$ARCHIVE_KEEP_DAYS" 2>/dev/null)

	if [ "${DRY_RUN:-0}" = 1 ]; then
		log "DRY-RUN would: brew cleanup --prune=all ($(brew cleanup --prune=all -n 2>/dev/null | tail -1))"
		log "DRY-RUN would: brew autoremove, prune Docker build cache, delete $(printf '%s' "$old_archives" | grep -c .) old worktree archives"
	else
		brew cleanup --prune=all >/dev/null 2>&1
		brew autoremove >/dev/null 2>&1
		if docker info >/dev/null 2>&1; then
			docker builder prune --force --filter until=168h >/dev/null 2>&1
			docker image prune --force >/dev/null 2>&1
		fi
		# Uncommitted changes the janitor archived before removing a worktree.
		printf '%s\n' "$old_archives" | while IFS= read -r d; do [ -n "$d" ] && rm -rf "$d"; done
	fi
	log "free ${start}GB -> $(free_gb)GB"
	;;
status)
	echo "free disk: $(free_gb)GB"
	while read -r name _; do
		case "$name" in '' | '#'*) continue ;; esac
		[ -d "$HOME/$name/.git" ] || continue
		n=$(git -C "$HOME/$name" worktree list | wc -l | tr -d ' ')
		echo "worktrees in $name: $((n - 1))"
	done <"$REPOS_FILE"
	echo
	echo "recent maintenance:"
	tail -n 8 "$LOG" 2>/dev/null
	echo
	echo "recent janitor:"
	grep -E "=== (janitor done|free)" "$HOME/.claude/logs/worktree-janitor.log" 2>/dev/null | tail -n 6
	;;
*)
	echo "usage: maintenance.sh sweep|daily|weekly|status" >&2
	exit 2
	;;
esac
