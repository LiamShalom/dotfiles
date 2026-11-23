# API keys, OAuth connections and their scopes

Use when: a brand or agency asks for an API or MCP credential (a personal key, a key for sub-accounts), or
reports `403 insufficient_scope` ("This action needs the 'Manage campaigns' permission. Check the scopes
granted to this connection and your current team permissions."), or asks which scope or permission to change.

Facts below were checked on `origin/main` on 2026-11-23. If a file no longer matches, fix this file
(step 7 of the skill).

## How it works

- The 403 comes from `handleOAuthResourceRoute` in `lib/api/oauth/resource-route.ts` (~L448-455): `hasScope(ctx, scope)`
  fails, and the message is `requiredScopeMessage(scope, 'connection')` (`lib/api/oauth/scope-metadata.ts`). The text
  names both the connection's scopes and team permissions on purpose. It does not say which one is short.
- Scope labels: `campaigns:write` = "Manage campaigns", `contracts:write` = "Manage contracts" (same file, `SCOPE_LABELS`).
- **Platform API keys** (`lib/api/oauth/platform-api-keys.usecase.ts`): only list, create and revoke exist. A key's
  scopes are fixed when it is created: to add one, create a new key and revoke the old one. A key cannot be created
  with more than its creator's team permissions (`createPlatformApiKey`), and at use time its scopes are cut to the
  creator's current permissions (`constrainScopes`, ~L330). Keys are company-bound unless `access: 'personal'`.
- UI: Settings tab "API & MCP" (`app/(business)/(main)/settings/page.tsx:179`), sub-tab "API Keys", button "Create API key"
  (`components/settings/api-mcp/`).
- Storage: Firestore `platformApiKeys` mirrored to Postgres `platform_api_keys` (`key_id`, `company_id`, `scopes`, `active`,
  `created_by`).

## What an agent cannot see (do not retry)

- `platform_api_keys` and `platformApiKeys` are refused to the internal-dashboard tools, the read-replica MCP
  ("permission denied for table") and the Firestore MCPs. A customer's key scopes cannot be read, so never state which
  scopes their key has or whether it is a key or an OAuth grant. Say "if it is an API key".
- `logs_search_webapp` by request id only covers the last 15 minutes, so a request id from the day before finds nothing.

## Symptom to cause to proof

| Symptom | Cause | Proof |
| --- | --- | --- |
| `insufficient_scope` on writes only, reads fine | The credential's effective scopes hold `:read` but not `:write` | `scope-metadata.ts` label for the scope; `resource-route.ts` scope check |
| Customer owner asks "can we grant it ourselves" | New key with the scope (Settings > API & MCP > API Keys); an existing key cannot be edited | `platform-api-keys.usecase.ts` has no update function |
| Key made by a member | Scopes are capped by that member's permissions | `constrainScopes` in the usecase |

## What to reply

Short and conditional: where to create the key, that scopes cannot be edited, revoke the old one. Do not claim what the
key holds, and do not promise that SideShift will change anything. Personal keys for agencies are a feature request, not a
cause hunt: return `needs_liam` with `large_merge_held`, not `cause_unproven` (earlier lesson, 2026-11-18).

## Related: campaign `requirements.verifiedResidenceCountries`

`evaluateVerifiedResidence` in `lib/kyc/residence.ts` marks a creator ineligible when a country list is set and the creator is
not verified (required, pending, unavailable) or is verified in a country outside the list. Admission and apply use it.
Whether discovery hides the listing is stated in `docs/features/verified-residence.md` but was not run here.
