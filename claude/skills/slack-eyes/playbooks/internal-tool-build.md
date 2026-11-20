# Internal tools, ad attribution and "did it ship" questions

Use when: a teammate or an ad-agency partner asks whether a change shipped ("did the returning-visitor
fix ship?"), asks for a Stripe export or read-only Stripe access for ad reporting, asks which ad a paying
customer came from, or asks for a new admin or internal-dashboard tool (a screen to find or flag
creators, posts or campaigns).

Facts below were checked on 2026-11-20 with `gh` and the landing-page repo. Code moves: if a PR or file
here no longer matches, fix this file (step 7 of the skill).

## The rule for this topic: find the right repo first

The marketing site lives in `SideShiftApp/landing-page`, not in the monorepo. A search of monorepo PRs for
"returning visitor" finds nothing. Search both:

```sh
gh pr list -R SideShiftApp/landing-page --state all --limit 40 --json number,title,state,mergedAt
gh pr list -R SideShiftApp/sideshift-monorepo --state all --search "<words>" --json number,title,state,mergedAt
```

## Attribution facts (ad click to paying customer)

- **Returning-visitor fix = landing-page #278**, "Write attribution cookies for visitors who never answer
  the cookie banner", merged 2026-11-10T15:55:58Z. `components/AttributionCookies.tsx` on main (lines
  40-45) writes `attribution_first` / `attribution_last` on `effective.marketing`, not on the stored
  banner choice. Before it, a visitor who clicked an ad and signed up on a later visit lost the source.
- **Deployed:** `gh api repos/SideShiftApp/landing-page/deployments?environment=Production` lists
  production deploys; `gh api repos/SideShiftApp/landing-page/compare/<old>...<new> --jq .status`
  returns `ahead` when a deploy contains an earlier one. The Nov 16 and Nov 19 deploys are ahead of the
  merge. That proves the code is deployed, not that every visit now keeps its source: say "shipped and
  deployed", not "working", unless you queried real signups.
- **Ad id carry-through is a separate change:** landing-page #290 (adds `utm_id` and `sideshift_ad_id`
  to the tracked keys and cookies) and monorepo #10450 (stores them at signup). Both were open on
  2026-11-20. Meta ads put the ad id in `sideshift_ad_id` (template `utm_source=facebook`) or the campaign
  id in `utm_id` (template `utm_source=meta`).
- Earlier work: monorepo #5692 (2026-10-01) copies `fbc`, `fbp` and the DataFast id onto the Stripe
  customer. DataFast was removed from the product app (#9395, 2026-11-10); the partner agency now uses
  PostHog.

## A Stripe export for an external agency

The partner asked for either a restricted read-only key (customers, subscriptions, invoices, charges) or
a CSV (email, trial start, first payment, renewals, cancel date). Agents hold no production Stripe keys
except `agents-billing`, and only a human can create a restricted key in the Stripe dashboard. A CSV of
customer emails leaves the company. Return `needs_liam` with `hold_reason=only_liam_can`, ask which one
he wants, and reply only with the facts above (the answer to the other question).

## Source per paying customer (checked 2026-11-20)

- Stripe customer metadata `userId` = the app user id = `persons.id` on the read replica. `persons.utms`,
  `attribution_first`, `attribution_last` hold the signup source. Join on that, not on email.
- The app's signup record had a source for 459 of 4,439 subscriptions since Aug 15 (Stripe metadata: 336);
  for payers 95 of 1,116.
- PostHog does not fill the rest. Project 633691 "SideShift App" is app.sideshift.app, identified by the
  28-char user id: its `$initial_utm_*` added 14 rows. Project 267410 "SideShift Web" is sideshift.app (the ad
  landing pages): its visitors are anonymous and never linked to an app account (0 user-id distinct ids, a few
  hundred with an email). HogQL has no SHA256, execute-sql returns at most 500 rows (page with
  `distinct_id > '<last>' ORDER BY` and copy each saved tool-result file), and HogQL file exports are off.
- "Coverage fell in November" in Stripe data: 434 free SideShift Ads subscriptions started in November with
  no checkout (2 carry a UTM). Leave the free plans out before you compare weeks.
- Paid invoices: `billing_reason` subscription_cycle = renewal, subscription_update = upgrade or proration.
  A trial's first payment is a subscription_cycle invoice.
- The export ran as a tsx script from the main checkout (`--conditions=sideshift-src`, both env files
  sourced, `env -u STRIPE_SECRET_KEY`), with `getReplicaSql()` from `@sideshiftapp/data-repos`.
- slack-as-liam refuses posts and uploads in C09BUS9AGRZ (shared channel, no account scope, "internal"
  refused): Liam posts the files himself.

## An admin or dashboard tool

Use the `paired-admin-tab` skill: a dashboard capability route plus use case in the monorepo, and a tab
and proxy route in `SideShiftApp/sideshift-internal-dashboard`, as two cross-linked PRs; API merges
first. Proven once (creator screening, monorepo #10971 + dashboard #292).

## What to reply

One or two lines. Name the PR number only if the reader can use it. Say "shipped and deployed" with the
merge date; say what is still open ("passing the ad id through is not merged"). Do not promise what
someone else will do, and do not say a fix "works" without a query on real signups.
