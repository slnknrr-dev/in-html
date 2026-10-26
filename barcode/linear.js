// barcode/linear.js - linear (1D) barcode encoders: EAN-13, EAN-8, UPC-A, UPC-E with EAN-2 / EAN-5 add-ons,
// Code 128 (shortest A / B / C mix found by dynamic programming, FNC1-4, Latin-1 through FNC4), GS1-128, Code 39 (with
// full ASCII and the mod-43 check), Code 93 (full ASCII, C and K checks), Interleaved 2 of 5 and ITF-14, Codabar.
//
// Every encoder returns one symbol model, shared by the SVG renderer (svg.js) and the decoder tests:
//   { type, data, hri, bars: [{ x, w, guard? }], width, quiet: [left, right], labels: [{ text, x, anchor, pos }],
//     addon: { x } | null, text: 'ean' | 'center', bearer: 'none' | 'frame' | 'bars', values?, check? }
// x / w / width are in modules (narrow element widths); wide elements of two-width codes use `ratio` (default 3).
// Errors are thrown as BarcodeError with a `code` ('empty' | 'chars' | 'length' | 'check' | 'upce' | 'addon') and params.
import { completeCheck, gs1CheckDigit, onlyDigits, upcAToE, upcEToA } from './gtin.js';
import { GS, buildGs1, parseGs1 } from './gs1.js';

export class BarcodeError extends Error {
  constructor(code, params = {}) {
    super(code + (Object.keys(params).length ? ' ' + JSON.stringify(params) : ''));
    this.code = code;
    this.params = params;
  }
}
const fail = (code, params) => { throw new BarcodeError(code, params); };

// --- model helpers ----------------------------------------------------------------------------------------------

// Run widths (bar, space, bar, …) starting at x -> bars; returns the end x.
function pushRuns(bars, runs, x, guard = false) {
  for (let k = 0; k < runs.length; k++) {
    if (k % 2 === 0 && runs[k] > 0) bars.push(guard ? { x, w: runs[k], guard: true } : { x, w: runs[k] });
    x += runs[k];
  }
  return x;
}

// '1011' module pattern -> run widths starting with a bar (a leading space gives a 0-width bar).
export function patternRuns(p) {
  const runs = [];
  let cur = '1', n = 0;
  for (const c of p) {
    if (c === cur) n++;
    else { runs.push(n); cur = c; n = 1; }
  }
  runs.push(n);
  return runs;
}

// Run widths of a whole symbol (main part only, bars and spaces from the first bar to the last).
export function symbolRuns(sym, { addon = false } = {}) {
  const bars = sym.bars.filter((b) => (addon ? true : !sym.addon || b.x < sym.addon.x));
  const runs = [];
  for (let k = 0; k < bars.length; k++) {
    if (k) runs.push(bars[k].x - (bars[k - 1].x + bars[k - 1].w));
    runs.push(bars[k].w);
  }
  return runs;
}

// --- EAN / UPC --------------------------------------------------------------------------------------------------

export const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
export const EAN_G = EAN_L.map((p) => [...p].map((c) => (c === '1' ? '0' : '1')).reverse().join(''));
export const EAN_R = EAN_L.map((p) => [...p].map((c) => (c === '1' ? '0' : '1')).join(''));
export const EAN13_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
export const UPCE_PARITY = ['GGGLLL', 'GGLGLL', 'GGLLGL', 'GGLLLG', 'GLGGLL', 'GLLGGL', 'GLLLGG', 'GLGLGL', 'GLGLLG', 'GLLGLG'];
export const EAN5_PARITY = ['GGLLL', 'GLGLL', 'GLLGL', 'GLLLG', 'LGGLL', 'LLGGL', 'LLLGG', 'LGLGL', 'LGLLG', 'LLGLG'];
export const EAN2_PARITY = ['LL', 'LG', 'GL', 'GG'];
const digitCode = (d, set) => (set === 'L' ? EAN_L : set === 'G' ? EAN_G : EAN_R)[+d];

