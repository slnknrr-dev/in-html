// newbuild-board/importer.js - the import page: a developer's unit table pasted as text or dropped as CSV / TSV / XLSX,
// columns sniffed by estate/table.js (flat, floor, area, rooms, price, price per m², status in English, Russian and
// Georgian) plus the columns that library does not know (building, section, view, layout, currency) through
// csv/mapping.js, a mapping the user can fix, a preview with problems by line, a merge into the project (update the
// units found by building + flat, add the new ones, history lines for price and status changes) or a replacement,
// and CSV exports of the project.
//
// Pipeline: source (text / CSV / TSV / XLSX) -> R.src { header, rows with original line numbers } -> R.map (column
// meanings, sniffed then user-corrected) -> buildUnits() -> R.parsed { units, problems, new buildings } -> preview
// with a per-unit diff -> applyImport(). Every stage is recomputed from the previous one, so changing a mapping or
// the mode never needs a re-read of the file. Nothing touches the project until "Apply".
// Problems are collected per line, never thrown: a price list with 3 bad rows out of 400 still imports 397.
import {
  UNIT_MAX, VIEWS, buildingOf, changeUnit, cleanBuildingId, fileSlug, hasGel, loadProject, money, normalizeProject,
  onProjectChange, roomsText, saveProject, sortUnits, startShell, statusText, todayISO, toGel, unitKey, viewText, complexTitle,
} from './common.js';
import { button, card, download, dropZone, field, seg, select, t, textInput, toast } from '../ui/app.js';
import { $, debounce, h, lsGet, lsSet } from '../ui/dom.js';
import { confirmDialog } from '../ui/overlays.js';
import { parseCSV, serializeCSV, sniffCSV } from '../csv/csv.js';
import { decodeBytes } from '../csv/encoding.js';
import { suggestMapping } from '../csv/mapping.js';
import { readXLSX } from '../xlsx/read.js';
import { CellError, cellValue } from '../xlsx/cells.js';
import { cellInt, cellNumber, cellText, isFlatNumber, unitColumnOf, unitStatusOf } from '../estate/table.js';
import { pricePerM2, unitPrice } from '../estate/chessboard.js';
import { cleanCurrency, decimalText, toMinor } from '../ledger/minor.js';
import { convertMinor } from '../ledger/rates.js';

let P = loadProject();
// Target fields of the mapping; 'rate' = price per m² (the price is derived from area x rate).
const FIELDS = ['building', 'section', 'floor', 'flat', 'rooms', 'area', 'price', 'rate', 'currency', 'status', 'view', 'layout'];

// Columns estate/table.js does not sniff (it reads one building at a time): own synonyms for csv/mapping.js.
const EXTRA = {
  building: ['корпус', 'дом', 'здание', 'блок', 'building', 'block', 'tower', 'კორპუსი', 'შენობა', 'ბლოკი', 'будинок', 'gebäude', 'bâtiment', 'edificio', 'torre'],
  section: ['секция', 'подъезд', 'section', 'entrance', 'სექცია', 'სადარბაზო', 'секція', 'підїзд', 'abschnitt', 'sección', 'escalera'],
  view: ['вид', 'вид из окон', 'view', 'ხედი', 'вид з вікон', 'aussicht', 'blick', 'vue', 'vista'],
  layout: ['планировка', 'тип планировки', 'layout', 'plan', 'floor plan', 'გეგმარება', 'планування', 'grundriss', 'plano'],
  currency: ['валюта', 'currency', 'ვალუტა', 'währung', 'devise', 'moneda'],
};
// Status, view and studio words beyond estate/table.js (English / Russian / Georgian there).
const STATUS_EXTRA = {
  free: ['вільна', 'вільно', 'frei', 'verfügbar', 'libre', 'disponible', 'disponibles', 'en venta', 'à vendre'],
  reserved: ['заброньована', 'бронь', 'reserviert', 'réservé', 'réservée', 'reservado', 'reservada'],
  sold: ['продана', 'продано', 'verkauft', 'vendu', 'vendue', 'vendido', 'vendida'],
  closed: ['знята з продажу', 'nicht im verkauf', 'retiré', 'retirado', 'не в продаже', 'არ იყიდება'],
};
const VIEW_WORDS = {
  sea: ['sea', 'море', 'на море', 'ზღვა', 'meer', 'mer', 'mar'],
  city: ['city', 'город', 'на город', 'місто', 'ქალაქი', 'stadt', 'ville', 'ciudad'],
  mountain: ['mountain', 'mountains', 'горы', 'на горы', 'гори', 'მთა', 'მთები', 'berge', 'montagne', 'montaña'],
  yard: ['yard', 'courtyard', 'двор', 'во двор', 'двір', 'ეზო', 'hof', 'cour', 'patio'],
};
// "ст." = common Russian abbreviation of студия in developer price lists.
const STUDIO = /^(studio|студия|студія|სტუდიო|estudio|studio-apartment|ст\.?)$/i;

