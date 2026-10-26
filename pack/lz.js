// pack/lz.js - LZ77 match finder shared by the LZMA and Zstandard encoders: hash chains over 3-byte prefixes in a
// sliding window of the input (the whole input is in memory; positions are inserted in order).
//
//   const m = new Matcher(data, { window, depth, nice });
//   m.skipTo(i)            inserts every position below i
//   m.find(i, maxLen, minLen = 3) -> length (0 when shorter than minLen); m.dist = distance (i - match position)

// DESIGN. Classic zlib-style hash chains: head[h] = most recent position with hash h, prev[pos & wmask] = the
// previous position with the same hash. Chosen over binary trees (xz's bt4) for simplicity and predictable cost:
// 'depth' bounds the walk, so the worst case (long runs of one byte, every position colliding) is O(n * depth)
// rather than quadratic. Positions are inserted strictly in order (skipTo), which lets the ring buffer 'prev' be
// sized to the window: an entry older than the window has been overwritten, and the walk stops at 'low' before
// it could follow such a stale link.
export class Matcher {
  constructor(data, { window = 1 << 22, depth = 32, nice = 64, hashBits = 17 } = {}) {
    this.d = data;
    this.n = data.length;
    this.window = Math.min(window, 1 << 26);
    // Ring size: the next power of two >= min(window, n), so small inputs do not allocate a 64 MiB table for a
    // level 9 dictionary. 1 << 26 caps the window at 64 MiB (LZMA level 9 dictionary).
    this.wmask = (1 << Math.ceil(Math.log2(Math.max(2, Math.min(this.window, this.n || 1))))) - 1;
    this.prev = new Int32Array(this.wmask + 1);
    this.hbits = hashBits;
    this.head = new Int32Array(1 << hashBits).fill(-1);
    this.depth = depth;
    this.nice = nice;
    this.next = 0;
    this.dist = 0;
  }
  // Multiplicative (Fibonacci) hash of 3 bytes, top hbits bits: the high bits of the product mix all input bits,
  // the low bits do not. Requires i + 2 < n (skipTo and find guarantee it).
  hash(i) { const d = this.d; return (Math.imul((d[i] | (d[i + 1] << 8) | (d[i + 2] << 16)), 0x9e3779b1) >>> (32 - this.hbits)); }
  // Inserts positions [next, end). Positions within 2 bytes of the end have no full 3-byte prefix and are skipped;
  // they could only start matches shorter than 3, which no caller wants.
  skipTo(end) {
    const lim = Math.min(end, this.n - 2);
    for (let i = this.next; i < lim; i++) { const h = this.hash(i); this.prev[i & this.wmask] = this.head[h]; this.head[h] = i; }
    if (end > this.next) this.next = end;
  }
  // Longest match at i among the last 'depth' chain entries; stops early at 'nice' (good enough, as in zlib) or
  // maxLen. Returns 0 below minLen. Callers that inspect i + 1 (lazy evaluation) may call find out of order only
  // forwards: skipTo never removes positions.
  find(i, maxLen, minLen = 3) {
    this.skipTo(i);
    const d = this.d, n = this.n;
    if (i + 3 > n) return 0;
    maxLen = Math.min(maxLen, n - i);
    if (maxLen < minLen) return 0;
    const low = Math.max(0, i - Math.min(this.window, this.wmask + 1) + 1);
    let j = this.head[this.hash(i)], best = minLen - 1, bestDist = 0, chain = this.depth;
    while (j >= low && j < i && chain-- > 0) {
      // Cheap rejection first: a candidate can only beat 'best' if it matches at offset best, and the hash may
      // collide, so bytes 0 and 1 are checked too before the full scan.
      if (d[j + best] === d[i + best] && d[j] === d[i] && d[j + 1] === d[i + 1]) {
        let l = 0;
        while (l < maxLen && d[j + l] === d[i + l]) l++;
        if (l > best) { best = l; bestDist = i - j; if (l >= this.nice || l >= maxLen) break; }
      }
      const p = this.prev[j & this.wmask];
      // Chains must go strictly backwards; p >= j means the slot was reused by a newer position (ring wrapped).
      if (p >= j) break;
      j = p;
    }
    this.dist = bestDist;
    return best >= minLen ? best : 0;
  }
}

/** Length of the common run of data at i and i - dist (up to maxLen). */
export function matchLen(d, i, dist, maxLen) {
  const j = i - dist;
  if (j < 0) return 0;
  maxLen = Math.min(maxLen, d.length - i);
  let l = 0;
  while (l < maxLen && d[j + l] === d[i + l]) l++;
  return l;
}
