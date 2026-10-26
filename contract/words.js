// contract/words.js - numbers and money amounts in words for contracts: Russian and Ukrainian with gender and plural
// agreement (одна тысяча, две тысячи, пять тысяч; один рубль, два рубля, пять рублей), English (British style with
// "and"). Other languages have no words (the callers print digits only).
//
//   numberWords(n, lang, gender?) -> string | ''    gender 'm' (default) | 'f' | 'n' agrees the last group (ru, uk)
//   slavicPlural(n, [one, few, many]) -> form       ru / uk plural of an integer
//   CURRENCIES  { code: { symbol, decimals, units: { lang: { major: [one, few, many, gender], minor: [...] } } } }
//   currencyOf(code) -> entry | null   currencyUnit(code, lang, n, minor?) -> 'рублей' (the unit agreeing with n)
//   currencyGender(code, lang) -> 'm' | 'f' | 'n'
//   hasWords(lang)

// Tables: units by gender (only 1 and 2 differ: один/одна/одно, два/две; other digits fall back to units.m),
// teens 10..19, tens, hundreds, and scales [one, few, many, gender of the scale word]. The scale's own gender drives
// the agreement of its multiplier: "одна тысяча", "две тысячи" (тысяча is feminine), "один миллион" (masculine).
const RU = {
  zero: 'ноль',
  units: { m: ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'], f: ['', 'одна', 'две'], n: ['', 'одно', 'два'] },
  teens: ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'],
  tens: ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'],
  hundreds: ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'],
  scales: [['тысяча', 'тысячи', 'тысяч', 'f'], ['миллион', 'миллиона', 'миллионов', 'm'], ['миллиард', 'миллиарда', 'миллиардов', 'm'], ['триллион', 'триллиона', 'триллионов', 'm']],
};
const UK = {
  zero: 'нуль',
  units: { m: ['', 'один', 'два', 'три', 'чотири', 'п’ять', 'шість', 'сім', 'вісім', 'дев’ять'], f: ['', 'одна', 'дві'], n: ['', 'одне', 'два'] },
  teens: ['десять', 'одинадцять', 'дванадцять', 'тринадцять', 'чотирнадцять', 'п’ятнадцять', 'шістнадцять', 'сімнадцять', 'вісімнадцять', 'дев’ятнадцять'],
  tens: ['', '', 'двадцять', 'тридцять', 'сорок', 'п’ятдесят', 'шістдесят', 'сімдесят', 'вісімдесят', 'дев’яносто'],
  hundreds: ['', 'сто', 'двісті', 'триста', 'чотириста', 'п’ятсот', 'шістсот', 'сімсот', 'вісімсот', 'дев’ятсот'],
  scales: [['тисяча', 'тисячі', 'тисяч', 'f'], ['мільйон', 'мільйони', 'мільйонів', 'm'], ['мільярд', 'мільярди', 'мільярдів', 'm'], ['трильйон', 'трильйони', 'трильйонів', 'm']],
};
const SLAVIC = { ru: RU, uk: UK };

// East Slavic plural: 11..14 are always "many" (одиннадцать рублей) despite ending in 1..4; otherwise the last digit
// picks one (1), few (2..4) or many (0, 5..9). Tested on n mod 100, so 111 and 1011 follow the teen rule too.
export function slavicPlural(n, forms) {
  const a = Math.abs(Math.trunc(n)) % 100, b = a % 10;
  if (a >= 11 && a <= 14) return forms[2];
  if (b === 1) return forms[0];
  if (b >= 2 && b <= 4) return forms[1];
  return forms[2];
}

// Words of 1..999 in a Slavic language for a gender.
function slavicTriad(L, n, g) {
  const out = [];
  const h = Math.floor(n / 100), t = Math.floor(n / 10) % 10, u = n % 10;
  if (h) out.push(L.hundreds[h]);
  if (t === 1) out.push(L.teens[u]);
  else {
    if (t) out.push(L.tens[t]);
    if (u) out.push((u <= 2 && L.units[g][u]) || L.units.m[u]);
  }
  return out;
}

// Groups of three digits, least significant first; empty groups are skipped ("миллион пять", no "ноль тысяч").
// Only the last group (i === 0) agrees with the caller's gender (the noun after the number: "одна гривна"); higher
// groups agree with their scale word.
function slavicWords(L, n, g) {
  if (n === 0) return L.zero;
  const groups = [];
  for (let x = n; x > 0; x = Math.floor(x / 1000)) groups.push(x % 1000);
  const out = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const v = groups[i];
    if (!v) continue;
    if (i === 0) out.push(...slavicTriad(L, v, g));
    else {
      const sc = L.scales[i - 1];
      out.push(...slavicTriad(L, v, sc[3]), slavicPlural(v, sc));
    }
  }
  return out.join(' ');
}

