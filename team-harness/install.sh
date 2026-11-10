#!/usr/bin/env bash
#
# install.sh — put the SideShift Claude Code harness in place on this Mac.
#
# It symlinks this folder's skills, hooks, agents, rules, mods and scripts into
# ~/.claude one item at a time, so `git pull` here updates them and your own
# items beside them stay. A real file in the way is moved to <name>.bak (or
# <name>.bak.<time> when that exists); nothing is deleted. Re-running is safe.
#
# Usage:
#   ./install.sh                  skills, hooks, agents, CLAUDE.md, settings
#   ./install.sh --with-mcp       also register the MCP servers (Linear, Jam, ...)
#   ./install.sh --with-launchd   also load the scheduled cleanup + shared DB MCP jobs
#
# Env: MONOREPO=<path>  where sideshift-monorepo is checked out (default ~/sideshift-monorepo)
set -euo pipefail

HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
C="$HARNESS/claude"
MONOREPO="${MONOREPO:-$HOME/sideshift-monorepo}"
WITH_MCP=0
WITH_LAUNCHD=0
for a in "$@"; do
	case "$a" in
	--with-mcp) WITH_MCP=1 ;;
	--with-launchd) WITH_LAUNCHD=1 ;;
	*) echo "unknown option: $a" >&2; exit 2 ;;
	esac
done

for cmd in jq node git claude; do
	command -v "$cmd" >/dev/null || { echo "missing: $cmd (install it first)" >&2; exit 1; }
done

if [ "$HARNESS" != "$HOME/sideshift-claude-harness" ]; then
	echo "note: skills refer to ~/sideshift-claude-harness; this copy is at $HARNESS."
	echo "      Move it there (or symlink it) and re-run, so those paths resolve."
fi

# A free backup name: <dest>.bak, else <dest>.bak.<time>[.<n>].
backup_name() {
	local b="$1.bak" n=0
	[ -e "$b" ] || [ -L "$b" ] || { echo "$b"; return; }
	b="$1.bak.$(date +%Y%m%d%H%M%S)"
	while [ -e "$b" ] || [ -L "$b" ]; do n=$((n + 1)); b="$1.bak.$(date +%Y%m%d%H%M%S).$n"; done
	echo "$b"
}

