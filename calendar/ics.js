// calendar/ics.js - iCalendar (RFC 5545) write and read: VCALENDAR with VEVENT / VTODO / VALARM, all-day (VALUE=DATE),
// floating, TZID and UTC date-times, durations, RRULE / EXDATE, attendees and organizer, TEXT escaping, line folding
// at 75 octets without splitting UTF-8 characters, and a tolerant parser (unfolding, parameters with quoted and list
// values, nested components) that normalizes events back to the writer's model.
//
// Date values in the model: 'YYYY-MM-DD' (all-day), 'YYYY-MM-DDTHH:MM[:SS]' (wall clock: floating, or in `tz`),
// 'YYYY-MM-DDTHH:MM:SSZ', a Date or epoch milliseconds (UTC). All-day `end` is the inclusive last day (the file holds
// the exclusive DTEND the standard wants). Nothing reads the clock: DTSTAMP comes from `stamp` / `modified` / `start`.
import { addDays, parseDay, splitDateTime } from './date.js';
import { formatRRule, parseRRule } from './rrule.js';

//
// Security / robustness of the writer: every user string must be neutralised for the line-based format, because a
// raw CR/LF in a value starts a new property (property injection: an attacker-controlled title could add an
// ATTENDEE or a URL). TEXT values go through icsEscape, parameter values through paramValue, URLs and ids have CR/LF
// stripped. Limitation by design: TZID parameters name IANA zones without emitting VTIMEZONE blocks; Google,
// Apple and Outlook resolve IANA names themselves, strict RFC validators flag it.
const pad = (n, l = 2) => String(n).padStart(l, '0');

// --- TEXT values and lines ------------------------------------------------------------------------------------------

export const icsEscape = (v) => String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
  .replace(/\r\n|\r|\n/g, '\\n');
export const icsUnescape = (v) => String(v).replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));

// RFC 5545 folds at 75 OCTETS, not characters: Cyrillic or Georgian text counted by characters would produce lines
// over the limit, and splitting inside a UTF-8 sequence corrupts the character. Iterating with for..of walks code
// points (surrogate pairs stay together).
const utf8Len = (cp) => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);
// Folds a content line to lines of at most 75 octets; continuation lines start with one space.
export function foldLine(line, limit = 75) {
  let out = '', len = 0;
  for (const ch of line) {
    const n = utf8Len(ch.codePointAt(0));
    if (len + n > limit) { out += '\r\n '; len = 1; }
    out += ch; len += n;
  }
  return out;
}
export const unfoldLines = (text) => String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n').filter((l) => l.length);

