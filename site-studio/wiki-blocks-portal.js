// site-studio/wiki-blocks-portal.js - the portal blocks of the shared library (../portal/) as knowledge-base
// blocks: legal act, glossary of terms, directory, requests board, topic hub, checklist, unified search. Only an
// adapter: the field schemas are converted from the neutral models (portal/models.js), the markup comes from
// portal/markup.js through a view adapter over the article's render context (wiki markup, links, media, routes), and
// the site catalog (articles, terms, people across all pages) is built once per renderer (render.js portalCatalog).
//
//   PORTAL_BLOCKS[type] = { cat: 'portal', icon, fields, render(b, c) }   (merged into BLOCKS by blocks.js)
//   PORTAL_TYPES
import { escapeAttr as attr, escapeHTML as esc } from '../html/escape.js';
import { PT_BLOCKS, PT_TYPES } from '../portal/models.js';
import { PT_RENDER, enrichHTML, tipsHTML } from '../portal/markup.js';
import { ptFieldHint, ptFieldLabel, ptOptionLabel } from '../portal/strings-editor.js';
import { todayNumber } from '../portal/records.js';

// Why an adapter rather than copies: the same portal blocks exist in the landing editor; one model and one markup
// generator (../portal/) keep both products identical, and this file only maps vocabulary. Cost: portal markup
// must be written against the abstract view V (below), never against a concrete render context.
export const PORTAL_TYPES = PT_TYPES;

// Neutral field kinds -> knowledge field kinds (model.js normField, ed-blocks.js controls); `label` / `hint` / `ol`
// carry the shared editor labels.
// Mapping of neutral kinds to model.js kinds. 'code' becomes a short 'plain' (300 chars: identifiers, not prose).
// Unknown kinds fall back to 'media' because the only remaining neutral kind is a file reference; a new neutral kind
// must be added here explicitly or it would be normalised as a media id (and dropped).
function kpField(f) {
  const base = { label: ptFieldLabel(f), hint: ptFieldHint(f) || undefined, ol: (v) => ptOptionLabel(f, v) };
  switch (f.t) {
    case 'text': return { ...base, k: 'line' };
    case 'long': return { ...base, k: 'text' };
    case 'code': return { ...base, k: 'plain', max: 300 };
    case 'link': return { ...base, k: 'link' };
    case 'day': return { ...base, k: 'day' };
    case 'num': return { ...base, k: 'num', d: f.d ?? null, min: f.min ?? -1e9, max: f.max ?? 1e9 };
    case 'bool': return { ...base, k: 'bool', d: !!f.d };
    case 'select': return { ...base, k: 'select', o: f.o };
    default: return { ...base, k: 'media' };
  }
}

const ICONS = { act: 'doc', terms: 'keyvalue', directory: 'users', board: 'megaphone', hub: 'stack', checklist: 'check', finder: 'search' };

// Inline 24x24 stroke icons (same grid as ../ui/icons.js): rendered into exported pages, which have no icon sprite.
const SVG = {
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  search: '<path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4"/>',
  print: '<path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M7 14h10v7H7z"/>',
  clock: '<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2"/>',
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"/>',
  globe: '<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
};

// Dates are calendar dates, not instants: built at UTC midnight and formatted with timeZone UTC, so a reader west of
// Greenwich does not see the previous day. Intl may throw on an unknown locale tag: fall back to the ISO text.
const dateOf = (d, lang) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '');
  if (!m) return d || '';
  try { return new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))); } catch { return d; }
};

