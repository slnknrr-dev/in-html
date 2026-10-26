// icon-creator/doc.js - the icon document: a 256 × 256 master and up to five sizes (32, 48, 64, 128, 256), each
// either automatic (the master scaled down) or custom (its own pixels, drawn by hand: a different, simpler picture
// for small sizes). Per-size selection masks, undo / redo by snapshots, import of pictures (square crop) and of .ico
// files, export to .ico / .png, and the project format (JSON with PNG pixels). No DOM.
//
// Model and its reasons:
// - Images are plain { width, height, data: Uint8ClampedArray RGBA } (the ImageData shape without the DOM class), so
//   this module, its codecs and its tests run in node. Clamped: arithmetic overflow while painting saturates at 0/255
//   instead of wrapping around (a wrapped 256 would turn a white pixel black).
// - "Automatic vs custom" per size is the core idea of icon design: a 32 px icon is not a shrunk 256 px picture but a
//   redrawn, simplified one. Automatic sizes are always derived (regenerate), custom sizes own their pixels and the
//   master never overwrites them. Size 256 IS the master (same object), so there is one source of truth.
// - doc.rev increments on every regeneration: views compare it to skip redundant repaints of thumbnails/previews.
// - Undo by snapshots (copies of pixel buffers), not by command inversion: paint tools (brush, fill, wand, filters)
//   have no cheap inverse, and a full snapshot of all sizes is ~360 KB, so 80 steps stay around 30 MB worst case.

import { decodeICO, encodeICO } from '../ico/ico.js';
import { decodePNG } from '../png/decode.js';
import { encodePNG } from '../png/encode.js';
import { resize } from '../raster/resample.js';
import { blank, copyImage } from './paint.js';

// The sizes Windows picks from an .ico for the shell, taskbar and Explorer views at common DPI scales. 16 and 24 are
// absent: the smallest editable size here is 32 (Windows scales it down for 16 px slots).
export const SIZES = [32, 48, 64, 128, 256];
// 256 is the largest size an .ico directory entry can express (a width byte of 0 means 256).
export const MASTER = 256;
// Undo depth cap: bounds memory (see header), deep enough for a drawing session.
const HISTORY_MAX = 80;

/** A new, empty document (every size on, all automatic). */
export function createDoc(name = 'icon') {
  const doc = { name, master: blank(MASTER), sizes: {}, sel: {}, undo: [], redo: [], rev: 0 };
  for (const n of SIZES) doc.sizes[n] = { on: true, custom: false, img: blank(n) };
  return doc;
}

/** Pixels of size n (256 is the master itself). */
export const imageOf = (doc, n) => (n === MASTER ? doc.master : doc.sizes[n].img);
export const enabledSizes = (doc) => SIZES.filter((n) => doc.sizes[n].on);

