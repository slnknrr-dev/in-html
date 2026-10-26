// carpet-generator/main.js - Carpet Generator: the page. A side panel in tabs (design: traditions, seed and share
// code, the gallery of exclusive designs; pattern: field, symmetry, borders, motifs; layers: the composition stack of
// ornaments, fractals and abstractions; colours: dye palettes per role; size: knots, pile, fringe, antique wash), the
// stage with four views (realistic pile with fringe, flat design, knotting chart, the rug in a room) and the knot
// editor (brushes, lines, fills, motif stamps with symmetry), yarn estimates and exports (PNG, SVG, knotting chart
// PDF, cross-stitch PDF / OXS / JSON in any thread brand, a hand-over to Embroidery Studio). The design — options,
// layers and hand edits — lives in the share code, the URL (#code=…) and localStorage.
//
// Design rules of this module:
// - One source of truth: `state` (serialisable design options). Everything visible is derived from it by
//   regenerate() -> base rug -> (hand edits applied) -> rug. The generator is deterministic in (options, seed), so the
//   share code needs only the options, never the pixels; that is why a short code can reproduce a rug of 100k+ knots.
// - `ui` holds view preferences that are not part of the design (view mode, thread brand, wear, floor): they are
//   persisted per key in localStorage but deliberately kept out of the share code, so a link reproduces the design
//   and not the sender's viewing habits.
// - Re-render by replacement: render() rebuilds the DOM of the page from state (ui/dom.js h()); no diffing. Cheap at
//   this size, and it removes the whole class of stale-widget bugs. The one exception is the stage canvas, which is
//   expensive and keeps zoom/pan: it is rebuilt only by makeView().
// - Two-speed updates: cheap controls (selects, buttons) call update() at once; continuous sliders call updateLater()
//   (250 ms trailing debounce), because a full regenerate of a large rug per input event would stall the slider.
// - Precedence of the initial design: URL hash beats localStorage beats DEFAULTS, so an opened link always shows
//   what was shared even if the visitor has their own saved rug.

// Side-effect import first: strings.js registers this app's i18n keys before any t() below runs.
import './strings.js';
import { startApp, seg, select, range, button, card, copyText, download } from '../ui/app.js';
import { h, debounce, lsGet, lsSet } from '../ui/dom.js';
import { t, UI_STATE } from '../ui/i18n.js';
import { addIcons } from '../ui/icons.js';
import { toast, openDialog } from '../ui/overlays.js';
import { randomSeed } from '../prng/prng.js';
import { generateRug, TRADITIONS, FIELDS, CORNERS, GUARDS } from '../carpet/generate.js';
import { FIELD_SYMMETRIES, WALLPAPER } from '../carpet/symmetry.js';
import { PALETTES, DYES, paletteColors } from '../carpet/dyes.js';
import { MOTIFS } from '../carpet/motifs.js';
import { encodeShare, decodeShare, cleanSeed } from '../carpet/share.js';
import { yarnEstimate } from '../carpet/estimate.js';
import { knotScheme, crossStitchScheme } from '../carpet/chart.js';
import { rugRGBA, rugSVG, drawRug, drawRoom } from '../carpet/render.js';
import { DESIGNS, designOpts } from '../carpet/designs.js';
import { applyEdits, decodeEdits, encodeEdits } from '../carpet/edits.js';
import { flatten, toJSON } from '../stitch/model.js';
import { writeOXS } from '../stitch/oxs.js';
import { exportPDF, LABELS } from '../stitch/pdf.js';
import { createChartView } from '../stitch/view.js';
import { BRANDS } from '../stitch/threads.js';
import { encodePNG } from '../png/encode.js';
import { openMotifEditor, userMotifs } from './motifs.js';
import { renderLayers } from './layers.js';
import { createEditor } from './editor.js';

// Icon path data (24x24 viewBox): rug outline, inner border, medallion. Strings, not files: zero requests.
const LOGO = 'M5 3h14v18H5zM8 6h8v12H8zM12 8l3 4-3 4-3-4z';
addIcons({ dice: 'M5 5h14v14H5zM9 9h0M15 9h0M12 12h0M9 15h0M15 15h0', rug: LOGO });
// Effective theme, evaluated per draw: an explicit data-theme wins, otherwise the system preference. Canvas painting
// cannot read CSS tokens cheaply, so the renderers receive a boolean instead.
const isDark = () => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
// Build flavour injected by singlefile.js ('offline' for the self-contained artifact); 'dev' when served from source.
const mode = (globalThis.IN_HTML_ARTIFACT && globalThis.IN_HTML_ARTIFACT.mode) || 'dev';

