---
name: quick-fix
description: "Take a bug report or a small change from request to a verified, merged fix with full autonomy: dissect the issue, prove the mechanism on real data, fix it, test it, prove it works end to end, and merge it. Use whenever someone reports something broken, wrong, missing, stuck, or behaving unexpectedly in the SideShift app — a Jam.dev link, a screenshot or screen recording, a Linear SID ticket, an Intercom/support complaint, or prose like \"X says their payouts page shows $0\" — and whenever the operator says quick fix or asks for a small tweak that needs no spec. Use it even when the fix looks like a one-liner and even when the report is vague. If the change turns out to be a large UI change or a large feature, it stops before merge and brings it to the operator. For larger projects use brainstorm, design and execute."
---

# Quick fix

Take a bug report or small change to a verified, merged fix. You have full access to
dissect, fix, test and merge; do not ask the operator what the code, data or logs can
answer. Avoid the failure modes that make "quick fixes" expensive: fixing a symptom instead
of a cause, or shipping something you believe works rather than something you watched work.

The operator's rules stay in force and win over this skill: the repo `CLAUDE.md` / `AGENTS.md`,
`~/.claude/CLAUDE.md` (merge rules, worktrees, one-command Bash, testing permissions, real
money), and agent memory. When a picture would make a diagnosis or a before/after clearer,
use `visual-companion`.

## Size check: is this still a quick fix?

Decide before you write code, and again before you merge. It is **not** a quick fix if it
needs any of these:

- A **large UI change**: a new screen, flow, modal or component, or a visible layout change.
  Copy, spacing, a colour or icon fix, or a fix that restores intended UI is small.
- A **large feature**: a new feature, integration or product area, or a diff across many
  files in several areas.
- A Postgres schema migration (its own PR first, through `/ship-migration`).
- Anything that spends real money.

If unsure, treat it as large. A large change still gets built, tested and proven, but you
**stop before merge** and bring it to the operator (see Report). If it is too big to build
well without a spec, say so and suggest `brainstorm`.

**A small change that is not a bug** (a tweak, copy change, small behaviour change): skip
Phases 1 and 3, read the code path (Phase 2), then continue from Phase 5. Every gate still
applies.

## The one discipline that matters

**Prove the mechanism before you write the fix.** Not "this looks like the cause" —
actually observe the broken value, on real data, and be able to say *this line produced
that wrong output.*

This isn't generic caution. In this codebase the first plausible suspect has been wrong
over and over, and each time the plausible fix would have shipped and changed nothing:

- Payouts took 15s. Obvious suspect: the ledger query. Actual cause: a **posts** read.
- Creator referral codes went unused. Obvious suspect: the reveal logic. Actual cause:
  **layout** — the input sat 172px below the fold on every phone. Desktop QA passed.
- Dev server ate 16GB. Obvious suspect: a heap leak. Actual cause: **sharp/libvips Metal
  buffers**, which never show up in heap stats.
- An agency owner was locked out of their own subaccounts. Obvious suspect: the member
  permission check. Actual cause: `restrictCompanySwitching` is stamped on nearly every
  profile, so it never meant "team member" at all.
- "Removed from 0 active programs." Obvious suspect: the removal call. Actual cause:
  membership read the **roster**, which was written before a swallowed contract-cancel.

The pattern: the code that *looks* responsible is usually adjacent to the code that *is*.
A fix built on a story rather than on evidence costs a full second cycle — new PR, new
review, new deploy — and burns the reporter's trust twice. Getting the evidence usually
costs one query or one throwaway script.

So: when you catch yourself about to edit a file because the bug "must be" there, stop
and go get the number.

## Phase 1 — Intake

Pull everything the report already contains before asking the reporter for anything.

**Jam.dev link** → use the Jam MCP (`mcp__Jam__getDetails`, then `getConsoleLogs`,
`getNetworkRequests`, `getUserEvents`). This is the richest intake you get — real console
errors, real failing requests with status codes, the actual click path. If no
`mcp__Jam__*` tools are present, refresh/reconnect the MCP list before falling back;
don't silently downgrade a Jam report to "I looked at the screenshot."

**Linear SID ticket** → `mcp__linear__get_issue` plus `list_comments`. The comments
usually hold the reproduction details the title omits.

**Screenshot / screen recording** → read it carefully. Pull out: the exact route in the
URL bar, the company or creator name, visible numbers, error text, viewport width, and
anything in a devtools panel if one is open. Each item you extract is one question you
don't have to ask.

**Support / Intercom prose** → the valuable part is usually a name. Resolve it to an id
early (see `references/evidence-recipes.md`), because almost every later step needs the id.

Whatever the source, land on four things before moving on:

- **Symptom** — what the user saw, in their words, and what they expected instead
- **Who** — company id / creator id / user id, resolved to real ids
- **Where** — route, surface, or job
- **When** — first seen; does it correlate with a recent deploy?

