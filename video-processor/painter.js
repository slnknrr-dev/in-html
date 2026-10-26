// video-processor/painter.js - the picture editor of the video processor: paint over a frame or a picture
// (brush, marker, eraser, line, arrow, rectangle, ellipse, text), undo / redo, brightness / contrast / saturation
// of the picture, then apply. It is a hook: an image editor (e.g. the image processor's Photoshop-like core) can take
// its place with setImageEditor(fn):
//
//   editImage(bitmap, { title }) -> Promise<ImageBitmap | null>      null: cancelled, nothing changes
//   setImageEditor(async (bitmap, { title }) => ImageBitmap | HTMLCanvasElement | null)
//
// The result replaces the still in the timeline; the ffmpeg description lists it as a picture file to save.
//
// Three canvases: `base` (the untouched picture), `paint` (the user's strokes, transparent elsewhere) and `view`
// (what is shown = base with adjustments + paint + the shape being dragged). Keeping strokes separate means the
// eraser removes paint only (destination-out on `paint`), never the picture, and brightness / contrast / saturation
// apply to the picture without tinting the drawing.
import { h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { openDialog, promptDialog } from '../ui/overlays.js';
import { SWATCHES } from './stage.js';

let custom = null;

/** Replaces the built-in editor (null restores it). */
export function setImageEditor(fn) { custom = typeof fn === 'function' ? fn : null; }

// Normalises whatever the editor returns (canvas or bitmap) to an ImageBitmap for the media store.
export async function editImage(bitmap, opts = {}) {
  const r = custom ? await custom(bitmap, opts) : await builtin(bitmap, opts);
  if (!r) return null;
  return r instanceof ImageBitmap ? r : createImageBitmap(r);
}

const TOOLS = [['brush', 'edit'], ['marker', 'highlight'], ['eraser', 'eraser'], ['line', 'minus'], ['arrow', 'arrowRight'], ['rect', 'square'], ['ellipse', 'circle'], ['text', 'type']];

function builtin(bitmap, opts) {
  const W = bitmap.width, H = bitmap.height;
  const base = Object.assign(document.createElement('canvas'), { width: W, height: H });
  base.getContext('2d').drawImage(bitmap, 0, 0);
  const paint = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const pc = paint.getContext('2d');
  const view = h('canvas', { class: 'vp-paint-canvas', width: W, height: H, tabindex: '0', 'aria-label': t('vp.paint.canvas') });
  const vc = view.getContext('2d');
  const st = { tool: 'brush', color: '#ff3b30', size: Math.max(2, Math.round(Math.min(W, H) / 120)), adj: { b: 0, c: 0, s: 0 } };
  const undo = [], redo = [];
  // Undo by full ImageData snapshots of the paint layer, max 30: simple and exact; memory W*H*4 bytes each, so the
  // cap matters for large pictures: 30 snapshots of a 12 MP image are ~1.4 GB, so the cap bounds memory but big pictures
  // can still use a lot of it.
  const snap = () => { undo.push(pc.getImageData(0, 0, W, H)); if (undo.length > 30) undo.shift(); redo.length = 0; };
  let preview = null; // shape being dragged
  const draw = () => {
    vc.clearRect(0, 0, W, H);
    const { b, c, s } = st.adj;
    // CSS filter functions on the 2D context: GPU-accelerated in most engines, same math as CSS filters. 'none' when
    // neutral to skip the filter pass.
    vc.filter = b || c || s ? `brightness(${1 + b / 100}) contrast(${1 + c / 100}) saturate(${1 + s / 100})` : 'none';
    vc.drawImage(base, 0, 0);
    vc.filter = 'none';
    vc.drawImage(paint, 0, 0);
    if (preview) shape(vc, preview);
  };
  const shape = (ctx, sh) => {
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = sh.color;
    ctx.lineWidth = sh.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const { x0, y0, x1, y1 } = sh;
    ctx.beginPath();
    if (sh.tool === 'line' || sh.tool === 'arrow') {
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      if (sh.tool === 'arrow') {
        const a = Math.atan2(y1 - y0, x1 - x0), l = Math.max(10, sh.size * 4);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - l * Math.cos(a - 0.45), y1 - l * Math.sin(a - 0.45));
        ctx.lineTo(x1 - l * Math.cos(a + 0.45), y1 - l * Math.sin(a + 0.45));
        ctx.closePath();
        ctx.fill();
      }
    } else if (sh.tool === 'rect') ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    else if (sh.tool === 'ellipse') { ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  };
  // Pointer -> canvas pixels: the canvas is shown scaled (max-width/max-height in CSS), so client coordinates are
  // mapped by the ratio of backing size to displayed size.
  const at = (e) => { const r = view.getBoundingClientRect(); return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height }; };
  let drag = null;
  view.addEventListener('pointerdown', async (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    const p = at(e);
    if (st.tool === 'text') {
      const s = await promptDialog(t('vp.paint.text'), t('vp.paint.textLabel'));
      if (!s) return;
      snap();
      pc.save();
      pc.fillStyle = st.color;
      pc.font = `700 ${Math.max(12, st.size * 6)}px Arial, sans-serif`;
      pc.textBaseline = 'top';
      pc.lineWidth = Math.max(2, st.size);
      // Text gets a contrasting outline (stroke under fill) so it reads on any picture; white outline for the black
      // swatch, black for every other colour.
      pc.strokeStyle = st.color === '#111111' ? '#ffffff' : '#000000';
      pc.lineJoin = 'round';
      s.split('\n').forEach((line, i) => { pc.strokeText(line, p.x, p.y + i * st.size * 7); pc.fillText(line, p.x, p.y + i * st.size * 7); });
      pc.restore();
      draw();
      return;
    }
    view.setPointerCapture(e.pointerId);
    snap();
    drag = { x: p.x, y: p.y };
    if (['brush', 'marker', 'eraser'].includes(st.tool)) {
      pc.save();
      pc.lineCap = st.tool === 'marker' ? 'square' : 'round';
      pc.lineJoin = 'round';
      pc.strokeStyle = st.color;
      pc.globalAlpha = st.tool === 'marker' ? 0.4 : 1;
      pc.lineWidth = st.tool === 'marker' ? st.size * 3 : st.tool === 'eraser' ? st.size * 3 : st.size;
      pc.globalCompositeOperation = st.tool === 'eraser' ? 'destination-out' : 'source-over';
      pc.beginPath();
      pc.moveTo(p.x, p.y);
      // A zero-length segment draws nothing; a 0.01px one makes a single click leave a round dot.
      pc.lineTo(p.x + 0.01, p.y);
      pc.stroke();
      if (st.tool === 'marker') { drag.marker = [[p.x, p.y]]; drag.snapshot = undo[undo.length - 1]; }
    } else preview = { tool: st.tool, color: st.color, size: st.size, x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    draw();
  });
  view.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = at(e);
    // Shift constrains rectangles / ellipses to squares / circles (largest delta on both axes), as in every editor.
    if (preview) { preview.x1 = p.x; preview.y1 = p.y; if (e.shiftKey && preview.tool !== 'line' && preview.tool !== 'arrow') { const d = Math.max(Math.abs(p.x - preview.x0), Math.abs(p.y - preview.y0)); preview.x1 = preview.x0 + Math.sign(p.x - preview.x0 || 1) * d; preview.y1 = preview.y0 + Math.sign(p.y - preview.y0 || 1) * d; } }
    else if (drag.marker) {
      // A marker stroke is redrawn whole so that overlaps do not darken.
      drag.marker.push([p.x, p.y]);
      pc.putImageData(drag.snapshot, 0, 0);
      pc.beginPath();
      pc.moveTo(drag.marker[0][0], drag.marker[0][1]);
      for (const [x, y] of drag.marker) pc.lineTo(x, y);
      pc.stroke();
    } else { pc.lineTo(p.x, p.y); pc.stroke(); }
    draw();
  });
  // Freehand tools saved their context state on down (pc.save) and restore it here; shapes are committed to the
  // paint layer only on release (until then they live in `preview` and are drawn on the view only).
  const end = (e) => {
    if (!drag) return;
    try { view.releasePointerCapture(e.pointerId); } catch { /* released */ }
    if (preview) { shape(pc, preview); preview = null; } else pc.restore();
    drag = null;
    draw();
  };
  view.addEventListener('pointerup', end);
  view.addEventListener('pointercancel', end);
  // Toolbar.
  const toolBtns = TOOLS.map(([k, ic]) => h('button', { type: 'button', class: 'ed-iconbtn', dataset: { k }, title: t('vp.paint.' + k), 'aria-label': t('vp.paint.' + k), onclick: () => { st.tool = k; paintTools(); } }, iconEl(ic)));
  const paintTools = () => { for (const b of toolBtns) { const on = b.dataset.k === st.tool; b.classList.toggle('ed-on', on); b.setAttribute('aria-pressed', String(on)); } };
  const swatches = SWATCHES.map((c) => h('button', { type: 'button', class: 'vp-swatch', style: { background: c }, title: c, 'aria-label': c, onclick: () => { st.color = c; color.value = c; paintSw(); } }));
  const paintSw = () => { for (const s of swatches) s.classList.toggle('vp-on', s.title === st.color); };
  const color = h('input', { type: 'color', class: 'ap-color', value: st.color, 'aria-label': t('vp.color') });
  color.addEventListener('input', () => { st.color = color.value; paintSw(); });
  const size = h('input', { type: 'range', class: 'ed-range', min: 1, max: Math.max(40, Math.round(Math.min(W, H) / 20)), value: st.size, 'aria-label': t('vp.brush.size') });
  size.addEventListener('input', () => { st.size = +size.value; });
  const doUndo = () => { if (!undo.length) return; redo.push(pc.getImageData(0, 0, W, H)); pc.putImageData(undo.pop(), 0, 0); draw(); };
  const doRedo = () => { if (!redo.length) return; undo.push(pc.getImageData(0, 0, W, H)); pc.putImageData(redo.pop(), 0, 0); draw(); };
  const adj = (k, label) => {
    const r = h('input', { type: 'range', class: 'ed-range', min: -100, max: 100, value: 0, 'aria-label': t(label) });
    r.addEventListener('input', () => { st.adj[k] = +r.value; draw(); });
    return h('label', { class: 'vp-paint-adj' }, h('span', {}, t(label)), r);
  };
  const bar = h('div', { class: 'vp-paint-bar' },
    h('div', { class: 'vp-paint-group', role: 'toolbar', 'aria-label': t('vp.paint.tools') }, toolBtns),
    h('div', { class: 'vp-paint-group' }, swatches, color),
    h('label', { class: 'vp-paint-size' }, iconEl('drop'), size),
    h('div', { class: 'vp-paint-group' },
      h('button', { type: 'button', class: 'ed-iconbtn', title: t('vp.undo'), 'aria-label': t('vp.undo'), onclick: doUndo }, iconEl('undo')),
      h('button', { type: 'button', class: 'ed-iconbtn', title: t('vp.redo'), 'aria-label': t('vp.redo'), onclick: doRedo }, iconEl('redo')),
      h('button', { type: 'button', class: 'ed-iconbtn', title: t('vp.paint.clear'), 'aria-label': t('vp.paint.clear'), onclick: () => { snap(); pc.clearRect(0, 0, W, H); draw(); } }, iconEl('trash'))));
  const adjs = h('div', { class: 'vp-paint-adjs' }, adj('b', 'vp.adj.brightness'), adj('c', 'vp.adj.contrast'), adj('s', 'vp.adj.saturation'));
  const body = h('div', { class: 'vp-paint' }, bar, h('div', { class: 'vp-paint-stage' }, view), adjs, h('p', { class: 'ed-hint' }, t('vp.paint.hint')));
  view.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); }
  });
  paintTools();
  paintSw();
  draw();
  return openDialog({
    title: opts.title || t('vp.paint.title'), body, wide: true, className: 'vp-paint-dlg',
    buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('dlg.apply'), value: 'ok', primary: true }],
  // Apply flattens base (with adjustments) + paint into a new canvas at the original resolution.
  }).then((v) => {
    if (v !== 'ok') return null;
    const out = Object.assign(document.createElement('canvas'), { width: W, height: H });
    const oc = out.getContext('2d');
    const { b, c, s } = st.adj;
    oc.filter = b || c || s ? `brightness(${1 + b / 100}) contrast(${1 + c / 100}) saturate(${1 + s / 100})` : 'none';
    oc.drawImage(base, 0, 0);
    oc.filter = 'none';
    oc.drawImage(paint, 0, 0);
    return out;
  });
}