const EN_UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const EN_SCALES = ['thousand', 'million', 'billion', 'trillion'];
function enBelow100(n) { return n < 20 ? EN_UNITS[n] : EN_TENS[Math.floor(n / 10)] + (n % 10 ? '-' + EN_UNITS[n % 10] : ''); }
function enTriad(n, and) {
  const h = Math.floor(n / 100), r = n % 100;
  const out = [];
  if (h) out.push(EN_UNITS[h] + ' hundred');
  if (r) out.push((h || and ? 'and ' : '') + enBelow100(r));
  return out.join(' ');
}
function enWords(n) {
  if (n === 0) return 'zero';
  const groups = [];
  for (let x = n; x > 0; x = Math.floor(x / 1000)) groups.push(x % 1000);
  const out = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const v = groups[i];
    if (!v) continue;
    // "one thousand and five": the last group under 100 after higher groups takes "and".
    out.push(enTriad(v, i === 0 && groups.length > 1 && v < 100) + (i ? ' ' + EN_SCALES[i - 1] : ''));
  }
  return out.join(' ');
}

// numberWords stops below 1e15: beyond 2^53 (~9e15) integers are not exact in a double, and the scale tables end
// before quadrillion. An empty string makes moneyText fall back to digits only, never to wrong words.
export const hasWords = (lang) => /^(ru|uk|en)(-|$)/i.test(String(lang || ''));

// Integer part of |n| in words ('' for languages without words or numbers outside ±10^15).
export function numberWords(n, lang = 'en', gender = 'm') {
  const v = Math.trunc(Math.abs(+n));
  if (!Number.isFinite(v) || v >= 1e15) return '';
  const p = String(lang || '').toLowerCase().split('-')[0];
  const minus = +n < 0 ? { ru: 'минус ', uk: 'мінус ', en: 'minus ' }[p] || '' : '';
  if (SLAVIC[p]) return minus + slavicWords(SLAVIC[p], v, gender === 'f' || gender === 'n' ? gender : 'm');
  if (p === 'en') return minus + enWords(v);
  return '';
}

