// crypto/chacha.js - ChaCha20 (RFC 8439; 12-byte nonce with 32-bit counter, or the original 8-byte nonce with 64-bit
// counter), HChaCha20 / XChaCha20 (24-byte nonce), Poly1305, and the AEADs ChaCha20-Poly1305 / XChaCha20-Poly1305.
//
//   new ChaCha20(key, nonce, counter = 0) .update(chunk) -> xored bytes (stream position carries over)
//   chacha20(key, nonce, data, counter = 0), xchacha20(key, nonce24, data, counter = 0), hchacha20(key, nonce16) -> 32 bytes
//   poly1305(key32, msg) -> tag16; new Poly1305(key32).update(chunk).digest()
//   chacha20poly1305Encrypt(key, nonce12, plaintext, aad) -> ciphertext || tag; ...Decrypt(...) throws on a bad tag
//   xchacha20poly1305Encrypt / Decrypt (nonce24); streaming: new ChaCha20Poly1305(key, nonce, { decrypt, aad })
//     .update / .final / .getTag / .setTag like aes.js (the nonce length picks ChaCha20 or XChaCha20)
//
// Security notes:
// - ChaCha20 is pure ARX (add, rotate, xor on 32-bit words): no tables, no data-dependent branches, so unlike aes.js
//   it is constant time by construction (modulo JIT caveats). Poly1305 here uses doubles; see its note below.
// - Nonce reuse under one key is fatal for both the stream (XOR of plaintexts) and Poly1305 (the one-time key repeats,
//   tags become forgeable). 12-byte nonces must be counters or carefully managed; 24-byte XChaCha20 nonces are safe
//   to draw at random (birthday bound 2^96).
// - Little-endian throughout: key, nonce, counter words and keystream bytes (RFC 8439 2.3); Poly1305 numbers are
//   little-endian 128-bit; the AEAD length block is two little-endian u64.
// Reference vectors: RFC 8439 sections 2.3.2 (block), 2.4.2 (cipher), 2.5.2 (Poly1305), 2.8.2 (AEAD); XChaCha20 in
// draft-irtf-cfrg-xchacha A.3. Test gap: no test file in this repository checks them yet (crypto/test.js covers
// MD2/4/5, SHA-256, Base58Check, secp256k1, the strength estimator and the generator).
import { concatBytes, equalBytes, toBytes, wipe } from './encoding.js';

const le32 = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);

