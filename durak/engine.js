// durak/engine.js - the game state machine of Durak on a data-driven ruleset (ruleset.js). Pure functions on plain
// JSON states, so the same code runs in browsers, in Node (server rooms, simulations) and inside bot searches.
//
//   newGame(ruleset, { players, rng, first, deal }) -> state
//   apply(state, seat, action) -> { state, events, error }     validated; the input state is never changed
//   applyInPlace(state, seat, action) -> error | null          the same on a state you own (searches)
//   legalActions(state, seat, { leads }) -> [action]           atomic actions (bots, hints)
//   turn(state) -> seat | -1                                   whose decision the game waits for (advisory: attackers
//                                                              may throw in and the defender may act at any time)
//   canBeat(state, defUid, atkUid), matches(state, u1, u2), throwOptions(state, seat), transferOptions(...)
//   viewOf(state, seat) -> what that seat may see (seat -1 = spectator)
//   result(state) -> null | { durak, draw, places, losers, winners, pogony }
//
// Actions: { type: 'lead', cards }, { type: 'throw', cards }, { type: 'beat', card, slot }, { type: 'transfer',
// cards, show? }, { type: 'take' }, { type: 'pass' }, { type: 'swap', card }. Cards are uids (physical cards,
// numbered in the ruleset's definition order; C.uidDef maps a uid to its definition).
//
// Flow: the attacker leads; the defender beats each attack card, transfers (perevodnoy, while nothing is beaten
// and the table is uniform: wildcards ignored) or takes; eligible players throw in cards that match a card on the
// table (rank classes, wildcards) within the limits. A bout ends when every attack card is beaten (or the defender
// takes) and no eligible player still wants to throw in: a pass counts until the player gets a new option, and a
// player without options has passed. Then everybody draws (the bout's first attacker first, the defender last),
// players without cards leave once the stock is empty, and the last player holding cards is the durak.
//
// Public log (state.log, also in views): ['L', seat, uids] lead, ['+', seat, uids] throw-in, ['B', seat, uid, slot]
// beat, ['T', seat, uids, show] transfer, ['X', seat] take, ['P', seat] pass, ['S', seat, given, got] trump swap,
// ['/', took, defender] bout end (0 = beaten off, 1 = picked up), ['D', seat, n, trumpUid] draw, ['O', seat] out, ['E'] end.

import { compile, normalizeRuleset, playerRange } from './ruleset.js';

export { compile };

//
// Architecture notes:
// - Cards are uids 0..N-1 (physical cards); all rule questions go through compile() tables indexed by definition,
//   so a beat check is one typed-array read. This is what makes bot tree search affordable.
// - Real Durak is asynchronous (anyone may throw in at any moment). The engine serialises it: turn() names whose
//   decision is awaited, but actors() lists everyone allowed to act, and the server accepts actions from any actor.
// - "Pass until new options": a pass stores the cards the player could throw at that moment; the pass is void as
//   soon as a new throwable card appears (hasPassed compares). This ends bouts deterministically without timers.
// - Information note: settle() ends a bout as soon as no thrower has options, and actors()/turn() exclude players
//   without options; other seats can thus infer "nobody can throw". This mirrors the table reality (a bout ends when
//   nobody throws), but bots and UIs should not read more into it than that.
const clone = (o) => JSON.parse(JSON.stringify(o));

// --- setup -----------------------------------------------------------------------------------------------------

/**
 * A new game. players: number of seats; rng: prng/prng.js source (shuffle); first: seat that leads (optional);
 * deal: a given deck order (uids, bottom first) instead of shuffling (replays); trumpSuit: the suit of a 'random'
 * trump (replays).
 */
