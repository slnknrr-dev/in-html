// carpet/render.js - pictures of rugs: a flat design or a realistic pile (per-knot shading, abrash — the horizontal
// colour bands of natural dye lots —, light from above, the two lobes of each knot at close zoom), the fringe of
// knotted warp ends and overcast selvedges. Pure RGBA for PNG / previews (Node and browsers), SVG text, and a canvas
// drawer for the application (nothing touches the DOM at import).
//
//   rugRGBA(rug, { scale = 1, pile = false, fringe = true, wear = 0 }) -> { width, height, data, ox, oy } (ox / oy:
//                                                            where the rug starts inside the picture, after the fringe;
//                                                            wear 0…1: an antique wash — faded colours, worn pile)
//   rugSVG(rug, { cell = 4, fringe = true }) -> SVG text
//   drawRug(ctx, rug, view, { mode: 'flat' | 'pile', fringe, dark, wear }) view: { x, y, cell, width, height }
//   drawRoom(ctx, rug, { width, height, floor: 'oak' | 'stone' | 'concrete', dark, wear, tilt = 0.55 }) — the rug in
//                                                            perspective on a floor by a wall, lit from a window

import { hexToRgb } from '../stitch/threads.js';

// Deterministic hash noise in [0, 1).
// All "randomness" in pictures is a hash of the knot coordinates, never Math.random: the same rug renders the same
// picture every time (stable previews, reproducible exports, no shimmer when redrawing).
const hash = (x, y, s = 0) => { let h = (x * 374761393 + y * 668265263 + s * 2246822519) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

// Abrash: a slow drift in lightness down the rug, different per colour (dye lots).
// Per colour and per row: a lightness offset that changes in rare steps (about 12% of 6-row bands start a new dye
// lot), the way real abrash runs across the rug in horizontal bands. Computed per palette entry so each colour
// drifts independently.
function abrashOf(rug) {
  const n = rug.palette.length;
  const out = [];
  for (let p = 0; p < n; p++) {
    const rows = new Float32Array(rug.height);
    let v = 0;
    for (let y = 0; y < rug.height; y++) {
      if (hash(p, Math.floor(y / 6), 7) < 0.12) v = (hash(p, y, 3) - 0.5) * 0.16;
      rows[y] = v;
    }
    out.push(rows);
  }
  return out;
}

const shadeRGB = (c, k) => [c[0] * k, c[1] * k, c[2] * k].map((v) => Math.max(0, Math.min(255, v)));

// Antique wash: colours fade towards their grey, and the pile wears down in soft patches (more in the middle, where
// people walk), showing the lighter knot heads.
function worn(c, x, y, rug, wear) {
  if (!wear) return c;
  const l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  const fade = wear * 0.35;
  let r = c[0] + (l - c[0]) * fade, g = c[1] + (l - c[1]) * fade, b = c[2] + (l - c[2]) * fade;
  const cx = (x / rug.width - 0.5) * 2, cy = (y / rug.height - 0.5) * 2;
  const patch = hash(Math.floor(x / 9), Math.floor(y / 7), 11) * 0.6 + hash(Math.floor(x / 23), Math.floor(y / 19), 12) * 0.4;
  const w = wear * Math.max(0, patch - 0.35 - 0.25 * (cx * cx + cy * cy) + (hash(x, y, 13) - 0.5) * 0.25);
  if (w > 0) { const t = Math.min(0.6, w * 1.6); r += (226 - r) * t; g += (212 - g) * t; b += (186 - b) * t; }
  return [r, g, b];
}

// Pure pixel buffer (no canvas): usable in Node for PNG export and tests. Fringe length follows the physical
// fringe (cm -> knots via kpiV) at 60% for a visual balance. Lobes at scale >= 3: the two halves of a symmetric knot
// are shaded as small cylinders lit from above (bright centre line, darker sides and lower part).
export function rugRGBA(rug, { scale = 1, pile = false, fringe = true, wear = 0 } = {}) {
  const s = Math.max(1, Math.round(scale));
  const fr = fringe && rug.fringeCm > 0 ? Math.max(2, Math.round((rug.fringeCm / 2.54) * rug.kpiV * 0.6 * s)) : 0;
  const W = rug.width * s, H = rug.height * s + 2 * fr;
  const data = new Uint8ClampedArray(W * H * 4);
  const pal = rug.palette.map((p) => hexToRgb(p.hex));
  const ab = pile ? abrashOf(rug) : null;
  for (let y = 0; y < rug.height; y++) for (let x = 0; x < rug.width; x++) {
    const p = rug.cells[y * rug.width + x];
    let c = worn(pal[p], x, y, rug, wear);
    if (pile) {
      const light = 1 + ab[p][y] + (hash(x, y) - 0.5) * 0.1 + (x === 0 || x === rug.width - 1 ? -0.25 : 0);
      c = shadeRGB(c, light);
    }
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) {
      let cc = c;
      if (pile && s >= 3) {
        // Two lobes per knot, lit from above.
        const lobe = dx < s / 2 ? dx / (s / 2) : (s - dx) / (s / 2);
        cc = shadeRGB(c, 0.82 + 0.25 * lobe - (dy / s) * 0.12);
      }
      const o = ((fr + y * s + dy) * W + x * s + dx) * 4;
      data[o] = cc[0]; data[o + 1] = cc[1]; data[o + 2] = cc[2]; data[o + 3] = 255;
    }
  }
  if (fr) {
    const warp = [236, 228, 208];
    for (const top of [true, false]) for (let x = 0; x < W; x++) {
      const strand = Math.floor(x / Math.max(1, s)) % 2 === 0 || s === 1;
      const group = Math.floor(x / (4 * s));
      for (let k = 0; k < fr; k++) {
        const y = top ? fr - 1 - k : fr + rug.height * s + k;
        const knotRow = k > fr * 0.15 && k < fr * 0.3;
        const len = fr * (0.85 + hash(group, x, top ? 1 : 2) * 0.15);
        if (k > len) continue;
        const on = knotRow ? x % (4 * s) !== 0 : strand;
        if (!on) continue;
        const c = shadeRGB(warp, 0.85 + hash(x, k) * 0.2 - (knotRow ? 0.08 : 0));
        const o = (y * W + x) * 4;
        data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
      }
    }
  }
  return { width: W, height: H, data, ox: 0, oy: fr };
}

