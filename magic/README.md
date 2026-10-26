# magic/

**File types by content** (magic numbers) and **binary layouts** of known formats for hex viewers. Pure ES modules
without dependencies (only `../codec/crc32.js` for the PNG / 7z CRC checks), Node and browsers. `../mime.js` stays the
extension → media type table of the dev server and the builder; this folder looks inside the bytes.

```js
import { detectType } from '../magic/index.js';
detectType(firstBytes, 'photo.dat'); // { mime: 'image/png', ext: 'png', label: 'PNG image', kind: 'image', by: 'signature' }
```

## Files

| file | contents |
|---|---|
| `index.js` | `detectType(bytes, name?)` → `{ mime, ext, label, kind, by: 'signature' \| 'text' \| 'name' \| 'none', detail? }`, `mimeOfName(name)`, `SIGNATURES` (the table) |
| `structure.js` | `describeStructure(head, { size, tail, tailOffset })` → `{ format, fields: [{ start, end, name, value, group, ok? }] }` |
| `test.js` | unit tests: `node magic/test.js` |

## Detection (index.js)

- **Signatures** (more than 100): archives and compressed streams (ZIP, 7z, RAR 4 / 5, gzip, bzip2, xz, Zstandard, LZ4,
  lzip, .Z, LHA, ARJ, CAB, tar, ar, cpio, RPM, xar, WIM, ISO 9660, SquashFS, cramfs, VHDX, VMDK, QCOW, ARC), images
  (PNG, JPEG, GIF, BMP, TIFF / BigTIFF, ICO / CUR, ICNS, PSD, JPEG XL, JPEG 2000, QOI, OpenEXR, DDS, PCX, XCF, Radiance
  HDR, Netpbm), audio (MP3 with or without ID3, AAC ADTS, FLAC, MIDI, AIFF, Sun audio, AMR, APE, WavPack, Musepack,
  Ogg), video (Matroska / WebM, FLV, MPEG PS / ES / TS, ISO BMFF, QuickTime, ASF), documents (PDF, PostScript, RTF,
  compound files, DjVu, CHM, Mobipocket, FictionBook), databases and data (SQLite, Parquet, KeePass, OpenPGP, DER,
  BitTorrent, Blender, glTF, STL, pcap / pcapng), fonts (WOFF / WOFF2, OpenType, TrueType, collections, EOT),
  executables (PE with machine and DLL flag, ELF with class and type, Mach-O, universal binaries, Java class, Dalvik,
  WebAssembly, Flash).
- **Containers refined by content**: ZIP → DOCX / XLSX / PPTX / other OOXML, ODT / ODS / ODP / ODG and EPUB (stored
  `mimetype`), JAR, APK, XPI, KMZ, 3MF; RIFF → WAV / AVI / WebP / ANI / RMI; ISO BMFF brands → MP4 / M4A / M4V / MOV /
  3GP / HEIC / HEIF / AVIF / CR3; Ogg → Opus / Vorbis / FLAC / Theora / Speex; EBML DocType → WebM / Matroska;
  compound files → MSI (root CLSID), DOC / XLS / PPT / MSG (stream names).
- **Text**: BOMs (UTF-8, UTF-16 LE / BE, UTF-32), UTF-8 / ASCII / 8-bit, then HTML, SVG, XML, FictionBook, JSON,
  shebang scripts (Python, Node, shell), PEM, iCalendar, vCard, WebVTT; otherwise the extension or plain text.
- The name breaks ties only (and serves when the bytes say nothing): a PNG named `.jpg` is a PNG.

## Structures (structure.js)

ZIP (local headers with every field, names, data, data descriptors, the central directory and the end record — read
from the tail when only the head and the tail of a large file are given), PNG (chunks with decoded IHDR / tEXt / pHYs
and the CRC of every chunk checked), gzip (header fields, Deflate data, trailer), JPEG segments, GIF, BMP, RIFF chunks,
tar headers, 7z (start header with its CRC checked), xz, bzip2, Zstandard, ELF, PE (DOS header, stub, COFF header),
SQLite, PDF. Fields are disjoint byte ranges in file order; `group` numbers the structures so neighbours can be coloured
apart; `ok: false` marks a failed check.

## Limits

- Detection reads the start of the file only (64 KiB is plenty; ISO 9660 needs 34 KiB); formats identified by their
  end (DMG) or without a signature (raw MPEG audio without frames at the start, headerless data) are not recognised.
- Structures walk the bytes they are given (`archive-processor` passes the first MiB and, for ZIP, the last 64 KiB).
