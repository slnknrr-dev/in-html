// newbuild-board/board.js - the board page: the "chessboard" of every building (sections side by side, floors from the
// top, risers lined up by estate/chessboard.js), coloured by sale status or by a heat scale of the price per m², the
// filters (rooms, area, floor, view, price, status) that dim what does not match, the unit card (area, room summary
// and layout kind from the layout's room tree, a layout sketch, price, price per m², the GEL equivalent, a quick
// mortgage estimate, status and price editing with the history), bulk changes of the filtered units (price by a
// percentage or by a rate per m², status) with undo, and statistics (sold share, revenue, average price per m² by
// room count and by building).
//
// State split: P = the shared project (saved under 'nb-project', changes visible on every page), S = this page's
// view settings (mode, building, currency, filters, bulk form; saved under 'nb-board'). Filters are view state:
// they dim cells but never alter data. render() builds the static frame once; update() repaints every derived part
// (head, count, legend, board, tiles, statistics) from P and S, cheap enough for 2000 units on each change.
import {
  FILTER_DEF, ROOM_OPTS, VIEWS, areaText, buildingOf, changeUnit, chips, complexTitle, ensurePlanCss, filterActive, group,
  hasGel, kilo, kvRows, layoutInfo, layoutSketch, loadProject, matches, money, natural, num, numOf, onProjectChange, pageHref,
  pctText, readyLabel, roomsShort, roomsText, saveProject, shown, startShell, statusText, tile, toGel, viewText, withCurrency,
} from './common.js';
import { button, card, field, seg, select, t, textInput, toast, toggle } from '../ui/app.js';
import { $, $$, debounce, h, lsGet, lsSet } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { confirmDialog, openDialog } from '../ui/overlays.js';
import { UNIT_STATUSES, chessboard, pricePerM2, unitPlans, unitPrice, unitStats } from '../estate/chessboard.js';
import { loanMonthly } from '../estate/mortgage.js';
import { decimalText, mulDiv, toMinor } from '../ledger/minor.js';

// ---------------------------------------------------------------------------------------------------------------
// State: the project (shared by the pages) and the board's own view settings (localStorage 'nb-board')

let P = loadProject();
const BKEY = 'nb-board';
const DEF = {
  mode: 'status', building: 'all', cur: 'main',
  f: structuredClone(FILTER_DEF),
  bulk: { action: 'pct', pct: '3', rate: '', step: '100', status: 'reserved', freeOnly: true },
};
// View settings restored field by field with type checks: a corrupt or old 'nb-board' entry degrades to defaults
// per field instead of breaking the page. structuredClone keeps DEF pristine for the reset button.
const S = (() => {
  const s = structuredClone(DEF), v = lsGet(BKEY, null) || {};
  if (['status', 'heat'].includes(v.mode)) s.mode = v.mode;
  if (typeof v.building === 'string') s.building = v.building;
  if (['main', 'GEL'].includes(v.cur)) s.cur = v.cur;
  if (v.f && typeof v.f === 'object') {
    for (const k of ['rooms', 'views', 'status']) if (Array.isArray(v.f[k])) s.f[k] = v.f[k].filter((x) => typeof x === 'string').slice(0, 10);
    for (const k of ['areaMin', 'areaMax', 'floorMin', 'floorMax', 'priceMax']) if (typeof v.f[k] === 'string') s.f[k] = v.f[k].slice(0, 20);
  }
  if (v.bulk && typeof v.bulk === 'object') for (const k of Object.keys(s.bulk)) if (typeof v.bulk[k] === typeof s.bulk[k]) s.bulk[k] = v.bulk[k];
  return s;
})();
const save = debounce(() => lsSet(BKEY, S), 250);
const commit = () => saveProject(P);
// Single-level undo of the last bulk change: snapshots of exactly the touched units (not the whole project).
let undo = null;              // { before: [{ id, price, status, hist }] } of the last bulk change

const cur = () => P.complex.currency;
// A building filter pointing to a deleted building silently means "all".
const scopeUnits = () => (S.building === 'all' || !buildingOf(P, S.building) ? P.units : P.units.filter((u) => u.building === S.building));
const scopeBuildings = () => P.buildings.filter((b) => S.building === 'all' || !buildingOf(P, S.building) || b.id === S.building);
const showCur = () => (S.cur === 'GEL' && hasGel(P) ? 'GEL' : 'main');

// ---------------------------------------------------------------------------------------------------------------
// Layout

