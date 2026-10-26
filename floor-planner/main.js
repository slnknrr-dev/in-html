// floor-planner/main.js - the plan editor: a stage with the plan in metres (zoom and pan by wheel, pinch, buttons and
// keys), rooms drawn as polygons (grid snap, 15° angle snap, segment lengths typed while drawing) or placed as
// rectangles, the outline of the outer walls, a stencil palette by plan kind (flat, hall, shop), selection (click,
// shift-click, marquee, keyboard), move / rotate / resize handles, vertex editing of polygon rooms, an inspector
// (label, position, size, rotation, seats, sleeping places, room type, edge lengths typed in, colour, layer, lock),
// layers with their objects, pages, undo / redo (plan/history.js), summaries (areas by room type, living and service
// area, seats, sleeping places) and checks (overlaps, narrow aisles, items outside), templates, and exports (SVG at
// 1:N in millimetres with dimensions and a scale bar, PNG, print at scale, JSON save / open / drop).
//
// Architecture:
// - State: `doc` (the saved document), S (UI settings, persisted separately), and transient interaction state (tool,
//   selection, draft polygon, current drag, view rectangle, active pointers). Only `doc` goes into undo history.
// - Mutation discipline: every document change runs inside commit(fn), which snapshots the JSON before, runs fn,
//   and pushes the snapshot only if something actually changed. Undo restores whole snapshots, so no operation needs
//   its own inverse. Live drags mutate a working copy and commit once on release (one undo step per gesture).
// - Rendering: paint() redraws the SVG stage (cheap string build of the page + overlay) on every pointer move;
//   refresh() rebuilds the side panels (inspector, summary, layers...), which is heavier and runs on commits only.
// - Coordinates: the view is a rectangle in metres; screen <-> plan conversion is one scale factor (mpp) plus offset,
//   because the SVG viewBox is set to exactly that rectangle.
import {
  AISLE_DEFAULT, LAYERS, PAPERS, RATIOS, ROOM_TYPES, SERVICE, areaSummary, checkPage, ensurePlanCss, exportSvg, fileOf, fitRatio, fmtArea, fmtLen, fmtNum,
  layerFor, layerName, layerOf, loadDoc, normalizeDoc, normalizeShape, paperArea, planSvg, printContent, printSize, roomDims, roomTypeName, saveDoc, seatSummary,
  shapeName, sleepSummary, startShell, stName, stencil, stencilPreview, svgToPng, DOC_KEY,
} from './common.js';
import { TEMPLATES, emptyDoc } from './templates.js';
import { button, card, download, field, select, t, textInput, toast, toggle } from '../ui/app.js';
import { $$, clamp, debounce, h, isEditable, lsGet, lsSet } from '../ui/dom.js';
import { icon, iconEl } from '../ui/icons.js';
import { confirmDialog, openDialog, openMenu, promptDialog } from '../ui/overlays.js';
import { pickFiles } from '../ui/files.js';
import { contextMenu } from '../ui/contextmenu.js';
import { createHistory } from '../plan/history.js';
import {
  bounds, corners, dist, edgeLengths, edgeMidpoints, fitView, handleAngle, inRect, insertVertex, mm, perimeter, polygonArea, removeVertex, resizeHandle,
  rotatePoint, snap, snapAngle, snapPoint, toPlan,
} from '../plan/geom.js';
import { KINDS, addShape, duplicateShape, isLocked, moveShapes, newId, normalizePage, removeShapes, reorder, visibleShapes } from '../plan/model.js';
import { palette, shapeArea } from '../plan/stencils.js';
import { dimensionsSvg } from '../plan/svg.js';

// ---------------------------------------------------------------------------------------------------------------
// State

const SKEY = 'fp-settings';
const DEF = { pi: 0, step: 0.1, angle: true, dims: false, grid: true, ratio: 100, png: 100, paper: 'A4', orient: 'auto', summary: true, drawKind: 'room', aisle: {}, group: '' };
// Settings merged over defaults; invalid enum values reset below. Kept apart from the document so UI preferences
// (snap step, toggles, export options) never enter undo history or exported files.
const S = { ...DEF, ...(() => { const v = lsGet(SKEY, {}); return v && typeof v === 'object' ? v : {}; })() };
const STEPS = [0, 0.05, 0.1, 0.25, 0.5];
if (!STEPS.includes(S.step)) S.step = 0.1;
if (!RATIOS.includes(S.ratio)) S.ratio = 100;
const saveSettings = debounce(() => lsSet(SKEY, S), 200);

startShell('plan', () => render());
ensurePlanCss();

// First visit: the second template (a ready furnished plan) instead of an empty sheet, so every feature is visible.
let doc = loadDoc(() => TEMPLATES[1].build());
// 200 snapshots: generous for a session, bounded so memory does not grow without limit on big plans.
const H = createHistory({ limit: 200 });
let sel = new Set();
let tool = 'select';                 // select | pan | draw | outline
let draft = null;                    // { pts, hover }
let drag = null;
// view = null until the stage has a size (first animation frame); fit() initialises it.
let view = null;                     // { x, y, w, h } in metres, aspect of the stage
let clip = null;                     // copied shapes
const pointers = new Map();
let spaceDown = false;
const els = {};

const saveSoon = debounce(() => saveDoc(doc), 250);
const page = () => doc.plan.pages[clamp(S.pi, 0, doc.plan.pages.length - 1)];
const setPage = (p) => { doc.plan.pages[clamp(S.pi, 0, doc.plan.pages.length - 1)] = p; };
const byId = (id) => page().shapes.find((s) => s.id === id);
const lockedSet = () => new Set(doc.locked);
// Two kinds of lock: layer locks (plan/model isLocked) and per-shape locks kept in doc.locked.
const isShapeLocked = (sh) => isLocked(page(), sh) || doc.locked.includes(sh.id);
const selected = () => page().shapes.filter((s) => sel.has(s.id));
// Minimum aisle width per plan kind: user override, else the default for flats / halls / shops.
const aisleMin = () => (S.aisle[doc.plan.kind] ?? AISLE_DEFAULT[doc.plan.kind] ?? 0.9);

// Every change of the document goes through commit: the state before it goes to the history.
// Change detection by JSON comparison: costs two serialisations per commit, but makes no-op edits (typing the same
// value, a zero-length drag) free of history noise without per-field bookkeeping.
function commit(fn, { quiet = false } = {}) {
  const before = JSON.stringify(doc);
  fn();
  if (JSON.stringify(doc) === before) return false;
  H.push(JSON.parse(before));
  changed(quiet);
  return true;
}
function changed(quiet) {
  saveSoon();
  // Selection may reference shapes that the change removed; prune it so the inspector never shows ghosts.
  for (const id of [...sel]) if (!byId(id)) sel.delete(id);
  paint();
  if (!quiet) refresh();
}
// History snapshots are re-normalised on the way back in: they are plain JSON, and normalisation restores defaults
// for any field added since (cheap insurance).
function undo() { const prev = H.undo(doc); if (!prev) return; doc = normalizeDoc(prev); afterHistory(); }
function redo() { const next = H.redo(doc); if (!next) return; doc = normalizeDoc(next); afterHistory(); }
function afterHistory() {
  S.pi = clamp(S.pi, 0, doc.plan.pages.length - 1);
  for (const id of [...sel]) if (!byId(id)) sel.delete(id);
  saveSoon(); paint(); refresh();
}

// ---------------------------------------------------------------------------------------------------------------
// Layout

const main = document.getElementById('main');
main.classList.add('fp-edit', 'ap-wide');

function render() {
  main.textContent = '';
  els.toolbar = h('div', { class: 'fp-toolbar ap-card', role: 'toolbar', 'aria-label': t('fp.toolbar') });
  els.pages = h('div', { class: 'fp-pages', role: 'tablist', 'aria-label': t('fp.pages') });
  // role="application": the stage handles its own keys (arrows move, Delete removes...), so screen readers should
  // pass keystrokes through; aria-describedby points at a hidden key reference.
  els.stage = h('div', { class: 'fp-stage', tabindex: '0', role: 'application', 'aria-label': t('fp.stage'), 'aria-describedby': 'fp-keys' });
  els.status = h('div', { class: 'fp-status' });
  els.draw = h('div', { class: 'fp-drawbar' });
  // Polite live region: tool changes, additions and deletions are announced (say()).
  els.live = h('div', { class: 'fp-sr', role: 'status', 'aria-live': 'polite' });
  els.palette = h('div', { class: 'fp-palette' });
  els.layers = h('div', { class: 'fp-layers' });
  els.inspector = h('div', { class: 'fp-insp' });
  els.summary = h('div', { class: 'fp-sum' });
  els.checks = h('div', { class: 'fp-checks' });
  els.plan = h('div', { class: 'ed-fields' });
  els.export = h('div', { class: 'fp-export' });

  const stageCol = h('div', { class: 'fp-center' }, els.pages, h('div', { class: 'fp-stage-wrap' }, els.stage, zoomButtons()), els.draw, els.status,
    h('p', { class: 'fp-sr', id: 'fp-keys' }, t('fp.keysHelp')), els.live);
  // Side cards get grid-area classes so CSS can rearrange them per breakpoint.
  const c = (title, body, cls) => { const x = card(title, body); x.classList.add(cls); return x; };
  main.append(els.toolbar, h('div', { class: 'fp-work' },
    stageCol,
    c('fp.c.selection', els.inspector, 'fp-a-insp'),
    c('fp.c.palette', els.palette, 'fp-a-pal'),
    c('fp.c.summary', h('div', {}, els.summary, els.checks), 'fp-a-sum'),
    c('fp.c.layers', els.layers, 'fp-a-lay'),
    c('fp.c.plan', els.plan, 'fp-a-plan'),
    c('fp.c.export', els.export, 'fp-a-exp')));
  bindStage();
  renderToolbar();
  renderPalette();
  renderExport();
  refresh();
  // The stage has no size until laid out; wait one frame before fitting the view.
  requestAnimationFrame(() => { if (!view) fit(); else paint(); });
}

function refresh() {
  renderToolbarState();
  renderPages();
  renderInspector();
  renderSummary();
  renderLayers();
  renderPlanCard();
  renderDrawBar();
}

// --- toolbar ---------------------------------------------------------------------------------------------------

const ibtn = (label, ic, fn, extra = {}) => h('button', { type: 'button', class: 'ed-btn fp-ib', title: label, 'aria-label': label, onclick: fn, ...extra }, iconEl(ic));

