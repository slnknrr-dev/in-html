// barcode-studio/main.js - the create page: a symbology picker (retail EAN / UPC, GS1-128, ITF-14, GS1 DataMatrix,
// Code 128 / 39 / 93, ITF, Codabar, Data Matrix, add-ons), the content form of each type (check digits completed and
// explained, a GS1 element builder that also reads pasted HRI / raw / Digital Link strings, in-store scale codes),
// a live preview at true size with a scan check (the drawing is rasterised and read back with barcode/decode.js),
// print dimensions (X-dimension, EAN magnification, bar height, quiet zones, bearer bars, bar width reduction),
// colours with a contrast check, and exports (SVG in mm, PNG at a DPI, clipboard, a print sheet).
//
// Pipeline per change (debounced 60 ms): state S -> makeSymbol() -> SVG preview + info + warnings, then an
// asynchronous scan check (debounced 260 ms) that rasterises the symbol and decodes it with the same reader the scan
// page uses. The check is the point of the page: a code that the studio's own decoder cannot read back is flagged
// before it is printed on 10 000 labels.
// Units: everything the user sets is in millimetres (X-dimension, bar height), because print specs (GS1 General
// Specifications) are written in mm; drawing functions work in modules, so layoutOpts() converts mm -> modules once.
// Stale async results are discarded with a token (R.token increments per update): a slow verification of an old
// input must never paint its badge over the current one.
import { GROUPS, TYPES, canvasBlob, describeNumber, errorText, group, isMatrix, kvRows, makeSymbol, showGS, startShell, symbolCanvas, typeInfo, fmtNum } from './common.js';
import { button, card, colorInput, copyText, download, field, range, seg, select, t, textInput, toast, toggle } from '../ui/app.js';
import { $, $$, debounce, h, lsGet, lsSet } from '../ui/dom.js';
import { icon, iconEl } from '../ui/icons.js';
import { openDialog } from '../ui/overlays.js';
import { contrastRatio } from '../color/color.js';
import { GS, aiDefinition, allAIs, buildGs1, parseGs1, toDigitalLink, validateElement } from '../barcode/gs1.js';
import { SCALE_TEMPLATES, buildScaleCode, gs1Prefix, parseScaleCode } from '../barcode/gtin.js';
import { scanImage } from '../barcode/decode.js';
import { decodeCodewords, readCodewords } from '../barcode/datamatrix.js';

// ---------------------------------------------------------------------------------------------------------------
// State (persisted in localStorage 'bc-create')

// Defaults are valid examples for every type, so switching type always shows a working code immediately. GS1 types
// are excluded from `inputs` because they are edited as AI rows (S.gs1), not as one string.
const DEF = {
  type: 'ean13',
  inputs: Object.fromEntries(TYPES.filter((x) => x.kind !== 'gs1').map((x) => [x.key, x.example])),
  gs1: [{ ai: '01', value: '04860001234561' }, { ai: '17', value: '271231' }, { ai: '10', value: 'LOT42' }],
  opts: { addon: '', check39: false, fullAscii39: false, ratio: 3, codabarStart: 'A', codabarStop: 'B', codabarCheck: false, itfCheck: false, dmShape: 'square', fnc1: false },
  design: { mag: 100, xdim: 0.33, height: 15, text: true, font: 100, fg: '#000000', bg: '#ffffff', transparent: false, quiet: true, bearer: 'frame', bwr: 0 },
  dpi: 300,
  scale: { template: 'weight', item: '12345', value: '1.250' },
  print: { copies: 12, caption: '' },
};
const SKEY = 'bc-create';

// Accepts a saved field only if it has the same type as the default (no nested objects here).
function pickKnown(base, obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const k of Object.keys(base)) if (obj[k] != null && typeof obj[k] === typeof base[k]) out[k] = obj[k];
  return out;
}
function loadState() {
  const saved = lsGet(SKEY, null) || {};
  const s = structuredClone(DEF);
  if (TYPES.some((x) => x.key === saved.type)) s.type = saved.type;
  Object.assign(s.inputs, pickKnown(s.inputs, saved.inputs));
  if (Array.isArray(saved.gs1)) s.gs1 = saved.gs1.filter((r) => r && typeof r.ai === 'string' && typeof r.value === 'string').slice(0, 30);
  Object.assign(s.opts, pickKnown(s.opts, saved.opts));
  Object.assign(s.design, pickKnown(s.design, saved.design));
  // DPI is an enum of common printer resolutions; anything else falls back to 300.
  if ([150, 200, 300, 600, 1200].includes(saved.dpi)) s.dpi = saved.dpi;
  Object.assign(s.scale, pickKnown(s.scale, saved.scale));
  Object.assign(s.print, pickKnown(s.print, saved.print));
  return s;
}
const S = loadState();
const save = debounce(() => lsSet(SKEY, S), 300);

// Derived results of the last update.
const R = { made: null, error: null, svg: '', token: 0, verify: 'idle' };

const info = () => typeInfo(S.type);
const isEan = () => ['ean13', 'ean8', 'upca', 'upce', 'ean2', 'ean5'].includes(S.type);
const isGs1 = () => info().kind === 'gs1';

