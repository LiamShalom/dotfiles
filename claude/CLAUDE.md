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

A second model checks substantive turn ends. In Claude, when the hook sends you back
with "Finish check", follow the feedback. If it is wrong, say why in one line and continue.
In Codex, the Stop hook records its verdict in `~/.codex/logs/finish-gate.jsonl`.

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

### Codex execution

- In Codex, use the `skeptical_verifier` custom agent for independent review. Its model
  and effort are configured in `~/.codex/agents/skeptical_verifier.toml`; Claude model
  aliases above apply only to Claude. If the role is unavailable in an existing chat,
  use a clean-context default agent with an available frontier model and explicit high
  effort. Give it the request and artifacts, not your verdict. Do not review a review.
- For work I explicitly ask to run autonomously or until complete, use a native Goal
  with the requested outcome and evidence requirements. Keep the existing approval
  boundaries. A Goal or a completion checker cannot authorize a reserved action.
- For unattended Codex work, use `~/.claude/bin/run-until-done --engine codex <dir>`.
  Every acceptance item needs an executable `check`; the runner checks results and
  invokes its reviewer independently. Keep checkpoint notes in `progress.md`. A retry,
  timeout, checker failure, or unavailable credential means incomplete, never success.
- The Stop checker evaluates transcript evidence and logs its verdict locally. Run the
  required checks and independent code review before finishing.

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
- It is not a large feature PR. **Never merge a large feature PR without my explicit
  permission for that PR**, even when every other condition holds and even when I told you to
  run the task end to end. Large means a new feature, integration or product area (for
  example, a new ad platform such as Google Ads), a multi-commit feature branch, or a diff
  that touches many files across several areas. Bug fixes, small tweaks and schema-migration
  PRs are not large. If unsure, treat it as large and ask.

If any condition fails, get the PR ready, tell me what is missing, and stop.

**When my UI approval is the only thing left**, put the change in front of me before you
stop, so I can approve it at a glance. Make it a local page: a clickable copy of the changed
page whose buttons, tabs, modals and form states work. Capture the real page with
`~/.claude/bin/page-snapshot.mjs [--as brand|creator] <preview-url> --out <file.html>` (signed
in, every style and image inlined); never redraw it by hand. Then add the interactions with
fixture state in inline JS. Put the Vercel preview link in it. Open it in Session Board's
browser pane: `node ~/session-board/scripts/board-browser.mjs <file.html> "<what changed, what
to look at>"`, and edit the same file each round (the pane reloads it). Your own verification
still runs on the real preview. For an iOS change,
show the simulator on the changed screen with `--simulator`. In chat, say what I'm
approving. A link or a screenshot path in chat alone is not enough. If the board is not
running, open the page or file with `open` instead.

To merge, use `/pr-approve` in the monorepo (`.claude/skills/pr-approve/scripts/gh-approve
<pr> --merge`). It approves as the shared reviewer account, which branch protection needs,
then waits for checks and squash-merges. Never use `gh pr merge --admin`.

**Before merging a monorepo PR, review it for bugs and gaps and fix them:** run `/code-review high
<pr> --fix`, fix every real bug it finds, and check the diff against what was asked (a promised
behaviour that is missing, or a state it does not handle: empty, error, loading, a role without
access). Push the fixes and let CI finish, then merge. A hook refuses `gh-approve --merge` until the
session has run `/code-review`.

**Schema migration PRs:** merge them without asking once CI is green, then approve the
`db-migrate-prod` apply without asking. This is my standing approval for every migration
deployment. Use `/approve-deploy`, which approves with `--agent-confirmed`, and post the
plan and lint evidence in chat as the record. Before you merge, check the end result: the
schema and data after every pending file applies (one apply runs every pending file, not
only yours). Merge only SQL that is safe and non-destructive: no drops, truncates, renames,
type narrowing, data deletes or rewrites, or long locks on large tables. If it is not,
change the migration until it is (add the new shape, leave the old one in place) instead
of asking me.

