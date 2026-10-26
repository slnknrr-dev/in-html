// pallete-app/state.js - palette state, colour facts cache, palette operations (harmony, random, edit),
// undo stack, persistence and the history of palettes (localStorage).
//
// Design rules:
// - The base colour lives in OKLCH [L 0..1, C 0..0.4, H degrees], not in sRGB: OKLCH is perceptually uniform, so
//   rotating hue for harmonies keeps perceived lightness, and lightness steps of a scale look even. Conversion to sRGB
//   happens at the edge (oklchToSrgbMapped gamut-maps colours that sRGB cannot show).
// - Swatches are stored as hex only; every derived fact (OKLCH, name, contrast, label colour) comes from info(hex),
//   memoised per hex because the UI asks for the same facts many times per render.
// - Operations mutate S and record undo snapshots; rendering is the caller's job (main.js), keeping this module
//   free of DOM and testable.
import { lsGet, lsSet } from '../ui/dom.js';
import { fromHex, hexToRgb, nearestName, toHex } from '../color/css.js';
import { srgbToOklch, oklchToSrgbMapped } from '../color/space.js';
import { contrastRatio, labelOn } from '../color/metrics.js';
import { harmony, hueFamily, randomPalette, scale } from '../color/palette.js';
import { slug } from '../color/swatches.js';

export const MAX_COLORS = 20;
export const FORMATS = ['hex', 'rgb', 'hsl', 'oklch'];
export const MODES = ['analogous', 'complementary', 'triadic', 'tetradic', 'split', 'monochrome'];
const KEY_STATE = 'palette-state';
const KEY_HISTORY = 'palette-history';
const HISTORY_MAX = 30;

// Lower-case #rrggbb only: the canonical form toHex produces; anything else in storage is rejected.
const isHex = (s) => typeof s === 'string' && /^#[0-9a-f]{6}$/.test(s);
const clampN = (v, a, b, d) => (Number.isFinite(+v) ? Math.min(b, Math.max(a, +v)) : d);

// The one state object of the application (rendering reads it, operations below change it).
export const S = {
  base: [0.62, 0.17, 262],
  mode: 'analogous',
  size: 5,
  colors: [],
  tab: 'scales',
  expFmt: 'css',
  expScales: false,
  severity: 1,
  thr: 0.06,
  k: 6,
  seed: 1,
};

// --- colour facts (cached per hex) ------------------------------------------------------------------

const facts = new Map();
// { hex, rgb, oklch, name (nearest CSS name), family, ink ('#000'/'#fff' label colour), white, black (WCAG ratios) }
// Label colour by APCA (labelOn(..., 'apca')): APCA predicts readable text on saturated mid-tones better than the
// WCAG 2 ratio, which tends to pick black on mid blues where white reads better. WCAG ratios against white and black
// are still computed, because WCAG is what audits check.
export function info(hex) {
  let f = facts.get(hex);
  if (!f) {
    const rgb = hexToRgb(hex);
    const oklch = srgbToOklch(rgb);
    const ink = labelOn(rgb, 'apca')[0] ? '#ffffff' : '#000000';
    f = {
      hex, rgb, oklch, ink,
      name: nearestName(fromHex(hex)).name,
      family: hueFamily(oklch),
      white: contrastRatio(rgb, [1, 1, 1]),
      black: contrastRatio(rgb, [0, 0, 0]),
    };
    // Crude bound: drop the whole cache past 4000 entries (no LRU bookkeeping; refilling is cheap).
    if (facts.size > 4000) facts.clear();
    facts.set(hex, f);
  }
  return f;
}

let scaleCache = new Map();
export function scaleOf(hex) {
  let s = scaleCache.get(hex);
  if (!s) {
    s = scale(info(hex).oklch);
    if (scaleCache.size > 200) scaleCache = new Map();
    scaleCache.set(hex, s);
  }
  return s;
}

// Token names: the user's name (imported palettes) or the hue family, made unique ('blue', 'blue-2').
// Token names for exports: user names (from imports) win, otherwise the hue family; duplicates get -2, -3 ...
export function tokenNames(colors = S.colors) {
  const seen = new Map();
  return colors.map((c) => {
    const n0 = c.name ? slug(c.name) : info(c.hex).family;
    const k = (seen.get(n0) || 0) + 1;
    seen.set(n0, k);
    return k === 1 ? n0 : `${n0}-${k}`;
  });
}

