// garment/dxf.js - pattern pieces as DXF in the AAMA / ASTM D6673 style that cutting-room CAD systems exchange: an ASCII
// DXF R12 file, one BLOCK per piece holding its layers (1 cutting line, 14 sewing line, 7 grain line, 4 notches, 8
// internal lines, 13 drill holes) and TEXT attributes (Piece Name, Quantity, Size, Category), INSERTs placing the
// blocks, and the header texts (Style Name, Units: METRIC, Creation Date). Coordinates in centimetres, y up.
//
//   patternDXF(draft, { size, style, date }) -> string
//   parseDXF(text) -> [{ code, value }] (group pairs, for checks)
//   readPatternDXF(text, { units }) -> { pieces, units } (pieces of an AAMA file or the closed polylines of a drawing)

import { cutOutline, outline } from './piece.js';
import { seamNotches } from './seams.js';
import { layoutRows } from './svg.js';
import { latin } from './pdf.js';

//
// Why DXF R12 (AC1009): it is the lowest common denominator every cutting-room CAD reads, and the AAMA convention
// (fixed layer numbers per line type, per-piece BLOCKs with TEXT attributes) is defined on it. y is negated because
// DXF is y-up while drafts are y-down. Text passes through latin() since R12 has no reliable Unicode support.
// Coordinates are written with 4 decimals (0.1 micrometre in cm): far below any cutter's precision, stable diffs.
const n = (v) => (Math.round(v * 10000) / 10000).toFixed(4);
const pair = (code, value) => `${code}\n${value}\n`;

function polyline(pts, layer, closed) {
  let s = pair(0, 'POLYLINE') + pair(8, layer) + pair(66, 1) + pair(70, closed ? 1 : 0);
  for (const [x, y] of pts) s += pair(0, 'VERTEX') + pair(8, layer) + pair(10, n(x)) + pair(20, n(-y)) + pair(30, n(0));
  return s + pair(0, 'SEQEND') + pair(8, layer);
}
const line = (a, b, layer) => pair(0, 'LINE') + pair(8, layer) + pair(10, n(a[0])) + pair(20, n(-a[1])) + pair(30, n(0)) + pair(11, n(b[0])) + pair(21, n(-b[1])) + pair(31, n(0));
const text = (p, h, str, layer = 1) => pair(0, 'TEXT') + pair(8, layer) + pair(10, n(p[0])) + pair(20, n(-p[1])) + pair(30, n(0)) + pair(40, n(h)) + pair(1, latin(str));
const point = (p, layer) => pair(0, 'POINT') + pair(8, layer) + pair(10, n(p[0])) + pair(20, n(-p[1])) + pair(30, n(0));

