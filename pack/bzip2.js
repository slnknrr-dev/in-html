// pack/bzip2.js - bzip2 encoder: RLE1, Burrows-Wheeler transform (cyclic prefix doubling with radix sorts), MTF and
// RLE2 (RUNA / RUNB), 2-6 Huffman tables refined over four passes with selectors per 50 symbols, block and stream
// CRCs. The streams read back with bzip2(1), 7-Zip and ../archive/bzip2.js.
//
//   bzip2(data, { level = 9 }) -> Uint8Array          level 1..9: block size level * 100 000 bytes

// DESIGN. One synchronous pass per block, everything in typed arrays: the block (<= 900 kB after RLE1) and its
// suffix order fit comfortably in memory, so no streaming state machine is needed. Fidelity criterion: the output
// must be accepted by the reference bzip2 decoder, which is strict about the bit layout, the RLE1 run cap, the
// Huffman length limit (20 bits; we use 17) and the per-block and combined stream CRCs.
//
// bzip2 uses the *big-endian, non-reflected* CRC-32 (poly 0x04c11db7, MSB first), not the reflected zlib/gzip CRC
// of ../codec/crc32.js; reusing that one yields bit-reversed CRCs and every decoder rejects the block. The table is
// built lazily so importing the module costs nothing.
let CRC = null;
function crcTable() {
  if (CRC) return CRC;
  CRC = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 24;
    for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
    CRC[i] = c;
  }
  return CRC;
}

// MSB-first bit writer (bzip2 packs bits from the top of each byte, unlike Deflate). bb holds < 8 pending bits; with
// n <= 24 the shifted value stays within 31 bits, and '>>>' reads it unsigned even if bit 31 gets set.
class BitOut {
  constructor(n) { this.buf = new Uint8Array(Math.max(1024, n)); this.pos = 0; this.bb = 0; this.bc = 0; }
  // Doubling growth: amortised O(1) per byte; the initial guess (input / 2) avoids most reallocations.
  grow(k) { if (this.pos + k > this.buf.length) { const b = new Uint8Array((this.buf.length + k) * 2); b.set(this.buf.subarray(0, this.pos)); this.buf = b; } }
  bits(v, n) {
    // n <= 24
    this.bb = (this.bb << n) | (v & ((1 << n) - 1));
    this.bc += n;
    if (this.bc >= 8) {
      this.grow(4);
      while (this.bc >= 8) { this.bc -= 8; this.buf[this.pos++] = (this.bb >>> this.bc) & 0xff; }
      this.bb &= (1 << this.bc) - 1;
    }
  }
  u32(v) { this.bits((v >>> 16) & 0xffff, 16); this.bits(v & 0xffff, 16); }
  // Zero-pad the last byte: the decoder stops at the end-of-stream marker, so trailing pad bits are never read.
  finish() { if (this.bc) this.bits(0, 8 - this.bc); return this.buf.slice(0, this.pos); }
}

// BWT as a suffix-array problem on the *cyclic* string (bzip2 sorts rotations, not suffixes, so no sentinel byte).
// Prefix doubling: after round k the ranks order rotations by their first 2k bytes; each round is a stable LSD
// radix pass on (rank[i], rank[i + k]) done as one counting sort, because sorting by the second key first is free:
// shifting the previous order back by k already lists rotations by rank[i + k]. O(n log n) worst case and no
// comparison sort, so highly repetitive input (the classic quicksort-BWT pathology bzip2 fights with its
// fallback sorter) costs the same as random input. Stops early once all ranks are distinct; a periodic input
// (e.g. 'abab') never becomes distinct and stops at k >= n, leaving equal rotations in a valid, arbitrary order.
// Memory: 3 Int32Array(n) + counts, about 12n bytes.
// Sorted cyclic rotations of b[0..n) (prefix doubling; ranks by counting sort). Returns the start indices.
export function bwtOrder(b, n) {
  const sa = new Int32Array(n), rank = new Int32Array(n), tmp = new Int32Array(n);
  const cnt = new Int32Array(Math.max(256, n) + 1);
  for (let i = 0; i < n; i++) cnt[b[i]]++;
  for (let i = 1; i < 256; i++) cnt[i] += cnt[i - 1];
  for (let i = n - 1; i >= 0; i--) sa[--cnt[b[i]]] = i;
  rank[sa[0]] = 0;
  let classes = 1;
  for (let i = 1; i < n; i++) { if (b[sa[i]] !== b[sa[i - 1]]) classes++; rank[sa[i]] = classes - 1; }
  for (let k = 1; k < n && classes < n; k <<= 1) {
    // Order by the second half: shift the current order back by k.
    for (let i = 0; i < n; i++) { let j = sa[i] - k; if (j < 0) j += n; tmp[i] = j; }
    cnt.fill(0, 0, classes + 1);
    for (let i = 0; i < n; i++) cnt[rank[tmp[i]]]++;
    for (let i = 1; i < classes; i++) cnt[i] += cnt[i - 1];
    for (let i = n - 1; i >= 0; i--) sa[--cnt[rank[tmp[i]]]] = tmp[i];
    // New ranks: (rank[i], rank[i + k]).
    tmp[sa[0]] = 0;
    let c = 1;
    for (let i = 1; i < n; i++) {
      const a = sa[i], p = sa[i - 1];
      let a2 = a + k, p2 = p + k;
      if (a2 >= n) a2 -= n;
      if (p2 >= n) p2 -= n;
      if (rank[a] !== rank[p] || rank[a2] !== rank[p2]) c++;
      tmp[a] = c - 1;
    }
    rank.set(tmp);
    classes = c;
  }
  return sa;
}