function renderToolbar() {
  const tb = els.toolbar;
  tb.textContent = '';
  const tbtn = (label, ic, fn, cls = '') => { const b = button(label, ic, fn); b.classList.add('fp-tb', ...(cls ? [cls] : [])); return b; };
  els.undo = ibtn(t('fp.undo') + ' (Ctrl+Z)', 'undo', undo);
  els.redo = ibtn(t('fp.redo') + ' (Ctrl+Y)', 'redo', redo);
  // Tool switch as a radiogroup with roving tabindex and arrow keys; single-letter shortcuts are bound on the stage.
  const tools = h('div', { class: 'ed-seg fp-tools', role: 'radiogroup', 'aria-label': t('fp.tool') },
    [['select', 'cursor', 'V'], ['pan', 'hand', 'H'], ['draw', 'pen', 'P'], ['outline', 'ruler', 'O']].map(([k, ic, key]) => h('button', {
      type: 'button', role: 'radio', class: 'ed-seg-btn', dataset: { tool: k }, title: `${t('fp.tool.' + k)} (${key})`, 'aria-label': t('fp.tool.' + k),
      onclick: () => setTool(k),
    }, iconEl(ic), h('span', { class: 'fp-tl' }, t('fp.tool.' + k)))));
  tools.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    const b = [...tools.children], i = b.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const n = b[(i + step + b.length) % b.length]; n.focus(); n.click();
  });
  els.tools = tools;
  const step = select(STEPS.map((v) => ({ v, l: v ? `=${Math.round(v * 100)} ${t('fp.u.cm')}` : 'fp.snapOff' })), S.step, (v) => { S.step = +v; saveSettings(); });
  step.setAttribute('aria-label', t('fp.snap'));
  step.title = t('fp.snap');
  step.classList.add('fp-step');
  const tg = (key, ic, label) => {
    // Toggles reflect state in aria-pressed (CSS styles .fp-tg[aria-pressed=true]).
    const b = h('button', { type: 'button', class: 'ed-btn fp-ib fp-tg', title: label, 'aria-label': label, 'aria-pressed': String(!!S[key]), onclick: () => {
      S[key] = !S[key]; b.setAttribute('aria-pressed', String(S[key])); saveSettings(); paint();
    } }, iconEl(ic));
    return b;
  };
  tb.append(
    tbtn('fp.templates', 'template', openTemplates, 'ed-primary'),
    ibtn(t('fp.open'), 'folder', openFile),
    ibtn(t('fp.saveJson'), 'save', saveJson),
    h('span', { class: 'fp-sep' }), els.undo, els.redo,
    h('span', { class: 'fp-sep' }), tools,
    h('span', { class: 'fp-sep' }), h('span', { class: 'fp-snap' }, iconEl('magnet'), step),
    tg('angle', 'angle', t('fp.angleSnap')), tg('dims', 'ruler', t('fp.showDims')), tg('grid', 'grid', t('fp.showGrid')));
}
function renderToolbarState() {
  if (!els.undo) return;
  els.undo.disabled = !H.canUndo;
  els.redo.disabled = !H.canRedo;
  for (const b of els.tools.children) { const on = b.dataset.tool === tool; b.classList.toggle('ed-on', on); b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; }
}
function zoomButtons() {
  return h('div', { class: 'fp-zoom' },
    // Zoom factor 1.25 per step; zoomBy takes the view-size factor, so < 1 zooms in.
    ibtn(t('fp.zoomIn'), 'zoomIn', () => zoomBy(1 / 1.25)),
    ibtn(t('fp.fit'), 'fit', fit),
    ibtn(t('fp.zoomOut'), 'zoomOut', () => zoomBy(1.25)));
}

function setTool(k) {
  if (tool === k) return;
  tool = k;
  // Drawing tools start a fresh draft and clear the selection (handles would compete with vertex clicks).
  draft = k === 'draw' || k === 'outline' ? { pts: [], hover: null } : null;
  if (draft) sel.clear();
  els.stage.dataset.tool = k;
  renderToolbarState(); renderDrawBar(); renderInspector(); paint();
  say(t('fp.tool.' + k));
}

// --- pages -----------------------------------------------------------------------------------------------------

function renderPages() {
  const box = els.pages;
  box.textContent = '';
  doc.plan.pages.forEach((p, i) => {
    const on = i === S.pi;
    // Double-click renames only the active tab (a first click on another tab just switches to it).
    const b = h('button', { type: 'button', role: 'tab', class: 'fp-tab' + (on ? ' fp-on' : ''), 'aria-selected': String(on), tabindex: on ? '0' : '-1', onclick: () => goPage(i) }, p.name);
    if (on) b.addEventListener('dblclick', renamePage);
    box.append(b);
  });
  box.append(
    h('button', { type: 'button', class: 'fp-tab fp-tab-ic', title: t('fp.page.add'), 'aria-label': t('fp.page.add'), html: icon('plus'), onclick: addPage }),
    h('button', { type: 'button', class: 'fp-tab fp-tab-ic', title: t('fp.page.more'), 'aria-label': t('fp.page.more'), 'aria-haspopup': 'menu', html: icon('more'), onclick: (e) => openMenu(e.currentTarget, [
      { label: t('fp.page.rename'), icon: 'edit', action: renamePage },
      { label: t('fp.page.dup'), icon: 'copy', action: dupPage },
      { label: t('fp.page.del'), icon: 'trash', danger: true, disabled: doc.plan.pages.length < 2, action: delPage },
    ]) }));
}
function goPage(i) { S.pi = i; saveSettings(); sel.clear(); draft = draft ? { pts: [], hover: null } : null; fit(); refresh(); }
function addPage() {
  const cur = page();
  commit(() => {
    const p = normalizePage({ id: newId('p'), name: t('fp.page.n', { n: doc.plan.pages.length + 1 }), w: cur.w, h: cur.h, layers: structuredClone(LAYERS), shapes: [] }, doc.plan.pages.length, doc.plan.kind);
    doc.plan.pages.push(p);
    S.pi = doc.plan.pages.length - 1;
  });
  sel.clear(); fit(); refresh();
}
function dupPage() {
  commit(() => {
    const p = structuredClone(page());
    p.id = newId('p'); p.name = t('fp.page.copy', { name: p.name });
    // Duplicated pages get fresh shape ids: ids must be unique per document (guest tables, locks refer to them).
    for (const s of p.shapes) s.id = newId();
    doc.plan.pages.splice(S.pi + 1, 0, p);
    S.pi++;
  });
  sel.clear(); refresh();
}
async function renamePage() {
  const v = await promptDialog(t('fp.page.rename'), t('fp.page.name'), page().name);
  if (v == null || !String(v).trim()) return;
  commit(() => { page().name = String(v).trim().slice(0, 60); });
}
async function delPage() {
  if (doc.plan.pages.length < 2) return;
  if (!(await confirmDialog(t('fp.page.del'), t('fp.page.delQ', { name: page().name }), t('dlg.delete'), true))) return;
  commit(() => { doc.plan.pages.splice(S.pi, 1); S.pi = Math.max(0, S.pi - 1); });
  sel.clear(); fit(); refresh();
}

// --- palette ---------------------------------------------------------------------------------------------------

function renderPalette() {
  const box = els.palette;
  box.textContent = '';
  const list = palette(doc.plan.kind);
  const groups = [...new Set(list.map((s) => s.group))];
  if (!groups.includes(S.group)) S.group = groups[0];
  const tabs = h('div', { class: 'ed-seg fp-ptabs', role: 'tablist', 'aria-label': t('fp.c.palette') }, groups.map((g) => h('button', {
    type: 'button', role: 'tab', class: 'ed-seg-btn' + (g === S.group ? ' ed-on' : ''), 'aria-selected': String(g === S.group),
    onclick: () => { S.group = g; saveSettings(); renderPalette(); },
  }, t('fp.grp.' + g))));
  const grid = h('div', { class: 'fp-pgrid' }, list.filter((s) => s.group === S.group).map((st) => {
    const b = h('button', { type: 'button', class: 'fp-pitem', dataset: { k: st.key }, title: stName(st.key) },
      h('span', { class: 'fp-pimg', html: stencilPreview(st.key) }), h('span', { class: 'fp-pname' }, stName(st.key)));
    b.addEventListener('pointerdown', (e) => paletteDrag(e, st.key));
    // e.detail === 0 = keyboard activation (Enter / Space): always add at the view centre. A pointer click that ended a
    // drag (_dragged) must not also add a second copy.
    b.addEventListener('click', (e) => { if (e.detail === 0 || !b._dragged) addAt(st.key, viewCentre()); b._dragged = false; });
    return b;
  }));
  box.append(tabs, grid, h('div', { class: 'ed-hint' }, t('fp.paletteHint')));
}

// Drag a stencil from the palette onto the stage (mouse, pen or finger): a ghost follows the pointer.
function paletteDrag(e, key) {
  // Primary button only; the ghost appears after 8px of movement, so a plain click is not mistaken for a drag.
  // Listeners on window (not the button) keep tracking when the pointer leaves the palette.
  if (e.button > 0) return;
  const btn = e.currentTarget, x0 = e.clientX, y0 = e.clientY;
  let ghost = null;
  const move = (ev) => {
    if (!ghost && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 8) return;
    if (!ghost) {
      ghost = h('div', { class: 'fp-ghost', html: stencilPreview(key) });
      document.body.append(ghost);
      btn._dragged = true;
    }
    ghost.style.transform = `translate(${ev.clientX - 24}px, ${ev.clientY - 24}px)`;
    ev.preventDefault();
  };
  const up = (ev) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    if (!ghost) return;
    ghost.remove();
    const r = els.stage.getBoundingClientRect();
    // Dropped only when released over the stage; a drop elsewhere (or pointercancel) just discards the ghost.
    if (ev.type === 'pointerup' && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) addAt(key, s2p([ev.clientX - r.left, ev.clientY - r.top]));
  };
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

function addAt(key, p) {
  const sh = makeShapeAt(key, p);
  commit(() => { setPage(addShape(page(), sh)); });
  sel = new Set([sh.id]);
  if (tool !== 'select') setTool('select');
  refresh(); paint();
  say(t('fp.added', { name: stName(key) }));
}
function makeShapeAt(key, p) {
  const st = stencil(key);
  // Centred on the drop point, snapped to the grid; the layer is chosen by stencil kind.
  const raw = { id: newId(), kind: key, x: snap(p[0] - st.w / 2, S.step), y: snap(p[1] - st.h / 2, S.step), w: st.w, h: st.h, rot: 0, layer: layerFor(page(), key) };
  if (st.seated) raw.seats = st.seats || 0;
  if (st.roomType) raw.roomType = st.roomType;
  if (key === 'text') raw.label = t('fp.st.text');
  return normalizeShape(raw, 0, new Set((page().layers || []).map((l) => l.id)));
}

// ---------------------------------------------------------------------------------------------------------------
// Stage: view, painting, overlay

const stageSize = () => { const r = els.stage.getBoundingClientRect(); return [Math.max(1, r.width), Math.max(1, r.height)]; };
// Uniform scale: the viewBox keeps the stage aspect, so one metres-per-pixel factor serves both axes.
const mpp = () => view.w / stageSize()[0];                         // metres per CSS pixel
const s2p = ([sx, sy]) => [view.x + sx * mpp(), view.y + sy * mpp()];
const viewCentre = () => (view ? [view.x + view.w / 2, view.y + view.h / 2] : [page().w / 2, page().h / 2]);
// The view keeps the stage aspect ratio: only width is free, height follows (clamped 0.5 m .. 2 km wide).
function setView(v) {
  const [W, H2] = stageSize();
  const w = clamp(v.w, 0.5, 2000);
  const cx = v.x + v.w / 2, cy = v.y + (v.h ?? v.w * H2 / W) / 2;
  const hh = w * H2 / W;
  view = { x: cx - w / 2, y: cy - hh / 2, w, h: hh };
}
function fit() {
  if (!els.stage) return;
  const p = page();
  // Fit to the union of page rectangle, outline and every shape (shapes may lie outside the page while editing).
  const b = bounds(p.shapes, [p.outline || [[0, 0], [p.w, p.h]]]) || { x: 0, y: 0, w: p.w, h: p.h };
  const [W, H2] = stageSize();
  const v = fitView({ x: Math.min(b.x, 0), y: Math.min(b.y, 0), w: Math.max(b.x + b.w, p.w) - Math.min(b.x, 0), h: Math.max(b.y + b.h, p.h) - Math.min(b.y, 0) }, W, H2, { margin: 0.04, pad: 0.9 });
  view = { ...v.viewBox };
  paint();
}
// Zoom about a fixed point `at` (the cursor for wheel zoom): that plan point stays under the cursor because the
// view origin moves by the same factor towards it.
function zoomBy(f, at) {
  const c = at || viewCentre();
  const w = clamp(view.w * f, 0.5, 2000);
  const k = w / view.w;
  view = { x: c[0] - (c[0] - view.x) * k, y: c[1] - (c[1] - view.y) * k, w, h: view.h * k };
  paint();
}

