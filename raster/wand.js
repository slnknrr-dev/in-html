// raster/wand.js - magic wand selection and background removal on RGBA images, as in Krita / Paint.NET / GIMP:
// a tolerance around the clicked colour, contiguous (flood) or global, 4- or 8-connected, three colour metrics, a
// soft edge ("fuzziness": coverage falls off near the tolerance), grow / shrink, and clearing the selection to
// transparent with colour decontamination of the semi-transparent edge (the background colour is unmixed).
//
// Masks are full-size Uint8Array (0..255 coverage, one byte per pixel).

//
// Coverage masks (0..255) rather than booleans throughout: soft edges, feathering and anti-aliasing all compose by
// max / multiply, and clearing becomes alpha *= 1 - coverage without a separate edge pass.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Colour distance of pixel i to a reference [r, g, b, a], 0..255:
 *   'max'        largest channel difference (Photoshop-like; the photo editor's classic wand),
 *   'rgba'       euclidean over RGBA, scaled so that full white / black is 255 (Paint.NET-like),
 *   'perceptual' weighted euclidean (red 0.3, green 0.59, blue 0.11 of the squared differences) plus alpha: closer
 *                to how different two colours look, so shadows and anti-aliased edges are grabbed more evenly.
 * Fully transparent pixels compare equal whatever their colour channels hold.
 */
// Returns a closure specialised per metric: the metric switch happens once, not per pixel. In 'perceptual' the RGB
// term is scaled by the smaller alpha, because colour differences of nearly transparent pixels are invisible.
// 'rgba' divides by 4 under the root so the largest possible difference (all four channels 255 apart) maps to 255.
export function distanceFn(data, ref, metric = 'max') {
  const [r0, g0, b0, a0] = ref;
  const clear0 = a0 === 0;
  if (metric === 'rgba') {
    return (i) => {
      const p = i * 4;
      if (clear0 && !data[p + 3]) return 0;
      const dr = data[p] - r0, dg = data[p + 1] - g0, db = data[p + 2] - b0, da = data[p + 3] - a0;
      return Math.sqrt((dr * dr + dg * dg + db * db + da * da) / 4);
    };
  }
  if (metric === 'perceptual') {
    return (i) => {
      const p = i * 4;
      if (clear0 && !data[p + 3]) return 0;
      const dr = data[p] - r0, dg = data[p + 1] - g0, db = data[p + 2] - b0, da = data[p + 3] - a0;
      const rgb = 0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db;
      return Math.sqrt(Math.max(rgb * (Math.min(data[p + 3], a0) / 255), 0) + da * da);
    };
  }
  return (i) => {
    const p = i * 4;
    if (clear0 && !data[p + 3]) return 0;
    return Math.max(Math.abs(data[p] - r0), Math.abs(data[p + 1] - g0), Math.abs(data[p + 2] - b0), Math.abs(data[p + 3] - a0));
  };
}

/**
 * Magic wand mask from the pixel (x, y). opts: tolerance (0..255), contiguous (flood fill from the point; false: every
 * pixel of the image within tolerance), diagonal (8-connected flood), metric ('max' | 'rgba' | 'perceptual'),
 * soft (0..1: the outer part of the tolerance band gets partial coverage), antialias (a half-covered 1-px rim).
 * Returns { mask, x0, y0, x1, y1 } (inclusive bounds of covered pixels) or null when (x, y) is outside.
 */
// Scanline flood fill: fills a whole horizontal run per stack pop and pushes one seed per run of the rows above and
// below. Far fewer stack operations than 4-neighbour pixel flooding, and no recursion. seen = 2 caches "tested and
// rejected" so a pixel's distance is computed at most a few times.
export function wandMask(img, x, y, { tolerance = 32, contiguous = true, diagonal = false, metric = 'max', soft = 0, antialias = false } = {}) {
  const { width: W, height: H, data } = img;
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return null;
  const p0 = (y * W + x) * 4;
  const dist = distanceFn(data, [data[p0], data[p0 + 1], data[p0 + 2], data[p0 + 3]], metric);
  const tol = clamp(+tolerance || 0, 0, 255);
  const hard = tol * (1 - clamp(+soft || 0, 0, 1));
  const cover = (d) => (d <= hard ? 255 : d > tol ? 0 : Math.max(1, Math.round(255 * (tol - d) / Math.max(1e-6, tol - hard))));
  const mask = new Uint8Array(W * H);
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  const mark = (i, v) => {
    mask[i] = v;
    const px = i % W, py = (i / W) | 0;
    if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
  };
  if (!contiguous) {
    for (let i = 0; i < W * H; i++) { const v = cover(dist(i)); if (v) mark(i, v); }
  } else {
    // Scanline flood over "within tolerance"; coverage from the distance. `seen` keeps rejected pixels from being
    // tested again.
    const seen = new Uint8Array(W * H);
    const ok = (i) => { if (seen[i]) return false; const d = dist(i); if (d > tol) { seen[i] = 2; return false; } return true; };
    const stack = [x, y];
    while (stack.length) {
      const sy = stack.pop(), sx = stack.pop();
      const row = sy * W;
      if (seen[row + sx] || !ok(row + sx)) continue;
      let l = sx, r = sx;
      while (l > 0 && !seen[row + l - 1] && ok(row + l - 1)) l--;
      while (r < W - 1 && !seen[row + r + 1] && ok(row + r + 1)) r++;
      for (let i = l; i <= r; i++) { seen[row + i] = 1; mark(row + i, cover(dist(row + i))); }
      const a = diagonal ? Math.max(0, l - 1) : l, b = diagonal ? Math.min(W - 1, r + 1) : r;
      for (const ny of [sy - 1, sy + 1]) {
        if (ny < 0 || ny >= H) continue;
        const nrow = ny * W;
        let inRun = false;
        for (let i = a; i <= b; i++) {
          const can = !seen[nrow + i] && dist(nrow + i) <= tol;
          if (can && !inRun) { stack.push(i, ny); inRun = true; } else if (!can) inRun = false;
        }
      }
    }
  }
  if (x1 < 0) return null;
  if (antialias) {
    const rim = [];
    for (let py = Math.max(0, y0 - 1); py <= Math.min(H - 1, y1 + 1); py++) {
      for (let px = Math.max(0, x0 - 1); px <= Math.min(W - 1, x1 + 1); px++) {
        const i = py * W + px;
        if (mask[i]) continue;
        if ((px > 0 && mask[i - 1] === 255) || (px < W - 1 && mask[i + 1] === 255) || (py > 0 && mask[i - W] === 255) || (py < H - 1 && mask[i + W] === 255)) rim.push(i);
      }
    }
    for (const i of rim) mark(i, 96);
  }
  return { mask, x0, y0, x1, y1 };
}

/** Grows (r > 0) or shrinks (r < 0) a mask by |r| pixels (square structuring element, separable max / min). */
// Separable dilation / erosion: a square element decomposes into a row pass and a column pass, O(W*H*r) instead of
// O(W*H*r^2). (A van Herk / Gil-Werman scheme would make it independent of r; masks here are small enough.)
export function growMask(mask, W, H, r) {
  r = Math.round(r);
  if (!r) return mask;
  const n = Math.abs(r), grow = r > 0;
  const pick = grow ? Math.max : Math.min;
  // outside the image counts as unselected
  const tmp = new Uint8Array(W * H), out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = grow ? 0 : 255;
      for (let k = -n; k <= n; k++) { const xx = x + k; v = pick(v, xx < 0 || xx >= W ? 0 : mask[y * W + xx]); }
      tmp[y * W + x] = v;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = grow ? 0 : 255;
      for (let k = -n; k <= n; k++) { const yy = y + k; v = pick(v, yy < 0 || yy >= H ? 0 : tmp[yy * W + x]); }
      out[y * W + x] = v;
    }
  }
  return out;
}

