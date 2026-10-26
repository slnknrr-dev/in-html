// route-planner/common.js - shared parts of the plan and trip-sheet pages: the shell (pages resolved from the hidden
// anchors of the page HTML, so the build can rewrite them), app icons, the persisted state (stops, depot and end,
// vehicle settings, the chosen order, trip details), the seeded Batumi demo, reading stops from pasted lines and CSV
// files, the plan (entered / optimised / manual order with pickup-before-delivery pairs, kilometres, a schedule with
// time windows), exports (CSV, GPX 1.1, Google encoded polyline) and the SVG schematic map.
//
// Design rules of this module:
// - One state object S, persisted whole under one localStorage key. Both pages read the same key, so the trip sheet
//   is a pure view of whatever the plan page last saved; no message passing between tabs is needed.
// - Load is a validator, not a deserialiser: every field of a saved object is re-checked and clamped (loadState). A
//   hand-edited or older-version blob degrades field by field to defaults instead of crashing the page.
// - The plan is derived, never stored: computePlan(S) recomputes everything from S. Only the user's choices (mode,
//   manual order) are persisted. Stored derived data would go stale the moment a stop moves.
// - The expensive part (route optimisation) is memoised on exactly the inputs that change it; names, notes, times
//   and settings that only scale distances do not invalidate it.
// - The map is an SVG *string*: the same function feeds the live map (innerHTML) and the trip sheet / print, and a
//   string has no DOM dependency, so it is testable in node. Every interpolated user text goes through escXml.
// - Coordinates are WGS84 degrees {lat, lng}; null (not NaN, not 0) means "no position": 0,0 is a valid point in the
//   Gulf of Guinea and NaN does not survive JSON (it becomes null anyway).
//
// Side-effect import first: registers this app's i18n keys before any t() below can run.
import './strings.js';
import { startApp, t } from '../ui/app.js';
import { lsGet, lsSet } from '../ui/dom.js';
import { addIcons } from '../ui/icons.js';
import { UI_STATE } from '../ui/i18n.js';
import { uid } from '../util/id.js';
import { parseLatLng, formatLatLng } from '../geo/coords.js';
import { planRoute, tripSheet } from '../geo/route.js';
import { pathLength, bboxOf, bboxAround, bboxIntersects, bboxPad } from '../geo/sphere.js';
import { fitBBox, viewOf, metersPerPixel } from '../geo/mercator.js';
import { encodePolyline } from '../geo/polyline.js';
import { escXml, pathD, placeLabels } from '../geo/render.js';
import { MAP_STYLE, OSM_ATTRIBUTION, overpassToShapes, strokeWidth } from '../geo/osm.js';
import { FIXTURE, FIXTURE_BBOX } from '../geo/fixture.js';
import { parseCSV, serializeCSV, sniffCSV, hasHeader } from '../csv/csv.js';
import { suggestMapping, parseLooseNumber } from '../csv/mapping.js';
import { formatNumber } from '../units/format.js';
import { parseTime, formatTime, parseDay } from '../calendar/date.js';

// SVG path data on a 24x24 viewBox (stroke icons). Strings, not files: zero requests, inlined by the bundler.
export const LOGO = 'M5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM19 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM7 17h6a3 3 0 0 0 0-6h-2a3 3 0 0 1 0-6h6';

addIcons({
  route: LOGO,
  depot: 'M3 10l9-6 9 6v10H3zM9 20v-6h6v6',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  sparkleRoute: 'M4 19c4 0 4-6 8-6s4 6 8 6M12 3l1.5 3.5L17 8l-3.5 1.5L12 13l-1.5-3.5L7 8l3.5-1.5z',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  sheetIc: 'M6 3h9l4 4v14H6zM9 9h6M9 13h6M9 17h4',
  geo: 'M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12zM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  pickup: 'M12 19V5M6 11l6-6 6 6',
  delivery: 'M12 5v14M6 13l6 6 6-6',
});

// Resolved hrefs of the pages (hidden anchors in the page HTML; the build rewrites their href).
// getAttribute, not a.href: .href is absolutised (file:///...), which breaks relative links once published.
// '#' fallback: a missing anchor degrades to a dead link instead of a crash at startup.
export function pageHref(id) {
  const a = document.getElementById(id);
  return a ? a.getAttribute('href') : '#';
}

// One shell config for both pages, so header and navigation are identical. offline:true shows the "works offline"
// badge: no network API is used (the OSM layer is a bundled fixture, not tiles).
export function startShell(current, onLang) {
  startApp({
    key: 'rp', name: 'rp.name', logo: LOGO, offline: true, onLang,
    pages: [
      { href: pageHref('pg-plan'), label: 'rp.page.plan', current: current === 'plan' },
      { href: pageHref('pg-sheet'), label: 'rp.page.sheet', current: current === 'sheet' },
    ],
  });
}

// Read at call time, never cached at import: a language switch re-renders and must see the new value.
export const lang = () => UI_STATE.lang || 'en';

// ---------------------------------------------------------------------------------------------------------------
// Numbers and times

// minDigits = digits: fixed decimals ("3.0 km", not "3 km") so a column of distances does not jitter.
export const fmtNum = (v, digits = 1) => formatNumber(v, { lang: lang(), digits, minDigits: digits });
export const fmtKm = (v) => t('rp.km', { v: fmtNum(v, 1) });
// Durations: "45 min" below an hour, "1 h 05" above. Clamped at 0: a negative duration is a bug upstream, not a
// value to show.
export function fmtDur(min) {
  const m = Math.max(0, Math.round(min));
  return m >= 60 ? t('rp.hm', { h: Math.floor(m / 60), m: String(m % 60).padStart(2, '0') }) : t('rp.min', { m });
}
// Minutes since midnight -> 'HH:MM', with a day mark after midnight. formatTime wraps hours modulo 24, so without
// the "+1" a route that ends at 01:10 next day would read as if it ended before it started.
export const fmtClock = (min) => formatTime(min) + (min >= 1440 ? ' +' + Math.floor(min / 1440) : '');
// 5 decimals of a degree = ~1.1 m at the equator: finer than any address geocode, short enough to read.
export const fmtCoord = (s) => (hasPos(s) ? formatLatLng(s, { digits: 5 }) : '');
// Number.isFinite rejects null, NaN, strings: the single "is this stop on the map" predicate used everywhere.
export const hasPos = (s) => !!s && Number.isFinite(s.lat) && Number.isFinite(s.lng);
// RFC 5870 geo: URI, opened by the phone's default map app. The "?q=lat,lng(label)" part is the de-facto Android
// extension that drops a labelled pin; the bare geo:lat,lng only centres the map. 6 decimals ~ 0.1 m.
// The name is percent-encoded: a ')' or '&' in it would otherwise end the label or start a new parameter.
export const geoLink = (s) => (hasPos(s) ? `geo:${s.lat.toFixed(6)},${s.lng.toFixed(6)}?q=${s.lat.toFixed(6)},${s.lng.toFixed(6)}(${encodeURIComponent(s.name || '')})` : '');

