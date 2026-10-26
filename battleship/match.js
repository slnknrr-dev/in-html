// battleship/match.js - whole games between bots, and solo searches, without any Node module (browsers use it for the
// constructor's quick tournament; sim.js runs it on worker threads). Every decision is checked by the engine: an
// illegal decision is counted and replaced by a legal one, so the counts prove the bots right.
//
//   playGame({ rs, seats: [{ kind, level, options }], seed, record }) -> { result, counters, actions, illegal, over, shots, first }
//   searchShots({ rs, strategy, shooter, seed }) -> { shots, illegal, over }   shots to sink one fleet placed by a strategy

import { apply, newGame, viewOf, actors, targets, shootable, dueFor } from './engine.js';
import { decide, profileOf, placeAction } from './bots.js';
import { randomLayout } from './placement.js';
import { newCounters, observe, observePlacement } from './analysis.js';
import { seededRandom } from '../prng/prng.js';

// A legal action for a seat (the fallback after an illegal decision).
//
// Determinism: one seed drives the whole game; rng.fork(label) derives independent streams for dealing, bots and
// analysis, so recording analysis (which consumes randomness) does not change the game that is played.
// Illegal decisions are not fatal: they are counted (the statistic proves the bots correct when it stays 0) and
// replaced by a uniformly random legal action so the tournament completes.
function anyLegal(s, seat, rng) {
  if (s.phase === 'place') return placeAction(viewOf(s, seat), seat, rng, profileOf('rookie', { level: 1 }));
  const tg = targets(s, seat);
  const t = tg[rng.int(tg.length)];
  const free = shootable(s, t);
  return { type: 'fire', target: t, cells: rng.sample(free, dueFor(s, seat, t)) };
}

export function playGame({ rs, seats, seed, record = false, maxActions = 6000 }) {
  const rng = seededRandom(seed);
  let s = newGame(rs, { players: seats.length, rng });
  const brng = rng.fork('bots');
  const arng = rng.fork('analysis');
  const P = seats.map((x) => profileOf(x.kind, { level: x.level, ...(x.options || {}) }));
  const counters = seats.map(() => newCounters());
  let actions = 0, illegal = 0;
  // maxActions: a hard stop against a ruleset/bot combination that never ends (e.g. a bug that never fires).
  while (s.phase !== 'over' && actions < maxActions) {
    const who = actors(s);
    if (!who.length) break;
    const seat = who[0];
    const v = viewOf(s, seat);
    let a = s.phase === 'place' ? placeAction(v, seat, brng, P[seat]) : decide(v, seat, brng, P[seat]);
    if (record && a) {
      if (a.type === 'place') observePlacement(counters[seat], rs, a);
      else observe(counters[seat], v, seat, a, { rng: arng, samples: 60 });
    }
    let r = a ? apply(s, seat, a) : { error: 'none' };
    if (r.error) { illegal++; a = anyLegal(s, seat, brng); r = apply(s, seat, a); }
    s = r.state;
    actions++;
  }
  return { result: s.result, counters, actions, illegal, over: s.phase === 'over', shots: s.stats.shots, first: s.first };
}

// Shots a shooter needs to sink a fleet placed with `strategy` (one board, the shooter fires every turn).
export function searchShots({ rs, strategy, shooter, seed }) {
  const rng = seededRandom(seed);
  let s = newGame(rs, { players: 2, first: 0 });
  const prof = profileOf(shooter.kind, { level: shooter.level, ...(shooter.options || {}) });
  const layout = randomLayout(rs, rng.fork('fleet'), { strategy, strength: 1 });
  const dummy = randomLayout(rs, rng.fork('dummy'), { strategy: 'uniform' });
  s = apply(s, 1, { type: 'place', ships: layout.ships, mines: layout.mines }).state;
  s = apply(s, 0, { type: 'place', ships: dummy.ships, mines: dummy.mines }).state;
  const brng = rng.fork('shooter');
  let guard = 0, illegal = 0;
  // Solo search: turn is forced to seat 0 each step so only the shooter acts (seat 1 never fires back). This mutates
  // engine state outside apply(), acceptable here because the state is private to this measurement.
  while (s.phase !== 'over' && guard++ < 2000) {
    s.turn = 0;
    const a = decide(viewOf(s, 0), 0, brng, prof);
    const r = apply(s, 0, a);
    if (r.error) { illegal++; break; }
    s = r.state;
  }
  return { shots: s.stats.shots[0], illegal, over: s.phase === 'over' };
}
