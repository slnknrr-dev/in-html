// pack/zstd.js - Zstandard encoder (RFC 8878): one single-segment frame with the content size and the XXH64 content
// checksum; blocks of up to 128 KiB as raw, RLE or compressed blocks. Compressed blocks hold Huffman-coded literals
// (four streams, weights stored directly, for literals up to 0x80; raw literals otherwise) and sequences coded with
// the predefined FSE distributions, from a hash-chain LZ77 parse with lazy evaluation. zstd(1) and
// ../archive/zstd.js decode the output.
//
//   zstd(data, { level = 3, checksum = true }) -> Uint8Array

import { XXH64 } from '../archive/zstd.js';
import { Matcher } from './lz.js';

// DESIGN. Deliberately the simplest valid subset: predefined FSE tables only (no table description to build or
// price) and direct Huffman weights (no FSE-compressed weights, hence the 0x80 alphabet cap). Repeat offsets are
// never used: every sequence carries offset_value = distance + 3. These choices cost ratio (roughly gzip-level
// output) but keep the encoder small and make each section independently checkable against RFC 8878.
// BLOCK = 128 KiB is the format's maximum block size.
const BLOCK = 1 << 17;

// --- bit writer (forward; the decoder reads it backwards from the final 1 bit) ---------------------------------

// Accumulator as a JS number (not int32) so up to 24 + 7 bits fit without sign problems. FSE and Huffman streams
// are written forward and read backwards by the decoder, so encoders feed symbols in reverse order.
class Bits {
  constructor(cap = 1024) { this.buf = new Uint8Array(cap); this.pos = 0; this.acc = 0; this.n = 0; }
  add(v, n) {
    // n <= 24
    if (!n) return;
    this.acc += (v & ((1 << n) - 1)) * 2 ** this.n;
    this.n += n;
    while (this.n >= 8) {
      if (this.pos >= this.buf.length) { const b = new Uint8Array(this.buf.length * 2); b.set(this.buf); this.buf = b; }
      this.buf[this.pos++] = this.acc & 255;
      this.acc = Math.floor(this.acc / 256);
      this.n -= 8;
    }
  }
  // The final 1 bit marks where the backward reader starts; a stream without it is corrupt.
  close() { this.add(1, 1); if (this.n) this.add(0, 8 - this.n); return this.buf.slice(0, this.pos); }
}

// --- FSE encoding tables (same spread as the decoder) --------------------------------------------------------

// FSE (tANS) encoding table from normalised counts (-1 = "less than one", a probability of 1/size placed at the
// end of the table). The symbol spread must equal the decoder's (same step, same skipping of the high slots), or
// the states do not correspond. dnb/dfs are zstd's deltaNbBits / deltaFindState: per symbol, the number of bits to
// flush is (state + dnb) >> 16, i.e. either maxOut or maxOut - 1 depending on the state, without a branch.
function fseEncoder(counts, log) {
  const size = 1 << log, mask = size - 1;
  const sym = new Uint8Array(size);
  let high = size - 1;
  for (let s = 0; s < counts.length; s++) if (counts[s] === -1) sym[high--] = s;
  const step = (size >> 1) + (size >> 3) + 3;
  let pos = 0;
  for (let s = 0; s < counts.length; s++) {
    for (let i = 0; i < (counts[s] > 0 ? counts[s] : 0); i++) { sym[pos] = s; do pos = (pos + step) & mask; while (pos > high); }
  }
  const cumul = new Int32Array(counts.length + 1);
  for (let s = 0; s < counts.length; s++) cumul[s + 1] = cumul[s] + (counts[s] === -1 ? 1 : Math.max(0, counts[s]));
  const state = new Int32Array(size);
  const c2 = cumul.slice();
  for (let u = 0; u < size; u++) state[c2[sym[u]]++] = size + u;
  const dnb = new Int32Array(counts.length), dfs = new Int32Array(counts.length);
  for (let s = 0; s < counts.length; s++) {
    const c = counts[s];
    if (c === 0) { dnb[s] = ((log + 1) << 16) - size; continue; }
    if (c === -1 || c === 1) { dnb[s] = (log << 16) - size; dfs[s] = cumul[s] - 1; continue; }
    const maxOut = log - (31 - Math.clz32(c - 1));
    dnb[s] = (maxOut << 16) - (c << maxOut);
    dfs[s] = cumul[s] - c;
  }
  return { state, dnb, dfs, log };
}
// Initial state for the first (i.e. last decoded) symbol, as FSE_initCState2; fseEncode flushes the low nb bits of
// the state and moves to the next one.
const fseInit = (t, s) => { const nb = (t.dnb[s] + (1 << 15)) >> 16; const v = (nb << 16) - t.dnb[s]; return t.state[(v >> nb) + t.dfs[s]]; };
const fseEncode = (bits, t, st, s) => { const nb = (st + t.dnb[s]) >> 16; bits.add(st, nb); return t.state[(st >> nb) + t.dfs[s]]; };