**Redeploys (`cloud-run-prod` gate, Cloud Run services and jobs, messaging images and
their preview gates):** start and approve them yourself when you judge them safe; never
wait on me for one. Dry-run first with `scripts/approve-deploy.sh <run-id> --dry-run`, read
the evidence and every commit the deploy ships (other people's merged work included), check
the criteria in the monorepo's `.claude/commands/approve-deploy.md`, then approve with
`scripts/approve-deploy.sh <run-id> --agent-confirmed --agent=claude-code/<session>` and
post the evidence and commit list in chat as the record. Never use `--human-confirmed` for
an approval I did not give in this chat. Deploy only what is merged to `main` and green,
then check the new revision serves. Stop and ask only when the deploy would spend real
money, ships a change that is not merged, or the script refuses `--agent-confirmed`.

## Testing: no permission needed, except for real money

Everything you do for testing is OK without asking me first. That includes creating and
changing test data in production (test brands, test creators, campaigns, contracts, posts,
connections), running jobs and scripts against production for test accounts, reading
production keys into a local process for a test, connecting test accounts to providers, and
giving a test account the access a test needs. Testing means work on test accounts, test
brands or synthetic data; a real customer's account or data is never test data.

**Never test on my personal accounts** (my Instagram, Facebook, TikTok, X, YouTube and so
on): never connect one to a test user or post, message or publish through one. When a test
needs a real third-party app, create a test account there (or reuse one, like the
@sideshiftadsqa-liam YouTube channel), so nothing lands on mine. If you can't make one, ask.

The one exception: **ask me before anything that spends real money**, such as live payments,
payouts or withdrawals, ad spend on a real ad account, live Stripe charges, purchases, or a
paid plan or API tier. Test-mode and sandbox money is fine, and so are Vercel preview builds
(`npm run vercel:preview` in the monorepo): build one whenever a check needs it.

This covers testing only. Shipping still follows the rules above: merging is not testing.

## Bash commands

**One command per Bash tool call — never chain.** No `&&`, `||`, `;`, or `|` into another
command that could have been its own call. `$(...)` substitution inside a single command is
fine. This applies only to Bash tool calls — Dockerfile `RUN` lines, CI `run:` blocks, and
shell scripts you're writing are unaffected.

## Working in worktrees

- **Symlink the gitignored env files in first.** Worktrees don't inherit them, and scripts fail
  on missing credentials in confusing ways. Link the main checkout's `.env.local` (and anything
  else that gets loaded) before doing anything else.
- **Install a monorepo worktree with `~/.claude/bin/sideshift-setup`** (run from the worktree
  root) when you will build or test there. It links `.env.local`, clones a cached install for
  the same lockfile (or updates the nearest one with `npm install`), and runs
  `npm run build:packages`. Run it again after `package-lock.json` changes or a rebase.
- **Type errors arrive after each edit** (the `ts7-lsp` mod) with your next tool result. Fix
  them as they appear. Do not run a whole-repo type check in the monorepo (`npm run typecheck`,
  `typecheck:tests`, a bare `tsc --noEmit`): each holds about 10 GB, and PR CI runs them on
  every push. The heavy-gate hook refuses them. Push, then read the `Typecheck app` and `Typecheck tests` jobs, and do
  not report types as checked until they are green. `LOCAL_TYPECHECK=1 <command>` runs one
  locally, only to reproduce a CI type error or when I ask.
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
- **To show me a file you made** (a temp HTML review page, a screenshot, a PDF, a Markdown or
  text report, a folder), run `node ~/session-board/scripts/board-browser.mjs <path> "<what it
  is>"` instead of `open <file>`. It opens in Session Board's browser pane. Chrome downloads
  `.csv` and `.yaml`, so the script refuses them. If the board is not running, use `open`.
