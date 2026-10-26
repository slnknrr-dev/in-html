// qr/qr.js - QR Code generator (ISO/IEC 18004). No DOM / Node APIs; tables and formulas shared with the decoder
// come from spec.js.
// Public: qrMatrix(text, ec) -> boolean[][] (m[row][col], true = dark),
//         qrSVG(text, opts)  -> compact '<svg …>' string.
// Private helpers are prefixed qr_ / QR_.
// Single-segment encoding: the most compact of numeric / alphanumeric / byte
// (UTF-8) is chosen. No ECI header is emitted: modern scanners auto-detect
// UTF-8 in byte mode and some older ones mishandle ECI.
// ---------------------------------------------------------------------------

import { ALNUM, EC_BITS, alignmentPositions, charCountBits, dataCodewords, ecBlockCount, ecCodewordsPerBlock,
  formatWord, maskBit, rawModules, versionWord } from './spec.js';

// GF(256) with primitive polynomial x^8+x^4+x^3+x^2+1 (0x11D).
const QR_GF = (() => {
  const exp = new Uint8Array(512), log = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) {
    exp[i] = x; log[x] = i;
    x <<= 1; if (x & 256) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) exp[i] = exp[i - 255];
  return { exp, log };
})();
const QR_GEN_CACHE = new Map();

function qr_mul(a, b) {
  return a && b ? QR_GF.exp[QR_GF.log[a] + QR_GF.log[b]] : 0;
}

// Generator polynomial prod_{i<n} (x - a^i), coefficients highest first (leading 1).
function qr_rsGen(n) {
  let g = QR_GEN_CACHE.get(n);
  if (g) return g;
  g = [1];
  for (let i = 0; i < n; i++) {
    const ng = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      ng[j] ^= g[j];
      ng[j + 1] ^= qr_mul(g[j], QR_GF.exp[i]);
    }
    g = ng;
  }
  QR_GEN_CACHE.set(n, g);
  return g;
}

// Remainder of data(x) * x^n divided by the generator = EC codewords.
function qr_rsRem(data, n) {
  const gen = qr_rsGen(n), rem = new Array(n).fill(0);
  for (const b of data) {
    const f = b ^ rem.shift();
    rem.push(0);
    for (let j = 0; j < n; j++) rem[j] ^= qr_mul(gen[j + 1], f);
  }
  return rem;
}

// Payload bits (without mode/count header) in the most compact single mode.
function qr_segment(text) {
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  if (text && /^[0-9]*$/.test(text)) {
    for (let i = 0; i < text.length; i += 3) {
      const g = text.slice(i, i + 3);
      put(+g, g.length * 3 + 1);
    }
    return { mode: 1, count: text.length, bits };
  }
  if (text && /^[0-9A-Z $%*+\-./:]*$/.test(text)) {
    for (let i = 0; i < text.length; i += 2) {
      const a = ALNUM.indexOf(text[i]);
      if (i + 1 < text.length) put(a * 45 + ALNUM.indexOf(text[i + 1]), 11);
      else put(a, 6);
    }
    return { mode: 2, count: text.length, bits };
  }
  const bytes = new TextEncoder().encode(text);
  for (const b of bytes) put(b, 8);
  return { mode: 4, count: bytes.length, bits };
}

// Choose the smallest version and build the padded data codewords.
function qr_encode(text, ec) {
  const seg = qr_segment(text);
  let v = 1, cap = 0;
  for (; ; v++) {
    if (v > 40) throw new RangeError('QR: data too long');
    const cc = charCountBits(seg.mode, v);
    cap = dataCodewords(v, ec) * 8;
    if (seg.count < 2 ** cc && 4 + cc + seg.bits.length <= cap) break;
  }
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(seg.mode, 4);
  put(seg.count, charCountBits(seg.mode, v));
  for (const b of seg.bits) bits.push(b);
  put(0, Math.min(4, cap - bits.length));          // terminator
  put(0, (8 - (bits.length % 8)) % 8);             // byte align
  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    data.push(b);
  }
  for (let p = 0xec; data.length < cap / 8; p ^= 0xec ^ 0x11) data.push(p);
  return { v, data };
}

// Split into blocks, append RS codewords, interleave.
function qr_interleave(data, v, ec) {
  const nb = ecBlockCount(v, ec), ecLen = ecCodewordsPerBlock(v, ec);
  const raw = rawModules(v) >> 3;
  const nShort = nb - (raw % nb), shortLen = Math.floor(raw / nb);
  const blocks = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const len = shortLen - ecLen + (i < nShort ? 0 : 1);
    const d = data.slice(k, k + len);
    k += len;
    blocks.push([d, qr_rsRem(d, ecLen)]);
  }
  const out = [];
  for (let i = 0; i <= shortLen - ecLen; i++) for (const [d] of blocks) if (i < d.length) out.push(d[i]);
  for (let i = 0; i < ecLen; i++) for (const [, e] of blocks) out.push(e[i]);
  return out;
}

// Draw both copies of the format word (+ the dark module).
function qr_drawFormat(m, fn, ec, mask) {
  const size = m.length, bits = formatWord(ec, mask);
  const set = (x, y, i) => { m[y][x] = ((bits >>> i) & 1) === 1; fn[y][x] = true; };
  for (let i = 0; i <= 5; i++) set(8, i, i);
  set(8, 7, 6); set(8, 8, 7); set(7, 8, 8);
  for (let i = 9; i < 15; i++) set(14 - i, 8, i);
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, i);
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, i);
  m[size - 8][8] = true; fn[size - 8][8] = true;
}

