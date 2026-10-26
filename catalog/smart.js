// catalog/smart.js - smart playlists (a query with sorting, picking and limits), mood / energy / time-of-day
// playlists, and the expansion of containers into what is actually played.
//
//   resolveSmart(db, coll, { now, seed }) -> works      coll: { query, kinds, sort, pick, limit: { count, minutes, mb },
//                                                       spread: 'artist' | 'album' | 'show' | null, playable }
//     pick 'all' (sorted) | 'random' | 'top-rated' | 'most-played' | 'least-played' | 'newest' | 'oldest' | 'forgotten'
//     (favourites or high scores not played for long) ; spread keeps at most one item of an artist / album / show per
//     run of 3 items when possible ; playable (default true) skips nominal works
//   expandForPlay(db, works, { playable }) -> leaf works in play order (album -> tracks, show -> episodes, book ->
//                                             chapters; containers that have their own media play themselves)
//   timeOfDay(date) -> 'morning' | 'afternoon' | 'evening' | 'night'
//   moodQuery(tod) -> query text of the time-of-day mix (tod: tags, then energy ranges)
//   SMART_PRESETS [{ id, query, sort, pick, limit, kinds }]  (names come from the application's strings: 'smart.<id>')
//   LEAF_KINDS
//
// Pipeline of resolveSmart, in this order on purpose: query -> kind filter or container expansion -> playable filter
// -> pick / sort -> spread -> limits. Limits come last because "60 minutes of random calm tracks" must cut the
// already shuffled list; cutting first would always keep the same alphabetically-first tracks.
// Randomness is seeded by collection id + calendar day: the mix is stable within a day (reopening the playlist does
// not reshuffle under the listener) and changes daily. Math.random would reshuffle on every re-render.

import { facts } from './facts.js';
import { runQuery, sortWorks } from './query.js';

export const LEAF_KINDS = ['track', 'episode', 'chapter', 'movie', 'musicvideo'];

// Built-in presets: data, not code, so a user can copy one into an editable smart collection. Mood presets OR many
// weak signals (tags, energy, bpm) because most libraries are sparsely tagged; an AND would return nothing.
export const SMART_PRESETS = [
  { id: 'recent', query: 'added:<30d', sort: '-added', pick: 'all', limit: { count: 200 } },
  { id: 'mostPlayed', query: 'plays:>0', sort: '-plays', pick: 'all', limit: { count: 100 } },
  { id: 'neverPlayed', query: 'is:unplayed is:playable', sort: 'random', pick: 'random', limit: { count: 100 } },
  { id: 'topRated', query: 'score:>=8 OR is:favorite', sort: '-score', pick: 'all', limit: { count: 200 } },
  { id: 'forgotten', query: 'is:favorite OR score:>=8', pick: 'forgotten', limit: { count: 50 } },
  { id: 'morning', query: 'tod:morning OR mood:calm OR mood:happy OR energy:3..6', kinds: ['track'], pick: 'random', spread: 'artist', limit: { minutes: 90 } },
  { id: 'workout', query: 'activity:workout OR energy:>=7 OR bpm:>=125', kinds: ['track'], pick: 'random', spread: 'artist', limit: { minutes: 60 } },
  { id: 'focus', query: 'activity:study OR mood:focus OR (genre:ambient OR genre:classical) -mood:energetic', kinds: ['track'], pick: 'random', spread: 'artist', limit: { minutes: 120 } },
  { id: 'night', query: 'tod:night OR mood:calm OR energy:..3', kinds: ['track'], pick: 'random', spread: 'artist', limit: { minutes: 60 } },
  { id: 'lossless', query: 'ext:flac,wav,alac,ape,wv,aiff', kinds: ['track'], sort: 'artist album track', pick: 'all' },
  { id: 'wishlist', query: 'presence:nominal', sort: '-added', pick: 'all', playable: false },
  { id: 'downloadable', query: 'presence:source', sort: '-added', pick: 'all' },
  { id: 'animeCurrent', query: 'domain:anime status:current', kinds: ['show', 'season'], sort: '-updated', pick: 'all', playable: false },
  { id: 'booksCurrent', query: 'domain:audiobook status:current', kinds: ['book'], sort: '-updated', pick: 'all', playable: false },
];

// Local hours (getHours, not UTC): "morning" is the listener's morning. Night wraps midnight (22..5).
export function timeOfDay(d = new Date()) {
  const h = (d instanceof Date ? d : new Date(d)).getHours();
  return h >= 5 && h < 11 ? 'morning' : h >= 11 && h < 17 ? 'afternoon' : h >= 17 && h < 22 ? 'evening' : 'night';
}

const TOD_ENERGY = { morning: '3..6', afternoon: '5..8', evening: '3..6', night: '..4' };
export const moodQuery = (tod) => `tod:${tod} OR energy:${TOD_ENERGY[tod] || '3..7'}`;