// 20 rounds over the 16-word state s into x (feed-forward added when `add`).
// Each loop iteration is a double round: four column quarter rounds (0,4,8,12) ... then four diagonal ones
// (0,5,10,15) ... with rotations 16, 12, 8, 7. Unrolled into 16 locals so the JIT keeps the state in registers.
// add = false is HChaCha20: it outputs words 0..3 and 12..15 of the bare permutation. Those are the positions of the
// public constants and nonce, where a feed-forward would add only known values (anyone could subtract them), so
// omitting it costs no security; the key positions, whose feed-forward would matter, are not output at all.
// The feed-forward additions may exceed int32; storing into the Int32Array x wraps them mod 2^32.
function core(s, x, add) {
  let x0 = s[0], x1 = s[1], x2 = s[2], x3 = s[3], x4 = s[4], x5 = s[5], x6 = s[6], x7 = s[7];
  let x8 = s[8], x9 = s[9], x10 = s[10], x11 = s[11], x12 = s[12], x13 = s[13], x14 = s[14], x15 = s[15];
  for (let i = 0; i < 20; i += 2) {
    x0 = (x0 + x4) | 0; x12 ^= x0; x12 = (x12 << 16) | (x12 >>> 16);
    x8 = (x8 + x12) | 0; x4 ^= x8; x4 = (x4 << 12) | (x4 >>> 20);
    x0 = (x0 + x4) | 0; x12 ^= x0; x12 = (x12 << 8) | (x12 >>> 24);
    x8 = (x8 + x12) | 0; x4 ^= x8; x4 = (x4 << 7) | (x4 >>> 25);
    x1 = (x1 + x5) | 0; x13 ^= x1; x13 = (x13 << 16) | (x13 >>> 16);
    x9 = (x9 + x13) | 0; x5 ^= x9; x5 = (x5 << 12) | (x5 >>> 20);
    x1 = (x1 + x5) | 0; x13 ^= x1; x13 = (x13 << 8) | (x13 >>> 24);
    x9 = (x9 + x13) | 0; x5 ^= x9; x5 = (x5 << 7) | (x5 >>> 25);
    x2 = (x2 + x6) | 0; x14 ^= x2; x14 = (x14 << 16) | (x14 >>> 16);
    x10 = (x10 + x14) | 0; x6 ^= x10; x6 = (x6 << 12) | (x6 >>> 20);
    x2 = (x2 + x6) | 0; x14 ^= x2; x14 = (x14 << 8) | (x14 >>> 24);
    x10 = (x10 + x14) | 0; x6 ^= x10; x6 = (x6 << 7) | (x6 >>> 25);
    x3 = (x3 + x7) | 0; x15 ^= x3; x15 = (x15 << 16) | (x15 >>> 16);
    x11 = (x11 + x15) | 0; x7 ^= x11; x7 = (x7 << 12) | (x7 >>> 20);
    x3 = (x3 + x7) | 0; x15 ^= x3; x15 = (x15 << 8) | (x15 >>> 24);
    x11 = (x11 + x15) | 0; x7 ^= x11; x7 = (x7 << 7) | (x7 >>> 25);
    x0 = (x0 + x5) | 0; x15 ^= x0; x15 = (x15 << 16) | (x15 >>> 16);
    x10 = (x10 + x15) | 0; x5 ^= x10; x5 = (x5 << 12) | (x5 >>> 20);
    x0 = (x0 + x5) | 0; x15 ^= x0; x15 = (x15 << 8) | (x15 >>> 24);
    x10 = (x10 + x15) | 0; x5 ^= x10; x5 = (x5 << 7) | (x5 >>> 25);
    x1 = (x1 + x6) | 0; x12 ^= x1; x12 = (x12 << 16) | (x12 >>> 16);
    x11 = (x11 + x12) | 0; x6 ^= x11; x6 = (x6 << 12) | (x6 >>> 20);
    x1 = (x1 + x6) | 0; x12 ^= x1; x12 = (x12 << 8) | (x12 >>> 24);
    x11 = (x11 + x12) | 0; x6 ^= x11; x6 = (x6 << 7) | (x6 >>> 25);
    x2 = (x2 + x7) | 0; x13 ^= x2; x13 = (x13 << 16) | (x13 >>> 16);
    x8 = (x8 + x13) | 0; x7 ^= x8; x7 = (x7 << 12) | (x7 >>> 20);
    x2 = (x2 + x7) | 0; x13 ^= x2; x13 = (x13 << 8) | (x13 >>> 24);
    x8 = (x8 + x13) | 0; x7 ^= x8; x7 = (x7 << 7) | (x7 >>> 25);
    x3 = (x3 + x4) | 0; x14 ^= x3; x14 = (x14 << 16) | (x14 >>> 16);
    x9 = (x9 + x14) | 0; x4 ^= x9; x4 = (x4 << 12) | (x4 >>> 20);
    x3 = (x3 + x4) | 0; x14 ^= x3; x14 = (x14 << 8) | (x14 >>> 24);
    x9 = (x9 + x14) | 0; x4 ^= x9; x4 = (x4 << 7) | (x4 >>> 25);
  }
  if (add) {
    x0 += s[0]; x1 += s[1]; x2 += s[2]; x3 += s[3]; x4 += s[4]; x5 += s[5]; x6 += s[6]; x7 += s[7];
    x8 += s[8]; x9 += s[9]; x10 += s[10]; x11 += s[11]; x12 += s[12]; x13 += s[13]; x14 += s[14]; x15 += s[15];
  }
  x[0] = x0; x[1] = x1; x[2] = x2; x[3] = x3; x[4] = x4; x[5] = x5; x[6] = x6; x[7] = x7;
  x[8] = x8; x[9] = x9; x[10] = x10; x[11] = x11; x[12] = x12; x[13] = x13; x[14] = x14; x[15] = x15;
}

const SIGMA = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]; // "expand 32-byte k"

