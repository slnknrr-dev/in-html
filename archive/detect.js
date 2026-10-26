// archive/detect.js - archive format detection by signature (never by extension alone), self-extractor scanning and
// the grouping of multi-volume parts by their names.
//
//   detectFormat(src) -> { format, offset?, label } | null
//     format: '7z' | 'rar5' | 'rar' | 'rar14' | 'zip' | 'gzip' | 'bzip2' | 'xz' | 'zstd' | 'lzma' | 'Z' | 'tar' | 'iso' |
//             'udf' | 'arc' | unsupported ones ('lzip', 'cab', 'arj', 'lzh', 'cpio', 'ar', 'wim', 'dmg', 'xar', 'rpm',
//             'msi')
//   groupVolumes(names) -> [[indices in volume order], …]   name.part1.rar…, name.rar + .r00…, name.7z.001…, name.z01… + .zip
//   UNSUPPORTED_LABELS: display names of recognised but unsupported formats
//
// Ordering principle of detectFormat: strongest evidence first. Long magic numbers (6-8 bytes, false-positive rate
// ~2^-48 and below) are tested before 2-byte magics (gzip 1F 8B, .Z 1F 9D: one in 65536 random files), and the
// structural heuristics with no magic at all (tar checksum, SEA ARC, raw LZMA) come last, because each of them
// would happily claim a file that a stricter test recognises. Signatures beat extensions: users rename files, and a
// .zip that is really a 7z must open as 7z. A wrong guess is not fatal: the format reader validates and throws
// 'format' / 'corrupt', so detection only has to be right in the common case and never silently mis-decode.
//
// Why "recognise but refuse" for unsupported formats: telling the user "this is a CAB, not supported" is actionable;
// "unknown format" is not. Their tests are cheap and placed after the supported ones so they never shadow them.

import { crc32 } from '../codec/crc32.js';
import { le32, readAt } from './io.js';
import { scanRarSignature } from './rar5.js';
import { isTarHeader } from './tar.js';

export const UNSUPPORTED_LABELS = {
  lzip: 'lzip', cab: 'Microsoft Cabinet', arj: 'ARJ', lzh: 'LHA / LZH', cpio: 'cpio', ar: 'ar / deb',
  wim: 'Windows Imaging (WIM)', dmg: 'Apple disk image', xar: 'xar / pkg', rpm: 'RPM', msi: 'Compound file (MSI / DOC)',
};

// Reading past the end of `b` yields undefined !== x, so a short buffer simply fails the match (no bounds checks).
const starts = (b, sig, at = 0) => sig.every((x, i) => b[at + i] === x);
const ascii = (s) => Array.from(s, (c) => c.charCodeAt(0));
// 7z: '7z' BC AF 27 1C. RAR 5: 'Rar!' 1A 07 01 00; RAR 1.5-4: 'Rar!' 1A 07 00 (the two differ at byte 6, so their
// test order does not matter). RAR 1.4: 'RE~^'. xz: FD '7zXZ' 00 (the FD and 00 make it non-text).
const SIG = {
  sz: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c],
  rar5: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00],
  rar: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00],
  rar14: [0x52, 0x45, 0x7e, 0x5e],
  xz: [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00],
};

function arcLike(b, size) {
  // SEA ARC has no real magic: 0x1A, then a header type (1..11 = storage methods, 20..22 = PAK / ARC 6 information
  // headers, 30 / 31 = ARC 7 directory start / end), then a 13-byte NUL-terminated DOS name, then le32 csize at 15.
  // Each extra constraint (printable name without path or wildcard characters, a terminator inside 13 bytes,
  // csize <= file size) cuts the false-positive rate of a lone 0x1A byte, which also opens many text files (^Z EOF).
  // 29 = the 1.x header length up to the original-size field.
  if (b.length < 29 || b[0] !== 0x1a) return false;
  const m = b[1];
  if (!((m >= 1 && m <= 11) || m === 20 || m === 21 || m === 22 || m === 30 || m === 31)) return false;
  let i = 2;
  for (; i < 15 && b[i]; i++) if (b[i] < 0x20 || b[i] === 0x2f || b[i] === 0x5c || b[i] === 0x3a || b[i] === 0x2a || b[i] === 0x3f) return false;
  // i === 2: empty name; i === 15: no NUL inside the 13-byte field.
  if (i === 2 || i === 15) return false;
  const csize = le32(b, 15);
  return csize <= size;
}

