// embroidery-studio/common.js - helpers shared by the screens: the artifact mode, titles of catalogue items,
// thumbnails, sizes, difficulty marks, exports (PDF with translated labels, OXS, JSON, PNG, SVG), printing,
// thread lookups for legends in another brand, and small DOM pieces.

//
// Rule: the chart itself is always drawn by stitch/render.js (screen, PNG export, thumbnails), so every output shows
// the same symbols and colours. Demo items carry no text of their own: their titles and descriptions are i18n keys
// (demo.<id>.title), so the built-in catalogue is translated like the UI.
import { h } from '../ui/dom.js';
import { t, UI_STATE } from '../ui/i18n.js';
import { iconEl } from '../ui/icons.js';
import { download } from '../ui/app.js';
import { toast } from '../ui/overlays.js';
import { toJSON, flatten, entryLabel } from '../stitch/model.js';
import { writeOXS } from '../stitch/oxs.js';
import { exportPDF, LABELS } from '../stitch/pdf.js';
import { toSVG } from '../stitch/image.js';
import { colorBitmap, drawChart } from '../stitch/render.js';
import { fabricSize } from '../stitch/estimate.js';
import { BRANDS, catalog, findThread, crossReference } from '../stitch/threads.js';
import { settings } from './store.js';

export function artifactMode() {
  const a = globalThis.IN_HTML_ARTIFACT;
  return a && a.mode ? a.mode : 'dev';
}

export const isDemo = (item) => item && item.src === 'demo';
export function itemTitle(item) {
  if (!item) return '';
  if (item.src === 'demo') return t('demo.' + item.id + '.title');
  return item.title || t('es.untitled');
}
export function itemDescription(item) {
  if (item && item.src === 'demo') return t('demo.' + item.id + '.desc');
  return (item && item.description) || '';
}
export const categoryName = (c) => (c ? t('cat.' + c) : t('cat.other'));
// Tags are free text. A tag with a translation key shows the translation; otherwise t() returns its humanised
// fallback for the missing key, which is detected and replaced by the original tag (user spelling preserved).
export function tagName(tag) {
  const key = 'tag.' + String(tag).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const v = t(key);
  return v === humanizeTag(key) ? tag : v;
}
const humanizeTag = (key) => { const s = key.slice(4).replace(/-/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); };

// A thumbnail PNG data URL of a scheme (one block per stitch on the fabric colour).
// Integer scale k (whole pixels per stitch) with smoothing off: every stitch becomes a crisp k x k block. The colour
// layer comes as a 1-pixel-per-stitch bitmap and is scaled up by drawImage, much faster than k*k fillRects.
export function thumbURL(scheme, size = 180) {
  const layer = flatten(scheme);
  const k = Math.max(1, Math.floor(size / Math.max(scheme.width, scheme.height)));
  const c = document.createElement('canvas');
  c.width = Math.max(1, scheme.width * k);
  c.height = Math.max(1, scheme.height * k);
  const g = c.getContext('2d');
  g.fillStyle = scheme.fabric.color || '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingEnabled = false;
  g.drawImage(colorBitmap(scheme, layer), 0, 0, c.width, c.height);
  // Lines, knots and beads on top (thin, so they read at thumbnail size).
  g.lineCap = 'round';
  g.lineWidth = Math.max(1, k * 0.35);
  for (const l of layer.lines) { g.strokeStyle = scheme.palette[l.p].hex; g.beginPath(); g.moveTo(l.x1 * k, l.y1 * k); g.lineTo(l.x2 * k, l.y2 * k); g.stroke(); }
  for (const o of [...layer.knots, ...layer.beads]) { g.fillStyle = scheme.palette[o.p].hex; g.beginPath(); g.arc(o.x * k, o.y * k, Math.max(1, k * 0.4), 0, Math.PI * 2); g.fill(); }
  return c.toDataURL('image/png');
}

export function difficultyEl(n) {
  const v = Math.max(1, Math.min(5, n || 1));
  return h('span', { class: 'es-diff', title: t('es.difficulty') + ': ' + t('diff.' + v), 'aria-label': t('es.difficulty') + ': ' + t('diff.' + v) },
    Array.from({ length: 5 }, (_, i) => h('i', { class: i < v ? 'on' : '' })));
}

// Fabric "count" = stitches per inch; size in cm = stitches / count * 2.54 (computed as *25.4 then /10 to round to
// one decimal).
export function sizeText(w, h, count = settings().count) {
  const cm = (n) => (Math.round((n / count) * 25.4) / 10).toLocaleString(UI_STATE.lang);
  return t('es.sizeCm', { w: cm(w), h: cm(h), count });
}
export const fmtNum = (n) => Math.round(n).toLocaleString(UI_STATE.lang);
export function fabricText(scheme, count) {
  const f = fabricSize(scheme, { count, margin: 5 });
  return t('es.fabricCm', { w: f.fabricCm[0].toLocaleString(UI_STATE.lang), h: f.fabricCm[1].toLocaleString(UI_STATE.lang) });
}

export function chip(text, extra = {}) { return h('span', { class: 'ed-chip es-chip', ...extra }, text); }
export function iconBtn(ic, label, onclick, extra = {}) {
  return h('button', { type: 'button', class: 'ed-iconbtn es-ib', title: label, 'aria-label': label, onclick, ...extra }, iconEl(ic));
}

// --- exports -----------------------------------------------------------------------------------------------------

// File names without characters forbidden on Windows (\ / : * ? " < > |), whitespace collapsed, max 80 chars.
export const safeName = (s) => String(s || 'scheme').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'scheme';

