# dotfiles

Personal macOS dotfiles. A new machine is a clone away.

Follow the steps below in order to bring a fresh Mac up to your usual shell,
git, and editor setup.

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

## Step 2 — Install prerequisites

These are referenced by the dotfiles and are **not** installed by this repo:

```bash
# oh-my-zsh — .zshrc expects ~/.oh-my-zsh
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"

# CLI tools sourced/used by the configs
brew install direnv git vim
```

> Note: installing oh-my-zsh overwrites `~/.zshrc`. That's fine — Step 4
> replaces it again with the version from this repo (and backs up the
> oh-my-zsh one to `~/.zshrc.bak`).

## Step 3 — Clone this repo

```bash
git clone https://github.com/LiamShalom/dotfiles.git ~/dotfiles
cd ~/dotfiles
```

## Step 4 — Run the installer

```bash
./install.sh
```

This symlinks everything in `home/` into `$HOME`. Any existing real file is
moved to `<file>.bak` first, and the script is safe to re-run (correct symlinks
are left untouched). It also creates an empty `~/.work` placeholder for
machine-local secrets (see Step 6).

## Step 5 — Reload the shell

```bash
exec $SHELL -l
```

You should now have the `gnzh` theme, all aliases from `.extra`, and `direnv`
hooked in.

## Step 6 — Add machine-local secrets

`.zshrc` sources `~/.work`, which is **not** in this repo (so no secrets are
ever committed). Put per-machine tokens and exports there:

```bash
cat >> ~/.work <<'EOF'
export SONAR_TOKEN="…"
# export OTHER_TOKEN="…"
EOF
```

## Step 7 — Restore GPG commit signing (optional)

`.gitconfig` has `gpgsign = true` with `signingkey A61540BF4938459B`. Until that
key is on the new machine, commits will fail to sign. Either import the key:

```bash
brew install gnupg
gpg --import /path/to/your-private-key.asc   # from your backup / password manager
```

…or disable signing on this machine:

```bash
git config --global commit.gpgsign false
```

---

## What's tracked

| File | Purpose |
|------|---------|
| `.zshrc` `.zshenv` `.zprofile` | zsh (oh-my-zsh, `gnzh` theme, brew, cargo) |
| `.extra` | aliases, PATH, functions sourced by `.zshrc` |
| `.gitconfig` `.gitignore` `.gitattributes` | git config + global excludes |
| `.vimrc` | vim config (expects a Solarized colorscheme) |
| `.editorconfig` | editor defaults |
| `.wgetrc` | wget defaults |
| `.profile` | cargo env for non-zsh shells |
| `.hushlogin` | silence login banner |
| `.python-version` | pyenv default |

## What's intentionally NOT tracked

Secrets and machine-specific state stay off GitHub: shell/SQL/python histories,
`.pgpass`, `.ssh`, `.gnupg`, `.docker`, app state (`.claude.json`), generated
caches (`.DS_Store`, `.zcompdump*`), and `~/.work` (machine-local secrets).
