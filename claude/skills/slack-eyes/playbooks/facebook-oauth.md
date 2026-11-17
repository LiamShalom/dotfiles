# Facebook connect (creator OAuth)

Use when: a creator or brand reports a Facebook connect error, a Facebook insights or audience request,
"personal profiles cannot be connected", "Meta sent us a different Page", a contract held on a Facebook
account, or a brand asks to let a creator skip Facebook. The error is often only in the screenshot, so
read the files before you decide this playbook does not fit.

Facts below were checked on `origin/main` and the read replica on 2026-11-17. Code moves: if a file or
line here no longer matches, fix this file (step 7 of the skill).

## The rule for this topic: prove, then reply once

On 2026-11-17 every Facebook run posted a guess first, and then the customer got one to three
"small correction" replies (eva, sasha, jeweliana, hive scales). The checks below take five queries or
fewer. Run the ones for the error, then post one reply. Never say what kind of account someone has
(Page or personal profile) unless they said so or the data shows it: a Facebook ID alone does not tell.

## How the flow works

- **Only a Facebook Page connects.** The signed-in Facebook user must have the `CREATE_CONTENT` and
  `ANALYZE` tasks on the Page (`canPostAs` in `lib/api/creator-social-oauth/providers/facebook.entry.ts`).
  A personal profile never connects, Professional Mode included.
- The sign-in opens a private browser session, so Facebook asks the creator to log in again. They can
  log in to a different Facebook account than the one that manages the Page.
- The Facebook screen uses Business Login with asset re-selection: the creator must tick the Page.
- **A brand's insights request** ("Request connection") writes a `creator_connection_requests` row. Its
  `handle` is the public ID of the Page the brand asked for. The request link accepts only that Page.
- **Two Facebook ID namespaces.** `contract_social_profiles.handle` / `facebook_id` hold the public ID
  (what scrapers and links use). `oauth_provider_subject_id` holds the Graph Page ID. They differ.
- **Tracking does not need OAuth.** Reels of a public profile or Page are scraped publicly. The
  contract `cTKIgr0UPjx4jHZmIzTT` had 68 Facebook posts (534K views) with no Facebook grant at all, and
  they appear in the brand's posts search (`lib/analytics/pg/posts-search-query.ts`). A Page connection
  adds Reel insights (audience data) and handle proof; it is not needed for posts to count.
- A campaign can require Facebook OAuth (`settings.handleOAuthPlatforms` on the campaign). Then the
  contract is held on `activation_blocked_by='accounts'` until it connects. Since #10610 the brand can
  Customize that creator's contract and remove the platform (`lib/api/contracts/held-release.ts`).
  Check which platform is missing in the data before you name it (hive scales guessed Facebook).

## Error text → what it means → how to prove it

| What they see | Reason code | Meaning |
| --- | --- | --- |
| "Facebook did not share a Page. Connect again and tick your Page…" | `facebook_page_required` | The sign-in worked, but Meta returned no Page this user can post as: no Page on that account, Page not ticked, or not full access on the Page. |
| "Choose the Facebook Page requested in your connection link. Meta sent us a different Page." | `requested_account_mismatch` | Meta returned at least one postable Page, but none is the one the brand's request names. |
| "Personal profiles cannot be connected" on the request page | none | Fixed help text on the request page (`components/creator-social-oauth/audience-connect-page.tsx`, `provider-copy.ts`), not an error. |
| "Facebook hides this Page from people who are not logged in, so we can't track it…" | `facebook_page_hidden` | The Page has an age or country limit. Retrying does not help; the creator removes the limit. |
| "Reconnect Facebook and allow access to your Pages." | `required_permissions_missing` (error code `insufficient_scope`) | The creator turned off a Page permission on the Facebook screen. |
| "Facebook could not be connected. Please try again." (signed in) or "The account could not be connected. Please try again." (request link) | look in the logs | The generic text. Behind it is often `page_handle_resolution_unavailable` (the public-ID lookup missed, about 1 call in 5: transient, try again) or `app_id_mismatch` (config or code defect: engineering). Find which in the log line's `reason`, `details` or `error` (check 5). |

### Checks (read replica: `mcp__cloud-sql-postgres-read-replica__execute_sql`)

Load the read-replica tool first with ToolSearch `select:mcp__cloud-sql-postgres-read-replica__execute_sql`.
Two runs on 11-17 found that the internal-dashboard `postgres_query` refused the OAuth tables. If
ToolSearch finds no read-replica tool (it happens in headless runs), search again once with
`cloud-sql-postgres-read-replica`; if it is still missing, use the dashboard `postgres_query` for the
other tables (`contract_social_profiles`, `handle_requests`, `creator_connection_requests`), the
Firestore MCP for `contractsv2`, and say in `unproven_claims` which OAuth-table check you could not run.
Never fill the gap with a guess in the reply.

