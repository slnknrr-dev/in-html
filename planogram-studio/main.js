// planogram-studio/main.js - the planogram page: fixtures (gondola, wall rack, fridge, pegboard) with an editable
// list of shelves, the product library (search, categories, CSV / XLSX import, product cards with EAN), placing
// products on shelves by drag and drop on the front view or with the keyboard (product + shelf + facings), facings
// across / up / into the depth, rotation and the sideways turn, automatic depth, the live fit check with warnings
// and the overflow zones, colouring by category / brand / product, undo / redo, analytics and versions (panels.js),
// exports (SVG, PNG, print at a scale, positions CSV) and the project file (JSON).
//
// Architecture: one state object S (project P, persisted UI state ui, product index map, last fit check and front
// layout). Every model change goes through commit(fn): snapshot -> mutate -> afterChange (reindex, clamp selection,
// save, repaint). Selection-only changes skip commit and repaint just the selection overlay and side panels.
// Geometry and rules (fit check, auto depth, capacity, SVG drawing) come from ../planogram/; this file is UI.
import { FIXTURE_KINDS, KIND_KEYS, chip, dims, fmt, fmtMoney, fmtPct, group, kindShelves, kvRows, loadProject, makeVersion, newFixture, normFixture, normProduct, normalizeProject, numInput, printSheet, printable, saveProject, startShell, stepper, svgMm, svgToPng, uid, versionsList, versionsSave } from './common.js';
import { buildDemo } from './demo.js';
import { mappingDialog, mergeProducts, readTable } from './importer.js';
import { renderAnalytics, renderVersions } from './panels.js';
import { button, card, download, field, select, seg, t, textInput, toast, toggle } from '../ui/app.js';
import { $, $$, debounce, h, isEditable, lsGet, lsSet } from '../ui/dom.js';
import { icon, iconEl } from '../ui/icons.js';
import { confirmDialog, openDialog, openMenu } from '../ui/overlays.js';
import { pickFiles } from '../ui/files.js';
import { ROTATIONS, hasDims, normalizePosition } from '../planogram/model.js';
import { autoDepth, autoDepthShelf, checkFixture, maxFacings, maxStack } from '../planogram/fit.js';
import { frontLayout, frontSVG, keyColor } from '../planogram/svg.js';
import { capacity, daysOfSupply, productCapacity } from '../planogram/space.js';
import { createHistory } from '../plan/history.js';
import { serializeCSV } from '../csv/csv.js';
import { encode } from '../barcode/linear.js';
import { barcodeSVG } from '../barcode/svg.js';

// ---------------------------------------------------------------------------------------------------------------
// State

const UKEY = 'pgs-ui-plan';
// UI state persisted separately from the project (pgs-ui-plan): zoom, selection, filters and print settings are
// per-user view preferences, not project data, and must not enter undo history or exported files.
const UI_DEF = {
  fixtureId: '', shelf: 0, pos: null, colorBy: 'category', zoom: 3.5, q: '', cat: '', placeId: '', placeFx: 2, placeFy: 1, auto: true,
  scope: 'fixture', groupBy: 'category', onlyIssues: false, cmpA: '', cmpB: 'current', ratio: 10, paper: 'a4', landscape: false,
};
const S = { P: null, ui: { ...UI_DEF, ...(lsGet(UKEY, null) || {}) }, map: new Map(), check: null, layout: null };
const hist = createHistory({ limit: 150 });
const saveUi = debounce(() => lsSet(UKEY, S.ui), 250);

const fixture = () => S.P.fixtures.find((f) => f.id === S.ui.fixtureId) || S.P.fixtures[0];
const product = (id) => S.map.get(id);
const nameOf = (id) => product(id)?.name ?? id;
// Undo snapshot = products + fixtures. plan/history.js serialises to JSON on push, so later in-place mutations
// (positions.splice) cannot leak into stored history.
const snap = () => ({ products: S.P.products, fixtures: S.P.fixtures });

// First visit (or a project without fixtures): seed the demo and its example versions so every panel shows data.
function loadOrDemo() {
  const p = loadProject();
  if (p && p.fixtures.length) return p;
  const d = buildDemo();
  if (!versionsList().length) versionsSave(d.versions);
  saveProject(d.project);
  return d.project;
}

function rebuildMap() { S.map = new Map(S.P.products.map((p) => [p.id, p])); }

// Keeps the selection valid after any change.
// Selection invariants after any change: a fixture always exists (an empty project gets one gondola), the shelf
// index is in range, the position index is valid or null, and the product to place still exists.
function clampSel() {
  if (!S.P.fixtures.length) S.P.fixtures.push(newFixture('gondola', t('pgs.kind.gondola') + ' 1'));
  const f = fixture();
  S.ui.fixtureId = f.id;
  S.ui.shelf = Math.max(0, Math.min(f.shelves.length - 1, S.ui.shelf | 0));
  const sh = f.shelves[S.ui.shelf];
  if (S.ui.pos != null && (!sh || S.ui.pos >= sh.positions.length || S.ui.pos < 0)) S.ui.pos = sh && sh.positions.length ? sh.positions.length - 1 : null;
  if (S.ui.placeId && !product(S.ui.placeId)) S.ui.placeId = '';
}

// One undoable change: the state before goes to the history.
// The single mutation entry point: anything inside fn is one undo step.
// KNOWN DEFECT: the snapshot holds products and fixtures only, but some commits also change P.plan, P.name and
// P.settings (replaceProject, delFixture unlinking plan shapes). Undo restores fixtures without restoring those, so
// e.g. undoing a fixture deletion brings the fixture back but not its links on the store plan. Fix: snapshot the
// whole project (or add plan/name/settings to snap() and to the undo/redo assignments).
function commit(fn) {
  hist.push(snap());
  fn();
  afterChange();
}
function afterChange() {
  rebuildMap();
  clampSel();
  saveProject(S.P);
  saveUi();
  refresh();
}
function undo() {
  const s = hist.undo(snap());
  if (!s) return;
  S.P.products = s.products; S.P.fixtures = s.fixtures;
  afterChange();
  announce(t('pgs.undone'));
}
function redo() {
  const s = hist.redo(snap());
  if (!s) return;
  S.P.products = s.products; S.P.fixtures = s.fixtures;
  afterChange();
  announce(t('pgs.redone'));
}

// ---------------------------------------------------------------------------------------------------------------
// Position operations

const curShelf = () => fixture().shelves[S.ui.shelf];
const curPos = () => (S.ui.pos == null ? null : curShelf()?.positions[S.ui.pos] ?? null);

// Auto depth fills the shelf depth with units (capped at 50 deep, 12 on pegboard hooks) when the product has
// dimensions; otherwise one unit deep. Insert at index or append.
function place(productId, shelfIndex, index = null, fx = S.ui.placeFx, fy = S.ui.placeFy) {
  const pr = product(productId), f = fixture(), sh = f.shelves[shelfIndex];
  if (!pr || !sh) return;
  commit(() => {
    const fz = S.ui.auto && hasDims(pr) ? Math.min(sh.kind === 'peg' ? 12 : 50, autoDepth(pr, sh)) : 1;
    const at = index == null ? sh.positions.length : Math.max(0, Math.min(sh.positions.length, index));
    sh.positions.splice(at, 0, normalizePosition({ productId, fx, fy, fz }));
    S.ui.shelf = shelfIndex; S.ui.pos = at;
  });
  announce(t('pgs.placed', { name: pr.name, n: shelfIndex + 1 }));
}

// Dropping an item just before or after itself is a no-op (selection only, no undo step). Moving within the same
// shelf to a later index compensates for the removal shift (at--). A move to another shelf recomputes auto depth
// because shelf depth may differ.
function movePos(fromShelf, fromIdx, toShelf, toIdx) {
  const f = fixture();
  const a = f.shelves[fromShelf], b = f.shelves[toShelf];
  if (!a || !b || !a.positions[fromIdx]) return;
  if (fromShelf === toShelf && (toIdx === fromIdx || toIdx === fromIdx + 1)) { S.ui.shelf = fromShelf; S.ui.pos = fromIdx; paintSelection(); return; }
  commit(() => {
    const [p] = a.positions.splice(fromIdx, 1);
    let at = toIdx;
    if (fromShelf === toShelf && toIdx > fromIdx) at--;
    at = Math.max(0, Math.min(b.positions.length, at));
    if (fromShelf !== toShelf && S.ui.auto) { const pr = product(p.productId); if (hasDims(pr)) p.fz = Math.min(b.kind === 'peg' ? 12 : 50, autoDepth(pr, b, p.rot, p.turn)); }
    b.positions.splice(at, 0, p);
    S.ui.shelf = toShelf; S.ui.pos = at;
  });
}

// Patch through normalizePosition so facings/rotation stay within the model's legal ranges.
function setPos(patch) {
  const p = curPos();
  if (!p) return;
  commit(() => { Object.assign(p, normalizePosition({ ...p, ...patch })); });
}

function removePos() {
  const sh = curShelf();
  if (!sh || S.ui.pos == null) return;
  const name = nameOf(sh.positions[S.ui.pos]?.productId);
  commit(() => { sh.positions.splice(S.ui.pos, 1); S.ui.pos = sh.positions.length ? Math.min(S.ui.pos, sh.positions.length - 1) : null; });
  announce(t('pgs.removed', { name }));
}

