// qr/decode.js - QR Code decoder (ISO/IEC 18004), pure JavaScript, importable in Node:
//   decodeQR({ data: RGBA, width, height }, opts?) -> result | null      finds and decodes a code in an image
//   decodeMatrix(m[row][col], dark = true)          -> result | null      decodes an already sampled matrix
// result: { text, bytes, segments, version, ecLevel, mask, errorsCorrected, location?, mirrored?, inverted? }
// Pipeline: luminance -> hybrid (block-local) binarization -> finder pattern search (1:1:3:1:1 row scan with
// vertical / horizontal / diagonal cross-checks) -> best right-isosceles triple -> module size and dimension ->
// alignment pattern -> perspective transform -> grid sampling -> format / version info -> unmask -> codewords ->
// Reed-Solomon (Berlekamp-Massey, Chien, Forney) -> segments (numeric, alphanumeric, byte + ECI, kanji, hanzi,
// structured append, FNC1). Mirrored symbols are read through the transposed grid, inverted ones by inverting the
// binary image.
import {
  EC_LEVELS, ALNUM, alignmentPositions, blockLayout, charCountBits, dataModulePositions, maskBit,
  nearestFormat, nearestVersion, sizeOfVersion, versionOfSize,
} from './spec.js';

// ---------------------------------------------------------------------------------------------
// GF(256), primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D), generator alpha = 2.

const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x; LOG[x] = i;
  x <<= 1; if (x & 256) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const gmul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
const gdiv = (a, b) => (a ? EXP[LOG[a] + 255 - LOG[b]] : 0);

// Corrects a received block (data + EC codewords, highest power first) in place. Returns the number of corrected
// codewords, or -1 when the errors exceed the capacity (the block is then left unchanged).
// Classic decoder: syndromes (all zero -> no error, fast path) -> Berlekamp-Massey finds the error-locator
// polynomial -> Chien search finds its roots (error positions) -> Forney computes magnitudes. Corrects up to
// ecLen / 2 codewords. If the locator degree does not match the roots found, or the corrected block still has
// non-zero syndromes, it reports failure rather than returning a "corrected" block that is actually wrong -
// miscorrection is the dangerous failure mode of RS.
export function rsCorrect(block, ecLen) {
  const n = block.length;
  const syndromes = (c) => {
    const S = new Uint8Array(ecLen);
    let any = 0;
    for (let j = 0; j < ecLen; j++) {
      const a = EXP[j];
      let s = 0;
      for (let i = 0; i < n; i++) s = gmul(s, a) ^ c[i];
      S[j] = s; any |= s;
    }
    return any ? S : null;
  };
  const S = syndromes(block);
  if (!S) return 0;
  // Berlekamp-Massey: error locator C(x) = prod (1 - X_k x), coefficients ascending.
  let C = [1], B = [1], L = 0, m = 1, b = 1;
  for (let k = 0; k < ecLen; k++) {
    let d = S[k];
    for (let i = 1; i <= L; i++) d ^= gmul(C[i] || 0, S[k - i]);
    if (!d) { m++; continue; }
    const coef = gdiv(d, b), T = C.slice();
    while (C.length < B.length + m) C.push(0);
    for (let i = 0; i < B.length; i++) C[i + m] ^= gmul(coef, B[i]);
    if (2 * L <= k) { L = k + 1 - L; B = T; b = d; m = 1; } else m++;
  }
  if (2 * L > ecLen) return -1;
  for (let i = L + 1; i < C.length; i++) if (C[i]) return -1;
  // Chien search over the n positions (power p = n - 1 - index).
  const pos = [];
  for (let p = 0; p < n; p++) {
    const xinv = EXP[(255 - p) % 255];
    let v = 0;
    for (let i = L; i >= 0; i--) v = gmul(v, xinv) ^ C[i];
    if (!v) pos.push(p);
  }
  if (pos.length !== L) return -1;
  // Forney (first consecutive root alpha^0): e = X * Omega(1/X) / C'(1/X).
  const O = new Uint8Array(ecLen);
  for (let i = 0; i < ecLen; i++) {
    let v = 0;
    for (let j = 0; j <= Math.min(i, L); j++) v ^= gmul(C[j], S[i - j]);
    O[i] = v;
  }
  const fix = [];
  for (const p of pos) {
    const xinv = EXP[(255 - p) % 255];
    let num = 0;
    for (let i = ecLen - 1; i >= 0; i--) num = gmul(num, xinv) ^ O[i];
    let den = 0, pw = 1;
    const x2 = gmul(xinv, xinv);
    for (let i = 1; i <= L; i += 2) { den ^= gmul(C[i], pw); pw = gmul(pw, x2); }
    if (!den) return -1;
    fix.push([n - 1 - p, gmul(EXP[p], gdiv(num, den))]);
  }
  const out = Uint8Array.from(block);
  for (const [i, e] of fix) out[i] ^= e;
  if (syndromes(out)) return -1;
  for (let i = 0; i < n; i++) block[i] = out[i];
  return L;
}

// ---------------------------------------------------------------------------------------------
// Bit stream -> segments

class BitReader {
  constructor(bytes) { this.b = bytes; this.p = 0; }
  left() { return this.b.length * 8 - this.p; }
  read(n) {
    let v = 0;
    for (let i = 0; i < n; i++, this.p++) v = (v << 1) | ((this.b[this.p >> 3] >> (7 - (this.p & 7))) & 1);
    return v >>> 0;
  }
}

// ECI assignment numbers -> WHATWG encoding labels ('latin1' is decoded by hand: the WHATWG label maps to cp1252).
const ECI_CHARSETS = {
  0: 'cp437', 1: 'latin1', 2: 'cp437', 3: 'latin1', 4: 'iso-8859-2', 5: 'iso-8859-3', 6: 'iso-8859-4', 7: 'iso-8859-5',
  8: 'iso-8859-6', 9: 'iso-8859-7', 10: 'iso-8859-8', 11: 'iso-8859-9', 12: 'iso-8859-10', 13: 'iso-8859-11',
  15: 'iso-8859-13', 16: 'iso-8859-14', 17: 'iso-8859-15', 18: 'iso-8859-16', 20: 'shift_jis', 21: 'windows-1250',
  22: 'windows-1251', 23: 'windows-1252', 24: 'windows-1256', 25: 'utf-16be', 26: 'utf-8', 27: 'us-ascii', 28: 'big5',
  29: 'gb18030', 30: 'euc-kr', 170: 'us-ascii',
};

const latin1 = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return s; };

function tryDecoder(label, bytes, fatal = false) {
  if (typeof TextDecoder === 'undefined') return null;
  try { return new TextDecoder(label, { fatal }).decode(bytes); } catch { return null; }
}

