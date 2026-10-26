// pallete-app/main.js - Palette Studio: base colour (picker, any CSS colour, OKLCH sliders), harmonies,
// random palettes with locks, image extraction, the palette strip, tabs (scales, contrast, vision, export, import),
// history, undo and keyboard shortcuts. Colour science lives in ../color/.
//
// Update model: every operation mutates S (state.js) and calls changed(kind, focusIndex). changed() coalesces any
// number of calls within one animation frame into a single update(): a slider drag fires input events faster than
// the screen refreshes, and repainting strip + panel per event would waste most of the work. update() repaints all
// views from S (side controls are synced, not rebuilt, so the slider being dragged keeps focus).
// `kind` tells update() which side effects apply: cosmetic changes (format, lock, tab, export settings) do not create
// a history entry; palette-changing ones are remembered after 1.2 s of quiet, so exploring does not flood history.
import './strings.js';
import { $, h, debounce } from '../ui/dom.js';
import { addIcons, iconEl } from '../ui/icons.js';
import { button, card, colorInput, copyText, dropZone, range, seg, startApp, t, toast } from '../ui/app.js';
import { confirmDialog } from '../ui/overlays.js';
import { fmtDate } from '../ui/lang.js';
import { formatCSS, parseCSS } from '../color/css.js';
import { convertCoords, inGamut, maxChroma, oklchToSrgb, oklchToSrgbMapped } from '../color/space.js';
import { extractPalette, swatch } from '../color/palette.js';
import { parseColorList } from '../color/swatches.js';
import {
  MAX_COLORS, MODES, S, addColor, appendColors, baseHex, canUndo, clearHistory, history, info, load, pushUndo,
  randomize, regenerate, remember, replaceColors, save, setBase, undo,
} from './state.js';
import { renderStrip } from './strip.js';
import { renderContrast, renderExport, renderImport, renderScales, renderVision, setImportText } from './panels.js';

addIcons({
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
  dice: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01',
  swatches: 'M4 4h5v16H4zM10 4h5v16h-5zM16 4h4v16h-4z',
  contrast: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 3v18',
});

const LOGO = 'M12 22a10 10 0 1 1 10-10c0 2.8-2.2 4-4 4h-2a2 2 0 0 0-1.5 3.3c.4.5.5 1 .5 1.5 0 .7-.6 1.2-3 1.2zM7.5 11h.01M10 7h.01M15 7h.01M17.5 11h.01';
const TABS = [
  { v: 'scales', l: 'pal.tab.scales', icon: 'swatches' },
  { v: 'contrast', l: 'pal.tab.contrast', icon: 'contrast' },
  { v: 'vision', l: 'pal.tab.vision', icon: 'eye' },
  { v: 'export', l: 'pal.tab.export', icon: 'export' },
  { v: 'import', l: 'pal.tab.import', icon: 'upload' },
];
const RENDER = { scales: renderScales, contrast: renderContrast, vision: renderVision, export: renderExport, import: renderImport };

// Long-lived elements and references into the current DOM (rebuilt on language change).
// UI: references into the current DOM, replaced by renderAll() on language change.
const UI = { sl: [] };
// The loaded image: a downscaled canvas (re-attached on re-render), its pixels and the last extraction.
const IMG = { canvas: null, data: null, w: 0, h: 0, name: '', results: [] };

// --- helpers --------------------------------------------------------------------------------------------

async function copy(text, code = false) {
  // Async clipboard first; copyText (ui/app.js) is the fallback for insecure contexts or denied permission. Long or
  // code-like texts get a generic toast instead of echoing the whole text.
  try {
    await navigator.clipboard.writeText(text);
    toast(code || text.length > 48 ? t('ap.copied') : t('pal.copied', { v: text }), 'ok');
  } catch { copyText(text); }
}

const saveSoon = debounce(save, 250);
const rememberSoon = debounce(() => { if (remember()) renderHistory(); }, 1200);