// Length limiting by frequency flattening (f -> 1 + f/2, rebuild) rather than package-merge: it is what bzip2
// itself does, converges in a few rounds, and costs a few percent of optimality only on skewed tables. The
// two-queue construction is O(n) after the sort because merged weights come out non-decreasing. Zero frequencies
// are lifted to 1 because bzip2 transmits a length for every symbol of the alphabet (no "unused" length exists).
// Code lengths limited to `max` bits (frequencies are flattened and the tree rebuilt until they fit, as bzip2 does).
function codeLengths(freq, n, max) {
  const lens = new Uint8Array(n);
  const f = Float64Array.from(freq.subarray(0, n), (x) => x || 1);
  for (;;) {
    // Heap of nodes; weight with depth tie-break.
    const nodes = [];
    for (let i = 0; i < n; i++) nodes.push({ w: f[i], d: 0, s: i });
    if (n === 1) { lens[0] = 1; return lens; }
    const heap = nodes.slice().sort((a, b) => a.w - b.w || a.d - b.d);
    // Simple two-queue Huffman (the leaves sorted, internal nodes produced in non-decreasing order).
    const q2 = [];
    let i1 = 0, i2 = 0;
    const take = () => (i2 >= q2.length || (i1 < heap.length && (heap[i1].w < q2[i2].w || (heap[i1].w === q2[i2].w && heap[i1].d <= q2[i2].d))) ? heap[i1++] : q2[i2++]);
    for (let k = 0; k < n - 1; k++) {
      const a = take(), b = take();
      q2.push({ w: a.w + b.w, d: Math.max(a.d, b.d) + 1, l: a, r: b });
    }
    const root = q2[q2.length - 1];
    let over = false;
    const walk = (x, d) => { if (x.l) { walk(x.l, d + 1); walk(x.r, d + 1); } else { lens[x.s] = d; if (d > max) over = true; } };
    walk(root, 0);
    if (!over) return lens;
    for (let i = 0; i < n; i++) f[i] = 1 + Math.floor(f[i] / 2);
  }
}

// Canonical codes: shorter lengths first, ties by symbol order - exactly the assignment the decoder rebuilds from
// the transmitted lengths, so only lengths need to be sent. 20 is bzip2's maximum length.
function canonical(lens, n) {
  const codes = new Int32Array(n);
  let code = 0;
  for (let l = 1; l <= 20; l++) {
    for (let s = 0; s < n; s++) if (lens[s] === l) codes[s] = code++;
    code <<= 1;
  }
  return codes;
}

// RLE1: runs of 4..255 equal bytes become 4 bytes plus a count byte (0..251). Historically this guarded the old
// BWT sorter against long runs; the format still requires it. The run cap of 255 is mandatory: a decoder that
// sees 4 equal bytes always reads a count next. The 5-byte slack in 'limit - 5' guarantees one more run always fits,
// so a run is never split across blocks (splitting would be legal but complicates the CRC bookkeeping).
function rle1(data, start, limit) {
  // Encodes from data[start..] until the output would exceed `limit`; returns [bytes, length, consumed].
  const out = new Uint8Array(limit + 8);
  let o = 0, i = start;
  const n = data.length;
  while (i < n && o < limit - 5) {
    const c = data[i];
    let run = 1;
    while (run < 255 && i + run < n && data[i + run] === c) run++;
    if (run >= 4) {
      out[o++] = c; out[o++] = c; out[o++] = c; out[o++] = c; out[o++] = run - 4;
    } else {
      for (let k = 0; k < run; k++) out[o++] = c;
    }
    i += run;
  }
  return [out, o, i - start];
}

