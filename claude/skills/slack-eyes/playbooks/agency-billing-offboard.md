# Agency client offboarded or warned while the agency pays

Use when: an agency says a client sub-account's campaigns got archived, creators got "stop posting" emails, or
the client shows a payment warning, while the agency's own plan is paid ("our subscription is active", "the $999
plan has unlimited clients"). Also when a client shows "Subaccount" in Switch Company but was offboarded.

## Cause seen (aydus: veed, 2026-11-18)

The client had a leftover per-client sub on its OWN Stripe customer from before the agency moved to shared
billing. When that sub lapsed, grace opened and the hourly dunning sweep offboarded the client 7 days later.
Before PR #10843 both paths checked only the client's own customer. Since #10843 (live 2026-11-18),
`lib/billing/agency-plan-coverage.ts` `agencyPlanCoversClient` skips grace and offboard when
`clientDependsOnAgencyPlan` holds and the agency's customer has an active-like sub. A new case after 11-18 is a
different cause: check that the agency sub was really active and the client really depends on it.

## Checks

1. `postgres_query` (dashboard): `select id,name,stripe_customer_id,active_subscription_id,plan,plan_tier,separate_agency_subs,grace_started_at,offboarded_at,offboarded_reason from companies where id='<agency>' or parent_company_id='<agency>'`.
   A client whose `stripe_customer_id` differs from its siblings' (shared = the agency's customer) holds its own sub.
2. Stripe (shared `STRIPE_SECRET_KEY`, read): `GET /v1/subscriptions?customer=<cus>&status=all` for agency and client.
3. Campaign/contract damage: `campaigns` where `archived_reason like 'Grace%'`; `contracts` by `expire_reason`/`cancel_reason`.

## Repair (all proven on Veed)

1. `PG_ALLOW_PRODUCTION=1 npx tsx scripts/restore-false-churn-offboards.ts --company <id>` (dry run), then
   `--apply --notify` (creators get a "keep posting" email). Needs a live base sub row for the client.
2. After restore, retire the client's own sub: set metadata `sideshift_cancel_reason=plan_switch_dedup`,
   `sideshift_cancel_churn=false` FIRST, then `DELETE /v1/subscriptions/<id>` (`prorate=false`, `invoice_now=false`),
   then void its open invoice. The webhook then logs `cancellation_explicitly_not_churn` and leaves the client as is.
3. That leaves the client on its old sub's limits and a stale `activeSubscriptionId`. Give it the agency's limits with
   `computeChildWrite` (parent `planTier`, `planPolicyKey`, `allocationFromStored(parent)`) via `companiesRepo.update`,
   plus delete `activeSubscriptionId`. `scripts/repair-agency-child-entitlements.ts` skips such a client
   (`already_granted`). Verify against a sibling's row.

## Liam's rule

A custom deal (a client's own invoiced sub, e.g. a $3,999 send_invoice) should ideally never be offboarded, so
agency coverage that keeps it open is wanted, not a risk.

## Traps

- The merge hook asks for every real account a billing change reaches: query them before `gh-approve`.
- New code that reads `users` docs must go through a read port (`stripeWebhookData.getUser`), or the
  users-read-ratchet guard fails CI.
