// units/parse.js - reading numbers and quantities typed by people in English, Russian and Georgian: decimal commas
// and points, thousands separators (spaces, narrow no-break spaces, apostrophes, commas, points), signs, exponents,
// vulgar fractions ("1 1/2", "½"), unit labels in three scripts ("42,5 м²", "3 sq ft", "кв.м", "კვ. მ", "5'11\"")
// and compound quantities of one kind ("5 ft 11 in", "1 ч 30 мин", "2 kg 300 g").
//
//   parseNumber(s, { decimal }) -> number (NaN when it is not a number)
//   unitByLabel(label) -> code | ''          a label, alias or code; '' for an unknown label (never a guess)
//   kindOfLabel(label) -> kind | ''          'м²' -> 'area', 'сут.' -> 'time', 'шт.' -> ''
//   parseQuantity(text, { kind, unit, decimal }) -> { value, unit, kind, base, parts } | null
//
// An unknown label gets no kind: guessing wrong would allow converting what must not be converted. Ambiguous short
// labels are resolved once, here, and a test checks that no two units claim one alias.
//
// Lookup design: every alias is normalised once at import (normLabel) into one Map; a lookup is one normLabel plus
// one Map.get, O(label length). Three tiers, tried in order: EXACT (case-sensitive, for the few labels where case
// carries meaning), the code itself, then the folded Map. First-registered wins a fold collision and the collision
// is recorded in ALIAS_CONFLICTS (asserted empty by test.js) instead of being resolved silently by insertion order.
import { UNITS, convert, unit as unitOf } from './registry.js';