// Labels of the PDF in the UI language (the PDF rasterizes scripts the standard fonts lack).
export function pdfLabels() {
  const out = {};
  for (const k of Object.keys(LABELS)) out[k] = t('pdf.' + k);
  return out;
}

// Correction to the line above: the code keeps an 8-bit alpha value per pixel (not 1 bit) and renders at 6 px per
// point (scale = 6). The 14 standard PDF fonts cover only Latin-1, so non-Latin labels are drawn on a canvas and
// embedded as image masks; ascent comes from actualBoundingBox metrics so the baseline aligns with real PDF text.
// Canvas rasterizer of labels for the PDF (Cyrillic, Georgian…): 1 bit per pixel at 8 px per point.
export function rasterText(text, { size, bold }) {
  const scale = 6;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = `${bold ? 700 : 400} ${size * scale}px Arial, "Helvetica Neue", "Noto Sans", "Noto Sans Georgian", Sylfaen, sans-serif`;
  g.font = font;
  const m = g.measureText(text);
  const asc = Math.ceil(m.actualBoundingBoxAscent || size * scale * 0.8), desc = Math.ceil(m.actualBoundingBoxDescent || size * scale * 0.25);
  c.width = Math.max(1, Math.ceil(m.width) + 2);
  c.height = Math.max(1, asc + desc + 2);
  g.font = font;
  g.fillStyle = '#000';
  g.textBaseline = 'alphabetic';
  g.fillText(text, 1, asc + 1);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const alpha = new Uint8Array(c.width * c.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = d[i * 4 + 3];
  return { width: c.width, height: c.height, scale, ascent: asc + 1, alpha };
}

export function makePDF(scheme, opts = {}) {
  const st = settings();
  return exportPDF(scheme, {
    paper: st.paper, landscape: st.landscape, cellMm: st.cellMm, overlap: st.overlap, style: st.pdfStyle, count: st.count, strands: st.strands,
    labels: pdfLabels(), rasterText, ...opts,
  });
}

export async function exportScheme(scheme, kind, opts = {}) {
  const name = safeName(scheme.meta.title);
  try {
    if (kind === 'pdf') download(makePDF(scheme, opts), name + '.pdf', 'application/pdf');
    else if (kind === 'oxs') download(writeOXS(scheme), name + '.oxs', 'application/xml');
    else if (kind === 'json') download(toJSON(scheme, { pretty: false }), name + '.stitch.json', 'application/json');
    else if (kind === 'svg') download(toSVG(scheme, { cell: 12, mode: settings().mode === 'realistic' ? 'colorSymbols' : settings().mode }), name + '.svg', 'image/svg+xml');
    else if (kind === 'png') {
      const blob = await chartPNG(scheme, { cell: opts.cell || 16 });
      download(blob, name + '.png', 'image/png');
    }
    return true;
  } catch (e) {
    toast(t('err.export', { msg: e.message }), 'error');
    return false;
  }
}

// PNG of the chart drawn by the same renderer as the screen (symbols as on screen).
// Cell size shrinks for big charts so the longer side stays under 16000 px (browsers cap canvas dimensions and
// area; beyond that toBlob returns null). +1 px leaves room for the closing grid line.
export function chartPNG(scheme, { cell = 16, mode = settings().mode, done = null } = {}) {
  const layer = flatten(scheme);
  const max = 16000;
  const k = Math.max(2, Math.min(cell, Math.floor(max / Math.max(scheme.width, scheme.height))));
  const c = document.createElement('canvas');
  c.width = scheme.width * k + 1;
  c.height = scheme.height * k + 1;
  const g = c.getContext('2d');
  drawChart(g, scheme, { x: 0, y: 0, cell: k, width: c.width, height: c.height }, { mode, layer, grid: true, done });
  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
}

// Prints the chart PDF through the browser's PDF viewer (a hidden frame; a new tab when frames cannot print).
// Printing a generated PDF: load it into a hidden iframe and call print() on the frame, so the browser's PDF viewer
// handles paging and paper size. Cross-origin or blocked frames throw, and the PDF opens in a new tab instead.
// The blob URL is revoked after a minute (the print dialog may still be reading it before that).
export function printScheme(scheme, opts = {}) {
  const bytes = makePDF(scheme, opts);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const frame = h('iframe', { class: 'es-printframe', src: url, title: 'print' });
  document.body.append(frame);
  frame.addEventListener('load', () => {
    try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch { window.open(url, '_blank'); }
    setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 60000);
  });
}

// --- threads in another brand -------------------------------------------------------------------------------------

export const brandList = () => BRANDS.map((b) => ({ v: b.id, l: '=' + b.brand }));

// The equivalent thread label of a palette entry in brand `id` ('' for the entry's own brand).
// Brand conversion via the cross-reference table (nearest thread by colour difference). Blends (two threads in
// one needle) convert only if every part has an equivalent; otherwise null rather than a half-converted label.
export function equivalent(entry, id) {
  if (!id || entry.catalog === id || !entry.catalog) return null;
  const one = (code, cat) => { const th = findThread(cat || entry.catalog, code); if (!th) return null; const r = crossReference(th, id, { n: 1 }); return r[0] ? r[0].thread : null; };
  if (entry.blend) {
    const ts = entry.blend.map((b) => one(b.code, b.catalog));
    return ts.every(Boolean) ? { code: ts.map((x) => x.code).join('+'), name: ts.map((x) => x.name).join(' + '), brand: ts[0].brand, hex: entry.hex } : null;
  }
  return one(entry.code);
}

export const catalogName = (id) => (catalog(id) || {}).brand || id;
export { entryLabel };
