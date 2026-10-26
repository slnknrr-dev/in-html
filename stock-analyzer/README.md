# Stock Analyzer

ABC / XYZ analysis, reorder planning and expiry control for a shop or a small retail chain, in the browser without a
network: drop or paste a sales CSV / XLSX (columns are recognised from English, Russian and Georgian headers), see the
Pareto chart and the 3×3 matrix with advice per cell, plan orders by supplier with safety stock per service level, and
list markdowns and write-offs of expiring batches. A seeded demo (a grocery chain in Tbilisi: 2 stores, 123 items,
26 weeks, 8 suppliers) makes every page useful without a file. Built on `stock/`, `csv/`, `xlsx/` and `ui/`.

```bash
node stock-analyzer/server.js        # development server
node singlefile.js stock-analyzer    # builds html@5_offline/ and html@5_offline_singlefile/
node check.js e2e stock-analyzer/html@5_offline_singlefile/index.html stock-analyzer/e2e.js
```

## Pages

- **ABC / XYZ** (`index.html`):
  - Data: a dropped, picked or pasted CSV / TSV / XLSX file (encoding and delimiter detected), or the demo; the
    demo also downloads as CSV to show the format. Columns: date, SKU and / or name, quantity (required), revenue or
    unit price, category, store, cost amount, unit cost or profit. The mapping card shows the guess, a preview and
    the number of lines read and skipped; any column can be changed. Dates: ISO, d.m.y, m/d/y (order guessed from the
    column) and Excel serials.
  - Money is kept in integer minor units of the chosen currency (GEL by default) and shown with `Intl`.
  - Sales are bucketed into weeks ending on the last sales day; ABC by revenue, gross profit or quantity with
    adjustable A / B cut-offs, XYZ by the coefficient of variation of weekly sales with adjustable X / Y limits and the
    minimum history (newer items get no XYZ class). Filters by store and category.
  - KPI tiles, the Pareto chart (bars per item coloured by class, cumulative line, cut-off lines, zone labels, value
    and share axes, drawn at the container width), the 3×3 matrix (+ items without XYZ) with counts, value shares and
    advice (AX / BX auto-reorder, AZ watch, CZ delist …); a click on a cell filters the table.
  - Item table: sortable by every column, search, class badge, share, cumulative share, margin, CV and a sparkline of
    the weekly series. Exports: CSV and XLSX (items + matrix).
- **Reorder** (`plan.html`): the order day, the sales window (2–12 weeks), cover days after delivery, service levels
  per ABC / XYZ cell; stock levels (demo, imported from CSV / XLSX with the same mapping, a CSV template, or typed into
  the plan table); suppliers with lead days, order weekdays, minimum lot, multiple and holidays, one supplier per
  category. The plan (`stock/replenish.js`) gives rate, days left, safety stock, target, need and the order per store ×
  item; orders are grouped by supplier with lines per store, the next allowed order day, the delivery date, warnings
  (off-schedule day, supplier holiday, holiday ahead) and amounts at cost. Exports: CSV, XLSX (orders, suppliers,
  plan).
- **Expiry** (`expiry.html`): batches with expiry dates (demo or imported), the check day, the warning window and
  markdown rules (days left → percent). Results: fresh / expiring / expired units, the markdown list by the
  nearest-expiring batch (old and new price, loss) and the write-off list of expired batches at cost. Exports: CSV.

## Files

| file | contents |
|---|---|
| `index.html`, `plan.html`, `expiry.html` | the pages (hidden anchors `#pg-analysis`, `#pg-plan`, `#pg-expiry` give the build the links between them) |
| `data.js` | pure data side: header synonyms, `suggestColumns`, `readTable` / `tableFromText`, `buildSales` → weekly dataset, `analyze` (ABC / XYZ of a filter), `buildPlan`, `stockFromTable`, `batchesFromTable`, `buildExpiry` |
| `demo.js` | the seeded demo: sales table, stock, suppliers, batches |
| `common.js` | the shell, icons, stored state (dataset, settings, plan, expiry), formatting, mapping card, sortable table, sparkline, exports |
| `charts.js` | the Pareto chart as SVG |
| `main.js`, `plan.js`, `expiry.js` | the three pages |
| `strings.js` | UI strings in the 7 UI languages |
| `app.css` | layout of the three pages, class colour tokens (light / dark) |
| `e2e.js` | in-page scenario: demo, matrix totals, cell filter, Pareto chart and cut-off, orders of the reorder page (in a frame) |
| `server.js` | development server |

## Limits

- Old `.xls`, `.xlsb` and `.numbers` files are not read (save as `.xlsx` or CSV); the first sheet with data is used.
- The currency choice changes how amounts are read and shown, never converts between currencies.
- Unit cost and price are averages over the whole period (network-wide); stock, suppliers and batches belong to the
  loaded dataset and start fresh when another file is loaded.
- Data are kept in local storage; a dataset too big for it stays only until the page is closed.

## Targets

`OFFLINE_NOTICE.md` and `SINGLEFILE_OFFLINE_NOTICE.md` select `html@5_offline/` and `html@5_offline_singlefile/`.
Both are audited for zero network use: the pages work from `file://`.
