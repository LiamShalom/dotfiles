# Campaigns page UI (list, Applicants tab, applicant profile sheet)

Use when: a brand or teammate reports a display problem on the Campaigns page: the order of the
campaign list or pinning a campaign, the Applicants grid, or the creator profile sheet that opens
from an applicant ("glitches", "black / white screen", flicker on scroll, empty video tiles, "No posts").
This includes reports from sales demos on the Demo Account.

Facts below were checked on `origin/main` and in production on 2026-11-20. Code moves: if a file or
line here no longer matches, fix this file (step 7 of the skill).

## How it works

- **Campaign list order** comes from `/api/programs` as returned. Pins are stored per device in
  localStorage (`usePersistedState('campaigns:pinned:v1')` in
  `components/campaign/campaigns-list-view.tsx`). Pinned rows come first (`pinnedCampaignRows`), and
  `activeRows` drops archived rows. No pin is stored on the server.
- **Applicant profile sheet** = `ProfileSheet` in `components/modals/applicant-profile-sheet.tsx`. It is
  a hand-built portal: a framer-motion panel with `will-change-transform`, and one scroller
  (`flex-1 overflow-y-auto`). Experiences over 4 get their own inner scroller (`max-h-[300px]`).
  `suspended`/`hasOpenChildModal` hide the sheet and its backdrop (`invisible`) while a child modal
  is open. The URL gets `&applicant=<id>` when a sheet opens.
- **Top posts row** (`TopPostsRow`): 3 tiles. They show a thumbnail, or our own copy's first frame, or
  "View Post". When the list is empty they show dashed "No posts" tiles. Data comes from
  `POST /api/applicants/top-posts {userId, jobId}`.
- **Demo Account** = company `demo-cluely`. It is offered to every Member/Employer in Switch Company
  ("Demo Account - Sample Data"). Its real team is only the seeded `demo-tm1..4` accounts
  (`users/demo-cluely/members`). A SideShift teammate who demos it is usually a Member whose
  `activeCompany` is `demo-cluely` but who is not on that team.

## Symptom → cause → proof

- **Demo Account sheet shows "No posts" for a creator with 1.7K posts:** a viewer who is not on the
  demo team gets 403 `Access denied to this job` from `/api/applicants/top-posts`
  (`lib/api/applicants/company-shared.ts` → `ports.canAccessCompany`). Proof: in the sheet, wrap
  `window.fetch` and read the top-posts response (status and body).
- **Flicker or black/white screen while scrolling the sheet (2026-11-20, jackson):** not reproduced.
  Setup: a test brand switched onto demo-cluely, job `demo-j3`, at the reporter's window size from
  PostHog (1910x830, Chrome 157 Mac). Scrolled with real CDP `mouseWheel` events and recorded
  `Page.startScreencast` frames. Result: no remount, no URL change, no console error. A
  background agent-Chrome tab cannot show a GPU or paint glitch. Get the reporter's video before you
  name a cause.

- **Job menu opens twice, a second copy stuck top-left (2026-11-21, canyon):** the Applicants toolbar
  renders twice (pinned copy and a CSS-hidden phone copy). Before #11386 (merged 2026-11-20 13:11 ET)
  both copies shared one `open` state, so the hidden copy's menu opened at 0,0. Now each copy has its
  own state (`wideJobSelectOpen` / `phoneJobSelectOpen` in `components/applicants/applicants-view.tsx`).
  Proof on prod: open the visible `button[aria-label="Job role"]` and count `[role=listbox]` (1 = fixed).
  Not reproduced on prod at 2000 and 2280 wide, with or without a search typed.

