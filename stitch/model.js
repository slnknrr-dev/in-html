// stitch/model.js - the embroidery scheme (chart) model: a grid of cells on a fabric with full crosses, fractional
// stitches (half, quarter, three-quarter, petite), backstitch / straight-stitch lines, French knots and beads, in
// layers, over a palette of threads (single threads, blends of several threads in one needle, beads).
//
// scheme = {
//   format: 'in-html-stitch', version: 1, id,
//   meta: { title, designer, description, category, tags: [], difficulty (0 = auto, 1..5), license, notes,
//           source, created, updated, lang },
//   width, height,                                   cells (stitches)
//   fabric: { kind: 'aida' | 'evenweave' | 'linen' | 'canvas' | 'rug', count (stitches per inch), countY, over
//             (fabric threads per stitch: 1 aida, 2 evenweave), color: '#rrggbb', name },
//   palette: [entry],                                stitches reference palette entries by index (p)
//     entry = { id, catalog ('dmc', 'anchor', … or '' for a custom colour), brand, code, name, hex, symbol (symbol
//               id, see symbols.js), strands (cross stitch), bsStrands (lines), kind: 'thread' | 'bead' | 'metallic',
//               blend?: [{ catalog, brand, code, name, hex, strands }] (several threads in one needle) }
//   layers: [layer],                                 drawn bottom to top
//     layer = { id, name, visible, locked,
//               cells: Uint16Array(width × height)    full crosses: palette index + 1, 0 = empty
//               parts: [{ x, y, k, c, p }]           k: 'half' (c: '/' | '\\'), 'quarter' | 'three' | 'petite'
//                                                     (c: 'tl' | 'tr' | 'bl' | 'br')
//               lines: [{ x1, y1, x2, y2, p, k }]     cell units on the grid of half cells (0.5 steps);
//                                                     k: 'back' | 'straight'
//               knots: [{ x, y, p }]                  French knots, half-cell positions
//               beads: [{ x, y, p }] }                beads, half-cell positions (cell centre = x + 0.5)
// }
//
// A three-quarter stitch at corner c is a half stitch on the diagonal that does not touch c plus a quarter stitch
// from c to the centre: it covers the triangle of the cell on c's side. A quarter covers the corner quarter, a
// petite is a small cross in it.
//
// API: createScheme(opts), cloneScheme, normScheme(raw) (never throws), toJSON(scheme) / fromJSON(text|obj),
// encodeCells / decodeCells (run-length text), cellAt / setCell, partsAt, addPart, removeParts, flatten(scheme),
// usage(scheme) (stitch counts per palette entry and kind), bounds, crop / resizeCanvas / shift, transform (flip /
// rotate the whole scheme), addPaletteEntry, removePalette / mergePalette / replacePalette / compactPalette /
// sortPalette, threadEntry(thread), blendEntry(threads), entryColor, entryLabel, newId.

//
// Design rules of this module:
// - Plain data, no classes: a scheme survives structuredClone, postMessage and JSON (after toJSON) unchanged, and every
//   consumer (renderer, PDF, OXS, editor) reads the same fields. Methods on a prototype would be lost on each of those.
// - Trust boundary = normScheme. Everything from a file, URL or storage passes it; it clamps every number, drops every
//   out-of-range stitch and never throws. Code past it may assume the invariants (indices < palette.length,
//   coordinates in range) and stays branch-free in hot loops. fromJSON is the one entry that throws (not JSON / wrong
//   format), so an importer can fall through to the next format.
// - Full crosses are a dense Uint16Array (0 = empty, palette index + 1): a 2000 x 2000 chart is 8 MB with O(1) access;
//   fractional stitches, lines, knots and beads are sparse lists because real charts have few of them.
// - Mutation policy: palette operations and setCell mutate in place (the editor snapshots for undo first);
//   resizeCanvas / transform return a new top-level object but share untouched parts (palette, meta) with the input.
import { hexToRgb, mixColors, rgbToHex } from './threads.js';

export const FORMAT = 'in-html-stitch';
export const VERSION = 1;
export const CORNERS = ['tl', 'tr', 'bl', 'br'];
export const PART_KINDS = ['half', 'quarter', 'three', 'petite'];
export const FABRICS = ['aida', 'evenweave', 'linen', 'canvas', 'rug'];
export const MAX_SIDE = 2000;

