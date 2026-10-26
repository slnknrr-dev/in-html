// doc/render.js - rendering core: view and edit markup, per-language groups, fields, links, block wrappers, usage.
//
// Renderers return HTML strings; '' in view mode means "not rendered" (no wrapper, no CSS, no runtime). One render
// fills ctx.use (types, variants, features, icons, attachments, links, UI keys ...) so that the exporter ships only
// what the document uses. Class names carry the product prefix (P.prefix). Product hooks: P.renderRoot (page
// skeleton), P.blockStyle / P.blockClasses / P.blockConditional / P.wrapInner (block wrapper), P.planDoc /
// P.planBlock (link-target pre-pass), P.hrefTarget (special in-page targets), P.makeCtx, P.finishUsage.
//
// Key decisions:
// - Strings, not DOM: the same code runs in the editor, in workers and in Node (export, tests). Price: every
//   interpolation must be escaped by hand; the rule is escapeHTML for text, escapeAttr for attribute values,
//   sanitizeRich for user HTML, safeURL/normURL for hrefs. No exception.
// - All languages in one page: a value that differs per language is rendered once per distinct value and wrapped in
//   data-l groups that CSS toggles (css.js langCSS). Identical values collapse to one copy, so a monolingual field in
//   a multilingual page costs nothing.
// - Plan before render: links can point forward (to blocks not rendered yet), so a pre-pass (plan) collects every
//   target first; dead links become plain text instead of broken anchors.
import { isB64 } from '../codec/base64.js';
import { langDir, langName, primary } from '../i18n/lang.js';
import { htmlToText, isEmptyText, pickFrom, pickText } from '../i18n/text.js';
import { decodeEnt, escapeAttr, escapeHTML } from '../html/escape.js';
import { ANCHOR_HREF, LANG_HREF, ROUTE_HREF, XREF, normURL, safeURL } from '../html/url.js';
import { sanitizeRich } from '../html/sanitize.js';
import { getPath, isObj, own, str } from '../util/value.js';
import { BLOCK_TYPES, ICONS, P } from './product.js';
import { uiLookup, uiText } from './dict.js';
import { eachChildList, ensureDoc } from './model.js';
import { hasData, isImage } from './attach.js';

export const langIn = (l, list) => list.includes(l) || list.includes(primary(l));

// Exported language matching a #lang=<code> link (exact, case-insensitive, then by primary subtag), or ''.
export function matchLang(langs, code) {
  const c = String(code || '').toLowerCase();
  return langs.find((l) => l.toLowerCase() === c) || langs.find((l) => primary(l) === primary(c)) || '';
}

// Usage accumulator of one render.
export function newUsage(langs) {
  return {
    types: new Set(), variants: new Set(), features: new Set(), icons: new Set(), langs: [...langs], atts: new Set(),
    xrefs: new Set(), imgInline: new Set(), imgInlineCount: new Map(), blob: new Set(), store: [], fonts: new Set(),
    uiKeys: new Set(), reqs: new Set(),
    shop: false,    // something purchasable was rendered
    tools: null,    // page tools rendered inside the document (not in the floating toolbar)
    toolbar: null,  // what the floating toolbar has to carry (finishUsage)
    zoom: false,    // a zoomable (lightbox) image was rendered
    reveal: false, split: false, defaultLang: '',
  };
}

