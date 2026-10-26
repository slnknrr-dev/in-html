# QR Studio (qr-app)

A QR code generator and scanner that runs entirely in the browser, with zero network access (standalone class: the
build fails if the artifact contains any network API or remote resource). Two pages, linked in the header:

| page | artifact | purpose |
|---|---|---|
| `index.html` | `html@5_offline_singlefile/index.html` | **Create**: content forms, styled live preview, exports, print sheet |
| `scan.html` | `html@5_offline_singlefile/scan.html` | **Scan**: images and the camera, parsed result, history |

## Create

- **Content types**: link (https:// added when missing), text, Wi‑Fi (`WIFI:` with escaping, WPA / WEP / open,
  hidden), contact (vCard 3.0 or MeCard), e-mail (`mailto:`), SMS (`SMSTO:` or `sms:`), phone (`tel:`), location
  (`geo:`; pasting "lat, lon" into the latitude splits it), calendar event (`VEVENT`, UTC times or all-day dates) and
  crypto payment URIs (bitcoin, ethereum, litecoin, dogecoin, bitcoincash, monero, solana, tron, dash, zcash) with a
  loose address check. Field problems are shown under the form.
- **Code panel**: error-correction level L / M / Q / H with plain-language hints, version and size, encoding mode,
  bits used / capacity bar, characters (or bytes) left, the encoded text (collapsible).
- **Design**: module and background colours (presets, swap, transparent background), linear / radial gradient,
  module shape (square, rounded with merged neighbours, dots, diamonds, bars), finder frame and centre shapes, quiet
  zone 0–10. Contrast warnings use `color/color.js` (`< 4:1` warning, `< 2.5:1` error, every gradient stop checked,
  inverted codes and missing quiet zones noted).
- **Logo**: pick, drop or paste an image; it is downscaled to ≤ 256 px (PNG data URL), sized 10–30 % with an optional
  plate. Modules under the logo are cleared, the level switches to H (with undo), and the panel reports how many data
  modules are hidden and the load of the busiest Reed–Solomon block against its repair budget.
- **Live scan check**: every change re-renders the SVG to a canvas and decodes it with `qr/decode.js`; the badge
  under the preview says "Scans OK" or "May not scan — increase ECC or shrink the logo".
- **Export**: SVG download / copy, PNG (256–4096 px) download / copy (ClipboardItem), print sheet (1, 4, 6 or 12
  copies per page, size in cm, caption) via a print-only layout and `window.print()`.
- Settings are remembered in `localStorage` (`qr-create`). `#text=<encoded>` (from the scanner) loads a payload: the
  matching form when it rebuilds the same content, otherwise the text form with the exact text.

## Scan

- **Image**: drop, paste or pick; decoded at up to 1600 px, retried at 2600 / 900 / 600 px when nothing is found;
  the detected outline is drawn over the picture.
- **Camera**: start / stop, camera choice when there are several (environment-facing by default), about nine scans
  per second on a frame downscaled to 720 px, scanning pauses on a result ("Scan again" resumes). Clear messages for
  no camera, denied permission, busy camera or a browser without camera access.
- **Decoders**: `BarcodeDetector` when the browser has it and it supports `qr_code`; otherwise (or with "Use the
  built-in decoder") `qr/decode.js`. Version, level, mask and corrected errors come from the built-in decoder.
- **Result**: content type with parsed fields (links open with `rel="noopener noreferrer"` in a new tab, http links
  are flagged; Wi‑Fi SSID / password copy; contact with call / mail / save .vcf; event with "add to calendar" .ics;
  location with a `geo:` link and OpenStreetMap; payment fields), raw text with copy, decoder details,
  "Edit in generator" (opens the create page with `#text=`), and a history of the last 20 scans (`qr-history`).

## Files

| file | contents |
|---|---|
| `index.html`, `scan.html` | pages (hidden `#pg-create` / `#pg-scan` anchors give the build-rewritten page links) |
| `main.js` | create page |
| `scan.js` | scan page |
| `common.js` | shell start, app icons, content types, history storage, chip grid widget, raster helpers |
| `strings.js` | UI strings (en, ru, uk, de, fr, es, ka) |
| `app.css` | layout and visuals of both pages, print sheet |
| `server.js` | development server (`node qr-app/server.js`) |

Libraries: `qr/` (`qr.js` encoder, `spec.js`, `decode.js`, `style.js`, `payload.js`), `ui/`, `color/`.

## Limits

- The encoder (`qr/qr.js`) writes one segment (numeric, alphanumeric or UTF-8 bytes); no kanji or mixed segments.
- The camera needs a secure context (https or localhost / file in most browsers) and a granted permission.
- Copying images needs `ClipboardItem` support; otherwise the app suggests the PNG download.
- Printing uses the browser's print dialog; sizes are laid out for A4 / Letter with 12 mm margins.
