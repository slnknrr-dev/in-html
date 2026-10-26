// digitalrain-effect/main.js - the digital rain creator: live full-bleed preview, parameter panel, presets,
// random sets, share code in the URL hash (local only) and exports.
//
// Architecture: S.p is the single source of truth, always normalized (rain/params.js normalizeParams clamps and
// fills every field), so the engine, panel and exporters never see a partial or out-of-range set. Every change goes
// through apply(), which renormalizes, recomputes the matching preset, pushes engine params, persists and refreshes
// the panel. The rendering engine (rain/engine.js) is shared with the exported pages, so the preview is exactly
// what an export will show.
// Persistence has two channels: the URL hash (a compact share code; reloading or sharing the link restores the set)
// and localStorage (also keeps a background image, which is too large for a URL). The hash wins on load because it
// is what the user explicitly opened. "Local only": the code lives in the fragment, which browsers never send to a
// server.
import './strings.js';
import { copyText, startApp, t, toast } from '../ui/app.js';
import { h, $, debounce, lsGet, lsSet, isEditable } from '../ui/dom.js';
import { addIcons, iconEl } from '../ui/icons.js';
import { layers, openMenu } from '../ui/overlays.js';
import { rainEngine } from '../rain/engine.js';
import { engineParams, normalizeParams, encodeParams, decodeParams, presetParams, randomParams, matchPreset } from '../rain/params.js';
import { renderPanel, syncPanel } from './panel.js';
import { openExport, snapshotPNG } from './exporter.js';

addIcons({
  rain: 'M5 3v5M5 12v2M5 18v3M10 6v9M10 19v2M15 3v3M15 10v7M20 5v5M20 14v6',
  dice: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 7.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1zM16 7.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1zM12 11.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1zM8 15.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1zM16 15.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1z',
  maximize: 'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3',
  minimize: 'M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3',
  record: 'M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  code: 'M16 18l6-6-6-6M8 6l-6 6 6 6',
});

const KEY = 'rain';
const S = {
  p: null,            // normalized parameters
  preset: '',         // id of the matching preset ('' = custom)
  engine: null,
  playing: true,
  undo: null,         // parameters before the last random / preset / code
};
let stage = null, canvas = null, chip = null, hud = null, panel = null;

// ---- parameters ---------------------------------------------------------------------------------------------------
function initialParams() {
  const fromHash = decodeParams(location.hash);
  if (fromHash) return fromHash;
  const saved = lsGet(KEY + '-params', null);
  return saved ? normalizeParams(saved) : presetParams('classic');
}

// Debounced 250 ms: a slider drag would otherwise rewrite history and storage dozens of times per second.
// replaceState, not location.hash =: no history entry per tweak (Back should leave the app, not undo a slider), and
// no hashchange event (which would feed back into ctl.code). try/catch: sandboxed iframes may forbid replaceState.
const persist = debounce(() => {
  const code = encodeParams(S.p);
  try { history.replaceState(null, '', location.pathname + location.search + '#' + code); } catch { /* sandboxed */ }
  // Large background images do not fit the storage quota: keep the rest. 1.5e6 characters of data: URL leaves room
  // in the typical 5 MB per-origin quota for other keys; the mode falls back to 'color' so the restored set is
  // consistent (an 'image' background without an image).
  const keep = S.p.bgImage && S.p.bgImage.length > 1.5e6 ? { ...S.p, bgImage: '', bgMode: S.p.bgMode === 'image' ? 'color' : S.p.bgMode } : S.p;
  lsSet(KEY + '-params', keep);
}, 250);

// Applies a parameter change. `big` changes (preset, random, code) remember the previous set for undo and re-render
// the panel; small ones (a slider) only sync dependent controls.
function apply(next, { big = false, undoMsg = '' } = {}) {
  const prev = S.p;
  S.p = normalizeParams(next);
  S.preset = matchPreset(S.p);
  S.engine.set(engineParams(S.p));
  stage.classList.toggle('dr-transparent', S.p.bgMode === 'transparent');
  persist();
  updateChip();
  if (big) {
    S.undo = prev;
    renderPanel(panel, S, ctl);
    if (undoMsg) toast(undoMsg, 'info', { label: t('dr.undo'), fn: undo });
  } else syncPanel(panel, S);
}
// One-level undo for the big, surprising changes (random, preset, pasted code); apply() sets S.undo to the replaced
// set, so it is cleared again afterwards: undoing an undo is not offered (no redo stack).
function undo() {
  if (!S.undo) return;
  const p = S.undo;
  S.undo = null;
  apply(p, { big: true });
  S.undo = null;
}

