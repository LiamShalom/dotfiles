#!/usr/bin/env bash
# SessionStart hook — symlink the shared dev env into any git worktree that
# lacks its own .env.local. One canonical file, N symlinks -> zero drift.
#
# Never overwrites an existing .env.local, so per-worktree overrides survive.
set -u

CANON="$HOME/.config/sideshift/env.local"
[ -e "$CANON" ] || exit 0

cwd=""
if command -v jq >/dev/null 2>&1; then
  cwd="$(jq -r 'try .cwd // empty' 2>/dev/null)"
fi
[ -n "$cwd" ] && [ -d "$cwd" ] || cwd="$PWD"

toplevel="$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -n "$toplevel" ] || exit 0

common="$(git -C "$cwd" rev-parse --git-common-dir 2>/dev/null)" || exit 0
case "$common" in
  /*) ;;
  *) common="$cwd/$common" ;;
esac
main="$(cd "$(dirname "$common")" 2>/dev/null && pwd -P)" || exit 0

# GUARD: only act for worktrees of MY sideshift-monorepo checkout.
[ "$main" = "$HOME/sideshift-monorepo" ] || exit 0

{ [ -e "$toplevel/.env.local" ] || [ -L "$toplevel/.env.local" ]; } && exit 0

ln -s "$CANON" "$toplevel/.env.local" 2>/dev/null || true
exit 0
