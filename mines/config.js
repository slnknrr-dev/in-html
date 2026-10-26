// mines/config.js - game settings: difficulty presets, limits and normalization of a configuration.
//
// cfg = {
//   w, h          board size in cells (MIN_SIDE … MAX_SIDE)
//   mines         number of mines (at least 1, at most maxMines(cfg))
//   grid          'square' | 'hex'
//   nb            neighbourhood the numbers count: square 'king' (8, classic) | 'cross' (4) | 'knight' (8 knight
//                 moves) | 'wide' (24, a 5 × 5 ring); hex 'king' (6) | 'wide' (18)
//   wrap          wrap-around edges (torus)
//   first         first-click protection: 'opening' (the first click opens an area; the board depends on the seed
//                 and on that click) | 'safe' (the first click is never a mine) | 'marked' (the seed alone fixes the
//                 board; a marked start cell opens an area) | 'off' (the seed alone fixes the board, no protection)
//   noGuess       generate boards that can be solved by logic alone from the start (needs 'opening' or 'marked')
//   marks         right click cycles flag → question mark → hidden
// }

//
// normalizeConfig is the single gate: every other module (game, solver, codes from URLs, stored stats) receives a
// config that already satisfies the invariants below, so none of them re-validates. Invalid combinations are
// repaired toward the nearest valid one instead of rejected: a shared link with a slightly bad config still opens.
import { GRIDS, NEIGHBORHOODS, reach } from './topology.js';

export const MIN_SIDE = 3;
// 500 x 500 = 250k cells: typed arrays of that size are trivial, while DOM / canvas rendering is the real limit.
export const MAX_SIDE = 500;
export const FIRST_MODES = ['opening', 'safe', 'marked', 'off'];

export const PRESETS = {
  beginner: { w: 9, h: 9, mines: 10 },
  intermediate: { w: 16, h: 16, mines: 40 },
  expert: { w: 30, h: 16, mines: 99 },
};

export const DEFAULT_CONFIG = {
  ...PRESETS.beginner, grid: 'square', nb: 'king', wrap: false, first: 'opening', noGuess: false, marks: false,
};

const int = (v, d) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? x : d; };
const clampInt = (v, a, b, d) => Math.min(b, Math.max(a, int(v, d)));

// Cells kept free of mines around the first click: the click alone ('safe') or with its neighbourhood.
export function protectedSize(cfg, maxN) {
  if (cfg.first === 'safe') return 1;
  if (cfg.first === 'opening' || cfg.first === 'marked') return maxN + 1;
  return 1; // 'off': at least one safe cell, or the game could not be won
}

// Largest neighbourhood of a configuration (without building the topology).
export function neighborhoodSize(grid, nb) {
  if (grid === 'hex') return nb === 'wide' ? 18 : 6;
  return { king: 8, cross: 4, knight: 8, wide: 24 }[nb] || 8;
}

export function maxMines(cfg) {
  return Math.max(1, cfg.w * cfg.h - protectedSize(cfg, neighborhoodSize(cfg.grid, cfg.nb)));
}

// A complete, valid configuration from any partial input.
export function normalizeConfig(input = {}) {
  const c = { ...DEFAULT_CONFIG, ...(input && typeof input === 'object' ? input : {}) };
  const grid = GRIDS.includes(c.grid) ? c.grid : 'square';
  const nb = NEIGHBORHOODS[grid].includes(c.nb) ? c.nb : 'king';
  const wrap = !!c.wrap;
  // On a torus a side shorter than 2*reach+1 would make a cell its own neighbour (or count one neighbour twice).
  const min = wrap ? Math.max(MIN_SIDE, 2 * reach(grid, nb) + 1) : MIN_SIDE;
  const w = clampInt(c.w, min, MAX_SIDE, DEFAULT_CONFIG.w);
  let h = clampInt(c.h, min, MAX_SIDE, DEFAULT_CONFIG.h);
  // Odd-r hexagons wrap vertically only with an even number of rows (the row offsets must line up).
  if (grid === 'hex' && wrap && h % 2) h = h < MAX_SIDE ? h + 1 : h - 1;
  const noGuess = !!c.noGuess;
  let first = FIRST_MODES.includes(c.first) ? c.first : 'opening';
  // No-guess generation needs an opened area to start reasoning from; a single safe cell gives the solver nothing.
  if (noGuess && first === 'safe') first = 'opening';
  if (noGuess && first === 'off') first = 'marked';
  const out = { w, h, mines: 0, grid, nb, wrap, first, noGuess, marks: !!c.marks };
  out.mines = clampInt(c.mines, 1, maxMines(out), Math.round(w * h * 0.15));
  return out;
}

// Mine density in percent with one decimal.
export const density = (cfg) => Math.round((cfg.mines / (cfg.w * cfg.h)) * 1000) / 10;

// Mines for a density in percent.
export const minesForDensity = (cfg, pct) => Math.round((cfg.w * cfg.h * pct) / 100);

// The preset a configuration matches (size and mines), or ''.
export function presetOf(cfg) {
  for (const [k, p] of Object.entries(PRESETS)) if (p.w === cfg.w && p.h === cfg.h && p.mines === cfg.mines) return k;
  return '';
}

// Key of a configuration for statistics and best times: everything that changes the difficulty.
// marks (question marks) is deliberately excluded: it is a UI preference, not difficulty. 'opening' and 'marked' share
// a key because both guarantee an opening start.
export function configKey(cfg) {
  const c = normalizeConfig(cfg);
  return [`${c.w}x${c.h}`, c.mines, c.grid, c.nb, c.wrap ? 'wrap' : '', c.noGuess ? 'ng' : '', c.first === 'safe' || c.first === 'off' ? c.first : '']
    .filter((x) => x !== '').join('-');
}
