// archive/iso.js - CD / DVD / BD images: ISO 9660 (ECMA-119 levels 1-3, ISO 9660:1999) with Joliet, Rock Ridge
// (SUSP / RRIP: names, POSIX modes and owners, times, symlinks, relocated deep directories, zisofs compression),
// El Torito boot images and raw 2352-byte sector dumps; and UDF (ECMA-167 / OSTA UDF 1.02-2.60 with physical,
// sparable and metadata partitions).
//
//   openIso(sources, { charset, filesystem }) -> Archive   filesystem: 'auto' (default: the UDF file system when the
//                                                          image has a readable one, else ISO 9660), 'iso9660', 'udf'
//   openUdf(sources, opts) -> Archive                      UDF only ('format' error when the image has none)
//
// ISO names: Rock Ridge > Joliet > ISO 9660:1999 > primary tree (';1' versions and the trailing dot of extensionless
// names dropped). Boot images of the El Torito catalog appear as files under '[BOOT]/' named as 7-Zip does
// ('Boot-NoEmul.img', '2-Boot-HardDisk.img' …). File data is streamed from the image extents: multi-extent files are
// concatenated, interleaved files de-interleaved, zisofs files inflated block by block, UDF sparse extents read as
// zeros. Entries carry uid / gid besides the contract fields when Rock Ridge or UDF records them; open() of a
// symlink returns its target as UTF-8, of a directory an empty stream.
//
// Key decisions:
// - Hostile-image hardening everywhere: directory pointers can form loops or endless chains (visited sets,
//   MAX_DEPTH, hop limits on every linked structure: CE areas, VDP chains, indirect ICBs, allocation extents), and
//   sizes are capped before allocation (MAX_DIR, 1 MiB CE areas). Damage degrades to warnings plus a partial
//   listing; only an unusable root aborts. An image is a pointer graph: every pointer is untrusted input.
// - UDF preferred on 'auto' for bridge discs: UDF carries the full Unicode names, sizes over 4 GiB and permissions,
//   while the ISO 9660 tree of a bridge disc is often a stub ("README: use a UDF reader"). If UDF fails, the ISO tree
//   is listed with a warning instead of an error.
// - All multi-byte ISO 9660 fields are "both-endian" (LE copy then BE copy); only the LE copy is read. UDF is LE only.

import { ArchiveError, fail, EMPTY, concatSource, readAt, readAll, sourceStream, bytesStream, concatStreams, le16, le32, le64, latin1, decodeText } from './io.js';
import { unzlibSync } from '../codec/zlib.js';

const SECTOR = 2048;
const MAX_DEPTH = 64; // directory nesting limit: bad pointers can form endless chains as well as loops
const MAX_DIR = 64 << 20; // largest directory read whole
const UTF16BE = new TextDecoder('utf-16be');
const UTF8 = new TextEncoder();
const S_IFMT = 0o170000, S_IFDIR = 0o040000, S_IFREG = 0o100000, S_IFLNK = 0o120000;
// Local corrupt(): same shape as io.js's, kept here so this module's messages stay self-contained.

const corrupt = (what) => fail('corrupt', 'corrupt data: ' + what);
// A component must not contain '/' (it would split into fake directories) or NUL, and must not be '.' / '..' or empty
// (index.js would drop or misread it); such names are made harmless by substitution rather than rejected.
const safeName = (s) => { s = s.replace(/[/\0]/g, '_'); return s === '' || s === '.' || s === '..' ? '_' + s : s; };

// --- raw sectors and the volume recognition area ---------------------------------------------------------------

// Raw CD dumps (.bin / .img of 2352-byte sectors): 12 sync bytes, a 4-byte header whose last byte is the mode, then
// the 2048 user bytes (Mode 1) or an 8-byte subheader and the 2048 user bytes (Mode 2 Form 1).
const SYNC = [0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0];
// Standard identifiers of the Volume Recognition Sequence (ECMA-167 part 2): ISO 9660 (CD001), UDF extended area
// begin / NSR / end (BEA01, NSR02, NSR03, TEA01), boot (BOOT2) and CD-WO (CDW02). Any of them at sector 16 proves
// the mapping from image offsets to 2048-byte sectors is right.
const VRS = new Set(['CD001', 'BEA01', 'NSR02', 'NSR03', 'TEA01', 'BOOT2', 'CDW02']);
const isVrs = (b) => b.length === 5 && VRS.has(latin1(b));

// Virtual "cooked" view of a raw dump: a Source of 2048-byte sectors, translating each request into the user-data
// windows of the raw sectors. EDC / ECC bytes are skipped, not verified: a reader has nothing better to offer when they
// mismatch, and checking costs a Reed-Solomon pass per sector.
function rawSource(src, sectorSize, skip) {
  const size = Math.floor(src.size / sectorSize) * SECTOR;
  return {
    name: src.name, size, rawSector: sectorSize,
    read(off, len) {
      len = Math.max(0, Math.min(len, size - off));
      if (len <= 0) return EMPTY;
      const first = Math.floor(off / SECTOR), last = Math.floor((off + len - 1) / SECTOR);
      if (first === last) return src.read(first * sectorSize + skip + off % SECTOR, len);
      const out = new Uint8Array(len);
      for (let s = first, o = 0; s <= last; s++) {
        const a = s === first ? off % SECTOR : 0, e = Math.min(SECTOR, off + len - s * SECTOR);
        out.set(readAt(src, s * sectorSize + skip + a, e - a), o);
        o += e - a;
      }
      return out;
    },
  };
}

function cookedSource(src) {
  if (isVrs(src.read(16 * SECTOR + 1, 5))) return src;
  const h = src.read(16 * 2352, 16);
  if (h.length === 16 && SYNC.every((v, i) => h[i] === v) && (h[15] === 1 || h[15] === 2)) {
    const r = rawSource(src, 2352, h[15] === 1 ? 16 : 24);
    if (isVrs(r.read(16 * SECTOR + 1, 5))) return r;
  }
  return src;
}

// Joliet = a Supplementary Volume Descriptor whose escape sequence (offset 88) is %/@, %/C or %/E (UCS-2 levels 1-3).
const isJoliet = (d) => d[88] === 0x25 && d[89] === 0x2f && (d[90] === 0x40 || d[90] === 0x43 || d[90] === 0x45);

/** Volume descriptors from sector 16: ISO 9660 ones up to the terminator, then the UDF recognition sequence. */
function scanDescriptors(src) {
  const vd = { pvd: null, joliet: null, enhanced: null, boot: -1, nsr: 0 };
  // Type 1 primary, 2 supplementary (Joliet) or enhanced (version 2 = ISO 9660:1999), 0 boot record (El Torito: the
  // catalog sector at 0x47), 255 terminator (falls through: no type matches). 256 sectors bound the scan on garbage.
  for (let s = 16; s < 16 + 256; s++) {
    const d = src.read(s * SECTOR, SECTOR);
    if (d.length < SECTOR) break;
    const id = latin1(d.subarray(1, 6));
    if (id === 'CD001') {
      const t = d[0];
      if (t === 1 && !vd.pvd) vd.pvd = d;
      else if (t === 2 && isJoliet(d)) vd.joliet ||= d;
      else if (t === 2 && d[6] === 2) vd.enhanced ||= d;
      else if (t === 0 && vd.boot < 0 && latin1(d.subarray(7, 30)) === 'EL TORITO SPECIFICATION') vd.boot = le32(d, 0x47);
      continue;
    }
    if (id === 'NSR02' || id === 'NSR03') vd.nsr = +id[4];
    else if (id !== 'BEA01' && id !== 'BOOT2' && id !== 'CDW02') break; // TEA01 or the end of the sequence
  }
  return vd;
}

