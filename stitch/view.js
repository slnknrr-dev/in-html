// stitch/view.js - an interactive chart viewport for browsers (nothing runs at import): a canvas that draws a scheme
// with render.js, zooms and pans with the mouse (drag, wheel at the cursor), touch (one finger drags or draws, two
// fingers pinch and pan) and keys (arrows, + / -, 0 fits), draws rulers, and reports cell events to the application
// (drawing tools, marking stitches). An overview canvas shows the whole chart with the visible rectangle.
//
//   const v = createChartView(host, { scheme, layer: () => layer, options: () => drawOpts, rulers: true, paint,
//     onCell(ev), onView(view), onHover(cell), panTool: () => boolean, cellLimits: [min, max], keyboard: true })
//     paint(ctx, view, options): an own painter instead of the chart renderer (the scheme only gives width / height)
//     ev = { type: 'down' | 'move' | 'up' | 'cancel', x, y, fx, fy, gx, gy, button, shift, alt, ctrl, pointerType }
//   v.redraw()  v.fit()  v.zoomTo(cell, cx, cy)  v.zoomBy(f)  v.centerOn(x, y)  v.setScheme(s)  v.view  v.canvas
//   v.cellAtClient(clientX, clientY)  v.destroy()
//   createOverview(host, chartView, { size }) -> { redraw(), destroy() }

// Also: onTap(ev) fires for a press-release without movement in pan mode (selecting a cell while panning is the
// active tool). Pull-style config (layer(), options(), panTool()) instead of setters: the view asks for the current
// state at paint time, so the application never has to remember to push updates before redraw().
// Rendering is coalesced through requestAnimationFrame: any number of redraw() calls per frame paint once.
import { drawChart, drawRulers, cellAt, colorBitmap } from './render.js';

const RULER = 22;

