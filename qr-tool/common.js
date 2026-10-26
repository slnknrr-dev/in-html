// qr-tool/common.js - shared parts of the create and scan pages: the shell (pages resolved from the hidden
// anchors of the page HTML, so the build can rewrite them), app icons, content-type metadata, scan history, small
// widgets (radio chip grid, labelled group) and raster helpers.
//
// Design rules: pure helpers and widgets, no page state. Everything that touches storage is a small named function
// (history*), so the pages never hard-code keys. Persisted data is filtered by shape on read.
import './strings.js';
import { startApp, t } from '../ui/app.js';
import { h, lsGet, lsSet } from '../ui/dom.js';
import { addIcons, iconEl } from '../ui/icons.js';

export const LOGO = 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM6 6h1M17 6h1M6 17h1M14 14h3v3h-3zM18 18h3v3h-3zM18 14h3M14 18v3';

addIcons({
  wifi: 'M5 12.6a11 11 0 0 1 14 0M1.5 9a16 16 0 0 1 21 0M8.5 16.1a6 6 0 0 1 7 0M12 20h.01',
  call: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z',
  coin: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.5 7.5h4a2.2 2.2 0 0 1 0 4.5h-4zM9.5 12h4.5a2.25 2.25 0 0 1 0 4.5H9.5zM9.5 7.5v9M11 6v1.5M11 16.5V18',
  swap: 'M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  video: 'M3 6h12v12H3zM15 10l6-3v10l-6-3',
  videoOff: 'M3 3l18 18M15 10l6-3v10l-6-3M15 15v3H3V6h3',
  ok: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8 12l3 3 5-6',
  qrcode: LOGO,
});

// Content types in picker order: key, icon.
// Content types as [key, icon]: the key selects the form (main.js) and the i18n label ('qr.type.' + key).
export const TYPES = [
  ['url', 'link'], ['text', 'type'], ['wifi', 'wifi'], ['contact', 'user'], ['email', 'mail'],
  ['sms', 'chat'], ['phone', 'call'], ['geo', 'pin'], ['event', 'calendar'], ['crypto', 'coin'],
];
export const typeIcon = (k) => (TYPES.find((x) => x[0] === k) || ['', 'type'])[1];

// Resolved hrefs of the two pages (hidden anchors in the page HTML; the build rewrites their href).
// getAttribute, not a.href: .href would be absolute (file:///...), breaking relative links after publishing.
export function pageHref(id) {
  const a = document.getElementById(id);
  return a ? a.getAttribute('href') : '#';
}

export function startShell(current, onLang) {
  startApp({
    key: 'qr', name: 'qr.name', logo: LOGO, offline: true, onLang,
    pages: [
      { href: pageHref('pg-create'), label: 'qr.page.create', current: current === 'create' },
      { href: pageHref('pg-scan'), label: 'qr.page.scan', current: current === 'scan' },
    ],
  });
}

// --- scan history (localStorage, newest first, 20 entries) --------------------------------------------------------

const HKEY = 'qr-history';
export const historyList = () => { const v = lsGet(HKEY, []); return Array.isArray(v) ? v.filter((e) => e && typeof e.text === 'string') : []; };
export function historyAdd(entry) {
  // Re-scanning the same text moves it to the top instead of duplicating it; capped at 20 entries.
  const list = historyList().filter((e) => e.text !== entry.text);
  list.unshift({ ...entry, at: Date.now() });
  lsSet(HKEY, list.slice(0, 20));
}
export const historyClear = () => lsSet(HKEY, []);

// --- widgets ------------------------------------------------------------------------------------------------------

let gid = 0;
// Labelled group for non-input controls (radio grids): the label names the group through aria-labelledby.
// A radiogroup is not labelable: aria-labelledby names it instead of <label for>.
export function group(label, control, hint) {
  const id = 'qr-g' + (++gid);
  control.setAttribute('aria-labelledby', id);
  return h('div', { class: 'ed-field' }, h('span', { class: 'ed-label', id }, t(label)), control, hint ? h('div', { class: 'ed-hint' }, hint) : null);
}

/**
 * Radio chip grid with roving focus (arrow keys move and select).
 * options: [{ v, label (text), icon? (name), html? (inline SVG), title? }]
 */
export function chipGrid(options, value, onChange, cls = '') {
  // WAI-ARIA radio group with roving tabindex: one Tab stop (the checked chip), arrows move and select. Up/Down jump
  // by the visual column count, estimated from container width / chip width, so 2D grids navigate as they look.
  // Icon-only chips (html art without a label) get their accessible name from the title.
  const g = h('div', { class: 'qr-chips ' + cls, role: 'radiogroup' });
  const btns = options.map((o) => h('button', {
    type: 'button', role: 'radio', class: 'qr-chip', dataset: { v: String(o.v) }, title: o.title || null,
    'aria-label': o.html && !o.label ? o.title : null,
    onclick: () => pick(o.v, true),
  }, o.icon ? iconEl(o.icon) : null, o.html ? h('span', { class: 'qr-chip-art', html: o.html }) : null, o.label ? h('span', { class: 'qr-chip-l' }, o.label) : null));
  function paint(v) {
    for (const b of btns) {
      const on = b.dataset.v === String(v);
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('qr-on', on);
      b.tabIndex = on ? 0 : -1;
    }
  }
  function pick(v, fire) { paint(v); if (fire) onChange(v); }
  g.addEventListener('keydown', (e) => {
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    const cols = Math.max(1, Math.round(g.clientWidth / (btns[0].offsetWidth || 1)));
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols, Home: -i, End: btns.length - 1 - i }[e.key];
    if (step == null) return;
    e.preventDefault();
    const j = Math.min(btns.length - 1, Math.max(0, i + step));
    btns[j].focus();
    pick(options[j].v, true);
  });
  g.append(...btns);
  paint(value);
  return g;
}

// --- raster helpers -----------------------------------------------------------------------------------------------

// Promise wrapper over <img> loading; used to rasterise SVG through an image (the only way to draw SVG on canvas).
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image'));
    img.src = src;
  });
}

// Percent-encoded data: URI (not base64): shorter for SVG text, and safe for '#', which would end the URI.
export const svgURL = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

// Renders SVG markup (with explicit width / height) onto a size x size canvas over `background`.
// Rasterising through an <img> keeps the canvas origin-clean: the SVG is a data: URI built locally, so toBlob is
// allowed. Drawing at the target size lets the browser render the vector sharply instead of scaling a bitmap.
export async function svgToCanvas(svg, size, background = '#ffffff') {
  const img = await loadImage(svgURL(svg));
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, size, size); }
  ctx.drawImage(img, 0, 0, size, size);
  return c;
}

// toBlob is callback-based; wrapped for await. Resolves null on failure.
export const canvasBlob = (c, type = 'image/png') => new Promise((resolve) => c.toBlob(resolve, type));

// Short, single-line preview of a text.
export const snippet = (s, n = 80) => { const x = String(s).replace(/\s+/g, ' ').trim(); return x.length > n ? x.slice(0, n - 1) + '…' : x; };
