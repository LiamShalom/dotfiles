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

**Before you tell the operator the fix "needs a feature" or offer to build one,** search for
it as already built: `gh pr list --state open --search "<feature terms>"` and
`git branch -a --list '*<term>*'`, using the feature's words (the provider's own name for it,
such as "Smart+"), not the bug's. Sibling sessions often have it on a draft PR the same day.
If one exists, the job is to validate and land that PR. (2026-10-28: Dr Melaxin's hidden Smart+
campaigns; I offered to spec Smart+ launching while #7653 had built it that morning.)

If unsure, treat it as large. A large change still gets built, tested and proven, but you
**stop before merge** and bring it to the operator (see Report). If it is too big to build
well without a spec, say so and suggest `brainstorm`.

**A small change that is not a bug** (a tweak, copy change, small behaviour change): skip
Phases 1, 3 and 3b, read the code path (Phase 2), then continue from Phase 5. Every gate
still applies.

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

**Route the request as engineering work.** The operator is a software engineer, not the affected customer. A pasted complaint or screenshot starts an investigation and fix. An explicit request for a summary or reply changes that response only; keep the unresolved defect open. On a follow-up such as "he did but still getting this", return to Phase 3 with the new evidence. Before ending, check that the answer contains a verified fix or a concrete blocker, rather than only a suggested customer reply.

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

**Before you call a payout amount correct, read the contract's terms history** (`change_log`
on `contracts`) against its payout dates, and check the payout traps in
`.claude/skills/investigate-slack-issue/references/evidence.md`. A terms edit after a payout
changes what the earlier payment covered; the ledger alone cannot show that. (2026-11-10:
a creator's top-up looked correct from the ledger, but a platform target added after the
payout had re-cut the paid batch, and more was owed.)

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

## Phase 3b — Find why the bug was possible

Phase 3 tells you which line produced the wrong output. This phase asks why the system let
that line exist and ship. A bug report is one sighting of a weakness. If you fix only the
sighting, the weakness stays, and the next report comes from another screen or another
account.

Ask "why" until you reach something structural, usually two to four steps: why was the line
wrong → why did nothing catch it → why would the next person make the same mistake? Stop at
a cause you can show in the code or the data, not at a guess.

Structural causes this codebase has had, and the long-term fix for each:

- **Two sources of truth for one fact** (the roster against the contracts) → read from the
  owner and derive or delete the copy.
- **A name that lies about its meaning** (`restrictCompanySwitching` stamped on nearly every
  profile) → gate on the field that means the thing, and rename or document the other.
- **A swallowed error** (a contract cancel that failed silently) → let it fail loudly or make
  the caller handle it.
- **The same logic in several places** → one shared helper or constant (`copy-sweep` finds
  the copies).
- **A bad state that can be represented** (an optional field that every reader assumes is
  set) → set it at write time, enforce it in the type, schema or constraint, and backfill.
- **No check at the boundary** → add the test, lint rule, guard or assertion that fails when
  this comes back.
- **Bad data already written** → repair the affected rows, or say why not and how many.

Then decide:

- **Fix the structural cause in this PR when the size check still says small.** For a bug,
  "the smallest change" means the smallest change that stops this class of bug, not only the
  reported instance.
- **When the structural fix is large** (a migration, many files, a product decision), ship
  the immediate fix now and bring the structural fix to the operator: what it is, the
  evidence (how many call sites, rows or accounts), and your pick. File it in Linear with a
  `Why not now:` line. Do not drop it silently.
- **Some bugs have no deeper cause** (a one-off typo that a new test now covers). Say so in
  one line; do not invent a systemic story. The test for done: if this class of bug came
  back, would something now fail before a user saw it?

Write the chain in one or two sentences. It goes into the PR body under "Why it was
possible" and into the report.

## Phase 4 — Ask, but only when it changes what you'd do

Before recommending a workaround that changes the record type or flow, check the original
goal through its downstream result. For tracking tied to a paid contract, verify both post
reporting and Payouts on the same contract. A tracking-only replacement is not a complete
workaround for paid deliverables. State any lost behavior before recommending it.

Default to continuing. Ask only when proceeding would mean guessing at something the
reporter knows and you can't observe:

- You can't reproduce it, and the difference is likely account state, plan, role, or device
- Several accounts behave differently and you don't know which one the reporter used
- The "correct" behaviour is a product decision, not a defect
- The fix touches money movement, auth boundaries, or needs a schema migration

When you ask, ask everything at once, with what you already found attached.