// The view adapter of portal/markup.js over a knowledge render context `c` (render.js article()).
// View contract expected by portal/markup.js: f/lineIn/longIn render markup, plain strips it, t returns escaped text,
// tl raw text (for attributes the caller escapes), a/img/file build links and media, cat is the cross-page catalog.
// edit:false and no-op feature/need/di: the knowledge reader has no inline editing and no lazy feature loader.
// `cat` is a getter so the catalog (expensive, all pages) is built only by blocks that read it.
function kpView(b, c) {
  const lang = c.lang || 'en';
  const get = (path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), b);
  const str = (v) => (v == null ? '' : typeof v === 'string' ? v : String(v));
  const t = (key, vars) => c.t(key, vars);
  const V = {
    p: 'kp', edit: false, langs: [lang], lang, page: c.page ? c.page.slug : '', today: todayNumber(),
    get cat() { return c.portal ? c.portal() : null; },
    f: (path, kind, tag, cls) => {
      const v = str(get(path));
      if (!v.trim()) return '';
      const html = kind === 'long' ? c.blocks(v) : c.inline(v);
      return tag ? `<${tag}${cls ? ` class="${cls}"` : ''}>${html}</${tag}>` : html;
    },
    has: (v) => !!str(v).trim(),
    plain: (v) => (typeof v === 'number' ? String(v) : c.plainOf(str(v))),
    raw: (v) => str(v),
    lineIn: (v) => c.inline(str(v)),
    longIn: (v) => c.blocks(str(v)),
    inline: (s) => c.inline(s),
    per: (fn) => fn(lang),
    t: (key, vars) => esc(t(key, vars)),
    tl: (key, l, vars) => t(key, vars),
    attr: (name, fn) => ` ${name}="${attr(fn(lang))}"`,
    link: (v) => {
      const L = c.resolve(str(v));
      return L ? { href: L.href, ext: !!L.ext, title: L.title || '' } : null;
    },
    a: (href, cls, extra = '') => `<a${cls ? ` class="${cls}"` : ''} href="${attr(href)}"${/^https?:/i.test(href) ? ' rel="noopener" target="_blank"' : ''}${extra}>`,
    img: (id, o = {}) => {
      const m = id ? c.media(id) : null;
      if (!m || !m.type.startsWith('image/') || !m.src) return '';
      return `<img${o.cls ? ` class="${o.cls}"` : ''} src="${attr(m.src)}" alt="${attr(o.alt || '')}"${m.w && m.h ? ` width="${m.w}" height="${m.h}"` : ''} loading="lazy" decoding="async">`;
    },
    file: (id) => {
      const m = id ? c.media(id) : null;
      return m && m.src ? { href: m.src, name: m.name, type: m.type, size: m.size } : null;
    },
    date: (d) => dateOf(d, lang),
    icon: (n) => (SVG[n] ? `<svg class="kp-pt-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${SVG[n]}</svg>` : ''),
    href: (a) => (c.anchorHref ? c.anchorHref(a) : '#' + a),
    feature: () => {},
    need: () => {},
    di: () => '',
    searchHref: c.searchHref || null,
    searchForm: c.searchHref ? ({ placeholder }) => `<form class="kp-search-big kp-pt-ff" role="search" data-kp-search><input type="search" name="q" aria-label="${attr(t('pt.search'))}" placeholder="${attr(placeholder(lang))}"><button type="submit" class="kp-btn">${esc(t('pt.search'))}</button></form>` : null,
    extraTopic: c.topicPages ? (name) => { const list = c.topicPages(name); return list.length ? { page: list } : {}; } : null,
  };
  return V;
}

// Glossary terms and references to articles in the HTML of the base's own blocks (text, quotes, callouts …): one
// helper per article (render.js) — first occurrence of each term per page, the definitions in one hidden container.
// seen/tips are per-article state shared across all blocks of that article: a term is linked once per page (first
// occurrence), and all definitions referenced on the page are emitted once in a hidden container for hover cards.
// Returns null when the base has no terms or acts, so render.js skips the enrichment pass entirely.
export function portalLinker(c) {
  const cat = c.portal ? c.portal() : null;
  if (!cat || (!cat.terms.length && !cat.acts.size)) return null;
  const V = kpView({}, c);
  const seen = new Map();
  const tips = new Set();
  return {
    link: (html) => enrichHTML(V, html, V.lang, { seen, tips }),
    tips: () => tipsHTML(V, tips),
  };
}

// Built at import time from the neutral specs. A list item becomes the knowledge 'list' kind; legal acts allow 2000
// items (articles of a law), others 500. A fresh view is created per render: views close over the block.
export const PORTAL_BLOCKS =Object.fromEntries(PT_TYPES.map((type) => {
  const spec = PT_BLOCKS[type];
  const fields = {};
  for (const f of spec.fields) fields[f.key] = kpField(f);
  if (spec.item) {
    const item = {};
    for (const f of spec.item.fields) item[f.key] = kpField(f);
    fields.items = { k: 'list', item, max: type === 'act' ? 2000 : 500, itemLabel: spec.item.label };
  }
  return [type, { cat: 'portal', icon: ICONS[type], fields, render: (b, c) => PT_RENDER[type](b, kpView(b, c)) }];
}));
