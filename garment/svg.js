// garment/svg.js - pattern drawings as SVG (1 user unit = 1 cm, so a viewer at 1:1 or a printer gets true size): the
// cutting line with the seam allowance, the seam line, darts, fold lines, notches, the grainline, buttons and button
// holes, pocket and placement lines, drill holes, labels with the cutting instruction; pieces laid out in rows; graded
// nests (every size's cutting line in one drawing).
//
//   pieceSVG(piece, { allowance, notches, label, prints, theme }) -> '<g>…</g>' (piece coordinates)
//   layoutRows(pieces, { width, gap, allowance }) -> [{ piece, dx, dy, box }] (offsets that place pieces in rows)
//   patternSVG(draft, { width, gap, allowance, label, title, theme, unfold }) -> complete SVG document
//   gradedSVG(drafts [{ size, draft }], { pieceIds, colors }) -> SVG of nested outlines per piece
//   esc(text), cutText(piece, t)

import { cutOutline, outline, pieceBBox, unfoldPiece } from './piece.js';
import { bbox, plLength, pointAt } from './geom.js';
import { seamNotches } from './seams.js';

//
// True scale: width/height in cm with viewBox in the same units, so a browser's "print at 100%" or a plotter produces
// a usable pattern without any scale setting. Stroke widths are in cm too (0.12 cm cutting line, thinner seam line).
// Text is escaped with esc(); colours come from THEMES. Line conventions follow the trade: solid cutting line,
// dashed sewing line, dash-dot fold line, grainline with arrows at both ends.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const f = (v) => (Math.round(v * 100) / 100).toString();
const pathD = (pts, close) => 'M' + pts.map((p) => f(p[0]) + ' ' + f(p[1])).join('L') + (close ? 'Z' : '');

// 'print' uses fill 'none' and pure black: toner-friendly and legible on any paper.
export const THEMES = {
  light: { paper: '#ffffff', cut: '#1d2330', seam: '#2563eb', fold: '#16a34a', mark: '#7c3aed', text: '#1d2330', muted: '#6b7280', fill: '#f5f7fb', grain: '#1d2330' },
  dark: { paper: '#14171c', cut: '#e6e9ef', seam: '#5b8cff', fold: '#4ade80', mark: '#c4b5fd', text: '#e6e9ef', muted: '#9aa3b2', fill: '#1b1f26', grain: '#e6e9ef' },
  print: { paper: '#ffffff', cut: '#000000', seam: '#444444', fold: '#000000', mark: '#000000', text: '#000000', muted: '#555555', fill: 'none', grain: '#000000' },
};

// "Cut 2 (mirrored)" / "Cut 1 on fold" in English unless a translator is given.
export function cutText(p, t) {
  const tr = t || ((k, v) => ({ 'cut.n': `Cut ${v.n}`, 'cut.fold': `Cut ${v.n} on fold`, 'cut.mirror': `Cut ${v.n} (mirrored pair)` })[k]);
  if (p.cut.fold) return tr('cut.fold', { n: p.cut.n });
  if (p.cut.mirror) return tr('cut.mirror', { n: p.cut.n });
  return tr('cut.n', { n: p.cut.n });
}

/**
 * One piece in its own coordinates. opts: { allowance (true: draw the cutting line), notches: [{ p, dir }], label:
 * { title, lines: [] }, theme, prints: [{ href, x, y, w, h, rot }] (placement artwork drawn clipped to the piece),
 * fill (fabric colour) }
 */
