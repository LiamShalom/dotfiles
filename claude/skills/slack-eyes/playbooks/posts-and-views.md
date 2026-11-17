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
| Posts tab filter drops campaigns on a share link (brand501) | Already fixed by PR #10629 | `gh pr list` and `git log` on `app/(public)/(share)/share_posts/page.tsx` before you fix anything; test on the live share link |

### Checks (read replica: `mcp__cloud-sql-postgres-read-replica__execute_sql`)

Load the tool with ToolSearch `select:mcp__cloud-sql-postgres-read-replica__execute_sql`. In one headless run
(hive scales) it was not found. Then use `postgres_query` (internal-dashboard); it refuses `information_schema` ("System
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
