// event-invite/invite.js - the invitation itself, shared by the designer (live preview, printed cards, exports) and
// the exported page (bundled into it through invite-runtime.js): themes, fonts, ornaments, the envelope, the card and
// RSVP markup, the stylesheet, the event as iCalendar, the "when" line in words, guest tokens of personalised links
// (#guest=…), reply texts with their machine tag and the reader of pasted replies. Pure: data in, strings out; no DOM,
// no network.
//
// The invitation data D (built by common.js inviteData):
//   { v, uid, stamp, type, langs: [main, …], title, hosts, message: { lang: text }, day, time, endDay, endTime, tz,
//     venue: { name, address: { lang } }, geo: { lat, lon }, programme: [{ day, at, title: { lang } }],
//     dress: { code, note: { lang }, colors: [] }, rsvp: { email, phone, deadline, maybe, plus, menu: { lang }, note },
//     design: { theme, ornament, font, envelope, seal, motion }, link, strings: { lang: { key: text | plural } },
//     guest: null | { i, n, p, l }, preview: null | { open, lang } }
//
// Why strings, not DOM: the same builders run in three places (designer preview iframe via srcdoc, the exported file
// at build time in the designer, the runtime inside that file). Strings work identically in all three and in tests;
// a DOM-based renderer would need a document in each. The price is that every interpolation must be escaped by hand:
// every user text goes through esc(), every URL attribute through esc() after its own encoding.
import { formatEventDate, scheduleDays } from '../calendar/event.js';
import { addDays, dayDiff, parseDay, parseTime } from '../calendar/date.js';
import { buildEvent } from '../calendar/ics.js';

export const LANGS = ['en', 'ru', 'uk', 'de', 'fr', 'es', 'ka'];

// All five HTML-significant characters, incl. ' and ", so the result is safe in text AND in quoted attributes.
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);

// Text of a per-language map: the language, the main language, then any non-empty one.
// A missing translation therefore shows another language rather than a hole in the card.
export function txt(map, lang, main) {
  if (!map || typeof map !== 'object') return typeof map === 'string' ? map : '';
  if (map[lang]) return String(map[lang]);
  if (main && map[main]) return String(map[main]);
  const any = Object.values(map).find((v) => typeof v === 'string' && v.trim());
  return any ? String(any) : '';
}

// Strings of the invitation (D.strings, collected by the designer for the content languages).
// Intl.PluralRules cached per language (construction is slow-ish and tr() runs for every label on every render);
// null cached too, so a runtime without Intl does not retry, and falls back to English one/other rules.
const pluralCache = new Map();
function pluralOf(lang, n) {
  if (!pluralCache.has(lang)) { let p = null; try { p = new Intl.PluralRules(lang); } catch { p = null; } pluralCache.set(lang, p); }
  const p = pluralCache.get(lang);
  try { return p ? p.select(n) : n === 1 ? 'one' : 'other'; } catch { return 'other'; }
}
// Fallback chain: language -> main language -> English -> the key itself (visible, so a missing string is found in
// testing). Plurals are selected with the rules of the language the string actually came from (`from`), not the
// requested one: Russian has one/few/many, English only one/other.
export function tr(D, lang, key, vars) {
  const S = (D && D.strings) || {};
  let s = S[lang]?.[key], from = lang;
  if (s == null) { from = D.langs[0]; s = S[from]?.[key]; }
  if (s == null) { from = 'en'; s = S.en?.[key]; }
  if (s == null) return key;
  if (typeof s === 'object') {
    const n = Number(vars && vars.n);
    s = s[Number.isFinite(n) ? pluralOf(from, n) : 'other'] ?? s.other ?? '';
  }
  return vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : String(s);
}

// --- themes, fonts, ornaments ------------------------------------------------------------------------------------

// bg / bg2: page gradient, paper: the card, ink / muted: text, accent: ornaments and headings, soft: fields and
// pills, env: envelope body, seal / sealInk: the wax seal.
// Themes are data, not CSS classes: the same values feed the stylesheet (custom properties), the PDF and e-mail
// builders (which cannot use CSS variables) and the designer's chip previews.
// pills, env: envelope body, seal / sealInk: the wax seal.
export const THEMES = {
  ivory: { bg: '#f4efe6', bg2: '#e4d8c2', paper: '#fffdf8', ink: '#3b3127', muted: '#7a6c5b', accent: '#a07f35', soft: '#f3ead7', env: '#e6d8bd', seal: '#9b2c2c', sealInk: '#f8e7c8' },
  blush: { bg: '#f8e9e7', bg2: '#ecc9c4', paper: '#fffaf9', ink: '#4a2c2f', muted: '#875f63', accent: '#b5606d', soft: '#f8e3e2', env: '#eec4c0', seal: '#a8475a', sealInk: '#fde8ea' },
  sage: { bg: '#e9efe7', bg2: '#cddbc8', paper: '#fbfcf8', ink: '#2f3b2f', muted: '#5f6d5b', accent: '#5f8259', soft: '#e5ede1', env: '#c6d6be', seal: '#4f6b49', sealInk: '#eef5ea' },
  midnight: { bg: '#1a2340', bg2: '#0a0f1e', paper: '#18203a', ink: '#f2ead8', muted: '#b9af9a', accent: '#d8b86e', soft: '#252f50', env: '#2a3557', seal: '#b8923c', sealInk: '#1b2238' },
  saperavi: { bg: '#4a1726', bg2: '#22080f', paper: '#fbf4ea', ink: '#3d1a22', muted: '#7a565b', accent: '#8e1f3a', soft: '#f3e5d9', env: '#74203a', seal: '#c9a04a', sealInk: '#4a1020' },
  emerald: { bg: '#134a40', bg2: '#06231e', paper: '#f7f6ef', ink: '#17302b', muted: '#58706a', accent: '#1d7560', soft: '#e3ece6', env: '#185d50', seal: '#c8a85a', sealInk: '#0f3b33' },
  lavender: { bg: '#ece8f6', bg2: '#d3c9ec', paper: '#fdfcff', ink: '#352e4d', muted: '#736a8c', accent: '#7560ad', soft: '#ece7f8', env: '#d4c8ee', seal: '#6a4fa3', sealInk: '#f3eefe' },
  sunny: { bg: '#fff1cf', bg2: '#ffd98f', paper: '#fffef9', ink: '#3a3226', muted: '#76684f', accent: '#cf6a1f', soft: '#fff1cc', env: '#ffcf70', seal: '#23877b', sealInk: '#ffffff' },
  mono: { bg: '#eceef1', bg2: '#d3d8e0', paper: '#ffffff', ink: '#1d2330', muted: '#5f6774', accent: '#2f5bd3', soft: '#eef1f6', env: '#cdd4de', seal: '#1d2330', sealInk: '#ffffff' },
};
export const THEME_KEYS = Object.keys(THEMES);
export const theme = (k) => THEMES[k] || THEMES.ivory;

// System font stacks only: the invitation never loads a font (no requests, works offline, no privacy leak to a font
// CDN). Each stack ends with Georgian-capable fonts (Noto Serif Georgian, Sylfaen) before the generic family,
// because most Latin script/serif fonts have no Georgian glyphs and the generic fallback may pick an ugly one.
export const FONTS = {
  script: '"Segoe Script", "Snell Roundhand", "Apple Chancery", "Brush Script MT", "URW Chancery L", Georgia, "Noto Serif Georgian", Sylfaen, cursive',
  serif: 'Georgia, Cambria, "Times New Roman", "Noto Serif", "Noto Serif Georgian", Sylfaen, serif',
  classic: '"Palatino Linotype", Palatino, "Book Antiqua", "URW Palladio L", Georgia, "Noto Serif Georgian", Sylfaen, serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Noto Sans Georgian", Sylfaen, sans-serif',
};
export const FONT_KEYS = Object.keys(FONTS);
// Script faces are for headings only; long body text in a script font is hard to read, so script -> serif body.
const BODY_FONT = { script: FONTS.serif, serif: FONTS.serif, classic: FONTS.classic, sans: FONTS.sans };

