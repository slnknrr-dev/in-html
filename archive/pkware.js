// archive/pkware.js - the legacy PKZIP 0.9x-1.x compression methods for the ZIP reader: unshrink (method 1),
// unreduce (2-5) and explode (6), as pull streams over an io.js Reader (PKWARE APPNOTE 5.2-5.4; bits are taken LSB
// first, as Info-ZIP's unshrink.c / unreduce.c / explode.c and 7-Zip read them).
//
//   unshrinkStream(reader, { size }) -> Stream          LZW with 9-13 bit codes; code 256 is followed by 1 (codes get
//                                                      one bit wider) or 2 (partial clear: every leaf of the string
//                                                      tree is freed; freed codes are reused lowest first)
//   unreduceStream(reader, factor, { size }) -> Stream  factor 1-4 (= method - 1): 256 follower sets, then the DLE
//                                                      (0x90) length / distance expansion (window 512 B .. 4 KiB)
//   explodeStream(reader, { bigDictionary, literalTree, size }) -> Stream
//                                                      bigDictionary = general purpose flag bit 1 (8 KiB window,
//                                                      else 4 KiB), literalTree = bit 2 (3 Shannon-Fano trees, the
//                                                      first codes the literals; minimum match 3, else 2)
// `size` is the uncompressed size from the ZIP headers. Reduced and imploded data have no end code, so it ends them
// (without it they run to the end of the input and may turn the final padding bits into a byte or two); output never
// exceeds it. Matches reaching before the start of the data read zeros (APPNOTE). Damaged input throws ArchiveError
// 'corrupt' or 'truncated'.

// Why support methods last written in 1993: old archives still circulate (BBS dumps, retro software), and a reader
// that lists an entry but cannot extract it is worse than one that refuses the file. The decoders are small and
// isolated here so the modern paths in zip.js stay readable.

import { corrupt, fail, unsupported } from './io.js';

// OUT: output chunk (64 KiB, plenty for methods whose windows are <= 8 KiB). clampMax keeps a caller's huge or
// missing `max` from reallocating the output buffer: these decoders write into one fixed array.
const OUT = 1 << 16, DLE = 0x90;
const clampMax = (max) => (max > 0 && max < OUT ? max : OUT);

// LSB-first bit input. Bits past the end of the input read as zeros; `over` tells that some of them were consumed.
class Bits {
  constructor(r) { this.r = r; this.bb = 0; this.bc = 0; this.pad = 0; }
  need(n) {
    while (this.bc < n) {
      let c = this.r.byte();
      if (c < 0) { c = 0; this.pad += 8; }
      this.bb |= c << this.bc;
      this.bc += 8;
    }
  }
  get(n) {
    this.need(n);
    const v = this.bb & ((1 << n) - 1);
    this.bb >>>= n;
    this.bc -= n;
    return v;
  }
  peek(n) { this.need(n); return this.bb & ((1 << n) - 1); }
  drop(n) { this.bb >>>= n; this.bc -= n; }
  // pad counts zero bits injected past the end; while bc >= pad the injected bits are still unconsumed in the
  // buffer, so the decoded values are real. Checking after the fact keeps get() branch-free.
  get over() { return this.pad > this.bc; }
}

// Ends `s` after `size` bytes (no limit when size is null).
function limited(s, size) {
  if (size == null) return s;
  let left = size;
  return {
    size,
    read(max) {
      if (left <= 0) return null;
      const b = s.read(Math.min(clampMax(max), left));
      if (!b) { left = 0; return null; }
      left -= b.length;
      return b;
    },
  };
}

// --- shrink (method 1) ---------------------------------------------------------------------------------------------

const N_SHRINK = 8192, FREE = 0xffff;