// State layout (RFC 8439 2.3): words 0..3 constants, 4..11 key (little-endian), 12..15 counter + nonce. Only
// 256-bit keys: the 128-bit "expand 16-byte k" variant is deprecated and absent from the RFC.
function initState(key) {
  const k = toBytes(key);
  if (k.length !== 32) throw new Error('ChaCha20 key must be 32 bytes');
  const s = new Int32Array(16);
  s.set(SIGMA);
  for (let i = 0; i < 8; i++) s[4 + i] = le32(k, 4 * i);
  return s;
}

export function hchacha20(key, nonce16) {
  const n = toBytes(nonce16);
  if (n.length !== 16) throw new Error('HChaCha20 nonce must be 16 bytes');
  const s = initState(key), x = new Int32Array(16);
  for (let i = 0; i < 4; i++) s[12 + i] = le32(n, 4 * i);
  core(s, x, false);
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    const w = x[i < 4 ? i : i + 8];
    out[4 * i] = w; out[4 * i + 1] = w >>> 8; out[4 * i + 2] = w >>> 16; out[4 * i + 3] = w >>> 24;
  }
  wipe(s, x);
  return out;
}

export class ChaCha20 {
  // nonce 12 bytes: 32-bit block counter (RFC 8439); 8 bytes: 64-bit counter (original); 24 bytes: XChaCha20.
  constructor(key, nonce, counter = 0) {
    let n = toBytes(nonce), k = toBytes(key);
    // XChaCha20: subkey = HChaCha20(key, nonce[0..16)), then IETF ChaCha20 with nonce 0x00000000 || nonce[16..24).
    // KNOWN DEFECT (hygiene, minor): the derived subkey k is not wiped after initState copies it into the state.
    // Fix: wipe(k) after initState when n.length was 24 (k is then this module's own buffer, never the caller's).
    if (n.length === 24) { k = hchacha20(k, n.subarray(0, 16)); n = concatBytes(new Uint8Array(4), n.subarray(16)); }
    const s = initState(k);
    if (n.length === 12) {
      s[12] = counter | 0;
      for (let i = 0; i < 3; i++) s[13 + i] = le32(n, 4 * i);
      this.wide = false;
    } else if (n.length === 8) {
      s[12] = counter >>> 0;
      s[13] = Math.floor(counter / 0x100000000);
      s[14] = le32(n, 0); s[15] = le32(n, 4);
      this.wide = true;
    } else throw new Error('ChaCha20 nonce must be 8, 12 or 24 bytes');
    this.s = s;
    this.x = new Int32Array(16);
    // Keystream bytes are read straight from the output words' memory (no per-byte serialisation); next() byte-swaps
    // on big-endian platforms so the view always yields little-endian keystream. pos = 64: no keystream buffered yet.
    this.ks = new Uint8Array(this.x.buffer);
    this.pos = 64;
  }

  next() {
    core(this.s, this.x, true);
    // Little-endian platforms: the Int32Array bytes are the keystream bytes.
    if (!LE) for (let i = 0; i < 16; i++) { const w = this.x[i]; this.x[i] = ((w & 0xff) << 24) | ((w & 0xff00) << 8) | ((w >>> 8) & 0xff00) | (w >>> 24); }
    // Counter: 64-bit (words 12, 13) for 8-byte nonces; 32-bit for 12-byte nonces, where wrapping would reuse
    // keystream (2^32 blocks = 256 GiB per nonce), so it throws instead.
    // KNOWN DEFECT (off by one, harmless in practice): the throw fires right after block 2^32 - 1 is generated but
    // before it is used, so the last legal block of a nonce is unusable (256 GiB - 64 bytes is the real limit).
    // Fix: detect the wrap on the next call (a `exhausted` flag) instead of eagerly.
    const s = this.s;
    s[12] = (s[12] + 1) | 0;
    if (this.wide && s[12] === 0) s[13] = (s[13] + 1) | 0;
    else if (!this.wide && s[12] === 0) throw new Error('ChaCha20 counter overflow');
    this.pos = 0;
  }

  update(chunk) {
    const d = toBytes(chunk), n = d.length, out = new Uint8Array(n), ks = this.ks;
    let i = 0;
    while (i < n && this.pos < 64) out[i] = d[i++] ^ ks[this.pos++];
    for (; i + 64 <= n; i += 64) {
      this.next();
      for (let j = 0; j < 64; j++) out[i + j] = d[i + j] ^ ks[j];
      this.pos = 64;
    }
    while (i < n) {
      if (this.pos === 64) this.next();
      out[i] = d[i++] ^ ks[this.pos++];
    }
    return out;
  }

