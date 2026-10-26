// site-studio/viewer-blocks-wiki.js - the knowledge base blocks inside site documents (format ss-site): every block of
// wiki-blocks.js (text with wiki markup, heading, quotation, verse, callout, details, code, divider, infobox, hatnote,
// table of contents, references, see also, navbox, disambiguation, table, timeline, page list, media, gallery,
// annotated picture, banner, interlinear text, glossary, flash cards) becomes the block type 'wk-<type>' of the site
// product, rendered by the same renderer through an adapter of the render context; plus three site-level pieces:
//   wk-versions  versions of a page's content ("full", "simple"…): a container with one block list per version,
//                buttons switch them (every version is shown one after another without JavaScript)
//   wk-layers    the toggles of the site's layers (doc.wiki.layers: translations, transcription, furigana…); blocks
//                carry `layer` and wiki markup {{layer|id|…}} / {漢字|かんじ} marks inline text
//   wk-secret    a "451" section: its blocks are rendered and encrypted at export (PBKDF2-SHA256 + AES-256-GCM, pure
//                JavaScript from crypto/), the page carries only the envelope and a password form; the reader's browser
//                decrypts with Web Crypto. The password never leaves the project (exports drop the embedded source).
// Block values keep the shapes of wiki-blocks.js; the main list of a block (rows, items, groups…) is the site block's
// `items` so the inspector edits it. Wiki links [[Page]] / [[slug#section|text]] lead to the site's pages (by address,
// title or the address the page had in a knowledge base: doc.wiki.alias); media ids are the site's attachments.
import { escapeAttr, escapeHTML } from '../html/escape.js';
import { isObj, own, str } from '../util/value.js';
import { slugify as routeSlug } from '../spa/route.js';
import { pickText } from '../i18n/text.js';
import { uiText } from '../doc/dict.js';
import { feature, needUi, renderList, resolveHref } from '../doc/render.js';
import { pbkdf2 } from '../crypto/kdf.js';
import { sha256 } from '../crypto/sha2.js';
import { aesGcmEncrypt } from '../crypto/aes.js';
import { randomBytes } from '../crypto/random.js';
import { b64encode } from '../codec/base64.js';
import { BLOCKS as KB } from './wiki-blocks.js';
import { normBlock as kbNormBlock } from './wiki-model.js';
import { htmlToText, plainText, renderBlocks, renderInline } from './wiki-markup.js';
import { readerT } from './wiki-strings-reader.js';
import { READER_CSS } from './wiki-reader-css.js';
import { PORTAL_TYPES } from './wiki-blocks-portal.js';

// Why reuse wiki-blocks.js through an adapter: one renderer for the knowledge base app and for sites, so a wiki page
// moved into a site renders identically. The adapter (c) maps the wiki engine's services (links, media, headings,
// references) onto this engine's ctx; wiki values keep their native shape except the main list, renamed to `items`
// because the inspector edits list blocks through that key (toKB / fromKB convert both ways).
// Portal blocks exist in the site product already (viewer-blocks-portal.js); columns too.
const SKIP = new Set([...PORTAL_TYPES, 'columns']);
const WIKI_TYPES = Object.keys(KB).filter((t) => !SKIP.has(t));
const wkType = (t) => 'wk-' + t;
const kbType = (t) => String(t).slice(3);
const LAYER_RE = /^[a-z][a-z0-9-]{0,31}$/;

// The block list of a type that becomes `items` (the first list field), and the doc schema of the other fields.
const mainList = (t) => Object.entries(KB[t].fields).find(([, f]) => f.k === 'list') || null;

function fieldOf(key, f) {
  const label = 'wf.' + key;
  switch (f.k) {
    case 'text': return { key, type: 'textarea', rows: 6, label, hint: 'wfh.markup' };
    case 'line': case 'plain': return { key, type: 'text', label };
    case 'link': return { key, type: 'text', label, hint: 'wfh.link' };
    case 'layer': return { key, type: 'text', label, hint: 'wfh.layer' };
    case 'select': return { key, type: 'select', label, options: f.o.map((v) => ({ v, l: 'wo.' + v })) };
    case 'bool': return { key, type: 'checkbox', label };
    case 'num': return { key, type: 'number', label, min: f.min, max: f.max, step: 'any', nullable: f.d === null };
    case 'color': return { key, type: 'color', label };
    case 'media': return { key, type: 'att', label };
    case 'day': return { key, type: 'day', label };
    case 'grid': return { key, type: 'wkgrid', label, hint: 'wfh.grid' };
    case 'layers': return { key, type: 'wkcsv', label, hint: 'wfh.layers' };
    case 'tiers': return { key, type: 'wktiers', label, hint: 'wfh.tiers' };
    case 'pts': case 'list': return { key, type: 'wkjson', label };
    default: return null;
  }
}

