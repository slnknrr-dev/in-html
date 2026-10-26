# Batumi Map

An offline vector map and street gazetteer of Batumi: the map is drawn in the page from embedded OpenStreetMap data
(no tiles, no network), with search of streets and addresses in Georgian, Latin and Russian. Built on `geo/`,
`lingua/translit.js`, `portal/text.js` and `ui/`.

```bash
node batumi-map/server.js        # development server
node singlefile.js batumi-map    # builds html@5_offline/ and html@5_offline_singlefile/
node check.js e2e batumi-map/html@5_offline_singlefile/index.html batumi-map/e2e.js
```

## Pages

- **Map** (`index.html`): SVG map (`geo/render.js`) with roads by class, water and the sea built from the coastline,
  parks, rail and street labels placed without overlap; pan and zoom by wheel, drag, pinch, buttons and keys (arrows,
  + / −, 0, Enter); a scale bar and the attribution always on screen; light and dark map styles.
  - Search: "Rustaveli", "rustavelis 10", "Руставели 10", "რუსთაველის 10", "на улице Горгасали", coordinates
    ("41.65, 41.63"). Every name, the national romanisation and a Russian transcription of the Georgian name are
    searched, tolerant to case and declension (`geo/tree.js` searchPlaces, `geo/address.js`). A missing house number
    offers the nearest ones on the same side.
  - The selected street is highlighted with its house points; a house-number field and buttons find an address.
  - A click on the map shows the coordinates (copy "lat, lng", a `geo:` link) and the nearest address.
  - Links: `#street=<id>`, `#house=<id>:<number>`, `#at=<lat>,<lng>[,<zoom>]`.
- **Streets** (`streets.html`): the alphabetical gazetteer with ka / en / ru names (Latin transliteration where OSM has
  no English name), address counts, a letter index, a filter in any script, links to the map, CSV exports of streets
  and addresses.

## Files

| file | contents |
|---|---|
| `index.html`, `streets.html` | the pages (hidden anchors `#pg-map`, `#pg-streets` give the build the links) |
| `common.js` | shell, icons, names by UI language, the decoded gazetteer and the search |
| `mapdata.js` | decoded map shapes, light / dark styles, Mercator world units |
| `main.js` / `streets.js` | the map page / the street list |
| `strings.js` | UI strings in the 7 UI languages |
| `app.css` | layout of both pages |
| `data-map.js`, `data-gazetteer.js` | GENERATED data (OpenStreetMap, ODbL) |
| `tools/build-data.js` | the data build |
| `e2e.js` | in-page scenario |
| `server.js` | development server |

## Data

`data-map.js` (~434 KB: land use, green, beach, water, sea, waterways, rail, roads by class, paths; no buildings;
lines simplified to 1 m, Google polylines of precision 5) and `data-gazetteer.js` (~142 KB: 535 streets, ~10 900
addresses) are built from Overpass answers of the KristinaHouse portal cache:

```bash
node batumi-map/tools/build-data.js <osm-cache dir>     # reads batumi-*.json and map-batumi-*.json, read-only
```

`addr:street` values are matched to street lines by exact name, key without generic words, cross-script skeleton
and Georgian case ending (all words and the street type must agree); unmatched ones are kept as address-only streets.
`BM_DEBUG=1` lists the fuzzy matches.

**Licence of the embedded data:** © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright),
source date 2026-08-23. The data files and the CSV exports are a derived database under the ODbL; the application
code and the map style are under the licence of this repository.

## Targets

`OFFLINE_NOTICE.md` and `SINGLEFILE_OFFLINE_NOTICE.md` select `html@5_offline/` and `html@5_offline_singlefile/`,
both audited for zero network use. The view, the query and settings stay in local storage.
