// barcode/decode.js - reading linear barcodes: decoders over element widths (EAN-13 / UPC-A, EAN-8, UPC-E with
// EAN-2 / EAN-5 add-ons, Code 128 and GS1-128, Code 39, Code 93, Interleaved 2 of 5 / ITF-14, Codabar), each checked by
// its guards, quiet zones and check characters, and an image scanner: rows (and columns) of an RGBA image are
// binarised with two thresholds, edges are placed with sub-pixel interpolation, both reading directions are tried
// and the results of all scan lines are voted. Pure functions; no DOM at module evaluation.
import { gs1CheckDigit, upcEToA } from './gtin.js';
import { EAN13_PARITY, EAN2_PARITY, EAN5_PARITY, EAN_L, UPCE_PARITY, C128, C39_CHARS, C93, C93_START, CODABAR, ITF_DIGITS, code39Elements, code128Check } from './linear.js';
import { GS, parseGs1 } from './gs1.js';

const runsOfPattern = (p) => { const r = []; let n = 1; for (let i = 1; i <= p.length; i++) { if (p[i] === p[i - 1]) n++; else { r.push(n); n = 1; } } return r; };
const sum = (a, i, n) => { let s = 0; for (let k = 0; k < n; k++) s += a[i + k]; return s; };

// Width signatures (space first for L / G, bar first for R; R has the same widths as L).
const LW = EAN_L.map(runsOfPattern);
const GW = LW.map((w) => [...w].reverse());

// Best digit for 4 widths against signature tables -> { d, set, dist }.
// Widths are normalised to 7 modules (an EAN digit's total) before comparison, so the match is scale-invariant and
// tolerates print gain; nearest-signature with an L1 distance cap (2.2 modules total) instead of exact rounding,
// which fails as soon as ink spread shifts one edge by half a module. Check digits catch the residual errors.
function matchDigit(w, sets) {
  const tot = w[0] + w[1] + w[2] + w[3];
  let best = null;
  for (const [name, table] of sets) {
    for (let d = 0; d < 10; d++) {
      const t = table[d];
      let dist = 0;
      for (let k = 0; k < 4; k++) dist += Math.abs(w[k] * 7 / tot - t[k]);
      if (!best || dist < best.dist) best = { d, set: name, dist };
    }
  }
  return best && best.dist < 2.2 ? best : null;
}
const LG = [['L', LW], ['G', GW]];
const RR = [['R', LW]];

// Runs around a module estimate: all within [lo, hi] modules.
const near = (runs, i, n, m, want) => { for (let k = 0; k < n; k++) { const v = runs[i + k] / m; if (Math.abs(v - want[k]) > 0.6 * Math.max(1, want[k])) return false; } return true; };

// --- EAN / UPC --------------------------------------------------------------------------------------------------

function eanDigits(runs, i, count, sets) {
  const out = [];
  for (let k = 0; k < count; k++) {
    const g = matchDigit([runs[i + 4 * k], runs[i + 4 * k + 1], runs[i + 4 * k + 2], runs[i + 4 * k + 3]], sets);
    if (!g) return null;
    out.push(g);
  }
  return out;
}

function quietOk(runs, i, m, need) { return i <= 0 || runs[i - 1] >= need * m || i - 1 === 0; }

function tryEan13(runs, i) {
  if (i + 59 > runs.length) return null;
  const m = sum(runs, i, 59) / 95;
  if (!quietOk(runs, i, m, 5) || !near(runs, i, 3, m, [1, 1, 1]) || !near(runs, i + 27, 5, m, [1, 1, 1, 1, 1]) || !near(runs, i + 56, 3, m, [1, 1, 1])) return null;
  const left = eanDigits(runs, i + 3, 6, LG), right = eanDigits(runs, i + 32, 6, RR);
  if (!left || !right) return null;
  const parity = left.map((g) => g.set).join('');
  const first = EAN13_PARITY.indexOf(parity);
  if (first < 0) return null;
  const text = first + left.map((g) => g.d).join('') + right.map((g) => g.d).join('');
  if (gs1CheckDigit(text.slice(0, 12)) !== +text[12]) return null;
  const r = { type: 'ean13', text, end: i + 59, module: m };
  if (text[0] === '0') r.upca = text.slice(1);
  return addAddon(runs, r);
}

