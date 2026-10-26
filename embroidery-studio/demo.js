// embroidery-studio/demo.js - the demo catalogue: original schemes made by code in this file (a small shape painter
// for motifs, symmetric generators for mandalas, snowflakes, stars and interlace, procedural pictures converted with
// stitch/convert.js). No third-party designs. Every build is deterministic (seeded PRNG), so the static site, the
// offline file and the server show the same schemes.
//
//   DEMOS: [{ id, category, tags, difficulty, build() -> scheme }]   (titles / descriptions: strings demo.<id>.*)
//   demoScheme(id) -> scheme (cached)

import { createScheme, threadEntry, emptyLayer, addPart } from '../stitch/model.js';
import { findThread } from '../stitch/threads.js';
import { assignSymbols } from '../stitch/symbols.js';
import { convertImage } from '../stitch/convert.js';
import { textBitmap } from '../stitch/font.js';
import { seededRandom } from '../prng/prng.js';
import { smoothEdges } from '../stitch/edit.js';

const DESIGNER = 'in-html Studio';

// --- a shape painter on a cell grid (palette index per cell, -1 empty) ---------------------------------------------
// Vector-ish shapes rasterised by sampling each cell at its centre (x + 0.5, y + 0.5): a cell is stitched when its
// centre lies inside the shape. Simple, symmetric, and exactly what a cross-stitch designer does on graph paper.
// Int16Array with -1 = empty; later shapes overwrite earlier ones (painter's order).
function grid(w, h) {
  const cells = new Int16Array(w * h).fill(-1);
  const g = {
    w, h, cells, lines: [], knots: [], beads: [], parts: [],
    set(x, y, p) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < w && y < h) cells[y * w + x] = p; },
    get(x, y) { return x >= 0 && y >= 0 && x < w && y < h ? cells[y * w + x] : -1; },
    fill(test, p) { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (test(x + 0.5, y + 0.5, x, y)) cells[y * w + x] = typeof p === 'function' ? p(x, y) : p; return g; },
    ellipse(cx, cy, rx, ry, p, rot = 0) {
      const c = Math.cos(-rot), s = Math.sin(-rot);
      return g.fill((x, y) => { const dx = x - cx, dy = y - cy; const u = dx * c - dy * s, v = dx * s + dy * c; return (u / rx) ** 2 + (v / ry) ** 2 <= 1; }, p);
    },
    // Even-odd ray casting: count crossings of a horizontal ray from the point with each edge; odd = inside. The
    // (yi > y) !== (yj > y) test also skips horizontal edges and avoids double-counting shared vertices.
    poly(pts, p) {
      return g.fill((x, y) => {
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const [xi, yi] = pts[i], [xj, yj] = pts[j];
          if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
      }, p);
    },
    rect(x0, y0, x1, y1, p) { return g.fill((x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1, p); },
    // Thick line = cells whose centre is within wd/2 of the segment (projection clamped to the segment ends).
    line(x0, y0, x1, y1, p, wd = 1) {
      return g.fill((x, y) => {
        const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / l2));
        return Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy)) <= wd / 2;
      }, p);
    },
    ring(cx, cy, r1, r2, p) { return g.fill((x, y) => { const d = Math.hypot(x - cx, y - cy); return d >= r1 && d <= r2; }, p); },
    bitmap(bits, bw, bh, x0, y0, p) { for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (bits[y * bw + x]) g.set(x0 + x, y0 + y, p); return g; },
    text(str, x0, y0, p, opts = {}) { const b = textBitmap(str, opts); return g.bitmap(b.bits, b.width, b.height, x0, y0, p); },
    textWidth: (str, opts = {}) => textBitmap(str, opts).width,
  };
  return g;
}

