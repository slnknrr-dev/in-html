// booking/rates.js - the price calendar of a short-let and the quote of a stay. The calendar is a list of RULES on
// intervals (seasons with their own price and minimum stay, closed periods), not 365 prices a year: "raise all of
// August" stays one edit. The rate of every night is chosen separately (base -> weekday rate -> season), and only then
// the length-of-stay discount applies to the sum: average price x nights is wrong for every stay that crosses a season
// boundary, and those are the most expensive stays of the year. Money is integer minor units (payments/money.js
// converts and formats), so sums never drift.
//
//   CAL_KINDS = ['price', 'block']   normalizeCalRule(raw) -> { kind, from, to, price?, minNights?, weekdays?, id?, note? } | null
//   blockedStays(rules)   MONTH_NIGHTS = 30   WEEK_NIGHTS = 7   baseNightly(price, per)
//   nightlyRate(day, base, rules, weekdayRates?) -> { day, price, rule: 'base' | 'weekday' | 'season', ruleId? }
//   minNightsFor(day, lotMin, rules)   lengthDiscountPct(nights, discounts)   feeAmount(fee, nights, guests)
//   priceCalendar(month, opts) -> [{ day, price, rule, ruleId?, minNights, blocked }]
//   QUOTE_ERRORS, QUOTE_ERROR_TEXT   quoteStay(input) -> StayQuote   prepayment(total, pct) -> { now, later }

import { dayAdd, dayNum, daysInMonth, eachDay, isDay, monthStart, nightsBetween, weekday } from './days.js';
import { blockingStays, stayConflicts, stayOk } from './stays.js';

export const CAL_KINDS = ['price', 'block'];
export const CAL_KIND_LABEL = { price: 'Price for a period', block: 'Closed' };