const main = $('#main');
// ap-wide: the shell lets this page use the full width (the board needs it).
main.classList.add('nb-board', 'ap-wide');
let els = {};

function render() {
  main.textContent = '';
  els = {};
  ensurePlanCss();
  // role=status + aria-live: screen readers hear "12 of 140 units" after each filter change without moving focus.
  els.count = h('div', { class: 'nb-count', role: 'status', 'aria-live': 'polite' });
  els.tiles = h('div', { class: 'nb-tiles' });
  els.legend = h('div', { class: 'nb-legend' });
  els.board = h('div', { class: 'nb-boards' });
  els.head = h('div', { class: 'nb-cx' });
  els.stats = h('div', { class: 'nb-stats' });

  const mode = seg([{ v: 'status', l: 'nb.b.byStatus', icon: 'board' }, { v: 'heat', l: 'nb.b.byPrice', icon: 'chart' }], S.mode, (v) => { S.mode = v; save(); update(); }, 'nb.b.mode');
  const bsel = select([{ v: 'all', l: 'nb.b.allBuildings' }, ...P.buildings.map((b) => ({ v: b.id, l: '=' + b.name }))], buildingOf(P, S.building) ? S.building : 'all', (v) => { S.building = v; save(); update(); });
  const toolbar = h('div', { class: 'nb-toolbar' }, group('nb.b.mode', mode), field('nb.b.building', bsel));
  if (hasGel(P)) toolbar.append(group('nb.b.currency', seg([{ v: 'main', l: '=' + cur() }, { v: 'GEL', l: '=GEL' }], showCur(), (v) => { S.cur = v; save(); update(); }, 'nb.b.currency')));
  // The scrolling board is a focusable region so keyboard users can scroll it horizontally with arrow keys.
  const scroll = h('div', { class: 'nb-scroll', tabindex: '0', role: 'region', 'aria-label': t('nb.b.title') }, els.board);
  const boardCard = h('section', { class: 'ap-card nb-board-card' }, els.head, toolbar, els.legend, scroll);
  const side = h('div', { class: 'ap-side nb-side' }, filtersCard(), bulkCard());
  const stage = h('div', { class: 'ap-stage' }, els.tiles, boardCard, card('nb.st.title', els.stats));
  main.append(h('div', { class: 'ap-work nb-work' }, side, stage));
  update();
}

// Filter typing repaints after 120ms of quiet: with 2000 cells a repaint per keystroke would lag.
const updateSoon = debounce(() => update(), 120);

function update() {
  paintHead();
  paintCount();
  paintLegend();
  paintBoard();
  paintTiles();
  paintStats();
  paintBulkInfo();
}

function paintHead() {
  const box = els.head;
  box.textContent = '';
  box.append(h('h2', { class: 'nb-cx-name' }, complexTitle(P)), h('div', { class: 'nb-cx-meta' }, [P.complex.address, P.complex.developer].filter(Boolean).join(' · ')));
}

function paintCount() {
  const list = scopeUnits();
  const n = list.filter((u) => matches(P, u, S.f)).length;
  els.count.textContent = filterActive(S.f) ? t('nb.f.count', { n, m: list.length }) : t('nb.f.all', { n: list.length });
}

// --- filters -----------------------------------------------------------------------------------------------------

function filtersCard() {
  const f = S.f;
  const on = () => { save(); updateSoon(); };
  const inp = (k, ph) => textInput(f[k], (v) => { f[k] = v; on(); }, { inputmode: 'decimal', placeholder: ph, autocomplete: 'off', class: 'ed-input nb-num', id: 'nb-f-' + k });
  const rooms = chips(ROOM_OPTS.map((v) => ({ v, l: v === '0' ? t('nb.rooms.studioShort') : v === '4' ? '4+' : v })), f.rooms, on, 'nb.f.rooms');
  const views = chips(VIEWS.map((v) => ({ v, l: viewText(v) })), f.views, on, 'nb.f.view');
  const status = chips(UNIT_STATUSES.map((v) => ({ v, l: statusText(v) })), f.status, on, 'nb.f.status');
  const reset = button('nb.f.reset', 'undo', () => { S.f = structuredClone(FILTER_DEF); save(); render(); });
  reset.classList.add('ed-sm');
  return card('nb.f.title',
    h('div', { class: 'ed-fields' },
      group('nb.f.rooms', rooms),
      h('div', { class: 'ed-grid2' }, field('nb.f.areaMin', inp('areaMin', 'm²')), field('nb.f.areaMax', inp('areaMax', 'm²'))),
      h('div', { class: 'ed-grid2' }, field('nb.f.floorMin', inp('floorMin', '')), field('nb.f.floorMax', inp('floorMax', ''))),
      field('nb.f.priceMax', inp('priceMax', cur()), '=' + t('nb.f.priceHint', { c: cur() })),
      group('nb.f.view', views),
      group('nb.f.status', status)),
    h('div', { class: 'ap-actions nb-f-foot' }, els.count, h('span', { class: 'ed-spacer' }), reset));
}

