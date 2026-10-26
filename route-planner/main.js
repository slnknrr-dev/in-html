// route-planner/main.js - the plan page: stops (pasted lines with coordinates in any common form, CSV import with
// column mapping, an editable table), depot / end / vehicle settings, the plan (optimised with pickup-before-delivery
// pairs and 2-opt, as entered, or reordered by hand with recomputed totals), the schematic map (Web Mercator, grid,
// scale bar, zoom and pan) and the exports (CSV, GPX 1.1, Google encoded polyline, geo: links, the trip sheet).
//
// Architecture (three tiers of update cost, chosen per event):
//   render()      full rebuild of every card: startup and language switch only.
//   structural()  rows added/removed, depot/end changed: rebuild the table and settings, then repaint the plan.
//   changed()     a keystroke in a field: the table is NOT rebuilt (that would destroy the focused input and the
//                 caret), only save + debounced replan + repaint of the derived views.
// Picking the cheapest tier is what keeps typing in a 100-row table fluid; rebuilding on every input would also
// break IME composition and screen-reader focus.
// State: S (persisted user data, common.js shape), P (derived plan, recomputed from S, never saved), M (map view
// state: zoom/centre, whether the view auto-fits, current pixel size, export format; session only).
// Event handlers mutate S directly and then call one of the tiers; there is no store/reducer layer because two
// pages and one state object do not justify one.
import {
  KINDS, computePlan, demoState, emptyState, exportCSV, exportGPX, exportPolyline, fitView, fmtClock, fmtCoord, fmtDur, fmtKm,
  geoLink, hasPos, lang, loadState, mapSvg, newStop, pageHref, parseCsvStops, parseStopLines, saveState, startShell, windowText, fmtNum,
} from './common.js';
import { button, card, copyText, download, dropZone, field, seg, select, t, toast, toggle } from '../ui/app.js';
import { $, $$, debounce, h } from '../ui/dom.js';
import { icon, iconEl } from '../ui/icons.js';
import { confirmDialog, openDialog } from '../ui/overlays.js';
import { parseLatLng } from '../geo/coords.js';
import { OSM_COPYRIGHT_URL } from '../geo/osm.js';
import { decodeBytes } from '../csv/encoding.js';
import { parseTime } from '../calendar/date.js';

let S = null;
// Trailing debounce: a burst of keystrokes costs one JSON.stringify + localStorage write (synchronous, can take
// milliseconds for 500 stops), not one per key. Risk accepted: closing the tab within 250 ms loses the last edit.
const save = debounce(() => saveState(S), 250);
let P = null;
// fitted: true = the view follows the data (refits on every repaint); any manual zoom/pan sets it false so the
// user's view is not yanked back when they edit a stop. "Fit" (button / key 0) sets it true again.
const M = { view: null, fitted: true, w: 0, h: 0, fmt: 'csv' };

const main = $('#main');
main.classList.add('rp-plan');
let els = {};

// ---------------------------------------------------------------------------------------------------------------
// Layout

// Cards are built empty and then filled by the render*/paint* functions. The els registry is how later updates find
// their containers without querying the DOM by selector each time. Ids (rp-map, rp-pl, rp-summary...) are hooks for
// e2e.js and the CSS id rule on #rp-km-opt, not for styling in general.
// DOM order: the stops card first (left column) for keyboard/reading order; on narrow screens the CSS moves the right
// column visually above (order:-1) so the map is seen first, while the tab order stays data-first.
function render() {
  main.textContent = '';
  els = {};
  els.table = h('div', { class: 'rp-table-box' });
  els.missing = h('div', { class: 'rp-missing' });
  els.settings = h('div', { class: 'ed-fields' });
  els.map = h('div', { class: 'rp-map', id: 'rp-map', tabindex: '0', 'aria-label': t('rp.map.aria') });
  els.mapNote = h('div', { class: 'rp-map-note' });
  els.summary = h('div', { class: 'rp-summary', id: 'rp-summary' });
  // role=status = polite live region: a new pair violation or lateness is announced without stealing focus.
  els.warn = h('div', { class: 'rp-warn', role: 'status' });
  els.list = h('ol', { class: 'rp-pl', id: 'rp-pl', 'aria-label': t('rp.plan.order') });
  els.export = h('div', { class: 'rp-export' });

  const stopsCard = card('rp.stops', stopsToolbar(), pastePanel(), els.table, els.missing);
  stopsCard.classList.add('rp-stops');
  const settingsCard = card('rp.settings', els.settings);
  const mapCard = card('rp.map', mapToolbar(), els.map, els.mapNote);
  mapCard.classList.add('rp-mapcard');
  els.mode = seg([{ v: 'opt', l: 'rp.mode.opt', icon: 'sparkleRoute' }, { v: 'entered', l: 'rp.mode.entered' }, { v: 'manual', l: 'rp.mode.manual' }], S.plan.mode, (v) => setMode(v), 'rp.mode');
  els.mode.classList.add('rp-mode');
  const planCard = card('rp.plan', els.summary, els.mode, els.warn, els.list, h('div', { class: 'ed-hint' }, t('rp.plan.dragHint')));
  const exportCard = card('rp.export', els.export);
  main.append(h('div', { class: 'rp-work' },
    h('div', { class: 'rp-col rp-left' }, stopsCard, settingsCard),
    h('div', { class: 'rp-col rp-right' }, mapCard, planCard, exportCard)));
  renderTable();
  renderSettings();
  renderExport();
  paintPlan();
  // KNOWN DEFECT: render() runs again on every language switch, and each call creates a new ResizeObserver and
  // listener set without disconnecting the previous one. The old observer keeps the detached map box alive (a
  // small leak per switch; its callback is inert because a detached box has clientWidth 0).
  // Fix: keep the observer in module scope and ro.disconnect() before re-observing.
  observeMap();
}

// --- stops -------------------------------------------------------------------------------------------------------