/** Unshrink: dynamic LZW whose code width and partial clears are signalled by the compressor (APPNOTE 5.2). */
export function unshrinkStream(r, { size } = {}) {
  const parent = new Uint16Array(N_SHRINK).fill(FREE), suffix = new Uint8Array(N_SHRINK);
  const stack = new Uint8Array(N_SHRINK + 1), isParent = new Uint8Array(N_SHRINK);
  for (let i = 0; i < 256; i++) { parent[i] = 0; suffix[i] = i; } // single bytes: roots, never freed
  const bits = new Bits(r);
  let width = 9, head = 257, prev = -1, prevFirst = 0;
  // Partial clear (APPNOTE 5.2): free every non-root node that is not the parent of another node, i.e. the leaves of
  // the string tree. Two passes (mark parents, then free) because a node's parent status depends on all others.
  // Interior nodes survive, so strings shared by many codes stay available after the clear.
  const partialClear = () => {
    isParent.fill(0);
    for (let i = 257; i < N_SHRINK; i++) if (parent[i] !== FREE && parent[i] > 256) isParent[parent[i]] = 1;
    for (let i = 257; i < N_SHRINK; i++) if (!isParent[i]) parent[i] = FREE;
    head = 257;
  };
  const top = stack.length, out = new Uint8Array(OUT);
  let sp = top, done = false;
  // Decodes the next string into stack[sp, top); false at the end of the input.
  const next = () => {
    for (;;) {
      const code = bits.get(width);
      if (bits.over) return false;
      if (code === 256) {
        const sub = bits.get(width);
        if (bits.over) return false;
        if (sub === 1) { if (width === 13) corrupt('shrink code width'); width++; } else if (sub === 2) partialClear();
        else corrupt('shrink control code ' + sub);
        continue;
      }
      // Every code after the first defines one entry (previous string + first byte of this one) in the lowest free
      // slot; a code that is still free can only be that slot (the string is then prev + its own first byte).
      // Linear search for the lowest free slot from `head` (the last assigned slot + 1): amortised O(1) between clears,
      // since slots are assigned in increasing order until the next partial clear resets head to 257.
      let f = -1;
      if (prev >= 0) {
        f = head;
        while (f < N_SHRINK && parent[f] !== FREE) f++;
      }
      let c = code, p = top;
      if (c > 256 && parent[c] === FREE) {
        if (c !== f) corrupt('shrink code ' + c);
        stack[--p] = prevFirst;
        c = prev;
      }
      while (c > 255) {
        if (p < 2 || parent[c] === FREE) corrupt('shrink string');
        stack[--p] = suffix[c];
        c = parent[c];
      }
      stack[--p] = c;
      if (f >= 0 && f < N_SHRINK) { parent[f] = prev; suffix[f] = c; head = f + 1; }
      prev = code;
      prevFirst = c;
      sp = p;
      return true;
    }
  };
  return limited({
    read(max) {
      if (done) return null;
      max = clampMax(max);
      let n = 0;
      while (n < max) {
        if (sp === top && !next()) { done = true; break; }
        const k = Math.min(top - sp, max - n);
        for (let i = 0; i < k; i++) out[n + i] = stack[sp + i];
        n += k;
        sp += k;
      }
      return n ? out.subarray(0, n) : null;
    },
  }, size);
}

// --- reduce (methods 2-5) ------------------------------------------------------------------------------------------

const L_MASK = [0, 0x7f, 0x3f, 0x1f, 0x0f];

/**
 * Unreduce. The follower sets come first (S(255) .. S(0): a 6-bit count, then 8-bit bytes); each byte of the middle
 * stream is then either an index into the set of the previous byte (bit 0 + B(n) bits, B = bits for n - 1, at
 * least 1, as Info-ZIP's B_table) or a plain byte (bit 1 + 8 bits; 8 bits when the set is empty). The middle stream
 * is the DLE expansion: DLE 0 = 0x90, DLE V [C] D = copy (V & mask) (+ C when all ones) + 3 bytes from distance
 * (V >> (8 - factor)) * 256 + D + 1.
 */