export function createChartView(host, cfg) {
  const canvas = document.createElement('canvas');
  canvas.className = 'st-canvas';
  // Focusable so keyboard navigation works; role=img because a canvas has no semantics of its own.
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  host.append(canvas);
  let scheme = cfg.scheme;
  const view = { x: 0, y: 0, cell: 12, width: 100, height: 100 };
  const [minCell, maxCell] = cfg.cellLimits || [0.25, 80];
  let raf = 0, dpr = 1, hover = null, fitted = false;
  const rulers = () => cfg.rulers !== false && (typeof cfg.rulers !== 'function' || cfg.rulers());
  const off = () => (rulers() ? RULER : 0);

  // Backing store = css size x devicePixelRatio (capped at 3: higher ratios quadruple memory for no visible gain),
  // so lines stay sharp on HiDPI screens; drawing code keeps working in css px via setTransform(dpr). The first
  // resize fits the chart, later ones keep the view.
  function resize() {
    const r = host.getBoundingClientRect();
    dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(50, Math.floor(r.width)), h = Math.max(50, Math.floor(r.height));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    }
    view.width = w; view.height = h;
    if (!fitted) { fitted = true; fit(); return; }
    redraw();
  }

  function paint() {
    raf = 0;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const o = off();
    // The chart is drawn shifted by the rulers: view.x / view.y are the cells at the ruler corner.
    const opts = cfg.options ? cfg.options() : {};
    const layer = cfg.layer ? cfg.layer() : null;
    ctx.save();
    ctx.translate(o, o);
    // A custom painter (rugs, previews) replaces the chart renderer; the scheme then only gives the size.
    if (cfg.paint) cfg.paint(ctx, { ...view, width: view.width - o, height: view.height - o }, opts);
    else drawChart(ctx, scheme, { ...view, width: view.width - o, height: view.height - o }, { ...opts, layer });
    ctx.restore();
    if (o) drawRulers(ctx, scheme, { ...view, x: view.x - o / view.cell, y: view.y - o / view.cell }, { size: o, dark: !!opts.dark, cursor: hover });
    if (cfg.onView) cfg.onView(view);
  }
  function redraw() { if (!raf) raf = requestAnimationFrame(paint); }

  // Keeps at least part of the chart reachable: the chart may scroll until about half of it (or half the viewport)
  // is off screen plus a 20 % margin, never completely away, so a stray fling cannot lose it.
  function clampView() {
    const o = off();
    const w = (view.width - o) / view.cell, h = (view.height - o) / view.cell;
    const mx = Math.max(scheme.width * 0.5, w * 0.5), my = Math.max(scheme.height * 0.5, h * 0.5);
    view.x = Math.min(Math.max(view.x, -w + Math.min(w, scheme.width) * 0.5 - mx * 0.2), scheme.width - Math.min(w, scheme.width) * 0.5 + mx * 0.2);
    view.y = Math.min(Math.max(view.y, -h + Math.min(h, scheme.height) * 0.5 - my * 0.2), scheme.height - Math.min(h, scheme.height) * 0.5 + my * 0.2);
  }

  function fit() {
    const o = off();
    const w = view.width - o - 16, h = view.height - o - 16;
    view.cell = Math.max(minCell, Math.min(maxCell, Math.min(w / scheme.width, h / scheme.height)));
    view.x = scheme.width / 2 - (view.width - o) / 2 / view.cell;
    view.y = scheme.height / 2 - (view.height - o) / 2 / view.cell;
    redraw();
  }

  // Zoom keeping the chart point under (cx, cy) (canvas css px, default centre) in place.
  // Zoom about a point: compute the chart coordinate under the cursor, change the scale, then solve view.x so that
  // coordinate lands under the cursor again. Zooming about the corner instead makes the target drift away.
  function zoomTo(cell, cx, cy) {
    const o = off();
    cell = Math.max(minCell, Math.min(maxCell, cell));
    if (cx == null) { cx = o + (view.width - o) / 2; cy = o + (view.height - o) / 2; }
    const gx = view.x + (cx - o) / view.cell, gy = view.y + (cy - o) / view.cell;
    view.cell = cell;
    view.x = gx - (cx - o) / cell;
    view.y = gy - (cy - o) / cell;
    clampView();
    redraw();
  }
  const zoomBy = (f, cx, cy) => zoomTo(view.cell * f, cx, cy);
  function centerOn(x, y) {
    const o = off();
    view.x = x - (view.width - o) / 2 / view.cell;
    view.y = y - (view.height - o) / 2 / view.cell;
    clampView();
    redraw();
  }

  function local(e) { const r = canvas.getBoundingClientRect(); return { px: e.clientX - r.left, py: e.clientY - r.top }; }
  function cellAtClient(clientX, clientY) {
    const r = canvas.getBoundingClientRect(), o = off();
    return cellAt(view, clientX - r.left - o, clientY - r.top - o);
  }

  // --- pointers: pan, pinch, cell events ---
  // Pointer Events unify mouse, pen and touch. setPointerCapture keeps moves flowing when the pointer leaves the
  // canvas mid-drag. A second finger cancels an ongoing draw (so a pinch never leaves stray stitches) and starts a
  // pinch; lifting one finger of a pinch continues as a pan instead of jumping into draw mode. touch-action: none
  // below hands all gestures to us (otherwise the browser would scroll / zoom the page).
  const pointers = new Map();
  let mode = null; // 'pan' | 'draw' | 'pinch'
  let panStart = null, pinchStart = null, spaceDown = false, moved = false;
  const evOf = (e, type) => { const c = cellAtClient(e.clientX, e.clientY); return { type, ...c, button: e.button, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, pointerType: e.pointerType }; };

  function onDown(e) {
    canvas.focus({ preventScroll: true });
    if (e.button === 2) return; // context menus are the application's
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic or finished pointer */ }
    pointers.set(e.pointerId, local(e));
    if (pointers.size === 2) {
      if (mode === 'draw' && cfg.onCell) cfg.onCell({ type: 'cancel' });
      const [a, b] = [...pointers.values()];
      mode = 'pinch';
      pinchStart = { d: Math.hypot(a.px - b.px, a.py - b.py) || 1, cell: view.cell, cx: (a.px + b.px) / 2, cy: (a.py + b.py) / 2, vx: view.x, vy: view.y };
      return;
    }
    if (pointers.size > 2) return;
    moved = false;
    const panTool = !cfg.onCell || (cfg.panTool && cfg.panTool()) || e.button === 1 || spaceDown;
    if (panTool) { mode = 'pan'; const p = local(e); panStart = { px: p.px, py: p.py, vx: view.x, vy: view.y }; canvas.style.cursor = 'grabbing'; }
    else { mode = 'draw'; cfg.onCell(evOf(e, 'down')); }
    e.preventDefault();
  }
  function onMove(e) {
    const c = cellAtClient(e.clientX, e.clientY);
    const nh = c.x >= 0 && c.y >= 0 && c.x < scheme.width && c.y < scheme.height ? { x: c.x, y: c.y } : null;
    if ((nh && (!hover || nh.x !== hover.x || nh.y !== hover.y)) || (!nh && hover)) { hover = nh; if (cfg.onHover) cfg.onHover(hover); if (rulers()) redraw(); }
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, local(e));
    if (mode === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.px - b.px, a.py - b.py) || 1, o = off();
      const cell = Math.max(minCell, Math.min(maxCell, (pinchStart.cell * d) / pinchStart.d));
      const cx = (a.px + b.px) / 2, cy = (a.py + b.py) / 2;
      const gx = pinchStart.vx + (pinchStart.cx - o) / pinchStart.cell, gy = pinchStart.vy + (pinchStart.cy - o) / pinchStart.cell;
      view.cell = cell;
      view.x = gx - (cx - o) / cell;
      view.y = gy - (cy - o) / cell;
      clampView();
      redraw();
    } else if (mode === 'pan') {
      const p = local(e);
      if (Math.abs(p.px - panStart.px) + Math.abs(p.py - panStart.py) > 3) moved = true;
      view.x = panStart.vx - (p.px - panStart.px) / view.cell;
      view.y = panStart.vy - (p.py - panStart.py) / view.cell;
      clampView();
      redraw();
    } else if (mode === 'draw') cfg.onCell(evOf(e, 'move'));
  }
  function onUp(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (mode === 'draw') cfg.onCell(evOf(e, e.type === 'pointercancel' ? 'cancel' : 'up'));
    if (mode === 'pan' && !moved && cfg.onTap) cfg.onTap(evOf(e, 'tap'));
    if (pointers.size === 0) { mode = null; canvas.style.cursor = ''; }
    else if (mode === 'pinch' && pointers.size === 1) { mode = 'pan'; const p = [...pointers.values()][0]; panStart = { px: p.px, py: p.py, vx: view.x, vy: view.y }; moved = true; }
  }
  // Exponential zoom (exp(-delta k)) makes equal wheel steps equal zoom ratios, the only mapping that feels uniform.
  // deltaMode 1 (lines, Firefox) is converted to pixels (~33 px per line); the delta is clamped so a high-resolution
  // trackpad burst cannot jump several zoom levels. passive: false is required for preventDefault (page scroll).
  function onWheel(e) {
    e.preventDefault();
    const p = local(e);
    if (e.shiftKey && !e.ctrlKey) { view.x += (e.deltaY || e.deltaX) / view.cell; clampView(); redraw(); return; }
    const f = Math.exp(-Math.max(-120, Math.min(120, e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY)) * 0.0022);
    zoomBy(f, p.px, p.py);
  }
  function onKey(e) {
    if (cfg.keyboard === false || e.target !== canvas) return;
    const step = Math.max(1, Math.round(((view.width - off()) / view.cell) * 0.12));
    const k = e.key;
    if (k === ' ') { spaceDown = true; canvas.style.cursor = 'grab'; e.preventDefault(); return; }
    let handled = true;
    if (k === 'ArrowLeft') view.x -= step; else if (k === 'ArrowRight') view.x += step;
    else if (k === 'ArrowUp') view.y -= step; else if (k === 'ArrowDown') view.y += step;
    else if (k === '+' || k === '=') zoomBy(1.25);
    else if (k === '-' || k === '_') zoomBy(0.8);
    else if (k === '0') fit();
    else handled = false;
    if (handled) { e.preventDefault(); clampView(); redraw(); }
  }
  const onKeyUp = (e) => { if (e.key === ' ') { spaceDown = false; canvas.style.cursor = ''; } };
  const onLeave = () => { if (hover) { hover = null; if (cfg.onHover) cfg.onHover(null); if (rulers()) redraw(); } };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('keydown', onKey);
  canvas.addEventListener('keyup', onKeyUp);
  canvas.style.touchAction = 'none';
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  // Theme changes repaint: drawing colours come from options().dark, which the app derives from the colour scheme.
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  const onScheme = () => redraw();
  mq?.addEventListener?.('change', onScheme);
  resize();

  return {
    canvas, view, redraw, fit, zoomTo, zoomBy, centerOn, cellAtClient,
    get hover() { return hover; },
    setScheme(s, { keepView = false } = {}) { scheme = s; if (!keepView) fit(); else { clampView(); redraw(); } },
    get scheme() { return scheme; },
    destroy() { ro.disconnect(); mq?.removeEventListener?.('change', onScheme); cancelAnimationFrame(raf); canvas.remove(); },
  };
}

