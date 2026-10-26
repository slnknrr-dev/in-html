// stitch/symbols.js - chart symbols: a set of vector glyphs designed for small cells (filled shapes, outlines,
// bars, arrows, marks), drawn the same way on canvas, in SVG and in PDF (where they form a Type 3 font, so chart
// readers see text), and the "letters" alphabet (Latin letters, digits and punctuation that the standard PDF fonts
// have, then two-character codes). Assignment gives every palette entry a distinct symbol: frequent colours get the
// simplest glyphs and colours that look alike get glyphs of different families.
//
//   SYMBOLS        { id: { id, family, char, d } }   d: SVG path data in a 100 × 100 box (y down), filled
//                  with the non-zero rule (rings are a contour plus a reversed hole); char: a Unicode look-alike
//                  (text extraction, OXS)
//   SYMBOL_ORDER   vector symbol ids, most legible first
//   LETTERS        the letters alphabet (single characters, then pairs)
//   isVector(sym)  true for a vector symbol id, false for text (1-2 characters)
//   symbolChar(sym) a Unicode character for a symbol (the text itself for letters)
//   assignSymbols(palette, { mode: 'symbols' | 'letters', counts, keep, blankFirst, labs })
//                  -> symbol per entry (existing ones are kept when `keep` and still unique)
//   pathCommands(d) -> [[cmd, ...numbers]] (M, L, C, Z, absolute) for renderers

// Why vector paths and not font glyphs: system fonts differ per platform and many lack the shapes, and PDF output
// must embed what it draws. One path string per symbol serves canvas (Path2D), SVG (<path d>) and PDF (Type 3
// glyph via pathCommands), so the three outputs are identical. Paths use only absolute M / L / C / Z, so the tiny
// parser in pathCommands suffices on every target.
// Design criteria for small cells (2..3 mm printed): solid masses or strokes >= ~10 % of the box, no detail under
// that, and shapes from distinct families (circle, square, triangle, cross, line ...) so neighbours are told apart
// by silhouette, not by detail.
const K = 0.5523; // cubic Bézier circle constant