// Doc defaults of a type: the values of a new wiki block (minus id / type), the main list as `items`.
function defaultsOf(t) {
  const base = kbNormBlock({ type: t, ...(typeof KB[t].defaults === 'function' ? KB[t].defaults() : {}) }) || {};
  const ml = mainList(t);
  const out = {};
  for (const [k, v] of Object.entries(base)) if (k !== 'id' && k !== 'type' && (!ml || k !== ml[0])) out[k] = v;
  out.layer = '';
  return out;
}

// Wiki block of a site block: `items` back under the list's own name, site-only keys dropped.
function toKB(b) {
  const t = kbType(b.type);
  const ml = mainList(t);
  const src = { ...b, type: t };
  if (ml) src[ml[0]] = Array.isArray(b.items) ? b.items : [];
  return kbNormBlock(src) || { type: t };
}

// Site block values of a wiki block (templates, conversions).
function fromKB(kb) {
  const t = kb.type;
  const b = kbNormBlock(kb) || {};
  const ml = mainList(t);
  const out = { type: wkType(t) };
  for (const [k, v] of Object.entries(b)) if (k !== 'type' && (!ml || k !== ml[0])) out[k] = v;
  if (ml) out.items = (b[ml[0]] || []).map((it) => ({ ...it }));
  if (kb.layer) out.layer = kb.layer;
  return out;
}

/* ---------- the render context of wiki blocks ---------- */

// Per render (ctx) and page: headings, references, ids. The page of a block: from the document's pages.
// WeakMap keyed by the render ctx: per-render state (heading ids, footnotes) is garbage-collected with the render, and
// no global counter leaks between renders or documents.
const STATE = new WeakMap();
function stateOf(ctx, b) {
  let S = STATE.get(ctx);
  if (!S) {
    S = { pageOf: new Map(), pages: new Map() };
    const visit = (list, pid) => {
      for (const x of Array.isArray(list) ? list : []) {
        if (!isObj(x)) continue;
        S.pageOf.set(x.id, pid);
        if (Array.isArray(x.blocks)) visit(x.blocks, pid);
        for (const c of Array.isArray(x.cols) ? x.cols : []) visit(c.blocks, pid);
        for (const v of Array.isArray(x.versions) ? x.versions : []) visit(v.blocks, pid);
      }
    };
    for (const p of ctx.doc.regions.main || []) if (isObj(p)) visit(p.blocks, p.id);
    STATE.set(ctx, S);
  }
  const pid = S.pageOf.get(b.id) || '';
  let P = S.pages.get(pid);
  if (!P) { P = { refs: new Map(), ids: new Set(), n: 0 }; S.pages.set(pid, P); }
  return { S, P, pid };
}

// Pages by every name a wiki link may use: address, title (any language), the knowledge base address (alias).
// First registration wins (m.has check): an exact address must not be shadowed by another page's title that happens
// to slugify to the same string. Memoized on ctx, since every wiki link of the render consults it.
function pageIndex(ctx) {
  if (ctx._wkPages) return ctx._wkPages;
  const m = new Map();
  const add = (k, p) => { const s = String(k || '').trim().toLowerCase(); if (s && !m.has(s)) m.set(s, p); };
  const pages = (ctx.doc.regions.main || []).filter((p) => isObj(p) && p.type === 'page' && p.kind !== 'notfound');
  pages.forEach((p, i) => { add(p.slug || (i === 0 ? '' : p.id), p); if (i === 0) add('main', p); });
  for (const p of pages) for (const v of Object.values(isObj(p.title) ? p.title : {})) { add(v, p); add(routeSlug(v), p); }
  const alias = (ctx.doc.wiki && ctx.doc.wiki.alias) || {};
  for (const [k, id] of Object.entries(alias)) { const p = pages.find((x) => x.id === id); if (p) add(k, p); }
  ctx._wkPages = { m, home: pages[0] || null };
  return ctx._wkPages;
}

