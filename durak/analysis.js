// durak/analysis.js - style analysis of a player's decisions, achievements and comparison with the bot profiles.
// The same observer runs on people (the application records each decision) and on bots (sim.js), so a person's style
// can be placed among the bot templates ("your style is closest to the Miser").
//
//   newCounters() -> counters;  observe(counters, view, seat, action)   one decision (the view before it)
//   features(counters) -> { takeRate, strategicTake, transferRate, trumpThrift, cheapness, aggression, multiLead,
//                           trumpLead, lowLead }  (0..1 each; null when never observed)
//   STYLE_FEATURES: [{ id, weight }];  compare(features, profiles) -> [{ id, distance, similarity }] closest first
//   traitsOf(features) -> [badge id]  style badges ("trump keeper", "transfer lover", ...)
//   gameSummary(log, seat, result, extra) -> summary of one game for achievements
//   ACHIEVEMENTS: [{ id, test(summary, history) }];  newAchievements(history, summary) -> [id]

import { compile } from './ruleset.js';
import { beatOptions, throwOptions, transferOptions, unbeaten } from './engine.js';

//
// Counters accumulate (mergeable across games by addition); features are ratios of sums computed at read time, null
// when the denominator is zero. Every feature conditions on having had the choice (e.g. trumpThrift counts only
// beats where a plain card would also have worked), so a player is not judged for forced moves.
export const STYLE_FEATURES = [
  { id: 'takeRate', weight: 1 },        // takes per defence decision
  { id: 'strategicTake', weight: 1.2 }, // takes although every card could be beaten
  { id: 'transferRate', weight: 1 },    // transfers per transfer chance
  { id: 'trumpThrift', weight: 1.4 },   // beats without a trump when a plain card could beat
  { id: 'cheapness', weight: 1 },       // beats with the cheapest card that works
  { id: 'aggression', weight: 1.4 },    // throw-ins per chance
  { id: 'multiLead', weight: 0.8 },     // leads with several cards
  { id: 'trumpLead', weight: 0.8 },     // leads with trumps while the stock lasts
  { id: 'lowLead', weight: 1 },         // leads with the lowest card in hand
];

export function newCounters() {
  return { def: 0, take: 0, beatable: 0, takeBeatable: 0, transferOpp: 0, transfer: 0, beats: 0, cheapest: 0, avoidTrumpOpp: 0, trumpAvoidable: 0, throwOpp: 0, throws: 0, leads: 0, multi: 0, trumpLead: 0, leadsStock: 0, lowLead: 0 };
}

// Card "power" = share of the deck a card definition can beat under the current trump: a ruleset-independent
// measure of cheapness (works for jokers and custom cards where face value means little). Cached per ruleset+trump.
const POW = new Map();
function power(C, t) {
  const key = C.rs.hash + ':' + t;
  if (POW.has(key)) return POW.get(key);
  const p = new Float64Array(C.D);
  for (let d = 0; d < C.D; d++) { let n = 0; for (let a = 0; a < C.D; a++) if (C.beat[t][d * C.D + a]) n += C.defs[a].copies; p[d] = n / C.N; }
  POW.set(key, p);
  return p;
}

/** Records one decision of `seat` taken on `view` (the seat's view before the action). */
// Uses only the acting seat's view, so the same code can run on the client for a human without hidden information.
export function observe(cn, view, seat, action) {
  if (!view || !action || !view.rs) return;
  const s = view;
  const C = compile(s.rs);
  const t = C.trumpIndex(s.trumpSuit);
  const pw = power(C, t);
  const hand = s.hands[seat] || [];
  const isTrump = (u) => C.tier[t][C.uidDef[u]] > 0;
  if (s.phase === 'lead' && seat === s.attacker && action.type === 'lead') {
    cn.leads++;
    if (action.cards.length > 1) cn.multi++;
    if (s.stock > 0) { cn.leadsStock++; if (action.cards.some(isTrump)) cn.trumpLead++; }
    const low = Math.min(...hand.map((u) => pw[C.uidDef[u]]));
    if (action.cards.some((u) => pw[C.uidDef[u]] <= low + 1e-9)) cn.lowLead++;
    return;
  }
  if (s.phase !== 'bout') return;
  if (seat === s.defender && !s.taking && unbeaten(s) > 0 && ['beat', 'take', 'transfer'].includes(action.type)) {
    cn.def++;
    const slots = s.table.map((p, i) => (p.d < 0 ? i : -1)).filter((i) => i >= 0);
    const allBeatable = slots.every((i) => beatOptions(s, seat, i).length > 0);
    if (allBeatable) cn.beatable++;
    const tr = transferOptions(s, seat);
    if (tr.length) cn.transferOpp++;
    if (action.type === 'take') { cn.take++; if (allBeatable) cn.takeBeatable++; }
    if (action.type === 'transfer') cn.transfer++;
    if (action.type === 'beat') {
      cn.beats++;
      const opts = beatOptions(s, seat, action.slot);
      const low = Math.min(...opts.map((u) => pw[C.uidDef[u]]));
      if (pw[C.uidDef[action.card]] <= low + 1e-9) cn.cheapest++;
      if (opts.some((u) => !isTrump(u))) { cn.avoidTrumpOpp++; if (isTrump(action.card)) cn.trumpAvoidable++; }
    }
    return;
  }
  if ((action.type === 'throw' || action.type === 'pass') && throwOptions(s, seat).length) {
    cn.throwOpp++;
    if (action.type === 'throw') cn.throws++;
  }
}

