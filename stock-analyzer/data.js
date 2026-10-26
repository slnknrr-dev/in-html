// stock-analyzer/data.js - the data side of Stock Analyzer, pure (no DOM, importable in Node): tables read from
// CSV / XLSX bytes, column mapping with ru / en / ka header synonyms (csv/mapping.js), sales lines aggregated into
// weekly series per item × store (money in integer minor units), the ABC / XYZ view of a filter (stock/abc.js), the
// replenishment plan (stock/replenish.js) with suppliers resolved by category, and the expiry lists (stock/batches.js).
//
// Dataset D: { v, source: 'demo' | 'file', name, currency, digits, today, from, weeks, stores: [name],
//   items: [{ id, name, cat }], q: { id: [[qty per week] per store] }, r: { id: [[revenue minor]] },
//   c: { id: [[cost minor]] } | null, first: { id: [day | null per store] }, hasCost, lines, skipped }
// Weeks are 7-day buckets ending on `today` (the last sales day), oldest first.
//
// Why weekly buckets: daily sales of a shop are mostly noise (weekday effects, single big baskets); XYZ variability
// on daily data would put nearly everything in Z. Weeks smooth that while keeping enough points for a coefficient of
// variation. Storage shape q[id][store][week] (dense arrays) makes per-store filtering a cheap array sum and keeps
// the localStorage JSON compact compared with one object per sale line.
// The heavy logic lives in stock/ (abc.js, replenish.js, batches.js): this module adapts tables to those inputs.

import { abcMatrix, classify, historyWeeks, validateSettings, variation } from '../stock/abc.js';
import { addDays, daysBetween, isDay } from '../stock/calendar.js';
import { planReplenishment, supplierResolver } from '../stock/replenish.js';
import { expirySummary, markdownFor, markdownPrice, daysLeft, writeOffExpired, fefoOrder } from '../stock/batches.js';
import { HEADER_SYNONYMS as HS, parseLooseDate, parseLooseNumber, suggestMapping } from '../csv/mapping.js';
import { decodeBytes } from '../csv/encoding.js';
import { parseCSV, sniffCSV } from '../csv/csv.js';
import { readXLSX } from '../xlsx/read.js';
import { cellValue, CellError, serialParts } from '../xlsx/cells.js';
import { minorUnits, toMinor } from '../payments/money.js';

// --- fields and header synonyms ----------------------------------------------------------------------------------

const without = (list, ...drop) => list.filter((x) => !drop.includes(x));
// "остаток" / "stock" are quantities but mean stock on hand, not units sold: removed from the sales qty synonyms so
// a stock column is never mistaken for sales.
const QTY = without(HS.quantity, 'остаток', 'stock', 'ნაშთი');
export const SYNONYMS = {
  date: [...HS.date, 'week', 'неделя', 'период', 'კვირა'],
  sku: [...HS.code, ...HS.barcode, 'id', 'plu'],
  name: HS.name,
  category: HS.category,
  store: HS.place,
  qty: [...QTY, 'продано', 'продажи шт', 'sold', 'units', 'units sold', 'გაყიდული'],
  revenue: [...HS.amount, 'выручка', 'продажи', 'оборот', 'сумма продаж', 'revenue', 'sales', 'net sales', 'turnover', 'შემოსავალი', 'ნავაჭრი', 'გაყიდვები'],
  price: [...without(HS.price, 'cost', 'стоимость', 'ღირებულება'), 'цена продажи', 'sale price', 'retail price'],
  cost: ['себестоимость', 'себестоимость продаж', 'cost', 'cogs', 'cost amount', 'cost of sales', 'თვითღირებულება'],
  unitCost: ['закупочная цена', 'цена закупки', 'unit cost', 'purchase price', 'buy price', 'შესყიდვის ფასი'],
  profit: ['прибыль', 'валовая прибыль', 'маржа', 'profit', 'gross profit', 'margin', 'მოგება', 'მარჟა'],
  stock: [...HS.quantity, 'на складе', 'остаток', 'on hand', 'in stock', 'stock level', 'ნაშთი'],
  inTransit: ['в пути', 'transit', 'in transit', 'გზაში'],
  onOrder: ['заказано', 'в заказе', 'on order', 'ordered', 'შეკვეთილი'],
  batch: ['партия', 'лот', 'серия', 'batch', 'lot', 'batch number', 'პარტია', 'სერია'],
  expires: ['срок годности', 'годен до', 'срок', 'expiry', 'expires', 'expiry date', 'best before', 'use by', 'ვადა', 'ვარგისია'],
};
// Batch quantities: a "stock" / "остаток" header is the quantity of the batch.
// For batch files the meaning flips: there "stock" / "остаток" IS the batch quantity.
const BATCH_SYN = { ...SYNONYMS, qty: [...HS.quantity, 'on hand'] };

