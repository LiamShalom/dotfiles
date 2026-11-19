# Shopify connect with the brand's own app

Use when: a brand cannot connect Shopify in the "Connect Shopify" dialog (tab "Use your own app"), shows an
error under the Client secret field ("This app is not installed on this store", "Shopify does not
recognize this Client ID", "rejected the Client secret", "missing these scopes", "Protected customer data"),
asks us to "do it for them", or a store stays pending or in error. The error is often only in the
screenshot, so read the files first.

Facts below were checked on `origin/main` on 2026-11-19. Code moves: if a file or line here no longer
matches, fix this file (step 7 of the skill).

## The rule for this topic: report what Shopify and our data show

Our tools cannot see a merchant's Shopify organization or install list. Do not name an org mismatch or any
other cause unless the screenshot or the store row shows it (a run on 2026-11-16 guessed "org mismatch" and
needed a correction). Do not promise that a step fixes the store: nobody tested it on that store. State the
error's meaning and the steps the dialog itself gives.

## How the flow works

- The brand creates its own app in the Shopify Dev Dashboard, enters the store domain, Client ID and Client
  secret, and clicks Connect app. SideShift calls `POST https://<store>/admin/oauth/access_token` with
  `grant_type=client_credentials` (`exchangeMerchantCredentials`, `lib/api/commerce/shopify.ports.ts:63`).
- The error text under the field is chosen only from Shopify's error code (`merchantAppError`,
  `shopify.ports.ts:54-60`): `application_cannot_be_found` = Client ID not known; `invalid_request` with
  "client secret" = wrong secret for that ID; `app_not_installed` = the app is not installed on this store
  (fix per the message: release the app version, Actions beside the app, Install app, select the store; the
  app must be in the same Shopify organization as the store); anything else = the generic "Check your app
  credentials..." line.
- After the token call (`lib/api/commerce/merchant-app.usecase.ts:26-48`): missing scopes throw "Your
  Shopify app is missing these scopes: ..."; the store row is saved with `status='error'` and
  `last_error='Shopify setup is incomplete...'` before webhooks; a webhook failure for protected customer data
  keeps `status='error'` with the Partner Dashboard message; success sets `status='connected'`.
- A failed try therefore leaves the `commerce_stores` row `pending` (token call failed) or `error` (later
  step failed). Connected stores still need the checkout pixel installed in Shopify (Settings, Customer
  events); the dialog says a connected store alone does not prove tracking.

## Symptom to cause to proof

| Symptom | Cause | Proof |
|---|---|---|
| "This app is not installed on this store" | Shopify returned `app_not_installed` | screenshot of the field; the brand's Dev Dashboard Apps list shows Installs 0 |
| "does not recognize this Client ID" | Shopify returned `application_cannot_be_found` | screenshot text |
| "rejected the Client secret" | `invalid_request` mentioning the client secret | screenshot text |
| "missing these scopes: ..." | token granted fewer scopes than `MERCHANT_APP_SCOPES` | message lists them |
| "Protected customer data" | webhook registration refused | message text; row `status='error'` |
| Generic "Check your app credentials..." | any other Shopify error, or the app is outside the store's org | no code from Shopify is kept; ask for the screenshot of the app's Installs |
| Shopify page "This installation link can't be used" | happens inside Shopify before our connector runs | one earlier job saw only a 409 in logs and a `pending` row with no `shopify_installed_at` |

## Checks

1. Read the screenshot text and match it to the table. Most cases end here.
2. Read the store row (read replica): `SELECT id, domain, status, shopify_installed_at, last_error, scopes FROM commerce_stores WHERE company_id = '<company id>'`. Find the company with `find_account`.
3. Logs: `logs_search_webapp` for the company's connect call (409 = a `DomainError('conflict', ...)`, the same text the brand saw).

## What to reply

Short, one message, tag the reporter once. Say what Shopify reported in plain words and give the steps from
the in-app message (release the version, three dots, Install app, pick the store, Connect app again). Do not
claim it will work, do not say anything about their organization, and do not promise that SideShift installs
it: we have no access to the brand's Shopify account. A brand that asks us to do it for them needs the
store owner to add us, which is an account-owner step: hold it for Liam (`only_liam_can`).
