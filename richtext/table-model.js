// richtext/table-model.js - table model operations (pure: mutate the table block in place and keep the grid
// invariants of doc/table.js): rows, columns, merge / split, distribute, rescale.
// Grid invariant: rows is R×C (C = cols.length); every position is covered by exactly one
// origin cell (m:false) whose cs×rs span stays inside the grid; covered positions have m:true, cs=rs=1.

// Representation choice: a dense R x C grid where merged areas keep placeholder cells (m:true), rather than the
// HTML model (rows of variable length with colspan/rowspan). Dense grids make every coordinate addressable in O(1),
// so selection rectangles, row/column insertion and deletion are plain array operations; the HTML form is derived
// at render time by skipping m cells. A new cell copies alignment from a source cell so inserted rows/columns match
// their neighbours.
function tblCell(src) {
  return { html: {}, cs: 1, rs: 1, m: false, bg: '', align: (src && src.align) || '', va: (src && src.va) || '', th: false };
}
/** Fresh table props { rows, cols } (use as V.newBlock('table', tblCreate(r, c))). */
// Size caps (200 x 40) bound render cost and keep a mistyped "3000" from freezing the editor.
function tblCreate(rows = 3, cols = 3) {
  const R = Math.max(1, Math.min(200, Math.floor(+rows) || 1));
  const C = Math.max(1, Math.min(40, Math.floor(+cols) || 1));
  return {
    rows: Array.from({ length: R }, () => Array.from({ length: C }, () => tblCell())),
    cols: Array.from({ length: C }, () => ({ w: null })),
  };
}
function tblInt(v, d = 1) {
  const n = Math.floor(+v);
  return Number.isFinite(n) && n >= 1 ? n : d;
}
/** Repair any grid: pad ragged rows, fix cell props, resolve overlapping / out-of-range spans, orphan m cells. */
// Self-healing pass run before every operation: the stored table may come from an import, an old version or a
// hand-edited file. Ragged rows are padded, widths outside (0, 100] become auto, then spans are re-validated with a
// coverage bitmap in row-major order: an origin's span is shrunk until it covers only free positions, covered
// positions become m cells, and an m cell no origin covers becomes a normal cell. Greedy and order-dependent (the
// earlier origin wins an overlap), but always terminates in a valid grid.
function tblNormalize(tb) {
  if (!Array.isArray(tb.rows)) tb.rows = [];
  tb.rows = tb.rows.filter(Array.isArray);
  if (!tb.rows.length) tb.rows = [[]];
  if (!Array.isArray(tb.cols)) tb.cols = [];
  const C = Math.max(1, tb.cols.length, ...tb.rows.map((r) => r.length));
  tb.cols = Array.from({ length: C }, (_, i) => {
    const o = tb.cols[i] && typeof tb.cols[i] === 'object' ? tb.cols[i] : {};
    const w = o.w;
    return { ...o, w: typeof w === 'number' && w > 0 && w <= 100 ? w : null };
  });
  const R = tb.rows.length;
  for (const row of tb.rows) {
    for (let c = 0; c < C; c++) {
      let x = row[c];
      if (!x || typeof x !== 'object') x = row[c] = tblCell();
      if (!x.html || typeof x.html !== 'object' || Array.isArray(x.html)) x.html = {}; // not an I18n object (normalizeDoc migrates legacy shapes)
      x.cs = tblInt(x.cs);
      x.rs = tblInt(x.rs);
      x.m = !!x.m;
      x.th = !!x.th;
      for (const k of ['bg', 'align', 'va']) if (typeof x[k] !== 'string') x[k] = '';
    }
    row.length = C;
  }
  const cov = Array.from({ length: R }, () => new Array(C).fill(false));
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const x = tb.rows[r][c];
      if (cov[r][c]) { x.m = true; x.cs = 1; x.rs = 1; continue; }
      x.m = false; // an orphan covered cell becomes a normal cell
      let cs = Math.min(x.cs, C - c);
      let k = 0;
      while (k < cs && !cov[r][c + k]) k++;
      cs = Math.max(1, k);
      const rsMax = Math.min(x.rs, R - r);
      let rs = 1;
      while (rs < rsMax) {
        let free = true;
        for (let j = 0; j < cs; j++) if (cov[r + rs][c + j]) { free = false; break; }
        if (!free) break;
        rs++;
      }
      x.cs = cs;
      x.rs = rs;
      for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) cov[r + i][c + j] = true;
    }
  }
  return tb;
}
/** map[r][c] = [originRow, originCol] (table must be normalized). */
// Coordinate -> origin lookup, recomputed per call (O(R*C)): tables are small, and a cached map would need
// invalidation after every mutation.
function tblMap(tb) {
  const R = tb.rows.length;
  const C = tb.cols.length;
  const map = Array.from({ length: R }, () => new Array(C).fill(null));
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const x = tb.rows[r][c];
      if (!x || x.m) continue;
      for (let i = 0; i < x.rs && r + i < R; i++) for (let j = 0; j < x.cs && c + j < C; j++) if (!map[r + i][c + j]) map[r + i][c + j] = [r, c];
    }
  }
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (!map[r][c]) map[r][c] = [r, c];
  return map;
}
function tblOrigin(tb, r, c) {
  const m = tblMap(tb);
  r = Math.max(0, Math.min(tb.rows.length - 1, r));
  c = Math.max(0, Math.min(tb.cols.length - 1, c));
  return m[r][c];
}
/** Smallest rectangle containing both corners that does not cut through any merged cell. */
// Fixed-point expansion: a rectangle that cuts through a merged cell grows to include it, which can make it cut
// another merged cell, so it loops until no edge moves. Merge and selection both need rectangle-closed regions.
function tblExpand(tb, r1, c1, r2, c2, map = tblMap(tb)) {
  const R = tb.rows.length;
  const C = tb.cols.length;
  const cl = (v, n) => Math.max(0, Math.min(n - 1, Math.floor(+v) || 0));
  let a = Math.min(cl(r1, R), cl(r2, R));
  let b = Math.min(cl(c1, C), cl(c2, C));
  let e = Math.max(cl(r1, R), cl(r2, R));
  let g = Math.max(cl(c1, C), cl(c2, C));
  let changed = true;
  while (changed) {
    changed = false;
    for (let r = a; r <= e; r++) {
      for (let c = b; c <= g; c++) {
        const [or, oc] = map[r][c];
        const x = tb.rows[or][oc];
        const er = or + x.rs - 1;
        const ec = oc + x.cs - 1;
        if (or < a) { a = or; changed = true; }
        if (oc < b) { b = oc; changed = true; }
        if (er > e) { e = er; changed = true; }
        if (ec > g) { g = ec; changed = true; }
      }
    }
  }
  return { r1: a, c1: b, r2: e, c2: g };
}
/** Origin cells [r, c] inside a rectangle, row-major. */
function tblOrigins(tb, rect) {
  const out = [];
  for (let r = rect.r1; r <= rect.r2; r++) {
    for (let c = rect.c1; c <= rect.c2; c++) if (!tb.rows[r][c].m) out.push([r, c]);
  }
  return out;
}
/** Make all-numeric widths sum to 100 (null/auto widths are left alone). */
// Widths are percentages rounded to 0.1; the last column absorbs the rounding remainder so the sum is exactly 100
// (otherwise 33.3 x 3 = 99.9 leaves a visible gap or wraps the table).
function tblRescale(tb) {
  const ws = tb.cols.map((c) => c.w);
  if (!ws.length || ws.some((w) => typeof w !== 'number')) return;
  const sum = ws.reduce((s, w) => s + w, 0);
  if (sum <= 0) return;
  let acc = 0;
  tb.cols.forEach((c, i) => {
    if (i === tb.cols.length - 1) c.w = Math.round((100 - acc) * 10) / 10;
    else { c.w = Math.round((c.w * 100 / sum) * 10) / 10; acc += c.w; }
  });
}
/** Insert an empty row before index `at` (0..R). Merges crossing the new line grow. Returns the new row index. */
// A row inserted INSIDE a vertical merge extends that merge (rs++ once per origin, tracked in `bumped`) and the new
// positions become covered cells; inserting at an edge never extends a merge.
function tblInsertRow(tb, at) {
  tblNormalize(tb);
  const R = tb.rows.length;
  const C = tb.cols.length;
  at = Math.max(0, Math.min(R, Math.floor(+at) || 0));
  const map = tblMap(tb);
  const ref = map[at > 0 ? at - 1 : 0]; // formatting (align/va) is copied from the row above
  const bumped = new Set();
  const row = [];
  for (let c = 0; c < C; c++) {
    const [fr, fc] = ref[c];
    const nc = tblCell(tb.rows[fr][fc]);
    if (at > 0 && at < R) {
      const [or, oc] = map[at][c];
      if (or < at) {
        nc.m = true;
        const key = or + ':' + oc;
        if (!bumped.has(key)) { tb.rows[or][oc].rs++; bumped.add(key); }
      }
    }
    row.push(nc);
  }
  tb.rows.splice(at, 0, row);
  return at;
}
/** Insert an empty column before index `at` (0..C). Merges crossing the new line grow. */
function tblInsertCol(tb, at) {
  tblNormalize(tb);
  const R = tb.rows.length;
  const C = tb.cols.length;
  at = Math.max(0, Math.min(C, Math.floor(+at) || 0));
  const map = tblMap(tb);
  const bumped = new Set();
  for (let r = 0; r < R; r++) {
    const [fr, fc] = map[r][at > 0 ? at - 1 : 0];
    const nc = tblCell(tb.rows[fr][fc]);
    if (at > 0 && at < C) {
      const [or, oc] = map[r][at];
      if (oc < at) {
        nc.m = true;
        const key = or + ':' + oc;
        if (!bumped.has(key)) { tb.rows[or][oc].cs++; bumped.add(key); }
      }
    }
    tb.rows[r].splice(at, 0, nc);
  }
  const numeric = tb.cols.every((c) => typeof c.w === 'number');
  tb.cols.splice(at, 0, { w: numeric ? 100 / C : null });
  if (numeric) tblRescale(tb);
  return at;
}
/** Delete rows r1..r2 (inclusive). Returns false if that would remove every row (delete the table instead). */
// Merges overlapping the deleted band shrink; a merge whose ORIGIN row is deleted but which continues below is
// re-anchored: its content and span move to the first surviving row. Deleting every row is refused (caller deletes
// the table block instead), keeping the "at least 1x1" invariant.
function tblDeleteRows(tb, r1, r2) {
  tblNormalize(tb);
  const R = tb.rows.length;
  const C = tb.cols.length;
  r1 = Math.max(0, Math.min(R - 1, Math.floor(+r1) || 0));
  r2 = Math.max(0, Math.min(R - 1, Math.floor(+(r2 == null ? r1 : r2)) || 0));
  if (r1 > r2) [r1, r2] = [r2, r1];
  if (r1 === 0 && r2 === R - 1) return false;
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const x = tb.rows[r][c];
      if (x.m) continue;
      const er = r + x.rs - 1;
      if (er < r1 || r > r2) continue;
      const overlap = Math.min(er, r2) - Math.max(r, r1) + 1;
      if (r < r1) x.rs -= overlap;
      else if (er > r2) { // origin row deleted, span continues below: move the origin down
        Object.assign(tb.rows[r2 + 1][c], { ...x, m: false, rs: er - r2, cs: x.cs });
      }
    }
  }
  tb.rows.splice(r1, r2 - r1 + 1);
  tblNormalize(tb);
  return true;
}
/** Delete columns c1..c2 (inclusive). Returns false if that would remove every column. */
function tblDeleteCols(tb, c1, c2) {
  tblNormalize(tb);
  const R = tb.rows.length;
  const C = tb.cols.length;
  c1 = Math.max(0, Math.min(C - 1, Math.floor(+c1) || 0));
  c2 = Math.max(0, Math.min(C - 1, Math.floor(+(c2 == null ? c1 : c2)) || 0));
  if (c1 > c2) [c1, c2] = [c2, c1];
  if (c1 === 0 && c2 === C - 1) return false;
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const x = tb.rows[r][c];
      if (x.m) continue;
      const ec = c + x.cs - 1;
      if (ec < c1 || c > c2) continue;
      const overlap = Math.min(ec, c2) - Math.max(c, c1) + 1;
      if (c < c1) x.cs -= overlap;
      else if (ec > c2) Object.assign(tb.rows[r][c2 + 1], { ...x, m: false, cs: ec - c2, rs: x.rs });
    }
  }
  for (const row of tb.rows) row.splice(c1, c2 - c1 + 1);
  tb.cols.splice(c1, c2 - c1 + 1);
  tblRescale(tb);
  tblNormalize(tb);
  return true;
}
// Rough emptiness test on stored cell HTML (tags stripped, nbsp as space); a rule <hr> counts as content.
function tblHasText(s) {
  return typeof s === 'string' && (/\S/.test(s.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;|\u00a0/g, ' ')) || /<hr\b/i.test(s));
}
/** Merge a rectangle (expanded to whole merged cells). Content of all cells is concatenated per language.
 *  Returns the merged rect, or null when it is already a single cell. */
