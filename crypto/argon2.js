// crypto/argon2.js - Argon2d, Argon2i and Argon2id (RFC 9106, versions 0x13 and 0x10), the memory-hard KDF of KDBX 4.
//
//   argon2id(password, salt, { t, m, p, dkLen = 32, secret, ad, version = 0x13 }) -> Uint8Array
//   argon2d / argon2i likewise; argon2Async(type, password, salt, opts, { onProgress, signal }) -> Promise
//     t: passes, m: memory in KiB, p: lanes (computed one after another; the result does not depend on it)
//
// Memory is one Int32Array of 1 KiB blocks (256 words); the compression G works on 64-bit words as (lo, hi) pairs
// with the 32x32 -> 64-bit products of BlaMka split into 16-bit halves, so no BigInt is involved.
//
// Parameters: defaults t = 3, m = 64 MiB, p = 1 (RFC 9106's second recommended option is t = 3, m = 64 MiB, p = 4).
// Lanes are computed sequentially, so p buys no speed here but must match the stored value -
// it changes the memory layout and therefore the output.
// Side channels by design: Argon2d (and the second half of Argon2id's first pass, and all later passes) indexes
// memory with password-dependent values, which leaks through cache timing - the RFC's accepted trade-off for
// GPU / tradeoff resistance. Argon2i / the first half of Argon2id are data-independent. Use Argon2id.
// Encodings: all H0 inputs are 32-bit little-endian lengths / values; blocks are serialised little-endian.
// Version 0x10 (Argon2 1.0) overwrites blocks in later passes; 0x13 XORs into them. 0x13 is the RFC version;
// 0x10 is accepted only to reproduce keys made by older implementations.
import { blake2b } from './blake2.js';
import { runAsync, runSync } from './kdf.js';
import { concatBytes, toBytes, writeU32LE } from './encoding.js';

const TYPES = { argon2d: 0, argon2i: 1, argon2id: 2 };
const SYNC = 4; // slices per pass (SL in RFC 9106): lanes synchronise at slice boundaries

