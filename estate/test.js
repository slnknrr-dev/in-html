// estate/test.js - unit tests of the estate library: `node estate/test.js` (importing the module runs nothing).
// Complex slugs and names, handover quarters, the chessboard (floor order, units without a floor, positions,
// statuses), unit statistics and layouts, the regular grid, mortgage payments and schedules (annuity, differentiated,
// zero rate, exact sums), unit-table import with column sniffing, room trees and layouts, number -> word scales.
//
// Money assertions check exact integers (sums of schedule rows equal the loan to the unit): the library's promise is
// exactness in minor units, so a tolerance here would hide the very bug class it exists to prevent.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPLEX_SLUG_RESERVED, READY_MAX, READY_MIN, cleanComplexName, cleanComplexSlug, cleanReady, complexName, readyBy, readyNum, readyOfDay, readyQuarter, readyText, readyYear } from './complex.js';
import { UNIT_GRID_MAX, chessboard, pricePerM2, unitGrid, unitPlans, unitPrice, unitStats, unitStatus } from './chessboard.js';
import { affordablePrincipal, annuityPayment, annuitySchedule, differentiatedSchedule, loanMonthly, mortgagePlan } from './mortgage.js';
import { cellNumber, headerKey, isFlatNumber, sniffUnitColumns, unitColumnOf, unitStatusOf, unitTable, unitTableFromText } from './table.js';
import { PLACE_TYPES, ROOMS_LAYOUT_NAME, ROOM_BATH_TYPES, ROOM_SERVICE_TYPES, normalizeRoom, normalizeRooms, placeCapacity, roomKeyFromName, roomLabel, roomZones, roomsLayout, roomsSummary } from './rooms.js';
import { EURO_SCALE, cleanScaleKey, mergeScales, normalizeScale, normalizeScales, scaleStepIndex, scaleWord } from './scales.js';

