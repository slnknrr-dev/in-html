// crypto/secp256k1.js - the secp256k1 elliptic curve (SEC 2) of Bitcoin and Ethereum: field and scalar arithmetic,
// points with compressed / uncompressed encodings, ECDSA with RFC 6979 deterministic nonces, low-S normalisation, DER
// and compact signatures, public-key recovery, BIP-340 Schnorr signatures with x-only keys, BIP-341 taproot tweaks,
// key tweaks (BIP-32) and ECDH. BigInt arithmetic, synchronous, no DOM.
//
// Keys and scalars are accepted as 32-byte Uint8Array, 64-digit hex strings or bigint; results are Uint8Array.
//
//   CURVE { p, n, Gx, Gy }                      Point (affine; Point.BASE, Point.ZERO)
//   getPublicKey(priv, compressed = true)        33 / 65 bytes
//   isValidPrivateKey(priv), isValidPublicKey(pub), convertPublicKey(pub, compressed)
//   privateAdd(priv, tweak), privateNegate(priv), privateMultiply(priv, tweak)
//   publicAdd(pub, tweak, compressed)  (P + tweak·G),  publicMultiply(pub, tweak, compressed), publicCombine(pubs, ...)
//   ecdsaSign(hash32, priv, { lowS = true, extraEntropy, lowR = false }) -> Signature { r, s, recovery }
//   ecdsaVerify(sig, hash32, pub, { lowS = false }) -> boolean      sig: Signature or 64-byte compact r || s
//   ecdsaRecover(sig, recovery, hash32, compressed = true) -> public key
//   Signature.fromCompact(64) / .fromDER(bytes, { strict = true }), sig.toCompact(), sig.toDER(), sig.normalizeS()
//   schnorrSign(msg, priv, auxRand = randomBytes(32)), schnorrVerify(sig64, msg, pubX32), schnorrPublicKey(priv)
//   taggedHash(tag, ...parts), liftX(x)
//   taprootTweak(internalX32, merkleRoot?) -> 32-byte tweak, taprootOutputKey(internalX32, merkleRoot?) -> { key, parity },
//   taprootTweakPrivateKey(priv, merkleRoot?)
//   getSharedSecret(priv, pub, compressed = true) -> ECDH point (the x coordinate is bytes 1..33)
//
// Not constant time: BigInt arithmetic and table lookups take time that depends on the values (see README.md).
// KNOWN DEFECT (side channel, documented by design): private-key operations (signing, getPublicKey, ECDH via
// Point.multiply / mulPoint, tweaks) leak timing through BigInt operand sizes, `if (d)` branches on scalar digits in
// mulPoint and secret-indexed table reads in mulBase. Acceptable for an offline wallet tool on the user's own machine;
// not for a signing service reachable by attackers who can time it. Fix: a fixed-limb field implementation with
// constant-time ladders and table scans (as libsecp256k1 does) - a rewrite, not a patch.
//
// Encodings: scalars and coordinates are 32-byte BIG-endian (SEC 1); points 02/03 || x (compressed) or 04 || x || y;
// BIP-340 uses 32-byte x-only keys with an implicit even y. Fault / misuse hardening present: RFC 6979 nonces (no
// RNG needed for ECDSA, so a bad RNG cannot leak the key), low-S by default, and schnorrSign verifies its own output
// before returning (catches a computation fault that would otherwise leak the key through a bad signature).
import { bytesToHex, concatBytes, hexToBytes, toBytes, utf8ToBytes } from './encoding.js';
import { hmac } from './hmac.js';
import { randomBytes } from './random.js';
import { sha256 } from './sha2.js';

const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;
// p = 2^256 - 2^32 - 977; n = group order (prime, cofactor 1, so every non-infinite point generates the group).
const HALF_N = N >> 1n;
export const CURVE = Object.freeze({ p: P, n: N, Gx: GX, Gy: GY, a: 0n, b: 7n, h: 1n });

// --- numbers ---------------------------------------------------------------------------------

// BigInt % keeps the dividend's sign (truncated division), so negative intermediates need the + m correction.
export function mod(a, m = P) {
  const r = a % m;
  return r < 0n ? r + m : r;
}

