// units/format.js - showing quantities: the rounding rule, locale-aware numbers (Intl.NumberFormat with a fallback
// for engines without it), "value unit" text, the value in the unit a system button asks for, the best unit of a
// ladder (1500 m -> 1.5 km), compound forms (1 h 30 min, 5 ft 11 in), byte sizes and durations.
//
//   round(v, digits = 2) -> number          two decimals, trailing zeros do not exist on numbers
//   formatNumber(v, { lang, digits, significant, grouping }) -> '1 234,5'
//   formatQuantity(v, unit, { lang, digits, long, space }) -> '78,97 м²'      '' for a non-number, never 'NaN м²'
//   show(base, kind, system, opts) -> text of a value stored in the base unit, in the system's unit
//   inputValue(base, kind, system) -> { value, unit }      the value for an edit field in the author's system
//   humanize(v, unit, { system, binary, lang, digits }) -> { value, unit, text }
//   formatCompound(v, unit, ['h', 'min'], opts) -> '1 h 30 min'
//   formatBytes(n, { binary, lang, digits }) / formatDuration(seconds, { lang, parts })
//
// Rounding rule (from the portal): two decimals, trailing zeros removed - "78.97 m²" but "120 m²". Rounding belongs
// to conversion and display only: values are stored at full precision (850 sq ft -> 78.967584 m² -> 850 sq ft); a
// value rounded before storing comes back as 850.0044.
import { UNITS, baseUnit, convert, normalizeSystem, toNumber, unit as unitOf, unitFor, unitLabel, unitName } from './registry.js';

// Half away from zero, with a nudge. Math.round(1.005 * 100) is 100, not 101: 1.005 is stored as 1.00499999999999989...
// Adding EPSILON * |v| (one relative ulp-scale step) before scaling lifts such decimal ties over the half so they
// round as written. Math.round alone also rounds -1.5 to -1 (half up, toward +Infinity); the sign-aware nudge plus
// Math.round gives the symmetric -1.01 for -1.005 that the test pins. Rejected: toFixed (same binary problem, and
// returns a string); Intl rounding (locale-dependent, not available as a number).
// Non-finite values pass through unchanged so callers' Number.isFinite checks still see them.
export const round = (v, digits = 2) => {
  if (!Number.isFinite(v)) return v;
  const k = 10 ** digits;
  return Math.round((v + (v >= 0 ? 1 : -1) * Number.EPSILON * Math.abs(v)) * k) / k;
};

// Rounds to `n` significant digits: roundSignificant(1234.5, 3) -> 1230.
// p = decimal places to keep, from the decimal exponent of v. p >= 0 reuses round(); p < 0 rounds to tens /
// hundreds by dividing first, because round(v, -2) would compute 10 ** -2 and multiply by a non-exact 0.01.
// KNOWN DEFECT: for |v| below about 1e-305, p exceeds 308, 10 ** p is Infinity and the result is NaN
// (roundSignificant(1e-310, 3)). Fix: for large p, scale in two steps or fall back to Number(v.toPrecision(n)).
export function roundSignificant(v, n = 3) {
  if (!Number.isFinite(v) || v === 0) return v;
  const p = n - 1 - Math.floor(Math.log10(Math.abs(v)));
  return p >= 0 ? round(v, p) : Math.round(v / 10 ** -p) * 10 ** -p;
}

// Fallback separators [decimal, group] for engines without Intl. The ru / ka group is U+00A0 (no-break space), as
// Intl emits, so a number never wraps between its groups.
const SEP = { ru: [',', ' '], ka: [',', ' '], en: ['.', ','], de: [',', '.'], fr: [',', ' '], uk: [',', ' '] };

// Locale number without Intl: the decimal mark and grouping of the language.
function plainNumber(v, lang, digits, grouping) {
  const [dec, grp] = SEP[lang] || SEP.en;
  const r = round(v, digits);
  const [i, f] = String(Math.abs(r)).includes('e') ? [String(Math.abs(r)), ''] : String(Math.abs(r)).split('.');
  // ru / ka do not group 4-digit integers ("1234", "12 345"): Russian typography and CLDR's minimumGroupingDigits 2,
  // so the fallback matches what Intl prints. Exponent forms ("1e+21") are passed through unsplit.
  const int = grouping && i.length > (lang === 'ru' || lang === 'ka' ? 4 : 3) ? i.replace(/\B(?=(\d{3})+(?!\d))/g, grp) : i;
  return (r < 0 ? '-' : '') + int + (f ? dec + f : '');
}