function tryEan8(runs, i) {
  if (i + 43 > runs.length) return null;
  const m = sum(runs, i, 43) / 67;
  if (!quietOk(runs, i, m, 5) || !near(runs, i, 3, m, [1, 1, 1]) || !near(runs, i + 19, 5, m, [1, 1, 1, 1, 1]) || !near(runs, i + 40, 3, m, [1, 1, 1])) return null;
  const left = eanDigits(runs, i + 3, 4, [['L', LW]]), right = eanDigits(runs, i + 24, 4, RR);
  if (!left || !right) return null;
  const text = left.map((g) => g.d).join('') + right.map((g) => g.d).join('');
  if (gs1CheckDigit(text.slice(0, 7)) !== +text[7]) return null;
  return addAddon(runs, { type: 'ean8', text, end: i + 43, module: m });
}

function tryUpce(runs, i) {
  if (i + 33 > runs.length) return null;
  const m = sum(runs, i, 33) / 51;
  if (!quietOk(runs, i, m, 5) || !near(runs, i, 3, m, [1, 1, 1]) || !near(runs, i + 27, 6, m, [1, 1, 1, 1, 1, 1])) return null;
  // The end guard is followed by the quiet zone (else this is the left half of an EAN-13).
  if (i + 33 < runs.length && runs[i + 33] < 4 * m) return null;
  const ds = eanDigits(runs, i + 3, 6, LG);
  if (!ds) return null;
  const parity = ds.map((g) => g.set).join('');
  let ns = 0, check = UPCE_PARITY.indexOf(parity);
  if (check < 0) { ns = 1; check = UPCE_PARITY.indexOf(parity.replace(/[LG]/g, (c) => (c === 'L' ? 'G' : 'L'))); }
  if (check < 0) return null;
  const text = ns + ds.map((g) => g.d).join('') + check;
  const a = upcEToA(text);
  if (!a) return null;
  return addAddon(runs, { type: 'upce', text, upca: a, end: i + 33, module: m });
}

// EAN-2 / EAN-5 add-on after a main symbol (gap of 7-12 modules, then 1011).
function addAddon(runs, r) {
  const j = r.end + 1, m = r.module;
  if (j + 13 > runs.length) return r;
  const gap = runs[r.end] / m;
  if (gap < 5 || gap > 14 || !near(runs, j, 3, m, [1, 1, 2])) return r;
  for (const n of [5, 2]) {
    const len = 3 + 4 * n + 2 * (n - 1);
    if (j + len > runs.length) continue;
    const ds = [];
    let k = j + 3, ok = true;
    for (let d = 0; d < n && ok; d++) {
      if (d) { if (!near(runs, k, 2, m, [1, 1])) { ok = false; break; } k += 2; }
      const g = matchDigit([runs[k], runs[k + 1], runs[k + 2], runs[k + 3]], LG);
      if (!g) ok = false; else { ds.push(g); k += 4; }
    }
    if (!ok) continue;
    const digits = ds.map((g) => g.d).join(''), par = ds.map((g) => g.set).join('');
    const want = n === 2 ? EAN2_PARITY[+digits % 4] : EAN5_PARITY[(3 * (+digits[0] + +digits[2] + +digits[4]) + 9 * (+digits[1] + +digits[3])) % 10];
    if (par !== want) continue;
    return { ...r, addon: digits, end: k };
  }
  return r;
}

// --- Code 128 ---------------------------------------------------------------------------------------------------

