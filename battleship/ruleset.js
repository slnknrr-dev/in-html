// battleship/ruleset.js - data-driven rulesets of Sea Battle (Battleship): the board (any rectangle from 4 × 4 to
// 24 × 24, obstacles / islands), ship shapes (straight ships and any polyomino with its own rotation and mirror
// rights), the fleet (shapes × counts with names), the game rules (players and teams, touching, shots per turn, a
// shot again after a hit, what a sinking announces, the halo around sunk ships, who starts) and special weapons as
// rule modules (radar, air strike, cluster bomb, mines). A ruleset is plain JSON so that players can build, export,
// import and share their own seas.
//
//   normalizeRuleset(raw) -> ruleset      defaults filled, shapes resolved, the fleet expanded (types, ships), hash
//   validateRuleset(raw) -> { ok, errors: [{ path, msg }], warnings, ruleset, players }
//   rulesetHash(raw) -> 'a1b2c3d4'        SHA-256 of the canonical game-relevant content (names and looks excluded)
//   orientations(shape) -> [[[x, y]...]]  the distinct orientations a shape may take (rotations / mirror images)
//   playerRange(rs) -> { min, max };  teamOf(rs, seat);  cellName(rs, cell) 'e5';  parseCell(rs, 'e5') -> cell
//   SHAPES (the built-in shape library), STRAIGHT(n), DEFAULT_RULES, DEFAULT_WEAPONS, textOf(value, lang)
//
// Cells are numbered row by row: cell = y * width + x; their names are a column letter and a row number ('a1' is the
// top left corner), like the squared paper of the school game.

import { sha256 } from '../crypto/sha2.js';
import { utf8ToBytes } from '../crypto/encoding.js';

//
// Design: rules are data, not code. One engine plays every variant, so the constructor can offer any combination
// and a shared ruleset is safe to load (no code is evaluated). normalizeRuleset is the trust boundary: every number
// is clamped (num/int with bounds), every enum checked (oneOf), so the engine and solvers can rely on bounded sizes
// without re-validating. validateBasics reports what normalisation silently fixed, for the constructor UI.
export const FORMAT = 'battleship-ruleset';
export const VERSION = 1;
export const MIN_SIDE = 4;
export const MAX_SIDE = 24;
export const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const num = (v, d, lo = -Infinity, hi = Infinity) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const int = (v, d, lo, hi) => Math.round(num(v, d, lo, hi));
const oneOf = (v, opts, d) => (opts.includes(v) ? v : d);
// Shape ids are short and ASCII-safe because they appear in layouts, logs and hashes.
const ID_RE = /^[A-Za-z0-9_-]{1,12}$/;

// Text of a name field: a string or { en, ru, ... } (lang falls back to en, then any).
export function textOf(v, lang = 'en') {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (isObj(v)) return v[lang] ?? v[String(lang).split('-')[0]] ?? v.en ?? Object.values(v)[0] ?? '';
  return String(v);
}

// --- shapes ----------------------------------------------------------------------------------------------------------

// A straight ship of n cells.
export const STRAIGHT = (n) => ({ id: 'I' + n, cells: Array.from({ length: n }, (_, i) => [i, 0]), rotate: true, mirror: true, builtin: true });

// The built-in shape library: straight ships I1…I8 and polyominoes (the constructor's palette).
export const SHAPES = [
  ...[1, 2, 3, 4, 5, 6, 7, 8].map(STRAIGHT),
  { id: 'L3', name: 'Corner', cells: [[0, 0], [0, 1], [1, 1]] },
  { id: 'O4', name: 'Square', cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { id: 'T4', name: 'T', cells: [[0, 0], [1, 0], [2, 0], [1, 1]] },
  { id: 'S4', name: 'S', cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  { id: 'L4', name: 'L', cells: [[0, 0], [0, 1], [0, 2], [1, 2]] },
  { id: 'P5', name: 'P', cells: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]] },
  { id: 'U5', name: 'U', cells: [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]] },
  { id: 'X5', name: 'Cross', cells: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]] },
  { id: 'T5', name: 'Long T', cells: [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]] },
  { id: 'L5', name: 'Long L', cells: [[0, 0], [0, 1], [0, 2], [0, 3], [1, 3]] },
  { id: 'V5', name: 'V', cells: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]] },
  { id: 'D6', name: 'Barge', cells: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]] },
].map((s) => ({ rotate: true, mirror: true, builtin: true, ...s }));