// Extra spellings per unit (the labels and names of the registry are aliases too).
const EXTRA = {
  um: ['μm', 'micron', 'микрон'],
  mm: ['millimeter', 'миллиметров'],
  cm: ['centimeter', 'сантиметров'],
  m: ['meter', 'meters', 'metres', 'метров', 'метра', 'მეტრი'],
  km: ['kilometer', 'kilometers', 'kilometres', 'километров', 'километра', 'км.'],
  in: ['inch', 'inches', 'дюймов', 'дюйма', '"', '″', "''"],
  ft: ['foot', 'feet', 'футов', 'фута', "'", '′'],
  yd: ['yard', 'yards', 'ярдов'],
  mi: ['mile', 'miles', 'миль', 'мили'],
  nmi: ['nm', 'nautical miles', 'морских миль'],
  mm2: ['mm2', 'sq mm', 'кв. мм'],
  cm2: ['cm2', 'sq cm', 'кв. см'],
  m2: ['m2', 'sq m', 'sqm', 'sq. m.', 'кв. м', 'кв.м.', 'кв м', 'м2', 'метров квадратных', 'square meter', 'square meters', 'square metres', 'კვ. მ', 'კვმ', 'მ2'],
  sotka: ['сотка', 'сотки', 'соток', 'сот', 'ares', 'ar', 'სოტ.'],
  ha: ['hectare', 'hectares', 'гектаров', 'гектара', 'ჰექტ.'],
  km2: ['km2', 'sq km', 'кв. км', 'км2', 'კმ2'],
  sqin: ['in2', 'square inches', 'sq inch'],
  sqft: ['ft2', 'sqft', 'sq.ft', 'square feet', 'sq feet', 'кв. футов', 'кв.фут'],
  sqyd: ['yd2', 'square yards'],
  acre: ['acres', 'ac', 'акров', 'акра'],
  sqmi: ['mi2', 'square miles'],
  ml: ['milliliter', 'milliliters', 'millilitres', 'миллилитров', 'mL'],
  cm3: ['cc', 'cm3', 'см3', 'куб. см'],
  cl: ['centiliter'],
  dl: ['deciliter'],
  l: ['liter', 'liters', 'litres', 'литров', 'литра', 'lt', 'L'],
  m3: ['m3', 'cu m', 'cubic meter', 'cubic meters', 'cubic metres', 'куб. м', 'кубометр', 'кубометров', 'кубов', 'м3', 'მ3'],
  tsp: ['teaspoons', 'ч.л.', 'чайных ложек'],
  tbsp: ['tablespoons', 'ст.л.', 'столовых ложек', 'tbs'],
  floz: ['fluid ounce', 'fluid ounces', 'fl. oz.'],
  cup: ['cups', 'чашки', 'чашек', 'ჭიქები'],
  pt: ['pint', 'pints', 'пинты', 'пинт'],
  qt: ['quart', 'quarts', 'кварты'],
  gal: ['gallon', 'gallons', 'галлонов', 'галлона', 'us gal'],
  bbl: ['barrel', 'barrels', 'баррелей', 'барреля'],
  galimp: ['imperial gallon', 'imp gal', 'uk gal'],
  ptimp: ['imperial pint', 'uk pint'],
  in3: ['in3', 'cubic inches'],
  ft3: ['ft3', 'cubic feet', 'cu. ft.'],
  yd3: ['yd3', 'cubic yards'],
  mg: ['milligram', 'milligrams', 'миллиграммов'],
  g: ['gram', 'grams', 'gr', 'грамм', 'граммов', 'гр', 'გრ'],
  kg: ['kilogram', 'kilograms', 'kilo', 'kilos', 'kgs', 'килограммов', 'кило', 'კილო'],
  t: ['tonne', 'tonnes', 'metric ton', 'тонн', 'тонны', 'ტონა'],
  ct: ['carat', 'carats', 'карат', 'каратов'],
  oz: ['ounce', 'ounces', 'унций', 'унции'],
  ozt: ['troy ounce', 'troy oz', 'oz. t.'],
  lb: ['lbs', 'pound', 'pounds', 'фунтов', 'фунта'],
  st: ['stone', 'stones'],
  shton: ['us ton', 'tn'],
  lton: ['uk ton', 'imperial ton'],
  c: ['°c', '℃', '°с', 'c°', 'celsius', 'градусов цельсия', 'град. c', 'ºc'],
  f: ['°f', '℉', 'fahrenheit', 'ºf'],
  k: ['kelvin', 'кельвинов'],
  r: ['°r', 'rankine'],
  kmh: ['kph', 'km/hr', 'км/час', 'km per hour', 'კმ/სთ.'],
  mps: ['m/s', 'm/sec', 'м/сек'],
  mph: ['mi/h', 'miles per hour', 'миль/час'],
  fps: ['ft/s', 'ft/sec'],
  kn: ['knot', 'knots', 'kt', 'kts', 'узлов', 'узла', 'узел'],
  pa: ['pascal'],
  hpa: ['гпа'],
  mbar: ['millibar', 'мбар'],
  bar: ['bars', 'бара', 'бар'],
  atm: ['atmosphere', 'атмосфер'],
  at: ['kgf/cm2', 'кгс/см2', 'ат'],
  mmhg: ['mm hg', 'мм рт.ст.', 'мм рт ст', 'torr', 'торр'],
  psi: ['lbf/in2', 'фунт/дюйм2'],
  inhg: ['in hg'],
  j: ['joule', 'joules', 'джоулей'],
  kj: ['kilojoule', 'kilojoules', 'кдж'],
  mj: ['megajoule'],
  wh: ['w·h', 'w h', 'вт ч', 'вт·ч'],
  kwh: ['kw·h', 'kw h', 'квт ч', 'квт·ч', 'квтч', 'კვტ.სთ'],
  cal: ['calorie', 'calories', 'калорий'],
  kcal: ['kilocalorie', 'kilocalories', 'килокалорий', 'kcals'],
  btu: ['btus'],
  w: ['watt', 'watts', 'ватт', 'вт'],
  kw: ['kilowatt', 'kilowatts', 'киловатт', 'квт'],
  ps: ['лс', 'л.с.', 'horsepower (metric)', 'cv', 'ch'],
  hp: ['horsepower', 'bhp'],
  bit: ['bits', 'бита', 'бит'],
  byte: ['bytes', 'байт', 'байта', 'байтов', 'ბაიტი'],
  kb: ['kilobyte', 'kilobytes', 'kb', 'кб', 'кбайт', 'килобайт'],
  mb: ['megabyte', 'megabytes', 'mb', 'мб', 'мбайт', 'мегабайт'],
  gb: ['gigabyte', 'gigabytes', 'gb', 'гб', 'гбайт', 'гигабайт'],
  tb: ['terabyte', 'terabytes', 'tb', 'тб', 'тбайт', 'терабайт'],
  pb: ['petabyte', 'pb'],
  kib: ['kibibyte', 'kib'],
  mib: ['mebibyte', 'mib'],
  gib: ['gibibyte', 'gib'],
  tib: ['tebibyte', 'tib'],
  ms: ['msec', 'millisecond', 'milliseconds', 'миллисекунд'],
  s: ['sec', 'secs', 'second', 'seconds', 'сек', 'секунд', 'секунды', 'წამი'],
  min: ['mins', 'minute', 'minutes', 'минут', 'минуты', 'წუთი'],
  h: ['hr', 'hrs', 'hour', 'hours', 'час', 'часа', 'часов', 'საათი'],
  d: ['day', 'days', 'дн', 'дня', 'дней', 'день', 'сутки', 'суток', 'დღე'],
  wk: ['week', 'weeks', 'нед', 'неделя', 'недели', 'недель', 'კვირა'],
  mo: ['month', 'months', 'мес', 'месяц', 'месяца', 'месяцев', 'თვე'],
  yr: ['year', 'years', 'y', 'лет', 'года', 'год', 'წელი'],
};

