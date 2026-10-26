// newbuild-board/common.js - shared parts of the board, import, mortgage and complex pages: the shell (pages resolved
// from the hidden anchors of the page HTML, so the build can rewrite them), app icons, the project model (complex,
// buildings with ready-by quarters, layout types with room trees, units with statuses and a history) kept in
// localStorage and checked on every load, the unit filters, money in integer minor units with the hand-entered GEL
// rate, the layout summary of a unit (estate/rooms.js) and its sketch (plan/), and small widgets.
//
// Design rules:
// - One project record in localStorage, shared by the four pages. Every load and every imported file goes through
//   normalizeProject(): untrusted input becomes the canonical shape (caps, types, enums), so page code never checks.
// - Money is an integer count of minor units (cents, tetri) of the project currency. Floats would drift when prices
//   are summed, converted and changed in bulk; formatting divides only at display time.
// - Units are identified by `${building}-${flat}` (unitKey), not by array index: imports match existing units by it,
//   and history lines survive reordering.
// - Every status or price change appends a dated history line (changeUnit), capped at HISTORY_MAX, so the board can
//   show "sold on" dates and price trends without a server.
//
// Side-effect import first: strings.js registers the app's i18n keys before any t() call.
import './strings.js';
import { startApp, t } from '../ui/app.js';
import { h, lsGet, lsSet } from '../ui/dom.js';
import { addIcons } from '../ui/icons.js';
import { UNIT_STATUSES, unitStatus } from '../estate/chessboard.js';
import { cleanComplexName, cleanComplexSlug, cleanReady, readyBy, readyOfDay, readyQuarter, readyYear } from '../estate/complex.js';
import { normalizeRooms, roomsLayout, roomsSummary } from '../estate/rooms.js';
import { EURO_SCALE, scaleWord } from '../estate/scales.js';
import { cleanCurrency, fromMinor, minorUnits, moneyText } from '../ledger/minor.js';
import { convertMinor } from '../ledger/rates.js';
import { pageSVG, planCss } from '../plan/svg.js';
import { demoProject } from './demo.js';

export const LOGO = 'M3 21h18M5 21V5l7-3 7 3v16M9 8h2M13 8h2M9 12h2M13 12h2M9 16h2M13 16h2';

addIcons({
  building: LOGO,
  board: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  percent: 'M19 5L5 19M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  coins: 'M12 7c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3zM4 4v6c0 1.7 3.6 3 8 3s8-1.3 8-3V4M4 10v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  bank: 'M3 10h18M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18M12 3l9 5H3z',
});

// --- pages ----------------------------------------------------------------------------------------------------------

// getAttribute, not a.href: .href is absolute (file:///...), breaking relative links once published; '#' when missing.
export function pageHref(id) {
  const a = document.getElementById(id);
  return a ? a.getAttribute('href') : '#';
}

// One shell config for all four pages: identical header and nav, `current` marks the active tab.
export function startShell(current, onLang) {
  startApp({
    key: 'nb', name: 'nb.name', logo: LOGO, offline: true, onLang,
    pages: [
      { href: pageHref('pg-board'), label: 'nb.page.board', current: current === 'board' },
      { href: pageHref('pg-import'), label: 'nb.page.import', current: current === 'import' },
      { href: pageHref('pg-mortgage'), label: 'nb.page.mortgage', current: current === 'mortgage' },
      { href: pageHref('pg-complex'), label: 'nb.page.complex', current: current === 'complex' },
    ],
  });
}

// --- the project ----------------------------------------------------------------------------------------------------
//
// { v: 1, complex: { slug, name: { en, ru, ka }, address, developer, currency, gelRate, note },
//   buildings: [{ id, name, ready (year * 10 + quarter), handover ('yyyy-mm-dd') }],
//   layouts: { key: { key, area, rooms: [room tree] } },
//   units: [{ id, building, section, floor, flat, position?, area, rooms, price (minor units), status, view, layout,
//             history: [{ d, s?, p?, by? }] }] }

