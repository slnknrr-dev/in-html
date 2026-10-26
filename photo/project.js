// photo/project.js - the editable project file of the photo editor: a ZIP (zip/zip.js) with `project.json` (format
// 'in-html/photo', version, size, layers with their properties, the command recipe) and one PNG per pixel layer
// (layers/<id>.png) and per mask (masks/<id>.png, coverage in the alpha channel). Any ZIP tool can open it.
//
//   projectManifest(doc) -> JSON-ready manifest          readManifest(json) -> validated plain document (no pixels)
//   saveProject(doc, { toPNG(canvas) -> Promise<Uint8Array> }) -> Promise<Uint8Array>
//   openProject(bytes, { fromPNG(bytes) -> Promise<canvas> }) -> Promise<document>
// Canvas work is injected, so the module itself stays pure (Node tests cover the manifest).

//
// Design rules:
// - ZIP + JSON + PNG rather than a custom binary: inspectable and repairable with stock tools, PNG is lossless with
//   alpha, and a future version can add files without breaking old readers (unknown entries are ignored).
// - PNG entries are stored, not deflated again (store: true): PNG is already zlib-compressed, a second deflate costs
//   CPU and gains ~0 bytes.
// - The manifest is untrusted input on open: every number is clamped, enums are allow-listed, objects are deep-copied
//   through JSON (drops functions, prototypes, cycles). File names from the manifest are used only as lookup keys
//   inside the ZIP, never as file-system paths, so traversal names ('../x') are harmless here.
import { readZip, writeZip } from '../zip/zip.js';

export const FORMAT = 'in-html/photo';
export const VERSION = 1;
const BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];
const KINDS = ['raster', 'text', 'shape', 'adjust'];
// Coerce, reject non-finite (NaN / Infinity from a hostile manifest would poison canvas maths), then clamp.
const num = (v, d, lo = -Infinity, hi = Infinity) => { const n = +v; return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const plain = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

/** JSON manifest of a document (pixels are referenced by file name). */
export function projectManifest(doc) {
  return {
    format: FORMAT, version: VERSION, app: 'image-processor', width: doc.width, height: doc.height,
    bgId: doc.bgId ?? null, activeId: doc.activeId ?? null, recipe: plain(doc.recipe || null),
    layers: doc.layers.map((L) => {
      const o = { id: L.id, kind: L.kind, name: L.name, visible: !!L.visible, opacity: L.opacity, blend: L.blend, x: L.x || 0, y: L.y || 0 };
      if (L.kind === 'raster') { o.w = L.canvas ? L.canvas.width : L.w; o.h = L.canvas ? L.canvas.height : L.h; o.file = `layers/${L.id}.png`; }
      if (L.kind === 'text') { o.text = plain(L.text); o.rotation = L.rotation || 0; }
      if (L.kind === 'shape') { o.shape = plain(L.shape); o.rotation = L.rotation || 0; }
      if (L.kind === 'adjust') o.adjust = plain(L.adjust);
      if (L.mask) o.mask = { enabled: L.mask.enabled !== false, file: `masks/${L.id}.png` };
      return o;
    }),
  };
}

/** Checked document skeleton from a manifest (throws on another format). */
export function readManifest(m) {
  if (!m || m.format !== FORMAT) throw new Error('not a photo project');
  if (!(m.version >= 1)) throw new Error('unknown project version');
  // 30000 px cap: beyond it browsers refuse to allocate the canvas (area limits around 2^28 px), and a hostile file
  // could otherwise request gigabytes before any pixel is read.
  // KNOWN DEFECT: layer ids are not checked for uniqueness; two layers with the same id would both point at
  // layers/<id>.png and confuse selection by id. Fix: reassign duplicates (e.g. the 1000 + i fallback) here.
  const width = Math.round(num(m.width, 0, 1, 30000)), height = Math.round(num(m.height, 0, 1, 30000));
  if (!width || !height) throw new Error('bad project size');
  const layers = (Array.isArray(m.layers) ? m.layers : []).filter((l) => l && KINDS.includes(l.kind)).map((l, i) => ({
    id: Number.isInteger(l.id) ? l.id : 1000 + i, kind: l.kind, name: String(l.name || l.kind).slice(0, 120), visible: l.visible !== false,
    opacity: num(l.opacity, 1, 0, 1), blend: BLENDS.includes(l.blend) ? l.blend : 'normal', x: num(l.x, 0), y: num(l.y, 0),
    w: l.w, h: l.h, file: typeof l.file === 'string' ? l.file : null, rotation: num(l.rotation, 0),
    text: l.kind === 'text' ? plain(l.text) : undefined, shape: l.kind === 'shape' ? plain(l.shape) : undefined,
    adjust: l.kind === 'adjust' ? plain(l.adjust) : undefined,
    mask: l.mask ? { enabled: l.mask.enabled !== false, file: typeof l.mask.file === 'string' ? l.mask.file : null } : null,
  }));
  if (!layers.length) throw new Error('empty project');
  return { width, height, layers, bgId: m.bgId ?? null, activeId: m.activeId ?? layers[layers.length - 1].id, recipe: m.recipe && typeof m.recipe === 'object' ? plain(m.recipe) : null };
}

/** ZIP bytes of a document. */
export async function saveProject(doc, { toPNG }) {
  const m = projectManifest(doc);
  const files = [{ name: 'project.json', data: JSON.stringify(m, null, 1) }];
  for (const L of doc.layers) {
    if (L.kind === 'raster' && L.canvas) files.push({ name: `layers/${L.id}.png`, data: await toPNG(L.canvas), store: true });
    if (L.mask && L.mask.canvas) files.push({ name: `masks/${L.id}.png`, data: await toPNG(L.mask.canvas), store: true });
  }
  return writeZip(files);
}

/** Document from ZIP bytes: canvases restored through fromPNG. */
export async function openProject(bytes, { fromPNG }) {
  const entries = readZip(bytes);
  const get = (name) => entries.find((e) => e.name === name);
  const pj = get('project.json');
  if (!pj) throw new Error('not a photo project');
  const doc = readManifest(JSON.parse(await pj.text()));
  for (const L of doc.layers) {
    if (L.kind === 'raster') {
      const e = L.file && get(L.file);
      if (!e) throw new Error('missing layer ' + L.file);
      L.canvas = await fromPNG(await e.data());
    }
    if (L.mask) {
      const e = L.mask.file && get(L.mask.file);
      // Asymmetric on purpose: a missing layer image is fatal (the document would be wrong), a missing mask only
      // loses the masking, so the layer opens unmasked rather than failing the whole project.
      if (e) L.mask.canvas = await fromPNG(await e.data()); else L.mask = null;
    }
    delete L.file; delete L.w; delete L.h;
    if (L.mask) delete L.mask.file;
  }
  return doc;
}