// Toolbar actions. Destructive ones (load demo over data, clear) go through a confirm dialog; adding does not.
// "Clear" keeps the vehicle settings: they describe the vehicle, not the day's stops, and retyping them is a chore.
// M.fitted = true after any bulk change: the new data should be framed, whatever the user zoomed to before.
function stopsToolbar() {
  const add = button('rp.s.add', 'plus', () => {
    S.stops.push(newStop());
    renderTable(); changed();
    $$('.rp-in-name', els.table).at(-1)?.focus();
  }, 'primary');
  const csv = button('rp.s.csv', 'upload', () => csvPicker.click());
  const demo = button('rp.s.demo', 'route', async () => {
    if (S.stops.length && !(await confirmDialog(t('rp.s.demo'), t('rp.s.demoAsk'), t('rp.s.demoGo')))) return;
    S = demoState(); M.fitted = true; structural(); toast(t('rp.s.demoDone'), 'ok');
  });
  const clear = button('rp.s.clear', 'trash', async () => {
    if (!S.stops.length) return;
    if (!(await confirmDialog(t('rp.s.clear'), t('rp.s.clearAsk', { n: S.stops.length }), t('rp.s.clearGo'), true))) return;
    const keep = S.cfg;
    S = emptyState(); S.cfg = keep; M.fitted = true; structural();
  });
  for (const b of [add, csv, demo, clear]) b.classList.add('ed-sm');
  demo.id = 'rp-demo';
  clear.classList.add('rp-clear');
  // Hidden file input behind the CSV button; the paste panel also accepts dropped files.
  const csvPicker = h('input', { type: 'file', accept: '.csv,.tsv,.txt,text/csv,text/plain', hidden: true });
  // value = '' after reading: otherwise picking the same file again fires no 'change' event.
  csvPicker.addEventListener('change', () => { if (csvPicker.files[0]) importFile(csvPicker.files[0]); csvPicker.value = ''; });
  return h('div', { class: 'ap-actions rp-toolbar' }, add, csv, demo, clear, csvPicker);
}

// Paste panel inside <details>: collapsed by default, because the table is the primary editor and the panel is a
// bulk-entry tool. <details> gives open/close, keyboard and a11y state for free (no JS toggle, no aria-expanded).
// spellcheck=false: coordinates and street names would be underlined red throughout.
function pastePanel() {
  const ta = h('textarea', { class: 'ed-input ed-textarea rp-paste', rows: 5, spellcheck: 'false', id: 'rp-paste', placeholder: t('rp.p.ph'), 'aria-label': t('rp.p.title') });
  const go = button('rp.p.add', 'plus', () => {
    const list = parseStopLines(ta.value);
    if (!list.length) { toast(t('rp.p.none'), 'warn'); return; }
    addStops(list);
    ta.value = '';
  }, 'primary');
  go.classList.add('ed-sm');
  go.id = 'rp-paste-add';
  const drop = dropZone({ onFiles: (f) => importFile(f[0]), accept: '.csv,.tsv,.txt,text/csv,text/plain', label: 'rp.p.drop' });
  drop.classList.add('rp-drop');
  return h('details', { class: 'rp-details', id: 'rp-paste-box' }, h('summary', {}, iconEl('chevRight'), h('span', {}, t('rp.p.title'))),
    h('div', { class: 'ed-fields' }, ta, h('div', { class: 'ed-hint' }, t('rp.p.hint')), h('div', { class: 'ap-actions' }, go), drop, h('div', { class: 'ed-hint' }, t('rp.p.csvHint'))));
}

// Appends (or replaces with) parsed stops. Re-elects the depot only if the current one vanished: the first stop
// with coordinates, because a depot without position makes the whole plan empty. The toast reports how many
// stops lack coordinates, so a partly failed paste is visible instead of silently incomplete.
function addStops(list, replace = false) {
  if (replace) S.stops = [];
  S.stops.push(...list);
  if (!S.stops.some((s) => s.id === S.depot)) S.depot = (S.stops.find(hasPos) || S.stops[0] || {}).id || '';
  M.fitted = true;
  structural();
  const bad = list.filter((s) => !hasPos(s)).length;
  toast(t('rp.p.added', { n: list.length }) + (bad ? ' ' + t('rp.p.noPos', { n: bad }) : ''), bad ? 'warn' : 'ok');
}

// File -> bytes -> text with charset detection (decodeBytes: BOM, UTF-8 validity, then legacy code pages such as
// Windows-1251 that Russian Excel still writes). file.text() would assume UTF-8 and turn Cyrillic into mojibake.
// The dialog shows which header mapped to which field before anything changes: an import that guessed wrong is
// cancelled, not undone. "Append" is offered only when there is something to append to.
async function importFile(file) {
  if (!file) return;
  let text;
  try { text = decodeBytes(new Uint8Array(await file.arrayBuffer())).text; } catch { toast(t('rp.csv.bad'), 'error'); return; }
  const r = parseCsvStops(text);
  if (!r.stops.length) { toast(t('rp.csv.none'), 'warn'); return; }
  const cols = Object.entries(r.columns).filter(([, f]) => f);
  const body = h('div', { class: 'ed-fields' },
    h('p', { class: 'ed-dlg-text' }, t('rp.csv.found', { n: r.stops.length, file: file.name })),
    cols.length ? h('dl', { class: 'ap-kv' }, cols.map(([hd, f]) => [h('dt', {}, hd), h('dd', {}, t('rp.col.' + f))])) : h('div', { class: 'ed-hint' }, t('rp.csv.noHeader')));
  const btns = [{ label: t('dlg.cancel'), value: null }];
  if (S.stops.length) btns.push({ label: t('rp.csv.append'), value: 'append' });
  btns.push({ label: t('rp.csv.replace'), value: 'replace', primary: true });
  const v = await openDialog({ title: t('rp.csv.title'), body, buttons: btns });
  if (v) addStops(r.stops, v === 'replace');
}

