// durak/sim.js - bot-versus-bot simulations in Node: the difficulty calibration of every template and level, the
// interaction matrix (which bots counter or help which), head-to-head results and the style profiles of the
// templates (analysis.js features). `node durak/sim.js all` writes durak/botstats.js; worker threads use every core.
//
//   node durak/sim.js all [--games N] [--workers K] [--preset id]     everything, writes botstats.js
//   node durak/sim.js bench                                           decision time per template and level
//   node durak/sim.js match <kind.level,kind.level,...> [--games N]   one table, durak rate per seat kind
//
//   playGame({ rs, seats: [{ kind, level, options }], seed, record }) -> { result, counters, actions }
//
// Method (README.md): every comparison uses common random numbers — the same seeds (deals) for the condition and its
// baseline — and rotates the seats, so differences come from the bots, not from the cards.

import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeRuleset } from './ruleset.js';
import { presetById } from './presets.js';
import { apply, legalActions, newGame, turn, viewOf } from './engine.js';
import { decide, profileOf, TEMPLATES } from './bots.js';
import { features, mergeCounters, newCounters, observe } from './analysis.js';
import { seededRandom } from '../prng/prng.js';

//
// Same harness design as battleship/sim.js: the file is both the main program and the worker script; jobs are pure
// data, results depend only on the job (seeded rng forks), so statistics are reproducible regardless of scheduling.
const HERE = path.dirname(fileURLToPath(import.meta.url));

// Bots act on views (their legal information) and every action is validated by the engine; an illegal decision is
// counted and replaced by the first legal action, so a non-zero count flags a bot bug without aborting the run.
export function playGame({ rs, seats, seed, record = false, maxActions = 4000 }) {
  const rng = seededRandom(seed);
  let s = newGame(rs, { players: seats.length, rng });
  const brng = rng.fork('bots');
  const P = seats.map((x) => profileOf(x.kind, { level: x.level, ...(x.options || {}) }));
  const counters = seats.map(() => newCounters());
  let actions = 0, illegal = 0;
  while (s.phase !== 'over' && actions < maxActions) {
    const seat = turn(s);
    if (seat < 0) break;
    const v = viewOf(s, seat);
    let a = decide(v, seat, brng, P[seat]);
    if (record && a) observe(counters[seat], v, seat, a);
    let r = a ? apply(s, seat, a) : { error: 'none' };
    if (r.error) { illegal++; a = legalActions(s, seat)[0]; r = apply(s, seat, a); }
    s = r.state;
    actions++;
  }
  return { result: s.result, counters, actions, illegal, over: s.phase === 'over' };
}

// --- jobs and workers ------------------------------------------------------------------------------------------

// A job: { preset, seats: [{ kind, level }], seed, rotate: k } -> { durak: seat index in `seats` order | -1, draw, ... }
// Seat rotation maps physical seats back to logical ones, averaging out positional advantages (who attacks first).
function runJob(job) {
  const rs = normalizeRuleset(presetById(job.preset));
  const n = job.seats.length;
  // rotation: physical seat i plays job.seats[(i + rotate) % n]
  const phys = Array.from({ length: n }, (_, i) => job.seats[(i + job.rotate) % n]);
  const g = playGame({ rs, seats: phys, seed: job.seed, record: !!job.record });
  const logical = (i) => (i + job.rotate) % n;
  const r = g.result;
  return {
    id: job.id, draw: !r || r.draw, losers: r ? r.losers.map(logical) : [], places: r ? r.places.map(logical) : [],
    counters: job.record ? g.counters.map((c, i) => ({ who: logical(i), c })) : null, actions: g.actions, illegal: g.illegal, over: g.over,
  };
}

if (!isMainThread && workerData && workerData.durakSim) {
  parentPort.on('message', (msg) => {
    if (msg.jobs) parentPort.postMessage({ results: msg.jobs.map(runJob) });
  });
}

// Pull-based pool with batches of 4: balances unequal game lengths across workers.
export async function runJobs(jobs, { workers = Math.max(1, os.cpus().length - 1), progress = null } = {}) {
  if (workers <= 1) return jobs.map((j, i) => { const r = runJob(j); if (progress) progress(i + 1, jobs.length); return r; });
  const results = new Array(jobs.length);
  let next = 0, done = 0;
  const batch = 4;
  const pool = [];
  await new Promise((resolve, reject) => {
    const feed = (w) => {
      if (next >= jobs.length) { w.terminate(); if (done >= jobs.length) resolve(); return; }
      const chunk = jobs.slice(next, next + batch).map((j, k) => ({ ...j, id: next + k }));
      next += chunk.length;
      w.postMessage({ jobs: chunk });
    };
    for (let i = 0; i < Math.min(workers, jobs.length); i++) {
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: { durakSim: true } });
      pool.push(w);
      w.on('message', (m) => {
        for (const r of m.results) { results[r.id] = r; done++; }
        if (progress) progress(done, jobs.length);
        if (done >= jobs.length) { for (const x of pool) x.terminate(); resolve(); return; }
        feed(w);
      });
      w.on('error', reject);
      feed(w);
    }
  });
  return results;
}

