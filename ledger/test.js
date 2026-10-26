// ledger/test.js - unit tests of the ledger library: `node ledger/test.js` (importing the module runs nothing).
// Minor units and rounding, largest remainder, parties and articles, the split cascade (the rest as the rounding lock,
// idempotent normalisation, the sign becoming the kind), the immutable journal with reversals, balances, statements,
// the calculation web (flows, guarantees, debts, cycles, star = cascade, fingerprint, binding), period KPIs (nights
// clipped to the period, occupancy, ADR / RevPAR), payout plans, expense splitting, cross rates and CSV.
//
// The central invariant tested throughout: money is conserved to the unit. Every split, allocation and web
// evaluation is checked to sum back to its input (or to report the difference explicitly as unallocated / stuck /
// debt) - a rounding bug in money code shows up as a one-tetri drift long before it shows up as a wrong total.
// Comparison is by JSON.stringify, so key order and number formatting are part of the expected output.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MONEY_MAX, allocate, decimalText, fromMinor, moneyText, mulDiv, roundNumber, toMinor, cleanCurrency } from './minor.js';
import {
  LEDGER_ARTICLES, LEDGER_ARTICLE_I18N, LEDGER_KINDS, PARTY_ROLES, articleLabel, articleNames, cleanArticle, cleanArticleName,
  cleanId, isLedgerKind, isPartyRole, kindLabel, normalizeParty, partyName, partyRole, roleLabel,
} from './parties.js';
import { PCT_FULL, PCT_SCALE, SPLIT_METHODS, allocationOp, distribute, fromPct, isSplitMethod, normalizeSplit, normalizeSplitRule, toPct } from './split.js';
import { appendOps, byArticle, currenciesOf, dueByCurrency, ledgerBalance, normalizeOp, ownerReport, reverseOp, reversedIds, statement } from './journal.js';
import { addDays, clipNights, inPeriod, isIsoDay, monthEnd, monthsOf, periodDays, periodOf, stayNights } from './period.js';
import { nightShare, occupancyText, ownerKey, payoutOps, payoutPlan, periodKpis, splitExpense } from './kpi.js';
import { WEB_LIMITS, bindWeb, evalWeb, normalizeWeb, resolveWeb, starFromSplit, starterWeb, validateWeb, webErrors, webHash, webJournal, webOps, webOrder } from './web.js';
import { edgeRuleText, webGraph } from './webview.js';
import { convert, convertMinor, crossRate, normalizeRates, rebase, sumIn, toPairs } from './rates.js';
import { csvText, journalCsv, kpiCsv, statementCsv } from './export.js';
import { convert as pairConvert } from '../payments/money.js';
import { parseCSV } from '../csv/csv.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const ok = (name, cond) => eq(name, !!cond, true);
  let seed = 11;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >>> 8) % n; };

  // --- minor units ------------------------------------------------------------------------------------------------
  eq('toMinor number', toMinor(1234.56), 123456);
  eq('toMinor comma', toMinor('1234,56'), 123456);
  eq('toMinor spaces', [toMinor(' 12 '), toMinor('1 234.50'), toMinor('1.234,50')], [1200, 123450, 123450]);
  eq('toMinor junk is 0', [toMinor(''), toMinor(null), toMinor('abc'), toMinor(NaN)], [0, 0, 0, 0]);
  eq('toMinor sign kept', toMinor(-50.5), -5050);
  eq('toMinor rounds half up', [toMinor(0.005), toMinor(0.004), toMinor(10.999), toMinor(1.005)], [1, 0, 1100, 101]);
  eq('toMinor exponent', [toMinor(1234.5, 'JPY'), toMinor(1.2345, 'KWD')], [1235, 1235]);
  eq('toMinor ceiling', [toMinor(1e15), toMinor(-1e15)], [MONEY_MAX, -MONEY_MAX]);
  ok('ceiling below 2^53', MONEY_MAX < Number.MAX_SAFE_INTEGER);
  eq('fromMinor inverse', [0.1, 0.2, 0.3, 1234.56, 99999.99, 0.07].map((v) => fromMinor(toMinor(v))), [0.1, 0.2, 0.3, 1234.56, 99999.99, 0.07]);
  eq('moneyText ru', moneyText(123456, 'GEL', 'ru'), '1 234,56 GEL');
  eq('moneyText en', moneyText(100, 'USD', 'en'), '1.00 USD');
  eq('moneyText no currency', moneyText(0, '', 'ru'), '0,00');
  eq('moneyText JPY', moneyText(1500, 'JPY', 'en'), '1,500 JPY');
  eq('decimalText', [decimalText(123456, 'GEL'), decimalText(-5, 'GEL'), decimalText(7, 'JPY'), decimalText(1, 'KWD')], ['1234.56', '-0.05', '7', '0.001']);
  eq('cleanCurrency', [cleanCurrency('gel'), cleanCurrency(' usd '), cleanCurrency('$$$'), cleanCurrency(null)], ['GEL', 'USD', '', '']);
  eq('mulDiv modes', ['half-up', 'half-even', 'floor', 'ceil', 'trunc'].map((m) => [mulDiv(5, 1, 2, m), mulDiv(-5, 1, 2, m), mulDiv(7, 1, 2, m)]),
    [[3, -3, 4], [2, -2, 4], [2, -3, 3], [3, -2, 4], [2, -2, 3]]);
  eq('mulDiv exact beyond 2^53', mulDiv(999999999999, 9999, 10000), 999899999999);
  eq('roundNumber noise', [roundNumber(0.49999999999), roundNumber(2.5, 'half-even'), roundNumber(-2.5), roundNumber(-2.1, 'floor')], [1, 2, -3, -3]);
  eq('allocate thirds', allocate(10000, [1, 1, 1]), [3334, 3333, 3333]);
  eq('allocate weights', allocate(100, [40, 60]), [40, 60]);
  eq('allocate zero weights equal', allocate(5, [0, 0]), [3, 2]);
  eq('allocate negative', allocate(-100, [1, 2]), [-33, -67]);
  eq('allocate empty', allocate(100, []), []);
  for (let k = 0; k < 200; k++) {
    const total = rnd(1000000) - 1000;
    const w = Array.from({ length: 1 + rnd(7) }, () => (rnd(4) ? rnd(1000) / 7 : 0));
    const parts = allocate(total, w);
    if (parts.reduce((a, b) => a + b, 0) !== total) eq('allocate sums ' + k, parts, total);
  }
  pass++;

  // --- parties and articles ---------------------------------------------------------------------------------------
  eq('roles closed', PARTY_ROLES, ['owner', 'agency', 'platform', 'contractor']);
  eq('role check', [isPartyRole('owner'), isPartyRole('landlord'), partyRole('whatever')], [true, false, 'contractor']);
  const face = normalizeParty({ role: 'agency', ref: 'f1', name: 'dropped' });
  eq('party with ref keeps no name copy', [face.ref, face.name], ['f1', '']);
  const ext = normalizeParty({ role: 'contractor', name: 'Gocha the cleaner', note: '+995…' });
  eq('outside party', [ext.ref, ext.name, ext.note], ['', 'Gocha the cleaner', '+995…']);
  eq('party needs ref or name', [normalizeParty({ role: 'owner' }), normalizeParty({ role: 'owner', name: '  ' }), normalizeParty(null)], [null, null, null]);
  eq('party name', [partyName({ role: 'agency', ref: 'f1' }, 'Orbi Group'), partyName({ role: 'agency', ref: 'f1' }, ''), partyName({ role: 'contractor', name: 'Gocha' })],
    ['Orbi Group', 'Manager', 'Gocha']);
  eq('role labels', [roleLabel('owner', 'ru'), roleLabel('owner', 'ka'), roleLabel('junk', 'zz')], ['Собственник', 'მესაკუთრე', 'Contractor']);
  eq('cleanId', [cleanId(3), cleanId('7'), cleanId('p-1'), cleanId(0), cleanId(-1), cleanId(''), cleanId(1.5)], [3, 7, 'p-1', null, null, null, null]);
  ok('articles latin with three languages', LEDGER_ARTICLES.every((a) => /^[a-z]+$/.test(a) && ['en', 'ru', 'ka'].every((l) => LEDGER_ARTICLE_I18N[a][l])));
  eq('cleanArticle', [cleanArticle('Cleaning'), cleanArticle('  utilities '), cleanArticle('waste removal'), cleanArticle('Уборка'), cleanArticle(null), cleanArticle('x'.repeat(200)).length],
    ['cleaning', 'utilities', 'waste removal', 'Уборка', '', 60]);
  const names = { cleaning: { ru: 'Клининг' } };
  eq('articleLabel own language first', articleLabel('cleaning', names, 'ru'), 'Клининг');
  eq('articleLabel dictionary of the reader beats an own name in another language', articleLabel('cleaning', names, 'en'), 'Cleaning');
  eq('articleLabel ka', articleLabel('cleaning', names, 'ka'), LEDGER_ARTICLE_I18N.cleaning.ka);
  eq('articleLabel free article stays', [articleLabel('вывоз мусора', undefined, 'en'), articleLabel('вывоз мусора', { 'вывоз мусора': { en: 'Waste removal' } }, 'en'), articleLabel('', undefined)],
    ['вывоз мусора', 'Waste removal', '']);
  eq('articleLabel unknown language -> en', [articleLabel('tax', undefined, 'de'), articleLabel('tax', { tax: { ru: 'Налог 5%' } }, 'de'), articleLabel('tax', { tax: { en: 'Tax 5%' } }, 'de')], ['Tax', 'Tax', 'Tax 5%']);
  eq('cleanArticleName', [cleanArticleName({ ru: 'Клининг', en: '', ka: '  ' }), cleanArticleName('Housekeeping'), cleanArticleName(null), cleanArticleName({ fr: 'Ménage' })],
    [{ ru: 'Клининг' }, { en: 'Housekeeping' }, {}, {}]);
  eq('kinds', [LEDGER_KINDS, isLedgerKind('payout'), isLedgerKind('refund'), kindLabel('deduction', 'ru'), kindLabel('payout')], [['accrual', 'deduction', 'payout'], true, false, 'Удержано', 'Paid out']);

  // --- split cascade ----------------------------------------------------------------------------------------------
  eq('pct integers', [PCT_SCALE, toPct(12.5), toPct('70'), toPct(200), toPct(-5), fromPct(1250)], [100, 1250, 7000, 10000, 0, 12.5]);
  eq('methods', [SPLIT_METHODS, isSplitMethod('rest'), isSplitMethod('formula')], [['pct', 'fixed', 'rest'], true, false]);
  eq('rule needs a party', normalizeSplitRule({ method: 'pct', value: 70 }), null);
  eq('rule from form', normalizeSplitRule({ partyId: 2, article: 'rent', method: 'pct', pct: 70 }), { partyId: 2, article: 'rent', method: 'pct', value: 7000 });
  eq('fixed by absolute value', normalizeSplitRule({ partyId: 3, method: 'fixed', amount: -40 }).value, 4000);
  const once = normalizeSplit([
    { partyId: 1, article: 'commission', method: 'pct', pct: 20 },
    { partyId: 2, article: 'cleaning', method: 'fixed', amount: 35 },
    { partyId: 3, article: 'rent', method: 'rest' },
  ]);
  eq('normalisation idempotent', [normalizeSplit(once), normalizeSplit(normalizeSplit(once))], [once, once]);
  eq('canonical values', [once[0].value, once[1].value], [2000, 3500]);
  eq('value vs pct by name', [normalizeSplitRule({ partyId: 1, method: 'pct', pct: 20 }).value, normalizeSplitRule({ partyId: 1, method: 'pct', value: 20 }).value, normalizeSplitRule({ partyId: 1, method: 'pct', value: 999999 }).value],
    [2000, 20, PCT_FULL]);
  const withName = normalizeSplitRule({ partyId: 3, article: 'Cleaning', name: { ru: 'Клининг', en: '' }, method: 'pct', pct: 20 });
  eq('idempotent with a name', [normalizeSplitRule(withName), withName.article, withName.name], [withName, 'cleaning', { ru: 'Клининг' }]);
  ok('empty name not kept', !('name' in normalizeSplitRule({ partyId: 3, article: 'x', method: 'rest', name: { ru: '' } })));
  const rests = normalizeSplit([{ partyId: 1, method: 'rest' }, { partyId: 2, method: 'pct', value: 20 }, { partyId: 3, method: 'rest' }]);
  eq('one rest, last; extra becomes pct 0', [rests.length, rests[2].method, rests.filter((r) => r.method === 'rest').length, rests.find((r) => r.partyId === 3).method, rests.find((r) => r.partyId === 3).value],
    [3, 'rest', 1, 'pct', 0]);
  eq('articleNames merges languages', articleNames(normalizeSplit([
    { partyId: 1, article: 'cleaning', name: { ru: 'Клининг' }, method: 'pct', pct: 10 },
    { partyId: 2, article: 'cleaning', name: { en: 'Housekeeping' }, method: 'pct', pct: 10 },
    { partyId: 3, article: 'rent', method: 'rest' },
  ])), { cleaning: { ru: 'Клининг', en: 'Housekeeping' } });
  const rules702010 = [
    { partyId: 2, article: 'commission', method: 'pct', value: toPct(20) },
    { partyId: 3, article: 'cleaning', method: 'pct', value: toPct(10) },
    { partyId: 1, article: 'rent', method: 'rest', value: 0 },
  ];
  const base = toMinor(1234.57);
  const d1 = distribute(base, rules702010);
  eq('70/20/10 to the unit', [d1.rows.reduce((s, r) => s + r.amount, 0), d1.unallocated, d1.allocated], [base, 0, base]);
  eq('shares', d1.rows.map((r) => r.amount), [24691, 12346, base - 24691 - 12346]);
  const thirds = [{ partyId: 2, method: 'pct', value: toPct(33.33) }, { partyId: 3, method: 'pct', value: toPct(33.33) }, { partyId: 1, method: 'rest', value: 0 }];
  let lost = 0;
  for (let cents = 1; cents <= 100; cents++) if (distribute(cents, thirds).rows.reduce((s, r) => s + r.amount, 0) !== cents) lost++;
  eq('rest takes the rounding unit on 100 bases', lost, 0);
  const d2 = distribute(toMinor(1000), [{ partyId: 1, method: 'pct', value: toPct(70) }, { partyId: 2, method: 'pct', value: toPct(20) }]);
  eq('pct of the base, not of what is left', [d2.rows[0].amount, d2.rows[1].amount, d2.unallocated], [70000, 20000, 10000]);
  const d3 = distribute(toMinor(50), [{ partyId: 3, article: 'cleaning', method: 'fixed', value: toMinor(80) }, { partyId: 1, article: 'rent', method: 'rest', value: 0 }]);
  eq('fixed above base: negative rest', [d3.rows[1].amount, d3.rows.reduce((s, r) => s + r.amount, 0)], [-3000, 5000]);
  eq('negative rest becomes a deduction', d3.rows.map(allocationOp).map((o) => [o.kind, o.amount]), [['accrual', 8000], ['deduction', 3000]]);
  eq('allocationOp', allocationOp({ partyId: 1, article: 'rent', amount: 7000 }), { partyId: 1, article: 'rent', kind: 'accrual', amount: 7000 });
  eq('empty cascade gives nothing away', distribute(50000, []), { rows: [], allocated: 0, unallocated: 50000 });
  const three = [1, 2, 3].map((p) => ({ partyId: p, method: 'pct', value: toPct(33.3333) }));
  eq('exact pct without rest', [distribute(100, three).rows.map((r) => r.amount), distribute(100, three, { exact: true }).rows.map((r) => r.amount)], [[33, 33, 33], [34, 33, 33]]);
  eq('rounding mode', distribute(5, [{ partyId: 1, method: 'pct', value: 5000 }], { rounding: 'half-even' }).rows[0].amount, 2);

  // --- journal ----------------------------------------------------------------------------------------------------
  const op = (o) => ({ day: '2026-09-01', kind: 'accrual', partyId: 1, article: '', amount: 0, currency: 'GEL', ref: '', reverses: 0, note: '', ...o });
  const bal = ledgerBalance([op({ id: 1, amount: 100000 }), op({ id: 2, kind: 'deduction', amount: 15000, article: 'cleaning' }), op({ id: 3, kind: 'payout', amount: 60000 })]).get(1);
  eq('balance', [bal.accrued, bal.deducted, bal.paid, bal.due], [100000, 15000, 60000, 25000]);
  const rev = [op({ id: 1, amount: 100000 }), op({ id: 2, amount: 99900, note: 'mistake' }), op({ id: 3, amount: 99900, reverses: 2 })];
  eq('reversal voids the pair', [[...reversedIds(rev)].sort(), ledgerBalance(rev).get(1).accrued], [['2', '3'], 100000]);
  const two = ledgerBalance([op({ id: 1, partyId: 1, amount: 70000 }), op({ id: 2, partyId: 2, amount: 20000 }), op({ id: 3, partyId: 2, kind: 'payout', amount: 20000 })]);
  eq('balances per party', [two.get(1).due, two.get(2).due], [70000, 0]);
  eq('balance by currency', ledgerBalance([op({ id: 1, amount: 100 }), op({ id: 2, amount: 500, currency: 'USD' })], { currency: 'usd' }).get(1).accrued, 500);
  eq('normalizeOp rejects', [normalizeOp(op({ amount: -5 })), normalizeOp(op({ amount: 0 })), normalizeOp(op({ amount: 5, day: '2026-02-30' })), normalizeOp(op({ amount: 5, kind: 'refund' })), normalizeOp(op({ amount: 5, currency: '' }))],
    [null, null, null, null, null]);
  let j = appendOps([], [op({ amount: 10000, ref: 7 }), op({ amount: 2000, kind: 'deduction', article: 'Cleaning' })]);
  eq('append assigns ids', [j.ok, j.journal.map((o) => o.id), j.journal[1].article], [true, [1, 2], 'cleaning']);
  const before = j.journal;
  const bad = appendOps(before, [op({ amount: 1 }), op({ amount: -1 })]);
  eq('one bad op rejects the batch', [bad.ok, bad.index, bad.journal === before], [false, 1, true]);
  const r1 = reverseOp(before, 1, { day: '2026-09-05', note: 'rate fixed' });
  eq('reverseOp', [r1.ok, r1.op.id, r1.op.reverses, r1.op.amount, r1.op.day, before.length, r1.journal.length], [true, 3, 1, 10000, '2026-09-05', 2, 3]);
  eq('reverse twice / a reversal / missing', [reverseOp(r1.journal, 1).error, reverseOp(r1.journal, 3).error, reverseOp(r1.journal, 99).error], ['already_reversed', 'is_reversal', 'not_found']);
  eq('use reverseOp for reversals', appendOps([], [op({ amount: 1, reverses: 1 })]).error, 'use_reverse');

  const ops1 = [
    op({ id: 1, day: '2026-08-31', amount: 1000 }),
    op({ id: 2, day: '2026-09-01', amount: 10000, ref: 7 }),
    op({ id: 3, day: '2026-09-30', amount: 20000, ref: 8 }),
    op({ id: 4, day: '2026-10-01', amount: 30000 }),
    op({ id: 5, day: '2026-09-15', partyId: 2, amount: 99900 }),
  ];
  const st1 = statement(ops1, 1, { from: '2026-09-01', to: '2026-09-30', currency: 'GEL' });
  eq('statement period inclusive', [st1.rows.length, st1.accrued, st1.due, st1.refs, st1.opening, st1.closing], [2, 30000, 30000, 2, 1000, 31000]);
  eq('running balance', st1.rows.map((r) => r.balance), [11000, 31000]);
  const rules = [
    { partyId: 2, article: 'commission', method: 'pct', value: toPct(20) },
    { partyId: 3, article: 'cleaning', method: 'fixed', value: toMinor(35) },
    { partyId: 1, article: 'rent', method: 'rest', value: 0 },
  ];
  let month = [], gross = 0;
  for (let n = 1; n <= 12; n++) {
    const b = toMinor(137.77 * n);
    gross += b;
    month = appendOps(month, distribute(b, rules).rows.map((a) => ({ ...allocationOp(a), day: `2026-09-${String(n).padStart(2, '0')}`, currency: 'GEL', ref: n }))).journal;
  }
  const period = { from: '2026-09-01', to: '2026-09-30', currency: 'GEL' };
  const [o1, o2, o3] = [1, 2, 3].map((p) => ownerReport(month, p, period));
  eq('three statements sum to the income', o1.accrued + o2.accrued + o3.accrued, gross);
  eq('refs', o1.refs, 12);
  month = appendOps(month, [{ kind: 'payout', day: '2026-09-30', partyId: 1, amount: o1.due, currency: 'GEL' }]).journal;
  eq('payout closes the debt', ownerReport(month, 1, period).due, 0);
  const b0 = [op({ id: 1, amount: 10000, ref: 5 })];
  const after = [...b0, op({ id: 2, amount: 10000, reverses: 1, note: 'rate fixed' }), op({ id: 3, amount: 12000, ref: 5 })];
  const ra = ownerReport(after, 1, { currency: 'GEL' });
  eq('back-dated fix adds ops', [ownerReport(b0, 1, { currency: 'GEL' }).due, ra.due, ra.rows.length, ra.rows.map((x) => x.voided), b0[0].amount], [10000, 12000, 3, [true, true, false], 10000]);
  const mixed = ownerReport([op({ id: 1, amount: 10000 }), op({ id: 2, amount: 50000, currency: 'USD' })], 1, { currency: 'GEL' });
  eq('other currency counted, not summed', [mixed.accrued, mixed.otherCurrency, mixed.rows.length], [10000, 1, 1]);
  const arts = ownerReport([
    op({ id: 1, kind: 'deduction', article: 'cleaning', amount: 3000 }),
    op({ id: 2, kind: 'deduction', article: 'cleaning', amount: 2000 }),
    op({ id: 3, kind: 'deduction', article: 'utilities', amount: 4500 }),
    op({ id: 4, kind: 'deduction', article: 'mistake', amount: 99900 }),
    op({ id: 5, kind: 'deduction', article: 'mistake', amount: 99900, reverses: 4 }),
  ], 1, { currency: 'GEL' });
  eq('by article, voided out', arts.articles.map((x) => [x.article, x.amount]), [['cleaning', 5000], ['utilities', 4500]]);
  eq('by article independent of language', [byArticle(arts.rows).length, articleLabel(arts.articles[0].article, undefined, 'ru')], [2, 'Уборка']);
  eq('due by currency', dueByCurrency([op({ id: 1, amount: 500 }), op({ id: 2, amount: 300, currency: 'USD' }), op({ id: 3, kind: 'payout', amount: 200 })], 1), { GEL: 300, USD: 300 });
  eq('currencies', currenciesOf([op({ id: 1, currency: 'usd' }), op({ id: 2 }), op({ id: 3, currency: 'GEL' })]), ['GEL', 'USD']);

  // --- periods and KPIs -------------------------------------------------------------------------------------------
  eq('iso day', [isIsoDay('2026-02-28'), isIsoDay('2026-02-29'), isIsoDay('2028-02-29'), isIsoDay('2026-9-1')], [true, false, true, false]);
  eq('month end', [monthEnd('2026-02'), monthEnd('2028-02'), monthEnd('2026-12')], ['2026-02-28', '2028-02-29', '2026-12-31']);
  eq('periodOf', [periodOf({ month: '2026-09' }), periodOf({ from: '2026-09-30', to: '2026-09-01' }), periodOf({ from: 'x' })],
    [{ from: '2026-09-01', to: '2026-09-30' }, { from: '2026-09-01', to: '2026-09-30' }, { from: '', to: '' }]);
  const sep = periodOf({ month: '2026-09' });
  eq('period days / in', [periodDays(sep), periodDays({ from: '', to: '' }), inPeriod('2026-09-30', sep), inPeriod('2026-10-01', sep)], [30, 0, true, false]);
  eq('nights clipped', [clipNights('2026-09-29', '2026-10-03', sep), clipNights('2026-08-30', '2026-09-02', sep), clipNights('2026-10-01', '2026-10-03', sep), stayNights('2026-09-29', '2026-10-03')], [2, 1, 0, 4]);
  eq('addDays / months', [addDays('2026-12-31', 1), monthsOf({ from: '2026-11-15', to: '2027-02-01' })], ['2027-01-01', ['2026-11', '2026-12', '2027-01', '2027-02']]);
  eq('nightShare', [nightShare(1000, 3, 0, 1), nightShare(1000, 3, 1, 3), nightShare(1000, 3, 0, 3)], [334, 666, 1000]);
  const stays = [
    { id: 1, from: '2026-09-29', to: '2026-10-03', status: 'confirmed', currency: 'GEL', total: 40000, surplus: 5000 },
    { id: 2, from: '2026-09-10', to: '2026-09-15', status: 'confirmed', currency: 'GEL', total: 50000 },
    { id: 3, from: '2026-09-20', to: '2026-09-22', status: 'pending', currency: 'GEL', total: 99999 },
    { id: 4, from: '2026-09-05', to: '2026-09-07', status: 'cancelled', currency: 'GEL', total: 99999 },
    { id: 5, from: '2026-08-30', to: '2026-09-02', currency: 'USD', total: 30000 },
  ];
  const kops = [
    op({ id: 1, day: '2026-09-10', partyId: 1, amount: 35000 }),
    op({ id: 2, day: '2026-09-10', partyId: 2, amount: 15000 }),
    op({ id: 3, day: '2026-09-12', partyId: 1, kind: 'deduction', amount: 4500, article: 'utilities' }),
    op({ id: 4, day: '2026-09-12', partyId: 3, kind: 'deduction', amount: 1000 }),
    op({ id: 5, day: '2026-09-28', partyId: 1, kind: 'payout', amount: 20000 }),
    op({ id: 6, day: '2026-09-28', partyId: 1, amount: 77700 }),
    op({ id: 7, day: '2026-09-28', partyId: 1, amount: 77700, reverses: 6 }),
  ];
  const k = periodKpis(stays, kops, { period: sep, owners: [1], agency: new Set([2]) });
  const gel = k.currencies.find((c) => c.currency === 'GEL'), usd = k.currencies.find((c) => c.currency === 'USD');
  eq('kpi counts', [k.days, k.available, k.bookings, k.nights, k.pending, k.occupancy], [30, 30, 2, 8, 1, 267]);
  eq('kpi GEL', [gel.gross, gel.surplus, gel.nights, gel.nightRevenue, gel.adr, gel.revpar], [90000, 5000, 7, 70000, 10000, 2333]);
  eq('kpi owner', [gel.ownerAccrued, gel.ownerDeducted, gel.ownerPaid, gel.ownerNet, gel.agency, gel.expenses], [35000, 4500, 20000, 10500, 15000, 5500]);
  eq('kpi USD by nights only', [usd.gross, usd.nights, usd.nightRevenue], [0, 1, 10000]);
  eq('kpi units and open period', [periodKpis(stays, [], { period: sep, units: 3 }).occupancy, periodKpis(stays, [], { period: { from: '', to: '' } }).occupancy], [89, -1]);
  eq('occupancy text', [occupancyText(633), occupancyText(633, 'ru'), occupancyText(-1)], ['63.3 %', '63,3 %', '—']);
  eq('payout plan', payoutPlan({ usd: 500, GEL: 1200, EUR: -300, XXX: 0 }), [{ currency: 'GEL', amount: 1200 }, { currency: 'USD', amount: 500 }]);
  eq('payout plan only', payoutPlan(new Map([['GEL', 5], ['USD', 6]]), 'usd'), [{ currency: 'USD', amount: 6 }]);
  const pj = appendOps(month, payoutOps(payoutPlan(dueByCurrency(month, 3)), { partyId: 3, day: '2026-10-01' }));
  eq('payout ops close the due', [pj.ok, dueByCurrency(pj.journal, 3)], [true, { GEL: 0 }]);
  eq('payout ops need party and day', payoutOps([{ currency: 'GEL', amount: 1 }], { partyId: 0, day: '2026-10-01' }), []);
  eq('expense by area', splitExpense(10000, [{ id: 'a', area: 40 }, { id: 'b', area: 60 }]), [{ id: 'a', amount: 4000 }, { id: 'b', amount: 6000 }]);
  eq('expense equally', splitExpense(10000, [{ id: 1 }, { id: 2 }, { id: 3 }], { by: 'equal' }).map((x) => x.amount), [3334, 3333, 3333]);
  eq('expense by share', splitExpense(100, [{ id: 1, share: 1 }, { id: 2, share: 0 }, { id: 3, share: 3 }], { by: 'share' }).map((x) => x.amount), [25, 0, 75]);
  eq('owner key', [ownerKey({ ref: 's1', name: 'x' }), ownerKey({ name: '  Nino  Tsereteli ' }), ownerKey({ name: 'x', erased: true }), ownerKey(null)], ['r:s1', 'n:nino tsereteli', '', '']);

  // --- calculation web --------------------------------------------------------------------------------------------
  const P = (id, partyId, extra = {}) => ({ id, kind: 'party', partyId, x: 0, y: 0, ...extra });
  const SRC = { id: 'src', kind: 'source', source: 'booking', x: 0, y: 0 };
  const E = (id, from, to, method, extra = {}) => ({ id, from, to, method, article: 'rent', ...extra });
  const sumLeft = (w, ev) => w.nodes.filter((n) => n.kind === 'party').reduce((s, n) => s + (ev.left[n.id] || 0), 0);
  const w0 = normalizeWeb({ nodes: [SRC, P('a', 1)], edges: [E('e1', 'src', 'a', 'pct', { pct: 20 })] });
  eq('web idempotent', [w0.edges[0].value, normalizeWeb(JSON.parse(JSON.stringify(w0))).edges[0].value], [2000, 2000]);
  eq('one source per kind', normalizeWeb({ nodes: [SRC, { ...SRC, id: 'src2' }, P('a', 1)], edges: [] }).nodes.filter((n) => n.kind === 'source').length, 1);
  eq('bad edges dropped', normalizeWeb({ nodes: [SRC, P('a', 1)], edges: [E('e1', 'a', 'src', 'pct', { pct: 10 }), E('e2', 'src', 'nope', 'rest'), E('e3', 'a', 'a', 'rest'), E('e4', 'src', 'a', 'rest')] }).edges.map((e) => e.id), ['e4']);
  eq('second rest -> pct 0', normalizeWeb({ nodes: [SRC, P('a', 1), P('b', 2)], edges: [E('e1', 'src', 'a', 'rest'), E('e2', 'src', 'b', 'rest')] }).edges.map((e) => [e.method, e.value]), [['rest', 0], ['pct', 0]]);
  eq('node limit', normalizeWeb({ nodes: [SRC, ...Array.from({ length: 100 }, (_, i) => P('p' + i, i + 1))], edges: [] }).nodes.length, WEB_LIMITS.nodes);
  eq('duplicate node ids renamed', normalizeWeb({ nodes: [P('a', 1), P('a', 2)], edges: [] }).nodes.map((n) => n.id), ['a', 'a_2']);
  const w1 = normalizeWeb({ nodes: [SRC, P('own', 1), P('agn', 2), P('cln', 3)], edges: [E('e1', 'src', 'own', 'pct', { pct: 70 }), E('e2', 'src', 'agn', 'pct', { pct: 20 }), E('e3', 'src', 'cln', 'rest')] });
  const ev1 = evalWeb(w1, { booking: base });
  eq('web 70/20/rest to the unit', [ev1.ok, sumLeft(w1, ev1), ev1.stuck.length], [true, base, 0]);
  const w2 = normalizeWeb({
    nodes: [SRC, P('own', 1), P('agn', 2), P('mgr', 3), P('tax', 4)],
    edges: [E('e1', 'src', 'own', 'pct', { pct: 70 }), E('e2', 'src', 'agn', 'rest', { article: 'commission' }), E('e3', 'agn', 'mgr', 'pct', { pct: 50, article: 'commission' }), E('e4', 'agn', 'tax', 'pct', { pct: 10, article: 'tax' })],
  });
  const ev2 = evalWeb(w2, { booking: 100000 });
  eq('nested star', [ev2.left.own, ev2.into.agn, ev2.left.mgr, ev2.left.tax, ev2.left.agn, sumLeft(w2, ev2)], [70000, 30000, 15000, 3000, 12000, 100000]);
  const w3 = normalizeWeb({ nodes: [SRC, P('cln', 1), P('agn', 2), P('own', 3)], edges: [E('e1', 'src', 'cln', 'fixed', { amount: 100 }), E('e2', 'src', 'agn', 'pct', { pct: 20 }), E('e3', 'src', 'own', 'rest')] });
  const ev3 = evalWeb(w3, { booking: 100000 });
  eq('pct of inflow after fixed', [ev3.left.cln, ev3.left.agn, ev3.left.own], [10000, 20000, 70000]);
  const w4 = normalizeWeb({ nodes: [SRC, P('a', 1), P('b', 2), P('c', 3)], edges: [E('e1', 'src', 'a', 'fixed', { amount: 10, unit: 'night' }), E('e2', 'src', 'b', 'fixed', { amount: 300, unit: 'month' }), E('e3', 'src', 'c', 'rest')] });
  const ev4 = evalWeb(w4, { booking: 100000 }, { nights: 6 });
  eq('per night / per month', [ev4.left.a, ev4.left.b], [6000, 6000]);
  const w5 = normalizeWeb({ nodes: [SRC, P('own', 1)], edges: [E('e1', 'src', 'own', 'fixed', { amount: 500 })] });
  const ev5 = evalWeb(w5, { booking: 30000 });
  eq('shortfall is a debt', [ev5.flows[0].amount, ev5.flows[0].requested, ev5.flows[0].debt, sumLeft(w5, ev5)], [30000, 50000, 20000, 30000]);
  const w6 = normalizeWeb({ nodes: [SRC, P('agn', 1), P('own', 2)], edges: [E('e1', 'src', 'agn', 'rest'), E('e2', 'agn', 'own', 'fixed', { amount: 50, unit: 'night', guaranteed: true })] });
  const ev6 = evalWeb(w6, { booking: 20000 }, { nights: 5 });
  eq('guarantee: payer goes negative', [ev6.left.own, ev6.left.agn, ev6.flows.find((x) => x.edge === 'e2').debt], [25000, -5000, 0]);
  const w7 = normalizeWeb({ nodes: [SRC, P('own', 1)], edges: [E('e1', 'src', 'own', 'fixed', { amount: 500, guaranteed: true })] });
  eq('no guarantee from a source', [evalWeb(w7, { booking: 30000 }).left.own, validateWeb(w7).some((x) => x.code === 'guarantee_needs_party')], [30000, true]);
  const w8 = normalizeWeb({ nodes: [SRC, { id: 'pool', kind: 'pool', x: 0, y: 0 }, P('a', 1)], edges: [E('e1', 'src', 'pool', 'rest'), E('e2', 'pool', 'a', 'pct', { pct: 60 })] });
  eq('stuck in a pool', [evalWeb(w8, { booking: 10000 }).stuck, validateWeb(w8).some((x) => x.code === 'may_stick' && x.node === 'pool')], [[{ node: 'pool', amount: 4000 }], true]);
  const w9 = normalizeWeb({ nodes: [SRC, P('a', 1), P('b', 2)], edges: [E('e1', 'src', 'a', 'rest'), E('e2', 'a', 'b', 'pct', { pct: 50 }), E('e3', 'b', 'a', 'pct', { pct: 50 })] });
  eq('cycle', [webOrder(w9), evalWeb(w9, { booking: 100 }).ok, evalWeb(w9, { booking: 100 }).error, webErrors(validateWeb(w9)).some((x) => x.code === 'cycle')], [null, false, 'cycle', true]);
  const bound = bindWeb(starterWeb(), [{ id: 7, role: 'owner' }, { id: 8, role: 'agency' }]).web;
  const evs = evalWeb(bound, { booking: 100000, surplus: 15000 });
  const sops = webOps(bound, evs);
  eq('surplus own source and article', [sops.filter((o) => o.partyId === 7).map((o) => [o.article, o.amount]), sops.filter((o) => o.partyId === 8).map((o) => [o.article, o.amount]).sort()],
    [[['rent', 70000]], [['commission', 30000], ['surplus', 15000]]]);
  const w10 = normalizeWeb({ nodes: [SRC, P('agn', 1), P('mgr', 2)], edges: [E('e1', 'src', 'agn', 'rest', { article: 'commission' }), E('e2', 'agn', 'mgr', 'pct', { pct: 40, article: 'commission' })] });
  const agnOps = webOps(w10, evalWeb(w10, { booking: 10000 })).filter((o) => o.partyId === 1);
  eq('one line per party x article', [agnOps.length, agnOps[0].amount], [1, 6000]);
  const w11 = normalizeWeb({ nodes: [SRC, P('own', 1), P('util', 2)], edges: [E('e1', 'src', 'own', 'rest', { article: 'rent' }), E('e2', 'own', 'util', 'fixed', { amount: 45, article: 'utilities' })] });
  eq('deduction line', webOps(w11, evalWeb(w11, { booking: 50000 })).filter((o) => o.partyId === 1).map((o) => [o.article, o.amount]).sort(), [['rent', 50000], ['utilities', -4500]]);
  const wj = webJournal(w11, evalWeb(w11, { booking: 50000 }), { day: '2026-09-03', currency: 'GEL', ref: 42 });
  const wjj = appendOps([], wj.ops);
  eq('web -> journal', [wjj.ok, wjj.journal.map((o) => [o.partyId, o.kind, o.article, o.amount]), ledgerBalance(wjj.journal).get(1).due],
    [true, [[1, 'accrual', 'rent', 50000], [2, 'accrual', 'utilities', 4500], [1, 'deduction', 'utilities', 4500]], 45500]);
  eq('unbound template parties reported', webJournal(starterWeb(), evalWeb(starterWeb(), { booking: 100 }), { day: '2026-09-03', currency: 'GEL' }).unbound.sort(), ['agn', 'own']);
  const flatRules = normalizeSplit([{ partyId: 1, article: 'rent', method: 'pct', pct: 70 }, { partyId: 3, article: 'cleaning', method: 'fixed', amount: 25 }, { partyId: 2, article: 'commission', method: 'rest' }]);
  const b98765 = toMinor(987.65);
  const star = starFromSplit(flatRules);
  const evStar = evalWeb(star, { booking: b98765 });
  eq('star = cascade', distribute(b98765, flatRules).rows.map((r) => evStar.left['p' + r.partyId] === r.amount), [true, true, true]);
  eq('star valid when bound', webErrors(validateWeb(star, { bound: true })).length, 0);
  eq('star surplus to the rest party', evalWeb(starFromSplit(normalizeSplit([{ partyId: 1, method: 'pct', pct: 70 }, { partyId: 2, method: 'rest' }])), { booking: 0, surplus: 5000 }).left.p2, 5000);
  eq('star string ids', starFromSplit(normalizeSplit([{ partyId: 'own-1', method: 'rest' }])).nodes.map((n) => n.id), ['src', 'pown-1', 'sur']);
  const miss = bindWeb(starterWeb(), [{ id: 8, role: 'agency' }]);
  eq('binding refuses by role', [miss.missing, webErrors(validateWeb(miss.web, { bound: true })).some((x) => x.code === 'party_not_assigned')], [['owner'], true]);
  const sw = starterWeb();
  const moved = normalizeWeb({ ...sw, nodes: sw.nodes.map((n) => ({ ...n, x: n.x + 100, name: { en: 'other name' } })) });
  const changed = normalizeWeb({ ...sw, edges: sw.edges.map((e) => (e.id === 'e1' ? { ...e, value: 6500 } : e)) });
  eq('hash ignores canvas, not money', [webHash(moved) === webHash(sw), webHash(changed) === webHash(sw), /^[0-9a-f]{8}$/.test(webHash(sw))], [true, false, true]);
  const building = starFromSplit(normalizeSplit([{ partyId: 1, method: 'rest' }]));
  eq('inheritance', [resolveWeb({ face: sw }).level, resolveWeb({ face: sw, building }).level, resolveWeb({ face: sw, building, lot: sw }).level, resolveWeb({ face: sw, building: { v: 1, nodes: [], edges: [] } }).level, resolveWeb({}).level],
    ['face', 'building', 'lot', 'face', '']);
  const codes = (w) => webErrors(validateWeb(normalizeWeb(w))).map((x) => x.code);
  eq('validation codes', [codes({ nodes: [P('a', 1)], edges: [] }).includes('no_booking_source'), codes({ nodes: [SRC, { id: 'x', kind: 'party', x: 0, y: 0 }], edges: [E('e', 'src', 'x', 'rest')] }).includes('party_unbound'), codes(starterWeb()).length],
    [true, true, 0]);
  // Money is conserved on random webs: what parties keep plus what is stuck equals what came in (no guarantees).
  let leak = 0;
  for (let t = 0; t < 150; t++) {
    const nP = 2 + rnd(5);
    const nodes = [SRC, ...Array.from({ length: nP }, (_, i) => P('p' + i, i + 1))];
    const edges = [];
    for (let i = 0; i < nP; i++) {
      const from = i === 0 || rnd(3) === 0 ? 'src' : 'p' + rnd(i);
      const m = ['pct', 'fixed', 'rest'][rnd(3)];
      edges.push(E('e' + i, from, 'p' + i, m, m === 'pct' ? { pct: rnd(10000) / 100 } : m === 'fixed' ? { amount: rnd(500), unit: ['booking', 'night', 'month'][rnd(3)] } : {}));
    }
    const w = normalizeWeb({ nodes, edges });
    const income = rnd(10000000);
    const ev = evalWeb(w, { booking: income }, { nights: 1 + rnd(20) });
    const stuck = ev.stuck.reduce((s, x) => s + x.amount, 0);
    if (!ev.ok || sumLeft(w, ev) + stuck !== income) leak++;
  }
  eq('money conserved on 150 random webs', leak, 0);

  // --- web picture ------------------------------------------------------------------------------------------------
  eq('edge rule text', [edgeRuleText({ method: 'pct', value: 7000 }), edgeRuleText({ method: 'rest' }, { lang: 'ru' }), edgeRuleText({ method: 'fixed', value: 3500, unit: 'night', guaranteed: true }, { currency: 'GEL' })],
    ['70 %', 'остаток', '35.00 GEL / night, guaranteed']);
  const g = webGraph(bound, { ev: evs, currency: 'GEL', partyNames: { 7: 'Nino' } });
  eq('web graph', [g.nodes.length, g.edges.length, g.nodes.find((n) => n.id === 'own').label, g.nodes.find((n) => n.id === 'src').shape, g.edges[0].label],
    [4, 3, 'Nino\n700.00 GEL', 'stadium', '70 % · Accommodation · = 700.00 GEL']);

  // --- rates ------------------------------------------------------------------------------------------------------
  const table = normalizeRates({ base: 'gel', rates: { USD: 0.37, RUB: 33, EUR: 0.34, BAD: -1, JPY: 55, x: 2 } });
  eq('rates normalised', [table.base, Object.keys(table.rates).sort()], ['GEL', ['EUR', 'GEL', 'JPY', 'RUB', 'USD']]);
  eq('convert base -> X', convert(100, 'GEL', 'USD', table), 37);
  eq('same currency', convert(50, 'USD', 'USD', table), 50);
  eq('cross via base', Math.round(convert(37, 'USD', 'RUB', table) * 1e6) / 1e6, 3300);
  eq('no rate -> null', [convert(10, 'GEL', 'CHF', table), crossRate('CHF', 'USD', table)], [null, null]);
  eq('convertMinor exponents', [convertMinor(1000, 'GEL', 'USD', table), convertMinor(1000, 'GEL', 'JPY', table), convertMinor(55, 'JPY', 'GEL', table)], [370, 550, 100]);
  eq('convertMinor rounding', [convertMinor(1, 'GEL', 'USD', table), convertMinor(1, 'GEL', 'USD', table, { rounding: 'ceil' })], [0, 1]);
  const rb = rebase(table, 'USD');
  eq('rebase', [rb.base, rb.rates.USD, Math.round(rb.rates.GEL * 1e6) / 1e6, Math.round(crossRate('EUR', 'RUB', rb) * 1e6) === Math.round(crossRate('EUR', 'RUB', table) * 1e6)], ['USD', 1, 2.702703, true]);
  eq('pairs for payments/money.js', Math.round(pairConvert(37, 'USD', 'RUB', toPairs(table)) * 1e6) / 1e6, 3300);
  eq('sum in one currency', sumIn([{ amount: 1000, currency: 'GEL' }, { amount: 370, currency: 'USD' }, { amount: 5, currency: 'CHF' }], 'GEL', table), { total: 2000, missing: ['CHF'] });

  // --- CSV --------------------------------------------------------------------------------------------------------
  const csv = statementCsv(st1, { lang: 'en' });
  const rowsCsv = parseCSV(csv.slice(1));
  eq('statement csv', [csv.charCodeAt(0), rowsCsv[0][0], rowsCsv[1], rowsCsv[rowsCsv.length - 1]],
    [0xfeff, 'Date', ['2026-09-01', 'Accrued', '', '100.00', 'GEL', '7', '', '110.00', ''], ['Closing balance', '', '', '310.00', 'GEL']]);
  eq('csv guards formulas', csvText([['=HYPERLINK("x")', '-12.5']], { bom: false }), '"\'=HYPERLINK(""x"")",-12.5\r\n');
  const jc = parseCSV(journalCsv(r1.journal, { lang: 'ru' }).slice(1));
  eq('journal csv', [jc[0][0], jc[1][2], jc[1][9], jc[3][8]], ['Номер', 'Начислено', 'да', '1']);
  const kc = parseCSV(kpiCsv(k).slice(1));
  eq('kpi csv', [kc.length, kc[1].slice(0, 10)], [3, ['2026-09-01', '2026-09-30', 'GEL', '2', '7', '26.7', '900.00', '700.00', '100.00', '23.33']]);

  console.log(`ledger: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
