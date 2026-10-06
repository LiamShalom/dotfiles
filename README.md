# dotfiles

Personal macOS dotfiles. A new machine is a clone away.

Covers the shell (zsh + starship + the modern CLI stack), git, vim, the Ghostty
terminal, and the Claude Code / Codex agent setup.

## Moving to a new Mac (the fast path)

On the old Mac:

```bash
~/dotfiles/migrate/check.sh   # optional: list unpushed branches and dirty worktrees
~/dotfiles/migrate/pack.sh    # builds ~/Desktop/new-mac-handoff
```

AirDrop `new-mac-handoff` to the new Mac and run
`bash ~/Downloads/new-mac-handoff/bootstrap.sh`. It does every step below,
restores your keys, Claude memory and settings, and clones the repos with all
local branches, stashes, worktrees and uncommitted work.
[`migrate/START-HERE.md`](./migrate/START-HERE.md) (copied into the folder) has
the details. Without a handoff folder, `bootstrap.sh` still does the install
steps.

The manual steps below are what `bootstrap.sh` automates.

---

## Step 1 — Install Homebrew

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

After it finishes, add brew to the current shell (Apple Silicon path; `install.sh`
wires this permanently via `.zprofile` later):

```bash
eval "$(/opt/homebrew/bin/brew shellenv)"
```

## Step 2 — Install oh-my-zsh

`.zshrc` expects `~/.oh-my-zsh` to exist.

```bash
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
```

> Installing oh-my-zsh overwrites `~/.zshrc`. That's fine — Step 5 replaces it
> again with the version from this repo (and backs up the oh-my-zsh one).

## Step 3 — Clone this repo and install the packages

```bash
git clone https://github.com/LiamShalom/dotfiles.git ~/dotfiles
cd ~/dotfiles
brew bundle --file=Brewfile
```

`Brewfile` carries everything the configs actually reach for — `starship`,
`eza`, `bat`, `zoxide`, `atuin`, `fzf`, `lazygit`, `git-delta`, `gnupg`,
`direnv`, the JetBrains Mono Nerd Font, Ghostty, plus the global npm and uv
packages. Skip it and the shell will load with a broken prompt and missing
aliases.

## Step 4 — Install fzf-tab

The only dependency Homebrew can't supply. `.zshrc` lists `fzf-tab` in
`plugins=(...)`, and zsh warns on every launch if it's missing.

```bash
git clone https://github.com/Aloxaf/fzf-tab ~/.oh-my-zsh/custom/plugins/fzf-tab
```

## Step 5 — Run the installer

```bash
./install.sh
```

Symlinks everything into place: `home/` lands flat in `$HOME`, and the nested
configs (Ghostty, starship, atuin, Claude, Codex) go to their real paths. Any
existing real file is moved to `<file>.bak` first, and the script is safe to
re-run — correct symlinks are left untouched.

Because these are symlinks, edits you make live (including ones tools write for
you, like `git config --global`) land straight in this repo. Check `git status`
here now and then.

## Step 6 — Create `~/.gitconfig.local`

Identity and machine-specific git settings stay **out** of this repo.
`home/.gitconfig` includes `~/.gitconfig.local` last, so anything here wins.

```bash
cat > ~/.gitconfig.local <<'EOF'
# Machine-specific git config — NOT tracked in the dotfiles repo.
[user]
	email = you@example.com
	signingkey = YOUR_KEY_ID
[commit]
	gpgsign = true
[core]
	pager = delta
[interactive]
	diffFilter = delta --color-only
[delta]
	navigate = true
[merge]
	conflictStyle = zdiff3
EOF
```

Verify it took (note: `git config --global` does **not** expand includes — read
the effective value without that flag, from outside any repo):

```bash
cd ~ && git config --get user.email && git config --get commit.gpgsign
```

## Step 7 — Restore GPG commit signing

Signing is on, so commits fail until the key is on the machine. Either import it:

```bash
gpg --import /path/to/your-private-key.asc   # from your backup / password manager
git config --file ~/.gitconfig.local user.signingkey YOUR_KEY_ID
```

…or turn signing off on this machine:

```bash
git config --file ~/.gitconfig.local commit.gpgsign false
```

## Step 8 — Authenticate Codex

`codex/config.toml` is a **redacted reference copy** — its
`experimental_bearer_token` is a placeholder, and the installer deliberately
does not symlink it. Let the Codex CLI write the real `~/.codex/config.toml`,
then diff the two if you want the MCP server list from here.

## Step 9 — Add the MCP servers to Claude Code

```bash
MINTLIFY_API_KEY=mint_... ./claude/mcp-servers.sh
```

Adds the remote MCP servers (Linear, Jam, PostHog, Figma, Vercel, Notion,
Intercom, internal dashboard, Mintlify) at user scope. Leave out
`MINTLIFY_API_KEY` to skip Mintlify. Then run `/mcp` in Claude Code and sign in
to each one. The local servers (Chrome DevTools, Firestore, Postgres read
replica) come with `sideshift-monorepo`'s `.mcp.json`.

## Step 10 — Reload

```bash
exec $SHELL -l
```

