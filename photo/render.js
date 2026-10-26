// photo/render.js - compositing of a photo document: any region at any scale (the editor renders exactly the visible
// part of the view at screen resolution, so a 6000 × 4000 picture costs what the screen shows), full-size flattening
// for export, single-pixel sampling (eyedropper) and layer thumbnails. Pixel, text and shape layers draw through the
// canvas (opacity, blend modes, masks via destination-in); adjustment layers read the composite below them, apply
// photo/adjust.js and mix by opacity and mask. `live` carries the editor's work in progress: a brush stroke, a
// floating selection being moved, a free transform.

//
// Design rules:
// - One transform T (scale + translate) maps document to output pixels for every layer, so viewport rendering and
//   full-size export are the same code path with different T; nothing is pre-rendered at document size.
// - Fast path: a layer without mask composites straight onto the output with its blend and opacity. Only masked
//   layers (and blended shapes) go through a scratch canvas, because the mask must cut the layer *before* it is
//   blended with what is below; applying destination-in to the output would cut the layers underneath too.
// - Scratch canvases are pooled by name and resized in place: allocating a viewport-sized canvas per layer per frame
//   would churn GPU memory during pans and strokes.
import { applyAdjustment } from './adjust.js';
import { blendOp, contentBox, ctxOf, drawShape, drawText, makeCanvas, maskOrigin } from './doc.js';

/** live: { stroke: { layerId, target: 'pixels' | 'mask', view (canvas), ox, oy, op, opacity, lum }, float: { layerId,
 *  canvas, x, y }, xform: { layerId, matrix: [a, b, c, d, e, f] (document space) }, hide: layerId } */
