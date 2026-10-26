// batumi-map/common.js - shared parts of the map and street-list pages: the shell (pages resolved from the hidden
// anchors of the page HTML, so the build can rewrite them), app icons, street names in the UI language, the decoded
// gazetteer (streets with their house numbers and points) and the search over it: streets and addresses in
// Georgian, Latin (official romanisation, English names, loose spellings) and Russian, tolerant to case and
// declension (geo/tree.js searchPlaces over all names, geo/address.js for house numbers and the cross-script street
// skeleton), plus coordinates typed or pasted (geo/coords.js).
//
// Design rules:
// - Lazy everything: the gazetteer ships as compact strings (house labels joined by '|', points as encoded
//   polylines). streets() builds light records once; houses() decodes a street's points only when that street is
//   opened or searched with a number; the search index is built on the first query. First paint therefore does not
//   pay for decoding tens of thousands of points.
// - Search ladder, cheapest and most precise first: coordinates -> address parse (street + house) -> fuzzy name
//   search over all names and transliterations (geo/tree.js) -> cross-script skeleton fallback. Each rung only runs
//   when the previous one found nothing or does not apply.
// - Ranking is additive and explainable: name score + street-type bonus + a small size bonus (bigger streets are
//   likelier targets) + a large bonus when the requested house number exists on that street.
import './strings.js';
import { startApp, t } from '../ui/app.js';
import { addIcons } from '../ui/icons.js';
import { UI_STATE } from '../ui/i18n.js';
import { decodePolyline } from '../geo/polyline.js';
import { gazetteer, searchPlaces } from '../geo/tree.js';
import { parseAddress, parseHouseNumber, streetSkeleton, streetType } from '../geo/address.js';
import { parseLatLng } from '../geo/coords.js';
import { romanizeKa } from '../lingua/translit.js';
import { translit } from '../lingua/kartuli.js';
import { stemEq, words } from '../portal/text.js';
import { STREETS, GAZETTEER_DATE } from './data-gazetteer.js';

export const LOGO = 'M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5zM9 4v13.5M15 6.5V20';
export const DATA_DATE = GAZETTEER_DATE;
export const OSM_COPYRIGHT = 'https://www.openstreetmap.org/copyright';

addIcons({
  map: LOGO,
  locate: 'M12 2v3M12 19v3M2 12h3M19 12h3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  street: 'M5 21 9 3M19 21 15 3M12 4v2M12 10v3M12 17v3',
  house: 'M3 11 12 4l9 7M5 10v10h14V10M10 20v-6h4v6',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  home: 'M4 4h16v16H4zM9 9h6v6H9z',
});

// getAttribute, not a.href: .href would be absolute (file:///...), breaking relative links after publishing.
// Resolved hrefs of the pages (hidden anchors in the page HTML; the build rewrites their href).
export function pageHref(id) {
  const a = document.getElementById(id);
  return a ? a.getAttribute('href') : '#';
}

export function startShell(current, onLang) {
  startApp({
    key: 'bm', name: 'bm.name', logo: LOGO, offline: true, onLang,
    pages: [
      { href: pageHref('pg-map'), label: 'bm.page.map', current: current === 'map' },
      { href: pageHref('pg-streets'), label: 'bm.page.streets', current: current === 'streets' },
    ],
  });
}

// --- names ------------------------------------------------------------------------------------------------------

// The name language of the UI language: Georgian for ka, Russian for ru / uk, otherwise English.
// Only three name languages exist in OSM data here (ka, en, ru); Ukrainian readers get Russian names (closest
// script and widely understood in Batumi), every other language gets English or a romanisation.
export const nameLang = () => (UI_STATE.lang === 'ka' ? 'ka' : /^(ru|uk)/.test(UI_STATE.lang) ? 'ru' : 'en');

// Latin of a Georgian name by the national system without apostrophes (as on street signs).
export const latinOf = (ka) => (ka ? romanizeKa(ka, { apostrophes: false }) : '');

/** The display name of a street in a language; falls back to another language, then a transliteration. */
// English without name:en: the romanised Georgian name beats an English fallback to Russian, because it matches the
// Latin text on Batumi street signs.
export function streetName(s, lang = nameLang()) {
  const order = lang === 'ka' ? ['ka', 'en', 'ru'] : lang === 'ru' ? ['ru', 'ka', 'en'] : ['en', 'ka', 'ru'];
  if (s[lang]) return s[lang];
  if (lang === 'en' && s.ka) return latinOf(s.ka);
  for (const l of order) if (s[l]) return s[l];
  return '—';
}

