// ledger/kpi.js - what a period of a rented property looks like: bookings, nights inside the period, occupancy, ADR
// and RevPAR, revenue and the owner's money per currency; the "pay out everything due" plan; a building expense split
// across flats by area, share or equally; the owner key that joins one owner's parties over several properties.
//
// Two truths are kept apart and both are named: REVENUE and shares belong to the period of the CHECK-IN day (that is
// how the journal accrues them, so the report agrees with the journal to the unit), while NIGHTS, occupancy, ADR and
// RevPAR count the nights INSIDE the period (a stay 29.09-03.10 gives September two nights and the revenue of those
// two nights, spread evenly over the stay's nights without losing a unit).
//
//   stay = { id, from, to, status?, currency, total, surplus? }   minor units; status '' / 'confirmed' counts,
//          'pending' is counted as pending, anything else ('cancelled') is ignored
//   op   = journal op (journal.js) with `voided` or within a journal whose reversals are resolved here
//   periodKpis(stays, ops, { period, owners, agency, units }) -> { period, days, available, bookings, nights,
//          occupancy (permille, -1 for an open period), pending, currencies: [{ currency, gross, surplus, nightRevenue,
//          nights, adr, revpar, agency, ownerAccrued, ownerDeducted, ownerPaid, ownerNet, expenses }] }
//   occupancyText(permille, lang) -> '63.3 %' | '—'
//   nightShare(total, nights, i0, i1) -> the part of `total` that falls on nights i0..i1-1 of an even spread
//   payoutPlan(due, only?) -> [{ currency, amount }]           one payout per currency with a positive balance
//   payoutOps(plan, { partyId, day, note, article }) -> raw ops for appendOps
//   splitExpense(total, units, { by: 'area' | 'share' | 'equal' }) -> [{ id, amount }]
//   ownerKey({ ref, name, erased }) -> 'r:<ref>' | 'n:<name>' | ''

import { allocate, cleanCurrency, mulDiv } from './minor.js';
import { reversedIds } from './journal.js';
import { cleanId } from './parties.js';
import { clipNights, dayNum, inPeriod, isIsoDay, periodDays } from './period.js';

const asSet = (v) => new Set([...(v instanceof Set ? v : Array.isArray(v) ? v : [])].map(String));
const counted = (s) => s.status == null || s.status === '' || s.status === 'confirmed';

// Part of an even spread of `total` over `nights` nights that falls on nights i0..i1-1. The spread is the largest
// remainder of equal weights: the first (total mod nights) nights carry one unit more.
// Closed form instead of calling allocate() and summing a slice: O(1) per stay, and by construction the shares of
// the period slices of one stay add up to its total (the same largest-remainder spread is used for every slice).
export function nightShare(total, nights, i0, i1) {
  const t = Math.trunc(Number(total)) || 0;
  const n = Math.trunc(Number(nights)) || 0;
  if (n <= 0) return 0;
  const a = Math.max(0, Math.min(n, i0)), b = Math.max(a, Math.min(n, i1));
  if (t < 0) return -nightShare(-t, n, a, b);
  const base = Math.floor(t / n), extra = t - base * n;
  return base * (b - a) + Math.max(0, Math.min(extra, b) - a);
}