let pending = null;
let focusIndex = null;
// Coalesces repaints into one animation frame; keeps keyboard focus on the strip when it had it.
// When no explicit focus target is given but focus was inside the strip, remember which swatch had it, so the
// rebuilt strip can restore focus there.
function changed(kind = '', fi) {
  if (fi != null) focusIndex = fi;
  else if (document.activeElement?.closest?.('.pal-strip') && focusIndex == null) {
    const f = document.activeElement.closest('.pal-face') || document.activeElement.closest('.pal-sw')?.querySelector('.pal-face');
    focusIndex = f ? +f.dataset.i : null;
  }
  if (pending) return;
  pending = requestAnimationFrame(() => { pending = null; update(kind); });
}

function update(kind = '') {
  syncSide();
  paintStrip();
  renderPanel();
  paintHead();
  paintDots();
  saveSoon();
  if (!['fmt', 'lock', 'export', 'tab', 'vision'].includes(kind)) rememberSoon();
}

function paintStrip() {
  const keep = focusIndex;
  focusIndex = null;
  renderStrip(UI.strip, { changed, copy, setBase: useAsBase, focusIndex: keep });
}

function useAsBase(hex) {
  setBase(info(hex).oklch, 'setbase');
  toast(t('pal.baseSet', { v: hex }), 'ok');
  changed('base');
}

function doRandom() {
  randomize();
  changed('random');
}

function doUndo() {
  if (!undo()) { toast(t('pal.nothingUndo'), 'info'); return; }
  changed('undo');
}

// --- layout ---------------------------------------------------------------------------------------

function renderAll() {
  const main = $('#main');
  main.textContent = '';
  main.classList.add('pal-main');
  UI.strip = h('div', { class: 'pal-strip-host' });
  UI.panel = h('div', { class: 'ap-card pal-panel', role: 'region' });
  // The panel is a labelled region whose label follows the active tab, so screen-reader users hear where they are.
  const top = h('section', { class: 'pal-top', 'aria-label': t('pal.palette') }, headRow(), UI.strip, keysHint());
  const side = h('aside', { class: 'pal-side', 'aria-label': t('pal.controls') }, genCard(), harmonyCard(), imageCard(), historyCard());
  UI.tabs = seg(TABS.map((x) => ({ v: x.v, l: x.l, icon: x.icon })), S.tab, (v) => { S.tab = v; renderPanel(); saveSoon(); }, 'pal.tabs');
  UI.tabs.classList.add('pal-tabs');
  const bottom = h('section', { class: 'pal-bottom' }, UI.tabs, UI.panel);
  main.append(h('div', { class: 'pal-work' }, top, side, bottom));
  update('init');
  renderHistory();
}

function headRow() {
  UI.count = h('span', { class: 'pal-count' });
  UI.undo = button('pal.undo', 'undo', doUndo);
  UI.add = button('pal.add', 'plus', () => { if (addColor()) changed('add', S.colors.length - 1); });
  const all = button('pal.copyAll', 'copy', () => copy(S.colors.map((c) => c.hex).join(', '), true));
  const rnd = button('', 'dice', doRandom, 'primary');
  // Space randomises (the shortcut of popular palette generators); the key hint is part of the button.
  rnd.append(h('span', {}, t('pal.random')), h('kbd', { class: 'pal-kbd' }, 'Space'));
  rnd.title = t('pal.randomHint');
  for (const b of [UI.undo, UI.add, all]) b.classList.add('pal-hbtn');
  return h('div', { class: 'pal-head' },
    h('h2', { class: 'pal-title' }, t('pal.palette'), UI.count),
    h('div', { class: 'pal-head-actions' }, UI.undo, UI.add, all, rnd));
}

function paintHead() {
  UI.count.textContent = t('pal.colours', { n: S.colors.length });
  UI.undo.disabled = !canUndo();
  UI.add.disabled = S.colors.length >= MAX_COLORS;
}

