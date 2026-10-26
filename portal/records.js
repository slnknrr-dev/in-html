// portal/records.js - directory entries and requests (pure): facet options aligned across languages, prices and
// budgets, dates relative to today, the "recommended" order, rating summaries and the matching of a request with the
// specialists and firms that fit it.
//
//   facetOptions(items, valuesOf(item, lang) -> [string], { langs, lang }) ->
//     { options: [{ id, label: { lang: text }, n }], ids: Map(item -> [id]) }   options by count, then label
//     A value is identified by its text in the main language `lang`; the k-th value in another language is its label
//     there (lists written in the same order in every language).
//   money(n, cur, lang) -> '1 200 ₾' | 'GEL 1,200' (Intl, with a plain fallback)
//   PRICE_KINDS / priceParts(kind, amount) -> { key, vars }   (UI key + variables; the host translates)
//   BUDGET_KINDS / budgetParts(kind, min, max) -> { key, vars }
//   dayNumber('YYYY-MM-DD') -> days since 1970 (UTC) | null;  todayNumber(date?)
//   daysUntil(day, today) / daysSince(day, today) -> integer | null
//   recommendScore(entry) -> number;  ratingSummary(entries) -> { avg, n, count }
//   matchEntries(request, entries, { limit }) -> [{ entry, score, why: ['area' | 'city' | 'lang' | 'remote'] }]
//     request / entry: { areas: [string], city, langs: [string], remote, status, verified, rating, reviews }
import { fold, slugId, stemOf, words } from './text.js';

export const PRICE_KINDS = ['from', 'fixed', 'hour', 'free', 'ask'];
export const BUDGET_KINDS = ['fixed', 'range', 'hour', 'unsure'];
export const ENTRY_KINDS = ['person', 'firm', 'org'];
export const REQUEST_STATUSES = ['open', 'progress', 'closed'];
export const ENTRY_STATUSES = ['available', 'busy', 'away'];

// Facet values must be identical across languages (a filter chosen in Georgian must keep working after switching to
// English). Identity = slug of the main-language text; labels in other languages are taken by POSITION, which is
// correct only when every language lists values in the same order and count (otherwise the main text is used).
// Non-Latin values whose slug is empty get a base-36 code-point id.
export function facetOptions(items, valuesOf, { langs = ['en'], lang = langs[0] } = {}) {
  const map = new Map();
  const ids = new Map();
  for (const it of items || []) {
    const main = (valuesOf(it, lang) || []).filter(Boolean);
    const own = [];
    main.forEach((v, k) => {
      let id = slugId(v, '');
      if (!id) id = 'v' + [...fold(v)].map((c) => c.codePointAt(0).toString(36)).join('').slice(0, 24);
      own.push(id);
      if (!map.has(id)) map.set(id, { id, label: {}, n: 0, key: fold(v) });
      const o = map.get(id);
      o.n++;
      for (const l of langs) {
        if (o.label[l]) continue;
        const vl = (valuesOf(it, l) || []).filter(Boolean);
        o.label[l] = vl.length === main.length && vl[k] ? vl[k] : v;
      }
    });
    ids.set(it, [...new Set(own)]);
  }
  const options = [...map.values()].sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
  return { options, ids };
}

// Currency code must be ISO-like (3 capitals) before reaching Intl, which throws on unknown codes; fallback groups thousands with spaces.
export function money(n, cur, lang) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  const c = /^[A-Z]{3}$/.test(String(cur || '')) ? cur : '';
  if (c) {
    try {
      return new Intl.NumberFormat(lang || 'en', { style: 'currency', currency: c, maximumFractionDigits: v % 1 ? 2 : 0 }).format(v);
    } catch { /* unknown locale */ }
  }
  const s = (Math.round(v * 100) / 100).toFixed(v % 1 ? 2 : 0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return c ? s + ' ' + c : s;
}

// UI keys of the price of a directory entry: pt.price.from 'from {p}', .fixed '{p}', .hour '{p} / hour', .free, .ask.
export function priceParts(kind, amount, cur, lang) {
  const k = PRICE_KINDS.includes(kind) ? kind : 'from';
  if (k === 'free' || k === 'ask') return { key: 'pt.price.' + k, vars: {} };
  if (amount == null || amount === '' || !Number.isFinite(Number(amount))) return null;
  return { key: 'pt.price.' + k, vars: { p: money(amount, cur, lang) } };
}