const kindLabel = (k) => t(k ? 'rp.kind.' + k : 'rp.kind.none');

// The editable stops table. A real <table> with <th scope=col>: screen readers announce the column for each cell.
// Empty state offers the demo directly (a "load demo" button that clicks the toolbar one, so there is one code path).
// The '#' and the actions column headers are not translated: '#' is universal, the actions column has no title.
function renderTable() {
  const box = els.table;
  box.textContent = '';
  if (!S.stops.length) {
    box.append(h('div', { class: 'ap-empty' }, h('p', {}, t('rp.s.empty')), h('div', { class: 'ap-actions rp-center' }, button('rp.s.demo', 'route', () => $('#rp-demo').click(), 'primary'))));
    return;
  }
  const head = ['#', 'rp.col.name', 'rp.col.address', 'rp.col.coords', 'rp.col.from', 'rp.col.to', 'rp.col.service', 'rp.col.kind', 'rp.col.pair', ''];
  const tbody = h('tbody', {});
  S.stops.forEach((s, i) => tbody.append(stopRow(s, i)));
  box.append(h('div', { class: 'ap-table-wrap rp-twrap' }, h('table', { class: 'ap-table rp-table', id: 'rp-table' },
    h('thead', {}, h('tr', {}, head.map((k) => h('th', { scope: 'col' }, k === '#' || !k ? k : t(k))))), tbody)));
}

// One row. Each input closes over its stop object `s` and writes straight into it, so no row lookup by index is
// needed (indices shift on delete; object identity does not).
// changed(true) (= may refit the map) only for edits that move geometry or constraints: coordinates, kind, pair.
// Name/time edits call changed() and leave the map view alone.
// aria-label "Name · 3": every input of a 100-row table needs a unique accessible name; the visual column header
// is not associated with inputs automatically.
function stopRow(s, i) {
  const upd = (k, v) => { s[k] = v; changed(); };
  const lbl = (k) => t(k) + ' · ' + (i + 1);
  // cls/label are pseudo-attributes consumed here; spreading attrs and then setting them to null makes h() skip them
  // (h ignores null values), so they never reach the DOM as bogus attributes.
  const inp = (k, attrs = {}) => {
    const x = h('input', { class: 'ed-input ' + (attrs.cls || ''), value: s[k] ?? '', 'aria-label': lbl(attrs.label), spellcheck: 'false', ...attrs, cls: null, label: null });
    x.addEventListener('input', () => upd(k, x.value));
    return x;
  };
  // Coordinates: one free-text field (any format parseLatLng knows: decimal, DMS, links), parsed on every input.
  // The text the user typed is left alone while typing (reformatting under the caret is hostile) and normalised to
  // canonical form only on 'change' (blur/Enter). Empty is not an error; non-empty but unparsable is, and is exposed
  // both visually (.rp-bad) and to AT (aria-invalid). dir=ltr: digits and signs keep their order in RTL locales.
  // inputmode=text, not decimal: DMS needs ° ′ ″ N E, which a numeric keypad cannot type.
  const coord = h('input', { class: 'ed-input rp-in-coord', value: fmtCoord(s), placeholder: '41.6513, 41.6362', 'aria-label': lbl('rp.col.coords'), spellcheck: 'false', inputmode: 'text', dir: 'ltr' });
  const paintCoord = () => { const bad = coord.value.trim() && !hasPos(s); coord.classList.toggle('rp-bad', !!bad); coord.setAttribute('aria-invalid', String(!!bad)); };
  coord.addEventListener('input', () => {
    const p = parseLatLng(coord.value);
    s.lat = p ? p.lat : null; s.lng = p ? p.lng : null;
    paintCoord(); changed(true);
  });
  coord.addEventListener('change', () => { if (hasPos(s)) coord.value = fmtCoord(s); });
  paintCoord();
  const time = (k) => { const x = inp(k, { type: 'time', cls: 'rp-in-time', label: 'rp.col.' + k }); return x; };
  // Service minutes: empty = inherit cfg.service (shown as the placeholder), so the default stays visible yet
  // distinguishable from an explicit value. Invalid -> null (inherit), never NaN in state.
  const svc = h('input', { class: 'ed-input rp-in-num', type: 'number', min: 0, max: 600, step: 1, value: Number.isFinite(s.service) ? s.service : '', placeholder: String(S.cfg.service), 'aria-label': lbl('rp.col.service') });
  svc.addEventListener('input', () => { const n = svc.value === '' ? null : +svc.value; s.service = Number.isFinite(n) && n >= 0 ? n : null; changed(); });
  const kind = h('select', { class: 'ed-input ed-select rp-in-kind', 'aria-label': lbl('rp.col.kind') }, KINDS.map((k) => h('option', { value: k, selected: s.kind === k }, kindLabel(k))));
  kind.addEventListener('change', () => { s.kind = kind.value; changed(true); });
  const pair = inp('pair', { cls: 'rp-in-pair', label: 'rp.col.pair', placeholder: 'A', maxlength: 24 });
  pair.addEventListener('input', () => changed(true));
  // geo: link. Without a position the <a> loses its href (an <a> without href is not focusable or activatable) and
  // gets aria-disabled for AT; CSS fades it and disables pointer events. A second coord listener keeps it in sync
  // live instead of waiting for a re-render.
  const geo = h('a', { class: 'ed-iconbtn rp-geo', href: geoLink(s) || null, title: t('rp.s.geo'), 'aria-label': t('rp.s.geo') + ': ' + (s.name || i + 1), html: icon('geo') });
  if (!hasPos(s)) geo.setAttribute('aria-disabled', 'true');
  coord.addEventListener('input', () => { if (hasPos(s)) { geo.href = geoLink(s); geo.removeAttribute('aria-disabled'); } else { geo.removeAttribute('href'); geo.setAttribute('aria-disabled', 'true'); } });
  // Delete without confirmation but with Undo in the toast: one row is cheap to restore, and a confirm per row is
  // friction users learn to click through. Undo re-inserts the same object at its old index (clamped, the list may
  // have shrunk), so its id and the manual order still match. Depot/end referring to it are reassigned at once.
  const del = h('button', { type: 'button', class: 'ed-iconbtn ed-danger', title: t('rp.s.remove'), 'aria-label': t('rp.s.remove') + ': ' + (s.name || i + 1), html: icon('trash'), onclick: () => {
    S.stops = S.stops.filter((x) => x !== s);
    if (S.depot === s.id) S.depot = (S.stops.find(hasPos) || {}).id || '';
    if (S.end === s.id) S.end = 'return';
    structural();
    toast(t('rp.s.removed', { name: s.name || '#' + (i + 1) }), 'info', { label: t('rp.undo'), fn: () => { S.stops.splice(Math.min(i, S.stops.length), 0, s); structural(); } });
  } });
  const depot = s.id === S.depot;
  // data-label: the phone layout (app.css, <= 640px) hides <thead> and prints this as a ::before caption per cell.
  const td = (key, ...kids) => h('td', { 'data-label': key ? t(key) : null }, ...kids);
  return h('tr', { dataset: { id: s.id }, class: depot ? 'rp-row-depot' : '' },
    h('td', { class: 'rp-num' }, depot ? h('span', { class: 'rp-dep-badge', title: t('rp.depot'), html: icon('depot') }) : String(i + 1)),
    td('rp.col.name', inp('name', { cls: 'rp-in-name', label: 'rp.col.name', placeholder: t('rp.col.name') })),
    td('rp.col.address', inp('address', { cls: 'rp-in-addr', label: 'rp.col.address', placeholder: t('rp.col.address') })),
    td('rp.col.coords', coord),
    td('rp.col.from', time('from')), td('rp.col.to', time('to')), td('rp.col.service', svc),
    td('rp.col.kind', kind), td('rp.col.pair', pair),
    h('td', { class: 'rp-acts' }, geo, del));
}

