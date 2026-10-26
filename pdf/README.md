# pdf/

A general PDF writer: pages in top-left coordinates, text in embedded TrueType fonts (subset, copyable and searchable,
Cyrillic and Georgian included) or the standard Helvetica / Courier, vector graphics, images, links, bookmarks,
metadata, and a simple layout engine (wrapping, alignment, tables over several pages). Compression is synchronous
(`../codec/zlib.js`), so the same code runs in a page, a worker and Node. Pure ES modules: no DOM at module
evaluation, no platform APIs. Fonts are bytes the application brings (a file input, a bundled asset); the library never
fetches anything.

## Files

| file | contents |
|---|---|
| `doc.js` | `PDFDocument` (`addFont`, `addStandardFont`, `setFont`, `addImage`, `addPage`, `bookmark`, `toBytes`), `Page` (`text`, `measure`, `line`, `polyline`, `polygon`, `rect`, `circle`, `ellipse`, `arc`, `path`, `image`, `link`, `save` / `restore`, `translate`, `scale`, `rotate`, `transform`, `clip`, `clipRect`), `PAGE_SIZES`, `pageSize`, `mm` / `cm` / `inch`, `parseColor`, `pdfText` |
| `ttf.js` | `parseTTF(bytes, { index })` (head, hhea, maxp, hmtx with its monospaced tail, cmap 4 / 12 / symbol, loca / glyf, composites, OS/2, post, name), `subsetTTF(font, gids)`, `glyphClosure`, `buildTTF(spec)` (synthetic fonts), `writeSFNT(tables)`, `tableChecksum` |
| `font.js` | `TrueTypeFont`, `StandardFont`, `shapeText(text, fonts)` (fallback stack), `measureText`, `lineMetrics`, `cleanText`, `fontList` |
| `layout.js` | `wrapText`, `textBox`, `clipText`, `fitText`, `Flow` (paragraphs, headings, rules, images, tables, page breaks, footers) |
| `path.js` | `parsePath(d)` (SVG path data → M / L / C / Z), `arcPath`, `ellipsePath`, `rectPath` (rounded), `polygonPath`, `pathOps`, `pathBounds`, `fmt` |
| `image.js` | `prepareImage(src)` (JPEG passthrough, PNG / RGBA → Flate + soft mask), `imageKind`, `jpegInfo` |
| `standard.js` | `STANDARD_FONTS`, `winAnsiCode`, `standardWidth`, `standardMetrics` |
| `inspect.js` | `inspectPDF(bytes)` (xref, stream lengths, Flate, pages, fonts, images, links, info, text through ToUnicode), `parseCMap`, `tokenize` |
| `pdf.js` | everything above in one import |
| `test.js` | unit tests: `node pdf/test.js` (importing it runs nothing) |

## Usage

```js
import { PDFDocument, Flow, textBox, fitText, mm } from '../pdf/pdf.js';

const doc = new PDFDocument({ title: 'Plan', lang: 'ka' });
const sans = doc.addFont(notoSansBytes), geo = doc.addFont(notoSansGeorgianBytes);
doc.setFont([sans, geo]);                         // each character goes to the first font that has it
const page = doc.addPage('A4', { landscape: true });
page.rect(mm(20), mm(20), mm(120), mm(80), { stroke: '#333', width: 2, fill: '#f4f1ea' });
page.path('M200 300 a40 40 0 0 1 40 40', { stroke: '#c33', fill: 'none', dash: [3, 2] }); // a door swing
page.text('სამზარეულო 12 მ²', 300, 200, { size: 10, align: 'center', baseline: 'middle' });
const bytes = doc.toBytes();                       // Uint8Array, ready for a Blob / a file
```

- Coordinates are points (1/72 in) from the top-left corner, y down, like SVG and canvas; the content stream flips
  once (`1 0 0 -1 0 H cm`), so transforms and paths need no conversion. `rotate(deg)` turns clockwise on the page.
- `text(s, x, y)` puts the baseline at `y`; `baseline: 'top' | 'middle' | 'bottom'` and `align: 'center' | 'right'`
  move the anchor; `rotate` turns the text about it. It returns the width. `wordSpacing` (used for justification)
  is written as TJ adjustments after space glyphs, because `Tw` does not apply to two-byte codes.
