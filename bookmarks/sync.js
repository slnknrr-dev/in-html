// bookmarks/sync.js - the server side of synchronisation: a revision log of records. Clients send the records they
// changed and ask for everything changed since the revision they saw last; because records merge like a CRDT
// (record.js), a client may resend anything, in any order, any number of times.
//
//   const log = syncLog(saved?)          saved: { rev, items: { id: { rec, r } } } (JSON of a previous log)
//   log.apply(records, { now, maxFuture }) -> { changed: [id], rejected: [id] }
//            records are sanitized; stamps more than maxFuture ms (default one day) ahead of now are rejected
//   log.since(rev) -> { rev, records }   records with a revision > rev
//   log.rev, log.size, log.toJSON(), log.get(id), log.records()
//   log.put(rec) -> boolean               a record the server made itself (bookmarklet, metadata)
//
// A client loop: POST { since, changes } -> { rev, changes } where changes = log.since(since).records after
// applying the client's changes; the client merges them and remembers rev.

import { cloneRecord, maxStamp, mergeRecord, sanitizeRecord } from './record.js';
import { stampTime } from './clock.js';

// The server does no conflict resolution of its own: it merges incoming records with the same CRDT merge the
// clients use, and bumps a global revision for every record that actually changed. Clients pull "since rev N",
// which is idempotent and order-independent. Stamps far in the future are rejected: one client with a clock years
// ahead would otherwise win every future conflict (last-writer-wins by stamp).
// Revision numbers are per-record latest only (no history): since() returns current states, not deltas.
export function syncLog(saved = null) {
  let rev = saved && Number.isInteger(saved.rev) ? saved.rev : 0;
  const items = new Map();
  if (saved && saved.items) {
    for (const [id, x] of Object.entries(saved.items)) {
      const rec = x && sanitizeRecord(x.rec);
      if (rec && rec.id === id) items.set(id, { rec, r: Number(x.r) || 0 });
    }
  }
  const log = {
    get rev() { return rev; },
    get size() { return items.size; },
    get(id) { const x = items.get(id); return x ? x.rec : null; },
    records() { return [...items.values()].map((x) => x.rec); },
    apply(records, { now = Date.now(), maxFuture = 864e5 } = {}) {
      const changed = [], rejected = [];
      for (const input of Array.isArray(records) ? records : []) {
        const rec = sanitizeRecord(input);
        if (!rec) { if (input && typeof input.id === 'string') rejected.push(input.id.slice(0, 64)); continue; }
        if (stampTime(maxStamp(rec)) > now + maxFuture) { rejected.push(rec.id); continue; }
        if (log.put(rec)) changed.push(rec.id);
      }
      return { changed, rejected };
    },
    put(rec) {
      const x = items.get(rec.id);
      if (!x) { items.set(rec.id, { rec: cloneRecord(rec), r: ++rev }); return true; }
      if (x.rec.type !== rec.type) return false;
      if (!mergeRecord(x.rec, rec)) return false;
      x.r = ++rev;
      return true;
    },
    since(from = 0) {
      const n = Number(from) || 0;
      const out = [];
      for (const x of items.values()) if (x.r > n) out.push(x.rec);
      return { rev, records: out };
    },
    toJSON() {
      const o = {};
      for (const [id, x] of items) o[id] = { rec: x.rec, r: x.r };
      return { rev, items: o };
    },
  };
  return log;
}
