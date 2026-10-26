# plan/

Floor plans in metres for flats, halls and shops: one model (pages with an optional polygon outline, layers and
shapes from a stencil library), polygon measures, snapping, rotation, resizing, hit tests, fit-to-view, seat / area /
sleeping-place summaries, overlaps and narrow aisles, an undo history of JSON snapshots and SVG output with dimension
labels and a scale bar. Pure ES modules: no DOM at module evaluation, they work in Node and in a page. It unifies the
retail platform's floor-plan editor (centimetre outlines with equipment, zones, labels and doors) and the portal's
plan model (metres, stencils for halls, floors and furniture). Meant for a Floor Planner (`floor-planner/`).

## Files

| file | contents |
|---|---|
| `geom.js` | `polygonArea`, `isClockwise`, `perimeter`, `edgeLengths`, `edgeMidpoints`, `centroid`, `pointInPolygon`, `rectOutline`, `moveVertex` / `insertVertex` / `removeVertex`, `snap`, `snapPoint`, `snapAngle`, `normAngle`, `rotatePoint`, `handleAngle`, `center`, `corners`, `shapeBox`, `toLocal` / `toPlan`, `hitShape`, `pick`, `inRect`, `resizeCorner`, `resizeHandle`, `bounds`, `fitView`, `zoomAt`, `screenToPlan`, `mm`, `dist`, `segDist` |
| `stencils.js` | `STENCILS`, `GROUPS`, `defineStencil(key, spec)`, `stencil(key)`, `palette(kind)`, `shapeArea(sh)`, `label`, `sub`, `placesText`, `esc`, `color`, `num` |
| `model.js` | `normalizePlan(raw)`, `normalizePage`, `normalizeShape`, `normalizeLayers`, `fromSeating(seat)`, `fromRetailPlan(rp)`, `toRetailPlan(page, grid)`, `makeShape(key, x, y)`, `addShape`, `removeShapes`, `updateShape`, `moveShapes`, `duplicateShape`, `reorder`, `visibleShapes`, `isLocked`, `KINDS`, `DEFAULT_LAYERS`, `PAGE_MAX`, `SHAPE_MAX`, `SIZE_MAX`, `newId` |
| `summary.js` | `seatSummary(page)`, `areaSummary(page, { service })`, `sleepSummary(page)`, `roomPlaces(plan, roomKey, except)`, `contains(room, sh)`, `shapesInRoom`, `overlaps(page)`, `narrowAisles(page, min)`, `outsidePage(page)`, `polygonGap`, `isSolid`, `SERVICE_ROOMS` |
| `history.js` | `createHistory({ limit })` → `{ push, undo, redo, canUndo, canRedo, size, revision, changedSince, clear }` |
| `svg.js` | `pageSVG(page, opts)`, `planCss()`, `rulerSvg`, `dimensionsSvg(pts)`, `scaleBarSvg(x, y, len)`, `niceLength(max)` |
| `test.js` | unit tests: `node plan/test.js` (importing it runs nothing) |

## Model (model.js)

- Units are metres everywhere. Percent layouts keep a composition on any screen and exactly for that reason cannot
  answer whether a table fits between two columns; the screen is just a `viewBox`, computed once at drawing time.
- `{ v: 1, kind: 'floor' | 'hall' | 'shop', grid, pages: [{ id, name, w, h, outline?, layers?, floor?, roomType?,
  shapes }] }`. The kind picks the palette and defaults, not another program: a seating chart and a flat layout are
  the same model.
- A shape is `{ id, kind, x, y, w, h, rot }` (top-left corner, rotation in degrees about the centre) plus what its
  stencil allows: `label`, colours, `seats` (only on seated stencils: seats on a wall would inflate the capacity),
  `roomKey` / `roomType` and `pts` (polygon rooms, in the shape's own coordinates) on rooms, `places` / `note` on
  sleeping furniture, `ref` (an equipment unit, a planogram fixture), `layer`, `mine` (set by a guest-page renderer).
- The array order is the drawing order. Layers (when a page has them) group shapes; `visibleShapes` draws visible
  layers in layer order, `isLocked` tells an editor not to move a shape.
- Every value is clamped and rounded to millimetres (a mouse drag otherwise writes `3.2000000000000006`).
- `fromSeating` converts the old percent chart (table centres in % of a frame) assuming a 16 × 10 m hall;
  `normalizePlan` does this by itself. `fromRetailPlan` / `toRetailPlan` convert the retail editor's centimetre plans:
  equipment ↔ `rack` with `ref`, zone ↔ `zone`, label ↔ `text`, door ↔ `door`.

## Geometry (geom.js)

Polygon helpers build on `garment/geom.js` (shoelace area, containment). `resizeCorner` keeps the top-left corner in
place for a rotated shape (the new centre is recomputed along the rotated axes); `resizeHandle` moves the origin for
west / north handles so the opposite edge stays, with `keepRatio` for round tables and doors. Rotation handles snap to
15° (`handleAngle`, step 0 = free). Flat shapes get a 20 cm grab band in `hitShape`; `pick` takes the topmost shape.
`fitView` fits bounds into a pixel view with a margin, `zoomAt` zooms about the pointer, `screenToPlan` maps pixels
back for a `xMidYMid meet` viewBox.

## Stencils (stencils.js)

Each kind is a registry record with a `draw(sh, w, h)` returning the inside of a translated, rotated `<g>`:
basic (rectangle, ellipse, text, line, arrow); hall (round and long tables drawing one chair per seat, rows of chairs,
stage, dance floor, bar, entrance, decor); floor (rooms with the area computed from the geometry, walls, doors drawn
with their swing, windows, stairs, bathroom, kitchen, balcony, bedroom, hallway, storage); furniture (single, double
and bunk beds, sofa, armchair, crib with their sleeping places; wardrobe, tables, chairs, kitchen units, stove, fridge,
sink, toilet, bathtub, shower, washer, TV); shop (rack in 1 m sections, two-sided gondola, wall rack, end cap, upright
fridge with doors, chest freezer, checkout, service counter, pallet, promo table, basket stand, column, zone).
`defineStencil` adds more. Labels and colours pass through `esc` and a colour allowlist: plan JSON is user content.

## Summaries (summary.js)

Seats and tables per page; room areas per type with living and service rooms apart and the outline area; sleeping
places of the page or of one room (furniture whose centre lies in the room shape, minus nooks listed in `except`);
overlapping solid items by the separating axis test on rotated rectangles; pairs closer than an aisle width; items
with a corner outside the outline.

## SVG (svg.js)

`pageSVG` draws the floor (rectangle or outline) under an optional grid, the walls of the outline, the shapes with
`data-sh`, `data-room` and `data-ref`, classes `on` (selected), `hl` (highlighted rooms), `kg-has` (clickable rooms),
`me` (the guest's own table), optional edge lengths (`dims`), page size (`ruler`) and a scale bar of a round length
(`scale`). The outer size is free for CSS, `pxPerMetre`, or millimetres at a print scale (`unit: 'mm', ratio: 100`
for 1:100). `planCss()` is inserted once per document.