// EAN/UPC sizes are specified as a magnification of the nominal 0.330 mm module (80 % to 200 %); other symbologies
// take a free X-dimension. Keeping both models avoids presenting EAN users with an unfamiliar mm value.
// X-dimension in mm: EAN / UPC by magnification of 0.330 mm, the others as set.
const xdim = () => (isEan() ? 0.33 * S.design.mag / 100 : S.design.xdim);

// The input given to the encoder and its options.
function encoderInput() {
  if (isGs1()) return S.gs1.filter((r) => r.ai || r.value).map((r) => ({ ai: r.ai.trim(), value: r.value }));
  return S.inputs[S.type] ?? '';
}
function encoderOpts() {
  const o = S.opts;
  switch (S.type) {
    case 'ean13': case 'ean8': case 'upca': case 'upce': return { addon: o.addon.trim() || undefined };
    case 'code39': return { check: o.check39, fullAscii: o.fullAscii39, ratio: o.ratio, showCheck: o.check39 };
    case 'itf': return { check: o.itfCheck, ratio: o.ratio };
    case 'itf14': return { bearer: S.design.bearer };
    // Codabar ratios: 2.5 is offered where the other types use 3 (the common Codabar wide/narrow ratio).
    case 'codabar': return { start: o.codabarStart, stop: o.codabarStop, check: o.codabarCheck, ratio: o.ratio === 3 ? 2.5 : o.ratio };
    case 'code128': return { fnc1: o.fnc1 };
    case 'datamatrix': case 'gs1-datamatrix': return { dmShape: o.dmShape };
    default: return {};
  }
}

// Drawing options in modules (from the mm settings).
function layoutOpts() {
  const d = S.design, x = xdim();
  const o = { text: d.text, quiet: d.quiet };
  if (isEan()) {
    // EAN-13 nominal bar height 22.85 mm = 69.24 modules of 0.33 mm (GS1 nominal); scales with magnification because it
    // is expressed in modules. Add-ons are 0.86 of the main symbol height.
    const nominal = 69.24;                                      // 22.85 mm at 100 %
    o.height = S.type === 'ean2' || S.type === 'ean5' ? nominal * 0.86 : nominal;
    o.font = 8 * d.font / 100;
  } else {
    // Other types: height and font from mm via the X-dimension, with floors (5 modules, 4 module font) so extreme
    // settings still draw something legible.
    o.height = Math.max(5, d.height / x);
    o.font = Math.max(4, (2.6 / x) * d.font / 100);
    if (S.type === 'itf14') o.bearer = d.bearer;
  }
  return o;
}
const colours = () => ({ fg: S.design.fg, bg: S.design.transparent ? null : S.design.bg });

// ---------------------------------------------------------------------------------------------------------------
// Layout

const main = $('#main');
main.classList.add('bc-create');
let els = {};

function typePicker() {
  // ARIA radiogroup with roving tabindex (paintPicker): one Tab stop for the whole picker, arrows move and select
  // (selection follows focus, as in native radio groups).
  const box = h('div', { class: 'bc-types', role: 'radiogroup', 'aria-label': t('bc.type') });
  for (const g of GROUPS) {
    const list = TYPES.filter((x) => x.group === g);
    box.append(h('div', { class: 'bc-tgroup' }, h('div', { class: 'bc-tgroup-h' }, t('bc.group.' + g)),
      h('div', { class: 'bc-tchips' }, list.map((x) => h('button', {
        type: 'button', role: 'radio', class: 'bc-tchip' + (x.key === S.type ? ' bc-on' : ''), 'aria-checked': String(x.key === S.type), dataset: { k: x.key },
        onclick: () => { S.type = x.key; changed(); renderForm(); paintPicker(); renderDesign(); },
      }, h('span', { class: 'bc-tchip-art', html: isMatrix(x.key) ? icon('matrix') : icon('barcode') }), h('span', {}, x.name))))));
  }
  // Arrow keys move the choice across all chips.
  box.addEventListener('keydown', (e) => {
    const btns = $$('.bc-tchip', box);
    const i = btns.indexOf(document.activeElement);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (i < 0 || !step) return;
    e.preventDefault();
    const b = btns[(i + step + btns.length) % btns.length];
    b.focus(); b.click();
  });
  return box;
}
function paintPicker() {
  for (const b of $$('.bc-tchip')) { const on = b.dataset.k === S.type; b.classList.toggle('bc-on', on); b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; }
}

function render() {
  main.textContent = '';
  els = {};
  els.preview = h('div', { class: 'bc-paper', id: 'bc-preview' });
  els.badge = h('div', { class: 'bc-badge', role: 'status', 'aria-live': 'polite' });
  els.chips = h('div', { class: 'bc-stage-meta' });
  els.form = h('div', { class: 'ed-fields bc-form' });
  els.error = h('div', { class: 'bc-error', role: 'alert' });
  els.info = h('div', { class: 'bc-info' });
  els.design = h('div', { class: 'ed-fields' });
  els.warn = h('div', { class: 'bc-warn' });

  // role=status on the badge: the scan-check result is announced politely when it arrives.
  const stage = h('div', { class: 'bc-stage ap-surface ap-plain' }, h('div', { class: 'bc-stage-in' }, els.preview, h('div', { class: 'bc-stage-foot' }, els.badge, els.chips)));
  const content = card('bc.content', typePicker(), els.form, els.error);
  content.classList.add('bc-a');
  const infoCard = card('bc.info', els.info);
  infoCard.classList.add('bc-c');
  const exportCard = card('bc.export', renderExport());
  const stageCol = h('div', { class: 'bc-col bc-s' }, stage, els.warn, exportCard);
  const right = h('div', { class: 'bc-col bc-d' }, card('bc.design', els.design));
  main.append(h('div', { class: 'bc-work' }, content, stageCol, infoCard, right));
  paintPicker();
  renderForm();
  renderDesign();
  update();
}