// Digits with a check digit: `n` digits are completed, `n + 1` verified.
function withCheck(input, n, name) {
  const d = onlyDigits(input);
  if (!d) fail('empty');
  if (!/^\d+$/.test(d)) fail('chars');
  if (d.length === n) return completeCheck(d);
  if (d.length !== n + 1) fail('length', { lengths: [n, n + 1], name });
  const expected = gs1CheckDigit(d.slice(0, n));
  if (expected !== +d[n]) fail('check', { expected: String(expected), got: d[n] });
  return d;
}

// Splits 'main addon' / 'main+addon' / 'main>addon' input.
function splitAddon(input, opts) {
  const s = String(input ?? '').trim();
  const m = /^(.*?)[\s+>|]+(\d{2}|\d{5})$/.exec(s);
  if (m && onlyDigits(m[1]).length >= 6) return [m[1], opts.addon ?? m[2]];
  return [s, opts.addon ?? ''];
}

function addonModel(digits) {
  const d = onlyDigits(digits);
  let parity;
  if (d.length === 2) parity = EAN2_PARITY[+d % 4];
  else if (d.length === 5) {
    const sum = 3 * (+d[0] + +d[2] + +d[4]) + 9 * (+d[1] + +d[3]);
    parity = EAN5_PARITY[sum % 10];
  } else fail('addon');
  let p = '1011';
  [...d].forEach((c, k) => { if (k) p += '01'; p += digitCode(c, parity[k]); });
  return { pattern: p, digits: d };
}

function eanModel(type, data, pattern, guardRanges, labels, quiet, addon, opts) {
  const bars = [];
  const runs = patternRuns(pattern);
  let x = 0;
  for (let k = 0; k < runs.length; k++) {
    if (k % 2 === 0) {
      const g = guardRanges.some(([a, b]) => x >= a && x < b);
      bars.push(g ? { x, w: runs[k], guard: true } : { x, w: runs[k] });
    }
    x += runs[k];
  }
  const sym = { type, data, hri: data, bars, width: pattern.length, quiet: [...quiet], labels, addon: null, text: 'ean', bearer: 'none' };
  if (addon) {
    const a = addonModel(addon);
    const gap = opts.addonGap ?? 9;
    const ax = pattern.length + gap;
    pushRuns(bars, patternRuns(a.pattern), ax);
    [...a.digits].forEach((c, k) => sym.labels.push({ text: c, x: ax + 4 + 9 * k + 3.5, anchor: 'middle', pos: 'above' }));
    sym.addon = { x: ax, digits: a.digits };
    sym.width = ax + a.pattern.length;
    sym.quiet[1] = 5;
    sym.hri = data + ' ' + a.digits;
  }
  return sym;
}

export function ean13(input, opts = {}) {
  const [main, addon] = splitAddon(input, opts);
  const d = withCheck(main, 12, 'EAN-13');
  const par = EAN13_PARITY[+d[0]];
  let p = '101';
  for (let i = 1; i <= 6; i++) p += digitCode(d[i], par[i - 1]);
  p += '01010';
  for (let i = 7; i <= 12; i++) p += digitCode(d[i], 'R');
  p += '101';
  const labels = [{ text: d[0], x: -2, anchor: 'end', pos: 'left' }];
  for (let i = 0; i < 6; i++) labels.push({ text: d[1 + i], x: 3 + 7 * i + 3.5, anchor: 'middle', pos: 'below' });
  for (let i = 0; i < 6; i++) labels.push({ text: d[7 + i], x: 50 + 7 * i + 3.5, anchor: 'middle', pos: 'below' });
  if (opts.quietMark) labels.push({ text: '>', x: 95 + 7, anchor: 'end', pos: 'right' });
  return eanModel('ean13', d, p, [[0, 3], [45, 50], [92, 95]], labels, [11, 7], addon, opts);
}

export function ean8(input, opts = {}) {
  const [main, addon] = splitAddon(input, opts);
  const d = withCheck(main, 7, 'EAN-8');
  let p = '101';
  for (let i = 0; i < 4; i++) p += digitCode(d[i], 'L');
  p += '01010';
  for (let i = 4; i < 8; i++) p += digitCode(d[i], 'R');
  p += '101';
  const labels = [];
  for (let i = 0; i < 4; i++) labels.push({ text: d[i], x: 3 + 7 * i + 3.5, anchor: 'middle', pos: 'below' });
  for (let i = 0; i < 4; i++) labels.push({ text: d[4 + i], x: 36 + 7 * i + 3.5, anchor: 'middle', pos: 'below' });
  if (opts.quietMark) { labels.push({ text: '<', x: -1, anchor: 'end', pos: 'left' }); labels.push({ text: '>', x: 67 + 7, anchor: 'end', pos: 'right' }); }
  return eanModel('ean8', d, p, [[0, 3], [31, 36], [64, 67]], labels, [7, 7], addon, opts);
}

