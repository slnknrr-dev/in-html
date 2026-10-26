// portal/markup.js - markup builders of the portal blocks (pure, Node and browsers): one implementation of the HTML
// both renderers emit. A builder gets the block (normalized by its host, neutral field names of models.js) and a view
// adapter V that hides how the host stores and renders text:
//
//   V.p             class prefix ('lp' landing, 'kp' knowledge); classes are '<p>-pt-*'
//   V.edit          landing editor canvas (no runtime; fields contenteditable through V.f)
//   V.langs / V.lang  output languages / main language (alphabet order, sort keys, option identities)
//   V.page          id of the page being rendered (glossary scope 'page')
//   V.cat           the site catalog (catalog.js)          V.today   today as a day number (records.js)
//   V.f(path, kind, tag, cls)   a text field of the block ('title', 'items.2.name'): per-language markup, '' when empty
//                               (edit mode: an editable field); kind 'line' | 'long'
//   V.has(v)        a value has text in some output language
//   V.plain(v, l) / V.raw(v, l) plain text / source text of a value in language l
//   V.lineIn(v, l) / V.longIn(v, l) / V.inline(rawLine, l)   HTML of one value / one source line in language l
//   V.per(fn(l) -> html)        language-dependent markup (landing: one group per language; knowledge: fn(lang))
//   V.t(key, vars) -> html      UI string (all output languages);  V.tl(key, l, vars) -> plain string in language l
//   V.attr(name, fn(l) -> text) -> ' name="…"' (+ per-language data the host's runtime switches)
//   V.link(v) -> { href, ext } | null       V.a(href, cls, extra) -> '<a …>' (external links get target / rel)
//   V.img(id, { cls, alt }) -> html | ''     V.file(id) -> { href, name, type, size } | null
//   V.fileCard(id, labelHTML) -> html (optional: the host's own file card instead of V.file)
//   V.searchForm({ placeholder(l) }) / V.searchHref(q) (optional: hosts with a search page of their own)
//   V.extraEntries(l) / V.extraTopic(name, l) (optional: host entries for the unified search and topic hubs)
//   V.date(day, l) -> text      V.icon(name) -> html      V.href(anchor) -> URL of an anchor of this page
//   V.feature(name)             runtime feature used      V.need(...keys) runtime UI keys used      V.di(i) edit-mode item attr
//
//   PT_RENDER[type](b, V) -> html        ptJSON(v) -> attribute-safe JSON
// Runtime contract (prefix-free data attributes, runtime.js): data-pt (block root), data-pt-list, data-pt-q, data-pt-i,
// data-pt-s, data-pt-f, data-pt-v, data-pt-facet, data-pt-tab, data-pt-sort, data-pt-count, data-pt-empty, data-pt-more,
// data-pt-reset, data-pt-g, data-pt-for, data-pt-spy, data-pt-copy, data-pt-tip, data-pt-tipd, data-pt-mask,
// data-pt-print, data-pt-rel, data-pt-check, data-pt-ck, data-pt-find. Without JavaScript every item is shown and the
// controls marked '<p>-pt-js' are hidden.
import { escapeAttr as ea, escapeHTML as eh } from '../html/escape.js';
import { excerpt, fold, slugId, splitList } from './text.js';
import { alphaIndex } from './alphabet.js';
import { linkRefs, numHTML, numKey, numText, outline, parseBody, parseChanges, unitAnchor } from './legal.js';
import { linkTerms, termKey } from './glossary.js';
import { budgetParts, daysSince, daysUntil, facetOptions, priceParts, recommendScore } from './records.js';

// Builders are total over malformed blocks: missing arrays become [], so a half-edited block still renders.
const arr = (v) => (Array.isArray(v) ? v : []);
// JSON for data-* attributes: escapeAttr makes quotes and & safe inside a double-quoted attribute.
export const ptJSON = (v) => ea(JSON.stringify(v));
const C = (V, ...names) => names.filter(Boolean).map((n) => `${V.p}-pt-${n}`).join(' ');

// Search text of an item: every value in every output language, folded.
// Every language's text folded into one data-pt-s string: a search in any language finds the item (same folding as the runtime).
function searchText(V, values) {
  const parts = [];
  for (const l of V.langs) for (const v of values) { const s = typeof v === 'string' || typeof v === 'number' ? String(v) : V.plain(v, l); if (s) parts.push(s); }
  return fold([...new Set(parts)].join(' '));
}

// Per-language plain values as a sort value: { lang: text } (one language: the text).
function sortVal(V, v) {
  const key = (l) => fold(V.plain(v, l)).replace(/^[^\p{L}\p{N}]+/u, '');
  if (V.langs.length < 2) return key(V.lang);
  const o = {};
  for (const l of V.langs) o[l] = key(l);
  return o;
}

function rootOpen(V, b, type, cls, attrs = '') {
  return `<div class="${V.p}-pt ${C(V, type, ...cls)}" data-pt="${type}"${V.edit ? ' data-pt-js' : ''}${attrs}>`;
}

function badge(V, kind, html) {
  return `<span class="${C(V, 'badge', 'b-' + kind)}">${html}</span>`;
}

function copyBtn(V, anchor) {
  if (V.edit || !anchor) return '';
  V.feature('ptbase');
  V.need('pt.copied');
  return `<button type="button" class="${C(V, 'copy', 'js')}" data-pt-copy="${ea(V.href(anchor))}"${V.attr('aria-label', (l) => V.tl('pt.copy', l))}${V.attr('title', (l) => V.tl('pt.copy', l))}>${V.icon('link')}</button>`;
}

// Heading of a block (title field) and an optional count line.
function headHTML(V, b, sub) {
  const t = V.f('title', 'line', 'h2', C(V, 'h'));
  return t || sub ? `<header class="${C(V, 'head')}">${t}${sub ? `<p class="${C(V, 'sub')}">${sub}</p>` : ''}</header>` : '';
}

// Glossary terms and cross-references inside a piece of per-language HTML. seen: Map lang -> Set (first occurrence).
// Cross-references first, then glossary terms: linkTerms skips text inside <a>, so terms never get linked inside a
// reference link. "seen" scopes the first-occurrence rule per language.
function enrich(V, html, l, { xrefs = true, terms = true, act = '', seen = null, tips = null } = {}) {
  let h = html;
  if (!h) return h;
  const cat = V.cat;
  if (xrefs && cat && cat.acts.size) {
    // Outside an act, a reference without an act name points at the only act of the site (if there is one).
    const current = act || (cat.acts.size === 1 ? [...cat.acts.keys()][0] : '');
    h = linkRefs(h, { resolve: cat.resolveRef, aliases: cat.aliases, current, open: (href) => `<a class="${C(V, 'xref')}" href="${ea(href)}">` });
  }
  if (terms && cat && cat.terms.length) {
    const m = cat.termMatcher(l, V.page);
    if (m.size) {
      let s = seen && seen.get(l);
      if (seen && !s) { s = new Set(); seen.set(l, s); }
      h = linkTerms(h, m, {
        seen: s || new Set(),
        open: (id) => {
          const e = cat.term(id);
          if (tips) tips.add(id);
          return `<a class="${C(V, 'term')}" href="${ea(e ? e.href : '#' + id)}" data-pt-tip="${ea(id)}">`;
        },
      });
    }
  }
  return h;
}

// Hidden definitions of the terms linked in a block, read by the tooltip runtime (one per language).
// Definitions are rendered as hidden escaped HTML next to the block; the tooltip runtime copies them, so the runtime needs no strings.
function tipsHTML(V, tips) {
  if (!tips || !tips.size || V.edit) return '';
  V.feature('pttips');
  V.need('pt.term.open');
  let s = '';
  for (const id of tips) {
    const e = V.cat.term(id);
    if (!e) continue;
    for (const l of V.langs) s += `<span data-pt-tipd="${ea(id)}" data-pt-lang="${ea(l)}"><b>${eh(e.title(l))}</b> ${eh(e.def(l))}</span>`;
  }
  return s ? `<div hidden data-pt-tips>${s}</div>` : '';
}

