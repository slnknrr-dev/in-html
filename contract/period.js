// contract/period.js - the billing periods of a lease: a schedule of monthly periods where every period runs from
// day D of a month to day D-1 of the next month, the first starting on the start date and the last ending the day
// before the move-out date.
//
//   billingSchedule({ start, months, end, anchorDay, amount, prorata, round, dueOffset, max }) ->
//     { ok, start, end, last, months (full periods), periods: [{ n, from, to, days, fullDays, partial, amount, due }], total,
//       count, partialCount, issues: [code] }
//
//   start      first day of the lease ('2027-01-23')
//   months     term in months; the move-out date is then start + months (same day, clamped to the month end)
//   end        or the move-out date itself (the day the premises are returned); the last paid day is end - 1
//   anchorDay  day of the month the periods start on (1-31, default: the day of `start`); when it differs from the
//              start day the first period is a partial one up to the first anchor
//   amount     the payment of a full period; prorata: partial periods are charged by days (amount × days / days of
//              the full period they belong to), otherwise in full; round: decimal places of amounts (default 2)
//   dueOffset  the due date of each payment relative to the period start in days (-3: three days in advance)
//
// Anchors are always taken from the anchor day, never from the previous period, so a lease from the 31st keeps the
// 31st in every long month: 31 Jan – 27 Feb, 28 Feb – 30 Mar, 31 Mar – 29 Apr … (2027). Example of the rule:
// start 23 Jan 2027, 11 months -> 23 Jan – 22 Feb, 23 Feb – 22 Mar, …, 23 Nov – 22 Dec; move-out 23 Dec.
import { dayNumber, fmtISO, fromDayNumber, monthAnchor, parseDate } from './dates.js';

// Same half-away-from-zero rounding with an absolute EPSILON nudge as expr.js roundP, with the same weakness
// (fails for some values above magnitude ~4, e.g. 4.015 -> 4.01). Here it is applied to prorated amounts.
const roundTo = (x, p) => { const f = 10 ** p; return Math.round((x + Math.sign(x) * Number.EPSILON) * f) / f; };

export function billingSchedule(o = {}) {
  const out = { ok: false, start: '', end: '', last: '', months: 0, periods: [], total: 0, count: 0, partialCount: 0, issues: [] };
  const S = parseDate(o.start);
  if (!S) { out.issues.push('start'); return out; }
  const amount = Number.isFinite(+o.amount) && o.amount !== '' && o.amount != null ? +o.amount : 0;
  const places = Number.isInteger(o.round) && o.round >= 0 && o.round <= 4 ? o.round : 2;
  const D = Number.isInteger(+o.anchorDay) && +o.anchorDay >= 1 && +o.anchorDay <= 31 ? +o.anchorDay : S.d;
  // Every loop below is bounded by `max` periods (default 600 = 50 years): a typo like months = 1e9 must not hang
  // the page. Overflow is reported as the 'long' issue instead of silently truncating.
  const max = Number.isInteger(o.max) && o.max > 0 ? Math.min(o.max, 1200) : 600;
  const s = dayNumber(S);
  let e;
  const E = parseDate(o.end);
  if (E) e = dayNumber(E);
  else if (Number.isFinite(+o.months) && +o.months > 0) e = dayNumber(monthAnchor(S.y, S.m, Math.min(Math.trunc(+o.months), max), S.d));
  else { out.issues.push('term'); return out; }
  if (e <= s) { out.issues.push('order'); return out; }
  const due = Number.isFinite(+o.dueOffset) ? Math.trunc(+o.dueOffset) : 0;
  // Day numbers (integers) for all comparisons: half-open intervals [from, stop) in days, so `days = stop - from`
  // needs no +1 and adjacent periods never overlap or leave gaps.
  const anchor = (k) => dayNumber(monthAnchor(S.y, S.m, k, D));
  // The first anchor strictly after the start; the anchor before it opens the (possibly partial) first period.
  let k = anchor(0) <= s ? 1 : 0;
  while (anchor(k) <= s) k++;
  let from = s;
  while (from < e && out.periods.length < max) {
    const next = anchor(k);
    const stop = Math.min(next, e);
    // A partial period is prorated against the length of the FULL period it belongs to (28..31 days), not a fixed
    // 30: the common legal reading, and it makes a partial month of full length cost exactly the full amount.
    const fullDays = next - anchor(k - 1);
    const days = stop - from;
    const partial = days < fullDays;
    const sum = partial && o.prorata ? roundTo(amount * days / fullDays, places) : roundTo(amount, places);
    out.periods.push({
      n: out.periods.length + 1, from: fmtISO(fromDayNumber(from)), to: fmtISO(fromDayNumber(stop - 1)),
      days, fullDays, partial, amount: sum, due: fmtISO(fromDayNumber(from + due)),
    });
    if (partial) out.partialCount++;
    from = stop;
    k++;
  }
  if (from < e) out.issues.push('long');
  out.ok = out.periods.length > 0;
  out.start = fmtISO(S);
  out.end = fmtISO(fromDayNumber(e));
  out.last = fmtISO(fromDayNumber(e - 1));
  out.count = out.periods.length;
  out.months = out.count - out.partialCount;
  // Total is the sum of rounded period amounts (what is actually paid), not amount * months; rounding the sum again
  // only removes float noise from the additions.
  out.total = roundTo(out.periods.reduce((a, p) => a + p.amount, 0), places);
  return out;
}

// The term of a lease (a `period` field): { start, months | end } -> { start, end, last, months, days } with the
// same rules (end = start + months, clamped; last = end - 1); null when it cannot be computed.
export function termOf(v) {
  if (!v || typeof v !== 'object') return null;
  const S = parseDate(v.start);
  if (!S) return null;
  const s = dayNumber(S);
  let e;
  const E = parseDate(v.end);
  if (E) e = dayNumber(E);
  else if (Number.isFinite(+v.months) && +v.months > 0 && +v.months <= 1200) e = dayNumber(monthAnchor(S.y, S.m, Math.trunc(+v.months), S.d));
  else return null;
  if (e <= s) return null;
  // Whole months between start and end (an end that is not on an anchor leaves a remainder of days).
  // Linear count from start (<= 1200 steps), always re-anchored on the start day, never chained: avoids the 31st
  // drifting to the 28th after February.
  let months = 0;
  while (months < 1200 && dayNumber(monthAnchor(S.y, S.m, months + 1, S.d)) <= e) months++;
  const rest = e - dayNumber(monthAnchor(S.y, S.m, months, S.d));
  return { start: fmtISO(S), end: fmtISO(fromDayNumber(e)), last: fmtISO(fromDayNumber(e - 1)), months, restDays: rest, days: e - s };
}
