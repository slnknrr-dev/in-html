# ascii/

Image → text art engine and writers. Pure ES modules: no DOM access, they work in Node and in a page. Input is an
RGBA image `{ data: Uint8ClampedArray | Uint8Array, width, height }` (for example a canvas `ImageData`).

## Files

| file | contents |
|---|---|
| `convert.js` | `convert(img, opts)`, `createConverter()`, `gridSize(w, h, opts)`, `DEFAULTS`, `COLOR_MODES`, `DITHERS`, `BAYER4`, `BAYER8` |
| `ramps.js` | `RAMPS`, `RAMP_IDS`, `rampCodes(opts)`, `rampSample(ramp, chars, order)`, `glyphCoverage(ch)`, `sortByDensity(s)`, `cleanChars(s)`, braille / block constants (`BRAILLE_BITS`, …) |
| `palette.js` | `ANSI16` (xterm), `CUBE_LEVELS`, `nearest16`, `nearest256`, `ansi256RGB`, `colorDistance` (redmean), `quantizeColors`, `hex`, `parseHex`, `luma` |
| `writers.js` | `toText`, `toANSI`, `toHTML`, `toHTMLPage`, `toSVG`, `inkColors`, `MONO_STACK` |
| `raster.js` | `drawGrid(ctx, grid, opts)`, `rasterSize(grid, opts)`: draws a grid on any 2D canvas context (PNG export) |

## Pipeline (`convert`)

1. **Grid**: `cols = columns`, `rows = round(cols · h / w / aspect)` (`aspect` = cell height ÷ width, ≈ 2). Each cell
   is 1 sample, 2 × 4 samples for braille, 1 × 2 for half blocks.
2. **Area-average resampling**: separable box filter with fractional coverage at the span ends; a fast path reads
   pixels as 32-bit words and checks opacity on the way; transparent images are averaged premultiplied and composited
   over `matte` (default: the background implied by `ink`).
3. **Tone**: luminance → optional auto levels (0.5 % … 99.5 %) → brightness → contrast → gamma (1024-entry table,
   also applied to the cell colours).
4. **Edges**: Sobel magnitude on the toned image; `edges` adds it as ink; `edgeGlyphs` draws `| / - \` where the
   magnitude passes `edgeThreshold`, chosen by the edge direction as seen on screen (cells are `aspect` times taller).
5. **Coverage**: tone or its inverse by `ink` (`'light'` glyphs on dark, `'dark'` glyphs on paper) and `invert`.
6. **Quantisation / dithering**: none, Floyd–Steinberg (serpentine) or ordered Bayer 4 × 4 / 8 × 8, to the ramp
   levels (or on / off for braille dots and half-block pixels).
7. **Glyphs**: ramp characters (sparse → dense); braille `U+2800 + bits` with dots 1, 2, 3, 7 in the left column and
   4, 5, 6, 8 in the right one (bits 0..7); half blocks `▀ ▄ █` (mono) or `▀` with fg = top / bg = bottom (colour).
8. **Colour** (`color` ≠ `'mono'`): per-cell average colour (braille: the raised dots); `target: 'fg'` colours the
   glyphs (`vivid` lifts them to a readable value), `'bg'` paints cell backgrounds with glyphs in a contrasting shade.
   `ansi16` / `ansi256` snap to the palette (perceptual redmean distance; 256 = 6 × 6 × 6 cube + 24 grays) and keep
   the indices, `html` uses 12-bit `#rgb`, `truecolor` keeps 24-bit colour.

Result: `{ cols, rows, codes: Uint32Array, chars: string[], fg, bg: Uint8Array RGB | null, fgIdx, bgIdx, color,
palette, ramp, ink, aspect }`. Ramps: `classic` ` .:-=+*#%@`, `detailed` (Paul Bourke's 70 levels), `short`,
`blocks` ` ░▒▓█`, `braille`, `half`, `custom` (`chars` with `order` `'auto'` (sorted by a measured coverage table of
printable ASCII), `'sparse'` or `'dense'` first).

`createConverter()` keeps its scratch buffers between calls (camera frames); returned grids own their arrays. A
1280 × 720 image converts to 160 columns in a few milliseconds.

## Writers

- `toText(grid)` — rows joined with `\n` (trailing newline).
- `toANSI(grid, { mode })` — `16` (SGR 30–37 / 90–97, 40–47 / 100–107), `256` (`38;5;n`), `'truecolor'`
  (`38;2;r;g;b`); default from the grid. SGR only where the colour changes (spaces keep the current one), a reset at
  the end of every coloured line. Mono grids give plain text.
- `toHTML(grid, { fg, bg })` — fragment for a `<pre>`: merged `<span style="color:…;background:…">` runs, escaped.
- `toHTMLPage(grid, { title, background, foreground, fontSize, lineHeight, fontFamily, lang })` — standalone document
  without external resources.
- `toSVG(grid, opts)` — background rect, cell backgrounds and block glyphs as crisp rects, one `<text
  xml:space="preserve" textLength>` per row with `<tspan fill>` runs.

## Limits

- Glyph geometry depends on the viewer's monospace font: braille and block elements fall back to other fonts where
  the first one lacks them. Custom characters wider than one cell (emoji, CJK) break the grid.
- The coverage table is an average of three fonts; `order: 'auto'` is an approximation.
- At most 1000 × 1000 cells.
