// fabric/texture.js - procedural fabric textures (RGBA, no DOM): one seamless tile of the weave and colour repeats,
// each crossing drawn as a short float of its yarn with a rounded cross-section (darker at the edges), a highlight
// along the float that grows with the float length and the fabric's sheen, a tiny per-thread variation from a seeded
// hash (slub), and dark gaps between threads; knits draw V-shaped loops, purl bumps, tucks and terry loops. Also a
// height map for bump shading. The tile is seamless by construction (its size is a multiple of every repeat).
//
//   fabricTexture(fabric, { px = 6 (pixels per thread), maxSize = 512 }) -> { width, height, data, threads: [w, h],
//                                                                            cm: [w, h] (physical size of the tile) }
//   tileSeamless(texture rendered with { repeat: [2, 2] }) -> { worst, ok } (the copies of the tile are identical)
//
// Seamless by construction: the tile spans lcm(weave repeat, colour repeat) threads on each axis, so every edge is
// also a repeat boundary. All lookups wrap modulo the repeat, so floats that cross the tile edge are measured
// correctly (their highlight continues on the opposite side).

import { colorOrder, fabricWeave } from './fabric.js';

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const lcm = (a, b) => (a / gcd(a, b)) * b;
// Deterministic hash noise in [0, 1).
// Integer mixing hash (murmur-style constants, Math.imul for exact 32-bit products): per-thread variation that is
// identical on every run and in every tile copy, which the seamless check relies on.
const hash = (a, b) => { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; return (h >>> 0) / 4294967296; };

