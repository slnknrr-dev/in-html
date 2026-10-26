// estate/complex.js - a new-build complex and its handover date: the slug (public address and dedupe key), the name
// in several languages with a fallback, and the ready-by QUARTER. A developer promises "Q2 2027", not a day; a date
// would look more precise than the promise. The quarter is a number `year * 10 + quarter` (20272), monotonic, so
// "ready by Q2 2027" is a range filter; "completed" is COMPUTED from an explicit today, never stored as a flag.
//
//   cleanComplexSlug(v) -> 'sea-towers' | ''         Latin, digits and '-', 2..48, not reserved
//   COMPLEX_SLUG_RESERVED
//   cleanComplexName(v) -> { en, ru, ka }            a plain string is English
//   complexName({ slug, name }, lang) -> text        lang -> en -> any language -> slug
//   readyNum(year, quarter) -> 20272 | 0
//   cleanReady(v) -> 20272 | 0                       20272, '2027-Q2', '2027 к2', '2027-06-30', '2027-06', '2027'
//   readyYear(n), readyQuarter(n), readyOfDay('2026-10-24') -> 20264
//   readyText(n, lang, today) -> 'Handover: Q2 2027' | 'Completed' | ''
//   readyBy(n, limit) -> bool                        ready no later than the limit quarter

// Reserved because slugs share the URL space with route names (new, edit, map ...): a complex named "map" would
// shadow or be shadowed by a page.
export const COMPLEX_SLUG_RESERVED = ['new', 'all', 'api', 'edit', 'map'];

export function cleanComplexSlug(v) {
  const s = String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '').slice(0, 48);
  if (s.length < 2 || COMPLEX_SLUG_RESERVED.includes(s)) return '';
  return s;
}

export const NAME_LANGS = ['en', 'ru', 'ka'];

export function cleanComplexName(v) {
  if (typeof v === 'string') { const s = v.trim().slice(0, 120); return s ? { en: s } : {}; }
  const o = v && typeof v === 'object' ? v : {};
  const out = {};
  for (const l of NAME_LANGS) { const s = String(o[l] ?? '').trim().slice(0, 120); if (s) out[l] = s; }
  return out;
}

// The slug comes last on purpose: a complex is created before anybody fills in a name, and its page must still open.
export function complexName(c, lang = 'en') {
  const want = String(lang || '').slice(0, 2).toLowerCase();
  const t = (c && c.name) || {};
  const hit = String(t[want] ?? '').trim() || String(t.en ?? '').trim();
  if (hit) return hit;
  for (const l of Object.keys(t)) { const s = String(t[l] ?? '').trim(); if (s) return s; }
  return String((c && c.slug) || '');
}

export const READY_MIN = 1990;
export const READY_MAX = 2100;

// year*10+quarter rather than year*4+q: still monotonic, but human-readable in the database (20272 reads as 2027 Q2).
export function readyNum(year, quarter) {
  const y = Math.trunc(Number(String(year ?? '').trim()));
  const q = Math.trunc(Number(String(quarter ?? '').trim()));
  if (!Number.isFinite(y) || y < READY_MIN || y > READY_MAX) return 0;
  if (!Number.isFinite(q) || q < 1 || q > 4) return 0;
  return y * 10 + q;
}

/**
 * The handover quarter from what was sent: the number itself, '2027-Q2' / '2027 Q2' / '2027 К2' (a form), a date or a
 * month of a developer feed (collapsed into its quarter on purpose: nobody promises the day), or a plain year, which
 * means its END (a promise given by a year cannot be read as its first quarter).
 */
export function cleanReady(v) {
  if (v == null || v === '') return 0;
  const s = String(v).trim();
  if (/^\d{5}$/.test(s)) return readyNum(s.slice(0, 4), s.slice(4));
  let m = /^(\d{4})\s*[-\s]?\s*[QqКк]\s*([1-4])$/.exec(s);
  if (m) return readyNum(m[1], m[2]);
  m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(s);
  if (m) return +m[2] >= 1 && +m[2] <= 12 ? readyNum(m[1], Math.ceil(Number(m[2]) / 3)) : 0;
  m = /^(\d{4})$/.exec(s);
  if (m) return readyNum(m[1], 4);
  return 0;
}

export const readyYear = (n) => {
  const v = Math.trunc(Number(n));
  return Number.isFinite(v) && v >= READY_MIN * 10 ? Math.trunc(v / 10) : 0;
};
export const readyQuarter = (n) => {
  const v = Math.trunc(Number(n));
  return Number.isFinite(v) && v >= READY_MIN * 10 ? v % 10 : 0;
};

export function readyOfDay(iso) {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso || ''));
  return m ? readyNum(m[1], Math.ceil(Number(m[2]) / 3)) : 0;
}

export const readyBy = (n, limit) => {
  const v = Math.trunc(Number(n)), l = Math.trunc(Number(limit));
  return v > 0 && l > 0 && v <= l;
};

const ROMAN = ['', 'I', 'II', 'III', 'IV'];
const READY_I18N = {
  en: { done: 'Completed', of: 'Handover', q: (q, y) => `Q${q} ${y}` },
  ru: { done: 'Сдан', of: 'Сдача', q: (q, y) => `${ROMAN[q]} кв. ${y}` },
  ka: { done: 'ჩაბარებულია', of: 'ჩაბარება', q: (q, y) => `${ROMAN[q]} კვ. ${y}` },
};

// today is a parameter, never new Date(): the server, the cache and tests must render the same text for the same
// input. Without today the quarter is always shown (never "Completed").
export function readyText(n, lang = 'en', todayIso = '') {
  const v = Math.trunc(Number(n));
  const y = readyYear(v), q = readyQuarter(v);
  if (!y || !q) return '';
  const w = READY_I18N[String(lang || '').slice(0, 2).toLowerCase()] || READY_I18N.en;
  const now = todayIso ? readyOfDay(todayIso) : 0;
  if (now && v <= now) return w.done;
  return `${w.of}: ${w.q(q, y)}`;
}
