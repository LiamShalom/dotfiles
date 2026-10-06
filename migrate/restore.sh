#!/usr/bin/env bash
#
# restore.sh — run on the NEW machine (bootstrap.sh calls it). Unpacks a folder
# made by pack.sh. Safe to re-run: existing clones, branches and worktrees are
# left alone, and nothing is overwritten that already differs.
#
# Usage:  ./migrate/restore.sh <handoff-dir> home     keys, settings, memory
#         ./migrate/restore.sh <handoff-dir> repos    clone + local work
set -euo pipefail

MIGRATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HANDOFF="${1:?handoff dir}"
PHASE="${2:?phase: home | repos}"

restore_home() {
	if [ ! -f "$HANDOFF/home.tar" ]; then
		echo "skip     home.tar (not in handoff)"
		return
	fi
	# -k: never clobber a file that is already on this machine.
	tar -C "$HOME" -xkf "$HANDOFF/home.tar"
	chmod 700 "$HOME/.ssh" "$HOME/.gnupg" 2>/dev/null || true
	chmod 600 "$HOME"/.ssh/id_* 2>/dev/null || true
	chmod 644 "$HOME"/.ssh/*.pub 2>/dev/null || true
	echo "ok       home.tar (SSH, GPG, gitconfig.local, Claude settings + memory, env)"

	if [ -f "$HANDOFF/transcripts.tar" ]; then
		tar -C "$HOME" -xkf "$HANDOFF/transcripts.tar"
		echo "ok       transcripts.tar"
	fi
}

restore_repo() {
	local name="$1" remote="$2" repo="$HOME/$1" src="$HANDOFF/repos/$1" fresh=0
	if [ ! -d "$repo/.git" ]; then
		git clone --quiet "$remote" "$repo"
		fresh=1
		echo "cloned   $name"
	else
		echo "ok       $name (already cloned)"
	fi
	[ -d "$src" ] || return 0

	if [ -f "$src/refs.bundle" ]; then
		git -C "$repo" bundle verify --quiet "$src/refs.bundle"
		git -C "$repo" fetch --quiet --no-tags "$src/refs.bundle" \
			'+refs/heads/*:refs/remotes/old-mac/*' '+refs/old-mac/*:refs/old-mac/*'

		# Stashes: store the oldest first so stash@{0} stays the newest.
		if [ "$fresh" = 1 ]; then
			local n
			n=$(git -C "$repo" for-each-ref refs/old-mac/stash | wc -l | tr -d ' ')
			for ((i = n - 1; i >= 0; i--)); do
				git -C "$repo" stash store -m "old Mac stash@{$i}" "refs/old-mac/stash/$i"
			done
			[ "$n" -gt 0 ] && echo "ok       $name: $n stashes restored"
		fi
	fi

	# Recreate local branches that do not exist yet, at the old Mac's commit.
	if [ -f "$src/branches.txt" ]; then
		local made=0 missing=0 b sha
		while read -r b sha; do
			git -C "$repo" show-ref -q --verify "refs/heads/$b" && continue
			if git -C "$repo" cat-file -e "$sha^{commit}" 2>/dev/null; then
				git -C "$repo" branch --quiet --no-track "$b" "$sha"
				made=$((made + 1))
			else
				missing=$((missing + 1))
			fi
		done < "$src/branches.txt"
		echo "ok       $name: $made branches restored$([ "$missing" -gt 0 ] && echo ", $missing skipped (commit not found)")"
	fi

	if [ -f "$src/ignored.tar" ]; then
		tar -C "$repo" -xkf "$src/ignored.tar"
		echo "ok       $name: ignored files (.env, local skills, plans)"
	fi

	[ -f "$src/worktrees.tsv" ] || return 0
	while IFS=$'\t' read -r role path branch head snapshot; do
		path="${path/#\~/$HOME}"
		if [ "$role" = main ]; then
			# Only a clone made just now is put back to the old state, so a
			# re-run never rewinds work done on this machine.
			[ "$fresh" = 1 ] || continue
			if [ "$branch" != "-" ] && [ "$(git -C "$repo" rev-parse HEAD)" != "$head" ]; then
				git -C "$repo" checkout --quiet -B "$branch" "$head"
			fi
		else
			[ -e "$path" ] && { echo "ok       worktree ${path/#$HOME/~} (exists)"; continue; }
			mkdir -p "$(dirname "$path")"
			if [ "$branch" = "-" ]; then
				git -C "$repo" worktree add --quiet --detach "$path" "$head"
			else
				git -C "$repo" worktree add --quiet "$path" "$branch"
			fi
		fi
		if [ "$snapshot" != "-" ]; then
			# Working tree = snapshot, index = HEAD: changes show as unstaged and
			# untracked, the same as on the old machine.
			git -C "$path" restore --quiet --source="$snapshot" --worktree -- .
		fi
		echo "ok       $role ${path/#$HOME/~} [$branch]$([ "$snapshot" != "-" ] && echo ' + uncommitted work')"
	done < "$src/worktrees.tsv"
}

case "$PHASE" in
	home) restore_home ;;
	repos)
		while read -r name remote; do
			case "$name" in ''|'#'*) continue ;; esac
			restore_repo "$name" "$remote"
		done < "$MIGRATE_DIR/repos.txt"
		;;
	*) echo "unknown phase: $PHASE" >&2; exit 2 ;;
esac
