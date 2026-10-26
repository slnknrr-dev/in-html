// carpet/share.js - share codes of rug designs: the tradition, seed, size, knot density, palette and every option
// that differs from what the seed would choose, in one readable code ('persian.cold-river-41.170x240.160' with
// optional '.p-<palette>' and '.o-<base64url JSON>' parts: options, composition layers, hand edits). The same code
// regenerates the same rug.
//
//   encodeShare(opts) -> code        decodeShare(code) -> opts | null

import { TRADITIONS } from './generate.js';
import { PALETTES } from './dyes.js';
import { compactLayer } from './compose.js';

// base64url of UTF-8 (TextEncoder first: btoa only accepts Latin-1 code units and throws on any other character);
// '-' '_' and no padding make the code URL- and filename-safe.
const b64u = (s) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64u = (s) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};
// Seeds are slugged to [a-z0-9-] so the code stays readable and '.' (the part separator) can never occur inside one.
export const cleanSeed = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'rug';

// Only these keys travel in the 'o-' JSON part, whitelisted both when encoding and decoding: a crafted code cannot
// inject arbitrary options. Values are not validated here; generateRug normalizes every option it reads.
const EXTRA = ['field', 'symmetry', 'wallpaper', 'corners', 'borderMotif', 'fieldMotif', 'guards', 'borders', 'overrides', 'pileMm', 'fringeCm', 'layers', 'edits'];

// Design principle: the code stores the seed plus only the DIFFERENCES from what the seed would pick, so most
// codes stay short and human-readable; the deterministic generator reproduces the rest.
export function encodeShare(o) {
  const parts = [o.tradition || 'persian', cleanSeed(o.seed), `${Math.round(o.widthCm || 120)}x${Math.round(o.lengthCm || 180)}`, String(Math.round(o.kpsi || 100))];
  if (o.palette) parts.push('p-' + o.palette);
  const extra = {};
  for (const k of EXTRA) if (o[k] != null && o[k] !== '' && !(typeof o[k] === 'object' && !Object.keys(o[k]).length)) extra[k] = o[k];
  if (extra.layers) extra.layers = extra.layers.map(compactLayer);
  if (Object.keys(extra).length) parts.push('o-' + b64u(JSON.stringify(extra)));
  return parts.join('.');
}

// Strict on the fixed parts (known tradition, 1-3 digit sizes and density), lenient on optional parts: an unknown
// palette or a damaged JSON part is ignored instead of rejecting the whole code.
export function decodeShare(code) {
  const parts = String(code || '').trim().split('.');
  if (parts.length < 4 || !TRADITIONS[parts[0]]) return null;
  const size = /^(\d{1,3})x(\d{1,3})$/.exec(parts[2]);
  if (!size || !/^\d{1,3}$/.test(parts[3])) return null;
  const o = { tradition: parts[0], seed: cleanSeed(parts[1]), widthCm: +size[1], lengthCm: +size[2], kpsi: +parts[3] };
  for (const p of parts.slice(4)) {
    if (p.startsWith('p-') && PALETTES[p.slice(2)]) o.palette = p.slice(2);
    else if (p.startsWith('o-')) {
      try {
        const extra = JSON.parse(unb64u(p.slice(2)));
        for (const k of EXTRA) if (extra[k] != null) o[k] = extra[k];
      } catch { /* ignore a damaged part */ }
    }
  }
  return o;
}
