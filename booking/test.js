// booking/test.js - unit tests of the booking library: `node booking/test.js` (importing the module runs nothing).
// Day arithmetic across DST switches and leap years, half-open stays and conflicts, merged intervals and free gaps,
// the occupancy calendar, availability ranking, departures with seats, the rate cascade (base, weekday, season),
// minimum stays, length-of-stay discounts, fees and quote refusals in minor units, the lead funnel and viewing slots,
// handovers and rights, blind mutual reviews, auctions with reserve, ceiling, terms lock and rounds, and iCalendar
// round trips.
//
// Every function under test takes "today" / "now" as an argument, so the suite is deterministic: no fake timers, no
// dependence on the machine's time zone. DST and leap-year cases are explicit vectors because they are exactly the
// days on which Date-based code fails in production and passes in a test written in summer.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cmpDay, dayAdd, dayIso, dayNum, daysInMonth, eachDay, isDay, isWeekend, maxDay, minDay, monthAdd, monthGrid, monthStart,
  nightsBetween, weekday,
} from './days.js';
import {
  BLOCKING_STATUSES, availFacts, availOrder, availRank, blockingStays, busyDays, departureFree, departureSoldOut, firstFree,
  freeGaps, mergeStays, normalizeDeparture, normalizeDepartures, occupancy, occupancyCalendar, rangesOverlap, seatsByDay,
  statusBlocks, stayConflicts, stayOk, staysOverlap, upcomingDepartures,
} from './stays.js';
import {
  MONTH_NIGHTS, QUOTE_ERRORS, QUOTE_ERROR_TEXT, baseNightly, blockedStays, feeAmount, lengthDiscountPct, minNightsFor,
  nightlyRate, normalizeCalRule, prepayment, priceCalendar, quoteStay,
} from './rates.js';
import {
  DEAL_ALWAYS, DEAL_FLOW_ALL, DEAL_NEXT, DEAL_OPEN, DEAL_STATUSES, DEAL_STATUS_I18N, SHOW_MINUTES, SHOW_MINUTES_MAX,
  cleanShowAt, dealCanGo, dealConversion, dealFlowOf, dealFunnel, dealLabel, dealNameKey, dealNext, dealOnKey, dealOpen,
  dealOpenCount, freeShowSlots, isDealStatus, minuteNum, normalizeShow, showBusy, showConflicts, showDay, showMinutes,
  showsOverlap,
} from './deal.js';
import {
  HANDOVER_RIGHTS, HANDOVER_RIGHT_I18N, HANDOVER_STATUSES, HANDOVER_STATUS_I18N, applyHandover, canReclaim, createHandover,
  handoverActions, handoverAllows, handoverIsOpen, handoverManager, handoverNext, normalizeRights, rightOfKey, stateRight,
} from './handover.js';
import {
  BLIND_DAYS, EMPTY_REP, REP_WORDS, REVIEW_REASON_TEXT, averageStars, canReview, faceKey, faceRep, parseFaceKey, plural,
  repLine, replySpeedMinutes, replySpeedText, reviewRevealed, sameFace, submitReview,
} from './reviews.js';
import {
  auctionLive, auctionOutcome, auctionState, auctionTermsChanged, auctionTop, bidCeiling, bidRefusal, bidWithdrawable,
  nextBid, normalizeAuction, publicTerms, restartAuction, roundBids, settleBids,
} from './auction.js';
import { icsEscape, icsToStays, icsUnescape, staysToIcs } from './ics.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const ok = (name, cond) => eq(name, !!cond, true);

  // --- days -------------------------------------------------------------------------------------------------------
  ok('isDay', isDay('2026-08-16') && isDay('2024-02-29'));
  eq('isDay rejects', ['2026-02-31', '2026-13-01', '2026-8-16', '', null, '2026-08-16T10:00'].map(isDay), [false, false, false, false, false, false]);
  // Last Sunday of March / October: European DST switches.
  eq('dst spring', [dayAdd('2026-03-28', 1), dayAdd('2026-03-29', 1), nightsBetween('2026-03-28', '2026-03-30')], ['2026-03-29', '2026-03-30', 2]);
  eq('dst autumn', dayAdd('2026-10-25', 1), '2026-10-26');
  for (const d of ['2026-01-01', '2025-12-31', '2026-08-16', '2024-02-29', '1999-12-31', '2100-03-01']) eq('dayNum round ' + d, dayIso(dayNum(d)), d);
  let walk = '2023-12-25', okWalk = true;
  for (let i = 0; i < 800; i++) { const nx = dayAdd(walk, 1); if (nightsBetween(walk, nx) !== 1 || !isDay(nx)) okWalk = false; walk = nx; }
  ok('800 consecutive days', okWalk && walk === dayAdd('2023-12-25', 800));
  eq('dayAdd negative / invalid', [dayAdd('2026-03-01', -1), dayAdd('2024-03-01', -1), dayAdd('nope', 1)], ['2026-02-28', '2024-02-29', '']);
  eq('monthAdd clamps', [monthAdd('2026-01-31', 1), monthAdd('2024-01-31', 1), monthAdd('2026-12-15', 1), monthAdd('2026-03-31', -1)], ['2026-02-28', '2024-02-29', '2027-01-15', '2026-02-28']);
  eq('eachDay without check-out', eachDay('2026-08-10', '2026-08-13'), ['2026-08-10', '2026-08-11', '2026-08-12']);
  eq('eachDay zero / reversed', [eachDay('2026-08-10', '2026-08-10'), eachDay('2026-08-12', '2026-08-10')], [[], []]);
  eq('eachDay cap', eachDay('2026-01-01', '2036-01-01').length, 1826);
  eq('daysInMonth', ['2026-02', '2024-02', '2026-08', '2026-04', '2026-12', '1900-02', '2000-02', 'x'].map(daysInMonth), [28, 29, 31, 30, 31, 28, 29, 0]);
  eq('weekday monday', [weekday('2026-08-17'), weekday('2026-08-16'), weekday('1970-01-01')], [0, 6, 3]);
  ok('weekend', isWeekend('2026-08-15') && isWeekend('2026-08-16') && !isWeekend('2026-08-17'));
  ok('custom weekend', isWeekend('2026-08-14', [4, 5]) && !isWeekend('2026-08-16', [4, 5]));
  eq('monthStart', monthStart('2026-08-16'), '2026-08-01');
  eq('cmp / min / max', [cmpDay('2026-01-02', '2026-01-01'), cmpDay('2026-01-01', '2026-01-01'), minDay('2026-05-01', 'x', '2026-01-01'), maxDay('2026-05-01', '2026-01-01')], [1, 0, '2026-01-01', '2026-05-01']);
  const grid = monthGrid('2026-08');
  eq('grid aug 2026', [grid.length, grid[0], grid[5][0]], [6, [null, null, null, null, null, '2026-08-01', '2026-08-02'], '2026-08-31']);
  eq('grid sunday start', monthGrid('2026-08', { weekStart: 6 })[0].slice(5), [null, '2026-08-01']);
  eq('grid feb 2027 fits 4 weeks', monthGrid('2021-02').length, 4);

  // --- stays ------------------------------------------------------------------------------------------------------
  eq('only confirmed blocks', ['confirmed', 'pending', 'declined', 'cancelled', 'other'].map(statusBlocks), [true, false, false, false, false]);
  eq('blocking list', BLOCKING_STATUSES, ['confirmed']);
  const sa = { from: '2026-08-10', to: '2026-08-12' }, sb = { from: '2026-08-12', to: '2026-08-14' };
  ok('check-out day is free', !staysOverlap(sa, sb) && !staysOverlap(sb, sa));
  ok('one common night', staysOverlap({ from: '2026-08-10', to: '2026-08-13' }, sb));
  ok('nested overlaps', staysOverlap({ from: '2026-08-01', to: '2026-08-31' }, sa) && staysOverlap(sa, { from: '2026-08-01', to: '2026-08-31' }));
  ok('rangesOverlap', rangesOverlap(0, 2, 1, 3) && !rangesOverlap(0, 2, 2, 4));
  eq('stayOk', [sa, { from: '2026-08-10', to: '2026-08-10' }, { from: '2026-08-12', to: '2026-08-10' }, { from: 'x', to: '2026-08-10' }, null].map(stayOk), [true, false, false, false, false]);
  eq('busyDays', busyDays([sa, { from: '2026-08-11', to: '2026-08-13' }, { from: 'x', to: 'y' }]), ['2026-08-10', '2026-08-11', '2026-08-12']);
  const conf = stayConflicts({ from: '2026-08-10', to: '2026-08-15' }, [{ from: '2026-08-01', to: '2026-08-03' }, { from: '2026-08-12', to: '2026-08-14' }]);
  eq('conflicts name the culprit', conf, [{ from: '2026-08-12', to: '2026-08-14' }]);
  eq('blockingStays', blockingStays([{ ...sa, status: 'pending' }, { ...sb, status: 'confirmed' }, { from: '2026-09-01', to: '2026-09-02' }]).length, 2);
  eq('merge', mergeStays([sb, sa, { from: '2026-08-20', to: '2026-08-22' }, { from: '2026-08-21', to: '2026-08-25' }]), [{ from: '2026-08-10', to: '2026-08-14' }, { from: '2026-08-20', to: '2026-08-25' }]);
  eq('gaps', freeGaps([sa, { from: '2026-08-20', to: '2026-08-22' }], '2026-08-01', '2026-08-31'), [{ from: '2026-08-01', to: '2026-08-10' }, { from: '2026-08-12', to: '2026-08-20' }, { from: '2026-08-22', to: '2026-08-31' }]);
  eq('gaps clipped', freeGaps([{ from: '2026-07-25', to: '2026-08-05' }], '2026-08-01', '2026-08-10'), [{ from: '2026-08-05', to: '2026-08-10' }]);
  eq('first free 3 nights', firstFree([{ from: '2026-08-01', to: '2026-08-05' }, { from: '2026-08-07', to: '2026-08-20' }], { from: '2026-08-01', nights: 3 }), { from: '2026-08-20', to: '2026-08-23' });
  eq('first free fits gap', firstFree([{ from: '2026-08-01', to: '2026-08-05' }, { from: '2026-08-07', to: '2026-08-20' }], { from: '2026-08-01', nights: 2 }), { from: '2026-08-05', to: '2026-08-07' });
  eq('first free none', firstFree([{ from: '2026-08-01', to: '2027-12-01' }], { from: '2026-08-01', nights: 2, until: '2026-12-01' }), null);
  eq('occupancy', occupancy([sa, sb, { from: '2026-07-20', to: '2026-08-02' }], '2026-08-01', '2026-08-11'), { nights: 10, busy: 2, free: 8, rate: 0.2 });
  const cal = occupancyCalendar('2026-08', {
    today: '2026-08-05',
    bookings: [{ id: 1, from: '2026-08-02', to: '2026-08-04', status: 'confirmed' }, { id: 2, from: '2026-08-10', to: '2026-08-12', status: 'confirmed' },
      { id: 3, from: '2026-08-11', to: '2026-08-14', status: 'pending' }],
    blocks: [{ from: '2026-08-20', to: '2026-08-22' }],
  });
  const st = (d) => cal.find((c) => c.day === d);
  eq('cal length', cal.length, 31);
  eq('cal past / booked history', [st('2026-08-01').state, st('2026-08-02').state, st('2026-08-04').state], ['past', 'busy', 'past']);
  eq('cal checkin / checkout', [st('2026-08-10').checkIn, st('2026-08-12').checkOut, st('2026-08-12').state], [true, true, 'pending']);
  eq('cal pending never busy', [st('2026-08-11').state, st('2026-08-11').ids, st('2026-08-13').state], ['busy', [2, 3], 'pending']);
  eq('cal blocked', [st('2026-08-20').state, st('2026-08-22').state], ['blocked', 'free']);
  eq('availFacts', availFacts([{ from: '2026-08-01', to: '2026-08-10', status: 'confirmed' }, { from: '2026-08-20', to: '2026-08-25', status: 'pending' },
    { from: '2026-07-01', to: '2026-07-05', status: 'confirmed' }, { from: '2026-09-01', to: '2026-09-05', status: 'confirmed' }], '2026-08-05'), { until: '2026-08-10', confirmed: 2, pending: 1 });
  const now = '2026-08-05T12:00:00Z';
  eq('availRank', [availRank('free', '', '2026-08-01', 21, now), availRank('free', '', '2026-01-01', 21, now), availRank('free', '2026-08-09', '', 21, now), availRank('busy', '', '2026-08-01', 21, now)], [0, 1, 2, 3]);
  const lots = [
    { id: 'busy', state: 'busy', createdAt: '2026-08-04' },
    { id: 'old', state: 'free', createdAt: '2026-01-01' },
    { id: 'soon2', state: 'free', createdAt: '2026-08-01', bookings: [{ from: '2026-08-01', to: '2026-08-12', status: 'confirmed' }] },
    { id: 'new', state: 'free', createdAt: '2026-08-03' },
    { id: 'soon1', state: 'free', createdAt: '2026-02-01', bookings: [{ from: '2026-08-01', to: '2026-08-08', status: 'confirmed' }] },
    { id: 'pending', state: 'free', createdAt: '2026-01-02', bookings: [{ from: '2026-08-01', to: '2026-08-08', status: 'pending' }] },
  ];
  eq('availOrder', availOrder(lots, { today: '2026-08-05' }).map((l) => l.id), ['new', 'pending', 'old', 'soon1', 'soon2', 'busy']);
  // Departures: a seat is a number.
  const dep = (day, seats = 0, price = 0) => ({ day, seats, price });
  eq('seats', [departureFree(dep('2026-07-10', 12), 0), departureFree(dep('2026-07-10', 12), 1), departureFree(dep('2026-07-10', 12), 12)], [12, 11, 0]);
  eq('sold out', [departureSoldOut(dep('2026-07-10', 12), 12), departureSoldOut(dep('2026-07-10', 12), 11)], [true, false]);
  eq('overbooked / garbage taken', [departureFree(dep('2026-07-10', 12), 40), departureFree(dep('2026-07-10', 12), -5)], [0, 12]);
  eq('no capacity', [departureFree(dep('2026-07-10'), 3), departureSoldOut(dep('2026-07-10'), 999)], [null, false]);
  eq('departure needs a day', [normalizeDeparture({ seats: 10 }), normalizeDeparture({ day: '2026-02-31' }), normalizeDeparture(null)], [null, null, null]);
  const deps = normalizeDepartures([{ day: '2026-08-01', seats: 8 }, 'junk', { day: 'no', seats: 5 }, { day: '2026-07-10', seats: 9999, price: -3 }]);
  eq('departures normalized', deps, [{ day: '2026-07-10', seats: 999, price: 0 }, { day: '2026-08-01', seats: 8, price: 0 }]);
  eq('same day: last wins', normalizeDepartures([{ day: '2026-07-10', seats: 8 }, { day: '2026-07-10', seats: 12 }]), [{ day: '2026-07-10', seats: 12, price: 0 }]);
  const dl = normalizeDepartures([{ day: '2026-06-01', seats: 4 }, { day: '2026-07-10', seats: 4 }, { day: '2026-07-20', seats: 4 }, { day: '2026-08-01', seats: 4 }]);
  eq('upcoming keeps today', upcomingDepartures(dl, '2026-07-10', 2).map((x) => x.day), ['2026-07-10', '2026-07-20']);
  eq('upcoming after season', [upcomingDepartures(dl, '2026-12-01').length, dl.length], [0, 4]);
  eq('seatsByDay sums guests', [...seatsByDay([{ from: '2026-07-10', to: '2026-07-14', guests: 4, status: 'confirmed' }, { from: '2026-07-10', guests: 2, status: 'pending' },
    { from: '2026-07-10', status: 'confirmed' }, { from: '2026-07-20', guests: 3 }])], [['2026-07-10', 5], ['2026-07-20', 3]]);

  // --- rates ------------------------------------------------------------------------------------------------------
  eq('rule ok', normalizeCalRule({ kind: 'price', from: '2026-07-01', to: '2026-09-01', price: '12000', minNights: '3' }), { kind: 'price', from: '2026-07-01', to: '2026-09-01', price: 12000, minNights: 3 });
  eq('rule garbage', [normalizeCalRule({ kind: 'season', from: '2026-07-01', to: '2026-08-01' }), normalizeCalRule({ kind: 'price', from: 'no', to: '2026-08-01', price: 10 }),
    normalizeCalRule({ kind: 'price', from: '2026-07-01', to: '2026-08-01' })], [null, null, null]);
  eq('zero is a price', normalizeCalRule({ kind: 'price', from: '2026-07-01', to: '2026-08-01', price: 0 }).price, 0);
  eq('reversed swapped', normalizeCalRule({ kind: 'block', from: '2026-09-01', to: '2026-07-01' }), { kind: 'block', from: '2026-07-01', to: '2026-09-01' });
  eq('zero nights dropped', normalizeCalRule({ kind: 'block', from: '2026-07-01', to: '2026-07-01' }), null);
  eq('weekdays cleaned', normalizeCalRule({ kind: 'price', from: '2026-07-01', to: '2026-08-01', price: 1, weekdays: [6, 5, 5, 9, 'x'] }).weekdays, [5, 6]);
  eq('all weekdays = none', normalizeCalRule({ kind: 'price', from: '2026-07-01', to: '2026-08-01', price: 1, weekdays: [0, 1, 2, 3, 4, 5, 6] }).weekdays, undefined);
  eq('blockedStays', blockedStays([normalizeCalRule({ kind: 'price', from: '2026-07-01', to: '2026-09-01', price: 100 }), normalizeCalRule({ kind: 'block', from: '2026-08-05', to: '2026-08-08' })]), [{ from: '2026-08-05', to: '2026-08-08' }]);
  eq('baseNightly', [baseNightly(90000, 'month'), baseNightly(5000, 'day'), baseNightly(5000), baseNightly(70000, 'week'), baseNightly(100000, 'month'), MONTH_NIGHTS], [3000, 5000, 5000, 10000, 3333, 30]);
  const summer = [normalizeCalRule({ kind: 'price', from: '2026-07-01', to: '2026-09-01', price: 12000 })];
  eq('season boundaries', ['2026-06-30', '2026-07-01', '2026-08-31', '2026-09-01'].map((d) => nightlyRate(d, 8000, summer).price), [8000, 12000, 12000, 8000]);
  eq('season source', nightlyRate('2026-07-05', 8000, summer).rule, 'season');
  const two = [normalizeCalRule({ kind: 'price', from: '2026-07-01', to: '2026-09-01', price: 12000, id: 1 }), normalizeCalRule({ kind: 'price', from: '2026-08-01', to: '2026-08-08', price: 20000, id: 2 })];
  eq('last rule wins', [nightlyRate('2026-08-03', 8000, two).price, nightlyRate('2026-08-03', 8000, two).ruleId, nightlyRate('2026-08-03', 8000, [two[1], two[0]]).price], [20000, 2, 12000]);
  // 2026-08-14 is a Friday (4), 2026-08-15 a Saturday (5).
  const wr = { 4: 9000, 5: 9000 };
  eq('weekday rate', [nightlyRate('2026-06-12', 8000, [], wr), nightlyRate('2026-06-11', 8000, [], wr).rule], [{ day: '2026-06-12', price: 9000, rule: 'weekday' }, 'base']);
  const summerWeekend = [...summer, normalizeCalRule({ kind: 'price', from: '2026-07-01', to: '2026-09-01', price: 15000, weekdays: [4, 5] })];
  eq('season weekend rule', ['2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16'].map((d) => nightlyRate(d, 8000, summerWeekend, wr).price), [12000, 15000, 15000, 12000]);
  const ny = [normalizeCalRule({ kind: 'price', from: '2026-12-28', to: '2027-01-08', price: 30000, minNights: 5 })];
  eq('min nights of arrival', [minNightsFor('2026-12-30', 2, ny), minNightsFor('2026-12-01', 2, ny), minNightsFor('2026-12-01', 0, [])], [5, 2, 0]);
  const ds = [{ nights: 7, pct: 10 }, { nights: 28, pct: 25 }];
  eq('LOS discount', [lengthDiscountPct(3, ds), lengthDiscountPct(7, ds), lengthDiscountPct(30, ds), lengthDiscountPct(30, [ds[1], ds[0]]), lengthDiscountPct(30, [{ nights: 7, pct: 999 }])], [0, 10, 25, 25, 90]);
  eq('fees', [feeAmount({ amount: 3000 }, 4, 2), feeAmount({ amount: 100, per: 'night' }, 4), feeAmount({ amount: 200, per: 'guest_night' }, 3, 4),
    feeAmount({ amount: 1000, per: 'guest', after: 2 }, 3, 4), feeAmount({ amount: 1000, per: 'guest', after: 5 }, 3, 4), feeAmount({ amount: -5 }, 1)], [3000, 400, 2400, 2000, 0, 0]);
  const B = { base: 10000, per: 'day', currency: 'GEL', today: '2026-06-01' };
  const q1 = quoteStay({ ...B, from: '2026-06-10', to: '2026-06-13' });
  eq('simple quote', [q1.ok, q1.nights, q1.nightly.length, q1.subtotal, q1.total, q1.currency], [true, 3, 3, 30000, 30000, 'GEL']);
  const q2 = quoteStay({ ...B, from: '2026-06-29', to: '2026-07-03', rules: [normalizeCalRule({ kind: 'price', from: '2026-07-01', to: '2026-09-01', price: 20000 })] });
  eq('per-night across seasons', [q2.ok, q2.nights, q2.nightly.map((n) => n.price), q2.subtotal], [true, 4, [10000, 10000, 20000, 20000], 60000]);
  const q3 = quoteStay({ ...B, from: '2026-06-10', to: '2026-06-20', discounts: [{ nights: 7, pct: 10 }] });
  eq('discount on the sum', [q3.nights, q3.subtotal, q3.discountPct, q3.discount, q3.total], [10, 100000, 10, 10000, 90000]);
  eq('refusal order', [
    quoteStay({ ...B, from: '', to: '' }).error, quoteStay({ ...B, from: '2026-06-13', to: '2026-06-10' }).error, quoteStay({ ...B, from: '2026-05-10', to: '2026-05-13' }).error,
    quoteStay({ ...B, from: '2026-06-10', to: '2026-06-11', minNights: 3 }).error, quoteStay({ ...B, from: '2026-06-10', to: '2026-07-20', maxNights: 14 }).error,
    quoteStay({ ...B, from: '2026-06-10', to: '2026-06-13', guests: 9, guestsMax: 4 }).error,
  ], ['bad_range', 'bad_range', 'past', 'too_short', 'too_long', 'guests']);
  ok('max 0 is unlimited', quoteStay({ ...B, from: '2026-06-10', to: '2026-12-10', maxNights: 0 }).ok);
  eq('blocked vs busy', quoteStay({ ...B, from: '2026-06-10', to: '2026-06-13', rules: [normalizeCalRule({ kind: 'block', from: '2026-06-10', to: '2026-06-12' })] }).error, 'blocked');
  const qb = quoteStay({ ...B, from: '2026-06-10', to: '2026-06-13', busy: [{ from: '2026-06-10', to: '2026-06-12' }] });
  eq('busy names conflict', [qb.error, qb.conflicts.length], ['busy', 1]);
  ok('pending does not block a quote', quoteStay({ ...B, from: '2026-06-10', to: '2026-06-13', busy: [{ from: '2026-06-10', to: '2026-06-12', status: 'pending' }] }).ok);
  ok('back-to-back passes', quoteStay({ ...B, from: '2026-06-10', to: '2026-06-13', busy: [{ from: '2026-06-07', to: '2026-06-10' }] }).ok);
  eq('no price', quoteStay({ ...B, base: 0, from: '2026-06-10', to: '2026-06-13' }).error, 'no_price');
  eq('season price without base', quoteStay({ ...B, base: 0, from: '2026-06-10', to: '2026-06-13', rules: [normalizeCalRule({ kind: 'price', from: '2026-06-01', to: '2026-07-01', price: 9000 })] }).total, 27000);
  const qs = quoteStay({ ...B, from: '2026-06-10', to: '2026-06-11', minNights: 3 });
  eq('refusal carries nights and minimum', [qs.ok, qs.nights, qs.minNights], [false, 1, 3]);
  ok('every error has a text', QUOTE_ERRORS.every((k) => QUOTE_ERROR_TEXT[k] && QUOTE_ERROR_TEXT[k].length > 5));
  eq('monthly base', quoteStay({ from: '2026-06-10', to: '2026-06-20', base: 90000, per: 'month', today: '2026-06-01' }).subtotal, 30000);
  const qf = quoteStay({ ...B, from: '2026-06-10', to: '2026-06-17', guests: 3, discounts: [{ nights: 7, pct: 10 }], cleaning: 4000, deposit: 20000,
    fees: [{ name: 'tourist tax', amount: 100, per: 'guest_night' }, { name: 'extra guest', amount: 1500, per: 'night', after: 2 }] });
  eq('fees after discount', [qf.subtotal, qf.discount, qf.fees, qf.feesTotal, qf.total, qf.deposit],
    [70000, 7000, [{ name: 'cleaning', amount: 4000 }, { name: 'tourist tax', amount: 2100 }, { name: 'extra guest', amount: 10500 }], 16600, 79600, 20000]);
  eq('weekday rates in a quote', quoteStay({ ...B, from: '2026-06-11', to: '2026-06-14', weekdayRates: wr }).nightly.map((n) => n.price), [10000, 9000, 9000]);
  eq('integer totals', Number.isInteger(quoteStay({ ...B, base: 3333, from: '2026-06-10', to: '2026-06-17', discounts: [{ nights: 7, pct: 7.5 }] }).total), true);
  const pc = priceCalendar('2026-08', { base: 8000, rules: [...summerWeekend, normalizeCalRule({ kind: 'block', from: '2026-08-20', to: '2026-08-22' }), normalizeCalRule({ kind: 'price', from: '2026-08-25', to: '2026-09-01', price: 11000, minNights: 4 })], minNights: 2 });
  eq('price calendar', [pc.length, pc[2].price, pc[13].price, pc[19].blocked, pc[21].blocked, pc[24].minNights, pc[23].minNights], [31, 12000, 15000, true, false, 4, 2]);
  eq('prepayment', [prepayment(79600, 30), prepayment(1001, 50), prepayment(100, 150)], [{ now: 23880, later: 55720 }, { now: 501, later: 500 }, { now: 100, later: 0 }]);

  // --- deal -------------------------------------------------------------------------------------------------------
  eq('deal statuses', DEAL_STATUSES, ['new', 'show', 'shown', 'thinking', 'deal', 'refused', 'closed']);
  eq('deal status check', ['show', 'viewed', '', null].map(isDealStatus), [true, false, false, false]);
  eq('open / closed', [DEAL_OPEN, DEAL_STATUSES.filter((s) => !dealOpen(s))], [['new', 'show', 'shown', 'thinking'], ['deal', 'refused', 'closed']]);
  ok('labels everywhere', DEAL_STATUSES.every((s) => ['en', 'ru', 'ka'].every((l) => String(DEAL_STATUS_I18N[s][l] || '').trim())));
  ok('transitions valid, no self loops', DEAL_STATUSES.every((s) => DEAL_NEXT[s] && DEAL_NEXT[s].every((to) => isDealStatus(to) && to !== s)));
  eq('closed only reopen', [DEAL_NEXT.refused, DEAL_NEXT.closed, DEAL_NEXT.deal.includes('closed'), DEAL_NEXT.deal.includes('new')], [['new'], ['new'], true, true]);
  ok('second viewing from open', dealCanGo('shown', 'show') && dealCanGo('thinking', 'show') && dealCanGo('new', 'shown'));
  eq('default flow', [dealFlowOf(undefined).on, dealFlowOf(undefined).names, dealFlowOf({}).on], [DEAL_STATUSES, {}, DEAL_STATUSES]);
  const f1 = dealFlowOf({ [dealOnKey('thinking')]: false, [dealOnKey('show')]: false });
  ok('switched off', !f1.on.includes('thinking') && !f1.on.includes('show') && DEAL_ALWAYS.every((s) => f1.on.includes(s)));
  const hard = dealFlowOf({ [dealOnKey('new')]: false, [dealOnKey('closed')]: false });
  ok('entry and exit stay', hard.on.includes('new') && hard.on.includes('closed'));
  const f2 = dealFlowOf({ [dealOnKey('show')]: false });
  eq('no transition into off step', [dealCanGo('new', 'show', f2), dealCanGo('new', 'shown', f2), dealCanGo('new', 'show', DEAL_FLOW_ALL)], [false, true, true]);
  const f3 = dealFlowOf({ [dealNameKey('show')]: { ru: 'Просмотр назначен', en: '' } });
  eq('rename fallback', [dealLabel('show', f3, 'ru'), dealLabel('show', f3, 'en'), dealLabel('shown', f3, 'ka'), dealLabel('show', f3, 'xx'), dealLabel('show')],
    ['Просмотр назначен', 'Viewing set', DEAL_STATUS_I18N.shown.ka, 'Viewing set', 'Viewing set']);
  eq('rename english own fallback', dealLabel('show', dealFlowOf({ [dealNameKey('show')]: { en: 'Visit booked' } }), 'xx'), 'Visit booked');
  const f4 = dealFlowOf({ [dealNameKey('deal')]: { ru: '   ', en: 'Won' } });
  eq('empty names dropped', [f4.names.deal, dealLabel('deal', f4, 'ru')], [{ en: 'Won' }, DEAL_STATUS_I18N.deal.ru]);
  const nx = dealNext('new');
  ok('buttons in registry order', JSON.stringify(nx) === JSON.stringify(DEAL_STATUSES.filter((s) => nx.includes(s))) && !nx.includes('new'));
  const sts = ['new', 'new', 'show', 'shown', 'deal', 'refused', 'refused'];
  const fn = dealFunnel(sts);
  eq('funnel', [fn.reduce((s, r) => s + r.n, 0), fn.find((r) => r.status === 'new').n, fn.find((r) => r.status === 'refused').n, fn.find((r) => r.status === 'thinking').n], [7, 2, 2, 0]);
  const fj = dealFunnel(['new', 'whatever', '', null]);
  eq('junk counts as new', [fj.reduce((s, r) => s + r.n, 0), fj.find((r) => r.status === 'new').n], [4, 4]);
  const foff = dealFlowOf({ [dealOnKey('thinking')]: false });
  eq('off step with leads stays', [dealFunnel(['new', 'thinking'], foff).some((r) => r.status === 'thinking'), dealFunnel(['new'], foff).some((r) => r.status === 'thinking')], [true, false]);
  const so = ['new', 'show', 'deal', 'refused', 'thinking'];
  eq('open count', [dealOpenCount(so), dealFunnel(so).filter((r) => r.open).reduce((s, r) => s + r.n, 0), dealOpenCount([])], [3, 3, 0]);
  eq('conversion', dealConversion(['new', 'shown', 'thinking', 'deal', 'refused']), { leads: 5, shown: 3, deals: 1, showRate: 0.6, dealRate: 0.2 });
  eq('show at', ['2026-09-01T15:30', '2026-09-01 15:30', '2026-09-01T15:30:45', '2026-02-31T10:00', '2026-09-01T25:00', '2026-09-01', ''].map(cleanShowAt),
    ['2026-09-01T15:30', '2026-09-01T15:30', '2026-09-01T15:30', '', '', '', '']);
  eq('show minutes', [showMinutes(undefined), showMinutes(0), showMinutes(3), showMinutes(45), showMinutes(10000)], [SHOW_MINUTES, SHOW_MINUTES, SHOW_MINUTES, 45, SHOW_MINUTES_MAX]);
  eq('slot without time', [normalizeShow({ minutes: 30, agent: 'ann' }), normalizeShow(null)], [null, null]);
  const sl = normalizeShow({ at: '2026-09-01T15:00', minutes: 45, agent: '  ANN ' });
  eq('slot normalized', [sl, showDay(sl)], [{ at: '2026-09-01T15:00', minutes: 45, agent: 'ann' }, '2026-09-01']);
  eq('minute axis', [minuteNum('2026-03-29T00:30') - minuteNum('2026-03-28T23:30'), minuteNum('2026-09-01T00:00') % 1440, Number.isFinite(minuteNum('junk'))], [60, 0, false]);
  const va = { at: '2026-09-01T15:00', minutes: 30 }, vb = { at: '2026-09-01T15:30', minutes: 30 }, vc = { at: '2026-09-01T15:15', minutes: 30 };
  eq('show overlap', [showsOverlap(va, vb), showsOverlap(va, vc), showsOverlap(vc, va)], [false, true, true]);
  const taken = [{ id: 1, at: '2026-09-01T15:00', minutes: 60, agent: 'ann' }, { id: 2, at: '2026-09-01T15:00', minutes: 60, agent: 'bob' }];
  const want = normalizeShow({ at: '2026-09-01T15:30', minutes: 30, agent: 'ann' });
  eq('same agent only', [showConflicts(want, taken).map((s) => s.id), showConflicts({ ...want, agent: 'kate' }, taken), showConflicts({ at: '2026-09-01T15:30', minutes: 30 }, taken)], [[1], [], []]);
  const t7 = [{ id: 7, at: '2026-09-01T15:00', minutes: 60, agent: 'ann' }];
  eq('moving itself', [showConflicts({ id: 7, at: '2026-09-01T15:30', minutes: 60, agent: 'ann' }, t7).length, showConflicts({ id: 8, at: '2026-09-01T15:30', minutes: 60, agent: 'ann' }, t7).length], [0, 1]);
  const occ = [{ from: '2026-09-01', to: '2026-09-04' }];
  eq('show busy', [showBusy(normalizeShow({ at: '2026-09-02T12:00' }), occ).length, showBusy(normalizeShow({ at: '2026-09-04T12:00' }), occ).length, showBusy(null, occ), showBusy(normalizeShow({ at: '2026-09-02T12:00' }), [])], [1, 0, [], []]);
  eq('free slots', freeShowSlots('2026-09-01', taken, { agent: 'ann', from: '14:00', to: '17:00', minutes: 30, step: 30 }), ['2026-09-01T14:00', '2026-09-01T14:30', '2026-09-01T16:00', '2026-09-01T16:30']);
  eq('free slots any agent', freeShowSlots('2026-09-01', taken, { from: '15:00', to: '17:00', minutes: 60, step: 60 }), ['2026-09-01T16:00']);

  // --- handover ---------------------------------------------------------------------------------------------------
  eq('offer answers', [handoverNext('offered', 'accept', 'to'), handoverNext('offered', 'decline', 'to'), handoverNext('offered', 'withdraw', 'from'),
    handoverNext('offered', 'accept', 'from'), handoverNext('offered', 'withdraw', 'to'), handoverNext('offered', 'end', 'to')], ['active', 'declined', 'withdrawn', null, null, null]);
  eq('active ends', [handoverNext('active', 'end', 'from'), handoverNext('active', 'end', 'to'), handoverNext('active', 'accept', 'to')], ['ended', 'ended', null]);
  ok('closed states are final', ['declined', 'withdrawn', 'ended'].every((s) => ['accept', 'decline', 'withdraw', 'end'].every((a) => ['from', 'to'].every((side) => handoverNext(s, a, side) === null))));
  eq('open statuses', HANDOVER_STATUSES.filter(handoverIsOpen), ['offered', 'active']);
  eq('actions', [handoverActions('offered', 'to'), handoverActions('offered', 'from'), handoverActions('ended', 'to')], [['accept', 'decline'], ['withdraw'], []]);
  eq('reclaim', [canReclaim({ sectionClosed: true, toIsPinned: true }), canReclaim({ sectionClosed: true, toIsPinned: false }), canReclaim({ sectionClosed: false, toIsPinned: true })], [false, true, true]);
  eq('rights normalized', [normalizeRights(['sold', 'x', 'listing', 'sold', null, 'delete']), normalizeRights('listing'), normalizeRights(HANDOVER_RIGHTS.slice().reverse())], [['listing', 'sold'], [], HANDOVER_RIGHTS]);
  ok('rights and statuses labelled', HANDOVER_RIGHTS.every((r) => ['en', 'ru', 'ka'].every((l) => HANDOVER_RIGHT_I18N[r][l])) && HANDOVER_STATUSES.every((s) => ['en', 'ru', 'ka'].every((l) => HANDOVER_STATUS_I18N[s][l])));
  const table = { 'listing.put': 'listing', 'listing.photo': 'listing', 'lot.contacts': 'contacts', 'listing.bump': 'bump', 'edit.history': 'always', 'listing.delete': 'never', 'bad': 'root' };
  eq('rightOfKey', ['listing.put', 'listing.photo@en', 'lot.contacts', 'edit.history', 'listing.delete', 'unknown', 'bad', 'toString'].map((k) => rightOfKey(k, table)),
    ['listing', 'listing', 'contacts', 'always', 'never', 'never', 'never', 'never']);
  eq('stateRight', ['sold', 'archived', 'active', 'hidden'].map(stateRight), ['sold', 'archive', 'archive', null]);
  const h0 = createHandover({ from: 'owner', to: 'agency', rights: ['contacts', 'listing', 'zzz'], now: '2026-09-01T10:00:00.000Z' });
  eq('created', [h0.status, h0.rights, handoverManager(h0)], ['offered', ['listing', 'contacts'], 'owner']);
  eq('no self / bad kind', [createHandover({ from: 'a', to: 'a' }), createHandover({ kind: 'x', from: 'a', to: 'b' })], [null, null]);
  eq('binding born active', [createHandover({ kind: 'binding', from: 'a', to: 'b', now: 0 }).status, createHandover({ kind: 'binding', from: 'a', to: 'b', now: 0 }).decidedBy], ['active', 'b']);
  const h1 = applyHandover(h0, 'accept', 'to', '2026-09-02T10:00:00.000Z');
  eq('accepted', [h1.status, h1.decidedBy, handoverManager(h1), h0.status, applyHandover(h0, 'accept', 'from', 0)], ['active', 'agency', 'agency', 'offered', null]);
  eq('allows', [handoverAllows(h1, 'agency', 'listing'), handoverAllows(h1, 'agency', 'sold'), handoverAllows(h1, 'owner', 'listing'), handoverAllows(h1, 'owner', 'always'),
    handoverAllows(h0, 'agency', 'listing'), handoverAllows(h0, 'owner', 'listing'), handoverAllows(h1, 'agency', 'never'), handoverAllows(h1, 'stranger', 'always')],
  [true, false, false, true, false, true, false, false]);
  const h2 = applyHandover(h1, 'end', 'from', '2026-10-01T10:00:00.000Z');
  eq('ended', [h2.status, handoverManager(h2), handoverAllows(h2, 'owner', 'never'), handoverAllows(h2, 'agency', 'always')], ['ended', 'owner', true, false]);

  // --- reviews ----------------------------------------------------------------------------------------------------
  const fa = faceKey({ ns: 'seller', id: 'webmaster' }), fb = faceKey({ ns: 'user', id: 'webmaster' });
  ok('namespace in key', fa !== fb && !sameFace(parseFaceKey(fa), parseFaceKey(fb)));
  eq('parse face', [parseFaceKey('org:x'), parseFaceKey('user:'), parseFaceKey(''), parseFaceKey('user:Kris'), parseFaceKey('seller:A:b')], [null, null, null, { ns: 'user', id: 'kris' }, { ns: 'seller', id: 'A:b' }]);
  const me = { ns: 'user', id: 'vano' }, him = { ns: 'user', id: 'nika' };
  eq('can review', [canReview({ face: him, by: me, hasDeal: false, already: false }), canReview({ face: him, by: me, hasDeal: true, already: false }).ok,
    canReview({ face: him, by: me, hasDeal: true, already: true }).reason, canReview({ face: null, by: me, hasDeal: true }).reason], [{ ok: false, reason: 'no_deal' }, true, 'already', 'no_account']);
  const ag = { ns: 'seller', id: 'ea54' };
  eq('self by face', [canReview({ face: ag, by: ag, hasDeal: true, already: false }).reason, canReview({ face: ag, by: { ns: 'user', id: 'owner' }, hasDeal: false, already: false }).ok], ['self', false]);
  ok('reason texts', ['no_account', 'self', 'no_deal', 'already'].every((k) => REVIEW_REASON_TEXT[k]));
  const DAY = 864e5, T0 = Date.parse('2026-09-01T00:00:00.000Z'), iso = (t) => new Date(t).toISOString();
  const one = { createdAt: iso(T0), revealedAt: '' };
  eq('blind', [reviewRevealed(one, new Date(T0 + DAY)), reviewRevealed(one, T0 + BLIND_DAYS * DAY - 1000), reviewRevealed(one, new Date(T0 + BLIND_DAYS * DAY)), reviewRevealed(one, iso(T0 + 3 * DAY), 3)], [false, false, true, true]);
  ok('revealed by the other side', reviewRevealed({ createdAt: iso(T0), revealedAt: iso(T0 + 60000) }, new Date(T0 + 120000)));
  let revs = submitReview([], { face: 'user:master', by: 'user:client', src: 'bid', srcId: 77, role: 'client', stars: 5, text: 'fast' }, T0);
  eq('one is blind', [revs.length, faceRep(revs, { face: 'user:master', now: T0 + DAY }).votes], [1, 0]);
  revs = submitReview(revs, { face: 'user:client', by: 'user:master', src: 'bid', srcId: 77, role: 'worker', stars: 4, text: 'to the point' }, T0 + DAY);
  eq('second reveals both', revs.map((r) => r.revealedAt), [iso(T0 + DAY), iso(T0 + DAY)]);
  revs = submitReview(revs, { face: 'user:master', by: 'user:client', src: 'bid', srcId: 77, role: 'client', stars: 2, text: 'changed my mind' }, T0 + 2 * DAY);
  const mr = revs.filter((r) => r.face === 'user:master');
  eq('edit keeps revealed', [mr.length, mr[0].stars, mr[0].revealedAt, mr[0].createdAt], [1, 2, iso(T0 + DAY), iso(T0)]);
  revs = submitReview(revs, { face: 'user:master', by: 'user:client', src: 'bid', srcId: 78, role: 'client', stars: 5 }, T0 + 3 * DAY);
  revs = submitReview(revs, { face: 'user:master', by: 'user:client2', src: 'order', srcId: 5, role: 'client', stars: 0 }, T0 + 3 * DAY);
  eq('one per deal, bad stars ignored', revs.filter((r) => r.face === 'user:master').length, 2);
  eq('rep of revealed only', faceRep(revs, { face: 'user:master', jobs: 63, gaps: [10, 20, 30], now: T0 + 4 * DAY }), { stars: 2, votes: 1, jobs: 63, replyMin: 20 });
  eq('rep after window', faceRep(revs, { face: 'user:master', now: T0 + 30 * DAY }).stars, 3.5);
  eq('average', [averageStars([5, 4, 5]), averageStars([]), averageStars([0, 9, 'x'])], [4.7, 0, 0]);
  const gaps = [10, 12, 15, 18, 20, 20160];
  eq('median not mean', [replySpeedMinutes(gaps), replySpeedMinutes([]), replySpeedMinutes([5, -1, 'x', 7, 9])], [17, null, 7]);
  eq('speed text', [replySpeedText(null), replySpeedText(0), replySpeedText(20), replySpeedText(180), replySpeedText(2880)], ['', 'replies instantly', 'replies in ~20 min', 'replies in ~3 h', 'replies in ~2 d']);
  eq('speed text ru / ka', [replySpeedText(0, 'ru'), replySpeedText(20, 'ru'), replySpeedText(0, 'ka')], ['отвечает сразу', 'отвечает ~20 мин', 'პასუხობს მაშინვე']);
  eq('rep line', [repLine({ stars: 4.8, votes: 3, jobs: 63, replyMin: 20 }), repLine({ stars: 4.8, votes: 3, jobs: 63, replyMin: 20 }, 'ru'), repLine({ stars: 0, votes: 0, jobs: 1, replyMin: null })],
    [['★ 4.8 (3)', '63 jobs done', 'replies in ~20 min'], ['★ 4.8 (3)', '63 работы', 'отвечает ~20 мин'], ['1 job done']]);
  eq('newcomer', [repLine(EMPTY_REP), repLine(EMPTY_REP, 'ru'), repLine(EMPTY_REP, 'xx'), repLine(EMPTY_REP, 'en-GB')], [['newcomer'], ['новичок'], ['newcomer'], ['newcomer']]);
  eq('plural ru', [1, 2, 5, 11, 21, 63, 112].map((x) => plural(x, 'работа', 'работы', 'работ')), ['работа', 'работы', 'работ', 'работ', 'работа', 'работы', 'работ']);
  ok('rep words complete', Object.values(REP_WORDS).every((w) => w.now && w.novice && ['min', 'h', 'd'].every((k) => w[k].includes('{n}'))));

  // --- auction ----------------------------------------------------------------------------------------------------
  const AUC = { start: 195000, step: 1000, until: '2026-12-31', reserve: 180000 };
  eq('normalize auction', [normalizeAuction({ start: '195000', step: 1000, until: '2026-12-31', reserve: 'x' }), normalizeAuction({ on: false, start: 1, until: '2026-12-31' }),
    normalizeAuction({ start: 1 }), normalizeAuction({ start: 0, until: '2026-12-31' })], [{ start: 195000, step: 1000, until: '2026-12-31', reserve: 0 }, null, null, null]);
  const A1 = { until: '2026-09-01' };
  eq('live', [auctionLive(A1, '2026-09-30', '2026-08-12'), auctionLive(A1, '', '2026-08-12'), auctionLive(A1, '2026-08-10', '2026-08-12'), auctionLive(A1, '2026-09-30', '2026-09-01'),
    auctionLive(A1, '2026-09-30', '2026-10-01'), auctionLive(A1, null, '2026-08-12')], [true, false, false, false, false, true]);
  eq('state', [auctionState(AUC, '2027-01-30', '2026-08-12'), auctionState(AUC, '', '2026-08-12'), auctionState(AUC, '2027-01-30', '2027-02-01'), auctionState(null, '', '2026-08-12'), auctionState(AUC, null, '2026-08-12')],
    ['live', 'unpaid', 'ended', 'none', 'live']);
  eq('next bid', [nextBid(AUC, 0), nextBid(AUC, 196000), nextBid({ ...AUC, step: 0 }, 196000)], [195000, 197000, 196001]);
  const A = { start: 100, step: 10, until: '2099-01-01', reserve: 150 };
  eq('refusals', [bidRefusal(A, 0, 99), bidRefusal(A, 0, 100), bidRefusal(A, 120, 129), bidRefusal(A, 120, 130), bidRefusal(A, 0, 'x'), bidRefusal(A, 0, 100.5), nextBid({ ...A, step: 0 }, 120)],
    ['too_low', null, 'too_low', null, 'no_price', 'no_price', 121]);
  const bids = [{ id: 2, author: 'b', price: 140, status: 'new' }, { id: 1, author: 'a', price: 140, status: 'new' }, { id: 3, author: 'c', price: 200, status: 'withdrawn' }];
  eq('top: earlier wins a tie, withdrawn ignored', auctionTop(bids).id, 1);
  const o1 = auctionOutcome(A, bids, '2026-01-01');
  eq('outcome before deadline', [o1.ended, o1.winner, o1.reserveMet], [false, null, false]);
  eq('reserve not met', auctionOutcome({ ...A, until: '2026-01-01' }, bids, '2026-01-02').winner, null);
  eq('no reserve', auctionOutcome({ ...A, until: '2026-01-01', reserve: 0 }, bids, '2026-01-02').winner.id, 1);
  eq('withdrawable', [bidWithdrawable(true, bids[0], bids[1]), bidWithdrawable(true, bids[1], bids[1]), bidWithdrawable(false, bids[0], bids[1]), bidWithdrawable(true, bids[2], bids[1])], [true, false, false, false]);
  const C = { start: 100, step: 10, until: '2099-01-01', reserve: 0 };
  eq('ceiling', [bidCeiling(C, 0), bidRefusal(C, 0, 1000), bidRefusal(C, 0, 1001), bidRefusal(C, 120, 1200), bidRefusal(C, 120, 1e300),
    bidRefusal({ ...C, start: Number.MAX_SAFE_INTEGER }, 0, Number.MAX_SAFE_INTEGER + 2)], [1000, null, 'too_high', null, 'too_high', 'too_high']);
  const offers = [{ key: 'sale', currency: 'USD', auction: { ...AUC } }, { key: 'rent', currency: 'USD', auction: { ...AUC } }];
  const edit = (patch, key = 'sale') => offers.map((o) => (o.key === key ? { ...o, ...patch } : o));
  eq('terms lock', [auctionTermsChanged(offers, offers, ['sale']), auctionTermsChanged(offers, edit({ auction: { ...AUC, until: '2026-12-31T23:00' } }), ['sale']),
    auctionTermsChanged(offers, edit({ auction: { ...AUC, until: '2026-09-01' } }), ['sale']), auctionTermsChanged(offers, edit({ auction: { ...AUC, step: 5000 } }), ['sale']),
    auctionTermsChanged(offers, edit({ currency: 'GEL' }), ['sale']), auctionTermsChanged(offers, edit({ mode: 'fixed' }), ['sale']),
    auctionTermsChanged(offers, edit({ auction: { ...AUC, step: 5 } }, 'rent'), ['sale']), auctionTermsChanged(offers, offers.slice(1), ['sale', 'rent'])],
  [null, null, 'sale', 'sale', 'sale', 'sale', null, 'sale']);
  const pt = publicTerms(A, bids);
  eq('public terms hide reserve', [pt.reserve, pt.top, pt.next, pt.bids, pt.hasReserve, pt.reserveMet, 'reserve' in pt], [undefined, 140, 150, 2, true, false, false]);
  const R1 = { start: 100, step: 10, until: '2026-05-01', reserve: 150 };
  const rb = [{ id: 1, author: 'a', price: 120, status: 'new' }, { id: 2, author: 'b', price: 160, status: 'new' }, { id: 3, author: 'c', price: 170, status: 'withdrawn' }];
  eq('settle before end', settleBids(rb, R1, '2026-04-30').settled, false);
  const s1 = settleBids(rb, R1, '2026-05-01');
  eq('settled', [s1.settled, s1.winner.id, s1.bids.map((b) => b.status), s1.bids.map((b) => b.settledFor || ''), rb[0].status], [true, 2, ['declined', 'chosen', 'withdrawn'], ['2026-05-01', '2026-05-01', ''], 'new']);
  eq('settle once', settleBids(s1.bids, R1, '2026-06-01').settled, false);
  const R2 = { ...R1, reserve: 500 };
  const s2 = settleBids(rb, R2, '2026-05-02');
  eq('no winner, all declined', [s2.settled, s2.winner, s2.bids.map((b) => b.status)], [true, null, ['declined', 'declined', 'withdrawn']]);
  const R3 = restartAuction(R2, '2026-06-01', { reserve: 150 });
  eq('restart', [R3, restartAuction(R2, '2026-04-01'), restartAuction(R2, '')], [{ start: 100, step: 10, until: '2026-06-01', reserve: 150 }, null, null]);
  const round2 = [...s2.bids, { id: 4, author: 'a', price: 180, status: 'new' }];
  eq('round bids', roundBids(round2, R3).map((b) => b.id), [3, 4]);
  const s3 = settleBids(round2, R3, '2026-06-01');
  eq('second round settles', [s3.settled, s3.winner.id, s3.bids.find((b) => b.id === 1).settledFor], [true, 4, '2026-05-01']);

  // --- ics --------------------------------------------------------------------------------------------------------
  eq('escape round trip', icsUnescape(icsEscape('a,b;c\\d\nnext')), 'a,b;c\\d\nnext');
  const ics = staysToIcs([{ from: '2026-08-10', to: '2026-08-12', summary: 'Guest: Nino, 2 adults' }, { from: '2026-08-12', to: '2026-08-14', uid: 'b-7', status: 'pending' },
    { from: '2026-08-15', to: '2026-08-15' }], { name: 'Flat 4', stamp: '2026-08-01T09:30:00Z', domain: 'example.test' });
  ok('ics crlf', ics.endsWith('END:VCALENDAR\r\n') && !/[^\r]\n/.test(ics));
  ok('ics dates', ics.includes('DTSTART;VALUE=DATE:20260810\r\nDTEND;VALUE=DATE:20260812') && ics.includes('UID:2026-08-10-2026-08-12@example.test') && ics.includes('DTSTAMP:20260801T093000Z'));
  ok('ics escape and status', ics.includes('SUMMARY:Guest: Nino\\, 2 adults') && ics.includes('STATUS:TENTATIVE') && (ics.match(/BEGIN:VEVENT/g) || []).length === 2);
  eq('ics back', icsToStays(ics).map((s) => [s.from, s.to, s.uid, s.summary]), [['2026-08-10', '2026-08-12', '2026-08-10-2026-08-12@example.test', 'Guest: Nino, 2 adults'], ['2026-08-12', '2026-08-14', 'b-7', 'Reserved']]);
  const long = staysToIcs([{ from: '2026-08-10', to: '2026-08-12', description: 'Მ'.repeat(60) + ' check-in after 14:00, keys at the reception desk downstairs' }], { stamp: 0 });
  ok('ics folded at 75 octets', long.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75));
  eq('ics unfold', icsToStays(long)[0].description, 'Მ'.repeat(60) + ' check-in after 14:00, keys at the reception desk downstairs');
  const foreign = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20260901T140000Z\nDTEND:20260905T100000Z\nUID:x1\nSUMMARY:Airbnb (Not available)\nEND:VEVENT\n'
    + 'BEGIN:VEVENT\nDTSTART;VALUE=DATE:20260910\nUID:x2\nEND:VEVENT\nBEGIN:VEVENT\nDTSTART;VALUE=DATE:20260920\nDTEND;VALUE=DATE:20260922\nSTATUS:CANCELLED\nEND:VEVENT\nEND:VCALENDAR\n';
  eq('ics import', icsToStays(foreign).map((s) => [s.from, s.to, s.uid]), [['2026-09-01', '2026-09-05', 'x1'], ['2026-09-10', '2026-09-11', 'x2']]);
  eq('imported stays block quotes', quoteStay({ ...B, from: '2026-09-03', to: '2026-09-06', busy: icsToStays(foreign) }).error, 'busy');

  console.log(`booking: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