// A visible grid: the snap step, coarser when it would be denser than 8 px.
// Candidate steps are "nice" values; the first one that is at least the snap step and at least 8 px on screen.
function gridStep() {
  const base = S.step || 0.1, px = 8 * mpp();
  for (const g of [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50]) if (g >= base - 1e-9 && g >= px) return g;
  return 50;
}

// rAF coalescing: many pointer events per frame produce one repaint; the flag avoids queueing duplicates.
let paintQueued = false;
function paint() {
  if (paintQueued || !els.stage) return;
  paintQueued = true;
  requestAnimationFrame(() => { paintQueued = false; paintNow(); });
}
function paintNow() {
  if (!view) return;
  const p = page();
  // Full innerHTML rebuild per frame: the plan is a few hundred elements and planSvg is a string builder, which is
  // simpler and fast enough versus diffing a live DOM. The viewBox is then set to the current view (in mm units,
  // matching pageSVG's user units).
  let svg = planSvg(p, { grid: S.grid ? gridStep() : 0, sel: [...sel], dims: S.dims, ruler: true, gridId: 'fp-grid', title: p.name });
  const extra = dimsOverlay(p) + overlay(p);
  svg = svg.replace(/<\/svg>$/, extra + '</svg>');
  els.stage.innerHTML = svg;
  const el = els.stage.firstElementChild;
  el.setAttribute('viewBox', [view.x, view.y, view.w, view.h].map((v) => mm(v)).join(' '));
  el.classList.add('fp-svg');
  paintStatus();
}

// Edge lengths: all rooms (toggle) and always the selected shapes.
function dimsOverlay(p) {
  let out = S.dims ? roomDims(p) : '';
  for (const sh of selected()) {
    if (S.dims && stencil(sh.kind).room) continue;
    out += Array.isArray(sh.pts) ? dimensionsSvg(sh.pts.map((q) => toPlan(sh, q)), { size: 0.2, offset: -0.2 }) : stencil(sh.kind).flat ? '' : dimensionsSvg(corners(sh), { size: 0.2, offset: 0.22 });
  }
  return out ? `<g class="fp-dims">${out}</g>` : '';
}

const HANDLES = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };
function overlay(p) {
  // Handle sizes are given in screen pixels and converted to metres (k = metres per pixel), so handles keep their
  // on-screen size at every zoom. Coarse pointers (touch) get larger targets (11 px radius vs 6 px).
  const k = mpp(), touch = matchMedia('(pointer: coarse)').matches;
  const r = (touch ? 11 : 6) * k, sw = mm(1.5 * k);
  let out = '';
  const list = selected();
  for (const sh of list) out += `<polygon class="fp-selbox" points="${corners(sh).map((q) => mm(q[0]) + ',' + mm(q[1])).join(' ')}" stroke-width="${sw}"></polygon>`;
  if (list.length === 1 && tool === 'select' && !isShapeLocked(list[0])) {
    const sh = list[0], st = stencil(sh.kind);
    // Flat items (rugs, lines) resize along their length only; keepRatio stencils (round tables) only by corners.
    const names = st.flat ? ['w', 'e'] : st.keepRatio ? ['nw', 'ne', 'se', 'sw'] : Object.keys(HANDLES);
    const top = toPlan(sh, [sh.w / 2, 0]), rp = toPlan(sh, [sh.w / 2, -(touch ? 40 : 28) * k]);
    out += `<line class="fp-hl" x1="${mm(top[0])}" y1="${mm(top[1])}" x2="${mm(rp[0])}" y2="${mm(rp[1])}" stroke-width="${sw}"></line>`;
    out += `<circle class="fp-h fp-hrot" data-h="rot" cx="${mm(rp[0])}" cy="${mm(rp[1])}" r="${mm(r)}" stroke-width="${sw}"></circle>`;
    // Polygon rooms: vertex handles (drag), edge-midpoint handles (drag to insert a vertex) and box corners (scale).
    if (!Array.isArray(sh.pts)) {
      for (const n of names) { const q = toPlan(sh, [HANDLES[n][0] * sh.w, HANDLES[n][1] * sh.h]); out += `<rect class="fp-h" data-h="${n}" x="${mm(q[0] - r)}" y="${mm(q[1] - r)}" width="${mm(2 * r)}" height="${mm(2 * r)}" stroke-width="${sw}"></rect>`; }
    } else {
      const pts = sh.pts.map((q) => toPlan(sh, q));
      for (const m of edgeMidpoints(pts)) out += `<circle class="fp-h fp-hmid" data-h="m:${m.i}" cx="${mm(m.at[0])}" cy="${mm(m.at[1])}" r="${mm(r * 0.75)}" stroke-width="${sw}"><title>${esc(t('fp.addVertex'))}</title></circle>`;
      pts.forEach((q, i) => { out += `<rect class="fp-h fp-hv" data-h="v:${i}" x="${mm(q[0] - r)}" y="${mm(q[1] - r)}" width="${mm(2 * r)}" height="${mm(2 * r)}" stroke-width="${sw}"><title>${esc(t('fp.vertexHint'))}</title></rect>`; });
      for (const n of ['nw', 'ne', 'se', 'sw']) { const q = toPlan(sh, [HANDLES[n][0] * sh.w, HANDLES[n][1] * sh.h]); out += `<circle class="fp-h fp-hbox" data-h="${n}" cx="${mm(q[0])}" cy="${mm(q[1])}" r="${mm(r * 0.8)}" stroke-width="${sw}"></circle>`; }
    }
  }
  if (drag && drag.type === 'marquee' && drag.moved) {
    const x = Math.min(drag.p0[0], drag.p1[0]), y = Math.min(drag.p0[1], drag.p1[1]);
    out += `<rect class="fp-marq" x="${mm(x)}" y="${mm(y)}" width="${mm(Math.abs(drag.p1[0] - drag.p0[0]))}" height="${mm(Math.abs(drag.p1[1] - drag.p0[1]))}" stroke-width="${sw}"></rect>`;
  }
  if (draft) {
    const pts = draft.hover ? [...draft.pts, draft.hover] : draft.pts;
    if (pts.length) {
      out += `<polyline class="fp-draft" points="${pts.map((q) => mm(q[0]) + ',' + mm(q[1])).join(' ')}" stroke-width="${mm(2 * k)}"></polyline>`;
      if (pts.length >= 3) out += `<line class="fp-draft-close" x1="${mm(pts.at(-1)[0])}" y1="${mm(pts.at(-1)[1])}" x2="${mm(pts[0][0])}" y2="${mm(pts[0][1])}" stroke-width="${mm(k)}"></line>`;
      out += `<circle class="fp-draft-first" cx="${mm(pts[0][0])}" cy="${mm(pts[0][1])}" r="${mm(r * 1.2)}" stroke-width="${sw}"></circle>`;
      if (draft.hover && draft.pts.length) {
        const a = draft.pts.at(-1), b = draft.hover, L = dist(a, b);
        if (L > 1e-6) out += `<text class="fp-draft-len" x="${mm((a[0] + b[0]) / 2)}" y="${mm((a[1] + b[1]) / 2 - 10 * k)}" font-size="${mm(13 * k)}" text-anchor="middle">${esc(fmtLen(L))}</text>`;
      }
    }
    if (draft.hover) out += `<circle class="fp-draft-pt" cx="${mm(draft.hover[0])}" cy="${mm(draft.hover[1])}" r="${mm(4 * k)}"></circle>`;
  }
  return `<g class="fp-ov">${out}</g>`;
}
// Escape for text/attributes inside the overlay SVG string (labels come from translations).
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

let lastPointer = null;
function paintStatus() {
  if (!els.status) return;
  const p = lastPointer;
  // Zoom shown as CSS pixels per metre: a concrete number users can compare (100 px/m = 1 cm per pixel).
  const zoom = Math.round(1 / mpp());               // CSS pixels per metre
  els.status.textContent = '';
  els.status.append(
    h('span', {}, p ? `x ${fmtNum(p[0], 2)} · y ${fmtNum(p[1], 2)} ${t('fp.u.mShort')}` : ' '),
    h('span', {}, t('fp.zoomPx', { n: zoom })),
    h('span', { class: 'fp-status-hint' }, t(tool === 'draw' || tool === 'outline' ? 'fp.hint.draw' : tool === 'pan' ? 'fp.hint.pan' : 'fp.hint.select')));
}
function say(msg) { if (els.live) els.live.textContent = msg; }

// ---------------------------------------------------------------------------------------------------------------
// Pointer input

const xy = (e) => { const r = els.stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

function bindStage() {
  const st = els.stage;
  st.dataset.tool = tool;
  st.addEventListener('pointerdown', onDown);
  st.addEventListener('pointermove', onMove);
  st.addEventListener('pointerup', onUp);
  st.addEventListener('pointercancel', onUp);
  // Leaving the stage hides the draft's rubber-band segment so it does not stick to the edge.
  st.addEventListener('pointerleave', () => { if (!drag && draft) { draft.hover = null; paint(); } lastPointer = null; });
  st.addEventListener('dblclick', onDbl);
  st.addEventListener('wheel', (e) => {
    e.preventDefault();
    // Exponential zoom: equal wheel distance = equal zoom ratio. deltaMode 1 (lines, Firefox) is converted to pixels.
    // passive:false is required to preventDefault the page scroll.
    const f = Math.exp((e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY) * 0.0015);
    zoomBy(f, s2p(xy(e)));
  }, { passive: false });
  // The native context menu is suppressed on empty stage; on shapes the custom menu (contextMenu) takes over.
  st.addEventListener('contextmenu', (e) => { if (!e.target.closest('[data-sh]')) e.preventDefault(); });
  contextMenu(st, (target) => {
    if (tool !== 'select') return null;
    const sh = byId(target.dataset.sh);
    if (!sh) return null;
    if (!sel.has(sh.id)) { sel = new Set([sh.id]); refresh(); paint(); }
    return shapeMenu();
  }, { selector: '[data-sh]', label: t('fp.c.selection') });
  // ResizeObserver keeps the view centred with the right aspect when the stage size changes (layout, rotation).
  new ResizeObserver(() => { if (view) { setView(view); paint(); } else fit(); }).observe(st);
}

// The topmost unlocked, visible shape under the pointer (locked rooms let clicks through to what lies below).
function shapeAt(e) {
  // elementsFromPoint returns every element under the pointer top-down, so a locked shape on top does not block
  // selecting the furniture underneath it.
  for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
    if (!els.stage.contains(el)) continue;
    const g = el.closest('[data-sh]');
    if (!g) continue;
    const sh = byId(g.dataset.sh);
    if (sh && !isShapeLocked(sh)) return sh;
  }
  return null;
}

function onDown(e) {
  // Right button is left to the context menu.
  if (e.button === 2) return;
  els.stage.focus({ preventScroll: true });
  pointers.set(e.pointerId, xy(e));
  // Pointer capture: moves and the release keep arriving even when the pointer leaves the stage mid-drag.
  try { els.stage.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
  // A second finger turns any gesture into a pinch; the first finger's edit is finished (committed) first.
  if (pointers.size === 2) { finishDrag(); startPinch(); return; }
  if (pointers.size > 2) return;
  const s = xy(e), p = s2p(s);
  const base = { s0: s, p0: p, v0: { ...view }, moved: false, id: e.pointerId, touch: e.pointerType !== 'mouse' };
  // Pan: the pan tool, the middle mouse button, or Space held (design-tool convention).
  if (tool === 'pan' || e.button === 1 || spaceDown) { drag = { ...base, type: 'pan' }; return; }
  if (draft) { drag = { ...base, type: 'tap' }; return; }
  const hEl = e.target.closest?.('[data-h]');
  if (hEl && sel.size === 1) { startHandle(hEl.dataset.h, base, e); return; }
  const sh = shapeAt(e);
  if (sh) {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      if (sel.has(sh.id)) sel.delete(sh.id); else sel.add(sh.id);
      drag = null; refresh(); paint(); return;
    }
    const wasSel = sel.has(sh.id);
    if (!wasSel) { sel = new Set([sh.id]); refresh(); }
    // Move drags keep the page as it was at the start (page0) and re-apply the total delta on every move, so snapping
    // never accumulates rounding error; `before` is the JSON for a single undo step.
    drag = { ...base, type: 'move', hit: sh.id, wasSel, ids: [...sel].filter((id) => { const x = byId(id); return x && !isShapeLocked(x); }), page0: structuredClone(page()), before: JSON.stringify(doc) };
    paint();
    return;
  }
  // Empty space: a finger pans (and clears the selection on a tap); a mouse starts a marquee selection.
  drag = base.touch ? { ...base, type: 'pan', clear: true } : { ...base, type: 'marquee', p1: p, add: e.shiftKey, base: new Set(e.shiftKey ? sel : []) };
}

