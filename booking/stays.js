// booking/stays.js - occupancy: stays as half-open day intervals [from, to), booking statuses (only a confirmed
// booking holds dates), overlaps and named conflicts, busy days, merged intervals and free gaps, the earliest free
// window, an occupancy calendar of a month, occupancy rates, availability facts and the "by availability" ranking of
// listings, and group departures whose seats are a number rather than yes / no.
//
// Rules that matter more than the code:
//  1. A stay is [from, to): the check-out day is free. Otherwise "until the 12th" and "from the 12th" would conflict
//     and the calendar would lose half of its turnover.
//  2. Only a CONFIRMED booking blocks dates. If pending requests did, anybody (or any bot) could freeze a competitor's
//     calendar with free requests.
//  3. Occupied seats of a departure are computed from bookings, never stored next to the departure: a stored "7 taken"
//     drifts from the bookings at the first cancellation.
//
//   BOOKING_STATUSES, BLOCKING_STATUSES, isBookingStatus, statusBlocks(status)
//   rangesOverlap(aFrom, aTo, bFrom, bTo)   stayOk(stay)   staysOverlap(a, b)   stayConflicts(want, stays)
//   blockingStays(bookings)   busyDays(stays)   mergeStays(stays)   freeGaps(stays, from, to)
//   firstFree(stays, { from, nights, until })   occupancy(stays, from, to) -> { nights, busy, free, rate }
//   occupancyCalendar(month, { bookings, blocks, today }) -> [{ day, state, checkIn, checkOut, ids }]
//   availFacts(bookings, today) -> { until, confirmed, pending }   availRank(...)   availOrder(items, { today, newDays })
//   normalizeDeparture / normalizeDepartures   departureFree   departureSoldOut   upcomingDepartures   seatsByDay

import { dayAdd, dayIso, dayNum, daysInMonth, eachDay, isDay, monthStart, nightsBetween } from './days.js';

// --- statuses ---------------------------------------------------------------------------------------------------

export const BOOKING_STATUSES = ['pending', 'confirmed', 'declined', 'cancelled'];
export const isBookingStatus = (v) => BOOKING_STATUSES.includes(String(v ?? ''));
// The statuses that hold dates (rule 2): a list, so every consumer asks the same question the same way.
export const BLOCKING_STATUSES = ['confirmed'];
export const statusBlocks = (s) => isBookingStatus(s) && BLOCKING_STATUSES.includes(s);

// --- intervals --------------------------------------------------------------------------------------------------

// Overlap of half-open intervals on any numeric axis (days for stays, minutes for viewings): touching ends do not
// overlap. One rule for both axes, so "is it taken" has a single answer.
export const rangesOverlap = (aFrom, aTo, bFrom, bTo) => aFrom < bTo && bFrom < aTo;

// A usable stay: both days exist and it has at least one night.
export const stayOk = (s) => !!s && isDay(s.from) && isDay(s.to) && nightsBetween(s.from, s.to) >= 1;

// [10, 12) and [12, 14) do not overlap; [10, 13) and [12, 14) do.
export const staysOverlap = (a, b) => rangesOverlap(dayNum(a.from), dayNum(a.to), dayNum(b.from), dayNum(b.to));

// Which stays stand in the way of the wanted dates: tell the person who blocks, not just "no".
export const stayConflicts = (want, stays) =>
  (stayOk(want) ? (stays || []).filter((s) => stayOk(s) && staysOverlap(want, s)) : []);

// The bookings that hold dates (confirmed ones, rule 2); bookings without a status count as confirmed stays.
export const blockingStays = (bookings) =>
  (bookings || []).filter((b) => stayOk(b) && (b.status === undefined || statusBlocks(b.status)));

// Occupied days for colouring a calendar, deduplicated and sorted; invalid stays are skipped.
export function busyDays(stays) {
  const set = new Set();
  for (const s of stays || []) if (stayOk(s)) for (const d of eachDay(s.from, s.to)) set.add(d);
  return [...set].sort();
}

// The union of stays as sorted, non-overlapping intervals; touching intervals ([1, 3) + [3, 5)) are joined.
// Classic sort-then-sweep interval union, O(n log n). `a <= last[1]` (not <) joins touching intervals, which is
// what makes freeGaps never report a zero-night gap between back-to-back stays.
export function mergeStays(stays) {
  const list = (stays || []).filter(stayOk).map((s) => [dayNum(s.from), dayNum(s.to)]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [a, b] of list) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out.map(([a, b]) => ({ from: dayIso(a), to: dayIso(b) }));
}

