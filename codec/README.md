# codec

Byte-level codecs shared by the libraries and applications (pure ES modules; browsers, workers and Node).

| module | API |
| --- | --- |
| `base64.js` | `b64encode(bytes)` (chunked, multi-MB safe), `b64decode(text)` (base64url accepted), `isB64(text)` (strict check used for attachment payloads) |
| `deflate.js` | `compress(bytes \| string, format)` / `decompress(bytes, format)` through the platform Compression Streams (`'deflate-raw'`, `'deflate'`, `'gzip'`); `deflate(input)`, `inflate(bytes)` (UTF-8 text) |
| `zlib.js` | synchronous pure-JS deflate / inflate (RFC 1951) and the zlib wrapper (RFC 1950): `deflateRawSync`, `inflateRawSync`, `zlibSync`, `unzlibSync`; levels 0–9, each block stored / fixed / dynamic Huffman, whichever is smallest; `Inflater`: streaming inflate with bounded memory over a byte input (`{ byte(), chunk? }`), Deflate and Deflate64 (ZIP method 9), `alignedByte()` for the data after the stream (gzip trailers, next member) |
| `crc32.js` | `crc32(bytes, start, end, prev)` (IEEE, as in zip / png / gzip), `adler32(bytes, start, end, prev)` (zlib) |

`deflate.js` is the fast path where Compression Streams exist (exports, ZIP files); `zlib.js` works everywhere,
synchronously (PNG chunks, workers, Node tests).

### Binary-to-text encodings

Every encoder takes a `Uint8Array` and returns a string (yEnc: a `Uint8Array`, it is 8-bit); every decoder returns a
`Uint8Array` and throws an `Error` with a readable message on invalid input. Checked against Python's `base64`,
`binascii`, `quopri`, `urllib.parse` and `codecs` (punycode, idna), and against the published vectors of each
specification (RFC 4648, RFC 9285, BIP-173 / BIP-350, Base58 / Base58Check, Z85, Crockford, z-base-32).

| module | API |
| --- | --- |
| `radix.js` | `radixEncode(bytes, alphabet)` / `radixDecode(text, alphabet, { caseless })`: the input as one big-endian number (Base26, Base36, Base58, Flickr Base58, Ripple Base58, Base62, …; leading zero bytes kept as leading zero digits; BigInt divide and conquer, ~20 ms for 16 KiB); `byteDigits(bytes, base, { sep, pad, upper })` / `parseByteDigits(text, base)`: binary, octal, decimal or hex digits per byte; `RADIX` alphabets |
| `rfc4648.js` | `bitsEncode(bytes, alphabet, { pad, wrap })` / `bitsDecode(text, alphabet, { caseless, aliases, ignore })`: 4, 5 or 6 bits per character; alphabets `B16`, `B32`, `B32HEX`, `CROCKFORD` (+ `CROCKFORD_ALIASES`), `ZBASE32`, `B64`, `B64URL`, `GMP64` |
| `base45.js` | `base45Encode`, `base45Decode` (RFC 9285, QR alphanumeric) |
| `base85.js` | `base85Encode(bytes, alphabet)` / `base85Decode` (RFC 1924 letters by default, `Z85`), `ascii85Encode(bytes, { adobe, foldSpaces, wrap })` / `ascii85Decode` ('z' and 'y' groups, `<~ ~>`) |
| `base91.js` | `base91Encode`, `base91Decode` (basE91) |
| `base92.js` | `base92Encode`, `base92Decode` |
| `base100.js` | `base100Encode`, `base100Decode` (one emoji per byte) |
| `bech32.js` | `bech32Encode(hrp, words, variant, { limit })`, `bech32Decode(text, { limit })`, `toWords`, `fromWords`, `encodeBytes`, `decodeBytes` (Bech32 and Bech32m) |
| `uu.js` | `uuEncode(bytes, { table: 'uu' | 'xx', name, mode, frame })`, `uuDecode(text, { table: 'auto' })` → `{ bytes, name, mode }` (UUencode and XXencode) |
| `yenc.js` | `yencEncode(bytes, { name, line })` → `Uint8Array`, `yencDecode(bytes | latin1)` → `{ bytes, name, size, crc32, sizeOk, crcOk }` |
| `quoted-printable.js` | `qpEncode(bytes, { binary, lineLength, eol })`, `qpDecode(text)` (RFC 2045) |
| `percent.js` | `percentEncode(bytes, { mode: 'component' | 'uri' | 'form' | 'all', lower })`, `percentDecode(text, { plus })` |
| `punycode.js` | `punycodeEncode`, `punycodeDecode` (RFC 3492), `domainToASCII`, `domainToUnicode` (IDNA "xn--" labels) |

Base58Check needs SHA-256 and lives in `crypto/base58check.js`. Unit tests: `node codec/test.js` (or
`node check.js tests codec`).