// Exact (lower-cased) word match only: fuzzy matching of statuses risks reading "не продана" as "продана".
const wordOf = (dict, v) => { const s = cellText(v).toLowerCase(); if (!s) return ''; for (const [k, list] of Object.entries(dict)) if (list.includes(s)) return k; return ''; };

// ---------------------------------------------------------------------------------------------------------------
// State

const IKEY = 'nb-import';
const S = (() => {
  const v = lsGet(IKEY, null) || {};
  // The pasted text is kept (capped at 400 kB) so a reload restores the work in progress.
  return { text: typeof v.text === 'string' ? v.text.slice(0, 400000) : '', mode: v.mode === 'replace' ? 'replace' : 'merge', building: typeof v.building === 'string' ? v.building : '' };
})();
const save = debounce(() => lsSet(IKEY, S), 300);
// R: derived, in-memory only; recomputed from S.text or the dropped file.
const R = { src: null, map: [], parsed: null, name: '' };      // src: { header, rows: [{ row, line }], kind }

// ---------------------------------------------------------------------------------------------------------------
// Reading

// Line numbers are 1-based positions in the source (including the header), so problems point at the right row in
// the user's spreadsheet even after blank rows are skipped. The first non-empty row is the header.
function rowsToSource(rows, kind) {
  const list = rows.map((row, i) => ({ row, line: i + 1 })).filter((x) => Array.isArray(x.row) && x.row.some((c) => cellText(c) !== ''));
  if (!list.length) return null;
  return { header: list[0].row.map((c) => cellText(c)), rows: list.slice(1), kind };
}

function fromText(text) {
  const s = String(text || '');
  if (!s.trim()) return null;
  // Delimiter and quote are sniffed: Russian Excel exports use ';', others ',' or tab.
  const { delimiter, quote } = sniffCSV(s);
  return rowsToSource(parseCSV(s, { delimiter, quote, maxRows: UNIT_MAX + 50 }), 'text');
}

async function fromFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // ZIP magic (PK) or the extension = XLSX. The first sheet with any data is used; dates become ISO days and
  // formula errors (#N/A) empty cells.
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (zip || /\.xls[xm]$/i.test(file.name)) {
    const wb = await readXLSX(bytes);
    for (const sh of wb.sheets) {
      const rows = (sh.rows || []).slice(0, UNIT_MAX + 50).map((r) => Array.from(r || [], (c) => {
        const v = cellValue(c);
        if (v == null || v instanceof CellError) return '';
        return v instanceof Date ? v.toISOString().slice(0, 10) : v;
      }));
      const src = rowsToSource(rows, 'xlsx');
      if (src) return { src, text: '' };
    }
    return { src: null, text: '' };
  }
  // decodeBytes detects UTF-8 / UTF-16 / Windows-1251: CSVs from Russian Excel are often not UTF-8.
  const { text } = decodeBytes(bytes);
  return { src: fromText(text), text };
}

