// calendar/roster.js - shift rosters: shift length with the overnight wrap (22:00-06:00 is 8 hours), shifts as
// absolute minute spans (so a night shift collides with the next morning's shift), conflict checks (overlap, too
// little rest, approved absence), per-member weekly totals by ISO week, coverage of a day, and a timesheet that sets
// planned hours against clock-in / clock-out entries (late arrivals, missed shifts, overtime).
//
// A shift is { id?, member, day: 'YYYY-MM-DD', start: 'HH:MM', end: 'HH:MM', ... }; an absence is
// { member, from, to (inclusive days), kind?, status? ('approved' blocks; anything else is ignored) }.
import { dayNumber, isoWeekKey, parseDay, parseTime, zonedToUtc } from './date.js';

//
// Time model: shifts are wall-clock spans in minutes since 1970 (day number * 1440 + minute). Overlap and rest checks
// are then integer comparisons and a night shift naturally extends into the next day. DST is ignored in these spans
// (a shift over the switch counts its nominal hours), the convention of most rostering and payroll rules; only the
// timesheet, which compares with real clock-ins, converts to instants via zonedToUtc.
const round2 = (x) => Math.round(x * 100) / 100;

// Hours of a shift; an end at or before the start wraps past midnight (a 00:00-00:00 shift is 24 hours).
export function shiftHours(start, end) {
  const s = parseTime(start), e = parseTime(end);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 0;
  const m = e - s;
  return round2((m <= 0 ? m + 1440 : m) / 60);
}
export const isOvernight = (start, end) => parseTime(end) <= parseTime(start);

// [startMinute, endMinute) since 1970-01-01 in wall-clock minutes.
export function shiftSpan(sh) {
  const base = dayNumber(sh.day || sh.date) * 1440;
  const s = parseTime(sh.start);
  return [base + s, base + s + shiftHours(sh.start, sh.end) * 60];
}
export const spansOverlap = (a, b) => a[0] < b[1] && b[0] < a[1];

// Problems of one shift against the others: [{ kind: 'overlap' | 'rest' | 'absent', with?, absence?, gapHours? }].
// Options: absences, minRest (hours required between two shifts of the same member, 0 = off).
export function shiftConflicts(shift, others = [], { absences = [], minRest = 0 } = {}) {
  const out = [];
  const a = shiftSpan(shift);
  for (const o of others) {
    if (o === shift || (shift.id != null && o.id === shift.id) || o.member !== shift.member) continue;
    const b = shiftSpan(o);
    if (spansOverlap(a, b)) out.push({ kind: 'overlap', with: o });
    else if (minRest > 0) {
      const gap = (a[0] >= b[1] ? a[0] - b[1] : b[0] - a[1]) / 60;
      if (gap < minRest) out.push({ kind: 'rest', with: o, gapHours: round2(gap) });
    }
  }
  const day = parseDay(shift.day || shift.date);
  for (const x of absences) {
    if (x.member !== shift.member || (x.status && x.status !== 'approved')) continue;
    if (x.from <= day && day <= (x.to || x.from)) out.push({ kind: 'absent', absence: x });
  }
  return out;
}

// Every conflict of a roster once: [{ kind, shift, with?, absence?, gapHours? }].
// Each pair is checked once (i against i+1..n), so an overlap is reported on the earlier shift only; absences are
// checked separately per shift. O(n^2) in shifts: fine for a team roster of hundreds of shifts.
export function rosterConflicts(shifts, opts = {}) {
  const out = [];
  shifts.forEach((s, i) => {
    for (const c of shiftConflicts(s, shifts.slice(i + 1), { ...opts, absences: [] })) out.push({ shift: s, ...c });
    for (const c of shiftConflicts(s, [], { absences: opts.absences || [] })) out.push({ shift: s, ...c });
  });
  return out;
}

// Hours per member and ISO week of the shift's start day: [{ member, week: '2026-W43', hours, shifts }], sorted.
export function weeklyTotals(shifts) {
  const map = new Map();
  for (const s of shifts) {
    const week = isoWeekKey(parseDay(s.day || s.date));
    const k = s.member + '\u0000' + week;
    if (!map.has(k)) map.set(k, { member: s.member, week, hours: 0, shifts: 0 });
    const r = map.get(k);
    r.hours = round2(r.hours + shiftHours(s.start, s.end));
    r.shifts++;
  }
  return [...map.values()].sort((x, y) => (x.week < y.week ? -1 : x.week > y.week ? 1 : String(x.member).localeCompare(String(y.member))));
}

// How many members work at each hour of a day (night shifts of the day before included): 24 counts.
export function dayCoverage(shifts, day) {
  const base = dayNumber(day) * 1440;
  const counts = new Array(24).fill(0);
  for (const s of shifts) {
    const [a, b] = shiftSpan(s);
    for (let h = 0; h < 24; h++) if (a < base + (h + 1) * 60 && base + h * 60 < b) counts[h]++;
  }
  return counts;
}

// Planned against actual: entries { member, in, out? } (epoch ms; an open entry counts up to `now`, at most 12 h).
// Options: tz (zone of the shift wall clock), now, lateMinutes (grace, default 5), earlyHours (how early a clock-in
// still belongs to the shift, default 3). Rows: { member, shifts, planned, worked, overtime, late, missed }.
// Matching is per shift: the first clock-in from earlyHours before the start until the shift end (at least one hour
// after the start, so short shifts still catch a late arrival) belongs to it. A shift counts as missed only once it
// has ended (end <= now): a shift in progress without clock-in is not yet "missed". Open entries are capped at 12 h
// so a forgotten clock-out does not book days of work.
export function timesheet(shifts, entries, { tz = 'UTC', now = 0, lateMinutes = 5, earlyHours = 3 } = {}) {
  const members = [...new Set(shifts.map((s) => s.member).concat(entries.map((e) => e.member)))];
  return members.map((m) => {
    const my = shifts.filter((s) => s.member === m);
    const ents = entries.filter((e) => e.member === m).sort((a, b) => a.in - b.in);
    const worked = ents.reduce((t, e) => t + ((e.out != null ? e.out : Math.min(now || e.in, e.in + 12 * 3600000)) - e.in), 0) / 3600000;
    let late = 0, missed = 0;
    for (const s of my) {
      const st = zonedToUtc(parseDay(s.day || s.date), s.start, tz);
      const end = st + shiftHours(s.start, s.end) * 3600000;
      const first = ents.find((e) => e.in >= st - earlyHours * 3600000 && e.in < Math.max(end, st + 3600000));
      if (!first) { if (end <= now) missed++; } else if (first.in > st + lateMinutes * 60000) late++;
    }
    const planned = round2(my.reduce((t, s) => t + shiftHours(s.start, s.end), 0));
    const w = round2(worked);
    return { member: m, shifts: my.length, planned, worked: w, overtime: Math.max(0, round2(w - planned)), late, missed };
  }).sort((x, y) => y.planned - x.planned);
}