// --- settings ----------------------------------------------------------------------------------------------------

// Depot / end / vehicle settings. Option labels starting with '=' are literal text for ui/app.js select() (no i18n
// lookup): stop names are user data, not translation keys. The end list excludes the depot (an end at the depot is
// 'return'). Choosing as depot the stop that was the end resets end to 'return' for the same reason.
// Numeric inputs accept a decimal comma (European keyboards) and commit only values inside [min, max]; while the
// field holds an out-of-range or partial value ("1." on the way to "1.35") the last valid value stays in effect.
function renderSettings() {
  const box = els.settings;
  box.textContent = '';
  const located = S.stops.filter(hasPos);
  const name = (s, i) => '=' + (s.name || s.address || t('rp.stopN', { n: S.stops.indexOf(s) + 1 }));
  const dep = select(located.length ? located.map((s, i) => ({ v: s.id, l: name(s, i) })) : [{ v: '', l: 'rp.none' }], P.depot?.id || '', (v) => { S.depot = v; if (S.end === v) S.end = 'return'; structural(); });
  dep.id = 'rp-depot';
  const end = select([{ v: 'return', l: 'rp.end.return' }, { v: 'open', l: 'rp.end.open' }, ...located.filter((s) => s.id !== P.depot?.id).map((s, i) => ({ v: s.id, l: '=' + t('rp.end.at', { name: name(s, i).slice(1) }) }))], S.end, (v) => { S.end = v; structural(); });
  end.id = 'rp-end';
  const startT = h('input', { type: 'time', class: 'ed-input', value: S.cfg.start });
  startT.addEventListener('input', () => { if (Number.isFinite(parseTime(startT.value))) { S.cfg.start = startT.value; changed(); } });
  const num = (k, min, max, step) => {
    const x = h('input', { type: 'number', class: 'ed-input', min, max, step, value: S.cfg[k], inputmode: 'decimal' });
    x.addEventListener('input', () => { const n = parseFloat(String(x.value).replace(',', '.')); if (Number.isFinite(n) && n >= min && n <= max) { S.cfg[k] = n; changed(k === 'rf'); } });
    return x;
  };
  const rf = num('rf', 1, 3, 0.05);
  rf.id = 'rp-rf';
  box.append(
    field('rp.set.depot', dep, 'rp.set.depotHint'),
    field('rp.set.end', end),
    h('div', { class: 'ed-grid2' }, field('rp.set.start', startT), field('rp.set.speed', num('speed', 1, 200, 1))),
    h('div', { class: 'ed-grid2' }, field('rp.set.rf', rf), field('rp.set.service', num('service', 0, 600, 1))),
    h('div', { class: 'ed-hint' }, t('rp.set.rfHint')));
}

// --- map ---------------------------------------------------------------------------------------------------------

// Zoom buttons are real <button>s with aria-label (icon-only controls need a name). Toggling the ghost line only
// repaints the map: it changes nothing in the plan.
function mapToolbar() {
  const zb = (ic, label, fn) => h('button', { type: 'button', class: 'ed-iconbtn', title: t(label), 'aria-label': t(label), html: icon(ic), onclick: fn });
  const ghost = toggle(S.ui.ghost, (v) => { S.ui.ghost = v; save(); paintMap(); });
  return h('div', { class: 'rp-map-bar' },
    zb('zoomIn', 'rp.map.in', () => zoomBy(1)), zb('zoomOut', 'rp.map.out', () => zoomBy(-1)), zb('fit', 'rp.map.fit', () => { M.fitted = true; paintMap(); }),
    h('span', { class: 'ed-spacer' }), field('rp.map.ghost', ghost));
}

