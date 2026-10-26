# ico/

Windows icon files (`image/vnd.microsoft.icon`, `.ico`) for browsers, workers and Node: no DOM, no dependencies
besides `../png`.

```js
import { encodeICO, decodeICO, icoInfo, ICO_MIME } from '../ico/ico.js';
const bytes = encodeICO([img256, img48, img32]);          // RGBA images { width, height, data }, 1..256 px
const images = decodeICO(bytes);                           // [{ width, height, data, bpp, png }], largest first
```

- `encodeICO(images, { png: 'auto' | 'all' | 'none', level })` — one entry per image, sorted largest first;
  `'auto'` stores 256 px as PNG (Vista and later) and smaller sizes as 32-bit BMP with the 1-bit AND mask, which every
  Windows version and icon reader understands.
- `encodeBMPEntry(img)` — one BMP entry (BITMAPINFOHEADER with double height, bottom-up BGRA, AND mask).
- `icoInfo(bytes)` — the directory without decoding (`.cur` files too).
- `decodeICO(bytes)` — PNG and BMP entries (32, 24, 16 bit, 8 / 4 / 1 bit palettes); transparency from alpha, or
  from the AND mask for old icons without alpha. Broken entries are skipped.

Used by `image-processor` (ICO output and input) and `icon-creator`. Tests: `node ico/test.js` (also covers
`raster/wand.js`).
