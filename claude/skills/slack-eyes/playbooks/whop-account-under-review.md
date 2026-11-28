# Whop "account under review" and suspicious wallet activity

Use when: a payout fails or reverses with Whop's "Your account is currently under review. During this time,
you will not be able to send money.", several brands report failed payouts in the same minutes, or a teammate
flags a brand that funds its wallet by card and then withdraws (Whop denied a withdrawal, "looks suspicious").
The proof is in `wallet_ledger`, not in Slack text: read the ledger before you reply.

Facts below were checked on `origin/main` and the dashboard Postgres tool on 2026-11-17. If a file or column no
longer matches, fix this file (step 7 of the skill).

## The rule for this topic: read the ledger, then reply once

Earlier runs lost time on: hedging which account Whop flagged (one grep answers it, see below), giving
times in the wrong time zone (check the screenshot clock; one reporter was UTC+2), and promising "checking with
Whop" in the thread. This run cannot contact Whop: promise no vendor contact, and do not propose asking Whop
(petaluma health 11-17, Liam: "no need to contact whop"; `slack-as-liam` now refuses such a post). A freeze, a void or a refund is
a money and risk call: prepare the facts, then `needs_liam` with `only_liam_can`.

## How it works

- **Brand payouts to creators** go through `createSingleCreatorWhopTransfer` (`lib/whop-utils.ts`, around
  line 992). It sends `origin_id: platformCompanyId`: the transfer leaves SideShift's shared platform Whop
  company, not the brand's own Whop account. So a "your account is under review" refusal means the shared
  payer was blocked, and every brand paying in that window fails together. The direct transfer helper
  (line ~1432) uses `originWhopId` instead.
- A failed transfer leaves a `wallet_ledger` row with `status='reversed'`. Count reversed rows across wallets
  in a window to see the blast radius (11-17: 6 wallets reversed between 09:17:47Z and 09:27:37Z, then a
  payout completed at 14:26Z; this is a lead from an earlier run, re-run the query).
- **Brand wallet money** is `wallet_ledger` (`wallet_id` = company id): `wallet_topup` rows (card:
  `payment_method_type='card'`, `payment_method_brand`, `payment_method_last4`; ACH: `us_bank_account`),
  `whop_wallet_withdraw` (brand takes money out to its own Whop business, `change_cents` negative,
  `destination_whop_id`, `fee_cents`, `metadata.source='payouts_page'`) and `contract_payout` to creators.
  `wallets.balance_cents` is what is left.
