# qr

QR Code (ISO/IEC 18004) library: encoder, tables, decoder, styled SVG renderer and payload formats. Pure ES modules,
no DOM at module evaluation, importable in Node and browsers.

| file | purpose |
|---|---|
| `qr.js` | encoder: `qrMatrix(text, ec)`, `qrSVG(text, opts)` |
| `spec.js` | tables and capacity math shared by the other modules |
| `decode.js` | decoder for images and sampled matrices |
| `style.js` | styled SVG (module / finder shapes, gradients, logo) and logo coverage analysis |
| `payload.js` | payload builders (Wi‑Fi, vCard, MeCard, event, …) and a parser of scanned text |

## qr.js

- `qrMatrix(text, ec = 'M')` → `boolean[][]` (`m[row][col]`, `true` = dark). One segment: numeric when all digits,
  alphanumeric for `[0-9A-Z $%*+-./:]`, otherwise UTF-8 bytes (no ECI header). Smallest version, best mask.
- `qrSVG(text, { ec, fg, bg, margin, title })` → compact `<svg>` (one path of merged runs).

## spec.js

- Constants: `EC_LEVELS`, `EC_BITS`, `EC_RECOVERY` (nominal 7 / 15 / 25 / 30 %), `ALNUM`, `MODE`, `formatWords()`,
  `versionWords()` (built on first use).
- Sizes and blocks: `sizeOfVersion(v)`, `versionOfSize(n)`, `rawModules(v)`, `totalCodewords(v)`, `remainderBits(v)`,
  `dataCodewords(v, ec)`, `capacityBits(v, ec)`, `ecCodewordsPerBlock(v, ec)`, `ecBlockCount(v, ec)`,
  `blockLayout(v, ec)` → `{ ecLen, dataLens, total }`, `codewordOrder(v, ec)` (interleaving).
- Layout: `alignmentPositions(v)`, `functionModules(v)` (Uint8Array labels: finder, timing, alignment, format,
  version), `dataModulePositions(v)` (module index of every data bit in placement order), `maskBit(mask, row, col)`.
- Format / version information: `formatWord(ec, mask)` (BCH(15,5) ^ 0x5412), `versionWord(v)` (BCH(18,6)),
  `nearestFormat(word)`, `nearestVersion(word)` (Hamming distance), `popcount(x)`.
- Modes and capacity (mirrors `qr.js`): `chooseMode(text)`, `segmentOf(text)`, `payloadBits(mode, n)`,
  `charCountBits(mode, v)`, `maxChars(v, ec, mode)`, `versionFor(segment, ec)`.
- `qrInfo(text, ec)` → `{ fits, version, size, ec, mode, count, dataBits, capacityBits, fill, charsLeft, maxChars }`
  without building the matrix (`size` always equals `qrMatrix(text, ec).length`).

## decode.js

- `decodeQR({ data, width, height }, opts?)` → result or `null` for an RGBA image (ImageData works; alpha is
  composited over white). `opts`: `inverted` (`true` also tries light-on-dark, `false`, `'only'`), `effort`
  (`'normal'`: retries on a smoothed copy and at half size for large images; `'fast'`: one pass, for camera frames),
  `maxTriples` (finder triples tried, default 8), `debug` (object filled with intermediate data).
- `decodeMatrix(m, dark = true)` → result or `null` for an already sampled `m[row][col]` grid (mirrored grids are read
  transposed). Never throws.
- `rsCorrect(block, ecLen)` → corrected count or -1 (Reed–Solomon over GF(256), 0x11D).
- Result: `{ text, bytes, segments, version, ecLevel, mask, errorsCorrected, formatDistance, versionDistance,
  location?, mirrored?, inverted?, eci?, fnc1?, structuredAppend? }`. `bytes` are the payload bytes of all segments
  (byte mode raw, numeric / alphanumeric as ASCII, kanji as Shift_JIS); `segments` lists
  `{ mode, text, bytes?, charset? }` and `{ mode: 'eci', value }`. `location`: symbol corners `topLeft`, `topRight`,
  `bottomRight`, `bottomLeft` in image pixels, plus `finders`, `alignment` and `moduleSize`.

