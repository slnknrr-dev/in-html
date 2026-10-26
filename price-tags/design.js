// price-tags/design.js - the tag designer and printer: template (classic, promo yellow, minimal, wobbler, shelf-edge
// strip), size in mm (58×40, 70×37, 90×60, A6, strip, custom), font sizes and family, tag language and a second
// language line, currency (symbol, position, decimal mark, small decimals), unit price basis, origin, date and print
// code, EAN-13 / Code 128 / GS1 DataMatrix; a large preview (true size or fitted), SVG / PNG export of one tag, the
// list of tags with print selection, and A4 sheets at true size with a centred grid, cut marks, copies and the
// "only changed prices" filter against the last printed set (localStorage).
//
// State: D (design, persisted via a 200ms debounced save so dragging a slider does not write localStorage per pixel),
// S (view: selected tag, zoom, picked set), R (derived: prices, tag data, changed ids - recomputed in refresh()).
// Control handlers mutate D and call changed() = save + refresh debounced 60ms: several controls firing together
// (size preset sets w, h and fonts) coalesce into one repaint. Controls whose change alters the control panel
// itself (size preset shows/hides custom w/h, reset) call render() to rebuild the panel.
// Product data is read-only here (owned by the products page); it is re-read only on page load.
import { BARCODES, BASES, DESIGN_DEF, LANGS, LANG_NAMES, SIZES, TEMPLATES, changedIds, currencySymbol, forgetPrinted, group, loadData, loadDesign, loadPrinted, markPrinted, pricesFor, saveData, saveDesign, startShell, tagData } from './common.js';
import { A4, cutMarks, sheetGrid, tagSVG } from './tag.js';
import { button, card, colorInput, download, field, range, seg, select, t, textInput, toast, toggle } from '../ui/app.js';
import { $, $$, debounce, h, lsGet, lsSet } from '../ui/dom.js';
import { COMMON_CURRENCIES } from '../payments/money.js';

const data = loadData();
if (lsGet('pt-data', null) == null) saveData(data);
const D = loadDesign();
const S = { sel: lsGet('pt-sel', null), zoom: lsGet('pt-zoom', 'fit'), picked: new Set(lsGet('pt-picked', [])) };
const save = debounce(() => saveDesign(D), 200);
const R = { prices: new Map(), tags: [], changed: new Set() };
// On-screen sheet preview is capped at 6 pages: each page holds up to ~40 full SVG tags, and hundreds of pages of
// live SVG would make every slider move sluggish. Printing always builds all pages.
const PREVIEW_PAGES = 6;

const main = $('#main');
main.classList.add('pt-design');
const els = {};

const sizeLabel = (k) => (k === 'custom' ? t('pt.size.custom') : k === 'a6' ? `A6 · 105 × 148 mm` : k === 'strip' ? `${t('pt.size.strip')} · 100 × 30 mm` : `${SIZES[k].w} × ${SIZES[k].h} mm`);