// Block names are sanitised to [\w-] (DXF names may not contain spaces or most punctuation). Pieces are INSERTed at
// the shelf layout offsets so the file opens as a readable sheet, while each block stays in piece coordinates.
export function patternDXF(d, o = {}) {
  const size = o.size || 'MTM';
  const notches = seamNotches(d);
  let blocks = '';
  let inserts = '';
  const lay = layoutRows(d.pieces, { width: o.width || 160, gap: 4 });
  for (const it of lay) {
    const p = it.piece;
    const name = `${p.id}`.replace(/[^\w-]/g, '_');
    let b = pair(0, 'BLOCK') + pair(8, 0) + pair(2, name) + pair(70, 0) + pair(10, n(0)) + pair(20, n(0)) + pair(30, n(0));
    b += polyline(cutOutline(p), 1, true);
    b += polyline(outline(p), 14, true);
    if (p.grain) b += line(p.grain[0], p.grain[1], 7);
    for (const nt of notches.filter((x) => x.piece === p.id)) b += line(nt.p, [nt.p[0] + nt.dir[1] * 0.6, nt.p[1] - nt.dir[0] * 0.6], 4);
    for (const e of p.edges) if (e.kind === 'dart') b += polyline(e.pts, 8, false);
    for (const m of p.marks) {
      if (m.type === 'line') b += polyline(m.pts, 8, false);
      else if (m.type === 'button' || m.type === 'drill') b += point(m.p, 13);
      else if (m.type === 'buttonhole') b += line([m.p[0] - m.w, m.p[1]], m.p, 8);
    }
    const c = p.grain ? p.grain[0] : outline(p)[0];
    const lines = [`Piece Name: ${p.name}`, `Quantity: ${p.cut.n}`, `Size: ${size}`, `Category: ${p.material}`, `Annotation: ${p.cut.fold ? 'on fold' : p.cut.mirror ? 'mirrored pair' : ''}`];
    lines.forEach((t, i) => { b += text([c[0] + 1, c[1] + 2 + i * 1.6], 1, t, 1); });
    b += pair(0, 'ENDBLK') + pair(8, 0);
    blocks += b;
    inserts += pair(0, 'INSERT') + pair(8, 1) + pair(2, name) + pair(10, n(it.dx)) + pair(20, n(-it.dy)) + pair(30, n(0));
  }
  const date = o.date || new Date().toISOString().slice(0, 10);
  const header = pair(0, 'SECTION') + pair(2, 'HEADER') + pair(9, '$ACADVER') + pair(1, 'AC1009') + pair(9, '$MEASUREMENT') + pair(70, 1) + pair(0, 'ENDSEC');
  const tables = pair(0, 'SECTION') + pair(2, 'TABLES') + pair(0, 'TABLE') + pair(2, 'LAYER') + pair(70, 7)
    + [1, 4, 7, 8, 13, 14, 15].map((l) => pair(0, 'LAYER') + pair(2, l) + pair(70, 0) + pair(62, 7) + pair(6, 'CONTINUOUS')).join('')
    + pair(0, 'ENDTAB') + pair(0, 'ENDSEC');
  const style = [`Style Name: ${o.style || d.garment}`, 'Units: METRIC', `Sample Size: ${size}`, `Creation Date: ${date}`, 'Author: in-html textile studio'];
  const entities = pair(0, 'SECTION') + pair(2, 'ENTITIES') + style.map((t, i) => text([0, -6 - i * 1.8], 1.2, t, 1)).join('') + inserts + pair(0, 'ENDSEC');
  return header + tables + pair(0, 'SECTION') + pair(2, 'BLOCKS') + blocks + pair(0, 'ENDSEC') + entities + pair(0, 'EOF');
}

// DXF is a flat sequence of (group code line, value line) pairs; everything else is interpretation on top of it.
export function parseDXF(textIn) {
  const lines = textIn.split(/\r?\n/);
  const out = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isInteger(code)) throw new Error(`bad group code at line ${i + 1}`);
    out.push({ code, value: lines[i + 1] });
  }
  return out;
}

// --- reading ---------------------------------------------------------------------------------------------------------

/**
 * Pattern pieces from a DXF: AAMA-style BLOCKs (layer 1 cutting line, 14 sewing line, 7 grain line, the Piece Name /
 * Quantity / Category texts) or, in a plain drawing, every closed POLYLINE / LWPOLYLINE of the ENTITIES. Units:
 * o.units 'cm' | 'mm' | 'in' | 'auto' (default: 'auto' guesses from the size of the pieces). y is turned down.
 * Returns { pieces: [{ name, cut: [[x, y], ...], sew: [...] | null, grain: [[x, y], [x, y]] | null, n, material }], units }.
 */
