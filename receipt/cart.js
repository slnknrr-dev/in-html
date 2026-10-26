// receipt/cart.js - the cart of a point of sale and the totals of a check. Cart operations are immutable (add an
// item, merging the same item at the same price, with marking codes that may not repeat; set a quantity; remove a
// line; line discounts) and computeCheck turns the cart into check lines: gross = qty × price, the line discount,
// the share of the whole-check discount (allocated by largest remainder so the lines always add up to the check
// total), the line total and its included VAT, plus the VAT breakdown. Money in integer minor units.
//
// cart line: { item, name, code?, qty, price, vatRate?, stock?, codes?: [marking codes], discount?: { pct } | { amount } }

import { allocate, lineAmount, percentOf } from './money.js';
import { vatBreakdown, vatIncluded } from './vat.js';

const q3 = (x) => Math.round(Number(x) * 1000) / 1000;

/**
 * Adds an item: { cart, line (index), error }. The same item at the same price (and without a line discount) is
 * merged; a marking code already in the check gives error 'code_twice' and leaves the cart unchanged.
 * item: { item, name, code?, price, vatRate?, stock? }; opts: { qty = 1, code }
 */
// Immutable updates: the UI keeps history (undo) and React-style change detection works by reference. Marking codes
// (per-unit track-and-trace codes) are unique within a check, so a double scan is refused.
export function addItem(cart, item, { qty = 1, code = null } = {}) {
  if (code && cart.some((l) => l.codes?.includes(code))) return { cart, line: -1, error: 'code_twice' };
  const i = cart.findIndex((l) => l.item === item.item && l.price === item.price && !l.discount);
  if (i >= 0) {
    const next = cart.map((l, k) => (k === i ? { ...l, qty: q3(l.qty + qty), codes: code ? [...(l.codes ?? []), code] : l.codes ?? [] } : l));
    return { cart: next, line: i, error: null };
  }
  const line = { item: item.item, name: item.name ?? '', code: item.code ?? null, qty: q3(qty), price: item.price, vatRate: item.vatRate ?? null, codes: code ? [code] : [] };
  if (item.stock != null) line.stock = item.stock;
  return { cart: [...cart, line], line: cart.length, error: null };
}

// Quantity of a line; zero or less removes it.
export const setQty = (cart, index, qty) => (qty > 0 ? cart.map((l, k) => (k === index ? { ...l, qty: q3(qty) } : l)) : removeLine(cart, index));

export const removeLine = (cart, index) => cart.filter((_, k) => k !== index);

// Line discount: { pct } or { amount } (minor units for the whole line); null clears it.
export const setLineDiscount = (cart, index, discount) => cart.map((l, k) => {
  if (k !== index) return l;
  const { discount: _old, ...rest } = l;
  return discount ? { ...rest, discount } : rest;
});

// Lines asking for more than the known stock: [{ index, item, qty, stock }] (selling into minus is the caller's call).
export function stockWarnings(cart) {
  const need = new Map();
  cart.forEach((l) => need.set(l.item, q3((need.get(l.item) ?? 0) + l.qty)));
  const out = [];
  cart.forEach((l, index) => { if (l.stock != null && need.get(l.item) > l.stock + 1e-9) out.push({ index, item: l.item, qty: need.get(l.item), stock: l.stock }); });
  return out;
}

const discountOf = (amount, d, mode) => {
  if (!d) return 0;
  const v = d.pct != null ? percentOf(amount, Math.min(100, Math.max(0, d.pct)), mode) : Math.round(d.amount ?? 0);
  return Math.min(Math.max(0, v), Math.max(0, amount));
};

/**
 * Check totals of a cart. opts: { discount: { pct } | { amount }, mode ('half-up'), vatMethod ('line' | 'rate') }
 * -> { lines: [{ ...line, gross, lineDiscount, checkDiscount, total, unitPrice, vat }], subtotal, lineDiscounts,
 *      checkDiscount, discount, total, vat: vatBreakdown }
 * unitPrice is the effective price after discounts (total ÷ qty, not rounded: for display and returns).
 */
// Order of operations: line amount -> line discount -> whole-check discount allocated over the discounted line
// amounts -> line total -> VAT of that total. Allocating the check discount to lines is required so returns later
// refund what was actually paid per item.
export function computeCheck(cart, { discount = null, mode = 'half-up', vatMethod = 'line' } = {}) {
  const pre = cart.map((l) => {
    const gross = lineAmount(l.qty, l.price, mode);
    const lineDiscount = discountOf(gross, l.discount, mode);
    return { l, gross, lineDiscount, after: gross - lineDiscount };
  });
  const afterSum = pre.reduce((t, x) => t + x.after, 0);
  const checkDiscount = discountOf(afterSum, discount, mode);
  const shares = allocate(checkDiscount, pre.map((x) => x.after));
  const lines = pre.map((x, i) => {
    const total = x.after - shares[i];
    return { ...x.l, gross: x.gross, lineDiscount: x.lineDiscount, checkDiscount: shares[i], total, unitPrice: x.l.qty ? total / x.l.qty : 0, vat: vatIncluded(total, x.l.vatRate, mode) };
  });
  const subtotal = pre.reduce((t, x) => t + x.gross, 0);
  const lineDiscounts = pre.reduce((t, x) => t + x.lineDiscount, 0);
  return {
    lines, subtotal, lineDiscounts, checkDiscount, discount: lineDiscounts + checkDiscount,
    total: subtotal - lineDiscounts - checkDiscount, vat: vatBreakdown(lines, { method: vatMethod, mode }),
  };
}
