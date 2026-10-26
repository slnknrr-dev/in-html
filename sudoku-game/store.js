// sudoku-game/store.js - what the game keeps in the browser (localStorage): preferences, the game in progress,
// statistics and best times. Every read is validated: storage may hold anything (older versions, other tabs, hands).
//
//   prefs()  -> preferences (defaults filled in)        setPref(key, value) / setPrefs(patch)
//   loadSave() -> saved game | null                     writeSave(game) / clearSave()
//   stats()  -> { games: { key: record }, recent: [...] }  recordGame(entry) -> { best: boolean, record }
//   statKey(options) -> 'classic:9:medium'               dailyDone(date) / markDaily(date)

//
// Why localStorage and not IndexedDB: a few small JSON values, read synchronously at boot (the skin must be applied
// before the first paint). Every access is wrapped in try/catch: storage can be disabled, full, or throw in private
// modes, and the game must still run (just without persistence).
const PREFS = 'sudoku-prefs';
const SAVE = 'sudoku-save';
const STATS = 'sudoku-stats';
const DAILY = 'sudoku-daily';

// Read with a default; parse errors (hand-edited or truncated values) also return the default.
const get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

export const SKINS = ['flat', 'paper', 'wood', 'pastel', 'neon', 'contrast'];

export const DEFAULT_PREFS = {
  skin: 'flat',
  alphabet: 'digits',
  custom: '',
  peers: true,         // tint the row, column and box of the selection
  same: true,          // highlight the cells with the selected symbol
  conflicts: true,     // mark symbols that break a rule
  mistakes: false,     // mark entries that differ from the solution (solo games)
  autoNotes: true,     // placing a symbol removes it from the pencil marks of its peers
  timer: true,
  counts: true,        // remaining count on the number pad
  owners: true,        // shared games: values in the colour of the player who entered them
  sound: false,
  name: '',
  server: '',
  setup: { variant: 'classic', n: 9, box: null, difficulty: 'medium', symmetry: 'rotational', rules: [], random: 'crypto', seed: '' },
};

let cache = null;

// Merge stored values over defaults (new keys get defaults), then coerce each field to its type: booleans with !!,
// strings capped at 400 chars, unknown skins reset. Cached in memory because prefs() is called on every render.
// The cache is per tab: another tab's changes are seen after reload, an accepted trade-off for preferences.
export function prefs() {
  if (cache) return cache;
  const raw = get(PREFS, {});
  const p = { ...DEFAULT_PREFS, ...(raw && typeof raw === 'object' ? raw : {}) };
  p.setup = { ...DEFAULT_PREFS.setup, ...(raw && raw.setup && typeof raw.setup === 'object' ? raw.setup : {}) };
  if (!SKINS.includes(p.skin)) p.skin = 'flat';
  for (const k of ['peers', 'same', 'conflicts', 'mistakes', 'autoNotes', 'timer', 'counts', 'owners', 'sound']) p[k] = !!p[k];
  for (const k of ['alphabet', 'custom', 'name', 'server']) p[k] = typeof p[k] === 'string' ? p[k].slice(0, 400) : DEFAULT_PREFS[k];
  if (!Array.isArray(p.setup.rules)) p.setup.rules = [];
  cache = p;
  return p;
}

// Shallow merge: callers patch whole top-level keys (setup is replaced as one object).
export function setPrefs(patch) {
  cache = { ...prefs(), ...patch };
  set(PREFS, cache);
  return cache;
}
export const setPref = (k, v) => setPrefs({ [k]: v });

// --- the game in progress -----------------------------------------------------------------------------------------
// { v: 1, code, solution: '…' (one character per cell), board, elapsed, options, random: { kind, seed }, hints,
//   mistakes, checks, started, daily?, undo? }

// Minimal shape check (version + the two strings the game cannot run without); deeper validation happens when the
// game is restored (the code is parsed by the puzzle codec).
export function loadSave() {
  const s = get(SAVE, null);
  if (!s || typeof s !== 'object' || s.v !== 1 || typeof s.code !== 'string' || typeof s.solution !== 'string') return null;
  return s;
}
export const writeSave = (game) => set(SAVE, { v: 1, ...game });
export function clearSave() { try { localStorage.removeItem(SAVE); } catch { /* unavailable */ } }

// --- statistics -----------------------------------------------------------------------------------------------------

export const statKey = (o) => `${o.variant}:${o.n}:${o.difficulty}`;

// Rebuilt field by field from storage: `| 0` coerces to int (NaN -> 0), Number.isFinite rejects junk best times.
export function stats() {
  const s = get(STATS, null);
  const out = { games: {}, recent: [] };
  if (s && typeof s === 'object') {
    if (s.games && typeof s.games === 'object') {
      for (const [k, r] of Object.entries(s.games)) {
        if (!r || typeof r !== 'object') continue;
        out.games[k] = { played: r.played | 0, solved: r.solved | 0, best: Number.isFinite(r.best) ? r.best : null, total: +r.total || 0, clean: r.clean | 0 };
      }
    }
    if (Array.isArray(s.recent)) out.recent = s.recent.filter((x) => x && typeof x === 'object').slice(0, 30);
  }
  return out;
}

// entry: { key, solved, time (ms), hints, mistakes, at } -> { best: a new best time (solved without hints),
// previous: the best time before, record }. Best times only count games solved without hints.
// "Clean" solves (no hints) are counted separately and are the only ones eligible for a best time: a hint-assisted
// time is not comparable. `recent` keeps the last 30 games for the statistics dialog.
export function recordGame(entry) {
  const s = stats();
  const r = s.games[entry.key] || { played: 0, solved: 0, best: null, total: 0, clean: 0 };
  const previous = r.best;
  r.played++;
  let best = false;
  if (entry.solved) {
    r.solved++;
    r.total += entry.time;
    if (!entry.hints) r.clean++;
    if (!entry.hints && (r.best == null || entry.time < r.best)) { best = true; r.best = entry.time; }
  }
  s.games[entry.key] = r;
  s.recent.unshift({ key: entry.key, solved: !!entry.solved, time: entry.time, hints: entry.hints | 0, mistakes: entry.mistakes | 0, at: entry.at || Date.now(), mode: entry.mode || 'solo' });
  s.recent = s.recent.slice(0, 30);
  set(STATS, s);
  return { best, previous, record: r };
}

export function resetStats() { try { localStorage.removeItem(STATS); } catch { /* unavailable */ } }

// --- daily puzzles ------------------------------------------------------------------------------------------------------

export function dailyDone(date) {
  const d = get(DAILY, {});
  return d && typeof d === 'object' && Number.isFinite(d[date]) ? d[date] : null;
}
// ISO dates (YYYY-MM-DD) sort lexicographically in date order, so sort() + shift() drops the oldest days.
export function markDaily(date, time) {
  const d = get(DAILY, {});
  const out = d && typeof d === 'object' ? d : {};
  out[date] = time;
  // keep the last 60 days
  const keys = Object.keys(out).sort();
  while (keys.length > 60) delete out[keys.shift()];
  set(DAILY, out);
}
