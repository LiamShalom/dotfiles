# Contract redlining (creator ↔ brand contract negotiation)

Use when: a teammate or brand reports a problem in the contract negotiation flow: the creator's
"Propose changes" editor (`/contracts/<id>/propose`), the brand's "Review changes" side, a creator
who cannot sign after the brand answered, "Send to <brand>" with nothing to send, or the invite
page buttons "Review their changes / Share contract / Decline invite".

## Where things live (checked 2026-11-25, #12236)

- Editor page: `app/(creator)/contracts/[contractId]/propose/page.tsx` hosts `NegotiationWorkspace`
  (`components/agreements/negotiation-workspace.tsx`); the creator side is `CreatorComposer`.
  Back goes to `/campaign-invite/<id>`, or to `/contracts/<id>/agreement` with `?from=agreement`
  (a staged new agreement on a live contract).
- The brand's answer message links to `/campaign-invite/<id>?updateReview=1&answered=1`, which forwards
  to the editor (`answerReviewPath` in `lib/api/agreements/answer.usecase.ts`).
- Since #12236 the composer footer shows **Sign contract** once the brand answered and nothing is left to
  send (every change accepted, no own edits/terms/comments). It goes to `/campaign-invite/<id>?sign=1`
  (panel `initialAction: 'sign'` opens `acceptProgramInvite` once the agreement read says signing is next)
  or the agreement page for `?from=agreement`.
- An invite created by an open listing (`contractsv2.openApplicationJobId` set) never shows the invite
  page: it forwards to `/explore?tab=my&sign=<id>` (Sign & apply). Check that field before you test.

## Data

- State: Postgres `agreement_states` (`state`: null = never negotiated, `awaiting_sender` = waiting on the
  brand, `awaiting_recipient` = creator's turn, `signed`), versions in `agreement_versions`.
- Drive a test negotiation over the API with Firebase ID tokens (test creator + Dev Testing Liam via
  `.codex/with-test-secrets`): `GET /api/agreements/<id>`, creator `POST .../proposals
  {baseVersionId, terms:{perPostRate}}`, brand `POST .../proposals/<versionId>/answer {action:'send', terms}`.
  Test contract used: `bqj4dQfp7oD2TOrTQcFH` (open-listing, Dev Testing Liam × test creator).
