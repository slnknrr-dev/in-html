// receipt/returns.js - returns by the original check: what can still be returned (sold minus returned before, per
// item), the return lines at the prices actually paid (after line and check discounts), the amount of a partial
// return proportional to what is left (the last unit returns exactly the remaining amount, so a full return in
// several steps adds up to the sale to the minor unit), VAT of the return, and the money and points to give back.

import { mulDivRound } from './money.js';
import { vatBreakdown, vatIncluded } from './vat.js';
import { refundSplit } from './payment.js';
import { returnPoints } from './loyalty.js';

const q3 = (x) => Math.round(x * 1000) / 1000;

/**
 * What is left to return: sale lines [{ item, qty, total, name?, vatRate? }] minus earlier return lines of the same
 * check -> { item: { qty, amount, name, vatRate } }.
 */
export function returnable(saleLines, previousReturns = []) {
  const left = {};
  for (const l of saleLines) {
    const x = (left[l.item] ??= { qty: 0, amount: 0, name: l.name ?? '', vatRate: l.vatRate ?? null });
    x.qty = q3(x.qty + l.qty);
    x.amount += l.total;
  }
  for (const r of previousReturns) for (const l of r.lines ?? r) {
    const x = left[l.item];
    if (!x) continue;
    x.qty = q3(x.qty - Math.abs(l.qty));
    x.amount -= Math.abs(l.total);
  }
  return left;
}

/**
 * Return lines for a request [{ item, qty }]. -> { lines: [{ item, name, qty, total, vatRate, vat }], total, vat,
 * errors: [{ code: 'not_in_sale' | 'bad_qty' | 'return_exceeds_sale', item, available? }] } (failed lines are left out).
 */
// The last unit returned takes exactly the remaining amount instead of a proportional share, so several partial
// returns of one line always add up to the line total to the minor unit (no orphaned rounding cents).
export function buildReturn(saleLines, request, previousReturns = [], { mode = 'half-up', vatMethod = 'line' } = {}) {
  const left = returnable(saleLines, previousReturns);
  const lines = [], errors = [];
  for (const r of request) {
    const x = left[r.item];
    if (!x) { errors.push({ code: 'not_in_sale', item: r.item }); continue; }
    const qty = q3(r.qty);
    if (!(qty > 0)) { errors.push({ code: 'bad_qty', item: r.item }); continue; }
    if (qty > x.qty + 1e-9) { errors.push({ code: 'return_exceeds_sale', item: r.item, available: x.qty }); continue; }
    const total = qty >= x.qty - 1e-9 ? x.amount : mulDivRound(x.amount, Math.round(qty * 1000), Math.round(x.qty * 1000), mode);
    x.qty = q3(x.qty - qty);
    x.amount -= total;
    lines.push({ item: r.item, name: x.name, qty, total, vatRate: x.vatRate, vat: vatIncluded(total, x.vatRate, mode) });
  }
  const total = lines.reduce((t, l) => t + l.total, 0);
  return { lines, total, vat: vatBreakdown(lines, { method: vatMethod, mode }), errors };
}

/**
 * Money and points of a return. sale: { total, payment: settle(…) result, earned?, spent? }; returnTotal: the
 * return's check amount; earlier: [{ total, cash }] returns already made on this sale.
 * -> { points: { reverse, refund }, pointsValue, money, cash, card }
 * Spent points come back as points; the money refunded is the return total minus their value.
 */
// Points are computed cumulatively (all returns so far minus earlier returns) for the same reason: rounding each
// return independently could refund more points in total than were spent.
export function refundOf(sale, returnTotal, earlier = []) {
  const p = sale.payment ?? {};
  const pointValue = p.points ? p.pointsValue / p.points : 0;
  const before = earlier.reduce((t, r) => t + r.total, 0);
  const pointsBefore = returnPoints({ earned: sale.earned ?? 0, spent: sale.payment?.points ?? 0, total: sale.total }, before);
  const pointsAll = returnPoints({ earned: sale.earned ?? 0, spent: sale.payment?.points ?? 0, total: sale.total }, before + returnTotal);
  // Points of this return = cumulative minus what earlier returns already moved, so rounding never over-refunds.
  const points = { reverse: pointsAll.reverse - pointsBefore.reverse, refund: pointsAll.refund - pointsBefore.refund };
  const pointsValue = points.refund * pointValue;
  const money = Math.max(0, returnTotal - pointsValue);
  const split = refundSplit(sale.payment ?? { method: 'cash' }, sale.payment?.payable ?? sale.total, money, earlier.reduce((t, r) => t + (r.cash ?? 0), 0));
  return { points, pointsValue, money, ...split };
}