// Units agree with the integer amount in ru / uk ([one, few, many, gender]); English [one, other].
// Unit tables: ru/uk [one, few, many, gender] (gender drives numberWords agreement: "одна гривна", "один доллар");
// en [singular, plural] chosen by n === 1. Indeclinable units (евро, лари, тенге) repeat one form three times so the
// lookup path stays uniform. Country-qualified names ("доллар США") follow Russian legal drafting practice.
export const CURRENCIES = {
  RUB: { symbol: '₽', decimals: 2, units: {
    ru: { major: ['рубль', 'рубля', 'рублей', 'm'], minor: ['копейка', 'копейки', 'копеек', 'f'] },
    uk: { major: ['рубль', 'рублі', 'рублів', 'm'], minor: ['копійка', 'копійки', 'копійок', 'f'] },
    en: { major: ['rouble', 'roubles'], minor: ['kopeck', 'kopecks'] } } },
  USD: { symbol: '$', decimals: 2, units: {
    ru: { major: ['доллар США', 'доллара США', 'долларов США', 'm'], minor: ['цент', 'цента', 'центов', 'm'] },
    uk: { major: ['долар США', 'долари США', 'доларів США', 'm'], minor: ['цент', 'центи', 'центів', 'm'] },
    en: { major: ['US dollar', 'US dollars'], minor: ['cent', 'cents'] } } },
  EUR: { symbol: '€', decimals: 2, units: {
    ru: { major: ['евро', 'евро', 'евро', 'm'], minor: ['евроцент', 'евроцента', 'евроцентов', 'm'] },
    uk: { major: ['євро', 'євро', 'євро', 'm'], minor: ['євроцент', 'євроценти', 'євроцентів', 'm'] },
    en: { major: ['euro', 'euros'], minor: ['cent', 'cents'] } } },
  UAH: { symbol: '₴', decimals: 2, units: {
    ru: { major: ['гривна', 'гривны', 'гривен', 'f'], minor: ['копейка', 'копейки', 'копеек', 'f'] },
    uk: { major: ['гривня', 'гривні', 'гривень', 'f'], minor: ['копійка', 'копійки', 'копійок', 'f'] },
    en: { major: ['hryvnia', 'hryvnias'], minor: ['kopiyka', 'kopiykas'] } } },
  GEL: { symbol: '₾', decimals: 2, units: {
    ru: { major: ['лари', 'лари', 'лари', 'm'], minor: ['тетри', 'тетри', 'тетри', 'm'] },
    uk: { major: ['ларі', 'ларі', 'ларі', 'm'], minor: ['тетрі', 'тетрі', 'тетрі', 'm'] },
    en: { major: ['lari', 'lari'], minor: ['tetri', 'tetri'] } } },
  KZT: { symbol: '₸', decimals: 2, units: {
    ru: { major: ['тенге', 'тенге', 'тенге', 'm'], minor: ['тиын', 'тиына', 'тиынов', 'm'] },
    uk: { major: ['тенге', 'тенге', 'тенге', 'm'], minor: ['тиїн', 'тиїни', 'тиїнів', 'm'] },
    en: { major: ['tenge', 'tenge'], minor: ['tiyn', 'tiyn'] } } },
  BYN: { symbol: 'Br', decimals: 2, units: {
    ru: { major: ['белорусский рубль', 'белорусских рубля', 'белорусских рублей', 'm'], minor: ['копейка', 'копейки', 'копеек', 'f'] },
    uk: { major: ['білоруський рубль', 'білоруські рублі', 'білоруських рублів', 'm'], minor: ['копійка', 'копійки', 'копійок', 'f'] },
    en: { major: ['Belarusian rouble', 'Belarusian roubles'], minor: ['kopeck', 'kopecks'] } } },
  GBP: { symbol: '£', decimals: 2, units: {
    ru: { major: ['фунт стерлингов', 'фунта стерлингов', 'фунтов стерлингов', 'm'], minor: ['пенни', 'пенни', 'пенни', 'n'] },
    uk: { major: ['фунт стерлінгів', 'фунти стерлінгів', 'фунтів стерлінгів', 'm'], minor: ['пенні', 'пенні', 'пенні', 'n'] },
    en: { major: ['pound sterling', 'pounds sterling'], minor: ['penny', 'pence'] } } },
};

// The currency entry of a code (own keys only: 'constructor' is not a currency).
export const currencyOf = (code) => {
  const k = String(code || '').toUpperCase();
  return Object.prototype.hasOwnProperty.call(CURRENCIES, k) ? CURRENCIES[k] : null;
};

export function currencyUnit(code, lang, n, minor = false) {
  const c = currencyOf(code);
  if (!c) return String(code || '');
  const p = String(lang || '').toLowerCase().split('-')[0];
  const u = c.units[p];
  if (!u) return String(code).toUpperCase();
  const forms = minor ? u.minor : u.major;
  if (forms.length === 2) return Math.abs(n) === 1 ? forms[0] : forms[1];
  return slavicPlural(n, forms);
}
export const currencyGender = (code, lang) => {
  const c = currencyOf(code);
  const u = c && c.units[String(lang || '').toLowerCase().split('-')[0]];
  return (u && u.major[3]) || 'm';
};
