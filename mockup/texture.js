// mockup/texture.js - textures of simulated pattern pieces, drawn in the piece's own centimetres so that the 2D
// pattern and the 3D garment show the same thing at the same place: the fabric at its true thread density (one tile of
// the weave and colour repeat, area-filtered into texels through a summed-area table, so fine weaves average out
// instead of shimmering and tartans and checks keep their real size; optional thread zoom for display), turned to the
// piece's grainline; a repeat print in the frame of the drafts (pieces that share a frame continue the pattern across
// their seams); placement prints (images or motifs) at their position on the piece.
//
//   pieceTexture(instance, { fabric, design, placements, images, pxPerCm, maxSize, threadZoom }) ->
//     { texture: { width, height, data }, uv: Float32Array (2 per vertex of the instance), box }
//
// Anti-aliasing approach: a weave has threads finer than a texel (6 px/cm texture vs 40 threads/cm), so point
// sampling would alias into moire. Each texel instead averages the exact tile area it covers, computed in O(1) from
// a summed-area table, which is a box filter of exactly the right width at any scale or rotation.

import { fabricTexture } from '../fabric/texture.js';
import { applyDye } from '../fabric/dye.js';
import { canvas, drawImage, fillPolys, mulM, trsM } from '../motif/raster.js';
import { renderInto } from '../motif/repeat.js';
import { motifPolys } from '../motif/motifs.js';

// Insertion-ordered Map used as a small FIFO cache (24 fabrics). Keyed by the whole normalised fabric JSON, so the
// dye (irrelevant to the tile) also splits the cache; harmless at this size.
const swatchCache = new Map();

// Summed-area table of a fabric tile (rendered at 3 px per thread) for box-filtered sampling.
// Float64 accumulation: 768 x 768 x 255 sums overflow Float32's exact integer range (2^24) and would bias the means.
function swatch(fabric) {
  const key = JSON.stringify(fabric);
  let s = swatchCache.get(key);
  if (s) return s;
  const t = fabricTexture(fabric, { px: 3, maxSize: 768 });
  const W = t.width, H = t.height;
  const sat = new Float64Array((W + 1) * (H + 1) * 3);
  for (let y = 0; y < H; y++) {
    let r = 0, g = 0, b = 0;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      r += t.data[i]; g += t.data[i + 1]; b += t.data[i + 2];
      const o = ((y + 1) * (W + 1) + x + 1) * 3, u = (y * (W + 1) + x + 1) * 3;
      sat[o] = sat[u] + r; sat[o + 1] = sat[u + 1] + g; sat[o + 2] = sat[u + 2] + b;
    }
  }
  // Pixels per centimetre of the tile at the fabric's true density.
  s = { W, H, sat, ppc: (t.px * fabric.threadsPerCm) };
  swatchCache.set(key, s);
  if (swatchCache.size > 24) swatchCache.delete(swatchCache.keys().next().value);
  return s;
}

// Mean colour of the tile over [x0, x1) x [y0, y1) in tile pixels (wrapping), via the summed-area table.
// Standard SAT rectangle sum D - B - C + A, split at tile boundaries because the box may straddle the tile edge
// (the fabric repeats infinitely). Bounds are rounded outward to whole tile pixels; the area divides it back out.
function boxMean(s, x0, y0, x1, y1, out) {
  const { W, H, sat } = s;
  const rect = (a, b, c, d, acc) => {
    const S = (x, y) => (y * (W + 1) + x) * 3;
    for (let k = 0; k < 3; k++) acc[k] += sat[S(c, d) + k] - sat[S(a, d) + k] - sat[S(c, b) + k] + sat[S(a, b) + k];
  };
  const acc = [0, 0, 0];
  let area = 0;
  // Split the box at tile boundaries.
  for (let ty = Math.floor(y0 / H); ty * H < y1; ty++) {
    for (let tx = Math.floor(x0 / W); tx * W < x1; tx++) {
      const a = Math.max(0, Math.floor(x0 - tx * W)), b = Math.max(0, Math.floor(y0 - ty * H));
      const c = Math.min(W, Math.ceil(x1 - tx * W)), d = Math.min(H, Math.ceil(y1 - ty * H));
      if (c > a && d > b) { rect(a, b, c, d, acc); area += (c - a) * (d - b); }
    }
  }
  out[0] = acc[0] / area; out[1] = acc[1] / area; out[2] = acc[2] / area;
}