// Text of byte-mode data: the ECI charset when one is declared, otherwise strict UTF-8, falling back to ISO-8859-1.
function decodeBytes(bytes, eci) {
  const cs = eci == null ? null : ECI_CHARSETS[eci];
  if (cs === 'latin1') return { text: latin1(bytes), charset: 'iso-8859-1' };
  if (cs && cs !== 'cp437') {
    const s = tryDecoder(cs, bytes);
    if (s != null) return { text: s, charset: cs };
  }
  const u = tryDecoder('utf-8', bytes, true);
  if (u != null) return { text: u, charset: 'utf-8' };
  return { text: latin1(bytes), charset: 'iso-8859-1' };
}

// Parses the corrected data codewords into segments. Returns { text, bytes, segments, ... } or null (invalid).
function parseSegments(data, version) {
  const r = new BitReader(data);
  const segments = [];
  const out = [];        // payload bytes of every segment, in order
  let text = '', eci = null, fnc1 = null, structuredAppend = null;
  let pend = [];         // consecutive byte-mode bytes, decoded together (multi-byte characters may span segments)
  const flush = () => {
    if (!pend.length) return;
    const bytes = Uint8Array.from(pend.splice(0));
    const d = decodeBytes(bytes, eci);
    text += d.text;
    segments.push({ mode: 'byte', text: d.text, bytes, charset: d.charset });
  };
  while (r.left() >= 4) {
    const mode = r.read(4);
    if (mode === 0) break;
    if (mode === 7) {                                    // ECI designator: 1, 2 or 3 bytes
      if (r.left() < 8) return null;
      const b0 = r.read(8);
      let v;
      if ((b0 & 0x80) === 0) v = b0 & 0x7f;
      else if ((b0 & 0xc0) === 0x80) { if (r.left() < 8) return null; v = ((b0 & 0x3f) << 8) | r.read(8); }
      else if ((b0 & 0xe0) === 0xc0) { if (r.left() < 16) return null; v = ((b0 & 0x1f) << 16) | r.read(16); }
      else return null;
      flush();
      eci = v;
      segments.push({ mode: 'eci', value: v });
      continue;
    }
    if (mode === 3) {                                    // structured append header (16 bits)
      if (r.left() < 16) return null;
      structuredAppend = { index: r.read(4), total: r.read(4) + 1, parity: r.read(8) };
      continue;
    }
    if (mode === 5) { fnc1 = { position: 1 }; continue; }
    if (mode === 9) { if (r.left() < 8) return null; fnc1 = { position: 2, application: r.read(8) }; continue; }
    if (![1, 2, 4, 8, 13].includes(mode)) return null;
    let sub = 0;
    if (mode === 13) { if (r.left() < 4) return null; sub = r.read(4); }
    const ccb = charCountBits(mode, version);
    if (r.left() < ccb) return null;
    const count = r.read(ccb);
    if (mode === 4) {
      if (r.left() < count * 8) return null;
      for (let i = 0; i < count; i++) { const b = r.read(8); pend.push(b); out.push(b); }
      continue;
    }
    flush();
    let s = '';
    if (mode === 1) {
      let n = count;
      while (n >= 3) { if (r.left() < 10) return null; const v = r.read(10); if (v >= 1000) return null; s += String(v).padStart(3, '0'); n -= 3; }
      if (n === 2) { if (r.left() < 7) return null; const v = r.read(7); if (v >= 100) return null; s += String(v).padStart(2, '0'); }
      else if (n === 1) { if (r.left() < 4) return null; const v = r.read(4); if (v >= 10) return null; s += String(v); }
      for (const ch of s) out.push(ch.charCodeAt(0));
      segments.push({ mode: 'numeric', text: s });
    } else if (mode === 2) {
      let n = count;
      while (n >= 2) { if (r.left() < 11) return null; const v = r.read(11); if (v >= 2025) return null; s += ALNUM[Math.floor(v / 45)] + ALNUM[v % 45]; n -= 2; }
      if (n === 1) { if (r.left() < 6) return null; const v = r.read(6); if (v >= 45) return null; s += ALNUM[v]; }
      // In FNC1 mode '%' stands for the GS separator and '%%' for a literal '%'.
      if (fnc1) s = s.replace(/%%|%/g, (m) => (m === '%%' ? '%' : '\x1d'));
      for (const ch of s) out.push(ch.charCodeAt(0));
      segments.push({ mode: 'alphanumeric', text: s });
    } else {
      // Kanji (Shift_JIS) or Hanzi (GB2312, subset 1): 13-bit packed double-byte characters.
      if (r.left() < count * 13) return null;
      const bytes = new Uint8Array(count * 2);
      for (let i = 0; i < count; i++) {
        const v = r.read(13);
        let c;
        if (mode === 8) { c = ((Math.floor(v / 0xc0)) << 8) | (v % 0xc0); c += c < 0x1f00 ? 0x8140 : 0xc140; }
        else { c = ((Math.floor(v / 0x60)) << 8) | (v % 0x60); c += c < 0xa00 ? 0xa1a1 : 0xa6a1; }
        bytes[2 * i] = c >> 8; bytes[2 * i + 1] = c & 0xff;
        out.push(c >> 8, c & 0xff);
      }
      const label = mode === 8 ? 'shift_jis' : 'gb18030';
      s = tryDecoder(label, bytes);
      if (s == null) s = '�'.repeat(count);
      segments.push({ mode: mode === 8 ? 'kanji' : 'hanzi', text: s, bytes, charset: label, subset: mode === 13 ? sub : undefined });
    }
    text += s;
  }
  flush();
  const res = { text, bytes: Uint8Array.from(out), segments };
  if (eci != null) res.eci = eci;
  if (fnc1) res.fnc1 = fnc1;
  if (structuredAppend) res.structuredAppend = structuredAppend;
  return res;
}

// ---------------------------------------------------------------------------------------------
// Sampled grid -> result

// Format word of both copies: { ec, mask, distance } of the closest valid word (<= 3 bits apart) or null.
function readFormat(get, n) {
  let a = 0, b = 0;
  for (let i = 0; i <= 5; i++) a |= get(i, 8) << i;
  a |= get(7, 8) << 6; a |= get(8, 8) << 7; a |= get(8, 7) << 8;
  for (let i = 9; i < 15; i++) a |= get(8, 14 - i) << i;
  for (let i = 0; i < 8; i++) b |= get(8, n - 1 - i) << i;
  for (let i = 8; i < 15; i++) b |= get(n - 15 + i, 8) << i;
  const fa = nearestFormat(a), fb = nearestFormat(b);
  const f = fb.distance < fa.distance ? fb : fa;
  return f.distance <= 3 ? f : null;
}

