# stitch/

Cross-stitch and embroidery charts: the scheme model, thread catalogues, image → scheme conversion, symbols, pages,
legends and skein estimates, and the file formats (JSON, OXS, PDF, SVG, PNG). Pure ES modules, importable in Node;
`render.js` draws on a Canvas 2D context the caller gives it and touches no DOM at import.

Used by `embroidery-studio/` (viewer, editor, scheme site) and `carpet-generator/` (knotting charts and cross-stitch
versions of carpets).

| file | contents |
| --- | --- |
| `model.js` | the scheme: cells on a fabric with full crosses, half / quarter / three-quarter / petite stitches, backstitch and straight-stitch lines, French knots, beads, layers, a palette of threads, blends (several threads in one needle) and beads; normalization of untrusted input, run-length JSON, usage counts, bounds, crop / resize / mirror / rotate, palette operations (add, remove, merge, replace, compact, sort) |
| `threads.js`, `threads-dmc.js`, `threads-xref.js` | catalogues: DMC (489: the classic range and the 2017 colours 01–35), Anchor, Madeira, Gamma, PNK Kirova; lookups, nearest threads by ΔE2000, cross-references between brands, blends, skein lengths |
| `convert.js` | image → scheme |
| `symbols.js` | 91 vector symbols (non-zero filled paths in a 100 × 100 box) and the letters alphabet; assignment |
| `estimate.js` | thread length per stitch, legend rows, skeins, the shopping list, fabric size with margins, statistics and difficulty |
| `pages.js` | page capacity of a paper size, page splitting with overlap, page map |
| `oxs.js` | OXS (Open Cross Stitch XML) read / write |
| `pdfdoc.js` | a small PDF writer: Flate streams, standard fonts with WinAnsi text and metrics, Type 3 fonts from vector paths, images and image masks, transparency, a structural inspector |
| `pdf.js` | printable chart PDF: cover, legend and shopping list, chart pages |
| `image.js` | SVG chart, PNG chart (own rasterizer), colour preview |
| `render.js` | canvas drawing of charts: symbols, colours, colours with symbols, tints, realistic stitches; grid, highlight, stitched marks, parking, selection, pages, centre; rulers |
| `edit.js` | editing operations: lines, rectangles, ellipses, flood fill, clips (copy, cut, paste, mirror, rotate), text, history |
| `font.js` | stitch fonts: 'pixel' 5 × 8 (Latin, Cyrillic) and 'small' 3 × 5 |
| `test.js` | unit tests: `node stitch/test.js` (also `node check.js tests stitch`) |

## Scheme model

```js
{ format: 'in-html-stitch', version: 1, id,
  meta: { title, designer, description, category, tags, difficulty (0 auto, 1..5), license, notes, source, created, updated },
  width, height,                                   // stitches
  fabric: { kind: 'aida' | 'evenweave' | 'linen' | 'canvas' | 'rug', count, countY, over, color, name },
  palette: [{ id, catalog, brand, code, name, hex, symbol, strands, bsStrands, kind: 'thread' | 'bead' | 'metallic',
              blend?: [{ catalog, brand, code, name, hex, strands }] }],
  layers: [{ id, name, visible, locked,
             cells: Uint16Array (palette index + 1),          // full crosses; JSON: run-length text "3*0,2*5,1"
             parts: [{ x, y, k: 'half' | 'quarter' | 'three' | 'petite', c: '/' | '\\' | 'tl' | 'tr' | 'bl' | 'br', p }],
             lines: [{ x1, y1, x2, y2, p, k: 'back' | 'straight' }],   // cell units, half steps
             knots: [{ x, y, p }], beads: [{ x, y, p }] }] }
```

A three-quarter stitch at corner `c` is a half stitch on the diagonal that does not touch `c` plus a quarter stitch
from `c` to the centre: it fills the triangle on `c`'s side, so two of them (opposite corners) share a cell. A quarter
fills its corner, a petite is a small cross in it. `addPart` replaces the stitches a new one overlaps.

## Thread catalogues

