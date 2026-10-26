// textile-studio/main.js - Textile Studio: the page. The flow follows the order of making a garment - body, template,
// details - with the fabric and print editors and the exports at every step; the 2D pane (silhouettes, pattern, flats,
// cutting layout, grading, fabric draft, print repeat) and the 3D pane (the outfit draped on the body) side by side,
// tabs on phones. The Mockup mode is the quick path for merch: a blank, a body, a print, images. Projects live in the
// browser (IndexedDB) with undo / redo and travel as files.
//
// Architecture (one-way data flow):
//   UI event -> app.commit(label, mutate, {merge, live}) -> history (state.js) -> onChange(project, label)
//   -> re-render the panel (unless live) + the 2D view (debounced) + the 3D view (debounced, geo / tex split).
// The project is the single source of truth; panels are rebuilt from it on every change instead of patched (simple,
// always consistent; the panels are small enough that a rebuild costs ~1 ms). UI-only state that must not enter undo
// history (the selected piece, the fabric slot being edited, the phone tab) lives in module variables here.
// 'live' commits (slider drags) skip the panel rebuild: rebuilding would destroy the very <input type=range> the user
// is dragging and end the drag.

// Side-effect import first: registers the dictionaries before any t() below.
import './strings.js';
import { startApp, seg, button } from '../ui/app.js';
import { h } from '../ui/dom.js';
import { t, UI_STATE } from '../ui/i18n.js';
import { addIcons, iconEl } from '../ui/icons.js';
import { openMenu, toast, confirmDialog, promptDialog } from '../ui/overlays.js';
import { pickFiles } from '../ui/files.js';
import { defaultBody } from '../body/body.js';
import { draftGarment } from '../garment/garments.js';
import { draftMeasurements } from '../body/measure.js';
import { flatSVG } from '../garment/flats.js';
import { normalizeFabric } from '../fabric/fabric.js';
import { prepare, resolvePlacement, defaultFabric } from '../mockup/preview.js';
import { createViewer } from '../mockup/embed.js';
import { newProject, normalizeProject, history, store, uid, projectFile, readProjectFile, newGarment } from './state.js';
import { readPatternDXF } from '../garment/dxf.js';
import { previewOf, imagesOf, draftOf } from './compute.js';
import { createView2d } from './view2d.js';
import { bodyPanel, templatePanel, detailsPanel, fabricPanel, printPanel, exportPanel, mockupPanel } from './panels.js';
import { runExport } from './export.js';

// App-specific icons (24x24 stroke paths) registered once into the shared icon set; strings, not files: no requests.
addIcons({
  body: 'M12 4.5a2 2 0 1 0 0-.01M8 21l1.2-8L7 9.5 8.5 7h7L17 9.5 14.8 13l1.2 8',
  shirt: 'M8 3 4 6l2 4 2-1v12h8V9l2 1 2-4-4-3a4 4 0 0 1-8 0z',
  needle: 'M20 4 7 17M5 19l2-2M16 4h4v4',
  fabric: 'M4 5h16v14H4zM4 9h16M4 13h16M8 5v14M12 5v14M16 5v14',
  cube: 'M12 3 4 7.5v9L12 21l8-4.5v-9zM4 7.5 12 12l8-4.5M12 12v9',
  square: 'M4 4h16v16H4z',
  circle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
});

const LOGO = 'M8 3 4 6l2 4 2-1v12h8V9l2 1 2-4-4-3a4 4 0 0 1-8 0z';
// The steps and the 2D mode each one opens with: the 2D pane follows the step to the drawing that step edits.
const STEPS = [
  { id: 'body', icon: 'body', view2d: 'body' }, { id: 'template', icon: 'shirt', view2d: 'flats' }, { id: 'details', icon: 'needle', view2d: 'pattern' },
  { id: 'fabric', icon: 'fabric', view2d: 'fabric' }, { id: 'print', icon: 'palette', view2d: 'print' }, { id: 'export', icon: 'download', view2d: 'pattern' },
];
// Build mode injected by the bundler (dev / serverless / offline); decides the "works offline" badge below.
const mode = globalThis.IN_HTML_ARTIFACT?.mode || 'dev';
const main = document.getElementById('main');
main.classList.add('ap-wide');

// --- state -----------------------------------------------------------------------------------------------------------