// Version word of both copies (v >= 7): { version, distance } or null.
function readVersion(get, n) {
  let a = 0, b = 0;
  for (let i = 0; i < 18; i++) {
    const x = n - 11 + (i % 3), y = Math.floor(i / 3);
    a |= get(y, x) << i;                                  // top-right block
    b |= get(x, y) << i;                                  // bottom-left block
  }
  const va = nearestVersion(a >>> 0), vb = nearestVersion(b >>> 0);
  const v = vb.distance < va.distance ? vb : va;
  return v.distance <= 3 ? v : null;
}

/**
 * Decodes a grid given as get(row, col) -> 0 | 1 (1 = dark) of size n.
 * Returns the result, { retryVersion } when the version info names another size, or null.
 */
function decodeGrid(get, n, trustSize) {
  let v = versionOfSize(n);
  if (!v) return null;
  const fmt = readFormat(get, n);
  if (!fmt) return null;
  let versionDistance = 0;
  if (v >= 7) {
    const vi = readVersion(get, n);
    if (vi) {
      versionDistance = vi.distance;
      if (vi.version !== v && !trustSize) return { retryVersion: vi.version };
    }
  }
  const { ec, mask } = fmt;
  const pos = dataModulePositions(v);
  const { ecLen, dataLens, total } = blockLayout(v, ec);
  // Codewords in transmission order (unmasked).
  const cw = new Uint8Array(total);
  for (let k = 0; k < total * 8; k++) {
    const p = pos[k], row = (p / n) | 0, col = p - row * n;
    let bit = get(row, col);
    if (maskBit(mask, row, col)) bit ^= 1;
    if (bit) cw[k >> 3] |= 0x80 >> (k & 7);
  }
  // De-interleave into blocks.
  const nb = dataLens.length, maxData = Math.max(...dataLens);
  const blocks = dataLens.map((d) => new Uint8Array(d + ecLen));
  let k = 0;
  for (let i = 0; i < maxData; i++) for (let b = 0; b < nb; b++) if (i < dataLens[b]) blocks[b][i] = cw[k++];
  for (let i = 0; i < ecLen; i++) for (let b = 0; b < nb; b++) blocks[b][dataLens[b] + i] = cw[k++];
  let corrected = 0;
  const data = new Uint8Array(dataLens.reduce((a, b) => a + b, 0));
  let o = 0;
  for (let b = 0; b < nb; b++) {
    const e = rsCorrect(blocks[b], ecLen);
    if (e < 0) return null;
    corrected += e;
    data.set(blocks[b].subarray(0, dataLens[b]), o);
    o += dataLens[b];
  }
  const res = parseSegments(data, v);
  if (!res) return null;
  return {
    text: res.text, bytes: res.bytes, segments: res.segments, version: v, ecLevel: ec, mask, errorsCorrected: corrected,
    formatDistance: fmt.distance, versionDistance,
    ...(res.eci != null ? { eci: res.eci } : {}), ...(res.fnc1 ? { fnc1: res.fnc1 } : {}),
    ...(res.structuredAppend ? { structuredAppend: res.structuredAppend } : {}),
  };
}

/**
 * Decodes an already sampled matrix m[row][col] (booleans or 0/1; `dark` is the value meaning a dark module).
 * Mirrored matrices are tried transposed. Returns the result (without location) or null; never throws on bad input.
 */
export function decodeMatrix(m, dark = true) {
  try {
    const n = m && m.length;
    if (!versionOfSize(n)) return null;
    const d = dark === true || dark === 1 ? (x) => (x ? 1 : 0) : (x) => (x === dark || (!!x === !!dark) ? 1 : 0);
    let r = decodeGrid((row, col) => d(m[row][col]), n, true);
    if (r && !r.retryVersion) return r;
    r = decodeGrid((row, col) => d(m[col][row]), n, true);
    if (r && !r.retryVersion) return { ...r, mirrored: true };
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Image -> binary bitmap

// Luminance 0..255 (alpha composited over white: transparent backgrounds read as light).
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
function luminance(data, w, h) {
  const n = w * h, lum = new Uint8Array(n);
  if (LITTLE_ENDIAN && data.byteOffset % 4 === 0 && data.buffer) {
    // One 32-bit read per pixel (much faster than four byte reads).
    const px = new Uint32Array(data.buffer, data.byteOffset, n);
    for (let i = 0; i < n; i++) {
      const p = px[i], a = p >>> 24;
      let y = ((p & 255) * 77 + ((p >>> 8) & 255) * 150 + ((p >>> 16) & 255) * 29) >> 8;
      if (a !== 255) y = ((y * a + 255 * (255 - a)) / 255) | 0;
      lum[i] = y;
    }
    return lum;
  }
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = data[j + 3];
    let y = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
    if (a !== 255) y = ((y * a + 255 * (255 - a)) / 255) | 0;
    lum[i] = y;
  }
  return lum;
}

// Otsu threshold of a histogram (small images).
// Otsu's method: the threshold maximising between-class variance of the histogram. One global threshold - used only
// for tiny images, where the 8x8-block hybrid binariser has too few blocks to estimate local black points.
function otsu(lum) {
  const hist = new Float64Array(256);
  for (const v of lum) hist[v]++;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, th = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = lum.length - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; th = t; }
  }
  return th;
}

