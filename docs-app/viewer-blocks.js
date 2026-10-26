// docs-app/viewer-blocks.js - docs blocks on top of the paper blocks: code (syntax highlighted), table of contents (from the
// document's headings) and checklist.
import { escapeAttr, escapeHTML } from '../html/escape.js';
import { htmlToText, pickText } from '../i18n/text.js';
import { uiText } from '../doc/dict.js';
import { walkBlocks } from '../doc/model.js';
import { addItemBox, blockVisible, di, fld, has, icon, noItems, resolveHref, txt, ui } from '../doc/render.js';
import { numOpts, optList } from '../doc/schema.js';
import { uid } from '../util/id.js';
import { num, oneOf, str } from '../util/value.js';
import { LANGS, highlight, langOf } from '../highlight/highlight.js';
//
// A block type is data + a render function: defaults, a schema the generic property panel renders, i18n field lists
// (which fields hold per-language text) and render(b, ctx) -> HTML string. render runs both in the editor (ctx.edit)
// and in exported pages, so it must escape every user value: fld/txt from doc/render.js escape rich text, plain
// strings go through escapeHTML / escapeAttr here.

const DOCS_BLOCKS = {
  code: {
    category: 'text', icon: 'code', container: false,
    i18nFields: ['caption'],
    defaults: () => ({ code: '', lang: 'js', caption: {}, lineNumbers: false, wrap: false }),
    schema: [
      { key: 'lang', type: 'select', label: 'f.lang', noSeg: true, options: LANGS.map(([v, text]) => ({ v, text })) },
      { key: 'code', type: 'textarea', label: 'f.code', rows: 12, code: true },
      { key: 'lineNumbers', type: 'checkbox', label: 'f.lineNumbers' },
      { key: 'wrap', type: 'checkbox', label: 'f.wrap' },
    ],
    render: renderCode,
  },
  toc: {
    category: 'text', icon: 'list', container: false,
    i18nFields: ['title'],
    defaults: () => ({ title: {}, depth: 3, numbered: true }),
    schema: [
      { key: 'depth', type: 'select', label: 'f.depth', options: numOpts(1, 2, 3, 4) },
      { key: 'numbered', type: 'checkbox', label: 'f.numbered' },
    ],
    render: renderToc,
  },
  checklist: {
    category: 'text', icon: 'check', container: false,
    i18nFields: [], itemI18nFields: ['text'], itemRichFields: { text: 'inline' }, itemLabel: 'text',
    defaults: () => ({ items: [], look: 'boxes' }),
    schema: [{ key: 'look', type: 'select', label: 'f.look', options: optList('boxes', 'strike') }],
    itemSchema: [{ key: 'done', type: 'checkbox', label: 'f.done' }],
    itemDefaults: () => ({ id: uid(), text: {}, done: false }),
    render: renderChecklist,
  },
};

function renderCode(b, ctx) {
  const code = str(b.code).replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  const cap = fld(ctx, b, 'caption', 'plain', 'figcaption', 'dc-code-cap', 'ph.caption', { ecls: 'dc-opt' });
  if (!code) {
    return ctx.edit ? `<figure class="dc-code"><div class="dc-code-ph">${icon(ctx, 'code')}<span>${escapeHTML(uiText('ph.code', ctx.uiLang, ctx.doc))}</span></div>${cap}</figure>` : '';
  }
  const lang = langOf(b.lang);
  let html = highlight(code, lang);
  // highlight() returns escaped, tokenised HTML; wrapping each line in a span gives CSS counters for numbers without
  // putting the numbers into the text (copying code yields clean code).
  // Line numbers: every line is a span (counter in CSS), so copied text stays clean.
  if (b.lineNumbers) html = html.split('\n').map((l) => `<span class="dc-line">${l}</span>`).join('\n');
  // Short language name ("JavaScript / TypeScript" -> "JavaScript") in the top corner, above the first line.
  const label = (LANGS.find(([k]) => k === lang) || ['', ''])[1].split(' / ')[0];
  const head = lang ? `<span class="dc-code-lang" aria-hidden="true">${escapeHTML(label)}</span>` : '';
  return `<figure class="dc-code${b.lineNumbers ? ' dc-code-ln' : ''}${lang ? ' dc-code-tag' : ''}">${head}<pre class="dc-pre${b.wrap ? ' dc-wrap' : ''}"${lang ? ` data-lang="${escapeAttr(lang)}"` : ''}><code>${html}</code></pre>${cap}</figure>`;
}

