// schema/test.js - unit tests of the schema library: `node schema/test.js` (importing the module runs nothing).
// Scales (of ../units/) in templates and tags, conditions and templates with the segment rule, title rules (order, off, source
// language, fallback, trace), field definitions and values of every type (identifiers included), showIf, roles and
// groups, inheritance down a category tree with origin tracking and hiding, overlays, building -> unit values, tags
// (variants, links, inheritance of marks, search tokens, collisions, migration). Ported from the portal and retail
// test suites, plus new cases.
//
// Harness: eq() compares JSON forms (key order matters, which doubles as a check that normalisers emit a stable
// shape); near() for floats after unit conversion, where exact equality would test the FPU, not the code.
// Cases are grouped per module in dependency order (text -> scales -> rules -> fields -> inherit -> tags), so the
// first failure usually points at the lowest broken layer.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanKey, cleanFieldKey, i18n, pick, slugList } from './text.js';
import { normalizeScale, normalizeScales, mergeScales, scaleWord, scaleStepIndex } from '../units/scales.js';
import { COND_OPS, COND_OP_NAME, normalizeCond, condMatches, renderTemplate, templateVars, templateScales, normalizeRules, buildRuleTitle, traceRules, mainText, rulesVars } from './rules.js';
import { normalizeField, normalizeFieldDef, fieldPatch, checkValue, validateValues, fieldVisible, valueText, fieldsFor, fieldsWithRole, fieldGroups, fieldApplies, normalizeMac, normalizeIp, normalizeCode, compactIdent } from './fields.js';
import { resolveSchema, normalizeOverlay, applyOverlay, overlayRefused, inheritValues, mergeByKey } from './inherit.js';
import { normalizeTagDef, normalizeTagValues, tagText, tagLinkUrl, inheritMarks, tagIndexTokens, parseTagTokens, tagTokenGroup, tagsCollide, tagCompare, migrateTagValues } from './tags.js';