// Ids: last 5 base-36 digits of the clock + 4 random digits (1679616 = 36^4) + a wrapping sequence. Unique enough for
// palette / layer keys inside one scheme (normScheme re-ids duplicates anyway); not a UUID, not for security.
let idSeq = 0;
export function newId(prefix = 'id') {
  idSeq = (idSeq + 1) % 1679616;
  const r = Math.floor(Math.random() * 1679616);
  return prefix + Date.now().toString(36).slice(-5) + r.toString(36).padStart(4, '0') + idSeq.toString(36);
}

// Clamping coercers: each returns a valid value or the default d, never NaN. half() snaps to the half-cell grid
// on which lines, knots and beads live.
const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const half = (v) => Math.round(Number(v) * 2) / 2;
const HEX_RE = /^#[0-9a-f]{6}$/i;
// Accepts '#rrggbb' or 'rrggbb' in any case and stores lowercase with '#'. A 3-digit '#rgb' falls back to d: the
// format always writes 6 digits, so a short form means a foreign or broken file.
const hex = (v, d) => (typeof v === 'string' && HEX_RE.test(v) ? v.toLowerCase() : typeof v === 'string' && /^#?[0-9a-f]{6}$/i.test(v) ? '#' + v.replace('#', '').toLowerCase() : d);

export function emptyLayer(width, height, name = 'Layer 1') {
  return { id: newId('l'), name, visible: true, locked: false, cells: new Uint16Array(width * height), parts: [], lines: [], knots: [], beads: [] };
}

// Goes through normScheme as well: one code path builds every scheme, so a new field cannot be defaulted here and
// forgotten in the loader.
export function createScheme({ width = 50, height = 50, title = '', palette = [], fabric = {}, meta = {} } = {}) {
  width = int(width, 1, MAX_SIDE, 50);
  height = int(height, 1, MAX_SIDE, 50);
  const now = new Date().toISOString();
  return normScheme({
    format: FORMAT, version: VERSION, id: newId('s'),
    meta: { title, created: now, updated: now, ...meta },
    width, height,
    fabric: { kind: 'aida', count: 14, color: '#ffffff', ...fabric },
    palette,
    layers: [emptyLayer(width, height)],
  });
}

// --- palette entries ---------------------------------------------------------------------------------------------

export function threadEntry(t, extra = {}) {
  return { id: newId('c'), catalog: t.catalog || '', brand: t.brand || '', code: t.code || '', name: t.name || '', hex: t.hex, symbol: '', strands: 2, bsStrands: 1, kind: 'thread', ...extra };
}

// Blend colour is mixed in linear light (threads.js mixColors), not by averaging hex: strands side by side reflect
// light additively, and averaging gamma-encoded values makes every blend too dark. strands = number of threads.
export function blendEntry(threads, extra = {}) {
  const rgb = mixColors(threads.map((t) => t.rgb || hexToRgb(t.hex)));
  return {
    id: newId('c'), catalog: threads[0].catalog || '', brand: threads[0].brand || '', code: threads.map((t) => t.code).join('+'),
    name: threads.map((t) => t.name).join(' + '), hex: rgbToHex(rgb), symbol: '', strands: threads.length, bsStrands: 1, kind: 'thread',
    blend: threads.map((t) => ({ catalog: t.catalog || '', brand: t.brand || '', code: t.code, name: t.name, hex: t.hex, strands: 1 })),
    ...extra,
  };
}

export const entryColor = (e) => (e && e.hex) || '#888888';
// "DMC 310", "DMC 310 + 321", "Bead", custom colours by their hex.
export function entryLabel(e) {
  if (!e) return '';
  if (e.blend && e.blend.length) return (e.brand ? e.brand + ' ' : '') + e.blend.map((b) => b.code).join(' + ');
  if (e.code) return (e.brand ? e.brand + ' ' : '') + e.code;
  return e.name || e.hex;
}

// One palette entry from untrusted input. String lengths are capped (a hostile file cannot bloat memory through
// names); a blend needs at least 2 parts (one is not a blend) and keeps at most 4 (more do not fit one needle).
function normEntry(raw, i) {
  const e = raw && typeof raw === 'object' ? raw : {};
  const out = {
    id: str(e.id, 40) || 'c' + i, catalog: str(e.catalog, 20).toLowerCase(), brand: str(e.brand, 40), code: str(e.code, 40), name: str(e.name, 120),
    hex: hex(e.hex, '#888888'), symbol: str(e.symbol, 40), strands: int(e.strands, 1, 12, 2), bsStrands: int(e.bsStrands, 1, 12, 1),
    kind: ['thread', 'bead', 'metallic'].includes(e.kind) ? e.kind : 'thread',
  };
  if (Array.isArray(e.blend) && e.blend.length >= 2) {
    out.blend = e.blend.slice(0, 4).map((b) => ({ catalog: str(b && b.catalog, 20).toLowerCase(), brand: str(b && b.brand, 40), code: str(b && b.code, 40), name: str(b && b.name, 120), hex: hex(b && b.hex, '#888888'), strands: int(b && b.strands, 1, 6, 1) }));
  }
  if (e.bead && typeof e.bead === 'object') out.bead = { size: num(e.bead.size, 0.5, 10, 2.5), count: int(e.bead.count, 1, 100000, 1) };
  return out;
}

// --- cells: run-length text ----------------------------------------------------------------------------------------
// "value" or "count*value" items (base 36) separated by commas: "a*0,3*2,1,1".

// Why RLE text, not base64 of the bytes: charts are mostly long runs of empty cells or one colour, so runs compress
// far better, the result is JSON-safe ASCII, and it diffs readably in version control.
export function encodeCells(cells) {
  const out = [];
  let i = 0;
  const n = cells.length;
  while (i < n) {
    const v = cells[i];
    let j = i + 1;
    while (j < n && cells[j] === v) j++;
    const run = j - i;
    out.push(run > 1 ? run.toString(36) + '*' + v.toString(36) : v.toString(36));
    i = j;
  }
  return out.join(',');
}

// Tolerant: bad items are skipped, overflow beyond size is cut, values are capped to Uint16, a short text leaves the
// tail empty. A skipped item does not advance pos, so corruption shifts later cells; acceptable for a recovery path,
// throwing instead would lose the whole chart.
export function decodeCells(text, size) {
  const cells = new Uint16Array(size);
  if (typeof text !== 'string' || !text) return cells;
  let pos = 0;
  for (const item of text.split(',')) {
    const star = item.indexOf('*');
    const run = star < 0 ? 1 : parseInt(item.slice(0, star), 36);
    const v = parseInt(star < 0 ? item : item.slice(star + 1), 36);
    if (!(run > 0) || !(v >= 0)) continue;
    const end = Math.min(size, pos + run);
    cells.fill(Math.min(v, 65535), pos, end);
    pos = end;
    if (pos >= size) break;
  }
  return cells;
}

// --- normalization -------------------------------------------------------------------------------------------------

// cells may arrive as Uint16Array (live object), RLE string (JSON) or plain array (hand-written data).
// Note: a Uint16Array of the right length is reused, not copied, and the out-of-palette loop below zeroes values in
// place, so the caller's array is modified. Fine for the internal callers, which hand over ownership.
// Coordinate rules: parts address cells (0..w-1); lines, knots and beads address grid points (0..w inclusive), hence
// the different range checks. A zero-length line is dropped: it draws nothing but would still count as thread.
function normLayer(raw, w, h, np, i) {
  const l = raw && typeof raw === 'object' ? raw : {};
  const size = w * h;
  let cells;
  if (l.cells instanceof Uint16Array && l.cells.length === size) cells = l.cells;
  else if (typeof l.cells === 'string') cells = decodeCells(l.cells, size);
  else if (Array.isArray(l.cells) || ArrayBuffer.isView(l.cells)) { cells = new Uint16Array(size); for (let k = 0; k < Math.min(size, l.cells.length); k++) cells[k] = int(l.cells[k], 0, 65535, 0); }
  else cells = new Uint16Array(size);
  for (let k = 0; k < size; k++) if (cells[k] > np) cells[k] = 0;
  const okP = (p) => Number.isInteger(p) && p >= 0 && p < np;
  const inX = (x) => x >= 0 && x <= w, inY = (y) => y >= 0 && y <= h;
  const parts = [];
  for (const p of Array.isArray(l.parts) ? l.parts : []) {
    if (!p || !PART_KINDS.includes(p.k)) continue;
    const x = int(p.x, -1, w, -1), y = int(p.y, -1, h, -1), pi = int(p.p, -1, np, -1);
    if (x < 0 || y < 0 || x >= w || y >= h || !okP(pi)) continue;
    const c = p.k === 'half' ? (p.c === '\\' ? '\\' : '/') : CORNERS.includes(p.c) ? p.c : 'tl';
    parts.push({ x, y, k: p.k, c, p: pi });
  }
  const lines = [];
  for (const s of Array.isArray(l.lines) ? l.lines : []) {
    if (!s) continue;
    const q = { x1: half(s.x1), y1: half(s.y1), x2: half(s.x2), y2: half(s.y2), p: int(s.p, -1, np, -1), k: s.k === 'straight' ? 'straight' : 'back' };
    if (!okP(q.p) || ![q.x1, q.x2].every(inX) || ![q.y1, q.y2].every(inY) || (q.x1 === q.x2 && q.y1 === q.y2)) continue;
    lines.push(q);
  }
  const pts = (arr) => (Array.isArray(arr) ? arr : []).map((o) => o && { x: half(o.x), y: half(o.y), p: int(o.p, -1, np, -1) }).filter((o) => o && okP(o.p) && inX(o.x) && inY(o.y));
  return {
    id: str(l.id, 40) || 'l' + i, name: str(l.name, 80) || 'Layer ' + (i + 1), visible: l.visible !== false, locked: !!l.locked,
    cells, parts, lines, knots: pts(l.knots), beads: pts(l.beads),
  };
}

// The trust boundary (see module header). Limits: side <= MAX_SIDE, palette <= 1000, layers <= 64, at least one
// layer. Duplicate palette ids are renamed so ids can key UI state. over defaults to 2 on evenweave / linen (a stitch
// over two fabric threads is the norm there) and 1 elsewhere; countY defaults to count (square cells).
export function normScheme(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const width = int(s.width, 1, MAX_SIDE, 50), height = int(s.height, 1, MAX_SIDE, 50);
  const m = s.meta && typeof s.meta === 'object' ? s.meta : {};
  const f = s.fabric && typeof s.fabric === 'object' ? s.fabric : {};
  const palette = (Array.isArray(s.palette) ? s.palette : []).slice(0, 1000).map(normEntry);
  const ids = new Set();
  for (const e of palette) { while (ids.has(e.id)) e.id = newId('c'); ids.add(e.id); }
  const layersRaw = Array.isArray(s.layers) && s.layers.length ? s.layers.slice(0, 64) : [{}];
  const kind = FABRICS.includes(f.kind) ? f.kind : 'aida';
  const count = num(f.count, 2, 60, 14);
  return {
    format: FORMAT, version: VERSION, id: str(s.id, 60) || newId('s'),
    meta: {
      title: str(m.title, 200), designer: str(m.designer, 120), description: str(m.description, 8000), category: str(m.category, 60),
      tags: (Array.isArray(m.tags) ? m.tags : typeof m.tags === 'string' ? m.tags.split(',') : []).map((x) => str(x, 40).trim()).filter(Boolean).slice(0, 30),
      difficulty: int(m.difficulty, 0, 5, 0), license: str(m.license, 200), notes: str(m.notes, 8000), source: str(m.source, 400),
      created: str(m.created, 40), updated: str(m.updated, 40), lang: str(m.lang, 20),
    },
    width, height,
    fabric: { kind, count, countY: num(f.countY, 2, 60, count), over: int(f.over, 1, 4, kind === 'evenweave' || kind === 'linen' ? 2 : 1), color: hex(f.color, '#ffffff'), name: str(f.name, 80) },
    palette,
    layers: layersRaw.map((l, i) => normLayer(l, width, height, palette.length, i)),
  };
}

// Deep copy of exactly the mutable parts (cells, stitch lists, palette, blends, tags), shallow elsewhere. Cheaper
// than structuredClone for undo snapshots and keeps typed arrays typed.
export function cloneScheme(s) {
  return {
    ...s, meta: { ...s.meta, tags: [...s.meta.tags] }, fabric: { ...s.fabric },
    palette: s.palette.map((e) => ({ ...e, ...(e.blend ? { blend: e.blend.map((b) => ({ ...b })) } : {}) })),
    layers: s.layers.map((l) => ({ ...l, cells: l.cells.slice(), parts: l.parts.map((p) => ({ ...p })), lines: l.lines.map((p) => ({ ...p })), knots: l.knots.map((p) => ({ ...p })), beads: l.beads.map((p) => ({ ...p })) })),
  };
}

// pretty indents by 1, not 2: large charts stay smaller while remaining diffable.
export function toJSON(s, { pretty = false } = {}) {
  const out = { ...s, layers: s.layers.map((l) => ({ ...l, cells: encodeCells(l.cells) })) };
  return JSON.stringify(out, null, pretty ? 1 : 0);
}

// A missing format field is accepted (older or hand-made files); a different one is rejected so the importer can
// try OXS or image detection next.
export function fromJSON(input) {
  const raw = typeof input === 'string' ? JSON.parse(input) : input;
  if (!raw || typeof raw !== 'object' || (raw.format && raw.format !== FORMAT)) throw new Error('not a scheme');
  return normScheme(raw);
}

// --- cells and parts ---------------------------------------------------------------------------------------------

export const inside = (s, x, y) => x >= 0 && y >= 0 && x < s.width && y < s.height;
export const layerOf = (s, i) => s.layers[i == null ? s.layers.length - 1 : i];

// Palette index of the full cross at (x, y) in a layer (-1 = none).
export function cellAt(s, x, y, li = 0) {
  if (!inside(s, x, y)) return -1;
  return s.layers[li].cells[y * s.width + x] - 1;
}

export function setCell(s, x, y, p, li = 0) {
  if (!inside(s, x, y)) return false;
  const cells = s.layers[li].cells;
  const i = y * s.width + x, v = p < 0 ? 0 : p + 1;
  if (cells[i] === v) return false;
  cells[i] = v;
  return true;
}

// Linear scan; parts are sparse, and a per-cell index would need upkeep on every edit.
export const partsAt = (layer, x, y) => layer.parts.filter((p) => p.x === x && p.y === y);

export const opposite = (c) => ({ tl: 'br', br: 'tl', tr: 'bl', bl: 'tr' }[c]);

// Do two fractional stitches of one cell overlap? A half fills the cell; a three-quarter fills the triangle on its
// corner's side, so it shares the cell only with stitches in the opposite corner; quarters and petites share it
// unless they sit in the same corner.
export function partsConflict(a, b) {
  if (a.x !== b.x || a.y !== b.y) return false;
  if (a.k === 'half' || b.k === 'half') return true;
  if (a.k === 'three' && b.k === 'three') return b.c !== opposite(a.c);
  if (a.k === 'three' || b.k === 'three') { const t = a.k === 'three' ? a.c : b.c, q = a.k === 'three' ? b.c : a.c; return q !== opposite(t); }
  return a.c === b.c;
}

// Adds a fractional stitch; the stitches of the cell it overlaps are replaced.
// Copies only the known fields, so stray properties from callers (UI flags) never reach the saved file.
export function addPart(layer, part) {
  layer.parts = layer.parts.filter((q) => !partsConflict(q, part));
  layer.parts.push({ x: part.x, y: part.y, k: part.k, c: part.c, p: part.p });
}

export function removeParts(layer, x, y, pred = () => true) {
  const n = layer.parts.length;
  layer.parts = layer.parts.filter((q) => !(q.x === x && q.y === y && pred(q)));
  return n - layer.parts.length;
}

// The visible scheme as one layer (top layers win in each cell; lines, knots and beads accumulate).
// Per cell the topmost layer with anything there wins: a full cross above clears parts below (parts.delete), parts
// above clear a full cross below. Parts of one cell from several layers combine through addPart, so the overlap
// rule is the one used in editing. A part over a full cross of its own layer is hidden (the cross covers it).
// Lines, knots and beads accumulate: they lie on top of the fabric, not in a cell.
export function flatten(s, { onlyVisible = true } = {}) {
  const out = emptyLayer(s.width, s.height, 'Flat');
  const parts = new Map();
  for (const l of s.layers) {
    if (onlyVisible && !l.visible) continue;
    const c = l.cells;
    for (let i = 0; i < c.length; i++) if (c[i]) { out.cells[i] = c[i]; parts.delete(i); }
    for (const p of l.parts) {
      const i = p.y * s.width + p.x;
      if (c[i]) continue;
      if (out.cells[i]) out.cells[i] = 0;
      const list = parts.get(i) || [];
      const tmp = { parts: list };
      addPart(tmp, p);
      parts.set(i, tmp.parts);
    }
    out.lines.push(...l.lines.map((q) => ({ ...q })));
    out.knots.push(...l.knots.map((q) => ({ ...q })));
    out.beads.push(...l.beads.map((q) => ({ ...q })));
  }
  for (const list of parts.values()) out.parts.push(...list);
  return out;
}

// Stitch counts per palette entry: [{ full, half, quarter, three, petite, back (length in cells), straight
// (length), knots, beads, total (cross-stitch equivalents) }].
// total weighs fractional stitches by covered area so thread estimates work in cross-stitch equivalents.
// backCount counts back AND straight segments (each needs start / end tails in estimate.js), despite its name.
export function usage(s, layer = flatten(s)) {
  const u = s.palette.map(() => ({ full: 0, half: 0, quarter: 0, three: 0, petite: 0, back: 0, straight: 0, backCount: 0, knots: 0, beads: 0, total: 0 }));
  const c = layer.cells;
  for (let i = 0; i < c.length; i++) if (c[i]) u[c[i] - 1].full++;
  for (const p of layer.parts) u[p.p][p.k]++;
  for (const q of layer.lines) { const len = Math.hypot(q.x2 - q.x1, q.y2 - q.y1); u[q.p][q.k === 'straight' ? 'straight' : 'back'] += len; u[q.p].backCount++; }
  for (const k of layer.knots) u[k.p].knots++;
  for (const b of layer.beads) u[b.p].beads++;
  for (const x of u) x.total = x.full + x.half / 2 + x.quarter / 4 + x.three * 0.75 + x.petite / 4;
  return u;
}

// Bounding box of everything stitched: { x0, y0, x1, y1 } (exclusive ends) or null.
export function bounds(s, layer = flatten(s)) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const w = s.width;
  const c = layer.cells;
  for (let i = 0; i < c.length; i++) if (c[i]) { const x = i % w, y = (i / w) | 0; if (x < x0) x0 = x; if (x + 1 > x1) x1 = x + 1; if (y < y0) y0 = y; if (y + 1 > y1) y1 = y + 1; }
  const pt = (x, y) => { x0 = Math.min(x0, Math.floor(x)); y0 = Math.min(y0, Math.floor(y)); x1 = Math.max(x1, Math.ceil(x)); y1 = Math.max(y1, Math.ceil(y)); };
  for (const p of layer.parts) pt(p.x, p.y), pt(p.x + 1, p.y + 1);
  for (const q of layer.lines) pt(q.x1, q.y1), pt(q.x2, q.y2);
  for (const k of [...layer.knots, ...layer.beads]) pt(k.x, k.y);
  return x0 === Infinity ? null : { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(s.width, x1), y1: Math.min(s.height, y1) };
}

