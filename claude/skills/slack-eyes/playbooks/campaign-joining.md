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
- **Any one platform or every platform** (#11502, live 2026-11-20 20:03 ET): `requirements.accountPlatformsRule`,
  unset = `any` (one approved account on a listed sign-in platform clears the hold). Between #10411 and
  #11502 the gate needed every listed platform. A held contract is re-checked only on an account link
  or handle approval, so contracts held under the old rule stay "Adding accounts" / Invited even with
  approved accounts. Release: workflow `release-accounts-holds.yml` (`gh workflow run ... -f
  execute=false -f company=<id>`, read the log, then `execute=true`). Run log greps: `clears:`,
  `started=`. On 11-21 it had run for one company only; couponbirds: creators stuck invited found 380
  more held contracts and ran it for everyone.
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
- **Invite-link sign-ups are decided on Applicants, not Requests** (#10964, live 2026-11-19): job
  picker "Via invite link", `/campaigns?tab=applicants&jobId=invite-link`. Handles added after the
  accept are approved at once (except a handle another creator holds, or after a rejected one). Direct
  invites and handle requests stay in Requests. The creator row's "Review request" opened Requests for
  invite-link rows until #11121.
- **The Join row's accounts are a preview, not part of the request.** The Requests tab shows a
  pending join row (`platform` null) with the creator's connected accounts (#10528, #10713). Approving
  it approves the contract only: `approve-core.ts` skips `applyHandleRequestToProfiles` for a join.
  Each account then arrives as its own `handle_requests` row that the brand approves or rejects one by
  one (`juno: approve single accounts`, 2026-11-18: join approved 11-17, typed account rows 9-27 h
  later, each reviewed by a brand member). Before sign-first, the apply itself made one row per
  platform. So "we can only approve or decline the whole bundle" is answered by: accept the join,
  then decide each account. Exception: on OAuth platforms a proven account auto-approves (next line).
  A brand asking to bring back accounts-at-apply for its campaigns: Liam said no on 2026-11-18 (juno
  thread). SideShift pushes creators to link (OAuth) accounts, not typed handle requests: a linked
  account needs no handle request, and tracking survives a handle change. Do not build a per-campaign switch.
- **A proven handle is approved with no brand review** once the brand chose the creator and the
  creator signs in to the account: `reviewed_by` is empty and it is approved in the same second
  (`lib/handle-requests/creator-proven-approval.ts`, #9845).
- **Typed handles after Accept (rule in `createHandleRequest`, `lib/handle-request-utils.ts`):** from
  11-18 (#10483) to 11-20 12:40 ET (#11315), every typed handle of an accepted creator auto-approved.
  Since #11315, typed handles on invite-link sign-ups, accepted applications and live contracts go to
  the brand again. Only proven accounts (OAuth or ad grant) and typed handles on a direct invite the
  brand sent still auto-approve. A typed handle on a direct invite is approved before the background
  existence check runs (`verifyHandleInBackground`), so a handle that does not exist can still pass.
  Answer "is this new" from `git log -L` on that block and the live prod commit (mise, 11-20).
- **Invite-link sign-ups are decided on Applicants, not Requests** (#10964, 11-19): a pending join from
  an invite link is left out of Requests (`isPendingInviteLinkApplication`,
  `lib/api/applications/handle-requests-applicants.ts`) and listed under "Via invite link" on
  `/campaigns?tab=applicants`.
- **`reviewed_by` like `invite_<hash>` is a brand team member's account**, made from a team invite
  (`inviteProvisioningUid`, `lib/api/team/team-invite-claim.ts`). It is not a creator invite.
- **Handle removal.** Approval retires the handle (`retired_at` on `contract_social_profiles`); an
  edit retires the old one (`applyHandleRequestToProfiles`, `lib/handle-requests/approve-core.ts`).
  Before #10602 (2026-11-17) an approved removal changed nothing. Check 4 shows what is still live.
- **Wrong account on a contract.** Live contract: the brand's Edit handles changes the handle or
  platform in place; its delete shows only when the creator has more than one handle
  (`components/campaign-details/handle-editor.tsx:273`). Pending (held) contract: the brand cannot
  edit. A creator `remove` request (`POST /api/internal/creator/my-gigs/handles`) has no contract
  status gate, never auto-approves (`creator-proven-approval.ts` skips `remove`), and its approval
  retires the handle at any status (`approveRemovalCore`, `approve-core.ts`). Only iOS has a remove
  screen (`ManageHandlesCoordinator.swift` mode `.remove`); the web creator modal only adds or
  replaces (`manage-handles-modal.tsx`). Fastest fix: retire the handle for them as a repair. Worked on
  2026-11-17 (`plutus: remove wrong creator account`): a script calls `createHandleRequest({actionType:
  'remove', notifyBrand: false})`, then `approveHandleRequestCore` with the same request fields, with the
  primary PG flags from `repair.md`. Loading the imports took about 10 minutes, so run it in the
  background. The dashboard `postgres_query` refuses `contract_social_profiles`, so check
  `contractsv2/<id>.socialProfiles[].retiredAt` in Firestore instead.
- **Held on `ad_authorization` (partnership ads).** What the app gets: run
  `getCreatorAdAuthorizations(creatorId, {contractId})` in a script, with the iOS header
  `x-sideshift-capabilities: social-oauth-any-provider,ad-authorization-x` and the PG flags from
  `repair.md` (without them the readiness read is refused and `brandReady` comes back false). Which
  row still holds it: `resolveAdAuthorizationGate` (`lib/ads/creator-auth-activation.ts`); TikTok
  counts as done when the connect has `biz.spark.auth`. The creator's iOS build: PostHog
  `execute-sql` on `events` where `distinct_id` = creator id, `properties.$app_version`/`$app_build`.
  On 2026-11-19 (`plutus: remove wrong creator account`), Vercel log search timed out or returned
  `ExceedsBillingLimitError` even for same-day windows. Use the Vercel MCP `get_runtime_logs`
  (project `prj_7XAyuxYeC5acULBSrmnOB5lkd9f5`, team `team_5b6u1x436MeurtU4qBa1Y1lC`, 1-day retention).
- **"Turn on partnership ads" opens an Accounts tab with no ads section (iOS ≤ 2.30):** the section's
  load sat on an empty SwiftUI `Group` and never ran; fixed in mobile PR #400 (ships with the next iOS
  release). Workaround that works now: the creator opens
  `https://app.sideshift.app/ad-authorization/<contractId>` and taps Approve. List the brand's held
  contracts with `activation_blocked_by = 'ad_authorization'` and give one link per creator.
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

**Which iOS code runs.** The App Store build is not always `main`: check
`curl -s 'https://itunes.apple.com/lookup?bundleId=com.SideShift&country=us'` for the version, then find the
branch whose `Version.xcconfig` has that `MARKETING_VERSION` (2.30 shipped from `creator-release-polish`, PR #359,
while `main` said 2.39). `~/sideshift-mobile`'s working tree can be months old: read with `git show origin/<branch>:<path>`.

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
| iOS: contract link in a chat flashes a "Preparing your contract" skeleton and closes, held contract | iOS 2.30 (`creator-release-polish`, not `main`) closes the sign sheet and opens the campaign page on the Home tab without switching tabs (`showGetReady` → `.openCampaignFromActivity`); fixed in mobile #382 | Webapp logs per tap: `GET contracts/{id}` 200, then `GET jobs/{programId}` 404 from the hidden page. Workaround: creator taps the Home tab |

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
- **Brand asks to "bypass" a creator outside the campaign's countries** (invite modal shows "Outside
  campaign countries", or the creator's verified ID country is not in `requirements.verifiedResidenceTargeting`):
  no code change. Grant a per-creator exception with the staff script, dry run first:
  `npx tsx scripts/set-campaign-residence-exception.ts --company=<id> --campaign=<id> --creator=<uid> --actor=aHvxZwk6eYczQLCfCu5aDms9ysY2 --action=grant --reason="..."`
  then the same with `--execute`. The verified country is `users.withdrawalApprovalCountry`; pick the
  account with `withdrawalApprovalProfileStatus` approved when two users share a name. The invite
  modal then shows "Manually approved", and the send (`send-campaign-invite`, `create-batch`) and the
  creator's accept modal honor it. It is per campaign: a wrong campaign id was an earlier mistake here.

## Join requests in Messages (elevenlabs: handle approval missing in chat, 2026-11-19)

- Since #10036 (11-13) a creator can accept before adding accounts. That writes a `handle_requests` row with `platform`/`handle` null: a join request. The chat profile panel on the right shows it as a "Join request" card with Approve/Reject while `status='pending'` (`dm-creator-context.usecase.ts`). No card means nothing is pending: check `handle_requests.reviewed_at` against the screenshot time.
- The header's "Handles Awaiting Review" was cached per page and did not clear after an approval until reload. Fixed in #11102: `use-creator-status.ts` re-reads on the `refreshPendingRequests` window event. Sidekick decisions still fire no such event, and the inbox rail dot refreshes only every 2 min or on focus.
- `reviewed_by` = `invite_<40 hex>` is a team member uid from `team-invite-claim.ts`, not a campaign invite.

## "Can we stop non-US creators before they post?" (melaxin, 2026-11-20)

- Answer: campaign setting "Require a verified country" (`components/campaigns/wizard/residence-requirement-field.tsx`). When it is on, apply (`creator-apply.usecase.ts:117`), invite accept (`accept-invite.usecase.ts:442`) and brand add (`contracts/create-batch.usecase.ts:740`) refuse a creator whose Whop KYC is not verified in a listed country.
- State per campaign: Firestore `programs/<campaignId>.requirements.verifiedResidenceCountries` (empty or absent = off). Read it with `select_fields: ["requirements"]`. A dotted `requirements.verifiedResidenceCountries` select silently returns nothing, which looked like "off" and led to a wrong reply and a correction.
- Turning it on for a live campaign: the campaign page then shows a country verification banner with "Review creators" (`campaigns/[id]/page.tsx:3826`, shown whenever the requirement is on). It lists current creators by verified-country status. Existing contracts stay as they are (`docs/features/campaign-country-requests.md`). The automatic verify request to existing creators needs `CAMPAIGN_COUNTRY_REQUESTS_ENABLED=1`, which was not set on production `sideshift-web` on 2026-11-20 (`vercel env ls production --project sideshift-web --cwd /tmp`).
- Stay on the channel's account. Several companies can share a brand name (one per agency, plus SideShift's managed one), and each is a separate customer. Find the channel's account by team membership (`users/<companyId>/members` holds the reporter's email), then query by that `company_id` only, never by `company_name`. `campaign_manager_campaigns` misses some campaigns: list the account's campaigns from Postgres `campaigns` where `company_id` = the account, and confirm a "done" with `updated_at` there. Never post another same-named account's campaigns, settings or creators in the channel (melaxin 11-20: a run did, and Liam had the posts removed).
- Turn the country gate on from a script (melaxin, 2026-11-20): in a fresh origin/main worktree, call `updateCampaign` (`lib/api/campaigns/campaigns-leftovers-update.usecase.ts`) with ctx `{mode:'admin', userId:<staff uid>, companyId}` and input `{companyId, requirements:{verifiedResidenceCountries:['US'], verifiedResidenceTargeting:{mode:'include',includedCountries:['US'],excludedCountries:[]}}}`, run with `PG_ALLOW_PRODUCTION=1 npx tsx --conditions=react-server --env-file=.env.local`. It returned `updateKind:null` and empty `regenerate`: residence fields are non-material (`lib/campaign-change-summary.ts` NON_MATERIAL_REQUIREMENT_FIELDS), so no contract regenerates and no creator is asked to re-accept. The main checkout was 2,888 commits behind: use a worktree.

## A brand asks to remove (kick) a creator from its roster

Proved 2026-11-19 and 2026-11-23 (`afina: remove creator`). Do it the way the brand's own Remove
button does: a throwaway `scripts/tmp-*.ts` in a `sideshift-setup` worktree that calls
`removeCreatorFromCompanyCampaigns` (`lib/api/creators/creators-remove.usecase.ts`) with a payload for
the company owner uid (`users/<companyId>`), `mode: 'keepPosts'`, `endReason: 'creator_content_issue'`
(for quality or missed-deadline kicks). Import `db` from `@/utils/firebase/admin`. Run with
`env PG_ALLOW_PRODUCTION=1 npx tsx --conditions=react-server --env-file=.env.local <script>` without
`--apply` first (prints the creator's active campaigns), then with it. Check on the replica: the
`contracts` row is `expired`, `ended_by company`, `expire_reason` "Creator removed - posts kept for
payouts", its `contract_posts` stay. The creator gets one summary DM. Delete the script after.