/* ---------- list tools: search, tabs, facets, sort, count, more ---------- */

function selectFacet(V, key, labelKey, opts) {
  if (!opts.options.length || opts.options.length < 2) return '';
  const options = opts.options.map((o) => {
    const lab = o.label[V.lang] || Object.values(o.label)[0] || o.id;
    const m = V.langs.length > 1 ? ` data-pt-l="${ptJSON(o.label)}" data-pt-n="${o.n}"` : '';
    return `<option value="${ea(o.id)}"${m}>${eh(lab)} (${o.n})</option>`;
  }).join('');
  return `<label class="${C(V, 'fl')}"><span class="${C(V, 'fll')}">${V.t(labelKey)}</span>`
    + `<select class="${C(V, 'sel')}" data-pt-facet="${ea(key)}"><option value=""${V.langs.length > 1 ? ` data-pt-l="${ptJSON(Object.fromEntries(V.langs.map((l) => [l, V.tl('pt.all', l)])))}"` : ''}>${eh(V.tl('pt.all', V.lang))}</option>${options}</select></label>`;
}

function sortSelect(V, list) {
  if (list.length < 2) return '';
  const opts = list.map(([v, key]) => `<option value="${ea(v)}"${V.langs.length > 1 ? ` data-pt-l="${ptJSON(Object.fromEntries(V.langs.map((l) => [l, V.tl(key, l)])))}"` : ''}>${eh(V.tl(key, V.lang))}</option>`).join('');
  return `<label class="${C(V, 'fl')}"><span class="${C(V, 'fll')}">${V.t('pt.sort')}</span><select class="${C(V, 'sel')}" data-pt-sort>${opts}</select></label>`;
}

function searchBox(V, phKey) {
  return `<label class="${C(V, 'q')}"><span class="${C(V, 'sr')}">${V.t('pt.search')}</span>${V.icon('search')}`
    + `<input type="search" class="${C(V, 'qi')}" data-pt-q autocomplete="off"${V.attr('placeholder', (l) => V.tl(phKey, l))}${V.attr('aria-label', (l) => V.tl('pt.search', l))}></label>`;
}

// role="search" landmark; the count is a polite live region so filter results are announced without stealing focus.
function toolsHTML(V, parts, total) {
  const inner = parts.filter(Boolean).join('');
  if (!inner) return '';
  V.feature('ptlist');
  V.need('pt.count', 'pt.none', 'pt.shown');
  return `<div class="${C(V, 'tools', 'js')}" role="search">${inner}<p class="${C(V, 'count')}" data-pt-count role="status" aria-live="polite">${V.t('pt.count', { n: total })}</p>`
    + `<button type="button" class="${C(V, 'reset')}" data-pt-reset hidden>${V.t('pt.reset')}</button></div>`;
}

function emptyMore(V, more) {
  let s = `<p class="${C(V, 'empty')}" data-pt-empty hidden>${V.t('pt.none')}</p>`;
  if (more) s += `<div class="${C(V, 'morew', 'js')}"><button type="button" class="${C(V, 'btn', 'btn2', 'more')}" data-pt-more hidden>${V.t('pt.more')}</button></div>`;
  return s;
}

// Letters without entries are spans with aria-disabled, not links: the bar keeps the full alphabet without dead anchors.
function alphaNav(V, idx, base, caps) {
  const show = (k) => (caps ? mtavruli(k) : k);
  const links = idx.letters.map((x) => {
    const label = x.key === '#' || x.key === '0–9' ? (x.key === '#' ? eh(V.tl('pt.az.other', V.lang)) : x.key) : eh(show(x.key));
    return x.n ? `<a href="${ea(V.href(base + '-' + x.id))}" data-pt-azl="${ea(base + '-' + x.id)}">${label}</a>` : `<span aria-disabled="true">${label}</span>`;
  }).join('');
  V.feature('pttoc');
  return `<nav class="${C(V, 'az')}" data-pt-spy${V.attr('aria-label', (l) => V.tl('pt.alpha', l))}>${links}</nav>`;
}

// Georgian Mkhedruli letters shown as Mtavruli capitals (the index style of Georgian dictionaries).
export function mtavruli(s) {
  return [...String(s)].map((ch) => { const c = ch.codePointAt(0); return c >= 0x10D0 && c <= 0x10F0 ? String.fromCodePoint(c - 0x10D0 + 0x1C90) : ch; }).join('');
}

/* ---------- legal act ---------- */

const unitLabel = (V, kind, num, l) => V.tl('pt.u.' + kind, l, { n: num });

