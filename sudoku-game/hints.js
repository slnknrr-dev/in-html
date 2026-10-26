// sudoku-game/hints.js - hints that teach: the logical solver (sudoku/logic.js) is run from the player's correct
// entries up to the next placement, and every step on the way is explained in words (technique, houses, cells,
// symbols) with the cells to highlight. Wrong entries are reported first when the solution is known.
//
//   findHint({ model, logic, values, solution? }) -> { kind: 'error', cells } | { kind: 'solved' }
//       | { kind: 'contradiction', cells } | { kind: 'steps', steps, target, value } | { kind: 'reveal', cell, value }
//       | { kind: 'stuck' }
//   explain(hint, { model, symbols }) -> { title, level, lines: [html], area, cells, target, value, elim }
//   houseName(model, h), cellName(model, cell), symHTML(symbols, v)

//
// Teaching principle: a hint is the chain of logical steps from the current position to the NEXT placement, not the
// answer. The solver works on candidates (bitmasks per cell, sudoku/bits.js) and returns one step at a time with its
// technique and level; we replay steps until one places a value, so the player sees why that value is forced.
// Security note: explanations are HTML built from translated templates; every dynamic text goes through esc(), and
// templates themselves are escaped in fmt() before variables (already-escaped HTML) are inserted.
import { t } from '../ui/i18n.js';
import { setBits, setSize } from '../sudoku/bits.js';

// Safety bound on the replay: elimination-only techniques can chain long before a placement appears.
const MAX_STEPS = 80;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Order of checks: wrong entries first (a hint built on a wrong digit would teach nonsense), then solved, then
// replay. Without a known solution (imported puzzle) every entry is trusted.
export function findHint({ model, logic, values, solution = null }) {
  const cells = Array.from(model.geom.cells);
  if (solution) {
    const wrong = cells.filter((c) => !model.givens[c] && values[c] && values[c] !== solution[c]);
    if (wrong.length) return { kind: 'error', cells: wrong };
  }
  // only correct entries take part (without a solution: every entry)
  const vals = Array.from(model.givens);
  for (const c of cells) if (!vals[c] && values[c] && (!solution || values[c] === solution[c])) vals[c] = values[c];
  if (cells.every((c) => vals[c])) return { kind: 'solved' };
  const st = logic.stateFrom(vals);
  const steps = [];
  for (let i = 0; i < MAX_STEPS; i++) {
    const s = logic.next(st, { maxLevel: 6 });
    if (!s) break;
    // The position (including the player's entries) has no solution: report the cells instead of a technique.
    if (s.tech === 'contradiction') return { kind: 'contradiction', cells: s.cells || [] };
    steps.push(s);
    if (s.place) return { kind: 'steps', steps, target: s.place[0], value: s.place[1] };
    logic.apply(st, s);
  }
  // The solver ran out of techniques (levels up to 6): reveal the cell with the fewest candidates, the one the player
  // is most likely to resolve next with the extra information.
  if (solution) {
    const open = cells.filter((c) => !vals[c]);
    const c = open.sort((a, b) => setSize(logic.candOf(st, a)) - setSize(logic.candOf(st, b)))[0];
    return { kind: 'reveal', cell: c, value: solution[c] };
  }
  return { kind: 'stuck' };
}

// --- words ----------------------------------------------------------------------------------------------------------

// R1C1 notation (row, column, 1-based): the standard in sudoku literature, independent of symbol alphabets.
export function cellName(model, c) {
  const cols = model.geom.cols;
  return `R${Math.floor(c / cols) + 1}C${(c % cols) + 1}`;
}

export function houseName(model, h, prefix = 'sg.h.') {
  const H = model.houses[h];
  if (!H) return '';
  const multi = model.geom.grids.length > 1;
  const grid = multi && H.g != null ? ' ' + t('sg.h.inGrid', { n: H.g + 1 }) : '';
  switch (H.kind) {
    case 'row': return t(prefix + 'row', { n: H.r + 1 });
    case 'col': return t(prefix + 'col', { n: H.c + 1 });
    case 'box': return t(prefix + 'box', { n: H.i + 1 }) + grid;
    case 'region': return t(prefix + 'region', { n: H.i + 1 });
    case 'diag': return t(prefix + (H.i === 0 ? 'diag' : 'anti')) + grid;
    case 'window': return t(prefix + 'window', { n: H.i + 1 }) + grid;
    case 'group': return t(prefix + 'group', { n: H.i + 1 });
    case 'center': return t(prefix + 'center');
    case 'asterisk': return t(prefix + 'asterisk');
    case 'girandola': return t(prefix + 'girandola');
    default: return t(prefix + 'house');
  }
}

