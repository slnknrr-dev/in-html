// landing-studio/viewer-blocks-portal.js - the portal blocks of the shared library (../portal/) as landing blocks:
// legal act, glossary of terms, directory, requests board, topic hub, checklist, unified search. This module only
// adapts: the registry entries are converted from the neutral models (portal/models.js), the markup comes from
// portal/markup.js through a view adapter over the engine's rendering context (per-language groups, editable fields,
// attachments, page URLs), the CSS chunks and runtime features are the library's. CONTRACT.md §19.
//
//   BT_PT                 registry entries (category 'portal')
//   PT_SHARED_CSS         CSS_SHARED chunks 'pt-<chunk>' (+ the token mapping of the landing theme)
//   PT_BLOCK_DEPS         BLOCK_DEPS of the types
//   UI_PT                 viewer strings (portal/strings.js)
//   ptCatalog(ctx)        the site catalog of a render (cached on ctx)
import { uid } from '../util/id.js';
import { escapeAttr, escapeHTML } from '../html/escape.js';
import { normURL } from '../html/url.js';
import { isObj, own, str } from '../util/value.js';
import { pickText } from '../i18n/text.js';
import { P } from '../doc/product.js';
import { walkBlocks } from '../doc/model.js';
import { uiText } from '../doc/dict.js';
import { attOf, attSrc, imgAttr, isImage } from '../doc/attach.js';
import { addItemBox, di, extAttrs, feature, fld, grp, has, icon, needUi, noItems, plainIn, renderVal, resolveHref, ui } from '../doc/render.js';
import { PT_BLOCKS, PT_TYPES, isText } from '../portal/models.js';
import { PT_RENDER } from '../portal/markup.js';
import { PT_CSS, PT_TYPE_CHUNKS } from '../portal/css.js';
import { PT_UI } from '../portal/strings.js';
import { ptFieldHint, ptFieldLabel, ptOptionLabel } from '../portal/strings-editor.js';
import { buildCatalog } from '../portal/catalog.js';
import { todayNumber } from '../portal/records.js';
import { attCardHTML } from './viewer-render.js';
import { formatDay } from './viewer-blocks-c.js';
//
// Why an adapter (ports and adapters) instead of copying the portal blocks: portal/ is shared by several apps with
// different engines; it renders against an abstract view V (fields, language groups, links, icons) and never imports
// this engine. Each app supplies V once, so a fix in portal/markup.js reaches every app and the library cannot grow a
// dependency on one product's internals.

/* ---------- registry from the neutral models ---------- */

// Neutral field type (f.t) -> this editor's schema control. The mapping is total: unknown types fall back to a
// plain text input, so a new portal field type degrades to editable text instead of breaking the inspector.
function landingField(f) {
  const base = { key: f.key, label: ptFieldLabel(f) };
  const hint = ptFieldHint(f);
  if (hint) base.hint = hint;
  if (f.when) base.when = f.when;
  switch (f.t) {
    case 'text': return { ...base, type: 'i18n' };
    case 'long': return { ...base, type: 'i18n', multiline: true, rows: f.rows || 4 };
    case 'code': return { ...base, type: 'text' };
    case 'link': return { ...base, type: 'text', suggest: 'anchors', placeholder: 'pl.href' };
    case 'day': return { ...base, type: 'day' };
    case 'num': return { ...base, type: 'number', min: f.min, max: f.max, step: f.step || 'any', nullable: f.d === undefined };
    case 'bool': return { ...base, type: 'checkbox' };
    case 'select': return { ...base, type: 'select', options: f.o.map((v) => ({ v, l: ptOptionLabel(f, v) })) };
    case 'image': return { ...base, type: 'att', accept: 'image/' };
    case 'file': return { ...base, type: 'att' };
    default: return { ...base, type: 'text' };
  }
}

// Default value per neutral field: i18n fields start as {} (per-language map), media as null (no attachment).
function landingValue(f) {
  if (isText(f)) return {};
  if (f.d !== undefined) return f.d;
  switch (f.t) {
    case 'num': case 'image': case 'file': return null;
    case 'bool': return false;
    case 'select': return f.o[0];
    default: return '';
  }
}

// Types whose content is a list of items: an empty list shows the editor's 'add item' box instead of empty markup.
const LIST_TYPES = new Set(['act', 'terms', 'directory', 'board', 'checklist']);

