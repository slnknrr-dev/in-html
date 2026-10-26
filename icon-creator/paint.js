// icon-creator/paint.js - pixel operations of the icon editor on RGBA images { width, height, data }: hard-edged
// pencil dabs (square brush of n px, optional mirror), Bresenham lines, rectangles and ellipses (outline or filled),
// bucket fill through the magic wand mask (raster/wand.js), alpha-correct "over" blending, and selection masks
// (full-size Uint8Array, 0..255) used to clip every operation. No DOM.
//
// Design rules:
// - Hard edges only (no anti-aliasing): icons at 32-64 px are pixel art; a soft brush would smear partial-alpha
//   pixels that look muddy on both light and dark taskbars. Shapes are returned as point lists and stamped with
//   dab(), so every tool shares one plotting path (mask clipping, mirror, blend mode).
// - Straight (non-premultiplied) alpha in storage, because that is what PNG/ICO store and what ImageData uses;
//   blending converts on the fly in plot().
// - Selection masks are 8-bit coverage, not booleans: a wand selection with soft tolerance edges or a feathered
//   result scales the effect per pixel. null means "no selection", i.e. operations apply everywhere.

import { wandMask } from '../raster/wand.js';

// Uint8ClampedArray zero-filled = fully transparent black, the neutral start of an icon.
export const blank = (n) => ({ width: n, height: n, data: new Uint8ClampedArray(n * n * 4) });
export const copyImage = (img) => ({ width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) });

/** '#rrggbb' + alpha 0..255 -> [r, g, b, a]. */
// Fail-soft: an invalid hex yields black rather than throwing mid-stroke (the colour input always gives #rrggbb).
export function rgba(hex, a = 255) {
  const v = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = v ? parseInt(v[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, Math.max(0, Math.min(255, Math.round(a)))];
}
export const hexOf = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

/**
 * Sets one pixel. mode 'over' blends the colour over the pixel, 'replace' writes it (an eraser is 'replace' with
 * alpha 0); mask (optional) clips and scales the effect by its coverage.
 */
// 'over' is Porter-Duff source-over in straight alpha: out_a = sa + da(1 - sa); out_rgb = (c*sa + d*da*(1 - sa))
// / out_a. The division un-premultiplies the result back into storage form; skipping it (the naive lerp) darkens
// semi-transparent edges because transparent black would count as colour.
// Fast path: an unmasked 'replace' is a plain 4-byte write (the eraser and fill hit this most of the time).
export function plot(img, x, y, c, mode = 'over', mask = null) {
  const { width: W, height: H, data } = img;
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = y * W + x;
  const m = mask ? mask[i] / 255 : 1;
  if (!m) return;
  const p = i * 4;
  if (mode === 'replace' && m === 1) { data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = c[3]; return; }
  const sa = (mode === 'replace' ? 1 : c[3] / 255) * m;
  if (mode === 'replace') {
    // partial coverage of a replace: interpolate straight towards the target (alpha included)
    for (let k = 0; k < 4; k++) data[p + k] = Math.round(data[p + k] + (c[k] - data[p + k]) * sa);
    return;
  }
  const da = data[p + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return;
  for (let k = 0; k < 3; k++) data[p + k] = Math.round((c[k] * sa + data[p + k] * da * (1 - sa)) / oa);
  data[p + 3] = Math.round(oa * 255);
}

/** Square dab of `size` px centred on (x, y) (even sizes lean up-left, like Aseprite). */
// r0 = -floor((size-1)/2): size 3 -> offsets -1..1, size 4 -> -1..2, a deterministic convention so the brush preview
// and the painted pixels agree. Mirror reflects around the canvas centre line (W-1-x), for symmetric icons.
// The `seen` set matters for 'over' with alpha < 255: painting a pixel twice where mirrored copies overlap (near the
// axis) would double its opacity and leave a visible darker seam.
// KNOWN DEFECT: the key Y*W+X is computed before the bounds check, so an off-canvas brush pixel at X = -1 aliases
// the real pixel (W-1, Y-1). With mirror on and the brush over the left edge, that right-edge pixel is marked seen
// and the mirrored copy skips it, leaving a one-pixel gap. Fix: skip X/Y outside the image before touching `seen`.
export function dab(img, x, y, size, c, mode, mask, mirror = null) {
  const r0 = -Math.floor((size - 1) / 2);
  const pts = [[x, y]];
  if (mirror === 'x' || mirror === 'xy') pts.push([img.width - 1 - x, y]);
  if (mirror === 'y' || mirror === 'xy') pts.push([x, img.height - 1 - y]);
  if (mirror === 'xy') pts.push([img.width - 1 - x, img.height - 1 - y]);
  // a dab paints each pixel once, even where mirrored copies overlap
  const seen = new Set();
  for (const [px, py] of pts) {
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const X = px + r0 + dx, Y = py + r0 + dy;
        const k = Y * img.width + X;
        if (seen.has(k)) continue;
        seen.add(k);
        plot(img, X, Y, c, mode, mask);
      }
    }
  }
}

