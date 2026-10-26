// durak-game/store.js - what the game remembers in the browser (localStorage, every read and write guarded): settings,
// the player's own rulesets and constructed bots, the style profile (analysis counters, game summaries,
// achievements) and saved games (DGN records).
//
//   store.settings / rulesets / bots / profile / replays     loaded on import
//   save(part)              writes one part ('settings' | 'rulesets' | 'bots' | 'profile' | 'replays')
//   addReplay(entry)        { dgn, at, title, result }  (newest first, at most 60)
//   userRuleset(id) -> raw | null;  putRuleset(raw);  removeRuleset(id)
//
// Design: one mutable `store` object shared by all screens, split into five localStorage keys ('durak-settings', ...)
// so a frequent write (settings slider) does not re-serialise the replay archive. Loaded once at import; screens
// mutate store.x and call save('x'). Loading is shape-tolerant: objects are merged over defaults (new settings added
// by a later version get their default), arrays must be arrays or the default is used.

import { lsGet, lsSet } from '../ui/dom.js';
import { newCounters } from '../durak/analysis.js';

const KEY = 'durak';

// seats: 11 entries = the most opponents possible (durak/ruleset.js clamps maxPlayers to 12); the list is longer than
// most games so a player count change keeps each seat's chosen bot. random 'seeded' + seed '' = a fresh random seed
// per game that is still recorded, so every game can be replayed exactly.
export const DEFAULT_SETTINGS = {
  name: '', avatar: '🦊',
  table: 'felt', face: 'anglo', back: 'lattice', tableImage: null, backImage: null, useRoomSkin: true,
  sound: true, volume: 0.6, motion: 'auto', speed: 'normal', hints: true, timer: 0, confirmTake: false,
  rulesetId: 'podkidnoy-36', players: 3, seats: [{ kind: 'accountant', level: 2 }, { kind: 'hunter', level: 2 }, { kind: 'miser', level: 2 }, { kind: 'blitz', level: 2 }, { kind: 'vulture', level: 2 }, { kind: 'gambler', level: 2 }, { kind: 'ally', level: 2 }, { kind: 'puppeteer', level: 2 }, { kind: 'rookie', level: 2 }, { kind: 'grandmaster', level: 2 }, { kind: 'rookie', level: 1 }],
  random: 'seeded', seed: '', servers: [], server: '', playerName: '',
};

// Shallow merge for objects: nested objects (profile.counters) are replaced wholesale, which is why counters are
// re-merged with newCounters() below. Arrays inside settings are not validated here; seats is patched below.
function load(part, def) {
  const v = lsGet(`${KEY}-${part}`, null);
  if (def && typeof def === 'object' && !Array.isArray(def)) return { ...def, ...(v && typeof v === 'object' && !Array.isArray(v) ? v : {}) };
  return Array.isArray(v) ? v : def;
}

export const store = {
  settings: load('settings', DEFAULT_SETTINGS),
  rulesets: load('rulesets', []),
  bots: load('bots', []),
  profile: load('profile', { counters: newCounters(), games: [], achievements: [] }),
  replays: load('replays', []),
};
if (!Array.isArray(store.settings.seats)) store.settings.seats = DEFAULT_SETTINGS.seats.slice();
while (store.settings.seats.length < 11) store.settings.seats.push({ kind: 'rookie', level: 2 });
store.profile.counters = { ...newCounters(), ...(store.profile.counters || {}) };
if (!Array.isArray(store.profile.games)) store.profile.games = [];
if (!Array.isArray(store.profile.achievements)) store.profile.achievements = [];

// Fails silently: a full quota or blocked storage (private mode) must not break a running game; the cost is that the
// change lives only for this session.
export function save(part) {
  try { lsSet(`${KEY}-${part}`, store[part]); } catch { /* storage full or blocked */ }
}

// Newest first, capped at 60: DGN records are a few KB each, so the archive stays far below the ~5 MB origin quota
// shared with settings and constructor data.
export function addReplay(entry) {
  store.replays.unshift({ ...entry, at: entry.at || Date.now() });
  store.replays = store.replays.slice(0, 60);
  save('replays');
}

export const userRuleset = (id) => store.rulesets.find((r) => r.id === id) || null;
export function putRuleset(raw) {
  const i = store.rulesets.findIndex((r) => r.id === raw.id);
  if (i >= 0) store.rulesets[i] = raw; else store.rulesets.unshift(raw);
  save('rulesets');
}
export function removeRuleset(id) {
  store.rulesets = store.rulesets.filter((r) => r.id !== id);
  save('rulesets');
}
