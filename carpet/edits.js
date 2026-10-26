// carpet/edits.js - hand edits of knots over a generated rug: a layer of palette indices (255 = not edited) the size
// of the knot grid, painted with brushes, lines, rectangles, flood fills and motif stamps, every stroke repeated by
// a symmetry of the whole rug; a compact text form (run lengths, base64url) travels in share codes and projects.
//
//   NONE = 255
//   createEdits(w, h) -> { w, h, data: Uint8Array }
//   encodeEdits(e) -> text ('' when nothing is edited)      decodeEdits(text, w, h) -> edits | null
//   applyEdits(rug, e) -> the rug with the edited knots (cells replaced in a copy)
//   countEdits(e) -> number
//   symPoints(sym, x, y, w, h) -> [[x, y]]                    sym: none, mirrorX, mirrorY, mirrorXY, rot2, rot4
//   paintBrush(e, x, y, radius, value, sym) / paintLine(e, x0, y0, x1, y1, radius, value, sym)
//   paintRect(e, x0, y0, x1, y1, value, sym, filled) / floodFill(e, rug, x, y, value, sym)
//   stampMotif(e, motif, x, y, scale, roleIndex(char) -> value | null, sym)
//   snapshot(e) / restore(e, snap)  for undo

import { orbit } from './symmetry.js';

// Edits are an overlay, not a modification of the generated cells: the rug stays reproducible from its share code,
// and the overlay re-applies on top after any regeneration of the same size. 255 as "not edited" leaves 0..254 for
// palette indices (palettes have 10 roles), and a Uint8Array keeps a 1.5 M knot overlay at 1.5 MB.
export const NONE = 255;

export function createEdits(w, h) { return { w, h, data: new Uint8Array(w * h).fill(NONE) }; }
export const countEdits = (e) => { let n = 0; for (const v of e.data) if (v !== NONE) n++; return n; };

// Own base64url codec on bytes (no btoa/atob: binary strings, padding and the +/ alphabet would need conversions
// anyway). Output omits padding; the decoder infers the tail length from the string length.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '') + (i + 2 < bytes.length ? B64[n & 63] : '');
  }
  return s;
}
function fromB64(s) {
  const out = [];
  for (let i = 0; i < s.length; i += 4) {
    const c = [0, 1, 2, 3].map((k) => (i + k < s.length ? B64.indexOf(s[i + k]) : 0));
    if (c.some((x) => x < 0)) return null;
    const n = (c[0] << 18) | (c[1] << 12) | (c[2] << 6) | c[3];
    out.push((n >> 16) & 255);
    if (i + 2 < s.length) out.push((n >> 8) & 255);
    if (i + 3 < s.length) out.push(n & 255);
  }
  return Uint8Array.from(out);
}
// Runs of (value, length) with lengths as unsigned varints.
// Run-length encoding fits the data: edit overlays are mostly long runs of NONE with compact painted areas. Each run
// is (value byte, length as LEB128 varint: 7 bits per byte, high bit = more), so short runs cost 2 bytes and a
// million-knot run costs 4.
export function encodeEdits(e) {
  if (!e || !countEdits(e)) return '';
  const bytes = [];
  for (let i = 0; i < e.data.length;) {
    const v = e.data[i];
    let n = 1;
    while (i + n < e.data.length && e.data[i + n] === v) n++;
    bytes.push(v);
    let m = n;
    do { bytes.push((m & 127) | (m > 127 ? 128 : 0)); m >>>= 7; } while (m);
    i += n;
  }
  return toB64(Uint8Array.from(bytes));
}
// Strict: the decoded runs must cover exactly w * h knots (a code for another grid size is rejected rather than
// smeared over the wrong grid); a truncated varint or an overflow returns null. Values are not range-checked here;
// applyEdits ignores indices outside the palette.
export function decodeEdits(text, w, h) {
  if (!text) return null;
  const b = fromB64(String(text));
  if (!b) return null;
  const e = createEdits(w, h);
  let p = 0;
  for (let i = 0; i < b.length;) {
    const v = b[i++];
    let n = 0, s = 0;
    for (;;) { const c = b[i++]; if (c === undefined) return null; n |= (c & 127) << s; s += 7; if (!(c & 128)) break; }
    if (p + n > e.data.length) return null;
    e.data.fill(v, p, p + n);
    p += n;
  }
  return p === e.data.length ? e : null;
}