function onMove(e) {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, xy(e));
  const s = xy(e), p = s2p(s);
  lastPointer = p;
  if (drag && drag.type === 'pinch') { pinchMove(); return; }
  if (!drag) {
    if (draft) { draft.hover = draftPoint(p, e.altKey); paint(); } else paintStatus();
    return;
  }
  if (e.pointerId !== drag.id) return;
  // Drag threshold: 3 px for mouse, 8 px for touch (fingers jitter), so clicks and taps are not mistaken for drags.
  const far = Math.hypot(s[0] - drag.s0[0], s[1] - drag.s0[1]) > (drag.touch ? 8 : 3);
  if (!drag.moved && !far) return;
  drag.moved = true;
  // Alt disables snapping for fine placement.
  const step = e.altKey ? 0 : S.step;
  switch (drag.type) {
    case 'tap': drag.type = 'pan'; // fallthrough: a finger moving in draw mode pans
    case 'pan': {
      const k = drag.v0.w / stageSize()[0];
      view = { ...view, x: drag.v0.x - (s[0] - drag.s0[0]) * k, y: drag.v0.y - (s[1] - drag.s0[1]) * k };
      paint(); return;
    }
    case 'move': {
      if (!drag.ids.length) return;
      setPage(moveShapes(drag.page0, drag.ids, p[0] - drag.p0[0], p[1] - drag.p0[1], step));
      paint(); return;
    }
    case 'marquee': {
      drag.p1 = p;
      const r = { x: Math.min(drag.p0[0], p[0]), y: Math.min(drag.p0[1], p[1]), w: Math.abs(p[0] - drag.p0[0]), h: Math.abs(p[1] - drag.p0[1]) };
      const pick = inRect(visibleShapes(page()).filter((x) => !isShapeLocked(x)), r);
      sel = new Set([...drag.base, ...pick.map((x) => x.id)]);
      paint(); return;
    }
    case 'rot': {
      // Rotation snaps to 15 degrees unless Alt is held or angle snap is off; stored in -180..180.
      const sh = handleAngle(drag.sh0, p, e.altKey || !S.angle ? 0 : 15);
      replaceShape({ ...drag.sh0, rot: sh > 180 ? sh - 360 : sh });
      paint(); return;
    }
    case 'resize': resizeMove(p, step, e.shiftKey); paint(); return;
    case 'vertex': {
      const q = snapPoint(p, step);
      const pts = drag.base.map((v, i) => (i === drag.i ? q : v));
      replaceShape(normalizeShape({ ...drag.sh0, x: 0, y: 0, pts }));
      paint(); return;
    }
  }
}

function onUp(e) {
  pointers.delete(e.pointerId);
  if (drag && drag.type === 'pinch') { if (pointers.size < 2) drag = null; return; }
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  drag = null;
  // pointercancel (system gesture, lost capture) reverts a half-done edit instead of committing it.
  if (e.type === 'pointercancel' && d.before && d.moved) { doc = normalizeDoc(JSON.parse(d.before)); paint(); refresh(); return; }
  switch (d.type) {
    case 'tap': if (!d.moved) addDraftPoint(draftPoint(d.p0, e.altKey)); break;
    case 'pan': if (d.clear && !d.moved) { sel.clear(); refresh(); paint(); } break;
    case 'marquee':
      if (!d.moved && !d.add) sel.clear();
      refresh(); paint();
      if (sel.size) say(t('fp.selN', { n: sel.size }));
      break;
    case 'move':
      if (d.moved) endEdit(d);
      else if (d.wasSel && sel.size > 1) { sel = new Set([d.hit]); refresh(); paint(); }
      if (!d.moved) say(shapeName(byId(d.hit) || {}));
      break;
    default: if (d.before) endEdit(d);
  }
}
// The end of a drag edit: the state before the drag goes to the history.
// Same "only if changed" rule as commit(); the doc was already mutated live during the drag.
function endEdit(d) {
  if (JSON.stringify(doc) !== d.before) { H.push(JSON.parse(d.before)); saveSoon(); }
  paint(); refresh();
}
function finishDrag() {
  if (!drag) return;
  const d = drag; drag = null;
  if (d.before && d.moved) endEdit(d);
}

function startPinch() {
  const [a, b] = [...pointers.values()];
  // Pinch keeps the plan point under the initial finger midpoint (m0) under the current midpoint (m1), and scales the
  // view width by the inverse of the finger distance ratio: zoom and pan in one gesture.
  drag = { type: 'pinch', d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, m0: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], v0: { ...view } };
}
function pinchMove() {
  const [a, b] = [...pointers.values()];
  if (!a || !b) return;
  const d1 = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, m1 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const v0 = drag.v0, k0 = v0.w / stageSize()[0];
  const P = [v0.x + drag.m0[0] * k0, v0.y + drag.m0[1] * k0];
  const w = clamp(v0.w * drag.d0 / d1, 0.5, 2000), k = w / stageSize()[0];
  view = { x: P[0] - m1[0] * k, y: P[1] - m1[1] * k, w, h: v0.h * w / v0.w };
  paint();
}

function onDbl(e) {
  const hEl = e.target.closest?.('[data-h^="v:"]');
  if (hEl && sel.size === 1) {
    const sh = byId([...sel][0]), i = +hEl.dataset.h.slice(2);
    // A polygon needs at least 3 vertices; double-clicking a vertex removes it only above that.
    if (!sh || !Array.isArray(sh.pts) || sh.pts.length <= 3) return;
    const pts = sh.pts.map((q) => toPlan(sh, q));
    commit(() => replaceShape(normalizeShape({ ...sh, rot: 0, x: 0, y: 0, pts: removeVertex(pts, i) })));
    return;
  }
  if (draft && draft.pts.length >= 3) { finishDraft(); return; }
  const sh = !draft && shapeAt(e);
  // Double-click on a shape focuses its label field in the inspector (quick rename).
  if (sh && tool === 'select') { sel = new Set([sh.id]); refresh(); requestAnimationFrame(() => els.inspector.querySelector('[data-f="label"]')?.focus()); }
}

function replaceShape(sh) { setPage({ ...page(), shapes: page().shapes.map((s) => (s.id === sh.id ? sh : s)) }); }

// --- handles ---------------------------------------------------------------------------------------------------

// Polygon rooms are edited in plan coordinates: a rotated room is "baked" (points turned, rot 0) first.
function baked(sh) {
  const pts = sh.pts.map((q) => toPlan(sh, q));
  return { sh0: normalizeShape({ ...sh, rot: 0, x: 0, y: 0, pts }), pts };
}

function startHandle(hname, base, e) {
  const sh = byId([...sel][0]);
  if (!sh || isShapeLocked(sh)) return;
  const before = JSON.stringify(doc);
  if (hname === 'rot') { drag = { ...base, type: 'rot', sh0: sh, before }; return; }
  if (hname.startsWith('v:')) {
    const b = baked(sh);
    drag = { ...base, type: 'vertex', i: +hname.slice(2), base: b.pts, sh0: b.sh0, before };
    return;
  }
  if (hname.startsWith('m:')) {
    const b = baked(sh), i = +hname.slice(2);
    // Dragging an edge midpoint inserts a vertex there and immediately continues as a vertex drag (moved: true, so the
    // release commits even without further movement).
    const pts = insertVertex(b.pts, i, null, 0);
    replaceShape(normalizeShape({ ...b.sh0, x: 0, y: 0, pts }));
    drag = { ...base, type: 'vertex', i: i + 1, base: pts, sh0: b.sh0, before, moved: true };
    paint();
    return;
  }
  drag = { ...base, type: 'resize', handle: hname, sh0: sh, before };
  void e;
}

// The point of the shape that a handle keeps in place: the opposite corner or edge.
const anchorOf = (hn, w, hh) => [hn.includes('e') ? 0 : hn.includes('w') ? w : w / 2, hn.includes('s') ? 0 : hn.includes('n') ? hh : hh / 2];

function resizeMove(p, step, ratio) {
  const s0 = drag.sh0, st = stencil(s0.kind);
  // The pointer delta is rotated into the shape's own frame, so dragging the "east" handle of a rotated table still
  // grows it along its own width.
  const d = rotatePoint([p[0] - drag.p0[0], p[1] - drag.p0[1]], -(s0.rot || 0));
  let ns = resizeHandle(s0, drag.handle, d[0], d[1], { step, keepRatio: !!st.keepRatio || ratio, flat: !!st.flat });
  // plan/geom.js keeps the opposite edge only for unrotated shapes: shift the result so the anchor stays put.
  const a0 = toPlan(s0, anchorOf(drag.handle, s0.w, s0.h)), a1 = toPlan(ns, anchorOf(drag.handle, ns.w, ns.h));
  ns = { ...ns, x: mm(ns.x + a0[0] - a1[0]), y: mm(ns.y + a0[1] - a1[1]) };
  // Polygon rooms scale their vertices with the box (points are stored relative to the shape's box).
  if (Array.isArray(s0.pts)) ns.pts = s0.pts.map((q) => [mm(q[0] * ns.w / s0.w), mm(q[1] * ns.h / s0.h)]);
  replaceShape(ns);
}

// --- drawing rooms and the outline ---------------------------------------------------------------------------------

