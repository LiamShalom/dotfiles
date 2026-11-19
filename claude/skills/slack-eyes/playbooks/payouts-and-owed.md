# Payouts and owed amounts

Use when: a creator or brand says an owed or earnings amount dropped or shows $0, a payout is stuck, failed
or "under review", a payout modal shows an error, videos are pending review or payment, a creator will not
do KYC or ID checks, a brand asks to cancel or fund a top-up (ACH, card, crypto, escrow), or a brand asks to
archive campaigns that still owe money. The proof is often only in a screenshot, so read the files first.

Facts below were checked on `origin/main` and the read replica on 2026-11-17. If a file or column no longer
matches, fix this file (step 7 of the skill).

## The rule for this topic: start from the contract, prove from the ledger, then reply once

Twelve runs on 11-16 and 11-17 lost time on the same four things. Do not repeat them.
1. Find the contract first (check 1). Every owed, stuck and pending question is a read of that contract's
   ledger rows, payout lines and posts. Do not read code before you have the contract.
2. Code search: use `git grep -n <x> origin/main -- <paths>`. In many of the 11-16/17 runs `rg` was "command not found",
   `timeout` does not exist on this Mac, and repo-wide `grep -r` hit the 120 s limit. The local checkout is old (2,307 commits behind `origin/main` on 11-17): never read it.
3. Check the setting before you say what a click does. Hearing buddy: the first reply said an approval
   sends the money. The campaign had "Pay creators automatically" off, so a correction followed.
4. Do not call a number wrong before you split it by paid and unpaid posts. Both eco gpt runs found the
   amount correct: 16 posts were already paid by an earlier payout, and days with no posts explained the rest.

A money write goes to Liam (`needs_liam`): void a top-up, release a held transfer, skip cycles, archive a
campaign that owes. Prepare it, dry-run it, then hold. Do not promise the outcome in the thread.

## How it works

- **Owed in the creator app** is the server's `cycleEarnings` (`lib/creator/my-gigs-cycle-info.ts`,
  `resolveCycleEarningsCents`). On a posts-based price it is the full cycle price x delivered / required.
  The calculator (`lib/payouts/cycle-calculator.ts`) then subtracts what existing payout lines already paid.
- **Payout lines** (`payout_line_items`, one row per paid post and component) are the record of what was
  paid. A post with a line is paid. Owed falls when a payout writes lines, when posts are removed or
  excluded (`contract_posts.removed_at`, `payout_line_items.crosspost_excluded`, `platform_excluded`,
  `over_max_posts`), or when the cycle rolls over.