// Palette items for color/swatches.js exporters.
export function exportItems(withScales) {
  const names = tokenNames();
  return S.colors.map((c, i) => ({
    name: names[i], hex: c.hex,
    scale: withScales ? scaleOf(c.hex).steps.map((s) => ({ step: s.step, hex: s.hex })) : undefined,
  }));
}

export const baseHex = () => toHex(oklchToSrgbMapped(S.base));
const mk = (hex, extra) => ({ hex, locked: false, fmt: 'hex', ...extra });

// --- undo ---------------------------------------------------------------------------------------------

const undoStack = [];
let lastPush = { kind: '', at: 0 };
// Snapshots are deep copies of the palette-defining fields only (tab, export settings are UI, not undoable).
const snap = () => JSON.parse(JSON.stringify({ base: S.base, mode: S.mode, size: S.size, colors: S.colors }));

// Records the state before a change; repeated changes of the same kind within 700 ms (a slider drag) share one step.
// Coalescing by kind and time: a slider drag fires dozens of changes; one undo step should undo the whole drag.
// Untyped changes (kind '') always create a step.
export function pushUndo(kind = '') {
  const now = Date.now();
  if (kind && kind === lastPush.kind && now - lastPush.at < 700) { lastPush.at = now; return; }
  lastPush = { kind, at: now };
  undoStack.push(snap());
  if (undoStack.length > 60) undoStack.shift();
}
export const canUndo = () => undoStack.length > 0;
export function undo() {
  const s = undoStack.pop();
  if (!s) return false;
  Object.assign(S, s);
  lastPush = { kind: '', at: 0 };
  return true;
}

// --- operations ----------------------------------------------------------------------------------

// Harmony of the base colour; locked swatches keep their place.
// Regeneration keeps locked swatches at their index and replaces the others: locking is how users pin a colour while
// exploring harmonies. Each swatch keeps its chosen display format.
export function regenerate() {
  const list = harmony(S.base, S.mode, S.size);
  S.colors = list.map((sw, i) => {
    const old = S.colors[i];
    return old && old.locked ? old : mk(sw.hex, { fmt: old ? old.fmt : 'hex' });
  });
}

export function setBase(lch, kind = 'base') {
  pushUndo(kind);
  // Lightness 0..1 and chroma 0..0.4 (beyond that nothing is displayable); hue wrapped into [0, 360), NaN -> 0.
  S.base = [clampN(lch[0], 0, 1, 0.6), clampN(lch[1], 0, 0.4, 0.1), ((+lch[2] % 360) + 360) % 360 || 0];
  regenerate();
}

export function randomize() {
  pushUndo();
  // A fresh 31-bit seed per click; locked colours are passed as constraints so the random palette is built around
  // them. The base follows the first locked colour (or the first colour) so the side panel matches the strip.
  S.seed = (Math.random() * 2147483647) >>> 0;
  const locked = S.colors.slice(0, S.size).map((c) => (c && c.locked ? info(c.hex).oklch : null));
  const r = randomPalette({ n: S.size, seed: S.seed, locked });
  S.colors = r.colors.map((sw, i) => {
    const old = S.colors[i];
    return old && old.locked ? old : mk(sw.hex, { fmt: old ? old.fmt : 'hex' });
  });
  const anchor = S.colors.find((c) => c.locked) || S.colors[0];
  if (anchor) S.base = info(anchor.hex).oklch.slice();
  return r;
}

// Replaces the palette (image extraction, import, history restore).
export function replaceColors(list, kind = 'replace') {
  pushUndo(kind);
  S.colors = list.slice(0, MAX_COLORS).map((c) => mk(c.hex, c.name ? { name: String(c.name).slice(0, 40) } : {}));
  S.size = Math.max(1, S.colors.length);
  if (S.colors[0]) S.base = info(S.colors[0].hex).oklch.slice();
}

export function appendColors(list) {
  pushUndo();
  const room = MAX_COLORS - S.colors.length;
  for (const c of list.slice(0, Math.max(0, room))) S.colors.push(mk(c.hex, c.name ? { name: String(c.name).slice(0, 40) } : {}));
  S.size = S.colors.length;
}

