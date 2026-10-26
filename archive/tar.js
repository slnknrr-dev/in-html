// archive/tar.js - tar archives: v7, ustar, GNU (long names and links 'L' / 'K', old sparse 'S', dump directories,
// volume labels, multi-volume continuations listed) and pax (extended 'x' and global 'g' headers: path, linkpath,
// size, fractional times, uid / gid / names, the GNU sparse formats 0.0, 0.1 and 1.0), base-256 numbers, unsigned and
// signed header checksums. Sparse files are re-expanded with their holes.
//
//   isTarHeader(block) -> boolean               a valid header block (checksum matches)
//   listTar(reader, { charset, onHeader }) -> entries   (sequential; data offsets refer to the tar stream)
//   openTar(sources, opts) -> Archive           a plain .tar file (random access to the entries)
//   tarArchive(open, opts) -> Archive           tar inside a compressed stream: open() -> a fresh decoded Stream;
//                                               entries are read with a forward cursor (going back restarts)
//
// Header block (512 bytes, POSIX ustar offsets): name 0/100, mode 100/8, uid 108/8, gid 116/8, size 124/12,
// mtime 136/12, chksum 148/8, typeflag 156, linkname 157/100, magic 257/6, version 263/2, uname 265/32, gname 297/32,
// devmajor 329/8, devminor 337/8, prefix 345/155. GNU reuses 345.. for atime / ctime / old sparse data and writes the
// magic as "ustar  \0" (no NUL at 262), which is how the two layouts are told apart. Data follows in 512-byte blocks,
// and an archive ends with two zero blocks. Numbers are octal ASCII, or base-256 binary when they do not fit.
//
// Extension records precede the entry they modify ('L' / 'K' long names, pax 'x'); they are collected in
// longName / longLink / pax and consumed by the next real header. pax wins over GNU, which wins over the header.

import { Reader, concatSource, corrupt, decodeText, fail, isUtf8, limitStream, sourceStream, utf8 } from './io.js';

const BLOCK = 512;

// Leading spaces / NULs are skipped and parsing stops at the first non-octal byte: writers terminate with space,
// NUL or both, and some right-align with leading spaces. Lenient by design; isTarHeader is the strict gate.
function octal(b, o, n) {
  if (b[o] & 0x80) {
    // base-256 (GNU / star): big-endian two's complement in the remaining 8n - 1 bits (bit 0x80 is the marker,
    // 0x40 the sign). With the sign bit masked off, the negative value is v - 2^(8n-2). Float accumulation: exact for
    // sizes up to 2^53, the 12-byte field could hold more but no real file does.
    let v = b[o] & 0x3f;
    const neg = (b[o] & 0x40) !== 0;
    for (let i = 1; i < n; i++) v = v * 256 + b[o + i];
    return neg ? v - 2 ** (8 * n - 2) : v;
  }
  let v = 0, i = o;
  const end = o + n;
  while (i < end && (b[i] === 0x20 || b[i] === 0)) i++;
  for (; i < end && b[i] >= 0x30 && b[i] <= 0x37; i++) v = v * 8 + (b[i] - 0x30);
  return v;
}

function field(b, o, n) {
  let e = o;
  while (e < o + n && b[e]) e++;
  return b.subarray(o, e);
}

// Checksum = sum of all 512 bytes with the checksum field itself counted as eight spaces. Both the unsigned sum
// (POSIX) and the signed-char sum (historic Sun / old GNU tar bug, still found in old archives) are accepted. An
// all-zero block is the end marker, never a header. This is also the detector's only evidence for tar (v7 has no
// magic), so the field is additionally required to hold octal digits: a block of random bytes almost never passes.
export function isTarHeader(b) {
  if (b.length < BLOCK) return false;
  let sum = 0, ssum = 0, any = false;
  for (let i = 0; i < BLOCK; i++) {
    const c = i >= 148 && i < 156 ? 0x20 : b[i];
    sum += c;
    ssum += c > 127 ? c - 256 : c;
    if (b[i]) any = true;
  }
  if (!any) return false;
  // The checksum field must hold octal digits (spaces / NUL around them).
  let digits = 0;
  for (let i = 148; i < 156; i++) { const c = b[i]; if (c >= 0x30 && c <= 0x37) digits++; else if (c !== 0x20 && c !== 0) return false; }
  if (!digits) return false;
  const want = octal(b, 148, 8);
  return want === sum || want === ssum;
}