function keysHint() {
  const keys = [['Space', 'pal.k.random'], ['← →', 'pal.k.focus'], ['Shift + ← →', 'pal.k.move'], ['L', 'pal.k.lock'], ['C', 'pal.k.copy'],
    ['B', 'pal.k.base'], ['F', 'pal.k.format'], ['Del', 'pal.k.remove'], ['Ctrl + Z', 'pal.k.undo']];
  return h('p', { class: 'pal-keys' }, keys.map(([k, l]) => h('span', {}, h('kbd', {}, k), ' ', t(l))));
}

function renderPanel() {
  for (const b of UI.tabs.children) {
    const on = b.dataset.v === S.tab;
    b.classList.toggle('ed-on', on);
    b.setAttribute('aria-checked', String(on));
  }
  UI.panel.textContent = '';
  UI.panel.setAttribute('aria-label', t(TABS.find((x) => x.v === S.tab)?.l || 'pal.tab.scales'));
  UI.panel.dataset.tab = S.tab;
  (RENDER[S.tab] || renderScales)(UI.panel, {
    copy, save: saveSoon,
    // Panels request repaints through the same coalescing path as everything else.
    changed: (kind) => changed(kind === 'export' ? 'export' : kind),
    replace: (list) => { replaceColors(list, 'import'); toast(t('pal.imported', { n: Math.min(list.length, MAX_COLORS) }), 'ok'); changed('import'); },
    append: (list) => { appendColors(list); changed('import'); },
  });
}

// --- side: base colour ------------------------------------------------------------------------------

// Slider maxima: chroma 0.37 covers every displayable sRGB colour with room for wide-gamut values.
const LMAX = [1, 0.37, 360];
function genCard() {
  UI.pick = colorInput(baseHex(), (v) => {
    const c = parseCSS(v);
    if (c) { setBase(convertCoords(c.coords, 'srgb', 'oklch'), 'picker'); changed('base'); }
  });
  UI.pick.setAttribute('aria-label', t('pal.picker'));
  UI.pick.title = t('pal.picker');
  UI.txt = h('input', { class: 'ed-input pal-css-in', spellcheck: 'false', autocomplete: 'off', 'aria-label': t('pal.baseText'), placeholder: t('pal.baseText') });
  UI.bad = h('div', { class: 'ed-hint pal-bad', role: 'alert', hidden: true }, t('pal.baseBad'));
  // Free text accepts any CSS colour syntax (hex, rgb(), hsl(), oklch(), named). Errors appear only on commit (Enter /
  // change) or after 3+ characters, so typing "#1" is not flagged as an error mid-word.
  const apply = (strict) => {
    const v = UI.txt.value.trim();
    const c = parseCSS(v);
    UI.txt.toggleAttribute('aria-invalid', !c && (strict || v.length > 2));
    UI.bad.hidden = !!c || !(strict || v.length > 2) || !v;
    if (!c) return;
    const lch = convertCoords(c.coords, c.space, 'oklch');
    // No-op guard: re-applying the same colour must not create an undo step.
    if (lch.every((x, i) => Math.abs(x - S.base[i]) < 1e-6)) return;
    setBase(lch, 'text');
    changed('base');
  };
  const soft = debounce(() => apply(false), 350);
  UI.txt.addEventListener('input', soft);
  UI.txt.addEventListener('keydown', (e) => { if (e.key === 'Enter') { soft.cancel(); apply(true); } });
  UI.txt.addEventListener('change', () => { soft.cancel(); apply(true); });
  UI.sl = [slider(0, 0, 1, 0.001, 'pal.L'), slider(1, 0, LMAX[1], 0.001, 'pal.C'), slider(2, 0, 360, 0.5, 'pal.H')];
  UI.readout = h('div', { class: 'pal-readout' });
  return card('pal.base',
    h('div', { class: 'pal-base-row' }, UI.pick, UI.txt), UI.bad,
    h('div', { class: 'pal-sliders' }, UI.sl.map((s) => s.row)),
    UI.readout);
}