export const shapeById = (id) => SHAPES.find((s) => s.id === id) || (/^I([1-9]|1[0-2])$/.test(id) ? STRAIGHT(+id.slice(1)) : null);

// Shape cells moved to the origin and sorted (row by row).
// Canonical form: translated to the origin, deduplicated, sorted row-major. Two drawings of the same shape then
// produce the same key (keyOf), which deduplicates orientations and makes the hash drawing-independent.
export function normCells(cells) {
  const pts = (Array.isArray(cells) ? cells : []).filter((p) => Array.isArray(p) && p.length >= 2).map((p) => [Math.round(+p[0]) || 0, Math.round(+p[1]) || 0]);
  if (!pts.length) return [];
  const mx = Math.min(...pts.map((p) => p[0])), my = Math.min(...pts.map((p) => p[1]));
  const seen = new Set(), out = [];
  for (const [x, y] of pts) { const k = (x - mx) + ',' + (y - my); if (!seen.has(k)) { seen.add(k); out.push([x - mx, y - my]); } }
  return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

const keyOf = (cells) => cells.map((p) => p[0] + ',' + p[1]).join(' ');

// Distinct orientations: rotations by 90° when `rotate`, mirror images when `mirror` (the first is the shape as drawn).
// Up to 8 orientations (4 rotations x mirror). Rotation by 90 degrees is (x, y) -> (-y, x); normCells after each
// transform removes the translation, and the seen-set removes symmetric duplicates (a square has 1 orientation,
// a straight ship 2), which matters: duplicate orientations would double-count placements in every probability.
export function orientations(shape) {
  const base = normCells(shape.cells);
  const out = [], seen = new Set();
  const rots = shape.rotate === false ? 1 : 4;
  const mirrors = shape.mirror === false ? [false] : [false, true];
  for (const m of mirrors) {
    for (let r = 0; r < rots; r++) {
      const cells = normCells(base.map(([x0, y0]) => {
        let x = m ? -x0 : x0, y = y0;
        for (let k = 0; k < r; k++) [x, y] = [-y, x];
        return [x, y];
      }));
      const k = keyOf(cells);
      if (!seen.has(k)) { seen.add(k); out.push(cells); }
    }
  }
  return out;
}

// Is a set of cells one 4-connected piece?
// Iterative flood fill over side neighbours: ships must be one 4-connected piece (diagonal-only contact would
// make "sunk" ambiguous with the touch rules).
export function connected(cells) {
  if (!cells.length) return false;
  const set = new Set(cells.map((p) => p[0] + ',' + p[1]));
  const stack = [cells[0]], seen = new Set([cells[0][0] + ',' + cells[0][1]]);
  while (stack.length) {
    const [x, y] = stack.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = (x + dx) + ',' + (y + dy);
      if (set.has(k) && !seen.has(k)) { seen.add(k); stack.push([x + dx, y + dy]); }
    }
  }
  return seen.size === set.size;
}

// --- defaults --------------------------------------------------------------------------------------------------------

// Default game rules: the classic school game (no touching, a shot again after a hit, the sunk ship is shown).
export const DEFAULT_RULES = {
  minPlayers: 2,
  maxPlayers: 2,
  teams: 0,              // 0, or the number of teams (seat i plays for team i % teams)
  touch: 'none',         // 'none' (not even at corners), 'corners' (corners may touch, sides may not), 'any'
  shots: 'single',       // 'single' | 'salvo' (one shot per surviving ship) | 'volley' (a fixed number)
  volley: 3,             // shots of a 'volley' turn
  afterHit: 'again',     // 'again' (a hit earns another turn) | 'pass'
  announce: 'ship',      // 'ship' (a sunk ship is shown), 'sunk' ("sunk", the type named, cells not shown), 'hit'
  halo: true,            // mark the water around a shown sunk ship (needs touch != 'any' and announce 'ship')
  first: 'random',       // 'random' | 'seat0'
};

// Special weapons (rule modules), all off by default: charges per player and their sizes.
export const DEFAULT_WEAPONS = {
  radar: 0, radarSize: 3,          // reports how many ship cells a square of radarSize × radarSize holds
  airstrike: 0, airstrikeLength: 4, // fires along a row or a column of airstrikeLength cells
  cluster: 0,                       // fires at a cross of five cells
  mines: 0,                         // mines hidden on the own board; a shot into one strikes back at the shooter
};

