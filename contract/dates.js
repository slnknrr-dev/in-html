// contract/dates.js - calendar dates of contracts as ISO strings ('2027-01-23'): parsing (ISO and 'DD.MM.YYYY'),
// day numbers, adding days and months with month-end clamping, differences. Pure integer arithmetic on the proleptic
// Gregorian calendar (no time zones, no Date objects leaking out), years 1000-9999.
//
//   parseDate(s) -> { y, m, d } | null      isoDate(s) -> 'YYYY-MM-DD' | ''      fmtISO({ y, m, d })
//   isLeap(y)   daysInMonth(y, m)          dayNumber(dt) / fromDayNumber(n)  (days since 1970-01-01)
//   addDays(iso, n)   addMonths(iso, n, anchorDay?)   diffDays(a, b) (b - a)   monthsBetween(a, b)   cmpDate(a, b)
//   monthAnchor(y, m, k, day) -> { y, m, d }: month m + k of year y on `day`, clamped to the length of that month

// Why not Date: `new Date('2027-01-23')` is UTC but `new Date(2027, 0, 23)` is local; getDate() after adding
// 86400000 ms shifts across DST in some zones. A contract date is a civil date with no zone, so integers it is.
// Range 1000-9999: four-digit years keep fmtISO round-trippable and reject typos like 0202 or 20277.
export const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const daysInMonth = (y, m) => (m === 2 && isLeap(y) ? 29 : MONTH_DAYS[m - 1]);

const pad = (n, w = 2) => String(n).padStart(w, '0');
export const fmtISO = (dt) => (dt ? `${pad(dt.y, 4)}-${pad(dt.m)}-${pad(dt.d)}` : '');

// 'YYYY-MM-DD' (an ISO date-time is cut to its date), 'DD.MM.YYYY' or 'DD/MM/YYYY'; null for anything else or an
// impossible day (2027-02-29).
export function parseDate(s) {
  if (s && typeof s === 'object' && Number.isInteger(s.y)) s = fmtISO(s);
  if (typeof s !== 'string') return null;
  const t = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(t);
  let y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(t))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else return null;
  if (y < 1000 || y > 9999 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return { y, m: mo, d };
}
export const isoDate = (s) => fmtISO(parseDate(s));

// Days since 1970-01-01 (Howard Hinnant's days_from_civil), exact for every year of the range.
// Idea: shift the year to start on 1 March, so the leap day is the LAST day of the shifted year and month lengths
// follow the 153-days-per-5-months pattern ((153*mp+2)/5). Eras of 400 years (146097 days) repeat exactly, so the
// arithmetic is closed-form with no loops or tables. 719468 = days from 0000-03-01 to 1970-01-01.
// Math.floor (not |0 or trunc) keeps the division correct for negative years/day numbers.
export function dayNumber(dt) {
  let { y } = dt;
  const { m, d } = dt;
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
// Inverse (civil_from_days). yoe uses the leap corrections at 1460 (4y), 36524 (100y), 146096 (last day of the
// era) to find the year-of-era without iteration; mp < 10 maps March-based months back to 3..12, else 1..2 of the
// next civil year.
export function fromDayNumber(n) {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

// ((mi % 12) + 12) % 12: JS % keeps the sign of the dividend, so k < 0 would give negative months without it.
// The anchor day is passed separately so a schedule anchored on the 31st returns to 31 after a short month
// (31 Jan -> 28 Feb -> 31 Mar), instead of drifting to the 28th forever as chained addMonths(…, 1) would.
export function monthAnchor(y, m, k, day) {
  const mi = (m - 1) + k;
  const yy = y + Math.floor(mi / 12);
  const mm = ((mi % 12) + 12) % 12 + 1;
  return { y: yy, m: mm, d: Math.min(day, daysInMonth(yy, mm)) };
}

export function addDays(iso, n) {
  const dt = parseDate(iso);
  if (!dt || !Number.isFinite(+n)) return '';
  return fmtISO(fromDayNumber(dayNumber(dt) + Math.trunc(+n)));
}

// Month arithmetic keeps the day (or anchorDay) and clamps it to the target month: 31 Jan + 1 month = 28 / 29 Feb.
export function addMonths(iso, n, anchorDay) {
  const dt = parseDate(iso);
  if (!dt || !Number.isFinite(+n)) return '';
  return fmtISO(monthAnchor(dt.y, dt.m, Math.trunc(+n), anchorDay || dt.d));
}

export function diffDays(a, b) {
  const x = parseDate(a), y = parseDate(b);
  return x && y ? dayNumber(y) - dayNumber(x) : null;
}

// Whole months from a to b (23 Jan -> 22 Feb is 0, 23 Jan -> 23 Feb is 1; month-end anchors count as whole months).
export function monthsBetween(a, b) {
  const x = parseDate(a), y = parseDate(b);
  if (!x || !y) return null;
  // Calendar-month estimate, then step back one if the anchored date overshoots b. The correction is one-sided,
  // so for b < a the result is floored, not truncated (23 Mar -> 25 Feb gives -1, not 0).
  let n = (y.y - x.y) * 12 + (y.m - x.m);
  const anchor = monthAnchor(x.y, x.m, n, x.d);
  if (dayNumber(anchor) > dayNumber(y)) n--;
  return n;
}

export function cmpDate(a, b) {
  const x = parseDate(a), y = parseDate(b);
  if (!x || !y) return null;
  return Math.sign(dayNumber(x) - dayNumber(y));
}
