// receipt/payment.js - paying a check: loyalty points first (whole points, within the balance and the programme's
// share of the check), then card and cash. A card is charged at most what is left (a card never gives change);
// cash covers the rest, the change comes out of cash only. Optional cash rounding to the smallest coin applies to the
// cash part only. Also the split of a return of a mixed payment (cash in the share the sale had). Minor units.

import { mulDivRound, roundCash } from './money.js';
import { checkSpend, LOYALTY_DEFAULTS } from './loyalty.js';

/**
 * total: check total. pay: { points = 0, card = null | amount | 'rest', cash = null (tendered) }, loyalty:
 * { balance, blocked, pointValue, maxSpendPct }, opts: { cashStep = 1 }.
 * -> { total, points, pointsValue, payable, card, cashDue, cash, tendered, change, short, rounding, method, errors }
 *   payable   total − points value (the money part, the base for earning points)
 *   cashDue   what cash must cover (after rounding to cashStep); cash = what the drawer keeps (cashDue when paid)
 *   method    'cash' | 'card' | 'mixed' | 'points'
 *   errors    codes: points (checkSpend), 'card_exceeds', 'cash_short'
 * With no cash tendered the cash due is assumed paid exactly (the cashier did not type the amount).
 */
// Payment order is fixed: points, then card, then cash. Only cash can exceed what is due (change), so card is capped
// and rounding to the smallest coin applies to the cash part alone; card payments stay exact to the minor unit.
export function settle(total, pay = {}, loyalty = {}, { cashStep = 1 } = {}) {
  const errors = [];
  const pointValue = loyalty.pointValue ?? LOYALTY_DEFAULTS.pointValue;
  let points = pay.points ?? 0;
  const pe = checkSpend(points, total, { ...loyalty, balance: loyalty.balance ?? 0, pointValue });
  if (pe) { errors.push(pe); points = 0; }
  const pointsValue = points * pointValue;
  const payable = total - pointsValue;
  let card = pay.card === 'rest' ? payable : pay.card ?? 0;
  if (card > payable) { errors.push('card_exceeds'); card = payable; }
  const rest = payable - card;
  const cashDue = roundCash(rest, cashStep);
  const rounding = cashDue - rest;
  const tendered = pay.cash ?? null;
  let change = 0, short = 0;
  if (tendered != null) {
    if (tendered < cashDue) { short = cashDue - tendered; errors.push('cash_short'); }
    else change = tendered - cashDue;
  }
  const cash = tendered == null ? cashDue : Math.min(tendered, cashDue);
  const method = payable === 0 && points ? 'points' : card && cashDue ? 'mixed' : card ? 'card' : 'cash';
  return { total, points, pointsValue, payable, card, cashDue, cash, tendered, change, short, rounding, method, errors };
}

/**
 * Money of a return by payment: the sale's payment { method, cash, card } and its money total (payable), and the
 * money to refund now -> { cash, card }. A mixed sale refunds cash in the share the cash had in the sale (rounded half
 * up), the rest goes back to the card; `alreadyCash` (cash refunded by earlier returns) keeps the cash refunds from
 * exceeding the cash received.
 */
// Refunds go back the way the money came. For mixed payments the cash share is proportional, and capped by the cash
// still unrefunded, so a series of partial returns can never pay out more cash than the drawer received for that sale.
export function refundSplit(salePayment, salePayable, refund, alreadyCash = 0) {
  if (salePayment.method === 'card') return { cash: 0, card: refund };
  if (salePayment.method !== 'mixed' || !(salePayable > 0)) return { cash: refund, card: 0 };
  const share = mulDivRound(refund, salePayment.cash ?? 0, salePayable, 'half-up');
  const cash = Math.max(0, Math.min(share, (salePayment.cash ?? 0) - alreadyCash, refund));
  return { cash, card: refund - cash };
}