If you're missing **who** or **where**, that's the ambiguity Phase 4 asks about — but
finish gathering everything else first.

## Phase 2 — Locate the code path

Find the code that produces the symptom (or that the change touches):

- `graphify query "<question>"` when `graphify-out/graph.json` exists — returns a scoped
  subgraph, far smaller than raw search output
- `docs/backend/INDEX.md` → `CATALOG.md` → `docs/backend/domains/<domain>.md` for backend
  surfaces. `docs/backend/**` is regenerated without a CI gate and is often stale, so
  treat it as a map, not as truth.

Read the actual code path end to end — component → API route → usecase → data layer.
Resist forming a theory until you've seen where the value is actually computed.

**Then check whether someone already fixed it.** Work here often sits on an unmerged
branch or an open PR rather than on `main`:

```bash
git branch -a --list '*<keyword>*'
gh pr list --search "<keyword>" --state all
git log --oneline -15 -- <the file you're about to edit>
```

If a branch exists, your job becomes validating it against your evidence.

## Phase 3 — Prove the mechanism

Get an observation that only the real cause explains. Pick whichever is cheapest:

**Query prod data.** Postgres reads default to the **read replica**
(`mcp__cloud-sql-postgres-read-replica__execute_sql`); use the primary only for
read-your-own-write freshness or post-migration checks. The `sideshift-firestore` MCP
**silently ignores the `filters` argument** on `query_collection` and `count_collection` —
results that look filtered are not. Use `get_document` / `get_documents` by id, or the PG
replica.

**Write a throwaway probe.** `scripts/_probe-<topic>.ts`, run with `tsx`. Read-only, print
the numbers you care about, don't commit it. A naive `tsx` run connects to **prod**, so
never have a probe write.

**Drive the browser.** For UI and flow bugs, use the chrome-devtools MCP against the local
dev server: `new_page` → `navigate_page` → `take_snapshot`, plus `list_console_messages`
and `list_network_requests`. Layout bugs need `resize_page` to the reported viewport.
Before trusting `localhost:3000`, confirm which checkout is serving it.

**Write a failing test.** Best when the bug is in pure logic with a clear contract, since
it doubles as the regression guard. Not worth it for layout, data shape, or an integration
seam — a test there mostly encodes your assumption.

**A number you derived is not corroborated by a number you remember.** If you cite an
earlier measurement as a cross-check, put the two figures side by side and confirm they
agree. When they don't, that disagreement is the finding. If you can't reconcile them, say
the range is uncertain rather than picking the number that fits your theory.

Ruling a cause **out** counts as progress: showing the shared path works for 12 of 13
comparable accounts is strong evidence the bug is account-specific.

**Two failed fixes on one premise means the premise is wrong.** If two fixes that share a
belief ("the cache is stale", "the query is slow") have both failed the same check, write
that belief down in one sentence and test it directly before you write a third fix. Look at
which cases fail, not only how badly. If the test contradicts the belief, the cause is
elsewhere; if it confirms it, ask the next "why".

You're done when you can state the cause as a specific claim with a number or a log line
attached. "The owed total is $0 because `contract_excluded_posts` filters out every post
when `uploadedAtFormatted` is unset — 763k rows affected" is a proven mechanism. "The owed
calculation seems to have a filtering issue" is a theory.

Exact commands for each technique: `references/evidence-recipes.md`.

## Phase 4 — Ask, but only when it changes what you'd do

Default to continuing. Ask only when proceeding would mean guessing at something the
reporter knows and you can't observe:

- You can't reproduce it, and the difference is likely account state, plan, role, or device
- Several accounts behave differently and you don't know which one the reporter used
- The "correct" behaviour is a product decision, not a defect
- The fix touches money movement, auth boundaries, or needs a schema migration

When you ask, ask everything at once, with what you already found attached.

## Phase 5 — Fix

Work in a new worktree off `origin/main`, branch `fix/<short-description>`, env files
linked. Write the smallest change that removes the proven cause. Match the file's existing
style, comment density, and idioms. Reuse existing components and code.

Touch only what the task requires. Unrelated ugly or dead code gets flagged in chat, not
changed — except an orphan your own fix creates, which you remove.