export function createRenderer() {
  const pool = {};
  const scratch = (name, w, h) => {
    let c = pool[name];
    if (!c) c = pool[name] = makeCanvas(w, h);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return c;
  };

  // A layer's content without opacity / blend / mask, into g (whose transform maps document -> target).
  function drawContent(g, L, live) {
    const xf = live.xform && live.xform.layerId === L.id ? live.xform.matrix : null;
    g.save();
    if (xf) g.transform(...xf);
    if (L.kind === 'raster') {
      g.drawImage(L.canvas, L.x, L.y);
      const st = live.stroke;
      if (st && st.layerId === L.id && st.target === 'pixels') {
        g.globalAlpha = st.opacity;
        g.globalCompositeOperation = st.op;
        g.drawImage(st.view, st.ox, st.oy);
      }
      const fl = live.float;
      if (fl && fl.layerId === L.id) { g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.drawImage(fl.canvas, fl.x, fl.y); }
    } else if (L.kind === 'text') drawText(g, L);
    else if (L.kind === 'shape') drawShape(g, L);
    g.restore();
  }

  // The mask of a layer (with a live mask stroke) into a scratch canvas of the target size.
  function maskInto(name, L, T, W, H, live) {
    const m = scratch(name, W, H), g = ctxOf(m);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    g.setTransform(...T);
    const o = maskOrigin(L);
    const xf = live.xform && live.xform.layerId === L.id ? live.xform.matrix : null;
    if (xf && L.kind === 'raster') g.transform(...xf);
    g.drawImage(L.mask.canvas, o.x, o.y);
    const st = live.stroke;
    if (st && st.layerId === L.id && st.target === 'mask') {
      // mask' = mask (1 - a) + lum * a  for the stroke coverage a: erase by a, then add lum * a
      // 'lighter' is additive (clamped), which is the "+ lum * a" term; two composite passes replace a JS pixel loop.
      g.globalAlpha = st.opacity; g.globalCompositeOperation = 'destination-out'; g.drawImage(st.view, st.ox, st.oy);
      if (st.lum > 0) { g.globalAlpha = st.opacity * st.lum; g.globalCompositeOperation = 'lighter'; g.drawImage(st.view, st.ox, st.oy); }
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    }
    return m;
  }

  /**
   * Renders the document region `rect` (document pixels) at `scale` into `out` (sized round(rect * scale) by the
   * caller); `live` as above. Transparent where no layer covers.
   */
  function renderRegion(doc, rect, scale, out, live = {}) {
    const W = out.width, H = out.height, ctx = ctxOf(out);
    const T = [scale, 0, 0, scale, -rect.x * scale, -rect.y * scale];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, W, H);
    // Zoomed in to 200% and beyond, pixels are shown as crisp squares (smoothing off) so retouching sees real pixels;
    // below that, high-quality smoothing avoids aliasing when downscaling.
    const smooth = scale < 1.999;
    for (const L of doc.layers) {
      if (!L.visible || L.opacity <= 0 || live.hide === L.id) continue;
      const maskOn = !!(L.mask && L.mask.enabled && L.mask.canvas);
      // Adjustment layers are pixel functions of everything below, so they read back the output so far. That readback
      // is the expensive step (GPU to CPU), paid once per visible adjustment layer per render; viewport-sized output
      // keeps it bounded by the screen, not the document.
      if (L.kind === 'adjust') {
        const img = ctx.getImageData(0, 0, W, H);
        const before = maskOn || L.opacity < 1 ? new Uint8ClampedArray(img.data) : null;
        applyAdjustment(L.adjust.type, img, L.adjust.params);
        if (before) {
          const d = img.data, k0 = L.opacity;
          const ma = maskOn ? ctxOf(maskInto('mask', L, T, W, H, live), true).getImageData(0, 0, W, H).data : null;
          // Linear mix of before / after by opacity times mask coverage (alpha unchanged: adjustments never touch it).
          for (let p = 0; p < d.length; p += 4) {
            const k = ma ? (k0 * ma[p + 3]) / 255 : k0;
            if (k >= 1) continue;
            d[p] = before[p] + (d[p] - before[p]) * k; d[p + 1] = before[p + 1] + (d[p + 1] - before[p + 1]) * k; d[p + 2] = before[p + 2] + (d[p + 2] - before[p + 2]) * k;
          }
        }
        ctx.putImageData(img, 0, 0);
        continue;
      }
      // a shape's fill and stroke blend as one picture (as the ImageMagick command composites them)
      if (!maskOn && !(L.kind === 'shape' && L.blend !== 'normal')) {
        ctx.setTransform(...T);
        ctx.imageSmoothingEnabled = smooth; ctx.imageSmoothingQuality = 'high';
        ctx.globalAlpha = L.opacity; ctx.globalCompositeOperation = blendOp(L.blend);
        drawContent(ctx, L, live);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        continue;
      }
      const tmp = scratch('layer', W, H), g = ctxOf(tmp);
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, W, H);
      g.setTransform(...T);
      g.imageSmoothingEnabled = smooth; g.imageSmoothingQuality = 'high';
      drawContent(g, L, live);
      g.setTransform(1, 0, 0, 1, 0, 0);
      if (maskOn) {
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(maskInto('mask', L, T, W, H, live), 0, 0);
        g.globalCompositeOperation = 'source-over';
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = L.opacity; ctx.globalCompositeOperation = blendOp(L.blend);
      ctx.drawImage(tmp, 0, 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return out;
  }

  return {
    renderRegion,
    /** The whole document at full size (a new canvas). */
    flatten(doc, live = {}) { return renderRegion(doc, { x: 0, y: 0, w: doc.width, h: doc.height }, 1, makeCanvas(doc.width, doc.height), live); },
    /** Composite colour at a document pixel: [r, g, b, a]. */
    pixelAt(doc, x, y, radius = 0) {
      // Box average over a (2r + 1)^2 window, rendered through the same compositor so the eyedropper sees exactly what
      // is displayed (adjustment layers included).
      // KNOWN DEFECT: RGB is averaged without alpha weighting, so transparent neighbours (RGB usually 0) darken the
      // sampled colour near edges. Fix: sum RGB * A and divide by the summed A, as pixelate in adjust.js does.
      const n = radius * 2 + 1;
      const c = renderRegion(doc, { x: Math.floor(x) - radius, y: Math.floor(y) - radius, w: n, h: n }, 1, scratch('pixel', n, n));
      const d = ctxOf(c, true).getImageData(0, 0, n, n).data;
      const s = [0, 0, 0, 0];
      for (let p = 0; p < d.length; p += 4) for (let k = 0; k < 4; k++) s[k] += d[p + k];
      return s.map((v) => Math.round(v / (n * n)));
    },
    /** Small picture of a layer (content, or its mask with `mask`) fitted into size × size, on a new or given canvas. */
    thumb(L, doc, size, { mask = false, canvas = null } = {}) {
      const k = Math.min(size / doc.width, size / doc.height);
      const w = Math.max(1, Math.round(doc.width * k)), h = Math.max(1, Math.round(doc.height * k));
      const c = canvas || makeCanvas(w, h);
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      const g = ctxOf(c);
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h);
      g.setTransform(k, 0, 0, k, 0, 0);
      g.imageSmoothingQuality = 'high';
      if (mask && L.mask) {
        g.fillStyle = '#000'; g.fillRect(0, 0, doc.width, doc.height);
        const o = maskOrigin(L);
        g.drawImage(L.mask.canvas, o.x, o.y);
      } else if (L.kind !== 'adjust') drawContent(g, L, {});
      g.setTransform(1, 0, 0, 1, 0, 0);
      return c;
    },
    contentBox,
  };
}