export function upca(input, opts = {}) {
  const [main, addon] = splitAddon(input, opts);
  const d = withCheck(main, 11, 'UPC-A');
  let p = '101';
  for (let i = 0; i < 6; i++) p += digitCode(d[i], 'L');
  p += '01010';
  for (let i = 6; i < 12; i++) p += digitCode(d[i], 'R');
  p += '101';
  const labels = [{ text: d[0], x: -2, anchor: 'end', pos: 'left', small: true }];
  for (let i = 1; i < 6; i++) labels.push({ text: d[i], x: 3 + 7 * i + 3.5, anchor: 'middle', pos: 'below' });
  for (let i = 6; i < 11; i++) labels.push({ text: d[i], x: 50 + 7 * (i - 6) + 3.5, anchor: 'middle', pos: 'below' });
  labels.push({ text: d[11], x: 95 + 2, anchor: 'start', pos: 'right', small: true });
  // The first and the last digit are drawn as long as the guards.
  return eanModel('upca', d, p, [[0, 10], [45, 50], [85, 95]], labels, [9, 9], addon, opts);
}

export function upce(input, opts = {}) {
  const [main, addon] = splitAddon(input, opts);
  const raw = onlyDigits(main);
  if (!raw) fail('empty');
  if (!/^\d+$/.test(raw)) fail('chars');
  let e;
  if (raw.length === 11 || raw.length === 12) {
    const a = raw.length === 11 ? completeCheck(raw) : raw;
    if (raw.length === 12 && gs1CheckDigit(raw.slice(0, 11)) !== +raw[11]) fail('check', { expected: String(gs1CheckDigit(raw.slice(0, 11))), got: raw[11] });
    e = upcAToE(a);
    if (!e) fail('upce');
  } else if ([6, 7, 8].includes(raw.length)) {
    const ns = raw.length === 6 ? '0' : raw[0];
    if (ns !== '0' && ns !== '1') fail('upce');
    const body = raw.length === 6 ? raw : raw.slice(1, 7);
    const a = upcEToA(ns + body);
    if (!a) fail('upce');
    e = ns + body + a[11];
    if (raw.length === 8 && raw[7] !== a[11]) fail('check', { expected: a[11], got: raw[7] });
  } else fail('length', { lengths: [6, 7, 8, 11, 12], name: 'UPC-E' });
  const ns = +e[0], check = +e[7];
  const par = ns === 0 ? UPCE_PARITY[check] : UPCE_PARITY[check].replace(/[LG]/g, (c) => (c === 'L' ? 'G' : 'L'));
  let p = '101';
  for (let i = 0; i < 6; i++) p += digitCode(e[1 + i], par[i]);
  p += '010101';
  const labels = [{ text: e[0], x: -2, anchor: 'end', pos: 'left', small: true }];
  for (let i = 0; i < 6; i++) labels.push({ text: e[1 + i], x: 3 + 7 * i + 3.5, anchor: 'middle', pos: 'below' });
  labels.push({ text: e[7], x: 51 + 2, anchor: 'start', pos: 'right', small: true });
  const sym = eanModel('upce', e, p, [[0, 3], [45, 51]], labels, [9, 7], addon, opts);
  sym.upca = upcEToA(e);
  return sym;
}

// Stand-alone add-on symbols (periodicals, books).
export function ean2(input) { const d = onlyDigits(input); if (!/^\d{2}$/.test(d)) fail('length', { lengths: [2] }); return addonOnly('ean2', d); }
export function ean5(input) { const d = onlyDigits(input); if (!/^\d{5}$/.test(d)) fail('length', { lengths: [5] }); return addonOnly('ean5', d); }
function addonOnly(type, d) {
  const a = addonModel(d);
  const bars = [];
  pushRuns(bars, patternRuns(a.pattern), 0);
  const labels = [...d].map((c, k) => ({ text: c, x: 4 + 9 * k + 3.5, anchor: 'middle', pos: 'above' }));
  return { type, data: d, hri: d, bars, width: a.pattern.length, quiet: [7, 5], labels, addon: null, text: 'ean', bearer: 'none' };
}