// --- content forms -------------------------------------------------------------------------------------------

function inputFor(key, attrs = {}) {
  return textInput(S.inputs[key] ?? '', (v) => { S.inputs[key] = v; changed(); }, attrs);
}
const hint = (k, vars) => h('div', { class: 'ed-hint' }, t(k, vars));

function renderForm() {
  const box = els.form, o = S.opts;
  box.textContent = '';
  const add = (...kids) => box.append(...kids);
  const k = S.type;
  switch (k) {
    // Accepted digit counts per type: with or without the check digit (the encoder completes and verifies it).
    case 'ean13': case 'ean8': case 'upca': case 'upce': {
      const n = { ean13: '12 / 13', ean8: '7 / 8', upca: '11 / 12', upce: '6 / 7 / 8 · 11 / 12' }[k];
      add(field('bc.f.number', inputFor(k, { inputmode: 'numeric', autocomplete: 'off', class: 'ed-input bc-mono', placeholder: typeInfo(k).example }), '=' + t('bc.h.digits', { n })));
      add(field('bc.f.addon', textInput(o.addon, (v) => { o.addon = v; changed(); }, { inputmode: 'numeric', class: 'ed-input bc-mono', placeholder: '51299', maxlength: 5 }), 'bc.h.addon'));
      if (k === 'ean13') add(scaleBuilder());
      break;
    }
    case 'ean2': case 'ean5':
      add(field('bc.f.number', inputFor(k, { inputmode: 'numeric', class: 'ed-input bc-mono', maxlength: k === 'ean2' ? 2 : 5 }), k === 'ean2' ? 'bc.h.ean2' : 'bc.h.ean5'));
      break;
    case 'itf14':
      add(field('bc.f.number', inputFor(k, { inputmode: 'numeric', class: 'ed-input bc-mono' }), 'bc.h.itf14'));
      break;
    case 'itf':
      add(field('bc.f.number', inputFor(k, { inputmode: 'numeric', class: 'ed-input bc-mono' }), 'bc.h.itf'));
      add(field('bc.f.addCheck', toggle(o.itfCheck, (v) => { o.itfCheck = v; changed(); })));
      add(ratioField());
      break;
    case 'code128':
      add(field('bc.f.text', inputFor(k, { class: 'ed-input bc-mono', dir: 'ltr' }), 'bc.h.code128'));
      add(field('bc.f.fnc1', toggle(o.fnc1, (v) => { o.fnc1 = v; changed(); }), 'bc.h.fnc1'));
      break;
    case 'code39':
      add(field('bc.f.text', inputFor(k, { class: 'ed-input bc-mono', dir: 'ltr' }), o.fullAscii39 ? 'bc.h.code39full' : 'bc.h.code39'));
      add(field('bc.f.fullAscii', toggle(o.fullAscii39, (v) => { o.fullAscii39 = v; renderForm(); changed(); })));
      add(field('bc.f.check43', toggle(o.check39, (v) => { o.check39 = v; changed(); })));
      add(ratioField());
      break;
    case 'code93':
      add(field('bc.f.text', inputFor(k, { class: 'ed-input bc-mono', dir: 'ltr' }), 'bc.h.code93'));
      break;
    case 'codabar': {
      add(field('bc.f.text', inputFor(k, { class: 'ed-input bc-mono', dir: 'ltr' }), 'bc.h.codabar'));
      const ss = ['A', 'B', 'C', 'D'].map((v) => ({ v, l: '=' + v }));
      add(h('div', { class: 'ed-grid2' },
        group('bc.f.start', seg(ss, o.codabarStart, (v) => { o.codabarStart = v; changed(); }, 'bc.f.start')),
        group('bc.f.stop', seg(ss, o.codabarStop, (v) => { o.codabarStop = v; changed(); }, 'bc.f.stop'))));
      add(field('bc.f.check16', toggle(o.codabarCheck, (v) => { o.codabarCheck = v; changed(); })));
      break;
    }
    case 'datamatrix':
      add(field('bc.f.text', inputFor(k, { multiline: true, rows: 4, dir: 'auto' }), 'bc.h.dm'));
      add(group('bc.f.shape', seg([{ v: 'square', l: 'bc.shape.square' }, { v: 'rect', l: 'bc.shape.rect' }, { v: 'any', l: 'bc.shape.any' }], o.dmShape, (v) => { o.dmShape = v; changed(); }, 'bc.f.shape')));
      break;
    case 'gs1-128': case 'gs1-datamatrix':
      add(gs1Builder());
      if (k === 'gs1-datamatrix') add(group('bc.f.shape', seg([{ v: 'square', l: 'bc.shape.square' }, { v: 'rect', l: 'bc.shape.rect' }, { v: 'any', l: 'bc.shape.any' }], o.dmShape, (v) => { o.dmShape = v; changed(); }, 'bc.f.shape')));
      break;
  }
}

