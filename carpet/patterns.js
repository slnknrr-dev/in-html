// carpet/patterns.js - the pattern types of compositions (compose.js): ornaments (medallions, rings, stars,
// rosettes, lattices, stripes, checks, Islamic girih stars by the polygons-in-contact method, whirls such as the
// Georgian borjgali and the Armenian eternity sign, sunbursts, çintamani, banded kilim fields, motif repeats), fractals
// (Sierpinski carpet and triangle, Vicsek, Cantor dust, H-tree, Hilbert and Moore curves, the Heighway dragon, Koch
// snowflakes, Mandelbrot and Julia sets, Newton basins, L-system plants and curves, the Pythagoras tree) and
// abstractions (Truchet tiles, mazes with their solution, elementary cellular automata, Life, Voronoi cells,
// quasicrystals, interference, spirals, terraced noise, Gray–Scott reaction–diffusion, moiré).
//
// A pattern is evaluated in layer coordinates: (u, v) in about [-1, 1] (the unit is half the shorter side of the
// field), after the transforms of its layer. It returns a level (0, 1, 2 … mapped to the layer's colour roles,
// cycling) or -1 where it is transparent.
//
//   PATTERNS { id: { cat: 'ornament' | 'fractal' | 'abstract' | 'motif', params: [spec], levels(p) -> n,
//                    make(p, env) -> at(u, v, cell) } }
//   spec: [key, min, max, step, default] for numbers or [key, [choices], default] for choices
//   env = { rng (seeded, per layer), motif(id) -> motif | null, motifIds: [id] }
//   defaultParams(type) -> { key: value }      normParams(type, raw) -> clamped values

//
// Design: every pattern is a pure point function at(u, v) evaluated once per knot (inverse mapping, see
// compose.js). make() runs once per layer and does all expensive precomputation (fractal iterations into textures,
// maze carving, Life and reaction-diffusion simulation), so the per-knot call stays cheap. Patterns that are
// naturally drawn as curves (L-systems, Hilbert, dragon) are rasterized once into a texture and sampled, because a
// distance-to-polyline test per knot would be O(segments) per knot.
// Levels, not colours: the layer maps level k to roles[k % roles.length], so the same pattern recolours freely.
// Every random choice uses env.rng (or a named fork of it): patterns are deterministic per seed.
const TAU = Math.PI * 2;
const fract = (x) => x - Math.floor(x);
const mod = (a, n) => ((a % n) + n) % n;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// --- textures: patterns drawn once on a square raster covering [-1, 1]², sampled by the nearest texel ---
// Raster stand-in for vector shapes: Int16 levels, -1 = transparent, nearest-texel sampling (knots are coarse
// anyway; interpolation would invent levels that do not exist).
function texture(res) {
  const d = new Int16Array(res * res).fill(-1);
  return {
    res, d,
    at(u, v) {
      const i = Math.floor((u + 1) * 0.5 * res), j = Math.floor((v + 1) * 0.5 * res);
      return i < 0 || j < 0 || i >= res || j >= res ? -1 : d[j * res + i];
    },
  };
}
const toTex = (T, p) => [(p[0] + 1) * 0.5 * T.res, (p[1] + 1) * 0.5 * T.res];
function disc(T, x, y, r, v) {
  const r2 = r * r, x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(T.res - 1, Math.ceil(x + r)), y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(T.res - 1, Math.ceil(y + r));
  for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) { const dx = i + 0.5 - x, dy = j + 0.5 - y; if (dx * dx + dy * dy <= r2) T.d[j * T.res + i] = v; }
}
// A thick polyline; level(s) gives the level at the fraction s of the length.
// Thick polyline as a chain of discs spaced at half the radius (no gaps, simple, robust at joints without miter
// logic). level(s) receives the arc-length fraction, so a curve can cycle colours along its length.
function stroke(T, pts, width, level) {
  const P = pts.map((p) => toTex(T, p));
  let total = 0;
  for (let i = 1; i < P.length; i++) total += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
  const r = Math.max(0.6, width * 0.5 * T.res * 0.5);
  let acc = 0;
  for (let i = 1; i < P.length; i++) {
    const [ax, ay] = P[i - 1], [bx, by] = P[i];
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.ceil(len / Math.max(0.5, r * 0.5)));
    for (let k = 0; k <= n; k++) { const s = (acc + (len * k) / n) / (total || 1); disc(T, ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n, r, level(s)); }
    acc += len;
  }
}
// Even–odd scanline fill of a polygon given in [-1, 1] coordinates.
// Scanline with the even-odd rule: per texel row, intersections of the row centre with every edge, sorted and filled
// pairwise. The half-open test (y1 > y) !== (y2 > y) counts a vertex exactly once.
function fillPoly(T, pts, v) {
  const P = pts.map((p) => toTex(T, p));
  for (let j = 0; j < T.res; j++) {
    const y = j + 0.5, xs = [];
    for (let i = 0, k = P.length - 1; i < P.length; k = i++) {
      const [x1, y1] = P[k], [x2, y2] = P[i];
      if ((y1 > y) !== (y2 > y)) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
    }
    xs.sort((a, b) => a - b);
    for (let q = 0; q + 1 < xs.length; q += 2) for (let i = Math.max(0, Math.ceil(xs[q] - 0.5)); i <= Math.min(T.res - 1, Math.floor(xs[q + 1] - 0.5)); i++) T.d[j * T.res + i] = v;
  }
}
// Scales points into [-m, m]² keeping the aspect, centred.
function fit(pts, m = 0.92) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const s = (2 * m) / Math.max(x1 - x0, y1 - y0, 1e-9), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return pts.map(([x, y]) => [(x - cx) * s, (y - cy) * s]);
}
const cycleLevel = (cycles, L) => (cycles > 0 ? (s) => Math.floor(s * cycles * L) % L : () => 0);

// Turtle graphics for L-systems: F / G draw, f moves, + - turn, [ ] push / pop, | turns back.
// L-system strings grow exponentially; rewriting stops when the string passes maxLen, which caps both memory and
// the number of segments rasterized later.
function turtle(axiom, rules, n, angle, maxLen = 200000) {
  let s = axiom;
  for (let i = 0; i < n && s.length < maxLen; i++) { let o = ''; for (const c of s) o += rules[c] ?? c; s = o; }
  const a = (angle * Math.PI) / 180;
  let x = 0, y = 0, h = -Math.PI / 2;
  const stack = [], paths = [];
  let cur = [[0, 0]];
  for (const c of s) {
    if (c === 'F' || c === 'G' || c === 'A' || c === 'B') { x += Math.cos(h); y += Math.sin(h); cur.push([x, y]); }
    else if (c === 'f') { x += Math.cos(h); y += Math.sin(h); if (cur.length > 1) paths.push(cur); cur = [[x, y]]; }
    else if (c === '+') h += a;
    else if (c === '-') h -= a;
    else if (c === '|') h += Math.PI;
    else if (c === '[') stack.push([x, y, h]);
    else if (c === ']') { [x, y, h] = stack.pop() || [0, 0, -Math.PI / 2]; if (cur.length > 1) paths.push(cur); cur = [[x, y]]; }
  }
  if (cur.length > 1) paths.push(cur);
  return paths;
}
const LSYS = {
  tree: { axiom: 'X', rules: { X: 'F[+X][-X]FX', F: 'FF' }, angle: 25.7, n: 6 },
  bush: { axiom: 'F', rules: { F: 'FF+[+F-F-F]-[-F+F+F]' }, angle: 22.5, n: 4 },
  fern: { axiom: 'X', rules: { X: 'F+[[X]-X]-F[-FX]+X', F: 'FF' }, angle: 25, n: 6 },
  weed: { axiom: 'F', rules: { F: 'F[+F]F[-F][F]' }, angle: 20, n: 5 },
  snowflake: { axiom: 'F++F++F', rules: { F: 'F-F++F-F' }, angle: 60, n: 4 },
  island: { axiom: 'F-F-F-F', rules: { F: 'F-F+F+FF-F-F+F' }, angle: 90, n: 3 },
  arrowhead: { axiom: 'A', rules: { A: 'B-A-B', B: 'A+B+A' }, angle: 60, n: 7 },
  crystal: { axiom: 'F+F+F+F', rules: { F: 'FF+F++F+F' }, angle: 90, n: 4 },
  gosper: { axiom: 'A', rules: { A: 'A-B--B+A++AA+B-', B: '+A-BB--B-A++A+B' }, angle: 60, n: 4 },
  kolam: { axiom: 'F+XF+F+XF', rules: { X: 'XF-F+F-XF+F+XF-F+F-X' }, angle: 90, n: 4 },
  sierpinski: { axiom: 'F-G-G', rules: { F: 'F-G+F+G-F', G: 'GG' }, angle: 120, n: 6 },
  levy: { axiom: 'F', rules: { F: '+F--F+' }, angle: 45, n: 12 },
};

