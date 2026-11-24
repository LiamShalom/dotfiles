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
  A brand can still put the Graph Page ID in a request (it is the "Page ID" a Page shows). Crawlzo
  `facebook-profile` on it returns a different `profile_id`: that is the sign. Before #10710
  (merged 2026-11-17) such a link refused the right Page with `requested_account_mismatch`; it
  now matches on the Graph ID too. A refused try's `account_discovery` line (same request id,
  2-second window) shows `postablePageCount`; the 403 never names the Page Meta sent.
- Meta's "Continue as <name>? continue with your previous settings" resends the Pages ticked last
  time. A creator who must share another Page taps Edit settings, not Continue.
- After the Pages step Meta shows a Businesses step (business portfolios, not Pages) and an Instagram
  step. Creators stop there thinking their Page is missing. Neither choice changes the Page match:
  tell them to pick any one and keep tapping Continue until it returns to SideShift. An oauth_start
  with no oauth_callback means they stopped inside Meta's screens (melaxin, 2026-11-18).
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
| iOS "Add a Facebook account" step spins, then shows Connect again, no error | `facebook_account_selection_required` | Meta shared 2+ Pages and the server asked the app to pick one. iOS 2.30 (651) and older draw the Page list only once a Page is selected, so the step loops (tapcook: facebook connect spins, mobile PR #394). Proof: `creator_social_oauth_states` rows consumed (Meta returned), grant `updated_at` moves on every try, and the reason code as `text` in a 1-minute window on `connect/complete` hits her request. Ticking only one Page on Meta's screen marks the grant's other Pages `unavailable` (data.ts persist), so do not suggest it when other contracts use those Pages. |
| "Facebook could not be connected. Please try again." (signed in) or "The account could not be connected. Please try again." (request link) | look in the logs | The generic text. Behind it is often `page_handle_resolution_unavailable` (the public-ID lookup missed, about 1 call in 5: transient, try again) or `app_id_mismatch` (config or code defect: engineering). Find which in the log line's `reason`, `details` or `error` (check 5). |

### Checks (read replica: `mcp__cloud-sql-postgres-read-replica__execute_sql`)

Load the read-replica tool first with ToolSearch `select:mcp__cloud-sql-postgres-read-replica__execute_sql`.
When it is missing, POST JSON-RPC to the shared bridge `http://127.0.0.1:47801/mcp` (initialize, then
`tools/call` `execute_sql`) with `Authorization: Bearer <~/.config/mcp-shared/token>`; it answered in
seconds on 2026-11-18 when spawning `mcp-shared-cloudsql.sh` over stdio hung. A creator's name is not in
`find_account`: query Firestore `users` where `name ==` the full name.
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
   **Instagram "Invalid Request … Invalid scope: …"** on `instagram.com/oauth/authorize/third_party/error`
   (2026-11-19, plutus): not our request. `creator_social_oauth_states.signed_state` (base64 JSON) shows what
   the start sent; a plain connect asks for basic, manage_insights, manage_comments, manage_messages. A
   personal test account gets "Change to professional profile?" (not this error), and after switching it
   reaches SideShift's consent screen with all four. Ask for the full error line: its end names the refused scope.
   **iPhone: "Instagram app opens and errors" instead of the consent screen** (ditch: sidechat instagram
   connect errors, 2026-11-23/24): `oauth_start` rows with no callback (PostHog `creator_social_oauth_*`
   by distinct_id = creator id shows only starts and `oauth_struggling`). Successful returns carry
   `referrerHost` `l.instagram.com`. Not caused by the authorize path (closed #11827, slash did not help);
   the iPhone trigger is unproven and needs a real iPhone with Web Inspector. Proven workaround: the same
   link in a desktop browser lands on Instagram's login for app 2292866167786027 with all four scopes.
   Read a screen recording with ffmpeg: frames at `fps=1/2`, tiled `5x2` into one image.
   **A screenshot can be hours old.** Its time may be a reshared one (a screenshot of a screenshot shows
   an inner clock). When a 10-minute window around the Slack post finds nothing, search the requested
   handle as `text` in the inner clock's hour in each US time zone. In chitara: facebook page mismatch,
   the try was 21:11Z the day before (inner clock "1:11" Pacific). A refused try leaves no
   `creator_social_oauth_grants` row, but Facebook still lists SideShift as connected in the creator's
   settings: that is what "it says connected on Facebook" means.
6. **Page or profile, before any reply:** POST `https://scrape.crawlzo.com/v1/scrapers/facebook-profile`
   (`X-API-Key` = `CRAWLZO_API_KEY` from `.env.local`, read inside a script) with
   `{"username":"<id>","allow_no_reels":true}`. `data.bio.account_type` is `page` or `profile`. A
   `requested_account_mismatch` on a `profile` ID can never pass: Meta returns only Pages. In chitara:
   facebook page mismatch, the "tick that Page" reply was wrong and needed a correction.
   Count its tracked reels with `posts` where `company_id` = the brand and `creator` = the Facebook
   display name (`creator` holds a display name, not an id).
   A 404 with `status.code` `PROFILE_RESTRICTED` means the account exists but Facebook hides it from
   logged-out viewers (usually an age limit): we can neither connect nor scrape it, whatever the type.
7. **"I connected 20 times and it says connected"** (paige: facebook connect loops, 2026-11-17): check
   which Pages her grants actually hold before reading logs (Vercel log search refuses windows older
   than about 3 days with `ExceedsBillingLimitError`):
   ```sql
   select g.created_at, a.username, a.display_name, a.status from creator_social_oauth_grants g
   left join creator_social_oauth_accounts a on a.grant_id = g.id
   where g.creator_id = '<creator id>' and g.provider = 'facebook';
   select provider, created_at, consumed_at from creator_social_oauth_states
   where creator_id = '<creator id>' order by created_at desc limit 30;  -- every connect try, by provider
   ```
   A signed-in connect drops a Page it cannot confirm (a hidden one) and still succeeds on the other
   Pages (`confirmPages` in `facebook.entry.ts`), so the contract's Page stays unconnected with no error.
   If the read-replica MCP tool is not loaded, call it over stdio: spawn `~/.claude/bin/mcp-shared-cloudsql.sh`,
   send `initialize`, then `tools/call` `execute_sql` (kill the process after the reply; it does not exit
   on stdin close).

7. **"Is FB tracking for X?"** Run Crawlzo on the contract's Facebook ID 2-3 times. A repeated
   `PROFILE_RESTRICTED` is the `hidden` case in `lib/facebook/setup-status.ts`: we cannot track it
   until the creator removes the age or country limit (and turns on professional mode for a profile).
   No reconnect is needed for tracking. Some creators run one Page per brand: list every contract's
   Facebook handle (`contract_social_profiles` join `contracts` on `contractor_id`) before you call a
   connected Page "the wrong one". In melaxin: fb tracking for paige d (2026-11-17), the connected
   Page belonged to her Klover contract, and the thread needed two corrections.

8. **Logs older than ~3 days** (Vercel refuses them): PostHog `call execute-sql` on `events` where
   `distinct_id` = creator id and `event like 'creator_social_oauth%'`. `oauth_account_discovery` details
   give `pageCount`; `oauth_permissions` give `pageTargetCount`. Both 0 on every try = the Facebook login
   shares no Page at all, which is what "she has no option to select" means on Meta's screen (plutus:
   creators cant connect fb/insta, 2026-11-23). A grant row with zero `creator_social_oauth_accounts` is
   why Facebook's own screen says "already connected" while nothing is linked.
9. **Adding another Instagram on a live contract:** the campaign's "Add other handles" opens the handle
   modal; the Instagram row pre-fills the creator's connected account and shows a + ("Connect another
   Instagram account", `connect-account.tsx`), which signs Instagram in again (`force_reauth`). A
   creator who only sees "submit that one" has missed the +. An Instagram linked before the campaign
   turned on comment-to-DM fails submit with `missing_comment_dm_scope` (`campaign-requirement.ts`).

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
- `requested_account_mismatch` when the creator ticked the right Page: the request `handle` can be the Page's Graph
  (internal) Page ID, not its public ID. Crawlzo on the handle then returns the same Page name with a different
  `profile_id`. Before #10710 (merged 2026-11-17) the link matched only the public ID or vanity name, so it refused
  the right Page. Since then it also accepts the Graph Page ID (storytale openart: facebook page mismatch).
- The contract tracks a profile and the creator made a new Page: the brand's old request link names the
  profile and refuses the Page, and a brand cannot request a handle that is not on its contract
  (`creator-audience-request.usecase.ts`). The creator adds Facebook on the campaign herself, signed in,
  ticking the Page: a signed-in add on a contract the brand chose is approved with no brand review
  (`createHandleRequest` in `lib/handle-request-utils.ts`, status `added` in `my-gigs/handles.usecase.ts`).
  Facebook is not a per-brand share provider (`BRAND_SHARE_PROVIDERS` in `lib/platforms.ts`), so no new
  brand request is needed. Say "add", not "change": an edit retires the old profile row. (melaxin: fb profile needs a page.)
- **Add the Page for her when the app loops** (dr. melaxin: facebook connect loops, 2026-11-23): when her
  grant already holds the Page (`creator_social_oauth_accounts`) but the contract tracks another Facebook ID,
  a script that calls `submitCreatorHandleRequest({userId}, {action:'add', programId, contractId,
  platform:'facebook', handle:<page id>, oauthAccountId:<that account id>}, headers)`
  (`lib/api/internal-creator/my-gigs/handles.usecase.ts`) runs the app's own add path and system-approves
  it on a contract the brand chose. Run it with the `repair.md` PG flags plus `PG_CONNECT_TIMEOUT_SECONDS=30`
  (the default 8 s connect timed out from the laptop). The process hangs after the write: confirm on
  `handle_requests` (status `approved`) and `contract_social_profiles`, then stop it.
- A brand asks to skip Facebook for one creator: Customize on the held contract and remove the platform
  that is missing (prove which one from step 4 first).