function ratioField() {
  const o = S.opts;
  return group('bc.f.ratio', seg([2, 2.5, 3].map((v) => ({ v, l: `=${v} : 1` })), o.ratio, (v) => { o.ratio = +v; changed(); }, 'bc.f.ratio'), t('bc.h.ratio'));
}

// In-store scale codes: template, item, weight / price -> EAN-13 into the number field.
// In-store (restricted, prefix 2) EAN-13 codes embed an item number and a weight or price; the builder writes the
// result into the EAN-13 field, so the normal pipeline (check digit, verification) applies to it.
function scaleBuilder() {
  const sc = S.scale;
  const out = h('div', { class: 'ed-hint bc-mono' });
  const paint = () => {
    try {
      const code = buildScaleCode(sc.template, { item: sc.item, value: parseFloat(String(sc.value).replace(',', '.')) || 0 });
      out.textContent = code;
      out.dataset.code = code;
    } catch (e) { out.textContent = t('bc.scale.bad'); delete out.dataset.code; }
  };
  const tpl = select(Object.entries(SCALE_TEMPLATES).map(([k, v]) => ({ v: k, l: `=${t('bc.scale.' + k)} · ${v.template}` })), sc.template, (v) => { sc.template = v; save(); paint(); });
  const use = button('bc.scale.use', 'check', () => {
    if (!out.dataset.code) return;
    S.inputs.ean13 = out.dataset.code;
    renderForm(); changed();
  });
  use.classList.add('ed-sm');
  paint();
  return h('details', { class: 'bc-details' }, h('summary', {}, iconEl('chevRight'), h('span', {}, t('bc.scale.title'))),
    h('div', { class: 'ed-fields' },
      field('bc.scale.template', tpl),
      h('div', { class: 'ed-grid2' },
        field('bc.scale.item', textInput(sc.item, (v) => { sc.item = v; save(); paint(); }, { inputmode: 'numeric', class: 'ed-input bc-mono' })),
        field('bc.scale.value', textInput(sc.value, (v) => { sc.value = v; save(); paint(); }, { inputmode: 'decimal', class: 'ed-input bc-mono' }))),
      h('div', { class: 'ed-row' }, out, h('span', { class: 'ed-spacer' }), use),
      hint('bc.scale.hint')));
}

// --- GS1 element builder -------------------------------------------------------------------------------------

// AI table is long (hundreds of entries with implied-decimal families such as 310n); the datalist keeps the first
// definition per AI and drops decimal variants above 6.
const AI_OPTIONS = (() => {
  // Families with implied decimals are listed once per decimal count only for 0-6 (the common ones).
  const seen = new Set();
  return allAIs().filter((d) => {
    if (d.dec && d.decimals > 6) return false;
    if (seen.has(d.ai)) return false;
    seen.add(d.ai);
    return true;
  });
})();

function gs1Builder() {
  const wrap = h('div', { class: 'bc-gs1' });
  const list = h('div', { class: 'bc-gs1-rows' });
  const datalist = h('datalist', { id: 'bc-ai-list' }, AI_OPTIONS.map((d) => h('option', { value: d.ai }, `${d.ai} — ${d.title}${d.dec ? ` (${d.decimals})` : ''}`)));
  const paintRows = () => {
    list.textContent = '';
    S.gs1.forEach((r, i) => {
      const def = aiDefinition(r.ai.trim());
      const issues = def ? validateElement(r.ai.trim(), r.value) : r.ai ? [{ code: 'unknown' }] : [];
      const msg = h('div', { class: 'bc-gs1-msg' + (issues.length ? ' bc-bad' : '') }, def ? `${def.title} · ${def.spec}` : r.ai ? t('bc.gs1.unknown') : '');
      if (issues.length) msg.append(' — ', issues.map((x) => t('bc.gs1.issue.' + x.code)).join(', '));
      // AI input keeps digits only, at most 4 (GS1 AIs are 2 to 4 digits).
      const ai = h('input', { class: 'ed-input bc-mono bc-gs1-ai', value: r.ai, list: 'bc-ai-list', inputmode: 'numeric', 'aria-label': t('bc.gs1.ai'), placeholder: 'AI' });
      ai.addEventListener('input', () => { r.ai = ai.value.replace(/\D/g, '').slice(0, 4); changed(); repaintMsg(); });
      const val = h('input', { class: 'ed-input bc-mono', value: r.value, 'aria-label': t('bc.gs1.value'), spellcheck: 'false', autocomplete: 'off', placeholder: def ? def.spec : '' });
      val.addEventListener('input', () => { r.value = val.value; changed(); repaintMsg(); });
      const del = h('button', { type: 'button', class: 'ed-iconbtn', title: t('bc.gs1.remove'), 'aria-label': t('bc.gs1.remove'), html: icon('trash'), onclick: () => { S.gs1.splice(i, 1); paintRows(); changed(); } });
      const row = h('div', { class: 'bc-gs1-row' }, ai, val, del, msg);
      // Updates only the message line while typing (keeps focus in the inputs).
      function repaintMsg() {
        const d = aiDefinition(r.ai.trim());
        const is = d ? validateElement(r.ai.trim(), r.value) : r.ai ? [{ code: 'unknown' }] : [];
        msg.className = 'bc-gs1-msg' + (is.length ? ' bc-bad' : '');
        msg.textContent = d ? `${d.title} · ${d.spec}` : r.ai ? t('bc.gs1.unknown') : '';
        if (is.length) msg.append(' — ', is.map((x) => t('bc.gs1.issue.' + x.code)).join(', '));
        val.placeholder = d ? d.spec : '';
      }
      list.append(row);
    });
  };
  paintRows();
  const addBtn = button('bc.gs1.add', 'plus', () => { S.gs1.push({ ai: '', value: '' }); paintRows(); changed(); const last = $$('.bc-gs1-ai', list).at(-1); if (last) last.focus(); });
  addBtn.classList.add('ed-sm');
  const paste = h('input', { class: 'ed-input bc-mono', placeholder: t('bc.gs1.pastePh'), 'aria-label': t('bc.gs1.paste'), spellcheck: 'false' });
  // One paste field reads every GS1 notation parseGs1 understands: HRI with parentheses, raw with GS separators, and
  // Digital Link URLs. Issues found while parsing downgrade the toast to a warning.
  const take = () => {
    const p = parseGs1(paste.value.trim());
    if (!p.elements.length) { toast(t('bc.gs1.pasteNone'), 'warn'); return; }
    S.gs1 = p.elements.map((e) => ({ ai: e.ai, value: e.value }));
    paste.value = '';
    paintRows(); changed();
    toast(t('bc.gs1.pasted', { n: p.elements.length }), p.issues.length ? 'warn' : 'ok');
  };
  paste.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); take(); } });
  const pasteBtn = button('bc.gs1.read', 'paste', take);
  pasteBtn.classList.add('ed-sm');
  wrap.append(datalist, h('div', { class: 'ed-label' }, t('bc.gs1.elements')), list, h('div', { class: 'ap-actions' }, addBtn),
    field('bc.gs1.paste', h('div', { class: 'ed-row' }, paste, pasteBtn), 'bc.gs1.pasteHint'));
  return wrap;
}