// --- Code 128 ---------------------------------------------------------------------------------------------------

// Code 128 symbol table: value -> 6 element widths (bar, space, bar, space, bar, space), each pattern summing to
// 11 modules; the stop (106) has a 7th bar (13 modules). Data table: structure comment only.
export const C128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212',
  '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321',
  '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212',
  '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
export const C128_FNC1 = 102, C128_STOP = 106, C128_START = { A: 103, B: 104, C: 105 };
const FNC1 = -1, FNC2 = -2, FNC3 = -3;
const inA = (c) => c >= 0 && c < 96;
const inB = (c) => c >= 32 && c < 128;
const valA = (c) => (c < 32 ? c + 64 : c - 32);
const valB = (c) => c - 32;
const isDigit = (c) => c >= 48 && c <= 57;
const SET_CODE = { A: { B: 100, C: 99 }, B: { A: 101, C: 99 }, C: { A: 101, B: 100 } };
const FNC_VAL = { [FNC1]: 102, [FNC2]: 97, [FNC3]: 96 };

/**
 * Code 128 symbol values of a token list (char codes 0-255, FNC1 = -1, FNC2 = -2, FNC3 = -3) with the fewest
 * symbols: dynamic programming over (position, code set) with set changes, SHIFT and FNC4 (Latin-1).
 * -> { values (start … data, no check / stop), sets (the set per data value) }
 */
// Why DP and not the usual greedy rules ("switch to C for 4+ digits"): greedy heuristics are optimal only for common
// cases and miss mixes with control characters, Latin-1 (FNC4) and SHIFT; a DP over (position, current set) with
// per-transition costs is provably minimal and still O(n * 3) states. `from` records back-pointers to rebuild the
// value sequence. Shorter symbols matter physically: every saved symbol is 11 modules of label width.
export function code128Values(tokens, { start = null } = {}) {
  const n = tokens.length;
  const SETS = start ? [start] : ['A', 'B', 'C'];
  const INF = 1e9;
  const cost = Array.from({ length: n + 1 }, () => ({ A: INF, B: INF, C: INF }));
  const from = Array.from({ length: n + 1 }, () => ({}));
  for (const s of SETS) { cost[0][s] = 1; from[0][s] = { start: s }; }
  const relax = (i, s, c, prev) => { if (c < cost[i][s]) { cost[i][s] = c; from[i][s] = prev; } };
  for (let i = 0; i <= n; i++) {
    // Set changes at the same position (twice, so A -> C via B is never needed but chains settle).
    for (let r = 0; r < 2; r++) for (const s of ['A', 'B', 'C']) for (const s2 of ['A', 'B', 'C']) {
      if (s !== s2 && cost[i][s] + 1 < cost[i][s2]) relax(i, s2, cost[i][s] + 1, { i, s, op: 'code', to: s2 });
    }
    if (i === n) break;
    const t = tokens[i];
    for (const s of ['A', 'B', 'C']) {
      const c = cost[i][s];
      if (c >= INF) continue;
      if (t < 0) { relax(i + 1, s, c + 1, { i, s, op: 'fnc', t }); continue; }
      if (s === 'C') {
        if (i + 1 < n && isDigit(t) && tokens[i + 1] >= 0 && isDigit(tokens[i + 1])) relax(i + 2, 'C', c + 1, { i, s, op: 'pair' });
        continue;
      }
      const other = s === 'A' ? 'B' : 'A';
      const ok = s === 'A' ? inA : inB, okO = s === 'A' ? inB : inA;
      if (t < 128) {
        if (ok(t)) relax(i + 1, s, c + 1, { i, s, op: 'char' });
        else if (okO(t)) relax(i + 1, s, c + 2, { i, s, op: 'shift' });
      } else if (t < 256) {
        if (ok(t - 128)) relax(i + 1, s, c + 2, { i, s, op: 'fnc4' });
        else if (okO(t - 128)) relax(i + 1, s, c + 3, { i, s, op: 'fnc4shift' });
      }
    }
  }
  let best = null;
  for (const s of ['A', 'B', 'C']) if (cost[n][s] < INF && (!best || cost[n][s] < cost[n][best])) best = s;
  if (!best) fail('chars');
  // Walk back.
  const ops = [];
  let i = n, s = best;
  while (true) {
    const f = from[i][s];
    if (f.start) { ops.push({ op: 'start', s: f.start }); break; }
    ops.push({ ...f, at: i });
    i = f.i; s = f.s;
  }
  ops.reverse();
  const values = [], sets = [];
  for (const o of ops) {
    if (o.op === 'start') { values.push(C128_START[o.s]); continue; }
    const t = tokens[o.i], st = o.s;
    const val = (set, c) => (set === 'A' ? valA(c) : valB(c));
    const fnc4 = st === 'A' ? 101 : 100;
    switch (o.op) {
      case 'code': values.push(SET_CODE[st][o.to]); sets.push(st); break;
      case 'fnc': values.push(FNC_VAL[t]); sets.push(st); break;
      case 'pair': values.push((t - 48) * 10 + (tokens[o.i + 1] - 48)); sets.push('C'); break;
      case 'char': values.push(val(st, t)); sets.push(st); break;
      case 'shift': values.push(98, val(st === 'A' ? 'B' : 'A', t)); sets.push(st, st === 'A' ? 'B' : 'A'); break;
      case 'fnc4': values.push(fnc4, val(st, t - 128)); sets.push(st, st); break;
      case 'fnc4shift': values.push(fnc4, 98, val(st === 'A' ? 'B' : 'A', t - 128)); sets.push(st, st, st === 'A' ? 'B' : 'A'); break;
    }
  }
  return { values, sets };
}