  keystream(n) { return this.update(new Uint8Array(n)); }
  final() { this.destroy(); return new Uint8Array(0); }
  destroy() { wipe(this.s, this.x); }
}

// Platform byte order, probed once. Declared after the class: safe, because it is only read inside next(), which
// cannot run before module evaluation has finished.
const LE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

export const chacha20 = (key, nonce, data, counter = 0) => new ChaCha20(key, nonce, counter).update(data);
export const xchacha20 = (key, nonce24, data, counter = 0) => {
  if (toBytes(nonce24).length !== 24) throw new Error('XChaCha20 nonce must be 24 bytes');
  return new ChaCha20(key, nonce24, counter).update(data);
};

// --- Poly1305: 130-bit accumulator in ten 13-bit limbs (products stay far below 2^53) ------------
// tag = ((sum of m_i * r^(n-i+1)) mod 2^130 - 5) + s mod 2^128, r clamped, s the second key half.
// Why 13-bit limbs in doubles (the poly1305-donna-16 / tweetnacl-js layout): a limb product is < 2^26 and a row of
// ten products plus 5x wrap terms stays < 2^35, exact in a double, so no BigInt and no 64-bit emulation. Reduction
// mod 2^130 - 5 uses 2^130 = 5: high limbs fold back multiplied by 5 (the s1..s9 = 5 * r precomputation).
// Timing: Math.floor and float multiplies are not guaranteed constant time across CPUs; the final carry loop in
// digest() runs a data-dependent number of times. Leaks concern the one-time key r of a single message only.

export class Poly1305 {
  constructor(key) {
    const k = toBytes(key);
    if (k.length !== 32) throw new Error('Poly1305 key must be 32 bytes');
    const c = k.slice(0, 16);
    // Clamping (RFC 8439 2.5): top 4 bits of bytes 3, 7, 11, 15 and bottom 2 bits of 4, 8, 12 cleared - keeps the
    // limb products small for implementations like this one, and is part of the security proof.
    c[3] &= 15; c[7] &= 15; c[11] &= 15; c[15] &= 15; c[4] &= 252; c[8] &= 252; c[12] &= 252; // clamp r
    this.r = limbs(c, 0, 0, new Float64Array(10));
    this.h = new Float64Array(10);
    this.pad = new Uint16Array(8);
    for (let i = 0; i < 8; i++) this.pad[i] = k[16 + 2 * i] | (k[17 + 2 * i] << 8);
    this.buf = new Uint8Array(16);
    this.pos = 0;
  }

