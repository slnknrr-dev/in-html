// battleship/analysis.js - the style of a player measured from their decisions and fleets, compared with the bot
// personalities, style badges, game summaries and achievements. The same observer runs on people (the application
// records each shot) and on bots (sim.js), so a person's style can be placed among the bot templates ("your style is
// closest to the Hunter").
//
//   newCounters() -> counters;  observe(counters, view, seat, action, { rng, samples })   one decision (the view before it)
//   observePlacement(counters, rs, layout)                                                 one fleet
//   features(counters) -> { discipline, parity, edge, deduction, choice, curiosity, trigger, placeEdge, placeSpread,
//                           horizontal }   (0…1 each; null when never observed)
//   STYLE_FEATURES: [{ id, weight }];  compare(features, profiles) -> [{ id, distance, similarity }] closest first
//   traitsOf(features) -> [badge id];  mergeCounters(a, b)
//   gameSummary(view, seat, extra) -> one game for the achievements;  ACHIEVEMENTS;  newAchievements(history, summary, have)

import { geometry } from './board.js';
import { teamOf } from './ruleset.js';
import { boardKnowledge } from './knowledge.js';
import { sample, density, expectedInfo } from './solver.js';
import { layoutFeatures } from './placement.js';
import { decisions } from './notation.js';

//
// Method: raw counters are accumulated (mergeable across games and devices by addition), and turned into ratios
// only at read time (features). Ratios of sums, not averages of per-game ratios: a 3-shot game must not weigh as
// much as a 60-shot one. Minimum sample sizes (min argument of r()) return null instead of a noisy number.
// Weights express how characteristic each feature is of a playing style; compare() uses a weighted RMS distance
// over the features both sides have.
export const STYLE_FEATURES = [
  { id: 'discipline', weight: 1.4 },   // with a wounded ship on the board: shots next to it
  { id: 'parity', weight: 1 },         // searching shots on one colour of the checkerboard
  { id: 'edge', weight: 0.8 },         // searching shots on the edge of the sea
  { id: 'deduction', weight: 1 },      // shots that could still hit (not into water known by deduction)
  { id: 'choice', weight: 1.4 },       // the chance of the chosen cell against the best chance
  { id: 'curiosity', weight: 0.8 },    // the expected information of the chosen cell against the best
  { id: 'trigger', weight: 0.6 },      // weapons fired early
  { id: 'placeEdge', weight: 0.8 },    // own ship cells on the edge
  { id: 'placeSpread', weight: 0.6 },  // own ships spread out (normalised distance to the nearest ship)
  { id: 'horizontal', weight: 0.4 },   // own straight ships lying horizontally
];

export function newCounters() {
  return {
    shots: 0, hits: 0, followOpp: 0, follow: 0, hunt: 0, parity0: 0, parity1: 0, edge: 0, wasted: 0,
    choice: 0, choiceN: 0, curious: 0, curiousN: 0, weapons: 0, weaponsEarly: 0,
    fleets: 0, placeEdge: 0, placeSpread: 0, horizontal: 0, horizontalN: 0,
  };
}

export function mergeCounters(a, b) {
  const o = newCounters();
  for (const k of Object.keys(o)) o[k] = (a && a[k] || 0) + (b && b[k] || 0);
  return o;
}

/**
 * Records one decision of `seat` taken on `view` (the seat's view before the action). opts.samples: Monte-Carlo
 * samples for the choice quality (0: the density heuristic only); opts.rng (prng/) for them.
 */
// Measured against the observer's own posterior (Monte Carlo on the same public knowledge): "choice" is how close
// the chosen cell's hit chance is to the best available; "curiosity" the same for expected information. Both are
// normalised by the best so they compare across positions of different difficulty.
// wasted = shots into cells with zero placement density, i.e. cells deduction already rules out.
export function observe(cn, view, seat, action, { rng = null, samples = 120 } = {}) {
  if (!view || !action || view.phase !== 'battle') return;
  const rs = view.rs, G = geometry(rs);
  const target = action.target;
  if (!(target >= 0) || !view.boards[target]) return;
  const b = view.boards[target];
  if (action.type === 'radar' || action.type === 'airstrike' || action.type === 'cluster') {
    cn.weapons++;
    let hit = 0;
    for (const m of b.marks) if (m === 2 || m === 3) hit++;
    if (hit < rs.cellCount / 2) cn.weaponsEarly++;
    return;
  }
  if (action.type !== 'fire' || !Array.isArray(action.cells) || !action.cells.length) return;
  const open = [];
  for (let c = 0; c < b.marks.length; c++) if (b.marks[c] === 2) open.push(c);
  const K = boardKnowledge(view, target);
  const dens = density(K, { hitBonus: 0 });
  let st = null;
  if (samples > 0 && rng) { st = sample(K, rng, { samples, chains: 2, burn: 4 }); if (!st.n) st = null; }
  const free = [];
  for (let c = 0; c < G.N; c++) if (!G.obstacle[c] && b.marks[c] === 0) free.push(c);
  let bestP = 0, bestI = 0;
  const pOf = (c) => (st ? st.occ[c] / st.n : 0);
  if (st) for (const c of free) { bestP = Math.max(bestP, pOf(c)); bestI = Math.max(bestI, expectedInfo(K, st, c)); }
  for (const c of action.cells) {
    cn.shots++;
    if (open.length) {
      cn.followOpp++;
      if (open.some((h) => G.n4[h].includes(c))) cn.follow++;
    } else {
      cn.hunt++;
      const x = c % G.W, y = (c / G.W) | 0;
      if ((x + y) % 2) cn.parity1++; else cn.parity0++;
      if (G.border[c]) cn.edge++;
    }
    if (dens[c] <= 0) cn.wasted++;
    if (st && bestP > 0) { cn.choice += Math.min(1, pOf(c) / bestP); cn.choiceN++; }
    if (st && bestI > 0) { cn.curious += Math.min(1, expectedInfo(K, st, c) / bestI); cn.curiousN++; }
  }
}