/** Column meanings: estate/table.js first (it knows that "price per m²" is a rate), csv/mapping.js for the rest. */
function sniffMap(header) {
  const map = header.map(() => '');
  const taken = new Set();
  // Each meaning is assigned to at most one column (first match wins), so "Цена" and "Цена за м²" cannot both
  // become "price"; estate/table.js classifies the latter as 'rate'.
  header.forEach((hd, i) => { const f = unitColumnOf(hd); if (f && !taken.has(f)) { map[i] = f; taken.add(f); } });
  const rest = header.map((hd, i) => ({ hd, i })).filter((x) => !map[x.i] && x.hd);
  if (rest.length) {
    const targets = Object.keys(EXTRA).filter((k) => !taken.has(k)).map((key) => ({ key, synonyms: EXTRA[key] }));
    // min 0.6: similarity threshold of csv/mapping.js; lower would map unrelated headers.
    const sug = suggestMapping(rest.map((x) => x.hd), targets, {}, { min: 0.6 });
    for (const x of rest) { const f = sug.columns[x.hd]; if (f && !taken.has(f)) { map[x.i] = f; taken.add(f); } }
  }
  return map;
}

// ---------------------------------------------------------------------------------------------------------------
// Rows -> units

function buildUnits(src, map) {
  const out = { units: [], problems: [], buildings: new Map() };
  const col = {};
  map.forEach((f, i) => { if (f && col[f] == null) col[f] = i; });
  if (col.flat == null) { out.problems.push({ line: 1, kind: 'noFlatCol' }); return out; }
  const pc = P.complex.currency;
  const step = toMinor(100, pc);
  const seen = new Set();
  // Rows without a building column go to the chosen default building.
  const defB = buildingOf(P, S.building) ? S.building : P.buildings[0]?.id || 'A';
  for (const { row, line } of src.rows) {
    const get = (f) => (col[f] == null ? undefined : row[col[f]]);
    const has = (f) => col[f] != null && cellText(get(f)) !== '';
    const flat = cellText(get('flat')).slice(0, 24);
    // Rows whose "flat" is not a flat number (totals, section headings, notes) are reported and skipped.
    if (!isFlatNumber(flat)) { out.problems.push({ line, kind: 'noFlat', text: flat || cellText(row[0]) }); continue; }
    let building = defB;
    if (has('building')) {
      const bt = cellText(get('building')).slice(0, 60);
      const known = P.buildings.find((b) => b.id.toLowerCase() === bt.toLowerCase() || b.name.toLowerCase() === bt.toLowerCase())
        || [...out.buildings.values()].find((b) => b.name.toLowerCase() === bt.toLowerCase());
      if (known) building = known.id;
      else {
        // 'Block C' / 'Корпус 3' -> C / 3: the word is the column's, the id is what follows it.
        const id = cleanBuildingId(bt.replace(/^(корпус|корп\.?|блок|дом|block|building|tower|korpus|კორპუსი|ბლოკი)\s*/iu, '')) || cleanBuildingId(bt);
        if (!id) { out.problems.push({ line, kind: 'badBuilding', text: bt }); continue; }
        building = id;
        if (!buildingOf(P, id) && !out.buildings.has(id)) out.buildings.set(id, { id, name: bt, ready: 0, handover: '' });
      }
    }
    const key = unitKey(building, flat);
    // Duplicate building + flat inside one file: the first wins; the rest are reported, not merged silently.
    if (seen.has(key)) { out.problems.push({ line, kind: 'dupe', text: `${building} ${flat}` }); continue; }
    if (out.units.length >= UNIT_MAX) { out.problems.push({ line, kind: 'over', text: flat }); continue; }
    seen.add(key);
    const u = { key, line, building, flat, set: new Set() };
    if (has('section')) { u.section = cellText(get('section')).replace(/^(секция|section|секція|სექცია)\s*/iu, '').slice(0, 12) || '1'; u.set.add('section'); }
    if (has('floor')) { const f = cellInt(get('floor')); if (f == null) out.problems.push({ line, kind: 'badFloor', text: cellText(get('floor')) }); else { u.floor = f; u.set.add('floor'); } }
    if (has('area')) { const a = cellNumber(get('area')); if (a == null || a <= 0) out.problems.push({ line, kind: 'badArea', text: cellText(get('area')) }); else { u.area = Math.round(a * 100) / 100; u.set.add('area'); } }
    if (has('rooms')) {
      const rv = get('rooms');
      // Studio words count as 0 rooms (the board's convention for studios).
      const r = STUDIO.test(cellText(rv)) ? 0 : cellInt(rv);
      if (r == null || r < 0) out.problems.push({ line, kind: 'badRooms', text: cellText(rv) }); else { u.rooms = Math.min(20, r); u.set.add('rooms'); }
    }
    const cy = has('currency') ? cleanCurrency(cellText(get('currency'))) : pc;
    let price = null;
    if (has('price')) {
      const n = cellNumber(get('price'));
      if (n == null || n <= 0) out.problems.push({ line, kind: 'badPrice', text: cellText(get('price')) }); else price = toMinor(n, cy);
    } else if (has('rate')) {
      const r = cellNumber(get('rate'));
      // Price from a rate per m²: area x rate, rounded to 100 currency units, only when the area is known.
      if (r > 0 && (u.area || 0) > 0) price = unitPrice(u.area, toMinor(r, cy), toMinor(100, cy));
    }
    if (price != null && cy !== pc) {
      // Prices in lari in a dollar project come back through the same hand-entered rate; other currencies are refused.
      const table = { base: pc, rates: { GEL: P.complex.gelRate } };
      const back = cy === 'GEL' && hasGel(P) ? convertMinor(price, 'GEL', pc, table) : null;
      // After conversion the price is rounded to 100 units of the project currency (|| back: keep tiny prices unrounded).
      if (back == null) { out.problems.push({ line, kind: 'currency', text: cy }); price = null; } else price = Math.round(back / step) * step || back;
    }
    if (price != null) { u.price = price; u.set.add('price'); }
    if (has('status')) {
      const s = unitStatusOf(get('status')) || wordOf(STATUS_EXTRA, get('status'));
      if (!s) out.problems.push({ line, kind: 'badStatus', text: cellText(get('status')) }); else { u.status = s; u.set.add('status'); }
    }
    // View accepted as the internal key or any known word in several languages; unknown views are ignored, not errors.
    if (has('view')) { const v = VIEWS.includes(cellText(get('view')).toLowerCase()) ? cellText(get('view')).toLowerCase() : wordOf(VIEW_WORDS, get('view')); if (v) { u.view = v; u.set.add('view'); } }
    // Layout keys must exist in the project (layouts are defined on the complex page); unknown keys are ignored.
    if (has('layout')) { const l = Object.keys(P.layouts).find((k) => k.toLowerCase() === cellText(get('layout')).toLowerCase()); if (l) { u.layout = l; u.set.add('layout'); } }
    out.units.push(u);
  }
  return out;
}

