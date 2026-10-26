# archive

**Archive formats** (reading only; the writers are in `../pack/`): detection, listing, extraction and testing of ZIP, 7z, RAR (extraction only),
tar, gzip, bzip2, xz, Zstandard, lzma, compress (.Z), ISO 9660 / UDF and ARC in pure JavaScript. The decoders are synchronous
and pull their input from random-access sources, so the same code runs in Node, in a Worker (a `File` is read in
slices with `FileReaderSync` and is never loaded whole) and in a page.

RAR support is decompression only, written from the published format descriptions; there is no RAR compressor in
this repository (not even in the tests), in line with the unRAR licence the user asked to respect.

```js
import { openArchive, bytesSource, fileSource, groupVolumes, readAll } from '../archive/index.js';
const arc = openArchive([bytesSource(bytes, 'photos.7z')], { password: 'secret' });
for (const e of arc.entries) if (!e.dir) console.log(e.path, e.size, readAll(arc.open(e)).length);
```

## Formats and methods

| format | container features | methods |
|---|---|---|
| ZIP | Zip64, data descriptors, UTF-8 / Info-ZIP Unicode names / legacy code pages, NTFS / Unix / extended times, Unix modes and symlinks, split archives (`.z01`… + `.zip`, `.zip.001`…), self-extractors, comments; without a usable central directory (truncated, streamed) the local headers are walked | Stored, Shrunk, Reduced 1-4, Imploded, Deflate, Deflate64, BZip2, LZMA, XZ, Zstandard, PPMd (var. I rev. 1); ZipCrypto, WinZip AES-128/192/256 (AE-1 / AE-2), PKWARE strong encryption with AES-128/192/256 and a password |
| 7z | encoded and encrypted headers, coder graphs with bind pairs, solid blocks, empty files / directories, attributes, times, split volumes (`.7z.001`…), self-extractors | Copy, LZMA, LZMA2, PPMd (var. H), BZip2, Deflate, Deflate64, ZSTD (7-Zip forks), BCJ, BCJ2, ARM, ARMT, ARM64, RISCV, PPC, SPARC, IA64, Delta, Swap2 / 4; 7zAES (AES-256 + SHA-256 key) |
| RAR 5 | volumes, solid, encrypted headers and data (password check value), BLAKE2sp / CRC32 (MAC-converted with encryption), symlinks / hard links / file copies, file versions (`name;N`), times, comments, self-extractors | RAR 5.0 and 7.0 algorithms with the DELTA / E8 / E8E9 / ARM filters |
| RAR 1.5-4.x | volumes (`.partN.rar`, `.rar` + `.r00`…), solid, encrypted headers and data (RAR 3.x AES-128), Unicode names, extended times, comments | RAR 1.5, 2.0 (incl. audio), 2.9 / 3.x LZ + PPMd var. H + standard RarVM filters (E8, E8E9, ITANIUM, DELTA, RGB, AUDIO) |
| tar | v7, ustar, GNU (long names / links, old sparse), pax (path, size, fractional times, sparse 0.0 / 0.1 / 1.0), base-256 numbers, hard links | stored |
| gzip / bzip2 / xz / zstd / lzma / .Z | multi-member gzip, concatenated bzip2, xz and Zstandard streams, skippable frames, checks (xz CRC32 / CRC64 / SHA-256, Zstandard XXH64), a tar inside is listed as tar.gz etc. | Deflate, bzip2, LZMA2 (+ xz filters x86, PPC, IA64, ARM, ARMT, SPARC, ARM64, RISC-V, Delta), Zstandard (no dictionaries), LZMA, LZW |
| ISO 9660 / UDF | primary, Joliet, ISO 9660:1999, Rock Ridge (long names, symlinks, modes, times, relocated directories, zisofs), multi-extent and interleaved files, El Torito boot images (`[BOOT]/`), raw 2352-byte sectors; UDF 1.02-2.60 incl. metadata partitions | stored, zisofs |
| ARC | SEA ARC / PKARC / PKPAK, damaged headers skipped, self-extractors | stored, packed (RLE), squeezed (Huffman), crunched (old / new hash, dynamic), squashed |

Recognised but not supported (a clear error names them): lzip, CAB, ARJ, LHA, cpio, ar / deb, WIM, DMG,
xar, RPM, MSI.

## Files