// One block: BWT -> MTF over the used-symbol alphabet -> RLE2 of zero runs -> multi-table Huffman.
// 'crc' is the CRC of the block's *original* (pre-RLE1) bytes, as the format defines it.
function encodeBlock(bw, block, n, crc) {
  const sa = bwtOrder(block, n);
  let origPtr = 0;
  const inUse = new Uint8Array(256);
  for (let i = 0; i < n; i++) inUse[block[i]] = 1;
  // Symbols are renumbered to the dense set of bytes actually present, so the MTF alphabet (and every Huffman
  // table) has nInUse + 2 entries: RUNA, RUNB, MTF ranks 1..nInUse-1 shifted by one, and EOB.
  const seqToUnseq = [], unseqToSeq = new Int32Array(256);
  for (let i = 0; i < 256; i++) if (inUse[i]) { unseqToSeq[i] = seqToUnseq.length; seqToUnseq.push(i); }
  const nInUse = seqToUnseq.length;
  const EOB = nInUse + 1, alpha = nInUse + 2;
  // MTF + RLE2
  const mtf = new Uint16Array(n + 1);
  const order = new Uint8Array(256);
  for (let i = 0; i < nInUse; i++) order[i] = i;
  let nm = 0, zeros = 0;
  const flushZeros = () => {
    // bijective base 2: RUNA = 1, RUNB = 2
    let z = zeros;
    while (z > 0) { z--; mtf[nm++] = z & 1; z >>= 1; }
    zeros = 0;
  };
    // The BWT output byte for rotation sa[j] is the byte *before* it; origPtr records the row of the original
  // string (the rotation starting at 0), which the decoder needs to invert the transform.
  for (let j = 0; j < n; j++) {
    let p = sa[j] - 1;
    if (p < 0) { p += n; origPtr = j; }
    const v = unseqToSeq[block[p]];
    let k = 0;
    // Linear MTF search: alphabets are <= 256 and post-BWT data clusters near the front, so the average k is small.
    while (order[k] !== v) k++;
    if (k === 0) { zeros++; continue; }
    flushZeros();
    for (let q = k; q > 0; q--) order[q] = order[q - 1];
    order[0] = v;
    mtf[nm++] = k + 1;
  }
  flushZeros();
  mtf[nm++] = EOB;

  // More tables for larger blocks, same thresholds as bzip2: each extra table costs ~ alpha * 5 bits of header and
  // only pays once there are enough 50-symbol groups to specialise on.
  // Huffman tables and selectors.
  const nGroups = nm < 200 ? 2 : nm < 600 ? 3 : nm < 1200 ? 4 : nm < 2400 ? 5 : 6;
  const lens = Array.from({ length: nGroups }, () => new Uint8Array(alpha));
  const freq = new Int32Array(alpha);
  for (let i = 0; i < nm; i++) freq[mtf[i]]++;
  // Initial tables: split the alphabet into nGroups ranges of similar total frequency.
  {
    let remaining = nm, gs = 0;
    for (let g = nGroups; g > 0; g--) {
      const target = remaining / g;
      let ge = gs - 1, acc = 0;
      while (acc < target && ge < alpha - 1) acc += freq[++ge];
      if (ge > gs && g !== nGroups && g !== 1 && ((nGroups - g) & 1)) acc -= freq[ge--];
      const L = lens[nGroups - g];
      for (let s = 0; s < alpha; s++) L[s] = s >= gs && s <= ge ? 0 : 15;
      gs = ge + 1;
      remaining -= acc;
    }
  }
  // Four refinement passes (bzip2 uses 4 too): assign each 50-symbol group to the cheapest table, rebuild every
  // table from the symbols it won. This is k-means over groups; it converges quickly and never increases cost.
  // Max length 17 (< the format's 20) keeps the bit writer's n <= 24 precondition with margin.
  const nSel = Math.ceil(nm / 50);
  const sel = new Uint8Array(nSel);
  for (let iter = 0; iter < 4; iter++) {
    const gf = Array.from({ length: nGroups }, () => new Int32Array(alpha));
    for (let s = 0, gi = 0; s < nm; s += 50, gi++) {
      const e = Math.min(nm, s + 50);
      let best = 0, bestCost = Infinity;
      for (let g = 0; g < nGroups; g++) {
        const L = lens[g];
        let c = 0;
        for (let i = s; i < e; i++) c += L[mtf[i]];
        if (c < bestCost) { bestCost = c; best = g; }
      }
      sel[gi] = best;
      const F = gf[best];
      for (let i = s; i < e; i++) F[mtf[i]]++;
    }
    for (let g = 0; g < nGroups; g++) lens[g] = codeLengths(gf[g], alpha, 17);
  }
  const codes = lens.map((L) => canonical(L, alpha));

  // Block header.
  // Block magic is BCD pi (0x314159265359); the stream end magic below is sqrt(pi) (0x177245385090).
  // The '0' bit after the CRC is the obsolete "randomised" flag; modern decoders reject or ignore 1.
  bw.bits(0x314159, 24); bw.bits(0x265359, 24);
  bw.u32(crc);
  bw.bits(0, 1);
  bw.bits(origPtr, 24);
  // Two-level bitmap of used bytes: 16 bits say which 16-byte ranges occur, then 16 bits per present range.
  let used16 = 0;
  for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) if (inUse[i * 16 + j]) { used16 |= 1 << (15 - i); break; }
  bw.bits(used16, 16);
  for (let i = 0; i < 16; i++) {
    if (!(used16 & (1 << (15 - i)))) continue;
    let w = 0;
    for (let j = 0; j < 16; j++) if (inUse[i * 16 + j]) w |= 1 << (15 - j);
    bw.bits(w, 16);
  }
  bw.bits(nGroups, 3);
  bw.bits(nSel, 15);
  // Selectors are themselves MTF-coded and sent in unary (k ones then a zero): consecutive groups tend to reuse
  // the same table, so most selectors cost a single bit.
  const sm = Array.from({ length: nGroups }, (_, i) => i);
  for (let i = 0; i < nSel; i++) {
    const v = sel[i];
    let k = 0;
    while (sm[k] !== v) k++;
    for (let q = 0; q < k; q++) bw.bits(1, 1);
    bw.bits(0, 1);
    for (let q = k; q > 0; q--) sm[q] = sm[q - 1];
    sm[0] = v;
  }
  // Code lengths as deltas: 5-bit start, then per symbol '10' = +1, '11' = -1, '0' = next symbol.
  for (let g = 0; g < nGroups; g++) {
    const L = lens[g];
    let cur = L[0];
    bw.bits(cur, 5);
    for (let s = 0; s < alpha; s++) {
      while (cur < L[s]) { bw.bits(2, 2); cur++; }
      while (cur > L[s]) { bw.bits(3, 2); cur--; }
      bw.bits(0, 1);
    }
  }
  for (let s = 0, gi = 0; s < nm; s += 50, gi++) {
    const e = Math.min(nm, s + 50), L = lens[sel[gi]], C = codes[sel[gi]];
    for (let i = s; i < e; i++) bw.bits(C[mtf[i]], L[mtf[i]]);
  }
}