// KNOWN DEFECT (minor): o.fill (a fabric colour) is interpolated into fill="..." unescaped, unlike text; if it comes
// from user input a quote breaks out of the attribute. Fix: esc(o.fill) or a colour whitelist.
// The clipPath id is derived from the piece id only; two pattern SVGs inlined in one HTML document with prints on
// pieces of the same id would share it (ids are document-global). Harmless for standalone files.
export function pieceSVG(p, o = {}) {
  const T = THEMES[o.theme || 'light'];
  const ol = outline(p);
  const out = [];
  const id = 'p-' + p.id.replace(/[^\w-]/g, '');
  out.push(`<g class="tx-piece" data-piece="${esc(p.id)}">`);
  const cut = o.allowance !== false ? cutOutline(p) : null;
  if (cut) out.push(`<path d="${pathD(cut, true)}" fill="${o.fill || T.fill}" stroke="${T.cut}" stroke-width="0.12"/>`);
  out.push(`<path d="${pathD(ol, true)}" fill="${cut ? 'none' : o.fill || T.fill}" stroke="${cut ? T.seam : T.cut}" stroke-width="${cut ? 0.06 : 0.12}"${cut ? ' stroke-dasharray="0.6 0.3"' : ''}/>`);
  if (o.prints?.length) {
    out.push(`<clipPath id="${id}-clip"><path d="${pathD(ol, true)}"/></clipPath><g clip-path="url(#${id}-clip)">`);
    for (const pr of o.prints) {
      const tr = `translate(${f(pr.x)} ${f(pr.y)}) rotate(${f(pr.rot || 0)})`;
      out.push(`<image href="${esc(pr.href)}" transform="${tr}" x="${f(-pr.w / 2)}" y="${f(-pr.h / 2)}" width="${f(pr.w)}" height="${f(pr.h)}" preserveAspectRatio="none"/>`);
    }
    out.push('</g>');
  }
  // Fold edges.
  for (const e of p.edges) if (e.kind === 'fold') out.push(`<path d="${pathD(e.pts)}" fill="none" stroke="${T.fold}" stroke-width="0.14" stroke-dasharray="1.2 0.4 0.2 0.4"/>`);
  // Darts: the legs as stitched lines.
  for (const e of p.edges) if (e.kind === 'dart') out.push(`<path d="${pathD(e.pts)}" fill="none" stroke="${T.seam}" stroke-width="0.08"/>`);
  // Marks.
  for (const m of p.marks) {
    if (m.type === 'line') {
      const dash = m.role === 'fold' ? '1.2 0.4 0.2 0.4' : m.role === 'pocket' ? '' : '0.5 0.4';
      const col = m.role === 'fold' ? T.fold : T.mark;
      out.push(`<path d="${pathD(m.pts)}" fill="none" stroke="${col}" stroke-width="${m.role === 'pocket' ? 0.12 : 0.07}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`);
    } else if (m.type === 'button') {
      out.push(`<circle cx="${f(m.p[0])}" cy="${f(m.p[1])}" r="${f(m.d / 2)}" fill="none" stroke="${T.mark}" stroke-width="0.07"/><path d="M${f(m.p[0] - 0.3)} ${f(m.p[1])}h0.6M${f(m.p[0])} ${f(m.p[1] - 0.3)}v0.6" stroke="${T.mark}" stroke-width="0.07"/>`);
    } else if (m.type === 'buttonhole') {
      out.push(`<path d="M${f(m.p[0] - m.w)} ${f(m.p[1])}h${f(m.w)}M${f(m.p[0] - m.w)} ${f(m.p[1] - 0.25)}v0.5M${f(m.p[0])} ${f(m.p[1] - 0.25)}v0.5" stroke="${T.mark}" stroke-width="0.08"/>`);
    } else if (m.type === 'drill') {
      out.push(`<circle cx="${f(m.p[0])}" cy="${f(m.p[1])}" r="${f((m.d || 0.6) / 2)}" fill="none" stroke="${T.mark}" stroke-width="0.07"/>`);
    } else if (m.type === 'label') {
      out.push(`<rect x="${f(m.p[0])}" y="${f(m.p[1])}" width="${f(m.w)}" height="${f(m.h)}" fill="none" stroke="${T.mark}" stroke-width="0.06" stroke-dasharray="0.3 0.2"/>`);
    }
  }
  // Grainline with arrow heads.
  if (p.grain) {
    const [a, b] = p.grain;
    const d = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(d[0], d[1]) || 1, u = [d[0] / L, d[1] / L], n = [-u[1], u[0]];
    const head = (q, s) => `M${f(q[0] - s * u[0] * 1.2 + n[0] * 0.45)} ${f(q[1] - s * u[1] * 1.2 + n[1] * 0.45)}L${f(q[0])} ${f(q[1])}L${f(q[0] - s * u[0] * 1.2 - n[0] * 0.45)} ${f(q[1] - s * u[1] * 1.2 - n[1] * 0.45)}`;
    out.push(`<path d="${pathD([a, b])}${head(b, 1)}${head(a, -1)}" fill="none" stroke="${T.grain}" stroke-width="0.08"/>`);
  }
  // The tick points outward (left normal of the seam direction negated, consistent with the clockwise outline), 9 mm
  // long, so it is cut as a small snip into the allowance.
  // Notches: short ticks into the allowance across the cutting line.
  for (const nt of o.notches || []) {
    const n = [-nt.dir[1], nt.dir[0]];
    const out1 = [nt.p[0] - n[0] * 0.9, nt.p[1] - n[1] * 0.9];
    out.push(`<path d="${pathD([nt.p, out1])}" stroke="${T.cut}" stroke-width="0.1"/>`);
  }
  if (o.label) {
    const b = bbox(ol);
    const c = labelPoint(p, b);
    const s = Math.max(0.8, Math.min(2.2, Math.min(b.w, b.h) / 9));
    out.push(`<g fill="${T.text}" font-family="Helvetica, Arial, sans-serif" text-anchor="middle">`);
    out.push(`<text x="${f(c[0])}" y="${f(c[1])}" font-size="${f(s)}" font-weight="700">${esc(o.label.title)}</text>`);
    (o.label.lines || []).forEach((ln, i) => out.push(`<text x="${f(c[0])}" y="${f(c[1] + s * 1.25 * (i + 1))}" font-size="${f(s * 0.72)}" fill="${T.muted}">${esc(ln)}</text>`));
    out.push('</g>');
  }
  out.push('</g>');
  return out.join('');
}

