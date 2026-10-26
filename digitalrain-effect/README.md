# digitalrain-effect

Design a "Matrix"-style digital rain and take it with you: a live full-bleed preview, a parameter panel, presets,
random sets, a share code in the page address and exports that run anywhere offline. Class: standalone (`-effect`) —
no network at all, works from `file://`; the exported pages are standalone too.

## Features

- **Live preview** filling the workspace, glass toolbar (play / pause, random, full screen, PNG snapshot, copy link,
  export menu), preset name and frame rate. Double-click the preview for full screen; the toolbar hides while idle.
- **Presets** with live miniature thumbnails (they animate on hover / focus): classic, wake up (message), amber
  terminal, cyberpunk, blueprint, monochrome, rainbow, binary storm, ice, ascend (rising), crimson, sakura.
- **Random** pleasing sets (one hue family or a duotone on a dark background) that keep the message, background
  image and playback settings; undo with Z or the toast action.
- **Parameters**: glyph sets (half-width katakana, latin, digits, binary, hex, symbols, cyrillic, emoji — off by
  default —, custom text) with a glyph preview, font, size, mirroring, bold; speed, variance, trail length, fade
  curve, drop density, column spacing, glyph mutation, flicker, direction (falling / rising); gradient or rainbow
  colouring, head colour, glow, head glow, bloom; background colour / transparent / image (dropped or pasted, dim
  amount); 1–3 depth layers, depth, pointer parallax; message (big letters or in the columns, hold time);
  frame-rate cap and the reduced-motion policy of exports.
- **Share code**: the parameters live in the URL hash (`#r1.…`) and in localStorage; copy the link or the code,
  paste a code or link to apply it. Nothing is uploaded; background images are not part of a code.
- **Exports**:
  - standalone single-file HTML (renderer serialized with `Function.prototype.toString`, minified at runtime with
    `minify/`, optional full-screen button, start hint, screensaver mode with wake lock, background image included or
    not, size shown; open in a new tab to try it),
  - embeddable `<canvas>` snippet (copy or download),
  - WebM recording of 5–30 s at the preview size, 720p, 1080p, vertical 1080 × 1920 or square (MediaRecorder, local),
  - PNG snapshot of the preview,
  - wallpaper-size PNG (1920 × 1080 … 5120 × 2880, phone sizes, custom) with an automatic glyph scale.
- Keyboard: Space play / pause, R random, F full screen, Z undo. UI in English, Russian, Ukrainian, German, French,
  Spanish and Georgian; light and dark themes; phone layouts.

## Files

| file | role |
|---|---|
| `index.html` | the page (shell, stylesheets, module entry) |
| `main.js` | state, stage (canvas, toolbar, chip), keyboard, hash / storage sync |
| `panel.js` | parameter panel: preset gallery, sections, share and export entries |
| `exporter.js` | export dialogs: HTML, snippet, WebM, PNG, wallpaper |
| `strings.js` | UI strings in the 7 languages |
| `app.css` | layout of the creator |
| `server.js` | development server (`node digitalrain-effect/server.js`) |

The effect itself lives in the `rain/` library (renderer, parameters, presets, exports).

## Limits

- Video export needs `MediaRecorder` with WebM (Chromium, Firefox; Safari support varies); videos have no alpha, a
  transparent background is recorded with the background colour.
- Half-width katakana need a CJK-capable system font; the exported page uses system fonts only.
- The share code does not carry the background image (too large for a URL).