// Palette codes (DMC) -> scheme with symbols assigned by use.
// Layer cells store palette index + 1 (0 = empty). Symbols are assigned by usage count, so the most used colours
// get the most legible symbols. Backstitch, knots and beads go to a separate "Details" layer, as stitchers expect.
function toScheme(g, codes, { title, fabric, smooth = [] } = {}) {
  const palette = codes.map((c) => threadEntry(findThread('dmc', c)));
  const s = createScheme({ width: g.w, height: g.h, title, palette, fabric: { kind: 'aida', count: 14, color: '#ffffff', ...(fabric || {}) }, meta: { designer: DESIGNER } });
  const L = s.layers[0];
  L.name = 'Cross stitch';
  for (let i = 0; i < g.cells.length; i++) if (g.cells[i] >= 0) L.cells[i] = g.cells[i] + 1;
  for (const p of g.parts) addPart(L, p);
  for (const p of smooth) smoothEdges(s, 0, p);
  if (g.lines.length || g.knots.length || g.beads.length) {
    const d = emptyLayer(g.w, g.h, 'Details');
    d.lines = g.lines; d.knots = g.knots; d.beads = g.beads;
    s.layers.push(d);
  }
  const counts = s.palette.map(() => 0);
  for (const v of L.cells) if (v) counts[v - 1]++;
  const syms = assignSymbols(s.palette, { counts });
  s.palette.forEach((e, i) => { e.symbol = syms[i]; });
  return s;
}

// Folded coordinates for 8-fold (D4) symmetry around the centre cell of an odd-sized grid.
// Folding into one octant (|dx| >= |dy| >= 0) means a generator only decides the colour from (a, b) and every cell
// in the 8 symmetric positions gets the same answer: symmetry by construction, not by copying.
const fold = (x, y, c) => { let a = Math.abs(x - c), b = Math.abs(y - c); if (b > a) [a, b] = [b, a]; return [a, b]; };

// --- motifs ----------------------------------------------------------------------------------------------------------

function strawberry() {
  const g = grid(30, 34);
  // 0 red, 1 dark red, 2 highlight, 3 seeds, 4 leaf, 5 dark leaf, 6 stem
  g.poly([[5, 11], [10, 8], [15, 8.5], [20, 8], [25, 11], [26.5, 16], [24, 23], [19, 29], [15, 32.5], [11, 29], [6, 23], [3.5, 16]], 0);
  g.poly([[20, 9], [25, 11], [26.5, 16], [24, 23], [19, 29], [15, 32.5], [17, 27], [21, 21], [22.5, 15]], 1);
  g.ellipse(9, 14, 2.2, 3.4, 2, -0.5);
  for (let y = 11; y < 31; y += 3) for (let x = 5 + ((y / 3) % 2) * 1.5; x < 26; x += 3.4) if (g.get(Math.round(x), y) >= 0 && g.get(Math.round(x), y) !== 2) g.set(x, y, 3);
  g.ellipse(9, 8.5, 5, 1.8, 4, 0.35);
  g.ellipse(21, 8.5, 5, 1.8, 4, -0.35);
  g.ellipse(15, 9.5, 2, 4, 5, 0);
  g.ellipse(11.5, 6.5, 3.5, 1.4, 5, -0.6);
  g.ellipse(18.5, 6.5, 3.5, 1.4, 4, 0.6);
  g.line(15, 1, 15, 6, 6, 1.6);
  const s = toScheme(g, ['321', '815', '3705', '3078', '702', '699', '3346'], { smooth: [0, 1, 4] });
  // Outline in dark red backstitch around the berry.
  const det = s.layers[1] || (s.layers.push(emptyLayer(g.w, g.h, 'Details')), s.layers[1]);
  const pal = s.palette;
  let p = pal.findIndex((e) => e.code === '814');
  if (p < 0) { pal.push(threadEntry(findThread('dmc', '814'), { symbol: 'slash' })); p = pal.length - 1; }
  const outline = [[5, 11], [3.5, 16], [6, 23], [11, 29], [15, 32.5], [19, 29], [24, 23], [26.5, 16], [25, 11]];
  for (let i = 0; i < outline.length - 1; i++) det.lines.push({ x1: Math.round(outline[i][0] * 2) / 2, y1: Math.round(outline[i][1] * 2) / 2, x2: Math.round(outline[i + 1][0] * 2) / 2, y2: Math.round(outline[i + 1][1] * 2) / 2, p, k: 'back' });
  return s;
}

