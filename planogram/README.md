# planogram/

Shelf planograms in centimetres: products with box dimensions and squeeze, fixtures holding shelves or pegboards,
positions with facings across / up / into the depth, rotations, the fit check per shelf and per fixture, automatic
depth facings, linear metres and shares of shelf space, capacity and days of supply, sales per metre, macro space,
version diffs and the front view as SVG. Pure ES modules: no DOM at module evaluation, they work in Node and in a
page. Ported from the retail platform's planogram editor (server routes and client copy of the fit check). Meant for a
Planogram Studio (`planogram-studio/`).

## Files

| file | contents |
|---|---|
| `model.js` | `effectiveDims(d, rot, turn)`, `effectiveSqueeze`, `hasDims`, `normalizeProduct`, `normalizePosition`, `normalizeShelf`, `normalizeFixture`, `defaultShelves(fixture, count)`, `normalizePlanogram(raw, now)`, `effectiveStatus(p, now)`, `productLookup(products)`, `ROTATIONS`, `TURNS`, `SHELF_KINDS`, `TYPES`, `STATUSES`, `TEMP_DAYS`, `LIMITS`, `round`, `newId` |
| `fit.js` | `checkShelves(shelves, products)` → `{ ok, warnings, shelves }`, `checkFixture(fixture, products)` (+ fixture codes, `totals`), `positionBox(p, product, shelf)`, `autoDepth`, `maxStack`, `autoDepthShelf(shelf, products, { stack })`, `maxFacings(shelf, products, index)`, `warningText(w, nameOf)` |
| `space.js` | `spaceBy(fixtures, products, by)` → `{ rows, total }`, `positionWidth`, `capacity(p)`, `productCapacity(fixtures)`, `daysOfSupply(units, dailySales)`, `supplyReport(fixtures, products, opts)`, `shelfMetrics(fixtures, products, sales)`, `macroSpace(space, sales, { threshold })`, `shelvesOf` |
| `diff.js` | `diffPlanogram(from, to, nameOf)` → `{ added, removed, changed, shelves }`, `isEmptyDiff` |
| `svg.js` | `frontLayout(fixture, products, opts)`, `frontSVG(fixture, products, opts)`, `keyColor(key)` |
| `test.js` | unit tests: `node planogram/test.js` (importing it runs nothing) |

## Model (model.js)

- Products: `width` / `height` / `depth` in cm (null when unknown), `squeeze: { x, y, z }` 0–50 % (soft packs can be
  pressed together: a tight fit is not an overflow), `category`, `brand`, `price`, `cost` (average purchase price),
  `dailySales`, `stock`, `caseUnits`, `color`. The old flat fields `squeeze_x` … are read too.
- A fixture has `width` / `height` / `depth`, a plinth (`base`) and shelves from top to bottom. A shelf has a board
  (`width`, `depth`, `thickness`) and a clearance `height`; `kind: 'peg'` is a pegboard with a hole `pitch`: every
  facing column hangs on its own hook, so widths round up to the pitch and packs hang from the top in the front view.
- A position: `productId` (`modelId` accepted), facings `fx` (across, 1–100), `fy` (stacked, 1–50), `fz` (rows into
  the depth, 1–50), `rot` 0 / 90 / 180 / 270 in the front plane (90 / 270 swap width and height) and `turn` 0 / 90
  (sideways: width ↔ depth, applied first). Squeeze turns with the pack. `ref` marks a unit of equipment on a shelf.
- Normalisers clamp instead of throwing. A fixture without shelves gets equal clearances over its height.
- Planogram types `main`, `alternative`, `sample`, `temporary` (expires in 3 days by default); statuses `draft`,
  `active`, `expired`, `archived`; a draft or active planogram past its date is `expired` without anyone changing it.

## Fit check (fit.js)

The layout fits when the sum of facing widths is within the shelf width, every stack is within the clearance and
every run of rows within the depth, all at the squeezed size. Results per shelf: `usedWidth` (nominal), `minWidth`
(squeezed), `squeezed` (fits only thanks to squeeze), `freeWidth`, `overflow`, `fill` %, `unknown`. Warning codes:
`too_wide` (shelf), `too_tall`, `too_deep`, `no_dimensions` (position; does not make `ok` false), and from
`checkFixture`: `fixture_too_tall` (plinth + boards + clearances), `shelf_too_wide`, `shelf_too_deep`.
`autoDepth` gives the rows that fit the depth (what a product added from the search gets), `maxStack` the packs that
fit the clearance, `maxFacings` the most width facings one position can take.

## Space and stock (space.js)

- `spaceBy` groups nominal widths by product, category, brand or any function: width, metres, share of the used width,
  facings, units, SKUs; totals give shelf metres, used metres and fill.
- Capacity is `fx × fy × fz` units. Days of supply = units on the shelves / daily sales; `supplyReport` marks `low`
  (below `minDays`, the replenishment cycle), `high` (above `maxDays`: space for faster sellers), `below_case` (the
  shelf cannot take a full case on top of the facings), `no_sales`.
- `shelfMetrics`: metres, quantity, revenue, gross profit (partial when products lack a cost), revenue and profit per
  metre, products on the shelves without stock.
- `macroSpace`: each group's share of shelf space against its share of sales and profit, the metres the sales share
  would give it, the gap and a verdict `over` / `under` / `ok` (±5 % by default).

## Versions (diff.js)

`diffPlanogram` compares two fixtures (or shelf lists): products added and removed, products that moved to other
shelves or changed their width facings or units, and shelves added, removed or resized. Shelf numbers are 1-based.

## Front view (svg.js)

`frontLayout` computes the drawing in cm: posts, boards and plinth, the clearance of each shelf, the overflow beyond
the shelf end (red; amber when squeezing makes it fit), product blocks of facing cells bottom-aligned on shelves (top
on pegboards) coloured by category / brand / product (`product.color` wins), and the legend. `frontSVG` draws it with
fitted names, `×fz`, a red dot for no stock, `?` for missing dimensions, red outlines on positions with warnings,
pegboard holes, shelf numbers, an optional title and legend; `data-shelf` / `data-pos` attributes let an editor hit
test blocks. The outer size is px (`scale` px per cm) or mm at a print ratio (`unit: 'mm', ratio: 10` = 1:10).