// A deal (explicit card order) makes replays exact without storing the rng; otherwise the rng shuffles.
// The open trump card must define a usable trump suit, so a suitless or eternal-suit card at the bottom is swapped
// with the deepest fitting card (minimal disturbance of the shuffle).
export function newGame(rsIn, { players = 2, rng, first = null, deal = null, trumpSuit = null } = {}) {
  const rs = normalizeRuleset(rsIn);
  const C = compile(rs);
  const R = rs.rules;
  const pr = playerRange(rs);
  const n = Math.max(2, Math.min(players | 0, Math.max(pr.max, 2)));
  if (n * R.handSize > C.N) throw new Error(`not enough cards for ${n} players`);
  let order;
  if (deal) {
    order = deal.slice();
    if (order.length !== C.N || new Set(order).size !== C.N || order.some((u) => !(u >= 0 && u < C.N))) throw new Error('bad deal');
  } else {
    order = Array.from({ length: C.N }, (_, i) => i);
    if (!rng) throw new Error('newGame needs an rng or a deal');
    rng.shuffle(order);
    // The open trump card must have a suit that is not an eternal trump: the deepest such card goes to the bottom.
    const fit = (u) => { const d = C.defs[C.uidDef[u]]; return !!d.suit && !R.eternal.includes(d.suit); };
    if (R.trump === 'bottom' && !fit(order[0])) {
      const k = order.findIndex(fit);
      if (k > 0) { const t = order[0]; order[0] = order[k]; order[k] = t; }
    }
  }
  // stock[0] is the bottom card (the open trump), draws pop from the end: O(1) per draw.
  // passes: seat -> cards that seat could throw when it passed. lastBout feeds pogony scoring and the UI.
  const s = {
    v: 1, rs, n,
    stock: order.slice(),       // index 0 = bottom (the open trump card), draws take from the end
    deal: order.slice(),        // the initial order (hidden until the game is over)
    trumpSuit: null, trumpCard: -1,
    hands: Array.from({ length: n }, () => []),
    table: [],                  // [{ a: uid, d: uid | -1, by: seat }]
    phase: 'lead', attacker: 0, defender: 1, leader: 0,
    taking: false, passes: {}, closed: false, shown: [],
    boutNo: 1, discard: [], out: [], log: [], result: null, lastBout: null,
  };
  // Trump
  if (R.trump === 'bottom') {
    s.trumpCard = s.stock[0];
    s.trumpSuit = C.defs[C.uidDef[s.trumpCard]].suit;
  } else if (R.trump === 'random') {
    const suits = rs.deck.suits.map((x) => x.id);
    s.trumpSuit = trumpSuit && suits.includes(trumpSuit) ? trumpSuit : rng ? suits[rng.int(suits.length)] : suits[order[0] % suits.length];
  } else if (R.trump !== 'none') s.trumpSuit = R.trump;
  // Deal round-robin from the top of the stock.
  for (let k = 0; k < R.handSize; k++) for (let i = 0; i < n; i++) s.hands[i].push(s.stock.pop());
  for (const h of s.hands) sortHand(s, h);
  // When the deal used up the stock, the open trump card was dealt: everybody saw it (logged as a draw).
  // First attacker
  let a = 0;
  if (first != null && first >= 0 && first < n) a = first;
  else if (R.first === 'random') a = rng ? rng.int(n) : 0;
  else if (R.first === 'lowestTrump') {
    // Lowest trump leads: compares only cards of the drawn trump suit at tier 1 (eternal/'always' cards excluded),
    // ties (multi-deck copies) broken by the rng.
    let best = Infinity, who = [];
    const t = C.trumpIndex(s.trumpSuit);
    for (let i = 0; i < n; i++) {
      for (const u of s.hands[i]) {
        const d = C.uidDef[u];
        if (C.tier[t][d] !== 1 || C.defs[d].suit !== s.trumpSuit) continue;
        const v = C.value[d];
        if (v < best) { best = v; who = [i]; } else if (v === best && !who.includes(i)) who.push(i);
      }
    }
    a = who.length ? who[rng && who.length > 1 ? rng.int(who.length) : 0] : rng ? rng.int(n) : 0;
  }
  s.attacker = a;
  s.leader = a;
  s.defender = nextOpponent(s, a);
  s.firstSeat = a;
  if (s.trumpCard >= 0 && !s.stock.includes(s.trumpCard)) {
    // the trump card went to a player in the deal: public
    const holder = s.hands.findIndex((h) => h.includes(s.trumpCard));
    s.log.push(['D', holder, 0, s.trumpCard]);
  }
  return s;
}

// Sorts a hand for display: non-trumps by suit order then value, trumps last.
// Display order only (rules never depend on hand order): plain cards by suit then value, wildcards, then trumps by
// tier; the uid as the last key makes the order total and deterministic.
export function sortHand(s, hand) {
  const C = compile(s.rs);
  const t = C.trumpIndex(s.trumpSuit);
  const suitOrder = new Map(s.rs.deck.suits.map((x, i) => [x.id, i]));
  const key = (u) => {
    const d = C.uidDef[u];
    const def = C.defs[d];
    return [C.tier[t][d], C.wild[d], def.suit ? suitOrder.get(def.suit) : 99, C.value[d], u];
  };
  hand.sort((x, y) => {
    const a = key(x), b = key(y);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  });
  return hand;
}