// ---------------------------------------------------------------------------------------------------------------
// State (localStorage 'rp-state', shared by both pages)

const SKEY = 'rp-state';
// '' = an ordinary stop. Only pickup/delivery take part in precedence pairs (pairsOf).
export const KINDS = ['', 'pickup', 'delivery'];
// Defaults of the vehicle settings. speed 25 km/h: average urban delivery speed including traffic lights, not the
// speed limit. rf (road factor) 1.3: road distance / great-circle distance; ~1.2-1.4 is the usual empirical range
// for a street grid, so straight-line km x 1.3 approximates driven km without a road graph. service: minutes per
// stop when the stop does not set its own.
export const DEF_CFG = { start: '09:00', speed: 25, rf: 1.3, service: 10 };

// The stop factory doubles as a normaliser: every field is coerced to its type, so code downstream never checks
// for undefined. service null = "use cfg.service" (distinct from 0 = "no stop time"); that is why ?? / isFinite
// are used and not ||, which would turn an explicit 0 into the default.
export function newStop(o = {}) {
  return {
    id: o.id || uid(), name: String(o.name ?? ''), address: String(o.address ?? ''),
    lat: Number.isFinite(o.lat) ? o.lat : null, lng: Number.isFinite(o.lng) ? o.lng : null,
    from: String(o.from ?? ''), to: String(o.to ?? ''), service: Number.isFinite(o.service) ? o.service : null,
    kind: KINDS.includes(o.kind) ? o.kind : '', pair: String(o.pair ?? ''), note: String(o.note ?? ''),
  };
}

// The seeded demo: a depot near Angisa and 11 stops across Batumi with two pickup -> delivery pairs. The table order
// is the order of the calls, as a dispatcher typed them, so the optimised route is visibly shorter.
export function demoState() {
  const rows = [
    ['Depot — Angisa warehouse', 'Angisa, Batumi', 41.6262, 41.6352, '', '', 0, '', ''],
    ['Market — fresh produce', 'Tbilisi Square, Batumi', 41.6476, 41.6447, '08:00', '11:00', 15, 'pickup', 'A'],
    ['Hotel laundry', 'New Boulevard, Batumi', 41.6372, 41.6148, '', '', 10, 'pickup', 'B'],
    ['Café on Europe Square', 'Europe Square, Batumi', 41.6513, 41.6362, '10:00', '13:00', 10, '', ''],
    ['Pharmacy Chavchavadze', 'Ilia Chavchavadze St, Batumi', 41.6430, 41.6400, '', '', 5, '', ''],
    ['Boulevard kiosk', 'Batumi Boulevard', 41.6560, 41.6385, '', '12:30', 10, 'delivery', 'A'],
    ['Office Khimshiashvili', 'Sherif Khimshiashvili St, Batumi', 41.6296, 41.6124, '', '', 10, '', ''],
    ['Bakery Gorgiladze', 'Zurab Gorgiladze St, Batumi', 41.6460, 41.6338, '', '', 5, '', ''],
    ['Station Square shop', 'Mayakovski St, Batumi', 41.6398, 41.6610, '', '', 10, 'delivery', 'B'],
    ['Old Town restaurant', 'Memed Abashidze St, Batumi', 41.6508, 41.6352, '', '', 10, '', ''],
    ['Bagrationi St flat', 'Bagrationi St, Batumi', 41.6355, 41.6395, '14:00', '17:00', 10, '', ''],
    ['Agmashenebeli St studio', 'Davit Agmashenebeli St, Batumi', 41.6418, 41.6290, '', '', 10, '', ''],
  ];
  const stops = rows.map(([name, address, lat, lng, from, to, service, kind, pair]) => newStop({ name, address, lat, lng, from, to, service, kind, pair }));
  return {
    stops, depot: stops[0].id, end: 'return', cfg: { ...DEF_CFG }, plan: { mode: 'opt', order: [] },
    meta: { title: t('rp.demo.title'), date: '', driver: '', vehicle: '' }, ui: { ghost: true },
  };
}

// The canonical shape of S. end: 'return' (closed tour back to the depot), 'open' (finish at the last stop) or a
// stop id (fixed end point). cfg is spread, not shared: mutating one state's cfg must not change DEF_CFG.
export function emptyState() {
  return { stops: [], depot: '', end: 'return', cfg: { ...DEF_CFG }, plan: { mode: 'opt', order: [] }, meta: { title: '', date: '', driver: '', vehicle: '' }, ui: { ghost: true } };
}

const str = (v, d = '') => (typeof v === 'string' ? v : d);
const numIn = (v, a, b, d) => (Number.isFinite(v) && v >= a && v <= b ? v : d);

// Saved state -> validated state. No saved state (first visit) = the demo, so a new user sees a working plan at once.
// Each field is re-validated against its range rather than trusted: localStorage is user-editable and survives app
// versions. slice(0, 500): a cap on stops, because optimisation and label placement are super-linear and a pasted
// 50 000-line file would freeze the tab on every load. Out-of-range coordinates become null (stop kept, shown as
// "missing coordinates") instead of dropping the stop silently.
export function loadState() {
  const saved = lsGet(SKEY, null);
  if (!saved || typeof saved !== 'object' || !Array.isArray(saved.stops)) return demoState();
  const s = emptyState();
  s.stops = saved.stops.filter((x) => x && typeof x === 'object').slice(0, 500).map((x) => newStop({
    ...x, lat: Number.isFinite(x.lat) && Math.abs(x.lat) <= 90 ? x.lat : null, lng: Number.isFinite(x.lng) && Math.abs(x.lng) <= 180 ? x.lng : null,
  }));
  s.depot = str(saved.depot);
  s.end = str(saved.end, 'return');
  const c = saved.cfg || {};
  s.cfg = { start: Number.isFinite(parseTime(c.start)) ? c.start : DEF_CFG.start, speed: numIn(c.speed, 1, 200, DEF_CFG.speed), rf: numIn(c.rf, 1, 3, DEF_CFG.rf), service: numIn(c.service, 0, 600, DEF_CFG.service) };
  const p = saved.plan || {};
  s.plan = { mode: ['opt', 'entered', 'manual'].includes(p.mode) ? p.mode : 'opt', order: Array.isArray(p.order) ? p.order.filter((x) => typeof x === 'string') : [] };
  const m = saved.meta || {};
  s.meta = { title: str(m.title), date: parseDay(m.date) || '', driver: str(m.driver), vehicle: str(m.vehicle) };
  // !== false: default-on for any missing/garbled value; only an explicit false turns the ghost line off.
  s.ui = { ghost: saved.ui?.ghost !== false };
  return s;
}
export const saveState = (s) => lsSet(SKEY, s);