// The other names of a street (for subtitles): all known names except the shown one.
export function otherNames(s, lang = nameLang()) {
  const shown = streetName(s, lang);
  return ['ka', 'en', 'ru'].map((l) => s[l]).filter((n) => n && n !== shown);
}

// --- gazetteer ----------------------------------------------------------------------------------------------------

let STREET_LIST = null;
/** Streets: [{ id, ka, en, ru, count, centre: [lat, lng], houses() -> [{ label, pt, n }] }] (houses decoded lazily). */
export function streets() {
  if (STREET_LIST) return STREET_LIST;
  // Gazetteer row: [ka, en, ru, house labels '|'-joined, house points polyline, centre polyline]. The closure keeps the
  // decoded houses per street (memoised on first call); points without a label pairing are dropped by filter.
  // KNOWN DEFECT: the generated rows have only 5 fields (tools/build-data.js never writes the centre), so r[5] is
  // undefined, decodePolyline returns [] and centre is null for every street. Fix: emit the centre in the build.
  STREET_LIST = STREETS.map((r, id) => {
    const labels = r[3] ? r[3].split('|') : [];
    let houses = null;
    return {
      id, ka: r[0], en: r[1], ru: r[2], count: labels.length, centre: decodePolyline(r[5])[0] || null,
      houses() {
        if (houses) return houses;
        const pts = decodePolyline(r[4]);
        houses = labels.map((label, i) => ({ label, pt: pts[i], n: parseHouseNumber(label) })).filter((x) => x.pt);
        return houses;
      },
    };
  });
  return STREET_LIST;
}

let INDEX = null;
// The search index: every name, the Latin romanisation and the Russian transcription of the Georgian name, so
// "rustavelis", "Rustaveli" and "Руставели" find "შოთა რუსთაველის ქუჩა" even where OSM has no name:en / name:ru.
// alt names: national romanisation and a Russian transcription of the Georgian name; the typographic apostrophe of
// the transcription is removed because users never type it.
// skel: per street, the cross-script "skeleton" of each name (geo/address.js), used only as the fallback below.
function index() {
  if (INDEX) return INDEX;
  const list = streets();
  const nodes = list.map((s) => ({
    id: s.id, kind: 'street', name: { ka: s.ka, en: s.en, ru: s.ru },
    alt: s.ka ? [latinOf(s.ka), translit(s.ka, 'ru').replace(/’/g, '')] : [],
  }));
  const gz = gazetteer(nodes);
  const skel = list.map((s) => [s.ka, s.en, s.ru].filter(Boolean).map((n) => streetSkeleton(n)));
  INDEX = { gz, skel };
  return INDEX;
}

// Words that do not name the street: the generic words of geo/address.js are handled there; these are the city
// and a few prepositions of typed queries ("на улице Руставели", "Batumi, Rustaveli 10").
const STOP = ['batumi', 'батуми', 'ბათუმი', 'на', 'в', 'по', 'ул', 'on', 'in', 'at', 'the', 'st', 'str', 'улица', 'проспект', 'переулок', 'тупик', 'street', 'avenue', 'lane', 'ქუჩა', 'გამზირი', 'შესახვევი', 'ჩიხი'];
// Short stop words must match exactly; words of 4+ letters also match by stem (stemEq), so declined forms such as
// "улице" or "проспекте" are dropped too.
const isStop = (w) => STOP.some((s) => s === w || (s.length >= 4 && stemEq(s, w)));

/** The street part of a query: words without the city, prepositions and generic words. */
export function streetWords(q) {
  return words(q).filter((w) => !isStop(w));
}