// The whole chart in a small canvas with the visible area as a rectangle; a click or drag moves the view there.
// Reuses render.colorBitmap (one pixel per cell, cached on the layer), so the overview costs one drawImage.
// The ruler offset is guessed as 22 px unless options().rulers === false; keep it in sync with RULER above.
// Note: no pointercancel handler, so a cancelled touch leaves drag = true until the next pointerup.
export function createOverview(host, chartView, { size = 160, options = () => ({}), layer = () => null } = {}) {
  const c = document.createElement('canvas');
  c.className = 'st-overview';
  host.append(c);
  let raf = 0;
  function paint() {
    raf = 0;
    const s = chartView.scheme, lay = layer();
    if (!lay) return;
    const k = size / Math.max(s.width, s.height);
    const w = Math.max(1, Math.round(s.width * k)), h = Math.max(1, Math.round(s.height * k));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = w * dpr; c.height = h * dpr; c.style.width = w + 'px'; c.style.height = h + 'px';
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const o = options();
    g.fillStyle = s.fabric.color || '#fff';
    g.fillRect(0, 0, w, h);
    g.imageSmoothingEnabled = k < 1;
    g.drawImage(colorBitmap(s, lay, { highlight: o.highlight ?? -1, done: o.done || null }), 0, 0, w, h);
    const v = chartView.view, off = chartView.canvas && o.rulers === false ? 0 : 22;
    g.strokeStyle = '#e11d48';
    g.lineWidth = 2;
    g.strokeRect(v.x * k, v.y * k, ((v.width - off) / v.cell) * k, ((v.height - off) / v.cell) * k);
  }
  const redraw = () => { if (!raf) raf = requestAnimationFrame(paint); };
  let drag = false;
  const go = (e) => {
    const r = c.getBoundingClientRect(), s = chartView.scheme;
    const k = r.width / s.width;
    chartView.centerOn((e.clientX - r.left) / k, (e.clientY - r.top) / k);
  };
  c.addEventListener('pointerdown', (e) => { drag = true; try { c.setPointerCapture(e.pointerId); } catch { /* ignore */ } go(e); });
  c.addEventListener('pointermove', (e) => { if (drag) go(e); });
  c.addEventListener('pointerup', () => { drag = false; });
  c.style.touchAction = 'none';
  redraw();
  return { canvas: c, redraw, destroy() { cancelAnimationFrame(raf); c.remove(); } };
}
