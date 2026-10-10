# New Mac setup

This folder came from your old Mac. It contains your **private SSH and GPG keys
and API tokens**. Keep it off shared drives, and delete it from both Macs when
setup is finished.

## Do this

1. On the new Mac, sign in with your Apple ID and the **App Store** (Xcode
   installs from there).
2. On the old Mac, open your home folder in Finder (⌘⇧H), right-click
   `new-mac-handoff`, and choose **Share → AirDrop**. On the new Mac it lands in
   `~/Downloads/new-mac-handoff`. Don't move it to Desktop or Documents if
   those sync to iCloud.
3. Open **Terminal** (the built-in one) and run:

   ```bash
   bash ~/Downloads/new-mac-handoff/bootstrap.sh
   ```

4. Answer the prompts: your Mac password, the command line tools window,
   the `gh` browser login, and the gcloud logins. The rest runs by itself. The
   whole run takes 30 to 60 minutes, mostly in `brew bundle` and `npm ci`.
5. When the script prints **Summary**, open **Ghostty** and do the items listed
   under "Still by hand".

If a step fails, fix the cause and run the same command again. Finished steps
are skipped.

## What it does, in order

| Step | Result |
|------|--------|
| Command line tools, Homebrew | `git`, `brew` |
| Dotfiles | `~/dotfiles`, cloned from `dotfiles.bundle` in this folder (so it works before GitHub access is set up), then pointed at GitHub |
| Restore home files | `~/.ssh`, `~/.gnupg` (commit signing), `~/.gitconfig.local`, `~/.claude/settings.json` (gateway token), Claude memory, `~/.config/sideshift` (the monorepo `.env.local` points here), `~/.codex/config.toml`, shell history. Files that already exist on the new Mac are not overwritten |
| oh-my-zsh, fzf-tab | shell plugins |
| `brew bundle` | every CLI tool and app from `~/dotfiles/Brewfile`, including Xcode through `mas` |
| `install.sh` | config symlinks: zsh, git, Ghostty, starship, Claude rules/skills/hooks/mods |
| Claude Code | native installer, the recompact and security-guidance plugins, every MCP server |
| Repos | clones the 4 repos, then adds back all local work from the old Mac (see below) |
| `npm ci` | `node_modules` in each JS repo |
| Xcode | selects it, accepts the licence, optionally downloads the iOS simulator |

## Your local work from the old Mac

For each repo, `repos/<name>/` holds:

- **Every local branch**, including ones that were never pushed. Branches that
  are already on GitHub come back at the old Mac's version.
- **Every stash**, in the same order (`git stash list`).
- **Worktrees that had local work**: they are rebuilt at the same paths
  (`~/sideshift-worktrees/...` and the others). Worktrees with nothing local
  are skipped, because their branch is on GitHub. Recreate one with
  `git worktree add <path> <branch>`.
- **Uncommitted changes**, put back as uncommitted changes. The main checkout
  gets its untracked handoff docs and modified files back the same way.
- **Gitignored files worth keeping**: `.env*`, `.claude/settings.local.json`,
  local-only skills and plans, `.superpowers/`, `.vercel/`.

Not carried, because they are large or rebuilt by tools: `node_modules`, build
output, `graphify-out/`, `.claude-scratch/` (1 GB) and `scripts/.exports/`
(2.9 GB of data exports). Copy those by hand if you need them.

Every restored ref is also kept under `refs/remotes/old-mac/*` (branches) and
`refs/old-mac/*` (stashes, worktree heads, WIP snapshots), so nothing can be lost
by a later checkout. Delete them when you no longer need them:

```bash
git for-each-ref --format='%(refname)' refs/old-mac refs/remotes/old-mac | xargs -n1 git update-ref -d
```

Two old worktrees, `fix-google` and `fix-snapchat`, were in the middle of a
conflicted merge or rebase. They come back with the conflict-marker files in
place, but git no longer knows that a merge was in progress.

## Still by hand

- **Claude Code**: run `claude` in `~/sideshift-monorepo` and accept the folder
  trust prompt. Then run `/mcp` and sign in to each server that asks. The gateway
  token is already in `settings.json`, so no Claude login is needed.
- **Codex**: `codex login`. **Vercel**: `vercel login`. **Firebase**: `firebase login`.
- **Permissions**: open Docker, Raycast, Rectangle, BetterDisplay, Logi Options+
  and boringNotch once, and allow what they ask for (Accessibility and so on).
- **Ghostty** quake hotkey: `~/dotfiles/ghostty/SETUP.md`, Step 7.
- **Not installed by the script**: GarageBand, iMovie, Keynote, Numbers, Pages
  (App Store, if you want them), Grok, Vorssaint and "Studio by Spotify Labs"
  (no Homebrew package, so download them by hand).
- **Browsers**: sign in to Arc and Chrome to sync them. The script does not
  copy browser profiles.
- **Keychain**: items in the login keychain sync only if iCloud Keychain is on.
- **macOS settings** (Dock, trackpad, keyboard) are not scripted.

## Session history (optional)

The pack leaves out Claude session transcripts (8 GB), so `claude --resume`
starts empty. Your **memory** does come across. To carry the transcripts as well,
run `~/dotfiles/migrate/pack.sh --with-transcripts` on the old Mac.

## Different username

Claude memory folders are named after the old path
(`-Users-liam-sideshift-sideshift-monorepo`). If your home folder on the new Mac
has a different name, rename the folders in `~/.claude/projects/` to match the
new path. Also update the `statusLine` command in `~/.claude/settings.json`,
which uses an absolute path.
