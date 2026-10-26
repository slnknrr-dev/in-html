# Planogram Studio

Shelf planning in the browser without a network, in the spirit of Leafio Shelf: fixtures with shelves, a product
library, products placed on shelves with facings, a live fit check, space-to-sales analytics, saved versions with a
readable comparison, and the store floor plan with the fixtures linked to their planograms. Built on `planogram/`
and `plan/`, with `csv/`, `xlsx/` and `barcode/`.

```bash
node planogram-studio/server.js        # development server
node singlefile.js planogram-studio    # builds html@5_offline/ and html@5_offline_singlefile/
node check.js e2e planogram-studio/html@5_offline_singlefile/index.html planogram-studio/e2e.js
```

## Pages

- **Planograms** (`index.html`):
  - Fixtures: gondola, wall rack, fridge, pegboard (hooks at a hole pitch). Name, size, plinth; shelves from top to
    bottom in an editable table (type, width, clearance, depth, board, pitch, fill bar), reorder, duplicate, even
    clearances, rebuild with another shelf count.
  - Product library: search, categories, the placed facings per product; CSV / TSV / XLSX / ODS import with a column
    mapping dialog (Russian / English / Georgian headers suggested) that merges by EAN or name or replaces the
    library; product cards with squeeze per axis, prices, daily sales, stock, case units, an own colour and the EAN
    drawn as a barcode; products CSV export.
  - Placing: drag a product onto the front view (an insertion marker shows where), drag blocks to move them between
    shelves, or the keyboard way — product + shelf + facings → Place, and shortcuts on the focused stage (arrows,
    Alt + arrows, + / −, [ ], R, T, D, Enter, Delete).
  - Positions: facings across / up / deep with steppers, rotation 0 / 90 / 180 / 270, the sideways turn, auto depth,
    fill height / width to the limits the fit check allows.
  - Fit check (`planogram/fit.js`) on every change: a badge (fits / fits with squeeze / N problems), the warning list
    in the UI language (click selects the shelf or position), red overflow zones and amber squeeze zones on the
    front view, coloured by category, brand or product with a legend. Undo / redo (Ctrl+Z / Ctrl+Y).
  - Analytics for the fixture or all fixtures: shelf and used metres, fill, SKUs, capacity, sales and gross profit
    per metre, days of supply; space share against sales share per category or brand (`macroSpace`) with fair metres
    and verdicts; days of supply per product with low / high / below-a-case / no-sales statuses.
  - Versions: named snapshots of a fixture, restore, delete, and the comparison of any two (or a version and the
    current state) through `planogram/diff.js` as a readable list.
  - Export: SVG and PNG of the front view with a legend, printing at 1:5 … 1:50 on A4 / A3 (mm SVG, the fit on the
    sheet is checked), positions CSV, the project as JSON (with versions) and back, demo, new project.
- **Store plan** (`store.html`): the shop floor in metres with `plan/` stencils (gondolas, racks, wall racks, end
  caps, fridges, freezers, checkouts, counters, pallets, promo tables, zones, doors, walls, labels): add by click or
  drag, move by drag or arrows on a grid, rotate, resize, reorder, duplicate; link equipment to a planogram fixture
  (size from the fixture, a red "!" when its planogram has fit problems, double click / Enter opens it); the
  fixtures list with "place on plan"; area summary (floor, equipment footprint, free floor, zones, linked fixtures,
  shelf metres, items per kind) with overlaps, narrow aisles and items outside the walls; SVG / PNG and printing at
  1:50 / 1:100 / 1:200; several halls.

## Files

| file | contents |
|---|---|
| `index.html`, `store.html` | the pages (hidden anchors `#pg-plan`, `#pg-store` give the build the links between them) |
| `common.js` | shell, icons, fixture kinds, project model and persistence, versions storage, formatting, widgets, SVG → PNG, print sheets |
| `demo.js` | the demo: ~60 Georgian grocery products, five fixtures, two versions, the store plan |
| `importer.js` | CSV / XLSX / ODS reading, the column mapping dialog, merging into the library |
| `main.js` | the planogram page |
| `panels.js` | analytics and versions panels, readable diff lines |
| `store.js` | the store plan page |
| `strings.js` | UI strings in the 7 UI languages |
| `app.css` | layout of both pages and the print sheets |
| `e2e.js` | in-page scenario: demo, fit states, placing facings, overflow, undo / redo, drag and drop, versions compare, analytics |
| `server.js` | development server |

## Limits

- The project lives in one localStorage key (`pgs-project`; versions in `pgs-versions`); very large libraries
  (thousands of products) are better kept as JSON files.
- Product images are not supported; blocks are coloured. Shelves are flat (no slope, dividers or weight goods).
- Sales come from the product's daily sales; there is no sales history import.

## Targets

`OFFLINE_NOTICE.md` and `SINGLEFILE_OFFLINE_NOTICE.md` select `html@5_offline/` and `html@5_offline_singlefile/`.
Both are audited for zero network use: the pages work from `file://`.
