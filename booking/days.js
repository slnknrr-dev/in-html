// booking/days.js - calendar days as 'YYYY-MM-DD' strings: strict validation, integer day numbers, adding days and
// months, nights between two days, the occupied days of a stay, weekdays (Monday = 0) and a month grid for calendar
// views. Built on the integer civil-calendar arithmetic of contract/dates.js: no Date objects and no time zones, so a
// daylight-saving switch can never shift or skip a day (`new Date('2026-03-29') + 24 h` can, in a zone with DST).
//
//   isDay(v) -> bool                   dayNum(day) -> int (days since 1970-01-01)   dayIso(num) -> 'YYYY-MM-DD'
//   dayAdd(day, n)   monthAdd(day, n)  nightsBetween(from, to) (negative = reversed)  cmpDay(a, b) -> -1 | 0 | 1
//   eachDay(from, to) -> the days of [from, to)   monthStart(day)   monthOf(day) -> 'YYYY-MM'   daysInMonth('YYYY-MM')
//   weekday(day) -> 0 (Mon) … 6 (Sun)   isWeekend(day, weekend = [5, 6])   minDay / maxDay
//   monthGrid('YYYY-MM', { weekStart }) -> weeks of 7 cells, each a day string or null (outside the month)

import { dayNumber, daysInMonth as civilDays, fmtISO, fromDayNumber, monthAnchor } from '../contract/dates.js';

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})/;
// eachDay never returns more than ~5 years of days (a guard against typos such as 2206 for 2026).
export const MAX_DAYS = 1826;

// The single validator every function goes through: strict shape (zero-padded), real month/day (leap years via the
// civil calendar), year >= 1000 so 4-digit typos like '0202' fail. Everything else returns NaN / '' downstream
// instead of throwing - calendar UIs call these on every keystroke.
function parts(v) {
  const m = DAY_RE.exec(String(v ?? ''));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 1000 || mo < 1 || mo > 12 || d < 1 || d > civilDays(y, mo)) return null;
  return { y, m: mo, d };
}

// A 'YYYY-MM-DD' string naming a day that exists (2026-02-31 and 2026-8-16 are not days).
export const isDay = (v) => parts(v) !== null;

// Day number since 1970-01-01; NaN for anything that is not a day. Compare and subtract days only through this.
export function dayNum(day) {
  const p = parts(day);
  return p ? dayNumber(p) : NaN;
}

export const dayIso = (num) => (Number.isFinite(num) ? fmtISO(fromDayNumber(Math.round(num))) : '');

// Shifts a day by n days (n may be negative); '' for an invalid day.
export const dayAdd = (day, n) => dayIso(dayNum(day) + Math.trunc(Number(n) || 0));

// Shifts by n months keeping the day of the month, clamped to the target month (31 Jan + 1 = 28 / 29 Feb).
export function monthAdd(day, n) {
  const p = parts(day);
  return p ? fmtISO(monthAnchor(p.y, p.m, Math.trunc(Number(n) || 0), p.d)) : '';
}

// Nights of the half-open stay [from, to): the check-out day is not a night. Negative for a reversed interval.
export const nightsBetween = (from, to) => dayNum(to) - dayNum(from);

export function cmpDay(a, b) {
  const x = dayNum(a), y = dayNum(b);
  return Number.isFinite(x) && Number.isFinite(y) ? Math.sign(x - y) : NaN;
}

// Plain string sort is chronological for valid ISO days, so no dayNum round trip is needed.
export const minDay = (...days) => days.filter(isDay).sort()[0] || '';
export const maxDay = (...days) => days.filter(isDay).sort().pop() || '';

// The occupied days of [from, to): the check-out day is excluded (it is free for the next guest).
export function eachDay(from, to) {
  const out = [];
  const a = dayNum(from), b = dayNum(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return out;
  for (let i = a; i < b && out.length < MAX_DAYS; i++) out.push(dayIso(i));
  return out;
}

export const monthOf = (day) => (MONTH_RE.exec(String(day ?? '')) || [''])[0];
export const monthStart = (day) => (monthOf(day) ? monthOf(day) + '-01' : '');

// Days in the month of 'YYYY-MM' (or of a day); 0 for garbage.
export function daysInMonth(month) {
  const m = MONTH_RE.exec(String(month ?? ''));
  return m && +m[2] >= 1 && +m[2] <= 12 ? civilDays(+m[1], +m[2]) : 0;
}

// Day of the week with Monday = 0 (calendars in Georgia, Russia and most of Europe start on Monday).
// 1970-01-01 was a Thursday (3).
export function weekday(day) {
  const n = dayNum(day);
  // Double modulo: JS % keeps the sign, and days before 1970 have negative n.
  return Number.isFinite(n) ? (((n + 3) % 7) + 7) % 7 : NaN;
}

// Saturday and Sunday by default; `weekend` lists other weekday numbers (e.g. [4, 5] for Friday and Saturday nights).
export const isWeekend = (day, weekend = [5, 6]) => weekend.includes(weekday(day));

/**
 * The weeks of a month for a calendar view: an array of weeks, each 7 cells, a cell is a day string or null when it
 * falls outside the month. `weekStart`: 0 = Monday (default), 6 = Sunday.
 */
export function monthGrid(month, { weekStart = 0 } = {}) {
  const first = monthStart(month);
  const n = daysInMonth(month);
  if (!n) return [];
  const lead = (weekday(first) - weekStart + 7) % 7;
  const cells = Array(lead).fill(null);
  for (let i = 0; i < n; i++) cells.push(dayAdd(first, i));
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
