// units/tables.js - conversion tables for converters and printed cheat sheets: one value in every unit of its kind,
// a column of values between two units, the affine formula of a conversion as text, and the common pairs per kind.
//
//   convertAll(v, unit, { system, lang, digits }) -> [{ unit, value, text }]
//   conversionTable(from, to, { values | start, step, count, digits, lang }) -> [{ from, to, fromText, toText }]
//   formulaText(from, to, { lang }) -> '1 ft = 0.3048 m' | '°F = °C × 1.8 + 32'
//   COMMON_PAIRS: { kind: [[from, to], …] }
import { KINDS, UNITS, conversionOf, convert, unit as unitOf, unitLabel, unitsOfKind } from './registry.js';
import { formatNumber, formatQuantity, round } from './format.js';

// One value in every unit of its kind (or of one system): the converter's result list.
export function convertAll(v, code, { system, lang = 'en', digits = 4, significant = 6 } = {}) {
  const x = unitOf(code);
  if (!x) return [];
  const out = [];
  for (const c of unitsOfKind(x.kind, system)) {
    const value = convert(v, code, c);
    if (value === null) return [];
    // Fixed decimals inside [1e-3, 1e15); significant digits outside it. 1 µm in km at 4 decimals would print "0",
    // and 1 km in µm is a 10-digit integer that fixed decimals print fine but beyond 1e15 doubles stop holding
    // integers exactly, so showing more digits than `significant` would be false precision.
    out.push({ unit: c, value, text: formatQuantity(value, c, { lang, digits, significant: Math.abs(value) >= 1e-3 && Math.abs(value) < 1e15 ? undefined : significant }) });
  }
  return out;
}

/**
 * A two-column table: conversionTable('kg', 'lb', { start: 1, step: 1, count: 10 }) or { values: [1, 5, 10] }.
 * Values are rounded with `digits` (2) for display, the numbers stay exact.
 */
export function conversionTable(from, to, { values, start = 1, step = 1, count = 10, digits = 2, lang = 'en' } = {}) {
  const k = conversionOf(from, to);
  if (!k) return [];
  // Rows are start + i * step, not a running sum: repeated += 0.1 accumulates error (0.30000000000000004 by row 3);
  // round(..., 10) then trims the single multiplication's noise. count is clamped to [0, 1000] so a bad parameter
  // cannot allocate a huge array. conversionOf above only validates the pair; values come from convert().
  const list = values || Array.from({ length: Math.max(0, Math.min(1000, count)) }, (_, i) => round(start + i * step, 10));
  return list.map((v) => {
    const t = convert(v, from, to);
    return { from: v, to: t, fromText: formatQuantity(v, from, { lang, digits }), toText: formatQuantity(t, to, { lang, digits }) };
  });
}

/**
 * The conversion as a line of text: '1 ft = 0.3048 m', '°F = °C × 1.8 + 32' (affine conversions as a formula).
 */
export function formulaText(from, to, { lang = 'en', significant = 10 } = {}) {
  const k = conversionOf(from, to);
  if (!k) return '';
  const a = unitLabel(from, lang), b = unitLabel(to, lang);
  // 10 significant digits, no grouping: enough to show 0.5555555556 honestly as a repeating value, short enough for
  // a line of text. A linear map reads as "1 a = k b"; an affine one cannot (1 °C is not 33.8 °F in any useful
  // sense), so it is written as the formula "b = a × k ± c", with U+2212 for the minus to match typeset math.
  const num = (v) => formatNumber(v, { lang, significant, grouping: false });
  if (!k.offset) return `1 ${a} = ${num(k.factor)} ${b}`;
  const sign = k.offset < 0 ? '−' : '+';
  return `${b} = ${a} × ${num(k.factor)} ${sign} ${num(Math.abs(k.offset))}`;
}

// The pairs a converter offers first.
export const COMMON_PAIRS = {
  length: [['km', 'mi'], ['m', 'ft'], ['cm', 'in'], ['mm', 'in'], ['nmi', 'km']],
  area: [['m2', 'sqft'], ['ha', 'acre'], ['sotka', 'm2'], ['km2', 'sqmi']],
  volume: [['l', 'gal'], ['l', 'galimp'], ['ml', 'floz'], ['m3', 'ft3'], ['cup', 'ml']],
  mass: [['kg', 'lb'], ['g', 'oz'], ['t', 'shton'], ['st', 'kg']],
  temperature: [['c', 'f'], ['c', 'k']],
  speed: [['kmh', 'mph'], ['mps', 'kmh'], ['kn', 'kmh']],
  pressure: [['bar', 'psi'], ['hpa', 'mmhg'], ['atm', 'kpa']],
  energy: [['kcal', 'kj'], ['kwh', 'mj'], ['btu', 'kj']],
  power: [['kw', 'hp'], ['ps', 'kw']],
  data: [['gb', 'gib'], ['mb', 'mib'], ['byte', 'bit']],
  time: [['h', 'min'], ['d', 'h'], ['wk', 'd']],
};

// The kinds with their units, for a picker: [{ kind, units: [code] }].
export const kindList = () => KINDS.map((kind) => ({ kind, units: Object.keys(UNITS).filter((c) => UNITS[c].kind === kind) }));