// Builds the whole page (controls + stage + list + print). Notes:
// - A size preset overwrites w, h and fonts (preset font sizes are tuned per size); 'strip' also forces the strip
//   template, because the other layouts do not fit a 100 x 30 mm shelf edge.
// - num(): accepts ',' as decimal mark and ignores non-positive / unparsable text without resetting the field, so a
//   half-typed value does not jump back under the cursor. Clamps match loadDesign() (20..200 x 15..287 mm).
// - Picking a currency also resets the symbol to Intl's narrow symbol, but the symbol stays editable (e.g. 'GEL' or
//   'ლ' instead of '₾' for printers whose fonts lack U+20BE).
function render() {
  main.textContent = '';
  els.tpl = h('div', { class: 'pt-tpls', role: 'radiogroup', 'aria-label': t('pt.d.template') });
  const tplCard = card('pt.d.template', els.tpl);

  const sizeSel = select(Object.keys(SIZES).map((k) => ({ v: k, l: '=' + sizeLabel(k) })), D.size, (v) => {
    D.size = v;
    if (SIZES[v]) { D.w = SIZES[v].w; D.h = SIZES[v].h; D.fonts = { ...SIZES[v].f }; }
    if (v === 'strip' && D.template !== 'strip') D.template = 'strip';
    changed(); render();
  });
  sizeSel.id = 'pt-size';
  const num = (v, fn, attrs = {}) => textInput(String(v), (s) => { const n = Number(String(s).replace(',', '.')); if (Number.isFinite(n) && n > 0) fn(n); }, { inputmode: 'decimal', class: 'ed-input pt-num', ...attrs });
  const custom = D.size === 'custom' ? h('div', { class: 'ed-grid2' },
    field('pt.d.w', num(D.w, (n) => { D.w = Math.min(200, Math.max(20, n)); changed(); })),
    field('pt.d.h', num(D.h, (n) => { D.h = Math.min(287, Math.max(15, n)); changed(); }))) : null;
  const sizeCard = card('pt.d.size', field('pt.d.size', sizeSel), custom,
    field('pt.d.fName', range({ min: 5, max: 40, step: 0.5, value: D.fonts.name, unit: ' pt', onInput: (v) => { D.fonts.name = v; changed(); } })),
    field('pt.d.fPrice', range({ min: 10, max: 120, step: 1, value: D.fonts.price, unit: ' pt', onInput: (v) => { D.fonts.price = v; changed(); } })),
    field('pt.d.fSmall', range({ min: 4, max: 16, step: 0.5, value: D.fonts.small, unit: ' pt', onInput: (v) => { D.fonts.small = v; changed(); } })),
    group('pt.d.font', seg(['sans', 'condensed', 'serif'].map((v) => ({ v, l: 'pt.font.' + v })), D.font, (v) => { D.font = v; changed(); }, 'pt.d.font')),
    field('pt.d.bold', toggle(D.bold, (v) => { D.bold = v; changed(); })));

  const langOpts = LANGS.map((l) => ({ v: l, l: '=' + LANG_NAMES[l] }));
  const lang = select(langOpts, D.lang, (v) => { D.lang = v; changed(); });
  lang.id = 'pt-lang';
  const lang2 = select([{ v: '', l: 'pt.d.none' }, ...langOpts], D.lang2, (v) => { D.lang2 = v; changed(); });
  const contentCard = card('pt.d.content',
    h('div', { class: 'ed-grid2' }, field('pt.d.lang', lang), field('pt.d.lang2', lang2)),
    field('pt.d.unitPrice', toggle(D.unitPrice, (v) => { D.unitPrice = v; changed(); })),
    group('pt.d.basis', seg(BASES.map((v) => ({ v, l: 'pt.basis.' + v })), D.basis, (v) => { D.basis = v; changed(); }, 'pt.d.basis'), 'pt.d.basisHint'),
    field('pt.d.origin', toggle(D.origin, (v) => { D.origin = v; changed(); })),
    field('pt.d.date', toggle(D.date, (v) => { D.date = v; changed(); })),
    field('pt.d.printCode', textInput(D.printCode, (v) => { D.printCode = v.slice(0, 24); changed(); }, { maxlength: 24 }), 'pt.d.printCodeHint'),
    field('pt.d.border', toggle(D.border, (v) => { D.border = v; changed(); })),
    field('pt.d.accent', colorInput(D.accent, (v) => { D.accent = v; changed(); })));

  const symIn = textInput(D.symbol, (v) => { D.symbol = v.slice(0, 6); changed(); }, { maxlength: 6, class: 'ed-input pt-num' });
  const curSel = select(COMMON_CURRENCIES.map((c) => ({ v: c, l: `=${c} · ${currencySymbol(c)}` })), D.currency, (v) => { D.currency = v; D.symbol = currencySymbol(v); symIn.value = D.symbol; changed(); });
  const moneyCard = card('pt.d.money',
    h('div', { class: 'ed-grid2' }, field('pt.d.currency', curSel), field('pt.d.symbol', symIn)),
    group('pt.d.symbolPos', seg([{ v: 'after', l: 'pt.d.after' }, { v: 'before', l: 'pt.d.before' }], D.symbolPos, (v) => { D.symbolPos = v; changed(); }, 'pt.d.symbolPos')),
    group('pt.d.decimal', seg([{ v: ',', l: '=12,50' }, { v: '.', l: '=12.50' }], D.decimal, (v) => { D.decimal = v; changed(); }, 'pt.d.decimal')),
    group('pt.d.cents', seg([{ v: 'small', l: 'pt.d.centsSmall' }, { v: 'inline', l: 'pt.d.centsInline' }], D.cents, (v) => { D.cents = v; changed(); }, 'pt.d.cents')));

  els.codeHint = h('div', { class: 'ed-hint', role: 'status' });
  const codeCard = card('pt.d.code', group('pt.d.code', seg(BARCODES.map((v) => ({ v, l: 'pt.code.' + v })), D.barcode, (v) => { D.barcode = v; changed(); }, 'pt.d.code')), els.codeHint);

  const reset = button('pt.d.reset', 'undo', () => { Object.assign(D, structuredClone(DESIGN_DEF)); changed(); render(); });
  reset.classList.add('ed-sm');

  // Stage: the selected tag.
  els.stage = h('div', { class: 'pt-stage', id: 'pt-stage' });
  els.stageMeta = h('div', { class: 'ed-hint pt-stage-meta' });
  const zoom = seg([{ v: 'fit', l: 'pt.d.fit' }, { v: 'actual', l: 'pt.d.actual' }], S.zoom, (v) => { S.zoom = v; lsSet('pt-zoom', v); paintStage(); }, 'pt.d.zoom');
  const xb = (l, ic, fn, k) => { const b = button(l, ic, fn, k); b.classList.add('pt-xbtn'); return b; };
  const stageCard = card('pt.d.preview', h('div', { class: 'ap-row' }, zoom, h('span', { class: 'ed-spacer' }), xb('pt.d.svg', 'download', exportSVG, 'primary'), xb('pt.d.png', 'image', exportPNG)), els.stage, els.stageMeta);

  // Tag list.
  els.list = h('div', { class: 'pt-thumbs', role: 'listbox', 'aria-label': t('pt.d.tags') });
  els.listInfo = h('span', { class: 'ed-hint' });
  const all = button('pt.d.pickAll', 'check', () => { S.picked = new Set(R.tags.map((x) => x.id)); savePicked(); paintList(); paintSheets(); });
  const none = button('pt.d.pickNone', 'close', () => { S.picked.clear(); savePicked(); paintList(); paintSheets(); });
  all.classList.add('ed-sm'); none.classList.add('ed-sm');
  const listCard = card('pt.d.tags', h('div', { class: 'ap-row' }, els.listInfo, h('span', { class: 'ed-spacer' }), all, none), els.list);

  // Print.
  const P = D.sheet;
  const which = seg(['all', 'changed', 'promo', 'picked'].map((v) => ({ v, l: 'pt.s.' + v })), P.which, (v) => { P.which = v; save(); paintSheets(); }, 'pt.s.which');
  which.id = 'pt-which';
  els.stats = h('div', { class: 'pt-stats', id: 'pt-stats', role: 'status', 'aria-live': 'polite' });
  els.sheets = h('div', { class: 'pt-sheets', id: 'pt-sheets' });
  const printBtn = button('pt.s.print', 'print', printSheets, 'primary');
  printBtn.id = 'pt-print-btn';
  const markBtn = button('pt.s.mark', 'check', () => { markPrinted(selection()); toast(t('pt.s.marked', { n: selection().length }), 'ok'); refresh(); });
  markBtn.id = 'pt-mark';
  const forgetBtn = button('pt.s.forget', 'undo', () => { forgetPrinted(); toast(t('pt.s.forgotten'), 'ok'); refresh(); });
  els.printed = h('div', { class: 'ed-hint' });
  const printCard = card('pt.s.title',
    group('pt.s.which', which),
    h('div', { class: 'pt-grid3' },
      field('pt.s.copies', num(P.copies, (n) => { P.copies = Math.min(20, Math.max(1, Math.round(n))); save(); paintSheets(); }, { inputmode: 'numeric', id: 'pt-copies' })),
      field('pt.s.margin', num(P.margin, (n) => { P.margin = Math.min(30, Math.max(3, n)); save(); paintSheets(); }, { id: 'pt-margin' })),
      field('pt.s.gap', textInput(String(P.gap), (s) => { const n = Number(String(s).replace(',', '.')); if (Number.isFinite(n) && n >= 0) { P.gap = Math.min(20, n); save(); paintSheets(); } }, { inputmode: 'decimal', class: 'ed-input pt-num', id: 'pt-gap' }))),
    field('pt.s.marks', toggle(P.marks, (v) => { P.marks = v; save(); paintSheets(); })),
    els.stats,
    h('div', { class: 'ap-actions' }, printBtn, markBtn, forgetBtn), els.printed,
    h('p', { class: 'ed-hint' }, t('pt.s.hint')));

  main.append(h('div', { class: 'pt-dwork' },
    h('div', { class: 'pt-col pt-controls' }, tplCard, sizeCard, contentCard, moneyCard, codeCard, h('div', { class: 'ap-actions' }, reset)),
    h('div', { class: 'pt-col pt-stagecol' }, stageCard, listCard, printCard, card('pt.s.sheets', els.sheets))));
  refresh();
}

