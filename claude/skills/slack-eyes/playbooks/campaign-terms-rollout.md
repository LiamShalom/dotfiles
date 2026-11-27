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

## Off statements: a rate cut or a move reprices old unpaid videos (checked 2026-11-21)

- Only companies with an enabled `feature_grants` row for `payouts_v2` pay from statements (3 on
  2026-11-21). Elsewhere `update-regen.usecase.ts` ~L405 records the terms version with no
  `effectiveFrom` (`terms_versions.effective_from` null), and the engine prices every unpaid video at the
  contract's current rate (`lib/payouts/terms-versions/terms-start.ts` header). A move keeps the same
  contract id and swaps its terms (`move-creator.usecase.ts`); the move dialog's payout date defaults to
  today ("Posts before this date are tracked but not paid").
- Proof query: `terms_versions` with `lag(terms->'paymentStructure'->>'perPostRate')` per `contract_id`,
  source `update-with-regeneration` / `move-creator`, and `effective_from` null.
- Reply: off statements, pay out what is owed before the rate change or move. "From now on" exists only
  on statements; whether to move a company there is Liam's call.

## Terms vs contract document: separate edits, separate start rules (checked 2026-11-20)

- Customize on a creator row (`components/campaigns/contract-customize-flow.tsx`) is a fork: Campaign
  terms OR Contract, one at a time. Neither screen links to the other.
- Both in one go: "Send new contract" (row menu, active contracts only, `agreement-menu-items.tsx`)
  opens a draft with Edit terms + Edit document (`agreement-sheet.tsx` DraftCard), sent once.
- When pay starts: a terms save (`lib/api/contracts/update-regen.usecase.ts` ~L407) records the terms
  version at save time ('now') or for all unpaid work ('unpaid'); it does not wait for the creator, it
  only sets `contractAccepted=false` to ask for a re-accept. A sent new contract starts at the creator's
  signature (`sign-staged.usecase.ts` `effectiveFrom: signedAt`). So terms-only is the faster path.
- A shared-contract (template) sync (`id-contracts/apply-campaign-contract.ts` L274-281) changes only the
  document (`pendingCreatorContractUpdateKind='document'`), leaves pay untouched, records no terms
  version, and skips creators with a custom contract. Order of terms vs template edit does not affect pay.
- Not proven: what payouts do for a creator who never re-accepts. Do not claim it.

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

## A creator missed a campaign-wide contract update

Find the run and its jobs first: `contract_update_runs` (by `campaign_id`) and `contract_update_jobs`
(by `run_id`, `contract_id`). A contract left out of the run was dropped before the queue. Check
the open-agreement guard with `agreement_states` (`state` `awaiting_recipient`/`awaiting_sender` skips;
`signed` does not). Before #11588 (11-21), on a per-creator campaign `campaignRegenerationTargets`
(lib/api/campaigns/campaign-edit-plan.ts) also skipped any contract with custom pay OR a stored
`requirements` object (even just `{postFrequency}` from creation) unless its own pay or requirements
changed, so settings/type/name/date edits never reached it. Since #11588 that only happens when the same
save also changes pay, requirements or pro-rata. Contract docs live in Firestore `contractsv2`; the
campaign doc is `programs/<id>`; the PG `contracts` table keys on `campaign_id`.

To re-send one contract's update: queue a one-job run with `enqueueContractUpdateRun` and flag the
contract as regenerate.usecase.ts does (`pendingCreatorContractUpdate` etc. via
`defaultContractsDocsPorts.commitContractUpdates`), run with `PG_ALLOW_PRODUCTION=1`. The every-minute
cron renders and DMs; check the job's `status='done'` and `notified_at`.

## "I changed the crosspost setting but the past didn't recalculate" (checked 2026-11-26)

- The stored rule is `programs/<id>.paymentStructure.crosspost` (`basis` `post` = each platform copy pays
  on its own, `group` = one video pays once); PG `campaigns.payment_structure->'crosspost'` mirrors it.
  `resolveCrosspostPayment` (`lib/payments/content-terms.ts`) reads it, so nothing flips it later by itself.
- Read it again after the brand says they changed it. Then check the write in the logs: the web editor saves
  with `PUT /api/programs/<id>` (`use-save-campaign-edit.ts`); `PATCH /api/oauth/v1/campaigns/<id>` is an
  API or AI-connector call (MCP `update_campaign`), whose body the logs do not show.
- A save to `group` triggers bulk crosspost detection (`campaigns-leftovers-update.usecase.ts` ~L669).
  Off statements, unpaid posts reprice under the stored rule; paid line items stay.

## "We lowered her view minimum but she still sees the old terms" (checked 2026-11-27, snazo)

- Brands that "customize" by sending a new invite link with its own terms (`programInvites/<token>.paymentStructure`;
  links carry no creator id) change nothing for a creator who already has a contract on the campaign.
  `findReusableInviteContract` (`lib/contracts/invite-contract-revision.ts`) reuses her signed contract, the
  invite GET then shows `resolvePaymentStructure(existingContract)`, and the POST reuse path never writes
  the link's terms. Proof: link `usedCount` 0 plus GETs on `/api/programs/invite/<token>` at the creator's
  message time; her `agreement_versions` v1 still holds the old value.
- Fix for the brand: row menu > Customize > Campaign terms on that creator (`isEditableContract` allows a
  contract held for accounts). The brand's screenshot of the link page signed in as a business shows the
  link's terms, not hers.