// ---------------------------------------------------------------------------------------------------------------
// Layout

const main = $('#main');
main.classList.add('pgs-plan');
const els = {};

// Builds the static page skeleton once; refresh() repaints content. Card wrappers carry grid-area classes
// (pgs-a-*) used by app.css to lay out the work grid.
function render() {
  main.textContent = '';
  els.status = h('div', { class: 'pgs-sr', role: 'status', 'aria-live': 'polite' });
  els.toolbar = h('div', { class: 'pgs-toolbar ap-card' });
  els.lib = h('div', { class: 'pgs-lib-list', role: 'list' });
  els.libCount = h('div', { class: 'ed-hint pgs-lib-count' });
  els.canvas = h('div', { class: 'pgs-canvas', id: 'pgs-canvas' });
  els.stage = h('div', { class: 'pgs-stage', tabindex: '0', role: 'group', 'aria-label': t('pgs.stage.aria'), 'aria-describedby': 'pgs-stage-help' }, els.canvas);
  els.stageHead = h('div', { class: 'pgs-stage-head' });
  els.legend = h('div', { class: 'pgs-legend' });
  els.warn = h('div', { class: 'pgs-warn' });
  els.shelves = h('div', { class: 'pgs-shelves' });
  els.place = h('div', { class: 'ed-fields' });
  els.insp = h('div', { class: 'pgs-insp' });
  els.fixture = h('div', { class: 'ed-fields' });
  els.analytics = h('div', { class: 'pgs-ana' });
  els.versions = h('div', { class: 'pgs-ver' });

  const libCard = card('pgs.lib.title', libraryTools(), els.libCount, els.lib);
  libCard.classList.add('pgs-a-lib');
  const stageCard = h('section', { class: 'ap-card pgs-a-stage' }, els.stageHead, els.stage,
    h('p', { class: 'ed-hint', id: 'pgs-stage-help' }, t('pgs.stage.help')), els.legend, els.warn);
  const shelvesCard = card('pgs.sh.title', els.shelves);
  shelvesCard.classList.add('pgs-a-shelves');
  const placeCard = card('pgs.place.title', els.place);
  placeCard.classList.add('pgs-a-place');
  const inspCard = card('pgs.pos.title', els.insp);
  inspCard.classList.add('pgs-a-insp');
  const fxCard = card('pgs.fx.title', els.fixture);
  fxCard.classList.add('pgs-a-fx');
  const exCard = card('pgs.x.title', exportTools());
  exCard.classList.add('pgs-a-ex');
  const anaCard = card('pgs.ana.title', els.analytics);
  anaCard.classList.add('pgs-a-ana');
  const verCard = card('pgs.ver.title', els.versions);
  verCard.classList.add('pgs-a-ver');
  const right = h('div', { class: 'pgs-col pgs-a-right' }, placeCard, inspCard, fxCard, exCard);
  main.append(els.status, h('div', { class: 'pgs-work' }, els.toolbar, libCard, h('div', { class: 'pgs-col pgs-a-center' }, stageCard, shelvesCard), right, anaCard, verCard));
  bindStage();
  refresh();
}

function refresh() {
  rebuildMap();
  clampSel();
  paintToolbar();
  paintLibrary();
  paintStage();
  paintShelves();
  paintPlace();
  paintInspector();
  paintFixture();
  paintAnalytics();
  paintVersions();
}

// Re-renders a box, then gives focus back to the control that had it (data-fk keys survive re-rendering).
// Re-rendering a panel destroys the focused element; data-fk ids identify the "same" control in the new DOM so
// keyboard users keep their place (CSS.escape because ids may contain product ids).
function keepFocus(fn) {
  const a = document.activeElement;
  const fk = a && a.dataset ? a.dataset.fk : null;
  fn();
  if (fk) { const b = document.querySelector(`[data-fk="${CSS.escape(fk)}"]`); if (b && b !== document.activeElement) b.focus({ preventScroll: true }); }
}

// Screen-reader status: clear, then set after 30 ms so repeated identical messages are announced again.
function announce(msg) { if (els.status) { els.status.textContent = ''; setTimeout(() => { els.status.textContent = msg; }, 30); } }

// --- toolbar -----------------------------------------------------------------------------------------------------

function paintToolbar() {
  const box = els.toolbar;
  keepFocus(() => {
    box.textContent = '';
    const f = fixture();
    const fsel = h('select', { class: 'ed-input ed-select pgs-fsel', id: 'pgs-fixture', 'aria-label': t('pgs.tb.fixture'), dataset: { fk: 'fixture' } },
      S.P.fixtures.map((x) => h('option', { value: x.id, selected: x.id === f.id }, `${x.name || t('pgs.kind.' + x.kind)} · ${t('pgs.kind.' + x.kind)}`)));
    fsel.addEventListener('change', () => { S.ui.fixtureId = fsel.value; S.ui.shelf = 0; S.ui.pos = null; saveUi(); refresh(); });
    const add = button('pgs.tb.add', 'plus', (e) => openMenu(e.currentTarget, KIND_KEYS.map((k) => ({ label: t('pgs.kind.' + k), icon: FIXTURE_KINDS[k].icon, action: () => addFixture(k) })), { restoreFocus: true }));
    add.dataset.act = 'add-fixture';
    add.setAttribute('aria-haspopup', 'menu');
    const ub = h('button', { type: 'button', class: 'ed-iconbtn', title: t('pgs.tb.undo') + ' (Ctrl+Z)', 'aria-label': t('pgs.tb.undo'), html: icon('undo'), disabled: !hist.canUndo, dataset: { act: 'undo', fk: 'undo' }, onclick: undo });
    const rb = h('button', { type: 'button', class: 'ed-iconbtn', title: t('pgs.tb.redo') + ' (Ctrl+Y)', 'aria-label': t('pgs.tb.redo'), html: icon('redo'), disabled: !hist.canRedo, dataset: { act: 'redo', fk: 'redo' }, onclick: redo });
    const color = seg(['category', 'brand', 'product'].map((v) => ({ v, l: 'pgs.by.' + v })), S.ui.colorBy, (v) => { S.ui.colorBy = v; saveUi(); paintStage(); }, 'pgs.tb.color');
    const zoom = h('input', { type: 'range', class: 'ed-range pgs-zoom', min: 1.5, max: 8, step: 0.25, value: S.ui.zoom, 'aria-label': t('pgs.tb.zoom'), dataset: { fk: 'zoom' } });
    zoom.addEventListener('input', () => { S.ui.zoom = +zoom.value; saveUi(); paintStage(); });
    box.append(
      h('div', { class: 'pgs-tb-group' }, iconEl(FIXTURE_KINDS[f.kind]?.icon || 'shelf'), fsel, add),
      h('div', { class: 'pgs-tb-group' }, ub, rb),
      h('div', { class: 'pgs-tb-group pgs-tb-color' }, h('span', { class: 'pgs-tb-l' }, t('pgs.tb.color')), color),
      h('label', { class: 'pgs-tb-group pgs-tb-zoom' }, iconEl('zoomIn'), h('span', { class: 'pgs-tb-l' }, t('pgs.tb.zoom')), zoom));
  });
}

function addFixture(kind) {
  const n = S.P.fixtures.filter((x) => x.kind === kind).length + 1;
  const f = newFixture(kind, `${t('pgs.kind.' + kind)} ${n}`);
  commit(() => { S.P.fixtures.push(f); S.ui.fixtureId = f.id; S.ui.shelf = 0; S.ui.pos = null; });
  toast(t('pgs.fx.added', { name: f.name }), 'ok');
}

// --- library -----------------------------------------------------------------------------------------------------

function libraryTools() {
  const q = h('input', { type: 'search', class: 'ed-input', value: S.ui.q, placeholder: t('pgs.lib.search'), 'aria-label': t('pgs.lib.search'), id: 'pgs-q' });
  q.addEventListener('input', debounce(() => { S.ui.q = q.value; saveUi(); paintLibrary(); }, 120));
  els.cat = h('select', { class: 'ed-input ed-select', 'aria-label': t('pgs.lib.cat'), id: 'pgs-cat' });
  els.cat.addEventListener('change', () => { S.ui.cat = els.cat.value; saveUi(); paintLibrary(); });
  const imp = button('pgs.lib.import', 'upload', importProducts); imp.classList.add('ed-sm'); imp.dataset.act = 'import';
  const add = button('pgs.lib.add', 'plus', () => productDialog(null)); add.classList.add('ed-sm'); add.dataset.act = 'add-product';
  const csv = button('pgs.lib.csv', 'download', exportProducts); csv.classList.add('ed-sm');
  return h('div', { class: 'pgs-lib-tools' }, q, els.cat, h('div', { class: 'ap-row' }, imp, add, csv));
}

