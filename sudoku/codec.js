// sudoku/codec.js - puzzles as short, URL-safe codes ("S1" + base64url of zlib-compressed compact JSON) for share
// links, saved games and multiplayer rooms, and strict checking of decoded input.
//
//   encodePuzzle(puzzle) -> 'S1…'          decodePuzzle(code) -> puzzle (throws on anything malformed)
//   cleanPuzzle(object) -> puzzle          validates a plain object (sizes, cells, clue fields)
//   gridString(puzzle) -> '..3.5…'         one character per cell ('.' empty, 1-9 a-z A-Z + * @), the classic text form
//   parseGrid(text, n?) -> puzzle | null   classic puzzles typed or pasted as 81 (n²) characters

import { zlibSync, unzlibSync } from '../codec/zlib.js';
import { bitsDecode, bitsEncode, B64URL } from '../codec/rfc4648.js';
import { bytesToUtf8, utf8ToBytes } from '../crypto/encoding.js';
import { LAYOUTS, MAX_N, MIN_N, defaultBox, makeGeometry } from './geometry.js';
import { RULES } from './rules.js';
import { CLUES } from './clues.js';

const PREFIX = 'S1';
// Numbers 1..64 (and region ids 0..63) as one character; the first 25 are those of the first codes, so every
// earlier code still decodes. Above 35 the letters are case-sensitive.
const DIGITS = '123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+*@';
// Limits on untrusted input: code length before inflating, and 4 MiB after (zlib bomb guard; a 64 x 64 puzzle with
// clues is far below). Both checked before JSON.parse so a hostile link cannot freeze the page.
const MAX_CODE = 200000;

export function gridString(p) {
  const g = makeGeometry({ n: p.n, box: p.box || null, regions: p.regions || null, layout: p.layout || null });
  let s = '';
  for (let i = 0; i < g.size; i++) s += !g.present[i] ? '_' : p.givens[i] ? DIGITS[p.givens[i] - 1] : '.';
  return s;
}

// Compact JSON with one-letter keys, givens as one string (DIGITS), then zlib level 9 and base64url: URL-safe
// without percent-encoding. A versioned prefix ('S1') lets a future format coexist with old links.
// o.b = 0 (not omitted) records "no boxes" explicitly; decode treats any non-array as null.
export function encodePuzzle(p) {
  const o = { n: p.n, g: gridString(p) };
  if (p.box) o.b = p.box; else o.b = 0;
  if (p.regions) o.r = p.regions.map((x) => DIGITS[x] || '0').join('');
  if (p.layout) o.l = p.layout;
  if (p.rules && p.rules.length) o.u = p.rules;
  if (p.clues && p.clues.length) o.c = p.clues;
  for (const k of ['variant', 'difficulty', 'level', 'seed', 'title']) if (p[k] != null && p[k] !== '') o[k] = p[k];
  return PREFIX + bitsEncode(zlibSync(utf8ToBytes(JSON.stringify(o)), { level: 9 }), B64URL);
}

// Every decode ends in cleanPuzzle: the decoder is permissive about shape, the validator is strict about meaning.
export function decodePuzzle(code) {
  const s = String(code || '').trim();
  if (!s.startsWith(PREFIX) || s.length > MAX_CODE) throw new Error('not a puzzle code');
  let o;
  try {
    const bytes = unzlibSync(bitsDecode(s.slice(PREFIX.length), B64URL));
    if (bytes.length > 4 * 1024 * 1024) throw new Error('too large');
    o = JSON.parse(bytesToUtf8(bytes, true));
  } catch { throw new Error('damaged puzzle code'); }
  if (!o || typeof o !== 'object') throw new Error('damaged puzzle code');
  const p = {
    n: o.n, box: Array.isArray(o.b) ? o.b : null, layout: o.l || null, rules: o.u || [], clues: o.c || [],
    regions: typeof o.r === 'string' ? [...o.r].map((ch) => DIGITS.indexOf(ch)) : null,
    givens: typeof o.g === 'string' ? [...o.g].map((ch) => (ch === '.' || ch === '_' ? 0 : DIGITS.indexOf(ch) + 1)) : null,
  };
  for (const k of ['variant', 'difficulty', 'level', 'seed', 'title']) if (o[k] != null) p[k] = o[k];
  return cleanPuzzle(p);
}

const isInt = (x, a, b) => Number.isInteger(x) && x >= a && x <= b;