/** Integer points of the line (x0, y0)-(x1, y1) (Bresenham, both ends included). */
// The all-octant integer form (error term err = dx + dy with dy negated): one loop for every slope, no floats, and
// exactly one pixel per step along the major axis, giving 8-connected lines with no doubled corners, which is
// what pixel art expects. Also used to fill the gaps between pointer events during a fast stroke.
export function linePoints(x0, y0, x1, y1) {
  const out = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return out;
}

/** Points of a rectangle (outline or filled) between two corners. */
export function rectPoints(x0, y0, x1, y1, filled) {
  const out = [];
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
  for (let y = ay; y <= by; y++) {
    for (let x = ax; x <= bx; x++) if (filled || y === ay || y === by || x === ax || x === bx) out.push([x, y]);
  }
  return out;
}

/** Points of the ellipse inscribed in the box between two corners (outline or filled; pixel-centre test). */
// Implicit test on pixel centres (x + 0.5) against an ellipse with radii (box + 1) / 2: works for even and odd boxes
// alike and gives symmetric results, unlike the midpoint algorithm, which needs separate even-size handling.
// Outline = inside pixels with at least one 4-neighbour outside: a closed 1-px border with no gaps. O(box area),
// fine at <= 256 px.
export function ellipsePoints(x0, y0, x1, y1, filled) {
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
  const cx = (ax + bx + 1) / 2, cy = (ay + by + 1) / 2, rx = (bx - ax + 1) / 2, ry = (by - ay + 1) / 2;
  const inside = (x, y) => { const u = (x + 0.5 - cx) / rx, v = (y + 0.5 - cy) / ry; return u * u + v * v <= 1; };
  const out = [];
  for (let y = ay; y <= by; y++) {
    for (let x = ax; x <= bx; x++) {
      if (!inside(x, y)) continue;
      if (filled || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) out.push([x, y]);
    }
  }
  return out;
}

/** Bucket fill: the wand region of (x, y) painted with c (clipped by `clip`). Returns false when nothing changed. */
// The same region finder as the magic wand (raster/wand.js), so "what fill covers" and "what the wand selects" can
// never disagree. The region's mask is multiplied by the selection (clip) in place; only the bounding box the wand
// reports is scanned. Default 'replace': filling a transparent area must produce the exact colour, not a blend.
export function fill(img, x, y, c, { tolerance = 0, contiguous = true, diagonal = false, mode = 'replace', clip = null } = {}) {
  const r = wandMask(img, x, y, { tolerance, contiguous, diagonal });
  if (!r) return false;
  const m = r.mask;
  if (clip) for (let i = 0; i < m.length; i++) m[i] = Math.round((m[i] * clip[i]) / 255);
  for (let yy = r.y0; yy <= r.y1; yy++) for (let xx = r.x0; xx <= r.x1; xx++) if (m[yy * img.width + xx]) plot(img, xx, yy, c, mode, m);
  return true;
}

// --- selection masks (null = no selection = everything)

