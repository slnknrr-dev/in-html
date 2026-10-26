// image-processor/stage.js - the preview area: before / after split comparison (draggable, keyboard
// accessible divider), single views, the crop editor (drag / resize box with aspect lock, rule-of-thirds grid,
// keyboard moves) and a busy overlay with progress. Pixel previews arrive as RGBA; the result as encoded bytes.

import { seg, t } from '../ui/app.js';
import { h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// RGBA buffer -> canvas without copying: the ImageData views the same ArrayBuffer (byteOffset respected, length
// limited to w*h*4 in case the buffer is larger).
function paint(canvas, img) {
  canvas.width = img.width; canvas.height = img.height;
  const g = canvas.getContext('2d');
  g.putImageData(new ImageData(new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.width * img.height * 4), img.width, img.height), 0, 0);
}

/**
 * ctx: { view: 'split' | 'after' | 'before', onView(v), split (0..1), onSplit(v), onCrop(rect), aspectOf() -> pixel
 * aspect or null }.
 */
// The "after" view is an <img> of the encoded output bytes (a blob URL), not a canvas of the processed pixels: the user
// sees exactly what will be saved, including JPEG/WebP compression artefacts. "Before" is a canvas of the pre-colour
// pixels at the same geometry, so the split compares like with like.
export function createStage(ctx) {
  const title = h('div', { class: 'ip-title' });
  const viewSeg = h('div', { class: 'ip-viewseg' });
  const renderViewSeg = () => {
    viewSeg.textContent = '';
    viewSeg.append(seg([{ v: 'split', l: 'ip.viewSplit', icon: 'columns' }, { v: 'before', l: 'ip.viewBefore' }, { v: 'after', l: 'ip.viewAfter' }], ctx.view, (v) => { ctx.view = v; ctx.onView(v); applyView(); }, 'ip.view'));
  };
  const bar = h('div', { class: 'ip-bar' }, title, h('span', { class: 'ed-spacer' }), viewSeg);

  const before = h('canvas', { class: 'ip-before', 'aria-hidden': 'true' });
  const after = h('img', { class: 'ip-after', alt: '', decoding: 'async', draggable: 'false' });
  const knob = h('div', { class: 'ip-split', role: 'slider', tabindex: '0', 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('span', { class: 'ip-knob' }, iconEl('chevLeft'), iconEl('chevRight')));
  const tagL = h('span', { class: 'ip-tag ip-tag-l' }), tagR = h('span', { class: 'ip-tag ip-tag-r' });
  const frame = h('div', { class: 'ip-frame' }, after, before, knob, tagL, tagR);
  const base = h('canvas', { class: 'ip-base', 'aria-hidden': 'true' });
  const sizeTag = h('span', { class: 'ip-cdim' });
  const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((d) => h('i', { class: 'ip-h ip-h-' + d, dataset: { h: d } }));
  const cbox = h('div', { class: 'ip-cbox', tabindex: '0', role: 'group' }, h('i', { class: 'ip-thirds' }), sizeTag, ...handles);
  const cframe = h('div', { class: 'ip-frame ip-cframe', hidden: true }, base, cbox);
  const busyText = h('span', { class: 'ip-busy-t' });
  const busy = h('div', { class: 'ip-busy', hidden: true, 'aria-live': 'polite' }, h('span', { class: 'ed-spinner' }), busyText);
  const empty = h('div', { class: 'ip-empty' });
  const surface = h('div', { class: 'ap-surface ip-surface' }, frame, cframe, busy, empty);
  const stats = h('div', { class: 'ip-stats', 'aria-live': 'polite' });
  const el = h('section', { class: 'ap-card ip-stagecard' }, bar, surface, stats);

  let dims = null; // { w, h } of the shown image (aspect source)
  let mode = 'empty'; // 'empty' | 'compare' | 'crop'
  let afterURL = null;
  let crop = null; // { rect, geo: { width, height } }

  // --- layout: fit the active frame inside the surface
  // Fit the frame into the surface (and at most 55-68% of the viewport height), keeping the aspect ratio and never
  // upscaling small images - an enlarged preview would misrepresent sharpness.
  const layout = () => {
    const f = mode === 'crop' ? cframe : frame;
    const d = mode === 'crop' && crop ? { w: crop.geo.width, h: crop.geo.height } : dims;
    if (!d || mode === 'empty') return;
    const cs = getComputedStyle(surface);
    const availW = Math.max(40, surface.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    const maxH = Math.max(200, Math.min(window.innerHeight * (window.innerWidth < 860 ? 0.55 : 0.68), 820));
    const ar = d.w / d.h;
    let fw = Math.min(availW, maxH * ar), fh = fw / ar;
    if (fw > d.w && fh > d.h) { fw = d.w; fh = d.h; } // never upscale small images
    f.style.width = Math.round(fw) + 'px';
    f.style.height = Math.round(fh) + 'px';
    f.classList.toggle('ip-small', fw < 220 || fh < 120);
    if (mode === 'crop') placeBox();
  };
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => layout()).observe(surface);
  window.addEventListener('resize', layout);

  // --- compare view
  // Split by clip-path on the top layer: no re-render of either image while dragging, GPU-composited, and the knob
  // exposes the position as an ARIA slider (valuenow + valuetext).
  const applySplit = () => {
    const pct = Math.round(ctx.split * 1000) / 10;
    before.style.clipPath = ctx.view === 'split' ? `inset(0 ${100 - pct}% 0 0)` : 'none';
    knob.style.left = pct + '%';
    knob.setAttribute('aria-valuenow', String(Math.round(pct)));
    knob.setAttribute('aria-valuetext', t('ip.splitAt', { n: Math.round(pct) }));
  };
  const applyView = () => {
    const v = ctx.view;
    before.hidden = v === 'after';
    after.hidden = v === 'before';
    knob.hidden = v !== 'split';
    tagL.hidden = v === 'after'; tagR.hidden = v === 'before';
    tagL.textContent = t('ip.original'); tagR.textContent = t('ip.result');
    applySplit();
  };
  const splitFrom = (clientX) => { const r = frame.getBoundingClientRect(); ctx.split = clamp((clientX - r.left) / r.width, 0, 1); applySplit(); ctx.onSplit(ctx.split); };
  // Clicking anywhere on the frame jumps the divider there and starts a drag; pointer capture keeps the drag alive
  // outside the frame. Listeners are removed on release, so no global handlers accumulate.
  frame.addEventListener('pointerdown', (e) => {
    if (ctx.view !== 'split' || mode !== 'compare' || e.button > 0) return;
    e.preventDefault();
    frame.setPointerCapture(e.pointerId);
    splitFrom(e.clientX);
    knob.focus({ preventScroll: true });
    const move = (ev) => splitFrom(ev.clientX);
    const up = () => { frame.removeEventListener('pointermove', move); frame.removeEventListener('pointerup', up); frame.removeEventListener('pointercancel', up); };
    frame.addEventListener('pointermove', move);
    frame.addEventListener('pointerup', up);
    frame.addEventListener('pointercancel', up);
  });
  knob.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const k = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step, PageDown: -0.25, PageUp: 0.25 }[e.key];
    if (k != null) ctx.split = clamp(ctx.split + k, 0, 1);
    else if (e.key === 'Home') ctx.split = 0;
    else if (e.key === 'End') ctx.split = 1;
    else return;
    e.preventDefault();
    applySplit();
    ctx.onSplit(ctx.split);
  });

  // --- crop editor
  // Crop rectangles are normalised (0..1 of the geometry size); a pixel aspect a = w/h becomes a * H / W in normalised
  // units, which is what the constraint math needs.
  const aspectN = () => { const a = ctx.aspectOf(crop.geo.width, crop.geo.height); return a ? (a * crop.geo.height) / crop.geo.width : null; }; // normalized w / h
  const placeBox = () => {
    if (!crop) return;
    const r = crop.rect;
    cbox.style.left = r.x * 100 + '%'; cbox.style.top = r.y * 100 + '%';
    cbox.style.width = r.w * 100 + '%'; cbox.style.height = r.h * 100 + '%';
    sizeTag.textContent = `${Math.round(r.w * crop.geo.width)} × ${Math.round(r.h * crop.geo.height)}`;
  };
  // Keeps a rectangle inside the image, at least `min` large, with the locked aspect (anchored on `fix`).
  const constrain = (r, fix = 'c', center = false) => {
    const an = aspectN(), min = 0.02;
    let { x, y, w, h: hh } = r;
    const cx = x + w / 2, cy = y + hh / 2;
    w = clamp(w, min, 1); hh = clamp(hh, min, 1);
    if (an) {
      if (fix === 'h') w = hh * an; else hh = w / an;
      if (w > 1) { w = 1; hh = w / an; }
      if (hh > 1) { hh = 1; w = hh * an; }
    }
    if (center) { x = cx - w / 2; y = cy - hh / 2; }
    return { x: clamp(x, 0, 1 - w), y: clamp(y, 0, 1 - hh), w, h: hh };
  };
  // Drag inside the box moves it (clamped to the image); a handle resizes from that edge/corner. With a locked aspect,
  // the dragged dimension drives the other one and the result is scaled down (k) so it never leaves the image.
  cbox.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    e.stopPropagation();
    cbox.focus({ preventScroll: true });
    const hnd = e.target.dataset ? e.target.dataset.h : null;
    const fr = cframe.getBoundingClientRect();
    const r0 = { ...crop.rect }, x0 = e.clientX, y0 = e.clientY;
    cbox.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const dx = (ev.clientX - x0) / fr.width, dy = (ev.clientY - y0) / fr.height;
      const an = aspectN();
      if (!hnd) { crop.rect = { ...r0, x: clamp(r0.x + dx, 0, 1 - r0.w), y: clamp(r0.y + dy, 0, 1 - r0.h) }; placeBox(); return; }
      let left = r0.x, top = r0.y, right = r0.x + r0.w, bottom = r0.y + r0.h;
      if (hnd.includes('w')) left = clamp(left + dx, 0, right - 0.02);
      if (hnd.includes('e')) right = clamp(right + dx, left + 0.02, 1);
      if (hnd.includes('n')) top = clamp(top + dy, 0, bottom - 0.02);
      if (hnd.includes('s')) bottom = clamp(bottom + dy, top + 0.02, 1);
      let r = { x: left, y: top, w: right - left, h: bottom - top };
      if (an) {
        // Locked aspect: the dragged edge drives the size, the opposite edge / corner (or the centre line) stays.
        const byH = hnd === 'n' || hnd === 's';
        let w = byH ? r.h * an : r.w, hh = byH ? r.h : r.w / an;
        const cx = r0.x + r0.w / 2, cy = r0.y + r0.h / 2;
        const maxW = hnd.includes('w') ? right : hnd.includes('e') ? 1 - left : 2 * Math.min(cx, 1 - cx);
        const maxH = hnd.includes('n') ? bottom : hnd.includes('s') ? 1 - top : 2 * Math.min(cy, 1 - cy);
        const k = Math.min(1, maxW / w, maxH / hh);
        w *= k; hh *= k;
        r = {
          x: hnd.includes('w') ? right - w : hnd.includes('e') ? left : cx - w / 2,
          y: hnd.includes('n') ? bottom - hh : hnd.includes('s') ? top : cy - hh / 2,
          w, h: hh,
        };
      }
      crop.rect = r;
      placeBox();
    };
    const up = () => {
      cbox.removeEventListener('pointermove', move); cbox.removeEventListener('pointerup', up); cbox.removeEventListener('pointercancel', up);
      ctx.onCrop({ ...crop.rect });
    };
    cbox.addEventListener('pointermove', move);
    cbox.addEventListener('pointerup', up);
    cbox.addEventListener('pointercancel', up);
  });
  // Keyboard crop: arrows move by 1% (Alt: 0.2%), Shift+arrows resize; the aspect constraint is re-applied each step.
  cbox.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d || !crop) return;
    e.preventDefault();
    const s = e.altKey ? 0.002 : 0.01;
    const r = { ...crop.rect };
    if (e.shiftKey) { r.w += d[0] * s; r.h += d[1] * s; crop.rect = constrain(r, d[1] ? 'h' : 'w'); }
    else crop.rect = constrain({ ...r, x: r.x + d[0] * s, y: r.y + d[1] * s });
    placeBox();
    ctx.onCrop({ ...crop.rect });
  });

  const setMode = (m) => {
    mode = m;
    frame.hidden = m !== 'compare';
    cframe.hidden = m !== 'crop';
    empty.hidden = m !== 'empty';
    surface.classList.toggle('ip-is-empty', m === 'empty');
    viewSeg.hidden = m !== 'compare';
    bar.hidden = m === 'empty' && !title.textContent;
    layout();
  };

  renderViewSeg();
  applyView();
  setMode('empty');

  return {
    el,
    surface,
    /** Empty state content (drop zone) and title. */
    empty(content) { empty.textContent = ''; if (content) empty.append(content); title.textContent = ''; stats.textContent = ''; dims = null; setMode('empty'); },
    setTitle(text, sub) { title.textContent = ''; title.append(...[h('b', {}, text), sub ? h('span', { class: 'ed-muted' }, sub) : null].filter(Boolean)); bar.hidden = false; },
    /** Shows a processed result: res.before (RGBA preview), res.bytes + res.mime (output). */
    showResult(res) {
      if (res.before) paint(before, res.before);
      if (afterURL) URL.revokeObjectURL(afterURL);
      afterURL = URL.createObjectURL(new Blob([res.bytes], { type: res.mime }));
      after.src = afterURL;
      after.alt = t('ip.resultAlt', { w: res.width, h: res.height });
      dims = { w: res.width, h: res.height };
      setMode('compare');
      applyView();
    },
    /** Crop editor over the pre-crop geometry preview; rect normalized (null: full image or the aspect default). */
    showCrop(res, rect) {
      paint(base, res.base);
      crop = { geo: res.geometry, rect: rect ? { ...rect } : null };
      if (!crop.rect) {
        const c = res.crop;
        crop.rect = { x: c.x / res.geometry.width, y: c.y / res.geometry.height, w: c.w / res.geometry.width, h: c.h / res.geometry.height };
      }
      crop.rect = constrain(crop.rect, 'w', true);
      cbox.setAttribute('aria-label', t('ip.cropBox'));
      setMode('crop');
      placeBox();
    },
    get cropping() { return mode === 'crop'; },
    cropRect() { return crop ? { ...crop.rect } : null; },
    /** Re-applies the aspect lock (after the aspect setting changed). */
    reaspect() { if (crop) { crop.rect = constrain(crop.rect, 'w', true); placeBox(); ctx.onCrop({ ...crop.rect }); } },
    exitCrop() { if (mode === 'crop') setMode(dims ? 'compare' : 'empty'); },
    setBusy(on, text = '') { busy.hidden = !on; busyText.textContent = text; surface.classList.toggle('ip-working', !!on); },
    setStats(nodes) { stats.textContent = ''; if (nodes) stats.append(...[].concat(nodes)); },
    relabel() { renderViewSeg(); applyView(); },
    layout,
  };
}
