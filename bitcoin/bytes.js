// bitcoin/bytes.js - byte helpers of the Bitcoin library: a little-endian reader and writer with CompactSize
// integers, and hex in reversed byte order (txids and block hashes are displayed reversed).
//
//   new Writer().u8(n).u32(n).i32(n).u64(n).varint(n).bytes(b).varbytes(b).finish() -> Uint8Array
//   new Reader(bytes).u8() / u32() / i32() / u64() / varint() / bytes(n) / varbytes(); .pos, .left, .done()
//   reverseHex(hex), hexToBytesLE(hex) (display hex -> internal bytes), bytesToHexLE(bytes)
//   varintSize(n)
// Amounts are Numbers of satoshis (exact: 21 million BTC < 2^53); u64() throws above 2^53 - 1.
//
// Design rules:
// - Everything on the wire is little-endian (Satoshi's x86 heritage); only hashes are *displayed* reversed. Mixing the
//   two orders is the classic bug (a txid pasted into an outpoint unreversed silently names another, nonexistent coin),
//   so the reversal lives in exactly two helpers at the bottom and nowhere else.
// - Reader is strict where consensus is strict: CompactSize must be canonical (Core's ReadCompactSize throws
//   "non-canonical ReadCompactSize()"), so a tx that Core rejects does not parse here either. A lax reader would make
//   txid / wtxid differ from the bytes Core would hash (different re-serialization) and break round trips.
// - Fail fast on truncation: need() throws instead of reading undefined (which `| 0` would silently turn into 0).
// - Numbers, not BigInt, on the hot path: 32-bit ops with `>>> 0` are exact and much faster; u64 crosses to
//   Number only where the 2^53 bound is checked.
import { bytesToHex, hexToBytes } from '../crypto/encoding.js';

// Growable buffer with chainable writers. Doubling growth keeps serialization amortized O(n); a fresh Uint8Array per
// field (concatBytes everywhere) would be O(n^2) on large transactions / PSBTs.
export class Writer {
  constructor(size = 256) {
    this.buf = new Uint8Array(size);
    this.pos = 0;
  }

  ensure(n) {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + n) size *= 2;
    const b = new Uint8Array(size);
    b.set(this.buf.subarray(0, this.pos));
    this.buf = b;
  }

  u8(n) { this.ensure(1); this.buf[this.pos++] = n & 0xff; return this; }

  u16(n) { this.ensure(2); this.buf[this.pos++] = n & 0xff; this.buf[this.pos++] = (n >>> 8) & 0xff; return this; }

  u32(n) {
    this.ensure(4);
    const b = this.buf, o = this.pos;
    b[o] = n & 0xff; b[o + 1] = (n >>> 8) & 0xff; b[o + 2] = (n >>> 16) & 0xff; b[o + 3] = (n >>> 24) & 0xff;
    this.pos += 4;
    return this;
  }

  // Signed 32-bit (tx version, sighash type as Core writes it): two's complement is the same bytes as u32 of n >>> 0.
  i32(n) { return this.u32(n >>> 0); }

  // 64-bit unsigned (Number up to 2^53 - 1, or BigInt). The BigInt path exists for the one value above 2^53 that
  // Bitcoin serializes: the legacy SIGHASH_SINGLE blanked output amount -1 (0xffffffffffffffff) in tx.js.
  // Number path: % and / instead of >>> because JS bitwise ops truncate to 32 bits.
  u64(n) {
    if (typeof n === 'bigint') {
      if (n < 0n || n >= 1n << 64n) throw new Error('u64 out of range');
      return this.u32(Number(n & 0xffffffffn)).u32(Number(n >> 32n));
    }
    if (!Number.isSafeInteger(n) || n < 0) throw new Error('u64 out of range');
    return this.u32(n % 0x100000000).u32(Math.floor(n / 0x100000000));
  }

  // CompactSize: 1 byte below 0xfd, else a marker (fd / fe / ff) + 2 / 4 / 8 bytes. Always the shortest form, which
  // is what Reader.varint() demands back.
  varint(n) {
    if (n < 0xfd) return this.u8(n);
    if (n <= 0xffff) return this.u8(0xfd).u16(n);
    if (n <= 0xffffffff) return this.u8(0xfe).u32(n);
    return this.u8(0xff).u64(n);
  }

  bytes(b) { this.ensure(b.length); this.buf.set(b, this.pos); this.pos += b.length; return this; }

  varbytes(b) { return this.varint(b.length).bytes(b); }

  // slice, not subarray: the caller gets an exact-length copy that later writes cannot alias.
  finish() { return this.buf.slice(0, this.pos); }
}

