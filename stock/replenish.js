// stock/replenish.js - replenishment planning. For every store × item: rate = sold ÷ window days, target =
// ceil(rate × (lead + cover + supplier holiday days)) + safety stock, need = target − stock − in transit − on order.
// Shortages are covered from warehouses first (the most urgent stores take first), the rest is rounded to the
// supplier's minimum lot and multiple and grouped into one order per supplier (lines per receiving store) with the
// next allowed order day, the delivery date and warnings (off-schedule day, supplier holiday, holiday ahead).
// Also: supplier resolution down a category tree, sell-through verdicts. Prices in minor units, days as strings.

import { addDays, periodDays, weekday } from './calendar.js';
import { safetyStock } from './safety.js';
import { cellAdvice, DEFAULT_SETTINGS } from './abc.js';

const q6 = (x) => Math.round(x * 1e6) / 1e6;

// Minimum lot first, then up to the next multiple. Zero or negative stays as is; no supplier -> unchanged.
export function roundOrder(qty, supplier) {
  if (!(qty > 0) || !supplier) return qty;
  let q = Math.max(qty, supplier.minQty ?? 0);
  if (supplier.multiple > 0) q = Math.ceil(q / supplier.multiple - 1e-9) * supplier.multiple;
  return q6(q);
}

const holidayOn = (supplier, day) => (supplier.holidays ?? []).find((h) => h.from <= day && day <= h.to) ?? null;

/**
 * Can the supplier take an order on `day`? supplier: { leadDays, leadDaysWarehouse?, orderDays: [1..7] (empty = any
 * day), holidays: [{ from, to, note? }] }. -> { ok, nextOrderDate, deliveryDate, deliveryDateWarehouse, warnings }
 * warnings: { code: 'holiday', from, to, note } | { code: 'off_schedule', orderDays }. The search for the next
 * allowed day stops after 400 days (a schedule that never allows an order gives null dates).
 */
// Linear search day by day with a 400-day cap: schedules are weekly and holidays are short, so the next allowed day
// is found in a few steps, while a schedule that never allows an order cannot loop forever.
export function orderCheck(supplier, day) {
  const days = supplier.orderDays ?? [];
  const ok = (d) => (!days.length || days.includes(weekday(d))) && !holidayOn(supplier, d);
  let next = day;
  for (let i = 0; i < 400 && !ok(next); i++) next = addDays(next, 1);
  const found = ok(next);
  const warnings = [];
  const h = holidayOn(supplier, day);
  if (h) warnings.push({ code: 'holiday', from: h.from, to: h.to, note: h.note ?? '' });
  else if (days.length && !days.includes(weekday(day))) warnings.push({ code: 'off_schedule', orderDays: days });
  const lead = supplier.leadDays ?? 0;
  const leadWh = supplier.leadDaysWarehouse ?? lead;
  return {
    ok: !warnings.length, nextOrderDate: found ? next : null, warnings,
    deliveryDate: found ? addDays(next, lead) : null, deliveryDateWarehouse: found ? addDays(next, leadWh) : null,
  };
}

// The first supplier holiday that starts after `day` and within `windowDays`: its stock must be bought now.
// -> { from, to, days } | null
export function holidayAhead(supplier, day, windowDays) {
  const limit = addDays(day, windowDays);
  const h = [...(supplier?.holidays ?? [])].sort((x, y) => (x.from < y.from ? -1 : 1)).find((x) => x.from > day && x.from <= limit);
  return h ? { from: h.from, to: h.to, days: periodDays(h.from, h.to) } : null;
}

// Sell-through thresholds: sold ≥ 100 % of received -> buy more; < 70 % -> buy less.
export const SELL_THROUGH = { more: 1, less: 0.7 };
export const sellThrough = (sold, received) => (received > 0 ? sold / received : null);
export function verdict(rate, thresholds = SELL_THROUGH) {
  if (rate == null) return null;
  return rate >= thresholds.more ? 'more' : rate < thresholds.less ? 'less' : 'keep';
}