function adapter(ctx, b) {
  const { P } = stateOf(ctx, b);
  const lang = ctx.lang;
  const t = readerT(String(lang).split('-')[0]);
  const idx = pageIndex(ctx);
  const doc = ctx.doc;
  const pageHref = (p, frag) => {
    const slug = p === idx.home ? '' : p.slug;
    // A section of a wiki page is a heading id of that page, not a block anchor: added to the page's URL here.
    const base = resolveHref(ctx, '#/' + slug) || '#';
    return frag && /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,80}$/u.test(frag) && base !== '#' ? base + '#' + frag : base;
  };
  const link = (target, frag = '') => {
    const tg = String(target || '').trim();
    const f = frag ? routeSlug(frag) : '';
    if (!tg) return { href: f ? '#' + f : '#', cls: 'kp-link', title: frag || '' };
    if (/^media:/i.test(tg)) {
      const m = media(tg.slice(6).trim());
      return m ? { href: m.src, cls: 'kp-link kp-medialink', title: m.name, download: m.name } : { href: '#', cls: 'kp-link kp-new', title: tg.slice(6) };
    }
    const name = tg.split('?')[0];
    const p = idx.m.get(name.toLowerCase()) || idx.m.get(routeSlug(name, { slash: true })) || idx.m.get(name.toLowerCase().replace(/^\/+|\/+$/g, ''));
    if (p) return { href: pageHref(p, f), cls: 'kp-link', title: str(pickText(p.title, lang, doc)) || p.slug, exists: true };
    return { href: '#', cls: 'kp-link kp-new', title: name, hint: t('r.missingPage', { title: name }), exists: false };
  };
  const resolve = (v) => {
    const s = String(v || '').trim();
    if (!s) return null;
    if (/^(https?:\/\/|mailto:|tel:)/i.test(s)) return /[\s<>"]/.test(s) ? null : { href: s, ext: true, title: s.replace(/^https?:\/\//, ''), cls: 'kp-ext' };
    const m = /^\[\[([^\]|]*)(?:\|([^\]]*))?\]\]$/.exec(s);
    const inner = m ? m[1] : s;
    const h = inner.indexOf('#');
    const L = link(h >= 0 ? inner.slice(0, h) : inner, h >= 0 ? inner.slice(h + 1) : '');
    if (m && m[2]) L.title = m[2];
    return L;
  };
  function media(id) {
    const a = own(doc.attachments, id);
    if (!isObj(a)) return null;
    return { src: wkAttSrc(ctx, a), type: str(a.mime) || 'application/octet-stream', name: str(a.name) || id, size: a.size || 0, w: a.w || 0, h: a.h || 0,
      alt: str(pickText(a.title, lang, doc)), credit: str(pickText(a.desc, lang, doc)) };
  }
  const layers = (doc.wiki && doc.wiki.layers) || [];
  const c = {
    t, lang, page: { slug: '' }, rubyLayer: (doc.wiki && doc.wiki.ruby) || '',
    link, resolve, media, href: (r) => (typeof r === 'string' ? r : '#'),
    inline: (s) => renderInline(s, c),
    blocks: (s) => renderBlocks(s, c),
    plainOf: (s) => plainText(s, c),
    useLayer: (id) => { if (!ctx.edit && id) feature(ctx, 'wiki'); },
    layerLabel: (id) => { const l = layers.find((x) => x.id === id); return l ? l.label : id; },
    uid: (p) => `${p}-${b.id}-${++P.n}`,
    // Heading ids: slug of the text, prefixed when it does not start with a letter (ids starting with a digit need
    // escaping in selectors), deduplicated per page with -2, -3. Levels clamped to h2..h4: the page title owns h1.
    heading(text, level, anchor) {
      const html = renderInline(text, c);
      let base = anchor ? routeSlug(anchor) : routeSlug(htmlToText(renderInline(text, { ...c, plain: true })), { fallback: 'section' });
      if (!/^[a-z]/.test(base)) base = 's-' + base;
      let id = base;
      for (let n = 2; P.ids.has(id); n++) id = base + '-' + n;
      P.ids.add(id);
      const lv = Math.min(4, Math.max(2, level || 2));
      return { id, html: `<h${lv} id="${escapeAttr(id)}" class="kp-h">${html}</h${lv}>` };
    },
    // Footnotes per page and group: a named reference reused keeps its number (uses counts the back-links), as in
    // MediaWiki's <ref name>.
    ref(html, name, group) {
      const g = P.refs.get(group) || P.refs.set(group, { list: [], names: new Map() }).get(group);
      let e = name ? g.names.get(name) : null;
      if (e) { if (html && !e.html) e.html = html; e.uses++; } else { e = { n: g.list.length + 1, html, uses: 1 }; g.list.push(e); if (name) g.names.set(name, e); }
      const gk = group ? routeSlug(group) + '-' : '';
      return `<sup class="kp-ref" id="cite-ref-${gk}${e.n}-${e.uses}-${b.id}"><a href="#cite-note-${gk}${e.n}">[${group ? escapeHTML(group) + ' ' : ''}${e.n}]</a></sup>`;
    },
    marker(kind, mb) {
      if (kind === 'toc') {
        if (!ctx.edit) feature(ctx, 'wiki');
        return `<nav class="kp-toc${mb.float === 'right' ? ' kp-toc-right' : ''}" data-wk-toc="${escapeAttr(mb.depth || '3')}" aria-label="${escapeAttr(t('r.contents'))}"><div class="kp-toc-t">${mb.title ? c.inline(mb.title) : escapeHTML(t('r.contents'))}</div><ol></ol></nav>`;
      }
      const g = P.refs.get(mb.group || '') || { list: [] };
      const gk = mb.group ? routeSlug(mb.group) + '-' : '';
      const head = mb.heading !== false ? c.heading(mb.title || t('r.references'), 2).html : '';
      return head + `<ol class="kp-refs${mb.cols === '2' ? ' kp-refs-2' : ''}">${g.list.map((e) => `<li id="cite-note-${gk}${e.n}">${e.html || ''}</li>`).join('')}</ol>`;
    },
    renderList: () => '',
    pageList: (pl) => pageListHTML(ctx, pl, idx, pageHref, c, b),
  };
  return c;
}