// Zoom clamped to [3, 19]: below 3 Mercator shows the whole world many times over; above 19 a city block fills the
// screen and the 0.1 px rounding of mapSvg becomes visible.
function zoomBy(d, at) {
  if (!M.view) return;
  const v = M.view;
  const nz = Math.max(3, Math.min(19, v.zoom + d));
  if (at) {
    // Keep the point under the cursor in place. Zooming by factor k = 2^dz about point A maps any pixel X to
    // A + (X - A) * k. The new centre is the old-pixel point that will land at the screen centre C:
    // A + (C - A) / k. Unproject it with the OLD view (a geometry-only mapSvg call, no plan, no OSM: cheap).
    // Plain zoom (buttons, keys) keeps the centre instead.
    const cur = mapSvg({ width: M.w, height: M.h, view: v, plan: null, osm: false }).view;
    const k = 2 ** (nz - v.zoom);
    const c = cur.unproject(at[0] + (M.w / 2 - at[0]) / k, at[1] + (M.h / 2 - at[1]) / k);
    M.view = { center: c, zoom: nz };
  } else M.view = { center: v.center, zoom: nz };
  M.fitted = false;
  paintMap();
}

// Map interaction: resize, drag-pan (Pointer Events: one code path for mouse, pen, touch), click a marker, wheel
// zoom, keyboard.
// - ResizeObserver, not window 'resize': the map's width changes with the grid breakpoint and the side panel, not
//   only with the window. Repaint only when the integer width changed (height derives from width).
// - setPointerCapture: the drag keeps receiving moves when the pointer leaves the box, and pointerup always ends it.
// - 4 px dead zone: a click with a slight hand tremor stays a click (selects the stop) instead of a micro-pan.
// - Pan is computed from the view at drag START plus the total offset, not incrementally per move: no accumulated
//   rounding drift, and a dropped pointermove does not lose distance.
// - k = svg viewBox px / CSS px: the SVG is drawn at M.w units but displayed at the box's CSS width.
// - CSS touch-action:none on .rp-map lets these handlers own touch gestures (otherwise the browser scrolls).
function observeMap() {
  const box = els.map;
  const ro = new ResizeObserver(() => { const w = Math.round(box.clientWidth); if (w && w !== M.w) paintMap(); });
  ro.observe(box);
  let drag = null;
  box.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !M.view) return;
    drag = { x: e.clientX, y: e.clientY, view: M.view, moved: false, id: e.target.closest?.('[data-id]')?.dataset.id };
    box.setPointerCapture(e.pointerId);
  });
  box.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    const k = M.w / box.clientWidth;
    const cur = mapSvg({ width: M.w, height: M.h, view: drag.view, plan: null, osm: false }).view;
    M.view = { center: cur.unproject(M.w / 2 - dx * k, M.h / 2 - dy * k), zoom: drag.view.zoom };
    M.fitted = false;
    box.classList.add('rp-panning');
    paintMap();
  });
  const end = () => {
    if (drag && !drag.moved && drag.id) focusPlanItem(drag.id);
    drag = null; box.classList.remove('rp-panning');
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
  // passive:false is required to preventDefault a wheel event (browsers default wheel listeners on some targets to
  // passive for scroll performance). Trade-off: scrolling the page with the cursor over the map zooms the map
  // instead. Half a level per notch: a full level per notch overshoots on trackpads that fire many events.
  box.addEventListener('wheel', (e) => {
    if (!M.view) return;
    e.preventDefault();
    const r = box.getBoundingClientRect(), k = M.w / r.width;
    zoomBy(e.deltaY < 0 ? 0.5 : -0.5, [(e.clientX - r.left) * k, (e.clientY - r.top) * k]);
  }, { passive: false });
  // Keyboard parity with the mouse (the box is tabindex=0): arrows pan 60 px, + / = zoom in ('=' is + without
  // Shift on US layouts), - out, 0 refits. preventDefault stops arrows from also scrolling the page.
  box.addEventListener('keydown', (e) => {
    const pan = { ArrowLeft: [-60, 0], ArrowRight: [60, 0], ArrowUp: [0, -60], ArrowDown: [0, 60] }[e.key];
    if (pan && M.view) {
      e.preventDefault();
      const cur = mapSvg({ width: M.w, height: M.h, view: M.view, plan: null, osm: false }).view;
      M.view = { center: cur.unproject(M.w / 2 + pan[0], M.h / 2 + pan[1]), zoom: M.view.zoom }; M.fitted = false; paintMap();
    } else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1); }
    else if (e.key === '-') { e.preventDefault(); zoomBy(-1); }
    else if (e.key === '0') { e.preventDefault(); M.fitted = true; paintMap(); }
  });
}

// Repaint = regenerate the whole SVG string and replace innerHTML. For a few hundred elements this is faster to
// write and fast enough to run per pointermove; diffing a retained SVG DOM would be premature.
// Size: at least 280 px wide (narrow phones still get a usable map), height = 0.68 x width clamped to 260..620 px
// (landscape-ish, never taller than a laptop viewport). The legend is rebuilt each time because the ghost entry
// and the OSM attribution depend on current state. OSM attribution link: target=_blank with rel=noopener so the
// opened page cannot reach window.opener.
function paintMap() {
  const box = els.map;
  if (!box) return;
  const w = Math.max(280, Math.round(box.clientWidth || 640));
  const hgt = Math.round(Math.max(260, Math.min(620, w * 0.68)));
  M.w = w; M.h = hgt;
  if (M.fitted || !M.view) M.view = fitView(P.located, w, hgt);
  const r = mapSvg({ width: w, height: hgt, view: M.view, plan: P, ghost: S.ui.ghost, title: t('rp.map.aria') });
  box.innerHTML = r.svg;
  box.dataset.zoom = M.view.zoom.toFixed(2);
  els.mapNote.textContent = '';
  els.mapNote.append(h('span', { class: 'rp-legend' },
    h('span', { class: 'rp-lg rp-lg-depot' }, t('rp.depot')), h('span', { class: 'rp-lg rp-lg-pickup' }, t('rp.kind.pickup')),
    h('span', { class: 'rp-lg rp-lg-delivery' }, t('rp.kind.delivery')), h('span', { class: 'rp-lg rp-lg-late' }, t('rp.late')),
    S.ui.ghost ? h('span', { class: 'rp-lg rp-lg-ghost' }, t('rp.mode.entered')) : null));
  if (r.fixture) els.mapNote.append(h('span', { class: 'rp-attr' }, t('rp.map.osm') + ' ', h('a', { href: OSM_COPYRIGHT_URL, target: '_blank', rel: 'noopener' }, '© OpenStreetMap contributors'), ' (ODbL)'));
  else els.mapNote.append(h('span', { class: 'ed-hint' }, t('rp.map.schematic')));
}