const changed = () => { save(); refreshSoon(); };
const refreshSoon = debounce(() => refresh(), 60);
const savePicked = () => lsSet('pt-picked', [...S.picked]);

function refresh() {
  R.prices = pricesFor(data);
  R.tags = tagData(data.products, R.prices, D);
  R.changed = changedIds(R.tags, data);
  paintTemplates();
  paintStage();
  paintList();
  paintSheets();
}

// Tag shown on the stage: the selected one, else the first discounted one (shows the most template features: band,
// badge, struck price), else the first.
const current = () => R.tags.find((x) => x.id === S.sel) || R.tags.find((x) => x.kind) || R.tags[0] || null;

// Template picker as an ARIA radiogroup: each tile is the current tag rendered in that template (a real preview, not
// a stock icon). Roving tabindex (selected = 0, others = -1) makes the group one Tab stop; arrows move and select,
// wrapping around, as the radio pattern requires. onkeydown is assigned (not addEventListener) so repaints replace
// the handler instead of stacking duplicates on the persistent container.
function paintTemplates() {
  const box = els.tpl, cur = current();
  box.textContent = '';
  for (const k of TEMPLATES) {
    const on = D.template === k;
    const thumb = cur ? tagSVG(cur, { ...D, template: k }, { unit: '' }).svg : '';
    const b = h('button', { type: 'button', role: 'radio', class: 'pt-tpl' + (on ? ' pt-on' : ''), 'aria-checked': String(on), tabindex: on ? '0' : '-1', dataset: { k },
      onclick: () => { D.template = k; changed(); } }, h('span', { class: 'pt-tpl-art', html: thumb }), h('span', {}, t('pt.tpl.' + k)));
    box.append(b);
  }
  box.onkeydown = (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const i = TEMPLATES.indexOf(D.template), k = TEMPLATES[(i + step + TEMPLATES.length) % TEMPLATES.length];
    D.template = k; save(); refresh();
    $(`.pt-tpl[data-k="${k}"]`, box)?.focus();
  };
}