export function budgetParts(kind, min, max, cur, lang) {
  const k = BUDGET_KINDS.includes(kind) ? kind : 'fixed';
  const has = (v) => v != null && v !== '' && Number.isFinite(Number(v));
  if (k === 'unsure' || (!has(min) && !has(max))) return { key: 'pt.budget.unsure', vars: {} };
  if (k === 'range' && has(min) && has(max)) return { key: 'pt.budget.range', vars: { a: money(min, cur, lang), b: money(max, cur, lang) } };
  if (k === 'range' && has(max)) return { key: 'pt.budget.upto', vars: { p: money(max, cur, lang) } };
  if (k === 'range') return { key: 'pt.budget.from', vars: { p: money(min, cur, lang) } };
  return { key: k === 'hour' ? 'pt.budget.hour' : 'pt.budget.fixed', vars: { p: money(has(min) ? min : max, cur, lang) } };
}

// Day numbers in UTC: date-only values have no time zone, so arithmetic on them must not cross DST or offsets.
export function dayNumber(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day || ''));
  return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5) : null;
}
// "Today" is the visitor's local calendar date, converted to the same UTC day numbering as dayNumber.
export const todayNumber = (d = new Date()) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
export function daysUntil(day, today = todayNumber()) {
  const n = dayNumber(day);
  return n == null ? null : n - today;
}
export function daysSince(day, today = todayNumber()) {
  const n = dayNumber(day);
  return n == null ? null : today - n;
}

// Hand-tuned blend: verification +3, rating 0-5, log10(reviews) (diminishing returns: 1000 reviews is not 10x
// 100), experience capped at +3, availability penalties. Rounded so sorting is stable across engines.
export function recommendScore(e) {
  let s = 0;
  if (e.verified) s += 3;
  const r = Number(e.rating) || 0;
  s += r;
  s += Math.log10(1 + (Number(e.reviews) || 0));
  s += Math.min(3, (Number(e.years) || 0) / 10);
  if (e.status === 'away') s -= 4;
  else if (e.status === 'busy') s -= 1;
  return Math.round(s * 1000) / 1000;
}

// Review-weighted mean; an entry with a rating but no review count weighs 1.
export function ratingSummary(entries) {
  let sum = 0;
  let n = 0;
  let count = 0;
  for (const e of entries || []) {
    const r = Number(e.rating);
    if (!r) continue;
    const w = Math.max(1, Number(e.reviews) || 0);
    sum += r * w;
    n += w;
    count++;
  }
  return { avg: n ? Math.round((sum / n) * 10) / 10 : 0, n, count };
}

const stems = (list) => {
  const out = new Set();
  for (const v of list || []) for (const w of words(v)) if (w.length > 2) out.add(stemOf(w));
  return out;
};
// Area overlap by stems, with prefix matching for stems of 4+ letters ("tax" stems vs "taxation").
const overlap = (a, b) => {
  let n = 0;
  for (const x of a) for (const y of b) if (x === y || (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x)))) { n++; break; }
  return n;
};

// Specialists for a request: an entry that shares no area with the request never matches; the city (or a remote
// request), common languages, verification and the recommended score order the rest. Entries marked away are skipped.
export function matchEntries(request, entries, { limit = 3 } = {}) {
  const ra = stems(request.areas);
  const rl = new Set((request.langs || []).map((l) => fold(l)));
  const rc = fold(request.city || '');
  const out = [];
  for (const e of entries || []) {
    if (e.status === 'away') continue;
    const area = overlap(ra, stems(e.areas));
    if (!area) continue;
    const why = ['area'];
    let score = area * 10;
    const ec = fold(e.city || '');
    if (rc && ec && (ec === rc || stemOf(ec) === stemOf(rc))) { score += 4; why.push('city'); }
    else if (request.remote) { score += 2; why.push('remote'); }
    const el = (e.langs || []).map((l) => fold(l));
    if (rl.size && el.some((l) => rl.has(l))) { score += 2; why.push('lang'); }
    score += recommendScore(e) / 4;
    out.push({ entry: e, score: Math.round(score * 1000) / 1000, why });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, Math.max(0, limit));
}
