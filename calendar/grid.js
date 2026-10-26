// calendar/grid.js - calendar layouts as data: a month as whole weeks (days of the neighbouring months marked
// `inMonth: false`, so rows never break), a week strip, items grouped by day, the months a set of days spans, and
// multi-day spans laid into lanes. Monday is the first day by default (weekStart 0 = Monday … 6 = Sunday).
import { addDays, dayDiff, daysInMonth, isoDow, isoWeek, parseDay, splitDateTime, startOfWeek } from './date.js';

const pad = (n) => String(n).padStart(2, '0');
const defaultDayOf = (item) => (item && (item.start || item.startsAt || item.date || item.day)) || '';

// Items grouped by their day: { 'YYYY-MM-DD': [items] }. `dayOf(item)` returns any value splitDateTime reads.
export function groupByDay(items = [], dayOf = defaultDayOf) {
  const out = {};
  for (const it of items) {
    const p = splitDateTime(dayOf(it));
    if (p) (out[p.day] = out[p.day] || []).push(it);
  }
  return out;
}

// Cells are plain data (no DOM): any renderer (HTML table, canvas, terminal) can draw them, and tests can assert on
// them directly.
function cell(day, { inMonth = true, today = '', byDay = {} } = {}) {
  const dow = isoDow(day);
  return { day, d: +day.slice(8, 10), inMonth, dow, weekend: dow >= 5, isToday: day === today, items: byDay[day] || [] };
}

// Month grid: { year, month, weekStart, weeks: [[7 cells]], cells } with cell { day, d, inMonth, dow, weekend,
// isToday, items }. Options: items + dayOf (grouped into cells), weekStart, today, fixedWeeks (always 6 rows).
export function monthGrid(year, month, { items = [], dayOf = defaultDayOf, weekStart = 0, today = '', fixedWeeks = false } = {}) {
  const byDay = groupByDay(items, dayOf);
  const first = `${year}-${pad(month)}-01`;
  const last = `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`;
  let day = startOfWeek(first, weekStart);
  const cells = [];
  // String comparison of 'YYYY-MM-DD' is chronological. Loop until the month is covered AND the last row is complete;
  // fixedWeeks pads to 6 rows so a month view never changes height between months.
  while (day <= last || cells.length % 7 || (fixedWeeks && cells.length < 42)) {
    cells.push(cell(day, { inMonth: day >= first && day <= last, today, byDay }));
    day = addDays(day, 1);
  }
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return { year, month, weekStart, weeks, cells };
}

// Seven cells of the week containing `day`, plus its ISO week.
export function weekGrid(day, { items = [], dayOf = defaultDayOf, weekStart = 0, today = '' } = {}) {
  const byDay = groupByDay(items, dayOf);
  const start = startOfWeek(parseDay(day), weekStart);
  const cells = Array.from({ length: 7 }, (_, i) => cell(addDays(start, i), { today, byDay }));
  return { start, end: addDays(start, 6), week: isoWeek(addDays(start, (3 - isoDow(start) + 7) % 7)), cells };
}

// Weekday order for a header row: indices into Monday-first name tables.
export const weekdayOrder = (weekStart = 0) => Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);

// The months a list of days touches, in order: [{ year, month, days: [...] }].
export function monthsOf(days) {
  const map = new Map();
  for (const raw of days || []) {
    const d = parseDay(raw);
    if (!d) continue;
    const k = d.slice(0, 7);
    if (!map.has(k)) map.set(k, { year: +k.slice(0, 4), month: +k.slice(5, 7), days: [] });
    if (!map.get(k).days.includes(d)) map.get(k).days.push(d);
  }
  return [...map.keys()].sort().map((k) => ({ ...map.get(k), days: map.get(k).days.sort() }));
}

// Multi-day spans ({ start, end } inclusive days) placed into lanes so that no two spans of a lane overlap
// (greedy by start, longest first on ties): [{ item, start, end, lane, length }].
// Interval partitioning, greedy: sorted by start, each span takes the first lane whose last span ended before it.
// With start order this uses the minimum number of lanes; longest-first on equal starts keeps long bars on top.
export function layoutSpans(items, { startOf = (x) => x.start, endOf = (x) => x.end || x.start } = {}) {
  const list = items.map((item) => {
    const s = (splitDateTime(startOf(item)) || {}).day, e = (splitDateTime(endOf(item)) || {}).day || s;
    return s ? { item, start: s, end: e < s ? s : e } : null;
  }).filter(Boolean).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : dayDiff(b.end, b.start) - dayDiff(a.end, a.start)));
  const laneEnds = [];
  for (const x of list) {
    let lane = laneEnds.findIndex((e) => e < x.start);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(''); }
    laneEnds[lane] = x.end;
    x.lane = lane;
    x.length = dayDiff(x.end, x.start) + 1;
  }
  return list;
}
