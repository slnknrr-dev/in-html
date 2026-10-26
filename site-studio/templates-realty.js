// site-studio/templates-realty.js - template "realty": a city and coastal property agency with a searchable
// listing catalogue (generic collection block: attributes, files, filters, ranges, sorts, details), new developments,
// neighbourhood guide, mortgage options, agents, viewing booking, valuation requests and contacts
// (en default, ru, de; theme preset 'shore').
//
// Contract of a template module: each exported template object carries an id, localized names and build(V, ...) ->
// a fresh document; templates.js adds catalogue metadata (group, mode, modules) where the module does not declare it,
// and studio/gallery.js shows the catalogue.
// The viewer API arrives as the argument V instead of an import, so templates are pure document builders that tests
// (test.js renders every template) and the gallery can run without the editor. Generated artwork and sample data are
// derived from seeds (tplHash / tplRand where used), so a template builds the same document on every run.
// Data file: names, texts, figures and art specs dominate; comments mark sections, not individual values.
import { tplHash, tplRand, tplUtf8 } from '../sample/bytes.js';
import { b64encode } from '../codec/base64.js';
import { encodePNG } from '../png/encode.js';
import { escapeHTML } from '../html/escape.js';
import { tplKit } from './templates-kit.js';
import { TPL_ART_PAINT, TPL_ART_PROFILE, TPL_ART_SVG, tplArtMap, tplArtN, tplArtWordmark, tplIsoScene } from './templates-art.js';
import { tplAgroPortrait } from './templates-agro.js';
// ===== Template: realty — Avelin Estates, city & coast property agency (en default, ru, de) =====
// Built only from the generic blocks: the listings are one `collection` whose domain lives in item attributes (Type,
// District, Rooms, Area, Floor, Year built, Status…), files (floor plans, brochures) and tags. Pictures are data for
// the generic isometric kit (templates-art.js); floor plans are data drawn as SVG and PNG.
// All agencies, people, places, phone numbers, properties and figures below are FICTIONAL.

// ---------------------------------------------------------------------------
// Pictures as data
// ---------------------------------------------------------------------------

/** Paints [top, +y face, +x face] of the coastal palette (plus the generic kit's). */
const TPL_RE_PAINT = {
  render: ['#ffffff', '#ece8e1', '#d6d0c5'],
  sand: ['#f6ead6', '#e5d3b3', '#c9b38e'],
  warm: ['#fbe3cf', '#ecc3a2', '#cf9f7c'],
  sage: ['#e2ebdf', '#c3d3bf', '#9fb39b'],
  blue: ['#e3eef3', '#c2d6df', '#9db8c4'],
  teal: ['#5c9fa0', '#2a6e72', '#1b5257'],
  glass: ['#dcedf1', '#a3c9d2', '#7eaab6'],
  glassDark: ['#9fc4cd', '#5f8f9c', '#456f7b'],
  lit: ['#ffe9b8', '#f6cf7c', '#d9a84e'],
  roof: ['#8996a0', '#5e6b74', '#47525a'],
  slate: ['#6f7c86', '#4c5861', '#38424a'],
  terracotta: ['#eba886', '#c9724f', '#a0573b'],
  brick: ['#cc8f6e', '#a65c40', '#7f4630'],
  grass: ['#cfe5bb', '#a4c98d', '#80a86c'],
  hedge: ['#a7d095', '#64a05a', '#4a8043'],
  pine: ['#86b896', '#3f7d58', '#2d5e43'],
  crown: ['#a9cf8f', '#6aa35d', '#4f8547'],
  water: ['#bfe3ea', '#8cc6d3', '#6eaab9'],
  pool: ['#b2ecf2', '#5cc1d0', '#3a9fae'],
  paving: ['#f1ece3', '#dcd3c5', '#c3b8a7'],
  deck: ['#e7c49b', '#c69c6d', '#a07a50'],
  wood: TPL_ART_PAINT.wood,
  timber: ['#e2bf95', '#bd9264', '#966f48'],
  dark: ['#5d6872', '#3d464e', '#2b3238'],
  white: ['#ffffff', '#f2f2f0', '#dcdcd8'],
  linen: ['#f4efe6', '#e2d9ca', '#c8bda9'],
  textile: ['#9fc0c2', '#6e9799', '#567b7d'],
  ochre: ['#f2cf86', '#d9a94e', '#b5873a'],
  steel: TPL_ART_PAINT.steel,
  red: ['#f08f7a', '#cf5641', '#a8402f'],
};

const tplRePaint = (k) => (Array.isArray(k) ? k : TPL_RE_PAINT[k] || TPL_ART_PAINT[k] || TPL_RE_PAINT.render);

/** Windows on the two visible faces of a box: o = {n floors, ww, wh, pitch, sill, c, faces 'xy'|'x'|'y', from}. */
function tplReWindows(x, y, z, w, d, h, o = {}) {
  const n = o.n || 1, fh = h / n, ww = o.ww || 1.5, wh = o.wh || fh * 0.52, pitch = o.pitch || 3.4;
  const sill = o.sill != null ? o.sill : (fh - wh) * 0.55;
  const c = tplRePaint(o.c || 'glass');
  const cols = (len) => {
    const k = Math.max(1, Math.floor((len - 0.8) / pitch));
    const gap = (len - k * ww) / (k + 1);
    return Array.from({ length: k }, (_, i) => gap + i * (ww + gap));
  };
  const out = [];
  for (let f = o.from || 0; f < n; f++) {
    const zz = z + f * fh + sill;
    if (o.faces !== 'x') for (const u of cols(w)) out.push({ box: [x + u, y + d, zz, ww, 0.14, wh], c: o.lit && o.lit(f, u) ? TPL_RE_PAINT.lit : c });
    if (o.faces !== 'y') for (const u of cols(d)) out.push({ box: [x + w, y + u, zz, 0.14, ww, wh], c: o.lit && o.lit(f, u + 50) ? TPL_RE_PAINT.lit : c });
  }
  return out;
}

/** Balconies on the +y face (slab + glass rail) and optionally the +x face, floors o.from..n-1. */
function tplReBalconies(x, y, z, w, d, h, o = {}) {
  const n = o.n || 1, fh = h / n, out = [];
  const bw = o.bw || w * 0.6, bx = x + (o.bx != null ? o.bx : (w - bw) / 2), dep = o.dep || 1.5;
  for (let f = o.from || 1; f < n; f++) {
    const zz = z + f * fh;
    out.push({ box: [bx, y + d, zz - 0.1, bw, dep, 0.3], c: TPL_RE_PAINT.white });
    out.push({ box: [bx, y + d + dep - 0.1, zz + 0.2, bw, 0.1, 1.05], c: o.rail || TPL_RE_PAINT.glass });
    if (o.side) {
      const sd = o.sw || d * 0.5, sy = y + (d - sd) / 2;
      out.push({ box: [x + w, sy, zz - 0.1, dep, sd, 0.3], c: TPL_RE_PAINT.white });
      out.push({ box: [x + w + dep - 0.1, sy, zz + 0.2, 0.1, sd, 1.05], c: o.rail || TPL_RE_PAINT.glass });
    }
  }
  return out;
}

/** Conifer (cone crown) or broadleaf tree (two frustums) at ground level. */
function tplReTree(x, y, s = 1, kind = 'pine') {
  if (kind === 'round') {
    return [
      { cyl: [x, y, 0], r: 0.25 * s, len: 1.6 * s, c: 'wood' },
      { cyl: [x, y, 1.3 * s], r: 0.9 * s, r1: 1.7 * s, len: 1.3 * s, c: TPL_RE_PAINT.crown },
      { cyl: [x, y, 2.6 * s], r: 1.7 * s, r1: 0.5 * s, len: 1.7 * s, c: TPL_RE_PAINT.crown },
    ];
  }
  return [
    { cyl: [x, y, 0], r: 0.22 * s, len: 1.2 * s, c: 'wood' },
    { cyl: [x, y, 1 * s], r: 1.45 * s, r1: 0.1 * s, len: 3.8 * s, c: TPL_RE_PAINT.pine },
  ];
}

/** Small sailing boat on the water (hull, mast, sail), facing +x. */
function tplReBoat(x, y, s = 1, sail = '#ffffff') {
  return [
    { prism: [x, y, -0.2], axis: 'x', len: 6 * s, profile: TPL_ART_PROFILE.trapezoid(1.4 * s, 2.4 * s, 0.9 * s), c: 'white' },
    { box: [x + 1.2 * s, y - 0.5 * s, 0.7 * s, 3.6 * s, 1 * s, 0.12 * s], c: 'deck' },
    { cyl: [x + 3 * s, y, 0.7 * s], r: 0.1 * s, len: 7 * s, c: 'steel' },
    { prism: [x + 3.1 * s, y - 0.05 * s, 1.3 * s], axis: 'y', len: 0.1 * s, profile: [[0, 0], [3.2 * s, 0], [0, 6 * s]], c: [sail, sail, '#e8e4dc'] },
  ];
}

/** Ground slab (top at z = 0) with an optional soft shadow under a footprint. */
const tplReGround = (x, y, w, d, c = 'grass', h = 0.8) => ({ box: [x, y, -h, w, d, h], c: tplRePaint(c) });

/** Mid-rise block: body, windows, balconies, roof parapet. o = {w, d, n, fh, wall, roof, balc, side, lit, glass}. */
function tplReBlock(x, y, o = {}) {
  const w = o.w || 16, d = o.d || 12, n = o.n || 6, fh = o.fh || 3, h = n * fh;
  const wall = tplRePaint(o.wall || 'render');
  const s = [{ box: [x, y, 0, w, d, h], c: wall }];
  s.push({ box: [x - 0.15, y - 0.15, 0, w + 0.3, d + 0.3, fh * 0.32], c: tplRePaint(o.base || 'paving') });
  s.push(...tplReWindows(x, y, 0, w, d, h, { n, c: o.glass || 'glass', ww: o.ww || 1.7, pitch: o.pitch || 3.6, lit: o.lit, from: o.shop ? 1 : 0 }));
  if (o.shop) s.push({ box: [x + 1, y + d, 0.3, w - 2, 0.14, fh * 0.62], c: 'glassDark' }, { box: [x + 0.6, y + d, fh * 0.72, w - 1.2, 1.2, 0.18], c: tplRePaint(o.awning || 'teal') });
  if (o.balc !== false) s.push(...tplReBalconies(x, y, 0, w, d, h, { n, bw: o.bw || w * 0.62, side: o.side, sw: d * 0.55 }));
  if (o.roof === 'gable') s.push({ prism: [x + w / 2, y, h], axis: 'y', len: d, profile: TPL_ART_PROFILE.gable(w + 0.6, o.rh || 4.2), c: tplRePaint(o.roofC || 'slate') });
  else {
    s.push({ box: [x - 0.1, y - 0.1, h, w + 0.2, d + 0.2, 0.6], c: wall });
    if (o.top) s.push({ box: [x + w * 0.55, y + d * 0.2, h + 0.6, w * 0.3, d * 0.4, 2.2], c: tplRePaint('roof') });
  }
  return s;
}

/** Slim tower: glass body with white floor bands, set-back penthouse with a pergola. o = {w, d, n, fh, lit}. */
function tplReTower(x, y, o = {}) {
  const w = o.w || 11, d = o.d || 11, n = o.n || 12, fh = o.fh || 3.1, h = n * fh;
  const s = [{ box: [x, y, 0, w, d, h], c: tplRePaint(o.glass || 'glass') }];
  for (let f = 0; f <= n; f++) {
    s.push({ box: [x - 0.25, y - 0.25, f * fh - 0.18, w + 0.5, d + 0.5, 0.4], c: TPL_RE_PAINT.white });
    if (o.lit && f < n) {
      for (const [k, u] of [[0, 1.2], [1, 5.6]]) if (o.lit(f, k)) s.push({ box: [x + u, y + d + 0.05, f * fh + 0.5, 3.4, 0.12, fh - 1], c: TPL_RE_PAINT.lit });
    }
  }
  if (o.balc !== false) for (let f = 1; f < n; f++) s.push({ box: [x + w * 0.15, y + d + 0.2, f * fh + 0.2, w * 0.7, 0.1, 1], c: TPL_RE_PAINT.glass });
  // penthouse: set back, terrace rail, pergola beams
  const ph = 3.2, px = x + 1.8, py = y + 1.6, pw = w - 4.4, pd = d - 4.6;
  s.push({ box: [px, py, h, pw, pd, ph], c: tplRePaint(o.pent || 'render') });
  s.push(...tplReWindows(px, py, h, pw, pd, ph, { n: 1, ww: 2.2, pitch: 3, c: 'glassDark' }));
  for (let k = 0; k < 4; k++) s.push({ box: [px + pw, py + 0.4 + k * (pd + 2.4) / 4, h + ph - 0.25, 2.6, 0.22, 0.22], c: 'timber' });
  s.push({ box: [px + pw, py + pd + 2.2, h + ph - 0.25, 2.6, 0.22, 0.22], c: 'timber' });
  s.push({ box: [x - 0.25, y + d + 0.05, h + 0.2, w + 0.5, 0.12, 1.1], c: TPL_RE_PAINT.glass }, { box: [x + w + 0.05, y - 0.25, h + 0.2, 0.12, d + 0.3, 1.1], c: TPL_RE_PAINT.glass });
  s.push({ cyl: [x + w - 1.2, y + d - 1.2, h + 0.2], r: 0.6, len: 0.8, c: 'terracotta' }, { cyl: [x + w - 1.2, y + d - 1.2, h + 1], r: 0.8, r1: 0.1, len: 2.2, c: 'pine' });
  return s;
}

/** Row of townhouses along +x with gable roofs, doors and front gardens. o = {n, uw, d, h, walls, roofC}. */
function tplReTownhouses(x, y, o = {}) {
  const n = o.n || 4, uw = o.uw || 6.4, d = o.d || 10, h = o.h || 8.4;
  const walls = o.walls || ['render', 'sand', 'warm', 'sage'];
  const s = [];
  for (let i = 0; i < n; i++) {
    const ux = x + i * uw, wall = tplRePaint(walls[i % walls.length]);
    s.push({ box: [ux, y, 0, uw, d, h], c: wall });
    s.push({ box: [ux + 0.8, y + d, 0, 1.3, 0.16, 2.4], c: tplRePaint(o.door || 'teal') });
    s.push({ box: [ux + 2.8, y + d, 0.8, 2.8, 0.14, 1.8], c: 'glass' }, { box: [ux + 0.7, y + d, 3.6, 2, 0.14, 1.6], c: 'glass' }, { box: [ux + 3.3, y + d, 3.6, 2.3, 0.14, 1.6], c: 'glass' });
    s.push({ box: [ux + 1.6, y + d, 6.3, 3.2, 0.14, 1.3], c: 'glass' });
    s.push({ prism: [ux + uw / 2, y - 0.3, h], axis: 'y', len: d + 0.6, profile: TPL_ART_PROFILE.gable(uw + 0.3, o.rh || 3.6), c: tplRePaint(o.roofC || 'slate') });
    if (o.gardens !== false) s.push({ box: [ux + 2.6, y + d + 1.4, 0, uw - 3, 2.6, 0.7], c: 'hedge' });
  }
  if (o.side !== false) s.push(...tplReWindows(x + (n - 1) * uw, y, 0, uw, d, h - 1, { n: 2, faces: 'x', ww: 1.6, pitch: 3.8 }));
  return s;
}

/** Modern villa: two cubic volumes, glass front, roof terrace, pool and loungers. o = {wall, timber, pool}. */
function tplReVilla(x, y, o = {}) {
  const s = [];
  const wall = tplRePaint(o.wall || 'render');
  s.push({ box: [x - 2, y - 2, 0, 30, 26, 0.25], c: 'paving' });
  s.push({ box: [x, y, 0.25, 20, 12, 3.6], c: wall });
  s.push({ box: [x + 1.2, y + 12, 0.45, 16, 0.14, 2.8], c: 'glassDark' }, { box: [x + 20, y + 1.2, 0.45, 0.14, 9.6, 2.8], c: 'glassDark' });
  s.push({ box: [x + 6, y - 1, 3.85, 15, 10, 3.4], c: wall });
  s.push({ box: [x + 6, y - 1, 3.85, 4, 10, 3.4], c: tplRePaint(o.timber || 'timber') });
  s.push({ box: [x + 11, y + 9, 4.3, 9, 0.14, 2.4], c: 'glass' }, { box: [x + 21, y + 0.5, 4.3, 0.14, 7.5, 2.4], c: 'glass' });
  s.push({ box: [x - 0.3, y - 0.3, 3.85, 20.6, 12.6, 0.35], c: TPL_RE_PAINT.white }, { box: [x + 5.8, y - 1.2, 7.25, 15.4, 10.4, 0.4], c: TPL_RE_PAINT.white });
  s.push({ box: [x, y + 11.9, 4.2, 6, 0.1, 1], c: 'glass' });
  if (o.pool !== false) {
    s.push({ box: [x + 3, y + 14.5, -0.4, 14, 5.2, 0.65], c: 'paving' }, { box: [x + 3.4, y + 14.9, -0.35, 13.2, 4.4, 0.62], c: 'pool' });
    for (const k of [0, 1, 2]) s.push({ box: [x + 19 + k * 0, y + 14.6 + k * 2.2, 0.25, 4, 1.3, 0.5], c: 'white' });
    s.push({ cyl: [x + 21.5, y + 21, 0.25], r: 0.08, len: 3, c: 'steel' }, { cyl: [x + 21.5, y + 21, 2.6], r: 2.2, r1: 0.1, len: 0.9, c: 'ochre' });
  }
  return s;
}

/** Brick warehouse loft by the quay: tall windows, gable roof, loading doors. */
function tplReWarehouse(x, y, o = {}) {
  const w = o.w || 20, d = o.d || 12, n = o.n || 4, fh = 3.4, h = n * fh;
  const s = [{ box: [x, y, 0, w, d, h], c: tplRePaint(o.wall || 'brick') }];
  for (let f = 1; f < n; f++) s.push({ box: [x - 0.1, y - 0.1, f * fh - 0.15, w + 0.2, d + 0.2, 0.3], c: 'sand' });
  s.push(...tplReWindows(x, y, 0, w, d, h, { n, ww: 1.5, wh: 2.3, pitch: 2.9, c: o.glass || 'glassDark', lit: o.lit }));
  s.push({ box: [x + w / 2 - 1.5, y + d, 0, 3, 0.2, 3.2], c: 'teal' });
  s.push({ prism: [x + w / 2, y - 0.3, h], axis: 'y', len: d + 0.6, profile: TPL_ART_PROFILE.gable(w + 0.6, 4.6), c: 'slate' });
  s.push({ box: [x + w - 4, y + d * 0.35, h + 1, 0.2, 3, 3.6], c: 'dark' }, { box: [x + w * 0.3, y + d * 0.2, h, 1.2, 1.2, 4.8], c: 'brick' });
  return s;
}

/** Detached house: gable roof, chimney, garage, fence. o = {wall, roofC, garage, workshop}. */
function tplReHouse(x, y, o = {}) {
  const s = [];
  const wall = tplRePaint(o.wall || 'render');
  s.push({ box: [x, y, 0, 12, 9, 6.2], c: wall });
  s.push({ box: [x + 1, y + 9, 0, 1.4, 0.16, 2.4], c: tplRePaint(o.door || 'teal') });
  s.push({ box: [x + 3.6, y + 9, 0.8, 3, 0.14, 1.7], c: 'glass' }, { box: [x + 7.8, y + 9, 0.8, 3, 0.14, 1.7], c: 'glass' });
  s.push({ box: [x + 1.2, y + 9, 3.6, 2.4, 0.14, 1.5], c: 'glass' }, { box: [x + 4.8, y + 9, 3.6, 2.4, 0.14, 1.5], c: 'glass' }, { box: [x + 8.4, y + 9, 3.6, 2.4, 0.14, 1.5], c: 'glass' });
  s.push({ box: [x + 12, y + 1.5, 0.8, 0.14, 2.4, 1.7], c: 'glass' }, { box: [x + 12, y + 5.2, 0.8, 0.14, 2.4, 1.7], c: 'glass' }, { box: [x + 12, y + 3.3, 3.6, 0.14, 2.4, 1.5], c: 'glass' });
  s.push({ prism: [x + 6, y - 0.4, 6.2], axis: 'y', len: 9.8, profile: TPL_ART_PROFILE.gable(13, 4.4), c: tplRePaint(o.roofC || 'terracotta') });
  s.push({ box: [x + 8.5, y + 2, 7.8, 1.1, 1.1, 3.2], c: 'brick' });
  if (o.garage !== false) {
    s.push({ box: [x + 12.4, y + 2, 0, 6, 7, 3.2], c: wall }, { box: [x + 12.2, y + 1.8, 3.2, 6.4, 7.4, 0.3], c: 'white' });
    s.push({ box: [x + 13.2, y + 9, 0, 4.4, 0.16, 2.5], c: tplRePaint(o.gdoor || 'linen') });
    if (o.workshop) s.push({ box: [x + 18.4, y + 3, 0.6, 0.14, 4, 1.6], c: 'glass' });
  }
  return s;
}