// The controller handed to the panel and the exporter: the only way they change state, so panel.js and exporter.js
// need no knowledge of persistence, undo or the engine.
// code(): a pasted code never carries the background image (too large for a code), so when it asks for a colour
// background and an image is loaded, the image is kept for a later switch back.
const ctl = {
  set: (k, v) => apply({ ...S.p, [k]: v }),
  setMany: (o, rerender = false) => apply({ ...S.p, ...o }, { big: rerender }),
  refresh: () => renderPanel(panel, S, ctl),
  preset: (id) => apply(presetParams(id, S.p), { big: true }),
  random: () => apply(randomParams(Math.random, S.p), { big: true, undoMsg: t('dr.randomized') }),
  code: (code) => {
    const p = decodeParams(code);
    if (!p) { toast(t('dr.share.bad'), 'warn'); return false; }
    if (S.p.bgImage && p.bgMode === 'color') { p.bgImage = S.p.bgImage; }
    apply(p, { big: true, undoMsg: t('dr.share.applied') });
    return true;
  },
  shareURL: () => location.href.split('#')[0] + '#' + encodeParams(S.p),
  shareCode: () => encodeParams(S.p),
  engine: () => S.engine,
  stageSize: () => { const r = canvas.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; },
  pause: () => { if (S.playing) togglePlay(); },
};

// ---- stage ----------------------------------------------------------------------------------------------------------
function hudBtn(ic, label, onclick, extra = '') {
  return h('button', { type: 'button', class: 'dr-hud-btn' + extra, title: t(label), 'aria-label': t(label), dataset: { l: label }, onclick }, iconEl(ic));
}

// Pause stops the engine's animation loop (no CPU/GPU use), not just the drawing.
function togglePlay() {
  S.playing = !S.playing;
  if (S.playing) S.engine.start(); else S.engine.stop();
  renderHud();
  updateChip();
}

// Fullscreen on the stage element, not the document: only the rain and its HUD fill the screen. Optional chaining
// covers browsers without the unprefixed API (older iOS Safari); a rejected request (not triggered by a user
// gesture, iframe without allowfullscreen) becomes a toast.
function isFull() { return document.fullscreenElement === stage; }
function toggleFull() {
  if (isFull()) document.exitFullscreen?.().catch(() => {});
  else stage.requestFullscreen?.().catch(() => toast(t('dr.noFull'), 'warn'));
}

// HUD = overlay toolbar on the stage. Rebuilt (not patched) when play state or fullscreen changes: eight buttons,
// cheaper to rebuild than to track individually. Icon-only buttons carry aria-label; data-l keeps the label key.
function renderHud() {
  hud.textContent = '';
  hud.setAttribute('aria-label', t('dr.toolbar'));
  hud.append(
    hudBtn(S.playing ? 'pause' : 'play', S.playing ? 'dr.pause' : 'dr.play', togglePlay),
    hudBtn('dice', 'dr.random', () => ctl.random()),
    h('span', { class: 'dr-hud-sep', 'aria-hidden': 'true' }),
    hudBtn(isFull() ? 'minimize' : 'maximize', isFull() ? 'dr.exitFull' : 'dr.fullscreen', toggleFull),
    hudBtn('camera', 'dr.snapshot', () => snapshotPNG(S)),
    hudBtn('link', 'dr.share.link', () => copyText(ctl.shareURL())),
    h('span', { class: 'dr-hud-sep', 'aria-hidden': 'true' }),
    h('button', { type: 'button', class: 'dr-hud-btn dr-hud-export', 'aria-haspopup': 'menu', title: t('dr.export'), onclick: (e) => exportMenu(e.currentTarget) }, iconEl('download'), h('span', { class: 'dr-hud-l' }, t('dr.export'))),
  );
}

function exportMenu(anchor) {
  openMenu(anchor, [
    { label: t('dr.ex.html'), icon: 'file', action: () => openExport('html', S, ctl) },
    { label: t('dr.ex.embed'), icon: 'code', action: () => openExport('embed', S, ctl) },
    { label: t('dr.ex.video'), icon: 'record', action: () => openExport('video', S, ctl) },
    { sep: true },
    { label: t('dr.ex.png'), icon: 'camera', action: () => snapshotPNG(S) },
    { label: t('dr.ex.wall'), icon: 'image', action: () => openExport('wallpaper', S, ctl) },
  ]);
}