# A symlink into some copy of this harness is ours: re-point it, no backup.
ours() {
	[ -L "$1" ] || return 1
	case "$(readlink "$1")" in */sideshift-claude-harness/*) return 0 ;; esac
	return 1
}
# An older install linked whole folders; turn those back into real folders first.
for d in "$HOME/.claude/hooks" "$HOME/.claude/mods" "$HOME/.claude/themes" "$HOME/.codex/agents" "$HOME/.codex/hooks"; do
	if ours "$d"; then rm "$d"; echo "unlinked ${d/#$HOME/\~} (now linked per item)"; fi
done

link() {
	local src="$1" dest="$2" label="${2/#$HOME/\~}"
	[ -e "$src" ] || { echo "skip     $label (missing)"; return; }
	if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$src" ]; then
		echo "ok       $label"
		return
	fi
	mkdir -p "$(dirname "$dest")"
	if ours "$dest"; then
		rm "$dest"
		echo "relinked $label"
	elif [ -e "$dest" ] || [ -L "$dest" ]; then
		local b
		# A backup left inside a skills or agents folder would still load as a second copy.
		case "$dest" in
		*/skills/* | */agents/*)
			local rel="${dest#$HOME/}"
			mkdir -p "$HOME/.claude/harness-backup/$(dirname "$rel")"
			b=$(backup_name "$HOME/.claude/harness-backup/$rel")
			;;
		*) b=$(backup_name "$dest") ;;
		esac
		mv "$dest" "$b"
		echo "backup   $label -> ${b/#$HOME/\~}"
	fi
	ln -s "$src" "$dest"
	[ -L "$dest" ] && echo "linked   $label"
}

link "$C/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
link "$C/statusline.sh" "$HOME/.claude/statusline.sh"

# One item at a time, so skills, hooks and scripts you already have stay.
for kind in skills agents rules bin hooks mods themes; do
	for f in "$C/$kind"/*; do
		[ -e "$f" ] || continue
		link "$f" "$HOME/.claude/$kind/$(basename "$f")"
	done
done
for f in "$C/skills"/*; do # Codex reads the same skills.
	link "$f" "$HOME/.agents/skills/$(basename "$f")"
done

# settings.json. Yours wins on: env values, model, theme, tui. The harness adds its
# hooks beside yours and sets permissions.defaultMode and the plugin list.
S="$HOME/.claude/settings.json"
new=$(sed "s#__HOME__#$HOME#g" "$C/settings.json")
# With both options, one shared user-scope copy replaces the monorepo's per-session servers.
if [ "$WITH_MCP" = 1 ] && [ "$WITH_LAUNCHD" = 1 ]; then
	new=$(jq '.disabledMcpjsonServers = ["chrome-devtools", "sideshift-firestore", "cloud-sql-postgres-read-replica"]' <<<"$new")
fi
MERGE='. as $o | ($o * $n)
	| .env = (($n.env // {}) + ($o.env // {}))
	| .model = ($o.model // $n.model) | .theme = ($o.theme // $n.theme) | .tui = ($o.tui // $n.tui)
	| .permissions.allow = ((($o.permissions.allow // []) + ($n.permissions.allow // [])) | unique)
	| .hooks = ((($o.hooks // {}) | keys) + (($n.hooks // {}) | keys) | unique
		| map({key: ., value: ((($o.hooks // {})[.] // []) + (($n.hooks // {})[.] // []) | unique)}) | from_entries)
	| with_entries(select(.value != null))'
if [ -f "$S" ] && [ ! -L "$S" ]; then
	merged=$(jq --argjson n "$new" "$MERGE" "$S")
	if [ "$(jq -S . "$S")" = "$(jq -S . <<<"$merged")" ]; then
		echo "ok       ~/.claude/settings.json"
	else
		# The first backup is the one that matters; a re-run never replaces it.
		[ -e "$S.pre-harness" ] || cp "$S" "$S.pre-harness"
		printf '%s\n' "$merged" >"$S"
		echo "merged   ~/.claude/settings.json (your original: settings.json.pre-harness)"
	fi
else
	printf '%s\n' "$new" >"$S"
	echo "written  ~/.claude/settings.json"
fi

# Codex reads the same global instructions.
link "$HOME/.claude/CLAUDE.md" "$HOME/.codex/AGENTS.md"
for f in "$HARNESS"/codex/agents/* "$HARNESS"/codex/hooks/*; do
	[ -e "$f" ] || continue
	link "$f" "$HOME/.codex/$(basename "$(dirname "$f")")/$(basename "$f")"
done
link "$HARNESS/codex/hooks.json" "$HOME/.codex/hooks.json"
link "$HARNESS/codex/rules/default.rules" "$HOME/.codex/rules/default.rules"

if [ "$WITH_MCP" = 1 ]; then
	[ -e "$HOME/.claude.json" ] && [ ! -e "$HOME/.claude.json.pre-harness" ] && cp "$HOME/.claude.json" "$HOME/.claude.json.pre-harness"
	had=()
	for s in sideshift-firestore cloud-sql-postgres-read-replica; do
		claude mcp get "$s" 2>/dev/null | grep -q "User config" && had+=("$s")
	done
	bash "$C/mcp-servers.sh"
	# The two database servers listen on ports that only the launchd jobs open.
	# Remove only what this run added; a server you already had stays.
	if [ "$WITH_LAUNCHD" = 0 ]; then
		for s in sideshift-firestore cloud-sql-postgres-read-replica; do
			case " ${had[*]-} " in *" $s "*) continue ;; esac
			claude mcp remove --scope user "$s" >/dev/null 2>&1 && echo "removed  $s (needs --with-launchd; the monorepo's own copy stays on)"
		done
	fi
fi

if [ "$WITH_LAUNCHD" = 1 ]; then
	mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.claude/logs"
	for tpl in "$HARNESS"/launchd/*.plist; do
		label=$(basename "$tpl" .plist)
		dest="$HOME/Library/LaunchAgents/$label.plist"
		sed -e "s#__MONOREPO__#$MONOREPO#g" -e "s#__HOME__#$HOME#g" "$tpl" >"$dest"
		launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
		if launchctl bootstrap "gui/$(id -u)" "$dest"; then echo "loaded   launchd $label"; else echo "FAILED   launchd $label"; fi
	done
fi

echo
echo "Done. Next:"
echo "  1. Open a new Claude Code session and run /plugin to install segment-recompact"
echo "     and security-guidance if they are not listed yet."
[ "$WITH_MCP" = 1 ] && echo "  2. Run /mcp in Claude Code and sign in to each server."
echo "  See README.md for what needs your own accounts."