function slider(idx, min, max, step, label) {
  const inp = h('input', { type: 'range', class: 'pal-slider', min, max, step, value: S.base[idx], 'aria-label': t(label) });
  const out = h('output', { class: 'pal-slider-val' });
  // Each slider is its own undo kind ('slider0'..'slider2'): a drag on one slider coalesces, switching sliders starts
  // a new step.
  inp.addEventListener('input', () => {
    const b = S.base.slice();
    b[idx] = +inp.value;
    setBase(b, 'slider' + idx);
    changed('base');
  });
  const id = 'pal-sl-' + idx;
  inp.id = id;
  const row = h('div', { class: 'pal-sl' }, h('label', { class: 'pal-sl-l', for: id }, h('b', {}, 'LCH'[idx]), t(label)), out, inp);
  return { row, inp, out };
}

// Track gradients: n samples along the channel, gamut-mapped to hex, as CSS colour stops. The track shows what
// moving the thumb would produce, the core affordance of an OKLCH picker.
const gradient = (fn, n) => Array.from({ length: n }, (_, i) => {
  const hex = toHexMapped(fn(i / (n - 1)));
  return `${hex} ${((i / (n - 1)) * 100).toFixed(1)}%`;
}).join(', ');
const toHexMapped = (lch) => formatCSS({ space: 'srgb', coords: oklchToSrgbMapped(lch) }, 'hex');

function syncSide() {
  const [L, C, H] = S.base;
  const hex = baseHex();
  if (UI.pick && UI.pick.value !== hex) UI.pick.value = hex;
  // The text field is not overwritten while the user is typing in it; neither is the slider being dragged.
  if (UI.txt && document.activeElement !== UI.txt) {
    UI.txt.value = formatCSS({ space: 'oklch', coords: S.base }, 'oklch');
    UI.txt.removeAttribute('aria-invalid');
    UI.bad.hidden = true;
  }
  const vals = [L, C, H];
  UI.sl.forEach((s, i) => {
    if (document.activeElement !== s.inp) s.inp.value = String(vals[i]);
    s.out.textContent = i === 0 ? (vals[0] * 100).toFixed(1) + '%' : i === 1 ? vals[1].toFixed(3) : vals[2].toFixed(1) + '°';
  });
  // The hue track uses at least 0.09 chroma: for a grey base the hue gradient would otherwise be invisible.
  const hueC = Math.max(C, 0.09);
  UI.sl[0].inp.style.setProperty('--track', `linear-gradient(to right, ${gradient((x) => [x, C, H], 12)})`);
  // Chroma track: the part beyond the maximum displayable chroma for this L and H is hatched (out of gamut).
  const lim = Math.min(1, maxChroma(L, H) / LMAX[1]);
  UI.sl[1].inp.style.setProperty('--track', `repeating-linear-gradient(135deg, rgba(0,0,0,.28) 0 3px, rgba(255,255,255,.28) 3px 6px) right / ${((1 - lim) * 100).toFixed(1)}% 100% no-repeat, linear-gradient(to right, ${gradient((x) => [L, x * LMAX[1], H], 12)})`);
  UI.sl[2].inp.style.setProperty('--track', `linear-gradient(to right, ${gradient((x) => [L, hueC, x * 360], 13)})`);
  // Out-of-gamut check on the unmapped conversion: the swatch shows the mapped colour, the warning says it was mapped.
  const out = !inGamut(oklchToSrgb(S.base), 'srgb');
  UI.readout.replaceChildren(
    h('span', { class: 'pal-chip pal-chip-lg', style: `--c:${hex}` }),
    h('code', {}, hex),
    h('code', { class: 'ed-muted' }, formatCSS({ space: 'srgb', coords: oklchToSrgbMapped(S.base) }, 'rgb')),
    ...(out ? [h('span', { class: 'pal-gamut', title: t('pal.outGamut') }, iconEl('warn'), t('pal.outGamutShort'))] : []));
  if (UI.modes) paintModes();
  if (UI.size) {
    UI.size.querySelector('input').value = String(S.size);
    UI.size.querySelector('output').textContent = String(S.size);
  }
}

