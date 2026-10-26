// barcode-studio/batch.js - the batch page: many codes at once from a pasted list (one value per line, an optional
// caption after a tab or ';') or a numbered sequence (prefix, start, step, count, zero padding; GTIN check digits
// completed), every line validated, a preview grid, and exports: a ZIP of SVG (mm) or PNG files, a CSV report and a
// label sheet printed on A4 at true size (label size, columns, gaps, captions).
//
// Model: the source (pasted list or numeric sequence) is turned into items { value, caption, made | error } on
// every change; each item is encoded independently, so one bad line is reported and skipped instead of failing the
// batch. LIMIT (2000) bounds the work per keystroke and the size of a print job. The preview grid shows at most 48
// codes; exports use all valid items.
import { TYPES, canvasBlob, errorText, group, isMatrix, makeSymbol, showGS, startShell, symbolCanvas } from './common.js';
import { button, card, download, field, range, seg, select, t, textInput, toast, toggle } from '../ui/app.js';
import { $, $$, debounce, h, lsGet, lsSet } from '../ui/dom.js';
import { writeZip } from '../zip/zip.js';
import { serializeCSV } from '../csv/csv.js';

const DEF = {
  type: 'ean13', source: 'list',
  list: '4860001234561\tMilk 1 l\n4860001234578\tKefir 0.5 l\n4860001234585\tYoghurt\n',
  seq: { prefix: '486000123', start: 4000, step: 1, count: 24, pad: 3, suffix: '' },
  label: { w: 52.5, h: 29.7, cols: 4, gap: 0, margin: 0, caption: true, border: false },
  mag: 100, xdim: 0.33, height: 12, dpi: 300,
};
const SKEY = 'bc-batch';
// Persisted state is copied field by field when the saved value has the default's type; unknown keys are ignored.
const S = (() => {
  const s = structuredClone(DEF), v = lsGet(SKEY, null) || {};
  if (TYPES.some((x) => x.key === v.type)) s.type = v.type;
  if (v.source === 'seq') s.source = 'seq';
  if (typeof v.list === 'string') s.list = v.list;
  for (const k of ['seq', 'label']) if (v[k] && typeof v[k] === 'object') for (const kk of Object.keys(s[k])) if (typeof v[k][kk] === typeof s[k][kk]) s[k][kk] = v[k][kk];
  for (const k of ['mag', 'xdim', 'height', 'dpi']) if (typeof v[k] === 'number') s[k] = v[k];
  return s;
})();
const save = debounce(() => lsSet(SKEY, S), 300);
const R = { items: [] };          // [{ value, caption, made, error }]
const LIMIT = 2000;

const isEan = () => ['ean13', 'ean8', 'upca', 'upce', 'ean2', 'ean5'].includes(S.type);
const xdim = () => (isEan() ? 0.33 * S.mag / 100 : S.xdim);
function layoutOpts() {
  const x = xdim();
  // Unlike the create page, EAN height here is a free mm value (labels are often truncated), floored at 10 modules.
  // Bar height in mm for every linear type (EAN labels are often truncated; the nominal EAN height is 22.85 mm × magnification).
  if (isEan()) return { height: Math.max(10, S.height / x), font: 8 };
  return { height: Math.max(5, S.height / x), font: Math.max(4, 2.6 / x), bearer: S.type === 'itf14' ? 'frame' : undefined };
}

// --- items -------------------------------------------------------------------------------------------------------

function sourceLines() {
  if (S.source === 'list') {
    return S.list.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim()).slice(0, LIMIT).map((l) => {
      // Caption separator: the first tab (spreadsheet paste) or ';' followed by optional spaces. Lazy (.*?) so the value is
      // the text before the first separator.
      const m = /^(.*?)(?:\t|;\s*)(.*)$/.exec(l);
      return m ? { value: m[1].trim(), caption: m[2].trim() } : { value: l.trim(), caption: '' };
    });
  }
  const q = S.seq, out = [];
  const n = Math.max(0, Math.min(LIMIT, Math.floor(q.count)));
  for (let i = 0; i < n; i++) {
    // Sequence numbers are zero-padded to `pad` digits between prefix and suffix; a GTIN check digit is completed by the
    // encoder (the value given is 12 digits for EAN-13).
    const num = String(Math.floor(q.start) + i * Math.floor(q.step || 1)).padStart(Math.max(0, Math.floor(q.pad)), '0');
    out.push({ value: q.prefix + num + q.suffix, caption: '' });
  }
  return out;
}

