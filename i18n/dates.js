// i18n/dates.js - month / year formatting that never prints the wrong language: Intl when the engine really has the
// locale, else built-in month tables for the common UI languages, else a neutral numeric form.
// Why not always Intl: trimmed-ICU engines silently format with the system locale (see intl.js), so a Georgian
// document could print Russian months. intlSupports decides; the tables cover the UI languages exactly.
import { primary } from './lang.js';
import { intl, intlSupports } from './intl.js';
import { own } from '../util/value.js';

// Fallback month names (CLDR stand-alone forms) for the UI languages: [short, long, numeric separator, unpadded month].
// The numeric form mirrors ICU's {month:'2-digit',year:'numeric'} output (de '05/2021', es '5/2021') so it does not
// differ by engine.
const MONTHS = {
  en: ['Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec',
    'January February March April May June July August September October November December', '/'],
  ru: ['янв. февр. март апр. май июнь июль авг. сент. окт. нояб. дек.',
    'январь февраль март апрель май июнь июль август сентябрь октябрь ноябрь декабрь', '.'],
  de: ['Jan. Feb. März Apr. Mai Juni Juli Aug. Sept. Okt. Nov. Dez.',
    'Januar Februar März April Mai Juni Juli August September Oktober November Dezember', '/'],
  fr: ['janv. févr. mars avr. mai juin juil. août sept. oct. nov. déc.',
    'janvier février mars avril mai juin juillet août septembre octobre novembre décembre', '/'],
  es: ['ene feb mar abr may jun jul ago sept oct nov dic',
    'enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre', '/', 1],
  uk: ['січ. лют. бер. квіт. трав. черв. лип. серп. вер. жовт. лист. груд.',
    'січень лютий березень квітень травень червень липень серпень вересень жовтень листопад грудень', '.'],
  ka: ['იან. თებ. მარ. აპრ. მაი. ივნ. ივლ. აგვ. სექ. ოქტ. ნოე. დეკ.',
    'იანვარი თებერვალი მარტი აპრილი მაისი ივნისი ივლისი აგვისტო სექტემბერი ოქტომბერი ნოემბერი დეკემბერი', '.'],
};

// Exact tag first, then primary ('de-AT' -> 'de'). Unknown language: numeric 'MM/YYYY' — neutral, never wrong-language.
// t[3] (es only) disables zero padding, matching ICU's Spanish numeric month.
export function formatDateFallback(y, mo, lang, fmt) {
  const t = own(MONTHS, lang) || own(MONTHS, primary(lang));
  if (!t || fmt === 'numeric') return (t && t[3] ? String(mo) : String(mo).padStart(2, '0')) + (t ? t[2] : '/') + y;
  return t[fmt === 'monthLong' ? 1 : 0].split(' ')[mo - 1] + ' ' + y;
}

// Month mo (1-12) of year y. fmt: month | monthLong | numeric.
export function formatYearMonth(y, mo, lang, fmt = 'month') {
  if (!intlSupports('DateTimeFormat', lang)) return formatDateFallback(y, mo, lang, fmt);
  const opt = fmt === 'monthLong' ? { month: 'long', year: 'numeric', timeZone: 'UTC' }
    : fmt === 'numeric' ? { month: '2-digit', year: 'numeric', timeZone: 'UTC' }
      : { month: 'short', year: 'numeric', timeZone: 'UTC' };
  // Day 15 at UTC with timeZone:'UTC': no offset can move a mid-month instant into a neighbouring month.
  try {
    const parts = intl('DateTimeFormat', lang, opt).formatToParts(new Date(Date.UTC(y, mo - 1, 15)));
    // Drop a trailing literal that follows the year (Russian " г.", Ukrainian " р.") so ranges stay compact, but keep
    // meaningful suffixes after the month (zh/ja "2021年5月", ko "2021년 5월").
    while (parts.length > 1 && parts[parts.length - 1].type === 'literal' && parts[parts.length - 2].type === 'year') parts.pop();
    while (parts.length && parts[0].type === 'literal') parts.shift();
    return parts.map((p) => p.value).join('');
  } catch (e) {
    return String(mo).padStart(2, '0') + '/' + y;
  }
}
