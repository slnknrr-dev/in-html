// embroidery-studio/converter.js - picture -> scheme with a live preview: size by stitches or by finished size and
// fabric count, thread brand, number of colours, blends, dithering, confetti clean-up, background removal, tone
// adjustments, backstitch outlines, symbols or letters; the result opens in the editor or the viewer.

//
// Pipeline (stitch/convert.js): resample to the stitch grid, tone adjustments, optional background removal, colour
// quantisation to real thread colours of the chosen brand (with optional blends of two threads), dithering, confetti
// clean-up (isolated single stitches merged into neighbours: they are tedious to stitch), outlines, symbols.
// Every option change re-runs the conversion debounced (220 ms); the options persist in settings so the next visit
// starts from the user's last choices.
import { h, debounce } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { iconEl } from '../ui/icons.js';
import { seg, select, range, toggle, dropZone, card } from '../ui/app.js';
import { toast } from '../ui/overlays.js';
import { convertImage, targetSize, CONVERT_DEFAULTS } from '../stitch/convert.js';
import { flatten } from '../stitch/model.js';
import { BRANDS } from '../stitch/threads.js';
import { createChartView } from '../stitch/view.js';
import { saveMine } from './catalog.js';
import { settings, setSettings } from './store.js';
import { symbolSwatch } from './site.js';
import { entryLabel } from './common.js';

// The source picture is downscaled to at most 1600 px on its long side: charts rarely exceed 400 stitches, and
// quantising a 24 MP photo per slider move would freeze the page.
const MAX_SIDE = 1600;

// createImageBitmap decodes off the main thread in most engines; the pixels are then read once via a canvas. The
// JPEG data URL is only for the small "original" preview.
async function decode(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  const g = c.getContext('2d');
  g.drawImage(bmp, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height);
  return { width: c.width, height: c.height, data: d.data, url: c.toDataURL('image/jpeg', 0.85), name: file.name || 'picture' };
}

