// estate/mortgage.js - loan arithmetic for a flat: the annuity payment, full annuity and differentiated schedules,
// the down payment and the loan body, what a monthly budget can borrow. Amounts are integers in ONE unit (minor units
// recommended: tetri, cents) and every result is rounded to that unit with an explicit mode; the last row of a
// schedule takes the rounding difference, so the principal parts always sum to the loan exactly. The rate is a
// nominal annual percentage, monthly rate = rate / 12. A zero rate (a developer's interest-free instalments - the
// common case for new-builds, not an edge case) has its own branch instead of dividing by zero.
// This is an ESTIMATE from the numbers given, not a bank offer: saying so is the page's job.
//
//   loanMonthly(price, { downPct = 20, years = 10, ratePct = 12 }) -> { monthly, down, body, months }
//   annuityPayment(principal, ratePct, months, rounding?) -> integer
//   annuitySchedule(principal, { ratePct, months, rounding, startMonth }) -> schedule
//   differentiatedSchedule(principal, { ratePct, months, rounding, startMonth }) -> schedule
//     schedule = { kind, principal, months, rows: [{ n, month?, payment, interest, principal, balance }],
//                  first, last, totalInterest, totalPaid }
//   mortgagePlan(price, { downPct, years | months, ratePct, kind: 'annuity' | 'differentiated', startMonth })
//     -> { price, down, body, months, ...schedule }
//   affordablePrincipal(monthly, ratePct, months) -> the largest loan whose annuity payment fits the budget

import { allocate, roundNumber } from '../ledger/minor.js';

// Integer minor units end the float drift of money: 0.1 + 0.2 never appears, and sums of rows equal totals exactly.
const int = (v) => Math.max(0, Math.trunc(Number(v)) || 0);
const monthRate = (ratePct) => Math.max(0, Number(ratePct) || 0) / 100 / 12;

function monthLabel(start, k) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(start || ''));
  if (!m) return undefined;
  const idx = Number(m[1]) * 12 + Number(m[2]) - 1 + k;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

// Standard annuity formula P * i * (1+i)^n / ((1+i)^n - 1). Math.pow on doubles is exact enough here: the result
// is rounded to a whole minor unit right after.
export function annuityPayment(principal, ratePct, months, rounding = 'half-up') {
  const p = int(principal), n = int(months);
  if (!p || !n) return 0;
  const i = monthRate(ratePct);
  if (i === 0) return roundNumber(p / n, rounding);
  const k = Math.pow(1 + i, n);
  return roundNumber((p * i * k) / (k - 1), rounding);
}

/**
 * The approximate monthly payment shown next to a price: the down payment (clamped 0..90 %), the body, the annuity over
 * `years` (1..30) at `ratePct` (0..40). Rounded half up; a zero rate is body / months rounded half up as well.
 */
// Display helper with clamped inputs (form sliders) and plain Math.round; the schedule functions below take an
// explicit rounding mode and are the ones to use for amounts that must reconcile.
export function loanMonthly(price, o = {}) {
  const p = Math.max(0, +price || 0);
  const downPct = Math.min(90, Math.max(0, +(o.downPct ?? 20) || 0));
  const years = Math.min(30, Math.max(1, Math.trunc(+(o.years ?? 10) || 10)));
  const ratePct = Math.min(40, Math.max(0, +(o.ratePct ?? 12) || 0));
  const down = Math.round((p * downPct) / 100);
  const body = Math.max(0, p - down);
  const months = years * 12;
  if (!body) return { monthly: 0, down, body, months };
  if (ratePct === 0) return { monthly: Math.round(body / months), down, body, months };
  const i = ratePct / 100 / 12;
  const k = Math.pow(1 + i, months);
  return { monthly: Math.round((body * i * k) / (k - 1)), down, body, months };
}

function finish(kind, principal, months, rows) {
  const totalInterest = rows.reduce((s, r) => s + r.interest, 0);
  const totalPaid = rows.reduce((s, r) => s + r.payment, 0);
  return { kind, principal, months, rows, first: rows.length ? rows[0].payment : 0, last: rows.length ? rows[rows.length - 1].payment : 0, totalInterest, totalPaid };
}