// typeflag: NUL (v7) / '0' / '7' (contiguous) file, '1' hard link, '2' symlink, '3' / '4' char / block device, '5' dir,
// '6' FIFO, 'D' GNU dump directory. Others ('V' label, 'M' continuation, 'S' old sparse) are handled in listTar.
// Unknown types are listed as files, as POSIX requires ("treat as regular file").
const TYPES = { 0: 'file', 48: 'file', 55: 'file', 49: 'hardlink', 50: 'symlink', 51: 'other', 52: 'other', 53: 'dir', 54: 'other', 68: 'dir' };
const MODE_TYPE = { file: 0o100000, dir: 0o040000, symlink: 0o120000, hardlink: 0o100000, other: 0 };

// pax record: "<len> <key>=<value>\n", where len counts the whole record including itself and the newline. Values are
// kept as bytes (decoded per key later: numbers, UTF-8 strings or binary). Parsing stops at the first malformed
// record instead of throwing: the header that follows is still usable without the extended attributes.
function parsePax(bytes) {
  const out = [];
  let i = 0;
  while (i < bytes.length) {
    let sp = i;
    while (sp < bytes.length && bytes[sp] !== 0x20) sp++;
    const len = parseInt(utf8(bytes.subarray(i, sp)), 10);
    if (!(len > 0) || i + len > bytes.length) break;
    const rec = bytes.subarray(sp + 1, i + len - 1); // without the trailing newline
    const eq = rec.indexOf(0x3d);
    if (eq > 0) out.push([utf8(rec.subarray(0, eq)), rec.subarray(eq + 1)]);
    i += len;
  }
  return out;
}

const paxTime = (v) => { const s = parseFloat(utf8(v)); return Number.isFinite(s) ? new Date(s * 1000) : undefined; };

/**
 * Walks the headers of a tar stream. Returns the entries; `dataOffset` / `dataSize` locate the stored bytes in the
 * tar stream, `sparse` ([offset, length] pairs) maps them into a file of `size` bytes.
 */