export function applyEdits(rug, e) {
  if (!e || e.w !== rug.width || e.h !== rug.height) return rug;
  const cells = rug.cells.slice();
  for (let i = 0; i < cells.length; i++) if (e.data[i] !== NONE && e.data[i] < rug.palette.length) cells[i] = e.data[i];
  return { ...rug, cells };
}

// Every stroke is replicated over the orbit of the rug-level symmetry, so hand edits keep a symmetric design
// symmetric. rot4 on a non-square grid degrades to mirrorXY (the same rule as symmetry.js orbit).
export const symPoints = (sym, x, y, w, h) => orbit(sym === 'rot4' && w !== h ? 'mirrorXY' : sym, x, y, w, h);
const put = (e, x, y, v, sym) => {
  for (const [a, b] of symPoints(sym, x, y, e.w, e.h)) if (a >= 0 && b >= 0 && a < e.w && b < e.h) e.data[b * e.w + a] = v;
};

// Disc test with +0.25: radius 0 still paints the centre knot and radius 1 gives a plus shape rather than a single
// knot; integer knot grids need that slack for round-looking small brushes.
export function paintBrush(e, x, y, radius, value, sym = 'none') {
  const r = Math.max(0, radius);
  for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) if (dx * dx + dy * dy <= r * r + 0.25) put(e, x + dx, y + dy, value, sym);
}
// DDA: one brush stamp per step of the major axis, so consecutive stamps always touch (no gaps at any slope).
export function paintLine(e, x0, y0, x1, y1, radius, value, sym = 'none') {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let k = 0; k <= n; k++) paintBrush(e, Math.round(x0 + ((x1 - x0) * k) / n), Math.round(y0 + ((y1 - y0) * k) / n), radius, value, sym);
}
export function paintRect(e, x0, y0, x1, y1, value, sym = 'none', filled = true) {
  const [a, b] = [Math.min(x0, x1), Math.max(x0, x1)], [c, d] = [Math.min(y0, y1), Math.max(y0, y1)];
  for (let y = c; y <= d; y++) for (let x = a; x <= b; x++) if (filled || x === a || x === b || y === c || y === d) put(e, x, y, value, sym);
}
// Fills the region of equal colour (as seen with the edits) around a knot.
// Iterative 4-connected fill with an explicit stack: recursion would overflow the JS stack on large regions. The
// colour seen is the edited colour where edited, else the generated one. `seen` prevents revisiting; the
// target === value check prevents an endless fill when the region already has the colour.
export function floodFill(e, rug, x, y, value, sym = 'none') {
  const W = rug.width, H = rug.height;
  const at = (i) => (e.data[i] !== NONE ? e.data[i] : rug.cells[i]);
  for (const [sx, sy] of symPoints(sym, x, y, W, H)) {
    if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
    const target = at(sy * W + sx);
    if (target === value) continue;
    const stack = [sy * W + sx];
    const seen = new Uint8Array(W * H);
    while (stack.length) {
      const i = stack.pop();
      if (seen[i] || at(i) !== target) continue;
      seen[i] = 1;
      e.data[i] = value;
      const cx = i % W, cy = (i / W) | 0;
      if (cx > 0) stack.push(i - 1);
      if (cx + 1 < W) stack.push(i + 1);
      if (cy > 0) stack.push(i - W);
      if (cy + 1 < H) stack.push(i + W);
    }
  }
}
// A motif centred on (x, y), each motif cell `scale` knots; roleIndex maps a motif character to a palette index.
export function stampMotif(e, motif, x, y, scale, roleIndex, sym = 'none') {
  const h = motif.rows.length, w = Math.max(...motif.rows.map((r) => r.length));
  const s = Math.max(1, Math.round(scale));
  const x0 = x - Math.floor((w * s) / 2), y0 = y - Math.floor((h * s) / 2);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const c = motif.rows[j][i];
    if (!c || c === '.') continue;
    const v = roleIndex(c);
    if (v == null) continue;
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) put(e, x0 + i * s + dx, y0 + j * s + dy, v, sym);
  }
}

// Undo snapshots copy the whole overlay (1 byte per knot): simple and fast enough at these sizes compared with
// recording per-stroke diffs.
export const snapshot = (e) => e.data.slice();
export function restore(e, snap) { e.data.set(snap); return e; }
