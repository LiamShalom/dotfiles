# Creator bio links (SideShift link in bio)

Use when: a creator or brand says a "link in bio" or creator link shows the wrong products, too few
products, products they did not order, an error ("This page couldn't load") or a blank page, or a brand
asks what a bio link is for or why a link shows its whole catalog. Read the screenshot first: it shows
which host the link is on.

Facts below were checked on `origin/main` and live HTTP on 2026-11-20. Code moves: if a file or line
here no longer matches, fix this file (step 7 of the skill).

## How it works

- Each active contract gets a link row. The page `/b/<brand>/<creator>` (use case
  `lib/api/bio-links/bio-links.usecase.ts`, `destinationFor`, around line 81) picks what to show:
  1. a website-mode setting with a valid URL: send the tap to that website, no product read;
  2. else the products the brand picked on the campaign's bio-link setting (`productIds`), in its order;
  3. else, if none of the pick is on sale (a resync archived it): the campaign's assigned products
     (`commerce_campaign_products`) that have an outbound URL;
  4. else the brand's whole catalog (`data.catalog`, capped at `BIO_LINK_PRODUCTS_MAX`).
  So "it shows products nobody ordered" means no pick and no assigned product: the catalog is the fallback.
- A tap goes to the product URL with bio UTMs. When the URL is on one of the brand's connected stores, the
  creator's `ss` tracking code is added (`outboundUrl`). A failed code lookup still sends the tap, without
  the code (log event `bio_link_tracking_code_failed`).
- A brand can also run its own bio-link host. Melaxin does: a Vercel page
  `sideshift-melaxin-bio-links.vercel.app/p/<campaign slug>/` lists each creator's links as
  `melaxin.shop/<id>/ig` and `melaxin.shop/<id>/tt`. Those pages are not SideShift's `/b/` route: look at
  the host in the screenshot before you search SideShift code.

## Symptom to cause to proof

| Symptom | Cause | Proof |
|---|---|---|
| Link shows 3 products the creator did not order, or the wrong ones | No pick and no assigned products, so the catalog fallback shows; or a new store product was never assigned | `commerce_campaign_products` rows for the campaign; the campaign's bio-link setting `productIds` |
| New product missing | Catalog not synced or product not assigned to the campaign | Run the store catalog sync, then assign the product to the campaign |
| "This page couldn't load" in Instagram's in-app browser | Not proven for any case yet. On 2026-11-20 (melaxin) every melaxin.shop URL returned 200 in under 1 s with an Instagram iPhone user agent, so it could not be reproduced | see checks |

## Checks

1. Read the host in the screenshot (address bar). `melaxin.shop` or a `*.vercel.app` host is the brand's
   own page; `app.sideshift.app/b/...` (or the SideShift bio host) is ours.
2. Fetch the exact link with an Instagram user agent and time it:
   `curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" -m 20 -A "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 350.0.0.0.0" <url>`.
   Also fetch `/products.json` on a brand's own page: the page loads it on start.
3. A tool cannot tell which link a screenshot shows. If the screenshot has no path (the error page hides
   it), ask for the exact link before you search Vercel logs.
4. For wrong products, read the campaign's bio-link setting and `commerce_campaign_products` (Firestore or
   replica) and follow the `destinationFor` order above.

## What to reply

- Wrong products: say what the link shows now and what the brand must pick or assign; once fixed, say it is fixed.
- Error that does not reproduce: one line, it loads on your side, and ask for the exact link and whether
  reload or Safari works. Do not name a cause.