// The next point of a drawing: grid snap, then 15° steps from the last point (Alt: free); the first point closes.
function draftPoint(p, free) {
  const pts = draft.pts, k = mpp();
  // Closing snap: within 12 screen pixels of the first point the draft snaps to it (pixel-based, zoom-independent).
  if (pts.length >= 3 && dist(p, pts[0]) < 12 * k) return pts[0].slice();
  if (!pts.length || !S.angle || free) return snapPoint(p, free ? 0 : S.step);
  const last = pts.at(-1);
  // Angle snap: direction rounded to 15 degrees, then the length along that direction snapped to the grid step, so
  // walls come out at exact angles and round lengths.
  const ang = snapAngle(Math.atan2(p[1] - last[1], p[0] - last[0]) * 180 / Math.PI, 15) * Math.PI / 180;
  const along = (p[0] - last[0]) * Math.cos(ang) + (p[1] - last[1]) * Math.sin(ang);
  const len = Math.max(0, snap(along, S.step));
  return [mm(last[0] + Math.cos(ang) * len), mm(last[1] + Math.sin(ang) * len)];
}
function addDraftPoint(q) {
  const pts = draft.pts;
  // Clicking the first point again (after snapping) finishes the polygon; a repeated identical point is ignored.
  if (pts.length >= 3 && dist(q, pts[0]) < 1e-6) { finishDraft(); return; }
  if (pts.length && dist(q, pts.at(-1)) < 1e-6) return;
  pts.push(q);
  draft.hover = q;
  renderDrawBar(); paint();
}
// A segment of a typed length in the direction of the pointer (snapped to 15° when the angle snap is on).
function addTypedSegment(L) {
  const pts = draft.pts;
  if (!(L > 0) || !pts.length) return false;
  // Without a hover direction the typed segment goes along +x (east).
  const last = pts.at(-1), to = draft.hover && dist(draft.hover, last) > 1e-6 ? draft.hover : [last[0] + 1, last[1]];
  let ang = Math.atan2(to[1] - last[1], to[0] - last[0]) * 180 / Math.PI;
  if (S.angle) ang = snapAngle(ang, 15);
  const a = ang * Math.PI / 180;
  addDraftPoint([mm(last[0] + Math.cos(a) * L), mm(last[1] + Math.sin(a) * L)]);
  return true;
}
function finishDraft() {
  const pts = draft.pts;
  // Degenerate polygons (fewer than 3 points or under 0.01 m²) are rejected with a message, not silently dropped.
  if (pts.length < 3 || polygonArea(pts) < 0.01) { toast(t('fp.draw.tooFew'), 'warn'); return; }
  if (tool === 'outline') {
    commit(() => {
      const p = page();
      const b = bounds([], [pts]);
      // The outline may extend the page: the page grows to contain it.
      setPage({ ...p, outline: pts.map((q) => q.slice()), w: mm(Math.max(p.w, b.x + b.w)), h: mm(Math.max(p.h, b.y + b.h)) });
    });
    toast(t('fp.draw.outlineDone', { a: fmtArea(polygonArea(pts)) }), 'ok');
    draft = { pts: [], hover: null };
    setTool('select');
    return;
  }
  const kind = S.drawKind in STENCIL_ROOMS ? S.drawKind : 'room';
  const sh = normalizeShape({ id: newId('rm'), kind, x: 0, y: 0, w: 1, h: 1, pts, label: '', roomType: STENCIL_ROOMS[kind], layer: layerFor(page(), kind) }, 0, new Set((page().layers || []).map((l) => l.id)));
  commit(() => setPage(addShape(page(), sh)));
  sel = new Set([sh.id]);
  draft = { pts: [], hover: null };
  toast(t('fp.draw.roomDone', { a: fmtArea(polygonArea(pts)) }), 'ok');
  refresh(); paint();
}
const STENCIL_ROOMS = { room: 'room', bedroom: 'bedroom', kitchen: 'kitchen', bath: 'bath', hallway: 'hallway', balcony: 'balcony', storage: 'storage' };

function renderDrawBar() {
  const box = els.draw;
  if (!box) return;
  box.textContent = '';
  box.hidden = !draft;
  if (!draft) return;
  const n = draft.pts.length;
  const len = h('input', { type: 'number', class: 'ed-input fp-len', min: '0', step: '0.01', inputmode: 'decimal', placeholder: t('fp.draw.lenPh'), 'aria-label': t('fp.draw.len') });
  len.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = parseFloat(String(len.value).replace(',', '.'));
      // Typing lengths: Enter adds a segment of that length; Enter on an empty field finishes the room (CAD habit).
      if (v > 0) { if (addTypedSegment(v)) { len.value = ''; requestAnimationFrame(() => box.querySelector('.fp-len')?.focus()); } }
      else if (n >= 3) finishDraft();
    } else if (e.key === 'Escape') { e.preventDefault(); cancelDraft(); }
  });
  len.disabled = !n;
  const kinds = tool === 'draw' ? select(ROOM_TYPES.map((k) => ({ v: k, l: '=' + stName(k) })), S.drawKind, (v) => { S.drawKind = v; saveSettings(); }) : null;
  if (kinds) kinds.setAttribute('aria-label', t('fp.draw.kind'));
  const fin = button('fp.draw.finish', 'check', finishDraft, 'primary'); fin.classList.add('ed-sm'); fin.disabled = n < 3;
  const back = button('fp.draw.back', 'undo', () => { draft.pts.pop(); renderDrawBar(); paint(); }); back.classList.add('ed-sm'); back.disabled = !n;
  const cancel = button('dlg.cancel', 'close', cancelDraft); cancel.classList.add('ed-sm');
  box.append(...[h('span', { class: 'fp-draw-t' }, iconEl(tool === 'draw' ? 'pen' : 'ruler'), t(tool === 'draw' ? 'fp.draw.room' : 'fp.draw.outline'), ' · ', t('fp.draw.points', { n })),
    kinds, h('label', { class: 'fp-lenwrap' }, len, h('span', {}, t('fp.u.mShort'))), back, fin, cancel,
    tool === 'outline' && page().outline ? (() => { const b = button('fp.draw.removeOutline', 'trash', () => { commit(() => { const p = { ...page() }; delete p.outline; setPage(p); }); renderDrawBar(); }); b.classList.add('ed-sm'); return b; })() : null].filter(Boolean));
}
function cancelDraft() { draft = { pts: [], hover: null }; setTool('select'); }

// ---------------------------------------------------------------------------------------------------------------
// Editing operations

function deleteSel() {
  const ids = selected().filter((s) => !isShapeLocked(s)).map((s) => s.id);
  if (!ids.length) return;
  commit(() => { setPage(removeShapes(page(), ids)); doc.locked = doc.locked.filter((x) => !ids.includes(x)); });
  sel.clear(); refresh();
  say(t('fp.deleted', { n: ids.length }));
}
function duplicateSel() {
  const ids = [...sel];
  if (!ids.length) return;
  const fresh = [];
  commit(() => {
    let p = page();
    // Fixed new id captured per copy so the new selection can be set after the commit.
    for (const id of ids) { const id2 = newId(); p = duplicateShape(p, id, { offset: Math.max(S.step, 0.2) * 2, newIdFn: () => id2 }); fresh.push(id2); }
    setPage(p);
  });
  sel = new Set(fresh); refresh(); paint();
}
function nudge(dx, dy) {
  const ids = selected().filter((s) => !isShapeLocked(s)).map((s) => s.id);
  if (!ids.length) return;
  // quiet: arrow-key nudges repaint only the inspector, not every panel (auto-repeat fires many times per second).
  commit(() => setPage(moveShapes(page(), ids, dx, dy, 0)), { quiet: true });
  renderInspector();
}
function rotateSel(by) {
  const list = selected().filter((s) => !isShapeLocked(s));
  if (!list.length) return;
  commit(() => { for (const s of list) replaceShape({ ...s, rot: normRot((s.rot || 0) + by) }); });
}
// Rotation normalised to -180..180 with 0.1 degree resolution (floating noise from repeated steps is rounded off).
const normRot = (r) => { const a = ((Math.round(r * 10) / 10) % 360 + 360) % 360; return a > 180 ? a - 360 : a; };
function order(where) { commit(() => { let p = page(); for (const id of [...sel]) p = reorder(p, id, where); setPage(p); }); }
function toggleLock() {
  const ids = [...sel];
  if (!ids.length) return;
  const all = ids.every((id) => doc.locked.includes(id));
  commit(() => { doc.locked = all ? doc.locked.filter((x) => !ids.includes(x)) : [...new Set([...doc.locked, ...ids])]; });
  say(t(all ? 'fp.unlocked' : 'fp.locked'));
}
function copySel() { clip = selected().map((s) => structuredClone(s)); if (clip.length) say(t('fp.copied', { n: clip.length })); }
function pasteClip() {
  if (!clip || !clip.length) return;
  const ids = new Set((page().layers || []).map((l) => l.id));
  // Paste offsets by 0.4 m so the copy is visibly separate; the clipboard is replaced by the pasted copies, so
  // repeated pastes cascade instead of stacking at one spot.
  const fresh = clip.map((s) => normalizeShape({ ...s, id: newId(), x: s.x + 0.4, y: s.y + 0.4, layer: ids.has(s.layer) ? s.layer : layerFor(page(), s.kind) }, 0, ids));
  clip = fresh.map((s) => structuredClone(s));
  commit(() => { let p = page(); for (const s of fresh) p = addShape(p, s); setPage(p); });
  sel = new Set(fresh.map((s) => s.id)); refresh(); paint();
}

function shapeMenu() {
  const locked = [...sel].every((id) => doc.locked.includes(id));
  return [
    { label: t('fp.act.dup'), icon: 'dup', kbd: 'Ctrl+D', action: duplicateSel },
    { label: t('fp.act.rotate'), icon: 'rotate', kbd: 'R', action: () => rotateSel(S.angle ? 15 : 90) },
    { label: t('fp.act.front'), icon: 'up', kbd: ']', action: () => order('front') },
    { label: t('fp.act.back'), icon: 'down', kbd: '[', action: () => order('back') },
    { label: t(locked ? 'fp.act.unlock' : 'fp.act.lock'), icon: locked ? 'unlock' : 'lock', kbd: 'L', action: toggleLock },
    { sep: true },
    { label: t('fp.act.delete'), icon: 'trash', kbd: 'Del', danger: true, action: deleteSel },
  ];
}

// --- keyboard --------------------------------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  // Space = temporary pan (held), except when typing or on buttons where Space activates the control.
  if (e.key === ' ' && !isEditable(e.target) && !e.target.closest?.('button, a, select')) { spaceDown = true; if (e.target === els.stage) e.preventDefault(); }
  // No shortcuts while typing or while a dialog or menu is open.
  if (isEditable(e.target) || document.querySelector('.ed-backdrop, .ed-menu-pop')) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key;
  // Single-key shortcuts only when focus is on the stage or the page body (or lists that act on the plan), so
  // letters typed elsewhere never trigger tools.
  const inStage = e.target === els.stage || e.target === document.body || !!e.target.closest?.('.fp-objs, .fp-pgrid, .fp-chips, .fp-table, .fp-wlist');
  if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && (k === 'y' || k === 'Y')) { e.preventDefault(); redo(); return; }
  if (mod && (k === 'd' || k === 'D')) { e.preventDefault(); duplicateSel(); return; }
  if (mod && (k === 's' || k === 'S')) { e.preventDefault(); saveJson(); return; }
  if (mod && (k === 'o' || k === 'O')) { e.preventDefault(); openFile(); return; }
  if (!inStage) return;
  if (mod && (k === 'a' || k === 'A')) { e.preventDefault(); sel = new Set(visibleShapes(page()).filter((s) => !isShapeLocked(s)).map((s) => s.id)); refresh(); paint(); return; }
  if (mod && (k === 'c' || k === 'C')) { copySel(); return; }
  if (mod && (k === 'v' || k === 'V')) { e.preventDefault(); pasteClip(); return; }
  if (mod) return;
  if (draft) {
    if (k === 'Escape') { e.preventDefault(); if (draft.pts.length) { draft.pts = []; renderDrawBar(); paint(); } else cancelDraft(); return; }
    if (k === 'Enter') { e.preventDefault(); finishDraft(); return; }
    if (k === 'Backspace') { e.preventDefault(); draft.pts.pop(); renderDrawBar(); paint(); return; }
    // A digit while drawing jumps into the length field: typing "3.5 Enter" draws a 3.5 m wall.
    if (/^[0-9]$/.test(k) && draft.pts.length) { const inp = els.draw.querySelector('.fp-len'); if (inp) { inp.focus(); } return; }
  }
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
  if (arrows && sel.size) {
    e.preventDefault();
    // Nudge: one snap step (or 1 cm with Alt), x10 with Shift.
    const d = (e.altKey ? 0.01 : S.step || 0.05) * (e.shiftKey ? 10 : 1);
    nudge(arrows[0] * d, arrows[1] * d);
    return;
  }
  // Arrows without a selection pan the view by 40 screen pixels.
  if (arrows) { e.preventDefault(); const k2 = 40 * mpp(); view = { ...view, x: view.x + arrows[0] * k2, y: view.y + arrows[1] * k2 }; paint(); return; }
  switch (k) {
    case 'Delete': case 'Backspace': e.preventDefault(); deleteSel(); break;
    case 'Escape': if (sel.size) { sel.clear(); refresh(); paint(); } break;
    case 'r': case 'R': rotateSel((e.shiftKey ? -1 : 1) * (S.angle ? 15 : 90)); break;
    case 'l': case 'L': toggleLock(); break;
    case ']': order('front'); break;
    case '[': order('back'); break;
    case '+': case '=': zoomBy(1 / 1.25); break;
    case '-': case '_': zoomBy(1.25); break;
    case '0': fit(); break;
    case 'v': case 'V': setTool('select'); break;
    case 'h': case 'H': setTool('pan'); break;
    case 'p': case 'P': setTool('draw'); break;
    case 'o': case 'O': setTool('outline'); break;
    case 'Tab': break;
    case 'n': case 'N': cycleSel(e.shiftKey ? -1 : 1); break;
    default: return;
  }
});
window.addEventListener('keyup', (e) => { if (e.key === ' ') spaceDown = false; });

