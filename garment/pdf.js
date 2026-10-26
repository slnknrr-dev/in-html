// garment/pdf.js - a small vector PDF writer (PDF 1.4: paths, strokes, fills, dashes, clipping, Helvetica text) and the
// tiled pattern for printing at home: the pieces at 1:1 cut into A4 or Letter pages with overlaps, alignment marks,
// row / column labels on every tile, a 5 cm and a 2 inch test square, and an assembly overview first.
// Standard fonts only carry Latin-1, so Cyrillic and Georgian labels are transliterated (latin()).
//
//   pdfDoc() -> { page(w, h) -> Page, bytes() -> Uint8Array }    (points, y up as in PDF)
//   Page: moveTo, lineTo, curveTo, close, rect, stroke({ color, width, dash }), fill(color), clip(), save(), restore(),
//         text(x, y, str, { size, bold, align, color }), polyline(pts, closed)
//   tiledPDF(draft, { paper: 'A4' | 'Letter', margin, overlap, allowance, title, label(piece), notches }) -> Uint8Array
//   PAPERS, CM (points per cm), latin(text)

import { cutOutline, outline } from './piece.js';
import { layoutRows, cutText } from './svg.js';
import { seamNotches } from './seams.js';

//
// Why a hand-written PDF writer: tiled home-print patterns need only paths, dashes, clipping and a little text; the
// 14 standard fonts need no embedding, so a complete writer is ~100 lines and has no dependency. PDF units are points
// (1/72 inch) with y up, hence CM and the y flip done by callers.
export const CM = 72 / 2.54;
export const PAPERS = { A4: [21.0, 29.7], Letter: [21.59, 27.94] };

const num = (v) => { const r = Math.round(v * 1000) / 1000; return Object.is(r, -0) ? '0' : String(r); };

// --- transliteration for the standard fonts -------------------------------------------------------------------------

const CYR = {
  а: 'a', б: 'b', в: 'v', г: 'g', ґ: 'g', д: 'd', е: 'e', ё: 'e', є: 'ye', ж: 'zh', з: 'z', и: 'i', і: 'i', ї: 'yi', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e',
  ю: 'yu', я: 'ya',
};
const GEO = {
  ა: 'a', ბ: 'b', გ: 'g', დ: 'd', ე: 'e', ვ: 'v', ზ: 'z', თ: 't', ი: 'i', კ: "k'", ლ: 'l', მ: 'm', ნ: 'n', ო: 'o', პ: "p'", ჟ: 'zh', რ: 'r',
  ს: 's', ტ: "t'", უ: 'u', ფ: 'p', ქ: 'k', ღ: 'gh', ყ: "q'", შ: 'sh', ჩ: 'ch', ც: 'ts', ძ: 'dz', წ: "ts'", ჭ: "ch'", ხ: 'kh', ჯ: 'j', ჰ: 'h',
};
// WinAnsi (Latin-1) is all the standard fonts can show: Cyrillic/Georgian are transliterated, typographic quotes and
// dashes mapped to ASCII, other accents stripped by NFKD, the rest replaced by '?', so no glyph is ever missing.
export function latin(s) {
  let out = '';
  for (const ch of String(s ?? '')) {
    const lo = ch.toLowerCase();
    if (CYR[lo] != null) { const t = CYR[lo]; out += ch !== lo && t ? t[0].toUpperCase() + t.slice(1) : t; continue; }
    if (GEO[ch] != null) { out += GEO[ch]; continue; }
    out += ch;
  }
  // Latin-1 survives; anything else is decomposed or replaced.
  out = out.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, '-');
  // Latin-1 survives as it is; other letters lose their accents, the rest becomes '?'.
  return [...out].map((c) => (c.charCodeAt(0) <= 0xff ? c : c.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''))).join('').replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
}

const pdfStr = (s) => '(' + latin(s).replace(/[\\()]/g, (m) => '\\' + m) + ')';
// Helvetica advance widths (per 1000 em) of the printable ASCII range, for centred / right-aligned text.
const HW = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
export const textWidth = (s, size, bold) => [...latin(s)].reduce((w, c) => w + (HW[c.charCodeAt(0) - 32] ?? 556) * (bold ? 1.06 : 1), 0) * size / 1000;

const hex = (c) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c || '#000000');
  const v = m ? m[1] : '000000';
  return [0, 2, 4].map((i) => num(parseInt(v.slice(i, i + 2), 16) / 255)).join(' ');
};