// Edit renders exactly one language (the one being typed); view renders all exported languages at once.
// pd = doc as seen with the chosen default language, so pickText fallbacks follow the export, not the source file.
export function makeCtx(doc, opts = {}) {
  const edit = opts.mode === 'edit';
  let langs;
  if (edit) {
    langs = [typeof opts.lang === 'string' && opts.lang ? opts.lang : doc.defaultLang];
  } else {
    const src = Array.isArray(opts.langs) && opts.langs.length ? opts.langs : doc.langs;
    langs = [...new Set(src.filter((l) => typeof l === 'string' && l))];
    if (!langs.length) langs = [doc.defaultLang];
  }
  const defaultLang = edit ? langs[0]
    : langs.includes(opts.defaultLang) ? opts.defaultLang
      : langs.includes(doc.defaultLang) ? doc.defaultLang : langs[0];
  const pd = edit || doc.defaultLang === defaultLang ? doc : { ...doc, defaultLang };
  const ctx = {
    doc, pd, edit, langs, defaultLang, rtl: !edit && langs.some((l) => langDir(l) === 'rtl'),
    lang: edit ? langs[0] : defaultLang,
    uiLang: (edit && opts.uiLang) || langs[0],
    attURL: typeof opts.attURL === 'function' ? opts.attURL : null,
    // View exports that keep attachments as files next to the page (archives): (attachment) -> relative URL | ''.
    assetURL: !edit && typeof opts.assetURL === 'function' ? opts.assetURL : null,
    p: P.prefix,
    use: newUsage(langs),
    // blockIds: link targets (planned blocks); rendered: block wrappers actually emitted (renderB);
    // anchors: slug -> block id; anchorOf: block id -> slug; attAnchor: attachment id -> element carrying id="att-<id>".
    blockIds: new Set(), rendered: new Set(), anchors: new Map(), anchorOf: new Map(), attAnchor: new Map(),
    // prev: { rendered, shop } of the first view pass (two-pass products); shopGuess: pre-pass guess.
    prev: null, shopGuess: false,
    // Render position: list depth (0 = top level of a region), region key; image dedup state.
    depth: -1, region: '',
    curBlock: null, curType: '', curUncond: true, imgFirst: new Map(),
  };
  if (P.makeCtx) P.makeCtx(ctx, opts);
  return ctx;
}

// Per-language values; identical values share one rendering. srcOf(l) = language the value for l is written in
// (fallbacks); a group whose values share one source language gets lang="..." (hyphenation, fonts).
// Map keyed by the rendered string = dedup of identical outputs; insertion order keeps the language order stable.
// Empty values emit no group at all: CSS hides groups of other languages, so a missing variant shows nothing.
export function grp(ctx, fn, block, srcOf) {
  const ls = ctx.langs;
  if (ls.length === 1) return fn(ls[0]);
  const m = new Map();
  for (const l of ls) {
    const v = fn(l);
    const a = m.get(v);
    if (a) a.push(l); else m.set(v, [l]);
  }
  if (m.size === 1) return m.keys().next().value;
  ctx.use.split = true;
  const tag = block ? 'div' : 'span';
  let s = '';
  for (const [v, a] of m) {
    if (!v) continue;
    const src = new Set(a.map((l) => (srcOf ? srcOf(l) : l)));
    const la = src.size === 1 ? [...src][0] : '';
    // Documents with a right-to-left language: each variant carries its own direction (fallback text in another script).
    const dir = ctx.rtl ? ` dir="${la ? langDir(la) : 'auto'}"` : '';
    s += `<${tag} data-l="${escapeAttr(a.join(' '))}"${la ? ` lang="${escapeAttr(la)}"` : ''}${dir}>${v}</${tag}>`;
  }
  return s;
}

export function has(ctx, i18n) {
  return ctx.langs.some((l) => !!pickText(i18n, l, ctx.pd));
}

export function plainOf(ctx, i18n) {
  return htmlToText(pickText(i18n, ctx.lang, ctx.pd));
}

export function plainIn(ctx, i18n, l) {
  return htmlToText(pickText(i18n, l, ctx.pd));
}

// ` alt="..."` for the default output language; when the text differs per output language the element also gets
// data-alt='{"lang":"..."}' which the i18n runtime applies on a language switch. fn(lang) -> plain alt text.
export function altAttr(ctx, fn) {
  const own0 = str(fn(ctx.lang));
  let s = ` alt="${escapeAttr(own0)}"`;
  if (ctx.edit || ctx.langs.length < 2) return s;
  const m = {};
  let diff = false;
  for (const l of ctx.langs) { m[l] = str(fn(l)); if (m[l] !== own0) diff = true; }
  if (diff) s += ` data-alt="${escapeAttr(JSON.stringify(m))}"`;
  return s;
}

// noopener: the opened page gets no window.opener (reverse tabnabbing); noreferrer: no Referer leak of a local file
// path or private URL.
export const extAttrs = (href) => (/^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : '');

