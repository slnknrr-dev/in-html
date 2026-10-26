// video-processor/stage.js - the preview: a canvas in the project's aspect (sized to the stage, device pixels
// capped), a selection frame over the overlay under edit (drag to move, corner to scale, top knob to rotate, double
// click to edit the text), dragging / wheel on the selected clip pans / zooms it in the frame, and the draw mode
// (freehand strokes into a drawing overlay with pen, marker and neon brushes).
//
// Coordinates: overlay positions are stored as fractions of the frame (x, y in 0..1, centre-based), so a project
// renders identically at any output size. The canvas backing store is in device pixels; the selection frame is a
// DOM element in CSS pixels; point() and updateSel() convert between the two.
// Edits during a drag go through app.live() (no history entry per pointermove) and one app.commit() on release, so
// a whole drag is one undo step.
import { h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { activeAt, frameSize } from '../timeline/model.js';
import * as E from '../timeline/edit.js';
import { hitBox } from './compose.js';

// Shared palette of the draw bar and the picture editor (iOS system colours: familiar and distinct).
export const SWATCHES = ['#ffffff', '#111111', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#0a84ff', '#bf5af2', '#ff2d92'];

export class Stage {
  constructor(app) {
    this.app = app;
    this.canvas = h('canvas', { class: 'vp-canvas', tabindex: '0', role: 'img', 'aria-label': t('vp.preview') });
    this.sel = h('div', { class: 'vp-selbox', hidden: true }, h('i', { class: 'vp-sel-rot', dataset: { h: 'rot' }, title: t('vp.st.rotate') }),
      ...['nw', 'ne', 'sw', 'se'].map((k) => h('i', { class: 'vp-sel-k vp-sel-' + k, dataset: { h: 'scale' } })));
    this.wrap = h('div', { class: 'vp-canvas-wrap' }, this.canvas, this.sel);
    this.drawbar = h('div', { class: 'vp-drawbar', hidden: true });
    this.screen = h('div', { class: 'vp-screen' }, this.wrap, this.drawbar);
    this.el = this.screen;
    this.drag = null;
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.down(e));
    this.sel.addEventListener('pointerdown', (e) => this.down(e));
    for (const n of [c, this.sel]) {
      n.addEventListener('pointermove', (e) => this.move(e));
      n.addEventListener('pointerup', (e) => this.up(e));
      n.addEventListener('pointercancel', (e) => this.up(e));
    }
    c.addEventListener('dblclick', (e) => { const id = this.hit(e); if (id) app.openItem?.(id); });
    this.sel.addEventListener('dblclick', () => { const id = app.sel(); if (id) app.openItem?.(id); });
    c.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    new ResizeObserver(() => this.layout()).observe(this.screen);
  }

  /** Canvas size: the project's aspect fitted into the stage; backing store in device pixels (long side capped). */
  // Fit the 1080p-equivalent frame into the stage (max ~54% of the viewport height so the timeline stays visible).
  // Backing store: devicePixelRatio (max 2) for sharpness, but the long side capped at 1280 px: compositing every
  // frame at 4K on a phone would drop frames, and the preview does not need export resolution.
  layout() {
    const p = this.app.p;
    if (!p) return;
    const { width: fw, height: fh } = frameSize(p.aspect, 1080);
    const r = this.screen.getBoundingClientRect();
    const maxW = Math.max(120, r.width - 16);
    const maxH = Math.max(160, Math.min(window.innerHeight * (window.innerWidth < 700 ? 0.5 : 0.54), 720));
    const k = Math.min(maxW / fw, maxH / fh);
    const cw = Math.max(40, Math.round(fw * k)), ch = Math.max(40, Math.round(fh * k));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cap = 1280 / Math.max(cw * dpr, ch * dpr);
    const s = Math.min(dpr, dpr * cap);
    const bw = Math.round(cw * s), bh = Math.round(ch * s);
    this.wrap.style.width = cw + 'px';
    this.wrap.style.height = ch + 'px';
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
      this.app.engine?.requestDraw();
    }
    this.canvas.style.width = cw + 'px';
    this.canvas.style.height = ch + 'px';
    this.css = { w: cw, h: ch };
    this.updateSel();
  }

  // Pointer -> frame pixels of the canvas backing store.
  point(e) {
    const r = this.canvas.getBoundingClientRect();
    const k = this.canvas.width / Math.max(1, r.width);
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, cx: e.clientX, cy: e.clientY };
  }

  hit(e) {
    const p = this.point(e);
    return hitBox(this.app.engine.boxes || [], p.x, p.y);
  }

  /** Repositions the selection frame over the selected overlay (when it is drawn now). */
  // The frame mirrors the compositor's last drawn box (engine.boxes): position, size and rotation come from what was
  // actually painted, so the handles always sit on the visible overlay, animations included.
  updateSel() {
    const id = this.app.sel();
    const box = id && (this.app.engine?.boxes || []).find((b) => b.id === id);
    if (!box || this.app.drawMode()) { this.sel.hidden = true; return; }
    const k = (this.css?.w || 1) / Math.max(1, this.canvas.width);
    this.sel.hidden = false;
    this.sel.style.width = box.w * k + 'px';
    this.sel.style.height = box.h * k + 'px';
    this.sel.style.transform = `translate(${box.x * k - (box.w * k) / 2}px, ${box.y * k - (box.h * k) / 2}px) rotate(${box.rot}deg)`;
  }

  // Priority: draw mode; else a selection-frame handle (scale / rot) or the overlay under the pointer; else the clip
  // on screen (first press selects it, a press on the selected clip pans its picture inside the frame).
  down(e) {
    if (e.button > 0) return;
    const app = this.app;
    if (app.drawMode()) { this.drawDown(e); return; }
    const pt = this.point(e);
    const handle = e.target.dataset?.h;
    let id = e.target.closest('.vp-selbox') ? app.sel() : this.hit(e);
    if (!id) {
      // The clip on screen: select it; when it is selected already, dragging pans it in the frame.
      const act = activeAt(app.L, app.time()).main;
      const cur = act.find((x) => x.clip.id === app.sel()) || null;
      if (cur) {
        e.preventDefault();
        this.canvas.setPointerCapture(e.pointerId);
        this.drag = { mode: 'pan', id: cur.clip.id, pt, orig: { panX: cur.clip.panX, panY: cur.clip.panY }, moved: false };
        return;
      }
      app.select(act[0]?.clip.id || null, { from: 'stage' });
      return;
    }
    e.preventDefault();
    const f = E.find(app.p, id);
    if (!f) return;
    if (app.sel() !== id) app.select(id, { from: 'stage' });
    const box = app.engine.boxes.find((b) => b.id === id);
    (e.target.closest('.vp-selbox') ? this.sel : this.canvas).setPointerCapture(e.pointerId);
    this.drag = { mode: handle || 'move', id, pt, box, orig: { x: f.item.x, y: f.item.y, scale: f.item.scale, rotation: f.item.rotation }, moved: false, target: e.target };
  }

  move(e) {
    const d = this.drag;
    if (this.stroke) { this.drawMove(e); return; }
    if (!d) return;
    const app = this.app;
    const pt = this.point(e);
    const W = this.canvas.width, H = this.canvas.height;
    // 3 CSS px dead zone: a click (select / double click to edit) must not nudge the overlay.
    if (!d.moved && Math.hypot(pt.cx - d.pt.cx, pt.cy - d.pt.cy) < 3) return;
    d.moved = true;
    if (d.mode === 'pan') {
      app.live((p) => { const c = E.find(p, d.id).item; c.panX = Math.round((d.orig.panX + (pt.x - d.pt.x) / W) * 1000) / 1000; c.panY = Math.round((d.orig.panY + (pt.y - d.pt.y) / H) * 1000) / 1000; });
      return;
    }
    if (d.mode === 'move') {
      let x = d.orig.x + (pt.x - d.pt.x) / W, y = d.orig.y + (pt.y - d.pt.y) / H;
      // Snap the centre to the middle lines.
      // Snap to the frame centre lines within 1.2% of the frame: centring by hand is otherwise nearly impossible.
      if (Math.abs(x - 0.5) < 0.012) x = 0.5;
      if (Math.abs(y - 0.5) < 0.012) y = 0.5;
      app.live((p) => { const it = E.find(p, d.id).item; it.x = Math.round(x * 1000) / 1000; it.y = Math.round(y * 1000) / 1000; });
    } else if (d.mode === 'scale') {
      const c = d.box;
      // Uniform scale by the ratio of distances from the overlay centre (any corner works the same); the 4px floor
      // stops a press right at the centre from producing huge factors.
      const k = Math.hypot(pt.x - c.x, pt.y - c.y) / Math.max(4, Math.hypot(d.pt.x - c.x, d.pt.y - c.y));
      app.live((p) => { const it = E.find(p, d.id).item; it.scale = Math.round(Math.min(20, Math.max(0.05, d.orig.scale * k)) * 1000) / 1000; });
    } else if (d.mode === 'rot') {
      const c = d.box;
      let a = d.orig.rotation + ((Math.atan2(pt.y - c.y, pt.x - c.x) - Math.atan2(d.pt.y - c.y, d.pt.x - c.x)) * 180) / Math.PI;
      // Normalise to -180..180, then snap within 4 degrees to the right angles.
      a = ((a + 540) % 360) - 180;
      for (const s of [-180, -90, 0, 90, 180]) if (Math.abs(a - s) < 4) a = s;
      app.live((p) => { E.find(p, d.id).item.rotation = Math.round(a * 10) / 10; });
    }
  }

  up(e) {
    if (this.stroke) { this.drawUp(e); return; }
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    try { (d.target?.closest?.('.vp-selbox') ? this.sel : this.canvas).releasePointerCapture(e.pointerId); } catch { /* released */ }
    if (d.moved) this.app.commit(t(d.mode === 'pan' ? 'vp.h.pan' : d.mode === 'scale' ? 'vp.h.scale' : d.mode === 'rot' ? 'vp.h.rotate' : 'vp.h.move'));
  }

  // Wheel zooms the selected clip's picture (or scales the selected overlay). The history key 'wheel:<id>' merges a
  // burst of wheel ticks into one undo step.
  wheel(e) {
    const app = this.app;
    const act = activeAt(app.L, app.time()).main;
    const cur = act.find((x) => x.clip.id === app.sel());
    const it = !cur && app.sel() ? E.find(app.p, app.sel()) : null;
    if (!cur && !(it && it.list === 'overlays')) return;
    e.preventDefault();
    const k = Math.exp(-e.deltaY / 500);
    if (cur) app.edit((p) => { const c = E.find(p, cur.clip.id).item; c.zoom = Math.round(Math.min(5, Math.max(0.2, c.zoom * k)) * 1000) / 1000; }, t('vp.h.zoom'), 'wheel:' + cur.clip.id);
    else app.edit((p) => { const o = E.find(p, it.item.id).item; o.scale = Math.round(Math.min(20, Math.max(0.05, o.scale * k)) * 1000) / 1000; }, t('vp.h.scale'), 'wheel:' + it.item.id);
  }

  // --- draw mode ------------------------------------------------------------------------------------------------------

  renderDrawbar() {
    const app = this.app, b = app.brush();
    const bar = this.drawbar;
    bar.textContent = '';
    bar.hidden = !app.drawMode();
    if (bar.hidden) { this.canvas.classList.remove('vp-drawing'); return; }
    this.canvas.classList.add('vp-drawing');
    const tool = (v, ic) => h('button', { type: 'button', class: 'ed-iconbtn' + (b.tool === v ? ' ed-on' : ''), title: t('vp.brush.' + v), 'aria-label': t('vp.brush.' + v), 'aria-pressed': String(b.tool === v), onclick: () => { app.setBrush({ tool: v }); } }, iconEl(ic));
    const sw = SWATCHES.map((c) => h('button', { type: 'button', class: 'vp-swatch' + (b.color === c ? ' vp-on' : ''), style: { background: c }, title: c, 'aria-label': c, onclick: () => app.setBrush({ color: c }) }));
    const size = h('input', { type: 'range', class: 'ed-range', min: 2, max: 40, step: 1, value: Math.round(b.width * 1000), 'aria-label': t('vp.brush.size') });
    size.addEventListener('input', () => app.setBrush({ width: +size.value / 1000 }, true));
    bar.append(tool('pen', 'edit'), tool('marker', 'highlight'), tool('neon', 'zap'), h('span', { class: 'vp-drawbar-sep' }), ...sw,
      h('label', { class: 'vp-drawbar-size' }, iconEl('drop'), size),
      h('button', { type: 'button', class: 'ed-iconbtn', title: t('vp.undo'), 'aria-label': t('vp.undo'), onclick: () => app.undo() }, iconEl('undo')),
      h('button', { type: 'button', class: 'ed-btn ed-primary ed-sm', onclick: () => app.setDrawMode(false) }, iconEl('check'), t('vp.done')));
  }

  /** The drawing that receives strokes: the selected one when it is on screen, else a new one from the playhead. */
  drawTarget() {
    const app = this.app, tt = app.time();
    const cur = app.sel() && E.find(app.p, app.sel());
    if (cur?.list === 'overlays' && cur.item.type === 'drawing' && tt >= cur.item.start && tt < cur.item.end) return cur.item.id;
    return null;
  }

  // Frame point -> the drawing's own (untransformed) frame fraction.
  // Strokes are stored in the drawing's own untransformed space: the inverse of the overlay transform (translate to
  // its centre, rotate by -rotation, divide by scale). Moving or rotating the drawing later then moves its strokes
  // with it instead of distorting them.
  localPoint(item, pt) {
    const W = this.canvas.width, H = this.canvas.height;
    const a = (-(item?.rotation || 0) * Math.PI) / 180, s = item?.scale || 1;
    const dx = pt.x - (item ? item.x * W : W / 2), dy = pt.y - (item ? item.y * H : H / 2);
    const lx = (dx * Math.cos(a) - dy * Math.sin(a)) / s + W / 2, ly = (dx * Math.sin(a) + dy * Math.cos(a)) / s + H / 2;
    return [Math.round((lx / W) * 10000) / 10000, Math.round((ly / H) * 10000) / 10000];
  }

  // No drawing selected under the playhead: create one from the playhead to the end of the current clip (at least
  // 3 s). keepDraw keeps draw mode on across the selection change.
  drawDown(e) {
    e.preventDefault();
    const app = this.app;
    app.pause();
    let id = this.drawTarget();
    if (!id) {
      const tt = app.time();
      const L = app.L;
      const host = activeAt(L, tt).main[0];
      const end = Math.max(tt + 3, host ? host.end : tt + 3);
      id = app.edit((p) => E.addOverlay(p, { type: 'drawing', start: Math.round(tt * 1000) / 1000, end: Math.round(end * 1000) / 1000, strokes: [], animIn: { type: 'none', duration: 0.3 }, animOut: { type: 'none', duration: 0.3 } })?.id, t('vp.h.draw'), null, { keepDraw: true });
      if (!id) return;
      app.select(id, { from: 'stage', keepDraw: true });
    }
    const item = E.find(app.p, id).item;
    const b = app.brush();
    this.stroke = { id, s: { tool: b.tool, color: b.color, width: b.width, points: [...this.localPoint(item, this.point(e))] } };
    this.canvas.setPointerCapture(e.pointerId);
    app.live((p) => { E.find(p, id).item.strokes.push(this.stroke.s); });
  }

  drawMove(e) {
    const st = this.stroke;
    const item = E.find(this.app.p, st.id)?.item;
    if (!item) return;
    // Coalesced events recover the intermediate pointer samples the browser merged into one pointermove (up to
    // 120+ Hz pens): smoother strokes. Points closer than 0.2% of the frame are skipped to keep strokes compact.
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of evs.length ? evs : [e]) {
      const [x, y] = this.localPoint(item, this.point(ev));
      const n = st.s.points.length;
      if (Math.hypot(x - st.s.points[n - 2], y - st.s.points[n - 1]) < 0.002) continue;
      st.s.points.push(x, y);
    }
    // The stroke object is shared with the project: redraw only.
    this.app.engine.requestDraw();
  }

  drawUp(e) {
    const st = this.stroke;
    this.stroke = null;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* released */ }
    if (st) this.app.commit(t('vp.h.draw'));
  }
}
