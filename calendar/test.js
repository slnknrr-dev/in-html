// calendar/test.js - unit tests of the calendar library: `node calendar/test.js` (importing the module runs nothing).
// Civil dates, ISO weeks and zones, ICS write -> read round trips (folding by octets, escaping, all-day ends, alarms,
// attendees), foreign ICS input, RRULE expansion against hand-checked dates, period presets and report schedules,
// rosters with night shifts, event language (dates in words, buckets, phases, schedule days), guests and CSV.
//
// Every "now" and "today" is passed explicitly, so the suite gives the same result on any day and in any machine
// time zone; RRULE cases are compared with hand-checked dates rather than with another implementation.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDays, addMonths, dayDiff, isoDow, isoWeek, isoWeekKey, isoWeekStart, isoWeeksInYear, parseDay, parseTime, splitDateTime, tzOffset, zonedParts, zonedToUtc } from './date.js';
import { buildCalendar, buildEvent, foldLine, formatDuration, icsEscape, icsUnescape, parseContentLine, parseDuration, readCalendar, unfoldLines } from './ics.js';
import { describeRRule, expandRRule, formatRRule, parseRRule } from './rrule.js';
import { nextRun, periodLabel, periodRange, previousPeriod, runsBetween } from './period.js';
import { layoutSpans, monthGrid, monthsOf, weekGrid } from './grid.js';
import { dayCoverage, rosterConflicts, shiftConflicts, shiftHours, timesheet, weeklyTotals } from './roster.js';
import { activePhase, dayBadge, eventBucket, eventDays, eventType, formatEventDate, fullness, localName, parseWhen, passesWhen, relativeDay, scheduleDays, sortPhases, whenMs } from './event.js';
import { guestsCsv, normalizeTags, parseGuestLine, parseGuestList, pollBars, rsvpApplyTags, rsvpOptions, rsvpSummary, tagCounts } from './guests.js';