  // Whole 16-byte blocks of m[o, end): h = (h + block + hibit * 2^128) * r mod 2^130 - 5, with the accumulator in
  // locals; carries via multiplication by 2^-13 (limb sums stay below 2^35, exact in doubles).
  blocks(m, o, end, hibit) {
    const r = this.r, h = this.h, K = 1 / 8192;
    const r0 = r[0], r1 = r[1], r2 = r[2], r3 = r[3], r4 = r[4], r5 = r[5], r6 = r[6], r7 = r[7], r8 = r[8], r9 = r[9];
    const s1 = 5 * r1, s2 = 5 * r2, s3 = 5 * r3, s4 = 5 * r4, s5 = 5 * r5, s6 = 5 * r6, s7 = 5 * r7, s8 = 5 * r8, s9 = 5 * r9;
    let h0 = h[0], h1 = h[1], h2 = h[2], h3 = h[3], h4 = h[4], h5 = h[5], h6 = h[6], h7 = h[7], h8 = h[8], h9 = h[9];
    for (; o + 16 <= end; o += 16) {
      const t0 = m[o] | (m[o + 1] << 8), t1 = m[o + 2] | (m[o + 3] << 8), t2 = m[o + 4] | (m[o + 5] << 8), t3 = m[o + 6] | (m[o + 7] << 8);
      const t4 = m[o + 8] | (m[o + 9] << 8), t5 = m[o + 10] | (m[o + 11] << 8), t6 = m[o + 12] | (m[o + 13] << 8), t7 = m[o + 14] | (m[o + 15] << 8);
      h0 += t0 & 0x1fff;
      h1 += ((t0 >>> 13) | (t1 << 3)) & 0x1fff;
      h2 += ((t1 >>> 10) | (t2 << 6)) & 0x1fff;
      h3 += ((t2 >>> 7) | (t3 << 9)) & 0x1fff;
      h4 += ((t3 >>> 4) | (t4 << 12)) & 0x1fff;
      h5 += (t4 >>> 1) & 0x1fff;
      h6 += ((t4 >>> 14) | (t5 << 2)) & 0x1fff;
      h7 += ((t5 >>> 11) | (t6 << 5)) & 0x1fff;
      h8 += ((t6 >>> 8) | (t7 << 8)) & 0x1fff;
      h9 += (t7 >>> 5) | hibit;
      const d0 = h0 * r0 + h1 * s9 + h2 * s8 + h3 * s7 + h4 * s6 + h5 * s5 + h6 * s4 + h7 * s3 + h8 * s2 + h9 * s1;
      const d1 = h0 * r1 + h1 * r0 + h2 * s9 + h3 * s8 + h4 * s7 + h5 * s6 + h6 * s5 + h7 * s4 + h8 * s3 + h9 * s2;
      const d2 = h0 * r2 + h1 * r1 + h2 * r0 + h3 * s9 + h4 * s8 + h5 * s7 + h6 * s6 + h7 * s5 + h8 * s4 + h9 * s3;
      const d3 = h0 * r3 + h1 * r2 + h2 * r1 + h3 * r0 + h4 * s9 + h5 * s8 + h6 * s7 + h7 * s6 + h8 * s5 + h9 * s4;
      const d4 = h0 * r4 + h1 * r3 + h2 * r2 + h3 * r1 + h4 * r0 + h5 * s9 + h6 * s8 + h7 * s7 + h8 * s6 + h9 * s5;
      const d5 = h0 * r5 + h1 * r4 + h2 * r3 + h3 * r2 + h4 * r1 + h5 * r0 + h6 * s9 + h7 * s8 + h8 * s7 + h9 * s6;
      const d6 = h0 * r6 + h1 * r5 + h2 * r4 + h3 * r3 + h4 * r2 + h5 * r1 + h6 * r0 + h7 * s9 + h8 * s8 + h9 * s7;
      const d7 = h0 * r7 + h1 * r6 + h2 * r5 + h3 * r4 + h4 * r3 + h5 * r2 + h6 * r1 + h7 * r0 + h8 * s9 + h9 * s8;
      const d8 = h0 * r8 + h1 * r7 + h2 * r6 + h3 * r5 + h4 * r4 + h5 * r3 + h6 * r2 + h7 * r1 + h8 * r0 + h9 * s9;
      const d9 = h0 * r9 + h1 * r8 + h2 * r7 + h3 * r6 + h4 * r5 + h5 * r4 + h6 * r3 + h7 * r2 + h8 * r1 + h9 * r0;
      let c = Math.floor(d0 * K); h0 = d0 - c * 8192;
      let e = c; c = Math.floor((d1 + e) * K); h1 = d1 + e - c * 8192;
      e = c; c = Math.floor((d2 + e) * K); h2 = d2 + e - c * 8192;
      e = c; c = Math.floor((d3 + e) * K); h3 = d3 + e - c * 8192;
      e = c; c = Math.floor((d4 + e) * K); h4 = d4 + e - c * 8192;
      e = c; c = Math.floor((d5 + e) * K); h5 = d5 + e - c * 8192;
      e = c; c = Math.floor((d6 + e) * K); h6 = d6 + e - c * 8192;
      e = c; c = Math.floor((d7 + e) * K); h7 = d7 + e - c * 8192;
      e = c; c = Math.floor((d8 + e) * K); h8 = d8 + e - c * 8192;
      e = c; c = Math.floor((d9 + e) * K); h9 = d9 + e - c * 8192;
      h0 += c * 5; c = Math.floor(h0 * K); h0 -= c * 8192; h1 += c;
    }
    h[0] = h0; h[1] = h1; h[2] = h2; h[3] = h3; h[4] = h4; h[5] = h5; h[6] = h6; h[7] = h7; h[8] = h8; h[9] = h9;
  }