function owl() {
  const g = grid(36, 42);
  // 0 brown, 1 dark brown, 2 light tan, 3 tan, 4 white, 5 black, 6 orange, 7 branch, 8 leaf
  g.ellipse(18, 22, 13, 15.5, 0);
  g.poly([[6, 6], [11, 11], [7.5, 13]], 1);
  g.poly([[30, 6], [25, 11], [28.5, 13]], 1);
  g.ellipse(18, 27.5, 8.5, 9.5, 2);
  for (let y = 21; y < 36; y += 3) for (let x = 12 + ((y - 21) % 6 ? 1.5 : 0); x < 25; x += 3) if (g.get(Math.round(x), y) === 2) { g.set(x, y, 3); g.set(x - 1, y - 1, 3); g.set(x + 1, y - 1, 3); }
  g.ellipse(7.5, 25, 3.2, 9, 1, 0.18);
  g.ellipse(28.5, 25, 3.2, 9, 1, -0.18);
  g.ellipse(12.5, 15, 5, 5, 4);
  g.ellipse(23.5, 15, 5, 5, 4);
  g.ellipse(12.5, 15.5, 2.6, 2.6, 5);
  g.ellipse(23.5, 15.5, 2.6, 2.6, 5);
  g.poly([[16.5, 17], [19.5, 17], [18, 21]], 6);
  g.rect(0, 37, 35, 38, 7);
  g.rect(13, 36, 14, 36, 6); g.rect(21, 36, 22, 36, 6);
  g.ellipse(4, 35.5, 2.6, 1.2, 8, -0.4);
  g.ellipse(32, 35.5, 2.6, 1.2, 8, 0.4);
  g.knots.push({ x: 12, y: 14.5, p: 4 }, { x: 23, y: 14.5, p: 4 });
  return toScheme(g, ['434', '801', '738', '436', 'B5200', '310', '741', '3781', '989'], { smooth: [0, 1, 2] });
}

function tulips() {
  const g = grid(44, 46);
  // 0 red, 1 dark red, 2 yellow, 3 orange, 4 pink, 5 deep pink, 6 green, 7 dark green, 8 pot, 9 pot dark
  g.line(10, 20, 13, 38, 6, 1.4); g.line(22, 16, 22, 38, 6, 1.4); g.line(34, 20, 31, 38, 6, 1.4);
  g.ellipse(7, 31, 2.5, 7, 7, 0.5); g.ellipse(16.5, 30, 2.2, 6.5, 6, -0.45);
  g.ellipse(27.5, 30, 2.2, 6.5, 6, 0.45); g.ellipse(37, 31, 2.5, 7, 7, -0.5);
  const cup = (cx, cy, a, b) => {
    g.ellipse(cx, cy + 2, 5, 5.5, a);
    g.poly([[cx - 5, cy + 1], [cx - 4, cy - 6], [cx - 1.5, cy - 1]], a);
    g.poly([[cx + 5, cy + 1], [cx + 4, cy - 6], [cx + 1.5, cy - 1]], a);
    g.poly([[cx - 2, cy], [cx, cy - 7], [cx + 2, cy]], b);
    g.ellipse(cx + 2.5, cy + 3, 1.4, 3.6, b, -0.2);
  };
  cup(10, 15, 0, 1); cup(22, 10, 2, 3); cup(34, 15, 4, 5);
  g.poly([[9, 38], [35, 38], [32, 45], [12, 45]], 8);
  g.rect(8, 37, 36, 39, 9);
  return toScheme(g, ['321', '815', '726', '741', '3326', '3805', '702', '699', '3776', '300'], { smooth: [0, 2, 4, 6, 7] });
}

function mushrooms() {
  const g = grid(40, 36);
  // 0 red cap, 1 dark red, 2 white dots, 3 stem, 4 stem shade, 5 grass, 6 dark grass, 7 small cap
  g.fill((x, y) => y < 17 && ((x - 16) / 13) ** 2 + ((y - 17) / 12) ** 2 <= 1, 0);
  g.fill((x, y) => y < 17 && y > 12 && ((x - 16) / 13) ** 2 + ((y - 17) / 12) ** 2 <= 1 && ((x - 16) / 13) ** 2 + ((y - 17) / 12) ** 2 > 0.62, 1);
  g.ellipse(11, 8, 2.2, 1.8, 2); g.ellipse(19, 6, 2.6, 2, 2); g.ellipse(24, 11, 1.8, 1.6, 2); g.ellipse(8, 13.5, 1.5, 1.3, 2); g.ellipse(16, 12, 1.6, 1.4, 2);
  g.poly([[12, 17], [20, 17], [21.5, 31], [10.5, 31]], 3);
  g.poly([[17.5, 17], [20, 17], [21.5, 31], [18.5, 31]], 4);
  g.fill((x, y) => y > 25.5 + Math.sin(x * 0.9) * 1.2 && y < 36, 5);
  g.fill((x, y) => y > 30 + Math.sin(x * 1.7 + 1) * 1.5 && y < 36, 6);
  g.fill((x, y) => y < 25 && ((x - 31) / 6) ** 2 + ((y - 25) / 5.5) ** 2 <= 1, 7);
  g.poly([[29.5, 25], [32.5, 25], [33, 31], [29, 31]], 3);
  g.ellipse(30, 21.5, 1.1, 1, 2); g.ellipse(33, 23, 0.9, 0.8, 2);
  for (const [x, y] of [[3, 27], [6, 26], [36, 27], [26, 28], [14, 33]]) g.line(x, y, x - 0.5, y - 4, 6, 1);
  return toScheme(g, ['321', '498', 'B5200', '3047', '3045', '703', '701', '3801'], { smooth: [0, 7] });
}

