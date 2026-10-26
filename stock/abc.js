// stock/abc.js - ABC / XYZ analysis of an assortment. ABC: Pareto classes by the cumulative share of revenue, gross
// profit or quantity (the class is decided by the share *before* the item, so the first item is always A). XYZ:
// demand stability as the coefficient of variation of weekly sales (σ ÷ mean), undefined for items with fewer than
// `minWeeks` weeks of history. The 3×3 matrix with counts and values, service levels per cell and cell advice.
// Money in integer minor units; sales lines carry 'YYYY-MM-DD' days and the caller passes `today`.

import { daysBetween, weeksBack } from './calendar.js';

export const BASES = ['revenue', 'profit', 'qty'];
export const CELLS = ['AX', 'AY', 'AZ', 'BX', 'BY', 'BZ', 'CX', 'CY', 'CZ'];
export const DEFAULT_SETTINGS = {
  basis: 'revenue', aCut: 0.8, bCut: 0.95, weeks: 26, xMax: 0.25, yMax: 0.5, minWeeks: 8,
  service: { AX: 0.98, AY: 0.97, AZ: 0.95, BX: 0.95, BY: 0.93, BZ: 0.9, CX: 0.9, CY: 0.85, CZ: 0.8 },
};

const LIMITS = { aCut: [0.5, 0.95], bCut: [0.6, 0.995], weeks: [4, 104], xMax: [0.05, 2], yMax: [0.1, 5], minWeeks: [1, 52] };

/**
 * Settings merged over the defaults and checked: { settings, errors: [{ field, message }] }.
 * Invalid fields keep their default value in `settings`, so a caller may still compute with it.
 */
export function validateSettings(input = {}) {
  const errors = [];
  const s = { ...DEFAULT_SETTINGS, service: { ...DEFAULT_SETTINGS.service } };
  if (input.basis !== undefined) {
    if (BASES.includes(input.basis)) s.basis = input.basis;
    else errors.push({ field: 'basis', message: `basis: ${BASES.join(', ')}` });
  }
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    if (input[k] === undefined) continue;
    const v = Number(input[k]);
    if (!(Number.isFinite(v) && v >= lo && v <= hi)) errors.push({ field: k, message: `${k}: ${lo}..${hi}` });
    else if ((k === 'weeks' || k === 'minWeeks') && !Number.isInteger(v)) errors.push({ field: k, message: `${k}: whole weeks` });
    else s[k] = v;
  }
  if (s.bCut <= s.aCut) errors.push({ field: 'bCut', message: 'bCut must be greater than aCut' });
  if (s.yMax <= s.xMax) errors.push({ field: 'yMax', message: 'yMax must be greater than xMax' });
  for (const [k, v] of Object.entries(input.service ?? {})) {
    const n = Number(v);
    if (!CELLS.includes(k)) errors.push({ field: 'service', message: `service: ${CELLS.join(', ')}` });
    else if (!(n >= 0.5 && n <= 0.999)) errors.push({ field: 'service', message: `service.${k}: 0.5..0.999` });
    else s.service[k] = n;
  }
  return { settings: s, errors };
}

// Value of an item on a basis. Profit = revenue − qty × unit cost (rounded to minor units); unknown cost counts as 0.
export function basisValue(item, basis = 'revenue') {
  if (basis === 'qty') return item.qty ?? 0;
  const revenue = item.revenue ?? 0;
  if (basis === 'profit') return revenue - Math.round((item.qty ?? 0) * (item.cost ?? 0));
  return revenue;
}

/**
 * ABC classes: items [{ id, revenue, qty, cost? }] -> [{ id, value, share, cumShare, abc, rank }] sorted by value
 * (ties keep the input order). Negative values count as 0 and zero-value items are always C.
 */
// The class is decided by the cumulative share BEFORE the item: with a single dominant item holding 90 % of revenue,
// using the share after it would make it B or C, which contradicts the purpose of class A.
export function abcClasses(items, { basis = 'revenue', aCut = DEFAULT_SETTINGS.aCut, bCut = DEFAULT_SETTINGS.bCut } = {}) {
  const ranked = items.map((it) => ({ id: it.id, value: Math.max(0, basisValue(it, basis)) })).sort((p, q) => q.value - p.value);
  const total = ranked.reduce((t, r) => t + r.value, 0);
  let cum = 0;
  return ranked.map((r, i) => {
    const before = total > 0 ? cum / total : 1;
    cum += r.value;
    const abc = r.value <= 0 ? 'C' : before < aCut ? 'A' : before < bCut ? 'B' : 'C';
    return { id: r.id, value: r.value, share: total > 0 ? r.value / total : 0, cumShare: total > 0 ? cum / total : 0, abc, rank: i + 1 };
  });
}

// Mean, population standard deviation and coefficient of variation of a series (cv null when the mean is 0).
export function variation(series) {
  const n = series.length;
  if (!n) return { mean: 0, sd: 0, cv: null };
  const mean = series.reduce((t, v) => t + v, 0) / n;
  const sd = Math.sqrt(series.reduce((t, v) => t + (v - mean) ** 2, 0) / n);
  return { mean, sd, cv: mean > 0 ? sd / mean : null };
}

/**
 * XYZ class of a weekly series (oldest first). Only the last `weeks` weeks count (the item's history: a new item
 * has zero weeks before its first sale that must not look like unstable demand). Fewer than minWeeks -> xyz null.
 */
