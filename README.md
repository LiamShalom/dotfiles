# dotfiles

Personal macOS dotfiles. A new machine is a clone away.

## Install

```bash
git clone https://github.com/LiamShalom/dotfiles.git ~/dotfiles
cd ~/dotfiles
./install.sh
exec $SHELL -l
```

`install.sh` symlinks everything in `home/` into `$HOME`. Any existing real
file is moved to `<file>.bak` first, and the script is safe to re-run.

## What's tracked

| File | Purpose |
|------|---------|
| `.zshrc` `.zshenv` `.zprofile` | zsh (oh-my-zsh, `gnzh` theme, brew, cargo) |
| `.extra` | aliases, PATH, functions sourced by `.zshrc` |
| `.gitconfig` `.gitignore` `.gitattributes` | git config + global excludes |
| `.vimrc` | vim config |
| `.editorconfig` | editor defaults |
| `.wgetrc` | wget defaults |
| `.profile` | cargo env for non-zsh shells |
| `.hushlogin` | silence login banner |
| `.python-version` | pyenv default |

## Secrets

Nothing secret is committed. `.zshrc` sources `~/.work` for machine-local
secrets/exports — that file is **not** in this repo; `install.sh` creates an
empty placeholder. Put per-machine tokens and exports there.

## Prerequisites (not installed by this repo)

- [Homebrew](https://brew.sh)
- [oh-my-zsh](https://ohmyz.sh) — `.zshrc` expects `~/.oh-my-zsh`
- `direnv` (`.zshrc` hooks it)
- vim Solarized colorscheme (referenced by `.vimrc`)