// Stage. "actual" renders with mm width/height = nominal true size on screen (CSS mm assumes 96 dpi, so physical size
// matches only on a calibrated display; on paper it is exact). Barcode hint: EAN X-dimension relative to the 0.33 mm
// nominal (magnification %), with a warning below 0.264 mm = 80 %, the GS1 minimum for retail POS EAN-13.
function paintStage() {
  const tg = current();
  els.stage.textContent = '';
  els.stageMeta.textContent = '';
  els.codeHint.textContent = '';
  if (!tg) { els.stage.append(h('div', { class: 'ap-empty' }, t('pt.d.noTags'))); return; }
  const r = tagSVG(tg, D, { unit: S.zoom === 'actual' ? 'mm' : '' });
  els.stage.className = 'pt-stage pt-zoom-' + S.zoom;
  els.stage.style.setProperty('--ar', `${D.w} / ${D.h}`);
  els.stage.innerHTML = `<div class="pt-stage-tag">${r.svg}</div>`;
  els.stageMeta.textContent = `${tg.name} · ${D.w} × ${D.h} mm`;
  if (r.code === 'ean13' || r.code === 'ean8' || r.code === 'upca') els.codeHint.textContent = t('pt.d.xdimEan', { x: r.xdim.toFixed(3), m: Math.round(r.xdim / 0.33 * 100) }) + (r.xdim < 0.264 ? ' ' + t('pt.d.xdimLow') : '');
  else if (r.code) els.codeHint.textContent = t('pt.d.xdim', { x: r.xdim.toFixed(3), k: t('pt.code.' + (r.code === 'datamatrix' ? 'datamatrix' : 'code128')) });
  else if (D.barcode !== 'none') els.codeHint.textContent = t('pt.d.noCode');
}