// Legal act: header (type, status, dates, actions), overview and planned changes, a table of contents built from the
// unit tree, and units with stable anchors. Ids come from the catalog when present, so cross-references from other
// blocks land on the same ids; the fallbacks keep a standalone render consistent.
function actHTML(b, V) {
  const items = arr(b.items);
  const cat = V.cat;
  const base = (cat && cat.actBase(b.id)) || slugId(V.plain(b.key, V.lang), '') || 'act';
  const tree = outline(items);
  const anchorOf = (u, i) => {
    if (!u || u.kind === 'text') return '';
    if (u.kind === 'article') return (cat && cat.anchor(b.id, i)) || unitAnchor(base, (numKey(u.num) || 'n') + '-' + i);
    return `${base}-${u.kind[0]}${numKey(u.num) || i + 1}`;
  };
  const nArt = items.filter((u) => u.kind === 'article').length;
  const status = b.status || 'force';
  const tips = new Set();

  // Header: type, status, title, dates, actions.
  const over = [];
  if (V.has(b.actType)) over.push(`<span class="${C(V, 'kind')}">${V.f('actType', 'line', 'span', '')}</span>`);
  if (V.plain(b.number, V.lang)) over.push(`<span class="${C(V, 'num')}">${V.per((l) => eh(V.tl('pt.act.number', l, { n: V.plain(b.number, l) })))}</span>`);
  over.push(badge(V, status, V.t('pt.act.status.' + status)));
  const meta = [];
  const dd = (key, val) => (val ? `<div><dt>${V.t(key)}</dt><dd>${val}</dd></div>` : '');
  for (const [k, key] of [['adopted', 'pt.act.adopted'], ['effective', 'pt.act.effective'], ['revised', 'pt.act.revised']]) {
    if (b[k]) meta.push(dd(key, `<time datetime="${ea(b[k])}">${V.per((l) => eh(V.date(b[k], l)))}</time>`));
  }
  if (V.has(b.issuer)) meta.push(dd('pt.act.issuer', V.f('issuer', 'line', 'span', '')));
  if (nArt) meta.push(`<div><dt class="${C(V, 'sr')}">${V.t('pt.act.articles', { n: nArt })}</dt><dd>${V.t('pt.act.articles', { n: nArt })}</dd></div>`);
  const acts = [];
  const src = V.link(b.source);
  if (src) acts.push(`${V.a(src.href, C(V, 'btn', 'btn2'))}${V.icon('external')}${V.t('pt.act.source')}</a>`);
  // Hosts with an attachment model of their own render the file card (V.fileCard); the others give a URL (V.file).
  const fcard = b.file && V.fileCard ? V.fileCard(b.file, V.t('pt.act.file')) : '';
  const file = !fcard && b.file ? V.file(b.file) : null;
  if (fcard) acts.push(fcard);
  else if (file) acts.push(docCard(V, file, V.t('pt.act.file')));
  if (!V.edit) {
    V.feature('ptbase');
    acts.push(`<button type="button" class="${C(V, 'btn', 'btn2', 'js')}" data-pt-print>${V.icon('print')}${V.t('pt.act.print')}</button>`);
  }
  acts.push(copyBtn(V, base));
  let succ = '';
  const sl = status === 'repealed' ? V.link(b.successor) : null;
  if (sl) succ = `<p class="${C(V, 'succ')}">${V.t('pt.act.successor')}: ${V.a(sl.href, '')}${eh(sl.title || sl.href)}</a></p>`;
  let head = `<header class="${C(V, 'acth')}" id="${ea(base)}"><p class="${C(V, 'over')}">${over.join(' ')}</p>`
    + (V.f('title', 'line', 'h2', C(V, 'h', 'actt')) || '')
    + (meta.length ? `<dl class="${C(V, 'meta')}">${meta.join('')}</dl>` : '') + succ
    + `<div class="${C(V, 'acts')}">${acts.filter(Boolean).join('')}</div></header>`;

  // Overview and planned changes.
  let pre = '';
  if (V.has(b.summary)) {
    pre += `<section class="${C(V, 'card', 'summary')}"><h3 class="${C(V, 'h3')}">${V.t('pt.act.summary')}</h3>`
      + `<div class="${C(V, 'rich')}">${V.per((l) => enrich(V, V.longIn(b.summary, l), l, { act: base, tips, seen: new Map() }))}</div></section>`;
  }
  if (V.has(b.changes)) {
    pre += `<aside class="${C(V, 'callout', 'changes')}"><h3 class="${C(V, 'h3')}">${V.icon('clock')}${V.t('pt.act.changes')}</h3>` + V.per((l) => {
      const rows = parseChanges(V.raw(b.changes, l)).map((c) => `<li>${c.day ? `<time datetime="${ea(c.day)}">${eh(V.date(c.day, l))}</time> ` : ''}<span>${enrich(V, eh(c.text), l, { act: base, terms: false })}</span></li>`).join('');
      return rows ? `<ul class="${C(V, 'chl')}">${rows}</ul>` : '';
    }) + '</aside>';
  }

  // Table of contents.
  const tocMode = b.toc || 'side';
  let toc = '';
  if (tocMode !== 'none' && items.some((u) => u.kind !== 'text')) {
    const li = (nodes) => nodes.map((n) => {
      const u = n.unit;
      if (u.kind === 'text') return '';
      const a = anchorOf(u, n.i);
      const label = V.per((l) => {
        const t = V.plain(u.title, l);
        const lab = u.kind === 'article' ? `<span class="${C(V, 'tn')}">${numHTML(u.num)}</span>` : eh(unitLabel(V, u.kind, numText(u.num), l));
        return `${lab} <span class="${C(V, 'tct')}">${eh(u.status === 'repealed' && !t ? '(' + V.tl('pt.unit.repealed', l) + ')' : t)}</span>`;
      });
      const kids = n.children.length ? `<ol>${li(n.children)}</ol>` : '';
      return `<li class="${C(V, u.kind === 'article' ? 'tl' : 'tg', u.status === 'repealed' ? 'gone' : '')}"${u.kind === 'article' ? ` data-pt-for="${ea(a)}"` : ''}><a href="${ea(V.href(a))}">${label}</a>${kids}</li>`;
    }).join('');
    V.feature('pttoc');
    toc = `<nav class="${C(V, 'toc')}" data-pt-spy${V.attr('aria-label', (l) => V.tl('pt.contents', l))}><details class="${C(V, 'tocd')}" open>`
      + `<summary class="${C(V, 'toch')}">${V.t('pt.contents')} <span class="${C(V, 'muted')}">· ${V.t('pt.act.articles', { n: nArt })}</span></summary><ol class="${C(V, 'tocl')}">${li(tree)}</ol></details></nav>`;
  }

  // Units.
  const find = b.find !== false && nArt > 1 && !V.edit;
  const unitHTML = (nodes, depth) => nodes.map((n) => {
    const u = n.unit;
    const i = n.i;
    const a = anchorOf(u, i);
    if (u.kind === 'text') {
      return `<div class="${C(V, 'txt', 'rich')}"${V.di(i)}>${V.per((l) => enrich(V, V.longIn(u.body, l), l, { act: base, tips, xrefs: b.xrefs !== false, terms: b.autolink !== false, seen: new Map() }))}</div>`;
    }
    const lv = Math.min(6, 3 + depth);
    if (u.kind !== 'article') {
      const title = V.per((l) => `<span class="${C(V, 'gl')}">${eh(unitLabel(V, u.kind, numText(u.num), l))}</span>${V.plain(u.title, l) ? ` <span class="${C(V, 'gt')}">${V.lineIn(u.title, l)}</span>` : ''}`);
      return `<section class="${C(V, 'grp', 'k-' + u.kind)}" id="${ea(a)}" data-pt-g aria-labelledby="${ea(a)}-h"${V.di(i)}><h${lv} class="${C(V, 'gh')}" id="${ea(a)}-h">${title}</h${lv}>${unitHTML(n.children, depth + 1)}</section>`;
    }
    const gone = u.status === 'repealed';
    const st = u.status && u.status !== 'valid' ? badge(V, u.status, V.t('pt.unit.' + u.status)) : '';
    const title = V.per((l) => {
      const t = V.lineIn(u.title, l);
      return `<a class="${C(V, 'artn')}" href="${ea(V.href(a))}">${eh(unitLabel(V, 'article', '', l)).trim()} ${numHTML(u.num)}.</a>`
        + (t ? ` <span class="${C(V, 'artt')}">${t}</span>` : gone ? ` <span class="${C(V, 'artt')}">(${eh(V.tl('pt.unit.repealed', l))})</span>` : '');
    });
    const note = V.has(u.note) ? `<p class="${C(V, 'note')}">${V.f(`items.${i}.note`, 'line', 'span', '')}</p>` : '';
    const body = V.has(u.body) ? `<div class="${C(V, 'body')}">${V.per((l) => {
      const seen = new Map();
      return enrich(V, bodyHTML(V, V.raw(u.body, l), l, a), l, { act: base, tips, xrefs: b.xrefs !== false, terms: b.autolink !== false, seen });
    })}</div>` : '';
    const s = find ? ` data-pt-i data-pt-s="${ea(searchText(V, [unitLabel(V, 'article', numText(u.num), V.lang), u.num, u.title, u.body, u.tags]))}"` : '';
    return `<article class="${C(V, 'art', gone ? 'gone' : '')}" id="${ea(a)}"${s} aria-labelledby="${ea(a)}-h"${V.di(i)}>`
      + `<h${lv} class="${C(V, 'arth')}" id="${ea(a)}-h">${title}${st}${copyBtn(V, a)}</h${lv}>${note}${body}</article>`;
  }).join('');
  const units = unitHTML(tree, 0);
  const tools = find ? toolsHTML(V, [searchBox(V, 'pt.act.findPh')], nArt) : '';
  const main = `<div class="${C(V, 'actx')}">${tools}<div class="${C(V, 'units')}" data-pt-items>${units}</div>${find ? emptyMore(V, false) : ''}</div>`;
  const layout = toc ? `<div class="${C(V, 'actb', 'toc-' + tocMode)}">${toc}${main}</div>` : main;
  return rootOpen(V, b, 'act', ['st-' + status], find ? ' data-pt-list' : '') + head + pre + layout + tipsHTML(V, tips) + '</div>';
}

