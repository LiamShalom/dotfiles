# Paywall, checkout and the wallet funding gate

Use when: a brand or agency says it is "locked out" or "cannot get into the account" and the screenshot shows a
"Fund your first campaign" card (deposit $500, "Pay with", "Switch company"), a brand asks why it must add funds
before it can continue, or a message is about the look of the trial checkout or the paywall cards (the +$299 bonus
note, the fold on phones). Read the screenshot first: "locked out" has meant this gate, not a sign-in problem.

Facts below were checked on `origin/main` and the company docs on 2026-11-19. Code moves: if a file here no
longer matches, fix this file (step 7 of the skill).

## Wallet funding gate ("Fund your first campaign")

- The gate is `walletReadinessLock` on the company doc (`users/<companyId>`): `required`, `triggerType`,
  `triggeredAt`, `resolvedAt`. Code: `lib/messaging/campaign-wallet-readiness.ts`.
- It arms when a payable post first exists: `triggerType: post_tracked` (the scraper picks up a new post on a
  payout-liable contract) or `video_approved` (first pay-per-upload approval). Creators and agency sub-accounts
  (a company with `parentCompanyId`) are never armed.
- It clears when wallet balance plus pending deposits reach `CAMPAIGN_WALLET_READY_CENTS` = 50,000 ($500). Every
  read recomputes it and writes `resolvedAt` once there is no block (`getCampaignWalletActivationLockStatus`).
  A prior creator payout, or a bypass, also clears it. Pending deposits count.
- It is per company. The shell (`app/(business)/(main)/business-shell.tsx`) reads `useCampaignWalletLock` and
  covers the page of the locked company only; `canSwitchCompany` shows the "Switch company" button.
- An admin re-enables the first-time flow by deleting the field (`scripts/release-hire-trigger-wallet-locks.ts`).
  Do not lift a gate for a brand without Liam's say: it is a funding rule, not a bug.
- To lift it for one company (Liam's :saluting_face: on a teammate's "can we lift the top up" ask is his say):
  `scripts/override-wallet-readiness-lock.ts --company <id> --reason "<why>"` (dry run), then add `--apply` with
  `PG_ALLOW_PRODUCTION=1`, run from a `sideshift-setup` worktree off origin/main. It sets `required:false`,
  `resolutionType:manual_override`; a resolved lock is never re-armed. Without the env var the dry run prints, then
  hangs on the PG pool: stop it. Check `companies.wallet_readiness_lock` on the replica after (2026-11-23).

## Symptom to cause to proof

| Symptom | Cause | Proof |
| --- | --- | --- |
| "Locked out", screenshot of the funding card | `walletReadinessLock.required` true, `resolvedAt` null on the company the user is in | `firestore_get_document users/<companyId>` with `select_fields: ["walletReadinessLock","parentCompanyId"]` |
| Same, but the user's other client account works | The client is a sub-account: it has `parentCompanyId` and no lock field | same read on the client company id |
| Account looks fine but the user cannot enter | Check suspension first: `find_account` gives `suspension`, `offboardedAt`, `billingStatus` | `find_account <email>` |

## Checks

1. `find_account <email>`: company id, suspension, billing status, `parentCompanyId`.
2. Read `walletReadinessLock` on that company and on each client company the user can switch to.
3. Read the lock's `triggerType` and `triggeredAt`; the creator post that armed it is `triggerRef`.
4. Do not claim what clears it until you have read `evaluateCampaignWalletReadiness` (balance + pending >= $500).

## What to reply

One or two lines: it is not a lockout, it is the fund-first-campaign step; it clears when the wallet (balance plus
pending deposits) reaches $500; a sub-account without the lock field can be entered with "Switch company".

## Checkout and paywall UI (lead from an earlier run, not re-checked today)

Trial checkout is `components/billing/trial-checkout.tsx` (`CheckoutSplitView`, aside first on phones); paywall
cards are `launch-paywall.tsx` (`PricingPlanCard` `footerNote`). Prove a fold change on the Vercel preview, not a
local `next dev` under load. Run a new vitest file alone, not in a multi-file run.

## Plan card look (checked 2026-11-20, #11308)

One card component serves /pricing, the onboarding paywall and settings: `components/pricing/pricing-plan-card.tsx`,
styled by `components/pricing/pricing-plans.module.css`. The featured (dark) card is `.cardFeatured`; the trial side
of the checkout is `.darkGround` in `components/billing/trial-checkout.module.css`. Both carry the blue glow gradient
(`--ds-hero-surface-image`). #11308 made them flat on a customer's "no shine / blue" ask; Liam reverted it in #11545
("the one thats solid looks worse"). Do not flatten them again without Liam's say. A CSS-only look change here
merges as a small UI change; prove it on the preview's /pricing as the test brand.