// --- seats -----------------------------------------------------------------------------------------------------

const inGame = (s, i) => !s.out.includes(i);
export const teamOf = (s, i) => (s.rs.rules.teams ? i % s.rs.rules.teams : i);
const mates = (s, i, j) => !!s.rs.rules.teams && i !== j && teamOf(s, i) === teamOf(s, j);

// Next seat in the playing direction that is still in the game (skips `skip` too).
// Double modulo handles direction -1 (JS % keeps the sign).
export function nextSeat(s, i, skip = -1) {
  const dir = s.rs.rules.direction === -1 ? -1 : 1;
  for (let k = 1; k <= s.n; k++) {
    const j = (((i + dir * k) % s.n) + s.n) % s.n;
    if (inGame(s, j) && j !== skip) return j;
  }
  return -1;
}
export function prevSeat(s, i) {
  const dir = s.rs.rules.direction === -1 ? 1 : -1;
  for (let k = 1; k <= s.n; k++) {
    const j = (((i + dir * k) % s.n) + s.n) % s.n;
    if (inGame(s, j)) return j;
  }
  return -1;
}
// Next seat that is not a team mate of `i` (the defender of `i`'s attack).
// In team games the defender is the next seat that is not a team mate; if everybody left is a mate, falls back to
// the next seat (the game is about to end anyway).
export function nextOpponent(s, i) {
  let j = nextSeat(s, i);
  const start = j;
  while (j >= 0 && mates(s, i, j)) {
    j = nextSeat(s, j);
    if (j === start || j === i) break;
  }
  return j >= 0 && !mates(s, i, j) ? j : nextSeat(s, i);
}

// Hand size of a seat on a state or a view (views carry counts, and only the own hand).
export const handSize = (s, i) => (s.hands[i] ? s.hands[i].length : s.counts ? s.counts[i] : 0);

// --- card relations --------------------------------------------------------------------------------------------

export function canBeat(s, d, a) {
  const C = compile(s.rs);
  return C.beat[C.trumpIndex(s.trumpSuit)][C.uidDef[d] * C.D + C.uidDef[a]] === 1;
}
export function matches(s, u, v) {
  const C = compile(s.rs);
  return C.match[C.uidDef[u] * C.D + C.uidDef[v]] === 1;
}
export function trumpTier(s, u) {
  const C = compile(s.rs);
  return C.tier[C.trumpIndex(s.trumpSuit)][C.uidDef[u]];
}

// Uniform group (multi-card leads, transfers): the cards that are not wildcards share a rank class, and every
// wildcard matches some other card of the group (a single card is always uniform).
// Two-pass check: non-wild cards must share a common rank class (intersection of class sets, since a card may count
// as several ranks), then every wildcard must match some other card of the group. Wildcards therefore cannot make
// two different ranks uniform, which keeps transfers honest.
export function uniform(C, uids) {
  if (uids.length <= 1) return true;
  let common = null;
  for (const u of uids) {
    const d = C.uidDef[u];
    if (C.wild[d]) continue;
    common = common === null ? C.cls[d].slice() : common.filter((c) => C.cls[d].includes(c));
    if (!common.length) return false;
  }
  for (const u of uids) {
    const d = C.uidDef[u];
    if (!C.wild[d]) continue;
    if (!uids.some((v) => v !== u && C.match[d * C.D + C.uidDef[v]])) return false;
  }
  return true;
}

// --- limits and options ----------------------------------------------------------------------------------------

export const unbeaten = (s) => s.table.reduce((n, p) => n + (p.d < 0 ? 1 : 0), 0);

// How many more attack cards the table can take now.
// Remaining capacity of the bout: the bout limit (5 in the first bout by default) and, with limitByHand, the
// defender's ability to answer (unbeaten cards may never exceed the defender's hand).
export function room(s) {
  const R = s.rs.rules;
  const lim = s.boutNo === 1 && R.firstBoutLimit ? R.firstBoutLimit : R.boutLimit;
  let r = lim ? lim - s.table.length : 99;
  if (R.limitByHand) r = Math.min(r, handSize(s, s.defender) - unbeaten(s));
  return Math.max(0, r);
}

