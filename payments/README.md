# payments

Fiat payment building blocks for donation and shop backends: money amounts, bank transfer details, and minimal clients
of Stripe, PayPal and TBC Bank (Georgia) that speak the documented REST shapes over an injected HTTP function. Pure ES
modules without DOM access; the clients run in Node (backends hand in `node:http` / `node:https` through
`nodeRequester`, because bundled backends cannot import `node:` modules) or anywhere `fetch` exists.

Secrets (Stripe secret keys, PayPal client secrets, TBC client secrets) belong to servers only: nothing in this
library is meant to run in a published page with real keys.

| file | contents |
| --- | --- |
| `money.js` | ISO 4217 minor units, `parseAmount` (`'1.234,50'`, `'12,5'`…), `toMinor` / `fromMinor` without float drift, Stripe's zero- and three-decimal rules (`stripeMinor`), PayPal value strings, `formatMoney` (Intl with a fallback), `convert` with fixed rates (direct, inverse, one hop), currency lists of PayPal and TBC |
| `iban.js` | IBAN normalization, country lengths and the mod-97 check (`ibanProblem`: format / country / length / checksum), BIC, the EPC QR payload of a SEPA credit transfer (EPC069-12, "GiroCode") |
| `http.js` | the client interface `request({ method, url, headers, body, timeout }) → { status, headers, text }` over Node's http / https (`nodeRequester`) or fetch (`fetchRequester`); `formEncode`; provider errors with the provider's message |
| `stripe.js` | Stripe's bracket form encoding, webhook signatures (`Stripe-Signature: t=…,v1=…`, HMAC-SHA256 of `t.payload`, several v1 for rotation, a replay window), a client for Checkout Sessions, the customer portal and subscriptions, the Checkout Session of a one-time or monthly donation with `price_data`, Payment Link prefills, and `stripeEvent` (the facts a ledger needs from `checkout.session.*`, `invoice.paid`, `customer.subscription.deleted`, `charge.refunded`) |
| `paypal.js` | OAuth client credentials with a cached token (retried once on 401), Orders v2 (create with `payment_source.paypal.experience_context`, the `payer-action` link, capture), webhook verification through `/v1/notifications/verify-webhook-signature`, catalog products / monthly plans / subscriptions, `paypalEvent`, the no-server Donate button URL (hosted button id or business account with amount) and paypal.me links |
| `tbc.js` | TBC E-Commerce checkout ("TPay", developers.tbcbank.ge): access token (`apikey` header, form-encoded client id / secret), create payment (`approval_url` redirect link), payment details, cancel, charges on a saved card (`/payments/execution`, monthly donations), statuses and their meaning, the unsigned callback (`{ PaymentId }`, confirmed by reading the status) |
| `mock.js` | `startMockProviders()`: one local HTTP server that mimics the three APIs and their hosted pages (checkout, approval, callback / webhook delivery with valid signatures) for tests and end-to-end scenarios |
| `test.js` | `node payments/test.js` |

## Notes

- Stripe signatures: `verifyStripeSignature(rawBody, header, whsec)` must get the raw request body (bytes or the exact
  text), not re-serialized JSON. The default tolerance is 300 seconds, as in Stripe's libraries.
- PayPal webhooks are verified by PayPal itself (`verifyWebhook`): the webhook id comes from the app's webhook
  settings; certificate-based offline verification is not implemented.
- TBC callbacks are not signed: a backend answers 200 and trusts only `getPayment(payId)`. The bank sends callbacks
  from `TBC_CALLBACK_IPS`. Currencies: GEL, USD, EUR.
- `mock.js` is for tests only (it imports `node:http`); it never contacts a provider.
