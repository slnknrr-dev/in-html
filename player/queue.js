// player/queue.js - the play queue as plain data: items, the playing position, repeat and shuffle modes (random,
// artist spread, album shuffle, weighted "smart"), play next / add to queue, moves, history. Every function returns
// a new state; nothing here touches media elements.
//
//   createQueue(refs = [], { start = 0, repeat = 'off', shuffle = 'off', seed }) -> state
//     state { items: [{ key, ref }], order: [item indexes in play order], pos (index into order, -1 empty), repeat
//             ('off' | 'all' | 'one'), shuffle ('off' | 'random' | 'artist' | 'album' | 'smart'), seed, history: [refs] }
//   current(state) -> item | null ; currentRef(state) ; upcoming(state, n) -> items ; length(state)
//   next(state, { auto }) -> state | null      (null: the end; repeat one repeats only when auto)
//   prev(state) -> state ; jump(state, itemIndex) -> state
//   setItems(state, refs, { start }) ; enqueue(state, refs, { mode: 'next' | 'end' }) ; removeAt(state, itemIndex)
//   move(state, from, to) (play order positions) ; clearUpcoming(state)
//   setRepeat(state, mode) ; setShuffle(state, mode, { keyOf(ref) -> { artist, album }, weightOf(ref) -> number })
//   REPEAT_MODES, SHUFFLE_MODES ; cycleRepeat(mode) -> next mode
//   seededRandom(seed) -> () => [0, 1)

//
// Model: items keep insertion order; "order" is a permutation of item indexes (the play order), so shuffle and
// unshuffle never lose the original list. Immutable updates make undo, persistence and UI diffing trivial.
export const REPEAT_MODES = ['off', 'all', 'one'];
export const SHUFFLE_MODES = ['off', 'random', 'artist', 'album', 'smart'];
export const cycleRepeat = (m) => REPEAT_MODES[(REPEAT_MODES.indexOf(m) + 1) % REPEAT_MODES.length];