// --- plan --------------------------------------------------------------------------------------------------------

// Switching into manual mode seeds the manual order from what is currently shown (usually the optimised order), so
// the user starts editing from the best route instead of from a stale saved order.
function setMode(v) {
  if (v === 'manual' && S.plan.mode !== 'manual') S.plan.order = P.order.slice();
  S.plan.mode = v;
  changed(true);
}

// Repaints every derived view from P. The km of each card are also written to data-km (raw number) so e2e.js can
// compare values without parsing localised text ("12,4 км"). Saving % is rounded down by Math.round of a ratio:
// shown only when > 0, else "same" (the optimiser cannot beat an already optimal entered order).
// Stop count = located - 1: the depot is not a delivery stop.
function paintPlan() {
  els.mode.set(S.plan.mode);
  // Summary: entered vs optimised vs current.
  const box = els.summary;
  box.textContent = '';
  const n = P.located.length;
  if (!P.depot) {
    box.append(h('div', { class: 'ap-empty' }, t('rp.plan.empty')));
  } else {
    const save = P.km.entered > 0 ? Math.round((1 - P.km.optimised / P.km.entered) * 100) : 0;
    const stat = (id, label, km, extra, cls = '') => h('div', { class: 'rp-stat ' + cls, id, dataset: { km: String(km) } },
      h('div', { class: 'rp-stat-l' }, t(label)), h('div', { class: 'rp-stat-v' }, fmtKm(km)), extra ? h('div', { class: 'rp-stat-x' }, extra) : null);
    box.append(h('div', { class: 'rp-stats' },
      stat('rp-km-entered', 'rp.sum.entered', P.km.entered, P.enteredValid ? '' : t('rp.sum.enteredBad'), S.plan.mode === 'entered' ? 'rp-on' : ''),
      stat('rp-km-opt', 'rp.sum.opt', P.km.optimised, save > 0 ? t('rp.sum.saving', { p: save, km: fmtNum(P.km.entered - P.km.optimised, 1) }) : t('rp.sum.same'), S.plan.mode === 'opt' ? 'rp-on' : ''),
      S.plan.mode === 'manual' ? stat('rp-km-manual', 'rp.sum.manual', P.km.current, P.km.current > P.km.optimised ? t('rp.sum.more', { km: fmtNum(P.km.current - P.km.optimised, 1) }) : '', 'rp-on') : null),
      h('dl', { class: 'ap-kv rp-kv' },
        h('dt', {}, t('rp.sum.stops')), h('dd', {}, t('rp.stops.n', { n: Math.max(0, n - 1) })),
        h('dt', {}, t('rp.sum.time')), h('dd', {}, `${fmtDur(P.totalMin)} · ${S.cfg.start}–${fmtClock(P.endMin)}`),
        h('dt', {}, t('rp.sum.pairs')), h('dd', {}, P.pairs.length ? t('rp.pairs.n', { n: P.pairs.length }) : '—')));
  }
  // Warnings.
  const w = els.warn;
  w.textContent = '';
  const add = (kind, msg) => w.append(h('div', { class: 'rp-w rp-w-' + kind }, iconEl(kind === 'info' ? 'info' : 'warn'), h('span', {}, msg)));
  for (const v of P.violations) add('error', t('rp.w.pair', { a: nameOf(v.a), b: nameOf(v.b), pair: v.label }));
  if (P.late) add('warn', t('rp.w.late', { n: P.late }));
  if (P.missing.length) add('info', t('rp.w.missing', { n: P.missing.length }));
  const orphan = orphanPairs();
  if (orphan.length) add('info', t('rp.w.orphan', { pairs: orphan.join(', ') }));
  paintList();
  paintMap();
  paintExport();
  paintMissing();
}

const byId = (id) => S.stops.find((s) => s.id === id);
const nameOf = (id) => { const s = byId(id); return s ? s.name || s.address || '#' + (S.stops.indexOf(s) + 1) : '?'; };

// Pair labels with only pickups or only deliveries: probably a typo in the label. pairsOf silently yields no
// constraint for them, so this warning is the only place the user learns their constraint is not in effect.
function orphanPairs() {
  const g = new Map();
  for (const s of P.located) { const k = s.pair.trim(); if (!k || !s.kind) continue; const e = g.get(k.toLowerCase()) || { k, p: 0, d: 0 }; e[s.kind === 'pickup' ? 'p' : 'd']++; g.set(k.toLowerCase(), e); }
  return [...g.values()].filter((e) => !e.p || !e.d).map((e) => e.k);
}

function paintMissing() {
  const box = els.missing;
  box.textContent = '';
  if (P.missing.length) box.append(h('div', { class: 'ed-hint ed-hint-warn' }, t('rp.s.missing', { n: P.missing.length })));
}

