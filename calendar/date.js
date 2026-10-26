// calendar/date.js - civil dates without Date pitfalls: days are 'YYYY-MM-DD' strings and times 'HH:MM[:SS]', the
// arithmetic runs on UTC day numbers (never on the machine's zone), ISO weeks, and IANA time zones through Intl (the
// only zone source of an ES engine) with fixed offsets as a fallback. Every "now" is an explicit argument.

//
// Why strings and day numbers instead of Date objects: a Date is an instant, a calendar day is not. new Date(
// '2026-03-29') is midnight UTC, which is still March 28 in New York; local-time Date arithmetic breaks on DST days
// (23 or 25 hours). Day numbers are plain integers, so addDays is addition and diffs are subtraction. 'YYYY-MM-DD'
// strings also compare correctly with < and > (lexicographic = chronological), which grid.js relies on.
export const DAY_MS = 86400000;
const pad = (n, l = 2) => String(n).padStart(l, '0');

// 'YYYY-MM-DD' (also 'YYYYMMDD', a 'YYYY-MM-DDTHH:MM' prefix or 'DD.MM.YYYY' / 'DD/MM/YYYY') -> 'YYYY-MM-DD' or ''.
export function parseDay(raw) {
  const s = String(raw == null ? '' : raw).trim();
  let y, m, d;
  let r = /^(\d{4})-?(\d{2})-?(\d{2})(?![\d])/.exec(s);
  if (r) [y, m, d] = [+r[1], +r[2], +r[3]];
  else if ((r = /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?!\d)/.exec(s))) [d, m, y] = [+r[1], +r[2], +r[3]];
  else return '';
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return '';
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

// 'HH:MM' or 'HH:MM:SS' (also 'H:MM', 'HHMM') -> minutes since midnight, or NaN. '24:00' is accepted (end of day).
export function parseTime(raw) {
  const r = /^(\d{1,2}):?(\d{2})(?::?(\d{2}))?$/.exec(String(raw == null ? '' : raw).trim());
  if (!r) return NaN;
  const h = +r[1], m = +r[2], s = +(r[3] || 0);
  if (m > 59 || s > 59 || h > 24 || (h === 24 && (m || s))) return NaN;
  return h * 60 + m + s / 60;
}
export const formatTime = (minutes) => { const t = Math.round(minutes); return `${pad(Math.floor(t / 60) % 24)}:${pad(t % 60)}`; };

export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const ymd = (day) => { const p = parseDay(day); return p ? [+p.slice(0, 4), +p.slice(5, 7), +p.slice(8, 10)] : null; };
export const dayOf = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };

// Day number (days since 1970-01-01) <-> day string.
export const dayNumber = (day) => { const p = ymd(day); return p ? Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / DAY_MS) : NaN; };
export const fromDayNumber = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
export const addDays = (day, n) => fromDayNumber(dayNumber(day) + n);
export const dayDiff = (day, from) => dayNumber(day) - dayNumber(from);
// Months are clamped: 2026-01-31 + 1 month = 2026-02-28.
export function addMonths(day, n) {
  const p = ymd(day);
  const t = p[0] * 12 + (p[1] - 1) + n, y = Math.floor(t / 12), m = (t % 12 + 12) % 12 + 1;
  return dayOf(y, m, Math.min(p[2], daysInMonth(y, m)));
}
// Weekday, Monday = 0 … Sunday = 6 (ISO order; JS getDay counts from Sunday).
// Day 0 (1970-01-01) was a Thursday (ISO index 3), hence +3; the double modulo keeps negative day numbers
// (before 1970) in range.
export const isoDow = (day) => ((dayNumber(day) % 7) + 7 + 3) % 7;
export const startOfWeek = (day, weekStart = 0) => addDays(day, -((isoDow(day) - weekStart + 7) % 7));
export const startOfMonth = (day) => day.slice(0, 8) + '01';
export const endOfMonth = (day) => { const p = ymd(day); return dayOf(p[0], p[1], daysInMonth(p[0], p[1])); };

// ISO 8601 week: { year, week } (the week belongs to the year of its Thursday).
export function isoWeek(day) {
  const thu = addDays(day, 3 - isoDow(day));
  const year = +thu.slice(0, 4);
  return { year, week: Math.floor(dayDiff(thu, `${year}-01-01`) / 7) + 1 };
}
export const isoWeekKey = (day) => { const w = isoWeek(day); return `${w.year}-W${pad(w.week)}`; };
// Monday of ISO week `week` of `year`; also accepts '2026-W43'.
export function isoWeekStart(year, week) {
  if (typeof year === 'string') { const r = /^(\d{4})-?W(\d{2})$/i.exec(year); if (!r) return ''; [year, week] = [+r[1], +r[2]]; }
  const jan4 = `${year}-01-04`;
  return addDays(startOfWeek(jan4), (week - 1) * 7);
}
export const isoWeeksInYear = (y) => isoWeek(`${y}-12-28`).week;