/**
 * Supplier of an item: an assortment entry (best priority, then lowest price) wins, else the nearest supplier set on
 * the item or up its category tree. nodes: [{ id, parent, supplier? }], suppliers: [{ id, … }] (archived ones
 * should be left out), items: [{ item, supplier, priority?, price?, leadDays? }]. -> (id) => supplier | null, where
 * an assortment hit returns { ...supplier, leadDays (item override), price }.
 */
// Memoised walk up the category tree with a depth cap (cycle guard). Lower priority number wins, then a known price
// over an unknown one, then the lower price.
export function supplierResolver({ nodes = [], suppliers = [], items = [] }) {
  const byNode = new Map(nodes.map((n) => [n.id, n]));
  const sup = new Map(suppliers.map((s) => [s.id, s]));
  const best = new Map();
  const rank = (x) => [x.priority ?? 0, x.price == null ? 1 : 0, x.price ?? 0];
  for (const it of items) {
    if (!sup.has(it.supplier)) continue;
    const cur = best.get(it.item);
    if (!cur) { best.set(it.item, it); continue; }
    const a = rank(it), b = rank(cur);
    if (a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])))) best.set(it.item, it);
  }
  const memo = new Map();
  const resolve = (id, depth = 0) => {
    if (id == null || depth > 64) return null;
    if (memo.has(id)) return memo.get(id);
    let v = null;
    const it = best.get(id);
    if (it) {
      const s = sup.get(it.supplier);
      v = { ...s, leadDays: it.leadDays ?? s.leadDays, price: it.price ?? null };
    } else {
      const n = byNode.get(id);
      v = n ? (n.supplier != null && sup.get(n.supplier)) || resolve(n.parent, depth + 1) : null;
    }
    memo.set(id, v ?? null);
    return v ?? null;
  };
  return (id) => resolve(id);
}

/**
 * The replenishment plan.
 *   today          'YYYY-MM-DD' (order day)
 *   days           sales window of `sold` (default 28)
 *   rows           [{ store, storeName?, item, itemName?, code?, sold, received?, stock, inTransit?, onOrder?,
 *                    leadDays?, coverDays?, supplier?: id | object | null, price?, class?: { abc, xyz, cell, sdWeekly },
 *                    safety? }]  — `safety` given wins over the class; the supplier's lead time wins over the row's
 *   suppliers      { id: { name, leadDays, leadDaysWarehouse, orderDays, holidays, minQty, multiple, price } }
 *   warehouses     [{ id, name?, stock: { item: qty } }]
 *   service        service levels per cell (abc.js DEFAULT_SETTINGS.service)
 * -> { date, days, rows: [...rows with rate, daysLeft, target, safety, serviceLevel, holiday, need, fromWarehouse,
 *      shortage, toOrder, advice, sellThrough, verdict, warnings], orders: [{ supplierId, supplierName, canOrder,
 *      nextOrderDate, deliveryDate, warnings, stores: [{ store, storeName, lines: [{ item, qty, price, amount }] }],
 *      amount }] }
 */