// Tag list as listbox/option: click or Enter selects for the stage; Space toggles the print checkbox; arrows move
// focus. Two independent states per tile - "selected" (stage) and "picked" (print) - so the checkbox stops click
// propagation, else ticking it would also change the stage. Picking repaints sheets only in 'picked' mode, the only
// mode it affects.
function paintList() {
  const box = els.list;
  box.textContent = '';
  els.listInfo.textContent = t('pt.d.listInfo', { n: R.tags.length, c: R.changed.size, p: S.picked.size });
  if (!R.tags.length) { box.append(h('div', { class: 'ap-empty' }, t('pt.d.noTags'))); return; }
  const cur = current();
  for (const tg of R.tags) {
    const on = cur && tg.id === cur.id;
    const cb = h('input', { type: 'checkbox', checked: S.picked.has(tg.id), 'aria-label': t('pt.d.pick', { name: tg.name }), dataset: { id: tg.id } });
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => { if (cb.checked) S.picked.add(tg.id); else S.picked.delete(tg.id); savePicked(); els.listInfo.textContent = t('pt.d.listInfo', { n: R.tags.length, c: R.changed.size, p: S.picked.size }); if (D.sheet.which === 'picked') paintSheets(); });
    const fig = h('div', { class: 'pt-thumb' + (on ? ' pt-on' : ''), role: 'option', tabindex: '0', 'aria-selected': String(!!on), dataset: { id: tg.id } },
      h('div', { class: 'pt-thumb-art', html: tagSVG(tg, D, { unit: '' }).svg }),
      h('div', { class: 'pt-thumb-cap' }, cb, h('span', {}, tg.name), R.changed.has(tg.id) ? h('span', { class: 'pt-dot', title: t('pt.d.changed') }) : null));
    const pick = () => { S.sel = tg.id; lsSet('pt-sel', tg.id); for (const x of $$('.pt-thumb', box)) { const o = x.dataset.id === tg.id; x.classList.toggle('pt-on', o); x.setAttribute('aria-selected', String(o)); } paintStage(); paintTemplates(); };
    fig.addEventListener('click', pick);
    fig.addEventListener('keydown', (e) => {
      if (e.target !== fig) return;
      if (e.key === 'Enter') { e.preventDefault(); pick(); }
      else if (e.key === ' ') { e.preventDefault(); cb.click(); }
      else if (/^Arrow/.test(e.key)) {
        e.preventDefault();
        const n = /Right|Down/.test(e.key) ? fig.nextElementSibling : fig.previousElementSibling;
        if (n) n.focus();
      }
    });
    box.append(fig);
  }
}