// Right-to-left square-and-multiply: the `if (e & 1n)` branch follows the exponent bits. Only used with public
// exponents here ((p + 1) / 4 in sqrt), so the branch leaks nothing secret.
export function pow(b, e, m = P) {
  let r = 1n;
  b = mod(b, m);
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return r;
}

// Modular inverse by the extended Euclidean algorithm; throws for 0 or a non-invertible value.
// Chosen over Fermat (a^(m-2)) for speed with BigInt: ~150 divisions instead of ~256 squarings + multiplications.
// Variable time: inverting the nonce k in ecdsaSign leaks through the iteration count (part of the defect above).
export function invert(a, m = P) {
  let x = mod(a, m);
  if (x === 0n) throw new Error('inverse of zero');
  let b = m, u = 1n, s = 0n;
  // Invariants: x = u·a, b = s·a (mod m).
  while (x !== 0n) {
    const q = b / x;
    [b, x] = [x, b - q * x];
    [s, u] = [u, s - q * u];
  }
  if (b !== 1n) throw new Error('no inverse');
  return mod(s, m);
}

// Square root modulo p (p = 3 mod 4), or null when a is not a square.
// For p = 3 mod 4, a^((p+1)/4) is a root whenever one exists; the squaring check detects non-residues (half of all
// x have no point), which is how invalid compressed keys are rejected.
function sqrt(a) {
  const r = pow(a, (P + 1n) >> 2n);
  return (r * r) % P === mod(a) ? r : null;
}

export const bytesToNumber = (b) => (b.length ? BigInt('0x' + bytesToHex(b)) : 0n);

export function numberToBytes(n, len = 32) {
  if (n < 0n) throw new Error('negative number');
  const hex = n.toString(16).padStart(len * 2, '0');
  if (hex.length > len * 2) throw new Error('number too large');
  return hexToBytes(hex);
}

// 32-byte scalars from bytes, hex or bigint.
function bytes32(v, what = 'value') {
  if (typeof v === 'bigint') return numberToBytes(v, 32);
  const b = typeof v === 'string' ? hexToBytes(v) : toBytes(v);
  if (b.length !== 32) throw new Error(`${what}: 32 bytes expected`);
  return b;
}

// Private key as a bigint in [1, n-1].
// Out-of-range keys throw instead of being reduced mod n: silently reducing would make two different 32-byte
// strings the same key, and libsecp256k1 rejects them too (seckey_verify).
function privNum(priv) {
  const d = typeof priv === 'bigint' ? priv : bytesToNumber(bytes32(priv, 'private key'));
  if (d <= 0n || d >= N) throw new Error('invalid private key');
  return d;
}

// --- points (Jacobian coordinates internally: [X, Y, Z], x = X / Z², y = Y / Z³; Z = 0 is infinity) -------------

// Jacobian coordinates avoid one field inversion per addition (inversion is ~100x a multiplication); a single
// inversion converts back at the end (toAffine). Formulas: dbl-2009-l and add-1998-cmo-2 (Z3 = Z1 Z2 H) of the
// Explicit-Formulas Database for a = 0 curves; mixed addition is the Z2 = 1 specialisation. M is mod P inlined (hot path).
const INF = [0n, 1n, 0n];
const M = (a) => { const r = a % P; return r < 0n ? r + P : r; };

function jdouble(p) {
  const [X1, Y1, Z1] = p;
  if (Z1 === 0n || Y1 === 0n) return INF;
  const A = M(X1 * X1), B = M(Y1 * Y1), C = M(B * B);
  const t = X1 + B;
  const D = M(2n * (t * t - A - C));
  const E = 3n * A, F = M(E * E);
  const X3 = M(F - 2n * D);
  return [X3, M(E * (D - X3) - 8n * C), M(2n * Y1 * Z1)];
}

function jadd(p, q) {
  const [X1, Y1, Z1] = p, [X2, Y2, Z2] = q;
  if (Z1 === 0n) return q;
  if (Z2 === 0n) return p;
  const Z1Z1 = M(Z1 * Z1), Z2Z2 = M(Z2 * Z2);
  const U1 = M(X1 * Z2Z2), U2 = M(X2 * Z1Z1);
  const S1 = M(Y1 * Z2 * Z2Z2), S2 = M(Y2 * Z1 * Z1Z1);
  const H = M(U2 - U1), r = M(S2 - S1);
  // Same x: either the same point (use doubling - the addition formula divides by zero there) or P + (-P) = INF.
  if (H === 0n) return r === 0n ? jdouble(p) : INF;
  const HH = M(H * H), HHH = M(H * HH), V = M(U1 * HH);
  const X3 = M(r * r - HHH - 2n * V);
  return [X3, M(r * (V - X3) - S1 * HHH), M(Z1 * Z2 * H)];
}