// The design options. Empty string / null means "auto": the generator picks per tradition and seed. Keeping auto as
// a distinct value (instead of storing the picked value) means a reseed re-rolls those choices, and the share code
// stays short because opts() drops them.
const DEFAULTS = { tradition: 'persian', seed: 'garden-of-isfahan-7', widthCm: 120, lengthCm: 180, kpsi: 64, palette: '', overrides: {}, field: '', symmetry: '', wallpaper: '', corners: '', borderMotif: '', fieldMotif: '', guards: '', borders: null, pileMm: null, fringeCm: null, layers: [], edits: '' };
let state = { ...DEFAULTS, ...lsGet('cg-state', {}) };
// Spread over DEFAULTS, not used raw: saved states from older versions lack newer keys and must still be complete.
// fromHash: regex instead of URLSearchParams because the hash may carry other &-separated keys; decodeShare returns
// null on a corrupt code, which falls back to the saved state instead of throwing at startup.
const fromHash = () => { const m = typeof location === 'undefined' ? null : /[#&]code=([^&]+)/.exec(location.hash); return m ? decodeShare(decodeURIComponent(m[1])) : null; };
const hashed = fromHash();
if (hashed) state = { ...DEFAULTS, ...hashed };
const ui = { view: 'pile', tab: lsGet('cg-tab', 'design'), brand: lsGet('cg-brand', 'dmc'), count: 14, wear: lsGet('cg-wear', 0), floor: lsGet('cg-floor', 'oak') };
// Derived state. base = generated rug; edits = hand-painted knot buffer (carpet/edits.js) or null; rug = what is shown
// (base with edits applied); scheme/chartLayer = knotting chart, built lazily because it is the costliest product and
// only the chart view and PDF need it; rev = monotonic counter stamped on each rug so renderers can cache by identity.
let base = null, rug = null, scheme = null, chartLayer = null, edits = null, rev = 0;

const main = document.getElementById('main');
// offline: true only in the offline build (badge claim audited by the build); 'serverless' otherwise (runs locally,
// but the dev page may load modules over the network). onLang re-renders: every label is read through t() at render.
startApp({ key: 'cg', name: 'app.name', logo: LOGO, offline: mode === 'offline' ? true : 'serverless', onLang: () => render() });

// Generator options from state: "auto" keys removed (the generator picks from the seed for any missing or falsy key;
// dropping them keeps the share code compact), and
// the user's motif library added (motifs live in localStorage, not in state, so they are not in the share code:
// KNOWN LIMITATION, a shared design that uses a user motif renders differently on another machine).
function opts() {
  const o = { ...state, motifs: userMotifs() };
  for (const k of ['palette', 'field', 'symmetry', 'wallpaper', 'corners', 'borderMotif', 'fieldMotif', 'guards', 'edits']) if (!o[k]) delete o[k];
  for (const k of ['borders', 'pileMm', 'fringeCm']) if (o[k] == null) delete o[k];
  if (!o.layers || !o.layers.length) delete o.layers;
  return o;
}
function shareOpts() { const o = opts(); delete o.motifs; return o; }
const code = () => encodeShare(shareOpts());
const rugTitle = () => t('trad.' + rug.meta.tradition) + ' · ' + t('field.' + rug.meta.field) + ' · ' + rug.meta.seed;
const colorOf = (role) => (rug ? (rug.palette.find((p) => p.role === role) || {}).hex || '#888' : '#888');

// Full rebuild from state. Edits are decoded against the new size: decodeEdits returns null when they no longer fit
// (size or kpsi changed), and the edits are then dropped with a warning rather than smeared over a different grid.
function regenerate() {
  base = generateRug(opts());
  edits = state.edits ? decodeEdits(state.edits, base.width, base.height) : null;
  if (state.edits && !edits) { state.edits = ''; toast(t('ke.dropped'), 'warn'); }
  composeShown();
  persist();
}
// Cheap path for painting: re-apply edits to the cached base without regenerating; invalidates the chart.
function composeShown() {
  rug = edits ? applyEdits(base, edits) : base;
  rug.__rev = ++rev;
  scheme = null;
}
// replaceState, not location.hash =: no history entry per tweak (Back leaves the page instead of undoing a slider),
// and no hashchange event, so the listener at the bottom does not re-trigger an update. try: sandboxed iframes and
// some file:// contexts throw SecurityError on history calls.
function persist() {
  lsSet('cg-state', state);
  try { history.replaceState(null, '', '#code=' + encodeURIComponent(code())); } catch { /* sandboxed */ }
}
function knotChart() {
  if (!scheme) { scheme = knotScheme(rug, { title: rugTitle() }); chartLayer = flatten(scheme); }
  return scheme;
}

// The editor owns tools and undo; this page owns the buffers. Accessors (not values) because base/edits are replaced
// on every regenerate and the editor must always see the current ones.
const editor = createEditor({
  getBase: () => base, getEdits: () => edits, setEdits: (e) => { edits = e; }, colorOf,
  // The knotting chart is rebuilt once a stroke ends; the pictures follow every move.
  onPaint: () => { composeShown(); if (view && ui.view !== 'chart') view.redraw(); },
  // Commit (stroke end, undo, clear): persist the encoded edits and patch the code field and outputs in place, not a
  // full render(), which would rebuild the canvas and lose zoom/pan mid-session.
  onCommit: () => { if (view && ui.view === 'chart') { knotChart(); view.setScheme(scheme, { keepView: true }); } state.edits = edits ? encodeEdits(edits) : ''; persist(); const ci = main.querySelector('.cg-code'); if (ci) ci.value = code(); refreshRight(); },
});

// --- layout ---
const stageHost = h('div', { class: 'cg-stage' });
let view = null;
// One canvas view (stitch/view.js, shared with Embroidery Studio) for all four modes. Chart mode feeds it a real
// stitch scheme and lets it draw symbols; the picture modes pass a stub scheme for the dimensions only and take over
// drawing with `paint`. destroy() first: the view holds listeners and a ResizeObserver that would otherwise leak.
// cellLimits [0.2, 60]: zoom range in screen px per knot, from a whole 400 cm rug down to single-knot editing.
function makeView() {
  if (view) view.destroy();
  stageHost.textContent = '';
  const chart = ui.view === 'chart';
  const size = chart ? knotChart() : { width: rug.width, height: rug.height, fabric: rug, palette: [], meta: {} };
  view = createChartView(stageHost, {
    scheme: size, layer: () => chartLayer, rulers: () => chart, cellLimits: [0.2, 60],
    paint: chart ? null : (ctx, v) => (ui.view === 'room' ? drawRoom(ctx, rug, { width: v.width, height: v.height, dark: isDark(), wear: ui.wear, floor: ui.floor }) : drawRug(ctx, rug, v, { mode: ui.view === 'pile' ? 'pile' : 'flat', fringe: true, dark: isDark(), wear: ui.wear })),
    options: () => ({ mode: 'colorSymbols', grid: true, dark: isDark() }),
    onCell: (ev) => { if (ui.view !== 'room') editor.onCell(ev); },
    panTool: () => ui.view === 'room' || editor.panTool(),
  });
}

const TABS = ['design', 'pattern', 'layers', 'colours', 'size'];
// Created once and refilled by refreshRight(), so commits can update outputs without a full render().
const right = h('div', { class: 'cg-right' });

// Full page render. Tab switches re-render only the panel (renderSide), not the stage.
function render() {
  main.textContent = '';
  const side = h('div', { class: 'ap-side cg-side' });
  const tabs = seg(TABS.map((v) => ({ v, l: 'tab.' + v })), ui.tab, (v) => { ui.tab = v; lsSet('cg-tab', v); renderSide(); }, 'tab.label');
  tabs.classList.add('cg-tabs');
  const panel = h('div', { class: 'cg-panel' });
  side.append(tabs, panel);
  const renderSide = () => { panel.textContent = ''; panel.append(...SIDE[ui.tab]()); };
  renderSide();

  // The edit bar is hidden in room view (perspective picture, no knot grid to paint on).
  // KNOWN DEFECT: the hidden attribute is set only here, on a view switch; render() rebuilds the bar via
  // editor.toolbar() without it, so after a render in room view (e.g. the floor select, which switches to room and
  // calls render()) the edit bar shows in room view. Fix: after editor.toolbar(), toggleAttribute('hidden',
  // ui.view === 'room') on the new bar.
  const viewSeg = seg([{ v: 'pile', l: 'view.pile' }, { v: 'flat', l: 'view.flat' }, { v: 'chart', l: 'view.chart' }, { v: 'room', l: 'view.room' }], ui.view, (v) => { ui.view = v; document.querySelector('.cg-editbar')?.toggleAttribute('hidden', v === 'room'); makeView(); }, 'view.label');
  const stageCard = h('section', { class: 'ap-card cg-stagecard' },
    h('div', { class: 'cg-stagehead' }, h('div', { class: 'cg-title' }, h('h2', { class: 'ap-card-h' }, rugTitle()), h('small', { class: 'ed-muted' }, t('cg.sizeLine', { w: rug.meta.widthCm, l: rug.meta.lengthCm, kw: rug.width, kh: rug.height }))), h('span', { class: 'ed-spacer' }), viewSeg,
      button('', 'zoomOut', () => view.zoomBy(0.8)), button('', 'zoomIn', () => view.zoomBy(1.25)), button('', 'fitWidth', () => view.fit())),
    editor.toolbar(),
    stageHost);
  refreshRight();
  main.append(h('div', { class: 'cg-work' }, side, h('div', { class: 'cg-center' }, stageCard, right)));
  makeView();
}

// Labelled control with an optional hint line (ed-field markup from ui/base.css).
const field = (label, ctl, hint) => h('div', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t(label)), ctl, hint ? h('span', { class: 'ed-hint' }, hint) : null);
// Keys cleared when the tradition changes: per-tradition choices (field, palette, motifs...) would be meaningless or
// clash in another tradition. Size, seed and fringe survive, since they are the user's, not the tradition's.
const RESET = { palette: '', field: '', symmetry: '', wallpaper: '', corners: '', borderMotif: '', fieldMotif: '', guards: '', borders: null, overrides: {}, pileMm: null, layers: [], edits: '' };

// Side panel builders, one per tab; each returns an array of cards. They read `rug` for the "what auto chose" hints.
const SIDE = {
  // Traditions as a radiogroup of thumbnail buttons (role=radio + aria-checked: arrow-free but announced as a single
  // choice). Thumbnails are generated asynchronously (thumb()) so the tab opens instantly and fills in.
  design() {
    const trads = h('div', { class: 'cg-trads', role: 'radiogroup', 'aria-label': t('cg.tradition') }, Object.keys(TRADITIONS).map((id) => {
      const img = h('img', { alt: '' });
      thumb('t:' + id, { tradition: id, seed: 'card', widthCm: 60, lengthCm: 90, kpsi: 16 }).then((u) => { img.src = u; });
      return h('button', { type: 'button', class: 'cg-trad' + (state.tradition === id ? ' on' : ''), role: 'radio', 'aria-checked': String(state.tradition === id), dataset: { t: id },
        onclick: () => { state = { ...state, ...RESET, tradition: id, kpsi: TRADITIONS[id].kpsi }; update(); } },
      img, h('b', {}, t('trad.' + id)));
    }));
    // 'change', not 'input': regenerate on commit (Enter/blur), not per keystroke. A new seed drops hand edits, which
    // were painted against the old picture. The refresh button below increments a trailing number ("name-7" -> "name-8").
    const seedIn = h('input', { class: 'ed-input', value: state.seed, spellcheck: 'false', 'aria-label': t('cg.seed') });
    seedIn.addEventListener('change', () => { state.seed = cleanSeed(seedIn.value); state.edits = ''; update(); });
    const codeIn = h('input', { class: 'ed-input cg-code', value: code(), spellcheck: 'false', 'aria-label': t('cg.code') });
    const gallery = h('div', { class: 'cg-gallery' }, ['regional', 'fractal', 'classic'].map((g) => h('div', { class: 'cg-gal-group' }, h('h3', { class: 'cg-subh' }, t('gal.' + g)),
      h('div', { class: 'cg-gal' }, DESIGNS.filter((d) => d.group === g).map((d) => {
        const img = h('img', { alt: '' });
        thumb('d:' + d.id, { ...d.opts, kpsi: Math.min(16, d.opts.kpsi), widthCm: d.opts.widthCm, lengthCm: d.opts.lengthCm }).then((u) => { img.src = u; });
        return h('button', { type: 'button', class: 'cg-design', dataset: { d: d.id }, title: t('design.' + d.id), onclick: () => { state = { ...DEFAULTS, ...designOpts(d.id) }; update(); toast(t('design.' + d.id), 'ok'); } }, img, h('span', {}, t('design.' + d.id)));
      })))));
    return [
      card('cg.tradition', trads, h('p', { class: 'ed-hint' }, t('tradDesc.' + state.tradition)),
        button('cg.surprise', 'sparkle', () => { const ids = Object.keys(TRADITIONS); const id = ids[Math.floor(Math.random() * ids.length)]; state = { ...state, ...RESET, tradition: id, seed: randomSeed(), kpsi: TRADITIONS[id].kpsi }; update(); })),
      card('cg.seedCard',
        h('div', { class: 'ed-row cg-seedrow' }, seedIn, button('', 'dice', () => { state.seed = randomSeed(); state.edits = ''; update(); }), button('', 'refresh', () => { state.seed = cleanSeed(state.seed.replace(/-?\d+$/, '') + '-' + ((parseInt((/\d+$/.exec(state.seed) || ['0'])[0], 10) + 1))); state.edits = ''; update(); })),
        field('cg.code', h('div', { class: 'ed-row' }, codeIn, button('', 'copy', () => copyText(code(), t('cg.codeCopied'))), button('', 'check', () => { const d = decodeShare(codeIn.value); if (!d) { toast(t('cg.badCode'), 'error'); return; } state = { ...DEFAULTS, ...d }; update(); })), t('cg.codeHint')),
        button('cg.copyLink', 'link', () => copyText(location.href.split('#')[0] + '#code=' + encodeURIComponent(code()), t('cg.linkCopied')))),
      card('gal.title', h('p', { class: 'ed-hint' }, t('gal.lead')), gallery),
    ];
  },
  // Every select offers "auto" (''); labels prefixed '=' are literal (ui/app.js select() skips translation for them).
  pattern() {
    const auto = (k, list, prefix) => select([{ v: '', l: 'cg.auto' }, ...list.map((v) => ({ v, l: prefix ? prefix + v : '=' + v }))], state[k] || '', (v) => { state[k] = v; update(); });
    const motifList = (kind) => [...Object.values(MOTIFS).filter((m) => m.kind === kind), ...userMotifs().filter((m) => m.kind === kind)];
    const motifSel = (k, kind) => select([{ v: '', l: 'cg.auto' }, ...motifList(kind).map((m) => ({ v: m.id, l: MOTIFS[m.id] ? 'motif.' + m.id : '=' + m.name }))], state[k] || '', (v) => { state[k] = v; update(); });
    return [card('cg.designCard',
      field('cg.field', auto('field', FIELDS, 'field.')),
      field('cg.symmetry', auto('symmetry', FIELD_SYMMETRIES, 'sym.')),
      field('cg.wallpaper', auto('wallpaper', WALLPAPER), t('cg.wallpaperHint')),
      field('cg.corners', auto('corners', CORNERS, 'corner.')),
      field('cg.guards', auto('guards', GUARDS, 'guard.')),
      field('cg.borders', select([{ v: '', l: 'cg.auto' }, ...[0, 1, 2, 3, 4].map((v) => ({ v, l: '=' + v }))], state.borders == null ? '' : state.borders, (v) => { state.borders = v === '' ? null : +v; update(); })),
      field('cg.borderMotif', motifSel('borderMotif', 'border')),
      field('cg.fieldMotif', motifSel('fieldMotif', 'field')),
      button('cg.motifEditor', 'edit', () => openMotifEditor({ onSave: () => update() })),
      h('p', { class: 'ed-hint' }, t('cg.chosen', { field: t('field.' + rug.meta.field), sym: t('sym.' + rug.meta.symmetry), wp: rug.meta.wallpaper, corners: t('corner.' + rug.meta.corners), palette: t('pal.' + rug.meta.palette) })))];
  },
  layers() {
    const host = h('div', { class: 'cg-layers' });
    const motifs = [...Object.values(MOTIFS).filter((m) => m.kind === 'field').map((m) => ({ id: m.id, label: t('motif.' + m.id) })), ...userMotifs().map((m) => ({ id: m.id, label: m.name }))];
    renderLayers(host, {
      layers: state.layers || [], fieldLayers: rug.meta.fieldLayers || [], motifs, colorOf,
      // Adopting the field layers sets field to 'plain', so the generator stops drawing them underneath the copies.
      onChange: (layers, { adopt }) => { state.layers = layers; if (adopt) state.field = 'plain'; update(); },
    });
    return [card('ly.title', host)];
  },
  // Per-role overrides: a hex from the colour input or a dye id from the select; both stored in state.overrides and
  // resolved by paletteColors(). Choosing another palette clears overrides (they belonged to the old palette).
  colours() {
    const pal = paletteColors(rug.meta.palette, state.overrides);
    return [card('cg.paletteCard',
      field('cg.palette', select([{ v: '', l: 'cg.auto' }, ...Object.keys(PALETTES).map((v) => ({ v, l: 'pal.' + v }))], state.palette || '', (v) => { state.palette = v; state.overrides = {}; update(); })),
      h('div', { class: 'cg-roles' }, pal.map((c) => {
        const inp = h('input', { type: 'color', class: 'ap-color', value: c.hex, title: t('role.' + c.role) });
        inp.addEventListener('change', () => { state.overrides = { ...state.overrides, [c.role]: inp.value }; update(); });
        const dyeSel = select([{ v: '', l: '=…' }, ...Object.keys(DYES).map((d) => ({ v: d, l: 'dye.' + d }))], '', (v) => { if (v) { state.overrides = { ...state.overrides, [c.role]: v }; update(); } });
        dyeSel.classList.add('cg-dyesel');
        dyeSel.title = t('cg.dyeChoose');
        return h('div', { class: 'cg-role' }, inp, h('span', { class: 'cg-role-t' }, h('b', {}, t('role.' + c.role)), h('small', {}, c.dye === 'custom' ? t('cg.custom') : t('dyeName.' + dyeKey(c)))), dyeSel);
      })),
      Object.keys(state.overrides || {}).length ? button('cg.resetColors', 'refresh', () => { state.overrides = {}; update(); }) : null)];
  },
  // kpsi = knots per square inch, the trade measure of rug fineness; the list is mostly perfect squares (3^2..20^2, with
  // gaps, plus 160) so knots per inch, sqrt(kpsi), is a round figure; it is shown alongside. Sliders use updateLater (see module rules).
  size() {
    return [card('cg.size',
      field('cg.width', range({ min: 30, max: 400, step: 5, value: state.widthCm, unit: ' ' + t('u.cm'), onInput: (v) => { state.widthCm = v; updateLater(); } })),
      field('cg.length', range({ min: 30, max: 600, step: 5, value: state.lengthCm, unit: ' ' + t('u.cm'), onInput: (v) => { state.lengthCm = v; updateLater(); } })),
      field('cg.kpsi', select([9, 16, 25, 36, 49, 64, 81, 100, 121, 144, 160, 196, 225, 256, 324, 400].map((v) => ({ v, l: '=' + t('cg.kpsiN', { n: v, kpi: Math.round(Math.sqrt(v) * 10) / 10 }) })), state.kpsi, (v) => { state.kpsi = +v; update(); }), t('cg.knots', { w: rug.width, h: rug.height, n: (rug.width * rug.height).toLocaleString(UI_STATE.lang) })),
      state.edits ? h('p', { class: 'ed-hint cg-warn' }, t('ke.sizeWarn')) : null,
      field('cg.pile', range({ min: 3, max: 60, step: 1, value: rug.pileMm, unit: ' ' + t('u.mm'), onInput: (v) => { state.pileMm = v; updateLater(); } })),
      field('cg.fringe', range({ min: 0, max: 20, step: 1, value: rug.fringeCm, unit: ' ' + t('u.cm'), onInput: (v) => { state.fringeCm = v; updateLater(); } }))),
    card('cg.look',
      field('cg.wear', range({ min: 0, max: 1, step: 0.05, value: ui.wear, onInput: (v) => { ui.wear = v; lsSet('cg-wear', v); if (view) view.redraw(); } }), t('cg.wearHint')),
      field('cg.floor', select(['oak', 'stone', 'concrete'].map((v) => ({ v, l: 'floor.' + v })), ui.floor, (v) => { ui.floor = v; lsSet('cg-floor', v); if (ui.view !== 'room') { ui.view = 'room'; render(); } else view.redraw(); })))];
  },
};

// Outputs and the yarn estimate. Exports are built on click (closures read the current rug), never precomputed.
function refreshRight() {
  right.textContent = '';
  const est = yarnEstimate(rug);
  const fmt = (n, d = 0) => Number(n).toLocaleString(UI_STATE.lang, { maximumFractionDigits: d });
  right.append(
    card('cg.outputs',
      h('div', { class: 'cg-outs' },
        button('cg.png', 'image', () => exportPNG()), button('cg.svg', 'image', () => download(rugSVG(rug, { cell: 4 }), fileName('svg'), 'image/svg+xml')),
        button('cg.roomPng', 'image', () => exportRoom()),
        button('cg.chartPdf', 'file', () => download(exportPDF(knotChart(), { style: 'color', labels: labels(), rasterText, cellMm: 3 }), fileName('knotting.pdf'), 'application/pdf'))),
      h('h3', { class: 'cg-subh' }, t('cg.crossStitch')),
      h('div', { class: 'ed-row' }, select(BRANDS.map((b) => ({ v: b.id, l: '=' + b.brand })), ui.brand, (v) => { ui.brand = v; lsSet('cg-brand', v); }),
        h('label', { class: 'cg-inl' }, t('cg.csCount'), select([11, 14, 16, 18].map((v) => ({ v, l: '=' + v })), ui.count, (v) => { ui.count = +v; }))),
      h('div', { class: 'cg-outs' },
        button('cg.csPdf', 'file', () => download(exportPDF(cs(), { style: 'color', labels: labels(), rasterText }), fileName('cross-stitch.pdf'), 'application/pdf')),
        button('cg.csOxs', 'export', () => download(writeOXS(cs()), fileName('oxs'), 'application/xml')),
        button('cg.csJson', 'save', () => download(toJSON(cs()), fileName('stitch.json'), 'application/json')),
        button('cg.toStudio', 'send', () => toStudio(), 'primary'))),
    card('cg.estimate',
      h('div', { class: 'cg-totals' },
        stat('cg.knotsTotal', fmt(est.knots)), stat('cg.pileYarn', fmt(est.pileGrams / 1000, 2) + ' ' + t('u.kg')), stat('cg.warp', fmt(est.warpMeters) + ' ' + t('u.m')),
        stat('cg.weft', fmt(est.weftMeters) + ' ' + t('u.m')), stat('cg.hours', fmt(est.hours)), stat('cg.tufted', fmt(est.tuftedGrams / 1000, 2) + ' ' + t('u.kg'))),
      h('table', { class: 'cg-table' }, h('thead', {}, h('tr', {}, h('th', {}, t('cg.color')), h('th', {}, t('cg.dye')), h('th', { class: 'num' }, t('cg.knotsCol')), h('th', { class: 'num' }, t('cg.grams')))),
        h('tbody', {}, est.colors.sort((a, b) => b.knots - a.knots).map((c) => h('tr', {}, h('td', {}, h('span', { class: 'cg-sw', style: { background: c.hex } }), t('role.' + c.role)), h('td', {}, c.dye === 'custom' ? t('cg.custom') : t('dyeName.' + dyeKey(c))), h('td', { class: 'num' }, fmt(c.knots)), h('td', { class: 'num' }, fmt(c.grams)))))),
      h('p', { class: 'ed-hint' }, t('cg.estimateNote'))));
}
// Reverse lookup dye by hex for the label; 'madderRed' fallback keeps a label even for an unmatched colour.
const dyeKey = (c) => Object.keys(DYES).find((k) => DYES[k].hex === c.hex) || 'madderRed';
const stat = (k, v) => h('div', { class: 'cg-stat' }, h('small', {}, t(k)), h('b', {}, v));
const fileName = (ext) => 'rug-' + rug.meta.tradition + '-' + rug.meta.seed + '.' + ext;

function cs() { return crossStitchScheme(rug, { brand: ui.brand, title: rugTitle(), count: ui.count || 14 }); }
function labels() { const o = {}; for (const k of Object.keys(LABELS)) o[k] = t('pdf.' + k); return o; }
// Text for the PDF writer as an alpha bitmap. stitch/pdf.js uses the standard PDF fonts for cp1252 text and calls this
// hook only for other scripts (Cyrillic, Georgian, CJK), which those fonts cannot show and which it does not embed
// fonts for; the browser's own font stack renders any script.
// scale 6: supersampled so the text stays crisp when printed. The font is set twice on purpose: resizing a canvas
// resets its whole 2D context state, font included. Only the alpha channel is kept (black text, colour by the PDF).
function rasterText(text, { size, bold }) {
  const scale = 6;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = `${bold ? 700 : 400} ${size * scale}px Arial, "Noto Sans", "Noto Sans Georgian", Sylfaen, sans-serif`;
  g.font = font;
  const m = g.measureText(text);
  const asc = Math.ceil(m.actualBoundingBoxAscent || size * scale * 0.8), desc = Math.ceil(m.actualBoundingBoxDescent || size * scale * 0.25);
  c.width = Math.max(1, Math.ceil(m.width) + 2); c.height = Math.max(1, asc + desc + 2);
  g.font = font; g.fillText(text, 1, asc + 1);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const alpha = new Uint8Array(c.width * c.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = d[i * 4 + 3];
  return { width: c.width, height: c.height, scale, ascent: asc + 1, alpha };
}
// Integer upscale 1..4 so the long side approaches 2400 px; integer keeps knots as crisp squares. Encoded by our own
// PNG writer from RGBA (no canvas), so the export is identical across browsers.
function exportPNG() {
  const k = Math.max(1, Math.min(4, Math.floor(2400 / Math.max(rug.width, rug.height))));
  const img = rugRGBA(rug, { scale: k, pile: ui.view !== 'flat', fringe: true, wear: ui.wear });
  download(encodePNG(img), fileName('png'), 'image/png');
}
// Room picture always in light mode (dark: false): an exported image should not depend on the viewer's theme.
function exportRoom() {
  const c = document.createElement('canvas');
  c.width = 1800; c.height = 1200;
  drawRoom(c.getContext('2d'), rug, { width: c.width, height: c.height, dark: false, wear: ui.wear, floor: ui.floor });
  c.toBlob((b) => b && download(b, fileName('room.png'), 'image/png'), 'image/png');
}
// The cross-stitch version handed over to Embroidery Studio (same site, same browser) and saved as a file.
// localStorage works as the channel because both apps share an origin; the file download is the fallback when
// storage is full (large charts exceed the ~5 MB quota) or the apps are opened from different origins.
function toStudio() {
  const json = toJSON(cs());
  try { localStorage.setItem('stitch-handoff', json); } catch { /* storage full or blocked */ }
  download(json, fileName('stitch.json'), 'application/json');
  openDialog({ title: t('cg.toStudio'), body: h('div', {}, h('p', {}, t('cg.toStudioLead')), h('p', { class: 'ed-hint' }, t('cg.toStudioHint'))) });
}

// Thumbnails (small seeded rugs), drawn one after another so the page stays responsive; cached per session.
// A promise chain serialises the work; setTimeout(0) yields to the event loop between thumbnails so input and paint
// interleave (Promise.all would generate all of them in one long task). The Map caches the promise itself, so a
// re-render during generation reuses the pending job instead of queueing a duplicate. Errors resolve to '' (empty
// image) so one bad recipe cannot break the chain for all later thumbnails.
const thumbs = new Map();
let thumbQueue = Promise.resolve();
function thumb(key, o) {
  if (thumbs.has(key)) return thumbs.get(key);
  const p = thumbQueue = thumbQueue.then(() => new Promise((resolve) => setTimeout(() => {
    try {
      const r = generateRug(o);
      const img = rugRGBA(r, { scale: 1, pile: true, fringe: true });
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      c.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
      resolve(c.toDataURL('image/png'));
    } catch { resolve(''); }
  }, 0)));
  thumbs.set(key, p);
  return p;
}

// A design change invalidates undo history (snapshots refer to the old grid), hence editor.reset().
function update() { regenerate(); editor.reset(); render(); }
const updateLater = debounce(update, 250);

// A pasted link or Back/Forward: adopt the hash only if it encodes a different design than the current one, which
// also makes the listener idempotent against our own URL writes.
window.addEventListener('hashchange', () => { const d = fromHash(); if (d && encodeShare(d) !== code()) { state = { ...DEFAULTS, ...d }; update(); } });
regenerate();
render();