// N / Shift+N walk through the objects of the page (keyboard selection).
function cycleSel(dir) {
  const list = visibleShapes(page()).filter((s) => !isShapeLocked(s));
  if (!list.length) return;
  const cur = list.findIndex((s) => sel.has(s.id));
  const next = list[(cur + dir + list.length) % list.length];
  sel = new Set([next.id]); refresh(); paint();
  say(shapeName(next));
}

// ---------------------------------------------------------------------------------------------------------------
// Inspector

// Accepts a decimal comma; null for anything non-numeric (the field change is then ignored).
const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };

function numInput(key, value, onSet, attrs = {}) {
  const i = h('input', { type: 'number', class: 'ed-input fp-num', value: String(mm(value)), step: attrs.step || '0.01', inputmode: 'decimal', dataset: { f: key }, ...attrs });
  // Commit on change / Enter, not on input: one undo step per edited value, not per keystroke.
  i.addEventListener('change', () => { const v = num(i.value); if (v != null) onSet(v); });
  i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); i.dispatchEvent(new Event('change')); } });
  return i;
}
const lf = (label, control) => field(label, control);

function editShape(id, patch) {
  commit(() => {
    const s = byId(id);
    if (!s) return;
    replaceShape(normalizeShape({ ...s, ...patch }, 0, new Set((page().layers || []).map((l) => l.id))));
  });
}

// "Push a wall": the vertices after edge i up to the next parallel edge move along it, so a rectangle stays one.
// Parallel test: the 2D cross product of the unit directions below 0.02 (about 1 degree). If no parallel edge
// exists (triangle, irregular room), only the next vertex moves.
function setEdge(pts, i, L) {
  const n = pts.length, a = pts[i], b = pts[(i + 1) % n], cur = dist(a, b);
  if (cur < 1e-6 || !(L > 0)) return pts;
  const u = [(b[0] - a[0]) / cur, (b[1] - a[1]) / cur], d = L - cur;
  const move = [];
  let j = (i + 1) % n, found = false;
  while (j !== i) {
    move.push(j);
    const p = pts[j], q = pts[(j + 1) % n], l = dist(p, q);
    if (l > 1e-6 && Math.abs(u[0] * (q[1] - p[1]) / l - u[1] * (q[0] - p[0]) / l) < 0.02) { found = true; break; }
    j = (j + 1) % n;
  }
  const set = new Set(found ? move : [(i + 1) % n]);
  return pts.map((p, k) => (set.has(k) ? [mm(p[0] + u[0] * d), mm(p[1] + u[1] * d)] : p));
}

