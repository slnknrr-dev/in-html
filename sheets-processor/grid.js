// sheets-processor/grid.js - virtualized spreadsheet grid: only the visible cells exist in the DOM (pooled elements
// repositioned on scroll), frozen rows / columns, sticky column letters and row numbers, selection by mouse, touch and
// keyboard, column resizing (drag, double-click to fit), an in-cell editor with Excel-like Enter / Edit modes,
// click-to-reference while typing a formula, and very tall sheets (row positions are scaled beyond 15M px).
// 
// The grid knows nothing about the workbook: `api` supplies sizes, cell texts and reacts to the user.
//   api.rows() / api.cols()            numbers of rows (view rows) and columns shown
//   api.cell(i, c) -> { t, k, css }     display text, extra classes ('sp-n' number, 'sp-e' error, 'sp-ghost' spilled
//                                       value…), inline CSS of the cell style
//   api.width(c) -> px                  api.setWidth(c, px, done)        api.fitWidth(c)
//   api.head(c) -> { html, title }      column header extras (type glyph, filter / sort marks)
//   api.rowLabel(i) -> text            api.frozen() -> { rows, cols } in view rows / columns
//   api.raw(i, c) -> text to edit       api.commit(i, c, text) -> nothing   api.selected(sel)   api.editing(text|null)
//   api.menu(kind, i, c, x, y)          api.colMenu(c, anchor)            api.key(e) -> handled
//   api.edge(i, c, di, dc) -> [i, c]   Ctrl+arrow target    api.lastCell() -> [i, c]    api.label(i, c) -> screen-reader text
//   api.refText(i1, c1, i2, c2) -> 'B3:C5' (click-to-reference)       api.editable(i, c) -> boolean
// 
// Performance model:
// - Element pools (cells, column headers, row headers) are reused across frames; each element caches its last class,
//   style and text (_cls/_css/_t) so unchanged properties are never written — DOM writes are the expensive part.
// - Positions via transform (compositor) and one cssText write per changed cell.
// - Column x-offsets are a prefix-sum array (xs): column under a pixel = binary search, O(log m).
// - Rows have a fixed height (RH), so row lookup is arithmetic.

import { h } from '../ui/dom.js';
import { colName } from '../xlsx/cells.js';

export const RH = 26;
const HH = 28;
// Browsers cap element heights (Firefox ~17.9M px); beyond MAXPX the scroll position is scaled to the virtual height.
const MAXPX = 15e6;

// First index with xs[i] > x (upper bound): with prefix sums, upper(xs, x) − 1 is the column containing x.
function upper(xs, x) {
  let lo = 0, hi = xs.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m + 1; else hi = m; }
  return lo;
}

export class Grid {
  constructor(host, api, { label = '' } = {}) {
    this.api = api;
    this.sel = { r1: 0, c1: 0, r2: 0, c2: 0, ar: 0, ac: 0 };
    this.xs = new Float64Array(1);
    this.widthsDirty = true;
    this.pools = { cell: [], ch: [], rh: [] };
    this.editing = null; // { i, c, mode: 'enter' | 'edit', ref: { start, end } | null }
    this.frame = 0;
    this.el = h('div', { class: 'sp-grid' });
    this.scroller = h('div', { class: 'sp-scroll', tabindex: '0', role: 'grid', 'aria-label': label, 'aria-roledescription': 'spreadsheet' });
    this.sizer = h('div', { class: 'sp-sizer', 'aria-hidden': 'true' });
    this.layer = h('div', { class: 'sp-layer' });
    this.body = h('div', { class: 'sp-cells' });
    this.corner = h('div', { class: 'sp-corner', title: '' });
    this.editor = h('textarea', { class: 'sp-editor', spellcheck: 'false', rows: '1', hidden: true, 'aria-label': label, autocomplete: 'off' });
    this.live = h('div', { class: 'sp-live', 'aria-live': 'polite', role: 'status' });
    this.layer.append(this.body, this.corner, this.editor);
    this.scroller.append(this.layer, this.sizer);
    this.el.append(this.scroller, this.live);
    host.append(this.el);
    this.bind();
    this.ro = new ResizeObserver(() => this.render());
    this.ro.observe(this.scroller);
  }