export function listTar(r, { charset = 'auto', onHeader } = {}) {
  const entries = [];
  let global = {}, longName = null, longLink = null, pax = null, zeros = 0;
  const text = (b) => decodeText(b, charset);
  // pax strings are UTF-8, unless hdrcharset=BINARY made them raw bytes of a legacy charset.
  const ptext = (b) => (isUtf8(b) ? utf8(b) : text(b));
  for (;;) {
    const at = r.pos;
    const h = new Uint8Array(BLOCK);
    let n = 0;
    for (let c; n < BLOCK && (c = r.chunk(BLOCK - n));) { h.set(c, n); n += c.length; }
    if (n === 0) break;
    if (n < BLOCK) { if (h.every((x) => !x)) break; fail('truncated', 'unexpected end of tar data'); }
    if (h.every((x) => !x)) { if (++zeros >= 2) break; continue; }
    // A lone zero block and then data: some writers end with one block only, and what follows is padding garbage
    // (e.g. the record size rounding of old tar), so stopping is safer than parsing it as headers.
    if (zeros) break;
    // A bad first header means "not tar" (format), a bad later one means damage (corrupt): the distinction drives the
    // UI message.
    if (!isTarHeader(h)) {
      if (!entries.length) fail('format', 'not a tar archive');
      corrupt('tar header checksum at offset ' + at);
    }
    if (onHeader) onHeader(entries.length);
    const type = h[156];
    const gnu = h[257] === 0x75 && h[262] === 0x20; // "ustar  \0"
    const ustar = h[257] === 0x75 && h[262] === 0;
    let size = octal(h, 124, 12);
    const dataOffset = at + BLOCK;
    // `size` here is the header value, which for 'x' / 'L' / 'K' is the extension record's own length.
    const padded = Math.ceil(size / BLOCK) * BLOCK;
    const readData = () => { const d = r.bytes(size, 'tar data'); r.skip(padded - size, 'tar data'); return d; };
    if (type === 0x78 || type === 0x67 || type === 0x58) { // 'x', 'g', Solaris 'X'
      const recs = parsePax(readData());
      // Global records apply to every later entry; a global path, link or size cannot (libarchive refuses them).
      if (type === 0x67) { for (const [k, v] of recs) if (!/^(path|linkpath|size)$|^GNU\.sparse\./.test(k)) global[k] = v; } else pax = recs;
      continue;
    }
    if (type === 0x4c) { longName = field(readData(), 0, size); continue; } // 'L'
    if (type === 0x4b) { longLink = field(readData(), 0, size); continue; } // 'K'
    // Effective pax attributes: globals overridden by the entry's own records.
    const px = { ...global };
    const sparsePairs = [];
    if (pax) for (const [k, v] of pax) { if (k === 'GNU.sparse.offset' || k === 'GNU.sparse.numbytes') sparsePairs.push(+utf8(v)); else px[k] = v; }
    pax = null;
    let nameBytes = field(h, 0, 100);
    // ustar splits long paths into prefix + '/' + name; only with the POSIX magic (in GNU headers 345 is atime).
    if (ustar && h[345]) { const pre = field(h, 345, 155); const nb = new Uint8Array(pre.length + 1 + nameBytes.length); nb.set(pre); nb[pre.length] = 0x2f; nb.set(nameBytes, pre.length + 1); nameBytes = nb; }
    let name = longName ? text(longName) : text(nameBytes);
    let link = longLink ? text(longLink) : text(field(h, 157, 100));
    longName = longLink = null;
    if (px.path) name = ptext(px.path);
    if (px.linkpath) link = ptext(px.linkpath);
    if (px.size) { if (!/^\d+$/.test(utf8(px.size))) corrupt('tar pax size'); size = +utf8(px.size); }
    // pax size overrides the 12-byte field (needed above 8 GiB with octal writers); the data skip below must use it.
    const sizeAfterPax = size;
    let kind = TYPES[type] || (type === 0x56 ? 'label' : type === 0x4d ? 'continued' : type === 0x53 ? 'file' : 'file');
    // v7 had no directory type: a regular-file header whose name ends in '/' is a directory (POSIX keeps this rule).
    if (kind === 'file' && name.endsWith('/') && type !== 0x53) kind = 'dir';
    let mode = octal(h, 100, 8) & 0o7777;
    const e = {
      index: entries.length, path: '', dir: kind === 'dir', kind, size, packed: size,
      mtime: px.mtime ? paxTime(px.mtime) : new Date(octal(h, 136, 12) * 1000),
      mode: mode | (MODE_TYPE[kind] || 0), dataOffset, dataSize: size, method: 'Stored',
      uid: px.uid ? +utf8(px.uid) : octal(h, 108, 8), gid: px.gid ? +utf8(px.gid) : octal(h, 116, 8),
      user: px.uname ? ptext(px.uname) : text(field(h, 265, 32)), group: px.gname ? ptext(px.gname) : text(field(h, 297, 32)),
    };
    if (px.atime) e.atime = paxTime(px.atime); else if (gnu && h[345]) e.atime = new Date(octal(h, 345, 12) * 1000);
    if (px.ctime) e.ctime = paxTime(px.ctime); else if (gnu && h[357]) e.ctime = new Date(octal(h, 357, 12) * 1000);
    if (kind === 'symlink' || kind === 'hardlink') e.link = link;
    if (kind === 'dir' || kind === 'symlink' || kind === 'hardlink' || kind === 'other') { e.size = 0; e.packed = 0; }
    if (kind === 'other') e.device = type === 0x33 ? 'character device' : type === 0x34 ? 'block device' : 'FIFO';
    if (kind === 'label') { e.kind = 'other'; e.label = true; }
    if (kind === 'continued') { e.kind = 'file'; e.unsupported = 'continued from the previous volume'; }
    // Sparse files: old GNU 'S' headers, pax GNU.sparse 0.0 / 0.1 (map in the header) and 1.0 (map in the data).
    let map = null;
    // Old GNU 'S': 4 (offset, length) pairs in the header at 386, isextended flag at 482, real size at 483; each
    // extension block holds 21 more pairs and its own flag at 504. The header `size` is the stored (packed) length.
    if (type === 0x53) {
      map = [];
      const add = (b, o, n) => { for (let i = 0; i < n; i++) { const off = octal(b, o + i * 24, 12), len = octal(b, o + i * 24 + 12, 12); if (off || len) map.push([off, len]); } };
      add(h, 386, 4);
      let ext = h[482];
      e.size = octal(h, 483, 12);
      while (ext) {
        const x = r.bytes(BLOCK, 'tar sparse header');
        add(x, 0, 21);
        ext = x[504];
      }
      e.dataOffset = r.pos;
    } else if (px['GNU.sparse.major'] && utf8(px['GNU.sparse.major']) === '1') {
      map = [];
      const start = r.pos;
      // Decimal numbers, one per line; lines starting with '#' are comments (libarchive skips them too).
      const line = () => {
        for (;;) {
          let s = '';
          for (let c; (c = r.u8('tar sparse map')) !== 0x0a;) { s += String.fromCharCode(c); if (s.length > 100) corrupt('tar sparse map'); }
          if (s[0] === '#') continue;
          if (!/^\d+$/.test(s)) corrupt('tar sparse map');
          return +s;
        }
      };
      // Each pair costs at least 4 bytes of map text, so count > size / 2 is impossible: cheap guard against a huge
      // count from corrupt data allocating before the stream runs out.
      const count = line();
      if (count > size / 2) corrupt('tar sparse map');
      for (let i = 0; i < count; i++) map.push([line(), line()]);
      const used = r.pos - start;
      const skip = Math.ceil(used / BLOCK) * BLOCK - used;
      r.skip(skip, 'tar sparse map');
      // Format 1.0 stores the map at the start of the data area, padded to a block: the file data proper follows it,
      // so offset and stored size are adjusted; the real name and size come from pax keys (the header name is a
      // placeholder like ./GNUSparseFile.123/name).
      e.dataOffset = start + used + skip;
      e.dataSize = size - used - skip;
      e.size = +utf8(px['GNU.sparse.realsize'] || px['GNU.sparse.size'] || '0');
      if (px['GNU.sparse.name']) name = ptext(px['GNU.sparse.name']);
    } else if (px['GNU.sparse.map'] || sparsePairs.length) {
      map = [];
      const nums = px['GNU.sparse.map'] ? utf8(px['GNU.sparse.map']).split(',').map(Number) : sparsePairs;
      for (let i = 0; i + 1 < nums.length; i += 2) map.push([nums[i], nums[i + 1]]);
      e.size = +utf8(px['GNU.sparse.size'] || px['GNU.sparse.realsize'] || '0');
      if (px['GNU.sparse.name']) name = ptext(px['GNU.sparse.name']);
    }
    if (map) { e.sparse = map; e.method = 'Sparse'; e.packed = e.dataSize; }
    e.path = name.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+|\/+$/g, '');
    if (!e.path && e.dir) e.path = '.';
    entries.push(e);
    // Skip the stored data (directories in pax / GNU dumpdir may carry data too).
    const remain = e.dataOffset + Math.ceil((map ? e.dataSize : sizeAfterPax) / BLOCK) * BLOCK - r.pos;
    if (remain > 0) r.skip(remain, 'tar data');
  }
  return entries.filter((e) => !(e.dir && e.path === '.'));
}