// The visiting order as an <ol> (order is the content, so an ordered list). Rows come from P.rows (the schedule),
// not P.order, because they carry ETA, wait and lateness. The depot row, the return row and a fixed end are not
// movable: they get a decorative icon (aria-hidden span) instead of a drag handle button.
// Two ways to reorder, for accessibility: drag the handle, or up/down buttons / arrow keys on the focused handle.
// The keyboard help is a hidden element referenced by aria-describedby: read by screen readers, never shown.
// data-kind/data-pair are for e2e.js (checks pickup-before-delivery in the rendered list).
function paintList() {
  const list = els.list;
  list.textContent = '';
  if (!P.depot) return;
  const fixedEnd = P.endStop?.id;
  P.rows.forEach((r, i) => {
    const s = r.stop;
    const movable = i > 0 && !r.ret && s.id !== fixedEnd;
    const meta = [];
    if (i > 0) meta.push(h('span', { class: 'rp-eta' }, fmtClock(r.arrive)));
    else meta.push(h('span', { class: 'rp-eta' }, t('rp.pl.dep', { t: fmtClock(r.depart) })));
    if (windowText(s) && !r.ret) meta.push(h('span', { class: 'rp-win' + (r.late ? ' rp-bad' : '') }, windowText(s)));
    if (r.wait >= 1) meta.push(h('span', { class: 'rp-wait' }, t('rp.pl.wait', { d: fmtDur(r.wait) })));
    if (r.late) meta.push(h('span', { class: 'rp-late' }, t('rp.late')));
    if (s.kind && !r.ret) meta.push(h('span', { class: 'rp-chip rp-chip-' + s.kind }, iconEl(s.kind), kindLabel(s.kind) + (s.pair ? ' ' + s.pair : '')));
    const handle = movable ? h('button', { type: 'button', class: 'rp-handle', title: t('rp.pl.move'), 'aria-label': t('rp.pl.moveN', { name: s.name || s.address || i }), 'aria-describedby': 'rp-pl-help', html: icon('grip') }) : h('span', { class: 'rp-handle rp-fixed', 'aria-hidden': 'true', html: icon(i === 0 || r.ret ? 'depot' : 'flag') });
    const li = h('li', { class: 'rp-pl-item' + (movable ? '' : ' rp-pl-fixed') + (r.ret ? ' rp-pl-ret' : ''), dataset: { id: s.id, kind: s.kind, pair: s.pair, n: String(i) } },
      handle,
      h('span', { class: 'rp-pl-n' + (i === 0 || r.ret ? ' rp-pl-n-depot' : s.kind ? ' rp-pl-n-' + s.kind : '') }, i === 0 || r.ret ? 'S' : String(i)),
      h('span', { class: 'rp-pl-body' }, h('span', { class: 'rp-pl-name' }, r.ret ? t('rp.pl.return', { name: s.name || s.address }) : s.name || s.address || t('rp.stopN', { n: i })), h('span', { class: 'rp-pl-meta' }, meta)),
      h('span', { class: 'rp-pl-km' }, i ? '+' + fmtKm(r.legKm) : ''),
      movable ? h('span', { class: 'rp-pl-btns' },
        h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('rp.pl.up'), 'aria-label': t('rp.pl.up'), html: icon('up'), disabled: i <= 1, onclick: () => moveItem(s.id, -1) }),
        h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('rp.pl.down'), 'aria-label': t('rp.pl.down'), html: icon('down'), onclick: () => moveItem(s.id, 1) })) : h('span', { class: 'rp-pl-btns' }),
      h('a', { class: 'ed-iconbtn ed-sm rp-geo', href: geoLink(s), title: t('rp.s.geo'), 'aria-label': t('rp.s.geo'), html: icon('geo') }));
    if (movable) bindDrag(handle, li);
    list.append(li);
  });
  if (!$('#rp-pl-help')) list.after(h('span', { id: 'rp-pl-help', hidden: true }, t('rp.pl.keys')));
}

// Moves a stop of the plan by `d` places (keyboard, buttons) and switches to the manual order.
// The list is rebuilt by the replan, which destroys the focused handle; the intent is to restore focus by stop id
// (stable across rebuilds) so a keyboard user can press ArrowDown repeatedly.
// KNOWN DEFECT: because replan is debounced 90 ms and the rAF runs after ~16 ms, focus lands on the handle of the
// old list, which is then removed; focus falls back to <body> and repeated arrow presses stop working.
// Fix: restore focus at the end of paintList (remember the id to focus) instead of in a rAF here.
function moveItem(id, d) {
  const ids = movableIds();
  const i = ids.indexOf(id), j = i + d;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  applyManual(ids);
  requestAnimationFrame(() => $(`.rp-pl-item[data-id="${id}"] .rp-handle`)?.focus());
}
// The reorderable middle of the current order: depot and fixed end excluded (they are re-pinned by computePlan).
const movableIds = () => P.order.filter((id) => id !== P.depot.id && id !== P.endStop?.id);

function applyManual(ids) {
  S.plan.mode = 'manual';
  S.plan.order = ids;
  changed(true);
}