// --- bulk changes ------------------------------------------------------------------------------------------------

function bulkCard() {
  const B = S.bulk;
  els.bulkInfo = h('div', { class: 'nb-bulk-info', role: 'status', 'aria-live': 'polite' });
  els.bulkFields = h('div', { class: 'ed-fields' });
  const act = seg([{ v: 'pct', l: 'nb.bulk.pct' }, { v: 'rate', l: 'nb.bulk.rate' }, { v: 'status', l: 'nb.bulk.status' }], B.action, (v) => { B.action = v; save(); paintBulkFields(); }, 'nb.bulk.action');
  const apply = button('nb.bulk.apply', 'check', applyBulk, 'primary');
  apply.id = 'nb-bulk-apply';
  els.undo = button('dlg.undo', 'undo', undoBulk);
  els.undo.id = 'nb-bulk-undo';
  els.undo.disabled = !undo;
  paintBulkFields();
  return card('nb.bulk.title', els.bulkInfo,
    h('div', { class: 'ed-fields' }, group('nb.bulk.action', act), els.bulkFields,
      field('nb.bulk.freeOnly', toggle(B.freeOnly, (v) => { B.freeOnly = v; save(); paintBulkInfo(); }))),
    h('div', { class: 'ap-actions' }, apply, els.undo));
}

function paintBulkFields() {
  const B = S.bulk, box = els.bulkFields;
  box.textContent = '';
  const step = () => field('nb.bulk.step', select(['1', '10', '100', '1000'].map((v) => ({ v, l: '=' + money(toMinor(v, cur()), cur()) })), B.step, (v) => { B.step = v; save(); }));
  if (B.action === 'pct') {
    box.append(h('div', { class: 'ed-grid2' },
      field('nb.bulk.pctV', textInput(B.pct, (v) => { B.pct = v; save(); }, { inputmode: 'decimal', class: 'ed-input nb-num', id: 'nb-bulk-pct' })), step()),
    h('div', { class: 'ed-hint' }, t('nb.bulk.pctHint')));
  } else if (B.action === 'rate') {
    box.append(h('div', { class: 'ed-grid2' },
      field('=' + t('nb.bulk.rateV', { c: cur() }), textInput(B.rate, (v) => { B.rate = v; save(); }, { inputmode: 'decimal', class: 'ed-input nb-num' })), step()),
    h('div', { class: 'ed-hint' }, t('nb.bulk.rateHint')));
  } else {
    box.append(field('nb.bulk.newStatus', select(UNIT_STATUSES.map((v) => ({ v, l: '=' + statusText(v) })), B.status, (v) => { B.status = v; save(); })));
  }
}

// Bulk changes act on what the user sees: the current building scope AND the filters, optionally free units only
// (repricing sold flats would rewrite history that already happened).
const bulkTargets = () => scopeUnits().filter((u) => matches(P, u, S.f) && (!S.bulk.freeOnly || u.status === 'free'));

function paintBulkInfo() {
  if (!els.bulkInfo) return;
  const n = bulkTargets().length;
  els.bulkInfo.textContent = t(S.bulk.freeOnly ? 'nb.bulk.targetsFree' : 'nb.bulk.targets', { n });
  els.bulkInfo.dataset.n = String(n);
}

