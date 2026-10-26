// codec/zlib.js - synchronous pure-JS deflate / inflate (RFC 1951) and the zlib wrapper (RFC 1950): levels 0-9
// (stored blocks; LZ77 over hash chains, greedy for 1-3 and lazy for 4-9; each block written stored, fixed or
// dynamic Huffman, whichever is smallest). No platform streams, so it runs the same in browsers, workers and Node.
//
//   deflateRawSync(bytes, { level = 6 }) -> Uint8Array         inflateRawSync(bytes, { size }) -> Uint8Array
//   zlibSync(bytes, { level = 6 }) -> Uint8Array               unzlibSync(bytes, { size }) -> Uint8Array
// `size` is an optional expected output length (preallocates; the output may still differ). Corrupt input throws.
//   new Inflater(input, { deflate64, size }) .read(max) -> Uint8Array | null   streaming inflate with bounded memory
//     (input: { byte(), chunk?(max) }); deflate64: PKWARE's Deflate64 (64 KiB window, ZIP method 9)
//
// Why a pure-JS codec next to codec/deflate.js (CompressionStream): that API is async-only and has no Deflate64, no
// level control and no access to the bytes that follow a deflate stream (needed for gzip members and ZIP entries
// without a known compressed size). This module is synchronous, deterministic across engines (same input + level ->
// same bytes, which the platform does not promise) and exposes a pull-based streaming inflater.
// Structure: shared RFC 1951 tables -> length-limited Huffman construction -> bit writer -> LZ77 matcher and block
// writer -> one-shot inflate -> streaming inflate. Bit order everywhere is LSB-first (RFC 1951 section 3.1.1), which
// is why Huffman codes are stored bit-reversed: they are defined MSB-first but must be emitted LSB-first.
// Error policy: every malformed condition throws 'invalid deflate data: <why>' (fail-fast); no partial output is
// returned from a corrupt stream.

import { adler32 } from './crc32.js';

// --- shared tables -----------------------------------------------------------------------------
// RFC 1951 section 3.2.5: length codes 257..285 and distance codes 0..29 as (base, extra bits). Typed arrays: compact
// and monomorphic in hot loops. Length 258 has its own code (28, 0 extra bits) instead of 227 + 31, which is why the
// LEN_CODE fill below treats code 28 specially. CL_ORDER is the order code-length code lengths are transmitted in -
// rarely used lengths last, so HCLEN can truncate them.

const LEN_BASE = new Uint16Array([3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]);
const LEN_EXTRA = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]);
const DIST_BASE = new Uint16Array([1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]);
const DIST_EXTRA = new Uint8Array([0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]);
const CL_ORDER = new Uint8Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);

// length (3..258) -> length code index (0..28); distance -> code via the two-level zlib trick.
// Two-level distance map (zlib's _dist_code): distances 1..256 index directly; above 256 every distance code spans a
// multiple of 128, so (d - 1) >> 7 indexes the upper half. 512 bytes instead of a 32 KiB direct table.
const LEN_CODE = new Uint8Array(259);
for (let c = 0; c < 29; c++) {
  const end = c === 28 ? 259 : LEN_BASE[c] + (1 << LEN_EXTRA[c]);
  for (let l = LEN_BASE[c]; l < end && l < 259; l++) LEN_CODE[l] = c;
}
LEN_CODE[258] = 28;
const DIST_CODE = new Uint8Array(512);
for (let c = 0; c < 30; c++) {
  for (let d = DIST_BASE[c]; d < DIST_BASE[c] + (1 << DIST_EXTRA[c]); d++) {
    if (d <= 256) DIST_CODE[d - 1] = c;
    else DIST_CODE[256 + ((d - 1) >> 7)] = c;
  }
}
const distCode = (d) => (d <= 256 ? DIST_CODE[d - 1] : DIST_CODE[256 + ((d - 1) >> 7)]);

// Fixed Huffman code (RFC 1951 section 3.2.6): 288 lit/len symbols (286, 287 exist only to complete the code) and 30
// distance codes of 5 bits, padded to 32 here so the table is a complete code.
const FIXED_LIT_LEN = new Uint8Array(288);
FIXED_LIT_LEN.fill(8, 0, 144); FIXED_LIT_LEN.fill(9, 144, 256); FIXED_LIT_LEN.fill(7, 256, 280); FIXED_LIT_LEN.fill(8, 280, 288);
const FIXED_DIST_LEN = new Uint8Array(32).fill(5);

const rev = (code, len) => { let r = 0; for (let i = 0; i < len; i++) { r = (r << 1) | (code & 1); code >>>= 1; } return r; };

// Canonical codes (RFC 1951 3.2.2), bit-reversed for LSB-first output.
// Canonical = codes fully determined by the lengths (shorter first, then by symbol), so only lengths are transmitted.
// count[0] = 0 because unused symbols (length 0) must not shift the numbering.
function canonCodes(lens) {
  const n = lens.length;
  const count = new Uint16Array(16);
  for (let i = 0; i < n; i++) count[lens[i]]++;
  count[0] = 0;
  const next = new Uint16Array(16);
  for (let b = 1, code = 0; b < 16; b++) { code = (code + count[b - 1]) << 1; next[b] = code; }
  const codes = new Uint16Array(n);
  for (let i = 0; i < n; i++) if (lens[i]) codes[i] = rev(next[lens[i]]++, lens[i]);
  return codes;
}
const FIXED_LIT_CODE = canonCodes(FIXED_LIT_LEN);
const FIXED_DIST_CODE = canonCodes(FIXED_DIST_LEN);

// --- Huffman code lengths with a length limit ----------------------------------------------------