// Standard penalty score (N1=3, N2=3, N3=40, N4=10).
// ISO 18004 section 7.8.3 mask evaluation, all four rules: (1) runs of 5+ same-colour modules cost 3 + (run - 5);
// (2) each 2x2 same-colour square costs 3; (3) a finder-like 1:1:3:1:1 pattern next to 4 light modules costs 40
// (modules outside the symbol count as light, hence the i = -4..size scan); (4) dark ratio deviation from 50 % in
// 5 % steps costs 10 each. The encoder tries all 8 masks and keeps the cheapest - the penalties exist to keep
// scanners from seeing false finders or losing sync in uniform areas.
function qr_penalty(m) {
  const size = m.length;
  let p = 0, dark = 0;
  const line = (get) => {
    // Rule 1: runs >= 5; rule 3: 1:1:3:1:1 with 4 light modules on a side (outside = light).
    let run = 0, prev = null;
    for (let i = 0; i < size; i++) {
      const c = get(i);
      if (c === prev) run++;
      else { if (run >= 5) p += run - 2; run = 1; prev = c; }
    }
    if (run >= 5) p += run - 2;
    const at = (i) => (i >= 0 && i < size ? get(i) : false);
    for (let i = -4; i <= size; i++) {
      if (at(i) || at(i + 1) || at(i + 2) || at(i + 3)) continue;
      // light x4 followed by 1011101, or 1011101 followed by light x4
      if (at(i + 4) && !at(i + 5) && at(i + 6) && at(i + 7) && at(i + 8) && !at(i + 9) && at(i + 10)) p += 40;
      if (at(i - 7) && !at(i - 6) && at(i - 5) && at(i - 4) && at(i - 3) && !at(i - 2) && at(i - 1)) p += 40;
    }
  };
  for (let y = 0; y < size; y++) line((x) => m[y][x]);
  for (let x = 0; x < size; x++) line((y) => m[y][x]);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = m[y][x];
      if (c) dark++;
      if (x < size - 1 && y < size - 1 && c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
    }
  }
  const total = size * size;
  p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return p;
}

function qrMatrix(text, ec = 'M') {
  ec = String(ec || 'M').toUpperCase();
  if (!(ec in EC_BITS)) ec = 'M';
  const { v, data } = qr_encode(String(text ?? ''), ec);
  const cw = qr_interleave(data, v, ec);
  const size = v * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, d) => { m[y][x] = d; fn[y][x] = true; };

  // Timing patterns.
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  // Finder patterns + separators.
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
    }
  }
  // Alignment patterns (skip the three overlapping finder corners).
  const ap = alignmentPositions(v), last = ap.length - 1;
  for (let i = 0; i <= last; i++) {
    for (let j = 0; j <= last; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) set(ap[i] + dx, ap[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }
  // Reserve format areas; version info (v >= 7).
  qr_drawFormat(m, fn, ec, 0);
  if (v >= 7) {
    const vb = versionWord(v);
    for (let i = 0; i < 18; i++) {
      const d = ((vb >>> i) & 1) === 1, a = size - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b, d); set(b, a, d);
    }
  }

  // Codeword placement: two-column zigzag from bottom-right, skipping column 6.
  let bit = 0;
  const nbits = cw.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const up = ((right + 1) & 2) === 0;
    for (let k = 0; k < size; k++) {
      const y = up ? size - 1 - k : k;
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        if (fn[y][x]) continue;
        if (bit < nbits) m[y][x] = ((cw[bit >>> 3] >>> (7 - (bit & 7))) & 1) === 1;
        bit++; // remainder bits stay light
      }
    }
  }

  // Try all masks, keep the lowest penalty.
  const applyMask = (k) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) if (!fn[y][x] && maskBit(k, y, x)) m[y][x] = !m[y][x];
    }
  };
  let best = 0, bestP = Infinity;
  for (let k = 0; k < 8; k++) {
    applyMask(k);
    qr_drawFormat(m, fn, ec, k);
    const p = qr_penalty(m);
    if (p < bestP) { bestP = p; best = k; }
    applyMask(k); // undo (XOR)
  }
  applyMask(best);
  qr_drawFormat(m, fn, ec, best);
  return m;
}

// Compact SVG: one <path> of run-length merged horizontal rects; viewBox in modules.
// bg defaults to white (a light quiet zone is needed for scanning on dark themes);
// pass 'transparent' / 'none' / '' for no background rect.
function qrSVG(text, opts = {}) {
  const { ec = 'M', fg = '#000', bg = '#fff', margin = 4, title = '' } = opts;
  const m = qrMatrix(text, ec), n = m.length;
  const q = Math.max(0, Math.floor(+margin || 0)), w = n + 2 * q;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
  let d = '', px = 0, py = 0, first = true;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!m[y][x]) continue;
      const x0 = x;
      while (x < n && m[y][x]) x++;
      const len = x - x0, ax = x0 + q, ay = y + q;
      // Path ends with z, so the current point returns to the run start: chain relative moves.
      d += (first ? 'M' + ax + ' ' + ay : 'm' + (ax - px) + ' ' + (ay - py)) + 'h' + len + 'v1h-' + len + 'z';
      px = ax; py = ay; first = false;
    }
  }
  const hasBg = bg && bg !== 'transparent' && bg !== 'none';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + w +
    '" width="100%" height="100%" shape-rendering="crispEdges"' +
    (title ? ' role="img"><title>' + esc(title) + '</title>' : ' aria-hidden="true">') +
    (hasBg ? '<rect width="' + w + '" height="' + w + '" fill="' + esc(bg) + '"/>' : '') +
    '<path fill="' + esc(fg) + '" d="' + d + '"/></svg>';
}

export {
  qrMatrix,
  qrSVG
};