// Integer ratios everywhere: occupancy in per-mille and ADR / RevPAR through mulDiv, so a KPI is a reproducible
// integer (two machines print the same number). Occupancy is capped at 1000 because overlapping stays typed by hand
// can exceed availability - an honest "full" beats "112 %". Every deduction counts as an expense of the property;
// the owner's columns count only the owners' parties. Voided ops are skipped both by flag and by reversal pairs, so
// either input form works.
export function periodKpis(stays, ops, { period, owners = [], agency = [], units = 1 } = {}) {
  const p = period || { from: '', to: '' };
  const days = periodDays(p);
  const available = days * Math.max(1, Math.trunc(units) || 1);
  const own = asSet(owners), agn = asSet(agency);
  const cur = new Map();
  const row = (c) => {
    const k = cleanCurrency(c);
    if (!cur.has(k)) cur.set(k, { currency: k, gross: 0, surplus: 0, nightRevenue: 0, nights: 0, adr: 0, revpar: 0, agency: 0, ownerAccrued: 0, ownerDeducted: 0, ownerPaid: 0, ownerNet: 0, expenses: 0 });
    return cur.get(k);
  };
  let bookings = 0, nights = 0, pending = 0;
  for (const s of stays || []) {
    if (!s || !isIsoDay(s.from) || !isIsoDay(s.to)) continue;
    if (s.status === 'pending') { if (inPeriod(s.from, p)) pending++; continue; }
    if (!counted(s)) continue;
    const n = clipNights(s.from, s.to, p);
    const total = Math.max(0, Math.trunc(s.total) || 0);
    if (n > 0) {
      nights += n;
      const r = row(s.currency);
      r.nights += n;
      const all = dayNum(s.to) - dayNum(s.from);
      const i0 = p.from ? Math.max(0, dayNum(p.from) - dayNum(s.from)) : 0;
      r.nightRevenue += nightShare(total, all, i0, i0 + n);
    }
    if (!inPeriod(s.from, p)) continue;
    bookings++;
    const r = row(s.currency);
    r.gross += total;
    r.surplus += Math.max(0, Math.trunc(s.surplus) || 0);
  }
  const dead = reversedIds(ops);
  for (const x of ops || []) {
    if (!x || x.voided || dead.has(String(x.id)) || !inPeriod(x.day, p)) continue;
    const r = row(x.currency);
    const amt = Math.abs(Math.trunc(x.amount) || 0);
    const isOwner = own.has(String(x.partyId)), isAgency = agn.has(String(x.partyId));
    if (x.kind === 'accrual') { if (isOwner) r.ownerAccrued += amt; if (isAgency) r.agency += amt; }
    else if (x.kind === 'deduction') { r.expenses += amt; if (isOwner) r.ownerDeducted += amt; }
    else if (x.kind === 'payout' && isOwner) r.ownerPaid += amt;
  }
  for (const r of cur.values()) {
    r.ownerNet = r.ownerAccrued - r.ownerDeducted - r.ownerPaid;
    r.adr = r.nights ? mulDiv(r.nightRevenue, 1, r.nights) : 0;
    r.revpar = available ? mulDiv(r.nightRevenue, 1, available) : 0;
  }
  return {
    period: p, days, available, bookings, nights,
    occupancy: available > 0 ? Math.min(1000, mulDiv(nights, 1000, available)) : -1,
    pending,
    currencies: [...cur.values()].filter((r) => r.currency).sort((a, b) => a.currency.localeCompare(b.currency)),
  };
}

export function occupancyText(permille, lang = 'en') {
  if (!(permille >= 0)) return '—';
  const l = String(lang || 'en').slice(0, 2);
  const loc = l === 'ru' ? 'ru-RU' : l === 'ka' ? 'ka-GE' : 'en-US';
  return (permille / 10).toLocaleString(loc, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %';
}

/**
 * "Pay out everything due": one payout per currency with a POSITIVE balance. A negative balance (the owner owes) is a
 * debt, and paying it the other way round is a person's decision, not a button. `due` is a Map or an object
 * (dueByCurrency of journal.js); `only` keeps one currency.
 */
export function payoutPlan(due, only = '') {
  const entries = due instanceof Map ? [...due] : Object.entries(due || {});
  const want = cleanCurrency(only);
  return entries
    .map(([c, v]) => ({ currency: cleanCurrency(c), amount: Math.trunc(Number(v)) || 0 }))
    .filter((x) => x.currency && x.amount > 0 && (!want || x.currency === want))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

// A payout is a journal operation, not a "paid" flag: a wrong payout is reversed and both lines stay visible.
export function payoutOps(plan, { partyId, day, note = '', article = '' } = {}) {
  const pid = cleanId(partyId);
  if (pid == null || !isIsoDay(day)) return [];
  return (plan || []).map((x) => ({ kind: 'payout', day, partyId: pid, article, amount: x.amount, currency: x.currency, ref: '', note }));
}

/**
 * A building expense split across flats: by `area` (m²), by `share` (any weights: ownership fractions, meters) or
 * `equal`. Largest remainder, so the parts always sum to the total. Units without a positive weight get 0 unless all
 * of them have none (then equally).
 */
export function splitExpense(total, units, { by = 'area' } = {}) {
  const list = (units || []).filter(Boolean);
  const weights = list.map((u) => (by === 'equal' ? 1 : Number(by === 'share' ? u.share : u.area)));
  return allocate(total, weights).map((amount, i) => ({ id: list[i].id, amount }));
}

/**
 * The key that joins one owner over several properties: the account ref ('r:<ref>') or the outside name without case
 * and extra spaces ('n:<name>'). An erased party gives no key: gathering everybody erased under one blank name would
 * merge them into one person.
 */
export function ownerKey(p) {
  if (!p || p.erased) return '';
  const ref = String(p.ref || '').trim();
  if (ref) return 'r:' + ref;
  const nm = String(p.name || '').trim().replace(/\s+/g, ' ').toLowerCase();
  return nm ? 'n:' + nm.slice(0, 120) : '';
}

