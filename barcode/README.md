# barcode/

Barcodes of retail and logistics: GS1 numbers (GTIN, SSCC, GLN, ISBN / ISSN, in-store scale codes), Application
Identifiers, linear symbologies (EAN / UPC with add-ons, Code 128 / GS1-128, Code 39, Code 93, ITF / ITF-14,
Codabar), Data Matrix ECC 200 with GS1 DataMatrix, SVG / canvas drawing and a reader of linear codes in images. Pure ES
modules: no DOM at module evaluation, they work in Node and in a page. Used by the Barcode Studio (`barcode-studio/`).

## Files

| file | contents |
|---|---|
| `gtin.js` | `gs1CheckDigit(body)`, `completeCheck`, `hasValidCheck`, `inspectGtin(s)` → `{ kind, digits, gtin14, valid, expected, issue }`, `isValidGtin`, `toGtin14`, `shortestGtin`, `upcEToA` / `upcAToE`, `GS1_PREFIXES`, `gs1Prefix(gtin)` → `{ prefix, label, kind }`, `parseIsbn`, `isbn10Check`, `issnCheck`, `issnToEan` / `eanToIssn`, `SCALE_TEMPLATES`, `parseScaleCode(code, template)`, `buildScaleCode(template, { item, value, flag })`, `priceCheckDigit(value)` |
| `gs1.js` | the AI dictionary (`aiDefinition(ai)`, `allAIs()`, `PREDEFINED`, `predefinedLength`, `matchAI`), `gs1Date(yymmdd, now)`, `validateElement(ai, value)`, `interpret(ai, value)`, `parseGs1(input)`, `buildGs1(list, { order })`, `toDigitalLink(list, base)`, `parseDigitalLink(uri)`, `GS` |
| `linear.js` | encoders `ean13`, `ean8`, `upca`, `upce`, `ean2`, `ean5`, `code128`, `gs1_128`, `code39`, `code93`, `itf`, `itf14`, `codabar`; `encode(type, input, opts)`, `SYMBOLOGIES`, `symbology(key)`, `BarcodeError`; tables (`EAN_L` / `EAN_G` / `EAN_R`, `C128`, `C93`, `CODABAR`, `ITF_DIGITS`, `FULL_ASCII`), `code128Values(tokens, { start })`, `code128Check`, `code39Elements`, `symbolRuns(sym)`, `patternRuns` |
| `svg.js` | `barcodeLayout(sym, opts)`, `barcodeSVG(sym, opts)`, `drawBarcode(ctx, sym, opts)`, `barcodeCanvasSize`, `physicalSize(sym, xdim)`, `eanXdim(magnification)`, `NOMINAL`, `DEFAULT_FONT` |
| `datamatrix.js` | `dataMatrix(input, { gs1, shape, size })`, `matrixSVG(matrix, opts)`, `DM_SIZES`, `chooseSize`, `asciiCodewords`, `base256Codewords`, `padCodewords`, `addEcc`, `rsEncode`, `placement(nrow, ncol)`, `readCodewords(matrix, size)`, `decodeCodewords(cw)` |
| `decode.js` | `decodeRuns(runs, { types, leadingSpace, both })`, `scanImage(imageData, { lines, rotate, types })`, `luminance`, `lineRuns(line, threshold)`, `code128Text(values)`, `fullAscii39(text)`, `DECODABLE` |
| `test.js` | unit tests: `node barcode/test.js` (importing it runs nothing) |

## Numbers (gtin.js)

- The GS1 check digit weights the digits 3, 1, 3, … from the right; `inspectGtin` accepts GTIN-8 / 12 / 13 / 14 with
  spaces, hyphens or dots, reports the expected check digit and the 14-digit form.
- UPC-E ↔ UPC-A follows the four zero-suppression rules; `upcAToE` returns the canonical compressed form (several
  UPC-E numbers may expand to one UPC-A, the canonical one is the one a printer should use).
- `gs1Prefix` names the GS1 member organisation that issued the number (Georgia is 486), or the special ranges:
  restricted in-store / in-company numbers (`02`, `04`, `20`–`29`), coupons, refund receipts, ISSN (977) and ISBN /
  ISMN (978 / 979). GTIN-8 numbers starting with 0 or 2 are restricted.
- Scale codes: a template of 13 characters (`2XIIIIIWWWWWC`: fixed digits, a flag, the item, the value, the check
  digit; `V` places the GS1 price check digit of a 4- or 5-digit value).

