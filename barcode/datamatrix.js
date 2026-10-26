// barcode/datamatrix.js - Data Matrix ECC 200 (ISO/IEC 16022) encoder: ASCII encodation (digit pairs, upper shift
// for Latin-1, FNC1 for GS1 DataMatrix), Base 256 for binary data, the 24 square and 6 rectangular sizes, Reed-Solomon
// over GF(256) / 0x12D with interleaved blocks, the standard module placement and the finder / clock patterns of
// every data region. Output: a boolean matrix, SVG, and a reader of the codewords back from a matrix (for checks).
import { GS, buildGs1, parseGs1 } from './gs1.js';

// [rows, cols, region rows, region cols, data codewords, ecc codewords, blocks]
export const DM_SIZES = [
  [10, 10, 8, 8, 3, 5, 1], [12, 12, 10, 10, 5, 7, 1], [14, 14, 12, 12, 8, 10, 1], [16, 16, 14, 14, 12, 12, 1],
  [18, 18, 16, 16, 18, 14, 1], [20, 20, 18, 18, 22, 18, 1], [22, 22, 20, 20, 30, 20, 1], [24, 24, 22, 22, 36, 24, 1],
  [26, 26, 24, 24, 44, 28, 1], [32, 32, 14, 14, 62, 36, 1], [36, 36, 16, 16, 86, 42, 1], [40, 40, 18, 18, 114, 48, 1],
  [44, 44, 20, 20, 144, 56, 1], [48, 48, 22, 22, 174, 68, 1], [52, 52, 24, 24, 204, 84, 2], [64, 64, 14, 14, 280, 112, 2],
  [72, 72, 16, 16, 368, 144, 4], [80, 80, 18, 18, 456, 192, 4], [88, 88, 20, 20, 576, 224, 4], [96, 96, 22, 22, 696, 272, 4],
  [104, 104, 24, 24, 816, 336, 6], [120, 120, 18, 18, 1050, 408, 6], [132, 132, 20, 20, 1304, 496, 8],
  [144, 144, 22, 22, 1558, 620, 10],
  [8, 18, 6, 16, 5, 7, 1], [8, 32, 6, 14, 10, 11, 1], [12, 26, 10, 24, 16, 14, 1], [12, 36, 10, 16, 22, 18, 1],
  [16, 36, 14, 16, 32, 24, 1], [16, 48, 14, 22, 49, 28, 1],
].map(([rows, cols, rr, rc, data, ecc, blocks]) => ({ rows, cols, rr, rc, data, ecc, blocks, square: rows === cols }));

// --- GF(256), Reed-Solomon --------------------------------------------------------------------------------------

// Log/antilog tables over GF(256) with Data Matrix's primitive polynomial 0x12D (QR uses 0x11D - not
// interchangeable). EXP is doubled to 512 entries so mul() needs no "mod 255" on LOG[a] + LOG[b].
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x12d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
const GEN = new Map();
function generator(n) {
  if (GEN.has(n)) return GEN.get(n);
  let g = [1];
  for (let i = 1; i <= n; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let k = 0; k < g.length; k++) { next[k] ^= g[k]; next[k + 1] ^= mul(g[k], EXP[i]); }
    g = next;
  }
  GEN.set(n, g);
  return g;
}
// ECC codewords of one block (polynomial division, highest degree first).
// Shift-register (LFSR) form of the division: r holds the running remainder; each data codeword feeds back through
// the generator coefficients. Generators (roots alpha^1..alpha^n) are memoised per ECC length.
export function rsEncode(data, n) {
  const g = generator(n);
  const r = new Array(n).fill(0);
  for (const d of data) {
    const f = d ^ r[0];
    r.shift(); r.push(0);
    if (f) for (let k = 0; k < n; k++) r[k] ^= mul(g[k + 1], f);
  }
  return r;
}

// Data + interleaved ECC of a size.
export function addEcc(cw, size) {
  const { blocks, ecc } = size;
  const per = ecc / blocks;
  const out = [...cw];
  const eccAll = new Array(ecc);
  for (let b = 0; b < blocks; b++) {
    const block = cw.filter((_, i) => i % blocks === b);
    const e = rsEncode(block, per);
    e.forEach((v, k) => { eccAll[k * blocks + b] = v; });
  }
  return out.concat(eccAll);
}