function build() {
  R.items = sourceLines().map(({ value, caption }) => {
    // ITF-14 always gets the bearer frame in batch (the GS1 recommendation for corrugated cartons).
    try { return { value, caption, made: makeSymbol(S.type, value, S.type === 'itf14' ? { bearer: 'frame' } : {}) }; } catch (e) { return { value, caption, error: e }; }
  });
}

// --- layout --------------------------------------------------------------------------------------------------------

const main = $('#main');
main.classList.add('bc-batch');
const els = {};

function render() {
  main.textContent = '';
  const types = select(TYPES.map((x) => ({ v: x.key, l: '=' + x.name })), S.type, (v) => { S.type = v; changed(); render(); });
  const src = seg([{ v: 'list', l: 'bc.b.list', icon: 'list' }, { v: 'seq', l: 'bc.b.seq', icon: 'timeline' }], S.source, (v) => { S.source = v; changed(); render(); }, 'bc.b.source');
  const input = h('div', { class: 'ed-fields' });
  if (S.source === 'list') {
    input.append(field('bc.b.values', textInput(S.list, (v) => { S.list = v; changed(); }, { multiline: true, rows: 10, class: 'ed-input ed-textarea bc-mono', dir: 'ltr' }), '=' + t('bc.b.valuesHint', { n: LIMIT })));
  } else {
    const q = S.seq;
    const num = (k, attrs = {}) => textInput(String(q[k]), (v) => { q[k] = typeof DEF.seq[k] === 'number' ? Number(v) || 0 : v; changed(); }, { class: 'ed-input bc-mono', ...attrs });
    input.append(
      h('div', { class: 'ed-grid2' }, field('bc.b.prefix', num('prefix')), field('bc.b.suffix', num('suffix'))),
      h('div', { class: 'ed-grid2' }, field('bc.b.start', num('start', { inputmode: 'numeric' })), field('bc.b.step', num('step', { inputmode: 'numeric' }))),
      h('div', { class: 'ed-grid2' }, field('bc.b.count', num('count', { inputmode: 'numeric' })), field('bc.b.pad', num('pad', { inputmode: 'numeric' }))),
      h('div', { class: 'ed-hint' }, t('bc.b.seqHint')));
  }
  const setup = card('bc.b.setup', field('bc.type', types), group('bc.b.source', src), input);

  const L = S.label;
  const sizeF = isEan()
    ? field('bc.d.mag', range({ min: 80, max: 200, step: 5, value: S.mag, unit: ' %', onInput: (v) => { S.mag = v; changed(); } }))
    : field(isMatrix(S.type) ? 'bc.d.module' : 'bc.d.xdim', range({ min: 0.17, max: 1.2, step: 0.01, value: S.xdim, unit: ' mm', onInput: (v) => { S.xdim = v; changed(); } }));
  const labelCard = card('bc.b.labels',
    sizeF,
    isMatrix(S.type) ? null : field('bc.d.height', range({ min: 4, max: 40, step: 0.5, value: S.height, unit: ' mm', onInput: (v) => { S.height = v; changed(); } })),
    h('div', { class: 'ed-grid2' },
      field('bc.b.lw', textInput(String(L.w), (v) => { L.w = Number(v.replace(',', '.')) || 10; changed(); }, { inputmode: 'decimal' })),
      field('bc.b.lh', textInput(String(L.h), (v) => { L.h = Number(v.replace(',', '.')) || 10; changed(); }, { inputmode: 'decimal' }))),
    h('div', { class: 'ed-grid2' },
      field('bc.b.cols', textInput(String(L.cols), (v) => { L.cols = Math.max(1, Math.min(12, parseInt(v, 10) || 1)); changed(); }, { inputmode: 'numeric' })),
      field('bc.b.gap', textInput(String(L.gap), (v) => { L.gap = Math.max(0, Number(v.replace(',', '.')) || 0); changed(); }, { inputmode: 'decimal' }))),
    field('bc.b.margin', textInput(String(L.margin), (v) => { L.margin = Math.max(0, Number(v.replace(',', '.')) || 0); changed(); }, { inputmode: 'decimal' }), 'bc.b.marginHint'),
    field('bc.b.caption', toggle(L.caption, (v) => { L.caption = v; changed(); })),
    field('bc.b.border', toggle(L.border, (v) => { L.border = v; changed(); })),
    h('div', { class: 'ed-grid2' }, field('bc.x.dpi', select([150, 300, 600].map((v) => ({ v, l: `=${v} dpi` })), S.dpi, (v) => { S.dpi = +v; save(); }))));

  els.summary = h('div', { class: 'bc-b-summary', role: 'status', 'aria-live': 'polite' });
  els.errors = h('div', { class: 'bc-b-errors' });
  els.grid = h('div', { class: 'bc-b-grid' });
  const b = (label, ic, fn, kind) => button(label, ic, fn, kind);
  els.actions = h('div', { class: 'ap-actions bc-b-actions' }, b('bc.b.zipSvg', 'download', zipSVG, 'primary'), b('bc.b.zipPng', 'image', zipPNG), b('bc.b.csv', 'table', exportCSV), b('bc.b.print', 'print', printLabels));
  const out = card('bc.b.result', els.summary, els.actions, els.errors, els.grid);
  main.append(h('div', { class: 'bc-b-work' }, h('div', { class: 'bc-col' }, setup, labelCard), out));
  update();
}