// Horizontal runs of equal colour merged into one subpath, and all subpaths of one colour into one <path>: the SVG
// has one element per colour instead of one rect per knot (orders of magnitude smaller). crispEdges avoids hairline
// seams between abutting runs from antialiasing.
export function rugSVG(rug, { cell = 4, fringe = true } = {}) {
  const fr = fringe && rug.fringeCm > 0 ? Math.round((rug.fringeCm / 2.54) * rug.kpiV * 0.6 * cell) : 0;
  const W = rug.width * cell, H = rug.height * cell + 2 * fr;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges">`];
  const byColor = new Map();
  for (let y = 0; y < rug.height; y++) {
    for (let x = 0; x < rug.width;) {
      const p = rug.cells[y * rug.width + x];
      let x2 = x;
      while (x2 + 1 < rug.width && rug.cells[y * rug.width + x2 + 1] === p) x2++;
      if (!byColor.has(p)) byColor.set(p, []);
      byColor.get(p).push(`M${x * cell} ${fr + y * cell}h${(x2 - x + 1) * cell}v${cell}h${-(x2 - x + 1) * cell}z`);
      x = x2 + 1;
    }
  }
  for (const [p, d] of byColor) out.push(`<path fill="${rug.palette[p].hex}" d="${d.join('')}"/>`);
  if (fr) {
    const lines = [];
    for (let x = cell / 2; x < W; x += cell * 2) { lines.push(`M${x} 0V${fr}`, `M${x} ${H - fr}V${H}`); }
    out.push(`<path stroke="#e8e0cc" stroke-width="${Math.max(1, cell * 0.6)}" d="${lines.join('')}"/>`);
  }
  out.push('</svg>');
  return out.join('\n');
}

