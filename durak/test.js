// durak/test.js - tests of the Durak library: `node durak/test.js [--long]` (importing the module runs nothing).
// Rulesets (normalisation, validation, hashes), card relations of every preset, each sentence of the colour-joker
// rules, the bout flow (throw-ins, limits, transfers, trump exchange, teams, special cards), thousands of games with
// random legal moves (card conservation, hidden hands in views), full games between every bot template on every
// preset (legality, determinism per seed), the notation (DGN round trips, public replays, entropy), player analysis and
// the rooms game definition.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, normalizeRuleset, playerRange, rulesetHash, validateRuleset, cardText } from './ruleset.js';
import { PRESETS, presetById, JOKER_RULES } from './presets.js';
import {
  apply, canBeat, legalActions, matches, newGame, nextOpponent, throwOptions, throwers, transferTarget, turn, uniform,
  viewOf, actors,
} from './engine.js';
import { BOT_KINDS, TEMPLATES, decide, makeBot, profileOf, solveEndgame } from './bots.js';
import { encode, parse, replay, packRuleset, unpackRuleset } from './notation.js';
import { hiddenEntropy, track } from './public.js';
import { compare, features, gameSummary, newAchievements, newCounters, observe, traitsOf } from './analysis.js';
import { game, hydrate, rulesetOf } from './game.js';
import { playGame } from './sim.js';
import { seededRandom } from '../prng/prng.js';
import { localRoom } from '../rooms/local.js';

//
// Test strategy: hand-built positions for exact rule checks (one assertion per sentence of a rule description, e.g.
// the colour joker), fuzzing with random legal games for invariants (card conservation, no hidden card in other
// seats' views), and seeded bot games for legality and determinism. Invariant tests catch whole classes of engine
// bugs that example-based tests miss.
const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

// --- helpers ---------------------------------------------------------------------------------------------------

// A position built by hand: hands and table by card codes ('As', 'Th', 'R*'), the rest of the deck split between a
// stock of `stock` cards and the discard pile.
function setup(raw, { hands, table = [], trump = null, attacker = 0, defender = null, stock = 0, boutNo = 2 }) {
  const rs = normalizeRuleset(raw);
  const C = compile(rs);
  const s = newGame(rs, { players: hands.length, rng: seededRandom('setup') });
  const used = new Set();
  const uid = (code) => {
    const di = C.defByCode.get(code);
    if (di == null) throw new Error('no card ' + code);
    for (let u = C.firstUid[di]; u < C.firstUid[di] + C.defs[di].copies; u++) if (!used.has(u)) { used.add(u); return u; }
    throw new Error('no more copies of ' + code);
  };
  s.n = hands.length;
  s.hands = hands.map((h) => h.map(uid));
  s.table = table.map((p) => ({ a: uid(p[0]), d: p[1] ? uid(p[1]) : -1, by: p[2] ?? attacker }));
  const rest = [];
  for (let u = 0; u < C.N; u++) if (!used.has(u)) rest.push(u);
  s.stock = rest.slice(0, stock);
  s.discard = rest.slice(stock);
  s.trumpSuit = trump;
  s.trumpCard = -1;
  s.out = [];
  s.attacker = attacker;
  s.leader = attacker;
  s.defender = defender ?? nextOpponent(s, attacker);
  s.phase = table.length ? 'bout' : 'lead';
  s.boutNo = boutNo;
  s.log = [];
  s.passes = {};
  s.taking = false;
  s.closed = false;
  s.shown = [];
  return s;
}
const C_ = (s) => compile(s.rs);
const code = (s, u) => C_(s).codeOf[C_(s).uidDef[u]];
// The uid of a card with this code in a seat's hand (or on the table with seat = 'table').
function card(s, seat, c) {
  const C = C_(s);
  const di = C.defByCode.get(c);
  const pool = seat === 'table' ? s.table.flatMap((p) => [p.a, p.d]) : s.hands[seat];
  const u = pool.find((x) => x >= 0 && C.uidDef[x] === di);
  if (u == null) throw new Error(`${c} not in ${seat}`);
  return u;
}
// Card relations by codes, independent of positions.
function rel(raw, trump) {
  const rs = normalizeRuleset(raw);
  const C = compile(rs);
  const t = C.trumpIndex(trump);
  const d = (c) => { const i = C.defByCode.get(c); if (i == null) throw new Error('no card ' + c); return i; };
  return {
    beats: (x, y) => C.beat[t][d(x) * C.D + d(y)] === 1,
    match: (x, y) => C.match[d(x) * C.D + d(y)] === 1,
  };
}
function act(s, seat, type, cards = [], extra = {}) {
  const a = { type, ...extra };
  if (type === 'beat') { a.card = card(s, seat, cards[0]); a.slot = extra.slot ?? s.table.findIndex((p) => p.d < 0 && code(s, p.a) === cards[1]); }
  else if (type === 'swap') a.card = card(s, seat, cards[0]);
  else if (cards.length) a.cards = cards.map((c) => card(s, seat, c));
  return apply(s, seat, a);
}
// Every physical card exactly once in stock, hands, table and discard.
// Card conservation: every uid is in exactly one place (stock, a hand, the table or the discard), none duplicated or
// lost. Checked after every random action, it detects any bookkeeping slip in endBout, transfers or swaps.
function conserved(s) {
  const C = C_(s);
  const seen = new Uint8Array(C.N);
  const put = (u) => { if (u < 0 || u >= C.N || seen[u]) return false; seen[u] = 1; return true; };
  for (const u of s.stock) if (!put(u)) return false;
  for (const h of s.hands) for (const u of h) if (!put(u)) return false;
  for (const p of s.table) { if (!put(p.a)) return false; if (p.d >= 0 && !put(p.d)) return false; }
  for (const u of s.discard) if (!put(u)) return false;
  return seen.every((x) => x === 1);
}
// A random legal game (every decision drawn from legalActions of the seat whose turn it is, sometimes from another
// actor). Returns { s, actions, errors }.
// Occasionally acts as a non-turn actor (15%) to exercise the asynchronous throw-in paths, and biases against
// passes/takes so games make progress and reach their end within the action cap.
function randomGame(raw, players, seed, { maxActions = 6000, check = null } = {}) {
  const rng = seededRandom(seed);
  let s = newGame(raw, { players, rng });
  let actions = 0, errors = 0;
  while (s.phase !== 'over' && actions < maxActions) {
    const who = actors(s);
    const seat = rng.chance(0.15) && who.length ? who[rng.int(who.length)] : turn(s);
    if (seat < 0) break;
    const legal = legalActions(s, seat, { leads: rng.chance(0.3) ? 'all' : 'groups' });
    if (!legal.length) { if (seat === turn(s)) { errors++; break; } continue; }
    // Prefer progress: passes and takes less often than plays.
    let a = rng.pick(legal);
    if ((a.type === 'pass' || a.type === 'take') && rng.chance(0.5)) a = rng.pick(legal);
    const r = apply(s, seat, a);
    if (r.error) { errors++; break; }
    s = r.state;
    actions++;
    if (check) check(s, seat, a);
  }
  return { s, actions, errors };
}