// Players allowed to throw in this bout, in priority order (the attacker first, then on from the defender).
// Priority order matters for turn(): the attacker first, then around the table from the defender, matching the
// customary order in which players are asked.
export function throwers(s) {
  if (s.phase !== 'bout') return [];
  const R = s.rs.rules, d = s.defender;
  const out = [];
  const ok = (i) => i >= 0 && i !== d && inGame(s, i) && !mates(s, i, d) && !out.includes(i);
  if (R.throwIn === 'attacker') { if (ok(s.attacker)) out.push(s.attacker); return out; }
  if (R.throwIn === 'neighbors') {
    const nb = [prevSeat(s, d), nextSeat(s, d)];
    if (nb.includes(s.attacker) && ok(s.attacker)) out.push(s.attacker);
    for (const i of nb) if (ok(i)) out.push(i);
    return out;
  }
  if (ok(s.attacker)) out.push(s.attacker);
  for (let i = nextSeat(s, d), k = 0; i >= 0 && i !== d && k < s.n; i = nextSeat(s, i), k++) if (ok(i)) out.push(i);
  return out;
}

// Cards `seat` could throw in now (one at a time).
export function throwOptions(s, seat) {
  if (s.phase !== 'bout' || s.closed || !throwers(s).includes(seat)) return [];
  if (s.taking && !s.rs.rules.throwAfterTake) return [];
  if (room(s) < 1) return [];
  const C = compile(s.rs);
  const hand = s.hands[seat] || [];
  const out = [];
  for (const u of hand) {
    const du = C.uidDef[u];
    if (C.noThrow[du]) continue;
    for (const p of s.table) {
      if (C.match[du * C.D + C.uidDef[p.a]] || (p.d >= 0 && C.match[du * C.D + C.uidDef[p.d]])) { out.push(u); break; }
    }
  }
  return out;
}

// Has `seat` passed (explicitly with no new options since, or with nothing to throw)?
export function hasPassed(s, seat) {
  const opts = throwOptions(s, seat);
  if (!opts.length) return true;
  const p = s.passes[seat];
  return Array.isArray(p) && opts.every((u) => p.includes(u));
}

export function pendingThrowers(s) {
  return throwers(s).filter((i) => !hasPassed(s, i));
}

// Whose decision the game waits for: the attacker to lead, the defender with unbeaten cards, else the first thrower
// that has not passed. -1 when nobody (game over).
export function turn(s) {
  if (s.phase === 'lead') return s.attacker;
  if (s.phase !== 'bout') return -1;
  if (!s.taking && unbeaten(s) > 0) return s.defender;
  const p = pendingThrowers(s);
  return p.length ? p[0] : -1;
}

// Seats that may act now (any legal action).
export function actors(s) {
  if (s.phase === 'lead') return [s.attacker];
  if (s.phase !== 'bout') return [];
  const out = [];
  if (!s.taking && unbeaten(s) > 0) out.push(s.defender);
  for (const i of throwers(s)) if (!out.includes(i) && (throwOptions(s, i).length || !hasPassed(s, i))) out.push(i);
  return out;
}

// Can the defender transfer with `cards` (or show `cards[0]`)? Returns the new defender or -1.
// Perevodnoy transfer rules: only before any card is beaten, uniform with the table (wildcards ignored for
// uniformity), and the next defender must be able to receive the whole table (bout limit, hand size).
// A show-transfer (trump of the rank shown, kept in hand) may be used once per card per bout (s.shown).
export function transferTarget(s, seat, cards, show = false) {
  const R = s.rs.rules;
  if (!R.transfer || s.phase !== 'bout' || seat !== s.defender || s.taking || !cards.length) return -1;
  if (s.table.some((p) => p.d >= 0)) return -1;
  if (show && (!R.transferShow || cards.length !== 1)) return -1;
  const C = compile(s.rs);
  const hand = s.hands[seat] || [];
  if (cards.some((u) => !hand.includes(u)) || new Set(cards).size !== cards.length) return -1;
  if (cards.some((u) => C.noTransfer[C.uidDef[u]])) return -1;
  if (show) {
    const u = cards[0];
    if (s.shown.includes(u)) return -1;
    const t = C.trumpIndex(s.trumpSuit);
    if (C.tier[t][C.uidDef[u]] < 1) return -1;
  }
  const all = [...s.table.map((p) => p.a), ...cards];
  if (!uniform(C, all)) return -1;
  // Every new card must match the table (a wildcard of the right colour, or the rank on the table).
  for (const u of cards) {
    const du = C.uidDef[u];
    if (!s.table.some((p) => C.match[du * C.D + C.uidDef[p.a]])) return -1;
  }
  // The next defender (the player after this one) must be able to answer every card.
  const nd = nextOpponent(s, seat);
  if (nd < 0 || nd === seat) return -1;
  const total = s.table.length + (show ? 0 : cards.length);
  const lim = s.boutNo === 1 && R.firstBoutLimit ? R.firstBoutLimit : R.boutLimit;
  if (lim && total > lim) return -1;
  if (R.limitByHand && handSize(s, nd) < total) return -1;
  return nd;
}