/** Timber-clad garden house on the dunes with solar panels. */
function tplReDuneHouse(x, y, o = {}) {
  const s = [];
  s.push({ box: [x, y, 0, 13, 9, 3.3], c: tplRePaint(o.wall || 'render') });
  s.push({ box: [x + 1, y + 9, 0.3, 8, 0.14, 2.6], c: 'glassDark' }, { box: [x + 13, y + 1, 0.3, 0.14, 4.5, 2.6], c: 'glassDark' });
  s.push({ box: [x + 3, y - 0.5, 3.3, 10.5, 8, 3], c: tplRePaint(o.timber || 'timber') });
  s.push({ box: [x + 5, y + 7.5, 3.8, 6, 0.14, 2], c: 'glass' }, { box: [x + 13.5, y + 1, 3.8, 0.14, 4.6, 2], c: 'glass' });
  s.push({ box: [x - 0.2, y - 0.2, 3.25, 13.4, 9.4, 0.25], c: 'white' }, { box: [x + 2.8, y - 0.7, 6.3, 10.9, 8.4, 0.3], c: 'white' });
  for (let k = 0; k < 3; k++) s.push({ box: [x + 4 + k * 3.1, y + 0.6, 6.6, 2.8, 5.6, 0.25], c: 'dark' });
  s.push({ box: [x + 1, y + 9.4, 0, 9, 3.2, 0.35], c: 'deck' });
  return s;
}

/** Dune ridges (sand prisms along x) at ground level. */
function tplReDunes(x, y, w, n = 3, seed = 1) {
  const rnd = tplRand(tplHash('dunes:' + seed));
  const s = [];
  for (let i = 0; i < n; i++) {
    const b = 5 + rnd() * 4, hh = 1.2 + rnd() * 1.4;
    s.push({ prism: [x, y + i * 7 + rnd() * 2, 0], axis: 'x', len: w * (0.6 + rnd() * 0.4), profile: [[-b / 2, 0], [b / 2, 0], [b * 0.1, hh]], c: 'sand' });
  }
  return s;
}

/** Lighthouse with red bands and a lit lantern. */
function tplReLighthouse(x, y, s = 1) {
  return [
    { cyl: [x, y, 0], r: 2.6 * s, len: 1.2 * s, c: 'stone' },
    { cyl: [x, y, 1.2 * s], r: 1.8 * s, r1: 1.25 * s, len: 13 * s, c: 'white', straps: [0.25, 0.55, 0.85], strap: '#cf5641' },
    { cyl: [x, y, 14.2 * s], r: 1.7 * s, len: 0.4 * s, c: 'dark' },
    { cyl: [x, y, 14.6 * s], r: 1.05 * s, len: 1.8 * s, c: 'lit' },
    { cyl: [x, y, 16.4 * s], r: 1.4 * s, r1: 0.15 * s, len: 1.6 * s, c: 'red' },
  ];
}

/** Quay edge (stone) with bollards along +x. */
function tplReQuay(x, y, w, d = 3) {
  const s = [{ box: [x, y, -1.4, w, d, 1.4], c: 'stone' }];
  for (let k = 3; k < w - 1; k += 8) s.push({ cyl: [x + k, y + d - 0.6, 0], r: 0.3, len: 0.7, c: 'dark' });
  return s;
}

// ----- interiors (cut-away rooms: the two back walls face the viewer) -----

/** Empty room: floor slab, back walls x = 0 / y = 0 (windows on the y = 0 wall's +y face). o = {w, d, h, floor, wall, win}. */
function tplReRoom(o = {}) {
  const w = o.w || 24, d = o.d || 20, h = o.h || 9;
  const s = [
    { box: [-0.6, -0.6, -0.8, w + 0.6, d + 0.6, 0.8], c: tplRePaint(o.floor || 'deck') },
    { box: [-0.6, -0.6, 0, 0.6, d + 0.6, h], c: tplRePaint(o.wall || 'linen') },
    { box: [0, -0.6, 0, w, 0.6, h], c: tplRePaint(o.wall2 || o.wall || 'render') },
  ];
  for (const [u, ww] of o.win || [[3, 6], [12, 6]]) {
    s.push({ box: [u, 0, 1.6, ww, 0.06, h - 3.4], c: tplRePaint(o.view || 'water') });
    s.push({ box: [u + ww / 2 - 0.08, 0.06, 1.6, 0.16, 0.08, h - 3.4], c: 'white' });
  }
  return s;
}

const tplRePlant = (x, y, s = 1) => [{ cyl: [x, y, 0], r: 0.9 * s, r1: 0.7 * s, len: 1.4 * s, c: 'terracotta' }, { cyl: [x, y, 1.4 * s], r: 1.3 * s, r1: 0.15 * s, len: 3.2 * s, c: 'pine' }];

/** Living room: sofa, armchair, coffee table, rug, lamp, shelf, plant. */
function tplReLiving() {
  const s = tplReRoom({ floor: 'deck', wall: 'sand', wall2: 'render', win: [[4, 7], [14, 7]] });
  s.push({ box: [-0.05, 5, 3, 0.12, 6, 4], c: 'textile' }, { box: [-0.02, 5.4, 3.4, 0.12, 5.2, 3.2], c: 'ochre' });
  s.push({ box: [5, 6, 0, 13, 9, 0.08], c: 'linen' });
  s.push({ box: [2, 2.5, 0, 3, 12, 1.6], c: 'textile' }, { box: [0.8, 2.5, 0, 1.4, 12, 3.2], c: 'textile' }, { box: [2, 1.5, 0, 3, 1, 2.4], c: 'textile' }, { box: [2, 14.5, 0, 3, 1, 2.4], c: 'textile' });
  s.push({ box: [9, 7.5, 0, 6, 5, 1.3], c: 'timber' }, { cyl: [11, 9, 1.3], r: 0.5, len: 0.9, c: 'white' }, { box: [12.2, 10, 1.3, 2, 1.4, 0.3], c: 'red' });
  s.push({ box: [16, 13, 0, 4, 4, 1.8], c: 'ochre' }, { box: [19.4, 13, 0, 0.8, 4, 3.4], c: 'ochre' });
  s.push({ cyl: [21, 3, 0], r: 0.9, len: 0.2, c: 'dark' }, { cyl: [21, 3, 0.2], r: 0.12, len: 7, c: 'dark' }, { cyl: [21, 3, 7], r: 1.4, r1: 0.6, len: 1.2, c: 'lit' });
  s.push(...tplRePlant(2.4, 17.6, 1));
  return s;
}

/** Kitchen: counters along the back walls, island with stools, pendant lamps. */
function tplReKitchen() {
  const s = tplReRoom({ floor: 'paving', wall: 'render', wall2: 'blue', win: [[13, 8]] });
  s.push({ box: [0, 0, 0, 3, 18, 3.4], c: 'white' }, { box: [-0.1, -0.1, 3.4, 3.3, 18.2, 0.3], c: 'dark' });
  s.push({ box: [3, 0, 0, 9, 3, 3.4], c: 'white' }, { box: [3, -0.1, 3.4, 9.2, 3.3, 0.3], c: 'dark' });
  s.push({ box: [0, 1, 6, 1.6, 15, 2.6], c: 'white' }, { box: [0.6, 3, 3.7, 1.8, 3, 0.25], c: 'steel' });
  s.push({ box: [8, 8, 0, 10, 4.6, 3.4], c: 'teal' }, { box: [7.8, 7.8, 3.4, 10.4, 5, 0.3], c: 'white' });
  for (const k of [0, 1, 2]) s.push({ cyl: [10 + k * 3, 14.5, 0], r: 0.7, r1: 0.4, len: 2.4, c: 'timber' }, { cyl: [10 + k * 3, 14.5, 2.4], r: 0.9, len: 0.3, c: 'timber' });
  for (const k of [0, 1, 2]) s.push({ stroke: [[[10 + k * 3, 10.3, 9], [10 + k * 3, 10.3, 7.2]]], color: '#3d464e', w: 0.08 }, { cyl: [10 + k * 3, 10.3, 6.2], r: 0.8, r1: 0.25, len: 1, c: 'ochre' });
  s.push({ cyl: [5, 1.5, 3.7], r: 0.5, len: 0.7, c: 'red' }, ...tplRePlant(20, 2, 0.8));
  return s;
}

/** Bedroom: bed with pillows and a throw, side tables with lamps, wardrobe, rug. */
function tplReBedroom() {
  const s = tplReRoom({ floor: 'deck', wall: 'sage', wall2: 'render', win: [[13, 8]] });
  s.push({ box: [0, 0, 0, 3.2, 10, 8], c: 'linen' }, { box: [3.2, 3, 3.5, 0.08, 4, 0.8], c: 'timber' });
  s.push({ box: [5, 5.5, 0, 12, 12, 0.08], c: 'blue' });
  s.push({ box: [-0.05, 10.5, 0, 0.6, 8, 4.5], c: 'timber' });
  s.push({ box: [0.5, 10.5, 0, 9, 8, 1.8], c: 'white' }, { box: [5.2, 10.5, 1.8, 4.3, 8, 0.3], c: 'textile' }, { box: [0.8, 11.2, 1.8, 2.2, 3, 0.9], c: 'white' }, { box: [0.8, 14.8, 1.8, 2.2, 3, 0.9], c: 'white' });
  s.push({ box: [0.5, 7.3, 0, 2.4, 2.4, 2], c: 'timber' }, { cyl: [1.7, 8.5, 2], r: 0.5, len: 1.4, c: 'lit' });
  s.push(...tplRePlant(20, 16, 0.9));
  return s;
}

/** Roof terrace: deck, glass rail, loungers, planters, sea and a lighthouse beyond. */
function tplReTerrace() {
  const s = [];
  s.push({ box: [-6, 27, -14, 40, 9, 0.6], c: 'water' }, { group: [0, 0, -13.4], items: tplReBoat(4, 31, 0.9) });
  s.push({ box: [-0.6, -0.6, -14, 26, 24, 12.4], c: 'render' });
  s.push(...tplReWindows(-0.6, -0.6, -14, 26, 24, 12.4, { n: 4, ww: 2.4, pitch: 4.4, c: 'glass' }));
  s.push({ box: [-0.6, -0.6, -1.6, 26, 24, 1.6], c: 'deck' });
  s.push({ box: [-0.6, -0.6, 0, 0.6, 23.4, 7], c: 'render' }, { box: [0, -0.6, 0, 25.4, 0.6, 7], c: 'render' });
  s.push({ box: [3, 0, 0, 8, 0.06, 5.6], c: 'glassDark' });
  s.push({ box: [0, 22.8, 0, 25.4, 0.12, 2.4], c: 'glass' }, { box: [25.3, 0, 0, 0.12, 22.8, 2.4], c: 'glass' });
  for (const k of [0, 1]) s.push({ box: [14 + k * 5, 6, 0, 3.2, 8, 0.9], c: 'white' }, { box: [14 + k * 5, 6, 0.9, 3.2, 2.5, 1.2], c: 'white' });
  s.push({ cyl: [9, 14, 0], r: 2, len: 2.4, c: 'timber' }, { cyl: [6, 14, 0], r: 0.8, len: 1.6, c: 'textile' }, { cyl: [12, 14, 0], r: 0.8, len: 1.6, c: 'textile' });
  s.push({ cyl: [19, 3, 0.1], r: 0.1, len: 6.5, c: 'steel' }, { cyl: [19, 3, 5.8], r: 4.2, r1: 0.2, len: 1.4, c: 'ochre' });
  s.push(...tplRePlant(2, 20, 1), ...tplRePlant(23, 20, 0.9));
  return s;
}

// ----- exterior scenes -----

/** Person on foot (scene units ≈ metres). */
const tplRePerson = (x, y, fill = '#2f5d63', lean = 0) => ({ figure: [x, y, 0], h: 1.8, fill, lean });

/** Cover scenes of the listings (keys are the listing keys of the template). */
const TPL_RE_COVERS = {
  harbourView: () => [
    tplReGround(-4, -4, 30, 21, 'paving'), ...tplReQuay(-4, 17, 30, 3), { box: [-4, 20, -2, 30, 6, 0.6], c: 'water' },
    { shadow: [0, 0, 18, 13] }, ...tplReBlock(0, 0, { w: 18, d: 13, n: 7, wall: 'warm', roof: 'gable', roofC: 'slate', shop: true, side: true }),
    ...tplReTree(22, 5, 1, 'round'), ...tplReTree(23, 11, 0.9, 'round'), tplRePerson(9, 17), tplRePerson(14, 16.6, '#b7724f', 1), ...tplReBoat(3, 23, 0.8),
  ],
  penthouse: () => [
    tplReGround(-5, -5, 23, 25, 'paving'), { box: [-5, 20, -2, 23, 6, 0.6], c: 'water' },
    { shadow: [0, 0, 12, 12] }, ...tplReTower(0, 0, { w: 12, d: 12, n: 12 }),
    ...tplReTree(15, 3, 0.9), ...tplReTree(15.5, 9, 1), tplRePerson(6, 16), ...tplReBoat(4, 23, 0.7),
  ],
  townhouse: () => [
    tplReGround(-3, -3, 32, 20, 'grass'), { box: [-3, 14.2, 0, 32, 2.2, 0.05], c: 'paving' },
    { shadow: [0, 0, 25.6, 10] }, ...tplReTownhouses(0, 0, { n: 4, roofC: 'slate' }),
    ...tplReTree(27.5, 2, 1, 'round'), ...tplReTree(27.5, 8, 1.1, 'round'), tplRePerson(12, 15.2), tplRePerson(13, 15.4, '#c58b5c', 1),
  ],
  loft: () => [
    tplReGround(-4, -4, 29, 20, 'paving'), ...tplReQuay(-4, 16, 29, 3), { box: [-4, 19, -2, 29, 6, 0.6], c: 'water' },
    { shadow: [0, 0, 20, 12] }, ...tplReWarehouse(0, 0, { w: 20, d: 12, n: 4 }), tplRePerson(6, 15), ...tplReBoat(9, 22, 0.75, '#f6ead6'),
  ],
  studio: () => [
    tplReGround(-4, -4, 23, 18, 'grass'), { box: [-4, 12.4, 0, 23, 2.2, 0.05], c: 'paving' }, { box: [-4, 14, -2, 23, 6, 0.6], c: 'water' },
    { shadow: [0, 0, 11, 10] }, ...tplReBlock(0, 0, { w: 11, d: 10, n: 6, wall: 'blue', bw: 7, top: true }),
    ...tplReTree(14.5, 2, 1, 'round'), ...tplReTree(15, 8, 0.8), tplRePerson(7, 13.4, '#c58b5c'), ...tplReBoat(3, 17, 0.55),
  ],
  harbourLights: (o = {}) => [
    tplReGround(-5, -5, 36, 25, 'paving'), ...tplReQuay(-5, 17, 36, 3), { box: [-5, 20, -2, 36, 6, 0.6], c: o.dusk ? ['#4d7f8c', '#2e5d6b', '#22495a'] : 'water' },
    { box: [-2, -2, 0, 30, 15, 3.4], c: 'render' }, { box: [-2, 13, 0.4, 30, 0.14, 2.4], c: o.dusk ? 'lit' : 'glassDark' },
    { group: [0, 0, 3.4], items: tplReTower(0, 0, { w: 11, d: 11, n: 11, lit: o.dusk ? (f, k) => (f * 7 + k * 3) % 5 < 2 : null }) },
    { group: [15, -1, 3.4], items: tplReTower(0, 0, { w: 10, d: 10, n: 8, lit: o.dusk ? (f, k) => (f * 5 + k * 4) % 4 < 2 : null }) },
    tplRePerson(8, 16), tplRePerson(20, 16.4, '#b7724f', 1), ...tplReBoat(14, 22, 0.7),
  ],
  villa: () => [
    tplReGround(-4, -4, 32, 31, 'grass'), { box: [-4, 24.5, -0.2, 32, 2.5, 0.2], c: 'sand' }, { box: [-4, 27, -2, 32, 6, 0.6], c: 'water' },
    { shadow: [0, 0, 20, 12] }, ...tplReVilla(0, 0), ...tplReTree(26, 1, 1.1), ...tplReTree(26.5, 7, 0.9), ...tplReTree(-1.5, 19, 1),
  ],
  duneHouse: () => [
    tplReGround(-4, -4, 27, 24, 'sand'), ...tplReDunes(-4, -3.5, 27, 2, 'corran'), { box: [-4, 20, -2, 27, 6, 0.6], c: 'water' },
    { shadow: [0, 0, 13, 9] }, ...tplReDuneHouse(2, 0), ...tplReTree(19.5, 3, 1), ...tplReTree(20, 9, 0.8), tplRePerson(8, 15.5), tplRePerson(9.2, 15.7, '#c58b5c', 1),
  ],
  lindenFlat: () => [
    tplReGround(-4, -4, 31, 23, 'grass'), { box: [-4, 15, 0, 31, 2.4, 0.05], c: 'paving' },
    { shadow: [0, 0, 22, 12] }, ...tplReBlock(0, 0, { w: 22, d: 12, n: 5, wall: 'sand', roof: 'gable', roofC: 'terracotta', bw: 14 }),
    ...tplReTree(24.5, 2, 1.2, 'round'), ...tplReTree(25, 9, 1, 'round'), tplRePerson(10, 16.2), ...tplReTree(3, 18, 0.9, 'round'),
  ],
  riverside: () => [
    tplReGround(-4, -4, 26, 20, 'grass'), { box: [-4, 13.6, 0, 26, 2.4, 0.05], c: 'paving' }, { box: [-4, 16, -2, 26, 6, 0.6], c: 'water' },
    { shadow: [0, 0, 16, 11] }, ...tplReBlock(0, 0, { w: 16, d: 11, n: 8, wall: 'render', bw: 11, side: true, top: true }),
    ...tplReTree(19.5, 2, 1), ...tplReTree(20, 8, 1.1), tplRePerson(9, 14.8, '#c58b5c'), ...tplReBoat(5, 19, 0.6),
  ],
  corner: () => [
    tplReGround(-4, -4, 26, 23, 'paving'), { box: [-4, 13.5, 0, 26, 3, 0.05], c: 'dark' }, { box: [16.5, -4, 0, 3, 17.5, 0.05], c: 'dark' },
    { shadow: [0, 0, 14, 11] }, ...tplReBlock(0, 0, { w: 14, d: 11, n: 9, wall: 'sage', shop: true, awning: 'ochre', bw: 9 }),
    ...tplReTree(20.5, 3, 0.9, 'round'), tplRePerson(6, 12.4), tplRePerson(15, 12.2, '#b7724f', 1), ...tplReTree(3, 18, 0.9, 'round'),
  ],
  lindenTown: () => [
    tplReGround(-3, -3, 26, 20, 'grass'), { box: [-3, 14.2, 0, 26, 2.2, 0.05], c: 'paving' },
    { shadow: [0, 0, 19.2, 10] }, ...tplReTownhouses(0, 0, { n: 3, walls: ['white', 'blue', 'white'], roofC: 'roof', door: 'ochre' }),
    ...tplReTree(21.5, 2, 1), ...tplReTree(21.5, 8.5, 1.2, 'round'), tplRePerson(9, 15.2, '#c58b5c'),
  ],
  family: () => [
    tplReGround(-4, -4, 29, 21, 'grass'), { box: [-4, 14, 0, 29, 2.4, 0.05], c: 'paving' },
    { shadow: [0, 0, 18, 9] }, ...tplReHouse(0, 0, { wall: 'sand', roofC: 'slate', workshop: true }),
    { box: [-2, 11.6, 0, 21, 0.15, 1], c: 'white' }, ...tplReTree(-2, 2, 1.2, 'round'), ...tplReTree(21.5, 2, 1), ...tplReTree(22, 8, 0.8), tplRePerson(15, 15),
  ],
};

/** Coastal city panorama (hero): waterfront buildings, quay, lighthouse, boats, trees. */
function tplReCitySpec() {
  return [
    tplReGround(-10, -10, 92, 34, 'paving'), ...tplReQuay(-10, 24, 92, 3), { box: [-10, 27, -2.5, 92, 26, 0.6], c: 'water' },
    { anchor: [-10, 60, 0] },
    ...tplReTree(-6, -6, 1, 'round'),
    { shadow: [0, 0, 16, 12] }, ...tplReBlock(0, 0, { w: 16, d: 12, n: 6, wall: 'warm', roof: 'gable', roofC: 'terracotta', shop: true }),
    { shadow: [20, -4, 32, 8] }, ...tplReTower(20, -4, { w: 12, d: 12, n: 11 }),
    { shadow: [36, 2, 56, 14] }, ...tplReWarehouse(36, 2, { w: 20, d: 12, n: 3 }),
    ...tplReTownhouses(60, 4, { n: 3, walls: ['white', 'sand', 'blue'], roofC: 'slate', gardens: false }),
    ...tplReTree(12, 20, 0.9, 'round'), ...tplReTree(31, 19, 1, 'round'), ...tplReTree(57, 20, 0.9, 'round'),
    ...tplReLighthouse(76, 30, 1),
    ...tplReBoat(8, 36, 1.1), ...tplReBoat(34, 42, 0.9, '#f6ead6'), ...tplReBoat(56, 34, 0.8),
  ];
}