// The paragraphs of an article in language l (ids '<article>-p<n>' and '<article>-p<n>-<letter>').
// Paragraph / subparagraph ids follow unitAnchor() so catalog.resolveRef can address them.
function bodyHTML(V, raw, l, a) {
  let h = '';
  for (const p of parseBody(raw)) {
    const line = (xs) => xs.map((x) => V.inline(x, l)).join('<br>');
    if (p.kind === 'text') { h += `<p class="${C(V, 'pt')}">${line(p.lines)}</p>`; continue; }
    const pid = p.key ? `${a}-p${p.key}` : '';
    let s = `<div class="${C(V, 'para', p.gone ? 'gone' : '')}"${pid ? ` id="${ea(pid)}"` : ''}>`;
    if (p.num) s += `<a class="${C(V, 'pn')}" href="${ea(V.href(pid))}">${/\./.test(p.num) ? eh(p.num) : numHTML(p.num)}.</a> `;
    if (p.lines.length) s += `<span class="${C(V, 'px')}">${line(p.lines)}</span>`;
    if (p.subs.length) {
      s += `<ol class="${C(V, 'subs')}">` + p.subs.map((sb) => {
        const sid = sb.key ? (pid ? `${pid}-${sb.key}` : `${a}-s${sb.key}`) : '';
        return `<li${sid ? ` id="${ea(sid)}"` : ''}${sb.gone ? ` class="${C(V, 'gone')}"` : ''}><span class="${C(V, 'sn')}">${eh(sb.mark)})</span> ${line(sb.lines)}</li>`;
      }).join('') + '</ol>';
    }
    h += s + '</div>';
  }
  return h;
}

// Document card: name, type and size, open / download.
function docCard(V, f, label) {
  const ext = (/\.([a-z0-9]{1,5})$/i.exec(f.name || '') || [])[1] || (f.type || '').split('/').pop() || '';
  const size = f.size ? (f.size >= 1048576 ? (f.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(f.size / 1024)) + ' KB') : '';
  return `<a class="${C(V, 'doc')}" href="${ea(f.href)}" download="${ea(f.name || 'file')}"><span class="${C(V, 'doci')}" aria-hidden="true">${eh(ext.toUpperCase().slice(0, 4))}</span>`
    + `<span class="${C(V, 'docb')}"><span class="${C(V, 'docn')}">${label}</span><small>${eh(f.name || '')}${size ? ' · ' + size : ''}</small></span></a>`;
}

/* ---------- glossary ---------- */

function termsHTML(b, V) {
  const items = arr(b.items);
  const cat = V.cat;
  const tips = new Set();
  // Several definitions of one term (different acts) become one entry.
  const groups = new Map();
  items.forEach((it, i) => {
    const name = V.plain(it.term, V.lang);
    if (!name && !V.edit) return;
    const k = termKey(name) || 'i' + i;
    if (!groups.has(k)) groups.set(k, { it, i, list: [] });
    groups.get(k).list.push({ it, i });
  });
  const entries = [...groups.values()];
  const anchorOf = (g) => (cat && cat.anchor(b.id, g.i)) || 't-' + slugId(V.plain(g.it.term, V.lang), 'term' + g.i);
  const findOn = b.find !== false && entries.length > 3 && !V.edit;
  const card = (g) => {
    const a = anchorOf(g);
    const { it, i } = g;
    const alt = V.has(it.alt) ? `<p class="${C(V, 'alt')}">${V.t('pt.term.also')}: ${V.f(`items.${i}.alt`, 'line', 'span', '')}</p>` : '';
    const defs = g.list.map(({ it: d, i: di }, k) => {
      const text = V.has(d.def) ? `<div class="${C(V, 'dtext', 'rich')}">${V.per((l) => enrich(V, V.longIn(d.def, l), l, { tips, seen: new Map([[l, new Set([a])]]) }))}</div>` : '';
      let source = '';
      if (V.has(d.source)) {
        const L = V.link(d.href);
        const s = V.per((l) => (L ? `${V.a(L.href, '')}${V.lineIn(d.source, l)}</a>` : enrich(V, V.lineIn(d.source, l), l, { terms: false })));
        source = `<p class="${C(V, 'dsrc')}"><span>${V.t('pt.term.source')}:</span> ${s}</p>`;
      }
      return `<div class="${C(V, 'def')}" id="${ea(a)}-${k + 1}"${V.di(di)}>${text}${source}</div>`;
    }).join('');
    let rel = '';
    if (V.has(it.related)) {
      rel = `<p class="${C(V, 'rel')}"><span>${V.t('pt.term.related')}:</span> ${V.per((l) => splitList(V.plain(it.related, l)).map((r) => {
        const e = cat && cat.terms.find((x) => termKey(x.title(l)) === termKey(r) || x.names(l).some((nm) => termKey(nm) === termKey(r)));
        return e ? `${V.a(e.href, C(V, 'tlink'))}${eh(r)}</a>` : eh(r);
      }).join(', '))}</p>`;
    }
    const tags = V.has(it.tags) ? `<p class="${C(V, 'chips')}">${V.per((l) => splitList(V.plain(it.tags, l)).map((x) => `<span class="${C(V, 'chip')}">${eh(x)}</span>`).join(''))}</p>` : '';
    const pill = g.list.length > 1 ? ` <span class="${C(V, 'pill')}">${V.t('pt.term.defs', { n: g.list.length })}</span>` : '';
    const s = findOn ? ` data-pt-i data-pt-s="${ea(searchText(V, [it.term, it.alt, ...g.list.map((x) => x.it.def), it.tags]))}"` : '';
    return `<article class="${C(V, 'tcard')}" id="${ea(a)}"${s}${V.di(i)}><h4 class="${C(V, 'tt')}"><dfn>${V.f(`items.${i}.term`, 'line', 'span', '')}</dfn>${pill}${copyBtn(V, a)}</h4>${alt}${defs}${rel}${tags}</article>`;
  };
  const layout = b.layout || 'cards';
  let list = '';
  let nav = '';
  if (b.alpha !== false && entries.length > 1) {
    const base = 'az-' + b.id;
    const idx = alphaIndex(entries, { lang: V.lang, text: (g) => V.plain(g.it.term, V.lang) });
    nav = alphaNav(V, idx, base, !!b.caps);
    list = idx.groups.map((g) => {
      const lab = g.key === '#' ? eh(V.tl('pt.az.other', V.lang)) : eh(b.caps ? mtavruli(g.key) : g.key);
      return `<section class="${C(V, 'letter')}" id="${ea(base + '-' + g.id)}" data-pt-g><h3 class="${C(V, 'lh')}"><span>${lab}</span> <small>${g.items.length}</small></h3><div class="${C(V, 'tl-' + layout)}">${g.items.map(card).join('')}</div></section>`;
    }).join('');
  } else {
    list = `<div class="${C(V, 'tl-' + layout)}">${entries.map(card).join('')}</div>`;
  }
  const tools = findOn ? toolsHTML(V, [searchBox(V, 'pt.searchPh')], entries.length) : '';
  return rootOpen(V, b, 'terms', ['l-' + layout], findOn ? ' data-pt-list' : '') + headHTML(V, b, V.t('pt.terms.n', { n: entries.length }))
    + tools + nav + `<div class="${C(V, 'items')}" data-pt-items>${list}</div>${findOn ? emptyMore(V, false) : ''}${tipsHTML(V, tips)}</div>`;
}

/* ---------- directory ---------- */

const initials = (s) => (String(s || '').trim().split(/\s+/).slice(0, 2).map((w) => [...w][0] || '').join('') || '?').toUpperCase();

// Contact masking is a courtesy, not protection: the real link is in the DOM (hidden by CSS until "show"), so
// scrapers still read it. It only stops casual copying and accidental taps.
function maskText(v, kind) {
  const s = String(v || '');
  if (kind === 'email') { const at = s.indexOf('@'); return at > 1 ? s[0] + '•••' + s.slice(at) : '•••' + s.slice(at); }
  // Phone numbers keep the country / area part and the last two digits: '+995 555 •• •• 56'.
  const total = (s.match(/\d/g) || []).length;
  const keep = Math.min(6, Math.max(0, total - 4));
  let i = 0;
  return s.replace(/\d/g, (d) => (i++ < keep || i > total - 2 ? d : '•'));
}