// --- experiments -----------------------------------------------------------------------------------------------

const REF = { kind: 'rookie', level: 3 }; // the reference field

// Rating of a durak rate p at a table of `n` players against references: Bradley-Terry style, equal play = 1500.
// Durak is a "one loser" game: at a fair table of n players the durak rate is 1/n. The odds (1/q - 1) / (n - 1)
// equal 1 exactly at q = 1/n, so equal play maps to 1500; each factor of 10 in those odds is 400 points (Elo scale).
export function ratingOf(p, n) {
  const q = Math.min(0.995, Math.max(0.005, p));
  return Math.round(1500 + 400 * Math.log10((1 / q - 1) / (n - 1)));
}

function seeds(prefix, k) { return Array.from({ length: k }, (_, i) => `${prefix}-${i}`); }

// Difficulty: each template at each level against two references (3 players), seats rotated.
// Three-player tables against two copies of a fixed reference (Hard rookie): one common scale for all templates.
function calibrationJobs(preset, games) {
  const jobs = [];
  for (const t of TEMPLATES) {
    for (const level of [1, 2, 3, 4]) {
      for (const [i, seed] of seeds('cal', games).entries()) {
        jobs.push({ preset, seats: [{ kind: t.id, level }, REF, REF], seed, rotate: i % 3, tag: `cal:${t.id}:${level}`, record: level === 3 });
      }
    }
  }
  return jobs;
}

// Interactions: X at level 2 with Y and a reference, against X with two references, the same deals (3 players).
function interactionJobs(preset, games) {
  const jobs = [];
  for (const x of TEMPLATES) {
    for (const [i, seed] of seeds('int', games).entries()) jobs.push({ preset, seats: [{ kind: x.id, level: 2 }, REF, REF], seed, rotate: i % 3, tag: `base:${x.id}` });
    for (const y of TEMPLATES) {
      for (const [i, seed] of seeds('int', games).entries()) jobs.push({ preset, seats: [{ kind: x.id, level: 2 }, { kind: y.id, level: 2 }, REF], seed, rotate: i % 3, tag: `int:${x.id}:${y.id}` });
    }
  }
  return jobs;
}

// Head to head: two templates at level 2, two players, seats alternate.
function duelJobs(preset, games) {
  const jobs = [];
  for (let a = 0; a < TEMPLATES.length; a++) {
    for (let b = a + 1; b < TEMPLATES.length; b++) {
      for (const [i, seed] of seeds('duel', games).entries()) jobs.push({ preset, seats: [{ kind: TEMPLATES[a].id, level: 2 }, { kind: TEMPLATES[b].id, level: 2 }], seed, rotate: i % 2, tag: `duel:${TEMPLATES[a].id}:${TEMPLATES[b].id}` });
    }
  }
  return jobs;
}

const rate = (rs, who = 0) => {
  let d = 0, n = 0;
  for (const r of rs) { n++; if (!r.draw && r.losers.includes(who)) d++; else if (r.draw) d += 0; }
  return n ? d / n : 0;
};