export function unreduceStream(r, factor, { size } = {}) {
  if (!(factor >= 1 && factor <= 4)) unsupported('reduce factor ' + factor);
  const bits = new Bits(r);
  const count = new Uint8Array(256), fol = new Uint8Array(256 * 32), width = new Uint8Array(256);
  const lmask = L_MASK[factor], dshift = 8 - factor;
  // Largest distance: factor 4 gives (15 << 8) + 255 + 1 = 4096, so an 8 KiB power-of-two ring (index & M) always holds
  // it, and the zero-initialised ring supplies the zeros the APPNOTE prescribes for distances before the start.
  // `state` is the DLE parser: 0 normal, 1 after DLE, 2 waiting for the extra length byte, 3 waiting for the distance.
  const W = 8192, M = W - 1, win = new Uint8Array(W), out = new Uint8Array(OUT);
  let loaded = false, pos = 0, last = 0, state = 0, V = 0, len = 0, copy = 0, dist = 0, done = false;
  const load = () => {
    for (let x = 255; x >= 0; x--) {
      const n = bits.get(6);
      if (n > 32) corrupt('reduce follower set');
      count[x] = n;
      // Bits to index a set of n followers: ceil(log2 n), but at least 1 (Info-ZIP B_table: 1 follower still costs 1).
      width[x] = n <= 2 ? 1 : 32 - Math.clz32(n - 1);
      for (let i = 0; i < n; i++) fol[x * 32 + i] = bits.get(8);
    }
    if (bits.over) fail('truncated', 'unexpected end of reduced data');
    loaded = true;
  };
  // Next byte of the middle stream (-1 at the end of the input when the size is unknown).
  const middle = () => {
    const n = count[last];
    let c;
    if (!n || bits.get(1)) c = bits.get(8);
    else {
      const i = bits.get(width[last]);
      if (i >= n && !bits.over) corrupt('reduce follower index');
      c = fol[last * 32 + i];
    }
    if (bits.over) {
      if (size != null) fail('truncated', 'unexpected end of reduced data');
      return -1;
    }
    return (last = c);
  };
  return {
    size,
    read(max) {
      if (done) return null;
      if (!loaded) {
        if (size === 0) { done = true; return null; }
        load();
      }
      max = clampMax(max);
      const lim = size != null ? Math.min(max, size - pos) : max;
      let n = 0;
      while (n < lim) {
        if (copy) {
          const k = Math.min(copy, lim - n);
          for (let i = 0; i < k; i++) {
            const b = win[(pos - dist) & M]; // before the start: still zero (the window is larger than any distance)
            win[pos & M] = b;
            out[n++] = b;
            pos++;
          }
          copy -= k;
          continue;
        }
        const c = middle();
        if (c < 0) { done = true; break; }
        if (state === 0) {
          if (c !== DLE) { win[pos & M] = c; out[n++] = c; pos++; } else state = 1;
        } else if (state === 1) {
          if (c) { V = c; len = V & lmask; state = len === lmask ? 2 : 3; } else { win[pos & M] = DLE; out[n++] = DLE; pos++; state = 0; }
        } else if (state === 2) {
          len += c;
          state = 3;
        } else {
          dist = ((V >> dshift) << 8) + c + 1;
          copy = len + 3;
          state = 0;
        }
      }
      if (size != null && pos >= size) done = true;
      return n ? out.subarray(0, n) : ((done = true), null);
    },
  };
}

// --- implode (method 6) --------------------------------------------------------------------------------------------

/**
 * One Shannon-Fano tree: a byte (pairs - 1), then pairs of 4-bit fields (codes with this length - 1, length - 1)
 * for the n symbols in order. Codes per APPNOTE 5.4: symbols sorted by length (stable), codes counted up from 0
 * starting at the longest, left-aligned in 16 bits; they are read MSB first. -> { table, bits }: table[next `bits`
 * input bits] = (symbol << 5) | length, 0 = no code.
 */
