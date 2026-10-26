// i18n/text.js - per-language texts ({ lang: value }): pickText / pickFrom with fallbacks, normI18n, isEmptyText,
// htmlToText.
//
// Model: a translatable value is either a plain string (language-neutral) or an object { lang: string }. Values may be
// rich HTML, so "empty" is decided on visible text, not on length: '<p></p>' is empty, '<img>' is not.
// Lookup order everywhere: exact tag -> primary subtag -> document default language -> document languages in order.
// Never invent text: '' when nothing matches; the caller decides on a placeholder.
import { canonLang, primary } from './lang.js';
import { isObj, own } from '../util/value.js';

// "Empty" = undefined/null/whitespace, or rich HTML without text and without <img>/<hr>.
function isEmptyText(s) {
  if (s == null) return true;
  s = String(s);
  if (s.indexOf('<') < 0) return !s.replace(/&nbsp;|&#160;|\u00a0/g, ' ').trim();
  if (/<(img|hr)\b/i.test(s)) return false;
  return !s.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;|\u00a0/g, ' ').trim();
}

// HTML → plain text (for placeholders, alt text, titles).
// Regex stripping, not DOMParser: works in workers and Node tests, and the input is the editor's own HTML. Block
// closers become spaces so "<p>a</p><p>b</p>" gives "a b", not "ab". &amp; is decoded LAST: decoding it first would
// turn "&amp;lt;" into "<" (double decoding). Output is plain text and must never be re-inserted as HTML.
function htmlToText(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|li|h3|h4|div|blockquote|pre)>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// own() guards the lookup: a key like '__proto__' or 'constructor' must not resolve to Object.prototype members.
function pickText(i18n, lang, doc) {
  if (i18n == null) return '';
  if (typeof i18n !== 'object') return isEmptyText(i18n) ? '' : String(i18n);
  const get = (k) => {
    const v = k ? own(i18n, k) : undefined;
    return typeof v === 'string' && !isEmptyText(v) ? v : null;
  };
  let v = get(lang);
  if (v != null) return v;
  const p = primary(lang);
  if (p !== lang && (v = get(p)) != null) return v;
  if (doc) {
    if ((v = get(doc.defaultLang)) != null) return v;
    for (const l of doc.langs || []) if ((v = get(l)) != null) return v;
  }
  return '';
}

// Keys are canonicalized like doc.langs ('EN' → 'en', 'pt_BR' → 'pt-BR'); on a collision the first non-empty value wins.
function normI18n(v, dl) {
  const out = {};
  if (typeof v === 'string') { if (v) out[dl] = v; return out; }
  if (isObj(v)) {
    for (const k of Object.keys(v)) {
      if (typeof v[k] !== 'string') continue;
      const ck = canonLang(k) || k;
      if (ck === '__proto__') continue;
      if (!own(out, ck) || !out[ck]) out[ck] = v[k];
    }
  }
  return out;
}

// Like pickText but also returns the language the text came from, so callers can set lang="" on the element and
// screen readers / hyphenation follow the fallback language, not the requested one.
// Plain i18n[k] is safe here without own(): ok() requires typeof string, inherited members are functions or objects.
function pickFrom(i18n, lang, doc) {
  if (!isObj(i18n)) return [pickText(i18n, lang, doc), lang];
  const ok = (k) => k && typeof i18n[k] === 'string' && !isEmptyText(i18n[k]);
  if (ok(lang)) return [i18n[lang], lang];
  const p = primary(lang);
  if (ok(p)) return [i18n[p], p];
  if (doc) {
    if (ok(doc.defaultLang)) return [i18n[doc.defaultLang], doc.defaultLang];
    for (const l of doc.langs || []) if (ok(l)) return [i18n[l], l];
  }
  return ['', lang];
}

export {
  htmlToText,
  isEmptyText,
  normI18n,
  pickFrom,
  pickText
};
