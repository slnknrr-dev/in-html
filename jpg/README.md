# jpg/

JPEG for browsers, workers and Node: marker segments, EXIF / TIFF metadata, metadata stripping, an encoder (baseline
and progressive) and a decoder (baseline, extended sequential and progressive). Pure functions over bytes,
synchronous, no DOM, no dependencies.

```js
import { decodeJPEG, encodeJPEG, jpegInfo, readExif, exifSummary, stripJpegMetadata } from '../jpg/jpg.js';
```

## Files

| file | contents |
|---|---|
| `jpg.js` | re-exports everything below |
| `segments.js` | `isJPEG`, `readSegments`, `writeSegments`, `segment`, `parseSOF`, `parseDQT`, `parseDHT`, `parseSOS`, `parseAPP`, `iccProfile`, `estimateQuality`, `jpegInfo`, `ZIGZAG`, standard tables |
| `exif.js` | `readTiff`, `readExif`, `exifSummary`, `exifEntries`, `gpsDecimal`, `exifDate`, `buildTiff`, `exifSegmentPayload`, `trimExif`, `jpegOrientation`, `setJpegOrientation`, `ORIENTATIONS`, `TAGS` |
| `strip.js` | `stripJpegMetadata`, `insertExif` |
| `encode.js` | `encodeJPEG`, `qualityTables` |
| `decode.js` | `decodeJPEG` |

## Segments

`readSegments` lists every marker segment with its payload (entropy-coded data after each SOS is attached as
`scanData`), `writeSegments` rebuilds a file from (filtered or extended) segments. `jpegInfo` summarizes size,
components, colour space (gray / YCbCr / RGB / CMYK / YCCK), subsampling (`4:4:4`, `4:2:2`, `4:2:0`, `4:4:0`,
`4:1:1`), process (baseline / extended / progressive / lossless, arithmetic), scan count, estimated IJG quality,
restart interval, JFIF, Adobe, EXIF (TIFF bytes), XMP, ICC (reassembled) and comments.

## EXIF

`readTiff` parses IFD0, the EXIF, GPS and interoperability sub-IFDs and IFD1 (thumbnail bytes) with tag names; bad
offsets never throw. `exifSummary` gives camera, lens, software, author, copyright, description, date taken (ISO with
sub-seconds and offset), orientation, exposure time (`1/250 s`), f-number, ISO, focal length (+ 35 mm), exposure bias,
program, metering, flash, white balance, colour space, pixel size and GPS as decimal degrees (`{ lat, lon, alt,
time, direction, speed }`). `exifEntries` lists every tag as display strings. `buildTiff` writes a minimal IFD0
(e.g. only `Orientation`), `trimExif` prepares an EXIF block for re-encoded pixels (orientation reset, stale thumbnail
removed), `setJpegOrientation` patches the tag in place.

## Metadata stripping

`stripJpegMetadata(bytes, { keepOrientation, keepICC = true, keepJFIF = true, keepComments })` removes EXIF / XMP
(APP1), IPTC (APP13), other APPn blocks and comments without re-encoding. Adobe APP14 is always kept (it defines the
colour transform); `keepOrientation` writes a minimal EXIF block with the original orientation.

## Encoder

`encodeJPEG({ width, height, data: RGBA }, opts)`: `quality` 1-100 (IJG scaling of the Annex K tables),
`subsampling` `'4:2:0'` (default) | `'4:2:2'` | `'4:4:4'`, `grayscale`, `progressive` (libjpeg's standard scan script
with spectral selection and successive approximation), `optimize` (default true: per-scan optimal Huffman tables;
`false` uses the Annex K tables, baseline only), `restartInterval` (MCUs), `background` (alpha is composited over it),
`jfif` / `density`, `exif` (TIFF bytes or an `Exif\0\0` payload), `icc` (split over APP2 chunks), `comment`.
Colour conversion and the float AAN DCT run one MCU row at a time, so memory stays near the coefficient storage.

## Decoder

`decodeJPEG(bytes, { maxPixels, fancyUpsampling = true })` -> `{ width, height, data: RGBA, colorSpace, components,
progressive, subsampling, orientation, jfif, adobe, exif, icc, comments }`. Huffman baseline / extended (8-bit) and
progressive JPEGs with any sampling factors and restart markers; truncated data decodes as far as it goes. The
integer IDCT (libjpeg "islow"), "fancy" triangle upsampling for 2x1, 2x2 and 1x2 chroma and the fixed-point colour
conversion follow libjpeg-turbo, so pixels match Chrome exactly on the tested files. CMYK and YCCK use the Adobe
inverted convention. The EXIF orientation is reported, not applied.

## Limits

No arithmetic coding, lossless, hierarchical or 12-bit JPEGs (they throw), no DNL-defined heights, no colour
management, no JPEG XL / JPEG 2000. EXIF MakerNotes are reported by size only.

## Verification

Node: every encoder mode (qualities, subsamplings, standard / optimized tables, restart, progressive, grayscale, odd
and tiny sizes, alpha) decodes back with the expected PSNR; progressive and baseline give identical pixels;
quality estimates match; EXIF fixture (IFD0 / EXIF / GPS / IFD1 thumbnail) parses; stripping keeps pixels.
Chrome: our JPEGs and Chrome's own `canvas.toBlob` JPEGs decode to exactly the pixels Chrome produces.
