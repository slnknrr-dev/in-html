// language-studio/progress.js - the learner's progress document and how two copies of it merge (the browser's copy
// and the server's). Pure functions: used by the page and by the backend.
//
//   doc = { v: 1, cards: { itemId: card (lingua/srs.js) }, scores: { gameKey: { best, plays, last, t } },
//           known: { letterId: t }, prefs: { …, t }, t }
//   emptyProgress() / cleanProgress(any) -> a valid doc (unknown or broken entries dropped)
//   mergeProgress(a, b) -> doc   per entry the newer one wins (cards by their t, scores by t, prefs as a whole)
//   recordScore(doc, key, score, now) -> doc
import { merge as mergeCard, validCard } from '../lingua/srs.js';

// Trust model: a progress document may come from another device, an old version or a hostile client (the server
// merges what browsers send), so cleanProgress is an allow-list rebuild, not a filter: only known fields with the
// right types are copied into a fresh object, which also strips __proto__ or other surprise keys.
// Keys: 1..200 characters without control characters (ids are printable; this blocks log/terminal injection and
// absurd keys). LIMITS cap entry counts so a crafted document cannot exhaust server storage or memory.
const KEY_RE = /^[^\u0000-\u001f\u007f]{1,200}$/u;
export const LIMITS = { cards: 50000, scores: 2000, known: 5000 };

export const emptyProgress = () => ({ v: 1, cards: {}, scores: {}, known: {}, prefs: { t: 0 }, t: 0 });

const num = (x) => typeof x === 'number' && Number.isFinite(x);

export function cleanProgress(raw) {
  const d = emptyProgress();
  if (!raw || typeof raw !== 'object') return d;
  let n = 0;
  for (const [k, c] of Object.entries(raw.cards || {})) {
    if (n >= LIMITS.cards) break;
    if (KEY_RE.test(k) && validCard(c)) { d.cards[k] = { e: c.e, i: c.i, n: c.n, l: c.l, d: c.d, t: c.t }; n++; }
  }
  n = 0;
  for (const [k, s] of Object.entries(raw.scores || {})) {
    if (n >= LIMITS.scores) break;
    if (KEY_RE.test(k) && s && num(s.best) && num(s.plays) && num(s.t)) { d.scores[k] = { best: s.best, plays: s.plays, last: num(s.last) ? s.last : s.best, t: s.t }; n++; }
  }
  n = 0;
  for (const [k, t] of Object.entries(raw.known || {})) {
    if (n >= LIMITS.known) break;
    if (KEY_RE.test(k) && num(t)) { d.known[k] = t; n++; }
  }
  if (raw.prefs && typeof raw.prefs === 'object') {
    const p = { t: num(raw.prefs.t) ? raw.prefs.t : 0 };
    for (const [k, v] of Object.entries(raw.prefs)) if (k !== 't' && /^[a-zA-Z0-9_.-]{1,40}$/.test(k) && ['string', 'number', 'boolean'].includes(typeof v)) p[k] = typeof v === 'string' ? v.slice(0, 200) : v;
    d.prefs = p;
  }
  d.t = num(raw.t) ? raw.t : 0;
  return d;
}

// The merge is designed to be idempotent and order-insensitive, so syncing twice or from either side converges
// (a state-based CRDT in spirit): cards via the SRS card merge, scores take max(best) and max(plays) (not the sum: a
// sum would double count every time the same copy is merged again), `known` takes the latest time, prefs are
// last-writer-wins as one unit (individual preferences are not meaningful in isolation). On an exact prefs tie A wins,
// the only order-dependent case. Cost of max(plays): plays made on two devices offline are undercounted.
export function mergeProgress(a, b) {
  const A = cleanProgress(a), B = cleanProgress(b);
  const out = emptyProgress();
  for (const k of new Set([...Object.keys(A.cards), ...Object.keys(B.cards)])) out.cards[k] = mergeCard(A.cards[k], B.cards[k]);
  for (const k of new Set([...Object.keys(A.scores), ...Object.keys(B.scores)])) {
    const x = A.scores[k], y = B.scores[k];
    if (!x || !y) { out.scores[k] = x || y; continue; }
    const newer = y.t > x.t ? y : x;
    out.scores[k] = { best: Math.max(x.best, y.best), plays: Math.max(x.plays, y.plays), last: newer.last, t: newer.t };
  }
  for (const k of new Set([...Object.keys(A.known), ...Object.keys(B.known)])) out.known[k] = Math.max(A.known[k] || 0, B.known[k] || 0);
  out.prefs = (B.prefs.t || 0) > (A.prefs.t || 0) ? B.prefs : A.prefs;
  out.t = Math.max(A.t, B.t);
  return out;
}

// Mutates doc in place (the page owns it) and bumps doc.t so the next sync knows there is something new.
export function recordScore(doc, key, score, now = Date.now()) {
  const s = doc.scores[key] || { best: 0, plays: 0, last: 0, t: 0 };
  doc.scores[key] = { best: Math.max(s.best, score), plays: s.plays + 1, last: score, t: now };
  doc.t = now;
  return { best: score > s.best, record: doc.scores[key] };
}