// Caps bound localStorage use (about 5 MB per origin) and keep rendering of the board responsive.
export const VIEWS = ['sea', 'city', 'mountain', 'yard'];
export const UNIT_MAX = 2000;
export const HISTORY_MAX = 60;
const PKEY = 'nb-project';

// str(): control characters become spaces (they would break CSV exports and single-line UI), then trim and cap.
const str = (v, n = 80) => String(v ?? '').replace(/[\x00-\x1f]/g, ' ').trim().slice(0, n);
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
// Building ids: upper-case letters/digits/dash in any script (\p{L}), max 12 chars; they appear in unit keys.
export const cleanBuildingId = (v) => String(v ?? '').trim().toUpperCase().replace(/[^\p{L}\p{N}-]/gu, '').slice(0, 12);
export const unitKey = (building, flat) => `${building}-${String(flat).trim().toLowerCase()}`;
// Natural order: "B2" < "B10", flat "9" < "10".
export const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

// History lines without a valid date or without any change are dropped; only the newest HISTORY_MAX are kept.
function cleanHistory(list) {
  const out = [];
  for (const e of Array.isArray(list) ? list : []) {
    if (!e || !isDay(e.d)) continue;
    const x = { d: e.d };
    if (UNIT_STATUSES.includes(e.s)) x.s = e.s;
    if (Number.isInteger(e.p) && e.p >= 0) x.p = e.p;
    if (['demo', 'manual', 'bulk', 'import'].includes(e.by)) x.by = e.by;
    if (x.s || x.p != null) out.push(x);
  }
  return out.slice(-HISTORY_MAX);
}

function cleanUnit(u, buildings, layouts) {
  if (!u || typeof u !== 'object') return null;
  const building = cleanBuildingId(u.building);
  const flat = str(u.flat, 24);
  // A unit needs a known building and a flat number with at least one digit; anything else is junk from an import.
  if (!building || !buildings.has(building) || !/\d/.test(flat)) return null;
  // Floors -5..200: basements to the tallest towers; null = unknown floor (kept, sorted last).
  const floor = u.floor == null || u.floor === '' || !Number.isFinite(+u.floor) ? null : Math.max(-5, Math.min(200, Math.trunc(+u.floor)));
  const out = {
    id: unitKey(building, flat), building, section: str(u.section, 12) || '1', floor, flat,
    area: Number.isFinite(+u.area) && +u.area > 0 ? Math.round(Math.min(+u.area, 100000) * 100) / 100 : 0,
    rooms: Number.isFinite(+u.rooms) ? Math.max(0, Math.min(20, Math.trunc(+u.rooms))) : 0,
    // Price must already be an integer of minor units; a float here means a bug upstream, so it is rejected (0).
    price: Number.isInteger(u.price) && u.price > 0 ? Math.min(u.price, 1e12) : 0,
    // unitStatus (estate/chessboard.js) maps legacy / free-form values onto the four statuses.
    status: unitStatus(u),
    view: VIEWS.includes(u.view) ? u.view : '',
    layout: layouts[u.layout] ? u.layout : '',
    history: cleanHistory(u.history),
  };
  if (Number.isInteger(u.position) && u.position > 0 && u.position <= 99) out.position = u.position;
  return out;
}

function cleanLayouts(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    const key = str(k, 12).replace(/[^\p{L}\p{N}_-]/gu, '');
    if (!key || !v || typeof v !== 'object') continue;
    out[key] = { key, area: Number.isFinite(+v.area) && +v.area > 0 ? +v.area : 0, rooms: normalizeRooms(v.rooms) };
    if (Object.keys(out).length >= 60) break;
  }
  return out;
}

