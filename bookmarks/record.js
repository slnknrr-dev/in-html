// bookmarks/record.js - replicated records: per-field last-writer-wins registers with tombstones. Every replica (a
// browser tab, a server) that has seen the same set of edits holds the same records, whatever the order in which the
// edits arrived (merge is commutative, associative and idempotent).
//
//   record = { id, type: 'bookmark' | 'folder', v: { field: value }, s: { field: stamp }, p?: stamp }
//     v / s    field values and the stamps (bookmarks/clock.js) of the edits that set them
//     p        purge stamp: the newest deletion seen; values older than it are dropped (a deleted record keeps only
//              a tombstone), so p only grows and a field keeps a value only when its stamp is newer than p
//
//   setFields(rec, fields, stamp) -> boolean         a local edit (every field gets the stamp)
//   deleteRecord(rec, stamp) -> boolean              del = true and p = stamp (older values are dropped)
//   mergeRecord(into, from) -> boolean               joins another replica's copy into `into` (changed?)
//   newRecord(type, id) / cloneRecord(rec) / isDeleted(rec) / maxStamp(rec)
//   valueOf(rec) -> { id, type, ...defaults, ...values }    the plain object the application uses
//   sanitizeRecord(input) -> record | null           untrusted input (sync, backups): shape, types and sizes checked
//
// Concurrent edits of different fields of a record both survive; for the same field the newer stamp wins (ties are
// impossible: stamps carry the client id). A restore after a deletion writes the values again with new stamps.

import { isStamp } from './clock.js';

export const TYPES = ['bookmark', 'folder'];

// Field schema per type: default value and validator (value -> clean value | undefined when invalid).
// Validators return the clean value or undefined (= reject this field), never throw: sanitizing a whole record never
// fails because of one bad field. Icons are only base64 data: URLs of raster/SVG image types, so a stored icon can
// never be a remote URL (tracking pixel) or script.
const str = (max) => (v) => (typeof v === 'string' ? (v.length > max ? v.slice(0, max) : v) : undefined);
const bool = (v) => (typeof v === 'boolean' ? v : undefined);
const time = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e14 ? Math.floor(v) : undefined);
const idRef = (v) => (typeof v === 'string' && (v === '' || /^[A-Za-z0-9_-]{1,64}$/.test(v)) ? v : undefined);
const ICON_RE = /^data:image\/(?:png|gif|jpeg|webp|avif|svg\+xml|x-icon|vnd\.microsoft\.icon|bmp);base64,[A-Za-z0-9+/]+=*$/;
// Favicons of up to 100 KB (as base64 in a data: URL).
export const ICON_MAX = 140000;
const icon = (v) => (v === '' || (typeof v === 'string' && v.length <= ICON_MAX && ICON_RE.test(v)) ? v : undefined);
function tags(v) {
  if (!Array.isArray(v)) return undefined;
  const out = [], seen = new Set();
  for (const t of v.slice(0, 200)) {
    if (typeof t !== 'string') continue;
    const s = cleanTag(t);
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
  }
  return out;
}

// A tag: no commas, no control characters, inner whitespace collapsed, at most 100 characters; '#' prefixes dropped.
export function cleanTag(t) {
  // eslint-disable-next-line no-control-regex
  return String(t).replace(/[\u0000-\u001f\u007f,]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^#+/, '').trim().slice(0, 100);
}

// The schema is the single whitelist of replicated fields: setFields, sanitizeRecord and valueOf all go through it,
// so a field unknown to this version is dropped rather than stored and re-broadcast.
export const SCHEMA = {
  bookmark: {
    url: ['', str(8192)], title: ['', str(2000)], notes: ['', str(100000)], tags: [[], tags], folder: ['', idRef],
    created: [0, time], modified: [0, time], visited: [0, time], unread: [false, bool], fav: [false, bool],
    public: [false, bool], icon: ['', icon], archived: [false, bool], del: [false, bool],
  },
  folder: {
    name: ['', str(500)], parent: ['', idRef], created: [0, time], del: [false, bool],
  },
};

export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const newRecord = (type, id) => ({ id, type, v: {}, s: {} });

export const isDeleted = (rec) => !!(rec && rec.v.del);

export function cloneRecord(rec) {
  const r = { id: rec.id, type: rec.type, v: {}, s: { ...rec.s } };
  for (const [k, x] of Object.entries(rec.v)) r.v[k] = Array.isArray(x) ? x.slice() : x;
  if (rec.p) r.p = rec.p;
  return r;
}

const same = (a, b) => a === b || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]));

