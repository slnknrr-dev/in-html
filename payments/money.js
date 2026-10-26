// payments/money.js - money amounts and currencies: ISO 4217 minor units, decimal parsing without float drift, minor
// unit conversion (ISO and the providers' own rules), formatting, conversion with fixed rates.
//
//   minorUnits(cur) -> 0 | 2 | 3 | 4              ISO 4217 exponent (2 for unknown codes)
//   isCurrency(cur) -> bool                       /^[A-Z]{3}$/
//   parseAmount(text) -> number | null            '12,50' / '1 234.5' / '1.234,50' -> 12.5 / 1234.5 / 1234.5
//   roundAmount(n, cur) -> number                 rounded to the currency's minor units
//   toMinor(n, cur, digits?) -> integer           12.5 EUR -> 1250 (digits overrides the exponent)
//   fromMinor(i, cur, digits?) -> number          1250 EUR -> 12.5
//   decimalString(n, digits) -> '12.50'           fixed notation without exponent
//   stripeMinor(n, cur) / stripeMajor(i, cur)     Stripe's unit_amount rules (zero-decimal and three-decimal lists)
//   paypalValue(n, cur) -> '12.50'                PayPal's `value` strings (no decimals for HUF, JPY, TWD)
//   formatMoney(n, cur, lang, opts) -> '€12.50'   Intl with a plain fallback
//   convert(n, from, to, rates) -> number | null  rates: { 'USD:EUR': 0.92, ... } (direct, inverse or via one hop)
//   PAYPAL_CURRENCIES, TBC_CURRENCIES, STRIPE_ZERO_DECIMAL, STRIPE_THREE_DECIMAL, COMMON_CURRENCIES

//
// Design rules:
// - Amounts travel as JS numbers in major units inside the app; integers in minor units exist only at provider
//   boundaries (toMinor / stripeMinor). Converting once, at the boundary, keeps float error from accumulating.
// - Each provider has its own exponent rules that differ from ISO 4217 (Stripe treats MGA as zero-decimal, PayPal
//   sends HUF / TWD without decimals although ISO says 2). Using the ISO table for a provider call is off by a factor of
//   100 on exactly those currencies, so the provider helpers never call minorUnits().
// - Parsing is locale-agnostic heuristics, not Intl: Intl has no number parser, and the UI language says nothing
//   reliable about which separator a donor types.

// ISO 4217 exponents other than 2 (current codes). Default 2 for anything else, including unknown codes: the common
// case, and the safer error (an unknown 0-decimal currency shown with .00 is cosmetic; the reverse loses cents).
const EXP = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0, RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0,
  XAF: 0, XOF: 0, XPF: 0, XAU: 0, XAG: 0, XPT: 0, XPD: 0, XDR: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
  CLF: 4, UYW: 4,
};

export const STRIPE_ZERO_DECIMAL = ['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'];
export const STRIPE_THREE_DECIMAL = ['BHD', 'JOD', 'KWD', 'OMR', 'TND'];
// Currencies PayPal accepts for payments (developer.paypal.com "Currency codes").
export const PAYPAL_CURRENCIES = ['AUD', 'BRL', 'CAD', 'CNY', 'CZK', 'DKK', 'EUR', 'HKD', 'HUF', 'ILS', 'JPY', 'MYR', 'MXN', 'TWD',
  'NZD', 'NOK', 'PHP', 'PLN', 'GBP', 'SGD', 'SEK', 'CHF', 'THB', 'USD'];
const PAYPAL_NO_DECIMALS = ['HUF', 'JPY', 'TWD'];
// TBC E-Commerce checkout currencies.
export const TBC_CURRENCIES = ['GEL', 'USD', 'EUR'];
// Suggestions for editors (any /^[A-Z]{3}$/ code is accepted).
export const COMMON_CURRENCIES = ['EUR', 'USD', 'GBP', 'GEL', 'CHF', 'PLN', 'CZK', 'SEK', 'NOK', 'DKK', 'UAH', 'TRY', 'AMD',
  'AZN', 'KZT', 'CAD', 'AUD', 'JPY'];

export const isCurrency = (c) => typeof c === 'string' && /^[A-Z]{3}$/.test(c);

export function minorUnits(cur) {
  const c = String(cur || '').toUpperCase();
  return Object.prototype.hasOwnProperty.call(EXP, c) ? EXP[c] : 2;
}

// Fixed-point text of a finite number with `digits` decimals ('12.50'); never exponent notation.
// Clamp to 8: toFixed accepts more, but v * 10 ** d leaves the exactly representable range long before that.
// KNOWN DEFECT: Math.round(v * 10 ** d) inherits binary drift: decimalString(1.005, 2) gives '1.00' (1.005 * 100 is
// 100.49999...), whereas toMinor() below gives 101. Fix: build the text from toMinor(v, '', d).
export function decimalString(n, digits = 2) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  const d = Math.max(0, Math.min(8, digits | 0));
  return (Math.round(v * 10 ** d) / 10 ** d).toFixed(d);
}

