// contract/format.js - how contract values are written in a language: numbers with the language's separators, money
// with the amount in words ("50 000 (пятьдесят тысяч) рублей"), legal dates ("«23» января 2027 г.", "23 January
// 2027"), plural forms of nouns after numbers, initials of names. The seven UI languages of the repository have
// built-in tables (the output never depends on the ICU data of the engine); other languages use Intl when the engine
// really has the locale, else neutral numeric forms.
//
//   formatNumber(n, lang, { decimals }) -> '50 000'          formatDate(iso, lang, style) -> string
//     style: 'long' (legal: «23» января 2027 г.) | 'text' (23 января 2027 г.) | 'short' (23.01.2027) | 'iso'
//   moneyText(amount, { lang, currency, words, cents, capital }) -> '50 000 (пятьдесят тысяч) рублей'
//     words: true (default) adds the amount in words; cents: 'auto' (only when non-zero) | 'always' | 'never'
//   plural(lang, n, forms) -> form (ru / uk: [one, few, many]; others: [one, other]; ka: the singular)
//   initials(name, lang) -> 'Иванов И. И.' | 'J. Smith'      capitalize(s)
import { intl, intlSupports } from '../i18n/intl.js';
import { parseDate } from './dates.js';
import { currencyGender, currencyOf, currencyUnit, hasWords, numberWords, slavicPlural } from './words.js';

const NB = ' ';
const prim = (lang) => String(lang || '').toLowerCase().split('-')[0];
// NB (U+00A0) is used for every space inside a formatted value: "50 000", "23 января 2027 г.", "Иванов И. И."
// must never break across lines in justified legal text.
// SEPS: [group, decimal point, minimum digits-1 before grouping]. es: [.,2]: Spanish style (RAE) does not group
// four-digit numbers (2500, but 25.000). '−' (U+2212 minus) is used for negatives: typographic, same width as '+'.
// Built-in tables first for the seven repository languages: Intl output differs between engines/ICU versions
// (e.g. fr uses U+202F narrow NBSP in newer ICU), and a contract must render byte-identically everywhere.
const SEPS = { ru: [NB, ','], uk: [NB, ','], fr: [NB, ','], ka: [NB, ','], de: ['.', ','], es: ['.', ',', 2], en: [',', '.'] };

export function formatNumber(n, lang, o = {}) {
  const v = +n;
  if (!Number.isFinite(v)) return '';
  // Without explicit decimals: as many as the value needs, at most two (54.3 -> 54,3; 0.125 -> 0,13).
  const dec = Number.isInteger(o.decimals) ? Math.min(Math.max(o.decimals, 0), 6)
    : Number.isInteger(v) ? 0 : Math.abs(v * 10 - Math.round(v * 10)) < 1e-9 ? 1 : 2;
  const p = prim(lang);
  const seps = SEPS[p];
  if (!seps && intlSupports('NumberFormat', lang)) {
    try { return intl('NumberFormat', lang, { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v); } catch { /* below */ }
  }
  // toFixed on the absolute value, then regex grouping of the integer part: \B(?=(\d{3})+(?!\d)) inserts at every
  // inner position followed by a multiple of three digits.
  const [grp, point, minGroup] = seps || SEPS.en;
  const fixed = Math.abs(v).toFixed(dec);
  const [int, frac] = fixed.split('.');
  const grouped = int.length >= 4 + ((minGroup || 1) - 1) ? int.replace(/\B(?=(\d{3})+(?!\d))/g, grp) : int;
  return (v < 0 ? '−' : '') + grouped + (frac ? point + frac : '');
}

// Day-month-year tables: [months in the form used after a day number, pattern]. {d} {m} {y}; ru / uk "long" wrap the
// day in guillemets.
const DATES = {
  ru: ['января февраля марта апреля мая июня июля августа сентября октября ноября декабря', '{d} {m} {y} г.', '«{d}» {m} {y} г.'],
  uk: ['січня лютого березня квітня травня червня липня серпня вересня жовтня листопада грудня', '{d} {m} {y} р.', '«{d}» {m} {y} р.'],
  en: ['January February March April May June July August September October November December', '{d} {m} {y}'],
  de: ['Januar Februar März April Mai Juni Juli August September Oktober November Dezember', '{d}. {m} {y}'],
  fr: ['janvier février mars avril mai juin juillet août septembre octobre novembre décembre', '{d} {m} {y}'],
  es: ['enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre', '{d} de {m} de {y}'],
  ka: ['იანვარი თებერვალი მარტი აპრილი მაისი ივნისი ივლისი აგვისტო სექტემბერი ოქტომბერი ნოემბერი დეკემბერი', '{d} {m} {y} წ.'],
};
const pad2 = (n) => String(n).padStart(2, '0');

// Month names are the genitive forms used after a day number ("23 января", not "январь"); ka uses the nominative,
// which is the Georgian convention. Intl fallback formats a UTC noon date with timeZone:'UTC' so no local offset can
// shift the day.
export function formatDate(iso, lang, style = 'long') {
  const dt = parseDate(iso);
  if (!dt) return '';
  if (style === 'iso') return `${dt.y}-${pad2(dt.m)}-${pad2(dt.d)}`;
  const p = prim(lang);
  if (style === 'short') return p === 'en' || p === 'fr' || p === 'es' ? `${pad2(dt.d)}/${pad2(dt.m)}/${dt.y}` : `${pad2(dt.d)}.${pad2(dt.m)}.${dt.y}`;
  const t = DATES[p];
  if (t) {
    const pat = style === 'long' && t[2] ? t[2] : t[1];
    const d = style === 'long' && t[2] ? pad2(dt.d) : String(dt.d);
    return pat.replace('{d}', d).replace('{m}', t[0].split(' ')[dt.m - 1]).replace('{y}', dt.y).replace(/ /g, NB);
  }
  if (intlSupports('DateTimeFormat', lang)) {
    try { return intl('DateTimeFormat', lang, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(dt.y, dt.m - 1, dt.d, 12))); } catch { /* below */ }
  }
  return `${pad2(dt.d)}.${pad2(dt.m)}.${dt.y}`;
}