// --- encodation -------------------------------------------------------------------------------------------------

export const DM_FNC1 = 232;

/**
 * ASCII encodation of tokens (char codes 0-255, -1 = FNC1): digit pairs 130-229, characters + 1, upper shift 235 for
 * 128-255. -> codewords.
 */
export function asciiCodewords(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === -1) { out.push(DM_FNC1); continue; }
    const n = tokens[i + 1];
    if (t >= 48 && t <= 57 && n >= 48 && n <= 57) { out.push(130 + (t - 48) * 10 + (n - 48)); i++; continue; }
    if (t < 128) out.push(t + 1);
    else out.push(235, t - 127);
  }
  return out;
}

// Base 256 encodation of bytes (latch 231, length, 255-state randomised), starting at codeword position `pos` (0-based).
// The pseudo-random addition depends on the codeword's absolute position, so the caller must pass where the latch
// sits; randomising avoids long runs of identical codewords that would print as large uniform areas.
export function base256Codewords(bytes, pos = 0) {
  const n = bytes.length;
  const raw = n < 250 ? [n] : [Math.floor(n / 250) + 249, n % 250];
  const body = [...raw, ...bytes];
  const out = [231];
  body.forEach((v, k) => {
    const p = pos + 2 + k;                                   // 1-based position of this codeword
    const r = ((149 * p) % 255) + 1;
    const x = v + r;
    out.push(x <= 255 ? x : x - 256);
  });
  return out;
}

// Pads codewords to the capacity: 129, then the 253-state randomised pad.
export function padCodewords(cw, capacity) {
  const out = [...cw];
  if (out.length < capacity) out.push(129);
  while (out.length < capacity) {
    const p = out.length + 1;
    const r = ((149 * p) % 253) + 1;
    const v = 129 + r;
    out.push(v <= 254 ? v : v - 254);
  }
  return out;
}

export function chooseSize(n, shape = 'square') {
  const list = DM_SIZES.filter((s) => (shape === 'square' ? s.square : shape === 'rect' ? !s.square : true));
  return list.filter((s) => s.data >= n).sort((a, b) => a.rows * a.cols - b.rows * b.cols)[0] || null;
}

// --- placement --------------------------------------------------------------------------------------------------

/** Module placement of the mapping matrix (ISO/IEC 16022 annex F): Int32Array of 10 * codeword + bit, 1 = fixed dark. */
export function placement(nrow, ncol) {
  const a = new Int32Array(nrow * ncol);
  const mod = (row, col, chr, bit) => {
    if (row < 0) { row += nrow; col += 4 - ((nrow + 4) % 8); }
    if (col < 0) { col += ncol; row += 4 - ((ncol + 4) % 8); }
    a[row * ncol + col] = 10 * chr + bit;
  };
  const utah = (row, col, chr) => {
    mod(row - 2, col - 2, chr, 1); mod(row - 2, col - 1, chr, 2); mod(row - 1, col - 2, chr, 3); mod(row - 1, col - 1, chr, 4);
    mod(row - 1, col, chr, 5); mod(row, col - 2, chr, 6); mod(row, col - 1, chr, 7); mod(row, col, chr, 8);
  };
  const corner1 = (chr) => { mod(nrow - 1, 0, chr, 1); mod(nrow - 1, 1, chr, 2); mod(nrow - 1, 2, chr, 3); mod(0, ncol - 2, chr, 4); mod(0, ncol - 1, chr, 5); mod(1, ncol - 1, chr, 6); mod(2, ncol - 1, chr, 7); mod(3, ncol - 1, chr, 8); };
  const corner2 = (chr) => { mod(nrow - 3, 0, chr, 1); mod(nrow - 2, 0, chr, 2); mod(nrow - 1, 0, chr, 3); mod(0, ncol - 4, chr, 4); mod(0, ncol - 3, chr, 5); mod(0, ncol - 2, chr, 6); mod(0, ncol - 1, chr, 7); mod(1, ncol - 1, chr, 8); };
  const corner3 = (chr) => { mod(nrow - 3, 0, chr, 1); mod(nrow - 2, 0, chr, 2); mod(nrow - 1, 0, chr, 3); mod(0, ncol - 2, chr, 4); mod(0, ncol - 1, chr, 5); mod(1, ncol - 1, chr, 6); mod(2, ncol - 1, chr, 7); mod(3, ncol - 1, chr, 8); };
  const corner4 = (chr) => { mod(nrow - 1, 0, chr, 1); mod(nrow - 1, ncol - 1, chr, 2); mod(0, ncol - 3, chr, 3); mod(0, ncol - 2, chr, 4); mod(0, ncol - 1, chr, 5); mod(1, ncol - 3, chr, 6); mod(1, ncol - 2, chr, 7); mod(1, ncol - 1, chr, 8); };
  let chr = 1, row = 4, col = 0;
  do {
    if (row === nrow && col === 0) corner1(chr++);
    if (row === nrow - 2 && col === 0 && ncol % 4) corner2(chr++);
    if (row === nrow - 2 && col === 0 && ncol % 8 === 4) corner3(chr++);
    if (row === nrow + 4 && col === 2 && !(ncol % 8)) corner4(chr++);
    do {
      if (row < nrow && col >= 0 && !a[row * ncol + col]) utah(row, col, chr++);
      row -= 2; col += 2;
    } while (row >= 0 && col < ncol);
    row += 1; col += 3;
    do {
      if (row >= 0 && col < ncol && !a[row * ncol + col]) utah(row, col, chr++);
      row += 2; col -= 2;
    } while (row < nrow && col >= 0);
    row += 3; col += 1;
  } while (row < nrow || col < ncol);
  if (!a[nrow * ncol - 1]) { a[nrow * ncol - 1] = 1; a[nrow * ncol - ncol - 2] = 1; }
  return a;
}