/** Linden Gardens: townhouse terraces around a garden court. */
function tplReLindenSpec() {
  return [
    tplReGround(-6, -6, 52, 46, 'grass'), { box: [8, 14, 0, 26, 14, 0.05], c: 'paving' }, { box: [12, 18, 0, 18, 6, 0.06], c: 'hedge' },
    ...tplReTownhouses(0, -2, { n: 5, walls: ['white', 'sand', 'white', 'sage', 'white'], roofC: 'slate', gardens: false }),
    ...tplReTree(4, 18, 1, 'round'), ...tplReTree(4, 26, 1.1, 'round'), ...tplReTree(36, 16, 1, 'round'),
    ...tplReTree(14, 30, 0.9), ...tplReTree(22, 30, 1.1), ...tplReTree(30, 30, 0.9),
    ...tplReTownhouses(6, 34, { n: 4, walls: ['sand', 'white', 'blue', 'white'], roofC: 'roof', gardens: false, side: false }),
  ];
}

/** Corran Dunes: villas on the dunes above the beach. */
function tplReCorranSpec() {
  return [
    tplReGround(-8, -8, 70, 40, 'sand'), { box: [-8, 32, -2, 70, 18, 0.6], c: 'water' }, ...tplReDunes(-8, -6, 70, 4, 'corran-site'),
    ...tplReDuneHouse(0, 2), ...tplReDuneHouse(22, -2, { timber: 'deck' }), ...tplReDuneHouse(42, 4),
    ...tplReTree(-4, 12, 1), ...tplReTree(18, 14, 0.9), ...tplReTree(38, 16, 1.1), ...tplReTree(60, 10, 1),
    ...tplReBoat(28, 40, 1),
  ];
}

const TPL_RE_STAGE = { light: true, pad: 46, bg0: '#eef6f5', bg1: '#f6efe3', grid: '#1f6f73', glow: [0.7, 0.18, 0.5], glowC0: '#fff7e6', glowC1: '#f1dcb6' };
const TPL_RE_DUSK = { pad: 46, bg0: '#1d3a45', bg1: '#0f2229', grid: '#e2c99a', glow: [0.72, 0.2, 0.45], glowC0: '#f6cf7c', glowC1: '#d98b4e' };

/** Paint names → colour triples (the generic kit knows only its own names), groups included. */
function tplReResolve(spec) {
  return spec.map((it) => (!it ? it : it.group ? { ...it, items: tplReResolve(it.items) } : typeof it.c === 'string' ? { ...it, c: tplRePaint(it.c) } : it));
}

/** Isometric stage of a spec with the coastal paints. */
const tplReScene = (W, H, spec, o = TPL_RE_STAGE) => tplIsoScene(W, H, tplReResolve(spec), o);

/** Listing cover (800×600). */
const tplReCover = (key) => tplReScene(800, 600, TPL_RE_COVERS[key]());

/** Brand mark: a roof line over two waves (64×64). */
function tplReBrandSVG() {
  return TPL_ART_SVG + 'viewBox="0 0 64 64" width="64" height="64">' +
    '<rect width="64" height="64" rx="16" fill="#1d6a6e"/>' +
    '<path d="M14 30L32 15L50 30" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M20 28V35M44 28V35" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/>' +
    '<path d="M12 42q5-4 10 0t10 0t10 0t10 0M12 50q5-4 10 0t10 0t10 0t10 0" fill="none" stroke="#e7cfa6" stroke-width="3.6" stroke-linecap="round"/></svg>';
}

/** City map with numbered district pins (1200×900). pins = [[x, y, n]]. */
function tplReMapSVG(seed, pins, o = {}) {
  const base = tplArtMap({
    seed, river: true, coast: 'bottom', ground: '#f1ede4', block: '#e6e0d4', building: '#d8d0c1', park: '#cfe0c2', water: '#a9d3dc', road: '#ffffff',
    pins: pins.map(([x, y, , c]) => [x, y, c || '#1d6a6e', 1.7]),
  });
  const N = tplArtN;
  const labels = pins.filter((p) => p[2] != null).map(([x, y, n]) => '<text x="' + N(x) + '" y="' + N(y - 74) + '" text-anchor="middle" font-family="system-ui,Segoe UI,Arial,sans-serif" font-size="28" font-weight="700" fill="#1d6a6e">' + escapeHTML(String(n)) + '</text>').join('');
  const title = o.title ? '<g transform="translate(40 40)"><rect width="' + (o.title.length * 19 + 48) + '" height="60" rx="30" fill="#fff" opacity=".94"/><text x="24" y="40" font-family="system-ui,Segoe UI,Arial,sans-serif" font-size="28" font-weight="700" letter-spacing="1.5" fill="#173f44">' + escapeHTML(o.title) + '</text></g>' : '';
  return base.replace(/<\/svg>$/, labels + title + '</svg>');
}

// ----- floor plans (data → SVG and PNG) -----

/**
 * Floor plan data: {w, d (outer, metres), rooms: [[x, y, w, d, name, fill]], doors: [[x, y, 'h'|'v', width]],
 * windows: [[x, y, 'h'|'v', length]], title}. Rooms tile the outline; interior walls are the room edges.
 */
const TPL_RE_FILLS = { living: '#f4ead8', bed: '#e6efe9', wet: '#dcecf2', kitchen: '#f6e3d3', hall: '#efefea', out: '#e9f1df', work: '#ece6f1' };

function tplReArea(r) { return Math.round(r[2] * r[3] * 10) / 10; }

/** Floor plan as SVG (40 px per metre, margins for dimensions and the title block). */
function tplRePlanSVG(plan) {
  const S = 40, M = 70, N = tplArtN;
  const W = Math.round(plan.w * S + M * 2), H = Math.round((plan.h || plan.d) * S + M * 2 + 64);
  const X = (v) => N(M + v * S), Y = (v) => N(M + v * S);
  const font = 'font-family="system-ui,Segoe UI,Arial,sans-serif"';
  let s = TPL_ART_SVG + 'viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '"><rect width="' + W + '" height="' + H + '" fill="#fbfaf7"/>';
  s += '<g stroke="#9aa5ab" stroke-width="1">';
  for (const r of plan.rooms) s += '<rect x="' + X(r[0]) + '" y="' + Y(r[1]) + '" width="' + N(r[2] * S) + '" height="' + N(r[3] * S) + '" fill="' + (TPL_RE_FILLS[r[5]] || '#fff') + '"/>';
  s += '</g><g fill="none" stroke="#24363b" stroke-width="5">';
  for (const r of plan.rooms) if (r[5] !== 'out') s += '<rect x="' + X(r[0]) + '" y="' + Y(r[1]) + '" width="' + N(r[2] * S) + '" height="' + N(r[3] * S) + '"/>';
  s += '</g><rect x="' + X(0) + '" y="' + Y(0) + '" width="' + N(plan.w * S) + '" height="' + N(plan.d * S) + '" fill="none" stroke="#24363b" stroke-width="11"/>';
  for (const [x, y, o, len] of plan.windows || []) {
    const hz = o === 'h';
    s += '<rect x="' + N(X(x) - (hz ? 0 : 7)) + '" y="' + N(Y(y) - (hz ? 7 : 0)) + '" width="' + N(hz ? len * S : 14) + '" height="' + N(hz ? 14 : len * S) + '" fill="#fbfaf7"/>' +
      '<path d="' + (hz ? 'M' + X(x) + ' ' + Y(y) + 'H' + X(x + len) : 'M' + X(x) + ' ' + Y(y) + 'V' + Y(y + len)) + '" stroke="#3a8fa0" stroke-width="4"/>';
  }
  for (const [x, y, o, wd] of plan.doors || []) {
    const hz = o === 'h', r = wd * S;
    s += '<rect x="' + N(X(x) - (hz ? 0 : 7)) + '" y="' + N(Y(y) - (hz ? 7 : 0)) + '" width="' + N(hz ? r : 14) + '" height="' + N(hz ? 14 : r) + '" fill="#fbfaf7"/>';
    s += hz ? '<path d="M' + X(x) + ' ' + Y(y) + 'v' + N(r) + 'A' + N(r) + ' ' + N(r) + ' 0 0 0 ' + N(X(x) + r) + ' ' + Y(y) + '" fill="none" stroke="#5f6f75" stroke-width="1.6"/>'
      : '<path d="M' + X(x) + ' ' + Y(y) + 'h' + N(r) + 'A' + N(r) + ' ' + N(r) + ' 0 0 1 ' + X(x) + ' ' + N(Y(y) + r) + '" fill="none" stroke="#5f6f75" stroke-width="1.6"/>';
  }
  for (const r of plan.rooms) {
    const cx = X(r[0] + r[2] / 2), cy = Y(r[1] + r[3] / 2);
    const fs = r[2] * S < r[4].length * 10.5 + 8 ? 12 : 15;
    const area = tplReArea(r).toFixed(1) + ' m²';
    if (r[3] * S < 64) { // a strip (hall, balcony): name and area on one line
      s += '<text x="' + cx + '" y="' + N(cy + 5) + '" text-anchor="middle" ' + font + ' font-size="13" fill="#24363b"><tspan font-weight="700">' + escapeHTML(r[4]) + '</tspan> ' + area + '</text>';
      continue;
    }
    s += '<text x="' + cx + '" y="' + N(cy - 2) + '" text-anchor="middle" ' + font + ' font-size="' + fs + '" font-weight="700" fill="#24363b">' + escapeHTML(r[4]) + '</text>' +
      '<text x="' + cx + '" y="' + N(cy + 16) + '" text-anchor="middle" ' + font + ' font-size="12.5" fill="#4d5f65">' + area + '</text>';
  }
  // dimensions: width above, depth on the left
  const dy = Y(0) - 34, dx = X(0) - 34;
  s += '<g stroke="#4d5f65" stroke-width="1.4"><path d="M' + X(0) + ' ' + N(dy) + 'H' + X(plan.w) + 'M' + X(0) + ' ' + N(dy - 7) + 'v14M' + X(plan.w) + ' ' + N(dy - 7) + 'v14"/>' +
    '<path d="M' + N(dx) + ' ' + Y(0) + 'V' + Y(plan.d) + 'M' + N(dx - 7) + ' ' + Y(0) + 'h14M' + N(dx - 7) + ' ' + Y(plan.d) + 'h14"/></g>';
  s += '<text x="' + X(plan.w / 2) + '" y="' + N(dy - 8) + '" text-anchor="middle" ' + font + ' font-size="13" fill="#4d5f65">' + plan.w.toFixed(2) + ' m</text>';
  s += '<text transform="translate(' + N(dx - 8) + ' ' + Y(plan.d / 2) + ') rotate(-90)" text-anchor="middle" ' + font + ' font-size="13" fill="#4d5f65">' + plan.d.toFixed(2) + ' m</text>';
  // north arrow and title block
  s += '<g transform="translate(' + N(W - 40) + ' 38)"><circle r="18" fill="none" stroke="#4d5f65" stroke-width="1.4"/><path d="M0-14L6 8L0 3L-6 8Z" fill="#1d6a6e"/><text y="-22" text-anchor="middle" ' + font + ' font-size="12" fill="#4d5f65">N</text></g>';
  const area = plan.rooms.filter((r) => r[5] !== 'out').reduce((a, r) => a + tplReArea(r), 0);
  s += '<text x="' + M + '" y="' + N(H - 44) + '" ' + font + ' font-size="16" font-weight="700" fill="#24363b">' + escapeHTML(plan.title || 'Floor plan') + '</text>' +
    '<text x="' + M + '" y="' + N(H - 22) + '" ' + font + ' font-size="13" fill="#4d5f65">' + area.toFixed(1) + ' m² indoors · scale 1:100 · Avelin Estates</text>';
  return s + '</svg>';
}

/** 5×7 bitmap glyphs (rows as 5-bit numbers) for the PNG plans' labels. */
const TPL_RE_GLYPHS = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31], 0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14],
  2: [14, 17, 1, 2, 4, 8, 31], 3: [31, 2, 4, 2, 1, 17, 14], 4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14],
  6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8], 8: [14, 17, 17, 14, 17, 17, 14], 9: [14, 17, 17, 15, 1, 2, 12],
  '.': [0, 0, 0, 0, 0, 12, 12], '-': [0, 0, 0, 14, 0, 0, 0], '/': [1, 1, 2, 4, 8, 16, 16], ':': [0, 12, 12, 0, 12, 12, 0], ' ': [0, 0, 0, 0, 0, 0, 0],
  '²': [12, 2, 4, 8, 14, 0, 0], '&': [12, 18, 20, 8, 21, 18, 13], '+': [0, 4, 4, 31, 4, 4, 0], ',': [0, 0, 0, 0, 12, 4, 8],
};

/** Floor plan as a PNG (blueprint print: navy paper, white lines; 22 px per metre) → base64. */
function tplRePlanPNG(plan) {
  const S = 22, M = 44;
  const W = Math.round(plan.w * S + M * 2), H = Math.round((plan.h || plan.d) * S + M * 2 + 44);
  const px = new Uint8Array(W * H * 4);
  const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const PAPER = hex('#1d4f63'), GRID = hex('#24596d'), LINE = hex('#f3f7f8'), SOFT = hex('#9cc3cf'), WIN = hex('#7fd0e0'), FILL = { out: hex('#245b6f') };
  const put = (x, y, c) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 4; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255; };
  const rect = (x, y, w, h, c) => { for (let j = Math.round(y); j < Math.round(y + h); j++) for (let i = Math.round(x); i < Math.round(x + w); i++) put(i, j, c); };
  const X = (v) => M + v * S, Y = (v) => M + v * S;
  rect(0, 0, W, H, PAPER);
  for (let i = 0; i < W; i += 11) rect(i, 0, 1, H, GRID);
  for (let j = 0; j < H; j += 11) rect(0, j, W, 1, GRID);
  for (const r of plan.rooms) if (r[5] === 'out') rect(X(r[0]), Y(r[1]), r[2] * S, r[3] * S, FILL.out);
  const frame = (x, y, w, h, t, c) => { rect(x - t / 2, y - t / 2, w + t, t, c); rect(x - t / 2, y + h - t / 2, w + t, t, c); rect(x - t / 2, y - t / 2, t, h + t, c); rect(x + w - t / 2, y - t / 2, t, h + t, c); };
  for (const r of plan.rooms) if (r[5] !== 'out') frame(X(r[0]), Y(r[1]), r[2] * S, r[3] * S, 3, LINE);
  for (const r of plan.rooms) if (r[5] === 'out') frame(X(r[0]), Y(r[1]), r[2] * S, r[3] * S, 1, SOFT);
  frame(X(0), Y(0), plan.w * S, plan.d * S, 6, LINE);
  for (const [x, y, o, len] of plan.windows || []) {
    if (o === 'h') { rect(X(x), Y(y) - 4, len * S, 8, PAPER); rect(X(x), Y(y) - 1, len * S, 3, WIN); } else { rect(X(x) - 4, Y(y), 8, len * S, PAPER); rect(X(x) - 1, Y(y), 3, len * S, WIN); }
  }
  for (const [x, y, o, wd] of plan.doors || []) {
    const r = wd * S;
    if (o === 'h') rect(X(x), Y(y) - 4, r, 8, PAPER); else rect(X(x) - 4, Y(y), 8, r, PAPER);
    for (let k = 0; k <= 60; k++) {
      const a = (k / 60) * Math.PI / 2;
      if (o === 'h') put(Math.round(X(x) + r * Math.sin(a)), Math.round(Y(y) + r * Math.cos(a)), SOFT);
      else put(Math.round(X(x) + r * Math.cos(a)), Math.round(Y(y) + r * Math.sin(a)), SOFT);
    }
    if (o === 'h') rect(X(x), Y(y), 1.5, r, SOFT); else rect(X(x), Y(y), r, 1.5, SOFT);
  }
  const text = (str, x, y, k, c, center) => {
    const s = String(str).toUpperCase();
    const w = s.length * 6 * k - k;
    let cx = Math.round(center ? x - w / 2 : x);
    for (const ch of s) {
      const g = TPL_RE_GLYPHS[ch] || TPL_RE_GLYPHS[' '];
      for (let row = 0; row < 7; row++) for (let col = 0; col < 5; col++) if (g[row] & (16 >> col)) rect(cx + col * k, y + row * k, k, k, c);
      cx += 6 * k;
    }
  };
  for (const r of plan.rooms) {
    const cx = X(r[0] + r[2] / 2), cy = Y(r[1] + r[3] / 2);
    const fits = (k) => r[4].length * 6 * k - k <= r[2] * S - 10;
    const big = fits(2) && r[3] * S > 56 ? 2 : 1;
    const area = tplReArea(r).toFixed(1) + ' M²';
    if (r[3] * S < 40 || !fits(1)) { // strips and narrow rooms: one line, the area only when the name does not fit
      text(fits(1) && (r[4].length + area.length + 1) * 6 <= r[2] * S - 10 ? r[4] + ' ' + area : fits(1) ? r[4] : area, cx, Math.round(cy - 3), 1, LINE, true);
      continue;
    }
    text(r[4], cx, Math.round(cy - 7 * big - 2), big, LINE, true);
    text(area, cx, Math.round(cy + 3), 1, SOFT, true);
  }
  text(plan.w.toFixed(2) + ' M', X(plan.w / 2), M - 24, 1, SOFT, true);
  const title = plan.title || 'FLOOR PLAN';
  text(title, M, H - 40, title.length * 12 <= W - M * 2 ? 2 : 1, LINE, false);
  const area = plan.rooms.filter((r) => r[5] !== 'out').reduce((a, r) => a + tplReArea(r), 0);
  const tail = area.toFixed(1) + ' M² - 1:100';
  text(tail, M, H - 20, 1, SOFT, false);
  return b64encode(encodePNG({ width: W, height: H, data: px }, { level: 9 }));
}

/**
 * Floor plan from rows of rooms, north to south: rows = [{d, r: [[name, fill, share], …], out}]. A room with fill null
 * is a gap; an `out` row (balcony / terrace) lies outside the walls. Doors: each room of a lower row opens to the row
 * above it (a wide opening between a living room and a kitchen side by side), outside rows open from the room above;
 * windows sit on the exterior walls of the living rooms, bedrooms and kitchens.
 */
function tplRePlan(title, w, rows) {
  const rooms = [], doors = [], windows = [];
  let y = 0, d = 0;
  const lit = (f) => f === 'living' || f === 'bed' || f === 'kitchen' || f === 'work';
  const placed = [];
  rows.forEach((row) => {
    const sum = row.r.reduce((a, x) => a + (x[2] || 1), 0);
    let x = 0;
    const cur = [];
    row.r.forEach((rm, k) => {
      const rw = k === row.r.length - 1 ? Math.round((w - x) * 100) / 100 : Math.round(((rm[2] || 1) / sum) * w * 100) / 100;
      if (rm[1]) {
        const r = [x, y, rw, row.d, rm[0], row.out ? 'out' : rm[1]];
        rooms.push(r);
        cur.push(r);
      }
      x = Math.round((x + rw) * 100) / 100;
    });
    // doors to the row above
    const above = placed[placed.length - 1] || [];
    const R2 = (v) => Math.round(v * 100) / 100;
    const span = (a, b) => [Math.max(a[0], b[0]), Math.min(a[0] + a[2], b[0] + b[2])];
    for (const r of cur) {
      const up = above.map((a) => [a, span(r, a)]).filter(([, [lo, hi]]) => hi - lo >= 1.1);
      if (!up.length) continue;
      if (r[5] === 'out') { // balcony / terrace: one wide door from the largest room above
        const [, [lo, hi]] = up.sort((x, y) => (y[1][1] - y[1][0]) - (x[1][1] - x[1][0]))[0];
        const wd = Math.min(1.6, (hi - lo) * 0.5);
        doors.push([R2((lo + hi - wd) / 2), r[1], 'h', wd]);
        continue;
      }
      const halls = up.filter(([a]) => a[5] === 'hall' || r[5] === 'hall');
      for (const [, [lo]] of halls.length ? halls : [up.sort((x, y) => (y[1][1] - y[1][0]) - (x[1][1] - x[1][0]))[0]]) doors.push([R2(lo + 0.3), r[1], 'h', 0.85]);
    }
    for (let k = 0; k + 1 < cur.length; k++) {
      const a = cur[k], b = cur[k + 1];
      if (row.out || Math.abs(a[0] + a[2] - b[0]) > 0.01) continue;
      const pair = [a[5], b[5]].sort().join();
      if (pair === 'kitchen,living') doors.push([b[0], R2(b[1] + 0.4), 'v', R2(Math.min(1.6, b[3] - 0.8))]);
      else if (a[5] === 'hall' || b[5] === 'hall') doors.push([b[0], R2(b[1] + b[3] - 1.2), 'v', 0.85]);
    }
    if (!row.out) {
      d = Math.round((y + row.d) * 100) / 100;
      for (const r of cur) {
        if (!lit(r[5])) continue;
        const len = Math.min(2.4, Math.max(0.9, r[2] * 0.42));
        if (r[1] === 0) windows.push([Math.round((r[0] + (r[2] - len) / 2) * 100) / 100, 0, 'h', len]);
        if (r[0] === 0 && r[3] > 2.4) windows.push([0, Math.round((r[1] + (r[3] - 1.2) / 2) * 100) / 100, 'v', 1.2]);
        if (Math.abs(r[0] + r[2] - w) < 0.01 && r[3] > 2.4) windows.push([w, Math.round((r[1] + (r[3] - 1.2) / 2) * 100) / 100, 'v', 1.2]);
      }
    }
    placed.push(cur);
    y = Math.round((y + row.d) * 100) / 100;
  });
  // windows on the south wall of the last indoor row (rooms without an outside room in front)
  const lastIn = placed.filter((c, i) => !rows[i].out).pop() || [];
  const outs = rooms.filter((r) => r[5] === 'out');
  for (const r of lastIn) {
    if (!lit(r[5]) || outs.some((o) => o[0] < r[0] + r[2] && o[0] + o[2] > r[0])) continue;
    const len = Math.min(2.4, Math.max(0.9, r[2] * 0.42));
    windows.push([Math.round((r[0] + (r[2] - len) / 2) * 100) / 100, d, 'h', len]);
  }
  return { title, w, d, h: y, rooms, doors, windows };
}