// Spread is normalised by roughly half the board diagonal-ish scale (sqrt(area) / 2.2) so it is comparable across
// board sizes and capped at 1.
export function observePlacement(cn, rs, layout) {
  const f = layoutFeatures(rs, layout);
  if (!f) return;
  const G = geometry(rs);
  cn.fleets++;
  cn.placeEdge += f.edge;
  // the distance to the nearest ship relative to the board size
  cn.placeSpread += Math.min(1, f.spread / (Math.sqrt(G.W * G.H) / 2.2));
  if (f.horizontal != null) { cn.horizontal += f.horizontal; cn.horizontalN++; }
}

export function features(cn) {
  const r = (a, b, min = 1) => (b >= min ? a / b : null);
  return {
    discipline: r(cn.follow, cn.followOpp, 3),
    parity: cn.hunt >= 6 ? Math.max(cn.parity0, cn.parity1) / cn.hunt : null,
    edge: r(cn.edge, cn.hunt, 6),
    deduction: cn.shots >= 6 ? 1 - cn.wasted / cn.shots : null,
    choice: r(cn.choice, cn.choiceN, 6),
    curiosity: r(cn.curious, cn.curiousN, 6),
    trigger: r(cn.weaponsEarly, cn.weapons, 1),
    placeEdge: r(cn.placeEdge, cn.fleets, 1),
    placeSpread: r(cn.placeSpread, cn.fleets, 1),
    horizontal: r(cn.horizontal, cn.horizontalN, 1),
  };
}

// similarity = 1 - 1.6 * distance, clamped: a presentation mapping (0.625 RMS difference reads as 0% similar).
export function compare(f, profiles) {
  const out = [];
  for (const [id, p] of Object.entries(profiles || {})) {
    let d = 0, w = 0;
    for (const { id: k, weight } of STYLE_FEATURES) {
      if (f[k] == null || p == null || p[k] == null) continue;
      d += weight * (f[k] - p[k]) ** 2;
      w += weight;
    }
    if (!w) continue;
    const distance = Math.sqrt(d / w);
    out.push({ id, distance, similarity: Math.max(0, 1 - distance * 1.6) });
  }
  return out.sort((a, b) => a.distance - b.distance);
}

export function traitsOf(f) {
  const out = [];
  if (f.discipline != null && f.discipline >= 0.9) out.push('bloodhound');
  if (f.parity != null && f.parity >= 0.8) out.push('checkerboard');
  if (f.edge != null && f.edge >= 0.5) out.push('coastwatcher');
  if (f.deduction != null && f.deduction >= 0.99) out.push('deducer');
  if (f.choice != null && f.choice >= 0.85) out.push('sniper');
  if (f.curiosity != null && f.curiosity >= 0.9) out.push('scholar');
  if (f.trigger != null && f.trigger >= 0.7) out.push('trigger');
  if (f.placeEdge != null && f.placeEdge >= 0.5) out.push('coastHugger');
  if (f.placeEdge != null && f.placeEdge <= 0.12) out.push('openSea');
  if (f.horizontal != null && (f.horizontal >= 0.8 || f.horizontal <= 0.2)) out.push('oneWay');
  return out;
}

// --- games and achievements ------------------------------------------------------------------------------------------

/**
 * One finished game of `seat`, from the final view. extra: { rulesetId, exclusive, seeded, online, opponents: [{ kind,
 * level }], luck, hints, practice }.
 */
