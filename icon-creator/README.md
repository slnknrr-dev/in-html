# icon-creator

A small Aseprite-like pixel editor for application icons, fully offline (no network at all). One **256 × 256 master**
and up to **five sizes** — 32, 48, 64, 128 and 256 px — that go into one `.ico` file
(`image/vnd.microsoft.icon`). Every size either follows the master automatically (Lanczos downscaling) or gets its own
hand-drawn picture: small icons usually need a simpler drawing than the big one.

Artifacts: `html@5_offline_singlefile/index.html`, `html@5_offline/` (`node singlefile.js icon-creator`); the demo
`demo/icon-creator.html` in the Pages repository (`DEMO_NOTICE.md`).
Development: `node icon-creator/server.js`, then open `/icon-creator/`.

## Features

- **Import** of a picture of any size (drop, paste, open): a square crop dialog (drag, resize by the corner or the
  slider, keyboard, "largest centred", "whole picture") with an optional background removal and a live 64 px preview.
  `.ico` files open with their sizes (hand-drawn sizes stay custom); projects open as saved.
- **Magic wand** as in Krita / Paint.NET (`raster/wand.js`): tolerance, contiguous or global, 4- / 8-connected,
  colour distance per channel / RGBA / perceptual, soft edge, new / add / subtract / intersect (Shift, Alt).
  Delete makes the selection transparent. **Remove background** runs the wand from the corners and edges with
  colour decontamination of the edge.
- **Tools**: pencil and eraser (1–16 px, mirror X / Y / XY, Shift + click draws a straight line), line, rectangle,
  ellipse (outline / filled, Shift: square / circle), bucket fill (tolerance, contiguous), rectangle select,
  eyedropper (Alt with any drawing tool), move. Main and second colour with opacity (right button: second colour),
  a 16-colour palette and recent colours.
- **Image actions**: outline, flip ↔ / ↕, clear; selection: make transparent, fill, invert, deselect.
- **Sizes** panel: thumbnail, automatic / own drawing, include in the icon; **preview** of every size at 100 % on
  light, dark and transparent backgrounds.
- **Export**: `.ico` (256 px as PNG, smaller sizes as 32-bit BMP with AND mask — readable by every Windows version),
  `.png` of the current size; **project** files (`.icon.json`, pixels as PNG); autosave in the browser.
- Undo / redo (80 steps), pixel grid, zoom (Ctrl + wheel, + / −, 0 fits), 7 UI languages, light / dark.

Keys: B pencil, E eraser, L line, R rectangle, O ellipse, G fill, W wand, M select, I eyedropper, V move, X swap
colours, [ ] brush size, 1–5 sizes, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, Ctrl+A, Ctrl+D, Ctrl+Shift+I, Delete,
Ctrl+S project, Ctrl+E export .ico.

## Files

| file | contents |
|---|---|
| `main.js` | UI: toolbar, tools, colours, canvas and overlay, sizes, preview, crop dialog, keys |
| `doc.js` | the document: master and sizes, regeneration, history, crop, .ico import / export, project format |
| `paint.js` | pixel operations: blending, dabs with mirror, lines, shapes, fill, masks, shift, flip, outline |
| `strings.js` | UI strings (en, ru, uk, de, fr, es, ka) |
| `test.js` | unit tests (`node icon-creator/test.js`) |