// Order-up-to policy: target = demand over (lead + cover + supplier holiday) + safety stock, need = target minus
// everything already available or coming. Warehouses cover needs before suppliers because internal transfers are
// cheaper and faster. Note: the returned rows are sorted by urgency, not in input order.
// KNOWN DEFECT (questionable default): rows without an ABC/XYZ class get the advice of cell CZ, i.e. 'delist',
// although cellAdvice would call an unclassified item 'new'. Fix: pass `cls` (or null) to cellAdvice and let it
// decide, or default to { abc: r.abc, xyz: null }.
export function planReplenishment({ today, days = 28, rows = [], suppliers = {}, warehouses = [], service = DEFAULT_SETTINGS.service }) {
  const supOf = (r) => (r.supplier == null ? null : typeof r.supplier === 'object' ? r.supplier : suppliers[r.supplier] ? { id: r.supplier, ...suppliers[r.supplier] } : null);
  const free = warehouses.map((w) => ({ id: w.id, name: w.name ?? w.id, free: new Map(Object.entries(w.stock ?? {}).filter(([, q]) => q > 0)) }));
  const out = rows.map((r) => {
    const sup = supOf(r);
    const sold = r.sold ?? 0;
    const stock = Math.max(0, r.stock ?? 0);
    const rate = days > 0 ? sold / days : 0;
    const lead = sup?.leadDays ?? r.leadDays ?? 0;
    const cover = r.coverDays ?? 0;
    const cls = r.class ?? null;
    const ss = safetyStock(cls, lead, service);
    const safety = r.safety ?? ss.safety;
    const holiday = sup ? holidayAhead(sup, today, lead + cover) : null;
    const target = Math.ceil(Math.max(0, rate) * (lead + cover + (holiday?.days ?? 0)) - 1e-9) + safety;
    const inTransit = r.inTransit ?? 0, onOrder = r.onOrder ?? 0;
    const st = sellThrough(sold, r.received ?? 0);
    return {
      ...r, supplierId: sup?.id ?? null, supplierName: sup?.name ?? null, price: r.price ?? sup?.price ?? null,
      sold, stock, inTransit, onOrder, rate, daysLeft: rate > 0 ? stock / rate : null, leadDays: lead, coverDays: cover,
      target, safety, serviceLevel: ss.serviceLevel, holiday,
      need: Math.max(0, Math.ceil(target - stock - inTransit - onOrder - 1e-9)),
      advice: cellAdvice(cls ?? { abc: 'C', xyz: 'Z', cell: 'CZ' }), sellThrough: st, verdict: verdict(st),
      fromWarehouse: [], shortage: 0, toOrder: 0, warnings: [], _sup: sup,
    };
  });

  // The most urgent stores (fewest days of stock left, then the biggest need) take the warehouse stock first.
  // Greedy allocation of scarce warehouse stock: the store that will run out first is served first.
  out.sort((x, y) => (x.daysLeft ?? Infinity) - (y.daysLeft ?? Infinity) || y.need - x.need);
  for (const r of out) {
    let left = r.need;
    for (const w of free) {
      if (!left) break;
      const have = w.free.get(r.item) ?? 0;
      const take = Math.min(left, Math.floor(have + 1e-9));
      if (take > 0) {
        r.fromWarehouse.push({ warehouse: w.id, name: w.name, qty: take });
        w.free.set(r.item, q6(have - take));
        left -= take;
      }
    }
    r.shortage = left;
    r.toOrder = roundOrder(left, r._sup);
  }

  const groups = new Map();
  for (const r of out.filter((x) => x.toOrder > 0)) {
    let g = groups.get(r.supplierId);
    if (!g) {
      const check = r._sup ? orderCheck(r._sup, today) : null;
      g = {
        supplierId: r.supplierId, supplierName: r.supplierName, leadDays: r._sup?.leadDays ?? null,
        minQty: r._sup?.minQty ?? null, multiple: r._sup?.multiple ?? null,
        canOrder: check ? check.ok : true, nextOrderDate: check?.nextOrderDate ?? today, deliveryDate: check?.deliveryDate ?? null,
        warnings: check ? [...check.warnings] : [], stores: new Map(), amount: 0,
      };
      groups.set(r.supplierId, g);
    }
    if (!g.stores.has(r.store)) g.stores.set(r.store, { store: r.store, storeName: r.storeName ?? r.store, lines: [] });
    const amount = r.price == null ? null : Math.round(r.toOrder * r.price);
    g.stores.get(r.store).lines.push({ item: r.item, itemName: r.itemName ?? null, code: r.code ?? null, qty: r.toOrder, price: r.price, amount });
    g.amount += amount ?? 0;
    if (r.holiday && !g.warnings.some((w) => w.code === 'before_holiday')) g.warnings.push({ code: 'before_holiday', ...r.holiday });
    r.warnings = g.warnings;
  }
  for (const r of out) delete r._sup;
  const orders = [...groups.values()].map((g) => ({ ...g, stores: [...g.stores.values()] }))
    .sort((x, y) => (x.supplierId == null) - (y.supplierId == null) || String(x.supplierName ?? '').localeCompare(String(y.supplierName ?? '')));
  return { date: today, days, rows: out, orders };
}

// Days of stock left at a daily rate (null without demand).
export const coverDays = (stock, ratePerDay) => (ratePerDay > 0 ? Math.max(0, stock) / ratePerDay : null);