## Application Identifiers (gs1.js)

- The dictionary covers the identification keys, dates, measures with implied decimals (`310n` … `336n`, `390n` …
  `394n`), ISO currency and country prefixes, the logistic and internal AIs. Each definition has its components
  (`N14`, `X..20`, `N3+N..15`), the predefined total length when it has one (no separator follows those elements),
  check-digit and date flags.
- `parseGs1` reads HRI `(01)…(17)…`, raw data with GS separators (also written `<GS>`, `{GS}`, `{FNC1}`, `␝`, `\x1d`),
  scanner output with a symbology identifier (`]C1`, `]d2`, `]Q3`, `]e0`, `]J1`) and Digital Link URIs. Every element
  gets its title, a decoded meaning (`date` with the GS1 century window and day `00` as the last day of the month,
  `number`, `currency`, `country`) and issues (`unknown`, `length`, `chars`, `check`, `date`); it never throws.
- `buildGs1` puts predefined-length elements first by default (`order: 'optimal'`) and returns the HRI text and the
  raw data with separators only where needed. `toDigitalLink` builds `https://id.gs1.org/01/…/10/…?17=…` with the
  key qualifiers in path order; `parseDigitalLink` accepts any host.

## Linear symbols (linear.js, svg.js)

- One model for every symbology: bars `{ x, w, guard? }` in modules, total width, recommended quiet zones, labels
  (EAN digit positions: the first digit left of the start guard, UPC-A / UPC-E number system and check digits in
  small type) and the add-on position. Two-width codes take `ratio` (wide : narrow, default 3, ITF-14 2.5, Codabar 2.5).
- EAN-13 / EAN-8 / UPC-A complete a missing check digit and reject a wrong one (`BarcodeError('check', { expected })`).
  Add-ons come from `opts.addon` or the input (`9780306406157 51299`), with a 9-module gap.
- Code 128 picks the shortest mix of sets A / B / C by dynamic programming over (position, set): set changes, SHIFT,
  FNC4 for Latin-1, FNC1 / FNC2 / FNC3. `fnc1: true` turns GS / `ñ` into FNC1. GS1-128 starts with FNC1 and separates
  variable-length elements with FNC1; its human-readable text is the HRI with parentheses.
- Code 39 checks its character set (or encodes full ASCII as pairs), optional mod-43 check character. Code 93 always
  has its C and K check characters and encodes full ASCII with its four shift characters.
- `barcodeSVG` draws in a viewBox of modules with the outer size in px or mm (`xdim`), so a print keeps the exact
  X-dimension; EAN guards extend into the digit line; ITF-14 gets a bearer frame; `widthReduction` compensates ink
  spread. `drawBarcode` paints the same layout on a canvas at a whole number of pixels per module.

## Data Matrix (datamatrix.js)

ASCII encodation (digit pairs, upper shift, FNC1), Base 256 for binary input or text that is shorter that way, the
24 square and 6 rectangular ECC 200 sizes, Reed-Solomon over GF(256) with the field polynomial 0x12D and interleaved
blocks, the annex-F module placement, and the finder (solid left / bottom) and clock (alternating top / right)
patterns of every data region. GS1 DataMatrix starts with FNC1 and uses FNC1 as the separator. `readCodewords` and
`decodeCodewords` read a matrix back (used by the tests: the ISO example `123456` gives 142 164 186 114 25 5 88 102).

## Reading (decode.js)

`decodeRuns` takes element widths and finds symbols of every decodable type in both reading directions: EAN-13 /
UPC-A, EAN-8 and UPC-E (guard checks, digits matched to the L / G / R width signatures, parity → first digit, check
digit) with EAN-2 / EAN-5 add-ons, Code 128 / GS1-128 (nearest pattern per character, check value, set tracking, FNC1
→ GS), Code 39 (three widest of nine elements; `checkOk` when the last character is a valid mod-43 check; full ASCII
reading), Code 93 (C and K), ITF / ITF-14 (two wide of five bars and five spaces; ITF-14 when 14 digits have a valid
check digit) and Codabar. `scanImage` samples rows and columns of an RGBA image, thresholds each line twice (the
middle of its 5th / 95th percentiles and a local mean), places edges with sub-pixel interpolation and votes the
results of all lines; results carry the number of agreeing lines, the orientation and the extent.
