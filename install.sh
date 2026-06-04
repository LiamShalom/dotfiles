#!/usr/bin/env bash
#
# install.sh — symlink every file in home/ into $HOME.
#
# Existing real files are backed up to <file>.bak before being replaced.
# Re-running is safe (idempotent): correct symlinks are left untouched.
#
# Usage:  ./install.sh
set -euo pipefail

DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$DOTFILES_DIR/home"

link_file() {
	local src="$1"
	local name
	name="$(basename "$src")"
	local dest="$HOME/$name"

	if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$src" ]; then
		echo "ok       $name (already linked)"
		return
	fi

	if [ -e "$dest" ] || [ -L "$dest" ]; then
		mv "$dest" "$dest.bak"
		echo "backup   $name -> $name.bak"
	fi

	ln -s "$src" "$dest"
	echo "linked   $name"
}

# Symlink dotfiles (include hidden files; skip . and ..).
shopt -s dotglob nullglob
for f in "$SRC_DIR"/*; do
	link_file "$f"
done
shopt -u dotglob nullglob

# .zshrc sources ~/.work for machine/work-specific secrets (gitignored, not in repo).
# Create an empty placeholder so a fresh shell doesn't error on a new machine.
if [ ! -e "$HOME/.work" ]; then
	touch "$HOME/.work"
	echo "created  .work (empty placeholder for machine-local secrets)"
fi

echo "Done. Open a new shell or run: exec \$SHELL -l"