// --- geometry of the whole scheme ----------------------------------------------------------------------------------

// New canvas size with the content moved by (dx, dy); what falls outside is cut.
// Shared by crop, canvas resize and shift: one implementation of the clipping rules. Palette, meta and fabric are
// shared with the input (shallow spread); only layers are new.
export function resizeCanvas(s, width, height, dx = 0, dy = 0) {
  width = int(width, 1, MAX_SIDE, s.width);
  height = int(height, 1, MAX_SIDE, s.height);
  const out = { ...s, width, height };
  const inX = (x) => x >= 0 && x <= width, inY = (y) => y >= 0 && y <= height;
  out.layers = s.layers.map((l) => {
    const cells = new Uint16Array(width * height);
    for (let y = 0; y < s.height; y++) {
      const ny = y + dy;
      if (ny < 0 || ny >= height) continue;
      for (let x = 0; x < s.width; x++) {
        const nx = x + dx;
        if (nx < 0 || nx >= width) continue;
        cells[ny * width + nx] = l.cells[y * s.width + x];
      }
    }
    return {
      ...l, cells,
      parts: l.parts.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })).filter((p) => p.x >= 0 && p.y >= 0 && p.x < width && p.y < height),
      lines: l.lines.map((q) => ({ ...q, x1: q.x1 + dx, x2: q.x2 + dx, y1: q.y1 + dy, y2: q.y2 + dy })).filter((q) => inX(q.x1) && inX(q.x2) && inY(q.y1) && inY(q.y2)),
      knots: l.knots.map((k) => ({ ...k, x: k.x + dx, y: k.y + dy })).filter((k) => inX(k.x) && inY(k.y)),
      beads: l.beads.map((k) => ({ ...k, x: k.x + dx, y: k.y + dy })).filter((k) => inX(k.x) && inY(k.y)),
    };
  });
  return out;
}

