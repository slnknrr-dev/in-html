// stock/ledger.js - the stock ledger as a reducer over events: receipts, sales and customer returns, write-offs,
// adjustments, counts, and transfers between objects (sent -> pending, then accepted or rejected). The state gives
// stock now per object × item (the signed sum of the ledger), cost now (average purchase cost of the receipts with a
// cost: a sale does not change it, an accepted transfer is a receipt at the receiver at the cost it was sent with),
// quantities in transit, and the list of warnings (negative stock). Amounts in integer minor units.
//
// events:
//   { type: 'receipt',  object, item, qty, cost? }          cost = unit cost; without it the cost summary is untouched
//   { type: 'sale',     object, item, qty }                 qty sold (> 0)
//   { type: 'return',   object, item, qty }                 a customer return puts the stock back
//   { type: 'writeoff', object, item, qty, reason? }
//   { type: 'adjust',   object, item, qty }                 signed correction
//   { type: 'count',    object, item, qty }                 counted quantity: the ledger gets the difference
//   { type: 'transfer', id, from, to, lines: [{ item, qty, cost? }] }   sent: the sender loses the stock now
//   { type: 'accept',   id }                                the receiver gets the lines as a receipt
//   { type: 'reject',   id }                                the stock returns to the sender
//
// Event sourcing: the ledger is never edited, only folded. The same events always produce the same state, so a
// state can be rebuilt after a sync conflict, audited line by line, or recomputed with different rules. Negative
// stock is allowed and reported (offline sales happen before the receipt is entered) unless strict mode is on.

import { lineAmount, roundMinor } from './valuation.js';

const EPS = 1e-9;
const q6 = (x) => Math.round(x * 1e6) / 1e6;

export const emptyLedger = () => ({ stock: {}, cost: {}, transfers: {}, warnings: [], count: 0 });

const qtyOf = (s, o, i) => s.stock[o]?.[i] ?? 0;
function move(s, object, item, delta) {
  const per = (s.stock[object] ??= {});
  per[item] = q6((per[item] ?? 0) + delta);
  if (per[item] < -EPS) s.warnings.push({ code: 'negative', object, item, qty: per[item], event: s.count });
}
function addCost(s, object, item, qty, unit) {
  if (unit == null) return;
  const per = (s.cost[object] ??= {});
  const c = (per[item] ??= { qty: 0, amount: 0 });
  c.qty = q6(c.qty + qty);
  c.amount += lineAmount(qty, unit);
}

// Unit cost now of an item at an object (average of its receipts with a cost), null when unknown.
export function costNow(state, object, item) {
  const c = state.cost[object]?.[item];
  return c && c.qty > EPS ? c.amount / c.qty : null;
}

export const stockNow = (state, object, item) => qtyOf(state, object, item);

// Items of an object with their quantity, unit cost and value: [{ item, qty, unit, value }].
export function stockOf(state, object) {
  return Object.entries(state.stock[object] ?? {}).map(([item, qty]) => {
    const unit = costNow(state, object, item);
    return { item, qty, unit, value: unit == null ? null : roundMinor(Math.max(0, qty) * unit) };
  });
}

// Pending transfers towards `to` (optionally for one item): the quantity in transit.
export function inTransit(state, to, item = null) {
  let t = 0;
  for (const tr of Object.values(state.transfers)) {
    if (tr.status !== 'pending' || tr.to !== to) continue;
    for (const l of tr.lines) if (item == null || l.item === item) t += l.qty;
  }
  return q6(t);
}

/**
 * Why an event cannot be applied, or null: 'unknown_type', 'bad_qty', 'insufficient_stock' (sale, write-off and
 * transfer beyond the stock: strict mode refuses them, an offline sale may still be applied knowingly),
 * 'duplicate_transfer', 'unknown_transfer', 'transfer_closed'.
 */