// Single cards (and shows) the defender could transfer with.
export function transferOptions(s, seat) {
  const out = [];
  if (!s.rs.rules.transfer || seat !== s.defender || s.phase !== 'bout') return out;
  for (const u of s.hands[seat] || []) {
    if (transferTarget(s, seat, [u]) >= 0) out.push({ type: 'transfer', cards: [u] });
    if (s.rs.rules.transferShow && transferTarget(s, seat, [u], true) >= 0) out.push({ type: 'transfer', cards: [u], show: true });
  }
  return out;
}

// Cards the defender can beat slot `i` with.
export function beatOptions(s, seat, slot) {
  if (s.phase !== 'bout' || seat !== s.defender || s.taking) return [];
  const p = s.table[slot];
  if (!p || p.d >= 0) return [];
  const C = compile(s.rs);
  const b = C.beat[C.trumpIndex(s.trumpSuit)];
  const da = C.uidDef[p.a];
  return (s.hands[seat] || []).filter((u) => b[C.uidDef[u] * C.D + da] === 1);
}

// Can these cards be led together?
// noLead cards may still lead when the hand holds nothing else: otherwise a hand of only noLead cards would deadlock.
export function leadOk(s, seat, cards) {
  const R = s.rs.rules;
  if (s.phase !== 'lead' || seat !== s.attacker || !cards.length) return false;
  const C = compile(s.rs);
  const hand = s.hands[seat] || [];
  if (cards.some((u) => !hand.includes(u)) || new Set(cards).size !== cards.length) return false;
  // Cards that may not lead do lead when the hand holds nothing else.
  if (cards.some((u) => C.noLead[C.uidDef[u]]) && hand.some((u) => !C.noLead[C.uidDef[u]])) return false;
  if (cards.length > 1 && !R.leadMulti) return false;
  if (!uniform(C, cards)) return false;
  const lim = s.boutNo === 1 && R.firstBoutLimit ? R.firstBoutLimit : R.boutLimit;
  if (lim && cards.length > lim) return false;
  if (R.limitByHand && cards.length > handSize(s, s.defender)) return false;
  return true;
}

// Trump exchange: the lowest trump of the trump suit may replace the open trump card while it is still in the stock
// (stock.length >= 2 so the swap is not the last draw).
export function swapOk(s, seat, card) {
  const R = s.rs.rules;
  if (!R.trumpExchange || s.phase === 'over' || s.trumpCard < 0 || s.stock.length < 2 || s.stock[0] !== s.trumpCard) return false;
  const hand = s.hands[seat] || [];
  if (!hand.includes(card)) return false;
  const C = compile(s.rs);
  const def = C.defs[C.uidDef[card]];
  return def.suit === s.trumpSuit && def.rank != null && C.value[C.uidDef[card]] === C.lowBySuit[s.trumpSuit];
}

/**
 * Legal atomic actions of `seat`. leads: 'all' (every uniform group up to 4 cards), 'groups' (single cards plus
 * every same-class group as a whole and pairs), default 'groups'.
 */
