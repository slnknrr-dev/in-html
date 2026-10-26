// booking/ics.js - iCalendar (RFC 5545) exchange of stays with channel calendars (the .ics feeds that rental
// platforms export and import): stays -> a VCALENDAR of all-day VEVENTs, and an .ics text -> stays. An all-day
// DTEND is exclusive, which is exactly the half-open stay [from, to): the check-out day maps to DTEND unchanged.
//
//   staysToIcs(stays, { name, prodId, domain, stamp }) -> text (CRLF lines, folded at 75 octets)
//     stays: [{ from, to, uid?, summary?, description?, status? }]; stamp: DTSTAMP as ISO / ms (an input, so the
//     output is reproducible); a stay without uid gets '<from>-<to>@<domain>'
//   icsToStays(text) -> [{ from, to, uid, summary, description }]  (date-times are cut to their date; a VEVENT
//     without DTEND lasts one night; cancelled events are skipped)
//   icsEscape(s) / icsUnescape(s)

import { dayAdd, isDay, nightsBetween } from './days.js';

// RFC 5545 section 3.3.11 TEXT escaping: backslash first (otherwise the escapes added next would be doubled), then
// ';' and ',' (value separators), newlines as the two characters "\n". ':' needs no escape in a value.
export const icsEscape = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
export const icsUnescape = (s) => String(s ?? '').replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));

const compact = (day) => day.replace(/-/g, '');
const utf8Len = (ch) => { const c = ch.codePointAt(0); return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; };

// Folds a content line at 75 octets (continuation lines start with one space), never inside a UTF-8 sequence.
function fold(line) {
  const out = [];
  let cur = '', len = 0;
  for (const ch of line) {
    const l = utf8Len(ch);
    if (len + l > 75) { out.push(cur); cur = ' '; len = 1; }
    cur += ch; len += l;
  }
  out.push(cur);
  return out.join('\r\n');
}

// DTSTAMP is required by RFC 5545 for every VEVENT; taking it as an input (not Date.now()) keeps the module free of
// the clock, so tests and repeated exports are byte-identical. Unparseable -> the epoch rather than an invalid line.
function stampOf(stamp) {
  const t = typeof stamp === 'number' ? stamp : Date.parse(String(stamp || ''));
  const iso = Number.isFinite(t) ? new Date(t).toISOString() : '1970-01-01T00:00:00.000Z';
  return iso.replace(/[-:]/g, '').replace(/\.\d+/, '');
}

// VALUE=DATE (all-day) instead of date-times: a night has no time zone, and platform importers block whole days.
// TRANSP:OPAQUE marks the time as busy; pending stays export as TENTATIVE so the channel can still block them.
// Default UID is derived from the dates, so re-exporting the same stay updates the event instead of duplicating it.
export function staysToIcs(stays, { name = '', prodId = '-//in-html//booking//EN', domain = 'booking.local', stamp } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:' + prodId, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  if (name) lines.push('X-WR-CALNAME:' + icsEscape(name));
  const dtstamp = stampOf(stamp);
  for (const s of stays || []) {
    if (!s || !isDay(s.from) || !isDay(s.to) || nightsBetween(s.from, s.to) < 1) continue;
    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + icsEscape(s.uid || `${s.from}-${s.to}@${domain}`));
    lines.push('DTSTAMP:' + dtstamp);
    lines.push('DTSTART;VALUE=DATE:' + compact(s.from));
    lines.push('DTEND;VALUE=DATE:' + compact(s.to));
    lines.push('SUMMARY:' + icsEscape(s.summary || 'Reserved'));
    if (s.description) lines.push('DESCRIPTION:' + icsEscape(s.description));
    if (s.status === 'pending') lines.push('STATUS:TENTATIVE');
    lines.push('TRANSP:OPAQUE');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

// 'YYYYMMDD' or 'YYYYMMDDTHHMMSS[Z]' -> 'YYYY-MM-DD' ('' for anything else).
function icsDay(v) {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(String(v || '').trim());
  const d = m ? `${m[1]}-${m[2]}-${m[3]}` : '';
  return isDay(d) ? d : '';
}

// Minimal line parser, not a full iCalendar parser: unfold (CRLF + space/tab), split name;params:value at the FIRST
// ':', and only look at VEVENT properties. Time zones are deliberately ignored - a date-time is cut to its date, which
// is right for the check-in/check-out stamps feeds actually send. Limitation: a parameter value containing a quoted
// ':' (TZID="Europe/X:Y") would split early; real feeds do not use such TZIDs. Nested components (VALARM) are
// transparent because only BEGIN/END:VEVENT change state.
export function icsToStays(text) {
  const raw = String(text ?? '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '');
  const out = [];
  let ev = null;
  for (const line of raw.split('\n')) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const head = line.slice(0, i), value = line.slice(i + 1);
    const name = head.split(';')[0].toUpperCase();
    if (name === 'BEGIN' && value.trim().toUpperCase() === 'VEVENT') { ev = { from: '', to: '', uid: '', summary: '', description: '', status: '' }; continue; }
    if (!ev) continue;
    if (name === 'END' && value.trim().toUpperCase() === 'VEVENT') {
      if (ev.from && ev.status !== 'CANCELLED') {
        const to = ev.to && nightsBetween(ev.from, ev.to) >= 1 ? ev.to : dayAdd(ev.from, 1);
        out.push({ from: ev.from, to, uid: ev.uid, summary: ev.summary, description: ev.description });
      }
      ev = null;
      continue;
    }
    if (name === 'DTSTART') ev.from = icsDay(value);
    else if (name === 'DTEND') ev.to = icsDay(value);
    else if (name === 'UID') ev.uid = icsUnescape(value);
    else if (name === 'SUMMARY') ev.summary = icsUnescape(value);
    else if (name === 'DESCRIPTION') ev.description = icsUnescape(value);
    else if (name === 'STATUS') ev.status = value.trim().toUpperCase();
  }
  return out;
}
