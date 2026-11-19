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

## Missing permissions when campaigns are selected

`components/settings/team-scope-picker.tsx` (line 27, 53) filters the catalog by `CAMPAIGN_LIMITED_SCOPES`
when the invite is limited to selected campaigns, so account-level scopes such as Payments & billing are
not offered. Working as designed: tell them to pick "All campaigns" for those scopes.

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
