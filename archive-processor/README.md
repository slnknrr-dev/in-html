# archive-processor

Archive processor in the browser, fully offline (standalone class: no network at all, works from `file://`). Archives
are dropped, pasted or picked; they are listed, previewed, tested and extracted on this device, and a two-panel
commander in the manner of Far Manager creates archives, opens them as folders and copies files into, out of and
between them. RAR archives can be extracted but never created (the unRAR licence allows decompression only; this
repository has no RAR compressor).

Artifact: `html@5_offline_singlefile/index.html` (`node singlefile.js archive-processor`), multi-file copy in `html@5_offline/`.
Development: `node archive-processor/server.js`, then open `/archive-processor/`.

## Features

- **Formats** (detected by signature, not by extension): ZIP (Deflate, Deflate64, BZip2, LZMA, XZ, Zstandard, PPMd,
  Shrink, Reduce, Implode; ZipCrypto, WinZip AES and PKWARE strong encryption with AES; Zip64; archives without a
  central directory - truncated downloads, streamed ZIPs - are read from their local headers), 7z (LZMA, LZMA2, PPMd,
  BZip2, Deflate / 64, Zstandard, BCJ, BCJ2, ARM, ARMT, ARM64, RISC-V, PPC, SPARC, IA64, Delta; AES-256 incl.
  encrypted headers; solid), RAR 5 and RAR 1.5-4.x
  (extraction only; solid, volumes, encrypted data and headers), tar (ustar, pax, GNU, sparse), tar.gz / tgz,
  tar.bz2, tar.xz, tar.zst, tar.lzma, tar.Z, gz, bz2, xz, zst (Zstandard), lzma, Z, ISO 9660 (Joliet, Rock Ridge,
  El Torito) and UDF, ARC. Self-extracting executables (7z, RAR, ZIP SFX) and RAR archives appended to other files
  open as the archive they contain. See `../archive/README.md`.
- **Multi-volume**: drop or pick all parts together (`name.part1.rar`…, `name.rar` + `name.r00`…, `name.7z.001`…,
  `name.z01` … `name.zip`); they are grouped and ordered by name. Several unrelated archives can be dropped at once
  and switched in the archive bar.
- **Summary**: format, files, folders, total and packed size, ratio, methods, encryption (data / names), solid,
  volumes, self-extractor offset, archive comment and format details (7z blocks, xz check, ISO volume label, …).
- **File list**: tree with folders that open and close, or all files flat; search by substring or `*` / `?`
  wildcards; columns name, size, packed, modified, method, sortable (folders first); check boxes with folder states
  (none / some / all). Virtualized, so archives with hundreds of thousands of entries stay fast. Keyboard: arrows,
  Home / End, Page Up / Down, Space selects, Enter opens, Left / Right close / open folders, Ctrl+A selects all.
- **Context menu** of a row - right click, a long press with a finger or a pen (instead of the system's text
  selection and callout), the Menu key or Shift+F10 on the focused row (`ui/contextmenu.js`): for a file Open
  (details and preview), Open as archive (archives inside), Extract this file, Test this file; for a folder Expand /
  Collapse, Extract folder (one ZIP named after the folder), Test folder; then Select / Deselect, Extract the
  selection when the row is part of a larger one, Copy name, Copy path and Properties (a folder's files, folders,
  sizes). On touch screens Select comes first: a long press is how a phone selects.
- **Details and preview** (click a file): path, sizes, ratio, times, method, CRC-32, DOS attributes and Unix mode,
  link target, comment; text preview (UTF-8, UTF-16 with BOM, Windows-1251 / 1252 by guess; first 512 KB), image
  preview (PNG, JPEG, GIF, WebP, AVIF, BMP, ICO, SVG as an image), hex dump of other files; "Download" and, for
  archives inside the archive, "Open as archive".
- **Extraction** of the selection or of everything: one file is downloaded as it is; several files are packed into
  one ZIP built in the browser (stored or deflated, Zip64 when needed, directories and times kept); or, where the
  File System Access API exists (Chrome, Edge), written into a folder you choose with the subfolders recreated.
  Paths are cleaned (`..` and absolute paths cannot leave the chosen folder); Windows-invalid characters are replaced
  when writing to a folder. Links and devices that browsers cannot create are skipped and reported.
- **Test archive**: decodes the selection or every file and verifies its checksum (CRC-32, BLAKE2sp, AES
  authentication codes, xz checks), with a report (status per file, speed) that can be saved as text.
- **Passwords**: asked when needed (encrypted names when opening, encrypted data when reading); a wrong password is
  detected by the format's check value where there is one (RAR 5, RAR 3.x headers, WinZip AES, ZipCrypto) and
  reported; otherwise (7z) decoding errors in encrypted data are reported as "wrong password or damaged data". The
  password stays in memory for the session only.
- **Name encoding** for old archives with non-Unicode names: automatic (UTF-8, else CP866 / Windows-1251 / CP437 by
  guess) or chosen (CP866, Windows-1251, CP437, Windows-1252, KOI8-R, ISO 8859-2, Shift_JIS, GBK, Big5, EUC-KR).
