// carpet/compose.js - compositions: a stack of pattern layers (patterns.js) painted over the field (or the whole rug)
// in the rug's colour roles. Each layer has its own seed, transforms and blend, so structures cross each other into
// one design: a Mandelbrot set seen through an eightfold kaleidoscope inside a medallion, a Hilbert curve wrapped
// into rings, a maze clipped by a star, Truchet arcs outlined over an Islamic star tiling…
//
// Coordinates of a layer: (u, v) with the unit half the shorter side of the area, origin at its centre. Pipeline:
// map ('plane' | 'grid' — cols × rows cells, each cell its own [-1, 1] square, optionally staggered) → rotate →
// scale → symmetry ('none', 'mirrorX', 'mirrorY', 'mirrorXY', 'rot4', 'kaleido' with `fold` sectors) → offset →
// warp ('none' | 'polar' — angle across, radius along, `repeat` times around | 'tile' — a wallpaper group with
// tile size `tile`) → the pattern. Cells of a grid map can vary the colours ('shift', 'checker', 'random').
//
// Blends: 'over' (paint), 'under' (only the background roles), 'mask' (no paint; later layers only inside),
// 'maskOut' (later layers only outside), 'erase' (back to the background), 'invert' (a reciprocal role swap),
// 'outline' (the edges of the layer's shapes), 'halo' (a ring just outside them). `opacity` < 1 dithers the paint.
//
//   compactLayer(raw) -> only what differs from the defaults
//   normLayer(raw) -> layer          layer = { type, seed, params, roles: [role], blend, opacity, area: 'field' |
//                                    'rug', map, cols, rows, stagger, vary, x, y, rotate, scale, sym, fold, warp,
//                                    repeat, tile, group, on }
//   paintLayers(cells, W, H, rect, layers, { RI, motif, seed }) -> nothing (cells: palette indices, rect: the
//                                    field { x, y, w, h }; the whole rug for layers with area 'rug')
//   randomComposition(rng, { roles }) -> [layer]       a seeded mash-up of ornaments, fractals and abstractions
//   BLENDS, SYMS, MAPS, WARPS, VARY, INVERT

import { PATTERNS, PATTERN_IDS, normParams, defaultParams } from './patterns.js';
import { wallpaperFoldF, WALLPAPER } from './symmetry.js';
import { seededRandom } from '../prng/prng.js';

export const BLENDS = ['over', 'under', 'mask', 'maskOut', 'erase', 'invert', 'outline', 'halo'];
export const SYMS = ['none', 'mirrorX', 'mirrorY', 'mirrorXY', 'rot4', 'kaleido'];
export const MAPS = ['plane', 'grid'];
export const WARPS = ['none', 'polar', 'tile'];
export const VARY = ['none', 'shift', 'checker', 'random'];
const ROLE_NAMES = ['ground', 'field', 'border', 'guard', 'accent1', 'accent2', 'accent3', 'accent4', 'outline', 'light'];
// A reciprocal swap: every role and the one that answers it.
export const INVERT = { ground: 'light', light: 'ground', field: 'accent1', accent1: 'field', border: 'guard', guard: 'border', accent2: 'accent3', accent3: 'accent2', accent4: 'outline', outline: 'accent4' };
const MOTIF_ROLES = ['accent1', 'accent2', 'accent3', 'accent4', 'outline', 'light', 'ground', 'field', 'border'];

// num/one: every layer field is clamped or enumerated, because layers arrive from share codes and saved files.
const num = (v, a, b, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(a, Math.min(b, n)) : d; };
const one = (v, list, d) => (list.includes(v) ? v : d);

