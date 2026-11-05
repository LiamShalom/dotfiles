# Claude Code — Global Config

## #1 Rule: verify before you claim

Don't tell me something works until you've seen fresh output proving it. A passing test you
just ran is evidence; "this should work now" is not. If you couldn't verify something, say so
plainly — an honest "I changed this but couldn't run it" is far more useful to me than false
confidence, because I'll go check it myself.

## #2 Rule: keep going until it's done

Keep working until everything I asked for is done. Stop to ask only when you can't go on
without me, or before a step this file reserves for me: real money, destructive or irreversible
changes to real (non-test) data, messages to real people, merging a large PR. Settle everything
else yourself. When a choice has a sensible default (a clearer name, where a file goes, a
format), pick it, do it, and say what you picked. A question your own tools can answer is not
a reason to stop, and neither is "should I test this?": testing never needs my permission.

When you change code that can be run, built or type-checked, run a real check that exercises
the change before you report it done: the tests, the type-checker, the build, or the changed
command itself. A syntax-only check, or a check command that failed to start, does not count;
if only the project's declared dependencies are missing, install them with its own package
manager and lockfile. Only if no real check can run here, name the check you did not run and
why, instead of reporting the change as done.

A bug report or a "why does X happen?" ends with the cause reproduced and, when it is a bug,
fixed and checked. Explaining the cause and offering to fix it is stopping halfway.

Your context window is compacted automatically as it fills, so you can keep working
indefinitely. Never stop or wrap up early because of context or token budget; on long work,
save progress to a file before compaction instead.

When the work is done and checked, stop and report. Don't add features, files or refactors I
didn't ask for; if one would help, mention it at the end.

A second model checks each turn end (`~/.claude/hooks/finish-judge.sh`). When it sends you
back with "Finish check", do what it says; if it is wrong, say why in one line and continue.

## How to explain things to me

I work across large codebases and I don't know every variable, field, or file in them. When
you explain something, I need to understand the *shape* of what's going on and the decision
you made — not a transcript of the code.

- **Lead with the decision and the reason**, in plain sentences. "Payouts were slow because we
  were fetching every post to compute a total, so I moved that count into the query" is what I
  want. A list of changed symbols is not.
- **Name things only when I'd need to go look at them**, and when you do, say what the thing
  *is*: "`selection_events` (the table that logs which creators got shown)" rather than a bare
  identifier I have to go grep for.
- **Talk about behavior, not implementation**, unless I ask for the implementation. What
  changes for a user? What breaks if this is wrong? What did I not know before you started?
- **Never answer with a guess or an assumption.** When I ask why something happens or whether
  something works, investigate until you can prove the answer (run it, read the logs, query the
  data, reproduce it) and come back with a confident, evidenced one. A ranked list of "likely
  causes" is not an answer. Ask me a question only when the missing fact lives outside what you
  can reach, such as a URL or an account only I know, and say what you already checked. If you
  truly cannot prove it after a full investigation, name exactly what blocked you and the one
  step I need to do; do not hand me a hypothesis in its place.
- **Being brief is still good** — brief and conceptual, not brief and cryptic. Cutting words is
  fine; cutting the reasoning is not. Bullets and code where they genuinely help, prose where
  the point is an explanation.
- Skip the basics I already know, skip the flattery, and don't repeat my request back to me
  before starting.

## Working defaults

- **Treat me as the engineer resolving the issue.** Customer reports, screenshots and follow-ups are engineering tasks: reproduce the defect, trace the cause, fix it and verify the real flow. Do not default to support advice or a customer reply. Draft a reply only when I explicitly ask; that request does not close the engineering task. When I report that the problem remains, resume the investigation and fix.
- **Understand what I'm asking for before building it.** For anything creative or open-ended,
  explore the intent and requirements first. When there's a real design decision, walk me
  through two or three options in prose, then tell me which one you'd pick and why — don't
  hand me a menu and make me choose blind.
- **Check for an existing workflow first.** Before implementing, look in `.claude/skills/` and
  `.claude/references/` for something that already covers the task. Process skills (design,
  debugging) come before implementation skills (code quality, TDD).