// Run only when executed directly; importing run() has no side effects.
const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const ok = (name, cond) => eq(name, !!cond, true);
  const octets = (s) => new TextEncoder().encode(s).length;

  // --- date -------------------------------------------------------------------------------------------------------
  eq('parseDay forms', ['2026-08-14', '20260814', '2026-08-14T16:00', '14.08.2026', '4/8/2026', '2026-02-30', 'x'].map(parseDay),
    ['2026-08-14', '2026-08-14', '2026-08-14', '2026-08-14', '2026-08-04', '', '']);
  eq('parseTime', [parseTime('9:30'), parseTime('24:00'), parseTime('25:00'), parseTime('0930')], [570, 1440, NaN, 570]);
  eq('isoDow', [isoDow('2026-10-24'), isoDow('2026-10-19'), isoDow('1969-12-31')], [5, 0, 2]);
  eq('addMonths clamp', [addMonths('2026-01-31', 1), addMonths('2024-02-29', 12), addMonths('2026-03-15', -3)], ['2026-02-28', '2025-02-28', '2025-12-15']);
  eq('dayDiff', [dayDiff('2026-10-01', '2026-09-30'), dayDiff('2026-03-01', '2026-02-01')], [1, 28]);
  eq('iso week 2026-01-01', isoWeekKey('2026-01-01'), '2026-W01');
  eq('iso week 2027-01-01', isoWeek('2027-01-01'), { year: 2026, week: 53 });
  eq('iso week 2024-12-30', isoWeekKey('2024-12-30'), '2025-W01');
  eq('iso week start', [isoWeekStart(2026, 1), isoWeekStart('2026-W43')], ['2025-12-29', '2026-10-19']);
  eq('weeks in year', [isoWeeksInYear(2026), isoWeeksInYear(2025)], [53, 52]);
  for (let n = 0; n < 800; n += 7) { const d = addDays('2025-12-01', n); eq('week start ' + d, isoWeekStart(isoWeekKey(d)), addDays(d, -isoDow(d))); }
  eq('tz tbilisi', tzOffset(Date.UTC(2026, 6, 1), 'Asia/Tbilisi'), 240);
  eq('tz berlin', [tzOffset(Date.UTC(2026, 6, 1), 'Europe/Berlin'), tzOffset(Date.UTC(2026, 0, 1), 'Europe/Berlin')], [120, 60]);
  eq('tz fixed', [tzOffset(0, '+05:30'), tzOffset(0, 'UTC-3'), tzOffset(0, -120), tzOffset(0, 'Nowhere/Zone')], [330, -180, -120, 0]);
  eq('zonedToUtc', [zonedToUtc('2026-07-01', '12:00', 'Europe/Berlin'), zonedToUtc('2026-01-01', '12:00', 'Europe/Berlin')], [Date.UTC(2026, 6, 1, 10), Date.UTC(2026, 0, 1, 11)]);
  eq('zonedToUtc dst day', zonedToUtc('2026-03-29', '12:00', 'Europe/Berlin'), Date.UTC(2026, 2, 29, 10));
  eq('zonedParts', zonedParts(Date.UTC(2026, 9, 23, 21, 30), 'Asia/Tbilisi').day, '2026-10-24');
  eq('splitDateTime', splitDateTime('2026-08-14 16:00'), { day: '2026-08-14', time: '16:00', y: 2026, m: 8, d: 14 });

  // --- ics --------------------------------------------------------------------------------------------------------
  eq('escape', icsEscape('a,b;c\\d\nE'), 'a\\,b\\;c\\\\d\\nE');
  eq('unescape', icsUnescape(icsEscape('a,b;c\\d\nE')), 'a,b;c\\d\nE');
  const longRu = 'DESCRIPTION:' + 'Приглашаем на венчание и праздничный ужин в саду. '.repeat(4);
  const folded = foldLine(longRu);
  ok('fold octets', folded.split('\r\n').every((l) => octets(l) <= 75));
  eq('fold unfold', unfoldLines(folded)[0], longRu);
  eq('duration', [formatDuration(-900), formatDuration(90061), formatDuration(1209600), formatDuration(0)], ['-PT15M', 'P1DT1H1M1S', 'P2W', 'PT0S']);
  eq('parse duration', [parseDuration('-PT15M'), parseDuration('P1DT2H'), parseDuration('P2W'), parseDuration('P')], [-900, 93600, 1209600, NaN]);
  // the source's event: floating local time, no Z
  const src = buildEvent({ uid: 'ev-1@x', title: 'Свадьба', start: '2026-08-14T16:00', end: '2026-08-14T23:00', stamp: '2026-08-01T00:00:00Z', location: 'Batumi, Georgia', url: 'https://x.ge/e/1' });
  ok('src dtstart floating', src.includes('\r\nDTSTART:20260814T160000\r\n'));
  ok('src location escaped', src.includes('LOCATION:Batumi\\, Georgia'));
  ok('src dtstamp', src.includes('DTSTAMP:20260801T000000Z'));
  ok('src crlf', !/[^\r]\n/.test(src) && src.endsWith('\r\n'));
  const ev = {
    uid: 'w-42@example.org', title: 'Венчание; ужин, танцы', description: 'Line 1\nLine 2 — '.repeat(6), start: '2026-09-19T16:00', end: '2026-09-19T23:30',
    tz: 'Asia/Tbilisi', location: 'Sameba, Tbilisi', geo: { lat: 41.6977, lon: 44.8085 }, categories: ['wedding', 'family'], status: 'confirmed',
    organizer: { email: 'host@example.org', name: 'Doe, John' }, attendees: [{ email: 'a@example.org', name: 'Ana', partstat: 'accepted', rsvp: true }],
    rrule: { freq: 'yearly', count: 3 }, exdate: ['2027-09-19T16:00'], alarms: [{ trigger: 60, description: 'Soon' }, { trigger: 'P1D', related: 'end' }],
    stamp: '2026-08-01T10:00:00Z', sequence: 2, x: { 'X-KH-KIND': 'wedding' },
  };
  const cal = buildCalendar({ name: 'Наша свадьба', events: [ev], todos: [{ uid: 't1', title: 'Order cake', due: '2026-09-10', priority: 1, percent: 40, stamp: '2026-08-01T10:00:00Z' }] });
  ok('cal folded', cal.split('\r\n').every((l) => octets(l) <= 75));
  ok('cal tzid', cal.includes('DTSTART;TZID=Asia/Tbilisi:20260919T160000'));
  ok('cal organizer quoted', cal.includes('ORGANIZER;CN="Doe, John":mailto:host@example.org'));
  ok('cal alarm', cal.includes('TRIGGER:-PT1H') && cal.includes('TRIGGER;RELATED=END:P1D'));
  const back = readCalendar(cal);
  const e0 = back.events[0];
  eq('read name', back.name, 'Наша свадьба');
  eq('read basic', [e0.uid, e0.title, e0.description, e0.location, e0.start, e0.end, e0.tz, e0.allDay], [ev.uid, ev.title, ev.description, ev.location, '2026-09-19T16:00:00', '2026-09-19T23:30:00', 'Asia/Tbilisi', false]);
  eq('read people', [e0.organizer, e0.attendees], [{ email: 'host@example.org', name: 'Doe, John' }, [{ email: 'a@example.org', name: 'Ana', partstat: 'accepted', rsvp: true }]]);
  eq('read misc', [e0.geo, e0.categories, e0.status, e0.sequence, e0.rrule, e0.exdate, e0.x], [ev.geo, ev.categories, 'confirmed', 2, { freq: 'yearly', interval: 1, count: 3 }, ['2027-09-19T16:00:00'], { 'X-KH-KIND': 'wedding' }]);
  eq('read alarms', e0.alarms, [{ action: 'display', trigger: 60, description: 'Soon' }, { action: 'display', trigger: -1440, related: 'end', description: ev.title }]);
  eq('read todo', [back.todos[0].title, back.todos[0].due, back.todos[0].priority, back.todos[0].percent], ['Order cake', '2026-09-10', 1, 40]);
  const allDay = readCalendar(buildEvent({ uid: 'd', title: 'Fair', start: '2026-10-01', end: '2026-10-03', stamp: 0 })).events[0];
  eq('all-day inclusive end', [allDay.start, allDay.end, allDay.allDay], ['2026-10-01', '2026-10-03', true]);
  ok('all-day dtend exclusive', buildEvent({ uid: 'd', start: '2026-10-01', end: '2026-10-03' }).includes('DTEND;VALUE=DATE:20261004'));
  ok('one-day dtend', buildEvent({ uid: 'd', start: '2026-10-01' }).includes('DTEND;VALUE=DATE:20261002'));
  ok('utc start', buildEvent({ uid: 'u', start: new Date(Date.UTC(2026, 9, 24, 15, 0)), duration: 5400 }).includes('DTSTART:20261024T150000Z\r\nDURATION:PT1H30M'));
  eq('content line', parseContentLine('ATTENDEE;CN="Doe, J";ROLE=REQ-PARTICIPANT;X-L=a,b:mailto:j@x'), { name: 'ATTENDEE', params: { CN: 'Doe, J', ROLE: 'REQ-PARTICIPANT', 'X-L': ['a', 'b'] }, value: 'mailto:j@x' });
  const foreign = 'BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Other//EN\nBEGIN:VTIMEZONE\nTZID:Europe/Berlin\nEND:VTIMEZONE\nBEGIN:VEVENT\nUID:abc\nDTSTAMP:20260101T000000Z\n' +
    'DTSTART;TZID=Europe/Berlin:20260315T090000\nDURATION:PT45M\nSUMMARY:Stand\n\tup\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20260331T235959Z\nEND:VEVENT\nEND:VCALENDAR\n';
  const fr = readCalendar(foreign);
  eq('foreign', [fr.prodId, fr.timezones, fr.events[0].title, fr.events[0].end, fr.events[0].rrule.byDay], ['-//Other//EN', ['Europe/Berlin'], 'Standup', '2026-03-15T09:45:00', ['MO', 'WE', 'FR']]);
  eq('foreign expand', expandRRule(fr.events[0].start, fr.events[0].rrule, { tz: 'Europe/Berlin' }).length, 8);

  // --- rrule ------------------------------------------------------------------------------------------------------
  const ex = (start, rule, opts) => expandRRule(start, rule, opts);
  eq('weekly mo we', ex('2026-10-05', 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=5'), ['2026-10-05', '2026-10-07', '2026-10-12', '2026-10-14', '2026-10-19']);
  eq('monthly last fri', ex('2026-01-30', 'FREQ=MONTHLY;BYDAY=-1FR;COUNT=3'), ['2026-01-30', '2026-02-27', '2026-03-27']);
  eq('monthly 31st skips', ex('2026-01-31', { freq: 'monthly', count: 4 }), ['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31']);
  eq('yearly feb 29', ex('2024-02-29', 'FREQ=YEARLY;COUNT=2'), ['2024-02-29', '2028-02-29']);
  eq('daily interval until', ex('2026-10-01T19:00', 'FREQ=DAILY;INTERVAL=2;UNTIL=20261009'), ['2026-10-01T19:00:00', '2026-10-03T19:00:00', '2026-10-05T19:00:00', '2026-10-07T19:00:00', '2026-10-09T19:00:00']);
  eq('last weekday', ex('2026-10-30', 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=3'), ['2026-10-30', '2026-11-30', '2026-12-31']);
  eq('exdate counted', ex('2026-10-01', 'FREQ=DAILY;COUNT=4', { exdate: ['2026-10-02'] }), ['2026-10-01', '2026-10-03', '2026-10-04']);
  eq('biweekly start off-rule', ex('2026-10-07', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;COUNT=3'), ['2026-10-07', '2026-10-19', '2026-11-02']);
  eq('yearly 2nd sunday of may', ex('2026-05-10', 'FREQ=YEARLY;BYMONTH=5;BYDAY=2SU;COUNT=3'), ['2026-05-10', '2027-05-09', '2028-05-14']);
  eq('monthly 1st and 15th', ex('2026-01-01', 'FREQ=MONTHLY;BYMONTHDAY=1,15,-1;COUNT=5'), ['2026-01-01', '2026-01-15', '2026-01-31', '2026-02-01', '2026-02-15']);
  eq('window', ex('2026-01-05', 'FREQ=WEEKLY', { from: '2026-03-01', to: '2026-03-20' }), ['2026-03-02', '2026-03-09', '2026-03-16']);
  eq('until utc in zone', ex('2026-10-01T23:30', 'FREQ=DAILY;UNTIL=20261002T190000Z', { tz: 'Asia/Tbilisi' }), ['2026-10-01T23:30:00']);
  eq('rrule round trip', formatRRule(parseRRule('FREQ=MONTHLY;INTERVAL=2;BYDAY=2MO,-1FR;UNTIL=20271231T235959Z;WKST=SU')), 'FREQ=MONTHLY;INTERVAL=2;UNTIL=20271231T235959Z;BYDAY=2MO,-1FR;WKST=SU');
  eq('describe', describeRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10'), 'every 2 weeks on Mon, Wed, 10 times');
  eq('bad freq', ex('2026-01-01', 'FREQ=SECONDLY'), []);

  // --- period -----------------------------------------------------------------------------------------------------
  const T = '2026-10-24';
  eq('mtd', periodRange('mtd', T), { from: '2026-10-01', to: T, days: 24 });
  eq('prevmonth', periodRange('prevmonth', T), { from: '2026-09-01', to: '2026-09-30', days: 30 });
  eq('ytd', periodRange('ytd', T).from, '2026-01-01');
  eq('last7 / 30', [periodRange('last7', T).from, periodRange('30', T).days], ['2026-10-18', 30]);
  eq('isoweek', periodRange('isoweek:2026-W43', T), { from: '2026-10-19', to: '2026-10-25', days: 7 });
  eq('prevquarter', periodRange('prevquarter', T), { from: '2026-07-01', to: '2026-09-30', days: 92 });
  eq('prevmonth january', periodRange('prevmonth', '2026-01-15').from, '2025-12-01');
  eq('custom', periodRange('custom:2026-02-01..2026-02-28', T).days, 28);
  eq('bad preset', [periodRange('nope', T), periodRange('custom:2026-03-01..2026-02-01', T)], [null, null]);
  eq('previous', previousPeriod(periodRange('mtd', T)), { from: '2026-09-07', to: '2026-09-30', days: 24 });
  eq('year ago', previousPeriod(periodRange('month:2024-02', T), 'year'), { from: '2023-02-01', to: '2023-02-28', days: 28 });
  eq('label', [periodLabel(periodRange('week', '2026-10-25')), periodLabel(periodRange('today', T))], ['2026-W43', T]);
  const at8 = Date.UTC(2026, 9, 24, 4, 0); // 08:00 in Tbilisi, a Saturday
  eq('nextRun daily', nextRun({ freq: 'daily', hour: 9, tz: 'Asia/Tbilisi' }, at8), Date.UTC(2026, 9, 24, 5, 0));
  eq('nextRun daily passed', nextRun({ freq: 'daily', hour: 9, tz: 'Asia/Tbilisi' }, Date.UTC(2026, 9, 24, 5, 0)), Date.UTC(2026, 9, 25, 5, 0));
  eq('nextRun weekly mon', nextRun({ freq: 'weekly', weekday: 1, hour: 9, tz: 240 }, at8), Date.UTC(2026, 9, 26, 5, 0));
  eq('nextRun monthly', nextRun({ freq: 'monthly', hour: 9, minute: 30, tz: 'Asia/Tbilisi' }, at8), Date.UTC(2026, 10, 1, 5, 30));
  eq('nextRun monthday 31', nextRun({ freq: 'monthly', monthday: 31, hour: 0, tz: 'UTC' }, Date.UTC(2026, 10, 2)), Date.UTC(2026, 10, 30));
  eq('nextRun last day', nextRun({ freq: 'monthly', monthday: -1, hour: 0 }, Date.UTC(2027, 1, 1)), Date.UTC(2027, 1, 28));
  eq('nextRun berlin dst', nextRun({ freq: 'daily', hour: 9, tz: 'Europe/Berlin' }, Date.UTC(2026, 9, 24, 12)), Date.UTC(2026, 9, 25, 8));
  eq('runs between', runsBetween({ freq: 'weekdays', hour: 9 }, Date.UTC(2026, 9, 23, 12), Date.UTC(2026, 9, 28, 12)).length, 3);

  // --- grid -------------------------------------------------------------------------------------------------------
  const feb = monthGrid(2026, 2);
  eq('feb grid', [feb.cells.length, feb.cells[0].day, feb.cells[6].day, feb.cells[34].day, feb.cells[0].inMonth], [35, '2026-01-26', '2026-02-01', '2026-03-01', false]);
  eq('feb fixed', monthGrid(2026, 2, { fixedWeeks: true }).weeks.length, 6);
  eq('sunday start', monthGrid(2026, 2, { weekStart: 6 }).cells[0].day, '2026-02-01');
  const oct = monthGrid(2026, 10, { items: [{ startsAt: '2026-10-24 19:00', t: 'a' }, { startsAt: '2026-10-24', t: 'b' }, { startsAt: 'later' }], today: T });
  const c24 = oct.cells.find((c) => c.day === T);
  eq('grid items', [c24.items.map((x) => x.t), c24.isToday, c24.weekend], [['a', 'b'], true, true]);
  eq('week grid', [weekGrid(T).start, weekGrid(T).week], ['2026-10-19', { year: 2026, week: 43 }]);
  eq('months of', monthsOf(['2026-11-02', '2026-10-30', '2026-10-30']).map((m) => [m.month, m.days.length]), [[10, 1], [11, 1]]);
  eq('lanes', layoutSpans([{ start: '2026-10-01', end: '2026-10-03' }, { start: '2026-10-02' }, { start: '2026-10-04', end: '2026-10-05' }]).map((x) => [x.start, x.lane, x.length]),
    [['2026-10-01', 0, 3], ['2026-10-02', 1, 1], ['2026-10-04', 0, 2]]);

  // --- roster -----------------------------------------------------------------------------------------------------
  eq('shift hours', [shiftHours('22:00', '06:00'), shiftHours('09:00', '17:30'), shiftHours('00:00', '00:00'), shiftHours('x', '1')], [8, 8.5, 24, 0]);
  const night = { id: 1, member: 'ana', day: '2026-10-24', start: '22:00', end: '06:00' };
  const morning = { id: 2, member: 'ana', day: '2026-10-25', start: '05:00', end: '13:00' };
  const late = { id: 3, member: 'ana', day: '2026-10-26', start: '14:00', end: '22:00' };
  const early = { id: 4, member: 'ana', day: '2026-10-27', start: '06:00', end: '14:00' };
  eq('night overlaps next morning', shiftConflicts(night, [morning]).map((c) => c.kind), ['overlap']);
  eq('rest', shiftConflicts(early, [late], { minRest: 11 }).map((c) => [c.kind, c.gapHours]), [['rest', 8]]);
  eq('other member', shiftConflicts(night, [{ ...morning, member: 'bob' }]), []);
  eq('absent', shiftConflicts(late, [], { absences: [{ member: 'ana', from: '2026-10-26', to: '2026-10-30', status: 'approved', kind: 'sick' }, { member: 'ana', from: '2026-10-26', status: 'requested' }] }).map((c) => c.kind), ['absent']);
  eq('roster conflicts', rosterConflicts([night, morning, late, early], { minRest: 11 }).map((c) => [c.shift.id, c.kind]), [[1, 'overlap'], [3, 'rest']]);
  eq('weekly totals', weeklyTotals([night, morning, late, early]), [{ member: 'ana', week: '2026-W43', hours: 16, shifts: 2 }, { member: 'ana', week: '2026-W44', hours: 16, shifts: 2 }]);
  eq('coverage', dayCoverage([night, morning], '2026-10-25').slice(0, 7), [1, 1, 1, 1, 1, 2, 1]);
  const ts = timesheet([{ member: 'ana', day: '2026-10-24', start: '09:00', end: '17:00' }, { member: 'ana', day: '2026-10-25', start: '09:00', end: '17:00' }],
    [{ member: 'ana', in: Date.UTC(2026, 9, 24, 5, 20), out: Date.UTC(2026, 9, 24, 14, 20) }], { tz: 'Asia/Tbilisi', now: Date.UTC(2026, 9, 26) });
  eq('timesheet', ts, [{ member: 'ana', shifts: 2, planned: 16, worked: 9, overtime: 0, late: 1, missed: 1 }]);

  // --- event ------------------------------------------------------------------------------------------------------
  eq('parseWhen', [parseWhen('2026-08-14T16:00:30'), parseWhen('2026-13-01'), parseWhen('')], [{ date: '2026-08-14', time: '16:00', y: 2026, m: 8, d: 14 }, null, null]);
  eq('date words', ['en', 'ru', 'ka'].map((l) => formatEventDate('2026-10-03', l)), ['October 3, 2026', '3 октября 2026', '3 ოქტომბერი, 2026']);
  eq('date words time weekday', formatEventDate('2026-09-01 19:30', 'ru', { weekday: true }), 'Вторник, 1 сентября 2026, 19:30');
  ok('date words intl', /2026/.test(formatEventDate('2026-10-03', 'de')));
  eq('badge', [dayBadge('2026-08-14', 'ru'), dayBadge('2026-08-14')], [{ d: '14', mo: 'авг' }, { d: '14', mo: 'Aug' }]);
  eq('relative', [relativeDay('2026-10-27', T, 'ru'), relativeDay('2026-10-25', T), relativeDay('2026-10-19', T, 'ru'), relativeDay('2026-12-01', T)], ['через 3 дня', 'Tomorrow', '5 дней назад', '']);
  const W = '2026-10-21';
  eq('buckets', ['2026-10-20', W, '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-27', '2026-10-28', ''].map((d) => eventBucket(d, W)), ['past', 'today', 'tomorrow', 'week', 'weekend', 'week', 'later', 'nodate']);
  eq('passesWhen', [passesWhen('', 'any', W), passesWhen('', 'today', W), passesWhen('2026-10-25', 'weekend', W), passesWhen('2026-10-23', 'weekend', W), passesWhen('2026-11-20', 'month', W)], [true, false, true, false, true]);
  eq('fullness', [fullness(12, 40), fullness(5, 0), fullness(37, 40).almost, fullness(41, 40).full], [{ cap: 40, going: 12, pct: 30, left: 28, almost: false, full: false }, null, true, true]);
  const phases = [{ id: 'after', at: { mode: 'after', days: 1 } }, { id: 'main', at: { mode: 'default' } }, { id: 'before', at: { mode: 'before', days: 7 } }, { id: 'ana', for: 'tok-ana' }];
  const S = '2026-09-19T16:00';
  eq('phase sort', sortPhases(phases, S).map((p) => p.id), ['main', 'before', 'after', 'ana']);
  eq('phase at', [Date.UTC(2026, 8, 10), Date.UTC(2026, 8, 13), Date.UTC(2026, 8, 21)].map((n) => activePhase(phases, S, n).phase.id), ['main', 'before', 'after']);
  eq('phase addressed', activePhase(phases, S, Date.UTC(2026, 8, 10), 'tok-ana').phase.id, 'ana');
  eq('phase no date', activePhase(phases, '', Date.UTC(2026, 8, 21)).phase.id, 'main');
  eq('whenMs', whenMs(S), Date.UTC(2026, 8, 19, 16));
  const sched = scheduleDays([{ day: '2026-09-21', at: '10:00', t: 'brunch' }, { at: '18:00', t: 'free' }, { day: '2026-09-19', at: '19:00', t: 'dinner' }, { day: '19.09.2026', at: '16:00', t: 'church' }]);
  eq('schedule days', sched.map((g) => [g.day, g.gapBefore, g.items.map((x) => x.t)]), [['', 0, ['free']], ['2026-09-19', 0, ['church', 'dinner']], ['2026-09-21', 1, ['brunch']]]);
  eq('event days', eventDays(S, [{ day: '2026-09-21' }, { day: '' }], ['2026-09-19']), ['2026-09-19', '2026-09-21']);
  eq('event type', [eventType('webinar').category, eventType('nope').slug, localName(eventType('wedding').name, 'ka')], ['edu', 'other', 'ქორწილი']);

  // --- guests -----------------------------------------------------------------------------------------------------
  eq('rsvp defaults', [rsvpOptions({}).map((o) => o.id), rsvpOptions({ allowMaybe: false }).length], [['yes', 'no', 'maybe'], 2]);
  const block = { options: [{ id: 'solo', axis: 'yes', tags: ['coming'] }, { id: 'pair', axis: 'yes', tags: ['Coming', 'plus-one'] }, { id: 'solo', axis: 'no' }, { id: 'no!', axis: 'weird', tags: 'declined' }] };
  eq('rsvp options', rsvpOptions(block).map((o) => [o.id, o.axis, o.tags]), [['solo', 'yes', ['coming']], ['pair', 'yes', ['Coming', 'plus-one']], ['no', 'maybe', ['declined']]]);
  eq('apply tags', rsvpApplyTags(['VIP', 'declined', 'coming '], block, 'pair'), ['VIP', 'Coming', 'plus-one']);
  eq('apply none', rsvpApplyTags(['x'], {}, 'yes'), null);
  eq('tags', [normalizeTags('VIP, vip , Vip,, kids'), tagCounts([{ tags: ['VIP'] }, { tags: 'vip,kids' }])], [['VIP', 'kids'], [{ tag: 'VIP', count: 2 }, { tag: 'kids', count: 1 }]]);
  eq('guest line', parseGuestLine('Иван, Ivan <IVAN@x.ge>', ['ru', 'en']), { name: 'Иван', names: { ru: 'Иван', en: 'Ivan' }, email: 'ivan@x.ge' });
  eq('guest line email', parseGuestLine('ana@x.ge'), { name: 'ana@x.ge', names: { en: 'ana@x.ge' }, email: 'ana@x.ge' });
  eq('guest list', parseGuestList('# family\nAna <a@x.ge>\n\nBob\nAnna <A@x.ge>\n').map((g) => g.name), ['Ana', 'Bob']);
  const gs = [{ rsvp: { response: 'yes', guests: 2 } }, { rsvp: { response: 'yes' } }, { rsvp: { response: 'maybeNo' } }, { rsvp: { response: 'waitlist' } }, { rsvp: null }];
  const sum = rsvpSummary(gs, { capacity: 4 });
  eq('summary', [sum.seats, sum.noAnswer, sum.counts.yes, sum.counts.maybeNo, sum.counts.waitlist, sum.fullness.full], [4, 1, 2, 1, 1, true]);
  eq('poll bars', pollBars(['a', 'b', 'c'], [3, 6, 0]).map((b) => b.pct), [50, 100, 0]);
  const csv = guestsCsv([{ name: '=cmd|calc', lang: 'ru', rsvp: { response: 'yes', guests: 1 }, option: 'With partner', tags: ['VIP'], email: 'a@x.ge', answers: ['veg'] }, { name: 'Bob; Jr', rsvp: null }], { extra: ['Menu'] });
  const rows = csv.slice(1).split('\r\n');
  ok('csv bom', csv.startsWith('﻿'));
  eq('csv head', rows[0], 'Name;Language;Response;Option;Total people;Opened link;Tags;Table / seat;Email;Phone;Note;Link;Menu');
  eq('csv guarded', rows[1], "'=cmd|calc;RU;attending;With partner;2;no;VIP;;a@x.ge;;;;veg");
  eq('csv quoted', rows[2], '"Bob; Jr";;no answer;;;no;;;;;;;');

  console.log(`calendar: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
