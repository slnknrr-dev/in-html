# Funding Studio

A visual editor for **donation pages**: campaigns with a goal and a live progress bar, an amount picker, rewards,
a donor wall and everything a fundraiser needs, paid through **Stripe, PayPal, TBC Bank, bank transfer, Bitcoin and
Ethereum**. The pages work as plain files without any server, or are served by the application's own backend, which
keeps the provider keys, creates checkouts, verifies webhooks and keeps the ledger.

```bash
node funding-studio/server.js      # editor at /funding-studio/, backend + admin console mounted (data in funding-studio/.data/)
node singlefile.js funding-studio  # builds html@5_serverless/ and html@5_backend/
```

## Features

- **Campaign pages** (several per project, each with its slug, goal, currency, dates and methods) and **thank-you
  pages**; a campaign switcher and a list of campaigns. Single file (`#/slug` routes), static site (one folder per
  page) or pages of the backend (`/s/<site>/<page>/`).
- **23 blocks**: hero, story, goal progress (with milestones), donate panel, tiers / rewards, impact lines ("25 € = a
  week of breakfasts"), donor wall or leaderboard (consent and anonymity; moderated with the backend), updates, FAQ,
  matching sponsor, countdown, transparency (planned vs. spent, a report file), share (links, copy, native share),
  campaigns list, thanks, plus navigation, footer, sections, columns, text, images, quotes, dividers.
- **Donate panel**: preset and custom amounts with limits, one-time / monthly, several currencies (fixed rates or a
  price source), donor name / e-mail / message, "anonymous" and "show me on the wall", then the payment methods the
  campaign enables. Methods that need the server fall back to their serverless form (links, IBAN, QR) when the
  backend cannot be reached.
- Multilingual content (any number of languages, one switcher), UI strings in English, Russian, Ukrainian, German,
  French, Spanish and Georgian; six themes with light and dark palettes; layouts for desktop and phones.
- **Templates** (all organisations, people and figures are fictional; no payment details are pre-filled): charity
  (community kitchen), open-source project, creator, community / school, emergency appeal, blank.

## Payment methods

| Method | Without a server (static export) | With the backend |
|---|---|---|
| Stripe | Payment Links (`buy.stripe.com/…`, per amount / currency / interval), Buy Button | Checkout Sessions with `price_data` (one-time and monthly subscriptions), signed webhooks, customer portal |
| PayPal | Donate button (hosted button id or business e-mail), PayPal.Me | Orders v2 create / capture, Subscriptions with generated plans, webhooks verified through PayPal's API |
| TBC Bank | pay-by-link addresses, account IBAN | E-Commerce (TPay) checkout in GEL (and USD / EUR), callbacks confirmed by a status lookup, saved-card recurring |
| Bank transfer | IBAN (validated), BIC, purpose; EPC QR (SEPA) for EUR | manual entries in the console |
| Bitcoin | address with BIP-21 QR | one address per donation, derived from the owner's xpub / descriptor (watch-only) or taken from an address pool; detection through an Esplora API |
| Ethereum | address with EIP-681 QR (ETH, USDC / USDT / DAI on Ethereum, OP, Arbitrum, Base, Polygon; Sepolia for tests); browser wallets (EIP-1193 / EIP-6963) with chain switching | the page reports the transaction; the backend verifies it over JSON-RPC (recipient, amount, token log, confirmations) |

## Artifacts

- `html@5_serverless/` (`SERVERLESS_NOTICE.md`) — the editor as a static site; everything stays in the browser.
- `html@5_backend/` (`BACKEND_NOTICE.md`) — the editor, the admin console (`admin.html`) and the donation backend
  (`backend.js`) for Node ≥ 18: published sites with live figures, checkouts, webhooks and callbacks, the ledger,
  wall moderation, recurring donors and their self-service link, HTML receipts, CSV / JSON export, crypto detection.

## Provider test mode

- **Stripe**: a test-mode secret key `sk_test_…` and the signing secret `whsec_…` of a webhook endpoint pointing at
  `<base>api/webhooks/stripe` (locally: `stripe listen --forward-to localhost:8080/api/webhooks/stripe`). Static
  pages: test-mode Payment Links (`https://buy.stripe.com/test_…`).
- **PayPal**: a REST app of the developer dashboard (client id + secret) with *Sandbox* on in the console, and a
  webhook to `<base>api/webhooks/paypal` (its id goes into the settings); pay with sandbox buyer accounts.
- **TBC Bank**: test credentials (API key, client id, client secret) of the TBC developer portal; the callback URL is
  sent with every payment.
- **Bitcoin**: a testnet tpub / descriptor (or testnet / signet addresses in the pool) with network *test*, and a test Esplora (`https://mempool.space/testnet4/api`).
- **Ethereum**: Sepolia or Base Sepolia with an RPC URL for that chain.

Each provider has a **Test** button in the console. Donations made with test keys are marked "test" in the ledger.

## Security notes

- Exported and published pages contain only public data (links, addresses, IBAN); secret keys exist only in the
  backend's settings, are never sent back to the console and are refused by the editor's fields (`sk_…` warnings).
- Payments are confirmed from the provider, never from the browser: Stripe signatures (HMAC-SHA256, 5 min
  tolerance), PayPal verification API, TBC status lookup, Esplora / JSON-RPC for crypto. Webhook events are processed
  once; amounts and currencies come from the provider.
- The admin API needs a bearer token (`FS_ADMIN_TOKEN` or generated); public endpoints are rate-limited and
  size-limited; thank-you redirects only go to the site itself or to configured origins.
- Donor data (name, e-mail, message) stays on the owner's server; the wall shows only donors who opted in, after
  approval by default.

## Crypto libraries

`chains.js` is the product's small crypto interface over the repository's wallet libraries: Bitcoin address rules,
BIP-21 and the Esplora client come from `bitcoin/`, EIP-55, EIP-681, ERC-20 call data and the JSON-RPC client from
`ethereum/` (both over `crypto/` and `hdkey/`). Per-donation addresses from an **xpub / ypub / zpub (tpub on test
networks) or an output descriptor** are derived watch-only by `bitcoin/account.js`, which `backend.js` wires in
with `wireCrypto({ bitcoin })`; the editor does not load it, so `canDerive()` is false there and
`deriveBtcAddress()` throws `CRYPTO_GAP`. The backend checks the key when the settings are saved, hands out the
receive addresses of the account in order (one counter per key and network) and falls back to the address pool when
no key is set. EIP-681 amounts are written as plain integers for the widest wallet support.

## Tests

```bash
node funding-studio/test.js      # model, chains, QR, rates, export, backend against payments/mock.js and mock-chains.js
node payments/test.js            # money, IBAN / EPC, Stripe / PayPal / TBC clients and signatures
node funding-studio/e2e-run.js   # headless Chrome at 1280x900 and 390x844: editor (template, payments, export) and
                                 # backend (console, Stripe checkout + webhook, live goal, ledger, wall approval)
```

No test reaches a real provider or the network: `payments/mock.js` mimics Stripe, PayPal and TBC (including their
hosted pages and signed notifications), `mock-chains.js` an Esplora API and an Ethereum JSON-RPC node.

## Files

`base.js`, `model.js` (document), `chains.js` (crypto adapter), `render.js`, `blocks-*.js`, `design.js` (themes),
`runtime*.js` (page scripts), `dict.js` (page strings), `viewer.js` (the product), `templates*.js`; the editor:
`index.html`, `editor*.js`, `site.js` (static site), `i18n-*.js`; the backend: `backend.js`, `server-*.js`,
`admin.html` / `admin.js` / `admin-i18n.js` (console), `mock-chains.js`.
