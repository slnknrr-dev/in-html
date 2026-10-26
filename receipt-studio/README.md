# Receipt Studio

A cashier / point-of-sale simulator and receipt calculator for training and for checking the maths of a check, without
a network. Georgian retail by default (GEL, VAT 18 % included in prices), with the currency, VAT rates, rounding and
the loyalty programme configurable. Money is kept strictly in integer minor units (tetri, cents) and every amount comes
from `receipt/`: line amounts, discounts allocated to the minor unit, VAT by rate, payments with change, returns and
shift reports. Receipts are shown as thermal-printer text (58 / 80 mm) and as a printable HTML receipt with a Code 128
barcode and a QR code of the receipt number. Built on `receipt/`, `barcode/`, `qr/` and `ui/`.

```bash
node receipt-studio/server.js        # development server
node singlefile.js receipt-studio    # builds html@5_offline/ and html@5_offline_singlefile/
node check.js e2e receipt-studio/html@5_offline_singlefile/index.html receipt-studio/e2e.js
```

## Pages

- **POS** (`index.html`):
  - Catalogue: demo items seeded in the UI language (EAN-13 codes with the Georgian 486 prefix drawn on the tiles,
    VAT 18 %, 0 % and "without VAT", weighed goods with a PLU), category filter, search. The catalogue, the
    promotions and the settings are edited in dialogs; the demo data can be restored.
  - Adding: click a tile, or type / scan into the scan field — an EAN (check digit verified), a PLU, `3*code` for a
    quantity, an in-store weight code `2X IIIII WWWWW C` (barcode/gtin.js), or a loyalty card number. Digits typed
    anywhere outside a field land in the scan field, so keyboard-wedge scanners work without clicking first.
    Keys: F2 scan field, F4 cash field, F9 or Ctrl+Enter pay.
  - The check: quantities and weights (three decimals), line discounts (% or amount), a whole-check discount spread
    over the lines by largest remainder, promotion prices from `receipt/price.js` `bestPrice` (percent off or a fixed
    price for items or categories, with the regular price struck through), subtotal and total, and the VAT breakdown by
    rate (net / VAT / gross, "without VAT" apart; per line or rounded per rate).
  - Payment: cash, card or mixed (card part + cash), loyalty points (whole points, within the balance and the
    programme's share of the check, a "max" button), cash received with change and quick banknote amounts, cash
    rounding to the smallest coin, errors (cash short, card above the amount, points limits, blocked card).
  - Receipt: live draft while the check is built, the paid receipt afterwards; 58 mm (32 columns) or 80 mm (48
    columns); printer text (`receipt/format.js`, labels in the UI language) or the printable HTML receipt; print, copy,
    save as text. The receipt code is shift (4 digits) + receipt number (6 digits) as Code 128; the QR holds
    `RCPT|tax ID|code|time|total|currency|S/R`.
  - Shift card: status, receipts, expected cash, the X report and closing with the Z report.
- **Returns** (`returns.html`): pick a sale receipt (list or number / scanned receipt code), return lines fully or
  partially (what is left after earlier returns), see the return total at the prices actually paid, its VAT and the
  refund split (cash in the share cash had in a mixed sale, the rest to the card, spent points refunded and earned
  points reversed), make the return document and print its receipt. Loyalty balances follow.
- **Shift** (`shift.html`): open a shift with the opening cash; cash in / out (a cash out above the expected drawer is
  refused); the live X report (sales and returns with cash / card / mixed / points, net, VAT by rate, opening cash,
  cash in / out, expected cash) as figures and as printed text; the receipts of the shift; closing with the counted
  cash and the Z report (difference); earlier Z reports; the journal exported as CSV (formula-injection safe) or JSON;
  a training reset (shift, receipts, Z reports and counters; catalogue, cards and settings stay).

A shift lasts at most 24 hours (`receipt/shift.js`); an expired shift must be closed before selling. The first
payment opens a shift when none is open.

## Files

| file | contents |
|---|---|
| `index.html`, `returns.html`, `shift.html` | the pages (hidden anchors `#pg-pos`, `#pg-returns`, `#pg-shift` give the build the links between them) |
| `common.js` | the shell, icons, the persisted data and demo seeds, money formatting, receipt text / HTML / barcode / QR, printing at 58 / 80 mm, open / close shift dialogs and the report view |
| `main.js` | the POS page and the catalogue, promotion and settings editors |
| `returns.js` | the returns page |
| `shift.js` | the shift page |
| `strings.js` | UI strings, receipt labels and demo names in the 7 UI languages |
| `app.css` | layout of the three pages, the thermal paper, the HTML receipt and print sheets |
| `e2e.js` | in-page scenario: scan with a quantity, clicks, a weight code, a promotion, a 10 % check discount, totals and VAT, a mixed payment with change, the paid receipt with its codes and the Z report figures |
| `server.js` | development server |

## Data

Everything stays in the browser's local storage: `rs-config` (currency, VAT, rounding, seller, cashier, loyalty),
`rs-catalog`, `rs-promos`, `rs-cards`, `rs-cart` (the check being built), `rs-shift`, `rs-journal` (the last 3000
documents as `receipt/doc.js` builds them), `rs-z` and `rs-seq` (receipt and shift counters).

## Limits

- Changing the currency changes the number of decimals (`payments/money.js` `minorUnits`) but does not convert stored
  amounts.
- Thermal text aligns by code points; Georgian lines align on paper only with a monospaced font that has Georgian
  glyphs (the screen preview falls back to proportional glyphs for them).
- No fiscal printer or fiscal numbers: documents are training receipts. Stock levels are not tracked.

## Targets

`OFFLINE_NOTICE.md` and `SINGLEFILE_OFFLINE_NOTICE.md` select `html@5_offline/` and `html@5_offline_singlefile/`.
Both are audited for zero network use: the pages work from `file://`.
