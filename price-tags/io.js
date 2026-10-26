// price-tags/io.js - product lists in and out: CSV / TSV (csv/encoding.js decoding, csv/csv.js sniffing and parsing)
// and XLSX / ODS (xlsx/read.js, xlsx/ods.js) are read into rows, the columns are mapped to product fields with
// csv/mapping.js suggestMapping (Russian / English / Georgian headers plus this app's own synonyms) in a dialog the
// user can correct, values are coerced (loose numbers, d.m.y dates and Excel serials, units), and the products are
// merged by EAN (or name) or replace the list. An "old price" column above the price becomes the item's promo price.
// Export writes the same columns back as CSV (formula-injection guarded).
//
// Design rules:
// - Mapping is suggested, never silently applied: shop exports have arbitrary headers in three languages, and a wrong
//   guess (price into qty) would print wrong prices on the shelf. The dialog shows sample values per column and a
//   live count of rows that would import, so the user sees the effect before committing.
// - Parsing is format-sniffed, not extension-trusted: a ZIP signature ('PK') means a spreadsheet even if the file
//   was renamed .csv; CSV delimiter/quote/header are sniffed because Excel writes ';' in comma-decimal locales.
// - Every coerced value fails soft to an empty/default field (no throw per cell): one bad row must not block an import
//   of 2000. Products end up in the same shape cleanProduct() produces.
import { t, toast, download } from '../ui/app.js';
import { h } from '../ui/dom.js';
import { openDialog } from '../ui/overlays.js';
import { decodeBytes } from '../csv/encoding.js';
import { hasHeader, parseCSV, serializeCSV, sniffCSV } from '../csv/csv.js';
import { HEADER_SYNONYMS, parseLooseDate, parseLooseNumber, suggestMapping } from '../csv/mapping.js';
import { readXLSX } from '../xlsx/read.js';
import { readODS } from '../xlsx/ods.js';
import { cellValue, serialParts } from '../xlsx/cells.js';
import { addDays } from '../stock/calendar.js';
import { LANGS, LANG_NAMES, catPath, digitsOf, newId, notePriceChange, packOf, today, validDay } from './common.js';

// Target fields of a product row: key, own synonyms (added to csv/mapping.js HEADER_SYNONYMS of the same key).
// Fields without synonyms rely entirely on the shared table (name, barcode, price...), so generic header knowledge
// lives in one place. Order = order of the field <select> in the mapping dialog.
export const FIELDS = [
  { key: 'name' },
  { key: 'nameKa', synonyms: ['name ka', 'название ka', 'დასახელება ka', 'ka', 'georgian', 'georgian name', 'грузинское название', 'ქართული'] },
  { key: 'nameRu', synonyms: ['name ru', 'название ru', 'ru', 'russian', 'russian name', 'русское название', 'русский', 'რუსული'] },
  { key: 'nameEn', synonyms: ['name en', 'название en', 'en', 'english', 'english name', 'английское название', 'ინგლისური'] },
  { key: 'barcode' },
  { key: 'code' },
  { key: 'price' },
  { key: 'oldPrice', synonyms: ['old price', 'старая цена', 'цена до скидки', 'прежняя цена', 'regular price', 'was', 'ძველი ფასი'] },
  { key: 'promoPrice', synonyms: ['promo price', 'sale price', 'акционная цена', 'цена по акции', 'აქციის ფასი'] },
  { key: 'unit' },
  { key: 'size', synonyms: ['size', 'weight', 'volume', 'pack', 'net', 'вес', 'объём', 'объем', 'фасовка', 'нетто', 'წონა', 'მოცულობა'] },
  { key: 'category' },
  { key: 'origin', synonyms: ['origin', 'country', 'made in', 'country of origin', 'страна', 'страна происхождения', 'производство', 'წარმოშობა', 'ქვეყანა'] },
  { key: 'promoFrom', synonyms: ['promo from', 'promo start', 'sale from', 'акция с', 'начало акции', 'აქცია დან'] },
  { key: 'promoTo', synonyms: ['promo to', 'promo end', 'sale to', 'promo until', 'акция по', 'акция до', 'конец акции', 'აქცია მდე'] },
  { key: 'expires', synonyms: ['expires', 'expiry', 'best before', 'use by', 'exp', 'срок годности', 'годен до', 'ვარგისია'] },
  { key: 'quantity' },
];
const FIELD_KEYS = FIELDS.map((f) => f.key);

// --- reading ------------------------------------------------------------------------------------------------------