/** Box-blurs a mask (two passes of radius r ~ a gaussian feather). */
export function featherMask(mask, W, H, r) {
  r = Math.round(r);
  if (r <= 0) return mask;
  let a = Uint8Array.from(mask), b = new Uint8Array(W * H);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < H; y++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += a[y * W + clamp(k, 0, W - 1)];
      for (let x = 0; x < W; x++) {
        b[y * W + x] = Math.round(s / (2 * r + 1));
        s += a[y * W + clamp(x + r + 1, 0, W - 1)] - a[y * W + clamp(x - r, 0, W - 1)];
      }
    }
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += b[clamp(k, 0, H - 1) * W + x];
      for (let y = 0; y < H; y++) {
        a[y * W + x] = Math.round(s / (2 * r + 1));
        s += b[clamp(y + r + 1, 0, H - 1) * W + x] - b[clamp(y - r, 0, H - 1) * W + x];
      }
    }
  }
  return a;
}

/**
 * Makes the masked part of `img` transparent (in place): alpha *= 1 - coverage. With `decontaminate` = [r, g, b] the
 * remaining colour of partly cleared pixels is unmixed from that background colour (no halo of the old background).
 */
// Decontamination inverts the compositing equation c = keep * fg + (1 - keep) * bg for fg, with keep = 1 - m/255:
// the colour that remains is what the foreground would be without the background mixed in. Clamped, because noise
// or a wrong bg colour can push the solution outside 0..255.
export function clearMask(img, mask, { decontaminate = null } = {}) {
  const d = img.data;
  for (let i = 0, n = img.width * img.height; i < n; i++) {
    const m = mask[i];
    if (!m) continue;
    const p = i * 4;
    const a = d[p + 3] * (255 - m) / 255;
    if (decontaminate && a > 0 && m < 255) {
      const k = 255 / (255 - m);   // c = bg + (c - bg) / keep
      for (let c = 0; c < 3; c++) d[p + c] = clamp(Math.round(decontaminate[c] + (d[p + c] - decontaminate[c]) * k), 0, 255);
    }
    d[p + 3] = Math.round(a);
  }
  return img;
}

