# Invoice bank wire and wire top-ups

Use when: a brand asks to see SideShift's bank or ACH details instead of a payment link, says an invoice
has no wire option or no account and routing numbers, wants to top up its wallet by wire or ACH credit, or
picked "Bank wire" on a SideShift invoice and the payer page shows only Card and ACH. Wires that were sent
but are "not in the wallet" are in `payouts-and-owed.md` check 11.

Facts below were checked on `origin/main`, the read replica, Whop and Stripe on 2026-11-19. If a file or
line no longer matches, fix this file (step 7 of the skill).

## The rule for this topic: check the company's Whop bank deposits before you name the invoice option

Both runs so far lost time the same way. They read the invoice code, then pointed at the invoice
"Bank wire" option without checking whether this company's Whop account can take a bank deposit. It
could not either time. Run check 1 first.

## How it works

- **ACH on an invoice is always a pay link.** `us_bank_account` is a Whop Elements debit (Plaid), so the
  payer gets a link and a form, never bank details.
- **Whop Elements never renders `bank_wire`**, even when the invoice plan enables it (#11138, merged
  2026-11-19). Since #11138, a `bank_wire` invoice gets the merchant's Whop wire instructions on the payer page,
  in the PDF and in the email (`lib/api/invoices/wire.usecase.ts` `ensureInvoiceWireInstructions`). The
  public `GET /api/invoices/<id>` and the business GET self-heal by calling it.
- Those instructions come from `POST https://api.whop.com/api/v1/deposits {destination: <users/<company>.whop_Id>}`
  (`lib/api/invoices/wire.ports.ts`). It needs `methods.bank.currencies[]` with a `wire`/`swift`/`chaps`
  rail. If `methods.bank` is null, the code throws and catches it, the invoice keeps
  `bankTransferInstructions: null`, and the payer page quietly shows no wire block. The request log
  shows a 200 with no warning text.
- Never on payment links or their child invoices, and never before terms are accepted
  (`lib/invoices/validation.ts` `invoiceShowsWireInstructions`).
- **The wallet's own wire works without Whop bank deposits.** Wallet → Add funds → **Bank Wire**
  (`components/modals/add-funds/add-method-view.tsx`; hidden only in campaign-readiness mode) calls
  `POST /api/wallet/topup/bank-transfer`. A company that is not an agency sub-account gets its Stripe
  virtual account (account and routing, persistent). A sub-account tries its own Whop wire first, then
  falls back to Stripe (`lib/api/wallet/wallet-bank-transfer.usecase.ts`).
- Old invoices with `bank_transfer` used the Stripe virtual account too (`stripeBankTransferPaymentIntentId`,
  `invoiceWireProvider` 'stripe').

## Symptom -> cause -> proof

| Report | Cause | Proof |
| --- | --- | --- |
| "ACH makes a payment link, can it show your ACH details?" (baton, 11-19) | ACH is a debit link by design. A `bank_wire` invoice needs Whop bank deposits, and this account had `methods.bank` null | Check 1 null, check 2 `bankTransferInstructions` null. Past wires in check 3 |
| Bank wire picked, page shows only Card + ACH (sideshift, 11-19) | Whop Elements never shows bank_wire. Before #11138 nothing else did either. The company had no `whop_Id` | `users/<company>.whop_Id` missing |

## Checks

1. Whop bank deposits for the company (POST, but it only returns instructions). Print only the shape,
   never the numbers:
   ```sh
   set -a; eval "$(grep -E '^WHOP_API_KEY=' ~/sideshift-monorepo/.env.local)"; set +a
   curl -s -X POST https://api.whop.com/api/v1/deposits -H "Authorization: Bearer $WHOP_API_KEY" \
     -H 'Content-Type: application/json' -d '{"destination":"<whop_Id>"}' | python3 -c \
     "import json,sys;d=json.load(sys.stdin);print('bank:',d['methods']['bank'] and [(c.get('currency'),c.get('rails')) for c in d['methods']['bank']['currencies']])"
   ```
   Get `whop_Id` from `firestore_get_document users/<companyId>` (the `companies` table has no such column).
2. The invoice: `firestore_query_collection invoices where companyId == <id>` with select_fields
   `allowedPaymentTypes, invoiceWireProvider, bankTransferInstructions, status, purpose`. Live proof without
   signing in: `curl -s https://app.sideshift.app/api/invoices/<id>` (the JSON route; `/invoice/<id>` is only the app shell).
3. Past wire top-ups that landed: Stripe `GET /v1/customers/<users.stripeCustomerId>/cash_balance_transactions?limit=6`
   with the agents-billing key (`eval "$(grep ^STRIPE_SECRET_KEY= ~/.config/sideshift/env.local)"`).
   `funded` followed by `applied_to_payment` means the wallet wire path works for them. In `wallet_ledger`
   these rows show `reason='wallet_topup'` with `payment_method_type` and `payment_provider` both null.

## What to reply

- They want bank details to top up: point them to wallet → add funds → bank wire, which gives account +
  routing. If check 3 shows earlier wires, say it is the same way those came in.
- Do not point them to the invoice "Bank wire" option unless check 1 shows a bank currency with a wire rail.
- Do not explain Whop or Stripe to the customer.

## Open gap (not fixed as of 11-19)

The create-invoice modal (`components/modals/create-invoice-modal.tsx`, "Bank wire (account & routing)")
offers bank_wire even when check 1 is null. The payer page then shows no wire details and no error.
