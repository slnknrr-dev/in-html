// qr/spec.js - QR Code (ISO/IEC 18004) tables and capacity math shared by the decoder, the styled renderer and the
// applications: error-correction blocks, alignment positions, format / version words, function-module and codeword
// layout, the single-segment mode choice of qr.js and qrInfo() (version, fill and characters left for a text).
// Pure functions, no DOM.

export const EC_LEVELS = ['L', 'M', 'Q', 'H'];
// Two-bit level indicator stored in the format word.
export const EC_BITS = { L: 1, M: 0, Q: 3, H: 2 };
// Share of codewords each level can restore (nominal, used for user-facing budgets).
export const EC_RECOVERY = { L: 0.07, M: 0.15, Q: 0.25, H: 0.30 };
export const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
// Mode indicators (4 bits).
export const MODE = { terminator: 0, numeric: 1, alphanumeric: 2, structuredAppend: 3, byte: 4, fnc1First: 5, eci: 7, kanji: 8, fnc1Second: 9, hanzi: 13 };

// Error-correction codewords per block, index = version - 1 (same tables as qr.js).
const ECC = {
  L: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};
// Number of error-correction blocks, index = version - 1.
const BLOCKS = {
  L: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

const normEc = (ec) => { const e = String(ec || 'M').toUpperCase(); return e in EC_BITS ? e : 'M'; };

export const sizeOfVersion = (v) => v * 4 + 17;
// Version of a symbol size (0 when the size is not 4v+17 for v = 1..40).
export const versionOfSize = (n) => (n >= 21 && n <= 177 && (n - 17) % 4 === 0 ? (n - 17) / 4 : 0);
export const ecCodewordsPerBlock = (v, ec) => ECC[normEc(ec)][v - 1];
export const ecBlockCount = (v, ec) => BLOCKS[normEc(ec)][v - 1];

// Data-area modules (data + EC codewords + remainder bits) of a version.
// Closed form (as in Nayuki's reference): all modules minus finders+separators+format, timing patterns, alignment
// patterns (na per side, minus the three overlapping finders) and, from version 7, the two 18-module version blocks.
// Computing it avoids a 40-entry table that would have to be transcribed without error.
export function rawModules(v) {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const na = Math.floor(v / 7) + 2;
    r -= (25 * na - 10) * na - 55;
    if (v >= 7) r -= 36;
  }
  return r;
}
export const totalCodewords = (v) => rawModules(v) >> 3;
export const remainderBits = (v) => rawModules(v) & 7;
export const dataCodewords = (v, ec) => totalCodewords(v) - ecCodewordsPerBlock(v, ec) * ecBlockCount(v, ec);
export const capacityBits = (v, ec) => dataCodewords(v, ec) * 8;

// Block structure: { ecLen, dataLens: [per block], total }. Short blocks come first, long ones carry one more
// data codeword.
export function blockLayout(v, ec) {
  const nb = ecBlockCount(v, ec), ecLen = ecCodewordsPerBlock(v, ec), total = totalCodewords(v);
  const nShort = nb - (total % nb), shortLen = Math.floor(total / nb);
  const dataLens = [];
  for (let i = 0; i < nb; i++) dataLens.push(shortLen - ecLen + (i < nShort ? 0 : 1));
  return { ecLen, dataLens, total };
}

// Interleaving: for each transmitted codeword index, its [block, index inside the block (data first, then EC)].
export function codewordOrder(v, ec) {
  const { ecLen, dataLens } = blockLayout(v, ec);
  const out = [], maxData = Math.max(...dataLens);
  for (let i = 0; i < maxData; i++) for (let b = 0; b < dataLens.length; b++) if (i < dataLens[b]) out.push([b, i]);
  for (let i = 0; i < ecLen; i++) for (let b = 0; b < dataLens.length; b++) out.push([b, dataLens[b] + i]);
  return out;
}

// Alignment pattern centre coordinates (ascending) of a version.
export function alignmentPositions(v) {
  if (v === 1) return [];
  const n = Math.floor(v / 7) + 2, size = v * 4 + 17;
  const step = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let p = size - 7; out.length < n; p -= step) out.splice(1, 0, p);
  return out;
}