// Canvas drawing: a cached RGBA picture at one pixel per knot for far zoom levels, knot by knot when close.
// Level of detail: below 5 px per knot a cached 1-px-per-knot bitmap is scaled (imageSmoothing off when zoomed in,
// so knots stay crisp squares); from 5 px only the VISIBLE knots are drawn with gradients and lobes. The cache lives
// on the rug object as expando properties (__pic, __picKey, __ab), invalidated by mode, wear and rug.__rev, which
// the editor increments after every edit.
export function drawRug(ctx, rug, view, { mode = 'pile', fringe = true, dark = false, wear = 0 } = {}) {
  const { cell, width, height } = view;
  ctx.save();
  ctx.fillStyle = dark ? '#16161a' : '#e6e1d7';
  ctx.fillRect(0, 0, width, height);
  const X = (x) => (x - view.x) * cell, Y = (y) => (y - view.y) * cell;
  const key = mode + (rug.__rev || 0) + '/' + wear;
  if (!rug.__pic || rug.__picKey !== key) {
    const img = rugRGBA(rug, { scale: 1, pile: mode === 'pile', fringe: false, wear });
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(img.width, img.height) : Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
    c.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
    rug.__pic = c;
    rug.__picKey = key;
  }
  // Shadow under the rug.
  ctx.fillStyle = 'rgba(0,0,0,.25)';
  ctx.fillRect(X(0) + cell * 0.6, Y(0) + cell * 0.8, rug.width * cell, rug.height * cell);
  if (mode === 'pile' && cell >= 5) {
    const x0 = Math.max(0, Math.floor(view.x)), y0 = Math.max(0, Math.floor(view.y));
    const x1 = Math.min(rug.width, Math.ceil(view.x + width / cell)), y1 = Math.min(rug.height, Math.ceil(view.y + height / cell));
    const pal = rug.palette.map((p) => hexToRgb(p.hex));
    const ab = rug.__ab || (rug.__ab = abrashOf(rug));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const p = rug.cells[y * rug.width + x];
      const c = shadeRGB(worn(pal[p], x, y, rug, wear), 1 + ab[p][y] + (hash(x, y) - 0.5) * 0.1);
      const px = X(x), py = Y(y);
      ctx.fillStyle = `rgb(${shadeRGB(c, 0.7).join(',')})`;
      ctx.fillRect(px, py, cell + 0.5, cell + 0.5);
      for (const side of [0, 1]) {
        const g = ctx.createLinearGradient(px, py, px, py + cell);
        g.addColorStop(0, `rgb(${shadeRGB(c, 1.12).join(',')})`);
        g.addColorStop(1, `rgb(${shadeRGB(c, 0.85).join(',')})`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(px + cell * (side ? 0.72 : 0.28), py + cell * 0.5, cell * 0.27, cell * 0.48, (side ? 1 : -1) * 0.25, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else {
    ctx.imageSmoothingEnabled = cell < 1;
    ctx.drawImage(rug.__pic, X(0), Y(0), rug.width * cell, rug.height * cell);
    ctx.imageSmoothingEnabled = true;
  }
  if (fringe && rug.fringeCm > 0) {
    const fl = (rug.fringeCm / 2.54) * rug.kpiV * cell * 0.6;
    ctx.strokeStyle = dark ? '#d8cfb8' : '#efe7d2';
    ctx.lineWidth = Math.max(0.6, cell * 0.35);
    ctx.lineCap = 'round';
    const step = Math.max(1, Math.round(2 / Math.max(0.5, cell)));
    ctx.beginPath();
    for (let x = 0.5; x < rug.width; x += 2 * step) {
      const wob = (hash(Math.floor(x), 1) - 0.5) * cell * 0.8;
      const l1 = fl * (0.85 + hash(Math.floor(x), 2) * 0.15), l2 = fl * (0.85 + hash(Math.floor(x), 3) * 0.15);
      ctx.moveTo(X(x), Y(0)); ctx.lineTo(X(x) + wob, Y(0) - l1);
      ctx.moveTo(X(x), Y(rug.height)); ctx.lineTo(X(x) - wob, Y(rug.height) + l2);
    }
    ctx.stroke();
    // Knots tying groups of warps.
    ctx.fillStyle = dark ? '#cfc6ae' : '#e2d8bf';
    for (let x = 2; x < rug.width; x += 4 * step) {
      ctx.fillRect(X(x) - cell, Y(0) - fl * 0.28, cell * 2, Math.max(1, cell * 0.8));
      ctx.fillRect(X(x) - cell, Y(rug.height) + fl * 0.24, cell * 2, Math.max(1, cell * 0.8));
    }
  }
  // Overcast selvedges.
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  ctx.fillRect(X(0), Y(0), Math.max(1, cell * 0.5), rug.height * cell);
  ctx.fillRect(X(rug.width) - Math.max(1, cell * 0.5), Y(0), Math.max(1, cell * 0.5), rug.height * cell);
  ctx.restore();
}

// --- the rug in a room ---
const canvasOf = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));

// Cheap perspective without WebGL: the rug picture is drawn row by row, each row scaled to the width the floor
// plane has at its screen y. z(t) interpolates 1/(y - vy) linearly, which is what a perspective projection does
// (screen-space depth is reciprocal), so rows near the far edge are correctly compressed. Rows are capped at 900
// draw calls per frame.
export function drawRoom(ctx, rug, { width, height, floor = 'oak', dark = false, wear = 0, tilt = 0.55 } = {}) {
  const key = 'room' + (rug.__rev || 0) + '/' + wear;
  if (!rug.__room || rug.__roomKey !== key) {
    const k = Math.max(1, Math.min(3, Math.floor(900 / Math.max(rug.width, rug.height))));
    const img = rugRGBA(rug, { scale: k, pile: true, fringe: true, wear });
    const c = canvasOf(img.width, img.height);
    c.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
    rug.__room = c; rug.__roomKey = key;
  }
  const pic = rug.__room;
  ctx.save();
  // Wall, skirting board and the floor below a horizon line.
  const horizon = height * 0.3;
  const wall = ctx.createLinearGradient(0, 0, width, 0);
  wall.addColorStop(0, dark ? '#2a2724' : '#e9e2d6'); wall.addColorStop(1, dark ? '#1b1917' : '#d8cfbf');
  ctx.fillStyle = wall; ctx.fillRect(0, 0, width, horizon);
  const fl = ctx.createLinearGradient(0, horizon, 0, height);
  const tone = { oak: dark ? ['#4a3523', '#2b1e14'] : ['#c49a6c', '#8f6640'], stone: dark ? ['#4b4a47', '#2e2d2b'] : ['#cfcac1', '#9d968a'], concrete: dark ? ['#3c3d3f', '#262729'] : ['#bdbcb8', '#8d8c88'] }[floor] || ['#c49a6c', '#8f6640'];
  fl.addColorStop(0, tone[0]); fl.addColorStop(1, tone[1]);
  ctx.fillStyle = fl; ctx.fillRect(0, horizon, width, height - horizon);
  const vx = width * 0.5, vy = horizon - height * 0.9 * (1 - tilt); // vanishing point
  ctx.strokeStyle = dark ? 'rgba(0,0,0,.35)' : 'rgba(80,50,20,.22)';
  ctx.lineWidth = 1;
  if (floor !== 'concrete') {
    for (let i = -24; i <= 24; i++) {
      const xb = vx + i * width * 0.09;
      ctx.beginPath(); ctx.moveTo(vx + (xb - vx) * ((horizon - vy) / (height - vy)), horizon); ctx.lineTo(xb, height); ctx.stroke();
    }
    if (floor === 'stone') for (let j = 1; j < 9; j++) { const y = horizon + (height - horizon) * (j / 9) ** 1.6; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
  }
  ctx.fillStyle = dark ? '#151311' : '#f5f1ea';
  ctx.fillRect(0, horizon - 10, width, 10);
  // The rug: rows of the picture projected towards the vanishing point.
  const aspect = pic.width / pic.height;
  const yb = height * 0.97, depth = (height - horizon) * (0.78 + 0.2 * tilt);
  const yt = yb - depth * (0.55 + 0.45 * Math.min(1, 1 / aspect) * 0.6);
  const wb = Math.min(width * 0.9, (yb - yt) * aspect * 2.1 + width * 0.12);
  const persp = (y) => (y - vy) / (yb - vy); // width scale at screen y
  const z = (t) => { const a = 1 / (yb - vy), b = 1 / (yt - vy); return 1 / (a + (b - a) * t) + vy; }; // screen y of picture row t (0 bottom … 1 top)
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.filter = 'blur(6px)';
  ctx.beginPath();
  ctx.moveTo(vx - (wb / 2) * persp(yt) - 4, yt + 4); ctx.lineTo(vx + (wb / 2) * persp(yt) + 4, yt + 4); ctx.lineTo(vx + wb / 2 + 8, yb + 8); ctx.lineTo(vx - wb / 2 - 8, yb + 8);
  ctx.fill();
  ctx.restore();
  const rows = Math.min(pic.height, 900);
  for (let r = 0; r < rows; r++) {
    const t0 = r / rows, t1 = (r + 1) / rows;
    const y0 = z(1 - t0), y1 = z(1 - t1);
    const w = wb * persp((y0 + y1) / 2);
    const sy = Math.floor(t0 * pic.height), sh = Math.max(1, Math.ceil((t1 - t0) * pic.height));
    ctx.drawImage(pic, 0, sy, pic.width, sh, vx - w / 2, y0, w, Math.max(0.6, y1 - y0) + 0.6);
  }
  // Light from a window on the left.
  const light = ctx.createLinearGradient(0, 0, width, height);
  light.addColorStop(0, 'rgba(255,248,230,.16)'); light.addColorStop(0.6, 'rgba(255,248,230,0)'); light.addColorStop(1, 'rgba(0,0,0,.18)');
  ctx.fillStyle = light; ctx.fillRect(0, 0, width, height);
  ctx.restore();
}