function kitten() {
  const g = grid(48, 48);
  // 0 black, 1 eye green, 2 pupil (black via 0), 3 nose pink
  g.ellipse(22, 33, 13, 11, 0);
  g.ellipse(17, 17, 10, 9, 0);
  g.poly([[8, 14], [8.5, 3], [15, 9]], 0);
  g.poly([[19, 9], [25.5, 3], [26, 14]], 0);
  g.line(34, 38, 42, 30, 0, 3); g.line(42, 30, 43, 20, 0, 3); g.line(43, 20, 40, 14, 0, 3);
  g.rect(12, 42, 32, 44, 0);
  g.ellipse(13, 16, 2.2, 2, 1); g.ellipse(21, 16, 2.2, 2, 1);
  g.rect(13, 15, 13, 17, 0); g.rect(21, 15, 21, 17, 0);
  g.set(17, 20, 3);
  const s = toScheme(g, ['310', '704', '3712'], { fabric: { color: '#f6efe2' }, smooth: [0] });
  s.palette.push(threadEntry(findThread('dmc', '3865'), { symbol: 'bar-h' }));
  const p = s.palette.length - 1;
  const d = s.layers[1] || (s.layers.push(emptyLayer(48, 48, 'Details')), s.layers[1]);
  for (const [x1, y1, x2, y2] of [[15, 21, 7, 19.5], [15, 21.5, 7, 22.5], [19, 21, 27, 19.5], [19, 21.5, 27, 22.5]]) d.lines.push({ x1, y1, x2, y2, p, k: 'straight' });
  return s;
}

// Seeded PRNG ('mandala-1'): random-looking bands, but the same chart on every build and every device.
function mandala() {
  const N = 81, c = 40;
  const g = grid(N, N);
  const r = seededRandom('mandala-1');
  // Colours: 0 navy, 1 royal, 2 electric, 3 gold, 4 melon, 5 mauve, 6 nile, 7 light gold
  const bands = [];
  let rad = 2.5;
  while (rad < 40) {
    const width = 2.5 + r.int(4);
    bands.push({ r0: rad, r1: rad + width, kind: r.pick(['solid', 'petals', 'petals', 'dots', 'zig']), n: r.pick([4, 8, 8, 12, 16]), a: r.int(8), b: r.int(8) });
    rad += width + (r.chance(0.4) ? 1 : 0);
  }
  g.fill((x, y, cx, cy) => {
    const [a, b] = fold(cx, cy, c);
    const d = Math.hypot(a, b), th = Math.atan2(b, a);
    for (const B of bands) {
      if (d < B.r0 || d > B.r1) continue;
      const t = (d - B.r0) / (B.r1 - B.r0);
      if (B.kind === 'solid') return true;
      if (B.kind === 'petals') return Math.abs(Math.cos(th * B.n / 2)) > t * 0.9;
      if (B.kind === 'dots') return Math.abs(Math.sin(th * B.n / 2)) < 0.35 && Math.abs(t - 0.5) < 0.35;
      if (B.kind === 'zig') return Math.abs(t - Math.abs(((th * B.n) / Math.PI) % 2 - 1)) < 0.3;
    }
    return d <= 2.5;
  }, (cx, cy) => {
    const [a, b] = fold(cx, cy, c);
    const d = Math.hypot(a, b);
    const B = bands.find((x) => d >= x.r0 && d <= x.r1);
    if (!B) return 3;
    const t = (d - B.r0) / (B.r1 - B.r0);
    return t < 0.5 ? B.a : B.b;
  });
  return toScheme(g, ['820', '797', '3843', '725', '3801', '3685', '954', '3822'], { fabric: { color: '#fbf8f1' } });
}

