# Funding Studio — static site (serverless)

`html@5_serverless/` is the donation page editor as a **static site**: upload the folder to any static host (GitHub
Pages, Codeberg Pages, Netlify, an S3 bucket, nginx) or run it locally with any static file server. There is no server
code: everything happens in the browser, and nothing you type leaves it unless you export and publish it yourself.

```
html@5_serverless/
  index.html     the editor (campaigns, blocks, themes, payment methods, export)
  admin.html     the console of the backend version; here it only says that no backend is present
  …              modules, styles and the 404.html route of the static site
```

## What you make with it

Pick a template (charity, open source, creator, school / community, emergency appeal or blank), write the story, set
the goal, the amounts and the payment methods, then **Site → Output → Export**:

- **Single file** — one HTML file with every campaign and thank-you page (`#/slug` routes). Open it from disk, mail it,
  put it on any host.
- **Static site** — a ZIP with `index.html` and one folder per page (`<slug>/index.html`), relative links only.
- **Page with backend** — the same pages wired to a Funding Studio backend (see `BACKEND_NOTICE.md`); without a
  reachable backend they fall back to the methods below.

## Payment methods without a server

Exported pages contain **only public data** — never a secret key.

| Method | What the page does |
|---|---|
| Stripe | opens your Stripe **Payment Link** (`https://buy.stripe.com/…`, one per currency and interval) |
| PayPal | opens the PayPal **Donate** button link (hosted button id or business e-mail) or your **PayPal.Me** link |
| TBC Bank | opens your TBC **pay-by-link** address, or shows the GEL account (IBAN) for a transfer |
| Bank transfer | shows the account (IBAN validated, BIC) and an **EPC QR** (SEPA credit transfer) for EUR |
| Bitcoin | shows the address and a **BIP-21** QR (`bitcoin:addr?amount=…`), fixed address |
| Ethereum | shows the address and an **EIP-681** QR (ETH or USDC / USDT / DAI on Ethereum, Base, Optimism, Arbitrum, Polygon); with a browser wallet (EIP-1193 / EIP-6963) it asks the wallet to switch chain and send |

Without a server the goal progress is what you enter in the editor ("raised so far", donor count), and the donor
wall shows the entries you add by hand. Live totals, receipts, recurring management and automatic crypto detection
need the backend.

## Test mode

Use test objects while you try it: Stripe test-mode Payment Links (`https://buy.stripe.com/test_…`), PayPal sandbox
buttons, Bitcoin testnet / signet addresses, Ethereum Sepolia (chain 11155111). The editor's Payments tab checks the
format of every link, IBAN and address before export.

## Where the data is

The project you edit is stored in this browser (IndexedDB of the site's origin) and can be saved to / opened from a
`.funding.json` file. Images you add are embedded in the exported page.

## Security notes

- Exported pages contain no provider secrets, no analytics and no third-party scripts; QR codes are drawn locally.
- Payment buttons only open the provider's own pages (Stripe, PayPal, TBC) in the donor's browser; the page never
  sees card data.
- Crypto addresses are shown exactly as configured; check them once more after export — a wrong address cannot be
  undone by anyone.
