#!/usr/bin/env bash
#
# pack.sh — run on the OLD machine. Builds one folder to AirDrop to the new one.
#
# The folder holds everything that GitHub and Homebrew cannot give back:
#   dotfiles.bundle            this repo, including commits not pushed yet
#   repos/<name>/refs.bundle   every local commit not on origin's default branch:
#                              all branches, all stashes, and a snapshot commit of
#                              each dirty worktree (taken through a temporary index,
#                              so the real index and files are not touched)
#   repos/<name>/ignored.tar   gitignored files worth keeping (.env files, local
#                              skills, plans) — build output and caches excluded
#   repos/<name>/worktrees.tsv the worktree layout, so restore.sh can rebuild it
#   home.tar                   SSH + GPG keys, ~/.gitconfig.local, Claude settings,
#                              memory, Codex config, SideShift env, shell history
#   transcripts.tar            only with --with-transcripts (Claude session logs)
#
# It contains private keys and tokens. AirDrop it, then delete it from both Desktops.
#
# Usage:  ./migrate/pack.sh [--with-transcripts] [--out DIR]
set -euo pipefail

MIGRATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_DIR="$(dirname "$MIGRATE_DIR")"
OUT="$HOME/Desktop/new-mac-handoff"
WITH_TRANSCRIPTS=0

while [ $# -gt 0 ]; do
	case "$1" in
		--with-transcripts) WITH_TRANSCRIPTS=1 ;;
		--out) OUT="$2"; shift ;;
		*) echo "unknown option: $1" >&2; exit 2 ;;
	esac
	shift
done

if [ -e "$OUT" ]; then
	echo "$OUT already exists. Move or delete it first." >&2
	exit 1
fi
mkdir -p "$OUT/repos"
chmod 700 "$OUT"
echo "packing into ${OUT/#$HOME/~}"

# --- dotfiles ---------------------------------------------------------------
if [ -n "$(git -C "$DOTFILES_DIR" status --porcelain)" ]; then
	echo "WARNING  dotfiles has uncommitted changes; they are NOT in the bundle. Commit first." >&2
fi
git -C "$DOTFILES_DIR" bundle create "$OUT/dotfiles.bundle" --all 2>/dev/null
cp "$DOTFILES_DIR/bootstrap.sh" "$OUT/bootstrap.sh"
cp "$MIGRATE_DIR/START-HERE.md" "$OUT/START-HERE.md"
echo "ok       dotfiles.bundle"

# --- repos ------------------------------------------------------------------
# Ignored paths that are rebuilt by tools, or are too large to be worth carrying.
IGNORED_SKIP='(^|/)(node_modules|dist|build|__pycache__|\.next|\.turbo|\.worktrees|graphify-out|\.claude-scratch|DerivedData)(/|$)|^\.claude/worktrees/|^scripts/\.exports/|next-env\.d\.ts$|\.tsbuildinfo$|\.log$|(^|/)\.DS_Store$|\.lock$'

slugify() { echo "${1#$HOME/}" | tr '/.' '--'; }

drop_temp_refs() {
	local name _r
	while read -r name _r; do
		case "$name" in ''|'#'*) continue ;; esac
		[ -d "$HOME/$name/.git" ] || continue
		git -C "$HOME/$name" for-each-ref --format='%(refname)' refs/old-mac | xargs -n1 -r git -C "$HOME/$name" update-ref -d
	done < "$MIGRATE_DIR/repos.txt"
}
trap drop_temp_refs EXIT

