// doc/table.js - table block model: { rows: Cell[][], cols: [{ w }] } with merged cells (colspan / rowspan) kept in a
// strict grid (covered cells are flagged `m`). Shared by the products' table blocks and richtext/table-*.
import { safeColor } from '../color/color.js';
import { normI18n } from '../i18n/text.js';
import { bool, isObj, num, oneOf, round } from '../util/value.js';

// Hard caps: documents are untrusted input and a table is rendered as nested loops; 500x50 bounds DOM size and the
// O(rows*cols*span) merge pass below.
export const MAX_ROWS = 500;
export const MAX_COLS = 50;

export const emptyCell = () => ({ html: {}, cs: 1, rs: 1, m: false, bg: '', align: '', va: '', th: false });

// Normalizes b.rows / b.cols in place (dl = default language for plain-string cell values).
// Output invariant: every row has exactly nc cells, every area claimed by an anchor (cs/rs) lies inside the grid, and
// every covered cell has m:true and span 1. Renderers can then skip m cells without bounds checks.
export function normTable(b, dl) {
  let rows = [];
  if (Array.isArray(b.rows)) {
    for (let i = 0; i < b.rows.length && rows.length < MAX_ROWS; i++) if (Array.isArray(b.rows[i])) rows.push(b.rows[i]);
  }
  let cols = Array.isArray(b.cols) ? b.cols.slice(0, MAX_COLS) : [];
  let nc = Math.max(cols.length, 1);
  for (const r of rows) if (r.length > nc) nc = r.length;
  nc = Math.min(nc, MAX_COLS);
  if (!rows.length) rows = [[]];
  const cell = (c) => {
    const o = isObj(c) ? c : {};
    return {
      html: normI18n(o.html, dl),
      cs: Math.round(num(o.cs, 1, 1, 99)), rs: Math.round(num(o.rs, 1, 1, 999)), m: false,
      bg: safeColor(o.bg), align: oneOf(o.align, ['', 'left', 'center', 'right', 'justify'], ''),
      va: oneOf(o.va, ['', 'top', 'middle', 'bottom'], ''), th: bool(o.th, false),
    };
  };
  rows = rows.map((r) => {
    const out = [];
    for (let c = 0; c < nc; c++) out.push(cell(r[c]));
    return out;
  });
  cols = Array.from({ length: nc }, (_, i) => {
    const w = isObj(cols[i]) ? cols[i].w : null;
    return { w: typeof w === 'number' && w > 0 ? Math.min(100, round(w, 2)) : null };
  });
  // Recompute merges in reading order: anchors claim their area; overlaps shrink to 1x1.
  // Stored m flags are ignored on input (cell() resets m) and rebuilt here: trusting them would let a crafted file mark
  // cells covered with no anchor, leaving holes. First anchor wins, which is what a left-to-right reader expects.
  const nr = rows.length;
  const covered = rows.map(() => new Array(nc).fill(false));
  for (let r = 0; r < nr; r++) {
    for (let c = 0; c < nc; c++) {
      const x = rows[r][c];
      if (covered[r][c]) { x.m = true; x.cs = 1; x.rs = 1; continue; }
      let cs = Math.min(x.cs, nc - c);
      let rs = Math.min(x.rs, nr - r);
      let ok = true;
      for (let i = r; i < r + rs && ok; i++) for (let j = c; j < c + cs; j++) if (covered[i][j]) { ok = false; break; }
      if (!ok) { cs = 1; rs = 1; }
      x.cs = cs; x.rs = rs;
      for (let i = r; i < r + rs; i++) for (let j = c; j < c + cs; j++) covered[i][j] = true;
    }
  }
  b.rows = rows;
  b.cols = cols;
}
