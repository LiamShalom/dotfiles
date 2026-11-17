# Campaign joining, handles and holds

Use when: a creator is stuck on "Adding accounts" or never goes live, a brand cannot add or edit a
creator's handles, a brand wants creators to skip a platform, applicants show no handle, a creator
who was not hired has handles, a handle removal did not apply, a brand wants to add a creator to an
ended or archived campaign, or one account connect landed on several campaigns. Facebook and
Instagram connect errors are in `facebook-oauth.md`.

Facts checked on `origin/main` (277e351dbb) and the read replica on 2026-11-17. If a file here no
longer matches, fix this file (step 7 of the skill).

## The rule for this topic: read the contract's own rows, then answer once

Five of ten earlier runs posted a wrong line first, and one query would have stopped each: a
campaign-wide workaround before the per-creator route was read; "the removal worked" from an approved
request, not the handle row; a team member's id read as a creator invite; "an ended campaign cannot
take invites" (true for email invites only); a Facebook guess before the missing platform was read.
Run checks 1 and 2 before any reply, and name a platform only after check 2 shows it missing. Use the
read replica (`mcp__cloud-sql-postgres-read-replica__execute_sql`): the dashboard `postgres_query`
refused some of these tables and joins in three runs, and Firestore paths in five. Read code with
`git show origin/main:<path>`. `timeout` does not exist on this Mac.

## How it works