// Hybrid binarization: 8x8 blocks get a black point (mean, or an estimate for flat blocks taken from their
// neighbours), each block is thresholded with the average black point of the surrounding 5x5 blocks. Robust to
// gradients and shadows. Returns Uint8Array (1 = dark).
function binarize(lum, w, h) {
  const out = new Uint8Array(w * h);
  if (w < 40 || h < 40) {
    const th = otsu(lum);
    for (let i = 0; i < lum.length; i++) out[i] = lum[i] <= th ? 1 : 0;
    return out;
  }
  const B = 8, bw = Math.ceil(w / B), bh = Math.ceil(h / B), nb = bw * bh;
  const bsum = new Int32Array(nb), bmin = new Uint8Array(nb), brange = new Uint8Array(nb);
  for (let by = 0; by < bh; by++) {
    const y0 = Math.min(by * B, h - B);
    for (let bx = 0; bx < bw; bx++) {
      const x0 = Math.min(bx * B, w - B);
      let sum = 0, mn = 255, mx = 0;
      for (let y = 0; y < B; y++) {
        const row = (y0 + y) * w + x0;
        for (let x = 0; x < B; x++) {
          const v = lum[row + x];
          sum += v;
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
      }
      const i = by * bw + bx;
      bsum[i] = sum; bmin[i] = mn; brange[i] = mx - mn;
    }
  }
  // Blocks whose range is within the noise level count as flat: the noise floor is estimated from the quietest
  // tenth of the blocks (sensor noise would otherwise turn flat background into speckle).
  const hist = new Int32Array(256);
  for (let i = 0; i < nb; i++) hist[brange[i]]++;
  let p10 = 0;
  for (let acc = 0; p10 < 255 && (acc += hist[p10]) < nb * 0.1; p10++);
  const minDyn = Math.max(24, Math.min(64, Math.round(p10 * 1.3)));
  const bp = new Int32Array(nb);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const i = by * bw + bx, mn = bmin[i];
      let avg = bsum[i] >> 6;
      if (brange[i] <= minDyn) {
        // Flat block: assume background (light) unless the neighbours say the block is darker than they are.
        avg = mn >> 1;
        if (by > 0 && bx > 0) {
          const nbv = (bp[i - bw] + 2 * bp[i - 1] + bp[i - bw - 1]) >> 2;
          if (mn < nbv) avg = nbv;
        }
      }
      bp[i] = avg;
    }
  }
  for (let by = 0; by < bh; by++) {
    const y0 = Math.min(by * B, h - B);
    const cy = Math.min(Math.max(by, 2), bh - 3);
    for (let bx = 0; bx < bw; bx++) {
      const x0 = Math.min(bx * B, w - B);
      const cx = Math.min(Math.max(bx, 2), bw - 3);
      let sum = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const r = (cy + dy) * bw;
        for (let dx = -2; dx <= 2; dx++) sum += bp[r + cx + dx];
      }
      const th = sum / 25;
      for (let y = 0; y < B; y++) {
        const row = (y0 + y) * w + x0;
        for (let x = 0; x < B; x++) out[row + x] = lum[row + x] <= th ? 1 : 0;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Finder patterns

function ratiosOK(sc, loose = 1) {
  const total = sc[0] + sc[1] + sc[2] + sc[3] + sc[4];
  if (total < 7) return false;
  const ms = total / 7, mv = (ms / 2) * loose;
  return Math.abs(ms - sc[0]) < mv && Math.abs(ms - sc[1]) < mv && Math.abs(3 * ms - sc[2]) < 3 * mv &&
    Math.abs(ms - sc[3]) < mv && Math.abs(ms - sc[4]) < mv;
}

// Run lengths of the 1:1:3:1:1 pattern through (x, y) along direction (dx, dy): [sc, endOffset] or null.
function crossCheck(bits, w, h, x, y, dx, dy, maxCount) {
  const at = (k) => { const xx = x + dx * k, yy = y + dy * k; return xx >= 0 && yy >= 0 && xx < w && yy < h ? bits[yy * w + xx] : -1; };
  const sc = [0, 0, 0, 0, 0];
  let k = 0;
  while (at(k) === 1) { sc[2]++; k--; }
  if (at(k) < 0) return null;
  while (at(k) === 0 && sc[1] <= maxCount) { sc[1]++; k--; }
  if (at(k) < 0 || sc[1] > maxCount) return null;
  while (at(k) === 1 && sc[0] <= maxCount) { sc[0]++; k--; }
  if (sc[0] > maxCount) return null;
  k = 1;
  while (at(k) === 1) { sc[2]++; k++; }
  if (at(k) < 0) return null;
  while (at(k) === 0 && sc[3] <= maxCount) { sc[3]++; k++; }
  if (at(k) < 0 || sc[3] > maxCount) return null;
  while (at(k) === 1 && sc[4] <= maxCount) { sc[4]++; k++; }
  if (sc[4] > maxCount) return null;
  return [sc, k];
}

function findFinders(bits, w, h) {
  const centers = [];
  const skip = Math.max(1, Math.min(3, Math.floor(h / 240)));
  const add = (cx, cy, ms) => {
    for (const c of centers) {
      if (Math.abs(c.x - cx) <= c.ms && Math.abs(c.y - cy) <= c.ms && (Math.abs(ms - c.ms) <= 1 || Math.abs(ms - c.ms) <= c.ms)) {
        const n = c.count;
        c.x = (c.x * n + cx) / (n + 1); c.y = (c.y * n + cy) / (n + 1); c.ms = (c.ms * n + ms) / (n + 1); c.count++;
        return;
      }
    }
    centers.push({ x: cx, y: cy, ms, count: 1 });
  };
  const handle = (sc, y, end) => {
    const total = sc[0] + sc[1] + sc[2] + sc[3] + sc[4];
    const cx0 = end - sc[4] - sc[3] - sc[2] / 2;
    const xi = Math.floor(cx0);
    // Vertical cross-check.
    const v = crossCheck(bits, w, h, xi, y, 0, 1, sc[2]);
    if (!v || !ratiosOK(v[0])) return false;
    const vt = v[0].reduce((a, b) => a + b, 0);
    if (5 * Math.abs(vt - total) >= 2 * total) return false;
    const cy = y + v[1] - v[0][4] - v[0][3] - v[0][2] / 2;
    const yi = Math.floor(cy);
    // Horizontal re-check through the refined centre row.
    const hz = crossCheck(bits, w, h, xi, yi, 1, 0, sc[2]);
    if (!hz || !ratiosOK(hz[0])) return false;
    const ht = hz[0].reduce((a, b) => a + b, 0);
    if (5 * Math.abs(ht - total) >= 2 * total) return false;
    const cx = xi + hz[1] - hz[0][4] - hz[0][3] - hz[0][2] / 2;
    // Diagonal check (looser: concentric squares keep the ratios along any line through the centre).
    const dg = crossCheck(bits, w, h, Math.floor(cx), yi, 1, 1, Math.max(sc[2], v[0][2]) * 2);
    if (!dg || !ratiosOK(dg[0], 1.5)) return false;
    add(cx, cy, (vt + ht) / 14);
    return true;
  };
  const sc = [0, 0, 0, 0, 0];
  for (let y = skip >> 1; y < h; y += skip) {
    sc.fill(0);
    let state = 0;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (bits[row + x]) {
        if (state === 1 || state === 3) state++;
        sc[state]++;
      } else if (state === 0) {
        if (sc[0]) { state = 1; sc[1]++; }
      } else if (state === 1 || state === 3) sc[state]++;
      else if (state === 2) { state = 3; sc[3]++; }
      else {
        if (ratiosOK(sc)) handle(sc, y, x);
        sc[0] = sc[2]; sc[1] = sc[3]; sc[2] = sc[4]; sc[3] = 1; sc[4] = 0; state = 3;
      }
    }
    if (state === 4 && ratiosOK(sc)) handle(sc, y, w);
  }
  return centers;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Candidate triples, best first: [{ tl, tr, bl, score }].
function rankTriples(centers, max = 8) {
  // Most confirmed candidates first (false positives are usually seen on fewer rows).
  const c = centers.slice().sort((a, b) => b.count - a.count).slice(0, 16);
  const out = [];
  for (let i = 0; i < c.length; i++) {
    for (let j = i + 1; j < c.length; j++) {
      for (let k = j + 1; k < c.length; k++) {
        const p = [c[i], c[j], c[k]];
        const msMin = Math.min(p[0].ms, p[1].ms, p[2].ms), msMax = Math.max(p[0].ms, p[1].ms, p[2].ms);
        if (msMax > msMin * 2.2) continue;              // strong perspective changes the module size a lot
        const d = [[dist(p[1], p[2]), 0], [dist(p[0], p[2]), 1], [dist(p[0], p[1]), 2]].sort((a, b) => a[0] - b[0]);
        const [A, B, C] = d.map((x) => x[0] * x[0]);
        if (!C) continue;
        const ms = (p[0].ms + p[1].ms + p[2].ms) / 3;
        const side = Math.sqrt(B) / ms;
        if (side < 10 || side > 190) continue;
        const score = (Math.abs(C - 2 * B) + Math.abs(C - 2 * A)) / C + Math.abs(msMax - msMin) / msMax * 0.5;
        if (score > 0.9) continue;
        // Top-left is the vertex opposite the longest side; orientation by the cross product.
        const tl = p[d[2][1]], o = p.filter((x) => x !== tl);
        const cross = (o[0].x - tl.x) * (o[1].y - tl.y) - (o[0].y - tl.y) * (o[1].x - tl.x);
        const [tr, bl] = cross > 0 ? [o[0], o[1]] : [o[1], o[0]];
        out.push({ tl, tr, bl, score: score - Math.min(p[0].count, p[1].count, p[2].count) * 0.002 });
      }
    }
  }
  out.sort((a, b) => a.score - b.score);
  return out.slice(0, max);
}

// Black-white-black run length from (fx, fy) toward (tx, ty) (Bresenham walk).
function bwbRun(bits, w, h, fx, fy, tx, ty) {
  const steep = Math.abs(ty - fy) > Math.abs(tx - fx);
  if (steep) { [fx, fy] = [fy, fx]; [tx, ty] = [ty, tx]; }
  const dx = Math.abs(tx - fx), dy = Math.abs(ty - fy);
  let err = -dx / 2;
  const xs = fx < tx ? 1 : -1, ys = fy < ty ? 1 : -1;
  let state = 0;
  for (let x = fx, y = fy; x !== tx + xs; x += xs) {
    const rx = steep ? y : x, ry = steep ? x : y;
    const dark = rx >= 0 && ry >= 0 && rx < w && ry < h ? bits[ry * w + rx] === 1 : false;
    if ((state === 1) === dark) {
      if (state === 2) return Math.hypot(x - fx, y - fy);
      state++;
    }
    err += dy;
    if (err > 0) { if (y === ty) break; y += ys; err -= dx; }
  }
  if (state === 2) return Math.hypot(tx + xs - fx, ty - fy);
  return NaN;
}

function bwbBoth(bits, w, h, fx, fy, tx, ty) {
  fx = Math.floor(fx); fy = Math.floor(fy); tx = Math.floor(tx); ty = Math.floor(ty);
  let r = bwbRun(bits, w, h, fx, fy, tx, ty);
  let scale = 1, ox = fx - (tx - fx);
  if (ox < 0) { scale = fx / (fx - ox); ox = 0; } else if (ox >= w) { scale = (w - 1 - fx) / (ox - fx); ox = w - 1; }
  let oy = Math.floor(fy - (ty - fy) * scale);
  scale = 1;
  if (oy < 0) { scale = fy / (fy - oy); oy = 0; } else if (oy >= h) { scale = (h - 1 - fy) / (oy - fy); oy = h - 1; }
  ox = Math.floor(fx + (ox - fx) * scale);
  r += bwbRun(bits, w, h, fx, fy, ox, oy);
  return r - 1;
}

function moduleSizeOneWay(bits, w, h, a, b) {
  const e1 = bwbBoth(bits, w, h, a.x, a.y, b.x, b.y), e2 = bwbBoth(bits, w, h, b.x, b.y, a.x, a.y);
  if (Number.isNaN(e1)) return e2 / 7;
  if (Number.isNaN(e2)) return e1 / 7;
  return (e1 + e2) / 14;
}

// ---------------------------------------------------------------------------------------------
// Perspective transform (3x3 homography, column vectors [x y 1])

function squareToQuad(x0, y0, x1, y1, x2, y2, x3, y3) {
  const dx3 = x0 - x1 + x2 - x3, dy3 = y0 - y1 + y2 - y3;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) return [x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0, 0, 1];
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / den, hh = (dx1 * dy3 - dx3 * dy1) / den;
  return [x1 - x0 + g * x1, x3 - x0 + hh * x3, x0, y1 - y0 + g * y1, y3 - y0 + hh * y3, y0, g, hh, 1];
}
function adjugate(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  return [e * i - f * h, c * h - b * i, b * f - c * e, f * g - d * i, a * i - c * g, c * d - a * f, d * h - e * g, b * g - a * h, a * e - b * d];
}
function mul3(p, q) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = p[i * 3] * q[j] + p[i * 3 + 1] * q[3 + j] + p[i * 3 + 2] * q[6 + j];
  return r;
}
// Homography mapping quad src (4 points) onto quad dst.
function quadToQuad(src, dst) {
  const s = squareToQuad(...src.flatMap((p) => [p.x, p.y]));
  const d = squareToQuad(...dst.flatMap((p) => [p.x, p.y]));
  return mul3(d, adjugate(s));
}
function apply(m, x, y) {
  const w = m[6] * x + m[7] * y + m[8];
  return { x: (m[0] * x + m[1] * y + m[2]) / w, y: (m[3] * x + m[4] * y + m[5]) / w };
}

