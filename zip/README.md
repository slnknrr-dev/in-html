# zip

**ZIP.** Reading and writing ZIP archives (stored and deflated entries, UTF-8 names, Zip64 sizes and offsets, CRC-32
checked), the central directory of any ZIP from a random-access source, a streaming writer and ZIP decryption.

| module | contents |
| --- | --- |
| `zip.js` | `readZip(bytes)` / `writeZip(files, { level })` (stored or deflated entries, in memory); `listZip(src, { charset, diskStarts })`: the central directory of a source `{ size, read(offset, length) }` with Zip64, NTFS / Unix / extended times, Unix modes, Info-ZIP Unicode names and comments, legacy names through `charset(bytes)`, WinZip AES and strong-encryption markers, split archives and prepended data (self-extractors), `entry.dataOffset()`; `ZipWriter`: streaming writer (`add(name, bytes \| async iterable, { time, mode, dir, store })`, `finish() -> Blob`), deflate through Compression Streams, Zip64 only where needed, duplicate names made unique |
| `crypt.js` | decryption: `ZipCrypto` (traditional PKWARE: `header(bytes12)` returns the check byte, `decrypt(chunk)`), WinZip AES (`aesKeys(password, salt, strength)` -> key, MAC key, verifier; `WinZipAes`: CTR decryption with the HMAC-SHA1 tag) |

The other compression methods (Deflate64, BZip2, LZMA, PPMd, XZ, Shrink, Reduce, Implode) are read by
`../archive/zip.js`, which builds on `listZip` and `crypt.js`.

The header comment of each module documents its API.
