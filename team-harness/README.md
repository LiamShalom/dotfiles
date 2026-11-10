# SideShift Claude Code harness

Liam's Claude Code setup, for the team: the global instructions, skills, hooks,
the verifier agent, status line and UI mods. It also has the Codex twin of each.

The monorepo's own skills (`bugfix`, `ship-it`, `verify`, `pr-approve`, `prfix`,
`messaging-compat`, ...) are in `sideshift-monorepo/.claude/` and come with
`git pull`. This package is the personal layer that sits on top of them.

## Install (macOS)

```bash
git clone <this repo> ~/sideshift-claude-harness   # or unzip it there
cd ~/sideshift-claude-harness
./install.sh                    # skills, hooks, agents, CLAUDE.md, settings
./install.sh --with-mcp         # optional: MCP servers (list below)
./install.sh --with-launchd     # optional: scheduled cleanup jobs + one shared Firestore/Postgres MCP
```

`--with-mcp` adds, at user scope: Linear, Jam, PostHog, Figma, Vercel, Notion,
Intercom, Context7, the internal dashboard (`sideshifters.vercel.app/mcp`) and
`chrome-devtools` (the shared agent Chrome). It backs up `~/.claude.json` to
`~/.claude.json.pre-harness` first. Without `--with-launchd` it does not keep the
two database servers, because they need the launchd jobs; the monorepo's own copies
stay on. A database server you already had at user scope is never removed.

`--with-launchd` loads these jobs:

- **maintenance sweep** (every 15 min): removes worktrees of merged or closed PRs
  and abandoned headless agent Chromes; a full janitor pass when free disk drops under 80 GB.
  It never removes a worktree with an open PR, unpushed commits, a running process or
  recent edits, and archives uncommitted changes first (archives are kept 60 days).
- **maintenance daily** (04:00): fast-forwards local `main` in the repos in
  `migrate/repos.txt`; drops stale `.next` caches and the `node_modules` of idle worktrees.
- **maintenance weekly** (Sun 03:30): retires worktrees idle 14 days, deep-cleans caches
  (`.next`, `node_modules`, Xcode DerivedData, simulator clones), runs `brew autoremove`,
  `brew cleanup --prune=all`, `docker image prune` and `docker builder prune`, and deletes
  worktree archives older than 60 days.
- **agent reaper** (every 5 min): stops agent dev servers with no client for 2 hours or
  over 12 GB, simulators idle 20 minutes, agent Chrome tabs unused 6 hours, background
  tasks of ended sessions, and Docker containers with no traffic for 24 hours.
- **shared MCP servers**: one Firestore and one Postgres read-replica server for every session.

Keep it at `~/sideshift-claude-harness`: skills and hooks refer to that path.
Set `MONOREPO=/path/to/sideshift-monorepo` if your checkout is not in `~`.

Needs: `claude`, `node` (24), `git`, `jq`, `gh`. Then open a new session and run
`/plugin` to add `segment-recompact` and `security-guidance` if they are missing.

What the installer changes:

- Symlinks `CLAUDE.md`, `statusline.sh` and each skill, agent, rule, script, hook,
  mod and theme into `~/.claude/`, one item at a time. Your own items with other
  names stay. A file of the same name moves to `<name>.bak` (or `<name>.bak.<time>`
  if that exists). Skills and agents of the same name move to `~/.claude/harness-backup/`
  instead, so they do not load twice. Nothing is deleted.
- Merges `claude/settings.json` into your `~/.claude/settings.json`. The first time,
  your original is saved as `settings.json.pre-harness`; re-runs never replace it.
  Yours wins on `env` values, `model`, `theme` and `tui`. The harness hooks are added
  beside your own hooks. The harness sets `permissions.defaultMode` (see below),
  plugins, `skillOverrides` and the status line.
