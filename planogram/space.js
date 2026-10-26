// planogram/space.js - space and stock arithmetic over one or more fixtures: linear metres and the share of shelf
// width per product / category / brand (nominal width = pack width x width facings), capacity (units a position
// holds: fx x fy x fz), days of supply from daily sales with low / high verdicts, sales and gross profit per metre,
// and the macro-space balance: each group's share of shelf metres against its share of sales, with the metres the
// sales share would give it.
//
// Space is measured as nominal width (pack width x width facings), the merchandising convention for shelf share;
// depth facings add stock, not visible space. Shares divide by used width (the planned layout), while fill divides
// by shelf width (how full the fixture is).

import { effectiveDims, hasDims, productLookup, round } from './model.js';

const pid = (p) => p.productId ?? p.modelId;

// Shelves of a fixture, an array of fixtures, or a plain array of shelves.
export function shelvesOf(x) {
  if (!x) return [];
  if (Array.isArray(x)) return x.flatMap((f) => (f && Array.isArray(f.shelves) ? f.shelves : f && Array.isArray(f.positions) ? [f] : []));
  return Array.isArray(x.shelves) ? x.shelves : [];
}

export const capacity = (p) => p.fx * p.fy * p.fz;

// Nominal width of a position in cm (null without dimensions); pegboards round each column up to the pitch.
export function positionWidth(p, product, shelf = {}) {
  if (!hasDims(product)) return null;
  const w = effectiveDims(product, p.rot, p.turn).width;
  const col = shelf.kind === 'peg' && shelf.pitch ? Math.ceil(w / shelf.pitch - 1e-9) * shelf.pitch : w;
  return col * p.fx;
}

const keyFn = (by) => (typeof by === 'function' ? by : by === 'product' ? (pr, id) => id : (pr) => pr?.[by] ?? null);

/**
 * Space by group. by: 'product' | 'category' | 'brand' | (product, id) => key.
 * -> { rows: [{ key, width, metres, share, facings, units, skus, positions }] (widest first),
 *      total: { shelfMetres, usedMetres, fill, unknown } }   share = width / used width of all groups.
 */
export function spaceBy(fixtures, products, by = 'product') {
  const get = productLookup(products), key = keyFn(by);
  const acc = new Map();
  let shelfWidth = 0, used = 0, unknown = 0;
  for (const s of shelvesOf(fixtures)) {
    shelfWidth += s.width;
    for (const p of s.positions) {
      if (p.ref && !pid(p)) continue;
      const pr = get(pid(p));
      const w = positionWidth(p, pr, s);
      if (w == null) { unknown++; continue; }
      const k = key(pr, pid(p));
      let r = acc.get(k);
      if (!r) acc.set(k, (r = { key: k, width: 0, facings: 0, units: 0, skus: new Set(), positions: 0 }));
      r.width += w; r.facings += p.fx; r.units += capacity(p); r.skus.add(pid(p)); r.positions++;
      used += w;
    }
  }
  // Sorted widest first, then by key, so equal widths have a stable order across runs (repeatable reports).
  const rows = [...acc.values()].map((r) => ({
    key: r.key, width: round(r.width), metres: round(r.width / 100, 2), share: used ? round(r.width / used, 4) : 0,
    facings: r.facings, units: r.units, skus: r.skus.size, positions: r.positions,
  })).sort((a, b) => b.width - a.width || String(a.key).localeCompare(String(b.key)));
  return { rows, total: { shelfMetres: round(shelfWidth / 100, 2), usedMetres: round(used / 100, 2), fill: shelfWidth ? round((used / shelfWidth) * 100, 0) : 0, unknown } };
}

// Units on the shelves per product: Map productId -> { units, facings, positions }.
export function productCapacity(fixtures) {
  const m = new Map();
  for (const s of shelvesOf(fixtures)) for (const p of s.positions) {
    if (!pid(p)) continue;
    const r = m.get(pid(p)) ?? { units: 0, facings: 0, positions: 0 };
    r.units += capacity(p); r.facings += p.fx; r.positions++;
    m.set(pid(p), r);
  }
  return m;
}

// Days the shelf stock lasts at a daily sales rate; null without sales.
export const daysOfSupply = (units, dailySales) => (dailySales > 0 ? round(units / dailySales, 1) : null);

/**
 * Days of supply per product on the shelves. dailySales from the product or `sales` (id -> number).
 *   minDays (default 2): fewer days than the replenishment cycle -> 'low'
 *   maxDays (default 30): more -> 'high' (space better given to faster sellers)
 *   caseUnits on the product: the shelf should hold at least one case plus the facings ('below_case')
 * -> [{ productId, units, facings, dailySales, days, status: 'ok' | 'low' | 'high' | 'no_sales' | 'below_case' }]
 */
