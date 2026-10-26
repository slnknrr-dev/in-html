// unit-converter/tables.js - the tables page: printable conversion cheat sheets. A sheet holds several tables
// (presets: m² ↔ sq ft, °C ↔ °F, kg ↔ lb, clothing cm ↔ in, height in feet and inches, km ↔ mi, km/h ↔ mph, l ↔ gal,
// g ↔ oz), each with its own range, step, decimals, an optional reverse direction and compound forms. The sheet is
// printed with its own print CSS (controls hidden, tables in columns, rows never split) or copied as text.
//
// Design rules of this page:
// - State = { title, cols, sel, sheet[] }; each table spec keeps start/end/step as the *typed strings*, not numbers,
//   so a half-typed "1," or a comma decimal survives a reload exactly as the user left it. Parsing happens at paint
//   time (valuesOf), and an unreadable spec renders an inline error instead of throwing.
// - Ids are runtime-only (nextId counter) and stripped on save: they only need to be unique within one page life,
//   and persisting them would require collision handling across reloads for no benefit. Selection is persisted as
//   an index instead (selIndex) and mapped back to an id on load.
// - MAX_ROWS caps every table: a step of 0.001 over 1..1000 would otherwise build a million <tr> and freeze the tab.
//   series() is asked for MAX_ROWS + 1 values so "was it cut?" is known without computing the full length.
// - Two render levels like the converter: changed(true) rebuilds the editor (selection or units changed), plain
//   paintSheet() only repaints the sheet so typing in an editor field keeps focus.
import { COMPOUND, compound, fmt, lab, niceStep, series, startShell, tableEl, uname, unitSelect } from './common.js';
import { button, card, copyText, field, seg, t, textInput, toast, toggle } from '../ui/app.js';
import { $, debounce, h, lsGet, lsSet } from '../ui/dom.js';
import { icon, iconEl } from '../ui/icons.js';
import { KINDS, convert, unit as unitOf } from '../units/registry.js';
import { parseNumber } from '../units/parse.js';
import { COMMON_PAIRS } from '../units/tables.js';

const MAX_ROWS = 200;

// Presets reference units by registry code; a renamed code would silently drop the preset from loadState's filter,
// so tests (e2e.js) click presets by key to catch that.
// Presets: key (title in strings), pair, range, step, decimals, reverse, compound.
const PRESETS = [
  { key: 'area', from: 'm2', to: 'sqft', start: 10, end: 200, step: 10, digits: 1, both: true },
  { key: 'temp', from: 'c', to: 'f', start: -30, end: 40, step: 5, digits: 0, both: true },
  { key: 'mass', from: 'kg', to: 'lb', start: 5, end: 100, step: 5, digits: 1, both: true },
  { key: 'clothing', from: 'cm', to: 'in', start: 60, end: 130, step: 5, digits: 1, both: false },
  { key: 'height', from: 'cm', to: 'ft', start: 150, end: 200, step: 5, digits: 0, both: false, comp: true },
  { key: 'distance', from: 'km', to: 'mi', start: 5, end: 100, step: 5, digits: 1, both: true },
  { key: 'speed', from: 'kmh', to: 'mph', start: 20, end: 130, step: 10, digits: 0, both: true },
  { key: 'volume', from: 'l', to: 'gal', start: 1, end: 20, step: 1, digits: 2, both: false },
  { key: 'cooking', from: 'g', to: 'oz', start: 50, end: 500, step: 50, digits: 1, both: false },
  { key: 'land', from: 'sotka', to: 'acre', start: 1, end: 20, step: 1, digits: 2, both: false },
];

let nextId = 1;
// A title starting with '@' means "preset title, translate at render": storing the translated text would freeze the
// language it was added in. '@' is safe as a marker because titleOf() checks only the first character and users
// rarely start a title with it (a user title "@x" would be looked up as a preset key and fall back to from/to).
const specOf = (p, title = '') => ({ id: nextId++, from: p.from, to: p.to, start: String(p.start), end: String(p.end), step: String(p.step), digits: p.digits, both: !!p.both, comp: !!p.comp, title: title || (p.key ? '@' + p.key : '') });

// ---------------------------------------------------------------------------------------------------------------
// State (localStorage 'uc-tables')

