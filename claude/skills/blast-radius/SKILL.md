---
name: blast-radius
description: "Find what a change could break outside its own diff, and prove the one fact that makes it safe by running real code. Use before you merge or hand back any change that touches shared code (a usecase, data layer, shared component, hook, API response shape, cron or job, auth or money path), when a small diff feels risky, when someone asks 'what could this break' or 'blast radius', and as the self-review step in quick-fix and execute. Skip it for copy, styling or test-only changes."
---

# Blast radius

Find what a change breaks somewhere else, before it ships. Listing callers is not the job;
grep does that in a second. The job is the breakage grep will not show.

A writeup that sounds right is worthless: it reads as convincing whether or not it is true.
So find the one or two facts the change's safety depends on, and prove them.

## The evidence ladder

For each fact the change's safety depends on, get it as far down this list as is cheap, and
say where it stopped:

1. You said so. Worthless alone.
2. You pointed at the line: a real `file:line`, or the library's own source.
3. You walked the failure step by step and it does not reach.
4. You ran it: a probe or test that calls the real code and fails loud if you are wrong.
5. You reproduced it in the running app or on the preview.

Step 4 is usually one throwaway script (`scripts/_probe-<topic>.ts`, read-only) that calls
the exact function you are worried about.

## Steps

1. **Read the change**: the diff, the symbols it adds, changes and deletes, and what it now
   does differently, including what the diff does not spell out.
2. **Find the one fact it is safe because of.** Most risky-looking changes are safe because
   of a single fact ("this only drops cache entries that are already dead"). If it holds,
   most risks clear at once. Spend your time here, not on a long list of maybes.
3. **Look where grep stops.** In this repo that is usually:
   - a response shape that iOS or the internal dashboard decodes (messaging: run
     `messaging-compat`)
   - a Postgres column or Firestore field another job, script or cone reads
   - a cron, Cloud Run job or webhook that runs the same usecase with different inputs
   - creator versus business surfaces, agency sub-accounts, admin's shared `activeCompany`
   - a cache key or `ANALYTICS_CACHE_VERSION` that must change with the shape
   - the pinned version of a library you call: read its source, not its docs
4. **Rate each risk honestly**: real chance, real cost. Cite a real `file:line`. A search
   that finds nothing is an answer. Never invent a caller or an API.
5. **Prove the one fact** with step 4 or 5 of the ladder. Paste what happened.

## Report

- **What it does**, including the part that is not obvious.
- **The one fact it is safe because of**, the ladder step it reached, and the proof. If you
  could not prove it, write "unproven" and say what would prove it.
- **Risks**: how it breaks, `file:line`, how likely, how bad, how to check.
- **Cleared**: what you checked and why it is fine.
- **Before merge**: the cheapest check that catches the real bug.

An unproven safety fact on an auth, money or data-write path blocks a merge under the
operator's merge rules, because "verified" no longer holds.
