// embroidery-studio/editor.js - the chart editor: full crosses, half / quarter / three-quarter / petite stitches,
// lines of crosses, rectangles and ellipses, flood fill (contiguous or every cell of a colour), backstitch and
// straight stitches on the half grid, French knots, beads, eraser, eyedropper, rectangular selection (move, copy, cut,
// paste between charts, mirror, rotate, crop), text in stitch fonts or any system font, layers (visibility, lock,
// order, merge, duplicate), the palette (add threads or blends, replace, merge, delete, symbols, sorting, convert to
// another brand), chart properties (title, designer, category, tags, fabric, size), undo / redo and autosave.

//
// Data model (stitch/model.js): per layer, full crosses in a typed array (palette index + 1, 0 = empty), part
// stitches as a list, lines / knots / beads with coordinates on the half-stitch grid (0.5 steps: backstitch runs
// along cell edges and through cell centres). The view always draws `flat` (all visible layers merged); edits go to
// the current layer, then `flat` is rebuilt. Undo stores whole-scheme snapshots (createHistory, 100 steps) recorded
// BEFORE each operation, so every tool gets undo without writing inverse operations.
import { h, debounce } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { iconEl, addIcons } from '../ui/icons.js';
import { seg, select, toggle } from '../ui/app.js';
import { openDialog, openMenu, toast, confirmDialog, promptDialog } from '../ui/overlays.js';
import { contextMenu } from '../ui/contextmenu.js';
import {
  flatten, emptyLayer, addPart, removeParts, threadEntry, entryLabel, resizeCanvas, crop, bounds, transform, usage,
  removePalette, mergePalette, replacePalette, compactPalette, sortPalette, cloneScheme, newId, createScheme, FABRICS,
} from '../stitch/model.js';
import { assignSymbols, isVector } from '../stitch/symbols.js';
import { lineCells, rectCells, ellipseCells, floodFill, copyRegion, clearRegion, pasteClip, transformClip, textClip, bitmapClip, createHistory, smoothEdges } from '../stitch/edit.js';
import { FONTS } from '../stitch/font.js';
import { cleanupGrid } from '../stitch/convert.js';
import { catalog, nearestThreads, rgbToLab, hexToRgb, findThread, BRANDS } from '../stitch/threads.js';
import { createChartView, createOverview } from '../stitch/view.js';
import { stats } from '../stitch/estimate.js';
import { getScheme, saveMine, loadCatalog } from './catalog.js';
import { settings, setSettings } from './store.js';
import { iconBtn, exportScheme, printScheme } from './common.js';
import { symbolSwatch, pdfDialog } from './site.js';
import { pickThread, pickSymbol } from './pickers.js';
import { CATEGORIES } from './demo.js';

addIcons({
  st_full: 'M4 4h16v16H4zM6.5 6.5l11 11M17.5 6.5l-11 11',
  st_half: 'M4 4h16v16H4zM6.5 17.5l11-11',
  st_quarter: 'M4 4h16v16H4zM6.5 6.5L12 12',
  st_three: 'M4 4h16v16H4zM6.5 17.5l11-11M6.5 6.5L12 12',
  st_petite: 'M4 4h16v16H4zM6 6l5 5M11 6l-5 5',
  st_line: 'M4 20L20 4M4 14l4 4M10 8l4 4',
  st_back: 'M3 18l5-6 5 4 8-10M3 18h0M8 12h0M13 16h0M21 6h0',
  st_straight: 'M5 19L19 5M5 19h0M19 5h0',
  st_knot: 'M12 8a4 4 0 1 0 0.01 0M12 12h0',
  st_bead: 'M12 6a6 6 0 1 0 0.01 0M10 9.5a1.6 1.6 0 1 0 0.01 0',
  st_eraser: 'M15.5 4.5l4 4-10 10H5.5l-2-2zM9.5 9.5l5 5M10 19h10',
  st_rect: 'M4 6h16v12H4z',
  st_ellipse: 'M12 6c4.4 0 8 2.7 8 6s-3.6 6-8 6-8-2.7-8-6 3.6-6 8-6z',
  st_select: 'M4 4h3M10 4h4M17 4h3v3M20 10v4M20 17v3h-3M14 20h-4M7 20H4v-3M4 14v-4M4 7V4',
  st_pick: 'M14.5 4.5l5 5-9 9-4 1 1-4zM12 7l5 5M3 21l3.5-3.5',
  st_pan: 'M8 11V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4a1.5 1.5 0 0 1 3 0v6M14 10V5.5a1.5 1.5 0 0 1 3 0V13c0 4-2.5 7-6 7s-5-2-6.5-5L3 11.5a1.5 1.5 0 0 1 2.5-1.5L8 13',
  st_smooth: 'M4 20V12a8 8 0 0 1 8-8h8M4 20h4M4 16h4',
});

// [id, icon, shortcut]; shortcuts follow common editor conventions where one exists (V pan, B brush, E eraser,
// S select, I eyedropper, T text, F fill).
const TOOLS = [
  ['pan', 'st_pan', 'V'], ['full', 'st_full', 'B'], ['half', 'st_half', 'H'], ['three', 'st_three', 'W'], ['quarter', 'st_quarter', 'Q'],
  ['petite', 'st_petite', 'P'], ['line', 'st_line', 'N'], ['rect', 'st_rect', 'R'], ['ellipse', 'st_ellipse', 'O'], ['fill', 'drop', 'F'],
  ['back', 'st_back', 'L'], ['straight', 'st_straight', 'J'], ['knot', 'st_knot', 'K'], ['bead', 'st_bead', 'D'], ['eraser', 'st_eraser', 'E'],
  ['select', 'st_select', 'S'], ['pick', 'st_pick', 'I'], ['text', 'type', 'T'],
];
// Module-level clipboard: copy in one chart, paste in another (the editor is re-created per chart, the module
// is not). Clips carry their own palette so pasting maps colours into the target chart.
let clipboard = null; // shared between charts in this tab

const isDark = () => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
// Snap to the half-stitch grid for backstitch, straight stitches and knots.
const half = (v) => Math.round(v * 2) / 2;
const cornerOf = (fx, fy) => (fy < 0.5 ? 't' : 'b') + (fx < 0.5 ? 'l' : 'r');

// New blank chart: size, fabric, thread brand.
// New charts start with eight everyday DMC colours (black 310, white, reds, greens, yellow, brown, grey) converted
// to the chosen brand by nearest colour, so the user can draw immediately. Size clamped to 5..1000.
export async function newSchemeDialog() {
  const st = settings();
  const o = { title: '', width: 80, height: 80, count: st.count, color: '#ffffff', brand: st.brand };
  const num = (k, min, max) => { const i = h('input', { type: 'number', class: 'ed-input', min, max, value: o[k] }); i.addEventListener('input', () => { o[k] = +i.value; }); return i; };
  const title = h('input', { type: 'text', class: 'ed-input', placeholder: t('new.titlePh') });
  title.addEventListener('input', () => { o.title = title.value; });
  const color = h('input', { type: 'color', class: 'ap-color', value: o.color });
  color.addEventListener('input', () => { o.color = color.value; });
  const body = h('div', { class: 'ed-fields' },
    h('label', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('new.title')), title),
    h('div', { class: 'ed-grid2' }, h('label', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('new.width')), num('width', 5, 1000)), h('label', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('new.height')), num('height', 5, 1000))),
    h('div', { class: 'ed-grid2' },
      h('label', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('new.count')), select([11, 14, 16, 18, 20, 22, 25, 28].map((v) => ({ v, l: '=' + v })), o.count, (v) => { o.count = +v; })),
      h('label', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('new.fabricColor')), color)),
    h('label', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('new.brand')), select(BRANDS.map((b) => ({ v: b.id, l: '=' + b.brand })), o.brand, (v) => { o.brand = v; })));
  const r = await openDialog({ title: t('home.new'), body, buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('new.create'), value: 'ok', primary: true }] });
  if (r !== 'ok') return null;
  const starter = ['310', 'White', '321', '797', '699', '444', '434', '415'].map((c) => {
    const d = findThread('dmc', c);
    if (o.brand === 'dmc') return d;
    return nearestThreads(d, o.brand, { n: 1 })[0].thread;
  });
  const s = createScheme({ width: Math.max(5, Math.min(1000, o.width || 80)), height: Math.max(5, Math.min(1000, o.height || 80)), title: o.title || t('es.untitled'), palette: starter.map((th) => threadEntry(th, { strands: st.strands })), fabric: { count: o.count, color: o.color } });
  const syms = assignSymbols(s.palette, {});
  s.palette.forEach((e, i) => { e.symbol = syms[i]; });
  setSettings({ brand: o.brand });
  await saveMine(s, { origin: 'new' });
  return s;
}