const tplReRow = (d, ...r) => ({ d, r });
const tplReOut = (d, ...r) => ({ d, r, out: true });

/** Floor plans of the listings: key → [[file suffix, plan, 'svg' | 'png'], …]. */
const TPL_RE_PLANS = {
  penthouse: () => [
    ['level-12', tplRePlan('Penthouse - level 12', 13.2, [
      tplReRow(5.2, ['LIVING', 'living', 6.6], ['KITCHEN', 'kitchen', 3.6], ['STUDY', 'work', 3]),
      tplReRow(1.4, ['HALL', 'hall', 1]),
      tplReRow(4.6, ['BEDROOM', 'bed', 4.4], ['BATH', 'wet', 2.2], ['BEDROOM', 'bed', 3.8], ['BATH', 'wet', 2.8]),
    ]), 'svg'],
    ['roof-terrace', tplRePlan('Penthouse - roof terrace', 10.4, [
      tplReRow(3.2, ['LOUNGE', 'living', 4.6], ['SUMMER KITCHEN', 'kitchen', 4.2], ['STORE', 'wet', 1.6]),
      tplReOut(8.6, ['ROOF TERRACE', 'out', 1]),
    ]), 'svg'],
  ],
  harbourView: () => [['plan', tplRePlan('Wharf Lane 12 - 5th floor', 10.4, [
    tplReRow(3, ['BEDROOM', 'bed', 3.8], ['BEDROOM', 'bed', 3.2], ['BATH', 'wet', 2], ['WC', 'wet', 1.4]),
    tplReRow(1.2, ['HALL', 'hall', 1]),
    tplReRow(4.2, ['LIVING', 'living', 6], ['KITCHEN', 'kitchen', 4.4]),
    tplReOut(1.5, ['BALCONY', 'out', 9], ['', null, 1.4]),
  ]), 'png']],
  townhouse: () => [
    ['ground-floor', tplRePlan('Orchard Row 7 - ground floor', 6.4, [
      tplReRow(4.4, ['KITCHEN', 'kitchen', 1]), tplReRow(1.6, ['HALL', 'hall', 4], ['WC', 'wet', 2.4]),
      tplReRow(4.6, ['LIVING', 'living', 1]), tplReOut(3.6, ['GARDEN', 'out', 1]),
    ]), 'png'],
    ['first-floor', tplRePlan('Orchard Row 7 - first floor', 6.4, [
      tplReRow(4.4, ['BEDROOM', 'bed', 3.4], ['BEDROOM', 'bed', 3]), tplReRow(1.6, ['HALL', 'hall', 4], ['BATH', 'wet', 2.4]),
      tplReRow(4.6, ['BEDROOM', 'bed', 3.6], ['BEDROOM', 'bed', 2.8]),
    ]), 'png'],
  ],
  hlFlat: () => [['plan', tplRePlan('Harbour Lights A-0801', 8.6, [
    tplReRow(3.5, ['BEDROOM', 'bed', 4.6], ['HALL', 'hall', 1.6], ['BATH', 'wet', 2.4]),
    tplReRow(3.6, ['LIVING', 'living', 5], ['KITCHEN', 'kitchen', 3.6]),
    tplReOut(1.4, ['LOGGIA', 'out', 5], ['', null, 3.6]),
  ]), 'svg']],
  loft: () => [['plan', tplRePlan('Ropewalk 4 - loft', 13, [
    tplReRow(5.6, ['LIVING + KITCHEN', 'living', 1]),
    tplReRow(2.4, ['GALLERY', 'bed', 4], ['HALL', 'hall', 3], ['BATH', 'wet', 2.6], ['STORE', 'wet', 1.4]),
  ]), 'png']],
  studio: () => [['plan', tplRePlan('Ferry Steps 18 - studio', 6.2, [
    tplReRow(1.9, ['BATH', 'wet', 2.4], ['HALL', 'hall', 3.8]), tplReRow(3.6, ['STUDIO', 'living', 1]),
  ]), 'svg']],
  villa: () => [
    ['ground-floor', tplRePlan('Cliff Road 21 - ground floor', 14, [
      tplReRow(4, ['GUEST', 'bed', 4.2], ['OFFICE', 'work', 3.8], ['WC', 'wet', 1.6], ['UTILITY', 'wet', 2.4]),
      tplReRow(1.6, ['HALL', 'hall', 1]),
      tplReRow(6, ['LIVING', 'living', 9], ['KITCHEN', 'kitchen', 5]),
      tplReOut(3, ['POOL TERRACE', 'out', 1]),
    ]), 'png'],
    ['upper-floor', tplRePlan('Cliff Road 21 - upper floor', 11, [
      tplReRow(4.6, ['MASTER BEDROOM', 'bed', 5.2], ['DRESSING', 'wet', 2.2], ['BATH', 'wet', 3.6]),
      tplReRow(1.4, ['HALL', 'hall', 1]),
      tplReRow(3.6, ['BEDROOM', 'bed', 4], ['BATH', 'wet', 2.6], ['BEDROOM', 'bed', 4.4]),
    ]), 'png'],
  ],
  duneHouse: () => [['plan', tplRePlan('Corran Dunes - house 5', 12.6, [
    tplReRow(3.6, ['BEDROOM', 'bed', 4.4], ['BEDROOM', 'bed', 4], ['BATH', 'wet', 3.2]),
    tplReRow(1.4, ['HALL', 'hall', 1]),
    tplReRow(5.4, ['LIVING', 'living', 7.6], ['KITCHEN', 'kitchen', 5]),
    tplReOut(3.2, ['DECK', 'out', 9], ['', null, 3.6]),
  ]), 'svg']],
  lindenFlat: () => [['plan', tplRePlan('Chestnut Avenue 31 - 2nd floor', 9.4, [
    tplReRow(2.7, ['KITCHEN', 'kitchen', 3.4], ['BATH', 'wet', 2.2], ['BEDROOM', 'bed', 3.8]),
    tplReRow(1.2, ['HALL', 'hall', 1]),
    tplReRow(4, ['LIVING', 'living', 5.2], ['BEDROOM', 'bed', 4.2]),
    tplReOut(1.3, ['BALCONY', 'out', 4.4], ['', null, 5]),
  ]), 'png']],
  riverside: () => [['plan', tplRePlan('Mill Quay 5 - 6th floor', 11, [
    tplReRow(2.8, ['BEDROOM', 'bed', 4], ['BEDROOM', 'bed', 3.6], ['BATH', 'wet', 2.4]),
    tplReRow(1.2, ['HALL', 'hall', 1]),
    tplReRow(4.4, ['LIVING', 'living', 6.4], ['KITCHEN', 'kitchen', 4.6]),
    tplReOut(2.2, ['TERRACE', 'out', 6.4], ['', null, 4.6]),
  ]), 'svg']],
  lindenTown: () => [
    ['ground-floor', tplRePlan('Linden Gardens 9 - ground floor', 6, [
      tplReRow(4.4, ['KITCHEN', 'kitchen', 1]), tplReRow(1.6, ['HALL', 'hall', 3.6], ['WC', 'wet', 2.4]),
      tplReRow(4.6, ['LIVING', 'living', 1]), tplReOut(3, ['GARDEN', 'out', 1]),
    ]), 'svg'],
    ['first-floor', tplRePlan('Linden Gardens 9 - first floor', 6, [
      tplReRow(4.4, ['BEDROOM', 'bed', 3.2], ['BEDROOM', 'bed', 2.8]), tplReRow(1.6, ['HALL', 'hall', 3.6], ['BATH', 'wet', 2.4]),
      tplReRow(4.6, ['BEDROOM', 'bed', 1]),
    ]), 'svg'],
  ],
  family: () => [
    ['ground-floor', tplRePlan('Signal Lane 9 - ground floor', 10.4, [
      tplReRow(3.8, ['STUDY', 'work', 4], ['WORKSHOP', 'work', 4.6], ['WC', 'wet', 1.8]),
      tplReRow(1.4, ['HALL', 'hall', 1]),
      tplReRow(4.6, ['LIVING', 'living', 5.8], ['KITCHEN', 'kitchen', 4.6]),
      tplReOut(3, ['TERRACE', 'out', 5.8], ['', null, 4.6]),
    ]), 'png'],
    ['upper-floor', tplRePlan('Signal Lane 9 - upper floor', 9.6, [
      tplReRow(3, ['BEDROOM', 'bed', 3.6], ['BEDROOM', 'bed', 3.2], ['BATH', 'wet', 2.8]),
      tplReRow(1.1, ['HALL', 'hall', 1]),
      tplReRow(3, ['BEDROOM', 'bed', 1], ['BEDROOM', 'bed', 1]),
    ]), 'png'],
  ],
  corner: () => [['plan', tplRePlan('Beacon Street 2 - 4th floor', 8, [
    tplReRow(3.3, ['BEDROOM', 'bed', 4.4], ['HALL', 'hall', 1.4], ['BATH', 'wet', 2.2]),
    tplReRow(3.6, ['LIVING', 'living', 4.6], ['KITCHEN', 'kitchen', 3.4]),
    tplReOut(1.2, ['BALCONY', 'out', 3.6], ['', null, 4.4]),
  ]), 'svg']],
};

/** District pins of the neighbourhood map: [x, y, number, colour] (1200×900 map). */
const TPL_RE_DISTRICT_PINS = [[470, 610, 1, '#1d6a6e'], [800, 700, 2, '#c9724f'], [300, 300, 3, '#4f8547'], [640, 440, 4, '#3a8fa0'], [860, 210, 5, '#5e6b74'], [1090, 800, 6, '#b5873a']];

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

/** Monthly annuity payment of a loan (rate in % a year). */
function tplRePayment(loan, rate, years) {
  const r = rate / 1200, n = years * 12;
  return Math.round((loan * r) / (1 - (1 + r) ** -n));
}

