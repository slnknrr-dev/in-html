# Palette Studio (`pallete-app`)

A colour palette studio that runs entirely in the browser and never touches the network. Built into one file:
`html@5_offline_singlefile/index.html` (`node singlefile.js pallete-app`). Development: `node pallete-app/server.js`.

## Features

- **Base colour**: native colour picker, a text field that accepts any CSS colour (hex, `rgb()`, `hsl()`, `hwb()`,
  `lab()`, `lch()`, `oklab()`, `oklch()`, `color()`, named colours) and OKLCH sliders (lightness, chroma, hue) whose
  tracks show the real colours; the chroma track hatches the part outside sRGB.
- **Harmonies** in OKLCH hue space: analogous, complementary, triadic, tetradic, split complementary, monochrome
  (pickers draw each scheme on a hue wheel), 2–12 colours.
- **The strip**: big swatches with value (click the format chip to cycle HEX / RGB / HSL / OKLCH), nearest CSS colour
  name (or the imported name), copy on click, lock, use as base, reorder (drag, arrow buttons, Shift+arrows),
  remove, add a fitting colour. Labels pick black or white by APCA contrast.
- **Random** (button or Space when no field has focus): seeded harmony-based, lightness-spread or neutral-plus-accent
  palettes; locked swatches stay.
- **From an image**: drop, paste or choose an image; k-means++ in OKLab (2–12 colours) on a 320 px copy; the
  thumbnail shows a dot where each colour was found and a population bar.
- **Tabs**: Scales (50–950 per colour, base on its nearest step, contrast with white and black text, click to copy);
  Contrast (matrix of the palette + white + black: WCAG 2 ratio with AAA / AA / AA18 grade and APCA Lc); Vision
  (protanopia, deuteranopia, tritanopia, achromatopsia with a severity slider; pairs whose ΔEOK falls under a
  threshold are listed); Export (CSS variables, SCSS, DTCG JSON tokens, Tailwind config, GIMP `.gpl`, Adobe `.ase`,
  SVG sheet, PNG sheet; preview, Download, Copy; optional 50–950 scales); Import (paste text or drop `.gpl`, `.ase`,
  CSS / SCSS / JSON files, then replace or append).
- **History** of the last 30 palettes (mini strips, restore, clear), **undo** (button, Ctrl+Z), the current palette
  and settings remembered across reloads (`localStorage`: `palette-state`, `palette-history`; the shell uses
  `palette-ui`, `palette-theme`).
- Keyboard: arrows move between swatches, Shift+arrows reorder, Home / End, Enter or C copies, L locks, B sets the
  base, F cycles the format, Delete removes, Space random, Ctrl+Z undo. Pasting text with colours anywhere outside a
  field opens it in Import.
- 7 UI languages (en, ru, uk, de, fr, es, ka), light and dark, down to 380 px wide (the strip becomes a vertical list).

## Files

| file | purpose |
|---|---|
| `index.html` | page skeleton, favicon |
| `main.js` | shell, layout, base colour / harmony / image / history cards, keyboard and paste handling |
| `state.js` | state object, colour facts cache, palette operations, undo stack, persistence, history |
| `strip.js` | the palette strip (rendering, drag and keyboard) |
| `panels.js` | Scales, Contrast, Vision, Export, Import panels; PNG sheet drawing |
| `strings.js` | UI strings (`pal.*`) in 7 languages |
| `app.css` | styles of the application |
| `server.js` | development server instance |

The colour science lives in the `color/` library (`space.js`, `css.js`, `metrics.js`, `cvd.js`, `palette.js`,
`swatches.js`).

## Limits

- Palettes hold up to 20 colours; colours are stored as 8-bit sRGB hex (OKLCH input is gamut-mapped to sRGB).
- The image is not kept across reloads (only the palette is).
- Copying needs clipboard permission; where it is blocked the shell falls back to a selection copy or a hint.