// Moffat & Katajainen in-place minimum-redundancy lengths over frequencies sorted ascending (A is overwritten).
// Why this over a heap-based Huffman tree: O(n) after sorting, no node allocation, one Int32Array. Three phases in
// the same array: (1) build internal-node weights with parent pointers, (2) convert parent pointers to depths,
// (3) assign leaf depths from the count of available nodes per level. The result is optimal but UNLIMITED in length;
// buildLengths enforces deflate's 15 / 7-bit cap afterwards.
function minRedundancy(A, n) {
  if (n === 0) return;
  if (n === 1) { A[0] = 1; return; }
  A[0] += A[1];
  let root = 0, leaf = 2;
  for (let next = 1; next < n - 1; next++) {
    if (leaf >= n || A[root] < A[leaf]) { A[next] = A[root]; A[root++] = next; } else A[next] = A[leaf++];
    if (leaf >= n || (root < next && A[root] < A[leaf])) { A[next] += A[root]; A[root++] = next; } else A[next] += A[leaf++];
  }
  A[n - 2] = 0;
  for (let next = n - 3; next >= 0; next--) A[next] = A[A[next]] + 1;
  let avbl = 1, used = 0, dpth = 0, next = n - 1;
  root = n - 2;
  while (avbl > 0) {
    while (root >= 0 && A[root] === dpth) { used++; root--; }
    while (avbl > used) { A[next--] = dpth; avbl--; }
    avbl = 2 * used; dpth++; used = 0;
  }
}

// Code lengths (<= maxLen) for `freq`; at least two codes so every decoder accepts the table.
// A one-symbol code (length 1, one unused codeword) is legal per RFC but some decoders reject incomplete codes, so a
// dummy second symbol is added. Ties sort by symbol for deterministic output.
// Length limiting: clamp overlong codes to maxLen, which over-subscribes the Kraft sum (sum 2^-len > 1); then
// repeatedly move a leaf down from the deepest shorter level until sum 2^(maxLen - len) === 2^maxLen exactly. This
// is the heuristic of zlib/miniz - near-optimal and much simpler than package-merge, at a cost of a few bits.
function buildLengths(freq, maxLen) {
  const n = freq.length;
  const lens = new Uint8Array(n);
  const syms = [];
  for (let i = 0; i < n; i++) if (freq[i]) syms.push(i);
  if (syms.length < 2) {
    const a = syms.length ? syms[0] : 0, b = a === 0 ? 1 : 0;
    lens[a] = 1; lens[b] = 1;
    return lens;
  }
  syms.sort((a, b) => freq[a] - freq[b] || a - b);
  const m = syms.length;
  const A = new Int32Array(m);
  for (let i = 0; i < m; i++) A[i] = freq[syms[i]];
  minRedundancy(A, m);
  // Count per length, fold overlong codes into maxLen, then repair the Kraft sum (miniz' enforce_max_code_size).
  const num = new Int32Array(Math.max(maxLen, 32) + 1);
  for (let i = 0; i < m; i++) num[Math.min(A[i], maxLen)]++;
  let total = 0;
  for (let i = maxLen; i > 0; i--) total += num[i] << (maxLen - i);
  while (total !== 1 << maxLen) {
    num[maxLen]--;
    for (let i = maxLen - 1; i > 0; i--) if (num[i]) { num[i]--; num[i + 1] += 2; break; }
    total--;
  }
  // Least frequent symbols get the longest codes.
  let k = 0;
  for (let len = maxLen; len > 0; len--) for (let c = num[len]; c > 0; c--) lens[syms[k++]] = len;
  return lens;
}

// --- bit writer -----------------------------------------------------------------------------------

// LSB-first bit accumulator over a growable byte buffer. Callers call ensure() once per block with a precomputed
// size bound, so bits() itself never bounds-checks (hot path). bb holds < 8 pending bits between calls, so
// value << bc stays below 2^24 and is sign-safe. Growth doubles to keep total copying O(n).
class BitOut {
  constructor(cap) { this.buf = new Uint8Array(Math.max(1024, cap)); this.pos = 0; this.bb = 0; this.bc = 0; }
  ensure(extra) {
    if (this.pos + extra <= this.buf.length) return;
    const nb = new Uint8Array(Math.max(this.buf.length * 2, this.pos + extra + 1024));
    nb.set(this.buf.subarray(0, this.pos));
    this.buf = nb;
  }
  // value must fit in `n` bits, n <= 16 (codes <= 15, extra <= 13)
  bits(value, n) {
    this.bb |= value << this.bc;
    this.bc += n;
    while (this.bc >= 8) { this.buf[this.pos++] = this.bb & 255; this.bb >>>= 8; this.bc -= 8; }
  }
  align() { if (this.bc > 0) { this.buf[this.pos++] = this.bb & 255; } this.bb = 0; this.bc = 0; }
  bytes(src, start, end) { this.ensure(end - start + 8); this.buf.set(src.subarray(start, end), this.pos); this.pos += end - start; }
  result() { this.align(); return this.buf.slice(0, this.pos); }
}

// --- LZ77 parameters per level (zlib's configuration table) ---------------------------------------

//            good lazy nice chain  (lazy = 0: greedy with insert limit `lazy` of the fast path)
// good: once a match this long is found, search only 1/4 of the chain; lazy: for levels 4-9, do not look for a
// better match at i + 1 if the current one is at least this long (levels 1-3: matches up to this length have all
// their positions inserted into the hash chains, longer ones are skipped for speed); nice: stop searching at this
// length; chain: maximum candidates examined. Values are zlib's configuration_table, so levels compare like zlib's.
const LEVELS = [
  null,
  [4, 4, 8, 4], [4, 5, 16, 8], [4, 6, 32, 32],
  [4, 4, 16, 16], [8, 16, 32, 32], [8, 16, 128, 128], [8, 32, 128, 256], [32, 128, 258, 1024], [32, 258, 258, 4096],
];

