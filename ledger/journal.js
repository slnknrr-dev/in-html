// ledger/journal.js - the immutable journal of a managed property: operations (accrual / deduction / payout, always a
// positive amount in minor units of one currency), reversals instead of edits, balances per party, statements for a
// period (opening, movements with a running balance, closing) and the owner report with totals per article. A report
// is COMPUTED from the journal every time, never stored next to it.
//
//   op = { id, day: 'YYYY-MM-DD', kind, partyId, article, amount, currency, ref, reverses, note }
//        ref: what the operation came from (a booking id), '' for a manual one; reverses: id of the reversed op or 0
//   normalizeOp(raw) -> op | null                    rejects a negative / zero amount, a bad day, a kind out of the list
//   appendOps(journal, raws) -> { ok, journal, ops, error?, index? }   new array, ids continue the journal
//   reverseOp(journal, id, { day, note }) -> { ok, journal, op, error? }   'not_found' | 'is_reversal' | 'already_reversed'
//   reversedIds(ops) -> Set                          a reversal and the op it cancels: both out of every sum
//   ledgerBalance(ops, { currency }) -> Map(partyId -> { partyId, accrued, deducted, paid, due })
//   dueByCurrency(ops, partyId) -> { GEL: 1234 }
//   currenciesOf(ops) -> ['GEL', 'USD']
//   statement(ops, partyId, { from, to, currency }) -> { rows, opening, accrued, deducted, paid, due, closing, refs, otherCurrency }
//   ownerReport(ops, partyId, opts) -> statement + { articles }
//   byArticle(rows) -> [{ article, kind, amount }]   live rows grouped by article KEY (not by its translation)

// Design: append-only event log (the accounting rule "never erase, only correct by a counter-entry"). Every function
// is pure and returns a new array, so a caller can diff, undo, or persist the journal atomically; nothing here owns
// state. Positive amounts + kind (instead of signed amounts) make the direction explicit in every row a human reads,
// and make "a negative accrual" unrepresentable.

import { MONEY_MAX, cleanCurrency } from './minor.js';
import { cleanArticle, cleanId, isLedgerKind, sameId } from './parties.js';
import { isIsoDay } from './period.js';

const amountOf = (o) => Math.abs(Math.trunc(Number(o && o.amount)) || 0);

export function normalizeOp(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  if (!isLedgerKind(o.kind) || !isIsoDay(o.day)) return null;
  const partyId = cleanId(o.partyId);
  if (partyId == null) return null;
  const amount = Math.trunc(Number(o.amount));
  if (!Number.isFinite(amount) || amount <= 0 || amount > MONEY_MAX) return null;
  const currency = cleanCurrency(o.currency);
  if (currency.length !== 3) return null;
  const ref = o.ref == null ? '' : typeof o.ref === 'number' ? o.ref : String(o.ref).trim().slice(0, 64);
  return {
    id: cleanId(o.id) ?? 0,
    day: String(o.day),
    kind: o.kind,
    partyId,
    article: cleanArticle(o.article),
    amount,
    currency,
    ref,
    reverses: cleanId(o.reverses) ?? 0,
    note: String(o.note ?? '').trim().slice(0, 500),
  };
}

// max + 1 over numeric ids (string ids, e.g. imported UUIDs, are ignored). O(n) per append - journals are thousands
// of rows, and a separate counter could drift from the data after an import or a manual edit of the file.
const nextIdOf = (journal) => (journal || []).reduce((m, o) => (typeof o.id === 'number' && o.id > m ? o.id : m), 0) + 1;

/**
 * Appends operations and returns a NEW journal (the old array is untouched). Raw ops come without ids; ids continue
 * the numeric ids of the journal. One bad op rejects the whole batch (`index` names it): half of a split written is
 * worse than none.
 */
export function appendOps(journal, raws) {
  const base = Array.isArray(journal) ? journal : [];
  let id = nextIdOf(base);
  const ops = [];
  const list = Array.isArray(raws) ? raws : [raws];
  for (let i = 0; i < list.length; i++) {
    const op = normalizeOp({ ...list[i], id: 0 });
    if (!op) return { ok: false, journal: base, ops: [], error: 'bad_op', index: i };
    if (op.reverses) return { ok: false, journal: base, ops: [], error: 'use_reverse', index: i };
    op.id = id++;
    ops.push(op);
  }
  return { ok: true, journal: [...base, ...ops], ops };
}

/**
 * Cancels an operation by a reversal: a copy with `reverses` set. Nothing is edited or deleted - both lines stay
 * visible, so an owner whose total changed can see what was cancelled and when.
 */
// The reversal copies kind, party, amount and currency of the target, so the pair is self-describing. Guards: a
// reversal cannot itself be reversed (re-instating is a new op, keeping the trail linear) and an op is reversed at
// most once (a second reversal would double-cancel).
export function reverseOp(journal, id, { day, note = '' } = {}) {
  const base = Array.isArray(journal) ? journal : [];
  const target = base.find((o) => sameId(o.id, id));
  if (!target) return { ok: false, journal: base, error: 'not_found' };
  if (target.reverses) return { ok: false, journal: base, error: 'is_reversal' };
  if (base.some((o) => o.reverses && sameId(o.reverses, target.id))) return { ok: false, journal: base, error: 'already_reversed' };
  const op = normalizeOp({ ...target, id: nextIdOf(base), day: day || target.day, note, reverses: target.id });
  if (!op) return { ok: false, journal: base, error: 'bad_op' };
  return { ok: true, journal: [...base, op], op };
}

