// contract/compile.js - a template compiled into ONE self-contained HTML file: the fill-in page of that template
// (modifiers, levels, fields, the live preview, the checks and the template's JS validator, print CSS for its page
// size, the language switch among the template's languages, local autosave). No network and no external resources:
// the page carries its CSS, its data and its runtime inline, and a Content-Security-Policy forbids any connection
// (connect-src 'none'), so even a template's validator code cannot reach a server.
//
//   compileTemplate(tpl, { lang, runtime, runtimeKey, withSample, doc, generator }) -> HTML string
//     runtime     the code of contract/page.js bundled for another host (an ES module whose bundle sets
//                 globalThis[Symbol.for(runtimeKey)] — bundle.js assetBundle / `?bundle` URLs); without it the page
//                 is the static contract only (printable, no form)
//     runtimeKey  default 'bundle:page.js'
//     withSample  start from the template's sample values (default: empty fields); doc: start from these values
//   compileStatic(tpl, doc, { lang }) -> HTML string: the filled contract alone (a print / archive copy)
import { escapeAttr, escapeHTML } from '../html/escape.js';
import { formCSS, pageCSS, paperCSS } from './css.js';
import { newDocument, normalizeDoc, normalizeTemplate } from './model.js';
import { renderContract } from './render.js';

// CSP of the fill-in page, delivered by <meta> (a local file has no response headers to carry it).
// - default-src 'none' first: whitelist, not blacklist; any directive forgotten below falls back to "nothing".
// - script-src 'unsafe-inline': the runtime is inlined (one file is the contract). 'unsafe-eval': a template's own JS
//   validator is compiled with new Function / in a blob: worker; without it validators cannot run at all.
//   The risk this opens is bounded by connect-src 'none' + form-action 'none': hostile validator code may compute but
//   cannot exfiltrate (no fetch/XHR/WebSocket/beacon, no form post). img-src keeps only data:/blob:, closing the
//   classic <img src=//evil/?leak> side channel.
// - base-uri 'none': an injected <base> cannot redirect relative URLs; object-src 'none': no plugin content.
// Alternative rejected: nonces/hashes. The runtime bundle varies per build and the page is generated offline;
// computing a hash is possible but 'unsafe-eval' is still needed for validators, so it would buy little.
const CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'";
const ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='6' y='3' width='20' height='26' rx='2' fill='%23fff' stroke='%232563eb' stroke-width='2'/%3E%3Cpath d='M10 10h12M10 15h12M10 20h7' stroke='%232563eb' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E";
// Favicon as a data: URI: img-src permits data:, and an external file would break the one-file contract.
// JSON inside <script type="application/json">: the HTML tokenizer ends a script at "</script" and enters the
// "escaped" state at "<!--" regardless of the type attribute. Escaping every '<' as < kills both at once and is
// still valid JSON (JSON.parse decodes it). U+2028/U+2029 are escaped too: legal in JSON, but line terminators in
// pre-ES2019 JavaScript, so the same text pasted into a JS context would be a syntax error.
const jsonInline = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
// Code inside a real <script>: '<' cannot be escaped blindly (it is an operator), so only the two dangerous
// sequences are rewritten. '<\/script' and '<\!--' mean the same thing inside a JS string or regex ('\/' and '\!' are
// identity escapes), which is where such sequences occur in bundled code. KNOWN LIMIT: a bare `a<!--b` expression
// outside a string would change meaning; bundlers do not emit that.
// pick: localized-string lookup with fallback UI language -> template main language -> any language -> ''.
const jsInline = (s) => String(s).replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
const pick = (o, l, main) => (o && (o[l] || o[main] || Object.values(o)[0])) || '';

export function compileTemplate(tplIn, o = {}) {
  const tpl = normalizeTemplate(tplIn);
  const lang = tpl.langs.includes(o.lang) ? o.lang : tpl.main;
  const start = o.doc ? normalizeDoc(o.doc) : newDocument(tpl, { empty: !o.withSample });
  start.lang = lang;
  // Pre-render the contract server-side (build-time): the page is readable and printable before, or without, JS.
  // The runtime later replaces #ctp-root; chips:false because there is no form yet to jump to.
  const pre = renderContract(tpl, start, { lang, chips: false, today: o.today });
  // The template's sample is stripped from the shipped copy: the sample may hold realistic personal data used for
  // demos, and the recipient of a fill-in page has no use for it. Values travel separately, only when requested.
  const shipped = { ...tpl, sample: { values: {}, modifiers: {}, levels: {} } };
  const data = { template: shipped, lang, values: o.withSample || o.doc ? start.values : undefined, modifiers: start.modifiers, levels: start.levels, generator: o.generator || 'agreement-constructor' };
  const key = o.runtimeKey || 'bundle:page.js';
  const title = pick(tpl.name, lang, tpl.main) || 'Agreement';
  // Boot contract: the bundle registers its API under a global Symbol.for key (registry symbols are shared across
  // realms/modules, unlike a plain Symbol, and cannot clash with page globals the way a string name could).
  // Data is read from the JSON island, not interpolated into JS: one escaping path (jsonInline), no code injection.
  const boot = o.runtime
    ? `<script type="module">${jsInline(o.runtime)}\n;globalThis[Symbol.for(${JSON.stringify(key)})].boot(JSON.parse(document.getElementById('ctp-data').textContent));</script>`
    : '';
  return '<!doctype html>\n'
    + `<html lang="${escapeAttr(lang)}"><head><meta charset="utf-8">`
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + `<meta http-equiv="Content-Security-Policy" content="${CSP}">`
    + '<meta name="color-scheme" content="light dark">'
    + `<meta name="generator" content="${escapeAttr(data.generator)}">`
    + `<title>${escapeHTML(title)}</title><link rel="icon" href="${ICON}">`
    + `<style>${pageCSS()}${formCSS()}${paperCSS(tpl.page)}</style></head>`
    + `<body class="ctp"><div id="ctp-root"><main class="ctp-static"><div class="ct-sheet">${pre.html}</div></main></div>`
    + `<script type="application/json" id="ctp-data">${jsonInline(data)}</script>${boot}</body></html>\n`;
}

// The archive copy: no script at all, so its CSP allows no script-src (falls back to default-src 'none').
// A filled contract given to a counterparty must not execute anything; the inline grey background is screen-only.
export function compileStatic(tplIn, docIn, o = {}) {
  const tpl = normalizeTemplate(tplIn);
  const doc = normalizeDoc(docIn);
  const lang = o.lang || doc.lang || tpl.main;
  const r = renderContract(tpl, doc, { lang, second: o.second, chips: false, today: o.today });
  const title = doc.name || pick(tpl.name, lang, tpl.main) || 'Agreement';
  return '<!doctype html>\n'
    + `<html lang="${escapeAttr(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`
    + `<title>${escapeHTML(title)}</title><link rel="icon" href="${ICON}">`
    + `<style>body{margin:0;background:#e9ebef;padding:16px}@media print{body{padding:0;background:#fff}}${paperCSS(tpl.page)}</style></head>`
    + `<body><div class="ct-sheet">${r.html}</div></body></html>\n`;
}