// Hilbert curve points of order n in [0, 2^n)².
// Classic d -> (x, y) conversion: two bits of d per level choose the quadrant; quadrant rotation/reflection (the
// swap and the s-1-x flips) makes the curve continuous. O(N^2 log N) for N = 2^n.
function hilbertPoints(n) {
  const N = 1 << n, pts = [];
  for (let d = 0; d < N * N; d++) {
    let x = 0, y = 0, t = d;
    for (let s = 1; s < N; s *= 2) {
      const rx = 1 & (t >> 1), ry = 1 & (t ^ rx);
      if (!ry) { if (rx) { x = s - 1 - x; y = s - 1 - y; } [x, y] = [y, x]; }
      x += s * rx; y += s * ry; t >>= 2;
    }
    pts.push([x, y]);
  }
  return pts;
}

// Seeded value noise in [0, 1).
// Periodic value noise (lattice indices wrap with mod), so it can be sampled at any coordinate, unlike the bounded
// variant in generate.js.
function valueNoise(rng, cells = 64) {
  const g = new Float32Array(cells * cells).map(() => rng.next());
  const sm = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y), tx = sm(x - ix), ty = sm(y - iy);
    const a = g[mod(iy, cells) * cells + mod(ix, cells)], b = g[mod(iy, cells) * cells + mod(ix + 1, cells)];
    const c = g[mod(iy + 1, cells) * cells + mod(ix, cells)], d = g[mod(iy + 1, cells) * cells + mod(ix + 1, cells)];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

// Distance from p to the segment ab.
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-12;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
// Ray-casting point-in-polygon (even-odd), the same edge rule as fillPoly.
function inPoly(px, py, P) {
  let c = false;
  for (let i = 0, k = P.length - 1; i < P.length; k = i++) {
    const [x1, y1] = P[k], [x2, y2] = P[i];
    if ((y1 > py) !== (y2 > py) && px < x1 + ((py - y1) * (x2 - x1)) / (y2 - y1)) c = !c;
  }
  return c;
}
// The boundary radius of a star with n points (outer radius 1, inner radius k) at angle th.
// Radius of a star outline at angle th by intersecting the ray with the straight edge between an outer point (radius
// 1) and the adjacent inner point (radius k); the angle is folded into one half-spike first (dihedral symmetry).
function starRadius(th, n, k) {
  const a = Math.PI / n;
  let f = mod(th, 2 * a);
  if (f > a) f = 2 * a - f;
  const p1x = k * Math.cos(a), p1y = k * Math.sin(a);
  const ex = p1x - 1, ey = p1y;
  const dx = Math.cos(f), dy = Math.sin(f);
  return (1 * ey - 0 * ex) / (dx * ey - dy * ex);
}

// Polygons in contact: the rays from the edge midpoints of a regular n-gon tile (apothem 1) at the contact angle,
// clipped where neighbouring rays meet. Returns { segs: [[ax, ay, bx, by]], star: [polygon] }.
// Hankin's "polygons in contact" method for girih: from the midpoint of every edge of a regular n-gon two rays leave
// at +-theta from the inward normal; each ray is cut where it meets the ray from the neighbouring edge midpoint
// (solving a 2x2 linear system). Tiling the polygons makes the rays continue across edges into the interlaced star
// pattern; theta controls how pointed the stars are.
function contactStar(n, thetaDeg) {
  const th = (thetaDeg * Math.PI) / 180;
  const M = [], N = [];
  for (let k = 0; k < n; k++) { const a = (TAU * k) / n; M.push([Math.cos(a), Math.sin(a)]); N.push([-Math.cos(a), -Math.sin(a)]); }
  const rot = (v, a) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];
  const segs = [], star = [];
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    const d1 = rot(N[k], -th), d2 = rot(N[k2], th);
    // M[k] + s d1 = M[k2] + t d2
    const det = d1[0] * -d2[1] - d1[1] * -d2[0];
    const rx = M[k2][0] - M[k][0], ry = M[k2][1] - M[k][1];
    const s = (rx * -d2[1] - ry * -d2[0]) / (det || 1e-9);
    const P = [M[k][0] + s * d1[0], M[k][1] + s * d1[1]];
    segs.push([M[k][0], M[k][1], P[0], P[1]], [M[k2][0], M[k2][1], P[0], P[1]]);
    star.push(M[k], P);
  }
  return { segs, star };
}

// Nearest centre of a hexagonal lattice with apothem a (edges facing 0°, 60°, …): local coordinates in apothems.
// Hex lattice via its basis vectors; the true nearest centre is among the 4 candidates around the skewed-grid cell
// (checked by distance). Returns coordinates local to that centre plus a cell id (7919 is a prime) for variation.
function hexLocal(u, v, a) {
  const b1x = 2 * a, b2x = a, b2y = a * Math.sqrt(3);
  const j = v / b2y, i = (u - j * b2x) / b1x;
  let best = null, bd = Infinity;
  for (const di of [0, 1]) for (const dj of [0, 1]) {
    const I = Math.floor(i) + di, J = Math.floor(j) + dj;
    const cx = I * b1x + J * b2x, cy = J * b2y, d = (u - cx) ** 2 + (v - cy) ** 2;
    if (d < bd) { bd = d; best = [(u - cx) / a, (v - cy) / a, I * 7919 + J]; }
  }
  return best;
}

const MOTIF_ORDER = 'ABCDOLGFR';