// p + an affine point (x2, y2) (mixed addition).
function jaddAffine(p, x2, y2) {
  const [X1, Y1, Z1] = p;
  if (Z1 === 0n) return [x2, y2, 1n];
  const Z1Z1 = M(Z1 * Z1);
  const U2 = M(x2 * Z1Z1), S2 = M(y2 * Z1 * Z1Z1);
  const H = M(U2 - X1), r = M(S2 - Y1);
  if (H === 0n) return r === 0n ? jdouble(p) : INF;
  const HH = M(H * H), HHH = M(H * HH), V = M(X1 * HH);
  const X3 = M(r * r - HHH - 2n * V);
  return [X3, M(r * (V - X3) - Y1 * HHH), M(Z1 * H)];
}

const jneg = ([X, Y, Z]) => [X, M(-Y), Z];

function toAffine(p) {
  const [X, Y, Z] = p;
  if (Z === 0n) return null;
  if (Z === 1n) return [X, Y];
  const zi = invert(Z), zi2 = M(zi * zi);
  return [M(X * zi2), M(Y * zi2 * zi)];
}

// Many points to affine with one inversion (Montgomery's trick); points at infinity are not allowed.
function batchAffine(points) {
  const acc = new Array(points.length);
  let prod = 1n;
  for (let i = 0; i < points.length; i++) { acc[i] = prod; prod = M(prod * points[i][2]); }
  let inv = invert(prod);
  const out = new Array(points.length);
  for (let i = points.length - 1; i >= 0; i--) {
    const [X, Y, Z] = points[i];
    const zi = M(inv * acc[i]);
    inv = M(inv * Z);
    const zi2 = M(zi * zi);
    out[i] = [M(X * zi2), M(Y * zi2 * zi)];
  }
  return out;
}

// Fixed-base table: TABLE[w][d - 1] = d · 16^w · G (affine) for 64 windows of 4 bits.
// 960 points built lazily on first use (a few ms), converted to affine with one inversion so mulBase can use the
// cheaper mixed addition; then k · G costs at most 64 additions and no doublings.
let TABLE = null;
function baseTable() {
  if (TABLE) return TABLE;
  const all = [];
  let base = [GX, GY, 1n];
  for (let w = 0; w < 64; w++) {
    let acc = base;
    for (let d = 1; d <= 15; d++) { all.push(acc); acc = jadd(acc, base); }
    base = acc; // 16 · base
  }
  const aff = batchAffine(all);
  TABLE = [];
  for (let w = 0; w < 64; w++) TABLE.push(aff.slice(w * 15, w * 15 + 15));
  return TABLE;
}

// k · G. Every window performs one addition (a dummy one for a zero digit), so the count of operations does not
// depend on k; BigInt timing still does.
// The dummy addition equalises the operation count only; the table entry read still depends on the secret digit
// (cache timing), and the branch itself is visible to a precise attacker.
function mulBase(k) {
  const T = baseTable();
  let R = INF, dummy = INF;
  for (let w = 0; w < 64; w++) {
    const d = Number((k >> BigInt(4 * w)) & 15n);
    if (d) { const [x, y] = T[w][d - 1]; R = jaddAffine(R, x, y); } else { const [x, y] = T[w][w & 7]; dummy = jaddAffine(dummy, x, y); }
  }
  return R;
}

// k · P for any point (4-bit fixed window).
// 14 additions of precomputation, then per window 4 doublings + 1 addition, skipped for a zero digit: the skip is
// a scalar-dependent branch (ECDH with a private scalar leaks here; verification uses public scalars only).
function mulPoint(p, k) {
  if (k === 0n || p[2] === 0n) return INF;
  const tbl = [p];
  for (let i = 1; i < 15; i++) tbl.push(jadd(tbl[i - 1], p));
  let R = INF;
  for (let i = 252; i >= 0; i -= 4) {
    R = jdouble(jdouble(jdouble(jdouble(R))));
    const d = Number((k >> BigInt(i)) & 15n);
    if (d) R = jadd(R, tbl[d - 1]);
  }
  return R;
}