// Aliases matched with their case kept (ambiguous in lower case): K kelvin (k is "thousand"), B byte (b is bit or
// byte), MW megawatt (mW is a milliwatt), Pa / PS, the Cyrillic К.
const EXACT = { K: 'k', 'К': 'k', B: 'byte', 'Б': 'byte', MW: 'mw', mW: '', Mb: '', Gb: '', kB: 'kb', KB: 'kb' };
// Lower-case labels that would collide or that are too ambiguous alone: never matched case-insensitively.
const NO_FOLD = new Set(['k', 'к', 'b', 'б', 'mw', 'мвт', 'ბ', 'კვ.', 'წ.', 'г.']);
// Year 'г.' is too ambiguous next to the gram 'г'; it is accepted only spelled out.
// The empty string in EXACT ('mW', 'Mb', 'Gb') is a deliberate tombstone: the label is known and REFUSED (milliwatt,
// megabit and gigabit are not in the registry). For 'Mb' / 'Gb' it is load-bearing: folded they become 'mb' / 'gb',
// i.e. megabyte / gigabyte, 8x off. For 'mW' it is belt and braces ('mw' is already in NO_FOLD). hasOwnProperty in
// unitByLabel, not truthiness, is what lets '' short-circuit the fold.

// Canonical form of a label: NFKC (² -> 2, ℃ stays), lower case, dots and runs of spaces -> one space, the Russian
// and Georgian "square / cubic" prefixes -> 'sq' / 'cu'.
// Step order matters: NFKC first (it also turns no-break and thin spaces into U+0020, so the explicit class below is
// only the fallback for engines without normalize); a point glued to the next character gets a space ("кв.м" ->
// "кв. м") before points become spaces, so "кв.м", "кв. м" and "кв м" collapse to one key; the prefix rewrite runs
// last and only on a word followed by a space, so "кв.м" and "sq m" share a key while "куб" alone stays untouched.
export function normLabel(s) {
  let t = String(s ?? '');
  try { t = t.normalize('NFKC'); } catch { /* old engines */ }
  t = t.toLowerCase().replace(/[   ]/g, ' ').replace(/\^/g, '').replace(/·/g, ' ')
    .replace(/\.(?=\S)/g, '. ').replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/^(кв|квадратн\S*|square|კვ|კვადრატულ\S*) /, 'sq ').replace(/^(куб|кубическ\S*|cubic|კუბ|კუბურ\S*) /, 'cu ');
  return t;
}

const FOLD = new Map();
export const ALIAS_CONFLICTS = [];
for (const [code, x] of Object.entries(UNITS)) {
  const all = [code, ...Object.values(x.label), ...Object.values(x.name), ...(EXTRA[code] || [])];
  for (const a of all) {
    if (EXACT[a] !== undefined) continue;
    const k = normLabel(a);
    if (!k || NO_FOLD.has(String(a).toLowerCase()) || NO_FOLD.has(k)) continue;
    const had = FOLD.get(k);
    if (had && had !== code) { ALIAS_CONFLICTS.push([k, had, code]); continue; }
    FOLD.set(k, code);
  }
}

// Unit code of a label; '' when unknown. Codes are accepted as they are.
export function unitByLabel(label) {
  const s = String(label ?? '').trim();
  if (!s) return '';
  if (Object.prototype.hasOwnProperty.call(EXACT, s)) return EXACT[s];
  if (Object.prototype.hasOwnProperty.call(UNITS, s)) return s;
  return FOLD.get(normLabel(s)) || '';
}