// live: true only during a live commit (read by onChange). It is set and reset synchronously around hist.commit,
// which calls onChange synchronously, so no other commit can interleave.
let live = false, fabricSlot = 'shell', mockupPreset = 'female-m', stageTab = '3d';
// The piece selected on the pattern (and a layer on it): UI state, not part of the project.
let selection = null;
// onChange is a function declaration further down (hoisted), so the history can be created before it is defined.
const hist = history(newProject('studio'), (p, label) => onChange(p, label));
// The app facade handed to panels.js and export.js: they never import main.js (no cycle) and never touch the history
// directly, only through commit. Getters (viewer(), view2d()) defer access to objects created later in this file.
const app = {
  project: () => hist.state,
  commit(label, fn, o = {}) { live = !!o.live; hist.commit(label, fn, o); live = false; },
  fabricSlot: () => fabricSlot,
  setFabricSlot(s) { fabricSlot = s; view2d.setMode('fabric', hist.state); },
  refreshPanel: () => renderPanel(),
  mockupPreset: () => mockupPreset,
  setMockupPreset: (v) => { mockupPreset = v; },
  thumb,
  exporter: (kind) => runExport(kind, app),
  importProject,
  addImagePlacement,
  viewer: () => viewer,
  view2d: () => view2d,
  draft: () => draftOf(hist.state),
  selected: () => selection,
  selectPiece,
  addLayer,
  startDraw: (piece) => view2d.startDraw(piece),
  importPattern,
};

// A pattern from a DXF file (AAMA blocks or the closed polylines of a drawing) becomes a garment of the outfit.
// KNOWN DEFECT: /.dxf$/i has an unescaped dot, so it also strips e.g. 'xdxf' from 'patternxdxf'. Fix: /\.dxf$/i.
// A pattern from a DXF file (AAMA blocks or the closed polylines of a drawing) becomes a garment of the outfit.
async function importPattern() {
  const [file] = await pickFiles({ accept: '.dxf,application/dxf,image/vnd.dxf' });
  if (!file) return;
  try {
    const r = readPatternDXF(await file.text());
    if (!r.pieces.length) throw new Error(t('imp.none'));
    const name = file.name.replace(/.dxf$/i, '');
    app.commit('outfit', (q) => { q.outfit.push({ ...newGarment('imported', q.body.sex), imported: { name, pieces: r.pieces } }); q.active = q.outfit.length - 1; q.view.view2d = 'pattern'; });
    toast(t('imp.done', { n: r.pieces.length, units: r.units }), 'ok');
  } catch (e) { toast(t('imp.error', { msg: e.message }), 'error'); }
}

// Selects a piece of the active garment's pattern (null clears); the Details step shows its editor.
// The JSON comparison makes repeated clicks on the same piece a no-op (no re-render, no history step). Selecting from
// another step jumps to Details through a commit, so the step change is undoable like any navigation.
// Selects a piece of the active garment's pattern (null clears); the Details step shows its editor.
function selectPiece(piece, layer = null) {
  const prev = JSON.stringify(selection);
  selection = piece ? { piece, layer } : null;
  if (JSON.stringify(selection) === prev) return;
  if (selection && hist.state.mode === 'studio' && !['details', 'fabric'].includes(hist.state.view.step)) {
    app.commit('step', (q) => { q.view.step = 'details'; });
  } else renderPanel();
  view2d.render(hist.state);
}

