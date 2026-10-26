// stock/test.js - unit tests of the stock library: `node stock/test.js` (importing the module runs nothing).
// Calendar days, the inverse normal and safety stock, ABC cut-offs, XYZ with the minimum-weeks rule, the matrix and
// advice, settings validation, supplier rounding / schedules / holidays / resolution, the replenishment plan
// (warehouse-first allocation, supplier orders), FEFO / FIFO batches and markdowns, valuation and the ledger reducer
// (fuzzed against a plain recomputation).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDays, dayNumber, daysBetween, isDay, periodDays, weekday, weeksBack } from './calendar.js';
import { normCdf, reorderPoint, safetyStock, safetyUnits, zOf } from './safety.js';
import { abcClasses, abcMatrix, aggregateSales, basisValue, cellAdvice, classify, DEFAULT_SETTINGS, historyWeeks, serviceLevelOf, validateSettings, variation, weeklySeries, xyzClass } from './abc.js';
import { holidayAhead, orderCheck, planReplenishment, roundOrder, sellThrough, supplierResolver, verdict } from './replenish.js';
import { addBatch, batchState, consume, consumeFefo, consumeFifo, daysLeft, expirySummary, markdownFor, markdownPrice, markdownRule, restoreLatest, transferBatches, writeOffExpired } from './batches.js';
import { averageCost, averageValue, fifoValuation, lineAmount, margin, movingAverage, roundMinor } from './valuation.js';
import { applyEvent, buildLedger, checkEvent, costNow, emptyLedger, inTransit, negativeStock, stockNow, stockOf } from './ledger.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const near = (name, got, want, tol = 1e-3) => eq(name, Math.abs(got - want) <= tol ? want : got, want);
  const throws = (name, fn) => { try { fn(); fail++; console.log(`FAIL ${name}: no throw`); } catch { pass++; } };
  let seed = 11;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >>> 8) % n; };

  // --- calendar ---------------------------------------------------------------------------------------------------
  eq('weekday mon', weekday('2026-10-19'), 1);
  eq('weekday sun', weekday('2026-10-25'), 7);
  eq('weekday epoch', weekday('1970-01-01'), 4);
  eq('add days over year', addDays('2026-12-30', 3), '2027-01-02');
  eq('add negative', addDays('2024-03-01', -1), '2024-02-29');
  eq('between', daysBetween('2026-10-01', '2026-10-24'), 23);
  eq('period inclusive', periodDays('2026-12-30', '2027-01-08'), 10);
  eq('weeks back', [weeksBack('2026-10-24', '2026-10-24'), weeksBack('2026-10-18', '2026-10-24'), weeksBack('2026-10-17', '2026-10-24'), weeksBack('2026-10-25', '2026-10-24')], [0, 0, 1, -1]);
  eq('isDay', [isDay('2026-02-29'), isDay('2028-02-29'), isDay('2026-13-01'), isDay('26-1-1')], [false, true, false, false]);
  throws('dayNumber invalid', () => dayNumber('2026-02-30'));
  for (let k = 0; k < 200; k++) {
    const d = addDays('2000-01-01', rnd(20000)), n = rnd(800) - 400;
    eq('add/between ' + d, daysBetween(d, addDays(d, n)), n);
  }

  // --- safety -----------------------------------------------------------------------------------------------------
  near('z 0.5', zOf(0.5), 0, 1e-9);
  near('z 0.95', zOf(0.95), 1.6449, 1e-3);
  near('z 0.98', zOf(0.98), 2.0537, 1e-3);
  near('z 0.8', zOf(0.8), 0.8416, 1e-3);
  near('z 0.999', zOf(0.999), 3.0902, 1e-3);
  near('z 0.01 (low tail)', zOf(0.01), -2.3263, 1e-3);
  eq('z bounds', [zOf(0), zOf(1), Number.isNaN(zOf(1.5))], [-Infinity, Infinity, true]);
  for (const p of [0.001, 0.02, 0.1, 0.3, 0.5, 0.7, 0.9, 0.975, 0.995]) near('cdf(z(p)) ' + p, normCdf(zOf(p)), p, 1e-6);
  eq('safety units', [safetyUnits(1.645, 2, 7), safetyUnits(0, 2, 7), safetyUnits(2, 0, 7), safetyUnits(2, 1, 0)], [Math.ceil(1.645 * 2 * Math.sqrt(7)), 0, 0, 2]);
  const ss = safetyStock({ cell: 'AX', sdWeekly: 7 }, 9, DEFAULT_SETTINGS.service);
  eq('safety AX', [ss.serviceLevel, ss.safety], [0.98, Math.ceil(zOf(0.98) * (7 / Math.sqrt(7)) * 3)]);
  eq('safety no cell', safetyStock({ cell: null, sdWeekly: 5 }, 7, DEFAULT_SETTINGS.service), { serviceLevel: null, z: null, safety: 0 });
  eq('safety no sd', safetyStock({ cell: 'BY', sdWeekly: 0 }, 7, DEFAULT_SETTINGS.service).safety, 0);
  eq('reorder point', reorderPoint(2.5, 4, 3), 13);

  // --- ABC --------------------------------------------------------------------------------------------------------
  const abc = abcClasses([
    { id: 'a', revenue: 50000 }, { id: 'b', revenue: 30000 }, { id: 'c', revenue: 10000 }, { id: 'd', revenue: 6000 },
    { id: 'e', revenue: 4000 }, { id: 'f', revenue: 0 }, { id: 'g', revenue: -500 },
  ]);
  eq('abc classes', abc.map((x) => x.id + x.abc).join(' '), 'aA bA cB dB eC fC gC');
  eq('abc shares', [abc[0].share, abc[1].cumShare, abc.at(-1).cumShare], [0.5, 0.8, 1]);
  eq('abc first always A', abcClasses([{ id: 'x', revenue: 990 }, { id: 'y', revenue: 10 }]).map((x) => x.abc), ['A', 'C']);
  eq('abc empty total', abcClasses([{ id: 'x', revenue: 0 }]).map((x) => [x.abc, x.share]), [['C', 0]]);
  eq('abc ties keep order', abcClasses([{ id: 'p', revenue: 5 }, { id: 'q', revenue: 5 }]).map((x) => x.id), ['p', 'q']);
  eq('basis profit', basisValue({ revenue: 1000, qty: 3, cost: 150.5 }, 'profit'), 1000 - 452);
  eq('basis qty', abcClasses([{ id: 'a', revenue: 1, qty: 1 }, { id: 'b', revenue: 999, qty: 50 }], { basis: 'qty' })[0].id, 'b');
  eq('abc cut-offs', abcClasses([{ id: 'a', revenue: 60 }, { id: 'b', revenue: 30 }, { id: 'c', revenue: 10 }], { aCut: 0.5, bCut: 0.85 }).map((x) => x.abc), ['A', 'B', 'C']);

  // --- XYZ --------------------------------------------------------------------------------------------------------
  eq('variation', variation([2, 4, 4, 4, 5, 5, 7, 9]), { mean: 5, sd: 2, cv: 0.4 });
  eq('variation zero', variation([0, 0]).cv, null);
  eq('xyz alternating Z', xyzClass([4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0]).xyz, 'Z');
  eq('xyz steady X', xyzClass([19, 20, 21, 19, 20, 21, 19, 20, 21, 19, 20, 21]).xyz, 'X');
  eq('xyz Y', xyzClass([10, 14, 6, 10, 14, 6, 10, 14, 6, 10]).xyz, 'Y');
  eq('xyz too new', xyzClass([0, 0, 0, 0, 0, 5, 5, 5, 5, 5], { weeks: 5 }), { xyz: null, cv: 0, mean: 5, sd: 0, weeks: 5 });
  eq('xyz history slices zeros', xyzClass([0, 0, 0, 0, 5, 5, 5, 5, 5, 5, 5, 5], { weeks: 8 }).xyz, 'X');
  eq('xyz boundary', xyzClass([3, 5, 3, 5, 3, 5, 3, 5], { xMax: 0.25 }).xyz, 'X');
  eq('weekly series', weeklySeries([{ day: '2026-10-24', qty: 2 }, { day: '2026-10-17', qty: 3 }, { day: '2026-10-18', qty: 1 }, { day: '2026-01-01', qty: 9 }, { day: '2026-10-25', qty: 9 }], { today: '2026-10-24', weeks: 3 }), [0, 3, 3]);
  eq('history weeks', [historyWeeks('2026-10-24', '2026-10-24'), historyWeeks('2026-10-10', '2026-10-24'), historyWeeks('2026-10-09', '2026-10-24'), historyWeeks('2020-01-01', '2026-10-24', 26), historyWeeks(null, '2026-10-24')], [0, 2, 3, 26, 0]);

  // The source's scenario: 12 weeks; bread ~20/week at 5.00, cake 4 every other week at 15.00, candles rarely.
  const today = '2026-10-24';
  const lines = [];
  for (let w = 0; w < 12; w++) {
    lines.push({ id: 'bread', day: addDays(today, -(w * 7 + 1)), qty: 19 + (w % 3), price: 500 });
    if (w % 2 === 0) lines.push({ id: 'cake', day: addDays(today, -(w * 7 + 2)), qty: 4, price: 1500 });
    if (w % 4 === 0) lines.push({ id: 'candles', day: addDays(today, -(w * 7 + 3)), qty: 1, price: 300 });
  }
  const items = aggregateSales(lines, { today, weeks: 26, costs: { bread: 100, cake: 1000, candles: 100 } });
  eq('aggregate', items.map((x) => [x.id, x.revenue, x.qty, x.historyWeeks]), [['bread', 120000, 240, 12], ['cake', 36000, 24, 11], ['candles', 900, 3, 9]]);
  const cls = Object.fromEntries(classify(items).map((c) => [c.id, c]));
  eq('classify bread', [cls.bread.abc, cls.bread.xyz, cls.bread.cell, cls.bread.marginPct], ['A', 'X', 'AX', 80]);
  // Cake: 36000 of 156900 starts at a cumulative 76.5 % -> still A; its 11 weeks of history alternate 4 and 0.
  eq('classify cake', [cls.cake.abc, cls.cake.xyz, cls.cake.weeks, cls.cake.cv], ['A', 'Z', 11, 0.913]);
  eq('classify candles', [cls.candles.abc, cls.candles.xyz], ['C', 'Z']);
  eq('advice', [cellAdvice(cls.bread), cellAdvice(cls.candles), cellAdvice({ abc: 'A', xyz: 'Z', cell: 'AZ' }), cellAdvice({ abc: 'B', xyz: null }), cellAdvice({ abc: 'B', xyz: 'Y', cell: 'BY' }), cellAdvice(null)],
    ['auto', 'delist', 'watch', 'new', null, null]);
  const m = abcMatrix([...Object.values(cls), { abc: 'A', xyz: null, cell: null, value: 7 }]);
  eq('matrix', [m.AX, m.AZ, m.CZ, m['A-'], m.BX], [{ count: 1, value: 120000 }, { count: 1, value: 36000 }, { count: 1, value: 900 }, { count: 1, value: 7 }, { count: 0, value: 0 }]);
  eq('service of', [serviceLevelOf(cls.bread), serviceLevelOf({ cell: null })], [0.98, null]);
  eq('classify profit basis', classify(items, { basis: 'profit' })[0].value, 120000 - 24000);
  eq('classify new item', classify([{ id: 'n', revenue: 100, qty: 1, weekly: [0, 0, 1], historyWeeks: 1 }])[0].cell, null);

  eq('settings ok', validateSettings({ aCut: 0.7, service: { AX: 0.99 } }).errors, []);
  eq('settings merged', validateSettings({ aCut: 0.7, service: { AX: 0.99 } }).settings.service.AY, 0.97);
  eq('settings bad basis', validateSettings({ basis: 'bogus' }).errors.map((e) => e.field), ['basis']);
  eq('settings order', validateSettings({ aCut: 0.9, bCut: 0.8 }).errors.map((e) => e.field), ['bCut']);
  eq('settings xyz order', validateSettings({ xMax: 0.6, yMax: 0.5 }).errors.map((e) => e.field), ['yMax']);
  eq('settings weeks whole', validateSettings({ weeks: 10.5 }).errors.map((e) => e.field), ['weeks']);
  eq('settings service', validateSettings({ service: { QQ: 0.9, AX: 0.2 } }).errors.length, 2);

  // --- suppliers --------------------------------------------------------------------------------------------------
  eq('round lot then multiple', roundOrder(21, { minQty: 10, multiple: 6 }), 24);
  eq('round small', roundOrder(2, { minQty: 10, multiple: 6 }), 12);
  eq('round exact multiple', roundOrder(12, { minQty: null, multiple: 6 }), 12);
  eq('round min only', roundOrder(3, { minQty: 5, multiple: null }), 5);
  eq('round zero', roundOrder(0, { minQty: 5, multiple: 6 }), 0);
  eq('round no supplier', roundOrder(7, null), 7);
  eq('round fractional', roundOrder(1.1, { multiple: 0.25 }), 1.25);
  eq('round float multiple', roundOrder(0.3, { multiple: 0.1 }), 0.3);
  const sup = { orderDays: [1, 3], holidays: [{ from: '2026-12-30', to: '2027-01-08', note: 'New Year' }], leadDays: 14 };
  eq('order monday', orderCheck(sup, '2026-10-19'), { ok: true, nextOrderDate: '2026-10-19', warnings: [], deliveryDate: '2026-11-02', deliveryDateWarehouse: '2026-11-02' });
  eq('order tuesday', orderCheck(sup, '2026-10-20'), { ok: false, nextOrderDate: '2026-10-21', warnings: [{ code: 'off_schedule', orderDays: [1, 3] }], deliveryDate: '2026-11-04', deliveryDateWarehouse: '2026-11-04' });
  eq('order holiday', orderCheck(sup, '2026-12-31').nextOrderDate, '2027-01-11');
  eq('order holiday warning', orderCheck(sup, '2026-12-31').warnings, [{ code: 'holiday', from: '2026-12-30', to: '2027-01-08', note: 'New Year' }]);
  eq('order any day', orderCheck({ leadDays: 2, leadDaysWarehouse: 5 }, '2026-10-24'), { ok: true, nextOrderDate: '2026-10-24', warnings: [], deliveryDate: '2026-10-26', deliveryDateWarehouse: '2026-10-29' });
  eq('order never', orderCheck({ orderDays: [1], holidays: [{ from: '2026-01-01', to: '2030-01-01' }] }, '2026-10-24').nextOrderDate, null);
  eq('holiday ahead', holidayAhead(sup, '2026-12-20', 14), { from: '2026-12-30', to: '2027-01-08', days: 10 });
  eq('holiday too far', holidayAhead(sup, '2026-12-01', 14), null);
  eq('holiday already on', holidayAhead(sup, '2026-12-31', 14), null);
  eq('verdicts', [verdict(1.2), verdict(1), verdict(0.8), verdict(0.69), verdict(null)], ['more', 'more', 'keep', 'less', null]);
  eq('sell-through', [sellThrough(7, 10), sellThrough(3, 0)], [0.7, null]);

  const resolve = supplierResolver({
    nodes: [{ id: 'root', parent: null, supplier: 's1' }, { id: 'dairy', parent: 'root' }, { id: 'milk', parent: 'dairy' }, { id: 'kefir', parent: 'dairy', supplier: 's2' }, { id: 'cheese', parent: 'dairy' }, { id: 'orphan', parent: 'none' }],
    suppliers: [{ id: 's1', name: 'Main', leadDays: 7 }, { id: 's2', name: 'Farm', leadDays: 2 }, { id: 's3', name: 'Import', leadDays: 20 }],
    items: [{ item: 'cheese', supplier: 's3', priority: 1, price: 900 }, { item: 'cheese', supplier: 's2', priority: 0, price: 1200, leadDays: 3 }, { item: 'cheese', supplier: 's1', priority: 0, price: 1100 }, { item: 'milk', supplier: 'gone', priority: 0 }],
  });
  eq('resolve inherit', resolve('milk').name, 'Main');
  eq('resolve own', resolve('kefir').name, 'Farm');
  eq('resolve assortment', [resolve('cheese').name, resolve('cheese').price, resolve('cheese').leadDays], ['Main', 1100, 7]);
  eq('resolve none', [resolve('orphan'), resolve('unknown')], [null, null]);

  // --- replenishment ----------------------------------------------------------------------------------------------
  const plan = planReplenishment({
    today: '2026-10-19', days: 28,
    suppliers: { s1: { name: 'Main', leadDays: 7, minQty: 10, multiple: 6, orderDays: [1, 3], price: 250 } },
    warehouses: [{ id: 'wh', name: 'Warehouse', stock: { bread: 30, milk: 4.5 } }],
    rows: [
      { store: 'A', item: 'bread', sold: 56, stock: 2, coverDays: 7, supplier: 's1', received: 50 },
      { store: 'B', item: 'bread', sold: 28, stock: 10, inTransit: 1, onOrder: 2, coverDays: 7, supplier: 's1' },
      { store: 'A', item: 'milk', sold: 28, stock: 20, coverDays: 7, supplier: 's1' },
      { store: 'B', item: 'tea', sold: 14, stock: 0, leadDays: 3, coverDays: 4, supplier: null, safety: 2 },
    ],
  });
  const row = (s, i) => plan.rows.find((r) => r.store === s && r.item === i);
  eq('plan target A bread', [row('A', 'bread').rate, row('A', 'bread').target, row('A', 'bread').need], [2, 28, 26]);
  eq('plan need B bread', [row('B', 'bread').target, row('B', 'bread').need], [14, 1]);
  eq('plan urgent first', plan.rows.map((r) => r.store + ':' + r.item), ['B:tea', 'A:bread', 'B:bread', 'A:milk']);
  eq('plan warehouse A', [row('A', 'bread').fromWarehouse, row('A', 'bread').shortage, row('A', 'bread').toOrder], [[{ warehouse: 'wh', name: 'Warehouse', qty: 26 }], 0, 0]);
  eq('plan warehouse B', [row('B', 'bread').fromWarehouse.map((x) => x.qty), row('B', 'bread').toOrder], [[1], 0]);
  eq('plan milk covered', row('A', 'milk').need, 0);
  eq('plan no supplier', [row('B', 'tea').target, row('B', 'tea').toOrder], [Math.ceil(0.5 * 7) + 2, 6]);
  eq('plan sell-through', [row('A', 'bread').sellThrough, row('A', 'bread').verdict], [56 / 50, 'more']);
  eq('plan orders', plan.orders.map((o) => [o.supplierId, o.stores.map((s) => s.lines.map((l) => l.qty))]), [[null, [[6]]]]);

  const plan2 = planReplenishment({
    today: '2026-10-20', days: 10,
    suppliers: { s1: { name: 'Main', leadDays: 5, minQty: 10, multiple: 6, orderDays: [1, 3], holidays: [{ from: '2026-10-28', to: '2026-10-30' }], price: 250 } },
    rows: [
      { store: 'A', item: 'x', storeName: 'Shop A', sold: 30, stock: 1, coverDays: 5, supplier: 's1', class: { abc: 'A', xyz: 'X', cell: 'AX', sdWeekly: 7 } },
      { store: 'B', item: 'x', sold: 5, stock: 0, coverDays: 5, supplier: 's1' },
    ],
  });
  const ax = plan2.rows.find((r) => r.store === 'A');
  const safetyAX = Math.ceil(zOf(0.98) * (7 / Math.sqrt(7)) * Math.sqrt(5));
  eq('plan2 holiday', ax.holiday, { from: '2026-10-28', to: '2026-10-30', days: 3 });
  eq('plan2 target', [ax.safety, ax.target, ax.serviceLevel, ax.advice], [safetyAX, Math.ceil(3 * 13) + safetyAX, 0.98, 'auto']);
  eq('plan2 rounded', ax.toOrder, roundOrder(ax.need, { minQty: 10, multiple: 6 }));
  const o = plan2.orders[0];
  eq('plan2 order', [o.supplierName, o.canOrder, o.nextOrderDate, o.deliveryDate, o.warnings.map((w) => w.code)], ['Main', false, '2026-10-21', '2026-10-26', ['off_schedule', 'before_holiday']]);
  eq('plan2 stores', o.stores.map((s) => [s.store, s.storeName, s.lines[0].qty]), [['B', 'B', 12], ['A', 'Shop A', ax.toOrder]]);
  eq('plan2 amount', o.amount, (ax.toOrder + 12) * 250);
  eq('plan2 row warnings', ax.warnings.length, 2);

  // --- batches ----------------------------------------------------------------------------------------------------
  const bs = [
    { batch: 'B', expires: '2026-10-30', qty: 5, received: '2026-10-20' },
    { batch: 'A', expires: '2026-10-26', qty: 2, received: '2026-10-22' },
    { batch: 'N', expires: null, qty: 4, received: '2026-10-01' },
  ];
  const c1 = consumeFefo(bs, 3);
  eq('fefo', [c1.taken.map((t) => [t.batch, t.qty]), c1.batches.map((b) => [b.batch, b.qty]), c1.short], [[['A', 2], ['B', 1]], [['B', 4], ['N', 4]], 0]);
  eq('fifo', consumeFifo(bs, 5).taken.map((t) => [t.batch, t.qty]), [['N', 4], ['B', 1]]);
  eq('consume short', consume(bs, 20).short, 9);
  eq('consume weight', consumeFefo([{ batch: 'w', expires: '2026-11-01', qty: 1.2 }], 0.3).batches[0].qty, 0.9);
  eq('input unchanged', bs[1].qty, 2);
  eq('add merge', addBatch(bs, { batch: 'A', expires: '2026-10-26', qty: 3 }).find((b) => b.batch === 'A').qty, 5);
  eq('add new expiry', addBatch(bs, { batch: 'A', expires: '2026-11-26', qty: 3 }).length, 4);
  const back = restoreLatest(bs.slice(0, 2), 1);
  eq('restore latest', [back.placed, back.batches[0].qty], ['B', 6]);
  eq('restore none', restoreLatest([], 1).placed, null);
  const tr = transferBatches(bs, [{ batch: 'A', expires: '2026-10-26', qty: 1 }], 3);
  eq('transfer', [tr.from.map((b) => b.batch + b.qty).join(), tr.to.map((b) => b.batch + b.qty).join()], ['B4,N4', 'A3,B1']);
  eq('days left', [daysLeft('2026-10-26', '2026-10-24'), daysLeft('2026-10-20', '2026-10-24'), daysLeft(null, '2026-10-24')], [2, -4, null]);
  eq('states', [batchState('2026-10-23', today), batchState('2026-10-27', today), batchState('2026-10-28', today), batchState(null, today)], ['expired', 'expiring', 'ok', null]);
  eq('markdown rule', [markdownRule(3), markdownRule(2), markdownRule(1), markdownRule(0), markdownRule(4), markdownRule(-1)].map((r) => r?.pct ?? null), [20, 20, 50, 50, null, null]);
  eq('markdown for', markdownFor(bs, [{ days: 3, pct: 30 }], '2026-10-24'), { batch: 'A', expires: '2026-10-26', daysLeft: 2, pct: 30 });
  eq('markdown expired', markdownFor(bs, undefined, '2026-10-27'), { batch: 'A', expires: '2026-10-26', daysLeft: -1, pct: 0, expired: true });
  eq('markdown none', markdownFor(bs, undefined, '2026-10-01'), null);
  eq('markdown price', [markdownPrice(400, 30), markdownPrice(399, 50), markdownPrice(333, 12.5), markdownPrice(500, 0)], [280, 200, 291, 500]);
  const wo = writeOffExpired(bs, '2026-10-27');
  eq('write off', [wo.qty, wo.written.map((b) => b.batch), wo.batches.length], [2, ['A'], 2]);
  eq('summary', expirySummary(bs, today), { ok: 5, expiring: 2, expired: 0, none: 4 });
  // Fuzz: FEFO never takes a later batch while an earlier one has stock, and quantities are conserved.
  for (let k = 0; k < 200; k++) {
    const list = Array.from({ length: 1 + rnd(6) }, (_, i) => ({ batch: 'b' + i, expires: addDays(today, rnd(20)), qty: 1 + rnd(9), received: addDays(today, -rnd(9)) }));
    const total = list.reduce((t, b) => t + b.qty, 0);
    const want = rnd(total + 5);
    const r = consumeFefo(list, want);
    const took = r.taken.reduce((t, b) => t + b.qty, 0);
    const left = r.batches.reduce((t, b) => t + b.qty, 0);
    const maxTaken = r.taken.filter((t) => list.find((b) => b.batch === t.batch).qty === t.qty).map((t) => t.expires).sort().at(-1);
    const ok = took + left === total && took + r.short === want && r.batches.every((b) => !maxTaken || b.expires >= maxTaken || b.expires === null);
    eq('fefo fuzz ' + k, ok, true);
  }

  // --- valuation --------------------------------------------------------------------------------------------------
  eq('round minor', [roundMinor(30.000000000000004), roundMinor(2.5), roundMinor(-2.5), roundMinor(1.4999999)], [30, 3, -3, 1]);
  eq('line amount', [lineAmount(0.1 * 3, 100), lineAmount(1.005, 1000), lineAmount(2.5, 333)], [30, 1005, 833]);
  eq('average cost', averageCost([{ qty: 10, cost: 100 }, { qty: 30, cost: 200 }, { qty: 5 }]), { qty: 40, amount: 7000, unit: 175 });
  eq('average value', [averageValue(4, [{ qty: 10, cost: 100 }, { qty: 30, cost: 200 }]), averageValue(3, [])], [700, 0]);
  const mv = movingAverage([{ qty: 3, cost: 100 }, { qty: -1 }, { qty: 1, cost: 400 }, { qty: -3 }, { qty: -1 }]);
  eq('moving average', [mv.qty, mv.value, mv.cogs, mv.short], [0, 0, 700, 1]);
  const mv2 = movingAverage([{ qty: 3, amount: 100 }, { qty: -1 }]);
  eq('moving rounding', [mv2.value, mv2.cogs, mv2.value + mv2.cogs], [67, 33, 100]);
  const fifo = fifoValuation([{ qty: 10, cost: 100 }, { qty: 5, cost: 120 }, { qty: -12 }, { qty: 4, cost: 130 }]);
  eq('fifo', [fifo.layers, fifo.qty, fifo.value, fifo.cogs], [[{ qty: 3, cost: 120 }, { qty: 4, cost: 130 }], 7, 880, 1240]);
  eq('fifo short', fifoValuation([{ qty: 1, cost: 10 }, { qty: -3 }]).short, 2);
  eq('margin', [margin(1000, 750), margin(0, 0)], [{ profit: 250, pct: 25 }, { profit: 0, pct: null }]);

  // --- ledger -----------------------------------------------------------------------------------------------------
  const ev = [
    { type: 'receipt', object: 'S', item: 'x', qty: 10, cost: 100 },
    { type: 'receipt', object: 'S', item: 'x', qty: 10, cost: 200 },
    { type: 'sale', object: 'S', item: 'x', qty: 3 },
    { type: 'return', object: 'S', item: 'x', qty: 1 },
    { type: 'writeoff', object: 'S', item: 'x', qty: 2, reason: 'damaged' },
    { type: 'transfer', id: 't1', from: 'S', to: 'T', lines: [{ item: 'x', qty: 4 }] },
    { type: 'transfer', id: 't2', from: 'S', to: 'T', lines: [{ item: 'x', qty: 2, cost: 50 }] },
    { type: 'accept', id: 't1' },
    { type: 'reject', id: 't2' },
    { type: 'accept', id: 't2' },
    { type: 'count', object: 'S', item: 'x', qty: 11 },
  ];
  const L = buildLedger(ev);
  eq('ledger stock', [stockNow(L, 'S', 'x'), stockNow(L, 'T', 'x'), stockNow(L, 'U', 'x')], [11, 4, 0]);
  eq('ledger cost', [costNow(L, 'S', 'x'), costNow(L, 'T', 'x'), costNow(L, 'U', 'x')], [150, 150, null]);
  eq('ledger transfers', [L.transfers.t1.status, L.transfers.t2.status], ['accepted', 'rejected']);
  eq('ledger rejected', L.rejected.map((r) => [r.index, r.error]), [[9, 'transfer_closed']]);
  eq('ledger stockOf', stockOf(L, 'T'), [{ item: 'x', qty: 4, unit: 150, value: 600 }]);
  const pending = buildLedger(ev.slice(0, 7));
  eq('in transit', [inTransit(pending, 'T', 'x'), inTransit(pending, 'T'), inTransit(pending, 'S', 'x'), stockNow(pending, 'S', 'x')], [6, 6, 0, 10]);
  eq('check insufficient', checkEvent(pending, { type: 'sale', object: 'S', item: 'x', qty: 11 }), 'insufficient_stock');
  eq('check transfer', [checkEvent(pending, { type: 'transfer', id: 't1', from: 'S', to: 'T', lines: [{ item: 'x', qty: 1 }] }), checkEvent(pending, { type: 'accept', id: 'zz' }), checkEvent(pending, { type: 'fly' })], ['duplicate_transfer', 'unknown_transfer', 'unknown_type']);
  const off = buildLedger([{ type: 'sale', object: 'S', item: 'y', qty: 2 }]);
  eq('offline oversell', [stockNow(off, 'S', 'y'), off.warnings[0].code, negativeStock(off)], [-2, 'negative', [{ object: 'S', item: 'y', qty: -2 }]]);
  eq('strict refuses', buildLedger([{ type: 'sale', object: 'S', item: 'y', qty: 2 }], { strict: true }).rejected[0].error, 'insufficient_stock');
  const s0 = emptyLedger();
  const s1 = applyEvent(s0, { type: 'receipt', object: 'S', item: 'x', qty: 0.1 });
  const s2 = applyEvent(applyEvent(s1, { type: 'receipt', object: 'S', item: 'x', qty: 0.2 }), { type: 'sale', object: 'S', item: 'x', qty: 0.3 });
  eq('apply pure', [stockNow(s0, 'S', 'x'), stockNow(s1, 'S', 'x'), stockNow(s2, 'S', 'x')], [0, 0.1, 0]);
  eq('no cost without price', costNow(s2, 'S', 'x'), null);
  // Fuzz: the ledger equals a plain recomputation over random event streams.
  for (let k = 0; k < 100; k++) {
    const objs = ['S', 'T', 'W'], its = ['a', 'b'];
    const events = [], open = [];
    let tid = 0;
    for (let i = 0; i < 40; i++) {
      const o = objs[rnd(3)], it = its[rnd(2)], q = 1 + rnd(5), kind = rnd(6);
      if (kind === 0 || kind === 1) events.push({ type: 'receipt', object: o, item: it, qty: q, cost: 100 + rnd(50) });
      else if (kind === 2) events.push({ type: 'sale', object: o, item: it, qty: q });
      else if (kind === 3) { const id = 't' + tid++; events.push({ type: 'transfer', id, from: o, to: objs[(objs.indexOf(o) + 1) % 3], lines: [{ item: it, qty: q }] }); open.push(id); }
      else if (open.length) events.push({ type: kind === 4 ? 'accept' : 'reject', id: open.splice(rnd(open.length), 1)[0] });
    }
    const led = buildLedger(events, { strict: true });
    const want = {};
    const add = (o, i, d) => { want[o + i] = Math.round(((want[o + i] ?? 0) + d) * 1e6) / 1e6; };
    const sent = {};
    const ok = new Set(events.filter((_, i) => !led.rejected.some((r) => r.index === i)));
    for (const e of events) {
      if (!ok.has(e)) continue;
      if (e.type === 'receipt') add(e.object, e.item, e.qty);
      if (e.type === 'sale') add(e.object, e.item, -e.qty);
      if (e.type === 'transfer') { sent[e.id] = e; add(e.from, e.lines[0].item, -e.lines[0].qty); }
      if (e.type === 'accept') add(sent[e.id].to, sent[e.id].lines[0].item, sent[e.id].lines[0].qty);
      if (e.type === 'reject') add(sent[e.id].from, sent[e.id].lines[0].item, sent[e.id].lines[0].qty);
    }
    const same = objs.every((o) => its.every((i) => stockNow(led, o, i) === (want[o + i] ?? 0)));
    eq('ledger fuzz ' + k, [same, negativeStock(led).length], [true, 0]);
  }

  console.log(`stock: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
