// mines/code.js - text forms of games: share codes (configuration + seed or layout + start cell + moves), compact
// move lists and layout bitsets in base64url, so a link's hash can carry a board or a whole replay.
//
// encodeGame({ cfg, seed?, bits?, start?, moves? }) -> 'g=1&w=16&h=16&m=40&seed=…'
// decodeGame(text) -> { cfg, seed | null, bits | null, start, moves } | null   (text: a code, a hash or a full URL)
// encodeMoves(moves) / decodeMoves(text)   [[t ms, code, cell], …] <-> base64url of varints (time deltas)
// bitsToMines(bits, n) / minesToBits(mine)

import { normalizeConfig } from './config.js';

// Codes are URLSearchParams text: readable, debuggable in the address bar, and defaults are omitted to keep links
// short. decodeGame re-runs normalizeConfig, so a hand-edited link can never produce an invalid board.
const FIRST = { opening: 'o', safe: 's', marked: 'k', off: 'x' };
const FIRST_BACK = Object.fromEntries(Object.entries(FIRST).map(([k, v]) => [v, k]));

// Chunks of 32k characters: String.fromCharCode(...bytes) on a whole large array exceeds the engine's argument limit.
export function toBase64Url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text) {
  const s = String(text).replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*$/.test(s)) throw new Error('not base64url');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// 1 bit per cell, LSB first: a 30x16 expert layout is 60 bytes, 80 base64url characters.
export function minesToBits(mine) {
  const out = new Uint8Array(Math.ceil(mine.length / 8));
  for (let i = 0; i < mine.length; i++) if (mine[i]) out[i >> 3] |= 1 << (i & 7);
  return out;
}

export function bitsToMines(bits, n) {
  const mine = new Uint8Array(n);
  for (let i = 0; i < n; i++) mine[i] = (bits[i >> 3] >> (i & 7)) & 1;
  return mine;
}

// Moves as unsigned LEB128 varints: time delta, then code + 4 · (cell + 1).
// Varints of time deltas: most deltas are < 16 s, so a move costs a few bytes. Arithmetic uses / and % instead of
// bit shifts, which would truncate to 32 bits for long games. cell + 1 lets -1 ("no cell") encode as 0.
export function encodeMoves(moves) {
  const out = [];
  const put = (v) => { v = Math.max(0, Math.floor(v)); while (v >= 128) { out.push((v % 128) | 128); v = Math.floor(v / 128); } out.push(v); };
  let prev = 0;
  for (const [t, code, cell] of moves) {
    put(Math.max(0, t - prev));
    prev = Math.max(prev, t);
    put(code + 4 * (cell + 1));
  }
  return toBase64Url(Uint8Array.from(out));
}

export function decodeMoves(text) {
  const b = fromBase64Url(text);
  let p = 0;
  const get = () => {
    let v = 0, mul = 1;
    for (;;) {
      if (p >= b.length) throw new Error('truncated move list');
      const x = b[p++];
      v += (x & 127) * mul;
      if (x < 128) return v;
      mul *= 128;
    }
  };
  const moves = [];
  let t = 0;
  while (p < b.length) {
    t += get();
    const v = get();
    moves.push([t, v % 4, Math.floor(v / 4) - 1]);
  }
  return moves;
}

export function encodeGame({ cfg, seed = null, bits = null, start = -1, moves = null }) {
  const c = normalizeConfig(cfg);
  const q = new URLSearchParams();
  q.set('g', '1');
  q.set('w', c.w);
  q.set('h', c.h);
  q.set('m', c.mines);
  if (c.grid !== 'square') q.set('grid', c.grid);
  if (c.nb !== 'king') q.set('nb', c.nb);
  if (c.wrap) q.set('wrap', '1');
  if (c.first !== 'opening') q.set('first', FIRST[c.first]);
  if (c.noGuess) q.set('ng', '1');
  if (c.marks) q.set('qm', '1');
  if (seed != null) q.set('seed', seed);
  else if (bits) q.set('lay', toBase64Url(bits));
  if (start >= 0) q.set('at', start);
  if (moves && moves.length) q.set('r', encodeMoves(moves));
  return q.toString();
}

// Accepts a bare code, a #hash or a full URL. Any malformed part (base64, truncated varints) throws inside and the
// whole code is rejected (null): a half-decoded replay would show moves on the wrong cells.
export function decodeGame(text) {
  let s = String(text || '').trim();
  const hash = s.indexOf('#');
  if (hash >= 0) s = s.slice(hash + 1);
  if (s.startsWith('?')) s = s.slice(1);
  if (!/(^|&)g=1(&|$)/.test(s)) return null;
  try {
    const q = new URLSearchParams(s);
    const num = (k, d) => (q.has(k) && /^\d+$/.test(q.get(k)) ? +q.get(k) : d);
    const cfg = normalizeConfig({
      w: num('w', 9), h: num('h', 9), mines: num('m', 10), grid: q.get('grid') || 'square', nb: q.get('nb') || 'king',
      wrap: q.get('wrap') === '1', first: FIRST_BACK[q.get('first')] || 'opening', noGuess: q.get('ng') === '1', marks: q.get('qm') === '1',
    });
    const n = cfg.w * cfg.h;
    const seed = q.has('seed') ? q.get('seed') : null;
    let bits = null;
    if (seed == null && q.has('lay')) {
      bits = fromBase64Url(q.get('lay'));
      if (bits.length < Math.ceil(n / 8)) return null;
    }
    const start = q.has('at') && num('at', -1) < n ? num('at', -1) : -1;
    const moves = q.has('r') ? decodeMoves(q.get('r')).filter(([, code, cell]) => code <= 3 && cell < n) : null;
    return { cfg, seed, bits, start, moves };
  } catch {
    return null;
  }
}