const WSIZE = 32768, WMASK = WSIZE - 1, HBITS = 15, HSIZE = 1 << HBITS, HMASK = HSIZE - 1;
const MIN_MATCH = 3, MAX_MATCH = 258, MAX_DIST = WSIZE - 262;
const BLOCK_SYMS = 1 << 15;
// MAX_DIST = WSIZE - 262 (zlib's MAX_DIST): keeps MIN_LOOKAHEAD = MAX_MATCH + MIN_MATCH + 1 bytes of slack so a match
// never reaches beyond the 32 KiB window an inflater must keep. HBITS 15 = 32 K hash heads (3-byte hash below).
// BLOCK_SYMS: symbols per block before a flush; smaller blocks adapt Huffman tables to changing data, larger blocks
// amortise the table header. 32 K equals zlib's lit_bufsize at memLevel 9 (16 K at the default memLevel 8).

// Stored block: 3-bit header, align to a byte, LEN, NLEN (one's complement - a cheap integrity check), raw bytes.
// LEN is 16 bits, so long ranges split into 65535-byte blocks; an empty input still needs one (final) empty block.
function writeStored(out, src, start, end, last) {
  if (start === end) { out.ensure(8); out.bits(last ? 1 : 0, 3); out.align(); out.bits(0, 16); out.bits(0xffff, 16); return; }
  for (let p = start; p < end;) {
    const len = Math.min(65535, end - p);
    const fin = last && p + len === end;
    out.ensure(len + 16);
    out.bits(fin ? 1 : 0, 3);
    out.align();
    out.bits(len, 16); out.bits(~len & 0xffff, 16);
    out.bytes(src, p, p + len);
    p += len;
  }
}

// Writes one block of symbols (lit[i] < 256 literal, else 256 + length - 3 ... stored as length; dist[i] > 0 for matches).
// More precisely: dists[i] === 0 means lits[i] is a literal byte; otherwise lits[i] is the raw match length (3..258)
// and dists[i] the distance. The block is costed exactly three ways - dynamic (including its header), fixed,
// stored - and the cheapest is written. Exact costing, not a heuristic, is why random data never expands by more
// than the stored-block overhead. src/start/end are kept only for the stored fallback.
function writeBlock(out, src, start, end, lits, dists, n, last) {
  const lf = new Uint32Array(286), df = new Uint32Array(30);
  let extraBits = 0;
  for (let i = 0; i < n; i++) {
    const d = dists[i];
    if (d === 0) lf[lits[i]]++;
    else {
      const lc = LEN_CODE[lits[i]];
      lf[257 + lc]++;
      const dc = distCode(d);
      df[dc]++;
      extraBits += LEN_EXTRA[lc] + DIST_EXTRA[dc];
    }
  }
  // End-of-block must always have a code. HLIT/HDIST trim trailing unused lengths (minimums 257 and 1 per RFC).
  lf[256] = 1;
  const llen = buildLengths(lf, 15), dlen = buildLengths(df, 15);
  let hlit = 286; while (hlit > 257 && !llen[hlit - 1]) hlit--;
  let hdist = 30; while (hdist > 1 && !dlen[hdist - 1]) hdist--;
  // Run-length encoding of the concatenated code lengths (16: repeat previous, 17/18: zero runs).
  // Lit/len and distance lengths form ONE sequence (RFC allows runs to cross the boundary). rle is a flat
  // [symbol, extra] list, extra = -1 for plain lengths. A non-zero value is sent once literally, then repeated with 16
  // (3..6 copies); zeros use 18 (11..138) then 17 (3..10); remainders < 3 go out literally.
  const seq = new Uint8Array(hlit + hdist);
  seq.set(llen.subarray(0, hlit)); seq.set(dlen.subarray(0, hdist), hlit);
  const rle = [];
  const cf = new Uint32Array(19);
  for (let i = 0; i < seq.length;) {
    const v = seq[i];
    let run = 1;
    while (i + run < seq.length && seq[i + run] === v) run++;
    i += run;
    if (v === 0) {
      while (run >= 11) { const r = Math.min(138, run); rle.push(18, r - 11); cf[18]++; run -= r; }
      if (run >= 3) { rle.push(17, run - 3); cf[17]++; run = 0; }
    } else {
      rle.push(v, -1); cf[v]++; run--;
      while (run >= 3) { const r = Math.min(6, run); rle.push(16, r - 3); cf[16]++; run -= r; }
    }
    while (run-- > 0) { rle.push(v, -1); cf[v]++; }
  }
  const clen = buildLengths(cf, 7);
  let hclen = 19; while (hclen > 4 && !clen[CL_ORDER[hclen - 1]]) hclen--;
  let dynBits = 3 + 5 + 5 + 4 + hclen * 3, fixBits = 3;
  for (let i = 0; i < rle.length; i += 2) {
    const s = rle[i];
    dynBits += clen[s] + (s === 16 ? 2 : s === 17 ? 3 : s === 18 ? 7 : 0);
  }
  for (let i = 0; i < 286; i++) if (lf[i]) { dynBits += lf[i] * llen[i]; fixBits += lf[i] * FIXED_LIT_LEN[i]; }
  for (let i = 0; i < 30; i++) if (df[i]) { dynBits += df[i] * dlen[i]; fixBits += df[i] * 5; }
  dynBits += extraBits; fixBits += extraBits;
  // Stored cost: payload + 32 bits LEN/NLEN + 3-bit header + up to 7 alignment bits per 64 KiB piece (rounded to 40),
  // plus slack. Ties prefer stored, then fixed - both are cheaper to decode than dynamic.
  const storedBits = (end - start) * 8 + Math.ceil(Math.max(1, end - start) / 65535) * 40 + 10;
  if (storedBits <= dynBits && storedBits <= fixBits) { writeStored(out, src, start, end, last); return; }
  out.ensure(((Math.min(dynBits, fixBits) + 7) >> 3) + 16);
  let lc, ll, dc, dl;
  if (fixBits <= dynBits) {
    out.bits(last ? 3 : 2, 3);
    lc = FIXED_LIT_CODE; ll = FIXED_LIT_LEN; dc = FIXED_DIST_CODE; dl = FIXED_DIST_LEN;
  } else {
    out.bits(last ? 5 : 4, 3);
    out.bits(hlit - 257, 5); out.bits(hdist - 1, 5); out.bits(hclen - 4, 4);
    for (let i = 0; i < hclen; i++) out.bits(clen[CL_ORDER[i]], 3);
    const ccode = canonCodes(clen);
    for (let i = 0; i < rle.length; i += 2) {
      const s = rle[i];
      out.bits(ccode[s], clen[s]);
      if (s === 16) out.bits(rle[i + 1], 2); else if (s === 17) out.bits(rle[i + 1], 3); else if (s === 18) out.bits(rle[i + 1], 7);
    }
    lc = canonCodes(llen); ll = llen; dc = canonCodes(dlen); dl = dlen;
  }
  for (let i = 0; i < n; i++) {
    const d = dists[i];
    if (d === 0) { const s = lits[i]; out.bits(lc[s], ll[s]); continue; }
    const len = lits[i], c = LEN_CODE[len];
    out.bits(lc[257 + c], ll[257 + c]);
    if (LEN_EXTRA[c]) out.bits(len - LEN_BASE[c], LEN_EXTRA[c]);
    const k = distCode(d);
    out.bits(dc[k], dl[k]);
    if (DIST_EXTRA[k]) out.bits(d - DIST_BASE[k], DIST_EXTRA[k]);
  }
  out.bits(lc[256], ll[256]);
}

