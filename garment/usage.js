// garment/usage.js - how much material a garment or an outfit takes: per material the pieces as they are cut (with
// seam allowances), their area, the length of the cutting layout on the fabric's width (nest.js) and the length to
// buy (layout + shrinkage + a cutting margin, rounded up to 10 cm); the notions: buttons by size, zips, hooks,
// cartridges, the stitching thread (every seam sewn and overlocked, hems, topstitching). Plain data, no DOM.
//
//   materialUsage(draft, { width, widths: { material: cm }, shrink: 0.03, margin: 10 }) -> usage
//   outfitUsage(drafts, opts, label(i) -> name) -> { rows, notions, totals }
//   usageCSV(outfit, names) -> CSV text (UTF-8, ';' separated as spreadsheets in most locales expect)
//
//   usage = { materials: [{ material, pieces, area (cm2), layout (cm), efficiency, buy (cm), width }], notions: {...},
//             seams (cm of seam lines), thread (m) }

import { cutInstances, nest } from './nest.js';
import { area } from './geom.js';
import { edgeLength, pathLength } from './piece.js';

//
// Fabric to buy = real cutting layout length (nest.js) on the fabric width, plus shrinkage (pre-washing) and a
// cutting margin, rounded up to 10 cm (shops cut in 10 cm steps). Using the actual layout rather than area / width
// matters: layouts waste 15-35% between pieces, and pieces wider than half the fabric cannot sit side by side.
const SKIP = new Set(['button']);

/** Usage of one draft. */
// Default widths per material reflect common bolt widths (interfacing 90, rib 100, others 150 cm).
export function materialUsage(d, o = {}) {
  const width = o.width || 150, shrink = o.shrink ?? 0.03, margin = o.margin ?? 10;
  const mats = [...new Set(d.pieces.map((p) => p.material))].filter((m) => !SKIP.has(m));
  const materials = mats.map((material) => {
    const inst = cutInstances(d, { material });
    const w = (o.widths && o.widths[material]) || (material === 'interfacing' ? 90 : material === 'wadding' ? 150 : material === 'rib' ? 100 : width);
    const r = inst.length ? nest(inst, { width: w, res: o.res || 1 }) : { length: 0, efficiency: 0 };
    const a = inst.reduce((s, x) => s + Math.abs(area(x.poly)), 0);
    const buy = r.length ? Math.ceil((r.length * (1 + shrink) + margin) / 10) * 10 : 0;
    return { material, pieces: inst.length, area: a, layout: r.length, efficiency: r.efficiency, buy, width: w };
  }).sort((x, y) => (x.material === 'shell' ? -1 : y.material === 'shell' ? 1 : y.area - x.area));
  // Notions.
  const buttons = {};
  for (const b of d.buttons || []) {
    if (b.kind === 'cartridge') continue;
    const n = b.side === 'both' ? 2 : 1;
    const k = (Math.round((b.d || 1.5) * 10) / 10).toFixed(1);
    buttons[k] = (buttons[k] || 0) + n;
  }
  const zips = [];
  for (const p of d.pieces) for (const m of p.marks || []) {
    if (m.type === 'line' && m.role === 'zip' && m.pts?.length >= 2) {
      const L = Math.hypot(m.pts[m.pts.length - 1][0] - m.pts[0][0], m.pts[m.pts.length - 1][1] - m.pts[0][1]);
      zips.push(Math.ceil((L + 2) / 5) * 5);
    }
  }
  const hooks = (d.closures || []).filter(() => d.info?.coat?.id === 'chokha').length;
  const cartridges = d.info?.gazyri ? d.info.gazyri.n * 2 : 0;
  // Seams: every seam is sewn (both sides are as long as the longer one) on each instance pair.
  let seams = 0;
  for (const s of d.seams || []) {
    try {
      const L = Math.max(pathLength(d.pieces, s.a), pathLength(d.pieces, s.b));
      seams += Number.isFinite(L) ? L * (s.sides === 'center' ? 1 : 2) : 0;
    } catch { /* a seam of a piece left out */ }
  }
  let hems = 0;
  for (const p of d.pieces) {
    if (p.sim === false) continue;
    for (const e of p.edges) if (e.kind === 'hem') hems += edgeLength(p, e.id) * Math.max(1, p.cut.n || 1);
  }
  // Thread: a lockstitch takes ~2.5 x the seam, an overlock ~14 x; hems and topstitching ~3 x.
  // Thread consumption factors (lockstitch ~2.5x seam length, 4-thread overlock ~14x, hems ~3x) are common industry
  // rules of thumb; +10% reserve.
  const thread = Math.ceil(((seams * (2.5 + 14) + hems * 3) / 100) * 1.1);
  return { garment: d.garment, materials, notions: { buttons, zips, hooks, cartridges }, seams, hems, thread };
}

/** Usage of an outfit: one row per garment and material, notions summed. */
export function outfitUsage(drafts, o = {}, label = (i) => String(i + 1)) {
  const rows = [];
  const notions = { buttons: {}, zips: [], hooks: 0, cartridges: 0, thread: 0 };
  drafts.forEach((d, i) => {
    const u = materialUsage(d, { ...o, widths: o.widthsOf ? o.widthsOf(i) : o.widths });
    for (const m of u.materials) rows.push({ garment: label(i), garmentId: d.garment, index: i, ...m });
    for (const [k, n] of Object.entries(u.notions.buttons)) notions.buttons[k] = (notions.buttons[k] || 0) + n;
    notions.zips.push(...u.notions.zips);
    notions.hooks += u.notions.hooks;
    notions.cartridges += u.notions.cartridges;
    notions.thread += u.thread;
  });
  const totals = {};
  for (const r of rows) totals[r.material] = (totals[r.material] || 0) + r.buy;
  return { rows, notions, totals };
}

/** CSV of an outfit's usage; names: { material(m), header: [...] } for translated labels. */
// ';' separator and a UTF-8 BOM: spreadsheets in comma-decimal locales (most of Europe) open it correctly without an
// import dialog. CRLF line ends per RFC 4180.
// KNOWN DEFECT (minor security): cells are quoted for ; " and newlines but not neutralised against formula injection;
// a garment label starting with = + - @ is executed as a formula by spreadsheets. Fix: prefix such cells with an
// apostrophe (or a tab) in q().
export function usageCSV(u, names = {}) {
  const q = (v) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const mat = names.material || ((m) => m);
  const head = names.header || ['garment', 'material', 'pieces', 'area m2', 'layout cm', 'width cm', 'efficiency %', 'buy cm'];
  const lines = [head.map(q).join(';')];
  for (const r of u.rows) lines.push([r.garment, mat(r.material), r.pieces, (r.area / 1e4).toFixed(2), Math.round(r.layout), r.width, Math.round(r.efficiency * 100), r.buy].map(q).join(';'));
  lines.push('');
  for (const [k, n] of Object.entries(u.notions.buttons)) lines.push([names.button || 'buttons', `${k} cm`, n].map(q).join(';'));
  for (const z of u.notions.zips) lines.push([names.zip || 'zip', `${z} cm`, 1].map(q).join(';'));
  if (u.notions.hooks) lines.push([names.hooks || 'hooks', '', u.notions.hooks].map(q).join(';'));
  if (u.notions.cartridges) lines.push([names.cartridges || 'cartridges', '', u.notions.cartridges].map(q).join(';'));
  lines.push([names.thread || 'thread', 'm', u.notions.thread].map(q).join(';'));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

