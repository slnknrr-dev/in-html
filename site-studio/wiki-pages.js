// site-studio/wiki-pages.js - complete HTML documents of a published knowledge base, shared by the exporter
// (prerendered files of a static site, the single-file page) and the servers (pages rendered per request). Pure
// functions (Node and browsers).
//
//   pageDocument(site, path, { mode, style, base, siteURL }) -> { html, status, title }
//     mode 'static': links and assets relative to the page (works below any base and, in the 'html' style, from disk)
//     mode 'server': absolute links below `base` ('/kb/x/'), <meta name="kp-base">
//     The document loads <prefix>_kp/kb.css, <prefix>_kp/kb.js (KP_DATA) and <prefix>_kp/reader.js; without
//     JavaScript it is a complete page. status: 200, or 404 for unknown routes.
//   staticRoutes(site) -> [path]   every route a static export prerenders
//   singleDocument(site, { media, readerCode }) -> HTML of the one-file export (data, media and reader inline)
//   notFoundDocument(site, { base }) -> 404.html of a static export (spa/notfound.js bootstrap)
//   scriptSafe(code) / jsonScript(value)   text that can sit inside <script> safely
import { escapeAttr as attr, escapeHTML as esc } from '../html/escape.js';
import { pathOf } from '../spa/base.js';
import { formatQuery } from '../spa/route.js';
import { relHref, relRoot } from '../spa/prerender.js';
import { notFoundPage } from '../spa/notfound.js';
import { createRenderer } from './wiki-render.js';
import { readerT } from './wiki-strings-reader.js';

// Inline <script> safety. The HTML tokenizer ends a script at '</script' regardless of JS syntax, and '<!--' inside
// a script switches to the "escaped" state where a later '<script' changes parsing. '<\/' is the same string to JS.
// jsonScript escapes every '<' as \u003c (covers both cases) and U+2028/2029, which were line terminators inside
// string literals before ES2019 and still break older engines.
export const scriptSafe = (code) => String(code).replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
export const jsonScript = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16));

// Text colour on the accent: WCAG relative luminance (sRGB linearisation, Rec.709 weights). Threshold 0.4 rather
// than the contrast-equal 0.179: favours white text on mid-tones, which reads better on saturated brand colours.
// Invalid input returns '' so the CSS fallback applies.
function onAccent(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '';
  let h = m[1];
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const lin = (i) => { const c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4) > 0.4 ? '#111111' : '#ffffff';
}

// Theme, mode and accent live on <html> as attributes / custom properties: kb.css switches whole themes by attribute
// selector, and the page is styled correctly before any script runs (no flash).
const htmlOpen = (site, mode) => `<!doctype html>\n<html lang="${attr(site.lang || 'en')}" data-kp-theme="${attr(site.theme || 'encyclopedia')}" data-kp-mode="${mode}"${site.accent ? ` style="--kp-accent:${attr(site.accent)};--kp-accent-fg:${onAccent(site.accent)}"` : ''}>`;
const headCommon = (title, desc) => `<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="color-scheme" content="light dark">\n<title>${esc(title)}</title>\n${desc ? `<meta name="description" content="${attr(desc.slice(0, 300))}">\n` : ''}`;
// Generated letter icon: zero files to ship. encodeURIComponent leaves ' unescaped, so it is encoded by hand: the
// href is double-quoted so a raw ' would work today; encoding it keeps the URI valid in any quoting context.
const favicon = (site) => {
  const ch = esc(((site.title || 'K').trim()[0] || 'K').toUpperCase());
  const color = /^#[0-9a-f]{3,6}$/i.test(site.accent || '') ? site.accent : '#3366cc';
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='${color}'/><text x='16' y='22' text-anchor='middle' font-family='Georgia,serif' font-size='19' font-weight='700' fill='${onAccent(color)}'>${ch}</text></svg>`;
  return `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27')}">\n`;
};

// Every route the static export must prerender. A Set dedupes (a category both declared and used). Special pages are
// emitted only when enabled: a disabled feature must not exist as a crawlable URL. Pages of the home slug map to ''
// (index.html), never to a duplicate file.
export function staticRoutes(site) {
  const out = new Set(['']);
  for (const p of site.pages || []) out.add(p.slug === site.home ? '' : p.slug);
  const s = site.settings || {};
  for (const c of site.cats || []) out.add('category/' + c.slug);
  for (const p of site.pages || []) for (const c of p.cats || []) out.add('category/' + c);
  if ((site.cats || []).length) out.add('special/categories');
  if (s.allPages !== false) out.add('special/all');
  if (s.recent !== false) out.add('special/recent');
  if (s.search !== false) out.add('special/search');
  if (s.random !== false) out.add('special/random');
  if ((site.sealed || []).length) out.add('special/unlock');
  if (s.backlinks !== false) for (const p of site.pages || []) if (p.kind !== 'redirect') out.add('special/links/' + p.slug);
  return [...out];
}