function contactsHTML(V, it, mode) {
  if (mode === 'none') return '';
  const out = [];
  const one = (kind, val, href, key) => {
    if (!val) return;
    if (mode === 'masked' && !V.edit) {
      V.feature('ptbase');
      out.push(`<span class="${C(V, 'mask')}" data-pt-mask><a class="${C(V, 'real')}" href="${ea(href)}">${eh(val)}</a><span class="${C(V, 'masked', 'js')}">${eh(maskText(val, kind))}</span>`
        + ` <button type="button" class="${C(V, 'link', 'js')}" data-pt-reveal${V.attr('aria-label', (l) => V.tl('pt.show', l) + ' — ' + V.tl(key, l))}>${V.t('pt.show')}</button></span>`);
    } else out.push(`<a class="${C(V, 'real')}" href="${ea(href)}">${eh(val)}</a>`);
  };
  const phone = String(V.plain(it.phone, V.lang) || '');
  const email = String(V.plain(it.email, V.lang) || '');
  one('phone', phone, 'tel:' + phone.replace(/[^\d+]/g, ''), 'pt.call');
  if (/^[^\s@]+@[^\s@]+$/.test(email)) one('email', email, 'mailto:' + email, 'pt.mail');
  const site = V.link(it.site);
  if (site) out.push(`${V.a(site.href, '')}${V.icon('external')}${eh(String(site.href).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>`);
  return out.length ? `<p class="${C(V, 'contacts')}">${out.join('')}</p>` : '';
}

// Rating as a clipped star row (CSS custom property width); aria-hidden because the rating is also given as text.
function stars(V, r) {
  const n = Math.max(0, Math.min(5, Number(r) || 0));
  return `<span class="${C(V, 'stars')}" style="--pt-st:${(n / 5 * 100).toFixed(1)}%" aria-hidden="true">★★★★★</span>`;
}

// Directory: facet ids per item go into data-pt-f as space-separated "facet:id" tokens; the runtime filters with
// indexOf on " token " (padded), which is exact token matching without a parser.
function directoryHTML(b, V) {
  const items = arr(b.items);
  const cat = V.cat;
  const variant = b.variant || 'cards';
  const cur = String(V.plain(b.currency, V.lang) || 'GEL').toUpperCase();
  const listOn = !V.edit && items.length > 1;
  const valuesOf = (key) => (it, l) => splitList(V.plain(it[key], l));
  const areaF = facetOptions(items, valuesOf('areas'), { langs: V.langs, lang: V.lang });
  const cityF = facetOptions(items, (it, l) => [V.plain(it.city, l)].filter(Boolean), { langs: V.langs, lang: V.lang });
  const langF = facetOptions(items, valuesOf('langs'), { langs: V.langs, lang: V.lang });
  const kinds = {};
  for (const it of items) kinds[it.kind || 'person'] = (kinds[it.kind || 'person'] || 0) + 1;
  const card = (it, i) => {
    const kind = it.kind || 'person';
    const a = (cat && cat.anchor(b.id, i)) || 'pr-' + slugId(V.plain(it.name, V.lang), 'x' + i);
    const nameTxt = V.plain(it.name, V.lang);
    const photo = it.photo ? V.img(it.photo, { cls: C(V, 'phi'), alt: '' }) : '';
    const ph = `<div class="${C(V, 'ph', photo ? '' : 'ph0')}">${photo || `<span aria-hidden="true">${eh(initials(nameTxt))}</span>`}${it.isNew ? `<span class="${C(V, 'newb')}">${V.t('pt.new')}</span>` : ''}</div>`;
    const ver = it.verified ? `<details class="${C(V, 'ver')}"><summary${V.attr('title', (l) => V.tl('pt.verified', l))}>${V.icon('check')}<span class="${C(V, 'sr')}">${V.t('pt.verified')}</span></summary><span class="${C(V, 'verp')}">${V.t('pt.verifiedHint')}</span></details>` : '';
    const tier = V.has(it.tier) ? badge(V, 'tier', V.f(`items.${i}.tier`, 'line', 'span', '')) : '';
    const role = V.f(`items.${i}.role`, 'line', 'p', C(V, 'role'));
    const areas = V.has(it.areas) ? `<p class="${C(V, 'areas')}">${V.per((l) => splitList(V.plain(it.areas, l)).map(eh).join(' · '))}</p>` : '';
    const facts = [];
    if (V.has(it.city)) facts.push(`<li>${V.icon('pin')}${V.f(`items.${i}.city`, 'line', 'span', '')}</li>`);
    if (it.years) facts.push(`<li>${V.t('pt.years', { n: it.years })}</li>`);
    if (it.rating) facts.push(`<li>${stars(V, it.rating)} <b>${eh(String(Math.round(it.rating * 10) / 10))}</b>${it.reviews ? ` <span class="${C(V, 'muted')}">(${V.t('pt.reviews', { n: it.reviews })})</span>` : ''}<span class="${C(V, 'sr')}">${V.t('pt.rating', { r: it.rating })}</span></li>`);
    if (V.has(it.langs)) facts.push(`<li><span class="${C(V, 'sr')}">${V.t('pt.langs')}:</span>${V.icon('globe')}${V.per((l) => eh(splitList(V.plain(it.langs, l)).join(', ')))}</li>`);
    if (it.status && it.status !== 'available') facts.push(`<li>${badge(V, it.status, V.t('pt.status.' + it.status))}</li>`);
    const badges = V.has(it.badges) ? `<p class="${C(V, 'chips')}">${V.per((l) => splitList(V.plain(it.badges, l)).map((x) => `<span class="${C(V, 'chip')}">${eh(x)}</span>`).join(''))}</p>` : '';
    const bio = variant !== 'compact' && V.has(it.bio) ? `<div class="${C(V, 'bio', variant === 'cards' ? 'clamp' : '')}">${V.per((l) => V.longIn(it.bio, l))}</div>` : '';
    const pp = priceParts(it.priceKind, it.price, cur, V.lang);
    const price = pp ? `<span class="${C(V, 'price')}">${V.per((l) => eh(V.tl(pp.key, l, priceParts(it.priceKind, it.price, cur, l).vars)))}<small>${V.t('pt.consult')}</small></span>` : '';
    const L = V.link(it.href);
    const cta = L ? `${V.a(L.href, C(V, 'btn'))}${V.has(b.cta) ? V.f('cta', 'line', 'span', '') : V.t('pt.profile')}</a>` : '';
    const f = [`kind:${kind}`, ...(areaF.ids.get(it) || []).map((x) => 'area:' + x), ...(cityF.ids.get(it) || []).map((x) => 'city:' + x), ...(langF.ids.get(it) || []).map((x) => 'lang:' + x)];
    const v = { name: sortVal(V, it.name), rating: Number(it.rating) || 0, years: Number(it.years) || 0, price: it.price == null ? null : Number(it.price), rec: recommendScore(it) };
    const data = listOn ? ` data-pt-i data-pt-s="${ea(searchText(V, [it.name, it.role, it.areas, it.city, it.langs, it.badges, it.tier]))}" data-pt-f="${ea(f.join(' '))}" data-pt-v="${ptJSON(v)}"` : '';
    return `<article class="${C(V, 'card', 'pc', 'k-' + kind)}" id="${ea(a)}"${data}${V.di(i)}>${ph}<div class="${C(V, 'cb')}">`
      + `<h3 class="${C(V, 'cn')}">${V.f(`items.${i}.name`, 'line', 'span', '')}${ver}${tier}</h3>${role}${areas}${facts.length ? `<ul class="${C(V, 'facts')}">${facts.join('')}</ul>` : ''}${badges}${bio}${contactsHTML(V, it, b.contacts || 'masked')}</div>`
      + (price || cta ? `<div class="${C(V, 'cf')}">${price}${cta}</div>` : '') + '</article>';
  };
  const tools = [];
  if (listOn) {
    const kk = Object.keys(kinds);
    if (b.tabs !== false && kk.length > 1) {
      tools.push(`<div class="${C(V, 'tabs')}" role="group"><button type="button" class="${C(V, 'tab')}" data-pt-tab="" aria-pressed="true">${V.t('pt.all')} <span>${items.length}</span></button>`
        + ['person', 'firm', 'org'].filter((k) => kinds[k]).map((k) => `<button type="button" class="${C(V, 'tab')}" data-pt-tab="kind:${k}" aria-pressed="false">${V.t('pt.tab.' + k)} <span>${kinds[k]}</span></button>`).join('') + '</div>');
    }
    if (b.find !== false) tools.push(searchBox(V, 'pt.searchPh'));
    if (b.facetArea !== false) tools.push(selectFacet(V, 'area', 'pt.facet.area', areaF));
    if (b.facetCity !== false) tools.push(selectFacet(V, 'city', 'pt.facet.city', cityF));
    if (b.facetLang) tools.push(selectFacet(V, 'lang', 'pt.facet.lang', langF));
    if (b.sort !== false) tools.push(sortSelect(V, [['rec:d', 'pt.sort.rec'], ['name:a', 'pt.sort.az'], ['rating:d', 'pt.sort.rating'], ['years:d', 'pt.sort.years'], ['price:a', 'pt.sort.price']]));
  }
  const more = listOn ? Math.max(0, Number(b.more) || 0) : 0;
  let body;
  let nav = '';
  if (b.alpha && items.length > 1) {
    const base = 'az-' + b.id;
    const idx = alphaIndex(items.map((it, i) => ({ it, i })), { lang: V.lang, text: (x) => V.plain(x.it.name, V.lang) });
    nav = alphaNav(V, idx, base, false);
    body = idx.groups.map((g) => `<section class="${C(V, 'letter')}" id="${ea(base + '-' + g.id)}" data-pt-g><h3 class="${C(V, 'lh')}"><span>${eh(g.key === '#' ? V.tl('pt.az.other', V.lang) : g.key)}</span></h3><div class="${C(V, 'grid', 'v-' + variant)}">${g.items.map((x) => card(x.it, x.i)).join('')}</div></section>`).join('');
  } else body = `<div class="${C(V, 'grid', 'v-' + variant)}">${items.map(card).join('')}</div>`;
  const cols = Math.max(1, Math.min(4, Number(b.columns) || 3));
  return rootOpen(V, b, 'dir', ['v-' + variant], (listOn ? ' data-pt-list' : '') + (more ? ` data-pt-page="${more}"` : '') + ` style="--pt-cols:${cols}"`)
    + headHTML(V, b, '') + toolsHTML(V, tools, items.length) + nav + `<div class="${C(V, 'items')}" data-pt-items>${body}</div>${listOn ? emptyMore(V, more > 0) : ''}</div>`;
}