const onCurve = (x, y) => M(y * y - x * x * x - 7n) === 0n;

export class Point {
  // Affine coordinates (bigint); Point.ZERO (the point at infinity) has x = y = null.
  constructor(x, y) {
    this.x = x;
    this.y = y;
    Object.freeze(this);
  }

  static fromJacobian(j) {
    const a = toAffine(j);
    return a ? new Point(a[0], a[1]) : Point.ZERO;
  }

  // 33-byte compressed (02 / 03 + x) or 65-byte uncompressed (04 + x + y) encodings; throws when not on the curve.
  // Validation is mandatory before using a foreign key: an off-curve point in ECDH enables invalid-curve attacks
  // that extract the private key. Hybrid encodings (06 / 07) are deliberately unsupported.
  static fromBytes(bytes) {
    const b = typeof bytes === 'string' ? hexToBytes(bytes) : toBytes(bytes);
    if (b.length === 33 && (b[0] === 2 || b[0] === 3)) {
      const x = bytesToNumber(b.subarray(1));
      const p = liftXNum(x);
      if (!p) throw new Error('invalid public key: x is not on the curve');
      return (p.y & 1n) === BigInt(b[0] & 1) ? p : new Point(p.x, P - p.y);
    }
    if (b.length === 65 && b[0] === 4) {
      const x = bytesToNumber(b.subarray(1, 33)), y = bytesToNumber(b.subarray(33));
      if (x >= P || y >= P || !onCurve(x, y)) throw new Error('invalid public key: not on the curve');
      return new Point(x, y);
    }
    throw new Error('invalid public key encoding');
  }

  static fromPrivateKey(priv) { return Point.fromJacobian(mulBase(privNum(priv))); }

  get isZero() { return this.x === null; }

  jacobian() { return this.x === null ? INF : [this.x, this.y, 1n]; }

  toBytes(compressed = true) {
    if (this.x === null) throw new Error('the point at infinity has no encoding');
    const x = numberToBytes(this.x);
    if (compressed) return concatBytes(Uint8Array.of(this.y & 1n ? 3 : 2), x);
    return concatBytes(Uint8Array.of(4), x, numberToBytes(this.y));
  }

  toHex(compressed = true) { return bytesToHex(this.toBytes(compressed)); }

  hasEvenY() { return (this.y & 1n) === 0n; }

  equals(o) { return this.x === o.x && this.y === o.y; }

  negate() { return this.x === null ? this : new Point(this.x, mod(-this.y)); }

  add(o) { return Point.fromJacobian(jadd(this.jacobian(), o.jacobian())); }

  subtract(o) { return this.add(o.negate()); }

  double() { return Point.fromJacobian(jdouble(this.jacobian())); }

  // k · this for a scalar k (reduced mod n; 0 gives the point at infinity).
  // The generator is recognised by value so G-multiples always take the faster fixed-base path.
  multiply(k) {
    const s = mod(typeof k === 'bigint' ? k : bytesToNumber(toBytes(k)), N);
    if (this.x === GX && this.y === GY) return Point.fromJacobian(mulBase(s));
    return Point.fromJacobian(mulPoint(this.jacobian(), s));
  }
}
Point.BASE = new Point(GX, GY);
Point.ZERO = new Point(null, null);

function liftXNum(x) {
  if (x <= 0n || x >= P) return null;
  const y = sqrt(M(x * x * x + 7n));
  if (y === null) return null;
  return new Point(x, y & 1n ? P - y : y);
}

// The point with x coordinate x (bytes or bigint) and an even y (BIP-340 lift_x); throws when there is none.
export function liftX(x) {
  const p = liftXNum(typeof x === 'bigint' ? x : bytesToNumber(bytes32(x, 'x coordinate')));
  if (!p) throw new Error('x is not on the curve');
  return p;
}

// --- keys --------------------------------------------------------------------------------------

export function isValidPrivateKey(priv) {
  try { privNum(priv); return true; } catch { return false; }
}

export const getPublicKey = (priv, compressed = true) => Point.fromPrivateKey(priv).toBytes(compressed);

export function isValidPublicKey(pub) {
  try { Point.fromBytes(pub); return true; } catch { return false; }
}