export function fabricTexture(f, o = {}) {
  const st = fabricWeave(f);
  const warp = colorOrder(f, 'warp').map(rgb), weft = colorOrder(f, 'weft').map(rgb);
  let px = Math.max(2, Math.round(o.px || 6));
  const maxSize = o.maxSize || 512;
  let tw, th;
  // Both branches are identical (woven matrices and knit charts both expose w / h); kept as written.
  if (st.cells) { tw = lcm(st.w, warp.length); th = lcm(st.h, weft.length); }
  else { tw = lcm(st.w, warp.length); th = lcm(st.h, weft.length); }
  // Keep the tile within maxSize by lowering the pixels per thread (never below 2).
  while ((tw * px > maxSize || th * px > maxSize) && px > 2) px--;
  // repeat: [rx, ry] renders several copies of the tile (the copies are identical, which is what makes it seamless).
  const [rx, ry] = o.repeat || [1, 1];
  const W = tw * px * rx, H = th * px * ry;
  const data = new Uint8ClampedArray(W * H * 4);
  const sheen = f.props.sheen, rough = f.props.roughness;
  const put = (x, y, c, k) => { const i = (y * W + x) * 4; data[i] = c[0] * k; data[i + 1] = c[1] * k; data[i + 2] = c[2] * k; data[i + 3] = 255; };
  if (st.cells) {
    const up = (e, p) => st.cells[(((p % st.h) + st.h) % st.h) * st.w + (((e % st.w) + st.w) % st.w)];
    // Float run of the thread on top at a crossing: position within the run and its length.
    // Float detection: walk along the thread that is on top while it stays on top. The float length drives the
    // highlight: long floats (satin) catch light as a band, short ones (plain) look matte. Bounded by the repeat
    // size so an all-up column cannot loop forever.
    const run = (e, p) => {
      const top = up(e, p);
      let a = 0, b = 0;
      if (top) { while (a < st.h && up(e, p - a - 1)) a++; while (b < st.h && up(e, p + b + 1)) b++; }
      else { while (a < st.w && !up(e - a - 1, p)) a++; while (b < st.w && !up(e + b + 1, p)) b++; }
      return { top, pos: a, len: a + b + 1 };
    };
    for (let p = 0; p < th * ry; p++) {
      for (let e = 0; e < tw * rx; e++) {
        const r = run(e, p);
        const col = r.top ? warp[e % warp.length] : weft[p % weft.length];
        const te = e % tw, tp = p % th;
        // Variation keyed by thread index modulo the tile (te / tp), not absolute position: the copies of the tile
        // stay identical.
        const slub = 0.94 + 0.12 * hash(r.top ? te : tp + 7919, r.top ? 13 : 17) - 0.05 * rough * hash(te, tp);
        for (let y = 0; y < px; y++) {
          for (let x = 0; x < px; x++) {
            // Across the thread: rounded profile; along it: highlight towards the middle of the float.
            const across = r.top ? (x + 0.5) / px : (y + 0.5) / px;
            const along = r.top ? (r.pos + (y + 0.5) / px) / r.len : (r.pos + (x + 0.5) / px) / r.len;
            const prof = Math.sin(Math.PI * across);
            const gap = across < 0.08 || across > 0.92 ? 0.55 : 1;
            const hl = 1 + sheen * 0.55 * Math.pow(Math.sin(Math.PI * along), 2) * prof * Math.min(1, r.len / 3);
            const k = (0.62 + 0.38 * prof) * gap * slub * hl;
            put(e * px + x, p * px + y, col, k);
          }
        }
      }
    }
  } else {
    // Knit stitches are drawn as distance-field shapes in the unit cell: V legs for knit / tuck, a horizontal bump for
    // purl, a disc for terry loops. Colour = mean of warp and weft orders (knits have one yarn path per row).
    // Knit: stitch cells px wide and px tall.
    for (let p = 0; p < th * ry; p++) {
      for (let e = 0; e < tw * rx; e++) {
        const s = st.stitches[(p % st.h) * st.w + (e % st.w)];
        const col = warp[e % warp.length].map((v, k) => (v + weft[p % weft.length][k]) / 2);
        const slub = 0.95 + 0.1 * hash(p % th, 31);
        for (let y = 0; y < px; y++) {
          for (let x = 0; x < px; x++) {
            const u = (x + 0.5) / px, v = (y + 0.5) / px;
            let k;
            if (s === 'k' || s === 't') {
              // Two legs of a V: distance to the lines from the top corners to the bottom centre.
              const left = Math.abs((u - 0.5) + (1 - v) * 0.42), right = Math.abs((u - 0.5) - (1 - v) * 0.42);
              const d = Math.min(left, right);
              k = d < 0.17 ? 0.8 + 0.25 * Math.cos((d / 0.17) * Math.PI / 2) : 0.55;
              if (s === 't') k *= 0.9;
            } else if (s === 'p') {
              const d = Math.abs(v - 0.5);
              k = d < 0.25 ? 0.75 + 0.25 * Math.cos((d / 0.25) * Math.PI / 2) : 0.6;
            } else if (s === 'x') {
              const d = Math.hypot(u - 0.5, v - 0.5);
              k = d < 0.35 ? 0.85 - d * 0.6 : 0.6;
            } else k = 0.7;
            put(e * px + x, p * px + y, col, k * slub);
          }
        }
      }
    }
  }
  return { width: W, height: H, data, threads: [tw, th], px, repeat: [rx, ry], cm: [tw / f.threadsPerCm, th / f.threadsPerCm] };
}

// Seamless check of a texture rendered with repeat [2, 2]: the four copies of the tile must be identical, so the tile
// continues across its own edges exactly like across any inner thread boundary. Returns the largest channel difference.
export function tileSeamless(t) {
  const [rx, ry] = t.repeat || [1, 1];
  const w = t.width / rx, h = t.height / ry;
  let worst = 0;
  for (let y = 0; y < t.height; y++) for (let x = 0; x < t.width; x++) {
    const a = (y * t.width + x) * 4, b = ((y % h) * t.width + (x % w)) * 4;
    for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(t.data[a + k] - t.data[b + k]));
  }
  return { worst, ok: worst === 0 && rx * ry > 1 };
}