/** Seed points for background removal: 'corners' | 'edges' (corners and edge midpoints) | [{ x, y }, …] (0..1). */
export function seedPoints(W, H, seeds = 'corners') {
  const rel = Array.isArray(seeds) ? seeds
    : seeds === 'edges' ? [[0, 0], [0.5, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1]].map(([x, y]) => ({ x, y }))
    : [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => ({ x, y }));
  return rel.map((p) => ({ x: clamp(Math.round(p.x * (W - 1)), 0, W - 1), y: clamp(Math.round(p.y * (H - 1)), 0, H - 1) }));
}

/**
 * Removes the background (in place, returns img): a contiguous wand from each seed point, the masks united,
 * grown / shrunk by `grow` px, feathered by `feather` px, then cleared with decontamination against the colour of the
 * first seed. opts: tolerance (0..255), seeds, metric, soft, grow, feather, decontaminate (default true).
 */
// Seeds already inside the united mask are skipped (no repeated flood of the same region from another corner).
// Decontamination uses the first seed's colour: one background colour is assumed (studio / product shots).
export function removeBackground(img, { tolerance = 40, seeds = 'corners', metric = 'perceptual', soft = 0.5, grow = 0, feather = 0, decontaminate = true, diagonal = false } = {}) {
  const { width: W, height: H, data } = img;
  let mask = new Uint8Array(W * H);
  let bg = null;
  for (const p of seedPoints(W, H, seeds)) {
    const i = p.y * W + p.x;
    if (mask[i] === 255) continue;
    if (!bg) bg = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
    const r = wandMask(img, p.x, p.y, { tolerance, contiguous: true, metric, soft, diagonal });
    if (!r) continue;
    for (let j = 0; j < mask.length; j++) if (r.mask[j] > mask[j]) mask[j] = r.mask[j];
  }
  if (grow) mask = growMask(mask, W, H, grow);
  if (feather) mask = featherMask(mask, W, H, feather);
  return clearMask(img, mask, { decontaminate: decontaminate && bg ? bg : null });
}
