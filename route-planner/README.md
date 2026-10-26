# Route Planner

Delivery and visit routes planned in the browser without online maps: stops from pasted coordinates or CSV, a visiting
order with pickup-before-delivery pairs (nearest neighbour + 2-opt / or-opt), distances and ETAs with time windows,
manual reordering, a schematic Web-Mercator map, a printable trip sheet and CSV / GPX / polyline exports. Built on
`geo/`, `csv/`, `units/`, `calendar/` and `ui/`.

```bash
node route-planner/server.js        # development server
node singlefile.js route-planner    # builds html@5_offline/ and html@5_offline_singlefile/
node check.js e2e route-planner/html@5_offline_singlefile/index.html route-planner/e2e.js
```

## Pages

- **Plan** (`index.html`):
  - Stops: paste lines (`name; lat, lng`, decimal commas, DMS, `geo:` / OSM / Google links, `09:00-12:00` windows) or
    import CSV (headers recognised in several languages: name, address, lat / lng or coordinates, window or from / to,
    service minutes, type pickup / delivery, pair; windows-1251 / UTF-16 files decoded). Editable table (cards on phones).
  - Settings: start (depot), end (return, open, or a fixed stop), departure, speed, road factor, service minutes.
  - Plan: optimised / as entered / manual order; entered vs optimised km; drag (pointer or touch) or ↑ / ↓ on the handle
    to reorder; warnings for broken pairs, late arrivals, stops without coordinates.
  - Map: SVG schematic with grid, scale bar, direction marks, pair links, collision-free labels, zoom / pan (mouse,
    touch, keys). Near Europe Square, Batumi it shows the small OSM fixture of `geo/fixture.js` with attribution.
  - Export: CSV, GPX 1.1 (waypoints + route), Google encoded polyline; `geo:` links per stop.
- **Trip sheet** (`sheet.html`, `#print` prints at once): title, date, driver, vehicle, totals, map, arrival / departure,
  windows, tasks, km, actual-time and signature columns.

Seeded demo: a depot and 11 stops in Batumi with two pickup → delivery pairs.

## Files

| file | contents |
|---|---|
| `index.html`, `sheet.html` | the pages (hidden anchors `#pg-plan`, `#pg-sheet` give the build the links) |
| `common.js` | shell, icons, state, demo, line / CSV parsing, plan and schedule, exports, map SVG |
| `main.js` | the plan page |
| `sheet.js` | the trip sheet |
| `strings.js` | UI strings in the 7 UI languages |
| `app.css` | layout, map, plan list, print sheet |
| `e2e.js` | in-page scenario |
| `server.js` | development server |

## Limits

Distances are straight lines × road factor, not streets. Time windows are checked, not optimised (`geo/route.js`
plans by distance only). The optimiser is O(n³) per pass: fine for tens of stops.

## Targets

`OFFLINE_NOTICE.md` and `SINGLEFILE_OFFLINE_NOTICE.md` select `html@5_offline/` and `html@5_offline_singlefile/`, both
audited for zero network use. State stays in local storage.