DMC publishes no RGB values. DMC colours come from public colour tables (the classic range as listed by
threadcolors.com; the 2017 colours 01–35 from a public conversion chart). The other brands are built from public
cross-reference tables (DMC ↔ Anchor from a shop's conversion chart; Gamma / DMC / Madeira / PNK Kirova and Madeira /
Gamma / DMC / Anchor from Russian shops' correspondence tables): each thread takes the colour of its DMC equivalents
(averaged in CIELAB when there are several; exact equivalents win over "nearest" ones). So Anchor 403 is DMC 310's
black, Gamma 0420 too. Catalogue sizes: DMC 489, Anchor 465, Gamma 518, Madeira 316, PNK Kirova 268 — the threads
the tables cover. Skein lengths: DMC, Anchor, Gamma 8 m; Madeira, PNK Kirova 10 m; 6 strands.

`crossReference(thread, brand)` lists the table equivalents first and then the nearest colours by ΔE2000.

## Image → scheme (`convert.js`)

1. Target size by stitch count (the other side from the aspect ratio) or by finished size and fabric count; optional
   crop.
2. Area resampling in linear light, weighted by alpha; brightness, contrast, saturation, gamma.
3. Background: transparent pixels, and for `auto` (the most common border colour) or a chosen colour the region of
   that colour connected to the border within a ΔE tolerance, stay unstitched.
4. Candidates: the catalogue (or chosen threads); with `blends`, pairs of the 36 most used threads 3–22 ΔE apart, mixed
   in linear light (a small ΔE penalty keeps single threads preferred).
5. Every cell to its nearest candidate (ΔE76 pre-selection of 6, then ΔE2000; cached by rounded Lab).
6. Greedy reduction to N colours: repeatedly drop the colour whose stitches would move least (count^0.75 × ΔE to the
   nearest remaining colour — the exponent keeps small, distinct details such as eyes).
7. Refinement: each kept colour is replaced by the thread nearest to the centre of its cells when that is closer.
8. Mapping with dithering: none; Floyd–Steinberg serpentine in Lab (error clamped, strength); ordered — pattern
   dithering between the two nearest threads by the cell's position on the segment between them, Bayer 8 × 8.
9. Confetti clean-up: level 1 isolated stitches take the most common neighbouring colour; level 2 also stitches with
   one equal neighbour, background specks and holes; level 3 also regions under 4 cells (or `minRegion`).
10. Outlines: cell borders between colours at least `outlineThreshold` ΔE apart (and around the background) become
    backstitch runs in the darkest thread (or a chosen one) on a "Backstitch" layer.
11. Palette ordered by use, symbols assigned (distinct families for similar colours).

## Symbols

Vector symbols are paths in a 100 × 100 box filled with the non-zero rule (outer contours clockwise, holes
counter-clockwise); the same path is a canvas `Path2D`, an SVG `<path>` and a glyph of the PDF's Type 3 font (with a
ToUnicode map to look-alike characters, so text extraction and chart readers see one character per stitch).
The letters alphabet uses only characters every PDF standard font has (no 0/O, 1/l/I look-alikes), then
two-character codes. `assignSymbols` gives frequent colours the simplest symbols, avoids one family for colours closer
than 12 ΔE, can keep existing symbols and leave the most used colour blank (as printed charts do for backgrounds).

## Estimates

Thread per stitch for every strand: a cross is two diagonals on the front and about two cell sides on the back,
(2√2 + 2)·s with s = 2.54 cm / count; a half (√2 + 1)·s, a quarter ≈ (√2/2 + 0.6)·s, a three-quarter ≈ (1.5√2 + 1.6)·s,
a petite like a half at half size; backstitch 2.5 × its length, straight stitch 2 ×, a French knot 3 cm, a bead two
cell sides. 20 % waste by default (tails, travel). Skeins = ⌈length / (skein metres × 6 strands)⌉; a blend uses one
strand of each thread and its share goes to each thread in the shopping list. 2000 crosses on 14-count Aida with two
strands ≈ 0.88 of a DMC skein with waste. Fabric size adds a margin on every side (5 cm by default). Difficulty (1–5)
combines colours, confetti, fractional stitches, colour changes per row, size, blends and backstitch.

## OXS

`<chart>` with `<properties>` (size, title, author, copyright, instructions, stitches per inch), `<palette>` (index 0
is the cloth; `number` = "BRAND code"; `symbol` = decimal code point; blends as `[+]`-joined numbers and names with a
`blendcolor` and `<blend>` children), `<fullstitches>`, `<partstitches>` (direction 1 = cell split on "\" with the
bottom-left / top-right three-quarter stitches, 2 = split on "/" with top-left / bottom-right, 3 = half "/", 4 = half
"\"), `<backstitches>` (`backstitch` / `straightstitch`, half-cell coordinates), `<ornaments_inc_knots_and_beads>`
(`knot`, `bead`, `quarter` with `petit`, `tent` halves). Layers are flattened on export. Reading accepts Ursa-style
blends and tent stitches written by other programs.

## PDF

Vector charts: cell fills are rectangles, symbols are glyphs of an embedded Type 3 font, letters and numbers are
Helvetica (standard fonts, not embedded). Pages: a cover (title, designer, preview, size, finished size, fabric with
margins, colours, stitches, difficulty, page map), the key (symbol on its colour and on white, number, name, strands,
stitch counts by kind, backstitch length, skeins) and the shopping list, then chart pages (thin cell lines, thick
lines every ten cells counted on the whole chart, row / column numbers on all sides, centre arrows, shaded overlap
bands, part stitches as shapes with half-size symbols, backstitch, knots and beads, a page map in the header).
Styles: `symbols` (black on white), `color` (symbols in black or white on the thread colour), `tint` (symbols on a pale
tint), `blocks` (colour only). Labels in scripts the standard fonts lack go through `rasterText` (the browser
rasterizes them into 1-bit image masks) or are transliterated.

## Limits

- Thread colours are approximations; derived brands share DMC's colours, so brand-to-brand cross-references mostly
  reproduce the tables.
- No reader for proprietary binary formats (Pattern Maker .xsd, PCStitch .pat, WinStitch .chart): their layouts are
  undocumented and there are no test files here; OXS is the interchange format those programs export.
- The Type 3 symbol font is not a TrueType font: PDF readers and chart apps render and extract it, font editors do not.
- PNG letters use the 5 × 8 stitch font, not Helvetica.