function entry(type) {
  const spec = PT_BLOCKS[type];
  const fields = spec.fields;
  const items = spec.item ? spec.item.fields : [];
  const t = {
    category: 'portal', icon: spec.icon, container: false, variants: [],
    i18nFields: fields.filter(isText).map((f) => f.key),
    defaults: () => {
      const o = {};
      for (const f of fields) o[f.key] = landingValue(f);
      if (spec.item) o.items = [];
      return o;
    },
    schema: fields.map(landingField),
    render: (b, ctx) => {
      if (LIST_TYPES.has(type) && noItems(ctx, b)) return addItemBox(ctx);
      return PT_RENDER[type](b, ptView(ctx, b));
    },
  };
  if (spec.item) {
    Object.assign(t, {
      itemI18nFields: items.filter(isText).map((f) => f.key), itemLabel: spec.item.label,
      itemSchema: items.map(landingField),
      itemDefaults: () => {
        const o = { id: uid() };
        for (const f of items) o[f.key] = landingValue(f);
        return o;
      },
    });
  }
  // A hub's tiles and a search box are page structure, not content records of the backend.
  if (type === 'hub' || type === 'finder') t.noSource = true;
  return t;
}

export const BT_PT = Object.fromEntries(PT_TYPES.map((t) => [t, entry(t)]));

/* ---------- CSS ---------- */

// The landing theme on the portal tokens, evaluated on each block root (tones of sections apply).
// Token indirection (--pt-* := var(--lp-*)) on .lp-pt, not :root: custom properties resolve where they are declared,
// so a block inside a dark-toned section picks up that section's --lp-* values. Declared on :root they would freeze
// the page-level colours.
const PT_TOKENS = '.lp-pt{--pt-accent:var(--lp-accent);--pt-on-accent:var(--lp-on-accent);--pt-bg:var(--lp-bg);--pt-surface:var(--lp-surface);'
  + '--pt-text:var(--lp-text);--pt-muted:var(--lp-muted);--pt-border:var(--lp-border);--pt-tint:var(--lp-tint);--pt-radius:var(--lp-radius);'
  + '--pt-font-h:var(--lp-font-h);--pt-shadow:var(--lp-shadow);--pt-top:var(--lp-navh,0px)}\n'
  + '.lp-pt .lp-pt-btn{border-radius:var(--lp-radius)}\n.lp-pt-att{flex:1 1 100%;max-width:640px}\n';

// The library's CSS uses a __P__ class-prefix placeholder; substituting 'lp' puts it in this app's namespace.
export const PT_SHARED_CSS = Object.fromEntries(Object.entries(PT_CSS).map(([k, css]) => ['pt-' + k, (k === 'base' ? PT_TOKENS : '') + css.replace(/__P__/g, 'lp')]));
export const PT_BLOCK_DEPS = Object.fromEntries(PT_TYPES.map((t) => [t, PT_TYPE_CHUNKS[t].map((c) => 'pt-' + c)]));
export const UI_PT = PT_UI;

/* ---------- the site catalog of a render ---------- */

const plainOfValue = (ctx, v, l) => (v == null ? '' : typeof v === 'string' ? v : typeof v === 'number' ? String(v) : plainIn(ctx, v, l));
const rawOfValue = (ctx, v, l) => (v == null ? '' : typeof v === 'string' ? v : typeof v === 'number' ? String(v) : str(pickText(v, l, ctx.pd)));

// The catalog (cross-block index used by unified search, hub tiles and term links) is built once per render and
// memoized on ctx: every portal block on the page asks for it, and rebuilding per block would be O(blocks^2).
// Only blocks that will actually be emitted (ctx.blockIds) enter it, so search never points at hidden content.
export function ptCatalog(ctx) {
  if (ctx.ptCat) return ctx.ptCat;
  const sources = [];
  walkBlocks(ctx.doc, (b) => {
    if (!isObj(b) || !own(BT_PT, b.type)) return;
    if (!ctx.edit && !ctx.blockIds.has(b.id)) return; // hidden, other language only, draft page
    const pg = ctx.pageOf ? ctx.pageOf.get(b.id) : null;
    sources.push({
      block: b, page: pg ? pg.id : '',
      href: (a) => {
        const h = !ctx.edit && P.placeHref ? P.placeHref(ctx, '#' + a, b.id) : '#' + a;
        return typeof h === 'string' && h ? h : '#' + a;
      },
    });
  });
  const langs = ctx.edit ? [ctx.lang] : ctx.langs;
  ctx.ptCat = buildCatalog(sources, {
    langs, lang: ctx.edit ? ctx.lang : ctx.defaultLang,
    plain: (v, l) => plainOfValue(ctx, v, l), raw: (v, l) => rawOfValue(ctx, v, l),
    unitLabel: (k, n, l) => uiText('pt.u.' + k, l, ctx.doc, { n }),
  });
  return ctx.ptCat;
}

/* ---------- the view adapter ---------- */

const ICON_MAP = { external: 'open', link: 'link', search: 'search', print: 'print', clock: 'clock', pin: 'pin', globe: 'globe', check: 'check' };
// Block-level tags in a value force block-level language wrappers (div instead of span) in grp(): a <p> inside a
// <span> is invalid HTML and the parser would split the wrapper.
const BLOCKISH = /<(?:p|div|ol|ul|li|section|article|dl|h[1-6]|table|nav|details|header|aside|form)\b/i;