export function mergeCounters(a, b) {
  const o = newCounters();
  for (const k of Object.keys(o)) o[k] = (a[k] || 0) + (b[k] || 0);
  return o;
}

const ratio = (x, y) => (y > 0 ? x / y : null);

export function features(cn) {
  return {
    takeRate: ratio(cn.take, cn.def),
    strategicTake: ratio(cn.takeBeatable, cn.beatable),
    transferRate: ratio(cn.transfer, cn.transferOpp),
    trumpThrift: cn.avoidTrumpOpp ? 1 - cn.trumpAvoidable / cn.avoidTrumpOpp : null,
    cheapness: ratio(cn.cheapest, cn.beats),
    aggression: ratio(cn.throws, cn.throwOpp),
    multiLead: ratio(cn.multi, cn.leads),
    trumpLead: ratio(cn.trumpLead, cn.leadsStock),
    lowLead: ratio(cn.lowLead, cn.leads),
  };
}

/** Distance of a feature vector to each profile ({ id: features }); features observed on both sides only. */
// Weighted RMS distance over shared features; similarity maps distance 0.5 to 0%.
export function compare(f, profiles) {
  const out = [];
  for (const [id, p] of Object.entries(profiles)) {
    let sum = 0, wsum = 0;
    for (const { id: k, weight } of STYLE_FEATURES) {
      if (f[k] == null || p[k] == null) continue;
      sum += weight * (f[k] - p[k]) ** 2;
      wsum += weight;
    }
    if (!wsum) continue;
    const distance = Math.sqrt(sum / wsum);
    out.push({ id, distance, similarity: Math.max(0, 1 - distance / 0.5) });
  }
  return out.sort((a, b) => a.distance - b.distance);
}

// Style badges from a feature vector.
export const STYLE_BADGES = [
  { id: 'trumpKeeper', test: (f) => f.trumpThrift != null && f.trumpThrift >= 0.85 },
  { id: 'trumpSpender', test: (f) => f.trumpThrift != null && f.trumpThrift <= 0.45 },
  { id: 'transferLover', test: (f) => f.transferRate != null && f.transferRate >= 0.6 },
  { id: 'aggressor', test: (f) => f.aggression != null && f.aggression >= 0.7 },
  { id: 'pacifist', test: (f) => f.aggression != null && f.aggression <= 0.2 },
  { id: 'strategicTaker', test: (f) => f.strategicTake != null && f.strategicTake >= 0.25 },
  { id: 'pennyPincher', test: (f) => f.cheapness != null && f.cheapness >= 0.9 },
  { id: 'pairPlayer', test: (f) => f.multiLead != null && f.multiLead >= 0.3 },
  { id: 'trumpLeader', test: (f) => f.trumpLead != null && f.trumpLead >= 0.2 },
];
export const traitsOf = (f) => STYLE_BADGES.filter((b) => b.test(f)).map((b) => b.id);

// --- achievements ----------------------------------------------------------------------------------------------

/**
 * Summary of one finished game from `seat`'s side. extra: { rulesetId, exclusive, teams, opponents: [{ kind, level }],
 * seeded, players }
 */