// Predefined distributions (RFC 8878 section 3.1.1.3.2.2): literal lengths log 6, match lengths log 6, offsets log 5.
const LL_DEF = [4, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 2, 1, 1, 1, 1, 1, -1, -1, -1, -1];
const ML_DEF = [1, 4, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1, -1, -1];
const OF_DEF = [1, 1, 1, 1, 1, 1, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1];
let DEF = null;
const defaults = () => DEF || (DEF = { ll: fseEncoder(LL_DEF, 6), ml: fseEncoder(ML_DEF, 6), of: fseEncoder(OF_DEF, 5) });

// Code -> base value and extra bits for literal lengths and match lengths (RFC 8878 tables).
const LL_BASE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 40, 48, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536];
const LL_BITS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const ML_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34,
  35, 37, 39, 41, 43, 47, 51, 59, 67, 83, 99, 131, 259, 515, 1027, 2051, 4099, 8195, 16387, 32771, 65539];
const ML_BITS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  1, 1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
// Largest code whose base <= v (linear from the top; tables have <= 53 entries).
function codeOf(v, base) { let c = base.length - 1; while (base[c] > v) c--; return c; }

// --- Huffman literals ----------------------------------------------------------------------------------------

// Same flattening-based length limit as bzip2.js, max 11 bits (zstd's Huffman limit). Returns null with fewer than
// two symbols: a one-symbol Huffman table is not representable (RLE covers that case).
function huffLengths(freq, maxBits) {
  const syms = [];
  for (let s = 0; s < freq.length; s++) if (freq[s]) syms.push(s);
  const lens = new Uint8Array(freq.length);
  if (syms.length < 2) return null;
  let f = syms.map((s) => freq[s]);
  for (;;) {
    const leaves = syms.map((s, i) => ({ w: f[i], s })).sort((a, b) => a.w - b.w);
    const q = [];
    let i1 = 0, i2 = 0;
    const take = () => (i2 >= q.length || (i1 < leaves.length && leaves[i1].w <= q[i2].w) ? leaves[i1++] : q[i2++]);
    for (let k = 0; k < leaves.length - 1; k++) { const a = take(), b = take(); q.push({ w: a.w + b.w, l: a, r: b }); }
    let over = false;
    const walk = (x, d) => { if (x.l) { walk(x.l, d + 1); walk(x.r, d + 1); } else { lens[x.s] = d; if (d > maxBits) over = true; } };
    walk(q[q.length - 1], 0);
    if (!over) return lens;
    f = f.map((x) => 1 + (x >> 1));
  }
}