const C128W = C128.map((p) => [...p].map(Number));
function match128(runs, i) {
  const tot = sum(runs, i, 6);
  let best = -1, bd = 1e9;
  for (let v = 0; v < 107; v++) {
    const t = C128W[v];
    let d = 0;
    for (let k = 0; k < 6; k++) d += Math.abs(runs[i + k] * 11 / tot - t[k]);
    if (d < bd) { bd = d; best = v; }
  }
  // Value 106 (stop) is matched on its first six elements (233111 of 2331112, which sum to 11 modules).
  if (bd > 1.6) {
    const t = [2, 3, 3, 1, 1, 1];
    let d = 0;
    for (let k = 0; k < 6; k++) d += Math.abs(runs[i + k] * 11 / tot - t[k]);
    return d <= 1.6 ? 106 : -1;
  }
  return best === 106 ? -1 : best;
}

function stop128(runs, i) {
  if (i + 7 > runs.length) return false;
  const tot = sum(runs, i, 7), t = [2, 3, 3, 1, 1, 1, 2];
  let d = 0;
  for (let k = 0; k < 7; k++) d += Math.abs(runs[i + k] * 13 / tot - t[k]);
  return d <= 1.8;
}

/** Code 128 values -> { text, gs1 } (FNC1 as GS; a leading FNC1 marks GS1-128). null when the values are invalid. */
export function code128Text(values) {
  let set = { 103: 'A', 104: 'B', 105: 'C' }[values[0]];
  if (!set) return null;
  let text = '', gs1 = false, shift = false, fnc4 = false;
  for (let k = 1; k < values.length; k++) {
    const v = values[k];
    const cur = shift ? (set === 'A' ? 'B' : 'A') : set;
    shift = false;
    if (cur === 'C') {
      if (v < 100) { text += String(v).padStart(2, '0'); continue; }
      if (v === 102) { if (k === 1) gs1 = true; else text += GS; continue; }
      if (v === 100) set = 'B'; else if (v === 101) set = 'A'; else return null;
      continue;
    }
    if (v < 96) {
      let c = cur === 'A' ? (v < 64 ? v + 32 : v - 64) : v + 32;
      if (fnc4) { c += 128; fnc4 = false; }
      text += String.fromCharCode(c);
      continue;
    }
    switch (v) {
      case 96: case 97: break;                                     // FNC3, FNC2
      case 98: shift = true; break;
      case 99: set = 'C'; break;
      case 100: if (cur === 'B') fnc4 = true; else set = 'B'; break;
      case 101: if (cur === 'A') fnc4 = true; else set = 'A'; break;
      case 102: if (k === 1) gs1 = true; else text += GS; break;
      default: return null;
    }
  }
  return { text, gs1 };
}

function tryCode128(runs, i) {
  const s = match128(runs, i);
  if (s < 103 || s > 105) return null;
  const m = sum(runs, i, 6) / 11;
  if (!quietOk(runs, i, m, 5)) return null;
  const values = [s];
  let j = i + 6;
  while (j + 7 <= runs.length) {
    if (stop128(runs, j)) {
      if (values.length < 3) return null;
      const check = values.pop();
      if (code128Check(values) !== check) return null;
      const t = code128Text(values);
      if (!t) return null;
      const r = { type: t.gs1 ? 'gs1-128' : 'code128', text: t.text, end: j + 7, module: m };
      if (t.gs1) r.gs1 = parseGs1(t.text);
      return r;
    }
    const v = match128(runs, j);
    if (v < 0 || v > 105) return null;
    values.push(v);
    j += 6;
    if (values.length > 120) return null;
  }
  return null;
}

// --- Code 39 / Code 93 / Codabar / ITF ------------------------------------------------------------------------

const C39_MAP = new Map([...C39_CHARS, '*'].map((ch) => [code39Elements(ch), ch]));
// Wide / narrow flags of n elements with exactly `wides` wide ones (the largest), or null when ambiguous.
function flags(runs, i, n, wides) {
  const idx = Array.from({ length: n }, (_, k) => k).sort((a, b) => runs[i + b] - runs[i + a]);
  const minWide = runs[i + idx[wides - 1]], maxNarrow = runs[i + idx[wides]];
  if (minWide < maxNarrow * 1.45) return null;
  const f = new Array(n).fill('0');
  for (let k = 0; k < wides; k++) f[idx[k]] = '1';
  return f.join('');
}