// Total function: any input (null, garbage, an old version's layer) yields a complete valid layer. Bounds are
// chosen for performance as much as taste (rows <= 36, fold <= 24, scale >= 0.05 keeps patterns from degenerating
// into per-knot noise).
export function normLayer(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const type = PATTERNS[r.type] ? r.type : 'medallion';
  const roles = (Array.isArray(r.roles) ? r.roles : []).filter((x) => ROLE_NAMES.includes(x)).slice(0, 12);
  return {
    type, seed: String(r.seed == null ? '' : r.seed).slice(0, 40), params: normParams(type, r.params || {}),
    roles: roles.length ? roles : type === 'motif' ? MOTIF_ROLES.slice() : ['accent1', 'accent2', 'accent3', 'outline'],
    blend: one(r.blend, BLENDS, 'over'), opacity: num(r.opacity, 0, 1, 1), area: one(r.area, ['field', 'rug'], 'field'),
    map: one(r.map, MAPS, 'plane'), cols: Math.round(num(r.cols, 1, 24, 3)), rows: Math.round(num(r.rows, 1, 36, 4)), stagger: num(r.stagger, 0, 1, 0), vary: one(r.vary, VARY, 'none'),
    x: num(r.x, -3, 3, 0), y: num(r.y, -3, 3, 0), rotate: num(r.rotate, -360, 360, 0), scale: num(r.scale, 0.05, 20, 1),
    sym: one(r.sym, SYMS, 'none'), fold: Math.round(num(r.fold, 2, 24, 8)), warp: one(r.warp, WARPS, 'none'), repeat: Math.round(num(r.repeat, 1, 24, 1)),
    tile: num(r.tile, 0.05, 4, 0.5), group: one(r.group, WALLPAPER, 'p4m'), on: r.on !== false,
  };
}

// The fields of a layer that differ from the defaults of its type (share codes stay short).
// Diff against the defaults of the same type, computed by normalizing an empty layer: no separate defaults table
// to keep in sync. JSON.stringify comparison handles array fields (roles).
export function compactLayer(raw) {
  const L = normLayer(raw), D = normLayer({ type: L.type });
  const out = { type: L.type };
  for (const k of Object.keys(L)) {
    if (k === 'type' || k === 'params') continue;
    if (JSON.stringify(L[k]) !== JSON.stringify(D[k])) out[k] = L[k];
  }
  const params = {};
  for (const [k, v] of Object.entries(L.params)) if (v !== D.params[k]) params[k] = v;
  if (Object.keys(params).length) out.params = params;
  return out;
}

// A layer's coordinate function: (u, v, s, t) -> writes [u', v', cell] into out and returns true, or false.
// Inverse mapping: for each knot the pipeline maps the knot's position INTO pattern space and samples the pattern
// there (the standard way to rasterize transforms without holes). Hence the rotation uses -angle, and the scale
// divides. Symmetries fold the plane onto a fundamental region: abs() is a mirror, rot4 rotates into one quadrant,
// kaleido folds the angle into a sector and mirrors within it (dihedral group of order 2*fold). The grid map gives
// each cell its own [-1,1] square and an id (row * 997 + col, 997 a prime larger than any column count) so
// patterns can vary per cell.
function transformer(L, aspect) {
  const ca = Math.cos((-L.rotate * Math.PI) / 180), sa = Math.sin((-L.rotate * Math.PI) / 180);
  const sector = (2 * Math.PI) / L.fold;
  return (u, v, s, t, out) => {
    let cell = 0;
    if (L.map === 'grid') {
      // s, t in [0, 1): the area fractions. Cells keep square units (the longer side of a cell stretches).
      const row = Math.floor(t * L.rows);
      const ss = s * L.cols + (row & 1 ? L.stagger : 0);
      const col = Math.floor(ss);
      const cw = aspect / L.cols, ch = 1 / L.rows; // cell size in area-height units
      let lu = (ss - col) * 2 - 1, lv = (t * L.rows - row) * 2 - 1;
      if (cw > ch) lu *= cw / ch; else lv *= ch / cw;
      u = lu; v = lv;
      cell = row * 997 + col;
      out[3] = col; out[4] = row;
    }
    if (L.rotate) { const a = u * ca - v * sa; v = u * sa + v * ca; u = a; }
    u /= L.scale; v /= L.scale;
    switch (L.sym) {
      case 'mirrorX': u = Math.abs(u); break;
      case 'mirrorY': v = Math.abs(v); break;
      case 'mirrorXY': u = Math.abs(u); v = Math.abs(v); break;
      case 'rot4': { for (let k = 0; k < 4 && !(u >= 0 && v > 0); k++) { const a = u; u = v; v = -a; } break; }
      case 'kaleido': {
        const r = Math.hypot(u, v);
        let a = Math.atan2(v, u) + Math.PI / 2;
        a = ((a % sector) + sector) % sector;
        if (a > sector / 2) a = sector - a;
        a -= Math.PI / 2;
        u = r * Math.cos(a); v = r * Math.sin(a);
        break;
      }
      default: break;
    }
    // The offset comes after the symmetry: a motif moved off the centre is repeated by it (around a kaleidoscope,
    // into the four corners of a grid cell with mirrorXY).
    u -= L.x; v -= L.y;
    if (L.warp === 'polar') {
      const r = Math.hypot(u, v);
      const a = Math.atan2(u, -v) / Math.PI; // 0 at the top, ±1 at the bottom
      u = (((a * L.repeat + 1) % 2) + 2) % 2 - 1; v = r * 2 - 1;
    } else if (L.warp === 'tile') {
      const [fu, fv] = wallpaperFoldF(L.group, u + 100 * L.tile, v + 100 * L.tile, L.tile, L.tile);
      u = (fu / L.tile) * 2 - 1; v = (fv / L.tile) * 2 - 1;
    }
    out[0] = u; out[1] = v; out[2] = cell;
    return true;
  };
}