function snowflake() {
  const N = 61, c = 30;
  const g = grid(N, N);
  // 0 white, 1 ice blue, 2 pale blue
  g.fill((x, y, cx, cy) => {
    const [a, b] = fold(cx, cy, c);
    // Main arms along the axis (b small) and the diagonal (a == b), with side branches.
    if (b <= 0.5 && a <= 27) return true;
    if (Math.abs(a - b) <= 0.5 && a <= 19) return true;
    for (const k of [8, 14, 20]) if (a >= k && a <= k + 5 && Math.abs(b - (a - k)) <= 0.5 && b <= 5 - k / 10) return true;
    for (const k of [6, 11]) if (Math.abs(a - b) > 0.5 && b < a && Math.abs((a + b) / 2 - k) < 0.6 && Math.abs(a - b) < 6) return true;
    return Math.hypot(a, b) <= 3.2;
  }, (cx, cy) => { const [a, b] = fold(cx, cy, c); return Math.hypot(a, b) <= 3.2 ? 1 : a > 22 || (Math.abs(a - b) <= 0.5 && a > 15) ? 2 : 0; });
  const s = toScheme(g, ['B5200', '3755', '3756'], { fabric: { color: '#1b2853', name: 'Navy Aida' } });
  s.palette.push(threadEntry(findThread('dmc', 'B5200'), { kind: 'bead', name: 'Glass seed bead, crystal', symbol: 'ring-small' }));
  const bp = s.palette.length - 1;
  const d = emptyLayer(N, N, 'Beads');
  for (const [x, y] of [[c + 28, c], [c - 28, c], [c, c + 28], [c, c - 28], [c + 20, c + 20], [c - 20, c - 20], [c + 20, c - 20], [c - 20, c + 20]]) d.beads.push({ x: x + 0.5, y: y + 0.5, p: bp });
  s.layers.push(d);
  return s;
}

function interlace() {
  const W = 64, H = 64, P = 16, w = 3.2;
  const g = grid(W, H);
  // 0 ribbon, 1 ribbon edge, 2 frame
  g.fill((x, y) => {
    if (x < 3 || y < 3 || x > W - 3 || y > H - 3) return true;
    const u = ((x + y) % P + P) % P, v = ((x - y) % P + P) % P;
    return Math.abs(u - P / 2) <= w || Math.abs(v - P / 2) <= w;
  }, (cx, cy) => {
    const x = cx + 0.5, y = cy + 0.5;
    if (x < 3 || y < 3 || x > W - 3 || y > H - 3) return 2;
    const u = ((x + y) % P + P) % P, v = ((x - y) % P + P) % P;
    const onA = Math.abs(u - P / 2) <= w, onB = Math.abs(v - P / 2) <= w;
    const edgeA = Math.abs(u - P / 2) > w - 1.2, edgeB = Math.abs(v - P / 2) > w - 1.2;
    if (onA && onB) {
      const over = (Math.floor((x + y) / P) + Math.floor((x - y + 1000 * P) / P)) % 2 === 0 ? 'A' : 'B';
      return over === 'A' ? (edgeA ? 1 : 0) : (edgeB ? 1 : 0);
    }
    return (onA && edgeA) || (onB && edgeB) ? 1 : 0;
  });
  return toScheme(g, ['3814', '500', '3829'], { fabric: { color: '#f7f2e6' } });
}

function seigaiha() {
  const W = 80, H = 56, R = 8;
  const g = grid(W, H);
  const colors = [0, 1, 2, 3];
  for (let row = -1; row * (R / 2) < H + R; row++) {
    for (let col = -1; col * 2 * R < W + 2 * R; col++) {
      const cx = col * 2 * R + (row % 2 ? R : 0), cy = row * (R / 2) + R / 2;
      for (let k = 0; k < 4; k++) g.ellipse(cx, cy, R - k * 2, R - k * 2, colors[k]);
    }
  }
  return toScheme(g, ['3750', '930', '932', '3756'], { fabric: { color: '#ffffff' } });
}

