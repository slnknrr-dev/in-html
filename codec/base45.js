// codec/base45.js - Base45 (RFC 9285; QR-code friendly: its alphabet is QR alphanumeric mode, used by EU digital
// COVID certificates). Two bytes -> three characters, a last single byte -> two.
//   base45Encode(bytes) -> string        base45Decode(text) -> Uint8Array
//
// Why base 45 at all: QR alphanumeric mode packs 2 characters in 11 bits (5.5 bits/char), so 3 chars per 2 bytes cost
// 16.5 bits per 16 bits of payload (~3 % overhead) - far better than base64 in QR byte mode (8 bits/char, 33 %).
// 45^3 = 91125 >= 65536 is what makes the 2 -> 3 mapping possible.
// Digit order is LITTLE-endian (least significant digit first), as RFC 9285 specifies; big-endian output would
// decode to different bytes in every conforming reader.

// Exactly the 45 characters of QR alphanumeric mode, in QR's own order (the RFC reuses it). Space is a member.
export const B45 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

export function base45Encode(bytes) {
  let out = '';
  // Pairs: n = 256a + b in [0, 65535], emitted as c + 45d + 2025e (2025 = 45^2), digits c, d, e in that order.
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const n = bytes[i] * 256 + bytes[i + 1];
    out += B45[n % 45] + B45[Math.floor(n / 45) % 45] + B45[Math.floor(n / 2025)];
  }
  // Odd tail byte: 0..255 needs only two digits (45^2 = 2025 > 255). No padding character exists in Base45.
  if (bytes.length % 2) {
    const n = bytes[bytes.length - 1];
    out += B45[n % 45] + B45[Math.floor(n / 45)];
  }
  return out;
}

// Strict decoder (RFC 9285 section 4.2 requires rejecting malformed input): no whitespace skipping, because space is
// a data character here - silently dropping it would corrupt the payload instead of failing.
export function base45Decode(text) {
  const s = String(text);
  const v = [...s].map((c, i) => {
    const d = B45.indexOf(c);
    if (d < 0) throw new Error(`invalid character "${c}" at ${i + 1}`);
    return d;
  });
  // Lengths are 3k or 3k + 2; a 3k + 1 remainder cannot come from any byte string.
  if (v.length % 3 === 1) throw new Error('impossible length');
  const out = new Uint8Array(Math.floor(v.length / 3) * 2 + (v.length % 3 ? 1 : 0));
  let o = 0;
  for (let i = 0; i < v.length; i += 3) {
    if (i + 2 < v.length) {
      // Overflow check: three digits reach 45^3 - 1 = 91124, but only <= 65535 is a valid pair. "GGW" (= 65536) must
      // fail, not wrap; the RFC lists exactly this as a mandatory rejection.
      const n = v[i] + v[i + 1] * 45 + v[i + 2] * 2025;
      if (n > 0xffff) throw new Error(`group ${i / 3 + 1} is out of range`);
      out[o++] = n >> 8;
      out[o++] = n & 255;
    } else {
      const n = v[i] + v[i + 1] * 45;
      if (n > 0xff) throw new Error('last group is out of range');
      out[o++] = n;
    }
  }
  return out;
}