// --- dates -----------------------------------------------------------------------------------------------------

// GMT offset in 15-minute units, signed, valid range -48..+52 (-12:00..+13:00); out-of-range values are treated as UTC
// rather than producing absurd dates.
const tzMs = (b) => { const tz = (b << 24) >> 24; return tz >= -48 && tz <= 52 ? tz * 900000 : 0; };

// 7 bytes of directory records and short-form TF: years since 1900, month, day, hour, minute, second, GMT offset in
// 15-minute units (signed).
function recDate(b, o) {
  const mo = b[o + 1], d = b[o + 2];
  if (!mo || mo > 12 || !d || d > 31) return undefined;
  return new Date(Date.UTC(1900 + b[o], mo - 1, d, b[o + 3], b[o + 4], b[o + 5]) - tzMs(b[o + 6]));
}

// 17 bytes of volume descriptors and long-form TF: "YYYYMMDDHHMMSScc" digits and the GMT offset byte.
function decDate(b, o) {
  const s = latin1(b.subarray(o, o + 16));
  if (!/^\d{16}$/.test(s) || +s.slice(0, 4) < 1000) return undefined;
  const mo = +s.slice(4, 6), d = +s.slice(6, 8);
  if (!mo || mo > 12 || !d || d > 31) return undefined;
  return new Date(Date.UTC(+s.slice(0, 4), mo - 1, d, +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14), +s.slice(14, 16) * 10) - tzMs(b[o + 16]));
}

// --- streams ---------------------------------------------------------------------------------------------------

/** Stream over blocks made on demand by `next()` (Uint8Array, or null at the end), honouring `max`. */
function blockStream(next, size) {
  let cur = EMPTY, p = 0;
  return {
    size,
    read(max = 1 << 20) {
      while (p >= cur.length) { const b = next(); if (!b) return null; cur = b; p = 0; }
      const r = cur.subarray(p, p + max);
      p += r.length;
      return r;
    },
  };
}

function zeroStream(n) {
  let left = n;
  const z = new Uint8Array(Math.min(n, 65536));
  return { size: n, read(max = 65536) { if (left <= 0) return null; const k = Math.min(left, max, z.length); left -= k; return z.subarray(0, k); } };
}

/** Interleaved extent: `unit` data bytes, then `gap` skipped bytes, repeated. */
// Interleaving (file unit size + gap size in the record) was meant for CD-i / real-time playback. `done` is always a
// multiple of `unit` when a new unit starts, so done / unit is the exact unit index.
function interleavedStream(src, off, len, unit, gap) {
  let done = 0, cur = null;
  return {
    size: len,
    read(max) {
      for (;;) {
        if (cur) { const b = cur.read(max); if (b) return b; cur = null; }
        if (done >= len) return null;
        const n = Math.min(unit, len - done);
        cur = sourceStream(src, off + (done / unit) * (unit + gap), n);
        done += n;
      }
    },
  };
}

function sized(streams, size) {
  const s = concatStreams(streams);
  s.size = size;
  return s;
}

// zisofs (Rock Ridge ZF 'pz'): 16-byte header (magic, size, header size / 4, log2 of the block size), a table of
// block offsets relative to the file start, then one zlib stream per block (equal offsets = a block of zeros).
const ZISOFS_MAGIC = [0x37, 0xe4, 0x53, 0x96, 0xc9, 0xdb, 0xd6, 0x07];

function zisofsStream(src, off, packed, size, name) {
  let ptr = null, i = 0, nb = 0, bsz = 0, out = 0;
  const bad = (why) => fail('corrupt', `corrupt data: zisofs ${why}${name ? ' in ' + name : ''}`);
  return blockStream(() => {
    if (!ptr) {
      const h = readAt(src, off, 16);
      if (!ZISOFS_MAGIC.every((v, k) => h[k] === v)) bad('header');
      const hs = h[12] * 4, lg = h[13];
      if (le32(h, 8) !== size || hs < 16 || lg < 15 || lg > 17) bad('header');
      bsz = 2 ** lg;
      nb = Math.ceil(size / bsz);
      if (hs + (nb + 1) * 4 > packed) bad('block pointers');
      const t = readAt(src, off + hs, (nb + 1) * 4);
      // Float64Array: the pointers are uint32 (an Int32Array would turn offsets >= 2 GiB negative). Block size 2^15..2^17
      // as mkzftree writes; anything else is treated as corrupt.
      ptr = new Float64Array(nb + 1);
      for (let k = 0; k <= nb; k++) ptr[k] = le32(t, k * 4);
    }
    if (i >= nb) { if (out !== size) bad('size'); return null; }
    const s = ptr[i], e = ptr[i + 1], n = Math.min(bsz, size - i * bsz);
    i++;
    if (e < s || e > packed) bad('block pointers');
    let b;
    if (e === s) b = new Uint8Array(n);
    else {
      try { b = unzlibSync(readAt(src, off + s, e - s), { size: n }); } catch (err) { if (err instanceof ArchiveError) throw err; bad('block ' + (i - 1)); }
      if (b.length !== n) bad('block size');
    }
    out += n;
    return b;
  }, size);
}

// --- archive object --------------------------------------------------------------------------------------------

// Openers live in a Map keyed by entry object, not on the entries, so the entry objects stay plain data (cloneable
// across a Worker boundary); index.js later rewrites paths but keeps the same objects, so the keys stay valid.
function makeArchive(format, label, entries, openers, info) {
  entries.forEach((e, i) => { e.index = i; });
  return {
    format, label, entries, info, password: null,
    open(entry) {
      const e = entries[entry.index];
      const fn = e && openers.get(e);
      if (fn) return fn();
      if (e && e.kind === 'symlink' && e.link != null) return bytesStream(UTF8.encode(e.link));
      return bytesStream(EMPTY);
    },
  };
}

// --- El Torito -------------------------------------------------------------------------------------------------

const MEDIA = ['NoEmul', '1.2M', '1.44M', '2.88M', 'HardDisk'];
const FLOPPY = [0, 1200 << 10, 1440 << 10, 2880 << 10];

/**
 * Boot images of the El Torito catalog as '[BOOT]/…' entries. Sizes: floppy emulation by media type, hard disk
 * emulation from the image's MBR, no emulation from the tree file starting at the same block when there is one
 * (the catalog only gives the sectors the BIOS loads), else the loaded sector count.
 */