export function checkEvent(state, ev) {
  switch (ev.type) {
    case 'receipt': case 'return': return ev.qty > 0 ? null : 'bad_qty';
    case 'sale': case 'writeoff':
      if (!(ev.qty > 0)) return 'bad_qty';
      return qtyOf(state, ev.object, ev.item) < ev.qty - EPS ? 'insufficient_stock' : null;
    case 'adjust': return Number.isFinite(ev.qty) ? null : 'bad_qty';
    case 'count': return ev.qty >= 0 ? null : 'bad_qty';
    case 'transfer': {
      if (state.transfers[ev.id]) return 'duplicate_transfer';
      if (!Array.isArray(ev.lines) || !ev.lines.length || ev.lines.some((l) => !(l.qty > 0))) return 'bad_qty';
      const need = new Map();
      for (const l of ev.lines) need.set(l.item, (need.get(l.item) ?? 0) + l.qty);
      for (const [item, q] of need) if (qtyOf(state, ev.from, item) < q - EPS) return 'insufficient_stock';
      return null;
    }
    case 'accept': case 'reject': {
      const tr = state.transfers[ev.id];
      return !tr ? 'unknown_transfer' : tr.status !== 'pending' ? 'transfer_closed' : null;
    }
    default: return 'unknown_type';
  }
}

// Applies an event to a state in place (used by buildLedger); unknown transfers are ignored.
  // In-place for speed inside buildLedger (one clone per fold, not per event); applyEvent wraps it with a clone to
  // stay pure for single updates.
function mutate(s, ev) {
  s.count++;
  switch (ev.type) {
    case 'receipt': move(s, ev.object, ev.item, ev.qty); addCost(s, ev.object, ev.item, ev.qty, ev.cost); break;
    case 'sale': case 'writeoff': move(s, ev.object, ev.item, -ev.qty); break;
    case 'return': case 'adjust': move(s, ev.object, ev.item, ev.qty); break;
    // A count is recorded as the difference to the computed stock, so the history explains the correction.
    case 'count': move(s, ev.object, ev.item, ev.qty - qtyOf(s, ev.object, ev.item)); break;
    case 'transfer': {
      // A line without a cost travels at the sender's cost now, so the receiver's average stays meaningful.
      const lines = ev.lines.map((l) => ({ item: l.item, qty: l.qty, cost: l.cost ?? costNow(s, ev.from, l.item) }));
      for (const l of lines) move(s, ev.from, l.item, -l.qty);
      s.transfers[ev.id] = { id: ev.id, from: ev.from, to: ev.to, lines, status: 'pending' };
      break;
    }
    case 'accept': {
      const tr = s.transfers[ev.id];
      if (!tr || tr.status !== 'pending') break;
      for (const l of tr.lines) { move(s, tr.to, l.item, l.qty); addCost(s, tr.to, l.item, l.qty, l.cost); }
      s.transfers[ev.id] = { ...tr, status: 'accepted' };
      break;
    }
    case 'reject': {
      const tr = s.transfers[ev.id];
      if (!tr || tr.status !== 'pending') break;
      for (const l of tr.lines) move(s, tr.from, l.item, l.qty);
      s.transfers[ev.id] = { ...tr, status: 'rejected' };
      break;
    }
  }
  return s;
}

// Two-level copy of the nested maps: deep enough that mutate() never touches the input state, without a full
// structuredClone of every transfer line.
const clone = (s) => ({
  stock: Object.fromEntries(Object.entries(s.stock).map(([o, m]) => [o, { ...m }])),
  cost: Object.fromEntries(Object.entries(s.cost).map(([o, m]) => [o, Object.fromEntries(Object.entries(m).map(([i, c]) => [i, { ...c }]))])),
  transfers: { ...s.transfers }, warnings: [...s.warnings], count: s.count,
});

// Pure reducer: a new state with the event applied (the input state is not changed).
export const applyEvent = (state, ev) => mutate(clone(state), ev);

/**
 * Folds a list of events: -> { ...state, rejected: [{ index, event, error }] }. strict: events that checkEvent
 * refuses are skipped (and listed); otherwise only malformed ones are skipped and oversells become warnings.
 */
export function buildLedger(events, { strict = false, state = emptyLedger() } = {}) {
  const s = clone(state);
  const rejected = [];
  events.forEach((ev, index) => {
    const error = checkEvent(s, ev);
    if (error && (strict || error !== 'insufficient_stock')) { rejected.push({ index, event: ev, error }); return; }
    mutate(s, ev);
  });
  return { ...s, rejected };
}

// Objects × items with stock below zero: [{ object, item, qty }].
export function negativeStock(state) {
  const out = [];
  for (const [object, m] of Object.entries(state.stock)) for (const [item, qty] of Object.entries(m)) if (qty < -EPS) out.push({ object, item, qty });
  return out;
}