- Colours: `'#rgb'`, `'#rrggbb'`, `'#rrggbbaa'` (the alpha becomes opacity), a grey number 0..1, `[r, g, b]` or
  `[c, m, y, k]` in 0..1, `'none'`. Shapes fill black by default; `line`, `polyline` and `arc` stroke black.
- `toBytes()` is deterministic for the same drawing calls when `date` is given (trailer `/ID` is a hash of the body).

## Fonts

- Embedded fonts are Type0 / CIDFontType2 with `/Encoding /Identity-H` and `/CIDToGIDMap /Identity`: the page stream
  holds glyph ids, not character codes. The glyph → text map is written as a ToUnicode CMap (blocks of at most 100
  entries) so copy, search and screen readers get the real text — the tests extract the drawn text back.
- Subsetting keeps glyph ids: unused outlines are emptied, composites keep their components, `numGlyphs` shrinks to the
  highest used id + 1, `hmtx` / `loca` follow. The subset gets a six-letter tag (`ABCDEF+NotoSans-Regular`) derived
  from the used glyphs. A Noto Sans + Noto Sans Georgian page is ~15 KB instead of ~900 KB. `subset: false` embeds the
  whole file.
- `/W` lists only the used glyphs, consecutive ids grouped (`1 [635 586] 4 [537]`).
- `cmap` format 4 is read first and format 12 over it: Noto Sans Georgian has only format 4, so requiring 12 would
  lose Georgian. `hmtx` entries past `numberOfHMetrics` repeat the last advance (Noto Sans Georgian: 222 of 225).
- Fallback is by a missing glyph (`gid 0`), never by a Unicode range: a script nobody listed still finds its font.
  A character no font has stays visible (.notdef box, `?` in a standard font) instead of disappearing.
- An OS/2 `fsType` with only the restricted-licence bit makes `addFont` throw (`ignoreLicense: true` overrides).
- CFF OpenType (`OTTO`) is rejected with a clear message; `.ttc` collections are read with `{ index }`.
- No complex shaping (ligatures, kerning, contextual forms, bidi): right for Latin, Cyrillic, Greek, Armenian and
  Georgian; Arabic or Indic text would need a shaping engine first.

## Layout (layout.js)

- `wrapText` measures real widths (not character counts), keeps hard line breaks, and breaks a word wider than the
  line, preferably after a hyphen or slash. Lines carry `end` so justification leaves the last line of a paragraph.
- `textBox` draws into a box (`y` is its top), with `align` left / center / right / justify, `maxLines` or `height`
  with an ellipsis on overflow, and `valign` within `height`. `fitText` returns the largest size (by `step`) that fits a
  width and optionally a height: the big number on a price tag. `clipText` shortens a line with `…`.
- `Flow` is a cursor that moves down the page and opens new pages: `paragraph`, `heading` (kept with what follows),
  `rule`, `space`, `image`, `table`. Table cells wrap; a row that does not fit moves to the next page and the header row
  repeats there; `zebra`, `align` per column, `widths` as proportions. `header(page)` runs on every new page,
  `footer(page, i, n)` on every page at `finish()` when the page count is known.

## Images

JPEG files are embedded byte for byte (`DCTDecode`; grey, RGB, CMYK with the inverted `Decode` of Adobe files). PNG
files are decoded by `../png/` (any colour type, interlaced, 16-bit) and stored as Flate RGB or grey; transparency
becomes a soft mask (`/SMask`). `{ width, height, data }` RGBA pixels (a canvas `ImageData`) are stored the same way.
`page.image(img, x, y, w, h, { fit: 'contain' | 'cover' })` keeps the aspect ratio when asked.

## Inspection (inspect.js)

`inspectPDF` checks what a reader relies on: `startxref` → `xref`, every offset → `N 0 obj`, entries of exactly 20
bytes, `/Size` = entry count, page `/Count` = page objects, `/Length` → `endstream`, Flate data that inflates. It also
lists fonts (embedded, subset, ToUnicode), images, links, the Info strings (UTF-16 decoded) and the text of every page
through ToUnicode or WinAnsi. It reads classic xref tables only (no object or xref streams).

## Relation to other PDF code

`stitch/pdfdoc.js` (Type 3 symbol fonts for charts), `sample/pdf.js` and `garment/pdf.js` predate this library and
keep their specialised writers; new applications (floor plans, price tags, reports) use `pdf/`.
