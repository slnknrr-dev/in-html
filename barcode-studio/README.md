# Barcode Studio

Barcodes for shops, warehouses and offices, made and read in the browser without a network: retail EAN / UPC with
add-ons, GS1-128 and ITF-14 for logistics, GS1 DataMatrix, Code 128 / 39 / 93, ITF, Codabar and Data Matrix. Codes
are drawn at their true printed size, checked by reading them back, exported as SVG (in millimetres), PNG (at a DPI),
ZIP batches and label sheets, and scanned from images, the camera or a USB scanner. Built on `barcode/`.

```bash
node barcode-studio/server.js        # development server
node singlefile.js barcode-studio    # builds html@5_offline/ and html@5_offline_singlefile/
node check.js e2e barcode-studio/html@5_offline_singlefile/index.html barcode-studio/e2e.js
```

## Pages

- **Create** (`index.html`): a type picker grouped as retail, GS1 and logistics, general purpose and add-ons, and
  the content form of each type.
  - Check digits are completed and explained (expected vs typed).
  - EAN-13 has an in-store weight / price code builder: templates `2XIIIIIWWWWWC` and similar, including the GS1
    price check digit.
  - GS1 types have an element builder: an AI list with titles and formats, validation per row, and a field that
    reads pasted HRI, raw scanner data with GS separators or a Digital Link.
  - Details: number kind, GTIN-14, GS1 prefix (issuing country or the special ranges), UPC-E ↔ UPC-A, ISBN-10 / 13,
    ISSN, GS1 elements with decoded dates and measures, and the Digital Link.
  - Size: EAN magnification 80–200 % of X = 0.330 mm, or the X-dimension / module size and bar height in mm. Also
    text size, bar width reduction, quiet zones, ITF-14 bearer bars, and colours with contrast, inversion and
    red-ink warnings.
  - The preview keeps true proportions and shows the printed size. Every change is rasterised and read back with the
    built-in reader; Data Matrix is checked by reading its codewords back.
  - Exports: SVG in mm, PNG at 150–1200 dpi with whole pixels per module (the resulting X is shown), clipboard, and a
    print sheet of copies at true size.
- **Batch** (`batch.html`): many codes from a pasted list (`value<TAB>caption` or `value;caption`) or a sequence
  (prefix, start, step, count, zero padding, suffix; GTIN check digits completed). Every line is validated. Outputs: a
  preview grid, a ZIP of SVG or PNG files, a CSV report (formula-injection safe), and A4 label sheets with label size,
  columns, gaps, page margin, captions and cut lines. Codes that do not fit a label are scaled down, and the scale is
  reported.
- **Scan** (`scan.html`):
  - Sources: images (drop, paste, pick) or the camera (device choice, about 8 reads per second, pause on a result).
  - Readers: the browser's `BarcodeDetector` with every format it supports (including Data Matrix and QR), or the
    built-in reader of linear codes. The built-in reader votes over 40 scan lines in both directions, rows and columns.
  - Scanner input: a field for keyboard-wedge scanners that recognises GTINs, `]C1` / `]d2` / `]Q3` prefixes, GS
    separators typed as `<GS>`, element strings and Digital Links.
  - Results show the same explanations as the create page and open in the generator (`index.html#type=…&text=…`).
  - A local history keeps the last 30 codes.

## Files

| file | contents |
|---|---|
| `index.html`, `batch.html`, `scan.html` | the pages (hidden anchors `#pg-create`, `#pg-batch`, `#pg-scan` give the build the links between them) |
| `common.js` | the shell, icons, the studio type list, `makeSymbol(type, input, opts)` for linear and matrix codes, `symbolCanvas`, error texts, number explanations, scan history, widgets |
| `main.js` | the create page |
| `batch.js` | the batch page |
| `scan.js` | the scan page |
| `strings.js` | UI strings in the 7 UI languages |
| `app.css` | layout of the three pages and the print sheets |
| `e2e.js` | in-page scenario: every type renders and reads back, check digits, errors, GS1 paste, Digital Link |
| `server.js` | development server |

## Targets

`OFFLINE_NOTICE.md` and `SINGLEFILE_OFFLINE_NOTICE.md` select `html@5_offline/` and `html@5_offline_singlefile/`.
Both are audited for zero network use: the pages work from `file://`. Settings and the scan history stay in the
browser's local storage.