function sfTree(r, n) {
  const pairs = r.byte() + 1;
  if (!pairs) fail('truncated', 'unexpected end of imploded data');
  const lens = new Uint8Array(n);
  let k = 0;
  for (let i = 0; i < pairs; i++) {
    const b = r.byte();
    if (b < 0) fail('truncated', 'unexpected end of imploded data');
    const len = (b & 15) + 1, cnt = (b >> 4) + 1;
    if (k + cnt > n) corrupt('Shannon-Fano tree');
    lens.fill(len, k, k + cnt);
    k += cnt;
  }
  if (k !== n) corrupt('Shannon-Fano tree');
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => lens[a] - lens[b] || a - b);
  let code = 0, inc = 0, last = 0, maxLen = 0;
  const codes = new Uint32Array(n);
  for (let i = n - 1; i >= 0; i--) {
    const s = order[i];
    code += inc;
    if (lens[s] !== last) { last = lens[s]; inc = 1 << (16 - last); }
    if (code > 0xffff) corrupt('Shannon-Fano tree');
    codes[s] = code;
    if (last > maxLen) maxLen = last;
  }
  // Lookup table indexed by the next maxLen input bits. The codes are MSB-first but the bit reader is LSB-first, so
  // each code is bit-reversed and replicated at every index whose low `len` bits match (stride 1 << len). A collision
  // means the lengths do not form a prefix code. maxLen <= 16, so at most 64 Ki entries.
  const table = new Uint16Array(1 << maxLen);
  for (let s = 0; s < n; s++) {
    const len = lens[s];
    let v = codes[s] >>> (16 - len), rev = 0;
    for (let i = 0; i < len; i++) { rev = (rev << 1) | (v & 1); v >>>= 1; }
    for (let j = rev; j < table.length; j += 1 << len) {
      if (table[j]) corrupt('Shannon-Fano tree');
      table[j] = (s << 5) | len;
    }
  }
  return { table, bits: maxLen };
}

/**
 * Explode: the trees (literals when literalTree, lengths, distances), then per symbol a bit: 1 = literal (coded,
 * or 8 plain bits), 0 = match: 6 or 7 plain low distance bits, the coded high 6 bits, the coded length (+ minimum
 * match; code 63 adds a plain byte).
 */
export function explodeStream(r, { bigDictionary = false, literalTree = false, size } = {}) {
  // Largest distance with the 8 KiB dictionary: (63 << 7 | 127) + 1 = 8192 = W, which reads the ring slot about to be
  // overwritten, still holding the byte from exactly W back: correct without a larger ring.
  const minMatch = literalTree ? 3 : 2, lowBits = bigDictionary ? 7 : 6;
  const W = 8192, M = W - 1, win = new Uint8Array(W), out = new Uint8Array(OUT);
  let lit = null, lenT = null, distT = null, bits = null, pos = 0, copy = 0, dist = 0, done = false;
  const decode = (t) => {
    const e = t.table[bits.peek(t.bits)];
    if (!e) corrupt('Shannon-Fano code');
    bits.drop(e & 31);
    return e >> 5;
  };
  return {
    size,
    read(max) {
      if (done) return null;
      if (!bits) {
        if (size === 0) { done = true; return null; }
        if (literalTree) lit = sfTree(r, 256);
        lenT = sfTree(r, 64);
        distT = sfTree(r, 64);
        bits = new Bits(r);
      }
      max = clampMax(max);
      const lim = size != null ? Math.min(max, size - pos) : max;
      let n = 0;
      while (n < lim) {
        if (copy) {
          const k = Math.min(copy, lim - n);
          for (let i = 0; i < k; i++) {
            const b = win[(pos - dist) & M]; // before the start: still zero
            win[pos & M] = b;
            out[n++] = b;
            pos++;
          }
          copy -= k;
          continue;
        }
        if (bits.get(1)) {
          const c = lit ? decode(lit) : bits.get(8);
          if (bits.over) break;
          win[pos & M] = c;
          out[n++] = c;
          pos++;
        } else {
          const low = bits.get(lowBits);
          const d = ((decode(distT) << lowBits) | low) + 1;
          let l = decode(lenT);
          if (l === 63) l += bits.get(8);
          if (bits.over) break;
          dist = d;
          copy = l + minMatch;
        }
      }
      if (bits.over) {
        if (size != null) fail('truncated', 'unexpected end of imploded data');
        done = true;
      }
      if (size != null && pos >= size) done = true;
      return n ? out.subarray(0, n) : ((done = true), null);
    },
  };
}