// Days of supply = shelf capacity / daily sales. The below_case rule follows store practice: a shelf should take a
// full delivery case on top of the facing units left, or staff must keep back-stock.
export function supplyReport(fixtures, products, { sales = null, minDays = 2, maxDays = 30 } = {}) {
  const get = productLookup(products);
  const out = [];
  for (const [id, c] of productCapacity(fixtures)) {
    const pr = get(id) ?? {};
    const ds = sales && sales[id] != null ? Number(sales[id]) : pr.dailySales ?? null;
    const days = daysOfSupply(c.units, ds);
    let status = days == null ? 'no_sales' : days < minDays ? 'low' : days > maxDays ? 'high' : 'ok';
    if (status === 'ok' && pr.caseUnits && c.units < pr.caseUnits + c.facings) status = 'below_case';
    out.push({ productId: id, units: c.units, facings: c.facings, dailySales: ds, days, status });
  }
  return out.sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity) || a.productId.localeCompare(b.productId));
}

/**
 * Sales and gross profit per shelf metre. sales: id -> { qty, revenue }; profit uses product.cost (average purchase
 * price); products without a cost make profitPartial true. noStock: products on the shelves with stock <= 0.
 */
export function shelfMetrics(fixtures, products, sales = {}) {
  const get = productLookup(products);
  const ids = [...productCapacity(fixtures).keys()];
  let qty = 0, revenue = 0, profit = 0, profitPartial = false;
  for (const id of ids) {
    const s = sales[id];
    if (!s) continue;
    qty += s.qty ?? 0; revenue += s.revenue ?? 0;
    const cost = get(id)?.cost;
    if (cost != null) profit += (s.revenue ?? 0) - (s.qty ?? 0) * cost;
    else profitPartial = true;
  }
  const metres = round(shelvesOf(fixtures).reduce((x, s) => x + s.width, 0) / 100, 2);
  return {
    metres, skus: ids.length, qty: round(qty, 3), revenue: round(revenue, 2), grossProfit: round(profit, 2), profitPartial,
    revenuePerMetre: metres ? round(revenue / metres, 2) : null, profitPerMetre: metres ? round(profit / metres, 2) : null,
    noStock: ids.filter((id) => { const st = get(id)?.stock; return st != null && st <= 1e-9; }),
  };
}

/**
 * Macro space: rows of spaceBy (by category, say) against sales per key { revenue, profit }.
 * -> [{ key, metres, spaceShare, salesShare, profitShare, revenuePerMetre, recommendedMetres, gap, verdict }]
 * gap = spaceShare - salesShare; verdict 'over' (more space than sales) / 'under' / 'ok' within ±threshold, 'none'.
 */
// Macro-space balancing: a category's share of shelf metres should track its share of sales. recommendedMetres
// reallocates the current total metres in proportion to sales. Negative profit is floored at 0 in the profit share
// so a loss-making group does not produce negative shares.
export function macroSpace(space, sales = {}, { threshold = 0.05 } = {}) {
  const rows = space.rows ?? space;
  const keys = new Set([...rows.map((r) => r.key), ...Object.keys(sales)]);
  const byKey = new Map(rows.map((r) => [String(r.key), r]));
  const totW = rows.reduce((x, r) => x + r.width, 0);
  let totRev = 0, totProfit = 0;
  for (const k of keys) { const s = sales[k]; if (s) { totRev += s.revenue ?? 0; totProfit += Math.max(0, s.profit ?? 0); } }
  const share = (v, t) => (t > 0 ? round(v / t, 4) : null);
  return [...new Set([...keys].map(String))].map((k) => {
    const r = byKey.get(k), s = sales[k] ?? {};
    const width = r?.width ?? 0;
    const spaceShare = share(width, totW), salesShare = share(s.revenue ?? 0, totRev);
    const gap = spaceShare != null && salesShare != null ? round(spaceShare - salesShare, 4) : null;
    return {
      key: r ? r.key : k, metres: round(width / 100, 2), spaceShare, salesShare, profitShare: share(Math.max(0, s.profit ?? 0), totProfit),
      revenue: round(s.revenue ?? 0, 2), revenuePerMetre: width ? round((s.revenue ?? 0) / (width / 100), 2) : null,
      recommendedMetres: salesShare != null ? round((totW / 100) * salesShare, 2) : null,
      gap, verdict: gap == null ? 'none' : gap > threshold ? 'over' : gap < -threshold ? 'under' : 'ok',
    };
  }).sort((a, b) => (b.salesShare ?? 0) - (a.salesShare ?? 0) || (b.spaceShare ?? 0) - (a.spaceShare ?? 0));
}