// Least-squares homography (module space -> image) from >= 4 correspondences [{ mx, my, x, y }] (normalized DLT);
// null when degenerate.
// Why a homography and not an affine map: a photographed code is viewed in perspective, so module spacing shrinks
// toward the far edge; an affine fit drifts by several modules on large versions. Points are normalised (centred,
// scaled) before solving - unnormalised DLT is numerically ill-conditioned with pixel coordinates in the thousands.
function fitHomography(pairs) {
  const N = pairs.length;
  if (N < 4) return null;
  let ax = 0, ay = 0, bx = 0, by = 0;
  for (const p of pairs) { ax += p.mx; ay += p.my; bx += p.x; by += p.y; }
  ax /= N; ay /= N; bx /= N; by /= N;
  let sa = 0, sb = 0;
  for (const p of pairs) { sa += Math.hypot(p.mx - ax, p.my - ay); sb += Math.hypot(p.x - bx, p.y - by); }
  if (!sa || !sb) return null;
  sa = Math.SQRT2 * N / sa; sb = Math.SQRT2 * N / sb;
  const M = Array.from({ length: 8 }, () => new Float64Array(9));
  const acc = (row, rhs) => { for (let i = 0; i < 8; i++) { if (!row[i]) continue; for (let j = 0; j < 8; j++) M[i][j] += row[i] * row[j]; M[i][8] += row[i] * rhs; } };
  for (const p of pairs) {
    const u = (p.mx - ax) * sa, v = (p.my - ay) * sa, X = (p.x - bx) * sb, Y = (p.y - by) * sb;
    acc([u, v, 1, 0, 0, 0, -u * X, -v * X], X);
    acc([0, 0, 0, u, v, 1, -u * Y, -v * Y], Y);
  }
  for (let c = 0; c < 8; c++) {                         // Gauss-Jordan with partial pivoting
    let piv = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-10) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (f) for (let k = c; k < 9; k++) M[r][k] -= f * M[c][k];
    }
  }
  const hn = [...M.map((r, i) => r[8] / r[i]), 1];
  const ta = [sa, 0, -sa * ax, 0, sa, -sa * ay, 0, 0, 1], tbi = [1 / sb, 0, bx, 0, 1 / sb, by, 0, 0, 1];
  return mul3(tbi, mul3(hn, ta));
}