const SKEY = 'uc-tables';
// Same whitelist approach as the converter: invalid tables are dropped, invalid fields fall back to defaults.
// str() accepts numbers too defensively: a hand-edited entry may hold numbers.
function loadState() {
  const saved = lsGet(SKEY, null) || {};
  const s = { title: '', cols: 2, sel: 0, sheet: PRESETS.slice(0, 4).map((p) => specOf(p)) };
  if (typeof saved.title === 'string') s.title = saved.title.slice(0, 80);
  if ([1, 2, 3].includes(saved.cols)) s.cols = saved.cols;
  if (Array.isArray(saved.sheet)) {
    const str = (v, d) => (typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, 20) : d);
    s.sheet = saved.sheet.filter((x) => x && unitOf(x.from) && unitOf(x.to) && unitOf(x.from).kind === unitOf(x.to).kind).slice(0, 24).map((x) => ({
      id: nextId++, from: x.from, to: x.to, start: str(x.start, '1'), end: str(x.end, '10'), step: str(x.step, '1'),
      digits: [0, 1, 2, 3, 4].includes(x.digits) ? x.digits : 2, both: !!x.both, comp: !!x.comp, title: typeof x.title === 'string' ? x.title.slice(0, 80) : '',
    }));
  }
  s.sel = s.sheet[Math.max(0, Math.min(s.sheet.length - 1, +saved.selIndex || 0))]?.id || 0;
  return s;
}
const S = loadState();
// Destructuring { id, ...x } drops the runtime id from each saved spec (see header).
const save = debounce(() => lsSet(SKEY, { title: S.title, cols: S.cols, selIndex: S.sheet.findIndex((x) => x.id === S.sel), sheet: S.sheet.map(({ id, ...x }) => x) }), 250);
const selected = () => S.sheet.find((x) => x.id === S.sel) || null;

// Title of a table: its own, a preset's, or "from → to".
const titleOf = (x) => (x.title.startsWith('@') ? t('uc.t.p.' + x.title.slice(1)) : x.title) || `${uname(x.from)} → ${uname(x.to)}`;

// The source values of a table and whether they were cut at MAX_ROWS.
// st <= 0 is rejected explicitly: a zero or negative step would make series() loop forever or yield nothing.
function valuesOf(x) {
  const a = parseNumber(x.start), b = parseNumber(x.end), st = parseNumber(x.step);
  if (![a, b, st].every(Number.isFinite) || st <= 0) return { values: [], bad: true };
  const all = series(a, b, st, MAX_ROWS + 1);
  return { values: all.slice(0, MAX_ROWS), cut: all.length > MAX_ROWS };
}

// The reverse direction on round numbers of the target unit over the same span.
// Reverse table: not the forward values converted (those would be 10.764, 21.528 ... ugly), but round numbers of
// the target unit over the same span, with their own nice step. ceil() aligns the start to the step grid.
function reverseValues(x, values) {
  if (!values.length) return [];
  const a = convert(values[0], x.from, x.to), b = convert(values.at(-1), x.from, x.to);
  const step = niceStep(Math.abs(b - a) / Math.max(1, values.length - 1));
  const start = Math.ceil(Math.min(a, b) / step) * step;
  return series(start, Math.max(a, b), step, MAX_ROWS);
}

// ---------------------------------------------------------------------------------------------------------------
// Layout

const main = $('#main');
main.classList.add('uc-tables');
let els = {};

function render() {
  main.textContent = '';
  els = {};
  els.editor = h('div', { class: 'ed-fields' });
  els.sheet = h('div', { class: 'uc-sheet', id: 'uc-sheet' });
  els.sheetTitle = h('h2', { class: 'uc-sheet-title' });
  // Clicking a preset appends a new table (never replaces) and selects it, so the editor immediately shows it.
  const presets = h('div', { class: 'uc-chips', role: 'list' }, PRESETS.map((p) => h('button', {
    type: 'button', class: 'uc-chip', role: 'listitem', dataset: { p: p.key }, title: `${lab(p.from)} → ${lab(p.to)}`,
    onclick: () => { const x = specOf(p); S.sheet.push(x); S.sel = x.id; changed(true); toast(t('uc.t.added', { name: titleOf(x) }), 'ok'); },
  }, iconEl('plus'), h('span', {}, t('uc.t.p.' + p.key)))));
  const custom = button('uc.t.custom', 'plus', () => { const x = specOf({ from: 'm', to: 'ft', start: 1, end: 20, step: 1, digits: 2 }); S.sheet.push(x); S.sel = x.id; changed(true); });
  custom.classList.add('ed-sm');
  const sheetOpts = h('div', { class: 'ed-fields' },
    field('uc.t.sheetTitle', textInput(S.title, (v) => { S.title = v; save(); paintSheet(); }, { placeholder: t('uc.t.sheetDefault') })),
    group('uc.t.cols', seg([1, 2, 3].map((n) => ({ v: n, l: '=' + n })), S.cols, (v) => { S.cols = +v; save(); paintSheet(); }, 'uc.t.cols'), t('uc.t.colsHint')));
  const side = h('div', { class: 'uc-col uc-tside' },
    card('uc.t.presets', presets, h('div', { class: 'ap-actions' }, custom)),
    card('uc.t.edit', els.editor),
    card('uc.t.sheet', sheetOpts));
  const tools = h('div', { class: 'ap-row uc-ttools' },
    button('uc.t.print', 'print', () => window.print(), 'primary'),
    button('uc.t.copy', 'copy', copySheet),
    h('span', { class: 'ed-spacer' }),
    button('uc.t.clear', 'trash', () => { if (!S.sheet.length) return; S.sheet = []; S.sel = 0; changed(true); }));
  const stage = h('div', { class: 'uc-col uc-tstage' }, tools, h('div', { class: 'uc-paper' }, els.sheetTitle, els.sheet));
  main.append(h('div', { class: 'uc-twork' }, side, stage));
  renderEditor();
  paintSheet();
}