/** File -> { headers, rows (raw cells: string | number | boolean | null), sheet? }
 * Spreadsheets: the first visible sheet that has any non-empty cell (workbooks often start with a hidden or empty
 * cover sheet), else sheet 0. Object cell values (errors, rich values) are flattened to their code/string.
 * CSV: bytes are decoded with encoding detection (UTF-8 / BOM / legacy 1251), then sniffed. A headerless file gets
 * synthetic '#1', '#2' headers so the mapping UI still has a name per column.
 * Rows are padded to the widest row: ragged CSV lines would otherwise shift cells left under the wrong header.
 * KNOWN DEFECT: an empty CSV (parseCSV -> []) hits rows[0].map before the empty check and throws a TypeError; the
 * caller's catch shows that raw message instead of pt.io.empty. Fix: test rows.length before the header unshift.
 */
export async function readTable(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = (/\.([a-z0-9]+)$/i.exec(file.name || '') || ['', ''])[1].toLowerCase();
  let rows;
  if (ext === 'xlsx' || ext === 'xlsm' || ext === 'ods' || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    const wb = ext === 'ods' ? await readODS(bytes) : await readXLSX(bytes);
    const sheet = wb.sheets.find((s) => !s.hidden && s.rows.some((r) => r && r.some((c) => cellValue(c) != null && cellValue(c) !== ''))) || wb.sheets[0];
    rows = sheet.rows.map((r) => (r || []).map((c) => { const v = cellValue(c); return v != null && typeof v === 'object' ? String(v.code ?? v) : v; }));
  } else {
    const { text } = decodeBytes(bytes);
    const sn = sniffCSV(text);
    rows = parseCSV(text, { delimiter: sn.delimiter, quote: sn.quote });
    if (!sn.header && !hasHeader(rows)) rows.unshift(rows[0].map((_, i) => `#${i + 1}`));
  }
  rows = rows.filter((r) => r && r.some((v) => v != null && String(v).trim() !== ''));
  if (!rows.length) throw new Error(t('pt.io.empty'));
  const width = Math.max(...rows.map((r) => r.length));
  const headers = Array.from({ length: width }, (_, i) => String(rows[0][i] ?? '').trim() || `#${i + 1}`);
  return { headers, rows: rows.slice(1).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? null)) };
}

// --- coercion -----------------------------------------------------------------------------------------------------

