// calendar/guests.js - guest lists of an event: RSVP options as label + axis + tags (the axis is a closed list, so
// seat arithmetic never depends on an author's wording: only 'yes' takes seats), the guest tags an answer sets and
// clears, tag normalization and counts, the guest-line parser ('Name', 'Name <mail>', 'Ivan, Иван <mail>' with one
// name per site language), whole pasted lists, an RSVP summary with capacity and waitlist, poll bars, and the guests
// CSV (semicolon, BOM, formula-injection guard: the file is opened in a spreadsheet).
import { serializeCSV } from '../csv/csv.js';
import { fullness } from './event.js';

// --- RSVP options ------------------------------------------------------------------------------------------------

export const RSVP_AXES = ['yes', 'maybe', 'maybeNo', 'no'];
// Responses stored per guest: the axes plus the waitlist.
export const RSVP_RESPONSES = [...RSVP_AXES, 'waitlist'];
export const rsvpAxis = (v, fallback = 'maybe') => (RSVP_AXES.includes(String(v)) ? String(v) : fallback);

// Tags: trimmed, at most 40 characters, case-insensitively unique (the first spelling wins), at most `max`.
export const tagKey = (t) => String(t == null ? '' : t).trim().toLowerCase().slice(0, 40);
export function normalizeTags(raw, max = 24) {
  const src = Array.isArray(raw) ? raw : String(raw == null ? '' : raw).split(',');
  const seen = new Set(), out = [];
  for (const t of src) {
    const s = String(t == null ? '' : t).trim().slice(0, 40), k = s.toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k); out.push(s);
    if (out.length >= max) break;
  }
  return out;
}
export const hasTag = (tags, tag) => normalizeTags(tags).some((t) => tagKey(t) === tagKey(tag));
// [{ tag, count }] over guests' `tags`, most used first.
export function tagCounts(guests) {
  const map = new Map();
  for (const g of guests || []) for (const t of normalizeTags(g && g.tags)) {
    const k = tagKey(t);
    if (!map.has(k)) map.set(k, { tag: t, count: 0 });
    map.get(k).count++;
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

// The built-in options when a block has none: yes, no and (unless allowMaybe === false) maybe.
export function rsvpDefaults(block) {
  const out = [{ id: 'yes', axis: 'yes', label: {}, tags: [], icon: '', builtIn: true }, { id: 'no', axis: 'no', label: {}, tags: [], icon: '', builtIn: true }];
  if (!block || block.allowMaybe !== false) out.push({ id: 'maybe', axis: 'maybe', label: {}, tags: [], icon: '', builtIn: true });
  return out;
}
// Cleaned options of an RSVP block { options: [{ id, axis, label: { lang: text }, tags, icon }] }: ids are
// [A-Za-z0-9_-]{1,24} (stored with answers, so they outlive renames), duplicates dropped, at most 12.
export function rsvpOptions(block) {
  const raw = block && block.options;
  if (!Array.isArray(raw) || !raw.length) return rsvpDefaults(block);
  const out = [], seen = new Set();
  raw.forEach((o, i) => {
    if (!o || typeof o !== 'object' || out.length >= 12) return;
    const id = String(o.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || 'o' + (i + 1);
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, axis: rsvpAxis(o.axis), label: o.label && typeof o.label === 'object' ? o.label : {}, tags: normalizeTags(o.tags, 12), icon: String(o.icon || '').slice(0, 8), builtIn: false });
  });
  return out.length ? out : rsvpDefaults(block);
}
export const rsvpOption = (block, id) => rsvpOptions(block).find((o) => o.id === String(id)) || null;
export const rsvpTagPool = (block) => normalizeTags(rsvpOptions(block).flatMap((o) => o.tags), 1000);

// Guest tags after choosing option `optId`: the tags of the block's options are mutually exclusive (the chosen one's
// are set, the others' cleared), the author's own tags stay. null when the block manages no tags.
export function rsvpApplyTags(guestTags, block, optId) {
  const pool = rsvpTagPool(block);
  if (!pool.length) return null;
  const drop = new Set(pool.map(tagKey));
  const own = (rsvpOption(block, optId) || { tags: [] }).tags;
  return normalizeTags(normalizeTags(guestTags).filter((t) => !drop.has(tagKey(t))).concat(own));
}

// --- guest lines -------------------------------------------------------------------------------------------------

// 'Name' | 'Name <mail@x>' | 'mail@x' | 'Иван, Ivan <mail>' -> { name, names: { locale: name }, email }; commas
// separate the translations of a name, in the order of `locales`.
export function parseGuestLine(line, locales = ['en']) {
  const loc = locales && locales.length ? locales : ['en'];
  let s = String(line == null ? '' : line).trim(), email = '';
  const m = /^(.*?)\s*<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/.exec(s);
  if (m) { s = m[1].trim(); email = m[2]; } else if (/^[^<>\s,]+@[^<>\s,]+$/.test(s)) { email = s; s = ''; }
  let parts = s.split(',').map((x) => x.trim()).filter(Boolean);
  if (!parts.length && email) parts = [email];
  const names = {};
  for (let i = 0; i < parts.length && i < loc.length; i++) names[loc[i]] = parts[i].slice(0, 120);
  return { name: parts[0] ? parts[0].slice(0, 120) : '', names, email: email.toLowerCase() };
}
// A pasted list (one guest per line; '#' comments and blank lines skipped). Repeated emails merge into the first.
// Merge on repeated email keeps the first line's names and only fills languages it lacked (spread order).
export function parseGuestList(text, locales) {
  const out = [], byEmail = new Map();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const g = parseGuestLine(line, locales);
    if (!g.name) continue;
    if (g.email && byEmail.has(g.email)) { Object.assign(byEmail.get(g.email).names, { ...g.names, ...byEmail.get(g.email).names }); continue; }
    if (g.email) byEmail.set(g.email, g);
    out.push(g);
  }
  return out;
}
// The name of a guest in a language: the language, the primary one, any, then `name`.
export function guestName(guest, lang, primary) {
  const n = guest && guest.names;
  if (n) { if (n[lang]) return n[lang]; if (primary && n[primary]) return n[primary]; const any = Object.values(n).find(Boolean); if (any) return any; }
  return (guest && guest.name) || '';
}