let gid = 0;
// See main.js group(): names a non-labelable control via aria-labelledby. 'uc-tg' prefix keeps ids distinct from
// the converter's 'uc-g' (convention; the pages never share a document).
function group(label, control, hint) {
  const id = 'uc-tg' + (++gid);
  control.setAttribute('aria-labelledby', id);
  return h('div', { class: 'ed-field' }, h('span', { class: 'ed-label', id }, t(label)), control, hint ? h('div', { class: 'ed-hint' }, hint) : null);
}

const changed = (editor) => { save(); if (editor) renderEditor(); paintSheet(); };

// --- editor of the selected table --------------------------------------------------------------------------------

function renderEditor() {
  const box = els.editor;
  box.textContent = '';
  const x = selected();
  if (!x) { box.append(h('div', { class: 'ed-hint' }, t('uc.t.noSel'))); return; }
  const kind = unitOf(x.from).kind;
  const kindSel = h('select', { class: 'ed-input ed-select' }, KINDS.map((k) => h('option', { value: k, selected: k === kind }, t('uc.kind.' + k))));
  // Changing the kind resets from/to to the first common pair of that kind (units/tables.js): keeping the old units
  // would leave a length table labelled as area. title and comp are reset because both depend on the units.
  kindSel.addEventListener('change', () => {
    const [a, b] = (COMMON_PAIRS[kindSel.value] || [])[0] || [];
    if (!a) return;
    Object.assign(x, { from: a, to: b, title: '', comp: false });
    changed(true);
  });
  const num = (key) => {
    // Per-field invalid marker, live: the field turns red while unreadable; the sheet shows the error card meanwhile.
    const i = textInput(x[key], (v) => { x[key] = v; i.classList.toggle('uc-invalid', !Number.isFinite(parseNumber(v))); save(); paintSheet(); }, { inputmode: 'decimal', class: 'ed-input uc-num' });
    return i;
  };
  // Swap recomputes the range from reverseValues(), so the swapped table starts on round target numbers.
  // toPrecision(10) strips float noise from the step (0.30000000000000004 becomes 0.3) before it becomes text.
  const swap = button('uc.t.swap', 'swap', () => {
    const vals = valuesOf(x).values;
    const rev = reverseValues(x, vals);
    Object.assign(x, { from: x.to, to: x.from, title: x.title.startsWith('@') ? '' : x.title, comp: false });
    if (rev.length > 1) Object.assign(x, { start: String(rev[0]), end: String(rev.at(-1)), step: String(+(rev[1] - rev[0]).toPrecision(10)) });
    changed(true);
  });
  swap.classList.add('ed-sm');
  box.append(
    field('uc.t.title', textInput(x.title.startsWith('@') ? titleOf(x) : x.title, (v) => { x.title = v; save(); paintSheet(); }, { placeholder: `${uname(x.from)} → ${uname(x.to)}` })),
    field('uc.t.kind', kindSel),
    h('div', { class: 'ed-grid2' },
      // comp (compound form) is only valid for targets with a compound definition; changing the unit clears it so a
      // hidden toggle cannot keep an impossible setting alive.
      field('uc.t.from', unitSelect(x.from, (v) => { x.from = v; if (!COMPOUND[x.to]) x.comp = false; changed(true); }, { kind })),
      field('uc.t.to', unitSelect(x.to, (v) => { x.to = v; if (!COMPOUND[v]) x.comp = false; changed(true); }, { kind }))),
    h('div', { class: 'ap-row' }, swap),
    h('div', { class: 'uc-grid3' }, field('uc.t.start', num('start')), field('uc.t.end', num('end')), field('uc.t.step', num('step'))),
    group('uc.t.digits', seg([0, 1, 2, 3].map((n) => ({ v: n, l: '=' + n })), x.digits, (v) => { x.digits = +v; save(); paintSheet(); }, 'uc.t.digits')),
    field('uc.t.both', toggle(x.both, (v) => { x.both = v; save(); paintSheet(); }), 'uc.t.bothHint'),
    ...(COMPOUND[x.to] ? [field('uc.t.comp', toggle(x.comp, (v) => { x.comp = v; save(); paintSheet(); }), t('uc.t.compHint', { e: compound(convert(180, 'cm', 'ft'), 'ft') }))] : []),
  );
}