// ---------------------------------------------------------------------------------------------------------------
// Reading stops

// A time window inside free text: two clock times joined by a hyphen, en/em dash, "..", "to" or Russian "до"/"по".
// Both ends are required: a lone "12:30" is too ambiguous (deadline? opening time? part of a note?) to guess.
// [:.] accepts "9.30", common in European typing; normTime converts the dot because parseTime accepts only ':'.
const WINDOW_RE = /(\d{1,2}[:.]\d{2})\s*(?:-|–|—|\.\.|to|до|по)\s*(\d{1,2}[:.]\d{2})/i;
// Any time spelling -> canonical 'HH:MM', or '' when unreadable (an invalid time is dropped, not kept as garbage).
const normTime = (s) => { const m = parseTime(String(s || '').replace('.', ':')); return Number.isFinite(m) ? formatTime(m) : ''; };

// "Name; 41.6513, 41.6362", "41,6513 41,6362 Café", DMS, geo: / OSM / Google links, optional "09:00-12:00".
// Strategy: peel off the most specific signal first, so a weaker pass never misreads it.
//   1. the time window (else its digits "09:00" would be tried as coordinates);
//   2. a URL (unambiguous: parseLatLng knows the link formats);
//   3. explicit separators (tab / ; / |): try each field alone, then each adjacent pair, because "41,6513" and
//      "41,6362" may be two fields of a decimal-comma locale;
//   4. no separators: the longest word suffix, then the longest word prefix, that parses as a coordinate.
// Whatever is left is the name. With no coordinates at all the text is also kept as the address, so a line like
// "Bagrationi St 12" still becomes a stop the user can locate later rather than being dropped.
export function parseStopLine(line) {
  let s = String(line || '').trim();
  if (!s) return null;
  let from = '', to = '';
  const w = s.match(WINDOW_RE);
  if (w) { from = normTime(w[1]); to = normTime(w[2]); s = (s.slice(0, w.index) + ' ' + s.slice(w.index + w[0].length)).trim(); }
  let pos = null, rest = s;
  // A link anywhere in the line.
  const link = s.match(/(?:geo:\S+|https?:\/\/\S+)/i);
  if (link) {
    const p = parseLatLng(link[0]);
    if (p) { pos = p; rest = s.replace(link[0], ' '); }
  }
  // Separated fields: tab, semicolon, pipe.
  if (!pos) {
    const parts = s.split(/\t|\s*[;|]\s*/).map((x) => x.trim()).filter(Boolean);
    if (parts.length > 1) {
      for (let i = 0; i < parts.length && !pos; i++) {
        const one = parseLatLng(parts[i]);
        if (one) { pos = one; rest = parts.filter((_, k) => k !== i).join(', '); break; }
        if (i + 1 < parts.length) {
          const two = parseLatLng(parts[i] + ' ' + parts[i + 1]);
          // Guard against "Hotel 5 | Floor 2" being read as coordinates: both halves need digits and the pair must
          // not contain a 3-letter word (Latin, Cyrillic or Georgian Mkhedruli range).
          if (two && /\d/.test(parts[i]) && /\d/.test(parts[i + 1]) && !/[a-zа-яა-ჰ]{3}/i.test(parts[i] + parts[i + 1])) { pos = two; rest = parts.filter((_, k) => k !== i && k !== i + 1).join(', '); }
        }
      }
    }
  }
  // Coordinates at the end or at the start of the words. Suffix first, k ascending = longest suffix first, so
  // "Café 41.65 41.63" takes both numbers, not only the last. Then prefixes, longest first. O(words^2) characters
  // parsed; lines are short, so this is cheaper to reason about than a tokenizer.
  if (!pos) {
    const words = s.split(/\s+/);
    for (let k = 0; k < words.length && !pos; k++) {
      const tail = parseLatLng(words.slice(k).join(' '));
      if (tail) { pos = tail; rest = words.slice(0, k).join(' '); break; }
    }
    for (let k = words.length; k > 0 && !pos; k--) {
      const head = parseLatLng(words.slice(0, k).join(' '));
      if (head) { pos = head; rest = words.slice(k).join(' '); }
    }
  }
  // Trim leftover separators from both ends (a removed coordinate leaves "Café ," behind), collapse inner runs.
  const name = rest.replace(/^[\s,;:|–—-]+|[\s,;:|–—-]+$/g, '').replace(/\s{2,}/g, ' ');
  return newStop({ name: name || '', lat: pos ? pos.lat : null, lng: pos ? pos.lng : null, from, to, address: pos ? '' : name });
}

// One stop per non-empty line. \r?\n: text pasted from Windows apps carries CRLF; a stray \r would end up in names.
export function parseStopLines(text) {
  const stops = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const s = parseStopLine(line);
    if (s) stops.push(s);
  }
  return stops;
}