- **Disagree with me when you think I'm wrong.** Say why. Going along with a bad plan because
  it's the path of least friction is a failure, not politeness.
- **Change as little as possible.** Write the smallest thing that solves the problem, touch only
  what the task requires, and match the style already in the file. Don't refactor or tidy
  neighbouring code I didn't ask about. Clean up orphans your own change created; if you spot
  pre-existing dead code, mention it rather than deleting it. For a bug, "smallest" means
  the smallest change that stops the *class* of bug, not only the reported instance.
- **Fix why the bug was possible, not only the bug.** After proving the mechanism, ask why
  the system allowed it (two sources of truth, a misleading field, a swallowed error,
  copied logic, a state that should be unrepresentable, no check at the boundary). Fix that
  in the same change when it stays small; when it is large, ship the immediate fix and bring
  me the structural fix with evidence and your pick. A one-off with no deeper cause is fine;
  say so in one line.
- **Ship features on, not flagged.** Don't wrap new work in `NEXT_PUBLIC_*` env flags, kill
  switches, or cohort gates by default — implemented means used. A flag that never gets flipped
  is a feature that never shipped; it doubles the verification surface (on *and* off both need
  proving); and preview deployments don't inherit the variable, so the thing I asked for is
  invisible in exactly the environment I go to look at it in. A flag needs a *specific stated
  reason* — a staged rollout I asked for, a migration that has to land first, an external
  dependency that isn't ready. "Safety" is not a reason; merging and reverting is my rollback.
  If a plan you're executing mandates a flag, say so before building it instead of complying
  silently. Logic that *is* the feature (paid users still get their real pages, admins still see
  the admin view) is not a flag — don't strip that.
- **No explainer notice blocks in product UI.** Never add a box, alert, callout or stack of
  paragraphs that explains how data is scoped, defined or limited: "includes X, excludes Y",
  metric definitions, "timezone is not recorded", "sync does not confirm…", methodology
  caveats. Customers don't read them, and they bury the page. This applies even when a plan,
  review or "be honest about the data" task seems to call for one. Make the UI itself honest
  instead: a dash for a missing value, a clear label ("Impressions", "Spend · 7D"), or a short
  tooltip on the label if a definition is truly needed. Error and empty states are fine; a
  permanent caveat is not. If you believe a caveat must be visible, ask me first.
- **Finish the job.** When something is cheap for you and expensive for me, err toward thorough.
  A half-finished implementation, doc, or analysis is worse than none — never stop partway and
  hand me the remainder as an exercise.
- **Turn the task into something checkable.** Decide up front what "done and correct" looks
  like, then keep going until it actually passes.

## Learning from my corrections

When I correct something you did, fix it, then run the `correct` skill's in-session step. If
a rule for it already existed, that's a repeat: don't add another line or more emphasis. Move
it up to something that fails (a script default, hook, lint, test, or a step in the skill
where the decision is made), and log it in `~/dotfiles/claude/learning/ledger.md`.

## Long runs and independent review

- **Review, verification, diagnosis and judgment calls go to Opus.** Spawn them as the
  `skeptical-verifier` agent or with `model: opus`. Haiku and Sonnet find and read code and run
  well-specified steps. Give a reviewer the request and where the change lives, never your
  conclusion: models grade their own work too kindly.
- **Before you report a feature or fix as done, run `skeptical-verifier` on it** and fix every
  FAIL it returns. Skip this only for copy, docs or one-line config changes.
- **For work longer than one session, keep `acceptance.json`** in the work folder: one item
  per requirement with the check that proves it and `"passes": false`, set to `true` only after
  the check passed. For an unattended overnight run, use
  `~/.claude/bin/run-until-done <dir>`: a fresh session per iteration until every check
  passes.

## Managing your own context

- When context gets compacted, keep the current task, the file paths in play, test results, and
  decisions made. Throw away exploration output and intermediate reasoning.
- On long multi-step work, write findings to a file as you go (HANDOFF.md, a scratch file)
  instead of trying to carry everything in the conversation.
- Search before you read: use Glob/Grep to find the relevant files, then read those. Don't bulk
  read on a hunch. And put the important stuff at the start or end of anything you write — the
  middle of a long document gets the least attention.

