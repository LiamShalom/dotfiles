# Talent manager accounts and managed creators

Use when: a teammate asks to "create a talent manager account" for an email, asks how a manager gets a
creator on a campaign (contract, invite link), or a brand reports that a managed creator's contract shows
a Join request but no accounts to approve.

Facts checked on `origin/main` and the read replica on 2026-11-19. If a file here no longer matches, fix
this file (step 7 of the skill).

## The rule for this topic: say only what a manager session was proven to do

Two runs posted a claim about what a manager can do after switching into a creator without testing it;
the finish check bounced it. Prove a manager action from code or a real session before you promise it.

## How it works

- **A manager is a user with `talentManagerOnly: true`** (read in `lib/api/talent/users.data.ts:108`,
  used as the manager test in `requests.usecase.ts:107` and `switch.usecase.ts:95`). A manager account
  cannot itself be a creator on a contract (`representations.usecase.ts:275` refuses it as the creator).
- **An email that already has a creator login cannot self-serve this.** Staff convert the user in place
  (sign-up as a manager only sets the flags on a first onboarding, `onboarding.usecase.ts` `becomesManager`).
  Proven recipe (2026-11-23, request: talent manager account): first check `contracts` where
  `contractor_id = <uid>` are all cancelled/ended and the doc is `type: 'Student'`. Then from a fresh
  worktree (`sideshift-setup`), a throwaway script calls
  `authAccountData.updateUser(uid, { talentManagerOnly: true, excludeFromRecruit: true, creatorKind: 'manager' })`
  (`lib/api/auth/account/data.ts`; plus `hasUGCExperience: USERS_REMOVE_FIELD` if set), run with
  `PG_ALLOW_PRODUCTION=1 NODE_OPTIONS=--conditions=react-server npx tsx`. The PG mirror logs
  "unmapped field talentManagerOnly": harmless, talent code reads it from Firestore (`users.data.ts` FIELDS).
  No email is sent; the person signs in with their existing login.
  Once monorepo #11803 and dashboard #325 merge, staff do this themselves in the internal dashboard tab
  "Talent Managers" (Admin Growth): it lists every manager with its creators and has "Make talent manager".
  Every manager login carries `creatorKind: 'manager'` (the 51 older ones were backfilled on 2026-11-23);
  the list reads `creators.creator_kind`, so a hand conversion must set it too.
  An active creator contract on the login does not block it when the teammate asked for this email
  (gill job 2026-11-23): the creator layout still draws for a manager login
  (`__tests__/app/creator-layout-manager-only-login.test.tsx`) and nothing reads the flag on existing
  contracts. Put the script under the worktree's `scripts/` (a file in job tmp cannot resolve `dotenv`). A brand login (Employer/Member) needs
  the longer reset in memory `talent-at-sideshift-is-a-manager`.
- **The contract belongs to one of the manager's creators**, never the manager. The manager opens the
  campaign invite link signed in, picks or adds the creator it is for, and signs.
- **A managed creator can have no email.** `find_account` by that creator's name returned nothing; find
  the creator id from the campaign's contracts (`contracts.contractor_id`), then `find_account` by id.
- **Sign first, accounts after** applies here too: see `campaign-joining.md`. A manager signs through
  the invite link, so since #10964 (live 2026-11-19 ~15:00Z) the join is decided on Applicants → job
  picker "Via invite link", not Requests (`isPendingInviteLinkApplication`,
  `lib/api/applications/handle-requests-applicants.ts`). The contract stays `pending` with no accounts
  and a brand cannot write handles on it. Since #10964, handles a creator adds after the brand
  accepted are approved at once; a handle another creator holds, or any after a rejected one, still
  goes to the brand.
- **A manager can add the creator's accounts.** Switched into the creator, the session is the creator's
  login with talent claims (`request-credential.ts:101-130`). `talentRouteClass`
  (`lib/api/talent/talent-route-policy.ts:519-523`) refuses only routes classed `never` or `payouts`;
  everything else is `open`, including handle submit and `internal/creator/social-oauth/connect/*`
  (lines 248, 262-274). Not tested in a live manager session.

- **Find a manager's creators on a campaign:** since #11926 (11-24) the Creators tab search matches the
  "represented by" label under the creator's name (manager name, or agency name for an agency-run
  creator). A manager's email is never sent to brands (`representedByOf` fallback `brand`), so email
  search is not offered. The replica role and dashboard `postgres_query` cannot read
  `talent_representations`; the read-replica MCP could (11-24).
- **"Can't send the second invite" for a manager's next creator:** first list the campaign's pending
  contracts with `contractor_name`; spacexsi 11-24: the second creator's contract already existed (made
  ~90 min after the first), held on accounts too.

## Symptom → cause → proof

| What they report | Cause | Proof |
| --- | --- | --- |
| Brand signed-contract creator shows Join row, "no accounts" | Join request only; accounts come after Accept | Check 1: `pending`, 0 profiles, requests `JOIN:pending` |
| Brand cannot find the managed creator | No email on the user | `find_account` by the contractor id |

### Checks (read replica)

1. The managed creator's contract (find the campaign's newest contracts, then the one for the creator):
   ```sql
   select c.id, c.status, c.activation_blocked_by,
          (select count(*) from contract_social_profiles p where p.contract_id = c.id) as profiles,
          (select string_agg(coalesce(h.platform,'JOIN')||':'||h.status, ',')
             from handle_requests h where h.contract_id = c.id) as requests
   from contracts c where c.id = '<contract id>';
   ```

## What to reply

- **Join row, no accounts / "he is not in Requests":** accept him on Applicants → "Via invite link";
  accounts come from the creator's side and go through on their own after the accept. The creator
  row's "Review request" opened Requests until #11121.
  Do not say what the manager does inside the creator session until it is tested.
- **Manager account request:** convert the user in place, then tell the teammate the person signs in as
  usual and the contract goes through the campaign invite link.