/* ---------- requests board ---------- */

function relDay(V, day, mode) {
  if (!day) return '';
  const today = V.today;
  if (mode === 'ago') {
    const n = daysSince(day, today);
    if (n == null) return '';
    const txt = (l) => (n <= 0 ? V.tl('pt.rq.today', l) : V.tl('pt.rq.posted', l, { n }));
    return `<time datetime="${ea(day)}" data-pt-rel="ago">${V.per((l) => eh(txt(l)))}</time>`;
  }
  const n = daysUntil(day, today);
  if (n == null) return '';
  const txt = (l) => (n < 0 ? V.tl('pt.rq.ended', l) : n === 0 ? V.tl('pt.rq.closesToday', l) : V.tl('pt.rq.closesIn', l, { n }));
  return `<time class="${C(V, n <= 3 ? 'warn' : '')}" datetime="${ea(day)}" data-pt-rel="until">${V.per((l) => eh(txt(l)))}</time>`;
}

// Requests board. Relative dates are rendered at export time and recomputed by the runtime on the visitor's day (ptBase relTimes).
function boardHTML(b, V) {
  const items = arr(b.items);
  const cat = V.cat;
  const variant = b.variant || 'cards';
  const cur = String(V.plain(b.currency, V.lang) || 'GEL').toUpperCase();
  const listOn = !V.edit && items.length > 1;
  const catF = facetOptions(items, (it, l) => splitList(V.plain(it.category, l)), { langs: V.langs, lang: V.lang });
  const cityF = facetOptions(items, (it, l) => [it.remote ? V.tl('pt.rq.remote', l) : V.plain(it.city, l)].filter(Boolean), { langs: V.langs, lang: V.lang });
  const statusF = { options: ['open', 'progress', 'closed'].filter((s) => items.some((it) => (it.status || 'open') === s)).map((s) => ({ id: s, n: items.filter((it) => (it.status || 'open') === s).length, label: Object.fromEntries(V.langs.map((l) => [l, V.tl('pt.rq.status.' + s, l)])) })) };
  const cap = Math.max(0, Number(b.cap) || 0);
  const matchN = Math.max(0, Number(b.match) || 0);
  if (!V.edit) V.need('pt.rq.posted', 'pt.rq.today', 'pt.rq.closesIn', 'pt.rq.closesToday', 'pt.rq.ended');
  const open = items.filter((it) => (it.status || 'open') === 'open').length;
  const card = (it, i) => {
    const st = it.status || 'open';
    const a = (cat && cat.anchor(b.id, i)) || 'rq-' + slugId(V.plain(it.title, V.lang), 'x' + i);
    const bp = budgetParts(it.budgetKind, it.budget, it.budgetMax, cur, V.lang);
    const budget = V.per((l) => eh(V.tl(bp.key, l, budgetParts(it.budgetKind, it.budget, it.budgetMax, cur, l).vars)));
    const meta = [`<div><dt>${V.t('pt.rq.budget')}</dt><dd class="${C(V, bp.key === 'pt.budget.unsure' ? 'muted' : 'money')}">${budget}</dd></div>`];
    if (it.remote || V.has(it.city)) meta.push(`<div><dt class="${C(V, 'sr')}">${V.t('pt.facet.city')}</dt><dd>${V.icon('pin')}${it.remote ? V.t('pt.rq.remote') : V.f(`items.${i}.city`, 'line', 'span', '')}</dd></div>`);
    if (it.posted) meta.push(`<div><dt class="${C(V, 'sr')}">·</dt><dd>${V.icon('clock')}${relDay(V, it.posted, 'ago')}</dd></div>`);
    if (it.closes && st === 'open') meta.push(`<div><dt class="${C(V, 'sr')}">·</dt><dd>${relDay(V, it.closes, 'until')}</dd></div>`);
    const nResp = Math.max(0, Number(it.responses) || 0);
    const resp = st === 'open' ? `<p class="${C(V, 'resp', nResp ? '' : 'resp0')}">${nResp ? (cap ? V.t('pt.rq.resp', { n: Math.min(nResp, cap), max: cap }) : V.t('pt.rq.respN', { n: nResp })) : V.t('pt.rq.resp0')}</p>` : '';
    let match = '';
    if (matchN && cat && st !== 'closed') {
      const req = cat.requests.find((r) => r.block === b && r.item === it);
      const ms = req ? cat.match(req, matchN, V.lang) : [];
      if (ms.length) {
        match = `<div class="${C(V, 'match')}"><span class="${C(V, 'matchh')}">${V.t('pt.rq.match')}:</span> ` + ms.map((m) => {
          const e = m.entry;
          const img = e.item.photo ? V.img(e.item.photo, { cls: C(V, 'avi'), alt: '' }) : `<span class="${C(V, 'avi', 'ph0')}" aria-hidden="true">${eh(initials(e.title(V.lang)))}</span>`;
          return `${V.a(e.href, C(V, 'mini'))}${img}<span>${V.per((l) => eh(e.title(l)))}</span></a>`;
        }).join('') + '</div>';
      }
    }
    const L = V.link(it.href);
    const cta = L && st === 'open' ? `${V.a(L.href, C(V, 'btn', 'btn-sm'))}${V.t('pt.rq.respond')}</a>` : '';
    const body = V.has(it.body) ? `<div class="${C(V, 'rqb', variant === 'cards' ? 'clamp' : '')}">${V.per((l) => enrich(V, V.longIn(it.body, l), l, { xrefs: true, terms: false }))}</div>` : '';
    const author = V.has(it.author) ? `<span class="${C(V, 'muted')}">${V.f(`items.${i}.author`, 'line', 'span', '')}</span>` : '';
    const f = [`status:${st}`, ...(catF.ids.get(it) || []).map((x) => 'category:' + x), ...(cityF.ids.get(it) || []).map((x) => 'city:' + x)];
    const v = { title: sortVal(V, it.title), posted: it.posted || '', closes: st === 'open' && it.closes ? it.closes : null, budget: Number(it.budgetMax || it.budget) || null };
    const data = listOn ? ` data-pt-i data-pt-s="${ea(searchText(V, [it.title, it.body, it.category, it.city, it.author]))}" data-pt-f="${ea(f.join(' '))}" data-pt-v="${ptJSON(v)}"` : '';
    return `<article class="${C(V, 'card', 'rq', 'rs-' + st)}" id="${ea(a)}"${data}${V.di(i)}><div class="${C(V, 'rqh')}">${badge(V, st, V.t('pt.rq.status.' + st))}`
      + `${V.has(it.category) ? `<span class="${C(V, 'cat')}">${V.f(`items.${i}.category`, 'line', 'span', '')}</span>` : ''}</div>`
      + `<h3 class="${C(V, 'cn')}">${V.f(`items.${i}.title`, 'line', 'span', '')}</h3>${body}<dl class="${C(V, 'rqm')}">${meta.join('')}</dl>${resp}${match}`
      + (cta || author ? `<div class="${C(V, 'cf')}">${author}${cta}</div>` : '') + '</article>';
  };
  const tools = [];
  if (listOn) {
    if (b.find !== false) tools.push(searchBox(V, 'pt.searchPh'));
    if (b.facetCategory !== false) tools.push(selectFacet(V, 'category', 'pt.facet.category', catF));
    if (b.facetCity !== false) tools.push(selectFacet(V, 'city', 'pt.facet.city', cityF));
    if (b.facetStatus !== false) tools.push(selectFacet(V, 'status', 'pt.facet.status', statusF));
    if (b.sort !== false) tools.push(sortSelect(V, [['posted:d', 'pt.sort.new'], ['closes:a', 'pt.sort.closes'], ['budget:d', 'pt.sort.budget'], ['title:a', 'pt.sort.az']]));
  }
  const L = V.link(b.ctaHref);
  const top = `<div class="${C(V, 'rqtop')}"><p class="${C(V, 'big')}"><b>${open}</b> ${V.per((l) => eh(V.tl('pt.rq.openN', l, { n: open }).replace(/^\s*\d+\s*/, '')))}</p>`
    + (L ? `${V.a(L.href, C(V, 'btn'))}${V.has(b.cta) ? V.f('cta', 'line', 'span', '') : V.t('pt.rq.respond')}</a>` : '') + '</div>';
  const more = listOn ? Math.max(0, Number(b.more) || 0) : 0;
  return rootOpen(V, b, 'board', ['v-' + variant], (listOn ? ' data-pt-list' : '') + (more ? ` data-pt-page="${more}"` : ''))
    + headHTML(V, b, '') + top + toolsHTML(V, tools, items.length)
    + `<div class="${C(V, 'items')}" data-pt-items><div class="${C(V, 'grid', 'v-' + variant)}">${items.map(card).join('')}</div></div>${listOn ? emptyMore(V, more > 0) : ''}${V.edit ? '' : ''}</div>`;
}