// Serialisation: objects are numbered in creation order, byte offsets recorded for the xref table. Offsets equal
// string lengths only because every character is Latin-1 (one byte each), which latin() guarantees for text and
// the binary comment line uses \xe2..\xd3 (marks the file as binary for transfer tools).
export function pdfDoc() {
  const pages = [];
  return {
    page(w, h) {
      const ops = [];
      const pg = {
        w, h, ops,
        moveTo: (x, y) => ops.push(`${num(x)} ${num(y)} m`),
        lineTo: (x, y) => ops.push(`${num(x)} ${num(y)} l`),
        curveTo: (a, b, c, d, e, f) => ops.push(`${num(a)} ${num(b)} ${num(c)} ${num(d)} ${num(e)} ${num(f)} c`),
        close: () => ops.push('h'),
        rect: (x, y, ww, hh) => ops.push(`${num(x)} ${num(y)} ${num(ww)} ${num(hh)} re`),
        polyline(pts, closed) { pts.forEach((p, i) => (i ? pg.lineTo(p[0], p[1]) : pg.moveTo(p[0], p[1]))); if (closed) pg.close(); },
        stroke({ color = '#000000', width = 0.5, dash = null } = {}) { ops.push(`${hex(color)} RG ${num(width)} w ${dash ? `[${dash.map(num).join(' ')}] 0 d` : '[] 0 d'} S`); },
        fill(color = '#000000') { ops.push(`${hex(color)} rg f`); },
        clip: () => ops.push('W n'),
        save: () => ops.push('q'),
        restore: () => ops.push('Q'),
        text(x, y, str, { size = 10, bold = false, align = 'left', color = '#000000' } = {}) {
          const w = textWidth(str, size, bold);
          const dx = align === 'center' ? -w / 2 : align === 'right' ? -w : 0;
          ops.push(`BT /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${hex(color)} rg ${num(x + dx)} ${num(y)} Td ${pdfStr(str)} Tj ET`);
        },
      };
      pages.push(pg);
      return pg;
    },
    bytes() {
      const objs = [];
      const add = (s) => { objs.push(s); return objs.length; };
      const catalog = add(null), pagesObj = add(null);
      const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
      const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
      const kids = [];
      for (const pg of pages) {
        const content = pg.ops.join('\n');
        const cs = add(`<< /Length ${latin1Len(content)} >>\nstream\n${content}\nendstream`);
        kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${num(pg.w)} ${num(pg.h)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${cs} 0 R >>`));
      }
      objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
      objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
      const info = add('<< /Producer (in-html garment/pdf.js) /Title (Pattern) >>');
      let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
      const offsets = [];
      objs.forEach((o, i) => { offsets.push(latin1Len(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
      const xref = latin1Len(out);
      out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
      out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
      const bytes = new Uint8Array(out.length);
      for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
      return bytes;
    },
  };
}
const latin1Len = (s) => s.length;

// --- tiled pattern ---------------------------------------------------------------------------------------------------

const ROWS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const tileName = (r, c) => (r < 26 ? ROWS[r] : ROWS[Math.floor(r / 26) - 1] + ROWS[r % 26]) + (c + 1);

/**
 * Tiled pattern PDF. Pieces are laid out in rows (cm), the layout is cut into tiles of the printable area minus the
 * overlap. Every tile page has: the pieces clipped to its window, the window border, crosses at the corners for
 * alignment, its name (A1, A2, ... rows by letters), the names of its neighbours at the edges and, on A1, the test
 * squares. Page 1 is the assembly overview (the layout scaled to fit, the tile grid, how to check the scale).
 */
// Tiles step by the printable window minus the overlap, so neighbouring pages share a strip for gluing; corner crosses
// and neighbour names make assembly unambiguous; the 5 cm / 2 inch test squares let the user verify the printer did
// not scale ("fit to page" is the classic ruin of home-printed patterns).
export function tiledPDF(d, o = {}) {
  const [pw, ph] = PAPERS[o.paper] || PAPERS.A4;
  const margin = o.margin ?? 1, overlap = o.overlap ?? 1;
  const vw = pw - 2 * margin, vh = ph - 2 * margin; // printable window, cm
  const sx = vw - overlap, sy = vh - overlap;      // step between tiles
  const pieces = d.pieces;
  const lay = layoutRows(pieces, { width: o.width || 100, gap: 2.5, allowance: o.allowance });
  let W = 0, H = 0;
  for (const it of lay) { W = Math.max(W, it.dx + it.box.x1); H = Math.max(H, it.dy + it.box.y1); }
  const top = 6.5; // room for the test squares in tile A1 (they sit above the pieces)
  H += top;
  const cols = Math.max(1, Math.ceil((W - overlap) / sx)), rows = Math.max(1, Math.ceil((H - overlap) / sy));
  const notches = o.notches === false ? [] : seamNotches(d);
  const doc = pdfDoc();
  const P = (cm) => cm * CM;
  const label = o.label || ((p) => ({ title: p.name, lines: [cutText(p)] }));

  // Geometry computed once: cutting line, seam line and the box of every placed piece (layout cm).
  for (const it of lay) {
    it.cut = o.allowance !== false ? cutOutline(it.piece) : null;
    it.ol = outline(it.piece);
    it.win = [it.dx + it.box.x0, it.dy + it.box.y0 + top, it.dx + it.box.x1, it.dy + it.box.y1 + top];
  }
  // Draws the layout (or the pieces meeting a window [x0, y0, x1, y1]) with a transform from layout cm to points.
  const drawLayout = (pg, tf, scale, opts = {}) => {
    const tp = (q) => tf(q[0], q[1]);
    for (const it of lay) {
      if (opts.win && (it.win[2] < opts.win[0] || it.win[0] > opts.win[2] || it.win[3] < opts.win[1] || it.win[1] > opts.win[3])) continue;
      const p = it.piece;
      const mv = (q) => tp([q[0] + it.dx, q[1] + it.dy + top]);
      if (it.cut) { pg.polyline(it.cut.map(mv), true); pg.stroke({ width: opts.thin ? 0.3 : 0.9 }); }
      pg.polyline(it.ol.map(mv), true);
      pg.stroke({ width: opts.thin ? 0.2 : 0.4, dash: opts.thin ? null : [4, 2], color: '#333333' });
      if (opts.thin) continue;
      for (const e of p.edges) if (e.kind === 'dart') { pg.polyline(e.pts.map(mv)); pg.stroke({ width: 0.4 }); }
      for (const m of p.marks) {
        if (m.type === 'line') { pg.polyline(m.pts.map(mv)); pg.stroke({ width: 0.4, dash: m.role === 'pocket' ? null : [3, 2] }); }
        else if (m.type === 'button' || m.type === 'drill') { const c = mv(m.p); circle(pg, c[0], c[1], P(((m.d || 0.6) / 2)) * scale); pg.stroke({ width: 0.4 }); }
        else if (m.type === 'buttonhole') { pg.polyline([mv([m.p[0] - m.w, m.p[1]]), mv(m.p)]); pg.stroke({ width: 0.6 }); }
      }
      if (p.grain) {
        const [a, b] = p.grain.map(mv);
        pg.moveTo(a[0], a[1]); pg.lineTo(b[0], b[1]); pg.stroke({ width: 0.5 });
        arrow(pg, a, b); arrow(pg, b, a);
      }
      for (const nt of notches.filter((n) => n.piece === p.id)) {
        const nn = [nt.dir[1], -nt.dir[0]];
        pg.polyline([mv(nt.p), mv([nt.p[0] + nn[0] * 0.9, nt.p[1] + nn[1] * 0.9])]); pg.stroke({ width: 0.6 });
      }
      const lb = label(p);
      const bx = it.ol.reduce((a, q) => [Math.min(a[0], q[0]), Math.min(a[1], q[1]), Math.max(a[2], q[0]), Math.max(a[3], q[1])], [Infinity, Infinity, -Infinity, -Infinity]);
      const c = mv([(bx[0] + bx[2]) / 2 + (bx[2] - bx[0]) * 0.15, bx[1] + (bx[3] - bx[1]) * 0.42]);
      const size = Math.max(7, Math.min(16, P(Math.min(bx[2] - bx[0], bx[3] - bx[1]) / 9) * scale));
      pg.text(c[0], c[1], lb.title, { size, bold: true, align: 'center' });
      (lb.lines || []).forEach((ln, i) => pg.text(c[0], c[1] - size * 1.25 * (i + 1), ln, { size: size * 0.7, align: 'center', color: '#444444' }));
    }
  };

  // Page 1: overview.
  {
    const pg = doc.page(P(pw), P(ph));
    pg.text(P(margin), P(ph - margin) - 14, o.title || 'Pattern', { size: 16, bold: true });
    const lines = o.instructions || [
      `${rows * cols} tiles in ${rows} rows x ${cols} columns, ${o.paper === 'Letter' ? 'US Letter' : 'A4'}, print at 100% (actual size, no scaling).`,
      'Check the test square on tile A1: it must measure exactly 5 cm (the small one 2 in).',
      `Trim one margin of each tile and overlap ${overlap} cm, matching the crosses and the tile names.`,
    ];
    lines.forEach((t, i) => pg.text(P(margin), P(ph - margin) - 34 - i * 13, t, { size: 9.5 }));
    const boxW = P(vw), boxH = P(vh) - 90;
    const s = Math.min(boxW / P(W), boxH / P(H));
    const ox = P(margin), oy = P(margin);
    const tf = (x, y) => [ox + P(x) * s, oy + boxH - P(y) * s];
    drawLayout(pg, tf, s, { thin: true });
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const [x0, y0] = tf(c * sx, r * sy), [x1, y1] = tf(c * sx + vw, r * sy + vh);
      pg.rect(x0, y1, x1 - x0, y0 - y1); pg.stroke({ width: 0.5, color: '#2563eb', dash: [2, 2] });
      pg.text((x0 + x1) / 2, (y0 + y1) / 2, tileName(r, c), { size: Math.max(6, Math.min(14, (x1 - x0) / 4)), bold: true, align: 'center', color: '#2563eb' });
    }
  }
  // Tiles.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const pg = doc.page(P(pw), P(ph));
      const wx = c * sx, wy = r * sy; // window origin in layout cm
      // layout (x, y down) -> page points (y up), window at the margins.
      const tf = (x, y) => [P(margin + (x - wx)), P(ph - margin - (y - wy))];
      pg.save();
      pg.rect(P(margin), P(margin), P(vw), P(vh)); pg.clip();
      drawLayout(pg, tf, 1, { win: [wx, wy, wx + vw, wy + vh] });
      if (r === 0 && c === 0) testSquares(pg, tf);
      pg.restore();
      pg.rect(P(margin), P(margin), P(vw), P(vh)); pg.stroke({ width: 0.3, color: '#888888' });
      // Overlap zone and crosses.
      pg.rect(P(margin + vw - overlap), P(margin), P(overlap), P(vh)); pg.stroke({ width: 0.2, color: '#bbbbbb', dash: [1, 2] });
      pg.rect(P(margin), P(margin), P(vw), P(overlap)); pg.stroke({ width: 0.2, color: '#bbbbbb', dash: [1, 2] });
      for (const [x, y] of [[margin, margin], [margin + vw, margin], [margin, margin + vh], [margin + vw, margin + vh], [margin + vw - overlap, margin + overlap]]) {
        pg.moveTo(P(x) - 8, P(y)); pg.lineTo(P(x) + 8, P(y)); pg.moveTo(P(x), P(y) - 8); pg.lineTo(P(x), P(y) + 8); pg.stroke({ width: 0.4 });
      }
      const name = tileName(r, c);
      pg.text(P(pw / 2), P(ph - margin / 2) - 4, `${name}   (${r + 1}/${rows}, ${c + 1}/${cols})`, { size: 10, bold: true, align: 'center' });
      if (c + 1 < cols) pg.text(P(pw - margin / 2), P(ph / 2), tileName(r, c + 1) + ' >', { size: 8, align: 'right' });
      if (r + 1 < rows) pg.text(P(pw / 2), P(margin / 2) - 3, 'v ' + tileName(r + 1, c), { size: 8, align: 'center' });
      if (o.title) pg.text(P(margin), P(margin / 2) - 3, o.title, { size: 7, color: '#666666' });
    }
  }
  return doc.bytes();
}

function circle(pg, cx, cy, r) {
  const k = 0.5523 * r;
  pg.moveTo(cx + r, cy);
  pg.curveTo(cx + r, cy + k, cx + k, cy + r, cx, cy + r);
  pg.curveTo(cx - k, cy + r, cx - r, cy + k, cx - r, cy);
  pg.curveTo(cx - r, cy - k, cx - k, cy - r, cx, cy - r);
  pg.curveTo(cx + k, cy - r, cx + r, cy - k, cx + r, cy);
  pg.close();
}

function arrow(pg, from, to) {
  const d = [to[0] - from[0], to[1] - from[1]], L = Math.hypot(d[0], d[1]) || 1, u = [d[0] / L, d[1] / L], n = [-u[1], u[0]];
  pg.polyline([[to[0] - u[0] * 8 + n[0] * 3, to[1] - u[1] * 8 + n[1] * 3], to, [to[0] - u[0] * 8 - n[0] * 3, to[1] - u[1] * 8 - n[1] * 3]]);
  pg.stroke({ width: 0.5 });
}

// 5 cm square and 2 inch square in the top strip of the layout (y from 0.3 to the top offset).
function testSquares(pg, tf) {
  // Drawn in page units at 1:1 from the tile transform: a 5 cm square and a 2 inch square.
  const [x0, y0] = tf(0.4, 0.4);
  const s5 = 5 * CM, s2 = 2 * 72;
  pg.rect(x0, y0 - s5, s5, s5);
  pg.stroke({ width: 0.6 });
  pg.text(x0 + s5 / 2, y0 - s5 / 2 - 3, '5 cm', { size: 9, bold: true, align: 'center' });
  pg.rect(x0 + s5 + 12, y0 - s2, s2, s2);
  pg.stroke({ width: 0.6 });
  pg.text(x0 + s5 + 12 + s2 / 2, y0 - s2 / 2 - 3, '2 in', { size: 9, bold: true, align: 'center' });
}