// Byte length of a CompactSize, for size / weight estimates without serializing (fees.js).
export const varintSize = (n) => (n < 0xfd ? 1 : n <= 0xffff ? 3 : n <= 0xffffffff ? 5 : 9);

export class Reader {
  constructor(bytes, pos = 0) {
    this.b = bytes;
    this.pos = pos;
  }

  get left() { return this.b.length - this.pos; }

  done() { return this.pos >= this.b.length; }

  need(n) { if (this.pos + n > this.b.length) throw new Error('unexpected end of data'); }

  u8() { this.need(1); return this.b[this.pos++]; }

  u16() { this.need(2); const b = this.b, o = this.pos; this.pos += 2; return b[o] | (b[o + 1] << 8); }

  u32() {
    this.need(4);
    const b = this.b, o = this.pos;
    this.pos += 4;
    // `<< 24` lands in the sign bit; `>>> 0` reinterprets the int32 as unsigned (else nSequence 0xffffffff reads -1).
    return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  }

  i32() { return this.u32() | 0; }

  // Throws instead of rounding: a silently rounded amount would change a fee or a sighash. Use u64big() for fields
  // that may legitimately exceed 2^53 (PSBT_OUT_AMOUNT range check in psbt.js).
  u64() {
    const lo = this.u32(), hi = this.u32();
    if (hi > 0x1fffff) throw new Error('64-bit value above 2^53');
    return hi * 0x100000000 + lo;
  }

  u64big() { const lo = this.u32(), hi = this.u32(); return (BigInt(hi) << 32n) | BigInt(lo); }

  // Canonical CompactSize only (see the module rules). Note: Core additionally caps sizes at MAX_SIZE (0x02000000);
  // here an absurd length fails one step later in bytes(n) with "unexpected end of data", which is equally safe.
  varint() {
    const p = this.u8();
    if (p < 0xfd) return p;
    if (p === 0xfd) { const n = this.u16(); if (n < 0xfd) throw new Error('non-canonical CompactSize'); return n; }
    if (p === 0xfe) { const n = this.u32(); if (n <= 0xffff) throw new Error('non-canonical CompactSize'); return n; }
    const n = this.u64();
    if (n <= 0xffffffff) throw new Error('non-canonical CompactSize');
    return n;
  }

  // Zero-copy view into the input. Callers that keep the bytes beyond the parse (tx.js, psbt.js) .slice() them, so a
  // caller mutating its input buffer later cannot change an already parsed script.
  bytes(n) {
    this.need(n);
    const out = this.b.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  varbytes() { return this.bytes(this.varint()); }
}

// Reverses byte pairs of a hex string (no validation: an odd length drops the leading nibble). Used on display hex
// only; byte-level code uses hexToBytesLE / bytesToHexLE.
export function reverseHex(hex) {
  const s = String(hex);
  let out = '';
  for (let i = s.length - 2; i >= 0; i -= 2) out += s.substr(i, 2);
  return out;
}

// Display hex (txid, block hash) <-> internal byte order. Core prints uint256 as a little-endian number, i.e. the
// SHA-256d output reversed, so a block hash "looks" like it has leading zeros. Uint8Array.from copies before the
// in-place reverse(): reversing the caller's buffer would corrupt a hash still in use.
export const hexToBytesLE = (hex) => hexToBytes(hex).reverse();
export const bytesToHexLE = (b) => bytesToHex(Uint8Array.from(b).reverse());