- **For a UI design round, pick the surface that fits; the Session Board canvas is one
  option.** Use the canvas when I will want to mark up static screens (compare options,
  sketch, point with arrows) or when the rounds should stay together as history. Use the
  preview route itself, or a local HTML page in the pane, when the decision depends on
  clicking, states or motion. Say which one you picked in one line. Either way, show the real
  preview route at 1280 and 390 wide, never a hand-drawn lookalike. On the canvas, add each
  round to the feature's canvas with `node ~/session-board/scripts/board-canvas.mjs add "<feature>"
  <round.json> "<what to decide>"`. One canvas per feature; each round goes under the last. I
  sketch, write notes and point with arrows on it: before each next round, read that back with
  `board-canvas.mjs read "<feature>"` (JSON of what I added, plus a PNG to look at). The round
  format and steps are in the `visual-companion` skill.
- **A page made for me to look at or decide on is a local HTML file in the pane** (diagrams,
  review and approval pages, reports, a prototype I asked to click through): `board-browser.mjs
  <file.html> "<what to look at>"`. There it gets the claude.ai Artifact runtime
  (`window.claude.use`: db, comments, sample, artifact.publish; same API, see the "Pages that
  work like Claude artifacts" section of `~/session-board/README.md`). My comments on it arrive
  in your session as prompts; read what I did on the page with `node
  ~/session-board/scripts/artifact.mjs db|comments <file.html>`. Edit the same file each round:
  the pane reloads it. Publish a claude.ai Artifact (the `Artifact` tool) only for a page
  someone else has to open.
- **To show me an iOS simulator or Android emulator** (a build to try, a flow to check, a sign-in
  only I can do), run `node ~/session-board/scripts/board-browser.mjs --simulator <udid | name |
  adb serial | AVD name> "<what to do>"`. It opens as a tab in Session Board's pane, where I tap,
  scroll and type in it. Keep the simulator or emulator running until I say I'm done. If the board
  is not running, ask me to open Simulator.app (or the emulator's window) instead.

### In the Claude desktop app

When `CLAUDE_CODE_ENTRYPOINT` is `claude-desktop`, I'm looking at the desktop app, not Session
Board. Wherever this file or a skill says to show me something in Session Board's pane or with
`board-browser.mjs`, do this instead (the `open-to-pane` hook refuses `board-browser.mjs` there):

- **A page** (a preview, a sign-in, 2FA, consent, an artifact URL): open it in the app's browser
  pane with `mcp__Claude_Browser__preview_start` and its `url`, and check with `tabs_context` that
  the pane is showing. It keeps my sign-ins between sessions. It cannot open `file://` pages.
- **A file** (a screenshot, PDF, report): `SendUserFile` with `display: "render"`. An HTML page
  goes up as an Artifact.
- **A UI design round** (`board-canvas.mjs`): an Artifact with each option's screenshots, your
  pick at the top, and each option's preview link.
- **An iOS simulator:** `mcp__Claude_Code_iOS_Simulator__control` with `attach`. An Android
  emulator has no pane there: ask me to use its window.
- **A SideShift page signed in as a test account, for your own checks:** `node
  ~/.claude/bin/agent-signin.mjs [--as creator] <url>`. It opens the page in your chat's agent
  Chrome window, signed in, without Session Board. That tab is yours, not mine.

## Heavy commands and shared resources

Many agents share this Mac's memory, so a hook (`~/.claude/hooks/heavy-gate.sh`) rewrites heavy
commands before they run: Vitest runs on the default config get `--maxWorkers=4`, and full test
suites, builds and whole-repo typecheck or lint wait for one of two slots (`~/.claude/bin/heavy`).
iOS builds and tests wait for one of two separate iOS slots, and `xcodebuild test` runs with
`-parallel-testing-enabled NO`, so a run boots one simulator, not one clone per worker.
A `next build` (40-60 GB here) runs one at a time and waits for 35% of memory to be free; other
heavy jobs wait for 10% (`~/.claude/bin/heavy --mem-free` prints the figure: RAM that is not app, wired or compressed memory). The agent preflight (`scripts/agent-preflight.mjs`) takes a slot too.

- **"heavy: all 2 slots are busy" or "only N% of memory is free" means wait, not fail.** Don't work around the queue or the
  worker cap (no `--maxWorkers` overrides, no `bash -c` wrappers) unless I ask.
- **"disk-guard: only N GB free" means the disk is nearly full: stop and tell me.** It refuses
  queued jobs, installs and dev servers below a floor (`~/.claude/bin/disk-guard status`).
  Don't set `DISK_GUARD_OFF` or delete files to get past it unless I ask.
- **While iterating, run the specific test files you changed.** Targeted runs skip the queue;
  save the full suite for the final check.
- **Dev servers are capped.** The same hook refuses a new `next dev` / `npm run dev` while
  4 dev servers run. Reuse a server you started, or stop one of yours; never stop another
  session's server.
