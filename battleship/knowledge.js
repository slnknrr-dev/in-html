// battleship/knowledge.js - what everybody knows about one board, read from a view (engine.viewOf) or rebuilt from the
// public log: known water (misses, the halo, exploded mines, obstacles), known hits, the sunk ships with what their
// announcement revealed (and the hits at the moment of each sinking), radar counts, the mines found. The result is the
// solver's knowledge (solver.js makeKnowledge); bots, hints, replays and the analysis all reason from it, so nobody
// ever uses a hidden fleet.
//
//   boardKnowledge(view, target) -> K           (K.target, K.minesLeft, K.unknown: count of unknown cells)
//   publicMarks(rs, log, target, upto) -> { marks, sunk, scans }   the public state of a board after `upto` log entries
//   knowledgeAt(rs, log, target, upto) -> K     the same knowledge at any point of a record (replays)

import { geometry } from './board.js';
import { makeKnowledge } from './solver.js';

// Public marks of a board rebuilt from the log (0 unknown, 1 miss, 2 hit, 3 shown sunk, 4 halo, 5 mine).
//
// Fairness invariant: knowledge is derived only from public information (a view or the public log), never from the
// state. Bots built on it cannot cheat by construction, and the same function powers hints and replays, so what
// the hint says is exactly what a human could have deduced.
// Log answers: 0 miss, 1 hit, 2 sunk, 3 mine. A sunk entry may carry the ship's cells (announce 'ship' rules) or
// not (announce 'sunk' only); hitsAt snapshots the hits at that moment, which the solver needs to know which hits
// could belong to the sunk ship when its cells are not revealed.
export function publicMarks(rs, log, target, upto = log.length) {
  const G = geometry(rs);
  const marks = new Array(G.N).fill(0);
  const sunk = [];
  const scans = [];
  const hits = new Set();
  for (let i = 0; i < upto && i < log.length; i++) {
    const e = log[i];
    if ((e[0] === 'S' || e[0] === 'K') && e[2] === target) {
      const c = e[3], ans = e[4];
      if (ans === 0) marks[c] = 1;
      else if (ans === 3) marks[c] = 5;
      else {
        marks[c] = 2;
        hits.add(c);
        if (ans === 2) {
          const cells = e[6] || null;
          if (cells) for (const x of cells) marks[x] = 3;
          sunk.push({ t: e[5], at: c, cells, hitsAt: [...hits] });
        }
      }
    } else if (e[0] === 'H' && e[1] === target) {
      for (const x of e[2]) if (marks[x] === 0) marks[x] = 4;
    } else if (e[0] === 'R' && e[2] === target) {
      scans.push({ by: e[1], target, cell: e[3], count: e[4] });
    }
  }
  return { marks, sunk, scans };
}

// The sunk ships of a board with the hits at the moment of each sinking (needed when sunk ships are not shown).
// A view's sunk list lacks hitsAt; when only "sunk" is announced the log is replayed to recover it. If counts
// disagree (truncated log), the view's own list is used rather than inventing data.
function sunkWithHits(view, target) {
  const pub = view.boards[target].sunk || [];
  if (!pub.length || view.rs.rules.announce !== 'sunk') return pub;
  const pm = publicMarks(view.rs, view.log, target);
  return pm.sunk.length === pub.length ? pm.sunk : pub;
}

// Marks -> solver arrays: misses, halo and exploded mines are water; hits and shown-sunk cells are hits; obstacles
// are neither (the geometry already excludes them from every placement).
function build(rs, marks, sunk, scanList, mode) {
  const G = geometry(rs);
  const water = new Uint8Array(G.N), hit = new Uint8Array(G.N);
  let unknown = 0, mines = 0;
  for (let c = 0; c < G.N; c++) {
    const m = marks[c];
    if (G.obstacle[c]) continue;
    if (m === 1 || m === 4 || m === 5) water[c] = 1;
    else if (m === 2 || m === 3) hit[c] = 1;
    else unknown++;
    if (m === 5) mines++;
  }
  const K = makeKnowledge(G, { water, hit, sunk, scans: scanList, mode });
  K.unknown = unknown;
  K.minesFound = mines;
  K.minesLeft = Math.max(0, rs.weapons.mines - mines);
  return K;
}

// Radar square of side r centred on cell (for even r the extra row/column goes right/down), clipped at the edges.
const scanCells = (rs, cell) => {
  const W = rs.board.width, H = rs.board.height, r = rs.weapons.radarSize;
  const x = cell % W, y = (cell / W) | 0, x0 = x - ((r - 1) >> 1), y0 = y - ((r - 1) >> 1);
  const out = [];
  for (let yy = y0; yy < y0 + r; yy++) for (let xx = x0; xx < x0 + r; xx++) if (xx >= 0 && yy >= 0 && xx < W && yy < H) out.push(yy * W + xx);
  return out;
};

export function boardKnowledge(view, target) {
  const rs = view.rs;
  const b = view.boards[target];
  const scans = (view.scans || []).filter((x) => x.target === target).map((x) => ({ cells: x.cells || scanCells(rs, x.cell), count: x.count }));
  const K = build(rs, b.marks, sunkWithHits(view, target), scans, rs.rules.announce);
  K.target = target;
  return K;
}

export function knowledgeAt(rs, log, target, upto = log.length) {
  const pm = publicMarks(rs, log, target, upto);
  const scans = pm.scans.map((x) => ({ cells: scanCells(rs, x.cell), count: x.count }));
  const K = build(rs, pm.marks, pm.sunk, scans, rs.rules.announce);
  K.target = target;
  return K;
}
