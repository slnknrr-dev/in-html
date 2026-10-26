// stitch/threads.js - thread catalogues as data: DMC (complete stranded-cotton range with the 2017 colours), Anchor,
// Madeira, Gamma and PNK Kirova, colour lookups in CIELAB with ΔE2000 (color/), cross-references between brands,
// blended threads.
//
//   BRANDS                         [{ id, brand, name, skeinMeters, strands }]
//   catalog(id) -> { id, brand, name, skeinMeters, strands, threads: [thread], byCode: Map }
//     thread = { key: 'dmc:310', catalog: 'dmc', brand: 'DMC', code: '310', name, hex: '#000000', rgb: [r, g, b]
//                (0..255), lab: [L, a, b], eq?: ['310', …] (DMC equivalents of a derived catalogue), approx?: true }
//   findThread(id, code) -> thread | null           code is normalized ('0310' == '310' for DMC, 'blanc' == 'White')
//   threadByKey('dmc:310') -> thread | null
//   nearestThreads(color, id, { n = 5, exclude, within }) -> [{ thread, dE }]   color: hex | [r, g, b] | { lab }
//   crossReference(thread, toId, { n = 3 }) -> [{ thread, dE, table: boolean }]  table equivalents first, then ΔE2000
//   mixColors(rgbs, weights?) -> [r, g, b]          blend of strands (mixing in linear light)
//   blendThread(threads) -> pseudo thread of a blend ({ key: 'dmc:310+dmc:321', blend: [...], hex, rgb, lab })
//   rgbToLab([r, g, b]) / hexToRgb / rgbToHex / deltaE(lab1, lab2) (ΔE2000)
//
// RGB values: DMC from public colour tables (threads-dmc.js); the other brands get the colour of their DMC
// equivalents in public cross-reference tables (threads-xref.js), averaged in CIELAB when a thread has several.
// Screen colours are approximations of dyed cotton and differ between tables and monitors.

import { srgbToLab, labToSrgb } from '../color/space.js';
import { deltaE2000 } from '../color/metrics.js';
import { DMC_TABLE } from './threads-dmc.js';
import { XREF_ANCHOR, XREF_GMK, XREF_MGDA } from './threads-xref.js';

// Design: catalogues are built lazily on first catalog(id) call and memoised in CATALOGS: parsing ~1500 table
// lines and converting every colour to Lab is work that pages which never touch threads should not pay for.
// Thread objects are shared singletons (KEYS index), so identity comparison and Map keys work across modules.
// Derived catalogues never invent colours: an Anchor / Gamma / Madeira / PNK thread exists only if a table maps it
// to a DMC thread, and it takes that DMC colour. Matching dyes across brands by measured colour would need
// spectral data nobody publishes.
export const BRANDS = [
  { id: 'dmc', brand: 'DMC', name: 'DMC Mouliné Spécial 25', skeinMeters: 8, strands: 6 },
  { id: 'anchor', brand: 'Anchor', name: 'Anchor Stranded Cotton', skeinMeters: 8, strands: 6 },
  { id: 'madeira', brand: 'Madeira', name: 'Madeira Mouliné 4-ply', skeinMeters: 10, strands: 6 },
  { id: 'gamma', brand: 'Gamma', name: 'Gamma Mouliné', skeinMeters: 8, strands: 6 },
  { id: 'pnk', brand: 'PNK Kirova', name: 'PNK Kirova Mouliné', skeinMeters: 10, strands: 6 },
];

// --- colour helpers ----------------------------------------------------------------------------------------------