export const capitalize = (s) => { s = String(s ?? ''); return s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s; };

// Integer/cents split with care for binary floats: +1e-9 so 2.9999999997 counts as 3, cents rounded and a 100-cent
// carry folded into the integer (19.999 -> 20, not "19 ... 100 копеек"). Words are spelled for the integer part only
// (legal convention: "50 000 (пятьдесят тысяч) рублей 50 копеек"). The currency unit agrees with the number
// (рубль/рубля/рублей) via currencyUnit; the word gender of the number agrees with the currency (одна гривна).
// Unknown currency or language without unit words: digits + ISO code, never a wrong word.
export function moneyText(amount, o = {}) {
  const v = +amount;
  if (!Number.isFinite(v)) return '';
  const lang = o.lang || 'en';
  const code = String(o.currency || 'RUB').toUpperCase();
  const cur = currencyOf(code);
  const dec = cur ? cur.decimals : 2;
  const abs = Math.abs(v);
  let int = Math.floor(abs + 1e-9);
  let cents = Math.round((abs - int) * 10 ** dec);
  if (cents >= 10 ** dec) { int += 1; cents = 0; }
  const showCents = o.cents === 'always' || (o.cents !== 'never' && cents > 0);
  const neg = v < 0 ? '−' : '';
  if (!cur || !cur.units[prim(lang)]) {
    return neg + formatNumber(showCents ? abs : int, lang, { decimals: showCents ? dec : 0 }) + NB + code;
  }
  const digits = neg + formatNumber(int, lang, { decimals: 0 });
  let words = o.words === false || !hasWords(lang) ? '' : numberWords(int, lang, currencyGender(code, lang));
  if (words && o.capital) words = capitalize(words);
  let s = digits + (words ? ` (${words})` : '') + ' ' + currencyUnit(code, lang, int);
  if (showCents) s += ' ' + String(cents).padStart(dec, '0') + ' ' + currencyUnit(code, lang, cents, true);
  return s;
}

// CLDR-like rules reduced to what contracts need: Slavic one/few/many by last digits (slavicPlural), French treats 0
// and 1 as singular, Georgian nouns stay singular after numerals. Fractions are truncated: plural of 1.5 is "one".
export function plural(lang, n, forms) {
  const f = (forms || []).map((x) => String(x ?? ''));
  if (!f.length) return '';
  const v = Math.abs(Math.trunc(+n || 0));
  const p = prim(lang);
  if ((p === 'ru' || p === 'uk' || p === 'be') && f.length >= 3) return slavicPlural(v, f);
  if (p === 'ka') return f[0];
  if (p === 'fr') return v <= 1 ? f[0] : f[1] ?? f[0];
  return v === 1 ? f[0] : f[1] ?? f[0];
}

// Surname-first initials in Slavic languages ("Иванов Иван Иванович" -> "Иванов И. И."), first-name initials elsewhere
// ("John Smith" -> "J. Smith").
// Hyphenated parts keep the hyphen in initials ("Анна-Мария" -> "А.-М."). Slavic order assumes "Surname Given
// Patronymic" input (official documents order); only the next two words are abbreviated.
export function initials(name, lang) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts.join('');
  const ini = (w) => w.split('-').map((x) => x.charAt(0).toLocaleUpperCase() + '.').join('-');
  const p = prim(lang);
  if (p === 'ru' || p === 'uk' || p === 'be' || p === 'kk') return parts[0] + NB + parts.slice(1, 3).map(ini).join(NB);
  return parts.slice(0, -1).map(ini).join(NB) + NB + parts[parts.length - 1];
}