/* ---------- topic hub ---------- */

const HUB_ORDER = ['act', 'article', 'term', 'person', 'firm', 'org', 'request', 'check', 'page'];

function hubHTML(b, V) {
  const cat = V.cat;
  const limit = Math.max(1, Number(b.limit) || 6);
  const items = arr(b.items);
  const topicSet = V.has(b.topic);
  const inner = V.per((l) => {
    if (topicSet) {
      const tp = cat ? cat.topic(V.plain(b.topic, l), l) : { groups: {} };
      const extra = V.extraTopic ? V.extraTopic(V.plain(b.topic, l), l) : {};
      const groups = { ...tp.groups, ...extra };
      const types = HUB_ORDER.filter((x) => groups[x] && groups[x].length);
      if (!types.length) return `<p class="${C(V, 'empty')}">${eh(V.tl('pt.hub.empty', l))}</p>`;
      const stats = b.stats !== false ? `<dl class="${C(V, 'stats')}">${types.map((x) => `<div><dt>${eh(V.tl('pt.hub.' + x, l))}</dt><dd>${groups[x].length}</dd></div>`).join('')}</dl>` : '';
      const secs = types.map((x) => {
        const list = groups[x];
        const lis = list.slice(0, limit).map((h) => `<li>${h.href ? V.a(h.href, '') : '<span>'}${eh(h.title)}${h.href ? '</a>' : '</span>'}${h.sub ? `<small>${eh(excerpt(h.sub, 90))}</small>` : ''}</li>`).join('');
        return `<section class="${C(V, 'hs', 'hs-' + x)}"><h3 class="${C(V, 'h3')}">${eh(V.tl('pt.hub.' + x, l))} <span class="${C(V, 'pill')}">${list.length}</span></h3><ul class="${C(V, 'hl')}">${lis}</ul>${list.length > limit ? `<p class="${C(V, 'muted')}">+${list.length - limit}</p>` : ''}</section>`;
      }).join('');
      return stats + `<div class="${C(V, 'hgrid')}">${secs}</div>`;
    }
    // Index: curated tiles, or every topic of the site with its counts.
    const all = cat ? cat.topics(l) : [];
    const tiles = items.length ? items.map((it, i) => {
      const t = cat ? cat.topic(V.plain(it.topic || it.title, l), l) : { groups: {} };
      const n = Object.values(t.groups).reduce((s, g) => s + g.length, 0);
      const L = V.link(it.href);
      const inner2 = `<span class="${C(V, 'tile-t')}">${V.lineIn(it.title, l)}</span>${V.plain(it.text, l) ? `<span class="${C(V, 'tile-x')}">${eh(V.plain(it.text, l))}</span>` : ''}<span class="${C(V, 'tile-n')}">${eh(V.tl('pt.hub.items', l, { n }))}</span>`;
      return L ? `${V.a(L.href, C(V, 'tile'), V.di(i))}${inner2}</a>` : `<div class="${C(V, 'tile')}"${V.di(i)}>${inner2}</div>`;
    }).join('') : all.slice(0, limit * 4).map((tp) => `<div class="${C(V, 'tile')}"><span class="${C(V, 'tile-t')}">${eh(tp.label)}</span><span class="${C(V, 'tile-n')}">${eh(V.tl('pt.hub.items', l, { n: tp.n }))}</span></div>`).join('');
    return tiles ? `<div class="${C(V, 'tiles')}">${tiles}</div>` : `<p class="${C(V, 'empty')}">${eh(V.tl('pt.hub.empty', l))}</p>`;
  }, true);
  const over = topicSet ? `<p class="${C(V, 'over')}">${V.t('pt.hub.topics')}</p>` : '';
  const title = V.f('title', 'line', 'h2', C(V, 'h')) || (topicSet ? `<h2 class="${C(V, 'h')}">${V.f('topic', 'line', 'span', '')}</h2>` : '');
  const lead = V.has(b.lead) ? `<div class="${C(V, 'lead', 'rich')}">${V.per((l) => V.longIn(b.lead, l))}</div>` : '';
  return rootOpen(V, b, 'hub', [topicSet ? 'topic' : 'index']) + `<header class="${C(V, 'head')}">${over}${title}${lead}</header>${inner}</div>`;
}

