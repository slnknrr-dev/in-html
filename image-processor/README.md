# image-processor

Batch image processing and a Photoshop-like editor in the browser, fully offline (standalone class: no network at
all). Files are dropped, pasted or picked, processed on this device and leave as downloads (single files or one ZIP).
Both pages also describe what they do as **ImageMagick 7 commands** for **bash** or **cmd.exe** — text to read, copy
and save; the page never runs them.

## Two pages

- **Transform** — the batch pipeline below. Its command card shows the selected image's `magick` command, or the batch
  loops over every image (bash `for f in *.jpg; do …; done`, cmd.exe `for %f in (*.jpg) do …` as typed in a console
  window or `%%f` in a `.bat` file) with the ZIP export's output names; every step carries an exact / approximate
  verdict and a note, and pointing at a fragment highlights its step and settings section (and the other way round).
  Bash / cmd.exe and line wrapping are remembered.
- **Editor** — the photo editor of `../photo/`: layers, masks, blend modes, selections, brushes, clone stamp, text,
  shapes, adjustment layers, filters, crop / sizes, history, projects. Its **Transform · ImageMagick** mode shows the
  whole layered document as one complete command (or a script of steps): painted layers and masks become PNG files
  the page saves in a ZIP with `.sh` and `.bat` scripts, and every piece of the command points at its layer or
  history step. A Transform result (or the original) opens in the editor with its pipeline steps as the start of the
  command; the editor's result goes back to Transform. See `photo/README.md` for the mapping and its measured
  accuracy.

Artifact: `html@5_offline_singlefile/index.html` (`node singlefile.js image-processor`).
Development: `node image-processor/server.js`, then open `/image-processor/`.

## Features

- **Input**: many images at once; PNG and JPEG through the own decoders (`../png`, `../jpg`), WebP, GIF (first frame),
  BMP, AVIF, ICO and anything else the browser decodes through the platform. Thumbnails, per-file status and progress.
- **Rotate & crop**: EXIF auto-orient, 90° rotation, horizontal / vertical flip, straighten (-45..45°, auto-cropped to
  the inscribed rectangle), crop editor on the preview (drag, handles, aspect presets free / original / 1:1 / 4:3 /
  3:4 / 3:2 / 2:3 / 16:9 / 9:16 / 4:5 / 5:4 / 21:9, rule-of-thirds grid, keyboard: arrows move, Shift + arrows
  resize).
- **Resize**: fit, fill (cover + centre crop), exact, percent; Lanczos 3, area averaging or bilinear, all in JS on
  premultiplied alpha (`raster/resample.js`); enlarging only on request.
- **Remove background**: magic wand from the corners or edges (`raster/wand.js`): tolerance, colour distance
  (perceptual / RGBA / per channel), soft edge, grow / shrink, feather, colour decontamination of the edge; the command
  shows it as an `-fuzz` flood fill from the border (approximate).
- **Adjust**: brightness, contrast, saturation, hue, gamma, temperature (lookup tables + one colour matrix).
- **Filters**: grayscale, sepia, invert, blur (three box passes ~ gaussian), sharpen (unsharp mask with radius),
  vignette.
- **Watermark**: text, 9 positions or tiled diagonal, size relative to the image, opacity, colour, shadow.
- **Output**: same format, JPEG (own encoder: quality, 4:2:0 / 4:2:2 / 4:4:4, progressive, background for
  transparency), PNG (own encoder: smallest lossless type, or PNG-8 with 2-256 colours and dithering, three
  compression efforts), WebP (browser canvas, quality), ICO (`../ico`: any of 16, 24, 32, 48, 64, 128, 256 px in one file, each fitted
  into a transparent square; 256 px as PNG, smaller as 32-bit BMP). ICO files are also read by the own decoder. Live result size with the change against the original,
  before / after split comparison (draggable, keyboard accessible) or single views.