function tryCode39(runs, i) {
  if (i + 9 > runs.length || C39_MAP.get(flags(runs, i, 9, 3)) !== '*') return null;
  const narrow = sum(runs, i, 9) / 15;
  if (!quietOk(runs, i, narrow, 5)) return null;
  let j = i + 10, text = '';
  while (j + 9 <= runs.length) {
    const ch = C39_MAP.get(flags(runs, j, 9, 3));
    if (!ch) return null;
    if (ch === '*') {
      if (!text) return null;
      const r = { type: 'code39', text, end: j + 9, module: narrow };
      const check = C39_CHARS[[...text.slice(0, -1)].reduce((s, c) => s + C39_CHARS.indexOf(c), 0) % 43];
      r.checkOk = text.length > 1 && text.at(-1) === check;
      const full = fullAscii39(text);
      if (full != null && full !== text) r.fullAscii = full;
      return r;
    }
    text += ch;
    j += 10;
  }
  return null;
}

const FA_SHIFT = {
  $: (c) => (c >= 'A' && c <= 'Z' ? String.fromCharCode(c.charCodeAt(0) - 64) : null),
  '%': (c) => ({ U: '\0', A: '\x1b', B: '\x1c', C: '\x1d', D: '\x1e', E: '\x1f', F: ';', G: '<', H: '=', I: '>', J: '?', V: '@', K: '[', L: '\\', M: ']', N: '^', O: '_', W: '`', P: '{', Q: '|', R: '}', S: '~', T: '\x7f', X: '\x7f', Y: '\x7f', Z: '\x7f' })[c] ?? null,
  '/': (c) => (c >= 'A' && c <= 'L' ? '!"#$%&\'()*+,'[c.charCodeAt(0) - 65] : c === 'O' ? '/' : c === 'Z' ? ':' : null),
  '+': (c) => (c >= 'A' && c <= 'Z' ? c.toLowerCase() : null),
};
// Full ASCII reading of Code 39 text (null when a shift pair is invalid).
export function fullAscii39(text) {
  let out = '';
  for (let k = 0; k < text.length; k++) {
    const ch = text[k];
    if (FA_SHIFT[ch]) {
      const v = k + 1 < text.length ? FA_SHIFT[ch](text[k + 1]) : null;
      if (v == null) return null;
      out += v; k++;
    } else out += ch;
  }
  return out;
}

const C93W = C93.map((p) => [...p].map(Number));
const C93S = [...C93_START].map(Number);
function match93(runs, i) {
  const tot = sum(runs, i, 6);
  const dist = (t) => { let d = 0; for (let k = 0; k < 6; k++) d += Math.abs(runs[i + k] * 9 / tot - t[k]); return d; };
  if (dist(C93S) < 1.2) return 'start';
  let best = -1, bd = 1e9;
  for (let v = 0; v < 47; v++) { const d = dist(C93W[v]); if (d < bd) { bd = d; best = v; } }
  return bd < 1.4 ? best : -1;
}