function sampler() {
  const W = 110, H = 72;
  const g = grid(W, H);
  // 0 red, 1 navy, 2 green, 3 gold
  for (let x = 0; x < W; x++) { const z = Math.abs((x % 8) - 4); g.set(x, 2 + z, 0); g.set(x, H - 3 - z, 0); }
  for (let y = 0; y < H; y++) { g.set(1, y, 1); g.set(W - 2, y, 1); }
  // Eight-pointed stars.
  const star = (cx, cy, s, p) => g.fill((x, y, gx, gy) => {
    const a = Math.abs(gx - cx), b = Math.abs(gy - cy);
    return (Math.max(a, b) <= s || a + b <= s * 1.6) && !(a === b && a > 0) && !(a === 0 || b === 0) && a + b <= s * 1.6 + 0.1;
  }, p);
  for (let i = 0; i < 6; i++) star(12 + i * 17, 19, 6, i % 2 ? 1 : 0);
  const title = 'SAMPLER 2026';
  const tw = g.textWidth(title);
  g.text(title, Math.floor((W - tw) / 2), 31, 1);
  // Diamonds with crosses.
  for (let i = 0; i < 9; i++) {
    const cx = 9 + i * 11.5, cy = 50;
    g.fill((x, y, gx, gy) => { const d = Math.abs(gx - Math.round(cx)) + Math.abs(gy - cy); return d === 5 || (d <= 2 && (gx === Math.round(cx) || gy === cy)); }, i % 2 ? 2 : 3);
  }
  for (let x = 4; x < W - 4; x++) if (x % 2 === 0) g.set(x, 42, 2);
  return toScheme(g, ['321', '336', '3346', '783'], { fabric: { color: '#f3ead6', kind: 'linen' } });
}

function alphabet() {
  const W = 96, H = 60;
  const g = grid(W, H);
  const rows = ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', '0123456789'];
  rows.forEach((line, i) => {
    let x = Math.floor((W - g.textWidth(line, { spacing: 2 })) / 2);
    for (const ch of line) { g.text(ch, x, 8 + i * 15, (x + i) % 3); x += g.textWidth(ch) + 2; }
  });
  const heart = (cx, cy, s, p) => g.fill((x, y) => { const u = (x - cx) / s, v = -(y - cy) / s; return (u * u + v * v - 1) ** 3 - u * u * v ** 3 <= 0; }, p);
  for (let i = 0; i < 8; i++) { heart(6 + i * 12, 3.2, 2.2, 3); heart(6 + i * 12, H - 3.2, 2.2, 3); }
  return toScheme(g, ['3832', '3808', '581', '3804'], { fabric: { color: '#ffffff' } });
}

function bookmark() {
  const W = 31, H = 91;
  const g = grid(W, H);
  // 0 rose, 1 deep rose, 2 green, 3 frame
  g.rect(0, 0, W - 1, 0, 3); g.rect(0, H - 1, W - 1, H - 1, 3); g.rect(0, 0, 0, H - 1, 3); g.rect(W - 1, 0, W - 1, H - 1, 3);
  for (let y = 3; y < H - 3; y++) { const x = 15 + Math.sin(y / 4.6) * 6; g.set(x, y, 2); }
  for (let k = 0; k < 6; k++) {
    const cy = 10 + k * 14.5, cx = 15 + (k % 2 ? -7 : 7);
    g.fill((x, y) => { const u = (x - cx) / 3.6, v = -(y - cy) / 3.6; return (u * u + v * v - 1) ** 3 - u * u * v ** 3 <= 0; }, k % 2);
    const lx = 15 + Math.sin((cy + 6) / 4.6) * 6;
    g.ellipse(lx + (k % 2 ? 2 : -2), cy + 6, 1.8, 0.9, 2, k % 2 ? 0.6 : -0.6);
  }
  return toScheme(g, ['3326', '3350', '3363', '3685'], { fabric: { color: '#fffaf2' }, smooth: [0, 1] });
}

// --- procedural pictures converted to schemes ----------------------------------------------------------------------

// Procedural RGBA image from a function of normalised coordinates; then converted to threads by the same
// stitch/convert.js pipeline users run on photos, which exercises the converter on every build.
function picture(w, h, fn) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = fn(x / w, y / h, x, y); const i = (y * w + x) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = c.length > 3 ? c[3] : 255; }
  return { width: w, height: h, data };
}
const mixc = (a, b, t) => a.map((v, i) => v + (b[i] - v) * Math.max(0, Math.min(1, t)));
const inPoly = (pts, x, y) => { let s = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) s = !s; } return s; };