const changed = () => { save(); updateSoon(); };
const updateSoon = debounce(() => update(), 120);

function update() {
  build();
  const ok = R.items.filter((x) => x.made), bad = R.items.filter((x) => x.error);
  els.summary.textContent = '';
  els.summary.append(h('b', {}, t('bc.b.count', { n: ok.length })));
  if (bad.length) els.summary.append(h('span', { class: 'bc-bad' }, ' · ' + t('bc.b.bad', { n: bad.length })));
  els.errors.textContent = '';
  if (bad.length) {
    els.errors.append(h('ul', { class: 'bc-b-errlist' }, bad.slice(0, 50).map((x) => h('li', {}, h('code', { class: 'bc-mono' }, x.value || '∅'), ' — ', errorText(x.error)))));
  }
  els.grid.textContent = '';
  for (const x of ok.slice(0, 48)) {
    els.grid.append(h('figure', { class: 'bc-b-cell' }, h('div', { class: 'bc-b-code', html: x.made.svg({ ...layoutOpts(), xdim: 2, unit: 'px', title: x.value }) }), h('figcaption', {}, x.caption || showGS(x.made.sym.hri || x.value))));
  }
  if (ok.length > 48) els.grid.append(h('div', { class: 'ed-hint bc-b-more' }, t('bc.b.more', { n: ok.length - 48 })));
  for (const btn of $$('button', els.actions)) btn.disabled = !ok.length;
}

// --- exports -------------------------------------------------------------------------------------------------------

// File names start with the 1-based position (0001-...) so the ZIP lists files in batch order.
const fileBase = (x, i) => `${String(i + 1).padStart(4, '0')}-${String(x.value).replace(/[^\w.-]+/g, '_').slice(0, 40)}`;
// SVG files in real millimetres: they drop into a label program at the specified size.
const svgOf = (x) => x.made.svg({ ...layoutOpts(), unit: 'mm', xdim: xdim(), title: x.value });

async function zipSVG() {
  const ok = R.items.filter((x) => x.made);
  const files = ok.map((x, i) => ({ name: fileBase(x, i) + '.svg', data: svgOf(x) }));
  download(await writeZip(files), `barcodes-${S.type}.zip`, 'application/zip');
}