  update(chunk) {
    const d = toBytes(chunk);
    let i = 0;
    if (this.pos) {
      while (this.pos < 16 && i < d.length) this.buf[this.pos++] = d[i++];
      if (this.pos < 16) return this;
      this.blocks(this.buf, 0, 16, 1 << 11);
      this.pos = 0;
    }
    const whole = i + ((d.length - i) & ~15);
    this.blocks(d, i, whole, 1 << 11);
    i = whole;
    while (i < d.length) this.buf[this.pos++] = d[i++];
    return this;
  }

  // A partial last block is padded with a single 1 byte then zeros and processed with hibit 0 (the 1 is inside the
  // 16 bytes instead of at bit 128). Single use: r, h and the pad are zeroed afterwards.
  digest() {
    if (this.pos) {
      this.buf[this.pos] = 1;
      this.buf.fill(0, this.pos + 1);
      this.blocks(this.buf, 0, 16, 0);
    }
    const h = Array.from(this.h), g = new Array(10);
    // Carry until every limb is below 2^13 (h < 2^130 < 2p afterwards, so h mod p is h or h - p).
    let c;
    do {
      c = 0;
      for (let i = 0; i < 10; i++) { h[i] += c; c = Math.floor(h[i] / 8192); h[i] -= c * 8192; }
      h[0] += c * 5;
    } while (c);
    // g = h + 5 - 2^130; take g when h + 5 carries out of 2^130 (h >= p)
    g[0] = h[0] + 5; c = g[0] >>> 13; g[0] &= 0x1fff;
    for (let i = 1; i < 10; i++) { g[i] = h[i] + c; c = g[i] >>> 13; g[i] &= 0x1fff; }
    // Branch-free select: mask is all ones (-1) or zero, so h vs g is chosen without a data-dependent branch.
    const mask = -c; // c = 1 when h + 5 >= 2^130
    for (let i = 0; i < 10; i++) h[i] = (h[i] & ~mask) | (g[i] & mask);
    // pack into 16-bit words and add the pad mod 2^128
    const w = [
      (h[0] | (h[1] << 13)) & 0xffff, ((h[1] >>> 3) | (h[2] << 10)) & 0xffff, ((h[2] >>> 6) | (h[3] << 7)) & 0xffff,
      ((h[3] >>> 9) | (h[4] << 4)) & 0xffff, ((h[4] >>> 12) | (h[5] << 1) | (h[6] << 14)) & 0xffff,
      ((h[6] >>> 2) | (h[7] << 11)) & 0xffff, ((h[7] >>> 5) | (h[8] << 8)) & 0xffff, ((h[8] >>> 8) | (h[9] << 5)) & 0xffff,
    ];
    const out = new Uint8Array(16);
    let f = 0;
    for (let i = 0; i < 8; i++) {
      f = w[i] + this.pad[i] + (f >>> 16);
      out[2 * i] = f; out[2 * i + 1] = f >>> 8;
    }
    this.h.fill(0); this.r.fill(0); this.pad.fill(0);
    return out;
  }
}

// 16 bytes (little endian) -> ten 13-bit limbs; hibit = 2^128 marker (limb 9 bit 11) for full blocks.
function limbs(b, o, hibit, x) {
  const t0 = b[o] | (b[o + 1] << 8), t1 = b[o + 2] | (b[o + 3] << 8), t2 = b[o + 4] | (b[o + 5] << 8), t3 = b[o + 6] | (b[o + 7] << 8);
  const t4 = b[o + 8] | (b[o + 9] << 8), t5 = b[o + 10] | (b[o + 11] << 8), t6 = b[o + 12] | (b[o + 13] << 8), t7 = b[o + 14] | (b[o + 15] << 8);
  x[0] = t0 & 0x1fff;
  x[1] = ((t0 >>> 13) | (t1 << 3)) & 0x1fff;
  x[2] = ((t1 >>> 10) | (t2 << 6)) & 0x1fff;
  x[3] = ((t2 >>> 7) | (t3 << 9)) & 0x1fff;
  x[4] = ((t3 >>> 4) | (t4 << 12)) & 0x1fff;
  x[5] = (t4 >>> 1) & 0x1fff;
  x[6] = ((t4 >>> 14) | (t5 << 2)) & 0x1fff;
  x[7] = ((t5 >>> 11) | (t6 << 5)) & 0x1fff;
  x[8] = ((t6 >>> 8) | (t7 << 8)) & 0x1fff;
  x[9] = (t7 >>> 5) | hibit;
  return x;
}

