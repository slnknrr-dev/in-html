// durak/game.js - the Durak game definition for rooms/ (local play and the server): settings carry the ruleset (a
// preset id or a whole ruleset) and optional skins; views hide the other hands and refer to the ruleset by hash, so
// that a view stays small on the wire (clients register the ruleset from the room settings: hydrate()).
//
//   game = { id: 'durak', version, seats(settings), create(settings, rng), act(state, seat, action), view(state, seat),
//            result(state), bot: { kinds, create(kind, options) } }
//   settings: { rulesetId?, ruleset?, players (from the room), names, first?, skin? (synced look), timer? }
//   rulesetOf(settings) -> normalized ruleset;  registerRuleset(rs);  hydrate(view) -> view with .rs
// Events (for animations): { type: 'lead' | 'throw' | 'beat' | 'transfer' | 'take' | 'pass' | 'swap' | 'bout' |
// 'draw' | 'out' | 'end', seat, cards?, card?, slot?, took?, n? }.

import { normalizeRuleset, playerRange } from './ruleset.js';
import { PRESETS, presetById } from './presets.js';
import { apply, newGame, result, viewOf } from './engine.js';
import { BOT_KINDS, makeBot } from './bots.js';

//
// Same contract as battleship/game.js: views carry only rsHash; rulesets are registered by hash in a FIFO-bounded
// registry (64) on both server and clients. settings.ruleset may come from a client and is normalised here (see
// the KNOWN DEFECT on the normalisation shortcut in ruleset.js).
const REG = new Map();
export function registerRuleset(rs) {
  const n = normalizeRuleset(rs);
  REG.set(n.hash, n);
  if (REG.size > 64) REG.delete(REG.keys().next().value);
  return n;
}
export const rulesetByHash = (h) => REG.get(h) || null;

const SETTINGS_CACHE = new WeakMap();
export function rulesetOf(settings = {}) {
  if (settings && typeof settings === 'object' && SETTINGS_CACHE.has(settings)) return SETTINGS_CACHE.get(settings);
  let raw = settings.ruleset && typeof settings.ruleset === 'object' ? settings.ruleset : presetById(settings.rulesetId || 'podkidnoy-36');
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

// Compact log tuples -> named events for animations; the tuples stay in state and on the wire (much smaller).
function toEvent(e) {
  const [k, seat] = e;
  switch (k) {
    case 'L': return { type: 'lead', seat, cards: e[2] };
    case '+': return { type: 'throw', seat, cards: e[2] };
    case 'B': return { type: 'beat', seat, card: e[2], slot: e[3] };
    case 'T': return { type: 'transfer', seat, cards: e[2], show: !!e[3] };
    case 'X': return { type: 'take', seat };
    case 'P': return { type: 'pass', seat };
    case 'S': return { type: 'swap', seat, card: e[2], got: e[3] };
    case '/': return { type: 'bout', took: !!e[1], seat: e[2] };
    case 'D': return { type: 'draw', seat, n: e[2], trump: e[3] };
    case 'O': return { type: 'out', seat };
    case 'E': return { type: 'end' };
    default: return { type: 'unknown' };
  }
}

export const game = {
  id: 'durak',
  version: 1,
  seats(settings = {}) {
    const pr = playerRange(rulesetOf(settings));
    return { min: pr.min, max: pr.max };
  },
  create(settings = {}, rng) {
    const rs = rulesetOf(settings);
    const s = newGame(rs, { players: settings.players || 2, rng, first: Number.isInteger(settings.first) ? settings.first : null });
    s.seed = rng && rng.kind === 'seeded' ? rng.seed : null;
    s.names = Array.isArray(settings.names) ? settings.names.slice(0, s.n) : [];
    return s;
  },
  act(state, seat, action) {
    const r = apply(state, seat, action);
    if (r.error) return { state, error: r.error };
    return { state: r.state, events: r.events.map(toEvent) };
  },
  // The seed is revealed only after the game: before that it would let a client re-run the shuffle and see all hands.
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
    create(kind, options = {}) {
      const fn = makeBot(kind, options);
      return (view, seat, rng) => fn(hydrate(view), seat, rng);
    },
  },
};

export default game;
