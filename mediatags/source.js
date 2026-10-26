// mediatags/source.js - random-access byte sources and the reader flows that run on them.
//
// A source is { size, read(offset, length) -> Promise<Uint8Array> } (it may return fewer bytes at the end of the data).
// Real sources are HTTP Range requests or file reads; the helpers here wrap the usual inputs:
//
//   bytesSource(u8)                 in-memory bytes (also keeps them as `.bytes`, so readers can work synchronously)
//   blobSource(blob)                Blob / File through slice().arrayBuffer()
//   asSource(x)                     Uint8Array | ArrayBuffer | typed array | Blob | source -> source
//   cachedSource(src, { block = 65536, blocks = 64 })
//                                   block cache (LRU of `blocks` blocks): many small reads cost few real reads; adjacent
//                                   missing blocks are fetched in one read; reads larger than 4 blocks bypass the cache
//   countingSource(src)             same source plus `.stats = { reads, bytes }` (what went through it)
//
// Reader flows: the container readers are generator functions that yield [offset, length] requests and receive the
// bytes, so one parser serves both synchronous (bytes in memory) and asynchronous (source) reading:
//
//   runSync(flow, bytes) -> result           runAsync(flow, src) -> Promise<result>
//   (a read error of the source rejects runAsync; the flow is closed)

//
// Design rules:
// - Readers never assume a read returns exactly `length` bytes: short reads at EOF are normal and every consumer
//   bounds-checks. That is what lets one parser run over truncated files and over sources whose tail is missing.
// - Offsets are floored and clamped once, at this layer, so parsers can pass offsets computed from corrupt headers
//   (fractional, negative, past EOF) without a RangeError deep inside subarray.
// - Generators, not async parsers: an async parser forces every caller (tests, the in-memory path) through the
//   microtask queue; a generator only yields the I/O decision and stays agnostic of sync vs async.

// View, never copy: wraps any ArrayBufferView over the same memory, honouring byteOffset/byteLength (a pooled Node
// Buffer or a view into a larger buffer would otherwise expose foreign bytes). Only a bare ArrayBuffer gets a new view.
export const asBytes = (b) => (b instanceof Uint8Array ? b : ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b));

// Clamped subarray: NaN / negative / huge offsets from corrupt length fields yield an empty or shortened view.
function slice(b, offset, length) {
  const s = Math.max(0, Math.min(b.length, Math.floor(offset)));
  const e = Math.max(s, Math.min(b.length, Math.floor(offset + length)));
  return b.subarray(s, e);
}

// `.bytes` is the escape hatch for synchronous readers; cachedSource also skips such a source (memory reads are free).
/** Source over bytes in memory. */
export function bytesSource(input) {
  const b = asBytes(input);
  return { size: b.length, bytes: b, read: async (offset, length) => slice(b, offset, length) };
}

// Blob.slice is lazy and O(1); only arrayBuffer() touches storage, so a multi-GB File read in small pieces is never
// loaded whole. The explicit e <= s check avoids an awaited zero-length read.
/** Source over a Blob or File. */
export function blobSource(blob) {
  return {
    size: blob.size,
    blob,
    async read(offset, length) {
      const s = Math.max(0, Math.min(blob.size, Math.floor(offset)));
      const e = Math.max(s, Math.min(blob.size, Math.floor(offset + length)));
      if (e <= s) return new Uint8Array(0);
      return new Uint8Array(await blob.slice(s, e).arrayBuffer());
    },
  };
}

// Duck typing, not instanceof Blob: works across realms (iframes, workers, Node's Blob) and accepts user-made sources.
// Order matters: an object with read+size is taken as a source before the Blob test, so it is never re-wrapped.
/** Uint8Array | ArrayBuffer | typed array | Blob | source -> source. */
export function asSource(x) {
  if (x == null) throw new TypeError('mediatags: no input');
  if (x instanceof Uint8Array || ArrayBuffer.isView(x) || x instanceof ArrayBuffer) return bytesSource(x);
  if (typeof x.read === 'function' && typeof x.size === 'number') return x;
  if (typeof x.slice === 'function' && typeof x.size === 'number' && typeof x.arrayBuffer === 'function') return blobSource(x);
  throw new TypeError('mediatags: not a byte source');
}

// One part is returned as-is (no copy): the common case of a read inside a single cached block.
function concat(parts) {
  if (parts.length === 1) return parts[0];
  let n = 0;
  for (const x of parts) n += x.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const x of parts) { out.set(x, o); o += x.length; }
  return out;
}