export const convertPublicKey = (pub, compressed = true) => Point.fromBytes(pub).toBytes(compressed);

// (priv + tweak) mod n: BIP-32 private child keys; throws when the tweak is >= n or the result is zero.
export function privateAdd(priv, tweak) {
  const t = bytesToNumber(bytes32(tweak, 'tweak'));
  if (t >= N) throw new Error('tweak out of range');
  const r = mod(privNum(priv) + t, N);
  if (r === 0n) throw new Error('tweaked private key is zero');
  return numberToBytes(r);
}

export const privateNegate = (priv) => numberToBytes(N - privNum(priv));

export function privateMultiply(priv, tweak) {
  const t = bytesToNumber(bytes32(tweak, 'tweak'));
  if (t === 0n || t >= N) throw new Error('tweak out of range');
  return numberToBytes(mod(privNum(priv) * t, N));
}

// P + tweak · G: BIP-32 public child keys; throws when the tweak is >= n or the result is infinity.
export function publicAdd(pub, tweak, compressed = true) {
  const t = bytesToNumber(bytes32(tweak, 'tweak'));
  if (t >= N) throw new Error('tweak out of range');
  const r = Point.fromJacobian(jadd(Point.fromBytes(pub).jacobian(), mulBase(t)));
  if (r.isZero) throw new Error('tweaked public key is infinity');
  return r.toBytes(compressed);
}

export function publicMultiply(pub, tweak, compressed = true) {
  const t = bytesToNumber(bytes32(tweak, 'tweak'));
  if (t === 0n || t >= N) throw new Error('tweak out of range');
  return Point.fromBytes(pub).multiply(t).toBytes(compressed);
}

export function publicCombine(pubs, compressed = true) {
  let acc = INF;
  for (const p of pubs) acc = jadd(acc, Point.fromBytes(p).jacobian());
  const r = Point.fromJacobian(acc);
  if (r.isZero) throw new Error('the sum is infinity');
  return r.toBytes(compressed);
}

export const publicNegate = (pub, compressed = true) => Point.fromBytes(pub).negate().toBytes(compressed);

// ECDH: priv · Pub as an encoded point (compressed: 33 bytes; the shared x coordinate is bytes 1..33).
// Raw point, not a key: hash it (libsecp256k1's default ECDH hashes the compressed point with SHA-256) or feed it
// to HKDF before use. The result is never infinity: Pub is validated, priv in [1, n-1] and n is prime.
export function getSharedSecret(priv, pub, compressed = true) {
  return Point.fromBytes(pub).multiply(privNum(priv)).toBytes(compressed);
}

// --- ECDSA -------------------------------------------------------------------------------------

export class Signature {
  // r, s: bigint in [1, n-1]; recovery: 0..3 or undefined (bit 0: R.y odd, bit 1: R.x >= n).
  constructor(r, s, recovery) {
    this.r = r;
    this.s = s;
    this.recovery = recovery;
  }

  // 64 bytes r || s, big-endian. Range checks (1..n-1) are left to verify / recover, which must check anyway.
  static fromCompact(bytes) {
    const b = typeof bytes === 'string' ? hexToBytes(bytes) : toBytes(bytes);
    if (b.length !== 64) throw new Error('compact signature: 64 bytes expected');
    return new Signature(bytesToNumber(b.subarray(0, 32)), bytesToNumber(b.subarray(32)));
  }

  // DER (X.690): 30 len 02 len r 02 len s. strict: the BIP-66 rules (minimal lengths and integers, no negative
  // numbers, nothing after the sequence).
  static fromDER(bytes, { strict = true } = {}) {
    const b = typeof bytes === 'string' ? hexToBytes(bytes) : toBytes(bytes);
    const fail = (why) => { throw new Error('invalid DER signature: ' + why); };
    // 8..72 bytes: the smallest and largest well-formed secp256k1 DER signatures (two 1..33-byte integers + headers).
    // Strict parsing matters for consensus code: lax DER made Bitcoin transactions malleable before BIP-66.
    if (b.length < 8 || b.length > 72) fail('length');
    if (b[0] !== 0x30) fail('no sequence');
    if (b[1] !== b.length - 2) fail('sequence length');
    let o = 2;
    const int = () => {
      if (b[o] !== 0x02) fail('no integer');
      const len = b[o + 1];
      if (!len || o + 2 + len > b.length) fail('integer length');
      const v = b.subarray(o + 2, o + 2 + len);
      if (strict) {
        if (v[0] & 0x80) fail('negative integer');
        if (len > 1 && v[0] === 0 && !(v[1] & 0x80)) fail('integer padding');
      }
      o += 2 + len;
      return bytesToNumber(v);
    };
    const r = int(), s = int();
    if (o !== b.length) fail('trailing bytes');
    return new Signature(r, s);
  }