const num0 = (v) => {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Normalises a calendar rule; null for garbage (garbage in a calendar becomes a price on a screen one day).
 *   { kind: 'price' | 'block', from, to, price (minor units, price rules only), minNights?, weekdays?, id?, note? }
 * A reversed interval is SWAPPED (a typo; losing the season is worse than reading it right), a zero-night interval is
 * dropped (it covers no night and would silently do nothing). An empty price drops a price rule, while 0 is a legal
 * price ("free nights" promotion). `weekdays` (0 = Monday … 6 = Sunday) limits a price rule to those nights, e.g. a
 * summer weekend rate on top of the summer rate.
 */
export function normalizeCalRule(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const kind = CAL_KINDS.includes(String(r.kind)) ? String(r.kind) : null;
  if (!kind) return null;
  let from = String(r.from ?? '').slice(0, 10);
  let to = String(r.to ?? '').slice(0, 10);
  if (!isDay(from) || !isDay(to)) return null;
  if (dayNum(from) > dayNum(to)) [from, to] = [to, from];
  if (nightsBetween(from, to) < 1) return null;
  const out = { kind, from, to };
  if (r.id !== undefined && Number.isFinite(Number(r.id))) out.id = Number(r.id);
  if (kind === 'price') {
    if (String(r.price ?? '').trim() === '') return null;
    out.price = Math.round(num0(r.price));
    const mn = Math.trunc(num0(r.minNights));
    if (mn > 0) out.minNights = mn;
    if (Array.isArray(r.weekdays)) {
      const wd = [...new Set(r.weekdays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
      if (wd.length && wd.length < 7) out.weekdays = wd;
    }
  }
  const note = String(r.note ?? '').trim().slice(0, 200);
  if (note) out.note = note;
  return out;
}

// Owner-closed intervals as stays, so occupancy is computed by one piece of code.
export const blockedStays = (rules) => (rules || []).filter((r) => r && r.kind === 'block').map((r) => ({ from: r.from, to: r.to }));

// A month is 30 nights when a monthly price becomes a nightly one: otherwise the same flat would cost 7 % more per
// night in February than in March. Hosts count the same way.
export const MONTH_NIGHTS = 30;
export const WEEK_NIGHTS = 7;

// Nightly rate (minor units, rounded) from a base price per 'day' (default), 'week' or 'month'.
export function baseNightly(price, per) {
  const p = Number(price) || 0;
  return Math.round(per === 'month' ? p / MONTH_NIGHTS : per === 'week' ? p / WEEK_NIGHTS : p);
}

// Half-open [from, to) like stays: a rule "1-31 August" written as from 08-01 to 09-01 covers exactly August's nights.
// dayNum is recomputed per call; for a month view (~30 days x a handful of rules) that is cheaper than caching.
const covers = (r, n) => n >= dayNum(r.from) && n < dayNum(r.to);
const onWeekday = (r, day) => !r.weekdays || r.weekdays.includes(weekday(day));

/**
 * The rate of ONE night. Cascade: the base rate -> the weekday rate (weekdayRates: { 4: 9000, 5: 9000 } for Friday and
 * Saturday nights) -> the price rule covering the night. With several rules the LAST matching one in list order wins,
 * not the narrowest: the owner sees the order and can change it, nobody should compare interval lengths in their
 * head to predict a price ("summer" first, then "first week of August, even higher").
 */
export function nightlyRate(day, base, rules, weekdayRates) {
  let out = { day, price: base, rule: 'base' };
  const wr = weekdayRates && weekdayRates[weekday(day)];
  if (wr !== undefined && wr !== null && Number.isFinite(Number(wr))) out = { day, price: Math.round(Number(wr)), rule: 'weekday' };
  const n = dayNum(day);
  for (const r of rules || []) {
    if (!r || r.kind !== 'price' || r.price === undefined) continue;
    if (covers(r, n) && onWeekday(r, day)) out = { day, price: r.price, rule: 'season', ...(r.id !== undefined ? { ruleId: r.id } : {}) };
  }
  return out;
}

/**
 * Minimum stay for an arrival on `day`: the season of the ARRIVAL day overrides the listing's own minimum (not the
 * maximum over all touched seasons). That is the hotel-market rule ("5 nights minimum over New Year" means "when you
 * arrive over New Year"), and the only one a guest can check by looking at the calendar.
 */
export function minNightsFor(day, lotMin, rules) {
  const n = dayNum(day);
  let out = Math.max(0, Math.trunc(lotMin || 0));
  for (const r of rules || []) {
    if (!r || r.kind !== 'price' || !r.minNights) continue;
    if (covers(r, n) && onWeekday(r, day)) out = r.minNights;
  }
  return out;
}

/**
 * Length-of-stay discount: "from N nights, minus P %". The LONGEST matching threshold wins wherever it stands in the
 * list (a monthly discount must not lose to a weekly one that happens to come first); capped at 90 %.
 */
export function lengthDiscountPct(nights, list) {
  let bestN = 0, pct = 0;
  for (const d of list || []) {
    const n = Math.trunc(Number(d?.nights) || 0);
    const p = Number(d?.pct) || 0;
    if (n > 0 && p > 0 && nights >= n && n >= bestN) { bestN = n; pct = Math.min(90, p); }
  }
  return pct;
}

export const FEE_PER = ['stay', 'night', 'guest', 'guest_night'];

/**
 * Amount of one fee { name, amount, per, after } for a stay: per 'stay' (cleaning), 'night', 'guest' or
 * 'guest_night' (a tourist tax). `after` = guests included before a per-guest fee starts (extra-guest fee).
 */
export function feeAmount(fee, nights, guests = 1) {
  const a = Math.round(Number(fee?.amount) || 0);
  if (a <= 0) return 0;
  const g = Math.max(0, Math.trunc(Number(guests) || 1) - Math.max(0, Math.trunc(Number(fee?.after) || 0)));
  switch (fee?.per) {
    case 'night': return a * nights;
    case 'guest': return a * g;
    case 'guest_night': return a * g * nights;
    default: return a;
  }
}

/**
 * The price calendar of a month for the owner's and the guest's view: the nightly rate, where it comes from, the
 * minimum stay of an arrival that day and whether the owner closed the day.
 * opts: { base, per, rules, weekdayRates, minNights }
 */
export function priceCalendar(month, { base = 0, per, rules = [], weekdayRates, minNights = 0 } = {}) {
  const first = monthStart(month);
  const n = daysInMonth(month);
  const b = baseNightly(base, per);
  const closed = blockedStays(rules);
  const out = [];
  for (let i = 0; i < n; i++) {
    const day = dayAdd(first, i), d = dayNum(day);
    out.push({
      ...nightlyRate(day, b, rules, weekdayRates),
      minNights: minNightsFor(day, minNights, rules),
      blocked: closed.some((s) => d >= dayNum(s.from) && d < dayNum(s.to)),
    });
  }
  return out;
}

export const QUOTE_ERRORS = ['bad_range', 'past', 'too_short', 'too_long', 'guests', 'blocked', 'busy', 'no_price'];
export const QUOTE_ERROR_TEXT = {
  bad_range: 'Choose the arrival and the departure dates',
  past: 'These dates have passed',
  too_short: 'The stay is too short',
  too_long: 'The stay is too long',
  guests: 'Too many guests',
  blocked: 'The host closed these dates',
  busy: 'These dates are already booked',
  no_price: 'The listing has no rental price',
};

/**
 * Quote of a stay - the ONE place where a booking price is computed (two places would drift apart silently).
 *
 * input: { from, to, base, per?: 'day' | 'week' | 'month', currency?, rules?, weekdayRates?, busy? (stays or bookings;
 *   only confirmed ones block), today?, minNights?, maxNights? (0 = unlimited), guests?, guestsMax?, discounts?:
 *   [{ nights, pct }], cleaning? (minor units per stay), fees?: [{ name, amount, per, after }], deposit? }
 *
 * -> { ok, error?, nights, currency, nightly: [{ day, price, rule, ruleId? }], subtotal, discountPct, discount,
 *      fees: [{ name, amount }], feesTotal, total, deposit, minNights, conflicts }
 *
 * Checks run in the order "what the person can fix": the interval shape, the past, the length, guests, and only then
 * occupancy - otherwise a guest who mis-clicked would read "dates taken" instead of "choose the dates". Closed by the
 * host and booked are different refusals: "closed" makes a guest leave, "booked" makes them move the dates. Fees are
 * added after the discount (a cleaning does not get cheaper for a long stay). The refusal still carries nights and
 * the minimum, so the form can say why.
 */
export function quoteStay(o) {
  const currency = String(o.currency || 'USD');
  const empty = {
    ok: false, nights: 0, currency, nightly: [], subtotal: 0, discountPct: 0, discount: 0,
    fees: [], feesTotal: 0, total: 0, deposit: 0, minNights: 0, conflicts: [],
  };
  const stay = { from: String(o.from || ''), to: String(o.to || '') };
  if (!stayOk(stay)) return { ...empty, error: 'bad_range' };

  const nights = nightsBetween(stay.from, stay.to);
  const rules = (o.rules || []).filter(Boolean);
  const minN = minNightsFor(stay.from, o.minNights || 0, rules);
  const withN = { ...empty, nights, minNights: minN };

  if (o.today && isDay(o.today) && dayNum(stay.from) < dayNum(o.today)) return { ...withN, error: 'past' };
  if (minN && nights < minN) return { ...withN, error: 'too_short' };
  const maxN = Math.trunc(o.maxNights || 0);
  if (maxN > 0 && nights > maxN) return { ...withN, error: 'too_long' };
  if (o.guestsMax && o.guests && o.guests > o.guestsMax) return { ...withN, error: 'guests' };

  const blocked = stayConflicts(stay, blockedStays(rules));
  if (blocked.length) return { ...withN, error: 'blocked', conflicts: blocked };
  const taken = stayConflicts(stay, blockingStays(o.busy || []));
  if (taken.length) return { ...withN, error: 'busy', conflicts: taken };

  const base = baseNightly(o.base, o.per);
  const nightly = eachDay(stay.from, stay.to).map((d) => nightlyRate(d, base, rules, o.weekdayRates));
  // "No price" = neither a base nor a season rate: "price on request" is legal, but then there is nothing to count,
  // and the form must say so instead of showing 0.
  if (!nightly.some((n) => n.price > 0)) return { ...withN, error: 'no_price' };

  // One rounding for the discount, applied to the integer subtotal (not per night): per-night rounding of a
  // percentage would drift by up to one unit per night.
  const subtotal = nightly.reduce((s, n) => s + n.price, 0);
  const discountPct = lengthDiscountPct(nights, o.discounts || []);
  const discount = Math.round(subtotal * discountPct / 100);
  const guests = Math.max(1, Math.trunc(Number(o.guests) || 1));
  const feeList = [...(o.cleaning ? [{ name: 'cleaning', amount: o.cleaning, per: 'stay' }] : []), ...(o.fees || [])];
  const fees = feeList.map((f) => ({ name: String(f.name || ''), amount: feeAmount(f, nights, guests) })).filter((f) => f.amount > 0);
  const feesTotal = fees.reduce((s, f) => s + f.amount, 0);
  return {
    ok: true, nights, currency, nightly, subtotal, discountPct, discount, fees, feesTotal,
    total: subtotal - discount + feesTotal, deposit: Math.max(0, Math.round(Number(o.deposit) || 0)),
    minNights: minN, conflicts: [],
  };
}

// Prepayment split of a total (minor units): pct % now (rounded), the rest on arrival.
export function prepayment(total, pct) {
  const t = Math.max(0, Math.round(Number(total) || 0));
  const now = Math.min(t, Math.round(t * Math.max(0, Math.min(100, Number(pct) || 0)) / 100));
  return { now, later: t - now };
}