// Seeded PRNG so a shuffled order can be reproduced after reload (the seed is stored in the state).
export function seededRandom(seed) {
  let h = 2166136261 >>> 0;
  for (const c of String(seed ?? 'q')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h = (h + 0x6D2B79F5) | 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

let keySeq = 0;
// Item keys are unique per insertion (the same track queued twice gets two keys), used as stable UI list keys.
const mkItem = (ref) => ({ key: 'q' + (++keySeq).toString(36) + Math.floor(Math.random() * 1e6).toString(36), ref });

export function createQueue(refs = [], { start = 0, repeat = 'off', shuffle = 'off', seed = String(Date.now()) } = {}) {
  const items = refs.map(mkItem);
  const s = { items, order: items.map((_, i) => i), pos: items.length ? Math.min(Math.max(0, start), items.length - 1) : -1, repeat, shuffle: 'off', seed, history: [] };
  return shuffle !== 'off' ? setShuffle(s, shuffle) : s;
}

export const length = (s) => s.order.length;
export const current = (s) => (s.pos >= 0 && s.pos < s.order.length ? s.items[s.order[s.pos]] : null);
export const currentRef = (s) => { const c = current(s); return c ? c.ref : null; };
export const upcoming = (s, n = 50) => s.order.slice(s.pos + 1, s.pos + 1 + n).map((i) => s.items[i]);

const withHistory = (s, next) => { const c = current(s); return c ? { ...next, history: [...s.history.slice(-199), c.ref] } : next; };

export function next(s, { auto = false } = {}) {
  if (!s.order.length) return null;
  if (auto && s.repeat === 'one') return { ...s };
  if (s.pos + 1 < s.order.length) return withHistory(s, { ...s, pos: s.pos + 1 });
  if (s.repeat === 'all' || (s.repeat === 'one' && !auto)) {
    const fresh = s.shuffle !== 'off' && s.shuffle !== 'album' ? reshuffle({ ...s, seed: s.seed + '+' }, null) : s;
    return withHistory(s, { ...fresh, pos: 0 });
  }
  return null;
}

export function prev(s) {
  if (!s.order.length) return s;
  if (s.pos > 0) return { ...s, pos: s.pos - 1 };
  return s.repeat === 'all' ? { ...s, pos: s.order.length - 1 } : s;
}

export function jump(s, itemIndex) {
  const p = s.order.indexOf(itemIndex);
  return p < 0 ? s : withHistory(s, { ...s, pos: p });
}

export function setItems(s, refs, { start = 0 } = {}) {
  const q = createQueue(refs, { start, repeat: s.repeat, shuffle: 'off', seed: s.seed });
  q.history = s.history;
  return s.shuffle !== 'off' ? setShuffle(q, s.shuffle, s.shuffleOpts || {}) : q;
}

export function enqueue(s, refs, { mode = 'end' } = {}) {
  const add = refs.map(mkItem);
  const items = [...s.items, ...add];
  const idx = add.map((_, i) => s.items.length + i);
  const order = s.order.slice();
  if (mode === 'next' && s.pos >= 0) order.splice(s.pos + 1, 0, ...idx); else order.push(...idx);
  return { ...s, items, order, pos: s.pos < 0 ? 0 : s.pos };
}

export function removeAt(s, itemIndex) {
  if (itemIndex < 0 || itemIndex >= s.items.length) return s;
  const p = s.order.indexOf(itemIndex);
  const items = s.items.filter((_, i) => i !== itemIndex);
  const order = s.order.filter((i) => i !== itemIndex).map((i) => (i > itemIndex ? i - 1 : i));
  let pos = s.pos;
  if (p >= 0 && p < s.pos) pos--;
  if (pos >= order.length) pos = order.length - 1;
  return { ...s, items, order, pos };
}

export function move(s, from, to) {
  if (from < 0 || from >= s.order.length) return s;
  const order = s.order.slice();
  const [x] = order.splice(from, 1);
  const t = Math.max(0, Math.min(order.length, to));
  order.splice(t, 0, x);
  let pos = s.pos;
  if (from === s.pos) pos = t;
  else { if (from < s.pos) pos--; if (t <= pos) pos++; }
  return { ...s, order, pos };
}

export const clearUpcoming = (s) => (s.pos < 0 ? s : { ...s, order: s.order.slice(0, s.pos + 1) });
export const setRepeat = (s, mode) => ({ ...s, repeat: REPEAT_MODES.includes(mode) ? mode : 'off' });

// Spread: items of one key (artist) as far apart as possible — a round robin over keys in shuffled order, each key's
// items shuffled.
function spread(indexes, keyOf, rnd) {
  const groups = new Map();
  for (const i of indexes) { const k = keyOf(i); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); }
  const lists = [...groups.values()].map((g) => shuffleInPlace(g, rnd));
  shuffleInPlace(lists, rnd);
  lists.sort((a, b) => b.length - a.length);
  // Place each group's items at evenly spaced fractional positions, then sort by position.
  const placed = [];
  for (const g of lists) {
    const off = rnd() / g.length;
    g.forEach((i, k) => placed.push({ i, at: off + k / g.length + rnd() * 1e-6 }));
  }
  return placed.sort((a, b) => a.at - b.at).map((x) => x.i);
}

function shuffleInPlace(a, rnd) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function reshuffle(s, currentIndex) {
  const o = s.shuffleOpts || {};
  const rnd = seededRandom(s.seed + ':' + s.shuffle);
  const all = s.items.map((_, i) => i);
  const rest = all.filter((i) => i !== currentIndex);
  const keyOf = (i) => { const k = o.keyOf ? o.keyOf(s.items[i].ref) : null; return k || {}; };
  let order;
  switch (s.shuffle) {
    case 'artist': order = spread(rest, (i) => String(keyOf(i).artist || s.items[i].ref).toLowerCase(), rnd); break;
    case 'album': {
      const albums = new Map();
      for (const i of rest) { const k = String(keyOf(i).album || s.items[i].ref); if (!albums.has(k)) albums.set(k, []); albums.get(k).push(i); }
      order = shuffleInPlace([...albums.values()], rnd).flat();
      break;
    }
    case 'smart': {
      // Weighted random without replacement (Efraimidis–Spirakis): higher weight = earlier on average.
      const w = (i) => Math.max(0.01, o.weightOf ? Number(o.weightOf(s.items[i].ref)) || 1 : 1);
      order = rest.map((i) => ({ i, k: Math.pow(rnd(), 1 / w(i)) })).sort((a, b) => b.k - a.k).map((x) => x.i);
      break;
    }
    default: order = shuffleInPlace(rest.slice(), rnd);
  }
  return { ...s, order: currentIndex == null ? order : [currentIndex, ...order], pos: currentIndex == null ? 0 : 0 };
}

export function setShuffle(s, mode, opts = {}) {
  const m = SHUFFLE_MODES.includes(mode) ? mode : 'off';
  const cur = current(s);
  const curIndex = cur ? s.items.indexOf(cur) : null;
  if (m === 'off') {
    const order = s.items.map((_, i) => i);
    return { ...s, shuffle: 'off', order, pos: curIndex == null ? (s.items.length ? 0 : -1) : curIndex };
  }
  return reshuffle({ ...s, shuffle: m, shuffleOpts: { ...(s.shuffleOpts || {}), ...opts } }, curIndex);
}