// A new layer on a piece: a rectangle / ellipse in the middle of it, or a drawn polygon (points in its centimetres).
// Default size: 40 % x 25 % of the piece's bounding box, at least 3 cm, so a new layer is visible but clearly smaller
// than the piece. Polygons are stored relative to their centroid (x, y): moving the layer is then a change of two
// numbers, not of every point.
// A new layer on a piece: a rectangle / ellipse in the middle of it, or a drawn polygon (points in its centimetres).
function addLayer(piece, shape, o = {}) {
  const d = draftOf(hist.state);
  const pc = d.pieces.find((x) => x.id === piece);
  if (!pc) return;
  const xs = pc.edges.flatMap((e) => e.pts.map((q) => q[0])), ys = pc.edges.flatMap((e) => e.pts.map((q) => q[1]));
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const id = uid('ly');
  const layer = { id, piece, shape, material: o.material || 'contrast', side: 'both', sa: 1, name: o.name || '', rot: 0, ...o.box };
  if (shape === 'poly') {
    const cx = o.pts.reduce((a, q) => a + q[0], 0) / o.pts.length, cy = o.pts.reduce((a, q) => a + q[1], 0) / o.pts.length;
    Object.assign(layer, { x: cx, y: cy, pts: o.pts.map(([x, y]) => [x - cx, y - cy]), w: x1 - x0, h: y1 - y0 });
  } else if (!o.box) Object.assign(layer, { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: Math.max(3, Math.round((x1 - x0) * 0.4)), h: Math.max(3, Math.round((y1 - y0) * 0.25)) });
  app.commit('layer', (q) => { const g = q.outfit[q.active]; g.edits = g.edits || { materials: {}, layers: [] }; g.edits.layers.push(layer); });
  selection = { piece, layer: id };
  renderPanel();
  view2d.render(hist.state);
}

// --- layout ----------------------------------------------------------------------------------------------------------

// offline: true claims "works offline" (the offline single-file build); 'serverless' is the shell's weaker badge for
// the multi-file build that still needs its files served.
startApp({ key: 'textile', name: 'app.name', logo: LOGO, offline: mode === 'offline' ? true : 'serverless', onLang: () => renderAll() });

// Toolbar. Undo / redo carry data-action hooks for e2e.js; onchange (not oninput) on the name: one undo step per edit.
const nameInput = h('input', { class: 'ed-input tx-name', 'aria-label': t('tb.name'), placeholder: t('tb.untitled'), onchange: (e) => app.commit('name', (q) => { q.name = e.target.value.slice(0, 80); }) });
const undoBtn = h('button', { type: 'button', class: 'ed-iconbtn', onclick: () => hist.undo(), dataset: { action: 'undo' } }, iconEl('undo'));
const redoBtn = h('button', { type: 'button', class: 'ed-iconbtn', onclick: () => hist.redo(), dataset: { action: 'redo' } }, iconEl('redo'));
const modeSeg = seg([{ v: 'studio', l: 'tb.studio', icon: 'shirt' }, { v: 'mockup', l: 'tb.mockup', icon: 'gallery' }], 'studio', (v) => switchMode(v), 'tb.mode');
modeSeg.classList.add('tx-mode');
const menuBtn = h('button', { type: 'button', class: 'ed-btn', dataset: { action: 'project-menu' }, onclick: (e) => projectMenu(e.currentTarget) }, iconEl('folder'), h('span', { class: 'tx-hide-s' }, t('tb.projects')));
const toolbar = h('div', { class: 'tx-toolbar' }, nameInput, modeSeg, h('span', { class: 'ed-spacer' }), undoBtn, redoBtn, menuBtn);
const stepNav = h('nav', { class: 'tx-steps', 'aria-label': t('tb.steps') });
const panel = h('div', { class: 'tx-panel' });
const aside = h('aside', { class: 'tx-aside' }, stepNav, panel);
const pane2d = h('section', { class: 'tx-pane tx-pane-2d', 'aria-label': t('pane.2d') });
const pane3d = h('section', { class: 'tx-pane tx-pane-3d', 'aria-label': t('pane.3d') });
const status3d = h('div', { class: 'tx-status', role: 'status', 'aria-live': 'polite' });
const status2d = h('div', { class: 'tx-status tx-status-2d', role: 'status' });
const tools3d = h('div', { class: 'tx-3d-tools' });
const host3d = h('div', { class: 'tx-3d-host' });
pane3d.append(tools3d, host3d, status3d);
// Phone tabs: switching to 3D asks for a redraw (a canvas hidden with display:none keeps a stale size), switching to 2D
// refits (fit() refuses to fit a hidden pane, see view2d.js).
const stageTabs = seg([{ v: '2d', l: 'pane.2d' }, { v: '3d', l: 'pane.3d' }], stageTab, (v) => { stageTab = v; stage.dataset.tab = v; if (v === '3d') viewer?.redraw(); else view2d.fit(); }, 'pane.tabs');
stageTabs.classList.add('tx-stage-tabs');
const stage = h('div', { class: 'tx-stage', dataset: { tab: stageTab } }, stageTabs, pane2d, pane3d);
const work = h('div', { class: 'tx-work' }, aside, stage);
main.append(h('div', { class: 'tx-app' }, toolbar, work));

