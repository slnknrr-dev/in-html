// battleship-game/store.js - what the game remembers in the browser (localStorage, every read and write guarded):
// settings, the player's own rulesets and constructed bots, saved fleet layouts, the style profile (analysis counters,
// game summaries, achievements) and saved games (SBN records).
//
//   store.settings / rulesets / bots / layouts / profile / replays     loaded on import
//   save(part)              writes one part
//   addReplay(entry)        { sbn, at, title, result, won }  (newest first, at most 60)
//   userRuleset(id) -> raw | null;  putRuleset(raw);  removeRuleset(id)
//   layoutsFor(hash) -> [{ name, layout, at }];  putLayout(hash, name, layout);  removeLayout(hash, name)

import { lsGet, lsSet } from '../ui/dom.js';
import { newCounters } from '../battleship/analysis.js';

// One localStorage key per part ('battleship-settings', 'battleship-replays', ...), not one blob: saving a setting
// does not rewrite 60 replays, and a corrupt or oversized part cannot take the others down with it.
const KEY = 'battleship';

export const DEFAULT_SETTINGS = {
  name: '', avatar: '⚓',
  skin: 'ocean', useRoomSkin: true, coords: 'latin',
  sound: true, volume: 0.6, motion: 'auto', speed: 'normal', hints: true, timer: 0, practice: false, confirmFire: false,
  rulesetId: 'classic', players: 2,
  seats: [{ kind: 'statistician', level: 2 }, { kind: 'hunter', level: 2 }, { kind: 'corsair', level: 2 }, { kind: 'ghost', level: 2 }, { kind: 'cartographer', level: 2 }],
  random: 'seeded', seed: '', placeStrategy: 'uniform', servers: [], server: '',
};

// Schema-tolerant load: object defaults are merged with the saved object (new settings appear with their defaults
// after an update), array parts accept only arrays; anything else (corrupt JSON, wrong type) falls back to the default.
function load(part, def) {
  const v = lsGet(`${KEY}-${part}`, null);
  if (def && typeof def === 'object' && !Array.isArray(def)) return { ...def, ...(v && typeof v === 'object' && !Array.isArray(v) ? v : {}) };
  return Array.isArray(v) ? v : def;
}

export const store = {
  settings: load('settings', DEFAULT_SETTINGS),
  rulesets: load('rulesets', []),
  bots: load('bots', []),
  layouts: load('layouts', {}),
  profile: load('profile', { counters: newCounters(), games: [], achievements: [] }),
  replays: load('replays', []),
};
// Repairs of nested shapes the shallow merge cannot guarantee: always 5 bot seats (the maximum table is 6 players),
// counters merged with new counter names, arrays where arrays are expected.
if (!Array.isArray(store.settings.seats)) store.settings.seats = DEFAULT_SETTINGS.seats.slice();
while (store.settings.seats.length < 5) store.settings.seats.push({ kind: 'statistician', level: 2 });
store.profile.counters = { ...newCounters(), ...(store.profile.counters || {}) };
if (!Array.isArray(store.profile.games)) store.profile.games = [];
if (!Array.isArray(store.profile.achievements)) store.profile.achievements = [];
if (!store.layouts || typeof store.layouts !== 'object' || Array.isArray(store.layouts)) store.layouts = {};

export function save(part) {
  try { lsSet(`${KEY}-${part}`, store[part]); } catch { /* storage full or blocked */ }
}

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

export const layoutsFor = (hash) => (Array.isArray(store.layouts[hash]) ? store.layouts[hash] : []);
// Layouts are keyed by ruleset hash: a fleet layout is only valid for the exact sea and fleet it was made on, and
// the hash changes whenever the ruleset does. Same-name save replaces (upsert, newest first, at most 12 per ruleset).
export function putLayout(hash, name, layout) {
  const list = layoutsFor(hash).filter((x) => x.name !== name);
  list.unshift({ name, layout, at: Date.now() });
  store.layouts[hash] = list.slice(0, 12);
  save('layouts');
}
export function removeLayout(hash, name) {
  store.layouts[hash] = layoutsFor(hash).filter((x) => x.name !== name);
  save('layouts');
}
