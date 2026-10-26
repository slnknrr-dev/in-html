// stitch/pdf.js - printable chart PDF: a cover (title, designer, preview, sizes, fabric, page map), the legend (symbol
// on its colour, thread number and name, strands, stitches, backstitch, knots, beads, skeins) with the shopping list,
// and chart pages (cells with 10-cell grid lines, row and column numbers, centre marks, overlap bands, part stitches,
// backstitch lines, knots, beads, a page map in the header). Symbols are glyphs of a Type 3 font and letters are
// Helvetica-Bold text, so the chart is vector and chart-reading apps see text; colour cells are filled rectangles.
//
//   exportPDF(scheme, opts) -> Uint8Array
//   opts: paper ('a4' | 'a3' | 'a5' | 'letter' | 'legal'), landscape, cellMm (2..8, default 3), overlap (cells),
//         style ('symbols' black on white | 'color' symbols on colour | 'tint' symbols on a pale tint | 'blocks'
//         colour only), cover, legend (default true), count, strands, labels ({ key: text }, see LABELS),
//         rasterText (text, { size, bold }) -> { width, height, scale, ascent, alpha } for scripts the standard fonts
//         lack (otherwise labels are transliterated), footer (text), compress (default true)

// Coordinate system: PDF user space, points (1/72 in), origin bottom-left, y up. Layout is written in mm (MM =
// points per mm) because paper sizes and cell sizes are specified in mm. On chart pages X(x) / Y(y) convert chart
// cells (y down) to points; Y(y) is the TOP edge of row y, so a cell's rectangle starts at Y(y + 1).
// Page order: cover, legend pages, chart pages. The total is needed before any page is written (footer "n / total"),
// which is why the legend layout is computed up front by legendPageCount().
// Labels are injectable (opts.labels) so the app can localise without this module knowing any language.
import { PDFDoc, winAnsi, pdfString, textWidth, transliterate, num as n } from './pdfdoc.js';
import { SYMBOLS, SYMBOL_ORDER, isVector } from './symbols.js';
import { flatten, entryLabel } from './model.js';
import { legend as legendRows, shoppingList, fabricSize, stats as schemeStats } from './estimate.js';
import { paginate, pageCapacity, PAPERS } from './pages.js';
import { hexToRgb, rgbToLab } from './threads.js';

export const LABELS = {
  chart: 'Chart', page: 'Page', of: 'of', rows: 'rows', columns: 'columns', key: 'Key', shopping: 'Shopping list',
  symbol: 'Symbol', number: 'Number', name: 'Name', strands: 'Strands', stitches: 'Stitches', backstitch: 'Backstitch',
  knots: 'Knots', beads: 'Beads', skeins: 'Skeins', size: 'Size', stitchesUnit: 'stitches', finished: 'Finished size',
  fabric: 'Fabric', withMargins: 'with margins', colors: 'Colours', total: 'Stitches', difficulty: 'Difficulty',
  pages: 'Pages', designer: 'Designer', pageMap: 'Page map', blendNote: 'Blends: one strand of each thread in the needle.',
  strandNote: 'Cross stitch: {n} strands; backstitch: 1 strand unless stated.', count: 'count', cm: 'cm', in: 'in',
  generated: 'Made with in-html Embroidery Studio', overlap: 'Shaded rows and columns repeat the neighbouring page.',
  aida: 'Aida', evenweave: 'Evenweave', linen: 'Linen', canvas: 'Canvas', rug: 'Rug canvas',
};

// lum = CIELAB L* (0..100): perceptual lightness, the right criterion for "is black text readable on this colour".
// Luma of gamma-encoded RGB misjudges saturated blues and yellows. Threshold 52 (below) is just under mid-grey.
const MM = 72 / 25.4;
const rgbF = (hex) => hexToRgb(hex).map((v) => n(v / 255)).join(' ');
const lum = (hex) => rgbToLab(hexToRgb(hex))[0];
// Pale tint of a colour for "tint" cells (mix with white).
const tintOf = (hex, k = 0.72) => hexToRgb(hex).map((v) => n((v + (255 - v) * k) / 255)).join(' ');

// Circle from 4 cubic Beziers; k = 0.5523 r is the standard control distance (max radial error ~0.03 %).
// PDF has no circle operator.
function circlePath(cx, cy, r) {
  const k = r * 0.5523;
  return `${n(cx + r)} ${n(cy)} m ${n(cx + r)} ${n(cy + k)} ${n(cx + k)} ${n(cy + r)} ${n(cx)} ${n(cy + r)} c ${n(cx - k)} ${n(cy + r)} ${n(cx - r)} ${n(cy + k)} ${n(cx - r)} ${n(cy)} c ` +
    `${n(cx - r)} ${n(cy - k)} ${n(cx - k)} ${n(cy - r)} ${n(cx)} ${n(cy - r)} c ${n(cx + k)} ${n(cy - r)} ${n(cx + r)} ${n(cy - k)} ${n(cx + r)} ${n(cy)} c h`;
}

