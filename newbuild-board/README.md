# Newbuild Board

The sales board of a new-build residential complex for a developer or an agent, offline in the browser: the
"chessboard" of every building (sections × floors × units) coloured by sale status or by a price-per-m² heat scale,
filters, unit cards with the layout summary and history, bulk price and status changes, statistics, unit tables
imported from CSV / XLSX, mortgage schedules and printable price lists. Money is kept in integer minor units. Built on
`estate/`, `ledger/`, `csv/`, `xlsx/` and `plan/`.

```bash
node newbuild-board/server.js        # development server
node singlefile.js newbuild-board    # builds html@5_offline/ and html@5_offline_singlefile/
node check.js e2e newbuild-board/html@5_offline_singlefile/index.html newbuild-board/e2e.js
```

The demo is a two-building complex in Batumi: 16 floors, two sections of three units per floor, six layout types,
prices in US dollars (as developers there quote them) with lari shown through a hand-entered rate.

## Pages

- **Board** (`index.html`): every building as a grid (floors from the top, risers lined up per section by
  `estate/chessboard.js`), coloured by status (available / reserved / sold / not for sale, each also told apart by the
  border style) or by price per m². The board scrolls horizontally inside its card; arrow keys, Home and End move
  between units.
  - Filters: rooms, area, floor, view, price, status; units that do not match are dimmed.
  - Unit card: building, section, floor, area, view, price, price per m², lari, the room summary and layout kind of
    its layout type (`estate/rooms.js`, Euro n+1 words from `estate/scales.js`), a schematic sketch (`plan/`), a quick
    mortgage estimate with a link to the calculator, status and price editing, the history.
  - Bulk change of the filtered units (optionally only available ones): price by a percentage, price per m² × area, or
    status; rounded to a step, confirmed, written to every unit's history, undoable.
  - Statistics: sold share of units for sale, revenue, reserved and available stock, average per m²; tables by room
    count and by building.
- **Import** (`import.html`): paste a table or drop CSV / TSV / XLSX. Flat, floor, area, rooms, price, price per m²
  and status are sniffed by `estate/table.js`; building, section, view, layout and currency by `csv/mapping.js` with
  the app's own synonyms. The mapping can be fixed per column; the preview shows new / updated / unchanged units and
  problems by line. Merge (only the file's columns overwrite) or replace; CSV exports of all or available units.
- **Mortgage** (`mortgage.html`): a unit of the board (`#unit=<id>`) or any price; down payment, term, nominal rate
  (0 % = interest-free instalments), annuity or differentiated schedule from `estate/mortgage.js` (the principal parts
  sum to the loan exactly), both compared, affordability from a monthly income, the schedule by month or year, CSV and
  print.
- **Complex** (`complex.html`): names in English / Russian / Georgian, slug, address, developer, currency, the GEL
  rate; buildings with a ready-by quarter and handover date; a new building generated as floors × units
  (`unitGrid`); the printable price list of a building; JSON backup and restore, the demo, an empty project.

## Files

| file | contents |
|---|---|
| `index.html`, `import.html`, `mortgage.html`, `complex.html` | the pages (hidden anchors `#pg-*` give the build the links between them) |
| `common.js` | shell, icons, the project model and its checks, storage, filters, money and the GEL rate, layout info and sketch, widgets |
| `demo.js` | the seeded Batumi demo |
| `board.js`, `importer.js`, `loan.js`, `info.js` | the four pages |
| `strings.js` | UI strings in the 7 UI languages |
| `app.css` | layout, board cells, print sheets |
| `e2e.js` | in-page scenario: demo, filters, unit card, bulk +3 % for floors ≥ 10 and undo, mortgage schedules sum to the loan |
| `server.js` | development server |

## Targets

`OFFLINE_NOTICE.md` and `SINGLEFILE_OFFLINE_NOTICE.md` select `html@5_offline/` and `html@5_offline_singlefile/`,
both audited for zero network use. The project stays in the browser's local storage (`nb-project`); several open
pages follow each other's changes.

## Limits

Up to 2000 units and 40 buildings per project. The GEL rate is typed by hand. The layout sketch is schematic (room
areas are true, shapes are not). Mortgage figures are estimates, not bank offers.