// Header dictionary of the CSV import (English, Russian, Ukrainian, Georgian and a few others).
// Structure: field -> lowercase header spellings. csv/mapping.js suggestMapping fuzzy-matches real headers against
// these (min score 0.6 below), so near-misses like "Latitude (deg)" still map. 'coords' is a combined "lat, lng"
// column; 'window' a combined "09:00-12:00" column; both are fallbacks when the split columns are absent.
// Short entries ('x', 'y', 'с', 'з', 'de') are deliberate: exports from GIS tools use x/y, and the fuzzy matcher
// needs the exact short word to score it.
const CSV_SYNONYMS = {
  name: ['name', 'stop', 'title', 'customer', 'client', 'название', 'имя', 'клиент', 'точка', 'назва', 'клієнт', 'სახელი', 'კლიენტი', 'დასახელება', 'kunde', 'nom', 'nombre', 'cliente'],
  address: ['address', 'street', 'адрес', 'адреса', 'улица', 'მისამართი', 'adresse', 'dirección', 'direccion'],
  lat: ['lat', 'latitude', 'y', 'широта', 'განედი', 'breite', 'breitengrad', 'latitud'],
  lng: ['lng', 'lon', 'long', 'longitude', 'x', 'долгота', 'довгота', 'გრძედი', 'länge', 'laengengrad', 'längengrad', 'longitud'],
  coords: ['coordinates', 'coords', 'location', 'gps', 'point', 'position', 'координаты', 'координати', 'კოორდინატები', 'koordinaten', 'coordonnées', 'coordenadas'],
  window: ['time window', 'window', 'slot', 'delivery time', 'окно', 'временное окно', 'часове вікно', 'დროის ფანჯარა', 'zeitfenster', 'créneau', 'franja horaria'],
  from: ['from', 'window from', 'earliest', 'open', 'ready', 'с', 'от', 'время с', 'з', 'від', 'დან', 'ab', 'von', 'de', 'desde'],
  to: ['to', 'until', 'window to', 'latest', 'deadline', 'close', 'до', 'по', 'время до', 'მდე', 'bis', 'à', 'hasta'],
  service: ['service', 'service min', 'service minutes', 'minutes', 'duration', 'stop time', 'обслуживание', 'минут', 'длительность', 'стоянка', 'обслуговування', 'хвилин', 'მომსახურება', 'წუთი', 'dauer', 'durée', 'duración'],
  kind: ['type', 'kind', 'task', 'action', 'операция', 'тип', 'операція', 'ტიპი', 'მოქმედება', 'aufgabe', 'tâche', 'tarea'],
  pair: ['pair', 'order', 'order id', 'shipment', 'link', 'пара', 'заказ', 'замовлення', 'შეკვეთა', 'წყვილი', 'auftrag', 'commande', 'pedido'],
  note: ['note', 'notes', 'comment', 'примечание', 'комментарий', 'примітка', 'შენიშვნა', 'notiz', 'remarque', 'nota'],
};
export const CSV_FIELDS = Object.keys(CSV_SYNONYMS);

// Free-text task type -> 'pickup' | 'delivery' | ''. Prefix match (^...) without an end anchor, so "Pickup at 9" and
// "Доставка заказа" both classify. Pickup is tested first.
// KNOWN DEFECT: the one-letter alternatives 'p' and 'd' have no end anchor, so ANY value starting with p or d
// matches: "depot" or "drink" -> 'delivery', "parcel" -> 'pickup', and a mis-typed kind creates a precedence pair.
// Fix: anchor the short forms, e.g. `^(?:p|pu|d|del)$|^(?:pick|collect|...)` or require a word boundary after them.
export function parseKind(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return '';
  if (/^(p|pu|pick|pickup|pick-up|collect|забор|загрузка|забрать|получить|забрати|აღება|ამოღება|abholung|abholen|enlèvement|ramassage|recogida|recoger)/.test(s)) return 'pickup';
  if (/^(d|del|deliver|delivery|drop|drop-off|dropoff|доставка|выгрузка|отдать|доставити|доставка|მიტანა|ჩაბარება|lieferung|zustellung|livraison|entrega|entregar)/.test(s)) return 'delivery';
  return '';
}