- A declined card shows as a topup with `status='failed'` and `failure_message` (the bank's text).
- A failed withdrawal that Whop denies is not guaranteed to leave a ledger row: on 11-17 a brand flagged for a
  Bitcoin withdrawal attempt had only one completed `whop_wallet_withdraw` and no failed one.

- **Freezing a suspicious brand's money** (petaluma health, 11-17, after Liam said yes): a manual fraud block,
  not a suspension (a suspension emails the brand and locks sign-in). `POST https://sideshifters.vercel.app/api/fraud-block/<company id>`
  with `{"action":"block","note":"..."}` (Bearer = minted liam@ token, memory `internal-dashboard-url`) writes
  `fraudPaymentBlocks/<id>` with `active: true`, all four capabilities, `reasonCategory: 'manual'`. `payout` covers
  wallet withdrawals: `lib/api/whop/wallet/withdraw.usecase.ts` calls `checkFraudPayoutBlock` (`getCapabilityBlock(..., 'payout')`).
  A manual block is never waived by brand verification (`lib/fraud-controls/block.ts`). `{"action":"clear"}` undoes it.
- **A pending Whop top-up**: read it with `GET https://api.whop.com/api/v1/payments/<pay id>` (`WHOP_API_KEY` from
  `.env.local`, read in a script). `failure_message` gives Whop's reason (11-17: "The transaction was blocked due to a
  high-risk fraud evaluation.", `substatus: blocked`, `voidable: false`): such a payment never lands, so there is nothing to void.

## Symptom -> cause -> proof

| Report | Cause | Proof |
| --- | --- | --- |
| Many payouts fail "under review" in minutes | Shared platform Whop payer blocked for a short time | Check 2 for reversed rows across wallets; `origin_id: platformCompanyId` in `createSingleCreatorWhopTransfer` |
| Brand tops up by card and withdraws, no creators paid | Cash-out pattern, possibly card fraud (intent not proven) | Check 1: topups, withdraw minutes later, zero `contract_payout` rows |
| Teammate says Whop denied a withdrawal | Not in our data | Check 1 shows only completed `whop_wallet_withdraw` rows; say you did not see the attempt |

## Checks (dashboard `postgres_query`, argument `sql`)

1. Brand money pattern (find the company id with `find_account` first):
   ```sql
   select reason, status, count(*), sum(change_cents) from wallet_ledger
   where wallet_id='<company id>' group by 1,2;
   select id, source_amount_cents, payment_method_type, payment_method_brand, payment_method_last4,
     payin_status, whop_status, whop_substatus, failure_message, paid_at, created_at
   from wallet_ledger where wallet_id='<company id>' and reason='wallet_topup' order by created_at;
   select id, change_cents, fee_cents, destination_whop_id, completed_at, whop_transfer_id
   from wallet_ledger where wallet_id='<company id>' and reason='whop_wallet_withdraw';
   select balance_cents, created_at from wallets where company_id='<company id>';
   ```
   `source_amount_cents` is what the card was charged (with fees); the wallet credit is `change_cents`
   (they differ: 11-17 case charged about $17,377 for $16,550 of credit). Quote one of them and say which.
   A pending ACH topup shows `whop_status='open'`, `whop_substatus='blocked'`, `payin_status='pending_bank'`.
2. Blast radius of a payer block:
   ```sql
   select wallet_id, count(*), min(created_at), max(created_at) from wallet_ledger
   where status='reversed' and created_at between '<start>' and '<end>' group by 1;
   ```
3. Logs: `logs_search_webapp` takes a window of 60 minutes at most (a longer one errors); use `since` and
   `until`, plus `route` or `text`.
4. Campaign count: `select count(*) from campaigns where company_id=...` and the same on `contracts`.

## What to reply

- Suspicious brand: the facts only (cards used, amounts, the fast withdrawal, zero creator payouts, balance
  left, pending or failed topups). Say what you did not see (the denied withdrawal). Do not call it fraud and
  do not promise a freeze or refund. Hold the freeze, the void of a pending ACH and any refund for Liam.
- Short payer block: say it was a short problem with the payment provider, give the window in the reporter's
  time zone, and say payouts completed after it (show a completed one).

## Tool traps

- In a `slack-as-liam` call, put the text in single quotes when it contains `$`: double quotes let the shell
  eat the amounts (11-17: "$16,550" posted as ",550"; the post had to be deleted with `chat.delete` and sent
  again).
- `logs_search_webapp` rejects windows over 60 minutes.

## "Purchases are paused" on a brand's own Whop checkout (ugc world agency, 11-27)

- To reproduce, open `https://whop.com/checkout/<plan_id>` in an isolated agent Chrome context, then read the response of
  `POST /api/v1/checkout_sessions`. A blocked seller returns `blocking_error: {code: "purchases_disabled"}`. A free plan on the same seller
  is not blocked.
- Find the product first. `GET /api/v1/products?account_id=<biz>&visibilities[]=hidden&...` (repo `.env.local` `WHOP_API_KEY`)
  lists hidden products. Here the product was on the agency's main business, not on the client sub-account it was named after.
- No switch turns it back on: not in the public API (`PATCH /accounts/{id}`, preferences), not in SideShift's Whop dashboard
  (Settings → Payments/Checkout/Risk), and not on the subaccount page (only "View dashboard" and "Remove account"). Capabilities
  show `accept_card_payments: active` even while purchases are blocked.
- What we offer instead: the client sub-account funds its own SideShift wallet (Wallet → Add funds: card, ACH or bank wire).
  Sub-account card and ACH top-ups were confirmed in `wallet_ledger` that week.
