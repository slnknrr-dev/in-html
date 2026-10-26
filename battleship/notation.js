// battleship/notation.js - SBN (Sea Battle Notation): a game as one line of text that can be copied, pasted, shared as a
// link and replayed shot by shot — the ruleset, the players, who fired first, every shot with its answer, and the fleets
// when they are known (they are shown at the end of a game), plus the seed of a seeded game. With the fleets the replay
// runs the real engine and checks every answer; without them it rebuilds what everybody saw.
//
//   SBN1;r=<id>@<hash>;n=<players>;p=<names>;f=<first>;m=<moves>[;F=<fleets>][;s=seed:<seed>][;R=<ruleset>][;x=<result>][;g=<date>]
//
//   r  ruleset id and hash; R the ruleset itself (deflate + base64url JSON) for own rulesets
//   p  names separated by ',' (URI-encoded); a bot is name~kind.level
//   f  the seat that fired first
//   m  moves separated by spaces:  <seat>[><target]:<cell><answer>[,<cell><answer>…]   a shot, a salvo or a volley
//                                  <seat>[><target]R<cell>=<count>                      a radar scan
//                                  <seat>[><target]A<cell><h|v>:<answers>  ·  C<cell>:<answers>   air strike, cluster
//                                  <seat>Q                                               resigned
//      seats and targets in base 36 (the target is left out with two players); cells as 'e5'; answers: '.' miss,
//      'x' hit, '#<type>' sunk (with ships that may touch and shown sinkings, the cells follow in parentheses), '*' a
//      mine followed by the answer of the cell it struck back at ('-' when it was already known)
//   F  the fleets, one layout per seat (placement.js encodeLayout) separated by '/'
//   x  result: W<winners joined by '.'> or '=' for a draw
//
//   encode(state | view, { names, bots, seed, fleets: true | false, embed, date }) -> text
//   parse(text) -> { ok, error?, rulesetRef, rs?, n, names, bots, first, moves: [token], fleets, seed, result, date }
//   replay(parsed, { extra: [raw rulesets] }) -> { ok, error?, rs, n, log, frames: [{ token, upto, seat, target }],
//                                                  fleets: [layout] | null, full, result }
//   decisions(log) -> [{ i, kind, seat, target, shots: [log index] }]     the actions of a public log
//   analysisSteps(rs, log, { samples, seed, n }) -> generator (progress) whose value is the analysis; analyze() runs it:
//     { shots: [{ i, seat, target, kind, cell, p, best, bits, info, hit }], boards: [{ series: [{ i, h }], start, end,
//       prior }], seats: [{ luck, skill, bits, shots, hits }] }
//   startEntropy(rs) -> log2 of the fleets a board can hide at the start;  packRuleset(rs) / unpackRuleset(text)
//
// Information (bits): the answer to a shot is a surprise of -log2 P(answer) bits, where P is the share of all fleets
// consistent with everything known before the shot that give this answer (solver.js: exact enumeration when small,
// Monte-Carlo samples otherwise). By the chain rule these bits add up along a board to log2 of the number of fleets the
// board could hide at the start: the entropy of the remaining consistent placements falls by exactly the information
// of each answer. Luck is the hits above what the chances promised (Σ hit − P(hit)); skill is how close the chosen
// cells came to the best chance available (mean of P(chosen) / max P).

import { normalizeRuleset, cellName, parseCell } from './ruleset.js';
import { PRESETS } from './presets.js';
import { geometry, haloOf } from './board.js';
import { newGame, applyInPlace, weaponCells } from './engine.js';
import { encodeLayout, decodeLayout, validateLayout } from './placement.js';
import { knowledgeAt } from './knowledge.js';
import { sample, answerProb, expectedInfo, estimateLog2 } from './solver.js';
import { deflateRawSync, inflateRawSync } from '../codec/zlib.js';
import { base64ToBytes, bytesToBase64Url, bytesToUtf8, utf8ToBytes } from '../crypto/encoding.js';
import { seededRandom } from '../prng/prng.js';

//
// Format design (like PGN for chess, but one line): ';'-separated key=value fields, so unknown future fields are
// skipped by old parsers; a version tag (SBN1) for incompatible changes. Base 36 for seats and types and 'e5' cell
// names keep it short and readable. Moves carry their answers, so a record without fleets still replays the public
// course; with fleets, replay re-runs the engine and verifies every answer (a forged record is rejected).
// encName escapes '~' too, because '~' separates a name from its bot tag.
export const TAG = 'SBN1';
const b36 = (n) => n.toString(36);
const encName = (s) => encodeURIComponent(String(s ?? '')).replace(/~/g, '%7E');

