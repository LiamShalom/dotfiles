---
name: execute
description: "Build a whole SideShift feature from its approved spec without stopping: write the plan, build with subagents on one feature branch, run the CI preflight, open one PR, test the whole feature end to end on the Vercel preview for every party, close every gap in a production-readiness audit, and hand the finished feature back to the operator for manual review. Use after brainstorm (and design, for UI work) when the operator says execute, build it out, or implement the spec. Replaces the legacy writing-plans + executing-plans + subagent-driven-development flow."
---

# Execute

The output is a finished, production-ready feature waiting for the operator's review: one PR,
CI green, every promise proven end to end on the preview for every party, a gap ledger with
no open rows except steps only the operator can do, and a proof link. "Production-ready"
means the operator could merge it today and real users would hit no missing state, broken
path or manual setup. Do not stop early, and do not ask the operator questions the spec,
code or data can answer. Ask only when a real product decision is missing from the spec, or
before anything that spends real money.

The operator's rules stay in force and win over this skill: the repo `CLAUDE.md`,
`~/.claude/CLAUDE.md` (worktrees, one-command Bash, testing permissions), and agent memory.
Detailed checklists live in ship-it's checklist (`.claude/skills/ship-it/references/checklist.md` in the monorepo).

## Input

`docs/features/<date>-<slug>/spec.md` (approved), and `design.md` when the feature has UI.
Continue on the branch `design` used. If there is no approved spec, stop and run `brainstorm`.

## Steps

1. **Plan.** Write `plan.md` in the feature folder:
   - For credential setup, inspect env-file names with `node ~/dotfiles/claude/bin/env-names.mjs <path>`.
     It returns variable names only. Resolve values through the existing credential helper;
     never print an env file, even when an earlier description says it contains only references.
   - Goal, architecture in three sentences, and the PR units. A Postgres migration is its own
     PR first (`ship-migration`); an internal-dashboard tab uses `paired-admin-tab`.
     Everything else is one PR.
   - Tasks. Each task has exact files, the interfaces it consumes and produces, its tests,
     and an owner. A task is the smallest unit with its own test cycle. Tasks that touch the
     same files run in sequence.
   - Spec coverage: each spec requirement and party-matrix row maps to a task and to a check.

   Start `HANDOFF.md` (not committed) with the plan summary and a progress log. Update it
   after every task. Commit `plan.md`.

2. **Ship the migration first** if there is one: its own PR off `main`, then wait for the
   apply before the feature code depends on it.

3. **Build.** Dispatch one subagent per independent task, in parallel where files do not
   overlap. Each subagent gets its task text, the interfaces, the files it owns, the spec
   and design paths, and the rule to write tests first. Every subagent works in its own
   worktree cut from the feature branch tip and rebases on that tip before handback. After
   each task, review the diff yourself against the spec and the reuse rules before the next
   task starts. UI tasks wire the `design` components to real data; they do not restyle them.

4. **Test as you go.** Run the test files next to changed code after each task. Fix failures
   in that task, not later.

5. **Check locally.** `node scripts/agent-preflight.mjs` and `npm run typecheck` in the
   worktree (the preflight skips the app type check, which the Vercel build runs), plus
   `git diff --check`. Run all three again after any later code change, before you push:
   ESLint and vitest do not type-check. Fix everything attributed to the change. Remove the
   `app/dev-<slug>-preview/` route if the real page now covers every state, unless the
   operator asked to keep it.

6. **Self-review the whole diff.** Run `/code-review` on the branch, then `blast-radius` on
   the parts that touch shared code, and prove the fact each is safe because of. Check for
   duplicated UI or logic, flags, explainer notices, stray fixtures and dead code from your
   own change. UI in the diff must pass the checklist in
   `~/dotfiles/claude/references/unslop.md`.

7. **Open one PR** (not draft) with the final behavior, rollout order and links. Follow
   `docs/agents/vercel-deployments.md` for title markers.

8. **Test the whole feature end to end on the preview.** Use the `proof` skill against
   `https://sideshift-web-git-<branch-slug>-side-shift.vercel.app`, as a real user of each
   party, driven to the outcome (not to the button), at desktop and phone widths for UI.
   Cover all of it, not a sample:
   - **Every promise.** Each spec requirement and party-matrix row gets a journey.
   - **Every way in.** Navigation, deep links, links in emails and notifications, the
     mobile web layout, and the iOS app when it reads a changed response.
   - **Every state.** Loading, empty, error, no permission, busy, success, and data with real
     shapes (long names, zero and missing values, many rows, an account that existed before
     the feature).
   - **Negative and misuse cases.** The wrong user or role, a stale tab, a double click, a
     retry after a failure, invalid input.
   - **Every effect.** Read back what the feature wrote (database rows, Stripe or provider
     objects) and confirm emails, notifications, webhooks, jobs and crons fired. For two-way
     features, prove both directions. Reload and confirm it persisted.
   - **Regressions.** The existing flows that `blast-radius` named still work.

   Data jobs also get a small production dry run (checklist section 5). Anything that fails
   goes back to step 3, and the journey runs again after the fix. A blocked check is work to
   route around; if it truly cannot run, record what blocks it.

9. **Gap audit.** Write a gap ledger in `HANDOFF.md`: one row per spec requirement, party,
   entry point and state from step 8, each with its evidence (proof step, test or query) and
   a status. Then add a row for each production-readiness check:
   - Migration applied in production; Firestore rules and indexes deployed.
   - Env vars and secrets set for Production on Vercel and on any Cloud Run service.
   - Crons, jobs and webhooks registered in production, not only on the preview.
   - Existing records work without a manual step (backfill written and run, or not needed).
   - Installed iOS apps still decode every changed response (`messaging-compat` for
     messaging).
   - Failures are handled and logged: a provider error, a timeout, or a partial write leaves
     the user a clear state, not a hang or a blank page.
   - No dev preview routes, fixtures, TODOs, flags, debug logs or placeholder copy left.

   Then get a second read: give a fresh `opus` subagent the spec, the diff and the proof
   report (not your ledger) and ask it what a real user or the production setup would hit
   that is not proven. Add each real finding as a row.

   Close every open row: fix it, prove it, and update its evidence. Go back to step 3 as
   often as needed. A row can stay open only when the operator alone can close it (a product
   decision the spec does not make, real money, a sign-in on their own account, an approval).
   Write it as that ask, with your pick. Never leave "other gaps", "follow-ups" or
   "nice to have" items: if you can name it, it is in scope.

10. **CI green.** Every required check passes, or is red on `main` too and you say so.

11. **Stop and hand back. Do not merge.** The operator reviews the feature by hand. Hand
    back only when step 9 has no open row that you could close.

## Report

Lead with the proof link (published REPORT.html), then:

- What the feature does now, per party, in plain sentences.
- The gap ledger result in one line: how many rows, all proven, and the second read's
  findings and what you did about them.
- Decisions you made that the spec did not cover, and why.
- Each row still open, on its own line: what is missing, why only the operator can close it,
  and what you need (a decision with your pick, a step in their browser, or real money).
- Where to look: PR link, preview URL, the pages to click through first.

If the operator corrected you during the build, or a task needed a redo the next agent would
also need, run the in-session step of `correct` before you send the report.

End with: `**Status:** Ready for review · branch \`x\` · PR #123 <url> · preview <url> · merged: no`.