- **Applicants list loads forever, then a 500 (2026-11-23, knowt):** `/api/applicants/filtered-v2` or
  `/counts` threw `Cannot read properties of undefined (reading 'user_id' | 'userId')`. Cause: postgres.js
  3.4.9 kept its row index after a statement that timed out mid-stream, so the next result on that
  connection began with empty slots. Proof: in the failing request's logs, one `pg_analytics_query` has
  `rows` above its `limit`/`creatorCount` (292 from LIMIT 126). The ~35 s per batch was the
  paid-campaigns read timing out. Fixed in #11774 (`scripts/patch-postgres-driver.mjs` resets `rows` at
  ReadyForQuery; the paid-campaigns read covers only kept rows).
  Full logs with stacks and per-request PG events:
  `vercel logs --project sideshift-web --scope side-shift --environment production --status-code 500 --query filtered-v2 --since <iso> --until <iso> --json --expand`
  (run outside the repo; the MCP log tool cuts messages at about 500 chars).

- **Applicants tab badge says N but the page shows "No Applications Yet" (2026-11-24, spacexsi):** the
  badge (`CampaignPageTabs.tsx`, `usePendingInviteLinkSignupsCount`) counts invite-link sign-ups waiting for
  Accept. They are listed only under the job picker's "Signed invites (N)" entry, and the page used to open
  on the remembered job (the tab link carries `?jobId=`). Proof: `job_applications` has 0 rows for the job
  shown, and Firestore `contractsv2` for the company has `status: pending` + `brandReviewsSignup: true`.
  Fixed in #11917: the page opens on Signed invites when the opened job is empty and a sign-up waits.
  Prove on a preview as the Dev Testing Liam brand (it has 3 real signed invites): open
  `?tab=applicants&jobId=<an empty job>` and read the `Job role` button text.

- **Messaged or hired creators still in Unreviewed (2026-11-25, saas2cash):** Unreviewed (`open`) =
  New/Reviewed, minus Contacted (`lib/api/applicants/contacted.sql.ts`: the company room carries a
  `chat.business_references` support_context with `context_domain='job'` and a brand message after the
  apply), minus contracted (skipped on open-application jobs). Until #12108 only THIS job's stamp counted,
  so a brand with two listings of one name kept creators messaged on the other listing in Unreviewed.
  Proof: the chat schemas are readable with `mcp__cloud-sql-postgres-read-replica__execute_sql` (not the
  dashboard postgres tool): read the room's `business_references` and `chat.messages` for the creator.
  Which job the screenshot shows: `vercel logs ... --query <jobId>` for `/api/applicants/tiered` at the
  screenshot time (two jobs can share a title). The fit tabs (Great/Good/Fair) count only the current
  Status bucket with the brand's filters, so they add up to the "Unreviewed (N)" in the filter panel.
- **Name search returns nothing (since #11538, 2026-11-20):** plain text + Enter runs a TOPIC search. A
  name needs `@name` (or the "Search @name" hint), and it searches only the current Status bucket and filters.

## Checks

1. Read the reporter's clip. Ergo links (`share.joinergo.com/c/<id>`) need an email code:
   `curl https://api.joinergo.com/api/dashboard/meeting-clip/shared/<id>` returns `{"requiresAuth":true}`.
   Do not enter Liam's email there. Ask the reporter to drop the file in the thread instead.
   The thumbnail is public: `https://share.joinergo.com/t/c/<id>.jpg`.
2. The reporter's browser and window size: PostHog project **633691** (`switch-project` first), using
   `execute-sql` on `events`: `event = 'applicant_viewed'`, `person.properties.email = '<email>'`,
   with `properties.$browser`, `$os`, `$viewport_width` and `$viewport_height`.
   Session replay and exception autocapture are **off** in 633691, so there is no recording to read.
3. Reproduce on app.sideshift.app as the test brand (`~/.claude/bin/agent-signin.mjs <url>`).
   For the Demo Account: company menu → Switch Company → "Demo Org" row → Select. Then use
   `emulate viewport=<w>x<h>x2` and scroll with CDP `Input.dispatchMouseEvent type=mouseWheel`.
   **Switch the test brand back afterwards**: `activeCompany` is shared state (check `users/<uid>.activeCompany`).

## Reply

- Not reproduced: one line saying you cannot get it to happen and asking for the clip file. Do not
  give a cause.
- Pin question: pins are per device and per browser (localStorage), not shared with teammates.