// Order matters: buildings first (units are checked against them), then layouts (units reference them by key),
// then units, deduplicated by unitKey. Caps: 40 buildings, 60 layouts, UNIT_MAX units.
/** A project from storage or a backup file: every field checked, junk dropped, never throws. */
export function normalizeProject(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const c = r.complex && typeof r.complex === 'object' ? r.complex : {};
  const rate = +c.gelRate;
  const complex = {
    slug: cleanComplexSlug(c.slug),
    name: cleanComplexName(c.name),
    address: str(c.address, 200),
    developer: str(c.developer, 120),
    // cleanCurrency returns an ISO 4217-like code; anything not three letters falls back to USD.
    currency: cleanCurrency(c.currency).length === 3 ? cleanCurrency(c.currency) : 'USD',
    gelRate: Number.isFinite(rate) && rate > 0 && rate < 100000 ? rate : 0,
    note: str(c.note, 400),
  };
  const buildings = [];
  const seen = new Set();
  for (const b of Array.isArray(r.buildings) ? r.buildings : []) {
    const id = cleanBuildingId(b && b.id);
    if (!id || seen.has(id) || buildings.length >= 40) continue;
    seen.add(id);
    buildings.push({ id, name: str(b.name, 60) || id, ready: cleanReady(b.ready), handover: isDay(b.handover) ? b.handover : '' });
  }
  const layouts = cleanLayouts(r.layouts);
  const units = [];
  const ids = new Set();
  for (const u of Array.isArray(r.units) ? r.units : []) {
    const x = cleanUnit(u, seen, layouts);
    if (!x || ids.has(x.id) || units.length >= UNIT_MAX) continue;
    ids.add(x.id);
    units.push(x);
  }
  return { v: 1, complex, buildings, layouts, units: sortUnits(units) };
}

// Chessboard order: building, section, then floor DESCENDING (top floor first, as on a facade), position in the
// floor, flat number. Unknown floors (-999) go to the bottom. Sorts in place and returns the same array.
export const sortUnits = (list) => list.sort((a, b) => natural(a.building, b.building) || natural(a.section, b.section)
  || (b.floor ?? -999) - (a.floor ?? -999) || (a.position || 0) - (b.position || 0) || natural(a.flat, b.flat));

export function loadProject() {
  const raw = lsGet(PKEY, null);
  // First visit: the demo project, so the board is never empty and every feature can be tried at once.
  if (!raw) return normalizeProject(demoProject());
  return normalizeProject(raw);
}
export function saveProject(p) { lsSet(PKEY, p); }
export const resetDemo = () => normalizeProject(demoProject());

// Other tabs of the app change the same project: reload it there (`storage` fires only in the other tabs).
export function onProjectChange(fn) {
  window.addEventListener('storage', (e) => { if (e.key === PKEY) fn(loadProject()); });
}

// Local date (not toISOString, which is UTC and would date an evening change as tomorrow in Tbilisi).
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** A change of a unit with its history line (by: 'manual' | 'bulk' | 'import'). Returns true when something changed. */
// Records only real changes (same status / price = no history line). `by` tells manual edits from bulk and imports.
export function changeUnit(u, { status, price }, by = 'manual', d = todayISO()) {
  const e = { d, by };
  if (status && UNIT_STATUSES.includes(status) && status !== u.status) { u.status = status; e.s = status; }
  if (Number.isInteger(price) && price >= 0 && price !== u.price) { u.price = price; e.p = price; }
  if (e.s == null && e.p == null) return false;
  u.history.push(e);
  if (u.history.length > HISTORY_MAX) u.history.splice(0, u.history.length - HISTORY_MAX);
  return true;
}

export const buildingOf = (p, id) => p.buildings.find((b) => b.id === id) || null;
export const complexTitle = (p) => {
  // The complex name per page language, falling back to English, any name, the slug, then a placeholder.
  const lang = document.documentElement.lang || 'en';
  const n = p.complex.name;
  return n[lang] || n.en || Object.values(n).find(Boolean) || p.complex.slug || t('nb.complex.untitled');
};

// --- handover quarter (estate/complex.js readyText knows en / ru / ka only: the words come from strings.js) ---------

