// sheets-processor/model.js - the workbook being edited: sheets in the model of xlsx/cells.js plus view state (header
// row, column widths / formats / types, frozen panes, filter conditions and the visible rows), undo / redo history, cell
// edits with recalculation (formula/engine.js) and structural edits (rows, columns, sorting, sheets) that keep formulas
// pointing at the same cells. No DOM: the module runs in Node too.
// 
// Sheet: { name, rows: cell[][], cols: [{ width (px), fmt, type, hidden }], merges: [{ r1, c1, r2, c2 }],
//          freeze: { rows, cols } | null, header: boolean, filter: [{ c, op, v, v2, values }] | null,
//          view: number[] | null (rows shown while filtered), sort: [{ c, desc }] | null, hidden? }
// 
// Two kinds of history entries:
// - cell edits: store only the changed cells (old and new), cheap at any sheet size;
// - structural edits (commit): snapshot the whole workbook before and after. Simple and always correct (formulas, merges,
//   filters all restored together), at a memory cost bounded by SNAPSHOT_BUDGET.
// Cells are treated as immutable values: edits replace a cell object, never mutate it, so snapshots can share cells
// (cloneSheet copies rows, not cells).

import { Engine } from '../formula/engine.js';
import { dropSheetInFormula, renameSheetInFormula, shiftFormula, translateFormula } from '../formula/parser.js';
import { isRich, usedSize } from '../xlsx/cells.js';
import { filterRows, sortOrder } from './ops.js';

export const DEFAULT_COL_PX = 100;
const HISTORY = 40;
const SNAPSHOT_BUDGET = 40e6; // cells kept in structural undo snapshots

export function newSheet(name, rows = [], extra = {}) {
  return { name, rows, cols: [], merges: [], freeze: null, header: false, filter: null, view: null, sort: null, ...extra };
}

// Excel character widths <-> pixels (Calibri 11 at 96 dpi: 7 px per character plus 5 px padding).
// Rounded to whole pixels; minimum 24px keeps a column grabbable.
export const charsToPx = (w) => Math.max(24, Math.round(w * 7 + 5));
export const pxToChars = (px) => Math.max(1, Math.round(((px - 5) / 7) * 100) / 100);

function cloneSheet(sh) {
  return {
    ...sh,
    rows: sh.rows.map((r) => (r ? r.slice() : r)),
    cols: sh.cols.map((c) => (c ? { ...c } : c)),
    merges: sh.merges.map((m) => ({ ...m })),
    freeze: sh.freeze ? { ...sh.freeze } : null,
    filter: sh.filter ? sh.filter.map((f) => ({ ...f, values: f.values ? f.values.slice() : undefined })) : null,
    view: sh.view ? sh.view.slice() : null,
    sort: sh.sort ? sh.sort.map((k) => ({ ...k })) : null,
  };
}

const cellsOf = (sheets) => sheets.reduce((n, s) => n + s.rows.reduce((m, r) => m + (r ? r.length : 0), 0), 0);

export class Book {
  constructor() {
    this.sheets = [];
    this.names = [];
    this.active = 0;
    this.undoStack = [];
    this.redoStack = [];
    this.version = 0;
    this.dirty = false;
    this.engine = new Engine(this);
    this.onChange = null; // (kind: 'cells' | 'structure' | 'view') => void
  }

  get sheet() { return this.sheets[this.active]; }

  emit(kind) {
    this.version++;
    if (kind !== 'view') this.dirty = true;
    if (this.onChange) this.onChange(kind);
  }

  // Adds sheets of a workbook model (xlsx / ods readers, CSV import); names are made unique. Appending is an undoable
  // step (structural snapshots must never lose sheets added outside the history); replacing starts a new history.
  // >
  addSheets(list, { names = [], replace = false, label = 'import' } = {}) {
    const first = replace ? 0 : this.sheets.length;
    const apply = () => {
      for (const s of list) {
        const sh = newSheet(this.uniqueName(s.name || 'Sheet' + (this.sheets.length + 1)), s.rows || [], {
          cols: (s.cols || []).map((c) => (c ? { ...c, width: c.width ? charsToPx(c.width) : undefined } : c)),
          merges: s.merges || [], freeze: s.freeze || null, header: !!s.header, hidden: !!s.hidden,
        });
        this.sheets.push(sh);
      }
      this.names.push(...names);
      this.active = Math.min(first, this.sheets.length - 1);
    };
    if (!replace) { this.commit(label, apply); return first; }
    this.sheets = []; this.names = []; this.undoStack = []; this.redoStack = [];
    apply();
    this.engine.rebuild();
    this.emit('structure');
    this.dirty = false;
    return first;
  }

