// carpet/chart.js - rugs as charts through the stitch library: a knotting chart (one cell per knot, the rug's own dyed
// colours, symbols, fabric 'rug' at the knot density) and a cross-stitch version (each colour mapped to the nearest
// thread of a brand by ΔE2000, equal threads merged), both ordinary stitch schemes for the PDF / OXS / PNG / SVG
// exports and the editors.
//
//   knotScheme(rug, { title, symbols: 'symbols' | 'letters' }) -> scheme
//   crossStitchScheme(rug, { brand = 'dmc', title, count = 14 }) -> scheme

import { createScheme, threadEntry } from '../stitch/model.js';
import { nearestThreads, rgbToLab, hexToRgb } from '../stitch/threads.js';
import { assignSymbols } from '../stitch/symbols.js';

// Rug palette index -> scheme palette slot (+1: 0 means "empty" in stitch layers). Only colours actually used are
// mapped, so a scheme never lists unused threads; the counts drive symbol assignment (frequent colours get the
// clearest symbols).
function fill(rug, scheme, map) {
  const L = scheme.layers[0];
  for (let i = 0; i < rug.cells.length; i++) L.cells[i] = map[rug.cells[i]] + 1;
  const counts = scheme.palette.map(() => 0);
  for (const v of L.cells) if (v) counts[v - 1]++;
  return counts;
}

// One cell per knot at the rug's real density: fabric 'rug' with horizontal and vertical knot counts per inch
// (kpiH / kpiV differ in most rugs, so cells are not square in physical size).
export function knotScheme(rug, { title = '', symbols = 'symbols' } = {}) {
  const used = [...new Set(rug.cells)].sort((a, b) => a - b);
  const map = new Array(rug.palette.length).fill(-1);
  used.forEach((p, i) => { map[p] = i; });
  const palette = used.map((p) => {
    const c = rug.palette[p];
    return { catalog: '', brand: '', code: c.role, name: c.dye, hex: c.hex, symbol: '', strands: 1, bsStrands: 1, kind: 'thread' };
  });
  const s = createScheme({ width: rug.width, height: rug.height, title, palette, fabric: { kind: 'rug', count: Math.round(rug.kpiH * 10) / 10, countY: Math.round(rug.kpiV * 10) / 10, color: '#d8ccb4', name: 'Warp' }, meta: { description: `Knotting chart: ${rug.width} × ${rug.height} knots.`, category: 'other', tags: ['rug', rug.meta.tradition] } });
  const counts = fill(rug, s, map);
  const syms = assignSymbols(s.palette, { mode: symbols, counts, labs: s.palette.map((e) => rgbToLab(hexToRgb(e.hex))) });
  s.palette.forEach((e, i) => { e.symbol = syms[i]; });
  s.layers[0].name = 'Knots';
  return s;
}

// Each dyed colour is matched to the perceptually nearest thread (CIEDE2000 in stitch/threads.js, not RGB distance,
// which over-weights blue/green differences). Two rug colours that land on the same thread share one palette entry.
export function crossStitchScheme(rug, { brand = 'dmc', title = '', count = 14 } = {}) {
  const used = [...new Set(rug.cells)].sort((a, b) => a - b);
  const map = new Array(rug.palette.length).fill(-1);
  const palette = [];
  const byKey = new Map();
  for (const p of used) {
    const th = nearestThreads(rug.palette[p].hex, brand, { n: 1 })[0].thread;
    if (!byKey.has(th.key)) { byKey.set(th.key, palette.length); palette.push(threadEntry(th, { strands: 2 })); }
    map[p] = byKey.get(th.key);
  }
  const s = createScheme({ width: rug.width, height: rug.height, title, palette, fabric: { kind: 'aida', count, color: '#ffffff' }, meta: { description: 'Cross-stitch version of a rug design.', category: 'geometric', tags: ['rug', rug.meta.tradition] } });
  const counts = fill(rug, s, map);
  const syms = assignSymbols(s.palette, { counts, labs: s.palette.map((e) => rgbToLab(hexToRgb(e.hex))) });
  s.palette.forEach((e, i) => { e.symbol = syms[i]; });
  s.layers[0].name = 'Cross stitch';
  return s;
}