// What the merge would do with one parsed unit: 'new', 'update' (with the changed fields) or 'same'.
// u.set lists the fields present in the source, so a merge only overwrites columns the file actually has.
function diffOf(u) {
  const ex = P.units.find((x) => x.id === u.key);
  if (!ex || S.mode === 'replace') return { kind: 'new', fields: [] };
  const fields = [...u.set].filter((f) => ex[f] !== u[f]);
  return { kind: fields.length ? 'update' : 'same', fields, ex };
}

// Atomic apply: all changes go into a structuredClone, which is normalised and saved in one step; a failure midway
// leaves the stored project untouched.
async function applyImport() {
  const parsed = R.parsed;
  if (!parsed || !parsed.units.length) { toast(t('nb.im.nothing'), 'warn'); return; }
  const n = parsed.units.length;
  if (S.mode === 'replace' && !(await confirmDialog(t('nb.im.replaceT'), t('nb.im.replaceQ', { n, m: P.units.length }), t('nb.im.replace'), true))) return;
  const d = todayISO();
  const next = structuredClone(P);
  if (S.mode === 'replace') next.units = [];
  for (const b of parsed.buildings.values()) if (!next.buildings.some((x) => x.id === b.id)) next.buildings.push({ ...b });
  if (!next.buildings.length) next.buildings.push({ id: 'A', name: 'A', ready: 0, handover: '' });
  let add = 0, upd = 0;
  for (const u of parsed.units) {
    if (!next.buildings.some((b) => b.id === u.building)) next.buildings.push({ id: u.building, name: u.building, ready: 0, handover: '' });
    const ex = next.units.find((x) => x.id === u.key);
    if (ex) {
      let ch = false;
      for (const f of ['section', 'floor', 'area', 'rooms', 'view', 'layout']) if (u.set.has(f) && ex[f] !== u[f]) { ex[f] = u[f]; ch = true; }
      // Status / price through changeUnit, so imports leave history lines tagged 'import'; other fields change silently.
      if (changeUnit(ex, { status: u.set.has('status') ? u.status : undefined, price: u.set.has('price') ? u.price : undefined }, 'import', d)) ch = true;
      if (ch) upd++;
    } else {
      const status = u.status || 'free';
      next.units.push({
        id: u.key, building: u.building, section: u.section || '1', floor: u.floor ?? null, flat: u.flat, area: u.area || 0, rooms: u.rooms || 0,
        price: u.price || 0, status, view: u.view || '', layout: u.layout || '', history: [{ d, s: status, p: u.price || 0, by: 'import' }],
      });
      add++;
    }
  }
  // Replace mode drops buildings left without units, including buildings the user created but never filled.
  if (S.mode === 'replace') next.buildings = next.buildings.filter((b) => next.units.some((u) => u.building === b.id));
  sortUnits(next.units);
  P = normalizeProject(next);
  saveProject(P);
  toast(t('nb.im.done', { n: add + upd, a: add, u: upd }), 'ok');
  renderAll();
}