// The ruleset as it travels in records and share codes (game content, names and descriptions; no looks).
// Embedded ruleset: only the source fields (normalisation is re-run on load), deflated and base64url-encoded so
// it fits in a URL. Looks/skins are dropped: they do not affect the game and would bloat links.
export function rulesetSource(rs) {
  return { id: rs.id, name: rs.name, description: rs.description, author: rs.author, tags: rs.tags, exclusive: rs.exclusive, board: rs.board, shapes: rs.shapes.map((s) => ({ id: s.id, name: s.name, cells: s.cells, rotate: s.rotate, mirror: s.mirror })), fleet: rs.fleet, rules: rs.rules, weapons: rs.weapons };
}
export function packRuleset(rs) {
  return bytesToBase64Url(deflateRawSync(utf8ToBytes(JSON.stringify(rulesetSource(rs))), { level: 9 }));
}
export function unpackRuleset(text) {
  return JSON.parse(bytesToUtf8(inflateRawSync(base64ToBytes(text))));
}

// --- encoding -------------------------------------------------------------------------------------------------------------

// Sunk cells are written only when they cannot be inferred: with touch 'any' adjacent ships make the 4-connected
// component of hits ambiguous; otherwise replay recovers them with component().
const ansText = (rs, e) => {
  const a = e[4];
  if (a === 0) return '.';
  if (a === 1) return 'x';
  if (a === 3) return '*';
  let s = '#' + b36(e[5] ?? 0);
  if (rs.rules.announce === 'ship' && rs.rules.touch === 'any' && e[6]) s += '(' + e[6].map((c) => cellName(rs, c)).join('.') + ')';
  return s;
};

// The decisions of a public log: [{ i (index of the marker), kind: 'fire' | 'radar' | 'airstrike' | 'cluster' |
// 'resign', seat, target, shots: [log index of each 'S' entry] }]. A decision runs from its marker ('F', 'R', 'A',
// 'C', 'Q') to the next one; mine strike-backs, halos and lost fleets in between belong to it.
// Groups the flat log into actions. 'T', 'E', 'P' close the current action so stray 'S' entries (none in practice)
// are not attributed to a previous one; 'K' strike-backs stay with the shot that triggered them.
export function decisions(log) {
  const out = [];
  let cur = null;
  log.forEach((e, i) => {
    const k = e[0];
    if (k === 'F' || k === 'R' || k === 'A' || k === 'C' || k === 'Q') {
      cur = { i, kind: { F: 'fire', R: 'radar', A: 'airstrike', C: 'cluster', Q: 'resign' }[k], seat: e[1], target: k === 'Q' ? -1 : e[2], shots: [] };
      out.push(cur);
    } else if (k === 'T' || k === 'E' || k === 'P') cur = null;
    else if (k === 'S' && cur && e[1] === cur.seat && e[2] === cur.target) cur.shots.push(i);
  });
  return out;
}

// Move tokens from a public log.
export function moveTokens(rs, log, n) {
  const tgt = (t) => (n > 2 ? '>' + b36(t) : '');
  const shotText = (k) => {
    const s = log[k];
    let txt = cellName(rs, s[3]) + ansText(rs, s);
    if (s[4] === 3) {
      const back = log.slice(k + 1, k + 3).find((x) => x[0] === 'K' && x[3] === s[3]);
      txt += back ? ansText(rs, back) : '-';
    }
    return txt;
  };
  return decisions(log).map((d) => {
    const e = log[d.i];
    const head = b36(d.seat) + (d.kind === 'resign' ? '' : tgt(d.target));
    if (d.kind === 'resign') return head + 'Q';
    if (d.kind === 'radar') return head + 'R' + cellName(rs, e[3]) + '=' + e[4];
    const body = d.shots.map(shotText).join(',');
    if (d.kind === 'airstrike') return head + 'A' + cellName(rs, e[3]) + e[4] + ':' + body;
    if (d.kind === 'cluster') return head + 'C' + cellName(rs, e[3]) + ':' + body;
    return head + ':' + body;
  });
}

