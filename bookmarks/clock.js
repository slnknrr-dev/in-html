// bookmarks/clock.js - hybrid logical clock stamps for last-writer-wins fields: (time, counter, client id) packed into
// a string whose plain string order is the stamp order, so stamps compare with < and sort with sort().
//
//   createClock(client, now = Date.now) -> { client, next(), observe(stamp), last, skew }
//     next()           a new stamp, greater than every stamp this clock made or observed
//     observe(stamp)   remembers a stamp seen elsewhere (a merge), so later local edits win over it
//     skew             milliseconds added to now() (a client adopts the server's time when its own clock is off)
//   parseStamp(stamp) -> { t, c, client } | null;  isStamp(stamp) -> boolean;  stampTime(stamp) -> ms
//   newId(n = 12)      random id [a-z0-9] (the first character a letter); randomClientId() a short client id
//
// Format: 9 base-36 digits of milliseconds since 1970 (good until the year 5188), '.', 4 base-36 digits of a counter
// (stamps made within the same millisecond), '.', the client id ([a-z0-9]{1,24}). Ties between clients are broken by
// the client id, so every replica orders every pair of stamps the same way.

// Fixed-width zero-padded base-36 fields make lexicographic order equal numeric order, so stamps are compared as
// plain strings everywhere (records, sort, JSON) with no parsing.
const T_WIDTH = 9, C_WIDTH = 4;
const C_MAX = 36 ** C_WIDTH - 1;
export const STAMP_RE = /^[0-9a-z]{9}\.[0-9a-z]{4}\.[0-9a-z]{1,24}$/;

export const isStamp = (s) => typeof s === 'string' && STAMP_RE.test(s);

export function parseStamp(s) {
  if (!isStamp(s)) return null;
  return { t: parseInt(s.slice(0, T_WIDTH), 36), c: parseInt(s.slice(T_WIDTH + 1, T_WIDTH + 1 + C_WIDTH), 36), client: s.slice(T_WIDTH + C_WIDTH + 2) };
}

export const stampTime = (s) => (isStamp(s) ? parseInt(s.slice(0, T_WIDTH), 36) : 0);

export function makeStamp(t, c, client) {
  return Math.max(0, Math.floor(t)).toString(36).padStart(T_WIDTH, '0') + '.' + c.toString(36).padStart(C_WIDTH, '0') + '.' + client;
}

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
// crypto.getRandomValues where available; Math.random only as a last resort (ids need uniqueness, not secrecy).
// Note b % 36 has a slight modulo bias (256 is not a multiple of 36): irrelevant for collision resistance.
function randomBytes(n) {
  const b = new Uint8Array(n);
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < n; i++) b[i] = (Math.random() * 256) | 0;
  return b;
}

// 12 characters by default: 26 * 36^11 ids, so random ids of independent clients do not collide in practice.
export function newId(n = 12) {
  const b = randomBytes(n);
  let s = ID_CHARS[b[0] % 26];
  for (let i = 1; i < n; i++) s += ID_CHARS[b[i] % 36];
  return s;
}

export const randomClientId = () => newId(8);

// Hybrid logical clock: wall time when it moves forward, otherwise the counter increments, so stamps are strictly
// increasing even if the wall clock stalls or jumps back. observe() lifts the clock past any stamp seen in a merge,
// guaranteeing that an edit made after seeing a remote change wins over it (causality) despite clock skew.
// Counter overflow within one millisecond borrows the next millisecond.
export function createClock(client = randomClientId(), now = () => Date.now()) {
  if (!/^[0-9a-z]{1,24}$/.test(client)) throw new Error('client id must be 1-24 characters [0-9a-z]');
  let lt = 0, lc = 0;
  const clock = {
    client,
    skew: 0,
    get last() { return lt ? makeStamp(lt, lc, client) : ''; },
    next() {
      const wall = Math.floor(now() + clock.skew);
      if (wall > lt) { lt = wall; lc = 0; }
      else if (lc < C_MAX) lc++;
      else { lt++; lc = 0; }
      return makeStamp(lt, lc, client);
    },
    observe(stamp) {
      const p = parseStamp(stamp);
      if (!p) return;
      if (p.t > lt || (p.t === lt && p.c > lc)) { lt = p.t; lc = p.c; }
    },
  };
  return clock;
}
