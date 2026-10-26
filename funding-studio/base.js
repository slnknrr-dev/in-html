// funding-studio/base.js - constants of the funding product (prefix 'fd', format 'fd-funding'): regions, languages,
// device widths, payment methods and their currencies, slugs.
import { PAYPAL_CURRENCIES, TBC_CURRENCIES } from '../payments/money.js';
import { str } from '../util/value.js';

export const VERSION = '1.0.0';
export const FORMAT = 'fd-funding';
export const PREFIX = 'fd';

// Viewer dictionary languages (exported page strings) = editor UI languages.
export const UI_LANGS = ['en', 'ru', 'uk', 'de', 'fr', 'es', 'ka'];

// header: navigation; main: the pages (campaigns and the thank-you page); footer.
export const REGIONS = ['header', 'main', 'footer'];

export const DEVICES = { desktop: 1280, tablet: 768, phone: 390 };

// Payment methods in their default order. 'server': the backend creates a checkout; 'static': works without a server.
export const METHODS = ['stripe', 'paypal', 'tbc', 'bank', 'btc', 'eth'];
export const SERVER_METHODS = ['stripe', 'paypal', 'tbc'];
export const CRYPTO_METHODS = ['btc', 'eth'];

// Currencies a method accepts (null = any ISO code).
export const METHOD_CURRENCIES = { stripe: null, paypal: PAYPAL_CURRENCIES, tbc: TBC_CURRENCIES, bank: null, btc: null, eth: null };

export const INTERVALS = ['once', 'month'];

// Share targets of the share block.
export const SHARE_NETS = ['native', 'copy', 'x', 'facebook', 'telegram', 'whatsapp', 'linkedin', 'email', 'qr'];

// Page addresses: lower-case [a-z0-9-] segments; first segments the exports and the server use are reserved.
export const RESERVED_SLUGS = new Set(['api', 'admin', 'assets', 's', 'c', 'data', 'index', '404', 'public', 'receipts']);
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;

// NFKD splits accented letters into base + combining mark, and the U+0300-U+036F range (combining diacritics) is
// removed, so 'café' -> 'cafe'. Everything else non-[a-z0-9] collapses to '-'. Max 60 chars, no leading/trailing '-'.
// ASCII-only slugs: they survive every file system, ZIP tool and URL without percent-encoding.
export function normSlug(v) {
  const s = str(v).trim().toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return SLUG_RE.test(s) ? s : '';
}

// Latin transliteration of Cyrillic and Georgian for slugs made from titles.
// Without it a Georgian or Russian title would normalise to an empty slug. Simplified, URL-friendly (not ISO 9 or
// the national standard: aspirated/ejective Georgian pairs like თ/ტ both map to 't'). Lookup via hasOwnProperty so
// no character can resolve to an Object.prototype member.
const TR = {
  а: 'a', б: 'b', в: 'v', г: 'g', ґ: 'g', д: 'd', е: 'e', є: 'ye', ё: 'yo', ж: 'zh', з: 'z', и: 'i', і: 'i', ї: 'yi', й: 'y', к: 'k',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ა: 'a', ბ: 'b', გ: 'g', დ: 'd', ე: 'e', ვ: 'v', ზ: 'z', თ: 't', ი: 'i', კ: 'k', ლ: 'l', მ: 'm', ნ: 'n', ო: 'o', პ: 'p', ჟ: 'zh',
  რ: 'r', ს: 's', ტ: 't', უ: 'u', ფ: 'p', ქ: 'k', ღ: 'gh', ყ: 'q', შ: 'sh', ჩ: 'ch', ც: 'ts', ძ: 'dz', წ: 'ts', ჭ: 'ch', ხ: 'kh',
  ჯ: 'j', ჰ: 'h',
};
export function slugFromTitle(title) {
  return normSlug(str(title).toLowerCase().replace(/[Ѐ-ӿႠ-ჿ]/g, (c) => (Object.prototype.hasOwnProperty.call(TR, c) ? TR[c] : '')));
}

export const ISO_RE = /^[A-Z]{3}$/;
