# png/

PNG for browsers, workers and Node: decoder, encoder, palette quantizer and chunk tools. Pure functions over bytes,
synchronous (zlib through `../codec/zlib.js`), no DOM, no dependencies.

```js
import { decodePNG, encodePNG, quantize, readChunks, stripMetadata } from '../png/png.js';
```

## Files

| file | contents |
|---|---|
| `png.js` | re-exports everything below |
| `decode.js` | `decodePNG(bytes, { depth16, crc, maxPixels })`, `pngInfo(bytes)`, `ADAM7`, `COLOR_TYPES` |
| `encode.js` | `encodePNG({ width, height, data }, opts)`, `analyzePNG(image)` |
| `quantize.js` | `quantize(rgba, w, h, opts)`, `buildPalette(rgba, opts)`, `mapToPalette(rgba, w, h, palette, opts)` |
| `chunks.js` | `isPNG`, `readChunks`, `makeChunk`, `writeChunks`, `readText`, `parseTextChunk`, `textChunk`, `setText`, `stripMetadata`, `apngInfo`, `PNG_SIGNATURE` |

## Decoder

- Every colour type and bit depth: gray 1/2/4/8/16, RGB 8/16, palette 1/2/4/8, gray + alpha 8/16, RGBA 8/16;
  `tRNS` for gray, RGB and palette; Adam7 interlacing; split `IDAT`s.
- Output RGBA: `Uint8ClampedArray` (16-bit samples by their high byte, as browsers do) or, with `depth16`,
  `Uint16Array` (8-bit sources scaled by 257, low depths stretched to 0..65535).
- `info`: header, palette, transparency, `gAMA`, `sRGB`, `iCCP` (name + inflated profile), `cHRM`, `sBIT`, `pHYs`
  (with dpi), text (`tEXt`, `zTXt`, `iTXt`), `tIME`, `bKGD`, `eXIf` (raw TIFF), APNG animation info, chunk list.
- `crc: true` rejects critical chunks with a bad CRC; ancillary chunks that are malformed are skipped.
- The APNG default image is decoded; frames are described by `apngInfo`, not rendered. Pixels are not
  colour-managed (gamma / ICC are reported, not applied).

## Encoder

`encodePNG(image, opts)` with RGBA input (8-bit, or `Uint16Array` for 16-bit):

- `colorType: 'auto'` picks the smallest exact representation: palette (1/2/4/8 bit, translucent entries first so
  `tRNS` stays short), gray 1/2/4/8 (also with a `tRNS` key colour for binary transparency), gray + alpha, RGB (with
  a `tRNS` key colour when an unused colour exists), RGBA. Forced types: `rgba`, `rgb`, `gray` (Rec. 601 luma of
  colour input), `gray-alpha`, `palette`.
- `filter: 'adaptive'` (per-row minimum sum of absolute differences, libpng's heuristic) or one fixed filter;
  palette and sub-byte images stay unfiltered.
- `level` 0-9 (zlib levels of `codec/zlib.js`), `interlace` (Adam7).
- Lossy PNG-8: `colors` 2-256 quantizes when the image has more colours (`quantizer` `'mediancut'` | `'octree'`,
  `dither` 0..1).
- Chunks: `srgb`, `gamma`, `iccp { name, profile }`, `chrm`, `phys { dpi }`, `time`, `text` (array or object;
  Latin-1 -> `tEXt`/`zTXt`, other text -> `iTXt`), `chunks [{ type, data, after }]` for anything else (e.g. `eXIf`).
- 16-bit input keeps 16-bit samples (alpha / colour reduction only) unless `depth16: false`.

## Quantizer

5-bit-per-channel histogram (alpha as a 4th channel when the image is not opaque; fully transparent pixels share
one entry), median cut with least-squares split points or octree reduction, then weighted k-means refinement
(`refine`, default 2 rounds). Mapping uses a nearest-colour cache; Floyd-Steinberg dithering is serpentine with an
adjustable strength.

## Chunk tools

`readChunks` lists chunks (views into the input, optional CRC check), `writeChunks` / `makeChunk` build files,
`readText` / `setText` read and replace text chunks, `stripMetadata(bytes, { keepColor, keepPhys, keepText, keep })`
removes text, time, EXIF, background and private chunks without touching pixels, `apngInfo` returns frame count,
loops and per-frame size, offset, delay (ms), dispose and blend.

## Limits

No colour management, no APNG frame compositing, encoder palette is at most 256 entries, no 16-bit palette
quantization. Level 9 is slow on highly repetitive data (pure JS, zlib's level 9 chain lengths).

## Verification

Reference PNGs of every colour type / depth / interlace / `tRNS` combination (written with `node:zlib`) decode
exactly; encoder round trips (all options) are lossless; encoder output inflates with `node:zlib`; Chrome's decoding
of the same files (canvas `getImageData`) matches the decoder pixel for pixel.
