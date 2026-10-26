// archive/arc.js - SEA ARC and its PKARC / PKPAK / PAK relatives (.arc, .ark, .pak): listing and extraction of the
// header types 1-9 (stored, packed, squeezed, crunched, squashed), ARC 6 sub-directories, self-extractor stubs.
//
//   openArc(sources, { charset }) -> Archive (README.md). Entries: path, size, packed, mtime (DOS local time), method
//     ('Stored', 'Packed', 'Squeezed', 'Crunched', 'Squashed'), crc (CRC-16, verified at the end of open() streams).
//     PAK's crushed (10) and distilled (11) entries are listed with `unsupported`. info.sfx: offset of the archive
//     behind an executable stub.
//   arcCrc16(bytes, crc = 0) -> CRC-16/ARC (reflected polynomial 0xA001, initial 0)
//   Decoders (pull streams over an io.js Reader, reusable by other formats of the CP/M - DOS era):
//     arcRleStream(reader)              0x90 n = the previous byte n - 1 more times, 0x90 0x00 = a literal 0x90
//     unsqueezeStream(reader)           Huffman: node count + signed 16-bit child pairs, then LSB-first bits; 256 = end
//     uncrunchStream(reader, newHash)   12-bit LZW of types 5-7: codes are slots of a hashed string table
//     arcLzwStream(reader, maxBits)     9..maxBits-bit LZW with clear code 256, Unix compress code packing (type 8:
//                                       maxBits = 0 takes it from the first data byte; type 9: 13)
//
// Entry header: 0x1A, type, name[13] (NUL-terminated DOS name), packed u32, date u16, time u16, CRC-16, size u32 (type
// 1 lacks the size: it equals the packed size); the data follows. 0x1A 0x00 ends the archive. Types 3, 4, 6, 7 and 8
// run-length encode the data before the other stage, so their decoders end in arcRleStream. ARC 6 extensions are
// read as far as known: information blocks (types 20-29) are skipped, a directory (type 30) is taken to hold a
// nested archive in its data. Damaged stretches are skipped up to the next plausible header (as ARC does), with a
// warning; bytes after the end marker other than padding (e.g. PKPAK comments) are only reported.
//
// There is no formal spec: the references are the ARC 5.21 sources (arcunp.c, arclzw.c, arcsq.c) and the PKPAK /
// PAK documentation. ARC has no magic number and no central directory, so both detection and recovery rely on the
// plausibility of headers (readHeader's `strict` levels); this is why the code is defensive about every field.

import { EMPTY, Reader, bytesStream, concatSource, corrupt, decodeText, dosDateTime, fail, hashStream, le16, le32, sourceStream, unsupported } from './io.js';

const MARK = 0x1a, DLE = 0x90, OUT = 1 << 16, NO_PRED = 0xffff;
const SFX_SCAN = 1 << 18;   // how far a self-extractor stub may push the first header
const RESYNC_SCAN = 1 << 20; // how far a damaged stretch between two entries is searched
const METHODS = ['', 'Stored', 'Stored', 'Packed', 'Squeezed', 'Crunched', 'Crunched', 'Crunched', 'Crunched', 'Squashed', 'Crushed', 'Distilled'];

// --- CRC-16 ----------------------------------------------------------------------------------------------------

// CRC-16/ARC: reflected 0x8005 (= 0xA001), init 0, no final XOR; the same CRC LHA and many DOS tools use. Table
// built eagerly: 512 bytes, cheaper than the lazy-init branch it would need.
const CRC16 = new Uint16Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1;
  CRC16[n] = c;
}

export function arcCrc16(b, crc = 0) {
  for (let i = 0; i < b.length; i++) crc = (crc >>> 8) ^ CRC16[(crc ^ b[i]) & 0xff];
  return crc;
}

// --- decoders --------------------------------------------------------------------------------------------------

// Same convention as pkware.js: every decoder here writes into one fixed 64 KiB output array.
const clampMax = (max) => (max > 0 && max < OUT ? max : OUT);

// Pull stream over next(), which decodes the following string into stack[start, stack.length) and returns `start`
// (-1 at the end of the data). LZW decoders build strings backwards, so they land there naturally.
function stringStream(stack, next) {
  const top = stack.length, out = new Uint8Array(OUT);
  let sp = top, done = false;
  return {
    read(max) {
      if (done) return null;
      max = clampMax(max);
      let n = 0;
      while (n < max) {
        if (sp === top) {
          const s = next();
          if (s < 0) { done = true; break; }
          sp = s;
        }
        const k = Math.min(top - sp, max - n);
        for (let i = 0; i < k; i++) out[n + i] = stack[sp + i];
        n += k;
        sp += k;
      }
      return n ? out.subarray(0, n) : null;
    },
  };
}