// --- side: harmony ------------------------------------------------------------------------------------

// Hue offsets of each harmony, drawn as mini colour wheels in the mode buttons (monochrome varies lightness instead).
const WHEEL = { analogous: [-30, 0, 30], complementary: [0, 180], triadic: [0, 120, 240], tetradic: [0, 90, 180, 270], split: [0, 150, 210], monochrome: [0, 0, 0] };

function wheel(mode) {
  const [L, C, H] = S.base;
  const offs = WHEEL[mode];
  const cc = Math.max(C, 0.08);
  let spokes = '';
  let dots = '';
  offs.forEach((o, i) => {
    const mono = mode === 'monochrome';
    const r = mono ? [14, 9, 4.5][i] : 13;
    const a = ((H + o - 90) * Math.PI) / 180;
    const x = (18 + r * Math.cos(a)).toFixed(2);
    const y = (18 + r * Math.sin(a)).toFixed(2);
    const hex = swatch(mono ? [[0.85, Math.min(0.75, L), 0.4][i], cc, H] : [L, cc, H + o]).hex;
    spokes += `<line x1="18" y1="18" x2="${x}" y2="${y}" stroke="currentColor" stroke-opacity=".28" stroke-width="1.2"/>`;
    dots += `<circle cx="${x}" cy="${y}" r="${o === 0 && i === (mode === 'analogous' ? 1 : 0) ? 4.6 : 3.6}" fill="${hex}" stroke="var(--ed-panel)" stroke-width="1.4"/>`;
  });
  return `<svg viewBox="0 0 36 36" width="40" height="40" aria-hidden="true" focusable="false"><circle cx="18" cy="18" r="13" fill="none" stroke="currentColor" stroke-opacity=".22" stroke-width="1.4"/>${spokes}${dots}</svg>`;
}

function harmonyCard() {
  UI.modes = h('div', { class: 'pal-modes', role: 'radiogroup', 'aria-label': t('pal.mode') });
  for (const m of MODES) {
    UI.modes.append(h('button', {
      type: 'button', class: 'pal-mode', role: 'radio', dataset: { v: m }, title: t('pal.modeHint.' + m),
      onclick: () => {
        // Clicking the active mode again re-rolls nothing but restores the harmony (e.g. after manual edits), as an undo step.
        if (S.mode === m && S.colors.length === S.size) { pushUndo(); regenerate(); changed('mode'); return; }
        pushUndo();
        S.mode = m;
        regenerate();
        changed('mode');
      },
    }, h('span', { class: 'pal-mode-ic' }), h('span', { class: 'pal-mode-l' }, t('pal.mode.' + m))));
  }
  // Size changes coalesce into one undo step per drag ('size').
  UI.size = range({ min: 2, max: 12, value: S.size, onInput: (v) => { pushUndo('size'); S.size = v; regenerate(); changed('size'); } });
  UI.size.querySelector('input').setAttribute('aria-label', t('pal.size'));
  const rnd = button('pal.random', 'dice', doRandom);
  rnd.classList.add('pal-wide');
  return card('pal.harmony', UI.modes,
    h('div', { class: 'ed-field pal-size' }, h('span', { class: 'ed-label' }, t('pal.size')), UI.size),
    h('div', { class: 'ap-actions' }, rnd),
    h('p', { class: 'ed-hint' }, t('pal.randomHint')));
}

function paintModes() {
  for (const b of UI.modes.children) {
    const on = b.dataset.v === S.mode;
    b.setAttribute('aria-checked', String(on));
    b.classList.toggle('ed-on', on);
    b.firstChild.innerHTML = wheel(b.dataset.v);
  }
}

// --- side: image --------------------------------------------------------------------------------------