/** Raw deflate (no header). level 0 = stored, 1 = fastest .. 9 = smallest. */
// LZ77 with zlib-style hash chains: head[h] = most recent position with 3-byte hash h, prev[pos & WMASK] = the
// previous position with the same hash. prev is a ring of WSIZE entries, so old links get overwritten - longest()
// detects that by a non-decreasing link (p >= cand) and stops. The whole input is in memory (src), so there is no
// sliding-window copy: positions are absolute and only the 32 KiB distance limit applies.
// Two parsers: greedy (levels 1-3) takes the first acceptable match; lazy (4-9) defers each match by one byte and
// keeps it only if the match at the next position is not longer - the classic gzip trade of ~2x time for ~3-5 %.
export function deflateRawSync(input, { level = 6 } = {}) {
  const src = input instanceof Uint8Array ? input : new Uint8Array(input);
  const n = src.length;
  const out = new BitOut((n >> 1) + 64);
  level = Math.max(0, Math.min(9, Math.round(level)));
  if (level === 0) { writeStored(out, src, 0, n, true); return out.result(); }
  const [good, lazyCfg, nice, maxChain] = LEVELS[level];
  const lazyMode = level >= 4;
  const head = new Int32Array(HSIZE).fill(-1);
  const prev = new Int32Array(WSIZE);
  const lits = new Uint16Array(BLOCK_SYMS), dists = new Uint16Array(BLOCK_SYMS);
  let ns = 0, blockStart = 0;
  const hashAt = (i) => ((src[i] << 10) ^ (src[i + 1] << 5) ^ src[i + 2]) & HMASK;
  const insert = (i) => { const hh = hashAt(i); prev[i & WMASK] = head[hh]; head[hh] = i; };
  // Longest match at `i` among chain candidates, at least `bestLen + 1` long to count.
  // Quick reject: compare the byte at offset `best` first - a candidate that differs there cannot beat the current
  // best, and that byte is the most likely to differ. Result distance is returned through the closure variable
  // matchDist to avoid allocating a pair per call in the hottest function.
  let matchDist = 0;
  const longest = (i, bestLen, chainLen) => {
    const limit = i > MAX_DIST ? i - MAX_DIST : 0;
    const maxLen = Math.min(MAX_MATCH, n - i);
    let best = bestLen;
    matchDist = 0;
    let cand = head[hashAt(i)];
    let chain = bestLen >= good ? chainLen >> 2 : chainLen;
    while (cand >= limit && cand >= 0 && chain-- > 0) {
      if (cand < i && src[cand + best] === src[i + best] && src[cand] === src[i] && src[cand + 1] === src[i + 1]) {
        let l = 2;
        while (l < maxLen && src[cand + l] === src[i + l]) l++;
        if (l > best) {
          best = l; matchDist = i - cand;
          if (l >= nice || l >= maxLen) break;
        }
      }
      const p = prev[cand & WMASK];
      if (p >= cand) break;
      cand = p;
    }
    return best;
  };
  const flush = (pos, last) => { writeBlock(out, src, blockStart, pos, lits, dists, ns, last); ns = 0; blockStart = pos; };
  // Greedy: after a match, its inner positions are inserted only when it is short (<= lazyCfg) - skipping inserts for
  // long matches is the main speed lever of zlib's fast levels, at the cost of missing later matches into them.
  let i = 0;
  if (!lazyMode) {
    while (i < n) {
      let len = 0;
      if (i + MIN_MATCH <= n) {
        len = longest(i, MIN_MATCH - 1, maxChain);
        if (len >= MIN_MATCH && matchDist > 0) {
          lits[ns] = len; dists[ns++] = matchDist;
          insert(i);
          if (len <= lazyCfg) { for (let k = 1; k < len && i + k + MIN_MATCH <= n; k++) insert(i + k); }
          i += len;
          if (ns === BLOCK_SYMS) flush(i, false);
          continue;
        }
        insert(i);
      }
      lits[ns] = src[i]; dists[ns++] = 0; i++;
      if (ns === BLOCK_SYMS) flush(i, false);
    }
  } else {
    // Lazy: (prevLen, prevDist) is the match found at i - 1, havePrev says position i - 1 is still unemitted. At each
    // i we search for a match that must beat prevLen; if it does not, the previous match is emitted, otherwise the
    // byte at i - 1 goes out as a literal and the new match becomes "previous". Matches already >= lazyCfg are not
    // challenged at all (no search), matching zlib's max_lazy_match.
    let prevLen = 0, prevDist = 0, havePrev = false;
    while (i < n) {
      let len = 0, dist = 0;
      if (i + MIN_MATCH <= n) {
        if (!havePrev || prevLen < lazyCfg) {
          len = longest(i, havePrev ? Math.max(prevLen, MIN_MATCH - 1) : MIN_MATCH - 1, havePrev && prevLen >= good ? maxChain >> 2 : maxChain);
          dist = matchDist;
          if (len === MIN_MATCH && dist > 4096) len = 0; // short far matches cost more than literals
          if (!dist) len = 0;
        }
        insert(i);
      }
      if (havePrev && prevLen >= MIN_MATCH && len <= prevLen) {
        // Emit the previous match (started at i - 1); positions inside it are inserted into the chains.
        lits[ns] = prevLen; dists[ns++] = prevDist;
        const end = i - 1 + prevLen;
        for (let k = i + 1; k < end && k + MIN_MATCH <= n; k++) insert(k);
        i = end;
        havePrev = false; prevLen = 0;
        if (ns === BLOCK_SYMS) flush(i, false);
        continue;
      }
      if (havePrev) { lits[ns] = src[i - 1]; dists[ns++] = 0; if (ns === BLOCK_SYMS) flush(i, false); }
      havePrev = true; prevLen = len; prevDist = dist;
      i++;
    }
    if (havePrev) { lits[ns] = src[n - 1]; dists[ns++] = 0; }
  }
  flush(n, true);
  return out.result();
}

