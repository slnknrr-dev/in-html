// i18n/lang.js - language tags: canonLang (canonical BCP 47 form), primary (primary subtag), langName (native
// name or code), langDir (ltr / rtl), LANG_NAMES.
//
// Tags are compared case-insensitively and '_' is accepted as '-' (POSIX-style 'pt_BR' arrives from files and OS
// settings). Every function tolerates null / non-strings: language tags come from user documents.
import { intlSupports } from './intl.js';
import { own } from '../util/value.js';

// Primary language subtag, lower-cased: 'pt-BR' -> 'pt', 'zh_Hant_TW' -> 'zh'. Not canonicalised (cheap, called in
// hot paths), so legacy aliases such as 'iw' stay as they are.
function primary(lang) {
  return String(lang || '').split(/[-_]/)[0].toLowerCase();
}

// Display name, resolved from most to least trustworthy: own table (exact, then case-insensitive), Intl native name,
// table name of the primary subtag + region, Intl English name, upper-cased code. Each step is deterministic across
// machines, which matters because the result is baked into exported files.
function langName(code, labels = 'native') {
  code = String(code || '');
  if (labels === 'code') return code.toUpperCase();
  if (own(LANG_NAMES, code)) return LANG_NAMES[code];
  const lc = code.toLowerCase();
  for (const k in LANG_NAMES) if (k.toLowerCase() === lc) return LANG_NAMES[k];
  // Native name via Intl only when the engine really has that locale: trimmed-ICU builds silently answer in the
  // SYSTEM locale (DisplayNames(['ka']).of('ka') → 'грузинский'), which would bake the editor machine's language
  // into the export.
  if (intlSupports('DisplayNames', code)) {
    try {
      const n = new Intl.DisplayNames([code], { type: 'language' }).of(code);
      if (n && n !== code) return n.charAt(0).toLocaleUpperCase(code) + n.slice(1);
    } catch (e) { /* fall through */ }
  }
  const p = primary(code);
  if (p !== code && own(LANG_NAMES, p)) return LANG_NAMES[p] + ' (' + code.slice(p.length + 1).toUpperCase() + ')';
  // Neutral English name (stable regardless of the machine's locale), else the code.
  if (intlSupports('DisplayNames', 'en')) {
    try {
      const n = new Intl.DisplayNames(['en'], { type: 'language' }).of(code);
      if (n && n.toLowerCase() !== code.toLowerCase()) return n;
    } catch (e) { /* fall through */ }
  }
  return code.toUpperCase();
}

// Writing direction of a language tag: Intl text info when available, else a list of right-to-left languages.
// getTextInfo() is the current proposal method, textInfo the older accessor some engines shipped: both are probed.
// The regex is the baseline and Intl may override it (a script subtag such as 'az-Arab' is rtl). The (-|$) anchor
// keeps 'arn' (Mapudungun) from matching 'ar'.
const RTL_RE = /^(ar|he|iw|fa|ur|ps|sd|ug|yi|dv|ckb|syr)(-|$)/i;
const dirCache = new Map();
function langDir(l) {
  l = String(l || '');
  let d = dirCache.get(l);
  if (d) return d;
  d = RTL_RE.test(l) ? 'rtl' : 'ltr';
  try {
    const L = new Intl.Locale(l);
    const ti = typeof L.getTextInfo === 'function' ? L.getTextInfo() : L.textInfo;
    if (ti && (ti.direction === 'rtl' || ti.direction === 'ltr')) d = ti.direction;
  } catch (e) { /* invalid tag or no Intl.Locale */ }
  if (dirCache.size < 256) dirCache.set(l, d);
  return d;
}

// Native names (endonyms). A table rather than Intl.DisplayNames: identical output on every engine, including
// trimmed-ICU builds. Keys are canonical BCP 47 tags; regional entries (pt-BR, zh-CN) are matched before primary ones.
// langName reads it before this line textually: fine, it is only read when a function runs, after module evaluation.
const LANG_NAMES = {
  en: 'English', ru: 'Русский', de: 'Deutsch', fr: 'Français', es: 'Español', uk: 'Українська', ka: 'ქართული',
  it: 'Italiano', pt: 'Português', 'pt-BR': 'Português (Brasil)', pl: 'Polski', nl: 'Nederlands', cs: 'Čeština',
  sk: 'Slovenčina', sl: 'Slovenščina', hr: 'Hrvatski', sr: 'Српски', bg: 'Български', be: 'Беларуская',
  ro: 'Română', hu: 'Magyar', el: 'Ελληνικά', tr: 'Türkçe', az: 'Azərbaycan', hy: 'Հայերեն', kk: 'Қазақ',
  uz: 'Oʻzbek', ky: 'Кыргызча', tg: 'Тоҷикӣ', mn: 'Монгол', lt: 'Lietuvių', lv: 'Latviešu', et: 'Eesti',
  fi: 'Suomi', sv: 'Svenska', da: 'Dansk', nb: 'Norsk bokmål', no: 'Norsk', is: 'Íslenska', ga: 'Gaeilge',
  he: 'עברית', ar: 'العربية', fa: 'فارسی', hi: 'हिन्दी', bn: 'বাংলা', ur: 'اردو', th: 'ไทย', vi: 'Tiếng Việt',
  id: 'Bahasa Indonesia', ms: 'Bahasa Melayu', ja: '日本語', ko: '한국어', zh: '中文', 'zh-CN': '简体中文',
  'zh-TW': '繁體中文', ca: 'Català', eu: 'Euskara', gl: 'Galego', eo: 'Esperanto', la: 'Latina',
  sq: 'Shqip', mk: 'Македонски', af: 'Afrikaans', sw: 'Kiswahili', tk: 'Türkmen', ne: 'नेपाली', si: 'සිංහල',
  km: 'ខ្មែរ', my: 'မြန်မာ',
};

// Canonical BCP 47 casing and aliases ('EN-us' -> 'en-US'). '' for an invalid tag so callers can write `|| fallback`.
// Cached because it runs on every key normalisation (text.js normI18n).
const canonCache = new Map();
function canonLang(l) {
  if (typeof l !== 'string' || !l.trim()) return '';
  let c = canonCache.get(l);
  if (c !== undefined) return c;
  try { c = Intl.getCanonicalLocales(l.trim().replace(/_/g, '-'))[0] || ''; } catch (e) { c = ''; }
  if (canonCache.size < 512) canonCache.set(l, c);
  return c;
}

export {
  LANG_NAMES,
  canonLang,
  langDir,
  langName,
  primary
};