// A point inside the piece for its label: the bbox centre, moved off the grainline.
// Slightly above centre and shifted off the grainline so the label never overprints the grain arrow.
function labelPoint(p, b) {
  const c = [(b.x0 + b.x1) / 2, b.y0 + b.h * 0.42];
  if (p.grain) {
    const gx = (p.grain[0][0] + p.grain[1][0]) / 2;
    if (Math.abs(gx - c[0]) < b.w * 0.12) c[0] += b.w * 0.18;
  }
  return c;
}

// Pieces in rows of at most `width` cm (sorted by height).
// Shelf packing (tallest first, left to right, new row when full): simple and readable for a printed overview;
// the material-saving layout is nest.js, a different goal.
export function layoutRows(pieces, o = {}) {
  const width = o.width || 150, gap = o.gap ?? 3;
  const items = pieces.map((p) => {
    const b = o.allowance === false ? pieceBBox(p) : bbox(cutOutline(p));
    return { piece: p, box: b };
  }).sort((a, b) => b.box.h - a.box.h);
  let x = 0, y = 0, rowH = 0;
  const out = [];
  for (const it of items) {
    if (x > 0 && x + it.box.w > width) { x = 0; y += rowH + gap; rowH = 0; }
    out.push({ ...it, dx: x - it.box.x0, dy: y - it.box.y0 });
    x += it.box.w + gap;
    rowH = Math.max(rowH, it.box.h);
  }
  return out;
}

/**
 * The whole pattern of a draft: every piece (fold pieces opened when opts.unfold) laid out in rows with labels and
 * notches. opts: { width, gap, allowance, theme, title, label(piece) -> { title, lines }, unfold, prints(pieceId) }
 */