// Atomic actions for bots. 'groups' limits multi-card leads to singles, pairs and whole classes, a pruning that
// keeps the branching factor manageable; 'all' enumerates every uniform group up to 4 cards.
export function legalActions(s, seat, { leads = 'groups' } = {}) {
  const out = [];
  if (s.phase === 'over') return out;
  const C = compile(s.rs);
  const hand = s.hands[seat] || [];
  if (s.phase === 'lead') {
    if (seat !== s.attacker) return out;
    const seen = new Set();
    const add = (cards) => {
      const key = cards.slice().sort((a, b) => a - b).join(',');
      if (seen.has(key) || !leadOk(s, seat, cards)) return;
      seen.add(key);
      out.push({ type: 'lead', cards });
    };
    for (const u of hand) add([u]);
    if (s.rs.rules.leadMulti) {
      for (let i = 0; i < hand.length; i++) {
        for (let j = i + 1; j < hand.length; j++) {
          if (!C.match[C.uidDef[hand[i]] * C.D + C.uidDef[hand[j]]]) continue;
          add([hand[i], hand[j]]);
          if (leads === 'all') for (let k = j + 1; k < hand.length; k++) { add([hand[i], hand[j], hand[k]]); for (let l = k + 1; l < hand.length; l++) add([hand[i], hand[j], hand[k], hand[l]]); }
        }
        // the whole class of this card
        const grp = hand.filter((v) => !C.wild[C.uidDef[v]] && C.cls[C.uidDef[v]].some((c) => C.cls[C.uidDef[hand[i]]].includes(c)));
        if (grp.length > 2) add(grp);
      }
    }
  } else if (s.phase === 'bout') {
    if (seat === s.defender && !s.taking) {
      s.table.forEach((p, i) => { if (p.d < 0) for (const u of beatOptions(s, seat, i)) out.push({ type: 'beat', card: u, slot: i }); });
      out.push(...transferOptions(s, seat));
      if (unbeaten(s) > 0) out.push({ type: 'take' });
    }
    if (throwers(s).includes(seat)) {
      for (const u of throwOptions(s, seat)) out.push({ type: 'throw', cards: [u] });
      out.push({ type: 'pass' });
    }
  }
  if (s.rs.rules.trumpExchange) for (const u of hand) if (swapOk(s, seat, u)) out.push({ type: 'swap', card: u });
  return out;
}

// --- applying actions ------------------------------------------------------------------------------------------

export function apply(state, seat, action) {
  const s = cloneState(state);
  const before = s.log.length;
  const err = applyInPlace(s, seat, action);
  if (err) return { state, events: [], error: err };
  return { state: s, events: s.log.slice(before), error: null };
}

// Structural clone tailored to the state shape: arrays copied one level deep, immutable parts shared (rs, deal,
// result, lastBout). Much faster than a JSON clone, which matters in bot searches that clone per node.
export function cloneState(s) {
  return {
    ...s,
    stock: s.stock.slice(), deal: s.deal, hands: s.hands.map((h) => h.slice()),
    table: s.table.map((p) => ({ ...p })), passes: { ...s.passes }, shown: s.shown.slice(),
    discard: s.discard.slice(), out: s.out.slice(), log: s.log.slice(), result: s.result,
    lastBout: s.lastBout,
  };
}

const removeCards = (hand, cards) => { for (const u of cards) { const i = hand.indexOf(u); if (i >= 0) hand.splice(i, 1); } };

