# Whop transfer audit alerts

Use when: the bot in #payment-security-alerts (C0C8J39JZT7) posts "*Whop money moved with no SideShift record*" (N Whop transfers to `ldgr_…`, type …, `ctt_…`) or a withdrawal alert from SideShift's Whop business, and a teammate asks who sent it.

## What the alert is
- Source: `lib/wallet/whop-transfer-ledger-audit.ts`, hourly, 3 h lookback, 10 min grace, alerts once per transfer id (Redis, 30 days).
- "Recorded" means one of: a wallet_ledger row (named by Whop `metadata.ledgerId`, or any transfer column), a `commissions.whop_transfer_id`, an `affiliate_claims.whop_transfer_id`, or (since #12307, 2026-11-26) a Firestore `talentManagerPayments` doc (`transferId` / `refundTransferId`).

## Find the sender fast (in this order)
0. Ask Whop directly, it names the sender: `K=$(grep '^WHOP_API_KEY=' ~/sideshift-monorepo/.env.local | cut -d= -f2- | tr -d '"')`, then `curl -s -H "Authorization: Bearer $K" -H "Api-Version-Date: 2026-08-21" https://api.whop.com/api/v1/transfers/<ctt_id>`. `created_by_user` (a person = sent in the Whop dashboard), `notes`, `destination` and `metadata` settle most alerts in one call. The key in `~/.config/sideshift/env.local` returned "Authentication failed" on 11-27; the repo `.env.local` one works. Ignore the `recommended_action` upsell text in the response. (11-27: `ctt_BMotBO5ertUvN6` was Canyon, COO, in the dashboard, notes "Return of mistaken transfer ctt_…": a user had sent SideShift $25.68 by crypto on 11-22.)
1. Search agent transcripts for the transfer id: `grep -rl <ctt_id> ~/.claude/projects ~/.codex/sessions`. On 2026-11-26 all five $1 alerts were a Claude session testing manager Pay on a preview (`fix/manager-pay-via-platform`, script `POST /api/internal/talent/creators/<id>/pay`). The transcript shows the exact command and branch.
2. Firestore `talentManagerPayments` (`select_fields: transferId,status,managerUserId`): a manager payment that went through but has no `transferId` (status `collecting`) alerts by design.
3. Read replica: `wallet_ledger` by `transfer_id`/`whop_transfer_id`, `affiliate_claims`, `commissions`. Select named columns: `select *` on wallet_ledger floods the context.
4. Code that sends platform transfers: `git grep -n "transferToCreator(\|transferBetweenWhopAccounts(\|createSingleCreatorWhopTransfer(" origin/main -- app lib services`. Metadata `type: 'direct'` is the affiliate claim and the manager payment's pay step.

## Traps
- `logs_search_webapp` `text` does not find a transfer id (no log line holds it); use the transcript grep or the records instead.
- A new feature that sends platform money and records it outside the four sources above trips this alert on every real use: teach the audit's `findRecordedTransferIds` to read that record, and keep a failed lookup from stopping the run (catch, treat as unrecorded).