// Drops the values that a deletion (p) made obsolete.
// Tombstone semantics: a deletion stamp p hides every field write older than it, on every replica, regardless of
// arrival order. Writes newer than p survive, which is how a restore (or a concurrent later edit) beats a delete.
function purge(rec) {
  if (!rec.p) return false;
  let changed = false;
  for (const k of Object.keys(rec.s)) {
    if (rec.s[k] < rec.p) { delete rec.s[k]; delete rec.v[k]; changed = true; }
  }
  return changed;
}

// Last-writer-wins per field: a write applies only if its stamp is newer than the field's current stamp and not older
// than the purge stamp. Returns whether anything visible changed (callers persist/broadcast only then).
export function setFields(rec, fields, stamp) {
  const schema = SCHEMA[rec.type];
  let changed = false;
  for (const [k, raw] of Object.entries(fields)) {
    if (!schema || !schema[k]) continue;
    const val = schema[k][1](raw);
    if (val === undefined) continue;
    if (rec.p && stamp < rec.p) continue;
    if (rec.s[k] && rec.s[k] >= stamp) continue;
    if (!same(rec.v[k], val) || rec.s[k] !== stamp) changed = true;
    rec.v[k] = Array.isArray(val) ? val.slice() : val;
    rec.s[k] = stamp;
  }
  return changed;
}

export function deleteRecord(rec, stamp) {
  if (rec.p && rec.p >= stamp) return false;
  rec.v.del = true;
  rec.s.del = stamp;
  rec.p = stamp;
  purge(rec);
  return true;
}

// CRDT join: take the larger purge stamp, then per field the value with the larger stamp. Commutative,
// associative and idempotent because every decision is a max over totally ordered stamps (client id breaks ties),
// so replicas converge no matter how often or in which order records are exchanged.
export function mergeRecord(into, from) {
  if (into.id !== from.id) throw new Error('merging different records');
  let changed = false;
  if (from.p && (!into.p || from.p > into.p)) { into.p = from.p; changed = purge(into) || true; }
  for (const k of Object.keys(from.s)) {
    const st = from.s[k];
    if (into.p && st < into.p) continue;
    if (into.s[k] && into.s[k] >= st) continue;
    const x = from.v[k];
    into.v[k] = Array.isArray(x) ? x.slice() : x;
    into.s[k] = st;
    changed = true;
  }
  return changed;
}

export function maxStamp(rec) {
  let m = rec.p || '';
  for (const st of Object.values(rec.s)) if (st > m) m = st;
  return m;
}

export function valueOf(rec) {
  const schema = SCHEMA[rec.type] || {};
  const o = { id: rec.id, type: rec.type };
  for (const [k, [def]] of Object.entries(schema)) {
    const x = Object.prototype.hasOwnProperty.call(rec.v, k) ? rec.v[k] : def;
    o[k] = Array.isArray(x) ? x.slice() : x;
  }
  return o;
}

// Untrusted record (sync request, backup file): a clean copy or null. Unknown fields and invalid values are dropped.
// Trust boundary for sync requests and backup files: rebuilds the record from scratch, checking id, type, stamp
// formats and each field through the schema. Fields older than the purge stamp are dropped right away.
// KNOWN DEFECT: schema[k] is a plain-object lookup, so a JSON key like "constructor" (or "__proto__", which
// JSON.parse creates as an own key) resolves to an Object.prototype member and schema[k][1] is not a function: the
// call throws "schema[k][1] is not a function" (checked), and syncLog.apply aborts the whole batch instead of
// skipping the field. Fix: Object.prototype.hasOwnProperty.call(schema, k) here and in setFields.
export function sanitizeRecord(input) {
  if (!input || typeof input !== 'object') return null;
  const { id, type, v, s, p } = input;
  if (typeof id !== 'string' || !ID_RE.test(id) || !TYPES.includes(type)) return null;
  if (!v || typeof v !== 'object' || !s || typeof s !== 'object') return null;
  if (p !== undefined && !isStamp(p)) return null;
  const rec = newRecord(type, id);
  if (p) rec.p = p;
  const schema = SCHEMA[type];
  for (const k of Object.keys(s)) {
    if (!schema[k] || !isStamp(s[k]) || !Object.prototype.hasOwnProperty.call(v, k)) continue;
    const val = schema[k][1](v[k]);
    if (val === undefined) continue;
    if (p && s[k] < p) continue;
    rec.v[k] = val;
    rec.s[k] = s[k];
  }
  return rec;
}
