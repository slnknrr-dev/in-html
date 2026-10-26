// crypto/kdf.js - PBKDF2 (RFC 8018) and HKDF (RFC 5869) over any block hash of the library.
//   pbkdf2(hashFn, password, salt, iterations, dkLen) -> Uint8Array
//   pbkdf2Async(hashFn, password, salt, iterations, dkLen, { onProgress(fraction), signal }) -> Promise<Uint8Array>
//     yields to the event loop every few milliseconds so a page stays responsive
//   hkdf(hashFn, ikm, salt, info, length), hkdfExtract(hashFn, ikm, salt), hkdfExpand(hashFn, prk, info, length)
//
// Execution model shared by every slow KDF (pbkdf2 here, argon2.js, scrypt.js): the algorithm is a generator that
// yields progress fractions at safe points; runSync drains it in one go, runAsync drains it in ~25 ms slices between
// event-loop turns. One implementation, two schedulers - no duplicated sync / async code paths that could drift
// apart. Why not a Worker: the apps are single-file builds that also run from file://, where a Worker needs a
// separate script URL (or a blob: workaround that some file:// policies block); slicing on the main thread works
// everywhere, at the cost of sharing the thread with the UI.
//
// Parameters are the caller's choice and are not policed beyond validity: PBKDF2 iteration counts depend on the hash
// and the threat model (OWASP 2023: 600 000 for HMAC-SHA256, 210 000 for HMAC-SHA512). HKDF is NOT a password KDF:
// it assumes high-entropy input keying material and does no work-factor stretching.
import { concatBytes, toBytes, wipe } from './encoding.js';
import { hmac } from './hmac.js';

// PBKDF2: T_b = U_1 ^ U_2 ^ ... ^ U_c, U_1 = PRF(P, S || INT_BE32(b)), U_i = PRF(P, U_{i-1}); DK = T_1 || T_2 || ...
// The first-iteration index is a 32-bit big-endian block number starting at 1 (RFC 8018 5.2).
function* pbkdf2Steps(hashFn, password, salt, iterations, dkLen) {
  if (!(iterations >= 1) || !(dkLen >= 1)) throw new Error('PBKDF2: iterations and length must be positive');
  const prf = hmac.create(hashFn, toBytes(password));
  const s = toBytes(salt);
  const hLen = hashFn.outputLen;
  const blocks = Math.ceil(dkLen / hLen);
  const out = new Uint8Array(dkLen);
  const idx = new Uint8Array(4);
  const total = blocks * iterations;
  // Working copies of the keyed inner / outer states, reset per iteration without allocating.
  // The hot loop is 2 compressions per iteration; at 600 000 iterations allocation would dominate, so the fast path
  // reuses two hash objects via restoreFrom (array copies into existing buffers). It reaches into the HMAC object's
  // inner / outer fields - a deliberate same-library coupling. Hashes without restoreFrom fall back to clone().
  const inner = prf.inner.clone(), outer = prf.outer.clone();
  const fast = typeof inner.restoreFrom === 'function';
  for (let b = 1; b <= blocks; b++) {
    idx[0] = b >>> 24; idx[1] = b >>> 16; idx[2] = b >>> 8; idx[3] = b;
    let u = prf.clone().update(s).update(idx).digest();
    const t = u.slice();
    for (let i = 1; i < iterations; i++) {
      if (fast) u = outer.restoreFrom(prf.outer).update(inner.restoreFrom(prf.inner).update(u).digest()).digest();
      else u = prf.clone().update(u).digest();
      for (let j = 0; j < hLen; j++) t[j] ^= u[j];
      // Yield every 1024 iterations: a power of two keeps the test a mask, and 1024 HMACs are well under a
      // millisecond, so runAsync's 25 ms budget is respected without a clock read per iteration.
      if ((i & 1023) === 0) yield ((b - 1) * iterations + i) / total;
    }
    out.set(t.subarray(0, Math.min(hLen, dkLen - (b - 1) * hLen)), (b - 1) * hLen);
    wipe(t, u);
  }
  return out;
}

// Runs a generator of progress fractions synchronously.
export function runSync(gen) {
  for (;;) { const r = gen.next(); if (r.done) return r.value; }
}

// Yields to the event loop: a MessageChannel round trip is not clamped like nested setTimeout (4 ms in browsers).
// HTML clamps setTimeout to >= 4 ms after 5 nested levels, so a long KDF sliced with setTimeout would waste ~15 % of
// its time idle. A message task runs at the next turn with no clamp; port1 is closed after use so Node does not keep
// the process alive on an open port. setTimeout remains the fallback for engines without MessageChannel.
export function nextTick() {
  if (typeof MessageChannel !== 'function') return new Promise((res) => setTimeout(res, 0));
  return new Promise((res) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { ch.port1.close(); res(); };
    ch.port2.postMessage(0);
  });
}

// Runs a generator of progress fractions, yielding to the event loop about every 25 ms (rendering, input, aborts).
// 25 ms: below the ~50 ms "long task" threshold, so input stays responsive, while yields stay rare enough that
// scheduling overhead is negligible. Abort is checked only after a yield (signal.aborted cannot change while
// synchronous code runs), so cancellation latency is at most one slice. The generator is simply abandoned on abort;
// buffers it allocated are left to the GC un-wiped (see the KNOWN DEFECT notes in argon2.js / scrypt.js).
export async function runAsync(gen, { onProgress, signal } = {}) {
  let last = Date.now();
  for (;;) {
    const r = gen.next();
    if (r.done) { if (onProgress) onProgress(1); return r.value; }
    if (Date.now() - last > 25) {
      if (onProgress) onProgress(r.value);
      await nextTick();
      if (signal && signal.aborted) throw new Error('aborted');
      last = Date.now();
    }
  }
}

export const pbkdf2 = (hashFn, password, salt, iterations, dkLen) => runSync(pbkdf2Steps(hashFn, password, salt, iterations, dkLen));
export const pbkdf2Async = (hashFn, password, salt, iterations, dkLen, opts) => runAsync(pbkdf2Steps(hashFn, password, salt, iterations, dkLen), opts);

// HKDF-Extract: PRK = HMAC(salt, IKM). An absent / empty salt means HashLen zero bytes (RFC 5869 2.2) - which, given
// HMAC's zero padding, is the same key as the empty string; the explicit array just mirrors the RFC text.
export function hkdfExtract(hashFn, ikm, salt) {
  const s = salt && salt.length ? toBytes(salt) : new Uint8Array(hashFn.outputLen);
  return hmac(hashFn, s, toBytes(ikm));
}

// HKDF-Expand: T(i) = HMAC(PRK, T(i-1) || info || i), i a single byte 1..255, hence the 255 * HashLen output cap.
// One HMAC object per block (no clone tricks): HKDF outputs are a few blocks, not hundreds of thousands.
export function hkdfExpand(hashFn, prk, info, length) {
  const hLen = hashFn.outputLen;
  if (length > 255 * hLen) throw new Error('HKDF: output too long');
  const inf = toBytes(info || new Uint8Array(0));
  const out = new Uint8Array(length);
  let prev = new Uint8Array(0);
  for (let i = 1, o = 0; o < length; i++) {
    prev = hmac(hashFn, prk, concatBytes(prev, inf, new Uint8Array([i])));
    out.set(prev.subarray(0, Math.min(hLen, length - o)), o);
    o += hLen;
  }
  return out;
}

export const hkdf = (hashFn, ikm, salt, info, length) => hkdfExpand(hashFn, hkdfExtract(hashFn, ikm, salt), info, length);
