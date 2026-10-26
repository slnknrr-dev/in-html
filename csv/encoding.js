// csv/encoding.js - text encoding of byte input: byte order marks (UTF-8, UTF-16 LE / BE), BOM-less UTF-16, strict
// UTF-8 validation and a windows-1251 / windows-1252 fallback for legacy single-byte files; UTF-8 / UTF-16 output.
//
//   detectEncoding(bytes) -> { encoding, bom }        bom: number of BOM bytes at the start
//   decodeBytes(bytes, { encoding }?) -> { text, encoding }
//   encodeText(text, { encoding = 'utf-8', bom = false }) -> Uint8Array
//
// Detection order, most to least reliable: BOM, then BOM-less UTF-16 by zero-byte statistics, then strict UTF-8
// validation (random legacy bytes almost never form valid multi-byte sequences), then a Cyrillic / Latin guess for
// single-byte files. Never throws: the worst case is mojibake the user can fix by choosing an encoding.

const toBytes = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b));

// BOM-less UTF-16: in Latin / Cyrillic text every other byte is mostly zero (LE: odd bytes, BE: even bytes).
function utf16Guess(b) {
  const n = Math.min(b.length - (b.length % 2), 4096);
  if (n < 4) return null;
  let evenZero = 0, oddZero = 0;
  for (let i = 0; i < n; i += 2) {
    if (b[i] === 0) evenZero++;
    if (b[i + 1] === 0) oddZero++;
  }
  const half = n / 2;
  if (oddZero > half * 0.3 && evenZero < half * 0.05) return 'utf-16le';
  if (evenZero > half * 0.3 && oddZero < half * 0.05) return 'utf-16be';
  return null;
}

// windows-1251 letters: 0xC0-0xFF (А-я), Ё ё Ґ ґ Є є І і Ї ї.
const CYR_EXTRA = new Set([0xa8, 0xb8, 0xa5, 0xb4, 0xaa, 0xba, 0xb2, 0xb3, 0xaf, 0xbf]);
const isAsciiLetter = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);

// Cyrillic words are runs of high bytes; accented Latin letters sit between ASCII letters.
// windows-1251 Cyrillic letters occupy 0xC0-0xFF and appear in runs (whole words); windows-1252 accented letters sit
// alone between ASCII letters. Counting both patterns separates the two code pages well on real text.
function singleByteGuess(b) {
  let cyr = 0, lat = 0;
  const n = Math.min(b.length, 1 << 16);
  for (let i = 0; i < n; i++) {
    const c = b[i];
    if (c < 0x80) continue;
    const letter = c >= 0xc0 || CYR_EXTRA.has(c);
    if (!letter) continue;
    const p = i > 0 ? b[i - 1] : 32, q = i + 1 < b.length ? b[i + 1] : 32;
    const hiP = p >= 0xc0 || CYR_EXTRA.has(p), hiQ = q >= 0xc0 || CYR_EXTRA.has(q);
    if (hiP || hiQ) cyr++;
    if (isAsciiLetter(p) || isAsciiLetter(q)) lat++;
  }
  return cyr > lat ? 'windows-1251' : 'windows-1252';
}

export function detectEncoding(bytes) {
  const b = toBytes(bytes);
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return { encoding: 'utf-8', bom: 3 };
  if (b[0] === 0xff && b[1] === 0xfe) return { encoding: 'utf-16le', bom: 2 };
  if (b[0] === 0xfe && b[1] === 0xff) return { encoding: 'utf-16be', bom: 2 };
  const u16 = utf16Guess(b);
  if (u16) return { encoding: u16, bom: 0 };
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(b);
    return { encoding: 'utf-8', bom: 0 };
  } catch {
    return { encoding: singleByteGuess(b), bom: 0 };
  }
}

export function decodeBytes(bytes, { encoding } = {}) {
  const b = toBytes(bytes);
  const det = detectEncoding(b);
  const enc = encoding || det.encoding;
  const skip = enc === det.encoding ? det.bom : 0;
  let text;
  try { text = new TextDecoder(enc).decode(b.subarray(skip)); }
  catch { text = new TextDecoder('utf-8').decode(b.subarray(skip)); }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return { text, encoding: enc };
}

// UTF-16 is written per UTF-16 code unit, so surrogate pairs pass through correctly. Any encoding other than UTF-16
// produces UTF-8 (TextEncoder supports nothing else); legacy single-byte output is not offered.
export function encodeText(text, { encoding = 'utf-8', bom = false } = {}) {
  const s = String(text);
  if (encoding === 'utf-16le' || encoding === 'utf-16be') {
    const le = encoding === 'utf-16le';
    const off = bom ? 2 : 0;
    const out = new Uint8Array(off + s.length * 2);
    if (bom) { out[0] = le ? 0xff : 0xfe; out[1] = le ? 0xfe : 0xff; }
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      out[off + 2 * i] = le ? c & 0xff : c >> 8;
      out[off + 2 * i + 1] = le ? c >> 8 : c & 0xff;
    }
    return out;
  }
  const body = new TextEncoder().encode(s);
  if (!bom) return body;
  const out = new Uint8Array(body.length + 3);
  out.set([0xef, 0xbb, 0xbf]);
  out.set(body, 3);
  return out;
}