  // --- geometry --------------------------------------------------------------------------

  invalidate() { this.widthsDirty = true; this.render(); }

  // Row-header width from the digit count of the last row label; scale maps scrollTop onto the full virtual height so the last row is reachable.
  measure() {
    const m = this.api.cols();
    if (this.widthsDirty || this.xs.length !== m + 1) {
      const xs = new Float64Array(m + 1);
      for (let c = 0; c < m; c++) xs[c + 1] = xs[c] + this.api.width(c);
      this.xs = xs;
      this.widthsDirty = false;
    }
    const n = this.api.rows();
    const digits = String(Math.max(1, Number(this.api.rowLabel(Math.max(0, n - 1))) || n)).length;
    this.rw = Math.max(46, 12 + digits * 8);
    this.vw = this.scroller.clientWidth;
    this.vh = this.scroller.clientHeight;
    const totalH = HH + n * RH;
    this.sizerH = Math.min(totalH, MAXPX);
    this.scale = totalH > this.sizerH ? (totalH - this.vh) / Math.max(1, this.sizerH - this.vh) : 1;
    const fz = this.api.frozen();
    this.fr = Math.min(fz.rows || 0, n);
    this.fc = Math.min(fz.cols || 0, m);
    this.n = n;
    this.m = m;
  }

  // Virtual vertical scroll offset in sheet pixels (scaled); horizontal scrolling is never scaled (columns are bounded at 16384).
  get sy() { return this.scroller.scrollTop * this.scale; }
  get sx() { return this.scroller.scrollLeft; }
  rowY(i) { return i < this.fr ? HH + i * RH : HH + i * RH - this.sy; }
  colX(c) { return c < this.fc ? this.rw + this.xs[c] : this.rw + this.xs[c] - this.sx; }

  // View row / column under a point of the layer (frozen areas first); -1 for headers.
  // Frozen rows ignore scrolling; rows below them are offset by sy.
  rowAt(y) {
    if (y < HH) return -1;
    const fh = this.fr * RH;
    const i = y - HH < fh ? Math.floor((y - HH) / RH) : Math.floor((y - HH + this.sy) / RH);
    return Math.max(0, Math.min(this.n - 1, i));
  }
  colAt(x) {
    if (x < this.rw) return -1;
    const fw = this.xs[this.fc];
    const cx = x - this.rw < fw ? x - this.rw : x - this.rw + this.sx;
    return Math.max(0, Math.min(this.m - 1, upper(this.xs, cx) - 1));
  }

  // --- rendering -------------------------------------------------------------------------