// GB of RFC 9106 3.6 on the 64-bit words at word offsets a, b, c, d of v (lo at even, hi at odd offsets).
// Everything stays int32 for the JIT: the 32x32 -> 64-bit product of fBlaMka is assembled from 16-bit halves with
// Math.imul, and 64-bit carries are computed without branches (carry of x + y = r is the top bit of
// (x & y) | ((x | y) & ~r)); random carries would make branches mispredict half of the time.
function gb(v, a, b, c, d) {
  let al = v[a], ah = v[a + 1], bl = v[b], bh = v[b + 1], cl = v[c], ch = v[c + 1], dl = v[d], dh = v[d + 1];
  // Each "x = x + y + 2 * lo32(x) * lo32(y)" below is a schoolbook 32x32 product: p = low halves' product, t and u
  // carry the cross terms' 16-bit halves into hi, Math.imul gives the exact low 32 bits; then (hi, lo) <<= 1.
  let p = 0, t = 0, u = 0, hi = 0, lo = 0, s = 0;
  // a = a + b + 2 * lo32(a) * lo32(b)
  p = Math.imul(al & 0xffff, bl & 0xffff);
  t = (Math.imul(al >>> 16, bl & 0xffff) + (p >>> 16)) | 0;
  u = ((t & 0xffff) + Math.imul(al & 0xffff, bl >>> 16)) | 0;
  hi = (Math.imul(al >>> 16, bl >>> 16) + (t >>> 16) + (u >>> 16)) | 0;
  lo = Math.imul(al, bl);
  hi = (hi << 1) | (lo >>> 31); lo <<= 1;
  s = (al + bl) | 0;
  ah = (ah + bh + (((al & bl) | ((al | bl) & ~s)) >>> 31)) | 0;
  al = (s + lo) | 0;
  ah = (ah + hi + (((s & lo) | ((s | lo) & ~al)) >>> 31)) | 0;
  // d = rotr32(d ^ a)
  t = dl ^ al; dl = dh ^ ah; dh = t;
  // c = c + d + 2 * lo32(c) * lo32(d)
  p = Math.imul(cl & 0xffff, dl & 0xffff);
  t = (Math.imul(cl >>> 16, dl & 0xffff) + (p >>> 16)) | 0;
  u = ((t & 0xffff) + Math.imul(cl & 0xffff, dl >>> 16)) | 0;
  hi = (Math.imul(cl >>> 16, dl >>> 16) + (t >>> 16) + (u >>> 16)) | 0;
  lo = Math.imul(cl, dl);
  hi = (hi << 1) | (lo >>> 31); lo <<= 1;
  s = (cl + dl) | 0;
  ch = (ch + dh + (((cl & dl) | ((cl | dl) & ~s)) >>> 31)) | 0;
  cl = (s + lo) | 0;
  ch = (ch + hi + (((s & lo) | ((s | lo) & ~cl)) >>> 31)) | 0;
  // b = rotr24(b ^ c)
  t = bl ^ cl; u = bh ^ ch; bl = (t >>> 24) | (u << 8); bh = (u >>> 24) | (t << 8);
  // a = a + b + 2 * lo32(a) * lo32(b)
  p = Math.imul(al & 0xffff, bl & 0xffff);
  t = (Math.imul(al >>> 16, bl & 0xffff) + (p >>> 16)) | 0;
  u = ((t & 0xffff) + Math.imul(al & 0xffff, bl >>> 16)) | 0;
  hi = (Math.imul(al >>> 16, bl >>> 16) + (t >>> 16) + (u >>> 16)) | 0;
  lo = Math.imul(al, bl);
  hi = (hi << 1) | (lo >>> 31); lo <<= 1;
  s = (al + bl) | 0;
  ah = (ah + bh + (((al & bl) | ((al | bl) & ~s)) >>> 31)) | 0;
  al = (s + lo) | 0;
  ah = (ah + hi + (((s & lo) | ((s | lo) & ~al)) >>> 31)) | 0;
  // d = rotr16(d ^ a)
  t = dl ^ al; u = dh ^ ah; dl = (t >>> 16) | (u << 16); dh = (u >>> 16) | (t << 16);
  // c = c + d + 2 * lo32(c) * lo32(d)
  p = Math.imul(cl & 0xffff, dl & 0xffff);
  t = (Math.imul(cl >>> 16, dl & 0xffff) + (p >>> 16)) | 0;
  u = ((t & 0xffff) + Math.imul(cl & 0xffff, dl >>> 16)) | 0;
  hi = (Math.imul(cl >>> 16, dl >>> 16) + (t >>> 16) + (u >>> 16)) | 0;
  lo = Math.imul(cl, dl);
  hi = (hi << 1) | (lo >>> 31); lo <<= 1;
  s = (cl + dl) | 0;
  ch = (ch + dh + (((cl & dl) | ((cl | dl) & ~s)) >>> 31)) | 0;
  cl = (s + lo) | 0;
  ch = (ch + hi + (((s & lo) | ((s | lo) & ~cl)) >>> 31)) | 0;
  // b = rotr63(b ^ c) = rotl1
  t = bl ^ cl; u = bh ^ ch; bl = (t << 1) | (u >>> 31); bh = (u << 1) | (t >>> 31);
  v[a] = al; v[a + 1] = ah; v[b] = bl; v[b + 1] = bh; v[c] = cl; v[c + 1] = ch; v[d] = dl; v[d + 1] = dh;
}

// The BLAKE2 round without message on 16 64-bit words given by their u64 indices i0..i15 in v (doubled inside).
function roundP(v, i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13, i14, i15) {
  gb(v, 2 * i0, 2 * i4, 2 * i8, 2 * i12);
  gb(v, 2 * i1, 2 * i5, 2 * i9, 2 * i13);
  gb(v, 2 * i2, 2 * i6, 2 * i10, 2 * i14);
  gb(v, 2 * i3, 2 * i7, 2 * i11, 2 * i15);
  gb(v, 2 * i0, 2 * i5, 2 * i10, 2 * i15);
  gb(v, 2 * i1, 2 * i6, 2 * i11, 2 * i12);
  gb(v, 2 * i2, 2 * i7, 2 * i8, 2 * i13);
  gb(v, 2 * i3, 2 * i4, 2 * i9, 2 * i14);
}

