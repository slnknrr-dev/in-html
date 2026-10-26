// receipt/loyalty.js - a points loyalty programme: whole points worth `pointValue` minor units each, earning
// earnPct % of what was paid with money (never of the part paid with points), spending up to maxSpendPct % of a
// check and never more than the balance, the points ledger with balances after each transaction, card numbers with
// an EAN-13 check digit, purchase statistics over a window, segments (new / vip / sleeping / regular / active) and
// RFM scores 1..5 by quintiles. Days as 'YYYY-MM-DD'; the caller passes `today`.

// Whole days from a to b ('YYYY-MM-DD'), on UTC day numbers.
const dayNo = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000;
export const daysBetween = (a, b) => dayNo(b) - dayNo(a);

export const LOYALTY_DEFAULTS = { earnPct: 5, pointValue: 100, maxSpendPct: 50, welcomePoints: 0, cardPrefix: '29', vipAmount: 100_000 };

// EAN-13 check digit of 12 digits (weights 1, 3, 1, … from the left).
export function ean13(body12) {
  const s = String(body12);
  if (!/^\d{12}$/.test(s)) throw new RangeError('12 digits expected');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += (s.charCodeAt(i) - 48) * (i % 2 ? 3 : 1);
  return s + ((10 - (sum % 10)) % 10);
}

// Card number n of a prefix: prefix + zero-padded n + check digit (13 digits, printed as a barcode on the card).
export const cardNumber = (prefix, n) => ean13(String(prefix) + String(n).padStart(12 - String(prefix).length, '0'));

// Points earned on the money part of a check (floor: a fraction of a point is never given).
// floor with a 1e-9 guard: a product that should be an exact integer but lands at 4.9999999 must still give 5.
export function pointsEarned(paid, { earnPct = LOYALTY_DEFAULTS.earnPct, pointValue = LOYALTY_DEFAULTS.pointValue, blocked = false } = {}) {
  if (blocked || !(paid > 0) || !(pointValue > 0)) return 0;
  return Math.floor((paid * earnPct) / (100 * pointValue) + 1e-9);
}

// Most points a check of `total` can take: min(balance, floor(total × maxSpendPct % ÷ pointValue)).
export function maxSpend(total, { balance = Infinity, maxSpendPct = LOYALTY_DEFAULTS.maxSpendPct, pointValue = LOYALTY_DEFAULTS.pointValue } = {}) {
  if (!(total > 0) || !(pointValue > 0)) return 0;
  return Math.max(0, Math.min(Math.floor(balance + 1e-9), Math.floor((total * maxSpendPct) / (100 * pointValue) + 1e-9)));
}

/** Why `points` cannot be spent, or null: 'points_whole', 'card_blocked', 'not_enough_points', 'points_limit'. */
export function checkSpend(points, total, { balance = 0, blocked = false, ...settings } = {}) {
  if (!points) return null;
  if (!Number.isInteger(points) || points < 0) return 'points_whole';
  if (blocked) return 'card_blocked';
  if (points > balance) return 'not_enough_points';
  if (points > maxSpend(total, { ...settings, balance })) return 'points_limit';
  return null;
}

/**
 * The points ledger. txs in order: [{ kind: 'welcome' | 'earn' | 'spend' | 'reverse' | 'refund' | 'adjust' |
 * 'expire', points (signed), ... }] -> { balance, history: [{ ...tx, balanceAfter }], negative: [index] } where
 * `negative` lists transactions that left the balance below zero (a reversal after the points were spent).
 */
export function pointsLedger(txs, opening = 0) {
  let balance = opening;
  const negative = [];
  const history = txs.map((t, i) => {
    balance += t.points;
    if (balance < 0) negative.push(i);
    return { ...t, balanceAfter: balance };
  });
  return { balance, history, negative };
}

// Points of a return: earned points are taken back and spent points refunded in the share of the returned amount.
export function returnPoints({ earned = 0, spent = 0, total }, returned) {
  const ratio = total > 0 ? Math.min(1, returned / total) : 0;
  return { reverse: Math.round(earned * ratio), refund: Math.round(spent * ratio) };
}

/** Purchases [{ day, amount }] -> { count, amount, last } over the `window` days ending on today (inclusive). */
export function customerStats(purchases, today, window = 90) {
  let count = 0, amount = 0, last = null;
  for (const p of purchases) {
    if (!last || p.day > last) last = p.day;
    const age = daysBetween(p.day, today);
    if (age >= 0 && age < window) { count++; amount += p.amount; }
  }
  return { count, amount, last };
}

/**
 * Segment of a customer: 'new' (joined < 30 days ago with at most one purchase), 'vip' (window amount ≥
 * vipAmount), 'sleeping' (no purchase in 90 days), 'regular' (3+ purchases), else 'active'.
 * customer: { joined: day }, stats: customerStats(…).
 */
export function segmentOf(customer, stats, today, vipAmount = LOYALTY_DEFAULTS.vipAmount) {
  if (customer.joined && daysBetween(customer.joined, today) < 30 && stats.count <= 1) return 'new';
  if (stats.amount >= vipAmount) return 'vip';
  if (!stats.last || daysBetween(stats.last, today) > 90) return 'sleeping';
  if (stats.count >= 3) return 'regular';
  return 'active';
}

/**
 * RFM scores by quintiles across customers: [{ id, last, count, amount }] -> [{ id, r, f, m, rfm: '545' }].
 * Recency: more recent is better (no purchase scores 1); ties share the lower score.
 */
// Rank-based quintiles ("how many are strictly worse"), so ties share a score and the result does not depend on input
// order. The linear scan per value makes this O(n^2) in the worst case; fine for shop-sized customer lists.
export function rfmScores(customers, today) {
  const n = customers.length;
  // Score = 1 + floor(5 × (customers with a strictly worse value) ÷ n); a single customer scores 3.
  const score = (vals) => {
    const sorted = [...vals].sort((a, b) => a - b);
    return vals.map((v) => {
      let below = 0;
      while (below < n && sorted[below] < v) below++;
      return n > 1 ? 1 + Math.floor((below * 5) / n) : 3;
    });
  };
  const r = score(customers.map((c) => (c.last ? -daysBetween(c.last, today) : -Infinity)));
  const f = score(customers.map((c) => c.count ?? 0)), m = score(customers.map((c) => c.amount ?? 0));
  return customers.map((c, i) => ({ id: c.id, r: c.last ? r[i] : 1, f: f[i], m: m[i], rfm: `${c.last ? r[i] : 1}${f[i]}${m[i]}` }));
}