// Why non-zero and not even-odd: under even-odd, overlapping parts of one symbol (the two bars of 'plus', the petals
// of 'flower', the triangles of 'star6') would cancel into holes. Non-zero merges same-direction contours, and an
// explicitly reversed contour (hole = true) still cuts a hole. Canvas fill() and PDF f both default to non-zero.
// Shapes are filled with the non-zero rule: outer contours turn clockwise (on screen, y down), holes the other way,
// so overlapping bars merge and rings keep their holes.
const f = (n) => Math.round(n * 100) / 100;
function circle(cx, cy, r, hole = false) {
  const k = r * K;
  const P = (x, y) => f(cx + x) + ' ' + f(cy + y);
  // Quarter arcs right -> bottom -> left -> top -> right: [control 1, control 2, end].
  const segs = [[[r, k], [k, r], [0, r]], [[-k, r], [-r, k], [-r, 0]], [[-r, -k], [-k, -r], [0, -r]], [[k, -r], [r, -k], [r, 0]]];
  if (!hole) return 'M' + P(r, 0) + segs.map(([a, b, e]) => 'C' + P(...a) + ' ' + P(...b) + ' ' + P(...e)).join('') + 'Z';
  // Reversed: each arc backwards (controls swapped), arcs in reverse order.
  const starts = [[r, 0], [0, r], [-r, 0], [0, -r]];
  return 'M' + P(r, 0) + [3, 2, 1, 0].map((i) => 'C' + P(...segs[i][1]) + ' ' + P(...segs[i][0]) + ' ' + P(...starts[i])).join('') + 'Z';
}
// Shoelace sign gives the orientation; the polygon is reversed when it does not match the wanted one. Accepting
// either input orientation keeps the DEFS table free of winding bookkeeping.
function poly(pts, hole = false) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; a += x1 * y2 - x2 * y1; }
  const p = (a < 0) !== hole ? pts.slice().reverse() : pts;
  return 'M' + p.map(([x, y]) => f(x) + ' ' + f(y)).join('L') + 'Z';
}
const rect = (x, y, w, h) => poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
const ring = (cx, cy, r, t) => circle(cx, cy, r) + circle(cx, cy, r - t, true);
// A thick segment as a polygon.
// Offsets both ends along the unit normal by t / 2: a butt-capped stroke as a fill, because strokes cannot be part
// of a Type 3 glyph filled with f and would scale differently in each renderer. '|| 1' avoids NaN for a zero segment.
function bar(x1, y1, x2, y2, t) {
  const dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy) || 1;
  const nx = (-dy / l) * t / 2, ny = (dx / l) * t / 2;
  return poly([[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]]);
}
// Inset of a convex polygon (clockwise or counter-clockwise) by t: its outline as a ring.
// Each edge is moved inward by t, then consecutive moved edges are intersected (line-line intersection) to get the
// new vertices. Valid for convex polygons only (concave corners would self-intersect); all callers pass convex ones.
// den = 0 (parallel consecutive edges) cannot happen for a proper polygon; u = 0 is a safe fallback.
function inset(pts, t) {
  const n = pts.length;
  let area = 0;
  for (let i = 0; i < n; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n]; area += x1 * y2 - x2 * y1; }
  const s = area > 0 ? 1 : -1;
  const lines = pts.map(([x1, y1], i) => {
    const [x2, y2] = pts[(i + 1) % n];
    const dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy);
    const nx = (-dy / l) * s * t, ny = (dx / l) * s * t; // inward normal (y down)
    return [x1 + nx, y1 + ny, dx, dy];
  });
  const out = [];
  for (let i = 0; i < n; i++) {
    const [ax, ay, adx, ady] = lines[(i + n - 1) % n], [bx, by, bdx, bdy] = lines[i];
    const den = adx * bdy - ady * bdx;
    const u = den ? ((bx - ax) * bdy - (by - ay) * bdx) / den : 0;
    out.push([ax + adx * u, ay + ady * u]);
  }
  return out;
}
const outline = (pts, t = 11) => poly(pts) + poly(inset(pts, t), true);
const regular = (n, cx, cy, r, rot = -90) => Array.from({ length: n }, (_, i) => { const a = (rot + (360 * i) / n) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
function star(n, cx, cy, r1, r2, rot = -90) {
  const pts = [];
  for (let i = 0; i < 2 * n; i++) { const a = (rot + (180 * i) / n) * Math.PI / 180, r = i % 2 ? r2 : r1; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return poly(pts);
}
const T = 12; // stroke thickness of bars

const TRI_UP = [[50, 12], [90, 84], [10, 84]];
const TRI_DN = [[10, 16], [90, 16], [50, 88]];
const TRI_L = [[14, 50], [86, 10], [86, 90]];
const TRI_R = [[14, 10], [86, 50], [14, 90]];
const DIAM = [[50, 8], [92, 50], [50, 92], [8, 50]];
const SQ = [[14, 14], [86, 14], [86, 86], [14, 86]];
const HEX = regular(6, 50, 50, 42, 0);
const OCT = regular(8, 50, 50, 42, 22.5);
const PENT = regular(5, 50, 54, 42);

// [id, family, unicode look-alike, d]
// Order = assignment priority: the first symbols are the most legible and go to the most used colours. The family
// is the silhouette class used to keep look-alike colours apart; a trailing digit (circle2, square3 ...) marks a
// variant, and famOf strips it, so 'ring' and 'bullseye' count as the same family.
const DEFS = [
  ['disc', 'circle', '●', circle(50, 50, 36)],
  ['square', 'square', '■', rect(16, 16, 68, 68)],
  ['tri-up', 'triangle', '▲', poly(TRI_UP)],
  ['diamond', 'diamond', '◆', poly(DIAM)],
  ['plus', 'cross', '+', bar(50, 10, 50, 90, 16) + bar(10, 50, 90, 50, 16)],
  ['ex', 'cross', '×', bar(16, 16, 84, 84, 15) + bar(16, 84, 44, 56, 15) + bar(56, 44, 84, 16, 15)],
  ['star', 'star', '★', star(5, 50, 54, 46, 19)],
  ['heart', 'heart', '♥', 'M50 88C30 72 8 58 8 36C8 20 20 10 32 10C41 10 47 15 50 22C53 15 59 10 68 10C80 10 92 20 92 36C92 58 70 72 50 88Z'],
  ['ring', 'circle', '○', ring(50, 50, 38, 12)],
  ['square-o', 'square', '□', outline(SQ, 12)],
  ['tri-up-o', 'triangle', '△', outline(TRI_UP, 10)],
  ['diamond-o', 'diamond', '◇', outline(DIAM, 11)],
  ['tri-down', 'triangle-d', '▼', poly(TRI_DN)],
  ['bar-v', 'line', '|', rect(42, 8, 16, 84)],
  ['bar-h', 'line-h', '—', rect(8, 42, 84, 16)],
  ['slash', 'diag', '/', bar(18, 86, 82, 14, 15)],
  ['backslash', 'diag2', '\\', bar(18, 14, 82, 86, 15)],
  ['dot', 'dot', '•', circle(50, 50, 16)],
  ['bullseye', 'circle2', '◉', ring(50, 50, 40, 10) + circle(50, 50, 14)],
  ['tri-down-o', 'triangle-d', '▽', outline(TRI_DN, 10)],
  ['half-left', 'square2', '◧', outline(SQ, 10) + rect(24, 24, 26, 52)],
  ['half-top', 'square3', '⬒', outline(SQ, 10) + rect(24, 24, 52, 26)],
  ['moon', 'moon', '☾', 'M60 8C38 12 22 30 22 50C22 70 38 88 60 92C46 82 38 66 38 50C38 34 46 18 60 8Z'],
  ['hexagon', 'hex', '⬢', poly(HEX)],
  ['arrow-up', 'arrow', '↑', poly([[50, 6], [88, 46], [64, 46], [64, 94], [36, 94], [36, 46], [12, 46]])],
  ['arrow-right', 'arrow-r', '→', poly([[94, 50], [54, 88], [54, 64], [6, 64], [6, 36], [54, 36], [54, 12]])],
  ['circle-plus', 'circle3', '⊕', ring(50, 50, 42, 9) + rect(45, 14, 10, 72) + rect(14, 45, 31, 10) + rect(55, 45, 31, 10)],
  ['square-dot', 'square4', '▣', outline(SQ, 10) + rect(37, 37, 26, 26)],
  ['tri-left', 'triangle-l', '◀', poly(TRI_L)],
  ['tri-right', 'triangle-r', '▶', poly(TRI_R)],
  ['hash', 'hash', '#', rect(28, 8, 12, 84) + rect(60, 8, 12, 84) + rect(8, 28, 20, 12) + rect(40, 28, 20, 12) + rect(72, 28, 20, 12) + rect(8, 60, 20, 12) + rect(40, 60, 20, 12) + rect(72, 60, 20, 12)],
  ['equals', 'line-h2', '=', rect(10, 26, 80, 14) + rect(10, 60, 80, 14)],
  ['bars-v', 'line2', '‖', rect(24, 8, 14, 84) + rect(62, 8, 14, 84)],
  ['asterisk', 'star2', '*', rect(44, 8, 12, 84) + bar(14, 30, 86, 70, 12) + bar(14, 70, 86, 30, 12)],
  ['star4', 'star3', '✦', star(4, 50, 50, 46, 14)],
  ['hexagon-o', 'hex', '⬡', outline(HEX, 11)],
  ['corner-tl', 'corner', '◤', poly([[12, 12], [88, 12], [12, 88]])],
  ['corner-br', 'corner2', '◢', poly([[88, 12], [88, 88], [12, 88]])],
  ['checker', 'checker', '▚', rect(12, 12, 38, 38) + rect(50, 50, 38, 38)],
  ['dots3', 'dots', '∴', circle(50, 22, 13) + circle(24, 72, 13) + circle(76, 72, 13)],
  ['dots4', 'dots2', '∷', circle(28, 28, 12) + circle(72, 28, 12) + circle(28, 72, 12) + circle(72, 72, 12)],
  ['circle-x', 'circle4', '⊗', ring(50, 50, 42, 9) + bar(27, 27, 73, 73, 10) + bar(27, 73, 45, 55, 10) + bar(55, 45, 73, 27, 10)],
  ['square-plus', 'square5', '⊞', outline(SQ, 9) + rect(45, 23, 10, 54) + rect(23, 45, 22, 10) + rect(55, 45, 22, 10)],
  ['half-disc-up', 'circle5', '◓', 'M14 54C14 32 30 14 50 14C70 14 86 32 86 54Z'],
  ['half-disc-down', 'circle6', '◒', 'M14 46C14 68 30 86 50 86C70 86 86 68 86 46Z'],
  ['octagon', 'oct', '⯃', poly(OCT)],
  ['pentagon', 'pent', '⬟', poly(PENT)],
  ['arrow-down', 'arrow', '↓', poly([[50, 94], [88, 54], [64, 54], [64, 6], [36, 6], [36, 54], [12, 54]])],
  ['arrow-left', 'arrow-r', '←', poly([[6, 50], [46, 88], [46, 64], [94, 64], [94, 36], [46, 36], [46, 12]])],
  ['chevron-up', 'chevron', '^', poly([[50, 14], [90, 62], [74, 78], [50, 48], [26, 78], [10, 62]])],
  ['chevron-down', 'chevron2', 'v', poly([[50, 86], [90, 38], [74, 22], [50, 52], [26, 22], [10, 38]])],
  ['chevron-left', 'chevron3', '<', poly([[14, 50], [62, 10], [78, 26], [48, 50], [78, 74], [62, 90]])],
  ['chevron-right', 'chevron4', '>', poly([[86, 50], [38, 10], [22, 26], [52, 50], [22, 74], [38, 90]])],
  ['bowtie', 'bowtie', '⋈', poly([[10, 14], [50, 50], [10, 86]]) + poly([[90, 14], [50, 50], [90, 86]])],
  ['hourglass', 'bowtie2', '⧗', poly([[14, 10], [86, 10], [50, 50]]) + poly([[14, 90], [86, 90], [50, 50]])],
  ['diamond-dot', 'diamond2', '◈', outline(DIAM, 10) + circle(50, 50, 12)],
  ['tri-dot', 'triangle2', '◬', outline(TRI_UP, 9) + circle(50, 62, 9)],
  ['frame', 'square6', '▢', outline([[8, 8], [92, 8], [92, 92], [8, 92]], 8)],
  ['star6', 'star4', '✶', poly(regular(3, 50, 50, 44)) + poly(regular(3, 50, 50, 44, 90)) + poly(regular(6, 50, 50, 25.4, 0))],
  ['flower', 'flower', '✿', circle(50, 26, 17) + circle(74, 50, 17) + circle(50, 74, 17) + circle(26, 50, 17)],
  ['bracket-tl', 'bracket', '┌', rect(14, 14, 72, 14) + rect(14, 28, 14, 58)],
  ['bracket-br', 'bracket2', '┘', rect(14, 72, 72, 14) + rect(72, 14, 14, 58)],
  ['tee', 'tee', '┬', rect(10, 14, 80, 16) + rect(42, 30, 16, 58)],
  ['tee-up', 'tee2', '┴', rect(10, 70, 80, 16) + rect(42, 12, 16, 58)],
  ['half-right', 'square7', '◨', outline(SQ, 10) + rect(50, 24, 26, 52)],
  ['half-bottom', 'square8', '⬓', outline(SQ, 10) + rect(24, 50, 52, 26)],
  ['disc-left', 'circle7', '◐', ring(50, 50, 40, 10) + 'M50 18C32 18 18 32 18 50C18 68 32 82 50 82Z'],
  ['disc-right', 'circle8', '◑', ring(50, 50, 40, 10) + 'M50 18C68 18 82 32 82 50C82 68 68 82 50 82Z'],
  ['circle-bar', 'circle9', '⦶', ring(50, 50, 40, 10) + rect(20, 44, 60, 12)],
  ['circle-vbar', 'circle10', '⦷', ring(50, 50, 40, 10) + rect(44, 20, 12, 60)],
  ['tri-left-o', 'triangle-l', '◁', outline(TRI_L, 10)],
  ['tri-right-o', 'triangle-r', '▷', outline(TRI_R, 10)],
  ['octagon-o', 'oct', '⯄', outline(OCT, 11)],
  ['pentagon-o', 'pent', '⬠', outline(PENT, 11)],
  ['slash2', 'diag3', '⫽', bar(8, 80, 52, 14, 12) + bar(48, 86, 92, 20, 12)],
  ['bars-h3', 'line-h3', '≡', rect(10, 14, 80, 13) + rect(10, 44, 80, 13) + rect(10, 74, 80, 13)],
  ['lambda', 'lambda', 'Λ', bar(50, 10, 14, 90, 14) + bar(50, 10, 86, 90, 14)],
  ['vee', 'lambda2', 'V', bar(50, 90, 14, 10, 14) + bar(50, 90, 86, 10, 14)],
  ['zigzag', 'zigzag', 'ʒ', poly([[10, 22], [82, 22], [36, 72], [90, 72], [90, 86], [18, 86], [64, 36], [10, 36]])],
  ['key', 'key', '⚷', ring(32, 50, 22, 9) + rect(52, 44, 40, 12) + rect(74, 56, 10, 16)],
  ['drop', 'drop', '⬮', 'M50 8C62 30 80 46 80 64C80 80 66 92 50 92C34 92 20 80 20 64C20 46 38 30 50 8Z'],
  ['cross-small', 'cross2', '✚', bar(50, 24, 50, 76, 14) + bar(24, 50, 43, 50, 14) + bar(57, 50, 76, 50, 14)],
  ['dot-square', 'dot2', '▪', rect(34, 34, 32, 32)],
  ['dot-diamond', 'dot3', '⬩', poly([[50, 28], [72, 50], [50, 72], [28, 50]])],
  ['ring-small', 'dot4', '◦', ring(50, 50, 20, 8)],
  ['square-x', 'square9', '⊠', outline(SQ, 9) + bar(27, 27, 73, 73, 9) + bar(27, 73, 45, 55, 9) + bar(55, 45, 73, 27, 9)],
  ['tri-half', 'triangle3', '◭', outline(TRI_UP, 9) + poly([[50, 30], [50, 75], [24, 75]])],
  ['diamond-half', 'diamond3', '⬖', outline(DIAM, 9) + poly([[50, 24], [50, 76], [24, 50]])],
  ['squares-2', 'checker2', '▞', rect(50, 12, 38, 38) + rect(12, 50, 38, 38)],
  ['corner-tr', 'corner3', '◥', poly([[12, 12], [88, 12], [88, 88]])],
  ['corner-bl', 'corner4', '◣', poly([[12, 12], [88, 88], [12, 88]])],
];

export const SYMBOLS = {};
for (const [id, family, char, d] of DEFS) SYMBOLS[id] = { id, family, char, d };
export const SYMBOL_ORDER = DEFS.map((x) => x[0]);

// Letters: characters every PDF standard font has (WinAnsi), without look-alikes (0/O, 1/l/I, c/C …).
// Two-character codes start with a capital or digit and end with a lowercase letter, so a pair never reads as two
// single symbols side by side, and none of the confusable characters (0 O 1 l I c C o i j p v x z) appear.
const SINGLE = '= | ? # $ @ % & + / < > ^ ~ * ! : A B D E F G H J K L M N P Q R S T U V W X Y Z 2 3 4 5 6 7 8 9 a b d e f g h k m n q r s t u w y'.split(' ');
const PAIR_FIRST = '2345678ABDEFGHKMNPRSTUWXYZ'.split('');
const PAIR_SECOND = 'abdefghkmnqrstwy'.split('');
export const LETTERS = [...SINGLE, ...PAIR_FIRST.flatMap((a) => PAIR_SECOND.map((b) => a + b))];

export const isVector = (sym) => !!(sym && SYMBOLS[sym]);
export const symbolChar = (sym) => (SYMBOLS[sym] ? SYMBOLS[sym].char : String(sym || ''));

// Parsed path commands (absolute M / L / C / Z) for renderers without SVG path parsers (PDF, raster).
// Cache keyed by the path string: the renderer asks for the same few dozen paths for every cell on every frame.
// Unbounded, but the key set is the fixed symbol table.
const CACHE = new Map();
export function pathCommands(d) {
  if (CACHE.has(d)) return CACHE.get(d);
  const out = [];
  const re = /([MLCZ])([^MLCZ]*)/g;
  let m;
  while ((m = re.exec(d))) out.push([m[1], ...m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number)]);
  CACHE.set(d, out);
  return out;
}

// Symbols for a palette. counts[i]: stitches of entry i (frequent ones get the first symbols); labs[i]: the CIELAB
// colour (entries closer than about 12 ΔE do not share a symbol family when possible); keep: keep valid existing
// symbols; blankFirst: the most frequent entry gets no symbol (a background colour), like printed charts do.
// Greedy in frequency order: each entry takes the first free symbol whose family no similar colour (ΔE76 < 12,
// Euclidean in Lab: cheap and adequate as a "looks alike" threshold) already uses; if none, the first free symbol.
// Greedy is not optimal but deterministic and stable: adding one colour does not reshuffle the others' symbols,
// which matters when a stitcher has already started from a printed chart.
// Overflow (more colours than symbols) falls back to '#1', '#2' ... text codes rather than reusing a symbol:
// a duplicate symbol on a chart is a silent stitching error.
export function assignSymbols(palette, { mode = 'symbols', counts = null, keep = false, blankFirst = false, labs = null } = {}) {
  const n = palette.length;
  const order = palette.map((_, i) => i);
  if (counts) order.sort((a, b) => (counts[b] || 0) - (counts[a] || 0) || a - b);
  const pool = mode === 'letters' ? LETTERS : SYMBOL_ORDER;
  const out = new Array(n).fill('');
  const used = new Set();
  const valid = (s) => s && (mode === 'letters' ? !isVector(s) && s.length <= 2 : isVector(s));
  if (keep) {
    for (const i of order) {
      const s = palette[i].symbol;
      if (valid(s) && !used.has(s)) { out[i] = s; used.add(s); }
    }
  }
  const dist = (a, b) => (labs ? Math.hypot(labs[a][0] - labs[b][0], labs[a][1] - labs[b][1], labs[a][2] - labs[b][2]) : 99);
  const famOf = (s) => (SYMBOLS[s] ? SYMBOLS[s].family.replace(/\d+$/, '') : s.charAt(0));
  let first = true;
  for (const i of order) {
    if (out[i]) { first = false; continue; }
    if (blankFirst && first) { first = false; out[i] = ''; continue; }
    first = false;
    // Families used by similar colours that already have symbols.
    const near = new Set();
    for (let j = 0; j < n; j++) if (j !== i && out[j] && dist(i, j) < 12) near.add(famOf(out[j]));
    let pick = pool.find((s) => !used.has(s) && !near.has(famOf(s)));
    if (!pick) pick = pool.find((s) => !used.has(s));
    if (!pick) { let k = 1; while (used.has('#' + k)) k++; pick = '#' + k; } // more colours than symbols
    out[i] = pick;
    used.add(pick);
  }
  return out;
}
