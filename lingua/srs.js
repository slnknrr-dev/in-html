// lingua/srs.js - spaced repetition (a compact SM-2): every learned item has a card { e: ease, i: interval in days,
// n: successful reviews in a row, l: lapses, d: due time (ms), t: last change (ms) }. Grades: 0 again, 1 hard,
// 2 good, 3 easy. Pure functions, no storage.
//
//   review(card | null, grade, now) -> card        isDue(card, now)        dueItems(cards, ids, now, limit)
//   strength(card, now) -> 0 … 1 (how well the item is likely remembered now)   merge(a, b) -> the newer card

//
// Why one-letter keys: cards are persisted and synced per item; short keys keep the stored JSON small for thousands of
// items. Why SM-2 and not FSRS: SM-2 needs no trained parameters and is explainable in a sentence; the cost is a
// cruder retention model, acceptable for a learner app.

const DAY = 864e5;
const MIN = 6e4;

export function newCard(now = Date.now()) {
  return { e: 2.5, i: 0, n: 0, l: 0, d: now, t: now };
}

// Returns a new card (input never mutated: callers may keep the old one for undo / merge). Grade is clamped and
// rounded, so a bad caller value degrades to a valid grade instead of NaN intervals.
export function review(card, grade, now = Date.now()) {
  const c = { ...(card || newCard(now)) };
  const g = Math.max(0, Math.min(3, Math.round(grade)));
  if (g === 0) {
    // forgotten: back to a short step, ease drops
    c.l += 1;
    c.n = 0;
    c.e = Math.max(1.3, c.e - 0.2);
    c.i = 0;
    c.d = now + 10 * MIN;
  } else {
    // Ease floor 1.3 (SM-2's): below it intervals stop growing and a hard card loops forever ("ease hell").
    // The first two steps are a fixed ladder; then the interval multiplies: hard x1.2, good x ease, easy x ease x1.3.
    // Rounded to 0.1 day; capped at 10 years.
    c.e = Math.max(1.3, c.e + [0, -0.15, 0, 0.15][g]);
    if (c.n === 0) c.i = g === 1 ? 0.5 : g === 2 ? 1 : 3;
    else if (c.n === 1) c.i = g === 1 ? 2 : g === 2 ? 4 : 6;
    else c.i = Math.round(c.i * (g === 1 ? 1.2 : g === 2 ? c.e : c.e * 1.3) * 10) / 10;
    c.i = Math.min(c.i, 3650);
    c.n += 1;
    c.d = now + c.i * DAY;
  }
  c.t = now;
  return c;
}

export const isDue = (card, now = Date.now()) => !card || card.d <= now;

// Items to practise: due cards first (most overdue first), then new items in their order, at most `limit`.
export function dueItems(cards, ids, now = Date.now(), limit = 20) {
  const due = [], fresh = [];
  for (const id of ids) {
    const c = cards[id];
    if (!c) fresh.push(id);
    else if (c.d <= now) due.push([id, now - c.d]);
  }
  due.sort((a, b) => b[1] - a[1]);
  return [...due.map((x) => x[0]), ...fresh].slice(0, limit);
}

// Retention estimate: exp(-elapsed / tau), tau = 1.5 x interval (min 0.5 day). tau is the e-folding time, not a
// half-life: at elapsed = interval retention is exp(-1/1.5) ~ 0.51, so a card falls due near 50 % predicted recall.
// A lapsed card not yet relearned shows 0.1, not 0, so the UI can tell "seen and forgotten" from "new".
export function strength(card, now = Date.now()) {
  if (!card || card.n === 0) return card && card.l ? 0.1 : 0;
  const elapsed = Math.max(0, now - card.t) / DAY;
  return Math.exp(-elapsed / Math.max(0.5, card.i * 1.5));
}

// Sync conflict rule: last writer wins by t. Per-card LWW suffices because a card is one learner's history; a
// missing t counts as oldest.
export const merge = (a, b) => (!a ? b : !b ? a : (b.t || 0) > (a.t || 0) ? b : a);

// Guard for data read from storage or the network: every field a finite number, else the card is discarded.
export const validCard = (c) => !!c && typeof c === 'object' && [c.e, c.i, c.n, c.l, c.d, c.t].every((x) => typeof x === 'number' && Number.isFinite(x));
