// embroidery-studio/viewer.js - the chart viewer for stitching: symbols, colours, colours with symbols, tints and a
// realistic preview; zoom and pan (mouse, wheel, pinch, keys), rulers, centre lines, page bounds, an overview;
// highlight of one colour (the others fade), marking stitched cells (tap, drag, a rectangle with Shift, a region of
// one colour with a double tap) and part stitches, parking marks, progress per colour and overall, a context menu
// (right click / long press), dark mode, phones (the key becomes a bottom sheet) and full screen.

//
// The viewer never modifies the scheme, only the progress object P (and, for the session, the symbol set). Drawing
// is delegated to stitch/view.js, which pulls its options through callbacks (options(), layer()) on every redraw:
// the viewer just mutates state and calls redraw(), with no render pipeline of its own.
import { h, debounce } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { iconEl } from '../ui/icons.js';
import { seg } from '../ui/app.js';
import { openMenu, toast, confirmDialog } from '../ui/overlays.js';
import { contextMenu } from '../ui/contextmenu.js';
import { flatten, entryLabel } from '../stitch/model.js';
import { assignSymbols } from '../stitch/symbols.js';
import { paginate, pageCapacity, pageOf } from '../stitch/pages.js';
import { createChartView, createOverview } from '../stitch/view.js';
import { rgbToLab, hexToRgb } from '../stitch/threads.js';
import { loadCatalog, getScheme, getItem } from './catalog.js';
import { settings, setSettings, deleteProgress } from './store.js';
import { openProgress, markCells, markPart, perColor, persist, partDone } from './progress.js';
import { itemTitle, iconBtn, exportScheme, printScheme } from './common.js';
import { symbolSwatch, pdfDialog } from './site.js';

// Dark rendering follows the shell theme attribute, else the OS preference (same three-state rule as ui/base.css).
const isDark = () => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);

