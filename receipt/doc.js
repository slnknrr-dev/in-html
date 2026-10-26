// receipt/doc.js - receipt documents: a sale (cart -> check lines, discounts, VAT, payment with points / card / cash
// and change, points earned) and a return linked to its original sale (lines at the prices paid, VAT, money split as
// the sale was paid, points reversed and refunded, the original receipt and fiscal numbers). The documents are what
// format.js prints and shift.js totals.

import { computeCheck } from './cart.js';
import { settle } from './payment.js';
import { pointsEarned } from './loyalty.js';
import { buildReturn, refundOf } from './returns.js';

/**
 * meta: { number, ts, cashier, seller: { name, taxId, object, address } }, cart, opts:
 * { discount, pay: settle's pay, loyalty: { balance, blocked, pointValue, maxSpendPct, earnPct } | null,
 *   cashStep, mode, vatMethod }
 * -> { type: 'sale', kind: 'sale', …meta, lines, subtotal, discount, total, vat, payment,
 *      points: { spent, earned, balance } | null, errors: [codes] }
 */
// Points are earned on the money part only (payment.payable), never on the part paid with points.
export function saleDoc(meta, cart, { discount = null, pay = {}, loyalty = null, cashStep = 1, mode, vatMethod } = {}) {
  const check = computeCheck(cart, { discount, mode, vatMethod });
  const payment = settle(check.total, loyalty ? pay : { ...pay, points: 0 }, loyalty ?? {}, { cashStep });
  const earned = loyalty ? pointsEarned(payment.payable, loyalty) : 0;
  const points = loyalty ? { spent: payment.points, earned, balance: (loyalty.balance ?? 0) - payment.points + earned } : null;
  return {
    type: 'sale', kind: 'sale', ...meta, lines: check.lines, subtotal: check.subtotal, discount: check.discount,
    total: check.total, vat: check.vat, payment, points, errors: payment.errors,
  };
}

/**
 * A return of `request` [{ item, qty }] on `sale` (a saleDoc, plus its fiscalNumber when it has one); `earlier` are
 * the return documents already made on that sale.
 * -> { type: 'return', kind: 'return', …meta, lines, total, vat, payment: { method, cash, card, pointsValue },
 *      points: { reverse, refund }, original: { number, fiscalNumber }, errors: [{ code, item, available? }] }
 */
export function returnDoc(meta, sale, request, earlier = [], { mode, vatMethod } = {}) {
  const r = buildReturn(sale.lines, request, earlier, { mode, vatMethod });
  const refund = refundOf({ total: sale.total, payment: sale.payment, earned: sale.points?.earned ?? 0 }, r.total,
    earlier.map((e) => ({ total: e.total, cash: e.payment?.cash ?? 0 })));
  const method = refund.cash && refund.card ? 'mixed' : refund.card ? 'card' : 'cash';
  return {
    type: 'return', kind: 'return', ...meta, lines: r.lines, total: r.total, vat: r.vat,
    payment: { method, cash: refund.cash, card: refund.card, pointsValue: refund.pointsValue, money: refund.money },
    points: refund.points, original: { number: sale.number ?? null, fiscalNumber: sale.fiscalNumber ?? null }, errors: r.errors,
  };
}
