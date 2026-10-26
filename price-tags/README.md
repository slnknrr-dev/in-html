# Price Tags

Shelf price tags for shops, designed and printed in the browser without a network: products imported from CSV / XLSX /
ODS or edited in a table, promotions and expiry markdowns, five tag templates at true size in millimetres, EAN-13 /
Code 128 / GS1 DataMatrix codes, and A4 sheets with cut marks. Built on `receipt/price.js`, `stock/batches.js`,
`barcode/`, `csv/`, `xlsx/`, `units/` and `payments/money.js`.

```bash
node price-tags/server.js            # development server
node singlefile.js price-tags        # builds html@5_offline/ and html@5_offline_singlefile/
node check.js e2e price-tags/html@5_offline_singlefile/index.html price-tags/e2e.js
node check.js e2e price-tags/html@5_offline_singlefile/design.html price-tags/e2e-design.js
```

## Pages

- **Products** (`index.html`): table with names in Georgian / Russian / English, EAN check, price, the price in effect
  today (struck base price, "−20 %" chip), pack size, unit price, category path, origin, expiry. Product and
  promotion dialogs (percent or fixed price for products and categories in a period; categories include their
  subcategories), markdown rules for expiring stock, import with suggested column mapping (an old price above the
  price becomes a promo price), CSV export, a demo shop of Georgian products, a live tag preview.
- **Designer** (`design.html`): templates (classic, promo yellow, minimal, wobbler, shelf strip), sizes 58×40, 70×37,
  90×60, A6, strip or custom, font sizes and typeface, tag language plus a second language line, currency (₾ by
  default, symbol, position, decimal mark, small decimals), unit price per kg / l or 100 g / ml, origin, date and print
  code, barcode type with the resulting module size. Preview fitted or at true size, SVG / PNG (300 dpi) export,
  tag list with picking, A4 sheets (centred grid, margin, gap, copies, cut marks), "only changed prices" against the
  last printed set kept in local storage.

## Files

| file | contents |
|---|---|
| `index.html`, `design.html` | the pages (hidden anchors `#pg-products`, `#pg-design` link them for the build) |
| `common.js` | shell, stored data, demo, design settings, pricing (`bestPrice` + markdowns), money, unit prices, printed snapshot |
| `tag.js` | one tag as SVG in mm (templates, text wrap, price parts, codes), A4 sheet grid and cut marks |
| `io.js` | CSV / XLSX / ODS reading, column mapping dialog, merge, CSV export |
| `main.js`, `design.js` | the two pages |
| `strings.js` | UI strings in the 7 UI languages |
| `app.css` | layout, sheets and print |
| `e2e.js`, `e2e-design.js` | in-page scenarios of the two pages |

## Targets

`OFFLINE_NOTICE.md` and `SINGLEFILE_OFFLINE_NOTICE.md`: zero network, the pages work from `file://`.