async function applyBulk() {
  const B = S.bulk, list = bulkTargets(), c = cur();
  if (!list.length) { toast(t('nb.bulk.none'), 'warn'); return; }
  // Prices are rounded to a step (1, 10, 100, 1000 currency units): price lists use round numbers.
  const step = Math.max(1, toMinor(B.step, c));
  let change, what;
  if (B.action === 'pct') {
    const pct = numOf(B.pct);
    // Sanity bounds: -90%..+500%, not 0. A typo like 30 instead of 3 still passes, hence the confirm dialog below.
    if (pct == null || pct <= -90 || pct > 500 || pct === 0) { toast(t('nb.bulk.badPct'), 'warn'); return; }
    // Integer arithmetic: factor k = (100 + pct) * 1000, so price * k / 100000 via mulDiv (exact, no float drift);
    // pct keeps three decimals of precision.
    const k = Math.round((100 + pct) * 1000);
    change = (u) => ({ price: u.price > 0 ? Math.max(step, Math.round(mulDiv(u.price, k, 100000) / step) * step) : 0 });
    what = t('nb.bulk.whatPct', { p: (pct > 0 ? '+' : '') + num(pct, 3) });
  } else if (B.action === 'rate') {
    const rate = toMinor(B.rate, c);
    if (!(rate > 0)) { toast(t('nb.bulk.badRate'), 'warn'); return; }
    // unitPrice(area, rate, step): area x rate per m², rounded to the step (estate/chessboard.js).
    change = (u) => ({ price: u.area > 0 ? unitPrice(u.area, rate, step) : u.price });
    what = t('nb.bulk.whatRate', { r: money(rate, c) });
  } else {
    change = () => ({ status: B.status });
    what = t('nb.bulk.whatStatus', { s: statusText(B.status) });
  }
  if (!(await confirmDialog(t('nb.bulk.title'), t('nb.bulk.confirm', { n: list.length, what }), t('dlg.apply')))) return;
  // Snapshot before mutating: price, status and the history length to truncate back to.
  const before = list.map((u) => ({ id: u.id, price: u.price, status: u.status, hist: u.history.length }));
  let n = 0;
  for (const u of list) if (changeUnit(u, change(u), 'bulk')) n++;
  undo = { before };
  commit();
  update();
  els.undo.disabled = false;
  toast(t('nb.bulk.done', { n }), 'ok', { label: t('dlg.undo'), fn: undoBulk });
}

// KNOWN DEFECT: undo truncates history to the saved length, but when a unit's history was already at HISTORY_MAX,
// changeUnit dropped the oldest line and the length did not grow, so the bulk line stays and the dropped line is
// lost. Undo also reverts any manual change made after the bulk one. Fix: snapshot a copy of u.history and restore
// it, and clear `undo` on any later manual change.
function undoBulk() {
  if (!undo) return;
  for (const b of undo.before) {
    const u = P.units.find((x) => x.id === b.id);
    if (!u) continue;
    u.price = b.price;
    u.status = b.status;
    if (u.history.length > b.hist) u.history.length = b.hist;
  }
  undo = null;
  commit();
  update();
  if (els.undo) els.undo.disabled = true;
  toast(t('nb.bulk.undone'), 'info');
}

// --- the board -----------------------------------------------------------------------------------------------------

// Heat scale spans the min..max price per m² of the units in scope (units without price or area are excluded).
function heatRange(list) {
  const v = list.map(pricePerM2).filter((x) => x > 0);
  return v.length ? { min: Math.min(...v), max: Math.max(...v) } : null;
}

function paintLegend() {
  const box = els.legend;
  box.textContent = '';
  const list = scopeUnits();
  if (S.mode === 'heat') {
    const r = heatRange(list);
    if (!r) return;
    const w = showCur();
    box.append(h('span', { class: 'nb-lg-l' }, t('nb.b.ppm')), h('span', { class: 'nb-lg-v' }, shown(P, r.min, w)),
      h('span', { class: 'nb-heatbar', 'aria-hidden': 'true' }), h('span', { class: 'nb-lg-v' }, shown(P, r.max, w)));
    return;
  }
  for (const s of UNIT_STATUSES) {
    const n = list.filter((u) => u.status === s).length;
    box.append(h('span', { class: 'nb-lg' }, h('i', { class: 'nb-sw nb-s-' + s, 'aria-hidden': 'true' }), statusText(s), h('b', {}, String(n))));
  }
  if (filterActive(S.f)) box.append(h('span', { class: 'nb-lg' }, h('i', { class: 'nb-sw nb-sw-dim', 'aria-hidden': 'true' }), t('nb.b.dimmed')));
  box.append(h('span', { class: 'nb-lg nb-lg-k' }, t('nb.b.kNote', { c: showCur() === 'GEL' ? 'GEL' : cur() })));
}

function paintBoard() {
  const box = els.board;
  box.textContent = '';
  const list = scopeUnits();
  const heat = S.mode === 'heat' ? heatRange(list) : null;
  for (const b of scopeBuildings()) {
    const units = list.filter((u) => u.building === b.id);
    if (units.length) box.append(buildingBlock(b, units, heat));
  }
  if (!box.children.length) box.append(h('div', { class: 'ap-empty' }, t('nb.b.empty')));
}