export const PATTERNS = {
  // ---------- ornaments ----------
  medallion: {
    cat: 'ornament',
    params: [['size', 0.2, 1.6, 0.02, 0.78], ['aspect', 0.4, 2.5, 0.05, 1.3], ['shape', 0.6, 4, 0.05, 1.35], ['lobes', 0, 24, 1, 8], ['lobeDepth', 0, 0.4, 0.01, 0.1], ['bands', 1, 10, 1, 5], ['rim', 0, 1, 1, 1], ['pendants', 0, 1, 1, 1]],
    levels: (p) => p.bands + 1,
    make(p) {
      const a = p.size, b = p.size * p.aspect, e = p.shape;
      return (u, v) => {
        const th = Math.atan2(v, u);
        const m = 1 + (p.lobes ? p.lobeDepth * Math.cos(p.lobes * th) : 0);
        const t = Math.pow(Math.abs(u / a) ** e + Math.abs(v / b) ** e, 1 / e) / m;
        if (t <= 1) {
          const q = t * p.bands, band = Math.min(p.bands - 1, Math.floor(q));
          if (p.rim && (fract(q) > 0.86 || t > 0.97)) return 0;
          return 1 + band;
        }
        if (p.pendants) {
          const dv = Math.abs(v) - b * 1.04, s = a * 0.16;
          if (dv > 0 && Math.abs(u) / s + Math.abs(dv - s * 1.2) / (s * 1.25) <= 1) return Math.abs(u) / s + Math.abs(dv - s * 1.2) / (s * 1.25) > 0.75 ? 0 : 2;
          if (dv > -0.01 && dv < s * 0.3 && Math.abs(u) < s * 0.18) return 0;
        }
        return -1;
      };
    },
  },
  frame: {
    cat: 'ornament',
    params: [['shape', ['square', 'circle', 'octagon', 'arch', 'lobed'], 'square'], ['size', 0.2, 2.5, 0.01, 0.92], ['thickness', 0.01, 0.6, 0.01, 0.08], ['fill', 0, 1, 1, 0]],
    levels: (p) => (p.fill ? 2 : 1),
    make(p) {
      const inside = (u, v, s) => {
        if (s <= 0) return false;
        switch (p.shape) {
          case 'circle': return Math.hypot(u, v) <= s;
          case 'octagon': return Math.max(Math.abs(u), Math.abs(v), (Math.abs(u) + Math.abs(v)) / Math.SQRT2 / 0.92) <= s;
          case 'lobed': return Math.hypot(u, v) <= s * (1 + 0.07 * Math.cos(12 * Math.atan2(v, u)));
          case 'arch': {
            // A mihrab niche: a rectangle under an equilateral pointed arch.
            const w = 0.62 * s, y0 = -s + Math.sqrt(3) * w;
            if (Math.abs(u) > w || v > s) return false;
            return v >= y0 || (Math.hypot(u + w, v - y0) <= 2 * w && Math.hypot(u - w, v - y0) <= 2 * w);
          }
          default: return Math.max(Math.abs(u), Math.abs(v)) <= s;
        }
      };
      return (u, v) => (!inside(u, v, p.size) ? -1 : !inside(u, v, p.size - p.thickness) ? 0 : p.fill ? 1 : -1);
    },
  },
  rings: {
    cat: 'ornament',
    params: [['shape', ['circle', 'diamond', 'square', 'octagon', 'star', 'flower'], 'circle'], ['count', 2, 40, 1, 8], ['fill', 0.15, 1, 0.05, 0.6], ['size', 0.2, 2.5, 0.05, 1]],
    levels: (p) => p.count,
    make(p) {
      const D = {
        circle: (u, v) => Math.hypot(u, v), diamond: (u, v) => Math.abs(u) + Math.abs(v), square: (u, v) => Math.max(Math.abs(u), Math.abs(v)),
        octagon: (u, v) => Math.max(Math.abs(u), Math.abs(v), (Math.abs(u) + Math.abs(v)) / Math.SQRT2),
        star: (u, v) => Math.hypot(u, v) / starRadius(Math.atan2(v, u), 8, 0.62), flower: (u, v) => Math.hypot(u, v) / (1 + 0.16 * Math.cos(6 * Math.atan2(v, u))),
      }[p.shape];
      return (u, v) => {
        const t = D(u, v) / p.size;
        if (t > 1) return -1;
        const q = t * p.count;
        return fract(q) > p.fill ? -1 : Math.floor(q);
      };
    },
  },
  star: {
    cat: 'ornament',
    params: [['points', 3, 32, 1, 8], ['inner', 0.15, 0.95, 0.01, 0.5], ['nest', 1, 10, 1, 3], ['size', 0.2, 2, 0.02, 0.9], ['twist', 0, 1, 0.05, 0]],
    levels: (p) => p.nest + 1,
    make(p) {
      return (u, v) => {
        const r = Math.hypot(u, v) / p.size;
        if (r > 1) return -1;
        const th = Math.atan2(v, u);
        // Concentric stars, each smaller one turned by the twist.
        for (let k = 0; k < p.nest; k++) {
          const s = 1 - k / p.nest;
          const rr = starRadius(th + (k * p.twist * Math.PI) / p.points, p.points, p.inner) * s;
          if (r > rr) return k === 0 ? -1 : k;
        }
        return p.nest;
      };
    },
  },
  rosette: {
    cat: 'ornament',
    params: [['petals', 3, 24, 1, 8], ['width', 0.1, 1.5, 0.05, 0.7], ['rings', 1, 6, 1, 2], ['center', 0, 0.6, 0.02, 0.22], ['size', 0.2, 2, 0.02, 0.8]],
    levels: (p) => p.rings + 2,
    make(p) {
      return (u, v) => {
        const r = Math.hypot(u, v) / p.size;
        if (r > 1) return -1;
        if (r < p.center) return 0;
        const th = Math.atan2(v, u);
        const petal = p.center + (1 - p.center) * Math.pow(Math.abs(Math.cos((p.petals * th) / 2)), 1 / p.width);
        if (r > petal) return -1;
        const ring = Math.floor(((r - p.center) / (petal - p.center + 1e-9)) * p.rings);
        return 1 + Math.min(p.rings - 1, ring) + (r > petal * 0.9 ? p.rings - ring : 0);
      };
    },
  },
  lattice: {
    cat: 'ornament',
    params: [['kind', ['diamond', 'square', 'ogee', 'hex', 'triangle'], 'diamond'], ['cells', 1, 24, 1, 6], ['width', 0.01, 0.45, 0.01, 0.08], ['nodes', 0, 0.45, 0.01, 0.16], ['jitter', 0, 0.3, 0.01, 0], ['fill', 0, 1, 1, 0]],
    levels: (p) => (p.fill ? 4 : 2),
    make(p, env) {
      const n = env.rng.fork('jitter').next() * 100;
      const w = p.width / 2;
      const wob = (x, y) => (p.jitter ? p.jitter * Math.sin(x * 5.1 + n) * Math.cos(y * 3.7 - n) : 0);
      return (u, v) => {
        const x = u * p.cells / 2, y = v * p.cells / 2;
        let d, nodeD, cell = 0;
        if (p.kind === 'square' || p.kind === 'diamond') {
          const [a, b] = p.kind === 'diamond' ? [x + y, x - y] : [x, y];
          const aa = a + wob(a, b), bb = b + wob(b, a);
          d = Math.min(Math.abs(aa - Math.round(aa)), Math.abs(bb - Math.round(bb)));
          nodeD = Math.hypot(aa - Math.round(aa), bb - Math.round(bb));
          cell = (Math.floor(aa) + Math.floor(bb)) & 1;
        } else if (p.kind === 'ogee') {
          const s = 0.28 * Math.sin(Math.PI * (y + wob(x, y)));
          const a = x - s, b = x + s;
          d = Math.min(Math.abs(a - Math.round(a)), Math.abs(b - Math.round(b)) ) * Math.cos(Math.atan(0.28 * Math.PI));
          nodeD = Math.hypot(x - Math.round(x), (y - Math.round(y)) * 0.6);
          cell = (Math.floor(a) + Math.floor(b)) & 1;
        } else if (p.kind === 'hex') {
          const [lu, lv, id] = hexLocal(x, y, 0.5);
          const hd = Math.max(Math.abs(lu), Math.abs(lu / 2 + (lv * Math.sqrt(3)) / 2), Math.abs(lu / 2 - (lv * Math.sqrt(3)) / 2));
          d = (1 - hd) * 0.5;
          nodeD = Infinity;
          for (let k = 0; k < 6; k++) { const a = (TAU * (k + 0.5)) / 6, r = 2 / Math.sqrt(3); nodeD = Math.min(nodeD, Math.hypot(lu - r * Math.cos(a), lv - r * Math.sin(a)) * 0.5); }
          cell = mod(id, 3);
        } else {
          const fams = [0, 60, 120].map((g) => { const a = (g * Math.PI) / 180, t = x * Math.cos(a + Math.PI / 2) + y * Math.sin(a + Math.PI / 2); return t + wob(t, g); });
          d = Math.min(...fams.map((t) => Math.abs(t - Math.round(t)))) * 0.9;
          nodeD = Math.hypot(...fams.slice(0, 2).map((t) => t - Math.round(t))) * 0.9;
          cell = (Math.floor(fams[0]) + Math.floor(fams[1]) + Math.floor(fams[2])) & 1;
        }
        if (p.nodes && nodeD < p.nodes) return 1;
        if (d < w) return 0;
        return p.fill ? 2 + cell : -1;
      };
    },
  },
  stripes: {
    cat: 'ornament',
    params: [['count', 2, 80, 1, 12], ['angle', 0, 180, 1, 0], ['kind', ['straight', 'zigzag', 'wave', 'steps'], 'straight'], ['wave', 0, 0.6, 0.01, 0], ['freq', 0, 24, 0.5, 4], ['fill', 0.1, 1, 0.05, 1], ['random', 0, 1, 1, 0]],
    levels: (p) => Math.min(p.count, 8),
    make(p, env) {
      const a = (p.angle * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
      // Random widths: cumulative borders over [-2, 2].
      let borders = null;
      if (p.random) {
        const r = env.rng.fork('widths');
        borders = [-2];
        while (borders[borders.length - 1] < 2) borders.push(borders[borders.length - 1] + (4 / p.count) * (0.3 + r.next() * 1.4));
      }
      return (u, v) => {
        const s = u * sa + v * ca, q = u * ca - v * sa;
        let off = 0;
        if (p.wave) {
          const z = q * p.freq;
          off = p.kind === 'zigzag' ? p.wave * (Math.abs(fract(z) - 0.5) * 4 - 1) : p.kind === 'steps' ? p.wave * (Math.round((Math.abs(fract(z) - 0.5) * 4 - 1) * 3) / 3) : p.kind === 'wave' ? p.wave * Math.sin(z * TAU) : 0;
        }
        const t = s + off;
        if (borders) {
          let i = 0;
          while (i + 1 < borders.length && borders[i + 1] <= t) i++;
          const f = (t - borders[i]) / ((borders[i + 1] || 2) - borders[i]);
          return f > p.fill ? -1 : i;
        }
        const k = ((t + 2) * p.count) / 4;
        return fract(k) > p.fill ? -1 : Math.floor(k);
      };
    },
  },
  checks: {
    cat: 'ornament',
    params: [['kind', ['checker', 'diamond', 'honeycomb', 'blocks', 'scales'], 'checker'], ['size', 0.04, 1, 0.01, 0.2]],
    levels: (p) => (p.kind === 'blocks' ? 3 : 2),
    make(p) {
      const s = p.size;
      return (u, v) => {
        if (p.kind === 'checker') return (Math.floor(u / s) + Math.floor(v / s)) & 1;
        if (p.kind === 'diamond') return (Math.floor((u + v) / s) + Math.floor((u - v) / s)) & 1;
        if (p.kind === 'honeycomb') {
          const [lu, lv] = hexLocal(u / s, v / s, 0.5);
          const hd = Math.max(Math.abs(lu), Math.abs(lu / 2 + (lv * Math.sqrt(3)) / 2), Math.abs(lu / 2 - (lv * Math.sqrt(3)) / 2));
          return hd > 0.82 ? 0 : 1;
        }
        if (p.kind === 'blocks') {
          const [lu, lv] = hexLocal(u / s, v / s, 0.5);
          const a = Math.atan2(lv, lu);
          return mod(Math.floor((a + Math.PI / 2) / (TAU / 3)), 3);
        }
        const row = Math.floor(v / s), x = u / s + (row & 1 ? 0.5 : 0), fy = fract(v / s);
        const dx = fract(x) - 0.5;
        return Math.hypot(dx, fy) < 0.5 ? (Math.hypot(dx, fy) > 0.42 ? 0 : 1) : 1;
      };
    },
  },
  // Square and hex tilings are exact; the octagon tiling (4.8.8) is approximated by folding the corners of a square
  // tile, which leaves visible distortion at large sizes.
  girih: {
    cat: 'ornament',
    params: [['tiling', ['square', 'hex', 'octagon'], 'square'], ['size', 0.06, 1, 0.01, 0.3], ['angle', 5, 75, 0.5, 22.5], ['width', 0.01, 0.3, 0.005, 0.07], ['rosette', 0, 0.6, 0.01, 0.25]],
    levels: () => 4,
    make(p) {
      const n = p.tiling === 'hex' ? 6 : p.tiling === 'octagon' ? 8 : 4;
      const { segs, star } = contactStar(n, p.angle);
      const w = p.width;
      return (u, v) => {
        let lu, lv;
        if (n === 6) [lu, lv] = hexLocal(u, v, p.size);
        else {
          const s = 2 * p.size;
          lu = (mod(u + p.size, s) - p.size) / p.size; lv = (mod(v + p.size, s) - p.size) / p.size;
          if (n === 8) {
            // Octagons and squares: the corner squares of a square tile are folded onto the octagon edges.
            const q = Math.abs(lu) + Math.abs(lv);
            if (q > 1 / Math.cos(Math.PI / 8) * 1.08) { const fx = Math.sign(lu) || 1, fy = Math.sign(lv) || 1; lu = (lu - fx) * 2.4; lv = (lv - fy) * 2.4; }
          }
        }
        let d = Infinity;
        for (const [ax, ay, bx, by] of segs) { const e = segDist(lu, lv, ax, ay, bx, by); if (e < d) d = e; }
        if (d < w) return 0;
        if (Math.hypot(lu, lv) < p.rosette && Math.hypot(lu, lv) < starRadius(Math.atan2(lv, lu), n, 0.55) * p.rosette) return 3;
        return inPoly(lu, lv, star) ? 1 : 2;
      };
    },
  },
  whirl: {
    cat: 'ornament',
    params: [['arms', 2, 16, 1, 7], ['curl', 0, 5, 0.05, 1.6], ['width', 0.15, 0.95, 0.01, 0.55], ['size', 0.2, 2, 0.02, 0.85], ['core', 0, 0.5, 0.01, 0.16], ['rim', 0, 1, 1, 1]],
    levels: () => 4,
    make(p) {
      return (u, v) => {
        const r = Math.hypot(u, v) / p.size;
        if (r > 1) return -1;
        if (p.rim && r > 0.94) return 3;
        if (r < p.core) return 2;
        const phi = Math.atan2(v, u) + p.curl * Math.PI * Math.pow(r, 0.8);
        const q = (mod(phi, TAU) / TAU) * p.arms;
        const f = fract(q), arm = Math.floor(q);
        // Arms taper towards the rim like the borjgali.
        const lim = p.width * (1 - 0.35 * r);
        return f < lim ? arm & 1 : -1;
      };
    },
  },
  sunburst: {
    cat: 'ornament',
    params: [['rays', 6, 64, 1, 24], ['size', 0.2, 2, 0.02, 0.9], ['serration', 0, 0.4, 0.01, 0.18], ['core', 0.1, 0.7, 0.01, 0.42], ['cross', 0, 1, 1, 1]],
    levels: () => 4,
    make(p) {
      return (u, v) => {
        const r = Math.hypot(u, v) / p.size;
        if (r > 1) return -1;
        const th = Math.atan2(v, u);
        if (r < p.core) {
          // The core: a stepped cross, as on Chelaberd ("eagle") Kazaks.
          if (p.cross) { const a = Math.abs(u) / p.size / p.core, b = Math.abs(v) / p.size / p.core; if ((a < 0.22 || b < 0.22) && a + b < 1.05) return 2; }
          return r > p.core * 0.9 ? 3 : 1;
        }
        const q = (mod(th, TAU) / TAU) * p.rays, f = fract(q);
        const tip = 1 - p.serration * Math.abs(Math.sin(r * 18));
        const halfW = 0.5 * (1 - (r - p.core) / (1 - p.core)) * tip;
        if (Math.abs(f - 0.5) < halfW) return Math.floor(q) & 1 ? 0 : 3;
        return -1;
      };
    },
  },
  cintamani: {
    cat: 'ornament',
    params: [['size', 0.08, 1, 0.01, 0.28], ['stripes', 0, 1, 1, 1], ['ball', 0.1, 0.4, 0.01, 0.2]],
    levels: () => 3,
    make(p) {
      return (u, v) => {
        const s = p.size, row = Math.floor(v / s), x = u / s + (row & 1 ? 0.5 : 0), y = fract(v / s), fx = fract(x) - 0.5;
        // Three balls in a triangle.
        for (const [bx, by] of [[-0.18, 0.2], [0.18, 0.2], [0, 0.48]]) { const d = Math.hypot(fx - bx, y - by); if (d < p.ball) return d < p.ball * 0.45 ? 2 : 0; }
        if (p.stripes) {
          // Two wavy "tiger stripes".
          const w1 = 0.72 + 0.05 * Math.sin(fx * 14), w2 = 0.86 + 0.05 * Math.sin(fx * 14 + 1);
          if (Math.abs(fx) < 0.32 && (Math.abs(y - w1) < 0.04 || Math.abs(y - w2) < 0.04)) return 1;
        }
        return -1;
      };
    },
  },
  bands: {
    cat: 'ornament',
    params: [['count', 3, 40, 1, 11], ['spacer', 0, 0.5, 0.01, 0.12], ['motifs', 0, 1, 1, 1]],
    levels: () => 5,
    make(p, env) {
      const r = env.rng.fork('bands');
      const kinds = ['solid', 'diamonds', 'zigzag', 'crosses', 'triangles', 'steps', 'dots', 'chevron', 'hooks'];
      const list = [];
      let y = -1.6;
      while (y < 1.6) {
        const h = (3.2 / p.count) * (0.5 + r.next());
        list.push({ y0: y, h, kind: p.motifs ? r.pick(kinds) : 'solid', bg: r.int(5), fg: r.int(5) });
        y += h;
      }
      for (const b of list) if (b.fg === b.bg) b.fg = (b.bg + 2) % 5;
      return (u, v) => {
        const B = list.find((b) => v >= b.y0 && v < b.y0 + b.h);
        if (!B) return -1;
        const ly = (v - B.y0) / B.h, sp = p.spacer;
        if (ly < sp / 2 || ly > 1 - sp / 2) return 0;
        const yy = (ly - sp / 2) / (1 - sp) * 2 - 1, k = B.h * (1 - sp) / 2, xx = u / k;
        const fx = fract(xx / 2) * 2 - 1;
        let on = false;
        switch (B.kind) {
          case 'diamonds': on = Math.abs(fx) + Math.abs(yy) < 0.8 && !(Math.abs(fx) + Math.abs(yy) < 0.4 && Math.abs(fx) + Math.abs(yy) > 0.2); break;
          case 'zigzag': on = Math.abs(yy - (Math.abs(fx) * 2 - 1) * 0.7) < 0.3; break;
          case 'crosses': on = (Math.abs(fx) < 0.18 && Math.abs(yy) < 0.75) || (Math.abs(yy) < 0.18 && Math.abs(fx) < 0.75); break;
          case 'triangles': on = yy > Math.abs(fx) * 2 - 1; break;
          case 'steps': on = Math.floor((yy + 1) * 2.5) / 2.5 - 1 > Math.floor(Math.abs(fx) * 5) / 5 * 2 - 1; break;
          case 'dots': on = Math.hypot(fx, yy) < 0.45; break;
          case 'chevron': on = fract((yy + Math.abs(fx)) * 1.5) < 0.5; break;
          case 'hooks': on = Math.abs(fx) + Math.abs(yy) < 0.85 && (Math.abs(fx) > 0.3 || Math.abs(yy) > 0.3) && !(fx > 0.3 && yy < -0.1); break;
          default: on = false;
        }
        return on ? B.fg : B.bg;
      };
    },
  },
  motif: {
    cat: 'motif',
    params: [['motif', 'motifs', 'star8'], ['scale', 0.05, 2.5, 0.01, 0.5], ['mode', ['single', 'grid', 'halfdrop', 'brick'], 'single'], ['gap', 0, 2, 0.05, 0.35], ['alt', 'motifs', ''], ['flip', 0, 1, 1, 0]],
    levels: () => 9,
    make(p, env) {
      const m = env.motif(p.motif) || env.motif('star8');
      const m2 = (p.alt && env.motif(p.alt)) || null;
      const size = (x) => ({ w: Math.max(...x.rows.map((r) => r.length)), h: x.rows.length });
      const S = size(m), S2 = m2 ? size(m2) : S;
      const H = Math.max(S.h, S2.h, S.w, S2.w);
      const cell = (2 * p.scale) / H; // one motif cell in layer units
      const charAt = (mm, sz, x, y) => {
        const i = Math.floor(x / cell + sz.w / 2), j = Math.floor(y / cell + sz.h / 2);
        if (i < 0 || j < 0 || i >= sz.w || j >= sz.h) return -1;
        const c = mm.rows[j][i];
        return c && c !== '.' ? MOTIF_ORDER.indexOf(c) : -1;
      };
      if (p.mode === 'single') return (u, v) => charAt(m, S, u, v);
      const step = H * cell * (1 + p.gap);
      return (u, v) => {
        let col = Math.floor(u / step + 0.5), row;
        let y = v;
        if (p.mode === 'halfdrop' && col & 1) y += step / 2;
        row = Math.floor(y / step + 0.5);
        let x = u;
        if (p.mode === 'brick' && row & 1) { x += step / 2; col = Math.floor(x / step + 0.5); }
        const lx = x - col * step, ly = y - row * step;
        const useAlt = m2 && ((row + col) & 1);
        let lxx = lx;
        if (p.flip && (col & 1)) lxx = -lx;
        return useAlt ? charAt(m2, S2, lxx, ly) : charAt(m, S, lxx, ly);
      };
    },
  },

  // ---------- fractals ----------
  sierpinski: {
    cat: 'fractal', params: [['depth', 1, 7, 1, 4]], levels: (p) => p.depth + 1,
    make(p) {
      return (u, v) => {
        if (u < -1 || u >= 1 || v < -1 || v >= 1) return -1;
        let x = (u + 1) / 2, y = (v + 1) / 2;
        for (let d = 0; d < p.depth; d++) {
          x *= 3; y *= 3;
          const ix = Math.floor(x), iy = Math.floor(y);
          if (ix === 1 && iy === 1) return 1 + d;
          x -= ix; y -= iy;
        }
        return 0;
      };
    },
  },
  triangle: {
    cat: 'fractal', params: [['depth', 2, 10, 1, 6]], levels: () => 2,
    make(p) {
      const N = 1 << p.depth;
      return (u, v) => {
        const r = Math.floor(((v + 1) / 2) * N);
        if (r < 0 || r >= N) return -1;
        const k = Math.floor(((u + 1) / 2) * N - (N - 1 - r) / 2);
        if (k < 0 || k > r) return -1;
        return (k & (r - k)) === 0 ? 0 : 1;
      };
    },
  },
  vicsek: {
    cat: 'fractal', params: [['depth', 1, 6, 1, 4], ['kind', ['cross', 'saltire', 'dust'], 'cross']], levels: (p) => p.depth + 1,
    make(p) {
      return (u, v) => {
        if (u < -1 || u >= 1 || v < -1 || v >= 1) return -1;
        let x = (u + 1) / 2, y = (v + 1) / 2;
        for (let d = 0; d < p.depth; d++) {
          x *= 3; y *= 3;
          const ix = Math.floor(x), iy = Math.floor(y);
          const keep = p.kind === 'cross' ? ix === 1 || iy === 1 : p.kind === 'saltire' ? (ix === 1 && iy === 1) || (ix !== 1 && iy !== 1) : ix !== 1 && iy !== 1;
          if (!keep) return d === 0 ? -1 : d;
          x -= ix; y -= iy;
        }
        return p.depth;
      };
    },
  },
  htree: {
    cat: 'fractal', params: [['depth', 2, 12, 1, 8], ['width', 0.004, 0.08, 0.002, 0.02]], levels: (p) => Math.min(p.depth, 6),
    make(p) {
      const T = texture(512);
      const go = (x, y, len, horiz, d) => {
        if (d >= p.depth) return;
        const [ax, ay, bx, by] = horiz ? [x - len, y, x + len, y] : [x, y - len, x, y + len];
        stroke(T, [[ax, ay], [bx, by]], p.width * (1 - d / (p.depth + 2)) * 2, () => d % 6);
        go(ax, ay, len / Math.SQRT2, !horiz, d + 1);
        go(bx, by, len / Math.SQRT2, !horiz, d + 1);
      };
      go(0, 0, 0.5, true, 0);
      return T.at;
    },
  },
  hilbert: {
    cat: 'fractal', params: [['order', 1, 7, 1, 4], ['width', 0.1, 0.95, 0.05, 0.45], ['cycles', 0, 12, 1, 3], ['closed', 0, 1, 1, 0]], levels: () => 4,
    make(p) {
      const T = texture(Math.min(1024, (1 << p.order) * 24));
      let pts;
      if (p.closed && p.order > 1) {
        // Moore curve: four Hilbert curves of order - 1.
        const h = hilbertPoints(p.order - 1), n = 1 << (p.order - 1);
        const q = [h.map(([x, y]) => [n - 1 - y, x]), h.map(([x, y]) => [n - 1 - y, x + n]), h.map(([x, y]) => [y + n, 2 * n - 1 - x]), h.map(([x, y]) => [y + n, n - 1 - x])];
        pts = [...q[0], ...q[1], ...q[2], ...q[3]];
        pts.push(pts[0]);
      } else pts = hilbertPoints(p.order);
      const N = 1 << p.order;
      const W = (2 / N) * p.width;
      stroke(T, pts.map(([x, y]) => [((x + 0.5) / N) * 2 - 1, ((y + 0.5) / N) * 2 - 1]), W, cycleLevel(p.cycles, 4));
      return T.at;
    },
  },
  dragon: {
    cat: 'fractal', params: [['iterations', 4, 16, 1, 12], ['width', 0.002, 0.05, 0.001, 0.012], ['cycles', 0, 12, 1, 4], ['kind', ['heighway', 'twin', 'terdragon'], 'heighway']], levels: () => 4,
    make(p) {
      const T = texture(768);
      const curve = (n) => {
        if (p.kind === 'terdragon') return turtle('F', { F: 'F+F-F' }, Math.min(n, 9), 120)[0];
        let s = [1];
        for (let i = 0; i < n; i++) s = [...s, 1, ...s.slice().reverse().map((x) => -x)];
        let x = 0, y = 0, dx = 1, dy = 0;
        const pts = [[0, 0]];
        for (const t of s) { x += dx; y += dy; pts.push([x, y]); [dx, dy] = t > 0 ? [-dy, dx] : [dy, -dx]; }
        x += dx; y += dy; pts.push([x, y]);
        return pts;
      };
      const c = curve(p.iterations);
      const paths = p.kind === 'twin' ? [c, c.map(([x, y]) => [-x, -y])] : [c];
      const all = fit(paths.flat());
      let k = 0;
      for (const path of paths) { stroke(T, all.slice(k, k + path.length), p.width * 2, cycleLevel(p.cycles, 4)); k += path.length; }
      return T.at;
    },
  },
  koch: {
    cat: 'fractal', params: [['depth', 0, 6, 1, 4], ['nest', 1, 5, 1, 3], ['anti', 0, 1, 1, 0]], levels: (p) => p.nest,
    make(p) {
      const T = texture(640);
      let pts = [0, 1, 2].map((k) => [Math.cos(-Math.PI / 2 + (k * TAU) / 3), Math.sin(-Math.PI / 2 + (k * TAU) / 3)]);
      for (let d = 0; d < p.depth; d++) {
        const out = [];
        for (let i = 0; i < pts.length; i++) {
          const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
          const dx = (bx - ax) / 3, dy = (by - ay) / 3, s = p.anti ? -1 : 1;
          const px = ax + dx * 1.5 + s * dy * Math.sqrt(3) / 2, py = ay + dy * 1.5 - s * dx * Math.sqrt(3) / 2;
          out.push([ax, ay], [ax + dx, ay + dy], [px, py], [ax + 2 * dx, ay + 2 * dy]);
        }
        pts = out;
      }
      pts = fit(pts, 0.95);
      for (let k = 0; k < p.nest; k++) { const s = 1 - k / p.nest; fillPoly(T, pts.map(([x, y]) => [x * s, y * s]), k); }
      return T.at;
    },
  },
  // Escape-time rendering: iterate z = z^2 + c, escape radius 4 (|z|^2 < 16, larger than the minimal 2 for smoother
  // bands). Inside the set -> level 0; escape counts modulo `bands` give the classic contour bands; `cut` makes the
  // fastest-escaping far field transparent so the set floats on the layers below. Higher powers use polar form.
  mandelbrot: {
    cat: 'fractal', params: [['cx', -2, 1, 0.001, -0.62], ['cy', -1.5, 1.5, 0.001, 0], ['zoom', 0.3, 200, 0.1, 1], ['iter', 10, 500, 1, 90], ['bands', 1, 24, 1, 6], ['cut', 0, 30, 1, 3], ['power', 2, 6, 1, 2]], levels: (p) => p.bands + 1,
    make(p) {
      const k = 1.45 / p.zoom;
      return (u, v) => {
        // The real axis runs down the rug, so the set is mirror-symmetric left to right.
        const cr = p.cx + v * k, ci = p.cy + u * k;
        let zr = 0, zi = 0, n = 0;
        for (; n < p.iter && zr * zr + zi * zi < 16; n++) {
          if (p.power === 2) { const t = zr * zr - zi * zi + cr; zi = 2 * zr * zi + ci; zr = t; }
          else { const r = Math.hypot(zr, zi) ** p.power, a = Math.atan2(zi, zr) * p.power; zr = r * Math.cos(a) + cr; zi = r * Math.sin(a) + ci; }
        }
        if (n >= p.iter) return 0;
        if (n < p.cut) return -1;
        return 1 + (n % p.bands);
      };
    },
  },
  julia: {
    cat: 'fractal', params: [['cr', -1.5, 1.5, 0.001, -0.745], ['ci', -1.5, 1.5, 0.001, 0.113], ['zoom', 0.3, 50, 0.1, 1.1], ['iter', 10, 400, 1, 110], ['bands', 1, 24, 1, 6], ['cut', 0, 30, 1, 4]], levels: (p) => p.bands + 1,
    make(p) {
      const k = 1.6 / p.zoom;
      return (u, v) => {
        let zr = v * k, zi = u * k, n = 0;
        for (; n < p.iter && zr * zr + zi * zi < 16; n++) { const t = zr * zr - zi * zi + p.cr; zi = 2 * zr * zi + p.ci; zr = t; }
        if (n >= p.iter) return 0;
        if (n < p.cut) return -1;
        return 1 + (n % p.bands);
      };
    },
  },
  // Newton's method on z^n - 1: each start point converges to one of the n roots of unity, the basin decides the
  // level; points needing many iterations lie near basin boundaries (the fractal part) and get the edge level.
  // Computed in polar form to avoid expanding (x + iy)^n.
  newton: {
    cat: 'fractal', params: [['degree', 3, 9, 1, 5], ['zoom', 0.3, 20, 0.1, 1], ['iter', 6, 60, 1, 30], ['edges', 0, 1, 1, 1]], levels: (p) => p.degree + 1,
    make(p) {
      const n = p.degree, k = 1.5 / p.zoom;
      const roots = Array.from({ length: n }, (_, i) => [Math.cos((TAU * i) / n), Math.sin((TAU * i) / n)]);
      return (u, v) => {
        let zr = u * k, zi = v * k, it = 0;
        for (; it < p.iter; it++) {
          // z - (z^n - 1) / (n z^(n-1))
          const r = Math.hypot(zr, zi), a = Math.atan2(zi, zr);
          if (r < 1e-9) break;
          const rn1 = r ** (n - 1), znr = rn1 * r * Math.cos(n * a) - 1, zni = rn1 * r * Math.sin(n * a);
          const dr = n * rn1 * Math.cos((n - 1) * a), di = n * rn1 * Math.sin((n - 1) * a), dd = dr * dr + di * di;
          const qr = (znr * dr + zni * di) / dd, qi = (zni * dr - znr * di) / dd;
          zr -= qr; zi -= qi;
          if (qr * qr + qi * qi < 1e-10) break;
        }
        let best = 0, bd = Infinity;
        roots.forEach(([rr, ri], i) => { const d = (zr - rr) ** 2 + (zi - ri) ** 2; if (d < bd) { bd = d; best = i; } });
        if (p.edges && it > p.iter * 0.35) return n;
        return best;
      };
    },
  },
  lsystem: {
    cat: 'fractal', params: [['preset', Object.keys(LSYS), 'tree'], ['iterations', 0, 9, 1, 0], ['width', 0.002, 0.06, 0.001, 0.014], ['cycles', 0, 8, 1, 0]], levels: () => 4,
    make(p) {
      const L = LSYS[p.preset] || LSYS.tree;
      const n = p.iterations || L.n;
      const paths = turtle(L.axiom, L.rules, n, L.angle);
      const flatPts = fit(paths.flat(), 0.94);
      const T = texture(768);
      let k = 0;
      for (const path of paths) { stroke(T, flatPts.slice(k, k + path.length), p.width * 2, cycleLevel(p.cycles, 4)); k += path.length; }
      return T.at;
    },
  },
  pythagoras: {
    cat: 'fractal', params: [['depth', 2, 13, 1, 9], ['angle', 15, 75, 1, 45]], levels: () => 6,
    make(p) {
      const sq = [];
      const a = (p.angle * Math.PI) / 180;
      const go = (x, y, dx, dy, d) => {
        // A square on the base (x, y)→(x+dx, y+dy), built to the left of the base.
        const nx = -dy, ny = dx;
        const P = [[x, y], [x + dx, y + dy], [x + dx + nx, y + dy + ny], [x + nx, y + ny]];
        sq.push([P, d]);
        if (d >= p.depth) return;
        const ca = Math.cos(a), sa = Math.sin(a), l = Math.cos(a);
        const lx = (dx * ca - dy * sa) * l, ly = (dx * sa + dy * ca) * l;
        go(P[3][0], P[3][1], lx, ly, d + 1);
        go(P[3][0] + lx, P[3][1] + ly, P[2][0] - P[3][0] - lx, P[2][1] - P[3][1] - ly, d + 1);
      };
      go(-0.5, 0, 1, 0, 0);
      const all = fit(sq.flatMap(([P]) => P).map(([x, y]) => [x, -y]), 0.95);
      const T = texture(640);
      sq.forEach(([P, d], i) => fillPoly(T, all.slice(i * 4, i * 4 + 4), d % 6));
      return T.at;
    },
  },

  // ---------- abstractions ----------
  // Truchet tiles: each grid cell randomly flips (hash of the cell and a per-layer seed, so it is stable under
  // re-evaluation) between two orientations of quarter arcs centred on opposite corners; arcs join across cells into
  // continuous meanders. The XOR parity colours the two sides of the arc network alternately.
  truchet: {
    cat: 'abstract', params: [['kind', ['arcs', 'diagonals', 'triangles', 'weave'], 'arcs'], ['scale', 0.03, 0.6, 0.01, 0.14], ['width', 0.05, 0.6, 0.01, 0.22]], levels: () => 3,
    make(p, env) {
      const seed = env.rng.u32();
      const flip = (i, j) => { let h = Math.imul(i * 374761393 + j * 668265263, 1274126177) ^ seed; h ^= h >>> 13; h = Math.imul(h, 1103515245); return (h >>> 16) & 1; };
      return (u, v) => {
        const x = u / p.scale, y = v / p.scale, i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
        const o = flip(i, j);
        const gx = o ? 1 - fx : fx;
        if (p.kind === 'arcs' || p.kind === 'weave') {
          const d1 = Math.hypot(gx, fy), d2 = Math.hypot(1 - gx, 1 - fy);
          const w = p.width / 2;
          if (Math.abs(d1 - 0.5) < w) return p.kind === 'weave' && ((i + j) & 1) && Math.abs(d2 - 0.5) < w + 0.06 ? 2 : 0;
          if (Math.abs(d2 - 0.5) < w) return 0;
          const inside = d1 < 0.5 || d2 < 0.5;
          return 1 + ((inside ? 1 : 0) ^ (((i + j + o) & 1)));
        }
        if (p.kind === 'diagonals') return Math.abs(gx - fy) < p.width / 1.5 ? 0 : 1 + ((gx > fy ? 1 : 0) ^ ((i + j) & 1));
        return gx > fy ? 1 : 2;
      };
    },
  },
  // Perfect maze by randomized depth-first search (recursive backtracker with an explicit stack): every cell is
  // reached exactly once, so there is exactly one path between any two cells. Walls are stored as 2 bits per cell
  // (right, down). The solution is found by BFS from the top-left to the bottom-right and traced back through prev.
  // q.shift() is O(n) per pop, acceptable for at most 80 x 80 cells.
  maze: {
    cat: 'abstract', params: [['cells', 3, 80, 1, 14], ['wall', 0.1, 0.7, 0.02, 0.32], ['solution', 0, 1, 1, 1]], levels: () => 3,
    make(p, env) {
      const r = env.rng.fork('maze');
      const N = p.cells, open = new Uint8Array(N * N); // bits: 1 right, 2 down
      const seen = new Uint8Array(N * N), stack = [0];
      seen[0] = 1;
      while (stack.length) {
        const c = stack[stack.length - 1], x = c % N, y = (c / N) | 0;
        const nb = [];
        if (x + 1 < N && !seen[c + 1]) nb.push([c + 1, c, 1]);
        if (x > 0 && !seen[c - 1]) nb.push([c - 1, c - 1, 1]);
        if (y + 1 < N && !seen[c + N]) nb.push([c + N, c, 2]);
        if (y > 0 && !seen[c - N]) nb.push([c - N, c - N, 2]);
        if (!nb.length) { stack.pop(); continue; }
        const [n, at, bit] = r.pick(nb);
        open[at] |= bit; seen[n] = 1; stack.push(n);
      }
      // The solution from the top-left to the bottom-right cell (breadth first).
      const path = new Uint8Array(N * N);
      if (p.solution) {
        const prev = new Int32Array(N * N).fill(-1), q = [0];
        prev[0] = 0;
        while (q.length) {
          const c = q.shift(), x = c % N;
          const go = (n, ok) => { if (ok && prev[n] < 0) { prev[n] = c; q.push(n); } };
          go(c + 1, x + 1 < N && open[c] & 1); go(c - 1, x > 0 && open[c - 1] & 1); go(c + N, c + N < N * N && open[c] & 2); go(c - N, c >= N && open[c - N] & 2);
        }
        for (let c = N * N - 1; c > 0; c = prev[c]) path[c] = 1;
        path[0] = 1;
      }
      const w = p.wall / 2;
      return (u, v) => {
        const x = ((u + 1) / 2) * N, y = ((v + 1) / 2) * N;
        if (x < -w || y < -w || x >= N + w || y >= N + w) return -1;
        const i = clamp(Math.floor(x), 0, N - 1), j = clamp(Math.floor(y), 0, N - 1), fx = x - i, fy = y - j, c = j * N + i;
        // Outer walls, inner walls by the open bits, posts at the corners.
        if (x < w || y < w || x > N - w || y > N - w) return (i === 0 && j === 0 && y < w) || (i === N - 1 && j === N - 1 && y > N - w) ? 1 : 0;
        if ((fx > 1 - w && !(open[c] & 1)) || (fx < w && i > 0 && !(open[c - 1] & 1))) return 0;
        if ((fy > 1 - w && !(open[c] & 2)) || (fy < w && j > 0 && !(open[c - N] & 2))) return 0;
        if ((fx < w || fx > 1 - w) && (fy < w || fy > 1 - w)) return 0;
        if (path[c] && Math.abs(fx - 0.5) < 0.22 && Math.abs(fy - 0.5) < 0.22) return 2;
        if (path[c]) {
          const right = i + 1 < N && path[c + 1] && open[c] & 1, left = i > 0 && path[c - 1] && open[c - 1] & 1;
          const down = j + 1 < N && path[c + N] && open[c] & 2, up = j > 0 && path[c - N] && open[c - N] & 2;
          if ((right && fx > 0.5 && Math.abs(fy - 0.5) < 0.22) || (left && fx < 0.5 && Math.abs(fy - 0.5) < 0.22) || (down && fy > 0.5 && Math.abs(fx - 0.5) < 0.22) || (up && fy < 0.5 && Math.abs(fx - 0.5) < 0.22)) return 2;
        }
        return 1;
      };
    },
  },
  // Elementary cellular automaton (Wolfram rule 0..255): the next state of a cell is bit (left<<2 | self<<1 | right)
  // of the rule number. Rows are precomputed with wrap-around edges; 'centre' mirrors the history vertically,
  // 'radial' maps time to radius.
  automaton: {
    cat: 'abstract', params: [['rule', 0, 255, 1, 90], ['cells', 16, 400, 1, 128], ['mode', ['top', 'centre', 'radial', 'random'], 'centre']], levels: () => 2,
    make(p, env) {
      const N = p.cells, rows = N;
      const grid = new Uint8Array(N * rows);
      let row = new Uint8Array(N);
      if (p.mode === 'random') { const r = env.rng.fork('ca'); for (let i = 0; i < N; i++) row[i] = r.chance(0.5) ? 1 : 0; }
      else row[N >> 1] = 1;
      for (let j = 0; j < rows; j++) {
        grid.set(row, j * N);
        const nx = new Uint8Array(N);
        for (let i = 0; i < N; i++) { const k = (row[(i - 1 + N) % N] << 2) | (row[i] << 1) | row[(i + 1) % N]; nx[i] = (p.rule >> k) & 1; }
        row = nx;
      }
      return (u, v) => {
        let x, y;
        if (p.mode === 'radial') {
          // Rows become rings, columns angles: the automaton grows outward from the centre.
          const r = Math.hypot(u, v);
          if (r > 1) return -1;
          y = Math.floor(r * rows);
          x = Math.floor(((Math.atan2(v, u) / TAU + 0.5) * N)) % N;
        } else {
          x = Math.floor(((u + 1) / 2) * N); y = Math.floor(((v + 1) / 2) * rows);
          if (p.mode === 'centre') y = Math.floor(Math.abs(v) * rows);
          if (x < 0 || y < 0 || x >= N || y >= rows) return -1;
        }
        return grid[y * N + x] ? 0 : 1;
      };
    },
  },
  // Conway's Life (B3/S23) on a torus for `steps` generations from a seeded random soup. `ever` remembers every cell
  // that was ever alive, drawn as a trail level: the final state alone is sparse and loses the structure's history.
  life: {
    cat: 'abstract', params: [['cells', 16, 200, 1, 64], ['steps', 0, 400, 1, 60], ['density', 0.05, 0.8, 0.01, 0.33], ['trail', 0, 1, 1, 1]], levels: () => 3,
    make(p, env) {
      const r = env.rng.fork('life'), N = p.cells;
      let g = new Uint8Array(N * N).map(() => (r.chance(p.density) ? 1 : 0));
      const ever = g.slice();
      for (let s = 0; s < p.steps; s++) {
        const n = new Uint8Array(N * N);
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
          let c = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) c += g[((y + dy + N) % N) * N + ((x + dx + N) % N)];
          const a = g[y * N + x];
          n[y * N + x] = c === 3 || (a && c === 2) ? 1 : 0;
        }
        g = n;
        for (let i = 0; i < g.length; i++) ever[i] |= g[i];
      }
      return (u, v) => {
        const x = Math.floor(mod((u + 1) / 2, 1) * N), y = Math.floor(mod((v + 1) / 2, 1) * N);
        const i = y * N + x;
        return g[i] ? 0 : p.trail && ever[i] ? 1 : 2;
      };
    },
  },
  // Voronoi cells by brute-force nearest site (O(points) per knot, fine for <= 300 sites). Borders where the
  // distances to the nearest and second-nearest sites are almost equal. Lloyd relaxation (move each site to the
  // centroid of its cell, measured on a coarse 60 x 60 grid) evens out cell sizes.
  voronoi: {
    cat: 'abstract', params: [['points', 2, 300, 1, 28], ['border', 0, 0.1, 0.002, 0.018], ['relax', 0, 4, 1, 1], ['spread', 0.5, 2.5, 0.05, 1.6]], levels: () => 6,
    make(p, env) {
      const r = env.rng.fork('voronoi');
      let pts = Array.from({ length: p.points }, () => [(r.next() * 2 - 1) * p.spread, (r.next() * 2 - 1) * p.spread]);
      // Lloyd relaxation on a coarse grid evens the cells out.
      for (let it = 0; it < p.relax; it++) {
        const acc = pts.map(() => [0, 0, 0]);
        const G = 60;
        for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
          const x = ((i + 0.5) / G * 2 - 1) * p.spread, y = ((j + 0.5) / G * 2 - 1) * p.spread;
          let b = 0, bd = Infinity;
          pts.forEach(([px, py], k) => { const d = (x - px) ** 2 + (y - py) ** 2; if (d < bd) { bd = d; b = k; } });
          acc[b][0] += x; acc[b][1] += y; acc[b][2]++;
        }
        pts = pts.map((q, k) => (acc[k][2] ? [acc[k][0] / acc[k][2], acc[k][1] / acc[k][2]] : q));
      }
      return (u, v) => {
        let b = 0, bd = Infinity, sd = Infinity;
        for (let k = 0; k < pts.length; k++) {
          const d = (u - pts[k][0]) ** 2 + (v - pts[k][1]) ** 2;
          if (d < bd) { sd = bd; bd = d; b = k; } else if (d < sd) sd = d;
        }
        if (p.border && Math.sqrt(sd) - Math.sqrt(bd) < p.border * 2) return 0;
        return 1 + (b % 5);
      };
    },
  },
  // Sum of plane waves in n evenly spaced directions over 180 degrees: odd n gives quasi-periodic (2n-fold) patterns
  // with no translational period, the look of Penrose-like ornaments.
  quasicrystal: {
    cat: 'abstract', params: [['waves', 3, 15, 1, 5], ['freq', 2, 60, 0.5, 14], ['bands', 2, 12, 1, 4], ['phase', 0, 6.28, 0.01, 0]], levels: (p) => p.bands,
    make(p) {
      const dirs = Array.from({ length: p.waves }, (_, k) => [Math.cos((Math.PI * k) / p.waves), Math.sin((Math.PI * k) / p.waves)]);
      return (u, v) => {
        let s = 0;
        for (const [a, b] of dirs) s += Math.cos(p.freq * (u * a + v * b) + p.phase);
        const t = (s / p.waves + 1) / 2;
        return Math.min(p.bands - 1, Math.floor(t * p.bands));
      };
    },
  },
  interference: {
    cat: 'abstract', params: [['sources', 1, 9, 1, 3], ['wavelength', 0.03, 0.6, 0.005, 0.14], ['radius', 0, 1.2, 0.01, 0.55], ['bands', 2, 8, 1, 3]], levels: (p) => p.bands,
    make(p) {
      const src = Array.from({ length: p.sources }, (_, k) => [p.radius * Math.cos((TAU * k) / p.sources - Math.PI / 2), p.radius * Math.sin((TAU * k) / p.sources - Math.PI / 2)]);
      return (u, v) => {
        let s = 0;
        for (const [x, y] of src) s += Math.sin((TAU * Math.hypot(u - x, v - y)) / p.wavelength);
        const t = (s / p.sources + 1) / 2;
        return Math.min(p.bands - 1, Math.floor(t * p.bands));
      };
    },
  },
  spiral: {
    cat: 'abstract', params: [['arms', 1, 16, 1, 3], ['twist', 0.2, 30, 0.1, 6], ['kind', ['archimedean', 'log'], 'archimedean'], ['fill', 0.1, 0.95, 0.01, 0.5], ['size', 0.2, 2.5, 0.05, 1]], levels: (p) => Math.max(2, p.arms),
    make(p) {
      return (u, v) => {
        const r = Math.hypot(u, v) / p.size;
        if (r > 1) return -1;
        const rr = p.kind === 'log' ? Math.log(r + 1e-3) / 2 : r;
        const q = ((Math.atan2(v, u) / TAU + rr * p.twist) * p.arms);
        return fract(q) < p.fill ? mod(Math.floor(q), Math.max(2, p.arms)) : -1;
      };
    },
  },
  noise: {
    cat: 'abstract', params: [['scale', 0.5, 24, 0.5, 4], ['octaves', 1, 5, 1, 3], ['bands', 2, 12, 1, 5], ['contours', 0, 1, 1, 0]], levels: (p) => p.bands + 1,
    make(p, env) {
      const n = valueNoise(env.rng.fork('noise'));
      return (u, v) => {
        let s = 0, a = 1, f = p.scale, t = 0;
        for (let o = 0; o < p.octaves; o++) { s += a * n(u * f + 17, v * f + 31); t += a; a /= 2; f *= 2; }
        const q = (s / t) * p.bands;
        if (p.contours && fract(q) < 0.12) return 0;
        return 1 + Math.min(p.bands - 1, Math.floor(q));
      };
    },
  },
  // Gray-Scott reaction-diffusion: two concentrations A, B; A + 2B -> 3B, A is fed at rate F, B removed at K. Explicit
  // Euler with the 5-point Laplacian, diffusion rates 0.2 / 0.1 (stable at dt = 1), double buffers swapped per step.
  // The (F, K) presets are well-known regimes. Steps are capped so that N^2 * steps <= 6e7 cell updates, bounding
  // the time one layer may take.
  reaction: {
    cat: 'abstract', params: [['preset', ['spots', 'stripes', 'maze', 'coral', 'mitosis'], 'maze'], ['grid', 40, 220, 1, 128], ['steps', 200, 6000, 100, 2600]], levels: () => 3,
    make(p, env) {
      const [F, K] = { spots: [0.035, 0.065], stripes: [0.022, 0.051], maze: [0.029, 0.057], coral: [0.0545, 0.062], mitosis: [0.0367, 0.0649] }[p.preset];
      const N = p.grid, r = env.rng.fork('rd');
      let A = new Float32Array(N * N).fill(1), B = new Float32Array(N * N);
      for (let s = 0; s < 12; s++) { const cx = r.int(N), cy = r.int(N); for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) B[mod(cy + y, N) * N + mod(cx + x, N)] = 1; }
      let A2 = new Float32Array(N * N), B2 = new Float32Array(N * N);
      const steps = Math.min(p.steps, Math.floor(6e7 / (N * N)));
      for (let s = 0; s < steps; s++) {
        for (let y = 0; y < N; y++) {
          const ym = ((y - 1 + N) % N) * N, y0 = y * N, yp = ((y + 1) % N) * N;
          for (let x = 0; x < N; x++) {
            const xm = (x - 1 + N) % N, xp = (x + 1) % N, i = y0 + x;
            const la = A[ym + x] + A[yp + x] + A[y0 + xm] + A[y0 + xp] - 4 * A[i];
            const lb = B[ym + x] + B[yp + x] + B[y0 + xm] + B[y0 + xp] - 4 * B[i];
            const abb = A[i] * B[i] * B[i];
            A2[i] = A[i] + (0.2 * la - abb + F * (1 - A[i]));
            B2[i] = B[i] + (0.1 * lb + abb - (K + F) * B[i]);
          }
        }
        [A, A2] = [A2, A]; [B, B2] = [B2, B];
      }
      return (u, v) => {
        const x = Math.floor(mod((u + 1) / 2, 1) * N), y = Math.floor(mod((v + 1) / 2, 1) * N);
        const b = B[y * N + x];
        return b > 0.28 ? 0 : b > 0.12 ? 1 : 2;
      };
    },
  },
  moire: {
    cat: 'abstract', params: [['rings', 4, 80, 1, 22], ['offset', 0, 0.9, 0.01, 0.28], ['shape', ['circle', 'diamond', 'square'], 'circle']], levels: () => 3,
    make(p) {
      const D = p.shape === 'diamond' ? (x, y) => Math.abs(x) + Math.abs(y) : p.shape === 'square' ? (x, y) => Math.max(Math.abs(x), Math.abs(y)) : Math.hypot;
      return (u, v) => {
        const a = fract(D(u - p.offset, v) * p.rings) < 0.5, b = fract(D(u + p.offset, v) * p.rings) < 0.5;
        return a && b ? 0 : a || b ? 1 : 2;
      };
    },
  },
};

