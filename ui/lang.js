// ui/lang.js - language helpers of the editor UI: tag validation, suggested languages, labels, month names, dates.
// Two kinds of language here: the UI language (UI_STATE.lang, chrome strings, date formatting) and CONTENT languages
// (tags of user documents, validated by contentLangCode). Everything is Intl-based with fallbacks, never throws.
// Note the import cycle ui/i18n.js ↔ ui/lang.js: safe because neither module uses the other's bindings at
// evaluation time, only inside functions called later.
import { formatYearMonth } from '../i18n/dates.js';
import { UI_STATE } from './i18n.js';
import { langName } from '../i18n/lang.js';

// Syntactic shape of a BCP 47 tag we accept: 2–3 letter language + subtags of 1–8 alphanumerics. Syntax only;
// contentLangCode adds the semantic checks.
const LANG_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/;
const SUGGESTED_LANGS = ['en', 'ru', 'de', 'fr', 'es', 'uk', 'ka'];

// Engines with trimmed ICU data (some embedded Chromium builds lack 'ka') silently format with the system locale:
// for such a UI language, month names come from built-in tables (i18n/dates.js) instead.
const intlHas = (lang) => { try { return Intl.DateTimeFormat.supportedLocalesOf([lang]).length > 0; } catch { return false; } };
// KNOWN DEFECT (perf): intlHas runs supportedLocalesOf on every fmtDate / monthShort call (not cached), e.g. 12×
// per month picker render. Fix: memoise per language in a Map, like pluralRules in ui/i18n.js.
const pad2 = (n) => String(n).padStart(2, '0');
// Timestamp for UI lists ("saved at"). Invalid input is echoed back as-is rather than "Invalid Date".
function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || '');
  if (!intlHas(UI_STATE.lang)) {
    return `${d.getDate()} ${formatYearMonth(d.getFullYear(), d.getMonth() + 1, UI_STATE.lang, 'month')}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  try { return new Intl.DateTimeFormat(UI_STATE.lang, { dateStyle: 'medium', timeStyle: 'short' }).format(d); }
  catch { return String(iso || ''); }
}
// Short month name (1–12) in the UI language.
// Day 15 avoids time-zone edge cases (a 1st-of-month local date never shifts into the previous month). The table
// fallback formats "month 2000" and strips the year back out.
function monthShort(m) {
  if (intlHas(UI_STATE.lang)) {
    try { return new Intl.DateTimeFormat(UI_STATE.lang, { month: 'short' }).format(new Date(2000, m - 1, 15)); } catch { /* below */ }
  }
  const s = formatYearMonth(2000, m, UI_STATE.lang, 'month').replace(/\s*2000\s*/, '').trim();
  return s || String(m);
}

// Canonical BCP 47 form ('en_us' → 'en-US'), or null when the tag is malformed.
function canonLang(code) {
  try { return Intl.getCanonicalLocales(String(code).trim().replace(/_/g, '-'))[0] || null; } catch { return null; }
}
// A tag usable as a content language: language[-script][-region][-variant] with a 2–3 letter language the
// browser knows (no 'und', no -u-/-t-/-x- extensions); null otherwise. Matches what isI18n() accepts as keys.
// Single-letter subtags start extensions (-u-, -t-) or private use (-x-): rejected wholesale. "Browser knows the
// language" test: DisplayNames with fallback:'code' echoes unknown codes back unchanged. The DisplayNames instance is
// created lazily and kept (module-level) — construction is the expensive part.
let langNamesEn = null;
function contentLangCode(raw) {
  const c = canonLang(raw);
  if (!c || !LANG_RE.test(c)) return null;
  const parts = c.split('-');
  if (parts[0] === 'und' || parts.some((p) => p.length === 1)) return null;
  try {
    langNamesEn = langNamesEn || new Intl.DisplayNames(['en'], { type: 'language', fallback: 'code' });
    if (langNamesEn.of(parts[0]) === parts[0]) return null;
  } catch { /* no Intl.DisplayNames: the syntax checks above are all we can do */ }
  return c;
}
// Endonym for the language picker ("Deutsch", "ქართული"): a user hunting for their language recognises its own
// name, not its name in the current UI language.
function langLabel(code) {
  try { return langName(code, 'native') || code; } catch { return code; }
}

export {
  LANG_RE,
  SUGGESTED_LANGS,
  canonLang,
  contentLangCode,
  fmtDate,
  langLabel,
  monthShort,
  pad2
};
