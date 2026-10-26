// calendar/rrule.js - recurrence rules (RFC 5545 §3.3.10): parse / format RRULE text and expand it into occurrences.
// FREQ DAILY / WEEKLY / MONTHLY / YEARLY with INTERVAL, COUNT, UNTIL, BYDAY (with ordinals: 2MO, -1FR), BYMONTHDAY
// (negative from the month end), BYMONTH, BYSETPOS and WKST. Expansion works on wall-clock values ('YYYY-MM-DD' or
// 'YYYY-MM-DDTHH:MM[:SS]'), so a weekly 19:00 stays 19:00 across DST changes; the start is always the first
// occurrence (as the standard counts it), COUNT counts before EXDATE removes anything.
import { addDays, addMonths, daysInMonth, isoDow, parseDay, splitDateTime, startOfWeek, zonedParts } from './date.js';

//
// Expansion model: period k of the rule (day / week / month / year number k * INTERVAL from the start) yields its
// candidate days (periodDays: BYxxx filters and expansions, then BYSETPOS); candidates are emitted in order until
// COUNT, UNTIL, the output bound or the limit stops. Working per period, not per day, keeps sparse rules
// ("2nd Monday of every 3rd month") O(occurrences) instead of O(days).
// Wall-clock strings compare chronologically, so all bounds checks are plain string comparisons.
export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const FREQS = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
const pad = (n) => String(n).padStart(2, '0');
const ints = (v) => String(v).split(',').map((x) => parseInt(x, 10)).filter((x) => Number.isFinite(x) && x !== 0);

// 'FREQ=WEEKLY;BYDAY=MO,WE' -> { freq: 'weekly', interval: 1, byDay: ['MO', 'WE'], … } (unknown parts are kept in
// `x`). UNTIL becomes a model value: 'YYYY-MM-DD', 'YYYY-MM-DDTHH:MM:SS' or '…Z'.
// Lenient parser: invalid values degrade to defaults (INTERVAL 1, unknown BYDAY tokens dropped) and unknown parts
// survive in x so formatRRule can round-trip rules this module does not understand (BYHOUR, BYWEEKNO ...).
export function parseRRule(text) {
  const rule = { freq: '', interval: 1 };
  for (const part of String(text).replace(/^RRULE:/i, '').split(';')) {
    const [k0, v = ''] = part.split('=');
    const k = k0.trim().toUpperCase(), val = v.trim();
    if (!k) continue;
    if (k === 'FREQ') rule.freq = val.toLowerCase();
    else if (k === 'INTERVAL') rule.interval = Math.max(1, parseInt(val, 10) || 1);
    else if (k === 'COUNT') rule.count = Math.max(0, parseInt(val, 10) || 0);
    else if (k === 'UNTIL') {
      const r = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(val);
      if (r) rule.until = `${r[1]}-${r[2]}-${r[3]}` + (r[4] ? `T${r[4]}:${r[5]}:${r[6]}${r[7] || ''}` : '');
    } else if (k === 'BYDAY') rule.byDay = val.toUpperCase().split(',').filter((d) => /^[+-]?\d{0,2}(MO|TU|WE|TH|FR|SA|SU)$/.test(d));
    else if (k === 'BYMONTHDAY') rule.byMonthDay = ints(val).filter((d) => Math.abs(d) <= 31);
    else if (k === 'BYMONTH') rule.byMonth = ints(val).filter((m) => m >= 1 && m <= 12);
    else if (k === 'BYSETPOS') rule.bySetPos = ints(val);
    else if (k === 'WKST') rule.wkst = val.toUpperCase();
    else (rule.x = rule.x || {})[k] = val;
  }
  return rule;
}

// Rule object -> 'FREQ=…;…' (UNTIL as DATE or DATE-TIME; a wall-clock UNTIL is written as given).
export function formatRRule(rule) {
  const parts = ['FREQ=' + String(rule.freq || 'daily').toUpperCase()];
  if (rule.interval > 1) parts.push('INTERVAL=' + (rule.interval | 0));
  if (rule.count) parts.push('COUNT=' + (rule.count | 0));
  else if (rule.until) {
    const p = splitDateTime(rule.until);
    if (p) parts.push('UNTIL=' + p.day.replace(/-/g, '') + (p.time ? 'T' + (p.time + ':00').slice(0, 8).replace(/:/g, '') + (/Z$/.test(rule.until) ? 'Z' : '') : ''));
  }
  if (rule.byMonth && rule.byMonth.length) parts.push('BYMONTH=' + rule.byMonth.join(','));
  if (rule.byMonthDay && rule.byMonthDay.length) parts.push('BYMONTHDAY=' + rule.byMonthDay.join(','));
  if (rule.byDay && rule.byDay.length) parts.push('BYDAY=' + rule.byDay.join(','));
  if (rule.bySetPos && rule.bySetPos.length) parts.push('BYSETPOS=' + rule.bySetPos.join(','));
  if (rule.wkst && rule.wkst !== 'MO') parts.push('WKST=' + rule.wkst);
  for (const [k, v] of Object.entries(rule.x || {})) parts.push(`${k}=${v}`);
  return parts.join(';');
}

