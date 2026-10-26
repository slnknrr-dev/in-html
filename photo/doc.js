// photo/doc.js - the photo editor's document and layers on canvases (created at runtime only: importing this module
// touches no DOM). A document is { width, height, layers (bottom first), activeId, bgId, selection, recipe }; a layer
// { id, kind: raster | text | shape | adjust, name, visible, opacity, blend, x, y, mask: { canvas, enabled } | null }
// plus its content: raster `canvas` (its own size, placed at x, y), text `text` { value, family, size, weight,
// italic, color, align, lineHeight } and `rotation`, shape `shape` { type: rect | ellipse | line, w, h, fill, stroke,
// strokeWidth, radius } and `rotation`, adjustment `adjust` { type, params }. Masks are alpha canvases (opaque =
// shown) in the layer's own coordinates for pixel layers, in document coordinates for the others.

//
// Design rules:
// - Layers are plain objects plus canvases, not classes: the history closures, the project file and the renderer all
//   read the same fields, and JSON-ish data survives structured cloning to workers (canvases excepted).
// - Blend names are exactly the canvas globalCompositeOperation keywords (W3C Compositing and Blending), so blending
//   is a direct GPU-backed composite with no per-pixel JS; 'normal' maps to 'source-over'.
// - Text and shape layers stay vector (re-rasterised on every render), so scaling or editing them never degrades.

export const BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];
export const blendOp = (b) => (b && b !== 'normal' && BLENDS.includes(b) ? b : 'source-over');
export const FONTS = ['system-ui', 'Arial', 'Helvetica', 'Verdana', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Courier New', 'Impact', 'serif', 'sans-serif', 'monospace'];

/** A canvas of w × h (a <canvas> on pages, OffscreenCanvas in workers). */
export function makeCanvas(w, h) {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return new OffscreenCanvas(w, h);
}
// willReadFrequently asks the browser for a CPU-backed canvas: getImageData on a GPU canvas forces a slow readback
// every call. Only for canvases read in loops (sampling, masks); drawing-heavy canvases stay GPU-backed. The option
// is honoured only on the first getContext call of a canvas, so the first caller decides.
export const ctxOf = (c, read = false) => c.getContext('2d', read ? { willReadFrequently: true } : undefined);

export function cloneCanvas(c) { const n = makeCanvas(c.width, c.height); ctxOf(n).drawImage(c, 0, 0); return n; }

/** Rectangle clipped to a canvas (or null when empty). */
// floor / ceil outward: a fractional rectangle must cover every pixel it touches, or edges of a dirty area would be
// left stale.
export function clipRect(r, w, h) {
  const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(w, Math.ceil(r.x + r.w)), y1 = Math.min(h, Math.ceil(r.y + r.h));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
export const unionRect = (a, b) => (!a ? b : !b ? a : { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x), h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y) });

export const getPixels = (c, r) => ctxOf(c).getImageData(r.x, r.y, r.w, r.h);
export const putPixels = (c, img, r) => ctxOf(c).putImageData(img, r.x, r.y);

/** RGBA image { width, height, data } of a whole canvas, and back. */
export const imageOf = (c) => { const d = ctxOf(c).getImageData(0, 0, c.width, c.height); return { width: d.width, height: d.height, data: d.data }; };
export function canvasOf(img) {
  const c = makeCanvas(img.width, img.height);
  ctxOf(c).putImageData(new ImageData(new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.width * img.height * 4), img.width, img.height), 0, 0);
  return c;
}

// --- selection canvases (coverage as alpha), cached per immutable selection -------------------------------------

// Selections are immutable (every change makes a new object), so the object itself is the cache key; WeakMap lets an
// abandoned selection and its canvas be collected without explicit invalidation.
const selCache = new WeakMap();
/** Canvas of a selection's box: white with the coverage as alpha (placed at sel.x, sel.y). */
export function selectionCanvas(sel) {
  if (!sel) return null;
  let c = selCache.get(sel);
  if (c) return c;
  c = makeCanvas(sel.w, sel.h);
  const img = new ImageData(sel.w, sel.h), d = img.data;
  for (let i = 0; i < sel.data.length; i++) { const p = i * 4; d[p] = d[p + 1] = d[p + 2] = 255; d[p + 3] = sel.data[i]; }
  ctxOf(c).putImageData(img, 0, 0);
  selCache.set(sel, c);
  return c;
}

/**
 * Keeps a canvas' pixels only inside the selection: ctx draws at a document offset (ox, oy) = the canvas' position.
 * Everything outside the selection box is cleared, inside it is multiplied by the coverage.
 */
