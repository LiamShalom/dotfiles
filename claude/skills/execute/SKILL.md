---
name: execute
description: "Build a whole SideShift feature from its approved spec without stopping: write the plan, build with subagents on one feature branch, run the CI preflight, open one PR, prove every party end to end on the Vercel preview, and hand the finished feature back to the operator for manual review. Use after brainstorm (and design, for UI work) when the operator says execute, build it out, or implement the spec. Replaces the legacy writing-plans + executing-plans + subagent-driven-development flow."
---

# Execute

The output is a finished feature waiting for the operator's review: one PR, CI green, proven
on the preview for every party, with a proof link. Do not stop early, and do not ask the
operator questions the spec, code or data can answer. Ask only when a real product decision
is missing from the spec, or before anything that spends real money.

The operator's rules stay in force and win over this skill: the repo `CLAUDE.md`,
`~/.claude/CLAUDE.md` (worktrees, one-command Bash, testing permissions), and agent memory.
Detailed checklists live in ship-it's checklist (`.claude/skills/ship-it/references/checklist.md` in the monorepo).

## Input

`docs/features/<date>-<slug>/spec.md` (approved), and `design.md` when the feature has UI.
Continue on the branch `design` used. If there is no approved spec, stop and run `brainstorm`.

## Steps

1. **Plan.** Write `plan.md` in the feature folder:
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
   own change.

7. **Open one PR** (not draft) with the final behavior, rollout order and links. Follow
   `docs/agents/vercel-deployments.md` for title markers.

8. **Prove it end to end on the preview.** Use the `proof` skill against
   `https://sideshift-web-git-<branch-slug>-side-shift.vercel.app`. One journey per
   party-matrix row, negative cases included, driven to the outcome, at desktop and phone
   widths for UI. Data jobs also get a small production dry run (checklist section 5).
   Anything that fails goes back to step 3. A blocked check is work to route around; if it
   truly cannot run, record what blocks it.

9. **CI green.** Every required check passes, or is red on `main` too and you say so.

10. **Stop and hand back. Do not merge.** The operator reviews the feature by hand.

## Report

Lead with the proof link (published REPORT.html), then:

- What the feature does now, per party, in plain sentences.
- Decisions you made that the spec did not cover, and why.
- What you could not verify, and why.
- Where to look: PR link, preview URL, the pages to click through first.

If the operator corrected you during the build, or a task needed a redo the next agent would
also need, run the in-session step of `correct` before you send the report.

End with: `**Status:** Ready for review · branch \`x\` · PR #123 <url> · preview <url> · merged: no`.