// Integer hash (multiply-xorshift with large odd constants), deterministic per knot: used for opacity dithering and
// random per-cell colours. Math.imul keeps the arithmetic in 32 bits; >>> 0 makes it unsigned before normalizing.
const hash = (x, y, s) => { let h = Math.imul(x * 374761393 + y * 668265263 + s * 2246822519, 1274126177); h ^= h >>> 13; h = Math.imul(h, 1103515245); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

// Two passes per layer: sample the pattern level for every knot of the area (lv; negative = outside any shape),
// then apply the blend. Separating them lets 'outline' and 'halo' compare a knot with its 4-neighbours' levels.
// Each layer gets its own PRNG stream derived from (rug seed, layer index, layer seed): editing one layer never
// changes the randomness of the others. A mask persists for all FOLLOWING layers until the next mask layer.
// Opacity < 1 is ordered dithering by hash, not alpha: a knot is exactly one colour.
export function paintLayers(cells, W, H, field, layers, { RI, motif = () => null, motifIds = [], seed = 'rug' } = {}) {
  let mask = null, maskOut = false;
  const base = new Set([RI.ground, RI.field]);
  const byIdx = Object.keys(RI).sort((a, b) => RI[a] - RI[b]);
  layers.forEach((raw, li) => {
    const L = normLayer(raw);
    if (!L.on) return;
    const area = L.area === 'rug' ? { x: 0, y: 0, w: W, h: H } : field;
    if (area.w <= 0 || area.h <= 0) return;
    const rng = seededRandom(seed + '/layer/' + li + '/' + L.seed);
    const at = PATTERNS[L.type].make(L.params, { rng, motif, motifIds });
    const R = Math.min(area.w, area.h) / 2;
    const tr = transformer(L, area.w / area.h);
    const out = [0, 0, 0, 0, 0];
    const lv = new Int16Array(area.w * area.h);
    const vary = new Int16Array(area.w * area.h);
    const nRoles = L.roles.length;
    for (let y = 0; y < area.h; y++) {
      const v = (y + 0.5 - area.h / 2) / R, t = (y + 0.5) / area.h;
      for (let x = 0; x < area.w; x++) {
        const u = (x + 0.5 - area.w / 2) / R, s = (x + 0.5) / area.w;
        const i = y * area.w + x;
        tr(u, v, s, t, out);
        lv[i] = at(out[0], out[1], out[2]);
        if (L.vary !== 'none' && L.map === 'grid') vary[i] = L.vary === 'shift' ? out[3] + out[4] : L.vary === 'checker' ? (out[3] + out[4]) & 1 : Math.floor(hash(out[3], out[4], li) * nRoles);
      }
    }
    const roleOf = (level, i) => RI[L.roles[(((level + vary[i]) % nRoles) + nRoles) % nRoles]];
    const inside = (i, gx, gy) => (!mask ? true : maskOut ? !mask[gy * W + gx] : !!mask[gy * W + gx]);
    if (L.blend === 'mask' || L.blend === 'maskOut') {
      mask = new Uint8Array(W * H);
      for (let y = 0; y < area.h; y++) for (let x = 0; x < area.w; x++) if (lv[y * area.w + x] >= 0) mask[(area.y + y) * W + area.x + x] = 1;
      maskOut = L.blend === 'maskOut';
      return;
    }
    const dith = L.opacity < 1;
    const edge = (x, y) => {
      const c = lv[y * area.w + x];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        const n = xx < 0 || yy < 0 || xx >= area.w || yy >= area.h ? -1 : lv[yy * area.w + xx];
        if (n !== c) return n;
      }
      return null;
    };
    for (let y = 0; y < area.h; y++) for (let x = 0; x < area.w; x++) {
      const i = y * area.w + x, gx = area.x + x, gy = area.y + y, gi = gy * W + gx;
      if (!inside(i, gx, gy)) continue;
      if (dith && hash(gx, gy, li + 7) >= L.opacity) continue;
      const level = lv[i];
      switch (L.blend) {
        case 'over': if (level >= 0) cells[gi] = roleOf(level, i); break;
        case 'under': if (level >= 0 && base.has(cells[gi])) cells[gi] = roleOf(level, i); break;
        case 'erase': if (level >= 0) cells[gi] = RI.field; break;
        case 'invert': if (level >= 0) cells[gi] = RI[INVERT[byIdx[cells[gi]]] || 'light']; break;
        case 'outline': if (level >= 0 && edge(x, y) !== null) cells[gi] = RI[L.roles[0]]; break;
        case 'halo': if (level < 0) { const n = edge(x, y); if (n !== null && n >= 0) cells[gi] = RI[L.roles[0]]; } break;
        default: break;
      }
    }
  });
}