function renderInspector() {
  const box = els.inspector;
  if (!box) return;
  // The inspector is rebuilt on every refresh; the focused field key is remembered and focus restored afterwards.
  const focusKey = document.activeElement?.closest?.('.fp-insp') ? document.activeElement.dataset.f : null;
  box.textContent = '';
  const list = selected();
  if (draft) { box.append(h('p', { class: 'ed-hint' }, t(tool === 'draw' ? 'fp.draw.help' : 'fp.draw.outlineHelp'))); return; }
  if (!list.length) {
    box.append(h('p', { class: 'ap-empty fp-empty' }, t('fp.noSel')), h('details', { class: 'fp-keys' }, h('summary', {}, t('fp.keys')), h('p', { class: 'ed-hint' }, t('fp.keysHelp'))));
    return;
  }
  const acts = h('div', { class: 'ap-actions fp-acts' });
  const act = (label, ic, fn, kind) => { const b = button(label, ic, fn, kind); b.classList.add('ed-sm'); acts.append(b); return b; };
  if (list.length > 1) {
    box.append(h('p', { class: 'fp-insp-h' }, t('fp.selN', { n: list.length })));
    const a = list.reduce((s, x) => s + (stencil(x.kind).room ? shapeArea(x) : 0), 0);
    const seats = list.reduce((s, x) => s + (stencil(x.kind).seated ? x.seats || 0 : 0), 0);
    if (a) box.append(h('div', { class: 'ed-hint' }, t('fp.sum.area') + ': ' + fmtArea(a)));
    if (seats) box.append(h('div', { class: 'ed-hint' }, t('fp.sum.seatsN', { n: seats })));
    const ls = layerSelect(list);
    if (ls) box.append(ls);
  } else {
    const sh = list[0], st = stencil(sh.kind), locked = isShapeLocked(sh);
    box.append(h('div', { class: 'fp-insp-h' }, h('span', { class: 'fp-insp-ic', html: stencilPreview(sh.kind) }), h('b', {}, stName(sh.kind)), locked ? iconEl('lock') : null));
    const lbl = textInput(sh.label || '', () => {}, { dataset: { f: 'label' }, placeholder: stName(sh.kind), maxlength: 80, dir: 'auto' });
    lbl.addEventListener('change', () => editShape(sh.id, { label: lbl.value }));
    lbl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); lbl.dispatchEvent(new Event('change')); } });
    box.append(lf('fp.f.label', lbl));
    const grid = h('div', { class: 'fp-grid2' });
    grid.append(
      lf('fp.f.x', numInput('x', sh.x, (v) => editShape(sh.id, { x: v }))),
      lf('fp.f.y', numInput('y', sh.y, (v) => editShape(sh.id, { y: v }))));
    const sizeSet = (k) => (v) => {
      if (!(v > 0)) return;
      const patch = { [k]: v };
      // keepRatio stencils (round tables) change both dimensions together.
      if (st.keepRatio) patch[k === 'w' ? 'h' : 'w'] = mm(v * (k === 'w' ? sh.h / sh.w : sh.w / sh.h));
      if (Array.isArray(sh.pts)) { const w2 = patch.w ?? sh.w, h2 = patch.h ?? sh.h; patch.pts = sh.pts.map((q) => [q[0] * w2 / sh.w + sh.x, q[1] * h2 / sh.h + sh.y]); patch.x = 0; patch.y = 0; }
      editShape(sh.id, patch);
    };
    grid.append(lf(st.flat ? 'fp.f.length' : 'fp.f.w', numInput('w', sh.w, sizeSet('w'), { min: '0.05' })));
    if (!st.flat) grid.append(lf('fp.f.h', numInput('h', sh.h, sizeSet('h'), { min: '0.05' })));
    grid.append(lf('fp.f.rot', numInput('rot', sh.rot || 0, (v) => editShape(sh.id, { rot: normRot(v) }), { step: '1' })));
    if (st.seated) grid.append(lf('fp.f.seats', numInput('seats', sh.seats || 0, (v) => editShape(sh.id, { seats: Math.round(v) }), { step: '1', min: '0', max: sh.kind === 'chair-row' ? '40' : '30' })));
    if (st.sleep) {
      const pl = numInput('places', sh.places ?? st.cap, (v) => editShape(sh.id, { places: Math.round(v) }), { step: '1', min: '0', max: '20' });
      grid.append(lf('fp.f.places', pl));
    }
    box.append(grid);
    if (sh.kind === 'table-rect') box.append(field('fp.f.ends', toggle(!!sh.ends, (v) => editShape(sh.id, { ends: v }))));
    if (st.room) {
      const rt = select(ROOM_TYPES.map((k) => ({ v: k, l: '=' + roomTypeName(k) })), sh.roomType || st.roomType || 'room', (v) => editShape(sh.id, { roomType: v }));
      rt.dataset.f = 'roomType';
      box.append(lf('fp.f.roomType', rt));
      const pts = Array.isArray(sh.pts) ? sh.pts.map((q) => toPlan(sh, q)) : corners(sh);
      // Sleeping places of a room = beds whose centre lies inside the room polygon.
      const inRoom = page().shapes.filter((x) => stencil(x.kind).sleep && x !== sh && containsShape(sh, x));
      const places = inRoom.reduce((s, x) => s + (x.places ?? stencil(x.kind).cap ?? 0), 0);
      box.append(h('dl', { class: 'ap-kv fp-kv' },
        h('dt', {}, t('fp.sum.area')), h('dd', { dataset: { v: String(mm(shapeArea(sh))) }, class: 'fp-room-area' }, fmtArea(shapeArea(sh))),
        h('dt', {}, t('fp.f.perimeter')), h('dd', {}, fmtLen(perimeter(pts))),
        places ? h('dt', {}, t('fp.sum.sleep')) : null, places ? h('dd', {}, String(places)) : null));
      if (Array.isArray(sh.pts)) {
        const lens = edgeLengths(pts);
        const edges = h('div', { class: 'fp-edges' }, h('div', { class: 'ed-label' }, t('fp.f.edges')),
          lens.map((L, i) => h('label', { class: 'fp-edge' }, h('span', {}, `${i + 1}–${(i + 1) % lens.length + 1}`),
            // Typed edge lengths edit the polygon in plan coordinates (rotation baked in) through setEdge.
            numInput('e' + i, L, (v) => { if (v > 0) { const np = setEdge(pts, i, v); commit(() => replaceShape(normalizeShape({ ...sh, rot: 0, x: 0, y: 0, pts: np }))); } }, { min: '0.05', 'aria-label': t('fp.f.edge', { a: i + 1, b: (i + 1) % lens.length + 1 }) }),
            h('span', { class: 'fp-u' }, t('fp.u.mShort')))));
        box.append(edges, h('div', { class: 'ed-hint' }, t('fp.edgesHint')));
      }
    }
    if (st.sleep) {
      const note = textInput(sh.note || '', () => {}, { dataset: { f: 'note' }, maxlength: 80, placeholder: t('fp.f.notePh') });
      note.addEventListener('change', () => editShape(sh.id, { note: note.value }));
      box.append(lf('fp.f.note', note));
    }
    if (!st.plain && !st.flat) {
      // The colour input needs a #rrggbb value: custom fill, else the stencil's default, else white.
      const col = h('input', { type: 'color', class: 'ap-color', value: /^#[0-9a-f]{6}$/i.test(sh.fill || '') ? sh.fill : /^#[0-9a-f]{6}$/i.test(st.fill) ? st.fill : '#ffffff', dataset: { f: 'fill' } });
      col.addEventListener('change', () => editShape(sh.id, { fill: col.value }));
      const reset = h('button', { type: 'button', class: 'ed-btn ed-sm', disabled: !sh.fill, onclick: () => commit(() => { const s = { ...byId(sh.id) }; delete s.fill; replaceShape(s); }) }, t('fp.f.colorReset'));
      box.append(lf('fp.f.color', h('div', { class: 'ap-row' }, col, reset)));
    }
    const ls = layerSelect(list);
    if (ls) box.append(ls);
    const lockT = toggle(doc.locked.includes(sh.id), () => toggleLock());
    lockT.dataset.f = 'lock';
    box.append(field('fp.f.lock', lockT, isLocked(page(), sh) ? 'fp.f.layerLocked' : null));
  }
  act('fp.act.dup', 'dup', duplicateSel);
  act('fp.act.rotate', 'rotate', () => rotateSel(S.angle ? 15 : 90));
  act('fp.act.front', 'up', () => order('front'));
  act('fp.act.back', 'down', () => order('back'));
  act('fp.act.delete', 'trash', deleteSel, 'danger');
  box.append(acts);
  // Restore focus to the same field after the rebuild (data-f keys), so Tab / typing flow is not broken.
  if (focusKey) { const f = box.querySelector(`[data-f="${focusKey}"]`); if (f) f.focus(); }
}
// Even-odd ray casting on the shape centre (rotation does not move the centre, so x + w/2 is correct).
function containsShape(room, x) {
  const c = [x.x + x.w / 2, x.y + x.h / 2];
  const pts = Array.isArray(room.pts) ? room.pts.map((q) => toPlan(room, q)) : corners(room);
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > c[1]) !== (yj > c[1]) && c[0] < ((xj - xi) * (c[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function layerSelect(list) {
  const p = page();
  if (!p.layers) return null;
  const cur = new Set(list.map((s) => layerOf(p, s)));
  // Mixed layers in a multi-selection show "—" until the user picks one.
  const s = select([...(cur.size > 1 ? [{ v: '', l: '=—' }] : []), ...p.layers.map((l) => ({ v: l.id, l: '=' + layerName(l) }))], cur.size === 1 ? [...cur][0] : '', (v) => {
    if (!v) return;
    commit(() => setPage({ ...page(), shapes: page().shapes.map((x) => (sel.has(x.id) ? { ...x, layer: v } : x)) }));
  });
  s.dataset.f = 'layer';
  return field('fp.f.layer', s);
}

// ---------------------------------------------------------------------------------------------------------------
// Summary and checks

function stat(key, label, value, v) {
  // data-stat / data-v expose raw numbers for tests; the visible text is formatted per locale.
  return h('div', { class: 'fp-stat', dataset: { stat: key, v: String(v) } }, h('span', { class: 'fp-stat-l' }, t(label)), h('b', { class: 'fp-stat-v' }, value));
}

function renderSummary() {
  const box = els.summary;
  if (!box) return;
  box.textContent = '';
  const p = page();
  const a = areaSummary(p, { service: SERVICE }), s = seatSummary(p), sl = sleepSummary(p);
  const tiles = h('div', { class: 'fp-stats' });
  if (a.rooms) tiles.append(stat('area', 'fp.sum.area', fmtArea(a.area), a.area), stat('living', 'fp.sum.living', fmtArea(a.living), a.living), stat('service', 'fp.sum.service', fmtArea(a.service), a.service));
  if (a.outline) tiles.append(stat('outline', 'fp.sum.outline', fmtArea(a.outline.area), a.outline.area));
  else if (!a.rooms) tiles.append(stat('page', 'fp.sum.pageArea', fmtArea(p.w * p.h), mm(p.w * p.h)));
  // Seat tiles always on hall plans, sleep tiles always on flat plans, otherwise only when such items exist.
  if (s.tables || doc.plan.kind === 'hall') tiles.append(stat('seats', 'fp.sum.seats', String(s.seats), s.seats), stat('tables', 'fp.sum.tables', String(s.tables), s.tables));
  if (sl.beds || doc.plan.kind === 'floor') tiles.append(stat('sleep', 'fp.sum.sleep', String(sl.places), sl.places));
  box.append(tiles);
  if (doc.plan.pages.length > 1) {
    const all = doc.plan.pages.map((x) => ({ a: areaSummary(x, { service: SERVICE }), s: seatSummary(x) }));
    const ta = all.reduce((q, x) => q + x.a.area, 0), ts = all.reduce((q, x) => q + x.s.seats, 0);
    box.append(h('p', { class: 'ed-hint fp-alltot' }, t('fp.sum.allPages', { a: fmtArea(ta), n: ts })));
  }
  // Rooms with their areas and sleeping places.
  const rooms = p.shapes.filter((x) => stencil(x.kind).room);
  if (rooms.length) {
    const tb = h('table', { class: 'ap-table fp-table' }, h('thead', {}, h('tr', {}, h('th', {}, t('fp.sum.room')), h('th', {}, t('fp.f.roomType')), h('th', { class: 'fp-r' }, t('fp.sum.area')))),
      h('tbody', {}, rooms.map((r) => h('tr', { class: sel.has(r.id) ? 'fp-on' : '' },
        h('td', {}, h('button', { type: 'button', class: 'fp-link', onclick: () => selectIds([r.id]) }, shapeName(r))),
        h('td', {}, roomTypeName(r.roomType || stencil(r.kind).roomType)), h('td', { class: 'fp-r' }, fmtArea(shapeArea(r)))))));
    const types = Object.entries(a.byType).map(([k, v]) => `${roomTypeName(k)} ${fmtArea(v.area)}`).join(' · ');
    box.append(h('div', { class: 'ap-table-wrap fp-twrap' }, tb), h('p', { class: 'ed-hint' }, types));
  }
  const tables = p.shapes.filter((x) => stencil(x.kind).seated);
  if (tables.length) {
    box.append(h('div', { class: 'fp-chips' }, tables.map((x) => h('button', { type: 'button', class: 'fp-chip' + (sel.has(x.id) ? ' fp-on' : ''), onclick: () => selectIds([x.id]) },
      shapeName(x), h('b', {}, String(x.seats || 0))))));
  }
  renderChecks();
}

function renderChecks() {
  const box = els.checks;
  box.textContent = '';
  const p = page(), c = checkPage(p, aisleMin());
  const name = (id) => shapeName(p.shapes.find((s) => s.id === id) || { kind: 'rect' });
  const items = [
    ...c.overlaps.map((o) => ['error', t('fp.chk.overlap', { a: name(o.a), b: name(o.b), d: fmtNum(o.depth * 100, 0) }), [o.a, o.b]]),
    ...c.aisles.map((o) => ['warn', t('fp.chk.aisle', { a: name(o.a), b: name(o.b), g: fmtNum(o.gap * 100, 0), min: fmtNum(aisleMin() * 100, 0) }), [o.a, o.b]]),
    ...c.outside.map((id) => ['warn', t('fp.chk.outside', { a: name(id) }), [id]]),
  ];
  box.append(h('h3', { class: 'fp-h3' }, t('fp.chk.title'), h('span', { class: 'fp-count', dataset: { n: String(items.length) } }, String(items.length))));
  if (!items.length) { box.append(h('div', { class: 'fp-w fp-w-ok' }, iconEl('check'), h('span', {}, t('fp.chk.none', { min: fmtNum(aisleMin() * 100, 0) })))); return; }
  const ul = h('ul', { class: 'fp-wlist' });
  // Each warning is a button that selects the involved shapes (and scrolls them into view).
  for (const [k, msg, ids] of items.slice(0, 40)) ul.append(h('li', {}, h('button', { type: 'button', class: 'fp-w fp-w-' + k, onclick: () => selectIds(ids) }, iconEl('warn'), h('span', {}, msg))));
  box.append(ul);
  if (items.length > 40) box.append(h('p', { class: 'ed-hint' }, t('fp.more', { n: items.length - 40 })));
}

function selectIds(ids) {
  sel = new Set(ids.filter((id) => byId(id)));
  refresh(); paint();
  // Bring the selection into view when it is outside.
  const b = bounds(selected());
  if (b && view && (b.x < view.x || b.y < view.y || b.x + b.w > view.x + view.w || b.y + b.h > view.y + view.h)) {
    view = { ...view, x: b.x + b.w / 2 - view.w / 2, y: b.y + b.h / 2 - view.h / 2 };
    paint();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Layers and objects

function renderLayers() {
  const box = els.layers;
  if (!box) return;
  // Open <details> are remembered across rebuilds so the layer list does not collapse on every edit.
  const openIds = new Set($$('details[open]', box).map((d) => d.dataset.l));
  box.textContent = '';
  const p = page();
  if (!p.layers) return;
  const locked = lockedSet();
  for (const l of p.layers) {
    const shapes = p.shapes.filter((s) => layerOf(p, s) === l.id);
    const setL = (patch) => commit(() => setPage({ ...page(), layers: page().layers.map((x) => (x.id === l.id ? { ...x, ...patch } : x)) }));
    // Hiding a layer also deselects its shapes: invisible selected items would still be moved by arrow keys.
    const eye = h('button', { type: 'button', class: 'ed-iconbtn', 'aria-pressed': String(l.visible), title: t(l.visible ? 'fp.layer.hide' : 'fp.layer.show'), 'aria-label': t(l.visible ? 'fp.layer.hide' : 'fp.layer.show') + ': ' + layerName(l), html: icon(l.visible ? 'eye' : 'eyeOff'), onclick: () => { setL({ visible: !l.visible }); if (l.visible) for (const s of shapes) sel.delete(s.id); } });
    const lock = h('button', { type: 'button', class: 'ed-iconbtn', 'aria-pressed': String(l.locked), title: t(l.locked ? 'fp.layer.unlock' : 'fp.layer.lock'), 'aria-label': t(l.locked ? 'fp.layer.unlock' : 'fp.layer.lock') + ': ' + layerName(l), html: icon(l.locked ? 'lock' : 'unlock'), onclick: () => setL({ locked: !l.locked }) });
    const det = h('details', { class: 'fp-layer' + (l.visible ? '' : ' fp-hidden'), dataset: { l: l.id } },
      h('summary', {}, h('span', { class: 'fp-lname' }, layerName(l)), h('span', { class: 'fp-lcount' }, String(shapes.length))),
      h('ul', { class: 'fp-objs' }, shapes.map((s) => h('li', {}, h('button', { type: 'button', class: 'fp-obj' + (sel.has(s.id) ? ' fp-on' : ''), 'aria-pressed': String(sel.has(s.id)), disabled: !l.visible,
        onclick: (e) => { if (e.shiftKey || e.ctrlKey || e.metaKey) { if (sel.has(s.id)) sel.delete(s.id); else sel.add(s.id); refresh(); paint(); } else selectIds([s.id]); } },
        h('span', { class: 'fp-obj-ic', html: stencilPreview(s.kind) }), h('span', { class: 'fp-obj-n' }, shapeName(s)), locked.has(s.id) ? iconEl('lock') : null)))));
    if (openIds.has(l.id)) det.open = true;
    const ren = h('button', { type: 'button', class: 'ed-iconbtn', title: t('fp.layer.rename'), 'aria-label': t('fp.layer.rename') + ': ' + layerName(l), html: icon('edit'), onclick: async () => {
      const v = await promptDialog(t('fp.layer.rename'), t('fp.layer.name'), layerName(l));
      if (v && String(v).trim()) setL({ name: String(v).trim().slice(0, 100) });
    } });
    // Only empty layers can be deleted (and never the last one): no silent loss of shapes.
    const del = p.layers.length > 1 && !shapes.length ? h('button', { type: 'button', class: 'ed-iconbtn', title: t('fp.layer.del'), 'aria-label': t('fp.layer.del') + ': ' + layerName(l), html: icon('trash'), onclick: () => commit(() => setPage({ ...page(), layers: page().layers.filter((x) => x.id !== l.id) })) }) : null;
    box.append(h('div', { class: 'fp-lrow' }, eye, lock, det, ren, del));
  }
  const add = button('fp.layer.add', 'plus', async () => {
    const v = await promptDialog(t('fp.layer.add'), t('fp.layer.name'), '');
    if (!v || !String(v).trim()) return;
    commit(() => setPage({ ...page(), layers: [...page().layers, { id: newId('l'), name: String(v).trim().slice(0, 100), visible: true, locked: false }] }));
  });
  add.classList.add('ed-sm');
  box.append(h('div', { class: 'ap-actions' }, add));
}

// ---------------------------------------------------------------------------------------------------------------
// Plan settings

function renderPlanCard() {
  const box = els.plan;
  if (!box) return;
  const focusKey = document.activeElement?.closest?.('.fp-a-plan') ? document.activeElement.dataset.f : null;
  box.textContent = '';
  const p = page();
  const name = textInput(doc.plan.name || '', () => {}, { dataset: { f: 'pname' }, maxlength: 200, dir: 'auto' });
  name.addEventListener('change', () => commit(() => { doc.plan.name = name.value.trim().slice(0, 200) || undefined; if (!doc.plan.name) delete doc.plan.name; }));
  const kind = h('div', { class: 'ed-seg', role: 'radiogroup', 'aria-label': t('fp.f.kind') }, KINDS.map((k) => h('button', {
    type: 'button', role: 'radio', class: 'ed-seg-btn' + (doc.plan.kind === k ? ' ed-on' : ''), 'aria-checked': String(doc.plan.kind === k),
    // The plan kind (flat / hall / shop) switches the palette and the aisle default.
    onclick: () => { commit(() => { doc.plan.kind = k; }); renderPalette(); },
  }, t('fp.kind.' + k))));
  const pname = textInput(p.name, () => {}, { dataset: { f: 'pgname' }, maxlength: 60, dir: 'auto' });
  pname.addEventListener('change', () => { if (pname.value.trim()) commit(() => { page().name = pname.value.trim().slice(0, 60); }); });
  const size = h('div', { class: 'fp-grid2' },
    field('fp.f.pw', numInput('pw', p.w, (v) => { if (v >= 1) commit(() => setPage({ ...page(), w: mm(Math.min(500, v)) })); }, { min: '1' })),
    field('fp.f.ph', numInput('ph', p.h, (v) => { if (v >= 1) commit(() => setPage({ ...page(), h: mm(Math.min(500, v)) })); }, { min: '1' })));
  // The aisle minimum is a per-kind UI setting (S.aisle), not document data.
  const aisle = numInput('aisle', aisleMin(), (v) => { S.aisle[doc.plan.kind] = clamp(v, 0, 5); saveSettings(); renderChecks(); }, { min: '0', max: '5', step: '0.05' });
  const outl = p.outline
    ? (() => { const b = button('fp.f.outlineRemove', 'trash', () => commit(() => { const q = { ...page() }; delete q.outline; setPage(q); })); b.classList.add('ed-sm'); return b; })()
    : (() => { const b = button('fp.f.outlineRect', 'ruler', () => commit(() => setPage({ ...page(), outline: [[0, 0], [p.w, 0], [p.w, p.h], [0, p.h]] }))); b.classList.add('ed-sm'); return b; })();
  const draw = button('fp.tool.outline', 'pen', () => setTool('outline')); draw.classList.add('ed-sm');
  box.append(field('fp.f.planName', name), h('div', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('fp.f.kind')), kind),
    field('fp.f.pageName', pname), size,
    h('div', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('fp.f.outline')), h('div', { class: 'ap-row' }, draw, outl)),
    field('fp.f.aisle', aisle, 'fp.f.aisleHint'));
  if (focusKey) box.querySelector(`[data-f="${focusKey}"]`)?.focus();
}

// ---------------------------------------------------------------------------------------------------------------
// Templates, files and exports

async function openTemplates() {
  const cards = h('div', { class: 'fp-tpls' });
  let chosen = null;
  const close = () => document.querySelector('.fp-tpl-dlg .ed-dlg-foot button')?.click();
  for (const tp of TEMPLATES) {
    // Each template is built once for its thumbnail and again on choice (fresh ids for the actual document).
    const d = tp.build();
    const b = h('button', { type: 'button', class: 'fp-tpl', dataset: { tpl: tp.id }, onclick: () => { chosen = () => tp.build(); close(); } },
      h('span', { class: 'fp-tpl-img', html: planSvg(d.plan.pages[0], { pad: 0.6 }) }),
      h('b', {}, t('fp.tpl.' + tp.id)), h('span', { class: 'ed-hint' }, t('fp.tpl.d.' + tp.id)));
    cards.append(b);
  }
  const empties = h('div', { class: 'ap-row fp-empties' }, h('span', { class: 'ed-label' }, t('fp.tpl.empty')), KINDS.map((k) => {
    const b = button('fp.kind.' + k, 'plus', () => { chosen = () => emptyDoc(k); close(); }); b.classList.add('ed-sm'); b.dataset.empty = k; return b;
  }));
  await openDialog({ title: t('fp.templates'), body: h('div', {}, cards, empties), wide: true, className: 'fp-tpl-dlg', buttons: [{ label: t('dlg.cancel'), value: null }] });
  if (chosen) replaceDoc(chosen(), t('fp.tplLoaded'));
}

function replaceDoc(next, msg) {
  // Replacing the whole document is undoable: the old doc goes onto the history stack (and the toast offers undo).
  H.push(doc);
  doc = next;
  S.pi = 0; sel.clear(); draft = null; tool = 'select';
  saveSettings(); saveSoon();
  renderPalette(); fit(); refresh();
  toast(msg, 'ok', { label: t('fp.undo'), fn: undo });
}

async function openFile(file) {
  if (!(file instanceof Blob)) { const files = await pickFiles({ accept: '.json,application/json' }); file = files[0]; }
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    replaceDoc(normalizeDoc(raw), t('fp.opened', { name: file.name || 'plan.json' }));
  } catch { toast(t('fp.openBad'), 'error'); }
}
// File name: forbidden path characters removed, capped; the plan or page name as the base.
const baseName = () => String(doc.plan.name || page().name || 'plan').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 60) || 'plan';
function saveJson() { download(JSON.stringify(fileOf(doc), null, 1), baseName() + '.floorplan.json', 'application/json'); }

// Plan files dropped anywhere on the page.
// Drag-over styling only for file drags; dragleave fires on every child boundary, so the class is removed only
// when leaving the document (no relatedTarget).
document.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); document.body.classList.add('fp-dropping'); } });
document.addEventListener('dragleave', (e) => { if (e.target === document.documentElement || !e.relatedTarget) document.body.classList.remove('fp-dropping'); });
document.addEventListener('drop', (e) => {
  document.body.classList.remove('fp-dropping');
  const f = [...(e.dataTransfer?.files || [])].find((x) => /\.json$/i.test(x.name) || x.type === 'application/json');
  if (!f) return;
  e.preventDefault();
  openFile(f);
});
// Another tab (the seating page) changed the plan.
// The incoming document replaces the local one wholesale; local edits still inside the 250ms save debounce would be
// lost, and the undo stack still holds pre-change snapshots (undo would revert the other tab's edit).
window.addEventListener('storage', (e) => { if (e.key === DOC_KEY && e.newValue) { try { doc = normalizeDoc(JSON.parse(e.newValue)); afterHistory(); } catch { /* ignore */ } } });