/**
 * One line of SBN. g: an engine state (fleets known), or a view (fleets known at the end). opts: { names: [string],
 * bots: [null | 'kind.level'], seed, fleets (default: when known), embed (default: when not a built-in preset), date }
 */
export function encode(g, opts = {}) {
  const rs = g.rs;
  const f = [TAG, `r=${rs.id}@${rs.hash}`, `n=${g.n}`];
  const names = opts.names || g.names || [];
  const bots = opts.bots || [];
  if (names.some(Boolean) || bots.some(Boolean)) f.push('p=' + Array.from({ length: g.n }, (_, i) => encName(names[i] || '') + (bots[i] ? '~' + bots[i] : '')).join(','));
  f.push('f=' + b36(g.first | 0));
  f.push('m=' + moveTokens(rs, g.log, g.n).join(' '));
  const boards = g.boards || [];
  const known = boards.length === g.n && boards.every((b) => b.ships);
  if (opts.fleets !== false && known) f.push('F=' + boards.map((b) => encodeLayout(rs, { ships: b.ships, mines: b.mines || [] })).join('/'));
  const seed = opts.seed ?? g.seed ?? null;
  if (seed) f.push('s=seed:' + encodeURIComponent(seed));
  const builtin = PRESETS.some((p) => p.id === rs.id && normalizeRuleset(p).hash === rs.hash);
  if (opts.embed ?? !builtin) f.push('R=' + packRuleset(rs));
  if (opts.date) f.push('g=' + encodeURIComponent(opts.date));
  const res = g.result || null;
  if (res) f.push('x=' + (res.draw ? '=' : 'W' + res.winners.map(b36).join('.')));
  return f.join(';');
}

// --- parsing ----------------------------------------------------------------------------------------------------------------

// One regex per move token: groups 3 (shots), 4-5 (radar), 6-8 (air strike), 9-10 (cluster), 11 (resign).
// BODY validates the shot list strictly before replay, so replay can index the regex groups without re-checking.
const TOKEN = /^([0-9a-z])(?:>([0-9a-z]))?(?::(.*)|R([a-z]\d{1,2})=(\d+)|A([a-z]\d{1,2})([hv]):(.*)|C([a-z]\d{1,2}):(.*)|(Q))$/;
// the answers of a shot list: cells with '.', 'x', '#<type>[(cells)]' or '*' followed by the answer it struck back with
const ANS = '(?:\\.|x|#[0-9a-z](?:\\([a-z0-9.]+\\))?)';
const BODY = new RegExp(`^(?:[a-z]\\d{1,2}(?:${ANS}|\\*(?:${ANS}|-|\\*))(?:,(?=.)|$))+$`);

// Parsing is syntax only; semantic checks (legal moves, answers matching fleets) happen in replay.
// Newlines are folded to spaces so a record pasted with line wraps still parses.
export function parse(text) {
  const src = String(text || '').trim().replace(/\s*\n\s*/g, ' ');
  const fail = (error) => ({ ok: false, error });
  if (!src.startsWith(TAG + ';')) return fail('not an SBN1 record');
  const fields = {};
  for (const part of src.split(';').slice(1)) {
    const k = part.indexOf('=');
    if (k < 1) continue;
    fields[part.slice(0, k)] = part.slice(k + 1);
  }
  const m = /^([A-Za-z0-9_.-]+)@([0-9a-f]{8})$/.exec(fields.r || '');
  if (!m) return fail('missing ruleset (r=)');
  const n = parseInt(fields.n, 10);
  if (!(n >= 2 && n <= 6)) return fail('bad number of players (n=)');
  let rs = null;
  // The embedded ruleset passes through normalizeRuleset (bounds and enums clamped). Note the idempotence shortcut
  // in ruleset.js: an embedded object that already claims to be normalised skips the clamps (see the KNOWN DEFECT
  // there), which matters when records come from untrusted links.
  if (fields.R) {
    try { rs = normalizeRuleset(unpackRuleset(fields.R)); } catch { return fail('the embedded ruleset (R=) is damaged'); }
  }
  const names = [], bots = [];
  if (fields.p) {
    fields.p.split(',').forEach((x, i) => {
      const [nm, bot] = x.split('~');
      try { names[i] = decodeURIComponent(nm || ''); } catch { names[i] = nm; }
      bots[i] = bot || null;
    });
  }
  const moves = (fields.m || '').split(/\s+/).filter(Boolean);
  for (const t of moves) {
    const mm = TOKEN.exec(t);
    const body = mm && (mm[3] ?? mm[8] ?? mm[10]);
    if (!mm || (body != null && !BODY.test(body))) return fail(`bad move "${t}"`);
  }
  let seed = null;
  if (fields.s && fields.s.startsWith('seed:')) { try { seed = decodeURIComponent(fields.s.slice(5)); } catch { seed = fields.s.slice(5); } }
  let result = null;
  if (fields.x) {
    if (fields.x === '=') result = { draw: true, winners: [] };
    else if (/^W[0-9a-z](\.[0-9a-z])*$/.test(fields.x)) result = { draw: false, winners: fields.x.slice(1).split('.').map((v) => parseInt(v, 36)) };
  }
  let date = null;
  if (fields.g) { try { date = decodeURIComponent(fields.g); } catch { date = fields.g; } }
  return {
    ok: true, rulesetRef: { id: m[1], hash: m[2] }, rs, n, names, bots, first: fields.f ? parseInt(fields.f, 36) : 0,
    moves, fleets: fields.F ? fields.F.split('/') : null, seed, result, date,
  };
}