// A validated copy of a puzzle object (from storage, a link or the network).
// Rebuilds the puzzle field by field from whitelisted values (never spreads the input), checks every cell index
// against present[] and every number against its range, and limits clue count / string lengths. makeGeometry
// throws on bad shapes (non-tiling boxes, disconnected regions), which this function lets propagate.
export function cleanPuzzle(p) {
  if (!p || typeof p !== 'object') throw new Error('not a puzzle');
  const n = p.n;
  if (!isInt(n, MIN_N, MAX_N)) throw new Error('bad size');
  const layout = p.layout == null ? null : String(p.layout);
  if (layout && !LAYOUTS[layout]) throw new Error('bad layout');
  let box = null;
  if (Array.isArray(p.box)) {
    if (!isInt(p.box[0], 1, n) || !isInt(p.box[1], 1, n) || p.box[0] * p.box[1] !== n) throw new Error('bad box');
    box = [p.box[0], p.box[1]];
  }
  const regions = p.regions ? Array.from(p.regions, (x) => { if (!isInt(x, 0, n - 1)) throw new Error('bad regions'); return x; }) : null;
  const geom = makeGeometry({ n, box: regions ? null : box, regions: regions ? Int32Array.from(regions) : null, layout }); // throws on bad shapes
  const givens = new Array(geom.size).fill(0);
  if (p.givens) {
    if (p.givens.length !== geom.size) throw new Error('bad givens');
    for (let i = 0; i < geom.size; i++) {
      const v = p.givens[i] | 0;
      if (!isInt(v, 0, n) || (v && !geom.present[i])) throw new Error('bad givens');
      givens[i] = v;
    }
  }
  const rules = Array.isArray(p.rules) ? p.rules.map(String) : [];
  for (const r of rules) if (!Object.hasOwn(RULES, r)) throw new Error('unknown rule');
  const clues = Array.isArray(p.clues) ? p.clues : [];
  if (clues.length > 5000) throw new Error('too many clues');
  const cell = (x) => { if (!isInt(x, 0, geom.size - 1) || !geom.present[x]) throw new Error('bad clue cell'); return x; };
  const num = (x, a, b) => { if (!isInt(x, a, b)) throw new Error('bad clue number'); return x; };
  const cellList = (l, min = 1) => { if (!Array.isArray(l) || l.length < min || l.length > geom.size) throw new Error('bad clue cells'); return l.map(cell); };
  const out = clues.map((c) => {
    if (!c || typeof c !== 'object' || !Object.hasOwn(CLUES, c.t)) throw new Error('unknown clue');
    const t = c.t;
    switch (t) {
      case 'cage': return { t, cells: cellList(c.cells), sum: num(c.sum, 1, n * n * n) };
      case 'parity': return { t, cell: cell(c.cell), odd: !!c.odd };
      case 'kropki': return { t, a: cell(c.a), b: cell(c.b), k: c.k === 'b' ? 'b' : 'w' };
      case 'xv': return { t, a: cell(c.a), b: cell(c.b), k: c.k === 'x' ? 'x' : 'v' };
      case 'consec': case 'gt': return { t, a: cell(c.a), b: cell(c.b) };
      case 'quad': {
        if (!Array.isArray(c.digits) || c.digits.length < 1 || c.digits.length > 4) throw new Error('bad quadruple');
        const q = { t, cell: cell(c.cell), digits: c.digits.map((d) => num(d, 1, n)) };
        CLUES.quad.cells(q, geom).forEach(cell);
        return q;
      }
      // Outside clues are refused on multi-grid layouts: lineFrom() assumes one n x n grid at the frame origin.
      case 'sandwich': case 'xsum': case 'frame': case 'sky': {
        const side = ['l', 'r', 't', 'b'].includes(c.side) ? c.side : null;
        if (!side || layout) throw new Error('bad outside clue');
        const base = { t, side, i: num(c.i, 0, n - 1) };
        if (t === 'frame' && !box) throw new Error('frame clues need boxes');
        return t === 'sky' ? { ...base, count: num(c.count, 1, n) } : { ...base, sum: num(c.sum, 0, n * n * n) };
      }
      case 'little': {
        if (![-1, 1].includes(c.dr) || ![-1, 1].includes(c.dc)) throw new Error('bad little killer');
        return { t, r: num(c.r, -1, geom.rows), c: num(c.c, -1, geom.cols), dr: c.dr, dc: c.dc, sum: num(c.sum, 1, n * n * n) };
      }
      // NOTE: the ternary has identical branches (dead code); every line clue needs at least 2 cells.
      default: return { t, cells: cellList(c.cells, t === 'arrow' ? 2 : 2) };
    }
  });
  const res = { n, box: regions ? null : box, regions, layout, rules, clues: out, givens };
  for (const k of ['variant', 'difficulty', 'title', 'seed']) if (typeof p[k] === 'string') res[k] = p[k].slice(0, 200);
  if (isInt(p.level, 0, 7)) res.level = p.level;
  return res;
}

// Classic text form: n² characters, digits / letters for givens, '.' or '0' for empty cells.
// Accepts the common pasted forms: separators | + - and whitespace are stripped. Up to 35 symbols the DIGITS
// alphabet has no case distinction, so input is lowercased; above 35 case matters.
export function parseGrid(text, n = null) {
  const s = String(text || '').replace(/[\s|+\-]/g, '');
  const size = n || Math.round(Math.sqrt(s.length));
  if (!isInt(size, MIN_N, MAX_N) || s.length !== size * size) return null;
  const givens = [];
  for (const ch of size <= 35 ? s.toLowerCase() : s) {
    if (ch === '.' || ch === '0') { givens.push(0); continue; }
    const v = DIGITS.indexOf(ch) + 1;
    if (v < 1 || v > size) return null;
    givens.push(v);
  }
  return { n: size, box: defaultBox(size), regions: null, layout: null, rules: [], clues: [], givens, variant: 'classic' };
}
