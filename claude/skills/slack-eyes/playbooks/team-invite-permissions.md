# Team invites, seats, roles and permissions

Use when: a brand or agency says it cannot add a teammate ("can't add anymore people", "Team seat limit
reached"), a pending invite blocks a seat, a permission is missing in the invite picker when campaigns are
selected, someone asks to make a teammate Owner or Admin, or a removed brand still shows in a user's
company switcher. The error is often only in the screenshot: read the files first.

Facts below were checked on `origin/main` on 2026-11-19 (seat count and picker) and in earlier runs
(the other items are leads: re-check before you rely on them). If a file here no longer matches, fix this
file (step 7 of the skill).

## Seat limit ("Team seat limit reached")

- The limit is counted per company, sub-accounts included: `getTeamSeatUsage` in `lib/team-seat-limits.ts`.
  `usedSeats` = member docs under `users/{companyId}/members` that hold a base seat (the Owner counts) +
  **live pending invites** in `invites` (`companyId` = that company, `status` pending, not past `expiresAt`).
  A pending invite holds a seat until it expires (7 days) or is cancelled. A hired campaign manager's seat holds none.
- `maxSeats` = plan seats + `extraTeamSeats` (an ops grant on the company doc `users/{companyId}`, default 0,
  written only by `app/api/admin/team-seats/route.ts`). Agency sub-accounts can be capped at the starter tier
  when `separateAgencySubs` is set on the agency or the sub-account. The modal text can name a different
  tier than the plan the agency pays for, so do not quote the modal's tier back.
- The refusal is `team_seat_limit_reached` (invite modal and `lib/api/team/create-invite.usecase.ts`); staff
  actors skip the check.

### Proof (aok media: openart seats, 2026-11-19)

Sub-account showed 5/5. Members query `users/<subCompanyId>/members` returned 3 docs (Owner + 2 employees);
Firestore `invites` where `companyId` = the sub-account returned 2 pending invites (created Nov 17, expiring
Nov 24). 3 + 2 = 5. Reply: the pending invites hold seats; cancelling an unused one frees it.

Query the invites with the `sideshift-firestore` MCP `query_collection` (`invites`, single-field filter on
`companyId`, select `email,status,createdAt,expiresAt`). The internal-dashboard Firestore tool refuses this path.

### Granting extra seats (once Liam approves)

No admin token is needed. Write a throwaway script at the main checkout's root that imports
`@/scripts/_server-only-shim`, then calls `getTeamSeatGrant` and `setTeamSeatGrant({ companyId, extraSeats, actorUserId, reason })`
from `lib/api/admin/team-seats/team-seats.usecase.ts`. Run it with
`PG_ALLOW_PRODUCTION=1 npx tsx --env-file=.env.local <file>`, then delete the file. `extraSeats` is the absolute
total grant, not an addition to the current one. The view it returns shows `maxSeats` before and after (openart, 2026-11-19: 5 to 15).

## Missing permissions when campaigns are selected

`components/settings/team-scope-picker.tsx` (line 27, 53) filters the catalog by `CAMPAIGN_LIMITED_SCOPES`
when the invite is limited to selected campaigns, so account-level scopes such as Payments & billing are
not offered. Working as designed: tell them to pick "All campaigns" for those scopes.

## A new route 403s "Access denied for this company" for some teammates

`canAccessCompany` (lib/jwt.ts `resolveCompanyAccess`) runs the team request gate first
(`memberAllowsTargetRequest`, lib/api/core/team-request-access.ts). A seat with `campaignIds` set is refused on any
route missing from `CAMPAIGN_AWARE_ROUTES` (lib/api/core/campaign-limit-routes.ts), even when the use case filters by
`campaignLimitFor` itself. The refusal reads as the generic company 403, not `campaign_limited`. hivescales (11-24):
`recruit/invite-campaigns` from #11743 was not on the list; fixed in #11888. Check the seat's `campaignIds` and
the route's scope (`teamRouteScope`) before you blame missing permissions. Logs carry no user id, so prove it with a
`team-request-access.test.ts` case on the seat's shape.

## A campaign-limited seat on an AGENCY account gets "Couldn't load the review queue"

On an agency root (`isAgency`, no `parentCompanyId`) the video review page sends `agencyId=` reads
(`use-video-review-queue.ts` scope memo): `/api/video-submissions`, `review-programs?scope=agency`,
`posts/awaiting-approval?agencyId=`. Each checked the agency with `memberAllowsAgencyRequest`, which refuses every
seat with `campaignIds` (`filterMemberCompanyIdsForRequest` keeps only `limit === null`), so all three 403'd even
though the routes are campaign-aware. spacexsi (11-24): Kai's seat limited to 3 campaigns. Fixed in #11934
(`memberAllowsLimitedAgencyRead`, opt-in `validateRequestedAgency(..., { narrowsToCampaignLimit })`). Unit tests
that mock the agency check as `true` hid it: check the real `team-request-access` behaviour. Request logs carry no
user id; find the person's own requests with `vercel logs --query <uid>` (pgwrite lines name the uid) for the timeline.

## Owner / Admin requests

An internal teammate asking for Owner on a customer account is held for Liam (`suspicious_request`).
Look for the team on the agency account, not a same-named sub-company (ridge run: the members lived on the
agency; found through the `invites` collection by email).

## Removed brand still in the switcher (lead, fixed #10976)

Prod serves the switcher from Firestore `multipleCompanies`. The add path used to union `companyId` into it;
check `users/{uid}.companyId` and `multipleCompanies`.

## Reply

Short, one fact: the number (members + pending invites), what frees a seat, and where (cancel the invite from
the row menu on the Members list). Do not promise an ops seat grant: that is Liam's call.