export async function run({ long = false } = {}) {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const ok = (name, cond, info) => eq(name, cond ? true : info ?? false, true);
  const t0 = Date.now();
  let tl = t0, last = 'start';
  const laps = [];
  const lap = (name) => { laps.push(`${last} ${((Date.now() - tl) / 1000).toFixed(1)}s`); tl = Date.now(); last = name; };

  lap('rulesets');
  // --- rulesets ------------------------------------------------------------------------------------------------
  for (const p of PRESETS) {
    const v = validateRuleset(p);
    ok(`preset ${p.id} valid`, v.ok, v.errors);
    ok(`preset ${p.id} no warnings`, !v.warnings.length, v.warnings);
    const pr = playerRange(normalizeRuleset(p));
    ok(`preset ${p.id} player range`, pr.min >= 2 && pr.max >= pr.min, pr);
  }
  eq('card counts', ['podkidnoy-36', 'podkidnoy-52', 'jokers-54', 'double-72', 'blitz-24', 'ex-bazaar'].map((id) => normalizeRuleset(presetById(id)).cardCount), [36, 52, 54, 72, 24, 114]);
  const base = presetById('podkidnoy-36');
  eq('hash ignores names and descriptions', rulesetHash({ ...base, name: 'Other', description: 'x' }), rulesetHash(base));
  ok('hash follows rules', rulesetHash({ ...base, rules: { ...base.rules, transfer: true } }) !== rulesetHash(base));
  ok('hash follows card rules', rulesetHash(presetById('jokers-54')) !== rulesetHash({ ...presetById('jokers-54'), deck: { ...presetById('jokers-54').deck, cards: presetById('jokers-54').deck.cards.map((c) => ({ ...c, rules: {} })) } }));
  ok('duplicates add copies', normalizeRuleset({ deck: { sets: [{ ranks: ['A'], suits: ['S'], copies: 2 }, { ranks: ['A'], suits: ['S'], copies: 1 }] }, rules: { handSize: 1 } }).defs[0].copies === 3);
  {
    const v = validateRuleset({ deck: { sets: [{ ranks: ['6', 'Z'], suits: ['S'] }], cards: [{ id: 'bad code!', rank: 'A' }] }, rules: { handSize: 6 } });
    ok('validation finds errors', !v.ok && v.errors.some((e) => e.path.includes('ranks')) && v.errors.some((e) => e.path.includes('id')), v.errors);
  }
  eq('card text', cardText(normalizeRuleset(base), normalizeRuleset(base).defs.find((d) => d.code === 'Th')), '10♥');
  // A custom 114-card ruleset with own designations survives normalisation and packing.
  {
    const custom = {
      id: 'my-114', name: { en: 'Mine', ru: 'Мой' }, deck: {
        colors: [{ id: 'red', css: '#c00' }, { id: 'black', css: '#000' }, { id: 'green', css: '#080' }],
        suits: [{ id: 'S', symbol: '♠', color: 'black' }, { id: 'H', symbol: '♥', color: 'red' }, { id: 'L', name: 'Leaves', symbol: '🍃', color: 'green' }],
        sets: [{ ranks: ['6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'], suits: 'all', copies: 4 }],
        cards: [{ id: 'G*', name: 'Green joker', rank: 'X', color: 'green', copies: 6, rules: JOKER_RULES }],
      }, rules: { maxPlayers: 8, transfer: true },
    };
    const rs = normalizeRuleset(custom);
    eq('custom 114 cards', rs.cardCount, 114);
    ok('custom valid', validateRuleset(custom).ok, validateRuleset(custom).errors);
    const back = normalizeRuleset(unpackRuleset(packRuleset(rs)));
    eq('packed ruleset keeps its hash', back.hash, rs.hash);
    const r = rel(custom, 'S');
    ok('green joker beats a green card', r.beats('G*', 'Al'));
    ok('green joker does not beat a trump spade', !r.beats('G*', '6s'));
  }

  lap('the-joker');
  // --- the colour joker, sentence by sentence ---------------------------------------------------------------------
  const J54 = presetById('jokers-54');
  {
    // "A joker beats its colour and only its colour; it is beaten only by its colour."
    const r = rel(J54, 'S'); // spades are trump
    ok('joker: red joker beats red cards', r.beats('R*', '2h') && r.beats('R*', 'Ad') && r.beats('R*', 'Ah'));
    ok('joker: black joker beats a black trump', r.beats('B*', 'As'));
    ok('joker: red joker does not beat black cards', !r.beats('R*', '2c') && !r.beats('R*', '2s'));
    ok('joker: jokers of different colours do not beat each other', !r.beats('R*', 'B*') && !r.beats('B*', 'R*'));
    ok('joker: beaten by any card of its colour', r.beats('2h', 'R*') && r.beats('2d', 'R*') && r.beats('2c', 'B*'));
    ok('joker: not beaten by another colour, not even a trump', !r.beats('As', 'R*') && !r.beats('2s', 'R*') && !r.beats('Ah', 'B*'));
    const rh = rel(J54, 'H'); // hearts trump: the red joker still beats them and is still beaten only by red
    ok('joker: beats trumps of its colour', rh.beats('R*', 'Ah'));
    ok('joker: trumps of another colour do not beat it', !rh.beats('Ah', 'B*'));
  }
  {
    // "Any card of its colour may be thrown in to a joker, including the joker; two jokers let any card be thrown in."
    const r = rel(J54, 'S');
    ok('joker: red cards match the red joker', r.match('3h', 'R*') && r.match('Kd', 'R*'));
    ok('joker: black cards do not match the red joker', !r.match('3s', 'R*') && !r.match('Kc', 'R*'));
    ok('joker: the other joker matches', r.match('B*', 'R*') && r.match('R*', 'B*'));
    const s = setup(J54, { hands: [['3h', '3s', 'B*', '9c', '7d'], ['2c', '2d', '4c', '5c', '8c', '8d']], table: [['R*']], trump: 'S' });
    eq('joker: throw-ins to a lone red joker', throwOptions(s, 0).map((u) => code(s, u)).sort(), ['3h', '7d', 'B*']);
    const r1 = act(s, 0, 'throw', ['B*']);
    ok('joker: the black joker thrown in to the red one', !r1.error, r1.error);
    eq('joker: two jokers open every card', throwOptions(r1.state, 0).map((u) => code(r1.state, u)).sort(), ['3h', '3s', '7d', '9c']);
  }
  {
    // "Among equal cards a joker counts as the same card: in transfer durak with three aces the joker transfers (as if
    // four aces were in play); the second joker continues the transfer."
    const s = setup(J54, { hands: [['2c', '3c', '4c', '5c'], ['R*', '9c', '9d'], ['B*', 'Ad', '7c', '7d', '8c']], table: [['As'], ['Ac'], ['Ah']], trump: 'D' });
    ok('joker: transfers three aces', transferTarget(s, 1, [card(s, 1, 'R*')]) === 2);
    const r1 = act(s, 1, 'transfer', ['R*']);
    ok('joker: transfer applied', !r1.error && r1.state.defender === 2 && r1.state.attacker === 1, r1.error);
    const s2 = r1.state;
    s2.hands[0].push(...s2.discard.splice(0, 2)); // seat 0 must be able to answer five cards
    ok('joker: the second joker continues the transfer', transferTarget(s2, 2, [card(s2, 2, 'B*')]) === 0);
    ok('joker: an ace continues it too', transferTarget(s2, 2, [card(s2, 2, 'Ad')]) === 0);
    ok('joker: a seven does not', transferTarget(s2, 2, [card(s2, 2, '7d')]) < 0);
    // "...but if a card of its colour that breaks the uniformity (aces and, say, a three) was thrown in to the first
    // joker, transfers are no longer possible: it is frozen on the defender. Jokers never break the uniformity."
    s2.hands[1].push(...s2.discard.filter((u) => code(s2, u) === '3h').slice(0, 1));
    s2.discard = s2.discard.filter((u) => code(s2, u) !== '3h');
    ok('joker: a red three may be thrown in to the red joker', throwOptions(s2, 1).some((u) => code(s2, u) === '3h'));
    const r2 = act(s2, 1, 'throw', ['3h']);
    ok('joker: three thrown in', !r2.error, r2.error);
    ok('joker: transfer frozen (joker)', transferTarget(r2.state, 2, [card(r2.state, 2, 'B*')]) < 0);
    ok('joker: transfer frozen (ace)', transferTarget(r2.state, 2, [card(r2.state, 2, 'Ad')]) < 0);
    eq('joker: the defender must beat or take', legalActions(r2.state, 2).filter((a) => a.type === 'transfer').length, 0);
    const C = C_(s);
    ok('joker: jokers do not break uniformity', uniform(C, [card(s, 'table', 'As'), card(s, 'table', 'Ah'), card(s, 1, 'R*')]));
    ok('joker: a three does', !uniform(C, [card(s, 'table', 'As'), card(s, 1, 'R*'), C.firstUid[C.defByCode.get('3h')]]));
    // Black aces only: the red joker has nothing of its colour to join.
    const sb = setup(J54, { hands: [['2c', '3c', '4c'], ['R*', 'B*', '9d'], ['5c', '6c', '7c', '8c']], table: [['As'], ['Ac']], trump: 'D' });
    ok('joker: no red card on the table, no red joker transfer', transferTarget(sb, 1, [card(sb, 1, 'R*')]) < 0);
    ok('joker: the black joker transfers black aces', transferTarget(sb, 1, [card(sb, 1, 'B*')]) === 2);
  }
  {
    // "A joker of its colour can be thrown in to any card of its colour and transfer from there: to a red card a red
    // joker, to it a red six, and to the six a black six."
    const s = setup(J54, { hands: [['R*', '6d', '6s', '2c'], ['Th', 'Jh', 'Qh', 'Kh', 'Ah', '2s'], ['3c', '4c', '5c', '7c']], table: [['9h']], trump: 'C' });
    ok('joker chain: red joker to a red nine', throwOptions(s, 0).some((u) => code(s, u) === 'R*'));
    let r = act(s, 0, 'throw', ['R*']);
    ok('joker chain: joker thrown in', !r.error, r.error);
    r = act(r.state, 0, 'throw', ['6d']);
    ok('joker chain: red six to the joker', !r.error, r.error);
    r = act(r.state, 0, 'throw', ['6s']);
    ok('joker chain: black six to the red six', !r.error, r.error);
    eq('joker chain: table', r.state.table.map((p) => code(r.state, p.a)), ['9h', 'R*', '6d', '6s']);
    // ...and the defender may transfer a red card with the red joker.
    const t = setup(J54, { hands: [['2c', '3c', '4c'], ['R*', '9c'], ['5c', '6c', '7c', '8c']], table: [['9h']], trump: 'C' });
    ok('joker chain: the joker transfers a red nine', transferTarget(t, 1, [card(t, 1, 'R*')]) === 2);
  }

  // --- classic relations and variants -----------------------------------------------------------------------------
  {
    const r = rel(base, 'H');
    ok('classic: higher same suit beats', r.beats('Ks', 'Qs') && !r.beats('Qs', 'Ks'));
    ok('classic: other suit does not', !r.beats('As', '6c'));
    ok('classic: trump beats plain', r.beats('6h', 'As') && !r.beats('As', '6h'));
    ok('classic: higher trump beats lower', r.beats('7h', '6h'));
    ok('classic: same rank matches', r.match('6s', '6h') && !r.match('6s', '7s'));
  }
  {
    const crowns = presetById('ex-two-crowns');
    const r = rel(crowns, 'S');
    ok('two crowns: hearts beat the drawn trump', r.beats('6h', 'As') && !r.beats('As', '6h'));
    for (let i = 0; i < 20; i++) {
      const g = newGame(crowns, { players: 4, rng: seededRandom('crowns' + i) });
      if (g.trumpSuit === 'H') { ok('two crowns: the drawn trump is never hearts', false, i); break; }
    }
    const s = setup(crowns, { hands: [['6h', '7h', '8s'], ['9s', 'Ts', 'Js']], trump: 'S' });
    ok('two crowns: hearts do not lead while other cards exist', legalActions(s, 0).every((a) => a.type !== 'lead' || a.cards.every((u) => code(s, u) === '8s')));
    const s2 = setup(crowns, { hands: [['6h', '7h'], ['9s', 'Ts', 'Js']], trump: 'S' });
    ok('two crowns: a hand of hearts only may lead', legalActions(s2, 0).some((a) => a.type === 'lead'));
  }
  {
    const ring = presetById('ex-ring');
    const r = rel(ring, 'D');
    ok('ring: six beats the ace of its suit', r.beats('6s', 'As') && !r.beats('As', '6s'));
    ok('ring: six does not beat another ace', !r.beats('6s', 'Ac'));
    ok('ring: trump six beats trump ace', r.beats('6d', 'Ad'));
    ok('ring: six and nine match', r.match('6s', '9h') && r.match('9c', '6d'));
  }
  {
    const twins = normalizeRuleset(presetById('ex-twins'));
    const C = compile(twins);
    const q = C.firstUid[C.defByCode.get('Qh')];
    const s = setup(twins, { hands: [['6s'], ['7s'], ['8s']], trump: 'S' });
    ok('twins: the twin beats', canBeat(s, q + 1, q) && canBeat(s, q, q + 1));
    ok('twins: plain order still holds', rel(twins, 'S').beats('Kh', 'Qh'));
  }
  {
    const bz = presetById('ex-bazaar');
    const r = rel(bz, 'S');
    ok('bazaar: crown beats a trump ace', r.beats('CR', 'As'));
    ok('bazaar: jokers resist the crown', !r.beats('CR', 'R*') && !r.beats('CR', 'B*'));
    ok('bazaar: shield beats plain cards only', r.beats('SH', 'Ah') && !r.beats('SH', '6s') && !r.beats('SH', 'R*'));
    ok('bazaar: anything beats the shield', r.beats('6h', 'SH'));
    ok('bazaar: the fool matches every rank', r.match('FL', '7h') && r.match('Kc', 'FL'));
    ok('bazaar: the fool never defends', !r.beats('FL', '6h'));
    ok('bazaar: anything beats the fool', r.beats('6h', 'FL'));
    const s = setup(bz, { hands: [['2c', '3c', '4c', '5c'], ['SH', '9c', '9d', 'Td', 'Jd'], ['5d', '6d', '7d']], table: [['Kh']], trump: 'S' });
    const r1 = act(s, 1, 'beat', ['SH', 'Kh']);
    ok('bazaar: the shield closes the bout', !r1.error && (r1.state.closed || r1.state.phase === 'lead'), r1.error);
  }
  {
    // Trump exchange: the lowest trump takes the open trump card.
    const s = newGame(presetById('pogony-36'), { players: 2, rng: seededRandom('swap') });
    const C = C_(s);
    const six = C.firstUid[C.defByCode.get('6' + s.trumpSuit.toLowerCase())];
    const holder = s.hands.findIndex((h) => h.includes(six));
    if (holder >= 0 && s.trumpCard !== six) {
      const r = apply(s, holder, { type: 'swap', card: six });
      ok('swap: lowest trump takes the open card', !r.error && r.state.hands[holder].includes(s.trumpCard) && r.state.trumpCard === six, r.error);
    } else ok('swap: the six was in the stock (seed)', true);
    const other = s.hands[0].find((u) => u !== six);
    ok('swap: other cards may not', apply(s, 0, { type: 'swap', card: other }).error === 'illegal-swap');
  }
  {
    // Bout flow: lead, beat, throw in, pass, take; limits.
    const s = setup(base, { hands: [['6s', '6c', '6h', '7s', '7c', '8d'], ['7h', '8s', 'Ts', 'Js', 'Ac', '9d'], ['6d', '9s', '9c', 'Kd', 'Ks', 'Kc']], trump: 'H', stock: 10 });
    let r = act(s, 0, 'lead', ['6s', '6c']);
    ok('flow: two sixes lead', !r.error, r.error);
    eq('flow: the defender is at turn', turn(r.state), 1);
    r = act(r.state, 1, 'beat', ['8s', '6s']);
    ok('flow: beat', !r.error, r.error);
    r = act(r.state, 1, 'beat', ['Ac', '6c']);
    eq('flow: an attacker with options is at turn', turn(r.state), 0);
    eq('flow: throw-ins match ranks on the table', throwOptions(r.state, 0).map((u) => code(r.state, u)).sort(), ['6h', '8d']);
    eq('flow: the other player may throw in too', throwOptions(r.state, 2).map((u) => code(r.state, u)).sort(), ['6d']);
    r = act(r.state, 0, 'pass');
    eq('flow: after a pass the next thrower', turn(r.state), 2);
    r = act(r.state, 2, 'throw', ['6d']);
    ok('flow: a new card on the table re-opens the passed attacker', throwers(r.state).includes(0) && turn(r.state) === 1);
    r = act(r.state, 1, 'take');
    ok('flow: take', !r.error && r.state.taking, r.error);
    r = act(r.state, 0, 'pass');
    r = act(r.state, 2, 'pass');
    eq('flow: bout over, cards picked up', [r.state.phase, r.state.hands[1].length >= 6, r.state.attacker], ['lead', true, 2]);
    // first bout limit: five cards
    const f = setup(base, { hands: [['6s', '6c', '6h', '6d', '7s', '7c'], ['7h', '8s', 'Ts', 'Js', 'Ac', '9d'], ['9s', '9c', 'Kd', 'Ks', 'Kc', 'Qd']], trump: 'H', boutNo: 1, stock: 10 });
    ok('limit: four sixes may lead together', !act(f, 0, 'lead', ['6s', '6c', '6h', '6d']).error);
    const lim = setup({ ...base, rules: { ...base.rules, firstBoutLimit: 3 } }, { hands: [['6s', '6c', '6h', '6d', '7s', '7c'], ['7h', '8s', 'Ts', 'Js', 'Ac', '9d'], ['9s']], trump: 'H', boutNo: 1, stock: 10 });
    ok('limit: no more than the first bout limit', act(lim, 0, 'lead', ['6s', '6c', '6h', '6d']).error === 'illegal-lead');
    const small = setup(base, { hands: [['6s', '6c', '6h'], ['7h', '8s'], ['9s']], trump: 'H', stock: 10 });
    ok('limit: not more cards than the defender holds', act(small, 0, 'lead', ['6s', '6c', '6h']).error === 'illegal-lead');
  }
  {
    // Teams: partners sit opposite each other.
    const s = newGame(presetById('teams-36'), { players: 4, rng: seededRandom('teams'), first: 0 });
    eq('teams: the first attacker attacks the next opponent', s.defender, 1);
    s.phase = 'bout';
    s.table = [{ a: s.hands[0].shift(), d: -1, by: 0 }];
    ok('teams: the defender\'s partner never throws in', !throwers(s).includes(3) && throwers(s).includes(2));
  }
  {
    // Transfer by showing a trump.
    const raw = { ...base, rules: { ...base.rules, transfer: true, transferShow: true } };
    const s = setup(raw, { hands: [['2c'].filter(() => false).concat(['7s', '8s', '9s']), ['6h', 'Kc', 'Qc'], ['7c', '8c', '9c', 'Tc']], table: [['6s']], trump: 'H' });
    const r = act(s, 1, 'transfer', ['6h'], { show: true });
    ok('show: transfer by showing the trump six', !r.error && r.state.defender === 2 && r.state.hands[1].length === 3, r.error);
    ok('show: shown once per bout', act(r.state, 2, 'transfer', ['7c']).error != null);
  }

  lap('random');
  // --- random legal games --------------------------------------------------------------------------------------
  {
    let games = 0, actionsTotal = 0, bad = 0, leaks = 0, unfinished = 0;
    const per = long ? 60 : 12;
    for (const p of PRESETS) {
      const pr = playerRange(normalizeRuleset(p));
      for (let g = 0; g < per; g++) {
        const n = pr.min + (g % (Math.min(pr.max, 6) - pr.min + 1));
        const { s, actions, errors } = randomGame(p, n, `${p.id}-${g}`, {
          check: (st) => {
            if (!conserved(st)) bad++;
            const v = viewOf(st, 0);
            if (v.hands.some((h, i) => i !== 0 && h && st.phase !== 'over')) leaks++;
            if (Object.entries(v.passes).some(([k, x]) => +k !== 0 && Array.isArray(x) && st.phase !== 'over')) leaks++;
          },
        });
        games++;
        actionsTotal += actions;
        if (errors) bad++;
        if (s.phase !== 'over') unfinished++;
        else if (!s.result || s.result.places.length + (s.result.draw ? 0 : 0) > s.n) bad++;
      }
    }
    eq('random games: no illegal action, cards conserved', bad, 0);
    eq('random games: views hide hands and passes', leaks, 0);
    eq('random games: all finished', unfinished, 0);
    ok(`random games: ${games} games, ${actionsTotal} actions`, games > 0);
  }

  lap('bots');
  // --- bots -------------------------------------------------------------------------------------------------------
  {
    let illegal = 0, unfinished = 0, games = 0, decisions = 0;
    const levels = long ? [1, 2, 3, 4] : [1, 2, 3, 2];
    for (const p of PRESETS) {
      const pr = playerRange(normalizeRuleset(p));
      const rounds = long ? 6 : 1;
      for (let k = 0; k < rounds; k++) {
        for (let g = 0; g < TEMPLATES.length; g += 3) {
          const n = Math.min(pr.max, Math.max(pr.min, 2 + ((g / 3 + k) % 3)));
          const seats = Array.from({ length: n }, (_, i) => ({ kind: TEMPLATES[(g + i) % TEMPLATES.length].id, level: levels[(g + i + k) % 4] }));
          const tg = Date.now();
          const r = playGame({ rs: normalizeRuleset(p), seats, seed: `bots-${p.id}-${g}-${k}` });
          if (process.env.DURAK_SLOW && Date.now() - tg > 500) console.log('slow', p.id, n, JSON.stringify(seats), Date.now() - tg, r.actions);
          games++;
          illegal += r.illegal;
          decisions += r.actions;
          if (!r.over) unfinished++;
        }
      }
    }
    // One Expert table (the full Monte-Carlo budget) in the quick run too.
    {
      const r = playGame({ rs: normalizeRuleset(presetById('perevodnoy-36')), seats: [{ kind: 'grandmaster', level: 4 }, { kind: 'accountant', level: 4 }, { kind: 'gambler', level: 4 }], seed: 'bots-expert' });
      games++; illegal += r.illegal; decisions += r.actions; if (!r.over) unfinished++;
    }
    eq('bots: never an illegal decision', illegal, 0);
    eq('bots: every game finished', unfinished, 0);
    ok(`bots: ${games} games, ${decisions} decisions`, games > 0);
    // Determinism per seed.
    const rs = normalizeRuleset(presetById('perevodnoy-36'));
    const seats = [{ kind: 'grandmaster', level: 3 }, { kind: 'puppeteer', level: 2 }, { kind: 'gambler', level: 2 }];
    const a = playGame({ rs, seats, seed: 'det' }), b = playGame({ rs, seats, seed: 'det' }), c = playGame({ rs, seats, seed: 'det2' });
    eq('bots: same seed, same game', JSON.stringify(a.result) + a.actions, JSON.stringify(b.result) + b.actions);
    ok('bots: another seed, another game', JSON.stringify(a.result) + a.actions !== JSON.stringify(c.result) + c.actions);
    // Profiles and constructed bots.
    const P = profileOf('custom', { level: 4, traits: { aggression: 1, trumpThrift: 0 }, skills: { counting: 3, endgame: 3 } });
    ok('bots: constructed profile', P.kind === 'custom' && P.traits.aggression === 1 && P.skills.endgame === 3);
    eq('bots: the level caps skills', profileOf('grandmaster', { level: 1 }).skills.lookahead, 1);
    ok('bots: kinds for rooms', BOT_KINDS.length === TEMPLATES.length + 1);
    // Exact endgame: a won position is found.
    const e = setup(base, { hands: [['Ah', '6s'], ['7s']], trump: 'H' });
    const sol = solveEndgame(e, 0, 5000);
    ok('bots: endgame search finds the win', sol && sol.value === 1, sol);
  }

  lap('notation');
  // --- notation ---------------------------------------------------------------------------------------------------
  {
    const presets = ['podkidnoy-36', 'perevodnoy-36', 'jokers-54', 'ex-bazaar', 'pogony-36', 'teams-36'];
    let roundTrips = 0;
    for (const id of presets) {
      const raw = presetById(id);
      const rs = normalizeRuleset(raw);
      const pr = playerRange(rs);
      const n = Math.max(pr.min, Math.min(3, pr.max));
      const seed = `dgn-${id}`;
      const rng = seededRandom(seed);
      let s = newGame(rs, { players: n, rng });
      s.seed = seed;
      const brng = rng.fork('bots');
      const P = Array.from({ length: n }, (_, i) => profileOf(TEMPLATES[i * 3 % TEMPLATES.length].id, { level: 2 }));
      while (s.phase !== 'over') {
        const seat = turn(s);
        const a = decide(viewOf(s, seat), seat, brng, P[seat]);
        s = apply(s, seat, a).state;
      }
      const text = encode(s, { names: ['Ann', 'Bo;b', 'Cé'], bots: [null, 'miser.2', 'blitz.3'] });
      const p = parse(text);
      ok(`dgn ${id}: parses`, p.ok, p.error);
      eq(`dgn ${id}: names survive`, p.names.slice(0, 3), ['Ann', 'Bo;b', 'Cé'].slice(0, n));
      const r = replay(p);
      ok(`dgn ${id}: seeded replay`, r.ok && r.finished, r.error);
      if (r.ok) {
        const last = r.frames[r.frames.length - 1].state;
        const codes = (log) => log.map((e) => e.map((x, i) => (i === 0 ? x : Array.isArray(x) ? x.map((u) => code(s, u)) : e[0] === 'B' && i === 2 ? code(s, x) : x)));
        eq(`dgn ${id}: same log (by card codes)`, codes(last.log), codes(s.log));
        eq(`dgn ${id}: same result`, last.result, s.result);
        ok(`dgn ${id}: entropy`, r.entropy.course > 0 && r.entropy.hiddenStart > 0 && r.entropy.decisions > 10, r.entropy);
      }
      // Without the seed: the public course only.
      const pub = replay(parse(text.replace(/;s=[^;]*/, '')));
      ok(`dgn ${id}: public replay`, pub.ok && pub.public, pub.error);
      if (pub.ok) {
        const fs0 = pub.frames[pub.frames.length - 1].state;
        eq(`dgn ${id}: public replay ends with the same counts`, fs0.hands.map((h) => h.length), s.hands.map((h) => h.length));
        eq(`dgn ${id}: public replay has the same course entropy`, Math.round(pub.entropy.course * 1000), Math.round(r.entropy.course * 1000));
        eq(`dgn ${id}: same tokens again`, encode({ ...fs0, firstSeat: s.firstSeat, trumpCard: s.trumpCard }, { names: p.names }).split(';m=')[1].split(';')[0], text.split(';m=')[1].split(';')[0]);
      }
      // With the deal instead of the seed.
      const withDeal = encode(s, { deal: true, seed: null });
      const rd = replay(parse(withDeal));
      ok(`dgn ${id}: replay from the deal`, rd.ok && rd.finished, rd.error);
      roundTrips++;
    }
    ok('dgn: round trips', roundTrips === presets.length);
    // Own ruleset embedded.
    const mine = { ...presetById('jokers-54'), id: 'my-jokers', rules: { ...presetById('jokers-54').rules, handSize: 7 } };
    const g = newGame(mine, { players: 2, rng: seededRandom('mine') });
    g.seed = 'mine';
    const text = encode(g);
    ok('dgn: own ruleset embedded', text.includes(';R='));
    const rp = replay(parse(text));
    ok('dgn: replay with the embedded ruleset', rp.ok && rp.rs.rules.handSize === 7, rp.error);
    ok('dgn: garbage is rejected', !parse('hello').ok && !parse('DGN1;r=x@1;n=2;m=0Q').ok);
    // Hidden entropy: log2 of multinomial; at the start of a 2-player 36-card game: 36 - 6*2 - 1 open = 23 in the
    // stock, 6 + 6 unknown in hands (from an observer's side).
    const T = track({ rs: normalizeRuleset(base), n: 2, trumpCard: 0 });
    const lf = (k) => { let x = 0; for (let i = 2; i <= k; i++) x += Math.log2(i); return x; };
    ok('entropy: multinomial at the start', Math.abs(hiddenEntropy(T) - (lf(35) - 2 * lf(6) - lf(23))) < 1e-9);
  }

  lap('analysis');
  // --- analysis -----------------------------------------------------------------------------------------------------
  {
    const rs = normalizeRuleset(presetById('perevodnoy-36'));
    const seats = [{ kind: 'miser', level: 3 }, { kind: 'blitz', level: 3 }, { kind: 'rookie', level: 3 }];
    const cn = [newCounters(), newCounters(), newCounters()];
    for (let g = 0; g < 6; g++) {
      const r = playGame({ rs, seats, seed: 'an' + g, record: true });
      r.counters.forEach((c, i) => { for (const k of Object.keys(c)) cn[i][k] += c[k]; });
    }
    const f = cn.map(features);
    ok('analysis: features are rates', f.every((x) => Object.values(x).every((v) => v == null || (v >= 0 && v <= 1))), f);
    ok('analysis: styles differ', compare(f[0], { blitz: f[1] })[0].distance > 0);
    const cmp = compare(f[1], { miser: f[0], blitz: f[1] });
    eq('analysis: a profile is closest to itself', cmp[0].id, 'blitz');
    ok('analysis: badges', Array.isArray(traitsOf(f[1])));
    const g = playGame({ rs, seats, seed: 'sum' });
    ok('analysis: game played', g.over);
    const st = newGame(rs, { players: 2, rng: seededRandom('obs') });
    const c0 = newCounters();
    observe(c0, viewOf(st, st.attacker), st.attacker, legalActions(st, st.attacker)[0]);
    eq('analysis: a lead observed', c0.leads, 1);
    const sm = gameSummary([], 0, { draw: false, durak: 1, losers: [1], places: [0, 1], pogony: 0 }, rs, { players: 2, trumpSuit: 'S', rulesetId: rs.id });
    eq('analysis: achievements of a win', newAchievements([], sm).includes('firstWin'), true);
  }

  lap('rooms');
  // --- rooms game definition --------------------------------------------------------------------------------------
  {
    const settings = { rulesetId: 'perevodnoy-36' };
    ok('game: seats from the ruleset', game.seats(settings).min === 2 && game.seats(settings).max === 6);
    const room = localRoom(game, settings, { seats: 3, botDelay: 0, random: { kind: 'seeded', seed: 'room' }, bots: [{ seat: 1, kind: 'accountant', options: { level: 2 } }, { seat: 2, kind: 'hunter', options: { level: 2 } }] });
    const v0 = room.view;
    ok('game: the view hides other hands', v0.hands[0] && v0.hands[0].length === 6 && v0.hands[1] === null && !v0.rs && v0.rsHash);
    ok('game: hydrate', hydrate(v0).rs.hash === rulesetOf(settings).hash);
    // Seat 0 plays with the bot policy (as a person would), bots answer through the room.
    const me = makeBot('rookie', { level: 3 });
    const rng = seededRandom('me');
    let guard = 0;
    while (room.status === 'playing' && guard++ < 3000) {
      const v = room.view;
      const a = me(hydrate(v), 0, rng);
      if (a) { const r = await room.act(a); if (!r.ok) { ok('game: own action accepted', false, r.error); break; } }
      await new Promise((res) => setTimeout(res, 1));
    }
    eq('game: a room game ends', room.status, 'over');
    ok('game: the result names the durak', room.result && typeof room.result.durak === 'number');
    ok('game: the final view opens the deal', Array.isArray(room.view.deal) && room.view.seed === 'room');
    room.leave();
  }

  lap('online:');
  // --- online: the game over HTTP (rooms/server.js) -----------------------------------------------------------------
  {
    const http = await import('node:http');
    const { createRoomService } = await import('../rooms/server.js');
    const { connect } = await import('../rooms/client.js');
    const service = createRoomService({ games: { [game.id]: game }, botDelay: 1 });
    const server = http.createServer((req, res) => { service.handle(req, res).then((done) => { if (!done) { res.writeHead(404); res.end(); } }); });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${server.address().port}`;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      const a = connect(url), b = connect(url);
      const skin = { table: 'casino', face: 'russian', back: 'dots', tableImage: 'data:image/png;base64,iVBORw0KGgo=' };
      const own = { ...presetById('jokers-54'), id: 'online-jokers', rules: { ...presetById('jokers-54').rules, handSize: 5 } };
      const made = await a.create({ game: game.id, name: 'Test', player: 'Ann', settings: { ruleset: own, skin }, seats: 3, password: 'secret', public: false, random: { kind: 'seeded', seed: 'net' }, bots: [{ seat: 2, kind: 'miser', options: { level: 2 } }] });
      ok('online: room created', !!made.roomId && made.seat === 0, made);
      let denied = null;
      try { await b.join(made.roomId, { player: 'Bob', password: 'wrong' }); } catch (e) { denied = e.status; }
      eq('online: wrong password refused', denied, 403);
      const joined = await b.join(made.roomId, { player: 'Bob', invite: made.invite });
      eq('online: the invite replaces the password', joined.seat, 1);
      const ra = a.open(made.roomId, made.token), rb = b.open(made.roomId, joined.token);
      await wait(150);
      eq('online: the room look reaches every player', [ra.settings.skin && ra.settings.skin.table, rb.settings.skin && rb.settings.skin.face], ['casino', 'russian']);
      const st = await ra.start();
      ok('online: started', st.ok !== false, st);
      const policy = makeBot('accountant', { level: 2 });
      const rng = seededRandom('net-play');
      let guard = 0, leak = false;
      while ((ra.status !== 'over' || rb.status !== 'over') && guard++ < 4000) {
        for (const [room, seat] of [[ra, 0], [rb, 1]]) {
          const v = room.view;
          if (!v || v.phase === 'over') continue;
          if (v.hands.some((x, i) => i !== seat && x)) leak = true;
          const act = policy(hydrate(v), seat, rng);
          if (act) await room.act(act);
        }
        await wait(3);
      }
      eq('online: a networked game ends', [ra.status, rb.status], ['over', 'over']);
      ok('online: views never show other hands', !leak);
      ok('online: the own ruleset travelled with the room', ra.view && hydrate(ra.view).rs.rules.handSize === 5);
      ra.leave(); rb.leave();
    } catch (e) {
      ok('online: no exception', false, e.message);
    } finally {
      service.close();
      await new Promise((r) => server.close(r));
    }
  }

  lap('end');
  if (isMain) console.log(laps.slice(1).join(', '));
  console.log(`durak: ${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  return fail;
}

if (isMain) {
  const failures = await run({ long: process.argv.includes('--long') });
  process.exitCode = failures ? 1 : 0;
}