/* ---------- checklist ---------- */

function checklistHTML(b, V) {
  const items = arr(b.items);
  const cat = V.cat;
  const tips = new Set();
  const total = items.filter((it) => !it.group).length;
  const key = 'ck:' + b.id;
  const prog = b.progress !== false && total && !V.edit;
  if (!V.edit) { V.feature('ptcheck'); V.need('pt.ck.progress'); }
  const lis = items.map((it, i) => {
    if (it.group) return `<li class="${C(V, 'ckg')}"${V.di(i)}>${V.f(`items.${i}.label`, 'line', 'h3', C(V, 'h3'))}</li>`;
    const a = (cat && cat.anchor(b.id, i)) || 'ck-' + slugId(V.plain(it.label, V.lang), 'x' + i);
    const body = V.has(it.body) ? `<div class="${C(V, 'ckb', 'rich')}">${V.per((l) => enrich(V, V.longIn(it.body, l), l, { tips, seen: new Map() }))}</div>` : '';
    const due = V.has(it.due) ? `<p class="${C(V, 'ckm')}"><span>${V.t('pt.ck.due')}:</span> ${V.f(`items.${i}.due`, 'line', 'span', '')}</p>` : '';
    const ref = V.has(it.ref) ? `<p class="${C(V, 'ckm')}"><span>${V.t('pt.ck.ref')}:</span> ${V.per((l) => enrich(V, V.lineIn(it.ref, l), l, { terms: false }))}</p>` : '';
    return `<li class="${C(V, 'cki')}" id="${ea(a)}"${V.di(i)}><label class="${C(V, 'ckl')}"><input type="checkbox" data-pt-ck="${ea(a)}"${V.edit ? ' disabled' : ''}> <span>${V.f(`items.${i}.label`, 'line', 'span', '')}</span></label>${body}${due}${ref}</li>`;
  }).join('');
  const bar = prog ? `<div class="${C(V, 'prog', 'js')}"><progress max="${total}" value="0" data-pt-prog></progress><span data-pt-progt>${V.t('pt.ck.progress', { n: 0, total })}</span>`
    + `<button type="button" class="${C(V, 'link')}" data-pt-ck-reset>${V.t('pt.ck.reset')}</button></div>` : '';
  const lead = V.has(b.lead) ? `<div class="${C(V, 'lead', 'rich')}">${V.per((l) => enrich(V, V.longIn(b.lead, l), l, { tips, seen: new Map() }))}</div>` : '';
  const saved = b.persist !== false && !V.edit ? `<p class="${C(V, 'muted', 'small', 'js')}">${V.t('pt.ck.saved')}</p>` : '';
  return rootOpen(V, b, 'ck', [], V.edit ? '' : ` data-pt-check="${ea(key)}"${b.persist !== false ? ' data-pt-persist' : ''}`)
    + headHTML(V, b, '') + lead + bar + `<ol class="${C(V, 'ckl-list')}">${lis}</ol>${saved}${tipsHTML(V, tips)}</div>`;
}

/* ---------- unified search ---------- */

// Unified search: the whole site index is embedded as JSON in <script type="application/json">. "<" is escaped
// as \u003c (no </script> breakout) and U+2028 / U+2029 are escaped (they were invalid in JS strings before ES2019).
function finderHTML(b, V) {
  const cat = V.cat;
  const limit = Math.max(5, Number(b.limit) || 20);
  const sugg = V.has(b.suggest) ? `<p class="${C(V, 'sugg')}"><span>${V.t('pt.find.try')}</span> ${V.per((l) => splitList(V.plain(b.suggest, l)).map((q) => (V.searchHref ? `${V.a(V.searchHref(q), C(V, 'chip'))}${eh(q)}</a>` : `<button type="button" class="${C(V, 'chip')}" data-pt-fs="${ea(q)}">${eh(q)}</button>`)).join(''))}</p>` : '';
  // Hosts with a search page of their own (knowledge) submit the form there; the others carry an index.
  if (V.searchForm) {
    return rootOpen(V, b, 'find', ['form']) + headHTML(V, b, '') + V.searchForm({ placeholder: (l) => V.plain(b.placeholder, l) || V.tl('pt.find.hint', l) }) + sugg + '</div>';
  }
  if (V.edit) {
    return rootOpen(V, b, 'find', []) + headHTML(V, b, '') + `<div class="${C(V, 'ff')}"><span class="${C(V, 'qi')}">${V.has(b.placeholder) ? V.f('placeholder', 'line', 'span', '') : V.t('pt.find.hint')}</span><span class="${C(V, 'btn')}">${V.t('pt.search')}</span></div>${sugg}</div>`;
  }
  V.feature('ptfind');
  V.need('pt.count', 'pt.none', 'pt.find.inArts', 'pt.all', 'pt.find.groups');
  for (const x of HUB_ORDER) V.need('pt.hub.' + x);
  const ix = {};
  for (const l of V.langs) {
    ix[l] = (cat ? cat.entries(l) : []).concat(V.extraEntries ? V.extraEntries(l) : [])
      .map((e) => [e.type, e.title, String(e.text || '').slice(0, 1600), e.href, e.sub || '', e.group ? e.group.key : '', e.group ? e.group.label : '']);
  }
  const json = JSON.stringify(ix).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16));
  return rootOpen(V, b, 'find', [], ` data-pt-find data-pt-limit="${limit}"${b.tabs === false ? ' data-pt-notabs' : ''}`) + headHTML(V, b, '')
    + `<form class="${C(V, 'ff', 'js')}" role="search" data-pt-ff><label class="${C(V, 'q')}"><span class="${C(V, 'sr')}">${V.t('pt.search')}</span>${V.icon('search')}`
    + `<input type="search" class="${C(V, 'qi')}" data-pt-fq autocomplete="off"${V.attr('placeholder', (l) => V.plain(b.placeholder, l) || V.tl('pt.find.hint', l))}${V.attr('aria-label', (l) => V.tl('pt.search', l))}></label>`
    + `<button type="submit" class="${C(V, 'btn')}">${V.t('pt.search')}</button></form>${sugg}`
    + `<div class="${C(V, 'ftabs', 'js')}" data-pt-ftabs role="group" hidden></div><p class="${C(V, 'count')}" data-pt-fcount role="status" aria-live="polite"></p>`
    + `<div class="${C(V, 'fgroups')}" data-pt-fgroups hidden></div><ol class="${C(V, 'fres')}" data-pt-fres></ol>`
    + `<script type="application/json" data-pt-ix>${json}</script></div>`;
}

export const PT_RENDER = { act: actHTML, terms: termsHTML, directory: directoryHTML, board: boardHTML, hub: hubHTML, checklist: checklistHTML, finder: finderHTML };
// For hosts that link terms and references in their own texts too (knowledge: every text block of a page).
export { bodyHTML, docCard, enrich as enrichHTML, tipsHTML };
