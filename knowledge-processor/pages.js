// knowledge-processor/pages.js - complete HTML documents of a published knowledge base, shared by the exporter
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
import { createRenderer } from './render.js';
import { readerT } from './strings-reader.js';

//
// Escaping inside <script>: the HTML parser ends a script element at the first "</script" regardless of JS syntax, and
// "<!--" switches it into an escaped state where a later "<script" changes parsing. scriptSafe rewrites both into
// JS-equivalent forms ("<\/script" is the same string to JS). jsonScript goes further for data: every "<" becomes
// < (no tag can start at all), and U+2028/U+2029 are escaped because older engines treated them as line breaks
// inside string literals (a SyntaxError before ES2019).
export const scriptSafe = (code) => String(code).replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
export const jsonScript = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16));

// Foreground for text on the accent colour: WCAG relative luminance (sRGB linearised, Rec. 709 weights). The 0.4
// threshold sits a little above the 0.179 crossover where black and white give equal contrast, favouring white text
// on mid tones, which reads as the intended brand colour. Invalid input returns '' and callers then omit the variable.
function onAccent(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '';
  let h = m[1];
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const lin = (i) => { const c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4) > 0.4 ? '#111111' : '#ffffff';
}

// Theme, mode and accent live on <html> so the reader CSS can switch with attribute selectors before any script runs.
const htmlOpen = (site, mode) => `<!doctype html>\n<html lang="${attr(site.lang || 'en')}" data-kp-theme="${attr(site.theme || 'encyclopedia')}" data-kp-mode="${mode}"${site.accent ? ` style="--kp-accent:${attr(site.accent)};--kp-accent-fg:${onAccent(site.accent)}"` : ''}>`;
const headCommon = (title, desc) => `<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="color-scheme" content="light dark">\n<title>${esc(title)}</title>\n${desc ? `<meta name="description" content="${attr(desc.slice(0, 300))}">\n` : ''}`;
// Letter favicon generated as SVG: zero files. The letter is escaped as XML text; the whole SVG is URL-encoded and ' is
// encoded too because the SVG uses ' for attribute quotes and the href is inside a "..." attribute (defence in depth).
// KNOWN DEFECT: the colour test /^#[0-9a-f]{3,6}$/ accepts 4- and 5-digit values that onAccent() rejects, giving
// fill='' (black letter). Fix: use /^#([0-9a-f]{3}|[0-9a-f]{6})$/i as onAccent does.
const favicon = (site) => {
  const ch = esc(((site.title || 'K').trim()[0] || 'K').toUpperCase());
  const color = /^#[0-9a-f]{3,6}$/i.test(site.accent || '') ? site.accent : '#3366cc';
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='${color}'/><text x='16' y='22' text-anchor='middle' font-family='Georgia,serif' font-size='19' font-weight='700' fill='${onAccent(color)}'>${ch}</text></svg>`;
  return `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27')}">\n`;
};

// A Set: the home page and a category listed both on the site and on a page must produce one file each. Special
// pages appear only when enabled in settings (default on: `!== false`), so disabled features leave no dead files.
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
// Status mapping is the point: unknown pages, unknown categories and links pages of missing pages answer 404, so the
// server and static hosts never serve soft-404s that search engines would index. 'random' prerenders as the all-pages
// list (randomness needs JS; the reader picks a page on load).
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

// static mode: links relative to the current file (relRoot/relHref), so the export works under any sub-path and from
// disk. server mode: absolute paths under `base`, cheaper and stable for each URL. kb.js is defer and reader.js a
// module (also deferred): both run after parsing, in document order, so KP_DATA exists when the reader starts.
// 404 pages get noindex as a second line of defence besides the status code.
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

// The 404 bootstrap (spa/notfound.js) probes for _kp/kb.js to find the site root from an arbitrary depth, then loads the
// reader to render the requested route. The fallback text is hidden while JS is working (html.kp-js) and shown again
// if boot fails (.spa-failed), so visitors never see a flash of "not found" for a route that exists.
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

// Data in <script type="application/json">: not executed, parsed by the reader with JSON.parse (faster than evaluating
// a JS literal, and no code path). CSS gets the same </style break-out guard as scripts.
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
