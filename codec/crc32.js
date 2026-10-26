// codec/crc32.js - checksums over bytes: CRC-32 (IEEE 802.3, as in zip / png / gzip) and Adler-32 (zlib).
//   crc32(bytes, start = 0, end = bytes.length, prev = 0) -> unsigned 32-bit; chain chunks with `prev`.
//   adler32(bytes, start, end, prev = 1)
//
// Both take (start, end) instead of a subarray so callers checksum a slice of a large buffer without allocating a
// view, and `prev` so streaming input chains: crc32(b, 0, n, crc32(a)) === crc32(a ++ b). Default `prev` values are
// each algorithm's identity (0 for CRC after the pre/post inversion, 1 for Adler).

// Lazy, memoised 256-entry table (1 KiB): built on first use so importing the module costs nothing.
// 0xedb88320 is the bit-reversed IEEE polynomial 0x04c11db7 - this is the reflected (LSB-first) CRC that zip/png/gzip
// use; the non-reflected form would produce different checksums for the same data.
let TABLE = null;
function table() {
  if (TABLE) return TABLE;
  TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    TABLE[n] = c >>> 0;
  }
  return TABLE;
}

// Byte-at-a-time table lookup. Pre- and post-inversion (^ 0xffffffff) are part of the standard; un-inverting `prev`
// at entry is what makes chaining work. `>>> 0` everywhere because JS bitwise results are signed 32-bit.
function crc32(bytes, start = 0, end = bytes.length, prev = 0) {
  const T = table();
  let c = (prev ^ 0xffffffff) >>> 0;
  for (let i = start; i < end; i++) c = T[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Adler-32: a = 1 + sum of bytes, b = sum of a's, both mod 65521 (largest prime < 2^16). Deferring the modulo is
// the standard speed-up (zlib uses NMAX = 5552 for 32-bit unsigned); 3800 is a more conservative block that keeps b
// under 2^31, which matters only if someone later switches to `|0` arithmetic - plain JS numbers would be exact anyway.
function adler32(bytes, start = 0, end = bytes.length, prev = 1) {
  let a = prev & 0xffff, b = (prev >>> 16) & 0xffff;
  for (let i = start; i < end;) {
    const stop = Math.min(end, i + 3800); // keeps the sums below 2^31 between reductions
    for (; i < stop; i++) { a += bytes[i]; b += a; }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

export {
  adler32,
  crc32
};