// Pure function of the final view (and caller-supplied context), so achievements can be recomputed from stored
// records at any time; the log is walked with notation.decisions() to group shots by action.
export function gameSummary(view, seat, extra = {}) {
  const rs = view.rs;
  const r = view.result || {};
  const log = view.log;
  const won = !r.draw && (r.winners || []).includes(seat);
  let shots = 0, hits = 0, streak = 0, best = 0, multiSink = 0, weaponSink = false, radarFound = 0, mineHit = false, weaponsUsed = 0;
  let sinksThisTurn = 0;
  for (const d of decisions(log)) {
    if (d.seat !== seat) { if (d.target === seat) { /* opponent */ } continue; }
    if (d.kind === 'radar') { weaponsUsed++; radarFound = Math.max(radarFound, log[d.i][4]); continue; }
    if (d.kind !== 'fire') weaponsUsed++;
    for (const k of d.shots) {
      const e = log[k];
      shots++;
      if (e[4] === 1 || e[4] === 2) { hits++; streak++; best = Math.max(best, streak); } else streak = 0;
      if (e[4] === 2 && d.kind !== 'fire') weaponSink = true;
    }
  }
  // ships sunk in one turn of `seat`
  let turnSeat = -1;
  for (const e of log) {
    if (e[0] === 'T') { turnSeat = e[1]; sinksThisTurn = 0; continue; }
    if (e[0] === 'S' && e[1] === seat && turnSeat === seat && e[4] === 2) { sinksThisTurn++; multiSink = Math.max(multiSink, sinksThisTurn); }
    if (e[0] === 'S' && e[2] === seat && e[4] === 3) mineHit = true;
    if (e[0] === 'K' && e[1] === seat) mineHit = true;
  }
  const own = view.boards[seat];
  const lostCells = own ? own.marks.filter((m) => m === 2 || m === 3).length : 0;
  const shipsLeft = own && own.ships ? own.ships.filter((s) => !s.sunk).length : 0;
  return {
    won, draw: !!r.draw, shots, hits, accuracy: shots ? hits / shots : 0, streak: best, multiSink, weaponSink, radarFound, mineHit, weaponsUsed,
    lostCells, lostShare: rs.cellCount ? lostCells / rs.cellCount : 0, shipsLeft, players: view.n, teams: !!rs.rules.teams,
    salvo: rs.rules.shots !== 'single', fog: rs.rules.announce === 'hit', islands: rs.board.obstacles.length > 0,
    shapes: rs.types.some((t) => !/^I\d+$/.test(t.shape.id) || !t.shape.builtin), board: rs.board.width * rs.board.height,
    rulesetId: extra.rulesetId || rs.id, exclusive: !!(extra.exclusive ?? rs.exclusive), seeded: !!extra.seeded, online: !!extra.online,
    opponents: extra.opponents || [], luck: extra.luck ?? null, hints: !!extra.hints, practice: !!extra.practice,
    team: rs.rules.teams ? teamOf(rs, seat) : null,
  };
}

// Predicates over one game summary g and the history h of earlier summaries; newAchievements() skips practice games
// so hints/undo cannot farm achievements.
export const ACHIEVEMENTS = [
  { id: 'firstWin', icon: '🏆', test: (g) => g.won },
  { id: 'flawless', icon: '🛡️', test: (g) => g.won && g.lostCells === 0 },
  { id: 'sharpshooter', icon: '🎯', test: (g) => g.won && g.shots >= 15 && g.accuracy >= 0.6 },
  { id: 'hotStreak', icon: '🔥', test: (g) => g.streak >= 6 },
  { id: 'doubleSink', icon: '💥', test: (g) => g.multiSink >= 2 },
  { id: 'closeCall', icon: '😅', test: (g) => g.won && g.shipsLeft === 1 && g.lostCells > 0 },
  { id: 'comeback', icon: '🌊', test: (g) => g.won && g.lostShare >= 0.7 },
  { id: 'admiralSlayer', icon: '👑', test: (g) => g.won && g.opponents.some((o) => o.kind === 'admiral' && o.level >= 3) },
  { id: 'blitz', icon: '⚡', test: (g) => g.won && g.board >= 100 && g.board <= 120 && g.shots <= 45 && !g.salvo },
  { id: 'lucky', icon: '🍀', test: (g) => g.luck != null && g.luck >= 4 },
  { id: 'salvoMaster', icon: '🎆', test: (g) => g.won && g.salvo },
  { id: 'islander', icon: '🏝️', test: (g) => g.won && g.islands },
  { id: 'shipwright', icon: '🧩', test: (g) => g.won && g.shapes },
  { id: 'lastFleet', icon: '🏁', test: (g) => g.won && g.players >= 3 && !g.teams },
  { id: 'teamPlayer', icon: '🤝', test: (g) => g.won && g.teams },
  { id: 'fogWalker', icon: '🌫️', test: (g) => g.won && g.fog },
  { id: 'airAce', icon: '✈️', test: (g) => g.weaponSink },
  { id: 'sonar', icon: '📡', test: (g) => g.radarFound >= 3 },
  { id: 'minefield', icon: '💣', test: (g) => g.mineHit },
  { id: 'seeded', icon: '🌱', test: (g) => g.seeded },
  { id: 'marathon', icon: '🏃', test: (g) => g.shots >= 100 },
  { id: 'streak3', icon: '📈', test: (g, h) => g.won && h.length >= 2 && h.slice(-2).every((x) => x.won) },
  { id: 'collector', icon: '🗂️', test: (g, h) => new Set([...h, g].filter((x) => x.won).map((x) => x.rulesetId)).size >= 5 },
  { id: 'online', icon: '🌐', test: (g) => g.online && g.won },
];

export function newAchievements(history, summary, have = []) {
  if (summary.practice) return [];
  return ACHIEVEMENTS.filter((a) => !have.includes(a.id) && a.test(summary, history)).map((a) => a.id);
}
