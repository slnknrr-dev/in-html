// receipt/test.js - unit tests of the receipt library: `node receipt/test.js` (importing the module runs nothing).
// Exact rounding and allocation (fuzzed against BigInt), VAT included per line and per rate, cart operations and
// discounts (lines always add up to the total), points / card / cash payments with change and cash rounding,
// returns in several steps, loyalty points and segments, X / Z shift reports (the source's scenario), best prices
// with promotions, price tags and the 32 / 48 column text receipts.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allocate, divRound, formatMoney, lineAmount, mulDivRound, parseMoney, percentOf, qtyMilli, roundCash } from './money.js';
import { addBreakdown, emptyBreakdown, netOf, vatBreakdown, vatIncluded, vatOnTop } from './vat.js';
import { addItem, computeCheck, removeLine, setLineDiscount, setQty, stockWarnings } from './cart.js';
import { refundSplit, settle } from './payment.js';
import { buildReturn, refundOf, returnable } from './returns.js';
import { cardNumber, checkSpend, customerStats, daysBetween, ean13, maxSpend, pointsEarned, pointsLedger, returnPoints, rfmScores, segmentOf } from './loyalty.js';
import { checkCashOp, shiftExpired, shiftReport, SHIFT_MAX_MS, zReport } from './shift.js';
import { activePromotions, ancestorsOf, bestPrice, changedItems, priceTags, promoPrice, promotionState, unitPrice } from './price.js';
import { returnDoc, saleDoc } from './doc.js';
import { center, columns, columnsFor, formatReceipt, formatShift, row, textWidth, wrap } from './format.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const throws = (name, fn) => { try { fn(); fail++; console.log(`FAIL ${name}: no throw`); } catch { pass++; } };
  let seed = 5;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >>> 8) % n; };

  // --- money ------------------------------------------------------------------------------------------------------
  eq('div half-up', [divRound(5, 2), divRound(-5, 2), divRound(7, 3), divRound(8, 3), divRound(-8, 3)], [3, -3, 2, 3, -3]);
  eq('div half-even', [divRound(5, 2, 'half-even'), divRound(7, 2, 'half-even'), divRound(-5, 2, 'half-even')], [2, 4, -2]);
  eq('div down/up', [divRound(7, 3, 'down'), divRound(7, 3, 'up'), divRound(-7, 3, 'down'), divRound(-7, 3, 'up'), divRound(6, 3, 'up')], [2, 3, -2, -3, 2]);
  eq('div negative divisor', divRound(5, -2), -3);
  throws('div by zero', () => divRound(1, 0));
  throws('div non-integer', () => divRound(1.5, 2));
  throws('unknown mode', () => divRound(1, 3, 'sideways'));
  eq('mulDiv big', mulDivRound(9_000_000_000_000, 1000, 3000), 3_000_000_000_000);
  for (let k = 0; k < 300; k++) {
    const a = rnd(2_000_000_000) * (rnd(2) ? 1 : -1) * (rnd(3) ? 1 : 1000), m = 1 + rnd(1_000_000), b = 1 + rnd(100_000);
    const A = BigInt(a) * BigInt(m), B = BigInt(b);
    const neg = A < 0n, abs = neg ? -A : A;
    let q = abs / B; if ((abs % B) * 2n >= B) q++;
    eq('mulDiv fuzz ' + k, mulDivRound(a, m, b), Number(neg ? -q : q));
  }
  eq('qty milli', [qtyMilli(0.375), qtyMilli('1.2'), qtyMilli(2)], [375, 1200, 2000]);
  eq('line amount', [lineAmount(2, 1180), lineAmount(0.375, 1599), lineAmount(2.5, 333), lineAmount(0.1 * 3, 1000)], [2360, 600, 833, 300]);
  eq('percent', [percentOf(10000, 15), percentOf(999, 12.5), percentOf(1, 50), percentOf(3, 50, 'half-even')], [1500, 125, 1, 2]);
  eq('allocate', allocate(100, [1, 1, 1]), [34, 33, 33]);
  eq('allocate weights', allocate(10, [300, 600, 100]), [3, 6, 1]);
  eq('allocate zero weights', allocate(5, [0, 0]), [3, 2]);
  eq('allocate negative', allocate(-7, [1, 1]), [-4, -3]);
  eq('allocate empty', allocate(5, []), []);
  for (let k = 0; k < 200; k++) {
    const w = Array.from({ length: 1 + rnd(7) }, () => rnd(5000));
    const t = rnd(10000);
    const parts = allocate(t, w);
    const sum = w.reduce((a, b) => a + b, 0);
    const fair = parts.every((p, i) => (sum ? Math.abs(p - (t * w[i]) / sum) < 1 : true));
    eq('allocate fuzz ' + k, [parts.reduce((a, b) => a + b, 0), fair], [t, true]);
  }
  eq('parse money', [parseMoney('12,5'), parseMoney('12.50'), parseMoney('1 234,56'), parseMoney('1.234,5'), parseMoney('-3'), parseMoney('0.005'), parseMoney('abc'), parseMoney(''), parseMoney(12.345)],
    [1250, 1250, 123456, 123450, -300, 1, null, null, 1235]);
  eq('parse digits 0/3', [parseMoney('150', 0), parseMoney('1.2345', 3)], [150, 1235]);
  eq('format money', [formatMoney(123456), formatMoney(5), formatMoney(-5), formatMoney(123456789, { group: ' ', decimal: ',' }), formatMoney(7, { digits: 0 }), formatMoney(100, { plus: true }), formatMoney(1234, { digits: 3 })],
    ['1234.56', '0.05', '-0.05', '1 234 567,89', '7', '+1.00', '1.234']);
  eq('round cash', [roundCash(1232, 5), roundCash(1233, 5), roundCash(1237, 10), roundCash(1237)], [1230, 1235, 1240, 1237]);

  // --- VAT --------------------------------------------------------------------------------------------------------
  eq('vat 18', [vatIncluded(1180, 18), vatIncluded(2360, 18), vatIncluded(100, 18), vatIncluded(-1180, 18), vatIncluded(500, null), vatIncluded(500, 0)], [180, 360, 15, -180, 0, 0]);
  eq('vat decimal rate', [vatIncluded(1055, 5.5), vatIncluded(10000, 2.1)], [55, 206]);
  eq('vat on top / net', [vatOnTop(1000, 18), netOf(1180, 18), netOf(101, 18) + vatIncluded(101, 18)], [180, 1000, 101]);
  const vl = [{ total: 101, vatRate: 18 }, { total: 101, vatRate: 18 }, { total: 101, vatRate: 18 }, { total: 500, vatRate: 5 }, { total: 300, vatRate: null }];
  eq('breakdown line', vatBreakdown(vl), { rates: { 18: { gross: 303, vat: 45, net: 258 }, 5: { gross: 500, vat: 24, net: 476 } }, exempt: 300, vat: 69, gross: 1103 });
  eq('breakdown rate', vatBreakdown(vl, { method: 'rate' }).rates['18'], { gross: 303, vat: 46, net: 257 });
  eq('breakdown add', addBreakdown(vatBreakdown(vl), vatBreakdown([{ total: 101, vatRate: 18 }]), -1).rates['18'], { gross: 202, vat: 30, net: 172 });
  eq('breakdown empty', addBreakdown(emptyBreakdown(), emptyBreakdown()), { rates: {}, exempt: 0, vat: 0, gross: 0 });

  // --- cart -------------------------------------------------------------------------------------------------------
  let cart = [];
  const bread = { item: 'bread', name: 'Bread', price: 1180, vatRate: 18, stock: 3 };
  ({ cart } = addItem(cart, bread));
  ({ cart } = addItem(cart, bread, { code: 'C1' }));
  eq('add merge', [cart.length, cart[0].qty, cart[0].codes], [1, 2, ['C1']]);
  const twice = addItem(cart, bread, { code: 'C1' });
  eq('code twice', [twice.error, twice.cart === cart], ['code_twice', true]);
  ({ cart } = addItem(cart, { item: 'cheese', name: 'Cheese', price: 2599, vatRate: 18 }, { qty: 0.375 }));
  ({ cart } = addItem(cart, { item: 'bread', name: 'Bread', price: 990, vatRate: 18 }));
  eq('other price new line', cart.length, 3);
  eq('stock warnings', stockWarnings(setQty(cart, 0, 3)), [{ index: 0, item: 'bread', qty: 4, stock: 3 }]);
  eq('set qty 0 removes', setQty(cart, 2, 0).length, 2);
  eq('remove', removeLine(cart, 0).map((l) => l.item), ['cheese', 'bread']);
  const ck = computeCheck(cart);
  eq('check plain', [ck.subtotal, ck.total, ck.lines.map((l) => l.total), ck.vat.vat], [2360 + 975 + 990, 4325, [2360, 975, 990], 360 + 149 + 151]);
  const ck2 = computeCheck(setLineDiscount(cart, 1, { pct: 10 }), { discount: { pct: 5 } });
  const lt = ck2.lines.map((l) => l.total);
  eq('check discounts', [ck2.lines[1].lineDiscount, ck2.checkDiscount, ck2.discount, lt.reduce((a, b) => a + b, 0) === ck2.total], [98, 211, 309, true]);
  eq('check amount discount capped', computeCheck(cart, { discount: { amount: 999999 } }).total, 0);
  eq('check amount discount', computeCheck(cart, { discount: { amount: 100 } }).lines.map((l) => l.checkDiscount), [55, 22, 23]);
  eq('line discount amount', computeCheck(setLineDiscount([cart[0]], 0, { amount: 60 })).lines[0].total, 2300);
  eq('clear line discount', setLineDiscount(setLineDiscount(cart, 0, { pct: 5 }), 0, null)[0].discount, undefined);
  eq('unit price', computeCheck([{ item: 'x', qty: 3, price: 100 }], { discount: { amount: 10 } }).lines[0].unitPrice, 290 / 3);
  for (let k = 0; k < 200; k++) {
    const c = Array.from({ length: 1 + rnd(6) }, (_, i) => ({ item: 'i' + i, qty: (1 + rnd(3000)) / (rnd(2) ? 1000 : 1), price: rnd(50000), vatRate: [18, 0, null, 5.5][rnd(4)], ...(rnd(3) ? {} : { discount: { pct: rnd(30) } }) }));
    const r = computeCheck(c, { discount: rnd(2) ? { pct: rnd(25) } : { amount: rnd(500) } });
    const sum = r.lines.reduce((t, l) => t + l.total, 0);
    eq('check fuzz ' + k, [sum === r.total, r.total === r.subtotal - r.discount, r.lines.every((l) => l.total >= 0 && Number.isInteger(l.total)), r.vat.gross === r.total], [true, true, true, true]);
  }

  // --- payment ----------------------------------------------------------------------------------------------------
  const p1 = settle(2360, { cash: 3000 });
  eq('cash change', [p1.method, p1.cash, p1.change, p1.errors], ['cash', 2360, 640, []]);
  eq('cash short', settle(2360, { cash: 2000 }).errors, ['cash_short']);
  eq('cash untyped', settle(2360).cash, 2360);
  eq('card', [settle(1180, { card: 'rest' }).method, settle(1180, { card: 'rest' }).card, settle(1180, { card: 'rest' }).cash], ['card', 1180, 0]);
  eq('card exceeds', settle(1180, { card: 2000 }).errors, ['card_exceeds']);
  const mix = settle(5000, { card: 3000, cash: 2500 });
  eq('mixed', [mix.method, mix.card, mix.cashDue, mix.cash, mix.change], ['mixed', 3000, 2000, 2000, 500]);
  const loy = { balance: 40, pointValue: 100, maxSpendPct: 50 };
  const pp = settle(5000, { points: 20, cash: 3000 }, loy);
  eq('points', [pp.points, pp.pointsValue, pp.payable, pp.cash, pp.change], [20, 2000, 3000, 3000, 0]);
  eq('points limit', settle(5000, { points: 30 }, loy).errors, ['points_limit']);
  eq('points balance', settle(5000, { points: 41 }, { ...loy, maxSpendPct: 100 }).errors, ['not_enough_points']);
  eq('points only', settle(2000, { points: 20 }, { ...loy, maxSpendPct: 100 }).method, 'points');
  const rounded = settle(1232, { cash: 2000 }, {}, { cashStep: 5 });
  eq('cash rounding', [rounded.cashDue, rounded.rounding, rounded.change], [1230, -2, 770]);
  eq('refund split mixed', refundSplit({ method: 'mixed', cash: 2000, card: 3000 }, 5000, 1000), { cash: 400, card: 600 });
  eq('refund split cap', refundSplit({ method: 'mixed', cash: 2000, card: 3000 }, 5000, 1000, 1800), { cash: 200, card: 800 });
  eq('refund split card/cash', [refundSplit({ method: 'card' }, 100, 50), refundSplit({ method: 'cash' }, 100, 50)], [{ cash: 0, card: 50 }, { cash: 50, card: 0 }]);

  // --- returns ----------------------------------------------------------------------------------------------------
  const sold = computeCheck([{ item: 'a', name: 'A', qty: 3, price: 1000, vatRate: 18 }, { item: 'b', name: 'B', qty: 1, price: 500, vatRate: null }], { discount: { amount: 100 } });
  eq('sold totals', sold.lines.map((l) => l.total), [2914, 1486 - 1000]);
  const left0 = returnable(sold.lines);
  eq('returnable', left0.a, { qty: 3, amount: 2914, name: 'A', vatRate: 18 });
  const r1 = buildReturn(sold.lines, [{ item: 'a', qty: 1 }]);
  const r2 = buildReturn(sold.lines, [{ item: 'a', qty: 1 }], [r1]);
  const r3 = buildReturn(sold.lines, [{ item: 'a', qty: 1 }], [r1, r2]);
  eq('return in steps', [r1.total, r2.total, r3.total, r1.total + r2.total + r3.total], [971, 972, 971, 2914]);
  eq('return vat', r1.lines[0].vat, vatIncluded(971, 18));
  eq('return exceeds', buildReturn(sold.lines, [{ item: 'a', qty: 1 }], [r1, r2, r3]).errors, [{ code: 'return_exceeds_sale', item: 'a', available: 0 }]);
  eq('return unknown / bad', buildReturn(sold.lines, [{ item: 'z', qty: 1 }, { item: 'b', qty: 0 }]).errors.map((e) => e.code), ['not_in_sale', 'bad_qty']);
  eq('return points', returnPoints({ earned: 10, spent: 20, total: 5000 }, 1000), { reverse: 2, refund: 4 });
  const sale = { total: 5000, payment: settle(5000, { points: 20, card: 1000, cash: 2000 }, loy), earned: 1 };
  const rf = refundOf(sale, 2500);
  eq('refund of', rf, { points: { reverse: 1, refund: 10 }, pointsValue: 1000, money: 1500, cash: 1000, card: 500 });
  const rf2 = refundOf(sale, 2500, [{ total: 2500, cash: 1000 }]);
  eq('refund rest', [rf2.points, rf2.money, rf2.cash], [{ reverse: 0, refund: 10 }, 1500, 1000]);

  // --- loyalty ----------------------------------------------------------------------------------------------------
  eq('ean13', [ean13('290000000001'), cardNumber('29', 1)], ['2900000000018', '2900000000018']);
  throws('ean13 length', () => ean13('123'));
  eq('earned', [pointsEarned(3000), pointsEarned(1999), pointsEarned(3000, { blocked: true }), pointsEarned(100000, { earnPct: 3, pointValue: 1 })], [1, 0, 0, 3000]);
  eq('max spend', [maxSpend(5000, loy), maxSpend(5000, { ...loy, balance: 7 }), maxSpend(0, loy)], [25, 7, 0]);
  eq('check spend', [checkSpend(0, 100), checkSpend(1.5, 100), checkSpend(5, 5000, { ...loy, blocked: true }), checkSpend(5, 5000, loy)], [null, 'points_whole', 'card_blocked', null]);
  const pl = pointsLedger([{ kind: 'welcome', points: 10 }, { kind: 'earn', points: 5 }, { kind: 'spend', points: -12 }, { kind: 'reverse', points: -5 }]);
  eq('points ledger', [pl.balance, pl.history.map((h) => h.balanceAfter), pl.negative], [-2, [10, 15, 3, -2], [3]]);
  eq('days between', daysBetween('2026-10-01', '2026-10-24'), 23);
  const st = customerStats([{ day: '2026-10-20', amount: 5000 }, { day: '2026-08-01', amount: 2000 }, { day: '2026-07-01', amount: 9000 }], '2026-10-24');
  eq('stats', st, { count: 2, amount: 7000, last: '2026-10-20' });
  eq('segments', [
    segmentOf({ joined: '2026-10-10' }, { count: 1, amount: 500, last: '2026-10-20' }, '2026-10-24'),
    segmentOf({ joined: '2025-01-01' }, { count: 1, amount: 200000, last: '2026-10-20' }, '2026-10-24'),
    segmentOf({ joined: '2025-01-01' }, { count: 0, amount: 0, last: '2026-06-01' }, '2026-10-24'),
    segmentOf({ joined: '2025-01-01' }, { count: 4, amount: 9000, last: '2026-10-20' }, '2026-10-24'),
    segmentOf({ joined: '2025-01-01' }, { count: 2, amount: 9000, last: '2026-10-20' }, '2026-10-24'),
    segmentOf({ joined: '2025-01-01' }, { count: 0, amount: 0, last: null }, '2026-10-24'),
  ], ['new', 'vip', 'sleeping', 'regular', 'active', 'sleeping']);
  const rfm = rfmScores([
    { id: 'a', last: '2026-10-23', count: 9, amount: 90000 }, { id: 'b', last: '2026-09-01', count: 1, amount: 1000 },
    { id: 'c', last: '2026-10-01', count: 3, amount: 5000 }, { id: 'd', last: null, count: 0, amount: 0 }, { id: 'e', last: '2026-10-20', count: 5, amount: 20000 },
  ], '2026-10-24');
  eq('rfm', rfm.map((x) => x.id + x.rfm), ['a555', 'b222', 'c333', 'd111', 'e444']);

  // --- shift (the source's scenario, in tetri) ---------------------------------------------------------------------
  const A = { item: 'A', name: 'Baton', price: 1180, vatRate: 18 };
  const s1 = saleDoc({ number: 1 }, [{ ...A, qty: 2 }], { pay: { cash: 3000 } });
  const s2 = saleDoc({ number: 2 }, [{ ...A, qty: 1 }], { pay: { card: 'rest' } });
  const ret = returnDoc({ number: 3 }, s1, [{ item: 'A', qty: 1 }]);
  eq('sale doc', [s1.total, s1.payment.change, s1.vat.rates['18'].vat, s2.payment.method], [2360, 640, 360, 'card']);
  eq('return doc', [ret.total, ret.payment.method, ret.payment.cash, ret.original.number, ret.vat.vat], [1180, 'cash', 1180, 1, 180]);
  const ops = [{ kind: 'in', amount: 2000 }, { kind: 'out', amount: 1000 }];
  const x = shiftReport({ number: 1, openingCash: 5000, openedAt: 0 }, [s1, s2, ret], ops, 100);
  eq('x report', [x.type, x.sales, x.returns, x.net, x.cashIn, x.cashOut, x.expectedCash, x.vat.rates['18'].vat, x.firstReceipt, x.lastReceipt, x.notFiscal],
    ['X', { count: 2, total: 3540, cash: 2360, card: 1180, mixed: 0, points: 0 }, { count: 1, total: 1180, cash: 1180, card: 0, mixed: 0, points: 0 }, 2360, 2000, 1000, 7180, 360, 1, 3, 0]);
  eq('cash op', [checkCashOp(x, 'out', 100000), checkCashOp(x, 'out', 1000), checkCashOp(x, 'in', -5), checkCashOp(x, 'steal', 5)], ['not_enough_cash', null, 'bad_amount', 'bad_amount']);
  const z = zReport(x, 7000, { zNumber: 'Z-000001' });
  eq('z report', [z.type, z.countedCash, z.difference, z.zNumber], ['Z', 7000, -180, 'Z-000001']);
  eq('z uncounted', zReport(x).difference, null);
  eq('expired', [shiftExpired(0, SHIFT_MAX_MS), shiftExpired(0, SHIFT_MAX_MS + 1)], [false, true]);
  const pts = saleDoc({ number: 4 }, [{ ...A, qty: 5 }], { pay: { points: 20, card: 1000, cash: 2000 }, loyalty: { ...loy, earnPct: 5 } });
  const x2 = shiftReport({ number: 2, openingCash: 0 }, [{ ...pts, fiscal: 'pending' }]);
  eq('points sale', [pts.payment.payable, pts.points, x2.sales.points, x2.sales.cash, x2.sales.card, x2.sales.mixed, x2.notFiscal, x2.expectedCash],
    [3900, { spent: 20, earned: 1, balance: 21 }, 2000, 2000, 1000, 3000, 1, 2000]);

  // --- prices -----------------------------------------------------------------------------------------------------
  const nodes = [{ id: 'food', parent: null }, { id: 'dairy', parent: 'food' }, { id: 'milk', parent: 'dairy' }, { id: 'loop', parent: 'loop2' }, { id: 'loop2', parent: 'loop' }];
  eq('ancestors', [ancestorsOf(nodes, 'milk'), ancestorsOf(nodes, 'loop'), ancestorsOf(nodes, 'x')], [['dairy', 'food'], ['loop2'], []]);
  const promos = [
    { id: 'p1', name: 'Dairy -10%', kind: 'percent', value: 10, categories: ['dairy'], from: '2026-10-01', to: '2026-10-31' },
    { id: 'p2', name: 'Milk 2.49', kind: 'fixed', value: 249, items: ['milk'], objects: ['shop2'], from: '2026-10-20', to: '2026-10-25' },
    { id: 'p3', name: 'Up', kind: 'fixed', value: 999, items: ['milk'], from: '2026-10-01', to: '2026-12-31' },
    { id: 'p4', name: 'Old', kind: 'percent', value: 50, items: ['milk'], from: '2026-01-01', to: '2026-01-31' },
    { id: 'p5', name: 'Gone', kind: 'percent', value: 90, items: ['milk'], from: '2026-10-01', to: '2026-10-31', deleted: true },
  ];
  const anc = ancestorsOf(nodes, 'milk');
  eq('active promos', activePromotions(promos, '2026-10-24').map((p) => p.id), ['p1', 'p2', 'p3']);
  eq('promo state', [promotionState(promos[3], '2026-10-24'), promotionState(promos[2], '2026-10-24'), promotionState(promos[1], '2026-10-01')], ['finished', 'active', 'planned']);
  eq('promo price', [promoPrice(299, promos[0]), promoPrice(299, promos[1])], [269, 249]);
  eq('best shop1', bestPrice({ item: 'milk', object: 'shop1', itemPrice: 299, ancestors: anc, promotions: promos, at: '2026-10-24' }),
    { base: 299, price: 269, promo: { id: 'p1', name: 'Dairy -10%', kind: 'percent', value: 10, to: '2026-10-31' }, source: 'item' });
  eq('best shop2', bestPrice({ item: 'milk', object: 'shop2', itemPrice: 299, ancestors: anc, promotions: promos, at: '2026-10-24' }).promo.id, 'p2');
  eq('best object price', bestPrice({ item: 'milk', object: 'shop3', itemPrice: 299, objectPrice: 200, ancestors: anc, promotions: promos, at: '2026-10-24' }), { base: 200, price: 180, promo: { id: 'p1', name: 'Dairy -10%', kind: 'percent', value: 10, to: '2026-10-31' }, source: 'object' });
  eq('promo above base ignored', bestPrice({ item: 'milk', itemPrice: 100, promotions: [promos[2]] }).promo, null);
  eq('no price', bestPrice({ item: 'milk', promotions: promos }), { base: null, price: null, promo: null, source: null });
  eq('changed items', changedItems([{ item: 'a', at: '2026-10-20' }, { item: 'b', at: '2026-09-01' }, { item: 'c', object: 'shop2', at: '2026-10-22' }, { item: 'd', object: 'shop1', at: '2026-10-22' }], '2026-10-17', { object: 'shop1', promoted: ['a', 'milk'] }), ['a', 'd', 'milk']);
  const tags = priceTags([{ item: 'milk', name: 'Milk', code: '4860001', price: bestPrice({ item: 'milk', object: 'shop1', itemPrice: 299, ancestors: anc, promotions: activePromotions(promos, '2026-10-24') }) }], { currency: '₾', objectName: 'Shop', day: '2026-10-24' });
  eq('price tag', [tags[0].text, tags[0].badge, tags[0].old, tags[0].meta, tags[0].size.widthMm], [{ price: '2,69 ₾', old: '2,99' }, 'Dairy -10%', 299, '4860001 · Shop · 2026-10-24', 58]);
  eq('unit price', [unitPrice(349, 400, 1000), unitPrice(1, 0)], [873, null]);

  // --- text -------------------------------------------------------------------------------------------------------
  eq('columns for', [columnsFor(58), columnsFor(80), columnsFor(57)], [32, 48, null]);
  eq('text width', [textWidth('ხაჭაპური'), textWidth('é'), textWidth('Молоко')], [8, 1, 6]);
  eq('wrap', wrap('Georgian cheese bread with egg', 12), ['Georgian', 'cheese bread', 'with egg']);
  eq('wrap long word', wrap('abcdefghij', 4), ['abcd', 'efgh', 'ij']);
  eq('row', row('Bread', '11.80', 16), ['Bread      11.80']);
  eq('row wraps', row('Very long product name', '11.80', 16), ['Very long', 'product', 'name       11.80']);
  eq('row indent', [row('  2 x 1.00', '2.00', 16), row('  Discount for a loyal customer', '-0.50', 20)], [['  2 x 1.00  2.00'], ['  Discount for a', '  loyal', '  customer     -0.50']]);
  eq('row no room', row('Name', '1234567890', 8), ['Name', '1234567890']);
  eq('center', center('ab', 7), '  ab');
  eq('columns', columns([['Milk', '2', '5.98'], ['Cheese and more', '0.375', '9.75']], [{}, { width: 5, align: 'right' }, { width: 6, align: 'right' }], 24), ['Milk            2   5.98', 'Cheese and  0.375   9.75']);
  for (const width of [32, 48]) {
    const text = formatReceipt({ ...pts, seller: { name: 'Shop on Rustaveli', taxId: '405000001', address: 'Rustaveli Ave 1, Tbilisi' }, cashier: 'Nino' }, { width, currency: 'GEL', time: '2026-10-24 12:00' });
    const ls = text.split('\n');
    eq('receipt width ' + width, ls.every((l) => textWidth(l) <= width), true);
    eq('receipt total ' + width, ls.some((l) => /^TOTAL\s+59\.00 GEL$/.test(l) && textWidth(l) === width), true);
    eq('receipt vat ' + width, ls.some((l) => /VAT 18%\s+9\.00$/.test(l)), true);
    eq('receipt points ' + width, ls.some((l) => /^Points \(20\)\s+20\.00$/.test(l)), true);
    const rt = formatReceipt({ ...ret, fiscalNumber: 'F-9' }, { width, labels: { return: 'დაბრუნება' } });
    eq('return text ' + width, [rt.includes('დაბრუნება #3'), /Return of receipt\s+#1/.test(rt), rt.split('\n').every((l) => textWidth(l) <= width)], [true, true, true]);
    const zs = formatShift(z, { width });
    eq('shift text ' + width, [/^\s*Z REPORT$/m.test(zs), /Expected cash\s+71\.80/.test(zs), /Difference\s+-1\.80/.test(zs), zs.split('\n').every((l) => textWidth(l) <= width)], [true, true, true, true]);
  }
  const cashText = formatReceipt(s1, { width: 32 });
  eq('receipt change', [/Cash\s+30\.00/.test(cashText), /Change\s+6\.40/.test(cashText), /2 x 11\.80\s+23\.60/.test(cashText)], [true, true, true]);

  console.log(`receipt: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