function buildingBlock(b, units, heat) {
  const sections = [...new Set(units.map((u) => u.section))].sort(natural);
  // Risers are numbered through the floor (section 2 starts at 4): each section's grid starts at its own first riser.
  // chessboard() (estate/) aligns units into columns by riser/position and rows by floor; one grid per section, and
  // the table concatenates them, so a section with a different floor count still lines up by floor number.
  const per = sections.map((s) => {
    const list = units.filter((u) => u.section === s);
    const pos = list.map((u) => u.position).filter(Boolean);
    const shift = pos.length ? Math.min(...pos) - 1 : 0;
    return { s, cb: chessboard(shift ? list.map((u) => (u.position ? { ...u, position: u.position - shift } : u)) : list) };
  });
  // Floors top-down like the facade; units with an unknown floor end up in a last row.
  const floors = [...new Set(units.map((u) => u.floor))].sort((x, y) => (y ?? -1e9) - (x ?? -1e9));
  // Sold share counts only sellable units: closed (withdrawn) units would make a sold-out building look unfinished.
  const sold = units.filter((u) => u.status === 'sold').length, sellable = units.filter((u) => u.status !== 'closed').length;
  const meta = [readyLabel(b.ready), t('nb.b.units', { n: units.length }), sellable ? t('nb.b.soldPct', { p: pctText(sold / sellable, 0) }) : ''].filter(Boolean).join(' · ');
  const table = h('table', { class: 'nb-grid', 'aria-label': b.name, dataset: { building: b.id } });
  const thead = h('tr', {}, h('th', { scope: 'col', class: 'nb-fl' }, t('nb.b.floor')));
  // colgroup headers per section: a screen reader announces "Section 2" along with the cell position.
  for (const { s, cb } of per) thead.append(h('th', { scope: 'colgroup', colspan: String(cb.columns || 1), class: 'nb-sec' }, t('nb.b.section', { s })));
  const body = h('tbody');
  floors.forEach((f, r) => {
    const tr = h('tr', {}, h('th', { scope: 'row', class: 'nb-fl' }, f == null ? '—' : String(f)));
    let c = 0;
    for (const { cb } of per) {
      const row = cb.rows.find((x) => x.floor === f);
      const cells = row ? row.slots || row.cells : [];
      for (let i = 0; i < Math.max(1, cb.columns); i++) {
        const u = cells[i];
        tr.append(h('td', { class: i === 0 ? 'nb-s0' : null }, u ? cellButton(u, r, c, heat) : null));
        c++;
      }
    }
    body.append(tr);
  });
  table.append(h('thead', {}, thead), body);
  // Roving tabindex: only one cell per building is in the tab order (the first, then the last focused); arrow keys
  // move inside. Tabbing through 300 cells to leave the board would be unusable.
  const first = table.querySelector('.nb-cell');
  if (first) first.tabIndex = 0;
  table.addEventListener('keydown', (e) => gridKeys(e, table));
  table.addEventListener('focusin', (e) => {
    const cell = e.target.closest('.nb-cell');
    if (!cell) return;
    for (const x of $$('.nb-cell[tabindex="0"]', table)) if (x !== cell) x.tabIndex = -1;
    cell.tabIndex = 0;
  });
  return h('div', { class: 'nb-building' }, h('div', { class: 'nb-bhead' }, h('h3', {}, iconEl('building'), b.name), h('span', { class: 'nb-bmeta' }, meta)), table);
}

function cellButton(u, r, c, heat) {
  const m = matches(P, u, S.f);
  const ppm = pricePerM2(u);
  const w = showCur();
  let style = null, hot = false;
  if (heat && ppm) {
    // Normalised position on the heat scale; equal min and max (one price level) puts every cell in the middle.
    const p = heat.max > heat.min ? (ppm - heat.min) / (heat.max - heat.min) : 0.5;
    style = { '--p': Math.round(p * 100) + '%' };
    // Above 55% the fill is dark enough to need white text (see .nb-hot in app.css).
    hot = p > 0.55;
  }
  // The full description goes to aria-label and title; the visible cell shows abbreviated numbers only.
  const label = [t('nb.unit.flat', { n: u.flat }), roomsText(u.rooms), areaText(u.area), u.price ? shown(P, u.price, w) : '', statusText(u.status)].filter(Boolean).join(', ');
  return h('button', {
    type: 'button', class: `nb-cell nb-s-${u.status}${m ? '' : ' nb-dim'}${style ? ' nb-heat' : ''}${hot ? ' nb-hot' : ''}`, tabindex: '-1',
    'aria-label': label, title: label, style,
    dataset: { id: u.id, r: String(r), c: String(c), price: String(u.price), floor: u.floor == null ? '' : String(u.floor), m: m ? '1' : '0' },
    onclick: () => openUnit(u.id),
  },
  h('span', { class: 'nb-c-top' }, h('b', {}, u.flat), h('span', { class: 'nb-c-r' }, roomsShort(u.rooms))),
  h('span', { class: 'nb-c-a' }, u.area ? num(u.area, 1) : '—'),
  h('span', { class: 'nb-c-p' }, heat ? (ppm ? shown(P, ppm, w) : '—') : u.price ? kilo(w === 'GEL' ? toGel(P, u.price) : u.price, w === 'GEL' ? 'GEL' : cur()) : '—'));
}