function tplBuildRealty(V) {
  const K = tplKit(V, ['en', 'ru', 'de']);
  const { B, L } = K;
  const t = (en, ru, de) => ({ en, ru, de });
  const p = (en, ru, de) => t('<p>' + en + '</p>', '<p>' + ru + '</p>', '<p>' + de + '</p>');
  const li = (a) => '<ul>' + a.map((x) => '<li>' + x + '</li>').join('') + '</ul>';
  const ul = (en, ru, de) => t(li(en), li(ru), li(de));
  const col = (w, blocks) => ({ id: K.id(), w, blocks });
  const field = (key, type, label, ph, o = {}) => K.item({ key, type, label: L(label), ph: L(ph || ''), options: L(o.options || ''), required: !!o.required, half: !!o.half });
  const th = (v, o = {}) => K.cell(v, { th: true, ...o });
  const lines = (o) => Object.fromEntries(Object.keys(o[0]).map((l) => [l, o.map((x) => x[l]).join('\n')]));
  // Money in running text and tables, per language (the blocks' own prices use the shop currency).
  const grp = (n, sep) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  const money = (n) => t('€' + grp(n, ','), grp(n, ' ') + ' €', grp(n, '.') + ' €');
  const img = (name, svg, title) => K.svg(name, svg, { title });
  const pdf = (name, title, body, band, ttl, desc) => K.addAtt({
    name, mime: 'application/pdf', data: K.files.makePDF(title, body, { accent: '#1d6a6e', band }), title: ttl, desc,
  });
  const scene = (name, W, H, spec, o, title) => img(name, tplReScene(W, H, spec, o), title);

  // ----- vocabulary of the listing attributes (labels and values are data of the generic collection) -----
  const AL = {
    rooms: t('Rooms', 'Комнаты', 'Zimmer'), area: t('Area', 'Площадь', 'Wohnfläche'), floor: t('Floor', 'Этаж', 'Etage'),
    type: t('Type', 'Тип', 'Objektart'), district: t('District', 'Район', 'Viertel'), year: t('Year built', 'Год постройки', 'Baujahr'),
    status: t('Status', 'Статус', 'Status'), energy: t('Energy class', 'Класс энергоэффективности', 'Energieklasse'),
    parking: t('Parking', 'Парковка', 'Parken'), ref: t('Ref.', 'Код объекта', 'Objekt-Nr.'),
  };
  const TY = {
    apt: t('Apartment', 'Квартира', 'Wohnung'), pent: t('Penthouse', 'Пентхаус', 'Penthouse'), town: t('Townhouse', 'Таунхаус', 'Reihenhaus'),
    loft: t('Loft', 'Лофт', 'Loft'), studio: t('Studio', 'Студия', 'Studio'), villa: t('Villa', 'Вилла', 'Villa'), house: t('House', 'Дом', 'Haus'),
  };
  const DI = {
    harbour: t('Old Harbour', 'Старая гавань', 'Alter Hafen'), seafront: t('Seafront', 'Набережная', 'Strandpromenade'),
    linden: t('Lindenhill', 'Липовый холм', 'Lindenhügel'), river: t('Riverside', 'Речной квартал', 'Flussviertel'),
    north: t('Northpoint', 'Нортпойнт', 'Northpoint'), corran: t('Corran Bay', 'Корран-Бей', 'Corran Bay'),
  };
  const ST = { sale: t('For sale', 'В продаже', 'Zu verkaufen'), newb: t('New build', 'Новостройка', 'Neubau'), res: t('Reserved', 'Забронирован', 'Reserviert'), sold: t('Sold', 'Продан', 'Verkauft') };
  const BADGE = {
    news: t('New listing', 'Новинка', 'Neu im Angebot'), excl: t('Exclusive', 'Эксклюзив', 'Exklusiv'), cut: t('Price reduced', 'Цена снижена', 'Preis gesenkt'),
    newb: ST.newb, res: ST.res, sold: ST.sold,
  };
  const PARK = {
    street: t('Street (resident permit)', 'Улица (разрешение для жителей)', 'Straße (Anwohnerparken)'), under: t('Underground space', 'Место в подземном паркинге', 'Tiefgaragenplatz'),
    under2: t('Two underground spaces', 'Два места в подземном паркинге', 'Zwei Tiefgaragenplätze'), opt: t('Underground space (optional)', 'Место в паркинге (по желанию)', 'Tiefgaragenplatz (optional)'),
    garage: t('Garage', 'Гараж', 'Garage'), garage2: t('Garage for two cars', 'Гараж на две машины', 'Doppelgarage'), plot: t('Two spaces on the plot', 'Два места на участке', 'Zwei Stellplätze auf dem Grundstück'),
    yard: t('Courtyard space', 'Место во дворе', 'Stellplatz im Hof'), front: t('Space in front of the house', 'Место перед домом', 'Stellplatz vor dem Haus'),
    drive: t('Garage and driveway', 'Гараж и подъездная дорожка', 'Garage und Einfahrt'), none: t('None', 'Нет', 'Keiner'),
  };
  const floorOf = (f, n) => t(f + ' of ' + n, f + ' из ' + n, f + ' von ' + n);
  const levels = (n) => t(n + ' floors', n + ' этажа', n + ' Etagen');
  const reno = (y, r) => t(y + ', renovated ' + r, y + ', ремонт ' + r, y + ', saniert ' + r);
  const due = (y, q, qr) => t(y + ' (Q' + q + ')', y + ' (' + qr + ' кв.)', y + ' (Q' + q + ')');
  const m2 = (n) => t(n + ' m²', n + ' м²', n + ' m²');
  const AGENTS = ['Mara Lindqvist', 'Tomas Brenner', 'Irina Vasko', 'Daniel Okoye'];

  // ----- listings: content of the collection, in catalogue order (the first one is the featured card) -----
  const LISTINGS = [
    { key: 'penthouse', ref: 'AV-1047', type: 'pent', district: 'seafront', rooms: 4, area: 148, floor: floorOf(12, 12), year: '2021', status: 'sale',
      energy: 'A', parking: 'under2', price: 1180000, date: '2026-10-06', badge: 'excl', agent: 0,
      title: t('Penthouse with a 90 m² roof terrace', 'Пентхаус с террасой 90 м² на крыше', 'Penthouse mit 90 m² Dachterrasse'),
      sub: t('Seafront · 3 Lantern Walk', 'Набережная · Фонарный проезд, 3', 'Strandpromenade · Lantern Walk 3'),
      html: t('Top floor of the Lantern tower with views from the lighthouse to Corran Bay. Open-plan living with a fireplace, three bedrooms with en-suite bathrooms and a private lift to the roof terrace with a summer kitchen.',
        'Последний этаж башни «Фонарь» с видом от маяка до Корран-Бей. Гостиная свободной планировки с камином, три спальни с ванными комнатами и личный лифт на террасу с летней кухней.',
        'Oberstes Geschoss des Lantern-Turms mit Blick vom Leuchtturm bis Corran Bay. Offener Wohnbereich mit Kamin, drei Schlafzimmer mit eigenem Bad und ein privater Aufzug zur Dachterrasse mit Sommerküche.'),
      tags: t('sea view, roof terrace, private lift, concierge', 'вид на море, терраса, личный лифт, консьерж', 'Meerblick, Dachterrasse, privater Aufzug, Concierge') },
    { key: 'harbourView', ref: 'AV-1041', type: 'apt', district: 'harbour', rooms: 3, area: 86, floor: floorOf(5, 7), year: reno(1912, 2023), status: 'sale',
      energy: 'C', parking: 'street', price: 395000, date: '2026-09-28', badge: 'news', agent: 0,
      title: t('Harbour-view flat with a long balcony', 'Квартира с длинным балконом и видом на гавань', 'Wohnung mit langem Balkon und Hafenblick'),
      sub: t('Old Harbour · 12 Wharf Lane', 'Старая гавань · Пристанский пер., 12', 'Alter Hafen · Wharf Lane 12'),
      html: t('A former captain’s house on the quay, renovated in 2023: oak floors, high ceilings, a new kitchen and a 9-metre balcony over the marina. Two bedrooms face the quiet courtyard.',
        'Бывший дом капитана на набережной, ремонт 2023 года: дубовый паркет, высокие потолки, новая кухня и 9-метровый балкон над мариной. Две спальни выходят в тихий двор.',
        'Ehemaliges Kapitänshaus am Kai, 2023 saniert: Eichenparkett, hohe Decken, neue Küche und ein 9 Meter langer Balkon über der Marina. Zwei Schlafzimmer liegen zum ruhigen Hof.'),
      tags: t('sea view, balcony, lift, renovated', 'вид на море, балкон, лифт, после ремонта', 'Meerblick, Balkon, Aufzug, saniert') },
    { key: 'townhouse', ref: 'AV-1032', type: 'town', district: 'linden', rooms: 5, area: 156, floor: levels(3), year: '2018', status: 'sale',
      energy: 'B', parking: 'garage', price: 640000, old: 675000, date: '2026-08-30', badge: 'cut', agent: 2,
      title: t('Family townhouse by Linden Park', 'Семейный таунхаус у Липового парка', 'Familien-Reihenhaus am Lindenpark'),
      sub: t('Lindenhill · 7 Orchard Row', 'Липовый холм · Садовый ряд, 7', 'Lindenhügel · Orchard Row 7'),
      html: t('Three floors of light family space with a south-facing garden, a kitchen-diner opening onto the terrace and four bedrooms. The park, two schools and the tram are five minutes’ walk away.',
        'Три этажа светлого семейного пространства: сад на южную сторону, кухня-столовая с выходом на террасу и четыре спальни. Парк, две школы и трамвай — в пяти минутах пешком.',
        'Drei helle Etagen für die Familie mit Südgarten, Wohnküche mit Zugang zur Terrasse und vier Schlafzimmern. Park, zwei Schulen und die Straßenbahn sind fünf Gehminuten entfernt.'),
      tags: t('garden, garage, schools nearby, quiet street', 'сад, гараж, школы рядом, тихая улица', 'Garten, Garage, Schulen in der Nähe, ruhige Straße') },
    { key: 'hlFlat', ref: 'AV-1050', type: 'apt', district: 'harbour', rooms: 2, area: 61, floor: floorOf(8, 11), year: due(2027, 2, 'II'), status: 'newb',
      energy: 'A+', parking: 'opt', price: 298000, date: '2026-10-09', badge: 'newb', agent: 1, cover: () => hlDay,
      title: t('Two-room flat in Harbour Lights', 'Двухкомнатная квартира в «Огнях гавани»', 'Zweizimmerwohnung im Harbour Lights'),
      sub: t('Old Harbour · Harbour Lights, tower A', 'Старая гавань · «Огни гавани», корпус А', 'Alter Hafen · Harbour Lights, Turm A'),
      html: t('Buy off-plan in the waterfront development: a corner living room with a loggia facing the marina, a separate bedroom and a fitted kitchen. 0 % developer instalments until completion in spring 2027.',
        'Покупка на этапе строительства в комплексе на набережной: угловая гостиная с лоджией на марину, отдельная спальня и встроенная кухня. Беспроцентная рассрочка от застройщика до сдачи весной 2027 года.',
        'Kauf vom Plan im Neubau am Wasser: Eck-Wohnzimmer mit Loggia zur Marina, separates Schlafzimmer und Einbauküche. 0 % Ratenzahlung beim Bauträger bis zur Fertigstellung im Frühjahr 2027.'),
      tags: t('new build, sea view, loggia, 0 % instalments', 'новостройка, вид на море, лоджия, рассрочка 0 %', 'Neubau, Meerblick, Loggia, 0 % Ratenzahlung') },
    { key: 'loft', ref: 'AV-1038', type: 'loft', district: 'harbour', rooms: 2, area: 104, floor: floorOf(3, 4),
      year: t('1896, converted 2019', '1896, перестроен в 2019', '1896, umgebaut 2019'), status: 'res',
      energy: 'B', parking: 'street', price: 455000, date: '2026-09-12', badge: 'res', agent: 0,
      title: t('Loft in a former sail warehouse', 'Лофт в бывшем парусном складе', 'Loft in einem ehemaligen Segelspeicher'),
      sub: t('Old Harbour · 4 Ropewalk', 'Старая гавань · Канатная ул., 4', 'Alter Hafen · Ropewalk 4'),
      html: t('Brick walls, cast-iron columns and 3.6-metre ceilings in a warehouse converted in 2019. One open space for living and cooking, a bedroom gallery and windows on two sides over the quay.',
        'Кирпичные стены, чугунные колонны и потолки 3,6 м в складе, перестроенном в 2019 году. Единое пространство для гостиной и кухни, спальня-антресоль и окна на две стороны с видом на набережную.',
        'Backsteinwände, gusseiserne Säulen und 3,6 Meter Deckenhöhe in einem 2019 umgebauten Speicher. Ein offener Raum zum Wohnen und Kochen, eine Schlafgalerie und Fenster nach zwei Seiten zum Kai.'),
      tags: t('high ceilings, brick, quay, open plan', 'высокие потолки, кирпич, набережная, свободная планировка', 'hohe Decken, Backstein, Kai, offener Grundriss') },
    { key: 'studio', ref: 'AV-1044', type: 'studio', district: 'river', rooms: 1, area: 34, floor: floorOf(2, 6), year: '2016', status: 'sale',
      energy: 'B', parking: 'none', price: 159000, date: '2026-10-02', agent: 2,
      title: t('Bright studio by the river', 'Светлая студия у реки', 'Helles Studio am Fluss'),
      sub: t('Riverside · 18 Ferry Steps', 'Речной квартал · Паромная лестница, 18', 'Flussviertel · Ferry Steps 18'),
      html: t('A compact, well-planned studio with a French balcony over the river path — let furnished, it brings about 5 % gross yield. Laundry room and bike storage in the building.',
        'Компактная студия с продуманной планировкой и французским балконом над набережной реки; при сдаче с мебелью даёт около 5 % годовых. В доме — прачечная и велосипедная.',
        'Kompaktes, gut geschnittenes Studio mit französischem Balkon über dem Uferweg – möbliert vermietet rund 5 % Bruttorendite. Waschraum und Fahrradkeller im Haus.'),
      tags: t('river view, investment, furnished, bike storage', 'вид на реку, для инвестиций, с мебелью, велосипедная', 'Flussblick, Kapitalanlage, möbliert, Fahrradkeller') },
    { key: 'villa', ref: 'AV-1029', type: 'villa', district: 'corran', rooms: 6, area: 265, floor: levels(2), year: '2019', status: 'sale',
      energy: 'A', parking: 'garage2', price: 1650000, date: '2026-09-20', badge: 'excl', agent: 3,
      title: t('Sea-facing villa with a pool', 'Вилла с бассейном и видом на море', 'Villa mit Pool und Meerblick'),
      sub: t('Corran Bay · 21 Cliff Road', 'Корран-Бей · Скальная дорога, 21', 'Corran Bay · Cliff Road 21'),
      html: t('Architect-designed villa on a 1,100 m² plot above the beach: a glass living hall opening onto the pool terrace, four bedroom suites, a study and a roof terrace for sunsets. 25 minutes from the city centre.',
        'Архитектурная вилла на участке 1100 м² над пляжем: остеклённая гостиная с выходом к бассейну, четыре спальни с ванными, кабинет и терраса на крыше для закатов. 25 минут до центра города.',
        'Architektenvilla auf 1.100 m² Grundstück über dem Strand: verglaste Wohnhalle zur Poolterrasse, vier Schlafsuiten, ein Arbeitszimmer und eine Dachterrasse für Sonnenuntergänge. 25 Minuten bis ins Zentrum.'),
      tags: t('pool, sea view, garden, roof terrace', 'бассейн, вид на море, сад, терраса на крыше', 'Pool, Meerblick, Garten, Dachterrasse') },
    { key: 'duneHouse', ref: 'AV-1052', type: 'house', district: 'corran', rooms: 4, area: 132, floor: levels(2), year: due(2027, 3, 'III'), status: 'newb',
      energy: 'A+', parking: 'plot', price: 549000, date: '2026-10-11', badge: 'newb', agent: 3,
      title: t('Garden house in Corran Dunes', 'Дом с садом в «Корран-Дюнах»', 'Gartenhaus in Corran Dunes'),
      sub: t('Corran Bay · Corran Dunes, house 5', 'Корран-Бей · «Корран-Дюны», дом 5', 'Corran Bay · Corran Dunes, Haus 5'),
      html: t('Timber-clad house 300 metres from the beach, with solar panels, a heat pump and a 420 m² garden on the dunes. Choose your finishes until the shell is complete.',
        'Дом с деревянным фасадом в 300 метрах от пляжа: солнечные панели, тепловой насос и сад 420 м² на дюнах. Отделку можно выбрать до завершения коробки.',
        'Holzverkleidetes Haus 300 Meter vom Strand mit Solaranlage, Wärmepumpe und 420 m² Garten in den Dünen. Ausstattung wählbar bis zur Fertigstellung des Rohbaus.'),
      tags: t('new build, garden, solar panels, near the beach', 'новостройка, сад, солнечные панели, рядом с пляжем', 'Neubau, Garten, Solaranlage, strandnah') },
    { key: 'lindenFlat', ref: 'AV-1035', type: 'apt', district: 'linden', rooms: 3, area: 74, floor: floorOf(2, 5), year: reno(1964, 2022), status: 'sale',
      energy: 'C', parking: 'yard', price: 286000, date: '2026-09-05', agent: 2,
      title: t('Classic three-room flat in Lindenhill', 'Классическая трёхкомнатная квартира на Липовом холме', 'Klassische Dreizimmerwohnung am Lindenhügel'),
      sub: t('Lindenhill · 31 Chestnut Avenue', 'Липовый холм · Каштановый пр., 31', 'Lindenhügel · Chestnut Avenue 31'),
      html: t('A calm, practical flat in a tree-lined street: two bedrooms, a living room with a balcony over the courtyard and a renovated bathroom. Kindergarten across the road.',
        'Спокойная, практичная квартира на зелёной улице: две спальни, гостиная с балконом во двор и обновлённая ванная. Детский сад через дорогу.',
        'Ruhige, praktische Wohnung in einer Allee: zwei Schlafzimmer, Wohnzimmer mit Balkon zum Hof und renoviertes Bad. Kindergarten gegenüber.'),
      tags: t('balcony, park, kindergarten, quiet street', 'балкон, парк, детский сад, тихая улица', 'Balkon, Park, Kindergarten, ruhige Straße') },
    { key: 'riverside', ref: 'AV-1026', type: 'apt', district: 'river', rooms: 3, area: 92, floor: floorOf(6, 8), year: '2020', status: 'sale',
      energy: 'A', parking: 'under', price: 418000, date: '2026-08-18', agent: 2,
      title: t('Riverside apartment with a terrace', 'Квартира с террасой у реки', 'Wohnung mit Terrasse am Fluss'),
      sub: t('Riverside · 5 Mill Quay', 'Речной квартал · Мельничная наб., 5', 'Flussviertel · Mill Quay 5'),
      html: t('Corner apartment with a 14 m² terrace over the river, underfloor heating and an underground parking space. The tram to the centre stops at the door.',
        'Угловая квартира с террасой 14 м² над рекой, тёплыми полами и местом в подземном паркинге. Трамвай до центра останавливается у дома.',
        'Eckwohnung mit 14 m² Terrasse über dem Fluss, Fußbodenheizung und Tiefgaragenplatz. Die Straßenbahn ins Zentrum hält vor der Tür.'),
      tags: t('terrace, river view, parking, lift', 'терраса, вид на реку, паркинг, лифт', 'Terrasse, Flussblick, Stellplatz, Aufzug') },
    { key: 'lindenTown', ref: 'AV-1049', type: 'town', district: 'linden', rooms: 4, area: 128, floor: levels(3), year: due(2026, 4, 'IV'), status: 'newb',
      energy: 'A+', parking: 'front', price: 512000, date: '2026-10-04', badge: 'newb', agent: 1,
      title: t('Townhouse in Linden Gardens', 'Таунхаус в «Липовых садах»', 'Reihenhaus in den Linden Gardens'),
      sub: t('Lindenhill · Linden Gardens, unit 9', 'Липовый холм · «Липовые сады», секция 9', 'Lindenhügel · Linden Gardens, Einheit 9'),
      html: t('End-of-terrace townhouse on a shared garden court: heat pump, solar roof and a private garden. Ready to move in at the end of 2026.',
        'Крайняя секция в ряду таунхаусов вокруг общего сада: тепловой насос, солнечная кровля и собственный сад. Заселение в конце 2026 года.',
        'Endreihenhaus am gemeinsamen Gartenhof: Wärmepumpe, Solardach und eigener Garten. Bezugsfertig Ende 2026.'),
      tags: t('new build, garden, heat pump, 0 % instalments', 'новостройка, сад, тепловой насос, рассрочка 0 %', 'Neubau, Garten, Wärmepumpe, 0 % Ratenzahlung') },
    { key: 'family', ref: 'AV-1043', type: 'house', district: 'north', rooms: 5, area: 168, floor: levels(2), year: reno(1998, 2024), status: 'sale',
      energy: 'B', parking: 'drive', price: 489000, date: '2026-09-15', badge: 'news', agent: 3,
      title: t('Family house with a workshop', 'Семейный дом с мастерской', 'Familienhaus mit Werkstatt'),
      sub: t('Northpoint · 9 Signal Lane', 'Нортпойнт · Сигнальный пер., 9', 'Northpoint · Signal Lane 9'),
      html: t('Detached house on a 640 m² plot with a garage, a workshop and an old apple tree. New roof and windows in 2024; four bedrooms upstairs, a study and a large kitchen downstairs.',
        'Отдельный дом на участке 640 м² с гаражом, мастерской и старой яблоней. Новая крыша и окна в 2024 году; наверху четыре спальни, внизу кабинет и большая кухня.',
        'Freistehendes Haus auf 640 m² Grundstück mit Garage, Werkstatt und altem Apfelbaum. Neues Dach und neue Fenster 2024; oben vier Schlafzimmer, unten Arbeitszimmer und große Küche.'),
      tags: t('garden, garage, workshop, quiet street', 'сад, гараж, мастерская, тихая улица', 'Garten, Garage, Werkstatt, ruhige Straße') },
    { key: 'corner', ref: 'AV-1018', type: 'apt', district: 'north', rooms: 2, area: 55, floor: floorOf(4, 9), year: '2012', status: 'sold',
      energy: 'B', parking: 'none', price: 212000, date: '2026-07-22', badge: 'sold', agent: 1,
      title: t('Corner flat by the Northpoint tram', 'Угловая квартира у трамвая в Нортпойнте', 'Eckwohnung an der Tram in Northpoint'),
      sub: t('Northpoint · 2 Beacon Street', 'Нортпойнт · ул. Бакенная, 2', 'Northpoint · Beacon Street 2'),
      html: t('Sold in 19 days at the asking price. Similar flats in Northpoint come up every month — leave your search with us and we will call you first.',
        'Продана за 19 дней по запрошенной цене. Похожие квартиры в Нортпойнте появляются каждый месяц — оставьте запрос, и мы позвоним вам первыми.',
        'In 19 Tagen zum Angebotspreis verkauft. Ähnliche Wohnungen in Northpoint kommen jeden Monat auf den Markt – hinterlassen Sie Ihren Suchauftrag, wir rufen Sie zuerst an.'),
      tags: t('tram, balcony, investment', 'трамвай, балкон, для инвестиций', 'Tram, Balkon, Kapitalanlage') },
  ];

  // ----- files of a listing: floor plans (SVG or PNG, drawn from plan data) and a PDF brochure -----
  const PLAN_LABEL = {
    plan: t('Floor plan', 'Планировка', 'Grundriss'), 'level-12': t('Floor plan · level 12', 'Планировка · 12-й этаж', 'Grundriss · 12. Etage'),
    'roof-terrace': t('Floor plan · roof terrace', 'Планировка · терраса на крыше', 'Grundriss · Dachterrasse'),
    'ground-floor': t('Floor plan · ground floor', 'Планировка · первый этаж', 'Grundriss · Erdgeschoss'),
    'first-floor': t('Floor plan · first floor', 'Планировка · второй этаж', 'Grundriss · Obergeschoss'),
    'upper-floor': t('Floor plan · upper floor', 'Планировка · второй этаж', 'Grundriss · Obergeschoss'),
  };
  const brochureLabel = t('Brochure', 'Буклет', 'Exposé');
  const filesOf = (x) => {
    const slug = x.ref.toLowerCase();
    const out = TPL_RE_PLANS[x.key]().map(([suf, plan, fmt]) => {
      const name = slug + '-floor-plan' + (suf === 'plan' ? '' : '-' + suf) + '.' + fmt;
      const att = fmt === 'png'
        ? K.addAtt({ name, mime: 'image/png', data: tplRePlanPNG(plan), title: PLAN_LABEL[suf], desc: x.title })
        : K.addAtt({ name, mime: 'image/svg+xml', data: b64encode(tplUtf8(tplRePlanSVG(plan))), title: PLAN_LABEL[suf], desc: x.title });
      return { att, label: L(PLAN_LABEL[suf]), kind: 'auto' };
    });
    const tags = x.tags.en.split(', ').map((s) => '- ' + s[0].toUpperCase() + s.slice(1));
    const att = pdf(slug + '-brochure.pdf', 'Avelin Estates - ' + x.title.en, [
      '> Ref. ' + x.ref + ' - ' + x.sub.en.replace(' · ', ', ') + ', Port Avelin',
      '',
      x.html.en,
      '# Key facts',
      '- Price: EUR ' + grp(x.price, ',') + (x.status === 'sold' ? ' (sold)' : x.status === 'res' ? ' (reserved)' : ''),
      '- ' + TY[x.type].en + ', ' + x.rooms + ' rooms, ' + x.area + ' m2',
      '- Floor: ' + x.floor.en + ' - year built: ' + (typeof x.year === 'string' ? x.year : x.year.en),
      '- Energy class: ' + x.energy + ' - parking: ' + PARK[x.parking].en,
      '# Highlights',
      ...tags,
      '# Viewings',
      '- Your agent: ' + AGENTS[x.agent] + ', +00 41 000 2040',
      '- Book online: avelin-estates.example/#viewing',
      '',
      '> Sample document generated by the landing template. All properties, people and figures are fictional.',
    ], 'BROCHURE ' + x.ref, x.title, brochureLabel);
    out.push({ att, label: L(brochureLabel), kind: 'file' }); // download only: the plans are the card's "View"
    return out;
  };
  const A = (k, v) => ({ label: L(AL[k]), value: L(v) });
  const listingItem = (x) => K.item({
    title: L(x.title), subtitle: L(x.sub), badge: L(x.badge ? BADGE[x.badge] : ''),
    cover: x.cover ? x.cover() : img(x.ref.toLowerCase() + '-' + x.key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()) + '.svg', tplReCover(x.key), x.title),
    html: L(p(x.html.en, x.html.ru, x.html.de)), tags: L(x.tags),
    attrs: [A('rooms', String(x.rooms)), A('area', m2(x.area)), A('floor', x.floor), A('type', TY[x.type]), A('district', DI[x.district]),
      A('year', x.year), A('status', ST[x.status]), A('energy', x.energy), A('parking', PARK[x.parking]), A('ref', x.ref)],
    files: filesOf(x), date: x.date, href: x.status === 'sold' ? '#lead' : '#viewing',
    price: x.price, old: x.old || null, unit: L(''), sku: '',
  });

  // ----- pictures -----
  const brand = img('avelin-estates-mark.svg', tplReBrandSVG(), t('Avelin Estates mark', 'Знак Avelin Estates', 'Zeichen Avelin Estates'));
  const city = scene('port-avelin-waterfront.svg', 1200, 900, tplReCitySpec(), { ...TPL_RE_STAGE, pad: 40, dy: 20 },
    t('The waterfront of Port Avelin', 'Набережная Порт-Авелина', 'Die Uferfront von Port Avelin'));
  const hlDay = scene('harbour-lights.svg', 1200, 900, TPL_RE_COVERS.harbourLights(), TPL_RE_STAGE,
    t('Harbour Lights on the Old Harbour quay', '«Огни гавани» на набережной Старой гавани', 'Harbour Lights am Kai des Alten Hafens'));
  const hlDusk = scene('harbour-lights-at-dusk.svg', 1200, 900, TPL_RE_COVERS.harbourLights({ dusk: true }), TPL_RE_DUSK,
    t('Harbour Lights at dusk', '«Огни гавани» в сумерках', 'Harbour Lights in der Abenddämmerung'));
  const linden = scene('linden-gardens.svg', 1200, 900, tplReLindenSpec(), TPL_RE_STAGE,
    t('Linden Gardens around the garden court', '«Липовые сады» вокруг общего сада', 'Linden Gardens rund um den Gartenhof'));
  const corran = scene('corran-dunes.svg', 1200, 900, tplReCorranSpec(), TPL_RE_STAGE,
    t('Corran Dunes above the beach', '«Корран-Дюны» над пляжем', 'Corran Dunes über dem Strand'));
  const room = (name, spec, pad, title) => scene(name, 900, 900, spec, { ...TPL_RE_STAGE, pad }, title);
  const living = room('show-flat-living-room.svg', tplReLiving(), 60, t('Show flat: living room', 'Шоурум: гостиная', 'Musterwohnung: Wohnzimmer'));
  const kitchen = room('show-flat-kitchen.svg', tplReKitchen(), 60, t('Show flat: kitchen', 'Шоурум: кухня', 'Musterwohnung: Küche'));
  const bedroom = room('show-flat-bedroom.svg', tplReBedroom(), 60, t('Show flat: bedroom', 'Шоурум: спальня', 'Musterwohnung: Schlafzimmer'));
  const terrace = room('penthouse-roof-terrace.svg', tplReTerrace(), 50, t('Penthouse roof terrace', 'Терраса пентхауса', 'Dachterrasse des Penthouse'));
  const areaMap = img('port-avelin-neighbourhoods.svg', tplReMapSVG('avelin', TPL_RE_DISTRICT_PINS, { title: 'PORT AVELIN' }),
    t('Map of the six neighbourhoods', 'Карта шести районов', 'Karte der sechs Viertel'));
  const officeMap = img('avelin-estates-office-map.svg', tplReMapSVG('avelin-office', [[560, 600, null, '#1d6a6e']], { title: 'AVELIN ESTATES · 2 QUAY ROAD' }),
    t('Map: 2 Quay Road, Old Harbour', 'Карта: Портовая дорога, 2, Старая гавань', 'Karte: Quay Road 2, Alter Hafen'));
  const portrait = (seed, o) => img('agent-' + seed + '.svg', tplAgroPortrait({ seed, bg: ['#e4efed', '#c6dcd8'], shirt: '#1d6a6e', shirt2: '#164f53', collar: '#f6f3ec', ...o }), '');
  const people = [
    portrait('lindqvist', { skin: '#f3d3bc', skin2: '#e3b89b', hair: '#d9b27a', style: 'long' }),
    portrait('brenner', { skin: '#eac5a8', skin2: '#d9aa88', hair: '#4a3a30', style: 'short', glasses: true, shirt: '#33505a', shirt2: '#26404a' }),
    portrait('vasko', { skin: '#f0cdb4', skin2: '#e0b394', hair: '#3d2a22', style: 'bun', shirt: '#c9724f', shirt2: '#a85d40' }),
    portrait('okoye', { skin: '#8d5a3c', skin2: '#7a4a30', hair: '#1f1712', style: 'buzz', beard: true, shirt: '#2d5f63', shirt2: '#214a4e' }),
  ];
  // Mid-tone marks: readable on the light page and on the dark scheme alike.
  const banks = [['wave', 'TIDEWELL BANK', '#4f8c90'], ['star', 'KESTREL CREDIT', '#7a8794'], ['ring', 'PORT SAVINGS', '#5a8ca3'], ['arch', 'LANTERN MUTUAL', '#8c836d']]
    .map(([k, n, c]) => ({ id: img('bank-' + n.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.svg', tplArtWordmark(k, n, c, { font: 'condensed', weight: 700 }), n), name: n }));

  // ----- documents (sample PDFs, ASCII text) -----
  const priceList = pdf('harbour-lights-price-list-2026.pdf', 'Harbour Lights - price list, October 2026', [
    '> Avelin Estates for Harbour Lights Development Ltd - prices in EUR incl. VAT',
    '# Tower A - 11 floors, completion Q2 2027',
    '- A-0302  1 room   38 m2  floor 3   189,000  available',
    '- A-0504  2 rooms  58 m2  floor 5   276,000  reserved',
    '- A-0801  2 rooms  61 m2  floor 8   298,000  available',
    '- A-0903  3 rooms  84 m2  floor 9   412,000  available',
    '- A-1101  4 rooms 148 m2  floor 11  865,000  available',
    '# Tower B - 8 floors, completion Q4 2027',
    '- B-0202  1 room   41 m2  floor 2   198,000  available',
    '- B-0605  3 rooms  79 m2  floor 6   379,000  available',
    '- B-0801  4 rooms 112 m2  floor 8   598,000  available',
    '# Payment',
    '- Reservation deposit 2 %, 30 % at contract, the rest in 36 monthly instalments at 0 %',
    '- Underground parking space: 24,000; storage room: 6,500',
    '# Included',
    '- Fitted kitchen, oak floors, underfloor heating, heat pump, 10-year structural warranty',
    '',
    '> Sample document generated by the landing template. All projects, units and prices are fictional.',
  ], 'PRICE LIST', t('Harbour Lights — price list', '«Огни гавани» — прайс-лист', 'Harbour Lights – Preisliste'),
  t('All units, floors and prices, October 2026', 'Все квартиры, этажи и цены, октябрь 2026', 'Alle Einheiten, Etagen und Preise, Oktober 2026'));
  const guide = pdf('avelin-buyers-guide-2026.pdf', 'Buying a home in Port Avelin - guide 2026', [
    '> Avelin Estates - practical guide for buyers, 2026 edition',
    '',
    'Six steps from the first search to the keys, with the costs nobody mentions in the listing.',
    '# 1. Budget',
    '- Price plus about 3 % for the notary, the land registry and the transfer tax',
    '- A mortgage usually needs a 20 % deposit; new builds can be paid in instalments',
    '# 2. Mortgage',
    '- Ask for a decision in principle before viewings: sellers take your offer seriously',
    '- Compare the fixed period, not only the rate',
    '# 3. Viewings',
    '- Visit twice: on a weekday evening and on a Saturday morning',
    '- Check the service charge, the reserve fund and the minutes of the last owners meeting',
    '# 4. Offer and reservation',
    '- A 2 % deposit takes the home off the market for 30 days',
    '# 5. Checks',
    '- Title, permits, energy certificate, debts on the property',
    '# 6. Notary and keys',
    '- The notary reads the contract aloud; the money moves through an escrow account',
    '',
    'Questions? hello@avelin-estates.example - +00 41 000 2040',
    '',
    '> Sample document generated by the landing template. Not legal or financial advice. All names are fictional.',
  ], 'GUIDE', t('Buyer’s guide 2026', 'Гид покупателя 2026', 'Käuferleitfaden 2026'),
  t('Six steps, real costs and a checklist for viewings', 'Шесть шагов, реальные расходы и чек-лист для показов', 'Sechs Schritte, echte Kosten und eine Checkliste für Besichtigungen'));

  // ----- requests (browser-local endpoints; e-mail is the human fallback) -----
  const reqViewing = K.id();
  const reqLead = K.id();
  const R = (id, name, url) => ({ id, name, method: 'POST', url, headers: [], credentials: 'omit', timeout: 8000, retries: 0, itemsPath: 'items' });

  const d = K.doc({
    name: 'Avelin Estates — city & coast property agency', preset: 'shore', defaultLang: 'en',
    author: 'Avelin Estates', keywords: 'real estate, property, apartments, houses, new developments, Port Avelin, Corran Bay, mortgage, valuation, viewings',
    title: t('Avelin Estates — homes in Port Avelin and on the coast', 'Avelin Estates — недвижимость в Порт-Авелине и на побережье', 'Avelin Estates — Immobilien in Port Avelin und an der Küste'),
    description: t(
      'Apartments, houses and new developments in Port Avelin and Corran Bay: searchable listings with floor plans, viewings, mortgage options, free valuation and local agents.',
      'Квартиры, дома и новостройки в Порт-Авелине и Корран-Бей: каталог с поиском и планировками, показы, ипотека, бесплатная оценка и местные агенты.',
      'Wohnungen, Häuser und Neubauprojekte in Port Avelin und Corran Bay: durchsuchbare Angebote mit Grundrissen, Besichtigungen, Finanzierung, kostenlose Bewertung und Makler vor Ort.'),
    meta: { favicon: brand },
    theme: { scheme: 'auto' },
    // No back-to-top link: the floating chat bubble takes that corner.
    output: { autodetect: true, switcher: 'buttons', langLabels: 'code', themeToggle: true, toolbarPos: 'nav', motion: 'rise', backToTop: false },
    shop: { currency: 'EUR', mode: 'cart', checkout: { method: 'none' } },
    requests: [R(reqViewing, 'Viewing requests (browser storage)', 'local:viewings'), R(reqLead, 'Valuation and advice requests (browser storage)', 'local:leads')],
  });

  const open = LISTINGS.filter((x) => x.status !== 'sold');
  const homeOptions = lines([...open.map((x) => x.title), t('Not sure yet — suggest homes to me', 'Пока не выбрал — подберите мне варианты', 'Noch unentschieden – schlagen Sie mir etwas vor')]);
  const typeOptions = lines(Object.values(TY));
  const districtOptions = lines(Object.values(DI));

  // ----- header -----
  d.regions.header = [
    B('nav', {
      brand: L(t('Avelin Estates', 'Avelin Estates', 'Avelin Estates')), logo: brand, logoH: 36, sticky: true, variant: 'bar',
      items: [
        K.item({ label: L(t('Homes', 'Объекты', 'Angebote')), href: '#homes' }),
        K.item({ label: L(t('New builds', 'Новостройки', 'Neubau')), href: '#new' }),
        K.item({ label: L(t('Areas', 'Районы', 'Viertel')), href: '#areas' }),
        K.item({ label: L(t('Mortgage', 'Ипотека', 'Finanzierung')), href: '#mortgage' }),
        K.item({ label: L(t('Agents', 'Агенты', 'Makler')), href: '#agents' }),
        K.item({ label: L(t('Contact', 'Контакты', 'Kontakt')), href: '#contact' }),
      ],
      ctaLabel: L(t('Book a viewing', 'Записаться на показ', 'Besichtigung buchen')), ctaHref: '#viewing',
    }),
  ];

  // ----- main -----
  const pay = (price) => tplRePayment(price * 0.8, 3.6, 25);
  d.regions.main = [
    B('hero', {
      layout: 'split', media: city, height: 'auto',
      badge: L(t('New listings every week', 'Новые объекты каждую неделю', 'Jede Woche neue Angebote')),
      eyebrow: L(t('City & coast property · since 2004', 'Город и побережье · с 2004 года', 'Stadt & Küste · seit 2004')),
      title: L(t('Find a home between the harbour and the sea', 'Найдите дом между гаванью и морем', 'Ihr Zuhause zwischen Hafen und Meer')),
      text: L(p('Apartments, townhouses and villas in Port Avelin and Corran Bay — with honest floor plans, real prices and agents who live in the neighbourhoods they sell.',
        'Квартиры, таунхаусы и виллы в Порт-Авелине и Корран-Бей — с честными планировками, реальными ценами и агентами, которые сами живут в этих районах.',
        'Wohnungen, Reihenhäuser und Villen in Port Avelin und Corran Bay – mit ehrlichen Grundrissen, echten Preisen und Maklern, die in den Vierteln leben, die sie verkaufen.')),
      items: [
        // A ghost button first: the theme draws the pair as a search bar that leads to the catalogue's real search.
        K.btn(t('District, price, rooms…', 'Район, цена, комнаты…', 'Viertel, Preis, Zimmer…'), '#homes', 'ghost', K.icon('search')),
        K.btn(t('Find a home', 'Найти жильё', 'Zuhause finden'), '#homes', 'primary'),
      ],
    }),
    K.sec({ pad: 's' }, [
      B('stats', {
        variant: 'band', columns: 4, count: true, items: [
          K.item({ value: '22', suffix: L(t('years', 'года', 'Jahre')), label: L(t('in Port Avelin', 'в Порт-Авелине', 'in Port Avelin')) }),
          K.item({ value: '1200+', suffix: L(''), label: L(t('homes sold', 'проданных объектов', 'verkaufte Immobilien')) }),
          K.item({ value: '38', suffix: L(t('days', 'дней', 'Tage')), label: L(t('average time to sale', 'средний срок продажи', 'durchschnittliche Vermarktungszeit')) }),
          K.item({ value: '97', suffix: L('%'), label: L(t('of the asking price achieved', 'от запрошенной цены в среднем', 'des Angebotspreises erzielt')) }),
        ],
      }),
    ]),
    K.sec({
      anchor: 'homes', pad: 'm',
      eyebrow: t('Homes for sale', 'Объекты в продаже', 'Immobilien zum Kauf'),
      title: t('Search our current listings', 'Подберите объект в нашем каталоге', 'Unsere aktuellen Angebote durchsuchen'),
      lead: p('Filter by type, district, rooms and status, set a price or size range and sort the list. Every listing has a floor plan to view and a brochure to download.',
        'Фильтруйте по типу, району, числу комнат и статусу, задайте диапазон цены или площади и отсортируйте список. У каждого объекта есть планировка для просмотра и буклет для скачивания.',
        'Filtern Sie nach Art, Viertel, Zimmern und Status, legen Sie Preis- oder Flächenbereiche fest und sortieren Sie die Liste. Zu jedem Angebot gibt es einen Grundriss zum Ansehen und ein Exposé zum Herunterladen.'),
    }, [
      B('collection', {
        variant: 'feature', columns: 3, ratio: '4/3', cardAttrs: 3, details: 'modal', media: 'reader',
        search: true, filters: ['Type', 'District', 'Rooms', 'Status'], ranges: ['$price', 'Area'], sorts: ['$price', 'Area', '$date'], more: 7,
        linkLabel: L(t('Book a viewing', 'Записаться на показ', 'Besichtigung buchen')),
        empty: L(t('No home matches these filters yet. Reset them — or tell us what you are looking for and we will call you when it comes on the market.',
          'Под эти условия пока ничего нет. Сбросьте фильтры — или расскажите, что вы ищете, и мы позвоним, как только подходящий объект появится.',
          'Noch kein Angebot passt zu diesen Filtern. Setzen Sie sie zurück – oder sagen Sie uns, was Sie suchen, wir rufen Sie an, sobald es auf den Markt kommt.')),
        items: LISTINGS.map(listingItem),
      }),
    ]),
    K.sec({
      anchor: 'new', tone: 'muted', pad: 'm',
      eyebrow: t('New developments', 'Новостройки', 'Neubauprojekte'),
      title: t('Three new addresses in and around Port Avelin', 'Три новых адреса в Порт-Авелине и окрестностях', 'Drei neue Adressen in und um Port Avelin'),
      lead: p('Buy directly from the developer through us: fixed prices, staged payments and a 10-year structural warranty.',
        'Покупайте у застройщика через нас: фиксированные цены, оплата по этапам и 10-летняя гарантия на конструкции.',
        'Kaufen Sie über uns direkt vom Bauträger: Festpreise, Zahlung nach Baufortschritt und 10 Jahre Gewährleistung auf die Bausubstanz.'),
    }, [
      B('features', {
        variant: 'split', columns: 2, items: [
          K.item({ image: hlDay, icon: K.icon('flag'), title: L(t('Harbour Lights · Old Harbour', '«Огни гавани» · Старая гавань', 'Harbour Lights · Alter Hafen')),
            html: L(t(
              '<p>Two towers on the quay with a marina view from almost every flat.</p>' + li(['96 apartments, 1–4 rooms, 38–148 m²', 'Completion Q2 2027', 'From ' + money(189000).en]),
              '<p>Две башни на набережной: вид на марину почти из каждой квартиры.</p>' + li(['96 квартир, 1–4 комнаты, 38–148 м²', 'Сдача — II квартал 2027 года', 'От ' + money(189000).ru]),
              '<p>Zwei Türme am Kai mit Marinablick aus fast jeder Wohnung.</p>' + li(['96 Wohnungen, 1–4 Zimmer, 38–148 m²', 'Fertigstellung Q2 2027', 'Ab ' + money(189000).de]))) }),
          K.item({ image: linden, icon: K.icon('leaf'), title: L(t('Linden Gardens · Lindenhill', '«Липовые сады» · Липовый холм', 'Linden Gardens · Lindenhügel')),
            html: L(t(
              '<p>Townhouses around a shared garden court, five minutes from Linden Park.</p>' + li(['18 townhouses, 4–5 rooms, 120–160 m²', 'Heat pumps, solar roofs, private gardens', 'From ' + money(498000).en]),
              '<p>Таунхаусы вокруг общего сада, в пяти минутах от Липового парка.</p>' + li(['18 таунхаусов, 4–5 комнат, 120–160 м²', 'Тепловые насосы, солнечные крыши, свои сады', 'От ' + money(498000).ru]),
              '<p>Reihenhäuser um einen gemeinsamen Gartenhof, fünf Minuten vom Lindenpark.</p>' + li(['18 Reihenhäuser, 4–5 Zimmer, 120–160 m²', 'Wärmepumpen, Solardächer, eigene Gärten', 'Ab ' + money(498000).de]))) }),
          K.item({ image: corran, icon: K.icon('sun'), title: L(t('Corran Dunes · Corran Bay', '«Корран-Дюны» · Корран-Бей', 'Corran Dunes · Corran Bay')),
            html: L(t(
              '<p>Twelve timber-clad garden houses 300 metres from the beach.</p>' + li(['12 houses, 3–4 rooms, 110–140 m²', 'Energy class A+, gardens on the dunes', 'From ' + money(529000).en]),
              '<p>Двенадцать домов с деревянными фасадами и садами в 300 метрах от пляжа.</p>' + li(['12 домов, 3–4 комнаты, 110–140 м²', 'Класс энергоэффективности A+, сады на дюнах', 'От ' + money(529000).ru]),
              '<p>Zwölf holzverkleidete Gartenhäuser 300 Meter vom Strand.</p>' + li(['12 Häuser, 3–4 Zimmer, 110–140 m²', 'Energieklasse A+, Gärten in den Dünen', 'Ab ' + money(529000).de]))) }),
        ],
      }),
      B('spacer', { h: 40 }),
      K.head(t('Inside the Harbour Lights show flat', 'Шоурум «Огней гавани» изнутри', 'Ein Blick in die Musterwohnung von Harbour Lights'), 3, { align: 'left' }),
      B('carousel', {
        variant: 'images', ratio: '4/3', perView: 3, perViewT: 2, perViewP: 1, gap: 12, autoplay: 0, loop: true, arrows: true, dots: true,
        label: L(t('Show flat photos', 'Фото шоурума', 'Fotos der Musterwohnung')),
        items: [
          K.item({ image: hlDusk, title: L(t('Harbour Lights at dusk', '«Огни гавани» в сумерках', 'Harbour Lights in der Abenddämmerung')) }),
          K.item({ image: living, title: L(t('Living room with a marina view', 'Гостиная с видом на марину', 'Wohnzimmer mit Marinablick')) }),
          K.item({ image: kitchen, title: L(t('Kitchen with an island', 'Кухня с островом', 'Küche mit Kochinsel')) }),
          K.item({ image: bedroom, title: L(t('Bedroom facing the courtyard', 'Спальня с окнами во двор', 'Schlafzimmer zum Hof')) }),
          K.item({ image: terrace, title: L(t('Roof terrace of the penthouse', 'Терраса пентхауса на крыше', 'Dachterrasse des Penthouse')) }),
          K.item({ image: city, title: L(t('The Old Harbour waterfront', 'Набережная Старой гавани', 'Uferfront am Alten Hafen')) }),
        ],
      }),
      B('spacer', { h: 40 }),
      K.head(t('Harbour Lights from day to dusk', '«Огни гавани» днём и в сумерках', 'Harbour Lights vom Tag bis zur Dämmerung'), 3, { align: 'left' }),
      B('beforeafter', {
        before: hlDay, after: hlDusk, start: 50, ratio: '4/3',
        beforeLabel: L(t('Day', 'День', 'Tag')), afterLabel: L(t('Dusk', 'Сумерки', 'Dämmerung')),
        caption: L(t('Drag the handle to see the quay light up.', 'Перетащите ручку, чтобы увидеть, как зажигается набережная.', 'Ziehen Sie den Regler, um den Kai erleuchten zu sehen.')),
      }),
      B('spacer', { h: 24 }),
      B('embed', { att: priceList, display: 'card', player: 'object', height: 520, ratio: 'auto', caption: L(''), dl: true, op: true }),
    ]),
    K.sec({
      anchor: 'areas', pad: 'm',
      eyebrow: t('Neighbourhood guide', 'Гид по районам', 'Viertel-Guide'),
      title: t('Six neighbourhoods, six ways to live', 'Шесть районов — шесть стилей жизни', 'Sechs Viertel, sechs Lebensweisen'),
      lead: p('Prices per square metre are the averages of our sales over the last 12 months. The numbers match the pins on the map.',
        'Цены за квадратный метр — средние по нашим сделкам за последние 12 месяцев. Номера соответствуют меткам на карте.',
        'Die Quadratmeterpreise sind Durchschnittswerte unserer Verkäufe der letzten 12 Monate. Die Nummern entsprechen den Markierungen auf der Karte.'),
    }, [
      B('columns', {
        gap: 48, valign: 'center', cols: [
          col(46, [B('image', { att: areaMap, width: 100, align: 'center', shape: 'rounded', ratio: '4/3', fit: 'cover', zoom: true,
            caption: L(t('Port Avelin and Corran Bay', 'Порт-Авелин и Корран-Бей', 'Port Avelin und Corran Bay')), link: '' })]),
          col(54, [B('features', {
            variant: 'list', columns: 2, items: [
              K.item({ icon: K.icon('flag'), title: L(t('1 · Old Harbour', '1 · Старая гавань', '1 · Alter Hafen')),
                html: L(p('Cobbled lanes, the marina and the fish market. Flats from ' + money(4600).en + ' per m².', 'Мощёные переулки, марина и рыбный рынок. Квартиры — от ' + money(4600).ru + ' за м².', 'Kopfsteinpflaster, Marina und Fischmarkt. Wohnungen ab ' + money(4600).de + ' pro m².')) }),
              K.item({ icon: K.icon('sun'), title: L(t('2 · Seafront', '2 · Набережная', '2 · Strandpromenade')),
                html: L(p('The promenade, the beach and the newest towers. From ' + money(6900).en + ' per m².', 'Променад, пляж и самые новые башни. От ' + money(6900).ru + ' за м².', 'Promenade, Strand und die neuesten Türme. Ab ' + money(6900).de + ' pro m².')) }),
              K.item({ icon: K.icon('leaf'), title: L(t('3 · Lindenhill', '3 · Липовый холм', '3 · Lindenhügel')),
                html: L(p('Linden Park, good schools and quiet streets. From ' + money(3800).en + ' per m².', 'Липовый парк, хорошие школы и тихие улицы. От ' + money(3800).ru + ' за м².', 'Lindenpark, gute Schulen und ruhige Straßen. Ab ' + money(3800).de + ' pro m².')) }),
              K.item({ icon: K.icon('drop'), title: L(t('4 · Riverside', '4 · Речной квартал', '4 · Flussviertel')),
                html: L(p('Old mills turned into lofts, the river path and the tram. From ' + money(4200).en + ' per m².', 'Бывшие мельницы с лофтами, набережная реки и трамвай. От ' + money(4200).ru + ' за м².', 'Alte Mühlen als Lofts, der Uferweg und die Straßenbahn. Ab ' + money(4200).de + ' pro m².')) }),
              K.item({ icon: K.icon('briefcase'), title: L(t('5 · Northpoint', '5 · Нортпойнт', '5 · Northpoint')),
                html: L(p('Offices, the station and good-value flats for investors. From ' + money(3500).en + ' per m².', 'Офисы, вокзал и доступные квартиры для инвесторов. От ' + money(3500).ru + ' за м².', 'Büros, Bahnhof und preiswerte Wohnungen für Anleger. Ab ' + money(3500).de + ' pro m².')) }),
              K.item({ icon: K.icon('mountain'), title: L(t('6 · Corran Bay', '6 · Корран-Бей', '6 · Corran Bay')),
                html: L(p('A fishing village 25 minutes south: dunes, cliffs and gardens. From ' + money(4000).en + ' per m².', 'Рыбацкий посёлок в 25 минутах к югу: дюны, скалы и сады. От ' + money(4000).ru + ' за м².', 'Ein Fischerdorf 25 Minuten südlich: Dünen, Klippen und Gärten. Ab ' + money(4000).de + ' pro m².')) }),
            ],
          })]),
        ],
      }),
    ]),
    K.sec({
      anchor: 'mortgage', tone: 'muted', pad: 'm', align: 'center',
      eyebrow: t('Mortgage & payment', 'Ипотека и оплата', 'Finanzierung & Zahlung'),
      title: t('Three ways to pay for your new home', 'Три способа оплатить новый дом', 'Drei Wege, Ihr neues Zuhause zu bezahlen'),
      lead: p('Monthly figures for a ' + money(250000).en + ' home. Our mortgage adviser compares four partner banks for you, free of charge.',
        'Ежемесячные суммы для жилья за ' + money(250000).ru + '. Наш ипотечный консультант бесплатно сравнит предложения четырёх банков-партнёров.',
        'Monatsbeträge für eine Immobilie zu ' + money(250000).de + '. Unser Finanzierungsberater vergleicht kostenlos vier Partnerbanken für Sie.'),
    }, [
      B('pricing', {
        columns: 3, items: [
          K.item({ name: L(t('Bank mortgage', 'Ипотека', 'Bankdarlehen')), price: pay(250000), period: L(t('per month', 'в месяц', 'pro Monat')), featured: false,
            html: L(ul(['20 % deposit, 25 years, 3.6 % fixed for 10 years', 'Decision in principle within 48 hours', 'Four partner banks compared for you'],
              ['Взнос 20 %, 25 лет, ставка 3,6 % на 10 лет', 'Предварительное решение за 48 часов', 'Сравним для вас четыре банка-партнёра'],
              ['20 % Eigenkapital, 25 Jahre, 3,6 % fest für 10 Jahre', 'Grundsatzentscheidung binnen 48 Stunden', 'Vier Partnerbanken für Sie verglichen'])),
            label: L(t('Get a decision in principle', 'Получить предварительное решение', 'Finanzierung anfragen')), href: '#lead', sku: '' }),
          K.item({ name: L(t('Developer instalments', 'Рассрочка от застройщика', 'Ratenzahlung beim Bauträger')), price: Math.round((250000 * 0.7) / 36), period: L(t('per month, 36 months', 'в месяц, 36 месяцев', 'pro Monat, 36 Monate')), featured: true,
            html: L(ul(['30 % down, the rest at 0 % interest', 'No bank checks and no fees', 'Harbour Lights, Linden Gardens and Corran Dunes'],
              ['30 % сразу, остальное — под 0 %', 'Без банковских проверок и комиссий', '«Огни гавани», «Липовые сады» и «Корран-Дюны»'],
              ['30 % Anzahlung, der Rest zu 0 % Zinsen', 'Ohne Bankprüfung und ohne Gebühren', 'Harbour Lights, Linden Gardens und Corran Dunes'])),
            label: L(t('See new developments', 'Смотреть новостройки', 'Neubauprojekte ansehen')), href: '#new', sku: '' }),
          K.item({ name: L(t('Rent to own', 'Аренда с выкупом', 'Mietkauf')), price: 1350, period: L(t('per month', 'в месяц', 'pro Monat')), featured: false,
            html: L(ul(['Move in with a 5 % deposit', '70 % of the rent counts towards the price', 'Buy within 3 years at today’s price'],
              ['Заезд с залогом 5 %', '70 % арендной платы идёт в счёт цены', 'Выкуп в течение 3 лет по сегодняшней цене'],
              ['Einzug mit 5 % Anzahlung', '70 % der Miete werden angerechnet', 'Kauf innerhalb von 3 Jahren zum heutigen Preis'])),
            label: L(t('Ask about rent to own', 'Узнать об аренде с выкупом', 'Mietkauf anfragen')), href: '#lead', sku: '' }),
        ],
      }),
      B('spacer', { h: 28 }),
      B('columns', {
        gap: 40, valign: 'top', cols: [
          col(58, [
            K.head(t('Example monthly payments', 'Примеры ежемесячных платежей', 'Beispiele für Monatsraten'), 4, { align: 'left' }),
            K.table([
              [th(t('Home price', 'Цена жилья', 'Kaufpreis')), th(t('Deposit 20 %', 'Взнос 20 %', 'Eigenkapital 20 %'), { align: 'right' }), th(t('Loan', 'Кредит', 'Darlehen'), { align: 'right' }), th(t('Per month', 'В месяц', 'Monatsrate'), { align: 'right' })],
              ...[250000, 400000, 650000].map((v) => [K.cell(money(v)), K.cell(money(v * 0.2), { align: 'right' }), K.cell(money(v * 0.8), { align: 'right' }), K.cell(money(pay(v)), { align: 'right' })]),
            ], [28, 24, 24, 24], {
              header: 'row', variant: 'lines', compact: false, width: 100,
              caption: L(t('25 years at 3.6 % fixed for 10 years. Representative examples, not an offer.', 'Срок 25 лет, ставка 3,6 % с фиксацией на 10 лет. Примеры для ориентира, не оферта.', '25 Jahre, 3,6 % fest für 10 Jahre. Beispielrechnung, kein Angebot.')),
            }),
          ]),
          col(42, [
            B('quote', {
              variant: 'callout', tone: 'accent', icon: K.icon('info'), author: L(''),
              html: L(p('<strong>Buying costs:</strong> add about 3 % of the price for the notary, the land registry and the transfer tax. Buyers pay no agency fee.',
                '<strong>Расходы на покупку:</strong> заложите около 3 % от цены на нотариуса, регистрацию и налог на передачу. Покупатель не платит комиссию агентству.',
                '<strong>Kaufnebenkosten:</strong> rechnen Sie mit etwa 3 % des Preises für Notar, Grundbuch und Grunderwerbsteuer. Käufer zahlen keine Maklerprovision.')),
            }),
            K.head(t('Our partner banks', 'Наши банки-партнёры', 'Unsere Partnerbanken'), 4, { align: 'left' }),
            B('logos', { variant: 'grid', mono: true, items: banks.map((x) => K.item({ att: x.id, name: L(x.name), href: '' })) }),
          ]),
        ],
      }),
    ]),
    K.sec({
      anchor: 'how', pad: 'm',
      eyebrow: t('How we work', 'Как мы работаем', 'So arbeiten wir'),
      title: t('From the first viewing to the keys in five steps', 'От первого показа до ключей — пять шагов', 'Von der ersten Besichtigung bis zum Schlüssel in fünf Schritten'),
    }, [
      B('steps', {
        variant: 'line', items: [
          K.item({ icon: K.icon('search'), title: L(t('Tell us what you need', 'Расскажите, что ищете', 'Sagen Sie uns, was Sie suchen')),
            html: L(p('Budget, districts, must-haves. We send matching homes before they go online.', 'Бюджет, районы, обязательные условия. Подходящие варианты пришлём ещё до публикации.', 'Budget, Viertel, Muss-Kriterien. Wir senden passende Angebote, bevor sie online sind.')) }),
          K.item({ icon: K.icon('calendar'), title: L(t('Viewings that fit your week', 'Показы в удобное время', 'Besichtigungen nach Ihrem Kalender')),
            html: L(p('In person on evenings and Saturdays, or a live video tour with the agent.', 'Лично по вечерам и в субботу или видеопоказ с агентом в реальном времени.', 'Vor Ort abends und samstags oder als Live-Videotour mit dem Makler.')) }),
          K.item({ icon: K.icon('note'), title: L(t('Offer and reservation', 'Предложение и бронь', 'Angebot und Reservierung')),
            html: L(p('We negotiate for you; a 2 % deposit takes the home off the market.', 'Мы ведём переговоры за вас; залог 2 % снимает объект с продажи.', 'Wir verhandeln für Sie; 2 % Anzahlung nehmen das Objekt vom Markt.')) }),
          K.item({ icon: K.icon('shield'), title: L(t('Checks and mortgage', 'Проверки и ипотека', 'Prüfung und Finanzierung')),
            html: L(p('Title, permits and service charges checked; the bank’s valuation arranged.', 'Проверяем права, разрешения и платежи; организуем оценку для банка.', 'Grundbuch, Genehmigungen und Nebenkosten geprüft; Bankbewertung organisiert.')) }),
          K.item({ icon: K.icon('home'), title: L(t('Notary and keys', 'Нотариус и ключи', 'Notar und Schlüssel')),
            html: L(p('We prepare the contract with the notary and hand over the keys on the day.', 'Готовим договор с нотариусом и передаём ключи в день сделки.', 'Wir bereiten den Vertrag mit dem Notar vor und übergeben am selben Tag die Schlüssel.')) }),
        ],
      }),
      B('spacer', { h: 24 }),
      B('columns', {
        gap: 40, valign: 'center', cols: [
          col(62, [B('embed', { att: guide, display: 'embed', player: 'object', height: 560, ratio: 'auto', caption: L(''), dl: true, op: true })]),
          col(38, [
            B('quote', {
              variant: 'pull', tone: 'accent', icon: '',
              html: L(p('Visit twice — on a weekday evening and on a Saturday morning. A street can be two different places.',
                'Приходите дважды — в будний вечер и в субботу утром. Одна и та же улица может оказаться двумя разными местами.',
                'Besichtigen Sie zweimal – an einem Werktagabend und an einem Samstagmorgen. Eine Straße kann zwei verschiedene Orte sein.')),
              author: L(t('Mara Lindqvist, head of sales', 'Мара Линдквист, руководитель продаж', 'Mara Lindqvist, Vertriebsleiterin')),
            }),
          ]),
        ],
      }),
    ]),
    K.sec({
      anchor: 'agents', tone: 'muted', pad: 'm',
      eyebrow: t('Agents', 'Агенты', 'Makler'),
      title: t('Local agents who answer the phone', 'Местные агенты, которые берут трубку', 'Makler vor Ort, die ans Telefon gehen'),
    }, [
      B('team', {
        variant: 'cards', columns: 4, items: [
          K.item({ photo: people[0], name: L(t('Mara Lindqvist', 'Мара Линдквист', 'Mara Lindqvist')), role: L(t('Head of sales · Old Harbour & Seafront', 'Руководитель продаж · Старая гавань и Набережная', 'Vertriebsleiterin · Alter Hafen & Strandpromenade')),
            html: L(p('Sold her first flat on Wharf Lane in 2006 and still knows every staircase there.', 'Продала первую квартиру на Пристанском переулке в 2006 году и до сих пор знает там каждую лестницу.', 'Verkaufte 2006 ihre erste Wohnung in der Wharf Lane und kennt dort bis heute jedes Treppenhaus.')), href: 'mailto:m.lindqvist@avelin-estates.example' }),
          K.item({ photo: people[1], name: L(t('Tomas Brenner', 'Томас Бреннер', 'Tomas Brenner')), role: L(t('New developments', 'Новостройки', 'Neubauprojekte')),
            html: L(p('A former site engineer who reads construction schedules and specifications for you.', 'Бывший инженер на стройке: читает за вас графики строительства и спецификации.', 'Früher Bauleiter: liest Bauzeitenpläne und Baubeschreibungen für Sie.')), href: 'mailto:t.brenner@avelin-estates.example' }),
          K.item({ photo: people[2], name: L(t('Irina Vasko', 'Ирина Васко', 'Irina Vasko')), role: L(t('Lindenhill & Riverside · relocation', 'Липовый холм и Речной квартал · переезд', 'Lindenhügel & Flussviertel · Umzugsservice')),
            html: L(p('Helps families moving from abroad, in English, Russian and German.', 'Помогает семьям, переезжающим из-за рубежа, — на английском, русском и немецком.', 'Begleitet Familien beim Umzug aus dem Ausland – auf Englisch, Russisch und Deutsch.')), href: 'mailto:i.vasko@avelin-estates.example' }),
          K.item({ photo: people[3], name: L(t('Daniel Okoye', 'Даниэль Окойе', 'Daniel Okoye')), role: L(t('Corran Bay & coastal homes', 'Корран-Бей и дома у моря', 'Corran Bay & Küstenhäuser')),
            html: L(p('Lives in Corran Bay and knows which plots flood and which keep the view.', 'Живёт в Корран-Бей и знает, какие участки подтапливает, а какие сохранят вид.', 'Wohnt in Corran Bay und weiß, welche Grundstücke nass werden und welche den Blick behalten.')), href: 'mailto:d.okoye@avelin-estates.example' }),
        ],
      }),
      B('spacer', { h: 24 }),
      B('testimonials', {
        variant: 'cards', columns: 3, items: [
          K.item({ rating: 5, photo: null,
            html: L(p('Mara found us a flat on the quay before it went online, negotiated ' + money(18000).en + ' off and sorted the notary in three weeks.',
              'Мара нашла нам квартиру на набережной ещё до публикации, сторговала ' + money(18000).ru + ' и за три недели всё оформила у нотариуса.',
              'Mara fand uns eine Wohnung am Kai, bevor sie online war, handelte ' + money(18000).de + ' herunter und regelte den Notar in drei Wochen.')),
            name: L(t('Sofia & Jan Kowal', 'София и Ян Коваль', 'Sofia & Jan Kowal')), role: L(t('Bought in the Old Harbour', 'Купили в Старой гавани', 'Kauf im Alten Hafen')) }),
          K.item({ rating: 5, photo: null,
            html: L(p('The floor plans and the brochure were spot on. We did two video viewings from abroad and bought the third flat in person.',
              'Планировки и буклет полностью совпали с реальностью. Мы провели два видеопоказа из-за границы, а третью квартиру купили, приехав лично.',
              'Grundrisse und Exposé stimmten genau. Wir haben zwei Videobesichtigungen aus dem Ausland gemacht und die dritte Wohnung vor Ort gekauft.')),
            name: L(t('Markus Feld', 'Маркус Фельд', 'Markus Feld')), role: L(t('Relocated from Hamburg', 'Переехал из Гамбурга', 'Aus Hamburg umgezogen')) }),
          K.item({ rating: 5, photo: null,
            html: L(p('Our house in Lindenhill sold in 24 days at 99 % of the asking price. An honest valuation and beautiful photos.',
              'Наш дом на Липовом холме продали за 24 дня по 99 % от запрошенной цены. Честная оценка и прекрасные фотографии.',
              'Unser Haus am Lindenhügel war in 24 Tagen für 99 % des Angebotspreises verkauft. Ehrliche Bewertung, wunderschöne Fotos.')),
            name: L(t('Elena Marsh', 'Елена Марш', 'Elena Marsh')), role: L(t('Sold in Lindenhill', 'Продала дом на Липовом холме', 'Verkauf am Lindenhügel')) }),
        ],
      }),
    ]),
    B('cta', {
      variant: 'split', tone: 'dark', bg: hlDusk, overlay: 78,
      title: L(t('Thinking of selling? Get a free valuation in 48 hours', 'Думаете о продаже? Бесплатная оценка за 48 часов', 'Verkaufen? Kostenlose Bewertung in 48 Stunden')),
      html: L(p('An agent visits, measures and photographs your home and sends a written valuation with recent sales nearby.',
        'Агент приедет, обмерит и сфотографирует ваше жильё и пришлёт письменную оценку с примерами недавних продаж по соседству.',
        'Ein Makler besichtigt, vermisst und fotografiert Ihre Immobilie und schickt eine schriftliche Bewertung mit Vergleichsverkäufen aus der Nähe.')),
      items: [
        K.btn(t('Request a valuation', 'Заказать оценку', 'Bewertung anfordern'), '#lead', 'primary', K.icon('home')),
        K.btn('+00 41 000 2040', 'tel:+00410002040', 'secondary', K.icon('phone')),
      ],
    }),
    K.sec({
      anchor: 'viewing', pad: 'm',
      eyebrow: t('Viewings', 'Показы', 'Besichtigungen'),
      title: t('Book a viewing', 'Запишитесь на показ', 'Besichtigung buchen'),
      lead: p('Pick a home and a preferred day — your agent confirms the time by phone or e-mail within one working day. Open houses need no appointment.',
        'Выберите объект и удобный день — агент подтвердит время по телефону или почте в течение рабочего дня. На дни открытых дверей записываться не нужно.',
        'Wählen Sie ein Objekt und einen Wunschtag – Ihr Makler bestätigt den Termin telefonisch oder per E-Mail innerhalb eines Werktages. Für offene Besichtigungen brauchen Sie keinen Termin.'),
    }, [
      B('columns', {
        gap: 40, valign: 'top', cols: [
          col(42, [
            K.head(t('Open houses', 'Дни открытых дверей', 'Offene Besichtigungen'), 4, { align: 'left' }),
            B('events', {
              variant: 'list', columns: 3, hidePast: false, items: [
                K.item({ date: '2026-10-24', time: '11:00', title: L(t('Harbour Lights show flat', 'Шоурум «Огней гавани»', 'Musterwohnung Harbour Lights')), venue: L(t('Sales gallery, 2 Quay Road', 'Офис продаж, Портовая дорога, 2', 'Verkaufsgalerie, Quay Road 2')), city: L(t('Port Avelin', 'Порт-Авелин', 'Port Avelin')), status: 'on', price: null, sku: '', href: '' }),
                K.item({ date: '2026-10-25', time: '14:00', title: L(t('Linden Gardens townhouses', 'Таунхаусы «Липовые сады»', 'Reihenhäuser Linden Gardens')), venue: L(t('Orchard Row', 'Садовый ряд', 'Orchard Row')), city: L(t('Port Avelin', 'Порт-Авелин', 'Port Avelin')), status: 'on', price: null, sku: '', href: '' }),
                K.item({ date: '2026-11-07', time: '10:30', title: L(t('Corran Dunes: show house and beach walk', '«Корран-Дюны»: показ дома и прогулка к пляжу', 'Corran Dunes: Musterhaus und Strandspaziergang')), venue: L(t('9 Dune Road', 'Дюнная дорога, 9', 'Dune Road 9')), city: L(t('Corran Bay', 'Корран-Бей', 'Corran Bay')), status: 'on', price: null, sku: '', href: '' }),
                K.item({ date: '2026-11-14', time: '12:00', title: L(t('First-time buyers’ morning', 'Утро для тех, кто покупает впервые', 'Vormittag für Erstkäufer')), venue: L(t('Avelin Estates office', 'Офис Avelin Estates', 'Büro Avelin Estates')), city: L(t('Port Avelin', 'Порт-Авелин', 'Port Avelin')), status: 'on', price: null, sku: '', href: '' }),
              ],
            }),
          ]),
          col(58, [
            B('form', {
              variant: 'card', req: reqViewing, fallback: 'mailto', to: 'viewings@avelin-estates.example',
              title: L(t('Request a viewing', 'Заявка на показ', 'Besichtigung anfragen')),
              submit: L(t('Request a viewing', 'Отправить заявку', 'Termin anfragen')),
              success: L(t('Thank you! Your agent will confirm the time within one working day.', 'Спасибо! Агент подтвердит время в течение рабочего дня.', 'Vielen Dank! Ihr Makler bestätigt den Termin innerhalb eines Werktages.')),
              consent: L(p('We use your details only to arrange the viewing.', 'Мы используем ваши данные только для организации показа.', 'Wir nutzen Ihre Angaben nur für die Terminvereinbarung.')),
              items: [
                field('name', 'text', t('Name', 'Имя', 'Name'), '', { required: true, half: true }),
                field('phone', 'tel', t('Phone', 'Телефон', 'Telefon'), '+00 00 000 0000', { required: true, half: true }),
                field('email', 'email', t('E-mail', 'E-mail', 'E-Mail'), 'name@example.com', { half: true }),
                field('home', 'select', t('Home', 'Объект', 'Objekt'), '', { required: true, half: true, options: homeOptions }),
                field('date', 'date', t('Preferred day', 'Желаемый день', 'Wunschtag'), '', { required: true, half: true }),
                field('slot', 'select', t('Time', 'Время', 'Uhrzeit'), '', { half: true, options: t('Morning (9–12)\nAfternoon (12–16)\nEvening (16–19)\nSaturday', 'Утро (9–12)\nДень (12–16)\nВечер (16–19)\nСуббота', 'Vormittag (9–12)\nNachmittag (12–16)\nAbend (16–19)\nSamstag') }),
                field('format', 'select', t('Viewing', 'Формат показа', 'Besichtigung'), '', { half: true, options: t('In person\nLive video tour', 'Лично\nВидеопоказ онлайн', 'Vor Ort\nLive-Videotour') }),
                field('mortgage', 'checkbox', t('I would also like mortgage advice', 'Нужна консультация по ипотеке', 'Ich möchte auch eine Finanzierungsberatung'), '', { half: true }),
                field('note', 'textarea', t('Anything we should know?', 'Что нам стоит знать?', 'Was sollten wir wissen?'), ''),
              ],
            }),
          ]),
        ],
      }),
    ]),
    K.sec({
      anchor: 'lead', tone: 'muted', pad: 'm',
      eyebrow: t('Sell, let or get advice', 'Продать, сдать или получить совет', 'Verkaufen, vermieten oder beraten lassen'),
      title: t('Tell us about your plans', 'Расскажите о ваших планах', 'Erzählen Sie uns von Ihren Plänen'),
      lead: p('A free valuation, a letting offer, mortgage advice or a search for a home that is not online yet — an agent calls you back within one working day.',
        'Бесплатная оценка, предложение по аренде, консультация по ипотеке или поиск жилья, которого ещё нет в каталоге, — агент перезвонит в течение рабочего дня.',
        'Kostenlose Bewertung, ein Vermietungsangebot, Finanzierungsberatung oder die Suche nach einem Objekt, das noch nicht online ist – ein Makler ruft Sie innerhalb eines Werktages zurück.'),
    }, [
      B('columns', {
        gap: 40, valign: 'top', cols: [
          col(60, [
            B('form', {
              variant: 'card', req: reqLead, fallback: 'mailto', to: 'hello@avelin-estates.example',
              title: L(''),
              submit: L(t('Send to an agent', 'Отправить агенту', 'An einen Makler senden')),
              success: L(t('Thank you! An agent will call you within one working day.', 'Спасибо! Агент позвонит вам в течение рабочего дня.', 'Vielen Dank! Ein Makler ruft Sie innerhalb eines Werktages an.')),
              consent: L(p('We use your details only to answer this request and never pass them on.', 'Мы используем ваши данные только для ответа на этот запрос и никому их не передаём.', 'Wir nutzen Ihre Angaben nur für diese Anfrage und geben sie nicht weiter.')),
              items: [
                field('name', 'text', t('Name', 'Имя', 'Name'), '', { required: true, half: true }),
                field('phone', 'tel', t('Phone', 'Телефон', 'Telefon'), '+00 00 000 0000', { required: true, half: true }),
                field('email', 'email', t('E-mail', 'E-mail', 'E-Mail'), 'name@example.com', { half: true }),
                field('intent', 'select', t('I would like to', 'Я хочу', 'Ich möchte'), '', { required: true, half: true,
                  options: t('Sell my home\nLet my home\nGet mortgage advice\nFind a home that is not listed yet', 'Продать жильё\nСдать жильё\nПолучить консультацию по ипотеке\nНайти жильё, которого нет в каталоге', 'Meine Immobilie verkaufen\nMeine Immobilie vermieten\nEine Finanzierungsberatung\nEin Objekt finden, das noch nicht online ist') }),
                field('type', 'select', t('Property type', 'Тип объекта', 'Objektart'), '', { half: true, options: typeOptions }),
                field('district', 'select', t('District', 'Район', 'Viertel'), '', { half: true, options: districtOptions }),
                field('rooms', 'number', t('Rooms', 'Комнаты', 'Zimmer'), '3', { half: true }),
                field('area', 'number', t('Area, m²', 'Площадь, м²', 'Wohnfläche, m²'), '80', { half: true }),
                field('address', 'text', t('Address (for a valuation)', 'Адрес (для оценки)', 'Adresse (für eine Bewertung)'), ''),
                field('message', 'textarea', t('Your question or what you are looking for', 'Ваш вопрос или что вы ищете', 'Ihre Frage oder was Sie suchen'), ''),
              ],
            }),
          ]),
          col(40, [
            B('features', {
              variant: 'list', columns: 2, items: [
                K.item({ icon: K.icon('camera'), title: L(t('Photos, video and a measured plan', 'Фото, видео и обмерный план', 'Fotos, Video und vermessener Grundriss')), html: L(p('Included for every home we sell.', 'Входят в услугу для каждого объекта.', 'Für jedes Objekt, das wir verkaufen, inklusive.')) }),
                K.item({ icon: K.icon('chart'), title: L(t('Valuation from real sales', 'Оценка по реальным сделкам', 'Bewertung aus echten Verkäufen')), html: L(p('Not from asking prices — from what homes actually sold for.', 'Не по ценам объявлений, а по ценам состоявшихся сделок.', 'Nicht nach Angebotspreisen – nach tatsächlichen Verkaufspreisen.')) }),
                K.item({ icon: K.icon('users'), title: L(t('Buyers already waiting', 'Покупатели уже ждут', 'Käufer warten bereits')), html: L(p('2,300 active searches in our database.', '2300 активных запросов в нашей базе.', '2.300 aktive Suchaufträge in unserer Datenbank.')) }),
                K.item({ icon: K.icon('tag'), title: L(t('1.9 % fee, paid on completion', 'Комиссия 1,9 % — после сделки', '1,9 % Provision, fällig beim Abschluss')), html: L(p('No sale, no fee.', 'Нет сделки — нет комиссии.', 'Kein Verkauf, keine Provision.')) }),
              ],
            }),
            B('quote', {
              variant: 'callout', tone: 'note', icon: K.icon('key', 'home'), author: L(''),
              html: L(p('<strong>Letting instead?</strong> We find and check tenants, collect the rent and look after repairs for 8 % of the rent.',
                '<strong>Хотите сдать?</strong> Найдём и проверим арендаторов, будем собирать плату и следить за ремонтом за 8 % от арендной платы.',
                '<strong>Lieber vermieten?</strong> Wir finden und prüfen Mieter, ziehen die Miete ein und kümmern uns um Reparaturen – für 8 % der Miete.')),
            }),
          ]),
        ],
      }),
    ]),
    K.sec({
      anchor: 'faq', pad: 'm', align: 'center',
      eyebrow: t('Questions', 'Вопросы', 'Fragen'),
      title: t('Good to know before you buy or sell', 'Полезно знать до покупки или продажи', 'Gut zu wissen vor Kauf oder Verkauf'),
    }, [
      B('faq', {
        variant: 'details', openFirst: true, items: [
          K.item({ q: L(t('Do buyers pay your commission?', 'Платит ли покупатель комиссию агентству?', 'Zahlen Käufer Ihre Provision?')),
            html: L(p('No. In Port Avelin our fee is paid by the seller. As a buyer you pay the notary, the land registry and the transfer tax — about 3 % of the price in total.',
              'Нет. В Порт-Авелине наше вознаграждение платит продавец. Покупатель оплачивает нотариуса, регистрацию и налог на передачу — в сумме около 3 % от цены.',
              'Nein. In Port Avelin zahlt der Verkäufer unsere Provision. Als Käufer tragen Sie Notar, Grundbuch und Grunderwerbsteuer – zusammen etwa 3 % des Kaufpreises.')) }),
          K.item({ q: L(t('How does a reservation work?', 'Как работает бронирование?', 'Wie funktioniert eine Reservierung?')),
            html: L(p('A 2 % deposit takes the home off the market for 30 days while the bank and the notary do their work. It counts towards the price and is refunded if the title check finds a problem.',
              'Залог 2 % снимает объект с продажи на 30 дней, пока работают банк и нотариус. Он засчитывается в цену и возвращается, если проверка документов выявит проблему.',
              'Eine Anzahlung von 2 % nimmt die Immobilie für 30 Tage vom Markt, während Bank und Notar arbeiten. Sie wird auf den Preis angerechnet und erstattet, falls die Prüfung ein Problem ergibt.')) }),
          K.item({ q: L(t('Can I buy from abroad?', 'Можно ли купить из-за границы?', 'Kann ich aus dem Ausland kaufen?')),
            html: L(p('Yes. We run live video viewings, send the documents for review in English, Russian or German and arrange a power of attorney for the notary if you cannot travel.',
              'Да. Мы проводим видеопоказы в реальном времени, присылаем документы на проверку на английском, русском или немецком и оформляем доверенность для нотариуса, если вы не можете приехать.',
              'Ja. Wir bieten Live-Videobesichtigungen, senden die Unterlagen auf Englisch, Russisch oder Deutsch zur Prüfung und organisieren eine Vollmacht für den Notar, falls Sie nicht anreisen können.')) }),
          K.item({ q: L(t('Are the floor plans and prices up to date?', 'Актуальны ли планировки и цены?', 'Sind Grundrisse und Preise aktuell?')),
            html: L(p('Yes. We measure every home ourselves and update plans and brochures whenever the price or the status changes. Reserved and sold homes stay on the list, so you can see what homes sell for.',
              'Да. Каждый объект мы обмеряем сами и обновляем планировки и буклеты при любом изменении цены или статуса. Забронированные и проданные объекты остаются в списке — так видно, за сколько продаётся жильё.',
              'Ja. Wir vermessen jedes Objekt selbst und aktualisieren Grundrisse und Exposés bei jeder Preis- oder Statusänderung. Reservierte und verkaufte Objekte bleiben sichtbar, damit Sie sehen, was Immobilien kosten.')) }),
          K.item({ q: L(t('How fast can you value my home?', 'Как быстро вы оцените моё жильё?', 'Wie schnell bewerten Sie meine Immobilie?')),
            html: L(p('An agent visits within two working days and sends a written valuation with recent sales nearby within 48 hours of the visit. It is free and without obligation.',
              'Агент приезжает в течение двух рабочих дней и в течение 48 часов после визита присылает письменную оценку с примерами недавних продаж рядом. Бесплатно и ни к чему не обязывает.',
              'Ein Makler kommt innerhalb von zwei Werktagen und schickt binnen 48 Stunden nach dem Termin eine schriftliche Bewertung mit Vergleichsverkäufen aus der Nähe. Kostenlos und unverbindlich.')) }),
          K.item({ q: L(t('Do you also let homes?', 'Сдаёте ли вы жильё в аренду?', 'Vermieten Sie auch?')),
            html: L(p('Yes: long-term lettings with tenant checks, an inventory and rent collection. Ask through the form on this page or call the office.',
              'Да: долгосрочная аренда с проверкой арендаторов, описью имущества и сбором платежей. Напишите через форму на этой странице или позвоните в офис.',
              'Ja: Langzeitvermietung mit Mieterprüfung, Inventarliste und Mietinkasso. Fragen Sie über das Formular auf dieser Seite oder rufen Sie im Büro an.')) }),
        ],
      }),
    ]),
    K.sec({
      anchor: 'contact', pad: 'm',
      eyebrow: t('Contact', 'Контакты', 'Kontakt'),
      title: t('Visit us on the Old Harbour quay', 'Приходите к нам на набережную Старой гавани', 'Besuchen Sie uns am Kai des Alten Hafens'),
    }, [
      B('contact', {
        variant: 'split', labels: true, map: officeMap, mapHref: '', items: [
          K.item({ kind: 'address', value: '2 Quay Road\nOld Harbour, Port Avelin', label: L(t('Office', 'Офис', 'Büro')), href: '' }),
          K.item({ kind: 'phone', value: '+00 41 000 2040', label: L(t('Sales and viewings', 'Продажи и показы', 'Verkauf und Besichtigungen')), href: '' }),
          K.item({ kind: 'whatsapp', value: '+00 41 000 2041', label: L(t('WhatsApp', 'WhatsApp', 'WhatsApp')), href: '' }),
          K.item({ kind: 'email', value: 'hello@avelin-estates.example', label: L(t('E-mail', 'E-mail', 'E-Mail')), href: '' }),
          K.item({ kind: 'hours', value: '9:00–19:00 · 10:00–16:00', label: L(t('Office hours: Mon–Fri · Sat', 'Часы работы: пн–пт · сб', 'Öffnungszeiten: Mo–Fr · Sa')), href: '' }),
        ],
      }),
    ]),
  ];
  // Floating "Ask an agent" chat (leaves a message by e-mail on a static page; a backend export answers it).
  if (V.BLOCK_TYPES && V.BLOCK_TYPES.chat) {
    d.regions.main.push(B('chat', {
      display: 'bubble', side: 'right', avatar: people[0],
      title: L(t('Ask an agent', 'Спросите агента', 'Fragen Sie einen Makler')),
      operator: L(t('Mara and the Avelin team', 'Мара и команда Avelin', 'Mara und das Avelin-Team')),
      welcome: L(t('Hello! Looking for a home or thinking of selling? Ask anything — an agent replies during office hours.',
        'Здравствуйте! Ищете жильё или думаете о продаже? Спрашивайте — агент ответит в рабочее время.',
        'Hallo! Sie suchen ein Zuhause oder möchten verkaufen? Fragen Sie – ein Makler antwortet zu den Bürozeiten.')),
      offline: L(t('Leave your question with a phone number or an e-mail address and we will get back to you today.',
        'Оставьте вопрос с телефоном или e-mail — мы ответим сегодня.',
        'Hinterlassen Sie Ihre Frage mit Telefonnummer oder E-Mail-Adresse – wir melden uns noch heute.')),
      nameField: 'optional', contactField: 'required', fallback: 'mailto', to: 'hello@avelin-estates.example',
    }));
  }

  // ----- footer -----
  const links = (rows) => '<ul>' + rows.map(([h, x]) => '<li><a href="' + h + '">' + x + '</a></li>').join('') + '</ul>';
  const contacts = '<p><a href="tel:+00410002040">+00 41 000 2040</a><br><a href="mailto:hello@avelin-estates.example">hello@avelin-estates.example</a></p>';
  d.regions.footer = [
    B('footer', {
      variant: 'columns', tone: 'dark', logo: brand, logoH: 44,
      brand: L(t('Avelin Estates', 'Avelin Estates', 'Avelin Estates')),
      text: L(t('<p>City and coast property in Port Avelin and Corran Bay since 2004.</p>' + contacts,
        '<p>Недвижимость в Порт-Авелине и Корран-Бей с 2004 года.</p>' + contacts,
        '<p>Stadt- und Küstenimmobilien in Port Avelin und Corran Bay seit 2004.</p>' + contacts)),
      items: [
        K.item({ title: L(t('Buy', 'Купить', 'Kaufen')), html: L(t(
          links([['#homes', 'Homes for sale'], ['#new', 'New developments'], ['#mortgage', 'Mortgage'], ['#viewing', 'Book a viewing']]),
          links([['#homes', 'Объекты в продаже'], ['#new', 'Новостройки'], ['#mortgage', 'Ипотека'], ['#viewing', 'Записаться на показ']]),
          links([['#homes', 'Immobilien zum Kauf'], ['#new', 'Neubauprojekte'], ['#mortgage', 'Finanzierung'], ['#viewing', 'Besichtigung buchen']]))) }),
        K.item({ title: L(t('Sell & let', 'Продать и сдать', 'Verkaufen & vermieten')), html: L(t(
          links([['#lead', 'Free valuation'], ['#lead', 'Letting'], ['#how', 'How we work'], ['#att-' + guide, 'Buyer’s guide (PDF)']]),
          links([['#lead', 'Бесплатная оценка'], ['#lead', 'Аренда'], ['#how', 'Как мы работаем'], ['#att-' + guide, 'Гид покупателя (PDF)']]),
          links([['#lead', 'Kostenlose Bewertung'], ['#lead', 'Vermietung'], ['#how', 'So arbeiten wir'], ['#att-' + guide, 'Käuferleitfaden (PDF)']]))) }),
        K.item({ title: L(t('Agency', 'Агентство', 'Agentur')), html: L(t(
          links([['#agents', 'Agents'], ['#areas', 'Neighbourhoods'], ['#faq', 'Questions'], ['#contact', 'Contact']]),
          links([['#agents', 'Агенты'], ['#areas', 'Районы'], ['#faq', 'Вопросы'], ['#contact', 'Контакты']]),
          links([['#agents', 'Makler'], ['#areas', 'Viertel'], ['#faq', 'Fragen'], ['#contact', 'Kontakt']]))) }),
      ],
      copy: L(t('© 2026 Avelin Estates Ltd · Licensed estate agency · Listings are subject to availability; figures are examples.',
        '© 2026 Avelin Estates · Лицензированное агентство недвижимости · Наличие объектов уточняйте; расчёты приведены для примера.',
        '© 2026 Avelin Estates GmbH · Zugelassener Immobilienmakler · Angebote freibleibend; Berechnungen sind Beispiele.')),
    }),
  ];
  return V.normalizeDoc(d);
}

const TPL_REALTY = {
  id: 'realty',
  name: { en: 'Real estate agency', ru: 'Агентство недвижимости', de: 'Immobilienmakler', fr: 'Agence immobilière', es: 'Agencia inmobiliaria', uk: 'Агентство нерухомості', ka: 'უძრავი ქონების სააგენტო' },
  desc: {
    en: 'City and coast property agency: searchable listings with filters, price and area ranges, sorting, details, floor plans and brochures; new developments with a show-flat gallery, neighbourhood guide with a map, mortgage options, agents, reviews, open houses and viewing booking, valuation requests, FAQ and contacts.',
    ru: 'Агентство недвижимости в городе и у моря: каталог объектов с поиском, фильтрами, диапазонами цены и площади, сортировкой, карточками, планировками и буклетами; новостройки с галереей шоурума, гид по районам с картой, ипотека, агенты, отзывы, дни открытых дверей и запись на показ, заявка на оценку, FAQ и контакты.',
    de: 'Immobilienmakler für Stadt und Küste: durchsuchbare Angebote mit Filtern, Preis- und Flächenbereichen, Sortierung, Details, Grundrissen und Exposés; Neubauprojekte mit Musterwohnungs-Galerie, Viertel-Guide mit Karte, Finanzierung, Makler, Bewertungen, offene Besichtigungen und Terminbuchung, Bewertungsanfrage, FAQ und Kontakt.',
    fr: 'Agence immobilière ville et littoral : annonces avec recherche, filtres, fourchettes de prix et de surface, tri, fiches détaillées, plans et brochures ; programmes neufs avec galerie de l’appartement témoin, guide des quartiers avec plan, financement, agents, avis, portes ouvertes et prise de rendez-vous, demande d’estimation, FAQ et contact.',
    es: 'Agencia inmobiliaria de ciudad y costa: anuncios con búsqueda, filtros, rangos de precio y superficie, orden, fichas, planos y folletos; obra nueva con galería del piso piloto, guía de barrios con mapa, financiación, agentes, opiniones, jornadas de puertas abiertas y reserva de visitas, solicitud de tasación, FAQ y contacto.',
    uk: 'Агентство нерухомості в місті й біля моря: каталог об’єктів із пошуком, фільтрами, діапазонами ціни й площі, сортуванням, картками, плануваннями й буклетами; новобудови з галереєю шоуруму, гід районами з картою, іпотека, агенти, відгуки, дні відчинених дверей і запис на перегляд, заявка на оцінку, FAQ і контакти.',
    ka: 'უძრავი ქონების სააგენტო ქალაქსა და ზღვისპირეთში: ობიექტების კატალოგი ძიებით, ფილტრებით, ფასისა და ფართის დიაპაზონებით, დალაგებით, დეტალებით, გეგმებითა და ბროშურებით; ახალი პროექტები სანიმუშო ბინის გალერეით, უბნების გზამკვლევი რუკით, იპოთეკა, აგენტები, შეფასებები, ღია კარის დღეები და ნახვის დაჯავშნა, შეფასების მოთხოვნა, FAQ და კონტაქტები.',
  },
  langs: ['en', 'ru', 'de'],
  build: tplBuildRealty,
};

/** Floor plans for the verification sheet: [[name, svg, png base64]]. */
function tplRealtyPlans() {
  const out = [];
  for (const k of Object.keys(TPL_RE_PLANS)) for (const [suf, plan] of TPL_RE_PLANS[k]()) out.push([k + '-' + suf, tplRePlanSVG(plan), tplRePlanPNG(plan)]);
  return out;
}

/** Preview list for the artwork sheet of the verification tools. */
function tplRealtyArtPreview() {
  const out = Object.keys(TPL_RE_COVERS).map((k) => [k, tplReCover(k)]);
  out.push(['city', tplReScene(1200, 900, tplReCitySpec(), { ...TPL_RE_STAGE, pad: 40, dy: 20 })]);
  out.push(['linden', tplReScene(1200, 900, tplReLindenSpec())]);
  out.push(['corran', tplReScene(1200, 900, tplReCorranSpec())]);
  out.push(['hlDusk', tplReScene(1200, 900, TPL_RE_COVERS.harbourLights({ dusk: true }), TPL_RE_DUSK)]);
  out.push(['living', tplReScene(900, 900, tplReLiving(), { ...TPL_RE_STAGE, pad: 60 })]);
  out.push(['kitchen', tplReScene(900, 900, tplReKitchen(), { ...TPL_RE_STAGE, pad: 60 })]);
  out.push(['bedroom', tplReScene(900, 900, tplReBedroom(), { ...TPL_RE_STAGE, pad: 60 })]);
  out.push(['terrace', tplReScene(900, 900, tplReTerrace(), { ...TPL_RE_STAGE, pad: 50 })]);
  out.push(['brand', tplReBrandSVG()]);
  out.push(['map', tplReMapSVG('avelin', TPL_RE_DISTRICT_PINS, { title: 'PORT AVELIN' })]);
  return out;
}

export {
  TPL_REALTY,
  TPL_RE_COVERS,
  TPL_RE_PAINT,
  tplReBrandSVG,
  tplReCitySpec,
  tplReCover,
  tplReMapSVG,
  tplRePlan,
  tplRePlanPNG,
  tplRePlanSVG,
  tplBuildRealty,
  tplRealtyArtPreview,
  tplRealtyPlans
};