export const ORNAMENTS = ['floral', 'vine', 'rosette', 'deco', 'confetti', 'stars', 'none'];
export const DRESS_CODES = ['black-tie', 'formal', 'cocktail', 'smart', 'casual', 'national', 'themed', 'none'];

// Ornaments are generated SVG strings, drawn with fill="currentColor" so CSS `color` themes them; .o2 / .o3 parts
// take the seal and a pale accent. aria-hidden + focusable=false: decorative, and old Edge made SVGs tabbable.
// Helpers: leaf = rotated ellipse, petals = n ellipses rotated around a centre, star = four quadratic curves,
// mirror = draw the left half and reflect it (symmetry for free, half the coordinates to maintain).
const svg = (vb, body, cls = 'iv-orn') => `<svg class="${cls}" viewBox="${vb}" fill="currentColor" aria-hidden="true" focusable="false">${body}</svg>`;
const leaf = (x, y, a, s = 1) => `<ellipse cx="${x}" cy="${y}" rx="${(7 * s).toFixed(1)}" ry="${(2.7 * s).toFixed(1)}" transform="rotate(${a} ${x} ${y})"/>`;
const petals = (x, y, n, rx, ry, cls = '') => Array.from({ length: n }, (_, k) => `<ellipse${cls ? ` class="${cls}"` : ''} cx="${x}" cy="${y - ry}" rx="${rx}" ry="${ry}" transform="rotate(${(360 / n) * k} ${x} ${y})"/>`).join('');
const star = (x, y, r) => `<path d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z"/>`;
const grapes = (x, y, r) => [[-1, 0], [0, 0], [1, 0], [-0.5, 0.85], [0.5, 0.85], [0, 1.7]].map(([dx, dy]) => `<circle cx="${(x + dx * r * 1.9).toFixed(1)}" cy="${(y + dy * r * 1.9).toFixed(1)}" r="${r}"/>`).join('');
const vineLeaf = (x, y, s = 1) => `<path class="o3" transform="translate(${x} ${y}) scale(${s})" d="M0 9C-5 8-11 3-10-3-7-2-5-2-4-4-5-8-2-11 0-12 2-11 5-8 4-4 5-2 7-2 10-3 11 3 5 8 0 9Z"/>`;
const mirror = (body, w) => `${body}<g transform="translate(${w} 0) scale(-1 1)">${body}</g>`;

const FLORAL_SIDE = '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M114 36C94 34 72 44 24 34"/>'
  + [[104, 35, -28], [93, 37.5, 24], [81, 39.5, -20], [69, 40.5, 22], [57, 40, -16], [45, 38, 18], [34, 35.5, -12]].map(([x, y, a], i) => leaf(x, y + (i % 2 ? 3 : -3), a, 1 - i * 0.06)).join('')
  + '<circle class="o2" cx="24" cy="34" r="2.4"/><circle class="o2" cx="62" cy="47" r="1.6"/>';
const VINE_SIDE = '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M104 33C88 24 76 42 60 34S34 24 18 33"/>'
  + '<path fill="none" stroke="currentColor" stroke-width=".9" d="M78 30c-2-6 4-8 5-4"/><path fill="none" stroke="currentColor" stroke-width=".9" d="M40 30c-1-6 5-7 5-3"/>'
  + vineLeaf(66, 26, 0.75) + `<g class="o2">${grapes(50, 38, 2.6)}</g>`;

const HEADS = {
  floral: () => svg('0 0 240 64', mirror(FLORAL_SIDE, 240) + `<g class="o2">${petals(120, 34, 5, 4.4, 8)}</g><circle cx="120" cy="34" r="3.2"/>`),
  vine: () => svg('0 0 240 64', mirror(VINE_SIDE, 240) + vineLeaf(120, 14, 1.05) + `<g class="o2">${grapes(120, 27, 3.6)}</g>`),
  rosette: () => svg('0 0 240 64', '<g fill="none" stroke="currentColor" stroke-width="1.2"><path d="M22 30H94M22 35H94M146 30H218M146 35H218"/>'
    + `<circle cx="120" cy="32" r="21"/><circle cx="120" cy="32" r="17" stroke-dasharray="2 3"/>${petals(120, 32, 8, 3.6, 7.5)}</g>`
    + '<circle class="o2" cx="120" cy="32" r="3.6"/><path d="M16 32.5l4-4 4 4-4 4zM216 32.5l4-4 4 4-4 4z"/>'),
  deco: () => svg('0 0 240 64', '<g fill="none" stroke="currentColor" stroke-width="1.2"><path d="M96 46A24 24 0 0 1 144 46M103 46A17 17 0 0 1 137 46M110 46A10 10 0 0 1 130 46"/>'
    + Array.from({ length: 9 }, (_, k) => { const a = Math.PI * (k + 1) / 10; return `<path d="M${(120 - Math.cos(a) * 26).toFixed(1)} ${(46 - Math.sin(a) * 26).toFixed(1)}L${(120 - Math.cos(a) * 34).toFixed(1)} ${(46 - Math.sin(a) * 34).toFixed(1)}"/>`; }).join('')
    + '<path d="M20 46H92M28 51H96M148 46H220M144 51H212"/></g><path d="M14 46l5-5 5 5-5 5zM216 46l5-5 5 5-5 5z"/><path class="o2" d="M115 46l5-5 5 5z"/>'),
  confetti: () => svg('0 0 240 64', [[18, 30, 0, 'c'], [34, 16, 30, 'r'], [52, 40, 0, 'c2'], [70, 22, 60, 'r2'], [86, 46, 15, 'r'], [100, 14, 0, 'c'], [118, 34, 45, 'r3'], [136, 18, 0, 'c3'], [152, 44, 20, 'r'], [168, 24, 0, 'c2'], [186, 40, 70, 'r2'], [204, 16, 0, 'c'], [222, 34, 35, 'r3'], [60, 54, 0, 'c3'], [176, 56, 0, 'c']]
    .map(([x, y, a, k]) => {
      const cls = k.endsWith('2') ? ' class="o2"' : k.endsWith('3') ? ' class="o3"' : '';
      return k[0] === 'c' ? `<circle${cls} cx="${x}" cy="${y}" r="3.2"/>` : `<rect${cls} x="${x - 5}" y="${y - 1.8}" width="10" height="3.6" rx="1" transform="rotate(${a} ${x} ${y})"/>`;
    }).join('')),
  stars: () => svg('0 0 240 64', star(120, 32, 15) + `<g class="o2">${star(88, 24, 6)}${star(152, 40, 6)}</g>${star(60, 38, 4)}${star(180, 22, 4)}<g class="o3">${star(34, 26, 3)}${star(206, 42, 3)}</g>`),
  none: () => svg('0 0 240 64', '<path fill="none" stroke="currentColor" stroke-width="1.2" d="M70 32H110M130 32H170"/><circle cx="120" cy="32" r="2.6"/>'),
};
const CORNERS = {
  floral: () => svg('0 0 100 100', '<path fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" d="M4 74C6 38 30 10 74 4"/>'
    + [[8, 56, -70], [14, 40, -55], [24, 26, -40], [38, 15, -25], [54, 8, -12]].map(([x, y, a], i) => leaf(x + (i % 2 ? 4 : -2), y + (i % 2 ? 2 : -1), a + (i % 2 ? 40 : -20), 0.9)).join('')
    + '<circle class="o2" cx="74" cy="4" r="2.2"/><circle class="o2" cx="4" cy="74" r="2.2"/>', 'iv-orn iv-corner'),
  vine: () => svg('0 0 100 100', '<path fill="none" stroke="currentColor" stroke-width="1.2" d="M4 82Q8 14 82 4"/><path fill="none" stroke="currentColor" stroke-width=".8" d="M30 20c-4-5 1-9 4-6"/>'
    + vineLeaf(16, 30, 0.7) + `<g class="o2">${grapes(30, 32, 2.3)}</g>`, 'iv-orn iv-corner'),
  rosette: () => svg('0 0 100 100', '<g fill="none" stroke="currentColor" stroke-width="1.1"><path d="M6 66V6H66M12 58V12H58"/>' + petals(12, 12, 8, 1.8, 4) + '</g><circle class="o2" cx="12" cy="12" r="2"/>', 'iv-orn iv-corner'),
  deco: () => svg('0 0 100 100', '<g fill="none" stroke="currentColor" stroke-width="1.1"><path d="M4 72V4H72M10 60V10H60M16 40V16H40"/></g><path class="o2" d="M16 21l5-5 5 5-5 5z"/>', 'iv-orn iv-corner'),
};
const DIVIDER_MARK = {
  floral: `${leaf(54, 8, -25, 0.8)}${leaf(66, 8, 25, 0.8)}`, vine: `<g class="o2">${grapes(60, 4, 1.8)}</g>`,
  rosette: '<path d="M60 3l5 5-5 5-5-5z"/>', deco: '<path d="M60 3l5 5-5 5-5-5z"/>', stars: star(60, 8, 6),
  confetti: '<circle cx="52" cy="8" r="2"/><circle class="o2" cx="60" cy="8" r="2"/><circle class="o3" cx="68" cy="8" r="2"/>', none: '<circle cx="60" cy="8" r="2"/>',
};
// Unknown keys fall back to 'none' so stale saved data or a removed ornament never breaks rendering.
export const ornamentHead = (k) => (HEADS[k] || HEADS.none)();
const divider = (k) => svg('0 0 120 16', `<path fill="none" stroke="currentColor" stroke-width="1" d="M8 8H46M74 8H112"/>${DIVIDER_MARK[k] || DIVIDER_MARK.none}`, 'iv-orn iv-div');
const corners = (k) => (CORNERS[k] ? ['tl', 'tr', 'bl', 'br'].map((c) => `<span class="iv-c iv-c-${c}">${CORNERS[k]()}</span>`).join('') : '');