// --- summaries ---------------------------------------------------------------------------------------------------

// Guests { rsvp: { response, guests (companions) } | null }: counts per response, `noAnswer`, seats (a yes takes
// 1 + companions), and fullness against `capacity`.
export function rsvpSummary(guests, { capacity = 0 } = {}) {
  const counts = Object.fromEntries(RSVP_RESPONSES.map((r) => [r, 0]));
  let noAnswer = 0, seats = 0;
  for (const g of guests || []) {
    const r = g && g.rsvp;
    if (!r || !r.response) { noAnswer++; continue; }
    const k = RSVP_RESPONSES.includes(r.response) ? r.response : 'maybe';
    counts[k]++;
    if (k === 'yes') seats += 1 + Math.max(0, Math.floor(+r.guests || 0));
  }
  return { total: (guests || []).length, counts, noAnswer, seats, fullness: fullness(seats, capacity) };
}

// Bars of a poll: percent of the leading answer (multi-choice votes can exceed the number of voters).
export function pollBars(labels, counts) {
  const at = (i) => +(counts && counts[i]) || 0;
  const max = labels.reduce((m, _, i) => Math.max(m, at(i)), 0);
  return labels.map((label, i) => ({ label, count: at(i), pct: max ? Math.round((at(i) / max) * 100) : 0 }));
}

// --- CSV -----------------------------------------------------------------------------------------------------------

export const GUEST_CSV_LABELS = {
  name: 'Name', lang: 'Language', response: 'Response', option: 'Option', total: 'Total people', opened: 'Opened link',
  tags: 'Tags', seat: 'Table / seat', email: 'Email', phone: 'Phone', note: 'Note', link: 'Link',
  yes: 'attending', no: 'not attending', maybe: 'maybe', maybeNo: 'probably not', waitlist: 'waitlist', none: 'no answer',
  true: 'yes', false: 'no',
};

// Rows { name, lang, rsvp, option (the chosen label), openedAt, tags, seat, email, phone, note, link, answers: [] }
// -> CSV text. Options: extra (column titles matching each row's `answers`), labels (overrides of GUEST_CSV_LABELS),
// delimiter (';'), bom (true), newline ('\r\n').
// Defaults chosen for Excel, the usual consumer: ';' because Excel in comma-decimal locales splits on ';', a BOM so
// it detects UTF-8 (otherwise Cyrillic / Georgian names are mojibake), CRLF line ends. guard: cells starting with
// = + - @ are prefixed so a guest named "=HYPERLINK(...)" is shown as text, not executed as a formula.
export function guestsCsv(rows, { extra = [], labels = {}, delimiter = ';', bom = true, newline = '\r\n' } = {}) {
  const L = { ...GUEST_CSV_LABELS, ...labels };
  const head = [L.name, L.lang, L.response, L.option, L.total, L.opened, L.tags, L.seat, L.email, L.phone, L.note, L.link, ...extra];
  const body = (rows || []).map((g) => {
    const r = g.rsvp;
    const total = r && r.response === 'yes' ? 1 + (Math.floor(+r.guests || 0)) : '';
    return [g.name || '', String(g.lang || '').toUpperCase(), r && r.response ? L[r.response] || String(r.response) : L.none, g.option || '', total,
      g.openedAt ? L.true : L.false, normalizeTags(g.tags).join(', '), g.seat || '', g.email || '', g.phone || '', g.note || '', g.link || '',
      ...extra.map((_, i) => (g.answers || [])[i] ?? '')];
  });
  return (bom ? '﻿' : '') + serializeCSV([head, ...body], { delimiter, newline, guard: true });
}