// Only own charts are edited. Opening the editor on a catalogue chart silently saves a copy into "my schemes" and
// redirects (replace: true, so Back does not bounce through the original key).
export async function renderEditor(main, { key, go }) {
  await loadCatalog();
  let scheme;
  try { scheme = await getScheme(key); } catch (e) { main.append(h('div', { class: 'es-empty' }, h('p', {}, e.message), h('a', { class: 'ed-btn', href: '#/my' }, t('nav.mine')))); return {}; }
  if (!key.startsWith('my:')) {
    scheme = cloneScheme(scheme);
    scheme.id = newId('s');
    await saveMine(scheme, { origin: 'copy', from: key });
    go('edit/' + encodeURIComponent('my:' + scheme.id), { replace: true });
    return {};
  }
  const id = key.slice(3);
  document.title = (scheme.meta.title || t('es.untitled')) + ' — ' + t('app.name');
  const history = createHistory({ limit: 100 });
  const ed = { tool: 'full', prevTool: 'full', color: 0, li: scheme.layers.length - 1, halfDir: '/', filled: false, mode: settings().mode === 'realistic' ? 'colorSymbols' : settings().mode, highlight: -1, selection: null, floating: null, preview: null };
  let flat = flatten(scheme);
  let saveState = 'saved';

  const host = h('div', { class: 'es-canvas' });
  const ovHost = h('div', { class: 'es-ov' });
  const status = h('div', { class: 'es-status' });
  const toolsBar = h('div', { class: 'es-tools', role: 'toolbar', 'aria-label': t('ed.tools') });
  const toolOpts = h('div', { class: 'es-toolopts' });
  const side = h('aside', { class: 'es-side es-edside' });
  const savedEl = h('span', { class: 'es-saved' });
  const undoBtn = iconBtn('undo', t('ed.undo'), () => undo());
  const redoBtn = iconBtn('redo', t('ed.redo'), () => redo());
  const titleEl = h('b', { class: 'es-tb-name' }, scheme.meta.title || t('es.untitled'));
  const modeSeg = seg([{ v: 'symbols', l: 'mode.symbols' }, { v: 'colorSymbols', l: 'mode.colorSymbols' }, { v: 'color', l: 'mode.color' }, { v: 'tint', l: 'mode.tint' }, { v: 'realistic', l: 'mode.realistic' }], ed.mode, (v) => { ed.mode = v; view.redraw(); }, 'mode.label');
  modeSeg.classList.add('es-modes');
  const zoomLabel = h('span', { class: 'es-zoom' });
  const bar = h('header', { class: 'es-tb' },
    h('a', { class: 'ed-iconbtn es-ib', href: '#/s/' + encodeURIComponent(key), title: t('ed.close'), 'aria-label': t('ed.close') }, iconEl('chevLeft')),
    h('div', { class: 'es-tb-title' }, titleEl, savedEl),
    h('div', { class: 'es-tb-g' }, undoBtn, redoBtn),
    modeSeg,
    h('div', { class: 'es-tb-g' }, iconBtn('zoomOut', t('view.zoomOut'), () => view.zoomBy(0.8)), zoomLabel, iconBtn('zoomIn', t('view.zoomIn'), () => view.zoomBy(1.25)), iconBtn('fitWidth', t('view.fit'), () => view.fit())),
    h('span', { class: 'ed-spacer' }),
    h('a', { class: 'ed-btn es-hide-s', href: '#/view/' + encodeURIComponent(key) }, iconEl('play'), t('ed.stitch')),
    iconBtn('download', t('sch.download'), (e) => exportMenu(e.currentTarget)),
    iconBtn('panelRight', t('ed.panel'), () => app.classList.toggle('es-side-open'), { class: 'ed-iconbtn es-ib es-sidebtn' }));
  const app = h('div', { class: 'es-app es-editor' }, bar, h('div', { class: 'es-body' }, h('div', { class: 'es-toolcol' }, toolsBar), h('div', { class: 'es-canvas-wrap' }, toolOpts, host, ovHost), side), status);
  main.append(app);

  const view = createChartView(host, {
    scheme, layer: () => ed.preview || flat, rulers: () => settings().rulers, cellLimits: [0.5, 90],
    panTool: () => ed.tool === 'pan',
    options: () => ({ mode: ed.mode, grid: settings().grid, highlight: ed.highlight, selection: ed.selection, centre: settings().centre, dark: isDark() }),
    onCell, onHover, onView: () => { zoomLabel.textContent = Math.round(view.view.cell * 10) + '%'; overview.redraw(); },
  });
  const overview = createOverview(ovHost, view, { size: 130, layer: () => flat, options: () => ({ highlight: ed.highlight }) });
  ovHost.hidden = !settings().overview;

  // --- state changes ---
  // Autosave 900 ms after the last change; the indicator shows dirty / saving / saved / error.
  // KNOWN DEFECT: every save passes { origin: 'new' }, which overrides the stored origin ('convert', 'copy',
  // 'import', 'carpet') because saveMine spreads `extra` after the previous origin. Fix: call saveMine(scheme) with no
  // origin so the previous one is kept (destroy() below has the same call).
  const save = debounce(async () => {
    saveState = 'saving'; renderSaved();
    try { await saveMine(scheme, { origin: 'new' }); saveState = 'saved'; } catch (e) { saveState = 'error'; toast(t('err.save', { msg: e.message }), 'error'); }
    renderSaved();
  }, 900);
  function renderSaved() { savedEl.textContent = t('ed.' + saveState); savedEl.dataset.state = saveState; undoBtn.disabled = !history.canUndo; redoBtn.disabled = !history.canRedo; }
  // flat.rev is bumped so the renderer's caches (per-layer bitmaps) know the content changed. The side panel is
  // rebuilt immediately for structural changes, otherwise debounced (stitch counts while painting).
  function changed({ palette = false, layers = false } = {}) {
    flat = flatten(scheme);
    flat.rev = (flat.rev || 0) + 1;
    ed.preview = null;
    view.redraw();
    overview.redraw();
    saveState = 'dirty';
    renderSaved();
    save();
    if (palette || layers) renderSide(); else renderCountsLater();
  }
  const renderCountsLater = debounce(() => renderSide(), 400);
  function record(label) { history.push(scheme, label); }
  // Undo / redo swap the whole scheme object; indices that may no longer exist (layer, colour) are clamped, and any
  // selection or floating paste is dropped because it refers to the old geometry.
  function restore(s) {
    if (!s) return;
    scheme = s;
    scheme.id = id;
    ed.li = Math.min(ed.li, scheme.layers.length - 1);
    ed.color = Math.min(ed.color, Math.max(0, scheme.palette.length - 1));
    ed.selection = null; ed.floating = null;
    view.setScheme(scheme, { keepView: true });
    changed({ palette: true });
  }
  const undo = () => restore(history.undo(scheme));
  const redo = () => restore(history.redo(scheme));
  const layer = () => scheme.layers[ed.li];
  // Hidden or locked layers refuse edits with a message instead of silently painting where the user cannot see.
  const editable = () => { const l = layer(); if (!l.visible || l.locked) { toast(t(l.locked ? 'ed.locked' : 'ed.hidden'), 'warn'); return false; } return true; };

  // --- tools ---
  // Switching tools places nothing: a floating paste is discarded unless explicitly dropped. The eyedropper remembers
  // the previous tool and returns to it after one pick.
  function setTool(v) {
    if (ed.floating && v !== ed.tool) dropFloating(false);
    if (v !== 'pick') ed.prevTool = v;
    ed.tool = v;
    for (const b of toolsBar.querySelectorAll('button')) { const on = b.dataset.tool === v; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    host.dataset.tool = v;
    renderToolOpts();
    if (v === 'text') textDialog();
  }
  toolsBar.append(...TOOLS.map(([id2, ic, k]) => h('button', { type: 'button', class: 'es-tool', dataset: { tool: id2 }, title: `${t('tool.' + id2)} (${k})`, 'aria-label': t('tool.' + id2), 'aria-pressed': 'false', onclick: () => setTool(id2) }, iconEl(ic))),
    h('div', { class: 'es-cur', title: t('ed.current') }));
  function renderCurrent() {
    const box = toolsBar.querySelector('.es-cur');
    box.textContent = '';
    const e = scheme.palette[ed.color];
    if (e) box.append(symbolSwatch(e), h('small', {}, entryLabel(e)));
  }
  function renderToolOpts() {
    toolOpts.textContent = '';
    const tl = ed.tool;
    const label = h('b', {}, t('tool.' + tl));
    const opts = [];
    if (tl === 'half') opts.push(seg([{ v: '/', l: '=/' }, { v: '\\', l: '=\\' }], ed.halfDir, (v) => { ed.halfDir = v; }, 'tool.half'));
    if (tl === 'rect' || tl === 'ellipse') opts.push(seg([{ v: false, l: 'ed.outline' }, { v: true, l: 'ed.filled' }], ed.filled, (v) => { ed.filled = v === true || v === 'true'; }));
    if (tl === 'fill') opts.push(h('span', { class: 'ed-hint' }, t('ed.fillHint')));
    if (tl === 'three' || tl === 'quarter' || tl === 'petite') opts.push(h('span', { class: 'ed-hint' }, t('ed.cornerHint')));
    if (tl === 'back' || tl === 'straight') opts.push(h('span', { class: 'ed-hint' }, t('ed.lineHint')));
    if (tl === 'select') opts.push(...selectionButtons());
    if (tl === 'eraser') opts.push(h('span', { class: 'ed-hint' }, t('ed.eraserHint')));
    toolOpts.append(label, ...opts);
  }
  function selectionButtons() {
    const dis = !ed.selection && !ed.floating;
    const b = (ic, k, fn, d = dis) => { const x = iconBtn(ic, t(k), fn); x.disabled = d; return x; };
    return [
      b('copy', 'ed.copy', () => copySel()), b('scissors', 'ed.cut', () => cutSel()), b('paste', 'ed.paste', () => paste(), !clipboard), b('trash', 'ed.delete', () => deleteSel()),
      b('flip', 'ed.flipH', () => transformSel('fx')), b('flip', 'ed.flipV', () => transformSel('fy')), b('rotate', 'ed.rotate', () => transformSel('r90')),
      b('crop', 'ed.cropSel', () => cropToSel(), !ed.selection),
    ];
  }

  // --- pointer events from the chart ---
  let stroke = null;
  // A full cross replaces any part stitches in that cell (a cell holds either one full stitch or parts, as on
  // fabric). Returns false for no-ops so a stroke over already painted cells records nothing.
  function paintCell(x, y) {
    const l = layer();
    if (x < 0 || y < 0 || x >= scheme.width || y >= scheme.height) return false;
    const i = y * scheme.width + x;
    if (l.cells[i] === ed.color + 1 && !l.parts.some((p) => p.x === x && p.y === y)) return false;
    l.cells[i] = ed.color + 1;
    removeParts(l, x, y);
    return true;
  }
  // Part stitch corner from the touch position inside the cell; half stitches use the chosen direction (/ or \).
  function partHere(x, y, fx, fy) {
    const l = layer();
    if (x < 0 || y < 0 || x >= scheme.width || y >= scheme.height) return false;
    const k = ed.tool;
    const c = k === 'half' ? ed.halfDir : cornerOf(fx, fy);
    const i = y * scheme.width + x;
    if (l.parts.some((p) => p.x === x && p.y === y && p.k === k && p.c === c && p.p === ed.color)) return false;
    l.cells[i] = 0;
    addPart(l, { x, y, k, c, p: ed.color });
    return true;
  }
  // The eraser removes the cell's stitches plus knots / beads within 0.45 cells and lines passing within 0.3 cells
  // of the pointer (gx, gy = precise grid position, not the cell).
  function erase(x, y, gx, gy) {
    const l = layer();
    let n = 0;
    if (x >= 0 && y >= 0 && x < scheme.width && y < scheme.height) {
      const i = y * scheme.width + x;
      if (l.cells[i]) { l.cells[i] = 0; n++; }
      n += removeParts(l, x, y);
    }
    const near = (o) => Math.abs(o.x - gx) < 0.45 && Math.abs(o.y - gy) < 0.45;
    const kn = l.knots.length + l.beads.length;
    l.knots = l.knots.filter((o) => !near(o));
    l.beads = l.beads.filter((o) => !near(o));
    n += kn - l.knots.length - l.beads.length;
    const ln = l.lines.length;
    l.lines = l.lines.filter((q) => segDist(q, gx, gy) > 0.3);
    return n + ln - l.lines.length;
  }
  const segDist = (q, px, py) => { const dx = q.x2 - q.x1, dy = q.y2 - q.y1, l2 = dx * dx + dy * dy || 1; const u = Math.max(0, Math.min(1, ((px - q.x1) * dx + (py - q.y1) * dy) / l2)); return Math.hypot(px - (q.x1 + u * dx), py - (q.y1 + u * dy)); };
  function shapeCells(a, b) {
    if (ed.tool === 'line') return lineCells(a.x, a.y, b.x, b.y);
    if (ed.tool === 'rect') return rectCells(a.x, a.y, b.x, b.y, { filled: ed.filled });
    return ellipseCells(a.x, a.y, b.x, b.y, { filled: ed.filled });
  }
  // Shape tools preview on a shallow copy of `flat` (arrays sliced), so the real layers stay untouched until release.
  function previewWith(fn) {
    const p = { ...flat, cells: flat.cells.slice(), lines: flat.lines.slice(), parts: flat.parts.slice(), knots: flat.knots.slice(), beads: flat.beads.slice() };
    fn(p);
    ed.preview = p;
    view.redraw();
  }
  // One dispatcher for all tools. Alt+press = temporary eyedropper (as in image editors). Freehand strokes fill the
  // gaps between pointer events with lineCells (Bresenham), so fast drags leave continuous lines; during a stroke
  // only `flat` is refreshed (cheap), and the full changed() bookkeeping runs once on release.
  function onCell(ev) {
    const { x, y } = ev;
    const tl = ed.tool;
    if (ev.type === 'cancel') { stroke = null; ed.preview = null; view.redraw(); return; }
    if (ev.alt && ev.type === 'down' && tl !== 'select') { pickAt(x, y, ev.fx, ev.fy); return; }
    if (tl === 'pick') { if (ev.type === 'down') { pickAt(x, y, ev.fx, ev.fy); setTool(ed.prevTool); } return; }
    if (ed.floating) {
      if (ev.type === 'down' || ev.type === 'move') { ed.floating.x = x - ed.floating.ax; ed.floating.y = y - ed.floating.ay; showFloating(); }
      if (ev.type === 'up') dropFloating(true);
      return;
    }
    if (tl === 'select') return selectEvent(ev);
    if (!scheme.palette.length && tl !== 'eraser') { if (ev.type === 'down') toast(t('ed.noColor'), 'warn'); return; }
    if (ev.type === 'down' && !editable()) { stroke = null; return; }
    if (tl === 'full' || tl === 'half' || tl === 'three' || tl === 'quarter' || tl === 'petite' || tl === 'eraser') {
      if (ev.type === 'down') { record(t('tool.' + tl)); stroke = { last: { x, y }, n: 0 }; }
      if (!stroke) return;
      if (ev.type === 'down' || ev.type === 'move') {
        const pts = ev.type === 'down' ? [[x, y]] : lineCells(stroke.last.x, stroke.last.y, x, y).slice(1);
        if (tl !== 'full' && tl !== 'eraser' && ev.type === 'move' && x === stroke.last.x && y === stroke.last.y) return;
        for (const [cx, cy] of pts) {
          if (tl === 'full') stroke.n += paintCell(cx, cy) ? 1 : 0;
          else if (tl === 'eraser') stroke.n += erase(cx, cy, ev.gx, ev.gy);
          else stroke.n += partHere(cx, cy, cx === x && cy === y ? ev.fx : 0.25, cx === x && cy === y ? ev.fy : 0.25) ? 1 : 0;
        }
        stroke.last = { x, y };
        if (stroke.n) { flat = flatten(scheme); flat.rev = (flat.rev || 0) + 1; view.redraw(); }
      }
      if (ev.type === 'up') { if (stroke && stroke.n) changed(); stroke = null; }
      return;
    }
    // Shift+click fills every cell of that colour in the layer instead of only the connected region.
    if (tl === 'fill') {
      if (ev.type !== 'down') return;
      record(t('tool.fill'));
      const n = floodFill(scheme, ed.li, x, y, ed.color, { contiguous: !ev.shift });
      if (n) changed();
      return;
    }
    if (tl === 'line' || tl === 'rect' || tl === 'ellipse') {
      if (ev.type === 'down') stroke = { a: { x, y } };
      if (!stroke) return;
      const cells = shapeCells(stroke.a, { x, y });
      if (ev.type === 'move' || ev.type === 'down') previewWith((p) => { for (const [cx, cy] of cells) if (cx >= 0 && cy >= 0 && cx < scheme.width && cy < scheme.height) p.cells[cy * scheme.width + cx] = ed.color + 1; });
      if (ev.type === 'up') {
        record(t('tool.' + tl));
        let n = 0;
        for (const [cx, cy] of cells) n += paintCell(cx, cy) ? 1 : 0;
        stroke = null;
        if (n) changed(); else { ed.preview = null; view.redraw(); }
      }
      return;
    }
    // Backstitch endpoints may lie on the outer edge (<= width / height): lines run along cell borders.
    if (tl === 'back' || tl === 'straight') {
      const px = half(ev.gx), py = half(ev.gy);
      if (ev.type === 'down') stroke = { a: { x: px, y: py } };
      if (!stroke) return;
      const q = { x1: stroke.a.x, y1: stroke.a.y, x2: px, y2: py, p: ed.color, k: tl === 'back' ? 'back' : 'straight' };
      if (ev.type === 'move' || ev.type === 'down') previewWith((p) => { if (q.x1 !== q.x2 || q.y1 !== q.y2) p.lines.push(q); });
      if (ev.type === 'up') {
        stroke = null;
        const okPt = (a, b) => a >= 0 && b >= 0 && a <= scheme.width && b <= scheme.height;
        if ((q.x1 !== q.x2 || q.y1 !== q.y2) && okPt(q.x1, q.y1) && okPt(q.x2, q.y2)) { record(t('tool.' + tl)); layer().lines.push(q); changed(); }
        else { ed.preview = null; view.redraw(); }
      }
      return;
    }
    if (tl === 'knot' || tl === 'bead') {
      if (ev.type !== 'down') return;
      const px = tl === 'bead' ? x + 0.5 : half(ev.gx), py = tl === 'bead' ? y + 0.5 : half(ev.gy);
      if (px < 0 || py < 0 || px > scheme.width || py > scheme.height) return;
      record(t('tool.' + tl));
      const arr = layer()[tl === 'knot' ? 'knots' : 'beads'];
      const i = arr.findIndex((o) => o.x === px && o.y === py);
      if (i >= 0) arr.splice(i, 1); else arr.push({ x: px, y: py, p: ed.color });
      changed();
    }
  }
  function pickAt(x, y, fx, fy) {
    if (x < 0 || y < 0 || x >= scheme.width || y >= scheme.height) return;
    const i = y * scheme.width + x;
    let p = flat.cells[i] - 1;
    if (p < 0) { const parts = flat.parts.filter((q) => q.x === x && q.y === y); const c = cornerOf(fx, fy); const q = parts.find((r) => r.c === c) || parts[0]; p = q ? q.p : -1; }
    if (p >= 0) { ed.color = p; renderSide(); toast(t('ed.picked', { name: entryLabel(scheme.palette[p]) }), 'info'); }
  }

  // --- selection, clipboard, floating pastes ---
  let selDrag = null;
  // Pressing inside an existing selection lifts its content into a floating clip (move); elsewhere starts a new
  // rectangle. Selection rectangles are half-open (x1, y1 exclusive), clamped to the chart.
  function selectEvent(ev) {
    const { x, y } = ev;
    const s = ed.selection;
    const inSel = s && x >= s.x0 && x < s.x1 && y >= s.y0 && y < s.y1;
    if (ev.type === 'down') {
      if (inSel && editable()) {
        // Lift the selection and move it.
        record(t('ed.move'));
        const clip = copyRegion(scheme, ed.li, s);
        clip.palette = scheme.palette;
        clearRegion(scheme, ed.li, s);
        flat = flatten(scheme);
        ed.floating = { clip, x: s.x0, y: s.y0, ax: x - s.x0, ay: y - s.y0, moving: true };
        ed.selection = null;
        showFloating();
        return;
      }
      selDrag = { a: { x, y } };
      ed.selection = null;
      view.redraw();
      return;
    }
    if (!selDrag) return;
    const a = selDrag.a;
    const r = { x0: Math.max(0, Math.min(a.x, x)), y0: Math.max(0, Math.min(a.y, y)), x1: Math.min(scheme.width, Math.max(a.x, x) + 1), y1: Math.min(scheme.height, Math.max(a.y, y) + 1) };
    ed.selection = r.x1 > r.x0 && r.y1 > r.y0 ? r : null;
    view.redraw();
    if (ev.type === 'up') { selDrag = null; renderToolOpts(); }
  }
  // A floating paste is drawn by pasting into a temporary single-layer copy of the preview: the same pasteClip code
  // as the final drop, so what you see while moving is exactly what lands.
  function showFloating() {
    const f = ed.floating;
    previewWith((p) => {
      const tmp = { ...scheme, layers: [{ ...p, cells: p.cells, parts: p.parts, lines: p.lines, knots: p.knots, beads: p.beads }], palette: scheme.palette.slice() };
      pasteClip(tmp, 0, f.clip, f.x, f.y, { transparent: true });
      Object.assign(p, tmp.layers[0]);
    });
    ed.selection = { x0: f.x, y0: f.y, x1: f.x + f.clip.w, y1: f.y + f.clip.h };
    view.redraw();
  }
  function dropFloating(place) {
    const f = ed.floating;
    if (!f) return;
    ed.floating = null;
    if (place || f.moving) {
      if (!f.moving) record(t('ed.paste'));
      pasteClip(scheme, ed.li, f.clip, f.x, f.y, { transparent: true });
      ed.selection = { x0: Math.max(0, f.x), y0: Math.max(0, f.y), x1: Math.min(scheme.width, f.x + f.clip.w), y1: Math.min(scheme.height, f.y + f.clip.h) };
      changed({ palette: true });
    } else { ed.preview = null; ed.selection = null; view.redraw(); }
    renderToolOpts();
  }
  function copySel() { if (!ed.selection) return; clipboard = copyRegion(scheme, ed.li, ed.selection); toast(t('ed.copied'), 'ok'); renderToolOpts(); }
  function cutSel() { if (!ed.selection || !editable()) return; copySel(); record(t('ed.cut')); clearRegion(scheme, ed.li, ed.selection); changed(); }
  function deleteSel() { if (!ed.selection || !editable()) return; record(t('ed.delete')); clearRegion(scheme, ed.li, ed.selection); changed(); }
  // New pastes appear centred in the current viewport (visible immediately), then follow the pointer until placed.
  function paste(clip = clipboard) {
    if (!clip || !editable()) return;
    if (ed.tool !== 'select') { ed.tool = 'select'; setTool('select'); }
    const v = view.view;
    const cx = Math.round(v.x + (v.width / v.cell) / 2 - clip.w / 2), cy = Math.round(v.y + (v.height / v.cell) / 2 - clip.h / 2);
    ed.floating = { clip, x: Math.max(0, cx), y: Math.max(0, cy), ax: Math.floor(clip.w / 2), ay: Math.floor(clip.h / 2) };
    showFloating();
    toast(t('ed.placeHint'), 'info');
  }
  function transformSel(op) {
    if (ed.floating) { ed.floating.clip = transformClip(ed.floating.clip, op); showFloating(); return; }
    if (!ed.selection || !editable()) return;
    record(t('ed.transform'));
    const s = ed.selection;
    const clip = transformClip(copyRegion(scheme, ed.li, s), op);
    clip.palette = scheme.palette;
    clearRegion(scheme, ed.li, s);
    pasteClip(scheme, ed.li, clip, s.x0, s.y0, { transparent: true });
    ed.selection = { x0: s.x0, y0: s.y0, x1: Math.min(scheme.width, s.x0 + clip.w), y1: Math.min(scheme.height, s.y0 + clip.h) };
    changed();
  }
  // Structural operations (crop, resize, flip, rotate) return a new scheme object; the id is re-attached so
  // autosave keeps writing to the same record.
  function cropToSel() {
    if (!ed.selection) return;
    record(t('ed.crop'));
    const c = crop(scheme, ed.selection);
    scheme = { ...c, id };
    ed.selection = null;
    view.setScheme(scheme);
    changed({ layers: true });
  }

  // --- text ---
  async function textDialog() {
    const o = { text: settings().lastText || 'Hello', font: 'pixel', scale: 1, bold: false, sys: 'serif', size: 16 };
    const area = h('textarea', { class: 'ed-input ed-textarea', rows: 3 }, o.text);
    const prev = h('canvas', { class: 'es-textprev' });
    const drawPrev = () => {
      const clip = makeClip();
      const k = Math.max(2, Math.min(6, Math.floor(420 / Math.max(1, clip.w))));
      prev.width = Math.max(1, clip.w * k); prev.height = Math.max(1, clip.h * k);
      const g = prev.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, prev.width, prev.height);
      g.fillStyle = scheme.palette[ed.color] ? scheme.palette[ed.color].hex : '#000';
      for (let y = 0; y < clip.h; y++) for (let x = 0; x < clip.w; x++) if (clip.cells[y * clip.w + x]) g.fillRect(x * k, y * k, k - (k > 3 ? 1 : 0), k - (k > 3 ? 1 : 0));
    };
    const makeClip = () => (o.font === 'system' ? systemTextClip(o.text, o.sys, o.size, o.bold, ed.color) : textClip(o.text, ed.color, { font: o.font, scale: o.scale, bold: o.bold }));
    area.addEventListener('input', () => { o.text = area.value; drawPrev(); });
    const body = h('div', { class: 'ed-fields es-textdlg' },
      h('label', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('text.text')), area),
      h('div', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('text.font')), seg([...Object.keys(FONTS).map((k) => ({ v: k, l: '=' + FONTS[k].name })), { v: 'system', l: 'text.system' }], o.font, (v) => { o.font = v; drawPrev(); })),
      h('div', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('text.scale')), seg([1, 2, 3].map((v) => ({ v, l: '=' + v + '×' })), o.scale, (v) => { o.scale = +v; drawPrev(); })),
      h('div', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('text.systemFont')), select([{ v: 'serif', l: 'text.serif' }, { v: 'sans-serif', l: 'text.sans' }, { v: 'cursive', l: 'text.script' }, { v: 'monospace', l: 'text.mono' }], o.sys, (v) => { o.sys = v; drawPrev(); }), h('input', { type: 'number', class: 'ed-input es-num', min: 6, max: 80, value: o.size, oninput: (e) => { o.size = +e.target.value || 16; drawPrev(); } })),
      h('label', { class: 'ed-field ed-field-check' }, toggle(o.bold, (v) => { o.bold = v; drawPrev(); }), h('span', { class: 'ed-label' }, t('text.bold'))),
      h('p', { class: 'ed-hint' }, t('text.hint')), prev);
    drawPrev();
    const r = await openDialog({ title: t('tool.text'), body, wide: true, buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('text.place'), value: 'ok', primary: true }] });
    if (r !== 'ok' || !o.text.trim()) { setTool(ed.prevTool === 'text' ? 'full' : ed.prevTool); return; }
    setSettings({ lastText: o.text });
    const clip = makeClip();
    clip.palette = scheme.palette;
    if (clip.missing && clip.missing.length) toast(t('text.missing', { chars: clip.missing.join(' ') }), 'warn');
    ed.tool = 'select';
    setTool('select');
    paste(clip);
  }

  // --- side panel: palette, layers, chart ---
  let tab = 'palette';
  function renderSide() {
    side.textContent = '';
    const tabs = seg([{ v: 'palette', l: 'ed.palette' }, { v: 'layers', l: 'ed.layers' }, { v: 'chart', l: 'ed.chart' }], tab, (v) => { tab = v; renderSide(); }, 'ed.panel');
    tabs.classList.add('es-tabs');
    side.append(tabs);
    if (tab === 'palette') side.append(paletteTab());
    else if (tab === 'layers') side.append(layersTab());
    else side.append(chartTab());
    renderCurrent();
  }
  function paletteTab() {
    const u = usage(scheme, flat);
    const list = h('div', { class: 'es-colors', role: 'listbox', 'aria-label': t('ed.palette') });
    scheme.palette.forEach((e, i) => {
      const n = u[i].total + u[i].back + u[i].knots + u[i].beads;
      list.append(h('div', { class: 'es-crow' + (i === ed.color ? ' on' : ''), role: 'option', 'aria-selected': String(i === ed.color), dataset: { i: String(i) }, tabindex: '0',
        onclick: () => { ed.color = i; renderSide(); }, ondblclick: () => replaceColor(i),
        onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ed.color = i; renderSide(); } } },
      h('button', { type: 'button', class: 'es-symbtn', title: t('ed.symbol'), onclick: (ev) => { ev.stopPropagation(); changeSymbol(i); } }, symbolSwatch(e, { size: 's' })),
      h('span', { class: 'es-crow-c' }, h('b', {}, entryLabel(e)), h('small', {}, (e.name || '') + (e.kind === 'bead' ? ' · ' + t('ed.bead') : ''))),
      h('span', { class: 'es-crow-n' }, Math.round(n).toLocaleString()),
      h('button', { type: 'button', class: 'ed-iconbtn es-ib', title: t('ed.highlight'), 'aria-pressed': String(ed.highlight === i), onclick: (ev) => { ev.stopPropagation(); ed.highlight = ed.highlight === i ? -1 : i; renderSide(); view.redraw(); } }, iconEl(ed.highlight === i ? 'eyeOff' : 'eye')),
      h('button', { type: 'button', class: 'ed-iconbtn es-ib', title: t('ed.colorMenu'), onclick: (ev) => { ev.stopPropagation(); colorMenu(ev.currentTarget, i); } }, iconEl('more'))));
    });
    return h('div', { class: 'es-tab' },
      h('div', { class: 'es-tab-acts' },
        h('button', { type: 'button', class: 'ed-btn ed-primary', onclick: () => addColor() }, iconEl('plus'), t('ed.addColor')),
        h('button', { type: 'button', class: 'ed-btn', onclick: (ev) => paletteMenu(ev.currentTarget) }, iconEl('sliders'), t('ed.paletteTools'))),
      list);
  }
  async function addColor(blend = false) {
    const e = await pickThread({ blend, hex: scheme.palette[ed.color] ? scheme.palette[ed.color].hex : '' });
    if (!e) return;
    record(t('ed.addColor'));
    const used = new Set(scheme.palette.map((x) => x.symbol));
    e.symbol = assignSymbols([...scheme.palette, e], { keep: true, mode: scheme.palette.some((x) => x.symbol && !isVector(x.symbol)) ? 'letters' : 'symbols' })[scheme.palette.length] || '';
    if (used.has(e.symbol)) e.symbol = '';
    scheme.palette.push(e);
    ed.color = scheme.palette.length - 1;
    changed({ palette: true });
  }
  async function replaceColor(i) {
    const e = await pickThread({ title: t('ed.replace'), hex: scheme.palette[i].hex });
    if (!e) return;
    record(t('ed.replace'));
    replacePalette(scheme, i, e);
    changed({ palette: true });
  }
  async function changeSymbol(i) {
    const used = new Set(scheme.palette.map((x) => x.symbol).filter(Boolean));
    const s = await pickSymbol(scheme.palette[i].symbol, used);
    if (s == null) return;
    record(t('ed.symbol'));
    const other = scheme.palette.findIndex((x, k) => k !== i && x.symbol === s);
    if (other >= 0) scheme.palette[other].symbol = scheme.palette[i].symbol; // swap
    scheme.palette[i].symbol = s;
    changed({ palette: true });
  }
  function colorMenu(anchor, i) {
    openMenu(anchor, [
      { label: t('ed.replace'), icon: 'replace', action: () => replaceColor(i) },
      { label: t('ed.symbol'), icon: 'hash', action: () => changeSymbol(i) },
      { label: t('ed.mergeInto'), icon: 'stack', disabled: scheme.palette.length < 2, action: () => mergeDialog(i) },
      { label: t('ed.selectColor'), icon: 'st_select', action: () => selectColor(i) },
      { label: t('ed.strands'), icon: 'sliders', action: () => strandsDialog(i) },
      { label: scheme.palette[i].kind === 'bead' ? t('ed.asThread') : t('ed.asBead'), icon: 'st_bead', action: () => { record(t('ed.kind')); scheme.palette[i].kind = scheme.palette[i].kind === 'bead' ? 'thread' : 'bead'; changed({ palette: true }); } },
      { sep: true },
      { label: t('ed.deleteColor'), icon: 'trash', danger: true, action: async () => { if (await confirmDialog(t('ed.deleteColor'), t('ed.deleteColorQ', { name: entryLabel(scheme.palette[i]) }), t('ed.delete'), true)) { record(t('ed.deleteColor')); removePalette(scheme, i); ed.color = Math.max(0, Math.min(ed.color, scheme.palette.length - 1)); ed.highlight = -1; changed({ palette: true }); } } },
    ]);
  }
  async function mergeDialog(i) {
    const sel = select(scheme.palette.map((e, k) => ({ v: k, l: '=' + entryLabel(e) + (e.name ? ' · ' + e.name : '') })).filter((o) => o.v !== i), i === 0 ? 1 : 0, () => {});
    const r = await openDialog({ title: t('ed.mergeInto'), body: h('div', { class: 'ed-fields' }, h('p', {}, t('ed.mergeQ', { name: entryLabel(scheme.palette[i]) })), sel), buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('ed.merge'), value: 'ok', primary: true }] });
    if (r !== 'ok') return;
    record(t('ed.merge'));
    const into = +sel.value;
    mergePalette(scheme, i, into);
    ed.color = into > i ? into - 1 : into;
    ed.highlight = -1;
    changed({ palette: true });
  }
  async function strandsDialog(i) {
    const e = scheme.palette[i];
    const a = h('input', { type: 'number', class: 'ed-input', min: 1, max: 6, value: e.strands });
    const b = h('input', { type: 'number', class: 'ed-input', min: 1, max: 6, value: e.bsStrands });
    const r = await openDialog({ title: t('ed.strands'), body: h('div', { class: 'ed-grid2' }, h('label', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('ed.crossStrands')), a), h('label', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('ed.backStrands')), b)), buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('dlg.ok'), value: 'ok', primary: true }] });
    if (r !== 'ok') return;
    record(t('ed.strands'));
    e.strands = Math.max(1, Math.min(6, +a.value || 2));
    e.bsStrands = Math.max(1, Math.min(6, +b.value || 1));
    changed({ palette: true });
  }
  function selectColor(i) {
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    const l = layer(), W = scheme.width;
    for (let k = 0; k < l.cells.length; k++) if (l.cells[k] - 1 === i) { const x = k % W, y = (k / W) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    if (x1 < 0) { toast(t('ed.noStitches'), 'info'); return; }
    setTool('select');
    ed.selection = { x0, y0, x1: x1 + 1, y1: y1 + 1 };
    ed.highlight = i;
    renderToolOpts();
    view.redraw();
  }
  function paletteMenu(anchor) {
    openMenu(anchor, [
      { label: t('ed.addBlend'), icon: 'plus', action: () => addColor(true) },
      { sep: true },
      { label: t('ed.symbolsVector'), icon: 'hash', action: () => resymbol('symbols') },
      { label: t('ed.symbolsLetters'), icon: 'type', action: () => resymbol('letters') },
      { sep: true },
      ...['count', 'code', 'hue', 'light'].map((by) => ({ label: t('ed.sortBy.' + by), icon: 'sort', action: () => { record(t('ed.sort')); sortPalette(scheme, by); ed.color = 0; ed.highlight = -1; changed({ palette: true }); } })),
      { label: t('ed.removeUnused'), icon: 'trash', action: () => { record(t('ed.removeUnused')); const n = scheme.palette.length; compactPalette(scheme); ed.color = 0; changed({ palette: true }); toast(t('ed.removedN', { n: n - scheme.palette.length }), 'ok'); } },
      { label: t('ed.toBrand'), icon: 'replace', action: () => toBrand() },
    ]);
  }
  // Symbols are reassigned by usage (most used colour gets the clearest symbol) and colour distance in Lab, so
  // similar colours get clearly different symbols.
  function resymbol(mode) {
    record(t('ed.symbol'));
    const u = usage(scheme, flat);
    const syms = assignSymbols(scheme.palette, { mode, counts: u.map((x) => x.total), labs: scheme.palette.map((e) => rgbToLab(hexToRgb(e.hex))) });
    scheme.palette.forEach((e, i) => { e.symbol = syms[i]; });
    changed({ palette: true });
  }
  // Brand conversion by nearest thread (delta E). Each part of a blend converts separately; the symbol and strand
  // counts are kept so the chart's look does not change.
  async function toBrand() {
    let to = settings().brand;
    const r = await openDialog({ title: t('ed.toBrand'), body: h('div', { class: 'ed-fields' }, h('p', {}, t('ed.toBrandLead')), select(BRANDS.map((b) => ({ v: b.id, l: '=' + b.brand })), to, (v) => { to = v; })), buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('dlg.ok'), value: 'ok', primary: true }] });
    if (r !== 'ok') return;
    record(t('ed.toBrand'));
    scheme.palette.forEach((e, i) => {
      if (e.blend) {
        const ts = e.blend.map((b) => nearestThreads(b.hex, to, { n: 1 })[0].thread);
        e.blend = ts.map((x) => ({ catalog: x.catalog, brand: x.brand, code: x.code, name: x.name, hex: x.hex, strands: 1 }));
        Object.assign(e, { catalog: to, brand: ts[0].brand, code: ts.map((x) => x.code).join('+'), name: ts.map((x) => x.name).join(' + ') });
      } else if (e.kind !== 'bead') {
        const th = nearestThreads(e.hex, to, { n: 1 })[0].thread;
        replacePalette(scheme, i, threadEntry(th, { symbol: e.symbol, strands: e.strands, bsStrands: e.bsStrands }));
      }
    });
    setSettings({ brand: to });
    changed({ palette: true });
  }
  function layersTab() {
    const list = h('div', { class: 'es-layers' });
    for (let i = scheme.layers.length - 1; i >= 0; i--) {
      const l = scheme.layers[i];
      list.append(h('div', { class: 'es-lrow' + (i === ed.li ? ' on' : ''), onclick: () => { ed.li = i; renderSide(); } },
        h('button', { type: 'button', class: 'ed-iconbtn es-ib', title: t('ed.visible'), 'aria-pressed': String(l.visible), onclick: (ev) => { ev.stopPropagation(); record(t('ed.visible')); l.visible = !l.visible; changed({ layers: true }); } }, iconEl(l.visible ? 'eye' : 'eyeOff')),
        h('button', { type: 'button', class: 'ed-iconbtn es-ib', title: t('ed.lock'), 'aria-pressed': String(l.locked), onclick: (ev) => { ev.stopPropagation(); l.locked = !l.locked; renderSide(); save(); } }, iconEl(l.locked ? 'lock' : 'unlock')),
        h('span', { class: 'es-lname' }, l.name),
        h('small', { class: 'ed-muted' }, layerCount(l))));
    }
    const l = layer();
    const act = (ic, k, fn, dis = false) => { const b = h('button', { type: 'button', class: 'ed-btn', onclick: fn, disabled: dis }, iconEl(ic), t(k)); return b; };
    return h('div', { class: 'es-tab' },
      h('div', { class: 'es-tab-acts es-wrap' },
        act('plus', 'ed.addLayer', () => { record(t('ed.addLayer')); scheme.layers.splice(ed.li + 1, 0, emptyLayer(scheme.width, scheme.height, t('ed.layerN', { n: scheme.layers.length + 1 }))); ed.li++; changed({ layers: true }); }),
        act('copy', 'ed.duplicate', () => { record(t('ed.duplicate')); const c = cloneScheme(scheme).layers[ed.li]; c.id = newId('l'); c.name = l.name + ' ' + t('ed.copySuffix'); scheme.layers.splice(ed.li + 1, 0, c); ed.li++; changed({ layers: true }); }),
        act('edit', 'ed.rename', async () => { const n = await promptDialog(t('ed.rename'), t('ed.layerName'), l.name); if (n) { record(t('ed.rename')); l.name = n; changed({ layers: true }); } }),
        act('up', 'ed.up', () => { if (ed.li >= scheme.layers.length - 1) return; record(t('ed.up')); [scheme.layers[ed.li], scheme.layers[ed.li + 1]] = [scheme.layers[ed.li + 1], scheme.layers[ed.li]]; ed.li++; changed({ layers: true }); }, ed.li >= scheme.layers.length - 1),
        act('down', 'ed.down', () => { if (ed.li <= 0) return; record(t('ed.down')); [scheme.layers[ed.li], scheme.layers[ed.li - 1]] = [scheme.layers[ed.li - 1], scheme.layers[ed.li]]; ed.li--; changed({ layers: true }); }, ed.li <= 0),
        act('stack', 'ed.mergeDown', () => mergeDown(), ed.li <= 0),
        act('trash', 'ed.deleteLayer', async () => { if (scheme.layers.length < 2) return; if (await confirmDialog(t('ed.deleteLayer'), t('ed.deleteLayerQ', { name: l.name }), t('ed.delete'), true)) { record(t('ed.deleteLayer')); scheme.layers.splice(ed.li, 1); ed.li = Math.max(0, ed.li - 1); changed({ layers: true }); } }, scheme.layers.length < 2)),
      list, h('p', { class: 'ed-hint' }, t('ed.layersHint')));
  }
  const layerCount = (l) => { let n = 0; for (const v of l.cells) if (v) n++; return t('ed.layerInfo', { n: n + l.parts.length, lines: l.lines.length }); };
  function mergeDown() {
    if (ed.li <= 0) return;
    record(t('ed.mergeDown'));
    const top = scheme.layers[ed.li], below = scheme.layers[ed.li - 1];
    const tmp = { ...scheme, layers: [below, top] };
    const merged = flatten(tmp, { onlyVisible: false });
    Object.assign(below, { cells: merged.cells, parts: merged.parts, lines: merged.lines, knots: merged.knots, beads: merged.beads });
    scheme.layers.splice(ed.li, 1);
    ed.li--;
    changed({ layers: true });
  }
  function chartTab() {
    const m = scheme.meta;
    const field = (k, label, el) => h('label', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t(label)), el);
    const text = (k, multi = false) => {
      const el = h(multi ? 'textarea' : 'input', { class: 'ed-input' + (multi ? ' ed-textarea' : ''), value: m[k] || '', rows: multi ? 4 : null });
      el.addEventListener('change', () => { record(t('ed.props')); m[k] = el.value; if (k === 'title') titleEl.textContent = el.value || t('es.untitled'); changed(); });
      return el;
    };
    const tags = h('input', { class: 'ed-input', value: m.tags.join(', '), placeholder: t('ed.tagsPh') });
    tags.addEventListener('change', () => { record(t('ed.props')); m.tags = tags.value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 30); changed(); });
    const S = stats(scheme, flat);
    const w = h('input', { type: 'number', class: 'ed-input', min: 1, max: 2000, value: scheme.width });
    const hh = h('input', { type: 'number', class: 'ed-input', min: 1, max: 2000, value: scheme.height });
    let anchor = 'c';
    const fab = scheme.fabric;
    const fabColor = h('input', { type: 'color', class: 'ap-color', value: fab.color });
    fabColor.addEventListener('change', () => { record(t('ed.props')); fab.color = fabColor.value; changed(); view.redraw(); });
    return h('div', { class: 'es-tab es-props' },
      field('title', 'ed.titleF', text('title')),
      field('designer', 'ed.designer', text('designer')),
      field('description', 'ed.description', text('description', true)),
      h('div', { class: 'ed-grid2' },
        field('category', 'ed.category', select(CATEGORIES.map((c) => ({ v: c, l: 'cat.' + c })), m.category || 'other', (v) => { record(t('ed.props')); m.category = v; changed(); })),
        field('difficulty', 'es.difficulty', select([{ v: 0, l: '=' + t('ed.auto', { n: S.difficulty }) }, ...[1, 2, 3, 4, 5].map((v) => ({ v, l: 'diff.' + v }))], m.difficulty || 0, (v) => { record(t('ed.props')); m.difficulty = +v; changed(); }))),
      field('tags', 'ed.tags', tags),
      field('license', 'ed.license', text('license')),
      h('h3', { class: 'es-subh' }, t('ed.fabric')),
      h('div', { class: 'ed-grid2' },
        field('kind', 'ed.fabricKind', select(FABRICS.map((k) => ({ v: k, l: 'fabric.' + k })), fab.kind, (v) => { record(t('ed.props')); fab.kind = v; fab.over = v === 'evenweave' || v === 'linen' ? 2 : 1; changed(); })),
        field('count', 'ed.fabricCount', select([6, 8, 10, 11, 14, 16, 18, 20, 22, 25, 28, 32, 36, 40].map((v) => ({ v, l: '=' + v })), fab.count, (v) => { record(t('ed.props')); fab.count = +v; fab.countY = +v; changed(); }))),
      field('color', 'ed.fabricColor', fabColor),
      h('h3', { class: 'es-subh' }, t('ed.size')),
      h('div', { class: 'ed-grid2' }, field('w', 'new.width', w), field('h', 'new.height', hh)),
      h('div', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('ed.anchor')), seg([{ v: 'tl', l: '=↖' }, { v: 'c', l: '=•' }, { v: 'br', l: '=↘' }], anchor, (v) => { anchor = v; })),
      h('div', { class: 'es-tab-acts es-wrap' },
        h('button', { type: 'button', class: 'ed-btn', onclick: () => {
          const W = Math.max(1, Math.min(2000, +w.value || scheme.width)), H = Math.max(1, Math.min(2000, +hh.value || scheme.height));
          const dx = anchor === 'tl' ? 0 : anchor === 'br' ? W - scheme.width : Math.floor((W - scheme.width) / 2);
          const dy = anchor === 'tl' ? 0 : anchor === 'br' ? H - scheme.height : Math.floor((H - scheme.height) / 2);
          record(t('ed.resize')); scheme = { ...resizeCanvas(scheme, W, H, dx, dy), id }; view.setScheme(scheme); changed({ layers: true });
        } }, iconEl('crop'), t('ed.resize')),
        h('button', { type: 'button', class: 'ed-btn', onclick: () => { const b = bounds(scheme); if (!b) return; record(t('ed.cropContent')); scheme = { ...crop(scheme, { x0: Math.max(0, b.x0 - 2), y0: Math.max(0, b.y0 - 2), x1: Math.min(scheme.width, b.x1 + 2), y1: Math.min(scheme.height, b.y1 + 2) }), id }; view.setScheme(scheme); changed({ layers: true }); } }, iconEl('crop'), t('ed.cropContent')),
        ...[['fx', 'ed.flipChartH'], ['fy', 'ed.flipChartV'], ['r90', 'ed.rotateChart']].map(([op, k]) => h('button', { type: 'button', class: 'ed-btn', onclick: () => { record(t(k)); scheme = { ...transform(scheme, op), id }; view.setScheme(scheme); changed({ layers: true }); } }, iconEl(op === 'r90' ? 'rotate' : 'flip'), t(k)))),
      h('h3', { class: 'es-subh' }, t('ed.cleanup')),
      h('div', { class: 'es-tab-acts es-wrap' },
        h('button', { type: 'button', class: 'ed-btn', onclick: () => { if (!editable()) return; record(t('ed.smooth')); const n = smoothEdges(scheme, ed.li, -1); changed(); toast(t('ed.smoothDone', { n }), 'ok'); } }, iconEl('st_smooth'), t('ed.smooth')),
        h('button', { type: 'button', class: 'ed-btn', onclick: () => confetti() }, iconEl('sparkle'), t('ed.confetti'))),
      h('p', { class: 'ed-hint' }, t('ed.statsLine', { s: Math.round(S.stitches), c: S.colors, d: S.difficulty, conf: (S.confetti * 100).toFixed(1) })));
  }
  // Confetti = isolated single stitches: tedious to stitch (a thread start and end for one cross). cleanupGrid merges
  // them into the most similar neighbouring colour (Lab distance).
  function confetti() {
    if (!editable()) return;
    record(t('ed.confetti'));
    const l = layer();
    const grid = Int16Array.from(l.cells, (v) => v - 1);
    const pal = scheme.palette.map((e) => ({ lab: rgbToLab(hexToRgb(e.hex)) }));
    const n = cleanupGrid(grid, scheme.width, scheme.height, pal, 1, 0);
    for (let i = 0; i < grid.length; i++) l.cells[i] = grid[i] + 1;
    changed();
    toast(t('ed.confettiDone', { n }), 'ok');
  }

  function onHover(c) {
    status.textContent = '';
    if (!c) return;
    const v = flat.cells[c.y * scheme.width + c.x];
    const e = v ? scheme.palette[v - 1] : null;
    status.append(h('span', {}, t('view.cell', { x: c.x + 1, y: c.y + 1 })), e ? h('span', { class: 'es-st-c' }, symbolSwatch(e, { size: 'xs' }), entryLabel(e), e.name ? ' · ' + e.name : '') : null,
      ed.selection ? h('span', {}, t('ed.selSize', { w: ed.selection.x1 - ed.selection.x0, h: ed.selection.y1 - ed.selection.y0 })) : null,
      h('span', { class: 'ed-muted' }, t('ed.layerOf', { name: layer().name })));
  }

  function exportMenu(anchor) {
    openMenu(anchor, [
      { label: t('dl.pdf'), icon: 'file', action: () => pdfDialog(scheme) },
      { label: t('dl.oxs'), icon: 'export', action: () => exportScheme(scheme, 'oxs') },
      { label: t('dl.json'), icon: 'save', action: () => exportScheme(scheme, 'json') },
      { label: t('dl.png'), icon: 'image', action: () => exportScheme(scheme, 'png') },
      { label: t('dl.svg'), icon: 'image', action: () => exportScheme(scheme, 'svg') },
      { sep: true },
      { label: t('sch.print'), icon: 'print', action: () => printScheme(scheme) },
    ]);
  }

  // Context menu on the chart.
  const detachCtx = contextMenu(host, (target, info) => {
    const c = view.cellAtClient(info.x, info.y);
    const inSel = ed.selection && c.x >= ed.selection.x0 && c.x < ed.selection.x1 && c.y >= ed.selection.y0 && c.y < ed.selection.y1;
    const v = c.x >= 0 && c.y >= 0 && c.x < scheme.width && c.y < scheme.height ? flat.cells[c.y * scheme.width + c.x] : 0;
    return [
      inSel ? { label: t('ed.copy'), icon: 'copy', kbd: 'Ctrl+C', action: copySel } : null,
      inSel ? { label: t('ed.cut'), icon: 'scissors', kbd: 'Ctrl+X', action: cutSel } : null,
      clipboard ? { label: t('ed.paste'), icon: 'paste', kbd: 'Ctrl+V', action: () => paste() } : null,
      inSel ? { label: t('ed.delete'), icon: 'trash', kbd: 'Del', action: deleteSel } : null,
      inSel ? { label: t('ed.flipH'), icon: 'flip', action: () => transformSel('fx') } : null,
      inSel ? { label: t('ed.rotate'), icon: 'rotate', action: () => transformSel('r90') } : null,
      { sep: true },
      v ? { label: t('ed.pickHere'), icon: 'st_pick', action: () => { ed.color = v - 1; renderSide(); } } : null,
      v ? { label: t('ed.selectColor'), icon: 'st_select', action: () => selectColor(v - 1) } : null,
      v ? { label: t('ed.replaceAll'), icon: 'replace', action: () => replaceColor(v - 1) } : null,
    ];
  }, { label: t('ed.ctx') });

  // Ignored in fields and dialogs. [ / ] cycle the current colour; Enter / Escape place or cancel a floating paste.
  function onKey(e) {
    if (e.target.closest && e.target.closest('input, textarea, select, .ed-dialog')) return;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k === 'c') { if (ed.selection) { e.preventDefault(); copySel(); } return; }
    if (mod && k === 'x') { if (ed.selection) { e.preventDefault(); cutSel(); } return; }
    if (mod && k === 'v') { if (clipboard) { e.preventDefault(); paste(); } return; }
    if (mod && k === 'a') { e.preventDefault(); setTool('select'); ed.selection = { x0: 0, y0: 0, x1: scheme.width, y1: scheme.height }; renderToolOpts(); view.redraw(); return; }
    if (mod || e.altKey) return;
    if (k === 'escape') { if (ed.floating) dropFloating(false); else { ed.selection = null; ed.highlight = -1; renderToolOpts(); view.redraw(); } e.preventDefault(); return; }
    if (k === 'enter' && ed.floating) { dropFloating(true); e.preventDefault(); return; }
    if ((k === 'delete' || k === 'backspace') && ed.selection) { e.preventDefault(); deleteSel(); return; }
    if (k === '[' || k === ']') { const n = scheme.palette.length; if (n) { ed.color = (ed.color + (k === ']' ? 1 : -1) + n) % n; renderSide(); } e.preventDefault(); return; }
    if (k === 'g') { setSettings({ grid: !settings().grid }); view.redraw(); return; }
    const tool = TOOLS.find((x) => x[2].toLowerCase() === k);
    if (tool) { e.preventDefault(); setTool(tool[0]); }
  }
  window.addEventListener('keydown', onKey);
  setTool('full');
  renderSide();
  renderSaved();
  return {
    full: true,
    // Unsaved changes are saved immediately on leave (the debounced save is cancelled first so it
    // cannot fire against a destroyed screen).
    destroy() {
      window.removeEventListener('keydown', onKey);
      detachCtx();
      if (saveState !== 'saved') { save.cancel(); saveMine(scheme, { origin: 'new' }).catch(() => {}); }
      view.destroy();
      overview.destroy();
    },
  };
}

// Text in a system font (any script), rasterized at `size` stitches tall and thresholded.
// Text in any installed font: rendered on a canvas at `size` px = stitches, then thresholded on alpha (> 110 of 255,
// slightly below half so thin strokes survive) into a 1-bit stitch bitmap.
function systemTextClip(text, family, size, bold, p) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = `${bold ? 700 : 400} ${size}px ${family}`;
  g.font = font;
  const lines = String(text).split('\n');
  const w = Math.max(1, Math.ceil(Math.max(...lines.map((l) => g.measureText(l).width))) + 2);
  const lh = Math.ceil(size * 1.25);
  c.width = w; c.height = lh * lines.length;
  g.font = font;
  g.fillStyle = '#000';
  g.textBaseline = 'top';
  lines.forEach((l, i) => g.fillText(l, 1, i * lh + Math.round(size * 0.1)));
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const bits = new Uint8Array(c.width * c.height);
  for (let i = 0; i < bits.length; i++) bits[i] = d[i * 4 + 3] > 110 ? 1 : 0;
  return bitmapClip(bits, c.width, c.height, p);
}

export { catalog };