// Validates an href for view output -> url | '' (not allowed) | null (in-page target that does not exist).
// #b-<id> of a block that has an anchor becomes #<anchor>. In-page targets are recorded in use.xrefs (feature links).
// Multi-page products: P.placeHref(ctx, href, blockId) may move an in-page target to the URL of the page that holds the
// block, and P.routeHref(ctx, path, anchor) maps '#/<path>[#<anchor>]' page routes (null = no such page); results that
// are not '#…' fragments are not in-page targets.
// Three-valued result is load-bearing: '' drops the link but keeps its text; null additionally means "target missing"
// and links() renders a <span> so the text stays but is not clickable.
export function resolveHref(ctx, raw) {
  const u = safeURL(raw, P.anchors);
  if (!u || u[0] !== '#' || ctx.edit) return u;
  const done = (href) => {
    if (href && href[0] === '#') ctx.use.xrefs.add(href);
    return href;
  };
  const place = (href, bid) => done(P.placeHref ? P.placeHref(ctx, href, bid) : href);
  let x = XREF.exec(u);
  if (x) {
    const id = x[2];
    if (x[1].toLowerCase() === 'att') {
      if (!ctx.attAnchor.has(id)) return null;
      return place(u, ctx.attAnchor.get(id));
    }
    if (!ctx.blockIds.has(id)) return null;
    const a = ctx.anchorOf.get(id);
    return place(a ? '#' + a : u, id);
  }
  x = LANG_HREF.exec(u);
  if (x) {
    const l = ctx.langs.length > 1 ? matchLang(ctx.langs, x[1]) : '';
    return l ? '#lang=' + l : null;
  }
  x = ROUTE_HREF.exec(u);
  if (x) return P.routeHref ? done(P.routeHref(ctx, x[1] || '', x[2] || '')) : '';
  x = ANCHOR_HREF.exec(u);
  if (!x) return '';
  const slug = x[1];
  const special = slug === 'top' ? true : P.hrefTarget ? P.hrefTarget(ctx, slug) : undefined;
  if (special === false || (special === undefined && !ctx.anchors.has(slug))) return null;
  return special === undefined ? place(u, ctx.anchors.get(slug)) : done(u);
}

// Quote-aware: a '>' inside a quoted attribute value (href="...?a>b") does not end the tag.
const A_RE = /<a\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/a\s*>/gi;
// View-mode link post-processing: target/rel for external links, <p>-xref for in-page targets.
// Runs on sanitized HTML, so the regex only meets well-formed <a> tags the sanitizer emitted; it is not a general
// HTML parser and must not be used on raw input. Entities in href are decoded before validation so "&#106;avascript:"
// cannot bypass safeURL.
export function links(ctx, html) {
  if (ctx.edit || html.indexOf('<a') < 0) return html;
  return html.replace(A_RE, (m, attrs, inner) => {
    const hm = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    const raw = hm ? decodeEnt(hm[1] ?? hm[2] ?? hm[3] ?? '').trim() : '';
    const href = resolveHref(ctx, raw);
    if (href === null) return `<span>${inner}</span>`;
    if (!href) return inner;
    if (href.startsWith('#lang=')) return `<a href="${escapeAttr(href)}">${inner}</a>`; // handled by the i18n runtime
    if (href[0] === '#') return `<a href="${escapeAttr(href)}" class="${ctx.p}-xref">${inner}</a>`;
    return `<a href="${escapeAttr(href)}"${extAttrs(href)}>${inner}</a>`;
  });
}

// ` href="..."` for a user-typed link (normalized, allowlisted, existing in-page target), with target/rel for external
// links in view mode; '' when not allowed or the target does not exist.
export function hrefAttr(ctx, raw) {
  const u = resolveHref(ctx, normURL(raw, P.anchors));
  if (!u) return '';
  return ` href="${escapeAttr(u)}"` + (u[0] === '#' || ctx.edit ? '' : extAttrs(u));
}

export const richOpts = () => ({ indent: P.prefix + '-i', anchors: !!P.anchors });

export function renderVal(ctx, v, kind) {
  if (!v) return '';
  if (kind === 'plain') return escapeHTML(v).replace(/\r?\n/g, '<br>');
  return links(ctx, sanitizeRich(v, kind, richOpts()));
}

export function txt(ctx, i18n, kind = 'plain') {
  return grp(ctx, (l) => renderVal(ctx, pickText(i18n, l, ctx.pd), kind), kind === 'rich', (l) => pickFrom(i18n, l, ctx.pd)[1]);
}