export function exportPDF(scheme, opts = {}) {
  const o = { paper: 'a4', landscape: false, cellMm: 3, overlap: 2, style: 'symbols', cover: true, legend: true, compress: true, ...opts };
  const L = { ...LABELS, ...(o.labels || {}) };
  const s = scheme;
  const flat = flatten(s);
  const doc = new PDFDoc({ compress: o.compress, title: s.meta.title || 'Chart', author: s.meta.designer, subject: 'Cross-stitch chart' });
  const FH = doc.helvetica(false), FB = doc.helvetica(true);
  const glyphs = SYMBOL_ORDER.map((id) => ({ name: id, d: SYMBOLS[id].d, unicode: SYMBOLS[id].char }));
  const sym = doc.type3(glyphs);
  let [PW, PH] = (PAPERS[o.paper] || PAPERS.a4).map((v) => v * MM);
  if (o.landscape) [PW, PH] = [PH, PW];
  const M = 10 * MM;

  // --- text helpers (standard fonts, raster masks or transliteration) ---
  // Text strategy, in order: (1) WinAnsi via Helvetica (vector, searchable, zero bytes for the font); (2) the caller's
  // rasterText hook for scripts outside cp1252 (Cyrillic, Georgian, CJK), drawn as a 1-bit image mask in the text
  // colour; (3) transliteration as the last resort. Masks are cached by text|size|bold: legend headers and labels
  // repeat on every page and each mask is an image object. Threshold alpha > 110 of 255 (slightly below half) keeps
  // thin antialiased strokes. maxWidth shrinks the text (font size or mask scale) instead of truncating it.
  const maskCache = new Map();
  function text(str, x, y, size, { bold = false, align = 'left', color = '0 0 0', maxWidth = 0 } = {}) {
    let t = String(str ?? '');
    let bytes = winAnsi(t);
    if (!bytes && o.rasterText) {
      const key = t + '|' + size + '|' + bold;
      let m = maskCache.get(key);
      if (!m) {
        const r = o.rasterText(t, { size, bold });
        if (r && r.width && r.height) {
          const rowBytes = Math.ceil(r.width / 8);
          const bits = new Uint8Array(rowBytes * r.height);
          for (let yy = 0; yy < r.height; yy++) for (let xx = 0; xx < r.width; xx++) if (r.alpha[yy * r.width + xx] > 110) bits[yy * rowBytes + (xx >> 3)] |= 0x80 >> (xx & 7);
          m = { res: doc.mask({ width: r.width, height: r.height, bits }), w: r.width / r.scale, h: r.height / r.scale, asc: (r.ascent ?? r.height * 0.8) / r.scale };
          maskCache.set(key, m);
        }
      }
      if (m) {
        let w = m.w, h = m.h, asc = m.asc;
        if (maxWidth && w > maxWidth) { const k = maxWidth / w; w *= k; h *= k; asc *= k; }
        const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
        return { ops: `q ${color} rg ${n(w)} 0 0 ${n(h)} ${n(x0)} ${n(y + asc - h)} cm /${m.res} Do Q`, width: w };
      }
    }
    if (!bytes) bytes = winAnsi(transliterate(t)) || new Uint8Array(0);
    let w = textWidth(bytes, size, bold), sz = size;
    if (maxWidth && w > maxWidth) { sz = (size * maxWidth) / w; w = maxWidth; }
    const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    return { ops: `BT /${bold ? FB : FH} ${n(sz)} Tf ${color} rg ${n(x0)} ${n(y)} Td ${pdfString(bytes)} Tj ET`, width: w };
  }
  const T = (...a) => text(...a).ops;
  // Greedy word wrap by measured width.
  // Greedy: optimal (Knuth-Plass) breaking is overkill for a description paragraph. A single word longer than the
  // width stays on its own overflowing line rather than being split mid-word.
  function wrap(str, size, width, bold = false) {
    const lines = [];
    for (const para of String(str || '').split(/\n/)) {
      let cur = '';
      for (const w of para.split(/\s+/).filter(Boolean)) {
        const t = cur ? cur + ' ' + w : w;
        if (cur && textWidth(t, size, bold) > width) { lines.push(cur); cur = w; } else cur = t;
      }
      lines.push(cur);
    }
    return lines;
  }

  // A symbol of a palette entry at (x, y) bottom-left, box size bs: Type 3 glyph or Helvetica-Bold letters.
  // Vector symbols take 78 % of the cell (a margin keeps neighbours from touching); letter symbols are Helvetica-Bold,
  // two-letter ones smaller, then scaled to fit 92 % of the box. The vertical offset 0.36 size centres cap height
  // (about 0.72 em for Helvetica) on the box middle.
  function symbolOps(entry, x, y, bs, color) {
    const sm = entry.symbol;
    if (!sm) return '';
    if (isVector(sm)) {
      const code = sym.code(sm);
      if (!code) return '';
      const g = bs * 0.78;
      return `BT /${sym.res} ${n(g)} Tf ${color} rg ${n(x + (bs - g) / 2)} ${n(y + (bs - g) / 2)} Td ${pdfString(new Uint8Array([code]))} Tj ET`;
    }
    const bytes = winAnsi(sm) || winAnsi(transliterate(sm)) || new Uint8Array([63]);
    let size = bs * (bytes.length > 1 ? 0.62 : 0.8);
    const w = textWidth(bytes, size, true);
    if (w > bs * 0.92) size *= (bs * 0.92) / w;
    const tw = textWidth(bytes, size, true);
    return `BT /${FB} ${n(size)} Tf ${color} rg ${n(x + (bs - tw) / 2)} ${n(y + bs * 0.5 - size * 0.36)} Td ${pdfString(bytes)} Tj ET`;
  }
  const symColor = (hex, style) => (style === 'color' || style === 'blocks') && lum(hex) < 52 ? '1 1 1' : '0 0 0';

  // Everything below works on flat (visible layers merged, model.flatten) so the PDF prints what the screen shows.
  const rows = legendRows(s, { count: o.count, strands: o.strands, layer: flat });
  const st = schemeStats(s, flat);
  const fab = fabricSize(s, { count: o.count });
  const cap = pageCapacity({ paper: o.paper, landscape: o.landscape, cellMm: o.cellMm });
  const pg = paginate(s.width, s.height, { cols: cap.cols, rows: cap.rows, overlap: o.overlap });
  const title = s.meta.title || L.chart;
  const footerText = o.footer || L.generated;

  function header(ops, label) {
    ops.push(T(title, M, PH - M - 4 * MM, 11, { bold: true, maxWidth: PW * 0.5 }));
    ops.push(T(label, PW - M, PH - M - 4 * MM, 9, { align: 'right', maxWidth: PW * 0.45 }));
    ops.push(`0.6 G 0.5 w ${n(M)} ${n(PH - M - 7 * MM)} m ${n(PW - M)} ${n(PH - M - 7 * MM)} l S`);
  }
  function footer(ops, pageNo, total) {
    ops.push(`0.75 G 0.4 w ${n(M)} ${n(M + 5 * MM)} m ${n(PW - M)} ${n(M + 5 * MM)} l S`);
    const left = [s.meta.designer, s.meta.license].filter(Boolean).join(' · ') || footerText;
    ops.push(T(left, M, M + 1.5 * MM, 7, { color: '0.35 0.35 0.35', maxWidth: PW * 0.6 }));
    ops.push(T(`${pageNo} / ${total}`, PW - M, M + 1.5 * MM, 7, { align: 'right', color: '0.35 0.35 0.35' }));
  }

  // Hoisted function declaration: legendPageCount is defined further down but callable here.
  const totalPages = (o.cover ? 1 : 0) + pg.pages.length + (o.legend ? legendPageCount() : 0);
  let pageNo = 0;

  // --- cover ---
  if (o.cover) {
    pageNo++;
    const ops = [];
    let y = PH - M - 12 * MM;
    for (const line of wrap(title, 22, PW - 2 * M, true).slice(0, 3)) { ops.push(T(line, M, y, 22, { bold: true })); y -= 9 * MM; }
    if (s.meta.designer) { ops.push(T(L.designer + ': ' + s.meta.designer, M, y, 11, { color: '0.3 0.3 0.3' })); y -= 6 * MM; }
    // The image is width x height pixels and scaled up by the cm matrix; Interpolate stays false (pdfdoc default) so
    // viewers keep hard stitch edges instead of blurring. A cell with fractional stitches shows the colour of its last
    // part, a deliberate simplification at preview scale.
    // Preview: one pixel per stitch (fabric colour where empty), fitted into a box.
    const boxW = PW - 2 * M, boxH = PH * 0.42;
    const k = Math.min(boxW / s.width, boxH / s.height);
    const iw = s.width * k, ih = s.height * k;
    const ix = M + (boxW - iw) / 2, iy = y - 4 * MM - ih;
    const rgb = new Uint8Array(s.width * s.height * 3);
    const fabRgb = hexToRgb(s.fabric.color);
    const pal = s.palette.map((e) => hexToRgb(e.hex));
    for (let i = 0; i < s.width * s.height; i++) { const v = flat.cells[i]; const c = v ? pal[v - 1] : fabRgb; rgb[i * 3] = c[0]; rgb[i * 3 + 1] = c[1]; rgb[i * 3 + 2] = c[2]; }
    for (const p of flat.parts) { const i = p.y * s.width + p.x; const c = pal[p.p]; rgb[i * 3] = c[0]; rgb[i * 3 + 1] = c[1]; rgb[i * 3 + 2] = c[2]; }
    const im = doc.image({ width: s.width, height: s.height, rgb });
    ops.push(`q ${n(iw)} 0 0 ${n(ih)} ${n(ix)} ${n(iy)} cm /${im} Do Q`);
    ops.push(`0.4 G 0.6 w ${n(ix)} ${n(iy)} ${n(iw)} ${n(ih)} re S`);
    // Page map over the preview.
    if (pg.pages.length > 1) {
      ops.push('0.85 0.1 0.1 RG 0.8 w');
      for (const p of pg.pages) {
        const x0 = ix + p.x0 * k, x1 = ix + p.x1 * k, y1 = iy + ih - p.y0 * k, y0 = iy + ih - p.y1 * k;
        ops.push(`${n(x0)} ${n(y0)} ${n(x1 - x0)} ${n(y1 - y0)} re S`);
        ops.push(T(String(p.n + 1 + (o.legend ? legendPageCount() : 0)), (x0 + x1) / 2, (y0 + y1) / 2 - 3, 8, { bold: true, align: 'center', color: '0.85 0.1 0.1' }));
      }
    }
    y = iy - 9 * MM;
    const kindName = L[s.fabric.kind] || s.fabric.kind;
    const info = [
      [L.size, `${s.width} × ${s.height} ${L.stitchesUnit}`],
      [L.finished, `${fab.finishedCm[0]} × ${fab.finishedCm[1]} ${L.cm} (${fab.finishedIn[0]} × ${fab.finishedIn[1]} ${L.in}), ${kindName} ${o.count || s.fabric.count} ${L.count}`],
      [L.fabric, `${fab.fabricCm[0]} × ${fab.fabricCm[1]} ${L.cm} ${L.withMargins}`],
      [L.colors, String(s.palette.length) + (st.blends ? ` (${st.blends} blends)` : '')],
      [L.total, String(Math.round(st.stitches)) + (st.backLength ? ` · ${L.backstitch}: ${Math.round(st.backLength)}` : '')],
      [L.difficulty, `${s.meta.difficulty || st.difficulty} / 5`],
      [L.pages, `${pg.pages.length} (${pg.across} × ${pg.down})`],
    ];
    for (const [k1, v] of info) {
      ops.push(T(k1, M, y, 10, { bold: true }));
      ops.push(T(v, M + 45 * MM, y, 10, { maxWidth: PW - 2 * M - 45 * MM }));
      y -= 5.5 * MM;
    }
    if (s.meta.description) {
      y -= 2 * MM;
      for (const line of wrap(s.meta.description, 9.5, PW - 2 * M).slice(0, Math.max(0, Math.floor((y - M - 10 * MM) / (4.6 * MM))))) { ops.push(T(line, M, y, 9.5, { color: '0.2 0.2 0.2' })); y -= 4.6 * MM; }
    }
    footer(ops, pageNo, totalPages);
    doc.addPage(PW, PH, ops.join('\n'));
  }

  // --- legend ---
  // Pure function of the scheme, so calling it twice (count, then render) gives the same paging. The legend and the
  // shopping list flow through one item list so the shopping list continues on the same page when there is room.
  // Performance note: it recomputes the shopping list on every call, and the cover page map calls legendPageCount()
  // once per chart page. Fine for typical page counts; cache the result if charts with hundreds of pages appear.
  function legendLayout() {
    const rowH = 6 * MM;
    const top = PH - M - 14 * MM, bottom = M + 12 * MM;
    const perPage = Math.max(1, Math.floor((top - bottom) / rowH) - 2);
    const shop = shoppingList(s, { count: o.count, strands: o.strands });
    const items = [{ head: L.key }, ...rows.map((r) => ({ row: r })), { gap: true }, { head: L.shopping }, ...shop.map((x) => ({ shop: x }))];
    const pages = [];
    for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage));
    return { pages, rowH, top };
  }
  function legendPageCount() { return legendLayout().pages.length; }
  if (o.legend) {
    const { pages, rowH, top } = legendLayout();
    // Column x positions designed for a 190 mm text width (A4 minus margins) and scaled proportionally to the paper.
    const cols = [0, 14, 44, 104, 124, 146, 166, 176].map((v) => M + v * MM * ((PW - 2 * M) / (190 * MM)));
    const fmt = (v) => (v ? String(Math.round(v * 10) / 10) : '');
    for (const items of pages) {
      pageNo++;
      const ops = [];
      header(ops, L.key);
      let y = top;
      const strandsN = o.strands || (s.palette[0] && s.palette[0].strands) || 2;
      ops.push(T(L.strandNote.replace('{n}', strandsN) + (s.palette.some((e) => e.blend) ? ' ' + L.blendNote : ''), M, y, 8.5, { color: '0.25 0.25 0.25', maxWidth: PW - 2 * M }));
      y -= rowH;
      for (const it of items) {
        if (it.gap) { y -= rowH * 0.5; continue; }
        if (it.head) {
          ops.push(T(it.head, M, y, 11, { bold: true }));
          y -= rowH * 0.9;
          const heads = it.head === L.key ? [L.symbol, L.number, L.name, L.strands, L.stitches, L.backstitch, L.skeins] : ['', L.number, L.name, '', L.stitches, '', L.skeins];
          heads.forEach((h, i) => { if (h) ops.push(T(h, cols[i] + (i >= 3 ? 0 : 0), y, 7.5, { bold: true, color: '0.3 0.3 0.3', maxWidth: cols[i + 1] - cols[i] - 2 })); });
          ops.push(`0.5 G 0.5 w ${n(M)} ${n(y - 1.6 * MM)} m ${n(PW - M)} ${n(y - 1.6 * MM)} l S`);
          y -= rowH;
          continue;
        }
        if (it.row) {
          const r = it.row, e = r.entry;
          const bs = 4.6 * MM, bx = cols[0], by = y - 1.4 * MM;
          ops.push(`${rgbF(e.hex)} rg ${n(bx)} ${n(by)} ${n(bs)} ${n(bs)} re f 0.4 G 0.4 w ${n(bx)} ${n(by)} ${n(bs)} ${n(bs)} re S`);
          ops.push(symbolOps(e, bx, by, bs, lum(e.hex) < 52 ? '1 1 1' : '0 0 0'));
          if (e.symbol) ops.push(`1 1 1 rg ${n(bx + bs + 1.5 * MM)} ${n(by)} ${n(bs)} ${n(bs)} re f 0.4 G ${n(bx + bs + 1.5 * MM)} ${n(by)} ${n(bs)} ${n(bs)} re S
` + symbolOps(e, bx + bs + 1.5 * MM, by, bs, '0 0 0'));
          ops.push(T(entryLabel(e), cols[1], y, 8.5, { bold: true, maxWidth: cols[2] - cols[1] - 2 }));
          ops.push(T(e.name || '', cols[2], y, 8.5, { maxWidth: cols[3] - cols[2] - 2 }));
          ops.push(T(e.blend ? e.blend.map(() => '1').join('+') : String(r.strands || e.strands), cols[3], y, 8.5));
          const parts = [r.full ? fmt(r.full) + ' ×' : '', r.half ? fmt(r.half) + ' ½' : '', r.three ? fmt(r.three) + ' ¾' : '', r.quarter ? fmt(r.quarter) + ' ¼' : '', r.petite ? fmt(r.petite) + ' p' : '', r.knots ? r.knots + ' •' : '', r.beads ? r.beads + ' o' : ''].filter(Boolean).join('  ');
          ops.push(T(parts, cols[4], y, 8, { maxWidth: cols[5] - cols[4] - 2 }));
          ops.push(T(r.back + r.straight ? Math.round(((r.back + r.straight) * 2.54) / (o.count || s.fabric.count)) + ' ' + L.cm : '', cols[5], y, 8));
          ops.push(T(r.skeins ? String(r.skeins) : '', cols[6], y, 8.5, { bold: true }));
          y -= rowH;
          continue;
        }
        if (it.shop) {
          const x = it.shop;
          ops.push(`${rgbF(x.hex)} rg ${n(cols[0])} ${n(y - 1.4 * MM)} ${n(4.6 * MM)} ${n(4.6 * MM)} re f`);
          ops.push(T((x.brand ? x.brand + ' ' : '') + x.code, cols[1], y, 8.5, { bold: true, maxWidth: cols[2] - cols[1] - 2 }));
          ops.push(T(x.name || '', cols[2], y, 8.5, { maxWidth: cols[4] - cols[2] - 2 }));
          ops.push(T(fmt(x.stitches), cols[4], y, 8));
          ops.push(T(x.bead ? String(x.beads) : String(x.skeins), cols[6], y, 8.5, { bold: true }));
          y -= rowH;
        }
      }
      footer(ops, pageNo, totalPages);
      doc.addPage(PW, PH, ops.join('\n'));
    }
  }

  // --- chart pages ---
  const cs = o.cellMm * MM;
  const numW = 6 * MM;
  // Index fractional stitches by cell once, instead of filtering all parts per page.
  const partsByCell = new Map();
  for (const p of flat.parts) { const k = p.y * s.width + p.x; if (!partsByCell.has(k)) partsByCell.set(k, []); partsByCell.get(k).push(p); }
  const cx = s.width / 2, cy = s.height / 2;
  const style = o.style;
  for (const p of pg.pages) {
    pageNo++;
    const ops = [];
    const cols = p.x1 - p.x0, rowsN = p.y1 - p.y0;
    const gw = cols * cs, gh = rowsN * cs;
    const gx = M + numW + Math.max(0, (PW - 2 * M - 2 * numW - gw) / 2);
    const gyTop = PH - M - 9 * MM - numW;
    const X = (x) => gx + (x - p.x0) * cs, Y = (y) => gyTop - (y - p.y0) * cs; // y: top edge of row y
    header(ops, `${L.page} ${p.row}-${p.col} · ${L.rows} ${p.y0 + 1}–${p.y1} · ${L.columns} ${p.x0 + 1}–${p.x1}`);
    // Mini page map in the header.
    if (pg.pages.length > 1) {
      const mk = Math.min(3.2 * MM, (24 * MM) / Math.max(pg.across, pg.down));
      const mx = PW / 2 - (pg.across * mk) / 2;
      const mh = Math.min(5.6 * MM / pg.down, mk);
      for (const q of pg.pages) {
        const x0 = mx + (q.col - 1) * mk, y0 = PH - M - 1 * MM - q.row * mh;
        ops.push(`${q === p ? '0.85 0.1 0.1 rg' : '0.88 g'} ${n(x0)} ${n(y0)} ${n(mk - 0.6)} ${n(mh - 0.6)} re f`);
      }
    }
    // Paint order is the z-order: fills, parts, overlap shading, grid, symbols, lines and knots on top, numbers last.
    // Rectangles are grouped by colour so each colour is one rg + many re + one f: a fill-colour change per cell would
    // multiply the content stream and slow down viewers.
    // 1. Cell fills.
    if (style !== 'symbols') {
      const byColor = new Map();
      for (let y = p.y0; y < p.y1; y++) for (let x = p.x0; x < p.x1; x++) {
        const v = flat.cells[y * s.width + x];
        if (!v) continue;
        if (!byColor.has(v)) byColor.set(v, []);
        byColor.get(v).push(`${n(X(x))} ${n(Y(y + 1))} ${n(cs)} ${n(cs)} re`);
      }
      for (const [v, rects] of byColor) {
        const hex = s.palette[v - 1].hex;
        ops.push(`${style === 'tint' ? tintOf(hex) : rgbF(hex)} rg\n${rects.join('\n')}\nf`);
      }
    }
    // 2. Part stitches: coloured shapes (or outlines in black-and-white charts).
    // half: a parallelogram band along the diagonal (0.22 cell wide at the ends) rather than a stroked line, so it is
    // filled with the same operator as everything else and stays visible at small cell sizes.
    // three: the triangle on the corner's side (the corner plus its two neighbours). quarter / petite: the corner square.
    // In black-and-white charts parts are light grey (0.85 g) so the symbol on top stays readable.
    const partShape = (q) => {
      const x0 = X(q.x), x1 = X(q.x + 1), yt = Y(q.y), yb = Y(q.y + 1), xm = (x0 + x1) / 2, ym = (yt + yb) / 2;
      const corner = { tl: [x0, yt], tr: [x1, yt], bl: [x0, yb], br: [x1, yb] };
      if (q.k === 'half') return q.c === '/' ? `${n(x0)} ${n(yb)} m ${n(x0 + cs * 0.22)} ${n(yb)} l ${n(x1)} ${n(yt - cs * 0.22)} l ${n(x1)} ${n(yt)} l ${n(x1 - cs * 0.22)} ${n(yt)} l ${n(x0)} ${n(yb + cs * 0.22)} l h`
        : `${n(x0)} ${n(yt)} m ${n(x0 + cs * 0.22)} ${n(yt)} l ${n(x1)} ${n(yb + cs * 0.22)} l ${n(x1)} ${n(yb)} l ${n(x1 - cs * 0.22)} ${n(yb)} l ${n(x0)} ${n(yt - cs * 0.22)} l h`;
      if (q.k === 'three') {
        const others = { tl: ['tr', 'bl'], tr: ['tl', 'br'], bl: ['tl', 'br'], br: ['tr', 'bl'] }[q.c];
        const a = corner[q.c], b = corner[others[0]], c = corner[others[1]];
        return `${n(a[0])} ${n(a[1])} m ${n(b[0])} ${n(b[1])} l ${n(c[0])} ${n(c[1])} l h`;
      }
      const qx = q.c.endsWith('r') ? xm : x0, qy = q.c.startsWith('b') ? yb : ym;
      return `${n(qx)} ${n(qy)} ${n(cs / 2)} ${n(cs / 2)} re`;
    };
    const pageParts = [];
    for (const [k, list] of partsByCell) { const x = k % s.width, y = (k / s.width) | 0; if (x >= p.x0 && x < p.x1 && y >= p.y0 && y < p.y1) pageParts.push(...list); }
    for (const q of pageParts) {
      const hex = s.palette[q.p].hex;
      if (style === 'symbols') ops.push(`0.85 g ${partShape(q)} f`);
      else ops.push(`${style === 'tint' ? tintOf(hex, 0.45) : rgbF(hex)} rg ${partShape(q)} f`);
    }
    // Translucent (ExtGState alpha 0.16) so fills and symbols under the band remain visible. The vertical band is
    // shortened by the horizontal band's height, so the corner square is not shaded twice (darker).
    // 3. Overlap bands.
    if (p.ox0 || p.oy0) {
      ops.push(`q /${doc.alpha(0.16)} gs 0.3 0.3 0.3 rg`);
      if (p.oy0) ops.push(`${n(gx)} ${n(Y(p.y0 + p.oy0))} ${n(gw)} ${n(p.oy0 * cs)} re f`);
      if (p.ox0) ops.push(`${n(gx)} ${n(Y(p.y1))} ${n(p.ox0 * cs)} ${n(gh - p.oy0 * cs)} re f`);
      ops.push('Q');
    }
    // x % 10 on absolute coordinates: thick lines stay on the same chart columns across pages, which is how stitchers
    // count. Lines are batched into one path per weight, two S operators per page.
    // 4. Grid: thin lines, then every tenth line (counted on the whole chart) thick.
    const thin = [], thick = [];
    for (let x = p.x0; x <= p.x1; x++) (x % 10 === 0 ? thick : thin).push(`${n(X(x))} ${n(Y(p.y0))} m ${n(X(x))} ${n(Y(p.y1))} l`);
    for (let y = p.y0; y <= p.y1; y++) (y % 10 === 0 ? thick : thin).push(`${n(X(p.x0))} ${n(Y(y))} m ${n(X(p.x1))} ${n(Y(y))} l`);
    ops.push(`0.55 G 0.18 w\n${thin.join('\n')}\nS`);
    ops.push(`0 G 0.75 w\n${thick.join('\n')}\nS`);
    ops.push(`0 G 0.9 w ${n(gx)} ${n(Y(p.y1))} ${n(gw)} ${n(gh)} re S`);
    // 5. Symbols.
    if (style !== 'blocks') {
      for (let y = p.y0; y < p.y1; y++) for (let x = p.x0; x < p.x1; x++) {
        const v = flat.cells[y * s.width + x];
        if (!v) continue;
        const e = s.palette[v - 1];
        ops.push(symbolOps(e, X(x), Y(y + 1), cs, symColor(e.hex, style)));
      }
      for (const q of pageParts) {
        const e = s.palette[q.p];
        const half = cs * 0.5;
        const x0 = X(q.x), yb = Y(q.y + 1);
        let bx = x0 + cs * 0.25, by = yb + cs * 0.25;
        if (q.k === 'quarter' || q.k === 'petite' || q.k === 'three') { bx = q.c.endsWith('r') ? x0 + half : x0; by = q.c.startsWith('b') ? yb : yb + half; }
        ops.push(symbolOps(e, bx, by, half, symColor(e.hex, style)));
      }
    }
    // Each line is clipped to the grid (re W n) so a line leaving the page does not draw over the margin or numbers.
    // Light colours (L* > 75) are drawn grey: a white backstitch would vanish on white paper.
    // KNOWN DEFECT: a line is drawn only if one of its endpoints is on the page; a long straight stitch that crosses a
    // page with both endpoints on other pages is missing from that page. Fix: test the segment against the page
    // rectangle (e.g. Liang-Barsky or a bounding-box overlap test) instead of the endpoints.
    // 6. Lines, knots, beads.
    const inPage = (x, y) => x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1;
    for (const l of flat.lines) {
      if (!inPage(l.x1, l.y1) && !inPage(l.x2, l.y2)) continue;
      const e = s.palette[l.p];
      const c = lum(e.hex) > 75 ? '0.35 0.35 0.35' : rgbF(e.hex);
      ops.push(`q ${n(gx)} ${n(Y(p.y1))} ${n(gw)} ${n(gh)} re W n ${c} RG ${l.k === 'straight' ? '0.9' : '1.3'} w 1 J 1 j ${n(X(l.x1))} ${n(Y(l.y1))} m ${n(X(l.x2))} ${n(Y(l.y2))} l S Q`);
    }
    for (const k of flat.knots) if (inPage(k.x, k.y)) { const e = s.palette[k.p]; ops.push(`${rgbF(e.hex)} rg 0 G 0.4 w ${circlePath(X(k.x), Y(k.y), cs * 0.26)} B`); }
    for (const b of flat.beads) if (inPage(b.x, b.y)) { const e = s.palette[b.p]; ops.push(`${rgbF(e.hex)} rg 0 G 0.5 w ${circlePath(X(b.x), Y(b.y), cs * 0.36)} B 1 1 1 rg ${circlePath(X(b.x) - cs * 0.1, Y(b.y) + cs * 0.1, cs * 0.08)} f`); }
    // Numbers on all four sides, every 10 cells, from absolute coordinates; 0 is skipped (the edge needs no label).
    // Centre marks: red triangles pointing at the middle row / column, the standard way to find the starting point.
    // 7. Row / column numbers every ten cells, centre marks.
    for (let x = Math.ceil(p.x0 / 10) * 10; x <= p.x1; x += 10) {
      if (x === 0) continue;
      ops.push(T(String(x), X(x), Y(p.y0) + 1.6 * MM, 6.5, { align: 'center', color: '0.2 0.2 0.2' }));
      ops.push(T(String(x), X(x), Y(p.y1) - 3.6 * MM, 6.5, { align: 'center', color: '0.2 0.2 0.2' }));
    }
    for (let y = Math.ceil(p.y0 / 10) * 10; y <= p.y1; y += 10) {
      if (y === 0) continue;
      ops.push(T(String(y), X(p.x0) - 1.2 * MM, Y(y) - 2.2, 6.5, { align: 'right', color: '0.2 0.2 0.2' }));
      ops.push(T(String(y), X(p.x1) + 1.2 * MM, Y(y) - 2.2, 6.5, { color: '0.2 0.2 0.2' }));
    }
    const tri = (pts) => `${pts.map(([a, b], i) => `${n(a)} ${n(b)} ${i ? 'l' : 'm'}`).join(' ')} h f`;
    const a = 1.8 * MM;
    if (cx >= p.x0 && cx <= p.x1) {
      const xx = X(cx);
      ops.push('0.85 0.1 0.1 rg ' + tri([[xx - a / 2, Y(p.y0) + a + 0.5], [xx + a / 2, Y(p.y0) + a + 0.5], [xx, Y(p.y0) + 0.5]]));
      ops.push('0.85 0.1 0.1 rg ' + tri([[xx - a / 2, Y(p.y1) - a - 0.5], [xx + a / 2, Y(p.y1) - a - 0.5], [xx, Y(p.y1) - 0.5]]));
    }
    if (cy >= p.y0 && cy <= p.y1) {
      const yy = Y(cy);
      ops.push('0.85 0.1 0.1 rg ' + tri([[X(p.x0) - a - 0.5, yy + a / 2], [X(p.x0) - a - 0.5, yy - a / 2], [X(p.x0) - 0.5, yy]]));
      ops.push('0.85 0.1 0.1 rg ' + tri([[X(p.x1) + a + 0.5, yy + a / 2], [X(p.x1) + a + 0.5, yy - a / 2], [X(p.x1) + 0.5, yy]]));
    }
    if (p.ox0 || p.oy0) ops.push(T(L.overlap, gx, Y(p.y1) - 7.5 * MM, 7, { color: '0.4 0.4 0.4', maxWidth: gw }));
    footer(ops, pageNo, totalPages);
    doc.addPage(PW, PH, ops.join('\n'));
  }
  return doc.finish();
}