// ---------------------------------------------------------------------------------------------------------------
// Exports

function exportCSV(freeOnly) {
  const c = P.complex.currency, gel = hasGel(P);
  const head = ['building', 'section', 'floor', 'flat', 'rooms', 'area', 'price', 'price_per_m2', 'currency', 'status', 'view', 'layout'];
  if (gel) head.push('price_gel');
  const rows = [head];
  for (const u of P.units) {
    if (freeOnly && u.status !== 'free') continue;
    const r = [u.building, u.section, u.floor ?? '', u.flat, u.rooms, u.area || '', u.price ? decimalText(u.price, c) : '', pricePerM2(u) ? decimalText(pricePerM2(u), c) : '', c, u.status, u.view, u.layout];
    if (gel) r.push(u.price ? decimalText(toGel(P, u.price), 'GEL') : '');
    rows.push(r.map(String));
  }
  // BOM so Excel opens UTF-8 correctly; guard:true prefixes cells starting with = + - @ (CSV formula injection).
  download('﻿' + serializeCSV(rows, { guard: true }), `${fileSlug(P.complex.slug || complexTitle(P))}-${freeOnly ? 'free' : 'units'}.csv`, 'text/csv');
}

// Sample in the format of a typical Russian-language developer price list (';', decimal comma, space thousands,
// "студия", a totals row that must be reported as a problem, not imported).
const SAMPLE = [
  'Корпус;Секция;Этаж;№ квартиры;Комнат;Площадь, м²;Цена, USD;Статус;Вид',
  'C;1;2;201;студия;29,8;31 900;Свободна;двор',
  'C;1;2;202;2;46,2;48 500;Свободна;море',
  'C;1;2;203;3;63,0;64 300;Бронь;город',
  'C;1;3;301;студия;29,8;32 400;Продана;двор',
  'C;1;3;302;2;46,2;49 100;Свободна;море',
  'C;1;3;303;3;63,0;65 000;Свободна;город',
  'C;1;4;401;студия;29,8;32 800;Свободна;двор',
  'C;1;4;402;2;46,2;49 700;Свободна;море',
  'C;1;4;403;3;63,0;65 700;Свободна;город',
  'Итого;;;;;;437 400;;',
].join('\n');

// ---------------------------------------------------------------------------------------------------------------
// Layout

const main = $('#main');
main.classList.add('nb-import');
const els = {};