// --- design ------------------------------------------------------------------------------------------------------

function renderDesign() {
  const d = S.design, box = els.design;
  if (!box) return;
  box.textContent = '';
  const add = (...kids) => box.append(...kids);
  if (isMatrix(S.type)) {
    // Matrix codes: module size; EAN: magnification; others: X-dimension and bar height (logistics types get their own
    // hint, GS1 logistics labels have minimum heights).
    add(field('bc.d.module', range({ min: 0.25, max: 1.5, step: 0.05, value: d.xdim, unit: ' mm', onInput: (v) => { d.xdim = v; changed(); } }), 'bc.h.module'));
  } else if (isEan()) {
    add(field('bc.d.mag', range({ min: 80, max: 200, step: 5, value: d.mag, unit: ' %', onInput: (v) => { d.mag = v; changed(); } }), 'bc.h.mag'));
  } else {
    add(field('bc.d.xdim', range({ min: 0.17, max: 1.02, step: 0.01, value: d.xdim, unit: ' mm', onInput: (v) => { d.xdim = v; changed(); } }), S.type === 'itf14' ? 'bc.h.xdimItf' : 'bc.h.xdim'));
    add(field('bc.d.height', range({ min: 5, max: 60, step: 0.5, value: d.height, unit: ' mm', onInput: (v) => { d.height = v; changed(); } }), S.type === 'gs1-128' || S.type === 'itf14' ? 'bc.h.heightLog' : 'bc.h.height'));
  }
  if (!isMatrix(S.type)) {
    add(field('bc.d.text', toggle(d.text, (v) => { d.text = v; changed(); })));
    add(field('bc.d.font', range({ min: 60, max: 160, step: 5, value: d.font, unit: ' %', onInput: (v) => { d.font = v; changed(); } })));
    // Bar width reduction (BWR) compensates ink spread in print: bars are drawn thinner by this many mm.
    add(field('bc.d.bwr', range({ min: 0, max: 0.1, step: 0.005, value: d.bwr, unit: ' mm', onInput: (v) => { d.bwr = v; changed(); } }), 'bc.h.bwr'));
  }
  add(field('bc.d.quiet', toggle(d.quiet, (v) => { d.quiet = v; changed(); }), 'bc.h.quiet'));
  if (S.type === 'itf14') add(group('bc.d.bearer', seg([{ v: 'frame', l: 'bc.bearer.frame' }, { v: 'bars', l: 'bc.bearer.bars' }, { v: 'none', l: 'bc.bearer.none' }], d.bearer, (v) => { d.bearer = v; changed(); }, 'bc.d.bearer')));
  add(h('div', { class: 'ed-grid2' },
    field('bc.d.fg', colorInput(d.fg, (v) => { d.fg = v; changed(); })),
    field('bc.d.bg', colorInput(d.bg, (v) => { d.bg = v; changed(); }))));
  add(field('bc.d.transparent', toggle(d.transparent, (v) => { d.transparent = v; changed(); })));
  const reset = button('bc.d.reset', 'undo', () => { S.design = structuredClone(DEF.design); renderDesign(); changed(); });
  reset.classList.add('ed-sm');
  add(h('div', { class: 'ap-actions' }, reset));
}

// --- export ------------------------------------------------------------------------------------------------------