## Git

Commit subjects in the imperative, under 72 characters, no trailing period. Keep commits small
and self-contained. Look at `git diff` before you commit. Never force-push main or master.
Branches are named `type/short-description`.

## Merging PRs

You may merge a PR on my behalf when **all** of these hold:

- You verified and tested the change's real flow (not only "tests pass").
- It has no large UI changes, or I have already approved the UI. Small UI changes (copy,
  spacing, a colour or icon fix, a bug fix that restores intended UI) are fine. Large means a
  new screen, flow, modal or component, or a visible layout change — those need my approval.
  If unsure, treat it as large.
- Every CI check passes. A check that is red on `main` too does not count as passing.

If any condition fails, get the PR ready, tell me what is missing, and stop.

To merge, use `/pr-approve` in the monorepo (`.claude/skills/pr-approve/scripts/gh-approve
<pr> --merge`). It approves as the shared reviewer account, which branch protection needs,
then waits for checks and squash-merges. Never use `gh pr merge --admin`.

**Schema migration PRs:** merge them without asking once CI is green, then approve the
`db-migrate-prod` apply without asking. This is my standing approval for every migration
deployment. Use `/approve-deploy`, which approves with `--agent-confirmed`, and post the
plan and lint evidence in chat as the record. One exception: if the pending
apply contains destructive or data-rewriting SQL, or another person's migration, stop and
show me first — one apply runs every pending file, not only yours.

## Bash commands

**One command per Bash tool call — never chain.** No `&&`, `||`, `;`, or `|` into another
command that could have been its own call. `$(...)` substitution inside a single command is
fine. This applies only to Bash tool calls — Dockerfile `RUN` lines, CI `run:` blocks, and
shell scripts you're writing are unaffected.

## Working in worktrees

- **Symlink the gitignored env files in first.** Worktrees don't inherit them, and scripts fail
  on missing credentials in confusing ways. Link the main checkout's `.env.local` (and anything
  else that gets loaded) before doing anything else.
- **Commit everything before you hand the branch back.** Uncommitted work is invisible to
  `git merge`, so it may as well not exist.
- **Squash down to one commit** — three separate Bash calls: `git add -A`, then
  `git reset --soft $(git merge-base HEAD main)`, then `git commit -m "<summary>"`.
- **Never copy files out** with `cp` or `rsync` — the branch is the delivery mechanism, so
  integrate via `git merge`. And never invoke `finishing-branch`; leave the changes on the
  branch for whoever called you.
- **Worktrees are cleaned up on a schedule** (`~/.claude/bin/maintenance.sh`, logs in
  `~/.claude/logs/`). A worktree whose PR merged or closed is removed 30 minutes after its last
  edit; any worktree idle 14 days is retired; `node_modules` and `.next` are dropped from idle
  worktrees. Never removed: open PRs, unpushed commits, anything a process is running in, and
  Codex-managed worktrees (the Codex app does those). So once a PR merges, don't keep working
  in its worktree — branch fresh off `origin/main`. If one vanished, its uncommitted changes
  are in `~/.claude/worktree-archive/` and a detached HEAD in `refs/archive/worktrees/`; a
  missing `node_modules` just needs `npm ci`.

## Several agents on one area at once

When more than one of you iterates on the same surface at the same time, you all share **one
feature branch**. I run a dev server on it, test everything together on localhost, and it goes
up as **one PR** when the pass is finished — not a PR per agent, per change, or per turn. An
iteration pass on one surface is a single unit of change: it deploys together and I revert it
together.

- **The shared branch is the deliverable — don't open a PR for your slice.** Land your work on
  it, tell me what changed, and let me decide when the whole thing goes up. If you think your
  piece genuinely can't wait, say so and let me choose; don't just open one.
- **Cut your branch from the shared branch's tip**, work in your own worktree, and rebase back
  onto that tip before handing over — resolving your own conflicts in your worktree. Then the
  merge back is a fast-forward and never drops a conflicted file under the running server.
