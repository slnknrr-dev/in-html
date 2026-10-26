// contract/test.js - unit tests of the contract library: node contract/test.js (also node check.js tests contract).
// Dates and the billing periods (the 23rd rule, month ends, leap years, partial periods, anchors, due dates), numbers
// and money in words (ru / uk / en agreement), legal dates, the expression and text languages, normalization of
// hostile input, rendering of the built-in lease (modifiers, levels, numbering, appendices, languages, bilingual),
// field extraction, validators (masks, check digits, the JS validator core) and compilation into one HTML file
// without network uses.
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { addDays, addMonths, daysInMonth, dayNumber, fromDayNumber, monthsBetween, parseDate } from './dates.js';
import { billingSchedule, termOf } from './period.js';
import { numberWords, slavicPlural } from './words.js';
import { formatDate, formatNumber, initials, moneyText, plural } from './format.js';
import { evaluate, parseExpr, parsePipe } from './expr.js';
import { parseText, textRefs } from './syntax.js';
import { exportJSON, newDocument, normalizeDoc, normalizeTemplate, parseImport } from './model.js';
import { collectRefs, syncFields } from './fields.js';
import { createEnv } from './env.js';
import { renderContract } from './render.js';
import { checkMask, cleanIssues, userValidatorCore, validateDoc } from './validate.js';
import { compileStatic, compileTemplate } from './compile.js';
import { addLanguage, removeLanguage, setMainLanguage, translationStatus } from './langs.js';
import { SAMPLES } from './samples.js';
import { LEASE } from './lease.js';