export const code128Check = (values) => values.reduce((sum, v, k) => sum + v * (k || 1), 0) % 103;

function code128Model(type, values, hri, data) {
  const all = [...values, code128Check(values), C128_STOP];
  const bars = [];
  let x = 0;
  for (const v of all) x = pushRuns(bars, [...C128[v]].map(Number), x);
  return { type, data, hri, bars, width: x, quiet: [10, 10], labels: [], addon: null, text: 'center', bearer: 'none', values: all, check: all[all.length - 2] };
}

// Text -> tokens: characters 0-255; with `fnc` true, '\x1d' (GS) and 'ñ' stand for FNC1.
function textTokens(text, fnc = false) {
  const tokens = [];
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    if (fnc && (c === 0x1d || c === 0xf1)) tokens.push(FNC1);
    else if (c > 255) fail('chars', { char: ch });
    else tokens.push(c);
  }
  return tokens;
}

export function code128(input, opts = {}) {
  const text = String(input ?? '');
  if (!text) fail('empty');
  const tokens = textTokens(text, !!opts.fnc1);
  const { values } = code128Values(tokens, { start: opts.set || null });
  const hri = text.replace(/[\x00-\x1f\x7f]/g, ' ');
  return code128Model('code128', values, hri, text);
}

/**
 * GS1-128: element strings as HRI '(01)…(10)…', raw data with GS separators or a list [{ ai, value }].
 * The symbol starts with FNC1 and separates variable-length elements with FNC1.
 */
export function gs1_128(input, opts = {}) {
  const els = Array.isArray(input) ? input : parseGs1(input).elements;
  if (!els.length) fail('empty');
  const p = Array.isArray(input) ? null : parseGs1(input);
  if (p && p.rest) fail('gs1', { rest: p.rest });
  const b = buildGs1(els, { order: opts.order || 'keep' });
  if (b.issues.length && !opts.lenient) fail('gs1', { issues: b.issues });
  const tokens = [FNC1, ...textTokens(b.data, true)];
  const { values } = code128Values(tokens);
  const sym = code128Model('gs1-128', values, b.hri, b.data);
  sym.elements = b.elements;
  return sym;
}

// --- Code 39 ----------------------------------------------------------------------------------------------------