// The 2D view gets callbacks, not the app: it stays a reusable component that knows nothing about history.
const view2d = createView2d(pane2d, {
  project: () => hist.state,
  // live: the mode switch changes no panel content, so the panel is not rebuilt.
  setMode2d: (m) => { if (hist.state.view.view2d !== m) app.commit('view2d', (q) => { q.view.view2d = m; }, { live: true }); },
  status2d: (s) => { status2d.textContent = s; },
  fabricSlot: () => fabricSlot,
  selected: () => selection,
  selectPiece,
  addPolyLayer: (piece, pts) => addLayer(piece, 'poly', { pts }),
  // after a drag (live commits do not redraw the panel): the piece editor shows the result
  endDrag: () => renderPanel(),
  // Handle drag of a pattern outline: deltas are accumulated into one record per (edge, at); at is compared with a
  // tolerance because it is a float that went through JSON. Rounded to 0.01 cm so JSON keys stay short and stable.
  moveHandle: ({ piece, edge, at }, dx, dy) => app.commit('shape', (q) => {
    const g = q.outfit[q.active];
    g.edits = g.edits || { materials: {}, layers: [], shape: {} };
    g.edits.shape = g.edits.shape || {};
    const list = (g.edits.shape[piece] = g.edits.shape[piece] || []);
    let hd = list.find((x) => x.edge === edge && Math.abs(x.at - at) < 0.02);
    if (!hd) list.push((hd = { edge, at, dx: 0, dy: 0, r: 0 }));
    hd.dx = Math.round((hd.dx + dx) * 100) / 100; hd.dy = Math.round((hd.dy + dy) * 100) / 100;
  }, { merge: `shape-${piece}-${edge}-${at}`, live: true }),
  moveLayer: (id, dx, dy) => app.commit('layer', (q) => { const l = q.outfit[q.active].edits?.layers.find((x) => x.id === id); if (l) { l.x += dx; l.y += dy; } }, { merge: 'drag-' + id, live: true }),
  movePlacement: (id, dx, dy) => app.commit('placement', (q) => { const g = q.outfit[q.active]; const pl = g.placements.find((x) => x.id === id); if (pl) { pl.x += dx; pl.y += dy; } }, { merge: 'drag-' + id, live: true }),
  // Drawdown click: flips one cell of the weave and converts the fabric to a 'custom' weave carrying the full cell
  // string. The other properties of the fabric (preset, colours) are kept by the spread.
  toggleCell: (st, e, p) => app.commit('fabric', (q) => {
    const g = q.outfit[q.active];
    const cells = Array.from({ length: st.w * st.h }, (_, i) => String(st.cells[i]));
    cells[p * st.w + e] = cells[p * st.w + e] === '1' ? '0' : '1';
    g.fabrics[fabricSlot] = { ...(g.fabrics[fabricSlot] || { preset: 'poplin' }), structure: { type: 'woven', weave: 'custom', w: st.w, h: st.h, cells: cells.join('') } };
  }),
});
pane2d.append(status2d);

// --- 3D --------------------------------------------------------------------------------------------------------------

// --- 3D ---------------------------------------------------------------------------------------------------------
// geoSig / texSig: the signatures of what the viewer currently shows (compute.js previewOf).
let viewer = null, geoSig = '', texSig = '', quality = null;
function make3d() {
  viewer = createViewer(host3d, {
    label: t('pane.3d'),
    // Background follows the effective theme: an explicit data-theme wins, else the OS preference.
    background: () => (document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches) ? ['#2a2f38', '#14171c'] : ['#eef0f4', '#cdd2da']),
    onStatus: (s) => {
      pane3d.dataset.state = s.state;
      pane3d.dataset.renderer = s.mode || '';
      const pct = s.target ? Math.round((s.frame / s.target) * 100) : 100;
      status3d.textContent = s.state === 'draping' ? t('3d.draping', { pct }) : s.state === 'paused' ? t('3d.paused') : t('3d.done', { mode: t('3d.mode.' + (s.mode || 'webgl')), n: viewer?.prep?.sim.stats.particles || 0 });
    },
  });
  const b = (icon, label, fn, k) => h('button', { type: 'button', class: 'ed-iconbtn', title: t(label), 'aria-label': t(label), onclick: fn, dataset: { action: k } }, iconEl(icon));
  quality = h('select', { class: 'ed-input ed-select tx-quality', title: t('3d.quality'), 'aria-label': t('3d.quality'), onchange: (e) => app.commit('quality', (q) => { q.view.quality = e.target.value; }) },
    ['draft', 'normal', 'fine'].map((v) => h('option', { value: v }, t('3d.q.' + v))));
  tools3d.append(quality,
    b('chevLeft', '3d.front', () => viewer.setView({ yaw: 0, pitch: 0.06 }), 'view-front'),
    b('rotate', '3d.side', () => viewer.setView({ yaw: Math.PI / 2, pitch: 0.06 }), 'view-side'),
    b('chevRight', '3d.back', () => viewer.setView({ yaw: Math.PI, pitch: 0.06 }), 'view-back'),
    b('refresh', '3d.redrape', () => { geoSig = ''; update3d(true); }, 'redrape'),
    b('camera', '3d.shot', () => runExport('shot', app), 'shot'));
}

