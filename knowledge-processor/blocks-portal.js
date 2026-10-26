// knowledge-processor/blocks-portal.js - the portal blocks of the shared library (../portal/) as knowledge-base
// blocks: legal act, glossary of terms, directory, requests board, topic hub, checklist, unified search. Only an
// adapter: the field schemas are converted from the neutral models (portal/models.js), the markup comes from
// portal/markup.js through a view adapter over the article's render context (wiki markup, links, media, routes), and
// the site catalog (articles, terms, people across all pages) is built once per renderer (render.js portalCatalog).
//
//   PORTAL_BLOCKS[type] = { cat: 'portal', icon, fields, render(b, c) }   (merged into BLOCKS by blocks.js)
//   PORTAL_TYPES
//
// Why an adapter and not a fork of the portal blocks: portal/ is shared with other apps; copying its models and
// markup here would drift on the first fix. The price is this thin translation layer: field kinds are mapped
// (kpField) and portal/markup.js renders against a view object V (kpView) instead of the knowledge renderer directly.
// Escaping contract: V.t / V.attr / V.a / V.img escape; V.raw does not (callers in portal/markup.js escape it).
import { escapeAttr as attr, escapeHTML as esc } from '../html/escape.js';
import { PT_BLOCKS, PT_TYPES } from '../portal/models.js';
import { PT_RENDER, enrichHTML, tipsHTML } from '../portal/markup.js';
import { ptFieldHint, ptFieldLabel, ptOptionLabel } from '../portal/strings-editor.js';
import { todayNumber } from '../portal/records.js';

export const PORTAL_TYPES = PT_TYPES;

// Neutral field kinds -> knowledge field kinds (model.js normField, ed-blocks.js controls); `label` / `hint` / `ol`
// carry the shared editor labels.
// Unknown neutral kinds fall to 'media' (default branch): the only remaining neutral kind is a file/image picker; a
// new kind added to portal/models.js would show up as a media picker, visible in the editor rather than silently lost.
// 'code' becomes plain text capped at 300 chars (identifiers, article numbers), not rich text.
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

// Editor palette icons per block type (names from ui/icons.js).
const ICONS = { act: 'doc', terms: 'keyvalue', directory: 'users', board: 'megaphone', hub: 'stack', checklist: 'check', finder: 'search' };

// Inline SVG path data the portal markup asks for by name (V.icon). Inline, not <use href>: the published page has no
// sprite sheet, and single-file exports must work from file://.
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

// Dates are calendar days (YYYY-MM-DD), not instants: built and formatted in UTC so no time zone can shift them to the
// previous day. Intl may throw on an unknown locale tag; the raw string is the fallback.
const dateOf = (d, lang) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '');
  if (!m) return d || '';
  try { return new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))); } catch { return d; }
};

// The view adapter of portal/markup.js over a knowledge render context `c` (render.js article()).
// edit:false - published/preview markup, never editor chrome. `cat` is a getter so the site catalog is built only
// when a block actually needs it (render.js caches it per renderer). get(path) walks dotted paths ('items.0.title').
function kpView(b, c) {
  const lang = c.lang || 'en';
  const get = (path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), b);
  const str = (v) => (v == null ? '' : typeof v === 'string' ? v : String(v));
  const t = (key, vars) => c.t(key, vars);
  const V = {
    p: 'kp', edit: false, langs: [lang], lang, page: c.page ? c.page.slug : '', today: todayNumber(),
    get cat() { return c.portal ? c.portal() : null; },
    // Field value through the knowledge markup: 'long' as blocks (paragraphs, lists), anything else inline. Empty or
    // whitespace-only values render nothing so the portal markup can skip whole sections.
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
    // External links (http/https) open in a new tab with rel=noopener: the opened page gets no window.opener handle and
    // cannot navigate this tab (reverse tabnabbing).
    a: (href, cls, extra = '') => `<a${cls ? ` class="${cls}"` : ''} href="${attr(href)}"${/^https?:/i.test(href) ? ' rel="noopener" target="_blank"' : ''}${extra}>`,
    // Only images with a resolved src; width/height when known reserve the box and prevent layout shift while loading;
    // lazy + async decoding keep long directories from blocking first paint.
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
    // No-op hooks: other hosts of portal/markup.js use them to load optional scripts or design-system classes; the
    // knowledge reader ships its portal behaviour in one script, keyed by data-pt-* attributes.
    feature: () => {},
    need: () => {},
    di: () => '',
    searchHref: c.searchHref || null,
    // Present only when the site has search enabled; data-kp-search lets the reader intercept the submit and route to
    // its search page instead of a server round trip.
    searchForm: c.searchHref ? ({ placeholder }) => `<form class="kp-search-big kp-pt-ff" role="search" data-kp-search><input type="search" name="q" aria-label="${attr(t('pt.search'))}" placeholder="${attr(placeholder(lang))}"><button type="submit" class="kp-btn">${esc(t('pt.search'))}</button></form>` : null,
    extraTopic: c.topicPages ? (name) => { const list = c.topicPages(name); return list.length ? { page: list } : {}; } : null,
  };
  return V;
}

// Glossary terms and references to articles in the HTML of the base's own blocks (text, quotes, callouts …): one
// helper per article (render.js) — first occurrence of each term per page, the definitions in one hidden container.
// Returns null when there is nothing to link (no terms, no acts), so callers skip the HTML pass entirely.
// `seen` makes each term link only its first occurrence per page (repeated tooltips are noise); `tips` collects the
// definitions to emit once in a hidden container, instead of duplicating them at every link.
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

// Built once at import from the neutral specs. Repeating items become a 'list' field; acts get a higher cap (2000
// articles: a full code of law) than other lists (500).
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