// Headings (and section titles as top level) down to `depth` that follow the table of contents (the document title
// above it is not listed); a table of contents at the end lists every heading.
function tocEntries(ctx, toc, depth) {
  // Only headings that are visible in the exported page (and actually rendered) are listed, so the TOC never links to a
  // hidden block.
  const all = [];
  let from = -1;
  walkBlocks(ctx.doc, (b) => {
    if (b.id === toc.id) from = all.length;
    if (!ctx.edit && !blockVisible(ctx, b)) return false;
    if (!ctx.edit && !ctx.blockIds.has(b.id)) return false;
    if (b.type === 'heading' && num(b.level, 2, 1, 4) <= depth) all.push({ id: b.id, level: num(b.level, 2, 1, 4), i18n: b.text });
    else if (b.type === 'section' && has(ctx, b.title)) all.push({ id: b.id, level: 1, i18n: b.title });
    return true;
  });
  const out = from >= 0 && from < all.length ? all.slice(from) : all;
  // The shallowest level present becomes level 1 (a document without H1 still gets a flat first level).
  const min = Math.min(...out.map((e) => e.level), 4);
  for (const e of out) e.level -= min - 1;
  return out;
}

function renderToc(b, ctx) {
  const depth = oneOf(b.depth, [1, 2, 3, 4], 3);
  const entries = tocEntries(ctx, b, depth);
  const title = has(ctx, b.title) || ctx.edit
    ? fld(ctx, b, 'title', 'plain', 'h2', 'dc-toc-title dc-hx', 'ph.toc', { keep: true }) : `<h2 class="dc-toc-title dc-hx">${ui(ctx, 'tocTitle')}</h2>`;
  if (!entries.length) return ctx.edit ? `${title}<p class="dc-toc-empty">${escapeHTML(uiText('tocEmpty', ctx.uiLang, ctx.doc))}</p>` : '';
  // Hierarchical numbering (1, 1.1, 1.2, 2 ...): deeper counters reset when a shallower level advances.
  const counters = [0, 0, 0, 0, 0];
  let items = '';
  for (const e of entries) {
    counters[e.level]++;
    for (let k = e.level + 1; k < counters.length; k++) counters[k] = 0;
    const no = b.numbered ? `<span class="dc-toc-no">${counters.slice(1, e.level + 1).join('.')}</span>` : '';
    const text = ctx.edit ? escapeHTML(htmlToText(pickText(e.i18n, ctx.lang, ctx.doc))) : txt(ctx, e.i18n);
    const href = ctx.edit ? '' : resolveHref(ctx, '#b-' + e.id);
    const label = href ? `<a href="${escapeAttr(href)}" class="dc-xref">${text}</a>` : `<span>${text}</span>`;
    items += `<li class="dc-toc-l${e.level}">${no}${label}</li>`;
  }
  return `<nav class="dc-toc${b.numbered ? ' dc-toc-num' : ''}">${title}<ol class="dc-toc-list">${items}</ol></nav>`;
}

function renderChecklist(b, ctx) {
  if (noItems(ctx, b)) return addItemBox(ctx);
  let s = '';
  (b.items || []).forEach((it, i) => {
    const text = fld(ctx, b, `items.${i}.text`, 'inline', 'span', 'dc-ck-t', 'ph.task');
    if (!text && !ctx.edit) return;
    const done = !!it.done;
    const box = `<span class="dc-ck-box${done ? ' dc-on' : ''}" aria-hidden="true">${done ? icon(ctx, 'check') : ''}</span>`;
    // The visual check box is aria-hidden; a visually hidden "Done:" / "To do:" prefix carries the state for screen
    // readers.
    const sr = `<span class="dc-sr">${ui(ctx, done ? 'taskDone' : 'taskOpen')}</span>`;
    s += `<li class="dc-ck-item${done ? ' dc-ck-done' : ''}"${di(ctx, i)}>${box}${sr}${text}</li>`;
  });
  if (!s && !ctx.edit) return '';
  return `<ul class="dc-ck dc-ck-${oneOf(b.look, ['boxes', 'strike'], 'boxes')}">${s}</ul>`;
}

export {
  DOCS_BLOCKS
};