function renderExport() {
  const box = els.export;
  box.textContent = '';
  const ratio = select(RATIOS.map((r) => ({ v: r, l: '=1:' + r })), S.ratio, (v) => { S.ratio = +v; saveSettings(); note(); });
  ratio.dataset.f = 'ratio';
  const png = select([50, 100, 200].map((v) => ({ v, l: '=' + t('fp.x.ppm', { n: v }) })), S.png, (v) => { S.png = +v; saveSettings(); });
  const info = h('div', { class: 'ed-hint' });
  const note = () => { const s = printSize(page(), S.ratio); info.textContent = t('fp.x.size', { w: Math.round(s.w), h: Math.round(s.h) }); };
  note();
  const b = (label, ic, fn, kind) => { const x = button(label, ic, fn, kind); x.classList.add('fp-xbtn'); return x; };
  box.append(
    h('div', { class: 'fp-grid2' }, field('fp.x.scale', ratio), field('fp.x.png', png)), info,
    h('div', { class: 'ap-actions' }, b('fp.x.svg', 'download', exportSVG, 'primary'), b('fp.x.pngBtn', 'image', exportPNG), b('fp.x.print', 'print', printDialog)),
    h('div', { class: 'ap-actions' }, b('fp.saveJson', 'save', saveJson), b('fp.open', 'folder', () => openFile())),
    h('div', { class: 'ed-hint' }, t('fp.x.dropHint')));
}
function exportSVG() { download(exportSvg(doc, page(), { ratio: S.ratio }), `${baseName()} 1-${S.ratio}.svg`, 'image/svg+xml'); }
async function exportPNG() {
  // PNG at free size (ratio 0) rasterised at the chosen pixels per metre.
  try { download(await svgToPng(exportSvg(doc, page(), { ratio: 0 }), S.png), baseName() + '.png', 'image/png'); } catch (e) { toast(t('err.generic', { msg: e.message }), 'error'); }
}

function printDialog() {
  const p = page();
  const paper = select(Object.keys(PAPERS).map((k) => ({ v: k, l: '=' + k })), S.paper, (v) => { S.paper = v; saveSettings(); paintNote(); });
  const orient = select([{ v: 'auto', l: 'fp.p.auto' }, { v: 'portrait', l: 'fp.p.portrait' }, { v: 'landscape', l: 'fp.p.landscape' }], S.orient, (v) => { S.orient = v; saveSettings(); paintNote(); });
  const ratio = select([{ v: 0, l: 'fp.p.fit' }, ...RATIOS.map((r) => ({ v: r, l: '=1:' + r }))], S.printFit ? 0 : S.ratio, (v) => { if (+v) { S.ratio = +v; S.printFit = false; } else S.printFit = true; saveSettings(); paintNote(); });
  const sum = toggle(S.summary, (v) => { S.summary = v; saveSettings(); });
  const noteEl = h('div', { class: 'ed-hint' });
  // "auto" orientation follows the page proportions.
  const land = () => (S.orient === 'auto' ? p.w > p.h : S.orient === 'landscape');
  // Fit mode picks the most detailed standard scale that fits the paper (fitRatio).
  const useRatio = () => (S.printFit ? fitRatio(p, S.paper, land()) : S.ratio);
  function paintNote() {
    const r = useRatio(), s = printSize(p, r), [aw, ah] = paperArea(S.paper, land());
    const fits = s.w <= aw && s.h <= ah;
    noteEl.textContent = t('fp.p.note', { r, w: Math.round(s.w), h: Math.round(s.h), paper: S.paper }) + ' ' + t(fits ? 'fp.p.fits' : 'fp.p.tooBig');
    noteEl.classList.toggle('fp-bad', !fits);
  }
  paintNote();
  const body = h('div', { class: 'ed-fields' }, h('div', { class: 'fp-grid2' }, field('fp.p.paper', paper), field('fp.p.orient', orient)), field('fp.x.scale', ratio), field('fp.p.summary', sum), noteEl, h('div', { class: 'ed-hint' }, t('fp.p.hint')));
  openDialog({ title: t('fp.x.print'), body, buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('fp.p.go'), value: 'go', primary: true }] })
    .then((v) => { if (v === 'go') printPlan(useRatio(), land()); });
}
function printPlan(ratio, landscape) {
  const p = page();
  const sheet = h('div', { class: 'fp-sheet' },
    h('div', { class: 'fp-sheet-plan', html: exportSvg(doc, p, { ratio }) }),
    S.summary ? summaryForPrint(p) : null);
  printContent(sheet, { paper: S.paper, landscape });
}
function summaryForPrint(p) {
  const a = areaSummary(p, { service: SERVICE }), s = seatSummary(p), sl = sleepSummary(p);
  const rows = [];
  for (const r of p.shapes.filter((x) => stencil(x.kind).room)) rows.push([shapeName(r), roomTypeName(r.roomType || stencil(r.kind).roomType), fmtArea(shapeArea(r))]);
  return h('div', { class: 'fp-psum' },
    rows.length ? h('table', {}, h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c)))))) : null,
    h('p', {}, [a.rooms ? `${t('fp.sum.area')}: ${fmtArea(a.area)} · ${t('fp.sum.living')}: ${fmtArea(a.living)} · ${t('fp.sum.service')}: ${fmtArea(a.service)}` : '',
      s.tables ? `${t('fp.sum.tables')}: ${s.tables} · ${t('fp.sum.seats')}: ${s.seats}` : '', sl.beds ? `${t('fp.sum.sleep')}: ${sl.places}` : ''].filter(Boolean).join(' · ')));
}

// ---------------------------------------------------------------------------------------------------------------

render();