export const SALES_FIELDS = ['date', 'sku', 'name', 'category', 'store', 'qty', 'revenue', 'price', 'cost', 'unitCost', 'profit'];
export const SALES_REQUIRED = ['date', 'qty'];
export const STOCK_FIELDS = ['sku', 'store', 'stock', 'inTransit', 'onOrder'];
export const BATCH_FIELDS = ['sku', 'store', 'batch', 'expires', 'qty'];

/** Suggested mapping field -> column index (-1 when none) for table headers. */
export function suggestColumns(headers, fields, kind = 'sales') {
  // Duplicate header texts get " (n)" suffixes so the mapping (keyed by header text) can tell them apart.
  const uniq = headers.map((h, i) => (headers.indexOf(h) === i ? String(h) : `${h} (${i + 1})`));
  const { columns } = suggestMapping(uniq, fields, kind === 'batch' ? BATCH_SYN : SYNONYMS);
  const map = Object.fromEntries(fields.map((f) => [f, -1]));
  // Each field takes the first column suggested for it; later duplicates stay unmapped.
  uniq.forEach((h, i) => { const f = columns[h]; if (f && map[f] === -1) map[f] = i; });
  return map;
}

// --- reading tables ------------------------------------------------------------------------------------------------

const cellText = (c) => { const v = cellValue(c); return v == null ? '' : v instanceof CellError ? '' : v; };

/** CSV / TSV text -> { headers, rows } (the first record is the header). */
export function tableFromText(text) {
  const sn = sniffCSV(text);
  // Blank records dropped; rows padded to the widest of the first 200 rows so short rows do not shift columns.
  const rows = parseCSV(text, { delimiter: sn.delimiter, quote: sn.quote }).filter((r) => r.some((x) => String(x).trim() !== ''));
  if (!rows.length) return { headers: [], rows: [] };
  const width = Math.max(...rows.slice(0, 200).map((r) => r.length));
  const pad = (r) => Array.from({ length: width }, (_, i) => r[i] ?? '');
  return { headers: pad(rows[0]).map((h, i) => String(h).trim() || `#${i + 1}`), rows: rows.slice(1).map(pad) };
}

/** File bytes -> { headers, rows, kind } from an .xlsx workbook (first sheet with data) or delimited text. */
export async function readTable(bytes, name = '') {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // ZIP magic = XLSX. Legacy binary formats are refused with a clear "unsupported" instead of decoding garbage.
  if (b[0] === 0x50 && b[1] === 0x4b) {
    const wb = await readXLSX(b);
    const sheet = wb.sheets.find((s) => s.rows.some((r) => r && r.some((c) => cellText(c) !== ''))) || wb.sheets[0];
    const rows = (sheet?.rows || []).filter((r) => r && r.some((c) => cellText(c) !== '')).map((r) => Array.from(r, cellText));
    if (!rows.length) return { headers: [], rows: [], kind: 'xlsx' };
    const width = Math.max(...rows.slice(0, 200).map((r) => r.length));
    const pad = (r) => Array.from({ length: width }, (_, i) => r[i] ?? '');
    return { headers: pad(rows[0]).map((h, i) => String(h).trim() || `#${i + 1}`), rows: rows.slice(1).map(pad), kind: 'xlsx' };
  }
  if (/\.(xls|xlsb|ods|numbers)$/i.test(name)) throw new Error('unsupported');
  return { ...tableFromText(decodeBytes(b).text), kind: 'csv' };
}

// --- values --------------------------------------------------------------------------------------------------------