- **Progress and cancel** for opening, extracting, testing and previews; errors are explained (unknown format,
  unsupported method, missing volume, truncated or damaged archive, wrong password).
- 7 UI languages, light / dark, phones from 375 px wide (list first, secondary columns hidden).

### Commander (two panels)

Opened from the start screen or the archive bar ("Two-panel commander"); the choice is remembered. The workspace is a
tree of files in memory: dropped on a panel, pasted, added with "Add files" / "Add folder", created (folders, text
files) or produced by packing; "Save to device" (Ctrl+S) downloads the selection (one file as it is, several as a
ZIP).

- **Two panels** with name, size, date and type columns (the type comes from the file's signature, see MIME below), a
  path line (`/docs`, `/backup.tar.gz:/src`, nested archives as `/a.zip:inner/b.tar:/x`), an info line (the file
  under the cursor with its MIME type, or the selection with its total size), the command line and the F-key bar
  (Shift and Alt show their own labels while held; the keys are buttons for mice and fingers). Phones show one panel
  at a time with Left / Right tabs above it.
- **Keys of Far Manager**: arrows, Home / End, Page Up / Down, Enter (folder, archive, or view), Backspace and
  Ctrl+PgUp (parent), Ctrl+PgDn (open the file as an archive), Ctrl+\ (workspace root), Tab (other panel), Insert and
  Space (select and move on), Shift+arrows, Ctrl+A, * (invert), F1 help, F2 pack, F3 view, F4 edit, Shift+F4 new
  file, F5 copy, F6 move, Shift+F6 rename, F7 new folder, F8 / Delete delete, F9 properties and checksums, Shift+F9
  test, F10 compare, Alt+F7 find, Ctrl+U swap panels, Ctrl+Enter puts the name on the command line. A right click (or a
  long press) opens the same actions as a menu. Browsers keep Ctrl+PgUp / PgDn for their tabs, so Backspace / Enter do
  the same.
- **Archives as folders**: Enter on an archive opens it in the panel (any readable format, nested archives too).
  Copying out of an archive extracts; copying into an archive (from the workspace or from another archive) and
  deleting, renaming or making folders inside it **repack** the archive in the engine with `../pack/` and put the new
  archive back where it was (inside an outer archive too). Writable: ZIP, 7z, tar, tar.gz, tar.bz2, tar.xz, tar.zst
  and the one-file gz, bz2, xz, zst, lzma; RAR, ISO, ARC, tar.Z / tar.lzma and encrypted archives are read-only (the
  badge on the path line says so).
- **Creating archives** (F2 or `pack name.tar.xz`): ZIP (stored / deflate), 7z (solid LZMA2), tar, tar.gz, tar.bz2,
  tar.xz, tar.zst, and gz, bz2, xz, zst, lzma for one file, with a compression level, into this or the other panel.
- **Viewer** (F3): hex and text side by side over the file read in 64 KiB pages (only visible lines exist, so large
  files open at once; 8 bytes per line on phones), a text mode (F4), the encodings UTF-8, Windows-1251, Latin-1
  (ISO 8859-1), CP866 and UTF-16 LE (F8 cycles), go to an offset (`0x1F`, `4096`, `+100`, `50%`; Ctrl+G), search
  for text or bytes (`ff d8 ?? e0` with wildcards; case folding; F7, Shift+F7 next, Alt+F7 previous), and the
  structure of known formats coloured in the dump and listed beside it: ZIP headers and central directory, PNG chunks
  with their CRCs checked, gzip, JPEG segments, GIF, BMP, RIFF, tar, 7z, xz, ELF, PE, SQLite… (`../magic/structure.js`).
- **MIME type by signature**: every file's type is read from its first bytes (`../magic/`: more than 100 signatures,
  containers refined by content — DOCX / XLSX / EPUB / JAR / APK inside ZIP, WAV / AVI / WebP inside RIFF, MP4 / MOV /
  HEIC / AVIF brands, Opus / Vorbis in Ogg, WebM / MKV — and a text sniffer); shown in the type column, the info line,
  the properties and by the `mime` command, with what decided it (signature, text analysis or the name).
- **Properties and checksums** (F9): path, size, date, type, MIME, method and packed size of archived files, and
  CRC-32, MD5, SHA-1 and SHA-256 (`../crypto/`) computed in the worker with copy buttons; Shift+F9 or "Test" checks
  an archive's integrity (every file decoded and its checksum verified).
- **Compare** (F10): the files under the cursors of both panels (or two selected files) byte by byte: identical, or
  the first difference, the count of differing bytes and a table of the first 200, with "Show in the viewer" at the
  first difference.
- **Find** (Alt+F7): file masks (`*.txt; *.md`) in the panel's folder and subfolders (inside archives too), optionally
  files containing a text (UTF-8 or Windows-1251, case folded; workspace files); results jump to the file.
- **Command line**: typing in a panel goes there; `cd`, `mkdir`, `touch`, `rm`, `pack <name.ext> [level]`,
  `unpack` (the archive under the cursor into the other panel), `test`, `hash`, `mime`, `cmp`, `find <mask>`,
  `view`, `hex`, `edit`, `save`, `help`, `classic`; the last lines of output show above it.