// Stream: 'BZh' + level digit, blocks, end marker, combined CRC. The level only sets the block size (and so the
// decoder's memory); compression ratio rises with it because the BWT sees more context.
export function bzip2(data, { level = 9 } = {}) {
  level = Math.max(1, Math.min(9, Math.round(level)));
  const T = crcTable();
  const bw = new BitOut((data.length >> 1) + 64);
  bw.bits(0x42, 8); bw.bits(0x5a, 8); bw.bits(0x68, 8); bw.bits(0x30 + level, 8);
  // -19 mirrors bzip2's own nblockMAX: blocks must not exceed level * 100 000 bytes *after* RLE1, and decoders
  // allocate exactly that much, so overshooting by a single byte makes the stream undecodable there.
  const limit = level * 100000 - 19;
  let combined = 0;
  for (let pos = 0; pos < data.length;) {
    const [block, n, used] = rle1(data, pos, limit);
    let c = -1;
    for (let i = pos, e = pos + used; i < e; i++) c = (c << 8) ^ T[((c >>> 24) ^ data[i]) & 0xff];
    const crc = ~c >>> 0;
    encodeBlock(bw, block, n, crc);
    // Combined stream CRC: rotate left by 1, xor the block CRC (bzip2's definition, order-dependent).
    combined = (((combined << 1) | (combined >>> 31)) ^ crc) >>> 0;
    pos += used;
  }
  bw.bits(0x177245, 24); bw.bits(0x385090, 24);
  bw.u32(combined);
  return bw.finish();
}