// ---------------------------------------------------------------------------------------------
// Alignment patterns: 5x5 template (dark ring, light ring, dark centre) matched along the local symbol axes.

function bitAt(bits, w, h, x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  return xi >= 0 && yi >= 0 && xi < w && yi < h ? bits[yi * w + xi] : 0;
}

// Template matches within `allowance` modules of `est` (ex / ey = one module along the symbol axes), grouped into
// blobs: [{ x, y, score }] ranked by score and closeness (one score point ~ one module of distance).
function alignmentCandidates(bits, w, h, est, ex, ey, allowance, minScore = 23) {
  const ms = (Math.hypot(ex.x, ex.y) + Math.hypot(ey.x, ey.y)) / 2;
  const step = Math.max(0.75, ms / 3), r = allowance * ms;
  const hits = [];
  for (let oy = -r; oy <= r; oy += step) {
    for (let ox = -r; ox <= r; ox += step) {
      const cx = est.x + ox, cy = est.y + oy;
      let s = 0, miss = 0;
      for (let j = -2; j <= 2 && miss <= 25 - minScore; j++) {
        for (let i = -2; i <= 2; i++) {
          const want = Math.max(Math.abs(i), Math.abs(j)) !== 1 ? 1 : 0;
          if (bitAt(bits, w, h, cx + i * ex.x + j * ey.x, cy + i * ex.y + j * ey.y) === want) s++; else miss++;
        }
      }
      if (s >= minScore) hits.push({ x: cx, y: cy, s });
    }
  }
  hits.sort((a, b) => b.s - a.s || dist(a, est) - dist(b, est));
  const groups = [];
  for (const p of hits) {
    const g = groups.find((q) => dist(q, p) <= ms * 1.5);
    if (g) { if (p.s === g.score) { g.sx += p.x; g.sy += p.y; g.k++; } continue; }
    groups.push({ x: p.x, y: p.y, sx: p.x, sy: p.y, k: 1, score: p.s });
  }
  const out = groups.map((g) => ({ x: g.sx / g.k, y: g.sy / g.k, score: g.score }));
  const rank = (p) => dist(p, est) / ms - (p.score - minScore);
  return out.sort((a, b) => rank(a) - rank(b));
}

// Version information read around the top-right and bottom-left finders with their local module size, before the
// symbol size is known: { version, distance } or null.
function readVersionLocal(bits, w, h, tl, tr, bl) {
  const unit = (a, b) => { const d = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: (b.x - a.x) / d, y: (b.y - a.y) / d }; };
  const ux = unit(tl, tr), uy = unit(tl, bl);
  const local = (c, back, side) => {
    const sx = bwbBoth(bits, w, h, c.x, c.y, c.x + back.x, c.y + back.y) / 7;
    const sy = bwbBoth(bits, w, h, c.x, c.y, c.x + side.x, c.y + side.y) / 7;
    return Number.isFinite(sx) && Number.isFinite(sy) && sx > 0.8 && sy > 0.8 ? [sx, sy] : null;
  };
  const far = Math.max(dist(tl, tr), dist(tl, bl));
  const lt = local(tr, { x: -ux.x * far, y: -ux.y * far }, { x: uy.x * far, y: uy.y * far });
  const lb = local(bl, { x: uy.x * -far, y: uy.y * -far }, { x: ux.x * far, y: ux.y * far });
  let best = null;
  if (lt) {
    let word = 0;
    for (let i = 0; i < 18; i++) {
      const dx = -7 + (i % 3), dy = Math.floor(i / 3) - 3;
      word |= bitAt(bits, w, h, tr.x + dx * ux.x * lt[0] + dy * uy.x * lt[1], tr.y + dx * ux.y * lt[0] + dy * uy.y * lt[1]) << i;
    }
    best = nearestVersion(word >>> 0);
  }
  if (lb) {
    let word = 0;
    for (let i = 0; i < 18; i++) {
      const dx = Math.floor(i / 3) - 3, dy = -7 + (i % 3);
      word |= bitAt(bits, w, h, bl.x + dx * ux.x * lb[1] + dy * uy.x * lb[0], bl.y + dx * ux.y * lb[1] + dy * uy.y * lb[0]) << i;
    }
    const v = nearestVersion(word >>> 0);
    if (!best || v.distance < best.distance) best = v;
  }
  return best && best.distance <= 3 ? best : null;
}

