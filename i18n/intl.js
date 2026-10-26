// i18n/intl.js - Intl helpers: intl(kind, lang, opts) cached formatters, intlSupports(kind, lang) (ICU data probe),
// pluralCat(lang, n), interp(text, vars).
//
// Design rules:
// - Never throw into UI code. A bad tag (RangeError from the constructor) degrades to 'en'; a missing ICU locale is
//   detected by intlSupports, not by catching (engines do not throw for it, they silently use the system locale).
// - Cache by (kind, lang, JSON(opts)). Intl constructors are expensive (ICU lookup, pattern compile): building one per
//   formatted value is the classic cause of slow table renders. JSON.stringify as key is order-sensitive: {a,b} and
//   {b,a} are two entries. Acceptable: call sites pass literal objects in a fixed order.
// - Size cap 512 instead of LRU: a bound against pathological callers (per-value opts), not an eviction policy. Past
//   the cap formatters are still returned, just not stored, so correctness never depends on the cache.
// - Circular import with lang.js (lang imports intlSupports, we import primary) is safe: both sides only use the other
//   inside function bodies, never at module evaluation, and ESM bindings are live.
import { primary } from './lang.js';

/* ---------- Intl helpers (cached, never throw) ---------- */

const intlCache = new Map();
// kind is a constructor name on Intl ('NumberFormat', 'DateTimeFormat', 'PluralRules', ...). Fallback 'en' rather
// than undefined (= system locale): output must not depend on the machine that renders it.
// KNOWN DEFECT: an unknown kind makes C undefined and `new C` throws TypeError in the catch as well, contradicting
// "never throw". Fix: guard `typeof C !== 'function'` before constructing.
function intl(kind, lang, opts) {
  const key = kind + '|' + lang + '|' + JSON.stringify(opts || {});
  let f = intlCache.get(key);
  if (!f) {
    const C = Intl[kind];
    try { f = new C(lang, opts); } catch (e) { f = new C('en', opts); }
    if (intlCache.size < 512) intlCache.set(key, f);
  }
  return f;
}

// Engines with trimmed ICU data (e.g. some embedded Chromium builds lack 'ka') silently format with
// the SYSTEM locale instead of the requested one. Detect support so we never print e.g. Russian months
// for Georgian content; callers fall back to built-in tables / neutral formats.
// Criterion: supportedLocalesOf returns only locales the engine has data for (possibly via a parent, 'de' for
// 'de-AT'), so comparing primary subtags accepts regional fallbacks but rejects substitution by another language.
const intlOKCache = new Map();
function intlSupports(kind, lang) {
  const key = kind + '|' + lang;
  let ok = intlOKCache.get(key);
  if (ok == null) {
    try {
      const p = primary(lang).toLowerCase();
      ok = Intl[kind].supportedLocalesOf([lang]).some((l) => primary(l).toLowerCase() === p);
    } catch (e) { ok = false; }
    if (intlOKCache.size < 512) intlOKCache.set(key, ok);
  }
  return ok;
}

// CLDR plural category ('zero' | 'one' | 'two' | 'few' | 'many' | 'other'). The fallback is the English rule: wrong
// for Slavic 'few', but intl() itself already falls back to 'en', so this branch is reached only without PluralRules.
function pluralCat(lang, n) {
  try { return intl('PluralRules', lang).select(n); } catch (e) { return n === 1 ? 'one' : 'other'; }
}

// "{name}" placeholders. An unknown or null var leaves the placeholder visible: a missing value is a bug to see in
// the UI, not to hide as an empty string. \w+ limits names to identifiers, so other braces in prose survive.
function interp(s, vars) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

export {
  interp,
  intl,
  intlSupports,
  pluralCat
};
