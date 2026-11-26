# SideChat guard rails (Instagram restrictions, unwanted DMs)

Use when: a creator's Instagram account got restricted ("You can't interact with certain accounts", "We added a
restriction to your account") after SideChat DMs, a commenter replied angrily to a SideChat DM, or a teammate asks
for "guard rails" so SideChat stops messaging people who did not ask.

## Facts (checked 2026-11-25, #12242)

- Already in place: 12 DMs a minute per account (`lib/api/instagram-comment-dm/budget.data.ts`), a 10-minute hold
  after a Meta throttle, SideChat off on an `instagram_restricted` account until re-sign-in (`restriction.ts`),
  opt-out on a refusal reply (`refusals.ts`, `classifyReplyIntent` in `packages/workflow-flow/src/text-match.ts`),
  Meta's own refusal for people who cannot get DMs (code 100/2534025, `ports.ts`).
- Since #12242: an everyday-word keyword (now, buy, link, shop, dm, plurals, `EVERYDAY_WORDS`) starts a DM only
  when the comment is that keyword (`startsSideChat`). Translated keywords follow their source keyword. Clear
  hostility (fuck you, stfu, "don't care" without asking for the link) is a refusal.

## Checks

1. Creator id: `creator_social_oauth_accounts` (username) -> `grant_id` -> `creator_social_oauth_grants.creator_id`.
2. Sends: `instagram_comment_dm_deliveries` by `creator_id` (the readonly role can read status, error_code,
   trigger, template_id, created_at only; consents and comment_dm_events are refused).
3. Campaign keywords: Postgres `campaigns.setting_comment_to_dm` (not Firestore `programs`).

## Shipping a matcher change

- Vitest reads `@sideshiftapp/workflow-flow` from `dist`: run `npm run build --workspace=@sideshiftapp/workflow-flow`
  after each edit, or the tests run old code.
- The 5-minute poller is the `instagram-comment-dm` Cloud Run job: dispatch `deploy-instagram-comment-dm.yml` on
  main after merge and approve its `cloud-run-prod` gate. A pending migration holds the web deploy ("Production
  schema applied"); a REVOKE in it makes `--agent-confirmed` refuse, so it needs Liam's OK.
- Runs exiting 1 on one account's Meta code 10 are old noise (about 3 of 60 runs), not a deploy failure.