/** ARC's run-length stage: 0x90 n repeats the previous byte n - 1 more times; 0x90 0x00 is a literal 0x90. */
export function arcRleStream(r) {
  const out = new Uint8Array(OUT);
  let last = 0, rep = 0, dle = false;
  return {
    read(max) {
      max = clampMax(max);
      let n = 0;
      while (n < max) {
        if (rep) {
          const k = Math.min(rep, max - n);
          out.fill(last, n, n + k);
          n += k;
          rep -= k;
          continue;
        }
        const c = r.byte();
        if (c < 0) break;
        if (dle) {
          dle = false;
          // A literal 0x90 does not become the byte to repeat (ARC's putc_ncr; its packer never needs it to).
          if (c) rep = c - 1; else out[n++] = DLE;
        } else if (c === DLE) dle = true;
        else out[n++] = last = c;
      }
      return n ? out.subarray(0, n) : null;
    },
  };
}

/**
 * Squeezed data (ARC type 4 before the RLE stage): node count (int16), the decoding tree as pairs of int16 children
 * (>= 0: node index, < 0: -(value + 1), value 256 = end of data), node 0 is the root; bits are taken LSB first.
 */
export function unsqueezeStream(r) {
  const out = new Uint8Array(OUT);
  let kids = null, cur = 0, left = 0, done = false;
  const init = () => {
    const lo = r.byte();
    if (lo < 0) { done = true; return; }
    const hi = r.byte();
    if (hi < 0) fail('truncated', 'unexpected end of squeezed data');
    // `<< 16 >> 16` sign-extends a 16-bit value (the format stores C `int`s of a 16-bit compiler).
    const nodes = ((lo | (hi << 8)) << 16) >> 16;
    if (nodes < 0 || nodes > 256) corrupt('squeeze tree size');
    // No nodes: the tree of an empty file (both children of the root are the end code).
    kids = new Int16Array(2 * Math.max(nodes, 1)).fill(-257);
    for (let i = 0; i < 2 * nodes; i++) {
      const v = (r.u16('squeeze tree') << 16) >> 16;
      if (v >= nodes || v < -257) corrupt('squeeze tree');
      kids[i] = v;
    }
  };
  return {
    read(max) {
      if (!kids && !done) init();
      max = clampMax(max);
      let n = 0;
      while (n < max && !done) {
        let i = 0, steps = 0;
        do {
          if (!left) {
            cur = r.byte();
            if (cur < 0) { done = true; break; } // ARC stops at the end of the data even without the end code
            left = 8;
          }
          i = kids[2 * i + (cur & 1)];
          cur >>= 1;
          left--;
          // A tree of <= 256 internal nodes has depth <= 256: more steps means a cycle in corrupt child links, which
          // would otherwise loop forever (child indices are only range-checked, not checked for acyclicity).
          if (++steps > 257) corrupt('squeeze tree loop');
        } while (i >= 0);
        if (done) break;
        if (i === -257) { done = true; break; }
        out[n++] = -1 - i;
      }
      return n ? out.subarray(0, n) : null;
    },
  };
}

/**
 * Crunched data of ARC types 5-7 (ARC 4): 12-bit codes, two per three bytes, high nibble first. A code is the slot
 * of its string in a 4096-entry table placed by hashing (predecessor code + following byte) with ARC's old
 * mid-square hash (types 5, 6) or the newer multiplicative one (type 7, `newHash`); collisions append to a chain,
 * probing linearly from 101 slots past its end. The 256 single bytes are hashed in first; the table never resets.
 */