/** CSV text -> { stops, columns (header -> field), header } */
// Pipeline: sniff delimiter/quote (a file from a Russian Excel uses ';', a Georgian export may use tabs), parse,
// drop blank rows, then decide whether row 0 is a header. Header criterion: >= 2 columns mapped to known fields, or
// 1 mapped column plus the statistical hasHeader test (row 0 differs in type from the rest). One weak match alone
// is not enough: a data row "Café, 41.65, 41.63" could fuzzy-match 'name' by accident and lose the first stop.
// Coordinates: the split lat/lng columns first; if they fail (missing, out of range, DMS text) fall back to the
// combined 'coords' column, then to parseLatLng on "lat lng" concatenated, which understands DMS and hemispheres.
export function parseCsvStops(text) {
  const sn = sniffCSV(text);
  const rows = parseCSV(text, { delimiter: sn.delimiter, quote: sn.quote }).filter((r) => r.some((c) => String(c).trim()));
  if (!rows.length) return { stops: [], columns: {}, header: false };
  const head = rows[0].map((x) => String(x).trim());
  const map = suggestMapping(head, CSV_FIELDS, CSV_SYNONYMS, { min: 0.6 });
  const mapped = Object.values(map.columns).filter(Boolean);
  const header = mapped.length >= 2 || (hasHeader(rows) && mapped.length >= 1);
  if (!header) {
    // No recognisable header: every row is a pasted line.
    return { stops: parseStopLines(rows.map((r) => r.join('\t')).join('\n')), columns: {}, header: false };
  }
  // field -> column index. indexOf returns the first column with that header: duplicate headers map to the first.
  const col = Object.fromEntries(Object.entries(map.columns).filter(([, f]) => f).map(([hd, f]) => [f, head.indexOf(hd)]));
  const get = (r, f) => (col[f] != null && col[f] >= 0 ? String(r[col[f]] ?? '').trim() : '');
  const stops = rows.slice(1).map((r) => {
    let lat = parseLooseNumber(get(r, 'lat')), lng = parseLooseNumber(get(r, 'lng'));
    if (!(Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) {
      const p = parseLatLng(get(r, 'coords')) || (get(r, 'lat') && get(r, 'lng') ? parseLatLng(get(r, 'lat') + ' ' + get(r, 'lng')) : null);
      lat = p ? p.lat : null; lng = p ? p.lng : null;
    }
    // Split from/to columns win; the combined window column only fills the ends that are still empty.
    let from = normTime(get(r, 'from')), to = normTime(get(r, 'to'));
    const w = get(r, 'window').match(WINDOW_RE);
    if (w) { from = from || normTime(w[1]); to = to || normTime(w[2]); }
    const svc = parseLooseNumber(get(r, 'service'));
    return newStop({ name: get(r, 'name'), address: get(r, 'address'), lat, lng, from, to, service: Number.isFinite(svc) && svc >= 0 ? svc : null, kind: parseKind(get(r, 'kind')), pair: get(r, 'pair'), note: get(r, 'note') });
  // A row with no name, no address and no position carries nothing a driver can act on (trailing totals rows etc.).
  }).filter((s) => s.name || s.address || hasPos(s));
  return { stops, columns: map.columns, header: true };
}

// ---------------------------------------------------------------------------------------------------------------
// The plan

// Precedence pairs as stop ids: every pickup of a pair label before every delivery of the same label.
// Labels compare case- and space-insensitively ("A" = " a"): typed by hand, they must not split a pair on a typo.
// Many-to-many: 2 pickups + 3 deliveries of label X give 6 constraints (cartesian product), which models
// "collect all parts before delivering any". A label with only one side yields no constraint (nothing to order).
export function pairsOf(stops) {
  const groups = new Map();
  for (const s of stops) {
    const k = s.pair.trim().toLowerCase();
    if (!k || !s.kind) continue;
    if (!groups.has(k)) groups.set(k, { pickup: [], delivery: [], label: s.pair.trim() });
    groups.get(k)[s.kind].push(s.id);
  }
  const out = [];
  for (const g of groups.values()) for (const a of g.pickup) for (const b of g.delivery) out.push({ a, b, label: g.label });
  return out;
}

// Polyline length in metres (pathLength) x road factor -> km rounded to 0.1, the same rounding geo/route.js uses,
// so the totals shown here and the legs of the sheet agree.
const kmOf = (pts, rf) => Math.round((pathLength(pts.map((s) => [s.lat, s.lng])) * rf) / 100) / 10;

// Single-entry memo: the plan page recomputes on every keystroke, but the optimiser input rarely changes. One entry
// is enough (only one state is live); an LRU would add code for no hit-rate gain.
let optCache = { key: '', order: [] };

/**
 * The plan of the current state: {
 *   located, missing, depot, endStop, closed, pairs, entered, optimised, order (ids by the chosen mode),
 *   km: { entered, optimised, current }, violations: [{ a, b, label }], rows (schedule), totalMin, endMin, late
 * }
 */
// Order conventions: every order is an array of stop ids starting with the depot; a fixed end stop is last; for a
// closed tour the return leg is NOT a repeated id but added by seq()/pts() when measuring or drawing. Keeping ids
// unique means positions (Map id -> index) are well defined for the precedence check.
// Depot fallback: the chosen depot if it still exists and has coordinates, else the first located stop, so deleting
// the depot row never leaves the plan empty. An end stop equal to the depot is ignored (that is a closed tour).
// Stops without coordinates are reported (missing) but excluded: no distance can be computed for them.
export function computePlan(S) {
  const located = S.stops.filter(hasPos), missing = S.stops.filter((s) => !hasPos(s));
  const byId = new Map(located.map((s) => [s.id, s]));
  const depot = byId.get(S.depot) || located[0] || null;
  const closed = S.end === 'return';
  const endStop = !closed && S.end !== 'open' && byId.has(S.end) && S.end !== depot?.id ? byId.get(S.end) : null;
  const pairs = pairsOf(located);
  const res = { located, missing, depot, endStop, closed, pairs, entered: [], optimised: [], order: [], km: { entered: 0, optimised: 0, current: 0 }, violations: [], rows: [], totalMin: 0, endMin: 0, late: 0 };
  if (!depot) return res;
  const middle = located.filter((s) => s !== depot && s !== endStop).map((s) => s.id);
  res.entered = [depot.id, ...middle, ...(endStop ? [endStop.id] : [])];
  // Optimised (memoised: names and times do not change it). The key lists exactly what planRoute depends on:
  // positions, kinds and normalised pair labels (for the precedence constraints), depot, end and closedness.
  // S.cfg.rf is passed to planRoute but left out of the key on purpose: a uniform factor scales every distance by
  // the same amount and cannot change which order is shortest; only the km it reports, which are not cached.
  // Time windows are not inputs either: the optimiser minimises distance, windows are only checked in schedule().
  const key = JSON.stringify([located.map((s) => [s.id, s.lat, s.lng, s.kind, s.pair.trim().toLowerCase()]), depot.id, endStop?.id, closed]);
  if (optCache.key !== key) {
    // planRoute works on array indices (distance matrix), the app on ids: translate in, translate back out.
    const idx = new Map(located.map((s, i) => [s.id, i]));
    const before = pairs.map((p) => [idx.get(p.a), idx.get(p.b)]);
    const r = planRoute(located, { start: idx.get(depot.id), end: endStop ? idx.get(endStop.id) : null, closed, before, roadFactor: S.cfg.rf });
    optCache = { key, order: r.order.map((i) => located[i].id) };
  }
  // slice(): callers may mutate res arrays (drag reorder); the cache must stay pristine.
  res.optimised = optCache.order.slice();
  // Manual order: the saved ids that still exist, new stops appended, the depot first and a fixed end last.
  // Reconciliation instead of reset: a user who hand-ordered 20 stops and then adds one keeps the 20; deleted ids
  // vanish; the Set removes duplicates from a corrupted save. The depot/end are re-pinned because the user may
  // have changed them after saving the order.
  let manual = S.plan.order.filter((id) => byId.has(id) && id !== depot.id && id !== endStop?.id);
  manual = [...new Set(manual)];
  for (const id of middle) if (!manual.includes(id)) manual.push(id);
  manual = [depot.id, ...manual, ...(endStop ? [endStop.id] : [])];
  res.order = S.plan.mode === 'manual' ? manual : S.plan.mode === 'entered' ? res.entered : res.optimised;
  // ids -> stops, plus the return leg for a closed tour. p.length > 1: a lone depot has no tour to close.
  const seq = (ids) => { const p = ids.map((id) => byId.get(id)); if (closed && p.length > 1) p.push(p[0]); return p; };
  res.km.entered = kmOf(seq(res.entered), S.cfg.rf);
  res.km.optimised = kmOf(seq(res.optimised), S.cfg.rf);
  res.km.current = kmOf(seq(res.order), S.cfg.rf);
  // Violations exist only in 'entered' and 'manual' modes (the optimiser honours `before`); they are shown, never
  // auto-fixed: a dispatcher may know better (e.g. the goods are already on board). enteredValid tells the UI whether
  // the table order itself is a legal route, for the comparison card.
  const pos = new Map(res.order.map((id, i) => [id, i]));
  res.violations = pairs.filter((p) => pos.get(p.a) > pos.get(p.b));
  res.enteredValid = (() => { const q = new Map(res.entered.map((id, i) => [id, i])); return pairs.every((p) => q.get(p.a) < q.get(p.b)); })();
  Object.assign(res, schedule(res.order.map((id) => byId.get(id)), S.cfg, closed));
  return res;
}

/**
 * Times along an order: geo/route.js tripSheet gives the legs (km with the road factor) and service minutes; the
 * time windows are applied here (wait for the window to open, late when service starts after it closes).
 */
// Why not use tripSheet's own clock: it knows nothing about windows. The clock is re-integrated here from its legs:
// arrive = previous depart + leg / speed; begin = max(arrive, window from); late if begin > window to.
// Soft windows: lateness is counted and flagged, the route is not rejected; a planner needs to see *how* late.
// +0.01 min tolerance: float drift from km/speed division must not flag an on-time arrival as late.
// Row 0 (depot departure) and the return row ignore windows: the depot's window is not a delivery promise.
// Start time fallback 540 = 09:00, matching DEF_CFG, if cfg.start is unparsable.
// Precision note: legKm comes from tripSheet already rounded to 0.1 km, so times accumulate up to 0.05 km of error
// per leg (~7 s at 25 km/h); negligible against service minutes, but a reason the ETA is shown to the minute only.
export function schedule(stops, cfg, closed) {
  const pts = stops.map((s) => ({ lat: s.lat, lng: s.lng, serviceMin: Number.isFinite(s.service) ? s.service : undefined }));
  const ts = tripSheet(pts, pts.map((_, i) => i), { start: cfg.start, speedKmh: cfg.speed, serviceMin: cfg.service, roadFactor: cfg.rf, closed });
  const start = parseTime(cfg.start);
  let tm = Number.isFinite(start) ? start : 540, late = 0;
  const rows = ts.rows.map((r, i) => {
    const stop = stops[r.index];
    const ret = closed && i === ts.rows.length - 1 && i > 0;
    // Math.max(1, speed): division guard; loadState already clamps speed to >= 1, this protects direct callers.
    tm += i ? (r.legKm / Math.max(1, cfg.speed)) * 60 : 0;
    const arrive = tm;
    const from = parseTime(stop.from), to = parseTime(stop.to);
    let wait = 0;
    if (!ret && i > 0 && Number.isFinite(from) && tm < from) { wait = from - tm; tm = from; }
    const isLate = !ret && i > 0 && Number.isFinite(to) && tm > to + 0.01;
    if (isLate) late++;
    tm += r.serviceMin;
    return { n: i, stop, ret, legKm: r.legKm, totalKm: r.totalKm, arrive, wait, begin: arrive + wait, depart: tm, service: r.serviceMin, late: isLate };
  });
  const s0 = Number.isFinite(start) ? start : 540;
  return { rows, totalMin: tm - s0, endMin: tm, late };
}

// "09:00–12:00", with an ellipsis for an open end ("…–12:30" = deadline only). En dash: typographic range sign.
export const windowText = (s) => (s.from || s.to ? `${s.from || '…'}–${s.to || '…'}` : '');

// ---------------------------------------------------------------------------------------------------------------
// Exports

// Machine-readable schedule. Headers are fixed English snake_case (not translated): a CSV is an interface for other
// programs, and a header that changes with the UI language breaks every import mapping downstream. Times are plain
// HH:MM without the "+1" day mark, for the same reason. Stops without coordinates are appended at the end so the
// export is complete (nothing silently lost). guard:true prefixes ' to cells starting with = + - @ (CSV formula
// injection: a stop named "=HYPERLINK(...)" would execute when opened in a spreadsheet). The trailing CRLF ends
// the last record, as RFC 4180 permits and some importers require.
export function exportCSV(plan) {
  const rows = [['seq', 'name', 'address', 'lat', 'lng', 'type', 'pair', 'window_from', 'window_to', 'arrive', 'depart', 'wait_min', 'service_min', 'leg_km', 'total_km', 'late', 'note']];
  for (const r of plan.rows) {
    const s = r.stop;
    rows.push([String(r.n), s.name, s.address, s.lat.toFixed(6), s.lng.toFixed(6), r.ret ? 'return' : r.n === 0 ? 'start' : s.kind || 'stop', s.pair, s.from, s.to,
      fmtClockPlain(r.arrive), fmtClockPlain(r.depart), String(Math.round(r.wait)), String(r.service), r.legKm.toFixed(1), r.totalKm.toFixed(1), r.late ? 'yes' : '', s.note]);
  }
  for (const s of plan.missing) rows.push(['', s.name, s.address, '', '', 'no coordinates', s.pair, s.from, s.to, '', '', '', '', '', '', '', s.note]);
  return serializeCSV(rows, { guard: true }) + '\r\n';
}
const fmtClockPlain = (m) => formatTime(m);

const xml = (s) => escXml(String(s ?? ''));
const c6 = (v) => v.toFixed(6);

// GPX 1.1: one waypoint per stop in visiting order and the route through them.
// Both <wpt> and <rte>: navigators differ (some import only waypoints as favourites, others only routes to follow).
// The return row is skipped among waypoints (it is the depot again: a duplicate pin) but kept as the last rtept so
// the route closes. Schema order inside the root (metadata, wpt*, rte*) is mandatory in GPX 1.1 and validated by
// strict parsers. lat/lon as attributes with 6 decimals; 'lon' is the GPX name (not 'lng'). <sym>Flag, Blue</sym>
// is a Garmin symbol name marking the start. <time> needs a full xsd:dateTime, hence T00:00:00Z on the date.
// String templating, not DOM: no XMLSerializer in node tests; safety comes from xml() on every text node and
// numeric toFixed on attributes (numbers cannot contain markup).
export function exportGPX(plan, meta = {}) {
  const name = meta.title || 'Route';
  const rows = plan.rows.filter((r) => !r.ret);
  const desc = (r) => [r.stop.address, windowText(r.stop) && 'window ' + windowText(r.stop), 'ETA ' + formatTime(r.arrive), r.stop.kind && r.stop.kind + (r.stop.pair ? ' ' + r.stop.pair : ''), r.stop.note].filter(Boolean).join('; ');
  const pt = (tag, r, indent) => `${indent}<${tag} lat="${c6(r.stop.lat)}" lon="${c6(r.stop.lng)}">\n${indent}  <name>${xml(`${r.n}. ${r.stop.name || r.stop.address || ''}`.trim())}</name>\n` +
    (desc(r) ? `${indent}  <desc>${xml(desc(r))}</desc>\n` : '') + (tag === 'wpt' && r.n === 0 ? `${indent}  <sym>Flag, Blue</sym>\n` : '') + `${indent}</${tag}>\n`;
  let out = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<gpx version="1.1" creator="Route Planner (in-html)" xmlns="http://www.topografix.com/GPX/1/1">\n' +
    `  <metadata>\n    <name>${xml(name)}</name>\n` + (meta.date ? `    <time>${meta.date}T00:00:00Z</time>\n` : '') + '  </metadata>\n';
  for (const r of rows) out += pt('wpt', r, '  ');
  out += `  <rte>\n    <name>${xml(name)}</name>\n`;
  for (const r of plan.rows) out += pt('rtept', r, '    ');
  out += '  </rte>\n</gpx>\n';
  return out;
}

// Google encoded polyline, precision 5 (1e-5 deg): the format the Google/OSRM/Mapbox APIs accept by default.
// Includes the return point for a closed tour, since plan.rows does.
export const exportPolyline = (plan) => encodePolyline(plan.rows.map((r) => [r.stop.lat, r.stop.lng]), 5);

// ---------------------------------------------------------------------------------------------------------------
// The schematic map (SVG string): Web Mercator, a grid of degrees, a scale bar, the route with direction marks, pair
// links, numbered markers with collision-free labels and, near Europe Square in Batumi, the small OSM fixture.

// Grid spacings in degrees, a 1-2-5 series (like chart axes): every zoom gets round labels. 30 deg caps the world view.
const GRID_STEPS = [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30];
// Lazily converted OSM fixture (Overpass JSON -> shapes). Converted once on first need, then reused: the conversion
// is the costly part and the fixture never changes. Labels language is fixed at first conversion (lang() then).
let fixtureShapes = null;

/** The view that shows every stop of the plan (or a default around Batumi). */
export function fitView(points, width, height) {
  let b = bboxOf(points.map((s) => [s.lat, s.lng]));
  // No points: a 2.5 km box around central Batumi (where the fixture is). One point or a tight cluster (< ~200 m):
  // widen to 300 m, else fitBBox would zoom to its maximum and show one marker on a blank canvas.
  // fractional zoom: the view fits exactly instead of snapping down a whole level (up to 2x empty margin).
  if (!b) b = bboxAround([41.6413, 41.6359], 2500);
  if (b.north - b.south < 0.002 && b.east - b.west < 0.002) b = bboxAround([(b.north + b.south) / 2, (b.east + b.west) / 2], 300);
  const v = fitBBox(b, width, height, { padding: 44, fractional: true, maxZoom: 18 });
  return { center: v.center, zoom: v.zoom };
}

/**
 * opts: { width, height, view: { center, zoom }, plan, ghost (draw the entered order), labels, title, osm }
 * Returns { svg, fixture (true when OSM data was drawn), view }.
 */
// Paint order = SVG document order (no z-index in SVG): background, OSM, grid, ghost, pair links, route casing,
// route, arrows, markers, labels, scale bar, attribution. Each later layer must stay readable over the earlier.
// Colours are CSS classes (rp-m-*), not attributes, so the same string themes itself in light/dark and on the
// paper sheet, which redefines the --rp-* tokens locally. Exception: OSM style colours come inline from MAP_STYLE
// (shared data, not themeable); CSS dims the whole OSM group in dark mode instead.
// Coordinates are rounded to 0.1 px (r1): sub-pixel precision beyond that is invisible but doubles string size.
export function mapSvg(opts) {
  const W = opts.width, H = opts.height, plan = opts.plan;
  const v = viewOf(opts.view.center, opts.view.zoom, W, H);
  const P = (lat, lng) => v.project(lat, lng);
  const out = [];
  const r1 = (x) => Math.round(x * 10) / 10;
  out.push(`<rect class="rp-m-bg" width="${W}" height="${H}"/>`);
  // OSM fixture: only when zoomed in (>= 13.5, below that streets are sub-pixel noise) and the view overlaps the
  // fixture box padded by 20% (so it does not pop in only when its edge is already on screen). Shapes are sorted by
  // style order (areas under roads, minor under major), then emitted as three groups: areas, all casings, all
  // strokes. Casings-before-strokes across ALL roads is what makes junctions merge cleanly; drawing casing+stroke
  // per road would let each road's casing cut across the previous road's fill.
  let fixture = false;
  if (opts.osm !== false && v.zoom >= 13.5 && bboxIntersects(v.bbox, bboxPad(FIXTURE_BBOX, 0.2))) {
    fixtureShapes ||= overpassToShapes(FIXTURE, { langs: [lang(), 'en'] }).shapes;
    const areas = [], cas = [], lines = [];
    for (const sh of fixtureShapes.slice().sort((a, b) => MAP_STYLE[a.kind].order - MAP_STYLE[b.kind].order)) {
      const st = MAP_STYLE[sh.kind];
      const d = pathD(sh.pts.map((p) => P(p[0], p[1])), st.area);
      if (!d) continue;
      if (st.area) areas.push(`<path d="${d}" fill="${st.fill}"/>`);
      else {
        if (st.casing) cas.push(`<path d="${d}" stroke="${st.casing}" stroke-width="${strokeWidth(st.casingWidth || st.width + 2, v.zoom)}"/>`);
        lines.push(`<path d="${d}" stroke="${st.stroke}" stroke-width="${strokeWidth(st.width, v.zoom)}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}/>`);
      }
    }
    out.push(`<g class="rp-m-osm">${areas.join('')}<g fill="none" stroke-linecap="round" stroke-linejoin="round">${cas.join('')}${lines.join('')}</g></g>`);
    fixture = true;
  }
  // Grid of degrees: the smallest step giving <= 7 lines across; decimals = just enough to tell labels apart
  // (-1e-9 keeps log10(0.001) = -3 from rounding up to 4 digits). Ceil-to-step start puts lines on round values.
  // Meridians are straight verticals in Mercator; parallels are horizontals, unevenly spaced (projected via P).
  // One <path> for all lines: one DOM node instead of dozens.
  const spanLng = v.bbox.east - v.bbox.west;
  const step = GRID_STEPS.find((s) => spanLng / s <= 7) || 30;
  const dig = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
  const grid = [], gl = [];
  for (let x = Math.ceil(v.bbox.west / step) * step; x <= v.bbox.east; x += step) {
    const px = P(v.center.lat, x)[0];
    grid.push(`M${r1(px)} 0V${H}`);
    gl.push(`<text x="${r1(px + 3)}" y="${H - 6}">${x.toFixed(dig)}°</text>`);
  }
  for (let y = Math.ceil(v.bbox.south / step) * step; y <= v.bbox.north; y += step) {
    const py = P(y, v.center.lng)[1];
    grid.push(`M0 ${r1(py)}H${W}`);
    gl.push(`<text x="4" y="${r1(py - 3)}">${y.toFixed(dig)}°</text>`);
  }
  out.push(`<path class="rp-m-grid" d="${grid.join('')}"/><g class="rp-m-gridl">${gl.join('')}</g>`);
  if (plan && plan.depot) {
    const byId = new Map(plan.located.map((s) => [s.id, s]));
    const pts = (ids) => { const p = ids.map((id) => byId.get(id)); if (plan.closed && p.length > 1) p.push(p[0]); return p.map((s) => P(s.lat, s.lng)); };
    // Ghost: the entered (table) order as a dashed line, drawn only when it differs from the shown order. It is the
    // visual "before" of the optimisation; identical lines would just double the stroke.
    if (opts.ghost && plan.entered.join() !== plan.order.join()) out.push(`<path class="rp-m-ghost" d="${pathD(pts(plan.entered), false)}"/>`);
    // Pair links.
    for (const p of plan.pairs) {
      const a = byId.get(p.a), b = byId.get(p.b);
      const [x1, y1] = P(a.lat, a.lng), [x2, y2] = P(b.lat, b.lng);
      out.push(`<path class="rp-m-pair" d="M${r1(x1)} ${r1(y1)}L${r1(x2)} ${r1(y2)}"/>`);
    }
    // Route and direction marks at the middle of each leg.
    const px = pts(plan.order);
    const d = pathD(px, false);
    // Casing: the same path wider in the background colour underneath, so the route separates from grid, ghost and
    // OSM streets it crosses. Arrows only on legs >= 46 px: on shorter legs an arrow would cover the markers.
    if (d) out.push(`<path class="rp-m-casing" d="${d}"/><path class="rp-m-route" d="${d}"/>`);
    for (let i = 1; i < px.length; i++) {
      const [x1, y1] = px[i - 1], [x2, y2] = px[i];
      if (Math.hypot(x2 - x1, y2 - y1) < 46) continue;
      const a = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
      out.push(`<path class="rp-m-arrow" transform="translate(${r1((x1 + x2) / 2)} ${r1((y1 + y2) / 2)}) rotate(${r1(a)})" d="M-5 -4.5L4 0L-5 4.5Z"/>`);
    }
    // Markers (the depot as a square), numbers in visiting order, labels placed without collisions.
    const seq = new Map(plan.order.map((id, i) => [id, i]));
    const late = new Set(plan.rows.filter((r) => r.late).map((r) => r.stop.id));
    const cands = [];
    // Markers are obstacles for the labels (priority -1, sorted first, so always accepted). The '\u0000' + id text
    // (and '\u0001' + n on labels) keeps texts unique: placeLabels rejects a repeat of the same text closer than
    // `spacing`, a street-name rule that must not apply here (spacing:0 below disables it too; belt and braces).
    // margin:-60 relaxes placeLabels' own bounds test; the stricter `inside` check below is the real bound.
    const obst = plan.order.map((id) => { const s = byId.get(id), [x, y] = P(s.lat, s.lng); return { text: '\u0000' + id, x, y, angle: 0, w: 22, h: 22, priority: -1 }; });
    const placed = [];
    // Reversed: later SVG elements paint on top, so the depot (n = 0) and early stops end up above later ones where
    // markers overlap; the start of the route stays readable. data-id lets main.js map a click back to the stop.
    // Label width is estimated (0.56 em per char) rather than measured: no DOM in a string renderer. It
    // under-estimates wide scripts (Georgian, CJK), so such labels may slightly overlap. Labels cut at 26 chars.
    const marks = plan.order.slice().reverse().map((id) => {
      const s = byId.get(id), [x, y] = P(s.lat, s.lng), n = seq.get(id);
      const cls = 'rp-m-mk' + (n === 0 ? ' rp-m-depot' : s.kind ? ' rp-m-' + s.kind : '') + (late.has(id) ? ' rp-m-late' : '') + (plan.endStop?.id === id ? ' rp-m-end' : '');
      const shape = n === 0 ? `<rect x="-11" y="-11" width="22" height="22" rx="5"/>` : `<circle r="11"/>`;
      const label = s.name || s.address;
      if (label && opts.labels !== false) { const fs = 11.5; const text = label.length > 26 ? label.slice(0, 25) + '…' : label; cands.push({ text, x, y, w: text.length * fs * 0.56, h: fs * 1.25, fs, n }); }
      return `<g class="${cls}" transform="translate(${r1(x)} ${r1(y)})" data-id="${xml(id)}">${shape}<text y="4">${n === 0 ? 'S' : n}</text></g>`;
    });
    out.push(marks.join(''));
    // Each label tries right, left, below and above its marker; the first free place wins.
    // Greedy in visiting order: stop 1 gets first pick. Optimal placement is NP-hard; greedy with 4 candidates is
    // the standard cartographic compromise. A label that fits nowhere is dropped (the number on the marker remains).
    // Each placed label becomes an obstacle (priority -1) for the next. The bottom 30 px are reserved for the scale
    // bar and attribution. Cost: placeLabels re-checks the growing list for each candidate, O(n^2) per map.
    cands.sort((a, b) => a.n - b.n);
    for (const c of cands) {
      for (const [dx, dy] of [[15 + c.w / 2, 4], [-15 - c.w / 2, 4], [0, 26], [0, -18]]) {
        const cand = { text: c.text + '\u0001' + c.n, label: c.text, x: c.x + dx, y: c.y + dy, angle: 0, w: c.w, h: c.h, fs: c.fs, priority: 0 };
        const inside = cand.x - cand.w / 2 > 2 && cand.x + cand.w / 2 < W - 2 && cand.y - cand.h / 2 > 2 && cand.y + cand.h / 2 < H - 30;
        if (inside && placeLabels([...obst, ...placed, cand], { width: W, height: H, spacing: 0, margin: -60 }).includes(cand)) { cand.priority = -1; placed.push(cand); break; }
      }
    }
    out.push(`<g class="rp-m-labels">${placed.map((c) => `<text x="${r1(c.x - c.w / 2)}" y="${r1(c.y)}" font-size="${c.fs}">${xml(c.label)}</text>`).join('')}</g>`);
  }
  // Scale bar (bottom left): the largest 1-2-5 x 10^k length not exceeding ~110 px at the view centre's latitude.
  // Mercator scale varies with latitude, so the bar is true only near the centre row; for a city-sized view the error
  // is far below a pixel. Attribution text is drawn only when OSM data was actually drawn (ODbL requires it then).
  const mpp = metersPerPixel(v.center.lat, v.zoom);
  const target = mpp * 110;
  const p10 = 10 ** Math.floor(Math.log10(target));
  const nice = [5, 2, 1].map((k) => k * p10).find((x) => x <= target) || p10;
  const bar = nice / mpp;
  const bx = 14, by = H - 26;
  out.push(`<g class="rp-m-scale"><rect x="${bx - 6}" y="${by - 16}" width="${r1(bar + 12)}" height="26" rx="5"/>` +
    `<path d="M${bx} ${by - 4}V${by + 2}H${r1(bx + bar)}V${by - 4}"/><text x="${r1(bx + bar / 2)}" y="${by - 6}" text-anchor="middle">${nice >= 1000 ? t('rp.km', { v: fmtNum(nice / 1000, nice % 1000 ? 1 : 0) }) : t('rp.m', { v: nice })}</text></g>`);
  if (fixture) out.push(`<text class="rp-m-attr" x="${W - 6}" y="${H - 6}" text-anchor="end">${xml(OSM_ATTRIBUTION)}</text>`);
  // role="img" + aria-label + <title>: the map is one image to assistive tech, not hundreds of anonymous shapes.
  // viewBox without width/height: the CSS sizes it (width:100%, height:auto) and it scales crisply.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="rp-map-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${xml(opts.title || '')}">` +
    (opts.title ? `<title>${xml(opts.title)}</title>` : '') + out.join('') + '</svg>';
  return { svg, fixture, view: v };
}