// Only the item's own history counts: zero weeks before its first sale would inflate the variation of new items and
// misclassify them as Z. The 1e-12 tolerance keeps a cv exactly on a boundary in the lower class despite float noise.
export function xyzClass(weekly, { xMax = DEFAULT_SETTINGS.xMax, yMax = DEFAULT_SETTINGS.yMax, minWeeks = DEFAULT_SETTINGS.minWeeks, weeks = weekly.length } = {}) {
  const w = Math.min(weekly.length, Math.max(0, weeks));
  const series = weekly.slice(weekly.length - Math.max(1, w));
  const { mean, sd, cv } = variation(series);
  const xyz = w < minWeeks || cv == null ? null : cv <= xMax + 1e-12 ? 'X' : cv <= yMax + 1e-12 ? 'Y' : 'Z';
  return { xyz, cv, mean, sd, weeks: w };
}

// Weekly quantities of the `weeks` weeks ending on `today` (oldest first) from [{ day, qty }]; other days are ignored.
export function weeklySeries(sales, { today, weeks = DEFAULT_SETTINGS.weeks }) {
  const out = new Array(weeks).fill(0);
  for (const s of sales) {
    const w = weeksBack(s.day, today);
    if (w >= 0 && w < weeks) out[weeks - 1 - w] += s.qty;
  }
  return out;
}

// Whole weeks of history from the first sale to today, capped at `weeks` (a sale today counts as 0 weeks).
export const historyWeeks = (firstDay, today, weeks = DEFAULT_SETTINGS.weeks) =>
  firstDay ? Math.min(weeks, Math.max(0, Math.ceil(daysBetween(firstDay, today) / 7))) : 0;

/**
 * Sales lines -> items for classify. lines: [{ id, day, qty, amount? | price? }] (returns as negative qty);
 * amount is in minor units, else round(qty × price). Only days inside the window count towards revenue and the
 * series; `firstDays` ({ id: day }) gives the first sale of all time when the lines cover only the window.
 * costs: { id: unit cost } for the profit basis. -> [{ id, revenue, qty, cost, weekly, historyWeeks }]
 */
export function aggregateSales(lines, { today, weeks = DEFAULT_SETTINGS.weeks, firstDays = {}, costs = {} }) {
  const by = new Map();
  for (const l of lines) {
    let x = by.get(l.id);
    if (!x) by.set(l.id, (x = { id: l.id, revenue: 0, qty: 0, sales: [], first: firstDays[l.id] ?? null }));
    if (!x.first || l.day < x.first) x.first = l.day;
    const w = weeksBack(l.day, today);
    if (w < 0 || w >= weeks) continue;
    x.revenue += l.amount ?? Math.round(l.qty * (l.price ?? 0));
    x.qty += l.qty;
    x.sales.push(l);
  }
  return [...by.values()].map((x) => ({
    id: x.id, revenue: x.revenue, qty: Math.round(x.qty * 1e6) / 1e6, cost: costs[x.id] ?? null,
    weekly: weeklySeries(x.sales, { today, weeks }), historyWeeks: historyWeeks(x.first, today, weeks),
  }));
}

const r = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

/**
 * ABC + XYZ: items [{ id, revenue, qty, cost?, weekly, historyWeeks? }] -> [{ id, abc, xyz, cell, value, share,
 * cumShare, rank, cv, avgWeekly, sdWeekly, marginPct, weeks }] in ABC order. marginPct needs a known cost.
 */
export function classify(items, settings = DEFAULT_SETTINGS) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const byId = new Map(items.map((it) => [it.id, it]));
  return abcClasses(items, s).map((a) => {
    const it = byId.get(a.id);
    const weekly = it.weekly ?? [];
    const x = xyzClass(weekly, { ...s, weeks: it.historyWeeks ?? weekly.length });
    const margin = it.cost != null && it.qty > 0 && it.revenue > 0 ? ((it.revenue - Math.round(it.qty * it.cost)) / it.revenue) * 100 : null;
    return {
      ...a, xyz: x.xyz, cell: x.xyz ? a.abc + x.xyz : null,
      cv: x.cv == null ? null : r(x.cv, 3), avgWeekly: r(x.mean, 2), sdWeekly: r(x.sd, 2),
      marginPct: margin == null ? null : r(margin, 1), weeks: x.weeks,
    };
  });
}

// The 3×3 matrix plus 'A-', 'B-', 'C-' for items without XYZ: { AX: { count, value }, … }.
export function abcMatrix(classes) {
  const m = Object.fromEntries([...CELLS, 'A-', 'B-', 'C-'].map((c) => [c, { count: 0, value: 0 }]));
  for (const c of classes) {
    const k = c.cell ?? `${c.abc}-`;
    m[k].count++;
    m[k].value += c.value;
  }
  return m;
}

// Advice per class: 'new' (no XYZ yet), 'delist' (CZ), 'auto' (AX, BX: automatic reordering is safe),
// 'watch' (AZ: important but erratic); null otherwise.
export function cellAdvice(cls) {
  if (!cls) return null;
  if (!cls.xyz) return 'new';
  const cell = cls.cell ?? cls.abc + cls.xyz;
  if (cell === 'CZ') return 'delist';
  if (cell === 'AX' || cell === 'BX') return 'auto';
  if (cell === 'AZ') return 'watch';
  return null;
}

export const serviceLevelOf = (cls, service = DEFAULT_SETTINGS.service) => (cls?.cell ? service[cls.cell] ?? null : null);
