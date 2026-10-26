// photo/paint.js - brush strokes of the photo editor. Dabs of a round tip (size, hardness) are stamped along the
// pointer path into a stroke buffer the size of the target canvas, so a stroke never exceeds its opacity however its
// dabs overlap (as in Photoshop); the buffer is clipped to the selection incrementally (a second canvas re-clipped
// per dirty area, never twice) and composited onto the target at the end: paint (source-over), erase
// (destination-out), mask (erase by coverage, add the colour's luminance) or clone (dabs carry pixels of a source
// snapshot at an offset).
//
//   const s = createStroke({ target, ox, oy, mode, color, size, hardness, opacity, sel, clone: { canvas, dx, dy } })
//   s.to(x, y, pressure)  (document coordinates; the first call places the first dab)
//   s.live -> { view, ox, oy, op, opacity, lum } for photo/render.js        s.rect -> dirty rectangle in target pixels
//   s.commit() draws the stroke onto the target canvas (the caller records the dirty rectangle around it)

import { clipRect, clipToSelection, ctxOf, makeCanvas, unionRect } from './doc.js';

// Why a separate stroke buffer: stamping dabs directly onto the layer at opacity 0.5 would compound where dabs overlap
// (0.5, 0.75, 0.875...), so one slow stroke ends up opaque. Dabs are stamped at full strength into the buffer (where
// overlaps saturate to the tip's own alpha) and the buffer is composited once at the stroke's opacity.

// Tips cached by (diameter, hardness rounded to 0.01). Cleared wholesale past 64 entries: pressure strokes create many
// diameters, and an LRU is not worth it for canvases this cheap to rebuild.
const tips = new Map();
/** White round tip of a diameter with alpha falling off beyond hardness * radius (cached). */
export function brushTip(diameter, hardness) {
  const d = Math.max(1, Math.round(diameter)), hd = Math.round(Math.max(0, Math.min(1, hardness)) * 100) / 100;
  const key = d + ':' + hd;
  let c = tips.get(key);
  if (c) return c;
  const size = d + 2, r = d / 2, inner = r * hd, cx = size / 2;
  c = makeCanvas(size, size);
  const img = new ImageData(size, size), px = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 4 sub-samples per axis: smooth edges for small tips
      let a = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const dist = Math.hypot(x + (sx + 0.5) / 4 - cx, y + (sy + 0.5) / 4 - cx);
          if (dist >= r) continue;
          // Solid core up to hardness * r, then a raised-cosine falloff to 0 at r: C1-continuous at both ends, so no
          // visible ring where the core meets the soft edge (a linear ramp shows one).
          a += dist <= inner ? 1 : 0.5 + 0.5 * Math.cos((Math.PI * (dist - inner)) / Math.max(1e-6, r - inner));
        }
      }
      const p = (y * size + x) * 4;
      px[p] = px[p + 1] = px[p + 2] = 255; px[p + 3] = Math.round((a / 16) * 255);
    }
  }
  ctxOf(c).putImageData(img, 0, 0);
  if (tips.size > 64) tips.clear();
  tips.set(key, c);
  return c;
}

// Painting on a mask with a colour paints its Rec. 709 luma: black hides, white reveals, greys partially, as in
// Photoshop's mask painting. Expects '#rrggbb'.
const lumOf = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