function addBoot(src, catalog, fileStarts, entries, openers, warnings) {
  // Validation entry (first 32 bytes): header id 1, key bytes 55 AA at 30-31, and the 16 little-endian words must sum
  // to 0 mod 2^16. Then the initial / default entry (0x88 bootable, 0x00 not), then section headers (0x90 more
  // follow, 0x91 last) each with a count of 32-byte section entries.
  const cat = src.read(catalog * SECTOR, SECTOR);
  let sum = 0;
  for (let i = 0; i + 1 < 32 && cat.length >= 32; i += 2) sum += le16(cat, i);
  if (cat.length < 64 || cat[0] !== 1 || cat[30] !== 0x55 || cat[31] !== 0xaa || sum & 0xffff) { warnings.push('bad El Torito boot catalog'); return; }
  const items = [];
  const item = (o) => { if (le32(cat, o + 8) || cat[o]) items.push({ bootable: cat[o] === 0x88, media: cat[o + 1] & 15, count: le16(cat, o + 6), lba: le32(cat, o + 8) }); };
  item(32);
  for (let o = 64; o + 32 <= cat.length;) {
    const h = cat[o], n = le16(cat, o + 2);
    if (h !== 0x90 && h !== 0x91) break;
    o += 32;
    for (let k = 0; k < n && o + 32 <= cat.length; k++) {
      if (cat[o] === 0x88 || cat[o] === 0) item(o);
      o += 32;
      while (o + 32 <= cat.length && cat[o] === 0x44) o += 32; // section entry extensions
    }
    if (h === 0x91) break;
  }
  if (!items.length) return;
  entries.push({ index: 0, path: '[BOOT]', dir: true, kind: 'dir' });
  items.forEach((it, i) => {
    const off = it.lba * SECTOR;
    let size = it.count * 512;
    if (it.media >= 1 && it.media <= 3) size = FLOPPY[it.media];
    else if (it.media === 4) {
      const m = src.read(off, 512);
      if (m.length === 512 && m[510] === 0x55 && m[511] === 0xaa) {
        let end = 0;
        // MBR partition table: 4 entries of 16 bytes at 446; type byte at +4, first LBA at +8, sector count at +12.
        for (let p = 446; p < 510; p += 16) if (m[p + 4]) end = Math.max(end, le32(m, p + 8) + le32(m, p + 12));
        if (end) size = end * 512;
      }
    } else if (it.media === 0 && fileStarts.has(off)) size = fileStarts.get(off);
    size = Math.max(0, Math.min(size, src.size - off));
    const name = (items.length > 1 ? i + 1 + '-' : '') + (it.bootable ? 'Boot-' : 'NotBoot-') + (MEDIA[it.media] || it.media) + '.img';
    const e = { index: 0, path: '[BOOT]/' + name, dir: false, kind: 'file', size, packed: size };
    entries.push(e);
    openers.set(e, () => sourceStream(src, off, size));
  });
}

// --- ISO 9660 --------------------------------------------------------------------------------------------------

// Directory record (ECMA-119 9.1): length, extended attribute length (in blocks, the data starts after it), extent
// LBA (both-endian at 2), data length (both-endian at 10), 7-byte date at 18, flags at 25 (1 hidden, 2 directory,
// 4 associated file, 0x80 multi-extent), file unit size / gap at 26 / 27, name length at 32, name at 33, a pad byte
// when the name length is even, then the System Use area (SUSP / Rock Ridge).
function parseRecord(b, o, end) {
  const len = b[o];
  if (len < 34 || o + len > end) return null;
  const nl = b[o + 32];
  if (33 + nl > len) return null;
  const su = Math.min(len, 33 + nl + (nl & 1 ? 0 : 1));
  return {
    xa: b[o + 1], lba: le32(b, o + 2), size: le32(b, o + 10), date: recDate(b, o + 18), flags: b[o + 25],
    fus: b[o + 26], gap: b[o + 27], name: b.subarray(o + 33, o + 33 + nl), sua: b.subarray(o + su, o + len),
  };
}

// The root record of a volume descriptor is 34 bytes; some mastering tools write a longer one (libarchive's
// test_read_format_iso_3 has 68 bytes, running into the volume set identifier): only its fixed part is used.
function vdRoot(vd) {
  const r = parseRecord(vd, 156, 156 + Math.max(34, Math.min(vd[156], vd.length - 156)));
  if (r) r.sua = r.sua.subarray(0, 0);
  return r;
}