// One more colour that fits the palette: a seeded random palette with every current colour locked.
// The new colour is generated "to fit": a random palette with all current colours locked and one free slot.
export function addColor() {
  if (S.colors.length >= MAX_COLORS) return false;
  pushUndo();
  const locked = S.colors.map((c) => info(c.hex).oklch);
  const r = randomPalette({ n: S.colors.length + 1, seed: (Math.random() * 2147483647) >>> 0, locked: [...locked, null] });
  S.colors.push(mk(r.colors[r.colors.length - 1].hex));
  S.size = S.colors.length;
  return true;
}

export function removeColor(i) {
  if (S.colors.length <= 1 || !S.colors[i]) return false;
  pushUndo();
  S.colors.splice(i, 1);
  S.size = S.colors.length;
  return true;
}

export function moveColor(from, to) {
  if (from === to || !S.colors[from] || to < 0 || to >= S.colors.length) return false;
  pushUndo();
  const [c] = S.colors.splice(from, 1);
  S.colors.splice(to, 0, c);
  return true;
}

export function toggleLock(i) {
  const c = S.colors[i];
  if (!c) return;
  c.locked = !c.locked;
}

export function cycleFormat(i) {
  const c = S.colors[i];
  if (c) c.fmt = FORMATS[(FORMATS.indexOf(c.fmt) + 1) % FORMATS.length];
}

// --- persistence --------------------------------------------------------------------------------

// Compact storage: default values (unlocked, hex format) are written as undefined, which JSON omits.
export function save() {
  lsSet(KEY_STATE, {
    base: S.base, mode: S.mode, size: S.size, tab: S.tab, expFmt: S.expFmt, expScales: S.expScales,
    severity: S.severity, thr: S.thr, k: S.k,
    colors: S.colors.map((c) => ({ hex: c.hex, locked: c.locked || undefined, fmt: c.fmt !== 'hex' ? c.fmt : undefined, name: c.name })),
  });
}

export function load() {
  // Every field is validated and clamped; unknown tabs or modes fall back to defaults. Without saved colours, the
  // palette is regenerated from the base.
  const v = lsGet(KEY_STATE, null);
  if (v && typeof v === 'object') {
    if (Array.isArray(v.base) && v.base.length === 3 && v.base.every((x) => Number.isFinite(+x))) S.base = v.base.map(Number);
    if (MODES.includes(v.mode)) S.mode = v.mode;
    if (['scales', 'contrast', 'vision', 'export', 'import'].includes(v.tab)) S.tab = v.tab;
    if (typeof v.expFmt === 'string') S.expFmt = v.expFmt;
    S.expScales = !!v.expScales;
    S.severity = clampN(v.severity, 0, 1, 1);
    S.thr = clampN(v.thr, 0.02, 0.15, 0.06);
    S.k = Math.round(clampN(v.k, 2, 12, 6));
    if (Array.isArray(v.colors)) {
      S.colors = v.colors.filter((c) => c && isHex(c.hex)).slice(0, MAX_COLORS)
        .map((c) => mk(c.hex, { locked: !!c.locked, fmt: FORMATS.includes(c.fmt) ? c.fmt : 'hex', name: typeof c.name === 'string' ? c.name.slice(0, 40) : undefined }));
    }
    S.size = S.colors.length || Math.round(clampN(v.size, 2, 10, 5));
  }
  if (!S.colors.length) regenerate();
}

// --- history --------------------------------------------------------------------------------------

export const history = () => {
  const h = lsGet(KEY_HISTORY, []);
  return Array.isArray(h) ? h.filter((e) => e && Array.isArray(e.colors) && e.colors.every(isHex)) : [];
};

// Adds the current palette (newest first, no consecutive duplicates, at most 30).
// History deduplicates by colour list: re-saving an existing palette moves it to the top.
export function remember() {
  const colors = S.colors.map((c) => c.hex);
  if (!colors.length) return false;
  const h = history();
  if (h[0] && h[0].colors.join() === colors.join()) return false;
  const rest = h.filter((e) => e.colors.join() !== colors.join());
  lsSet(KEY_HISTORY, [{ colors, at: Date.now() }, ...rest].slice(0, HISTORY_MAX));
  return true;
}

export function clearHistory() { lsSet(KEY_HISTORY, []); }