| file | contents |
|---|---|
| `index.js` | `openArchive(sources, { password, charset, onProgress })` (detection, dispatch, safe paths, `stats`), `cleanPath`, re-exports |
| `io.js` | sources (`bytesSource`, `fileSource`, `concatSource`, `sliceSource`), pull streams, the decoders' `Reader`, checksum streams, `ArchiveError`, binary / date / text helpers (`decodeText`: UTF-8, CP437, CP866, Windows code pages…) |
| `detect.js` | `detectFormat(src)` by signature (and self-extractor scanning), `groupVolumes(names)` |
| `lzma.js` | LZMA, LZMA2, `.lzma` |
| `bzip2.js` | bzip2 (block and stream CRCs, concatenated streams) |
| `filters.js` | branch converters (x86 BCJ, ARM, ARMT, ARM64, RISC-V, PPC, SPARC, IA64), Delta, Swap, BCJ2 |
| `gzip.js` | gzip members, compress (.Z) LZW |
| `xz.js` | the xz container, CRC-64 |
| `zstd.js` | Zstandard (RFC 8878) frames, Huffman / FSE decoding, XXH64 |
| `tar.js` | tar listing / extraction (plain and inside a compressed stream) |
| `compressed.js` | gzip / bzip2 / xz / zstd / lzma / .Z files as archives (tar inside, or one file) |
| `sevenzip.js` | 7z |
| `zip.js` | ZIP methods and encryption on top of `../zip/zip.js` (central directory) and `../zip/crypt.js`; PKWARE strong encryption; `scanLocalHeaders` for archives without a central directory |
| `pkware.js` | Shrink, Reduce, Implode (legacy PKZIP methods) |
| `ppmd7.js`, `ppmd8.js` | PPMd var. H (7z, RAR 3.x range coders) and var. I rev. 1 (ZIP) |
| `rar.js`, `rar5.js` | RAR 1.5-4.x and RAR 5 containers |
| `rarbits.js`, `unpack15.js`, `unpack20.js`, `unpack29.js`, `unpack50.js`, `rarcrypt.js` | RAR bit reader and Huffman tables, the four RAR decompression algorithms, RAR key derivation and ciphers |
| `iso.js` | ISO 9660 and UDF |
| `arc.js` | ARC |
| `test.js` (+ `test-*.js`) | unit tests: `node archive/test.js` (see below) |

Deflate / Deflate64 decoding is `Inflater` in `../codec/zlib.js`; the ZIP writer used for "extract to ZIP" is
`ZipWriter` in `../zip/zip.js`; AES, SHA-1 / SHA-256, HMAC, PBKDF2 and BLAKE2sp come from `../crypto/`.

## Contract of a format module

Every container module exports `open<Format>(sources, opts) -> Archive` (synchronous).

- `sources`: `Source[]` (see `io.js`), the volumes of the archive in order (one element for single-file archives).
  A missing volume surfaces as an `ArchiveError` with code `'volume'` when its data is needed.
- `opts`: `{ password?: string, charset?: 'auto' | TextDecoder label | 'cp437' }` (charset of legacy, non-Unicode names;
  decode them with `decodeText(bytes, opts.charset)` from `io.js`).

```
Archive {
  format: 'rar5',                 // id
  label: 'RAR 5',                 // display name
  entries: Entry[],               // archive order
  info: {
    solid?, encrypted?,           // booleans (encrypted: some entry data is encrypted)
    headersEncrypted?,            // file names are encrypted too
    comment?: string, volumes?: number, sfx?: number (offset of the archive in an executable),
    methods?: string[],           // compression methods used (display)
    warnings?: string[],          // non-fatal problems found while listing
    props?: [label, value][],     // format-specific facts for the summary (English labels)
  },
  password: string | null,        // settable: used by later open() calls
  open(entry) -> Stream,          // decoded data of a file entry; verifies size and checksum at the end
}

Entry {
  index, path,                    // '/'-separated, no leading '/', no trailing '/' (directories have dir: true)
  dir: boolean, kind: 'file' | 'dir' | 'symlink' | 'hardlink' | 'other',
  size?: number, packed?: number, // undefined when unknown
  mtime?: Date, ctime?: Date, atime?: Date,
  mode?: number,                  // Unix mode bits when stored
  attrib?: number,                // DOS / Windows attributes when stored
  method?: string,                // display, e.g. 'LZMA2:24' or 'RAR 2.9'
  encrypted?: boolean, crc?: number, link?: string (symlink / hardlink target),
  comment?: string, solid?: boolean, unsupported?: string (reason known at listing time),
}
```

`openArchive` adds `archive.stats` (`files`, `dirs`, `size`, `packed`, `encrypted`, `unknownSizes`), `entry.id` (index
in the cleaned list) and cleans paths: empty, `.` and `..` segments are dropped (`entry.unsafe` marks a path that
pointed outside), so extracting can never write outside the chosen folder.