// Colour symbols render as a swatch via the --c custom property (see .sg-sym-sw::before in app.css).
export function symHTML(symbols, v) {
  const s = symbols[v - 1];
  if (!s) return String(v);
  if (s.color) return `<b class="sg-sym sg-sym-sw" style="--c:${esc(s.color)}">${esc(s.text)}</b>`;
  return `<b class="sg-sym">${esc(s.text)}</b>`;
}

const cellsHTML = (model, list) => {
  const names = [...new Set(list)].sort((a, b) => a - b).map((c) => `<b class="sg-cellref">${cellName(model, c)}</b>`);
  return names.length > 6 ? names.slice(0, 6).join(', ') + ' …' : names.join(', ');
};
const valuesHTML = (symbols, mask) => setBits(mask).map((b) => symHTML(symbols, b + 1)).join(' ');

// "4 from R1C2, R1C3; 7 from R2C2"
// Group eliminations twice: by value, then values with identical cell sets merged, so the text reads
// "3 5 7 from R5C5" instead of three separate clauses.
function elimHTML(model, symbols, elim) {
  const byValue = new Map();
  for (const [c, m] of elim) for (const b of setBits(m)) (byValue.get(b) || byValue.set(b, []).get(b)).push(c);
  // symbols removed from the same cells are named together: '3 5 7 from R5C5'
  const byCells = new Map();
  for (const [b, cs] of [...byValue.entries()].sort((a, b2) => a[0] - b2[0])) {
    const key = [...new Set(cs)].sort((a, b2) => a - b2).join(',');
    (byCells.get(key) || byCells.set(key, { cs, vs: [] }).get(key)).vs.push(b);
  }
  return [...byCells.values()].map(({ cs, vs }) => fmt('sg.why.from', { v: vs.map((b) => symHTML(symbols, b + 1)).join(' '), cells: cellsHTML(model, cs) })).join('; ');
}

// The first letter of a sentence (after leading tags) in upper case: templates may start with a lower-case name.
// \p{Ll} with the u flag: any lower-case letter in any script (Cyrillic, Georgian has no case, so it is left alone).
const capital = (html) => html.replace(/^((?:<[^>]+>)*)(\p{Ll})/u, (m, tags, ch) => tags + ch.toUpperCase());