const FLEET_NAMES = ['carrier', 'battleship', 'cruiser', 'submarine', 'destroyer', 'patrol', 'frigate', 'corvette', 'boat', 'tanker', 'tug', 'yacht', 'raft'];
export const SHIP_NAMES = FLEET_NAMES;

// --- normalization ---------------------------------------------------------------------------------------------------

function normBoard(raw) {
  const b = isObj(raw) ? raw : {};
  const width = int(b.width, 10, MIN_SIDE, MAX_SIDE), height = int(b.height, 10, MIN_SIDE, MAX_SIDE);
  const seen = new Set();
  const obstacles = [];
  for (const p of Array.isArray(b.obstacles) ? b.obstacles : []) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const x = Math.round(+p[0]), y = Math.round(+p[1]);
    if (!(x >= 0 && x < width && y >= 0 && y < height)) continue;
    const k = y * width + x;
    if (!seen.has(k)) { seen.add(k); obstacles.push([x, y]); }
  }
  obstacles.sort((a, b2) => a[1] - b2[1] || a[0] - b2[0]);
  return { width, height, obstacles };
}

function normShape(s, builtin = false) {
  return {
    id: String(s.id), name: s.name ?? null, cells: normCells(s.cells),
    rotate: s.rotate !== false, mirror: s.mirror !== false, builtin: !!builtin, color: typeof s.color === 'string' ? s.color : null,
  };
}

// teams = 1 is meaningless (everyone on one side) and is normalised to 0 (free for all).
function normRules(raw) {
  const r = isObj(raw) ? raw : {};
  const D = DEFAULT_RULES;
  const o = {};
  o.minPlayers = int(r.minPlayers, D.minPlayers, 2, 6);
  o.maxPlayers = Math.max(o.minPlayers, int(r.maxPlayers, Math.max(o.minPlayers, D.maxPlayers), 2, 6));
  o.teams = int(r.teams, 0, 0, 3);
  if (o.teams === 1) o.teams = 0;
  o.touch = oneOf(r.touch, ['none', 'corners', 'any'], D.touch);
  o.shots = oneOf(r.shots, ['single', 'salvo', 'volley'], D.shots);
  o.volley = int(r.volley, D.volley, 1, 8);
  o.afterHit = oneOf(r.afterHit, ['again', 'pass'], D.afterHit);
  o.announce = oneOf(r.announce, ['ship', 'sunk', 'hit'], D.announce);
  o.halo = r.halo !== undefined ? !!r.halo : D.halo;
  o.first = oneOf(r.first, ['random', 'seat0'], D.first);
  return o;
}

function normWeapons(raw) {
  const w = isObj(raw) ? raw : {};
  const D = DEFAULT_WEAPONS;
  return {
    radar: int(w.radar, 0, 0, 9), radarSize: int(w.radarSize, D.radarSize, 2, 5),
    airstrike: int(w.airstrike, 0, 0, 9), airstrikeLength: int(w.airstrikeLength, D.airstrikeLength, 2, 8),
    cluster: int(w.cluster, 0, 0, 9),
    mines: int(w.mines, 0, 0, 12),
  };
}