// The cache stores Promises, not bytes: two concurrent reads of one block share a single in-flight request (a byte
// cache would miss until the first resolves and issue a duplicate). A rejected block promise evicts itself, but only
// if it is still the cached entry, so a transient network error is retried next time instead of poisoning the cache.
// LRU through Map insertion order: delete+set moves a key to the end, eviction takes keys().next() (the oldest); O(1)
// with no linked list. The floor of 4 blocks stops a tiny cache from thrashing (eviction mid-read is still
// safe: `wanted` already holds the promises).
// Reads > 4 blocks bypass the cache: a large read (cover art) would otherwise flush the hot header blocks.
/** Block cache in front of a source (see the header). */
export function cachedSource(src, { block = 65536, blocks = 64 } = {}) {
  if (src.cached || src.bytes) return src;
  const cache = new Map(); // block index -> Promise<Uint8Array>
  const put = (i, p) => {
    cache.delete(i);
    cache.set(i, p);
    while (cache.size > Math.max(blocks, 4)) cache.delete(cache.keys().next().value);
  };
  async function read(offset, length) {
    const start = Math.max(0, Math.floor(offset));
    const end = Math.min(src.size, Math.floor(offset + length));
    if (end <= start) return new Uint8Array(0);
    if (end - start > block * 4) return asBytes(await src.read(start, end - start));
    const first = Math.floor(start / block), last = Math.floor((end - 1) / block);
    const wanted = [];
    for (let i = first; i <= last;) {
      if (cache.has(i)) { const p = cache.get(i); put(i, p); wanted.push(p); i++; continue; }
      // Coalesce consecutive missing blocks into one real read: round-trips (HTTP Range) dominate the cost, not bytes.
      let j = i;
      while (j + 1 <= last && !cache.has(j + 1)) j++;
      const runFirst = i, runStart = i * block;
      const run = Promise.resolve(src.read(runStart, Math.min(src.size, (j + 1) * block) - runStart)).then(asBytes);
      for (let k = i; k <= j; k++) {
        const p = run.then((b) => b.subarray((k - runFirst) * block, (k - runFirst + 1) * block));
        p.catch(() => { if (cache.get(k) === p) cache.delete(k); });
        put(k, p);
        wanted.push(p);
      }
      i = j + 1;
    }
    // `wanted` is contiguous from block `first`, so the concatenation starts at first*block; a short last block at EOF
    // is harmless because `end` was clamped to src.size.
    const parts = await Promise.all(wanted);
    const all = concat(parts);
    return all.subarray(start - first * block, end - first * block);
  }
  return { size: src.size, cached: true, source: src, read };
}

/** Source wrapper that counts reads and bytes: `.stats = { reads, bytes }`. */
export function countingSource(src) {
  const stats = { reads: 0, bytes: 0 };
  return {
    size: src.size,
    stats,
    async read(offset, length) {
      const b = asBytes(await src.read(offset, length));
      stats.reads++;
      stats.bytes += b.length;
      return b;
    },
  };
}

// Synchronous driver: every yielded [offset, length] is answered with a clamped subarray (zero copy).
/** Runs a reader flow over bytes in memory. */
export function runSync(flow, bytes) {
  const b = asBytes(bytes);
  let r = flow.next();
  while (!r.done) r = flow.next(slice(b, r.value[0], r.value[1]));
  return r.value;
}

// Async driver. Clamps each request to the source size first (a source may reject reads past EOF), trims an over-long
// answer (a sloppy source must not hand a parser more than it asked for), and on a read error calls flow.return() so
// the generator's finally blocks run before the error propagates. flow.throw() is avoided on purpose: parsers would
// then need try/catch around every yield.
/** Runs a reader flow over a source. */
export async function runAsync(flow, src) {
  let r = flow.next();
  while (!r.done) {
    const [offset, length] = r.value;
    let b;
    try {
      const s = Math.max(0, Math.floor(offset));
      const n = Math.max(0, Math.min(src.size, Math.floor(offset + length)) - s);
      b = n ? asBytes(await src.read(s, n)) : new Uint8Array(0);
      if (b.length > n) b = b.subarray(0, n);
    } catch (e) {
      flow.return();
      throw e;
    }
    r = flow.next(b);
  }
  return r.value;
}