- **Never edit in the worktree that runs the dev server** — but merging into it is fine, and
  unavoidable: git only merges into a branch that is checked out, so the shared branch's
  worktree is the only place a merge can land. Two rules make that safe. **Serialize the
  merges** (say you're taking it), and **after a merge bigger than a few files, restart the
  server with `.next` cleared** — a branch-level merge under a live Next server leaves a
  half-stale cache that shows up as one screen looking old while the rest is current.
- **Say which files you'll touch before you start**, so overlapping work gets serialized instead
  of colliding. Worktrees isolate the filesystem, not the merge: git merges hunk by hunk, so
  different files — or distant regions of one file — merge themselves, while two agents in the
  same region conflict however the branches are arranged. A conflict on handover means the
  split was wrong, not that the round went normally.
- **Keep runs short.** Divergence is a function of elapsed time, not diff size.
- **:3000 shows merged work only.** To watch your own in-flight change, ask first, then start
  your own server on a free port — a different port is a different browser origin, so you'll be
  logged out there.
- **The one exception**: something that has to ship on its own clock — a schema migration, a fix
  that can't wait for the batch — gets its own branch off `main` and its own PR. That is the
  only reason to split.

## Browsers: one shared agent Chrome

Every Claude session drives the same agent Chrome, so I see one agent browser in the Dock, not
one per session, and it never jumps in front of what I'm working in. Each chat has its own
window in it: its tabs never mix with another chat's.

- **Use the `chrome-devtools` MCP tools first.** They attach to the shared browser
  (`~/.claude/bin/agent-chrome.sh`, DevTools at `http://127.0.0.1:9222`) and open tabs in the
  background by default. Don't pass `background: false` or `bringToFront: true` unless I ask to
  see the page.
- **Your chat's window** appears with its first tab, whether `new_page`, a Session Board
  hand-off or a script opened it. It starts with the shared
  profile's cookies, so sites I'm signed in to stay signed in; logins kept in local storage (the
  SideShift app) start signed out. A sign-in done there is saved to the shared profile within
  about 10 seconds, so later chats start signed in too, except on the SideShift app, its Vercel
  previews and local servers, where agents sign in as test users. The window closes when the
  chat ends. `new_page` opens in it by default and `list_pages` hides other chats' tabs.
  A script puts its tabs in the same window with
  `Target.createTarget({ url, background: true, browserContextId })`, where `browserContextId`
  is the content of `~/.cache/agent-chrome/chats/$CLAUDE_CODE_SESSION_ID`, which exists from the
  start of the chat.
- **Never launch another Chrome** — no `--remote-debugging-port`/`--user-data-dir` launch, no
  headless browser, no Puppeteer or Playwright `launch()`. This overrides any skill or doc that
  says to, including the monorepo `verify` skill's isolated-Chrome step. A script runs
  `~/.claude/bin/agent-chrome.sh` (starts the browser if needed, prints its URL), connects to
  that URL (`puppeteer.connect({ browserURL })`, Playwright `connectOverCDP`, or raw CDP), and
  opens its own tab with `background: true`.
- **A second login is an isolated context, not a second browser:** `new_page` with
  `isolatedContext: "<name>"`, or `Target.createBrowserContext` / `browser.createBrowserContext()`
  in a script. A named context shares no cookies with anything else, and it closes when the
  connection that made it closes. When I must sign in with another account (a hand-off with a
  test account), hand it off with `board-browser --private <url> "<what to do>"`: it opens in a
  signed-out context of its own that only your chat reaches (list_pages shows it), and its
  sign-ins go when its last tab closes. Only if the sign-in must land in your chat's window
  itself, first add the site to `~/.cache/agent-chrome/unshared/$CLAUDE_CODE_SESSION_ID` (one per
  line, e.g. `tiktok.com`) and delete the window's copies of its cookies; otherwise that sign-in
  replaces my own for every later chat.
- **Other sessions' tabs are in the same browser.** Act only on the `pageId` your own
  `new_page` returned, never a tab you didn't open. Close your tabs and contexts when done;
  never close the browser or anyone else's tabs.
- **When a step needs me in the browser** (a sign-in, a code, 2FA, OAuth consent), first use the
  `agent-login` skill if 1Password has a login for the site: it types the login into your tab
  with no prompt (1Password vaults Agent Logins and Agent-Test). When it can't, hand the step to me
  in Session Board's browser pane: `node ~/session-board/scripts/board-browser.mjs <https-url>
  "<what I need to do>"`. It opens the page as a tab in your chat's window and notifies me, so
  what I do there is what you see afterwards. Tell me in chat what to do, wait
  until I say I'm done, then find the tab with `list_pages`. If the command fails (the board is
  not running), open the page in a background tab of the agent Chrome, tell me the URL and what
  to do, and wait. Never route browser or computer-use work to Codex.

## Heavy commands: two machine-wide slots

Many agents share this Mac's memory, so a hook (`~/.claude/hooks/heavy-gate.sh`) rewrites heavy
commands before they run: Vitest runs on the default config get `--maxWorkers=4`, and full test
suites, builds and whole-repo typecheck or lint wait for one of two slots (`~/.claude/bin/heavy`).
A `next build` (40-60 GB here) runs one at a time and waits for 45% of memory to be free; other
heavy jobs wait for 20%. The agent preflight (`scripts/agent-preflight.mjs`) takes a slot too.

- **"heavy: all 2 slots are busy" or "only N% of memory is free" means wait, not fail.** Don't work around the queue or the
  worker cap (no `--maxWorkers` overrides, no `bash -c` wrappers) unless I ask.
- **While iterating, run the specific test files you changed.** Targeted runs skip the queue;
  save the full suite for the final check.

## Codex session names and browser use

These preferences apply when running in Codex. Use Codex browser tabs wherever the rules
above or a skill call for a Session Board pane: reviews, sign-ins, files, and simulator or
emulator handoffs. This section takes precedence over the shared agent Chrome tools,
`board-browser.mjs`, and external-browser fallback instructions when running in Codex.

- Name sessions with short, simple names that capture the larger project or feature being
  built. Keep the name stable as individual edits and fixes evolve. Preserve user-chosen names.
- Open browser tabs and perform browser computer use only in Codex's native in-app browser.
  Do not use Arc for computer use. If the native browser cannot handle a required step, report
  the blocker instead of switching browsers unless the user explicitly requests another browser.
- Check existing in-app browser tabs before opening a new one. Reuse a relevant tab and
  navigate it as needed; open another tab only when there is no suitable tab or the task needs
  separate pages open at the same time.
- **UI approval:** before stopping for my approval, show the changed page in a visible native
  browser tab. If login or data setup makes it hard to reach, show the before/after screenshots
  or proof report there. Say what changed and what I am approving. A link or path in chat
  alone is not enough.
- **Sign-in and consent handoffs:** try the `agent-login` skill first when saved credentials
  can handle the step. If I must enter a code, complete 2FA, or give consent, show the exact
  page in a native browser tab, say what I need to do, and wait until I say I am done. Resume
  in that same tab. Keep test accounts separate from my personal accounts; use an isolated
  context when supported, and report a blocker if the required isolation is unavailable.
- **Files:** show generated review pages, screenshots, PDFs, reports, and folders in native
  browser tabs using a supported preview. Do not stop at a path in chat. If the browser cannot
  display the file, report that limitation instead of opening another browser or app.
- **Simulators and emulators:** show the changed screen through a supported mirror in a native
  browser tab. Keep the device running until I say I am done. If the native browser cannot
  show it, report the blocker; do not use the floating mini screen preview.
- **Tab ownership and cleanup:** act only on tabs owned by this chat or explicitly handed to
  it. Leave other chats' and my tabs alone. Keep routine automation in background tabs;
  make a tab visible when it needs my review or input. Close tabs and isolated contexts you
  created when done, except while I am still reviewing or completing a handoff. Never close
  the browser itself.
- Keep Codex-related browser windows, popups, authorization dialogs, and previews on the
  same display as the main Codex window. Do not open or move them onto another display and
  interrupt the user's work there. If window placement cannot be controlled, report the
  limitation instead of claiming it is enforced.
- Never open or show the floating mini screen preview in Codex. The user wants it hidden permanently.
