# Handoff: send heavy agent jobs to the Mac Studio

Written 2026-11-17 by the "session status" session. Status: **blocked on Liam** (see "Blocked on").

## Goal (Liam's words)

Sessions sat for hours in Session Board's Working group with "waiting in the heavy-job queue".
Liam: "we just need to hand off heavy jobs to the mac studio". So: when an agent runs a heavy
command (full test suite, lint, preflight, iOS test), it should run on the Mac Studio instead of
waiting for one of the MacBook's queue slots. The agent must not notice: same output, same exit
code, same files written.

Do not move whole sessions to the Studio (Liam decided this 11-17).

## How the queue works

- `~/.claude/bin/heavy` (symlink to `~/dotfiles/claude/bin/heavy`) runs a command in one of N
  machine-wide slots (kernel `lockf` locks in `/tmp/agent-heavy-501/`). Pools: general `slot`
  (2), `build` for `next build` (1, waits for 35% free memory), `xcode` for iOS (2). It also
  waits up to 15 min while free memory is below 10%.
- The hook `~/.claude/hooks/heavy-gate.sh` wraps heavy agent commands in `heavy` automatically.
- `/tmp/agent-heavy-501/queued.<pid>` exists while a job waits. Session Board reads these files
  to show "waiting in the heavy-job queue".
- Count live waiters: for each `queued.<pid>`, check `ps -p <pid>`. Slot holders:
  `ps -Ao pid,etime,args | grep "lockf -s -t 0 /tmp/agent-heavy"`.

## Done already (all in dotfiles main, pushed)

1. **`99c961b`: slot holders run at normal priority.** `claude/bin/board-priority.mjs` moves all
   agent work to macOS background priority so Session Board stays fast. Background priority
   throttles disk access very hard. Measured: reading 400 files took 0.11 s at normal priority
   and 12.4 s in the background; a package build took 88 min. The two slots served 25 waiters
   for up to 6 h. Now a `lockf` slot holder and everything under it are promoted. Unit tests:
   `node --test claude/bin/board-priority.test.mjs`. After the restart the queue went from 25
   waiting to 12 in about 8 minutes.
2. **`bd757ef`: time limit per slot, and a hung-xcodebuild cleanup.**
   - `heavy`: a job may hold a slot for 45 min (iOS 60; `HEAVY_MAX_SECS` /
     `HEAVY_XCODE_MAX_SECS`). Then its whole process group is stopped and it prints "heavy:
     stopped after N min holding a slot". Tested with a fake job in pool `selftest`: stopped
     at 6 s with exit 143, no leftover processes. A normal job keeps its output and exit code.
     A cancel of the caller's process group stops the job and its watchdog.
   - `agent-reaper.mjs` stops an `xcodebuild` whose process tree gained under 5 CPU s in an
     hour (`XCODE_HUNG_MIN`). Checked with a `--dry-run` only: it listed the 4 live runs and
     stopped none.
   - Two hung iOS test runs (6.4 h and 3.9 h) were stopped by hand; the iOS slots freed.

Liam said "this isn't the right solution" about item 2. He wants the Studio handoff, and he did
not ask to revert. Keep items 1 and 2 unless he says to remove them: the Studio has a quarter of
the MacBook's memory, so local jobs still need them.

## Update 2026-11-18: network unblocked

The MacBook no longer runs the NordVPN desktop tunnel (Nord app open but disconnected,
`connectOnDemand = 0`; traffic exits via the office line 38.104.167.240/31). With that:
Tailscale is online, the Studio is online on a direct LAN path, SSH works
(`ssh -i ~/.config/sideshift-pool/macbook_ed25519 -o IdentitiesOnly=yes -o UseKeychain=yes
-o BatchMode=yes -o UserKnownHostsFile=~/.config/sideshift-pool/known_hosts sideshift@100.87.245.47`),
the Studio reaches Session Board's tailnet URL (401 sign-in gate), and the relay's
`check-nordvpn` still verifies 6 distinct IPs. Studio disk is 26% used, so the 10-26 "97% full"
note is stale. Items 1 and 2 below are resolved; the Design section can start.

