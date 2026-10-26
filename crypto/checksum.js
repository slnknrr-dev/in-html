// crypto/checksum.js - non-cryptographic checksums with the hash interface of the library (hasher.js), built on
// codec/crc32.js: CRC-32 (zip, gzip, png; big-endian digest as printed by tools) and Adler-32 (zlib).
//
// Same shape as the hashes so UIs can list them side by side, but flagged `checksum = true`: they detect accidental
// corruption only. Both are linear / trivially forgeable, so hmac.js refuses them as the underlying function.
import { adler32 as adlerFn, crc32 as crcFn } from '../codec/crc32.js';
import { toBytes } from './encoding.js';

// Running value + the codec function fn(bytes, start, end, previous) -> next value: the codec already supports
// continuation, so streaming needs no buffering. blockLen 1: there is no block structure.
class Running {
  constructor(fn, init) { this.fn = fn; this.value = init; this.blockLen = 1; this.outputLen = 4; this.done = false; }
  update(data) {
    if (this.done) throw new Error('digest already computed');
    const d = toBytes(data);
    this.value = this.fn(d, 0, d.length, this.value);
    return this;
  }
  // Big-endian bytes: the order in which `crc32` / `sha1sum`-style tools print the value as 8 hex digits (zip and
  // gzip store CRC-32 little-endian on disk; that byte order is the container's business, not this digest's).
  digest() {
    this.done = true;
    const v = this.value;
    return new Uint8Array([v >>> 24, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);
  }
  restoreFrom(o) { this.value = o.value; this.done = o.done; return this; }
  clone() { const c = new Running(this.fn, this.value); c.done = this.done; return c; }
}

// Initial values: CRC-32 0 (codec/crc32.js applies the standard ~ pre / post conditioning internally), Adler-32 1
// (RFC 1950: a = 1, b = 0).
const make = (algo, fn, init) => {
  const h = (data) => new Running(fn, init).update(data).digest();
  h.create = () => new Running(fn, init);
  h.algo = algo;
  h.blockLen = 1;
  h.outputLen = 4;
  h.checksum = true;
  return h;
};

export const crc32 = make('crc32', crcFn, 0);
export const adler32 = make('adler32', adlerFn, 1);