// Both halves of every reversal pair. Leaving the reversal in a sum would add the amount twice; leaving the original
// would keep the mistake the reversal was made for.
export function reversedIds(ops) {
  const out = new Set();
  for (const o of ops || []) {
    if (!o || !o.reverses) continue;
    out.add(String(o.id));
    out.add(String(o.reverses));
  }
  return out;
}
export const isVoided = (dead, o) => dead.has(String(o.id));

const emptyBalance = (partyId) => ({ partyId, accrued: 0, deducted: 0, paid: 0, due: 0 });
function addTo(b, o) {
  const amt = amountOf(o);
  if (o.kind === 'accrual') b.accrued += amt;
  else if (o.kind === 'deduction') b.deducted += amt;
  else if (o.kind === 'payout') b.paid += amt;
  b.due = b.accrued - b.deducted - b.paid;
}

/**
 * Balance per party: due = accrued - deducted - paid. Currencies are never mixed: pass `currency` to pick one (ops of
 * other currencies are skipped); without it every op counts and the caller promises the journal has one currency.
 */
export function ledgerBalance(ops, { currency = '' } = {}) {
  const dead = reversedIds(ops);
  const cur = cleanCurrency(currency);
  const out = new Map();
  for (const o of ops || []) {
    if (!o || isVoided(dead, o) || (cur && cleanCurrency(o.currency) !== cur)) continue;
    const key = o.partyId;
    if (!out.has(key)) out.set(key, emptyBalance(key));
    addTo(out.get(key), o);
  }
  return out;
}

export function currenciesOf(ops) {
  return [...new Set((ops || []).map((o) => cleanCurrency(o && o.currency)).filter(Boolean))].sort();
}

// What a party is owed per currency (negative: the party owes). Input of `payoutPlan` (kpi.js).
export function dueByCurrency(ops, partyId) {
  const dead = reversedIds(ops);
  const out = {};
  for (const o of ops || []) {
    if (!o || isVoided(dead, o) || !sameId(o.partyId, partyId)) continue;
    const c = cleanCurrency(o.currency);
    if (!c) continue;
    const amt = amountOf(o);
    out[c] = (out[c] || 0) + (o.kind === 'accrual' ? amt : -amt);
  }
  return out;
}

const signed = (o) => (o.kind === 'accrual' ? amountOf(o) : -amountOf(o));

/**
 * A party's statement for [from, to] - both days INCLUDED (a person reads "September: 01 to 30"; an empty bound is
 * open). Rows are all operations of the period including voided ones (`voided: true`, shown but not summed: a
 * statement with the reversals cleaned out cannot be told from one where a mistake was quietly erased). Live rows
 * carry the running `balance`, which starts at `opening` (everything live before `from`); `closing` = opening + due.
 * `refs` counts distinct references behind the accruals (how many bookings); `otherCurrency` counts skipped ops of
 * other currencies - non-zero means the statement is incomplete and says so itself.
 */
export function statement(ops, partyId, { from = '', to = '', currency = '' } = {}) {
  const cur = cleanCurrency(currency);
  const dead = reversedIds(ops);
  const out = { partyId, from, to, currency: cur, rows: [], opening: 0, accrued: 0, deducted: 0, paid: 0, due: 0, closing: 0, refs: 0, otherCurrency: 0 };
  const mine = (ops || []).filter((x) => x && sameId(x.partyId, partyId) && (!to || String(x.day) <= to));
  const refs = new Set();
  const period = [];
  for (const x of mine) {
    if (cur && cleanCurrency(x.currency) !== cur) { if (!from || String(x.day) >= from) out.otherCurrency++; continue; }
    const voided = isVoided(dead, x);
    if (from && String(x.day) < from) { if (!voided) out.opening += signed(x); continue; }
    period.push({ x, voided });
  }
  // Array.prototype.sort is stable (ES2019), so ops of the same day keep journal (entry) order and the running
  // balance is reproducible. String comparison is correct for ISO days.
  period.sort((a, b) => (a.x.day < b.x.day ? -1 : a.x.day > b.x.day ? 1 : 0));
  let balance = out.opening;
  for (const { x, voided } of period) {
    const amt = amountOf(x);
    const row = { id: x.id, day: String(x.day), kind: x.kind, article: String(x.article || ''), amount: amt, currency: cleanCurrency(x.currency), ref: x.ref ?? '', reverses: x.reverses || 0, voided, note: String(x.note || '') };
    if (!voided) {
      if (x.kind === 'accrual') { out.accrued += amt; if (x.ref !== '' && x.ref != null && x.ref !== 0) refs.add(String(x.ref)); }
      else if (x.kind === 'deduction') out.deducted += amt;
      else out.paid += amt;
      balance += signed(x);
      row.balance = balance;
    }
    out.rows.push(row);
  }
  out.due = out.accrued - out.deducted - out.paid;
  out.closing = out.opening + out.due;
  out.refs = refs.size;
  return out;
}

// Totals per article of the live rows, grouped by the article KEY: 'Cleaning' and 'Уборка' are one line of money.
export function byArticle(rows) {
  const acc = new Map();
  for (const r of rows || []) {
    if (!r || r.voided) continue;
    const key = r.kind + ' ' + (r.article || '');
    if (!acc.has(key)) acc.set(key, { article: r.article || '', kind: r.kind, amount: 0 });
    acc.get(key).amount += Math.abs(r.amount || 0);
  }
  return [...acc.values()].sort((a, b) => b.amount - a.amount);
}

export function ownerReport(ops, partyId, opts = {}) {
  const st = statement(ops, partyId, opts);
  return { ...st, articles: byArticle(st.rows) };
}
