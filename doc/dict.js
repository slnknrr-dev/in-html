// doc/dict.js - viewer UI strings of the active product (pre-rendered into exports; the runtime carries none).
// Why pre-rendered: an exported page ships only the strings it uses in the languages it has, instead of every
// dictionary; the runtime receives finished texts (cfg.aria, titles) and contains no i18n logic.
import { primary } from '../i18n/lang.js';
import { interp, pluralCat } from '../i18n/intl.js';
import { UI } from './product.js';
import { own } from '../util/value.js';

// [value, language it came from]: requested language, its primary subtag, the document's UI fallback, English.
export function uiLookup(key, lang, doc) {
  const fb = doc && doc.output && doc.output.uiFallback;
  for (const l of [lang, primary(lang), fb, 'en']) {
    if (!l) continue;
    const d = own(UI, l);
    if (d && own(d, key) != null) return [d[key], l];
  }
  // The key itself as last resort: a visible 'dur.y' in the page flags a missing string instead of an empty gap.
  return [key, 'en'];
}

// Plural-aware ({ one, few, many, other } by vars.n) with {var} interpolation.
// The plural category is taken in the language the string came from (l), not the requested one: a Russian
// fallback string needs Russian 'few' even when the page language is, say, Belarusian without a dictionary.
export function uiText(key, lang, doc, vars) {
  let [v, l] = uiLookup(key, lang, doc);
  if (v && typeof v === 'object') {
    const n = vars && vars.n != null ? Number(vars.n) : 0;
    v = own(v, pluralCat(l, n)) ?? own(v, 'other') ?? '';
  }
  return interp(String(v), vars);
}