function renderExport() {
  const dpi = select([150, 200, 300, 600, 1200].map((v) => ({ v, l: `=${v} dpi` })), S.dpi, (v) => { S.dpi = +v; save(); paintPngNote(); });
  dpi.setAttribute('aria-label', t('bc.x.dpi'));
  els.pngNote = h('div', { class: 'ed-hint', id: 'bc-png-note' });
  const b = (label, ic, fn, kind) => { const x = button(label, ic, fn, kind); x.classList.add('bc-xbtn'); return x; };
  return h('div', { class: 'bc-export' },
    h('div', { class: 'ap-actions' }, b('bc.x.svg', 'download', exportSVG, 'primary'), b('bc.x.png', 'image', exportPNG), dpi),
    els.pngNote,
    h('div', { class: 'ap-actions' }, b('bc.x.copySvg', 'copy', () => R.made && copyText(svgMarkup(), t('bc.x.copiedSvg'))), b('bc.x.copyPng', 'copy', copyImage), b('bc.x.print', 'print', printDialog)));
}

function svgMarkup() {
  // SVG export in real millimetres (unit 'mm'): placed in a layout program it prints at the exact specified size.
  const x = xdim();
  return R.made.svg({ ...layoutOpts(), ...colours(), unit: 'mm', xdim: x, widthReduction: S.design.bwr / x, title: R.made.sym.hri || S.type });
}

// Whole pixels per module at the chosen DPI, and the X-dimension that results.
// PNG at a DPI must use whole pixels per module (see common.js symbolCanvas), so the real X-dimension is rounded;
// the note warns when the rounding moves it by more than 8 %.
function pngScale() {
  const ppm = Math.max(1, Math.round(xdim() / 25.4 * S.dpi));
  return { ppm, actual: ppm * 25.4 / S.dpi };
}
function paintPngNote() {
  if (!els.pngNote) return;
  if (!R.made) { els.pngNote.textContent = ''; return; }
  const { ppm, actual } = pngScale();
  const off = Math.abs(actual - xdim()) / xdim();
  els.pngNote.textContent = t('bc.x.pngNote', { ppm, x: fmtNum(actual, 3) }) + (off > 0.08 ? ' ' + t('bc.x.pngOff') : '');
}

// File names keep only safe characters from the human-readable text; capped at 60.
const baseName = () => (S.type + '-' + String(R.made?.sym.hri || 'code').replace(/[^\w.-]+/g, '_')).slice(0, 60);

function exportSVG() { if (R.made) download(svgMarkup(), baseName() + '.svg', 'image/svg+xml'); }

function pngCanvas() {
  const { ppm } = pngScale();
  return symbolCanvas(R.made, { ppm, ...layoutOpts(), ...colours() });
}
async function exportPNG() {
  if (!R.made) return;
  try { download(await canvasBlob(pngCanvas()), baseName() + '.png', 'image/png'); } catch (e) { toast(t('err.generic', { msg: e.message }), 'error'); }
}
async function copyImage() {
  if (!R.made) return;
  // Clipboard images need ClipboardItem (secure context). Passing a Promise of the blob (not the blob) keeps the
  // write inside the user gesture in Safari, which rejects writes that start after an await.
  if (!(navigator.clipboard && navigator.clipboard.write && typeof ClipboardItem !== 'undefined')) { toast(t('bc.x.copyPngNo'), 'warn'); return; }
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': canvasBlob(pngCanvas()) })]);
    toast(t('bc.x.copiedPng'), 'ok');
  } catch { toast(t('bc.x.copyPngNo'), 'warn'); }
}

function printDialog() {
  if (!R.made) return;
  const p = S.print;
  const body = h('div', { class: 'ed-fields' },
    group('bc.p.copies', seg([1, 4, 12, 24, 40].map((v) => ({ v, l: '=' + v })), p.copies, (v) => { p.copies = +v; save(); }, 'bc.p.copies')),
    field('bc.p.caption', textInput(p.caption, (v) => { p.caption = v; save(); }, { placeholder: t('bc.p.captionPh') })),
    hint('bc.p.hint'));
  openDialog({ title: t('bc.p.title'), body, buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('bc.p.go'), value: 'go', primary: true }] })
    .then((v) => { if (v === 'go') printSheet(); });
}

// Same print strategy as receipt-studio: a temporary sheet appended to <body>, everything else hidden by app.css.
// KNOWN DEFECT: done() also runs 1 s after print() returns; where print() does not block (some mobile browsers) the
// sheet can disappear before the preview captures it. Fix: rely on 'afterprint' (plus matchMedia('print') change).
function printSheet() {
  const p = S.print, svg = svgMarkup();
  let sheet = $('#bc-print');
  if (sheet) sheet.remove();
  sheet = h('div', { id: 'bc-print', class: 'bc-print' });
  for (let i = 0; i < p.copies; i++) sheet.append(h('figure', { class: 'bc-print-cell' }, h('div', { class: 'bc-print-code', html: svg }), p.caption ? h('figcaption', {}, p.caption) : null));
  document.body.append(sheet);
  document.body.classList.add('bc-printing');
  const done = () => { document.body.classList.remove('bc-printing'); sheet.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { window.print(); setTimeout(done, 1000); }, 50);
}

// ---------------------------------------------------------------------------------------------------------------
// Update: input -> symbol -> preview, info, warnings, scan check

const changed = () => { save(); updateSoon(); };
const updateSoon = debounce(() => update(), 60);
const verifySoon = debounce(() => verify(), 260);

