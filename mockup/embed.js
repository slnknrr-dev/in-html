// mockup/embed.js - the browser side of previews: a 3D viewer in a container (WebGL, or the software renderer into a
// 2D canvas when WebGL is missing), orbit controls for mouse, touch and keys, a time-sliced drape (the simulation runs
// up to o.budget ms, default 24, per animation frame so the page stays responsive, on message-channel ticks while the
// tab or pane is hidden where animation frames stop, then cools down and stops), texture refreshes
// without re-draping, screenshots. Used by the studio and meant for landing / shop blocks:
//
//   const v = mountPreview(element, spec, { images })   // spec: see mockup/preview.js; images decoded by decodeImages
//   v.update(spec)  v.setView({ yaw, pitch, zoom })  await v.snapshot({ width, height, yaw }) -> data URL  v.destroy()
//   createViewer(element, { onStatus, background }) -> viewer: load(prep), refresh({ images }), redraw(), ...
//   decodeImages({ id: dataURL }) -> Promise<{ id: { width, height, data } }>
//
// Scheduling design: the cloth solver is CPU-bound and runs on the main thread (it shares state with the renderer),
// so it is time-sliced: each tick steps the simulation until a millisecond budget is spent, then yields to the
// browser. requestAnimationFrame stops in hidden tabs, and setTimeout is throttled to 1 Hz there, so hidden ticks go
// through MessageChannel, which is not throttled. raf === -1 marks "a message tick is pending".

import { prepare, buildScene, cameraFor, coolDown } from './preview.js';
import { createGL } from '../view3d/webgl.js';
import { renderSoft } from '../view3d/soft.js';

const hex01 = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

