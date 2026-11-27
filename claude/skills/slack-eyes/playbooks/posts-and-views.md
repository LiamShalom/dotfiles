# Posts and views

Use when: a creator or brand says posts are missing, not counted, "not updating", double counted, or paid
while deleted; a post count or view total does not match another screen (day panel, country map, profile,
leaderboard, API, shared link); a ghost handle still shows on the leaderboard; or the Posts tab filter
misbehaves. The message often names no post: read the screenshot and the thread before you decide.

Facts below were checked on `origin/main` and the read replica on 2026-11-17. Code moves: if a file or
name here no longer matches, fix this file (step 7 of the skill).

## The rule for this topic: find one post, then find where the customer looked

In 11 runs on 11-16 and 11-17, the post was often in the data (alloy, ecom degree, mise twice). The cause was
how it is counted or where the customer looked: a chart-day tab, a hashtag filter, a country map, a share-link
filter. Three runs posted wrong or extra replies first: ecom degree posted four corrections about scrape
freshness before it found the tab; laka asked "what is the issue?", then said "7 is right", then corrected twice.
Get one post (link, handle and day, or the screenshot row), run checks 1 and 2, and only then reply.
Say nothing about scrape freshness until check 4 shows it. Never promise a next step that needs Liam's
decision (openart: the reply promised an API path and had to be edited).

## How it works

- `posts` is one row per (`company_id`, `platform_post_id`). The handle is `posts.creator`. It has no
  contract column. `contract_posts` links a post to a contract (`removed_at`, `removed_reason`). Views per
  contract are in `contract_post_metrics`; handles of a contract in `contract_social_profiles`
  (`retired_at`); chart deltas in `post_daily_stats` (`delta_views`, `effective_date`).
- The creator on a contract is `contracts.contractor_id`. `contracts.creator_id` is set on 921 of 754,529
  contracts from the last 60 days: never use it. A ghost-handle contract has `is_ghost_handle` and, nearly
  always, `contractor_id = 'ghost-' || id`.
- **Every active contract with a handle collects that handle's posts**, even a second contract of the same
  creator at the same company (`blockPostWrite`, `services/scrape-contracts/src/pipeline/process-contract.ts`).
  So a creator on an old and a new campaign is counted on both. This is by design. Ending the old contract
  with "Keep posts for payouts" sets `pause_new_posts`, which stops it.
- **Filters** (`applyPostFilters`, same file): reposts are dropped; required hashtags, keywords and the
  campaign date window apply. A link submission skips all three. **Warmups**: the first N posts per platform
  after a creator joins are skipped (`campaigns.payment_structure->>'warmupPosts'`, or the contract's own;
  `packages/campaign-eligibility/src/warmup.ts`). The scraper logs "Skipped N warmup posts".
- **Deleted**: the scraper marks a post deleted after 2 not-found checks that are at least 24 hours apart
  (`DELETION_CONFIRM_THRESHOLD` in `packages/campaign-eligibility/src/posts.ts`; `nextNotFoundCount` in `services/scrape-contracts/src/pipeline/process-contract.ts`). Payouts
  skip a deleted post only if the campaign has "Drop deleted posts from payouts" on
  (`campaigns.setting_auto_exclude_deleted_posts`, default off; `lib/payouts/pure-cycle-generator.ts`).
- **Cadence** (`lib/scrape-schedule.json`): full runs at 05:00, 13:00, 21:00 UTC; discovery of new posts at
  01:00, 10:00, 17:00 UTC. A post that went up after a company's last sync shows at the next run.
  Runbook: `docs/runbooks/scrape-cadence.md`.
- More traps: `.claude/skills/investigate-slack-issue/references/evidence.md` ("Known traps and fingerprints").

## Symptom → cause → proof

