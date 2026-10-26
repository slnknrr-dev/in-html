// stock-analyzer/charts.js - the Pareto chart as SVG markup drawn at the pixel width of its container: one bar per
// item (or per group of neighbouring items when there are more items than pixels allow) coloured by ABC class, the
// cumulative share line, the A / B cut-off lines with labels, the A | B | C zone boundaries and both axes. Colours
// come from CSS classes (app.css), so the light and dark schemes follow the ui tokens.
//
// Why a string at the container's real pixel width (not a fixed viewBox scaled by CSS): text and 1px lines stay
// crisp and legible at every size; the caller redraws on resize. Two vertical scales share one plot: bars on the
// value scale (right axis), the cumulative curve on the 0..100% share scale (left axis), the classic Pareto layout.
// Every interpolated label goes through esc(): item names come from imported files.
import { esc } from '../ui/dom.js';

/**
 * rows: classify() rows in rank order ({ value, cumShare, abc, name }); opts: { width, height, aCut, bCut,
 * fmtValue(v), fmtPct(x), labels: { a, b, c, items, cum, title } } -> SVG markup.
 */
export function paretoSVG(rows, { width = 800, height = 300, aCut = 0.8, bCut = 0.95, fmtValue = String, fmtPct = (x) => Math.round(x * 100) + '%', labels = {} } = {}) {
  const W = Math.max(280, Math.round(width)), H = Math.max(200, Math.round(height));
  const small = W < 520;
  // Narrow charts drop the right value axis and shrink margins, giving the plot the width.
  const m = { l: small ? 36 : 44, r: small ? 18 : 56, t: 22, b: 40 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const n = rows.length;
  const out = [`<svg class="sa-pareto" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(labels.title || '')}">`];
  if (!n) { out.push('</svg>'); return out.join(''); }
  const x = (i) => m.l + (i / n) * pw;               // left edge of item i (0..n)
  const y = (p) => m.t + (1 - p) * ph;               // cumulative share 0..1
  const maxV = Math.max(...rows.map((r) => r.value), 1);
  const yv = (v) => m.t + ph - (v / maxV) * ph;
  // Class boundaries as item counts: rows arrive sorted by rank, so classes are contiguous runs.
  const lastA = rows.findLastIndex((r) => r.abc === 'A') + 1;
  const lastB = Math.max(lastA, rows.findLastIndex((r) => r.abc === 'B') + 1);

  // Zones A | B | C as light bands.
  const zones = [['A', 0, lastA], ['B', lastA, lastB], ['C', lastB, n]];
  for (const [k, a, b] of zones) if (b > a) out.push(`<rect class="sa-zone sa-z-${k}" x="${x(a).toFixed(1)}" y="${m.t}" width="${(x(b) - x(a)).toFixed(1)}" height="${ph}"/>`);

  // Grid and the cumulative share axis (left).
  // 1.0001: tolerance for float accumulation of 0.2 steps (0.2 x 5 is 1.0000000000000002 in binary floats).
  for (let p = 0; p <= 1.0001; p += 0.2) {
    out.push(`<line class="sa-grid" x1="${m.l}" x2="${m.l + pw}" y1="${y(p).toFixed(1)}" y2="${y(p).toFixed(1)}"/>`);
    out.push(`<text class="sa-ax" x="${m.l - 6}" y="${(y(p) + 4).toFixed(1)}" text-anchor="end">${esc(fmtPct(p))}</text>`);
  }
  // Value axis (right): the largest item and half of it.
  if (!small) {
    for (const k of [0.5, 1]) out.push(`<text class="sa-ax" x="${m.l + pw + 6}" y="${(yv(maxV * k) + 4).toFixed(1)}">${esc(fmtValue(maxV * k))}</text>`);
  }

  // Bars: one per item, or groups of items when bars would be thinner than 2 px.
  // Aggregation: when items exceed about one per 2.2px, neighbouring items are averaged into one bar. The group takes
  // the class of its first item, so a group straddling a class boundary is coloured by the higher class.
  const per = Math.max(1, Math.ceil(n / (pw / 2.2)));
  const bars = [];
  for (let i = 0; i < n; i += per) {
    const g = rows.slice(i, i + per);
    const v = g.reduce((s, r) => s + r.value, 0) / g.length;
    const cls = g[0].abc;
    // A 1px gap between bars only when bars are wide enough to afford it; otherwise a hairline 0.3px.
    const bw = Math.max(1, x(i + g.length) - x(i) - (per === 1 && pw / n > 4 ? 1 : 0.3));
    const tip = per === 1 ? `${g[0].rank}. ${g[0].name} — ${fmtValue(g[0].value)} (${fmtPct(g[0].share)})` : `${g[0].rank}–${g.at(-1).rank}: ${fmtValue(v)}`;
    bars.push(`<rect class="sa-bar sa-b-${cls}" x="${x(i).toFixed(1)}" y="${yv(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(m.t + ph - yv(v)).toFixed(1)}"><title>${esc(tip)}</title></rect>`);
  }
  out.push(`<g class="sa-bars">${bars.join('')}</g>`);

  // Cut-off lines with their labels (right end, above the line).
  for (const [k, p] of [['A', aCut], ['B', bCut]]) {
    out.push(`<line class="sa-cut" x1="${m.l}" x2="${m.l + pw}" y1="${y(p).toFixed(1)}" y2="${y(p).toFixed(1)}"/>`);
    out.push(`<text class="sa-cut-l" x="${(m.l + pw - 4).toFixed(1)}" y="${(y(p) - 4).toFixed(1)}" text-anchor="end">${esc(`${k} ≤ ${fmtPct(p)}`)}</text>`);
  }
  // Zone boundaries.
  for (const b of [lastA, lastB]) if (b > 0 && b < n) out.push(`<line class="sa-bound" x1="${x(b).toFixed(1)}" x2="${x(b).toFixed(1)}" y1="${m.t}" y2="${m.t + ph}"/>`);

  // Cumulative share line.
  // The curve starts at (0, 0) and passes through each item's right edge at its cumulative share.
  const pts = [`${x(0).toFixed(1)},${y(0).toFixed(1)}`, ...rows.map((r, i) => `${x(i + 1).toFixed(1)},${y(r.cumShare).toFixed(1)}`)];
  out.push(`<polyline class="sa-cum" points="${pts.join(' ')}"/>`);
  for (const b of [lastA, lastB]) if (b > 0 && b <= n) out.push(`<circle class="sa-cum-dot" cx="${x(b).toFixed(1)}" cy="${y(rows[b - 1].cumShare).toFixed(1)}" r="3.5"/>`);

  // Zone labels at the top: class, items share.
  for (const [k, a, b] of zones) {
    if (b <= a) continue;
    const wpx = x(b) - x(a);
    // Zone labels degrade with width: full text, then the class letter only, then nothing.
    const txt = wpx > 90 ? `${k} · ${labels.items ? labels.items(b - a) : b - a} · ${fmtPct((b - a) / n, 0)}` : wpx > 18 ? k : '';
    if (txt) out.push(`<text class="sa-zone-l sa-zl-${k}" x="${((x(a) + x(b)) / 2).toFixed(1)}" y="${m.t - 7}" text-anchor="middle">${esc(txt)}</text>`);
  }
  // Items axis (bottom): share of items.
  for (let p = 0; p <= 1.0001; p += small ? 0.25 : 0.1) {
    const px = m.l + p * pw;
    out.push(`<line class="sa-tick" x1="${px.toFixed(1)}" x2="${px.toFixed(1)}" y1="${m.t + ph}" y2="${m.t + ph + 4}"/>`);
    out.push(`<text class="sa-ax" x="${px.toFixed(1)}" y="${m.t + ph + 16}" text-anchor="middle">${esc(fmtPct(p, 0))}</text>`);
  }
  out.push(`<line class="sa-axis" x1="${m.l}" x2="${m.l + pw}" y1="${m.t + ph}" y2="${m.t + ph}"/>`);
  if (labels.xAxis) out.push(`<text class="sa-ax sa-ax-t" x="${(m.l + pw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(labels.xAxis)}</text>`);
  out.push('</svg>');
  return out.join('');
}