// Ready-by is encoded as year * 10 + quarter (20274 = Q4 2027): one sortable integer instead of two fields.
export function readyLabel(n, today = todayISO()) {
  const y = readyYear(n), q = readyQuarter(n);
  if (!y || !q) return '';
  return readyBy(n, readyOfDay(today)) ? t('nb.ready.done') : t('nb.ready.q', { q, y });
}

// --- money ------------------------------------------------------------------------------------------------------------

// Intl.NumberFormat construction is costly and money() runs for every board cell: cache per language + options.
// null cached too, so an unsupported option set falls back to moneyText without retrying.
const nf = new Map();
function numberFormat(opts) {
  const lang = document.documentElement.lang || 'en';
  const key = lang + JSON.stringify(opts);
  if (!nf.has(key)) { let f = null; try { f = new Intl.NumberFormat(lang, opts); } catch { f = null; } nf.set(key, f); }
  return nf.get(key);
}

/** Minor units -> '$52,300' (whole units) | '$52,300.00' (cents) | '$52K' (compact). */
export function money(m, cur, { cents = false, compact = false } = {}) {
  const c = cleanCurrency(cur) || 'USD';
  const d = minorUnits(c);
  // narrowSymbol: "$" instead of "US$"; compact: "52K" for tiles. Whole units by default: prices of flats in cents
  // are noise on a board.
  const f = numberFormat({ style: 'currency', currency: c, currencyDisplay: 'narrowSymbol', minimumFractionDigits: cents ? d : 0, maximumFractionDigits: cents ? d : compact ? 1 : 0, notation: compact ? 'compact' : 'standard' });
  if (!f) return moneyText(m, c);
  return f.format(cents ? fromMinor(m, c) : Math.round(fromMinor(m, c)));
}
// Short price for the board cells: thousands with 'k', millions with 'M' (the full price is in the cell's label).
export function kilo(m, cur) {
  const v = fromMinor(m, cur);
  return v >= 1e6 ? num(v / 1e6, 2) + 'M' : v >= 1e3 ? num(v / 1e3, v >= 1e5 ? 0 : 1) + 'k' : num(v, 0);
}
export const num = (v, d = 1) => { const f = numberFormat({ maximumFractionDigits: d, minimumFractionDigits: 0 }); return f ? f.format(v) : String(v); };
export const areaText = (a) => (a > 0 ? t('nb.m2', { a: num(a, 2) }) : '—');
export const pctText = (v, d = 1) => { const f = numberFormat({ style: 'percent', maximumFractionDigits: d }); return f ? f.format(v) : Math.round(v * 100) + ' %'; };

// GEL per one unit of the project currency, typed by hand (no rate feed: the page is offline).
// GEL is the local currency (Georgia): many buyers think in it while developers price in USD.
export const hasGel = (p) => p.complex.currency !== 'GEL' && p.complex.gelRate > 0;
export function toGel(p, m) {
  if (p.complex.currency === 'GEL') return m;
  if (!hasGel(p)) return null;
  return convertMinor(m, p.complex.currency, 'GEL', { base: p.complex.currency, rates: { GEL: p.complex.gelRate } });
}
// Display in the chosen currency ('main' or 'GEL').
export function shown(p, m, which = 'main', o) {
  if (which === 'GEL' && hasGel(p)) return money(toGel(p, m), 'GEL', o);
  return money(m, p.complex.currency, o);
}
export const withCurrency = (p, list) => list.map((u) => ({ ...u, currency: p.complex.currency }));

// --- unit words ----------------------------------------------------------------------------------------------------

export const statusText = (s) => t('nb.status.' + s);
export const roomsText = (n) => (n > 0 ? t('nb.rooms.n', { n }) : t('nb.rooms.studio'));
export const roomsShort = (n) => (n > 0 ? t('nb.rooms.short', { n }) : t('nb.rooms.studioShort'));
export const viewText = (v) => (v ? t('nb.view.' + v) : '—');