// '2MO' -> { n: 2, wd: 0 }.
const byDayParts = (list) => (list || []).map((d) => { const r = /^([+-]?\d{0,2})(MO|TU|WE|TH|FR|SA|SU)$/.exec(d); return { n: r[1] ? parseInt(r[1], 10) : 0, wd: WEEKDAYS.indexOf(r[2]) }; });

// Days of month (y, m) matching BYDAY entries; ordinals count within the month.
// First occurrence of weekday wd in the month = 1 + (wd - weekday of the 1st) mod 7; the rest step by 7. Ordinal n
// picks the n-th (or n-th from the end for negative n); a missing 5th occurrence yields nothing, per RFC 5545.
function monthWeekdays(y, m, byDay) {
  const out = [];
  const len = daysInMonth(y, m);
  const first = isoDow(`${y}-${pad(m)}-01`);
  for (const { n, wd } of byDay) {
    const days = [];
    for (let d = 1 + ((wd - first + 7) % 7); d <= len; d += 7) days.push(d);
    if (!n) out.push(...days);
    else { const d = n > 0 ? days[n - 1] : days[days.length + n]; if (d) out.push(d); }
  }
  return out;
}
const monthDays = (y, m, byMonthDay) => byMonthDay.map((d) => (d > 0 ? d : daysInMonth(y, m) + d + 1)).filter((d) => d >= 1 && d <= daysInMonth(y, m));

// Candidate days of one period, sorted and de-duplicated.
function periodDays(rule, k, start, byDay) {
  const [sy, sm, sd] = [+start.slice(0, 4), +start.slice(5, 7), +start.slice(8, 10)];
  const step = k * rule.interval;
  const inMonths = (day) => !rule.byMonth || !rule.byMonth.length || rule.byMonth.includes(+day.slice(5, 7));
  let days = [];
  if (rule.freq === 'daily') {
    const day = addDays(start, step);
    const md = rule.byMonthDay && rule.byMonthDay.length ? monthDays(+day.slice(0, 4), +day.slice(5, 7), rule.byMonthDay) : null;
    if ((!md || md.includes(+day.slice(8, 10))) && (!byDay.length || byDay.some((b) => b.wd === isoDow(day)))) days = [day];
  } else if (rule.freq === 'weekly') {
    const wkst = Math.max(0, WEEKDAYS.indexOf(rule.wkst || 'MO'));
    const ws = addDays(startOfWeek(start, wkst), step * 7);
    const wds = byDay.length ? byDay.map((b) => b.wd) : [isoDow(start)];
    days = wds.map((wd) => addDays(ws, (wd - wkst + 7) % 7));
  } else if (rule.freq === 'monthly') {
    const first = addMonths(`${sy}-${pad(sm)}-01`, step);
    days = monthCandidates(+first.slice(0, 4), +first.slice(5, 7), rule, byDay, sd);
  } else if (rule.freq === 'yearly') {
    const y = sy + step;
    const months = rule.byMonth && rule.byMonth.length ? rule.byMonth : null;
    if (months) for (const m of months) days.push(...monthCandidates(y, m, rule, byDay, sd));
    else if (byDay.length && !(rule.byMonthDay && rule.byMonthDay.length)) {
      // BYDAY in a yearly rule without BYMONTH: ordinals count within the year.
      for (const { n, wd } of byDay) {
        const all = [];
        for (let d = addDays(`${y}-01-01`, (wd - isoDow(`${y}-01-01`) + 7) % 7); d.startsWith(String(y)); d = addDays(d, 7)) all.push(d);
        if (!n) days.push(...all); else { const d = n > 0 ? all[n - 1] : all[all.length + n]; if (d) days.push(d); }
      }
    } else if (rule.byMonthDay && rule.byMonthDay.length) days = monthCandidates(y, sm, rule, byDay, sd);
    else if (sd <= daysInMonth(y, sm)) days = [`${y}-${pad(sm)}-${pad(sd)}`];
  }
  days = [...new Set(days.filter((d) => d && inMonths(d)))].sort();
  if (rule.bySetPos && rule.bySetPos.length) {
    const n = days.length;
    days = [...new Set(rule.bySetPos.map((p) => days[p > 0 ? p - 1 : n + p]).filter(Boolean))].sort();
  }
  return days;
}
function monthCandidates(y, m, rule, byDay, startDay) {
  const md = rule.byMonthDay && rule.byMonthDay.length ? monthDays(y, m, rule.byMonthDay) : null;
  const wd = byDay.length ? monthWeekdays(y, m, byDay) : null;
  let list;
  if (md && wd) list = md.filter((d) => wd.includes(d));
  else list = md || wd || (startDay <= daysInMonth(y, m) ? [startDay] : []);
  return list.map((d) => `${y}-${pad(m)}-${pad(d)}`);
}