export function uncrunchStream(r, newHash = false) {
  const used = new Uint8Array(4096), foll = new Uint8Array(4096), next = new Uint16Array(4096), pred = new Uint16Array(4096);
  // Old hash (ARC "h()"): middle 12 bits of the square of (pred + c) | 0x800; new hash (type 7): (pred + c) * 15073
  // mod 4096. Both reproduce 16-bit C arithmetic of the original, hence the & 0xFFFF before squaring / multiplying.
  // The table layout depends on the exact hash, so a single wrong bit here yields garbage output, not an error.
  const hash = newHash
    ? (p, c) => (((p + c) & 0xffff) * 15073) & 0xfff
    : (p, c) => { const k = ((p + c) | 0x800) & 0xffff; return (Math.imul(k, k) >>> 6) & 0xfff; };
  const add = (p, c) => {
    let i = hash(p, c);
    if (used[i]) {
      while (next[i]) i = next[i]; // end of the chain (0 ends it: slot 0 can never be linked, as in ARC)
      let j = (i + 101) & 0xfff;
      while (used[j]) j = (j + 1) & 0xfff;
      next[i] = j;
      i = j;
    }
    used[i] = 1;
    next[i] = 0;
    pred[i] = p;
    foll[i] = c;
  };
  for (let c = 0; c < 256; c++) add(NO_PRED, c);
  // `nib` holds the low nibble of the second byte between the two codes of a 3-byte group (-1 = no pending nibble).
  let free = 4096 - 256, old = -1, fin = 0, nib = -1;
  const code = () => {
    if (nib < 0) {
      const a = r.byte(), b = r.byte();
      if (b < 0) return -1;
      nib = b & 15;
      return (a << 4) | (b >> 4);
    }
    const a = r.byte();
    if (a < 0) return -1;
    const v = (nib << 8) | a;
    nib = -1;
    return v;
  };
  const stack = new Uint8Array(4100);
  return stringStream(stack, () => {
    const k = code();
    if (k < 0) return -1;
    let p = stack.length;
    if (old < 0) {
      if (!used[k]) corrupt('first crunched code');
      old = k;
      stack[--p] = fin = foll[k];
      return p;
    }
    let c = k;
    if (!used[c]) { stack[--p] = fin; c = old; } // the string being defined: previous string + its first byte
    while (pred[c] !== NO_PRED) {
      if (p < 2) corrupt('crunched string');
      stack[--p] = foll[c];
      c = pred[c];
    }
    stack[--p] = fin = foll[c];
    if (free) { add(old, fin); free--; }
    old = k;
    return p;
  });
}

/**
 * LZW with 9..maxBits-bit codes, LSB first, packed like Unix compress: the width grows when the next free code
 * exceeds it, and every width change (or clear) skips to the next group of `width` bytes (8 codes). Code 256 clears
 * the table. ARC type 8: maxBits 0 = read from the first data byte (12); type 9 (PKARC squashed): 13.
 */
export function arcLzwStream(r, maxBits = 0) {
  const stack = new Uint8Array((1 << 16) + 2), buf = new Uint8Array(19);
  let prefix = null, suffix = null, maxmax = 0;
  let nbits = 9, maxcode = 511, free = 257, clear = false, offset = 0, end = 0, old = -1, fin = 0;
  const init = () => {
    if (!maxBits) {
      maxBits = r.byte();
      if (maxBits < 0) return false;
    }
    if (maxBits < 9 || maxBits > 16) corrupt('LZW code size ' + maxBits);
    maxmax = 1 << maxBits;
    prefix = new Uint16Array(maxmax);
    suffix = new Uint8Array(maxmax);
    for (let i = 0; i < 256; i++) suffix[i] = i;
    return true;
  };
  // Port of compress's getcode(): codes are read from a buffer of exactly `nbits` bytes (8 codes). When the width
  // changes or a clear arrives, the rest of the buffer is discarded and a fresh group is read: this padding quirk is
  // part of the format (the encoder flushes the same way), so a "plain" LSB-first bit reader would desynchronise.
  const getcode = () => {
    if (clear || offset >= end || free > maxcode) {
      if (free > maxcode) {
        nbits++;
        maxcode = nbits === maxBits ? maxmax : (1 << nbits) - 1;
      }
      if (clear) { nbits = 9; maxcode = 511; clear = false; }
      let k = 0;
      while (k < nbits) {
        const c = r.byte();
        if (c < 0) break;
        buf[k++] = c;
      }
      if (k * 8 < nbits) return -1;
      buf.fill(0, k);
      offset = 0;
      end = k * 8 - (nbits - 1); // bit positions where a whole code still starts
    }
    const p = offset >> 3;
    const v = ((buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16)) >>> (offset & 7)) & ((1 << nbits) - 1);
    offset += nbits;
    return v;
  };
  return stringStream(stack, () => {
    if (!prefix && !init()) return -1;
    let k = getcode();
    if (k < 0) return -1;
    let p = stack.length;
    if (old < 0) {
      if (k > 255) corrupt('first LZW code');
      old = fin = k;
      stack[--p] = k;
      return p;
    }
    if (k === 256) {
      // Clear: the code after it is decoded against the emptied table (entry 256, made from it, is never used).
      clear = true;
      free = 256;
      k = getcode();
      if (k < 0) return -1;
    }
    let c = k;
    if (c >= free) {
      if (c > free) corrupt('LZW code');
      stack[--p] = fin;
      c = old;
    }
    while (c >= 256) {
      if (p < 2) corrupt('LZW string');
      stack[--p] = suffix[c];
      c = prefix[c];
    }
    stack[--p] = fin = c;
    if (free < maxmax) {
      prefix[free] = old;
      suffix[free] = fin;
      free++;
    }
    old = k;
    return p;
  });
}