// Locates the alignment patterns of a version >= 2 progressively: each pattern is predicted from the finder-based
// affine map corrected by the residuals of the patterns found so far (inverse-distance weighting), nearest to the
// known points first, so strong perspective is followed step by step. Returns the found [{ mx, my, x, y }].
// Homography of the three finders alone: their centres fix six parameters, the change of the module size between
// finders along each edge (black-white-black runs, 7 modules) fixes the two perspective terms.
function finderHomography(bits, w, h, tl, tr, bl, n) {
  const dx = { x: tr.x - tl.x, y: tr.y - tl.y }, dy = { x: bl.x - tl.x, y: bl.y - tl.y };
  const run = (c, d, s) => bwbBoth(bits, w, h, c.x, c.y, c.x + s * d.x, c.y + s * d.y);
  const ratio = (a, b) => { const r = Math.sqrt(a / b); return Number.isFinite(r) && r > 0 ? Math.min(1.6, Math.max(0.6, r)) : 1; };
  const g = 1 / ratio(run(tr, dx, -1), run(tl, dx, 1)) - 1, k = 1 / ratio(run(bl, dy, -1), run(tl, dy, 1)) - 1;
  // (u, v) = normalized finder-centre coordinates; X = (TL + u (TR (1+g) - TL) + v (BL (1+k) - TL)) / (1 + g u + k v).
  const M = [tr.x * (1 + g) - tl.x, bl.x * (1 + k) - tl.x, tl.x, tr.y * (1 + g) - tl.y, bl.y * (1 + k) - tl.y, tl.y, g, k, 1];
  const s = 1 / (n - 7);
  return mul3(M, [s, 0, -3.5 * s, 0, s, -3.5 * s, 0, 0, 1]);
}

function locateAlignments(bits, w, h, v, n, tl, tr, bl, Hf, log) {
  const ap = alignmentPositions(v), last = ap.length - 1;
  const aff = (mx, my) => apply(Hf, mx, my);
  const known = [{ mx: 3.5, my: 3.5, rx: 0, ry: 0 }, { mx: n - 3.5, my: 3.5, rx: 0, ry: 0 }, { mx: 3.5, my: n - 3.5, rx: 0, ry: 0 }];
  const predict = (mx, my) => {
    let sw = 0, sx = 0, sy = 0;
    for (const k of known) {
      const wgt = 1 / ((k.mx - mx) ** 2 + (k.my - my) ** 2 + 0.01);
      sw += wgt; sx += wgt * k.rx; sy += wgt * k.ry;
    }
    const a = aff(mx, my);
    return { x: a.x + sx / sw, y: a.y + sy / sw };
  };
  const pending = [];
  for (let i = 0; i <= last; i++) {
    for (let j = 0; j <= last; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      pending.push({ mx: ap[j] + 0.5, my: ap[i] + 0.5 });
    }
  }
  const found = [];
  while (pending.length) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < pending.length; i++) {
      const p = pending[i];
      for (const k of known) { const d = (k.mx - p.mx) ** 2 + (k.my - p.my) ** 2; if (d < bd) { bd = d; bi = i; } }
    }
    const p = pending.splice(bi, 1)[0];
    const c = predict(p.mx, p.my), cx = predict(p.mx + 1, p.my), cy = predict(p.mx, p.my + 1);
    const lex = { x: cx.x - c.x, y: cx.y - c.y }, ley = { x: cy.x - c.x, y: cy.y - c.y };
    // A lone pattern (versions 2-6) may sit far from the parallelogram estimate under strong perspective.
    const cand = alignmentCandidates(bits, w, h, c, lex, ley, last === 1 ? 6 : 4)[0];
    if (log) log.push({ mx: p.mx, my: p.my, px: c.x, py: c.y, cand });
    if (!cand) continue;
    const a = aff(p.mx, p.my);
    known.push({ mx: p.mx, my: p.my, rx: cand.x - a.x, ry: cand.y - a.y });
    found.push({ mx: p.mx, my: p.my, x: cand.x, y: cand.y });
  }
  return found;
}

// Homography from the finders and the found alignment patterns, dropping outliers (> 1 module off the fit).
function fitGrid(tl, tr, bl, n, found, ms) {
  const pairs = [{ mx: 3.5, my: 3.5, ...tl }, { mx: n - 3.5, my: 3.5, ...tr }, { mx: 3.5, my: n - 3.5, ...bl }, ...found];
  for (;;) {
    if (pairs.length < 5) return null;
    const H = fitHomography(pairs);
    if (!H) return null;
    let worst = -1, wd = 0;
    for (let i = 3; i < pairs.length; i++) {
      const q = apply(H, pairs[i].mx, pairs[i].my), d = Math.hypot(q.x - pairs[i].x, q.y - pairs[i].y);
      if (d > wd) { wd = d; worst = i; }
    }
    if (wd <= ms) return H;
    pairs.splice(worst, 1);
  }
}

// Samples the grid of dimension n through homography m: Uint8Array n*n (1 = dark). vote: majority of the centre
// (counted twice) and four points 0.22 module off it.
function sampleGrid(bits, w, h, m, n, vote) {
  const g = new Uint8Array(n * n);
  const o = 0.22;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const p = apply(m, c + 0.5, r + 0.5);
      if (!vote) { g[r * n + c] = bitAt(bits, w, h, p.x, p.y); continue; }
      let s = bitAt(bits, w, h, p.x, p.y) * 2;
      for (const [dx, dy] of [[-o, -o], [o, -o], [-o, o], [o, o]]) { const q = apply(m, c + 0.5 + dx, r + 0.5 + dy); s += bitAt(bits, w, h, q.x, q.y); }
      g[r * n + c] = s >= 3 ? 1 : 0;
    }
  }
  return g;
}