export const crop = (s, { x0, y0, x1, y1 }) => resizeCanvas(s, x1 - x0, y1 - y0, -x0, -y0);

// Corner after a transform of a cell: mirror x, mirror y, rotate 90° clockwise.
const CORNER_FX = { tl: 'tr', tr: 'tl', bl: 'br', br: 'bl' };
const CORNER_FY = { tl: 'bl', bl: 'tl', tr: 'br', br: 'tr' };
const CORNER_R = { tl: 'tr', tr: 'br', br: 'bl', bl: 'tl' };
// A half stitch's diagonal flips under every mirror and every quarter turn; r180 keeps it (a line rotated by 180
// degrees has the same direction).
export function mapPart(p, op) {
  const swap = (c) => (c === '/' ? '\\' : '/');
  if (p.k === 'half') return op === 'r90' || op === 'r270' || op === 'fx' || op === 'fy' ? swap(p.c) : p.c;
  if (op === 'fx') return CORNER_FX[p.c];
  if (op === 'fy') return CORNER_FY[p.c];
  if (op === 'r90') return CORNER_R[p.c];
  if (op === 'r180') return CORNER_R[CORNER_R[p.c]];
  if (op === 'r270') return CORNER_R[CORNER_R[CORNER_R[p.c]]];
  return p.c;
}