  toCompact() { return concatBytes(numberToBytes(this.r), numberToBytes(this.s)); }

  toDER() {
    const int = (n) => {
      let v = numberToBytes(n);
      let i = 0;
      while (i < 31 && v[i] === 0) i++;
      v = v.subarray(i);
      if (v[0] & 0x80) v = concatBytes(Uint8Array.of(0), v);
      return concatBytes(Uint8Array.of(2, v.length), v);
    };
    const body = concatBytes(int(this.r), int(this.s));
    return concatBytes(Uint8Array.of(0x30, body.length), body);
  }

  // (r, s) and (r, n - s) both verify; low-S picks one canonical form so a third party cannot change a signature's
  // bytes (transaction malleability, BIP-62 / BIP-146, Ethereum EIP-2).
  hasHighS() { return this.s > HALF_N; }

  // The low-S twin (s <= n/2): the same signature for verifiers, flips the parity bit of the recovery id.
  normalizeS() {
    if (!this.hasHighS()) return this;
    return new Signature(this.r, N - this.s, this.recovery === undefined ? undefined : this.recovery ^ 1);
  }

  recoverPublicKey(hash, compressed = true) { return ecdsaRecover(this, this.recovery, hash, compressed); }
}

// bits2int of a 32-byte hash reduced modulo n (RFC 6979 section 2.3.2 / 2.3.4).
// Exactly 32 bytes are required: qlen = 256, so bits2int is plain big-endian conversion; other lengths would need
// truncation rules, and passing an unhashed message by mistake fails loudly instead of signing garbage.
const hashNum = (hash) => bytesToNumber(bytes32(hash, 'message hash'));

// RFC 6979 section 3.2 with HMAC-SHA256: candidate nonces k for the private key and the hash; extraEntropy (32 bytes)
// is appended to the seed like libsecp256k1's nonce data.
// Deterministic k = HMAC_DRBG(x, h): same key and hash always give the same signature, and k is unpredictable
// without x. This removes the RNG from signing entirely - repeated or biased random k is how ECDSA keys are lost
// (PS3 2010, Android SecureRandom 2013). A generator, so the rare k >= n or r = 0 / s = 0 cases continue the DRBG
// exactly as RFC 6979 3.2 step h.3 says (K = HMAC(K, V || 0x00), V = HMAC(K, V)).
// Encodings: int2octets(x) and bits2octets(h) are both 32-byte big-endian, h reduced mod n first.
export function* rfc6979(hash, priv, extraEntropy = null) {
  const x = numberToBytes(privNum(priv));
  const h = numberToBytes(mod(hashNum(hash), N));
  const extra = extraEntropy ? toBytes(extraEntropy) : new Uint8Array(0);
  let V = new Uint8Array(32).fill(1), K = new Uint8Array(32);
  K = hmac(sha256, K, concatBytes(V, Uint8Array.of(0), x, h, extra));
  V = hmac(sha256, K, V);
  K = hmac(sha256, K, concatBytes(V, Uint8Array.of(1), x, h, extra));
  V = hmac(sha256, K, V);
  for (;;) {
    V = hmac(sha256, K, V);
    const k = bytesToNumber(V);
    if (k >= 1n && k < N) yield k;
    K = hmac(sha256, K, concatBytes(V, Uint8Array.of(0)));
    V = hmac(sha256, K, V);
  }
}