// The ruleset of a record: embedded, a preset, or one of `extra` (own rulesets) with the same hash.
// Matched by hash, not id: a preset id with a different hash is a different game (an older version of the preset
// or a renamed custom ruleset), and replaying it under the wrong rules would mis-verify answers.
export function resolveRuleset(parsed, extra = []) {
  if (parsed.rs) return parsed.rs;
  for (const raw of [...PRESETS, ...extra]) {
    try { const rs = normalizeRuleset(raw); if (rs.hash === parsed.rulesetRef.hash) return rs; } catch { /* skip */ }
  }
  return null;
}

// --- replay -----------------------------------------------------------------------------------------------------------------

// Answer text -> { ans, t, cells, mineBack }
function readAnswer(rs, s) {
  let i = 0;
  const one = () => {
    const ch = s[i++];
    if (ch === '.') return { ans: 0 };
    if (ch === 'x') return { ans: 1 };
    if (ch === '-') return { ans: -1 };
    if (ch === '*') return { ans: 3 };
    if (ch === '#') {
      // the type: one base-36 digit
      const t = parseInt(s[i], 36); i++;
      if (!(t >= 0)) throw new Error('bad answer');
      let cells = null;
      if (s[i] === '(') { const k = s.indexOf(')', i); cells = s.slice(i + 1, k).split('.').map((x) => parseCell(rs, x)); i = k + 1; }
      return { ans: 2, t, cells };
    }
    throw new Error('bad answer');
  };
  const a = one();
  if (a.ans === 3) a.back = one();
  if (i !== s.length) throw new Error('bad answer');
  return a;
}

function readShots(rs, body) {
  return body.split(',').filter(Boolean).map((p) => {
    const m = /^([a-z]\d{1,2})(.+)$/.exec(p);
    if (!m) throw new Error('bad shot');
    const cell = parseCell(rs, m[1]);
    if (cell < 0) throw new Error('bad cell ' + m[1]);
    return { cell, ...readAnswer(rs, m[2]) };
  });
}

