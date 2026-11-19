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
  (earlier run, repair via the users write path; first apply needs `PG_ALLOW_PRODUCTION=1`; the main
  checkout can be far behind `origin/main`, so use a fresh worktree).
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
