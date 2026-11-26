# SideChat (comment-to-DM): links, limits, account health

Use when: a brand or agency asks how SideChat works (the ManyChat comparison), whether it can get a
creator's Instagram banned, how it is rate limited, or how to give one creator a different link than the
campaign (for example a per-creator App Store link or tracking link).

Facts below were checked on `origin/main` on 2026-11-25. Code moves: if a file or line here no longer
matches, fix this file (step 7 of the skill).

## How it works

- Config lives in Postgres `campaigns.setting_comment_to_dm` (keywords, link, UTMs), not in Firestore
  `programs`. A creator comments a keyword, SideChat sends a private reply through Instagram's official API.
- **One link per creator.** In the campaign, the 3 dots on a creator open "SideChat link"
  (`components/campaigns/comment-dm-creator-link-dialog.tsx`). It saves to table `comment_dm_creator_links`
  (key `contract_id`) through `PUT/DELETE /api/programs/[id]/comment-dm-links`. "Use campaign link" removes it.
- Any public HTTPS link is accepted (`deliveryUrlSchema`, `isPublicHttpsUrl` in
  `packages/workflow-flow/src/link-url.ts`: https only, no credentials, dotted host, no private address),
  max 1500 characters, so an App Store or other tracking link works. The creator link replaces the campaign
  link and the campaign UTMs for that creator (`commentDmLink` in `lib/instagram-comment-dm/config.ts`).
  The message plus link must stay under 1000 bytes.
- The DM does not carry the saved link itself. It carries `https://app.sideshift.app/go/<token>`
  (`lib/api/instagram-comment-dm/tracked-link.ts`), which counts the tap and 302-redirects to the saved link
  (`app/go/[token]/route.ts`). Link-preview bots are not counted as taps. Say this when a brand asks what
  the person sees.

## Account health (ban questions)

- Sends and public replies are paced per account: Instagram 12 a minute, reads 30 a minute, 2 a second per app
  (`lib/api/instagram-comment-dm/budget.data.ts`). After a Meta throttle the account and app are held ten
  minutes (`holdCommentDmAccount`).
- Meta refusals are mapped in `classifyMetaError` (`ports.ts`): restricted (code 368, or 10/1893063,
  613/2018338), throttle, recipient, window, access, `ineligible` (100/2534025), `answered` (sub 2534023).
- The honest answer to "can it get banned": heavy automation can; control is on the brand side (keywords,
  not answering every comment). Do not promise more.

## Checks

1. Failures for a creator: `instagram_comment_dm_deliveries` by `creator_id` (readonly grant: status,
   error_code, trigger, created_at). The creator id comes from `creator_social_oauth_accounts.grant_id` ->
   `creator_social_oauth_grants`.
2. Keywords and link: `select setting_comment_to_dm from campaigns where id = '<campaign>'`.
3. Per-creator link set: `select contract_id, url, updated_at from comment_dm_creator_links where campaign_id = '<campaign>'`.
4. Consents and `comment_dm_events` cannot be read with the readonly role.

## Reply

Short and concrete: where to click (3 dots on the creator, "SideChat link") and what the DM shows (a
sideshift tracking link that redirects). Never call a creator safe from bans.