// Two modes. With valid fleets: the real engine plays every move and each recorded answer must equal the engine's
// (integrity check). Without fleets: the public log is rebuilt from the recorded answers alone (marks, halos,
// eliminations), enough for viewing and for the information analysis, which only uses public knowledge.
export function replay(parsed, { extra = [] } = {}) {
  const rs = resolveRuleset(parsed, extra);
  if (!rs) return { ok: false, error: 'unknown ruleset ' + parsed.rulesetRef.id + '@' + parsed.rulesetRef.hash, frames: [] };
  const n = parsed.n;
  const target = (m2) => (m2 != null ? parseInt(m2, 36) : null);
  let fleets = null;
  if (parsed.fleets && parsed.fleets.length === n) {
    fleets = parsed.fleets.map((t) => decodeLayout(rs, t));
    if (!fleets.every((l) => validateLayout(rs, l).ok)) fleets = null;
  }
  const frames = [{ token: null, upto: 0, seat: -1, target: -1 }];
  if (fleets) {
    // the real game: the engine checks every answer
    const s = newGame(rs, { players: n, first: parsed.first });
    for (let i = 0; i < n; i++) { const e = applyInPlace(s, i, { type: 'place', ships: fleets[i].ships, mines: fleets[i].mines }); if (e) return { ok: false, error: 'bad fleet: ' + e, frames: [] }; }
    frames[0].upto = s.log.length;
    for (const tok of parsed.moves) {
      const m = TOKEN.exec(tok);
      const seat = parseInt(m[1], 36);
      const tg = target(m[2]) ?? (n === 2 ? 1 - seat : -1);
      let action, shots = null;
      try {
        if (m[11]) action = { type: 'resign' };
        else if (m[3] != null) { shots = readShots(rs, m[3]); action = { type: 'fire', target: tg, cells: shots.map((x) => x.cell) }; }
        else if (m[4]) action = { type: 'radar', target: tg, cell: parseCell(rs, m[4]) };
        else if (m[6]) { shots = readShots(rs, m[8]); action = { type: 'airstrike', target: tg, cell: parseCell(rs, m[6]), dir: m[7] }; }
        else if (m[9]) { shots = readShots(rs, m[10]); action = { type: 'cluster', target: tg, cell: parseCell(rs, m[9]) }; }
      } catch (e) { return fail(e.message); }
      const before = s.log.length;
      const err = applyInPlace(s, seat, action);
      if (err) return fail(`move "${tok}": ${err}`);
      // the answers of the record must be the engine's
      const got = s.log.slice(before).filter((e) => e[0] === 'S');
      if (shots && (got.length !== shots.length || got.some((e, k) => e[3] !== shots[k].cell || e[4] !== shots[k].ans))) return fail(`move "${tok}": the answers differ from the fleets`);
      if (m[4] && s.log[before] && s.log[before][4] !== +m[5]) return fail(`move "${tok}": the radar count differs from the fleets`);
      frames.push({ token: tok, upto: s.log.length, seat, target: tg });
    }
    return { ok: true, rs, n, log: s.log, frames, fleets, full: true, result: s.result || parsed.result, state: s };
    // Hoisted function declaration inside the block: it closes over s, frames and fleets of this branch.
    function fail(error) { return { ok: false, error, rs, n, log: s.log, frames, fleets, full: true, result: parsed.result, at: frames.length }; }
  }
  // the public course only: rebuild the public log from the answers
  const G = geometry(rs);
  const log = [];
  const marks = Array.from({ length: n }, () => new Array(G.N).fill(0));
  const sunkCount = new Array(n).fill(0);
  const out = new Set();
  const applyShot = (op, by, tg, x) => {
    if (x.ans === -1) return;
    const e = [op, by, tg, x.cell, x.ans];
    if (x.ans === 0) marks[tg][x.cell] = 1;
    else if (x.ans === 3) marks[tg][x.cell] = 5;
    else {
      marks[tg][x.cell] = 2;
      if (x.ans === 2) {
        e.push(x.t);
        if (rs.rules.announce === 'ship') {
          const cells = x.cells || component(G, marks[tg], x.cell);
          e.push(cells);
          for (const c of cells) marks[tg][c] = 3;
        }
      }
    }
    log.push(e);
    if (x.ans === 2) {
      sunkCount[tg]++;
      if (rs.rules.announce === 'ship' && rs.rules.halo && rs.rules.touch !== 'any') {
        const halo = haloOf(G, e[6]).filter((c) => marks[tg][c] === 0 && !G.obstacle[c]);
        if (halo.length) { for (const c of halo) marks[tg][c] = 4; log.push(['H', tg, halo]); }
      }
      if (rs.rules.announce !== 'hit' && sunkCount[tg] === rs.ships.length && !out.has(tg)) { out.add(tg); log.push(['O', tg]); }
    }
  };
  try {
    for (const tok of parsed.moves) {
      const m = TOKEN.exec(tok);
      const seat = parseInt(m[1], 36);
      const tg = target(m[2]) ?? (n === 2 ? 1 - seat : -1);
      if (m[11]) { log.push(['Q', seat]); if (!out.has(seat)) { out.add(seat); log.push(['O', seat]); } }
      else if (m[4]) log.push(['R', seat, tg, parseCell(rs, m[4]), +m[5]]);
      else {
        if (m[6]) log.push(['A', seat, tg, parseCell(rs, m[6]), m[7]]);
        if (m[9]) log.push(['C', seat, tg, parseCell(rs, m[9])]);
        const list = readShots(rs, m[3] ?? m[8] ?? m[10]);
        if (m[3] != null) log.push(['F', seat, tg, list.length]);
        for (const x of list) {
          applyShot('S', seat, tg, x);
          if (x.ans === 3 && x.back) applyShot('K', tg, seat, { cell: x.cell, ...x.back });
        }
      }
      frames.push({ token: tok, upto: log.length, seat, target: tg });
    }
  } catch (e) {
    return { ok: false, error: e.message, rs, n, log, frames, fleets: null, full: false, result: parsed.result };
  }
  return { ok: true, rs, n, log, frames, fleets: null, full: false, result: parsed.result };
}

