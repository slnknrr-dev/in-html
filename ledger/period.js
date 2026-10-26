// ledger/period.js - report periods and nights on explicit ISO days (no clock, no time zone: a day is 'YYYY-MM-DD',
// counted in UTC). A period has both bounds INCLUDED ("September: 01 to 30"); an empty bound is open. A stay is the
// half-open range [from, to): the night of the check-in day belongs to the stay, the check-out day gives no night.
//
//   isIsoDay(v), dayNum(day) -> days since 1970-01-01, dayIso(n), addDays(day, n), daysBetween(a, b)
//   monthEnd('2026-02') -> '2026-02-28'
//   periodOf({ month } | { from, to }) -> { from, to }     junk -> open bound; swapped bounds are swapped back
//   periodDays(p) -> days in a closed period (0 for an open one)
//   inPeriod(day, p) -> bool
//   clipNights(from, to, p) -> nights of the stay [from, to) inside the period
//   stayNights(from, to) -> nights of the stay
//   monthsOf(p) -> ['2026-09', '2026-10']

//
// Why string days and UTC: a booking night is a calendar fact, not an instant. Local-time Date arithmetic breaks on
// DST days (a 23-hour day rounds to the wrong date); UTC midnight has no DST, so dayNum is exact integer arithmetic.
// ISO strings also compare correctly as plain strings ('2026-09-30' < '2026-10-01'), which inPeriod relies on.

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

// Round-trip check: Date.parse accepts '2026-02-30' in some engines (rolling over to March 2); comparing the
// re-serialised date with the input rejects impossible days everywhere. Math.round in dayNum guards against
// non-integer quotients (there are none in UTC, but it costs nothing).
export function isIsoDay(v) {
  const s = String(v ?? '');
  if (!DAY_RE.test(s)) return false;
  const t = Date.parse(s + 'T00:00:00Z');
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}
export const dayNum = (d) => Math.round(Date.parse(String(d) + 'T00:00:00Z') / 864e5);
export const dayIso = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
export const addDays = (d, n) => dayIso(dayNum(d) + Math.trunc(n));
export const daysBetween = (a, b) => dayNum(b) - dayNum(a);

// Date.UTC(y, m, 0): month index m is 0-based, so (y, m) is the FOLLOWING month and day 0 is the last day of month m.
export function monthEnd(month) {
  const [y, m] = String(month).split('-').map(Number);
  return dayIso(dayNum(`${y}-${String(m).padStart(2, '0')}-01`) + new Date(Date.UTC(y, m, 0)).getUTCDate() - 1);
}

// `month` (a whole month) OR `from` / `to`. A bad value is an open bound, not an error: "all time" is a fair answer
// and an empty form field means it.
export function periodOf(q = {}) {
  const m = String(q.month ?? '').trim();
  if (MONTH_RE.test(m) && +m.slice(5) >= 1 && +m.slice(5) <= 12) return { from: m + '-01', to: monthEnd(m) };
  let from = isIsoDay(q.from) ? String(q.from) : '';
  let to = isIsoDay(q.to) ? String(q.to) : '';
  if (from && to && from > to) [from, to] = [to, from];
  return { from, to };
}

export const periodDays = (p) => (p && p.from && p.to ? Math.max(0, dayNum(p.to) - dayNum(p.from) + 1) : 0);

export const inPeriod = (day, p) => !!day && (!p || ((!p.from || day >= p.from) && (!p.to || day <= p.to)));

export function stayNights(from, to) {
  if (!isIsoDay(from) || !isIsoDay(to)) return 0;
  return Math.max(0, dayNum(to) - dayNum(from));
}

// Nights a..b-1 of the stay, cut to the period: a stay 29.09-03.10 gives September two nights.
// Closed period [p.from, p.to] becomes half-open [p.from, p.to + 1) so it intersects the half-open stay with plain
// max/min - mixing interval conventions is where off-by-one night counts come from.
export function clipNights(from, to, p) {
  if (!isIsoDay(from) || !isIsoDay(to)) return 0;
  let a = dayNum(from), b = dayNum(to);
  if (p && p.from) a = Math.max(a, dayNum(p.from));
  if (p && p.to) b = Math.min(b, dayNum(p.to) + 1);
  return Math.max(0, b - a);
}

// The 1200-iteration cap (100 years) bounds the loop for absurd periods typed by hand.
export function monthsOf(p) {
  if (!p || !p.from || !p.to) return [];
  const out = [];
  let [y, m] = p.from.slice(0, 7).split('-').map(Number);
  const end = p.to.slice(0, 7);
  for (let k = 0; k < 1200; k++) {
    const s = `${y}-${String(m).padStart(2, '0')}`;
    if (s > end) break;
    out.push(s);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}
