// paper/export.js - export hooks of paper documents: page title, runtime feature selection, the floating toolbar
// (language switch, dark / light, print), per-language accessible labels; the editor's label key list.
//
// Contract: called by the engine exporter (doc/export.js) through exportHooks / finishUsage (paper/product.js). Output is
// HTML strings; every user value is escaped here. The runtime carries no UI text: every visible label is rendered
// now, in the default language, and the per-language variants go into the config JSON via paperAria().
import { langName } from '../i18n/lang.js';
import { htmlToText, pickText } from '../i18n/text.js';
import { escapeAttr, escapeHTML } from '../html/escape.js';
import { FONT_STACKS, LAYOUTS } from './themes.js';
import { walkBlocks } from '../doc/model.js';
import { BLOCK_TYPES, P, THEMES } from '../doc/product.js';
import { uiText } from '../doc/dict.js';
import { icon, ui } from '../doc/render.js';

// Runtime features and floating toolbar of a view render (the engine completes the usage).
// Decides which runtime features ship. Dependencies are resolved here explicitly (i18n/theme/attach need core,
// attach needs blob) instead of a generic resolver: the graph has six nodes and an explicit list is auditable.
// FEATURE_ORDER (runtime.js) then fixes emission order, so 'core' always precedes its users.
// The toolbar exists only if it has something to show; one language means no switcher even if switcher != 'none'.
function finishPaperUsage(ctx) {
  const d = ctx.doc;
  const u = ctx.use;
  const o = d.output;
  const multi = ctx.langs.length > 1;
  const sw = multi && o.switcher !== 'none';
  u.toolbar = sw || o.printButton || o.themeToggle
    ? { switcher: sw ? o.switcher : null, print: !!o.printButton, theme: !!o.themeToggle } : null;
  if (multi) u.features.add('i18n');
  if (o.printButton) u.features.add('print');
  if (o.themeToggle) u.features.add('theme');
  if (u.blob.size || u.zoom) u.features.add('attach');
  if (u.xrefs.size) u.features.add('links');
  const F = u.features;
  if (F.has('i18n') || F.has('theme') || F.has('attach')) F.add('core');
  if (F.has('attach')) F.add('blob');
}

// Page title per language: meta title, else the product's own guess (P.paperTitle: a resume's name and job title),
// else the first heading, else the project name.
function docTitle(doc, lang) {
  const t = htmlToText(pickText(doc.meta.title, lang, doc));
  if (t) return t;
  const own = P.paperTitle ? P.paperTitle(doc, lang) : '';
  if (own) return own;
  let first = '';
  walkBlocks(doc, (b) => { if (!first && !b.hidden && b.type === 'heading') first = htmlToText(pickText(b.text, lang, doc)); });
  return first || doc.name || P.name;
}

