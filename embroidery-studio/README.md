# Embroidery Studio (`embroidery-studio`)

A cross-stitch scheme site, chart viewer and editor for desktop and phones: a catalogue of schemes with search and
filters, scheme pages with the key, the shopping list and downloads (PDF, OXS, JSON, PNG, SVG, printing), a viewer that
remembers which stitches you have done, a full editor, and a converter from pictures to charts. Charts, threads,
symbols, pages and file formats are the [`stitch/`](../stitch/) library; colour science is [`color/`](../color/).

## Artifacts

Built from the NOTICE files (`node singlefile.js embroidery-studio`):

| artifact | what it is |
| --- | --- |
| `html@5_offline_singlefile/index.html` | everything in one file with no network code (`remote.offline.js`): built-in catalogue, viewer, editor, converter, exports; charts and progress in this browser |
| `html@5_serverless/` | a static site: the built-in catalogue plus a static catalogue published next to it (`catalog/index.json` and `catalog/<id>.json`, written by "My schemes → Publish") |
| `html@5_backend/` | `node server.mjs [port] [--host 0.0.0.0] [--data <dir>]` (Node ≥ 18): the community catalogue with uploads, a moderation queue (`#/admin`, token printed at start or `ES_TOKEN`), view / download counts and stitching progress kept per reader key |

Pages read `globalThis.IN_HTML_ARTIFACT.mode`. Development: `node embroidery-studio/server.js [port]` serves the
sources and mounts `backend.js` at `/api` (data in `embroidery-studio/.data/`, git-ignored).

## Screens (hash routes)

- **Catalogue** (`#/`): built-in original demo schemes, my schemes and (serverless / backend) the site's schemes; search
  by words, filters by category, size, number of colours and difficulty, sorting; thumbnails drawn from the charts.
- **Scheme page** (`#/s/<key>`): the picture, size in stitches and in centimetres for the chosen fabric count (11 to 28
  count), strands, the key sorted by stitch count with symbol, thread, name,
  stitches and skeins (blends written "code-code", two strands of each colour in the needle), the shopping list (blends
  split by half), equivalents in another brand, downloads, print, copy link, open in the viewer or editor, send to the
  site (backend), delete my copy.
- **Viewer** (`#/view/<key>`): modes symbols / colours with symbols / colours / tinted cells with bold symbols /
  realistic, high contrast and no-symbols switches, rulers and the 10-cell grid; tools move, mark stitched, unmark,
  parking marks; marking by tap, drag, rectangle or double tap on a colour region; highlight one colour (from the key or
  the cell menu), per-colour progress, overall percentage; keys 1–5 modes, V / M / U / P tools, G grid, R rulers, C centre, H highlight the colour under the pointer, F full screen. Progress
  stays in IndexedDB and, with a reader key on the backend, on the server.
- **Editor** (`#/edit/<key>`, `#/new`): cross, half, three-quarter, quarter and petite stitches, line, rectangle, ellipse,
  fill, backstitch and straight stitch, French knot, bead, eraser, selection with copy / cut / paste / mirror / rotate,
  eyedropper, text in the stitch fonts or any system font; the palette tab (thread picker with five brands, nearest
  threads, blends; symbol picker; merge, replace, sort, remove unused), layers, chart settings (size, fabric, crop,
  mirror, rotate); undo / redo, autosave.
- **Converter** (`#/convert`): picture → chart with live preview: size in stitches or centimetres, brand, number of
  colours, dithering, brightness / contrast / saturation, background removal, cleanup of lonely stitches, outlines as
  backstitch, symbols or letters (the most used colour can stay blank).
- **My schemes** (`#/my`): my charts and progress, import (JSON, OXS, pictures), ZIP backup and restore, publish as a
  static catalogue.
- **Moderation** (`#/admin`, backend): approve or reject uploads, remove published schemes.

A carpet sent from [Carpet Generator](../carpet-generator/) on the same site is offered as soon as the studio opens.

## PDF

A4, A3, A5, Letter or Legal, portrait or landscape; cover with the picture, size and statistics; the key and the shopping list;
chart pages with vector symbols (a Type 3 font, so symbols stay sharp and searchable), thick lines every 10 cells,
row / column numbers, page labels and a page map, an optional overlap (repeated rows and columns shaded); colour or
black-and-white. Labels in non-Latin scripts are drawn as image masks from the browser's fonts.

## What was taken from the design example

The example scheme site set the bar for features, not content (no texts, brand, pictures, scripts or schemes were
copied): a letters symbol mode with a blank most-used colour; tinted cells with bold symbols; the key sorted by stitch
count and a shopping list with blends split by half; blends written as two codes, two strands each; fabric count and
strands options that change the finished size; background removal in the converter; high-contrast and no-symbol
modes; printing on A4; OXS download for stitching apps; copy link and delete; pages of 10-cell blocks with row and
column labels; a scheme number and a note on where the charts are kept.

## Files

`main.js` routes and shell, `site.js` catalogue / scheme / my schemes pages, `catalog.js` sources, `demo.js` the
original demo schemes (generated from code), `viewer.js` + `progress.js` the viewer, `editor.js` + `pickers.js` the
editor, `converter.js`, `admin.js`, `common.js` exports and printing, `store.js` IndexedDB, `remote.js` /
`remote.offline.js` the server client, `backend.js` the API, `strings.*.js` UI strings in en, ru, uk, de, fr, es, ka.

## Checks

```
node check.js modules embroidery-studio
node check.js e2e http://127.0.0.1:8731/embroidery-studio/ embroidery-studio/e2e.js [--mobile --size 390x844] [--lang ru]
node check.js e2e embroidery-studio/html@5_offline_singlefile/index.html embroidery-studio/e2e.js
```

## Limits

- XSD (Pattern Maker) and PCStitch files are not read: no free specification or sample files to test against.
- OXS files follow the published structure; opening them in Pattern Keeper or other apps was not tried.
- Anchor, Madeira, Gamma and PNK Kirova colours come from their DMC equivalents in public tables (see
  [`stitch/README.md`](../stitch/README.md)), so they are approximate.
