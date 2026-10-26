// landing-studio/viewer-base.js - landing constants, contact links and calendar-day fallbacks.
import { onAccent } from '../color/color.js';
import { normURL } from '../html/url.js';
import { primary } from '../i18n/lang.js';
import { own, pad2, str } from '../util/value.js';
//
// Dependency-free leaf of the viewer graph: constants and tiny pure helpers every viewer module may import without
// creating cycles. Nothing here touches the DOM or document state.

const VERSION = '1.0.0';

// Block colour tones (section, hero, nav, cta, …): auto follows the page, the others repaint the block.
const TONES = ['auto', 'muted', 'dark', 'accent', 'light'];

// Viewer dictionary languages (UI strings pre-rendered into exports); also the editor UI languages.
const UI_LANGS = ['en', 'ru', 'uk', 'de', 'fr', 'es', 'ka'];

// Page regions in document order. header normally holds the nav, footer the footer, main the sections.
const REGIONS = ['header', 'main', 'footer'];

// Editor canvas / preview device widths (px). Layout responds through container queries only (CONTRACT.md §3).
const DEVICES = { desktop: 1280, laptop: 1024, tablet: 768, phone: 390 };

// Contact kinds double as ICONS keys (viewer-icons.js) and as switch labels in contactHref; adding one needs both.
const CONTACT_KINDS = ['email', 'phone', 'web', 'location', 'linkedin', 'github', 'codeberg', 'gitlab',
  'telegram', 'whatsapp', 'x', 'mastodon', 'skype', 'birth', 'other', 'address', 'hours'];

// ISO 4217 suggestions for the shop currency (any /^[A-Z]{3}$/ code is accepted).
const CURRENCIES = ['GEL', 'USD', 'EUR', 'RUB', 'UAH', 'GBP', 'CHF', 'PLN', 'TRY', 'KZT', 'AMD', 'AZN', 'CNY', 'JPY'];

const REQ_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

// Day-precision fallback (CLDR "format" context, i.e. the forms used together with a day number — Russian/Ukrainian
// genitive "12 мая", "12 травня"): [short months, long months, pattern]. Pattern tokens: d = day, M = month name,
// y = year. Used when Intl lacks the locale (see coreDayFallback; formatDay in the commerce part may rely on it).
const CORE_MONTHS_FMT = {
  en: ['Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec',
    'January February March April May June July August September October November December', 'M d, y'],
  ru: ['янв. февр. мар. апр. мая июн. июл. авг. сент. окт. нояб. дек.',
    'января февраля марта апреля мая июня июля августа сентября октября ноября декабря', 'd M y'],
  uk: ['січ. лют. бер. квіт. трав. черв. лип. серп. вер. жовт. лист. груд.',
    'січня лютого березня квітня травня червня липня серпня вересня жовтня листопада грудня', 'd M y'],
  de: ['Jan. Feb. März Apr. Mai Juni Juli Aug. Sept. Okt. Nov. Dez.',
    'Januar Februar März April Mai Juni Juli August September Oktober November Dezember', 'd. M y'],
  fr: ['janv. févr. mars avr. mai juin juil. août sept. oct. nov. déc.',
    'janvier février mars avril mai juin juillet août septembre octobre novembre décembre', 'd M y'],
  es: ['ene feb mar abr may jun jul ago sept oct nov dic',
    'enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre', 'd de M de y'],
  ka: ['იან. თებ. მარ. აპრ. მაი. ივნ. ივლ. აგვ. სექ. ოქტ. ნოე. დეკ.',
    'იანვარი თებერვალი მარტი აპრილი მაისი ივნისი ივლისი აგვისტო სექტემბერი ოქტომბერი ნოემბერი დეკემბერი', 'd M, y'],
};

// Built-in day formatting (y, month 1..12, day): long → full month names; withYear false drops the year (and the
// separator in front of it). Unknown languages use the neutral ISO date.
// own() instead of obj[lang]: a lang like 'constructor' must not resolve to Object.prototype members.
function coreDayFallback(y, mo, d, lang, long = false, withYear = true) {
  const t = own(CORE_MONTHS_FMT, lang) || own(CORE_MONTHS_FMT, primary(lang));
  if (!t) return withYear ? y + '-' + pad2(mo) + '-' + pad2(d) : pad2(mo) + '-' + pad2(d);
  const name = t[long ? 1 : 0].split(' ')[mo - 1];
  let p = t[2];
  // Strip the trailing year token with its separator (', ', ' ', ' de '), so 'd de M de y' becomes 'd de M'.
  if (!withYear) p = p.replace(/(,? de |,? )y$/, '');
  // Single-pass replace: substituting tokens one by one would corrupt month names containing d/M/y letters.
  return p.replace(/[dMy]/g, (c) => (c === 'd' ? String(d) : c === 'M' ? name : String(y)));
}

// Build a link from a contact entry. An explicit href wins (normURL sanitizes the scheme); otherwise derive one
// per kind from the value. Handles accept '@name' or a full URL. Kinds with no canonical link return '' and render
// as plain text rather than a guessed, possibly wrong link.
function contactHref(item) {
  if (!item) return '';
  const href = str(item.href).trim();
  if (href) return normURL(href);
  const v = str(item.value).trim();
  if (!v) return '';
  const isURL = /^https?:\/\//i.test(v);
  const handle = v.replace(/^@/, '');
  switch (item.kind) {
    case 'email': return /^mailto:/i.test(v) ? v : 'mailto:' + v.replace(/\s+/g, '');
    // tel: keeps digits and '+' only (RFC 3966 visual separators dropped). KNOWN DEFECT: a value with no digits
    // yields a bare 'tel:' link. Fix: return '' when the stripped number is empty.
    case 'phone': return 'tel:' + v.replace(/[^\d+]/g, '');
    case 'whatsapp': return isURL ? v : 'https://wa.me/' + v.replace(/\D/g, '');
    case 'web': return isURL ? v : normURL(v) || 'https://' + v.replace(/\s+/g, '');
    case 'github': return isURL ? v : 'https://github.com/' + handle;
    case 'codeberg': return isURL ? v : 'https://codeberg.org/' + handle;
    case 'gitlab': return isURL ? v : 'https://gitlab.com/' + handle;
    case 'linkedin': return isURL ? v : 'https://www.linkedin.com/in/' + handle;
    case 'telegram': return isURL ? v : 'https://t.me/' + handle;
    case 'x': return isURL ? v : 'https://x.com/' + handle;
    case 'mastodon': {
      if (isURL) return v;
      // Fediverse handle user@instance.tld -> https://instance/@user; there is no global host to fall back on.
      const m = /^@?([^@\s]+)@([^@\s]+\.[^@\s]+)$/.exec(v);
      return m ? 'https://' + m[2] + '/@' + m[1] : '';
    }
    // A street address opens a map search (OpenStreetMap: no tracking, no API key).
    case 'address': return isURL ? v : 'https://www.openstreetmap.org/search?query=' + encodeURIComponent(v.replace(/\s+/g, ' '));
    default: return ''; // location, hours, birth, skype, other → no link
  }
}

// True when a parseable colour is dark (white text reads better on it than near-black).
// Reuses the contrast decision of onAccent so 'dark' means exactly what text colour selection means elsewhere.
const isDarkColor = (c) => onAccent(c) === '#fff';

export {
  CONTACT_KINDS,
  CORE_MONTHS_FMT,
  CURRENCIES,
  DEVICES,
  REGIONS,
  REQ_METHODS,
  TONES,
  UI_LANGS,
  VERSION,
  contactHref,
  coreDayFallback,
  isDarkColor
};