  // All triggers (scroll, resize, data change) coalesce into one draw per animation frame.
  render() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
  }

  draw() {
    this.measure();
    const { n, m, rw, vw, vh, fr, fc, xs } = this;
    this.sizer.style.width = rw + xs[m] + 'px';
    this.sizer.style.height = this.sizerH + 'px';
    this.layer.style.width = vw + 'px';
    this.layer.style.height = vh + 'px';
    const sy = this.sy, sx = this.sx;
    const fh = fr * RH, fw = xs[fc];
    const rows = [];
    for (let i = 0; i < fr; i++) rows.push(i);
    const i0 = Math.max(fr, Math.floor((sy + fh) / RH));
    const i1 = Math.min(n - 1, Math.floor((sy + vh - HH) / RH));
    for (let i = i0; i <= i1; i++) rows.push(i);
    const cols = [];
    for (let c = 0; c < fc; c++) cols.push(c);
    const c0 = Math.max(fc, upper(xs, sx + fw) - 1);
    const c1 = Math.min(m - 1, upper(xs, sx + vw - rw) - 1);
    for (let c = c0; c <= c1; c++) cols.push(c);
    const s = this.sel;
    const rLo = Math.min(s.r1, s.r2), rHi = Math.max(s.r1, s.r2), cLo = Math.min(s.c1, s.c2), cHi = Math.max(s.c1, s.c2);
    const multi = rLo !== rHi || cLo !== cHi;
    let k = 0;
    const pool = this.pools.cell;
    for (const i of rows) {
      const y = this.rowY(i);
      const zr = i < fr ? 2 : 0;
      for (const c of cols) {
        const x = this.colX(c);
        const w = xs[c + 1] - xs[c];
        // Stacking: scrolling cells 1, frozen-column cells 2, frozen-row cells 3, frozen corner 4; headers 6–7, corner 8, editor 10 (CSS).
        const z = zr + (c < fc ? 1 : 0) + 1;
        const d = this.api.cell(i, c);
        const inSel = multi && i >= rLo && i <= rHi && c >= cLo && c <= cHi;
        const act = i === s.ar && c === s.ac;
        const cls = 'sp-c' + (d.k ? ' ' + d.k : '') + (inSel ? ' sp-in' : '') + (act ? ' sp-act' : '') + (z > 1 ? ' sp-fz' : '');
        const css = `transform:translate(${x}px,${y}px);width:${w}px;z-index:${z};${d.css || ''}`;
        let el = pool[k];
        if (!el) { el = h('div', { class: 'sp-c' }); pool[k] = el; this.body.append(el); }
        k++;
        if (el._cls !== cls) { el.className = cls; el._cls = cls; }
        if (el._css !== css) { el.style.cssText = css; el._css = css; }
        if (el._t !== d.t) { el.textContent = d.t; el._t = d.t; }
        if (el.hidden) el.hidden = false;
      }
    }
    // Unused pooled elements are hidden, not removed: the next frame can reuse them without allocation.
    for (let j = k; j < pool.length; j++) if (!pool[j].hidden) pool[j].hidden = true;
    // column headers
    const ch = this.pools.ch;
    let q = 0;
    for (const c of cols) {
      const x = this.colX(c), w = xs[c + 1] - xs[c];
      let el = ch[q];
      if (!el) { el = h('div', { class: 'sp-ch' }); ch[q] = el; this.body.append(el); }
      q++;
      const hd = this.api.head(c);
      const on = c >= cLo && c <= cHi;
      const full = on && rLo === 0 && rHi >= n - 1;
      const key = `${c}|${hd.html}|${on}|${full}`;
      const css = `transform:translate(${x}px,0);width:${w}px;z-index:${c < fc ? 7 : 6}`;
      if (el._css !== css) { el.style.cssText = css; el._css = css; }
      if (el._k !== key) {
        el._k = key;
        el.className = 'sp-ch' + (on ? ' sp-hon' : '') + (full ? ' sp-hfull' : '');
        el.dataset.c = c;
        el.title = hd.title || '';
        el.innerHTML = `<span class="sp-ch-l">${colName(c)}</span>${hd.html || ''}<button type="button" class="sp-ch-m" tabindex="-1" aria-label="${hd.menuLabel || ''}" data-c="${c}"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button><span class="sp-rs" data-c="${c}"></span>`;
      }
      if (el.hidden) el.hidden = false;
    }
    for (let j = q; j < ch.length; j++) if (!ch[j].hidden) ch[j].hidden = true;
    // row headers
    const rh = this.pools.rh;
    q = 0;
    for (const i of rows) {
      const y = this.rowY(i);
      let el = rh[q];
      if (!el) { el = h('div', { class: 'sp-rh' }); rh[q] = el; this.body.append(el); }
      q++;
      const on = i >= rLo && i <= rHi;
      const full = on && cLo === 0 && cHi >= m - 1;
      const label = this.api.rowLabel(i);
      const key = `${label}|${on}|${full}`;
      const css = `transform:translate(0,${y}px);width:${rw}px;z-index:${i < fr ? 7 : 6}`;
      if (el._css !== css) { el.style.cssText = css; el._css = css; }
      if (el._k !== key) { el._k = key; el.className = 'sp-rh' + (on ? ' sp-hon' : '') + (full ? ' sp-hfull' : ''); el.textContent = label; }
      el.dataset.i = i;
      if (el.hidden) el.hidden = false;
    }
    for (let j = q; j < rh.length; j++) if (!rh[j].hidden) rh[j].hidden = true;
    this.corner.style.cssText = `width:${rw}px;height:${HH}px`;
    // frozen pane separators
    this.layer.style.setProperty('--sp-fx', fc ? rw + fw + 'px' : '-10px');
    this.layer.style.setProperty('--sp-fy', fr ? HH + fh + 'px' : '-10px');
    this.scroller.setAttribute('aria-rowcount', String(n));
    this.scroller.setAttribute('aria-colcount', String(m));
    if (this.editing) this.placeEditor();
  }

  // --- selection -------------------------------------------------------------------------

  // The screen-reader announcement is debounced (250 ms): holding an arrow key must not queue hundreds of announcements.
  select(sel, { scroll = true, silent = false } = {}) {
    const n = Math.max(1, this.api.rows()), m = Math.max(1, this.api.cols());
    const cl = (v, max) => Math.max(0, Math.min(max - 1, v));
    this.sel = { r1: cl(sel.r1, n), c1: cl(sel.c1, m), r2: cl(sel.r2 ?? sel.r1, n), c2: cl(sel.c2 ?? sel.c1, m), ar: cl(sel.ar ?? sel.r1, n), ac: cl(sel.ac ?? sel.c1, m) };
    if (scroll) this.scrollTo(this.sel.ar, this.sel.ac);
    this.render();
    if (!silent) {
      this.api.selected(this.sel);
      clearTimeout(this.liveTimer);
      this.liveTimer = setTimeout(() => { this.live.textContent = this.api.label(this.sel.ar, this.sel.ac); }, 250);
    }
  }

  moveTo(i, c, extend = false) {
    const s = this.sel;
    if (extend) this.select({ r1: s.r1, c1: s.c1, r2: i, c2: c, ar: s.ar, ac: s.ac }, { scroll: false });
    else this.select({ r1: i, c1: c, r2: i, c2: c, ar: i, ac: c });
    if (extend) { this.scrollTo(i, c); this.render(); }
  }

  // Minimal scroll to make the cell visible, accounting for the frozen area that covers the top and left of the viewport.
  scrollTo(i, c) {
    this.measure();
    const sc = this.scroller;
    if (i >= this.fr) {
      const top = HH + i * RH, bottom = top + RH;
      const viewTop = this.sy + HH + this.fr * RH, viewBottom = this.sy + this.vh;
      let sy = this.sy;
      if (top < viewTop) sy = top - HH - this.fr * RH;
      else if (bottom > viewBottom) sy = bottom - this.vh;
      if (sy !== this.sy) sc.scrollTop = Math.max(0, sy / this.scale);
    }
    if (c >= this.fc) {
      const left = this.xs[c], right = this.xs[c + 1];
      const viewLeft = this.sx + this.xs[this.fc], viewRight = this.sx + this.vw - this.rw;
      let sx = this.sx;
      if (left < viewLeft) sx = left - this.xs[this.fc];
      else if (right > viewRight) sx = Math.min(left - this.xs[this.fc], right - (this.vw - this.rw));
      if (sx !== this.sx) sc.scrollLeft = Math.max(0, sx);
    }
  }

  pageRows() { return Math.max(1, Math.floor((this.vh - HH - this.fr * RH) / RH) - 1); }

  // --- editing ---------------------------------------------------------------------------

  // Two modes as in Excel: "enter" (started by typing; arrows commit and move) and "edit" (F2 / double click; arrows move
  // the caret inside the text).
  startEdit(text, mode = 'edit') {
    const { ar, ac } = this.sel;
    if (this.api.editable && !this.api.editable(ar, ac)) return;
    this.scrollTo(ar, ac);
    this.editing = { i: ar, c: ac, mode, ref: null };
    const ed = this.editor;
    ed.value = text ?? this.api.raw(ar, ac);
    ed.hidden = false;
    this.measure();
    this.placeEditor();
    ed.focus({ preventScroll: true });
    const end = ed.value.length;
    ed.setSelectionRange(end, end);
    this.api.editing(ed.value);
    this.render();
  }

  // Editor width estimated from the longest line (8px per character), capped by the viewport; height up to 8 lines.
  placeEditor() {
    const { i, c } = this.editing;
    const x = this.colX(c), y = this.rowY(i);
    const w = this.xs[c + 1] - this.xs[c];
    const ed = this.editor;
    ed.style.transform = `translate(${x}px,${y}px)`;
    ed.style.minWidth = w + 'px';
    ed.style.maxWidth = Math.max(w, this.vw - x - 4) + 'px';
    ed.style.width = Math.min(Math.max(w, ed.value.split('\n').reduce((a, l) => Math.max(a, l.length), 0) * 8 + 24), Math.max(w, this.vw - x - 4)) + 'px';
    const lines = Math.min(8, ed.value.split('\n').length);
    ed.style.height = Math.max(RH, lines * 19 + 7) + 'px';
  }

  setEditorText(text) {
    if (!this.editing) return;
    this.editor.value = text;
    this.placeEditor();
  }

  finishEdit(commit, move = null) {
    if (!this.editing) return;
    const { i, c } = this.editing;
    const text = this.editor.value;
    this.editing = null;
    this.editor.hidden = true;
    this.api.editing(null);
    if (commit) this.api.commit(i, c, text);
    this.scroller.focus({ preventScroll: true });
    if (move) {
      const [di, dc] = move;
      this.moveTo(Math.max(0, i + di), Math.max(0, c + dc));
    } else this.render();
  }

  // A formula expects a reference after an operator, '(' or ',' (click-to-reference while typing).
  // Click-to-reference is active only right after an operator, "(" or a separator: clicking elsewhere commits the edit as usual.
  refPoint() {
    const ed = this.editor;
    const v = ed.value;
    if (!this.editing || v[0] !== '=') return false;
    const cut = this.editing.ref ? this.editing.ref.start : ed.selectionStart;
    const before = v.slice(0, cut).replace(/\s+$/, '');
    return /[=(,;+\-*/^&<>:]$/.test(before);
  }

  insertRef(text) {
    const ed = this.editor;
    const r = this.editing.ref || { start: ed.selectionStart, end: ed.selectionEnd };
    ed.value = ed.value.slice(0, r.start) + text + ed.value.slice(r.end);
    this.editing.ref = { start: r.start, end: r.start + text.length };
    ed.setSelectionRange(r.start + text.length, r.start + text.length);
    this.placeEditor();
    this.api.editing(ed.value);
  }

  // --- events ----------------------------------------------------------------------------

  bind() {
    const sc = this.scroller;
    sc.addEventListener('scroll', () => this.render(), { passive: true });
    sc.addEventListener('keydown', (e) => this.onKey(e));
    this.editor.addEventListener('keydown', (e) => this.onEditorKey(e));
    this.editor.addEventListener('input', () => { if (this.editing) { this.editing.ref = null; this.placeEditor(); this.api.editing(this.editor.value); } });
    // Deferred to the next task: focus may be moving to the formula bar, which sets keepEditing first.
    this.editor.addEventListener('blur', () => {
      // committing on blur keeps typed text when the user clicks elsewhere (formula bar handles its own focus)
      setTimeout(() => { if (this.editing && document.activeElement !== this.editor && !this.keepEditing) this.finishEdit(true); }, 0);
    });
    this.layer.addEventListener('pointerdown', (e) => this.onDown(e));
    this.layer.addEventListener('dblclick', (e) => this.onDbl(e));
    this.layer.addEventListener('contextmenu', (e) => this.onContext(e));
    this.layer.addEventListener('pointermove', (e) => {
      if (this.drag) return;
      const rs = e.target.closest && e.target.closest('.sp-rs');
      this.layer.classList.toggle('sp-resizing-hover', !!rs);
    });
  }

  point(e) {
    const r = this.layer.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // Mouse: select on press and drag to extend. Touch / pen: select on tap only, so a swipe stays a native scroll.
  onDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const t = e.target;
    if (t === this.editor) return;
    const menuBtn = t.closest('.sp-ch-m');
    if (menuBtn) { e.preventDefault(); this.api.colMenu(+menuBtn.dataset.c, menuBtn); return; }
    const rs = t.closest('.sp-rs');
    if (rs) { this.startResize(e, +rs.dataset.c); return; }
    const { x, y } = this.point(e);
    const i = this.rowAt(y), c = this.colAt(x);
    // click-to-reference while typing a formula
    if (this.editing && (i >= 0 && c >= 0) && this.refPoint()) {
      e.preventDefault();
      this.keepEditing = true;
      const a = { i, c };
      const ref = (p, q) => this.api.refText(p.i, p.c, q ? q.i : p.i, q ? q.c : p.c);
      this.insertRef(ref(a));
      this.trackDrag(e, (p) => this.insertRef(ref(a, p)), () => { this.keepEditing = false; this.editor.focus({ preventScroll: true }); });
      return;
    }
    if (this.editing) this.finishEdit(true);
    if (e.pointerType !== 'mouse') {
      // touch / pen: selection on tap, scrolling stays native
      const sx = e.clientX, sy = e.clientY;
      const up = (u) => {
        this.layer.removeEventListener('pointerup', up);
        if (Math.abs(u.clientX - sx) > 8 || Math.abs(u.clientY - sy) > 8) return;
        const now = Date.now();
        if (i >= 0 && c >= 0) {
          const again = this.lastTap && now - this.lastTap.t < 400 && this.lastTap.i === i && this.lastTap.c === c;
          this.moveTo(i, c);
          if (again) this.startEdit(undefined, 'edit');
        } else if (i < 0 && c >= 0) this.select({ r1: 0, c1: c, r2: this.n - 1, c2: c, ar: this.sel.ar, ac: c }, { scroll: false });
        else if (c < 0 && i >= 0) this.select({ r1: i, c1: 0, r2: i, c2: this.m - 1, ar: i, ac: this.sel.ac }, { scroll: false });
        this.lastTap = { t: now, i, c };
      };
      this.layer.addEventListener('pointerup', up);
      return;
    }
    e.preventDefault();
    this.scroller.focus({ preventScroll: true });
    const s = this.sel;
    if (i < 0 && c < 0) { this.select({ r1: 0, c1: 0, r2: this.n - 1, c2: this.m - 1, ar: s.ar, ac: s.ac }, { scroll: false }); return; }
    if (i < 0) {
      const from = e.shiftKey ? s.c1 : c;
      this.select({ r1: 0, c1: from, r2: this.n - 1, c2: c, ar: this.sel.ar, ac: c }, { scroll: false });
      this.trackDrag(e, (p) => this.select({ r1: 0, c1: from, r2: this.n - 1, c2: p.c, ar: this.sel.ar, ac: from }, { scroll: false }));
      return;
    }
    if (c < 0) {
      const from = e.shiftKey ? s.r1 : i;
      this.select({ r1: from, c1: 0, r2: i, c2: this.m - 1, ar: i, ac: this.sel.ac }, { scroll: false });
      this.trackDrag(e, (p) => this.select({ r1: from, c1: 0, r2: p.i, c2: this.m - 1, ar: from, ac: this.sel.ac }, { scroll: false }));
      return;
    }
    if (e.shiftKey) this.select({ r1: s.r1, c1: s.c1, r2: i, c2: c, ar: s.ar, ac: s.ac }, { scroll: false });
    else this.select({ r1: i, c1: c, r2: i, c2: c, ar: i, ac: c }, { scroll: false });
    const a = this.sel;
    this.trackDrag(e, (p) => this.select({ r1: a.r1, c1: a.c1, r2: p.i, c2: p.c, ar: a.ar, ac: a.ac }, { scroll: false }));
  }

  // Pointer drag with auto-scroll near the edges; fn({ i, c }) on every move.
  // Pointer capture keeps move events coming when the pointer leaves the grid; a 60 ms timer auto-scrolls near the edges.
  trackDrag(e, fn, done) {
    const id = e.pointerId;
    try { this.layer.setPointerCapture(id); } catch { /* ignore */ }
    let last = e;
    const at = (ev) => {
      const { x, y } = this.point(ev);
      return { i: this.rowAt(Math.max(HH + 1, Math.min(this.vh - 1, y))), c: this.colAt(Math.max(this.rw + 1, Math.min(this.vw - 1, x))) };
    };
    const move = (ev) => { last = ev; fn(at(ev)); };
    const timer = setInterval(() => {
      const { x, y } = this.point(last);
      let dy = 0, dx = 0;
      if (y > this.vh - 8) dy = RH; else if (y < HH + this.fr * RH && y < HH + 4) dy = -RH;
      if (x > this.vw - 8) dx = 40; else if (x < this.rw + 4) dx = -40;
      if (dx || dy) { this.scroller.scrollTop += dy / this.scale; this.scroller.scrollLeft += dx; fn(at(last)); }
    }, 60);
    const up = () => {
      clearInterval(timer);
      this.layer.removeEventListener('pointermove', move);
      this.layer.removeEventListener('pointerup', up);
      this.layer.removeEventListener('pointercancel', up);
      try { this.layer.releasePointerCapture(id); } catch { /* ignore */ }
      if (done) done();
    };
    this.layer.addEventListener('pointermove', move);
    this.layer.addEventListener('pointerup', up);
    this.layer.addEventListener('pointercancel', up);
  }

  // Listeners on window (not the layer): the pointer may leave the grid while dragging. Intermediate widths are not recorded in history; only the final one is (done = true).
  startResize(e, c) {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const w0 = this.xs[c + 1] - this.xs[c];
    this.drag = true;
    this.layer.classList.add('sp-resizing');
    const move = (ev) => { this.api.setWidth(c, Math.max(24, Math.min(1200, w0 + ev.clientX - x0)), false); this.invalidate(); };
    const up = (ev) => {
      this.drag = false;
      this.layer.classList.remove('sp-resizing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (ev.clientX !== x0) this.api.setWidth(c, Math.max(24, Math.min(1200, w0 + ev.clientX - x0)), true);
      this.invalidate();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  onDbl(e) {
    const rs = e.target.closest('.sp-rs');
    if (rs) { this.api.fitWidth(+rs.dataset.c); this.invalidate(); return; }
    const { x, y } = this.point(e);
    const i = this.rowAt(y), c = this.colAt(x);
    if (i >= 0 && c >= 0) { this.moveTo(i, c); this.startEdit(undefined, 'edit'); }
  }

  onContext(e) {
    if (e.target === this.editor) return;
    e.preventDefault();
    const { x, y } = this.point(e);
    const i = this.rowAt(y), c = this.colAt(x);
    const s = this.sel;
    const inside = (a, lo, hi) => a >= Math.min(lo, hi) && a <= Math.max(lo, hi);
    if (i < 0 && c >= 0) { if (!inside(c, s.c1, s.c2) || !(Math.min(s.r1, s.r2) === 0 && Math.max(s.r1, s.r2) >= this.n - 1)) this.select({ r1: 0, c1: c, r2: this.n - 1, c2: c, ar: s.ar, ac: c }, { scroll: false }); this.api.menu('col', i, c, e.clientX, e.clientY); return; }
    if (c < 0 && i >= 0) { if (!inside(i, s.r1, s.r2) || !(Math.min(s.c1, s.c2) === 0)) this.select({ r1: i, c1: 0, r2: i, c2: this.m - 1, ar: i, ac: s.ac }, { scroll: false }); this.api.menu('row', i, c, e.clientX, e.clientY); return; }
    if (i >= 0 && c >= 0 && !(inside(i, s.r1, s.r2) && inside(c, s.c1, s.c2))) this.moveTo(i, c);
    this.api.menu('cell', i, c, e.clientX, e.clientY);
  }

  // app shortcuts first (api.key), then grid navigation; a printable key starts editing in "enter" mode with that character.
  onKey(e) {
    if (e.target !== this.scroller) return;
    if (this.api.key(e)) { e.preventDefault(); return; }
    const s = this.sel;
    const mod = e.ctrlKey || e.metaKey;
    const ext = e.shiftKey;
    const fi = ext ? s.r2 : s.ar, fc = ext ? s.c2 : s.ac;
    const go = (i, c) => { e.preventDefault(); this.moveTo(Math.max(0, Math.min(this.n - 1, i)), Math.max(0, Math.min(this.m - 1, c)), ext); };
    const dir = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (dir) {
      if (mod) { const [i, c] = this.api.edge(fi, fc, dir[0], dir[1]); go(i, c); } else go(fi + dir[0], fc + dir[1]);
      return;
    }
    switch (e.key) {
      case 'Tab': e.preventDefault(); this.moveTo(s.ar, Math.max(0, Math.min(this.m - 1, s.ac + (e.shiftKey ? -1 : 1)))); return;
      case 'Enter': e.preventDefault(); this.moveTo(Math.max(0, Math.min(this.n - 1, s.ar + (e.shiftKey ? -1 : 1))), s.ac); return;
      case 'PageDown': go(fi + this.pageRows(), fc); return;
      case 'PageUp': go(fi - this.pageRows(), fc); return;
      case 'Home': if (mod) go(0, 0); else go(fi, 0); return;
      case 'End': { const [li, lc] = this.api.lastCell(); go(mod ? li : fi, lc); return; }
      case 'F2': e.preventDefault(); this.startEdit(undefined, 'edit'); return;
      case 'a': case 'A': if (mod) { e.preventDefault(); this.select({ r1: 0, c1: 0, r2: this.n - 1, c2: this.m - 1, ar: s.ar, ac: s.ac }, { scroll: false }); } return;
      default:
    }
    if (!mod && !e.altKey && e.key.length === 1) { e.preventDefault(); this.startEdit(e.key, 'enter'); }
  }

  onEditorKey(e) {
    if (!this.editing) return;
    const mode = this.editing.mode;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.finishEdit(false); return; }
    if (e.key === 'Enter' && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); this.finishEdit(true, [e.shiftKey ? -1 : 1, 0]); return; }
    // Alt/Ctrl+Enter inserts a newline in the cell instead of committing.
    if (e.key === 'Enter') {
      e.preventDefault();
      const ed = this.editor, p = ed.selectionStart;
      ed.setRangeText('\n', p, ed.selectionEnd, 'end');
      this.placeEditor();
      this.api.editing(ed.value);
      return;
    }
    if (e.key === 'Tab') { e.preventDefault(); this.finishEdit(true, [0, e.shiftKey ? -1 : 1]); return; }
    if (mode === 'enter' && e.key.startsWith('Arrow') && !e.shiftKey) {
      e.preventDefault();
      const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
      this.finishEdit(true, d);
    }
  }

  focus() { this.scroller.focus({ preventScroll: true }); }

  // Called on every language switch (main.js render) before a new grid is created: disconnects the ResizeObserver.
  destroy() { this.ro.disconnect(); this.el.remove(); }
}