// Applies an action on `s` (mutates). Returns an error code or null.
// Every branch validates before mutating, so an error leaves the state unchanged. Card lists are coerced with |0
// (client input). A multi-card throw re-checks options after each card, since each thrown card changes room().
export function applyInPlace(s, seat, action) {
  if (!action || typeof action !== 'object') return 'bad-action';
  if (s.phase === 'over') return 'game-over';
  if (!(seat >= 0 && seat < s.n)) return 'bad-seat';
  const C = compile(s.rs);
  const hand = s.hands[seat];
  const cards = Array.isArray(action.cards) ? action.cards.map((x) => x | 0) : [];
  switch (action.type) {
    case 'lead': {
      if (!leadOk(s, seat, cards)) return 'illegal-lead';
      removeCards(hand, cards);
      for (const u of cards) s.table.push({ a: u, d: -1, by: seat });
      s.phase = 'bout';
      s.log.push(['L', seat, cards]);
      break;
    }
    case 'throw': {
      if (!cards.length || new Set(cards).size !== cards.length) return 'illegal-throw';
      if (room(s) < cards.length) return 'limit';
      for (const u of cards) {
        if (!throwOptions(s, seat).includes(u)) return 'illegal-throw';
        removeCards(hand, [u]);
        s.table.push({ a: u, d: -1, by: seat });
      }
      s.log.push(['+', seat, cards]);
      break;
    }
    case 'beat': {
      const slot = action.slot | 0, card = action.card | 0;
      if (!beatOptions(s, seat, slot).includes(card)) return 'illegal-beat';
      removeCards(hand, [card]);
      s.table[slot].d = card;
      if (C.closesBout[C.uidDef[card]]) s.closed = true;
      s.log.push(['B', seat, card, slot]);
      break;
    }
    case 'transfer': {
      const show = !!action.show;
      const nd = transferTarget(s, seat, cards, show);
      if (nd < 0) return 'illegal-transfer';
      if (show) s.shown.push(cards[0]);
      else { removeCards(hand, cards); for (const u of cards) s.table.push({ a: u, d: -1, by: seat }); }
      s.attacker = seat;
      s.defender = nd;
      s.passes = {};
      s.log.push(['T', seat, cards, show ? 1 : 0]);
      break;
    }
    case 'take': {
      if (s.phase !== 'bout' || seat !== s.defender || s.taking || unbeaten(s) === 0) return 'illegal-take';
      s.taking = true;
      s.passes = {};
      s.log.push(['X', seat]);
      break;
    }
    case 'pass': {
      if (s.phase !== 'bout' || !throwers(s).includes(seat)) return 'illegal-pass';
      s.passes[seat] = throwOptions(s, seat);
      s.log.push(['P', seat]);
      break;
    }
    case 'swap': {
      const card = action.card | 0;
      if (!swapOk(s, seat, card)) return 'illegal-swap';
      const old = s.trumpCard;
      removeCards(hand, [card]);
      hand.push(old);
      s.stock[0] = card;
      s.trumpCard = card;
      sortHand(s, hand);
      s.log.push(['S', seat, card, old]);
      break;
    }
    default:
      return 'unknown-action';
  }
  settle(s);
  return null;
}

// Ends bouts whose conditions are met (repeatedly: nothing else can happen in between).
// A state with `manual` set (public replays) never ends bouts by itself: endBoutNow() does.
// Bout end is automatic: all attack cards beaten (or the defender takes) and no thrower still pending. The guard
// bounds the loop (an end can never be immediately followed by another in practice).
function settle(s) {
  if (s.manual) return;
  for (let guard = 0; guard < 8 && s.phase === 'bout'; guard++) {
    const unb = unbeaten(s);
    if (!(s.taking || unb === 0)) return;
    if (pendingThrowers(s).length) return;
    endBout(s, s.taking);
  }
}

// Ends the current bout now (public replays, where the record says when a bout ended): null or an error code.
export function endBoutNow(s, took) {
  if (s.phase !== 'bout') return 'no-bout';
  if (!!took !== !!s.taking) return took ? 'not-taking' : 'still-taking';
  if (!s.taking && unbeaten(s) > 0) return 'unbeaten-cards';
  endBout(s, s.taking);
  return null;
}

