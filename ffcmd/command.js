// ffcmd/command.js - commands with references as shell text: the same layout and quoting as cmdline/quote.js
// (commandLine / script), but the result is also split into pieces that remember which element of the edit they
// describe, so a user interface can highlight a part of a command and the element behind it.
//
//   argv items   'word' | number | Graph (one argument, e.g. after -filter_complex) | [items] (a group kept on one
//                line) | ref(r, ...items) (a group that belongs to element r); null / false items are skipped
//   ref(r, ...items)                           a group with a reference
//   renderCommand(argv, shell, { width, batch })   -> { text, pieces: [{ text, ref }] }
//   renderScript(steps, shell, { width, batch })   steps [{ comment, argv, ref }] -> { text, pieces }
//   plainArgv(argv)                            the argv for cmdline's commandLine (strings / arrays)
//
// text is exactly commandLine(plainArgv(argv), shell, options) / script(...): the tests check it.

import { quote } from '../cmdline/quote.js';
import { Graph } from './graph.js';

// Symbol-keyed marker: a ref group can never be confused with a user object or array passed as an argument.
const GROUP = Symbol('group');
export const ref = (r, ...items) => ({ [GROUP]: true, ref: r, items });
const CONT = { bash: ' \\', cmd: ' ^' };
// A private-use character (invisible here) that neither shell's quoting touches. Each filter piece is prefixed with
// MARK + a per-piece private-use index character, the whole graph is quoted once, and the markers are then used to
// cut the quoted text back into pieces. Quoting each piece separately would not produce the same text as quoting
// the whole argument (quotes would open and close per piece).
const MARK = '';

// argv -> [{ ref, words: [word] }]; word: { text, ref } | { graph, ref }
function groups(argv, inherited = null) {
  const out = [];
  for (const a of argv) {
    if (a == null || a === false) continue;
    if (a && a[GROUP]) out.push({ ref: a.ref, words: words(a.items, a.ref) });
    else if (Array.isArray(a)) out.push({ ref: inherited, words: words(a, inherited) });
    else out.push({ ref: inherited, words: words([a], inherited) });
  }
  return out;
}

function words(items, r) {
  const out = [];
  for (const x of items) {
    if (x == null || x === false) continue;
    if (Array.isArray(x)) out.push(...words(x, r));
    else if (x && x[GROUP]) out.push(...words(x.items, x.ref));
    else if (x instanceof Graph) out.push({ graph: x, ref: r });
    else out.push({ text: String(x), ref: r });
  }
  return out;
}

export function plainArgv(argv) {
  return groups(argv).map((g) => g.words.map((w) => (w.graph ? w.graph.text() : w.text)));
}

// A graph argument: quoted as a whole, split back into its filter pieces through private-use markers (the quoting of
// both shells copies them unchanged, so the pieces of the quoted text line up with the filters).
function quoteGraph(graph, r, shell, batch) {
  const ps = graph.pieces();
  const plain = ps.map((p) => p.text).join('');
  const q = quote(plain, shell, { batch });
  if (q === plain) return ps.map((p) => ({ text: p.text, ref: p.ref ?? r }));
  // Index characters come from U+E100 upward; the cap keeps them inside the private-use block (U+E000-U+F8FF).
  if (ps.length > 3800) return [{ text: q, ref: r }];
  const marked = ps.map((p, i) => MARK + String.fromCharCode(0xe100 + i) + p.text).join('');
  const qm = quote(marked, shell, { batch });
  const out = [];
  let cur = { text: '', ref: r };
  for (let i = 0; i < qm.length; i++) {
    if (qm[i] === MARK) {
      if (cur.text) out.push(cur);
      const p = ps[qm.charCodeAt(i + 1) - 0xe100];
      cur = { text: '', ref: p?.ref ?? r };
      i++;
    } else cur.text += qm[i];
  }
  if (cur.text) out.push(cur);
  // Safety net: if the marked quoting differs from the plain quoting (a shell rule touched a marker), fall back to
  // one unreferenced piece rather than show a command that differs from what would be copied.
  if (out.map((p) => p.text).join('') !== q) return [{ text: q, ref: r }];
  // The opening quote belongs to the first filter.
  if (out.length > 1 && out[0].text.length === 1 && /['"]/.test(out[0].text)) { out[1].text = out[0].text + out[1].text; out.shift(); }
  return out;
}

function quoteWord(w, shell, batch) {
  if (w.graph) return quoteGraph(w.graph, w.ref, shell, batch);
  return [{ text: quote(w.text, shell, { batch }), ref: w.ref }];
}

function merge(pieces) {
  const out = [];
  for (const p of pieces) {
    if (!p.text) continue;
    const last = out[out.length - 1];
    if (last && last.ref === p.ref) last.text += p.text; else out.push({ text: p.text, ref: p.ref });
  }
  return out;
}

// Greedy line wrapping between groups only (a group such as ['-c:v', 'libx264'] never breaks), with the shell's
// continuation (' \' for bash, ' ^' for cmd) and a two-space indent, matching cmdline/quote.js byte for byte.
export function renderCommand(argv, shell = 'bash', { width = 0, batch = false } = {}) {
  // Each group: its words quoted and joined with spaces (one unbreakable unit, like commandLine).
  const units = groups(argv).map((g) => {
    const ps = [];
    g.words.forEach((w, i) => {
      if (i) ps.push({ text: ' ', ref: g.ref });
      ps.push(...quoteWord(w, shell, batch));
    });
    return ps;
  }).filter((ps) => ps.some((p) => p.text));
  const len = (ps) => ps.reduce((a, p) => a + p.text.length, 0);
  const pieces = [];
  if (!width) {
    units.forEach((u, i) => { if (i) pieces.push({ text: ' ', ref: null }); pieces.push(...u); });
  } else {
    let lineLen = 0, first = true;
    for (const u of units) {
      const n = len(u);
      if (!first && lineLen + 1 + n + CONT[shell].length > width) {
        pieces.push({ text: CONT[shell] + '\n  ', ref: null });
        lineLen = 2 + n;
      } else {
        if (!first) pieces.push({ text: ' ', ref: null });
        lineLen = first ? n : lineLen + 1 + n;
      }
      pieces.push(...u);
      first = false;
    }
  }
  const out = merge(pieces);
  return { text: out.map((p) => p.text).join(''), pieces: out };
}

export function renderScript(steps, shell = 'bash', options = {}) {
  const pieces = [];
  for (const s of steps) {
    if (s.comment) {
      if (pieces.length) pieces.push({ text: '\n', ref: null });
      pieces.push({ text: (shell === 'cmd' ? 'REM ' : '# ') + s.comment, ref: s.ref ?? null });
    }
    if (s.argv) {
      if (pieces.length) pieces.push({ text: '\n', ref: null });
      pieces.push(...renderCommand(s.argv, shell, options).pieces);
    }
  }
  const out = merge(pieces);
  return { text: out.map((p) => p.text).join(''), pieces: out };
}