- **Sign first, accounts after.** Every listing signs at apply, and the brand's Accept is the hire
  (`isOpenListing`, `lib/campaign-join/open-listing.ts`). There is no setting to change this. An
  applicant, and a creator who signs a brand's invite, sign with no accounts. The contract waits as
  `status='pending'`, `activation_blocked_by='accounts'` (UI label "Adding accounts",
  `components/campaign-details/contract-lifecycle.ts`) until each required platform that has a
  sign-in has a live account (`resolveAccountsRequirement`, `lib/campaign-join/accounts-gate.ts`,
  #10411, live 2026-11-16).
- **Required platforms** are the campaign's `requirements.platforms`, or the contract's own list when
  Customize set `platformsOverride` (`resolveRequirements`, `lib/payment-structure-utils.ts`). A
  creator can add only listed platforms: others fail with "Platform X is not required for this
  campaign" (`lib/api/contracts/accept-helpers.ts`).
- **A brand cannot write handles on a `pending` contract**; only active, expired and completed ones
  (`lib/api/campaigns/creators-handles/joined-contracts.ts`). Liam kept this on 2026-11-17: the
  creator connects every account. A creator who cannot connect is a connect bug, not a reason for a
  brand bypass.
- **Skip a platform for one creator:** the creator row menu shows Customize on a held contract
  (`isEditableContract`, `lib/contracts/contract-lifecycle.ts`). The sheet "Customize for <name>" has
  "Campaign terms" and "Contract". On Campaign terms, go past Pay, then untick the platform on
  Requirements. A terms save re-checks the hold (`lib/api/contracts/held-release.ts`, #10610, live
  2026-11-17). Removing a platform from the campaign also releases held creators
  (`campaigns-leftovers-update.usecase.ts`), but then nobody can add it.
- **A proven handle is approved with no brand review** once the brand chose the creator and the
  creator signs in to the account: `reviewed_by` is empty and it is approved in the same second
  (`lib/handle-requests/creator-proven-approval.ts`, #9845).
- **`reviewed_by` like `invite_<hash>` is a brand team member's account**, made from a team invite
  (`inviteProvisioningUid`, `lib/api/team/team-invite-claim.ts`). It is not a creator invite.
- **Handle removal.** Approval retires the handle (`retired_at` on `contract_social_profiles`); an
  edit retires the old one (`applyHandleRequestToProfiles`, `lib/handle-requests/approve-core.ts`).
  Before #10602 (2026-11-17) an approved removal changed nothing. Check 4 shows what is still live.
- **Ended and archived campaigns.** An email invite is refused one day after the end date
  (`send-campaign-invite.usecase.ts`). Creating an invite link checks no end date
  (`createCampaignInvite`); redeeming it fails if the link is expired or used up
  (`invite-token-post.usecase.ts`). Accepting a contract on an archived campaign fails: "This campaign
  is no longer available" (`accept.usecase.ts`). Un-archiving restores the contracts the archive ended
  (`expire_reason` "Campaign archived", `lib/api/contracts/campaign-archive.ts`).
- **Account connect.** The follow-up `/connect/select` adds the account to the campaign it is sent,
  else to the campaign of the same provider's connect that finished in the last 15 minutes
  (`select.usecase.ts`, #10563, live 2026-11-16). A pick of an earlier-connected account with no
  fresh sign-in can still add it to every waiting campaign.

## Symptom → cause → proof

| What they report | Cause | Proof |
| --- | --- | --- |
| "Adding accounts", creator says all is done | A required platform has no live profile | Check 2 against the required list in check 1 |
| Brand cannot add or edit a held creator's handles | `pending` contracts refuse brand writes, by design | Check 1: `pending` and `accounts` |
| Applicant row shows no handle | Sign at apply; accounts come after Accept | Check 5: row with `contract_signed_at` set |
| Creator who was "not hired" has handles | A team member pressed Accept | Check 5 status `Accepted`; check 3 `reviewed_by` |
| Removed handle still tracked, "already on this campaign" | Approved removal not applied (before #10602), or a re-add | Check 4 |
| One connect appears on 3 or 4 campaigns | `/connect/select` sent no campaign | Check 3 by handle: one row per contract, seconds apart, `reviewed_by` empty |
| Cannot invite a creator to an ended campaign | Email invites stop after the end date | Check 6 |

### Checks (read replica)

1. The contract, its hold and the required platforms. `contracts.contractor_id` is the creator
   (`creator_id` is empty on most rows). Get the creator id with `find_account`.
   ```sql
   select c.id, c.status, c.activation_blocked_by, c.requirements->'platforms' as contract_platforms,
          ca.requirements->'platforms' as campaign_platforms, ca.status as campaign_status, ca.ends_at
   from contracts c join campaigns ca on ca.id = c.campaign_id
   where c.contractor_id = '<creator id>' and c.campaign_id = '<campaign id>';
   ```
2. The live accounts. Missing = required platforms not in this list.
   ```sql
   select platform, handle, connection_status, oauth_verified_at, retired_at
   from contract_social_profiles where contract_id = '<contract id>' order by created_at;
   ```
3. The requests. In two contracts checked, the row with a null `platform` was the join request (made
   at apply; `reviewed_at` was the Accept time). For one connect on many campaigns, filter by
   `lower(handle) = lower('<handle>')` instead of `contract_id`.
   ```sql
   select campaign_id, platform, handle, action_type, status, requested_at, reviewed_at, reviewed_by
   from handle_requests where contract_id = '<contract id>' order by requested_at;
   ```
4. Approved removals whose handle is still live (last 6 days). Rows after 2026-11-17 mean #10602
   did not cover the case: read them.
   ```sql
   select r.contract_id, r.platform, r.handle, r.reviewed_at from handle_requests r
   where r.action_type = 'remove' and r.status = 'approved' and r.reviewed_at > now() - interval '6 days'
     and exists (select 1 from contract_social_profiles p where p.contract_id = r.contract_id
       and lower(p.platform) = lower(r.platform) and lower(ltrim(p.handle, '@')) = lower(ltrim(r.handle, '@'))
       and p.retired_at is null);
   ```
5. The application. Common statuses: `Waiting Review`, `Viewed`, `Accepted`, `Declined`,
   `Rejected`, `Contacted` (read the row; there are others).
   ```sql
   select job_id, status, applied_at, contract_signed_at, contract_id, last_updated
   from job_applications where creator_id = '<creator id>' order by applied_at desc;
   ```
6. An ended campaign: test `status` and `ends_at`, not `archived_at` alone, and list the contracts.
   ```sql
   select id, status, ends_at, archived_at from campaigns where id = '<campaign id>';
   select id, contractor_id, status, expire_reason from contracts where campaign_id = '<campaign id>';
   ```

### What to reply

- **Held, creator missing a platform:** name it (check 2). The creator connects it from the campaign
  and the contract goes live by itself. Do not offer a brand handle bypass: Liam refused it.
- **Skip a platform:** Customize per creator (steps above). Offer the campaign-wide edit only when
  every creator should skip it, and say it blocks that platform for all.
- **Applicants with no handle:** by design. A brand can message applicants from the Applicants page
  before it accepts.
- **"Not hired" creator has handles:** say who accepted and when (checks 3 and 5). Not a bug.
- **Removal not applied:** if the request is older than 2026-11-17, say it was a bug that is now
  fixed. Do not blame the brand, and do not write "a bug on our side" to a customer.
- **Ended campaign:** the brand restores it (status to active, `changeCampaignStatus`), then makes a
  new single-use invite link for the creator. Before a restore, list the contracts with
  `expire_reason` "Campaign archived" (check 6): the restore reactivates those. Do not promise a
  manual contract or payout: that is a customer-data and money write.
