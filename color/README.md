# color/

Colour science for the applications: conversions after CSS Color 4, CSS parsing and serialization, colour
differences and text contrast, colour-vision-deficiency simulation, palette generation and palette file formats.
Pure ES modules, no DOM, importable in Node (`node -e "import('./color/space.js')"`).

| file | purpose |
|---|---|
| `color.js` | small helpers of the document editors: CSS colour allowlist, WCAG contrast of hex / `rgb()`, accent text colour and dark-mode accent |
| `space.js` | colour spaces, conversions, gamut checks, CSS Color 4 gamut mapping |
| `css.js` | CSS colour parsing / formatting, the 148 named colours, nearest named colour |
| `metrics.js` | ΔE76, ΔE2000, ΔEOK, WCAG 2 contrast and levels, APCA Lc |
| `cvd.js` | protanopia / deuteranopia / tritanopia / achromatopsia simulation with severity |
| `palette.js` | harmonies, 50–950 scales, seeded random palettes, k-means++ image palettes, hue families |
| `swatches.js` | CSS / SCSS / DTCG tokens / Tailwind / GIMP `.gpl` / Adobe `.ase` / SVG sheet exporters, text + `.ase` importers |

## Colour objects (`space.js`)

A colour is `{ space, coords: [a, b, c], alpha }`. Coordinates follow CSS conventions:

| space | coordinates |
|---|---|
| `srgb`, `srgb-linear`, `display-p3`, `display-p3-linear` | 0..1 per channel (out of range = out of gamut) |
| `xyz-d65` (alias `xyz`), `xyz-d50` | Y of the reference white = 1 |
| `lab` / `lch` | CIELAB with the D50 white (as CSS `lab()`): L 0..100; LCh hue in degrees |
| `oklab` / `oklch` | L 0..1; hue in degrees |
| `hsl`, `hwb`, `hsv` | hue in degrees, other components 0..100 |

The matrices are the ones of the CSS Color 4 sample code (rational sRGB / display-p3 matrices, Bradford D65↔D50,
the re-derived OKLab matrices); the sRGB transfer curve is extended to negative values. `convert()` walks a small
graph rooted at XYZ D65 through the closest common ancestor, so `srgb → hsl` never leaves sRGB.

- `convert(color, space)`, `convertCoords(coords, from, to)`, `color(space, coords, alpha)`, `spaceId(name)`
- pairwise functions: `srgbToLinear`, `linearToSrgb`, `linSrgbToXyz`, `xyzToLinSrgb`, `linP3ToXyz`, `xyzToLinP3`,
  `xyzD65ToD50`, `xyzD50ToD65`, `xyzToOklab`, `oklabToXyz`, `oklabToOklch`, `oklchToOklab`, `xyzD50ToLab`,
  `labToXyzD50`, `labToLch`, `lchToLab`, `srgbToHsl`, `hslToSrgb`, `srgbToHwb`, `hwbToSrgb`, `srgbToHsv`, `hsvToSrgb`
- sRGB shortcuts: `srgbToXyz`, `xyzToSrgb`, `srgbToOklab`, `oklabToSrgb`, `srgbToOklch`, `oklchToSrgb`,
  `srgbToLab`, `labToSrgb`, `oklchToSrgbMapped` (gamut-mapped); `to255`, `from255`, `toLinear`, `fromLinear`
- gamut: `inGamut(colorOrRgb, gamut = 'srgb', eps)`, `clip(rgb)`, `gamutMapCoords(color, gamut)`,
  `toGamut(color, gamut)` — the CSS Color 4 algorithm: binary search on OKLCH chroma with lightness and hue kept,
  a clipped candidate within ΔEOK 0.02 (the JND) of the target ends the search; `maxChroma(L, H, gamut)`

## CSS (`css.js`)

- `parseCSS(text)` → colour object or `null`: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`; `rgb()` / `rgba()` (legacy
  comma and modern space syntax, numbers or percentages, `/ alpha`, `none`); `hsl()` / `hsla()`; `hwb()`; `lab()`,
  `lch()`, `oklab()`, `oklch()` (percentages per CSS: 100% = 125 for lab a/b, 150 for lch C, 0.4 for OKLab a/b and
  OKLCH C); angles in `deg`, `rad`, `grad`, `turn`; `color(srgb | srgb-linear | display-p3 | xyz | xyz-d50 |
  xyz-d65 …)`; the 148 named colours and `transparent`. Not supported: `calc()`, relative colours, `currentcolor`.
- `formatCSS(color, fmt, { digits })`, `FORMATS = ['hex', 'rgb', 'hsl', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'p3']`.
  sRGB formats are gamut-mapped and quantized to 8 bits first, so `hex`, `rgb`, `hsl` and `hwb` of one colour name
  the same colour. Rounding is short (`hsl(217.2 91.2% 59.8%)`, `oklch(0.628 0.2577 29.23)`) but safe: when the text
  would parse back to another 8-bit colour, up to three decimals are added.
- `parseHex`, `toHex(rgb, alpha)`, `hexToRgb`, `fromHex`, `cssToHex`, `NAMED` (name → hex digits)
- `nearestName(color)` → `{ name, hex, dE }`: closest named colour by ΔE2000 (aliases such as `grey`, `aqua` and
  `fuchsia` are skipped in favour of `gray`, `cyan`, `magenta`).

## Metrics (`metrics.js`)

- `deltaE76(lab1, lab2)`, `deltaE2000(lab1, lab2, kL, kC, kH)` (Sharma, Wu, Dalal 2005, validated against all 34
  pairs of their test data to 1e-4), `deltaEOK(oklab1, oklab2)`, `deltaE(c1, c2, '2000' | '76' | 'ok')` on colour
  objects (D50 CIELAB for the first two)
- WCAG 2.x: `luminance(rgb)`, `contrastRatio(rgb1, rgb2)` (1..21), `wcagLevels(ratio)` →
  `{ aa, aaa, aaLarge, aaaLarge, ui }`, `wcagGrade(ratio)` → `'AAA' | 'AA' | 'AA18' | 'fail'`
- APCA (SAPC 0.0.98G-4g constants, `APCA`): `apcaY(rgb)`, `apcaContrast(textRgb, bgRgb)` → Lc (≈ −108..106;
  `#888` on `#fff` = 63.056469930209424, `#000` on `#fff` = 106.04067321268862, `#fff` on `#000` =
  −107.88473318309848, `#fff` on `#888` = −68.54146436644962), `apcaBand(lc)`