export const C39_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';
// Two wide bars out of five (rows 1-10 of the 2-of-5 code) and the wide space position (0-3).
const C39_BARS = ['10001', '01001', '11000', '00101', '10100', '01100', '00011', '10010', '01010', '00110'];
function c39Pattern(ch) {
  if (ch === '*') return { bars: C39_BARS[9], space: 0 };
  const i = C39_CHARS.indexOf(ch);
  if (i < 0) return null;
  if (i >= 39) return { bars: '00000', spaces: ['1110', '1101', '1011', '0111'][i - 39] };
  const row = i < 10 ? (i === 0 ? 9 : i - 1) : (i - 10) % 10;
  const space = i < 10 ? 1 : i < 20 ? 2 : i < 30 ? 3 : 0;
  return { bars: C39_BARS[row], space };
}
// Wide (1) / narrow (0) flags of the 9 elements of a Code 39 character, bar first.
export function code39Elements(ch) {
  const p = c39Pattern(ch);
  if (!p) return null;
  const spaces = p.spaces || [0, 1, 2, 3].map((k) => (k === p.space ? '1' : '0')).join('');
  let out = '';
  for (let k = 0; k < 5; k++) { out += p.bars[k]; if (k < 4) out += spaces[k]; }
  return out;
}

// Full ASCII: character code -> one or two basic characters (shared with Code 93, where $ % / + are shift symbols).
export const FULL_ASCII = (() => {
  const t = [];
  t[0] = '%U';
  for (let c = 1; c <= 26; c++) t[c] = '$' + String.fromCharCode(64 + c);
  'ABCDE'.split('').forEach((l, k) => { t[27 + k] = '%' + l; });
  t[32] = ' ';
  '!"#$%&\'()*+,'.split('').forEach((ch, k) => { t[ch.charCodeAt(0)] = '/' + String.fromCharCode(65 + k); });
  t[45] = '-'; t[46] = '.'; t[47] = '/O';
  for (let c = 48; c <= 57; c++) t[c] = String.fromCharCode(c);
  t[58] = '/Z';
  ';<=>?'.split('').forEach((ch, k) => { t[ch.charCodeAt(0)] = '%' + String.fromCharCode(70 + k); });
  t[64] = '%V';
  for (let c = 65; c <= 90; c++) t[c] = String.fromCharCode(c);
  '[\\]^_'.split('').forEach((ch, k) => { t[ch.charCodeAt(0)] = '%' + String.fromCharCode(75 + k); });
  t[96] = '%W';
  for (let c = 97; c <= 122; c++) t[c] = '+' + String.fromCharCode(c - 32);
  '{|}~'.split('').forEach((ch, k) => { t[ch.charCodeAt(0)] = '%' + String.fromCharCode(80 + k); });
  t[127] = '%T';
  return t;
})();

export const code39Check = (text) => C39_CHARS[[...text].reduce((s, ch) => s + C39_CHARS.indexOf(ch), 0) % 43];

export function code39(input, opts = {}) {
  const text = String(input ?? '');
  if (!text) fail('empty');
  const ratio = opts.ratio ?? 3;
  let enc = '';
  if (opts.fullAscii) {
    for (const ch of text) { const c = ch.charCodeAt(0); if (c > 127 || FULL_ASCII[c] == null) fail('chars', { char: ch }); enc += FULL_ASCII[c]; }
  } else {
    const up = opts.upper === false ? text : text.toUpperCase();
    for (const ch of up) if (!C39_CHARS.includes(ch)) fail('chars', { char: ch });
    enc = up;
  }
  const check = opts.check ? code39Check(enc) : '';
  const full = '*' + enc + check + '*';
  const bars = [];
  let x = 0;
  [...full].forEach((ch, k) => {
    if (k) x += 1;                                     // inter-character gap: one narrow space
    x = pushRuns(bars, [...code39Elements(ch)].map((f) => (f === '1' ? ratio : 1)), x);
  });
  const shown = (opts.fullAscii ? text : enc) + (opts.showCheck ? check : '');
  return { type: 'code39', data: enc + check, hri: opts.stars === false ? shown : '*' + shown + '*', bars, width: x, quiet: [10, 10], labels: [], addon: null, text: 'center', bearer: 'none', check: check || null };
}

// --- Code 93 ----------------------------------------------------------------------------------------------------