// Idempotence shortcut: an object already carrying format, types, hash and normalized === VERSION is returned as is,
// so hot paths (geometry cache lookups, views) do not re-normalise.
// KNOWN DEFECT (security): the shortcut trusts the object's own claims. game.rulesetOf passes settings.ruleset
// (room settings, which can come from a client) here, so a crafted object with those four fields skips every clamp
// (board size, fleet size, weapon counts), letting a client make the server build huge geometry or loop in
// generators. Fix: honour the shortcut only for objects created by this module (e.g. a module-private WeakSet of
// normalised results), or recompute the hash and compare.
export function normalizeRuleset(raw) {
  const src = isObj(raw) ? raw : {};
  if (src.format === FORMAT && src.types && src.hash && src.normalized === VERSION) return src;
  const board = normBoard(src.board);
  const own = (Array.isArray(src.shapes) ? src.shapes : []).filter((s) => isObj(s) && ID_RE.test(String(s.id ?? ''))).map((s) => normShape(s));
  const shapeOf = (id) => own.find((s) => s.id === id) || (shapeById(id) ? normShape(shapeById(id), true) : null);
  const fleetRaw = Array.isArray(src.fleet) && src.fleet.length ? src.fleet : [{ shape: 'I4', count: 1, name: 'battleship' }, { shape: 'I3', count: 2, name: 'cruiser' }, { shape: 'I2', count: 3, name: 'destroyer' }, { shape: 'I1', count: 4, name: 'boat' }];
  const fleet = fleetRaw.filter(isObj).map((f) => ({ shape: String(f.shape ?? 'I1'), count: int(f.count, 1, 0, 20), name: f.name ?? null }));
  const rules = normRules(src.rules);
  const weapons = normWeapons(src.weapons);
  const rs = {
    format: FORMAT, v: VERSION, normalized: VERSION,
    id: String(src.id || 'custom').replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 64) || 'custom',
    name: src.name ?? 'Custom sea',
    description: src.description ?? '',
    author: src.author ?? '',
    tags: (Array.isArray(src.tags) ? src.tags : []).map(String),
    exclusive: !!src.exclusive,
    board, shapes: own, fleet, rules, weapons,
    skin: isObj(src.skin) ? src.skin : null,
  };
  // Types: one per fleet entry with a known shape and at least one ship; ships: one entry per ship (its type index),
  // the largest ships first (placement order of generators and solvers).
  rs.types = [];
  fleet.forEach((f, i) => {
    const sh = shapeOf(f.shape);
    if (!sh || !sh.cells.length || f.count < 1) return;
    rs.types.push({ index: rs.types.length, entry: i, shape: sh, size: sh.cells.length, count: f.count, name: f.name });
  });
  // Ships sorted largest first: backtracking placers and solvers place the most constrained ships first, which prunes
  // the search tree early (the classic "most constrained variable" heuristic).
  rs.ships = [];
  const order = rs.types.slice().sort((a, b) => b.size - a.size || a.index - b.index);
  for (const tp of order) for (let k = 0; k < tp.count; k++) rs.ships.push(tp.index);
  rs.cellCount = rs.ships.reduce((n, t) => n + rs.types[t].size, 0);
  rs.hash = rulesetHash(rs);
  return rs;
}

// The game-relevant content (no names, descriptions or looks): two rulesets with the same hash play the same game.
// Only what changes play is hashed: names, colours, descriptions and skins are excluded, so a renamed copy of a
// ruleset is recognised as the same game (shared statistics, cached geometry). Keys are sorted for stable JSON.
export function canonicalContent(raw) {
  const rs = raw.types && raw.normalized === VERSION ? raw : null;
  const board = rs ? rs.board : normBoard(raw.board);
  const rules = rs ? rs.rules : normRules(raw.rules);
  const weapons = rs ? rs.weapons : normWeapons(raw.weapons);
  let types = rs ? rs.types : null;
  if (!types) {
    const n = normalizeRuleset({ ...raw, format: undefined, normalized: undefined });
    types = n.types;
  }
  return {
    board: [board.width, board.height, board.obstacles.map((p) => p[0] + ',' + p[1]).join(' ')],
    types: types.map((t) => [keyOf(t.shape.cells), t.shape.rotate, t.shape.mirror, t.count]),
    rules: sortKeys(rules),
    weapons: sortKeys(weapons),
  };
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (!isObj(v)) return v;
  const o = {};
  for (const k of Object.keys(v).sort()) if (v[k] !== undefined) o[k] = sortKeys(v[k]);
  return o;
}