// The 4-connected hit cells around c (a shown sunk ship when ships cannot touch by their sides).
// BFS over side neighbours among hit cells: with touch 'none' or 'corners' two ships never share a side, so the
// component of the sinking cell is exactly the sunk ship.
function component(G, marks, c) {
  const out = [c], seen = new Set([c]);
  for (let k = 0; k < out.length; k++) for (const d of G.n4[out[k]]) if (!seen.has(d) && marks[d] === 2) { seen.add(d); out.push(d); }
  return out.sort((a, b) => a - b);
}

// --- information analysis ---------------------------------------------------------------------------------------------------

const START = new Map();

// log2 of the number of fleets a board can hide at the start (Knuth's estimate with a fixed seed; cached).
// Fixed seed: the same prior entropy on every device for the same ruleset, so analysis charts are comparable.
export function startEntropy(rs) {
  if (START.has(rs.hash)) return START.get(rs.hash);
  const K = knowledgeAt(rs, [], 0, 0);
  const r = estimateLog2(K, seededRandom('start/' + rs.hash), 3000, 20000);
  const v = Number.isFinite(r.log2) ? r.log2 : 0;
  START.set(rs.hash, v);
  return v;
}

/**
 * The information of every decision of a public log, step by step (a generator: the application runs it in chunks and
 * shows progress; analyze() runs it to the end). Each step yields { done, total }; the final value is
 * { shots: [{ i, seat, target, kind, cell, p, best, bits, info, hit }], boards: [{ series: [{ i, h }], start, end,
 * prior }], seats: [{ luck, skill, bits, shots, hits }] } where p is the chance of a hit at the chosen cell when the
 * decision was made, best the best chance available, bits the information of the answer, info its expected value.
 */
