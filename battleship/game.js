// battleship/game.js - the Sea Battle game definition for rooms/ (local play and the server): settings carry the
// ruleset (a preset id or a whole ruleset) and the room's look; the fleets stay in the state (on the server in online
// rooms) and every seat — and every spectator — receives only its own view: its own fleet and what everybody saw of the
// others. Views refer to the ruleset by its hash, so that they stay small on the wire (clients register the ruleset from
// the room settings: hydrate()). Bots run where the room runs (server-side online) and see only their views.
//
//   game = { id: 'battleship', version, seats(settings), create(settings, rng), act(state, seat, action),
//            view(state, seat), result(state), bot: { kinds, create(kind, options) } }
//   settings: { rulesetId?, ruleset?, players (from the room), names, skin? (the room's look) }
//   rulesetOf(settings) -> normalized ruleset;  registerRuleset(rs);  hydrate(view) -> view with .rs
// Events (for animations): { type: 'placed' | 'turn' | 'fire' | 'shot' | 'mine' | 'halo' | 'radar' | 'airstrike' |
// 'cluster' | 'lost' | 'resign' | 'end', seat?, target?, cell?, ans?, t?, cells?, count?, dir? }.

import { normalizeRuleset, playerRange } from './ruleset.js';
import { PRESETS, presetById } from './presets.js';
import { apply, newGame, result, viewOf } from './engine.js';
import { BOT_KINDS, makeBot } from './bots.js';

//
// Ruleset registry by hash, FIFO-bounded at 64: views carry only rsHash (a full ruleset per message would be
// kilobytes of repeated data); clients register rulesets from room settings and hydrate views locally.
const REG = new Map();
export function registerRuleset(rs) {
  const n = normalizeRuleset(rs);
  REG.set(n.hash, n);
  if (REG.size > 64) REG.delete(REG.keys().next().value);
  return n;
}
export const rulesetByHash = (h) => REG.get(h) || null;

// WeakMap keyed by the settings object: repeated rulesetOf(settings) calls skip normalisation and hashing, and the
// entry disappears with the settings object (no leak across rooms).
const SETTINGS_CACHE = new WeakMap();
export function rulesetOf(settings = {}) {
  if (settings && typeof settings === 'object' && SETTINGS_CACHE.has(settings)) return SETTINGS_CACHE.get(settings);
  let raw = settings && settings.ruleset && typeof settings.ruleset === 'object' ? settings.ruleset : presetById((settings && settings.rulesetId) || 'classic');
  if (!raw) raw = PRESETS[0];
  const rs = registerRuleset(raw);
  if (settings && typeof settings === 'object') SETTINGS_CACHE.set(settings, rs);
  return rs;
}

// A view with its ruleset object (views travel with the hash only).
export function hydrate(view) {
  if (!view || view.rs) return view;
  const rs = rulesetByHash(view.rsHash);
  if (!rs) throw new Error('unknown ruleset ' + view.rsHash);
  return { ...view, rs };
}

// Compact log tuples (first element = type letter) expanded into named events for animations. The tuple form stays
// in the state and on the wire because it is several times smaller than objects with key names.
export function toEvent(e) {
  switch (e[0]) {
    case 'P': return { type: 'placed', seat: e[1] };
    case 'T': return { type: 'turn', seat: e[1] };
    case 'F': return { type: 'fire', seat: e[1], target: e[2], n: e[3] };
    case 'S': return { type: 'shot', seat: e[1], target: e[2], cell: e[3], ans: e[4], t: e[5] ?? null, cells: e[6] ?? null };
    case 'K': return { type: 'mine', seat: e[1], target: e[2], cell: e[3], ans: e[4], t: e[5] ?? null, cells: e[6] ?? null };
    case 'H': return { type: 'halo', target: e[1], cells: e[2] };
    case 'R': return { type: 'radar', seat: e[1], target: e[2], cell: e[3], count: e[4] };
    case 'A': return { type: 'airstrike', seat: e[1], target: e[2], cell: e[3], dir: e[4] };
    case 'C': return { type: 'cluster', seat: e[1], target: e[2], cell: e[3] };
    case 'O': return { type: 'lost', seat: e[1] };
    case 'Q': return { type: 'resign', seat: e[1] };
    case 'E': return { type: 'end' };
    default: return { type: 'unknown' };
  }
}

export const game = {
  id: 'battleship',
  version: 1,
  seats(settings = {}) {
    const pr = playerRange(rulesetOf(settings));
    return { min: pr.min, max: pr.max };
  },
  create(settings = {}, rng) {
    const rs = rulesetOf(settings);
    const s = newGame(rs, { players: settings.players || 2, rng, names: Array.isArray(settings.names) ? settings.names : [] });
    s.seed = rng && rng.kind === 'seeded' ? rng.seed : null;
    return s;
  },
  act(state, seat, action) {
    const r = apply(state, seat, action);
    if (r.error) return { state, error: r.error };
    return { state: r.state, events: r.events.map(toEvent) };
  },
  // rs set to undefined (dropped by JSON) and replaced by its hash; the seed is revealed only when the game is over:
  // earlier it would let a client reproduce the shuffle/rng stream and predict hidden information.
  view(state, seat) {
    const v = viewOf(state, seat);
    v.rs = undefined;
    v.rsHash = state.rs.hash;
    v.seed = state.phase === 'over' ? state.seed : null;
    return v;
  },
  result(state) { return result(state); },
  bot: {
    kinds: BOT_KINDS,
    // Bots receive hydrated views only, the same information a human seat has (they run server-side in online rooms).
    create(kind, options = {}) {
      const fn = makeBot(kind, options);
      return (view, seat, rng) => fn(hydrate(view), seat, rng);
    },
  },
};

export default game;