// Harness design: no test framework (zero dependencies, runs in plain Node and from check.js). `ok` counts and logs
// only failures with optional context, so a green run is one line. Tests are assertions on observable outputs
// (strings, HTML text) rather than internals, so refactors that keep behaviour keep tests green.
// sp/textOf normalize NBSP and strip tags: formatting functions emit U+00A0 deliberately (format.js), and tests
// should assert words, not whitespace code points.
let failed = 0, passed = 0;
const ok = (c, name, info) => { if (c) passed++; else { failed++; console.log('x contract: ' + name + (info !== undefined ? ' ' + JSON.stringify(info) : '')); } };
const sp = (s) => String(s).replace(/ /g, ' ');
const textOf = (html) => sp(html.replace(/<[^>]+>/g, ' ').replace(/&#42;/g, '*').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' '));
const periodsOf = (r) => r.periods.map((p) => `${p.from}..${p.to}`);

export async function run() {
  // --- dates -------------------------------------------------------------------------------------------------
  ok(daysInMonth(2028, 2) === 29 && daysInMonth(2027, 2) === 28 && daysInMonth(1900, 2) === 28 && daysInMonth(2000, 2) === 29, 'leap years');
  ok(addMonths('2027-01-31', 1) === '2027-02-28' && addMonths('2028-01-31', 1) === '2028-02-29' && addMonths('2027-03-31', -1) === '2027-02-28', 'month arithmetic clamps the day');
  ok(addDays('2027-12-31', 1) === '2028-01-01' && addDays('2028-03-01', -1) === '2028-02-29', 'adding days');
  // Property test over ~3800 sampled day numbers spanning years ~-220 to ~10200 (step 997, a prime, so
  // the step never aligns with the 7-day or 146097-day cycles): dayNumber(fromDayNumber(n)) must be the identity.
  let rt = true;
  for (let n = -800000; n < 3000000; n += 997) { const d = fromDayNumber(n); if (dayNumber(d) !== n) { rt = false; break; } }
  ok(rt && dayNumber({ y: 1970, m: 1, d: 1 }) === 0, 'day numbers round-trip');
  ok(parseDate('2027-02-29') === null && parseDate('23.01.2027').d === 23 && parseDate('x') === null && parseDate(null) === null, 'date parsing');
  ok(monthsBetween('2027-01-23', '2027-02-22') === 0 && monthsBetween('2027-01-23', '2027-02-23') === 1 && monthsBetween('2027-01-31', '2027-02-28') === 1, 'whole months between dates');

  // --- billing periods ---------------------------------------------------------------------------------------
  const s23 = billingSchedule({ start: '2027-01-23', months: 11, amount: 65000 });
  ok(s23.ok && s23.count === 11 && s23.partialCount === 0, 'the 23rd: eleven full periods', s23.count);
  ok(periodsOf(s23)[0] === '2027-01-23..2027-02-22' && periodsOf(s23)[1] === '2027-02-23..2027-03-22' && periodsOf(s23)[10] === '2027-11-23..2027-12-22', 'the 23rd: from the 23rd to the 22nd', periodsOf(s23));
  ok(s23.end === '2027-12-23' && s23.last === '2027-12-22' && s23.total === 715000, 'the last period ends the day before the move-out date', [s23.end, s23.last, s23.total]);
  ok(s23.periods[1].days === 28 && s23.periods[0].days === 31, 'period lengths', s23.periods.map((p) => p.days));
  const s31 = billingSchedule({ start: '2027-01-31', months: 3, amount: 100 });
  ok(JSON.stringify(periodsOf(s31)) === JSON.stringify(['2027-01-31..2027-02-27', '2027-02-28..2027-03-30', '2027-03-31..2027-04-29']) && s31.end === '2027-04-30', 'start on the 31st: anchors clamp to short months', periodsOf(s31));
  const leap = billingSchedule({ start: '2028-02-29', months: 12, amount: 1 });
  ok(leap.count === 12 && periodsOf(leap)[0] === '2028-02-29..2028-03-28' && periodsOf(leap)[11] === '2029-01-29..2029-02-27' && leap.end === '2029-02-28', 'leap day start', periodsOf(leap));
  const leap2 = billingSchedule({ start: '2028-01-30', months: 2, amount: 1 });
  ok(periodsOf(leap2)[0] === '2028-01-30..2028-02-28' && periodsOf(leap2)[1] === '2028-02-29..2028-03-29', 'January 30th in a leap year', periodsOf(leap2));
  const part = billingSchedule({ start: '2027-01-23', end: '2027-03-10', amount: 1000, prorata: true });
  ok(part.count === 2 && part.periods[1].partial && part.periods[1].days === 15 && part.periods[1].fullDays === 28 && part.periods[1].amount === 535.71 && part.last === '2027-03-09', 'move-out between anchors: a pro-rata last period', part.periods);
  const noPr = billingSchedule({ start: '2027-01-23', end: '2027-03-10', amount: 1000, prorata: false });
  ok(noPr.periods[1].amount === 1000 && noPr.total === 2000, 'without pro rata a part period is charged in full');
  const anch = billingSchedule({ start: '2027-01-10', months: 2, anchorDay: 1, amount: 3100, prorata: true });
  ok(JSON.stringify(periodsOf(anch)) === JSON.stringify(['2027-01-10..2027-01-31', '2027-02-01..2027-02-28', '2027-03-01..2027-03-09']) && anch.periods[0].amount === 2200 && anch.periods[2].amount === 900, 'anchor day 1: partial first and last periods', anch.periods);
  const due = billingSchedule({ start: '2027-01-23', months: 2, amount: 1, dueOffset: -3 });
  ok(due.periods[0].due === '2027-01-20' && due.periods[1].due === '2027-02-20', 'due dates three days in advance');
  ok(billingSchedule({ months: 3 }).issues[0] === 'start' && billingSchedule({ start: '2027-05-01', end: '2027-04-01' }).issues[0] === 'order' && billingSchedule({ start: '2027-05-01' }).issues[0] === 'term', 'schedule problems are reported');
  const term = termOf({ start: '2027-01-23', months: 11 });
  ok(term.end === '2027-12-23' && term.last === '2027-12-22' && term.months === 11 && term.restDays === 0, 'the term of a lease', term);
  ok(termOf({ start: '2027-01-23', end: '2027-03-10' }).months === 1 && termOf({ start: '2027-01-23', end: '2027-03-10' }).restDays === 15, 'a term ending between anchors');

  // --- words and formats -------------------------------------------------------------------------------------
  ok(numberWords(50000, 'ru') === 'пятьдесят тысяч' && numberWords(1001, 'ru') === 'одна тысяча один' && numberWords(2002, 'ru', 'f') === 'две тысячи две', 'Russian numbers: gender of thousands and units');
  ok(numberWords(21, 'ru') === 'двадцать один' && numberWords(12, 'ru') === 'двенадцать' && numberWords(0, 'ru') === 'ноль' && numberWords(1000000, 'ru') === 'один миллион' && numberWords(5250000, 'ru') === 'пять миллионов двести пятьдесят тысяч', 'Russian numbers');
  ok(numberWords(111111, 'ru') === 'сто одиннадцать тысяч сто одиннадцать' && numberWords(4004, 'ru') === 'четыре тысячи четыре', 'Russian teens and few');
  ok(numberWords(2002, 'uk', 'f') === 'дві тисячі дві' && numberWords(5, 'uk') === 'п’ять', 'Ukrainian numbers');
  ok(numberWords(1250, 'en') === 'one thousand two hundred and fifty' && numberWords(1005, 'en') === 'one thousand and five' && numberWords(65000, 'en') === 'sixty-five thousand', 'English numbers', numberWords(1250, 'en'));
  ok(numberWords(7, 'de') === '', 'no words for other languages');
  ok(slavicPlural(1, ['a', 'b', 'c']) === 'a' && slavicPlural(3, ['a', 'b', 'c']) === 'b' && slavicPlural(11, ['a', 'b', 'c']) === 'c' && slavicPlural(22, ['a', 'b', 'c']) === 'b' && slavicPlural(112, ['a', 'b', 'c']) === 'c', 'Slavic plural');
  ok(sp(moneyText(50000, { lang: 'ru', currency: 'RUB' })) === '50 000 (пятьдесят тысяч) рублей', 'money in words: 50 000 рублей', moneyText(50000, { lang: 'ru' }));
  ok(sp(moneyText(1, { lang: 'ru' })) === '1 (один) рубль' && sp(moneyText(22, { lang: 'ru' })) === '22 (двадцать два) рубля', 'rouble agreement');
  ok(sp(moneyText(1250.5, { lang: 'ru' })) === '1 250 (одна тысяча двести пятьдесят) рублей 50 копеек' && sp(moneyText(3.01, { lang: 'ru' })) === '3 (три) рубля 01 копейка', 'kopecks', moneyText(1250.5, { lang: 'ru' }));
  ok(sp(moneyText(50000, { lang: 'en' })) === '50,000 (fifty thousand) roubles' && sp(moneyText(1, { lang: 'en', currency: 'USD' })) === '1 (one) US dollar', 'English money', moneyText(50000, { lang: 'en' }));
  ok(sp(moneyText(3, { lang: 'ru', currency: 'USD' })) === '3 (три) доллара США' && sp(moneyText(1, { lang: 'uk', currency: 'UAH' })) === '1 (одна) гривня' && sp(moneyText(2, { lang: 'uk', currency: 'UAH' })) === '2 (дві) гривні', 'currencies agree in gender');
  ok(sp(moneyText(50000, { lang: 'de', currency: 'EUR' })) === '50.000 EUR' && sp(moneyText(50000, { lang: 'ru', words: false })) === '50 000 рублей' && sp(moneyText(100, { lang: 'ru', capital: true })) === '100 (Сто) рублей', 'money without words');
  ok(sp(moneyText(0.999, { lang: 'ru' })) === '1 (один) рубль', 'rounding of kopecks');
  ok(sp(formatDate('2027-01-23', 'ru')) === '«23» января 2027 г.' && sp(formatDate('2027-01-03', 'ru')) === '«03» января 2027 г.' && sp(formatDate('2027-01-23', 'ru', 'text')) === '23 января 2027 г.', 'Russian legal dates', formatDate('2027-01-23', 'ru'));
  ok(sp(formatDate('2027-01-23', 'en')) === '23 January 2027' && formatDate('2027-01-23', 'ru', 'short') === '23.01.2027' && sp(formatDate('2027-03-08', 'uk')) === '«08» березня 2027 р.' && sp(formatDate('2027-01-23', 'es')) === '23 de enero de 2027', 'dates in other languages');
  ok(formatNumber(1234567.5, 'ru') === '1 234 567,5' && formatNumber(1234.5, 'en', { decimals: 2 }) === '1,234.50' && formatNumber(5000, 'es') === '5000' && formatNumber(50000, 'es') === '50.000', 'numbers');
  ok(plural('ru', 21, ['день', 'дня', 'дней']) === 'день' && plural('ru', 22, ['день', 'дня', 'дней']) === 'дня' && plural('ru', 25, ['день', 'дня', 'дней']) === 'дней' && plural('en', 1, ['day', 'days']) === 'day' && plural('en', 2, ['day', 'days']) === 'days', 'plural forms');
  ok(sp(initials('Иванов Иван Иванович', 'ru')) === 'Иванов И. И.' && sp(initials('John Smith', 'en')) === 'J. Smith' && initials('Мадонна', 'ru') === 'Мадонна', 'initials');

  // --- expressions -------------------------------------------------------------------------------------------
  const vars = { rent: 50000, months: 2, name: 'Анна', list: [{ p: 2 }, { p: 3 }], obj: { a: 1 }, s: 'strict' };
  const E = (src) => { const p = parseExpr(src); return p.error ? 'ERR:' + p.error : evaluate(p.ast, { get: (path) => path.split('.').reduce((o, k) => (o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null), vars), today: '2027-01-01' }); };
  ok(E('rent * months + 1') === 100001 && E('(1 + 2) * 3') === 9 && E('10 / 4') === 2.5 && E('7 % 3') === 1 && E('-rent') === -50000, 'arithmetic and precedence');
  ok(E("s == 'strict' ? 2 : 1") === 2 && E("s == 'soft' ? 2 : s == 'strict' ? 3 : 1") === 3 && E('1 < 2 && 2 < 3') === true && E('not 1') === false && E('0 or 5') === 5, 'conditions');
  ok(E("sum(list, 'p')") === 5 && E('count(list)') === 2 && E('round(10 / 3, 2)') === 3.33 && E("addMonths('2027-01-31', 1)") === '2027-02-28' && E("days('2027-01-01', '2027-02-01')") === 31, 'functions');
  ok(E("name + ' ' + months") === 'Анна 2' && E('obj.a') === 1 && E('list[1].p') === 3 && E('missing.x') === null, 'strings and paths');
  ok(E('obj.constructor') === null && E('obj.__proto__') === null && E("list['constructor']") === null && String(E('alert(1)')).startsWith('ERR') && String(E('obj.a(1)')).startsWith('ERR'), 'no prototype access, no foreign calls');
  ok(E('1 / 0') === null && E("'5' == 5") === true && E("'' == null") === true, 'division by zero and loose equality');
  ok(String(E('('.repeat(80) + '1' + ')'.repeat(80))).startsWith('ERR') && String(E('1 +')).startsWith('ERR'), 'deep or broken expressions are errors');
  const pp = parsePipe("rent | money | upper"), pq = parsePipe("n | plural:'день','дня','дней'");
  ok(pp.filters.length === 2 && pp.filters[0].name === 'money' && pq.filters[0].args.length === 3 && parsePipe('a || b').filters.length === 0, 'filters in placeholders');

  // --- the text language -------------------------------------------------------------------------------------
  const pt = parseText("A {{x}} [[if a]]1[[elif b > 2]]2[[else]]3[[end]] [[each items as it]]{{it.name}} {{index}}[[end]] {{#c1}}");
  ok(!pt.errors.length && pt.nodes.some((n) => n.t === 'if' && n.branches.length === 2 && n.els) && pt.nodes.some((n) => n.t === 'each' && n.as === 'it') && pt.nodes.some((n) => n.t === 'num' && n.id === 'c1'), 'blocks parse', pt.errors);
  const refs = textRefs(pt.nodes);
  ok(refs.has('x') && refs.has('a') && refs.has('b') && refs.has('items') && !refs.has('it.name') && !refs.has('index'), 'references exclude loop variables', [...refs]);
  ok(parseText('[[if a]] open').errors.length === 1 && parseText('{{1 +}}').errors.length === 1 && parseText('[[end]]').errors.length === 1, 'broken texts report errors');

  // The model block feeds hostile input (prototype keys, oversized arrays, wrong types) through normalization: the
  // contract is "never throws, always returns the canonical shape".
  // --- model -------------------------------------------------------------------------------------------------
  let threw = false;
  try {
    for (const bad of [null, 5, 'x', [], { fields: 'x' }, { sections: [null, 7, { clauses: [null, { text: 5 }] }] }, { __proto__: { evil: 1 }, langs: ['zz-!!', 5], fields: [{ id: '__proto__' }, { id: 'a.constructor' }, { id: 'ok', type: 'nope' }] }, { fields: Array.from({ length: 5000 }, (_, i) => ({ id: 'f' + i })) }]) {
      const t = normalizeTemplate(bad);
      if (!Array.isArray(t.fields) || !t.langs.length || t.fields.length > 400) throw new Error('shape');
    }
    normalizeDoc({ values: { '__proto__': 1, a: { b: { c: { d: { e: 1 } } } } } });
  } catch (e) { threw = e; }
  ok(!threw, 'normalization never throws on hostile input', String(threw));
  const nt = normalizeTemplate({ fields: [{ id: 'a.constructor' }, { id: 'ok', type: 'nope' }, { id: 'poa' }], modifiers: [{ id: 'poa' }] });
  ok(nt.fields.length === 1 && nt.fields[0].type === 'text' && nt.fields[0].id === 'ok', 'bad field ids are dropped, fields cannot shadow modifiers', nt.fields);
  const tpl = normalizeTemplate(LEASE);
  ok(tpl.fields.length > 30 && tpl.main === 'ru' && tpl.langs.join() === 'ru,en' && tpl.levels[0].options.length === 3, 'the lease template normalizes');
  const round = parseImport(exportJSON(tpl));
  ok(round.template && JSON.stringify(round.template) === JSON.stringify(tpl), 'template JSON round-trip');
  const docJ = parseImport(exportJSON(tpl, newDocument(tpl)));
  ok(docJ.doc && docJ.doc.templateId === tpl.id && docJ.doc.values.rent === 65000, 'document bundle round-trip');
  ok(parseImport('{').error === 'json' && parseImport('{"format":"other"}').error === 'format', 'import errors');
  for (const raw of SAMPLES) {
    const t = normalizeTemplate(raw);
    const r = renderContract(t, newDocument(t), { lang: 'ru', today: '2027-01-20' });
    const r2 = renderContract(t, newDocument(t), { lang: 'en', today: '2027-01-20' });
    const unk = syncFields(t, { add: false });
    ok(!r.errors.length && !r2.errors.length && !unk.unknown.length && r.html.length > 500 && !r2.fallbacks.length, 'built-in template renders cleanly: ' + t.id, [r.errors.slice(0, 3), unk.unknown, r2.fallbacks]);
  }

  // --- rendering the lease -----------------------------------------------------------------------------------
  const doc = newDocument(tpl);
  const R = (patch = {}, o = {}) => renderContract(tpl, { ...doc, ...patch, modifiers: { ...doc.modifiers, ...(patch.modifiers || {}) }, levels: { ...doc.levels, ...(patch.levels || {}) }, values: { ...doc.values, ...(patch.values || {}) } }, { lang: 'ru', today: '2027-01-20', ...o });
  const base = R();
  const bt = textOf(base.html);
  ok(bt.includes('с «23» января 2027 г. по «22» декабря 2027 г. включительно') && bt.includes('не позднее «23» декабря 2027 г.'), 'term with the last day and the move-out date');
  ok(bt.includes('65 000 (шестьдесят пять тысяч) рублей в месяц') && bt.includes('11 платежей на общую сумму 715 000 (семьсот пятнадцать тысяч) рублей'), 'rent and the schedule summary in words');
  const sched = base.html.slice(base.html.indexOf('ct-sched'), base.html.indexOf('</table>', base.html.indexOf('ct-sched')));
  ok((sched.match(/<tr( class="ct-part")?><td class="ct-c">\d+<\/td>/g) || []).length === 11 && bt.includes('23.01.2027 – 22.02.2027') && bt.includes('23.11.2027 – 22.12.2027'), 'the payment schedule table');
  ok(bt.includes('нотариальной доверенности № 77 АГ 1234567') && bt.includes('от имени и в интересах которой действует Лебедев Олег Сергеевич'), 'power of attorney: the representative clause');
  const noPoa = textOf(R({ modifiers: { poa: false } }).html);
  ok(!noPoa.includes('доверенности') && !noPoa.includes('Лебедев') && noPoa.includes('/ Соколова А. В. /'), 'without the power of attorney the owner signs');
  ok(!bt.includes('ДОПОЛНИТЕЛЬНЫЕ УСЛУГИ') && bt.includes('Приложение № 2 — акт приёма-передачи'), 'services appendix off by default');
  const srv = R({ modifiers: { extraServices: true } });
  const st = textOf(srv.html);
  ok(st.includes('ДОПОЛНИТЕЛЬНЫЕ УСЛУГИ') && st.includes('Место на подземной парковке') && st.includes('14 400 (четырнадцать тысяч четыреста) рублей в месяц') && st.includes('Приложение № 3 — акт приёма-передачи') && st.includes('Приложение № 2 — дополнительные услуги'), 'additional services: clause, appendix and renumbering', st.slice(st.indexOf('Неотъемлемые'), st.indexOf('Неотъемлемые') + 200));
  ok(srv.used.has('services') && srv.used.has('servicesTotal') && !base.used.has('services'), 'used fields follow the modifiers');
  const strict = textOf(R({ levels: { strictness: 'strict' } }).html), soft = textOf(R({ levels: { strictness: 'soft' } }).html);
  ok(strict.includes('130 000 (сто тридцать тысяч) рублей') && strict.includes('неустойку 1 %') && strict.includes('в одностороннем порядке') && soft.includes('32 500 (тридцать две тысячи пятьсот) рублей') && soft.includes('неустойку 0,1 %') && soft.includes('считается продлённым'), 'strictness levels switch variants and computed values');
  ok(!textOf(R({ modifiers: { nuances: false } }).html).includes('Особые условия') && bt.includes('6. Особые условия') && bt.includes('кошка'), 'nuances section');
  ok(textOf(R({ values: { pets: false } }).html).includes('Содержание в Квартире домашних животных не допускается'), 'a nuance switches its text');
  ok(textOf(R({ values: { occupants: [] } }).html).includes('Иные лица постоянно проживать'), 'an empty list takes the else branch');
  const empty = renderContract(tpl, newDocument(tpl, { empty: true }), { lang: 'ru', today: '2027-01-20' });
  ok(/ct-empty[^>]*>Наниматель</.test(empty.html) && !empty.errors.length, 'empty fields render as labelled blanks', empty.errors);
  const en = textOf(R({}, { lang: 'en' }).html);
  ok(en.includes('65,000 (sixty-five thousand) roubles a month') && en.includes('from 23 January 2027 to 22 December 2027 inclusive') && en.includes('PAYMENT SCHEDULE'), 'English text');
  const bi = R({}, { second: 'en' });
  ok(bi.html.includes('class="ct-bi"') && textOf(bi.html).includes('Subject of the Agreement') && textOf(bi.html).includes('Предмет договора'), 'bilingual side by side');
  const de = addLanguage(tpl, 'de');
  const deR = renderContract(de, doc, { lang: 'de', today: '2027-01-20' });
  ok(deR.fallbacks.length > 20 && deR.html.includes('class="ct-fb"') && textOf(deR.html).includes('Предмет договора'), 'a missing translation falls back to the main language and is flagged');
  const hidden = R({ modifiers: { nuances: false } }, { showHidden: true });
  ok(hidden.html.includes('ct-sec ct-off') && hidden.html.includes('data-when="nuances"'), 'inactive sections can be shown dimmed for editing');
  const marked = R({}, { marks: { rent: 'error' } });
  ok(marked.html.includes('ct-bad-error" data-f="rent"'), 'issues mark placeholders');
  ok(base.outline.length >= 10 && base.outline.find((s) => s.id === 'payment').num === '3' && base.outline.find((s) => s.id === 'payment').clauses[0].num === '3.1', 'outline with numbers', base.outline.slice(0, 3));

  // --- fields extraction -------------------------------------------------------------------------------------
  const edited = { ...tpl, sections: tpl.sections.map((s) => (s.id === 'final' ? { ...s, clauses: [...s.clauses, { id: 'f9', text: { ru: 'Ключи передаются {{handoverDate}}, залог {{extraDeposit}}; телефон {{landlordPhone}}; [[if hasParking]]есть парковка[[end]]' } }] } : s)) };
  const sync = syncFields(edited);
  const types = Object.fromEntries(sync.template.fields.filter((f) => sync.added.includes(f.id)).map((f) => [f.id, f.type + (f.mask ? ':' + f.mask : '')]));
  ok(JSON.stringify(types) === JSON.stringify({ handoverDate: 'date', extraDeposit: 'money', landlordPhone: 'text:phone', hasParking: 'bool' }), 'placeholders in edited text become typed fields', types);
  ok(collectRefs(tpl).has('term.start') && syncFields(tpl).unused.length === 0, 'every lease field is read somewhere', syncFields(tpl).unused);

  // --- validation --------------------------------------------------------------------------------------------
  ok(checkMask('inn', '7707083893') === '' && checkMask('inn', '7707083894') === 'checksum' && checkMask('inn', '500100732259') === '' && checkMask('inn', '12345') === 'mask', 'INN check digits');
  ok(checkMask('passport-ru', '45 08 731942') === '' && checkMask('passport-ru', '4508731942') === '' && checkMask('passport-ru', '45 08') === 'mask', 'passport mask');
  ok(checkMask('snils', '112-233-445 95') === '' && checkMask('snils', '112-233-445 96') === 'checksum' && checkMask('ogrn', '1027700132195') === '' && checkMask('ogrn', '1027700132196') === 'checksum', 'SNILS and OGRN check digits');
  ok(checkMask('email', 'a@b.cd') === '' && checkMask('email', 'a@b') === 'mask' && checkMask('phone', '+7 999 123-45-67') === '' && checkMask('phone', '12') === 'mask', 'e-mail and phone');
  ok(validateDoc(tpl, doc, { used: base.used, today: '2027-01-20' }).length === 0, 'the sample lease has no issues', validateDoc(tpl, doc, { used: base.used, today: '2027-01-20' }));
  const badDoc = { ...doc, values: { ...doc.values, tenant: { ...doc.values.tenant, name: '', passport: '12' }, rent: '', landlord: { ...doc.values.landlord, passport: '12' } } };
  const iss = validateDoc(tpl, badDoc, { used: base.used, today: '2027-01-20' });
  ok(iss.some((x) => x.field === 'tenant' && x.code === 'required') && iss.some((x) => x.field === 'rent' && x.code === 'required') && iss.some((x) => x.field === 'landlord.passport' && x.code === 'mask'), 'built-in checks', iss);
  ok(validateDoc(tpl, badDoc, { used: new Set(['number']), today: '2027-01-20' }).length === 0, 'fields the text does not read are not checked');
  const env = createEnv(tpl, { ...doc, values: { ...doc.values, term: { start: '2027-01-23', months: 12 } } }, { lang: 'ru' });
  const user = cleanIssues(await userValidatorCore(tpl.validator, env.snapshot(), { lang: 'ru', modifiers: env.modifiers(), levels: env.levels() }));
  ok(user.length === 1 && user[0].field === 'term' && user[0].level === 'warning' && /ст. 674/.test(user[0].message), 'the lease JS validator', user);
  ok(cleanIssues(['plain message', { message: 'm', level: 'warn', field: 'x' }, 5, null]).length === 2 && cleanIssues('x')[0].level === 'error', 'validator results are normalized');
  let caught = false;
  try { userValidatorCore('return fields.a.b.c', {}, {}); } catch { caught = true; }
  ok(caught, 'validator errors surface (the worker reports them)');

  // --- languages ---------------------------------------------------------------------------------------------
  const st0 = translationStatus(tpl);
  ok(st0.ru.percent === 100 && st0.en.percent === 100, 'lease is fully translated', [st0.ru.percent, st0.en.percent, st0.en.missing.slice(0, 3)]);
  const st1 = translationStatus(addLanguage(tpl, 'de'));
  ok(st1.de.percent === 0 && st1.de.missing.length === st1.de.total, 'a new language starts untranslated');
  ok(translationStatus(addLanguage(tpl, 'de', { copy: true })).de.percent === 100, 'a new language can start from the main text');
  const m2 = setMainLanguage(tpl, 'en');
  ok(m2.main === 'en' && m2.langs[0] === 'en' && removeLanguage(m2, 'ru').langs.join() === 'en' && removeLanguage(normalizeTemplate({ langs: ['en'] }), 'en').langs.join() === 'en', 'main language and removal');

  // Compilation tests are the security tests of the one-file page: no network API use (same scanner idea as
  // policy.js), no external resource URLs, template data round-trips through the JSON island, and a template carrying
  // </script> and <img onerror> payloads cannot break out of either the JSON island or the prerendered HTML.
  // --- compilation -------------------------------------------------------------------------------------------
  const { assetBundle } = await import('../bundle.js');
  const { networkUses } = await import('../policy.js');
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const ab = assetBundle(path.join(root, 'contract', 'page.js'), root);
  const runtime = zlib.gunzipSync(Buffer.from(ab.bytes)).toString('utf8');
  const html = compileTemplate(tpl, { lang: 'ru', runtime, withSample: true, today: '2027-01-20' });
  ok(html.startsWith('<!doctype html>') && html.includes("connect-src 'none'") && html.includes('<script type="module">') && html.includes('Symbol.for("bundle:page.js")'), 'compiled page: CSP and runtime');
  ok(networkUses(html).length === 0, 'compiled page has no network uses', networkUses(html).slice(0, 3));
  ok(!/<link[^>]+href="(?!data:)/.test(html) && !/src="(?!data:)[^"]+"/.test(html), 'compiled page has no external resources');
  const data = JSON.parse(html.slice(html.indexOf('<script type="application/json" id="ctp-data">') + 46, html.indexOf('</script>', html.indexOf('id="ctp-data"'))));
  ok(data.template.id === tpl.id && data.values.rent === 65000 && JSON.stringify(data.template.sample.values) === '{}', 'compiled page data');
  ok(textOf(html).includes('ДОГОВОР НАЙМА ЖИЛОГО ПОМЕЩЕНИЯ') && html.includes('@page{size:210mm 297mm'), 'compiled page carries the prerendered contract and print CSS');
  const xss = normalizeTemplate({ ...tpl, name: { ru: '</script><script>alert(1)</script>' }, sections: [{ id: 's', clauses: [{ id: 'c', text: { ru: '<img src=x onerror=alert(1)> {{x}}' } }] }], fields: [{ id: 'x', type: 'text', default: '</script><b>' }] });
  const xh = compileTemplate(xss, { runtime: 'void 0', withSample: false });
  ok(!xh.includes('<img') && !xh.includes('</script><script>alert') && !xh.includes('</script><b>'), 'compiled page escapes template content');
  ok(compileStatic(tpl, doc, { lang: 'en', today: '2027-01-20' }).includes('RESIDENTIAL LEASE AGREEMENT'), 'static copy');

  console.log(`contract: ${passed} passed, ${failed} failed`);
  return failed;
}

// Run directly only when this file is the entry point (path compare of argv[1] with this module URL), so check.js
// can import run() without triggering a second run.
const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) run().then((f) => { process.exitCode = f ? 1 : 0; });