Errors are `ArchiveError` (`io.js`) with a `code`: `'format'` (not this format / broken structure), `'corrupt'`,
`'checksum'`, `'password'` (a password is needed and none is set), `'badPassword'` (a check value proves it
wrong), `'unsupported'` (method, version or feature), `'volume'` (a volume is missing), `'truncated'`, `'limit'`.
When encrypted data has no password check value (7z, ZipCrypto's 1-byte check passing by chance), decoding errors in
encrypted data are reported as `'badPassword'` ("wrong password or damaged data").

Streams are pull streams: `read(max) -> Uint8Array | null`; the returned view is only valid until the next `read`.
Decoders read their input through `Reader` (`io.js`): `byte()` returns `-1` at the end of the input.
Solid archives decode in archive order: `open()` calls in that order are cheap; going back re-decodes the solid block
from its start. A tar inside a compressed stream is listed in one pass and extracted with a forward cursor.

## Tests

`node archive/test.js` runs the core suite and the module suites (`test-ppmd.js`, `test-rar.js`, `test-iso.js`,
`test-arc.js`, `test-pkware.js`, `test-libarchive.js`). `test-libarchive.js` embeds eleven small archives of
libarchive's test suite (BSD-2-Clause, credited there) that no tool here can make: RAR 2.9 LZ and PPMd + DELTA data,
RAR 3.x AES data and header encryption, RAR 5 file versions and solid AES, PKWARE strong encryption, odd ISO images. Archives are made on the fly with the tools of the machine when they exist
(7-Zip, bsdtar, Python's `lzma` / `bz2` / `zipfile`) and compared with the original files; without them, small
embedded fixtures made with those tools are used (`ARCHIVE_TEST_NO_TOOLS=1` simulates that;
`node archive/test.js --make-fixtures` regenerates them). Test-only encoders (tar, compress, ARC, Shrink / Reduce /
Implode, stored RAR containers) cover what no tool here produces.

## Limits

- Everything here is read-only: archives are listed, tested and extracted, never modified. Writers live in `../pack/`
  (tar, gzip, bzip2, xz / LZMA2, lzma, Zstandard, 7z) and `../zip/zip.js` (ZIP).
- Throughput in V8 (one core, text-like data): LZMA2 ~100 MB/s, Deflate ~120-150 MB/s, Zstandard ~60-220 MB/s
  (the lower figure with the XXH64 check), bzip2 ~25 MB/s, RAR 5 ~25-65 MB/s, PPMd ~2-4 MB/s; AES adds ~25 MB/s of work.
- Dictionaries (LZMA, RAR) are allocated up to the data size and limited to ~2 GB by JavaScript typed arrays.
- No Zstandard dictionaries, no Brotli or LZ4 (7-Zip forks), no PKWARE strong encryption other than AES with a password
  (3DES / RC2 / RC4, certificates) and no encrypted ZIP central directories, no PAK crushed / distilled ARC methods,
  no RAR 2.0 encryption, no non-standard RarVM programs (never written by WinRAR), no UDF VAT (CD-R).
- Verification status: RAR 5 was checked against real archives (solid and non-solid, m3 / m5, 128 KB - 32 MB
  dictionaries, DELTA / E8 / E8E9 filters, encrypted headers and data) and against archives made with WinRAR 7.22
  over an option matrix (-m0..-m5, solid, volumes, -p / -hp, BLAKE2, recovery record, lock, comments, times, hard
  links, file copies, junctions, SFX). The RAR 2.9 / 3.x decoder (LZ, PPMd blocks, the E8E9 and DELTA RarVM filters,
  AES-128 data and header encryption, solid, volumes, SFX) and the RAR 5 ARM filter were checked against libarchive's
  real test archives. Only unit-tested in parts (no real sample exists here; WinRAR 7 no longer writes RAR 4): the
  RAR 1.5 and 2.0 decompressors (Unpack15 / Unpack20, incl. audio), the RGB / AUDIO / ITANIUM RarVM filters, the RAR
  7.0 algorithm and RAR 1.3 / 1.5 encryption. Reduce (ZIP) and the ARC methods are checked against test-only encoders
  (no other decoder was available).
- libarchive's test archives (287 archives or volume sets for RAR, RAR 5, 7z, ZIP, ISO and tar, many of them crafted
  to be damaged) were compared with 7-Zip 26.01 and bsdtar 3.8.4: no decoding disagreement remains. The differences
  left are names (legacy code pages without a chosen charset, 7-Zip's own naming of sparse files, relocated
  directories and file versions) and crafted archives that libarchive's own tests expect to be refused.