/** Literals section: Huffman (4 streams) when it pays, RLE for one repeated byte, raw otherwise. */
// Size-format choice in the headers: 1, 2 or 3 bytes depending on n (5, 12 or 20 size bits).
function literalsSection(lit) {
  const n = lit.length;
  const rawHead = n < 32 ? [n << 3] : n < 4096 ? [(n << 4) | 4, n >> 4] : [((n << 4) | 12) & 255, (n >> 4) & 255, n >> 12];
  const raw = () => { const o = new Uint8Array(rawHead.length + n); o.set(rawHead); o.set(lit, rawHead.length); return o; };
  if (n === 0) return Uint8Array.of(0);
  let same = true;
  for (let i = 1; i < n && same; i++) same = lit[i] === lit[0];
  if (same && n > 1) {
    const h = n < 32 ? [(n << 3) | 1] : n < 4096 ? [(n << 4) | 5, n >> 4] : [((n << 4) | 13) & 255, (n >> 4) & 255, n >> 12];
    return Uint8Array.from([...h, lit[0]]);
  }
  // Tiny literal runs: the tree description alone would cost more than it saves.
  if (n < 64) return raw();
  const freq = new Int32Array(256);
  let maxSym = 0;
  for (let i = 0; i < n; i++) { freq[lit[i]]++; if (lit[i] > maxSym) maxSym = lit[i]; }
  // Direct weights: header byte 127 + count stores up to 128 explicit 4-bit weights, so symbols 0..128 (the last
  // implied) are representable; larger bytes would need FSE-compressed weights, which this encoder omits.
  if (maxSym > 128) return raw();
  const lens = huffLengths(freq.subarray(0, maxSym + 1), 11);
  if (!lens) return raw();
  let maxBits = 0;
  for (const l of lens) if (l > maxBits) maxBits = l;
  // Weights (0 = unused); the last symbol's weight is implied, so the highest used symbol is maxSym itself.
  const w = new Uint8Array(maxSym + 1);
  for (let s = 0; s <= maxSym; s++) if (lens[s]) w[s] = maxBits + 1 - lens[s];
  // Codes as the decoder assigns them: by weight, then symbol; longer codes take the low values.
  const count = new Int32Array(maxBits + 2);
  for (let s = 0; s <= maxSym; s++) count[w[s]]++;
  const rank = new Int32Array(maxBits + 2);
  for (let k = 1, u = 0; k <= maxBits; k++) { rank[k] = u; u += count[k] << (k - 1); }
  const code = new Int32Array(maxSym + 1), nb = new Uint8Array(maxSym + 1);
  for (let s = 0; s <= maxSym; s++) {
    if (!w[s]) continue;
    code[s] = rank[w[s]] >> (w[s] - 1);
    nb[s] = maxBits + 1 - w[s];
    rank[w[s]] += 1 << (w[s] - 1);
  }
  const tree = [127 + maxSym];
  for (let s = 0; s < maxSym; s += 2) tree.push((w[s] << 4) | (s + 1 < maxSym ? w[s + 1] : 0));
  // Four streams of ceil(n / 4) literals (the last takes the rest), as the decoder splits them; the jump table
  // holds the first three compressed sizes (16 bits each, hence the 65535 check).
  const seg = Math.ceil(n / 4);
  const streams = [];
  for (let k = 0; k < 4; k++) {
    const a = Math.min(n, k * seg), b = Math.min(n, a + seg);
    const bits = new Bits(seg + 16);
    for (let i = b - 1; i >= a; i--) bits.add(code[lit[i]], nb[lit[i]]);
    streams.push(bits.close());
  }
  if (streams.slice(0, 3).some((s) => s.length > 65535)) return raw();
  const comp = tree.length + 6 + streams.reduce((x, s) => x + s.length, 0);
  // Must save more than the larger header: otherwise raw is both smaller and cheaper to decode.
  if (comp >= n - 8) return raw();
  // Header: type 2 (compressed), size format by the larger size (4 streams in every format here).
  let head;
  if (n < 1024 && comp < 1024) head = [2 | (1 << 2) | ((n & 15) << 4), ((n >> 4) & 63) | ((comp & 3) << 6), comp >> 2];
  else if (n < 16384 && comp < 16384) head = [2 | (2 << 2) | ((n & 15) << 4), (n >> 4) & 255, ((n >> 12) & 3) | ((comp & 63) << 2), comp >> 6];
  else head = [2 | (3 << 2) | ((n & 15) << 4), (n >> 4) & 255, ((n >> 12) & 63) | ((comp & 3) << 6), (comp >> 2) & 255, comp >> 10];
  const out = new Uint8Array(head.length + comp);
  out.set(head);
  let o = head.length;
  out.set(tree, o); o += tree.length;
  for (let k = 0; k < 3; k++) { out[o++] = streams[k].length & 255; out[o++] = streams[k].length >> 8; }
  for (const s of streams) { out.set(s, o); o += s.length; }
  return out;
}

