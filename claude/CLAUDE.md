# Claude Code — Global Config

## #1 Rule: verify before you claim

Don't tell me something works until you've seen fresh output proving it. A passing test you
just ran is evidence; "this should work now" is not. If you couldn't verify something, say so
plainly — an honest "I changed this but couldn't run it" is far more useful to me than false
confidence, because I'll go check it myself.

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
- **Say what you're unsure about.** If you guessed at how a subsystem works, tell me it was a
  guess — it's usually the guess that turns out to be the bug.
- **Being brief is still good** — brief and conceptual, not brief and cryptic. Cutting words is
  fine; cutting the reasoning is not. Bullets and code where they genuinely help, prose where
  the point is an explanation.
- Skip the basics I already know, skip the flattery, and don't repeat my request back to me
  before starting.

## Working defaults

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
  pre-existing dead code, mention it rather than deleting it.
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
one per session, and it never jumps in front of what I'm working in.

- **Use the `chrome-devtools` MCP tools first.** They attach to the shared browser
  (`~/.claude/bin/agent-chrome.sh`, DevTools at `http://127.0.0.1:9222`) and open tabs in the
  background by default. Don't pass `background: false` or `bringToFront: true` unless I ask to
  see the page.
- **Never launch another Chrome** — no `--remote-debugging-port`/`--user-data-dir` launch, no
  headless browser, no Puppeteer or Playwright `launch()`. This overrides any skill or doc that
  says to, including the monorepo `verify` skill's isolated-Chrome step. A script runs
  `~/.claude/bin/agent-chrome.sh` (starts the browser if needed, prints its URL), connects to
  that URL (`puppeteer.connect({ browserURL })`, Playwright `connectOverCDP`, or raw CDP), and
  opens its own tab with `background: true`.
- **A second login is an isolated context, not a second browser:** `new_page` with
  `isolatedContext: "<name>"`, or `Target.createBrowserContext` / `browser.createBrowserContext()`
  in a script. Isolated contexts share no cookies with anything else.
- **Other sessions' tabs are in the same browser.** Act only on the `pageId` your own
  `new_page` returned, never a tab you didn't open. Close your tabs and contexts when done;
  never close the browser or anyone else's tabs.

## Codex session names and browser use

These preferences apply when running in Codex.

- Name sessions with short, simple names that capture the larger project or feature being
  built. Keep the name stable as individual edits and fixes evolve. Preserve user-chosen names.
- Open browser tabs and perform browser computer use only in Codex's native in-app browser.
  Do not use Arc for computer use. If the native browser cannot handle a required step, report
  the blocker instead of switching browsers unless the user explicitly requests another browser.
- Check existing in-app browser tabs before opening a new one. Reuse a relevant tab and
  navigate it as needed; open another tab only when there is no suitable tab or the task needs
  separate pages open at the same time.
- Keep Codex-related browser windows, popups, authorization dialogs, and previews on the
  same display as the main Codex window. Do not open or move them onto another display and
  interrupt the user's work there. If window placement cannot be controlled, report the
  limitation instead of claiming it is enforced.