// Library search over name, EAN and brand; at most 400 rendered items (DOM size), with a count of the rest. Items
// are draggable buttons: HTML5 drag-and-drop with a custom MIME type so only library items are accepted by the stage.
function paintLibrary() {
  const cats = [...new Set(S.P.products.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (S.ui.cat && !cats.includes(S.ui.cat)) S.ui.cat = '';
  els.cat.textContent = '';
  els.cat.append(h('option', { value: '' }, t('pgs.lib.allCats')), cats.map((c) => h('option', { value: c, selected: c === S.ui.cat }, c)));
  const q = S.ui.q.trim().toLowerCase();
  const list = S.P.products.filter((p) => (!S.ui.cat || p.category === S.ui.cat)
    && (!q || p.name.toLowerCase().includes(q) || (p.code || '').includes(q) || (p.brand || '').toLowerCase().includes(q)));
  const placed = productCapacity(fixture());
  const shown = list.slice(0, 400);
  els.libCount.textContent = t('pgs.lib.count', { n: list.length }) + (list.length > shown.length ? ' · ' + t('pgs.lib.more', { n: shown.length }) : '');
  keepFocus(() => {
    els.lib.textContent = '';
    if (!shown.length) { els.lib.append(h('div', { class: 'ap-empty' }, t('pgs.lib.none'))); return; }
    for (const p of shown) {
      const pc = placed.get(p.id);
      const b = h('button', {
        type: 'button', class: 'pgs-prod' + (p.id === S.ui.placeId ? ' pgs-on' : ''), draggable: 'true', 'aria-pressed': String(p.id === S.ui.placeId),
        dataset: { id: p.id, fk: 'prod-' + p.id }, title: t('pgs.lib.itemHint'),
        onclick: () => { S.ui.placeId = p.id; saveUi(); paintLibrarySel(); paintPlace(); },
        ondblclick: () => productDialog(p),
      },
      h('span', { class: 'pgs-sw', style: { background: p.color || keyColor(p.category) } }),
      h('span', { class: 'pgs-prod-t' }, h('span', { class: 'pgs-prod-n' }, p.name),
        h('span', { class: 'pgs-prod-m' }, [hasDims(p) ? dims(p) + ' cm' : t('pgs.lib.noDims'), p.brand].filter(Boolean).join(' · '))),
      pc ? h('span', { class: 'pgs-badge', title: t('pgs.lib.placed') }, '×' + pc.facings) : null);
      b.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/x-pgs-product', p.id);
        e.dataTransfer.setData('text/plain', p.name);
        e.dataTransfer.effectAllowed = 'copy';
      });
      els.lib.append(h('div', { role: 'listitem' }, b));
    }
  });
}
function paintLibrarySel() {
  for (const b of $$('.pgs-prod', els.lib)) { const on = b.dataset.id === S.ui.placeId; b.classList.toggle('pgs-on', on); b.setAttribute('aria-pressed', String(on)); }
}

// --- stage: front view -----------------------------------------------------------------------------------------

// Shared SVG options; idPrefix keeps ids unique when several drawings exist in one document.
function svgOpts(extra = {}) {
  return { scale: S.ui.zoom, colorBy: S.ui.colorBy, idPrefix: 'pgs', legendName: (k) => (k == null ? t('pgs.other') : S.ui.colorBy === 'product' ? nameOf(k) : String(k)), ...extra };
}

// The front view is a fresh SVG string from planogram/svg.js (pure function of fixture + products); an overlay <g>
// is appended for selection and the drop marker so they can be repainted without regenerating the drawing.
// frontLayout returns the same geometry as data (shelf spaces, position blocks) for hit-testing.
function paintStage() {
  const f = fixture();
  const check = checkFixture(f, S.map);
  S.check = check;
  const opts = svgOpts({ check });
  S.layout = frontLayout(f, S.map, opts);
  els.canvas.innerHTML = frontSVG(f, S.map, opts);
  const svg = els.canvas.querySelector('svg');
  svg.classList.add('pgs-svg');
  svg.setAttribute('aria-label', t('pgs.stage.svg', { name: f.name || t('pgs.kind.' + f.kind) }));
  const ov = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  ov.setAttribute('class', 'pgs-ov');
  svg.append(ov);
  paintSelection();
  paintHead();
  paintLegend();
  paintWarnings();
}

function svgEl(tag, attrs) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function paintSelection() {
  const ov = els.canvas.querySelector('.pgs-ov');
  if (!ov || !S.layout) return;
  ov.textContent = '';
  const sp = S.layout.spaces[S.ui.shelf];
  if (sp) ov.append(svgEl('rect', { class: 'pgs-sel-shelf', x: sp.x - 0.6, y: sp.y + 0.3, width: sp.w + 1.2, height: Math.max(1, sp.h - 0.6), rx: 0.8 }));
  const b = S.ui.pos == null ? null : S.layout.blocks.find((x) => x.shelf === S.ui.shelf && x.pos === S.ui.pos);
  if (b) ov.append(svgEl('rect', { class: 'pgs-sel-pos', x: b.x - 0.4, y: b.y - 0.4, width: b.w + 0.8, height: b.h + 0.8, rx: 0.6 }));
  els.marker = svgEl('line', { class: 'pgs-marker', x1: 0, y1: 0, x2: 0, y2: 0, visibility: 'hidden' });
  ov.append(els.marker);
  els.stage.setAttribute('aria-activedescendant', '');
  for (const g of $$('.pg-pos', els.canvas)) g.classList.toggle('pgs-picked', !!b && g.dataset.pos === `${b.shelf}:${b.pos}`);
}

function selectionText() {
  const sh = curShelf(), p = curPos();
  if (!sh) return '';
  const base = t('pgs.sel.shelf', { n: S.ui.shelf + 1, of: fixture().shelves.length });
  if (!p) return base;
  return `${base}, ${t('pgs.sel.pos', { n: S.ui.pos + 1 })}: ${nameOf(p.productId)} ${p.fx}×${p.fy}×${p.fz}`;
}

// Fit verdict: real violations (overflow, too tall, too heavy...) = bad; only squeezed shelves or products without
// dimensions = warn (a plan that may still work); none = ok.
function fitState() {
  const c = S.check;
  const errors = c.warnings.filter((w) => w.code !== 'no_dimensions');
  const squeezed = c.shelves.filter((s) => s.squeezed).length;
  const unknown = c.warnings.filter((w) => w.code === 'no_dimensions').length;
  return { errors: errors.length, squeezed, unknown, state: errors.length ? 'bad' : squeezed || unknown ? 'warn' : 'ok' };
}

function paintHead() {
  const f = fixture(), st = fitState(), tot = S.check.totals;
  const facings = f.shelves.reduce((x, s) => x + s.positions.reduce((y, p) => y + p.fx, 0), 0);
  const skus = new Set(f.shelves.flatMap((s) => s.positions.map((p) => p.productId))).size;
  const badge = h('span', { class: 'pgs-fit pgs-fit-' + st.state, role: 'status', dataset: { state: st.state, count: String(st.errors) } },
    iconEl(st.state === 'ok' ? 'check' : 'warn'),
    h('span', {}, st.state === 'ok' ? t('pgs.fit.ok') : st.errors ? t('pgs.fit.bad', { n: st.errors }) : t('pgs.fit.warn')));
  els.stageHead.textContent = '';
  els.stageHead.append(
    h('h2', { class: 'pgs-stage-title' }, f.name || t('pgs.kind.' + f.kind)),
    badge,
    h('div', { class: 'pgs-chips' },
      chip(`${fmt(f.width)} × ${fmt(f.height)} × ${fmt(f.depth)} cm`),
      chip(t('pgs.chip.shelves', { n: f.shelves.length })),
      chip(t('pgs.chip.metres', { m: fmt(tot.shelfWidth / 100, 2) })),
      chip(t('pgs.chip.fill', { p: fmt(tot.fill, 0) })),
      chip(t('pgs.chip.facings', { n: facings })),
      chip(t('pgs.chip.skus', { n: skus }))));
}

function paintLegend() {
  els.legend.textContent = '';
  const items = S.layout.legend;
  if (!items.length) return;
  els.legend.append(h('span', { class: 'pgs-legend-h' }, t('pgs.legend.' + S.ui.colorBy)));
  for (const it of items.slice(0, 40)) {
    const name = it.key == null ? t('pgs.other') : S.ui.colorBy === 'product' ? nameOf(it.key) : String(it.key);
    els.legend.append(h('span', { class: 'pgs-legend-i' }, h('span', { class: 'pgs-sw', style: { background: it.color } }), name));
  }
}

function warnText(w) {
  const at = w.shelf == null ? t('pgs.w.fixture') : t('pgs.w.shelf', { n: w.shelf + 1 }) + (w.pos != null ? ` · ${nameOf(w.productId)}` : '');
  return `${at}: ${t('pgs.w.' + w.code, { value: fmt(w.value), limit: fmt(w.limit) })}`;
}

function paintWarnings() {
  const box = els.warn;
  box.textContent = '';
  const rows = [];
  for (const w of S.check.warnings) rows.push([w.code === 'no_dimensions' ? 'info' : 'error', warnText(w), w]);
  S.check.shelves.forEach((s, i) => { if (s.squeezed) rows.push(['warn', `${t('pgs.w.shelf', { n: i + 1 })}: ${t('pgs.w.squeezed', { value: fmt(s.usedWidth), limit: fmt(fixture().shelves[i].width) })}`, { shelf: i }]); });
  if (!rows.length) return;
  const list = h('ul', { class: 'pgs-wlist', 'aria-label': t('pgs.w.title') });
  for (const [k, msg, w] of rows) {
    list.append(h('li', {}, h('button', {
      type: 'button', class: 'pgs-w pgs-w-' + k, dataset: { code: w.code || 'squeezed' },
      onclick: () => { if (w.shelf != null) { S.ui.shelf = w.shelf; S.ui.pos = w.pos ?? null; saveUi(); paintSelection(); paintInspector(); paintPlace(); els.stage.focus(); } },
    }, iconEl(k === 'info' ? 'info' : 'warn'), h('span', {}, msg))));
  }
  box.append(list);
}