function update() {
  R.made = null; R.error = null;
  try { R.made = makeSymbol(S.type, encoderInput(), encoderOpts()); } catch (e) { R.error = e; }
  els.error.textContent = '';
  const prev = els.preview;
  if (R.made) {
    // Preview at 3 px per module in px units: CSS scales it to the stage width; proportions are what matter on screen.
    const x = xdim();
    // The preview keeps true proportions; its width follows the stage (CSS), the mm size is shown below.
    R.svg = R.made.svg({ ...layoutOpts(), ...colours(), unit: 'px', xdim: 3, widthReduction: S.design.bwr / x, title: t('bc.previewAlt') });
    prev.className = 'bc-paper' + (S.design.transparent ? ' bc-transparent' : '') + (R.made.kind === 'matrix' ? ' bc-paper-matrix' : '');
    // innerHTML of generated SVG: produced locally by the encoders from validated data; titles go through the SVG
    // writer's escaping.
    prev.innerHTML = R.svg;
  } else {
    prev.className = 'bc-paper bc-empty';
    prev.innerHTML = '';
    prev.append(h('div', { class: 'bc-empty-art', html: icon('barcode') }), h('p', {}, R.error ? errorText(R.error) : t('bc.empty')));
    if (R.error && R.error.code !== 'empty') els.error.append(h('div', { class: 'ed-hint ed-hint-warn' }, errorText(R.error)));
  }
  paintChips();
  paintInfo();
  paintWarnings();
  paintPngNote();
  // New token: any verification still running for the previous input will discard its result.
  R.token++;
  for (const b of $$('.bc-export button')) b.disabled = !R.made;
  if (R.made) { setBadge('checking'); verifySoon(); } else setBadge('idle');
}

function paintChips() {
  const box = els.chips;
  box.textContent = '';
  if (!R.made) return;
  const x = xdim(), m = R.made.modules(layoutOpts());
  const chip = (s) => h('span', { class: 'bc-chip-info' }, s);
  box.append(chip(typeInfo(S.type).name), chip(`${fmtNum(m.width * x, 1)} × ${fmtNum(m.height * x, 1)} mm`));
  if (R.made.kind === 'matrix') box.append(chip(`${R.made.sym.rows}×${R.made.sym.cols}`));
  else box.append(chip(`X ${fmtNum(x, 3)} mm`));
}