const toText = (v) => (v == null ? '' : String(v).trim());
// Spreadsheet numbers are taken as is; text has currency symbols/letters stripped first ('18,90 ₾', 'GEL 5.00'), then
// parseLooseNumber resolves the decimal mark. Result in integer minor units, null for negative or unparsable.
const money = (v, digits) => {
  const n = typeof v === 'number' ? v : parseLooseNumber(toText(v).replace(/[^\d.,\s-]/g, ''));
  return n != null && Number.isFinite(n) && n >= 0 ? Math.round(n * 10 ** digits) : null;
};
// Any date cell -> 'YYYY-MM-DD' or ''. Order of attempts: ISO prefix (also cuts a time part 'T10:00'), then an Excel
// serial number (numeric cell) or a loose d.m.y text parsed to a serial; both go through serialParts so there is one
// calendar conversion. The final validDay rejects impossible results (serial 0, 31.02).
function day(v) {
  if (v == null || v === '') return '';
  const s = toText(v);
  if (validDay(s.slice(0, 10))) return s.slice(0, 10);
  const serial = typeof v === 'number' ? v : parseLooseDate(s);
  if (serial == null) return '';
  const p = serialParts(serial);
  const iso = `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  return validDay(iso) ? iso : '';
}
// Sale unit from free text. kg is a prefix match (kg, кг., килограмм, kilo...), litre an exact match because a bare
// 'l' prefix would capture any word starting with l. Everything else, including empty, is 'pcs'.
export function unitOf(text) {
  const s = toText(text).toLowerCase().replace(/\.$/, '');
  if (/^(kg|кг|კგ|kilo|килограмм)/.test(s)) return 'kg';
  if (/^(l|л|ლ|lt|litre|liter|литр)$/.test(s)) return 'l';
  return 'pcs';
}

/** Rows + mapping (header -> field) -> products. opts: { lang (of the 'name' column), digits }
 * Pure (no data mutation), so the dialog can call it on every mapping change for the live row count.
 * Rules: field -> first mapped column wins (two columns mapped to 'price' do not overwrite each other); language-
 * specific name columns override the generic one; rows with no name in any language are skipped (blank tags are
 * worse than a missing row). A unit column holding a pack size ('500 g') is moved to size. A promo needs a price
 * below the regular one; missing promo dates mean "from today, open-ended" ('9999-12-31', which sorts after every
 * real day and is blanked again on export). ISO-2 origin codes are upper-cased so originText() can translate them.
 */
export function rowsToProducts(headers, rows, columns, { lang = 'ka', digits = 2 } = {}) {
  const idx = {};
  headers.forEach((hd, i) => { const f = columns[hd]; if (f && !(f in idx)) idx[f] = i; });
  const get = (r, f) => (f in idx ? r[idx[f]] : null);
  const out = [];
  for (const r of rows) {
    const name = { ka: '', ru: '', en: '' };
    if ('name' in idx) name[lang] = toText(get(r, 'name'));
    if ('nameKa' in idx) name.ka = toText(get(r, 'nameKa')) || name.ka;
    if ('nameRu' in idx) name.ru = toText(get(r, 'nameRu')) || name.ru;
    if ('nameEn' in idx) name.en = toText(get(r, 'nameEn')) || name.en;
    if (!name.ka && !name.ru && !name.en) continue;
    let price = money(get(r, 'price'), digits);
    const old = money(get(r, 'oldPrice'), digits);
    let promo = money(get(r, 'promoPrice'), digits);
    // "Old price" above the price: the regular price is the old one and the current one is a promo price.
    if (old != null && price != null && old > price) { promo = price; price = old; }
    let unitText = toText(get(r, 'unit')), size = toText(get(r, 'size'));
    if (!size && packOf(unitText)) { size = unitText; unitText = ''; }
    let from = day(get(r, 'promoFrom')), to = day(get(r, 'promoTo'));
    if (promo != null && promo < (price ?? 0)) { from ||= today(); to ||= '9999-12-31'; } else { promo = null; from = ''; to = ''; }
    const qty = typeof get(r, 'quantity') === 'number' ? get(r, 'quantity') : parseLooseNumber(toText(get(r, 'quantity')));
    out.push({
      id: newId(), name, ean: toText(get(r, 'barcode')).replace(/\s/g, ''), code: toText(get(r, 'code')),
      price: price ?? 0, promoPrice: promo, promoFrom: from, promoTo: to,
      unit: unitOf(unitText), size, category: catPath(get(r, 'category')),
      origin: (() => { const o = toText(get(r, 'origin')); return /^[a-z]{2}$/i.test(o) ? o.toUpperCase() : o; })(),
      expires: day(get(r, 'expires')), qty: qty != null && qty >= 0 ? qty : 0,
    });
  }
  return out;
}

// Merge by EAN, else by any equal name; price changes are noted for "only changed tags". -> { added, updated }
// Mutates `data` in place (caller saves). Merge policy: identity by EAN when the row has one (the only stable key a
// shop has); name matching only for rows without EAN, so two products sharing a name but with different EANs stay
// distinct. Descriptive fields are overwritten only by non-empty values (a partial export updates prices without
// wiping categories), but price and promo always come from the file: the file is the price authority. A history entry
// is written only if price or promo actually changed. 'replace' notes every product: the whole shelf is new.
// Cost: find() per row is O(n x m); fine for shop sizes, a Map by EAN would be the fix past ~10^4 x 10^4.
export function mergeProducts(data, list, mode = 'merge') {
  if (mode === 'replace') {
    data.products = list;
    for (const p of list) notePriceChange(data, p.id);
    return { added: list.length, updated: 0 };
  }
  let added = 0, updated = 0;
  for (const p of list) {
    const hit = data.products.find((x) => (p.ean && x.ean === p.ean) || (!p.ean && LANGS.some((l) => p.name[l] && x.name[l] === p.name[l])));
    if (!hit) { data.products.push(p); notePriceChange(data, p.id); added++; continue; }
    const before = [hit.price, hit.promoPrice].join('|');
    for (const l of LANGS) if (p.name[l]) hit.name[l] = p.name[l];
    for (const k of ['code', 'size', 'category', 'origin', 'expires']) if (p[k]) hit[k] = p[k];
    hit.price = p.price;
    hit.promoPrice = p.promoPrice; hit.promoFrom = p.promoFrom; hit.promoTo = p.promoTo;
    if (p.unit !== 'pcs') hit.unit = p.unit;
    if (p.qty) hit.qty = p.qty;
    if ([hit.price, hit.promoPrice].join('|') !== before) notePriceChange(data, hit.id);
    updated++;
  }
  return { added, updated };
}

// --- dialog -------------------------------------------------------------------------------------------------------

/** Reads a file, asks for the column mapping and merges. -> Promise<{ added, updated } | null>
 * Dialog state lives in a local `st`, mutated by the selects; nothing touches `data` until the user confirms, so
 * Cancel needs no rollback. The count line is role=status so screen readers announce it after each mapping change.
 */
export async function importFile(file, data, D) {
  let table;
  try { table = await readTable(file); } catch (e) { toast(t('ap.fileErr', { name: file.name, msg: e.message }), 'error'); return null; }
  const { columns } = suggestMapping(table.headers, FIELDS, HEADER_SYNONYMS);
  const st = { columns: { ...columns }, lang: 'ka', mode: 'merge' };
  const opts = [{ v: '', l: t('pt.io.skip') }, ...FIELD_KEYS.map((k) => ({ v: k, l: t('pt.f.' + k) }))];
  const body = h('div', { class: 'ed-fields pt-map' });
  const count = h('div', { class: 'ed-hint', role: 'status' });
  const paintCount = () => {
    const n = rowsToProducts(table.headers, table.rows, st.columns, { lang: st.lang, digits: digitsOf(D) }).length;
    count.textContent = t('pt.io.rows', { n });
  };
  const rowsEl = table.headers.map((hd, i) => {
    const sample = table.rows.slice(0, 3).map((r) => toText(r[i])).filter(Boolean).join(' · ');
    const sel = h('select', { class: 'ed-input ed-select', 'aria-label': t('pt.io.fieldFor', { c: hd }) }, opts.map((o) => h('option', { value: o.v, selected: o.v === st.columns[hd] }, o.l)));
    sel.addEventListener('change', () => { st.columns[hd] = sel.value; paintCount(); });
    return h('tr', {}, h('td', {}, h('b', {}, hd), h('div', { class: 'ed-hint pt-sample' }, sample || '—')), h('td', {}, sel));
  });
  const langSel = h('select', { class: 'ed-input ed-select' }, LANGS.map((l) => h('option', { value: l }, LANG_NAMES[l])));
  langSel.addEventListener('change', () => { st.lang = langSel.value; paintCount(); });
  const modeSel = h('select', { class: 'ed-input ed-select' }, ['merge', 'replace'].map((m) => h('option', { value: m }, t('pt.io.' + m))));
  modeSel.addEventListener('change', () => { st.mode = modeSel.value; });
  body.append(
    h('p', { class: 'ed-hint' }, t('pt.io.lead', { name: file.name, n: table.rows.length })),
    h('div', { class: 'ap-table-wrap pt-map-wrap' }, h('table', { class: 'ap-table' }, h('thead', {}, h('tr', {}, h('th', {}, t('pt.io.column')), h('th', {}, t('pt.io.field')))), h('tbody', {}, rowsEl))),
    h('div', { class: 'ed-grid2' },
      h('label', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('pt.io.lang')), langSel),
      h('label', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('pt.io.mode')), modeSel)),
    h('p', { class: 'ed-hint' }, t('pt.io.oldHint')),
    count);
  paintCount();
  const v = await openDialog({ title: t('pt.io.title'), body, wide: true, buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('pt.io.go'), value: 'go', primary: true }] });
  if (v !== 'go') return null;
  const list = rowsToProducts(table.headers, table.rows, st.columns, { lang: st.lang, digits: digitsOf(D) });
  if (!list.length) { toast(t('pt.io.none'), 'warn'); return null; }
  const r = mergeProducts(data, list, st.mode);
  toast(t('pt.io.done', { a: r.added, u: r.updated }), 'ok');
  return r;
}

// --- export -------------------------------------------------------------------------------------------------------

// Headers are the English synonyms, so an exported file re-imports with an exact automatic mapping (round trip).
// The leading U+FEFF BOM makes Excel open the file as UTF-8 (otherwise Georgian/Cyrillic names become mojibake).
// guard:true prefixes cells starting with = + - @ so a product name cannot run as a formula in a spreadsheet.
export function exportCSV(data, D) {
  const digits = digitsOf(D);
  const m = (v) => (v == null ? '' : (v / 10 ** digits).toFixed(digits));
  const rows = [['name ka', 'name ru', 'name en', 'ean', 'code', 'price', 'promo price', 'promo from', 'promo to', 'unit', 'size', 'category', 'origin', 'expires', 'qty']];
  for (const p of data.products) rows.push([p.name.ka, p.name.ru, p.name.en, p.ean, p.code, m(p.price), m(p.promoPrice), p.promoFrom, p.promoTo === '9999-12-31' ? '' : p.promoTo, p.unit, p.size, p.category, p.origin, p.expires, p.qty || '']);
  download('﻿' + serializeCSV(rows, { guard: true }), `products-${today()}.csv`, 'text/csv');
}

export const promoDefaults = () => ({ from: today(), to: addDays(today(), 7) });