// Attachments of wiki blocks: the attachment's URL in this render (data URL, file of an archive, or the editor's).
// Recording ctx.use.atts / imgInline is what makes the exporter ship the attachment; a URL without that bookkeeping
// would work in the editor and break in the export.
function wkAttSrc(ctx, a) {
  if (ctx.edit && ctx.attURL) { const u = ctx.attURL(a.id); if (u) return u; }
  ctx.use.atts.add(a.id);
  if (!ctx.edit && ctx.assetURL) { const f = str(ctx.assetURL(a)); if (f) return f; }
  if (typeof a.data === 'string' && a.data) {
    if (!ctx.edit) ctx.use.imgInline.add(a.id);
    return `data:${a.mime};base64,${a.data}`;
  }
  return (ctx.attURL && ctx.attURL(a.id)) || '';
}

// Page lists over the site's pages: children (addresses below this page's), all, or chosen links.
function pageListHTML(ctx, b, idx, pageHref, c, blk) {
  const { pid } = stateOf(ctx, blk);
  const pages = (ctx.doc.regions.main || []).filter((p) => isObj(p) && p.type === 'page' && p.kind !== 'notfound' && !p.hidden);
  const cur = pages.find((p) => p.id === pid);
  let list;
  if (b.source === 'children' && cur) list = pages.filter((p) => p !== cur && p.slug.startsWith(cur.slug ? cur.slug + '/' : '') && (!cur.slug ? !p.slug.includes('/') && p !== idx.home : p.slug.split('/').length === cur.slug.split('/').length + 1));
  else if (b.source === 'links') list = (b.links || []).map((it) => { const L = c.resolve(it.link); return L && L.exists ? idx.m.get(String(L.title).toLowerCase()) : null; }).filter(Boolean);
  else list = pages.filter((p) => p !== cur);
  list = list.slice(0, b.limit || 12);
  const title = b.title ? `<div class="kp-pl-title">${c.inline(b.title)}</div>` : '';
  const name = (p) => escapeHTML(str(pickText(p.navLabel, ctx.lang, ctx.doc)) || str(pickText(p.title, ctx.lang, ctx.doc)) || p.slug);
  if (!list.length) return title + `<p class="kp-empty">${escapeHTML(c.t('r.noPages'))}</p>`;
  const a = (p) => `<a class="kp-link" href="${escapeAttr(pageHref(p, ''))}">${name(p)}</a>`;
  if (b.style === 'compact') return `<div class="kp-pl kp-pl-compact">${title}${list.map(a).join(' · ')}</div>`;
  if (b.style === 'list' || b.style === 'columns') return `<div class="kp-pl kp-pl-${b.style}">${title}<ul>${list.map((p) => `<li>${a(p)}${b.summary && str(pickText(p.metaDesc, ctx.lang, ctx.doc)) ? ` <span class="kp-pl-sum">— ${escapeHTML(str(pickText(p.metaDesc, ctx.lang, ctx.doc)))}</span>` : ''}</li>`).join('')}</ul></div>`;
  return `<div class="kp-pl">${title}<div class="kp-pl-cards">${list.map((p) => `<a class="kp-plc" href="${escapeAttr(pageHref(p, ''))}"><span class="kp-plc-img kp-plc-noimg" aria-hidden="true"></span><span class="kp-plc-body"><span class="kp-plc-t">${name(p)}</span>${b.summary && str(pickText(p.metaDesc, ctx.lang, ctx.doc)) ? `<span class="kp-plc-s">${escapeHTML(str(pickText(p.metaDesc, ctx.lang, ctx.doc)))}</span>` : ''}</span></a>`).join('')}</div></div>`;
}