/** The layout type of a unit: summary and kind from its room tree (estate/rooms.js), the Euro word (estate/scales.js). */
export function layoutInfo(p, u) {
  const def = u && p.layouts[u.layout];
  if (!def || !def.rooms.length) return null;
  const sum = roomsSummary(def.rooms);
  const kind = roomsLayout(def.rooms);
  const lang = document.documentElement.lang || 'en';
  let word = '';
  // Russian has the established "Euro-N" naming (евродвушка, ...); other languages get a neutral "Euro N-bedroom".
  if (kind.layout === 'apartments') word = lang === 'ru' ? scaleWord(EURO_SCALE, kind.size, 'ru') : t('nb.layout.euroN', { b: kind.bedrooms });
  return { def, sum, kind, word };
}

const ROOM_KIND = { bedroom: 'bedroom', bath: 'bath', toilet: 'bath', wc: 'bath', hallway: 'hallway', corridor: 'hallway', balcony: 'balcony', loggia: 'balcony', storage: 'storage', kitchen: 'kitchen' };
export function roomName(r) {
  const types = r.types || [];
  if (types.includes('kitchen') && types.some((x) => x !== 'kitchen')) return t('nb.room.kitchenLiving');
  const k = types[0] || 'room';
  return t('nb.room.' + (['room', 'living', 'bedroom', 'kitchen', 'bath', 'hallway', 'balcony', 'storage', 'corridor', 'loggia'].includes(k) ? k : 'room'));
}

// Area-preserving construction: total width W = sqrt(total / 0.6) gives a 5:3 rectangle; each row's height is its
// area sum / W, and each room's width is its area / row height, so every rectangle's area equals the room's real
// area. The positions are invented; the proportions are honest.
/**
 * A schematic sketch of a layout type (not a floor plan: rooms keep their areas, the geometry is invented): living
 * spaces along the top, service spaces and the balcony along the bottom, one rectangle of about 5 : 3.
 */
export function layoutSketch(def, title = '') {
  const rooms = def.rooms.filter((r) => r.area > 0);
  if (!rooms.length) return '';
  const svc = (r) => ['bath', 'toilet', 'wc', 'hallway', 'corridor', 'balcony', 'loggia', 'storage'].includes(r.types[0]);
  const top = rooms.filter((r) => !svc(r)), bottom = rooms.filter(svc);
  const total = rooms.reduce((s, r) => s + r.area, 0);
  const W = Math.sqrt(total / 0.6);
  const shapes = [];
  let y = 0;
  for (const row of [top, bottom]) {
    if (!row.length) continue;
    const sum = row.reduce((s, r) => s + r.area, 0);
    const hh = sum / W;
    let x = 0;
    for (const r of row) {
      const w = r.area / hh;
      const kind = r.types.includes('kitchen') && r.types.length > 1 ? 'kitchen' : ROOM_KIND[r.types[0]] || 'room';
      shapes.push({ id: r.key, kind, x, y, w, h: hh, label: roomName(r) });
      x += w;
    }
    y += hh;
  }
  return pageSVG({ id: 'sketch', name: title, w: W, h: y, shapes }, { pad: 0.3, title, scale: true });
}

// The plan stylesheet is injected once, on first use: pages that never show a sketch never load it.
let planStyle = false;
export function ensurePlanCss() {
  if (planStyle) return;
  planStyle = true;
  document.head.append(h('style', {}, planCss()));
}

// --- filters -------------------------------------------------------------------------------------------------------

export const FILTER_DEF = { rooms: [], views: [], status: [], areaMin: '', areaMax: '', floorMin: '', floorMax: '', priceMax: '' };
export const ROOM_OPTS = ['0', '1', '2', '3', '4'];