// --- stage interaction ------------------------------------------------------------------------------------------

// Screen -> drawing coordinates with the inverse of the SVG's current transformation matrix: correct at any zoom,
// scroll offset and CSS transform, unlike manual offset/scale arithmetic.
function cmPoint(e) {
  const svg = els.canvas.querySelector('svg');
  const m = svg && svg.getScreenCTM();
  if (!m) return null;
  return new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
}

// Shelf and insertion index under a point of the front view (cm).
// Nearest shelf space by vertical distance (within 15 cm); insertion index = number of blocks whose centre lies left
// of the pointer. The marker x snaps to the gap between blocks.
function dropTarget(p) {
  const L = S.layout;
  if (!L || !p) return null;
  let best = null, bd = Infinity;
  for (const s of L.spaces) {
    const d = p.y < s.y ? s.y - p.y : p.y > s.y + s.h ? p.y - s.y - s.h : 0;
    if (d < bd) { bd = d; best = s; }
  }
  if (!best || bd > 15 || p.x < -6 || p.x > L.width + 10) return null;
  const blocks = L.blocks.filter((b) => b.shelf === best.shelf);
  const index = blocks.filter((b) => b.x + b.w / 2 < p.x).length;
  const x = index < blocks.length ? blocks[index].x : blocks.length ? blocks[blocks.length - 1].x + blocks[blocks.length - 1].w : best.x;
  return { shelf: best.shelf, index, x, y: best.y, h: best.h };
}

function showMarker(tg) {
  const m = els.marker;
  if (!m) return;
  if (!tg) { m.setAttribute('visibility', 'hidden'); return; }
  m.setAttribute('x1', tg.x); m.setAttribute('x2', tg.x); m.setAttribute('y1', tg.y); m.setAttribute('y2', tg.y + tg.h);
  m.setAttribute('visibility', 'visible');
}

// Pointer model: press on a facing block starts a potential drag; under 5 px of movement it is a click (select). A
// press on empty space selects the nearest shelf. Library products arrive by HTML5 DnD (dragover must
// preventDefault to allow a drop). Pointer capture keeps the drag alive outside the canvas.
function bindStage() {
  const st = els.stage, cv = els.canvas;
  let drag = null;
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const g = e.target.closest('.pg-pos');
    if (!g) {
      const p = cmPoint(e), tg = dropTarget(p);
      if (tg) { S.ui.shelf = tg.shelf; S.ui.pos = null; saveUi(); paintSelection(); paintInspector(); paintPlace(); }
      return;
    }
    const [si, pi] = g.dataset.pos.split(':').map(Number);
    drag = { si, pi, x: e.clientX, y: e.clientY, moved: false };
    try { cv.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
    drag.moved = true;
    cv.classList.add('pgs-dragging');
    showMarker(dropTarget(cmPoint(e)));
  });
  const end = (e, cancel) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    cv.classList.remove('pgs-dragging');
    showMarker(null);
    if (cancel) return;
    if (d.moved) { const tg = dropTarget(cmPoint(e)); if (tg) movePos(d.si, d.pi, tg.shelf, tg.index); return; }
    S.ui.shelf = d.si; S.ui.pos = d.pi; saveUi();
    paintSelection(); paintInspector(); paintPlace();
    st.focus({ preventScroll: true });
  };
  cv.addEventListener('pointerup', (e) => end(e, false));
  cv.addEventListener('pointercancel', (e) => end(e, true));
  cv.addEventListener('dblclick', (e) => { const g = e.target.closest('.pg-pos'); if (g) { const p = curPos(); if (p) productDialog(product(p.productId)); } });

  // Products dragged from the library.
  st.addEventListener('dragover', (e) => {
    if (![...e.dataTransfer.types].includes('text/x-pgs-product')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    showMarker(dropTarget(cmPoint(e)));
  });
  st.addEventListener('dragleave', (e) => { if (!st.contains(e.relatedTarget)) showMarker(null); });
  st.addEventListener('drop', (e) => {
    const id = e.dataTransfer.getData('text/x-pgs-product');
    showMarker(null);
    if (!id) return;
    e.preventDefault();
    const tg = dropTarget(cmPoint(e));
    if (tg) place(id, tg.shelf, tg.index);
  });

  st.addEventListener('keydown', stageKeys);
  st.addEventListener('focus', () => announce(selectionText()));
}

// Keyboard editing of the stage (a11y and speed): arrows move the selection, Alt+arrows move the item, +/- facings
// across (Shift: up), [ ] depth, R rotate (Shift: back), T sideways turn, D auto depth, Delete remove, Enter place
// the chosen product after the selection. Every change is announced.
function stageKeys(e) {
  const f = fixture(), sh = curShelf();
  if (!sh) return;
  const n = sh.positions.length;
  const k = e.key;
  let handled = true;
  if (e.altKey && (k === 'ArrowLeft' || k === 'ArrowRight')) {
    if (S.ui.pos != null) { const to = k === 'ArrowLeft' ? S.ui.pos - 1 : S.ui.pos + 2; if (to >= 0 && to <= n) movePos(S.ui.shelf, S.ui.pos, S.ui.shelf, to); }
  } else if (e.altKey && (k === 'ArrowUp' || k === 'ArrowDown')) {
    const to = S.ui.shelf + (k === 'ArrowUp' ? -1 : 1);
    if (S.ui.pos != null && to >= 0 && to < f.shelves.length) movePos(S.ui.shelf, S.ui.pos, to, f.shelves[to].positions.length);
  } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
    if (n) S.ui.pos = S.ui.pos == null ? (k === 'ArrowLeft' ? n - 1 : 0) : Math.max(0, Math.min(n - 1, S.ui.pos + (k === 'ArrowLeft' ? -1 : 1)));
    selChanged();
  } else if (k === 'ArrowUp' || k === 'ArrowDown') {
    S.ui.shelf = Math.max(0, Math.min(f.shelves.length - 1, S.ui.shelf + (k === 'ArrowUp' ? -1 : 1)));
    const m = f.shelves[S.ui.shelf].positions.length;
    S.ui.pos = S.ui.pos == null || !m ? null : Math.min(S.ui.pos, m - 1);
    selChanged();
  } else if (k === 'Home' || k === 'End') {
    if (n) { S.ui.pos = k === 'Home' ? 0 : n - 1; selChanged(); }
  } else if (k === 'Escape') {
    S.ui.pos = null; selChanged();
  } else if ((k === '+' || k === '=' || k === '-' || k === '_') && curPos()) {
    const d = k === '+' || k === '=' ? 1 : -1, p = curPos();
    if (e.shiftKey && (k === '+' || k === '_')) setPos({ fy: p.fy + d }); else setPos({ fx: p.fx + d });
  } else if ((k === ']' || k === '[') && curPos()) {
    setPos({ fz: curPos().fz + (k === ']' ? 1 : -1) });
  } else if ((k === 'r' || k === 'R') && curPos()) {
    const p = curPos(); setPos({ rot: (p.rot + (e.shiftKey ? 270 : 90)) % 360 });
  } else if ((k === 't' || k === 'T') && curPos()) {
    setPos({ turn: curPos().turn ? 0 : 90 });
  } else if ((k === 'd' || k === 'D') && curPos()) {
    autoDepthPos();
  } else if (k === 'Delete' || k === 'Backspace') {
    if (curPos()) removePos();
  } else if (k === 'Enter' || k === 'Insert') {
    if (S.ui.placeId) place(S.ui.placeId, S.ui.shelf, S.ui.pos == null ? null : S.ui.pos + 1);
    else announce(t('pgs.place.pick'));
  } else handled = false;
  if (handled) e.preventDefault();
}