// Occurrences of `rule` (object or text) from `start`. Options: from / to (inclusive bounds on the output, days or
// wall-clock values), limit (default 1000), exdate (values to skip), tz (zone that turns a UTC UNTIL into wall
// clock; default UTC). Returns values in the form of `start`.
// A UNTIL in UTC ('...Z') is converted to the event's wall clock via tz before comparing; a date-only UNTIL with a
// timed start means "through the end of that day". The guards (2000 consecutive empty periods, k > 200000) stop
// rules that can never match (BYMONTHDAY=31 with BYMONTH=2) instead of spinning forever.
export function expandRRule(start, rule, { from = '', to = '', limit = 1000, exdate = [], tz = 'UTC' } = {}) {
  const r = typeof rule === 'string' ? parseRRule(rule) : { interval: 1, ...rule, freq: String(rule.freq || '').toLowerCase() };
  r.interval = Math.max(1, r.interval | 0 || 1);
  const sp = splitDateTime(start);
  if (!sp || !FREQS.includes(r.freq.toUpperCase())) return [];
  const time = sp.time ? (sp.time + ':00').slice(0, 8) : '';
  const value = (day) => (time ? `${day}T${time}` : day);
  const norm = (v) => { const p = splitDateTime(v); return p ? (p.time ? `${p.day}T${(p.time + ':00').slice(0, 8)}` : p.day) : ''; };
  let until = '';
  if (r.until) {
    if (/Z$/.test(r.until)) { const z = zonedParts(Date.parse(r.until), tz); until = time ? `${z.day}T${z.time}` : z.day; }
    else until = norm(r.until);
    if (until.length === 10 && time) until += 'T23:59:59';
  }
  const lo = from ? norm(from) : '', hi = to ? (norm(to).length === 10 && time ? norm(to) + 'T23:59:59' : norm(to)) : '';
  const skip = new Set(exdate.map((x) => norm(String(x).replace(/Z$/, ''))));
  const byDay = byDayParts(r.byDay);
  const first = value(sp.day);
  const out = [];
  let count = 0;
  const emit = (v) => {
    count++;
    if (!skip.has(v) && (!lo || v >= lo) && (!hi || v <= hi)) out.push(v);
  };
  emit(first);
  let empty = 0;
  for (let k = 0; out.length < limit && empty < 2000; k++) {
    const days = periodDays(r, k, sp.day, byDay);
    empty = days.length ? 0 : empty + 1;
    for (const d of days) {
      const v = value(d);
      if (v <= first) continue;
      if (r.count && count >= r.count) return out;
      if (until && v > until) return out;
      if (hi && v > hi) return out;
      emit(v);
      if (out.length >= limit) return out;
    }
    if (r.count && count >= r.count) return out;
    if (k > 200000) break;
  }
  return out;
}

// Short English description: 'every 2 weeks on Mon, Wed, 10 times'.
export function describeRRule(rule) {
  const r = typeof rule === 'string' ? parseRRule(rule) : rule;
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[String(r.freq).toLowerCase()] || 'period';
  const names = { MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun' };
  const ord = (n) => (n === -1 ? 'last ' : n < 0 ? `${-n}th last ` : n ? `${n}${[, 'st', 'nd', 'rd'][n] || 'th'} ` : '');
  let s = r.interval > 1 ? `every ${r.interval} ${unit}s` : `every ${unit}`;
  if (r.byDay && r.byDay.length) s += ' on ' + byDayParts(r.byDay).map((b) => ord(b.n) + names[WEEKDAYS[b.wd]]).join(', ');
  if (r.byMonthDay && r.byMonthDay.length) s += ' on day ' + r.byMonthDay.join(', ');
  if (r.count) s += `, ${r.count} times`;
  else if (r.until) s += `, until ${parseDay(r.until.slice(0, 10))}`;
  return s;
}