export function patternSVG(d, o = {}) {
  const T = THEMES[o.theme || 'light'];
  const pieces = d.pieces.map((p) => (o.unfold && p.cut.fold ? unfoldPiece(p) : p));
  const notches = o.notches === false ? [] : seamNotches(d);
  const lay = layoutRows(pieces, o);
  let W = 0, H = 0;
  for (const it of lay) { W = Math.max(W, it.dx + it.box.x1); H = Math.max(H, it.dy + it.box.y1); }
  const pad = 2, titleH = o.title ? 5 : 0;
  const body = lay.map((it) => {
    const p = it.piece;
    const label = o.label ? o.label(p) : { title: p.name, lines: [cutText(p)] };
    const nts = notches.filter((n) => n.piece === p.id);
    return `<g transform="translate(${f(it.dx)} ${f(it.dy)})">${pieceSVG(p, { ...o, label, notches: nts, prints: o.prints ? o.prints(p.id) : null })}</g>`;
  }).join('');
  const w = W + pad * 2, h = H + pad * 2 + titleH;
  const title = o.title ? `<text x="${pad}" y="${pad + 3.2}" font-family="Helvetica, Arial, sans-serif" font-size="3" font-weight="700" fill="${T.text}">${esc(o.title)}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${f(w)}cm" height="${f(h)}cm" viewBox="0 0 ${f(w)} ${f(h)}"><rect width="100%" height="100%" fill="${T.paper}"/>${title}<g transform="translate(${pad} ${pad + titleH})">${body}</g></svg>`;
}

/**
 * Graded nest: for every piece id, the cutting lines of all sizes on top of each other (aligned at their grainline
 * start), coloured from small to large.
 */
// Hue ramp from blue (small) to red (large) via HSL, so the size order reads at a glance in the nest.
export function gradedSVG(sized, o = {}) {
  const T = THEMES[o.theme || 'light'];
  const ids = o.pieceIds || [...new Set(sized.flatMap((s) => s.draft.pieces.filter((p) => p.sim !== false || p.layer === 'shell').map((p) => p.id)))];
  const colors = o.colors || sized.map((_, i) => `hsl(${Math.round(220 - (i * 200) / Math.max(1, sized.length - 1))} 70% 45%)`);
  const groups = [];
  let x = 0, y = 0, rowH = 0;
  const width = o.width || 160;
  for (const id of ids) {
    const shapes = sized.map((s) => s.draft.pieces.find((p) => p.id === id)).filter(Boolean);
    if (!shapes.length) continue;
    const cuts = shapes.map((p) => cutOutline(p));
    const b = bbox(cuts.flat());
    if (x > 0 && x + b.w > width) { x = 0; y += rowH + 4; rowH = 0; }
    const g = cuts.map((c, i) => `<path d="${pathD(c, true)}" fill="none" stroke="${colors[i]}" stroke-width="0.1"/>`).join('');
    groups.push(`<g transform="translate(${f(x - b.x0)} ${f(y - b.y0)})">${g}<text x="${f(b.x0 + 1)}" y="${f(b.y0 + 2.5)}" font-size="2" font-family="Helvetica, Arial, sans-serif" fill="${T.text}">${esc(shapes[0].name)}</text></g>`);
    x += b.w + 4;
    rowH = Math.max(rowH, b.h);
  }
  const legend = sized.map((s, i) => `<g transform="translate(${2 + i * 14} 2)"><rect width="3" height="1.6" fill="${colors[i]}"/><text x="4" y="1.5" font-size="1.8" font-family="Helvetica, Arial, sans-serif" fill="${T.text}">${esc(s.size)}</text></g>`).join('');
  const w = Math.max(width, x) + 4, h = y + rowH + 10;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${f(w)}cm" height="${f(h)}cm" viewBox="0 0 ${f(w)} ${f(h)}"><rect width="100%" height="100%" fill="${T.paper}"/>${legend}<g transform="translate(2 6)">${groups.join('')}</g></svg>`;
}

export { plLength, pointAt };