// Parameter value: quoted when it holds ':' ';' ','; DQUOTE is not representable and is dropped (RFC 5545 §3.2).
const paramValue = (v) => { const s = String(v).replace(/["\r\n]/g, ''); return /[:;,]/.test(s) ? `"${s}"` : s; };
// One content line: prop('DTSTART', '20261024', { VALUE: 'DATE' }).
export function contentLine(name, value, params = {}) {
  let head = name.toUpperCase();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') head += `;${k.toUpperCase()}=${Array.isArray(v) ? v.map(paramValue).join(',') : paramValue(v)}`;
  return head + ':' + value;
}

// --- dates and durations ----------------------------------------------------------------------------------------

const compactDay = (day) => day.replace(/-/g, '');
function utcStamp(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}
const isUtcValue = (v) => v instanceof Date || typeof v === 'number' || /Z$|[+-]\d{2}:?\d{2}$/.test(String(v));
const msOf = (v) => (v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(String(v)));
// Any model value as a UTC DATE-TIME (DTSTAMP, CREATED, LAST-MODIFIED, COMPLETED); a wall clock counts as UTC.
function asUtcStamp(v) {
  if (isUtcValue(v) && Number.isFinite(msOf(v))) return utcStamp(msOf(v));
  const p = splitDateTime(v);
  if (!p) return '19700101T000000Z';
  const t = (p.time || '00:00').split(':');
  return `${compactDay(p.day)}T${t[0]}${t[1]}${t[2] || '00'}Z`;
}
// The calendar day of a model value (the UTC day of an instant).
const dayOfValue = (v) => (isUtcValue(v) ? new Date(msOf(v)).toISOString().slice(0, 10) : (splitDateTime(v) || {}).day || '');

// Model value -> { value, params } of a DATE / DATE-TIME property ('' when the value is unreadable).
export function icsDate(v, { tz = '', allDay = false } = {}) {
  if (v == null || v === '') return { value: '', params: {} };
  if (isUtcValue(v)) {
    const ms = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(String(v));
    if (!Number.isFinite(ms)) return { value: '', params: {} };
    return allDay ? { value: utcStamp(ms).slice(0, 8), params: { VALUE: 'DATE' } } : { value: utcStamp(ms), params: {} };
  }
  const p = splitDateTime(v);
  if (!p) return { value: '', params: {} };
  if (allDay || !p.time) return { value: compactDay(p.day), params: { VALUE: 'DATE' } };
  const t = p.time.split(':');
  return { value: `${compactDay(p.day)}T${t[0]}${t[1]}${t[2] || '00'}`, params: tz ? { TZID: tz } : {} };
}

// ICS value (+ its params) -> model value: 'YYYY-MM-DD', 'YYYY-MM-DDTHH:MM:SS' or '…Z'.
export function parseIcsDate(value, params = {}) {
  const r = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(value).trim());
  if (!r) return '';
  const day = parseDay(`${r[1]}-${r[2]}-${r[3]}`);
  if (!day) return '';
  if (!r[4] || params.VALUE === 'DATE') return day;
  return `${day}T${r[4]}:${r[5]}:${r[6] || '00'}${r[7] ? 'Z' : ''}`;
}

// Seconds <-> ISO 8601 / RFC 5545 duration ('-PT15M', 'P1DT2H', 'P2W').
// Weeks only when exact (P2W), since RFC 5545 forbids mixing W with other units; otherwise D / T H M S. Zero is
// 'PT0S' (an empty 'P' is invalid).
export function formatDuration(seconds) {
  const neg = seconds < 0;
  let s = Math.abs(Math.round(seconds));
  if (s && s % 604800 === 0) return (neg ? '-' : '') + `P${s / 604800}W`;
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  let out = (neg ? '-' : '') + 'P' + (d ? d + 'D' : '');
  if (h || m || s || !d) out += 'T' + (h ? h + 'H' : '') + (m ? m + 'M' : '') + (s || (!h && !m) ? s + 'S' : '');
  return out;
}
export function parseDuration(text) {
  const r = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(text).trim());
  if (!r || text.trim().replace(/^[+-]/, '') === 'P') return NaN;
  const s = (+r[2] || 0) * 604800 + (+r[3] || 0) * 86400 + (+r[4] || 0) * 3600 + (+r[5] || 0) * 60 + (+r[6] || 0);
  return r[1] === '-' ? -s : s;
}

// Adds seconds to a model value, keeping its form (day, wall clock or UTC).
function addSeconds(v, seconds) {
  if (/Z$/.test(v)) return new Date(Date.parse(v) + seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const p = splitDateTime(v);
  if (!p.time) return addDays(p.day, Math.round(seconds / 86400));
  const [h, m, s] = p.time.split(':').map(Number);
  const t = Date.UTC(p.y, p.m - 1, p.d, h, m, s || 0) + seconds * 1000;
  return new Date(t).toISOString().slice(0, 19);
}

// --- writing -----------------------------------------------------------------------------------------------------

const addr = (a) => (typeof a === 'string' ? { email: a } : a || {});
const mailto = (email) => 'mailto:' + String(email).replace(/^mailto:/i, '').replace(/[\r\n]/g, '');
const ATTENDEE_PARAMS = { name: 'CN', role: 'ROLE', partstat: 'PARTSTAT', cutype: 'CUTYPE', rsvp: 'RSVP' };

function alarmLines(a, title) {
  const out = ['BEGIN:VALARM'];
  const action = String(a.action || 'DISPLAY').toUpperCase();
  out.push('ACTION:' + action);
  // trigger: minutes before the start (number), a duration string, or an absolute UTC time.
  if (typeof a.trigger === 'number') out.push(`TRIGGER:${formatDuration(-a.trigger * 60)}`);
  else if (/^[+-]?P/.test(String(a.trigger || ''))) out.push(contentLine('TRIGGER', a.trigger, a.related === 'end' ? { RELATED: 'END' } : {}));
  else if (a.trigger) out.push(contentLine('TRIGGER', icsDate(a.trigger).value, { VALUE: 'DATE-TIME' }));
  else out.push('TRIGGER:-PT15M');
  if (action !== 'AUDIO') out.push('DESCRIPTION:' + icsEscape(a.description || title || 'Reminder'));
  if (action === 'EMAIL') {
    out.push('SUMMARY:' + icsEscape(a.summary || a.description || 'Reminder'));
    for (const at of a.attendees || []) out.push(contentLine('ATTENDEE', mailto(addr(at).email)));
  }
  if (a.repeat && a.duration) out.push('REPEAT:' + (a.repeat | 0), 'DURATION:' + (typeof a.duration === 'number' ? formatDuration(a.duration * 60) : a.duration));
  out.push('END:VALARM');
  return out;
}

// Common properties of VEVENT / VTODO.
// DTSTAMP is required; taken from model fields, never from the clock, so the same event always serialises to the
// same bytes (stable diffs, testable output).
// KNOWN DEFECT: status, class (and transp in eventLines, action in alarmLines, method in buildCalendar) are only
// upper-cased, not stripped of CR/LF, so such a value can inject extra properties. Fix: .replace(/[\r\n]/g, '')
// like URL, or validate against the enumerated values.
function commonLines(e, start) {
  const out = [];
  out.push('UID:' + icsEscape(e.uid || ''));
  out.push('DTSTAMP:' + asUtcStamp(e.stamp || e.modified || e.created || start));
  for (const [k, name] of [['created', 'CREATED'], ['modified', 'LAST-MODIFIED']]) if (e[k]) out.push(name + ':' + asUtcStamp(e[k]));
  if (e.title) out.push('SUMMARY:' + icsEscape(e.title));
  if (e.description) out.push('DESCRIPTION:' + icsEscape(e.description));
  if (e.location) out.push('LOCATION:' + icsEscape(e.location));
  if (e.geo && Number.isFinite(+e.geo.lat) && Number.isFinite(+e.geo.lon)) out.push(`GEO:${+e.geo.lat};${+e.geo.lon}`);
  if (e.url) out.push('URL:' + String(e.url).replace(/[\r\n]/g, ''));
  if (e.status) out.push('STATUS:' + String(e.status).toUpperCase());
  if (e.categories && e.categories.length) out.push('CATEGORIES:' + e.categories.map(icsEscape).join(','));
  if (e.class) out.push('CLASS:' + String(e.class).toUpperCase());
  if (e.priority != null) out.push('PRIORITY:' + (e.priority | 0));
  if (e.sequence != null) out.push('SEQUENCE:' + (e.sequence | 0));
  if (e.organizer) { const o = addr(e.organizer); out.push(contentLine('ORGANIZER', mailto(o.email), { CN: o.name })); }
  for (const at of e.attendees || []) {
    const a = addr(at), params = {};
    for (const [k, p] of Object.entries(ATTENDEE_PARAMS)) if (a[k] != null && a[k] !== '') params[p] = k === 'rsvp' ? (a[k] ? 'TRUE' : 'FALSE') : k === 'name' ? a[k] : String(a[k]).toUpperCase();
    out.push(contentLine('ATTENDEE', mailto(a.email), params));
  }
  return out;
}

function recurrenceLines(e, allDay) {
  const out = [];
  if (e.rrule) out.push('RRULE:' + (typeof e.rrule === 'string' ? e.rrule.replace(/^RRULE:/i, '') : formatRRule(e.rrule)));
  for (const [list, prop] of [[e.exdate, 'EXDATE'], [e.rdate, 'RDATE']]) {
    for (const x of list || []) { const d = icsDate(x, { tz: e.tz, allDay }); if (d.value) out.push(contentLine(prop, d.value, d.params)); }
  }
  return out;
}

// VEVENT lines. Fields: uid, start, end | duration (seconds or 'PT1H'), allDay, tz, title, description, location, geo,
// url, status, transp, categories, class, priority, sequence, organizer, attendees, rrule, exdate, rdate, alarms,
// stamp, created, modified, x (extra { 'X-NAME': value }).
// All-day events: the model keeps the inclusive last day (what people mean by "until Sunday"), the file gets the
// exclusive DTEND the standard requires (+1 day). All-day events default to TRANSP:TRANSPARENT so they do not block
// free/busy time (Google's convention).
export function eventLines(e) {
  const allDay = !!e.allDay || (typeof e.start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.start.trim()));
  const out = ['BEGIN:VEVENT', ...commonLines(e, e.start)];
  const s = icsDate(e.start, { tz: e.tz, allDay });
  if (s.value) out.push(contentLine('DTSTART', s.value, s.params));
  if (e.end) {
    const end = allDay ? addDays(dayOfValue(e.end), 1) : e.end;
    const d = icsDate(end, { tz: e.tz, allDay });
    if (d.value) out.push(contentLine('DTEND', d.value, d.params));
  } else if (e.duration != null) out.push('DURATION:' + (typeof e.duration === 'number' ? formatDuration(e.duration) : e.duration));
  else if (allDay && s.value) out.push(contentLine('DTEND', compactDay(addDays(dayOfValue(e.start), 1)), { VALUE: 'DATE' }));
  if (e.transp || allDay) out.push('TRANSP:' + String(e.transp || 'TRANSPARENT').toUpperCase());
  out.push(...recurrenceLines(e, allDay));
  for (const [k, v] of Object.entries(e.x || {})) if (/^X-[A-Z0-9-]+$/i.test(k)) out.push(k.toUpperCase() + ':' + icsEscape(v));
  for (const a of e.alarms || []) out.push(...alarmLines(a, e.title));
  out.push('END:VEVENT');
  return out;
}

// VTODO lines: uid, title, start, due, completed, percent, status (NEEDS-ACTION / COMPLETED / IN-PROCESS / CANCELLED),
// priority (1 high … 9 low), the common fields and alarms.
export function todoLines(t) {
  const out = ['BEGIN:VTODO', ...commonLines(t, t.start || t.due || t.stamp)];
  for (const [k, prop] of [['start', 'DTSTART'], ['due', 'DUE']]) {
    const d = icsDate(t[k], { tz: t.tz });
    if (d.value) out.push(contentLine(prop, d.value, d.params));
  }
  if (t.completed) out.push('COMPLETED:' + asUtcStamp(t.completed));
  if (t.percent != null) out.push('PERCENT-COMPLETE:' + Math.max(0, Math.min(100, t.percent | 0)));
  out.push(...recurrenceLines(t, false));
  for (const a of t.alarms || []) out.push(...alarmLines(a, t.title));
  out.push('END:VTODO');
  return out;
}

// A whole calendar file: { prodId, method, name, description, tz (X-WR-TIMEZONE), events, todos } -> CRLF text.
export function buildCalendar({ prodId = '-//in-html//calendar//EN', method = 'PUBLISH', name = '', description = '', tz = '', events = [], todos = [] } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:' + prodId.replace(/[\r\n]/g, ''), 'CALSCALE:GREGORIAN'];
  if (method) lines.push('METHOD:' + String(method).toUpperCase());
  if (name) lines.push('X-WR-CALNAME:' + icsEscape(name));
  if (description) lines.push('X-WR-CALDESC:' + icsEscape(description));
  if (tz) lines.push('X-WR-TIMEZONE:' + String(tz).replace(/[\r\n]/g, ''));
  for (const e of events) lines.push(...eventLines(e));
  for (const t of todos) lines.push(...todoLines(t));
  lines.push('END:VCALENDAR');
  return lines.map((l) => foldLine(l)).join('\r\n') + '\r\n';
}
export const buildEvent = (e, opts = {}) => buildCalendar({ ...opts, events: [e] });

// --- reading -----------------------------------------------------------------------------------------------------

// One content line -> { name, params: { NAME: value | value[] }, value } or null.
// Hand-written scanner rather than a regex: parameter values may be quoted and contain ':' ';' ',' (e.g.
// CN="Doe, John"), which a split on ':' gets wrong. Caret escapes of RFC 6868 (^n newline, ^' quote, ^^ caret) are
// decoded in parameter values.
// KNOWN DEFECT: the three replaces run in sequence, so "^^n" (a literal caret then n) decodes to "^" + newline.
// Fix: one pass, v.replace(/\^(n|'|\^)/g, (m, c) => (c === 'n' ? '\n' : c === "'" ? '"' : '^')).
export function parseContentLine(line) {
  let i = 0;
  const n = line.length;
  while (i < n && /[A-Za-z0-9-]/.test(line[i])) i++;
  if (!i) return null;
  const name = line.slice(0, i).toUpperCase();
  const params = {};
  while (line[i] === ';') {
    i++;
    const k0 = i;
    while (i < n && line[i] !== '=' && line[i] !== ':' && line[i] !== ';') i++;
    const key = line.slice(k0, i).toUpperCase();
    const vals = [];
    if (line[i] === '=') {
      i++;
      for (;;) {
        let v = '';
        if (line[i] === '"') { const e = line.indexOf('"', i + 1); v = line.slice(i + 1, e < 0 ? n : e); i = e < 0 ? n : e + 1; }
        else { const s0 = i; while (i < n && line[i] !== ',' && line[i] !== ';' && line[i] !== ':') i++; v = line.slice(s0, i); }
        vals.push(v.replace(/\^n/g, '\n').replace(/\^'/g, '"').replace(/\^\^/g, '^'));
        if (line[i] === ',') { i++; continue; }
        break;
      }
    }
    params[key] = vals.length === 1 ? vals[0] : vals;
  }
  if (line[i] !== ':') return null;
  return { name, params, value: line.slice(i + 1) };
}

// Text -> component tree { name: 'VCALENDAR', props: [{ name, params, value }], components: [...] } (the first
// top-level component; text outside BEGIN / END is ignored, unbalanced END lines are skipped).
// Tolerant by design: files from Outlook, Google, Apple and hand-written ones disagree in details; malformed lines
// are skipped and a mismatched END is ignored rather than aborting the whole import.
export function parseICS(text) {
  const root = { name: '', props: [], components: [] };
  const stack = [root];
  for (const line of unfoldLines(text)) {
    const p = parseContentLine(line);
    if (!p) continue;
    const top = stack[stack.length - 1];
    if (p.name === 'BEGIN') { const c = { name: p.value.trim().toUpperCase(), props: [], components: [] }; top.components.push(c); stack.push(c); }
    else if (p.name === 'END') { if (stack.length > 1 && top.name === p.value.trim().toUpperCase()) stack.pop(); }
    else if (stack.length > 1) top.props.push(p);
  }
  return root.components[0] || { name: 'VCALENDAR', props: [], components: [] };
}

const prop = (c, name) => c.props.find((p) => p.name === name) || null;
const props = (c, name) => c.props.filter((p) => p.name === name);
const text = (c, name) => { const p = prop(c, name); return p ? icsUnescape(p.value) : ''; };
const dateOf = (c, name) => { const p = prop(c, name); return p ? parseIcsDate(p.value, p.params) : ''; };
const tzOf = (c, name) => { const p = prop(c, name); return p && typeof p.params.TZID === 'string' ? p.params.TZID : ''; };
const person = (p) => {
  const o = { email: p.value.replace(/^mailto:/i, '') };
  if (p.params.CN) o.name = p.params.CN;
  for (const [k, n] of Object.entries(ATTENDEE_PARAMS)) if (k !== 'name' && p.params[n]) o[k] = k === 'rsvp' ? /^true$/i.test(p.params[n]) : String(p.params[n]).toLowerCase();
  return o;
};
const splitList = (v) => v.split(/(?<!\\),/).map(icsUnescape).filter(Boolean);
const dateList = (c, name) => props(c, name).flatMap((p) => p.value.split(',').map((v) => parseIcsDate(v, p.params)).filter(Boolean));

function readAlarm(a) {
  const tr = prop(a, 'TRIGGER');
  const o = { action: text(a, 'ACTION').toLowerCase() || 'display' };
  if (tr) {
    const secs = parseDuration(tr.value);
    if (Number.isFinite(secs)) { o.trigger = -secs / 60; if (tr.params.RELATED === 'END') o.related = 'end'; }
    else o.trigger = parseIcsDate(tr.value, tr.params);
  }
  const d = text(a, 'DESCRIPTION');
  if (d) o.description = d;
  return o;
}

function readCommon(c) {
  const o = { uid: text(c, 'UID') };
  const put = (k, v) => { if (v !== '' && v != null && !(Array.isArray(v) && !v.length)) o[k] = v; };
  put('title', text(c, 'SUMMARY'));
  put('description', text(c, 'DESCRIPTION'));
  put('location', text(c, 'LOCATION'));
  put('url', text(c, 'URL'));
  put('status', text(c, 'STATUS').toLowerCase());
  put('class', text(c, 'CLASS').toLowerCase());
  const geo = text(c, 'GEO').split(/[;,]/);
  if (geo.length === 2 && geo.every((x) => x && Number.isFinite(+x))) o.geo = { lat: +geo[0], lon: +geo[1] };
  put('categories', props(c, 'CATEGORIES').flatMap((p) => splitList(p.value)));
  const pr = text(c, 'PRIORITY'); if (pr) o.priority = +pr;
  const sq = text(c, 'SEQUENCE'); if (sq) o.sequence = +sq;
  put('stamp', dateOf(c, 'DTSTAMP'));
  put('created', dateOf(c, 'CREATED'));
  put('modified', dateOf(c, 'LAST-MODIFIED'));
  const org = prop(c, 'ORGANIZER'); if (org) o.organizer = person(org);
  put('attendees', props(c, 'ATTENDEE').map(person));
  const rr = prop(c, 'RRULE'); if (rr) o.rrule = parseRRule(rr.value);
  put('exdate', dateList(c, 'EXDATE'));
  put('rdate', dateList(c, 'RDATE'));
  put('alarms', c.components.filter((x) => x.name === 'VALARM').map(readAlarm));
  const x = {};
  for (const p of c.props) if (p.name.startsWith('X-')) x[p.name] = icsUnescape(p.value);
  if (Object.keys(x).length) o.x = x;
  return o;
}

// VEVENT component -> model event (all-day `end` inclusive, DURATION resolved to `end`, `tz` from TZID).
// Mirror of eventLines: exclusive all-day DTEND back to the inclusive model end; DURATION resolved to an end in the
// same value form as the start (date, wall clock or UTC), so callers see one shape whatever the producer wrote.
export function readEvent(c) {
  const o = readCommon(c);
  const start = dateOf(c, 'DTSTART');
  const allDay = /^\d{4}-\d{2}-\d{2}$/.test(start);
  o.start = start;
  o.allDay = allDay;
  const tz = tzOf(c, 'DTSTART'); if (tz) o.tz = tz;
  let end = dateOf(c, 'DTEND');
  const dur = prop(c, 'DURATION');
  if (!end && dur && start && Number.isFinite(parseDuration(dur.value))) end = addSeconds(start, parseDuration(dur.value));
  if (end) o.end = allDay ? addDays(end.slice(0, 10), -1) : end;
  if (allDay && o.end && o.end < start) o.end = start;
  const tr = text(c, 'TRANSP'); if (tr) o.transp = tr.toLowerCase();
  return o;
}
export function readTodo(c) {
  const o = readCommon(c);
  for (const [k, name] of [['start', 'DTSTART'], ['due', 'DUE'], ['completed', 'COMPLETED']]) { const v = dateOf(c, name); if (v) o[k] = v; }
  const tz = tzOf(c, 'DUE') || tzOf(c, 'DTSTART'); if (tz) o.tz = tz;
  const pc = text(c, 'PERCENT-COMPLETE'); if (pc) o.percent = +pc;
  return o;
}

// Text -> { prodId, method, name, tz, events, todos, timezones (TZIDs of VTIMEZONE blocks), tree }.
export function readCalendar(textIn) {
  const tree = parseICS(textIn);
  return {
    prodId: text(tree, 'PRODID'), method: text(tree, 'METHOD'), name: text(tree, 'X-WR-CALNAME'), tz: text(tree, 'X-WR-TIMEZONE'),
    events: tree.components.filter((c) => c.name === 'VEVENT').map(readEvent),
    todos: tree.components.filter((c) => c.name === 'VTODO').map(readTodo),
    timezones: tree.components.filter((c) => c.name === 'VTIMEZONE').map((c) => text(c, 'TZID')),
    tree,
  };
}