// Every day from `from` to `to` inclusive.
// Capped at 3700 days (~10 years) so a typo in a year cannot allocate millions of strings.
export function daysBetween(from, to) {
  const out = [];
  for (let n = dayNumber(from), e = dayNumber(to); n <= e && out.length < 3700; n++) out.push(fromDayNumber(n));
  return out;
}

// --- time zones ------------------------------------------------------------------------------------------------------

// One cached formatter per zone (construction is the expensive part). null is cached too, so an unknown zone name is
// not retried with a throwing constructor on every call. 'en-US' + h23 gives stable numeric parts to parse.
const FMT = new Map();
function fmtFor(tz) {
  if (!FMT.has(tz)) {
    let f = null;
    try { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { f = null; }
    FMT.set(tz, f);
  }
  return FMT.get(tz);
}
// '+04:00', '-0530', 'UTC+4', 'GMT-3' -> minutes east of UTC, or null.
function fixedOffset(tz) {
  if (/^(UTC|GMT|Z)$/i.test(tz)) return 0;
  const r = /^(?:UTC|GMT)?\s*([+-])(\d{1,2})(?::?(\d{2}))?$/i.exec(tz);
  return r ? (r[1] === '-' ? -1 : 1) * (+r[2] * 60 + +(r[3] || 0)) : null;
}
export const isTimeZone = (tz) => typeof tz === 'number' || fixedOffset(String(tz)) !== null || !!fmtFor(String(tz));

// Offset of a zone at an instant, in minutes east of UTC (Tbilisi +240). `tz` is an IANA name, a fixed offset string
// or a number of minutes. An unknown zone counts as UTC.
// Technique: format the instant as wall-clock parts in the zone, reinterpret those parts as if they were UTC, and
// subtract the instant: the difference is the zone offset at that instant (DST included). The instant is truncated
// to whole seconds because the formatted parts have no milliseconds. "+p.hour % 24" absorbs engines that print 24
// for midnight.
export function tzOffset(ms, tz) {
  if (typeof tz === 'number') return tz;
  if (tz == null || tz === '') return 0;
  const fixed = fixedOffset(String(tz));
  if (fixed !== null) return fixed;
  const f = fmtFor(String(tz));
  if (!f) return 0;
  const p = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Math.round((local - Math.floor(ms / 1000) * 1000) / 60000);
}

// Wall-clock parts of an instant in a zone: { day, time ('HH:MM:SS'), y, m, d, h, mi, s, dow, offset }.
export function zonedParts(ms, tz) {
  const off = tzOffset(ms, tz);
  const t = new Date(ms + off * 60000);
  const y = t.getUTCFullYear(), m = t.getUTCMonth() + 1, d = t.getUTCDate();
  const h = t.getUTCHours(), mi = t.getUTCMinutes(), s = t.getUTCSeconds();
  const day = `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
  return { day, time: `${pad(h)}:${pad(mi)}:${pad(s)}`, y, m, d, h, mi, s, dow: isoDow(day), offset: off };
}
export const dayInZone = (ms, tz) => zonedParts(ms, tz).day;

// Instant of a wall-clock time in a zone (two fixed-point steps over the offset; a time inside a DST gap lands an
// hour off, as in most calendar software).
// Inverse problem: the offset depends on the instant we are solving for. First guess uses the offset at the naive
// instant; the second step re-reads the offset at the corrected instant, which is right everywhere except inside the
// DST gap or overlap hour (an inherent ambiguity of wall-clock times).
export function zonedToUtc(day, time = '00:00', tz = 'UTC') {
  const p = ymd(day);
  const mins = parseTime(time) || 0;
  const naive = Date.UTC(p[0], p[1] - 1, p[2]) + Math.round(mins * 60) * 1000;
  const t = naive - tzOffset(naive, tz) * 60000;
  return naive - tzOffset(t, tz) * 60000;
}

// Day and time strings of an ISO-like value ('2026-08-14', '2026-08-14T16:00', '2026-08-14 16:00:30') without any
// zone conversion: { day, time ('' when absent), y, m, d } or null.
export function splitDateTime(raw) {
  const s = String(raw == null ? '' : raw).trim();
  const r = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (!r) return null;
  const day = parseDay(r[1]);
  if (!day) return null;
  if (r[2] && (+r[2] > 23 || +r[3] > 59)) return null;
  return { day, time: r[2] ? `${r[2]}:${r[3]}${r[4] ? ':' + r[4] : ''}` : '', y: +day.slice(0, 4), m: +day.slice(5, 7), d: +day.slice(8, 10) };
}