// Fallback match by the cross-script skeleton: every query word is a prefix of a skeleton word of one name.
// A query word matches a skeleton word if it is its prefix (typing in progress), or, for words of 4+ letters, if
// the skeleton word is a prefix of the query word shorter by at most 2 (declension endings: "rustavelis" vs
// "rustaveli"). Score favours names fully covered by the query.
function skeletonHits(q) {
  const qs = streetSkeleton(q);
  if (!qs.length) return [];
  const out = [];
  index().skel.forEach((names, id) => {
    let best = 0;
    for (const sk of names) {
      if (qs.every((w) => sk.some((k) => k.startsWith(w) || (w.length >= 4 && w.startsWith(k) && w.length - k.length <= 2)))) best = Math.max(best, qs.length / Math.max(1, sk.length));
    }
    if (best) out.push({ id, score: best });
  });
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Search: { coords?, house?, results: [{ street, score, house?: { label, pt }, near?: [house labels] }] }.
 * A house number in the query ("rustavelis 12", "Руставели 10", "ბათუმი, რუსთაველის 7") is looked up on every
 * matching street; when it is missing, the nearest numbers on the same side are offered.
 */
export function search(query, { limit = 25 } = {}) {
  const q = String(query || '').trim();
  const out = { results: [], house: null, coords: null };
  if (!q) return out;
  // The coordinate parser runs only when the query has at least two digits: a cheap gate that keeps street names from
  // being misread as coordinates.
  const c = /\d.*\d/.test(q) ? parseLatLng(q) : null;
  if (c) { out.coords = c; return out; }
  const a = parseAddress(q);
  let streetQ = q;
  if (a.house) {
    out.house = { house: a.house, korpus: a.korpus, fraction: a.fraction };
    streetQ = a.street || a.city || '';
  }
  const ws = streetWords(streetQ);
  if (!ws.length) return out;
  const list = streets();
  // limit * 2 candidates: the house-number pass below re-ranks, so a street slightly lower by name but having the
  // requested house must still be in the candidate set.
  let hits = searchPlaces(index().gz, ws.join(' '), { lang: nameLang(), limit: limit * 2 }).map((r) => ({ id: r.node.id, score: r.score }));
  if (!hits.length) hits = skeletonHits(ws.join(' ')).slice(0, limit * 2);
  // The type of street typed ("lane", "ჩიხი") puts streets of that type first.
  const want = streetType(streetQ);
  const res = hits.map((h) => {
    const s = list[h.id];
    const type = streetType(s.ka || s.en || s.ru);
    return { street: s, score: h.score + (want && type === want ? 1 : 0) + Math.min(1, s.count / 200) * 0.2 };
  });
  res.sort((x, y) => y.score - x.score);
  if (out.house) {
    for (const r of res) {
      const hs = r.street.houses();
      const hit = hs.find((x) => sameHouse(x.n, out.house));
      if (hit) { r.house = hit; r.score += 3; } else r.near = nearHouses(hs, out.house);
    }
    res.sort((x, y) => y.score - x.score);
  }
  out.results = res.slice(0, limit);
  return out;
}

// Houses compare on the parsed number, building (korpus) and fraction: "12", "12A" and "12/1" are different houses.
const sameHouse = (a, b) => a.house === b.house && (a.korpus || '') === (b.korpus || '') && (a.fraction || '') === (b.fraction || '');

// The closest house numbers to a missing one, the same side (parity) first.
// Same-parity numbers first: in Georgia, as in most of Europe, odd and even numbers run on opposite sides, so a
// 2.5 penalty for the other side makes 14 rank before 13 when 12 is missing.
export function nearHouses(hs, want, n = 3) {
  const w = parseInt(want.house, 10);
  if (!Number.isFinite(w)) return [];
  const exactNum = hs.filter((x) => +x.n.house === w);
  if (exactNum.length) return exactNum.slice(0, n).map((x) => x.label);
  return hs.filter((x) => Number.isFinite(+x.n.house))
    .map((x) => ({ x, d: Math.abs(+x.n.house - w) + ((+x.n.house - w) % 2 ? 2.5 : 0) }))
    .sort((a, b) => a.d - b.d).slice(0, n).map((o) => o.x.label);
}

// A house of a street by its label (the exact text, else the parsed number).
export function findHouse(street, label) {
  const hs = street.houses();
  return hs.find((x) => x.label === label) || hs.find((x) => sameHouse(x.n, parseHouseNumber(label))) || null;
}

// toLocaleString with the page language (set by ui/i18n.js), so grouping matches the UI (1 234 vs 1,234).
export const fmtCount = (n) => Number(n).toLocaleString(document.documentElement.lang || 'en');
export { t };