// Arrow keys move between the cells of one building (empty slots are skipped), Home / End go to the row ends.
function gridKeys(e, table) {
  const cell = e.target.closest('.nb-cell');
  const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
  if (!cell || (!d && e.key !== 'Home' && e.key !== 'End')) return;
  e.preventDefault();
  const r0 = +cell.dataset.r, c0 = +cell.dataset.c;
  const all = $$('.nb-cell', table);
  let next = null;
  if (e.key === 'Home' || e.key === 'End') {
    const row = all.filter((x) => +x.dataset.r === r0);
    next = e.key === 'Home' ? row[0] : row.at(-1);
  } else {
    // In RTL layouts visual left/right are mirrored, so the column delta flips.
    const rtl = getComputedStyle(table).direction === 'rtl';
    const dc = rtl ? -d[1] : d[1];
    // The nearest cell in that direction: along the axis first, then the smallest sideways offset.
    let best = Infinity;
    for (const x of all) {
      const dr = +x.dataset.r - r0, cc = +x.dataset.c - c0;
      const along = d[0] ? dr * d[0] : cc * dc;
      if (along <= 0) continue;
      const side = d[0] ? Math.abs(cc) : Math.abs(dr);
      const score = along * 1000 + side;
      if (score < best) { best = score; next = x; }
    }
  }
  if (next) next.focus();
}

// --- unit card ---------------------------------------------------------------------------------------------------

function openUnit(id) {
  const u = P.units.find((x) => x.id === id);
  if (!u) return;
  const wrap = h('div', { class: 'nb-unit', dataset: { id: u.id } });
  const paint = () => { wrap.textContent = ''; wrap.append(...unitBody(u, paint)); };
  paint();
  // Closing the dialog returns focus to the cell that opened it (CSS.escape: unit ids may contain any character).
  openDialog({ title: t('nb.unit.title', { b: buildingOf(P, u.building)?.name || u.building, n: u.flat }), body: wrap, wide: true, className: 'nb-unit-dlg', buttons: [{ label: t('dlg.close'), value: null, primary: true }] })
    .then(() => { const back = document.querySelector(`.nb-cell[data-id="${CSS.escape(u.id)}"]`); if (back) back.focus(); });
}