function paintInfo() {
  const box = els.info;
  box.textContent = '';
  if (!R.made) { box.append(h('div', { class: 'ap-empty' }, t('bc.i.none'))); return; }
  const s = R.made.sym;
  const rows = [['bc.i.type', typeInfo(S.type).name]];
  // Byte data (Uint8Array) is not shown as text; GS separators are made visible.
  if (s.data != null && !(s.data instanceof Uint8Array)) rows.push(['bc.i.data', showGS(s.data)]);
  if (s.hri && s.hri !== s.data) rows.push(['bc.i.hri', s.hri]);
  rows.push(...describeNumber(S.type, s.data));
  if (s.check != null && !Array.isArray(s.check) && R.made.kind === 'linear' && !['ean13', 'ean8', 'upca', 'upce', 'itf14'].includes(S.type)) rows.push(['bc.i.checkChar', String(s.check)]);
  if (Array.isArray(s.check)) rows.push(['bc.i.checkChar', s.check.join(', ')]);
  if (R.made.kind === 'linear') rows.push(['bc.i.modules', String(Math.round(s.width * 100) / 100)]);
  if (R.made.kind === 'matrix') rows.push(['bc.i.size', `${s.rows} × ${s.cols}`], ['bc.i.codewords', t('bc.i.cw', { data: s.size.data, ecc: s.size.ecc })]);
  if (s.values) rows.push(['bc.i.symbols', String(s.values.length)]);
  box.append(kvRows(rows));
  // Scale-code reading of restricted EAN-13 numbers.
  // A restricted-range EAN-13 starting with 2 may be an in-store code: show how the current template reads it.
  if (S.type === 'ean13' && s.data) {
    const p = gs1Prefix(s.data);
    if (p && p.kind === 'restricted' && s.data[0] === '2') {
      const w = parseScaleCode(s.data, S.scale.template);
      if (w.ok) box.append(kvRows([['bc.i.scaleItem', w.item], ['bc.i.scaleValue', `${w.value} ${w.unit === 'kg' ? 'kg' : w.unit === 'pcs' ? t('bc.unit.pcs') : ''}`.trim()]]));
    }
  }
  // GS1 elements and Digital Link.
  if (s.elements) {
    // Elements are normalised through a build/parse round trip so the table shows parsed dates and amounts.
    const p = parseGs1(buildGs1(s.elements).hri);
    const table = h('table', { class: 'bc-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'AI'), h('th', {}, t('bc.gs1.title')), h('th', {}, t('bc.gs1.value')))),
      h('tbody', {}, p.elements.map((e) => h('tr', {}, h('td', { class: 'bc-mono' }, e.ai), h('td', {}, e.title || '—'),
        h('td', { class: 'bc-mono' }, e.value, e.date ? h('div', { class: 'ed-hint' }, e.date) : e.number != null ? h('div', { class: 'ed-hint' }, (e.currency ? e.currency + ' ' : '') + e.number) : null)))));
    box.append(table);
    const link = toDigitalLink(s.elements);
    if (link) {
      const c = button('bc.i.copyLink', 'copy', () => copyText(link)); c.classList.add('ed-sm');
      box.append(h('div', { class: 'bc-dl' }, h('div', { class: 'ed-label' }, t('bc.i.link')), h('code', { class: 'bc-mono bc-wrap' }, link), c));
    }
  }
}

function paintWarnings() {
  // Scan-reliability heuristics: contrast below 2.5 fails, below 5 warns (luminance contrast ratio as in WCAG).
  // Inverted (light bars on dark ground) fails many scanners. Pure red bars vanish under red-laser scanners. Missing
  // quiet zones, small magnification, and very short linear codes are warned about.
  const d = S.design, out = [];
  const bg = d.transparent ? '#ffffff' : d.bg;
  const r = contrastRatio(d.fg, bg);
  if (Number.isFinite(r) && r < 2.5) out.push(['error', t('bc.w.contrastBad', { r: r.toFixed(1) })]);
  else if (Number.isFinite(r) && r < 5) out.push(['warn', t('bc.w.contrastLow', { r: r.toFixed(1) })]);
  if (contrastRatio(d.fg, '#000000') > contrastRatio(bg, '#000000')) out.push(['error', t('bc.w.inverted')]);
  if (/^#?(?:f{2}|e[0-9a-f])(?:[0-9a-f]{2})0{2}$/i.test(d.fg) || /^#?f{2}0{2}0{2}$/i.test(d.fg)) out.push(['warn', t('bc.w.red')]);
  if (!d.quiet) out.push(['warn', t('bc.w.quiet')]);
  if (d.transparent) out.push(['info', t('bc.w.transparent')]);
  if (isEan() && d.mag < 80) out.push(['warn', t('bc.w.small')]);
  if (!isEan() && !isMatrix(S.type) && R.made && d.height < 0.15 * R.made.sym.width * xdim() && d.height < 6.35) out.push(['info', t('bc.w.short')]);
  if (S.type === 'itf14' && d.xdim < 0.495) out.push(['info', t('bc.w.itfSmall')]);
  els.warn.textContent = '';
  for (const [k, msg] of out) els.warn.append(h('div', { class: 'bc-w bc-w-' + k, role: k === 'error' ? 'alert' : null }, iconEl(k === 'info' ? 'info' : 'warn'), h('span', {}, msg)));
}

function setBadge(state) {
  R.verify = state;
  const b = els.badge;
  b.className = 'bc-badge bc-badge-' + state;
  b.dataset.state = state;
  b.textContent = '';
  if (state === 'idle') return;
  b.append(iconEl({ checking: 'refresh', ok: 'ok', fail: 'warn', na: 'info' }[state]), h('span', {}, t('bc.verify.' + state)));
}

// Draws the symbol at 3 px per module and reads it back (linear: barcode/decode.js; matrix: the codewords).
// One macrotask of delay lets the preview paint before the CPU-heavy decode starts. Matrix codes are verified at the
// codeword level (read back and decode), linear codes by rasterising without text and scanning 9 lines.
async function verify() {
  const token = R.token, made = R.made;
  if (!made) return;
  await new Promise((r) => setTimeout(r, 0));
  if (token !== R.token) return;
  try {
    if (made.kind === 'matrix') {
      const dm = made.sym;
      const back = decodeCodewords(readCodewords(dm.matrix, dm.size).slice(0, dm.size.data));
      setBadge(back && back.text === (dm.data instanceof Uint8Array ? String.fromCharCode(...dm.data) : dm.data) ? 'ok' : 'fail');
      return;
    }
    if (S.type === 'ean2' || S.type === 'ean5') { setBadge('na'); return; }
    const c = symbolCanvas(made, { ppm: 3, ...layoutOpts(), text: false, fg: S.design.fg, bg: S.design.transparent ? '#ffffff' : S.design.bg });
    const img = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    const res = scanImage(img, { lines: 9, rotate: false });
    if (token !== R.token) return;
    const s = made.sym;
    // UPC-A may come back as an EAN-13 with a leading 0 (r.upca holds the UPC form); add-on digits must match too.
    const ok = res.some((r) => (r.text === s.data || (r.upca && r.upca === s.data)) && (!s.addon || r.addon === s.addon.digits));
    setBadge(ok ? 'ok' : 'fail');
  } catch {
    if (token === R.token) setBadge('fail');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Content handed over by the scanner or the batch page: #type=<key>&text=<encoded>

// Hand-over from the scan or batch page: #type=...&text=... in the URL. The hash is removed right away so a
// reload does not re-apply it over later edits. GS characters are stripped for non-GS1 types.
function readHash() {
  const p = new URLSearchParams((location.hash || '').slice(1));
  const type = p.get('type'), text = p.get('text');
  if (!type || text == null) return;
  history.replaceState(null, '', location.pathname + location.search);
  if (!TYPES.some((x) => x.key === type)) return;
  S.type = type;
  if (typeInfo(type).kind === 'gs1') {
    const g = parseGs1(text);
    if (g.elements.length) S.gs1 = g.elements.map((e) => ({ ai: e.ai, value: e.value }));
  } else S.inputs[type] = text.replace(new RegExp(GS, 'g'), '');
  save();
  setTimeout(() => toast(t('bc.fromScan'), 'ok'), 300);
}

readHash();
startShell('create', () => render());
render();