const WIKI_FEATURE_TYPES = new Set(['table', 'flashcards', 'media', 'gallery', 'infobox', 'diagram', 'callout', 'interlinear', 'glossary']);

function renderWiki(b, ctx) {
  const t = kbType(b.type);
  const T = KB[t];
  if (!T) return '';
  const c = adapter(ctx, b);
  let html;
  try { html = T.render(toKB(b), c); } catch (e) { html = ctx.edit ? `<div class="kp-missing">${escapeHTML(String((e && e.message) || e))}</div>` : ''; }
  if (!ctx.edit && WIKI_FEATURE_TYPES.has(t)) feature(ctx, 'wiki');
  const ly = typeof b.layer === 'string' && LAYER_RE.test(b.layer) ? b.layer : '';
  if (ly && !ctx.edit) feature(ctx, 'wiki');
  return `<div class="wk kp-b kp-b-${t}"${ly ? ` data-layer="${ly}"` : ''}>${html}</div>`;
}

/* ---------- versions ---------- */

const versionLabels = (b) => str(b.labels).split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 12);

function renderVersions(b, ctx) {
  const vs = Array.isArray(b.versions) ? b.versions : [];
  const labels = versionLabels(b);
  if (ctx.edit) {
    return `<div class="wk-vers wk-vers-edit">${vs.map((v, i) => `<section class="wk-ver"><div class="wk-ver-l">${escapeHTML(labels[i] || String(i + 1))}</div>${renderList(ctx, v.blocks, b.id + ':versions.' + i + '.blocks', 'div', 'wk-ver-in', '', false)}</section>`).join('')}</div>`;
  }
  const parts = vs.map((v, i) => renderList(ctx, v.blocks, '', 'div', 'wk-ver-in', '', true));
  if (!parts.some(Boolean)) return '';
  feature(ctx, 'wiki');
  needUi(ctx, 'wkVersion');
  const btns = vs.length > 1 ? `<div class="kp-bar wk-vbar lp-js-only" role="group"><span class="kp-bar-l">${escapeHTML(uiText('wkVersion', ctx.lang, ctx.doc))}</span>${vs.map((v, i) => `<button type="button" class="kp-vbtn${i ? '' : ' kp-on'}" data-wk-v="${i}" aria-pressed="${i ? 'false' : 'true'}">${escapeHTML(labels[i] || String(i + 1))}</button>`).join('')}</div>` : '';
  return `<div class="wk-vers" data-wk-vers>${btns}${parts.map((p, i) => `<section class="wk-ver" data-wk-ver="${i}"${vs.length > 1 ? ` aria-label="${escapeAttr(labels[i] || String(i + 1))}"` : ''}>${p}</section>`).join('')}</div>`;
}

/* ---------- layer toggles ---------- */

function renderLayers(b, ctx) {
  const ls = (ctx.doc.wiki && ctx.doc.wiki.layers) || [];
  if (!ls.length) return ctx.edit ? `<div class="lp-empty">${escapeHTML(uiText('wkNoLayers', ctx.uiLang, ctx.doc))}</div>` : '';
  if (!ctx.edit) { feature(ctx, 'wiki'); needUi(ctx, 'wkLayers'); }
  const on = Object.fromEntries(ls.map((l) => [l.id, !!l.on]));
  return `<div class="kp-bar wk-lbar${ctx.edit ? '' : ' lp-js-only'}" data-wk-layers="${escapeAttr(JSON.stringify(on))}" role="group"><span class="kp-bar-l">${escapeHTML(uiText('wkLayers', ctx.lang, ctx.doc))}</span>`
    + ls.map((l) => `<button type="button" class="kp-lbtn${l.on ? ' kp-on' : ''}" data-wk-layer="${escapeAttr(l.id)}" aria-pressed="${l.on ? 'true' : 'false'}">${escapeHTML(l.label || l.id)}</button>`).join('') + '</div>';
}

/* ---------- 451 sections ---------- */