function selChanged() {
  saveUi();
  paintSelection();
  paintInspector();
  paintPlace();
  announce(selectionText());
  const b = $('.pg-pos.pgs-picked', els.canvas);
  if (b) b.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

function autoDepthPos() {
  const p = curPos(), pr = p && product(p.productId);
  if (!pr || !hasDims(pr)) return;
  setPos({ fz: autoDepth(pr, curShelf(), p.rot, p.turn) });
}

// --- shelves editor ------------------------------------------------------------------------------------------

// Shelf table: every number commits on change (one undo step per edit). Even spacing divides the free height by the
// shelf count, rounded down to 0.5 cm, never below 5 cm.
function paintShelves() {
  const f = fixture(), box = els.shelves;
  keepFocus(() => {
    box.textContent = '';
    const head = h('tr', {}, ['#', 'pgs.sh.kind', 'pgs.sh.width', 'pgs.sh.height', 'pgs.sh.depth', 'pgs.sh.board', 'pgs.sh.pitch', 'pgs.sh.fill', ''].map((k) => h('th', { scope: 'col' }, k === '#' || !k ? k : t(k))));
    const body = h('tbody');
    f.shelves.forEach((s, i) => {
      const c = S.check.shelves[i];
      const set = (k) => (v) => commit(() => { s[k] = v; });
      const num = (k, min, max, step = 0.5) => numInput(s[k], set(k), { min, max, step, label: `${t('pgs.sh.n', { n: i + 1 })} ${t('pgs.sh.' + ({ thickness: 'board' }[k] || k))}`, cls: 'pgs-num-sm' });
      const n1 = num('width', 10, 1000), n2 = num('height', 3, 300), n3 = num('depth', 3, 200), n4 = num('thickness', 0, 20);
      n1.dataset.fk = `sw${i}`; n2.dataset.fk = `sh${i}`; n3.dataset.fk = `sd${i}`; n4.dataset.fk = `st${i}`;
      const kind = h('select', { class: 'ed-input ed-select pgs-num-sm', 'aria-label': `${t('pgs.sh.n', { n: i + 1 })} ${t('pgs.sh.kind')}`, dataset: { fk: `sk${i}` } },
        ['shelf', 'peg'].map((v) => h('option', { value: v, selected: s.kind === v }, t('pgs.sh.k.' + v))));
      kind.addEventListener('change', () => commit(() => { s.kind = kind.value; if (s.kind === 'peg') s.pitch = s.pitch || 2.5; else delete s.pitch; }));
      const pitch = s.kind === 'peg' ? numInput(s.pitch, set('pitch'), { min: 0.5, max: 20, step: 0.5, label: `${t('pgs.sh.n', { n: i + 1 })} ${t('pgs.sh.pitch')}`, cls: 'pgs-num-sm' }) : h('span', { class: 'ed-hint' }, '—');
      if (pitch.dataset) pitch.dataset.fk = `sp${i}`;
      const fill = h('div', { class: 'pgs-fillbar' + (c.overflow > 0 && !c.squeezed ? ' pgs-over' : c.squeezed ? ' pgs-squeeze' : ''), title: `${fmt(c.usedWidth)} / ${fmt(s.width)} cm` },
        h('i', { style: { width: Math.min(100, c.fill) + '%' } }), h('span', {}, `${fmt(c.fill, 0)} %`));
      const ib = (ic, label, fn, dis, fk) => h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t(label), 'aria-label': `${t(label)} · ${t('pgs.sh.n', { n: i + 1 })}`, html: icon(ic), disabled: !!dis, onclick: fn, dataset: { fk } });
      const tr = h('tr', { class: i === S.ui.shelf ? 'pgs-on' : '', dataset: { shelf: String(i) } },
        h('th', { scope: 'row' }, h('button', { type: 'button', class: 'pgs-shn', onclick: () => { S.ui.shelf = i; S.ui.pos = null; selChanged(); paintShelves(); }, 'aria-label': t('pgs.sh.select', { n: i + 1 }) }, String(i + 1))),
        h('td', {}, kind), h('td', {}, n1), h('td', {}, n2), h('td', {}, n3), h('td', {}, n4), h('td', {}, pitch), h('td', {}, fill),
        h('td', { class: 'pgs-sh-act' },
          ib('up', 'pgs.sh.up', () => commit(() => { f.shelves.splice(i - 1, 0, f.shelves.splice(i, 1)[0]); S.ui.shelf = i - 1; }), i === 0, `su${i}`),
          ib('down', 'pgs.sh.down', () => commit(() => { f.shelves.splice(i + 1, 0, f.shelves.splice(i, 1)[0]); S.ui.shelf = i + 1; }), i === f.shelves.length - 1, `sdn${i}`),
          ib('copy', 'pgs.sh.dup', () => commit(() => { f.shelves.splice(i + 1, 0, { ...JSON.parse(JSON.stringify(s)), id: uid('s'), positions: [] }); S.ui.shelf = i + 1; S.ui.pos = null; }), f.shelves.length >= 30, `sc${i}`),
          ib('trash', 'pgs.sh.del', () => delShelf(i), f.shelves.length <= 1, `sx${i}`)));
      body.append(tr);
    });
    box.append(h('div', { class: 'pgs-table-wrap' }, h('table', { class: 'pgs-table' }, h('thead', {}, head), body)));
    const add = button('pgs.sh.add', 'plus', () => commit(() => {
      const last = f.shelves[S.ui.shelf] || f.shelves[f.shelves.length - 1];
      f.shelves.splice(S.ui.shelf + 1, 0, { ...JSON.parse(JSON.stringify(last)), id: uid('s'), positions: [] });
      S.ui.shelf++; S.ui.pos = null;
    }));
    add.dataset.act = 'add-shelf';
    const even = button('pgs.sh.even', 'layers', () => commit(() => {
      const thick = f.shelves.reduce((x, s) => x + (s.thickness ?? 0), 0);
      const gap = Math.max(5, Math.floor(((f.height - (f.base ?? 0) - thick) / f.shelves.length) * 2) / 2);
      for (const s of f.shelves) s.height = gap;
    }));
    const depth = button('pgs.sh.autoDepth', 'depth', () => commit(() => { f.shelves = f.shelves.map((s) => autoDepthShelf(s, S.map)); }));
    depth.dataset.act = 'auto-depth-all';
    for (const b of [add, even, depth]) b.classList.add('ed-sm');
    box.append(h('div', { class: 'ap-actions' }, add, even, depth), h('p', { class: 'ed-hint' }, t('pgs.sh.hint')));
  });
}

async function delShelf(i) {
  const f = fixture(), s = f.shelves[i];
  if (s.positions.length && !(await confirmDialog(t('pgs.sh.delQ', { n: i + 1 }), t('pgs.sh.delText', { n: s.positions.length }), t('dlg.delete'), true))) return;
  commit(() => { f.shelves.splice(i, 1); S.ui.shelf = Math.max(0, i - 1); S.ui.pos = null; });
}

// --- right column: place, position, fixture -------------------------------------------------------------------

// "Place" panel: keyboard-first placement (product + shelf + facings) with a width preview against free shelf space.
function paintPlace() {
  const box = els.place, f = fixture();
  keepFocus(() => {
    box.textContent = '';
    const prods = [...S.P.products].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 2000);
    const ps = select([{ v: '', l: 'pgs.place.choose' }, ...prods.map((p) => ({ v: p.id, l: '=' + p.name }))], S.ui.placeId, (v) => { S.ui.placeId = v; saveUi(); paintLibrarySel(); paintPlace(); });
    ps.dataset.fk = 'place-prod'; ps.id = 'pgs-place-prod';
    const ss = select(f.shelves.map((s, i) => ({ v: i, l: '=' + t('pgs.sh.n', { n: i + 1 }) + ` · ${fmt(S.check.shelves[i].freeWidth)} cm ${t('pgs.place.free')}` })), S.ui.shelf, (v) => { S.ui.shelf = +v; S.ui.pos = null; saveUi(); paintSelection(); paintInspector(); });
    ss.dataset.fk = 'place-shelf'; ss.id = 'pgs-place-shelf';
    const pr = product(S.ui.placeId);
    const sh = f.shelves[S.ui.shelf];
    let preview = null;
    if (pr && sh) {
      if (!hasDims(pr)) preview = h('div', { class: 'ed-hint ed-hint-warn' }, t('pgs.place.noDims'));
      else {
        const one = pr.width * S.ui.placeFx;
        const free = S.check.shelves[S.ui.shelf].freeWidth;
        const fz = autoDepth(pr, sh);
        preview = h('div', { class: 'ed-hint' + (one > free ? ' ed-hint-warn' : '') }, t('pgs.place.preview', { w: fmt(one), free: fmt(free), fz: S.ui.auto ? fz : 1, fy: maxStack(pr, sh) }));
      }
    }
    const go = button('pgs.place.go', 'plus', () => { if (!S.ui.placeId) { toast(t('pgs.place.pick'), 'warn'); return; } place(S.ui.placeId, S.ui.shelf, S.ui.pos == null ? null : S.ui.pos + 1); }, 'primary');
    go.dataset.act = 'place'; go.dataset.fk = 'place-go';
    const edit = button('pgs.place.edit', 'edit', () => { if (pr) productDialog(pr); });
    edit.disabled = !pr; edit.classList.add('ed-sm');
    box.append(
      field('pgs.place.product', ps),
      field('pgs.place.shelf', ss),
      h('div', { class: 'ed-grid2' },
        stepper('pgs.f.fx', S.ui.placeFx, (v) => { S.ui.placeFx = v; saveUi(); paintPlace(); }, { min: 1, max: 100, fk: 'place-fx' }),
        stepper('pgs.f.fy', S.ui.placeFy, (v) => { S.ui.placeFy = v; saveUi(); paintPlace(); }, { min: 1, max: 50, fk: 'place-fy' })),
      field('pgs.place.auto', toggle(S.ui.auto, (v) => { S.ui.auto = v; saveUi(); paintPlace(); })),
      preview || '',
      h('div', { class: 'ap-row' }, go, edit),
      h('p', { class: 'ed-hint' }, t('pgs.place.hint')));
  });
}

// Barcode symbology picked by length: 12-13 digits EAN-13, 7-8 EAN-8, anything else Code 128. Invalid input returns
// null (no preview) instead of throwing.
function eanSVG(code) {
  const c = String(code || '').replace(/\s+/g, '');
  if (!c) return null;
  const type = /^\d{12,13}$/.test(c) ? 'ean13' : /^\d{7,8}$/.test(c) ? 'ean8' : 'code128';
  try { return barcodeSVG(encode(type, c), { unit: 'px', xdim: 1.6, height: type === 'code128' ? 30 : 50, font: 9, title: c }); } catch { return null; }
}