/** zlib stream: CMF/FLG header, raw deflate, Adler-32 (big-endian). */
// CMF 0x78 = method 8 (deflate), CINFO 7 (32 KiB window). FLG: FLEVEL in the top two bits (informational only), FDICT
// 0, FCHECK chosen so that (CMF * 256 + FLG) % 31 === 0. When the sum is already a multiple of 31 this adds 31
// rather than 0 - still valid (31 fits in the 5-bit field), just not the canonical FCHECK zlib would write.
// The trailer is Adler-32 of the UNCOMPRESSED data, big-endian (unlike deflate's LSB-first bits).
export function zlibSync(input, { level = 6 } = {}) {
  const src = input instanceof Uint8Array ? input : new Uint8Array(input);
  const raw = deflateRawSync(src, { level });
  const out = new Uint8Array(raw.length + 6);
  const flevel = level <= 1 ? 0 : level <= 5 ? 1 : level === 6 ? 2 : 3;
  out[0] = 0x78;
  out[1] = flevel << 6;
  out[1] += 31 - ((out[0] * 256 + out[1]) % 31);
  out.set(raw, 2);
  const a = adler32(src);
  const p = raw.length + 2;
  out[p] = a >>> 24; out[p + 1] = (a >>> 16) & 255; out[p + 2] = (a >>> 8) & 255; out[p + 3] = a & 255;
  return out;
}

// --- inflate ----------------------------------------------------------------------------------------

// Decoding table: index = next `bits` input bits (LSB first) -> (symbol << 4) | code length; 0 = invalid.
// Single-level full table of 2^maxLen entries (max 32 K for 15-bit codes): one lookup per symbol, no tree walk.
// zlib uses two-level tables to save memory; here simplicity wins, and the table is rebuilt per dynamic block.
// Because codes are stored bit-reversed, a code fills every index whose LOW l bits equal it (stride 1 << l).
// Entry 0 cannot be a valid entry (length is >= 1), so 0 doubles as "no code" for incomplete codes.
// KNOWN DEFECT: over-subscribed length sets (Kraft sum > 1) are not rejected; later symbols silently overwrite
// earlier entries, so malformed streams can decode to garbage instead of throwing. Fix: compute the Kraft sum in
// decodeTable and corrupt('over-subscribed code') when it exceeds 1.
function decodeTable(lens, n) {
  let max = 0;
  for (let i = 0; i < n; i++) if (lens[i] > max) max = lens[i];
  if (!max) return { table: new Uint16Array(1), bits: 0 };
  const codes = canonCodes(lens.subarray(0, n));
  const size = 1 << max;
  const table = new Uint16Array(size);
  for (let s = 0; s < n; s++) {
    const l = lens[s];
    if (!l) continue;
    const v = (s << 4) | l;
    for (let k = codes[s]; k < size; k += 1 << l) table[k] = v;
  }
  return { table, bits: max };
}
let FIXED_DEC = null;
const fixedDec = () => FIXED_DEC || (FIXED_DEC = [decodeTable(FIXED_LIT_LEN, 288), decodeTable(FIXED_DIST_LEN, 30)]);

const corrupt = (why) => { throw new Error('invalid deflate data: ' + why); };