// Header type -> decoding pipeline. 1 / 2 stored (1 = old short header), 3 RLE only, 4 Huffman + RLE, 5 LZW without
// RLE (rare), 6 / 7 RLE + LZW (old / new hash), 8 RLE + compress-style LZW (ARC 5 "crunched"), 9 PKARC squashed
// (13-bit LZW, no RLE). The RLE stage sits outside: it was applied first when packing, so it is undone last.
function decoder(type, raw) {
  const rd = () => new Reader(raw);
  const rle = (s) => arcRleStream(new Reader(s, OUT));
  switch (type) {
    case 1: case 2: return raw;
    case 3: return arcRleStream(rd());
    case 4: return rle(unsqueezeStream(rd()));
    case 5: return uncrunchStream(rd(), false);
    case 6: return rle(uncrunchStream(rd(), false));
    case 7: return rle(uncrunchStream(rd(), true));
    case 8: return rle(arcLzwStream(rd(), 0));
    case 9: return arcLzwStream(rd(), 13);
  }
  return unsupported('ARC method ' + type);
}

// --- archive structure -----------------------------------------------------------------------------------------

const knownType = (t) => (t >= 1 && t <= 11) || (t >= 20 && t <= 30);

/**
 * The header at `pos` (null when there is none before `limit`). `strict` (searches, unknown types): a printable
 * NUL-terminated name and data that ends at the limit or (strict > 1) at another 0x1A.
 */
// Strictness levels: 0 = trust the structure (sequential walk inside a known-good archive); 1 = also require a
// sane name and data inside the limit (first header at offset 0); 2 = additionally require the next header (or the
// limit) exactly where the data ends: two consistent headers in a row are strong evidence, needed when searching
// arbitrary bytes (SFX stubs, damaged stretches) for a format whose only "magic" is a single 0x1A byte.
function readHeader(src, pos, limit, strict = 0) {
  const b = src.read(pos, Math.min(29, limit - pos));
  if (b.length < 2 || b[0] !== MARK) return null;
  const type = b[1];
  if (type === 0) return strict ? null : { type, end: pos + 2 };
  const hlen = type === 1 ? 25 : 29;
  if (b.length < hlen) return null;
  let len = 0;
  while (len < 13 && b[2 + len]) len++;
  const packed = le32(b, 15), off = pos + hlen, end = off + packed;
  if (strict) {
    if (!len || len === 13) return null;
    for (let i = 0; i < len; i++) if (b[2 + i] < 0x20 || b[2 + i] === 0x7f) return null;
    if (end > limit || (strict > 1 && end < limit && src.read(end, 1)[0] !== MARK)) return null;
  }
  return {
    type, name: b.slice(2, 2 + len), packed, date: le16(b, 19), time: le16(b, 21), crc: le16(b, 23),
    size: type === 1 ? packed : le32(b, 25), off, end,
  };
}

const plausible = (src, pos, limit, strict = 2) => { const h = readHeader(src, pos, limit, strict); return !!h && knownType(h.type); };

// First position in [from, from + max) holding a plausible header, or -1.
function scan(src, from, limit, max) {
  const stop = Math.min(limit, from + max);
  for (let pos = from; pos < stop;) {
    const b = src.read(pos, Math.min(65536, stop - pos));
    if (!b.length) break;
    for (let i = b.indexOf(MARK); i >= 0; i = b.indexOf(MARK, i + 1)) if (plausible(src, pos + i, limit)) return pos + i;
    pos += b.length;
  }
  return -1;
}

