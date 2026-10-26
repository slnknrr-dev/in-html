// units/test.js - unit tests of the units library: `node units/test.js` (importing the module runs nothing).
// The registry (global codes, bases, preferred units and peers of every unit in every system), exact factors,
// affine temperatures away from zero, round trips through the base, refusal instead of a plausible number, the
// rounding rule and the 850 sq ft round trip, labels and aliases in three scripts (no alias claimed twice),
// numbers with every separator convention, quantities and compounds, formatting, ladders, tables and scales.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BASE, KINDS, KIND_LABEL, SYSTEMS, SYSTEM_LABEL, UNITS, baseUnit, conversionOf, convert, fromBase, inSystem, isKind,
  isSystem, kindOf, normalizeKind, normalizeSystem, toBase, unitFor, unitLabel, unitPeer, unitsOfKind,
} from './registry.js';
import { ALIAS_CONFLICTS, kindOfLabel, normLabel, parseNumber, parseQuantity, unitByLabel } from './parse.js';
import { formatBytes, formatCompound, formatDuration, formatNumber, formatQuantity, humanize, inputValue, round, roundSignificant, show } from './format.js';
import { COMMON_PAIRS, conversionTable, convertAll, formulaText, kindList } from './tables.js';
import { DISTANCE_SCALE, mergeScales, normalizeScale, normalizeScales, scaleStepIndex, scaleWord } from './scales.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  // eq compares JSON text: exact, structural, and NaN / -0 print as null / 0, so it cannot tell them apart (use
  // Number.isNaN explicitly, as 'bad numbers' does). near is for floats: relative error eps (absolute below 1),
  // because decimal factors are not exact in binary. eq on a converted float asserts that this exact
  // double comes out, which is right only where the test means it (850 sq ft round trip, the exact factors).
  const near = (name, got, want, eps = 1e-9) => {
    if (typeof got === 'number' && Math.abs(got - want) <= eps * Math.max(1, Math.abs(want))) pass++;
    else { fail++; console.log(`FAIL ${name}: got ${got}, want ${want}`); }
  };

  // --- registry ---------------------------------------------------------------------------------------------------
  for (const k of KINDS) {
    eq('kind label ' + k, !!(KIND_LABEL[k].en && KIND_LABEL[k].ru && KIND_LABEL[k].ka), true);
    const b = baseUnit(k);
    eq('base ' + k, [UNITS[b]?.kind, UNITS[b]?.factor, UNITS[b]?.offset], [k, 1, 0]);
    eq('units of ' + k, unitsOfKind(k).length > 1 && unitsOfKind(k).every((c) => UNITS[c].kind === k), true);
    for (const s of SYSTEMS) {
      const p = unitFor(k, s);
      eq(`preferred ${k}/${s}`, [UNITS[p]?.kind, inSystem(p, s)], [k, true]);
    }
  }
  for (const s of SYSTEMS) eq('system label ' + s, !!SYSTEM_LABEL[s].ka, true);
  for (const [code, x] of Object.entries(UNITS)) {
    eq('labels ' + code, !!(x.label.en && x.label.ru && x.label.ka && x.name.en && x.name.ru && x.name.ka), true);
    eq('kind known ' + code, isKind(x.kind), true);
    // Every unit has a counterpart of the same kind at home in every system.
    for (const s of SYSTEMS) {
      const p = unitPeer(code, s);
      eq(`peer ${code}/${s}`, [UNITS[p]?.kind, inSystem(p, s)], [x.kind, true]);
    }
    // Round trip through the base at 7.5 (not 0: 0 * k = 0 for any k).
    near('round trip ' + code, fromBase(toBase(7.5, code), code), 7.5);
  }
  eq('base table', Object.keys(BASE), KINDS);
  // The counterpart keeps the magnitude: 150 000 km is about 93 thousand miles, not 492 million feet.
  eq('peers', ['km', 'cm', 'm2', 'ha', 'kg', 'kmh', 'c', 'l', 'ml', 't'].map((c) => unitPeer(c, 'us')), ['mi', 'in', 'sqft', 'acre', 'lb', 'mph', 'f', 'gal', 'floz', 'shton']);
  eq('peers uk', ['l', 'ml', 't', 'gal'].map((c) => unitPeer(c, 'imperial')), ['galimp', 'flozimp', 'lton', 'galimp']);
  eq('peers back', [unitPeer('mi', 'metric'), unitPeer('sqft', 'metric'), unitPeer('galimp', 'us')], ['km', 'm2', 'gal']);
  eq('peer at home', [unitPeer('km', 'metric'), unitPeer('sqft', 'us'), unitPeer('ft', 'imperial'), unitPeer('kn', 'metric'), unitPeer('nope', 'metric')], ['km', 'sqft', 'ft', 'kn', '']);
  eq('150000 km in mi', Math.round(convert(150000, 'km', unitPeer('km', 'us'))), 93206);
  eq('normalizers', [normalizeKind('area'), normalizeKind('parrots'), normalizeKind(null), normalizeSystem('us'), normalizeSystem('x'), isSystem('imperial')], ['area', '', '', 'us', 'metric', true]);
  eq('kindOf', [kindOf('m2'), kindOf('nope')], ['area', '']);

  // --- conversion -------------------------------------------------------------------------------------------------
  eq('exact factors', [convert(1, 'ft', 'm'), convert(1, 'mi', 'm'), convert(1, 'lb', 'kg'), convert(1, 'm3', 'l'), convert(1, 'ha', 'm2'), convert(1, 'sotka', 'm2'), convert(1, 'in', 'mm')], [0.3048, 1609.344, 0.45359237, 1000, 10000, 100, 25.4]);
  near('100 km/h in m/s', convert(100, 'kmh', 'mps'), 27.77777777777778);
  near('1 nmi', convert(1, 'nmi', 'km'), 1.852);
  near('US gal', convert(1, 'gal', 'in3'), 231);
  near('UK gal pints', convert(1, 'galimp', 'ptimp'), 8);
  near('US gal pints', convert(1, 'gal', 'pt'), 8);
  near('cup tbsp', convert(1, 'cup', 'tbsp'), 16);
  near('tbsp tsp', convert(1, 'tbsp', 'tsp'), 3);
  near('stone', convert(1, 'st', 'lb'), 14);
  near('short ton', convert(1, 'shton', 'lb'), 2000);
  near('long ton', convert(1, 'lton', 'lb'), 2240);
  near('atm mmHg', convert(1, 'atm', 'mmhg'), 760, 1e-6);
  near('atm psi', convert(1, 'atm', 'psi'), 14.6959488, 1e-6);
  near('kWh MJ', convert(1, 'kwh', 'mj'), 3.6);
  near('kcal kJ', convert(1, 'kcal', 'kj'), 4.184);
  near('hp kW', convert(1, 'hp', 'kw'), 0.7456998715822702);
  near('GiB', convert(1, 'gib', 'mb'), 1073.741824);
  near('byte bits', convert(1, 'byte', 'bit'), 8);
  near('week hours', convert(1, 'wk', 'h'), 168);
  // Temperatures: the offset is checked away from zero.
  near('100 C -> F', convert(100, 'c', 'f'), 212);
  near('0 C -> F', convert(0, 'c', 'f'), 32);
  near('-40 C = -40 F', convert(-40, 'c', 'f'), -40);
  near('98.6 F -> C', convert(98.6, 'f', 'c'), 37);
  near('0 C -> K', convert(0, 'c', 'k'), 273.15);
  near('Rankine', convert(491.67, 'r', 'c'), 0, 1e-9);
  near('F -> K', convert(32, 'f', 'k'), 273.15);
  // Refusal instead of a plausible number.
  eq('different kinds', [convert(1, 'm', 'kg'), convert(1, 'm2', 'ft'), convert(1, 'c', 'kmh')], [null, null, null]);
  eq('unknown / not a number', [convert(1, 'сут.', 'm2'), convert(1, 'm2', 'nope'), convert('abc', 'm2', 'sqft'), convert(null, 'm2', 'sqft'), convert('', 'm', 'ft'), convert(Infinity, 'm2', 'sqft')], [null, null, null, null, null, null]);
  near('string with comma', convert('78,97', 'm2', 'm2'), 78.97);
  eq('conversionOf', conversionOf('c', 'f'), { factor: 1.8, offset: 32 });
  eq('conversionOf mismatch', conversionOf('m', 'kg'), null);

  // --- rounding and the 850 sq ft round trip ------------------------------------------------------------------------
  const base850 = convert(850, 'sqft', 'm2');
  near('850 sq ft', base850, 78.967584);
  eq('back to 850', convert(base850, 'm2', 'sqft'), 850);
  eq('show us', show(base850, 'area', 'us'), '850 sq ft');
  eq('show metric', show(base850, 'area', 'metric'), '78.97 m²');
  eq('show refuses', [show('abc', 'area', 'metric'), show(1, 'nope', 'metric')], ['', '']);
  // Rounding before storing breaks the round trip.
  eq('rounded input drifts', convert(round(base850), 'm2', 'sqft') === 850, false);
  eq('input value', [inputValue(base850, 'area', 'us'), inputValue(base850, 'area', 'metric')], [{ value: 850, unit: 'sqft' }, { value: 78.97, unit: 'm2' }]);
  eq('round', [round(78.9676), round(120), round(1.005), round(-1.005), round(2.675)], [78.97, 120, 1.01, -1.01, 2.68]);
  eq('significant', [roundSignificant(1234.5, 3), roundSignificant(0.0012345, 2), roundSignificant(98765, 1)], [1230, 0.0012, 100000]);

  // --- labels and parsing ---------------------------------------------------------------------------------------------
  eq('no alias conflicts', ALIAS_CONFLICTS, []);
  eq('labels', [unitLabel('m2', 'ru'), unitLabel('m2', 'en'), unitLabel('m2', 'ka'), unitLabel('m2', 'de'), unitLabel('nope')], ['м²', 'm²', 'მ²', 'm²', '']);
  eq('label kinds', ['м²', 'm²', 'кв.м', 'кв. м', 'sq ft', 'км', 'кг', 'კვ. მ', 'მ²', 'сот.', 'л. с.', 'км/ч', '°С'].map(kindOfLabel), ['area', 'area', 'area', 'area', 'area', 'length', 'mass', 'area', 'area', 'area', 'power', 'speed', 'temperature']);
  eq('unknown labels have no kind', ['шт.', 'чел.', '', null, 'попугай', 'к', 'б'].map(kindOfLabel), ['', '', '', '', '', '', '']);
  eq('codes accepted', [unitByLabel('m2'), unitByLabel('sqft'), unitByLabel('K'), unitByLabel('К'), unitByLabel('MW'), unitByLabel('B'), unitByLabel('mb')], ['m2', 'sqft', 'k', 'k', 'mw', 'byte', 'mb']);
  eq('normLabel', [normLabel('кв.м'), normLabel('M²'), normLabel('კვ. მ'), normLabel('sq.  ft.')], ['sq м', 'm2', 'sq მ', 'sq ft']);
  eq('numbers', ['1.234,5', '1,234.5', '42,5', '1,234,567', '1 234 567', '1 234,5', "1'234.5", '−3', '+7', '1e3', '1,5e-3', '½', '1/4', '3¾'].map((s) => parseNumber(s)), [1234.5, 1234.5, 42.5, 1234567, 1234567, 1234.5, 1234.5, -3, 7, 1000, 0.0015, 0.5, 0.25, 3.75]);
  eq('bad numbers', ['', 'abc', '12.5.6', '1,2,3', '--1'].map((s) => Number.isNaN(parseNumber(s))), [true, true, true, true, true]);
  eq('decimal option', [parseNumber('1,234', { decimal: '.' }), parseNumber('1,234')], [1234, 1.234]);
  const q = (s, o) => { const r = parseQuantity(s, o); return r && [r.unit, Math.round(r.value * 1e6) / 1e6]; };
  eq('quantities', ['42,5 м²', '3 sq ft', '-40 °F', '1 234,5 kg', '10 m2', '1.5e3 m', '85 კვ. მ', '100 км/ч', '15 სოტკა', '7 сут.', '3.5 GB', '850 sq. ft.', '½ cup', '1 1/2 in', '25 ℃', '2 л. с.', '12 кВт·ч'].map((s) => q(s)),
    [['m2', 42.5], ['sqft', 3], ['f', -40], ['kg', 1234.5], ['m2', 10], ['m', 1500], ['m2', 85], ['kmh', 100], ['sotka', 15], ['d', 7], ['gb', 3.5], ['sqft', 850], ['cup', 0.5], ['in', 1.5], ['c', 25], ['ps', 2], ['kwh', 12]]);
  eq('compounds', ["5'11\"", '5 ft 11 in', '5ft11in', '1 ч 30 мин', '2 kg 300 g', '20 км 300 м', '-5 ft 6 in'].map((s) => q(s)),
    [['ft', 5.916667], ['ft', 5.916667], ['ft', 5.916667], ['h', 1.5], ['kg', 2.3], ['km', 20.3], ['ft', -5.5]]);
  eq('rejected quantities', ['12 шт.', '5 m 3 kg', '10 °C 5 °F', 'm2', '', 'abc m'].map((s) => parseQuantity(s)), [null, null, null, null, null, null]);
  eq('kind filter', [parseQuantity('5 kg', { kind: 'length' }), q('5 kg', { kind: 'mass' })], [null, ['kg', 5]]);
  eq('bare number', [q('42', { unit: 'm2' }), parseQuantity('42').kind], [['m2', 42], '']);
  near('quantity base', parseQuantity('850 sq ft').base, 78.967584);

  // --- formatting -----------------------------------------------------------------------------------------------------
  eq('format', [formatQuantity(78.9676, 'm2', { lang: 'en' }), formatQuantity(120, 'm2'), formatQuantity(120.004, 'm2'), formatQuantity(5, ''), formatQuantity(5, 'nope')], ['78.97 m²', '120 m²', '120 m²', '5', '5']);
  const ru = formatQuantity(1234.5, 'm2', { lang: 'ru' });
  eq('ru format', [ru.includes(','), ru.endsWith('м²'), ru.codePointAt(1)], [true, true, 0xa0]);
  eq('non-numbers print nothing', [formatQuantity('abc', 'm2'), formatQuantity(null, 'm2'), formatQuantity(NaN, 'm2')], ['', '', '']);
  eq('long names', formatQuantity(2, 'km', { long: true, lang: 'ka' }), '2 კილომეტრი');
  eq('number', [formatNumber(1234567.891, { lang: 'en' }), formatNumber(0.5, { lang: 'ru' }), formatNumber(1234.5, { grouping: false })], ['1,234,567.89', '0,5', '1234.5']);
  const h = (v, u, o) => { const r = humanize(v, u, o); return r && [r.unit, Math.round(r.value * 1000) / 1000]; };
  eq('humanize', [h(1500, 'm'), h(0.004, 'm'), h(999, 'm'), h(25000, 'm2'), h(2048, 'byte', { binary: true }), h(1536, 'byte'), h(90, 's'), h(5280, 'ft'), h(3, 'c')],
    [['km', 1.5], ['mm', 4], ['m', 999], ['ha', 2.5], ['kib', 2], ['kb', 1.536], ['min', 1.5], ['mi', 1], ['c', 3]]);
  eq('humanize into system', h(1000, 'm', { system: 'us' }), ['ft', 3280.84]);
  eq('compound', [formatCompound(1.5, 'h', ['h', 'min']), formatCompound(1.8034, 'm', ['ft', 'in']), formatCompound(1.8288, 'm', ['ft', 'in']), formatCompound(-1.5, 'h', ['h', 'min'])], ['1 h 30 min', '5 ft 11 in', '6 ft', '-1 h 30 min']);
  eq('compound carry', formatCompound(1.82, 'm', ['ft', 'in']), '6 ft');
  eq('bytes', [formatBytes(1536), formatBytes(1536, { binary: true }), formatBytes(10)], ['1.54 kB', '1.5 KiB', '10 B']);
  eq('duration', [formatDuration(5400), formatDuration(90061, { lang: 'ru' }), formatDuration(7200), formatDuration('x')], ['1 h 30 min', '1 сут. 1 ч 1 мин', '2 h', '']);

  // --- tables -----------------------------------------------------------------------------------------------------------
  const all = convertAll(1, 'km');
  eq('convert all', [all.length === unitsOfKind('length').length, all.find((r) => r.unit === 'm').value, all.find((r) => r.unit === 'mi').text], [true, 1000, '0.6214 mi']);
  eq('convert all system', convertAll(1, 'm', { system: 'us' }).map((r) => r.unit), ['in', 'ft', 'yd', 'mi', 'nmi']);
  eq('table', conversionTable('kg', 'lb', { count: 3 }).map((r) => r.toText), ['2.2 lb', '4.41 lb', '6.61 lb']);
  eq('table values', conversionTable('c', 'f', { values: [-40, 0, 37] }).map((r) => round(r.to, 1)), [-40, 32, 98.6]);
  eq('table mismatch', conversionTable('kg', 'm'), []);
  eq('formula', [formulaText('ft', 'm'), formulaText('c', 'f'), formulaText('f', 'c'), formulaText('m', 'kg')], ['1 ft = 0.3048 m', '°F = °C × 1.8 + 32', '°C = °F × 0.5555555556 − 17.77777778', '']);
  for (const [k, pairs] of Object.entries(COMMON_PAIRS)) eq('pairs ' + k, pairs.every(([a, b]) => UNITS[a].kind === k && UNITS[b].kind === k), true);
  eq('kind list', kindList().length, KINDS.length);

  // --- scales -----------------------------------------------------------------------------------------------------------
  const euro = normalizeScale({ key: 'Rooms', mode: 'exact', steps: [{ at: 2, name: 'two rooms' }, { at: 1, name: { en: 'studio', ru: 'однушка' } }, { at: null, name: '{n} rooms' }, { at: 1, name: 'dup' }, { at: null, name: 'other2' }, { at: 'x', name: 'bad' }] });
  eq('scale normalised', [euro.key, euro.steps.map((s) => s.at)], ['rooms', [1, 2, null]]);
  eq('scale words', [scaleWord(euro, 1), scaleWord(euro, 1, 'ru'), scaleWord(euro, '2'), scaleWord(euro, 7), scaleWord(euro, 2.5), scaleWord(euro, '')], ['studio', 'однушка', 'two rooms', '7 rooms', '2.5 rooms', '']);
  const noOther = normalizeScale({ key: 'beach', mode: 'upto', steps: [{ at: 300, name: 'close' }, { at: '800', name: 'nearby' }] });
  eq('upto', [scaleStepIndex(noOther, 270), scaleStepIndex(noOther, 300), scaleStepIndex(noOther, '300,5'), scaleStepIndex(noOther, 900)], [0, 0, 1, -1]);
  eq('invalid scales', [normalizeScale(null), normalizeScale({ key: '1x', steps: [{ at: 1, name: 'a' }] }), normalizeScale({ key: 'a', steps: [] })], [null, null, null]);
  eq('scales unique', normalizeScales([{ key: 'a', steps: [{ at: 1, name: 'x' }] }, { key: 'a', steps: [{ at: 2, name: 'y' }] }]).length, 1);
  eq('merge', mergeScales([[{ key: 'a', v: 1 }, { key: 'b', v: 1 }], [{ key: 'a', v: 2 }]]).map((s) => s.v), [2, 1]);
  eq('distance scale', [scaleWord(DISTANCE_SCALE, 270), scaleWord(DISTANCE_SCALE, 0.5, 'ru', { unit: 'km' }), scaleWord(DISTANCE_SCALE, 1, 'ka', { unit: 'mi' }), scaleWord(DISTANCE_SCALE, 900, 'en', { unit: 'ft' })], ['close', 'рядом', 'ფეხით სავალზე', 'close']);
  eq('distance scale wrong kind', scaleWord(DISTANCE_SCALE, 1, 'en', { unit: 'kg' }), '');

  console.log(`units: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
