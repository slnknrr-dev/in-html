// img2ascii-app/main.js - image / camera → text art: state, render scheduling, camera loop and wiring.
//
// Module map: settings.js (validated persistent settings + preview colours), source.js (sample, files, camera),
// stage.js (the text preview element), controls.js (side panel), export.js (copy/download). This file owns the
// state S and decides WHEN to convert; ../ascii/convert.js decides HOW.
// Key decisions:
// - Two cost classes of setting: VIEW_KEYS only restyle or re-lay-out the existing grid; every other key needs a new
//   conversion. update() compares before/after values, so setting a control to its current value converts nothing.
// - Scheduling adapts to measured cost (S.cost): cheap conversions run on the next animation frame (coalescing a
//   slider drag into at most one conversion per frame); slow ones (> 60 ms, huge grids) are debounced so the slider
//   stays responsive and only the settled value is converted.
// - The camera runs its own rAF loop with an adaptive interval, and while it is live, schedule() does nothing: the
//   next camera frame picks up the new settings, so there is never a second conversion competing with the loop.
// - One reusable work canvas with willReadFrequently: getImageData every frame on a GPU-backed canvas forces a slow
//   readback; the hint tells the browser to keep it in CPU memory.
import './strings.js';
import { dropZone, startApp, t, toast } from '../ui/app.js';
import { debounce, h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { createConverter, gridSize } from '../ascii/convert.js';
import { rampCodes } from '../ascii/ramps.js';
import { parseHex } from '../ascii/palette.js';
import { DEFAULTS, loadSettings, previewLook, saveSettings } from './settings.js';
import { closeCamera, drawInto, drawSample, loadImageInto, openCamera } from './source.js';
import { BASE, createStage } from './stage.js';
import { buildControls } from './controls.js';
import { buildExport } from './export.js';

// Brand: a frame of characters (dots and dashes) – text art in a terminal window.
const LOGO = 'M3 4h18v16H3zM7 8.5h.01M10 8.5h4M17 8.5h.01M7 12h2M12 12h.01M15 12h2M7 15.5h.01M10 15.5h4M17 15.5h.01';
// Settings that change only the view (no new conversion).
const VIEW_KEYS = new Set(['fontSize', 'fit', 'pngCell', 'copyFmt', 'srcTab', 'mirror']);
const FPS_MIN_MS = 66; // ≈ 15 frames per second at most

const S = {
  set: loadSettings(),
  src: { canvas: null, w: 0, h: 0, kind: 'sample', name: '' },
  look: null,
  grid: null,
  ms: 0,
  cost: 0,
  cam: { stream: null, live: false, frozen: false, raf: 0, last: 0, interval: 80 },
};
const conv = createConverter();
let ui = null; // DOM handles, created in boot()

const saveSoon = debounce(() => saveSettings(S.set), 250);

// The effective colour scheme: an explicit data-theme (set by the shell's theme switch) wins over the OS preference.
function schemeDark() {
  const th = document.documentElement.getAttribute('data-theme');
  return th ? th === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}

// UI settings (percent integers, friendly ranges) -> library options (fractions). The mapping lives here so the
// settings stay human-readable in storage and the library stays unit-consistent.
function libOptions() {
  const s = S.set;
  return {
    columns: s.columns, aspect: s.aspect, ramp: s.ramp, chars: s.chars, order: s.order,
    brightness: s.brightness / 100, contrast: s.contrast / 100, gamma: s.gamma, invert: s.invert, autoLevels: s.autoLevels,
    edges: s.edges / 100, edgeGlyphs: s.edgeGlyphs, edgeThreshold: s.edgeThreshold / 100, dither: s.dither,
    color: s.color, target: s.target, vivid: s.vivid / 100, ink: S.look.ink, matte: parseHex(S.look.bg),
  };
}

// The glyph that sets the cell width of the current ramp in the preview font. Monospace fonts are rarely truly
// monospace for block and braille characters (fallback fonts supply them with other advances), so the stage
// measures the advance of a representative glyph: full block for block ramps, full braille cell for braille, the
// densest custom character, else 'M'.
function cellGlyph() {
  const r = S.set.ramp;
  if (r === 'braille') return '⣿';
  if (r === 'half' || r === 'blocks') return '█';
  if (r === 'custom') { const c = rampCodes({ ramp: r, chars: S.set.chars, order: S.set.order }); return String.fromCodePoint(c[c.length - 1]); }
  return 'M';
}

// ---------------------------------------------------------------------------------------------
// Conversion

// readyState >= 2 (HAVE_CURRENT_DATA) and a non-zero videoWidth: before that, drawImage(video) draws nothing or throws.
function liveVideo() {
  const v = ui.video;
  return S.cam.live && !S.cam.frozen && v.readyState >= 2 && v.videoWidth > 0;
}

// One conversion. S.ms is the conversion time shown to the user; S.cost (measured after painting) is the full
// frame cost that drives scheduling and the camera frame rate.
function renderNow() {
  const t0 = performance.now();
  const live = liveVideo();
  const src = live ? ui.video : S.src.canvas;
  const sw = live ? ui.video.videoWidth : S.src.w, sh = live ? ui.video.videoHeight : S.src.h;
  if (!src || !sw || !sh) return;
  const opts = libOptions();
  // The browser downsamples big pictures to ~3 samples per cell sample first (fast, GPU); the library then
  // box-filters that exactly. Camera frames are mirrored here, like a mirror.
  const g = gridSize(sw, sh, opts);
  // k: scale so the work image has ~3x the samples the grid needs (never upscale). 3x keeps enough detail for the
  // library's exact box filter while cutting a 12 MP photo to a few hundred KB of pixels to read back.
  const k = Math.min(1, Math.max((g.sw * 3) / sw, (g.sh * 3) / sh));
  const tw = Math.max(1, Math.round(sw * k)), th = Math.max(1, Math.round(sh * k));
  const work = ui.work, wx = ui.wctx;
  // Resizing a canvas reallocates and clears it; only resize when the size changed, else just clear (transparent
  // pictures would otherwise show the previous frame through).
  if (work.width !== tw || work.height !== th) { work.width = tw; work.height = th; } else wx.clearRect(0, 0, tw, th);
  wx.save();
  wx.imageSmoothingEnabled = true;
  wx.imageSmoothingQuality = k < 0.5 ? 'high' : 'medium';
  if (live && S.set.mirror) { wx.translate(tw, 0); wx.scale(-1, 1); }
  wx.drawImage(src, 0, 0, tw, th);
  wx.restore();
  const grid = conv.convert(wx.getImageData(0, 0, tw, th), opts);
  S.ms = performance.now() - t0;
  S.grid = grid;
  ui.stage.paint(grid, S.look, cellGlyph());
  ui.stage.setStats(grid, S.ms);
  S.cost = performance.now() - t0;
}

// rafId != 0 means a frame is already booked: further changes in the same frame are absorbed by it.
let rafId = 0;
const slowRender = debounce(() => renderNow(), 140);
// Coalesces changes into one conversion per frame; slow conversions (huge grids) wait for the input to settle.
function schedule() {
  if (S.cam.live && !S.cam.frozen) return; // the camera loop picks the new settings up
  if (S.cost > 60) { slowRender(); return; }
  if (!rafId) rafId = requestAnimationFrame(() => { rafId = 0; renderNow(); });
}

// ---------------------------------------------------------------------------------------------
// Sources

function sourceTitle() {
  if (S.cam.live && !S.cam.frozen) return t('asc.cam.frame');
  return S.src.kind === 'sample' ? t('asc.sampleName') : S.src.kind === 'frame' ? t('asc.cam.frame') : S.src.name;
}

function syncSource() {
  const { thumb, srcName, srcSize } = ui.keep;
  const live = S.cam.live && !S.cam.frozen;
  ui.stage.setTitle(sourceTitle(), S.cam.live ? t(live ? 'asc.cam.live' : 'asc.cam.frozen') : '', live);
  srcName.textContent = S.src.kind === 'sample' ? t('asc.sampleName') : S.src.kind === 'frame' ? t('asc.cam.frame') : S.src.name;
  srcSize.textContent = t('asc.srcMeta', { w: S.src.w, h: S.src.h });
  // Thumbnail at device resolution.
  const dpr = Math.min(2, window.devicePixelRatio || 1), th = 52;
  const tw = Math.max(1, Math.round((th * S.src.w) / Math.max(1, S.src.h)));
  thumb.width = Math.min(160, tw) * dpr;
  thumb.height = th * dpr;
  thumb.style.width = Math.min(160, tw) + 'px';
  thumb.style.height = th + 'px';
  const x = thumb.getContext('2d');
  x.imageSmoothingQuality = 'high';
  if (S.src.w) x.drawImage(S.src.canvas, 0, 0, thumb.width, thumb.height);
  ui.camBox.classList.toggle('asc-live', S.cam.live);
  ui.camBox.classList.toggle('asc-mirror', !!S.set.mirror);
  ui.camState.textContent = S.cam.live ? t(live ? 'asc.cam.live' : 'asc.cam.frozen') : '';
  ui.camState.hidden = !S.cam.live;
  ui.controls?.refresh();
}

function useSample() {
  if (S.cam.live) stopCamera(false);
  drawSample(S.src.canvas);
  Object.assign(S.src, { w: S.src.canvas.width, h: S.src.canvas.height, kind: 'sample', name: 'sample' });
  syncSource();
  schedule();
}

// Prefer the first file with an image MIME type; fall back to the first file (some OSes give dropped files an empty
// type). The source is decoded into a fresh canvas before anything else changes, so a failed decode leaves the
// current picture and camera untouched. S.cost reset: a new picture's cost is unknown, start optimistic.
async function loadFiles(files) {
  const file = files.find((f) => /^image\//.test(f.type)) || files[0];
  if (!file) return;
  try {
    const off = document.createElement('canvas');
    const { w, h: hh } = await loadImageInto(file, off);
    if (S.cam.live) stopCamera(false);
    S.src.canvas = off;
    Object.assign(S.src, { w, h: hh, kind: 'file', name: file.name || 'image' });
    if (S.set.srcTab !== 'image') S.set.srcTab = 'image';
    saveSoon();
    syncSource();
    S.cost = 0;
    schedule();
  } catch {
    toast(t('asc.badImage', { name: file.name || '?' }), 'warn');
  }
}

// ---------------------------------------------------------------------------------------------
// Camera

// Camera loop: rAF keeps it in step with the display and pauses it in background tabs for free; the interval check
// throttles the actual conversions. The next frame is booked first, so an exception in renderNow cannot kill the loop.
function tick(now) {
  const cam = S.cam;
  if (!cam.live) return;
  cam.raf = requestAnimationFrame(tick);
  if (cam.frozen || now - cam.last < cam.interval || !liveVideo()) return;
  cam.last = now;
  renderNow();
  // Adaptive frame rate: conversions take at most about a third of the time, the page stays responsive.
  cam.interval = Math.min(250, Math.max(FPS_MIN_MS, S.cost * 3));
}

// getUserMedia errors (permission denied, no device, insecure context) become a toast, never an uncaught rejection.
// e.code 'unsupported' is set by source.js when the API is missing (old browser or http:// origin).
async function startCamera() {
  if (S.cam.live) return;
  try {
    S.cam.stream = await openCamera(ui.video);
  } catch (e) {
    toast(e && e.code === 'unsupported' ? t('asc.cam.unsupported') : t('asc.cam.err', { msg: (e && (e.message || e.name)) || '?' }), 'warn');
    return;
  }
  Object.assign(S.cam, { live: true, frozen: false, last: 0 });
  syncSource();
  S.cam.raf = requestAnimationFrame(tick);
}

// Keeps the last frame as the picture (freeze = true) so the art stays on screen.
function freezeFrame() {
  const v = ui.video;
  if (!v.videoWidth) return false;
  const c = document.createElement('canvas');
  const { w, h: hh } = drawInto(c, v, v.videoWidth, v.videoHeight, !!S.set.mirror);
  S.src.canvas = c;
  Object.assign(S.src, { w, h: hh, kind: 'frame', name: 'camera-frame' });
  return true;
}

// Stopping releases the device (tracks stopped: the camera LED goes off). keepFrame turns the last frame into the
// picture so the art does not vanish; switching to another source passes false.
function stopCamera(keepFrame = true) {
  const cam = S.cam;
  if (!cam.live) return;
  if (keepFrame && !cam.frozen) freezeFrame();
  cancelAnimationFrame(cam.raf);
  closeCamera(ui.video, cam.stream);
  Object.assign(cam, { stream: null, live: false, frozen: false });
  syncSource();
  S.cost = 0;
  schedule();
}

function toggleFreeze() {
  const cam = S.cam;
  if (!cam.live) return;
  if (cam.frozen) cam.frozen = false;
  else if (freezeFrame()) cam.frozen = true;
  syncSource();
  if (cam.frozen) { S.cost = 0; schedule(); }
}

// ---------------------------------------------------------------------------------------------
// Settings and UI

function applyLook() {
  S.look = previewLook(S.set, schemeDark());
}

// The single entry point for setting changes from the controls: merge, persist (debounced), apply view-only effects
// directly, refresh the controls, and convert only if a conversion-relevant value actually changed.
function update(patch) {
  const before = { ...S.set };
  Object.assign(S.set, patch);
  saveSoon();
  if ('bgMode' in patch || 'bgCustom' in patch) applyLook();
  if ('mirror' in patch) ui.camBox.classList.toggle('asc-mirror', !!S.set.mirror);
  if ('fontSize' in patch || 'fit' in patch) ui.stage.setView({ fit: S.set.fit, fontSize: S.set.fontSize });
  ui.controls.refresh();
  if (Object.keys(patch).some((k) => !VIEW_KEYS.has(k) && before[k] !== S.set[k])) schedule();
}

// Zoom works in font-size units. Leaving 'fit' starts from the size fit was showing (cur, rounded to 0.5), so the
// view does not jump. Steps grow with size (0.5 / 1 / 2 px) for even perceived increments; clamped to 3..40 px,
// the same range settings.js enforces.
function zoom(act) {
  const s = S.set;
  const cur = Math.round(BASE * ui.stage.scale() * 2) / 2;
  if (act === 'fit') update({ fit: !s.fit, fontSize: s.fit ? Math.max(3, Math.min(40, cur)) : s.fontSize });
  else {
    const step = cur < 6 ? 0.5 : cur < 12 ? 1 : 2;
    update({ fit: false, fontSize: Math.max(3, Math.min(40, cur + (act === 'in' ? step : -step))) });
  }
}

function sourceTab(tab) {
  update({ srcTab: tab });
  if (tab === 'image' && S.cam.live) stopCamera(true);
  if (tab === 'camera' && !S.cam.live) startCamera();
}

// Reset keeps the source tab (resetting it would stop or start the camera as a side effect of "reset settings").
// DEFAULTS is frozen and flat, so Object.assign copies values, never shared nested objects.
function reset() {
  const keep = { srcTab: S.set.srcTab };
  Object.assign(S.set, DEFAULTS, keep);
  saveSettings(S.set);
  applyLook();
  buildSide();
  ui.stage.setView({ fit: S.set.fit, fontSize: S.set.fontSize });
  S.cost = 0;
  schedule();
  toast(t('asc.resetDone'), 'ok');
}

// Export context, computed on demand (the export panel calls it at click time, so it always sees the latest grid).
// File base name: NFKC folds compatibility forms (full-width letters, ligatures), then characters invalid in file
// names on Windows plus control characters become spaces. charWidth = measured glyph advance / font size, so
// exporters reproduce the preview's cell proportions.
function exportCtx() {
  if (!S.grid) return null;
  const adv = ui.stage.advance(cellGlyph());
  const base = (S.src.kind === 'file' ? S.src.name.replace(/\.[^.]+$/, '') : S.src.kind === 'frame' ? 'camera' : 'sample')
    .normalize('NFKC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 60) || 'image';
  return { grid: S.grid, look: S.look, set: S.set, base: base + '-ascii', title: sourceTitle(), charWidth: adv / BASE };
}

// Rebuilds the side panel (startup, language switch, reset) and restores its scroll position, so a language switch
// does not throw the user back to the top. ui.keep holds elements that must survive rebuilds (the drop zone, the
// thumbnail canvas, the camera box with its live <video>): recreating the video would interrupt the stream.
function buildSide() {
  const top = ui.side.scrollTop;
  ui.controls = buildControls(S, {
    update, sourceTab, useSample, reset,
    camToggle: () => (S.cam.live ? stopCamera(true) : startCamera()),
    camFreeze: toggleFreeze,
  }, ui.keep);
  ui.side.replaceChildren(...ui.controls.cards);
  ui.side.scrollTop = top;
  ui.exportSlot.replaceChildren(buildExport(exportCtx, S.set, (p) => update(p)));
  syncSource();
}

// Language switch: kept elements are relabelled in place, the rest rebuilt.
function relabel() {
  ui.lead.textContent = t('asc.lead');
  ui.keep.drop.lastElementChild.textContent = t('asc.drop');
  ui.camOff.lastElementChild.textContent = t('asc.cam.off');
  ui.stage.relabel();
  buildSide();
  if (S.grid) ui.stage.setStats(S.grid, S.ms);
}

// Boot. The work canvas is never attached to the DOM. The <video> is aria-hidden: it is an input device preview,
// the text art is the content. 'ap-wide' removes the shell's max-width: the preview benefits from every column.
// pagehide (not unload, which disables the back/forward cache) releases the camera when the page goes away.
function boot() {
  startApp({ key: 'img2ascii', name: 'asc.name', logo: LOGO, offline: true, onLang: relabel });
  const main = document.getElementById('main');
  main.classList.add('ap-wide', 'asc-main');
  applyLook();
  const work = document.createElement('canvas');
  const video = h('video', { class: 'asc-video', 'aria-hidden': 'true' });
  const camOff = h('div', { class: 'asc-cam-off' }, iconEl('camera'), h('span', {}, t('asc.cam.off')));
  const camState = h('span', { class: 'asc-cam-state', hidden: true });
  const camBox = h('div', { class: 'asc-cam' }, video, camOff, camState);
  const keep = {
    drop: dropZone({ onFiles: loadFiles, accept: 'image/*', label: 'asc.drop' }),
    thumb: h('canvas', { class: 'asc-thumb', 'aria-hidden': 'true' }),
    srcName: h('b', { class: 'asc-src-name' }),
    srcSize: h('span', { class: 'asc-src-size' }),
    camBox,
  };
  const stage = createStage({ onZoom: zoom, onFiles: loadFiles });
  stage.setView({ fit: S.set.fit, fontSize: S.set.fontSize });
  const side = h('aside', { class: 'ap-side asc-side' });
  const exportSlot = h('div', { class: 'asc-export' });
  const lead = h('p', { class: 'ap-lead asc-lead' }, t('asc.lead'));
  main.append(lead, h('div', { class: 'ap-work asc-work' }, side, h('section', { class: 'ap-stage asc-stagecol' }, stage.el, exportSlot)));
  ui = { work, wctx: work.getContext('2d', { willReadFrequently: true }), video, camOff, camState, camBox, keep, stage, side, exportSlot, lead, controls: null };
  S.src.canvas = document.createElement('canvas');
  drawSample(S.src.canvas);
  Object.assign(S.src, { w: S.src.canvas.width, h: S.src.canvas.height, kind: 'sample', name: 'sample' });
  buildSide();
  // 'auto' preview background follows the page colour scheme: both the in-app switch (data-theme attribute, watched
  // by a MutationObserver because the shell fires no event) and the OS preference (media query change event).
  const onScheme = () => { if (S.set.bgMode === 'auto') { applyLook(); S.cost = 0; schedule(); } };
  new MutationObserver(onScheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onScheme);
  window.addEventListener('pagehide', () => { if (S.cam.live) stopCamera(false); });
  renderNow();
}

boot();
