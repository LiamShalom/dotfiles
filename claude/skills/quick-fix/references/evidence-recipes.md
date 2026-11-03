# Evidence recipes

Concrete invocations for each investigation technique in the bugfix workflow. Read the
section you need; skip the rest.

## Contents

- [Jam.dev intake](#jamdev-intake)
- [Linear ticket intake](#linear-ticket-intake)
- [Resolving a name to an id](#resolving-a-name-to-an-id)
- [Querying Postgres](#querying-postgres)
- [Querying Firestore](#querying-firestore)
- [Throwaway probe scripts](#throwaway-probe-scripts)
- [Driving the browser](#driving-the-browser)
- [Reading CI logs](#reading-ci-logs)
- [Filing what you're not fixing](#filing-what-youre-not-fixing)

---

## Jam.dev intake

A Jam report carries more than the video. Pull the structured layers first — they turn a
vague report into a specific one in a single pass.

```
mcp__Jam__getDetails       — summary, reporter, URL, browser/OS
mcp__Jam__getConsoleLogs   — client errors with stack traces
mcp__Jam__getNetworkRequests — failing requests, status codes, payloads
mcp__Jam__getUserEvents    — the actual click path that produced the bug
mcp__Jam__getMetadata      — viewport size, user agent
mcp__Jam__getVideoTranscript — when the reporter narrated
```

The network requests are usually the highest-value layer: a 500 with a request body tells
you the route, the inputs, and the failure in one object.

If no `mcp__Jam__*` tools appear, refresh/reconnect the MCP tool list first. If Jam stays
unavailable and the in-app browser is authenticated, open the report URL there and say
explicitly that this is the fallback. Don't quietly substitute a screenshot for a report
you could have read.

## Linear ticket intake

```
mcp__linear__get_issue      — the ticket
mcp__linear__list_comments  — where the reproduction details usually are
```

Team **Sideshift**, project **AI Issues** for agent-filed issues.

## Resolving a name to an id

For withdrawal reports tied to Plutus or an integration, resolve both the supplied email and its `+1` alias (for example, `name@gmail.com` and `name+1@gmail.com`). Integration payments use a separate `EmbedUser` wallet; do not conclude that a withdrawal is missing from the ordinary account history alone.

Support reports arrive as names ("CheaterBuster", "Noel Moore"); almost every
investigation step needs an id.

Typesense is the fastest fuzzy lookup when you have a partial or misspelled name:

```
mcp__sideshift-typesense__multi_search
```

For an exact company or creator, the Postgres replica is more reliable — see the schema
map at `docs/data-repos/onboarding/07-schema-map.md` for current table and column names
rather than assuming them.

Firestore document ids: a company lives at `users/{companyId}` with `type="Employer"`, a
creator at `users/{creatorId}` with `type="Student"`.

## Querying Postgres

**Reads default to the read replica.** Use the primary only for read-your-own-write
freshness, post-migration verification, or an actual write.

```
mcp__cloud-sql-postgres-read-replica__execute_sql     — the default
mcp__cloud-sql-postgres__execute_sql                  — primary; needs a reason
```

Useful companions when a bug is performance-shaped:

```
mcp__cloud-sql-postgres-read-replica__get_query_plan     — EXPLAIN
mcp__cloud-sql-postgres-read-replica__list_indexes
mcp__cloud-sql-postgres-read-replica__list_query_stats
```

Reference docs: `docs/data-repos/onboarding/02-querying-prod.md` for the read/write
decision rule, `07-schema-map.md` for the schema, `08-indexes-and-query-tuning.md` when
the symptom is slowness.

**Known trap:** `postgres.js` has no NULL branch in its array parser — an unquoted NULL
comes back as the literal string `"NULL"`. Use `json_agg`, never `array_agg`, when a
query feeds application code.

## Querying Firestore

```
mcp__sideshift-firestore__get_document    — reliable
mcp__sideshift-firestore__get_documents   — reliable
mcp__sideshift-firestore__query_collection   — see warning
mcp__sideshift-firestore__count_collection   — see warning
```

**The `filters` argument is silently ignored** by `query_collection` and
`count_collection`. You get unfiltered results that look filtered, which is worse than an
error because nothing signals the problem. Fetch by id, or use the PG replica, whenever
the answer depends on a filter.

Entity layout: company at `users/{companyId}`, contracts at `contractsv2` (with
`companyId`, `contractorId`, `programId`), posts at `contractsv2/{id}/posts/{postId}`,
wallet ledger at `wallets/{companyId}/ledger/{id}` — the ledger is where payout
discrepancies become visible.

## Throwaway probe scripts

The house idiom for "prove this against real data": a single-purpose read-only script at
`scripts/_probe-<topic>.ts`, run with `tsx`, never committed.

```bash
npx tsx scripts/_probe-<topic>.ts
```

Rules that keep this safe and cheap:

- **Read-only.** A naive `tsx` run connects to **prod**. A probe that writes is a prod
  mutation with no review, no migration, and no rollback.
- **Print the number.** The script's job is to produce the observation you'll quote in the
  PR's root-cause section.
- **Don't commit it.** These are scratch instruments; `scripts/` already carries two dozen
  from past investigations. Leaving them uncommitted is the convention, not an oversight.
- Server-only imports need `--conditions=react-server`.
- `DATABASE_URL` in the env points at **local dev**, not prod — don't assume a script that
  reads it is looking at the data the reporter saw.

Naming a variant `_probe-<topic>2.ts` when you iterate is normal and fine.

## Driving the browser

For UI, layout, and flow bugs, against the local dev server:

```
mcp__chrome-devtools__new_page          — open
mcp__chrome-devtools__navigate_page     — go to the repro route
mcp__chrome-devtools__resize_page       — match the reported viewport
mcp__chrome-devtools__take_snapshot     — DOM snapshot with element refs
mcp__chrome-devtools__take_screenshot   — visual check
mcp__chrome-devtools__list_console_messages
mcp__chrome-devtools__list_network_requests
mcp__chrome-devtools__click / fill / press_key   — walk the flow
```

Two things that decide whether this works:

- **Resize to the reported viewport before concluding anything.** A layout bug that's
  invisible at desktop width and obvious at 390px is the single most common way a UI bug
  passes verification and still ships broken.
- **Confirm which checkout `localhost:3000` is serving.** It's frequently a worktree
  rather than the main repo, so your edits may not be in the page you're testing. Check
  the `next dev` process's working directory.

Starting the server: `npm run dev` (`npm run dev:clean` if `.next` looks stale). Worktrees
need `packages/data-repos` built, and Turbopack rejects symlinked `node_modules` there.

## Reading CI logs

Local `tsc`, `eslint`, and `tsup` are unreliable in this checkout because it links
TypeScript 6 — local `tsc` invents phantom files and the others crash. CI is the truth.

```bash
gh pr checks <PR#>
gh run view <run-id> --log-failed
gh api repos/SideShiftApp/sideshift-monorepo/actions/jobs/<job-id>/logs
```

PR job names worth knowing: `Typecheck`, `Typecheck (scripts)`, `Typecheck
(scrape-contracts)`, `Lint`, `Spec lint (Spectral)`, `Tracked secrets`, `Security scans`.

`Typecheck (scripts)` is a **ratchet** — it fails when the error count goes *down* as well
as up. Never edit its allowlist to make a check pass.

The main vitest suite does **not** run on PRs. Run it yourself:

```bash
npx vitest run <path-to-test>
```

**Red gates:** dedupe by gate, not by occurrence. If you turned it red, fix it. If it was
already red, add a comment to that gate's `red-gate` issue (one per `pr.yml` job name) and
move on — don't repair unrelated infra mid-bugfix.

## Filing what you're not fixing

Preference order is **fix it → say it in chat → file it**. Filing is the most expensive
exit, not the safest.

File only for real debt that can't land this session, and only with a concrete blocker:

```
mcp__linear__save_issue    — team Sideshift, project AI Issues; search for a duplicate first
```

Body needs: symptom-first title, `Cone: <name>` or `Cone: none`, repo/branch + `file:line`,
verbatim evidence, impact, one-line discovery context, suggested fix,
**`Why not now: <specific blocker>`**, and `Found by:`. Priority Medium; High only for
data corruption, security, or money.

Cap: 3 tickets per session. If the Linear MCP is genuinely unavailable after a reconnect
attempt, queue it instead:

```bash
gh issue create -R SideShiftApp/sideshift-monorepo --label ai-issues-queue --title "…" --body "…"
```
