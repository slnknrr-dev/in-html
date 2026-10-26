# xlsx/

Spreadsheet files and cell basics: Office Open XML (`.xlsx`, `.xlsm`) reading and writing, OpenDocument (`.ods`)
reading, number formats, date serials and the workbook model shared with the formula engine (`formula/`) and the
Sheets processor. Pure ES modules over bytes (ZIP via `zip/`, XML via `xml/`); they work in Node and in a page.

## Files

| file | contents |
|---|---|
| `cells.js` | workbook model; `colName`, `colIndex`, `parseA1`, `formatA1`, `parseRange`, `formatRange`, `CellError`, `cellError`, `ERR`, `FILE_ERRORS`, `isError`, `isRich`, `cellValue`, `cellFormula`, `cellStyle`, `isBlank`, `getCell`, `usedSize`, `serialToMs`, `serialToDate`, `dateToSerial`, `localDateToSerial`, `ymdToSerial`, `serialParts`, `MAX_ROWS`, `MAX_COLS`, `DATE1904_OFFSET` |
| `numfmt.js` | `formatValue(value, code, opts)`, `formatGeneral(n)`, `formatKind(code)`, `isDateFormat(code)`, `formatColor`, `builtinFormat(id)`, `builtinId(code)` |
| `read.js` | `readXLSX(bytes) -> Promise<{ sheets, names, date1904 }>`, `decodeText` |
| `write.js` | `writeXLSX(book, { creator, title }) -> Promise<Uint8Array>`, `sheetName(name, taken)` |
| `ods.js` | `readODS(bytes) -> Promise<{ sheets, names, date1904 }>` |
| `ftext.js` | formula text in files: `fromFileFormula`, `toFileFormula` (`_xlfn.` / `_xlfn._xlws.` prefixes), `shiftFormulaText` (shared formulas), `fromODFFormula` (OpenFormula → A1) |
| `test.js` | unit tests: `node xlsx/test.js` (importing it runs nothing) |

## Workbook model

```
{ sheets: [{ name, rows: cell[][], cols?: [{ width (characters), hidden, fmt }], merges?: [{ r1, c1, r2, c2 }],
             freeze?: { rows, cols }, hidden? }], names?: [{ name, ref }], date1904? }
cell: null | number | string | boolean | CellError | Date (writers only) | { v, f?, s?, link?, sp? }
  f     formula text without '=' (A1 style, Excel function names, no _xlfn. prefixes)
  s     style { bold, italic, underline, strike, color: '#rrggbb', fill: '#rrggbb', fmt, align, wrap }
  link  hyperlink: URL, or '#Sheet!A1' for a place in the workbook
  sp    owner cell of a spilled array value (formula/engine.js)
```

Rows and columns are 0-based; dates are serial numbers of the 1900 system (serial 60 is the fictitious 1900-02-29,
as in Excel) shown through a date number format. Errors are interned `CellError` instances (`ERR.NA`, …): compare
with `===`.

## Reading XLSX

- Package relationships locate the workbook, worksheets, shared strings, styles and theme (absolute or relative
  targets, URL-escaped names, any part names).
- Sheet data and shared strings are scanned with a tag regexp (no tree for 100 000-row sheets); the rest of each part
  goes through `xml/xml.js`. Namespace prefixes (`x:c`) are accepted.
- Cell types `s` `str` `inlineStr` `b` `e` `d` `n`; rich-text runs are joined and phonetic runs (`rPh`) skipped;
  `_xHHHH_` escapes are decoded.
- Formulas keep their cached values; shared formulas are expanded by moving the master's relative references
  (`ftext.shiftFormulaText`); multi-cell array formulas keep only the master (the engine spills the result again);
  data-table formulas keep values only.
- 1904 workbooks: date-formatted numbers are moved to the 1900 system (ISO `t="d"` cells are absolute already).
- Styles: number formats (custom and built-in ids 0–58, East Asian date ids as ISO dates), bold / italic / underline /
  strike, font and solid fill colours (RGB, theme colours with tint read from the theme part, the legacy indexed
  palette), horizontal alignment and wrapping. Fonts, sizes, borders and conditional formats are not read.
- Merged cells, column widths and hidden columns, frozen panes, hyperlinks (external and in-workbook), hidden sheets,
  defined names (except built-in `_xlnm.*`).

## Writing XLSX

- Parts: `[Content_Types].xml`, package / workbook / sheet relationships, `docProps/core.xml` and `app.xml`,
  `xl/workbook.xml` (sheet order, active tab, hidden sheets, defined names, `calcPr fullCalcOnLoad="1"` so Excel
  recalculates on open), `xl/styles.xml` (deduplicated fonts / fills / number formats → `cellXfs`; the two required
  fills; built-in format ids reused), `xl/sharedStrings.xml`, one worksheet per sheet. Element order follows the
  schema sequences (`dimension`, `sheetViews` with the frozen `pane` and `selection`, `sheetFormatPr`, `cols`,
  `sheetData`, `mergeCells`, `hyperlinks`, `pageMargins`).
- Values: finite numbers (non-finite → `#NUM!`), shared strings (cut at 32 767 characters, `xml:space="preserve"` when
  needed, control characters as `_xHHHH_`), booleans, errors (engine-only `#CIRC!` / `#ERROR!` become `#VALUE!` on
  formulas), `Date` objects (serial + ISO date format), formulas with cached values (`t="str"` for text results);
  newer functions get their `_xlfn.` / `_xlfn._xlws.` prefixes; a formula whose array result spilled is written as an
  array formula over the spilled range with the values in place.
- A column's `fmt` is the default number format of its numbers; sheet names are made valid and unique (31
  characters, no `[]:*?/\`).
- Files written by `writeXLSX` were checked by reading them back and by converting them with LibreOffice (values,
  formulas and their results, styles, merges, widths, hidden sheets, links).

## Reading ODS

`content.xml` (and `settings.xml` for frozen panes): tables, repeated rows / columns (empty runs are skipped instead of
materialized; repeated content is capped at 100 000 rows × 1024 columns), floats, percentages, currencies, dates,
times (`PT12H30M`), booleans, strings (paragraphs, `text:s` spaces, tabs, line breaks, links), formulas
(`of:=SUM([.A1:.B2];[Sheet2.C3])` → `SUM(A1:B2,Sheet2!C3)`, whole columns / rows, `COM.MICROSOFT.` names), merged
cells, column widths from automatic column styles, hidden tables.

## Number formats

`formatValue` compiles a format code once (cache) into up to four sections with conditions (`[>=100]`), colours
(`[Red]`, reported by `formatColor`), literal text (`"…"`, `\x`), padding (`_x`), fills (`*x`, ignored), locale
currency tags (`[$€-407]`). Number sections: `0 # ?` placeholders, grouping, trailing-comma scaling, percent,
scientific / engineering (`##0.0E+0`), fractions (`# ?/?`, `# ?/8`); date / time sections: `y m d h s` (minutes vs
months from context), month and day names (English by default, or `opts.months` / `monthsShort` / `days` /
`daysShort`), `AM/PM` `A/P`, elapsed `[h] [mm] [ss]`, fractions of seconds; text sections with `@`. `General` uses
about 11 significant digits and E notation outside 1e-9 … 1e11, like Excel.

## Limits

- No `.xls` (BIFF), `.xlsb` or encrypted files; no charts, images, comments, data validation, conditional formatting,
  tables (structured references), pivot tables or row heights; ODS styles other than value types are not read; ODS is
  read only.
- Fonts, borders and per-cell font sizes are neither read nor written.