// Long text: blank-line separated paragraphs, each rendered as plain text (escaped, inline links only).
function longHTML(ctx, v, l) {
  const s = rawOfValue(ctx, v, l).replace(/\r\n?/g, '\n').trim();
  if (!s) return '';
  return s.split(/\n\s*\n/).map((p) => `<p>${renderVal(ctx, p.trim(), 'plain')}</p>`).join('');
}

function ptView(ctx, b) {
  const langs = ctx.edit ? [ctx.lang] : ctx.langs;
  const lang = ctx.edit ? ctx.lang : ctx.defaultLang;
  const pg = ctx.pageOf ? ctx.pageOf.get(b.id) : null;
  const get = (path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), b);
  // per(fn): render once per language; a single language skips the wrappers entirely.
  const per = (fn) => {
    if (langs.length === 1) return fn(langs[0]);
    const vals = langs.map((l) => fn(l));
    return grp(ctx, (l) => vals[langs.indexOf(l)], vals.some((v) => BLOCKISH.test(v)));
  };
  const V = {
    // today is taken at render time: date-relative states (deadlines, 'expired') are frozen into the export and
    // refreshed by the runtime where the library provides one.
    p: 'lp', edit: ctx.edit, langs, lang, page: pg ? pg.id : '', today: todayNumber(),
    // Lazy getter: blocks that never consult the catalog do not trigger the document walk.
    get cat() { return ptCatalog(ctx); },
    f: (path, kind, tag, cls) => {
      const v = get(path);
      if (ctx.edit) {
        if (kind === 'long') return `<${tag || 'div'}${cls ? ` class="${cls}"` : ''}>${longHTML(ctx, v, ctx.lang)}</${tag || 'div'}>`;
        return fld(ctx, b, path, 'plain', tag || 'span', cls, /title|name|term|label/.test(path) ? 'pt.ph.title' : 'pt.ph.text');
      }
      const html = kind === 'long' ? per((l) => longHTML(ctx, v, l)) : per((l) => renderVal(ctx, rawOfValue(ctx, v, l), 'plain'));
      if (!html) return '';
      return tag ? `<${tag}${cls ? ` class="${cls}"` : ''}>${html}</${tag}>` : html;
    },
    has: (v) => (v == null ? false : typeof v === 'string' ? !!v.trim() : typeof v === 'number' ? true : has(ctx, v)),
    plain: (v, l) => plainOfValue(ctx, v, l),
    raw: (v, l) => rawOfValue(ctx, v, l),
    lineIn: (v, l) => renderVal(ctx, rawOfValue(ctx, v, l), 'plain'),
    longIn: (v, l) => longHTML(ctx, v, l),
    inline: (s) => escapeHTML(s),
    per,
    t: (key, vars) => ui(ctx, key, vars),
    tl: (key, l, vars) => uiText(key, l, ctx.doc, vars),
    attr: (name, fn) => {
      const first = str(fn(lang));
      let s = ` ${name}="${escapeAttr(first)}"`;
      if (ctx.edit || langs.length < 2) return s;
      const m = {};
      let diff = false;
      for (const l of langs) { m[l] = str(fn(l)); if (m[l] !== first) diff = true; }
      if (diff) s += ` data-lp-i18n="${escapeAttr(JSON.stringify({ [name]: m }))}"`;
      return s;
    },
    link: (v) => {
      const raw = rawOfValue(ctx, v, lang).trim();
      if (!raw) return null;
      const href = resolveHref(ctx, normURL(raw, P.anchors));
      return href ? { href, ext: /^https?:/i.test(href), title: '' } : null;
    },
    a: (href, cls, extra = '') => `<a${cls ? ` class="${cls}"` : ''} href="${escapeAttr(href)}"${ctx.edit ? '' : extAttrs(href)}${extra}>`,
    img: (id, o = {}) => {
      const a = attOf(ctx, id);
      const src = a && isImage(a) ? attSrc(ctx, a) : '';
      return src ? `<img${o.cls ? ` class="${o.cls}"` : ''} src="${escapeAttr(src)}" alt="${escapeAttr(o.alt || '')}"${imgAttr(ctx, a)} loading="lazy" decoding="async">` : '';
    },
    // Raw file URLs are not exposed to the library; attachments go through fileCard (download/open UI of this engine).
    file: () => null,
    fileCard: (id) => {
      const a = attOf(ctx, id);
      return a ? `<div class="lp-att lp-pt-att">${attCardHTML(ctx, a, { dl: true, op: true })}</div>` : '';
    },
    date: (d, l) => formatDay(d, l, ctx.doc),
    icon: (n) => icon(ctx, ICON_MAP[n] || n, 'lp-pt-ic'),
    href: (a) => '#' + a,
    feature: (f) => feature(ctx, f),
    need: (...keys) => needUi(ctx, ...keys),
    di: (i) => di(ctx, i),
  };
  return V;
}