// next = G(prev, ref) (xor = true: next ^= G(prev, ref), Argon2 1.3 passes after the first).
// Offsets are word offsets of 256-word blocks; R and T are 256-word scratch blocks.
// G (RFC 9106 3.5): R = X ^ Y viewed as an 8x8 matrix of 16-byte registers; P on each row (8 consecutive
// 16-word groups), then P on each column (u64 pairs i, i+1 stepping by 16 u64 = 128 bytes); result Z ^ R.
// T keeps R (and the old block for v1.3's XOR) for the final feed-forward. R / T are reused for every block:
// no allocation inside the fill loop, which runs m times per pass.
function fillBlock(mem, prev, ref, next, xor, R, T) {
  for (let i = 0; i < 256; i++) R[i] = mem[prev + i] ^ mem[ref + i];
  if (xor) for (let i = 0; i < 256; i++) T[i] = R[i] ^ mem[next + i];
  else T.set(R);
  for (let i = 0; i < 128; i += 16) {
    roundP(R, i, i + 1, i + 2, i + 3, i + 4, i + 5, i + 6, i + 7, i + 8, i + 9, i + 10, i + 11, i + 12, i + 13, i + 14, i + 15);
  }
  for (let i = 0; i < 16; i += 2) {
    roundP(R, i, i + 1, i + 16, i + 17, i + 32, i + 33, i + 48, i + 49, i + 64, i + 65, i + 80, i + 81, i + 96, i + 97, i + 112, i + 113);
  }
  for (let i = 0; i < 256; i++) mem[next + i] = T[i] ^ R[i];
}

// H' (variable-length hash of RFC 9106 3.3).
// len <= 64: one BLAKE2b with digest length len (not a truncated 64-byte digest - the parameter block differs).
// Longer: chain V_i = BLAKE2b-512(V_{i-1}), emit the first 32 bytes of each, and a final BLAKE2b of the remaining
// length (r = ceil(len / 32) - 2 full chain steps). Used for the 1 KiB initial blocks and the tag.
function hPrime(len, x) {
  const lenLE = new Uint8Array(4);
  writeU32LE(lenLE, 0, len);
  if (len <= 64) return blake2b(concatBytes(lenLE, x), { dkLen: len });
  const out = new Uint8Array(len);
  let v = blake2b(concatBytes(lenLE, x));
  out.set(v.subarray(0, 32), 0);
  const r = Math.ceil(len / 32) - 2;
  let o = 32;
  for (let i = 2; i <= r; i++, o += 32) { v = blake2b(v); out.set(v.subarray(0, 32), o); }
  out.set(blake2b(v, { dkLen: len - 32 * r }), o);
  return out;
}