// Debounced 450 ms: a burst of edits (typing a measurement, dragging) starts ONE drape after the user pauses,
// instead of restarting the simulation on every event. now = true (load, re-drape button) skips the wait.
// Geometry changed -> full load (re-simulate); only textures changed -> refresh the existing drape. Placements are
// resolved against the drafts of the CURRENT drape (prep.drafts), so prints land on the pieces actually shown.
let t3 = 0;
function update3d(now = false) {
  clearTimeout(t3);
  t3 = setTimeout(async () => {
    const p = hist.state;
    const { spec, geo, tex } = previewOf(p);
    const images = await imagesOf(p);
    if (geo !== geoSig || !viewer.prep) {
      geoSig = geo; texSig = tex;
      try { viewer.load(prepare(spec), { images, threadZoom: p.view.threadZoom }); } catch (e) { console.error(e); status3d.textContent = t('err.generic', { msg: e.message }); }
    } else if (tex !== texSig) {
      texSig = tex;
      const prep = viewer.prep;
      const garments = spec.garments.map((g, gi) => ({ ...g, placements: g.placements.map((pl) => resolvePlacement(pl, prep.drafts[gi])) }));
      const fabricFor = (gi, mat) => normalizeFabric(garments[gi].fabrics[mat] || defaultFabric(garments[gi].garment, mat));
      viewer.refresh({ images, garments, fabricFor, threadZoom: p.view.threadZoom });
    }
  }, now ? 0 : 450);
}

// --- rendering -------------------------------------------------------------------------------------------------------

// Steps nav is hidden in mockup mode (the CSS hides an empty .tx-steps); the first three steps are numbered because
// they are a sequence, the last three are tools usable at any time.
function renderSteps() {
  const p = hist.state;
  stepNav.textContent = '';
  if (p.mode === 'mockup') return;
  STEPS.forEach((s, i) => stepNav.append(h('button', {
    type: 'button', class: 'tx-step' + (p.view.step === s.id ? ' tx-on' : ''), dataset: { step: s.id }, 'aria-current': p.view.step === s.id ? 'step' : null,
    onclick: () => goStep(s.id),
  }, iconEl(s.icon), h('span', {}, `${i < 3 ? i + 1 + '. ' : ''}${t('step.' + s.id)}`))));
}

function goStep(id) {
  const s = STEPS.find((x) => x.id === id);
  app.commit('step', (q) => { q.view.step = id; q.view.view2d = s.view2d; });
}

// The panel is rebuilt from scratch; scrollTop is saved and restored so an edit deep in a long panel does not jump
// the user back to the top. A panel that throws shows the error in place: one broken panel must not blank the page.
function renderPanel() {
  const p = hist.state;
  const scroll = panel.scrollTop;
  panel.textContent = '';
  const fns = { body: bodyPanel, template: templatePanel, details: detailsPanel, fabric: fabricPanel, print: printPanel, export: exportPanel };
  const step = p.mode === 'mockup' ? 'mockup' : p.view.step;
  panel.dataset.step = step;
  try {
    const parts = step === 'mockup' ? mockupPanel(app) : fns[step](app);
    panel.append(h('h2', { class: 'tx-panel-h' }, t(step === 'mockup' ? 'mk.title' : 'step.' + step), p.outfit.length > 1 && step !== 'body' && step !== 'mockup' ? h('small', {}, ' · ' + t('g.' + p.outfit[p.active].garment)) : null), ...parts.filter(Boolean));
  } catch (e) {
    console.error(e);
    panel.append(h('p', { class: 'ap-empty' }, t('err.generic', { msg: e.message })));
  }
  panel.scrollTop = scroll;
}