// '.' and '..' are encoded as the single bytes 0x00 and 0x01.
const isDot = (r) => r.name.length === 1 && r.name[0] <= 1;
const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// Joliet names are UCS-2 big-endian (an odd trailing byte from a buggy writer is dropped); plain ISO names are
// d-characters in theory and any local charset in practice. ';1' version suffixes and the '.' of "NAME." are an
// ISO 9660 artefact users never typed, so they are removed.
function isoName(b, joliet, charset) {
  let s = joliet ? UTF16BE.decode(b.length & 1 ? b.subarray(0, b.length - 1) : b) : decodeText(b, charset);
  const m = /;\d*$/.exec(s);
  if (m) s = s.slice(0, m.index);
  if (s.length > 1 && s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

class IsoReader {
  constructor(src, vd, opts, warnings) {
    this.src = src;
    this.vd = vd;
    this.charset = opts.charset || 'auto';
    this.warnings = warnings;
    this.warned = new Set();
    // Logical block size (both-endian at 128): almost always 2048; LBAs in records count these blocks.
    const bs = le16(vd.pvd, 128);
    this.bs = bs === 512 || bs === 1024 || bs === 2048 ? bs : SECTOR;
    this.entries = [];
    this.openers = new Map();
    this.fileStarts = new Map();
    this.visited = new Set();
    this.truncated = 0;
    this.relocated = false;
    this.pendingRe = [];
    this.zisofs = false;
  }

  warn(msg) { if (!this.warned.has(msg)) { this.warned.add(msg); this.warnings.push(msg); } }

  /** Records of a directory extent; records never cross a 2048-byte sector, a zero length byte skips to the next. */
  records(lba, size) {
    const off = lba * this.bs;
    if (size > MAX_DIR) { this.warn('oversized directory truncated'); size = MAX_DIR; }
    const b = this.src.read(off, size);
    if (b.length < size) this.warn('directory past the end of the image');
    const out = [];
    for (let p = 0; p < b.length;) {
      const next = Math.min(b.length, (Math.floor((off + p) / SECTOR) + 1) * SECTOR - off);
      if (!b[p]) { p = next; continue; }
      const r = parseRecord(b, p, next);
      if (!r) { this.warn('bad directory record'); p = next; continue; }
      out.push(r);
      p += b[p];
    }
    return out;
  }

  /** SUSP entries of a System Use field (after LEN_SKP), following CE continuation areas; cb(sig, entry). */
  // Entry header: 2-char signature, length, version. CE (continuation) points to more entries in another block:
  // block (at 4), offset (12), length (20). ST terminates. The hop limit stops CE cycles.
  susp(sua, cb, skip = this.skp) {
    let area = sua.subarray(Math.min(skip, sua.length));
    for (let hops = 0; area && hops < 32; hops++) {
      let ce = null;
      for (let p = 0; p + 4 <= area.length;) {
        const len = area[p + 2];
        if (len < 4 || p + len > area.length) break;
        const sig = String.fromCharCode(area[p], area[p + 1]), e = area.subarray(p, p + len);
        p += len;
        if (sig === 'ST') break;
        if (sig === 'CE' && len >= 28) ce = e;
        else cb(sig, e);
      }
      area = null;
      if (ce) {
        const n = Math.min(le32(ce, 20), 1 << 20);
        area = this.src.read(le32(ce, 4) * this.bs + le32(ce, 12), n);
        if (area.length < n) { this.warn('Rock Ridge continuation area past the end of the image'); area = null; }
      }
    }
  }

  /** Rock Ridge facts of a record. */
  rock(sua) {
    const rr = {}, nm = [], sl = [];
    let nmOpen = true, slOpen = true, sep = false;
    this.susp(sua, (sig, e) => {
      switch (sig) {
        // NM: name pieces concatenated while the CONTINUE flag (1) is set; flags CURRENT (2), PARENT (4) and HOST (0x20)
        // mean "no real name here".
        case 'NM':
          if (e.length >= 5 && nmOpen && !(e[4] & 0x26)) { nm.push(...e.subarray(5)); nmOpen = !!(e[4] & 1); }
          break;
        case 'PX':
          if (e.length >= 36) { rr.mode = le32(e, 4); rr.uid = le32(e, 20); rr.gid = le32(e, 28); } // links at 12, inode at 36 (1.12)
          break;
        // TF: flag bits select which timestamps follow (creation, modify, access, attributes, backup, expiration,
        // effective), bit 7 = long 17-byte form instead of the 7-byte record form.
        case 'TF': {
          const f = e[4], w = f & 0x80 ? 17 : 7;
          for (let bit = 0, p = 5; bit < 7; bit++) {
            if (!(f & (1 << bit))) continue;
            if (p + w > e.length) break;
            const d = w === 17 ? decDate(e, p) : recDate(e, p);
            p += w;
            if (bit === 0) rr.crtime = d; else if (bit === 1) rr.mtime = d; else if (bit === 2) rr.atime = d; else if (bit === 3) rr.chtime = d;
          }
          break;
        }
        case 'SL':
          // Components: flags (CONTINUE 1, CURRENT 2, PARENT 4, ROOT 8, VOLROOT 16, HOST 32), length, text. A '/'
          // separates components unless one continues into the next (possibly in the next SL entry).
          if (!slOpen || e.length < 5) break;
          rr.link = true;
          for (let p = 5; p + 2 <= e.length;) {
            const cf = e[p], cl = e[p + 1];
            if (p + 2 + cl > e.length) break;
            const text = e.subarray(p + 2, p + 2 + cl);
            p += 2 + cl;
            if (cf & 0x18) { sl.push(0x2f); sep = false; continue; }
            if (sep) sl.push(0x2f);
            if (cf & 2) sl.push(0x2e); else if (cf & 4) sl.push(0x2e, 0x2e); else if (!(cf & 0x20)) sl.push(...text);
            sep = !(cf & 1);
          }
          slOpen = !!(e[4] & 1);
          break;
        // Deep directory relocation (RRIP 4.1.5): ISO 9660 limits nesting to 8 levels, so deeper directories are moved
        // (usually to rr_moved, marked RE) and a placeholder file at the real place carries CL = the moved
        // directory's location. They are listed at the CL place; see read() / record().
        case 'CL': if (e.length >= 12) rr.cl = le32(e, 4); break;
        case 'RE': rr.re = true; break;
        case 'ZF': if (e.length >= 16) rr.zf = { alg: latin1(e.subarray(4, 6)), size: le32(e, 8) }; break;
      }
    });
    if (nm.length) rr.name = decodeText(Uint8Array.from(nm), this.charset);
    if (rr.link) rr.link = decodeText(Uint8Array.from(sl), this.charset);
    return rr;
  }

  /**
   * SP in the root's '.' record turns SUSP on (after the 14-byte XA record on CD-XA discs); Rock Ridge needs an RRIP
   * ER entry or RRIP entries there.
   */
  detectRockRidge(root) {
    const self = this.records(root.lba, Math.min(root.size, SECTOR))[0];
    const sua = self && isDot(self) ? self.sua : EMPTY;
    // SP: 'SP' len ver BE EF LEN_SKP, where LEN_SKP bytes are skipped at the start of every later System Use area.
    for (const base of [0, 14]) {
      const s = sua.subarray(Math.min(base, sua.length));
      if (s.length < 7 || s[0] !== 0x53 || s[1] !== 0x50 || s[4] !== 0xbe || s[5] !== 0xef) continue;
      this.skp = base + s[6];
      let rr = false;
      this.susp(sua, (sig, e) => {
        if (sig === 'ER' && e.length >= 8 && /^(RRIP_1991A|IEEE_P1282|IEEE_1282)$/.test(latin1(e.subarray(8, 8 + e[4])))) rr = true;
        else if (sig === 'RR' || sig === 'PX' || sig === 'NM' || sig === 'TF' || sig === 'SL') rr = true;
      }, base);
      return rr;
    }
    return false;
  }

  read() {
    const vd = this.vd, pvd = vd.pvd;
    const root = vdRoot(pvd);
    if (!root) corrupt('root directory record');
    this.skp = 0;
    const hasRr = this.detectRockRidge(root);
    // Name source preference: Rock Ridge (POSIX names, case, length) on the primary tree beats Joliet (UCS-2, 64 chars),
    // which beats ISO 9660:1999 (long but charset-less) and the 8.3 primary names.
    let tree = pvd, names = 'ISO 9660';
    if (hasRr) { this.rr = true; names = 'Rock Ridge'; } else if (vd.joliet) { tree = vd.joliet; this.joliet = true; names = 'Joliet'; } else if (vd.enhanced) { tree = vd.enhanced; names = 'ISO 9660:1999'; }
    const top = tree === pvd ? root : vdRoot(tree);
    if (!top) corrupt('root directory record');
    this.walk(top.lba, top.size, '', 0);
    // Relocated directories that no child link reached stay where they are (as libarchive and 7-Zip list them).
    for (let k = 0; k < this.pendingRe.length; k++) {
      const p = this.pendingRe[k];
      if (!this.visited.has(p.r.lba)) this.record([p.r], { ...p.rr, re: false }, p.prefix, p.depth);
    }
    let entries = this.entries;
    if (this.relocated) {
      // rr_moved holds the relocated directories, which are listed at their real place: hide it when nothing else is in it.
      entries = entries.filter((e) => !(e.dir && /^\.?rr_moved$/i.test(e.path) && !this.entries.some((x) => x.path.startsWith(e.path + '/'))));
    }
    if (this.truncated) this.warnings.push(`the image is truncated: ${this.truncated} file${this.truncated > 1 ? 's extend' : ' extends'} past its end`);
    else if (le32(pvd, 80) * this.bs > this.src.size) this.warnings.push(`the image is ${le32(pvd, 80) * this.bs - this.src.size} bytes shorter than its volume`);
    const ext = [];
    if (vd.joliet) ext.push('Joliet');
    if (hasRr) ext.push('Rock Ridge');
    if (this.zisofs) ext.push('zisofs');
    if (vd.enhanced) ext.push('ISO 9660:1999');
    if (vd.boot >= 0) ext.push('El Torito');
    const text = (d, a, b) => (d === vd.joliet ? UTF16BE.decode(d.subarray(a, b)) : decodeText(d.subarray(a, b), this.charset)).replace(/[\0 ]+$/, '');
    const props = [];
    const prop = (k, v) => { if (v !== undefined && v !== '') props.push([k, v]); };
    const idv = vd.joliet && this.joliet ? vd.joliet : pvd;
    prop('Volume', text(idv, 40, 72));
    prop('Volume set', text(idv, 190, 318));
    prop('System', text(idv, 8, 40));
    prop('Publisher', text(idv, 318, 446));
    prop('Preparer', text(idv, 446, 574));
    prop('Application', text(idv, 574, 702));
    prop('Created', decDate(pvd, 813));
    prop('Modified', decDate(pvd, 830));
    prop('Extensions', ext.join(', '));
    prop('Names', names);
    prop('Block size', this.bs);
    prop('Volume size', le32(pvd, 80) * this.bs);
    if (this.src.rawSector) prop('Sector size', this.src.rawSector);
    return { entries, props };
  }

  walk(lba, size, prefix, depth) {
    if (depth >= MAX_DEPTH) return this.warn(`directories nested deeper than ${MAX_DEPTH} levels skipped`);
    if (this.visited.has(lba)) return this.warn('directory loop skipped');
    this.visited.add(lba);
    const recs = this.records(lba, size);
    for (let i = 0; i < recs.length; i++) {
      let r = recs[i];
      if (isDot(r) || r.flags & 4) continue; // '.', '..', associated files (resource forks)
      // Multi-extent files (> 4 GiB, ISO 9660 level 3): consecutive records with the same name, all but the last
      // flagged 0x80; their extents are concatenated in record order.
      const parts = [r];
      while (r.flags & 0x80 && i + 1 < recs.length && sameBytes(recs[i + 1].name, r.name)) parts.push((r = recs[++i]));
      const rr = this.rr ? this.rock(parts[0].sua) : null;
      // Shown at its real place through a CL record (or in place when none points to it, see read()).
      if (rr && rr.re) { this.relocated = true; this.pendingRe.push({ r: parts[0], rr, prefix, depth }); continue; }
      this.record(parts, rr, prefix, depth);
    }
  }

  /** One directory record (with its multi-extent parts): its entry, and the subtree of a directory. */
  record(parts, rr, prefix, depth) {
    const first = parts[0];
    let dir = !!(first.flags & 2), dlba = first.lba, dsize = first.size, attrs = rr;
    if (rr && rr.cl != null) {
      const self = this.records(rr.cl, SECTOR)[0];
      if (!self || !isDot(self)) { this.warn('bad Rock Ridge child link'); return; }
      dir = true;
      dlba = rr.cl;
      dsize = self.size;
      attrs = { ...rr, ...this.rock(self.sua), name: rr.name };
    }
    const path = prefix + safeName(rr && rr.name != null ? rr.name : isoName(first.name, this.joliet, this.charset));
    const ent = { index: 0, path, dir, kind: dir ? 'dir' : 'file' };
    const mtime = (attrs && attrs.mtime) || first.date;
    if (mtime) ent.mtime = mtime;
    if (attrs) {
      if (attrs.atime) ent.atime = attrs.atime;
      if (attrs.crtime || attrs.chtime) ent.ctime = attrs.crtime || attrs.chtime;
      if (attrs.mode != null) {
        ent.mode = attrs.mode;
        ent.uid = attrs.uid;
        ent.gid = attrs.gid;
        const t = attrs.mode & S_IFMT;
        if (!dir && t && t !== S_IFREG && t !== S_IFLNK) ent.kind = 'other';
      }
      if (!dir && attrs.link != null) { ent.kind = 'symlink'; ent.link = attrs.link; }
    }
    if (first.flags & 1) ent.attrib = dir ? 0x12 : 0x02; // hidden
    this.entries.push(ent);
    if (dir) { this.walk(dlba, dsize, path + '/', depth + 1); return; }
    this.addData(ent, parts, rr);
  }

  addData(ent, parts, rr) {
    const src = this.src, bs = this.bs;
    const runs = parts.map((r) => ({ off: (r.lba + r.xa) * bs, len: r.size, unit: r.fus && r.gap ? r.fus * bs : 0, gap: r.gap * bs }));
    let size = 0, cut = false;
    for (const r of runs) {
      size += r.len;
      const end = r.unit ? r.off + Math.floor((r.len - 1) / r.unit) * (r.unit + r.gap) + ((r.len - 1) % r.unit) + 1 : r.off + r.len;
      if (r.len && end > src.size) cut = true;
    }
    if (cut) this.truncated++;
    ent.size = ent.packed = size;
    if (ent.kind !== 'file') return;
    if (runs.length && runs[0].len) this.fileStarts.set(runs[0].off, size);
    // zisofs: the record's extent holds the compressed form; ZF gives the real size. Only 'pz' (zlib) in one plain
    // extent is supported; 'by' (bzip2, zisofs v2) and interleaved / multi-extent combinations are listed unsupported.
    if (rr && rr.zf) {
      this.zisofs = true;
      if (rr.zf.alg !== 'pz' || runs.length !== 1 || runs[0].unit) { ent.unsupported = 'zisofs variant ' + JSON.stringify(rr.zf.alg); ent.method = 'zisofs'; return; }
      ent.size = rr.zf.size;
      ent.method = 'zisofs';
      this.openers.set(ent, () => (ent.size ? zisofsStream(src, runs[0].off, runs[0].len, rr.zf.size, ent.path) : bytesStream(EMPTY)));
      return;
    }
    this.openers.set(ent, () => sized(runs.filter((r) => r.len).map((r) => () => (r.unit ? interleavedStream(src, r.off, r.len, r.unit, r.gap) : sourceStream(src, r.off, r.len))), size));
  }
}

// --- UDF -------------------------------------------------------------------------------------------------------

/**
 * Descriptor tag: identifier, checksum over bytes 0-15 except 4, and (when given) the recorded location.
 * The tag location check is what makes a stray copy of a descriptor (e.g. inside a disc image stored as a file)
 * fail. The descriptor CRC (bytes 8-11 over the body) is not verified: the checksum and location already reject
 * misreads, and corrupt bodies are caught by the field checks that follow.
 */
function tagOk(b, o, id, loc) {
  if (b.length < o + 16 || le16(b, o) !== id) return false;
  let sum = 0;
  for (let i = 0; i < 16; i++) if (i !== 4) sum += b[o + i];
  return (sum & 255) === b[o + 4] && (loc == null || le32(b, o + 12) === loc);
}

/** OSTA compressed Unicode: 8 (or 254) = one byte per character, 16 (or 255) = UTF-16BE. */
function cs0(b) {
  if (!b.length) return '';
  const c = b[0], t = b.subarray(1);
  if (c === 16 || c === 255) return UTF16BE.decode(t.length & 1 ? t.subarray(0, t.length - 1) : t);
  return latin1(t);
}
// dstring: fixed-size field whose last byte holds the used length (including the compression id byte).
const dstring = (b, o, n) => { const len = b[o + n - 1]; return cs0(b.subarray(o, o + Math.min(len, n - 1))).replace(/\0+$/, ''); };
const regid = (b, o) => latin1(b.subarray(o + 1, o + 24)).replace(/\0[\s\S]*$/, '').trim();

// 12-byte timestamp: type (high 4 bits; 1 = local time with a zone offset in minutes, low 12 bits, -2047 = none),
// year, month, day, hour, minute, second, centi-, hundreds-of-micro-, microseconds.
function udfTime(b, o) {
  const tz = le16(b, o), mo = b[o + 4], d = b[o + 5];
  if (!mo || mo > 12 || !d || d > 31) return undefined;
  let off = tz & 0xfff;
  if (off & 0x800) off -= 0x1000;
  const year = (le16(b, o + 2) << 16) >> 16;
  const ms = Date.UTC(year, mo - 1, d, b[o + 6], b[o + 7], b[o + 8], b[o + 9] * 10 + b[o + 10] / 10 + b[o + 11] / 1000);
  return new Date(tz >> 12 === 1 && off >= -1440 && off <= 1440 ? ms - off * 60000 : ms);
}

class UdfReader {
  constructor(src, warnings) {
    this.src = src;
    this.warnings = warnings;
    this.warned = new Set();
    this.entries = [];
    this.openers = new Map();
    this.fileStarts = new Map();
    this.visited = new Set();
  }

  warn(msg) { if (!this.warned.has(msg)) { this.warned.add(msg); this.warnings.push(msg); } }

  /** Anchor volume descriptor pointer at block 256 (or the last block, or 256 before it) for the usual block sizes. */
  anchor() {
    const src = this.src;
    for (const bs of [2048, 512, 1024, 4096]) {
      const n = Math.floor(src.size / bs);
      for (const lb of [256, n - 1, n - 257]) {
        if (lb < 256 || (lb + 1) * bs > src.size) continue;
        const b = src.read(lb * bs, 32);
        if (tagOk(b, 0, 2, lb)) return { bs, main: [le32(b, 16), le32(b, 20)], reserve: [le32(b, 24), le32(b, 28)] };
      }
    }
    return null;
  }

  /** Volume descriptor sequence: the primary, partition and logical volume descriptors (highest sequence number wins). */
  // Descriptor ids: 1 primary volume, 3 volume descriptor pointer (continue elsewhere), 5 partition, 6 logical
  // volume, 8 terminating. Prevailing copy = highest volume descriptor sequence number (offset 16).
  sequence([len, loc]) {
    const bs = this.bs, vol = { pvd: null, lvd: null, parts: new Map() };
    const newer = (a, b) => !a || le32(b, 16) >= le32(a, 16);
    for (let hops = 0, n = Math.min(Math.ceil(len / bs), 4096), lb = loc; n > 0 && hops < 16; n--, lb++) {
      const b = this.src.read(lb * bs, bs);
      if (b.length < bs) break;
      const id = le16(b, 0);
      if (!tagOk(b, 0, id) || id === 8) break; // terminating descriptor
      if (id === 1 && newer(vol.pvd, b)) vol.pvd = b;
      else if (id === 5 && newer(vol.parts.get(le16(b, 22)), b)) vol.parts.set(le16(b, 22), b);
      else if (id === 6 && newer(vol.lvd, b)) vol.lvd = b;
      else if (id === 3) { hops++; n = Math.min(Math.ceil(le32(b, 20) / bs), 4096) + 1; lb = le32(b, 24) - 1; } // continues elsewhere
    }
    return vol;
  }

  /**
   * Partition maps of the logical volume: per reference number `fn(lb, len) -> [[offset, len], …]` (pieces of the
   * image). Type 1 maps a physical partition; type 2 a sparable one (packets remapped by the sparing table) or a
   * metadata one (UDF 2.50+: blocks inside the extents of the metadata file, itself in the physical partition).
   */
  partitions(vol) {
    const lvd = vol.lvd, bs = this.bs, maps = (this.maps = []), metas = [];
    const count = le32(lvd, 268), end = Math.min(lvd.length, 440 + le32(lvd, 264));
    for (let i = 0, p = 440; i < count && p + 6 <= end; i++) {
      const type = lvd[p], len = lvd[p + 1];
      if (len < 6 || p + len > end) break;
      const num = le16(lvd, type === 1 ? p + 4 : p + 38), pd = vol.parts.get(num), start = pd ? le32(pd, 188) * bs : 0;
      const m = { type, num, fn: null };
      if (!pd) this.warn(`UDF partition ${num} missing`);
      else if (type === 1) m.fn = (lb, l) => [[start + lb * bs, l]];
      else if (type === 2) {
        const ident = latin1(lvd.subarray(p + 5, p + 28)).replace(/\0[\s\S]*$/, '');
        if (ident === '*UDF Sparable Partition') m.fn = this.sparable(start, lvd, p);
        else if (ident === '*UDF Metadata Partition') {
          m.meta = { file: le32(lvd, p + 40), mirror: le32(lvd, p + 44), extents: null };
          m.fn = (lb, l) => this.metaMap(m.meta, lb, l);
          metas.push(m);
        } else if (ident === '*UDF Virtual Partition') this.virtual = true;
        else this.warn('UDF partition type not supported: ' + ident);
      }
      maps.push(m);
      p += len;
    }
    for (const m of metas) {
      const ref = maps.findIndex((x) => x.num === m.num && x.fn && !x.meta);
      for (const lb of [m.meta.file, m.meta.mirror]) {
        try {
          const fe = this.entry({ ref, lb });
          if (!fe.runs || fe.runs.some((r) => r.sparse || !maps[r.ref] || maps[r.ref].meta)) corrupt('UDF metadata file');
          let at = 0;
          m.meta.extents = fe.runs.map((r) => { const k = Math.ceil(r.len / bs); at += k; return { from: at - k, ref: r.ref, lb: r.lb, count: k }; });
          break;
        } catch (e) {
          if (!(e instanceof ArchiveError)) throw e;
          this.warn('UDF metadata file unreadable, its mirror used');
        }
      }
      if (!m.meta.extents) corrupt('UDF metadata partition');
      this.metadata = true;
    }
  }

  // Sparable partitions (CD-RW / DVD-RW): defective packets of `packet` blocks are remapped; the sparing table maps
  // an original packet start to its replacement location (entries >= 0xFFFFFFF0 are free / defective markers).
  sparable(start, lvd, p) {
    const bs = this.bs, packet = le16(lvd, p + 40) || 32, tables = lvd[p + 42], spare = new Map();
    for (let t = 0; t < tables && t < 4; t++) {
      const b = this.src.read(le32(lvd, p + 48 + 4 * t) * bs, bs);
      if (b.length < 64 || latin1(b.subarray(17, 40)).replace(/\0[\s\S]*$/, '') !== '*UDF Sparing Table') continue;
      for (let k = 0, o = 64, n = le16(b, 56); k < n && o + 8 <= b.length; k++, o += 8) if (le32(b, o) < 0xfffffff0) spare.set(le32(b, o), le32(b, o + 4));
      break;
    }
    if (!spare.size) return (lb, l) => [[start + lb * bs, l]];
    // Requests start on a block, so every piece but the last ends on a packet boundary.
    return (lb, l) => {
      const out = [];
      for (let o = 0; o < l;) {
        const b = lb + o / bs, pk = b - (b % packet), n = Math.min(l - o, (pk + packet - b) * bs), m = spare.get(pk);
        out.push([m != null ? (m + b - pk) * bs : start + b * bs, n]);
        o += n;
      }
      return out;
    };
  }

  metaMap(meta, lb, l) {
    const bs = this.bs, out = [];
    for (let o = 0; o < l;) {
      const b = lb + o / bs, x = meta.extents.find((e) => b >= e.from && b < e.from + e.count);
      if (!x) corrupt('UDF metadata block ' + b);
      const n = Math.min(l - o, (x.from + x.count - b) * bs);
      out.push(...this.resolve(x.ref, x.lb + b - x.from, n));
      o += n;
    }
    return out;
  }

  resolve(ref, lb, len) {
    const m = this.maps[ref];
    if (!m || !m.fn) corrupt('UDF partition reference ' + ref);
    return m.fn(lb, len);
  }

  block(ref, lb) {
    const [[off]] = this.resolve(ref, lb, this.bs);
    return readAt(this.src, off, this.bs);
  }

  /** File entry / extended file entry of an ICB (following indirect entries). */
  // Tag ids: 259 indirect entry (follow), 261 file entry, 266 extended file entry (UDF 2.00+; extra creation time
  // and stream directory, so every later field shifts). ICB flags bits 0-2 = allocation descriptor type: 0 short,
  // 1 long, 2 extended, 3 data embedded in the entry itself (small files and directories).
  entry(loc) {
    const bs = this.bs;
    for (let hops = 0; hops < 8; hops++) {
      const b = this.block(loc.ref, loc.lb);
      const id = le16(b, 0);
      if (!tagOk(b, 0, id)) corrupt('UDF descriptor tag');
      if (id === 259) { loc = { ref: le16(b, 36 + 8), lb: le32(b, 36 + 4) }; continue; }
      if (id !== 261 && id !== 266) corrupt('UDF file entry expected');
      const x = id === 266;
      const flags = le16(b, 34), ad = flags & 7;
      const fe = {
        type: b[27], flags, uid: le32(b, 36), gid: le32(b, 40), perm: le32(b, 44), size: le64(b, 56),
        recorded: le64(b, x ? 72 : 64) * bs, atime: udfTime(b, x ? 80 : 72), mtime: udfTime(b, x ? 92 : 84),
        ctime: x ? udfTime(b, 104) : undefined, attime: udfTime(b, x ? 116 : 96),
      };
      const base = x ? 216 : 176, lea = le32(b, x ? 208 : 168), lad = le32(b, x ? 212 : 172);
      if (base + lea + lad > bs) corrupt('UDF file entry lengths');
      const ads = b.subarray(base + lea, base + lea + lad);
      if (ad === 3) { fe.embedded = ads.slice(0, Math.min(lad, fe.size)); fe.recorded = 0; } else if (ad <= 2) fe.runs = this.ads(ads, ad, loc.ref, fe.size);
      else corrupt('UDF allocation descriptor type');
      return fe;
    }
    corrupt('UDF indirect entry chain');
  }

  /** Allocation descriptors (short 8, long 16, extended 20 bytes), following allocation extent descriptors. */
  ads(area, type, ref, size) {
    const step = type === 0 ? 8 : type === 1 ? 16 : 20, out = [];
    let total = 0;
    for (let hops = 0; area && hops < 65536; hops++) {
      let next = null;
      for (let p = 0; p + step <= area.length && total < size; p += step) {
        // Extent length: low 30 bits; type in the top 2 bits: 0 recorded, 1 allocated but not recorded, 2 neither
        // (both read as zeros: sparse), 3 = the next allocation extent descriptor (a continuation of this list).
        const raw = le32(area, p), len = raw & 0x3fffffff, et = raw >>> 30;
        if (!len) break;
        let lb = le32(area, p + 4), r = ref;
        if (type === 1) r = le16(area, p + 8);
        else if (type === 2) { lb = le32(area, p + 12); r = le16(area, p + 16); }
        if (et === 3) { next = { ref: r, lb }; break; }
        const n = Math.min(len, size - total);
        out.push({ ref: r, lb, len: n, sparse: et !== 0 });
        total += n;
      }
      area = null;
      if (next && total < size) {
        const b = this.block(next.ref, next.lb);
        if (!tagOk(b, 0, 258)) corrupt('UDF allocation extent descriptor');
        area = b.subarray(24, Math.min(b.length, 24 + le32(b, 20)));
        ref = next.ref;
      }
    }
    if (total < size) this.warn('UDF file shorter than its recorded length');
    return out;
  }

  data(fe) {
    if (fe.embedded) return bytesStream(fe.embedded);
    const streams = [];
    for (const r of fe.runs) {
      if (r.sparse) streams.push(zeroStream(r.len));
      else for (const [off, len] of this.resolve(r.ref, r.lb, r.len)) streams.push(() => sourceStream(this.src, off, len));
    }
    return sized(streams, fe.runs.reduce((n, r) => n + r.len, 0));
  }

  small(fe, limit) {
    if (fe.size > limit) corrupt('UDF directory or link too large');
    return readAll(this.data(fe));
  }

  /** Symlink data: path components (1 root, 2 root of this file system, 3 parent, 4 current, 5 name). */
  link(b) {
    let s = '';
    for (let p = 0; p + 4 <= b.length;) {
      const t = b[p], n = b[p + 1];
      if (p + 4 + n > b.length) break;
      const name = cs0(b.subarray(p + 4, p + 4 + n));
      p += 4 + n;
      if (t === 1 || t === 2) { s = '/'; continue; }
      const part = t === 3 ? '..' : t === 4 ? '.' : t === 5 ? name : null;
      if (part == null) continue;
      s += (s && !s.endsWith('/') ? '/' : '') + part;
    }
    return s;
  }

  walk(loc, fe, prefix, depth) {
    if (depth >= MAX_DEPTH) return this.warn(`directories nested deeper than ${MAX_DEPTH} levels skipped`);
    const key = loc.ref + ':' + loc.lb;
    if (this.visited.has(key)) return this.warn('directory loop skipped');
    this.visited.add(key);
    const d = this.small(fe, MAX_DIR);
    // File identifier descriptors (tag 257): characteristics at 18 (1 hidden, 2 directory, 4 deleted, 8 parent),
    // name length at 19, ICB long_ad at 20 (lb at 24, partition ref at 28), implementation-use length at 36, then the
    // implementation use, the name, and padding to a multiple of 4.
    for (let p = 0; p + 38 <= d.length;) {
      if (!tagOk(d, p, 257)) { this.warn('bad UDF file identifier'); break; }
      const chars = d[p + 18], lfi = d[p + 19], liu = le16(d, p + 36), total = (38 + liu + lfi + 3) & ~3;
      if (p + 38 + liu + lfi > d.length) { this.warn('bad UDF file identifier'); break; }
      const name = cs0(d.subarray(p + 38 + liu, p + 38 + liu + lfi));
      const icb = { ref: le16(d, p + 28), lb: le32(d, p + 24) };
      p += total;
      if (chars & 0x0c) continue; // deleted, parent
      let f;
      try { f = this.entry(icb); } catch (e) { if (!(e instanceof ArchiveError)) throw e; this.warn('unreadable UDF file entry: ' + prefix + name); continue; }
      if (f.type === 13) continue; // stream directory
      const dir = f.type === 4, path = prefix + safeName(name);
      const ent = { index: 0, path, dir, kind: dir ? 'dir' : f.type === 12 ? 'symlink' : f.type === 5 || f.type === 249 ? 'file' : 'other' };
      if (!dir) { ent.size = f.size; ent.packed = f.embedded ? f.size : f.recorded || f.size; } // recorded blocks
      if (f.mtime) ent.mtime = f.mtime;
      if (f.atime) ent.atime = f.atime;
      if (f.ctime || f.attime) ent.ctime = f.ctime || f.attime;
      // UDF permissions: 5 bits per class (other 0-4, group 5-9, owner 10-14: execute, write, read, change attr,
      // delete); the low three bits of each class map onto POSIX x / w / r. setuid / setgid / sticky are ICB flags.
      const p7 = f.perm;
      let mode = (((p7 >> 10) & 7) << 6) | (((p7 >> 5) & 7) << 3) | (p7 & 7);
      if (f.flags & 0x40) mode |= 0o4000;
      if (f.flags & 0x80) mode |= 0o2000;
      if (f.flags & 0x100) mode |= 0o1000;
      ent.mode = mode | (dir ? S_IFDIR : ent.kind === 'symlink' ? S_IFLNK : ent.kind === 'file' ? S_IFREG : 0);
      if (f.uid !== 0xffffffff) ent.uid = f.uid;
      if (f.gid !== 0xffffffff) ent.gid = f.gid;
      if (chars & 1) ent.attrib = dir ? 0x12 : 0x02;
      this.entries.push(ent);
      if (dir) { this.walk(icb, f, path + '/', depth + 1); continue; }
      if (ent.kind === 'symlink') {
        try { ent.link = this.link(this.small(f, 65536)); } catch (e) { if (!(e instanceof ArchiveError)) throw e; this.warn('unreadable UDF symlink: ' + path); }
        continue;
      }
      if (ent.kind !== 'file') continue;
      if (f.runs && f.runs.length && !f.runs[0].sparse) {
        try { this.fileStarts.set(this.resolve(f.runs[0].ref, f.runs[0].lb, 1)[0][0], f.size); } catch { /* reported when opened */ }
      }
      this.openers.set(ent, () => this.data(f));
    }
  }

  read() {
    const a = this.anchor();
    if (!a) fail('format', 'no UDF anchor volume descriptor');
    this.bs = a.bs;
    let vol = this.sequence(a.main);
    if (!vol.lvd || !vol.parts.size) vol = this.sequence(a.reserve);
    if (!vol.lvd || !vol.parts.size) corrupt('UDF volume descriptor sequence');
    this.vol = vol;
    // Logical block size different from the sector size would need a second address translation layer; real discs
    // never do it, so it is refused rather than half-supported.
    const lbs = le32(vol.lvd, 212);
    if (lbs !== this.bs) fail('unsupported', `not supported: UDF logical block size ${lbs} on ${this.bs}-byte sectors`);
    this.partitions(vol);
    if (this.virtual) fail('unsupported', 'not supported: UDF virtual partition (VAT)');
    const lvd = vol.lvd;
    const fsdLoc = { ref: le16(lvd, 256), lb: le32(lvd, 252) };
    const fsd = this.block(fsdLoc.ref, fsdLoc.lb);
    if (!tagOk(fsd, 0, 256)) corrupt('UDF file set descriptor');
    const rootLoc = { ref: le16(fsd, 408), lb: le32(fsd, 404) };
    const root = this.entry(rootLoc);
    if (root.type !== 4) corrupt('UDF root is not a directory');
    this.walk(rootLoc, root, '', 0);
    const rev = le16(lvd, 216 + 24);
    const pvd = vol.pvd;
    const props = [];
    const prop = (k, v) => { if (v !== undefined && v !== '') props.push([k, v]); };
    prop('Volume', dstring(lvd, 84, 128) || (pvd && dstring(pvd, 24, 32)));
    if (pvd) prop('Volume set', dstring(pvd, 72, 128));
    prop('File set', dstring(fsd, 304, 32));
    if (pvd) prop('Application', regid(pvd, 344));
    if (pvd) prop('Implementation', regid(pvd, 388));
    prop('Created', (pvd && udfTime(pvd, 376)) || udfTime(fsd, 16));
    prop('Version', rev ? (rev >> 8).toString(16) + '.' + (rev & 255).toString(16).padStart(2, '0') : undefined);
    if (this.metadata) prop('Partitions', 'metadata');
    prop('Block size', this.bs);
    return { entries: this.entries, props, version: rev };
  }
}

// --- entry points ----------------------------------------------------------------------------------------------

export function openIso(sources, opts = {}) {
  const src = cookedSource(concatSource(Array.isArray(sources) ? sources : [sources]));
  const vd = scanDescriptors(src);
  const want = opts.filesystem || 'auto';
  const warnings = [];
  let udfError = null;
  if (want === 'udf' || (want !== 'iso9660' && (vd.nsr || !vd.pvd))) {
    try {
      const u = new UdfReader(src, warnings);
      const { entries, props } = u.read();
      if (vd.pvd) props.push(['Bridge', 'ISO 9660' + (vd.joliet ? ' + Joliet' : '')]);
      if (vd.boot >= 0) addBoot(src, vd.boot, u.fileStarts, entries, u.openers, warnings);
      if (src.rawSector) props.push(['Sector size', src.rawSector]);
      const info = { props };
      if (warnings.length) info.warnings = warnings;
      return makeArchive('udf', 'UDF', entries, u.openers, info);
    } catch (e) {
      if (!(e instanceof ArchiveError) || !vd.pvd || want === 'udf') {
        if (e instanceof ArchiveError && e.code === 'format' && !vd.pvd) fail('format', want === 'udf' ? 'no UDF file system' : 'not an ISO 9660 or UDF image');
        throw e;
      }
      udfError = e;
      warnings.length = 0;
    }
  }
  if (want === 'udf') fail('format', 'no UDF file system');
  if (!vd.pvd) fail('format', 'not an ISO 9660 image');
  const r = new IsoReader(src, vd, opts, warnings);
  const { entries, props } = r.read();
  if (vd.boot >= 0) addBoot(src, vd.boot, r.fileStarts, entries, r.openers, warnings);
  if (udfError) warnings.push('UDF file system unreadable (' + udfError.message + '); the ISO 9660 tree is listed');
  else if (vd.nsr) props.push(['UDF', 'present (not listed)']);
  const info = { props };
  if (r.zisofs) info.methods = ['zisofs'];
  if (warnings.length) info.warnings = warnings;
  return makeArchive('iso', 'ISO 9660', entries, r.openers, info);
}

export const openUdf = (sources, opts = {}) => openIso(sources, { ...opts, filesystem: 'udf' });