// --- sequences -----------------------------------------------------------------------------------------------

// Sequences: count (1-3 bytes), mode byte, then one backward bit stream interleaving three FSE states and the extra
// bits. Decoder order per sequence: read OF, ML, LL extras, then update LL, ML, OF states. The writer emits the
// mirror image, last sequence first, and finally the initial states (ML, OF, LL) so LL is read first.
function sequencesSection(seqs) {
  const n = seqs.length;
  if (!n) return Uint8Array.of(0);
  const head = n < 128 ? [n] : n < 0x7f00 ? [(n >> 8) + 128, n & 255] : [255, (n - 0x7f00) & 255, (n - 0x7f00) >> 8];
  head.push(0); // predefined modes for literal lengths, offsets and match lengths
  const { ll, ml, of } = defaults();
  const codes = seqs.map(([lit, off, len]) => {
    const lc = codeOf(lit, LL_BASE), mc = codeOf(len - 3, ML_BASE.map((x) => x - 3));
    // Offset code = floor(log2(offset_value)) with oc extra bits; no table needed.
    const ov = off + 3, oc = 31 - Math.clz32(ov);
    return [lc, mc, oc, lit - LL_BASE[lc], len - ML_BASE[mc], ov - 2 ** oc];
  });
  const bits = new Bits(n * 8 + 16);
  const extra = (c) => { bits.add(c[3], LL_BITS[c[0]]); bits.add(c[4], ML_BITS[c[1]]); addBig(bits, c[5], c[2]); };
  let last = codes[n - 1];
  let sLL = fseInit(ll, last[0]), sML = fseInit(ml, last[1]), sOF = fseInit(of, last[2]);
  extra(last);
  for (let i = n - 2; i >= 0; i--) {
    const c = codes[i];
    sOF = fseEncode(bits, of, sOF, c[2]);
    sML = fseEncode(bits, ml, sML, c[1]);
    sLL = fseEncode(bits, ll, sLL, c[0]);
    extra(c);
  }
  bits.add(sML, ml.log); bits.add(sOF, of.log); bits.add(sLL, ll.log);
  const body = bits.close();
  const out = new Uint8Array(head.length + body.length);
  out.set(head); out.set(body, head.length);
  return out;
}
// Offsets may need more than 24 extra bits (windows above 16 MiB); split so Bits.add keeps n <= 24.
function addBig(bits, v, n) { if (n > 24) { bits.add(v % 65536, 16); bits.add(Math.floor(v / 65536), n - 16); } else bits.add(v, n); }

// [chain depth, nice length, lazy] per level 1..9.
const LEVELS = [null, [8, 32, false], [16, 48, true], [32, 64, true], [64, 96, true], [128, 128, true], [256, 192, true], [512, 256, true], [1024, 512, true], [2048, 1024, true]];