// The central reaction to every state change. Order: cheap DOM sync first, then the panel (skipped while live),
// then the 2D render (120 ms debounce while live, immediate otherwise), then 3D (its own debounce), then autosave
// (600 ms debounce: storage writes are slow and one per drag step would be wasteful).
// The selection is cleared when the piece ids it refers to may no longer exist (other garment, load, blank swap).
let t2 = 0, saveT = 0;
function onChange(p, label) {
  if (selection && ['active', 'garment', 'outfit', 'load', 'blank'].includes(label)) selection = null;
  nameInput.value = p.name;
  undoBtn.disabled = !hist.canUndo; redoBtn.disabled = !hist.canRedo;
  undoBtn.title = t('tb.undo'); redoBtn.title = t('tb.redo');
  modeSeg.set(p.mode);
  if (quality) quality.value = p.view.quality || 'normal';
  document.body.dataset.mode = p.mode;
  if (!live) { renderSteps(); renderPanel(); }
  if (view2d.mode !== p.view.view2d) view2d.setMode(p.view.view2d);
  clearTimeout(t2);
  t2 = setTimeout(() => view2d.render(hist.state), live ? 120 : 0);
  update3d(label === 'load');
  clearTimeout(saveT);
  saveT = setTimeout(() => store.save(hist.state), 600);
}

function renderAll() {
  undoBtn.setAttribute('aria-label', t('tb.undo')); redoBtn.setAttribute('aria-label', t('tb.redo'));
  onChange(hist.state, 'lang');
}

// --- helpers ---------------------------------------------------------------------------------------------------------

// Gallery thumbnails: a flat drawing of each template drafted on the default body, cached per (template, sex).
// Drafting is the expensive part and the result does not depend on the project, so the cache never needs clearing.
const thumbs = new Map();
function thumb(id) {
  const sex = hist.state.body.sex;
  const key = id + sex;
  if (!thumbs.has(key)) {
    try {
      const d = draftGarment({ garment: id }, draftMeasurements(defaultBody(sex)));
      thumbs.set(key, flatSVG(d, { view: 'front', width: 64, height: 64, fills: { shell: '#e9edf4', rib: '#d6dce7', satin: '#30333a', lining: '#c9b8e8' }, stroke: 'currentColor' }));
    } catch { thumbs.set(key, ''); }
  }
  return thumbs.get(key);
}

// Mockup mode needs a printable blank; any other garment is replaced by a plain off-white T-shirt.
function switchMode(v) {
  app.commit('mode', (q) => {
    q.mode = v;
    if (v === 'mockup' && !['tshirt', 'longsleeve', 'tank', 'sweatshirt', 'hoodie', 'tote'].includes(q.outfit[0].garment)) {
      q.outfit = [{ ...normalizeProject({ outfit: [{ garment: 'tshirt' }] }).outfit[0], fabrics: { shell: { preset: 'jersey', color: '#f4f4f2' } } }];
      q.active = 0;
    }
    q.view.view2d = v === 'mockup' ? 'pattern' : (STEPS.find((s) => s.id === q.view.step)?.view2d || 'body');
  });
}

// Reads an image, keeps it at most 1600 px, adds it to the project and places it on a print area.
// SVG is kept as is (vector, small, rasterising would lose quality). Larger rasters are downscaled through a canvas:
// the image is stored inside the project (and every undo snapshot), so a 20 MP photo would bloat everything.
// KNOWN DEFECT: a FileReader error rejects the promise and the rejection is not caught (no toast). Fix: wrap the read
// in try / catch and toast err.image.
// Reads an image, keeps it at most 1600 px, adds it to the project and places it on a print area.
async function addImagePlacement(file, area, replace = false) {
  if (!file || !/^image\//.test(file.type)) { toast(t('err.image'), 'warn'); return; }
  const src = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  let url = src;
  if (!/svg/.test(file.type)) {
    try {
      const img = new Image(); img.src = src; await img.decode();
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      if (k < 1) { const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); url = c.toDataURL('image/png'); }
    } catch { /* keep the original */ }
  }
  const id = uid('img');
  app.commit('image', (q) => {
    q.images[id] = { name: file.name.slice(0, 120), src: url };
    const g = q.mode === 'mockup' ? q.outfit[0] : q.outfit[q.active];
    const pl = { id: uid('pl'), area: area || 'front', piece: 'front', side: 'C', x: 0, y: 0, w: 22, rot: 0, art: { kind: 'image', id } };
    if (replace) g.placements = [pl]; else g.placements.push(pl);
  });
  toast(t('pr.added', { name: file.name }), 'ok');
}