// Symbol matrix (finder and clock patterns of every region) from the codewords.
function buildMatrix(cw, size) {
  const { rows, cols, rr, rc } = size;
  const vr = (rows) / (rr + 2), hr = cols / (rc + 2);
  const nrow = vr * rr, ncol = hr * rc;
  const map = placement(nrow, ncol);
  const m = Array.from({ length: rows }, () => new Array(cols).fill(false));
  for (let R = 0; R < vr; R++) for (let C = 0; C < hr; C++) {
    const top = R * (rr + 2), left = C * (rc + 2);
    for (let c = 0; c < rc + 2; c++) { m[top][left + c] = c % 2 === 0; m[top + rr + 1][left + c] = true; }
    for (let r = 0; r < rr + 2; r++) { m[top + r][left] = true; m[top + r][left + rc + 1] = r % 2 === 1; }
  }
  for (let r = 0; r < nrow; r++) for (let c = 0; c < ncol; c++) {
    const v = map[r * ncol + c];
    const dark = v === 1 ? true : v > 1 ? !!(cw[Math.floor(v / 10) - 1] & (1 << (8 - (v % 10)))) : false;
    const R = Math.floor(r / rr), C = Math.floor(c / rc);
    m[R * (rr + 2) + 1 + (r % rr)][C * (rc + 2) + 1 + (c % rc)] = dark;
  }
  return m;
}

/** Codewords read back from a symbol matrix of a known size (inverse of the placement). */
export function readCodewords(m, size) {
  const { rr, rc, rows, cols } = size;
  const vr = rows / (rr + 2), hr = cols / (rc + 2);
  const nrow = vr * rr, ncol = hr * rc;
  const map = placement(nrow, ncol);
  const cw = new Array(size.data + size.ecc).fill(0);
  for (let r = 0; r < nrow; r++) for (let c = 0; c < ncol; c++) {
    const v = map[r * ncol + c];
    if (v <= 1) continue;
    const R = Math.floor(r / rr), C = Math.floor(c / rc);
    if (m[R * (rr + 2) + 1 + (r % rr)][C * (rc + 2) + 1 + (c % rc)]) cw[Math.floor(v / 10) - 1] |= 1 << (8 - (v % 10));
  }
  return cw;
}

// --- public API -------------------------------------------------------------------------------------------------