// --- the sheet ---------------------------------------------------------------------------------------------------

function paintSheet() {
  els.sheetTitle.textContent = S.title || t('uc.t.sheetDefault');
  const box = els.sheet;
  box.textContent = '';
  // Column count goes to CSS as a custom property (grid template in app.css) and as data-cols for print rules that
  // cannot read custom properties inside selectors.
  box.style.setProperty('--uc-cols', String(S.cols));
  box.dataset.cols = String(S.cols);
  if (!S.sheet.length) { box.append(h('div', { class: 'ap-empty uc-noprint' }, t('uc.t.empty'))); return; }
  for (const x of S.sheet) {
    const { values, cut, bad } = valuesOf(x);
    const on = x.id === S.sel;
    const head = h('div', { class: 'uc-tcard-h' },
      h('h3', {}, titleOf(x)),
      h('span', { class: 'ed-spacer' }),
      // Buttons inside the figure are .uc-noprint: controls never reach paper. aria-pressed on edit mirrors selection.
      h('button', { type: 'button', class: 'ed-iconbtn uc-noprint', title: t('uc.t.editOne'), 'aria-label': t('uc.t.editOne') + ': ' + titleOf(x), 'aria-pressed': String(on), html: icon('edit'), onclick: () => { S.sel = x.id; changed(true); $('.uc-tside .ed-input')?.focus(); } }),
      h('button', { type: 'button', class: 'ed-iconbtn uc-noprint', title: t('uc.t.remove'), 'aria-label': t('uc.t.remove') + ': ' + titleOf(x), html: icon('trash'), onclick: () => removeTable(x) }));
    const tables = h('div', { class: 'uc-tpair' });
    if (bad) tables.append(h('div', { class: 'ed-hint uc-bad' }, t('uc.t.bad')));
    else {
      tables.append(tableEl(x.from, x.to, values, { digits: x.digits, useCompound: x.comp }));
      if (x.both) tables.append(tableEl(x.to, x.from, reverseValues(x, values), { digits: x.digits }));
    }
    // <figure> + <figcaption>: each table is a self-contained unit with caption, which print CSS keeps unsplit.
    const fig = h('figure', { class: 'uc-tcard' + (on ? ' uc-on' : ''), dataset: { id: String(x.id) } }, head, tables,
      cut ? h('figcaption', { class: 'ed-hint uc-noprint' }, t('uc.t.cut', { n: MAX_ROWS })) : null,
      h('figcaption', { class: 'uc-tfoot' }, t('uc.t.rows', { n: values.length })));
    // Click anywhere on a card selects it, except on its buttons (they have their own actions); closest('button')
    // covers clicks on the icon <svg> inside a button.
    fig.addEventListener('click', (e) => { if (!e.target.closest('button') && S.sel !== x.id) { S.sel = x.id; changed(true); } });
    box.append(fig);
  }
}

function removeTable(x) {
  const i = S.sheet.indexOf(x);
  S.sheet.splice(i, 1);
  // After removal select the table that took its place (same index), or the new last one; 0 = none.
  if (S.sel === x.id) S.sel = S.sheet[Math.min(i, S.sheet.length - 1)]?.id || 0;
  changed(true);
  toast(t('uc.t.removed', { name: titleOf(x) }), 'ok');
}

// The sheet as tab-separated text (pastes into spreadsheets as columns).
// Tab-separated, ungrouped numbers: spreadsheets split on tabs and would misread "1 076,4" with grouping spaces.
function copySheet() {
  const out = [S.title || t('uc.t.sheetDefault'), ''];
  for (const x of S.sheet) {
    const { values, bad } = valuesOf(x);
    if (bad) continue;
    const block = (from, to, vals, comp) => [`${lab(from)}\t${lab(to)}`, ...vals.map((v) => { const r = convert(v, from, to); return `${fmt(v, x.digits, { grouping: false })}\t${(comp && compound(r, to)) || fmt(r, x.digits, { grouping: false })}`; })];
    out.push(titleOf(x), ...block(x.from, x.to, values, x.comp));
    if (x.both) out.push('', ...block(x.to, x.from, reverseValues(x, values), false));
    out.push('');
  }
  copyText(out.join('\n'));
}

startShell('tables', () => render());
render();
