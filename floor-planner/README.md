# Floor Planner

Plans of flats, house floors, event halls and shops in metres, drawn in the browser without a network: rooms as
polygons or rectangles, outer walls, doors, windows and furniture from the `plan/` stencils, area and seat summaries
with overlap and aisle checks, guest seating for halls, and exports as SVG at a print scale, PNG, print and JSON.
Built on `plan/` (model, geometry, stencils, summaries, history, SVG).

```bash
node floor-planner/server.js        # development server
node singlefile.js floor-planner    # builds html@5_offline/ and html@5_offline_singlefile/
node check.js e2e floor-planner/html@5_offline_singlefile/index.html floor-planner/e2e.js
```

## Pages

- **Plan** (`index.html`): the editor.
  - Tools: select, pan, draw room (grid snap 5 / 10 / 25 / 50 cm, 15° angle snap, live segment length, lengths typed
    in metres + Enter, close on the first corner / double-click / Enter), outer walls (the page outline).
  - Objects by plan kind (flat: rooms, furniture; hall: round / long tables drawing one chair per seat, chair rows,
    stage, dance floor, bar; shop: racks, gondolas, fridges, freezers, checkouts). Click adds in the middle of the view,
    drag drops on the plan.
  - Selection by click, Shift-click, marquee, N / Shift+N; move, resize (8 handles, the opposite edge stays put also for
    rotated shapes), rotate (15° steps, Alt free), corner editing of polygon rooms (drag, add on an edge, double-click
    removes), duplicate, copy / paste, front / back, per-shape lock, layers (show, lock, rename, add) with their objects.
  - Inspector: label, X / Y / size / rotation, seats, ends of long tables, sleeping places and notes, room type, area,
    perimeter, wall lengths typed in (the following walls move up to the next parallel one), colour, layer.
  - Zoom and pan: wheel, pinch, buttons, keys (+ − 0, arrows); undo / redo of every edit (`plan/history.js`).
  - Summary: total, living (rooms and bedrooms) and service area, area inside the outer walls, rooms by type, seats and
    tables, sleeping places, all pages. Checks: overlaps, aisles under a minimum (chairs counted, pairs in different
    rooms ignored), items outside the walls; each warning selects its objects.
  - Templates: studio flat, two-room "Euro" flat, wedding hall for 120 guests, small shop; empty plans of each kind.
  - Export: SVG in millimetres at 1:20 … 1:500 with wall lengths, page size, scale bar and a title line; PNG at
    50 / 100 / 200 px per metre; print at a scale on A4 / A3 (or the largest scale that fits) with the room list; JSON
    save / open / drop anywhere (old seating charts and retail plans are read too).
- **Seating** (`seating.html`): a pasted guest list (`Name; table` seats at once), drag a guest onto a table of the plan
  or a table card, or pick a guest and then a table; seat the rest automatically, over-capacity warnings, undo / redo,
  CSV, and a printed seating chart (plan, tables with guests, A–Z index).

## Files

| file | contents |
|---|---|
| `index.html`, `seating.html` | the pages (hidden anchors `#pg-plan`, `#pg-seating` give the build the links) |
| `common.js` | shell, icons, the document (plan + guests + locks) and its storage, names, localized plan SVG, room dimensions, checks, exports (SVG, PNG, print) |
| `templates.js` | the four templates and empty plans |
| `main.js` | the editor |
| `seating.js` | the seating page |
| `strings.js` | UI strings in the 7 UI languages (stencil and room-type names included) |
| `app.css` | layout of both pages and the print sheets |
| `e2e.js` | in-page scenario: template, seats, add a table, undo / redo, area, SVG with the scale bar |
| `server.js` | development server |

## Targets

`OFFLINE_NOTICE.md` and `SINGLEFILE_OFFLINE_NOTICE.md` select `html@5_offline/` and `html@5_offline_singlefile/`,
both audited for zero network use. The plan, guests and settings stay in local storage (shared by both pages and tabs).

## Limits

No PDF export (print to PDF from the browser instead), no curved walls, no wall thickness or openings cut into walls
(doors and windows are placed on them), no automatic room detection from walls.