**Remove the failure, do not only make it rarer.** A retry, a longer timeout or a wait that
can still end in the same error is a mitigation: the reporter's "I got an error" still
happens. Fix the source (the refusal, the lock, the race) so the user never sees it, or, if
that is a real design choice, give the operator the options with your pick before you build
(their `CLAUDE.md` asks for that). (2026-10-22: #7087 retried a refused contract update on
the client for 2 minutes and then showed the same error; "no it should just queue it
instead of showing an error".)

**Before you commit, `rg` for every other copy of the broken pattern** (the same class
string, hardcoded count, query or guard) and fix each copy in this PR, through one shared
constant or helper. A copy of the same bug is the bug the operator reported, seen from
another screen, not a second defect to ask about. (2026-10-22: the 6-column platform row
was fixed in the ad builder only; the campaign wizard's copy stayed broken, and "no its
not" was the answer.)

A second real defect you notice: **fix it, say it, or file it**, in that order. A small
safe fix rides along as its own commit; anything needing its own deploy clock or decision
gets said in chat or filed with a concrete `Why not now:` line.

Add a regression test when the logic can be pinned down by one. Skip it when a test would
just restate the fix.

## Phase 6 — Verify locally

**Re-run the exact thing that was broken and read the output.** Same instrument, same
inputs, different result: if a probe showed `owed = 0`, run it again and see the real
number; if the browser showed it at 390px, go back to 390px.

Run the tests next to the changed code (`npx vitest run <path>` — PR CI never runs the
main vitest suite) and `node scripts/agent-preflight.mjs`. Local `tsc` / `eslint` can be
unreliable here; CI is the source of truth — read job logs via
`gh api .../jobs/<id>/logs`. `Typecheck (scripts)` is a **ratchet** that fails on *fewer*
errors too; never touch its allowlist to make it pass.

If the fix touches shared code (a usecase, data layer, shared component or hook, an API
response shape, a job, or an auth or money path), run `blast-radius` on the diff now and
prove the one fact it is safe because of. Skip it for copy, styling and test-only changes.

If a red gate blocks verification, check whether you turned it red. If it was already red,
don't repair unrelated infra: comment on that gate's `red-gate` issue and say plainly what
you couldn't verify.

## Phase 7 — Open the PR

Commit subject in the imperative, under 72 chars, no trailing period. Push, then
`gh pr create`. PR body:

```markdown
## What was broken
<symptom in the reporter's terms, plus who hit it and where — or, for a change, what and why>

## Root cause
<the proven mechanism, with the evidence — the query result, the log line, the number>

## Fix
<what changed and why this removes the cause>

## Verification
<what you ran and what you observed — actual output, not "tested and works">
```

Link the Jam report or `SID-###` when there is one. Add `[no-deploy]` to the title if
every changed file is docs/tests/CI/scripts. A fix that writes a cone-declared Firestore
surface goes through the cone's repo boundary (enforced by CI).

## Phase 8 — Prove it end to end

Tests passing is not proof. On the PR's Vercel preview
(`https://sideshift-web-git-<branch-slug>-side-shift.vercel.app`), or the running app for
code with no preview, drive the real user flow to its outcome in the shared agent Chrome:
the reported symptom is gone, and the neighbouring flows still work. For UI, check desktop
and phone widths. For data jobs, run on a small real sample and read the result. Use the
`proof` skill when the flow has several steps or several parties. If it fails, go back to
Phase 5.

## Phase 9 — Merge

Merge yourself when **all** of these hold:

- Phases 6 and 8 showed the symptom stop, with the same instrument that proved the
  mechanism. A partial verification does not qualify.
- Every CI check passes (`gh pr checks <pr>`). A check also red on `main` does not count as
  passing. Wait for late checks: `gh-approve` can merge before they report.
- The size check still says small.

Merge with `/pr-approve`: `.claude/skills/pr-approve/scripts/gh-approve <pr> --merge`.
Never `gh pr merge --admin`. Run it after the final push; a later push can dismiss the
approval. Then confirm the production deploy reaches READY; on `git_info_fail`, run
`vercel redeploy <url> --scope side-shift`.

If any condition fails, leave the PR open and go to Report.

## Report

Plain sentences: what was broken, the cause in one line, what changed for users, and the
evidence. If anything is unverified, lead with that.

- Merged: `**Status:** Done — verified · PR #123 <url> · merged: yes`.
- Not merged: say which gate failed (large UI, large feature, CI, unverifiable step), give
  the preview URL and what to click to review, and end with the status line below. When
  large UI is the only gate, first open the preview on the changed page (or the
  before/after screenshots) in Session Board's pane with
  `node ~/session-board/scripts/board-browser.mjs <url | file> "<what to approve>"`, so the
  operator can approve it at a glance. **iOS change: the live simulator, not screenshots.**
  Leave the simulator, its build and any proxy running on the changed screen, and open it
  with `board-browser.mjs --simulator <udid> "<what to tap>"`. Do not clean up until the
  operator says they are done. Clean up after the approval, not before. End with
  `**Status:** Needs your review · PR #123 <url> · preview <url> · merged: no`.

Before you send the report: if the operator corrected you during this task, or the first
suspect was wrong in a way the next agent would repeat, run the in-session step of `correct`.

## References

- `references/evidence-recipes.md` — exact commands: Jam MCP intake, resolving a name to an
  id, PG replica queries, probe scripts, chrome-devtools browser driving, reading CI logs.
- `evals/evals.json` — trigger and behaviour evals inherited from the old `bugfix` skill.