// Free intervals of [from, to) between the stays.
export function freeGaps(stays, from, to) {
  if (!stayOk({ from, to })) return [];
  const a = dayNum(from), b = dayNum(to);
  const out = [];
  let cur = a;
  for (const s of mergeStays(stays)) {
    const x = dayNum(s.from), y = dayNum(s.to);
    if (y <= cur || x >= b) continue;
    if (x > cur) out.push({ from: dayIso(cur), to: dayIso(x) });
    cur = Math.max(cur, y);
  }
  if (cur < b) out.push({ from: dayIso(cur), to: dayIso(b) });
  return out;
}

/**
 * The earliest stay of `nights` nights starting on or after `from` that conflicts with none of the stays; null when
 * none starts before `until` (default: 365 days after `from`).
 */
// The gap search window is extended by n nights past `until` so a stay STARTING just before `until` can still fit.
export function firstFree(stays, { from, nights = 1, until } = {}) {
  const n = Math.max(1, Math.trunc(nights) || 1);
  if (!isDay(from)) return null;
  const end = isDay(until) ? until : dayAdd(from, 365);
  for (const g of freeGaps(stays, from, dayAdd(end, n))) {
    if (nightsBetween(g.from, g.to) >= n && dayNum(g.from) < dayNum(end)) return { from: g.from, to: dayAdd(g.from, n) };
  }
  return null;
}

// Occupied nights of [from, to): { nights, busy, free, rate } with rate in 0..1 (0 for an empty period).
export function occupancy(stays, from, to) {
  if (!stayOk({ from, to })) return { nights: 0, busy: 0, free: 0, rate: 0 };
  const nights = nightsBetween(from, to);
  const a = dayNum(from), b = dayNum(to);
  let busy = 0;
  for (const s of mergeStays(stays)) busy += Math.max(0, Math.min(b, dayNum(s.to)) - Math.max(a, dayNum(s.from)));
  return { nights, busy, free: nights - busy, rate: busy / nights };
}

/**
 * Occupancy calendar of a month 'YYYY-MM': one cell per day,
 *   { day, state: 'free' | 'busy' | 'pending' | 'blocked' | 'past', checkIn, checkOut, ids }
 * `bookings`: [{ id?, from, to, status? }] (no status = confirmed), `blocks`: owner-closed stays, `today`: days
 * before it are 'past' (unless booked, so history stays visible). checkIn / checkOut mark the first night and the
 * day after the last night of a confirmed booking (the half-cells of a calendar). A pending request never makes a
 * day 'busy' (rule 2), it only shows as 'pending' on a free day.
 */
// State precedence (strongest first): busy > blocked > pending > free, then 'past' overrides everything except
// busy. O(days x bookings) - a month has ~30 cells and a listing a few dozen live bookings, so no interval index.
export function occupancyCalendar(month, { bookings = [], blocks = [], today = '' } = {}) {
  const first = monthStart(month);
  const n = daysInMonth(month);
  const out = [];
  if (!n) return out;
  const t = isDay(today) ? dayNum(today) : -Infinity;
  const valid = (bookings || []).filter(stayOk);
  for (let i = 0; i < n; i++) {
    const day = dayAdd(first, i), d = dayNum(day);
    const cell = { day, state: 'free', checkIn: false, checkOut: false, ids: [] };
    const covers = (s) => d >= dayNum(s.from) && d < dayNum(s.to);
    let pending = false;
    for (const b of valid) {
      if (b.status === undefined || statusBlocks(b.status)) {
        if (covers(b)) { cell.state = 'busy'; if (b.id !== undefined) cell.ids.push(b.id); }
        if (d === dayNum(b.from)) cell.checkIn = true;
        if (d === dayNum(b.to)) cell.checkOut = true;
      } else if (b.status === 'pending' && covers(b)) {
        pending = true;
        if (b.id !== undefined) cell.ids.push(b.id);
      }
    }
    if (cell.state === 'free' && (blocks || []).some((s) => stayOk(s) && covers(s))) cell.state = 'blocked';
    if (cell.state === 'free' && pending) cell.state = 'pending';
    if (d < t && cell.state !== 'busy') cell.state = 'past';
    out.push(cell);
  }
  return out;
}

// --- availability of a listing ----------------------------------------------------------------------------------

/**
 * Live booking facts of a listing on `today`: { until, confirmed, pending }. Only bookings not yet checked out
 * (to > today) count; `until` is the check-out day of a confirmed booking covering today (the listing frees up then).
 */