// Inspector of the selected shelf or position: capacity, days of supply, the limits the fit engine computes (max
// facings across, max stack, auto depth) and one-click "fill" actions that apply those limits.
function paintInspector() {
  const box = els.insp;
  keepFocus(() => {
    box.textContent = '';
    const sh = curShelf(), p = curPos();
    if (!sh) return;
    if (!p) {
      const c = S.check.shelves[S.ui.shelf];
      box.append(h('div', { class: 'pgs-insp-h' }, t('pgs.sh.n', { n: S.ui.shelf + 1 })),
        kvRows([
          ['pgs.sh.width', `${fmt(sh.width)} cm`], ['pgs.sh.height', `${fmt(sh.height)} cm`], ['pgs.sh.depth', `${fmt(sh.depth)} cm`],
          ['pgs.pos.used', `${fmt(c.usedWidth)} cm (${fmt(c.fill, 0)} %)`], ['pgs.pos.free', `${fmt(c.freeWidth)} cm`],
          ['pgs.pos.count', String(sh.positions.length)]]),
        h('p', { class: 'ed-hint' }, t('pgs.pos.none')));
      return;
    }
    const pr = product(p.productId);
    const caps = productCapacity(fixture()).get(p.productId);
    const days = pr ? daysOfSupply(caps?.units ?? 0, pr.dailySales) : null;
    const bc = pr && pr.code ? eanSVG(pr.code) : null;
    box.append(h('div', { class: 'pgs-pcard' },
      h('span', { class: 'pgs-sw pgs-sw-lg', style: { background: pr?.color || keyColor(S.ui.colorBy === 'brand' ? pr?.brand : S.ui.colorBy === 'product' ? pr?.id : pr?.category) } }),
      h('div', { class: 'pgs-pcard-t' }, h('div', { class: 'pgs-insp-h' }, pr?.name ?? '?'),
        h('div', { class: 'ed-hint' }, [pr?.category, pr?.brand].filter(Boolean).join(' · ') || '—'))));
    if (bc) box.append(h('div', { class: 'pgs-ean', html: bc }));
    box.append(kvRows([
      ['pgs.f.dims', pr && hasDims(pr) ? dims(pr) + ' cm' : t('pgs.lib.noDims')],
      ['pgs.f.price', pr?.price != null ? fmtMoney(pr.price) : null],
      ['pgs.f.dailySales', pr?.dailySales != null ? fmt(pr.dailySales) : null],
      ['pgs.f.stock', pr?.stock != null ? fmt(pr.stock, 0) : null],
      ['pgs.pos.units', String(capacity(p))],
      ['pgs.pos.days', days != null ? t('pgs.days', { n: fmt(days) }) : '—'],
    ]));
    const mx = maxFacings(sh, S.map, S.ui.pos), ms = pr ? maxStack(pr, sh, p.rot, p.turn) : null;
    box.append(h('div', { class: 'pgs-steppers' },
      stepper('pgs.f.fx', p.fx, (v) => setPos({ fx: v }), { min: 1, max: 100, fk: 'pos-fx' }),
      stepper('pgs.f.fy', p.fy, (v) => setPos({ fy: v }), { min: 1, max: 50, fk: 'pos-fy' }),
      stepper('pgs.f.fz', p.fz, (v) => setPos({ fz: v }), { min: 1, max: 50, fk: 'pos-fz' })));
    if (mx != null) box.append(h('p', { class: 'ed-hint' }, t('pgs.pos.max', { fx: mx, fy: ms ?? '—', fz: pr ? autoDepth(pr, sh, p.rot, p.turn) : '—' })));
    const rot = seg(ROTATIONS.map((r) => ({ v: r, l: `=${r}°` })), p.rot, (v) => setPos({ rot: +v }), 'pgs.f.rot');
    const turn = seg([{ v: 0, l: 'pgs.turn.front' }, { v: 90, l: 'pgs.turn.side' }], p.turn, (v) => setPos({ turn: +v }), 'pgs.f.turn');
    box.append(group('pgs.f.rot', rot), group('pgs.f.turn', turn));
    const b = (label, ic, fn, dis, act) => { const x = button(label, ic, fn); x.classList.add('ed-sm'); x.disabled = !!dis; if (act) { x.dataset.act = act; x.dataset.fk = 'pa-' + act; } return x; };
    const n = sh.positions.length, f = fixture();
    box.append(h('div', { class: 'ap-actions' },
      b('pgs.pos.autoDepth', 'depth', autoDepthPos, !pr || !hasDims(pr), 'auto-depth'),
      b('pgs.pos.fillUp', 'up', () => setPos({ fy: ms }), !ms, 'fill-up'),
      b('pgs.pos.fillWidth', 'facing', () => setPos({ fx: Math.max(1, mx) }), !mx, 'fill-width')),
    h('div', { class: 'ap-actions' },
      b('pgs.pos.left', 'chevLeft', () => movePos(S.ui.shelf, S.ui.pos, S.ui.shelf, S.ui.pos - 1), S.ui.pos === 0, 'left'),
      b('pgs.pos.right', 'chevRight', () => movePos(S.ui.shelf, S.ui.pos, S.ui.shelf, S.ui.pos + 2), S.ui.pos >= n - 1, 'right'),
      b('pgs.pos.upShelf', 'up', () => movePos(S.ui.shelf, S.ui.pos, S.ui.shelf - 1, f.shelves[S.ui.shelf - 1].positions.length), S.ui.shelf === 0, 'shelf-up'),
      b('pgs.pos.downShelf', 'down', () => movePos(S.ui.shelf, S.ui.pos, S.ui.shelf + 1, f.shelves[S.ui.shelf + 1].positions.length), S.ui.shelf >= f.shelves.length - 1, 'shelf-down')),
    h('div', { class: 'ap-actions' },
      b('pgs.place.edit', 'edit', () => pr && productDialog(pr), !pr, 'edit'),
      (() => { const x = button('pgs.pos.remove', 'trash', removePos, 'danger'); x.classList.add('ed-sm'); x.dataset.act = 'remove'; return x; })()));
  });
}

function paintFixture() {
  const f = fixture(), box = els.fixture;
  keepFocus(() => {
    box.textContent = '';
    const set = (k) => (v) => commit(() => { f[k] = v; });
    const name = textInput(f.name, () => {}, { 'data-fk': 'fx-name' });
    name.addEventListener('change', () => commit(() => { f.name = name.value.slice(0, 200); }));
    const kind = select(KIND_KEYS.map((k) => ({ v: k, l: 'pgs.kind.' + k })), f.kind, (v) => commit(() => { f.kind = v; }));
    kind.dataset.fk = 'fx-kind';
    const n = (k, min, max, fk) => { const x = numInput(f[k], set(k), { min, max, step: 0.5 }); x.dataset.fk = fk; return x; };
    const sb = (label, ic, fn, kindB) => { const x = button(label, ic, fn, kindB); x.classList.add('ed-sm'); return x; };
    box.append(
      field('pgs.fx.name', name),
      field('pgs.fx.kind', kind),
      h('div', { class: 'ed-grid2' }, field('pgs.fx.width', n('width', 10, 2000, 'fx-w')), field('pgs.fx.height', n('height', 10, 400, 'fx-h'))),
      h('div', { class: 'ed-grid2' }, field('pgs.fx.depth', n('depth', 5, 300, 'fx-d')), field('pgs.fx.base', n('base', 0, 100, 'fx-b'))),
      h('div', { class: 'ap-actions' },
        sb('pgs.fx.apply', 'fitWidth', () => commit(() => { for (const s of f.shelves) { s.width = f.width; if (s.kind !== 'peg') s.depth = f.depth; } })),
        sb('pgs.fx.reshelve', 'layers', reshelve)),
      h('div', { class: 'ap-actions' },
        sb('pgs.fx.dup', 'copy', () => { const c = normFixture({ ...JSON.parse(JSON.stringify(f)), id: uid('f'), name: f.name + ' ' + t('pgs.fx.copy') }); commit(() => { S.P.fixtures.push(c); S.ui.fixtureId = c.id; }); }),
        sb('pgs.fx.del', 'trash', delFixture, 'danger')));
  });
}

// Re-shelving keeps positions by index; positions of shelves beyond the new count move to the last shelf.
async function reshelve() {
  const f = fixture();
  const inp = h('input', { type: 'number', class: 'ed-input', min: 1, max: 30, value: f.shelves.length, id: 'pgs-reshelve-n' });
  const v = await openDialog({ title: t('pgs.fx.reshelve'), body: h('div', { class: 'ed-fields' }, field('pgs.fx.count', inp), h('p', { class: 'ed-hint' }, t('pgs.fx.reshelveHint'))),
    buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('dlg.apply'), value: 'ok', primary: true }] });
  if (v !== 'ok') return;
  const count = Math.max(1, Math.min(30, parseInt(inp.value, 10) || f.shelves.length));
  commit(() => {
    const fresh = kindShelves(f.kind, f, count);
    fresh.forEach((s, i) => { if (f.shelves[i]) s.positions = f.shelves[i].positions; });
    // Positions of removed shelves go to the last shelf, nothing is lost silently.
    for (let i = count; i < f.shelves.length; i++) fresh[count - 1].positions.push(...f.shelves[i].positions);
    f.shelves = fresh;
  });
}