// Run only when executed directly; importing run() has no side effects.
const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const ok = (name, cond) => eq(name, !!cond, true);
  let seed = 5;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >>> 8) % n; };

  // --- complex ----------------------------------------------------------------------------------------------------
  eq('slug', [cleanComplexSlug('Orbi City'), cleanComplexSlug('  --orbi-city--  '), cleanComplexSlug('Орби'), cleanComplexSlug('a'), cleanComplexSlug(''), cleanComplexSlug(null)],
    ['orbicity', 'orbi-city', '', '', '', '']);
  ok('reserved slugs', COMPLEX_SLUG_RESERVED.every((r) => cleanComplexSlug(r) === ''));
  eq('name', [cleanComplexName('Orbi City'), cleanComplexName({ ru: 'Орби', en: 'Orbi', ka: '', zz: 'x' }), cleanComplexName(''), cleanComplexName(42)],
    [{ en: 'Orbi City' }, { en: 'Orbi', ru: 'Орби' }, {}, {}]);
  const c = { slug: 'orbi-city', name: { ru: 'Орби Сити', en: 'Orbi City' } };
  eq('name fallback', [complexName(c, 'ru'), complexName(c, 'ka'), complexName({ slug: 'x', name: { ka: 'ორბი' } }, 'ru'), complexName({ slug: 'orbi-city' }, 'ru')],
    ['Орби Сити', 'Orbi City', 'ორბი', 'orbi-city']);
  eq('readyNum', [readyNum(2027, 2), readyNum('2027', '4'), readyNum(2027, 0), readyNum(2027, 5), readyNum(READY_MIN - 1, 1), readyNum(READY_MAX + 1, 1), readyNum('', 1)],
    [20272, 20274, 0, 0, 0, 0, 0]);
  eq('monotonic', [readyNum(2027, 3), readyNum(2026, 1), readyNum(2027, 1)].sort((a, b) => a - b), [20261, 20271, 20273]);
  eq('cleanReady forms', [20272, '2027-Q2', '2027 q2', '2027-К2', '2027-06-30', '2027-01', '2027-12-01', '2027', '', null, 'soon', '2027-Q9', '2027-13'].map(cleanReady),
    [20272, 20272, 20272, 20272, 20272, 20271, 20274, 20274, 0, 0, 0, 0, 0]);
  eq('year / quarter', [readyYear(20272), readyQuarter(20272), readyYear(0), readyQuarter('no')], [2027, 2, 0, 0]);
  eq('readyOfDay', [readyOfDay('2026-08-23'), readyOfDay('2026-01-01'), readyOfDay('junk')], [20263, 20261, 0]);
  eq('readyText', [readyText(20272, 'ru', '2026-08-23'), readyText(20261, 'ru', '2026-08-23'), readyText(20263, 'ru', '2026-08-23'), readyText(20261, 'ru'), readyText(0, 'ru', '2026-08-23')],
    ['Сдача: II кв. 2027', 'Сдан', 'Сдан', 'Сдача: I кв. 2026', '']);
  eq('readyText en / ka / unknown', [readyText(20272, 'en'), readyText(20261, 'en', '2026-08-23'), readyText(20272, 'ka').includes('2027'), readyText(20272, 'zz')],
    ['Handover: Q2 2027', 'Completed', true, 'Handover: Q2 2027']);
  eq('readyBy', [readyBy(20272, 20274), readyBy(20281, 20274), readyBy(0, 20274)], [true, false, false]);

  // --- chessboard -------------------------------------------------------------------------------------------------
  const U = (o) => ({ flat: String(o.id), floor: 1, area: 50, price: 50000, currency: 'USD', rooms: 2, ...o });
  const b1 = chessboard([U({ id: 1, floor: 2, flat: '10' }), U({ id: 2, floor: 5, flat: '2' }), U({ id: 3, floor: 2, flat: '2' }), U({ id: 4, floor: 5, flat: '10' })]);
  eq('floors top down, flats in order', [b1.rows.map((r) => r.floor), b1.rows[0].cells.map((x) => x.flat), b1.floors, b1.total, b1.columns], [[5, 2], ['2', '10'], 2, 4, 2]);
  const b2 = chessboard([U({ id: 1, floor: 3 }), U({ id: 2, floor: null }), U({ id: 3, floor: null })]);
  eq('units without a floor kept last', [b2.total, b2.rows[b2.rows.length - 1].floor, b2.rows[b2.rows.length - 1].cells.length, b2.floors], [3, null, 2, 1]);
  eq('ground floor is a floor', chessboard([U({ id: 1, floor: 0 }), U({ id: 2, floor: 1 })]).rows.map((r) => r.floor), [1, 0]);
  const b3 = chessboard([U({ id: 1 }), U({ id: 2, sold: true }), U({ id: 3, status: 'sold' }), U({ id: 4, status: 'reserved' }), U({ id: 5, status: 'closed' })]);
  eq('statuses counted', [b3.free, b3.reserved, b3.sold, b3.closed, b3.total], [1, 1, 2, 1, 5]);
  eq('unitStatus', [unitStatus({ sold: true }), unitStatus({ status: 'reserved', sold: true }), unitStatus({ status: 'junk' }), unitStatus(null)], ['sold', 'reserved', 'free', 'free']);
  eq('empty board', [chessboard([]).rows, chessboard([]).total, chessboard(null).floors], [[], 0, 0]);
  const src = [U({ id: 1, floor: 3 })];
  const before = JSON.stringify(src);
  chessboard(src);
  eq('input not mutated', JSON.stringify(src), before);
  const b4 = chessboard([U({ id: 1, floor: 2, position: 1 }), U({ id: 2, floor: 2, position: 3 }), U({ id: 3, floor: 1, position: 2 }), U({ id: 4, floor: 1 })]);
  eq('slots by position', [b4.columns, b4.rows[0].slots.map((x) => x && x.id), b4.rows[1].slots.map((x) => x && x.id)], [3, [1, null, 2], [4, 3, null]]);

  const s1 = unitStats([U({ id: 1, area: 50, price: 50000 }), U({ id: 2, area: 100, price: 120000 }), U({ id: 3, area: 50, price: 500000, sold: true })]);
  eq('avg per m2 of free units', [s1.avgM2, s1.currency, s1.avgFrom, s1.free, s1.sold, s1.total, s1.minM2, s1.maxM2, s1.priceMin, s1.priceMax], [1100, 'USD', 2, 2, 1, 3, 1000, 1200, 50000, 120000]);
  const s2 = unitStats([U({ id: 1, sold: true }), U({ id: 2, sold: true })]);
  eq('no free, no average', [s2.avgM2, s2.currency, s2.free], [0, '', 0]);
  const s3 = unitStats([U({ id: 1, price: 50000 }), U({ id: 2, price: 60000 }), U({ id: 3, price: 500000, currency: 'GEL' })]);
  eq('currencies not mixed', [s3.currency, s3.avgM2, s3.avgFrom], ['USD', 1100, 2]);
  const s4 = unitStats([U({ id: 1 }), U({ id: 2, area: 0 }), U({ id: 3, price: 0 })]);
  eq('missing price or area', [s4.free, s4.avgFrom, s4.avgM2, s4.areaMin, s4.areaMax], [3, 1, 1000, 50, 50]);
  eq('reserved is not free', unitStats([U({ id: 1, status: 'reserved' })]).avgM2, 0);
  eq('price per m2', [pricePerM2({ price: 100000, area: 80 }), pricePerM2({ price: 1, area: 0 })], [1250, 0]);

  const g1 = unitGrid({ floors: 10, perFloor: 4 });
  eq('grid 10 x 4', [g1.length, g1[0].floor, g1[0].flat, g1[39].floor, g1[39].flat, new Set(g1.map((u) => u.flat)).size, g1[5].position], [40, 1, '1', 10, '40', 40, 2]);
  const g2 = unitGrid({ floors: 3, perFloor: 3, areas: [42, 58, 74], rooms: [1, 2, 3] });
  eq('types repeat per floor', [g2.slice(0, 3).map((u) => u.area), g2.slice(3, 6).map((u) => u.area), g2.slice(0, 3).map((u) => u.rooms)], [[42, 58, 74], [42, 58, 74], [1, 2, 3]]);
  const g3 = unitGrid({ floors: 1, perFloor: 2, areas: [42, 58], pricePerM2: 1150 });
  eq('price = area x rate to 100', [g3[0].price, g3[1].price, unitGrid({ floors: 1, perFloor: 1, areas: [42] })[0].price, unitGrid({ floors: 1, perFloor: 1, pricePerM2: 1150 })[0].price], [48300, 66700, 0, 0]);
  eq('price step', [unitPrice(42.5, 1200), unitPrice(42.5, 120000, 1), unitPrice(42.5, 1200, 1000)], [51000, 5100000, 51000]);
  const g4 = unitGrid({ floors: 2, perFloor: 2, firstFloor: 3, firstFlat: 101 });
  eq('first floor and flat', [g4.map((u) => u.floor), g4.map((u) => u.flat)], [[3, 3, 4, 4], ['101', '102', '103', '104']]);
  eq('grid cap', unitGrid({ floors: 200, perFloor: 40 }).length, UNIT_GRID_MAX);
  eq('empty grids', [unitGrid({ floors: 0, perFloor: 4 }), unitGrid({ floors: 4, perFloor: 0 }), unitGrid({})], [[], [], []]);
  ok('grid -> chessboard', chessboard(g1).rows.length === 10 && chessboard(g1).rows[0].floor === 10 && chessboard(g1).columns === 4);

  const u = (rooms, area, price, sold = false, currency = 'USD') => ({ id: 0, flat: '', floor: 1, area, price, currency, rooms, sold });
  const p1 = unitPlans([u(2, 62, 100000), u(2, 65, 110000), u(1, 40, 70000)]);
  eq('plans by room count', [p1.map((x) => x.rooms), p1[1].free, p1[1].areaMin, p1[1].areaMax, p1[1].priceFrom], [[1, 2], 2, 62, 65, 100000]);
  const p2 = unitPlans([u(2, 50, 80000, true), u(2, 70, 120000)]);
  eq('plans from free units', [p2.length, p2[0].priceFrom, p2[0].areaMin, p2[0].sold], [1, 120000, 70, 1]);
  const soldOut = [u(3, 90, 200000, true)];
  eq('sold-out layout', [unitPlans(soldOut), unitPlans(soldOut, { sold: true }).length, unitPlans(soldOut, { sold: true })[0].free, unitPlans(soldOut, { sold: true })[0].priceFrom], [[], 1, 0, 0]);
  const p3 = unitPlans([u(1, 40, 1200, false, 'GEL'), u(1, 42, 95000), u(1, 41, 96000)]);
  eq('plans currency', [p3[0].currency, p3[0].priceFrom], ['USD', 95000]);
  eq('studio is 0 rooms', [unitPlans([u(0, 28, 55000)])[0].rooms, unitPlans([u(0, 28, 55000)])[0].free], [0, 1]);

  // --- mortgage ---------------------------------------------------------------------------------------------------
  const m1 = loanMonthly(100000, { downPct: 20, years: 10, ratePct: 12 });
  eq('loanMonthly annuity', [m1.down, m1.body, m1.months, m1.monthly], [20000, 80000, 120, 1148]);
  eq('loanMonthly zero rate', [loanMonthly(120000, { downPct: 50, years: 5, ratePct: 0 }).monthly, loanMonthly(100000, { downPct: 90, years: 1, ratePct: 0 }).monthly], [1000, 833]);
  const z = loanMonthly(0, { downPct: 20, years: 10, ratePct: 12 });
  eq('loanMonthly zero price', [z.monthly, z.body], [0, 0]);
  const clamp = loanMonthly(100000, { downPct: 999, years: 999, ratePct: 999 });
  eq('loanMonthly clamps', [Number.isFinite(clamp.monthly), clamp.months, clamp.down], [true, 360, 90000]);
  eq('annuity payment in minor units', [annuityPayment(8000000, 12, 120), annuityPayment(0, 12, 120), annuityPayment(6000, 0, 60)], [114777, 0, 100]);
  const a1 = annuitySchedule(8000000, { ratePct: 12, months: 120, startMonth: '2026-11' });
  const sumP = (s) => s.rows.reduce((t, r) => t + r.principal, 0);
  eq('annuity schedule exact', [a1.rows.length, sumP(a1), a1.rows[a1.rows.length - 1].balance, a1.first, a1.rows[0].interest, a1.rows[0].month, a1.rows[119].month],
    [120, 8000000, 0, 114777, 80000, '2026-11', '2036-10']);
  ok('annuity payments equal except the last', a1.rows.slice(0, -1).every((r) => r.payment === a1.first) && Math.abs(a1.last - a1.first) <= 120);
  eq('annuity totals', [a1.totalPaid - a1.totalInterest, a1.totalPaid === a1.rows.reduce((t, r) => t + r.payment, 0)], [8000000, true]);
  const a0 = annuitySchedule(100, { ratePct: 0, months: 3 });
  eq('zero rate schedule', [a0.rows.map((r) => r.payment), a0.totalInterest], [[34, 33, 33], 0]);
  const d1 = differentiatedSchedule(8000000, { ratePct: 12, months: 120 });
  eq('differentiated', [sumP(d1), d1.rows[0].payment, d1.rows[0].interest, d1.rows[119].balance, d1.last < d1.first, d1.totalInterest < a1.totalInterest], [8000000, 146667, 80000, 0, true, true]);
  for (let k = 0; k < 60; k++) {
    const p = 1 + rnd(50000000), n = 1 + rnd(360), r = rnd(3000) / 100;
    const a = annuitySchedule(p, { ratePct: r, months: n }), d = differentiatedSchedule(p, { ratePct: r, months: n });
    if (sumP(a) !== p || a.rows[a.rows.length - 1].balance !== 0 || sumP(d) !== p || a.rows.some((x) => x.principal < 0)) eq('schedule exact ' + k, [p, n, r], 'sums');
  }
  pass++;
  const plan = mortgagePlan(15000000, { downPct: 30, years: 15, ratePct: 10, kind: 'differentiated' });
  eq('mortgage plan', [plan.down, plan.body, plan.months, plan.kind, sumP(plan)], [4500000, 10500000, 180, 'differentiated', 10500000]);
  const afford = affordablePrincipal(114777, 12, 120);
  eq('affordable principal', [annuityPayment(afford, 12, 120) <= 114777, annuityPayment(afford + 1, 12, 120) > 114777, affordablePrincipal(100, 0, 60)], [true, true, 6000]);

  // --- unit table -------------------------------------------------------------------------------------------------
  eq('cellNumber', ['42,5', '1 200 000', '$120,000.50', '42.5 м²', '42,5-58,3', '1,500', '1,500 ₾', '2-к', '', 'abc', 7, '-3'].map(cellNumber),
    [42.5, 1200000, 120000.5, 42.5, 42.5, 1.5, 1500, 2, null, null, 7, -3]);
  eq('headerKey', [headerKey('№'), headerKey('Площадь, м²'), headerKey('Ёмкость')], ['n', 'площадьм2', 'емкость']);
  eq('columns in three languages', ['Квартира', '№', 'Этаж', 'Площадь, м²', 'Кол-во комнат', 'Price', 'ფართობი', 'Number of rooms', 'Status', 'Комментарий менеджера', ''].map(unitColumnOf),
    ['flat', 'flat', 'floor', 'area', 'rooms', 'price', 'area', 'rooms', 'status', null, null]);
  eq('price per m2 is a rate', ['Цена за м2', 'Цена за м²', 'Цена за 1 м²', 'Стоимость за кв.м', 'Price per sqm', 'Price, m²', 'Цена', 'Стоимость, ₾'].map(unitColumnOf),
    ['rate', 'rate', 'rate', 'rate', 'rate', 'rate', 'price', 'price']);
  eq('sniff', sniffUnitColumns(['№', 'Этаж', 'Площадь', 'Цена', 'Номер']), { flat: 0, floor: 1, area: 2, price: 3 });
  const HEAD = ['№', 'Этаж', 'Площадь, м²', 'Комнат', 'Цена, ₾', 'Комментарий'];
  const t1 = unitTable([HEAD, ['12а', '3', '42,5', '1', '91 000', 'sea view'], ['13', '3', '58,3', '2', '120 000', '']]);
  eq('table rows', [t1.units, t1.problems, t1.ignored, t1.columns.price],
    [[{ flat: '12а', floor: 3, area: 42.5, price: 91000, rooms: 1 }, { flat: '13', floor: 3, area: 58.3, price: 120000, rooms: 2 }], [], ['Комментарий'], 'Цена, ₾']);
  eq('price from rate', [unitTable([['Кв', 'Площадь', 'Цена за м2'], ['1', '42,5', '1200']]).units[0].price, unitPrice(42.5, 1200)], [51000, 51000]);
  eq('own price beats rate', unitTable([['Кв', 'Площадь', 'Цена за м2', 'Цена'], ['1', '42,5', '1200', '49 900']]).units[0].price, 49900);
  eq('no header, no parse', [unitTable([['12а', '3', '42,5'], ['13', '3', '58,3']]).units, unitTable([['12а', '3', '42,5']]).columns], [[], {}]);
  const t2 = unitTable([HEAD, ['1', '2', '40', '1', '80000', ''], ['', '', '', '', 'Total: 80 000', '']]);
  eq('row without flat skipped and named', [t2.units.length, t2.problems.length, t2.problems[0].kind, t2.problems[0].line], [1, 1, 'no-flat', 3]);
  const t3 = unitTable([HEAD, ['1', '2', '40', '1', '80000', ''], ['Итого', '', '', '', '251 000', '']]);
  eq('Total in the flat column', [t3.units.length, t3.problems[0].kind, /Итого/.test(t3.problems[0].text)], [1, 'no-flat', true]);
  eq('flat numbers', ['12а', 'PH-1', 'Итого', 'Total for the building', ''].map(isFlatNumber), [true, true, false, false, false]);
  const t4 = unitTable([HEAD, ['12', '3', '40', '1', '80000', ''], ['12', '4', '41', '1', '81000', '']]);
  eq('duplicate flat', [t4.units.length, t4.problems[0].kind, /12/.test(t4.problems[0].text)], [1, 'dupe', true]);
  const t5 = unitTable([HEAD, ['1', '3', 'tbd', '1', '80000', '']]);
  eq('bad area drops the cell', [t5.units.length, t5.units[0].area, t5.problems[0].kind], [1, 0, 'no-area']);
  const many = [HEAD];
  for (let i = 1; i <= UNIT_GRID_MAX + 5; i++) many.push([String(i), '1', '40', '1', '80000', '']);
  const t6 = unitTable(many);
  eq('table cap', [t6.units.length, t6.problems.filter((p) => p.kind === 'over-limit').length], [UNIT_GRID_MAX, 5]);
  eq('empty tables', [unitTable([]).units, unitTable([[], ['', '']]).units, unitTable(null).units], [[], [], []]);
  eq('spreadsheet numbers', unitTable([['Квартира', 'Этаж', 'Площадь', 'Цена'], [12, 3, 42.5, 91000]]).units, [{ flat: '12', floor: 3, area: 42.5, price: 91000, rooms: 0 }]);
  const t7 = unitTable([['№', 'Этаж', 'Статус'], ['1', '2', 'Продана'], ['2', '2', 'reserved'], ['3', '2', '?']]);
  eq('status column', t7.units.map((x) => x.status || ''), ['sold', 'reserved', '']);
  eq('status words', ['Sold', 'бронь', '', 'нечто'].map(unitStatusOf), ['sold', 'reserved', '', '']);
  eq('blank rows keep line numbers', unitTable([HEAD, [], ['x', '1'], ['5', '1']]).problems[0].line, 3);
  const t8 = unitTableFromText('Flat;Floor;Area, m2;Price\r\n1;2;"42,5";91 000\r\n2;2;58;120000\r\n');
  eq('from text', [t8.units.length, t8.units[0], t8.columns.area], [2, { flat: '1', floor: 2, area: 42.5, price: 91000, rooms: 0 }, 'Area, m2']);
  const t9 = chessboard(unitTableFromText('Flat\tFloor\tStatus\n1\t1\tsold\n2\t2\tfree\n').units);
  eq('table -> chessboard', [t9.rows.map((r) => r.floor), t9.sold, t9.free], [[2, 1], 1, 1]);

  // --- rooms ------------------------------------------------------------------------------------------------------
  const r0 = normalizeRoom({ key: 'a', beds: 7, places: [{ type: 'double' }, { type: 'armchair', capacity: 0 }, { type: 'sofa', capacity: '3', note: { ru: 'разложить диван' } }] });
  eq('places beat beds', [r0.beds, r0.places[2].note, placeCapacity({ type: 'crib', label: '', capacity: null, note: {} })], [5, { ru: 'разложить диван' }, PLACE_TYPES.crib.cap]);
  eq('room needs a key', normalizeRoom({ name: 'x' }), null);
  const dd = normalizeRooms([{ key: 'k', name: { ru: 'Кухня' }, ord: 20 }, { key: 'b', name: { ru: 'Спальня' }, ord: 10 }, { key: 'k', name: { ru: 'Кухня-ниша' }, ord: 20 }]);
  eq('dedupe and order', [dd.map((r) => r.key), dd[1].name], [['b', 'k'], { ru: 'Кухня-ниша' }]);
  const sm = roomsSummary(normalizeRooms([{ key: 'bed1', type: 'bedroom', area: 14.3, beds: 2 }, { key: 'living', type: 'living', area: 20.4, beds: 1 }, { key: 'bath1', type: 'bath', area: 4 }]));
  eq('summary', [sm.rooms, sm.area, sm.capacity, sm.bath], [2, 38.7, 3, 1]);
  eq('unknown type is a room', roomsSummary(normalizeRooms([{ key: 'x', type: 'winter_garden' }])).rooms, 1);
  ok('service types are not rooms', ROOM_SERVICE_TYPES.every((t) => roomsSummary(normalizeRooms([{ key: 'x', type: t }])).rooms === 0));
  eq('empty area stays 0', roomsSummary(normalizeRooms([{ key: 'a', type: 'bedroom' }, { key: 'b', type: 'living' }])).area, 0);
  ok('toilet is a bathroom', ROOM_BATH_TYPES.includes('toilet') && ROOM_BATH_TYPES.every((b) => ROOM_SERVICE_TYPES.includes(b)));
  const tl = roomsSummary([{ key: 'a', type: 'bedroom', beds: 2 }, { key: 'b', type: 'toilet' }]);
  eq('toilet counted as bath', [tl.rooms, tl.bath], [1, 1]);
  const tree = normalizeRooms([{ key: 'hall', type: 'hall', ord: 1 }, { key: 'kitchen', type: 'kitchen', parent: 'hall', ord: 2 }, { key: 'nook', type: 'room', parent: 'kitchen', ord: 3 }, { key: 'lost', parent: 'nowhere', ord: 4 }, { key: 'self', parent: 'self', ord: 5 }]);
  const par = Object.fromEntries(tree.map((r) => [r.key, r.parent]));
  eq('two levels', [par.kitchen, par.nook, par.lost, par.self, roomZones(tree, 'hall').map((r) => r.key)], ['hall', '', '', '', ['kitchen']]);
  const sup = roomsSummary(normalizeRooms([
    { key: 'main', name: { ru: 'Зал с кухней' }, types: ['hall'], ord: 1 }, { key: 'hw', types: ['hallway'], parent: 'main', ord: 2 },
    { key: 'k', types: ['kitchen'], parent: 'main', ord: 3, places: [{ type: 'sofa' }] }, { key: 'bed', types: ['bedroom'], ord: 4, places: [{ type: 'double' }] },
    { key: 'wc', types: ['toilet'], ord: 5 }, { key: 'bal', types: ['balcony'], ord: 6 },
  ]));
  eq('hall + hallway + kitchen is one room', [sup.rooms, sup.bedrooms, sup.kitchens, sup.capacity, sup.bath], [2, 1, 1, 4, 1]);
  eq('lone kitchen not a room', [roomsSummary([{ key: 'k', types: ['kitchen'] }]).rooms, roomsSummary([{ key: 'k', types: ['kitchen', 'living'] }]).rooms, roomsSummary([{ key: 'k', types: ['kitchen'] }, { key: 'z', types: ['living'], parent: 'k' }]).rooms], [0, 1, 1]);
  eq('area not counted twice', [roomsSummary([{ key: 'm', area: 30 }, { key: 'z', parent: 'm', area: 12 }]).area, roomsSummary([{ key: 'm' }, { key: 'z1', parent: 'm', area: 12 }, { key: 'z2', parent: 'm', area: 8.5 }]).area], [30, 20.5]);
  eq('room keys from names', [roomKeyFromName('Спальня'), roomKeyFromName('Гостевой санузел'), roomKeyFromName('Спальня', ['spalnya']), roomKeyFromName('Спальня', ['spalnya', 'spalnya_2']), roomKeyFromName('🌴'), roomKeyFromName('', [], 'album')],
    ['spalnya', 'gostevoi_sanuzel', 'spalnya_2', 'spalnya_3', 'room', 'album']);
  eq('room labels', [roomLabel({ name: { ru: 'Спальня 2' }, type: 'bedroom' }, 'en'), roomLabel({ name: { en: 'Master bedroom' }, type: 'bedroom' }, 'en'), roomLabel({ type: 'kitchen' }, 'ka'), roomLabel({ name: { ru: 'Кухня-Гостиная' }, type: 'kitchen' }, 'en'), roomLabel({ name: { ru: 'Спальня' } }, 'en')],
    ['Bedroom 2', 'Master bedroom', 'სამზარეულო', 'Кухня-Гостиная', 'Спальня']);
  const R = (key, types, p = '') => ({ key, types, parent: p });
  const SUPER_HALL = [R('hall', ['hall']), R('hallway', ['hallway'], 'hall'), R('kitchen', ['kitchen'], 'hall')];
  const lay = (rooms) => roomsLayout(rooms).layout;
  eq('euro 1+1', [lay([...SUPER_HALL, R('bed', ['bedroom']), R('balcony', ['balcony']), R('bath', ['toilet'])]), roomsLayout([...SUPER_HALL, R('bed', ['bedroom'])]).size], ['apartments', 2]);
  eq('bedroom as a zone of the hall', lay([R('hall', ['hall']), R('kl', ['kitchen'], 'hall'), R('bed', ['bedroom'], 'hall'), R('bath', ['toilet']), R('balc', ['balcony'])]), 'apartments');
  eq('zone order does not matter', lay([R('hall', ['hall']), R('kitchen', ['kitchen'], 'hall'), R('hallway', ['hallway'], 'hall'), R('bed', ['bedroom']), R('bath', ['toilet'])]), 'apartments');
  const sep3 = roomsLayout([R('hall', ['hall']), R('hallway', ['hallway']), R('kitchen', ['kitchen']), R('b1', ['bedroom']), R('b2', ['bedroom']), R('bath', ['toilet']), R('balc', ['balcony'])]);
  eq('hall apart from the kitchen -> rooms', [sep3.layout, sep3.rooms], ['rooms', 3]);
  eq('untyped super room', lay([R('sa', []), R('hall', ['hall'], 'sa'), R('hallway', ['hallway'], 'sa'), R('kitchen', ['kitchen'], 'sa'), R('bed', ['bedroom']), R('bath', ['toilet'])]), 'apartments');
  eq('studio', lay([R('st', ['living', 'kitchen']), R('bath', ['bath'])]), 'studio');
  eq('untyped zone of a bedroom', lay([...SUPER_HALL, R('bed', ['bedroom']), R('nook', [], 'bed')]), 'apartments');
  eq('no rooms, no layout', [roomsLayout([]).layout, roomsLayout([R('bath', ['bath'])]).rooms], ['', 0]);
  ok('layout names', ['apartments', 'studio', 'rooms'].every((k) => ROOMS_LAYOUT_NAME[k].en && ROOMS_LAYOUT_NAME[k].ka));

  // --- scales -----------------------------------------------------------------------------------------------------
  eq('scale key', [cleanScaleKey('Euro'), cleanScaleKey('1bad')], ['euro', '']);
  const sc = normalizeScale({ key: 'near', mode: 'upto', steps: [{ at: '', name: 'далеко' }, { at: 800, name: 'рядом' }, { at: '300', name: 'близко' }, { at: null, name: 'второе иначе' }] });
  eq('steps sorted, one otherwise', [sc.steps.map((x) => x.at), sc.steps[2].name.ru], [[300, 800, null], 'далеко']);
  eq('invalid scales', [normalizeScale({ key: 'x', steps: [] }), normalizeScale({ key: 'x', steps: [{ at: 'abc', name: 'a' }] })], [null, null]);
  const near = normalizeScale({ key: 'near', mode: 'upto', steps: [{ at: 300, name: { ru: 'близко', en: 'close' } }, { at: 800, name: 'рядом' }, { at: null, name: 'далеко' }] });
  eq('up to N inclusive', [scaleWord(near, 300, 'ru'), scaleWord(near, 301, 'ru'), scaleWord(near, 5000, 'ru'), scaleWord(near, 120, 'en'), scaleWord(near, 500, 'en'), scaleStepIndex(near, ''), scaleWord(near, 'abc')],
    ['близко', 'рядом', 'далеко', 'close', 'рядом', -1, '']);
  eq('euro words', [scaleWord(EURO_SCALE, 2, 'ru'), scaleWord(EURO_SCALE, 7, 'ru'), scaleWord(EURO_SCALE, 2), scaleWord(EURO_SCALE, 9, 'en'), scaleWord(EURO_SCALE, roomsLayout([...SUPER_HALL, R('bed', ['bedroom'])]).size, 'ru')],
    ['Евродвушка', 'Евро7-комн.', 'Euro 1+1', 'Euro 9-room', 'Евродвушка']);
  eq('exact without otherwise', scaleWord(normalizeScale({ key: 'e', steps: [{ at: 1, name: 'one' }] }), 2), '');
  const root = normalizeScales([EURO_SCALE, { key: 'near', steps: [{ at: 1, name: 'a' }] }]);
  const leaf = normalizeScales([{ key: 'euro', steps: [{ at: 1, name: 'own' }] }]);
  const merged = mergeScales([root, leaf]);
  eq('merge by key', [merged.length, scaleWord(merged.find((x) => x.key === 'euro'), 1), normalizeScales([EURO_SCALE, EURO_SCALE]).length], [2, 'own', 1]);

  console.log(`estate: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
