// crypto/hasher.js - the common shape of every hash of the library and the Merkle-Damgard block buffering of
// MD4, MD5, SHA-1, SHA-2 and RIPEMD-160 (MD2 pads differently and buffers on its own).
//
//   hashFn(data, opts?) -> Uint8Array            one-shot (data: bytes, ArrayBuffer, typed array or UTF-8 string)
//   hashFn.create(opts?) -> { update(data) -> this, digest() -> Uint8Array, clone(), blockLen, outputLen }
//   hashFn.outputLen, hashFn.blockLen, hashFn.algo
//
// The function-with-properties shape (same as @noble/hashes) lets generic code - HMAC, PBKDF2, HKDF, UIs - take any
// hash as one value and read its block / output size without a registry. State objects are single-use: a second
// digest() throws instead of returning garbage from a padded, wiped state.
import { toBytes } from './encoding.js';

export function hasher(algo, make, blockLen, outputLen) {
  const fn = (data, opts) => make(opts).update(data).digest();
  fn.create = (opts) => make(opts);
  fn.algo = algo;
  fn.blockLen = blockLen;
  fn.outputLen = outputLen;
  return fn;
}

// Block buffering + padding: 0x80, zeros, message length in bits (64-bit, big or little endian) at the end of the
// last block. Subclasses implement process(bytes, offset) for one block and output() -> digest bytes.
// lengthBytes: 8 for 64-byte-block hashes, 16 for SHA-384/512 (a 128-bit length field). this.length counts bytes as
// a Number, so the bit length is exact up to 2^53 bits (1 PiB): far beyond anything hashed in a browser.
export class MDHasher {
  constructor(blockLen, outputLen, lengthBytes, littleEndian) {
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.lengthBytes = lengthBytes;
    this.le = littleEndian;
    this.buffer = new Uint8Array(blockLen);
    this.pos = 0;
    this.length = 0;
    this.done = false;
  }

  // Three phases: top up a partially filled buffer; compress whole blocks straight from the input (no copy - the
  // common case for large data); keep the tail. process() reads the input array at an offset, so subarray views and
  // copies are avoided on the hot path.
  update(data) {
    if (this.done) throw new Error('digest already computed');
    const d = toBytes(data);
    const n = d.length, bl = this.blockLen, buf = this.buffer;
    this.length += n;
    let i = 0;
    if (this.pos) {
      const take = Math.min(bl - this.pos, n);
      buf.set(d.subarray(0, take), this.pos);
      this.pos += take;
      i = take;
      if (this.pos === bl) { this.process(buf, 0); this.pos = 0; }
    }
    for (; i + bl <= n; i += bl) this.process(d, i);
    if (i < n) { buf.set(d.subarray(i), 0); this.pos = n - i; }
    return this;
  }

  // MD strengthening: the 0x80 byte always fits (pos < bl after update); if the length field no longer fits behind
  // it, one extra all-padding block is compressed. Big-endian hashes write the 64-bit length at bl - 8 even for
  // SHA-512's 16-byte field: its upper 8 bytes are the zeros already filled, which is the correct value for any
  // length below 2^64 bits.
  digest() {
    if (this.done) throw new Error('digest already computed');
    this.done = true;
    const bl = this.blockLen, buf = this.buffer;
    buf[this.pos++] = 0x80;
    buf.fill(0, this.pos);
    if (this.pos > bl - this.lengthBytes) { this.process(buf, 0); buf.fill(0); }
    const bits = this.length * 8;
    // hi by division, lo by >>> 0: a shift by 32 would be a no-op in JS (shift counts are mod 32).
    const hi = Math.floor(bits / 0x100000000) >>> 0, lo = bits >>> 0;
    if (this.le) {
      const o = bl - this.lengthBytes;
      buf[o] = lo; buf[o + 1] = lo >>> 8; buf[o + 2] = lo >>> 16; buf[o + 3] = lo >>> 24;
      buf[o + 4] = hi; buf[o + 5] = hi >>> 8; buf[o + 6] = hi >>> 16; buf[o + 7] = hi >>> 24;
    } else {
      const o = bl - 8;
      buf[o] = hi >>> 24; buf[o + 1] = hi >>> 16; buf[o + 2] = hi >>> 8; buf[o + 3] = hi;
      buf[o + 4] = lo >>> 24; buf[o + 5] = lo >>> 16; buf[o + 6] = lo >>> 8; buf[o + 7] = lo;
    }
    this.process(buf, 0);
    const out = this.output();
    // Wipe state and buffer: after an HMAC digest they hold key-derived material.
    this.destroy();
    return out;
  }

  // Copies the running state of another instance of the same algorithm without allocating (PBKDF2 loops).
  restoreFrom(o) {
    this.state.set(o.state); this.buffer.set(o.buffer); this.pos = o.pos; this.length = o.length; this.done = o.done;
    return this;
  }

  // Copies the running state (HMAC reuses keyed inner / outer states).
  // Generic deep-enough copy: typed arrays are sliced (state, buffer, message schedule w), scalars copied; the
  // prototype is kept so subclass methods work. Works for every subclass without per-class clone code.
  clone() {
    const c = Object.create(Object.getPrototypeOf(this));
    for (const [k, v] of Object.entries(this)) c[k] = ArrayBuffer.isView(v) ? v.slice() : v;
    return c;
  }

  destroy() { this.buffer.fill(0); if (this.state) this.state.fill(0); }
}

// Big-endian words -> bytes (first `n` bytes). Truncation by byte count implements SHA-224 / SHA-384 /
// SHA-512/t outputs from the full state. Uint8Array assignment keeps the low 8 bits, so no & 0xff is needed.
export function wordsBE(words, n) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = words[i >> 2] >>> (24 - 8 * (i & 3));
  return out;
}
// Little-endian counterpart for MD4, MD5, RIPEMD-160.
export function wordsLE(words, n) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = words[i >> 2] >>> (8 * (i & 3));
  return out;
}