// Rebuilt from the public log (plus the result), so achievements can be recomputed from stored records.
// wall: a successful defence of a full table (>= 6 attack cards); chain: a bout with 2+ transfers, one of them ours.
export function gameSummary(log, seat, result, rs, extra = {}) {
  const C = compile(rs);
  const sm = {
    won: !!result && !result.draw && !result.losers.includes(seat), draw: !!(result && result.draw),
    durak: !!result && !result.draw && result.durak === seat, place: result ? result.places.indexOf(seat) : -1,
    takes: 0, taken: 0, maxTake: 0, transfers: 0, chain: 0, wall: 0, beats: 0, trumpBeatsEarly: 0, jokerTransfer: 0,
    moves: 0, pogonyGiven: 0, pogonyGot: 0, firstOut: !!result && result.places[0] === seat && result.places.length >= 4,
    ...extra,
  };
  let table = [], defender = -1, boutTransfers = [];
  let stock = C.N - extra.players * rs.rules.handSize;
  for (const e of log) {
    const [k, s] = e;
    if (s === seat && ['L', '+', 'B', 'T', 'X', 'P', 'S'].includes(k)) sm.moves++;
    if (k === 'L' || k === '+') for (const u of e[2]) table.push({ a: u, d: -1 });
    else if (k === 'B') {
      if (table[e[3]]) table[e[3]].d = e[2];
      defender = s;
      if (s === seat) { sm.beats++; if (stock > 0 && C.tier[C.trumpIndex(extra.trumpSuit)]?.[C.uidDef[e[2]]] > 0) sm.trumpBeatsEarly++; }
    } else if (k === 'T') {
      if (!e[3]) for (const u of e[2]) table.push({ a: u, d: -1 });
      boutTransfers.push(s);
      if (s === seat) {
        sm.transfers++;
        if (e[2].some((u) => C.wild[C.uidDef[u]])) sm.jokerTransfer++;
      }
    } else if (k === 'X') defender = s;
    else if (k === '/') {
      const took = e[1], def = e[2];
      const n = table.reduce((a, p) => a + (p.d >= 0 ? 2 : 1), 0);
      if (def === seat) {
        if (took) { sm.takes++; sm.taken += n; sm.maxTake = Math.max(sm.maxTake, n); }
        else if (table.length >= 6) sm.wall++;
      }
      if (boutTransfers.filter((x) => x === seat).length && boutTransfers.length >= 2) sm.chain++;
      table = []; boutTransfers = []; defender = -1;
    } else if (k === 'D') stock = Math.max(0, stock - e[2]);
  }
  if (result && result.pogony) { if (result.durak === seat) sm.pogonyGot = result.pogony; else if (sm.won) sm.pogonyGiven = result.pogony; }
  return sm;
}

export const ACHIEVEMENTS = [
  { id: 'firstWin', icon: '🏆', test: (g) => g.won },
  { id: 'cleanSheet', icon: '🧼', test: (g) => g.won && g.takes === 0 },
  { id: 'transferArtist', icon: '🔁', test: (g) => g.transfers >= 3 },
  { id: 'chainTransfer', icon: '⛓️', test: (g) => g.chain >= 1 },
  { id: 'wall', icon: '🧱', test: (g) => g.wall >= 1 },
  { id: 'pogony', icon: '🎖️', test: (g) => g.pogonyGiven > 0 },
  { id: 'comeback', icon: '🔥', test: (g) => g.won && g.maxTake >= 8 },
  { id: 'jokerMaster', icon: '🃏', test: (g) => g.jokerTransfer > 0 },
  { id: 'trumpMiser', icon: '🪙', test: (g) => g.won && g.trumpBeatsEarly === 0 && g.beats >= 3 },
  { id: 'giantSlayer', icon: '👑', test: (g) => g.won && (g.opponents || []).some((o) => o.kind === 'grandmaster' && o.level >= 3) },
  { id: 'firstOut', icon: '🚀', test: (g) => g.firstOut },
  { id: 'marathon', icon: '🏃', test: (g) => g.moves >= 60 },
  { id: 'exclusive', icon: '💎', test: (g) => g.won && g.exclusive },
  { id: 'teamPlayer', icon: '🤝', test: (g) => g.won && g.teams },
  { id: 'seeded', icon: '🌱', test: (g) => g.seeded },
  { id: 'streak3', icon: '📈', test: (g, h) => g.won && h.length >= 2 && h.slice(-2).every((x) => x.won) },
  { id: 'honoraryDurak', icon: '🎩', test: (g, h) => g.durak && h.filter((x) => x.durak).length >= 9 },
  { id: 'collector', icon: '🗂️', test: (g, h) => new Set([...h, g].filter((x) => x.exclusive).map((x) => x.rulesetId)).size >= 5 },
];

export function newAchievements(history, summary, have = []) {
  return ACHIEVEMENTS.filter((a) => !have.includes(a.id) && a.test(summary, history)).map((a) => a.id);
}
