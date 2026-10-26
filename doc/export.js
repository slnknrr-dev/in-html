// doc/export.js - one self-contained HTML file from a document.
//
//   exportHTML(doc, { mode: 'clean' | 'packed', minify, embedSource, source, langs, defaultLang, preview,
//                     assetURL, files })
//     -> { html, bytes, report, css?, js? }
//   extractSource(htmlText) -> normalized doc embedded by `embedSource`, or null
//
// Multi-file exports (archives): assetURL(attachment) -> relative URL | '' keeps attachments as files next to the
// page (images get that URL, no store script is written, cfg.atts[id] gains the URL as a third element for the
// product's runtime); files = { css: 'assets/site.css', js: 'assets/site.js' } links the stylesheet / runtime instead
// of inlining them and returns their text as `css` / `js`.
//
// Clean: readable HTML that works without JavaScript (default language shown). Packed: the clean document deflated
// and base64-encoded, inflated on open by a tiny bootstrap. The exporter renders the view once, derives the usage,
// then writes only the CSS, runtime, UI strings, icons and attachment data the page uses. Product hooks
// (P.exportHooks): title(doc, lang, ctx), desc(doc, lang, ctx) (plain-text description; default: meta description),
// langCSS(doc, lang) (per-language head CSS, switched by the i18n runtime),
// toolbar(ctx, use), head(ctx, use), bodyEnd(ctx, use), aria(ctx, use, langs, put), cfg(cfg, ctx, use, langs),
// report(report, ctx, use).
import { b64decode, b64encode, isB64 } from '../codec/base64.js';
import { deflate, inflate } from '../codec/deflate.js';
import { langDir } from '../i18n/lang.js';
import { htmlToText, pickText } from '../i18n/text.js';
import { escapeAttr, escapeHTML } from '../html/escape.js';
import { minifyCSS } from '../minify/css.js';
import { minifyJS } from '../minify/js.js';
import { isObj, own } from '../util/value.js';
import { BLOCK_TYPES, P } from './product.js';
import { uiText } from './dict.js';
import { normalizeDoc } from './model.js';
import { finishUsage, renderInternal } from './render.js';
import { buildRuntime, featureClosure, fnSource, rtBoot } from './runtime.js';

// Escapers for text embedded in raw-text elements. The HTML tokenizer ends <script> at the first "</script" in any
// case, whatever JS or JSON syntax surrounds it, so it must be broken up ("<\/script" means the same in JS strings).
// "<!--" inside a script can switch the tokenizer into the double-escaped state and swallow the closing tag.
// jsonSafe: \u003c removes every '<'; U+2028/2029 are escaped for engines where they were illegal in JS strings.
export const utf8len = (s) => new TextEncoder().encode(s).length;
export const scriptSafe = (s) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
export const jsonSafe = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16));
const styleSafe = (s) => s.replace(/<\/(style)/gi, '<\\/$1');

// Minimal CSS of the packed shell, shown only for the no-JS message before the real page replaces it. Raw colours are
// fine here: no theme exists yet at that point.
const shellCSS = (p) => 'body{margin:0;font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Georgian",Sylfaen,sans-serif;color:#374151;background:#f3f4f6}'
  + `.${p}-nojs{max-width:36em;margin:18vh auto;padding:0 20px;text-align:center}`;

function defaultTitle(doc, lang) {
  return htmlToText(pickText(doc.meta && doc.meta.title, lang, doc)) || doc.name || P.name;
}