**A product-rule question names where in the flow the rule applies.** A rule about what a
user must have or do ("needs every account", "needs a card") applies at one point: signing,
joining or going live, posting, paying. Each option says that point, or ask that first. Do
not put your guess about it into every option. (2026-11-14: options for "creators sign
without Facebook" all applied the rule at signing; Liam picked "require all", #10232 merged,
then "they dont need any accounts to sign. Only to join the campaign"; reverted in #10352.)

**An access refusal ("you don't have access") is not proof that the permission is right.**
Before you hide an entry point to match a server gate, decide which permission the feature
should follow: the one for the data it acts on (a post's video edits follow Posts access, not
Ads). If the server gate and that permission differ, fix the server gate. Hiding the entry
point only fits when the feature truly belongs to that other permission. (2026-11-03: Ad cuts
were hidden from members without Ads access; the operator wanted Posts access to be enough.)

## Phase 5 — Fix

Work in a new worktree off `origin/main`, branch `fix/<short-description>`, env files
linked. Write the smallest change that removes the proven cause and, when the size check
allows, the structural cause from Phase 3b. Match the file's existing
style, comment density, and idioms. Reuse existing components and code. If the change
touches what a user sees, read `~/dotfiles/claude/references/ui-taste.md` first, and add to
it when the operator reacts to the result. New or changed UI must also pass the checklist in
`docs/frontend/unslop.md` (no emoji, glows, hue gradients, gradient text,
greeting or hype copy, off-grid spacing, looping motion). Fix only the signs in the lines you
touch; list other slop you see on that screen in chat.

Touch only what the task requires. Unrelated ugly or dead code gets flagged in chat, not
changed — except an orphan your own fix creates, which you remove.

**Remove the failure, do not only make it rarer.** A retry, a longer timeout or a wait that
can still end in the same error is a mitigation: the reporter's "I got an error" still
happens. Fix the source (the refusal, the lock, the race) so the user never sees it, or, if
that is a real design choice, give the operator the options with your pick before you build
(their `CLAUDE.md` asks for that). (2026-10-22: #7087 retried a refused contract update on
the client for 2 minutes and then showed the same error; "no it should just queue it
instead of showing an error".)

**Before you commit, run `copy-sweep '<broken pattern>' ['<file also has>']`** (the same
class string, hardcoded count, query, guard or link-out) and fix each copy it lists in this
PR, through one shared constant or helper. It searches the whole repo; a search of only the
folders you are working in is how copies get missed. A copy of the same bug is the bug the
operator reported, seen from another screen, not a second defect to ask about. (2026-10-22:
the 6-column platform row was fixed in the ad builder only, "no its not". 2026-10-27: a
link-out sweep of `components/portfolio` missed the same video tiles in five other creator
surfaces, and the operator found them from a screenshot.) The merge check asks again when no
sweep ran in the session.

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

## Why it was possible
<the structural cause from Phase 3b, and what now stops this class of bug — or the follow-up
ticket for it, or "one-off" with the reason>

## Fix
<what changed and why this removes the cause>

## Verification
<what you ran and what you observed — actual output, not "tested and works">
```

Link the Jam report or `SID-###` when there is one. Add `[no-deploy]` to the title if
every changed file is docs/tests/CI/scripts. A fix that writes a cone-declared Firestore
surface goes through the cone's repo boundary (enforced by CI).

## Phase 8 — Prove it end to end

Tests passing is not proof. On the PR's Vercel preview (a push builds none: run
`npm run vercel:preview` on the branch, no permission needed, and use the address it prints), or the running app for
code with no preview, drive the real user flow to its outcome in the shared agent Chrome:
the reported symptom is gone, and the neighbouring flows still work. For UI, check desktop
and phone widths. For data jobs, run on a small real sample and read the result. Use the
`proof` skill when the flow has several steps or several parties. If it fails, go back to
Phase 5.

Then get an independent check: run the `skeptical-verifier` agent with the original report,
the PR branch and the preview URL or the command that reproduced the bug. Do not give it
your conclusion. It re-runs the reproduction itself. A FAIL goes back to Phase 5; merge only
after a PASS.

## Phase 9 — Merge

Merge yourself when **all** of these hold:

- Phases 6 and 8 showed the symptom stop, with the same instrument that proved the
  mechanism. A partial verification does not qualify.
- Every CI check passes (`gh pr checks <pr>`). A check also red on `main` does not count as
  passing. Wait for late checks: `gh-approve` can merge before they report.
- The size check still says small.

Before invoking the merge script, run `~/dotfiles/claude/bin/pr-checks-green <pr>`. It refuses pending, failed, cancelled, timed-out, unknown and empty results. Do not infer success from an empty pending/failure filter or rely on required checks alone. A nonzero result blocks merge.

Merge with `/pr-approve`: `.claude/skills/pr-approve/scripts/gh-approve <pr> --merge`.
Never `gh pr merge --admin`. Run it after the final push; a later push can dismiss the
approval. Then confirm the production deploy reaches READY; on `git_info_fail`, run
`vercel redeploy <url> --scope side-shift`.

If any condition fails, leave the PR open and go to Report.

## Report

Plain sentences: what was broken, the cause in one line, why it was possible and what now
stops it coming back (or the follow-up you filed and your pick), what changed for users, and
the evidence. If anything is unverified, lead with that.

- Merged: `**Status:** Done — verified · PR #123 <url> · merged: yes`.
- Not merged: say which gate failed (large UI, large feature, CI, unverifiable step), give
  the preview URL and what to click to review, and end with the status line below. When
  large UI is the only gate, first make a clickable local copy of the changed page
  (captured with `~/.claude/bin/page-snapshot.mjs`, working buttons and states, preview
  link inside; see the global CLAUDE.md UI-approval rule) and open it in Session Board's pane
  with `node ~/session-board/scripts/board-browser.mjs <file.html> "<what to approve>"`,
  so the operator can approve it at a glance. **iOS change: the live simulator, not screenshots.**
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