// Initials for the seal: "Nino & Giorgi" -> "N&G", "Ana" -> "A".
// Array.from(...)[0] takes the first code point, not the first UTF-16 unit, so astral letters are not split.
export function sealText(D, lang) {
  const own = String((D.design && D.design.seal) || '').trim();
  if (own) return own.slice(0, 4);
  const hosts = txt(D.hosts, lang, D.langs[0]) || txt(D.title, lang, D.langs[0]);
  // KNOWN DEFECT: \b is ASCII-only in JS regexes (also with the u flag), so \bи\b, \bі\b, \bта\b never match between
  // spaces ("Нино и Гиорги" yields one initial), while და has no boundary at all and splits inside words such as
  // "დავითი". Fix: use \s+(?:и|і|та|და)\s+ (or Unicode lookarounds (?<!\p{L})...(?!\p{L}) with the u flag).
  const parts = hosts.split(/\s*(?:&|\+|\band\b|\bund\b|\bet\b|\by\b|\bи\b|\bі\b|\bта\b|და)\s*/i).map((s) => s.trim()).filter(Boolean);
  const first = (s) => (Array.from(s.replace(/^[^\p{L}\p{N}]+/u, ''))[0] || '').toUpperCase();
  if (parts.length >= 2) return parts.slice(0, 2).map(first).join('&');
  return first(hosts) || '♥';
}

// --- dates ---------------------------------------------------------------------------------------------------------

// Local calendar day (not toISOString, which is UTC and gives yesterday/tomorrow near midnight).
export const localDay = (d = new Date()) => `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// ISO day strings compare correctly as strings (fixed-width YYYY-MM-DD), hence the plain `>`.
const multiDay = (D) => !!(D.endDay && parseDay(D.endDay) && D.endDay > D.day);

// "Saturday, June 12, 2027" (or a range of days).
export function dateWords(D, lang) {
  if (!parseDay(D.day)) return '';
  const a = formatEventDate(D.day, lang, { weekday: true, time: false });
  return multiDay(D) ? `${a} – ${formatEventDate(D.endDay, lang, { weekday: true, time: false })}` : a;
}
export const timeWords = (D) => (D.time ? D.time + (D.endTime ? '–' + D.endTime : '') : '');

// Countdown: today / tomorrow / in N days / now (multi-day, under way) / past; '' without a date.
export function countdown(D, lang, today) {
  if (!parseDay(D.day) || !parseDay(today)) return '';
  const d = dayDiff(D.day, today);
  if (d > 1) return tr(D, lang, 'ei.inv.inDays', { n: d });
  if (d === 1) return tr(D, lang, 'ei.inv.tomorrow');
  if (d === 0) return tr(D, lang, 'ei.inv.today');
  if (multiDay(D) && D.endDay >= today) return tr(D, lang, 'ei.inv.now');
  return tr(D, lang, 'ei.inv.past');
}

// The event start and end as model values of calendar/ics.js (wall clock in D.tz, or all-day).
// An end time at or before the start time means the party runs past midnight: the end moves to the next day.
// Multi-day without an end time ends at 23:59 of the last day; no time at all = an all-day event.
export function eventSpan(D) {
  if (!parseDay(D.day)) return null;
  if (!D.time || Number.isNaN(parseTime(D.time))) return { start: D.day, end: multiDay(D) ? D.endDay : '', allDay: true };
  const start = `${D.day}T${D.time}`;
  let end = '';
  if (D.endTime && !Number.isNaN(parseTime(D.endTime))) {
    let endDay = multiDay(D) ? D.endDay : D.day;
    if (endDay === D.day && parseTime(D.endTime) <= parseTime(D.time)) endDay = addDays(D.day, 1);
    end = `${endDay}T${D.endTime}`;
  } else if (multiDay(D)) end = `${D.endDay}T23:59`;
  return { start, end, allDay: false };
}

// --- links ---------------------------------------------------------------------------------------------------------

export function geoOf(D) {
  // Accepts a decimal comma ("41,69"), common in European locales. lat must be non-empty: Number('') is 0, which
  // would otherwise place every event without coordinates in the Gulf of Guinea.
  const lat = Number(String((D.geo && D.geo.lat) ?? '').replace(',', '.')), lon = Number(String((D.geo && D.geo.lon) ?? '').replace(',', '.'));
  return String(D.geo?.lat ?? '').trim() !== '' && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}
// Map links (navigation only, the page never loads them): OpenStreetMap and the geo: URI of phone map apps.
export function mapLinks(D, lang) {
  const g = geoOf(D);
  if (g) return { osm: `https://www.openstreetmap.org/?mlat=${g.lat}&mlon=${g.lon}#map=17/${g.lat}/${g.lon}`, geo: `geo:${g.lat},${g.lon}` };
  const addr = [txt(D.venue?.name, lang, D.langs[0]), txt(D.venue?.address, lang, D.langs[0])].filter(Boolean).join(', ');
  return addr ? { osm: 'https://www.openstreetmap.org/search?query=' + encodeURIComponent(addr), geo: '' } : null;
}