## Shipped 11-19 ("tailscale migration" session) — on by default

- `claude/bin/heavy` `try_remote`: while a `slot`-pool job waits for memory or a slot, at most
  every 30 s it calls `claude/bin/heavy-remote.mjs`, which runs the job on the Studio via
  `claude/bin/heavy-remote-helper.sh` (uploaded to `~/heavy-remote/bin/helper-<hash>.sh`).
  `HEAVY_REMOTE=0` turns it off; `HEAVY_REMOTE_FORCE=1` tries the Studio first (testing).
  Unit tests: `node --test claude/bin/heavy-remote.test.mjs`. Log: `~/.claude/logs/heavy-remote.log`.
- Studio `~/heavy-remote`: `node24` (official v24.22.1; Studio Homebrew untouched), `mirror.git`
  (bare; MacBook pushes HEAD + origin/main), `work/<key>` one reused worktree per MacBook
  worktree (max 6, removed after a day idle), `installs/<lock hash>` cached npm install
  (built in the background on first use, ~35 s), 2 slots, refuses below 10 GB disk / 15% memory.
- Stays local: iOS/build pools; secrets/`.env`, `~`/`$HOME`/any variable from the agent's
  environment; local tools (gh, vercel, docker, curl, ssh); git state changes; devices;
  servers; installs; builds whose ignored output the Mac needs (`build:packages`, `tsc -b`);
  emulator/Postgres test scripts; `scripts/` runs other than the preflight and `scripts/ci/`;
  paths outside the worktree, `/tmp` and `~/.claude/jobs`.
- Verified e2e: preflight (same findings and exit code, 2 s vs 81 s), vitest file (identical
  output apart from timings, 1 s vs 52 s), exit codes, stdout/stderr, files written to /tmp and
  job dirs, worktree edits/ignored files/deletions copied back, Studio unreachable → local,
  SIGTERM and SIGKILL cancel stop the Studio job, pinned job clears its pinwait.
- The MacBook worktree's `.env.local` is synced to `~/heavy-remote/secrets/env.local` (mode 600, re-sent when it changes) and linked into each Studio worktree. 1Password is not synced: no queued job needs it, and the account is shared. Known differences: output that truncates a Studio
  path cannot be mapped back; remote start costs ~10-20 s (git status of the worktree + push).
- Studio disk is the limit (10-22 GB free, fluctuating). The Studio's Codex user has 45 GB in
  `~/.codex/tmp/google-ads-4341-e2e` (untouched since 10-05); deleting it is Liam's call.

## Blocked on (as of 11-17; resolved 11-18, see above)

1. **Network: this Mac cannot reach the Studio while NordVPN is connected.** Tailscale on this
   Mac reports `Online: false` and "Unable to connect to the Tailscale coordination server".
   NordVPN does not block the internet: through it, Tailscale's relay servers answer
   (`tailscale netcheck`: Ashburn 28 ms) and `curl https://controlplane.tailscale.com/key?v=71`
   returns 200 in 0.37 s. But Tailscale's own app cannot connect while both VPNs run. SSH to
   `100.87.245.47:22` times out. NordVPN has no command-line control.
   - Options given to Liam (he hasn't picked yet):
     1. **Recommended:** replace NordVPN with Tailscale's Mullvad exit-node add-on (about $5 a
        month for 5 devices). This costs real money, so it needs Liam's OK.
     2. Use the Studio as a free exit node. It doesn't hide location like NordVPN does.
     3. Pause NordVPN when the Studio is needed. The handoff would silently fall back to local
        most of the time.
   - **Never run `tailscale down`.** It carries Session Board to Liam's phone. See memory
     `never-turn-tailscale-off`.
2. **Unknown whether the Studio itself is up.** "Last seen 1 day ago" comes from this Mac's
   out-of-date network map. Check first, once Tailscale reconnects.