- For Codex: links `~/.codex/AGENTS.md` to the same `CLAUDE.md`, each skill into
  `~/.agents/skills`, each agent and hook into `~/.codex/agents` and `~/.codex/hooks`,
  and `~/.codex/hooks.json` and `~/.codex/rules/default.rules` (old copies to `.bak`).

To update: `git pull` here, then `./install.sh` again. To undo: delete the symlinks,
restore the `.bak` files and `settings.json.pre-harness` (and `~/.claude.json.pre-harness`
after `--with-mcp`).

## Read this before you install

- **Permissions are off.** `settings.json` sets `defaultMode: bypassPermissions`.
  Claude runs commands and edits files without asking. The hooks are the guard rails
  (no printed tokens, heavy-command queue, merge gate, finish check). If you want
  prompts, delete `permissions.defaultMode` from your settings after install.
- **`CLAUDE.md` is written in Liam's voice** ("me", "my accounts"). Read it as your
  own rules. It is strict on purpose: verify before claiming, finish the job, never
  test on personal social accounts, ask before real money.
- **The finish check** (`hooks/finish-judge.sh`) runs a second, cheap model at the end
  of each turn and can send Claude back to finish. It uses your `claude` login.

## What is in it

| Part | What it does |
| --- | --- |
| `claude/CLAUDE.md` | Global instructions: verify first, finish the job, merge rules, testing rules, browser rules |
| `claude/skills/` | `brainstorm` → `design` → `execute` for features; `quick-fix` for bugs; `proof`, `blast-radius`, `ketchup`, `correct`, `visual-companion`. Off by default (enable in `skillOverrides`): `codebase-design`, `domain-modeling`, `git-guardrails-claude-code`, `graphify`, `handoff`, `mcp-builder`, `shalomify`, `skill-creator`, `systematic-debugging`, `test-driven-development`, `to-tickets`, `wayfinder` |
| `claude/agents/skeptical-verifier.md` | Independent reviewer that re-runs checks and returns PASS/FAIL |
| `claude/hooks/` | Guard rails: token-print block, heavy-command queue (`heavy`), iPhone-only simulator, merge-after-review gate, UI copy check, worktree `.env.local` linking, finish check |
| `claude/bin/` | `heavy` (shared build/test slots), agent Chrome + DevTools MCP, `run-until-done`, `page-snapshot.mjs`, worktree janitor, maintenance, `pr-checks-green` |
| `claude/mods/` | Terminal UI mods: ready banner, session names, status line under dialogs, sidebar folders |
| `claude/references/ui-taste.md` | Product UI taste notes the design skills read before UI work |
| `claude/learning/ledger.md` | Empty: the `correct` skill logs your own lessons here |
| `codex/` | Codex agents, hooks and rules. `codex/config.toml` is a reference copy; set your own paths and keys |
| `launchd/` | Templates used by `--with-launchd` |

## What needs your own accounts

- **Claude login.** No gateway or token ships here. Sign in with your own account.
- **Test credentials.** `~/sideshift-monorepo/.codex/with-test-secrets` reads the
  1Password vault `Agent-Test`. Ask Liam for access, then run
  `.codex/with-test-secrets --refresh` once.
- **Session Board** (Liam's desktop app, `~/session-board`) is optional. Skills that
  hand pages to "the pane" fall back to `open` when it is not running. Ask Liam for
  repo access if you want it.
- **MCP sign-ins.** After `--with-mcp`, run `/mcp` and sign in to each server.

Left out on purpose (personal to Liam): the 1Password `agent-login` skill and its
Gmail/SMS code readers, `slack-as-liam`, the nightly Android port job, the weekly
learning job, his correction ledger, his memory, and his Claude and Codex model
gateways. No tokens or keys are included. Where the instructions used to send the agent
to `agent-login`, they now say to sign in with the SideShift test credentials.

## Rebuild from Liam's dotfiles

`tools/build.sh [out-dir]` regenerates this folder from `~/dotfiles` and the live
`~/.claude/settings.json`, with the same exclusions. `tools/` also holds the sources
of `install.sh` and this README.