export function openArc(sources, opts = {}) {
  const src = concatSource(sources);
  const charset = opts.charset || 'auto';
  const entries = [], meta = [], warnings = [], methods = [];
  let start = 0;
  const first = src.read(0, 2);
  const empty = first.length === 2 && first[0] === MARK && first[1] === 0;
  // At offset 0 a well-formed header is enough; a search (SFX stub) also wants the next header where the data ends.
  if (!empty && !plausible(src, 0, src.size, 1)) {
    start = scan(src, 1, src.size, SFX_SCAN);
    if (start < 0) fail('format', 'not an ARC archive');
  }

  // Directories (type 30) hold a nested archive in their data; `frames` keeps the enclosing levels.
  // Walking nested levels iteratively (an explicit stack of { prefix, limit, pos }) instead of recursively: a crafted
  // archive with deep nesting cannot overflow the JS call stack. A directory's `limit` confines its children to its
  // data range, so a corrupt child size cannot escape into the parent's entries.
  const frames = [];
  let pos = start, limit = src.size, prefix = '', ended = false;
  for (;;) {
    if (pos >= limit) {
      if (!frames.length) { warnings.push('the end-of-archive marker is missing'); break; }
      ({ prefix, limit, pos } = frames.pop());
      continue;
    }
    const h = readHeader(src, pos, limit, false);
    if (!h) {
      const next = scan(src, pos + 1, limit, RESYNC_SCAN);
      if (next < 0) {
        warnings.push(`no entry header at offset ${pos}: the rest of the ${frames.length ? 'directory' : 'archive'} is ignored`);
        if (!frames.length) break;
        ({ prefix, limit, pos } = frames.pop());
        continue;
      }
      warnings.push(`${next - pos} damaged bytes skipped at offset ${pos}`);
      pos = next;
      continue;
    }
    if (h.type === 0) {
      if (!frames.length) { pos = h.end; ended = true; break; }
      ({ prefix, limit, pos } = frames.pop());
      continue;
    }
    if (h.type >= 20 && h.type <= 29) { pos = h.end; continue; } // ARC 6 information blocks: skipped
    const path = (prefix + decodeText(h.name, charset).replace(/\\/g, '/')).replace(/^\/+/, '');
    const mtime = dosDateTime(h.time, h.date);
    if (h.type === 30) {
      const e = { index: entries.length, path, dir: true, kind: 'dir' };
      if (mtime) e.mtime = mtime;
      entries.push(e);
      meta.push(null);
      frames.push({ prefix, limit, pos: Math.min(h.end, limit) });
      prefix = path + '/';
      limit = Math.min(h.end, limit);
      pos = h.off;
      continue;
    }
    if (!knownType(h.type) && !readHeader(src, pos, limit, 2)) {
      warnings.push(`unknown header type ${h.type} at offset ${pos}: the rest of the archive is ignored`);
      break;
    }
    const method = METHODS[h.type] || 'type ' + h.type;
    const e = { index: entries.length, path, dir: false, kind: 'file', size: h.size, packed: h.packed, method, crc: h.crc };
    if (mtime) e.mtime = mtime;
    if (h.type > 9) e.unsupported = METHODS[h.type] ? `${method} (PAK method ${h.type})` : `ARC header type ${h.type}`;
    entries.push(e);
    meta.push({ type: h.type, off: h.off });
    if (!methods.includes(method)) methods.push(method);
    if (h.end > limit) { warnings.push(`the archive is truncated (in ${path})`); break; }
    pos = h.end;
  }
  if (ended && pos < src.size) {
    // Padding (zeros, Ctrl-Z, XMODEM blocks) is common after the end marker; anything else is worth a note.
    const tail = src.read(pos, Math.min(65536, src.size - pos));
    if (tail.some((c) => c !== 0 && c !== MARK)) warnings.push(`${src.size - pos} bytes after the end of the archive ignored`);
  }

  const info = { methods };
  if (start) info.sfx = start;
  if (warnings.length) info.warnings = warnings;
  return {
    format: 'arc',
    label: 'ARC',
    entries,
    info,
    password: null,
    open(entry) {
      const m = meta[entry.index];
      if (!m) return bytesStream(EMPTY);
      if (entry.unsupported) unsupported(`${entry.unsupported}: ${entry.path}`);
      const name = entry.path, size = entry.size;
      let n = 0, crc = 0;
      // The size check runs per chunk (fail as soon as the output overshoots, instead of decoding a runaway LZW
      // stream to the end); hashStream checks the exact size and the CRC-16 at the end.
      return hashStream(decoder(m.type, sourceStream(src, m.off, entry.packed)), (b) => {
        n += b.length;
        if (n > size) fail('corrupt', `size mismatch: ${name} (more than ${size} bytes)`);
        crc = arcCrc16(b, crc);
      }, () => crc === entry.crc, { name, size });
    },
  };
}