// Expands the stored segments of a sparse file into its full size (holes are zeros). The stored stream is the
// concatenation of the segments in map order. One shared zero buffer serves every hole: views of it are read-only
// by the Stream contract, so no per-hole allocation.
function sparseStream(stored, map, size) {
  // Segments in order, not overlapping, inside the file (libarchive: "Malformed sparse map data").
  for (let i = 0, end = 0; i < map.length; i++) {
    const [off, len] = map[i];
    if (!(off >= end && len >= 0 && off + len <= size)) fail('corrupt', 'malformed sparse map');
    end = off + len;
  }
  let seg = 0, pos = 0;
  const zeros = new Uint8Array(1 << 16);
  return {
    size,
    read(max = 1 << 20) {
      if (pos >= size) return null;
      while (seg < map.length && map[seg][1] === 0) seg++;
      const next = seg < map.length ? map[seg][0] : size;
      if (pos < next) { const n = Math.min(max, next - pos, zeros.length); pos += n; return zeros.subarray(0, n); }
      const [off, len] = map[seg];
      const want = Math.min(max, off + len - pos);
      const b = stored.read(want);
      if (!b) fail('truncated', 'unexpected end of sparse file data');
      pos += b.length;
      if (pos >= off + len) seg++;
      return b;
    },
  };
}