// Floating toolbar. role="toolbar" + aria-label groups the controls for AT; language buttons are toggle buttons
// (aria-pressed) rather than links, because switching rewrites the page in place (rtI18n) instead of navigating.
// Each option/button carries lang= so a screen reader pronounces the native language name correctly.
function renderToolbar(ctx, use) {
  const tb = use.toolbar;
  if (!tb) return '';
  const d = ctx.doc;
  const o = d.output;
  const sep = `<span class="${P.prefix}-tb-sep" aria-hidden="true"></span>`;
  let s = '';
  if (tb.switcher === 'select') {
    s += `<select class="${P.prefix}-tb-sel" data-set-lang aria-label="${escapeAttr(uiText('language', ctx.defaultLang, d))}">`
      + ctx.langs.map((l) => `<option value="${escapeAttr(l)}" lang="${escapeAttr(l)}"${l === ctx.defaultLang ? ' selected' : ''}>`
        + `${escapeHTML(langName(l, o.langLabels))}</option>`).join('') + '</select>';
  } else if (tb.switcher === 'buttons') {
    // Native labels also carry the code: mid-width desktops show codes to keep the pill small (toolbarCSS).
    const label = (l) => (o.langLabels === 'code' ? escapeHTML(langName(l, 'code'))
      : `<span class="${P.prefix}-tb-ln">${escapeHTML(langName(l))}</span><span class="${P.prefix}-tb-lc" aria-hidden="true">${escapeHTML(langName(l, 'code'))}</span>`);
    s += ctx.langs.map((l) => `<button type="button" class="${P.prefix}-tb-lang" data-set-lang="${escapeAttr(l)}" lang="${escapeAttr(l)}"`
      + ` aria-pressed="${l === ctx.defaultLang}" title="${escapeAttr(langName(l))}">${label(l)}</button>`).join('');
  }
  // Both icons are rendered; CSS shows one depending on the scheme. Swapping markup at runtime would need the icon
  // paths in the runtime, which by design carries no assets.
  if (tb.theme) {
    s += (s ? sep : '') + `<button type="button" class="${P.prefix}-tb-btn" data-${P.prefix}-scheme aria-pressed="false">`
      + `${icon(ctx, 'moon', `${P.prefix}-i-moon`)}${icon(ctx, 'sun', `${P.prefix}-i-sun`)}<span class="${P.prefix}-sr">${ui(ctx, 'theme')}</span></button>`;
  }
  if (tb.print) {
    s += (s ? sep : '') + `<button type="button" class="${P.prefix}-tb-btn" data-${P.prefix}-print>${icon(ctx, 'print')}`
      + `<span class="${P.prefix}-tb-txt">${ui(ctx, 'printDoc')}</span></button>`;
  }
  return `<div class="${P.prefix}-toolbar ${P.prefix}-noprint ${P.prefix}-tb-${o.toolbarPos}" role="toolbar" aria-label="${escapeAttr(uiText('toolbar', ctx.defaultLang, d))}">${s}</div>\n`;
}

// All label keys used by schemas and registries (editor dictionaries must contain them).
// Every label key the schemas and registries reference (re-exported by the apps' viewer.js): the checklist a
// dictionary must cover, else the editor shows a raw key for an untranslated schema field.
// Options are included only when their label looks like a key ('a.b'); literal option texts are not translated.
function labelKeys() {
  const keys = new Set();
  for (const [type, t] of Object.entries(BLOCK_TYPES)) {
    keys.add('b.' + type).add('bd.' + type).add('c.' + t.category);
    for (const f of [...(t.schema || []), ...(t.itemSchema || [])]) {
      if (f.label) keys.add(f.label);
      for (const o of f.options || []) if (/^[a-z]+\./i.test(o.l)) keys.add(o.l);
    }
  }
  for (const k of Object.keys(THEMES)) keys.add('t.' + k);
  for (const k of LAYOUTS) keys.add('l.' + k);
  for (const k of Object.keys(FONT_STACKS)) keys.add('fs.' + k);
  for (const k of P.labelKeys ? P.labelKeys() : []) keys.add(k);
  return [...keys].sort();
}

// Accessible labels the runtime sets: lightbox close button; toolbar / select labels that differ per language (the
// markup has the default language's).
// Only labels that actually differ between languages are emitted: identical values would bloat the config JSON of
// every multilingual export for nothing (rtAttach label() falls back to the default language).
function paperAria(ctx, use, langs, put) {
  const d = ctx.doc;
  const multi = langs.length > 1;
  if (use.zoom && use.features.has('attach')) for (const l of multi ? langs : [ctx.defaultLang]) put(l, 'close', uiText('close', l, d));
  if (multi && use.toolbar) {
    for (const k of use.toolbar.switcher === 'select' ? ['toolbar', 'language'] : ['toolbar']) {
      const vals = langs.map((l) => uiText(k, l, d));
      if (new Set(vals).size > 1) langs.forEach((l, i) => put(l, k, vals[i]));
    }
  }
}

export {
  docTitle,
  finishPaperUsage,
  labelKeys,
  renderToolbar,
  paperAria
};