- **Editor** (F4): text files up to 8 MB in a text area with the encoding kept or chosen (UTF-8, Windows-1251,
  Latin-1, CP866, UTF-16 LE); Ctrl+S / F2 saves, also into archives.

## How it runs

All archive work runs in a module Worker created from a Blob: in the single-file build the page's own inline module
is re-run as the worker (`main.js` starts `workerMain()` when there is no document); from sources (and in `html@5_offline/`)
the Blob imports `engine.js`. In the worker, files are read in slices with `FileReaderSync`, so a multi-gigabyte
archive is never loaded whole; decoders pull from those slices, and outputs accumulate as Blob parts (or go straight
into a folder). Jobs report progress and can be cancelled between chunks; listing a large compressed tar cannot be
interrupted midway, so cancelling it restarts the worker. Without Worker support the same engine runs in the page
(the files are then read into memory). `<html data-engine>` tells which engine is active.

## Files

| file | role |
|---|---|
| `index.html` | page (shell, styles, module) |
| `main.js` | entry: start screen, archive view (bar, summary, output and option cards), row context menu, extraction, test, preview, properties and password dialogs, the switch to the commander, worker bootstrap |
| `commander.js` | the two-panel commander: workspace tree, archive mounts (nested, repacked on writes), panels with virtualized rows, F-key bar, Far keys, copy / move / rename / folder / delete / pack / edit / properties / compare / find / test, command line |
| `hexview.js` | the viewer: paged Blob reader, virtual hex + text dump, text mode, encodings, go to, byte / text search with wildcards, structure side list |
| `list.js` | the virtualized tree grid (rows, sorting headers, check boxes, keyboard) |
| `tree.js` | the file tree model: folders implied by paths, aggregated sizes, sorting, search, selection |
| `fmt.js` | sizes, dates, ratios, modes / attributes, file kinds, text decoding of previews, hex dump |
| `runner.js` | worker from a Blob, job queue with progress, soft cancel and hard cancel, in-page fallback |
| `engine.js` | `runJob()`: open / extract (files, ZIP, folder) / test / preview; for the commander several archives at once by key (`vopen`, `vclose`), `repack`, `pack` (`../pack/`), `hash` (CRC-32, MD5, SHA-1, SHA-256), `compare`; the worker message protocol |
| `strings.js`, `strings-fm.js` | UI strings (en, ru, uk, de, fr, es, ka): archive view; commander and viewer |
| `app.css` | application styles (on top of `../ui/base.css`, `../ui/app.css`) |
| `server.js` | development server instance |
| `e2e-app.js`, `e2e-menu.js`, `e2e-fm.js` | end-to-end scenarios of the built page (`node check.js e2e archive-processor/html@5_offline_singlefile/index.html archive-processor/e2e-app.js --lang en`); `e2e-fm.js`: the commander (a tar.gz created, opened and extracted, Far keys, the hex viewer, MIME by signature, compare, find, the command line; also with `--mobile --size 375x812`) |

Libraries: `archive/` (all formats and decoders), `pack/` (archive writers: tar, gzip, bzip2, xz / LZMA2, lzma,
Zstandard, 7z), `magic/` (file types by signature, binary structures), `zip/` (central directory, ZIP writer, ZIP
decryption), `codec/` (inflate / deflate, CRC-32), `crypto/` (AES, MD5, SHA-1 / SHA-256, HMAC, PBKDF2, BLAKE2sp), `ui/`.

## Limits

- The classic view only reads (output is plain files, a ZIP or a folder); creating and changing archives is the
  commander's. RAR can never be created; encrypted archives are not rewritten (no encryption on writing).
- The commander's workspace lives in memory for the session (nothing is stored between visits); changing an archive
  rewrites it whole in memory (`../pack/` builds archives as one array), so very large archives are better extracted
  and repacked than edited in place. Browsers reserve Ctrl+PgUp / PgDn and some F-keys may be taken by the system
  (Backspace / Enter and the F-key buttons do the same).
- Memory: decoders allocate their dictionary up to the size of the data (LZMA / RAR dictionaries above ~2 GB do not
  fit a JavaScript typed array); a single extracted file is assembled as a Blob, which browsers may keep in memory.
  Very large outputs are best written into a folder.
- Speed is that of JavaScript on one core (LZMA2 ~100 MB/s, Deflate ~120 MB/s, bzip2 ~25 MB/s on text; 7z AES key
  derivation takes a few hundred milliseconds).
- Solid archives and compressed tars are decoded from the start of their block / stream: extracting a single file
  near the end of a large solid block takes as long as decoding everything before it.
- Symbolic links, hard links and devices cannot be created by a browser: in a ZIP output symlinks are kept as ZIP
  symlinks, in a folder they are skipped and reported.
- Not supported (reported by name): lzip, CAB, ARJ, LHA, cpio, ar, WIM, DMG, xar, RPM; ZIP strong encryption other
  than AES with a password (3DES / RC2 / RC4, certificates), encrypted ZIP central directories; Zstandard
  dictionaries; 7z Brotli / LZ4 (forks); see `../archive/README.md`.