/**
 * A number for people: formatNumber(1234.5, { lang: 'ru' }) -> '1 234,5' (no-break space). `digits`: maximum
 * fraction digits (2); `significant`: significant digits instead; `grouping: false` drops thousands separators.
 */
export function formatNumber(v, { lang = 'en', digits = 2, significant, grouping = true, minDigits = 0 } = {}) {
  const n = toNumber(v);
  if (!Number.isFinite(n)) return '';
  // Round ourselves, then let Intl only print: Intl's own rounding mode varies across engines and versions, so the
  // number shown would depend on the browser. With `significant`, maximumFractionDigits 20 (the ES2020 ceiling) keeps
  // Intl from truncating a small value like 0.0012. The U+2212 minus some locales emit is mapped back to '-' so the
  // text re-parses everywhere and matches the fallback. The catch covers a missing Intl and RangeError for a
  // `digits` above 20 or an invalid tag.
  const x = significant ? roundSignificant(n, significant) : n;
  try {
    return new Intl.NumberFormat(lang || 'en', {
      maximumFractionDigits: significant ? 20 : digits, minimumFractionDigits: minDigits, useGrouping: grouping,
    }).format(significant ? x : round(x, digits)).replace(/−/g, '-');
  } catch {
    return plainNumber(x, lang, significant ? 12 : digits, grouping);
  }
}

// "78,97 м²"; a unit without a label prints the bare number; a non-number prints ''. `long: true` uses the name.
export function formatQuantity(v, code, { lang = 'en', digits = 2, significant, long = false, space = ' ', grouping = true } = {}) {
  const text = formatNumber(v, { lang, digits, significant, grouping });
  if (!text) return '';
  const lab = long ? unitName(code, lang) : unitLabel(code, lang);
  if (!lab) return text;
  // Degrees stick to the number in English typography ("20°C" is common) but a space is never wrong; keep it.
  return text + space + lab;
}

// A value kept in the base unit of its kind, shown in the unit of a system: show(78.967584, 'area', 'us') -> '850 sq ft'.
export function show(base, kind, system, opts = {}) {
  const to = unitFor(kind, system);
  const n = convert(base, baseUnit(kind), to);
  return n === null ? '' : formatQuantity(n, to, opts);
}

// The value for an edit field in the system the author typed it in (so saving unchanged keeps it exact).
export function inputValue(base, kind, system, digits = 2) {
  const to = unitFor(kind, system);
  const n = convert(base, baseUnit(kind), to);
  return n === null ? null : { value: round(n, digits), unit: to };
}

// Ladders of units for humanize(): smallest first.
export const LADDERS = {
  length: { metric: ['mm', 'cm', 'm', 'km'], us: ['in', 'ft', 'mi'], imperial: ['in', 'ft', 'mi'] },
  area: { metric: ['cm2', 'm2', 'ha', 'km2'], us: ['sqin', 'sqft', 'acre', 'sqmi'], imperial: ['sqin', 'sqft', 'acre', 'sqmi'] },
  volume: { metric: ['ml', 'l', 'm3'], us: ['floz', 'gal'], imperial: ['flozimp', 'galimp'] },
  mass: { metric: ['mg', 'g', 'kg', 't'], us: ['oz', 'lb', 'shton'], imperial: ['oz', 'lb', 'lton'] },
  energy: { metric: ['j', 'kj', 'mj'] },
  power: { metric: ['w', 'kw', 'mw'] },
  pressure: { metric: ['pa', 'kpa', 'mpa'] },
  data: { metric: ['byte', 'kb', 'mb', 'gb', 'tb', 'pb'], binary: ['byte', 'kib', 'mib', 'gib', 'tib'] },
  time: { metric: ['ms', 's', 'min', 'h', 'd'] },
};

// Thresholds where the next unit takes over (a value >= threshold in the bigger unit moves up): area changes to
// hectares only from 1 ha, length to km from 1 km, time to minutes from 1 min.
/**
 * The most readable unit: humanize(1500, 'm') -> 1.5 km, humanize(0.004, 'm') -> 4 mm, humanize(2048, 'byte',
 * { binary: true }) -> 2 KiB. The system defaults to the unit's own (US units stay US); kinds without a ladder
 * keep their unit.
 */