/**
 * Equal payments. Each month: interest = round(balance × monthly rate), principal = payment - interest; the last
 * month pays exactly the remaining balance plus its interest (so the balance ends at 0 to the unit). With a zero rate
 * the principal is split by largest remainder (the first months carry the extra unit).
 */
export function annuitySchedule(principal, { ratePct = 0, months = 120, rounding = 'half-up', startMonth } = {}) {
  const p = int(principal), n = int(months);
  const rows = [];
  if (!p || !n) return finish('annuity', p, n, rows);
  const i = monthRate(ratePct);
  if (i === 0) {
    let balance = p;
    allocate(p, Array(n).fill(1)).forEach((part, k) => {
      balance -= part;
      rows.push({ n: k + 1, month: monthLabel(startMonth, k), payment: part, interest: 0, principal: part, balance });
    });
    return finish('annuity', p, n, rows);
  }
  const pay = annuityPayment(p, ratePct, n, rounding);
  let balance = p;
  // The rounded payment never amortises to exactly 0 by itself; forcing the last row to take the remaining balance
  // keeps the invariant sum(principal) = loan. Note: if rounding pays the loan off early the loop breaks and rows has
  // fewer than n entries while the result still reports months = n.
  for (let k = 0; k < n; k++) {
    const interest = roundNumber(balance * i, rounding);
    let part = k === n - 1 ? balance : Math.min(balance, pay - interest);
    if (part < 0) part = 0;
    balance -= part;
    rows.push({ n: k + 1, month: monthLabel(startMonth, k), payment: part + interest, interest, principal: part, balance });
    if (!balance && k < n - 1) break;
  }
  return finish('annuity', p, n, rows);
}

/**
 * Equal principal parts (largest remainder, summing to the loan exactly) plus interest on the remaining balance:
 * the payment falls month by month, the total interest is lower than with an annuity.
 */
export function differentiatedSchedule(principal, { ratePct = 0, months = 120, rounding = 'half-up', startMonth } = {}) {
  const p = int(principal), n = int(months);
  const rows = [];
  if (!p || !n) return finish('differentiated', p, n, rows);
  const i = monthRate(ratePct);
  let balance = p;
  allocate(p, Array(n).fill(1)).forEach((part, k) => {
    const interest = roundNumber(balance * i, rounding);
    balance -= part;
    rows.push({ n: k + 1, month: monthLabel(startMonth, k), payment: part + interest, interest, principal: part, balance });
  });
  return finish('differentiated', p, n, rows);
}

export function mortgagePlan(price, { downPct = 20, years = 10, months, ratePct = 12, kind = 'annuity', rounding = 'half-up', startMonth } = {}) {
  const p = int(price);
  const dp = Math.min(100, Math.max(0, +downPct || 0));
  const down = roundNumber((p * dp) / 100, rounding);
  const body = Math.max(0, p - down);
  const n = int(months) || Math.max(1, Math.min(50, Math.trunc(+years) || 1)) * 12;
  const opts = { ratePct, months: n, rounding, startMonth };
  const s = kind === 'differentiated' ? differentiatedSchedule(body, opts) : annuitySchedule(body, opts);
  return { price: p, down, body, ...s };
}

// The largest principal whose annuity payment does not exceed `monthly` (rounded down).
// Closed-form inverse of the annuity formula first, then a short integer walk to absorb rounding: the walk guarantees
// the exact invariant annuityPayment(p) <= monthly < annuityPayment(p + 1), which the float inverse alone cannot.
export function affordablePrincipal(monthly, ratePct, months) {
  const m = int(monthly), n = int(months);
  if (!m || !n) return 0;
  const i = monthRate(ratePct);
  if (i === 0) return m * n;
  const k = Math.pow(1 + i, n);
  let p = Math.floor((m * (k - 1)) / (i * k));
  while (p > 0 && annuityPayment(p, ratePct, n) > m) p--;
  // The payment is rounded, so a few more units may still fit; the loop is short (payment grows by ~i·k/(k-1) per unit).
  while (annuityPayment(p + 1, ratePct, n) <= m) p++;
  return p;
}
