# photo/

A Photoshop-like photo editor core, and every document described as **one complete ImageMagick 7 command** for bash or
cmd.exe. Used by `image-processor` (Editor page) and built so that other applications (e.g. the video
processor's picture editor hook) can embed it. Vanilla ESM; the editing parts need a DOM (canvas), the document model
of the command, the adjustments and the selections are pure and run in Node.

## Two modes

- **Edit** — layers (pixel, text, shape, adjustment) with visibility, opacity, 16 blend modes, masks, order,
  duplicate, merge down, flatten; selections (rectangle, ellipse, lasso / polygon, magic wand with tolerance, colour
  distance per channel / RGBA / perceptual, soft edge, anti-aliasing and diagonal neighbours (`raster/wand.js`); add /
  subtract / intersect, invert, feather); move / free transform, brush, eraser, clone stamp, fill, gradient, eyedropper, text,
  shapes, crop; non-destructive adjustment layers (brightness / contrast, levels, curves, hue / saturation, colour
  balance, invert, black & white, threshold, posterize); filters (gaussian blur, unsharp mask, noise, pixelate); image
  and canvas size, rotate, flip; zoom and pan (wheel, pinch, space-drag); history with a memory budget; project files
  (ZIP with `project.json` and PNG layers); export PNG / JPEG / WebP.
- **Transform · ImageMagick** — the same document as one `magick` command (or a short script of steps), text to read,
  copy and save; nothing runs it in the page. Every layer is a sub-image composited onto the picture below:

  | in the editor | in the command |
  |---|---|
  | the background, untouched since it was opened | the source file (`-auto-orient` first) or `-size WxH xc:<colour>`, then the whole-image operations done since: `-crop … +repage`, `-filter Lanczos -resize WxH!` / `-scale`, `-compose Copy -background … -gravity … -extent`, `-rotate`, `-flip` / `-flop`, filters (`-blur`, `-unsharp`, `+noise`, `-scale` twice), merged text / shape / adjustment layers |
  | painted pixels (brush, eraser, clone stamp, fills, gradients, moved pixels, filters in a selection, pasted pictures) | a PNG file of the layer at document size (`layer-2.png`, `background.png`) that the page saves |
  | layer mask | `( mask.png -alpha copy ) -compose DstIn -composite` (a grey PNG: white = shown) |
  | opacity | `-channel A -evaluate multiply k +channel` (text and shapes: colours with alpha) |
  | blend mode | `-compose Over / Multiply / Overlay / Lighten / ColorDodge / ColorBurn / HardLight / Exclusion -composite`; Screen, Darken, Difference and Soft light as `-fx 'u+v.a*(B(u,v)-u)'`; Hue, Saturation, Colour, Luminosity as `-fx` programs of the W3C formulas; over transparent pixels the `-fx` forms carry the alpha (`channel(…,ko)`) |
  | adjustment layer | its operators on the colour channels (`-channel RGB … -clamp +channel`): `-brightness-contrast`, `-level` / `+level`, curves and colour balance as `-fx`, `-modulate`, `-negate`, `-color-matrix`, `-threshold`, `+dither -posterize`; with a mask or opacity an adjusted `+clone` mixed in by them |
  | text | `-family … -weight … -style … -pointsize … -fill … -annotate ±deg+X+Y 'line'` — one per line at its baseline, rotated about the box centre like the editor |
  | shape | `-draw 'roundrectangle / rectangle / ellipse / line …'` (stroke caps and joins round, rotation by `translate` + `rotate`) |
  | export settings | `-compose Over -background white -alpha remove -alpha off` (JPEG), `-quality`, `-strip` |

  The panel lists the selected layer's operations with their arguments and a fidelity badge, notes the
  approximations, and ties every piece of the command to its layer or history step: pointing at a piece marks the
  layer row and outlines the layer on the picture, clicking selects it; the selected layer's pieces are highlighted;
  clicking a layer on the picture finds it in the command. History entries that changed the command show their
  fragment. bash / cmd.exe (remembered), one command or step by step (`step-NN.miff` files at 16 bits, deleted at the
  end), line wrapping, output format, copy, save as `.sh` (`set -e`) or `.bat` (`%` doubled), and a ZIP with the PNG
  files the command reads plus both scripts. All quoting goes through `cmdline/`; pieces through `ffcmd/command.js`.

Context menus (`ui/contextmenu.js`): on the picture (selection and layer actions: cut / copy / paste, layer via copy /
cut, select all / deselect / invert / feather, fill, clear, crop to selection, free transform, duplicate, merge down,
select the layer under the pointer, show in the command) and on layer rows (duplicate, merge down, rasterize, masks,
opacity, show / hide, rename, delete). A long press with a finger or pen opens them only for the move, selection, crop,
hand and zoom tools — with a painting tool holding still keeps painting.

## How exact

`photo/test.js` builds layered documents and runs the generated command through the real `magick` (argv without a
shell, the text typed into bash and into a cmd.exe window, `.sh` and `.bat` files, the single command and the script)
against a flatten done the editor's way (W3C compositing as the canvas implements it). Every blend mode, over an opaque
and over a transparent picture, every adjustment (direct, by a mask, by opacity), masks, opacity, the background recipe
(crop, Lanczos resize, flip) match up to rounding (max 1–2 levels); an eleven-layer document stays within mean 0.54 /
max 8 levels (the editor rounds to 8 bits after every layer, ImageMagick computes in floating point).

The same check against the editor's own canvas flatten in Chrome (an end-to-end run, 43 documents, 240 × 160):

| part | max | mean | fidelity |
|---|---|---|---|
| geometry (crop, Lanczos resize, canvas size, rotate, flip) | 0 | 0 | exact |
| 16 blend modes of a painted layer at 80 % | 1–3 | 0.01–0.32 | exact |
| mask + opacity; adjustments by mask and opacity | 2 | 0.09–0.27 | exact |
| 9 adjustment layers | 0–1 | 0–0.05 | exact |
| painted background (a PNG), transparent document with 4 blends + an adjustment | 2–3 | 0.14–0.39 | exact |
| filled rectangle on whole pixels | 0 | 0 | exact |
| other shapes (stroke, rounded, ellipse, line, rotated) | 30–121 at edges | 0.02–0.21 | approximate (anti-aliasing) |
| text (Arial, Georgia italic, Courier New, Times New Roman rotated, Segoe UI, Impact) | 109–218 at glyph edges | 0.5–1.5 | approximate (fonts) |
| everything together (recipe, painted layers, mask, blends, curves, rotated text, shape) | 174 at glyph edges | 0.93 | approximate (text) |

The `.bat` and bash forms of every command wrote the same pixels as the argv. Approximate stay: text (ImageMagick
renders installed fonts by name — `system-ui` → Segoe UI, `sans-serif` → Arial, `serif` → Times New Roman,
`monospace` → Courier New — with FreeType, the browser with its own rasterizer), shape anti-aliasing, the noise
filter (another random generator), wide blurs (a box approximation in the editor), JPEG / WebP encoders.

## Files

| file | contents |
|---|---|
| `editor.js` | `createEditor({ storageKey, run, sources, onSend })`: the workspace (menus, tools column, options bar, stage, panels, status), modes, rendering of the visible region, history snapshots and pixel patches, layer / mask / selection operations, image operations recorded as command steps, documents and projects, context menu of the picture, keyboard |
| `tools.js` | pointer gestures, overlay (marquee, lasso, crop box, transform handles, brush cursor), option bar, tool palette |
| `panels.js` | Layers (rows with a context menu, captions in Transform mode), Properties (adjustment controls with a curves editor, text, shape, mask, the layer's piece of the command), History (with command fragments), the Transform pane; bottom sheet on phones |
| `cmdpanel.js` | the Transform · ImageMagick panel |
| `magick.js` | pure: `docCommand(doc, options)` (argv with references, script steps, files, operations, notes, fidelity), `commandText`, `scriptFile`, `refWords`, `mergeStep`, blend modes (`BLENDS_IM`, `blendArgs`), text and shape arguments |
| `adjust.js` | pure: adjustments and filters on RGBA images with their ImageMagick arguments |
| `select.js` | pure: selections as coverage masks (shapes, combine, invert, feather, flood fill, contours) |
| `doc.js` | document and layers on canvases, text layout, shapes, masks |
| `render.js` | compositing of any region at any scale, flatten, pixel sampling, thumbnails |
| `paint.js` | brush / eraser / clone stamp strokes |
| `dialogs.js` | new canvas, image / canvas size, feather, filters with preview, export, shortcuts |
| `history.js` | undo / redo with a memory budget |
| `project.js` | project files (ZIP: `project.json` + PNG layers and masks) |
| `jobs.js` | heavy pixel jobs (filters, resampling) that an application can run in a worker |
| `cmdview.js` | the command card of the image processor's Transform pipeline (segments tied to steps) |
| `strings.js`, `editor-strings.js`, `magick-strings.js` | UI strings in 7 languages |
| `icons.js`, `photo.css` | icons and styles |
| `test.js` | Node tests (selections, history, adjustments, the document command and its ImageMagick runs) |
| `e2e.js` | in-page scenario: `node check.js e2e image-processor/html@5_offline_singlefile/index.html photo/e2e.js` |

## Limits

- The command reads the PNG files the page saves next to the source file; it is complete but not minimal (every
  painted layer is a full-size PNG).
- Adjustment layers ignore their blend mode (as the editor does). A moved background is placed with `-extent`; any
  other edit of the background's pixels turns it into `background.png`.
- `-fx` forms (some blend modes, curves, colour balance, posterize over transparency) are exact but slow on large
  pictures; they need ImageMagick 7 (variables and `channel()` in `-fx`).
- Brightness / contrast follows ImageMagick 7.1's `-brightness-contrast`; older versions compute it differently.