// t() with HTML variables: the template is escaped, the variables are inserted as they are.
function fmt(key, vars) {
  return esc(t(key)).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

// Each technique has a template 'sg.why.<tech>' with named slots; the vars object fills the slots the technique uses.
// "inHouse" variants exist because many languages inflect the house name after a preposition (case endings).
function stepHTML(s, model, symbols, named = true) {
  const v = s.value ? symHTML(symbols, s.value) : s.place ? symHTML(symbols, s.place[1]) : '';
  const vars = {
    v, cell: s.place ? `<b class="sg-cellref">${cellName(model, s.place[0])}</b>` : s.cells && s.cells.length === 1 ? `<b class="sg-cellref">${cellName(model, s.cells[0])}</b>` : '',
    house: s.house >= 0 && s.house != null ? esc(houseName(model, s.house)) : esc(t('sg.h.group0')),
    inHouse: s.house >= 0 && s.house != null ? esc(houseName(model, s.house, 'sg.hin.')) : esc(t('sg.hin.group0')),
    cells: s.cells ? cellsHTML(model, s.cells) : '',
    values: s.values ? valuesHTML(symbols, s.values) : '',
    elim: s.elim ? elimHTML(model, symbols, s.elim) : '',
    k: s.k || '',
  };
  if (s.tech === 'lockedCandidates') {
    vars.house = esc(houseName(model, s.houses[0])); vars.house2 = esc(houseName(model, s.houses[1]));
    vars.inHouse = esc(houseName(model, s.houses[0], 'sg.hin.')); vars.inHouse2 = esc(houseName(model, s.houses[1], 'sg.hin.'));
  }
  if (s.tech === 'xWing' || s.tech === 'swordfish' || s.tech === 'jellyfish') {
    vars.lines = s.houses.map((x) => esc(houseName(model, x))).join(', ');
    vars.covers = (s.cover || []).map((x) => esc(houseName(model, x))).join(', ');
  }
  if (s.tech === 'variant') vars.clue = esc(t('sg.clue.' + (s.kind || 'rule')));
  if (s.tech === 'coloring') vars.sub = esc(t('sg.why.coloring.' + (s.sub || 'trap')));
  const head = named ? `<span class="sg-tech">${esc(t('sg.tech.' + s.tech))}</span> ` : '';
  return head + capital(fmt('sg.why.' + s.tech, vars));
}

// Cells of a step's houses (the area tinted on the board).
function areaOf(s, model) {
  const hs = s.houses ? [...s.houses, ...(s.cover || [])] : s.house >= 0 && s.house != null ? [s.house] : [];
  const out = new Set();
  for (const h of hs) for (const c of model.houses[h].cells) out.add(c);
  if (s.unit) for (const c of s.unit) out.add(c);
  return [...out];
}

// Presentation: the key step is the hardest one in the chain (highest level) and names the hint. Trivial variant-clue
// eliminations are summarised as a count when the chain is long, and only the last 6 steps are spelled out.
// The returned area / cells / elim drive the board overlays in view.js.
export function explain(hint, { model, symbols }) {
  if (hint.kind === 'error') return { title: t('sg.hint.errorTitle'), level: 0, lines: [esc(t('sg.hint.error', { n: hint.cells.length }))], area: [], cells: hint.cells, target: -1, elim: [] };
  if (hint.kind === 'contradiction') return { title: t('sg.hint.contraTitle'), level: 0, lines: [esc(t('sg.hint.contra'))], area: [], cells: hint.cells, target: -1, elim: [] };
  if (hint.kind === 'solved') return { title: t('sg.hint.solvedTitle'), level: 0, lines: [esc(t('sg.hint.solved'))], area: [], cells: [], target: -1, elim: [] };
  if (hint.kind === 'stuck') return { title: t('sg.hint.stuckTitle'), level: 0, lines: [esc(t('sg.hint.stuck'))], area: [], cells: [], target: -1, elim: [] };
  if (hint.kind === 'reveal') {
    const around = new Set();
    for (const hs of model.houses) if (hs.cells.includes(hint.cell)) for (const c of hs.cells) around.add(c);
    return { title: t('sg.hint.revealTitle'), level: 7, lines: [fmt('sg.hint.reveal', { cell: `<b class="sg-cellref">${cellName(model, hint.cell)}</b>`, v: symHTML(symbols, hint.value) })], area: [...around], cells: [], target: hint.cell, value: hint.value, elim: [] };
  }
  const steps = hint.steps;
  const last = steps[steps.length - 1];
  const key = steps.reduce((a, s) => (s.level > a.level ? s : a), last);
  // simple clue eliminations before the key steps are summarized
  const shown = [];
  let skipped = 0;
  steps.forEach((s, i) => {
    if (s.level <= 1 && s.tech === 'variant' && i < steps.length - 1 && steps.length > 4) skipped++;
    else shown.push(s);
  });
  const lines = [];
  if (skipped) lines.push(esc(t('sg.hint.simpler', { n: skipped })));
  const tail = shown.slice(-6);
  if (shown.length > tail.length) lines.push(esc(t('sg.hint.more', { n: shown.length - tail.length })));
  // one step alone: the title already names the technique
  const alone = tail.length === 1 && !lines.length;
  for (const s of tail) lines.push(stepHTML(s, model, symbols, !alone));
  const cells = new Set();
  // Cells of variant, colouring and trial steps are not highlighted: their "cells" are long chains or whole cages
  // that would cover the board and hide the point of the hint.
  for (const s of tail) {
    if (s.tech === 'variant' || s.tech === 'coloring' || s.tech === 'trial') continue;
    for (const c of s.cells || []) cells.add(c);
  }
  const elim = [];
  for (const s of tail) for (const e of s.elim || []) elim.push(e);
  const area = new Set([...areaOf(key, model), ...areaOf(last, model)]);
  if (key.tech === 'variant' && key.cells) for (const c of key.cells) area.add(c);
  // a naked single has no house of its own: the houses around the cell
  if (!area.size && hint.target >= 0) for (const hs of model.houses) if (hs.cells.includes(hint.target)) for (const c of hs.cells) area.add(c);
  return {
    title: t('sg.tech.' + key.tech), level: key.level, lines,
    area: [...area], cells: [...cells], target: hint.target, value: hint.value, elim,
  };
}