// Transforms a rectangle of content: op 'fx' (mirror left-right), 'fy' (top-bottom), 'r90', 'r180', 'r270'.
// Point mapping in cell units for a box of size (w, h): returns [fn(x, y) -> [x, y], newW, newH].
export function pointMap(op, w, h) {
  switch (op) {
    case 'fx': return [(x, y) => [w - x, y], w, h];
    case 'fy': return [(x, y) => [x, h - y], w, h];
    case 'r90': return [(x, y) => [h - y, x], h, w];
    case 'r180': return [(x, y) => [w - x, h - y], w, h];
    case 'r270': return [(x, y) => [y, w - x], h, w];
    default: return [(x, y) => [x, y], w, h];
  }
}

// Cells map through their centre (x + 0.5): mapping the top-left corner would shift every cell by one under mirrors
// (corner x maps to w - x, the right edge of the mirrored cell). Lines and points sit on grid points, map directly.
export function transform(s, op) {
  const [pm, W, H] = pointMap(op, s.width, s.height);
  const out = { ...s, width: W, height: H };
  out.layers = s.layers.map((l) => {
    const cells = new Uint16Array(W * H);
    for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
      const v = l.cells[y * s.width + x];
      if (!v) continue;
      const [a, b] = pm(x + 0.5, y + 0.5);
      cells[Math.floor(b) * W + Math.floor(a)] = v;
    }
    const cellOf = (p) => { const [a, b] = pm(p.x + 0.5, p.y + 0.5); return [Math.floor(a), Math.floor(b)]; };
    return {
      ...l, cells,
      parts: l.parts.map((p) => { const [x, y] = cellOf(p); return { ...p, x, y, c: mapPart(p, op) }; }),
      lines: l.lines.map((q) => { const [a, b] = pm(q.x1, q.y1), [c, d] = pm(q.x2, q.y2); return { ...q, x1: a, y1: b, x2: c, y2: d }; }),
      knots: l.knots.map((k) => { const [a, b] = pm(k.x, k.y); return { ...k, x: a, y: b }; }),
      beads: l.beads.map((k) => { const [a, b] = pm(k.x, k.y); return { ...k, x: a, y: b }; }),
    };
  });
  return out;
}