// LZMA_Alone (.lzma) has no magic: 13-byte header = props byte ((pb * 5 + lp) * 9 + lc, so < 9 * 5 * 5 = 225),
// le32 dictionary size, le64 uncompressed size (all FF = unknown, stream ends with an end marker). Evidence used:
// - props === 0x5D (lc=3, lp=0, pb=2): what every mainstream encoder writes; other values are legal but rare, and
//   accepting them would make the test fire on far too much random data. (This makes the `< 225` check redundant;
//   it documents the field's legal range.)
// - dictionary of the form 2^n or 3 * 2^(n-1), as xz / 7-Zip / lzma_alone round it.
// - plausible size: unknown, or below a 2048:1 ratio (+1 MB slack) of the file size.
// - b[13] === 0: the first byte of an LZMA range-coder stream is always 0 (the encoder's initial cache byte).
function lzmaLike(b, size) {
  if (b.length < 14 || b[0] >= 225) return false;
  const dict = le32(b, 1);
  // Encoders write 2^n or 2^n + 2^(n-1) dictionaries.
  let ok = false;
  for (let n = 12; n <= 30 && !ok; n++) ok = dict === 2 ** n || dict === 2 ** n + 2 ** (n - 1);
  if (!ok || b[0] !== 0x5d) return false;
  const unknown = b.subarray(5, 13).every((x) => x === 255);
  const usize = le32(b, 5) + le32(b, 9) * 4294967296;
  return (unknown || usize < size * 2048 + 1e6) && b[13] === 0;
}