// Draw order: the bout's first attacker, then around the table, the defender last (classic rule: the defender
// draws last because they just used cards on defence). Players without cards leave only once the stock is empty.
// Next attacker: after a take, the player after the defender; after a successful defence, the defender.
function endBout(s, took) {
  const R = s.rs.rules;
  const cards = [];
  for (const p of s.table) { cards.push(p.a); if (p.d >= 0) cards.push(p.d); }
  const def = s.defender;
  s.lastBout = { attacker: s.attacker, leader: s.leader, defender: def, took: !!took, table: s.table.map((p) => ({ ...p })) };
  if (took) { s.hands[def].push(...cards); sortHand(s, s.hands[def]); } else s.discard.push(...cards);
  s.log.push(['/', took ? 1 : 0, def]);
  s.table = [];
  s.taking = false;
  s.passes = {};
  s.closed = false;
  s.shown = [];
  s.boutNo++;
  // Draw: the bout's first attacker, then on around the table, the defender last.
  const order = [];
  if (inGame(s, s.leader) && s.leader !== def) order.push(s.leader);
  for (let i = nextSeat(s, s.leader), k = 0; i >= 0 && k < s.n; i = nextSeat(s, i), k++) if (i !== def && !order.includes(i)) order.push(i);
  if (inGame(s, def)) order.push(def);
  for (const i of order) {
    const need = R.handSize - s.hands[i].length;
    if (need <= 0 || !s.stock.length) continue;
    const got = [];
    for (let k = 0; k < need && s.stock.length; k++) got.push(s.stock.pop());
    s.hands[i].push(...got);
    sortHand(s, s.hands[i]);
    s.log.push(['D', i, got.length, got.includes(s.trumpCard) ? s.trumpCard : -1]);
  }
  // Out: no cards and nothing to draw.
  if (!s.stock.length) {
    for (const i of order) if (!s.hands[i].length && inGame(s, i)) { s.out.push(i); s.log.push(['O', i]); }
  }
  const left = [];
  for (let i = 0; i < s.n; i++) if (inGame(s, i)) left.push(i);
  const oneTeamLeft = R.teams && left.length > 1 && left.every((i) => teamOf(s, i) === teamOf(s, left[0]));
  if (left.length <= 1 || oneTeamLeft) {
    s.phase = 'over';
    s.result = makeResult(s, left);
    s.log.push(['E']);
    return;
  }
  const att = took ? nextSeat(s, def) : inGame(s, def) ? def : nextSeat(s, def);
  s.attacker = att;
  s.leader = att;
  s.defender = nextOpponent(s, att);
  s.phase = 'lead';
}

// Pogony ("epaulettes"): the durak was finished with cards of the lowest rank, at most two (one per shoulder).
function makeResult(s, left) {
  const R = s.rs.rules;
  const C = compile(s.rs);
  const durak = left.length === 1 ? left[0] : left.length > 1 ? left[0] : -1;
  const places = [...s.out, ...left];
  let pogony = 0;
  if (R.pogony && durak >= 0 && s.lastBout) {
    for (const p of s.lastBout.table) {
      const d = C.uidDef[p.a];
      if (C.defs[d].rank && C.value[d] === C.lowValue && p.by !== durak) pogony++;
    }
    pogony = Math.min(2, pogony);
  }
  let losers = [], winners = [];
  if (left.length === 0) { winners = []; losers = []; }
  else if (R.teams) {
    const lt = teamOf(s, left[0]);
    for (let i = 0; i < s.n; i++) (teamOf(s, i) === lt ? losers : winners).push(i);
  } else {
    losers = left.slice();
    winners = s.out.slice();
  }
  return { over: true, draw: left.length === 0, durak, places, losers, winners, pogony, bouts: s.boutNo - 1 };
}

export function result(s) {
  return s.phase === 'over' ? s.result : null;
}

// --- views -----------------------------------------------------------------------------------------------------

/**
 * What `seat` may see: its own hand, everyone's card counts, the table, the open trump card, the public log (which
 * includes every card that was ever shown). Spectators (seat -1) see no hand. When the game is over, the deal
 * and all hands are open.
 */
// The information gate: own hand only, counts of others, the public log. The stored pass options of other seats are
// replaced by 1 (they reveal hidden cards). The deal is revealed only after the game.
// The log array is shared with the state (no copy); consumers must not mutate it.
export function viewOf(s, seat) {
  const over = s.phase === 'over';
  // A pass remembers the cards the player could have thrown in (private): other seats only learn that it passed.
  const passes = {};
  for (const [k, v] of Object.entries(s.passes)) passes[k] = over || +k === seat ? v : 1;
  return {
    v: 1, rs: s.rs, n: s.n, seat,
    hands: s.hands.map((h, i) => (over || i === seat ? h.slice() : null)),
    counts: s.hands.map((h) => h.length),
    stock: s.stock.length,
    trumpSuit: s.trumpSuit, trumpCard: s.trumpCard, trumpInStock: s.trumpCard >= 0 && s.stock.length > 0 && s.stock[0] === s.trumpCard,
    table: s.table.map((p) => ({ ...p })),
    phase: s.phase, attacker: s.attacker, defender: s.defender, leader: s.leader,
    taking: s.taking, passes, closed: s.closed, shown: s.shown.slice(),
    boutNo: s.boutNo, discard: s.discard.length, out: s.out.slice(), firstSeat: s.firstSeat,
    log: s.log, result: s.result,
    turn: turn(s), actors: actors(s),
    deal: over ? s.deal : null,
  };
}

export { clone as cloneJSON };