export const poly1305 = (key, msg) => new Poly1305(key).update(msg).digest();

// --- AEAD (RFC 8439 2.8; XChaCha20 variant of draft-irtf-cfrg-xchacha) ---------------------------

// MAC input (RFC 8439 2.8): AAD || pad16 || ciphertext || pad16 || le64(len AAD) || le64(len ciphertext). The
// Poly1305 key is the first 32 bytes of keystream block 0; encryption starts at block 1, so the MAC key is never
// reused as keystream. The tag covers the ciphertext (encrypt-then-MAC).
export class ChaCha20Poly1305 {
  constructor(key, nonce, { decrypt = false, aad } = {}) {
    const n = toBytes(nonce);
    if (n.length !== 12 && n.length !== 24) throw new Error('nonce must be 12 (ChaCha20) or 24 (XChaCha20) bytes');
    this.cipher = new ChaCha20(key, n, 0);
    this.mac = new Poly1305(this.cipher.keystream(64).subarray(0, 32)); // block 0 -> Poly1305 key; data from block 1
    this.decrypt = !!decrypt;
    const a = aad ? toBytes(aad) : new Uint8Array(0);
    this.aadLen = a.length;
    this.len = 0;
    this.mac.update(a);
    this.padMac(a.length);
  }

  padMac(n) { if (n % 16) this.mac.update(new Uint8Array(16 - (n % 16))); }

  // As in AesGcm: streaming decryption releases plaintext before final() verifies the tag; the one-shot open()
  // below withholds (and wipes) it on failure.
  update(chunk) {
    const d = toBytes(chunk);
    this.len += d.length;
    if (this.decrypt) { this.mac.update(d); return this.cipher.update(d); }
    const out = this.cipher.update(d);
    this.mac.update(out);
    return out;
  }

  final() {
    this.padMac(this.len);
    const lens = new Uint8Array(16);
    // Little-endian u64 by repeated division (not shifts: lengths may exceed 2^32 and JS shifts are 32-bit).
    const put = (o, v) => { for (let i = 0; i < 8; i++, v = Math.floor(v / 256)) lens[o + i] = v & 255; };
    put(0, this.aadLen); put(8, this.len);
    const tag = this.mac.update(lens).digest();
    this.cipher.destroy();
    if (this.decrypt) { if (!this.expected || !equalBytes(tag, this.expected)) throw new Error('authentication failed (wrong key or corrupted data)'); }
    else this.tag = tag;
    return new Uint8Array(0);
  }

  getTag() { if (!this.tag) throw new Error('call final() first'); return this.tag; }
  setTag(tag) { this.expected = toBytes(tag).slice(); return this; }
}

function seal(key, nonce, plaintext, aad) {
  const c = new ChaCha20Poly1305(key, nonce, { aad });
  const ct = c.update(plaintext);
  c.final();
  return concatBytes(ct, c.getTag());
}

function open(key, nonce, sealed, aad) {
  const s = toBytes(sealed);
  if (s.length < 16) throw new Error('ciphertext too short');
  const c = new ChaCha20Poly1305(key, nonce, { decrypt: true, aad }).setTag(s.subarray(s.length - 16));
  const pt = c.update(s.subarray(0, s.length - 16));
  try { c.final(); } catch (e) { wipe(pt); throw e; }
  return pt;
}

// The public one-shot names pin the nonce length so that chacha20poly1305* can never silently become XChaCha20
// (and vice versa) because a caller passed the wrong buffer; the class itself dispatches on length.
const need = (nonce, n) => { if (toBytes(nonce).length !== n) throw new Error(`nonce must be ${n} bytes`); };
export const chacha20poly1305Encrypt = (key, nonce, pt, aad) => { need(nonce, 12); return seal(key, nonce, pt, aad); };
export const chacha20poly1305Decrypt = (key, nonce, ct, aad) => { need(nonce, 12); return open(key, nonce, ct, aad); };
export const xchacha20poly1305Encrypt = (key, nonce, pt, aad) => { need(nonce, 24); return seal(key, nonce, pt, aad); };
export const xchacha20poly1305Decrypt = (key, nonce, ct, aad) => { need(nonce, 24); return open(key, nonce, ct, aad); };
