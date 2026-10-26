// durak/public.js - public knowledge of a game: what every observer knows from the public log alone (engine.js
// log format), never what is in anybody's hand. Bots count cards with it, the replay viewer shows it, and the
// hidden-state entropy is computed from it.
//
//   track(info) -> tracker; tracker.step(entry) consumes one log entry; tracker.run(log) consumes many
//     info: { rs (normalized ruleset), n, handSize?, trumpCard, trumpSuit, counts? (hand sizes after the deal) }
//   tracker fields: counts[seat], stock, known[seat] (Set of uids known to be in that hand), located (Set: uids
//     whose place is public: table, discard, known hands, the open trump card), table [{ a, d, by }], discard [],
//     defender, taking, history (soft evidence for inference: [{ kind, seat, ... }])
//   hiddenEntropy(tracker) -> bits: log2 of the number of ways the cards nobody has seen can lie in the hands and the
//     stock, given the public hand sizes (copies of a card count as different physical cards)
//   unseen(tracker) -> [uid]: cards whose place is not public (they are in some hand or in the stock)

import { compile } from './ruleset.js';

// log2(k!) table.
//
// Card counting as an observer would do it: every card ever seen face up is located (table, discard, a hand it was
// taken into, the open trump). Because only the public log is used, bots built on this tracker are fair by
// construction, and the same tracker drives replays and the entropy display.
// LF: lazily grown table of log2(k!), so entropy needs no big-number arithmetic or overflow-prone factorials.
const LF = [0];
export function log2Fact(k) {
  for (let i = LF.length; i <= k; i++) LF[i] = LF[i - 1] + Math.log2(i);
  return LF[k];
}

// counts default to a full first hand per seat; when the deal exhausted the stock, callers pass actual counts.
// history keeps soft evidence (e.g. "passed although the table showed rank X") for probabilistic inference in bots.
export function track({ rs, n, trumpCard = -1, trumpSuit = null, handSize = null, counts = null }) {
  const C = compile(rs);
  const hs = handSize ?? rs.rules.handSize;
  const T = {
    C, rs, n, trumpCard, trumpSuit,
    counts: counts ? counts.slice() : Array.from({ length: n }, () => hs),
    stock: C.N - (counts ? counts.reduce((a, b) => a + b, 0) : n * hs),
    known: Array.from({ length: n }, () => new Set()),
    located: new Set(),
    table: [], discard: [], out: [],
    defender: -1, taking: false, trumpInStock: false,
    history: [], step: null, run: null, events: 0,
  };
  if (trumpCard >= 0 && T.stock > 0) { T.located.add(trumpCard); T.trumpInStock = true; }
  // Copies of a card are indistinguishable: when a seat known to hold a card of this definition plays one, the
  // observer takes it for the known copy (the other copy, if any, was never seen). Knowledge is a multiset of
  // definitions, so it never depends on which physical copy a player picked.
  const fromHand = (seat, u) => {
    T.counts[seat]--;
    const k = T.known[seat];
    if (k.has(u)) k.delete(u);
    else {
      const d = C.uidDef[u];
      for (const v of k) if (C.uidDef[v] === d) { k.delete(v); T.located.delete(v); break; }
    }
    T.located.add(u);
  };
  T.step = (e) => {
    T.events++;
    const [k, seat] = e;
    switch (k) {
      case 'L': case '+': {
        for (const u of e[2]) { fromHand(seat, u); T.table.push({ a: u, d: -1, by: seat }); }
        if (k === 'L') T.history.push({ kind: 'lead', seat, cards: e[2], table: [] });
        else T.history.push({ kind: 'throw', seat, cards: e[2], table: T.table.map((p) => p.a) });
        break;
      }
      case 'B': {
        const u = e[2], slot = e[3];
        fromHand(seat, u);
        if (T.table[slot]) T.table[slot].d = u;
        T.defender = seat;
        T.history.push({ kind: 'beat', seat, card: u, on: T.table[slot] ? T.table[slot].a : -1 });
        break;
      }
      case 'T': {
        const show = !!e[3];
        if (show) { for (const u of e[2]) { T.known[seat].add(u); T.located.add(u); } }
        else for (const u of e[2]) { fromHand(seat, u); T.table.push({ a: u, d: -1, by: seat }); }
        T.history.push({ kind: 'transfer', seat, cards: e[2], show });
        break;
      }
      case 'X': {
        T.taking = true;
        T.defender = seat;
        T.history.push({ kind: 'take', seat, open: T.table.filter((p) => p.d < 0).map((p) => p.a) });
        break;
      }
      case 'P': {
        T.history.push({ kind: 'pass', seat, table: T.table.flatMap((p) => (p.d >= 0 ? [p.a, p.d] : [p.a])) });
        break;
      }
      case 'S': {
        const given = e[2], got = e[3];
        fromHand(seat, given);
        T.counts[seat]++;
        T.known[seat].add(got);
        T.located.add(got);
        T.trumpCard = given;
        T.history.push({ kind: 'swap', seat, given, got });
        break;
      }
      // A take makes the whole table known in the defender's hand: the strongest card-counting signal in Durak.
      case '/': {
        const took = e[1], def = e[2];
        const cards = T.table.flatMap((p) => (p.d >= 0 ? [p.a, p.d] : [p.a]));
        if (took && def >= 0) { for (const u of cards) T.known[def].add(u); T.counts[def] += cards.length; }
        else T.discard.push(...cards);
        T.table = [];
        T.taking = false;
        break;
      }
      case 'D': {
        const cnt = e[2], tu = e[3];
        T.counts[seat] += cnt;
        T.stock -= cnt;
        if (tu >= 0) {
          // the open trump card went to this hand (also logged once with n = 0 when the deal used the whole stock)
          T.known[seat].add(tu);
          T.located.add(tu);
          T.trumpInStock = false;
        }
        break;
      }
      case 'O': T.out.push(seat); break;
      default: break;
    }
  };
  T.run = (log) => { for (const e of log) T.step(e); return T; };
  return T;
}

// Unknown cards per bin: hands (count minus known cards) and the stock (minus the open trump card).
export function hiddenBins(T) {
  const bins = T.counts.map((c, i) => Math.max(0, c - T.known[i].size));
  bins.push(Math.max(0, T.stock - (T.trumpInStock ? 1 : 0)));
  return bins;
}

// Multinomial coefficient U! / prod(k_i!): ways to distribute U unseen cards into bins of known sizes (hands minus
// known cards, stock minus the open trump). Copies are treated as distinct physical cards, so for multi-deck
// rulesets this overstates the uncertainty slightly (identical copies are interchangeable to a player).
export function hiddenEntropy(T) {
  const bins = hiddenBins(T);
  const U = bins.reduce((a, b) => a + b, 0);
  let h = log2Fact(U);
  for (const k of bins) h -= log2Fact(k);
  return Math.max(0, h);
}

export function unseen(T) {
  const out = [];
  for (let u = 0; u < T.C.N; u++) if (!T.located.has(u)) out.push(u);
  return out;
}

// Tracker of a view (engine.viewOf / the game's view): replays the view's public log.
export function trackView(view, rs) {
  const T = track({ rs, n: view.n, trumpCard: initialTrump(view), trumpSuit: view.trumpSuit });
  return T.run(view.log);
}

// The open trump card at the start: the current one, undone through the swaps in the log.
// Undoes trump exchanges backwards through the log: each 'S' entry records the card that was the open trump before.
export function initialTrump(v) {
  let t = v.trumpCard;
  for (let i = v.log.length - 1; i >= 0; i--) if (v.log[i][0] === 'S') t = v.log[i][3];
  return t;
}