// A generator so the UI can run the (seconds-long) analysis in slices between frames and show progress, without a
// Worker. Per decision: sample the posterior at that moment, then score the answers.
// Bits use the chain rule of entropy: sum of surprisals along a board + remaining entropy at the end = entropy at
// the start (up to sampling error), which the per-board series displays as a falling curve.
// A mine answer counts as a miss for information (a mine lies in water; the shooter learns "no ship here").
// Seeds derive from the log index, so re-running the analysis gives identical numbers.
export function* analysisSteps(rs, log, { samples: samplesWanted = 400, seed = 'analysis', n = 2 } = {}) {
  // big seas: fewer samples (the work of a sweep grows with ships × placements)
  const G0 = geometry(rs);
  const work = G0.ships.reduce((a, t) => a + G0.types[t].P, 0);
  const samples = Math.max(60, Math.min(samplesWanted, Math.round(samplesWanted * 1600 / Math.max(1600, work))));
  const shots = [];
  const per = Array.from({ length: n }, () => ({ luck: 0, skill: 0, skillN: 0, bits: 0, shots: 0, hits: 0 }));
  const boardBits = Array.from({ length: n }, () => []);
  const rngOf = (k) => seededRandom(seed + '/' + rs.hash + '/' + k);
  const list = decisions(log).filter((d) => d.kind !== 'resign' && d.target >= 0 && d.target < n);
  for (let di = 0; di < list.length; di++) {
    const d = list[di];
    const { seat, target } = d;
    // the knowledge when the decision was made
    const K0 = knowledgeAt(rs, log, target, d.i);
    const st0 = sample(K0, rngOf(d.i), { samples, chains: 4, burn: 6, keep: d.kind === 'radar' ? Math.min(samples, 400) : 0 });
    const pOf = (c) => (st0.n ? st0.occ[c] / st0.n : 0);
    let best = 0;
    for (let c = 0; c < K0.N; c++) if (!K0.water[c] && !K0.hit[c] && !K0.G.obstacle[c]) best = Math.max(best, pOf(c));
    if (d.kind === 'radar') {
      const e = log[d.i];
      const cells = weaponCells(rs, 'radar', e[3]);
      let q = 0;
      if (st0.configs && st0.configs.length) {
        let same = 0;
        for (const pos of st0.configs) { const occ = configOcc(K0, pos); let cnt = 0; for (const c of cells) cnt += occ[c]; if (cnt === e[4]) same++; }
        q = same / st0.configs.length;
      }
      const bits = q > 0 ? -Math.log2(q) : 0;
      shots.push({ i: d.i, seat, target, kind: 'radar', cell: e[3], p: null, best, bits, info: null, hit: 0 });
      per[seat].bits += bits;
      boardBits[target].push({ i: d.i, bits });
      yield { done: di + 1, total: list.length };
      continue;
    }
    let hits = 0, pSum = 0;
    d.shots.forEach((k, j) => {
      const x = log[k];
      // the answers of a short salvo arrive one by one: each cell against the knowledge after the previous ones; long
      // volleys use the samples of the decision for every cell (the correlation between their answers is ignored)
      const seq = j > 0 && d.shots.length <= 3;
      const K = seq ? knowledgeAt(rs, log, target, k) : K0;
      const st = seq ? sample(K, rngOf(k), { samples, chains: 4, burn: 6 }) : st0;
      const ans = x[4] === 3 ? 0 : x[4] === 2 && rs.rules.announce === 'hit' ? 1 : x[4];
      const q = st.n ? answerProb(K, st, x[3], ans, x[5] ?? -1) : 0;
      const bits = q > 0 ? -Math.log2(q) : 0;
      const info = st.n ? expectedInfo(K, st, x[3]) : 0;
      const hit = x[4] === 1 || x[4] === 2 ? 1 : 0;
      hits += hit;
      pSum += pOf(x[3]);
      per[seat].bits += bits;
      boardBits[target].push({ i: k, bits });
      shots.push({ i: k, seat, target, kind: d.kind === 'fire' ? 'shot' : d.kind, cell: x[3], p: pOf(x[3]), best, bits, info, hit });
    });
    per[seat].shots += d.shots.length;
    per[seat].hits += hits;
    per[seat].luck += hits - pSum;
    if (best > 0 && d.shots.length) { per[seat].skill += Math.min(1, pSum / d.shots.length / best); per[seat].skillN++; }
    yield { done: di + 1, total: list.length };
  }
  // Boards whose fleet was destroyed end at 0 bits (everything is known); a resigned board still hides information.
  // remaining entropy per board: what is still hidden at the end plus the bits of every later answer
  const boards = [];
  for (let b = 0; b < n; b++) {
    const lost = log.some((x) => x[0] === 'O' && x[1] === b) && !log.some((x) => x[0] === 'Q' && x[1] === b);
    let end = 0;
    if (!lost) {
      const K = knowledgeAt(rs, log, b, log.length);
      const r = estimateLog2(K, seededRandom('end/' + seed + '/' + b), 600, 40000);
      end = Number.isFinite(r.log2) ? r.log2 : 0;
    }
    const L = boardBits[b];
    const suffix = new Array(L.length + 1).fill(0);
    for (let k = L.length - 1; k >= 0; k--) suffix[k] = suffix[k + 1] + L[k].bits;
    const series = [{ i: 0, h: end + suffix[0] }, ...L.map((x, k) => ({ i: x.i + 1, h: end + suffix[k + 1] }))];
    boards.push({ series, start: end + suffix[0], end, prior: startEntropy(rs) });
  }
  return {
    shots, boards,
    seats: per.map((x) => ({ luck: x.luck, skill: x.skillN ? x.skill / x.skillN : null, bits: x.bits, shots: x.shots, hits: x.hits })),
  };
}

export function analyze(rs, log, opts = {}) {
  const it = analysisSteps(rs, log, opts);
  for (;;) { const r = it.next(); if (r.done) return r.value; }
}

function configOcc(K, pos) {
  const G = K.G;
  const occ = new Uint8Array(G.N);
  for (let i = 0; i < pos.length; i++) { const T = G.types[K.ships[i].t]; for (let k = 0; k < T.size; k++) occ[T.cells[pos[i] * T.size + k]] = 1; }
  return occ;
}

export { cellName };
