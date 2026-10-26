// img2ascii-app/stage.js - the preview stage: a terminal (or paper) frame around a <pre> with merged colour
// runs, a pixel canvas under it for cell backgrounds and half blocks, zoom / fit to width, stats and a drop target.
//
// Why real text and not a canvas rendering: the art stays selectable and copyable, screen-zoom stays sharp, and the
// browser's text engine does the glyph work. Why a pixel canvas underneath: per-cell backgrounds as thousands of
// styled spans would be heavy, and half-block art is really two pixels per cell, which a 1-pixel-per-cell canvas
// stretched under the grid (CSS pixelated) draws exactly.
// Geometry: the <pre> is laid out once at BASE px with line-height = glyph advance x aspect, so cells have the exact
// aspect the converter assumed; zoom is a CSS transform on the sheet, and the box around it is sized to the scaled
// dimensions so scrolling works (a transform alone does not affect layout).
import { clamp, h } from '../ui/dom.js';
import { icon, iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { toHTML } from '../ascii/writers.js';
import { FULL_BLOCK, HALF_LOWER, HALF_UPPER } from '../ascii/ramps.js';
import { parseHex } from '../ascii/palette.js';

export const BASE = 16; // font size of the <pre> in px; zoom is a transform on top, so small sizes stay crisp
const PAD = 18; // inner padding of the screen (app.css .asc-screen)

/**
 * createStage({ onZoom(action), onFiles(File[]) }) → { el, paint(grid, look, glyph), setView({ fit, fontSize }),
 *   setTitle(text, badge), setStats(grid, ms), relabel(), advance(glyph), scale() }
 */
export function createStage({ onZoom, onFiles }) {
  const pre = h('pre', { class: 'asc-pre', id: 'asc-pre', role: 'img' });
  const bgc = h('canvas', { class: 'asc-bgc', hidden: true, 'aria-hidden': 'true' });
  const sheet = h('div', { class: 'asc-sheet' }, bgc, pre);
  const box = h('div', { class: 'asc-box' }, sheet);
  const screen = h('div', { class: 'asc-screen', tabindex: '0' }, box);
  const probe = h('span', { class: 'asc-probe', 'aria-hidden': 'true' });
  const cueText = h('span');
  const cue = h('div', { class: 'asc-cue', hidden: true }, iconEl('upload'), cueText);
  const view = h('div', { class: 'asc-view' }, screen, h('div', { class: 'asc-glass', 'aria-hidden': 'true' }), probe, cue);
  const title = h('span', { class: 'asc-title' });
  const badge = h('span', { class: 'asc-badge', hidden: true });
  const stats = h('span', { class: 'asc-stats', id: 'asc-stats' });
  const zbtn = (act, ic) => h('button', { type: 'button', class: 'asc-zbtn', dataset: { act }, html: icon(ic), onclick: () => onZoom(act) });
  const zOut = zbtn('out', 'zoomOut'), zIn = zbtn('in', 'zoomIn'), zFit = zbtn('fit', 'fitWidth');
  const zVal = h('span', { class: 'asc-zval' });
  const bar = h('div', { class: 'asc-bar' },
    h('span', { class: 'asc-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
    title, badge, h('span', { class: 'ed-spacer' }), stats,
    h('span', { class: 'asc-zoom' }, zOut, zVal, zIn, zFit));
  const el = h('div', { class: 'asc-term' }, bar, view);

  let natW = 0, natH = 0, s = 1;
  let vw = { fit: true, fontSize: 10 };
  let last = null;
  const advCache = new Map();

  // Width of one glyph at BASE px in the preview font (the real font decides the grid geometry).
  // Measured on 64 copies in a hidden probe: one glyph's width is rounded to layout units, 64 averages that away.
  // Cached per glyph; a 0 result (fonts not loaded or element not laid out) is NOT cached, so the next paint
  // measures again, and 0.6 em (typical monospace advance) is used meanwhile.
  function advance(glyph) {
    let a = advCache.get(glyph);
    if (a) return a;
    probe.textContent = glyph.repeat(64);
    a = probe.getBoundingClientRect().width / 64;
    if (a > 0) advCache.set(glyph, a);
    else a = BASE * 0.6; // not laid out yet
    return a;
  }

  // Fit: scale = available width / natural width, clamped to 0.02..4 (a 400-column grid in a phone still fits; a
  // 20-column grid does not balloon). Manual: scale = requested font size / BASE. ceil on the box: a fractional
  // box would clip the last pixel column of the transformed sheet.
  function layout() {
    if (!natW) return;
    const avail = Math.max(40, screen.clientWidth - 2 * PAD);
    s = vw.fit ? clamp(avail / natW, 0.02, 4) : vw.fontSize / BASE;
    sheet.style.transform = `scale(${s})`;
    box.style.width = Math.ceil(natW * s) + 'px';
    box.style.height = Math.ceil(natH * s) + 'px';
    const px = BASE * s;
    zVal.textContent = (px < 10 ? px.toFixed(1) : Math.round(px)) + ' px';
    zFit.setAttribute('aria-pressed', String(!!vw.fit));
    zFit.classList.toggle('asc-on', !!vw.fit);
  }

  // Cell backgrounds (one pixel per cell) or half-block pixels (two per cell), stretched under the text.
  // grid.fg / grid.bg are flat RGB arrays (3 bytes per cell), hence the i * 3 offsets. Half blocks: with colour, the
  // top pixel takes fg and the bottom bg (the converter's encoding of a 2-pixel cell); monochrome half blocks are
  // decoded from the glyph itself (upper, lower or full block) and painted in the ink colour.
  function paintPixels(grid, look) {
    const half = grid.ramp === 'half';
    if (!half && !grid.bg) { bgc.hidden = true; return; }
    const W = grid.cols, H = half ? grid.rows * 2 : grid.rows;
    if (bgc.width !== W || bgc.height !== H) { bgc.width = W; bgc.height = H; }
    const ctx = bgc.getContext('2d');
    const img = ctx.createImageData(W, H);
    const d = img.data, { codes, fg, bg, cols } = grid;
    const ink = parseHex(look.fg) || [255, 255, 255];
    const put = (p, rgb, i) => { d[p] = rgb[i]; d[p + 1] = rgb[i + 1]; d[p + 2] = rgb[i + 2]; d[p + 3] = 255; };
    for (let i = 0, n = cols * grid.rows; i < n; i++) {
      const r = (i / cols) | 0, c = i - r * cols;
      if (!half) { put((r * W + c) * 4, bg, i * 3); continue; }
      const top = (2 * r * W + c) * 4, bot = top + W * 4;
      if (fg && bg) { put(top, fg, i * 3); put(bot, bg, i * 3); continue; }
      const cp = codes[i];
      if (cp === HALF_UPPER || cp === FULL_BLOCK) put(top, ink, 0);
      if (cp === HALF_LOWER || cp === FULL_BLOCK) put(bot, ink, 0);
    }
    ctx.putImageData(img, 0, 0);
    bgc.hidden = false;
  }

  // textContent for plain text (no parsing, no escaping concerns); innerHTML only for coloured output, produced by
  // writers.js toHTML, which escapes the characters it emits. data-* attributes expose the grid shape to tests and
  // CSS. Colours reach CSS as custom properties on the frame (--asc-bg / --asc-fg), so the stylesheet owns the look.
  function paint(grid, look, glyph) {
    last = grid;
    const half = grid.ramp === 'half';
    // Half blocks are painted as pixels; the (transparent) text stays for selection and copying.
    if (half || !grid.fg) pre.textContent = grid.chars.join('\n');
    else pre.innerHTML = toHTML(grid, { bg: false });
    pre.classList.toggle('asc-ghost', half);
    pre.dataset.cols = grid.cols;
    pre.dataset.rows = grid.rows;
    pre.dataset.ramp = grid.ramp;
    pre.dataset.color = grid.color;
    paintPixels(grid, look);
    const adv = advance(glyph);
    const lh = adv * grid.aspect;
    pre.style.lineHeight = lh + 'px';
    natW = grid.cols * adv;
    natH = grid.rows * lh;
    sheet.style.width = natW + 'px';
    sheet.style.height = natH + 'px';
    el.classList.toggle('asc-paper', !!look.paper);
    el.style.setProperty('--asc-bg', look.bg);
    el.style.setProperty('--asc-fg', look.fg);
    layout();
  }

  function setStats(grid, ms) {
    const n = grid.cols * grid.rows;
    stats.textContent = `${grid.cols} × ${grid.rows} · ${t('asc.statChars', { n })} · ${t('asc.statMs', { ms: ms < 10 ? ms.toFixed(1) : Math.round(ms) })}`;
  }

  function relabel() {
    pre.setAttribute('aria-label', t('asc.preview'));
    screen.setAttribute('aria-label', t('asc.preview'));
    zOut.title = t('asc.zoomOut'); zOut.setAttribute('aria-label', zOut.title);
    zIn.title = t('asc.zoomIn'); zIn.setAttribute('aria-label', zIn.title);
    zFit.title = t('asc.fit'); zFit.setAttribute('aria-label', zFit.title);
    cueText.textContent = t('asc.dropHere');
  }

  // Keyboard zoom on the focused screen: + / - / 0 (fit).
  screen.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const act = e.key === '+' || e.key === '=' ? 'in' : e.key === '-' || e.key === '_' ? 'out' : e.key === '0' ? 'fit' : null;
    if (act) { e.preventDefault(); onZoom(act); }
  });
  // Files dropped on the preview load like the drop zone.
  // dragenter/dragleave fire for every child element crossed, so a simple boolean flickers; a depth counter shows
  // the cue until the pointer really leaves the view. dragover must preventDefault or the drop event never fires.
  let depth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  view.addEventListener('dragenter', (e) => { if (hasFiles(e)) { depth++; cue.hidden = false; } });
  view.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  view.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; cue.hidden = true; } });
  view.addEventListener('drop', (e) => {
    depth = 0;
    cue.hidden = true;
    if (!hasFiles(e)) return;
    e.preventDefault();
    const files = [...e.dataTransfer.files];
    if (files.length) onFiles(files);
  });
  // Refit when the screen element resizes (window, panel, breakpoints); only in fit mode, manual zoom is absolute.
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (vw.fit) layout(); }).observe(screen);
  relabel();

  return {
    el, paint, setStats, relabel, advance, layout,
    setView(v) { vw = { ...vw, ...v }; layout(); },
    setTitle(text, badgeText, live) {
      title.textContent = text;
      badge.textContent = badgeText || '';
      badge.hidden = !badgeText;
      badge.classList.toggle('asc-live', !!live);
    },
    scale: () => s,
    grid: () => last,
  };
}