// --- sheets -------------------------------------------------------------------------------------------------------

function selection() {
  const w = D.sheet.which;
  return R.tags.filter((x) => (w === 'changed' ? R.changed.has(x.id) : w === 'promo' ? !!x.kind : w === 'picked' ? S.picked.has(x.id) : true));
}

// Expand copies (each tag repeated `copies` times, adjacent so identical tags are cut together), then chunk by
// perPage. perPage 0 (tag larger than A4 minus margins) yields no pages; callers show "does not fit".
function pagesOf(tags) {
  const g = sheetGrid(D.w, D.h, D.sheet);
  const list = tags.flatMap((x) => Array.from({ length: D.sheet.copies }, () => x));
  const pages = [];
  if (!g.perPage) return { g, pages, count: list.length };
  for (let i = 0; i < list.length; i += g.perPage) pages.push(list.slice(i, i + g.perPage));
  return { g, pages, count: list.length };
}

// One A4 page: cells absolutely positioned in mm, row-major. Each cell's SVG has mm width/height so it prints at true
// size. Cut marks inserted first (afterbegin) so they sit under the tags in paint order.
function pageEl({ g }, items) {
  const gap = D.sheet.gap;
  const page = h('div', { class: 'pt-page' });
  items.forEach((tg, i) => {
    const c = i % g.cols, r = Math.floor(i / g.cols);
    page.append(h('div', { class: 'pt-cell', style: { left: (g.x0 + c * (D.w + gap)) + 'mm', top: (g.y0 + r * (D.h + gap)) + 'mm', width: D.w + 'mm', height: D.h + 'mm' }, dataset: { id: tg.id }, html: tagSVG(tg, D, { unit: 'mm' }).svg }));
  });
  if (D.sheet.marks && items.length) page.insertAdjacentHTML('afterbegin', cutMarks(g, D.w, D.h, gap));
  return page;
}

// Stats carry data-per / data-pages for e2e tests, so tests do not parse translated text.
function paintSheets() {
  const sel = selection();
  const L = pagesOf(sel);
  const { g } = L;
  els.stats.textContent = '';
  els.stats.dataset.per = String(g.perPage);
  els.stats.dataset.pages = String(L.pages.length);
  els.stats.append(
    h('span', { class: 'ap-stat' }, h('b', {}, `${g.cols} × ${g.rows}`), ' ', t('pt.s.perPage', { n: g.perPage })),
    h('span', { class: 'ap-stat' }, h('b', {}, String(L.count)), ' ', t('pt.s.tags', { n: L.count })),
    h('span', { class: 'ap-stat' }, h('b', {}, String(L.pages.length)), ' ', t('pt.s.pages', { n: L.pages.length })));
  if (!g.perPage) els.stats.append(h('div', { class: 'ed-hint pt-warn' }, t('pt.s.tooBig')));
  const snap = loadPrinted();
  els.printed.textContent = snap ? t('pt.s.lastPrinted', { d: new Date(snap.at).toLocaleString(document.documentElement.lang || 'en'), n: R.changed.size }) : t('pt.s.never');
  $('#pt-print-btn')?.toggleAttribute('disabled', !L.pages.length);
  const box = els.sheets;
  box.textContent = '';
  if (!L.pages.length) { box.append(h('div', { class: 'ap-empty', id: 'pt-sheets-empty' }, sel.length ? t('pt.s.tooBig') : t('pt.s.nothing'))); return; }
  for (const items of L.pages.slice(0, PREVIEW_PAGES)) box.append(h('div', { class: 'pt-page-box' }, pageEl(L, items)));
  if (L.pages.length > PREVIEW_PAGES) box.append(h('div', { class: 'ed-hint' }, t('pt.s.morePages', { n: L.pages.length - PREVIEW_PAGES })));
  fitPages();
}

