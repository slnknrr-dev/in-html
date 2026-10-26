# sheets-processor/

**Sheets processor** — a spreadsheet tool that runs entirely in the browser and works offline (standalone class:
no network at all; the build fails on any network API). Open CSV / TSV / XLSX / ODS / JSON files, edit with formulas,
clean, sort, filter, summarize and chart data, and export it again. Files never leave the device.

Artifact: `html@5_offline_singlefile/index.html` (one self-contained file, built by `node singlefile.js
sheets-processor`). Development: `node sheets-processor/server.js`.

## Features

- **Open**: drop files on the page, pick them (Ctrl+O), or paste — files, a table copied from a spreadsheet or web
  page (HTML), or TSV / CSV text. CSV / TSV / TXT: encoding (UTF-8 / UTF-16 / windows-1251 / windows-1252), delimiter,
  quotes, header row and column types (numbers with decimal point or comma, percent, currency, dates in several
  orders, booleans) are detected; large files are parsed in slices with a progress bar. XLSX / XLSM / ODS: every
  sheet with formulas, number formats, basic styles, merged cells, widths, frozen panes, links, hidden sheets.
  JSON: an array of objects (keys become columns), an array of arrays, or an object holding one.
- **Grid**: virtualized (only visible cells exist; 100 000+ rows scroll smoothly; very tall sheets are scaled),
  frozen panes, sheet tabs (add, rename, duplicate, move, hide, delete), column type badges, resizable columns
  (double-click the edge to fit), keyboard navigation (arrows, Ctrl+arrows to data edges, Home / End, Page Up / Down,
  Tab / Enter, Shift to extend, Ctrl+A), touch selection, screen-reader announcements of the active cell.
- **Editing**: type into a cell (Enter mode: arrows commit and move) or press F2 / double-click (Edit mode); formula
  bar and name box (type `B3`, `A1:C9` or a sheet name); click cells while typing a formula to insert references;
  typed values become numbers, percents, dates, booleans or text (leading `'` keeps text); Delete clears;
  clipboard copy / cut / paste as TSV + HTML (formulas pasted from the grid itself move their relative references);
  bold, italic, number formats (General, number, thousands, percent, scientific, dates, time, text, custom codes),
  fill colours; undo / redo of everything (Ctrl+Z / Ctrl+Y).
- **Formulas**: the `formula/` engine — about 190 Excel functions including XLOOKUP, FILTER, SORT, UNIQUE (results
  spill), references across sheets, whole columns, automatic incremental recalculation, `#CIRC!` for cycles.
  Structural edits keep formulas pointing at the same cells (insert / delete rows and columns, sorting, renaming or
  deleting sheets).
- **Data tools**: multi-key sort (keeps the header row on top), per-column filters by condition (contains, equals,
  starts / ends with, greater / less, between, empty, top / bottom N) or by a list of values, find and replace (match
  case, whole cell, in formulas), remove duplicates (chosen columns, ignore case / spaces), split a column by a
  delimiter or regular expression, merge columns, clean text (trim, upper, lower, proper, invisible characters),
  convert types, insert / delete rows and columns, rename columns, use the first row as header, freeze panes,
  transpose into a new sheet, group by (count, distinct, sum, average, min, max, median, first, last) into a new
  sheet.
- **Insight**: status bar with count / sum / average / min / max of the selection, a column statistics panel (type,
  values, empty, distinct, min, max, sum, mean, median, standard deviation, text lengths, histogram, most frequent
  values) and charts of a selection (bars, lines, pie; legend for several series, tooltips; download as SVG or PNG).
- **Export**: XLSX (all sheets, formulas with cached values, formats, styles, merges, widths, frozen panes, header
  row in bold), CSV (delimiter, optional BOM for Excel, plain or displayed values), TSV, JSON (objects keyed by the
  header, ISO dates), HTML table, Markdown table — for the whole sheet, the filtered rows or the selection; copy as
  text or download.
- UI in English, Russian, Ukrainian, German, French, Spanish and Georgian; light and dark schemes; usable down to
  380 px (the toolbar scrolls, the statistics panel becomes a bottom sheet).

## Files

| file | contents |
|---|---|
| `index.html` | the page (shell from `ui/app.js`, stylesheets `ui/base.css`, `ui/app.css`, `app.css`) |
| `main.js` | page glue: empty state, toolbar, formula bar, tabs, status, grid adapter, editing, clipboard, shortcuts, file loading |
| `grid.js` | `Grid`: the virtualized grid component (rendering, selection, editor, resizing, keyboard, pointer / touch) |
| `model.js` | `Book`: sheets + view state (header, column widths / formats, filters, frozen panes), undo / redo, structural edits that keep formulas aligned; `newSheet`, `charsToPx`, `pxToChars` |
| `ops.js` | table operations without DOM: value ordering, sorting, filters, duplicates, split / clean / convert, group-by, statistics, histogram |
| `io.js` | import (CSV / TSV / JSON / XLSX / ODS / HTML tables) and export (CSV / TSV / JSON / HTML / Markdown / XLSX) |
| `dialogs.js` | menus and dialogs: sort, filter, find & replace bar, duplicates, split, merge, group by, export, charts, statistics panel |
| `chart.js` | SVG charts (bar, line, pie, histogram) with the validated categorical palette (light and dark steps) |
| `strings.js` | UI strings in the 7 languages |
| `app.css` | layout and grid styles |
| `server.js` | development server instance |

Libraries: `csv/`, `xlsx/`, `formula/`, `zip/`, `xml/`, `codec/`, `ui/`, `i18n/`.

## Limits

- One workbook at a time in memory (not saved in the browser); closing the tab asks first when there are changes.
- Fixed row height (wrapped text shows its first line); no cell borders, fonts or row heights; merged cells are kept
  in files but drawn as separate cells; no charts, images or comments are read from files.
- Formulas use `.` as the decimal mark and `,` (or `;`) between arguments, with English function names.
- Undo keeps the last 40 steps; structural steps snapshot the workbook (bounded to about 40 million cells).
- The test hook `window.sheetsApp` exposes the workbook for automated checks.