export function ui(ctx, key, vars) {
  return grp(ctx, (l) => escapeHTML(uiText(key, l, ctx.doc, vars)), false, (l) => uiLookup(key, l, ctx.doc)[1]);
}

export function icon(ctx, name, cls) {
  const d = own(ICONS, name);
  if (typeof d !== 'string' || !d) return '';
  ctx.use.icons.add(name);
  return `<svg class="${ctx.p}-ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
}

// Escaped display text of an e-mail / URL / handle / file name with line-break opportunities (<wbr>) after '@' and
// before '.' and '/' (never at the very start, never between repeated separators). Display only, never in href.
// <wbr> rather than overflow-wrap:anywhere: breaks only at meaningful separators, and copy-paste is unaffected.
export function breakable(s) {
  return escapeHTML(s).replace(/@(?=.)/g, '@<wbr>').replace(/(.)([./])(?=[^./])/g, '$1<wbr>$2');
}

export const di = (ctx, i) => (ctx.edit ? ` data-item="${i}"` : '');
// Edit mode: a list block without items shows a clickable box (the editor adds the first item on click), returned
// instead of the list wrapper so it never ends up inside <ul>/<table>.
export const noItems = (ctx, b) => ctx.edit && !(Array.isArray(b.items) && b.items.length);
export const addItemBox = (ctx) => `<div class="${ctx.p}-empty ${ctx.p}-add-item" data-add-item>${escapeHTML(uiText('edit.addItem', ctx.uiLang, ctx.doc))}</div>`;

// Edit-mode contenteditable field: data-f = path relative to the block, data-kind = plain | inline | rich.
// When the current language is empty, the fallback text is shown as a placeholder (data-ph, rendered by CSS ::before),
// never as content: typing must start a new translation, not edit the other language's text.
export function editField(ctx, i18n, path, kind, tag, cls, phKey, o = {}) {
  const cur = isObj(i18n) && typeof own(i18n, ctx.lang) === 'string' ? i18n[ctx.lang] : '';
  let ph = o.ph != null ? o.ph : phKey ? uiText(phKey, ctx.uiLang, ctx.doc) : '';
  // Accessible name: the field's label (data-ph turns into fallback text for a missing translation, so it is not used).
  const label = phKey ? uiText(phKey, ctx.uiLang, ctx.doc) : String(ph || '');
  // Table cells keep their cell role; every other field is announced as a (multi-line for rich) text box.
  const cell = tag === 'td' || tag === 'th';
  const aria = (cell ? '' : ` role="textbox"${kind === 'rich' ? ' aria-multiline="true"' : ''}`)
    + (label ? ` aria-label="${escapeAttr(label)}"` : '');
  let c = ctx.p + '-f' + (cls ? ' ' + cls : '') + (o.ecls ? ' ' + o.ecls : '');
  let content = '';
  let title = '';
  if (!isEmptyText(cur)) content = kind === 'plain' ? escapeHTML(cur) : sanitizeRich(cur, kind, richOpts());
  else {
    const [fb, from] = pickFrom(i18n, ctx.lang, ctx.doc);
    if (fb && from !== ctx.lang) {
      c += ` ${ctx.p}-missing`;
      ph = htmlToText(fb).slice(0, 120);
      title = uiText('edit.missing', ctx.uiLang, ctx.doc, { lang: langName(from) });
    }
  }
  return `<${tag} class="${c}" data-f="${escapeAttr(path)}" data-kind="${kind}" contenteditable="true" spellcheck="true"`
    + ` lang="${escapeAttr(ctx.lang)}" data-ph="${escapeAttr(ph)}"${title ? ` title="${escapeAttr(title)}"` : ''}${aria}`
    + `${o.attrs || ''}>${content}</${tag}>`;
}

// Text field: edit -> contenteditable element; view -> grouped value ('' when empty unless o.keep).
// o = { keep, href (validated url), ph, ecls, attrs }.
export function fld(ctx, b, path, kind, tag, cls, phKey, o = {}) {
  const i18n = getPath(b, path);
  if (ctx.edit) return editField(ctx, i18n, path, kind, tag, cls, phKey, o);
  const html = txt(ctx, i18n, kind);
  if (!html && !o.keep) return '';
  const inner = o.href && html ? `<a href="${escapeAttr(o.href)}"${extAttrs(o.href)}>${html}</a>` : html;
  return `<${tag}${cls ? ` class="${cls}"` : ''}>${inner}</${tag}>`;
}

// Records a runtime feature (view mode only; the product's finishUsage adds dependencies).
export function feature(ctx, name) {
  if (!ctx.edit && typeof name === 'string' && name) ctx.use.features.add(name);
}

// Runtime UI keys that must reach the exported config (per exported language).
export function needUi(ctx, ...keys) {
  if (ctx.edit) return;
  for (const k of keys) if (typeof k === 'string' && k) ctx.use.uiKeys.add(k);
}

/* ---------- wrappers, lists, regions ---------- */

export function blockVisible(ctx, b) {
  if (b.hidden) return false;
  return !(Array.isArray(b.langs) && b.langs.length) || ctx.langs.some((l) => langIn(l, b.langs));
}

// View mode: a container without any visible block (nested containers flagged dropEmpty count when empty).
export function containerEmpty(ctx, b) {
  let any = false;
  eachChildList(b, (list) => {
    if (any) return;
    any = list.some((x) => {
      const t = isObj(x) ? own(BLOCK_TYPES, x.type) : null;
      return !!t && blockVisible(ctx, x) && !(t.dropEmpty && containerEmpty(ctx, x));
    });
  });
  return !any;
}

// Pre-pass: which blocks / anchors / attachment targets exist (view: visible ones; with a first pass: those it
// rendered). The first block of P.attAnchorTypes showing an attachment carries its #att-<id> target (an image block
// only when it has image data), unless P.planDoc placed it elsewhere.
// Uses the same visibility rules as renderB (blockVisible, dropEmpty); if the two drifted, links would point at blocks
// that never render. With a first pass (prev), the rendered set is the ground truth, which removes that risk.
export function plan(ctx, prev) {
  const atts = ctx.doc.attachments || {};
  const first = new Map();
  const visit = (list) => {
    for (const b of Array.isArray(list) ? list : []) {
      const t = isObj(b) ? own(BLOCK_TYPES, b.type) : null;
      if (!t) continue;
      if (!ctx.edit && !blockVisible(ctx, b)) continue;
      if (prev && !prev.rendered.has(b.id)) continue;
      if (!ctx.edit && t.dropEmpty && containerEmpty(ctx, b)) continue;
      ctx.blockIds.add(b.id);
      if (typeof b.anchor === 'string' && b.anchor && ANCHOR_HREF.test('#' + b.anchor)) {
        if (!ctx.anchors.has(b.anchor)) ctx.anchors.set(b.anchor, b.id);
        ctx.anchorOf.set(b.id, b.anchor);
      }
      const a = P.attAnchorTypes.includes(b.type) && typeof b.att === 'string' ? own(atts, b.att) : null;
      if (isObj(a) && (b.type !== 'image' || (isImage(a) && hasData(ctx, a))) && !first.has(a.id)) first.set(a.id, b.id);
      if (P.planBlock) P.planBlock(ctx, b);
      eachChildList(b, visit);
    }
  };
  for (const k of P.regions) visit(ctx.doc.regions[k]);
  if (P.planDoc) P.planDoc(ctx);
  for (const [id, bid] of first) if (!ctx.attAnchor.has(id)) ctx.attAnchor.set(id, bid);
  if (prev) ctx.shopGuess = !!prev.shop;
}

// Block wrapper: <div class="<p>-b <p>-b-<type>[ product classes]" id="<anchor | b-id>" [data-bid] [data-l] [style]>.
// curBlock / curType / curUncond are saved and restored around render (a manual stack) because renderers recurse
// through renderList. curUncond = "this output is shown in every language and condition": only then may an image
// count as the first visible copy for the dedup in attach.js.
export function renderB(ctx, b) {
  if (!isObj(b)) return '';
  const t = own(BLOCK_TYPES, b.type);
  if (!t || typeof t.render !== 'function') return '';
  const p = ctx.p;
  let cls = `${p}-b ${p}-b-` + b.type;
  let dl = '';
  const restricted = Array.isArray(b.langs) && b.langs.length > 0;
  if (!ctx.edit) {
    if (b.hidden) return '';
    if (restricted) {
      const inter = ctx.langs.filter((l) => langIn(l, b.langs));
      if (!inter.length) return '';
      if (inter.length < ctx.langs.length) dl = inter.join(' ');
    }
  } else {
    if (b.hidden) cls += ` ${p}-hidden`;
    if (restricted && !langIn(ctx.lang, b.langs)) cls += ` ${p}-langhidden`;
  }
  if (P.blockClasses) cls = P.blockClasses(ctx, b, t, cls);
  const st = P.blockStyle ? P.blockStyle(b) : { css: '', cls: '' };
  if (st.cls) cls += ' ' + st.cls;
  let inner = '';
  const prev = [ctx.curBlock, ctx.curType, ctx.curUncond];
  ctx.curBlock = b.id;
  ctx.curType = b.type;
  ctx.curUncond = prev[2] && !dl && !(P.blockConditional && P.blockConditional(b));
  try {
    inner = t.render(b, ctx);
  } catch (e) {
    inner = '';
    // A broken renderer makes its block vanish; say so while editing.
    if (ctx.edit && typeof console !== 'undefined') console.error(`${p}: render failed for ${b.type} block ${b.id}`, e);
  }
  [ctx.curBlock, ctx.curType, ctx.curUncond] = prev;
  if (typeof inner !== 'string') inner = '';
  if (!ctx.edit && !inner && !t.keepEmpty) return '';
  if (P.wrapInner) inner = P.wrapInner(ctx, b, t, inner);
  ctx.use.types.add(b.type);
  for (const v of Array.isArray(t.variants) ? t.variants : []) {
    if (typeof v === 'string' && v && v !== 'style') ctx.use.variants.add(b.type + ':' + v + '=' + String(b[v]));
  }
  ctx.rendered.add(b.id);
  if (dl) ctx.use.split = true;
  const id = typeof b.anchor === 'string' && b.anchor && ANCHOR_HREF.test('#' + b.anchor) ? b.anchor : 'b-' + b.id;
  const bid = escapeAttr(b.id);
  return `<div class="${cls}" id="${escapeAttr(id)}"${ctx.edit ? ` data-bid="${bid}"` : ''}${dl ? ` data-l="${escapeAttr(dl)}"` : ''}`
    + `${st.css ? ` style="${escapeAttr(st.css)}"` : ''}>${inner}</div>`;
}

// Block list in <tag class>; edit mode adds data-list=<path> and a drop zone when empty; view mode omits an empty
// list when omitEmpty. Nested lists (container blocks) get depth + 1. attrs: extra attribute markup.
// Caller contract: style and attrs are inserted verbatim (not escaped); pass only engine-built strings, never user data.
// try/finally keeps ctx.depth balanced even if a renderer throws past renderB's own catch.
export function renderList(ctx, list, path, tag, cls, style, omitEmpty, attrs = '') {
  let s = '';
  ctx.depth++;
  try {
    for (const b of Array.isArray(list) ? list : []) s += renderB(ctx, b);
  } finally {
    ctx.depth--;
  }
  if (!s) {
    if (ctx.edit) s = `<div class="${ctx.p}-empty" data-empty>${escapeHTML(uiText('edit.dropHere', ctx.uiLang, ctx.doc))}</div>`;
    else if (omitEmpty) return '';
  }
  return `<${tag} class="${cls}"${ctx.edit ? ` data-list="${escapeAttr(path)}"` : ''}${style ? ` style="${style}"` : ''}${attrs}>${s}</${tag}>`;
}

// Renders one region's list at depth 0 (regions are the page's top level).
export function renderRegion(ctx, key, tag, cls, omitEmpty, attrs = '') {
  ctx.region = key;
  ctx.depth = -1;
  const s = renderList(ctx, ctx.doc.regions[key], 'regions.' + key, tag, cls, '', omitEmpty, attrs);
  ctx.region = '';
  return s;
}

// Safety net after rendering: in-page links (exact markup of links()) whose target rendered nothing become plain spans
// (and leave use.xrefs, which can turn the links feature off).
function xrefAlive(ctx, href) {
  let x = XREF.exec(href);
  if (x) return x[1].toLowerCase() === 'att' ? ctx.rendered.has(ctx.attAnchor.get(x[2]) || '') : ctx.rendered.has(x[2]);
  x = ANCHOR_HREF.exec(href);
  if (!x || x[1] === 'top') return true;
  const special = P.hrefTarget ? P.hrefTarget(ctx, x[1], true) : undefined;
  if (special !== undefined) return special;
  return ctx.rendered.has(ctx.anchors.get(x[1]) || '');
}

// Matches the exact markup links() produces (attribute order and quoting), which is why it can be a simple regex.
export function dropDeadXrefs(ctx, html) {
  const mark = `class="${ctx.p}-xref"`;
  if (ctx.edit || html.indexOf(mark) < 0) return html;
  const re = new RegExp(`<a href="(#[^"]*)" ${mark}>([\\s\\S]*?)<\\/a>`, 'g');
  return html.replace(re, (m, href, inner) => {
    if (xrefAlive(ctx, href)) return m;
    ctx.use.xrefs.delete(href);
    return `<span>${inner}</span>`;
  });
}

