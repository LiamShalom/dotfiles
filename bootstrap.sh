#!/usr/bin/env bash
#
# bootstrap.sh — set up a fresh Mac from nothing.
#
# Run it from the handoff folder that migrate/pack.sh made (it finds the
# dotfiles bundle, keys and repo work next to itself):
#
#     bash ~/Downloads/new-mac-handoff/bootstrap.sh
#
# Without a handoff folder it still installs the tools and dotfiles, clones
# the repos, and skips the restore steps.
#
# Every step checks whether it is already done, so re-running after a failure
# picks up where it stopped. A failed step is reported at the end, not fatal.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HANDOFF="${HANDOFF:-}"
[ -z "$HANDOFF" ] && [ -f "$SCRIPT_DIR/dotfiles.bundle" ] && HANDOFF="$SCRIPT_DIR"
DOTFILES="$HOME/dotfiles"
DOTFILES_REMOTE="git@github.com:LiamShalom/dotfiles.git"
FAILED=()

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31mFAILED\033[0m %s\n' "$*"; FAILED+=("$*"); }
ask() { local r; read -r -p "$1 [y/N] " r; [[ "$r" =~ ^[Yy] ]]; }

if [ "$HOME" != "/Users/liam-sideshift" ]; then
	echo "Your home is $HOME, not /Users/liam-sideshift."
	echo "Claude memory folders and a few settings paths are keyed by the old path."
	echo "It still works; see START-HERE.md, 'Different username'."
	ask "Continue?" || exit 1
fi

step "Admin password (kept alive for Homebrew and Xcode)"
sudo -v
while true; do sudo -n true; sleep 50; kill -0 "$$" || exit; done 2>/dev/null &

# --- 1. Command line tools (git, clang) --------------------------------------
step "Xcode command line tools"
if xcode-select -p >/dev/null 2>&1; then
	echo "ok       already installed"
else
	xcode-select --install
	echo "Finish the installer window. Waiting..."
	until xcode-select -p >/dev/null 2>&1; do sleep 10; done
fi

# --- 2. Homebrew -------------------------------------------------------------
step "Homebrew"
if [ ! -x /opt/homebrew/bin/brew ]; then
	NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || fail "Homebrew install"
fi
eval "$(/opt/homebrew/bin/brew shellenv)"
echo "ok       $(brew --version | head -1)"

# --- 3. Dotfiles -------------------------------------------------------------
step "Dotfiles"
if [ -d "$DOTFILES/.git" ]; then
	echo "ok       $DOTFILES exists"
elif [ -n "$HANDOFF" ]; then
	git clone --quiet "$HANDOFF/dotfiles.bundle" "$DOTFILES"
	git -C "$DOTFILES" remote set-url origin "$DOTFILES_REMOTE"
	echo "ok       cloned from handoff bundle (origin -> GitHub)"
else
	git clone --quiet https://github.com/LiamShalom/dotfiles.git "$DOTFILES" || { fail "dotfiles clone"; exit 1; }
fi

# --- 4. Keys, settings, memory (before anything talks to GitHub) -------------
if [ -n "$HANDOFF" ]; then
	step "Restore keys, Claude settings and memory"
	bash "$DOTFILES/migrate/restore.sh" "$HANDOFF" home || fail "restore home files"
	gpgconf --kill gpg-agent 2>/dev/null || true
fi

# --- 5. oh-my-zsh + fzf-tab --------------------------------------------------
step "oh-my-zsh"
if [ -d "$HOME/.oh-my-zsh" ]; then
	echo "ok       already installed"
else
	RUNZSH=no CHSH=no KEEP_ZSHRC=yes sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended || fail "oh-my-zsh"
fi
FZF_TAB="$HOME/.oh-my-zsh/custom/plugins/fzf-tab"
[ -d "$FZF_TAB" ] || git clone --quiet https://github.com/Aloxaf/fzf-tab "$FZF_TAB" || fail "fzf-tab"

# --- 6. Packages and apps ----------------------------------------------------
step "brew bundle (CLI tools + apps; this is the long one)"
if ! mas account >/dev/null 2>&1; then
	echo "Sign in to the App Store now if you want Xcode installed in this run."
fi
brew bundle --file="$DOTFILES/Brewfile" || fail "brew bundle (re-run: brew bundle --file=~/dotfiles/Brewfile)"

# --- 7. Symlink configs ------------------------------------------------------
step "Link configs"
bash "$DOTFILES/install.sh" || fail "install.sh"

# --- 8. Claude Code ----------------------------------------------------------
step "Claude Code"
if [ ! -x "$HOME/.local/bin/claude" ]; then
	curl -fsSL https://claude.ai/install.sh | bash || fail "Claude Code install"
fi
export PATH="$HOME/.local/bin:$PATH"
if command -v claude >/dev/null; then
	echo "ok       $(claude --version)"
	claude plugin marketplace add Don-Osipov/segment_recompact >/dev/null 2>&1 || true
	for p in segment-recompact@segment-recompact security-guidance@claude-plugins-official; do
		if claude plugin list 2>/dev/null | grep -q "${p%@*}"; then
			echo "ok       plugin $p"
		else
			claude plugin install "$p" >/dev/null && echo "added    plugin $p" || fail "plugin $p"
		fi
	done
	RECOMPACT=$(ls -d "$HOME"/.claude/plugins/cache/segment-recompact/segment-recompact/*/bin/recompact 2>/dev/null | sort -V | tail -1)
	if [ -n "$RECOMPACT" ]; then
		"$RECOMPACT" install >/dev/null && echo "ok       recompact shell wrapper" || fail "recompact install"
	fi

	bash "$DOTFILES/claude/mcp-servers.sh" || fail "MCP servers"
fi

# --- 9. GitHub access --------------------------------------------------------
step "GitHub SSH"
ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -T git@github.com 2>&1 | grep -q "successfully authenticated" \
	&& echo "ok       SSH key accepted by GitHub" \
	|| echo "SSH to GitHub is not working yet. If the key has a passphrase you will be asked for it during the clone."
if ! gh auth status >/dev/null 2>&1; then
	echo "gh is not logged in (PRs, gh-approve and some hooks need it)."
	gh auth login --git-protocol ssh --web || fail "gh auth login"
fi

# --- 10. Repos ---------------------------------------------------------------
step "Code repos"
if [ -n "$HANDOFF" ]; then
	bash "$DOTFILES/migrate/restore.sh" "$HANDOFF" repos || fail "restore repos"
else
	while read -r name remote; do
		case "$name" in ''|'#'*) continue ;; esac
		[ -d "$HOME/$name/.git" ] || git clone --quiet "$remote" "$HOME/$name" || fail "clone $name"
	done < "$DOTFILES/migrate/repos.txt"
fi
git -C "$DOTFILES" fetch --quiet origin 2>/dev/null && git -C "$DOTFILES" branch --quiet -u origin/main main 2>/dev/null || true

step "npm install in each repo"
while read -r name _remote; do
	case "$name" in ''|'#'*) continue ;; esac
	repo="$HOME/$name"
	[ -f "$repo/package-lock.json" ] || continue
	[ -d "$repo/node_modules" ] && { echo "ok       $name (node_modules exists)"; continue; }
	echo "...      $name"
	(cd "$repo" && npm ci --no-audit --no-fund --loglevel=error) || fail "npm ci in $name"
done < "$DOTFILES/migrate/repos.txt"

# --- 11. Xcode ---------------------------------------------------------------
step "Xcode"
if [ -d /Applications/Xcode.app ]; then
	sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
	sudo xcodebuild -license accept
	xcodebuild -runFirstLaunch >/dev/null 2>&1 || true
	if ! xcrun simctl list runtimes 2>/dev/null | grep -q '^iOS'; then
		ask "Download the iOS simulator runtime now (~8 GB)?" && { xcodebuild -downloadPlatform iOS || fail "iOS runtime download"; }
	fi
	echo "ok       Xcode selected"
else
	echo "Xcode not installed (sign in to the App Store, then: mas install 497799835, and re-run this script)."
fi

# --- 12. Logins --------------------------------------------------------------
step "Cloud logins"
if ! gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | grep -q .; then
	ask "Log in to gcloud now (user + application-default)?" && {
		gcloud auth login || fail "gcloud auth login"
		gcloud auth application-default login || fail "gcloud ADC login"
	}
else
	echo "ok       gcloud: $(gcloud auth list --filter=status:ACTIVE --format='value(account)')"
fi

# --- Done --------------------------------------------------------------------
step "Summary"
if [ ${#FAILED[@]} -eq 0 ]; then
	echo "Every step passed."
else
	echo "These steps failed (re-run this script after fixing; finished steps are skipped):"
	printf '  - %s\n' "${FAILED[@]}"
fi
cat <<'EOF'

Still by hand (see START-HERE.md):
  - claude            -> run it once in ~/sideshift-monorepo, then /mcp and sign in to each server
  - codex login, vercel login, firebase login
  - Open Docker, Raycast, Rectangle, BetterDisplay, Logi Options+ once to grant permissions
  - Ghostty quake-terminal hotkey permission (ghostty/SETUP.md, Step 7)
  - Delete the handoff folder: it holds your private keys

Open a new terminal (or: exec zsh -l).
EOF