/** Raw inflate. `size`: expected output length (optional). */
// Bit position `pos` over the whole input instead of a shifting bit buffer: the input is fully in memory, so peek()
// can read any 24-bit window directly. Reads past the end yield zeros (undefined | ... -> 0) and are caught by the
// `pos > total` checks once per symbol/table rather than per bit - cheap and still fail-fast.
// Output buffer starts at 4x input (typical deflate ratio) and doubles; final slice trims it.
export function inflateRawSync(input, { size = 0 } = {}) {
  const d = input instanceof Uint8Array ? input : new Uint8Array(input);
  const total = d.length * 8;
  let out = new Uint8Array(size > 0 ? size : Math.max(1024, d.length * 4));
  let op = 0, pos = 0;
  const grow = (need) => {
    if (op + need <= out.length) return;
    const nb = new Uint8Array(Math.max(out.length * 2, op + need));
    nb.set(out.subarray(0, op));
    out = nb;
  };
  // Up to 24 bits from `pos` (missing bytes past the end read as zero; overruns are checked per symbol).
  const peek = (p) => ((d[p >> 3] | (d[(p >> 3) + 1] << 8) | (d[(p >> 3) + 2] << 16)) >>> (p & 7));
  const read = (n) => { const v = peek(pos) & ((1 << n) - 1); pos += n; return v; };
  const lens = new Uint8Array(320);
  let final = 0;
  while (!final) {
    if (pos + 3 > total) corrupt('unexpected end');
    final = read(1);
    const type = read(2);
    if (type === 0) {
      let p = (pos + 7) >> 3;
      if (p + 4 > d.length) corrupt('unexpected end');
      const len = d[p] | (d[p + 1] << 8), nlen = d[p + 2] | (d[p + 3] << 8);
      if ((len ^ 0xffff) !== nlen) corrupt('stored length');
      p += 4;
      if (p + len > d.length) corrupt('unexpected end');
      grow(len);
      out.set(d.subarray(p, p + len), op);
      op += len;
      pos = (p + len) * 8;
      continue;
    }
    if (type === 3) corrupt('block type');
    let lt, dt;
    if (type === 1) [lt, dt] = fixedDec();
    else {
      const hlit = read(5) + 257, hdist = read(5) + 1, hclen = read(4) + 4;
      if (hlit > 286 || hdist > 30) corrupt('table sizes');
      const cl = new Uint8Array(19);
      for (let i = 0; i < hclen; i++) cl[CL_ORDER[i]] = read(3);
      const ct = decodeTable(cl, 19);
      const cmask = (1 << ct.bits) - 1;
      lens.fill(0);
      for (let i = 0; i < hlit + hdist;) {
        const e = ct.table[peek(pos) & cmask];
        if (!e) corrupt('code lengths');
        pos += e & 15;
        const s = e >> 4;
        if (s < 16) { lens[i++] = s; continue; }
        let rep, val = 0;
        if (s === 16) { if (!i) corrupt('repeat'); val = lens[i - 1]; rep = 3 + read(2); } else if (s === 17) rep = 3 + read(3); else rep = 11 + read(7);
        if (i + rep > hlit + hdist) corrupt('repeat overflow');
        while (rep--) lens[i++] = val;
      }
      if (pos > total) corrupt('unexpected end');
      if (!lens[256]) corrupt('no end-of-block code');
      lt = decodeTable(lens.subarray(0, hlit), hlit);
      dt = decodeTable(lens.subarray(hlit, hlit + hdist), hdist);
    }
    const ltab = lt.table, lmask = (1 << lt.bits) - 1, dtab = dt.table, dmask = (1 << dt.bits) - 1;
    for (;;) {
      if (pos > total) corrupt('unexpected end');
      const e = ltab[peek(pos) & lmask];
      if (!e) corrupt('literal/length code');
      pos += e & 15;
      const s = e >> 4;
      if (s < 256) { if (op >= out.length) grow(1); out[op++] = s; continue; }
      if (s === 256) break;
      const li = s - 257;
      if (li > 28) corrupt('length code');
      let len = LEN_BASE[li];
      if (LEN_EXTRA[li]) len += read(LEN_EXTRA[li]);
      const de = dtab[peek(pos) & dmask];
      if (!de) corrupt('distance code');
      pos += de & 15;
      const ds = de >> 4;
      if (ds > 29) corrupt('distance code');
      let dist = DIST_BASE[ds];
      if (DIST_EXTRA[ds]) dist += read(DIST_EXTRA[ds]);
      if (dist > op) corrupt('distance too far back');
      // Overlapping copy (dist < len) is the LZ77 run idiom ("repeat the last dist bytes"): copyWithin would copy
      // from the pre-copy snapshot and break it, so a byte loop is used; non-overlapping copies use the fast path.
      grow(len);
      let from = op - dist;
      if (dist >= len) { out.copyWithin(op, from, from + len); op += len; } else { for (let k = 0; k < len; k++) out[op++] = out[from++]; }
    }
  }
  if (pos > total) corrupt('unexpected end');
  return op === out.length ? out : out.slice(0, op);
}

// --- streaming inflate (Deflate and Deflate64) ---------------------------------------------------------------

// Deflate64 (PKWARE method 9): 64 KiB window, length code 285 = 3 + 16 extra bits, distance codes 30 and 31.
// Only these three table changes distinguish it, so the streaming inflater swaps tables rather than duplicating code.
// Deflate64 is decode-only here: the format is undocumented by an RFC and only ever met inside ZIP files.
const LEN_BASE64 = LEN_BASE.slice(); LEN_BASE64[28] = 3;
const LEN_EXTRA64 = LEN_EXTRA.slice(); LEN_EXTRA64[28] = 16;
const DIST_BASE64 = new Uint32Array([...DIST_BASE, 32769, 49153]);
const DIST_EXTRA64 = new Uint8Array([...DIST_EXTRA, 14, 14]);
let FIXED_DEC64 = null;
const fixedDec64 = () => FIXED_DEC64 || (FIXED_DEC64 = [decodeTable(FIXED_LIT_LEN, 288), decodeTable(FIXED_DIST_LEN, 32)]);
const STEP = 65540; // the largest single output step: a Deflate64 match (65538 bytes) or a piece of a stored block