function imageCard() {
  UI.img = h('div', { class: 'pal-img' });
  paintImageCard();
  return card('pal.image', UI.img);
}

function paintImageCard() {
  UI.img.textContent = '';
  const zone = dropZone({ accept: 'image/*', label: 'pal.imageDrop', onFiles: ([f]) => loadImage(f) });
  zone.classList.add('pal-img-drop');
  if (!IMG.canvas) {
    UI.img.append(zone, h('p', { class: 'ed-hint' }, t('pal.imageHint')));
    UI.dots = null;
    return;
  }
  UI.dots = h('div', { class: 'pal-dots' });
  const thumb = h('div', { class: 'pal-thumb' }, IMG.canvas, UI.dots);
  UI.pop = h('div', { class: 'pal-popbar', 'aria-hidden': 'true' });
  const k = range({ min: 2, max: 12, value: S.k, onInput: (v) => { S.k = v; extractSoon(); } });
  k.querySelector('input').setAttribute('aria-label', t('pal.imageK'));
  const again = h('button', { type: 'button', class: 'ed-iconbtn', title: t('pal.imageRemove'), 'aria-label': t('pal.imageRemove'), onclick: () => { IMG.canvas = null; IMG.data = null; IMG.results = []; paintImageCard(); } }, iconEl('close'));
  zone.classList.add('pal-img-drop-sm');
  UI.img.append(
    h('div', { class: 'pal-img-head' }, h('span', { class: 'pal-img-name', title: IMG.name }, IMG.name), again),
    thumb, UI.pop,
    h('div', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('pal.imageK')), k),
    zone);
  paintDots();
}

async function bitmapOf(file) {
  // createImageBitmap first (fast, off-thread decode); SVG and some formats only decode through <img>. The object URL
  // is revoked in finally, after decode() has consumed it.
  try { return await createImageBitmap(file); } catch { /* SVG and some formats need an <img> */ }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}

async function loadImage(file) {
  try {
    const src = await bitmapOf(file);
    const w0 = src.width || src.naturalWidth;
    const h0 = src.height || src.naturalHeight;
    if (!w0 || !h0) throw new Error('empty image');
    // Downscaled pixels are kept (IMG.data), so changing k re-runs extraction without decoding the file again.
    // 320 px on the long side: enough for k-means (about 25k samples) and a crisp thumbnail.
    const k = Math.min(1, 320 / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * k));
    const hh = Math.max(1, Math.round(h0 * k));
    const cv = IMG.canvas || h('canvas', { class: 'pal-thumb-cv' });
    cv.width = w;
    cv.height = hh;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.clearRect(0, 0, w, hh);
    g.drawImage(src, 0, 0, w, hh);
    // ImageBitmap.close() frees its memory immediately instead of waiting for garbage collection.
    if (src.close) src.close();
    Object.assign(IMG, { canvas: cv, data: g.getImageData(0, 0, w, hh).data, w, h: hh, name: file.name || 'image' });
    paintImageCard();
    extract();
  } catch (e) {
    toast(t('pal.imageErr') + (e && e.message ? ` (${e.message})` : ''), 'error');
  }
}

function extract() {
  if (!IMG.data) return;
  // k-means in OKLab (color/palette.js) with a fixed seed: the same image and k always give the same palette.
  const res = extractPalette(IMG.data, { width: IMG.w, k: S.k, seed: 7 });
  if (!res.length) { toast(t('pal.imageEmpty'), 'warn'); return; }
  IMG.results = res;
  replaceColors(res.map((r) => ({ hex: r.hex })), 'image');
  changed('image');
}
const extractSoon = debounce(extract, 120);

// Pin position in % of the thumbnail, kept off the very edge so the whole pin stays visible.
const pinPos = (v, n) => Math.min(96, Math.max(4, ((v + 0.5) / n) * 100)).toFixed(2);