// lowR: Bitcoin Core's R grinding (CKey::Sign): retry with extra entropy = little-endian counter 1, 2, … until r < 2^255,
// which makes DER signatures one byte shorter; signatures equal Core's.
export function ecdsaSign(hash, priv, { lowS = true, extraEntropy = null, lowR = false } = {}) {
  if (lowR) {
    let sig = ecdsaSign(hash, priv, { lowS, extraEntropy });
    for (let counter = 1; sig.r >> 255n; counter++) {
      const e = new Uint8Array(32);
      e[0] = counter & 0xff; e[1] = (counter >>> 8) & 0xff; e[2] = (counter >>> 16) & 0xff; e[3] = counter >>> 24;
      sig = ecdsaSign(hash, priv, { lowS, extraEntropy: e });
    }
    return sig;
  }
  // s = k^-1 (z + r d) mod n. Recovery id: bit 0 = parity of R.y, bit 1 = R.x >= n (r was reduced; happens with
  // probability ~2^-128). normalizeS flips bit 0 because negating s corresponds to negating R.
  const d = privNum(priv);
  const z = mod(hashNum(hash), N);
  for (const k of rfc6979(hash, d, extraEntropy)) {
    const R = toAffine(mulBase(k));
    const r = mod(R[0], N);
    if (r === 0n) continue;
    const s = mod(invert(k, N) * (z + r * d), N);
    if (s === 0n) continue;
    const sig = new Signature(r, s, (R[1] & 1n ? 1 : 0) | (R[0] >= N ? 2 : 0));
    return lowS ? sig.normalizeS() : sig;
  }
  throw new Error('unreachable');
}

const asSignature = (sig) => (sig instanceof Signature ? sig : Signature.fromCompact(sig));

// Verifies a signature of a 32-byte hash. lowS: also reject s > n/2 (Bitcoin's standardness rule, Ethereum's EIP-2).
// R = u1 G + u2 Q with u1 = z / s, u2 = r / s; valid iff x(R) mod n = r. Returns false (never throws) for any
// malformed input, so a verifier cannot be crashed by attacker data. Public inputs only: timing is irrelevant here.
export function ecdsaVerify(sig, hash, pub, { lowS = false } = {}) {
  try {
    const { r, s } = asSignature(sig);
    if (r <= 0n || r >= N || s <= 0n || s >= N) return false;
    if (lowS && s > HALF_N) return false;
    const Q = Point.fromBytes(pub);
    const w = invert(s, N);
    const u1 = mod(hashNum(hash) * w, N), u2 = mod(r * w, N);
    const X = toAffine(jadd(mulBase(u1), mulPoint(Q.jacobian(), u2)));
    return !!X && mod(X[0], N) === r;
  } catch {
    return false;
  }
}

// The public key that made a signature of a hash, from the recovery id (0..3).
export function ecdsaRecover(sig, recovery, hash, compressed = true) {
  const { r, s } = asSignature(sig);
  if (!(recovery >= 0 && recovery <= 3)) throw new Error('recovery id must be 0..3');
  if (r <= 0n || r >= N || s <= 0n || s >= N) throw new Error('invalid signature');
  const x = recovery & 2 ? r + N : r;
  const R0 = liftXNum(x);
  if (!R0) throw new Error('invalid signature: R is not on the curve');
  const R = (R0.y & 1n) === BigInt(recovery & 1) ? R0 : R0.negate();
  const ri = invert(r, N);
  const z = mod(hashNum(hash), N);
  // Q = r⁻¹ (s·R − z·G)
  const Q = Point.fromJacobian(jadd(mulPoint(R.jacobian(), mod(s * ri, N)), jneg(mulBase(mod(z * ri, N)))));
  if (Q.isZero) throw new Error('invalid signature: recovered infinity');
  return Q.toBytes(compressed);
}

// --- BIP-340 Schnorr signatures and BIP-341 tweaks -----------------------------------------------

const TAGS = new Map();
// SHA256(SHA256(tag) || SHA256(tag) || parts...)
// Domain separation (BIP-340): the 64-byte prefix is exactly one SHA-256 block, so hashes under different tags are
// unrelated functions. The prefix per tag is cached (a handful of fixed tags in practice).
export function taggedHash(tag, ...parts) {
  let pre = TAGS.get(tag);
  if (!pre) { const t = sha256(utf8ToBytes(tag)); pre = concatBytes(t, t); TAGS.set(tag, pre); }
  const h = sha256.create().update(pre);
  for (const p of parts) h.update(toBytes(p));
  return h.digest();
}

// The 32-byte x-only public key of a private key (BIP-340).
export const schnorrPublicKey = (priv) => numberToBytes(Point.fromPrivateKey(priv).x);

const msgBytes = (m) => (typeof m === 'string' ? hexToBytes(m) : toBytes(m));