export function detectFormat(src) {
  if (!src.size) return null;
  const b = src.read(0, Math.min(src.size, 65536));
  if (starts(b, SIG.sz)) return { format: '7z', label: '7z' };
  if (starts(b, SIG.rar5)) return { format: 'rar5', label: 'RAR 5' };
  if (starts(b, SIG.rar)) return { format: 'rar', label: 'RAR' };
  if (starts(b, SIG.rar14)) return { format: 'rar14', label: 'RAR 1.4' };
  // 'PK' + 03 04 (local header), 05 06 (end of central directory: an empty archive), 07 08 (split / spanned archive
  // marker in front of the first local header) or '00' (the older PKZIP 2.04g form of that marker).
  if (b[0] === 0x50 && b[1] === 0x4b && ((b[2] === 3 && b[3] === 4) || (b[2] === 5 && b[3] === 6) || (b[2] === 7 && b[3] === 8) || (b[2] === 0x30 && b[3] === 0x30))) return { format: 'zip', label: 'ZIP' };
  if (b[0] === 0x1f && b[1] === 0x8b) return { format: 'gzip', label: 'gzip' };
  // 'BZh' + block size digit '1'..'9' (x 100 kB): the digit constraint rejects plain text starting with "BZh".
  if (b[0] === 0x42 && b[1] === 0x5a && b[2] === 0x68 && b[3] >= 0x31 && b[3] <= 0x39) return { format: 'bzip2', label: 'bzip2' };
  if (starts(b, SIG.xz)) return { format: 'xz', label: 'xz' };
  if (b[0] === 0x1f && b[1] === 0x9d) return { format: 'Z', label: 'compress (.Z)' };
  // Zstandard frame magic 0xFD2FB528 (LE: 28 B5 2F FD), or one skippable frame (magic 0x184D2A50..5F, LE: 5X 2A 4D 18,
  // then le32 payload size) directly followed by a real frame. A file of skippable frames only is not claimed.
  if (starts(b, [0x28, 0xb5, 0x2f, 0xfd]) || (b[0] >= 0x50 && b[0] <= 0x5f && starts(b, [0x2a, 0x4d, 0x18], 1) && starts(b, [0x28, 0xb5, 0x2f, 0xfd], 8 + le32(b, 4)))) return { format: 'zstd', label: 'Zstandard' };
  if (starts(b, ascii('LZIP'))) return { format: 'lzip', label: 'lzip' };
  // tar has no magic for v7 archives; isTarHeader verifies the header checksum, which is strong enough to test
  // before ISO (whose first 32 KiB, the system area, is normally zeros and fails the checksum).
  if (b.length >= 512 && isTarHeader(b.subarray(0, 512))) return { format: 'tar', label: 'tar' };
  // Optical disc images: the volume descriptors start at sector 16 (16 * 2048 = 0x8000); byte 0 of a descriptor is
  // its type, the standard identifier follows at +1. 0x8800 / 0x9000 are sectors 17 / 18: a UDF image's Volume
  // Recognition Sequence (BEA01, NSR02/03) may start there when sector 16 holds something else.
  if (src.size >= 0x8800) {
    for (const at of [0x8001, 0x8801, 0x9001]) {
      if (src.size < at + 5) break;
      const v = readAt(src, at, 5);
      if (starts(v, ascii('CD001'))) return { format: 'iso', label: 'ISO 9660' };
      if (starts(v, ascii('BEA01')) || starts(v, ascii('NSR02')) || starts(v, ascii('NSR03'))) {
        // A bridge image has a CD001 descriptor in the same sequence.
        for (let s = 16; s < 32 && (s + 1) * 2048 <= src.size; s++) if (starts(readAt(src, s * 2048 + 1, 5), ascii('CD001'))) return { format: 'iso', label: 'ISO 9660 / UDF' };
        return { format: 'udf', label: 'UDF' };
      }
    }
    // Raw 2352-byte sectors (bin/cue rips): 12 sync bytes + 4 header bytes = 16 before the 2048 user bytes in Mode 1;
    // Mode 2 form 1 adds an 8-byte subheader (24).
    for (const at of [16 * 2352 + 16 + 1, 16 * 2352 + 24 + 1]) {
      if (src.size >= at + 5 && starts(readAt(src, at, 5), ascii('CD001'))) return { format: 'iso', label: 'ISO 9660 (raw sectors)' };
    }
  }
  if (starts(b, ascii('MSCF')) && b[4] === 0 && b[5] === 0) return { format: 'cab', label: UNSUPPORTED_LABELS.cab };
  if (b[0] === 0x60 && b[1] === 0xea) return { format: 'arj', label: UNSUPPORTED_LABELS.arj };
  // LHA: header size, checksum, then the method id '-lh?-' / '-lz?-' at offset 2 (only '-lh' is tested).
  if (b[2] === 0x2d && b[3] === 0x6c && b[4] === 0x68 && b[6] === 0x2d) return { format: 'lzh', label: UNSUPPORTED_LABELS.lzh };
  // cpio: odc '070707', newc '070701', crc '070702', old binary 0x71C7 in either byte order.
  if (starts(b, ascii('070707')) || starts(b, ascii('070701')) || starts(b, ascii('070702')) || (b[0] === 0xc7 && b[1] === 0x71) || (b[0] === 0x71 && b[1] === 0xc7)) return { format: 'cpio', label: UNSUPPORTED_LABELS.cpio };
  if (starts(b, ascii('!<arch>\n'))) return { format: 'ar', label: UNSUPPORTED_LABELS.ar };
  if (starts(b, ascii('MSWIM\0\0\0'))) return { format: 'wim', label: UNSUPPORTED_LABELS.wim };
  if (starts(b, ascii('xar!'))) return { format: 'xar', label: UNSUPPORTED_LABELS.xar };
  if (starts(b, [0xed, 0xab, 0xee, 0xdb])) return { format: 'rpm', label: UNSUPPORTED_LABELS.rpm };
  if (starts(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return { format: 'msi', label: UNSUPPORTED_LABELS.msi };
  // Heuristics without magic: last, so they can only claim files nothing else recognised.
  if (arcLike(b, src.size)) return { format: 'arc', label: 'ARC' };
  if (lzmaLike(b, src.size)) return { format: 'lzma', label: 'LZMA' };
  // Self-extracting executables and other data in front of an archive.
  const sfx = scanEmbedded(src, b);
  if (sfx) return sfx;
  // Apple UDIF: a 512-byte 'koly' trailer at the very end. The 2 MiB floor keeps the tail read off tiny files where
  // a chance match would be the only evidence (real DMGs are much larger).
  if (src.size >= 512 && src.size > 0x200000) {
    const tail = src.read(src.size - 512, 512);
    if (starts(tail, ascii('koly'))) return { format: 'dmg', label: UNSUPPORTED_LABELS.dmg };
  }
  return null;
}

// Archives inside executables (SFX stubs) and after other prepended data.
function scanEmbedded(src, head) {
  const exe = head[0] === 0x4d && head[1] === 0x5a; // MZ
  const elf = head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46;
  // RAR after any data (SFX stubs, and archives appended to pictures): the RAR reader checks the header found.
  const rar = scanRarSignature(src);
  if (rar && rar.offset > 0) {
    const kind = exe || elf ? ' (self-extracting)' : ' (after other data)';
    return rar.version === 5 ? { format: 'rar5', label: 'RAR 5' + kind, offset: rar.offset } : { format: 'rar', label: 'RAR' + kind, offset: rar.offset };
  }
  if (exe || elf) {
    // 7z SFX: the signature header carries its own CRC, which rules out chance matches. The 32-byte start header is
    // signature (6) + version (2) + StartHeaderCRC (4, at +8) + next header offset / size / CRC (20, at +12..+32), and
    // the CRC covers exactly the last 20 bytes. Stubs are small, so only the first 8 MiB are scanned, in 1 MiB windows
    // that overlap by 32 bytes so a header straddling a window edge is still seen. i starts at 1: offset 0 was the
    // plain-7z test above. The cheap two-byte prefilter avoids the every() call on almost all positions.
    const limit = Math.min(src.size, 1 << 23);
    for (let at = 0; at < limit; at += 1 << 20) {
      const chunk = src.read(at, Math.min(limit - at, (1 << 20) + 32));
      for (let i = 1; i + 32 <= chunk.length; i++) {
        if (chunk[i] === 0x37 && chunk[i + 1] === 0x7a && starts(chunk, SIG.sz, i) && crc32(chunk, i + 12, i + 32) === le32(chunk, i + 8)) {
          return { format: '7z', label: '7z (self-extracting)', offset: at + i };
        }
      }
    }
  }
  // ZIP: the end of central directory record near the end of the file (works with any prepended data).
  // 65557 = 22-byte EOCD + the maximum 65535-byte comment: the record must start in this tail. Scanning backwards finds
  // the last candidate, which is the real one when a stored file inside contains the bytes PK 05 06. Only the
  // signature is checked here; zip.js validates the record and fails cleanly on a chance match.
  const n = Math.min(src.size, 65557);
  const tail = src.read(src.size - n, n);
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 5 && tail[i + 3] === 6) {
      return { format: 'zip', label: exe ? 'ZIP (self-extracting)' : 'ZIP' };
    }
  }
  return null;
}