function* argon2Steps(type, password, salt, opts = {}) {
  const y = TYPES[type];
  if (y === undefined) throw new Error('unknown Argon2 type ' + type);
  const pwd = toBytes(password), slt = toBytes(salt);
  const t = opts.t ?? 3, m = opts.m ?? 65536, p = opts.p ?? 1, dkLen = opts.dkLen ?? 32, version = opts.version ?? 0x13;
  const secret = opts.secret ? toBytes(opts.secret) : new Uint8Array(0), ad = opts.ad ? toBytes(opts.ad) : new Uint8Array(0);
  // RFC 9106 3.1 limits: p in 1..2^24 - 1, m >= 8p KiB, tag >= 4 bytes, salt >= 8 bytes (16 recommended, random).
  // `!(x >= n)` rather than `x < n` so NaN / undefined parameters fail too. No upper bound on m: the Int32Array
  // allocation below throws RangeError when the engine cannot provide it, which is the honest failure.
  if (!(p >= 1 && p < 0x1000000) || !(t >= 1) || !(m >= 8 * p) || !(dkLen >= 4)) throw new Error('Argon2: invalid parameters');
  if (slt.length < 8) throw new Error('Argon2: salt must be at least 8 bytes');
  if (version !== 0x13 && version !== 0x10) throw new Error('Argon2: unsupported version');

  const le = (n) => { const b = new Uint8Array(4); writeU32LE(b, 0, n >>> 0); return b; };
  const h0 = blake2b(concatBytes(le(p), le(dkLen), le(m), le(t), le(version), le(y),
    le(pwd.length), pwd, le(slt.length), slt, le(secret.length), secret, le(ad.length), ad));

  // m' = floor(m / 4p) * 4p blocks: memory is rounded down to whole segments, so e.g. m = 65537 uses 65536 blocks
  // while H0 still hashes the requested m (as the RFC specifies).
  // KNOWN DEFECT (hygiene): h0, the password bytes' derived blocks and `fin` are not wiped; only `mem` is. On an
  // aborted runAsync the generator is dropped and even `mem` (password-derived) stays in the heap until GC.
  // Fix: wipe h0 / fin / finBytes / R / T before returning, and wrap the body in try / finally to wipe mem.
  const segLen = Math.floor(Math.max(m, 2 * SYNC * p) / (p * SYNC));
  const laneLen = segLen * SYNC;
  const blocks = laneLen * p;
  const mem = new Int32Array(blocks * 256);
  const R = new Int32Array(256), T = new Int32Array(256);
  const toWords = (bytes, off) => { for (let i = 0; i < 256; i++) mem[off + i] = bytes[4 * i] | (bytes[4 * i + 1] << 8) | (bytes[4 * i + 2] << 16) | (bytes[4 * i + 3] << 24); };
  // First two blocks of every lane: B[l][0] = H'(H0 || LE32(0) || LE32(l)), B[l][1] = H'(H0 || LE32(1) || LE32(l)).
  for (let l = 0; l < p; l++) {
    toWords(hPrime(1024, concatBytes(h0, le(0), le(l))), l * laneLen * 256);
    toWords(hPrime(1024, concatBytes(h0, le(1), le(l))), (l * laneLen + 1) * 256);
  }

  // Data-independent addressing: the address block is G(0, G(0, input)), input = (pass, lane, slice, blocks, t, type, counter).
  // input holds u64 values as (lo, hi) word pairs, hence the even indices 0, 2, ... 12 (counter). One address
  // block yields 128 (J1, J2) pairs, so it is regenerated every 128 blocks.
  const zero = new Int32Array(256), input = new Int32Array(256), addr = new Uint32Array(256);
  const scratch = new Int32Array(256 * 3); // zero | input | address as one memory for fillBlock
  const nextAddresses = () => {
    input[12]++;
    scratch.set(zero, 0); scratch.set(input, 256);
    fillBlock(scratch, 0, 256, 512, false, R, T);
    scratch.set(scratch.subarray(512, 768), 256);
    fillBlock(scratch, 0, 256, 512, false, R, T);
    addr.set(scratch.subarray(512, 768));
  };

  const totalSegments = t * SYNC * p;
  let doneSegments = 0;
  for (let pass = 0; pass < t; pass++) {
    for (let slice = 0; slice < SYNC; slice++) {
      for (let lane = 0; lane < p; lane++) {
        // Argon2i always, Argon2id in slices 0 and 1 of pass 0: data-independent (side-channel resistant) addresses.
        const indep = y === 1 || (y === 2 && pass === 0 && slice < SYNC / 2);
        if (indep) {
          input.fill(0);
          input[0] = pass; input[2] = lane; input[4] = slice; input[6] = blocks; input[8] = t; input[10] = y;
        }
        let start = 0;
        if (pass === 0 && slice === 0) { start = 2; if (indep) nextAddresses(); }
        let cur = lane * laneLen + slice * segLen + start;
        let prev = cur % laneLen === 0 ? cur + laneLen - 1 : cur - 1;
        // prev is the block before cur in the same lane, wrapping from block 0 to the lane's last block (later passes).
        for (let i = start; i < segLen; i++, cur++, prev++) {
          if (cur % laneLen === 1) prev = cur - 1;
          let j1, j2;
          if (indep) {
            if (i % 128 === 0) nextAddresses();
            j1 = addr[2 * (i % 128)]; j2 = addr[2 * (i % 128) + 1];
          } else {
            j1 = mem[prev * 256] >>> 0; j2 = mem[prev * 256 + 1] >>> 0;
          }
          // Reference set (RFC 9106 3.4.1.1): the first slice of pass 0 must stay in its own lane (other lanes have
          // nothing yet). Same lane: every finished block except prev; other lanes: only finished slices, minus one
          // block when i = 0 (that lane's previous block may be in progress).
          const refLane = pass === 0 && slice === 0 ? lane : j2 % p;
          const same = refLane === lane;
          let area;
          if (pass === 0) area = slice === 0 ? i - 1 : same ? slice * segLen + i - 1 : slice * segLen + (i === 0 ? -1 : 0);
          else area = same ? laneLen - segLen + i - 1 : laneLen - segLen + (i === 0 ? -1 : 0);
          // relative = area - 1 - ((area * ((j1 * j1) >> 32)) >> 32), with exact 64-bit products
          // (the quadratic map biases references toward recent blocks). Plain j1 * j1 in doubles would round above
          // 2^53 and pick a different block - silently incompatible output, hence mulHi.
          const x = mulHi(j1, j1);
          const rel = area - 1 - mulHi(area, x);
          const startPos = pass !== 0 && slice !== SYNC - 1 ? (slice + 1) * segLen : 0;
          const ref = refLane * laneLen + ((startPos + rel) % laneLen);
          fillBlock(mem, prev * 256, ref * 256, cur * 256, version === 0x13 && pass > 0, R, T);
          // Progress every 1024 blocks (1 MiB of memory filled) plus once per segment below.
          if ((i & 1023) === 1023) yield (doneSegments + i / segLen) / totalSegments;
        }
        doneSegments++;
        yield doneSegments / totalSegments;
      }
    }
  }

  // Final block: XOR of the last block of every lane.
  const fin = new Int32Array(256);
  for (let l = 0; l < p; l++) { const o = (l * laneLen + laneLen - 1) * 256; for (let i = 0; i < 256; i++) fin[i] ^= mem[o + i]; }
  mem.fill(0);
  const finBytes = new Uint8Array(1024);
  for (let i = 0; i < 256; i++) writeU32LE(finBytes, 4 * i, fin[i]);
  return hPrime(dkLen, finBytes);
}

// High 32 bits of the unsigned product a * b (a, b < 2^32), exact.
// 16-bit partial products are < 2^32 and their sums < 2^49, all exact in doubles; floor division by 65536 extracts
// the carries. Returns a Number (may exceed int32), used only as an index offset.
function mulHi(a, b) {
  const a0 = a & 0xffff, a1 = a >>> 16, b0 = b & 0xffff, b1 = b >>> 16;
  const t = a1 * b0 + Math.floor((a0 * b0) / 65536);
  const w1 = (t % 65536) + a0 * b1;
  return a1 * b1 + Math.floor(t / 65536) + Math.floor(w1 / 65536);
}

export const argon2d = (password, salt, opts) => runSync(argon2Steps('argon2d', password, salt, opts));
export const argon2i = (password, salt, opts) => runSync(argon2Steps('argon2i', password, salt, opts));
export const argon2id = (password, salt, opts) => runSync(argon2Steps('argon2id', password, salt, opts));
// type: 'argon2d' | 'argon2i' | 'argon2id'
export const argon2Async = (type, password, salt, opts, run) => runAsync(argon2Steps(type, password, salt, opts), run);
