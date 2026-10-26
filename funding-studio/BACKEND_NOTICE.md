# Funding Studio — with your own backend

`html@5_backend/` is the donation page editor **plus a small donation server**: it hosts your campaign pages with live
goal progress, keeps the provider keys on the server, creates Stripe / PayPal / TBC Bank checkouts, receives their
webhooks, keeps a ledger of donations, moderates the donor wall, manages recurring donors, issues receipts and
watches Bitcoin and Ethereum payments. It needs only **Node.js 18 or newer** — no packages, no database.

```
html@5_backend/
  server.mjs     the web server (static files + the backend), generated from hosting.js
  backend.mjs    the donation backend (funding-studio/backend.js and its modules, bundled)
  public/        the editor (index.html) and the admin console (admin.html)
```

## Run

```bash
FS_ADMIN_TOKEN=choose-a-long-random-string node server.mjs     # http://127.0.0.1:8080/
node server.mjs 3000 --host 0.0.0.0 --data /srv/funding         # another port, every interface, another data folder
```

`PORT`, `HOST`, `DATA_DIR` work as environment variables too. Without `FS_ADMIN_TOKEN` the server generates an admin
token on the first start, stores it in the data folder and prints it. Then:

1. Open `/admin.html`, sign in with the token, **Settings**: the public address of the server and the provider keys.
2. Open `/` (the editor), build the campaigns, **Site → Server → Publish**. The pages appear at `/s/<site>/`.
3. Register the webhook / callback addresses shown on the console's overview in the provider dashboards.

For the internet put it behind a reverse proxy that terminates HTTPS (Caddy, nginx); Stripe, PayPal and TBC only
call HTTPS webhook addresses.

## Providers (test mode first)

| Provider | Settings | Webhook / callback |
|---|---|---|
| Stripe | secret key `sk_test_…` (a restricted key with Checkout Sessions and Billing portal write is enough), webhook signing secret `whsec_…` | `<base>api/webhooks/stripe` — events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `invoice.paid`, `customer.subscription.deleted`, `charge.refunded` |
| PayPal | REST app client id + secret, **Sandbox** on, webhook id | `<base>api/webhooks/paypal` — `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`, `BILLING.SUBSCRIPTION.ACTIVATED`, `BILLING.SUBSCRIPTION.CANCELLED`, `PAYMENT.SALE.COMPLETED` |
| TBC Bank | E-Commerce (TPay) API key, client id, client secret; payment methods | `<base>api/callbacks/tbc` (sent with every payment) |
| Bitcoin | Esplora API (`https://blockstream.info/api`, `https://mempool.space/api`, or your own), an account xpub / ypub / zpub (tpub on test networks) or an output descriptor — watch-only, no private key — or a pool of receiving addresses, confirmations | — (polled) |
| Ethereum | JSON-RPC URL per chain (your node or a provider), confirmations | — (claims verified over RPC) |

Each provider block in the console has a **Test** button that makes one harmless authenticated call. Stripe test keys,
PayPal sandbox and TBC test credentials give donations marked "test" in the ledger.

How payments are confirmed: Stripe — signed webhook (`Stripe-Signature`, HMAC-SHA256, 5 minutes tolerance), the
session is also fetched on return; PayPal — the order is captured on return and webhooks are verified through
PayPal's `verify-webhook-signature`; TBC — the callback carries only a payment id, so the server always asks TBC for
the payment's status; Bitcoin — each donor gets the next receive address of your account (or an unused one from the pool) and the server polls Esplora; with an xpub, raise the gap limit of your wallet if many checkouts stay unpaid;
Ethereum — after the wallet sends, the page reports the transaction hash and the server checks it over JSON-RPC
(recipient, amount, token transfer log, confirmations). Amounts in crypto are converted with your fixed rates or the
price source you configure.

## Data

The data folder holds JSON files written atomically: `settings` (with the secrets), `site:<id>` (published sites),
`don:<id>` (donations), `sub:<id>` (recurring donors), counters and the processed webhook ids. Back it up like any
folder. **Export** in the console gives CSV or JSON of the ledger.

## Security notes

- Provider secrets are stored on the server only. The console never receives them back (write-only fields), and no
  exported or published page contains them.
- Webhooks are verified (Stripe signature, PayPal verification API, TBC status lookup); amounts and currencies are
  taken from the provider's answer, never from the browser. Each event is processed once.
- The admin API needs the bearer token; the token is kept in the console's tab (sessionStorage) only. Use a long
  random value and HTTPS.
- Donor names, messages and e-mails are stored on your server. The wall shows only donors who opted in, and with the
  default setting each entry waits for approval. Receipts and recurring management links carry a per-donation key.
- Public endpoints are rate-limited per address; request bodies are size-limited.
- When the backend is unreachable, published pages fall back to the methods that need no server (see
  `SERVERLESS_NOTICE.md`), so donors can still give.