// --- guest tokens --------------------------------------------------------------------------------------------------

// base64url of UTF-8: btoa only accepts Latin-1, so the string is first turned into one char per UTF-8 byte.
// URL-safe alphabet and no padding: the token sits in a URL fragment and must survive copy/paste in chat apps.
function b64u(s) {
  let bin = '';
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64u(s) {
  let x = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (x.length % 4) x += '=';
  const bin = atob(x);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
// The guest of a personalised link: { i: id, n: name | { lang: name }, p: companions allowed, l: language }. The
// token carries only this guest, so the file itself holds no guest list.
// Not a secret and not signed: anyone can edit their own token (e.g. raise p). The host sees replies and decides;
// signing would need a key in the page, which a guest could read anyway.
// token carries only this guest, so the file itself holds no guest list.
export function encodeGuest(g) {
  const o = { i: String(g.i || '').slice(0, 24) };
  const names = g.n && typeof g.n === 'object' ? Object.fromEntries(Object.entries(g.n).filter(([, v]) => v)) : null;
  o.n = names && Object.keys(names).length > 1 ? names : String((names && Object.values(names)[0]) || g.n || '').slice(0, 120);
  if (g.p) o.p = Math.max(0, Math.min(9, g.p | 0));
  if (g.l) o.l = g.l;
  return b64u(JSON.stringify(o));
}
// The decoder treats the token as hostile: length cap before any work, languages whitelisted, control chars removed,
// id reduced to [\w-]. Any exception = no guest.
export function decodeGuest(token) {
  if (!token || String(token).length > 2000) return null;
  try {
    const o = JSON.parse(unb64u(token));
    if (!o || typeof o !== 'object') return null;
    const clean = (v) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120);
    const n = o.n && typeof o.n === 'object' ? Object.fromEntries(Object.entries(o.n).filter(([k]) => LANGS.includes(k)).map(([k, v]) => [k, clean(v)])) : clean(o.n);
    return { i: String(o.i || '').replace(/[^\w-]/g, '').slice(0, 24), n, p: Math.max(0, Math.min(9, o.p | 0)), l: LANGS.includes(o.l) ? o.l : '' };
  } catch { return null; }
}
export const guestDisplayName = (g, lang, main) => (!g ? '' : typeof g.n === 'object' ? txt(g.n, lang, main) : String(g.n || ''));

// The language to show: the guest's, then the browser's, then the main one.
export function pickLang(D, pref, browser = []) {
  if (pref && D.langs.includes(pref)) return pref;
  // Browser tags like "de-AT" reduce to the primary subtag; region variants of the content languages are not separate.
  for (const l of browser || []) { const b = String(l).toLowerCase().split(/[-_]/)[0]; if (D.langs.includes(b)) return b; }
  return D.langs[0];
}

// --- replies -------------------------------------------------------------------------------------------------------

export const menuOptions = (D, lang) => txt(D.rsvp?.menu, lang, D.langs[0]).split(/[,;\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 8);
// The reply tag uses | as field separator and [ ] as delimiters; removing those (and newlines) from free text makes
// the tag unambiguous to parse without an escaping scheme.
const tagSafe = (s) => String(s == null ? '' : s).replace(/[|\]\[\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

// Reply { name, response (yes / maybe / no), plus, menu, diet, msg, id } -> the text the guest sends. The last line is a
// machine tag the designer reads back: [RSVP|id|response|companions|name|menu|diet].
// Human-readable lines first (the host reads the mail), the machine tag last so a reply survives mail clients that
// quote, re-wrap or translate the body: only the tag needs to arrive intact.
// machine tag the designer reads back: [RSVP|id|response|companions|name|menu|diet].
export function replyText(D, lang, r) {
  const yes = r.response === 'yes', plus = yes ? Math.max(0, r.plus | 0) : 0;
  const lines = [txt(D.title, lang, D.langs[0]) + (parseDay(D.day) ? ' — ' + formatEventDate(D.day, lang, { time: false }) : '')];
  lines.push(`${r.name}: ${tr(D, lang, 'ei.inv.r.' + r.response)}${plus ? ' ' + tr(D, lang, 'ei.inv.r.plus', { n: plus }) : ''}`);
  if (yes && r.menu) lines.push(`${tr(D, lang, 'ei.inv.menu')}: ${r.menu}`);
  if (yes && r.diet) lines.push(`${tr(D, lang, 'ei.inv.diet')}: ${r.diet}`);
  if (r.msg && r.msg.trim()) lines.push('', r.msg.trim());
  lines.push('', `[RSVP|${tagSafe(r.id) || '-'}|${r.response}|${plus}|${tagSafe(r.name)}|${yes ? tagSafe(r.menu) : ''}|${yes ? tagSafe(r.diet) : ''}]`);
  return lines.join('\n');
}
export const replySubject = (D, lang) => tr(D, lang, 'ei.inv.subject', { title: txt(D.title, lang, D.langs[0]) });

// Every reply tag in pasted text (mail bodies, chats): [{ id, response, plus, name, menu, diet }].
// Global regex with exec in a loop: finds every tag in a whole pasted mailbox. menu and diet groups are optional so
// tags from older versions still parse. maybeNo is accepted although replyText never emits it (manual imports).
// The 2000 cap bounds work on a huge paste.
export function parseReplies(text) {
  const out = [];
  const re = /\[RSVP\|([^|\]]*)\|(yes|maybe|maybeNo|no)\|(\d{1,2})\|([^|\]]*)(?:\|([^|\]]*))?(?:\|([^\]]*))?\]/g;
  let m;
  while ((m = re.exec(String(text || ''))) && out.length < 2000) {
    out.push({ id: m[1].trim() === '-' ? '' : m[1].trim(), response: m[2], plus: +m[3], name: m[4].trim(), menu: (m[5] || '').trim(), diet: (m[6] || '').trim() });
  }
  return out;
}

// QR content of a reply: MATMSG for e-mail (phone scanners open a new mail), SMSTO for a phone, else the text.
// MATMSG fields escape \ ; : , with a backslash (the format's own escaping). The address itself is not escaped:
// e-mail addresses cannot legally contain those characters unquoted.
export function replyQRText(D, lang, text) {
  const q = (s) => String(s).replace(/([\\;:,])/g, '\\$1');
  if (D.rsvp?.email) return `MATMSG:TO:${D.rsvp.email};SUB:${q(replySubject(D, lang))};BODY:${q(text)};;`;
  if (D.rsvp?.phone) return `SMSTO:${String(D.rsvp.phone).replace(/[\s().-]/g, '')}:${text}`;
  return text;
}

// --- iCalendar -----------------------------------------------------------------------------------------------------