export const C93 = [
  '131112', '111213', '111312', '111411', '121113', '121212', '121311', '111114', '131211', '141111', '211113', '211212',
  '211311', '221112', '221211', '231111', '112113', '112212', '112311', '122112', '132111', '111123', '111222', '111321',
  '121122', '131121', '212112', '212211', '211122', '211221', '221121', '222111', '112122', '112221', '122121', '123111',
  '121131', '311112', '311211', '321111', '112131', '113121', '211131', '121221', '312111', '311121', '122211',
];
export const C93_START = '111141';
const C93_SHIFT = { $: 43, '%': 44, '/': 45, '+': 46 };

function code93Checks(vals) {
  const weighted = (arr, max) => arr.reduceRight((acc, v, k) => {
    const w = ((arr.length - 1 - k) % max) + 1;
    return acc + v * w;
  }, 0) % 47;
  const c = weighted(vals, 20);
  const k = weighted([...vals, c], 15);
  return [c, k];
}

export function code93(input, opts = {}) {
  const text = String(input ?? '');
  if (!text) fail('empty');
  const vals = [];
  for (const ch of text) {
    const i = C39_CHARS.indexOf(ch);
    if (i >= 0 && !opts.fullAsciiOnly) { vals.push(i); continue; }
    const c = ch.charCodeAt(0);
    if (c > 127 || FULL_ASCII[c] == null) fail('chars', { char: ch });
    const pair = FULL_ASCII[c];
    if (pair.length === 1) vals.push(C39_CHARS.indexOf(pair));
    else vals.push(C93_SHIFT[pair[0]], C39_CHARS.indexOf(pair[1]));
  }
  const [c, k] = code93Checks(vals);
  const all = [...vals, c, k];
  const bars = [];
  let x = pushRuns(bars, [...C93_START].map(Number), 0);
  for (const v of all) x = pushRuns(bars, [...C93[v]].map(Number), x);
  x = pushRuns(bars, [...C93_START].map(Number), x);
  x = pushRuns(bars, [1], x);                         // termination bar
  return { type: 'code93', data: text, hri: text.replace(/[\x00-\x1f\x7f]/g, ' '), bars, width: x, quiet: [10, 10], labels: [], addon: null, text: 'center', bearer: 'none', values: all, check: [c, k] };
}

// --- Interleaved 2 of 5, ITF-14 ---------------------------------------------------------------------------------

export const ITF_DIGITS = ['00110', '10001', '01001', '11000', '00101', '10100', '01100', '00011', '10010', '01010'];

function itfModel(type, d, opts) {
  const ratio = opts.ratio ?? 3;
  const w = (f) => (f === '1' ? ratio : 1);
  const bars = [];
  let x = pushRuns(bars, [1, 1, 1, 1], 0);
  for (let i = 0; i < d.length; i += 2) {
    const a = ITF_DIGITS[+d[i]], b = ITF_DIGITS[+d[i + 1]];
    const runs = [];
    for (let k = 0; k < 5; k++) runs.push(w(a[k]), w(b[k]));
    x = pushRuns(bars, runs, x);
  }
  x = pushRuns(bars, [ratio, 1, 1], x);
  return { type, data: d, hri: d, bars, width: x, quiet: [10, 10], labels: [], addon: null, text: 'center', bearer: opts.bearer || 'none' };
}

export function itf(input, opts = {}) {
  let d = onlyDigits(input);
  if (!d) fail('empty');
  if (!/^\d+$/.test(d)) fail('chars');
  if (opts.check) d = completeCheck(d);
  if (d.length % 2) {
    if (opts.pad === false) fail('length', { even: true });
    d = '0' + d;
  }
  return itfModel('itf', d, opts);
}

export function itf14(input, opts = {}) {
  const d = withCheck(input, 13, 'ITF-14');
  const sym = itfModel('itf14', d, { bearer: 'frame', ratio: 2.5, ...opts });
  sym.quiet = [10, 10];
  sym.hri = d[0] + ' ' + d.slice(1, 3) + ' ' + d.slice(3, 8) + ' ' + d.slice(8, 13) + ' ' + d[13];
  return sym;
}

// --- Codabar ----------------------------------------------------------------------------------------------------