const MODE_INDEX = { 1: 0, 2: 1, 4: 2, 8: 3, 13: 3 };
const CC_BITS = [[10, 12, 14], [9, 11, 13], [8, 16, 16], [8, 10, 12]];
// Character-count indicator length of a mode (name or indicator) at a version.
export function charCountBits(mode, v) {
  const m = typeof mode === 'string' ? MODE[mode] : mode;
  return CC_BITS[MODE_INDEX[m]][v < 10 ? 0 : v < 27 ? 1 : 2];
}

// 15-bit format word: BCH(15,5) with generator 0x537, XOR mask 0x5412.
export function formatWord(ec, mask) {
  const d = (EC_BITS[normEc(ec)] << 3) | (mask & 7);
  let r = d;
  for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
  return ((d << 10) | r) ^ 0x5412;
}
// 18-bit version word: BCH(18,6) with generator 0x1F25.
export function versionWord(v) {
  let r = v;
  for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
  return (v << 12) | r;
}

export function popcount(x) {
  let n = 0;
  for (x >>>= 0; x; x &= x - 1) n++;
  return n;
}

// All valid format / version words, built on first use (encoder-only pages never pay for them).
let FORMAT_WORDS = null;
let VERSION_WORDS = null;
export const formatWords = () => FORMAT_WORDS || (FORMAT_WORDS = EC_LEVELS.flatMap((ec) => [0, 1, 2, 3, 4, 5, 6, 7].map((mask) => ({ word: formatWord(ec, mask), ec, mask }))));
export const versionWords = () => VERSION_WORDS || (VERSION_WORDS = Array.from({ length: 34 }, (_, i) => ({ word: versionWord(i + 7), version: i + 7 })));

// Nearest valid format word: { ec, mask, distance } (distance = differing bits).
export function nearestFormat(word) {
  let best = null;
  for (const f of formatWords()) {
    const d = popcount(f.word ^ word);
    if (!best || d < best.distance) best = { ec: f.ec, mask: f.mask, distance: d };
  }
  return best;
}
// Nearest valid version word (versions 7..40): { version, distance }.
export function nearestVersion(word) {
  let best = null;
  for (const f of versionWords()) {
    const d = popcount(f.word ^ word);
    if (!best || d < best.distance) best = { version: f.version, distance: d };
  }
  return best;
}

// Data mask condition (row, col) - the same formulas as qr.js (x = col, y = row).
export function maskBit(mask, row, col) {
  switch (mask) {
    case 0: return (row + col) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return col % 3 === 0;
    case 3: return (row + col) % 3 === 0;
    case 4: return (Math.floor(col / 3) + Math.floor(row / 2)) % 2 === 0;
    case 5: return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6: return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    default: return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
  }
}

// Function modules of a version: Uint8Array(size * size), index row * size + col, values
// 0 data, 1 finder / separator, 2 timing, 3 alignment, 4 format (and the dark module), 5 version.
const FN_CACHE = new Map();
export function functionModules(v) {
  let fn = FN_CACHE.get(v);
  if (fn) return fn;
  const n = sizeOfVersion(v);
  fn = new Uint8Array(n * n);
  const set = (r, c, k) => { if (r >= 0 && c >= 0 && r < n && c < n) fn[r * n + c] = k; };
  for (let i = 0; i < n; i++) { set(6, i, 2); set(i, 6, 2); }
  for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) set(r0 + r, c0 + c, 1);
  }
  const ap = alignmentPositions(v), last = ap.length - 1;
  for (let i = 0; i <= last; i++) {
    for (let j = 0; j <= last; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(ap[i] + dr, ap[j] + dc, 3);
    }
  }
  for (let i = 0; i < 9; i++) { set(8, i, 4); set(i, 8, 4); }
  for (let i = 0; i < 8; i++) { set(8, n - 1 - i, 4); set(n - 1 - i, 8, 4); }
  if (v >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = n - 11 + (i % 3), b = Math.floor(i / 3);
      set(b, a, 5); set(a, b, 5);
    }
  }
  FN_CACHE.set(v, fn);
  return fn;
}