export function icsText(D, lang = D.langs[0]) {
  const span = eventSpan(D);
  if (!span) return '';
  const m = D.langs[0];
  const title = txt(D.title, lang, m) || 'Event';
  const place = [txt(D.venue?.name, lang, m), txt(D.venue?.address, lang, m)].filter(Boolean).join(', ');
  const prog = scheduleDays((D.programme || []).filter((p) => txt(p.title, lang, m))).flatMap((g) => g.items.map((p) => `${g.day && multiDay(D) ? g.day + ' ' : ''}${p.at ? p.at + ' ' : ''}${txt(p.title, lang, m)}`));
  const desc = [txt(D.hosts, lang, m), txt(D.message, lang, m), prog.join('\n'), D.dress?.code && D.dress.code !== 'none' ? tr(D, lang, 'ei.inv.dress') + ': ' + tr(D, lang, 'ei.inv.dress.' + D.dress.code) : '']
    .filter(Boolean).join('\n\n');
  const g = geoOf(D);
  // The UID is stable per event (D.uid), so re-importing an updated .ics updates the calendar entry instead of
  // duplicating it. A 24h alarm is a sensible default for a social event; PT3H when no end time is known.
  const ev = {
    uid: (D.uid || 'event') + '@event-invite', start: span.start, allDay: span.allDay, tz: span.allDay ? '' : D.tz || '', title, description: desc,
    location: place, categories: [tr(D, lang, 'ei.inv.kind.' + D.type)], stamp: D.stamp || span.start,
    alarms: [{ trigger: 24 * 60, description: title }],
  };
  if (span.end) ev.end = span.end; else if (!span.allDay) ev.duration = 'PT3H';
  if (g) ev.geo = g;
  if (D.link) ev.url = D.link;
  if (D.rsvp?.email) ev.organizer = { email: D.rsvp.email, name: txt(D.hosts, lang, m) };
  return buildEvent(ev, { prodId: '-//in-html//event-invite//EN', name: title });
}

// --- markup --------------------------------------------------------------------------------------------------------

// Markup builders below: semantic sections with an h2 each, so the card has a real outline for screen readers.
const sec = (cls, head, body) => `<section class="iv-sec ${cls}"><h2 class="iv-h2">${esc(head)}</h2>${body}</section>`;

function programmeHTML(D, lang) {
  const m = D.langs[0];
  const items = (D.programme || []).filter((p) => txt(p.title, lang, m));
  if (!items.length) return '';
  const groups = scheduleDays(items);
  const many = groups.filter((g) => g.day).length > 1;
  const body = groups.map((g) => (many && g.day ? `<h3 class="iv-h3">${esc(formatEventDate(g.day, lang, { weekday: true, time: false }))}</h3>` : '')
    + `<ol class="iv-pg">${g.items.map((p) => `<li><span class="iv-pg-t">${esc(p.at || '')}</span><span class="iv-pg-n">${esc(txt(p.title, lang, m))}</span></li>`).join('')}</ol>`).join('');
  return sec('iv-pg-sec', tr(D, lang, 'ei.inv.programme'), body);
}