function paintDots() {
  if (!UI.dots || !IMG.results.length) return;
  const inPal = new Set(S.colors.map((c) => c.hex));
  // Pins show where each extracted colour sits in the image; only colours still in the palette are pinned.
  UI.dots.replaceChildren(...IMG.results.filter((r) => inPal.has(r.hex)).map((r) => h('span', {
    class: 'pal-dot-pin', style: `--c:${r.hex};left:${pinPos(r.x, IMG.w)}%;top:${pinPos(r.y, IMG.h)}%`,
    title: `${r.hex} · ${r.pct.toFixed(1)}%`,
  })));
  UI.pop.replaceChildren(...IMG.results.map((r) => h('span', { style: `--c:${r.hex};flex-grow:${r.pct.toFixed(3)}`, title: `${r.hex} · ${r.pct.toFixed(1)}%` })));
}

// --- side: history ---------------------------------------------------------------------------------

function historyCard() {
  UI.hist = h('div', { class: 'pal-hist' });
  UI.histClear = button('pal.clearHistory', 'trash', async () => {
    if (await confirmDialog(t('pal.history'), t('pal.clearHistoryQ'), t('ap.clear'), true)) { clearHistory(); renderHistory(); }
  });
  UI.histClear.classList.add('ed-sm');
  return card('pal.history', UI.hist, h('div', { class: 'ap-actions' }, UI.histClear));
}

function renderHistory() {
  if (!UI.hist) return;
  const list = history();
  UI.hist.textContent = '';
  UI.histClear.disabled = !list.length;
  if (!list.length) { UI.hist.append(h('p', { class: 'ed-hint pal-hist-empty' }, t('pal.historyEmpty'))); return; }
  const cur = S.colors.map((c) => c.hex).join();
  for (const e of list) {
    const label = t('pal.restore', { list: e.colors.join(', ') });
    UI.hist.append(h('button', {
      type: 'button', class: 'pal-hist-item' + (e.colors.join() === cur ? ' pal-on' : ''), title: (e.at ? fmtDate(new Date(e.at).toISOString()) + '\n' : '') + e.colors.join(' '),
      'aria-label': label,
      onclick: () => { replaceColors(e.colors.map((hex) => ({ hex })), 'history'); changed('history'); },
    }, h('span', { class: 'pal-mini' }, e.colors.map((hex) => h('span', { style: `--c:${hex}` })))));
  }
}

// --- global keys and paste ------------------------------------------------------------------------------

function bindGlobal() {
  document.addEventListener('keydown', (e) => {
    // Global shortcuts are ignored while a dialog or popover is open and while typing in a field. Space is not taken
    // over on buttons, links and summaries, where it is their native activation key.
    if (e.defaultPrevented || document.querySelector('.ed-backdrop, .ed-popover')) return;
    const tg = e.target;
    const typing = tg.closest?.('input, textarea, select, [contenteditable]');
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'z' || e.key === 'Z') && !typing) {
      e.preventDefault();
      doUndo();
    } else if (e.key === ' ' && !typing && !tg.closest?.('button, a, summary') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      doRandom();
    }
  });
  // Text with colours pasted outside a field goes to the Import tab.
  // Colour text pasted anywhere outside a field opens the Import tab with it; pasted files are left to drop zones.
  document.addEventListener('paste', (e) => {
    if (e.target.closest?.('input, textarea, [contenteditable]')) return;
    const cd = e.clipboardData;
    if (!cd || (cd.files && cd.files.length)) return;
    const text = cd.getData('text/plain');
    if (!text || !parseColorList(text).length) return;
    e.preventDefault();
    setImportText(text);
    S.tab = 'import';
    renderPanel();
    toast(t('pal.pasted'), 'ok');
  });
}

// --- start -----------------------------------------------------------------------------------------

// State is loaded before the shell starts, so the first render already shows the saved palette (no flash).
load();
startApp({ key: 'palette', name: 'pal.name', logo: LOGO, offline: true, onLang: () => renderAll() });
renderAll();
bindGlobal();