// A small state machine over group pairs: SECTION/ENDSEC, BLOCK/ENDBLK, and per-entity accumulation. Old-style
// POLYLINE carries its points in following VERTEX entities (pending point), LWPOLYLINE inline as repeated 10/20.
// Unit guess when 'auto': garment pieces span roughly 4-300 cm, so a larger extent means mm and a tiny one inches.
// Input is untrusted: piece count capped at 80, quantity at 20, material names sanitised.
export function readPatternDXF(textIn, o = {}) {
  const g = parseDXF(String(textIn).replace(/\s+$/, '') + '\n');
  const ents = [], blocks = [];
  let section = null, block = null;
  let cur = null;
  const flush = () => { if (cur) { (block ? block.ents : ents).push(cur); cur = null; } };
  for (let i = 0; i < g.length; i++) {
    const { code, value } = g[i];
    const v = value.trim();
    if (code === 0) {
      if (v === 'SECTION') { flush(); section = g[i + 1]?.code === 2 ? g[i + 1].value.trim() : null; continue; }
      if (v === 'ENDSEC') { flush(); section = null; continue; }
      if (section === 'BLOCKS' && v === 'BLOCK') { flush(); block = { name: '', ents: [] }; cur = { type: 'BLOCKHEAD' }; continue; }
      if (section === 'BLOCKS' && v === 'ENDBLK') { flush(); if (block) blocks.push(block); block = null; continue; }
      if (v === 'VERTEX') { if (cur && cur.type === 'POLYLINE') { cur.pending = []; cur.pts.push(cur.pending); } continue; }
      if (v === 'SEQEND') { if (cur && cur.type === 'POLYLINE') { cur.pts = cur.pts.filter((p) => p.length === 2); } continue; }
      flush();
      cur = { type: v, layer: '0', pts: [], x: null, y: null, text: '', flags: 0 };
      continue;
    }
    if (!cur) continue;
    if (cur.type === 'BLOCKHEAD') { if (code === 2 && block) block.name = v; continue; }
    if (code === 8) cur.layer = v;
    else if (code === 70) cur.flags = Number(v) || 0;
    else if (code === 1) cur.text = v;
    else if (code === 10 || code === 20 || code === 11 || code === 21) {
      const num = Number(v);
      if (cur.type === 'POLYLINE' && cur.pending) { if (code === 10) cur.pending[0] = num; else if (code === 20) cur.pending[1] = num; }
      else if (cur.type === 'LWPOLYLINE') { if (code === 10) cur.pts.push([num]); else if (code === 20 && cur.pts.length) cur.pts[cur.pts.length - 1][1] = num; }
      else if (cur.type === 'LINE') { cur.pts[code === 10 || code === 20 ? 0 : 1] = cur.pts[code === 10 || code === 20 ? 0 : 1] || []; cur.pts[code === 10 || code === 20 ? 0 : 1][code === 10 || code === 11 ? 0 : 1] = num; }
      else if (code === 10) cur.x = num; else if (code === 20) cur.y = num;
    }
  }
  flush();
  const polyOf = (e) => (e.pts || []).filter((p) => p.length === 2 && p.every(Number.isFinite));
  const closed = (pts) => pts.length >= 3;
  const fromEnts = (list, name) => {
    const polys = list.filter((e) => (e.type === 'POLYLINE' || e.type === 'LWPOLYLINE') && closed(polyOf(e)));
    const cutE = polys.find((e) => e.layer === '1') || polys.sort((a, b) => Math.abs(areaOf(polyOf(b))) - Math.abs(areaOf(polyOf(a))))[0];
    if (!cutE) return null;
    const sewE = polys.find((e) => e.layer === '14' && e !== cutE) || null;
    const grainE = list.find((e) => e.type === 'LINE' && e.layer === '7');
    const texts = list.filter((e) => e.type === 'TEXT').map((e) => e.text);
    const tv = (k) => { const s = texts.find((x) => x.toLowerCase().startsWith(k)); return s ? s.slice(k.length).trim() : null; };
    return {
      name: tv('piece name:') || name || 'piece', cut: polyOf(cutE), sew: sewE ? polyOf(sewE) : null, grain: grainE && grainE.pts.length === 2 ? grainE.pts : null,
      fold: /fold/i.test(tv('annotation:') || ''), n: Math.max(1, Math.min(20, parseInt(tv('quantity:') || '1', 10) || 1)), material: (tv('category:') || 'shell').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24) || 'shell',
    };
  };
  let pieces = blocks.map((b) => fromEnts(b.ents, b.name)).filter(Boolean);
  if (!pieces.length) {
    // a plain drawing: every closed polyline is a piece
    pieces = ents.filter((e) => (e.type === 'POLYLINE' || e.type === 'LWPOLYLINE') && ((e.flags & 1) || closedLoop(polyOf(e))) && closed(polyOf(e)))
      .map((e, k) => ({ name: 'piece ' + (k + 1), cut: polyOf(e), sew: null, grain: null, n: 1, material: 'shell' }));
  }
  // units: cm as written here, mm or inches from other systems
  const ext = Math.max(1, ...pieces.flatMap((p) => p.cut.map((q) => Math.max(Math.abs(q[0]), Math.abs(q[1])))));
  const units = o.units && o.units !== 'auto' ? o.units : ext > 300 ? 'mm' : ext < 4 ? 'in' : 'cm';
  const k = units === 'mm' ? 0.1 : units === 'in' ? 2.54 : units === 'm' ? 100 : 1;
  const tf = (pts) => pts && pts.map(([x, y]) => [x * k, -y * k]);
  return { units, pieces: pieces.slice(0, 80).map((p) => ({ ...p, cut: tf(p.cut), sew: tf(p.sew), grain: tf(p.grain) })) };
}
const areaOf = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
const closedLoop = (pts) => pts.length > 3 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-6;