/**
 * Groups dropped files into archives: multi-volume parts are put together in volume order, everything else stands
 * alone. Returns arrays of indices into `names`; the first element of a group is the first volume.
 */
// Naming schemes and the sort key each gets:
// - RAR 3+ new style: name.partN.rar -> N.
// - RAR old style: name.rar (-1, must come first), then .r00-.r99, .s00-.s99 … ('r' = 114, so letter - 114 gives
//   the hundreds): key (letter - 'r') * 100 + digits.
// - ZIP split: name.z01, .z02 …, and name.zip LAST (1e9): the .zip holds the central directory, it is the final part.
// - Generic split (7-Zip, HJSplit): name.ext.001, .002 …
// Keys are lower-cased: Windows file names are case-insensitive and users mix NAME.R00 with name.rar.
// The final sort orders groups by the index of their first volume, so the result follows the order of `names`.
export function groupVolumes(names) {
  const groups = new Map();
  const single = [];
  names.forEach((name, i) => {
    const n = String(name);
    let m;
    if ((m = /^(.*)\.part(\d+)\.rar$/i.exec(n))) add('rarN:' + m[1].toLowerCase(), +m[2], i);
    else if ((m = /^(.*)\.rar$/i.exec(n))) add('rarO:' + m[1].toLowerCase(), -1, i);
    else if ((m = /^(.*)\.z(\d\d)$/i.exec(n))) add('zip:' + m[1].toLowerCase(), +m[2], i);
    else if ((m = /^(.*)\.([r-y])(\d\d)$/i.exec(n))) add('rarO:' + m[1].toLowerCase(), (m[2].toLowerCase().charCodeAt(0) - 114) * 100 + +m[3], i);
    else if ((m = /^(.*)\.zip$/i.exec(n))) add('zip:' + m[1].toLowerCase(), 1e9, i);
    else if ((m = /^(.*)\.(\d{3})$/.exec(n))) add('num:' + m[1].toLowerCase(), +m[2], i);
    else single.push([i]);
  });
  function add(key, order, i) {
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push([order, i]);
  }
  const out = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => a[0] - b[0]);
    // A lone .rar / .zip / .z01 is just one archive; old-style RAR volumes need the .rar to start.
    if (key.startsWith('rarO:') && list[0][0] !== -1) { for (const [, i] of list) out.push([i]); continue; }
    out.push(list.map((x) => x[1]));
  }
  return [...out, ...single].sort((a, b) => a[0] - b[0]);
}