// Module indexes (row * size + col) of the data area in placement order: bit k of the codeword stream sits at
// positions[k] (two-column zigzag from the bottom-right corner, skipping the vertical timing column). The trailing
// remainder bits are included.
const POS_CACHE = new Map();
export function dataModulePositions(v) {
  let pos = POS_CACHE.get(v);
  if (pos) return pos;
  const n = sizeOfVersion(v), fn = functionModules(v);
  pos = new Int32Array(rawModules(v));
  let k = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const up = ((right + 1) & 2) === 0;
    for (let i = 0; i < n; i++) {
      const row = up ? n - 1 - i : i;
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        if (!fn[row * n + col]) pos[k++] = row * n + col;
      }
    }
  }
  POS_CACHE.set(v, pos);
  return pos;
}

// --- mode choice and capacity (mirrors qr.js: one segment, the most compact of numeric / alphanumeric / byte) ---

const RE_NUM = /^[0-9]*$/;
const RE_ALNUM = /^[0-9A-Z $%*+\-./:]*$/;
let ENC = null;
const utf8Length = (s) => (ENC ||= new TextEncoder()).encode(s).length;

// 'numeric' | 'alphanumeric' | 'byte' (an empty text is a 0-byte byte segment, like qr.js).
export function chooseMode(text) {
  const s = String(text ?? '');
  if (s && RE_NUM.test(s)) return 'numeric';
  if (s && RE_ALNUM.test(s)) return 'alphanumeric';
  return 'byte';
}

// Payload bits of n characters in a mode (without the mode / count header).
export function payloadBits(mode, n) {
  if (mode === 'numeric') return 10 * Math.floor(n / 3) + [0, 4, 7][n % 3];
  if (mode === 'alphanumeric') return 11 * Math.floor(n / 2) + 6 * (n % 2);
  if (mode === 'kanji') return 13 * n;
  return 8 * n;
}

// Segment of a text as qr.js encodes it: { mode, count (characters or bytes), bits (payload bits) }.
export function segmentOf(text) {
  const s = String(text ?? '');
  const mode = chooseMode(s);
  const count = mode === 'byte' ? utf8Length(s) : s.length;
  return { mode, count, bits: payloadBits(mode, count) };
}

// Largest character (byte) count of a mode that fits a version and level.
export function maxChars(v, ec, mode) {
  const cc = charCountBits(mode, v);
  const avail = capacityBits(v, ec) - 4 - cc;
  if (avail < 0) return 0;
  let n;
  if (mode === 'numeric') n = Math.floor(avail / 10) * 3 + (avail % 10 >= 7 ? 2 : avail % 10 >= 4 ? 1 : 0);
  else if (mode === 'alphanumeric') n = Math.floor(avail / 11) * 2 + (avail % 11 >= 6 ? 1 : 0);
  else if (mode === 'kanji') n = Math.floor(avail / 13);
  else n = Math.floor(avail / 8);
  return Math.min(n, 2 ** cc - 1);
}

// Smallest version holding a segment at a level (0 when even version 40 is too small).
export function versionFor(seg, ec) {
  for (let v = 1; v <= 40; v++) {
    const cc = charCountBits(seg.mode, v);
    if (seg.count < 2 ** cc && 4 + cc + seg.bits <= capacityBits(v, ec)) return v;
  }
  return 0;
}

/**
 * What qrMatrix(text, ec) produces, without building it:
 *   { fits, version, size, ec, mode, count, dataBits, capacityBits, fill (0..1+), charsLeft, maxChars }
 * count / charsLeft / maxChars are characters for numeric and alphanumeric, bytes (UTF-8) for byte mode.
 * When the text does not fit version 40: fits false, version 0, size 0 and the figures of version 40.
 */
export function qrInfo(text, ec = 'M') {
  ec = normEc(ec);
  const seg = segmentOf(text);
  const v = versionFor(seg, ec);
  const vv = v || 40;
  const dataBits = 4 + charCountBits(seg.mode, vv) + seg.bits;
  const cap = capacityBits(vv, ec);
  const max = maxChars(vv, ec, seg.mode);
  return {
    fits: v > 0, version: v, size: v ? sizeOfVersion(v) : 0, ec, mode: seg.mode, count: seg.count,
    dataBits, capacityBits: cap, fill: dataBits / cap, charsLeft: max - seg.count, maxChars: max,
  };
}