// 451 sections: encrypted at export so a static host can serve private content without a server-side check.
// PBKDF2 with 600 000 iterations (OWASP 2023 guidance for PBKDF2-HMAC-SHA256) slows offline guessing of the password
// from the published envelope; the strength still rests on the password itself.
// The cache keeps derived keys for repeated renders in the editor session (each render would cost ~1 s of KDF).
const KEYS = new Map(); // password + salt + iterations → key (the KDF is slow; renders repeat)
const ITER = 600000;
function sealHTML(html, password, salt) {
  const k = salt + ':' + ITER + ':' + password;
  let key = KEYS.get(k);
  if (!key) {
    key = pbkdf2(sha256, new TextEncoder().encode(String(password).normalize('NFC')), Uint8Array.from(atobSafe(salt)), ITER, 32);
    KEYS.set(k, key);
  }
  // Fresh 96-bit IV on every seal: reusing an IV with the same GCM key leaks the XOR of plaintexts and breaks
  // authentication, so exports are intentionally non-deterministic here.
  const iv = randomBytes(12);
  const ct = aesGcmEncrypt(key, iv, new TextEncoder().encode(html));
  return { v: 1, a: 'pbkdf2-sha256', s: salt, i: ITER, iv: b64encode(iv), ct: b64encode(ct) };
}
// atob in browsers, Buffer in Node (exports can run in either).
function atobSafe(b64) { const s = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary'); return Array.from(s, (ch) => ch.charCodeAt(0)); }

function renderSecret(b, ctx) {
  const label = escapeHTML(str(b.label) || uiText('wk451', ctx.lang, ctx.doc));
  const path = b.id + ':blocks';
  if (ctx.edit) return `<section class="wk-451 wk-451-edit"><div class="wk-451-h"><span class="kp-451-badge">451</span>${label}${b.password ? '' : ` <em class="wk-451-warn">${escapeHTML(uiText('wkNoPassword', ctx.uiLang, ctx.doc))}</em>`}</div>${renderList(ctx, b.blocks, path, 'div', 'wk-451-in', '', false)}</section>`;
  // No password: the section is dropped from the export entirely rather than published in clear text.
  if (!str(b.password)) return '';
  const inner = renderList(ctx, b.blocks, '', 'div', 'wk-451-in', '', true);
  if (!inner) return '';
  feature(ctx, 'wiki');
  needUi(ctx, 'wk451Password', 'wk451Open', 'wk451Wrong', 'wk451NoCrypto');
  const env = sealHTML(inner, b.password, b.salt);
  const id = 'wk451-' + escapeAttr(b.id);
  return `<section class="wk-451" data-wk-seal="${escapeAttr(JSON.stringify(env))}"><div class="wk-451-h"><span class="kp-451-badge">451</span>${label}</div>`
    + (str(b.hint) ? `<p class="wk-451-hint">${escapeHTML(b.hint)}</p>` : '')
    + `<form class="wk-451-f lp-js-only" data-wk-seal-form><label for="${id}">${escapeHTML(uiText('wk451Password', ctx.lang, ctx.doc))}</label><input id="${id}" type="password" autocomplete="off" required>`
    + `<button type="submit" class="lp-btn lp-btn-primary lp-btn-sm">${escapeHTML(uiText('wk451Open', ctx.lang, ctx.doc))}</button><span class="wk-451-msg" role="status" aria-live="polite"></span></form><div data-wk-seal-out hidden></div></section>`;
}

/* ---------- registry ---------- */

const CATEGORY = { text: 'wiki', wiki: 'wiki', nav: 'wiki', media: 'wiki', language: 'language', layout: 'wiki' };

const BT_WIKI = {};
for (const t of WIKI_TYPES) {
  const T = KB[t];
  const ml = mainList(t);
  const schema = Object.entries(T.fields).filter(([k, f]) => !ml || k !== ml[0]).map(([k, f]) => fieldOf(k, f)).filter(Boolean);
  schema.push({ key: 'layer', type: 'text', label: 'wf.layer', hint: 'wfh.layer' });
  const def = {
    category: CATEGORY[T.cat] || 'wiki', icon: T.icon || 'text', container: false, variants: [], i18nFields: [], noSource: true,
    defaults: () => { const d = defaultsOf(t); if (ml) d.items = []; return d; },
    schema,
    normalize(out) {
      const kb = toKB(out);
      const ids = Array.isArray(out.items) ? out.items.map((x) => x.id) : [];
      for (const [k, v] of Object.entries(kb)) if (k !== 'type' && k !== 'id' && (!ml || k !== ml[0])) out[k] = v;
      if (ml) out.items = (kb[ml[0]] || []).map((it, i) => ({ id: ids[i] || 'i' + Math.random().toString(36).slice(2, 10), ...it }));
      out.layer = typeof out.layer === 'string' && LAYER_RE.test(out.layer) ? out.layer : '';
    },
    render: renderWiki,
  };
  if (ml) {
    def.itemSchema = Object.entries(ml[1].item).map(([k, f]) => fieldOf(k, f)).filter(Boolean);
    def.itemDefaults = () => {
      const o = {};
      const probe = kbNormBlock({ type: t, [ml[0]]: [{}] });
      Object.assign(o, (probe && probe[ml[0]] && probe[ml[0]][0]) || {});
      return o;
    };
    const lbl = ['label', 'title', 'term', 'text', 'front', 'date'].find((k) => ml[1].item[k]);
    if (lbl) def.itemLabel = lbl;
  }
  BT_WIKI[wkType(t)] = def;
}

BT_WIKI['wk-versions'] = {
  category: 'wiki', icon: 'layers', container: true, lists: ['versions.*.blocks'], i18nFields: [], noSource: true,
  defaults: () => ({ labels: 'Full\nSimple', versions: [{ id: 'v1', blocks: [] }, { id: 'v2', blocks: [] }] }),
  schema: [{ key: 'labels', type: 'textarea', rows: 3, label: 'wf.versions', hint: 'wfh.versions' }],
  normalize(out) {
    const n = Math.max(1, versionLabels(out).length);
    const vs = Array.isArray(out.versions) ? out.versions.slice(0, n) : [];
    while (vs.length < n) vs.push({ id: 'v' + Math.random().toString(36).slice(2, 9), blocks: [] });
    out.versions = vs;
  },
  render: renderVersions,
};
BT_WIKI['wk-layers'] = {
  category: 'wiki', icon: 'layers', container: false, i18nFields: [], noSource: true,
  defaults: () => ({}), schema: [], render: renderLayers,
};
BT_WIKI['wk-secret'] = {
  category: 'wiki', icon: 'lock', container: true, lists: ['blocks'], i18nFields: [], noSource: true,
  defaults: () => ({ label: '', hint: '', password: '', salt: '', blocks: [] }),
  schema: [
    { key: 'label', type: 'text', label: 'wf.secretLabel' },
    { key: 'password', type: 'text', label: 'wf.password', hint: 'wfh.password' },
    { key: 'hint', type: 'text', label: 'wf.hint' },
  ],
  normalize(out) {
    if (!/^[A-Za-z0-9+/]{22}==$/.test(str(out.salt))) out.salt = b64encode(randomBytes(16));
    out.password = str(out.password).slice(0, 200);
  },
  render: renderSecret,
};

/* ---------- CSS: the reader's block styles on the site's tokens ---------- */

const sliceCSS = (from, to) => { const a = READER_CSS.indexOf(from); const z = to ? READER_CSS.indexOf(to, a) : READER_CSS.length; return a < 0 ? '' : READER_CSS.slice(a, z < 0 ? READER_CSS.length : z); };
const WK_CSS = '.lp-root{--kp-bg:var(--lp-bg);--kp-fg:var(--lp-text);--kp-muted:var(--lp-muted);--kp-faint:var(--lp-muted);--kp-line:var(--lp-border);'
  + '--kp-line2:color-mix(in srgb,var(--lp-border) 55%,transparent);--kp-panel:var(--lp-surface);--kp-panel2:var(--lp-tint);--kp-link:var(--lp-accent);--kp-link-v:var(--lp-accent);'
  + '--kp-new:#d73333;--kp-accent:var(--lp-accent);--kp-accent-fg:var(--lp-on-accent,#fff);--kp-mark:color-mix(in srgb,#facc15 40%,transparent);--kp-code:var(--lp-tint);'
  + '--kp-font:inherit;--kp-font-h:var(--lp-font-h);--kp-font-m:ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace;--kp-radius:var(--lp-radius-s);--kp-r2:var(--lp-radius);'
  + '--kp-shadow:var(--lp-shadow);--kp-size:1rem;--kp-lh:1.6;--kp-h1:2rem;--kp-h-weight:600;--kp-title-font:var(--lp-font-h);--kp-top:0px}\n'
  + '.wk{min-width:0}.wk .kp-h{font-family:var(--lp-font-h);line-height:1.25;margin:1.2em 0 .5em}\n'
  + '.wk a.kp-link{color:var(--lp-accent)}.wk a.kp-new{color:var(--kp-new)}\n'
  + sliceCSS('.kp-bar{', '/* special pages */') + sliceCSS('/* previews, tooltips, lightbox */', '@media print')
  + '\n.wk-vbar,.wk-lbar{margin:0 0 1rem}.wk-ver+.wk-ver{margin-top:1.5rem}.wk-ver[hidden]{display:none}\n'
  + '.wk-vers-edit .wk-ver{padding:10px;border:1px dashed var(--lp-border);border-radius:var(--lp-radius-s)}.wk-ver-l{font-size:.8em;font-weight:700;color:var(--lp-muted);margin-bottom:6px}\n'
  + '.wk-451{padding:clamp(14px,2.4cqi,24px);border:1px solid color-mix(in srgb,#b91c1c 45%,var(--lp-border));border-radius:var(--lp-radius);background:var(--lp-surface)}\n'
  + '.wk-451-h{display:flex;align-items:center;gap:8px;font-weight:700;margin-bottom:10px}.wk-451-hint{color:var(--lp-muted);margin:0 0 10px}.wk-451-warn{color:#b91c1c;font-weight:400}\n'
  + '.wk-451-f{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.wk-451-f input{min-height:2.4em;padding:.3em .6em;border:1px solid var(--lp-border);border-radius:var(--lp-radius-s);background:var(--lp-bg);color:inherit}\n'
  + '.wk-451-msg{color:#b91c1c;font-size:.9em}.wk-451.wk-open .wk-451-f,.wk-451.wk-open .wk-451-hint{display:none}\n'
  + '@container (max-width:640px){.wk .kp-infobox,.wk .kp-infobox.kp-al-left{float:none;width:100%;margin:0 0 1rem}.wk .kp-toc-right{float:none;margin:.6rem 0 1rem;max-width:none}}\n';

const CSS_BLOCKS_WIKI = Object.fromEntries(Object.keys(BT_WIKI).map((k) => [k, '']));
const BLOCK_DEPS_WIKI = Object.fromEntries(Object.keys(BT_WIKI).map((k) => [k, ['wk']]));
const OWN_WIKI = [[/\.kp-|\.wk-|\.wk\b/, 'wk-text']];

const UI_WIKI = {
  en: { wkVersion: 'Version', wkLayers: 'Layers', wkNoLayers: 'Add layers in Site → Knowledge base', wk451: 'Protected content (451)', wkNoPassword: 'no password: not exported', wk451Password: 'Password', wk451Open: 'Open', wk451Wrong: 'Wrong password.', wk451NoCrypto: 'This browser cannot decrypt here.' },
  ru: { wkVersion: 'Версия', wkLayers: 'Слои', wkNoLayers: 'Добавьте слои в «Сайт → База знаний»', wk451: 'Закрытое содержимое (451)', wkNoPassword: 'нет пароля: не экспортируется', wk451Password: 'Пароль', wk451Open: 'Открыть', wk451Wrong: 'Неверный пароль.', wk451NoCrypto: 'Этот браузер не может расшифровать здесь.' },
  uk: { wkVersion: 'Версія', wkLayers: 'Шари', wkNoLayers: 'Додайте шари в «Сайт → База знань»', wk451: 'Закритий вміст (451)', wkNoPassword: 'немає пароля: не експортується', wk451Password: 'Пароль', wk451Open: 'Відкрити', wk451Wrong: 'Неправильний пароль.', wk451NoCrypto: 'Цей браузер не може розшифрувати тут.' },
  de: { wkVersion: 'Fassung', wkLayers: 'Ebenen', wkNoLayers: 'Ebenen unter Website → Wissensbasis anlegen', wk451: 'Geschützter Inhalt (451)', wkNoPassword: 'kein Passwort: wird nicht exportiert', wk451Password: 'Passwort', wk451Open: 'Öffnen', wk451Wrong: 'Falsches Passwort.', wk451NoCrypto: 'Dieser Browser kann hier nicht entschlüsseln.' },
  fr: { wkVersion: 'Version', wkLayers: 'Calques', wkNoLayers: 'Ajoutez des calques dans Site → Base de connaissances', wk451: 'Contenu protégé (451)', wkNoPassword: 'pas de mot de passe : non exporté', wk451Password: 'Mot de passe', wk451Open: 'Ouvrir', wk451Wrong: 'Mot de passe incorrect.', wk451NoCrypto: 'Ce navigateur ne peut pas déchiffrer ici.' },
  es: { wkVersion: 'Versión', wkLayers: 'Capas', wkNoLayers: 'Añada capas en Sitio → Base de conocimiento', wk451: 'Contenido protegido (451)', wkNoPassword: 'sin contraseña: no se exporta', wk451Password: 'Contraseña', wk451Open: 'Abrir', wk451Wrong: 'Contraseña incorrecta.', wk451NoCrypto: 'Este navegador no puede descifrar aquí.' },
  ka: { wkVersion: 'ვერსია', wkLayers: 'ფენები', wkNoLayers: 'დაამატეთ ფენები: საიტი → ცოდნის ბაზა', wk451: 'დახურული შიგთავსი (451)', wkNoPassword: 'პაროლი არ არის: არ ექსპორტდება', wk451Password: 'პაროლი', wk451Open: 'გახსნა', wk451Wrong: 'პაროლი არასწორია.', wk451NoCrypto: 'ეს ბრაუზერი აქ ვერ გაშიფრავს.' },
};

export { BLOCK_DEPS_WIKI, BT_WIKI, CSS_BLOCKS_WIKI, OWN_WIKI, UI_WIKI, WIKI_TYPES, WK_CSS, fromKB, toKB, wkType };