// Amount typed by a person. Spaces, apostrophes and underscores group digits. With both '.' and ',' the last one is
// the decimal separator (1.234,50 and 1,234.50). With one kind only: repeated -> thousands ('1.234.567'); once ->
// thousands when exactly three digits follow a non-zero head ('1,234' -> 1234), else decimals ('12,5', '0.500').
// Negative, empty or non-numeric input -> null.
export function parseAmount(text) {
  // Numbers pass through (already parsed); strings go through the separator heuristic below.
  // Grouping characters stripped: ASCII and no-break spaces (fr / ru Intl output), apostrophes (de-CH), underscores.
  if (typeof text === 'number') return Number.isFinite(text) && text >= 0 ? text : null;
  let s = String(text == null ? '' : text).trim().replace(/[\s  '’_]/g, '');
  if (!s || !/^[0-9.,]+$/.test(s)) return null;
  const sep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  if (sep >= 0) {
    const ch = s[sep];
    const other = ch === '.' ? ',' : '.';
    const head = s.slice(0, sep);
    const tail = s.slice(sep + 1);
    if (s.includes(other)) s = head.split(other).join('') + '.' + tail;
    else if (head.includes(ch) || (tail.length === 3 && /^[1-9]\d{0,2}$/.test(head))) s = s.split(ch).join('');
    else s = head + '.' + tail;
  }
  // After normalisation at most one '.' may remain; leftovers such as a lone '.' or '1.2.3' fail here.
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

export function roundAmount(n, cur) {
  const d = minorUnits(cur);
  return Math.round(Number(n) * 10 ** d) / 10 ** d;
}

// Integer minor units by decimal arithmetic on the decimal text of the number (12.345 EUR -> 1235).
// Why text, not Math.round(v * 100): 12.345 is stored as 12.34499999..., so multiplying loses the half-up. toFixed(d + 4)
// first rounds at 4 guard digits, which absorbs that drift; then half-up is decided on digit d alone (half away from
// zero, symmetric for negatives). Caveat: the guard rounding is a double rounding, so 0.0049999 at d = 2 becomes 0.0050
// and rounds up; irrelevant for typed amounts, which never carry 5+ decimals.
export function toMinor(n, cur, digits) {
  const d = digits == null ? minorUnits(cur) : digits;
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  const neg = v < 0;
  const [ip, fp = ''] = Math.abs(v).toFixed(Math.min(20, d + 4)).split('.');
  const frac = (fp + '0'.repeat(d + 1)).slice(0, d + 1);
  let i = Number(ip) * 10 ** d + (d ? Number(frac.slice(0, d)) : 0);
  if (Number(frac[d]) >= 5) i += 1;
  return neg ? -i : i;
}

export function fromMinor(i, cur, digits) {
  const d = digits == null ? minorUnits(cur) : digits;
  return Number(i) / 10 ** d;
}

// Stripe unit_amount: zero-decimal currencies as is, three-decimal ones in thousandths rounded to a multiple of 10.
// The multiple-of-10 rule is Stripe's documented requirement for BHD / JOD / KWD / OMR / TND; other values are
// rejected by the API. Everything else, including ISO-0 ISK which Stripe lists as 2-decimal, is sent in hundredths.
export function stripeMinor(n, cur) {
  const c = String(cur).toUpperCase();
  if (STRIPE_ZERO_DECIMAL.includes(c)) return Math.round(Number(n));
  if (STRIPE_THREE_DECIMAL.includes(c)) return Math.round(toMinor(n, c, 3) / 10) * 10;
  return toMinor(n, c, 2);
}
export function stripeMajor(i, cur) {
  const c = String(cur).toUpperCase();
  if (STRIPE_ZERO_DECIMAL.includes(c)) return Number(i);
  return Number(i) / (STRIPE_THREE_DECIMAL.includes(c) ? 1000 : 100);
}

export function paypalValue(n, cur) {
  return decimalString(n, PAYPAL_NO_DECIMALS.includes(String(cur).toUpperCase()) ? 0 : 2);
}

// Intl.NumberFormat construction is the expensive part (locale data lookup), so formatters are cached per
// (lang, currency, whole). Size cap 200: a bound against an unbounded key space (arbitrary lang strings), not an LRU.
// Fallback chain: narrowSymbol ('$' rather than 'US$') throws RangeError in older engines; then plain currency style;
// then a hand-made '12.50 EUR' when Intl rejects the locale. A null formatter is cached too, so a broken locale does
// not retry construction on every render.
const fmtCache = new Map();
export function formatMoney(n, cur, lang = 'en', opts = {}) {
  const v = Number(n) || 0;
  const c = isCurrency(cur) ? cur : 'EUR';
  const whole = opts.whole === true || (opts.whole !== false && Number.isInteger(v));
  const key = lang + '|' + c + '|' + whole;
  let f = fmtCache.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(lang, { style: 'currency', currency: c, currencyDisplay: 'narrowSymbol', ...(whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}) });
    } catch {
      try { f = new Intl.NumberFormat(lang, { style: 'currency', currency: c }); } catch { f = null; }
    }
    if (fmtCache.size < 200) fmtCache.set(key, f);
  }
  if (f) { try { return f.format(v); } catch { /* fall through */ } }
  return decimalString(v, whole ? 0 : minorUnits(c)) + ' ' + c;
}

// Rate of from -> to: direct 'FROM:TO', inverse 'TO:FROM', or through one intermediate currency.
// One hop only, deliberately: a full graph search would chain through stale rates and hide missing configuration.
// Non-positive and non-finite rates count as absent (a 0 rate would silently zero amounts). The first intermediate
// found wins, so with inconsistent tables the result depends on key insertion order.
export function rateOf(from, to, rates) {
  if (from === to) return 1;
  const r = rates && typeof rates === 'object' ? rates : {};
  const get = (a, b) => {
    const x = Number(r[a + ':' + b]);
    if (Number.isFinite(x) && x > 0) return x;
    const y = Number(r[b + ':' + a]);
    return Number.isFinite(y) && y > 0 ? 1 / y : null;
  };
  const d = get(from, to);
  if (d) return d;
  const mids = new Set();
  for (const k of Object.keys(r)) for (const c of k.split(':')) if (c !== from && c !== to) mids.add(c);
  for (const m of mids) {
    const a = get(from, m);
    const b = a && get(m, to);
    if (a && b) return a * b;
  }
  return null;
}

export function convert(n, from, to, rates) {
  const k = rateOf(from, to, rates);
  return k == null ? null : Number(n) * k;
}