// BIP-340 signing: d is negated if needed so P = dG has even y; t = d XOR hash_aux(aux) masks d against
// side channels in the nonce hash; k = hash_nonce(t || P || m) mod n is deterministic given aux, so a broken RNG
// degrades to deterministic signing instead of leaking d. Fresh aux (default: 32 CSPRNG bytes) is still recommended.
// Messages are arbitrary-length bytes (hex strings are decoded), not required to be 32-byte hashes.
export function schnorrSign(msg, priv, auxRand = randomBytes(32)) {
  const m = msgBytes(msg);
  const d0 = privNum(priv);
  const Pt = Point.fromJacobian(mulBase(d0));
  const d = Pt.hasEvenY() ? d0 : N - d0;
  const px = numberToBytes(Pt.x);
  const aux = bytes32(auxRand, 'aux_rand');
  const t = numberToBytes(d ^ bytesToNumber(taggedHash('BIP0340/aux', aux)));
  const k0 = mod(bytesToNumber(taggedHash('BIP0340/nonce', t, px, m)), N);
  if (k0 === 0n) throw new Error('nonce is zero');
  const R = Point.fromJacobian(mulBase(k0));
  const k = R.hasEvenY() ? k0 : N - k0;
  const rx = numberToBytes(R.x);
  const e = mod(bytesToNumber(taggedHash('BIP0340/challenge', rx, px, m)), N);
  const sig = concatBytes(rx, numberToBytes(mod(k + e * d, N)));
  if (!schnorrVerify(sig, m, px)) throw new Error('signature check failed');
  return sig;
}

export function schnorrVerify(sig, msg, pub) {
  try {
    const sg = typeof sig === 'string' ? hexToBytes(sig) : toBytes(sig);
    const px = bytes32(pub, 'x-only public key');
    if (sg.length !== 64) return false;
    const Pt = liftXNum(bytesToNumber(px));
    if (!Pt) return false;
    const r = bytesToNumber(sg.subarray(0, 32)), s = bytesToNumber(sg.subarray(32));
    // r is an x coordinate (< p), s a scalar (< n): out-of-range values are rejected, not reduced (BIP-340 verify).
    if (r >= P || s >= N) return false;
    const e = mod(bytesToNumber(taggedHash('BIP0340/challenge', sg.subarray(0, 32), px, msgBytes(msg))), N);
    // R = s·G − e·P
    const R = toAffine(jadd(mulBase(s), jneg(mulPoint(Pt.jacobian(), e))));
    return !!R && (R[1] & 1n) === 0n && R[0] === r;
  } catch {
    return false;
  }
}

// BIP-341 tweak t = hash_TapTweak(P || merkle_root) of an internal x-only key (no script tree: P alone).
// Hashing P into t commits the output key to the internal key (and scripts), so the key path cannot hide a script
// path and vice versa. t >= n is astronomically unlikely but must fail, not wrap.
export function taprootTweak(internalX, merkleRoot = null) {
  const px = bytes32(internalX, 'internal key');
  const t = taggedHash('TapTweak', px, merkleRoot ? toBytes(merkleRoot) : new Uint8Array(0));
  if (bytesToNumber(t) >= N) throw new Error('tweak out of range');
  return t;
}

// Output key Q = lift_x(P) + t·G: { key: x(Q) (32 bytes), parity: 0 | 1 }.
export function taprootOutputKey(internalX, merkleRoot = null) {
  const t = bytesToNumber(taprootTweak(internalX, merkleRoot));
  const Q = Point.fromJacobian(jadd(liftX(internalX).jacobian(), mulBase(t)));
  if (Q.isZero) throw new Error('tweaked key is infinity');
  return { key: numberToBytes(Q.x), parity: Number(Q.y & 1n) };
}

// The private key of the output key (key path spending): d = d' or n − d' for an even y, then d + t.
export function taprootTweakPrivateKey(priv, merkleRoot = null) {
  const d0 = privNum(priv);
  const Pt = Point.fromJacobian(mulBase(d0));
  const d = Pt.hasEvenY() ? d0 : N - d0;
  const t = bytesToNumber(taprootTweak(numberToBytes(Pt.x), merkleRoot));
  const r = mod(d + t, N);
  if (r === 0n) throw new Error('tweaked private key is zero');
  return numberToBytes(r);
}