export async function renderViewer(main, { key, go }) {
  await loadCatalog();
  let scheme;
  try { scheme = await getScheme(key); } catch (e) { main.append(h('div', { class: 'es-empty' }, h('p', {}, e.message), h('a', { class: 'ed-btn', href: '#/' }, t('nav.catalog')))); return {}; }
  const item = getItem(key);
  const title = item ? itemTitle(item) : scheme.meta.title || t('es.untitled');
  document.title = title + ' — ' + t('app.name');
  const layer = flatten(scheme);
  const P = await openProgress(key, scheme, layer);
  const st = settings();
  // The letters set is a view choice: symbols are reassigned for this session when the reader prefers letters.
  const vectorSyms = scheme.palette.map((e) => e.symbol);
  const applySymbolSet = () => {
    if (settings().symbolSet === 'letters') {
      const counts = perColor(scheme, layer, P).map((c) => c.total);
      const letters = assignSymbols(scheme.palette, { mode: 'letters', counts, labs: scheme.palette.map((e) => rgbToLab(hexToRgb(e.hex))) });
      scheme.palette.forEach((e, i) => { e.symbol = letters[i]; });
    } else scheme.palette.forEach((e, i) => { e.symbol = vectorSyms[i]; });
  };
  applySymbolSet();
  const ui = { mode: st.mode, tool: 'view', highlight: -1, onlyHighlighted: true };
  const cap = pageCapacity({ paper: st.paper, cellMm: st.cellMm, landscape: st.landscape });
  // Print page boundaries (from the current paper / cell size settings) can be overlaid so the screen matches the
  // printed PDF pages the stitcher works from.
  const pages = paginate(scheme.width, scheme.height, { cols: cap.cols, rows: cap.rows, overlap: st.overlap }).pages;

  const host = h('div', { class: 'es-canvas' });
  const ovHost = h('div', { class: 'es-ov' });
  const status = h('div', { class: 'es-status', 'aria-live': 'off' });
  const side = h('aside', { class: 'es-side', 'aria-label': t('view.key') });
  const app = h('div', { class: 'es-app es-viewer' });
  const modeSeg = seg([
    { v: 'symbols', l: 'mode.symbols', icon: 'hash', iconOnly: false }, { v: 'colorSymbols', l: 'mode.colorSymbols' }, { v: 'color', l: 'mode.color' },
    { v: 'tint', l: 'mode.tint' }, { v: 'realistic', l: 'mode.realistic' },
  ].map((o) => ({ v: o.v, l: o.l })), ui.mode, (v) => { ui.mode = v; setSettings({ mode: v }); view.redraw(); }, 'mode.label');
  modeSeg.classList.add('es-modes');
  const toolSeg = seg([
    { v: 'view', l: 'tool.view', icon: 'grip', iconOnly: true }, { v: 'mark', l: 'tool.mark', icon: 'check', iconOnly: true },
    { v: 'unmark', l: 'tool.unmark', icon: 'undo', iconOnly: true }, { v: 'park', l: 'tool.park', icon: 'pin', iconOnly: true },
  ], ui.tool, (v) => setTool(v), 'tool.label');
  const pct = h('b', { class: 'es-tpct' });
  const zoomLabel = h('span', { class: 'es-zoom' });
  const toggles = {};
  const toggle = (k, ic, label) => {
    const b = h('button', { type: 'button', class: 'ed-iconbtn es-ib es-tg', title: t(label), 'aria-label': t(label), 'aria-pressed': String(!!settings()[k]), onclick: () => { setSettings({ [k]: !settings()[k] }); b.setAttribute('aria-pressed', String(!!settings()[k])); if (k === 'overview') ovHost.hidden = !settings().overview; view.redraw(); overview && overview.redraw(); } }, iconEl(ic));
    toggles[k] = b;
    return b;
  };
  const bar = h('header', { class: 'es-tb' },
    h('a', { class: 'ed-iconbtn es-ib', href: '#/s/' + encodeURIComponent(key), title: t('view.back'), 'aria-label': t('view.back') }, iconEl('chevLeft')),
    h('div', { class: 'es-tb-title' }, h('b', {}, title), pct),
    modeSeg,
    h('div', { class: 'es-tb-g' }, iconBtn('zoomOut', t('view.zoomOut'), () => view.zoomBy(0.8)), zoomLabel, iconBtn('zoomIn', t('view.zoomIn'), () => view.zoomBy(1.25)), iconBtn('fitWidth', t('view.fit'), () => view.fit())),
    toolSeg,
    h('div', { class: 'es-tb-g es-toggles' }, toggle('grid', 'grid', 'view.grid'), toggle('rulers', 'guides', 'view.rulers'), toggle('centre', 'plus', 'view.centre'), toggle('pages', 'paper', 'view.pages'), toggle('overview', 'layout', 'view.overview')),
    h('span', { class: 'ed-spacer' }),
    iconBtn('more', t('view.more'), (e) => moreMenu(e.currentTarget)),
    iconBtn('panelRight', t('view.key'), () => app.classList.toggle('es-side-open'), { class: 'ed-iconbtn es-ib es-sidebtn' }));
  app.append(bar, h('div', { class: 'es-body' }, h('div', { class: 'es-canvas-wrap' }, host, ovHost), side), status);
  main.append(app);
  ovHost.hidden = !st.overview;

  let colorStats = perColor(scheme, layer, P);
  // cellLimits: zoom from 0.3 px per cell (overview of huge charts) to 90 px (one stitch fills a fingertip).
  // panTool: only the "view" tool pans with a single pointer; marking tools use the pointer for stitches.
  const view = createChartView(host, {
    scheme,
    layer: () => layer,
    rulers: () => settings().rulers,
    cellLimits: [0.3, 90],
    panTool: () => ui.tool === 'view',
    options: () => ({
      mode: ui.mode, grid: settings().grid, highlight: ui.highlight, done: P.done, doneStyle: settings().doneStyle, parked: P.parked,
      centre: settings().centre, pages: settings().pages ? pages : null, dark: isDark(),
    }),
    onCell, onHover, onView: () => { zoomLabel.textContent = Math.round(view.view.cell * 10) + '%'; overview && overview.redraw(); },
    onTap: (ev) => { if (ui.tool === 'view' && ev.pointerType !== 'mouse') return; },
  });
  view.canvas.setAttribute('aria-label', t('view.canvas', { title }));
  const overview = createOverview(ovHost, view, { size: 150, layer: () => layer, options: () => ({ highlight: ui.highlight, done: P.done }) });

  // --- side panel: overall progress and the colours ---
  function renderSide() {
    colorStats = perColor(scheme, layer, P);
    const total = P.total || 1;
    const p = (100 * P.doneCount) / total;
    pct.textContent = (p < 10 ? p.toFixed(1) : Math.round(p)) + '%';
    side.textContent = '';
    side.append(
      h('div', { class: 'es-side-head' },
        h('div', { class: 'es-bar' }, h('i', { style: { width: p.toFixed(2) + '%' } })),
        h('div', { class: 'es-side-n' }, h('b', {}, t('prog.done', { pct: p < 10 ? p.toFixed(1) : Math.round(p) })), h('span', {}, t('prog.count', { a: P.doneCount, b: P.total })))),
      h('label', { class: 'es-only' }, h('input', { type: 'checkbox', checked: ui.onlyHighlighted, onchange: (e) => { ui.onlyHighlighted = e.target.checked; } }), t('view.onlyHl')),
      h('div', { class: 'es-colors', role: 'listbox', 'aria-label': t('view.colors') }, scheme.palette.map((e, i) => {
        const c = colorStats[i];
        if (!c.total) return null;
        const done = c.done >= c.total;
        const row = h('button', {
          type: 'button', class: 'es-crow' + (ui.highlight === i ? ' on' : '') + (done ? ' es-cdone' : ''), role: 'option', 'aria-selected': String(ui.highlight === i), dataset: { i: String(i) },
          onclick: () => highlight(ui.highlight === i ? -1 : i),
        }, symbolSwatch(e, { size: 's' }), h('span', { class: 'es-crow-c' }, h('b', {}, entryLabel(e)), h('small', {}, e.name || '')),
          h('span', { class: 'es-crow-p' }, h('span', { class: 'es-mini' }, h('i', { style: { width: ((100 * c.done) / c.total).toFixed(1) + '%' } })), h('small', {}, `${c.done}/${c.total}`)));
        return row;
      })));
  }
  renderSide();

  // Highlighting a colour fades the others in the chart and overview; on phones the colour list (a bottom sheet)
  // closes so the chart is visible.
  function highlight(i) {
    ui.highlight = i;
    for (const r of side.querySelectorAll('.es-crow')) { const on = +r.dataset.i === i; r.classList.toggle('on', on); r.setAttribute('aria-selected', String(on)); }
    view.redraw();
    overview.redraw();
    if (i >= 0 && ui.tool === 'view' && matchMedia('(max-width: 760px)').matches) app.classList.remove('es-side-open');
  }

  function setTool(v) {
    ui.tool = v;
    toolSeg.set(v);
    host.dataset.tool = v;
  }

  // --- marking ---
  const W = scheme.width, H = scheme.height;
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const partsAt = (x, y) => layer.parts.filter((p) => p.x === x && p.y === y);
  // "Only the highlighted colour" protects neighbouring colours from accidental marking during a drag.
  const allowed = (i) => !(ui.onlyHighlighted && ui.highlight >= 0 && layer.cells[i] - 1 !== ui.highlight);
  // The part stitch under a point of a cell (by corner / triangle).
  // A cell can hold several part stitches; the one under the pointer is chosen from the fractional position inside
  // the cell (fx, fy): the quarter of the touched corner, or for three-quarter stitches the triangle on that side of
  // the diagonal (fx + fy < 1 for the tl/br diagonal, fx > fy for tr/bl).
  function partAt(x, y, fx, fy) {
    const ps = partsAt(x, y);
    if (!ps.length) return null;
    const corner = (fy < 0.5 ? 't' : 'b') + (fx < 0.5 ? 'l' : 'r');
    return ps.find((p) => p.k === 'half') || ps.find((p) => (p.k === 'quarter' || p.k === 'petite') && p.c === corner) ||
      ps.find((p) => p.k === 'three' && (p.c === corner || ((p.c === 'tl' || p.c === 'br') ? (p.c === 'tl' ? fx + fy < 1 : fx + fy >= 1) : (p.c === 'tr' ? fx > fy : fx <= fy)))) || ps[0];
  }
  let drag = null, lastTap = 0;
  function applyCell(x, y, on, fx, fy) {
    if (!inside(x, y)) return 0;
    const i = y * W + x;
    if (layer.cells[i]) return allowed(i) ? markCells(P, scheme, layer, [i], on) : 0;
    const p = partAt(x, y, fx, fy);
    if (p && (!ui.onlyHighlighted || ui.highlight < 0 || p.p === ui.highlight)) return markPart(P, p, on);
    return 0;
  }
  function changed() {
    view.redraw();
    overview.redraw();
    renderSideDebounced();
    persist(key, scheme, P);
  }
  // The chart redraws immediately on every change; the side list (DOM, heavier) at most every 120 ms during drags.
  const renderSideDebounced = debounce(renderSide, 120);
  // Gestures of the mark / unmark tools: drag paints a stroke, Shift+drag a rectangle (previewed, applied on
  // release), double tap fills the connected region of one colour, a single tap toggles in the mark tool.
  function onCell(ev) {
    if (ev.type === 'cancel') { drag = null; return; }
    const { x, y } = ev;
    if (ui.tool === 'park') {
      if (ev.type !== 'up' || !inside(x, y)) return;
      const i = y * W + x;
      if (P.parked.has(i)) P.parked.delete(i);
      else P.parked.set(i, ui.highlight >= 0 ? ui.highlight : Math.max(0, layer.cells[i] - 1));
      P.rev++;
      changed();
      return;
    }
    if (ui.tool !== 'mark' && ui.tool !== 'unmark') return;
    if (ev.type === 'down') { drag = { x0: x, y0: y, last: null, moved: false, on: ui.tool === 'mark', rect: ev.shift, fx: ev.fx, fy: ev.fy }; return; }
    if (!drag) return;
    if (ev.type === 'move') {
      if (!drag.moved && x === drag.x0 && y === drag.y0) return;
      drag.moved = true;
      if (drag.rect) { drag.cur = { x, y }; view.redraw(); return; }
      // Interpolate between the last cell and this one (fast drags).
      const from = drag.last || { x: drag.x0, y: drag.y0 };
      const n = Math.max(Math.abs(x - from.x), Math.abs(y - from.y));
      let c = 0;
      // Fast pointer moves skip cells between two events; stepping along the line (n = Chebyshev distance) fills the
      // gaps so a quick swipe still marks a continuous row.
      for (let k = drag.last ? 1 : 0; k <= n; k++) { const xx = Math.round(from.x + ((x - from.x) * k) / (n || 1)), yy = Math.round(from.y + ((y - from.y) * k) / (n || 1)); c += applyCell(xx, yy, drag.on, 0.5, 0.5); }
      drag.last = { x, y };
      if (c) changed();
      return;
    }
    if (ev.type === 'up') {
      const d = drag;
      drag = null;
      if (d.rect && d.moved) {
        const cells = [];
        for (let yy = Math.max(0, Math.min(d.y0, y)); yy <= Math.min(H - 1, Math.max(d.y0, y)); yy++) for (let xx = Math.max(0, Math.min(d.x0, x)); xx <= Math.min(W - 1, Math.max(d.x0, x)); xx++) if (allowed(yy * W + xx)) cells.push(yy * W + xx);
        if (markCells(P, scheme, layer, cells, d.on)) changed();
        return;
      }
      if (d.moved) return;
      const now = Date.now();
      if (now - lastTap < 320 && inside(x, y)) { lastTap = 0; markRegion(x, y, d.on); return; }
      lastTap = now;
      if (ui.tool === 'mark' && inside(x, y)) {
        // A tap toggles in the mark tool.
        const i = y * W + x;
        const isDone = layer.cells[i] ? !!P.done[i] : (() => { const p = partAt(x, y, ev.fx, ev.fy); return p ? partDone(P, p) : false; })();
        if (applyCell(x, y, !isDone, ev.fx, ev.fy)) changed();
      } else if (applyCell(x, y, d.on, ev.fx, ev.fy)) changed();
    }
  }
  // The region of one colour connected to (x, y).
  // Flood fill with an explicit stack (no recursion: a region can have tens of thousands of cells and would overflow
  // the call stack), 4-connected: stitches touching only at corners are separate regions, as on a chart.
  function markRegion(x, y, on) {
    const i0 = y * W + x, v = layer.cells[i0];
    if (!v) return;
    const seen = new Uint8Array(W * H), stack = [i0], cells = [];
    seen[i0] = 1;
    while (stack.length) {
      const i = stack.pop();
      cells.push(i);
      const cx = i % W, cy = (i / W) | 0;
      for (const j of [cx > 0 ? i - 1 : -1, cx < W - 1 ? i + 1 : -1, cy > 0 ? i - W : -1, cy < H - 1 ? i + W : -1]) if (j >= 0 && !seen[j] && layer.cells[j] === v) { seen[j] = 1; stack.push(j); }
    }
    if (markCells(P, scheme, layer, cells, on)) { changed(); toast(t('view.regionMarked', { n: cells.length }), 'ok'); }
  }
  function onHover(c) {
    if (!c) { status.textContent = ''; return; }
    const i = c.y * W + c.x;
    const v = layer.cells[i];
    const e = v ? scheme.palette[v - 1] : null;
    const pg = pageOf(pages, c.x, c.y);
    status.textContent = '';
    status.append(h('span', {}, t('view.cell', { x: c.x + 1, y: c.y + 1 })),
      e ? h('span', { class: 'es-st-c' }, symbolSwatch(e, { size: 'xs' }), entryLabel(e), e.name ? ' · ' + e.name : '', P.done[i] ? ' · ' + t('view.stitched') : '') : h('span', { class: 'ed-muted' }, t('view.emptyCell')),
      pg ? h('span', {}, t('view.page', { p: pg.label })) : null);
  }

  // Right click / long press.
  const detachCtx = contextMenu(host, (target, info) => {
    const c = view.cellAtClient(info.x, info.y);
    if (!inside(c.x, c.y)) return null;
    const i = c.y * W + c.x, v = layer.cells[i];
    return [
      v ? { label: P.done[i] ? t('ctx.unmark') : t('ctx.mark'), icon: 'check', action: () => { if (markCells(P, scheme, layer, [i], !P.done[i])) changed(); } } : null,
      v ? { label: t('ctx.region'), icon: 'drop', action: () => markRegion(c.x, c.y, !P.done[i]) } : null,
      v ? { label: t('ctx.highlight'), icon: 'eye', action: () => highlight(v - 1) } : null,
      { label: P.parked.has(i) ? t('ctx.unpark') : t('ctx.park'), icon: 'pin', action: () => { if (P.parked.has(i)) P.parked.delete(i); else P.parked.set(i, ui.highlight >= 0 ? ui.highlight : Math.max(0, v - 1)); changed(); } },
      { sep: true },
      { label: t('ctx.centre'), icon: 'zoomIn', action: () => { view.zoomTo(Math.max(view.view.cell, 24)); view.centerOn(c.x + 0.5, c.y + 0.5); } },
    ];
  }, { label: t('view.ctx') });

  function moreMenu(anchor) {
    const s = settings();
    openMenu(anchor, [
      ...(matchMedia('(max-width: 560px)').matches ? [
        ...[['grid', 'view.grid'], ['rulers', 'view.rulers'], ['centre', 'view.centre'], ['pages', 'view.pages']].map(([k, l]) => ({ label: t(l), checked: !!s[k], action: () => toggles[k].click() })),
        { sep: true },
      ] : []),
      { header: true, label: t('view.marks') },
      ...['cross', 'fill', 'fade'].map((v) => ({ label: t('done.' + v), checked: s.doneStyle === v, action: () => { setSettings({ doneStyle: v }); view.redraw(); } })),
      { header: true, label: t('view.symbolSet') },
      ...['symbols', 'letters'].map((v) => ({ label: t('symset.' + v), checked: s.symbolSet === v, action: () => { setSettings({ symbolSet: v }); applySymbolSet(); renderSide(); view.redraw(); } })),
      { sep: true },
      { label: t('dl.pdf'), icon: 'file', action: () => pdfDialog(scheme) },
      { label: t('view.exportProgress'), icon: 'image', action: () => exportScheme(scheme, 'png') },
      { label: t('sch.print'), icon: 'print', action: () => printScheme(scheme) },
      { label: t('view.fullscreen'), icon: 'fitWidth', action: () => fullscreen() },
      { sep: true },
      { label: t('view.markAll'), icon: 'check', disabled: ui.highlight < 0, action: () => { const cells = []; for (let i = 0; i < W * H; i++) if (layer.cells[i] - 1 === ui.highlight) cells.push(i); if (markCells(P, scheme, layer, cells, true)) changed(); } },
      { label: t('view.reset'), icon: 'trash', danger: true, action: async () => { if (await confirmDialog(t('view.reset'), t('view.resetQ'), t('view.reset'), true)) { P.done.fill(0); P.parts.clear(); P.parked.clear(); P.doneCount = 0; P.log = {}; P.started = ''; P.rev++; P.done.rev = P.rev; await deleteProgress(key); changed(); } } },
    ], { label: t('view.more') });
  }
  function fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else app.requestFullscreen?.().catch(() => toast(t('view.noFullscreen'), 'warn'));
  }

  // Keys (not while typing).
  // Single-key shortcuts: 1-5 display modes, V/M/U/P tools, G/R/C toggles, H highlights the colour under the
  // pointer, F fullscreen. Ignored while typing and with modifiers (browser shortcuts stay intact).
  function onKey(e) {
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const modes = ['symbols', 'colorSymbols', 'color', 'tint', 'realistic'];
    if (/^[1-5]$/.test(k)) { ui.mode = modes[+k - 1]; modeSeg.set(ui.mode); setSettings({ mode: ui.mode }); view.redraw(); }
    else if (k === 'v') setTool('view');
    else if (k === 'm') setTool('mark');
    else if (k === 'u') setTool('unmark');
    else if (k === 'p') setTool('park');
    else if (k === 'g') toggles.grid.click();
    else if (k === 'r') toggles.rulers.click();
    else if (k === 'c') toggles.centre.click();
    else if (k === 'h') { const c = view.hover; if (c) { const v = layer.cells[c.y * W + c.x]; highlight(v ? v - 1 : -1); } }
    else if (k === 'escape') highlight(-1);
    else if (k === 'f') fullscreen();
    else return;
    e.preventDefault();
  }
  window.addEventListener('keydown', onKey);
  setTool('view');
  return {
    full: true,
    // Leaving the screen flushes progress immediately (no debounced write is lost) and releases listeners.
    destroy() {
      window.removeEventListener('keydown', onKey);
      detachCtx();
      persist(key, scheme, P, { now: true });
      view.destroy();
      overview.destroy();
    },
  };
}
