#!/usr/bin/env bash
#
# check.sh — run on the OLD machine before moving. Read-only.
#
# Lists every worktree in the repos from repos.txt with:
#   unpushed  commits on HEAD that are on no remote branch
#   dirty     uncommitted changes + untracked (non-ignored) files
# pack.sh carries both, so nothing here is lost — this is so you know what
# you are carrying, and can push what you want on GitHub instead.
#
# Usage:  ./migrate/check.sh
set -euo pipefail

MIGRATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

while read -r name _remote; do
	case "$name" in ''|'#'*) continue ;; esac
	repo="$HOME/$name"
	if [ ! -d "$repo/.git" ]; then
		echo "== $name: not cloned here, skipped"
		continue
	fi

	echo "== $name"
	git -C "$repo" fetch --quiet --prune origin 2>/dev/null || echo "   (fetch failed; remote state may be stale)"

	stashes=$(git -C "$repo" stash list | wc -l | tr -d ' ')
	[ "$stashes" -gt 0 ] && echo "   $stashes stash entries (pack.sh carries these as a branch)"

	git -C "$repo" worktree list --porcelain | awk '/^worktree /{print substr($0,10)}' |
		while read -r wt; do
			[ -d "$wt" ] || { echo "   MISSING  $wt (prunable)"; continue; }
			branch=$(git -C "$wt" symbolic-ref --short -q HEAD || echo "(detached)")
			unpushed=$(git -C "$wt" rev-list --count HEAD --not --remotes)
			dirty=$(git -C "$wt" status --porcelain | wc -l | tr -d ' ')
			if [ "$unpushed" -gt 0 ] || [ "$dirty" -gt 0 ]; then
				printf '   %-4s unpushed  %-4s dirty  %-45s %s\n' "$unpushed" "$dirty" "$branch" "${wt/#$HOME/~}"
			fi
		done

	# Local branches with no worktree that still have unpushed commits.
	for b in $(git -C "$repo" for-each-ref --format='%(refname:short)' refs/heads); do
		n=$(git -C "$repo" rev-list --count "refs/heads/$b" --not --remotes)
		[ "$n" -gt 0 ] || continue
		git -C "$repo" worktree list --porcelain | grep -qx "branch refs/heads/$b" && continue
		printf '   %-4s unpushed  -    dirty  %-45s (no worktree)\n' "$n" "$b"
	done
done < "$MIGRATE_DIR/repos.txt"

echo
echo "Everything listed above is carried by pack.sh. Push branches to GitHub too if you want them off this laptop for good."