async function zipPNG() {
  const ok = R.items.filter((x) => x.made);
  // Integer pixels per module for sharp PNGs (see common.js symbolCanvas). Every 50 images the loop yields to the event
  // loop, so the page stays responsive during a 2000-image export. PNGs are stored uncompressed in the ZIP: they are
  // already deflate-compressed, recompressing wastes time for no gain.
  const ppm = Math.max(1, Math.round(xdim() / 25.4 * S.dpi));
  toast(t('bc.b.working', { n: ok.length }), 'info');
  const files = [];
  for (let i = 0; i < ok.length; i++) {
    const blob = await canvasBlob(symbolCanvas(ok[i].made, { ppm, ...layoutOpts() }));
    files.push({ name: fileBase(ok[i], i) + '.png', data: new Uint8Array(await blob.arrayBuffer()) });
    if (i % 50 === 49) await new Promise((r) => setTimeout(r, 0));
  }
  download(await writeZip(files, { level: 'store' }), `barcodes-${S.type}-png.zip`, 'application/zip');
}

function exportCSV() {
  const rows = [['value', 'caption', 'type', 'data', 'hri', 'valid', 'error']];
  for (const x of R.items) rows.push([x.value, x.caption, S.type, x.made ? showGS(x.made.sym.data instanceof Uint8Array ? '' : x.made.sym.data) : '', x.made ? x.made.sym.hri : '', x.made ? 'yes' : 'no', x.error ? errorText(x.error) : '']);
  // '﻿' BOM for Excel's UTF-8 detection; guard: true neutralises formula-like cells (CSV injection).
  download('﻿' + serializeCSV(rows, { guard: true }), `barcodes-${S.type}.csv`, 'text/csv');
}

// Label sheet: A4 pages of fixed-size labels; every label holds the code at true size, scaled down only if it
// does not fit (the scale is reported).
function printLabels() {
  const ok = R.items.filter((x) => x.made);
  // 4.2 mm reserved for a caption line when captions are enabled. Each code is scaled down uniformly (never up) to fit
  // its label minus a 1 mm inner margin per side; the worst scale is reported, because a scaled barcode may fall below
  // the minimum X-dimension of its specification.
  // KNOWN DEFECT: the sheet margin is padding on the grid container and @page has margin 0, so only the first page gets
  // the top margin and later pages start at the paper edge, shifting labels off pre-cut sheets. Fix: put the margin
  // into an injected @page rule (as receipt-studio does for its paper size) and drop the container padding.
  const L = S.label, x = xdim();
  const cap = L.caption ? 4.2 : 0;
  let worst = 1;
  let sheet = $('#bc-print');
  if (sheet) sheet.remove();
  // Grid geometry inline in mm (columns x label width, fixed row height): it overrides the generic 3-column print grid
  // of app.css because inline styles outrank the stylesheet rule.
  sheet = h('div', { id: 'bc-print', class: 'bc-print bc-labels', style: { gridTemplateColumns: `repeat(${L.cols}, ${L.w}mm)`, gridAutoRows: L.h + 'mm', gap: L.gap + 'mm', padding: L.margin + 'mm' } });
  for (const it of ok) {
    const m = it.made.modules(layoutOpts());
    const w = m.width * x, hh = m.height * x;
    const k = Math.min(1, (L.w - 2) / w, (L.h - 2 - cap) / hh);
    worst = Math.min(worst, k);
    sheet.append(h('figure', { class: 'bc-label' + (L.border ? ' bc-label-border' : '') },
      h('div', { class: 'bc-label-code', style: { width: w * k + 'mm', height: hh * k + 'mm' }, html: svgOf(it) }),
      L.caption && it.caption ? h('figcaption', {}, it.caption) : null));
  }
  if (worst < 0.999) toast(t('bc.b.scaled', { p: Math.round(worst * 100) }), worst < 0.8 ? 'warn' : 'info');
  document.body.append(sheet);
  document.body.classList.add('bc-printing');
  const done = () => { document.body.classList.remove('bc-printing'); sheet.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { window.print(); setTimeout(done, 1000); }, 50);
}

startShell('batch', () => render());
render();