// Status chip: preset name (or "custom") and the measured FPS. aria-live="off": it updates every second, and
// announcing that would flood a screen reader.
function updateChip() {
  if (!chip) return;
  chip.textContent = '';
  const name = S.preset ? t('dr.preset.' + S.preset) : t('dr.custom');
  chip.classList.toggle('dr-paused', !S.playing);
  chip.append(h('span', { class: 'dr-dot', 'aria-hidden': 'true' }), h('span', { class: 'dr-chip-name' }, name),
    h('span', { class: 'dr-chip-fps' }, S.playing ? t('dr.fps', { n: S.engine ? S.engine.fps || '–' : '–' }) : t('dr.paused')));
}

function buildStage() {
  canvas = h('canvas', { class: 'dr-canvas', role: 'img', 'aria-label': t('dr.ex.label') });
  chip = h('div', { class: 'dr-chip', 'aria-live': 'off' });
  hud = h('div', { class: 'dr-hud', role: 'toolbar' });
  stage = h('section', { class: 'dr-stage', 'aria-label': t('dr.stage') }, canvas, chip, hud);
  stage.addEventListener('dblclick', (e) => { if (e.target === canvas) toggleFull(); });
  // In full screen the toolbar fades out while the pointer rests.
  let idleT = 0;
  const wake = () => { stage.classList.remove('dr-idle'); clearTimeout(idleT); if (isFull()) idleT = setTimeout(() => stage.classList.add('dr-idle'), 2200); };
  stage.addEventListener('pointermove', wake);
  document.addEventListener('fullscreenchange', () => { renderHud(); wake(); });
}

// Startup and language switch. The stage (canvas + running engine) is created once and never rebuilt: recreating it
// would restart the animation and drop its canvas state. Only labels are updated; the panel is rebuilt.
function renderAll() {
  const main = $('#main');
  canvas.setAttribute('aria-label', t('dr.ex.label'));
  stage.setAttribute('aria-label', t('dr.stage'));
  if (!main.contains(stage)) {
    panel = h('aside', { class: 'dr-panel', 'aria-label': t('dr.panel') });
    main.append(h('div', { class: 'dr-studio' }, stage, panel));
  }
  panel.setAttribute('aria-label', t('dr.panel'));
  renderHud();
  updateChip();
  renderPanel(panel, S, ctl);
}

// ---- keyboard -------------------------------------------------------------------------------------------------------
// Shortcuts: Space play/pause, R random, F fullscreen, Z undo. Ignored with modifiers (browser shortcuts), while an
// overlay is open (layers), in editable fields, and for Space on buttons/links/radios/summaries, where Space is the
// element's own activation key.
function onKey(e) {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || layers.length) return;
  const el = e.target;
  if (isEditable(el) || (el && el.closest && el.closest('button, a, [role="radio"], summary') && e.key === ' ')) return;
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); togglePlay(); }
  else if (k === 'r') { e.preventDefault(); ctl.random(); }
  else if (k === 'f') { e.preventDefault(); toggleFull(); }
  else if (k === 'z' && S.undo) { e.preventDefault(); undo(); }
}

// ---- boot -----------------------------------------------------------------------------------------------------------
function boot() {
  const main = $('#main');
  main.classList.add('ap-wide', 'dr-main');
  S.p = initialParams();
  S.preset = matchPreset(S.p);
  startApp({ key: KEY, name: 'app.name', logo: 'M5 3v5M5 12v2M5 18v3M10 6v9M10 19v2M15 3v3M15 10v7M20 5v5M20 14v6', offline: true, onLang: renderAll });
  buildStage();
  main.append(h('div', { class: 'dr-studio' }, stage, panel = h('aside', { class: 'dr-panel', 'aria-label': t('dr.panel') })));
  // The creator always animates its preview; the `motion` parameter decides in exported pages. (The panel shows a
  // notice when the OS asks for reduced motion, so the user knows the preview overrides it on purpose.)
  S.engine = rainEngine(canvas, engineParams(S.p), { auto: true, ignoreReducedMotion: true });
  stage.classList.toggle('dr-transparent', S.p.bgMode === 'transparent');
  renderAll();
  persist();
  // FPS readout refresh once a second; skipped in hidden tabs (rAF is paused there anyway, the value would be stale).
  setInterval(() => { if (S.playing && !document.hidden) updateChip(); }, 1000);
  document.addEventListener('keydown', onKey);
  // A pasted share link in the address bar of the open app: apply it, unless it encodes the current set (comparing
  // canonical encodings, so formatting differences in the hash do not count as a change).
  window.addEventListener('hashchange', () => {
    const p = decodeParams(location.hash);
    if (p && encodeParams(p) !== encodeParams(S.p)) ctl.code(location.hash);
  });
}

boot();