export const PATTERN_IDS = Object.keys(PATTERNS);

export function defaultParams(type) {
  const T = PATTERNS[type];
  const o = {};
  for (const s of (T && T.params) || []) o[s[0]] = s.length === 3 ? s[2] : s[4];
  return o;
}

// Clamps raw parameters to the specs; motif parameters accept any id the caller knows (validated at make time).
// NOTE: PATTERNS[type] (here and in compose.js normLayer) is a plain-object lookup, so type 'constructor' passes
// the existence check; normLayer then keeps 'constructor' as the type and paintLayers fails calling .make. Same
// prototype-key class as the palette defect in dyes.js; fix with Object.hasOwn.
export function normParams(type, raw = {}) {
  const T = PATTERNS[type];
  const o = {};
  for (const s of (T && T.params) || []) {
    const [k] = s;
    const v = raw[k];
    if (s.length === 3) {
      if (s[1] === 'motifs') o[k] = typeof v === 'string' ? v.slice(0, 40) : s[2];
      else o[k] = s[1].includes(v) ? v : s[2];
    } else {
      const n = Number(v);
      o[k] = Number.isFinite(n) ? clamp(n, s[1], s[2]) : s[4];
      if (s[3] >= 1) o[k] = Math.round(o[k]);
    }
  }
  return o;
}
