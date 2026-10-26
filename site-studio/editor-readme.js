// site-studio/editor-readme.js - Site → README: the README.md the serverless and backend packages carry
// (site-readme.js), shown the way Codeberg / GitHub render it — split, preview or source, with the libraries of the
// README editor (markdown/ GitHub-flavoured Markdown, diagram/ Mermaid, math/ TeX, highlight/) — and editable: a text
// of one's own replaces the generated one (doc.meta.readme), "Generate again" brings it back. Also the importer of
// Markdown files (README.md and the .md files next to it become pages).
import { h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { S } from '../studio/state.js';
import { commit } from '../studio/history.js';
import { section } from '../studio/fields.js';
import { renderDocSettings } from '../studio/right.js';
import { renderGFM } from '../markdown/gfm.js';
import { renderDiagram } from '../diagram/all.js';
import { texToMathML } from '../math/tex.js';
import { highlight, langOf } from '../highlight/highlight.js';
import { escapeHTML } from '../html/escape.js';
import { markdownSite, siteReadme } from './site-readme.js';
import * as V from './viewer.js';

// View state kept at module level, not in the document: survives tab re-renders, never enters undo history.
let mode = 'split';
let target = 'static';

// Every optional renderer is fault-isolated: a broken TeX formula falls back to escaped code instead of throwing and
// blanking the whole preview. Id prefixes keep heading / diagram ids from colliding with the editor's own DOM ids.
function render(text) {
  return renderGFM(text, {
    idPrefix: 'rd-',
    diagram: (src) => renderDiagram(src, { theme: 'neutral', idPrefix: 'rdg-' }).svg,
    math: (tex, display) => { try { return texToMathML(tex, { display: !!display }); } catch { return '<code>' + escapeHTML(tex) + '</code>'; } },
    highlight: (code, lang) => highlight(code, langOf(lang) || lang),
  }).html;
}

// "Own text" is any non-blank doc.meta.readme; blank means "generate". The generator is called with readme forced to
// '' so it cannot echo the stored text back. The package selector is disabled for an own text: the target only
// changes the generated version.
export function dsReadme(body) {
  const own = typeof S.doc.meta.readme === 'string' && S.doc.meta.readme.trim();
  const text = () => (typeof S.doc.meta.readme === 'string' && S.doc.meta.readme.trim() ? S.doc.meta.readme : siteReadme({ ...S.doc, meta: { ...S.doc.meta, readme: '' } }, target));
  const src = h('textarea', { class: 'ed-input ed-textarea ed-mono ss-rd-src', rows: 18, spellcheck: false, 'aria-label': 'README.md' });
  const prev = h('div', { class: 'ss-rd-prev md-body' });
  src.value = text();
  // innerHTML of the GFM renderer's output: the source is the project author's own README, shown to that same author
  // (no cross-user path), so this is not an injection boundary.
  const paint = () => { prev.innerHTML = render(src.value); };
  let tm = 0;
  // 250 ms debounce for both the preview (Markdown + Mermaid rendering is expensive) and the commit; coalesce merges the
  // session into one undo step.
  src.addEventListener('input', () => {
    clearTimeout(tm);
    tm = setTimeout(() => { paint(); commit('doc meta.readme', () => { S.doc.meta.readme = src.value; }, { render: 'none', coalesce: 'doc:readme' }); }, 250);
  });
  const panes = h('div', { class: 'ss-rd ss-rd-' + mode }, src, prev);
  const seg = h('div', { class: 'ed-seg', role: 'group' }, ['split', 'preview', 'source'].map((m) => h('button', { type: 'button', class: 'ed-seg-btn' + (m === mode ? ' ed-on' : ''),
    onclick: (e) => { mode = m; panes.className = 'ss-rd ss-rd-' + m; for (const b of e.currentTarget.parentNode.children) b.classList.toggle('ed-on', b === e.currentTarget); } }, t('rd.' + m))));
  const tg = h('select', { class: 'ed-input', 'aria-label': t('sm.target'), disabled: !!own, onchange: (e) => { target = e.target.value; src.value = text(); paint(); } },
    [['static', 'bx.m.static'], ['backend', 'bx.m.backend'], ['studio', 'bx.m.studio']].map(([v, k]) => h('option', { value: v, selected: v === target }, t(k))));
  const regen = h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => { commit('doc meta.readme', () => { S.doc.meta.readme = ''; }, { render: 'none' }); renderDocSettings(); } }, iconEl('refresh'), t('rd.regen'));
  // Object URL revoked after a delay: revoking synchronously after click() can cancel the download in some browsers.
  const dl = h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => {
    const a = h('a', { href: URL.createObjectURL(new Blob([src.value], { type: 'text/markdown' })), download: 'README.md' });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } }, iconEl('download'), 'README.md');
  body.append(section('ds-readme', 'README.md', h('div', {}, h('p', { class: 'ed-hint' }, t(own ? 'rd.own' : 'rd.intro')), h('div', { class: 'ss-map-tools' }, seg, tg, regen, dl), panes)));
  paint();
}

// File → Open accepts Markdown: one README (pages from its top-level headings) or several .md files (a page each).
// The import language is the UI language only when it is one of the site languages this product ships; otherwise 'en'.
export const MARKDOWN_IMPORTER = {
  accept: '.md,.markdown,text/markdown',
  test: (name) => /\.(md|markdown)$/i.test(name),
  load: (text, name) => markdownSite(V, [{ name, text }], { lang: S.uiLang && /^(en|ru|uk|de|fr|es|ka)$/.test(S.uiLang) ? S.uiLang : 'en' }),
};