async function delFixture() {
  const f = fixture();
  if (!(await confirmDialog(t('pgs.fx.delQ', { name: f.name }), t('pgs.fx.delText'), t('dlg.delete'), true))) return;
  commit(() => {
    S.P.fixtures = S.P.fixtures.filter((x) => x.id !== f.id);
    for (const pg of S.P.plan.pages) for (const sh of pg.shapes) if (sh.ref === f.id) delete sh.ref;
    S.ui.fixtureId = S.P.fixtures[0]?.id || ''; S.ui.shelf = 0; S.ui.pos = null;
  });
}

// --- product dialog -------------------------------------------------------------------------------------------

// Product editor; deleting a product used on fixtures asks first and removes its positions everywhere in one undo
// step. Colour is optional: without it the drawing colours by category/brand.
async function productDialog(p) {
  const isNew = !p;
  const src = p || { name: '', code: '', category: S.ui.cat || '', brand: '', width: null, height: null, depth: null, squeeze: { x: 0, y: 0, z: 0 } };
  const cats = [...new Set(S.P.products.map((x) => x.category).filter(Boolean))].sort();
  const brands = [...new Set(S.P.products.map((x) => x.brand).filter(Boolean))].sort();
  const inp = (k, v, attrs = {}) => h('input', { class: 'ed-input', value: v ?? '', id: 'pgs-pd-' + k, ...attrs });
  const F = {
    name: inp('name', src.name, { required: true, dir: 'auto' }), code: inp('code', src.code, { inputmode: 'numeric', class: 'ed-input pgs-mono' }),
    category: inp('category', src.category, { list: 'pgs-dl-cat' }), brand: inp('brand', src.brand, { list: 'pgs-dl-brand' }),
  };
  const nums = ['width', 'height', 'depth', 'price', 'cost', 'dailySales', 'stock', 'caseUnits'];
  for (const k of nums) F[k] = inp(k, src[k], { type: 'number', min: 0, step: 'any', inputmode: 'decimal' });
  for (const a of ['x', 'y', 'z']) F['sq' + a] = inp('sq' + a, src.squeeze?.[a] ?? 0, { type: 'number', min: 0, max: 50, step: 1 });
  F.color = h('input', { type: 'color', class: 'ap-color', id: 'pgs-pd-color', value: src.color || '#94a3b8' });
  F.useColor = h('input', { type: 'checkbox', class: 'ed-switch', role: 'switch', id: 'pgs-pd-usecolor', checked: !!src.color });
  const bc = h('div', { class: 'pgs-ean' });
  const paintBc = () => { const s = eanSVG(F.code.value); bc.innerHTML = s || ''; bc.hidden = !s; };
  F.code.addEventListener('input', paintBc);
  paintBc();
  const lab = (k, el) => field('pgs.f.' + k, el);
  const body = h('div', { class: 'ed-fields pgs-pd' },
    h('datalist', { id: 'pgs-dl-cat' }, cats.map((c) => h('option', { value: c }))),
    h('datalist', { id: 'pgs-dl-brand' }, brands.map((c) => h('option', { value: c }))),
    lab('name', F.name),
    h('div', { class: 'ed-grid2' }, lab('ean', F.code), lab('caseUnits', F.caseUnits)),
    bc,
    h('div', { class: 'ed-grid2' }, lab('category', F.category), lab('brand', F.brand)),
    h('div', { class: 'pgs-grid3' }, lab('width', F.width), lab('height', F.height), lab('depth', F.depth)),
    h('div', { class: 'pgs-grid3' }, lab('sqx', F.sqx), lab('sqy', F.sqy), lab('sqz', F.sqz)),
    h('p', { class: 'ed-hint' }, t('pgs.pd.sqHint')),
    h('div', { class: 'ed-grid2' }, lab('price', F.price), lab('cost', F.cost)),
    h('div', { class: 'ed-grid2' }, lab('dailySales', F.dailySales), lab('stock', F.stock)),
    h('div', { class: 'ap-row' }, field('pgs.pd.useColor', F.useColor), F.color));
  const buttons = [{ label: t('dlg.cancel'), value: null }, { label: t('dlg.ok'), value: 'ok', primary: true }];
  if (!isNew) buttons.unshift({ label: t('dlg.delete'), value: 'del', danger: true });
  const v = await openDialog({ title: t(isNew ? 'pgs.pd.new' : 'pgs.pd.edit'), body, buttons, wide: true });
  if (v === 'del') {
    const used = S.P.fixtures.reduce((x, f) => x + f.shelves.reduce((y, s) => y + s.positions.filter((q) => q.productId === p.id).length, 0), 0);
    if (used && !(await confirmDialog(t('pgs.pd.delQ'), t('pgs.pd.delText', { n: used }), t('dlg.delete'), true))) return;
    commit(() => {
      S.P.products = S.P.products.filter((x) => x.id !== p.id);
      for (const f of S.P.fixtures) for (const s of f.shelves) s.positions = s.positions.filter((q) => q.productId !== p.id);
    });
    return;
  }
  if (v !== 'ok') return;
  const name = F.name.value.trim();
  if (!name) { toast(t('pgs.pd.noName'), 'warn'); return; }
  const raw = { id: p ? p.id : uid('p'), name, code: F.code.value.trim() || null, category: F.category.value.trim() || null, brand: F.brand.value.trim() || null, squeeze: { x: F.sqx.value, y: F.sqy.value, z: F.sqz.value } };
  for (const k of nums) raw[k] = F[k].value === '' ? null : Number(F[k].value);
  if (raw.caseUnits == null) delete raw.caseUnits;
  if (F.useColor.checked) raw.color = F.color.value;
  const np = normProduct(raw);
  commit(() => {
    if (isNew) { S.P.products.push(np); S.ui.placeId = np.id; } else S.P.products = S.P.products.map((x) => (x.id === np.id ? np : x));
  });
}

// --- import / export ---------------------------------------------------------------------------------------------

// Replace mode drops positions of products that no longer exist (they would render as unknown blocks).
async function importProducts() {
  const [file] = await pickFiles({ accept: '.csv,.tsv,.txt,.xlsx,.xlsm,.ods' });
  if (!file) return;
  let table;
  try { table = await readTable(file); } catch (e) { toast(t('pgs.imp.bad', { msg: e.message }), 'error'); return; }
  if (!table.rows.length) { toast(t('pgs.imp.empty'), 'warn'); return; }
  const r = await mappingDialog(table);
  if (!r) return;
  if (!r.products.length) { toast(t('pgs.imp.empty'), 'warn'); return; }
  if (r.mode === 'replace') {
    const ids = new Set(r.products.map((p) => p.id));
    commit(() => {
      S.P.products = r.products;
      for (const f of S.P.fixtures) for (const s of f.shelves) s.positions = s.positions.filter((q) => ids.has(q.productId));
    });
    toast(t('pgs.imp.replaced', { n: r.products.length }), 'ok');
  } else {
    const m = mergeProducts(S.P.products, r.products);
    commit(() => { S.P.products = m.products; });
    toast(t('pgs.imp.merged', { a: m.added, u: m.updated }), 'ok');
  }
}

// BOM (U+FEFF) so Excel opens UTF-8 CSV correctly; guard: true neutralises cells starting with = + - @ (CSV formula
// injection when the file is opened in a spreadsheet).
const csvText = (rows) => '﻿' + serializeCSV(rows, { guard: true });
const safeName = (s) => String(s || 'planogram').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);

function exportProducts() {
  const rows = [['name', 'ean', 'category', 'brand', 'width', 'height', 'depth', 'squeeze_x', 'squeeze_y', 'squeeze_z', 'price', 'cost', 'daily_sales', 'stock', 'case_units']];
  for (const p of S.P.products) rows.push([p.name, p.code ?? '', p.category ?? '', p.brand ?? '', p.width ?? '', p.height ?? '', p.depth ?? '', p.squeeze.x, p.squeeze.y, p.squeeze.z, p.price ?? '', p.cost ?? '', p.dailySales ?? '', p.stock ?? '', p.caseUnits ?? '']);
  download(csvText(rows), 'products.csv', 'text/csv');
}

function exportTools() {
  const b = (label, ic, fn, act, kind) => { const x = button(label, ic, fn, kind); x.classList.add('ed-sm'); x.dataset.act = act; return x; };
  return h('div', { class: 'ed-fields' },
    h('div', { class: 'ap-row pgs-x' }, b('pgs.x.svg', 'download', exportSVG, 'svg', 'primary'), b('pgs.x.png', 'image', exportPNG, 'png'), b('pgs.x.print', 'print', printDialog, 'print'), b('pgs.x.csv', 'table', exportPositions, 'csv')),
    h('div', { class: 'ed-label' }, t('pgs.prj.title')),
    h('div', { class: 'ap-row pgs-x' }, b('pgs.prj.save', 'save', saveJSON, 'save-json'), b('pgs.prj.open', 'folder', openJSON, 'open-json'), b('pgs.prj.demo', 'refresh', loadDemo, 'demo'), b('pgs.prj.new', 'filePlus', newProject, 'new')));
}

