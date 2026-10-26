// calendar/period.js - report periods and schedules: named period presets resolved against an explicit "today"
// (month to date, previous month, year to date, last N days, ISO weeks, quarters, custom ranges), the comparison
// period of a range, and the next run of a recurring report (daily / weekly / monthly at a local hour in a zone).
import { addDays, addMonths, dayDiff, daysInMonth, endOfMonth, isoDow, isoWeek, isoWeekStart, parseDay, startOfWeek, zonedParts, zonedToUtc } from './date.js';

export const PERIOD_PRESETS = ['today', 'yesterday', 'week', 'prevweek', 'last7', 'last30', 'mtd', 'month', 'prevmonth',
  'qtd', 'prevquarter', 'ytd', 'prevyear'];

// Ranges are inclusive day strings plus a day count; an inverted or invalid range is null, never a negative count.
const range = (from, to) => (from && to && from <= to ? { from, to, days: dayDiff(to, from) + 1 } : null);
const pad = (n) => String(n).padStart(2, '0');

// Preset -> { from, to, days } (inclusive days) or null. Presets: the PERIOD_PRESETS, a number or 'lastN' (N days
// ending today), 'isoweek:2026-W43' (or '2026-W43'), 'month:2026-09', 'year:2026', 'custom:2026-01-01..2026-03-31'
// (also 'a..b'). `today` is a 'YYYY-MM-DD' day (use dayInZone(now, tz) for the reader's day).
// "today" is an explicit input: report periods are resolved in the reader's zone (dayInZone), and tests can pin the
// date. Quarter start = month rounded down to 1 / 4 / 7 / 10.
export function periodRange(preset, today) {
  const p = String(preset == null ? '' : preset).trim();
  const t = parseDay(today);
  if (!t) return null;
  const y = +t.slice(0, 4), m = +t.slice(5, 7);
  const qStart = `${y}-${pad(Math.floor((m - 1) / 3) * 3 + 1)}-01`;
  let r;
  if (/^\d{1,4}$/.test(p) || (r = /^last(\d{1,4})$/i.exec(p))) { const n = +(r ? r[1] : p); return n ? range(addDays(t, 1 - n), t) : null; }
  switch (p) {
    case 'today': return range(t, t);
    case 'yesterday': return range(addDays(t, -1), addDays(t, -1));
    case 'week': return range(startOfWeek(t), t);
    case 'prevweek': { const s = addDays(startOfWeek(t), -7); return range(s, addDays(s, 6)); }
    case 'mtd': return range(t.slice(0, 8) + '01', t);
    case 'month': return range(t.slice(0, 8) + '01', endOfMonth(t));
    case 'prevmonth': { const s = addMonths(t.slice(0, 8) + '01', -1); return range(s, endOfMonth(s)); }
    case 'qtd': return range(qStart, t);
    case 'prevquarter': { const s = addMonths(qStart, -3); return range(s, addDays(qStart, -1)); }
    case 'ytd': return range(`${y}-01-01`, t);
    case 'prevyear': return range(`${y - 1}-01-01`, `${y - 1}-12-31`);
    default: break;
  }
  if ((r = /^(?:isoweek:)?(\d{4})-?W(\d{2})$/i.exec(p))) { const s = isoWeekStart(+r[1], +r[2]); return range(s, addDays(s, 6)); }
  if ((r = /^month:(\d{4})-(\d{2})$/.exec(p)) && +r[2] >= 1 && +r[2] <= 12) return range(`${r[1]}-${r[2]}-01`, `${r[1]}-${r[2]}-${pad(daysInMonth(+r[1], +r[2]))}`);
  if ((r = /^year:(\d{4})$/.exec(p))) return range(`${r[1]}-01-01`, `${r[1]}-12-31`);
  if ((r = /^(?:custom:)?(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(p))) return range(parseDay(r[1]), parseDay(r[2]));
  return null;
}

// The period to compare with: the same number of days right before (`mode: 'previous'`), or the same days a year
// earlier (`mode: 'year'`, Feb 29 clamps to Feb 28).
export function previousPeriod(r, mode = 'previous') {
  if (!r) return null;
  if (mode === 'year') return range(addMonths(r.from, -12), addMonths(r.to, -12));
  return range(addDays(r.from, -r.days), addDays(r.from, -1));
}

// Label of a range: '2026-10-01 – 2026-10-24', one day as itself, a whole ISO week as '2026-W43'.
export function periodLabel(r) {
  if (!r) return '';
  if (r.days === 1) return r.from;
  if (r.days === 7 && isoDow(r.from) === 0) { const w = isoWeek(r.from); return `${w.year}-W${pad(w.week)}`; }
  return `${r.from} – ${r.to}`;
}

// --- recurring schedules -------------------------------------------------------------------------------------------

// Next run strictly after `after` (epoch ms) of a schedule { freq: 'daily' | 'weekly' | 'monthly', hour = 9,
// minute = 0, weekday (1 = Monday … 7 = Sunday, weekly), monthday (1…31, or -1 = the last day; monthly, default 1;
// short months run on their last day), tz (IANA name, '+04:00' or minutes east of UTC) }. Returns epoch ms.
// Walks forward day by day in the schedule's zone and converts each candidate day + time to an instant, so DST
// changes keep the local hour (9:00 stays 9:00 local, the UTC instant moves). 400 days covers any monthly / weekly
// rule; the fallback (+1 day) only triggers for an unknown freq. Also accepts freq 'weekdays' (Mon-Fri).
export function nextRun(s, after) {
  const tz = s.tz == null ? 'UTC' : s.tz;
  const time = `${pad(Math.max(0, Math.min(23, s.hour == null ? 9 : s.hour | 0)))}:${pad(Math.max(0, Math.min(59, s.minute | 0)))}`;
  let day = zonedParts(after, tz).day;
  for (let i = 0; i < 400; i++, day = addDays(day, 1)) {
    if (!runsOn(s, day)) continue;
    const at = zonedToUtc(day, time, tz);
    if (at > after) return at;
  }
  return after + 86400000;
}
function runsOn(s, day) {
  const f = String(s.freq || 'daily');
  if (f === 'daily') return true;
  if (f === 'weekdays') return isoDow(day) < 5;
  if (f === 'weekly') return isoDow(day) + 1 === ((s.weekday | 0) || 1);
  if (f === 'monthly') {
    const len = daysInMonth(+day.slice(0, 4), +day.slice(5, 7)), d = +day.slice(8, 10);
    const want = s.monthday == null ? 1 : s.monthday | 0;
    return want < 0 ? d === Math.max(1, len + want + 1) : d === Math.min(want || 1, len);
  }
  return false;
}

// Every run in (from, to], at most `limit`.
export function runsBetween(s, from, to, limit = 1000) {
  const out = [];
  for (let t = nextRun(s, from); t <= to && out.length < limit; t = nextRun(s, t)) out.push(t);
  return out;
}

// The reader's local day of an instant: periodRange(preset, localDay(now, tz)).
export const localDay = (ms, tz) => zonedParts(ms, tz).day;
