# Affiliate codes, Stripe promo codes, and the missing Affiliates tab

Use when: a teammate or brand asks how to get an affiliate code or link for someone, says "I don't see
the affiliate tab", or a growth/referral discount (a Stripe promotion code on an affiliate) does not
apply or has a wrong id.

Facts below were checked on `origin/main` and the read replica on 2026-11-27. Code moves: if a file or
line here no longer matches, fix this file (step 7 of the skill).

## How it works

- A brand's affiliate dashboard is the `/affiliates` page. Its rail item is built in
  `components/nav-main.tsx` (about line 488): it is left out when `!canViewFinancials` or
  `isDemoCompanyId(effectiveCompanyId)`. The sample company id is `demo-cluely` (`lib/demo/ids.ts`).
- The `affiliates` table (read replica) is keyed by `user_id` and holds `referral_code`, `status`,
  `stripe_promotion_code_id`, `discount_percent` and `program_config` (jsonb). The Stripe promotion
  id sits in `program_config.subscriptionDiscount.stripePromotionCodeId`
  (`lib/affiliate/program-config.ts`).
- A person with no `affiliates` row has no code yet. A Stripe-only code that a teammate made by hand
  is not an affiliate record and shows nowhere in the app.

## Symptom, cause, proof

| Symptom | Cause | Proof |
|---|---|---|
| "I don't see the Affiliates tab" | The person's `activeCompanyId` is `demo-cluely` (the shared sample account), so the nav hides the item | `find_account <email>`: `activeCompanyId`; `nav-main.tsx` condition above |
| Tab missing on a real company | The member cannot view financials (`canViewFinancials` false) | the member's team permissions on that company |
| Discount code does not apply | `stripePromotionCodeId` is a code text (like `GROWTH`), not a `promo_...` id | Stripe `GET /v1/promotion_codes?code=<CODE>` returns the real id; `GET /v1/promotion_codes/<CODE>` says "No such promotion code" (lead from an earlier run, not rechecked) |

## Checks

1. `find_account <reporter email>` and read `activeCompanyId`. If it is `demo-cluely`, that is the cause.
2. Does the person have an affiliate row:

```sql
select id, user_id, user_type, referral_code, status, created_at
from affiliates where user_id = '<userId>';
```

3. For a discount id, read `program_config` on that row and check the id in Stripe with the
   `agents-billing` key (the internal-dashboard `stripe_get` has no promo prefixes: use curl).

## What to reply

- Say the proven cause and what to do (switch to their own company in the company switcher). State
  the condition, not the outcome: only the code condition is proven, not what their own company shows.
- Do not promise a code or a link on someone's behalf.