async function importProject() {
  const [file] = await pickFiles({ accept: '.json,.textile,application/json' });
  if (!file) return;
  try {
    const p = readProjectFile(await file.text());
    hist.replace(p);
    toast(t('tb.imported', { name: p.name || file.name }), 'ok');
  } catch (e) { toast(t('tb.importFail', { msg: e.message }), 'error'); }
}

// The project menu is rebuilt on every open: the stored list may have changed in another tab.
// KNOWN DEFECT: the menu has two 'tb.duplicate' items (a plain in-memory copy and a saved copy with created / updated
// reset); users see two identical labels. Fix: drop the first one (the second also saves both projects).
async function projectMenu(anchor) {
  const list = await store.list();
  const cur = hist.state;
  openMenu(anchor, [
    { label: t('tb.newStudio'), icon: 'filePlus', action: () => hist.replace(newProject('studio')) },
    { label: t('tb.newMockup'), icon: 'gallery', action: () => hist.replace(newProject('mockup')) },
    { label: t('tb.duplicate'), icon: 'copy', action: () => hist.replace(normalizeProject({ ...cur, id: uid('p'), name: (cur.name || t('tb.untitled')) + ' 2' })) },
    { label: t('tb.rename'), icon: 'edit', action: async () => { const v = await promptDialog(t('tb.rename'), t('tb.name'), cur.name); if (v != null) app.commit('name', (q) => { q.name = String(v).slice(0, 80); }); } },
    { sep: true },
    { label: t('tb.duplicate'), icon: 'copy', action: async () => { await store.save(hist.state); const copy = normalizeProject({ ...JSON.parse(JSON.stringify(hist.state)), id: uid('p'), name: t('tb.copyOf', { name: cur.name || t('tb.untitled') }), created: Date.now(), updated: Date.now() }); hist.replace(copy); await store.save(copy); toast(t('tb.duplicated'), 'ok'); } },
    { label: t('tb.export'), icon: 'download', action: () => runExport('project', app) },
    { label: t('tb.import'), icon: 'upload', action: importProject },
    { sep: true },
    ...(list.length ? [{ header: true, label: t('tb.open') }] : []),
    ...list.slice(0, 12).map((x) => ({ label: `${x.name || t('tb.untitled')} · ${x.garments.map((g) => t('g.' + g)).join(', ')}`, checked: x.id === cur.id, action: async () => { const p = await store.load(x.id); if (p) hist.replace(p); } })),
    { sep: true },
    { label: t('tb.delete'), icon: 'trash', danger: true, action: async () => { if (await confirmDialog(t('tb.delete'), t('tb.deleteQ', { name: cur.name || t('tb.untitled') }), t('tb.delete'), true)) { await store.remove(cur.id); hist.replace(newProject('studio')); } } },
  ], { label: t('tb.projects') });
}

// Global undo / redo keys, except while typing: inside a field Ctrl+Z must undo the text edit, not the project.
document.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) hist.redo(); else hist.undo(); }
  else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); hist.redo(); }
});

// --- start -----------------------------------------------------------------------------------------------------------

// Start: create the viewer, then reopen the last project (async storage). Until then the default project is shown.
make3d();
(async () => {
  const last = store.last();
  const p = last ? await store.load(last) : null;
  hist.replace(p || newProject('studio'));
  document.documentElement.lang = UI_STATE.lang;
})();
// Debug / e2e handle: e2e.js drives and inspects the app through it (state, viewer stats, the draft).
window.__textile = { app, hist, get viewer() { return viewer; }, view2d };
export { app };
