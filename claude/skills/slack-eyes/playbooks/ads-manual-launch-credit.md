# Ads launched outside SideShift: credit to creators

Use when: a brand launched ads by hand in Meta Ads Manager or TikTok (not through Push Ad / the ad
builder) and the creators see "Not running as an ad yet", spend is not credited, or the brand asks to
"re-run the import", "match these ads to submissions", or how to link an existing ad to a submission.
Often a CSV of ad ids and `sideshift=<submission id>` ad names comes with it.

Facts below were proven on 2026-11-19 (pudgy penguins: manual meta ads not credited, PR #11246).

## How it works

- Nothing reads the `sideshift=<id>` tag in an ad name. SideShift writes it on its own launches only.
  An ad made outside SideShift is linked by the automatic external-ad scan
  (`/api/cron/external-ads-auto-link`, each company every 6 h) in one of two ways:
  - it runs a tracked creator post (whitelist or partnership boost): matched by the post;
  - it runs one uploaded video: registered in `ad_video_matches`, and the video matcher
    (`/api/cron/ad-video-match`, every 5 min) compares footage with the company's approved submissions,
    then queues a link job. A link job writes an `ad_launches` row; spend credit follows from it.
- The link path never accepts a source a brand names. An automatic link must equal the footage match
  (`source_unverified` otherwise). So enqueueing link jobs with a source from a CSV fails: do not try it.

## Checks, in order

1. Are the ads known at all? `select state, last_error, matched_source from ad_video_matches where
   company_id=… and external_ad_id in (…)`, and `ad_launches where external_ad_id in (…)`. No rows means
   the scan never saw them.
2. Run the scan dry run for the company:
   `PG_ALLOW_PRODUCTION=1 npx tsx scripts/ads/external-ads-auto-link-dry-run.ts <companyId>` (from a
   worktree after `~/.claude/bin/sideshift-setup`). Each connection prints `ok` or `FAILED <error>`.
   `Meta pagination exceeded the safe page limit` meant the account had more than 5,000 ads; fixed by
   #11246 (incremental reads, then 30/7/1-day windows).
3. Read the creatives (Graph `/act_<id>/ads` with `filtering=[{field:"ad.id",operator:"IN",…}]`,
   fields `creative{branded_content,source_instagram_media_id,video_id,object_story_spec{video_data},…}`).
   Partnership ads that upload the file (`branded_content` set, no `source_instagram_media_id`) were
   dropped before #11246.
4. `no_match` with `detail.matches = 1`: footage matched but `resolveOwnedCreatorVideo`
   (`lib/ads/creator-video-source.ts`) refused the owner. "This creative is not ready for promotion"
   = submission not approved, or the contract's `contractorId` is not the submission's `creatorId`.
   A contract the brand ended is converted to a ghost handle (`contractorId: ghost-<id>`,
   `convertedFromCreator`, `endedBy: company`): those ads are not credited, by design.

5. Linked (`ad_launches.source_contract_id` null, `source_submission_id` set) but 0 `adPerformanceAccruals` docs
   (query by `launchId in [...]`, doc id `<launchId>_<YYYY-MM-DD>`): the creator chip reads accruals, so it says
   "Not running as an ad yet". Check when the contract last booked (`contractId ==`, look at `updatedAt`). A whole
   contract stuck means the cron throws for it: the cron logs only error counts, so run
   `syncCompanyAdPerformanceAccruals({ companyId, campaignsById })` from a script (`readAccrualCampaigns` +
   `accrualCampaignsByCompany`, `PG_ALLOW_PRODUCTION=1`) and read `errors`. 2026-11-25 (pudgy): "Meta omitted the
   requested attribution buckets" = one view-through-only day under a `7d_click` rule (Meta drops a bucket whose
   value is 0); the read covers the ad's whole life, so the contract failed every run. Fixed by #12244.
6. `/api/cron/meta-ads-accruals` timed out (504 at 300 s) on every run on 2026-11-25: check
   `logs_search_webapp route=/api/cron/meta-ads-accruals` before blaming one contract.

## Repair after a fix deploys

- Failed link jobs block the automatic retry for 24 h (`externalAdLinkJobState/<companyId>`, `jobs` and
  `failedAt`). Remove only the failed jobs you caused, in one Firestore transaction, then run
  `autoLinkExternalAdsForCompany(companyId, { drain: true })` from a script.
- Link jobs run on production code: running them before the fix deploys fails them again.

## "Ready" but "hasn't approved your brand for partnership ads yet"

- The picker's "Ready" (`components/ads/promote-utils.ts` `isAdReady`) reads the code status of the video's OWN
  platform (Spark for TikTok, partnership code for Instagram; uploads always ready). On a Meta build it does not
  mean the video can run as the creator.
- "Run as the creator" needs the creator's approval of that Meta ad account (`lib/ads/meta-run-as-identity.ts`
  `metaOwnCreatorIdentity`). Count them: `ad_creator_authorizations` by `status` for the company (read replica;
  `pending_creator_approval` = Setup's "awaiting approval").
- Since #11619 (merged 2026-11-22) the picker shows a blue "Partnership" tag on Meta builds for videos whose creator
  approved the ad account, Ready or not. A saved code alone gets no tag: it allows a boost, not run-as.