// 32 bits of SHA-256 (8 hex chars): short enough for views and URLs. Accidental collisions are unlikely at the
// scale of rulesets one installation sees (birthday bound ~65k), but the hash is an identifier, not a security
// token: it must not be used to authenticate a ruleset.
export function rulesetHash(raw) {
  const bytes = sha256(utf8ToBytes(JSON.stringify(canonicalContent(raw))));
  let s = '';
  for (let i = 0; i < 4; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

// --- players, teams, cells -------------------------------------------------------------------------------------------

// With teams, the player count must be a multiple of the team count and give each team at least two players.
export function playerRange(rs) {
  const r = rs.rules;
  let min = r.minPlayers, max = r.maxPlayers;
  if (r.teams) {
    min = Math.max(min, r.teams * 2);
    while (max >= min && max % r.teams) max--;
    if (max < min) max = min;
  }
  return { min, max };
}

export const teamOf = (rs, seat) => (rs.rules.teams ? seat % rs.rules.teams : seat);

export function cellName(rs, cell) {
  const w = rs.board.width;
  return LETTERS[cell % w] + (Math.floor(cell / w) + 1);
}

// One letter suffices: MAX_SIDE (24) < 26 letters.
export function parseCell(rs, text) {
  const m = /^([a-z])(\d{1,2})$/.exec(String(text).trim().toLowerCase());
  if (!m) return -1;
  const x = LETTERS.indexOf(m[1]), y = +m[2] - 1;
  return x >= 0 && x < rs.board.width && y >= 0 && y < rs.board.height ? y * rs.board.width + x : -1;
}

// --- validation ------------------------------------------------------------------------------------------------------

/**
 * Checks a raw ruleset. The fleet must fit: `fits(rs)` (placement.js) is passed in by callers that want the check
 * (the library's validateRuleset in placement.js does), so this module stays free of the generator.
 */
export function validateBasics(raw) {
  const errors = [], warnings = [];
  const err = (path, msg) => errors.push({ path, msg });
  const warn = (path, msg) => warnings.push({ path, msg });
  if (!isObj(raw)) return { ok: false, errors: [{ path: '', msg: 'not an object' }], warnings };
  let rs;
  try { rs = normalizeRuleset({ ...raw, format: undefined, normalized: undefined }); } catch (e) { return { ok: false, errors: [{ path: '', msg: String(e.message || e) }], warnings }; }
  const b = isObj(raw.board) ? raw.board : {};
  for (const k of ['width', 'height']) {
    const v = Number(b[k] ?? 10);
    if (!(v >= MIN_SIDE && v <= MAX_SIDE)) err('board.' + k, `the board side must be ${MIN_SIDE}…${MAX_SIDE}`);
  }
  const free = rs.board.width * rs.board.height - rs.board.obstacles.length;
  if (free < 4) err('board.obstacles', 'the obstacles leave no sea');
  const ids = new Set();
  (Array.isArray(raw.shapes) ? raw.shapes : []).forEach((s, i) => {
    if (!isObj(s) || !ID_RE.test(String(s.id ?? ''))) { err(`shapes[${i}].id`, 'a shape id is 1–12 letters, digits, _ or -'); return; }
    if (ids.has(s.id)) err(`shapes[${i}].id`, `duplicate shape id "${s.id}"`);
    if (shapeById(s.id)) warn(`shapes[${i}].id`, `"${s.id}" replaces the built-in shape`);
    ids.add(s.id);
    const cells = normCells(s.cells);
    if (!cells.length) err(`shapes[${i}].cells`, 'a shape needs at least one cell');
    else if (cells.length > 12) err(`shapes[${i}].cells`, 'a shape has at most 12 cells');
    else if (!connected(cells)) err(`shapes[${i}].cells`, 'the cells of a shape must touch by their sides');
    if (cells.some((p) => p[0] > 7 || p[1] > 7)) err(`shapes[${i}].cells`, 'a shape fits into 8 × 8 cells');
  });
  const fleet = Array.isArray(raw.fleet) ? raw.fleet : [];
  fleet.forEach((f, i) => {
    if (!isObj(f)) { err(`fleet[${i}]`, 'not an object'); return; }
    const id = String(f.shape ?? '');
    if (!ids.has(id) && !shapeById(id)) err(`fleet[${i}].shape`, `unknown shape "${id}"`);
  });
  if (!rs.ships.length) err('fleet', 'the fleet has no ships');
  if (rs.ships.length > 40) err('fleet', 'at most 40 ships');
  // 70% fill cap: beyond it, layout generation (sequential placement with restarts, Markov-chain initialisation)
  // slows sharply and with touch 'none' many fleets have no layout at all; the precise fit test is placement.js.
  if (rs.cellCount > free * 0.7) err('fleet', 'the fleet takes more than 70 % of the sea');
  const pr = playerRange(rs);
  const r = rs.rules;
  if (r.teams && r.maxPlayers < r.teams * 2) err('rules.teams', 'teams need at least two players each');
  if (pr.max < pr.min) err('rules.maxPlayers', 'no valid number of players');
  if (r.halo && r.announce !== 'ship' && raw.rules && raw.rules.halo) warn('rules.halo', 'the halo is drawn only when a sunk ship is shown');
  if (r.halo && r.touch === 'any' && raw.rules && raw.rules.halo) warn('rules.halo', 'ships may touch: there is no halo');
  if (r.shots === 'salvo' && r.afterHit === 'again') warn('rules.afterHit', 'a salvo after a hit again makes very long turns');
  const W = rs.weapons;
  if (W.airstrikeLength > Math.max(rs.board.width, rs.board.height)) warn('weapons.airstrikeLength', 'longer than the board');
  if (W.mines && rs.cellCount + W.mines > free) err('weapons.mines', 'no room for the mines');
  return { ok: errors.length === 0, errors, warnings, ruleset: rs, players: pr };
}
