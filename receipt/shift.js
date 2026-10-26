// receipt/shift.js - cash shifts: the X report (totals of the open shift) and the Z report (the same at closing,
// with the counted cash and the difference). Sales and returns are counted apart, each with its cash / card /
// points split (points are not money: only what was paid with money goes to cash and card; a mixed check adds its
// cash part to cash and the rest to card, its money total is kept for reference), VAT by rate (returns subtract),
// cash in / out operations and the expected cash in the drawer:
//   expected = opening + cash sales − cash returns + cash in − cash out.
// Amounts in minor units; times are whatever numbers the caller uses (no clock is read).
//
// doc: { kind: 'sale' | 'return', number, total, payment: { method, cash, card, pointsValue }, vat: vatBreakdown,
//        fiscal?: 'done' | 'pending' | 'error' }

import { addBreakdown, emptyBreakdown } from './vat.js';

// Fiscal rule of many countries: a shift lasts at most 24 hours, then it can only be closed with a Z report.
export const SHIFT_MAX_MS = 24 * 3600 * 1000;
export const shiftExpired = (openedAt, at, maxMs = SHIFT_MAX_MS) => at - openedAt > maxMs;

const blank = () => ({ count: 0, total: 0, cash: 0, card: 0, mixed: 0, points: 0 });

/**
 * shift: { number, openedAt, openedBy?, openingCash }, docs, cashOps: [{ kind: 'in' | 'out', amount }], at.
 * -> { type: 'X', shiftNumber, openedAt, openedBy, at, openingCash, sales, returns, net, vat, cashIn, cashOut,
 *      expectedCash, notFiscal, firstReceipt, lastReceipt }
 */
// Pure aggregation: no clock is read and nothing is stored, so the X report can be recomputed at any time from the
// documents and must match the Z report taken at closing.
export function shiftReport(shift, docs = [], cashOps = [], at = null) {
  const r = { sale: blank(), return: blank() };
  let vat = emptyBreakdown(), notFiscal = 0;
  for (const d of docs) {
    const kind = d.kind === 'return' ? 'return' : 'sale';
    const b = r[kind];
    const p = d.payment ?? { method: 'cash', cash: d.total, card: 0, pointsValue: 0 };
    b.count++;
    b.total += d.total;
    b.points += p.pointsValue ?? 0;
    b.cash += p.cash ?? 0;
    b.card += p.card ?? 0;
    if (p.method === 'mixed') b.mixed += (p.cash ?? 0) + (p.card ?? 0);
    if (d.fiscal && d.fiscal !== 'done') notFiscal++;
    if (d.vat) vat = addBreakdown(vat, d.vat, kind === 'return' ? -1 : 1);
  }
  const cashIn = cashOps.filter((o) => o.kind === 'in').reduce((t, o) => t + o.amount, 0);
  const cashOut = cashOps.filter((o) => o.kind === 'out').reduce((t, o) => t + o.amount, 0);
  return {
    type: 'X', shiftNumber: shift.number ?? null, openedAt: shift.openedAt ?? null, openedBy: shift.openedBy ?? null, at,
    openingCash: shift.openingCash ?? 0, sales: r.sale, returns: r.return, net: r.sale.total - r.return.total, vat,
    cashIn, cashOut, expectedCash: (shift.openingCash ?? 0) + r.sale.cash - r.return.cash + cashIn - cashOut, notFiscal,
    firstReceipt: docs[0]?.number ?? null, lastReceipt: docs.at(-1)?.number ?? null,
  };
}

// Cash out of more than the drawer should hold is refused: 'not_enough_cash' | 'bad_amount' | null.
export function checkCashOp(report, kind, amount) {
  if (!(Number.isInteger(amount) && amount > 0)) return 'bad_amount';
  if (kind === 'out' && amount > report.expectedCash) return 'not_enough_cash';
  return kind === 'in' || kind === 'out' ? null : 'bad_amount';
}

// The Z report: the X report at closing with the counted cash (null when not counted) and the difference.
export function zReport(report, countedCash = null, extra = {}) {
  return { ...report, type: 'Z', countedCash, difference: countedCash == null ? null : countedCash - report.expectedCash, ...extra };
}
