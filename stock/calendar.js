// stock/calendar.js - calendar days as 'YYYY-MM-DD' strings: validation, day numbers, adding days, differences, ISO
// weekdays (1 = Monday … 7 = Sunday) and weeks back from a given day. Arithmetic runs on whole UTC day numbers, so
// time zones and daylight saving never move a date. Nothing reads the clock: callers pass `today`.

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS = 86_400_000;

// Days since 1970-01-01 of a valid day string; throws on anything else (a typo must not become NaN silently).
// Validation by round trip: Date.UTC silently normalises '2026-02-31' to March 3, so the parsed day is formatted back
// and compared with the input; any difference means the day does not exist.
export function dayNumber(day) {
  const m = RE.exec(String(day));
  if (!m) throw new RangeError(`day expected (YYYY-MM-DD): ${day}`);
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const n = t / MS;
  if (fromDayNumber(n) !== day) throw new RangeError(`no such day: ${day}`);
  return n;
}

export function fromDayNumber(n) {
  return new Date(n * MS).toISOString().slice(0, 10);
}

export function isDay(s) {
  try { dayNumber(s); return true; } catch { return false; }
}

export const addDays = (day, n) => fromDayNumber(dayNumber(day) + n);

// Whole days from `a` to `b` (positive when b is later).
export const daysBetween = (a, b) => dayNumber(b) - dayNumber(a);

// ISO weekday: 1970-01-01 was a Thursday (4).
// Double modulo keeps the result positive for days before 1970 (negative day numbers).
export const weekday = (day) => ((((dayNumber(day) + 3) % 7) + 7) % 7) + 1;

// Week bucket counted back from `today`: 0 for today and the six days before it, 1 for the week before, …;
// negative for days after `today`.
export const weeksBack = (day, today) => Math.floor(daysBetween(day, today) / 7);

// Inclusive length of a period in days ('2026-12-30'..'2027-01-08' -> 10).
export const periodDays = (from, to) => daysBetween(from, to) + 1;
