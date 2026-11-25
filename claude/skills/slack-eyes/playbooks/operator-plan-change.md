# Operator plan change (renewal dates, prepaid years, plans and features set by hand)

Use when: a brand or agency says its plan shows the wrong renewal or "Free trial ends" date ("I paid the
full year, it should run to Jan"), asks to be put on a plan the app refuses (the Ads plan, a custom plan),
or asks for a feature turned on for its account or clients. The date is often only in the screenshot of
Settings → Plan & Payment, so read the files first.

Facts below were checked on `origin/main`, Stripe and Firestore on 2026-11-25 (ki marketing: agency
renewal date wrong). If a file or line no longer matches, fix this file (step 7 of the skill).

## How it works

- **Prepaid years are often a one-off invoice plus a trialing sub.** A brand pays a `send_invoice` invoice
  (one-time price, e.g. "Scale - Annual") and staff give the subscription a trial up to the paid end. The
  invoice's `period_end` or the payment date + 1 year is the date the customer paid for. The sub's
  `trial_end` is what the app shows and when Stripe charges next. They drift apart when someone makes the
  sub by hand.
- **The Plan & Payment card** (`components/settings/payment-plans-tab.tsx` ~line 337) shows
  `current_period_end` from `/api/check-subscription`. That reads Firestore `subscriptions` where
  `user_id == <companyId>` (`lib/api/billing/subscription/check.data.ts` `getCandidateSubscriptionRows`).
  The Stripe webhook updates that doc within seconds of a Stripe change.
- **Postgres `billing_subscriptions` is not what the page shows.** On 2026-11-25 its row had not been updated
  since 09-14 while Firestore had the new date. Do not use it as proof of what the customer sees.
- **Deleting a client sub-account used to cancel the agency's plan** (cancel reason `account_deleted`,
  metadata `sideshift_cancel_company_id` = the client) when the client shared the agency's Stripe customer.
  Blocked since then: `lib/billing-subscriptions.ts` `getCandidateStripeCustomerIdsForCompany` skips an
  inherited `stripeCustomerId` when `parentCompanyId` is set. A sub canceled that way and remade by hand is
  where a wrong trial length comes from.
- **The Ads plan** (`lib/api/billing/ads-plan/start.usecase.ts`) refuses a brand that ever had a trial, paid
  or a past sub (`had_subscription`), agencies and their clients, and brands without a paid-ads draft. The
  operator path for an approved brand is a direct Stripe subscription on the $0 Ads price with
  `metadata.companyId` (lead from an earlier run).
- **Features** are granted with `scripts/grant-feature.ts` (`PG_ALLOW_PRODUCTION=1`). Run it from an
  up-to-date checkout: an old copy lacks the SideChat → Workflows auto-grant (lead from an earlier run).

## Find the account

The reporter's own user often has no company (an agency signs in under a separate company user). Find the
company by `users/<companyId>/members` or, failing that, `companies` by name with `is_agency`, then confirm
that its Stripe customer's invoices carry the reporter's name. A second Stripe customer on the reporter's
email can be unrelated (e.g. a referral payee).

## Checks: wrong renewal date

1. `stripe_list_for_customer <cus> subscriptions` and `invoices`: find the paid annual invoice (amount,
   `status_transitions.paid_at`, `period_end`) and the live sub (`status`, `trial_end`, `created`).
2. If the live sub was created after another was canceled, read the channel history on that date: a
   teammate's hand-made "temp fix" explains a trial length no code sets. Stripe `/v1/events` keeps only
   30 days, so an older create event cannot be read.
3. Firestore `subscriptions/<subId>` (sideshift-firestore MCP; the dashboard tool refuses this path):
   `trial_end`, `current_period_end`. This is what the page shows.

## Repair (proven 2026-11-25)

With the restricted live key (`STRIPE_SECRET_KEY` in `~/.config/sideshift/env.local`, an `rk_live_` key
that can update subscriptions; read it with grep, since `source` fails on that file):
`POST /v1/subscriptions/<sub>` with `trial_end=<paid end, unix>`, `proration_behavior=none`, an
`Idempotency-Key`, and a `metadata[...]` note naming the invoice. Then check that no new invoice appeared and
that Firestore `subscriptions/<sub>` shows the new date.

## Reply

The customer was right: say so, give the new date and that nothing bills until then. Do not explain the
hand-made sub or the deletion bug unless they ask why.
