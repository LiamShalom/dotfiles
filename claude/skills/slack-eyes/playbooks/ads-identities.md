# Ad identities (creator ad authorization)

Use when: a brand asks why contracts wait on "ad authorization", why a creator has no ad identity, or
what to do about rows in Ads › Identities that show "(#3) Application does not have the granular
permission to make this API call", "You can't use this combination of Facebook Page and Instagram
account", or TikTok authorizations that expired. Also when a creator's app says "the brand is still
connecting their ads". The creator dropdown on the Identities screen was built in coverd (11-25):
`lib/api/ads/creator-connection-candidates.data.ts`.

Facts below were checked on `origin/main` and the read replica on 2026-11-26 (internet people: oauth
sidechat ads questions). Code moves: if a file here no longer matches, fix this file.

## How it works

- A campaign holds a contract at `pending` with `activation_blocked_by = 'ad_authorization'` only when
  `campaigns.setting_ad_authorization_requirement = 'require'`. The platforms are in
  `setting_ad_authorization_platforms`, and the Instagram mode in `setting_instagram_ad_authorization_mode`
  (`account` = the IG account must be authorized). The gate is `resolveAdAuthorizationGate`
  (`lib/ads/creator-auth-activation.ts`).
- One grant row per brand + creator + platform + handle in `ad_creator_authorizations` (deterministic id).
  The gate counts TikTok as done when the creator's TikTok connect holds `biz.spark.auth`
  (`oauthScopeSnapshot` on `contractsv2/<id>.socialProfiles[]`), even with no row.
- `keepOnlyWhatTheBrandCanMint`: when the brand has no usable ad account for a platform, that platform
  is dropped from "missing" and the creator sees "waiting on the brand". A contract can still sit held
  if no request was ever created for its handle: then there is no row at all for that contract.
- A brand can borrow another account's ad connection: `ad_workspace_sources` (source_company_id = brand
  → company_id = workspace), then `ad_connections` where `company_id` = workspace. A broken borrowed
  connection breaks every creator on it at once.

## Symptom → cause → proof

| Symptom | Cause | Proof |
| --- | --- | --- |
| IG rows `last_error_message` "(#3) … granular permission", `last_error_code` `permission_scope_missing` or `meta_request_failed`, `metadata->'partnershipRequest'->>'state'` = `failed` | The brand's Meta connection, not the creator | `ad_connections.metadata->'instagramPartnership'->>'code'` = `permission_scope_missing`; check `meta_token_expires_at`; group the brand's rows by state and `updated_at` to see when `sent` stopped |
| IG rows "You can't use this combination of Facebook Page and Instagram account" (`permission_api_rejected`) | Meta refuses the Page↔IG pair of the connection | `ad_connections.meta_page_id` / `meta_instagram_user_id` / `metadata->'metaDebugSnapshot'->'selected'` |
| TikTok rows `status = 'expired'`, `last_error_code = 'authorization_url_expired'` | The creator did not approve the TikTok link before it expired | `authorization_url_expires_at` on the row |
| Held contract, no row at all for it | No request was ever created for that handle | `select … from ad_creator_authorizations where contract_id = '<id>'` returns nothing |

Only the owner of the Meta connection can fix the first two (reconnect Meta with a Page↔IG pair that
Meta accepts). When the connection belongs to a SideShift teammate (managed workspace), that is
SideShift's step, not the brand's: hold it for Liam.

## Checks (read replica)

```sql
-- the brand's rows by outcome
select platform, status, last_error_code, left(last_error_message,90),
       metadata->'partnershipRequest'->>'state' pstate, count(*), max(updated_at)
from ad_creator_authorizations where company_id = '<brand>' group by 1,2,3,4,5 order by 1, 6 desc;
-- which connection the brand borrows, and its state
select company_id from ad_workspace_sources where source_company_id = '<brand>' and status = 'active';
select id, mode, status, auth_user_id, meta_token_expires_at, meta_page_id, meta_instagram_user_id,
       metadata->'instagramPartnership' from ad_connections where company_id = '<workspace>' and provider = 'meta';
-- the campaign's requirement
select setting_ad_authorization_requirement, setting_ad_authorization_platforms,
       setting_instagram_ad_authorization_mode from campaigns where id = '<campaign>';
```

The contract's creator id is not in `contracts` or `contract_social_profiles`; read the handles from
Firestore `contractsv2/<id>.socialProfiles`.

## Scope

The borrowed workspace is another company account. Never name it, its Page, or its other brands in the
customer's channel. An agency channel with no saved scope takes only the agency id; its sub-accounts
(where these campaigns live) need Liam's several-account scope before a reply can state their data.