3. **Done:** Liam ran `ssh-add --apple-use-keychain ~/.config/sideshift-pool/macbook_ed25519`.
   The key `liam-macbook-pool` is in ssh-agent and its passphrase is in the macOS Keychain.

Do not confuse the Studio with "Don's Mac Studio" on the office LAN (`Dons-Mac-Studio.local`).
Its SSH host key differs from the saved Studio key, so it is someone else's machine. Do not
touch it.

## Studio facts (from memory `mac-studio-host-facts`, as of 10-26 unless noted)

- `ssh -o UserKnownHostsFile=~/.config/sideshift-pool/known_hosts -o BatchMode=yes sideshift@100.87.245.47`
  (connection file `~/.config/sideshift-pool/connection`). Non-interactive SSH has no Homebrew
  on PATH: run `export PATH=/opt/homebrew/bin:$PATH` first.
- 36 GB RAM, 14 cores, 460 GB disk. **The disk was 97% full on 10-26.** Check and clear it first.
- node 26.3. The monorepo uses node 24 (`/opt/homebrew/opt/node@24`), so install `node@24` there.
- Xcode and simulators were not checked. No Chrome, no 1Password CLI.
- The user `sideshift` is shared with the old shiftpool gateway (`com.shiftpool.app`, port 20129).
  Don't break it.
- The monorepo checkout there was 639 commits behind on 10-16.

## Design (not started)

Add a remote path inside `heavy`. Before it waits for a local slot, for the `slot` pool and
later `xcode` (never `build`: a `next build` needs 40-60 GB):

1. If the Studio answers (`ssh -o ConnectTimeout=3 -o BatchMode=yes … true`) and has free remote
   slots (use `lockf` slots on the Studio, the same pattern as local), run the job there.
   Otherwise fall back to the local queue unchanged.
2. **Code:** find the job's git root. Send its HEAD commit to a mirror repo on the Studio
   (`git push` over the same SSH; the commit may be unpushed to GitHub). Check it out in a
   per-job directory. Then rsync the uncommitted and untracked files on top
   (`git ls-files -m -o --exclude-standard`).
3. **Packages:** keep one cached install per `package-lock.json` hash on the Studio. Copy it into
   the job directory with `cp -cR` (an instant APFS clone). Run `npm run build:packages` there.
4. **Secrets:** do not copy `.env.local` or other secret env files. The `sideshift` user is
   shared. Jobs that need secrets stay local; decide how to detect them.
5. **Paths (open problem):** agent commands often use absolute local paths, for example
   `cd /Users/liamshalom/sideshift-monorepo/.claude/worktrees/x && …`, `--config /private/tmp/…`,
   or `> /Users/liamshalom/.claude/jobs/<id>/tmp/preflight.txt`. Those don't exist on the
   Studio. Plan: rewrite the local paths to remote paths in the command string, run it, then
   rsync back the files the job wrote under those paths. If a command refers to a path that
   cannot be mapped, run the job locally.
6. Stream stdout and stderr live over SSH and return the remote exit code. Pass on a cancel:
   SSH with `-tt` or an explicit kill of the remote process group.
7. Keep the time limit from `bd757ef` for remote jobs too.

## Done when

- A real monorepo job from an agent worktree, such as a vitest file run and an
  `agent-preflight`, runs on the Studio. Its output and exit code match a local run, and the
  files it writes to local absolute paths exist locally afterwards.
- With the Studio unreachable, the same command runs locally with no visible change.
- Cancelling the agent's command stops the remote process.
- Sessions no longer pile up in "waiting in the heavy-job queue": measure the waiters over a
  busy hour.
- Committed and pushed to dotfiles main. Update memories `mac-studio-host-facts` and
  `board-priority-agent-work-background`.

## Rules that apply

- Never launch another Chrome, never `tailscale down`, and ask Liam before anything that spends
  real money (the Mullvad add-on).
- One command per Bash call. Commit dotfiles changes yourself and push main.