- **The money record** is `wallet_ledger` (`wallet_id` is the brand's company id). `reason` is the kind:
  `contract_payout`, `one_time_payout`, `quick_pay`, `wallet_topup`, `escrow_deposit`, `embed_transfer`.
  A custom payout has `is_custom_payout` and `payment_breakdown->>'baseBeforeOverrideCents'`, the amount the
  calculator wanted before the brand typed a different one.
- **Paying does not need KYC.** In the last 30 days, over 4,000 completed `contract_payout` rows went to
  creators with no KYC profile or an unverified one (join `wallet_ledger` to `contracts.contractor_id` and
  `account_kyc_profiles.person_id`). KYC gates only the creator's withdrawal: `account_kyc_profiles` and
  `lib/api/whop/user/user-verification.ts` (`evaluateWithdrawalGate`, which reads the profile address
  country, not the ID country). The US form asks for an SSN (`components/kyc/verification-about-step.tsx`).
  The banner title "Pending approval" shows when the identity check is in manual review
  (`components/kyc/verification-action-banner.tsx`).
- **"Pay creators automatically"** is `campaigns.setting_pay_on_approval` (stored as `settings.payOnApproval`).
  On: an approved video queues a row in `approval_payments` and a cron pays it
  (`lib/api/approval-payments/run.usecase.ts`). Off: the brand approves, then pays from its payouts page.
  Only paid-ads campaigns can use it (`lib/payouts/pay-on-approval.ts`, `automaticPayEligibility`).
- **Archive guard.** Archiving blocks while creators are owed (`campaigns-leftovers-mutate.usecase.ts`,
  `lib/payouts/campaign-outstanding-payouts.ts`). The company flag `archive_with_outstanding_balances`
  (`lib/flags/registry.ts`) bypasses it. Archiving does not forgive the balance.
- **Whop top-ups.** Our app has no code that voids a Whop payment (it voids only Whop invoices, in
  `lib/api/invoices/invoices-public.ports.ts`). The `payment.voided` webhook only marks
  the ledger row voided (`dispatch.payment-lifecycle.usecase.ts`).
- **Connect transfers** (`reason='embed_transfer'`): `DELETE /api/embed/transfers/{id}` cancels only an
  unsettled one. A transfer that was submitted and parked is released by staff with
  `release_verified_provider_absence` (`POST /api/admin/embed-withdrawal-transfer-operations/{id}`, admin
  password). The rule: provider search found nothing, and the submission is over 72 h old
  (`lib/embed/withdrawal-transfer-resolution.ts`).

## Symptom -> cause -> proof

| Report | Usual cause | Proof |
| --- | --- | --- |
| Owed or earnings dropped | A payout already paid those posts, or days with no posts | Check 2: posts with and without a line. A post count per platform against the cycle target. |
| Cycle 2 owed shows $0 (goodwatch) | The brand typed a custom amount below the calculated one. Lines for the full amount were still written, and the next cycle's lines count as paid | Check 3: `items` greater than `amount_cents`. In 60 days, 1,664 completed custom payouts paid less than the calculated base, and 1,662 of them wrote lines above what was sent. |
| Payout stuck "Pending" | A parked Connect transfer, or Whop refused it | Check 4: `embed_transfer` row `pending` with no `whop_transfer_id`. |
| Failed with "account under review" | A short Whop block on the payer side. Log text: `Your account is currently under review. During this time, you will not be able to send money.` | Check 7 in a window of 40 min or less. Count the failing payers. Then show payouts completing after the window. |
| Payout modal "internal error", 500 or 409 | A database sign-in outage, not the payout | Check 7 with text `cloud_sql_signin_failed` (`sqlstate 08P01`). Many routes fail in the same minutes. The replica tool may fail too. |
| "How much of a late payout was growth after the cycle ended?" (olive: instagram stopped tracking) | A per-video cycle paid late counts each cycle video at its views on the payout day. `posts.views_paid` records that number, so the next batch pays only growth above it | Ledger doc `paymentBreakdown.components`: `performance` lines ("N views → …", sum = cycle videos) plus `continued-performance-cpm` lines ("A → B views", older videos); together they equal `baseBeforeOverrideCents`. Growth = paid views − `sum(post_daily_stats.delta_views)` through the cycle end, × CPM. The doc is too big for the dashboard tool: use the Firestore bridge (port 47802, `get_document`) |
| Videos pending, no payment | Brand has not reviewed, or automatic pay is off | Check 5. |
| Creator refuses SSN | Not needed to be paid, needed to withdraw | Check 6. Never advise to remove the creator. |
| Whop top-up wanted cancelled | ACH row `pending_bank`, Whop shows it voidable | Check 8. Void is a write: hold for Liam. |
| ACH top-up "Deposit failed" right after "Bank transfer started" (tapcook 11-18) | Whop rejects it before the bank: payment `open`/`failed` within ~2 s of `paid_at`, `failure_message` "The payment failed.", no `decline_code`, `amount_after_fees` 0. Nothing in our ledger says why (`failureMessage` "failed") | GET `api.whop.com/api/v1/payments/<id>` with `.env.local` `WHOP_API_KEY` + `Api-Version-Date: 2026-08-21` (GET only). Same method succeeding before rules out our side. Only Whop knows the reason: ask Brendan in #sideshift-x-whop (C09NST1C9JN) with the `payt_` and `pay_` ids. A real bank NSF shows `generic_decline` and fails a day later. |
| Creator withdraw sheet: "Your account is currently unable to move money out. Please contact support." (home game 11-19) | Our own payment review holds the withdrawal: `account_kyc_profiles.provider_payout_manual_block=true` and a `payment_review_cases` row `status='pending'`, `blocks_money_out=true`. Signal `crypto_country_manual_review`: crypto withdrawals from a listed KYC country (NG) need approval for a new payout destination. Whop's code is `move_money_out_blocked` | Replica: `select status, signals, decision_notes, slack_message_ts from payment_review_cases where subject_user_id='<creator id>'`. Staff decide it in the internal dashboard payment-review tab (`app/api/internal/dashboard-capabilities/payment-review/route.ts`). Approving is a risk call: hold for Liam. `account_kyc_profiles` is denied on the dashboard tool; use the replica |
| Archive all campaigns and fix what they owe | Guard blocks while owed | Check 9. Needs Liam's yes. |

## Checks (read replica: `mcp__cloud-sql-postgres-read-replica__execute_sql`)

1. The contract. `contracts.creator_id` is set on 921 of 754,539 contracts from the last 60 days. Use
   `contractor_id` (set on all; a ghost handle looks like `ghost-<contract id>`):
   ```sql
   select c.id, c.company_id, c.campaign_id, c.status, c.last_payout_at, k.name, k.setting_pay_on_approval, k.archived_at
   from contracts c join campaigns k on k.id=c.campaign_id
   where c.contractor_id='<creator id>' order by c.created_at desc limit 10;
   ```
2. Paid and unpaid posts: `select count(*) posts, count(li.id) paid_lines, count(*)-count(li.id) unpaid from contract_posts cp
   left join payout_line_items li on li.contract_id=cp.contract_id and li.platform_post_id=cp.platform_post_id
   where cp.contract_id='<id>' and cp.uploaded_at >= '<cycle start>'`. Add `cp.removed_at`, `cp.removed_reason`
   and `posts.deleted_at` (join `posts` on `company_id` and `platform_post_id`) to see why a post does not count.
3. Payouts on the contract against what the calculator wanted:
   ```sql
   select l.created_at, l.status, l.amount_cents, (l.payment_breakdown->>'baseBeforeOverrideCents')::bigint base,
     l.is_custom_payout, left(l.notes,60) notes, (select sum(amount_cents) from payout_line_items li where li.ledger_id=l.id) items
   from wallet_ledger l where l.contract_id='<id>' and l.reason='contract_payout' order by l.created_at desc;
   ```
4. Stuck or failed rows for a brand: `select id, reason, status, amount_cents, transfer_id, whop_transfer_id, error_code,
   left(error_message,100), left(finalization_error_message,100), transfer_attempted_at, created_at from wallet_ledger
   where wallet_id='<company id>' and status in ('pending','failed','unknown','reversed') and reason<>'wallet_topup'
   order by created_at desc limit 10`.
5. Videos: `select status, count(*), min(submitted_at), max(reviewed_at) from video_submissions
   where contract_id='<id>' group by 1` (status: `pending`, `approved`, `rejected`, `revisions_requested`,
   `library`). Then `select status, count(*), sum(paid_cents) from approval_payments where contract_id='<id>' group by 1`
   (status: `needs_payer`, `paid`, `failed`, `cancelled`, `paid_by_hand`). Read `setting_pay_on_approval` from check 1.
6. KYC: `select verified, payout_status, provider_verification_status, withdrawal_approval_status,
   payout_country_mismatch, country, provider_payout_account_country, provider_payout_manual_block, action_required,
   action_reason from account_kyc_profiles where person_id='<creator id>'`. `payout_status='pending_verification'`
   with `verified=false` means the creator has not finished.
7. Logs: `logs_search_webapp` (internal-dashboard). Window 60 min at most, set `since` and `until` (not
   `from`/`to`). Use `route` (for example `/api/payouts`) with `statusCode` `5xx`, or `text`. Each hit shows one
   line per request. Take the screenshot time, convert to UTC, search 10 minutes around it.
8. Pending ACH top-ups: `select l.id, w.company_name, l.status, l.whop_status, l.whop_substatus, l.voidable,
   l.source_amount_cents, l.created_at from wallet_ledger l left join wallets w on w.company_id=l.wallet_id where l.reason='wallet_topup'
   and l.status='pending' order by l.created_at desc`. On 11-17 the dashboard `postgres_query` had no
   `payment_method_type` or `payin_status` column on `wallet_ledger` (`postgres_describe_table wallet_ledger`). The
   amount is `source_amount_cents` (`amount_cents` is null on a pending row). Several brands can have one at
   once: ask which brand before you pick.
11. A brand wired money and it is "not in the wallet" (mangolabs, 11-18). Non-agency wires go to the company's own
   Stripe virtual account (`stripe-bank-transfer-topup.ts`, customer cash balance in `manual` mode). The ledger shows
   nothing until Stripe receives the funds, so read Stripe, not only `wallet_ledger`. The agents-billing key
   (`STRIPE_SECRET_KEY` in `~/.config/sideshift/env.local`; load it with `eval "$(grep ^STRIPE_SECRET_KEY= …)"`, not
   `source`: the file does not source cleanly) can read
   `GET /v1/customers/<cus>/cash_balance` and `GET /v1/events?type=customer_cash_balance_transaction.created&limit=50`
   (all customers, with sender name, reference and amount). No `funded` event for the amount on any customer means
   Stripe has not received it: ask for the bank's trace (Fed IMAD/OMAD or SWIFT MT103/UETR). Every `funded` event is
   followed seconds later by `applied_to_payment`, so the credit path works. The key cannot read funding instructions
   (POST needs `funding_instruction_write`).
10. Top-up fees (ACH, card) and caps. `FeeConfig` is `percentFee` + `fixedFeeCents` + optional `maxFeeCents`
   (a per-top-up cap, #10765, 11-17). The cap lives only on a `customFees` doc, must be a number, and is never applied
   to wires. The dashboard fee API cannot set it yet: write it with firebase-admin (`ref.update({maxFeeCents})`). Prove
   it live on a test brand: a temporary capped doc, then `GET /api/whop/fees` returns `maxFeeCents`. The rate is `users/<id>/customFees/<method>` if set (a Connect
   sub-account also reads its integrator's, `embedIntegratorId`), else the plan rate in
   `NEW_TOPUP_FEE_CONFIG_BY_PLAN` (`lib/fee-utils-server.ts` `getCustomFee`). No active subscription = Starter
   (bank 3%, card 5%). Our modelled Whop ACH cost is 0.8% capped at $5 (`calculateProcessorFeeCents`).
   Connect integrators fund through `reason='escrow_deposit'` rows, sub-accounts show `embed_transfer`.
   A cap or a rate change is pricing: hold for Liam. Once he picks a rate, set it with the dashboard's
   `POST https://sideshifters.vercel.app/api/employers/<id>/fees` (`{paymentMethodType, percentFee, fixedFeeCents,
   notes}`, Bearer = minted liam@ token, see memory `internal-dashboard-url`). Prove it by running
   `getCustomFee(<id>, 'us_bank_account')` with tsx `--conditions=react-server` for the integrator and one sub-account.
   (clipstake: ACH fee, 11-17: 1% with a $10 cap. "1% so no cap needed" was wrong for big top-ups: $1k on $100k.)
9. Archive: `lib/payouts/campaign-outstanding-payouts.ts` gives the owed total. Run a read-only dry run first.
   Escrow crypto: deposits are `wallet_ledger` rows with `reason='escrow_deposit'`. The Firestore
   `embed_escrow_deposits` is outside the dashboard tool: say what you could not read.

## Tool traps (seen in 12 runs)

- The dashboard `postgres_query` refuses `information_schema` ("System catalogs are available only through schema
  tools"). Use `postgres_search_schema` (argument `search`) or the read-replica tool.
- Wrong argument names failed 5 runs: `postgres_query` needs `sql`, `firestore_get_document` needs `path`,
  `firestore_query_collection` needs `collectionPath`.
- The replica tool can fail with `server login has been failing ... 08P01` (see check 7). Retry once.

## What to reply

- Owed looks wrong: give the arithmetic with their numbers (posts counted x rate, minus what was paid, and the
  payout date). Name the days with no posts. Do not say "tracking is broken" before check 2.
- Custom payout below the calculated amount: say what the brand typed, what the calculator wanted and which
  cycle the lines cover. Promise no fix until Liam decides.
- Short outage: say it was a short problem on our side or Whop's, give the window, and say payouts completed after it.
- Videos pending with automatic pay off: the brand must approve, then pay. Say who must act.
- Creator will not give an SSN: the brand can still pay. The money waits in their SideShift wallet. They verify only
  to withdraw, and US creators must give an SSN.
- A follow-up that only says thanks needs no reply.

## Dispute screen shows "No payment cycles are available to dispute yet"

- The cycles list (`lib/disputes/disputable-cycles.ts` getDisputableCycles) reads posts only from the
  Firestore subcollection `contractsv2/{id}/posts`. If the brand removed the creator with "Delete campaign
  data", those posts are gone and the list is empty, even when posts were never paid. Check:
  `select removed_reason, count(*) from contract_posts where contract_id='<id>' group by 1` (`contract_wipe`)
  and `firestore_count_collection contractsv2/<id>/posts` (0). Proven on `wheelz: dispute continue greyed`.
- The "Other" dispute type needs no cycle, and the create route (create.usecase.ts) has no contract-status
  check, so a cancelled contract can still file one.

## Agency client offboarded while the agency plan pays (aydus: veed, 2026-11-18)

- Sign: a client (sub-account) shows `offboarded_reason = 'Grace window expired — subscription not restored'` while its agency has an active plan. Check `companies` for the client: its own `stripe_customer_id` differs from the parent's, and its own old sub was cancelled.
- Cause before #10843: the grace opener (`utils/firebase/admin-billing.ts`) and the hourly sweep (`lib/api/cron/dunning-sweep.usecase.ts`) only read the client's own Stripe customer. Since #10843 both call `agencyPlanCoversClient` (`lib/billing/agency-plan-coverage.ts`), so this should not recur.
- Repair: `PG_ALLOW_PRODUCTION=1 npx tsx scripts/restore-false-churn-offboards.ts --company <id>` (dry run), then add `--apply --notify`. It refuses without the env flag before writing anything. Check after: `offboarded_at` null, no campaigns with `archived_reason like 'Grace%'` still archived.
- Handle approvals refused with "linked contract is declined" after a restore: the creator declined the invite. Not caused by the restore; the brand can reject the requests or re-invite.

## A client paying a SideShift invoice is stuck on "Confirming your payment" (foundable, 2026-11-18)

- A client who pays SideShift (or a brand's customer) pays an **invoice**, not a wallet top-up, so `wallet_ledger` and
  Stripe show nothing. Find it in Firestore: `invoices` `where customerEmail == <payer email>` (the dashboard
  `firestore_query_collection` takes `where`; an unknown key such as `filters` is silently ignored and returns random docs).
  SideShift's own invoices have `companyId 7UwCuR27Byk1E9t7lDAv`.
- `elementsPaymentAttempt.paymentId` is the latest Whop payment. `invoices/<id>/invoicePaymentFailures` holds one doc per
  failed Whop payment (written by the `payment.failed` webhook). Read each at `GET https://api.whop.com/api/v1/payments/<pay_id>`
  with `WHOP_API_KEY` from the monorepo `.env.local`: `substatus failed` + `amount_charged 0.00` = nothing debited.
  Whop gives only "The payment failed." for these ACH failures; no reason is exposed.
- Since #11008 (merged 2026-11-19) the public invoice response carries `lastPaymentFailed` and the page shows the pay
  form with an error. Before it, a failed ACH payment left "Confirming" forever.
- `allowedPaymentTypes` can list `bank_wire` while Whop's payment form shows only Card and ACH. Check the live page
  before telling anyone wire is available.
