# pack/

**Archive creation** in pure JavaScript (no dependencies, synchronous, Node and browsers): tar, gzip, bzip2,
xz / LZMA2, .lzma, Zstandard and 7z writers, plus ZIP through `../zip/zip.js`. The reading side is `../archive/`;
together they make a full archiver (`archive-processor/` uses both: create, add to, delete from archives).

```js
import { packArchive, packFormatOf } from '../pack/index.js';
const bytes = await packArchive('tar.xz', [
  { path: 'docs', dir: true },
  { path: 'docs/readme.txt', data: new TextEncoder().encode('hello'), mtime: Date.now(), mode: 0o644 },
], { level: 6 });
packFormatOf('backup.tgz'); // 'tar.gz'
```

## Files

| file | contents |
|---|---|
| `index.js` | `packArchive(format, entries, { level })` → `Promise<Uint8Array>`, `PACK_FORMATS` (`{ id, label, ext, single?, levels: [min, max, default] }`), `packFormatOf(name)`, `compressStream(format, bytes, opts)`; re-exports every writer |
| `tar.js` | `tar(entries, { pax })`, `tarHeader(entry, size)`: POSIX ustar, pax `x` headers for long / non-ASCII paths and link targets, sizes ≥ 8 GiB and fractional times; directories, symbolic and hard links; records padded to 10 240 bytes |
| `gzip.js` | `gzip(data, { level, name, mtime, comment })`: one RFC 1952 member (name, time, OS, CRC-32, ISIZE) with Deflate from `../codec/zlib.js` |
| `bzip2.js` | `bzip2(data, { level })`: RLE1, Burrows–Wheeler transform (`bwtOrder`: cyclic prefix doubling with radix sorts), MTF + RUNA / RUNB, 2–6 Huffman tables refined in four passes, selectors per 50 symbols, block and combined stream CRCs; block size `level × 100 000` |
| `lz.js` | `Matcher`: hash chains over 3-byte prefixes in a window of the input (depth and nice length per level), `matchLen` |
| `lzma.js` | LZMA encoder (range coder, literals and matched literals, matches, four repeat distances, short reps; lc 3, lp 0, pb 2) with a greedy parser and one step of lazy evaluation; `lzma2(data, { level })` (compressed chunks ≤ 2 MiB / 64 KiB, stored chunks when data does not shrink, state resets), `lzma2DictProp`, `lzmaAlone` (.lzma), `lzmaLevel` |
| `xz.js` | `xz(data, { level, check: 'crc64' \| 'crc32' \| 'none' })`: stream header / footer, one LZMA2 block, index |
| `zstd.js` | `zstd(data, { level, checksum })`: a single-segment frame with the content size and the XXH64 checksum; raw, RLE and compressed blocks of ≤ 128 KiB; Huffman literals (four streams, direct weights) or raw / RLE literals; sequences with the predefined FSE tables from a hash-chain parse with lazy evaluation |
| `sevenzip.js` | `sevenZip(entries, { level })`: one solid LZMA2 folder (Copy when data does not shrink), a plain header with sizes, CRC-32s, UTF-16 names, empty files and folders, times, Windows attributes with the Unix mode (symlinks as p7zip stores them) |
| `test.js` | unit tests: `node pack/test.js` |

Entries everywhere: `{ path, data?: Uint8Array, dir?: boolean, kind?: 'file' | 'dir' | 'symlink' | 'hardlink',
link?: string, mtime?: Date | number (ms), mode?: number, attrib?: number }`. Single-stream formats (gz, bz2, xz, zst,
lzma) take exactly one file (`packArchive` throws an error with `code: 'single'` otherwise).

## Tests and compatibility

`node pack/test.js` (or `node check.js tests pack`): round trips of every writer through the readers of `../archive/`
(themselves checked against real archives); byte-exact reference outputs of xz-utils (`xz` of the empty input) and
bzip2 (empty stream); CRCs in the containers (gzip trailer, 7z CRCs, the 7z start header CRC); damaged data detected
by the checks (bzip2 block CRC, xz check, Zstandard XXH64, 7z); several bzip2 blocks, several 2 MiB LZMA2 chunks,
several Zstandard blocks, incompressible data (stored LZMA2 chunks, raw Zstandard blocks, 7z Copy). When the tools
exist on the machine, the outputs are also decoded by the reference implementations: Node's zlib (gzip and, from
Node 22.15, Zstandard), `xz` (xz and .lzma), `bzip2` and 7-Zip (`7z t` of every archive format). On this machine all
of them agree.

## Limits

- Compression is simpler than in the reference tools (measured on 3.2 MB of JavaScript sources): no optimal parsing,
  so LZMA output is ~5–12 % larger than `xz -6`; Zstandard uses only the predefined FSE tables and no repeat offsets
  (~15 % larger than `zstd -3`); bzip2 and gzip are on par with `bzip2 -9` and `gzip -6`.
- Everything is built in memory (input and output as `Uint8Array`); a browser keeps the whole archive while packing.
- Speed in V8 on one core (same sources): LZMA level 6 ~4 MB/s, level 1 ~9 MB/s, bzip2 ~2 MB/s, Zstandard ~5 MB/s,
  gzip ~13 MB/s.
- Not written: RAR (never: the unRAR licence), encryption (7z AES, ZIP AES), multi-volume archives, 7z filters (BCJ),
  xz multi-block streams, Zstandard dictionaries.