export const CODABAR = {
  0: '101010011', 1: '101011001', 2: '101001011', 3: '110010101', 4: '101101001', 5: '110101001', 6: '100101011',
  7: '100101101', 8: '100110101', 9: '110100101', '-': '101001101', $: '101100101', ':': '1101011011', '/': '1101101011',
  '.': '1101101101', '+': '1011011011', A: '1011001001', B: '1001001011', C: '1010010011', D: '1010011001',
};
const CODABAR_ALIAS = { T: 'A', N: 'B', '*': 'C', E: 'D' };
const CODABAR_VALUE = '0123456789-$:/.+ABCD';

export function codabar(input, opts = {}) {
  let s = String(input ?? '').trim().toUpperCase();
  if (!s) fail('empty');
  const isSS = (c) => 'ABCDTN*E'.includes(c);
  let start = opts.start || 'A', stop = opts.stop || start;
  if (s.length >= 2 && isSS(s[0]) && isSS(s[s.length - 1])) { start = s[0]; stop = s[s.length - 1]; s = s.slice(1, -1); }
  start = CODABAR_ALIAS[start] || start; stop = CODABAR_ALIAS[stop] || stop;
  for (const ch of s) if (!/[0-9\-$:/.+]/.test(ch)) fail('chars', { char: ch });
  let check = '';
  if (opts.check) {
    const sum = [start, ...s, stop].reduce((a, ch) => a + CODABAR_VALUE.indexOf(ch), 0);
    check = CODABAR_VALUE[(16 - (sum % 16)) % 16];
    if (/[A-D]/.test(check)) check = '';                // cannot happen for 0-15, kept for safety
  }
  const full = start + s + check + stop;
  const ratio = opts.ratio ?? 2.5;
  const bars = [];
  let x = 0;
  [...full].forEach((ch, k) => {
    if (k) x += 1;
    x = pushRuns(bars, patternRuns(CODABAR[ch]).map((r) => (r === 2 ? ratio : r)), x);
  });
  const hri = opts.showStartStop ? full : s + check;
  return { type: 'codabar', data: full, hri, bars, width: x, quiet: [10, 10], labels: [], addon: null, text: 'center', bearer: 'none', check: check || null };
}

// --- registry ---------------------------------------------------------------------------------------------------

/** Symbologies in picker order: key, display name, encoder, example, input kind ('digits' | 'text' | 'gs1'). */
export const SYMBOLOGIES = [
  { key: 'ean13', name: 'EAN-13', encode: ean13, example: '4860001234561', kind: 'digits', retail: true },
  { key: 'ean8', name: 'EAN-8', encode: ean8, example: '96385074', kind: 'digits', retail: true },
  { key: 'upca', name: 'UPC-A', encode: upca, example: '036000291452', kind: 'digits', retail: true },
  { key: 'upce', name: 'UPC-E', encode: upce, example: '01234565', kind: 'digits', retail: true },
  { key: 'gs1-128', name: 'GS1-128', encode: gs1_128, example: '(01)04860001234561(17)271231(10)LOT42', kind: 'gs1' },
  { key: 'itf14', name: 'ITF-14', encode: itf14, example: '14860001234568', kind: 'digits' },
  { key: 'code128', name: 'Code 128', encode: code128, example: 'Batumi-2027', kind: 'text' },
  { key: 'code39', name: 'Code 39', encode: code39, example: 'INV-0042', kind: 'text' },
  { key: 'code93', name: 'Code 93', encode: code93, example: 'SHELF A-12', kind: 'text' },
  { key: 'itf', name: 'ITF', encode: itf, example: '12345670', kind: 'digits' },
  { key: 'codabar', name: 'Codabar', encode: codabar, example: 'A40156B', kind: 'text' },
  { key: 'ean5', name: 'EAN-5', encode: ean5, example: '52495', kind: 'digits' },
  { key: 'ean2', name: 'EAN-2', encode: ean2, example: '05', kind: 'digits' },
];

export const symbology = (key) => SYMBOLOGIES.find((s) => s.key === key) || null;

/** encode('ean13', '486000123456') -> symbol model (throws BarcodeError). */
export function encode(type, input, opts = {}) {
  const s = symbology(type);
  if (!s) throw new BarcodeError('type', { type });
  return s.encode(input, opts);
}

export { FNC1, FNC2, FNC3, GS };