| What they say | Cause (proved in a past run) | Proof |
| --- | --- | --- |
| Instagram trial reels tracked although "Track Instagram trial reels" is off (ugc study program: trial reels still tracked, 11-19) | Before #11128 the setting only skipped the extra `instagram-trial-reels` scan; the regular reels-tab listing (`instagram-profile`) returns trial reels with no marker. Since #11128 (merged 11-19) the scraper checks each new IG reel against the profile grid (`instagram-user-posts-v4`) and does not save one the grid leaves out; already tracked ones stay | `campaigns.setting_track_trial_reels`; Firestore `contractsv2/<id>.excludedPosts` = the posts the brand excluded; those ids are absent from the creator's grid (POST `instagram-user-posts-v4` `{handle}`, ids `<id>_<owner>` or `POLARIS_<id>`). Crawlzo's trial scan returned `profile_grid_pages: 0` on 11-19, so it proves nothing |
| A post is missing from a campaign (laka: marlen ig post count) | The post is on the platform but the contract has no link row: the caption lacked the campaign hashtag (it carried another brand's), or a warmup, repost or date window | Check 2: `not_on_contract` > 0 for that post. Fix: row menu "Add posts" on the campaign page (`add-creator-posts-dialog.tsx`); a link skips the filters. Check the live profile before you say a count is right |
| "TikTok posts not showing", no post named (alloy market) | The creator posted after the company's last sync; the brand's in-app Sidekick also gave a wrong platform split | Check 4 (newest `last_synced_at`); `sideshift_ai_tool_invocations` (`tool_name`, `result_summary`) for what Sidekick's tools returned. A contract with `live_handles = 0` has nothing to scan |
| Posts "not updating today" (rachel) | A scrape run started late; the company's posts had older `last_synced_at` than other companies | Check 4. `gcloud run jobs executions list` and a `gcloud logging read` both timed out in 2 runs: do not use them |
| Double counted (hive scales: crystal) | One creator, two live contracts at the company (an old campaign kept) | Check 3: `also_on_another_contract` > 0. Reply: not a bug; remove her from the old campaign with "Keep posts for payouts"; do not pay the duplicate row |
| Ghost handle still on leaderboard (ecom degree) | The leaderboard counts link rows with `removed_at IS NULL` and does not filter by contract status (`lib/analytics/pg/top-creators-query.ts`, line 310). A ghost cancelled through the generic cancel route kept its links | Check 5: cancelled ghost with `live_links` > 0. The ghost delete route `app/api/programs/ghost-handles/delete/route.ts` wipes the posts. Fix for cancel: PR #10622, open on 2026-11-17; check its state |
| A post is not in the chart day panel (ecom degree: mike post missing) | Gained views listed only posts that were not uploaded that day; the post was on the Published tab. PR #10645 (merged 2026-11-17) now lists same-day posts under Gained views | Day mode: `hooks/analytics/useDayPosts.ts` (`activity` = earned views, `published` = uploaded that day), `lib/analytics/pg/day-posts-query.ts` (takes `reportTimezone`). Compare `posts.uploaded_at` with the clicked day |
| Country views differ from profile views (mise) | The map splits all views of posts uploaded in the range by the handle's audience profile; the profile Views card is views gained in the range, old posts included | Check 6. Code: `lib/analytics/pg/audience-by-country-query.ts` (header), `analytics-metrics-query.ts` |
| Paid post shows "not counted", no reason (mise: posts show not counted) | A late post paid alone wrote `cycle-fill` placeholders mid-history. Fixed by PR #10547, merged 2026-11-16 | Check 7. Reason codes: `lib/creator/creator-cycle-posts.ts` (`not_counted_unknown` = no reason on record) |
| Deleted videos still paid (la viral studio) | The campaign setting is off, or the post is not yet flagged (needs 2 checks, 24 hours apart) | Check 8. Reply with the setting's place: campaign settings step, "Drop deleted posts from payouts" |
| API misses agency views (openart) | An API key sees its own company. `?scope=agency` works only for a parent agency key, else 403 (`lib/api/agency-scope.ts`). The missing views were in another agency's account | Compare `post_daily_stats` by `company_id` / `agency_id` |
| "Stopped tracking her Instagram", handle still connected (olive: instagram stopped tracking) | The handle has scrape error `PROFILE_AGE_RESTRICTED` (contractsv2 `socialProfiles[].scrapeErrorCode`), so its reels come only from owner captures in `creator_video_insight_snapshots` (`addOauthReels`). The `instagram-insights` job crashed (signal 11) 11-13 to 11-16; #10512 fixed it, full capture again 11-17 ~19:00Z. New reels land at the next scrape after the capture | Captures per day for the creator's `oauth_account_id` (gap = the cause) and globally (`count(distinct oauth_account_id)` by `capture_date`, platform). Match snapshots to posts by `post_page ilike '%/'||shortcode||'/%'`: `posts.platform_post_id` is not `provider_video_id` or `shortcode` |
| "Views are still not there" plus a screenshot of the creator's own Instagram grid (melaxin: instagram views missing) | She meant her reels get low views on Instagram itself (149-260 each in the screenshot). It was not a tracking problem; Matt clarified this in the thread. Her reels were also not stored because their captions had no campaign hashtag | Read the numbers in the screenshot first. If it shows the platform's own app, ask "low views on instagram, or missing on sideshift?" before you run checks. Account and warmup advice belongs to the campaign team, so do not promise it for them |
| X posts stay at 0, handles connected (mosaic: x posts not in analytics, 11-21) | Crawlzo `twitter-profile-v4` returns `main: []` for the handles (with and without `include_replies`) while `profile_demographics.statuses_count` is 7-49; an older account (ShadooowOnX) returns posts. New low-follower X accounts of other brands (herWorldOS) are tracked only through link submissions, which work for replies too. Turning on `include_replies` in code would not help | POST `https://scrape.crawlzo.com/v1/scrapers/twitter-profile-v4` `{username, include_replies}` with `X-API-Key` from `.env.local`; `posts where platform='twitter'` (X is `twitter`, not `x`) split by `is_link_submission`. Reply: campaign setting "Accept links to published posts" or row menu "Add posts" |
| Opening an uploaded video (paid-ads payout → Uploads → post) shows an XML `AccessDenied` page (sideshift: payout upload open post, 11-21) | An upload post (`platform: 'upload'`, id `vs_<submission>_v<n>`) keeps the private storage URL in `url`, and the post modal's poster linked it. Fixed by PR #11589: uploads play the signed `uploadedVideoUrl` from `/api/contracts/metrics` and never link `url` | The Loom frame shows `storage.googleapis.com/.../video-submissions/...`. On a preview, `/api/contracts/metrics` posts with `vs_` ids carry a signed `uploadedVideoUrl` (206 video/mp4) and their `url` returns 403. Test-brand paid-ads contracts with uploads: `0RZjU5vneaU8wAfO0fVK`, `zYzmFoAujBZ5FKzdRhp7` (their uploads are in closed cycles, so open the modal through the modal store, not a payout row) |
| Creators "report issues with tracking"; creator app shows "Cycle 1 · Ends today", Behind, N posts left, $0, while posts are tracked (baton: creator tracking issues, 11-23) | The campaign has "Require manual approval for payout" on (`campaigns.setting_require_manual_approval_for_payout`, Firestore `settings.requireManualApprovalForPayout`) and no post is `approved`. `filterPostsByApprovalGate` (`lib/payouts/pure-cycle-generator.ts`) drops every post, so a first-post campaign stays `waitingForPost` and the card falls back to period start = end = now, 0 delivered (`lib/creator/creator-campaign-money.ts` default `cycleResult`) | `count(*) filter (where p.approval_status='approved')` per campaign on `contract_posts` join `posts`. Brand fix: Campaigns → Submissions → "Payout approval" → "Approve for payout" (bulk via the select-all box), or turn the setting off. Reproduce the creator card with `getCreatorCampaignDetail` run locally (`PG_ALLOW_PRODUCTION=1 node --conditions=react-server --env-file=.env.local --import tsx`, stub `ports.updateCreatorLastActive`): `cycle.status: "waiting"` |
| Instagram photo or carousel shows 0 views, Instagram shows thousands (elevenlabs: cpp photo post 0 views, 11-24) | Photos have no public view count (`posts.content_type='photo'`; Crawlzo `instagram-post-v4` has `video_view_count: null`; `packages/crawlzo/src/metrics.ts`). Their views come only from owner insights, which the `instagram-insights` job reads only for an OAuth account bound to a live contract profile (`services/instagram-insights/src/campaign-eligibility.ts` `profileBindsAccount`), and the scraper copies them only onto a profile with OAuth proof (`ownerRefreshScopeWhere`, `boundOauthAccounts`). The creator had connected Instagram from the account page, but nothing was on the contract (0 `contract_social_profiles` rows; only the join `handle_requests` row) | `creator_social_oauth_accounts` by username (status available, grant connected with `instagram_business_manage_insights`); 0 `creator_video_insight_snapshots` for that `oauth_account_id`. Repair: `submitCreatorHandleRequest` (`lib/api/internal-creator/my-gigs/handles.usecase.ts`) with `{action:'add', programId, contractId, platform, handle, oauthAccountId}` as the creator; on a campaign with `brandReviewsProvenAccounts` it lands `pending` (and notifies the brand), then `approveHandleRequestCore` with the request. The first light run (hourly at :05) after that loads the account. Run scripts with plain `node --conditions=react-server --env-file=.env.local --import tsx` in a current worktree; `heavy` queued 17-24 deep and the Studio was unreachable |
| Creator "can't pin" old viral videos and the brand's campaign card shows only newer posts (olive: creator viral posts missing, 11-25) | The brand moved her contract (`/api/programs/move-creator`, forced) into a campaign whose `startsAt` is later than her posts. A forced move accepts that posts outside the target window are removed (`lib/campaigns/move-creator-validation.ts` `removablePostCount`), and the scraper's `cleanupPostsOutsideDateWindow` (`services/scrape-contracts/src/pipeline/process-contract.ts`) stamps them `removed_reason='repo_delete'`, `removed_by='scraper'` hours later. Pins and campaign results read only `contract_posts.removed_at IS NULL` (`lib/analytics/pg/creator-my-gigs-query.ts`). A data restore does not hold: the next deep scrape removes them again | contractsv2 doc: `migratedFrom` (`programId`, `initiatedBy`), `payoutStartsAt`; `programs/<new>.startsAt`; `contract_posts` grouped by `removed_at` minute for the contract. Her own featured videos (`users/<uid>/topPosts`) can still be pinned: the pin API takes portfolio posts. Public read of what her profile shows: `curl https://app.sideshift.app/api/public/portfolio/<uid>` (`campaignResults`, `experiences`, `topPosts`) |
| Paid views far below the TikTok dashboard, organic too high, often on new boosts (mise: paid views stale, 11-24 and 11-26) | The ads-sync job (Cloud Run, every 30 min) fell behind. It read every enabled TikTok ad on each visit (most stopped spending) and read a brand's ads one at a time, so a big brand's new ads were read once at import and then about once a day. Fixed by #12276 (merged 11-26): ads idle for more than 3 days are read every 12 hours, and a brand's ads are read in parallel | `ad_launches.latest_spend_snapshot_at` for the creator's ads (stale = cause), `ad_launch_daily_stats` per post. `gcloud logging read 'resource.labels.job_name="ads-sync" AND jsonPayload.msg="ads-sync complete"'`: `deadlineSkipped` and errors "<company>: deferred N TikTok campaign(s)". One-off repair: call `syncAdCampaignSpend` per stale ad from a script, then `scripts/ads/reconcile-paid-views.ts --company <id>` (dry run first). Double-pay check: `payout_line_items` with `component<>'fixed'` on the boosted `platform_post_id`s |
| Post Tags filter on a share link lists only a few products (melaxin: post tags filter missing options, 11-27) | The share doc has no `showProductCheckTags: true` (fail-closed, `lib/share-auth.ts`), so the link offers only manual `posts.analytics_tags`; the AI product tags ("<Product> · Used/Shown/Mentioned", `post_product_checks`) are hidden. Melaxin has about 15 links; only `5NbZvz7E5ybfsXgzHHL1` had it on | Find the link: `logs_search_webapp` route `/api/share-analytics/context`, text = a companyId, a few minutes before the message; its `companies` list matches one `shares` doc (`companyIDs`). Read it with the sideshift-firestore MCP (the dashboard tool refuses `shares`). Fix: set `showProductCheckTags: true` on that doc (dashboard Share Links → AI product tags, or a one-field firebase-admin update), then `curl /api/share-analytics/context?shareID=<id>` and read `postTagOptions` |
| Posts tab filter drops campaigns on a share link (brand501) | Already fixed by PR #10629 | `gh pr list` and `git log` on `app/(public)/(share)/share_posts/page.tsx` before you fix anything; test on the live share link |

### Checks (read replica: `mcp__cloud-sql-postgres-read-replica__execute_sql`)

Load the tool with ToolSearch `select:mcp__cloud-sql-postgres-read-replica__execute_sql`. In headless runs
(hive scales, olive) it was not found. The shared bridge still answers: POST JSON-RPC (`initialize`, then
`tools/call` `execute_sql`) to `http://127.0.0.1:47801/mcp` with `Authorization: Bearer` + the first line of
`~/.config/mcp-shared/token`, and the `Mcp-Session-Id` header from the initialize reply. It reads OAuth and
insight tables that the dashboard refuses. Spawning `mcp-shared-cloudsql.sh` over stdio hung in olive. Then use `postgres_query` (internal-dashboard); it refuses `information_schema` ("System
catalogs are available only through schema tools"): use `postgres_describe_table`, or `postgres_search_schema`
with a `search` argument. Find the creator with `find_account` (the contract's `contractor_id`).

1. The creator's contracts, live links and live handles:
   ```sql
   select c.id, c.status, c.campaign_id, c.pause_new_posts, c.is_ghost_handle,
     (select count(*) from contract_posts cp where cp.contract_id=c.id and cp.removed_at is null) live_posts,
     (select count(*) from contract_social_profiles p where p.contract_id=c.id and p.retired_at is null) live_handles
   from contracts c where c.contractor_id = '<creator id>' order by c.created_at desc;
   ```
2. Posts of the contract's handles and whether each is on the contract:
   ```sql
   select p.platform, p.platform_post_id, p.uploaded_at, p.views, p.last_synced_at, p.deletion_status,
     p.hidden_from_analytics, p.is_repost, p.is_link_submission, p.hashtags,
     cp.contract_id is not null on_contract, cp.removed_at link_removed, cp.removed_reason
   from posts p left join contract_posts cp on cp.company_id=p.company_id
     and cp.platform_post_id=p.platform_post_id and cp.contract_id='<contract id>'
   where p.company_id=(select company_id from contracts where id='<contract id>')
     and lower(p.creator) in (select lower(handle) from contract_social_profiles where contract_id='<contract id>')
   order by p.uploaded_at desc limit 30;
   ```
   Then campaign rules: `select payment_structure->>'warmupPosts', setting_auto_exclude_deleted_posts, pause_new_posts
   from campaigns where id='<campaign id>'`, and `contracts.payment_structure` for a per-creator warmup.
3. Same post on more than one live contract of the creator:
   ```sql
   select cp.contract_id, ca.name campaign, c.status, c.pause_new_posts, count(*) live_posts,
     count(*) filter (where exists (select 1 from contract_posts o where o.company_id=cp.company_id
       and o.platform_post_id=cp.platform_post_id and o.contract_id<>cp.contract_id and o.removed_at is null)) also_on_another_contract
   from contract_posts cp join contracts c on c.id=cp.contract_id left join campaigns ca on ca.id=c.campaign_id
   where cp.company_id='<company id>' and c.contractor_id='<creator id>' and cp.removed_at is null group by 1,2,3,4;
   ```
4. Freshness of the company's posts, and which runs started:
   ```sql
   select platform, max(last_synced_at) newest_sync, count(*) filter (where last_synced_at > now() - interval '6 hours') synced_6h
   from posts where company_id='<company id>' and deletion_status is null and uploaded_at > now() - interval '14 days' group by 1;
   select execution, allowed, created_at from scrape_run_admissions
   where execution like 'scrape-contracts-ts-%' and created_at > now() - interval '30 hours' order by created_at desc;
   ```
   `allowed = false` means the overlap guard skipped that run (`services/scrape-contracts/src/run/overlap-live.ts`).
5. Ghost contracts of a campaign with live links:
   ```sql
   select c.id, c.handle, c.platform, c.status, count(*) filter (where cp.removed_at is null) live_links
   from contracts c left join contract_posts cp on cp.contract_id=c.id
   where c.campaign_id='<campaign id>' and c.is_ghost_handle group by 1,2,3,4 order by live_links desc;
   ```
6. Views gained in a range, split by post age (the profile Views card), and the handle's audience:
   ```sql
   select pds.platform, sum(pds.delta_views) gained,
     sum(pds.delta_views) filter (where p.uploaded_at >= '<from>') on_new_posts,
     sum(pds.delta_views) filter (where p.uploaded_at <  '<from>') on_old_posts
   from post_daily_stats pds join posts p on p.company_id=pds.company_id and p.platform_post_id=pds.platform_post_id
   where pds.company_id='<company id>' and lower(p.creator) in ('<handle>') and pds.effective_date between '<from>' and '<to>' group by 1;
   select platform, handle, locations_source, locations from creator_audience_profiles where handle in ('<handle>');
   ```
7. Cycle placeholders: `select reason, excluded_at, count(*), min(uploaded_at), max(uploaded_at) from
   contract_excluded_posts where contract_id='<contract id>' group by 1,2 order by 2;` Rows with
   `platform_post_id like 'cycle-fill_%'` are placeholders. Other reasons: `cycle-skip`, `video-exclusion`, `rejected`.
8. Deleted posts and the setting, per active campaign of the company:
   ```sql
   select ca.name, ca.setting_auto_exclude_deleted_posts drop_deleted, count(*) filter (where p.deletion_status='deleted') deleted_posts
   from campaigns ca join contract_posts cp on cp.campaign_id=ca.id and cp.company_id=ca.company_id and cp.removed_at is null
   join posts p on p.company_id=cp.company_id and p.platform_post_id=cp.platform_post_id
   where ca.company_id='<company id>' and ca.status='active' group by 1,2;
   ```
   Posts we never saw: fetch the live profile (`lib/crawlzo.ts`) and compare (laka did).

### What to reply

- One reply. Name the post (day, platform) and the number you see; say where to click or what to change.
- Missing for a filter reason: name the rule (hashtag, warmup, date window) and give the "Add posts" path.
- Not a bug (double count, country map, tab): say what each number counts, and the brand's fix path.
- Ask for a post link only when the message names none and checks 1 and 2 find nothing wrong.