  // Excel sheet-name rules: no [ ] : * ? / \, at most 31 characters, case-insensitive uniqueness. Suffix " (2)" fits inside the 31 limit.
  uniqueName(name, except = -1) {
    const base = String(name).replace(/[[\]:*?/\\]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet';
    let out = base, i = 2;
    const taken = new Set(this.sheets.map((s, k) => (k === except ? '' : s.name.toLowerCase())));
    while (taken.has(out.toLowerCase())) { const suf = ' (' + i++ + ')'; out = base.slice(0, 31 - suf.length) + suf; }
    return out;
  }

  // --- history ---------------------------------------------------------------------------

  // Count cap (40) plus a weight cap: structural entries carry the cell count of their snapshot; the oldest entries go first.
  push(entry) {
    this.undoStack.push(entry);
    this.redoStack = [];
    while (this.undoStack.length > HISTORY) this.undoStack.shift();
    // structural snapshots are large: keep their total bounded
    let total = 0;
    for (let i = this.undoStack.length - 1; i >= 0; i--) {
      total += this.undoStack[i].weight || 0;
      if (total > SNAPSHOT_BUDGET) { this.undoStack.splice(0, i + 1); break; }
    }
  }

  snapshot() { return { sheets: this.sheets.map(cloneSheet), active: this.active, names: this.names.slice() }; }

  restore(snap) {
    this.sheets = snap.sheets.map(cloneSheet);
    this.active = Math.min(snap.active, this.sheets.length - 1);
    this.names = snap.names.slice();
    this.engine.rebuild();
  }

  // Structural edit: the whole workbook is snapshotted before fn() runs; formulas are rebuilt afterwards.
  // fn returning false means "nothing to do" and must not have mutated anything. A throwing fn restores the snapshot, so a
  // failed structural edit never leaves a half-applied workbook.
  commit(label, fn) {
    const before = this.snapshot();
    let result;
    try { result = fn(); } catch (e) { this.restore(before); throw e; }
    if (result === false) return false;
    this.engine.rebuild();
    const after = this.snapshot();
    this.push({ label, weight: cellsOf(before.sheets), undo: () => this.restore(before), redo: () => this.restore(after), kind: 'structure' });
    this.emit('structure');
    return result;
  }

  // Cell edit: changes [[r, c, cell]] on sheet s; history keeps the previous cells.
  // Recalculation is incremental: only dependents of the changed cells are recomputed (engine.update).
  setCells(s, changes, label = 'edit') {
    if (!changes.length) return;
    const sh = this.sheets[s];
    const old = changes.map(([r, c]) => [r, c, sh.rows[r] ? sh.rows[r][c] : undefined]);
    const apply = (list) => {
      for (const [r, c, cell] of list) {
        let row = sh.rows[r];
        if (!row) { row = []; sh.rows[r] = row; }
        row[c] = cell ?? null;
      }
      this.engine.update(list.map(([r, c]) => [s, r, c]));
      this.active = s;
    };
    apply(changes);
    this.push({ label, weight: 0, undo: () => apply(old), redo: () => apply(changes), kind: 'cells' });
    this.emit('cells');
  }

  undo() {
    const e = this.undoStack.pop();
    if (!e) return null;
    e.undo();
    this.redoStack.push(e);
    this.refreshViews();
    this.emit(e.kind);
    return e.label;
  }

  redo() {
    const e = this.redoStack.pop();
    if (!e) return null;
    e.redo();
    this.undoStack.push(e);
    this.refreshViews();
    this.emit(e.kind);
    return e.label;
  }

  // --- view ------------------------------------------------------------------------------

  dataStart(sh = this.sheet) { return sh.header ? 1 : 0; }

  // Recomputes the visible rows of filtered sheets (text: (sheet, r, c) -> display text).
  // Filters compare display text (formatted), not raw values, for text operators: what the user sees is what matches.
  applyFilter(sh, text) {
    if (!sh.filter || !sh.filter.length) { sh.filter = null; sh.view = null; return; }
    sh.view = filterRows(sh.rows, sh.filter, (r, c) => text(sh, r, c), this.dataStart(sh));
  }

  refreshViews() { if (this.viewText) for (const sh of this.sheets) if (sh.filter) this.applyFilter(sh, this.viewText); }

  // --- structural edits ------------------------------------------------------------------

  // Rewrites every formula of the workbook with fn(text, sheetName) (returns the new text or the same).
  // Spilled cells (cell.sp) are results of a dynamic array, not formulas of their own: skipped.
  rewriteFormulas(fn) {
    for (const sh of this.sheets) {
      for (const row of sh.rows) {
        if (!row) continue;
        for (let c = 0; c < row.length; c++) {
          const cell = row[c];
          if (!isRich(cell) || cell.f == null || cell.sp) continue;
          const f = fn(cell.f, sh.name);
          if (f !== cell.f) row[c] = { ...cell, f };
        }
      }
    }
  }

  // Formulas first (shiftFormula over every sheet, since other sheets may reference this one), then the data. Rows past
  // the end are not materialised: inserting after the last row only shifts references.
  insertRows(s, at, count) {
    const sh = this.sheets[s];
    this.rewriteFormulas((f, own) => shiftFormula(f, { sheet: sh.name, formulaSheet: own, axis: 'row', at, count }));
    if (at < sh.rows.length) sh.rows.splice(at, 0, ...Array.from({ length: count }, () => []));
    sh.merges = sh.merges.map((m) => ({ ...m, r1: m.r1 >= at ? m.r1 + count : m.r1, r2: m.r2 >= at ? m.r2 + count : m.r2 }));
    if (sh.freeze && sh.freeze.rows > at) sh.freeze.rows += count;
  }

  // Merges intersecting the deleted band are dropped (partial merges are invalid); deleting row 0 removes the header flag.
  deleteRows(s, at, count) {
    const sh = this.sheets[s];
    this.rewriteFormulas((f, own) => shiftFormula(f, { sheet: sh.name, formulaSheet: own, axis: 'row', at, count: -count }));
    sh.rows.splice(at, count);
    sh.merges = sh.merges.filter((m) => m.r2 < at || m.r1 >= at + count).map((m) => (m.r1 >= at + count ? { ...m, r1: m.r1 - count, r2: m.r2 - count } : m));
    if (sh.freeze && sh.freeze.rows > at) sh.freeze.rows = Math.max(at, sh.freeze.rows - count);
    if (sh.header && at === 0) sh.header = false;
  }

  insertCols(s, at, count) {
    const sh = this.sheets[s];
    this.rewriteFormulas((f, own) => shiftFormula(f, { sheet: sh.name, formulaSheet: own, axis: 'col', at, count }));
    for (const row of sh.rows) if (row && row.length > at) row.splice(at, 0, ...new Array(count).fill(null));
    if (sh.cols.length > at) sh.cols.splice(at, 0, ...new Array(count).fill(undefined));
    sh.merges = sh.merges.map((m) => ({ ...m, c1: m.c1 >= at ? m.c1 + count : m.c1, c2: m.c2 >= at ? m.c2 + count : m.c2 }));
    if (sh.filter) sh.filter = sh.filter.map((f) => (f.c >= at ? { ...f, c: f.c + count } : f));
    if (sh.freeze && sh.freeze.cols > at) sh.freeze.cols += count;
  }

  deleteCols(s, at, count) {
    const sh = this.sheets[s];
    this.rewriteFormulas((f, own) => shiftFormula(f, { sheet: sh.name, formulaSheet: own, axis: 'col', at, count: -count }));
    for (const row of sh.rows) if (row && row.length > at) row.splice(at, count);
    sh.cols.splice(at, count);
    sh.merges = sh.merges.filter((m) => m.c2 < at || m.c1 >= at + count).map((m) => (m.c1 >= at + count ? { ...m, c1: m.c1 - count, c2: m.c2 - count } : m));
    if (sh.filter) {
      sh.filter = sh.filter.filter((f) => f.c < at || f.c >= at + count).map((f) => (f.c >= at + count ? { ...f, c: f.c - count } : f));
      if (!sh.filter.length) { sh.filter = null; sh.view = null; }
    }
    if (sh.freeze && sh.freeze.cols > at) sh.freeze.cols = Math.max(at, sh.freeze.cols - count);
  }

  // Reorders the data rows by keys [{ c, desc }]; relative references of moved formulas follow their rows.
  // Moved formulas are translated by their row delta (like Excel): relative references follow the row, absolute ones stay.
  sortSheet(s, keys) {
    const sh = this.sheets[s];
    const from = this.dataStart(sh);
    const order = sortOrder(sh.rows, keys, from);
    const rows = sh.rows.slice(0, from);
    order.forEach((r, i) => {
      const row = sh.rows[r];
      const to = from + i;
      if (row && to !== r) {
        rows.push(row.map((cell) => (isRich(cell) && cell.f != null && !cell.sp ? { ...cell, f: translateFormula(cell.f, to - r, 0) } : cell)));
      } else rows.push(row);
    });
    sh.rows = rows;
    sh.sort = keys;
  }

  // Cheap substring pre-check before parsing every formula.
  renameSheet(s, name) {
    const sh = this.sheets[s];
    const nn = this.uniqueName(name, s);
    if (nn === sh.name) return nn;
    const old = sh.name;
    this.rewriteFormulas((f) => (f.toLowerCase().includes(old.toLowerCase()) ? renameSheetInFormula(f, old, nn) : f));
    sh.name = nn;
    return nn;
  }

  deleteSheet(s) {
    const name = this.sheets[s].name;
    this.sheets.splice(s, 1);
    this.rewriteFormulas((f) => (f.toLowerCase().includes(name.toLowerCase()) ? dropSheetInFormula(f, name) : f));
    if (!this.sheets.length) this.sheets.push(newSheet('Sheet1'));
    this.active = Math.min(this.active, this.sheets.length - 1);
  }

  used(s = this.active) { return usedSize(this.sheets[s]); }
}