function tryCode93(runs, i) {
  if (i + 6 > runs.length || match93(runs, i) !== 'start') return null;
  const m = sum(runs, i, 6) / 9;
  if (!quietOk(runs, i, m, 5)) return null;
  const vals = [];
  let j = i + 6;
  while (j + 6 <= runs.length) {
    const v = match93(runs, j);
    if (v === 'start') {
      if (vals.length < 3 || j + 7 > runs.length || runs[j + 6] / m > 1.8) return null;
      const data = vals.slice(0, -2), [c, k] = vals.slice(-2);
      const weighted = (arr, max) => arr.reduceRight((acc, x, idx) => acc + x * (((arr.length - 1 - idx) % max) + 1), 0) % 47;
      if (weighted(data, 20) !== c || weighted([...data, c], 15) !== k) return null;
      let text = '';
      for (let n = 0; n < data.length; n++) {
        const x = data[n];
        if (x >= 43) {
          const sh = { 43: '$', 44: '%', 45: '/', 46: '+' }[x];
          const nx = data[++n];
          const v2 = nx == null ? null : FA_SHIFT[sh](C39_CHARS[nx]);
          if (v2 == null) return null;
          text += v2;
        } else text += C39_CHARS[x];
      }
      return { type: 'code93', text, end: j + 7, module: m };
    }
    if (v < 0) return null;
    vals.push(v);
    j += 6;
    if (vals.length > 120) return null;
  }
  return null;
}

const CODABAR_MAP = new Map(Object.entries(CODABAR).map(([ch, p]) => [runsOfPattern(p).map((r) => (r > 1 ? '1' : '0')).join(''), ch]));
function codabarChar(runs, i) {
  const w = runs.slice(i, i + 7);
  const min = Math.min(...w), max = Math.max(...w);
  if (max < min * 1.45) return null;
  const th = (min + max) / 2;
  return CODABAR_MAP.get(w.map((x) => (x > th ? '1' : '0')).join('')) || null;
}

function tryCodabar(runs, i) {
  if (i + 7 > runs.length) return null;
  const s = codabarChar(runs, i);
  if (!s || !'ABCD'.includes(s)) return null;
  const narrow = Math.min(...runs.slice(i, i + 7));
  if (!quietOk(runs, i, narrow, 5)) return null;
  let j = i + 8, text = s;
  while (j + 7 <= runs.length) {
    const ch = codabarChar(runs, j);
    if (!ch) return null;
    text += ch;
    if ('ABCD'.includes(ch)) return text.length >= 3 ? { type: 'codabar', text, data: text.slice(1, -1), end: j + 7, module: narrow } : null;
    j += 8;
  }
  return null;
}

const ITF_MAP = new Map(ITF_DIGITS.map((p, d) => [p, String(d)]));
function tryItf(runs, i) {
  if (i + 4 + 10 + 3 > runs.length) return null;
  const n = sum(runs, i, 4) / 4;
  if (!quietOk(runs, i, n, 7)) return null;
  for (let k = 0; k < 4; k++) if (runs[i + k] > n * 1.6) return null;
  let j = i + 4, text = '';
  while (j + 3 <= runs.length) {
    // Stop: wide bar, narrow space, narrow bar, then the quiet zone (or the end of the line).
    if (runs[j] > n * 1.8 && runs[j + 1] < n * 1.6 && runs[j + 2] < n * 1.6 && (j + 3 >= runs.length || runs[j + 3] > n * 6)) {
      if (text.length < 4) return null;
      const r = { type: 'itf', text, end: j + 3, module: n };
      if (text.length === 14 && gs1CheckDigit(text.slice(0, 13)) === +text[13]) r.type = 'itf14';
      return r;
    }
    if (j + 10 > runs.length) return null;
    const bars = [], spaces = [];
    for (let k = 0; k < 10; k++) (k % 2 ? spaces : bars).push(runs[j + k]);
    const fb = flags(bars, 0, 5, 2), fs = flags(spaces, 0, 5, 2);
    const a = ITF_MAP.get(fb), b = ITF_MAP.get(fs);
    if (a == null || b == null) return null;
    text += a + b;
    j += 10;
    if (text.length > 80) return null;
  }
  return null;
}

const DECODERS = { ean13: tryEan13, ean8: tryEan8, upce: tryUpce, code128: tryCode128, code39: tryCode39, code93: tryCode93, codabar: tryCodabar, itf: tryItf };
export const DECODABLE = Object.keys(DECODERS);