// Containers are replaced by their leaves unless they have a non-nominal media of their own (a single-file album
// rip plays as one item). `seen` dedupes leaves reached twice (album and one of its tracks both listed) and the
// depth cap of 4 stops recursion on a corrupt parent cycle. Note: seen is only set on leaves, so a cycle is bounded
// by depth, not by seen.
export function expandForPlay(db, works, { playable = true } = {}) {
  const out = [];
  const seen = new Set();
  const walk = (w, depth) => {
    if (!w || seen.has(w.id)) return;
    const kids = depth < 4 ? db.children(w.id) : [];
    if (kids.length && !db.mediaOf(w.id).some((m) => m.presence !== 'nominal')) { for (const c of kids) walk(c, depth + 1); return; }
    seen.add(w.id);
    if (!playable || facts(db, w).presence !== 'nominal') out.push(w);
  };
  for (const w of works) walk(w, 0);
  return out;
}

// Greedy de-clustering: take the next item whose key is not among the last 3 output keys; if none qualifies (one
// artist dominates), take the head anyway rather than drop items. Preserves the input order otherwise.
// O(n^2) (findIndex over the remainder per step); fine for playlist sizes, keyOf hits the facts cache.
function spreadOut(db, list, by) {
  if (!by) return list;
  const keyOf = (w) => { const f = facts(db, w); return by === 'album' ? f.album || w.id : by === 'show' ? f.show || w.id : (f.artist[0] || f.author[0] || w.id).toLowerCase(); };
  const rest = list.slice();
  const out = [];
  while (rest.length) {
    const recent = out.slice(-3).map(keyOf);
    let i = rest.findIndex((w) => !recent.includes(keyOf(w)));
    if (i < 0) i = 0;
    out.push(rest.splice(i, 1)[0]);
  }
  return out;
}

// Deterministic Fisher-Yates. The string seed is hashed with FNV-1a (32-bit, Math.imul for exact 32-bit multiply;
// a plain * would lose low bits past 2^53), then fed to a mulberry32-style generator: tiny, fast, good enough
// statistical quality for shuffling, and reproducible across engines, which Math.random is not.
function seededShuffle(list, seed) {
  let h = 2166136261 >>> 0;
  for (const c of String(seed)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  const rnd = () => { h = (h + 0x6D2B79F5) | 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

export function resolveSmart(db, coll, { now = Date.now(), seed = null } = {}) {
  const kinds = Array.isArray(coll.kinds) && coll.kinds.length ? coll.kinds : null;
  const playable = coll.playable !== false;
  let list = runQuery(db, coll.query || '', { now, sort: null });
  if (kinds) list = list.filter((w) => kinds.includes(w.kind));
  else {
    // Containers expand into their children; children whose container matched too are not repeated.
    const ids = new Set(list.map((w) => w.id));
    list = expandForPlay(db, list.filter((w) => !ids.has(w.parent)), { playable: false });
  }
  if (playable) list = list.filter((w) => facts(db, w).presence !== 'nominal');
  // Daily seed (see header). `??` binds looser than `+`, so an explicit seed replaces the whole expression.
  const s = seed ?? (coll.seed || coll.id || 'smart') + ':' + new Date(now).toISOString().slice(0, 10);
  switch (coll.pick) {
    case 'random': list = seededShuffle(list, s); break;
    case 'top-rated': list = sortWorks(db, list, '-score -rating -plays'); break;
    case 'most-played': list = sortWorks(db, list, '-plays'); break;
    case 'least-played': list = sortWorks(db, list, 'plays played'); break;
    case 'newest': list = sortWorks(db, list, '-added'); break;
    case 'oldest': list = sortWorks(db, list, 'added'); break;
    // Not played for 90 days; never-played works have lastPlayed 0 (facts default) and qualify too. Sorted
    // longest-unplayed first, best score breaking ties.
    case 'forgotten': {
      const cut = now - 90 * 864e5;
      list = list.filter((w) => facts(db, w).lastPlayed < cut);
      list = sortWorks(db, list, 'played -score');
      break;
    }
    default: list = coll.sort ? sortWorks(db, list, coll.sort, { seed: s }) : sortWorks(db, list, 'title');
  }
  list = spreadOut(db, list, coll.spread);
  const lim = coll.limit || {};
  if (lim.count > 0) list = list.slice(0, lim.count);
  // Budget limits stop at the first item that would overflow (no knapsack packing: order matters more than filling
  // the budget exactly). `&& out.length` guarantees at least one item even if it alone exceeds the budget.
  if (lim.minutes > 0 || lim.mb > 0) {
    const out = [];
    let sec = 0, bytes = 0;
    for (const w of list) {
      const f = facts(db, w);
      if (lim.minutes > 0 && sec + (f.duration || 0) > lim.minutes * 60 && out.length) break;
      if (lim.mb > 0 && bytes + (f.size || 0) > lim.mb * 1048576 && out.length) break;
      sec += f.duration || 0; bytes += f.size || 0;
      out.push(w);
    }
    list = out;
  }
  return list;
}
