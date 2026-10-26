// stock/batches.js - batches with expiry dates: FEFO (first expired, first out) and FIFO consumption, customer
// returns into the latest-expiring batch, receipts merged by batch number + expiry, transfers that carry the
// consumed batches to the receiver, days left, batch states, markdown rules ("N days left -> P %"), markdown prices
// and write-off of expired stock. Immutable: every operation returns new arrays.
//
// batch: { batch, expires: 'YYYY-MM-DD' | null, qty, received?: 'YYYY-MM-DD' | number (order of arrival), id? }

import { daysBetween } from './calendar.js';

const EPS = 1e-9;
const q6 = (x) => Math.round(x * 1e6) / 1e6;
// null sorts last (a batch without expiry is consumed after every dated batch). Date strings compare correctly as
// text because they are fixed-width ISO days.
const cmp = (a, b) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : a < b ? -1 : a > b ? 1 : 0);

// FEFO: nearest expiry first (no expiry last), then the earliest receipt. FIFO: earliest receipt, then expiry.
export const fefoOrder = (x, y) => cmp(x.expires, y.expires) || cmp(x.received, y.received);
export const fifoOrder = (x, y) => cmp(x.received, y.received) || cmp(x.expires, y.expires);

/**
 * Takes `qty` from the batches in FEFO (default) or FIFO order.
 * -> { batches (emptied ones removed), taken: [{ batch, expires, received, qty, id? }], short } where `short` is
 * the part no batch covered (stock kept without batches, or an oversell the caller decides about).
 */
// Quantities are rounded to 6 decimals after each subtraction so weight goods (0.1 + 0.2 kg) do not leave
// 1e-17 ghosts that would keep empty batches alive.
export function consume(batches, qty, { order = 'fefo' } = {}) {
  const sorted = [...batches].sort(order === 'fifo' ? fifoOrder : fefoOrder);
  const taken = [];
  let left = qty;
  const rest = [];
  for (const b of sorted) {
    if (left > EPS && b.qty > EPS) {
      const take = Math.min(left, b.qty);
      taken.push({ ...b, qty: q6(take) });
      left = q6(left - take);
      if (b.qty - take > EPS) rest.push({ ...b, qty: q6(b.qty - take) });
    } else if (b.qty > EPS) rest.push(b);
  }
  return { batches: rest, taken, short: left > EPS ? left : 0 };
}

export const consumeFefo = (batches, qty) => consume(batches, qty, { order: 'fefo' });
export const consumeFifo = (batches, qty) => consume(batches, qty, { order: 'fifo' });

// A receipt: merged into the batch with the same number and expiry, else appended.
export function addBatch(batches, b) {
  const i = batches.findIndex((x) => x.batch === b.batch && (x.expires ?? null) === (b.expires ?? null));
  if (i < 0) return [...batches, { ...b, qty: q6(b.qty) }];
  return batches.map((x, k) => (k === i ? { ...x, qty: q6(x.qty + b.qty) } : x));
}

export const mergeBatches = (batches, incoming) => incoming.reduce(addBatch, batches);

// A customer return goes into the batch with the latest expiry (fresh goods come back mostly from the last
// delivery; a batch without expiry counts as the latest). Without batches nothing is placed: -> { batches, placed: batch | null }.
export function restoreLatest(batches, qty) {
  if (!batches.length) return { batches, placed: null };
  let best = 0;
  for (let i = 1; i < batches.length; i++) if (cmp(batches[i].expires, batches[best].expires) > 0) best = i;
  return { batches: batches.map((x, k) => (k === best ? { ...x, qty: q6(x.qty + qty) } : x)), placed: batches[best].batch };
}

// A transfer: the sender gives its FEFO batches, the receiver merges them. -> { from, to, moved, short }
export function transferBatches(from, to, qty, opts) {
  const c = consume(from, qty, opts);
  return { from: c.batches, to: mergeBatches(to, c.taken.map(({ id, ...b }) => b)), moved: c.taken, short: c.short };
}

export const daysLeft = (expires, today) => (expires ? daysBetween(today, expires) : null);

// 'expired' (past its day), 'expiring' (≤ warnDays left), 'ok'; null without expiry.
export function batchState(expires, today, warnDays = 3) {
  const left = daysLeft(expires, today);
  if (left == null) return null;
  return left < 0 ? 'expired' : left <= warnDays ? 'expiring' : 'ok';
}

export const MARKDOWN_DEFAULTS = [{ days: 3, pct: 20 }, { days: 1, pct: 50 }];

// The rule for `left` days: the one with the fewest days that still covers it ("1 day left" beats "3 days left").
export function markdownRule(left, rules = MARKDOWN_DEFAULTS) {
  if (left == null || left < 0) return null;
  return [...rules].sort((x, y) => x.days - y.days).find((r) => left <= r.days) ?? null;
}

/**
 * Markdown of an item by its nearest-expiring batch in stock: { batch, expires, daysLeft, pct, expired? } | null.
 * Expired stock is not sold at a markdown (pct 0, expired true): it must be written off.
 */
export function markdownFor(batches, rules, today) {
  const b = batches.filter((x) => x.qty > EPS && x.expires).sort(fefoOrder)[0];
  if (!b) return null;
  const left = daysLeft(b.expires, today);
  if (left < 0) return { batch: b.batch, expires: b.expires, daysLeft: left, pct: 0, expired: true };
  const rule = markdownRule(left, rules);
  return rule ? { batch: b.batch, expires: b.expires, daysLeft: left, pct: rule.pct } : null;
}

// Price after a percentage markdown, in minor units, rounded half up (pct may have decimals: 12.5).
// Integer arithmetic with the percentage scaled to 1e-4 %: exact for prices up to about 9e9 minor units; beyond that
// price x 1e6 exceeds 2^53 and the last digit can be wrong.
export function markdownPrice(price, pct) {
  if (!pct) return price;
  const scaled = Math.round(pct * 10000);
  const v = price * (1_000_000 - scaled);
  return Math.sign(v) * Math.round(Math.abs(v) / 1_000_000);
}

// Removes expired batches: -> { batches, written: [batch], qty }
export function writeOffExpired(batches, today) {
  const written = batches.filter((b) => b.qty > EPS && b.expires && daysLeft(b.expires, today) < 0);
  return { batches: batches.filter((b) => !written.includes(b)), written, qty: q6(written.reduce((t, b) => t + b.qty, 0)) };
}

// Totals by state for an overview: { ok, expiring, expired, none } quantities.
export function expirySummary(batches, today, warnDays = 3) {
  const s = { ok: 0, expiring: 0, expired: 0, none: 0 };
  for (const b of batches) {
    const k = batchState(b.expires, today, warnDays) ?? 'none';
    s[k] = q6(s[k] + b.qty);
  }
  return s;
}