// Lenient number parsing for filter fields: spaces as thousand separators and a decimal comma are accepted.
const numOf = (v) => { const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
export { numOf };

/** Whether a unit passes the filters (price max in whole units of the project currency). */
export function matches(p, u, f) {
  // "4" means 4 or more rooms: the chip set ends at 4.
  if (f.rooms.length && !f.rooms.includes(String(Math.min(4, u.rooms)))) return false;
  if (f.views.length && !f.views.includes(u.view)) return false;
  if (f.status.length && !f.status.includes(u.status)) return false;
  const aMin = numOf(f.areaMin), aMax = numOf(f.areaMax), fMin = numOf(f.floorMin), fMax = numOf(f.floorMax), pMax = numOf(f.priceMax);
  // `!(x >= min)` instead of `x < min`: also rejects NaN / missing values when a bound is set.
  if (aMin != null && !(u.area >= aMin)) return false;
  if (aMax != null && !(u.area <= aMax)) return false;
  if (fMin != null && !(u.floor != null && u.floor >= fMin)) return false;
  if (fMax != null && !(u.floor != null && u.floor <= fMax)) return false;
  // A price filter excludes units with an unknown price (0): "under 100k" must not list unpriced flats.
  if (pMax != null && !(u.price > 0 && fromMinor(u.price, p.complex.currency) <= pMax)) return false;
  return true;
}
export const filterActive = (f) => f.rooms.length + f.views.length + f.status.length > 0 || ['areaMin', 'areaMax', 'floorMin', 'floorMax', 'priceMax'].some((k) => numOf(f[k]) != null);

// --- widgets -------------------------------------------------------------------------------------------------------

let gid = 0;
// Labelled group for non-input controls: the label names the group through aria-labelledby.
export function group(label, control, hint) {
  const id = 'nb-g' + (++gid);
  control.setAttribute('aria-labelledby', id);
  return h('div', { class: 'ed-field' }, h('span', { class: 'ed-label', id }, t(label)), control, hint ? h('div', { class: 'ed-hint' }, hint) : null);
}

export function kvRows(rows) {
  const dl = h('dl', { class: 'ap-kv nb-kv' });
  for (const [k, v] of rows) {
    if (v == null || v === '') continue;
    dl.append(h('dt', {}, t(k)), h('dd', {}, v));
  }
  return dl;
}

// Toggle chips (several values): options [{ v, l }], value array; aria-pressed buttons.
// The values array is mutated in place and passed back: callers keep one filter object and re-render from it.
export function chips(options, values, onChange, aria) {
  const box = h('div', { class: 'nb-chips', role: 'group', 'aria-label': aria ? t(aria) : null });
  for (const o of options) {
    const on = values.includes(o.v);
    box.append(h('button', {
      type: 'button', class: 'nb-chip' + (on ? ' nb-on' : ''), 'aria-pressed': String(on), dataset: { v: o.v },
      onclick: (e) => {
        const b = e.currentTarget;
        const i = values.indexOf(o.v);
        if (i >= 0) values.splice(i, 1); else values.push(o.v);
        b.classList.toggle('nb-on', i < 0);
        b.setAttribute('aria-pressed', String(i < 0));
        onChange(values);
      },
    }, o.l));
  }
  return box;
}

export function tile(label, value, sub, cls = '') {
  return h('div', { class: 'nb-tile' + (cls ? ' ' + cls : '') }, h('div', { class: 'nb-tile-l' }, t(label)), h('div', { class: 'nb-tile-v' }, value), sub ? h('div', { class: 'nb-tile-s' }, sub) : null);
}

// Prints one element: the page hides everything else while printing (app.css body.nb-printing).
// Same print pattern as the other apps: a body-level sheet, body class for print CSS, cleanup on afterprint with a
// timer fallback for browsers that never fire it; 50ms lets styles apply before the print snapshot.
export function printElement(el) {
  let sheet = document.getElementById('nb-print');
  if (sheet) sheet.remove();
  sheet = h('div', { id: 'nb-print', class: 'nb-print' }, el);
  document.body.append(sheet);
  document.body.classList.add('nb-printing');
  const done = () => { document.body.classList.remove('nb-printing'); sheet.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { window.print(); setTimeout(done, 1000); }, 50);
}

// \p{L}\p{N}: Georgian and Cyrillic complex names keep their letters in file names.
export const fileSlug = (s) => String(s || 'project').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