export function pieceTexture(inst, o = {}) {
  const xy = inst.xy, n = xy.length / 2;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { const x = xy[i * 2], y = xy[i * 2 + 1]; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  x0 -= 0.5; y0 -= 0.5; x1 += 0.5; y1 += 0.5;
  const maxSize = o.maxSize || 768;
  const ppc = Math.min(o.pxPerCm || 8, maxSize / Math.max(x1 - x0, y1 - y0));
  const W = Math.max(2, Math.ceil((x1 - x0) * ppc)), H = Math.max(2, Math.ceil((y1 - y0) * ppc));
  const cv = canvas(W, H, '#ffffff');
  if (o.fabric) {
    const s = swatch(o.fabric);
    // Tile pixels per texel; the grain turns the fabric with the piece.
    const zoom = o.threadZoom || 1;
    const k = s.ppc / ppc / zoom;
    let ga = 0;
    const g = inst.piece?.grain;
    // The grainline is the warp direction; the fabric frame is rotated to it so stripes follow the cut. Near-zero
    // angles snap to 0 to avoid a faint diagonal shimmer on pieces that are meant to be on grain.
    if (g) { const dx = g[1][0] - g[0][0], dy = g[1][1] - g[0][1]; ga = Math.atan2(dx, dy); if (Math.abs(ga) < 0.03) ga = 0; }
    const cs = Math.cos(ga), sn = Math.sin(ga);
    const c = [0, 0, 0];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // Texel centre in piece cm, turned into the grain frame, then into tile pixels.
        const px = x0 + (x + 0.5) / ppc, py = y0 + (y + 0.5) / ppc;
        const u = (px * cs - py * sn) * s.ppc / zoom, v = (px * sn + py * cs) * s.ppc / zoom;
        const half = Math.max(0.5, k / 2);
        boxMean(s, u - half, v - half, u + half, v + half, c);
        const i = (y * W + x) * 4;
        cv.data[i] = c[0]; cv.data[i + 1] = c[1]; cv.data[i + 2] = c[2]; cv.data[i + 3] = 255;
      }
    }
  }
  // Dye over the fabric, in the drafts' frame (pieces sharing a frame dye continuously across their seams).
  const dye = o.fabric && o.fabric.dye;
  if (dye && dye.kind !== 'none') {
    const c = [0, 0, 0], q = [0, 0, 0];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        c[0] = cv.data[i]; c[1] = cv.data[i + 1]; c[2] = cv.data[i + 2];
        applyDye(c, dye, x0 + (x + 0.5) / ppc, y0 + (y + 0.5) / ppc, q);
        cv.data[i] = q[0]; cv.data[i + 1] = q[1]; cv.data[i + 2] = q[2];
      }
    }
  }
  // Repeat print: design centimetres in the drafts' frame -> texels.
  // Layer order matches the physical process: fabric, then dye, then the repeat print, then placement prints on top.
  if (o.design) renderInto(cv, o.design, [ppc, 0, 0, ppc, -x0 * ppc, -y0 * ppc], { images: o.images, alpha: o.designAlpha ?? 1 });
  for (const pl of o.placements || []) drawPlacement(cv, pl, ppc, x0, y0, o.images);
  // UVs map each vertex's 2D pattern position to the texture, so the 3D drape shows exactly the flat piece.
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { uv[i * 2] = (xy[i * 2] - x0) * ppc / W; uv[i * 2 + 1] = (xy[i * 2 + 1] - y0) * ppc / H; }
  return { texture: cv, uv, box: { x0, y0, x1, y1, ppc } };
}

// A placement print: centre (x, y), width w (cm), height from the artwork's aspect, rotation in degrees.
export function drawPlacement(cv, pl, ppc, x0 = 0, y0 = 0, images = {}) {
  const cx = (pl.x - x0) * ppc, cy = (pl.y - y0) * ppc;
  if (pl.art.kind === 'image' && images[pl.art.id]) {
    const img = images[pl.art.id];
    const w = pl.w * ppc, h = (pl.h ?? (pl.w * img.height) / img.width) * ppc;
    const m = mulM(trsM(cx, cy, 1, pl.rot), [w, 0, 0, h, -w / 2, -h / 2]);
    drawImage(cv, img, m, { alpha: pl.opacity ?? 1 });
  } else if (pl.art.kind === 'motif') {
    fillPolys(cv, motifPolys(pl.art.motif), pl.art.color, { m: trsM(cx, cy, (pl.w * ppc) / 2, pl.rot), alpha: pl.opacity ?? 1 });
  }
}