// --- seeded mash-ups ---
const pick = (rng, list) => list[rng.int(list.length)];
const between = (rng, a, b) => a + rng.next() * (b - a);
const ACCENTS = ['accent1', 'accent2', 'accent3', 'accent4', 'light', 'outline', 'ground'];

// Parameters drawn around the defaults so that every layer stays readable on a knot grid.
// Each numeric parameter has a 45% chance to stay at its default, otherwise moves within +-25% of the range around
// it: random but recognisable, since extreme values often make a pattern unreadable at knot resolution.
function randomParams(rng, type) {
  const p = defaultParams(type);
  const T = PATTERNS[type];
  for (const s of T.params) {
    const [k] = s;
    if (s.length === 3) { if (Array.isArray(s[1])) p[k] = pick(rng, s[1]); continue; }
    if (rng.chance(0.45)) continue;
    const [, min, max, step, def] = s;
    const span = (max - min) * 0.25;
    let v = Math.max(min, Math.min(max, def + (rng.next() * 2 - 1) * span));
    if (step >= 1) v = Math.round(v);
    p[k] = v;
  }
  return p;
}

// A fixed four-part recipe (ground structure, centrepiece through a kaleidoscope often clipped by a mask, small
// repeats, final outline) gives seeded mash-ups a rug-like hierarchy instead of a random pile of layers.
export function randomComposition(rng, { motifIds = [] } = {}) {
  const layers = [];
  const roles = (n) => rng.sample(ACCENTS, Math.min(n, ACCENTS.length));
  const sym = () => pick(rng, ['kaleido', 'kaleido', 'mirrorXY', 'rot4', 'mirrorX']);
  const fold = () => pick(rng, [4, 6, 8, 8, 10, 12, 16]);
  // 1. A ground structure over the whole field.
  const ground = pick(rng, ['girih', 'lattice', 'quasicrystal', 'truchet', 'checks', 'stripes', 'bands', 'voronoi', 'interference', 'noise']);
  layers.push({ type: ground, seed: 'g', params: randomParams(rng, ground), roles: roles(4), blend: 'over', sym: rng.chance(0.6) ? 'mirrorXY' : 'none', warp: rng.chance(0.25) ? 'tile' : 'none', group: pick(rng, ['p4m', 'cmm', 'pmm', 'p4g']), tile: between(rng, 0.25, 0.7), opacity: rng.chance(0.2) ? 0.7 : 1 });
  // 2. A centrepiece: an ornament or a fractal through a kaleidoscope, often inside a mask.
  const shape = pick(rng, ['medallion', 'star', 'rosette', 'rings', 'whirl', 'sunburst']);
  const useMask = rng.chance(0.55);
  const shapeP = { ...randomParams(rng, shape), size: between(rng, 0.55, 0.95) };
  if (useMask) layers.push({ type: shape, seed: 'm', params: shapeP, blend: 'mask' });
  const fractal = pick(rng, ['mandelbrot', 'julia', 'newton', 'sierpinski', 'vicsek', 'hilbert', 'dragon', 'koch', 'lsystem', 'automaton', 'maze', 'spiral', 'reaction', 'pythagoras', 'htree', 'triangle']);
  const fp = randomParams(rng, fractal);
  if (fractal === 'reaction') fp.grid = 96;
  layers.push({ type: fractal, seed: 'f', params: fp, roles: roles(5), blend: 'over', sym: sym(), fold: fold(), scale: between(rng, 0.7, 1.3), warp: rng.chance(0.2) ? 'polar' : 'none', repeat: pick(rng, [1, 2, 3, 4, 6]) });
  if (useMask) layers.push({ type: shape, seed: 'mo', params: { ...shapeP, bands: 1 }, roles: [pick(rng, ['outline', 'light'])], blend: 'outline', rotate: 0 });
  else layers.push({ type: shape, seed: 'c', params: shapeP, roles: roles(4), blend: rng.chance(0.5) ? 'over' : 'invert', sym: 'none' });
  // 3. A grid of small things, or corner pieces.
  if (rng.chance(0.55)) {
    const small = pick(rng, motifIds.length && rng.chance(0.6) ? ['motif'] : ['star', 'rosette', 'whirl', 'sierpinski', 'koch', 'rings']);
    const sp = randomParams(rng, small);
    if (small === 'motif') sp.motif = pick(rng, motifIds);
    if ('size' in sp) sp.size = between(rng, 0.45, 0.8);
    if (small === 'motif') sp.scale = between(rng, 0.45, 0.8);
    layers.push({ type: small, seed: 's', params: sp, roles: small === 'motif' ? undefined : roles(3), blend: rng.chance(0.3) ? 'under' : 'over', map: 'grid', cols: pick(rng, [1, 2, 2, 3]), rows: pick(rng, [2, 3, 4, 5]), stagger: rng.chance(0.3) ? 0.5 : 0, vary: pick(rng, ['none', 'shift', 'checker']) });
  }
  // 4. A final accent: outlines of a geometric structure or a halo.
  if (rng.chance(0.5)) {
    const top = pick(rng, ['girih', 'lattice', 'rings', 'spiral', 'moire']);
    layers.push({ type: top, seed: 't', params: randomParams(rng, top), roles: [pick(rng, ['outline', 'light', 'accent4'])], blend: pick(rng, ['outline', 'halo', 'outline']), sym: 'mirrorXY' });
  }
  return layers.map(normLayer);
}

export { PATTERN_IDS };
