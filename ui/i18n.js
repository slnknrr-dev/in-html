// ui/i18n.js - UI string dictionaries of an application (editor chrome), t() lookup with plurals and {var}
// interpolation, UI language detection and static markup labels (data-i18n*).
//
// Design rules:
// - One global registry (ED_I18N) filled by side-effect imports (ui/strings.js, each app's strings.js) — modules
//   register before first render; t() is resolved at CALL time, so a language switch needs only a re-render.
// - Never throws and never returns empty for a missing key: fallback chain ui → primary subtag → en → humanized key.
//   A visible "Show level" is a better failure than a blank button.
// - UI_STATE is a mutable shared record (lang, storageKey, titleKey) set by ui/app.js startApp; plain object rather
//   than getters/setters because every reader wants the current value and there is no change notification need.
import { primary } from '../i18n/lang.js';
import { $$, lsGet } from './dom.js';
import { canonLang } from './lang.js';

// lang -> { key: 'text' | { one, few, many, other } }. 'en' is the reference dictionary (pre-created, so t() can
// read ED_I18N.en[key] without a guard; every key must exist in it).
export const ED_I18N = { en: {} };

// Current UI language and the localStorage key that remembers the user's choice.
export const UI_STATE = { lang: 'en', storageKey: 'ed-ui', titleKey: 'app.name' };

// Merges dictionaries ({ lang: { key: value } }); later additions override earlier keys.
// Adding a language here also adds it to the language picker (renderTop lists Object.keys(ED_I18N)).
export function addDicts(dicts) {
  for (const [lang, d] of Object.entries(dicts)) ED_I18N[lang] = Object.assign(ED_I18N[lang] || {}, d);
}

// 'f.showLevel' -> 'Show level' (fallback label for missing dictionary keys)
// Drops the namespace before the FIRST dot (a key ending in '.' is treated as plain text), splits camelCase and
// -/_ into words, sentence-cases. Only the first segment is dropped: 'a.b.cD' → 'B.c d'.
export function humanize(key) {
  const s = String(key);
  const tail = s.includes('.') && !/\.\s*$/.test(s) ? s.slice(s.indexOf('.') + 1) : s;
  const words = tail.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim();
  if (!words) return s;
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

// Plural category of n for a UI language (cached Intl.PluralRules).
// Constructing PluralRules is costly relative to select(); one per language, cached — including a null for a
// language the engine rejects, so the failure is not retried on every call. Fallback is English-like one/other.
const pluralRules = new Map();
function pluralCat(lang, n) {
  let pr = pluralRules.get(lang);
  if (!pr) {
    try { pr = new Intl.PluralRules(lang); } catch { pr = null; }
    pluralRules.set(lang, pr);
  }
  try { return pr ? pr.select(n) : (n === 1 ? 'one' : 'other'); } catch { return 'other'; }
}

// Dictionary values are strings or plural objects {one, few, many, other, ...} chosen by vars.n.
// `from` tracks WHICH dictionary answered: plural rules must be those of the string's language, not the UI's —
// a Russian UI falling back to an English {one, other} object must not ask for 'few'. Category fallback:
// exact → other → any first value. Interpolation leaves unknown {placeholders} intact (visible during development
// instead of silently vanishing); \w+ restricts names to identifiers.
export function t(key, vars) {
  const ui = UI_STATE.lang;
  const pr = primary(ui);
  let s = ED_I18N[ui]?.[key], from = ui;
  if (s == null) { s = ED_I18N[pr]?.[key]; from = pr; }
  if (s == null) { s = ED_I18N.en[key]; from = 'en'; }
  if (s == null) {
    // Dev aid: record keys missing from the dictionaries (inspect window.__edMissingKeys in the console).
    if (/^[a-z]/i.test(key) && typeof window !== 'undefined') (window.__edMissingKeys ||= new Set()).add(key);
    s = humanize(key);
  }
  if (s && typeof s === 'object') {
    const n = Number(vars?.n);
    const cat = Number.isFinite(n) ? pluralCat(from, n) : 'other';
    s = s[cat] ?? s.other ?? Object.values(s)[0] ?? '';
  }
  if (vars) s = String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  return s;
}

// Saved choice, then the browser's preferred languages (exact, then primary subtag), else English.
// Two passes: exact tags across ALL preferences first, then primary subtags. Trade-off: for prefs [de-AT, en] with
// dictionaries {de, en}, pass 1 matches 'en' (exact) before pass 2 would reach 'de' — a lower-ranked exact match
// beats a higher-ranked primary match. Acceptable here because the UI dictionaries are keyed by primary subtags
// and browsers usually list the bare language too ([de-AT, de, en]). canonLang normalises case ('en-us' → 'en-US').
// The saved choice is validated against available dictionaries: a removed language falls through to detection.
export function detectUILang() {
  const avail = Object.keys(ED_I18N);
  const saved = lsGet(UI_STATE.storageKey, null);
  if (saved && avail.includes(saved)) return saved;
  const prefs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en']);
  for (const p of prefs) { const c = canonLang(p); if (c && avail.includes(c)) return c; }
  for (const p of prefs) { const pr = String(p).toLowerCase().split('-')[0]; if (avail.includes(pr)) return pr; }
  return 'en';
}

// Picks a string from an i18n object for the UI language (templates, names).
// Content objects ({ en, ru, … }) as opposed to UI keys: chain ui → primary subtag → en → first non-empty value.
// `||` (not ??) on purpose: an empty translation counts as missing.
export function pickUI(o) {
  if (!o) return '';
  if (typeof o === 'string') return o;
  const ui = UI_STATE.lang;
  return o[ui] || o[ui.split('-')[0]] || o.en || Object.values(o).find((v) => v) || '';
}

// Static markup: data-i18n (text), data-i18n-title, data-i18n-aria, data-i18n-ph.
// Lets page HTML carry English text (readable before JS / for crawlers) and still translate on boot and on every
// language switch. data-i18n REPLACES textContent — only put it on leaf elements, child nodes would be wiped.
// document.title only for a full-document pass; a subtree pass (root = an element) leaves the title alone.
export function applyStaticI18n(root = document) {
  if (root === document) document.title = t(UI_STATE.titleKey);
  for (const el of $$('[data-i18n]', root)) el.textContent = t(el.dataset.i18n);
  for (const el of $$('[data-i18n-title]', root)) el.title = t(el.dataset.i18nTitle);
  for (const el of $$('[data-i18n-aria]', root)) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const el of $$('[data-i18n-ph]', root)) el.setAttribute('placeholder', t(el.dataset.i18nPh));
}