Pipeline: luminance → hybrid binarization (8×8 block black points, flat-block estimate from neighbours, noise floor
from the quietest blocks, 5×5 block threshold average) → finder search (row scan for 1:1:3:1:1, vertical /
horizontal / diagonal cross-checks, centre refinement, clustering) → finder triples ranked by right-isosceles shape
→ orientation by cross product → module size from black-white-black runs → dimension (snapped to 4v+17) and version
information read next to the finders before sampling → perspective-aware homography from the finders (module-size
change along each edge) → progressive alignment-pattern search (template matching along local axes, nearest to the
known points first) → least-squares homography over finders + alignment patterns (outliers dropped), then the
bottom-right quad and the finder homography as fallbacks → grid sampling (centre or 5-point vote) → format
information (both copies, ≤ 3 bit errors) → version information (both copies, ≤ 3) → unmask → codewords → blocks →
Reed–Solomon (syndromes, Berlekamp–Massey, Chien, Forney, verified) → segments: numeric, alphanumeric (FNC1 `%`
handling), byte (ECI charsets via TextDecoder; without ECI strict UTF-8, else ISO-8859-1), kanji (Shift_JIS), hanzi
(GB2312), ECI, structured append, FNC1. Mirrored symbols: transposed grid; inverted symbols: inverted bitmap.

Measured (Node 24, scratch tests): every version 1–40 × level × mode decodes from `qrMatrix` exactly (640/640);
`floor(ecc/2)` corrupted codewords per block always corrected with exact counts (320/320), beyond capacity always
rejected (320/320 null); rendered images with rotation, perspective, noise, blur, uneven light, inversion and mirror:
100 % for versions 1–20 at ≥ 3 px/module, v40 at 4 px/module; about 45–80 ms for a 1000×1000 image.

## style.js

- `qrStyledSVG(matrix, opts)` → `<svg>` string. `opts`: `fg`, `bg` (`'transparent'` for none), `gradient`
  (`{ type: 'linear' | 'radial', from, to, angle }`, angle in CSS degrees), `quiet` (0–10), `moduleStyle`
  (`MODULE_STYLES`: square, rounded, dots, diamond, bars), `finderStyle` / `eyeStyle` (square, rounded, circle),
  `logo` (`{ href: data URL, size: fraction of the matrix width ≤ 0.4, pad: modules, plate }`), `title`, `id`
  (gradient id prefix), `size` (px; default 100 %). One path per layer: modules, finder rings, finder centres.
  "Rounded" rounds only the free corners of each module and adds concave fillets where three dark neighbours meet.
- `qrLogoBox(n, logo)` → cleared area (kept clear of finders, format and version areas; `null` when the version is
  too small for a logo).
- `qrLogoCover(matrix, logo, ec)` → `{ mask, cleared, dataCleared, dataModules, ratio, codewordsHit,
  worstBlock: { hit, budget }, load, nominal, box }`: `load` > 1 means the busiest block has more hidden codewords
  than Reed–Solomon can repair.

## payload.js

- `buildPayload(type, fields)` for `PAYLOAD_TYPES` (`text`, `url`, `wifi`, `contact`, `email`, `sms`, `phone`, `geo`,
  `event`, `crypto`) and the individual builders `normalizeURL`, `normalizePhone`, `wifiPayload`, `vcardPayload`,
  `mecardPayload`, `emailPayload`, `smsPayload`, `phonePayload`, `geoPayload`, `eventPayload`, `cryptoPayload`.
- `parsePayload(text)` → `{ type, fields }` with the builders' field names (also MATMSG, folded vCard lines,
  VCALENDAR wrappers, EIP-681 addresses); unknown content is `{ type: 'text', fields: { text } }`. Only `http(s)` is
  classified as a link.
- `payloadIssues(type, fields)` → problem codes (`empty`, `url`, `email`, `phone`, `lat`, `lon`, `dates`,
  `address`, `amount`); `validCryptoAddress(coin, address)`; `COINS` (scheme → symbol, address pattern).

## Limits

- `qr.js` encodes one segment without ECI; kanji, mixed segments and structured append are decoded but not encoded.
- The decoder reads one code per image (the best finder triple that decodes); Micro QR and rMQR are not supported.
- Strong lens distortion or curved surfaces beyond a projective transform may need a sharper or flatter picture.