function dressHTML(D, lang) {
  const d = D.dress || {};
  const note = txt(d.note, lang, D.langs[0]);
  // Colours validated again even though normalizeEvent did: they are interpolated into a style attribute, where an
  // unvalidated value would allow CSS injection.
  const colors = (d.colors || []).filter((c) => /^#[0-9a-f]{6}$/i.test(c));
  if ((!d.code || d.code === 'none') && !note && !colors.length) return '';
  const head = d.code && d.code !== 'none' ? `<p class="iv-dress-code">${esc(tr(D, lang, 'ei.inv.dress.' + d.code))}</p>` : '';
  const sw = colors.length ? `<p class="iv-swatches">${colors.map((c) => `<span class="iv-sw" style="background:${c}" title="${c}"></span>`).join('')}</p>` : '';
  return sec('iv-dress-sec', tr(D, lang, 'ei.inv.dress'), head + (note ? `<p class="iv-note">${esc(note)}</p>` : '') + sw);
}

function venueHTML(D, lang, o) {
  const m = D.langs[0];
  const name = txt(D.venue?.name, lang, m), addr = txt(D.venue?.address, lang, m);
  if (!name && !addr) return '';
  const links = mapLinks(D, lang);
  // target=_blank with rel="noopener noreferrer": the map tab cannot script this page or learn its URL.
  // The geo: link opens the phone's map app; it is navigation only, nothing is loaded.
  const acts = !o.print && links ? `<p class="iv-actions">${links.osm ? `<a class="iv-btn" href="${esc(links.osm)}" target="_blank" rel="noopener noreferrer">${esc(tr(D, lang, 'ei.inv.map'))}</a>` : ''}${links.geo ? `<a class="iv-btn" href="${esc(links.geo)}">${esc(tr(D, lang, 'ei.inv.geo'))}</a>` : ''}</p>` : '';
  return sec('iv-where', tr(D, lang, 'ei.inv.where'), `${name ? `<p class="iv-venue">${esc(name)}</p>` : ''}${addr ? `<p class="iv-addr">${esc(addr)}</p>` : ''}${acts}`);
}

// Contacts and deadline of the replies (the printed card and the page without scripts).
// tel: keeps only digits and +, because spaces and brackets break some dialers.
function rsvpInfo(D, lang) {
  const r = D.rsvp || {};
  const bits = [];
  if (parseDay(r.deadline)) bits.push(`<p>${esc(tr(D, lang, 'ei.inv.deadline', { date: formatEventDate(r.deadline, lang, { time: false }) }))}</p>`);
  const c = [r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : '', r.phone ? `<a href="tel:${esc(String(r.phone).replace(/[^\d+]/g, ''))}">${esc(r.phone)}</a>` : ''].filter(Boolean);
  if (c.length) bits.push(`<p class="iv-contacts">${c.join(' · ')}</p>`);
  const note = txt(r.note, lang, D.langs[0]);
  if (note) bits.push(`<p class="iv-note">${esc(note)}</p>`);
  return bits.join('');
}

// The RSVP form of the page (bound by invite-runtime.js). F: the current form values.
// novalidate: validation messages come from the runtime in the card's language, not the browser's UI language.
// A guest from a personal link gets the name as a hidden field (already known). The companion limit is the guest's
// own `p` only for personal links (guest.i set); a generic link uses the event default.
// "yes only" fields carry `hidden` server-side too, so the first paint matches the current answer (no flicker).
export function rsvpFormHTML(D, lang, guest, F = {}) {
  const r = D.rsvp || {};
  const max = guest && guest.p != null && guest.i ? guest.p : Math.max(0, r.plus | 0);
  const opts = ['yes', ...(r.maybe !== false ? ['maybe'] : []), 'no'];
  const gname = guestDisplayName(guest, lang, D.langs[0]);
  const menu = menuOptions(D, lang);
  const radios = opts.map((v) => `<label class="iv-opt"><input type="radio" name="iv-r" value="${v}"${F.response === v ? ' checked' : ''}><span>${esc(tr(D, lang, 'ei.inv.' + v))}</span></label>`).join('');
  const showYes = F.response === 'yes';
  return `<form class="iv-form" novalidate>
<fieldset class="iv-opts"><legend class="iv-sr">${esc(tr(D, lang, 'ei.inv.rsvp'))}</legend>${radios}</fieldset>
<div class="iv-fields">
${gname ? `<input type="hidden" name="iv-name" value="${esc(gname)}">` : `<label class="iv-f"><span>${esc(tr(D, lang, 'ei.inv.name'))}</span><input name="iv-name" autocomplete="name" maxlength="120" value="${esc(F.name || '')}"></label>`}
${max > 0 ? `<label class="iv-f iv-if-yes"${showYes ? '' : ' hidden'}><span>${esc(tr(D, lang, 'ei.inv.plus'))} <small>${esc(tr(D, lang, 'ei.inv.plusMax', { n: max }))}</small></span><input name="iv-plus" type="number" inputmode="numeric" min="0" max="${max}" value="${Math.min(max, F.plus | 0)}"></label>` : ''}
${menu.length ? `<label class="iv-f iv-if-yes"${showYes ? '' : ' hidden'}><span>${esc(tr(D, lang, 'ei.inv.menu'))}</span><select name="iv-menu"><option value=""></option>${menu.map((x) => `<option${F.menu === x ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></label>` : ''}
<label class="iv-f iv-if-yes"${showYes ? '' : ' hidden'}><span>${esc(tr(D, lang, 'ei.inv.diet'))}</span><input name="iv-diet" maxlength="200" value="${esc(F.diet || '')}"></label>
<label class="iv-f"><span>${esc(tr(D, lang, 'ei.inv.msg'))}</span><textarea name="iv-msg" rows="3" maxlength="1000">${esc(F.msg || '')}</textarea></label>
</div>
<p class="iv-err" role="alert"></p>
<p class="iv-actions"><button class="iv-btn iv-primary" type="submit">${esc(tr(D, lang, 'ei.inv.prepare'))}</button></p>
</form>
<div class="iv-reply" hidden></div>`;
}

// The reply panel after "Prepare the reply": text, e-mail / SMS links, copy button and the QR code (qr: SVG markup).
// The mailto body uses CRLF line breaks (RFC 6068 requires %0D%0A); the SMS body keeps LF, which SMS apps expect.
export function replyPanelHTML(D, lang, text, qr) {
  const r = D.rsvp || {};
  const mail = r.email ? `mailto:${encodeURIComponent(r.email).replace(/%40/g, '@')}?subject=${encodeURIComponent(replySubject(D, lang))}&body=${encodeURIComponent(text.replace(/\r?\n/g, '\r\n'))}` : '';
  const sms = r.phone ? `sms:${String(r.phone).replace(/[^\d+]/g, '')}?body=${encodeURIComponent(text)}` : '';
  return `<p class="iv-hint">${esc(tr(D, lang, 'ei.inv.replyHint'))}</p>
<pre class="iv-reply-text" tabindex="0">${esc(text)}</pre>
<p class="iv-actions">${mail ? `<a class="iv-btn iv-primary" data-mail href="${esc(mail)}">${esc(tr(D, lang, 'ei.inv.send'))}</a>` : ''}${sms ? `<a class="iv-btn" href="${esc(sms)}">${esc(tr(D, lang, 'ei.inv.sms'))}</a>` : ''}<button class="iv-btn" type="button" data-copy>${esc(tr(D, lang, 'ei.inv.copy'))}</button></p>
${qr ? `<figure class="iv-qr"><div class="iv-qr-img">${qr}</div><figcaption>${esc(tr(D, lang, 'ei.inv.qr'))}</figcaption></figure>` : ''}`;
}

// The card. o: { guest, today, print, noscript, qr (SVG of the invitation link, printed cards), F (form values) }.
// print / noscript variants drop every interactive part (countdown, calendar button, form) and show contact info
// instead, so the card is complete on paper and without JavaScript.
export function cardHTML(D, lang, o = {}) {
  const m = D.langs[0], orn = D.design?.ornament || 'floral';
  const title = txt(D.title, lang, m), hosts = txt(D.hosts, lang, m), msg = txt(D.message, lang, m);
  const gname = guestDisplayName(o.guest, lang, m);
  const cd = o.print || o.noscript ? '' : countdown(D, lang, o.today);
  const when = parseDay(D.day) ? `<div class="iv-when"><p class="iv-date">${esc(dateWords(D, lang))}</p>${timeWords(D) ? `<p class="iv-time">${esc(timeWords(D))}</p>` : ''}${cd ? `<p class="iv-count">${esc(cd)}</p>` : ''}</div>` : '';
  const calendar = !o.print && !o.noscript && parseDay(D.day) ? `<p class="iv-actions"><button class="iv-btn" type="button" data-ics>${esc(tr(D, lang, 'ei.inv.calendar'))}</button></p>` : '';
  const rsvp = o.print || o.noscript
    ? (rsvpInfo(D, lang) ? sec('iv-rsvp-sec', tr(D, lang, 'ei.inv.rsvp'), rsvpInfo(D, lang)) : '')
    : sec('iv-rsvp-sec', tr(D, lang, 'ei.inv.rsvp'), rsvpInfo(D, lang) + (D.endpoint && D.live ? '<p class="iv-live" hidden></p>' : '') + rsvpFormHTML(D, lang, o.guest, o.F));
  // aria-pressed marks the active language button; lang on each button lets screen readers pronounce its own name.
  // The title has tabindex=-1: focusable by script only (the runtime focuses it after opening), not in tab order.
  const langs = !o.print && D.langs.length > 1 ? `<nav class="iv-langs" aria-label="${esc(tr(D, lang, 'ei.inv.lang'))}">${D.langs.map((l) => `<button type="button" class="iv-lang${l === lang ? ' iv-on' : ''}" data-lang="${l}" lang="${l}" aria-pressed="${l === lang}">${esc(LANG_NAMES[l] || l)}</button>`).join('')}</nav>` : '';
  return `<article class="iv-card" lang="${lang}">${corners(orn)}
<div class="iv-head">${ornamentHead(orn)}</div>
<p class="iv-kicker">${esc(tr(D, lang, 'ei.inv.kind.' + D.type))}</p>
${gname ? `<p class="iv-dear">${esc(tr(D, lang, 'ei.inv.dear', { name: gname }))}</p>` : ''}
${hosts ? `<p class="iv-hosts">${esc(hosts)}</p>` : ''}
${msg ? `<p class="iv-lead">${esc(msg)}</p>` : ''}
<h1 class="iv-title" tabindex="-1">${esc(title)}</h1>
${divider(orn)}
${when}${calendar}${venueHTML(D, lang, o)}${programmeHTML(D, lang)}${dressHTML(D, lang)}${rsvp}
${o.qr ? `<figure class="iv-qr iv-qr-print"><div class="iv-qr-img">${o.qr}</div><figcaption>${esc(tr(D, lang, 'ei.inv.scan'))}</figcaption></figure>` : ''}
${langs}
</article>`;
}

// Names of the content languages in their own language.
export const LANG_NAMES = { en: 'English', ru: 'Русский', uk: 'Українська', de: 'Deutsch', fr: 'Français', es: 'Español', ka: 'ქართული' };

// The closed envelope (role button: a click, Enter or Space opens it).
// Built from layered divs (back, letter, front, flap, seal) so CSS can animate each part independently.
export function envelopeHTML(D, lang, guest) {
  const gname = guestDisplayName(guest, lang, D.langs[0]);
  const label = tr(D, lang, 'ei.inv.open');
  return `<div class="iv-env-stage">
<div class="iv-env" role="button" tabindex="0" aria-label="${esc(label)}">
<div class="iv-env-back"></div><div class="iv-env-letter"><span class="iv-env-mini">${ornamentHead(D.design?.ornament || 'floral')}</span></div><div class="iv-env-front"></div><div class="iv-env-flap"></div>
<div class="iv-env-seal"><span>${esc(sealText(D, lang))}</span></div>
</div>
${gname ? `<p class="iv-env-to">${esc(tr(D, lang, 'ei.inv.for', { name: gname }))}</p>` : `<p class="iv-env-to">${esc(txt(D.title, lang, D.langs[0]))}</p>`}
<p><button class="iv-btn iv-primary iv-open" type="button">${esc(label)}</button></p>
</div>`;
}

// --- stylesheet ----------------------------------------------------------------------------------------------------

// Stylesheet as a function of D: theme values become custom properties on .iv-root, everything else is static.
// Rules of this CSS (comments cannot live inside the template string, so they are collected here):
// - All selectors are .iv-* so the same CSS can be injected into the designer's print sheet without collisions.
// - clamp() for padding and type: fluid from phone to desktop without media queries.
// - .iv-card::before draws the inner frame line; pointer-events:none so it never blocks clicks.
// - Corners are one SVG, mirrored by scaleX / scaleY / scale(-1) for the other three corners.
// - .iv-sr is the standard visually-hidden pattern (clip, 1px), keeping the fieldset legend for screen readers.
// - Radio pills: the real input stays in the DOM (opacity 0, not display:none) so keyboard and form semantics remain;
//   `input:checked + span` and `input:focus-visible + span` style the visible pill.
// - Envelope: clip-path triangles for the front and flap; the flap rotates about its top edge (rotateX) inside a
//   perspective container, and its z-index switches with a 0.3s delay (`z-index 0s .3s`) so it passes behind the
//   letter halfway through the turn. The letter slides up after a .55s delay, once the flap is open.
// - .iv-err uses a raw red (#b42318): errors must read as errors on every theme, including those whose accent is red.
// - Reduced motion and .iv-still kill every transition/animation with !important, which must beat the specific
//   transition rules above.
// - Print hides interactive parts; the card loses its shadow and fills the page width.
export function inviteCSS(D) {
  const th = theme(D.design?.theme), f = D.design?.font || 'serif';
  const vars = `--bg:${th.bg};--bg2:${th.bg2};--paper:${th.paper};--ink:${th.ink};--muted:${th.muted};--acc:${th.accent};--soft:${th.soft};--env:${th.env};--seal:${th.seal};--seal-ink:${th.sealInk};--head:${FONTS[f] || FONTS.serif};--body:${BODY_FONT[f] || FONTS.serif}`;
  return `.iv-root{${vars};color:var(--ink);background:radial-gradient(120% 90% at 50% 0%,var(--bg) 0%,var(--bg2) 100%) fixed;min-height:100vh;margin:0;font:16px/1.6 var(--body);-webkit-text-size-adjust:100%}
.iv-root *,.iv-root *::before,.iv-root *::after{box-sizing:border-box}
.iv-wrap{display:flex;flex-direction:column;align-items:center;gap:20px;padding:clamp(16px,5vw,56px) 16px 48px}
.iv-card{position:relative;width:min(100%,640px);background:var(--paper);border-radius:8px;padding:clamp(40px,8vw,72px) clamp(22px,7vw,64px) clamp(36px,6vw,56px);text-align:center;font-size:clamp(15px,3.7vw,17px);box-shadow:0 34px 70px -30px rgba(0,0,0,.55),0 2px 8px rgba(0,0,0,.08);overflow:hidden}
.iv-card::before{content:"";position:absolute;inset:10px;border:1px solid color-mix(in srgb,var(--acc) 40%,transparent);border-radius:4px;pointer-events:none}
.iv-c{position:absolute;width:clamp(54px,15vw,96px);height:clamp(54px,15vw,96px);color:var(--acc);pointer-events:none}
.iv-c-tl{top:14px;left:14px}.iv-c-tr{top:14px;right:14px;transform:scaleX(-1)}.iv-c-bl{bottom:14px;left:14px;transform:scaleY(-1)}.iv-c-br{bottom:14px;right:14px;transform:scale(-1)}
.iv-orn{display:block;width:100%;height:auto;overflow:visible}.iv-orn .o2{fill:var(--seal)}.iv-orn .o3{fill:color-mix(in srgb,var(--acc) 55%,var(--paper))}
.iv-head{width:min(100%,270px);margin:0 auto 10px;color:var(--acc)}
.iv-div{width:120px;margin:18px auto;color:var(--acc)}
.iv-kicker{margin:0 0 10px;font:600 .72em/1.3 var(--body);letter-spacing:.22em;text-transform:uppercase;color:var(--muted)}
.iv-dear{margin:0 0 6px;font-style:italic;color:var(--muted)}
.iv-hosts{margin:0;font:400 1.55em/1.25 var(--head);color:var(--acc)}
.iv-lead{margin:12px auto 0;max-width:44ch;white-space:pre-line;color:var(--muted)}
.iv-title{margin:14px 0 0;font:400 2.5em/1.12 var(--head);letter-spacing:.005em;color:var(--ink);overflow-wrap:anywhere;outline:none}
.iv-when p{margin:0}.iv-date{font-size:1.18em;font-weight:600;letter-spacing:.01em}.iv-time{font-size:1.05em;color:var(--muted);font-variant-numeric:tabular-nums}
.iv-count{display:inline-block;margin-top:10px!important;padding:3px 14px;border-radius:999px;background:var(--soft);color:var(--acc);font-size:.85em;font-weight:600}
.iv-sec{margin-top:30px}.iv-h2{margin:0 0 10px;font:600 .74em/1.3 var(--body);letter-spacing:.2em;text-transform:uppercase;color:var(--acc)}
.iv-h3{margin:14px 0 4px;font:600 .9em/1.3 var(--body);color:var(--muted)}
.iv-sec p{margin:0 0 4px}.iv-venue{font-weight:600;font-size:1.08em}.iv-addr,.iv-note{color:var(--muted);white-space:pre-line}
.iv-pg{list-style:none;margin:0 auto;padding:0;max-width:420px;text-align:start}
.iv-pg li{display:grid;grid-template-columns:4.2em 1fr;gap:12px;padding:7px 0;border-bottom:1px dashed color-mix(in srgb,var(--acc) 30%,transparent)}
.iv-pg li:last-child{border-bottom:0}.iv-pg-t{color:var(--acc);font-weight:600;font-variant-numeric:tabular-nums}
.iv-dress-code{font-weight:600}.iv-swatches{display:flex;justify-content:center;gap:8px;margin-top:8px!important}
.iv-sw{width:24px;height:24px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(0,0,0,.15),0 1px 3px rgba(0,0,0,.15)}
.iv-actions{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin:12px 0 0!important}
.iv-btn{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:8px 18px;border:1px solid var(--acc);border-radius:999px;background:transparent;color:var(--acc);font:600 .9em/1.2 var(--body);text-decoration:none;cursor:pointer;transition:background .2s,color .2s}
.iv-btn:hover{background:var(--soft)}.iv-btn.iv-primary{background:var(--acc);color:var(--paper)}.iv-btn.iv-primary:hover{background:color-mix(in srgb,var(--acc) 85%,var(--ink))}
.iv-btn:focus-visible,.iv-lang:focus-visible,.iv-env:focus-visible,.iv-f input:focus-visible,.iv-f textarea:focus-visible,.iv-f select:focus-visible,.iv-reply-text:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
.iv-sec a{color:var(--acc)}
.iv-form{margin:14px auto 0;max-width:440px;text-align:start}.iv-opts{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin:0;padding:0;border:0}
.iv-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.iv-opt{position:relative;cursor:pointer}.iv-opt input{position:absolute;opacity:0;width:1px;height:1px}
.iv-opt span{display:block;padding:9px 16px;border:1px solid color-mix(in srgb,var(--acc) 55%,transparent);border-radius:999px;font-weight:600;font-size:.92em;transition:background .2s,color .2s}
.iv-opt input:checked+span{background:var(--acc);color:var(--paper);border-color:var(--acc)}.iv-opt input:focus-visible+span{outline:2px solid var(--acc);outline-offset:2px}
.iv-fields{display:flex;flex-direction:column;gap:10px;margin-top:14px}.iv-f{display:flex;flex-direction:column;gap:4px;font-size:.88em;color:var(--muted)}.iv-f[hidden]{display:none}
.iv-f small{font-weight:400;opacity:.8}
.iv-f input,.iv-f textarea,.iv-f select{width:100%;padding:9px 12px;border:1px solid color-mix(in srgb,var(--acc) 30%,transparent);border-radius:10px;background:var(--soft);color:var(--ink);font:1em/1.4 var(--body)}
.iv-f textarea{resize:vertical}.iv-live{margin:10px 0 0;font-size:.88em;color:var(--acc);font-weight:600}.iv-sent{margin:16px auto 0;max-width:440px;padding:14px;border-radius:12px;background:var(--soft);text-align:center}.iv-sent b{display:block;color:var(--acc);font-size:1.1em}
.iv-err{margin:8px 0 0;color:#b42318;font-size:.9em;text-align:center}.iv-err:empty{display:none}
.iv-reply{margin:18px auto 0;max-width:460px;text-align:start}.iv-hint{font-size:.85em;color:var(--muted);text-align:center}
.iv-reply-text{margin:8px 0 0;padding:12px 14px;border-radius:10px;background:var(--soft);white-space:pre-wrap;overflow-wrap:anywhere;font:.85em/1.5 ui-monospace,Consolas,monospace;color:var(--ink)}
.iv-qr{margin:16px auto 0;text-align:center}.iv-qr-img{width:190px;height:190px;margin:0 auto;padding:8px;background:#fff;border-radius:10px}
.iv-qr figcaption{margin-top:6px;font-size:.8em;color:var(--muted)}
.iv-langs{display:flex;flex-wrap:wrap;justify-content:center;gap:4px;margin-top:30px}
.iv-lang{padding:4px 10px;border:0;border-radius:999px;background:transparent;color:var(--muted);font:600 .8em/1.4 var(--body);cursor:pointer}.iv-lang.iv-on{background:var(--soft);color:var(--acc)}
.iv-in{animation:iv-in .8s cubic-bezier(.2,.8,.2,1) both}@keyframes iv-in{from{opacity:0;transform:translateY(24px) scale(.98)}to{opacity:1;transform:none}}
.iv-env-stage{display:flex;flex-direction:column;align-items:center;gap:14px;padding-top:min(12vh,90px);text-align:center;transition:opacity .5s}
.iv-env{position:relative;width:min(84vw,440px);aspect-ratio:3/2;perspective:1200px;cursor:pointer;border-radius:8px}
.iv-env>div{position:absolute}
.iv-env-back{inset:0;border-radius:8px;background:color-mix(in srgb,var(--env) 82%,#000)}
.iv-env-letter{left:6%;right:6%;top:6%;height:84%;z-index:2;border-radius:4px;background:var(--paper);box-shadow:0 2px 10px rgba(0,0,0,.18);transition:transform .9s cubic-bezier(.2,.8,.2,1) .55s;display:flex;justify-content:center;padding-top:6%}
.iv-env-mini{display:block;width:46%;color:var(--acc)}
.iv-env-front{inset:0;z-index:3;border-radius:8px;background:var(--env);clip-path:polygon(0 0,50% 54%,100% 0,100% 100%,0 100%);box-shadow:inset 0 -18px 30px -16px rgba(0,0,0,.25)}
.iv-env-flap{left:0;right:0;top:0;height:60%;z-index:4;background:color-mix(in srgb,var(--env) 88%,#000);clip-path:polygon(0 0,100% 0,50% 100%);transform-origin:top;transition:transform .6s ease,z-index 0s .3s;filter:drop-shadow(0 3px 6px rgba(0,0,0,.25))}
.iv-env-seal{left:50%;top:57%;z-index:5;width:58px;height:58px;transform:translate(-50%,-50%);border-radius:47% 53% 44% 56%/54% 46% 54% 46%;background:var(--seal) radial-gradient(58% 54% at 33% 27%,rgba(255,255,255,.45),rgba(255,255,255,.05) 46%,rgba(0,0,0,.3) 100%);color:var(--seal-ink);display:flex;align-items:center;justify-content:center;font:700 17px/1 ${FONTS.classic};box-shadow:inset 0 2px 6px rgba(255,255,255,.4),inset 0 -5px 10px rgba(0,0,0,.35),0 5px 12px rgba(0,0,0,.35);transition:transform .35s,opacity .35s}
.iv-env-seal span{text-shadow:0 1px 0 rgba(0,0,0,.35)}
.iv-env-to{margin:4px 0 0;font:1.3em/1.3 var(--head);color:var(--ink)}
${darkPage(D) ? '.iv-wrap>.iv-env-stage .iv-env-to{color:#f6efe2}\n' : ''}.iv-opening .iv-env-seal{transform:translate(-50%,-50%) scale(.3) rotate(35deg);opacity:0}
.iv-opening .iv-env-flap{transform:rotateX(178deg);z-index:1}
.iv-opening .iv-env-letter{transform:translateY(-46%)}
.iv-gone{opacity:0}
.iv-still *{transition:none!important;animation:none!important}
@media (prefers-reduced-motion:reduce){.iv-root *{transition:none!important;animation:none!important}}
@media (max-width:480px){.iv-pg li{grid-template-columns:3.6em 1fr}.iv-title{font-size:2.1em}}
@media print{.iv-root{background:none}.iv-env-stage,.iv-form,.iv-reply,.iv-langs,.iv-actions{display:none!important}.iv-card{box-shadow:none;width:100%}}
`;
}
// Light text on the envelope stage needs a dark page; the light themes keep ink.
// Declared after inviteCSS but safe: inviteCSS only calls it at runtime, after the module has fully evaluated.
export const darkPage = (D) => ['midnight', 'saperavi', 'emerald'].includes(D.design?.theme);

// The whole exported document: the card prerendered for pages without scripts, the data and the runtime module.
// Script-context escaping: in the JSON, every '<' becomes < (still valid JSON, the same string after parsing),
// so a title containing "</script>" cannot close the data block; in the JS code, "</script" becomes "<\/script",
// equivalent inside string and regex literals, where it can only occur.
// robots noindex: invitations hold names, dates and addresses; they should not appear in search results.
// net: invite-net.js, added only when the invitation has an RSVP server (D.endpoint + D.event); otherwise the page
// has no network code at all.
export function pageHTML(D, runtime, net = '') {
  const main = D.langs[0];
  const title = txt(D.title, main, main) || 'Invitation';
  const json = JSON.stringify(D).replace(/</g, '\\u003c');
  const code = String(runtime || '').replace(/<\/(script)/gi, '<\\/$1');
  const icon = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${theme(D.design?.theme).accent}"/><path fill="#fff" d="M6 10h20v13H6zM6 10l10 8 10-8" stroke="${theme(D.design?.theme).accent}" stroke-width="1.5"/></svg>`);
  return `<!doctype html>
<html lang="${main}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<link rel="icon" href="${icon}">
<style>${inviteCSS(D)}</style>
</head>
<body class="iv-root${D.design?.motion === false ? ' iv-still' : ''}">
<main class="iv-wrap" id="iv-app"><noscript>${cardHTML(D, main, { noscript: true })}</noscript></main>
<script id="iv-data" type="application/json">${json}</script>
${net && D.endpoint && D.event ? `<script type="module">${String(net).replace(/<\/(script)/gi, '<\\/$1')}</script>\n` : ''}${code ? `<script type="module">${code}</script>` : ''}
</body>
</html>
`;
}