// Hard links point to an earlier entry by path (tar stores the data once, with the first name). Linking only to
// earlier entries matches extraction order; the Map keeps the latest entry for a repeated path, as tar's
// "last one wins" overwrite semantics would.
function finish(entries, info) {
  const byPath = new Map();
  for (const e of entries) {
    if (e.kind === 'hardlink') { const t = byPath.get(e.link.replace(/^(\.\/)+/, '').replace(/^\/+/, '')); if (t) { e.target = t; e.size = t.size; } }
    if (!e.dir) byPath.set(e.path, e);
  }
  info.methods = [...new Set(entries.filter((e) => !e.dir).map((e) => e.method))];
}

export function openTar(sources, opts = {}) {
  const src = concatSource(sources);
  // 64 KiB chunks for the listing pass: headers are 512 bytes apart from the data, and large files are skipped, so
  // a 1 MiB chunk would mostly read data that is thrown away.
  const r = new Reader(sourceStream(src, 0, src.size, 1 << 16));
  const entries = listTar(r, opts);
  const info = { solid: false, props: [['Entries', String(entries.length)]] };
  finish(entries, info);
  const open = (e) => {
    if (e.target) return open(e.target);
    if (e.dir || e.kind !== 'file' || !e.size) return { size: 0, read: () => null };
    if (e.unsupported) fail('unsupported', 'not supported: ' + e.unsupported);
    const stored = sourceStream(src, e.dataOffset, e.dataSize);
    return e.sparse ? sparseStream(stored, e.sparse, e.size) : stored;
  };
  return { format: 'tar', label: 'tar', entries, info, password: null, open };
}

/** tar inside a compressed stream (tar.gz, tar.bz2, tar.xz, tar.lzma, tar.Z). */
export function tarArchive(openStream, opts = {}) {
  const entries = listTar(new Reader(openStream()), opts);
  const info = { solid: true, props: [['Entries', String(entries.length)]] };
  finish(entries, info);
  // One shared forward cursor: extracting entries in archive order costs one decode pass in total; asking for an
  // earlier entry restarts decoding. Consequence: only one entry stream may be read at a time (opening the next one
  // moves the cursor under the previous stream).
  let cur = null;
  const open = (e) => {
    if (e.target) return open(e.target);
    if (e.dir || e.kind !== 'file' || !e.size) return { size: 0, read: () => null };
    if (e.unsupported) fail('unsupported', 'not supported: ' + e.unsupported);
    if (!cur || cur.pos > e.dataOffset) cur = new Reader(openStream());
    cur.skip(e.dataOffset - cur.pos, 'tar data');
    const reader = cur;
    const stored = limitStream({ read: (max) => reader.chunk(max) }, e.dataSize, 'tar data');
    return e.sparse ? sparseStream(stored, e.sparse, e.size) : stored;
  };
  return { entries, info, open };
}