- **Metadata**: file and format facts (colour type, subsampling, estimated quality, ICC, dpi, frames), EXIF summary
  (camera, lens, date, exposure, GPS in decimal degrees), text chunks / comments, all EXIF tags. Export removes
  metadata by default; "keep" carries EXIF (orientation reset, stale thumbnail removed), text and comments; the ICC
  profile is kept separately (on by default).
- **Batch**: settings apply to all images; any image can get its own settings ("This image"); process all with
  progress, stop, ZIP download (`../zip/zip.js`, stored entries, unique names), file name suffix.
- 7 UI languages, light / dark, responsive down to phones; settings are remembered (localStorage).

## How it runs

Heavy work runs in a module Worker created from a Blob: in the single-file build the page's own inline module is
re-run as the worker (`main.js` starts `workerMain()` when there is no document); from sources the Blob imports
`worker.js`. The worker keeps the two most recent decoded sources, so live previews only re-run the pipeline.
Large images first get a quick draft (the same settings on a cached downscaled copy) and then the exact full-size
result. Without workers the same jobs run in the page in small steps (`runner.js`), and `<html data-engine>` tells
which engine is active.

## Files

| file | role |
|---|---|
| `index.html` | page (shell, styles, module) |
| `main.js` | entry: UI state, image list, live preview, batch / ZIP, worker bootstrap, the two pages, the editor's sources (Transform results with their steps) |
| `panel.js` | settings column (sections, output card, per-image scope) |
| `stage.js` | preview: split comparison, crop editor, busy state, stats |
| `meta.js` | metadata card |
| `runner.js` | worker from a Blob, job queue (draft < preview < export), in-page fallback |
| `worker.js` | `runJob()` (decode, process, encode, progress) and the worker message protocol |
| `pipeline.js` | settings model (`DEFAULTS`, `normalizeSettings`), `processImage`, `encodeImage`, output naming |
| `input.js` | format sniffing, metadata for the panel, decoding to RGBA |
| `canvas.js` | canvas parts: platform decoding, WebP encoding, watermark text layer |
| `commands.js` | the pipeline as ImageMagick arguments (steps with fidelity), the single command and the batch loops (bash, cmd.exe window, `.bat`) as segments tied to steps |
| `cmdmodel.js` | the command card's model: labels, notes, remarks for the selected image or the batch |
| `test.js` | the pipeline against `magick` (sizes, pixels by fidelity, metadata) and the command text through bash, a cmd.exe window and a `.bat` file |
| `strings.js` | UI strings (en, ru, uk, de, fr, es, ka) |
| `app.css` | application styles (on top of `../ui/base.css`, `../ui/app.css`) |
| `server.js` | development server instance |

Libraries: `png/`, `jpg/` (decoders, encoders, metadata), `raster/` (resampling, pixel operations and their ImageMagick
arguments), `photo/` (the editor and its command), `cmdline/` (bash / cmd.exe quoting), `ffcmd/` (command pieces with
references), `codec/` (zlib), `zip/` (batch download, the command's files), `ui/`.

## Limits

- Pixels are processed as 8-bit sRGB-like values without colour management; ICC profiles are passed through, not
  applied. 16-bit PNGs are reduced to 8 bits.
- Animated GIF / APNG / WebP: only the first (default) frame is processed.
- WebP output depends on the browser's canvas encoder (Safari produces PNG instead, with a notice); WebP files carry no
  metadata. HEIC and other formats the browser cannot decode are reported as errors.
- Very large images are bounded by memory (decoders refuse more than 120 megapixels).
- The pure-JS encoders are slower than native ones: a 12 MP photo takes a few seconds (in the worker, the page stays
  responsive).
- The commands are descriptions: approximate steps (wide blurs, watermark fonts, JPEG / WebP encoders in Transform;
  text and shape anti-aliasing in the editor) look alike but are not pixel-identical; `-fx` steps are slow on large
  images. They need ImageMagick 7 (`magick`).
