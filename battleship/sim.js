// battleship/sim.js - bot-versus-bot simulations in Node: the difficulty calibration of every personality and level,
// head-to-head results ("who beats whom"), how many shots each shooting method needs against each placement strategy,
// and the style profiles of the personalities (analysis.js features). `node battleship/sim.js all` writes
// battleship/botstats.js; worker threads use every core. Every decision is checked by the engine: the runs count
// illegal decisions and unfinished games (both must stay at zero).
//
//   node battleship/sim.js all [--games N] [--workers K] [--preset id]    everything, writes botstats.js
//   node battleship/sim.js match <kind.level,kind.level> [--games N]       one pairing, win rate per seat kind
//   node battleship/sim.js bench                                           decision time per personality and level
//
//   playGame, searchShots: match.js (re-exported)
//
// Method (README.md): every comparison uses common random numbers — the same seeds (fleets, first shooter) for every
// cell — and alternates the seats, so differences come from the bots, not from the luck of the layouts.

import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeRuleset } from './ruleset.js';
import { presetById } from './presets.js';
import { TEMPLATES, METHODS, PLACEMENTS } from './bots.js';
import { features, mergeCounters, newCounters } from './analysis.js';
import { playGame, searchShots } from './match.js';

//
// Parallelism: the same file is the main program and the worker script (isMainThread distinguishes them). Jobs are
// pure data (preset id, seats, seed) so they cross the thread boundary cheaply, and results depend only on the job,
// never on which worker ran it or in what order: the statistics are reproducible bit for bit.
const HERE = path.dirname(fileURLToPath(import.meta.url));

export { playGame, searchShots };

// --- jobs and workers -------------------------------------------------------------------------------------------------

// A job: { kind: 'game', preset, seats, seed, rotate } | { kind: 'search', preset, strategy, shooter, seed }
// Seat rotation: physical seats are rotated per job and results mapped back to logical seats, so first-move
// advantage is averaged out across the paired games of the same seed (common random numbers + counterbalancing).
function runJob(job) {
  const rs = normalizeRuleset(presetById(job.preset));
  if (job.kind === 'search') {
    const r = searchShots({ rs, strategy: job.strategy, shooter: job.shooter, seed: job.seed });
    return { id: job.id, shots: r.shots, illegal: r.illegal, over: r.over };
  }
  const n = job.seats.length;
  // rotation: physical seat i plays job.seats[(i + rotate) % n]
  const phys = Array.from({ length: n }, (_, i) => job.seats[(i + job.rotate) % n]);
  const g = playGame({ rs, seats: phys, seed: job.seed, record: !!job.record });
  const logical = (i) => (i + job.rotate) % n;
  const r = g.result;
  return {
    id: job.id, draw: !r || r.draw, winners: r ? r.winners.map(logical) : [], shots: g.shots.map((x, i) => [logical(i), x]),
    counters: job.record ? g.counters.map((c, i) => ({ who: logical(i), c })) : null, actions: g.actions, illegal: g.illegal, over: g.over,
  };
}

if (!isMainThread && workerData && workerData.battleshipSim) {
  parentPort.on('message', (msg) => {
    if (msg.jobs) parentPort.postMessage({ results: msg.jobs.map(runJob) });
  });
}

