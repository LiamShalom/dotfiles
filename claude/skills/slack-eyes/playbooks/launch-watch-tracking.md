# Watch alerts (launch watches and their fixes)

Use when: the Launches bot posts "*Watch caught something:*" or a watch verdict in an alert channel
and tags Liam, a message names `node scripts/watches.mjs open-fix <slug>` or `report`, or a teammate
asks whether a launch "worked for real users" or whether an event is tracked.

Facts below were checked on `origin/main` (`scripts/watches.mjs`) on 2026-11-26. Code moves: if a line
here no longer matches, fix this file.

## How it works

- A watch is `ops/watches/<slug>.md`: front matter (`check_after`, `recheck_every`, `on_fail: fix`), a
  Goal, and `sql check` blocks whose columns `enough_data` and `pass` decide the verdict. Read it with
  `git show origin/main:ops/watches/<slug>.md`: the main checkout is often stale.
- Each run writes `~/.local/state/sideshift-watches/runs/<slug>-<ts>/`: `evidence.md` (query results),
  `result.json` (verdict and details), `fix.patch` and `pr-body.md` when the agent proposed a fix, and
  `tree/` (a worktree on the fix branch).
- `node scripts/watches.mjs open-fix <slug>` pushes that patch and opens a **draft** PR on branch
  `watch/<slug>-<ts>`. The checking agent ran no tests. The PR body has no `## Prod change` section.
- The runner allows a fix to change only `check_after` in the watch file (`keptWatchText`,
  `scripts/watches.mjs` ~line 303). It puts back any other edit with a "Keep watch …: a fix may only
  move its next check" commit. Do not try to edit the check SQL in a fix PR.
- `pass = false` with `enough_data = false` is not a failure: the agent starts only once `enough_data`
  is true.

## Symptom → cause → proof

| Alert says | Check | Proof |
|---|---|---|
| N rows still lack a value after a backfill's mark | read the watch's check SQL and run its count on the read replica, with the row times against the mark's `cursor_at` | rows all written after the one-shot mark, so the sweep had stopped before they came (workflow runs, 11-26: 279 summaries, 05:54–16:08 UTC, mark 05:50 UTC). A new mark key makes the sweep run again |
| a fix is "saved on the watch runner" | `cat <run dir>/fix.patch`, then `open-fix` | the diff in the PR |
| an app watch (`mobile--<slug>`) "day 0 looks wrong", 0 production users fired the event | `~/.local/state/sideshift-watches/state.json` → `launch.platformDay0`; versions per day in PostHog 202481 (`$app_version`, `$os`) | Android shipped 2.39 on 11-11, then the shared version went back to 2.31, so `release: android 2.32.0` matched 2.39. Fixed in #12369: a higher version counts only if first seen on or after the first day 3 users ran the release version |

Mobile watches live in `SideShiftApp/sideshift-mobile` `ops/watches/` (cached in `remote-watches/`). Launch
code is `scripts/lib/launches.mjs` + `launch-runner.mjs` on `origin/main`; the main checkout is stale. To re-run a
launch from day 0: `node scripts/watches.mjs reopen <slug>` (clears state), delete the old PostHog dashboard, its 4
insights and the annotation (the runner reuses a dashboard by name, with the old dates), then
`node scripts/watches.mjs run --here --only <slug> --no-agent`: it should print "waiting for release". The
day-0 query must stay one grouped scan of app opens with a LIMIT: every iOS event over 60 days returns 504
after about 10 s, and HogQL returns 100 rows without a LIMIT.

Before you trust a fix that re-runs a sweep, check that the stuck rows can be rebuilt. For workflow
summaries: each has a `workflow_engine_runs` row with `outcome = 'fired'`.

## Shipping the watch's fix PR

1. Review the diff yourself and run `/code-review` on the PR. Make your edits in the run's `tree/`
   (the branch is checked out there, so a new worktree on it fails), then commit and push.
2. Add a `## Prod change` section to the body (`gh pr edit --body-file`). The edit starts a new
   "Prod change" run. Re-run **that** run if it was cancelled. `gh run rerun` of the old run reads
   the old body and fails again, and it cancels the new run.
3. Run `gh pr ready`, then `gh-approve <pr> --merge`. It exits without merging while checks are still
   pending, so run it again once they are green. The merge hook asks four questions (accounts
   reached, approval, UI, copy-sweep); answer them in chat, then run it again.
   `~/.claude/bin/copy-sweep` is not on PATH.
4. Deploy: the GitHub "Vercel" commit status can stay `pending` after the deployment is Ready. Check
   with `npx vercel inspect <target_url> --scope side-shift`, then prove the result in the data. For
   the workflow fix that was the new cursor row in `workflow_engine_cursors` and a 0 count.

## Reply

The alert is a bot post. If Liam answered it in the thread ("ill take a look"), close it with one untagged
line: what shipped and the number that proves it. Example: "fixed in #12261, the backfill re-ran and
all 279 are grouped now (0 left without a group)". Do not react to the bot message.
