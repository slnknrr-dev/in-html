# img2ascii-app

Turns pictures and the camera into text art: ASCII ramps, Unicode blocks, braille and terminal colours. A standalone
application: zero network, works from `file://`, settings stay in `localStorage` (`img2ascii-settings`; shell keys
`img2ascii-ui`, `img2ascii-theme`). Built to `html@5_offline_singlefile/index.html`.

## Features

- **Sources**: a built-in sample scene drawn at startup (sunset, glossy sphere, perspective checkerboard, lettering);
  image files by click, drag & drop (on the drop zone or the preview) or Ctrl+V; the camera live (≈ 10–15 fps,
  adaptive so the page stays responsive), mirror toggle, freeze frame, stop keeps the last frame.
- **Characters**: classic, detailed (70 levels), short, blocks, braille (2 × 4 dots per character), half blocks
  (two pixels per character), custom characters (sorted by density, or given dense / sparse first); columns
  20–400; character aspect.
- **Tone**: brightness, contrast, gamma, invert, auto levels, dithering (Floyd–Steinberg, Bayer 4 × 4 / 8 × 8;
  switched on automatically for braille), edge emphasis, edge glyphs `| / - \` with a threshold.
- **Colour**: mono, ANSI 16, ANSI 256, truecolor, HTML (12-bit); colour on the characters or the background; colour
  boost; preview background auto (follows the colour scheme: terminal in dark mode, paper in light mode), dark,
  light or custom. ANSI previews show the quantised palette colours.
- **Preview**: a terminal window (glass, scanlines) or a sheet of paper; `<pre>` with merged colour runs plus a pixel
  canvas for cell backgrounds and half blocks; fit to width or zoom (buttons, `+` `-` `0` on the focused preview);
  stats (grid, characters, conversion time).
- **Export**: TXT, ANSI (`.ans`), standalone HTML page, SVG, PNG (font size 8–32 px, reduced automatically when the
  canvas would be too large); copy as text, ANSI or an HTML `<pre>` snippet.

## Files

| file | purpose |
|---|---|
| `index.html` | page skeleton |
| `main.js` | state, render scheduling, camera loop, wiring, language switching |
| `controls.js` | settings panel (source, characters, tone, colour) |
| `stage.js` | preview stage: terminal / paper frame, `<pre>` + pixel canvas, zoom, stats, drop target |
| `export.js` | export card and file / clipboard writers |
| `source.js` | sample scene, image decoding, camera |
| `settings.js` | defaults, validation, storage, preview colours |
| `strings.js` | UI strings in en, ru, uk, de, fr, es, ka |
| `app.css` | application styles |
| `server.js` | development server (`node img2ascii-app/server.js`) |

The conversion engine and writers live in the `ascii/` library.

## Limits

- The preview and the exports use the system's monospace fonts; braille and block glyphs may come from fallback fonts
  with slightly different widths (the preview measures the real glyph width; SVG rows are fitted with `textLength`).
- Large grids (400 columns of braille or half blocks in colour) take noticeably longer to lay out than to convert;
  such changes are debounced.
- The camera needs a browser that allows `getUserMedia` for the page (file:// works in Chromium-based browsers).