function unitBody(u, repaint) {
  const c = cur(), b = buildingOf(P, u.building), li = layoutInfo(P, u);
  const ppm = pricePerM2(u);
  const gel = hasGel(P) && u.price ? toGel(P, u.price) : null;
  const rows = [
    ['nb.unit.building', b ? b.name : u.building], ['nb.unit.section', u.section], ['nb.unit.floor', u.floor == null ? '—' : String(u.floor)],
    ['nb.unit.rooms', roomsText(u.rooms)], ['nb.unit.area', areaText(u.area)], ['nb.unit.view', viewText(u.view)],
    ['nb.unit.price', u.price ? money(u.price, c) : '—'], ['nb.unit.gel', gel != null ? money(gel, 'GEL') + ' · ' + t('nb.unit.rate', { r: num(P.complex.gelRate, 4), c }) : ''],
    ['nb.unit.ppm', ppm ? money(ppm, c) : '—'],
  ];
  if (li) {
    rows.push(['nb.unit.layout', t('nb.layout.' + (li.kind.layout || 'rooms')) + (li.word ? ' · ' + li.word : '')]);
    rows.push(['nb.unit.summary', [roomsText(li.sum.rooms), t('nb.unit.bedrooms', { n: li.sum.bedrooms }), t('nb.unit.baths', { n: li.sum.bath }), t('nb.unit.roomsArea', { a: num(li.sum.area, 1) })].join(', ')]);
  }
  if (b && b.ready) rows.push(['nb.unit.ready', readyLabel(b.ready) + (b.handover ? ' · ' + b.handover : '')]);

  // Status and price edits write a history line (changeUnit) and repaint both the card and the board behind it.
  const status = seg(UNIT_STATUSES.map((s) => ({ v: s, l: '=' + statusText(s) })), u.status, (v) => {
    if (changeUnit(u, { status: v }, 'manual')) { commit(); update(); repaint(); toast(t('nb.unit.statusSet', { s: statusText(v) }), 'ok'); }
  }, 'nb.unit.status');
  status.classList.add('nb-status-seg');
  const priceIn = textInput(u.price ? decimalText(u.price, c) : '', () => {}, { inputmode: 'decimal', class: 'ed-input nb-num' });
  const setPrice = () => {
    const m = toMinor(priceIn.value, c);
    if (!(m > 0)) { toast(t('nb.unit.badPrice'), 'warn'); return; }
    if (changeUnit(u, { price: m }, 'manual')) { commit(); update(); repaint(); toast(t('nb.unit.priceSet', { p: money(m, c) }), 'ok'); }
  };
  priceIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); setPrice(); } });
  const saveBtn = button('nb.unit.savePrice', 'check', setPrice);
  saveBtn.classList.add('ed-sm');

  // Rough monthly payment with fixed assumptions (30% down, 10 years, 12%): a teaser; the mortgage page does it
  // properly and receives the unit through #unit=.
  const est = u.price ? loanMonthly(u.price, { downPct: 30, years: 10, ratePct: 12 }) : null;
  const loan = h('a', { class: 'ed-btn', href: pageHref('pg-mortgage') + '#unit=' + encodeURIComponent(u.id) }, iconEl('bank'), t('nb.unit.mortgage'));
  const left = h('div', { class: 'nb-unit-main' }, kvRows(rows),
    group('nb.unit.status', status),
    field('=' + t('nb.unit.newPrice', { c }), h('div', { class: 'ed-row' }, priceIn, saveBtn)),
    h('h3', { class: 'nb-sub' }, t('nb.unit.history')), historyList(u));
  const right = h('div', { class: 'nb-unit-side' });
  if (li) {
    const svg = layoutSketch(li.def, t('nb.unit.sketch'));
    if (svg) right.append(h('figure', { class: 'nb-sketch' }, h('div', { class: 'nb-sketch-svg', html: svg }), h('figcaption', {}, t('nb.unit.sketchNote'))));
  }
  if (est) right.append(h('div', { class: 'nb-est' }, h('div', { class: 'nb-est-v' }, t('nb.unit.perMonth', { m: money(est.monthly, c) })), h('div', { class: 'ed-hint' }, t('nb.unit.estNote', { d: money(est.down, c) })), loan));
  return [left, right];
}

function historyList(u) {
  const c = cur();
  if (!u.history.length) return h('div', { class: 'ed-hint' }, t('nb.unit.noHistory'));
  // Newest first.
  return h('ol', { class: 'nb-hist' }, [...u.history].reverse().map((e) => h('li', {},
    h('span', { class: 'nb-hist-d' }, e.d),
    h('span', {}, [e.s ? statusText(e.s) : '', e.p != null ? money(e.p, c) : ''].filter(Boolean).join(' · ')),
    e.by && e.by !== 'manual' ? h('span', { class: 'ed-tag' }, t('nb.by.' + e.by)) : null)));
}

// --- statistics ----------------------------------------------------------------------------------------------------

const sumPrice = (list) => list.reduce((s, u) => s + (u.price || 0), 0);
function avgPpm(list) {
  const v = list.map(pricePerM2).filter((x) => x > 0);
  // Average of per-unit prices per m² (not total price / total area): each flat counts once, as buyers compare them.
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : 0;
}

function paintTiles() {
  const box = els.tiles, list = scopeUnits(), w = showCur();
  box.textContent = '';
  const st = unitStats(withCurrency(P, list));
  const sellable = st.total - st.closed;
  const sold = list.filter((u) => u.status === 'sold'), reserved = list.filter((u) => u.status === 'reserved'), free = list.filter((u) => u.status === 'free');
  const rev = sumPrice(sold);
  box.append(
    tile('nb.st.units', String(st.total), t('nb.st.unitsSub', { f: st.free, r: st.reserved, s: st.sold })),
    tile('nb.st.sold', sellable ? pctText(st.sold / sellable) : '—', t('nb.st.soldSub', { n: st.sold, m: sellable }), 'nb-tile-acc'),
    tile('nb.st.revenue', shown(P, rev, w), w === 'main' && hasGel(P) ? money(toGel(P, rev), 'GEL') : t('nb.st.reservedSub', { v: shown(P, sumPrice(reserved), w) })),
    tile('nb.st.stock', shown(P, sumPrice(free), w), t('nb.st.stockSub', { n: free.length })),
    tile('nb.st.avgM2', st.avgM2 ? shown(P, st.avgM2, w) : '—', st.avgFrom ? t('nb.st.avgSub', { n: st.avgFrom }) : ''));
  box.dataset.sold = String(st.sold);
}