// Pass 1 of a two-pass view render: which blocks render something and whether the page sells anything.
// Why two passes for some products: whether a block renders can depend on later content (e.g. a cart shown only when
// something purchasable exists). The first pass discovers that; the second renders with exact link targets.
// Cost: double render time, only for products that set P.twoPass.
function firstPass(doc, opts) {
  const c = makeCtx(doc, opts);
  plan(c, null);
  P.renderRoot(c);
  return { rendered: c.rendered, shop: !!c.use.shop };
}

export function renderInternal(doc, opts = {}) {
  const d = ensureDoc(doc);
  const ctx = makeCtx(d, opts);
  if (!ctx.edit && P.twoPass) ctx.prev = firstPass(d, opts);
  plan(ctx, ctx.prev);
  return { html: dropDeadXrefs(ctx, P.renderRoot(ctx)), ctx };
}

export function renderDoc(doc, opts = {}) {
  return renderInternal(doc, opts).html;
}

// Region and list depth of a block inside the document (defaults for a block that is not in it yet). The children of a
// `transparent` container (a page) are at the container's own depth.
function blockPos(doc, id) {
  let pos = null;
  const walk = (list, depth, region) => {
    for (const b of Array.isArray(list) ? list : []) {
      if (pos) return;
      if (!isObj(b)) continue;
      if (b.id === id) { pos = { depth, region }; return; }
      const t = own(BLOCK_TYPES, b.type);
      eachChildList(b, (l) => walk(l, depth + (t && t.transparent ? 0 : 1), region));
    }
  };
  for (const k of P.regions) if (!pos) walk(doc.regions[k], 0, k);
  return pos || { depth: 0, region: P.regions[1] || P.regions[0] || '' };
}