function renderAll() {
  main.textContent = '';
  const area = textInput(S.text, (v) => { S.text = v; save(); readTextSoon(); }, { multiline: true, rows: 9, class: 'ed-input ed-textarea nb-mono', dir: 'ltr', placeholder: t('nb.im.pastePh') });
  els.area = area;
  const drop = dropZone({ accept: '.csv,.tsv,.txt,.xlsx,.xlsm', label: 'nb.im.drop', onFiles: (f) => takeFile(f[0]) });
  const sample = button('nb.im.sample', 'table', () => { S.text = SAMPLE; area.value = SAMPLE; save(); readText(); });
  sample.classList.add('ed-sm');
  const clear = button('ap.clear', 'trash', () => { S.text = ''; area.value = ''; save(); R.src = null; R.name = ''; paint(); });
  clear.classList.add('ed-sm');
  const src = card('nb.im.source', drop, field('nb.im.paste', area, 'nb.im.pasteHint'), h('div', { class: 'ap-actions' }, sample, clear));
  const bsel = select(P.buildings.map((b) => ({ v: b.id, l: '=' + b.name })), buildingOf(P, S.building) ? S.building : P.buildings[0]?.id || '', (v) => { S.building = v; save(); rebuild(); });
  const mode = seg([{ v: 'merge', l: 'nb.im.merge' }, { v: 'replace', l: 'nb.im.replace' }], S.mode, (v) => { S.mode = v; save(); rebuild(); }, 'nb.im.mode');
  const opts = card('nb.im.options',
    h('div', { class: 'ed-fields' },
      P.buildings.length ? field('nb.im.defBuilding', bsel, 'nb.im.defBuildingHint') : null,
      h('div', { class: 'ed-field' }, h('span', { class: 'ed-label', id: 'nb-im-mode' }, t('nb.im.mode')), mode, h('div', { class: 'ed-hint' }, t('nb.im.modeHint')))));
  mode.setAttribute('aria-labelledby', 'nb-im-mode');
  const ex = card('nb.im.export', h('p', { class: 'ed-hint' }, t('nb.im.exportHint', { n: P.units.length })),
    h('div', { class: 'ap-actions' }, button('nb.im.csvAll', 'download', () => exportCSV(false), 'primary'), button('nb.im.csvFree', 'download', () => exportCSV(true))));
  els.mapping = h('div', { class: 'nb-mapping' });
  els.preview = h('div', { class: 'nb-preview' });
  els.apply = button('nb.im.apply', 'check', applyImport, 'primary');
  els.apply.id = 'nb-im-apply';
  const right = h('div', { class: 'ap-stage' }, card('nb.im.mapping', els.mapping), card('nb.im.preview', els.preview, h('div', { class: 'ap-actions' }, els.apply)));
  main.append(h('div', { class: 'ap-work nb-im-work' }, h('div', { class: 'nb-col' }, src, opts, ex), right));
  if (S.text && !R.src) readText(); else paint();
}

async function takeFile(file) {
  if (!file) return;
  try {
    const { src, text } = await fromFile(file);
    R.name = file.name;
    // Text files also fill the textarea (editable, persisted); XLSX sources stay binary and are not shown as text.
    if (text) { S.text = text.slice(0, 400000); els.area.value = S.text; save(); }
    setSource(src);
    toast(src ? t('nb.im.read', { n: src.rows.length, name: file.name }) : t('nb.im.empty'), src ? 'ok' : 'warn');
  } catch (e) {
    toast(t('ap.fileErr', { name: file.name, msg: e && e.message ? e.message : String(e) }), 'error');
  }
}

const readTextSoon = debounce(() => readText(), 350);
function readText() { R.name = ''; setSource(fromText(S.text)); }

function setSource(src) {
  R.src = src;
  R.map = src ? sniffMap(src.header) : [];
  rebuild();
}

function rebuild() {
  R.parsed = R.src ? buildUnits(R.src, R.map) : null;
  paint();
}

function paint() {
  paintMapping();
  paintPreview();
}

function paintMapping() {
  const box = els.mapping;
  box.textContent = '';
  if (!R.src) { box.append(h('div', { class: 'ap-empty' }, t('nb.im.noData'))); return; }
  const tbody = h('tbody');
  R.src.header.forEach((hd, i) => {
    const samples = R.src.rows.slice(0, 40).map((r) => cellText(r.row[i])).filter(Boolean).slice(0, 3);
    const sel = select([{ v: '', l: 'nb.im.ignore' }, ...FIELDS.map((f) => ({ v: f, l: 'nb.fld.' + f }))], R.map[i] || '', (v) => {
      // One column per meaning: choosing a meaning takes it from the column that had it.
      R.map = R.map.map((x, j) => (j !== i && x === v && v ? '' : x));
      R.map[i] = v;
      rebuild();
    });
    sel.setAttribute('aria-label', t('nb.im.meaningOf', { c: hd || '#' + (i + 1) }));
    sel.dataset.col = String(i);
    tbody.append(h('tr', { class: R.map[i] ? '' : 'nb-ignored' }, h('th', { scope: 'row' }, hd || '—'), h('td', {}, sel), h('td', { class: 'nb-samples' }, samples.join(' · '))));
  });
  box.append(
    h('p', { class: 'ed-hint' }, (R.name ? R.name + ' · ' : '') + t('nb.im.rows', { n: R.src.rows.length })),
    h('div', { class: 'ap-table-wrap nb-twrap' }, h('table', { class: 'ap-table nb-table' }, h('thead', {}, h('tr', {}, h('th', {}, t('nb.im.column')), h('th', {}, t('nb.im.meaning')), h('th', {}, t('nb.im.samples')))), tbody)));
}