// A pull-based pool: each worker gets a small batch (2 jobs) and asks for more when done, which balances uneven
// job durations (Expert games take far longer than Easy ones) better than a static split.
export async function runJobs(jobs, { workers = Math.max(1, os.cpus().length - 1), progress = null } = {}) {
  if (workers <= 1) return jobs.map((j, i) => { const r = runJob({ ...j, id: i }); if (progress) progress(i + 1, jobs.length); return r; });
  const results = new Array(jobs.length);
  let next = 0, done = 0;
  const batch = 2;
  const pool = [];
  await new Promise((resolve, reject) => {
    const feed = (w) => {
      if (next >= jobs.length) return;
      const chunk = jobs.slice(next, next + batch).map((j, k) => ({ ...j, id: next + k }));
      next += chunk.length;
      w.postMessage({ jobs: chunk });
    };
    for (let i = 0; i < Math.min(workers, jobs.length); i++) {
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: { battleshipSim: true } });
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

// --- experiments ------------------------------------------------------------------------------------------------------

export const REF = { kind: 'hunter', level: 3 }; // the reference: the textbook hunt and target, Hard

// Rating of a win rate p against the reference: Elo-style, equal play = 1500, +400 = ten times the odds.
// Elo logistic mapping: rating difference D gives expected score 1 / (1 + 10^(-D/400)); inverted here. The win rate
// is clamped to 0.5%..99.5% so a perfect record does not map to an infinite rating.
export function ratingOf(p) {
  const q = Math.min(0.995, Math.max(0.005, p));
  return Math.round(1500 + 400 * Math.log10(q / (1 - q)));
}

const seeds = (prefix, k) => Array.from({ length: k }, (_, i) => `${prefix}-${i}`);

// Every personality x level plays the same seed list against one fixed reference (Hard hunter): ratings are on one
// scale. Style counters are recorded only for a subset (Hard, first 80 games): enough for stable ratios, and
// recording costs a Monte-Carlo analysis per decision.
function calibrationJobs(preset, games) {
  const jobs = [];
  for (const t of TEMPLATES) {
    for (const level of [1, 2, 3, 4]) {
      for (const [i, seed] of seeds('cal', games).entries()) jobs.push({ kind: 'game', preset, seats: [{ kind: t.id, level }, REF], seed, rotate: i % 2, tag: `cal:${t.id}:${level}`, record: level === 3 && i < 80 });
    }
  }
  return jobs;
}

function duelJobs(preset, games) {
  const jobs = [];
  for (let a = 0; a < TEMPLATES.length; a++) {
    for (let b = a + 1; b < TEMPLATES.length; b++) {
      for (const [i, seed] of seeds('duel', games).entries()) jobs.push({ kind: 'game', preset, seats: [{ kind: TEMPLATES[a].id, level: 2 }, { kind: TEMPLATES[b].id, level: 2 }], seed, rotate: i % 2, tag: `duel:${TEMPLATES[a].id}:${TEMPLATES[b].id}` });
    }
  }
  return jobs;
}

// Solo searches isolate shooting skill from placement: shots to clear one fleet per (placement strategy, method).
function searchJobs(preset, boards) {
  const jobs = [];
  for (const strategy of PLACEMENTS) {
    for (const method of METHODS) {
      for (const seed of seeds('search', boards)) jobs.push({ kind: 'search', preset, strategy, shooter: { kind: 'custom', level: 3, options: { method, traits: { discipline: 1, chaos: 0, curiosity: method === 'information' ? 0.85 : 0.1, edgeBias: 0.5 } } }, seed, tag: `search:${strategy}:${method}` });
    }
  }
  return jobs;
}

const winRate = (rs, who = 0) => {
  let w = 0, n = 0;
  for (const r of rs) { n++; if (!r.draw && r.winners.includes(who)) w++; }
  return n ? w / n : 0;
};

export async function runAll({ preset = 'classic', games = 300, workers, log = console.log } = {}) {
  const t0 = Date.now();
  const tick = (label) => { let last = 0; return (d, n) => { const now = Date.now(); if (now - last > 5000 || d === n) { last = now; log(`  ${label} ${d}/${n} ${((now - t0) / 1000).toFixed(0)}s`); } }; };
  log(`calibration (${preset}, ${games} games per personality and level, against ${REF.kind}.${REF.level})`);
  const cj = calibrationJobs(preset, games);
  const cr = await runJobs(cj, { workers, progress: tick('calibration') });
  const dGames = Math.round(games * 0.6);
  log(`duels (${dGames} games per pair)`);
  const dj = duelJobs(preset, dGames);
  const dr = await runJobs(dj, { workers, progress: tick('duels') });
  const boards = Math.round(games * 0.4);
  log(`searches (${boards} fleets per placement strategy and shooting method)`);
  const sj = searchJobs(preset, boards);
  const sr = await runJobs(sj, { workers, progress: tick('searches') });

  const by = (jobs, res) => { const m = new Map(); jobs.forEach((j, i) => { if (!m.has(j.tag)) m.set(j.tag, []); m.get(j.tag).push(res[i]); }); return m; };
  const C = by(cj, cr), D = by(dj, dr), S = by(sj, sr);
  const out = { preset, games, generated: new Date().toISOString().slice(0, 10), reference: `${REF.kind}.${REF.level}`, templates: {}, duels: {}, searches: {} };
  for (const t of TEMPLATES) {
    const levels = {};
    let counters = newCounters();
    for (const level of [1, 2, 3, 4]) {
      const rs = C.get(`cal:${t.id}:${level}`);
      const p = winRate(rs, 0);
      let shots = 0, n = 0;
      for (const r of rs) for (const [who, x] of r.shots) if (who === 0 && r.winners.includes(0)) { shots += x; n++; }
      levels[level] = { win: +p.toFixed(3), rating: ratingOf(p), shots: n ? +(shots / n).toFixed(1) : null };
      if (level === 3) for (const r of rs) for (const x of r.counters || []) if (x.who === 0) counters = mergeCounters(counters, x.c);
    }
    const f = features(counters);
    for (const k of Object.keys(f)) if (f[k] != null) f[k] = +f[k].toFixed(3);
    out.templates[t.id] = { levels, style: f };
  }
  for (const [tag, rs] of D) {
    const [, a, b] = tag.split(':');
    const pa = winRate(rs, 0), pb = winRate(rs, 1);
    out.duels[`${a}:${b}`] = { a: +pa.toFixed(3), b: +pb.toFixed(3) };
  }
  for (const [tag, rs] of S) {
    const [, strategy, method] = tag.split(':');
    const xs = rs.map((r) => r.shots).sort((p, q) => p - q);
    const mean = xs.reduce((a, x) => a + x, 0) / Math.max(1, xs.length);
    (out.searches[strategy] ||= {})[method] = { mean: +mean.toFixed(1), median: xs[xs.length >> 1] };
  }
  const all = [...cr, ...dr];
  out.checks = {
    games: all.length, searches: sr.length,
    illegal: all.reduce((n, r) => n + r.illegal, 0) + sr.reduce((n, r) => n + r.illegal, 0),
    unfinished: all.filter((r) => !r.over).length + sr.filter((r) => !r.over).length,
  };
  out.seconds = Math.round((Date.now() - t0) / 1000);
  return out;
}

// The generated file is a JS module (not JSON) so the browser bundle can import it statically like any code.
export function writeStats(stats, file = path.join(HERE, 'botstats.js')) {
  const head = '// battleship/botstats.js - generated by `node battleship/sim.js all` (do not edit): difficulty calibration, style\n' +
    '// profiles, head-to-head results of the bot personalities and the shots each method needs against each placement\n// strategy (see README.md for the method).\n\n';
  fs.writeFileSync(file, head + 'export const BOTSTATS = ' + JSON.stringify(stats, null, 1) + ';\n');
}

// The README table of the results (between the botstats markers).
export function statsMarkdown(st) {
  const L = ['Easy', 'Normal', 'Hard', 'Expert'];
  const out = [];
  out.push(`${st.generated}, ${st.preset}, ${st.games} games per personality and level against ${st.reference} (two players, seats alternating, the same fleets for every cell); rating (win rate, mean shots of the won games):`, '');
  out.push('| personality | ' + L.join(' | ') + ' |', '| --- |' + L.map(() => ' --- |').join(''));
  for (const [id, x] of Object.entries(st.templates)) out.push(`| ${id} | ` + [1, 2, 3, 4].map((l) => `${x.levels[l].rating} (${Math.round(x.levels[l].win * 100)} %, ${x.levels[l].shots ?? '—'})`).join(' | ') + ' |');
  out.push('', 'Who beats whom (Normal, head to head): the win rate of the row against the column.', '');
  const ids = Object.keys(st.templates);
  out.push('| | ' + ids.join(' | ') + ' |', '| --- |' + ids.map(() => ' --- |').join(''));
  for (const a of ids) {
    out.push(`| ${a} | ` + ids.map((b) => {
      if (a === b) return '—';
      const d = st.duels[`${a}:${b}`] || null, e = st.duels[`${b}:${a}`] || null;
      const v = d ? d.a : e ? e.b : null;
      return v == null ? '' : Math.round(v * 100) + ' %';
    }).join(' | ') + ' |');
  }
  const methods = Object.keys(Object.values(st.searches)[0] || {});
  out.push('', 'Mean shots to sink a whole fleet: placement strategy (rows) against shooting method (columns, Hard).', '');
  out.push('| placement | ' + methods.join(' | ') + ' |', '| --- |' + methods.map(() => ' --- |').join(''));
  for (const [sname, row] of Object.entries(st.searches)) out.push(`| ${sname} | ` + methods.map((m) => row[m].mean).join(' | ') + ' |');
  out.push('', `The run played ${st.checks.games} games and ${st.checks.searches} searches: ${st.checks.illegal} illegal decisions, ${st.checks.unfinished} unfinished.`);
  return out.join('\n');
}

// --- CLI --------------------------------------------------------------------------------------------------------------

const isMain = isMainThread && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
  const cmd = argv[0] || 'bench';
  const workers = +opt('workers', Math.max(1, os.cpus().length - 1));
  if (cmd === 'all') {
    const stats = await runAll({ preset: opt('preset', 'classic'), games: +opt('games', 300), workers });
    writeStats(stats);
    // the README section between the markers
    const readme = path.join(HERE, 'README.md');
    if (fs.existsSync(readme)) {
      const txt = fs.readFileSync(readme, 'utf8');
      const re = /<!-- botstats -->[\s\S]*?<!-- \/botstats -->/;
      // Replacement via a function: a string replacement would interpret "$" sequences in the generated table.
      if (re.test(txt)) fs.writeFileSync(readme, txt.replace(re, () => `<!-- botstats -->\n${statsMarkdown(stats)}\n<!-- /botstats -->`));
    }
    console.log(`written battleship/botstats.js in ${stats.seconds}s: ${stats.checks.games} games, ${stats.checks.searches} searches, ${stats.checks.illegal} illegal decisions, ${stats.checks.unfinished} unfinished`);
  } else if (cmd === 'match') {
    const seats = argv[1].split(',').map((x) => { const [kind, level] = x.split('.'); return { kind, level: +(level || 2) }; });
    const games = +opt('games', 100);
    const jobs = seeds('match', games).map((seed, i) => ({ kind: 'game', preset: opt('preset', 'classic'), seats, seed, rotate: i % seats.length }));
    const t0 = Date.now();
    const res = await runJobs(jobs, { workers });
    seats.forEach((x, i) => console.log(`${x.kind}.${x.level}`.padEnd(18), 'wins', (winRate(res, i) * 100).toFixed(1) + '%'));
    console.log('illegal', res.reduce((a, r) => a + r.illegal, 0), 'unfinished', res.filter((r) => !r.over).length, ((Date.now() - t0) / 1000).toFixed(1) + 's');
  } else if (cmd === 'bench') {
    const rs = normalizeRuleset(presetById(opt('preset', 'classic')));
    for (const t of TEMPLATES) {
      for (const level of [2, 3, 4]) {
        const t0 = performance.now();
        let acts = 0;
        for (let g = 0; g < 3; g++) acts += playGame({ rs, seats: [{ kind: t.id, level }, REF], seed: 'bench' + g }).actions;
        console.log(`${t.id}.${level}`.padEnd(18), ((performance.now() - t0) / 3).toFixed(0) + ' ms/game', (acts / 3).toFixed(0) + ' actions');
      }
    }
  }
}