function paintStats() {
  const box = els.stats, list = scopeUnits(), w = showCur();
  box.textContent = '';
  if (!list.length) { box.append(h('div', { class: 'ap-empty' }, t('nb.b.empty'))); return; }
  const roomsList = [...new Set(list.map((u) => u.rooms))].sort((a, b) => a - b);
  const plans = unitPlans(withCurrency(P, list), { sold: true });
  const th = (k) => h('th', { scope: 'col' }, t(k));
  const tdn = (v, cls = 'nb-r') => h('td', { class: cls }, v);
  const rowsT = h('tbody');
  for (const r of roomsList) {
    const g = list.filter((u) => u.rooms === r);
    const free = g.filter((u) => u.status === 'free'), sold = g.filter((u) => u.status === 'sold');
    const sellable = g.filter((u) => u.status !== 'closed').length;
    const plan = plans.find((x) => x.rooms === r);
    const fs = unitStats(withCurrency(P, g));
    rowsT.append(h('tr', {},
      h('th', { scope: 'row' }, roomsText(r)), tdn(String(g.length)), tdn(String(free.length)), tdn(String(g.filter((u) => u.status === 'reserved').length)), tdn(String(sold.length)),
      tdn(sellable ? pctText(sold.length / sellable, 0) : '—'),
      tdn(fs.avgM2 ? shown(P, fs.avgM2, w) : '—'), tdn(avgPpm(sold) ? shown(P, avgPpm(sold), w) : '—'),
      tdn(plan && plan.priceFrom ? shown(P, plan.priceFrom, w) : '—'),
      tdn(plan && plan.areaMin ? (plan.areaMin === plan.areaMax ? num(plan.areaMin, 1) : `${num(plan.areaMin, 1)}–${num(plan.areaMax, 1)}`) : '—')));
  }
  const byRooms = h('div', { class: 'ap-table-wrap nb-twrap' }, h('table', { class: 'ap-table nb-table' },
    h('thead', {}, h('tr', {}, th('nb.st.rooms'), th('nb.st.units'), th('nb.status.free'), th('nb.status.reserved'), th('nb.status.sold'), th('nb.st.soldShort'), th('nb.st.avgFree'), th('nb.st.avgSold'), th('nb.st.from'), th('nb.st.areaM2'))),
    rowsT));
  const rowsB = h('tbody');
  for (const b of scopeBuildings()) {
    const g = list.filter((u) => u.building === b.id);
    if (!g.length) continue;
    const sold = g.filter((u) => u.status === 'sold'), sellable = g.filter((u) => u.status !== 'closed').length;
    const fs = unitStats(withCurrency(P, g));
    rowsB.append(h('tr', {}, h('th', { scope: 'row' }, b.name), tdn(readyLabel(b.ready) || '—', ''), tdn(String(g.length)), tdn(sellable ? pctText(sold.length / sellable, 0) : '—'),
      tdn(shown(P, sumPrice(sold), w)), tdn(fs.avgM2 ? shown(P, fs.avgM2, w) : '—')));
  }
  const byB = h('div', { class: 'ap-table-wrap nb-twrap' }, h('table', { class: 'ap-table nb-table' },
    h('thead', {}, h('tr', {}, th('nb.st.building'), th('nb.st.ready'), th('nb.st.units'), th('nb.st.soldShort'), th('nb.st.revenue'), th('nb.st.avgFree'))), rowsB));
  box.append(h('h3', { class: 'nb-sub' }, t('nb.st.byRooms')), byRooms, h('h3', { class: 'nb-sub' }, t('nb.st.byBuilding')), byB, h('div', { class: 'ed-hint' }, t('nb.st.note')));
}

// ---------------------------------------------------------------------------------------------------------------

// Another tab changed the project: reload, drop the undo snapshot (it refers to the old state), rebuild.
onProjectChange((p) => { P = p; undo = null; render(); });
startShell('board', () => render());
render();