/** Downscales (Lanczos on premultiplied alpha) a square image to n × n; nearest neighbour for whole-factor enlarging. */
// Why two filters: downscaling needs a low-pass filter (Lanczos-3 keeps edges sharp with little ringing) or fine
// detail aliases into noise; premultiplied alpha keeps the colour of transparent pixels (often black) from bleeding
// into edges as dark fringes. Upscaling pixel art by an integer factor must stay blocky: nearest neighbour copies
// each source pixel into a k x k block, which any smoothing filter would blur. Non-integer upscaling falls through
// to Lanczos (no exact pixel grid exists then).
// Always returns a new image (a copy when the size matches): callers may mutate the result freely.
export function scaleTo(img, n) {
  if (img.width === n && img.height === n) return copyImage(img);
  if (n > img.width && n % img.width === 0 && img.width === img.height) {
    const k = n / img.width, out = blank(n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out.data.set(img.data.subarray((((y / k) | 0) * img.width + ((x / k) | 0)) * 4, (((y / k) | 0) * img.width + ((x / k) | 0)) * 4 + 4), (y * n + x) * 4);
    return out;
  }
  const r = resize(img, n, n, 'lanczos3');
  return { width: n, height: n, data: new Uint8ClampedArray(r.data) };
}

/** Recomputes every automatic size from the master. */
// Each size is scaled directly from the 256 master, not chained (256->128->64...): chained resampling compounds the
// filter's blur and ringing at every step.
export function regenerate(doc) {
  for (const n of SIZES) {
    if (n === MASTER) { doc.sizes[n].img = doc.master; continue; }
    if (!doc.sizes[n].custom) doc.sizes[n].img = scaleTo(doc.master, n);
  }
  doc.rev++;
}

// --- history: snapshots of what an action may change ------------------------------------------------------

// A snapshot holds, per size: a pixel copy, the custom/on flags and a copy of the selection mask. For 'all' the
// master comes first; the 256 entry stands for the master (the list skips MASTER among SIZES to avoid a duplicate).
// Automatic sizes' pixels are copied too although restore ignores them (they are regenerated): simpler than a
// special case, and the size is bounded.
function snapshot(doc, which) {
  const list = which === 'all' ? [MASTER, ...SIZES.filter((n) => n !== MASTER)] : [which];
  return list.map((n) => ({
    n, data: new Uint8ClampedArray(imageOf(doc, n).data), custom: n === MASTER ? false : doc.sizes[n].custom,
    on: n === MASTER ? true : doc.sizes[n].on, sel: doc.sel[n] ? Uint8Array.from(doc.sel[n]) : null,
  }));
}

// Master pixels are written in place (doc.master keeps its identity: sizes[256].img and the views hold references
// to it); custom sizes get a fresh buffer; automatic sizes are rebuilt by regenerate at the end.
function restore(doc, snap) {
  for (const s of snap) {
    doc.sizes[s.n].on = s.on;
    doc.sel[s.n] = s.sel;
    if (s.n === MASTER) { doc.master.data.set(s.data); continue; }
    doc.sizes[s.n].custom = s.custom;
    if (s.custom) doc.sizes[s.n].img = { width: s.n, height: s.n, data: new Uint8ClampedArray(s.data) };
  }
  regenerate(doc);
}

/**
 * Records the state before an action that changes size `n` ('all' for actions on the master or on every size).
 * Editing the master changes every automatic size, so it is recorded as 'all'.
 */
// Standard linear history: a new action clears the redo stack (branches would need a tree UI). The label is the
// action's name, returned by undo/redo for the "Undone: Fill" style toast.
export function record(doc, n, label = '') {
  const which = n === MASTER ? 'all' : n;
  doc.undo.push({ label, snap: snapshot(doc, which) });
  if (doc.undo.length > HISTORY_MAX) doc.undo.shift();
  doc.redo.length = 0;
}

// Undo/redo are symmetric: before restoring, the current state of the SAME scope (one size or 'all', inferred from
// the snapshot length) is pushed to the opposite stack, so redo returns exactly what undo replaced.
export function undo(doc) {
  const e = doc.undo.pop();
  if (!e) return null;
  doc.redo.push({ label: e.label, snap: snapshot(doc, e.snap.length > 1 ? 'all' : e.snap[0].n) });
  restore(doc, e.snap);
  return e.label;
}

export function redo(doc) {
  const e = doc.redo.pop();
  if (!e) return null;
  doc.undo.push({ label: e.label, snap: snapshot(doc, e.snap.length > 1 ? 'all' : e.snap[0].n) });
  restore(doc, e.snap);
  return e.label;
}

/** Makes size n custom (its current automatic pixels become its own) before it is drawn on. */
// Copy-on-write: the first stroke on an automatic size detaches it; the user starts from the downscaled master
// instead of a blank canvas, which is how small icons are usually hand-tuned.
export function makeCustom(doc, n) {
  if (n === MASTER || doc.sizes[n].custom) return;
  doc.sizes[n].custom = true;
  doc.sizes[n].img = copyImage(doc.sizes[n].img);
}

/** Size n follows the master again. */
export function makeAuto(doc, n) {
  if (n === MASTER) return;
  doc.sizes[n].custom = false;
  regenerate(doc);
}

// --- import -----------------------------------------------------------------------------------------------

/** Crops the square `rect` ({ x, y, size } in source pixels; may reach outside: transparent) and scales it to n. */
// Row-wise copy with horizontal clipping: [a, b) is the part of the row inside the source; one typed-array set()
// per row instead of a per-pixel loop. Rows outside the source stay transparent (blank). Letting the square extend
// beyond the picture allows a wide logo to be fitted whole with transparent margins.
export function cropSquare(src, rect, n = MASTER) {
  const s = Math.max(1, Math.round(rect.size));
  const sq = blank(s);
  const x0 = Math.round(rect.x), y0 = Math.round(rect.y);
  for (let y = 0; y < s; y++) {
    const sy = y0 + y;
    if (sy < 0 || sy >= src.height) continue;
    const a = Math.max(0, -x0), b = Math.min(s, src.width - x0);
    if (b > a) sq.data.set(src.data.subarray((sy * src.width + x0 + a) * 4, (sy * src.width + x0 + b) * 4), (y * s + a) * 4);
  }
  return scaleTo(sq, n);
}

/** Largest centred square of a w × h picture. */
export const centreSquare = (w, h) => { const size = Math.min(w, h); return { x: Math.floor((w - size) / 2), y: Math.floor((h - size) / 2), size }; };

/** Places an image as the master (the caller records history first). */
// The master's selection is dropped: its mask refers to the old picture.
export function setMaster(doc, img) {
  doc.master.data.set(scaleTo(img, MASTER).data);
  doc.sel[MASTER] = null;
  regenerate(doc);
}

/**
 * Opens the entries of an .ico file: the largest becomes the master; entries of the document's other sizes become
 * custom sizes (their hand-made pixels are kept). Returns the sizes taken over.
 */
// decodeICO returns entries largest first (then highest bit depth), so list[0] is the best master source and find()
// picks the highest-depth entry of each size. Non-square entries are ignored: every size here is square.
// Entries matching document sizes become custom, keeping the designer's hand-tuned small versions instead of
// replacing them with downscales. Custom flags are reset first, so sizes absent from the file follow the master.
// History is the caller's job (import is one undo step there).
export function importICO(doc, bytes) {
  const list = decodeICO(bytes).filter((e) => e.width === e.height);
  if (!list.length) throw new Error('no square images in the icon');
  doc.master.data.set(scaleTo(list[0], MASTER).data);
  const taken = [];
  for (const n of SIZES) {
    doc.sizes[n].custom = false;
    if (n === MASTER) continue;
    const e = list.find((x) => x.width === n);
    if (e && e !== list[0]) { doc.sizes[n].custom = true; doc.sizes[n].img = { width: n, height: n, data: new Uint8ClampedArray(e.data) }; taken.push(n); }
  }
  doc.sel = {};
  regenerate(doc);
  return taken;
}

// --- export -----------------------------------------------------------------------------------------------

/** The .ico bytes of the enabled sizes (256 px as PNG, the others as 32-bit BMP unless opts.png === 'all'). */
// Why BMP for small sizes: PNG-compressed entries are understood since Windows Vista, but some older tools and
// libraries read only BMP entries; 256 px as BMP would be 256 KB raw, so PNG there is the universal convention.
export function exportICO(doc, opts = {}) {
  const sizes = enabledSizes(doc);
  if (!sizes.length) throw new Error('no sizes');
  return encodeICO(sizes.map((n) => imageOf(doc, n)), opts);
}

export const exportPNG = (doc, n) => encodePNG(imageOf(doc, n), { level: 9 });

// --- project file -----------------------------------------------------------------------------------------

// Own base64 (standard alphabet, '=' padding). Why not btoa/atob: they work on "binary strings", which requires a
// String.fromCharCode pass over every byte (spreading a large array into one call overflows the stack). Three bytes
// -> four 6-bit symbols; missing trailing bytes read as 0 and are emitted as '='.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    s += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)] + (b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]) + (c === undefined ? '=' : B64[c & 63]);
  }
  return s;
}
// Lenient decoder: strips everything outside the alphabet (line breaks, spaces, '=' padding); the output length is
// then floor(symbols * 3 / 4), exactly the byte count of unpadded input. Invalid characters are dropped, not
// rejected: the PNG decoder after it validates the content, so garbage still fails loudly there.
export function fromB64(s) {
  const clean = String(s).replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const v = [0, 1, 2, 3].map((k) => (i + k < clean.length ? B64.indexOf(clean[i + k]) : 0));
    const n = (v[0] << 18) | (v[1] << 12) | (v[2] << 6) | v[3];
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

// A project image must decode AND have the expected size: a hand-edited project with a 48 px PNG in the 64 slot
// would otherwise break the buffer-length assumptions of every paint routine.
const pngOf = (b64, n) => {
  const r = decodePNG(fromB64(b64));
  if (r.width !== n || r.height !== n) throw new Error(`bad ${n} px image`);
  return { width: n, height: n, data: new Uint8ClampedArray(r.data) };
};

/** Project as JSON text: { format, version, name, master (PNG base64), sizes: { n: { on, custom, png? } } }. */
// PNG inside JSON: lossless and compressed (icons have large flat areas), while JSON keeps the container
// inspectable and versioned. Automatic sizes are not stored: they derive from the master. format/version allow
// rejecting foreign files and migrating later. History and selections are not saved: a project is the artwork,
// not the session.
export function saveProject(doc) {
  const sizes = {};
  for (const n of SIZES) {
    const s = doc.sizes[n];
    sizes[n] = { on: s.on, custom: s.custom };
    if (s.custom) sizes[n].png = toB64(encodePNG(s.img, { level: 9 }));
  }
  return JSON.stringify({ format: 'icon-creator', version: 1, name: doc.name, master: toB64(encodePNG(doc.master, { level: 9 })), sizes });
}

/** Document from project JSON text (throws on anything else). */
// Fail-fast on identity (format tag, master string), lenient on details: missing size entries default to
// on/automatic, the name is capped at 80 chars. 'on' defaults to true (`!== false`), so files without the flag open
// with all sizes enabled.
export function loadProject(text) {
  const p = JSON.parse(text);
  if (!p || p.format !== 'icon-creator' || typeof p.master !== 'string') throw new Error('not an icon-creator project');
  const doc = createDoc(String(p.name || 'icon').slice(0, 80));
  doc.master = pngOf(p.master, MASTER);
  for (const n of SIZES) {
    const s = (p.sizes && p.sizes[n]) || {};
    doc.sizes[n].on = s.on !== false;
    if (s.custom && s.png && n !== MASTER) { doc.sizes[n].custom = true; doc.sizes[n].img = pngOf(s.png, n); }
  }
  regenerate(doc);
  return doc;
}