function sailboat() {
  const img = picture(288, 200, (u, v) => {
    const horizon = 0.6;
    let c;
    if (v < horizon) {
      c = mixc([86, 133, 196], [247, 196, 140], (v / horizon) ** 1.4);
      const d = Math.hypot(u - 0.72, (v - 0.47) * 1.44);
      if (d < 0.07) c = [255, 214, 120];
      else if (d < 0.16) c = mixc([255, 205, 130], c, (d - 0.07) / 0.09);
    } else {
      c = mixc([62, 118, 150], [16, 52, 82], (v - horizon) / (1 - horizon));
      if (Math.sin(u * 60 + v * 30) > 0.92 && Math.sin(v * 140) > 0.2) c = mixc(c, [190, 220, 230], 0.6);
      if (Math.abs(u - 0.72) < 0.05 * (1 - (v - horizon) * 2) && Math.sin(v * 220) > 0) c = mixc(c, [250, 200, 120], 0.55);
    }
    const hull = [[0.22, 0.62], [0.56, 0.62], [0.5, 0.7], [0.27, 0.7]];
    if (inPoly(hull, u, v)) c = [92, 52, 30];
    if (inPoly([[0.385, 0.18], [0.385, 0.6], [0.24, 0.6]], u, v)) c = mixc([250, 248, 240], [205, 200, 190], (0.385 - u) * 5);
    if (inPoly([[0.4, 0.24], [0.53, 0.6], [0.4, 0.6]], u, v)) c = [240, 236, 226];
    if (Math.abs(u - 0.392) < 0.004 && v > 0.16 && v < 0.62) c = [60, 40, 25];
    return c;
  });
  const { scheme } = convertImage(img, { width: 96, maxColors: 20, blends: true, cleanup: 2, brand: 'dmc', title: 'Sailboat at sunset' });
  scheme.meta.designer = DESIGNER;
  const p = scheme.palette.findIndex((e) => e.code === '310' || e.code === '3371' || e.code === '938');
  const q = p >= 0 ? p : (scheme.palette.push(threadEntry(findThread('dmc', '3371'), { symbol: 'slash' })), scheme.palette.length - 1);
  const d = emptyLayer(scheme.width, scheme.height, 'Gulls');
  for (const [x, y] of [[20, 14], [30, 9], [70, 16]]) d.lines.push({ x1: x - 2, y1: y, x2: x, y2: y + 1, p: q, k: 'back' }, { x1: x, y1: y + 1, x2: x + 2, y2: y, p: q, k: 'back' });
  scheme.layers.push(d);
  return scheme;
}

function meadow() {
  const r = seededRandom('meadow');
  const flowers = Array.from({ length: 260 }, () => ({ x: r.next(), y: 0.62 + r.next() * 0.38, s: 0.004 + r.next() * 0.008, c: r.pick([[230, 60, 70], [250, 210, 60], [245, 245, 240], [170, 110, 210], [250, 150, 60]]) }));
  // Flowers bucketed by x, so each pixel looks at a few of them.
  const bins = Array.from({ length: 40 }, () => []);
  for (const f of flowers) for (let b = Math.max(0, Math.floor((f.x - 0.02) * 40)); b <= Math.min(39, Math.floor((f.x + 0.02) * 40)); b++) bins[b].push(f);
  const img = picture(320, 220, (u, v) => {
    let c = mixc([120, 170, 225], [225, 238, 245], v / 0.5);
    for (let k = 0; k < 3; k++) { const cl = 0.16 + k * 0.06 + Math.sin(u * 9 + k * 2) * 0.012; if (Math.abs(v - cl) < 0.02 && Math.sin(u * 23 + k) > 0.1) c = mixc(c, [252, 252, 250], 0.75); }
    const hill1 = 0.45 + Math.sin(u * 4 + 1) * 0.04, hill2 = 0.53 + Math.sin(u * 6 + 3) * 0.035, field = 0.6 + Math.sin(u * 3) * 0.02;
    if (v > hill1) c = mixc([110, 140, 150], [90, 120, 110], (v - hill1) * 6);
    if (v > hill2) c = mixc([96, 140, 80], [70, 120, 60], (v - hill2) * 8);
    if (v > field) c = mixc([110, 165, 70], [60, 120, 40], (v - field) * 2.4);
    const tx = 0.78, ty = 0.52;
    if (((u - tx) * 1.2) ** 2 + (v - ty) ** 2 < 0.065 ** 2) c = mixc([40, 90, 50], [70, 120, 60], (v - ty + 0.06) * 6);
    if (Math.abs(u - tx) < 0.006 && v > ty && v < ty + 0.1) c = [80, 60, 40];
    if (v > 0.6) for (const f of bins[Math.min(39, Math.floor(u * 40))]) { const dx = (u - f.x) * 1.45, dy = v - f.y, r = f.s * (0.6 + f.y); if (dx * dx + dy * dy < r * r) { c = f.c; break; } }
    return c;
  });
  const { scheme } = convertImage(img, { width: 160, maxColors: 32, dither: 'fs', ditherStrength: 0.55, cleanup: 1, brand: 'dmc', title: 'Summer meadow' });
  scheme.meta.designer = DESIGNER;
  return scheme;
}