export function humanize(v, code, { system, binary = false, lang = 'en', digits = 2, significant } = {}) {
  const x = unitOf(code);
  const n = toNumber(v);
  if (!x || !Number.isFinite(n)) return null;
  const sys = system ? normalizeSystem(system) : (x.system === 'metric' || x.system === 'other' ? 'metric' : x.system === 'customary' ? 'us' : x.system);
  const lad = LADDERS[x.kind];
  const list = lad ? (binary && lad.binary) || lad[sys] || lad.metric : null;
  let best = code;
  if (list) {
    const base = n * x.factor + x.offset;
    best = list[0];
    // Last rung whose factor the value reaches. The 1e-12 relative tolerance absorbs conversion noise: a value that
    // is exactly one unit in decimal but lands one ulp below the factor in doubles must still move up (5280 ft must
    // be 1 mi, not 5280 ft). Ladders exist only for offset-free kinds, so comparing base with a factor is meaningful.
    for (const c of list) if (Math.abs(base) >= UNITS[c].factor * (1 - 1e-12)) best = c;
  }
  const value = convert(n, code, best);
  return { value, unit: best, text: formatQuantity(value, best, { lang, digits, significant }) };
}

/**
 * A quantity split into whole parts of descending units, the last part rounded: formatCompound(1.5, 'h', ['h',
 * 'min']) -> '1 h 30 min'; formatCompound(1.8034, 'm', ['ft', 'in'], { digits: 0 }) -> "5 ft 11 in". Zero parts
 * in the middle are dropped ("2 h 5 min", not "2 h 0 min 5 s" when 'min' is the last unit asked).
 */
export function formatCompound(v, code, units, { lang = 'en', digits = 0, keepZero = false } = {}) {
  const x = unitOf(code);
  const n = toNumber(v);
  if (!x || !Number.isFinite(n) || !units?.length) return '';
  const list = units.filter((c) => unitOf(c)?.kind === x.kind);
  if (!list.length || x.offset) return formatQuantity(n, code, { lang, digits });
  // Offset kinds (temperature) are refused above: "1 °C 5 K" has no meaning. The split works on |base| and the sign
  // is prefixed once at the end, so floor() never rounds a negative part away from zero.
  // floor(rest / f + 1e-9): a quotient that is a whole number in decimal can land just below it in doubles
  // (x.9999999999999999); bare floor would then drop a whole unit and print "5 ft 12 in" for 6 ft. The carry loop
  // below catches what rounding of the last part still pushes over (11.6 in rounds to 12 -> +1 ft).
  let rest = Math.abs(n * x.factor);
  const out = [];
  const vals = list.map((c, i) => {
    const f = UNITS[c].factor;
    if (i === list.length - 1) return round(rest / f, digits);
    const whole = Math.floor(rest / f + 1e-9);
    rest -= whole * f;
    return whole;
  });
  // Carry: 5 ft 12 in -> 6 ft 0 in.
  for (let i = vals.length - 1; i > 0; i--) {
    const ratio = UNITS[list[i - 1]].factor / UNITS[list[i]].factor;
    if (Math.abs(ratio - Math.round(ratio)) < 1e-9 && vals[i] >= Math.round(ratio)) { vals[i] -= Math.round(ratio); vals[i - 1] += 1; }
  }
  vals.forEach((val, i) => { if (val || keepZero || (!out.length && i === vals.length - 1)) out.push(formatQuantity(val, list[i], { lang, digits })); });
  return (n < 0 ? '-' : '') + out.join(' ');
}

// File and memory sizes: formatBytes(1536) -> '1.54 kB'; { binary: true } -> '1.5 KiB'.
export function formatBytes(n, { binary = false, lang = 'en', digits = 2 } = {}) {
  return humanize(n, 'byte', { binary, lang, digits })?.text ?? '';
}

// Durations for trip sheets and timers: formatDuration(5400) -> '1 h 30 min'; parts: units to use.
export function formatDuration(seconds, { lang = 'en', parts = ['d', 'h', 'min'], digits = 0 } = {}) {
  const n = toNumber(seconds);
  if (!Number.isFinite(n)) return '';
  // Drop leading units that are zero.
  const list = parts.filter((c) => Math.abs(n) >= UNITS[c].factor || c === parts[parts.length - 1]);
  return formatCompound(n, 's', list.length ? list : [parts[parts.length - 1]], { lang, digits });
}