export function createViewer(el, o = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = o.className || 'tx-3d-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', o.label || '3D');
  canvas.tabIndex = 0;
  canvas.style.touchAction = 'none';
  el.append(canvas);
  // preserve = preserveDrawingBuffer, needed for toDataURL screenshots of the live canvas; without WebGL the software
  // renderer draws into a 2D context at 0.75 CSS-pixel density (it is CPU-bound, resolution is its main cost).
  let gl = o.forceSoft ? null : createGL(canvas, { preserve: true });
  let ctx2d = null;
  if (!gl) ctx2d = canvas.getContext('2d');
  const view = { yaw: 0, pitch: 0.06, zoom: 1 };
  let prep = null, scene = null, images = {}, frame = 0, target = 0, running = false, raf = 0, dirty = true, threadZoom = 1;
  const status = (s) => o.onStatus && o.onStatus(s);
  // Backing store sized to CSS size x devicePixelRatio (capped at 2: 3x phones would quadruple fill cost for little
  // visible gain). Resizing clears the canvas, so it marks the frame dirty.
  const size = () => {
    const r = el.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(64, Math.round(r.width * (gl ? dpr : 0.75))), h = Math.max(64, Math.round(r.height * (gl ? dpr : 0.75)));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; dirty = true; }
  };
  const bg = () => (o.background ? o.background() : ['#eef0f4', '#cdd2da']).map(hex01);
  const draw = () => {
    if (!prep || !scene) return;
    size();
    const cam = cameraFor(prep, view);
    if (gl) {
      gl.updatePositions(prep.sim.cloth.pos);
      gl.render(cam, { background: bg() });
    } else {
      const img = renderSoft(scene, cam, { width: canvas.width, height: canvas.height, background: bg() });
      ctx2d.putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
    }
    dirty = false;
  };
  const tick = () => {
    raf = 0;
    if (!prep) return;
    if (running) {
      const t0 = performance.now();
      const budget = document.hidden ? 60 : o.budget || 24;
      while (frame < target && performance.now() - t0 < budget) { prep.sim.cloth.step(1 / 60); frame++; }
      if (frame >= target) {
        coolDown(prep, 20);
        running = false;
        const st = prep.sim.cloth.stats();
        status({ state: 'done', frame, target, stats: st, mode: gl ? 'webgl' : 'soft' });
      } else status({ state: 'draping', frame, target, mode: gl ? 'webgl' : 'soft' });
      // Positions moved: the buttons follow at the end; the cloth buffer is re-uploaded every frame.
      // The scene (textures, buttons placed on vertices) is rebuilt once when draping ends, not per frame: texture
      // generation is the expensive part and the cloth buffer is uploaded separately each frame.
      if (!running) scene = rebuild();
      dirty = true;
    }
    if (dirty && !document.hidden) draw();
    if (running || dirty) schedule();
  };
  // Animation frames while visible; message-channel ticks (not throttled like timers) while hidden.
  const mc = typeof MessageChannel === 'function' ? new MessageChannel() : null;
  if (mc) mc.port1.onmessage = () => { if (raf === -1) tick(); };
  const schedule = () => {
    if (document.hidden && running && mc) { raf = -1; mc.port2.postMessage(0); } else raf = requestAnimationFrame(tick);
  };
  const kick = () => { if (!raf) schedule(); };
  // Switch scheduler on visibility change: back to rAF when shown, to message ticks when hidden mid-drape, so the
  // drape finishes in a background tab instead of freezing.
  const onVis = () => { if (!document.hidden && raf === -1) { raf = 0; kick(); } else if (document.hidden && running && raf > 0) { cancelAnimationFrame(raf); raf = 0; schedule(); } };
  document.addEventListener('visibilitychange', onVis);
  const rebuild = () => {
    const sc = buildScene(prep, { images, threadZoom });
    if (gl) gl.setScene(sc);
    return sc;
  };
  // Orbit: drag to turn, wheel / pinch to zoom, arrows and +/- keys.
  // Pointer Events unify mouse, pen and touch; setPointerCapture keeps the drag alive outside the canvas.
  // touch-action: none (set above) stops the browser from scrolling or zooming the page during a gesture.
  const ptrs = new Map();
  let last = null, pinch = 0;
  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); last = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) view.zoom = Math.max(0.5, Math.min(4, view.zoom * (d / pinch)));
      pinch = d;
    } else if (last) {
      view.yaw -= (e.clientX - last[0]) * 0.01;
      view.pitch = Math.max(-0.6, Math.min(1.2, view.pitch + (e.clientY - last[1]) * 0.006));
      last = [e.clientX, e.clientY];
    }
    dirty = true; kick();
  });
  const up = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = 0; last = ptrs.size ? [...ptrs.values()][0] : null; };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  // passive: false is required to call preventDefault (stop page scroll); exponential zoom feels uniform across
  // trackpads and wheels with different delta sizes.
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); view.zoom = Math.max(0.5, Math.min(4, view.zoom * Math.exp(-e.deltaY * 0.0012))); dirty = true; kick(); }, { passive: false });
  canvas.addEventListener('keydown', (e) => {
    const k = { ArrowLeft: () => (view.yaw += 0.2), ArrowRight: () => (view.yaw -= 0.2), ArrowUp: () => (view.pitch = Math.min(1.2, view.pitch + 0.1)), ArrowDown: () => (view.pitch = Math.max(-0.6, view.pitch - 0.1)), '+': () => (view.zoom = Math.min(4, view.zoom * 1.15)), '-': () => (view.zoom = Math.max(0.5, view.zoom / 1.15)) }[e.key];
    if (k) { e.preventDefault(); k(); dirty = true; kick(); }
  });
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { dirty = true; kick(); }) : null;
  ro?.observe(el);
  const api = {
    canvas, view,
    get mode() { return gl ? 'webgl' : 'soft'; },
    get prep() { return prep; },
    get running() { return running; },
    // A prepared preview (mockup/preview.js prepare): drapes it unless its drape is baked.
    load(p, opts = {}) {
      prep = p;
      if (opts.images) images = opts.images;
      if (opts.threadZoom) threadZoom = opts.threadZoom;
      frame = 0;
      target = p.spec.drape ? 0 : (opts.frames ?? p.spec.sim.frames);
      running = target > 0;
      scene = rebuild();
      dirty = true;
      status({ state: running ? 'draping' : 'done', frame, target, mode: gl ? 'webgl' : 'soft' });
      kick();
    },
    // New textures (fabric, prints, images) on the same drape.
    refresh(opts = {}) {
      if (!prep) return;
      if (opts.images) images = opts.images;
      if (opts.threadZoom) threadZoom = opts.threadZoom;
      if (opts.fabricFor) prep.fabricFor = opts.fabricFor;
      if (opts.garments) prep.spec.garments = opts.garments;
      prep.sim.instances.forEach((it) => { it.fabric = prep.fabricFor(it.garment, it.material); });
      scene = rebuild();
      dirty = true; kick();
    },
    setView(v) { Object.assign(view, v); dirty = true; kick(); },
    pause() { running = false; status({ state: 'paused', frame, target }); },
    resume(extra = 60) { if (!prep) return; target = frame + extra; running = true; kick(); },
    redraw() { dirty = true; kick(); },
    stats() { return prep ? prep.sim.cloth.stats() : null; },
    // Screenshot at any size and angle (offscreen software or WebGL canvas), as a PNG data URL.
    // Renders into a fresh offscreen canvas so the screenshot size and angle are independent of the visible view;
    // a separate WebGL context is created and disposed (browsers cap live contexts at ~16).
    async snapshot(s = {}) {
      if (!prep) return null;
      const w = s.width || canvas.width, h = s.height || canvas.height;
      const v = { ...view, ...(s.view || {}) };
      const cam = cameraFor(prep, v);
      const c2 = document.createElement('canvas');
      c2.width = w; c2.height = h;
      const g2 = gl && !s.soft ? createGL(c2, { preserve: true }) : null;
      if (g2) { g2.setScene(buildScene(prep, { images, threadZoom })); g2.render(cam, { background: bg() }); const url = c2.toDataURL('image/png'); g2.dispose(); return url; }
      const img = renderSoft(buildScene(prep, { images, threadZoom }), cam, { width: w, height: h, ss: s.ss || 2, background: bg() });
      c2.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
      return c2.toDataURL('image/png');
    },
    destroy() { if (raf > 0) cancelAnimationFrame(raf); raf = 0; document.removeEventListener('visibilitychange', onVis); if (mc) mc.port1.onmessage = null; ro?.disconnect(); gl?.dispose(); canvas.remove(); prep = null; },
  };
  return api;
}

// Decodes data URLs (PNG, JPEG, WebP, GIF, SVG) into RGBA images for the texture builder.
// The browser decodes (img.decode handles every format it supports); pixels are read back through a 2D canvas,
// downscaled to 1024 px max so textures stay within the rasterizer's budget. Failures skip the image silently.
export async function decodeImages(map) {
  const out = {};
  for (const [id, src] of Object.entries(map || {})) {
    try {
      const img = new Image();
      img.src = src;
      await img.decode();
      const max = 1024, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0, c.width, c.height);
      const d = x.getImageData(0, 0, c.width, c.height);
      out[id] = { width: d.width, height: d.height, data: d.data };
    } catch { /* unreadable image: skipped */ }
  }
  return out;
}

// One call for an embedding page: a viewer showing the spec (draped live unless its drape is baked).
export function mountPreview(el, spec, o = {}) {
  const v = createViewer(el, o);
  const go = async (s) => {
    const images = o.images || (s.images ? await decodeImages(s.images) : {});
    v.load(prepare(s), { images });
    if (s.view) v.setView(s.view);
  };
  go(spec);
  v.update = (s) => go(s);
  return v;
}