1. The creator: `find_account` (internal-dashboard) with their email gives the creator id.
2. Their Facebook grants and connections:
   ```sql
   select provider, oauth_product, status, reauthentication_reason, created_at, updated_at
   from creator_social_oauth_grants where creator_id = '<creator id>';
   select provider, username, display_name, status, provider_subject_id, last_verified_at
   from creator_social_oauth_connections where creator_id = '<creator id>';
   ```
   No `facebook` row means Facebook was never connected.
3. What the brand asked for:
   ```sql
   select platform, handle, company_id, requested_at, channel
   from creator_connection_requests where creator_id = '<creator id>' order by requested_at desc;
   ```
4. What the contracts track. The creator on a contract is `contracts.contractor_id` (set on every
   contract). `contracts.creator_id` is empty on almost all of them: do not use it. A ghost contract
   (a handle the brand tracks before the creator joins) has `contractor_id = 'ghost-<contract id>'`.
   ```sql
   select p.contract_id, p.platform, p.handle, p.facebook_id, p.connection_status,
          p.oauth_grant_id is not null as has_grant, p.oauth_verified_username, p.retired_at
   from contract_social_profiles p join contracts c on c.id = p.contract_id
   where p.platform ilike 'facebook%' and c.contractor_id = '<creator id>';
   ```
   For `requested_account_mismatch`, compare the request's `handle` with these handles and with the
   `username` of any `facebook` row in `creator_social_oauth_connections`. (`social_accounts` holds
   TikTok only: it has no Facebook rows.)
5. The attempt in the logs: `logs_search_webapp` (internal-dashboard) with the reason code as `text`
   (for example `facebook_page_required`), a window of 10 minutes or less around the time of the
   screenshot. Wider windows time out. A signed-in connect finishes under
   `/api/internal/creator/social-oauth/` (`connect/complete`, `client-report`); a brand's request link
   finishes at `POST /api/public/audience-connect`. Each line is
   `[creator-social-oauth] {json}` with `event`, `stage`, `reason`, `creatorId` and an `attemptId`
   that ties the start, callback and completion of one try together. A `facebook_page_required` with
   a successful `oauth_token_exchange` proves the sign-in worked and Meta sent no postable Page.
   Pass `since`/`until` (not `from`/`to`, which are ignored and give the last 15 minutes). Each hit shows only
   one line per request, so the refusal reason is hidden: search the `attemptId` to get the try's steps, then
   search the reason code as `text` in a 10-minute window; a hit on the same request proves it. An `oauth_start`
   with no `oauth_callback` for its `attemptId` means the creator never got past Meta's own login.
   Instagram links work the same way: `instagram.entry.ts` refuses any signed-in username other than the
   link's `handle` with `requested_account_mismatch`, and the page then asks for a new sign-in (it looks
   like a loop). Gloria (2026-11-17) was signed in to a different Instagram account than the link's.
   Read a screen recording with ffmpeg: frames at `fps=1/2`, tiled `5x2` into one image.
   **A screenshot can be hours old.** Its time may be a reshared one (a screenshot of a screenshot shows
   an inner clock). When a 10-minute window around the Slack post finds nothing, search the requested
   handle as `text` in the inner clock's hour in each US time zone. In chitara: facebook page mismatch,
   the try was 21:11Z the day before (inner clock "1:11" Pacific). A refused try leaves no
   `creator_social_oauth_grants` row, but Facebook still lists SideShift as connected in the creator's
   settings: that is what "it says connected on Facebook" means.

### What to reply

- `facebook_page_required`, and they have a Page: sign in with the Facebook account that manages the
  Page, tick the Page on the Facebook screen, and make sure that account has full control of the Page.
- `facebook_page_required`, and they say they only have a regular account: it has to be a Page. They
  can make a free one from that account, post the reels from it, and the brand requests that Page.
  Their other connected accounts stay as they are.
- The request is for a personal profile: nothing to connect. Their reels on that profile are still
  tracked publicly and count; the brand only misses Reel insights. Check the posts query (step 4 and
  the posts search) before you say they count.
- `requested_account_mismatch`: do not ask first. Search the logs for the creator id at the screenshot
  time: the `oauth_callback` line's `details.returnTo` names the requested `handle` and `contractId`.
  If that Page is in the contract's `socialProfiles` (the creator added it), the request is right and
  the creator manages several Pages: tell them to tick that Page under "Edit access" on the Facebook
  screen, signed in to the account that manages it. Ask for their Page only when the requested ID is
  on none of their contracts. (courtney: facebook page mismatch, 2026-11-17: asking first cost a second reply.) The 403 on
  `POST /api/public/audience-connect` does not log which Page Meta returned.
- A brand asks to skip Facebook for one creator: Customize on the held contract and remove the platform
  that is missing (prove which one from step 4 first).