export function clipToSelection(canvas, sel, ox = 0, oy = 0, rect = null) {
  if (!sel) return;
  const g = ctxOf(canvas);
  const r = rect || { x: 0, y: 0, w: canvas.width, h: canvas.height };
  g.save();
  g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip();
  // destination-in keeps destination alpha multiplied by source alpha: exactly "multiply by coverage", soft edges
  // included, done by the compositor instead of a JS pixel loop.
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(selectionCanvas(sel), sel.x - ox, sel.y - oy);
  // outside the selection's box destination-in has no source: clear those parts explicitly
  g.globalCompositeOperation = 'source-over';
  const sx = sel.x - ox, sy = sel.y - oy;
  g.clearRect(r.x, r.y, r.w, Math.max(0, sy - r.y));
  g.clearRect(r.x, sy + sel.h, r.w, Math.max(0, r.y + r.h - sy - sel.h));
  g.clearRect(r.x, r.y, Math.max(0, sx - r.x), r.h);
  g.clearRect(sx + sel.w, r.y, Math.max(0, r.x + r.w - sx - sel.w), r.h);
  g.restore();
}

// --- layers -------------------------------------------------------------------------------------------------------

// Module-level counter: ids are unique per page session. bumpIds() moves it past ids of an opened project so new
// layers cannot collide with loaded ones.
let nextId = 1;
export const newId = () => nextId++;
export const bumpIds = (doc) => { for (const L of doc.layers) if (L.id >= nextId) nextId = L.id + 1; };

const base = (kind, name) => ({ id: newId(), kind, name, visible: true, opacity: 1, blend: 'normal', x: 0, y: 0, mask: null, rev: 0 });

export function rasterLayer(name, canvas) { return { ...base('raster', name), canvas }; }
export function textLayer(name, x, y, text) {
  return { ...base('text', name), x, y, rotation: 0, text: { value: '', family: 'system-ui', size: 48, weight: 600, italic: false, color: '#000000', align: 'left', lineHeight: 1.2, ...text } };
}
export function shapeLayer(name, x, y, shape) {
  return { ...base('shape', name), x, y, rotation: 0, shape: { type: 'rect', w: 100, h: 100, fill: '#2563eb', stroke: null, strokeWidth: 0, radius: 0, ...shape } };
}
export function adjustLayer(name, type, params) { return { ...base('adjust', name), adjust: { type, params: { ...params } } }; }

/** A new document of w × h with one background layer (filled with `fill`, transparent when null). */
export function newDocument(w, h, { fill = '#ffffff', name = 'Background', canvas = null } = {}) {
  const c = canvas || makeCanvas(w, h);
  if (!canvas && fill) { const g = ctxOf(c); g.fillStyle = fill; g.fillRect(0, 0, c.width, c.height); }
  const bg = rasterLayer(name, c);
  return { width: c.width, height: c.height, layers: [bg], activeId: bg.id, bgId: bg.id, selection: null, recipe: { source: null, steps: [], painted: {}, alpha: !fill } };
}

// --- text and shapes ------------------------------------------------------------------------------------------------

let measureCtx = null;
// CSS font shorthand. Family names with spaces or commas are quoted unless already quoted or already a list; an
// unquoted 'Times New Roman' is still valid CSS, but names starting with digits or containing punctuation are not.
const fontOf = (t, size = t.size) => `${t.italic ? 'italic ' : ''}${t.weight || 400} ${size}px ${/[\s,]/.test(t.family) && !/^["']/.test(t.family) && !t.family.includes(',') ? `"${t.family}"` : t.family}`;

/** Lines and box of a text layer: { lines: [{ text, w }], w, h, lh, ascent (top of the em box to the baseline) }. */
export function textBox(L) {
  const t = L.text;
  if (!measureCtx) measureCtx = ctxOf(makeCanvas(4, 4));
  measureCtx.font = fontOf(t);
  measureCtx.textBaseline = 'top';
  const lh = t.size * (t.lineHeight || 1.2);
  const lines = String(t.value || '').split('\n').map((s) => ({ text: s, w: measureCtx.measureText(s).width }));
  const base = measureCtx.measureText('Hg').alphabeticBaseline;
  // TextMetrics baselines are not available in every engine; 0.78 em is a typical Latin ascent used as fallback.
  const ascent = Number.isFinite(base) && base < 0 ? -base : t.size * 0.78;
  return { lines, w: Math.max(1, ...lines.map((l) => l.w)), h: Math.max(lh, lines.length * lh), lh, ascent };
}

/** Unrotated box of a text or shape layer in document coordinates. */
export function contentBox(L) {
  if (L.kind === 'text') { const b = textBox(L); return { x: L.x, y: L.y, w: b.w, h: b.h }; }
  if (L.kind === 'shape') { const s = L.shape; return { x: Math.min(L.x, L.x + s.w), y: Math.min(L.y, L.y + s.h), w: Math.abs(s.w), h: Math.abs(s.h) }; }
  if (L.kind === 'raster') return { x: L.x, y: L.y, w: L.canvas.width, h: L.canvas.height };
  return null;
}

