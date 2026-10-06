#!/usr/bin/env bash
#
# install.sh — symlink this repo's configs into place.
#
# Everything in home/ lands flat in $HOME. Everything else has an explicit
# destination (see LINKS below), because those live in nested paths.
#
# Existing real files are backed up to <file>.bak before being replaced.
# Re-running is safe (idempotent): correct symlinks are left untouched.
#
# Usage:  ./install.sh
set -euo pipefail

DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$DOTFILES_DIR/home"

# link <src> <dest> — point dest at src, backing up whatever was there.
link() {
	local src="$1" dest="$2"
	local label="${dest/#$HOME/\~}"

	if [ ! -e "$src" ]; then
		echo "skip     $label (missing in repo)"
		return
	fi

	if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$src" ]; then
		echo "ok       $label (already linked)"
		return
	fi

	mkdir -p "$(dirname "$dest")"

	if [ -e "$dest" ] || [ -L "$dest" ]; then
		rm -rf "$dest.bak"
		mv "$dest" "$dest.bak"
		echo "backup   $label -> $label.bak"
	fi

	ln -s "$src" "$dest"
	echo "linked   $label"
}

# --- home/ -> $HOME (flat) ---------------------------------------------------
shopt -s dotglob nullglob
for f in "$SRC_DIR"/*; do
	link "$f" "$HOME/$(basename "$f")"
done
shopt -u dotglob nullglob

# --- everything with a nested destination ------------------------------------
# Format: <path relative to repo root>:<path relative to $HOME>
LINKS=(
	"ghostty/config:.config/ghostty/config"
	"ghostty/themes:.config/ghostty/themes"
	"config/starship.toml:.config/starship.toml"
	"config/atuin/config.toml:.config/atuin/config.toml"

	"claude/CLAUDE.md:.claude/CLAUDE.md"
	"claude/statusline.sh:.claude/statusline.sh"
	"claude/rules:.claude/rules"
	"claude/hooks:.claude/hooks"
	"claude/skills:.claude/skills"
	"claude/mods:.claude/mods"
	# ~/.claude/bin is linked per-file, not as a directory: it also holds
	# codeagent-wrapper, a 5.7M binary that is deliberately not in this repo.
	"claude/bin/worktree-janitor.sh:.claude/bin/worktree-janitor.sh"
	"claude/bin/worktree-janitor-guard.sh:.claude/bin/worktree-janitor-guard.sh"
	"claude/bin/chrome-reaper.sh:.claude/bin/chrome-reaper.sh"

	"codex/rules/default.rules:.codex/rules/default.rules"
)

for entry in "${LINKS[@]}"; do
	link "$DOTFILES_DIR/${entry%%:*}" "$HOME/${entry#*:}"
done

# --- Claude settings: copied, not linked -------------------------------------
# The live file holds the proxy auth token, so the tracked copy has a placeholder.
# Copy it once; after that the live file is the source and this repo is a mirror.
if [ -e "$HOME/.claude/settings.json" ]; then
	echo "ok       ~/.claude/settings.json (exists, not overwritten)"
else
	cp "$DOTFILES_DIR/claude/settings.json" "$HOME/.claude/settings.json"
	echo "copied   ~/.claude/settings.json (set ANTHROPIC_AUTH_TOKEN in it)"
fi

# --- Codex reads the same global instructions as Claude ----------------------
# ~/.codex/AGENTS.md is a symlink to ~/.claude/CLAUDE.md, so both agents see one
# file. (Pointed at $HOME, not at the repo, so it survives moving the repo.)
mkdir -p "$HOME/.codex"
if [ -L "$HOME/.codex/AGENTS.md" ] && \
   [ "$(readlink "$HOME/.codex/AGENTS.md")" = "$HOME/.claude/CLAUDE.md" ]; then
	echo "ok       ~/.codex/AGENTS.md (already linked)"
else
	[ -e "$HOME/.codex/AGENTS.md" ] && mv "$HOME/.codex/AGENTS.md" "$HOME/.codex/AGENTS.md.bak"
	ln -s "$HOME/.claude/CLAUDE.md" "$HOME/.codex/AGENTS.md"
	echo "linked   ~/.codex/AGENTS.md -> ~/.claude/CLAUDE.md"
fi

echo
echo "Done. Not handled automatically (see README):"
echo "  - ~/.gitconfig.local  — email, GPG signing key, delta pager"
echo "  - ~/.claude/settings.json — replace the ANTHROPIC_AUTH_TOKEN placeholder"
echo "  - ~/.codex/config.toml — needs a real auth token; codex/config.toml is a redacted reference copy"
echo "  - fzf-tab             — git clone into ~/.oh-my-zsh/custom/plugins/"
echo
echo "Open a new shell or run: exec \$SHELL -l"