// Main content of a route: { html, title, desc, status }.
// Status is decided here, server-side, from the route: crawlers and servers need a real 404, which a client-side
// router cannot give. Category pages detect emptiness via the kp-404 marker the renderer emits. 'random' prerenders
// as 'all': a static file cannot pick at random; the reader replaces it at runtime.
function mainOf(R, site, path) {
  const r = R.resolveRoute(path);
  if (r.kind === 'page' || r.kind === 'redirect') {
    const out = R.article(r.page, { redirectedFrom: r.kind === 'redirect' ? r.from.title : '' });
    const pv = R.preview(R.routeOfPage(r.page));
    return { html: out.html, title: out.title, desc: pv ? pv.text : '', status: 200 };
  }
  if (r.kind === 'category') {
    const out = R.special('category', r.arg);
    return { html: out.html, title: out.title.replace(/<[^>]+>/g, ''), desc: '', status: /kp-404/.test(out.html) ? 404 : 200 };
  }
  if (r.kind === 'special' && ['all', 'recent', 'categories', 'unlock', 'search', 'random'].includes(r.name)) {
    const out = R.special(r.name === 'random' ? 'all' : r.name, '');
    return { html: out.html, title: R.t('r.special.' + r.name), desc: '', status: 200 };
  }
  if (r.kind === 'special' && r.name === 'links' && R.findPage(r.arg)) {
    const out = R.special('links', r.arg);
    return { html: out.html, title: R.t('r.special.links'), desc: '', status: 200 };
  }
  const out = R.special('missing', path);
  return { html: out.html, title: out.title, desc: '', status: 404 };
}

// Two link strategies: 'server' links are absolute below base (one origin, known mount); 'static' links are relative
// to the page (relRoot), so the export works below any base and, in 'html' style, opened from disk.
// The document is complete without JS (prerendered article); kb.js (data, defer) and reader.js (module, deferred by
// spec) upgrade it. 404 pages get noindex so search engines drop them.
export function pageDocument(site, path, { mode = 'static', style = 'clean', base = '/' } = {}) {
  const t = readerT(site.uiLang);
  const prefix = mode === 'server' ? encodeURI(base) : relRoot(path, style);
  const href = mode === 'server'
    ? (r) => { const q = formatQuery(r.query); return pathOf(r.path, base, style) + (q ? '?' + q : '') + (r.frag ? '#' + encodeURIComponent(r.frag) : ''); }
    : (r) => relHref(path, r, style);
  const mediaSrc = (id) => { const m = (site.media || {})[id]; return m ? prefix + '_kp/media/' + encodeURIComponent(m.f || id) : ''; };
  const R = createRenderer(site, { t, href, mediaSrc });
  const main = mainOf(R, site, path);
  const title = main.title && path !== '' ? `${main.title} — ${site.title}` : site.title;
  const body = R.shell(main.html, { route: path });
  const html = htmlOpen(site, mode) + '\n<head>\n' + headCommon(title, main.desc || site.tagline) + favicon(site) +
    `<meta name="kp-route" content="${attr(path)}">\n` + (mode === 'server' ? `<meta name="kp-base" content="${attr(base)}">\n` : '') +
    (main.status === 404 ? '<meta name="robots" content="noindex">\n' : '') +
    `<link rel="stylesheet" href="${attr(prefix)}_kp/kb.css">\n<script defer src="${attr(prefix)}_kp/kb.js"></script>\n<script type="module" src="${attr(prefix)}_kp/reader.js"></script>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
  return { html, status: main.status, title };
}

// Static hosts serve 404.html for every unknown path. The bootstrap (spa/notfound.js) loads the reader so that
// virtual routes (search, unlocked 451 pages, backlinks) render under their real URL. The inline style hides the
// fallback text while JS is booting (kp-js) unless the boot failed (spa-failed): no flash of "not found" on a valid
// virtual route, and still readable without JS. site.theme is from the THEMES whitelist (model.js), safe in script.
export function notFoundDocument(site, { base = '', style = 'clean' } = {}) {
  const t = readerT(site.uiLang);
  return notFoundPage({
    lang: site.lang, title: t('r.notFound') + ' — ' + site.title,
    head: `<meta name="color-scheme" content="light dark">\n${favicon(site)}<script>var h=document.documentElement;h.setAttribute('data-kp-theme',${JSON.stringify(site.theme || 'encyclopedia')});h.setAttribute('data-kp-mode','static');h.className+=' kp-js';</script>\n` +
      `<style>body>main.kp-nf{font:16px/1.5 system-ui,sans-serif;margin:3rem auto;max-width:40rem;padding:0 1rem}html.kp-js:not(.spa-failed) body>main.kp-nf{visibility:hidden}</style>`,
    body: `<main class="kp-nf"><h1>${esc(t('r.notFound'))}</h1><p>404 · <a href="${attr(base || '/')}">${esc(site.title)}</a></p></main>`,
    boot: { probe: '_kp/kb.js', global: 'KP_DATA', idPath: 'site.id', id: site.id, base: base || '', key: 'kp-base:' + site.id, load: [{ css: '_kp/kb.css' }, { js: '_kp/reader.js', module: true }], style },
  });
}

// One-file export: data as a JSON <script> (type=application/json is never executed, parsed with JSON.parse), CSS
// and reader inline. '</style' is broken the same way as '</script' because it would end the style element.
export function singleDocument(site, { media = {}, readerCode = '', css = '' } = {}) {
  const t = readerT(site.uiLang);
  // Without JavaScript the file shows the home page (links need the reader).
  const R = createRenderer(site, { t, mediaSrc: () => '' });
  const home = mainOf(R, site, '');
  const html = htmlOpen(site, 'single') + '\n<head>\n' + headCommon(site.title, home.desc || site.tagline) + favicon(site) +
    `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>\n<script id="kp-data" type="application/json">${jsonScript({ site, media })}</script>\n</head>\n<body>\n` +
    R.shell(home.html, { route: '' }) + `\n<script type="module">${scriptSafe(readerCode)}</script>\n</body>\n</html>\n`;
  return html;
}
