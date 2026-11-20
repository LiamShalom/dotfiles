# Campaign terms and trial messages

Use when: a brand asks how to roll out new pay terms to creators already on a campaign ("from which
date", "can I drop a platform for some creators"), or a brand or creator complains about an automatic
trial message ("you passed the trial, you're in, keep posting", a trial removal, a trial welcome) or a
dispute that followed one.

Facts below were checked on `origin/main` and Firestore on 2026-11-19. Code moves: if a file or line
here no longer matches, fix this file (step 7 of the skill).

## Rule for this topic: read the code before you name a date or option

An earlier run (pure, 2026-11-17) said "date you pick" and named TikTok removal before reading the code,
and needed two corrections. Read the files below first.

## Pay terms: how the "from when" works

- `lib/payouts/terms-versions/terms-start.ts`: on a company that pays from statements, the start choice is
  `'now' | 'unpaid'`. There is no date picker. `now`: work from the change on; videos posted before keep
  their pay. `unpaid`: also all work not yet paid, however old.
- The bulk terms dialog is `components/campaigns/campaign-terms-modal.tsx` (pay, requirements,
  deliverables). Check that file before you say a platform can be dropped there.

## Trial: how the automatic messages work

- A trial is stored per contract in `contractsv2.creatorTrial` (terms such as `{days:14, posts:6}`,
  `signedAt`, `firstPostAt`, `progress`, `outcome`, `decidedAt`, `notifiedAt`). It is frozen at signing,
  so a later change of the campaign's own `programs/<id>.creatorTrial` (it may read null) does not touch
  contracts that already have one.
- The sweep is `lib/campaigns/creator-trial-evaluator.ts` (`runCreatorTrialSweep`). When the goals are met
  (`evaluateCreatorTrial` in `lib/campaigns/creator-trial.ts`) it sets `outcome: 'passed'` and queues the
  creator DM from `creatorTrialMessage('passed')`: "You passed the trial for <campaign>. You're in. Keep
  posting!". The text has been the same since #5790 (2026-10-02; `git log -S "You passed the trial"`).
- The goals count from `firstPostAt` (first-post rule). A contract with no `firstPostAt` and an old
  `signedAt` uses the activation window (`resolveCreatorTrialWindow`), so posts made right after joining
  can pass it quickly.
- Passing keeps the creator in the campaign (only `removed` expires the contract). Until PR #11304 the
  passed DM said "You're in. Keep posting!", which creators of brands that use the trial as a one-off job
  read as an offer of more paid work (youmeal, 2026-11-20). #11304 changed it to "the trial won't remove
  you. Anything beyond your current contract is up to the brand." There is no brand switch to turn the
  passed DM off.

## "SideShift approved a request on its own"

A creator DM "Your request to join <campaign> was approved. Add your accounts to start." with no brand
action that day comes from `lib/handle-requests/approval-side-effects.ts` `buildApprovalMessage`. When the
brand earlier accepted the creator's job application, that created a brand-sent contract
(`contractsv2.openApplicationJobId` set). When the creator signs it, `accept.usecase.ts`
(`isBrandSentInvite`) auto-approves the campaign-join request: `handle_requests` row with
`reviewed_by` null, `reviewed_at` 3 s after `requested_at`. Proof: `job_applications` row for the
creator and job, `status` Accepted, `contract_id` = that contract, and the contract `createdAt` = the
"accepted your application" DM time. Handles still wait for the brand (`requestedHandles` pending).

## Symptom to cause to proof

| Symptom | Cause | Proof |
| --- | --- | --- |
| "Updates last week sent the passed message" | Not the updates: passes were decided on 10-28 to 11-18 (youmeal job); the text is from 10-02 | Firestore query below; `git log -S` above |
| Message date in a screenshot is before the merges named (Nov 12-13 trial PRs) | The DM follows the sweep's `decidedAt`, not a release | `creatorTrial.decidedAt` and `notifiedAt` on the contract |

## Checks

```
firestore_query_collection contractsv2
  where companyId == <company id>, creatorTrial.outcome == "passed"
  selectFields creatorTrial, status, programId, activatedAt
```
Read `terms`, `firstPostAt`, `progress`, `decidedAt` for each. Then
`firestore_get_document programs/<programId>` and read `creatorTrial` (null means no new trial starts).
Match the screenshot's message date to `decidedAt`. `find_account` does not find a creator by display
name; ask for an email or handle if you must pin one contract.

## What to reply

Say what triggers the message (the trial goal met), when it was sent (the `decidedAt` date) and that the
text did not change in the recent updates. Do not say who set the trial, and do not promise a change of
wording. If the brand did not want "You're in", the cause is the trial terms on the contracts, not a bug.