function paintPreview() {
  const box = els.preview, p = R.parsed;
  box.textContent = '';
  els.apply.disabled = !(p && p.units.length);
  if (!p) { box.append(h('div', { class: 'ap-empty' }, t('nb.im.noData'))); return; }
  const diffs = p.units.map((u) => ({ u, d: diffOf(u) }));
  const add = diffs.filter((x) => x.d.kind === 'new').length, upd = diffs.filter((x) => x.d.kind === 'update').length, same = diffs.filter((x) => x.d.kind === 'same').length;
  const sum = h('div', { class: 'nb-im-sum', id: 'nb-im-sum', role: 'status', 'aria-live': 'polite', dataset: { n: String(p.units.length), add: String(add), upd: String(upd) } },
    h('b', {}, t('nb.im.units', { n: p.units.length })), ' · ', t('nb.im.new', { n: add }), ' · ', t('nb.im.upd', { n: upd }), ' · ', t('nb.im.same', { n: same }));
  if (p.buildings.size) sum.append(' · ', t('nb.im.newBuildings', { list: [...p.buildings.keys()].join(', ') }));
  box.append(sum);
  if (p.problems.length) {
    // Short problem lists open by default; long ones stay collapsed so the preview stays visible.
    box.append(h('details', { class: 'nb-problems', open: p.problems.length < 8 },
      h('summary', {}, t('nb.im.problems', { n: p.problems.length })),
      h('ul', {}, p.problems.slice(0, 60).map((x) => h('li', {}, t('nb.im.line', { n: x.line }), ' — ', t('nb.prob.' + x.kind, { v: x.text ?? '' }))))));
  }
  if (!p.units.length) return;
  const c = P.complex.currency;
  const tbody = h('tbody');
  // The preview shows the first 80 units; the summary counts all of them.
  for (const { u, d } of diffs.slice(0, 80)) {
    tbody.append(h('tr', {},
      h('td', {}, h('span', { class: 'nb-tagk nb-tagk-' + d.kind }, t('nb.im.k.' + d.kind)), d.fields.length ? h('div', { class: 'ed-hint' }, d.fields.map((f) => t('nb.fld.' + f)).join(', ')) : null),
      h('td', {}, u.building), h('td', {}, u.section ?? '—'), h('td', { class: 'nb-r' }, u.floor ?? '—'), h('th', { scope: 'row' }, u.flat),
      h('td', {}, u.rooms != null ? roomsText(u.rooms) : '—'), h('td', { class: 'nb-r' }, u.area ?? '—'),
      h('td', { class: 'nb-r' }, u.price != null ? money(u.price, c) : '—'), h('td', {}, u.status ? statusText(u.status) : '—'), h('td', {}, u.view ? viewText(u.view) : '—')));
  }
  box.append(h('div', { class: 'ap-table-wrap nb-twrap' }, h('table', { class: 'ap-table nb-table' },
    h('thead', {}, h('tr', {}, ['nb.im.change', 'nb.fld.building', 'nb.fld.section', 'nb.fld.floor', 'nb.fld.flat', 'nb.fld.rooms', 'nb.fld.area', 'nb.fld.price', 'nb.fld.status', 'nb.fld.view'].map((k) => h('th', { scope: 'col' }, t(k))))), tbody)));
  if (diffs.length > 80) box.append(h('div', { class: 'ed-hint' }, t('nb.im.more', { n: diffs.length - 80 })));
}

onProjectChange((p) => { P = p; renderAll(); });
startShell('import', () => renderAll());
renderAll();
