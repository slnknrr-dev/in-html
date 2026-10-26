// img2ascii-app/export.js - export card and file writers: TXT, ANSI, HTML page, SVG, PNG and clipboard.
// The format writers live in ../ascii (writers.js, raster.js, DOM-free and testable); this module only picks
// parameters from the preview (colours, measured char width) and handles files, buttons and errors.
// Text formats declare charset=utf-8 in the MIME type: braille and block glyphs are non-ASCII, and a viewer guessing
// a legacy code page would show mojibake.
import { button, card, copyText, download, select, seg, toast } from '../ui/app.js';
import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { MONO_STACK, toANSI, toHTML, toHTMLPage, toSVG, toText } from '../ascii/writers.js';
import { drawGrid, rasterSize } from '../ascii/raster.js';

const KINDS = ['txt', 'ans', 'html', 'svg', 'png'];
const ICONS = { txt: 'doc', ans: 'terminal', html: 'embed', svg: 'image', png: 'image' };
// Beyond these, canvas allocation fails silently in some browsers (a blank image or a null blob) instead of throwing.
const MAX_SIDE = 16000, MAX_AREA = 120e6; // canvas limits of the common browsers, with a margin

/**
 * ctx(): { grid, look, set, base (file name without extension), title, charWidth (em), aspect }
 * Returns the content of an export as { data (string | Blob), name, type }.
 */
export async function makeExport(kind, ctx) {
  const { grid, look, set, base, title, charWidth } = ctx;
  // Line height in em = char width (em) x cell aspect: reproduces the preview's cell proportions in any font size.
  const lineHeight = Math.round(charWidth * grid.aspect * 1000) / 1000;
  if (kind === 'txt') return { data: toText(grid), name: base + '.txt', type: 'text/plain;charset=utf-8' };
  if (kind === 'ans') return { data: toANSI(grid), name: base + '.ans', type: 'text/plain;charset=utf-8' };
  if (kind === 'html') {
    const html = toHTMLPage(grid, { title, background: look.bg, foreground: look.fg, fontSize: 12, lineHeight, lang: document.documentElement.lang || 'en' });
    return { data: html, name: base + '.html', type: 'text/html;charset=utf-8' };
  }
  if (kind === 'svg') {
    const svg = toSVG(grid, { title, background: look.bg, foreground: look.fg, fontSize: 12, charWidth, padding: 16 });
    return { data: svg, name: base + '.svg', type: 'image/svg+xml;charset=utf-8' };
  }
  // PNG: the largest requested font size that keeps the canvas within browser limits. Linear search downward: at
  // most ~30 steps of a cheap size computation. The user is told when the size was reduced. The canvas is shrunk to
  // 0 x 0 afterwards to free its (possibly hundreds of MB) backing store immediately rather than at GC.
  // KNOWN DEFECT: canvas.toBlob may call back with null (encoding failed, e.g. memory pressure near the limits);
  // that null is passed to download() and reported as "saved". Fix: reject when blob is null.
  let cell = set.pngCell;
  const opts = () => ({ cell, charWidth, padding: Math.round(cell * 1.4), background: look.bg, foreground: look.fg, fontFamily: MONO_STACK });
  let size = rasterSize(grid, opts());
  while (cell > 2 && (size.width > MAX_SIDE || size.height > MAX_SIDE || size.width * size.height > MAX_AREA)) {
    cell--;
    size = rasterSize(grid, opts());
  }
  if (cell !== set.pngCell) toast(t('asc.pngShrunk', { n: cell }), 'warn');
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  drawGrid(canvas.getContext('2d'), grid, opts());
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  canvas.width = canvas.height = 0;
  return { data: blob, name: base + '.png', type: 'image/png' };
}

// Clipboard text of a format: plain text, ANSI escapes or an HTML <pre> snippet with inline styles.
// Inline styles because pasted HTML (mail, CMS editors) drops <style> blocks. Double quotes in the font stack become
// single quotes: the whole stack sits inside a double-quoted style attribute. look.bg/fg are validated hex colours
// (settings.js), so they cannot break out of the attribute.
export function clipText(fmt, ctx) {
  const { grid, look, charWidth } = ctx;
  if (fmt === 'ansi') return toANSI(grid);
  if (fmt === 'html') {
    const lh = Math.round(charWidth * grid.aspect * 1000) / 1000;
    const font = MONO_STACK.replace(/"/g, '\'');
    return `<pre style="margin:0;padding:16px;background:${look.bg};color:${look.fg};font:12px/${lh} ${font};white-space:pre">${toHTML(grid)}</pre>`;
  }
  return toText(grid);
}

/**
 * The export card under the stage. getCtx() returns the export context (null while nothing is converted);
 * onSet(patch) stores the PNG size / copy format.
 */
// `busy` blocks double clicks per format while an async export (PNG encoding) runs; the button is disabled too, for
// visual feedback. finally re-enables it whatever happened.
export function buildExport(getCtx, set, onSet) {
  const busy = new Set();
  const run = async (kind, btn) => {
    const ctx = getCtx();
    if (!ctx || busy.has(kind)) return;
    busy.add(kind);
    btn.disabled = true;
    try {
      const r = await makeExport(kind, ctx);
      download(r.data, r.name, r.type);
      toast(t('asc.saved', { name: r.name }), 'ok');
    } catch (e) {
      toast(t('err.generic', { msg: e.message || String(e) }), 'error');
    } finally {
      busy.delete(kind);
      btn.disabled = false;
    }
  };
  const btns = KINDS.map((k) => {
    const b = button('asc.exp.' + k, ICONS[k], () => run(k, b));
    b.dataset.export = k;
    b.title = t('asc.expT.' + k);
    return b;
  });
  const sizes = [8, 10, 12, 14, 16, 20, 24, 32].map((v) => ({ v, l: '=' + v + ' px' }));
  const png = select(sizes, set.pngCell, (v) => onSet({ pngCell: +v }));
  png.id = 'asc-pngsize';
  png.classList.add('asc-pngsel');
  png.setAttribute('aria-label', t('asc.pngSize'));
  png.title = t('asc.pngSize');
  const fmt = seg(['text', 'ansi', 'html'].map((v) => ({ v, l: 'asc.fmt.' + v })), set.copyFmt, (v) => onSet({ copyFmt: v }), 'asc.copyAs');
  fmt.id = 'asc-copyfmt';
  const copy = button('ap.copy', 'copy', () => { const ctx = getCtx(); if (ctx) copyText(clipText(set.copyFmt, ctx)); }, 'primary');
  copy.id = 'asc-copy';
  return card('asc.export',
    h('div', { class: 'asc-exp' },
      h('div', { class: 'asc-exp-files' }, btns.slice(0, 4), h('span', { class: 'asc-pngpair' }, btns[4], png)),
      h('div', { class: 'asc-exp-copy' }, h('span', { class: 'ed-label' }, t('asc.copyAs')), fmt, copy)));
}