const pad2 = (n) => String(n).padStart(2, '0');
const serialDay = (n) => { const p = serialParts(Math.floor(n)); return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`; };
const str = (v) => (v == null ? '' : String(v).trim());
export const num = (v) => (typeof v === 'number' ? (Number.isFinite(v) ? v : null) : typeof v === 'string' ? parseLooseNumber(v) : null);

// Day order of a date column: a first part above 12 means d/m/y, a second part above 12 means m/d/y.
// When every sampled date is ambiguous (all parts <= 12) d/m/y is assumed, the common order in the target markets;
// a US file with only early-month dates would be misread, which is why up to 500 rows are sampled.
function dateOrder(values) {
  for (const v of values) {
    const m = /^(\d{1,2})[/-](\d{1,2})[/-]\d{2,4}/.exec(str(v));
    if (!m) continue;
    if (+m[1] > 12) return 'dmy';
    if (+m[2] > 12) return 'mdy';
  }
  return 'dmy';
}

/** A cell value -> 'YYYY-MM-DD' | null (ISO text, d.m.y / m/d/y text, Excel serial numbers). */
export function dayOf(v, order = 'dmy') {
  if (v == null || v === '') return null;
  // Numbers between 20000 and 80000 are Excel serial days (1954..2119); other numbers are not dates.
  if (typeof v === 'number') return v > 20000 && v < 80000 ? serialDay(v) : null;
  const s = str(v);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso && isDay(iso[0])) return iso[0];
  const ser = parseLooseDate(s, { order });
  return ser == null ? null : serialDay(ser);
}

// Quantities rounded to 3 decimals after every addition: weighed goods (0.345 kg) would otherwise accumulate binary
// float noise (0.1 + 0.2) visible in tables.
const r3 = (x) => Math.round(x * 1000) / 1000;

// --- sales -> dataset ------------------------------------------------------------------------------------------------

/**
 * A sales table and its mapping -> dataset (or { error, skipped }). Lines need a date, an item (SKU or name) and a
 * quantity; revenue comes from the revenue column or qty × price, cost from the cost column, qty × unit cost or
 * revenue − profit. Amounts are converted to minor units of `currency`.
 */
export function buildSales(table, map, { currency = 'GEL', name = '', source = 'file', maxWeeks = 104 } = {}) {
  const col = (r, f) => (map[f] >= 0 ? r[map[f]] : null);
  const order = dateOrder(table.rows.slice(0, 500).map((r) => col(r, 'date')));
  const lines = [];
  let skipped = 0;
  for (const r of table.rows) {
    const day = dayOf(col(r, 'date'), order);
    const sku = str(col(r, 'sku')), nm = str(col(r, 'name'));
    const id = sku || nm;
    const qty = num(col(r, 'qty'));
    if (!day || !id || qty == null) { skipped++; continue; }
    let rev = num(col(r, 'revenue'));
    // Fallbacks for revenue and cost, so files with only price or only unit cost / profit still give a full analysis.
    if (rev == null) { const p = num(col(r, 'price')); rev = p == null ? 0 : p * qty; }
    let cost = num(col(r, 'cost'));
    if (cost == null) { const u = num(col(r, 'unitCost')); if (u != null) cost = u * qty; }
    if (cost == null) { const p = num(col(r, 'profit')); if (p != null) cost = rev - p; }
    lines.push({ day, id, name: nm || sku, cat: str(col(r, 'category')), store: str(col(r, 'store')), qty, rev: toMinor(rev, currency), cost: cost == null ? null : toMinor(cost, currency) });
  }
  if (!lines.length) return { error: 'empty', skipped };
  return aggregate(lines, { currency, name, source, skipped, maxWeeks });
}

/** Sales lines { day, id, name, cat, store, qty, rev, cost } -> dataset. */
export function aggregate(lines, { currency = 'GEL', name = '', source = 'file', skipped = 0, maxWeeks = 104 } = {}) {
  let today = lines[0].day, from = lines[0].day;
  for (const l of lines) { if (l.day > today) today = l.day; if (l.day < from) from = l.day; }
  // At least 4 weeks (XYZ needs points), at most maxWeeks (104 = two years): older lines are skipped below.
  const weeks = Math.max(4, Math.min(maxWeeks, Math.ceil((daysBetween(from, today) + 1) / 7)));
  const stores = [...new Set(lines.map((l) => l.store))].sort((a, b) => a.localeCompare(b));
  const S = stores.length;
  const hasCost = lines.some((l) => l.cost != null);
  const items = new Map();
  // `from` is aligned to whole weeks ending on `today`, not to the first sale.
  const D = { v: 1, source, name, currency, digits: minorUnits(currency), today, from: addDays(today, -7 * weeks + 1), weeks, stores, items: [], q: {}, r: {}, c: hasCost ? {} : null, first: {}, hasCost, lines: lines.length, skipped };
  const arr = () => Array.from({ length: S }, () => new Array(weeks).fill(0));
  for (const l of lines) {
    let it = items.get(l.id);
    if (!it) {
      it = { id: l.id, name: l.name || l.id, cat: l.cat };
      items.set(l.id, it);
      D.q[l.id] = arr(); D.r[l.id] = arr(); if (hasCost) D.c[l.id] = arr();
      D.first[l.id] = new Array(S).fill(null);
    }
    if (!it.cat && l.cat) it.cat = l.cat;
    const s = stores.indexOf(l.store);
    const f = D.first[l.id];
    // first[id][store] = first sale day: "new" items (short history) are kept out of XYZ until minWeeks have passed.
    if (!f[s] || l.day < f[s]) f[s] = l.day;
    // Week index counted back from `today`, stored oldest first (k = weeks - 1 - w).
    const w = Math.floor(daysBetween(l.day, today) / 7);
    if (w < 0 || w >= weeks) continue;
    const k = weeks - 1 - w;
    D.q[l.id][s][k] = r3(D.q[l.id][s][k] + l.qty);
    D.r[l.id][s][k] += l.rev;
    if (hasCost) D.c[l.id][s][k] += l.cost ?? 0;
  }
  D.items = [...items.values()];
  return D;
}

// Amounts of a dataset re-expressed in another currency's minor units (only the exponent changes, no conversion).
// Used when the user relabels the currency (e.g. GEL -> JPY with 0 decimals): values stay the same amounts.
export function withCurrency(D, currency) {
  const d = minorUnits(currency);
  if (d === D.digits) return { ...D, currency };
  const k = 10 ** (d - D.digits);
  const scale = (m) => m && Object.fromEntries(Object.entries(m).map(([id, a]) => [id, a.map((row) => row.map((x) => Math.round(x * k)))]));
  return { ...D, currency, digits: d, r: scale(D.r), c: scale(D.c) };
}

export const categories = (D) => [...new Set(D.items.map((i) => i.cat))].sort((a, b) => a.localeCompare(b));
const sum = (a) => a.reduce((t, x) => t + x, 0);
const addInto = (acc, a) => { for (let i = 0; i < a.length; i++) acc[i] += a[i]; return acc; };

// Unit cost and unit price (minor units, network-wide averages) of an item.
// Network-wide average price and cost per unit (revenue / qty), used for order values and markdown losses.
export function unitPrices(D, id) {
  const q = sum(D.q[id].map(sum));
  if (!(q > 0)) return { price: null, cost: null };
  return { price: Math.round(sum(D.r[id].map(sum)) / q), cost: D.hasCost ? Math.round(sum(D.c[id].map(sum)) / q) : null };
}

// --- ABC / XYZ -----------------------------------------------------------------------------------------------------

export const ANALYSIS_DEFAULTS = { basis: 'revenue', aCut: 0.8, bCut: 0.95, xMax: 0.25, yMax: 0.5, minWeeks: 8 };

/**
 * ABC / XYZ of a filter { store: '*' | name, cat: '*' | name }.
 * -> { rows: [{ ...class, name, cat, revenue, qty, profit, weekly }], matrix, total, settings, errors, counts }
 */
export function analyze(D, opts = {}, filter = {}) {
  const { settings, errors } = validateSettings({ ...ANALYSIS_DEFAULTS, ...opts, weeks: Math.max(4, Math.min(104, D.weeks)) });
  // Profit basis without cost data is impossible; it silently falls back to revenue.
  if (!D.hasCost && settings.basis === 'profit') settings.basis = 'revenue';
  // Filter by store: index list of the chosen store, or every store.
  const sIdx = filter.store && filter.store !== '*' && D.stores.includes(filter.store) ? [D.stores.indexOf(filter.store)] : D.stores.map((_, i) => i);
  const items = [];
  const info = new Map();
  for (const it of D.items) {
    if (filter.cat && filter.cat !== '*' && it.cat !== filter.cat) continue;
    // Items never sold in the filtered stores are excluded entirely (not shown as zero rows).
    const firsts = sIdx.map((s) => D.first[it.id][s]).filter(Boolean);
    if (!firsts.length) continue;
    const weekly = new Array(D.weeks).fill(0), rw = new Array(D.weeks).fill(0);
    let cost = 0;
    for (const s of sIdx) { addInto(weekly, D.q[it.id][s]); addInto(rw, D.r[it.id][s]); if (D.hasCost) cost += sum(D.c[it.id][s]); }
    const qty = r3(sum(weekly)), revenue = sum(rw);
    const first = firsts.sort()[0];
    items.push({ id: it.id, revenue, qty, cost: D.hasCost && qty > 0 ? cost / qty : null, weekly: weekly.map(r3), historyWeeks: historyWeeks(first, D.today, D.weeks) });
    info.set(it.id, { name: it.name, cat: it.cat, revenue, qty, costTotal: D.hasCost ? cost : null, weekly: weekly.map(r3) });
  }
  const classes = classify(items, settings);
  const rows = classes.map((c) => {
    const x = info.get(c.id);
    return { ...c, name: x.name, cat: x.cat, revenue: x.revenue, qty: x.qty, profit: x.costTotal == null ? null : x.revenue - x.costTotal, weekly: x.weekly };
  });
  const matrix = abcMatrix(rows);
  const total = rows.reduce((t, r) => t + r.value, 0);
  const counts = { A: 0, B: 0, C: 0 };
  for (const r of rows) counts[r.abc]++;
  return { rows, matrix, total, settings, errors, counts };
}

// --- suppliers and the replenishment plan --------------------------------------------------------------------------

export const PLAN_DEFAULTS = {
  window: 4, cover: 3,
  // Service level per ABC / XYZ cell: high for A and stable (X) items, lower for C / Z where safety stock is expensive
  // relative to its benefit.
  service: { AX: 0.98, AY: 0.97, AZ: 0.95, BX: 0.95, BY: 0.93, BZ: 0.9, CX: 0.9, CY: 0.85, CZ: 0.8 },
};

/** Parses '2026-12-30 – 2027-01-08; 2027-03-08' into holidays [{ from, to }]. */
export function parseHolidays(text) {
  const out = [];
  // Single days or ranges with any common separator (.., en/em dash, hyphen, "to", Russian "по" / "до").
  const re = /(\d{4}-\d{2}-\d{2})(?:\s*(?:\.\.|–|—|-|to|по|до)\s*(\d{4}-\d{2}-\d{2}))?/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const from = m[1], to = m[2] || m[1];
    if (isDay(from) && isDay(to)) out.push(from <= to ? { from, to } : { from: to, to: from });
  }
  return out;
}
export const holidaysText = (list) => (list || []).map((h) => (h.from === h.to ? h.from : `${h.from} – ${h.to}`)).join('; ');

/** One supplier normalised: { id, name, leadDays, orderDays, minQty, multiple, holidays }. */
export function normSupplier(s, i = 0) {
  // Clamp + default helper: every supplier field is bounded, so a hand-edited state cannot produce negative lead times.
  const n = (v, d, lo = 0, hi = 1e6) => { const x = Number(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d; };
  return {
    id: String(s?.id || 'sup' + (i + 1)), name: str(s?.name) || `Supplier ${i + 1}`,
    leadDays: Math.round(n(s?.leadDays, 2, 0, 365)),
    orderDays: Array.isArray(s?.orderDays) ? [...new Set(s.orderDays.map(Number).filter((d) => d >= 1 && d <= 7))].sort() : [],
    minQty: n(s?.minQty, 0), multiple: n(s?.multiple, 1),
    holidays: Array.isArray(s?.holidays) ? s.holidays.filter((h) => h && isDay(h.from) && isDay(h.to)).map((h) => ({ from: h.from, to: h.to, note: str(h.note) })) : [],
  };
}

// Stock key of a store × item.
// \u0001 as separator: cannot occur in store names or item ids, so the composite key is unambiguous.
export const stockKey = (store, id) => `${store}\u0001${id}`;

/** Stock rows from an imported table: { key: { stock, inTransit, onOrder } }; a missing store means every store. */
export function stockFromTable(D, table, map) {
  const out = {};
  let matched = 0, skipped = 0;
  const ids = new Map(D.items.map((i) => [i.id, i.id]));
  // Items can be matched by id or by name (stock files often lack the SKU column).
  for (const it of D.items) if (!ids.has(it.name)) ids.set(it.name, it.id);
  for (const r of table.rows) {
    const id = ids.get(str(map.sku >= 0 ? r[map.sku] : ''));
    const q = num(map.stock >= 0 ? r[map.stock] : null);
    if (!id || q == null) { skipped++; continue; }
    const st = str(map.store >= 0 ? r[map.store] : '');
    // A row without a (known) store applies to every store; for network-level stock files this repeats the same
    // quantity per store, so the user should prefer per-store files when there are several stores.
    const stores = st && D.stores.includes(st) ? [st] : D.stores;
    for (const s of stores) {
      out[stockKey(s, id)] = { stock: Math.max(0, q), inTransit: Math.max(0, num(map.inTransit >= 0 ? r[map.inTransit] : null) ?? 0), onOrder: Math.max(0, num(map.onOrder >= 0 ? r[map.onOrder] : null) ?? 0) };
    }
    matched++;
  }
  return { stock: out, matched, skipped };
}

/**
 * The replenishment plan of a dataset. A: network ABC / XYZ rows (analyze without filters); P: { today, window
 * (weeks of sales), cover (days), service, suppliers: [...], catSupplier: { category: supplierId }, stock: { key: {
 * stock, inTransit, onOrder } } }. -> planReplenishment result (rows, orders) plus { days, unassigned }.
 */
export function buildPlan(D, A, P) {
  const window = Math.max(1, Math.min(D.weeks, Math.round(P.window || 4)));
  const days = window * 7;
  const suppliers = (P.suppliers || []).map(normSupplier);
  const cats = categories(D);
  // Supplier resolution through a two-level tree: category nodes carry the supplier, items inherit from their category
  // (stock/replenish.js supplierResolver supports deeper trees and per-item overrides).
  const nodes = [
    ...cats.map((c) => ({ id: 'c:' + c, parent: null, supplier: P.catSupplier?.[c] ?? null })),
    ...D.items.map((it) => ({ id: 'i:' + it.id, parent: 'c:' + it.cat })),
  ];
  const resolve = supplierResolver({ nodes, suppliers });
  const cls = new Map(A.rows.map((r) => [r.id, r]));
  const minWeeks = A.settings?.minWeeks ?? 8;
  const rows = [];
  D.stores.forEach((store, s) => {
    for (const it of D.items) {
      const q = D.q[it.id][s];
      // Demand rate = units sold over the last `window` weeks; rows with no sales and no stock are skipped.
      const sold = r3(sum(q.slice(q.length - window)));
      const st = P.stock?.[stockKey(store, it.id)] ?? null;
      if (!(sold > 0) && !st) continue;
      const hw = historyWeeks(D.first[it.id][s], D.today, D.weeks);
      const c = cls.get(it.id);
      // Weekly standard deviation for safety stock only when the history is long enough to trust it; 0 otherwise.
      const sd = hw >= minWeeks ? variation(q.slice(q.length - Math.max(1, hw))).sd : 0;
      const { cost } = unitPrices(D, it.id);
      rows.push({
        store, storeName: store, item: it.id, itemName: it.name, code: it.id, cat: it.cat, sold,
        stock: st?.stock ?? 0, inTransit: st?.inTransit ?? 0, onOrder: st?.onOrder ?? 0, coverDays: Math.max(0, Number(P.cover) || 0),
        supplier: resolve('i:' + it.id), price: cost,
        class: c && c.cell ? { abc: c.abc, xyz: c.xyz, cell: c.cell, sdWeekly: Math.round(sd * 100) / 100 } : c ? { abc: c.abc, xyz: null, cell: null, sdWeekly: 0 } : null,
      });
    }
  });
  const plan = planReplenishment({ today: P.today, days, rows, service: { ...PLAN_DEFAULTS.service, ...(P.service || {}) } });
  const unassigned = plan.rows.filter((r) => !r.supplierId && r.toOrder > 0).length;
  return { ...plan, days, window, unassigned };
}

// --- expiry (FEFO) -------------------------------------------------------------------------------------------------

// Default markdown ladder: 20% off three days before expiry, 50% on the last day.
export const MARKDOWN_RULES = [{ days: 3, pct: 20 }, { days: 1, pct: 50 }];

/** Batches from an imported table: [{ store, item, batch, expires, qty }]. */
export function batchesFromTable(D, table, map) {
  const ids = new Map(D.items.map((i) => [i.id, i.id]));
  for (const it of D.items) if (!ids.has(it.name)) ids.set(it.name, it.id);
  const order = dateOrder(table.rows.slice(0, 500).map((r) => (map.expires >= 0 ? r[map.expires] : null)));
  const out = [];
  let skipped = 0;
  for (const r of table.rows) {
    const id = ids.get(str(map.sku >= 0 ? r[map.sku] : ''));
    const qty = num(map.qty >= 0 ? r[map.qty] : null);
    const expires = dayOf(map.expires >= 0 ? r[map.expires] : null, order);
    if (!id || !(qty > 0)) { skipped++; continue; }
    const st = str(map.store >= 0 ? r[map.store] : '');
    // An unknown store falls back to the first store; batches without an expiry date are kept (expires = null).
    out.push({ store: D.stores.includes(st) ? st : D.stores[0], item: id, batch: str(map.batch >= 0 ? r[map.batch] : '') || '—', expires, qty });
  }
  return { batches: out, skipped };
}

/**
 * Markdown and write-off lists: batches [{ store, item, batch, expires, qty }], { today, warnDays, rules }.
 * -> { markdowns: [{ store, item, name, batch, expires, daysLeft, qty, pct, price, newPrice, loss }],
 *      writeOffs: [{ store, item, name, batch, expires, overdue, qty, value }], summary, totals }
 */
export function buildExpiry(D, batches, { today, warnDays = 3, rules = MARKDOWN_RULES }) {
  const names = new Map(D.items.map((i) => [i.id, i]));
  const groups = new Map();
  for (const b of batches) {
    if (!names.has(b.item)) continue;
    const k = stockKey(b.store, b.item);
    if (!groups.has(k)) groups.set(k, { store: b.store, item: b.item, list: [] });
    groups.get(k).list.push({ batch: b.batch, expires: b.expires || null, qty: b.qty });
  }
  const markdowns = [], writeOffs = [];
  const all = [];
  for (const g of groups.values()) {
    const it = names.get(g.item);
    const { price, cost } = unitPrices(D, g.item);
    all.push(...g.list);
    // FEFO: expired batches are written off first; the markdown then applies to the earliest remaining expiry.
    const w = writeOffExpired(g.list, today);
    for (const b of w.written) {
      // Write-off value at cost when known, else at the average selling price.
      writeOffs.push({ store: g.store, item: g.item, name: it.name, cat: it.cat, batch: b.batch, expires: b.expires, overdue: -daysLeft(b.expires, today), qty: b.qty, value: Math.round(b.qty * (cost ?? price ?? 0)) });
    }
    const md = markdownFor(w.batches, rules, today);
    if (md && md.pct > 0) {
      const qty = w.batches.filter((b) => b.expires === md.expires).reduce((t, b) => t + b.qty, 0);
      const newPrice = price == null ? null : markdownPrice(price, md.pct);
      markdowns.push({ store: g.store, item: g.item, name: it.name, cat: it.cat, batch: md.batch, expires: md.expires, daysLeft: md.daysLeft, qty, pct: md.pct, price, newPrice, loss: price == null ? null : (price - newPrice) * qty });
    }
  }
  markdowns.sort((a, b) => a.daysLeft - b.daysLeft || b.pct - a.pct || a.name.localeCompare(b.name));
  writeOffs.sort((a, b) => b.overdue - a.overdue || b.value - a.value);
  const summary = expirySummary(all, today, warnDays);
  return {
    markdowns, writeOffs, summary,
    totals: { loss: markdowns.reduce((t, m) => t + (m.loss ?? 0), 0), writeOff: writeOffs.reduce((t, w) => t + w.value, 0), batches: all.length },
  };
}

export { addDays, daysBetween, fefoOrder };