- `labelOn(bgRgb, 'wcag' | 'apca')` → black or white label colour for a background

## Colour vision deficiency (`cvd.js`)

`simulateCVD(rgb, type, severity = 1, method = 'vienot')`, `simulateLinear(linearRgb, …)`,
`simulateImageData(rgbaBytes, …)` (in place), `cvdMatrices(type, method)`, `CVD_TYPES`.
Types: `protanopia`, `deuteranopia`, `tritanopia`, `achromatopsia` (short forms `protan`, `deutan`, `tritan`,
`achroma`). Protan / deutan use Viénot 1999 (one plane) or Brettel 1997 (`method: 'brettel'`, two half-planes);
tritan always uses Brettel 1997; achromatopsia maps to the luminance. Everything runs in linear sRGB with the
sRGB-specific matrices of libDaltonLens (public domain). A severity below 1 interpolates linearly between normal and
dichromat vision in linear light — the libDaltonLens approximation of anomalous trichromacy (Machado 2009 matrices
are not included).

## Palettes (`palette.js`)

Colours are OKLCH triples `[L, C, H]`; outputs are swatches `{ oklch, rgb, hex }` gamut-mapped to sRGB.

- `harmony(base, mode, n)`, `HARMONIES = ['analogous', 'complementary', 'triadic', 'tetradic', 'split',
  'monochrome']`: hue offsets in OKLCH; analogous spreads hues symmetrically around the base (the base sits in the
  middle), other modes cycle their hues and vary the lightness of repeats, monochrome spreads lightness.
- `scale(base)` → `{ steps: [{ step, oklch, rgb, hex, base }], baseStep }` with `SCALE_STEPS` 50…950: reference
  lightness from 0.971 to 0.27 (`SCALE_L`), chroma tapered at both ends (`SCALE_C`), hue kept; the base lands
  exactly on the step with the nearest reference lightness and the other steps are re-spaced on each side of it.
- `randomPalette({ n, seed, locked, scheme })` → `{ colors, scheme, mode }`: mulberry32 seeded RNG (`rng(seed)`);
  schemes `harmony` (random harmony, spread lightness), `spread` (one hue drifting from light to dark) and `accent`
  (tinted neutrals plus accents); `locked[i]` colours stay at their index and the first one anchors hue and chroma.
- `extractPalette(rgbaBytes, { width, k: 2..12, stride, seed, maxIter, minAlpha })` → `[{ rgb, hex, oklab, oklch,
  count, pct, x, y }]` sorted by population: k-means++ seeding and Lloyd iterations in OKLab on sampled opaque pixels
  (about 20 000 samples by default); `x`, `y` locate the sample nearest to each centroid.
- `hueFamily(oklch)` → `red`, `orange`, `amber`, `yellow`, `lime`, `green`, `emerald`, `teal`, `cyan`, `sky`, `blue`,
  `indigo`, `violet`, `purple`, `fuchsia`, `pink`, `rose`, or `gray` / `neutral` for low chroma (the threshold
  shrinks toward white and black); `tokenNames(list)` → unique names (`blue`, `blue-2`).

## Swatch formats (`swatches.js`)

A palette is `[{ name, hex, scale?: [{ step, hex }] }]`.

- `toCSSVars(items, { prefix })` — `:root { --name: #hex; --name-50: … }`
- `toSCSS(items, { prefix })` — `$name` variables, a `$palette` map and one `$name-scale` map per scale
- `toTokens(items, { group })` — W3C Design Tokens (DTCG): `{ color: { name: { "$type": "color", "$value": "#…" } },
  scale: { name: { "50": {…}, … } } }`
- `toTailwind(items)` — `module.exports = { theme: { extend: { colors: { name: '#…' | { DEFAULT, 50 … 950 } } } } }`
- `toGPL(items, { name, columns })` — GIMP palette text
- `toASE(items)` → `Uint8Array`: Adobe Swatch Exchange 1.0, big-endian, `ASEF`, RGB float32 global swatches with
  UTF-16 names; scales become groups. `parseASE(bytes)` → `{ colors: [{ name, hex, rgb, model, group }] }` reads
  RGB, CMYK (naive), LAB and Gray swatches.
- `parseColorList(text)` → `[{ hex, name? }]`: hex (also bare 6-digit), any CSS colour function, named colours,
  `.gpl` lines, `name: value` / `--name: value` / `$name: value` lines (comments ignored), design-token JSON.
- `sheetLayout(items, { title, columns, background, label })` → `{ width, height, shapes }` (rects and texts, label
  colours black or white by APCA) and `toSVG(items, opts)`; a canvas renderer draws the same layout as PNG.
- `flatten(items)`, `slug(name)`, `scanColors(text)`

## Limits

- No `calc()` / relative colour syntax, no `color-mix()`, no HDR spaces (rec2020, a98-rgb, prophoto-rgb are not
  parsed).
- CVD severity is a linear blend, not the Machado 2009 model.
- `hueFamily` uses nearest family hue at any lightness; light reds can name as `rose`.