function exportSVG() {
  const f = fixture();
  download(frontSVG(f, S.map, svgOpts({ legend: true, title: f.name, scale: 4 })), safeName(f.name) + '.svg', 'image/svg+xml');
}
async function exportPNG() {
  const f = fixture();
  try { download(await svgToPng(frontSVG(f, S.map, svgOpts({ legend: true, title: f.name, scale: 4 })), 2), safeName(f.name) + '.png', 'image/png'); } catch (e) { toast(t('err.generic', { msg: e.message }), 'error'); }
}

// Print at a true scale (1:N) in millimetres; the dialog tells whether the drawing fits the printable area of the
// chosen paper/orientation (0.5 mm tolerance for rounding).
function printDialog() {
  const f = fixture();
  const info = h('div', { class: 'ed-hint', role: 'status' });
  const paint = () => {
    const [w, hh] = svgMm(frontSVG(f, S.map, svgOpts({ unit: 'mm', ratio: S.ui.ratio, legend: true, title: f.name })));
    const [pw, ph] = printable(S.ui.paper, S.ui.landscape);
    const fits = w <= pw + 0.5 && hh <= ph + 0.5;
    info.className = 'ed-hint' + (fits ? '' : ' ed-hint-warn');
    info.textContent = t('pgs.p.size', { w: fmt(w, 0), h: fmt(hh, 0), pw: fmt(pw, 0), ph: fmt(ph, 0) }) + ' ' + (fits ? t('pgs.p.fits') : t('pgs.p.noFit'));
  };
  const body = h('div', { class: 'ed-fields' },
    group('pgs.p.ratio', seg([5, 10, 20, 25, 50].map((v) => ({ v, l: '=1:' + v })), S.ui.ratio, (v) => { S.ui.ratio = +v; saveUi(); paint(); }, 'pgs.p.ratio')),
    group('pgs.p.paper', seg([{ v: 'a4', l: '=A4' }, { v: 'a3', l: '=A3' }], S.ui.paper, (v) => { S.ui.paper = v; saveUi(); paint(); }, 'pgs.p.paper')),
    field('pgs.p.landscape', toggle(S.ui.landscape, (v) => { S.ui.landscape = v; saveUi(); paint(); })),
    info, h('p', { class: 'ed-hint' }, t('pgs.p.hint')));
  paint();
  openDialog({ title: t('pgs.p.title'), body, buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('pgs.p.go'), value: 'go', primary: true }] }).then((v) => {
    if (v !== 'go') return;
    const svg = frontSVG(f, S.map, svgOpts({ unit: 'mm', ratio: S.ui.ratio, legend: true, title: f.name }));
    const fx = fixture();
    printSheet(h('div', { class: 'pgs-print-in' }, h('div', { class: 'pgs-print-svg', html: svg }),
      h('p', { class: 'pgs-print-cap' }, `${fx.name} · 1:${S.ui.ratio} · ${fmt(fx.width)} × ${fmt(fx.height)} × ${fmt(fx.depth)} cm · ${new Date().toLocaleDateString(document.documentElement.lang)}`)), { paper: S.ui.paper, landscape: S.ui.landscape });
  });
}

// Facing width per position depends on orientation: sideways turn shows depth, 90/270 rotation shows height.
function exportPositions() {
  const rows = [['fixture', 'fixture_kind', 'shelf', 'position', 'product', 'ean', 'category', 'brand', 'fx', 'fy', 'fz', 'rotation', 'turn', 'width_cm', 'units', 'daily_sales', 'days_of_supply']];
  for (const f of S.P.fixtures) f.shelves.forEach((s, si) => s.positions.forEach((p, pi) => {
    const pr = product(p.productId) || {};
    const w = hasDims(pr) ? Math.round((p.turn ? pr.depth : p.rot % 180 ? pr.height : pr.width) * p.fx * 10) / 10 : '';
    rows.push([f.name, f.kind, si + 1, pi + 1, pr.name ?? p.productId, pr.code ?? '', pr.category ?? '', pr.brand ?? '', p.fx, p.fy, p.fz, p.rot, p.turn, w, capacity(p), pr.dailySales ?? '', daysOfSupply(capacity(p), pr.dailySales) ?? '']);
  }));
  download(csvText(rows), safeName(S.P.name || 'planograms') + '-positions.csv', 'text/csv');
}

function saveJSON() {
  const data = { app: 'planogram-studio', v: 1, savedAt: new Date().toISOString(), project: S.P, versions: versionsList() };
  download(JSON.stringify(data, null, 1), safeName(S.P.name || 'planogram-project') + '.json', 'application/json');
}

async function openJSON() {
  const [file] = await pickFiles({ accept: '.json,application/json' });
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast(t('pgs.prj.bad'), 'error'); return; }
  const proj = normalizeProject(data.project ?? data);
  if (!proj.fixtures.length && !proj.products.length) { toast(t('pgs.prj.bad'), 'error'); return; }
  if (!(await confirmDialog(t('pgs.prj.openQ'), t('pgs.prj.openText', { p: proj.products.length, f: proj.fixtures.length }), t('pgs.prj.open')))) return;
  replaceProject(proj, Array.isArray(data.versions) ? data.versions : null);
  toast(t('pgs.prj.opened'), 'ok');
}

// Open/demo/new go through commit, so they can be undone (products and fixtures; see the defect note at commit).
function replaceProject(proj, versions) {
  commit(() => {
    S.P.products = proj.products; S.P.fixtures = proj.fixtures;
    S.P.plan = proj.plan; S.P.name = proj.name; S.P.settings = proj.settings;
    S.ui.fixtureId = proj.fixtures[0]?.id || ''; S.ui.shelf = 0; S.ui.pos = null;
  });
  if (versions) { versionsSave(versions); paintVersions(); }
}

async function loadDemo() {
  if (!(await confirmDialog(t('pgs.prj.demoQ'), t('pgs.prj.demoText'), t('pgs.prj.demo')))) return;
  const d = buildDemo();
  replaceProject(d.project, d.versions);
  toast(t('pgs.prj.demoDone'), 'ok');
}

async function newProject() {
  if (!(await confirmDialog(t('pgs.prj.newQ'), t('pgs.prj.newText'), t('pgs.prj.new'), true))) return;
  replaceProject(normalizeProject({ name: '', products: [], fixtures: [newFixture('gondola', t('pgs.kind.gondola') + ' 1')] }), []);
}

// --- analytics and versions (panels.js) -----------------------------------------------------------------------------

function paintAnalytics() {
  keepFocus(() => renderAnalytics(els.analytics, {
    P: S.P, fixture: fixture(), map: S.map, ui: S.ui, colorOf: (k) => keyColor(k),
    onUi: (patch) => { Object.assign(S.ui, patch); saveUi(); paintAnalytics(); },
    onSettings: (patch) => { Object.assign(S.P.settings, patch); saveProject(S.P); paintAnalytics(); },
    selectProduct: (id) => { S.ui.placeId = id; saveUi(); paintLibrarySel(); paintPlace(); },
  }));
}

function paintVersions() {
  keepFocus(() => renderVersions(els.versions, {
    P: S.P, fixture: fixture(), ui: S.ui,
    onUi: (patch) => { Object.assign(S.ui, patch); saveUi(); paintVersions(); },
    save: (name) => {
      const list = versionsList();
      list.unshift(makeVersion(name || t('pgs.ver.auto', { n: list.filter((v) => v.fixtureId === fixture().id).length + 1 }), fixture(), S.P.products));
      versionsSave(list);
      paintVersions();
      toast(t('pgs.ver.saved'), 'ok');
    },
    restore: (v) => {
      commit(() => {
        const f = normFixture({ ...v.fixture, id: v.fixtureId });
        const i = S.P.fixtures.findIndex((x) => x.id === v.fixtureId);
        if (i >= 0) S.P.fixtures[i] = f; else S.P.fixtures.push(f);
        S.ui.fixtureId = f.id; S.ui.shelf = 0; S.ui.pos = null;
      });
      toast(t('pgs.ver.restored', { name: v.name }), 'ok');
    },
    remove: (v) => { versionsSave(versionsList().filter((x) => x.id !== v.id)); paintVersions(); },
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// Start

// Global undo/redo, but not while typing in a text field (native text undo must win) or with a dialog open.
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  if (isEditable(e.target) && e.target.type !== 'checkbox' && e.target.type !== 'range') return;
  if (document.querySelector('.ed-backdrop')) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
});

// #fixture=<id> from the store page.
// The store page links here with #fixture=<id>; the hash is cleared so a reload does not re-select it.
function readHash() {
  const m = /fixture=([A-Za-z0-9_-]+)/.exec(location.hash || '');
  if (m && S.P.fixtures.some((f) => f.id === m[1])) { S.ui.fixtureId = m[1]; S.ui.shelf = 0; S.ui.pos = null; }
  if (m) history.replaceState(null, '', location.pathname + location.search);
}

startShell('plan', () => render());
S.P = loadOrDemo();
rebuildMap();
readHash();
clampSel();
render();
// Another tab saved the project: adopt it (last writer wins).
window.addEventListener('storage', (e) => { if (e.key === 'pgs-project' && e.newValue) { const p = loadProject(); if (p) { S.P = p; refresh(); } } });