// Run only when executed directly; importing run() has no side effects.
const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const ok = (name, cond) => eq(name, !!cond, true);
  const near = (name, got, want, tol = 1e-9) => ok(name + ` (${got} vs ${want})`, got != null && Math.abs(got - want) <= tol);

  // --- text ---------------------------------------------------------------------------------------------------------
  eq('clean key', [cleanKey(' Area_m2 '), cleanKey('1bad'), cleanKey('a-b')], ['area_m2', '', '']);
  eq('field key any script', [cleanFieldKey('площадь'), cleanFieldKey('a b'), cleanFieldKey('')], ['площадь', '', '']);
  eq('i18n', [i18n('  Area '), i18n({ en: 'A', ru: '', xx1: 'x', ka: 5 }), i18n({ en: { x: 1 } })], [{ en: 'Area' }, { en: 'A', ka: '5' }, {}]);
  eq('pick', [pick({ ru: 'Да', en: 'Yes' }, 'ka'), pick({ ru: 'Да' }, 'en'), pick({ ka: 'კი', en: 'Yes' }, 'ka'), pick({ ru: 'Да', en: 'Yes' }, 'ka', ['ru'])], ['Yes', 'Да', 'კი', 'Да']);
  eq('slug list', slugList('Rent, sale ,rent,, x y'), ['rent', 'sale', 'xy']);

  // --- scales -------------------------------------------------------------------------------------------------------
  const near1 = normalizeScale({ key: 'near', mode: 'upto', steps: [{ at: '', name: 'far' }, { at: 800, name: 'nearby' }, { at: '300', name: { en: 'close', ru: 'близко' } }, { at: null, name: 'second else' }] });
  eq('scale sorted, one "otherwise" last', near1.steps.map((x) => x.at), [300, 800, null]);
  eq('scale first otherwise kept', near1.steps[2].name.en, 'far');
  eq('scale empty / bad', [normalizeScale({ key: 'x', steps: [] }), normalizeScale({ key: 'x', steps: [{ at: 'abc', name: 'a' }] })], [null, null]);
  eq('upto steps', [scaleWord(near1, 300), scaleWord(near1, 301), scaleWord(near1, 5000), scaleWord(near1, 120, 'ru'), scaleWord(near1, 500, 'ka')], ['close', 'nearby', 'far', 'близко', 'nearby']);
  eq('scale empty value', [scaleStepIndex(near1, ''), scaleWord(near1, 'abc')], [-1, '']);
  const euro = normalizeScale({ key: 'euro', steps: [{ at: 1, name: 'Euro-one' }, { at: 2, name: { en: 'Euro-two', ru: 'Евродвушка' } }, { at: null, name: 'Euro-{n}' }] });
  eq('exact scale with {n}', [scaleWord(euro, 2), scaleWord(euro, 2, 'ru'), scaleWord(euro, 7)], ['Euro-two', 'Евродвушка', 'Euro-7']);
  eq('exact scale without otherwise', scaleWord(normalizeScale({ key: 'e', steps: [{ at: 1, name: 'one' }] }), 2), '');
  const merged = mergeScales([normalizeScales([euro, { key: 'near', steps: [{ at: 1, name: 'a' }] }]), normalizeScales([{ key: 'euro', steps: [{ at: 1, name: 'own' }] }])]);
  eq('scales merge, nearest wins', [merged.length, scaleWord(merged.find((x) => x.key === 'euro'), 1)], [2, 'own']);
  eq('scale duplicates', normalizeScales([euro, euro]).length, 1);

  // --- conditions and templates -------------------------------------------------------------------------------------
  for (const op of COND_OPS) ok('op label ' + op, COND_OP_NAME[op].en && COND_OP_NAME[op].ru && COND_OP_NAME[op].ka);
  eq('cond min needs a number', normalizeCond({ v: 'rooms', op: 'min', a: ['x'] }), null);
  eq('cond min decimal comma', normalizeCond({ v: 'rooms', op: 'min', a: '2,5' }), { v: 'rooms', op: 'min', a: ['2.5'] });
  eq('cond bare drops values', normalizeCond({ v: 'area', op: 'has', a: ['junk'] }), { v: 'area', op: 'has', a: [] });
  eq('cond bad key / empty is', [normalizeCond({ v: 'Bad Key', op: 'is', a: ['1'] }), normalizeCond({ v: 'layout', op: 'is', a: [] })], [null, null]);
  const own = normalizeCond({ v: 'ownership', op: 'is', a: ['private', ''] });
  eq('is with "" also means not set', [condMatches(own, { ownership: 'private' }), condMatches(own, {}), condMatches(own, { ownership: '' }), condMatches(own, { ownership: 'state' })], [true, true, true, false]);
  const notState = normalizeCond({ v: 'ownership', op: 'not', a: ['state'] });
  eq('not', [condMatches(notState, {}), condMatches(notState, { ownership: 'state' })], [true, false]);
  eq('zero is a value', [condMatches(normalizeCond({ v: 'bedrooms', op: 'max', a: ['0'] }), { bedrooms: 0 }), condMatches(normalizeCond({ v: 'bedrooms', op: 'none' }), { bedrooms: 0 })], [true, false]);
  eq('numeric equality and lists', [condMatches(normalizeCond({ v: 'rooms', op: 'is', a: ['2'] }), { rooms: '2.0' }), condMatches(normalizeCond({ v: 'lang', op: 'is', a: ['ka'] }), { lang: ['ru', 'ka'] })], [true, true]);
  eq('false is not set', condMatches(normalizeCond({ v: 'flag', op: 'has' }), { flag: false }), false);
  eq('template segment rule', renderTemplate('{rooms}-room · {area} m²', { rooms: 2 }), '2-room');
  eq('template all parts', renderTemplate('{rooms}-room · {area} m² , {street}', { rooms: 2, area: 48, street: 'Rustaveli' }), '2-room · 48 m² · Rustaveli');
  eq('template constant segment stays', renderTemplate('Flat | {x}', {}), 'Flat');
  eq('template scale', renderTemplate('{size:euro}', { size: '2' }, { scales: [euro] }), 'Euro-two');
  eq('template scale reads the raw number', renderTemplate('{size:euro} · {area} m²', { size: 'label', area: 40 }, { scales: [euro], raw: { size: 1 } }), 'Euro-one · 40 m²');
  eq('template unknown scale drops the segment', renderTemplate('{size:nope} · Flat', { size: 2 }, { scales: [euro] }), 'Flat');
  eq('template lists', renderTemplate('{floors} floors', { floors: [3, 5] }), '3–5 floors');
  eq('template vars / scales', [templateVars('{size:euro} {rooms} {rooms}'), templateScales('{size:euro} {rooms} {x:near}')], [['size', 'rooms'], ['euro', 'near']]);

  // --- title rules --------------------------------------------------------------------------------------------------
  const rules = normalizeRules([
    { when: [{ v: 'x', op: 'has' }], tpl: { ru: 'первое', en: 'first' }, off: true },
    { when: [{ v: 'x', op: 'has' }], tpl: { ru: '{size:euro}', en: 'second' } },
    { when: [], tpl: { ru: 'третье {x}', en: 'third' } },
    { when: 'junk', tpl: {} },
  ]);
  eq('rules normalized', rules.length, 3);
  const noElse = normalizeScale({ key: 'euro', steps: [{ at: 1, name: 'one' }] });
  const vars = () => ({ x: 'икс', size: '9' });
  const b1 = buildRuleTitle(rules, { x: 'икс', size: 9 }, vars, { scales: [noElse], srcLang: 'ru' });
  eq('rule that did not render in the source language is skipped', [b1.rule, b1.i18n], [2, { ru: 'третье икс', en: 'third' }]);
  eq('english source takes rule 2', buildRuleTitle(rules, { x: 'икс', size: 9 }, vars, { scales: [noElse], srcLang: 'en' }).rule, 1);
  eq('fallback template', buildRuleTitle([], { area: 40 }, () => ({ area: '40' }), { fallback: '{area} m²', srcLang: 'en' }), { i18n: { en: '40 m²' }, rule: -1 });
  eq('nothing', buildRuleTitle([], {}, () => ({}), { fallback: '{area} m²' }), { i18n: {}, rule: -2 });
  const tr = traceRules(rules, { x: 'икс', size: 9 }, vars, { scales: [noElse], srcLang: 'ru' });
  eq('trace', tr.map((r) => [r.off, r.matched, r.won, Object.keys(r.texts)]), [[true, false, false, []], [false, true, false, ['en']], [false, true, true, ['ru', 'en']]]);
  eq('trace conditions', tr[1].conds.map((c) => c.ok), [true]);
  eq('main text', [mainText({ ru: 'Студия' }, 'en'), mainText({ en: 'Studio', ru: 'Студия' }, 'ka'), mainText({ en: 'Studio', ru: 'Студия' }, 'ka', ['ru'])], ['Студия', 'Studio', 'Студия']);
  const oldSite = normalizeRules([
    { when: [{ v: 'layout', op: 'is', a: ['apartments'] }, { v: 'btype', op: 'is', a: ['apartments'] }, { v: 'ownership', op: 'is', a: ['private', ''] }, { v: 'legal', op: 'is', a: ['nonresidential'] }], tpl: { en: 'Apartments {bedrooms}+1', ka: 'აპარტამენტები {bedrooms}+1' } },
    { when: [{ v: 'layout', op: 'is', a: ['apartments'] }], tpl: { ru: '{size:euro}', en: '{bedrooms}-bedroom apartment' } },
    { when: [{ v: 'layout', op: 'is', a: ['studio'] }], tpl: { en: 'Studio', ka: 'სტუდიო' } },
    { when: [{ v: 'rooms', op: 'min', a: ['1'] }], tpl: { en: '{rooms}-room', ka: '{rooms}-ოთახიანი' } },
  ]);
  eq('rules vars', rulesVars(oldSite).sort(), ['bedrooms', 'btype', 'layout', 'legal', 'ownership', 'rooms', 'size']);
  const title = (raw) => buildRuleTitle(oldSite, raw, () => Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v)])), { scales: [euro] }).i18n;
  eq('apartments in a non-residential building', title({ layout: 'apartments', btype: 'apartments', legal: 'nonresidential', bedrooms: 1 }), { en: 'Apartments 1+1', ka: 'აპარტამენტები 1+1' });
  eq('euro layout in a residential building', title({ layout: 'apartments', btype: 'block', legal: 'residential', bedrooms: 1, size: 2 }), { ru: 'Евродвушка', en: '1-bedroom apartment' });
  eq('n rooms', title({ layout: 'rooms', rooms: 3 }), { en: '3-room', ka: '3-ოთახიანი' });
  eq('zero rooms: no title', title({ layout: 'rooms', rooms: 0 }), {});

  // --- fields -------------------------------------------------------------------------------------------------------
  eq('field needs a key', normalizeField({ label: 'x' }), null);
  const area = normalizeField({ key: 'area', type: 'number', label: { en: 'Area' }, unit: 'm2', min: 1, max: 10000, decimals: 2, roles: ['form', 'filter'], group: 'Flat', sort: 2 });
  eq('number field', [area.type, area.unit, area.unitKind, area.min, area.decimals, area.roles, area.group], ['number', 'm2', 'area', 1, 2, ['form', 'filter'], 'flat']);
  eq('free unit label', normalizeField({ key: 'term', type: 'number', unit: 'days' }).unitText, { en: 'days' });
  eq('options only where they mean something', normalizeField({ key: 'n', type: 'number', options: ['a'] }).options, []);
  eq('computed is never required', normalizeField({ key: 'rooms', type: 'number', required: true, computed: 'rooms' }).required, false);
  eq('legacy showIf', normalizeField({ key: 'x', showIf: { key: 'kind', equals: 'router' } }).showIf, [{ v: 'kind', op: 'is', a: ['router'] }]);
  eq('legacy showIf in', normalizeField({ key: 'x', showIf: { key: 'kind', in: ['a', 'b'] } }).showIf, [{ v: 'kind', op: 'is', a: ['a', 'b'] }]);
  eq('number values', [checkValue(area, '12,5'), checkValue(area, '1 234.567'), checkValue(area, 'abc'), checkValue(area, 0), checkValue(area, 20000)], [{ value: 12.5, error: null }, { value: 1234.57, error: null }, { value: null, error: 'not_number' }, { value: 0, error: 'min' }, { value: 20000, error: 'max' }]);
  eq('number with unit input', checkValue(area, { value: 1000, unit: 'sqft' }).value, 92.9);
  eq('unit input conversion', [checkValue(normalizeField({ key: 't', type: 'number', unit: 'c', decimals: 1 }), { value: 212, unit: 'f' }).value, checkValue(area, { value: 5, unit: 'kg' }).error], [100, 'not_number']);
  eq('required', [checkValue({ ...area, required: true }, '').error, checkValue(area, '').error], ['required', null]);
  const range = normalizeField({ key: 'price', type: 'range' });
  eq('range', [checkValue(range, [100, 200]), checkValue(range, { min: 300, max: 100 }).error, checkValue(range, ['', 5]).value, checkValue(range, [1, 'x']).error], [{ value: [100, 200], error: null }, 'range_order', [null, 5], 'not_number']);
  const sel = normalizeField({ key: 'heating', type: 'select', options: ['gas', { v: 'central', label: { en: 'Central', ru: 'Центральное' } }] });
  eq('select', [checkValue(sel, 'gas').value, checkValue(sel, 'coal').error], ['gas', 'not_option']);
  const multi = normalizeField({ key: 'view', type: 'multiselect', options: ['sea', 'mountains', 'city'] });
  eq('multiselect', [checkValue(multi, 'sea, city,sea').value, checkValue(multi, ['sea', 'moon']).error, checkValue(multi, []).value], [['sea', 'city'], 'not_option', null]);
  const date = normalizeField({ key: 'built', type: 'date' });
  eq('date', [checkValue(date, '2027-02-30').error, checkValue(date, '2027-02-28').value, checkValue(date, '28.02.2027').value, checkValue(date, 'soon').error], ['not_date', '2027-02-28', '2027-02-28', 'not_date']);
  const bool = normalizeField({ key: 'pool', type: 'bool' });
  eq('bool', [checkValue(bool, 'yes').value, checkValue(bool, 0).value, checkValue(bool, 'maybe').error], [true, false, 'not_bool']);
  eq('text', [checkValue(normalizeField({ key: 't' }), '  hi ').value, checkValue(normalizeField({ key: 't' }), 'x'.repeat(2001)).error, checkValue(normalizeField({ key: 't', type: 'longtext' }), 'x'.repeat(2001)).error], ['hi', 'too_long', null]);
  eq('mac', [normalizeMac('aa-bb-cc-dd-ee-ff'), normalizeMac('aabb.ccdd.eeff'), normalizeMac('aa:bb:cc')], ['AA:BB:CC:DD:EE:FF', 'AA:BB:CC:DD:EE:FF', null]);
  eq('ip', [normalizeIp(' 192.168.001.010 '), normalizeIp('300.1.1.1'), normalizeIp('2001:DB8:0:0:0:0:0:1'), normalizeIp('::ffff:192.0.2.128'), normalizeIp('1::2::3')], ['192.168.1.10', null, '2001:db8::1', '::ffff:192.0.2.128', null]);
  eq('serial', [normalizeCode('  SN 12  34 '), normalizeCode('a<b'), normalizeCode('Инв-№1')], ['SN 12 34', null, null]);
  eq('ident fields', [checkValue(normalizeField({ key: 'm', type: 'bssid' }), 'x').error, checkValue(normalizeField({ key: 'i', type: 'ip' }), '10.0.0.1').value], ['mac', '10.0.0.1']);
  eq('compact ident', compactIdent('aa-bb:cc'), 'AABBCC');
  // a form: showIf hides, computed is skipped, inherited and default values satisfy required
  const form = [
    normalizeField({ key: 'kind', type: 'select', options: ['router', 'printer'], required: true }),
    normalizeField({ key: 'wifi_mac', type: 'mac', required: true, showIf: { key: 'kind', equals: 'router' } }),
    normalizeField({ key: 'serial', type: 'serial', required: true, scope: 'instance' }),
    normalizeField({ key: 'vendor', type: 'text', required: true }),
    normalizeField({ key: 'ports', type: 'number', required: true, default: 4 }),
    normalizeField({ key: 'rooms', type: 'number', computed: 'rooms' }),
  ];
  eq('validate: showIf off', validateValues(form, { kind: 'printer', serial: 'S1', rooms: 99 }, { inherited: { vendor: { value: 'HP' } } }), { values: { kind: 'printer', serial: 'S1' }, errors: {} });
  eq('validate: showIf on', validateValues(form, { kind: 'router', wifi_mac: 'zz', serial: 'S1', vendor: 'X' }).errors, { wifi_mac: 'mac' });
  eq('validate: scope', validateValues(form, {}, { scope: 'instance' }).errors, { serial: 'required' });
  eq('validate: no enforce', validateValues(form, {}, { enforceRequired: false }).errors, {});
  eq('visible', [fieldVisible(form[1], { kind: 'router' }), fieldVisible(form[1], {}), fieldVisible(form[0], {})], [true, false, true]);
  eq('value text', [valueText(area, 78.5, 'en'), valueText(sel, 'central', 'ru'), valueText(multi, ['sea', 'city']), valueText(bool, true, 'ka'), valueText(range, [100, 200]), valueText(normalizeField({ key: 'term', type: 'number', unitText: { en: 'days' } }), 3)], ['78.5 m²', 'Центральное', 'sea, city', 'კი', '100–200', '3 days']);
  const listing = [
    normalizeField({ key: 'price', type: 'number', roles: ['form', 'filter', 'card', 'tile'], sort: 1 }),
    normalizeField({ key: 'deposit', type: 'number', roles: ['form', 'card'], applies: ['rent'], group: 'terms', groupLabel: { en: 'Terms' }, sort: 3 }),
    normalizeField({ key: 'min_term', type: 'number', roles: ['form', 'filter'], applies: 'rent', group: 'terms', sort: 2 }),
    normalizeField({ key: 'floor', type: 'number', roles: ['form', 'filter'], group: 'house', groupLabel: { en: 'House' }, sort: 4 }),
  ];
  eq('fields for a role and context', fieldsFor(listing, 'filter', { deal: 'sale' }).map((f) => f.key), ['price', 'floor']);
  eq('applies by any context value', fieldsFor(listing, 'form', { deal: 'sale', intent: 'rent' }).map((f) => f.key), ['price', 'min_term', 'deposit', 'floor']);
  eq('with role, no context', fieldsWithRole(listing, 'filter').map((f) => f.key), ['price', 'min_term', 'floor']);
  eq('applies empty = everywhere', fieldApplies(listing[0], {}), true);
  eq('groups', fieldGroups(listing).map((g) => [g.key, g.label.en || '', g.fields.map((f) => f.key)]), [['terms', 'Terms', ['min_term', 'deposit']], ['house', 'House', ['floor']], ['', '', ['price']]]);
  eq('patch: locked keys need the owner', fieldPatch({ key: 'x', type: 'number', label: 'L', junk: 1 }), { label: { en: 'L' } });
  eq('patch: owner', fieldPatch({ key: 'x', type: 'number' }, { owner: true }), { key: 'x', type: 'number' });
  eq('patch: untouched stays absent', Object.keys(fieldPatch({ required: 0 })), ['required']);

  // --- inheritance down a category tree -----------------------------------------------------------------------------
  const tree = [
    { id: 'root', name: 'Equipment', fields: [
      { key: 'vendor', label: 'Vendor', required: true, sort: 1 },
      { key: 'serial', label: 'Serial', type: 'serial', scope: 'instance', sort: 2 },
      { key: 'color', label: 'Colour', sort: 9 },
      { key: 'bad key', label: 'x' },
    ], values: { vendor: 'Generic' } },
    { id: 'net', name: 'Network', fields: [
      { key: 'mac', label: 'MAC', type: 'mac', scope: 'instance', sort: 3 },
      { key: 'color', hidden: true },
      { key: 'nolabel' },
    ] },
    { id: 'router', name: 'Router', fields: [
      { key: 'vendor', required: false, options: ['Cisco', 'MikroTik'] },
      { key: 'serial', label: 'S/N' },
      { key: 'color', label: 'Case colour', sort: 5 },
    ], values: { vendor: 'MikroTik' } },
  ];
  const res = resolveSchema(tree);
  eq('resolved keys in order', res.fields.map((f) => f.key), ['vendor', 'serial', 'mac', 'color']);
  const vendor = res.fields.find((f) => f.key === 'vendor');
  eq('override keeps the origin', [vendor.origin, vendor.definedAt, vendor.overridden, vendor.required, vendor.label.en], ['root', 'router', true, false, 'Vendor']);
  eq('trail', vendor.trail, [{ at: 'root', set: ['type', 'label', 'scope', 'required', 'sort'] }, { at: 'router', set: ['required', 'options'] }]);
  eq('override of a type-less level', res.fields.find((f) => f.key === 'serial').type, 'serial');
  eq('hidden then redefined below is new', [res.fields.find((f) => f.key === 'color').origin, res.fields.find((f) => f.key === 'color').overridden], ['router', false]);
  eq('hidden list', res.hidden, [{ key: 'color', at: 'net' }]);
  eq('definition errors', res.errors, [{ at: 'root', key: 'bad key', errors: ['key'] }, { at: 'net', key: 'nolabel', errors: ['label'] }]);
  eq('inherited values with their level', res.values, { vendor: { value: 'MikroTik', from: 'router' } });
  eq('def of an inherited key needs no label', normalizeFieldDef({ key: 'vendor' }, { inherited: new Set(['vendor']) }).errors, []);
  eq('chain', res.chain.map((c) => c.id), ['root', 'net', 'router']);

  // --- overlay ------------------------------------------------------------------------------------------------------
  const base = [
    normalizeField({ key: 'price', type: 'number', required: true, label: 'Price', sort: 1 }),
    normalizeField({ key: 'area', type: 'number', label: 'Area', sort: 2 }),
    normalizeField({ key: 'floor', type: 'number', label: 'Floor', sort: 3 }),
  ];
  const ov = normalizeOverlay(JSON.stringify({
    over: [{ key: 'price', hidden: true }, { key: 'area', label: { en: 'Living area' }, sort: 9 }, { key: 'floor', hidden: true }, { key: 'area', hidden: true }],
    own: [{ key: 'balcony', type: 'bool', label: 'Balcony', sort: 5 }, { key: 'price', label: 'Mine' }],
  }));
  eq('overlay result', applyOverlay(base, ov).map((f) => [f.key, f.label.en]), [['price', 'Price'], ['balcony', 'Balcony'], ['area', 'Living area']]);
  eq('overlay refusals', overlayRefused(base, ov), [{ key: 'price', why: 'required' }, { key: 'price', why: 'taken' }]);
  eq('overlay garbage', normalizeOverlay('{nope'), { own: [], over: [] });
  eq('own fields stay in the form', ov.own[0].roles, ['form', 'card']);

  // --- building -> unit values --------------------------------------------------------------------------------------
  const iv = inheritValues([{ id: 'building', values: { heating: 'central', parking: true, floors: 9 } }, { id: 'unit', values: { heating: 'gas', parking: null, rooms: 2, floors: undefined } }]);
  eq('values inherit, override, clear', iv, { values: { heating: 'gas', floors: 9, rooms: 2 }, from: { heating: 'unit', floors: 'building', rooms: 'unit' } });
  eq('merge by key', mergeByKey([[{ key: 'a', v: 1 }, { key: 'b', v: 1 }], [{ key: 'a', v: 2 }]]), [{ key: 'a', v: 2 }, { key: 'b', v: 1 }]);

  // --- tags ---------------------------------------------------------------------------------------------------------
  const nearS = normalizeScale({ key: 'near', mode: 'upto', steps: [{ at: 300, name: { en: 'close', ru: 'близко' } }, { at: 800, name: 'nearby' }, { at: null, name: 'far' }] });
  const BEACH = normalizeTagDef({
    key: 'beach', label: { en: 'Beach', ru: 'Пляж' }, icon: '🏖', color: '#0EA5E9', where: ['building', 'unit'],
    fields: [{ key: 'dist', kind: 'number', unit: 'm', scale: 'near' }, { key: 'min', kind: 'number', unitText: { en: 'min walk', ru: 'мин пешком' } }],
    texts: [{ en: 'beach: {dist}, {min}', ru: 'пляж: {dist}, {min}' }, { en: 'beach at {dist}' }, { en: 'beach {min} from home' }],
    link: 'https://maps.example/?q=%t+%p&d={dist}',
  });
  const MALL = normalizeTagDef({ key: 'near_the_mall', label: { en: 'Near the mall', ru: 'Возле ТЦ' }, where: ['building', 'unit'], fields: [{ key: 'mall', kind: 'select', options: [{ v: 'grandmall', label: 'Grandmall' }, { v: 'metrocity', label: 'Metro City' }] }], texts: [{ en: 'Near the mall ({mall})' }] });
  eq('tag def', [BEACH.color, BEACH.where, normalizeTagDef({ key: 'x' }), normalizeTagDef({ key: 'Bad Key', label: 'a' }), normalizeTagDef({ key: 'a', label: 'A', where: ['moon'] }).where, normalizeTagDef({ key: 'a', label: 'A', color: 'red' }).color], ['#0ea5e9', ['building', 'unit'], null, null, ['unit'], '']);
  const d1 = normalizeTagDef({ key: 'a', label: 'A', fields: [{ key: 'x', kind: 'number', unit: 'parsec', unitText: 'pc' }, { key: 'y', kind: 'select', options: [] }, { key: 'x', kind: 'text' }] });
  eq('tag fields', [d1.fields.length, d1.fields[0].unit, d1.fields[0].unitText.en], [1, '', 'pc']);
  eq('tag link schemes', [normalizeTagDef({ key: 'a', label: 'A', link: 'javascript:alert(1)' }).link, normalizeTagDef({ key: 'a', label: 'A', link: 'tel:%m' }).link], ['', 'tel:%m']);
  const sneaky = normalizeTagDef({ key: 'a', label: 'A', fields: [{ key: 'u', kind: 'text' }], link: 'https://x/{u}' });
  eq('tag link value is encoded', tagLinkUrl(sneaky, { u: 'javascript:alert(1)' }), 'https://x/javascript%3Aalert(1)');
  eq('tag values', [normalizeTagValues(BEACH, { dist: { value: 1000, unit: 'ft' }, min: '5', nope: 1 }), normalizeTagValues(BEACH, { dist: 'far' }), normalizeTagValues(MALL, { mall: 'metro' }), normalizeTagValues(MALL, { mall: 'MetroCity' })], [{ dist: 304.8, min: 5 }, {}, {}, { mall: 'metrocity' }]);
  eq('tag text variants', [tagText(BEACH, { dist: 270, min: 4 }), tagText(BEACH, { dist: 270 }), tagText(BEACH, { min: 4 }), tagText(BEACH, {}), tagText(BEACH, { dist: 270, min: 4 }, 'ru')], ['beach: 270 m, 4 min walk', 'beach at 270 m', 'beach 4 min walk from home', 'Beach', 'пляж: 270 м, 4 мин пешком']);
  eq('tag text other language falls back', tagText(BEACH, { min: 4 }, 'ru'), 'beach 4 мин пешком from home');
  const BS = normalizeTagDef({ ...BEACH, texts: [{ en: 'beach {dist:near}' }, { en: 'beach at {dist}' }] });
  eq('tag text scale', [tagText(BS, { dist: 270 }, 'en', { scales: [nearS] }), tagText(BS, { dist: 900 }, 'en', { scales: [nearS] }), tagText(BS, { dist: 270 })], ['beach close', 'beach far', 'beach at 270 m']);
  const hd = normalizeTagDef({ key: 'a', label: '<b>', fields: [{ key: 'x', kind: 'number', unit: 'm' }], texts: [{ en: '<i> {x}' }] });
  const esc = (s) => s.replace(/</g, '&lt;');
  eq('tag html', [tagText(hd, { x: 5 }, 'en', { html: { esc, value: () => '<span>5 m</span>' } }), tagText(hd, {}, 'en', { html: { esc } })], ['&lt;i> <span>5 m</span>', '&lt;b>']);
  eq('tag link one pass', tagLinkUrl(BEACH, { dist: 270 }, 'en', { prop: 'Flat %m' }), 'https://maps.example/?q=Beach+' + encodeURIComponent('Flat %m') + '&d=' + encodeURIComponent('270 m'));
  eq('tag no link', tagLinkUrl(MALL, {}), '');
  const marks = inheritMarks([{ tag: 1, values: { mall: 'metrocity', min: 5 } }, { tag: 2, values: {} }], [{ tag: 1, values: { min: 3 } }, { tag: 2, values: {}, off: true }, { tag: 3, values: {} }]);
  eq('marks inherit', marks, [{ tag: 1, values: { mall: 'metrocity', min: 3 }, from: 'both' }, { tag: 3, values: {}, from: 'unit' }]);
  eq('tokens', [tagIndexTokens(7, MALL, { mall: 'metrocity' }), tagIndexTokens(9, BEACH, { dist: 270, min: 4 }, [nearS]), tagIndexTokens(9, BEACH, { dist: 270 })], [['t7', 't7.mall.metrocity'], ['t9', 't9.dist~0'], ['t9']]);
  eq('token parse', parseTagTokens('t7,t7.mall.metrocity, T9.dist~0,bad;drop table,t7'), ['t7', 't7.mall.metrocity', 't9.dist~0']);
  eq('token groups', ['t7.mall.metrocity', 't9.dist~0', 't7'].map(tagTokenGroup), ['t7.mall', 't9.dist', 't7']);
  eq('token cap', parseTagTokens(Array.from({ length: 50 }, (_, i) => 't' + i)).length, 20);
  eq('collide', [tagsCollide(normalizeTagDef({ key: 'my_mall', label: { ru: 'возле тц' } }), MALL), tagsCollide(normalizeTagDef({ key: 'beach', label: 'Sea' }), BEACH), tagsCollide(BEACH, MALL)], [true, true, false]);
  const mine = normalizeTagDef({ key: 'my_mall', label: 'Near mall', fields: [{ key: 'mall', kind: 'select', options: [{ v: 'metro', label: { en: 'Metro City' } }] }, { key: 'walk', kind: 'number' }] });
  const cmp = tagCompare(mine, MALL);
  eq('compare', [cmp.fields.map((f) => [f.key, f.same]), cmp.link, cmp.where], [[['mall', true], ['walk', false]], true, false]);
  eq('migrate', migrateTagValues(mine, MALL, { mall: 'metro', walk: 5 }), { values: { mall: 'metrocity' }, dropped: ['walk'] });
  const mFrom = normalizeTagDef({ key: 'a', label: 'A', fields: [{ key: 'd', kind: 'number', unit: 'ft' }] }), mTo = normalizeTagDef({ key: 'b', label: 'B', fields: [{ key: 'd', kind: 'number', unit: 'm' }] });
  eq('migrate converts units', migrateTagValues(mFrom, mTo, { d: 1000 }), { values: { d: 304.8 }, dropped: [] });

  console.log(`schema: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