/** Axis-aligned bounds of a layer's content (rotation included); adjustment layers cover the document. */
export function layerBounds(L, doc) {
  if (L.kind === 'adjust') return { x: 0, y: 0, w: doc.width, h: doc.height };
  const b = contentBox(L);
  const a = ((L.rotation || 0) * Math.PI) / 180;
  if (!a) return b;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  // Bounding box of a rectangle rotated by a: w' = w|cos| + h|sin|, h' = w|sin| + h|cos|, centred on the same point.
  const w = b.w * c + b.h * s, h = b.w * s + b.h * c;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

// Applies a layer's rotation about its box centre to a context.
function rotateAbout(g, L, b) {
  if (!L.rotation) return;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  g.translate(cx, cy); g.rotate((L.rotation * Math.PI) / 180); g.translate(-cx, -cy);
}

export function drawText(g, L) {
  const t = L.text, b = textBox(L);
  g.save();
  rotateAbout(g, L, { x: L.x, y: L.y, w: b.w, h: b.h });
  g.font = fontOf(t); g.fillStyle = t.color; g.textBaseline = 'top';
  b.lines.forEach((ln, i) => {
    const dx = t.align === 'center' ? (b.w - ln.w) / 2 : t.align === 'right' ? b.w - ln.w : 0;
    g.fillText(ln.text, L.x + dx, L.y + i * b.lh + (b.lh - t.size) / 2);
  });
  g.restore();
}

export function drawShape(g, L) {
  const s = L.shape;
  g.save();
  rotateAbout(g, L, contentBox(L));
  g.beginPath();
  if (s.type === 'ellipse') g.ellipse(L.x + s.w / 2, L.y + s.h / 2, Math.abs(s.w / 2), Math.abs(s.h / 2), 0, 0, Math.PI * 2);
  else if (s.type === 'line') { g.moveTo(L.x, L.y); g.lineTo(L.x + s.w, L.y + s.h); }
  else if (s.radius > 0 && g.roundRect) g.roundRect(Math.min(L.x, L.x + s.w), Math.min(L.y, L.y + s.h), Math.abs(s.w), Math.abs(s.h), s.radius);
  else g.rect(Math.min(L.x, L.x + s.w), Math.min(L.y, L.y + s.h), Math.abs(s.w), Math.abs(s.h));
  if (s.fill && s.type !== 'line') { g.fillStyle = s.fill; g.fill(); }
  if (s.stroke && s.strokeWidth > 0) { g.strokeStyle = s.stroke; g.lineWidth = s.strokeWidth; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke(); }
  g.restore();
}

/** Whether a document point hits a layer's content (pixel layers: a visible pixel). */
export function hitLayer(L, x, y) {
  if (!L.visible || L.kind === 'adjust') return false;
  if (L.kind === 'raster') {
    const px = Math.floor(x - L.x), py = Math.floor(y - L.y);
    if (px < 0 || py < 0 || px >= L.canvas.width || py >= L.canvas.height) return false;
    // Alpha above ~6% counts as a hit: clicks on faint anti-aliased fringes or near-invisible haze should fall through
    // to the layer below, as users expect.
    return ctxOf(L.canvas).getImageData(px, py, 1, 1).data[3] > 16;
  }
  const b = contentBox(L);
  let px = x, py = y;
  // Inverse-rotate the point into the layer's unrotated frame, then a plain box test (cheaper than rotating the box).
  if (L.rotation) {
    const a = (-L.rotation * Math.PI) / 180, cx = b.x + b.w / 2, cy = b.y + b.h / 2, c = Math.cos(a), s = Math.sin(a);
    px = cx + (x - cx) * c - (y - cy) * s; py = cy + (x - cx) * s + (y - cy) * c;
  }
  const pad = L.kind === 'shape' && L.shape.type === 'line' ? Math.max(4, L.shape.strokeWidth) : 2;
  return px >= b.x - pad && py >= b.y - pad && px <= b.x + b.w + pad && py <= b.y + b.h + pad;
}

/** Mask origin in document coordinates. */
export const maskOrigin = (L) => (L.kind === 'raster' ? { x: L.x, y: L.y } : { x: 0, y: 0 });

/** A new mask for a layer: everything shown, or the selection's coverage when one is given. */
export function makeMask(L, doc, sel = null) {
  const w = L.kind === 'raster' ? L.canvas.width : doc.width, h = L.kind === 'raster' ? L.canvas.height : doc.height;
  const c = makeCanvas(w, h), g = ctxOf(c);
  const o = maskOrigin(L);
  if (sel) g.drawImage(selectionCanvas(sel), sel.x - o.x, sel.y - o.y);
  else { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); }
  return { canvas: c, enabled: true };
}