// Content of every non-empty cell is kept, per language, as consecutive paragraphs in reading order (spreadsheet
// apps discard all but the top-left cell; losing text silently is worse in a document editor). Inline-only cell HTML
// is wrapped in <p> so the concatenation stays block-structured.
function tblMerge(tb, r1, c1, r2, c2) {
  tblNormalize(tb);
  const rect = tblExpand(tb, r1, c1, r2, c2);
  const list = tblOrigins(tb, rect);
  if (list.length < 2) return null;
  const o = tb.rows[rect.r1][rect.c1];
  const langs = new Set();
  for (const [r, c] of list) for (const k of Object.keys(tb.rows[r][c].html || {})) langs.add(k);
  const html = {};
  for (const lang of langs) {
    const parts = list.map(([r, c]) => tb.rows[r][c].html[lang]).filter(tblHasText)
      .map((s) => (/^\s*<(p|h3|h4|ul|ol|blockquote|pre|hr)\b/i.test(s) ? s : `<p>${s}</p>`));
    if (parts.length) html[lang] = parts.join('');
  }
  for (let r = rect.r1; r <= rect.r2; r++) {
    for (let c = rect.c1; c <= rect.c2; c++) {
      if (r === rect.r1 && c === rect.c1) continue;
      Object.assign(tb.rows[r][c], tblCell(o), { m: true, th: o.th, bg: o.bg });
    }
  }
  o.html = html;
  o.cs = rect.c2 - rect.c1 + 1;
  o.rs = rect.r2 - rect.r1 + 1;
  o.m = false;
  return rect;
}
/** Split the merged cell covering (r, c) back into single cells (formatting copied, content kept in the first). */
function tblSplit(tb, r, c) {
  tblNormalize(tb);
  const [or, oc] = tblOrigin(tb, r, c);
  const o = tb.rows[or][oc];
  if (o.cs === 1 && o.rs === 1) return null;
  const rect = { r1: or, c1: oc, r2: or + o.rs - 1, c2: oc + o.cs - 1 };
  for (let i = rect.r1; i <= rect.r2; i++) {
    for (let j = rect.c1; j <= rect.c2; j++) {
      if (i === or && j === oc) continue;
      Object.assign(tb.rows[i][j], tblCell(o), { th: o.th, bg: o.bg });
    }
  }
  o.cs = 1;
  o.rs = 1;
  return rect;
}
/** Set props (bg, align, va, th) on every origin cell in rect. */
function tblSetCells(tb, rect, props) {
  for (const [r, c] of tblOrigins(tb, rect)) Object.assign(tb.rows[r][c], props);
}
/** Clear the text of every origin cell in rect for one language. */
function tblClear(tb, rect, lang) {
  for (const [r, c] of tblOrigins(tb, rect)) {
    const x = tb.rows[r][c];
    if (!x.html || typeof x.html !== 'object') x.html = {};
    x.html[lang] = '';
  }
}
/** Equal column widths (in %). */
// Equal widths with the same last-column remainder rule as tblRescale.
function tblDistribute(tb) {
  const n = tb.cols.length;
  tb.cols.forEach((c, i) => { c.w = i === n - 1 ? Math.round((100 - Math.round(1000 / n) / 10 * (n - 1)) * 10) / 10 : Math.round(1000 / n) / 10; });
}
/** Next/previous origin cell in reading order from (r, c); null at the ends. */
function tblNextCell(tb, r, c, dir) {
  const all = tblOrigins(tb, { r1: 0, c1: 0, r2: tb.rows.length - 1, c2: tb.cols.length - 1 });
  const [or, oc] = tblOrigin(tb, r, c);
  const i = all.findIndex(([a, b]) => a === or && b === oc);
  const n = all[i + (dir < 0 ? -1 : 1)];
  return n || null;
}

export {
  tblClear,
  tblCreate,
  tblDeleteCols,
  tblDeleteRows,
  tblDistribute,
  tblExpand,
  tblInsertCol,
  tblInsertRow,
  tblMerge,
  tblNextCell,
  tblNormalize,
  tblOrigin,
  tblOrigins,
  tblRescale,
  tblSetCells,
  tblSplit
};