// Days are compared as ISO strings (valid ISO days sort chronologically), so `today` must be 'YYYY-MM-DD'.
export function availFacts(bookings, today) {
  const e = { until: '', confirmed: 0, pending: 0 };
  for (const r of bookings || []) {
    if (!(String(r.to) > today)) continue;
    if (r.status === 'pending') { e.pending++; continue; }
    if (r.status !== 'confirmed') continue;
    e.confirmed++;
    if (r.from <= today && r.to > today && (!e.until || r.to > e.until)) e.until = String(r.to);
  }
  return e;
}

/**
 * Rank of a listing in the "by availability" order: 0 new and free, 1 free, 2 frees up (`until` set), 3 busy.
 * A confirmed booking covering today (until) beats a manual "free" mark. `createdAt` and `now` are ms or ISO strings.
 */
export function availRank(state, until, createdAt, newDays, now) {
  if (until) return 2;
  if (state === 'busy') return 3;
  const t = typeof now === 'number' ? now : Date.parse(now);
  const c = typeof createdAt === 'number' ? createdAt : Date.parse(createdAt || 0);
  return t - c < newDays * 864e5 ? 0 : 1;
}

/**
 * Listings in the "by availability" order: new and free first, then free, then soon free (earliest first), then busy;
 * free and busy ones newest first. items: [{ state, bookings, createdAt }] (other fields are kept).
 */
export function availOrder(items, { today, now, newDays = 21 } = {}) {
  const at = now ?? (today + 'T12:00:00Z');
  const keyed = (items || []).map((l) => {
    const until = availFacts(l.bookings || [], today).until;
    const c = String(l.createdAt || '');
    return { l, until, c, rank: availRank(String(l.state || ''), until, c, newDays, at) };
  });
  keyed.sort((a, b) => a.rank - b.rank || (a.rank === 2 ? a.until.localeCompare(b.until) : b.c.localeCompare(a.c)));
  return keyed.map((k) => k.l);
}

// --- departures (tours: a seat is a number, not yes / no) -------------------------------------------------------
//
// A flat is taken as a whole, a tour with twelve seats is taken partly. Modelled as a stay, a tour would be sold out
// after the first booking. A past departure stays in the data (sales history), it is just not listed as upcoming.

// One departure { day, seats, price }: seats 0 = capacity not set, price 0 = the listing's price (minor units).
export function normalizeDeparture(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const day = String(r.day ?? '').slice(0, 10);
  if (!isDay(day)) return null;
  return {
    day,
    seats: Math.max(0, Math.min(999, Math.trunc(Number(r.seats) || 0))),
    price: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(Number(r.price) || 0))),
  };
}

// Departures parsed, invalid ones dropped, sorted; two departures on one day are a typing error: the LAST wins (it is
// the one the person just edited).
export function normalizeDepartures(raw) {
  const by = new Map();
  for (const x of (Array.isArray(raw) ? raw : []).slice(0, 200)) {
    const d = normalizeDeparture(x);
    if (d) by.set(d.day, d);
  }
  return [...by.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

// Seats left; `taken` comes from the caller (rule 3). No capacity (seats 0) is "not counted": null, not zero.
export function departureFree(d, taken = 0) {
  if (!d || !(d.seats > 0)) return null;
  return Math.max(0, d.seats - Math.max(0, Math.trunc(taken || 0)));
}

export const departureSoldOut = (d, taken = 0) => departureFree(d, taken) === 0;

// Upcoming departures from `today` inclusive: today's departure stays listed (whether it is too late is the seller's
// call, by the meeting time, not a date comparison).
export function upcomingDepartures(list, today, limit = 6) {
  if (!isDay(today)) return [...list].slice(0, Math.max(0, limit));
  const n = dayNum(today);
  return list.filter((d) => dayNum(d.day) >= n).slice(0, Math.max(0, limit));
}

// Seats taken per departure day from bookings [{ from, status, guests }]: guests are summed (a booking for four takes
// four seats), only blocking statuses count, and a booking belongs to the departure of its first day.
export function seatsByDay(bookings) {
  const out = new Map();
  for (const r of bookings || []) {
    if (r.status !== undefined && !statusBlocks(r.status)) continue;
    const day = String(r.from || r.day || '').slice(0, 10);
    if (!isDay(day)) continue;
    out.set(day, (out.get(day) || 0) + Math.max(1, Math.trunc(Number(r.guests) || 1)));
  }
  return out;
}