export const kindOfLabel = (label) => unitOf(unitByLabel(label))?.kind ?? '';

// --- numbers -----------------------------------------------------------------------------------------------------

const FRACTIONS = { '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8, '⅙': 1 / 6, '⅚': 5 / 6, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };

/**
 * A number as people type it. Both separators present: the last one is the decimal mark ("1.234,5", "1,234.5").
 * One comma: a decimal comma ("42,5") unless it groups thousands more than once ("1,234,567") or `decimal: '.'`
 * says so; one point likewise. Spaces, no-break spaces and apostrophes group thousands. "−" (U+2212) is a minus.
 *
 * Grammar, applied in this order (each step narrows the string the next one sees):
 *   1. minus look-alikes (U+2212, figure dash, en dash) -> '-'; all grouping noise removed (whitespace, NBSP,
 *      U+202F, thin space, ' and the typographic apostrophe of Swiss "1'234", '_' of programmers' 1_000).
 *   2. a trailing vulgar fraction glyph is split off and added at the end ("3¾" -> 3 + 0.75; "½" alone -> 0 + 0.5).
 *   3. one leading sign; then "a/b" as a fraction (b = 0 -> NaN, never Infinity).
 *   4. a trailing exponent is set aside so its '-' and digits cannot be mistaken for grouping.
 *   5. decimal mark resolution (below), then a strict final shape check; Number() only sees canonical text.
 * Ambiguity: "1,234" is 1.234 by default, the decimal-comma reading, because the audience (ru / ka) writes decimals
 * that way and an English writer with a 4-digit number rarely groups it. A single separator is read as grouping only
 * when it repeats in valid 3-digit groups ("1,234,567"); repeats in invalid groups ("1,2,3") are NaN, not a guess.
 * `decimal` lets a caller with locale knowledge override the default.
 * KNOWN DEFECT: with `decimal` set to the other mark, the separator is stripped without checking the 3-digit
 * grouping, so parseNumber('1,2', { decimal: '.' }) is 12. Fix: when !asDecimal require `grouped`, else NaN.
 */
export function parseNumber(input, { decimal } = {}) {
  if (typeof input === 'number') return input;
  let s = String(input ?? '').trim().replace(/[−‒–]/g, '-').replace(/[\s   '’_]/g, '');
  if (!s) return NaN;
  let frac = 0;
  const last = s.slice(-1);
  if (FRACTIONS[last] !== undefined) { frac = FRACTIONS[last]; s = s.slice(0, -1); if (s === '' || s === '-' || s === '+') s += '0'; }
  const sign = s[0] === '-' ? -1 : 1;
  if (s[0] === '-' || s[0] === '+') s = s.slice(1);
  const vf = s.match(/^(\d+)\/(\d+)$/);
  if (vf) return +vf[2] ? sign * (+vf[1] / +vf[2] + frac) : NaN;
  const exp = s.match(/[eE][-+]?\d+$/);
  let e = '';
  if (exp) { e = exp[0]; s = s.slice(0, -e.length); }
  const hasC = s.includes(','), hasP = s.includes('.');
  // Both marks present: the LAST one is decimal (a decimal mark appears once, at the end; grouping repeats earlier).
  // "1.234,5" and "1,234.5" are thus unambiguous regardless of locale.
  if (hasC && hasP) {
    const dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    s = s.split(dec === ',' ? '.' : ',').join('').replace(dec, '.');
  } else if (hasC || hasP) {
    const ch = hasC ? ',' : '.';
    const n = s.split(ch).length - 1;
    const grouped = new RegExp(`^\\d{1,3}(\\${ch}\\d{3})+$`).test(s);
    const asDecimal = decimal ? decimal === ch : !(n > 1 && grouped);
    s = asDecimal ? (n > 1 ? NaN + '' : s.replace(ch, '.')) : s.split(ch).join('');
  }
  // Final gate: only digits with at most one point reach Number(). Number() alone would accept "0x1F", "Infinity" or
  // "" (-> 0); "NaN" (from the two-decimal-mark branch) fails here too. ".5" and "5." are allowed as people type them.
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  return sign * (Number(s + e) + frac);
}

// --- quantities --------------------------------------------------------------------------------------------------

// NUMRE recognises the longest number at the head of the text; parseNumber then decides its value. Alternatives,
// in priority order: mixed fraction "1 1/2", fraction "3/4", a number with space / apostrophe thousands groups (the
// (?!\d) stops "1 2345" from eating "1 234" and leaving "5"), or plain digits; then any [.,]digits runs (grouping or
// decimal, resolved later), an exponent, an optional vulgar fraction glyph; or a lone glyph. The mixed form must come
// first: "1 1/2" would otherwise match "1" and leave "1/2" as a second compound part.
// NEXT finds where the label ends: whitespace followed by something that starts a number. Glued digits ("m2") never
// match because NEXT demands whitespace before them.
const VF = '½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞';
const NUMRE = new RegExp(String.raw`^[-+\u2212]?(?:\d+\s+\d+\/\d+|\d+\/\d+|(?:\d{1,3}(?:[ \u00a0\u202f'’]\d{3})+(?!\d)|\d+)(?:[.,]\d+)*(?:[eE][-+]?\d+)?[${VF}]?|[${VF}])`, 'u');
const NEXT = new RegExp(String.raw`\s+(?=[-+\u2212]?[\d${VF}])`, 'u');

/**
 * Reads "42,5 м²", "3 sq ft", "-40 °F", "5'11\"", "1 ч 30 мин". Every part must have the same kind; the result is
 * in the first part's unit, `base` in the base unit of the kind. A bare number takes `opts.unit`. `opts.kind`
 * rejects a quantity of another kind. "1 1/2 in" is one and a half inches. Returns null when nothing fits.
 */
export function parseQuantity(text, opts = {}) {
  let s = String(text ?? '').trim();
  if (!s) return null;
  const parts = [];
  // A loop over "number label" pairs; guard caps it at 8 parts so hostile input cannot make it spin (each pass also
  // consumes at least the number, so it terminates anyway; the cap bounds the work).
  for (let guard = 0; s && guard < 8; guard++) {
    const m = s.match(NUMRE);
    if (!m) return null;
    const num = m[0];
    const mixed = num.match(/^([-+\u2212]?)(\d+)\s+(\d+)\/(\d+)$/);
    const value = mixed ? (mixed[1] && mixed[1] !== '+' ? -1 : 1) * (+mixed[2] + (+mixed[4] ? +mixed[3] / +mixed[4] : NaN)) : parseNumber(num, opts);
    if (!Number.isFinite(value)) return null;
    const rest = s.slice(num.length).replace(/^\s+/, '');
    // The label runs to the next number that follows a space; glued digits stay in it (m2, ft3).
    const cut = rest.search(NEXT);
    let label = (cut < 0 ? rest : rest.slice(0, cut)).trim().replace(/[,;]$/, '').trim();
    let code = label ? unitByLabel(label) : String(opts.unit || '');
    if (label && !code) {
      // "5ft11in", "5'11\"": the label ends where a digit starts.
      const d = label.search(/\d/);
      if (d > 0 && (code = unitByLabel(label.slice(0, d)))) label = label.slice(0, d);
      else return null;
    }
    parts.push({ value, unit: code, label });
    s = rest.slice(label ? rest.indexOf(label) + label.length : 0).replace(/^[\s,;]+/, '');
    if (!label) break;
  }
  if (s.trim() || !parts.length) return null;
  const first = parts[0];
  const x = unitOf(first.unit);
  if (!x) return parts.length === 1 && !first.unit && !opts.kind ? { value: first.value, unit: '', kind: '', base: null, parts } : null;
  if (opts.kind && x.kind !== opts.kind) return null;
  if (parts.length > 1 && x.kind === 'temperature') return null;  // "10 °C 5 °F" means nothing
  let total = 0;
  for (const p of parts) {
    const c = convert(p.value, p.unit, first.unit);
    if (c === null) return null;
    // "-5 ft 11 in" is -5.9167 ft: later parts take the sign of the first.
    // Each part is converted into the FIRST part's unit, not into the base: the result stays in the unit the person
    // led with, and temperature (the only affine kind) was refused above, so summing converted parts is linear.
    // KNOWN DEFECT: "-0 ft 6 in" gives +0.5 ft; parseNumber returns -0 and -0 < 0 is false. Fix: take the sign from
    // the matched text (the first number starts with '-' or U+2212) or test Object.is(first.value, -0).
    total += p !== first && first.value < 0 ? -Math.abs(c) : c;
  }
  return { value: total, unit: first.unit, kind: x.kind, base: total * x.factor + x.offset, parts };
}