// Pipeline: normalize -> render once (collects usage) -> per-language head data -> CSS shaken by usage -> attachment
// store -> runtime + cfg -> assemble. Rendering before building CSS/JS is the key decision: usage is a fact of the
// actual output, not a guess from the document, so nothing unused is shipped.
export async function exportHTML(doc, opts = {}) {
  const p = P.prefix;
  const H = P.exportHooks || {};
  const d = normalizeDoc(doc);
  const mode = opts.mode === 'packed' ? 'packed' : 'clean';
  const minify = opts.minify !== false;
  let langs = Array.isArray(opts.langs) && opts.langs.length ? d.langs.filter((l) => opts.langs.includes(l)) : d.langs.slice();
  if (!langs.length) langs = d.langs.slice();
  const defaultLang = langs.includes(opts.defaultLang) ? opts.defaultLang
    : langs.includes(d.defaultLang) ? d.defaultLang : langs[0];

  // Every export option reaches the render context (P.makeCtx may read product options such as an API mode).
  const { html: body, ctx } = renderInternal(d, { ...opts, attURL: null, mode: 'view', langs, defaultLang, preview: !!opts.preview });
  const fileOf = (a) => (ctx.assetURL && a ? String(ctx.assetURL(a) || '') : '');
  const split = isObj(opts.files) ? opts.files : null;
  ctx.preview = !!opts.preview;
  const use = finishUsage(ctx);
  const toolbar = H.toolbar ? H.toolbar(ctx, use) : '';
  const extraBody = H.bodyEnd ? H.bodyEnd(ctx, use) : '';
  if (toolbar || extraBody) finishUsage(ctx); // page chrome may record more usage (icons, features)
  const pd = ctx.pd;
  const multi = langs.length > 1;

  // Head data per language.
  const titles = {};
  const descs = {};
  const langCSS = {};
  let anyLangCSS = false;
  for (const l of langs) {
    titles[l] = (H.title || defaultTitle)(pd, l, ctx);
    descs[l] = H.desc ? String(H.desc(pd, l, ctx) || '') : htmlToText(pickText(d.meta.description, l, pd));
    langCSS[l] = H.langCSS ? H.langCSS(pd, l) : '';
    if (langCSS[l]) anyLangCSS = true;
  }

  let css = P.buildCSS(d, { mode: 'view', usage: use, preview: !!opts.preview });
  // Minifiers are optional optimisations: on any failure the readable text ships, never a broken or empty one.
  if (minify) { try { css = minifyCSS(css); } catch (e) { /* keep readable CSS */ } }
  css = styleSafe(css);

  // Attachment store (non-inline data referenced by buttons / previews).
  let store = '';
  let attBytes = 0;
  for (const id of use.store) {
    const a = d.attachments[id];
    if (!isB64(a.data)) continue; // never write anything but base64 into the store script
    if (fileOf(a)) continue; // a file next to the page (cfg.atts carries its URL)
    // Non-JS type: the browser never executes or parses it, and its text is raw (no entity decoding), so base64
    // costs nothing extra. Fetched by the runtime only when the user opens the attachment.
    store += `<script type="application/octet-stream" id="${p}-att-${id}" data-mime="${escapeAttr(a.mime)}" data-name="${escapeAttr(a.name)}">${a.data}</script>\n`;
    attBytes += a.data.length;
  }
  // Inline images are counted once per embedded copy (each copy carries the data URI).
  for (const id of use.imgInline) attBytes += (d.attachments[id] && d.attachments[id].data || '').length * (use.imgInlineCount.get(id) || 1);

  // Runtime + config.
  // Previews (template thumbnails) of products that ask for it carry no runtime at all.
  const features = opts.preview && H.previewNoScript ? new Set() : use.features;
  let js = '';
  let cfgScript = '';
  if (features.size) {
    const cfg = { v: P.version, id: d.id, langs, defaultLang, autodetect: d.output.autodetect, scheme: d.theme.scheme };
    if (multi) {
      cfg.titles = titles;
      cfg.descs = descs;
      // Identical head CSS in every language: the static style element is enough (the runtime leaves it alone).
      if (anyLangCSS && new Set(Object.values(langCSS)).size > 1) cfg.pageCSS = langCSS;
      const rtl = langs.filter((l) => langDir(l) === 'rtl');
      if (rtl.length) { cfg.dirs = {}; for (const l of rtl) cfg.dirs[l] = 'rtl'; }
    }
    if (use.blob.size) {
      cfg.atts = {};
      for (const id of use.blob) {
        const a = d.attachments[id];
        const f = fileOf(a);
        cfg.atts[id] = f ? [a.name, a.mime, f] : [a.name, a.mime];
      }
    }
    // Accessible labels the runtime sets (it carries no UI text of its own).
    const aria = {};
    const put = (l, k, v) => { (aria[l] || (aria[l] = {}))[k] = v; };
    if (H.aria) H.aria(ctx, use, langs, put);
    if (Object.keys(aria).length) cfg.aria = aria;
    if (H.cfg) H.cfg(cfg, ctx, use, langs);
    // Only the core runtime reads the config.
    if (features.has('core')) cfgScript = `<script type="application/json" id="${p}-cfg">${jsonSafe(cfg)}</script>\n`;
    js = buildRuntime(features);
    if (minify) { try { js = minifyJS(js); } catch (e) { /* keep readable JS */ } }
    js = scriptSafe(js);
  }

  // Embedded editable source (deflate-raw + base64).
  let srcScript = '';
  let srcBytes = 0;
  if (opts.embedSource) {
    const b64 = b64encode(await deflate(JSON.stringify(opts.source || doc)));
    srcScript = `<script type="application/x-${p}-source" id="${p}-source">${b64}</script>\n`;
    srcBytes = b64.length;
  }

  const htmlAttrs = `lang="${escapeAttr(defaultLang)}" dir="${langDir(defaultLang)}" data-${p}="${P.version}"`
    + (H.htmlAttrs ? H.htmlAttrs(ctx, use) : '');
  const anyDesc = langs.some((l) => descs[l]);
  const head = '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    + `<title>${escapeHTML(titles[defaultLang])}</title>`
    + (anyDesc ? `<meta name="description" content="${escapeAttr(descs[defaultLang])}">` : '')
    + (d.meta.author ? `<meta name="author" content="${escapeAttr(d.meta.author)}">` : '')
    + (d.meta.keywords ? `<meta name="keywords" content="${escapeAttr(d.meta.keywords)}">` : '')
    + `<meta name="generator" content="${p} ${P.version}">`
    + (d.theme.scheme === 'auto' ? '<meta name="color-scheme" content="light dark">' : '')
    + (H.head ? H.head(ctx, use, { titles, descs }) : '');

  const cssFile = split && typeof split.css === 'string' && split.css ? split.css : '';
  const jsFile = split && typeof split.js === 'string' && split.js && js ? split.js : '';
  const cleanHead = head + (cssFile ? `\n<link rel="stylesheet" href="${escapeAttr(cssFile)}">` : `\n<style>${css}</style>`)
    + (anyLangCSS ? `<style id="${p}-page-css">${styleSafe(langCSS[defaultLang])}</style>` : '')
    + (toolbar ? `<noscript><style>.${p}-toolbar{display:none}</style></noscript>` : '');
  const jsTag = jsFile ? `<script src="${escapeAttr(jsFile)}"></script>\n` : js ? `<script>${js}</script>\n` : '';
  // Store and cfg come before the runtime script, so the runtime finds them in the DOM synchronously.
  const cleanBody = `${toolbar}${body}\n${extraBody}${store}${cfgScript}${jsTag}`;
  const doctype = `<!doctype html>\n<html ${htmlAttrs}>\n`;

  let html;
  if (mode === 'clean') {
    html = `${doctype}<head>${cleanHead}</head>\n<body>\n${cleanBody}${srcScript}</body>\n</html>\n`;
  } else {
    // Packed: deflate of the whole clean page. Typical rich documents shrink well below the base64 overhead (+33%).
    // The embedded source stays outside the pack so extractSource can find it without inflating the page.
    const inner = `${doctype}<head>${cleanHead}</head>\n<body>\n${cleanBody}</body>\n</html>\n`;
    const pack = b64encode(await deflate(inner));
    const nojs = escapeHTML(uiText('noscript', defaultLang, d));
    let boot = `(${fnSource(rtBoot)})();`;
    if (minify) { try { boot = minifyJS(boot); } catch (e) { /* keep */ } }
    html = `${doctype}<head>${head}<style>${shellCSS(p)}</style></head>\n<body>\n`
      + `<noscript><div class="${p}-nojs">${nojs}</div></noscript>\n<div id="${p}-nojs" class="${p}-nojs" hidden>${nojs}</div>\n`
      + `<script type="application/x-${p}-pack" id="${p}-pack">${pack}</script>\n${srcScript}`
      + `<script>${scriptSafe(boot)}</script>\n</body>\n</html>\n`;
  }

  const report = {
    mode, langs, defaultLang,
    types: [...use.types].filter((t) => own(BLOCK_TYPES, t)).sort(),
    features: featureClosure(features),
    cssBytes: utf8len(css), jsBytes: utf8len(js), attBytes, srcBytes,
    atts: [...use.atts], icons: [...use.icons].sort(),
  };
  if (H.report) H.report(report, ctx, use);
  const res = { html, bytes: utf8len(html), report };
  if (cssFile) res.css = css;
  if (jsFile) res.js = js;
  return res;
}

// The editable source embedded by exportHTML({ embedSource: true }) (current or older product prefixes).
// Regex instead of DOMParser: works in Node, and only one known element is needed. Prefixes are reduced to \w so
// they are safe inside the RegExp. The format check rejects sources of another product with the same prefix family.
// Never throws: a foreign or damaged file is simply "not ours" (null).
export async function extractSource(htmlText) {
  try {
    const ids = [P.prefix, ...(P.legacyPrefixes || [])].map((x) => x.replace(/\W/g, '')).join('|');
    const re = new RegExp(`<script\\b[^>]*\\bid=["']?(?:${ids})-source["']?[^>]*>([\\s\\S]*?)<\\/script\\s*>`, 'i');
    const m = re.exec(String(htmlText || ''));
    if (!m) return null;
    const obj = JSON.parse(await inflate(b64decode(m[1].trim())));
    if (!isObj(obj) || obj.format !== P.format) return null;
    return normalizeDoc(obj);
  } catch (e) {
    return null;
  }
}