/**
 * Decodes element widths (bar, space, bar, …; runs[0] may be a leading space when `leadingSpace`).
 * -> [{ type, text, start, end, reversed, … }] of every symbol found (non-overlapping), read in both directions:
 * symbols printed upside down are found by the reversed pass (start / end are indices of the reversed runs then).
 *   types: subset of DECODABLE   leadingSpace: runs[0] is the quiet zone before the first bar
 *   both: also read the reversed line (default true)
 */
export function decodeRuns(runs, { types = DECODABLE, leadingSpace = false, both = true } = {}) {
  const fns = [...new Set(types.map((t) => DECODERS[t === 'upca' ? 'ean13' : t === 'gs1-128' ? 'code128' : t === 'itf14' ? 'itf' : t]).filter(Boolean))];
  const pass = (r, first, reversed) => {
    const out = [];
    for (let i = first; i < r.length; i += 2) {
      let hit = null;
      for (const f of fns) { hit = f(r, i); if (hit) break; }
      // A symbol ends with a bar, so the next bar after it is at hit.end + 1 (the loop adds 2).
      if (hit) { out.push({ ...hit, start: i, reversed }); i = hit.end - 1; }
    }
    return out;
  };
  const fwd = pass(runs, leadingSpace ? 1 : 0, false);
  if (!both) return fwd;
  // The reversed line starts with the trailing space when the line has an odd number of runs (space … space).
  const rev = [...runs].reverse();
  const lead = leadingSpace ? (runs.length % 2 ? 1 : 0) : (runs.length % 2 ? 0 : 1);
  const n = runs.length;
  const covered = fwd.map((h) => [h.start, h.end]);
  for (const h of pass(rev, lead, true)) {
    const a = n - h.end, b = n - h.start;
    if (!covered.some(([s, e]) => a < e && b > s)) fwd.push(h);
  }
  return fwd;
}

// --- images -----------------------------------------------------------------------------------------------------

// Luminance of an RGBA image (alpha composited over white).
// Rec. 601 weights on gamma-encoded values: cheap and adequate for thresholding (exact colorimetry buys nothing for
// black-on-white bars). Transparent PNG backgrounds become white, as on a printed label, instead of black.
export function luminance({ data, width, height }) {
  const L = new Float32Array(width * height);
  for (let p = 0, q = 0; p < L.length; p++, q += 4) {
    const a = data[q + 3] / 255;
    const y = 0.299 * data[q] + 0.587 * data[q + 1] + 0.114 * data[q + 2];
    L[p] = y * a + 255 * (1 - a);
  }
  return L;
}

// Runs of one scan line with sub-pixel edges; starts with a light run (the space before the first bar).
// Edge position = linear interpolation of where the signal crosses the threshold between two pixels. At 1-2 px per
// module, whole-pixel edges would quantise widths by up to 50 % and make 1/2/3/4-module elements indistinguishable.
// The run list always alternates light, dark, ..., light (zero-length padding where needed) so decoders can index
// bars at odd positions without special cases.
export function lineRuns(line, threshold) {
  const n = line.length;
  const edges = [];
  let dark = line[0] < threshold[0];
  for (let k = 1; k < n; k++) {
    const d = line[k] < threshold[k];
    if (d !== dark) {
      const a = line[k - 1] - threshold[k - 1], b = line[k] - threshold[k];
      const f = a === b ? 0.5 : a / (a - b);
      edges.push(k - 1 + Math.min(1, Math.max(0, f)) + 0.5);
      dark = d;
    }
  }
  const runs = [];
  let prev = 0;
  if (line[0] < threshold[0]) runs.push(0);                  // no light run before the first bar
  for (const e of edges) { runs.push(e - prev); prev = e; }
  runs.push(n - prev);
  if (runs.length % 2 === 0) runs.push(0);                   // end on a light run
  return runs;
}

