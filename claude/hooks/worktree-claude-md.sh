#!/usr/bin/env bash
# SessionStart hook — replicate the main worktree's CLAUDE.md symlink into any
# git worktree that lacks its own CLAUDE.md.
#
# Only acts when main's CLAUDE.md is itself a symlink (the SideShift setup),
# so it's a no-op for anyone who doesn't use that pattern.
set -u

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

[ -L "$main/CLAUDE.md" ] || exit 0
[ "$toplevel" = "$main" ] && exit 0
{ [ -e "$toplevel/CLAUDE.md" ] || [ -L "$toplevel/CLAUDE.md" ]; } && exit 0

target="$(readlink "$main/CLAUDE.md")" || exit 0
[ -n "$target" ] || exit 0
ln -s "$target" "$toplevel/CLAUDE.md" 2>/dev/null || true
exit 0