- **Clean up what you started before you finish a task**: stop your dev server, background
  tasks and pollers (`until gh pr checks …; sleep 30`, `cloud-sql-proxy`, watchers), and
  Docker containers (`docker stop <name>` keeps the data); shut down your simulator; close your
  tabs. A background task outlives its session when the session is stopped or handed to a new
  job, and then runs for days with nobody reading it. Delete throwaway test records you made
  (a one-off campaign, listing, post); named test accounts stay. A Stop hook
  (`hooks/cleanup-check.mjs`) names what this session still runs, once per item, and the
  finish judge sends you back for leftover test records.
- **Use the shared Docker VM.** Run containers in the default Colima VM (6 GB, shared by every
  agent). Don't create another Colima profile or resize one; ask me first.
- **Anything that runs once per session must be cheap.** The statusline, hooks, MCP servers and
  timers run in every session, about 30 at once. Start one or two processes per run at most,
  cache anything slow, never run `git status` on a timer (if you must, cache it and pass
  `--no-optional-locks`), and no 1-second intervals. On 2026-10-21 a statusline with a
  1-second timer started 1,400 processes a second and held the kernel at 84% CPU.
- **Install dependencies only when you will build or test.** A `node_modules` is about 180,000
  files, and creating one floods file events for every app on the Mac. A read-only or docs task
  needs none.
- **Leftovers are cleaned up on a schedule** (`~/.claude/bin/agent-reaper.mjs`, every 5 minutes,
  log in `~/.claude/logs/agent-reaper.log`): a simulator with nothing running in it for 20
  minutes is shut down; an Android emulator over 12 GB that nothing used for 10 minutes is
  stopped (they bloat: a 4 GB phone reached 35 GB in a day); the Kotlin compiler daemon over
  5 GB is stopped once it has compiled nothing for 5 minutes; an agent's dev server over 12 GB, or with no client for 2 hours, is
  stopped; an agent Chrome tab unused for 6 hours is closed; a background task whose session is
  gone is killed after 30 minutes; a container in the default Colima VM with no traffic for 24
  hours is stopped (`docker start <name>` brings it back with its data). If your simulator,
  server, tab, task or container disappeared, check that log, then start it again.

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
- **UI design rounds:** when Session Board is running and you pick the canvas (see the rules
  above), add the round to the feature's canvas with `board-canvas.mjs`, so it stays with the
  earlier rounds, and read my marks back with `board-canvas.mjs read`. Also show that round's screenshots, your pick and
  the preview links as a local page in a native browser tab. When the board is not running, that
  page is the whole round.
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
- Continue routine, reversible setup and verification steps within an authorized task without
  asking again. This includes temporarily resetting and restoring the same OAuth permission
  to record an approved flow, with the same app, account, Page and access scope. Ask for manual
  input only when it is needed, such as a password or sign-in code that is not available.
  Keep confirmations required for new or broader access and legal commitments, except for
  testing (see "Testing" above: only real money needs my OK).

## SideShift test credentials

- SideShift test credentials are stored in the 1Password vault `Agent-Test`, with an encrypted local copy in macOS login Keychain for access without repeated 1Password prompts. `/Users/liamshalom/sideshift-monorepo/.env.test.local` contains only `op://` references. Do not use these references as literal credentials.
- For authorized test commands, use `/Users/liamshalom/sideshift-monorepo/.codex/with-test-secrets <command> [args...]`. It reads macOS Keychain and injects the existing variable names without accessing 1Password. It preserves the command's current directory, including in worktrees.
- After changing these values in 1Password, run `/Users/liamshalom/sideshift-monorepo/.codex/with-test-secrets --refresh` to update Keychain. Refresh uses `op run` and can require 1Password authorization. Ordinary commands do not refresh automatically.
- Items: `SideShift Test Creator`, `SideShift User`, and `SideShift Stripe Test`. Do not change account passwords or generate replacement tokens without a task that requires it.
- Do not print secrets, dump the vault or Keychain, put secrets in command arguments, or write plaintext credentials back to env files. A locked macOS login Keychain can still require the owner to unlock it. Credential access does not grant permission for unrelated external actions.