// Thresholds of a line: the middle of the 5th / 95th percentile, and a local mean (windows of ~1/16 of the line).
// Two binarisations per line because each fails differently: the global one survives uniform lighting but not a
// gradient or shadow; the local one (prefix sums -> O(n) window means, clamped inside [lo, hi] and blended with the
// global midpoint) follows gradients but can invent edges in flat areas. Percentiles, not min/max, ignore specular
// highlights and dust pixels. A line with < 24 levels of contrast is skipped as having no barcode.
function thresholds(line) {
  const n = line.length;
  const sorted = Float32Array.from(line).sort();
  const lo = sorted[Math.floor(n * 0.05)], hi = sorted[Math.floor(n * 0.95)];
  if (hi - lo < 24) return [];
  const global = new Float32Array(n).fill((lo + hi) / 2);
  const w = Math.max(8, Math.round(n / 16));
  const pre = new Float64Array(n + 1);
  for (let k = 0; k < n; k++) pre[k + 1] = pre[k] + line[k];
  const local = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const a = Math.max(0, k - w), b = Math.min(n, k + w + 1);
    const mean = (pre[b] - pre[a]) / (b - a);
    local[k] = Math.min(hi - 8, Math.max(lo + 8, mean * 0.75 + ((lo + hi) / 2) * 0.25));
  }
  return [global, local];
}

/**
 * Scans an RGBA image ({ data, width, height }, e.g. ImageData) for linear barcodes.
 *   lines   scan lines per direction (default 32)   rotate  also scan columns (default true)
 *   types   symbologies to look for (DECODABLE)
 * -> [{ type, text, count (agreeing lines), orientation ('h' | 'v'), reversed, y, x0, x1, upca?, addon?, gs1?,
 *       checkOk?, fullAscii?, data? }] best first.
 */
// Many scan lines + voting: a single line through a scratch or a reflection misreads; requiring agreement across
// lines (results ranked by `count`) turns independent noisy reads into a reliable one, as hardware scanners do.
export function scanImage(img, { lines = 32, rotate = true, types = DECODABLE } = {}) {
  const { width: W, height: H } = img;
  const L = luminance(img);
  const votes = new Map();
  const scan = (line, orient, pos) => {
    for (const th of thresholds(line)) {
      const runs = lineRuns(line, th);
      {
        for (const hit of decodeRuns(runs, { types, leadingSpace: true })) {
          const reversed = hit.reversed, r = reversed ? [...runs].reverse() : runs;
          const key = hit.type + '\0' + hit.text + '\0' + (hit.addon || '');
          const startPx = sumTo(r, hit.start), endPx = sumTo(r, hit.end);
          const x0 = reversed ? line.length - endPx : startPx, x1 = reversed ? line.length - startPx : endPx;
          const v = votes.get(key);
          if (v) { v.count++; v.lines.add(pos); v.x0 = Math.min(v.x0, x0); v.x1 = Math.max(v.x1, x1); v.p0 = Math.min(v.p0, pos); v.p1 = Math.max(v.p1, pos); }
          else votes.set(key, { ...hit, orientation: orient, reversed, count: 1, lines: new Set([pos]), x0, x1, p0: pos, p1: pos });
        }
      }
    }
  };
  const nl = Math.max(1, lines);
  for (let k = 0; k < nl; k++) {
    const y = Math.min(H - 1, Math.round((k + 0.5) * H / nl));
    scan(L.subarray(y * W, y * W + W), 'h', y);
  }
  if (rotate) {
    const col = new Float32Array(H);
    for (let k = 0; k < nl; k++) {
      const x = Math.min(W - 1, Math.round((k + 0.5) * W / nl));
      for (let y = 0; y < H; y++) col[y] = L[y * W + x];
      scan(col, 'v', x);
    }
  }
  return [...votes.values()]
    .map(({ lines: ls, end, start, module, ...r }) => ({ ...r, count: ls.size }))
    .sort((a, b) => b.count - a.count);
}

const sumTo = (r, n) => { let s = 0; for (let k = 0; k < n && k < r.length; k++) s += r[k]; return s; };