pack_repo() {
	local name="$1" repo="$HOME/$1" dest="$OUT/repos/$1"
	mkdir -p "$dest"
	git -C "$repo" fetch --quiet origin || echo "WARNING  $name: fetch failed; bundle base may be stale" >&2
	local base
	base=$(git -C "$repo" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/main)

	# Temporary refs under refs/old-mac/ make stashes and worktree snapshots
	# bundleable. They are removed again at the end of this function.
	git -C "$repo" for-each-ref --format='%(refname)' refs/old-mac | xargs -n1 -r git -C "$repo" update-ref -d

	local i=0
	while git -C "$repo" rev-parse -q --verify "stash@{$i}" >/dev/null; do
		git -C "$repo" update-ref "refs/old-mac/stash/$i" "stash@{$i}"
		i=$((i + 1))
	done

	# worktrees.tsv columns: role (main|wt), path, branch (- if detached), HEAD,
	# WIP snapshot commit (- if clean). Clean worktrees with nothing local are
	# left out: their branch is on GitHub, so there is nothing to rebuild.
	: > "$dest/worktrees.tsv"
	local tmp_index role=main all_wts=()
	tmp_index="$(mktemp -d)/index"
	while read -r wt; do all_wts+=("$wt"); done < <(git -C "$repo" worktree list --porcelain | awk '/^worktree /{print substr($0,10)}')
	for wt in "${all_wts[@]}"; do
		local this_role=$role
		role=wt
		[ -d "$wt" ] || continue
		# Worktrees nested inside this one (e.g. an unignored .worktrees/) are
		# their own entries, not untracked files of this one.
		local spec=(.) other
		for other in "${all_wts[@]}"; do
			case "$other" in "$wt"/*)
				git -C "$wt" check-ignore -q "${other#$wt/}" || spec+=(":(exclude)${other#$wt/}") ;;
			esac
		done
		local slug branch head unpushed snapshot="-"
		slug=$(slugify "$wt")
		branch=$(git -C "$wt" symbolic-ref --short -q HEAD || echo "-")
		head=$(git -C "$wt" rev-parse HEAD)
		unpushed=$(git -C "$wt" rev-list --count HEAD --not --remotes)
		if [ -n "$(git -C "$wt" status --porcelain -- "${spec[@]}")" ]; then
			rm -f "$tmp_index"
			GIT_INDEX_FILE="$tmp_index" git -C "$wt" read-tree HEAD
			GIT_INDEX_FILE="$tmp_index" git -C "$wt" add -A -- "${spec[@]}"
			local tree
			tree=$(GIT_INDEX_FILE="$tmp_index" git -C "$wt" write-tree)
			snapshot=$(git -C "$wt" commit-tree "$tree" -p HEAD -m "WIP snapshot of ${wt/#$HOME/~} from old Mac")
			git -C "$repo" update-ref "refs/old-mac/wip/$slug" "$snapshot"
		elif [ "$this_role" = wt ] && [ "$unpushed" = 0 ]; then
			continue
		fi
		git -C "$repo" update-ref "refs/old-mac/head/$slug" "$head"
		printf '%s\t%s\t%s\t%s\t%s\n' "$this_role" "${wt/#$HOME/~}" "$branch" "$head" "$snapshot" >> "$dest/worktrees.tsv"
	done
	rm -rf "$(dirname "$tmp_index")"

	# The bundle drops branches whose tip is already on $base (no commits to
	# carry), so the full list is kept as well and restore.sh recreates those.
	git -C "$repo" for-each-ref --format='%(refname:short) %(objectname)' refs/heads > "$dest/branches.txt"
	if git -C "$repo" bundle create "$dest/refs.bundle" --branches --glob=refs/old-mac --not "$base" 2>/dev/null; then
		echo "ok       $name refs.bundle ($(du -h "$dest/refs.bundle" | cut -f1), base $base)"
	else
		echo "ok       $name (no local-only commits)"
	fi
	git -C "$repo" for-each-ref --format='%(refname)' refs/old-mac | xargs -n1 -r git -C "$repo" update-ref -d

	# Ignored files from the main checkout only; worktrees get theirs linked in
	# by the Claude hooks.
	local list="$dest/ignored.txt"
	git -C "$repo" -c core.quotePath=false ls-files --others --ignored --exclude-standard --directory --no-empty-directory |
		grep -Ev "$IGNORED_SKIP" > "$list" || true
	if [ -s "$list" ]; then
		tar -C "$repo" --exclude node_modules --exclude .next --exclude __pycache__ --exclude .DS_Store \
			-cf "$dest/ignored.tar" -T "$list"
		echo "ok       $name ignored.tar ($(wc -l < "$list" | tr -d ' ') paths, $(du -h "$dest/ignored.tar" | cut -f1))"
	fi
	rm -f "$list"
}

while read -r name _remote; do
	case "$name" in ''|'#'*) continue ;; esac
	if [ -d "$HOME/$name/.git" ]; then
		pack_repo "$name"
	else
		echo "skip     $name (not cloned here)"
	fi
done < "$MIGRATE_DIR/repos.txt"

# --- home files -------------------------------------------------------------
# Paths relative to $HOME. Missing ones are skipped.
HOME_PATHS=(
	.ssh
	.gnupg
	.gitconfig.local
	.zsh_history
	.local/share/atuin
	.config/sideshift
	.9router-client
	.codex/config.toml
	.claude/settings.json
	.claude/settings.local.json
	.claude/bin/codeagent-wrapper
	.claude/agents-disabled
	.claude/plans
)
for d in "$HOME"/.claude/projects/*/memory; do
	case "$d" in *-private-*) continue ;; esac   # throwaway /tmp sessions
	HOME_PATHS+=("${d#$HOME/}")
done

present=()
for p in "${HOME_PATHS[@]}"; do
	[ -e "$HOME/$p" ] && present+=("$p")
done
# Sockets and lock files in ~/.gnupg are per-machine and break tar.
tar -C "$HOME" --exclude '.gnupg/S.*' --exclude '.#lk*' --exclude '*.lock' --exclude '.ssh/agent' -cf "$OUT/home.tar" "${present[@]}"
echo "ok       home.tar (${#present[@]} paths, $(du -h "$OUT/home.tar" | cut -f1))"

# The Mintlify MCP key lives only in ~/.claude.json; mcp-servers.sh reads it from env.
key=$(jq -r '.mcpServers["mintlify-index"].headers.Authorization // empty' "$HOME/.claude.json" 2>/dev/null | sed 's/^Bearer //')
if [ -n "$key" ]; then
	(umask 077; printf '%s\n' "$key" > "$OUT/mintlify-api-key")
	echo "ok       mintlify-api-key"
fi

if [ "$WITH_TRANSCRIPTS" = 1 ]; then
	transcripts=()
	for d in "$HOME"/.claude/projects/-Users-*; do
		[ -d "$d" ] && transcripts+=("${d#$HOME/}")
	done
	tar -C "$HOME" -cf "$OUT/transcripts.tar" "${transcripts[@]}"
	echo "ok       transcripts.tar ($(du -h "$OUT/transcripts.tar" | cut -f1))"
fi

chmod -R go-rwx "$OUT"
echo
echo "Done: $(du -sh "$OUT" | cut -f1) in ${OUT/#$HOME/~}"
echo "AirDrop the folder, then follow START-HERE.md on the new Mac."
echo "It holds private keys and tokens: delete it from both machines once restored."