export function renderConverter(main, { go }) {
  const st = settings();
  const o = { ...CONVERT_DEFAULTS, width: 100, brand: st.brand, count: st.count, maxColors: 24, strands: st.strands, ...(st.convert || {}) };
  let img = null, result = null, mode = 'color', view = null, flatRes = null;
  const origImg = h('img', { class: 'es-orig', alt: '' });
  const prevHost = h('div', { class: 'es-prev-box es-conv-box' });
  const statsEl = h('div', { class: 'es-conv-stats' });
  const palEl = h('div', { class: 'es-conv-pal' });
  const sizeInfo = h('p', { class: 'ed-hint' });
  const busy = h('span', { class: 'es-busy', hidden: true }, h('span', { class: 'ed-spinner' }), t('conv.working'));
  const createBtn = h('button', { type: 'button', class: 'ed-btn ed-primary es-big', disabled: true, onclick: () => create('edit') }, iconEl('edit'), t('conv.create'));
  const stitchBtn = h('button', { type: 'button', class: 'ed-btn', disabled: true, onclick: () => create('view') }, iconEl('play'), t('conv.createStitch'));
  // Only durable choices are saved (not the picture or brightness tweaks that belong to one photo).
  const keep = () => setSettings({ convert: { sizeBy: o.sizeBy, width: o.width, finishedWidth: o.finishedWidth, maxColors: o.maxColors, blends: o.blends, dither: o.dither, ditherStrength: o.ditherStrength, cleanup: o.cleanup, background: o.background, bgTolerance: o.bgTolerance, outline: o.outline, outlineThreshold: o.outlineThreshold, symbols: o.symbols }, brand: o.brand, count: o.count });
  const run = debounce(() => convert(), 220);
  const set = (k) => (v) => { o[k] = v; keep(); renderSize(); run(); };

  const field = (label, ctl, hint) => h('div', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t(label)), ctl, hint ? h('span', { class: 'ed-hint' }, t(hint)) : null);
  const widthRange = range({ min: 20, max: 400, step: 1, value: o.width, unit: '', onInput: set('width') });
  const cmRange = range({ min: 5, max: 120, step: 1, value: o.finishedWidth || 20, unit: ' ' + t('u.cm'), onInput: (v) => { o.finishedWidth = v; keep(); renderSize(); run(); } });
  const sizeBox = h('div', {});
  // Size by stitches, or by finished size: width in cm * count / 2.54 stitches (targetSize). The info line shows both.
  function renderSize() {
    sizeBox.textContent = '';
    sizeBox.append(o.sizeBy === 'size' ? field('conv.finishedWidth', cmRange) : field('conv.stitchesWide', widthRange));
    if (img) {
      const s = targetSize(img.width, img.height, { ...o, finishedWidth: o.sizeBy === 'size' ? o.finishedWidth || 20 : 0 });
      const cm = (n) => Math.round((n / o.count) * 25.4) / 10;
      sizeInfo.textContent = t('conv.sizeInfo', { w: s.width, h: s.height, cw: cm(s.width), ch: cm(s.height), count: o.count });
    } else sizeInfo.textContent = '';
  }
  const bgColor = h('input', { type: 'color', class: 'ap-color', value: o.bgColor || '#ffffff' });
  bgColor.addEventListener('input', () => { o.bgColor = bgColor.value; run(); });
  const controls = h('div', { class: 'ap-side' },
    card('conv.picture', dropZone({ accept: 'image/*', label: 'conv.drop', onFiles: (f) => load(f[0]) }), h('div', { class: 'es-origbox' }, origImg)),
    card('conv.size',
      field('conv.sizeBy', seg([{ v: 'stitches', l: 'conv.byStitches' }, { v: 'size', l: 'conv.bySize' }], o.sizeBy, (v) => { o.sizeBy = v; if (v === 'size' && !o.finishedWidth) o.finishedWidth = 20; keep(); renderSize(); run(); })),
      sizeBox,
      field('conv.count', select([11, 14, 16, 18, 20, 22, 25, 28].map((v) => ({ v, l: '=' + v })), o.count, (v) => { o.count = +v; keep(); renderSize(); run(); })),
      sizeInfo),
    card('conv.colors',
      field('conv.brand', select(BRANDS.map((b) => ({ v: b.id, l: '=' + b.brand })), o.brand, set('brand'))),
      field('conv.maxColors', range({ min: 2, max: 80, step: 1, value: o.maxColors, onInput: set('maxColors') })),
      h('label', { class: 'ed-field ed-field-check' }, toggle(o.blends, set('blends')), h('span', { class: 'ed-label' }, t('conv.blends'))),
      field('conv.dither', seg([{ v: 'none', l: 'conv.ditherNone' }, { v: 'ordered', l: 'conv.ditherOrdered' }, { v: 'fs', l: 'conv.ditherFS' }], o.dither, set('dither'))),
      field('conv.strength', range({ min: 10, max: 100, step: 5, value: Math.round(o.ditherStrength * 100), unit: '%', onInput: (v) => { o.ditherStrength = v / 100; keep(); run(); } })),
      field('conv.cleanup', seg([0, 1, 2, 3].map((v) => ({ v, l: 'conv.clean' + v })), o.cleanup, (v) => set('cleanup')(+v)), 'conv.cleanupHint')),
    card('conv.background',
      field('conv.bgMode', seg([{ v: 'none', l: 'conv.bgNone' }, { v: 'auto', l: 'conv.bgAuto' }, { v: 'color', l: 'conv.bgColor' }], o.background, set('background'))),
      h('div', { class: 'ed-row' }, bgColor, h('span', { class: 'ed-hint' }, t('conv.bgColorHint'))),
      field('conv.tolerance', range({ min: 2, max: 40, step: 1, value: o.bgTolerance, onInput: set('bgTolerance') }))),
    card('conv.adjust',
      field('conv.brightness', range({ min: -60, max: 60, step: 1, value: o.brightness, onInput: set('brightness') })),
      field('conv.contrast', range({ min: -60, max: 80, step: 1, value: o.contrast, onInput: set('contrast') })),
      field('conv.saturation', range({ min: -100, max: 100, step: 1, value: o.saturation, onInput: set('saturation') }))),
    card('conv.details',
      h('label', { class: 'ed-field ed-field-check' }, toggle(o.outline, set('outline')), h('span', { class: 'ed-label' }, t('conv.outline'))),
      field('conv.outlineThreshold', range({ min: 10, max: 60, step: 1, value: o.outlineThreshold, onInput: set('outlineThreshold') })),
      field('conv.symbols', seg([{ v: 'symbols', l: 'symset.symbols' }, { v: 'letters', l: 'symset.letters' }], o.symbols, set('symbols')))));
  const stage = h('div', { class: 'ap-stage' },
    h('section', { class: 'ap-card es-conv-stage' },
      h('div', { class: 'es-prev-head' }, h('h2', { class: 'ap-card-h' }, t('conv.preview')), busy, h('span', { class: 'ed-spacer' }),
        seg([{ v: 'color', l: 'look.picture' }, { v: 'colorSymbols', l: 'look.chart' }, { v: 'realistic', l: 'look.stitched' }], mode, (v) => { mode = v; if (view) view.redraw(); }, 'look.label')),
      prevHost, statsEl, palEl,
      h('div', { class: 'es-actions' }, createBtn, stitchBtn)));
  main.append(h('div', { class: 'es-pagehead' }, h('h1', { 'data-spa-focus': '' }, t('conv.title')), h('p', { class: 'ap-lead' }, t('conv.lead'))), h('div', { class: 'ap-work es-conv' }, controls, stage));
  renderSize();
  prevHost.append(h('div', { class: 'es-empty es-conv-empty' }, iconEl('image'), h('p', {}, t('conv.empty'))));

  async function load(file) {
    if (!file) return;
    try { img = await decode(file); } catch (e) { toast(t('err.image', { msg: e.message }), 'error'); return; }
    origImg.src = img.url;
    renderSize();
    convert();
  }
  // setTimeout lets the "working" spinner paint before the synchronous conversion blocks the main thread.
  function convert() {
    if (!img) return;
    busy.hidden = false;
    setTimeout(() => {
      try {
        const opts = { ...o, finishedWidth: o.sizeBy === 'size' ? o.finishedWidth || 20 : 0, title: img.name.replace(/\.[^.]+$/, '') };
        result = convertImage(img, opts);
      } catch (e) { busy.hidden = true; toast(t('err.generic', { msg: e.message }), 'error'); return; }
      busy.hidden = true;
      showResult();
    }, 10);
  }
  // The chart view is created once and only fed new schemes afterwards (keeps zoom and pan between conversions).
  // Mean delta E (CIE colour difference) reports how far the thread palette is from the picture: below ~2 is barely
  // visible, above ~10 obviously different.
  function showResult() {
    const s = result.scheme;
    flatRes = flatten(s);
    if (!view) {
      prevHost.textContent = '';
      view = createChartView(prevHost, { scheme: s, layer: () => flatRes, rulers: false, cellLimits: [0.3, 40], options: () => ({ mode, grid: mode !== 'color' && mode !== 'realistic' }) });
    } else view.setScheme(s);
    const r = result.stats;
    statsEl.textContent = '';
    statsEl.append(...[['conv.stSize', `${r.width} × ${r.height}`], ['conv.stColors', String(r.colors) + (r.blends ? ' (' + t('sch.blends', { n: r.blends }) + ')' : '')], ['conv.stStitches', r.stitched.toLocaleString()], ['conv.stError', 'ΔE ' + r.meanDE.toFixed(1)], ['conv.stCleaned', String(r.cleaned)]]
      .map(([k, v]) => h('div', { class: 'es-stat' }, h('small', {}, t(k)), h('b', {}, v))));
    palEl.textContent = '';
    palEl.append(...s.palette.map((e) => h('span', { class: 'es-pchip', title: (e.name || '') }, symbolSwatch(e, { size: 's' }), entryLabel(e))));
    createBtn.disabled = stitchBtn.disabled = false;
  }
  async function create(where) {
    if (!result) return;
    const s = result.scheme;
    s.meta.source = img ? img.name : '';
    s.meta.category = 'other';
    await saveMine(s, { origin: 'convert' });
    toast(t('conv.saved'), 'ok');
    go((where === 'view' ? 'view/' : 'edit/') + encodeURIComponent('my:' + s.id));
  }
  // A picture handed over from the catalogue (drop / open).
  // Hand-over from another screen (a picture dropped on the catalogue) through a one-shot global.
  if (window.__esPendingImage) { const f = window.__esPendingImage; window.__esPendingImage = null; load(f); }
  return { destroy: () => { if (view) view.destroy(); }, load };
}