Ghostty picks its config up on `⌘⇧R`, or on next launch. One thing needs a human:
granting the global-hotkey permission for the quake terminal — see
[`ghostty/SETUP.md`](./ghostty/SETUP.md) Step 7.

---

## What's tracked

### Setup and migration

| Path | Purpose |
|------|---------|
| `bootstrap.sh` | Fresh Mac to working setup: command line tools, Homebrew, dotfiles, oh-my-zsh, `brew bundle`, `install.sh`, Claude Code + plugins + MCP servers, repos, `npm ci`, Xcode |
| `migrate/repos.txt` | The code repos to clone on a new machine |
| `migrate/check.sh` | Old Mac, read-only: lists unpushed commits and dirty worktrees |
| `migrate/pack.sh` | Old Mac: builds the handoff folder (bundles of local git work, ignored `.env` files, keys, Claude settings and memory) |
| `migrate/restore.sh` | New Mac, called by `bootstrap.sh`: unpacks the handoff folder |
| `migrate/START-HERE.md` | Instructions that travel inside the handoff folder |

### Shell and CLI (`home/` → `$HOME`)

| File | Purpose |
|------|---------|
| `.zshrc` `.zshenv` `.zprofile` | zsh: oh-my-zsh, `fzf-tab`, fzf key bindings, brew, cargo |
| `.extra` | aliases, PATH, functions — plus the starship/zoxide/atuin/eza/bat stack |
| `.gitconfig` `.gitignore` `.gitattributes` | git config + global excludes |
| `.vimrc` | vim config (expects a Solarized colorscheme) |
| `.editorconfig` `.wgetrc` `.python-version` | editor, wget, pyenv defaults |
| `.profile` | cargo env for non-zsh shells |
| `.hushlogin` | silence login banner |

The prompt is **starship**, not an oh-my-zsh theme — `ZSH_THEME` is empty on
purpose and `~/.config/starship.toml` drives it.

### Terminal (`ghostty/`)

| Path | Purpose |
|------|---------|
| `ghostty/config` | → `~/.config/ghostty/config`. Blazer theme with a hand-brightened ANSI palette, JetBrains Mono Nerd Font, quake terminal on `⌘`+`` ` ``, `⌘D`/`⌘⇧D` splits |
| `ghostty/SETUP.md` | Self-contained setup guide, verified on Ghostty 1.3.1. Hand it to an agent and it can do the whole thing |

### Tool configs (`config/` → `~/.config/`)

| Path | Purpose |
|------|---------|
| `config/starship.toml` | prompt: truncated dirs, git branch symbol, command duration |
| `config/atuin/config.toml` | shell history (`enter_accept`, record sync) |

### Agents (`claude/` → `~/.claude/`, `codex/` → `~/.codex/`)

| Path | Purpose |
|------|---------|
| `claude/CLAUDE.md` | Global instructions for Claude Code. `~/.codex/AGENTS.md` is symlinked to it, so Codex reads the same file |
| `claude/settings.json` | **Copied, not linked — auth token redacted.** Proxy env and model aliases, model, effort, hooks, statusline (wrapped by recompact), enabled plugins and their marketplaces, skill overrides. Re-copy the live file here (token redacted) after changing settings |
| `claude/statusline.sh` | custom status line |
| `claude/mcp-servers.sh` | **Run, not linked.** Adds the remote MCP servers at user scope (Step 9). The Mintlify key comes from the environment, never this repo |
| `claude/rules/` | always-on rules (Mintlify docs lookup) |
| `claude/skills/` | 17 skills; 11 are switched off in `settings.json` → `skillOverrides`. `skills/synced/` (org skills from claude.ai) is ignored |
| `claude/mods/` | Claude Code mods, loaded through `CLAUDE_CODE_PLUGIN_DIRS`. `ready-banner` draws a CLAUDE READY rule once the turn and all background agents finish |
| `claude/hooks/` | gcloud auth refresh, usage cap, worktree `CLAUDE.md` / `.env.local` linking |
| `claude/bin/` | worktree janitor + its guard, Chrome reaper. Linked per-file, since `~/.claude/bin` also holds a binary that isn't tracked here |
| `codex/config.toml` | **Reference copy, token redacted, not symlinked.** MCP servers, model, provider |
| `codex/rules/default.rules` | → `~/.codex/rules/default.rules` |

## What's intentionally NOT tracked

Secrets and machine state stay off GitHub, even though this repo is private:

- `~/.gitconfig.local` — email, GPG key, delta pager
- The `ANTHROPIC_AUTH_TOKEN` in `~/.claude/settings.json`
- `~/.claude/.credentials.json`, `history.jsonl`, `sessions/`, `projects/`,
  `logs/`, `telemetry/`, and the other runtime directories
- `~/.claude/bin/codeagent-wrapper` — a 5.7M compiled binary
- `~/.claude/settings.local.json` — machine-local permission grants that
  accumulate as you work
- The real `~/.codex/config.toml` auth token
- Shell/SQL/python histories, `.pgpass`, `.ssh`, `.gnupg`, `.docker`
- Generated caches (`.DS_Store`, `.zcompdump*`, `*.bak`)