/**
 * Streaming raw inflate with bounded memory: `new Inflater(input, { deflate64, size })`, where `input` has `byte()`
 * (0..255, or -1 at the end of the input) and optionally `chunk(max)` (a view of up to max bytes, or null) for stored
 * blocks. `read(max)` returns the next output bytes as a view (valid until the next call), or null after the final
 * block. `size` (expected output length, optional) only sizes the buffer. After the end, `alignedByte()` returns the
 * input bytes following the deflate data (gzip trailers, the next member) and `ended` is true. Corrupt input throws.
 */
// Design: a resumable state machine (mode) over a pull-based byte source, so a multi-GB ZIP entry inflates with at
// most ~1 MiB + 2 * STEP of memory. The output buffer doubles as the LZ77 window: room() slides the last `win` bytes
// to the front when space runs out. Bits past the end of input are fed as zeros and counted in `pad`; any read
// that consumes padding (bc < pad) is 'unexpected end'. That lets the hot loop refill without an end check per byte.
// Each read() stops STEP bytes before the buffer end so one match or stored chunk can never overflow it.
export class Inflater {
  constructor(input, { deflate64 = false, size = 0 } = {}) {
    this.in = input;
    this.d64 = deflate64;
    this.win = deflate64 ? 65536 : 32768;
    const want = size > 0 ? size + STEP + 4096 : 1 << 20;
    this.buf = new Uint8Array(Math.min(want, (1 << 20) + 2 * STEP));
    this.pos = 0;
    this.mode = 0; // 0: block header, 1: Huffman block, 2: stored block, 3: done
    this.last = 0;
    this.left = 0;
    this.bb = 0; this.bc = 0; this.pad = 0;
    this.lt = null; this.dt = null;
    this.ended = false;
  }

  need(n) {
    while (this.bc < n) {
      let c = this.in.byte();
      if (c < 0) { c = 0; this.pad += 8; }
      this.bb |= c << this.bc;
      this.bc += 8;
    }
  }

  bits(n) {
    this.need(n);
    const v = this.bb & ((1 << n) - 1);
    this.bb >>>= n;
    this.bc -= n;
    if (this.bc < this.pad) corrupt('unexpected end');
    return v;
  }

  // Keeps the window behind `pos` and makes room for one more step (slides, or grows a small buffer).
  room() {
    if (this.pos + STEP <= this.buf.length - 4096) return;
    const keep = Math.min(this.pos, this.win);
    if (this.pos - keep >= 65536) { this.buf.copyWithin(0, this.pos - keep, this.pos); this.pos = keep; return; }
    const nb = new Uint8Array(Math.min(this.buf.length * 2, (1 << 20) + 2 * STEP + 4096));
    if (nb.length <= this.buf.length) { this.buf.copyWithin(0, this.pos - keep, this.pos); this.pos = keep; return; }
    nb.set(this.buf.subarray(0, this.pos));
    this.buf = nb;
  }

  // Block header. Stored blocks: drop bits to the byte boundary, then LEN/NLEN come from the bit buffer (it may still
  // hold whole bytes already pulled from the input). Dynamic blocks: same table reading as inflateRawSync.
  header() {
    this.last = this.bits(1);
    const type = this.bits(2);
    if (type === 0) {
      this.bb >>>= this.bc & 7; this.bc -= this.bc & 7;
      const len = this.bits(16), nlen = this.bits(16);
      if ((len ^ 0xffff) !== nlen) corrupt('stored length');
      this.left = len;
      this.mode = 2;
      return;
    }
    if (type === 3) corrupt('block type');
    if (type === 1) [this.lt, this.dt] = this.d64 ? fixedDec64() : fixedDec();
    else {
      const hlit = this.bits(5) + 257, hdist = this.bits(5) + 1, hclen = this.bits(4) + 4;
      if (hlit > 286 || hdist > (this.d64 ? 32 : 30)) corrupt('table sizes');
      const cl = new Uint8Array(19);
      for (let i = 0; i < hclen; i++) cl[CL_ORDER[i]] = this.bits(3);
      const ct = decodeTable(cl, 19);
      const cmask = (1 << ct.bits) - 1;
      const lens = new Uint8Array(hlit + hdist);
      for (let i = 0; i < hlit + hdist;) {
        this.need(ct.bits);
        const e = ct.table[this.bb & cmask];
        if (!e) corrupt('code lengths');
        this.bb >>>= e & 15; this.bc -= e & 15;
        const s = e >> 4;
        if (s < 16) { lens[i++] = s; continue; }
        let rep, val = 0;
        if (s === 16) { if (!i) corrupt('repeat'); val = lens[i - 1]; rep = 3 + this.bits(2); } else if (s === 17) rep = 3 + this.bits(3); else rep = 11 + this.bits(7);
        if (i + rep > hlit + hdist) corrupt('repeat overflow');
        while (rep--) lens[i++] = val;
      }
      if (this.bc < this.pad) corrupt('unexpected end');
      if (!lens[256]) corrupt('no end-of-block code');
      this.lt = decodeTable(lens.subarray(0, hlit), hlit);
      this.dt = decodeTable(lens.subarray(hlit), hdist);
    }
    this.mode = 1;
  }