// Pointer drag on the handle (mouse, pen and touch alike) and arrow keys on the focused handle.
// Live DOM reordering: while dragging, the <li> itself is moved before the first sibling whose vertical midpoint is
// below the pointer, so the list shows the drop result continuously (no placeholder element, no absolute
// positioning). Only on release is the DOM order read back into ids and committed, and only if it changed, so a
// click on the handle does not switch the plan into manual mode. Fixed items are excluded from the candidates, so
// nothing can be dropped above the depot. Handle has touch-action:none (CSS) or touch would scroll instead.
// Listeners are attached on pointerdown and removed on up/cancel: no global listeners live between drags.
// Native HTML5 drag-and-drop was avoided: it does not fire on touch screens and its ghost image is not stylable.
function bindDrag(handle, li) {
  handle.addEventListener('keydown', (e) => {
    const d = { ArrowUp: -1, ArrowDown: 1 }[e.key];
    if (d) { e.preventDefault(); moveItem(li.dataset.id, d); }
  });
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    li.classList.add('rp-dragging');
    const list = li.parentElement;
    const move = (ev) => {
      const items = $$('.rp-pl-item:not(.rp-pl-fixed)', list).filter((x) => x !== li);
      let before = null;
      for (const it of items) { const r = it.getBoundingClientRect(); if (ev.clientY < r.top + r.height / 2) { before = it; break; } }
      if (before) list.insertBefore(li, before);
      else { const last = items.at(-1); if (last) last.after(li); }
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      li.classList.remove('rp-dragging');
      const ids = $$('.rp-pl-item:not(.rp-pl-fixed)', list).map((x) => x.dataset.id);
      if (ids.join() !== movableIds().join()) applyManual(ids);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}

// Map marker click -> highlight its row. Animation restart trick: remove the class, force a reflow (reading
// offsetWidth flushes style), add it again; without the reflow the browser coalesces remove+add and the flash does
// not replay on a second click. Focus target: the handle button ([type] selects the <button>, not the decorative
// span) or the geo link for fixed rows. preventScroll: scrollIntoView already chose a smooth, minimal scroll.
function focusPlanItem(id) {
  const li = $(`.rp-pl-item[data-id="${id}"]`);
  if (!li) return;
  li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  li.classList.remove('rp-flash'); void li.offsetWidth; li.classList.add('rp-flash');
  (li.querySelector('.rp-handle[type]') || li.querySelector('a'))?.focus({ preventScroll: true });
}

// --- export ------------------------------------------------------------------------------------------------------

// Export card: one read-only textarea preview for all formats (what you see is exactly what is downloaded or
// copied). '=CSV' / '=GPX' are literal labels (no i18n). The trip sheet / print are plain links to the other page:
// it reads the same saved state, and '#print' asks it to open the print dialog once rendered.
function renderExport() {
  const box = els.export;
  box.textContent = '';
  els.fmt = seg([{ v: 'csv', l: '=CSV' }, { v: 'gpx', l: '=GPX' }, { v: 'polyline', l: 'rp.x.polyline' }], M.fmt, (v) => { M.fmt = v; paintExport(); }, 'rp.x.format');
  els.fmt.id = 'rp-fmt';
  els.out = h('textarea', { class: 'ed-input ed-textarea rp-out', id: 'rp-out', rows: 7, readonly: true, spellcheck: 'false', 'aria-label': t('rp.x.preview'), dir: 'ltr' });
  els.fmtHint = h('div', { class: 'ed-hint' });
  const dl = button('rp.x.download', 'download', () => {
    if (!P.depot) return;
    // File name from the trip title: keep letters/digits of any script (\p{L}\p{N} with the u flag), '.', '_', '-';
    // everything else (slashes, colons, quotes: invalid on Windows) collapses to '_'. 50 chars: well under path limits.
    // CSV gets a UTF-8 BOM: without it Excel opens UTF-8 CSV as the ANSI code page and garbles non-Latin names.
    const base = (S.meta.title || 'route').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 50) || 'route';
    const [ext, type] = { csv: ['csv', 'text/csv'], gpx: ['gpx', 'application/gpx+xml'], polyline: ['txt', 'text/plain'] }[M.fmt];
    download(M.fmt === 'csv' ? '﻿' + els.out.value : els.out.value, `${base}.${ext}`, type);
  }, 'primary');
  const cp = button('rp.x.copy', 'copy', () => P.depot && copyText(els.out.value));
  const sheet = h('a', { class: 'ed-btn', href: pageHref('pg-sheet'), id: 'rp-sheet-link' }, iconEl('sheetIc'), t('rp.x.sheet'));
  const print = h('a', { class: 'ed-btn', href: pageHref('pg-sheet') + '#print' }, iconEl('print'), t('rp.x.print'));
  box.append(els.fmt, els.fmtHint, els.out, h('div', { class: 'ap-actions rp-xacts' }, dl, cp), h('div', { class: 'ap-actions rp-xacts' }, sheet, print));
}

// Only <button>s are disabled without a plan; the sheet/print <a> links stay active (the sheet shows its own empty
// state), and disabled is not a property of <a> anyway.
function paintExport() {
  if (!els.out) return;
  els.out.value = P.depot ? (M.fmt === 'csv' ? exportCSV(P) : M.fmt === 'gpx' ? exportGPX(P, S.meta) : exportPolyline(P)) : '';
  els.fmtHint.textContent = t('rp.x.hint.' + M.fmt);
  for (const b of $$('.rp-xacts .ed-btn', els.export)) if (b.tagName === 'BUTTON') b.disabled = !P.depot;
}

// ---------------------------------------------------------------------------------------------------------------
// Updates

// 90 ms: below the ~100 ms threshold where a response still feels instant, long enough to merge a typing burst.
const replan = debounce(() => { P = computePlan(S); paintPlan(); }, 90);
// Field edits: the table keeps its focus; `settings` also refreshes the depot / end lists (names, coordinates).
// refit && M.fitted: geometry edits re-frame the map only if the user has not taken manual control of the view.
// (paintMap refits whenever M.fitted anyway; clearing M.view here is redundant but harmless.)
function changed(refit = false) {
  save();
  if (refit && M.fitted) M.view = null;
  replan();
  refreshSettings();
}
// Never rebuild the settings while one of its controls has focus: that would close an open <select> or eat a
// half-typed number. 400 ms, slower than replan: depot names are low-priority.
const refreshSettings = debounce(() => {
  if (els.settings && !els.settings.contains(document.activeElement)) renderSettings();
}, 400);

// Structural changes (rows added / removed, depot or end moved): everything is rebuilt.
function structural() {
  save();
  P = computePlan(S);
  renderTable();
  renderSettings();
  paintPlan();
}

// Boot. The shell's language callback re-renders everything (all visible strings come from t()). Structural paths
// compute P synchronously (not via the debounced replan) because render reads P immediately.
startShell('plan', () => render());
S = loadState();
P = computePlan(S);
render();