// --- palette operations --------------------------------------------------------------------------------------------

// Rewrites every stitch through map[oldIndex] -> newIndex (-1 removes the stitch); the palette is replaced.
// The single primitive behind remove / merge / compact / sort: one pass over every stitch kind, so no palette
// operation can forget one. Mutates s.
export function remapPalette(s, map, palette) {
  for (const l of s.layers) {
    const c = l.cells;
    for (let i = 0; i < c.length; i++) if (c[i]) { const n = map[c[i] - 1]; c[i] = n < 0 ? 0 : n + 1; }
    const keep = (o) => { const n = map[o.p]; if (n < 0) return false; o.p = n; return true; };
    l.parts = l.parts.filter(keep);
    l.lines = l.lines.filter(keep);
    l.knots = l.knots.filter(keep);
    l.beads = l.beads.filter(keep);
  }
  s.palette = palette;
  return s;
}

export function addPaletteEntry(s, entry) {
  s.palette.push(normEntry(entry, s.palette.length));
  return s.palette.length - 1;
}

// Removes entry i and every stitch in it.
export function removePalette(s, i) {
  const map = s.palette.map((_, k) => (k === i ? -1 : k < i ? k : k - 1));
  return remapPalette(s, map, s.palette.filter((_, k) => k !== i));
}