// Lenient: accepts '#rgb', '#rrggbb', without '#'; garbage gives black instead of NaN (callers render, not validate).
export const hexToRgb = (hex) => {
  const s = String(hex).replace(/^#/, '');
  const n = parseInt(s.length === 3 ? s.replace(/./g, '$&$&') : s.slice(0, 6), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [0, 0, 0];
};
export const rgbToHex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
export const rgbToLab = (rgb) => srgbToLab([rgb[0] / 255, rgb[1] / 255, rgb[2] / 255]);
export const labToRgb = (lab) => labToSrgb(lab).map((v) => Math.max(0, Math.min(255, Math.round(v * 255))));
export const deltaE = (a, b) => deltaE2000(a, b);

// sRGB <-> linear light (IEC 61966-2-1 piecewise curve), needed for physically meaningful mixing.
const toLin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const fromLin = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

// Strands of several colours in one needle: the eye averages the light reflected by each strand.
// Strands lie side by side, each reflecting its own light; the eye integrates the area, so the perceived colour is
// the area-weighted average of LINEAR reflectances. Averaging sRGB values instead makes black + white = 128
// (too dark); in linear light it is ~188, which matches how a 310 + White blend actually looks.
export function mixColors(rgbs, weights) {
  const w = weights || rgbs.map(() => 1);
  const tot = w.reduce((a, b) => a + b, 0) || 1;
  const out = [0, 0, 0];
  rgbs.forEach((c, i) => { for (let k = 0; k < 3; k++) out[k] += toLin(c[k]) * w[i]; });
  return out.map((v) => Math.round(fromLin(v / tot)));
}

// Lab average is used for several DMC equivalents of one thread: Lab is close to perceptually uniform, so the mean
// lies perceptually between the inputs (linear-light averaging would pull toward the lighter one).
function avgLab(labs) {
  const s = [0, 0, 0];
  for (const l of labs) for (let k = 0; k < 3; k++) s[k] += l[k];
  return s.map((v) => v / labs.length);
}

// --- code normalization --------------------------------------------------------------------------------------------

// Codes arrive from user input and foreign files in many spellings: 'blanc' (DMC's French name), '0310', '310*'
// (asterisk = approximate in tables), 'snow white'. normCode maps every spelling to the catalogue's canonical code,
// per brand: DMC keeps a 2-digit form for 01..35 (the 2017 colours) and no leading zeros otherwise; Gamma, PNK and
// Madeira use 4-digit zero-padded numbers; Anchor none. The White branch returns 'White' for every brand (the
// madeira ternary is redundant, harmless).
const DMC_ALIAS = { blanc: 'White', white: 'White', ecru: 'Ecru', 'b5200': 'B5200', '35200': 'B5200', 'snow white': 'B5200' };
export function normCode(id, code) {
  let c = String(code ?? '').trim().replace(/\*$/, '').trim();
  if (!c || c === '-') return '';
  const low = c.toLowerCase();
  if (id === 'dmc') {
    if (DMC_ALIAS[low]) return DMC_ALIAS[low];
    if (/^\d+$/.test(c)) { const n = String(parseInt(c, 10)); return n.length === 1 ? '0' + n : n; }
    return c;
  }
  if (low === 'black') return id === 'madeira' ? 'Black' : c;
  if (low === 'white' || low === 'blanc') return id === 'madeira' ? 'White' : 'White';
  if (low === 'ecru') return 'Ecru';
  if (id === 'gamma' || id === 'pnk' || id === 'madeira') return /^\d+$/.test(c) ? c.padStart(4, '0') : c;
  if (id === 'anchor') return /^\d+$/.test(c) ? String(parseInt(c, 10)) : c;
  return c;
}

// --- catalogues ----------------------------------------------------------------------------------------------------

const CATALOGS = new Map();
const KEYS = new Map();

function makeThread(cat, code, name, rgb, extra = {}) {
  const t = { key: cat.id + ':' + code, catalog: cat.id, brand: cat.brand, code, name, hex: rgbToHex(rgb), rgb, lab: rgbToLab(rgb), ...extra };
  return t;
}

function finish(cat, threads) {
  cat.threads = threads;
  cat.byCode = new Map(threads.map((t) => [t.code.toLowerCase(), t]));
  for (const t of threads) KEYS.set(t.key, t);
  CATALOGS.set(cat.id, cat);
  return cat;
}

function buildDMC() {
  const cat = { ...BRANDS[0] };
  const threads = [];
  for (const line of DMC_TABLE.split('\n')) {
    const m = /^(\S+) ([0-9a-f]{6}) (.+)$/.exec(line.trim());
    if (m) threads.push(makeThread(cat, m[1], m[3], hexToRgb(m[2])));
  }
  return finish(cat, threads);
}

// A derived catalogue: code -> set of DMC equivalents (with "approximate" marks) from the cross-reference tables.
// Merging rules, in order of trust: exact equivalents beat approximate ones (both per pair, in add(), and per
// thread, when choosing the colour); a classic DMC colour beats a 2017 colour (01..35) when a table lists both,
// since the classic tables are older and better checked. Several remaining equivalents are averaged in Lab.
// For Anchor, the second table (XREF_MGDA) only fills codes the primary DMC <-> Anchor chart lacks.
function buildDerived(id) {
  const cat = { ...BRANDS.find((b) => b.id === id) };
  const dmc = catalog('dmc');
  const eq = new Map(); // code -> { dmc: Set, approx: boolean }
  const add = (code, dmcCode, approx) => {
    const c = normCode(id, code), d = normCode('dmc', dmcCode);
    if (!c || !d || !dmc.byCode.has(d.toLowerCase())) return;
    let e = eq.get(c);
    if (!e) eq.set(c, (e = { dmc: new Map() }));
    // Exact equivalents win over "nearest" ones.
    if (!e.dmc.has(d) || !approx) e.dmc.set(d, !!approx);
  };
  const cells = (s) => String(s || '').split(',').map((x) => x.trim()).filter((x) => x && x !== '-');
  const star = (s) => /\*/.test(s);
  if (id === 'anchor') {
    for (const line of XREF_ANCHOR.split('\n')) {
      const [d, ...an] = line.trim().split(/\s+/);
      if (!d) continue;
      for (const a of an) add(a, d, false);
    }
    for (const line of XREF_MGDA.split('\n')) {
      const p = line.trim().split('|');
      if (p.length === 4) for (const a of cells(p[3])) if (!eq.has(normCode(id, a))) add(a, p[2], true);
    }
  } else {
    const col = { gamma: 0, madeira: 2, pnk: 3 }[id];
    for (const line of XREF_GMK.split('\n')) {
      const p = line.trim().split(';');
      if (p.length !== 4) continue;
      for (const c of cells(p[col])) for (const d of cells(p[1])) add(c, d, star(c) || star(d));
    }
    if (id === 'madeira' || id === 'gamma') {
      const mc = id === 'madeira' ? 0 : 1;
      for (const line of XREF_MGDA.split('\n')) {
        const p = line.trim().split('|');
        if (p.length !== 4) continue;
        for (const c of cells(p[mc])) for (const d of cells(p[2])) add(c, d, star(c) || star(d) || star(p[mc]));
      }
    }
  }
  const threads = [];
  for (const [code, e] of eq) {
    // Exact equivalents only, when there are any.
    let list = [...e.dmc].filter(([, ap]) => !ap).map(([d]) => d);
    const approx = !list.length;
    if (approx) list = [...e.dmc.keys()];
    const ds = list.map((d) => dmc.byCode.get(d.toLowerCase()));
    // A classic DMC colour beats the 2017 colours (01-35) when both are listed.
    const classic = ds.filter((t) => !/^\d\d$/.test(t.code));
    const use = classic.length ? classic : ds;
    const lab = use.length === 1 ? use[0].lab : avgLab(use.map((t) => t.lab));
    const rgb = use.length === 1 ? use[0].rgb : labToRgb(lab);
    const name = use.length === 1 ? use[0].name : use[0].name;
    threads.push({ ...makeThread(cat, code, name, rgb), lab, eq: use.map((t) => t.code), ...(approx ? { approx: true } : {}) });
  }
  const num = (c) => (/^\d+$/.test(c) ? +c : c === 'White' ? -2 : c === 'Ecru' ? -1 : c === 'Black' ? 1e6 : 1e7);
  threads.sort((a, b) => num(a.code) - num(b.code) || a.code.localeCompare(b.code));
  return finish(cat, threads);
}

export function catalog(id) {
  const k = String(id || 'dmc').toLowerCase();
  if (CATALOGS.has(k)) return CATALOGS.get(k);
  if (k === 'dmc') return buildDMC();
  if (BRANDS.some((b) => b.id === k)) return buildDerived(k);
  return null;
}

export const brandOf = (id) => BRANDS.find((b) => b.id === id) || null;
export const brandId = (brand) => (BRANDS.find((b) => b.brand.toLowerCase() === String(brand).toLowerCase() || b.id === String(brand).toLowerCase()) || {}).id || null;

export function findThread(id, code) {
  const cat = catalog(id);
  if (!cat) return null;
  return cat.byCode.get(normCode(cat.id, code).toLowerCase()) || null;
}

// Fast path: KEYS holds every thread of the catalogues already built; otherwise building the catalogue through
// findThread populates it.
export function threadByKey(key) {
  if (KEYS.has(key)) return KEYS.get(key);
  const i = String(key).indexOf(':');
  if (i < 0) return null;
  return findThread(key.slice(0, i), key.slice(i + 1));
}

const labOf = (c) => (Array.isArray(c) ? rgbToLab(c) : typeof c === 'string' ? rgbToLab(hexToRgb(c)) : c.lab);

// Linear scan with ΔE2000: catalogues have < 600 threads and this runs per user action, not per pixel (the image
// converter uses its own pre-selecting finder). within restricts the search to a subset (e.g. a palette).
export function nearestThreads(color, id, { n = 5, exclude = null, within = null } = {}) {
  const cat = catalog(id);
  if (!cat) return [];
  const lab = labOf(color);
  const out = [];
  for (const t of within || cat.threads) {
    if (exclude && exclude.has(t.key)) continue;
    out.push({ thread: t, dE: deltaE2000(lab, t.lab) });
  }
  out.sort((a, b) => a.dE - b.dE);
  return out.slice(0, n);
}

// Equivalents in another brand: the cross-reference tables first (both catalogues derived from the same DMC
// number), then the nearest colours by ΔE2000.
// Two equivalents are "table" matches when they share a DMC equivalent, the common pivot of all tables. All table
// matches are always returned (even beyond n), then nearest-colour suggestions fill up to n. table: false tells the
// UI to label them "similar colour", not "equivalent".
export function crossReference(thread, toId, { n = 3 } = {}) {
  const to = catalog(toId);
  if (!to || !thread) return [];
  const dmcCodes = thread.catalog === 'dmc' ? [thread.code] : thread.eq || [];
  const out = [];
  const seen = new Set();
  if (toId === 'dmc') {
    for (const d of dmcCodes) { const t = findThread('dmc', d); if (t && !seen.has(t.key)) { seen.add(t.key); out.push({ thread: t, dE: deltaE2000(thread.lab, t.lab), table: true }); } }
  } else {
    for (const t of to.threads) if (t.eq && t.eq.some((d) => dmcCodes.includes(d)) && !seen.has(t.key)) { seen.add(t.key); out.push({ thread: t, dE: deltaE2000(thread.lab, t.lab), table: true }); }
  }
  out.sort((a, b) => a.dE - b.dE);
  for (const r of nearestThreads(thread, toId, { n: n + out.length })) {
    if (out.length >= Math.max(n, out.filter((x) => x.table).length)) break;
    if (!seen.has(r.thread.key)) { seen.add(r.thread.key); out.push({ ...r, table: false }); }
  }
  return out.slice(0, Math.max(n, out.filter((x) => x.table).length));
}

// A blend: several threads in one needle (one strand of each by default).
export function blendThread(threads, weights) {
  const rgb = mixColors(threads.map((t) => t.rgb), weights);
  return {
    key: threads.map((t) => t.key).join('+'), catalog: threads[0].catalog, brand: threads[0].brand,
    code: threads.map((t) => t.code).join('+'), name: threads.map((t) => t.name).join(' + '),
    hex: rgbToHex(rgb), rgb, lab: rgbToLab(rgb), blend: threads.map((t) => ({ key: t.key, brand: t.brand, code: t.code, name: t.name, hex: t.hex })),
  };
}

// The darkest thread of a catalogue (outlines: DMC 310 Black, Anchor 403…).
// Lowest L*: the default outline colour, the way charts traditionally outline in DMC 310. Assumes a known catalogue
// id (catalog() returns null for unknown ids and this would throw).
export function darkest(id) {
  const cat = catalog(id);
  return cat.threads.reduce((a, b) => (b.lab[0] < a.lab[0] ? b : a), cat.threads[0]);
}