export function createStroke({ target, ox = 0, oy = 0, mode = 'paint', color = '#000000', size = 20, hardness = 0.8, opacity = 1, sel = null, clone = null, pressure = false, onMask = false }) {
  const W = target.width, H = target.height;
  const buf = makeCanvas(W, H), bg = ctxOf(buf);
  // With a selection, `view` is the clipped copy shown and committed; `buf` stays unclipped so a re-clip of a dirty
  // area starts from clean pixels. Clipping in place would multiply by coverage again for every overlapping dab.
  const view = sel ? makeCanvas(W, H) : buf;
  const tinted = makeCanvas(4, 4), tg = ctxOf(tinted);
  const dab = clone ? makeCanvas(4, 4) : null;
  let last = null, rect = null, pending = null, residue = 0;

  function stamp(x, y, p) {
    const d = Math.max(1, size * (pressure ? 0.2 + 0.8 * p : 1));
    const tip = brushTip(d, hardness), s = tip.width;
    const lx = x - ox - s / 2, ly = y - oy - s / 2;
    if (clone) {
      dab.width = s; dab.height = s;
      const g = ctxOf(dab);
      g.drawImage(clone.canvas, x - clone.dx - s / 2 - (clone.ox || 0), y - clone.dy - s / 2 - (clone.oy || 0), s, s, 0, 0, s, s);
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(tip, 0, 0);
      bg.drawImage(dab, lx, ly);
    } else if (mode === 'paint' && !onMask) {
      // The tip is white; a coloured copy is made once per (size, colour, hardness) with source-in (keep tip alpha,
      // take fill colour) instead of recolouring per dab. Resizing a canvas clears it, hence the key reset.
      if (tinted.width !== s) { tinted.width = s; tinted.height = s; tinted._key = ''; }
      const key = `${s}:${color}:${hardness}`;
      if (tinted._key !== key) {
        tg.globalCompositeOperation = 'source-over'; tg.clearRect(0, 0, s, s); tg.drawImage(tip, 0, 0);
        tg.globalCompositeOperation = 'source-in'; tg.fillStyle = color; tg.fillRect(0, 0, s, s);
        tinted._key = key;
      }
      bg.drawImage(tinted, lx, ly);
    } else bg.drawImage(tip, lx, ly);
    const r = clipRect({ x: lx - 1, y: ly - 1, w: s + 2, h: s + 2 }, W, H);
    if (r) { rect = unionRect(rect, r); pending = unionRect(pending, r); }
  }

  function flush() {
    if (!sel || !pending) { pending = null; return; }
    // re-clip the changed area from the unclipped buffer
    const g = ctxOf(view);
    g.clearRect(pending.x, pending.y, pending.w, pending.h);
    g.drawImage(buf, pending.x, pending.y, pending.w, pending.h, pending.x, pending.y, pending.w, pending.h);
    clipToSelection(view, sel, ox, oy, pending);
    pending = null;
  }

  return {
    to(x, y, p = 1) {
      if (!last) { stamp(x, y, p); last = { x, y }; flush(); return; }
      // Dab spacing 12% of the diameter (smooth to the eye, cheap enough), at least 0.75 px. `residue` carries the
      // distance already travelled since the last dab across pointer events, so spacing stays uniform whatever the
      // event rate; restarting at each event would clump dabs at event points.
      const d = Math.max(1, size * (pressure ? 0.2 + 0.8 * p : 1)), step = Math.max(0.75, d * 0.12);
      const dist = Math.hypot(x - last.x, y - last.y);
      let t = step - residue;
      while (t <= dist) { stamp(last.x + ((x - last.x) * t) / dist, last.y + ((y - last.y) * t) / dist, p); t += step; }
      residue = dist - (t - step);
      last = { x, y };
      flush();
    },
    get rect() { return rect; },
    get live() {
      return { view, ox, oy, opacity, op: mode === 'erase' && !onMask ? 'destination-out' : 'source-over', lum: onMask ? (mode === 'erase' ? 1 : lumOf(color)) : 0 };
    },
    /** Draws the stroke onto the target canvas. */
    commit() {
      if (!rect) return null;
      const g = ctxOf(target);
      g.save();
      if (onMask) {
        const lum = mode === 'erase' ? 1 : lumOf(color);
        g.globalAlpha = opacity; g.globalCompositeOperation = 'destination-out'; g.drawImage(view, 0, 0);
        if (lum > 0) { g.globalAlpha = opacity * lum; g.globalCompositeOperation = 'lighter'; g.drawImage(view, 0, 0); }
      } else {
        g.globalAlpha = opacity;
        g.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over';
        g.drawImage(view, 0, 0);
      }
      g.restore();
      return rect;
    },
  };
}