// Screen preview: pages scaled to the column width (the print copy is built at true size).
// A4 width in CSS px = 210 mm x 96 / 25.4. Two pages per row from 700px, gap 14px matches .pt-sheets. k <= 1: never
// enlarge. clientWidth 0 (hidden/not laid out yet) falls back to 600.
function fitPages() {
  const box = els.sheets;
  const w = box.clientWidth || 600;
  const pagePx = A4.w * 96 / 25.4;
  const per = w >= 700 ? 2 : 1;
  const k = Math.min(1, (w - (per - 1) * 14) / per / pagePx);
  box.style.setProperty('--k', String(k));
}
window.addEventListener('resize', debounce(fitPages, 120));

// Print: build all pages unscaled into #pt-print, switch body to print mode (app.css hides everything else), print,
// and clean up on afterprint. The 50ms timeout lets the browser lay out the new pages (and decode the SVGs) before
// print() snapshots the document. After printing the set is marked printed; since browsers do not report whether the
// user actually printed or cancelled, an Undo toast restores the previous snapshot.
// KNOWN DEFECT: if afterprint never fires (some embedded/mobile browsers), body keeps .pt-printing and #pt-print stays
// in the DOM; on screen nothing shows, but the next print would still work because the old root is removed first.
// Fix: also clean up on the next focus/visibilitychange, or after print() returns where print() is blocking.
function printSheets() {
  const sel = selection();
  const L = pagesOf(sel);
  if (!L.pages.length) return;
  let root = $('#pt-print');
  if (root) root.remove();
  root = h('div', { id: 'pt-print', class: 'pt-print' }, L.pages.map((items) => pageEl(L, items)));
  document.body.append(root);
  document.body.classList.add('pt-printing');
  const prev = loadPrinted();
  const done = () => {
    document.body.classList.remove('pt-printing'); root.remove(); window.removeEventListener('afterprint', done);
    markPrinted(sel);
    refresh();
    toast(t('pt.s.marked', { n: sel.length }), 'ok', { label: t('dlg.undo'), fn: () => { lsSet('pt-printed', prev); refresh(); } });
  };
  window.addEventListener('afterprint', done, { once: true });
  setTimeout(() => { window.print(); }, 50);
}

// --- export -------------------------------------------------------------------------------------------------------

const fileBase = (tg) => ('tag-' + (tg.ean || tg.code || tg.id) + '-' + D.template).replace(/[^\w.-]+/g, '_');

function exportSVG() {
  const tg = current();
  if (!tg) return;
  download('<?xml version="1.0" encoding="UTF-8"?>\n' + tagSVG(tg, D, { unit: 'mm' }).svg, fileBase(tg) + '.svg', 'image/svg+xml');
}

// PNG at 300 dpi (scale = px per mm). SVG -> <img> via a data: URI (not a blob URL: no revoke bookkeeping; not
// innerHTML into canvas: impossible) -> canvas. White fill first: PNG has alpha, and a transparent background turns
// black in some viewers. The SVG uses only system fonts, so it renders in the isolated image context; external
// resources would be blocked there and silently missing.
async function exportPNG() {
  const tg = current();
  if (!tg) return;
  const dpi = 300, scale = dpi / 25.4;
  const svg = tagSVG(tg, D, { unit: 'px', scale }).svg;
  const img = new Image();
  img.decoding = 'sync';
  const ok = await new Promise((resolve) => { img.onload = () => resolve(true); img.onerror = () => resolve(false); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
  if (!ok) { toast(t('pt.d.pngFail'), 'error'); return; }
  const c = document.createElement('canvas');
  c.width = Math.round(D.w * scale); c.height = Math.round(D.h * scale);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  c.toBlob((b) => (b ? download(b, fileBase(tg) + '.png', 'image/png') : toast(t('pt.d.pngFail'), 'error')), 'image/png');
}

startShell('design', () => render());
render();