// Stitches of entry `from` take entry `into`; `from` is removed.
export function mergePalette(s, from, into) {
  if (from === into) return s;
  const map = s.palette.map((_, k) => { const t = k === from ? into : k; return t > from ? t - 1 : t; });
  return remapPalette(s, map, s.palette.filter((_, k) => k !== from));
}

// Entry i becomes another thread (stitches stay, the symbol stays).
export function replacePalette(s, i, entry) {
  s.palette[i] = { ...normEntry({ ...entry, symbol: entry.symbol || s.palette[i].symbol }, i), id: s.palette[i].id };
  return s;
}

// Drops entries without stitches.
export function compactPalette(s) {
  const u = usage(s);
  const used = s.palette.map((_, i) => u[i].total + u[i].back + u[i].straight + u[i].knots + u[i].beads > 0);
  let n = 0;
  const map = used.map((x) => (x ? n++ : -1));
  return remapPalette(s, map, s.palette.filter((_, i) => used[i]));
}

// Sorts the palette: 'count' (most stitches first), 'code' (brand numbers), 'hue', 'light'.
// light: Rec. 709 luma weights on gamma-encoded sRGB (not true luminance); good enough for ordering.
// hue: near-greys (chroma < 0.08) sort after every hue (400 + lightness) instead of scattering among the reds.
// code: numeric codes by number, White / B5200 / Ecru before 1, other non-numeric codes last.
// Ties rely on Array#sort being stable (guaranteed since ES2019).
export function sortPalette(s, by = 'count') {
  const u = usage(s);
  const idx = s.palette.map((_, i) => i);
  const rgb = (i) => hexToRgb(s.palette[i].hex);
  const light = (i) => { const [r, g, b] = rgb(i); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const hue = (i) => { const [r, g, b] = rgb(i).map((v) => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx - mn < 0.08) return 400 + light(i) / 255; const d = mx - mn; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
  const codeKey = (i) => { const c = s.palette[i].code; return /^\d+/.test(c) ? parseInt(c, 10) : c === 'White' || c === 'B5200' ? -2 : c === 'Ecru' ? -1 : 1e9; };
  if (by === 'count') idx.sort((a, b) => u[b].total - u[a].total || a - b);
  else if (by === 'code') idx.sort((a, b) => (s.palette[a].brand || '').localeCompare(s.palette[b].brand || '') || codeKey(a) - codeKey(b) || s.palette[a].code.localeCompare(s.palette[b].code));
  else if (by === 'hue') idx.sort((a, b) => hue(a) - hue(b) || light(a) - light(b));
  else if (by === 'light') idx.sort((a, b) => light(b) - light(a));
  const map = [];
  idx.forEach((old, n) => { map[old] = n; });
  return remapPalette(s, map, idx.map((i) => s.palette[i]));
}

// Palette index of a matching entry (same catalogue and code, or same blend), or -1.
// The blend key is sorted, so 310+321 equals 321+310 (same strands in the needle). Custom colours compare by hex.
export function findEntry(s, entry) {
  const key = (e) => (e.blend ? e.blend.map((b) => b.catalog + ':' + b.code).sort().join('+') : (e.catalog || e.brand) + ':' + (e.code || e.hex));
  const k = key(entry);
  return s.palette.findIndex((e) => key(e) === k);
}