/**
 * Data Matrix symbol.
 *   input   text (characters 0-255; '\x1d' stays GS), a Uint8Array (Base 256), or with { gs1: true } a GS1 element
 *           string in any form parseGs1 accepts (HRI, raw with GS, [{ ai, value }])
 *   shape   'square' (default) | 'rect' | 'any'      size  'RxC' to force a size
 * -> { type: 'datamatrix', matrix (boolean[row][col]), rows, cols, codewords, data, hri, size, gs1? }
 */
export function dataMatrix(input, { gs1 = false, shape = 'square', size: want = null } = {}) {
  let cw, hri, data, elements = null;
  if (input instanceof Uint8Array) {
    cw = base256Codewords([...input]);
    hri = ''; data = input;
  } else if (gs1) {
    const els = Array.isArray(input) ? input : parseGs1(input).elements;
    if (!els.length) throw new Error('empty');
    const b = buildGs1(els);
    if (b.issues.length) { const e = new Error('gs1'); e.issues = b.issues; throw e; }
    const tokens = [-1, ...[...b.data].map((ch) => (ch === GS ? -1 : ch.charCodeAt(0)))];
    cw = asciiCodewords(tokens);
    hri = b.hri; data = b.data; elements = b.elements;
  } else {
    const s = String(input ?? '');
    if (!s) throw new Error('empty');
    const tokens = [...s].map((ch) => { const c = ch.codePointAt(0); if (c > 255) throw new Error('chars'); return c; });
    cw = asciiCodewords(tokens);
    // Binary-heavy text is shorter in Base 256.
    const b256 = base256Codewords(tokens);
    if (b256.length < cw.length) cw = b256;
    hri = s; data = s;
  }
  const size = want ? DM_SIZES.find((s) => `${s.rows}x${s.cols}` === want) : chooseSize(cw.length, shape);
  if (!size || size.data < cw.length) throw new Error('length');
  const full = addEcc(padCodewords(cw, size.data), size);
  return { type: gs1 ? 'gs1-datamatrix' : 'datamatrix', matrix: buildMatrix(full, size), rows: size.rows, cols: size.cols, codewords: full, data, hri, size, elements };
}

/** SVG of a matrix code: { quiet (modules, default 2), xdim, unit, fg, bg, title }. */
export function matrixSVG(m, { quiet = 2, xdim = 4, unit = 'px', fg = '#000000', bg = '#ffffff', title = 'Data Matrix' } = {}) {
  const rows = m.length, cols = m[0].length;
  let d = '';
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      if (!m[r][c]) { c++; continue; }
      const s = c;
      while (c < cols && m[r][c]) c++;
      d += `M${s + quiet} ${r + quiet}h${c - s}v1h${s - c}z`;
    }
  }
  const W = cols + 2 * quiet, H = rows + 2 * quiet;
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * xdim}${unit}" height="${H * xdim}${unit}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>`
    + (bg ? `<rect width="100%" height="100%" fill="${esc(bg)}"/>` : '') + `<path fill="${esc(fg)}" shape-rendering="crispEdges" d="${d}"/></svg>`;
}

/** Text of ASCII / Base 256 codewords (data part, pads dropped). FNC1 -> GS (a leading FNC1 sets gs1). */
export function decodeCodewords(cw) {
  let text = '', gs1 = false, upper = false;
  for (let i = 0; i < cw.length; i++) {
    const v = cw[i];
    if (v === 129) break;
    if (v === 231) {
      const unr = (k) => { const r = ((149 * (k + 1)) % 255) + 1; const x = cw[k] - r; return x >= 0 ? x : x + 256; };
      let k = i + 1;
      let n = unr(k++);
      if (n >= 250) n = (n - 249) * 250 + unr(k++);
      for (let j = 0; j < n; j++) text += String.fromCharCode(unr(k++));
      i = k - 1;
      continue;
    }
    if (v === 232) { if (i === 0) gs1 = true; else text += GS; continue; }
    if (v === 235) { upper = true; continue; }
    if (v >= 130 && v <= 229) { text += String(v - 130).padStart(2, '0'); continue; }
    if (v >= 1 && v <= 128) { text += String.fromCharCode(v - 1 + (upper ? 128 : 0)); upper = false; continue; }
    return null;                                              // C40 / Text / X12 / EDIFACT are not produced here
  }
  return { text, gs1 };
}