  // Produces up to `max` bytes. Stored data first drains whole bytes left in the bit buffer, then uses chunk() (bulk
  // copy) when the source offers it. The Huffman loop copies state into locals (V8 keeps them in registers; property
  // access per bit would dominate) and writes it back once.
  // If a call produced nothing but the stream is not done (e.g. it only parsed a block header or an empty stored
  // block), it recurses - each level consumes input, so recursion depth is bounded by consecutive empty blocks.
  read(max = 1 << 20) {
    if (this.mode === 3) return null;
    this.room();
    const start = this.pos;
    const stop = Math.min(start + Math.max(1, max), this.buf.length - STEP);
    const lb = this.d64 ? LEN_BASE64 : LEN_BASE, le = this.d64 ? LEN_EXTRA64 : LEN_EXTRA;
    const db = this.d64 ? DIST_BASE64 : DIST_BASE, de = this.d64 ? DIST_EXTRA64 : DIST_EXTRA;
    const maxDist = this.d64 ? 31 : 29;
    const inp = this.in;
    while (this.pos < stop && this.mode !== 3) {
      if (this.mode === 0) { this.header(); continue; }
      if (this.mode === 2) {
        const buf = this.buf;
        let pos = this.pos;
        while (this.left > 0 && this.bc - this.pad >= 8 && pos < stop) { buf[pos++] = this.bb & 255; this.bb >>>= 8; this.bc -= 8; this.left--; }
        if (this.left > 0 && this.pad) corrupt('unexpected end');
        while (this.left > 0 && pos < stop) {
          const n = Math.min(this.left, stop - pos);
          if (inp.chunk) {
            const c = inp.chunk(n);
            if (!c) corrupt('unexpected end');
            buf.set(c, pos); pos += c.length; this.left -= c.length;
          } else {
            const c = inp.byte();
            if (c < 0) corrupt('unexpected end');
            buf[pos++] = c; this.left--;
          }
        }
        this.pos = pos;
        if (this.left === 0) this.mode = this.last ? 3 : 0;
        continue;
      }
      // Huffman block: the hot loop works on locals.
      const buf = this.buf;
      const lt = this.lt.table, lmask = (1 << this.lt.bits) - 1, lbits = this.lt.bits;
      const dt = this.dt.table, dmask = (1 << this.dt.bits) - 1, dbits = this.dt.bits;
      let bb = this.bb, bc = this.bc, pad = this.pad, pos = this.pos;
      for (;;) {
        if (pos >= stop) break;
        while (bc < lbits) { let c = inp.byte(); if (c < 0) { c = 0; pad += 8; } bb |= c << bc; bc += 8; }
        const e = lt[bb & lmask];
        if (!e) corrupt('literal/length code');
        bb >>>= e & 15; bc -= e & 15;
        const s = e >> 4;
        if (s < 256) { buf[pos++] = s; continue; }
        if (s === 256) { this.mode = this.last ? 3 : 0; break; }
        const li = s - 257;
        if (li > 28) corrupt('length code');
        let len = lb[li];
        const lx = le[li];
        if (lx) {
          while (bc < lx) { let c = inp.byte(); if (c < 0) { c = 0; pad += 8; } bb |= c << bc; bc += 8; }
          len += bb & ((1 << lx) - 1); bb >>>= lx; bc -= lx;
        }
        while (bc < dbits) { let c = inp.byte(); if (c < 0) { c = 0; pad += 8; } bb |= c << bc; bc += 8; }
        const f = dt[bb & dmask];
        if (!f) corrupt('distance code');
        bb >>>= f & 15; bc -= f & 15;
        const ds = f >> 4;
        if (ds > maxDist) corrupt('distance code');
        let dist = db[ds];
        const dx = de[ds];
        if (dx) {
          while (bc < dx) { let c = inp.byte(); if (c < 0) { c = 0; pad += 8; } bb |= c << bc; bc += 8; }
          dist += bb & ((1 << dx) - 1); bb >>>= dx; bc -= dx;
        }
        if (dist > pos) corrupt('distance too far back');
        let from = pos - dist;
        if (dist >= len) { buf.copyWithin(pos, from, from + len); pos += len; } else { for (let k = 0; k < len; k++) buf[pos++] = buf[from++]; }
      }
      if (bc < pad) corrupt('unexpected end');
      this.bb = bb; this.bc = bc; this.pad = pad; this.pos = pos;
    }
    if (this.mode === 3 && !this.ended) { this.ended = true; this.bb >>>= this.bc & 7; this.bc -= this.bc & 7; }
    return this.pos > start ? this.buf.subarray(start, this.pos) : this.mode === 3 ? null : this.read(max);
  }

  /** After the end: the next input byte past the deflate data (-1 at the end of the input). */
  alignedByte() {
    if (this.bc - this.pad >= 8) { const v = this.bb & 255; this.bb >>>= 8; this.bc -= 8; return v; }
    if (this.bc > 0) { this.bb = 0; this.bc = 0; this.pad = 0; return -1; }
    return this.in.byte();
  }
}

/** zlib stream -> bytes (header and Adler-32 checked). */
// Header checks: CM must be 8, CINFO <= 7 (window <= 32 KiB), and the FCHECK divisibility rule. A preset dictionary
// (FDICT) is refused explicitly: without the dictionary the stream is undecodable, so failing early is honest.
// check: false skips Adler-32 for callers that verify integrity another way (e.g. an outer CRC).
export function unzlibSync(input, { size = 0, check = true } = {}) {
  const d = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (d.length < 6 || (d[0] & 15) !== 8 || (d[0] >> 4) > 7 || ((d[0] << 8) | d[1]) % 31) throw new Error('invalid zlib header');
  if (d[1] & 32) throw new Error('zlib preset dictionary is not supported');
  const out = inflateRawSync(d.subarray(2, d.length - 4), { size });
  if (check) {
    const p = d.length - 4;
    const want = ((d[p] << 24) | (d[p + 1] << 16) | (d[p + 2] << 8) | d[p + 3]) >>> 0;
    if (adler32(out) !== want) throw new Error('zlib Adler-32 mismatch');
  }
  return out;
}