// Tries one finder triple: returns the result with its location, or null.
function decodeTriple(bits, w, h, t, dbg) {
  const { tl, tr, bl } = t;
  const ms = (moduleSizeOneWay(bits, w, h, tl, tr) + moduleSizeOneWay(bits, w, h, tl, bl)) / 2;
  if (!(ms >= 1)) return null;
  const est = Math.round(((dist(tl, tr) + dist(tl, bl)) / 2) / ms) + 7;
  const v0 = Math.min(40, Math.max(1, Math.round((est - 17) / 4)));
  const vl = v0 >= 5 ? readVersionLocal(bits, w, h, tl, tr, bl) : null;
  const info = dbg ? { tl, tr, bl, ms, est, v0, vl: vl && vl.version, tried: [] } : null;
  if (dbg) dbg.triples.push(info);
  const tried = new Set();
  const queue = [...(vl ? [vl.version] : []), v0, v0 + 1, v0 - 1].filter((v) => v >= 1 && v <= 40);
  while (queue.length) {
    const v = queue.shift();
    if (tried.has(v)) continue;
    tried.add(v);
    const n = sizeOfVersion(v);
    // Candidate geometries, most accurate first: least-squares fit over all alignment patterns, the quad with the
    // bottom-right alignment pattern, the parallelogram of the three finders.
    const geoms = [];
    const log = info ? [] : null;
    const Hf = finderHomography(bits, w, h, tl, tr, bl, n);
    const found = v >= 2 ? locateAlignments(bits, w, h, v, n, tl, tr, bl, Hf, log) : [];
    if (found.length >= 2) { const H = fitGrid(tl, tr, bl, n, found, ms); if (H) geoms.push({ H, align: found }); }
    const brA = found.find((p) => p.mx === n - 6.5 && p.my === n - 6.5);
    if (brA) geoms.push({ H: quadToQuad([{ x: 3.5, y: 3.5 }, { x: n - 3.5, y: 3.5 }, { x: n - 6.5, y: n - 6.5 }, { x: 3.5, y: n - 3.5 }], [tl, tr, brA, bl]), align: [brA] });
    geoms.push({ H: Hf, align: [] });
    geoms.push({ H: quadToQuad([{ x: 3.5, y: 3.5 }, { x: n - 3.5, y: 3.5 }, { x: n - 3.5, y: n - 3.5 }, { x: 3.5, y: n - 3.5 }],
      [tl, tr, { x: tr.x - tl.x + bl.x, y: tr.y - tl.y + bl.y }, bl]), align: [] });
    if (info) info.tried.push({ v, found: found.length, geoms: geoms.length, log });
    let retry = false;
    for (const { H, align } of geoms) {
      for (const vote of ms >= 3.5 ? [true, false] : [false, true]) {
        const g = sampleGrid(bits, w, h, H, n, vote);
        for (const mirrored of [false, true]) {
          const res = decodeGrid(mirrored ? (r, c) => g[c * n + r] : (r, c) => g[r * n + c], n, false);
          if (!res) continue;
          if (res.retryVersion) { if (!tried.has(res.retryVersion)) { queue.unshift(res.retryVersion); retry = true; } continue; }
          const corner = (x, y) => apply(H, x, y);
          const loc = {
            topLeft: corner(0, 0), topRight: corner(n, 0), bottomRight: corner(n, n), bottomLeft: corner(0, n),
            finders: [tl, tr, bl].map((p) => ({ x: p.x, y: p.y })), alignment: align.map((p) => ({ x: p.x, y: p.y })),
            moduleSize: ms,
          };
          if (mirrored) [loc.topRight, loc.bottomLeft] = [loc.bottomLeft, loc.topRight];
          return { ...res, location: loc, ...(mirrored ? { mirrored: true } : {}) };
        }
        if (retry) break;
      }
      if (retry) break;
    }
  }
  return null;
}

function decodeBits(bits, w, h, maxTriples, dbg) {
  const centers = findFinders(bits, w, h);
  if (dbg) { dbg.centers = centers; dbg.triples = []; }
  if (centers.length < 3) return null;
  for (const t of rankTriples(centers, maxTriples)) {
    const r = decodeTriple(bits, w, h, t, dbg);
    if (r) return r;
  }
  return null;
}

// 2x box downscale of a luminance image.
function halve(lum, w, h) {
  const w2 = w >> 1, h2 = h >> 1, out = new Uint8Array(w2 * h2);
  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < w2; x++) {
      const i = 2 * y * w + 2 * x;
      out[y * w2 + x] = (lum[i] + lum[i + 1] + lum[i + w] + lum[i + w + 1] + 2) >> 2;
    }
  }
  return { lum: out, w: w2, h: h2 };
}

// 3x3 binomial smoothing of a luminance image (noise suppression before binarization).
function smooth(lum, w, h) {
  const t = new Uint16Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const r = y * w;
    for (let x = 0; x < w; x++) t[r + x] = lum[r + (x > 0 ? x - 1 : x)] + 2 * lum[r + x] + lum[r + (x < w - 1 ? x + 1 : x)];
  }
  for (let y = 0; y < h; y++) {
    const r = y * w, up = y > 0 ? r - w : r, dn = y < h - 1 ? r + w : r;
    for (let x = 0; x < w; x++) out[r + x] = (t[up + x] + 2 * t[r + x] + t[dn + x] + 8) >> 4;
  }
  return out;
}

/**
 * Finds and decodes a QR code in an RGBA image { data, width, height } (ImageData works).
 * opts: { inverted: true (also try light-on-dark) | false | 'only',
 *         effort: 'normal' (retries on a smoothed copy, and at half size for large images) | 'fast' (one pass),
 *         maxTriples: 8 (finder triples tried per pass), debug: {} (filled with intermediate results) }
 * Returns { text, bytes, segments, version, ecLevel, mask, errorsCorrected, location: { topLeft, topRight,
 * bottomRight, bottomLeft, finders, alignment, moduleSize }, mirrored?, inverted? } or null. Never throws on bad
 * pixels; throws a TypeError only for a malformed argument.
 */
export function decodeQR(img, opts = {}) {
  const { data, width: w, height: h } = img || {};
  if (!data || !(w > 0) || !(h > 0) || data.length < w * h * 4) throw new TypeError('decodeQR: expected { data: RGBA, width, height }');
  const inv = opts.inverted ?? true, maxTriples = opts.maxTriples || 8, fast = opts.effort === 'fast';
  const run = (lum, lw, lh) => {
    const bits = binarize(lum, lw, lh);
    if (opts.debug) (opts.debug.passes ||= []).push({ bits: bits.slice(), w: lw, h: lh });
    let r = null;
    if (inv !== 'only') r = decodeBits(bits, lw, lh, maxTriples, opts.debug);
    if (!r && inv) {
      for (let i = 0; i < bits.length; i++) bits[i] ^= 1;
      r = decodeBits(bits, lw, lh, maxTriples);
      if (r) r.inverted = true;
    }
    return r;
  };
  const lum = luminance(data, w, h);
  let r = run(lum, w, h);
  if (r || fast) return r;
  // Noisy images: the same pass on a smoothed copy.
  r = run(smooth(lum, w, h), w, h);
  if (r) return r;
  // Large images (big modules, fine noise): half size.
  if (Math.min(w, h) >= 400) {
    const hv = halve(lum, w, h);
    r = run(hv.lum, hv.w, hv.h);
    if (r) scaleLocation(r.location, 2);
  }
  return r;
}

function scaleLocation(loc, s) {
  for (const k of ['topLeft', 'topRight', 'bottomRight', 'bottomLeft', 'alignment']) if (loc[k]) loc[k] = { x: loc[k].x * s, y: loc[k].y * s };
  loc.finders = loc.finders.map((p) => ({ x: p.x * s, y: p.y * s }));
  loc.moduleSize *= s;
}

export { EC_LEVELS };