export function zstd(data, { level = 3, checksum = true } = {}) {
  const lv = LEVELS[Math.max(1, Math.min(9, Math.round(level)))];
  const n = data.length;
  const parts = [];
  // Frame header: magic, descriptor (single segment, content size field, checksum flag).
  // Single_Segment_flag: the window equals the content size, so no Window_Descriptor byte; with it the 1-byte FCS
  // field is allowed (fcs = 0) and the 2-byte form stores n - 256.
  const fcs = n < 256 ? 0 : n < 65536 + 256 ? 1 : n < 2 ** 32 ? 2 : 3;
  const fh = [0x28, 0xb5, 0x2f, 0xfd, (fcs << 6) | (1 << 5) | (checksum ? 4 : 0)];
  if (fcs === 0) fh.push(n);
  else if (fcs === 1) { const v = n - 256; fh.push(v & 255, v >> 8); }
  else if (fcs === 2) fh.push(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24);
  else { let v = n; for (let k = 0; k < 8; k++) { fh.push(v % 256); v = Math.floor(v / 256); } }
  parts.push(Uint8Array.from(fh));
  // One matcher for the whole frame: matches may reach into earlier blocks (allowed within a frame). The 8 MiB
  // window is the conventional decoder-memory bound; Single_Segment frames are decoded into one buffer anyway.
  const mf = new Matcher(data, { window: 1 << 23, depth: lv[0], nice: lv[1] });
  const blockHead = (last, type, size) => { const v = (size << 3) | (type << 1) | (last ? 1 : 0); return Uint8Array.of(v & 255, (v >> 8) & 255, (v >> 16) & 255); };
  if (!n) parts.push(blockHead(true, 0, 0));
  for (let start = 0; start < n; start += BLOCK) {
    const end = Math.min(n, start + BLOCK), last = end === n, len = end - start;
    let same = true;
    for (let i = start + 1; i < end && same; i++) same = data[i] === data[start];
    // RLE block: one byte plus the size; the matcher still has to see these positions for later blocks.
    if (same) { parts.push(blockHead(last, 1, len), Uint8Array.of(data[start])); mf.skipTo(end); continue; }
    // LZ77 parse of this block (matches may reach back into earlier blocks).
    const lits = new Uint8Array(len);
    let nl = 0, anchor = start;
    const seqs = [];
    for (let i = start; i < end;) {
      const room = end - i;
      // minLen 4: a 3-byte match costs about as much as three Huffman-coded literals with predefined tables.
      // 65536 + 3 keeps lengths inside the predefined ML table's largest code range.
      let l = room >= 4 ? mf.find(i, Math.min(room, 65536 + 3), 4) : 0;
      let d = mf.dist;
      if (l && lv[2] && i + 1 < end) {
        const l2 = mf.find(i + 1, Math.min(end - i - 1, 65536 + 3), 4);
        if (l2 > l + 1) { i++; l = l2; d = mf.dist; }
      }
      if (!l) { i++; continue; }
      lits.set(data.subarray(anchor, i), nl);
      seqs.push([i - anchor, d, l]);
      nl += i - anchor;
      i += l;
      anchor = i;
      mf.skipTo(i);
    }
    lits.set(data.subarray(anchor, end), nl);
    nl += end - anchor;
    const lsec = literalsSection(lits.subarray(0, nl));
    const ssec = sequencesSection(seqs);
    const size = lsec.length + ssec.length;
    // Fallback to a raw block when compression does not pay; compressed blocks must also stay below 128 KiB.
    if (size >= len || size >= BLOCK) parts.push(blockHead(last, 0, len), data.subarray(start, end));
    else parts.push(blockHead(last, 2, size), lsec, ssec);
  }
  if (checksum) {
    const h = new XXH64(0).update(data).digest();
    parts.push(checksumBytes(h));
  }
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// Accepts the several digest shapes an XXH64 implementation might return; ../archive/zstd.js returns [lo, hi].
// The low 32 bits of the XXH64 digest, little-endian.
function checksumBytes(h) {
  if (h instanceof Uint8Array) return h.length === 8 ? Uint8Array.of(h[7], h[6], h[5], h[4]) : h.subarray(0, 4);
  const lo = typeof h === 'bigint' ? Number(h & 0xffffffffn) : Array.isArray(h) ? h[0] : Number(h) >>> 0;
  return Uint8Array.of(lo & 255, (lo >>> 8) & 255, (lo >>> 16) & 255, lo >>> 24);
}
