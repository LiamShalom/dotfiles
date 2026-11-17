# Slack-eyes trigger tests and "where is feature X in settings" asks

Use when: the :eyes: message is a trigger test (Liam's self-DM, channel `D0B70K2EB9R`, text like "test 3"),
or an external user in a Slack Connect channel asks where a switch lives ("I do not see SideChat under
Edit → Settings"). Facts below were checked on 2026-11-17 with the internal-dashboard tools.

## Trigger tests (self-DM)

- Nothing to build. Post one short ack in the self-DM thread with `~/.claude/bin/slack-as-liam
  chat.postMessage` (check `"ok":true`), open no branch or PR, change no data, return `done`.
- `slack-as-liam` can take over 120 s in a foreground Bash call and get moved to the background. Read the
  task output file for `"ok":true` before you trust the post.

## "I cannot see feature X in campaign settings" (SideChat example)

How the switch shows (campaign wizard Settings step, `components/campaigns/wizard/steps/step-settings.tsx`):

- The SideChat section renders only when `!isManager && commentDmAccess`. `isManager` is
  `form.campaignType === 'campaign-manager'`. `commentDmAccess` is the `campaign_comment_dm` flag from
  `useFeatureFlagsOptional()`, resolved from Postgres `feature_grants` (agency grants extend to
  sub-accounts, see `services/instagram-comment-dm/README.md`).
- The server refuses saving it without the grant (`assertCommentDmAccess`, reason `sidechat_not_enabled`).

Checks, in order (internal-dashboard `postgres_query`):

1. Grant for the company and its sub-accounts. Never select all rows of `feature_grants` for the key
   (100+ rows of noise):
   `select c.name, c.id, g.enabled from companies c left join feature_grants g on g.subject_id=c.id and g.feature_key='campaign_comment_dm' where c.id='<agencyId>' or c.parent_company_id='<agencyId>'`
   On 2026-11-17 the Plutus agency and all 13 sub-accounts had `enabled=true`.
2. Campaign type: `select campaign_type, status, count(*) from campaigns where company_id='<id>' or agency_id='<id>' and archived_at is null group by 1,2`.
   Only `campaign-manager` hides the section. Many older campaigns have `campaign_type` null; null does not hide it.
3. A company can have a dead twin with no grants (the "(dead)" company next to the live one in
   `find_account`). Ask which company the person is signed in to.

If checks 1 and 2 pass, the cause is not proven from data. Ask the reporter for the campaign name, the
client account and a screenshot of the Settings page (one question, tag them). Do not claim "it should
be there" as the cause.

## Tools that did not work

- Slack profile of an external user has no email, and `find_account` by name found nothing: you cannot
  reach their account without the email or company they sign in with.
- `git grep` across the monorepo in a foreground Bash call timed out at 120 s. Use the dashboard
  `code_search` (with `path`) and `code_read_file` instead.