/** Combines selection masks: 'replace' | 'add' | 'subtract' | 'intersect'. */
// Fuzzy-set operators on coverage: add = max (union), subtract = a - b clamped, intersect = min. An empty result is
// normalised to null, so "nothing selected" has a single representation and callers test `if (mask)`.
// With no current selection (a null), intersect returns b and subtract returns null: the editor treats "no selection"
// as "nothing to modify" in these modes rather than as "everything".
export function combineMask(a, b, mode) {
  if (mode === 'replace' || !a) return mode === 'subtract' ? null : b;
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) {
    out[i] = mode === 'add' ? Math.max(a[i], b[i]) : mode === 'subtract' ? Math.max(0, a[i] - b[i]) : Math.min(a[i], b[i]);
  }
  return out.some((v) => v) ? out : null;
}

// Rectangle selection, corners clamped to the canvas so a drag that leaves the board still selects up to the edge.
export function rectMask(n, x0, y0, x1, y1) {
  const m = new Uint8Array(n * n);
  for (const [x, y] of rectPoints(Math.max(0, Math.min(x0, x1)), Math.max(0, Math.min(y0, y1)), Math.min(n - 1, Math.max(x0, x1)), Math.min(n - 1, Math.max(y0, y1)), true)) m[y * n + x] = 255;
  return m;
}

export function invertMask(m, n) {
  if (!m) return null;
  const out = new Uint8Array(n * n);
  for (let i = 0; i < out.length; i++) out[i] = 255 - m[i];
  return out.some((v) => v) ? out : null;
}

/** Clears the selected pixels to transparent (alpha scaled by coverage). */
// Only alpha is changed: RGB of a fully cleared pixel stays as garbage under alpha 0, which is invisible and
// harmless in straight-alpha formats (resampling is done premultiplied, see doc.js scaleTo).
export function clearSelected(img, mask) {
  const d = img.data;
  for (let i = 0; i < mask.length; i++) if (mask[i]) d[i * 4 + 3] = Math.round((d[i * 4 + 3] * (255 - mask[i])) / 255);
}

/** Moves the image content by (dx, dy) whole pixels (what leaves the canvas is lost; uncovered pixels are clear). */
// Writes into a fresh buffer then copies back: an in-place shift would read pixels it has already overwritten.
export function shift(img, dx, dy) {
  const { width: W, height: H } = img;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const sy = y - dy;
    if (sy < 0 || sy >= H) continue;
    for (let x = 0; x < W; x++) {
      const sx = x - dx;
      if (sx >= 0 && sx < W) out.set(img.data.subarray((sy * W + sx) * 4, (sy * W + sx) * 4 + 4), (y * W + x) * 4);
    }
  }
  img.data.set(out);
}

/** Flips the image horizontally or vertically in place. */
export function flipImage(img, horizontal) {
  const { width: W, height: H, data } = img;
  const src = new Uint8ClampedArray(data);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = horizontal ? W - 1 - x : x, sy = horizontal ? y : H - 1 - y;
      data.set(src.subarray((sy * W + sx) * 4, (sy * W + sx) * 4 + 4), (y * W + x) * 4);
    }
  }
}

/** Adds a 1-px outline of colour c around opaque content (alpha >= 128), outside it (Aseprite's "outline"). */
// Two passes: collect, then paint. Painting during the scan would make new outline pixels "solid" for the pixels
// scanned after them and grow the outline into a filled blob. alpha >= 128: the usual threshold for "visibly part
// of the shape". 4-neighbour by default (thin, pixel-art style), 8-neighbour fills the corners.
export function outline(img, c, diagonal = false) {
  const { width: W, height: H, data } = img;
  const solid = (x, y) => x >= 0 && y >= 0 && x < W && y < H && data[(y * W + x) * 4 + 3] >= 128;
  const add = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (solid(x, y)) continue;
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1) || (diagonal && (solid(x - 1, y - 1) || solid(x + 1, y - 1) || solid(x - 1, y + 1) || solid(x + 1, y + 1)))) add.push([x, y]);
    }
  }
  for (const [x, y] of add) plot(img, x, y, c, 'over');
  return add.length;
}
