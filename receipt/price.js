// receipt/price.js - the price in effect for an item at an object: the base is the object's own price, else the
// item's retail price; promotions (percent off or a fixed price) apply to listed items or to everything under listed
// categories, at all or selected objects, during a period; of the matching promotions the lowest price wins, and
// only when it is below the base. Also category ancestors, active promotions, items whose price changed, and the
// data of price tags (old price, promotion badge, formatted price). Minor units; periods as ISO strings
// ('YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM', compared as text, so use one format).
//
// promotion: { id, name, kind: 'percent' | 'fixed', value, items?: [], categories?: [], objects?: null | [],
//              from, to, deleted? }

import { formatMoney, percentOf } from './money.js';

// Ancestors of a node, nearest first. nodes: [{ id, parent }] or a Map id -> node; cycles stop.
export function ancestorsOf(nodes, id) {
  const byId = nodes instanceof Map ? nodes : new Map(nodes.map((n) => [n.id, n]));
  const out = [];
  const seen = new Set([id]);
  for (let p = byId.get(id)?.parent; p != null && !seen.has(p); p = byId.get(p)?.parent) { out.push(p); seen.add(p); }
  return out;
}

// String comparison of ISO dates / date-times is correct only when every value uses the same format and zero
// padding; '2026-05-01' and '2026-05-01T10:00' compare by prefix, so mixing formats shifts boundaries.
export const activePromotions = (promotions, at) => promotions.filter((p) => !p.deleted && p.from <= at && at <= p.to);

// 'planned' | 'active' | 'finished' of a promotion at a moment.
export const promotionState = (p, at) => (p.from > at ? 'planned' : p.to < at ? 'finished' : 'active');

// Price under one promotion: percent off the base (rounded half up) or the fixed price.
export const promoPrice = (base, p) => (p.kind === 'percent' ? base - percentOf(base, p.value) : Math.round(p.value));

export function promoApplies(p, { item, object = null, ancestors = [] }) {
  if (p.objects && object != null && !p.objects.includes(object)) return false;
  return (p.items ?? []).includes(item) || (p.categories ?? []).some((c) => ancestors.includes(c));
}

/**
 * { item, object?, itemPrice (retail), objectPrice?, ancestors?, promotions (already active), at? }
 * -> { base, price, promo: { id, name, kind, value, to } | null, source: 'object' | 'item' | null }
 * When `at` is given the promotions are filtered by it here.
 */
// Policy: promotions never stack and never raise a price; the single lowest promotional price below the base wins.
// The object's own price beats the item's retail price as the base.
export function bestPrice({ item, object = null, itemPrice = null, objectPrice = null, ancestors = [], promotions = [], at = null }) {
  const base = objectPrice ?? itemPrice ?? null;
  if (base == null) return { base: null, price: null, promo: null, source: null };
  let best = null;
  for (const p of at == null ? promotions : activePromotions(promotions, at)) {
    if (!promoApplies(p, { item, object, ancestors })) continue;
    const price = promoPrice(base, p);
    if (price < base && (!best || price < best.price)) best = { price, promo: { id: p.id, name: p.name, kind: p.kind, value: p.value, to: p.to } };
  }
  return { base, price: best?.price ?? base, promo: best?.promo ?? null, source: objectPrice != null ? 'object' : 'item' };
}

/**
 * Items to re-tag: price history [{ item, object?, at }] changed since `since` (for this object or for all objects)
 * plus items under an active promotion. -> [item ids] in first-seen order.
 */
export function changedItems(history, since, { object = null, promoted = [] } = {}) {
  const ids = history.filter((h) => h.at >= since && (h.object == null || object == null || h.object === object)).map((h) => h.item);
  return [...new Set([...ids, ...promoted])];
}

export const TAG_SIZES = {
  small: { widthMm: 58, nameFont: 11, priceFont: 24 },
  large: { widthMm: 90, nameFont: 14, priceFont: 34 },
};

/**
 * Price tag data. items: [{ item, name, code?, price: bestPrice(…) result }]; opts: { digits, decimal, currency,
 * objectName, day, size }. -> [{ item, name, code, price, old, badge, promo, text: { price, old }, meta, size }]
 */
export function priceTags(items, { digits = 2, decimal = ',', currency = '', objectName = '', day = '', size = 'small' } = {}) {
  const fmt = (v) => (v == null ? '—' : formatMoney(v, { digits, decimal }));
  return items.map(({ item, name, code = null, price: p }) => ({
    item, name, code, price: p.price, old: p.promo ? p.base : null, badge: p.promo?.name ?? null, promo: !!p.promo,
    text: { price: fmt(p.price) + (currency ? ` ${currency}` : ''), old: p.promo ? fmt(p.base) : null },
    meta: [code, objectName, day].filter(Boolean).join(' · '), size: TAG_SIZES[size] ?? TAG_SIZES.small,
  }));
}

// Unit price for comparison (per kg / l / 100 g): price of `packQty` units -> price of `per` units, rounded half up.
export const unitPrice = (price, packQty, per = 1) => (packQty > 0 ? Math.round((price * per) / packQty) : null);