export async function runAll({ preset = 'podkidnoy-36', games = 300, workers, log = console.log } = {}) {
  const t0 = Date.now();
  const tick = (label) => { let last = 0; return (d, n) => { const now = Date.now(); if (now - last > 5000 || d === n) { last = now; log(`  ${label} ${d}/${n} ${((now - t0) / 1000).toFixed(0)}s`); } }; };
  log(`calibration (${preset}, ${games} games per template and level)`);
  const cj = calibrationJobs(preset, games);
  const cr = await runJobs(cj, { workers, progress: tick('calibration') });
  log(`interactions (${Math.round(games * 0.8)} games per pair)`);
  const ij = interactionJobs(preset, Math.round(games * 0.8));
  const ir = await runJobs(ij, { workers, progress: tick('interactions') });
  log(`duels (${Math.round(games * 0.5)} games per pair)`);
  const dj = duelJobs(preset, Math.round(games * 0.5));
  const dr = await runJobs(dj, { workers, progress: tick('duels') });

  const by = (jobs, res) => { const m = new Map(); jobs.forEach((j, i) => { if (!m.has(j.tag)) m.set(j.tag, []); m.get(j.tag).push(res[i]); }); return m; };
  const C = by(cj, cr), I = by(ij, ir), D = by(dj, dr);
  const out = { preset, games, generated: new Date().toISOString().slice(0, 10), reference: `${REF.kind}.${REF.level}`, templates: {}, interactions: {}, duels: {} };
  for (const t of TEMPLATES) {
    const levels = {};
    let counters = newCounters();
    for (const level of [1, 2, 3, 4]) {
      const rs = C.get(`cal:${t.id}:${level}`);
      const p = rate(rs, 0);
      levels[level] = { durak: +p.toFixed(3), rating: ratingOf(p, 3) };
      if (level === 3) for (const r of rs) for (const x of r.counters || []) if (x.who === 0) counters = mergeCounters(counters, x.c);
    }
    const f = features(counters);
    for (const k of Object.keys(f)) if (f[k] != null) f[k] = +f[k].toFixed(3);
    out.templates[t.id] = { levels, style: f };
  }
  // interactions: delta of X's durak rate with Y at the table (paired by seed), minus Y's average effect.
  const raw = {};
  for (const x of TEMPLATES) {
    const base = rate(I.get(`base:${x.id}`), 0);
    raw[x.id] = {};
    for (const y of TEMPLATES) raw[x.id][y.id] = rate(I.get(`int:${x.id}:${y.id}`), 0) - base;
  }
  const colMean = {};
  for (const y of TEMPLATES) colMean[y.id] = TEMPLATES.reduce((a, x) => a + raw[x.id][y.id], 0) / TEMPLATES.length;
  for (const x of TEMPLATES) {
    out.interactions[x.id] = {};
    for (const y of TEMPLATES) {
      out.interactions[x.id][y.id] = { delta: +raw[x.id][y.id].toFixed(3), specific: +(raw[x.id][y.id] - colMean[y.id]).toFixed(3) };
    }
  }
  for (const [tag, rs] of D) {
    const [, a, b] = tag.split(':');
    const pa = rate(rs, 0), pb = rate(rs, 1);
    out.duels[`${a}:${b}`] = { a: +pa.toFixed(3), b: +pb.toFixed(3), draws: +(1 - pa - pb).toFixed(3) };
  }
  // Every simulated decision is checked by the engine: illegal decisions and unfinished games must stay at zero.
  const all = [...cr, ...ir, ...dr];
  out.checks = { games: all.length, illegal: all.reduce((n, r) => n + r.illegal, 0), unfinished: all.filter((r) => !r.over).length };
  out.seconds = Math.round((Date.now() - t0) / 1000);
  return out;
}

export function writeStats(stats, file = path.join(HERE, 'botstats.js')) {
  const head = '// durak/botstats.js - generated by `node durak/sim.js all` (do not edit): difficulty calibration, style profiles,\n' +
    '// interaction matrix and head-to-head results of the bot templates (see README.md for the method).\n\n';
  fs.writeFileSync(file, head + 'export const BOTSTATS = ' + JSON.stringify(stats, null, 1) + ';\n');
}

// --- CLI -------------------------------------------------------------------------------------------------------

const isMain = isMainThread && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
  const cmd = argv[0] || 'bench';
  const workers = +opt('workers', Math.max(1, os.cpus().length - 1));
  if (cmd === 'all') {
    const stats = await runAll({ preset: opt('preset', 'podkidnoy-36'), games: +opt('games', 300), workers });
    writeStats(stats);
    console.log(`written durak/botstats.js in ${stats.seconds}s: ${stats.checks.games} games, ${stats.checks.illegal} illegal decisions, ${stats.checks.unfinished} unfinished`);
  } else if (cmd === 'match') {
    const seats = argv[1].split(',').map((x) => { const [kind, level] = x.split('.'); return { kind, level: +(level || 2) }; });
    const games = +opt('games', 100);
    const jobs = seeds('match', games).map((seed, i) => ({ preset: opt('preset', 'podkidnoy-36'), seats, seed, rotate: i % seats.length }));
    const t0 = Date.now();
    const res = await runJobs(jobs, { workers });
    seats.forEach((x, i) => console.log(`${x.kind}.${x.level}`.padEnd(16), 'durak', (rate(res, i) * 100).toFixed(1) + '%'));
    console.log('draws', res.filter((r) => r.draw).length, 'illegal', res.reduce((a, r) => a + r.illegal, 0), 'unfinished', res.filter((r) => !r.over).length, ((Date.now() - t0) / 1000).toFixed(1) + 's');
  } else if (cmd === 'bench') {
    const rs = normalizeRuleset(presetById(opt('preset', 'podkidnoy-36')));
    for (const t of TEMPLATES) {
      for (const level of [2, 3, 4]) {
        const t0 = performance.now();
        let acts = 0;
        for (let g = 0; g < 4; g++) acts += playGame({ rs, seats: [{ kind: t.id, level }, REF, REF], seed: 'bench' + g }).actions;
        console.log(`${t.id}.${level}`.padEnd(16), ((performance.now() - t0) / 4).toFixed(0) + ' ms/game');
      }
    }
  }
}