// One block wrapper, identical to its fragment inside renderDoc() with the same options (the editor swaps the
// element; the result's first element is the block root).
// Runs the full plan so links inside the block resolve exactly as in renderDoc; the editor relies on byte-identical
// output to swap one element without re-rendering the page.
export function renderBlock(block, doc, opts = {}) {
  const d = ensureDoc(doc);
  const ctx = makeCtx(d, opts);
  if (!ctx.edit && P.twoPass) ctx.prev = firstPass(d, opts);
  plan(ctx, ctx.prev);
  const pos = blockPos(d, isObj(block) ? block.id : '');
  ctx.depth = pos.depth;
  ctx.region = pos.region;
  return renderB(ctx, block);
}

// Completes ctx.use after a view render: product features first, then the attachment store (non-inline data used by
// buttons / previews), asset fonts and languages.
export function finishUsage(ctx) {
  const d = ctx.doc;
  const u = ctx.use;
  if (P.finishUsage) P.finishUsage(ctx, u);
  u.store = [...u.blob].filter((id) => !u.imgInline.has(id) && isObj(own(d.attachments, id)) && isB64(d.attachments[id].data));
  for (const k of [d.theme && d.theme.fontBody, d.theme && d.theme.fontHead]) if (/^asset:/.test(k || '')) u.fonts.add(k.slice(6));
  u.langs = [...ctx.langs];
  u.defaultLang = ctx.defaultLang;
  return u;
}

// Usage of a view render: types, variants, features, icons, langs, atts, xrefs, inline images (+ store, toolbar, fonts).
export function collectUsage(doc, opts = {}) {
  const { ctx } = renderInternal(doc, { ...opts, mode: 'view' });
  return finishUsage(ctx);
}