// The size / colour / stitch numbers are precomputed metadata so the catalogue can list demos without building
// them (build() runs only when a chart or thumbnail is actually needed). They must match what build() produces.
export const DEMOS = [
  { id: 'mandala', w: 81, h: 81, colors: 8, stitches: 2893, category: 'geometric', tags: ['mandala', 'symmetry'], difficulty: 3, build: mandala },
  { id: 'owl', w: 36, h: 42, colors: 9, stitches: 783, category: 'animals', tags: ['owl', 'birds', 'kids', 'knots'], difficulty: 2, build: owl },
  { id: 'strawberry', w: 30, h: 34, colors: 8, stitches: 487, category: 'food', tags: ['fruit', 'summer', 'backstitch', 'three-quarter'], difficulty: 1, build: strawberry },
  { id: 'sailboat', w: 96, h: 67, colors: 21, stitches: 6432, category: 'landscapes', tags: ['sea', 'sunset', 'blends'], difficulty: 4, build: sailboat },
  { id: 'tulips', w: 44, h: 46, colors: 10, stitches: 830, category: 'flowers', tags: ['spring', 'flowers', 'three-quarter'], difficulty: 2, build: tulips },
  { id: 'snowflake', w: 61, h: 61, colors: 4, stitches: 409, category: 'seasonal', tags: ['winter', 'christmas', 'beads', 'ornament'], difficulty: 2, build: snowflake },
  { id: 'sampler', w: 110, h: 72, colors: 4, stitches: 1615, category: 'samplers', tags: ['folk', 'stars', 'borders', 'lettering'], difficulty: 2, build: sampler },
  { id: 'mushrooms', w: 40, h: 36, colors: 8, stitches: 815, category: 'nature', tags: ['forest', 'autumn', 'kids'], difficulty: 1, build: mushrooms },
  { id: 'kitten', w: 48, h: 48, colors: 4, stitches: 919, category: 'animals', tags: ['cat', 'silhouette', 'monochrome'], difficulty: 1, build: kitten },
  { id: 'interlace', w: 64, h: 64, colors: 3, stitches: 3072, category: 'geometric', tags: ['knotwork', 'interlace', 'border'], difficulty: 3, build: interlace },
  { id: 'waves', w: 80, h: 56, colors: 4, stitches: 4480, category: 'geometric', tags: ['waves', 'japanese pattern', 'blue'], difficulty: 2, build: seigaiha },
  { id: 'alphabet', w: 96, h: 60, colors: 4, stitches: 810, category: 'lettering', tags: ['alphabet', 'numbers', 'hearts'], difficulty: 1, build: alphabet },
  { id: 'bookmark', w: 31, h: 91, colors: 4, stitches: 405, category: 'small', tags: ['bookmark', 'hearts', 'gift'], difficulty: 1, build: bookmark },
  { id: 'meadow', w: 160, h: 110, colors: 32, stitches: 17600, category: 'landscapes', tags: ['summer', 'flowers', 'full coverage', 'large'], difficulty: 5, build: meadow },
];

export const CATEGORIES = ['animals', 'flowers', 'nature', 'landscapes', 'geometric', 'samplers', 'lettering', 'seasonal', 'food', 'small', 'other'];

// Built demos are cached: generation (especially the converted pictures) is too slow to repeat per view. Fixed
// dates keep the demos sorted consistently in the "newest" order.
const CACHE = new Map();
export function demoScheme(id) {
  if (CACHE.has(id)) return CACHE.get(id);
  const d = DEMOS.find((x) => x.id === id);
  if (!d) return null;
  const s = d.build();
  s.id = 'demo-' + id;
  Object.assign(s.meta, { category: d.category, tags: d.tags.slice(), difficulty: d.difficulty, designer: DESIGNER, license: 'CC BY 4.0', created: '2026-10-01T00:00:00.000Z', updated: '2026-10-01T00:00:00.000Z' });
  CACHE.set(id, s);
  return s;
}
