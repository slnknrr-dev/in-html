// event-invite/common.js - shared parts of the designer and guests pages: the shell (pages from the hidden anchors of
// the page HTML, so the build can rewrite them), app icons, the event state in localStorage (one record for both
// pages, normalised on every load and on project import), the scenarios of the event types (texts from strings.js
// in every content language, programme, theme, dress code, reply options), the invitation data handed to invite.js,
// the exported HTML (with the runtime bundle), the .ics file, guest links and small widgets.
//
// Design rules of this module:
// - One state record (S) under one localStorage key, shared by both pages. Every read goes through normalizeEvent():
//   storage and imported project files are untrusted input (old versions, hand edits, other apps), so each field is
//   type-checked, clamped and length-capped. Pages may then use S without defensive checks.
// - Texts are per content language ({ en: '...', ka: '...' }), independent of the UI language: a Georgian host may
//   use an English UI and send a Georgian + English invitation. tl() reads strings in a given language; t() is UI only.
// - Scenario texts are "owned" until edited: fillLanguage() only fills a new language when the first language still
//   holds the scenario's own text, so user edits are never overwritten by translations of a text they replaced.
// - Network is optional and build-dependent (net.js vs net.offline.js): ONLINE gates every server feature.
//
// Side-effect import first: strings.js registers the app's i18n keys before any t() / tl() below runs.
import './strings.js';
import { button, startApp, t, toast } from '../ui/app.js';
import { pickFiles } from '../ui/files.js';
import { $, h, lsGet, lsSet } from '../ui/dom.js';
import { addIcons } from '../ui/icons.js';
import { ED_I18N, detectUILang } from '../ui/i18n.js';
import { eventType } from '../calendar/event.js';
import { addDays, isoDow, parseDay } from '../calendar/date.js';
import { normalizeTags } from '../calendar/guests.js';
import { DRESS_CODES, FONT_KEYS, LANGS, ORNAMENTS, THEME_KEYS, encodeGuest, icsText, localDay, pageHTML, txt } from './invite.js';
import { netCode, runtimeCode } from './bundles.js';
import { ONLINE } from './net.js';

// SVG path data (24x24 stroke icons) registered once; strings, not files: zero requests, inlined by the bundler.
export const LOGO = 'M3 7h18v13H3zM3 7l9 7 9-7M8 3.5h8M12 3.5V7';

addIcons({
  invite: LOGO,
  envelope: 'M3 6h18v12H3zM3 6l9 7 9-7',
  guests: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a7 7 0 0 1 14 0v1M16 3.5a4 4 0 0 1 0 7.5M18 14a6 6 0 0 1 4 6v1',
  play: 'M7 4l13 8-13 8z',
  cards: 'M4 5h11v15H4zM8 5V3h12v15h-5',
  reply: 'M10 9V5l-7 7 7 7v-4c5 0 8 1.5 11 5-1-5-4-10-11-11z',
  json: 'M8 4c-2 0-3 1-3 3v2c0 1-1 2-2 2 1 0 2 1 2 2v2c0 2 1 3 3 3M16 4c2 0 3 1 3 3v2c0 1 1 2 2 2-1 0-2 1-2 2v2c0 2-1 3-3 3',
  mapPin: 'M12 22s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
});

// Resolved hrefs of the pages (hidden anchors in the page HTML; the build rewrites their href).
// getAttribute, not a.href: .href is absolute (file:///...), breaking relative links once published.
export function pageHref(id) {
  const a = document.getElementById(id);
  return a ? a.getAttribute('href') : '#';
}

// Same shell config on both pages, so header and nav are identical. offline:true shows the "works offline" badge;
// in online builds the server features are opt-in, so the page still works with no network.
export function startShell(current, onLang) {
  startApp({
    key: 'ei', name: 'ei.name', logo: LOGO, offline: true, onLang,
    pages: [
      { href: pageHref('pg-design'), label: 'ei.page.design', current: current === 'design' },
      { href: pageHref('pg-guests'), label: 'ei.page.guests', current: current === 'guests' },
    ],
  });
}

// A UI string in a given language (the content languages of the invitation, not the UI language).
// Fallback chain: language -> English -> ''. Plural objects ({ one, other }) collapse to `other`: invitation texts
// are not counted. Unknown {vars} are left as-is, so a missing variable is visible instead of becoming "undefined".
export function tl(lang, key, vars) {
  let s = ED_I18N[lang]?.[key] ?? ED_I18N.en[key];
  if (s == null) return '';
  if (typeof s === 'object') s = s.other ?? Object.values(s)[0] ?? '';
  return vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : String(s);
}

// Random id from a 32-letter alphabet without look-alikes (no l, o, 0, 1): ids appear in guest links that people
// may read aloud or retype. b % 32 is unbiased because 256 is a multiple of 32. crypto, not Math.random: guest ids
// act as unguessable capability tokens in reply links.
export const uid = (n = 10) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join(''); };

// --- scenarios -------------------------------------------------------------------------------------------------

// Event types of the designer: the calendar/event.js type (icon, category) plus the app's own Georgian supra, which
// the calendar catalogue does not have. Programme items are [time, key of 'ei.pg.*'].
// Each scenario: base = calendar type, theme/ornament/font = design defaults, envelope = opening animation,
// plus = allowed plus-ones, maybe = offer a "maybe" reply, menu = ask for menu choice, time/end = default hours.
export const SCENARIOS = {
  wedding: { base: 'wedding', icon: '💍', theme: 'ivory', ornament: 'floral', font: 'script', envelope: true, dress: 'formal', time: '16:00', end: '23:30', plus: 1, maybe: false, menu: true,
    programme: [['15:30', 'welcome'], ['16:00', 'ceremony'], ['17:00', 'photo'], ['18:00', 'dinner'], ['20:00', 'dance'], ['22:30', 'cake']] },
  birthday: { base: 'birthday', icon: '🎂', theme: 'lavender', ornament: 'confetti', font: 'serif', envelope: true, dress: 'cocktail', time: '19:00', end: '23:00', plus: 1, maybe: true, menu: false,
    programme: [['19:00', 'welcome'], ['19:30', 'dinner'], ['21:00', 'cake'], ['21:30', 'dance']] },
  'kids-party': { base: 'kids-party', icon: '🧸', theme: 'sunny', ornament: 'confetti', font: 'sans', envelope: true, dress: 'casual', time: '12:00', end: '15:00', plus: 1, maybe: true, menu: false,
    programme: [['12:00', 'welcome'], ['12:30', 'games'], ['13:30', 'cake'], ['14:30', 'farewell']] },
  anniversary: { base: 'anniversary', icon: '🥂', theme: 'midnight', ornament: 'deco', font: 'classic', envelope: true, dress: 'formal', time: '18:00', end: '23:00', plus: 1, maybe: false, menu: true,
    programme: [['18:00', 'welcome'], ['18:30', 'dinner'], ['20:00', 'toasts'], ['21:00', 'dance']] },
  supra: { base: 'dinner', icon: '🍷', theme: 'saperavi', ornament: 'vine', font: 'classic', envelope: true, dress: 'national', time: '19:00', end: '', plus: 2, maybe: true, menu: false,
    programme: [['19:00', 'welcome'], ['19:30', 'toasts'], ['21:00', 'polyphony'], ['22:00', 'dance']] },
  party: { base: 'party', icon: '🎉', theme: 'emerald', ornament: 'stars', font: 'sans', envelope: true, dress: 'cocktail', time: '20:00', end: '', plus: 1, maybe: true, menu: false,
    programme: [['20:00', 'welcome'], ['21:00', 'music'], ['23:00', 'dance']] },
  corporate: { base: 'corporate', icon: '🏢', theme: 'mono', ornament: 'deco', font: 'sans', envelope: false, dress: 'smart', time: '18:30', end: '23:00', plus: 0, maybe: true, menu: true,
    programme: [['18:30', 'welcome'], ['19:00', 'awards'], ['20:00', 'dinner'], ['21:30', 'music']] },
  conference: { base: 'conference', icon: '🎤', theme: 'sage', ornament: 'none', font: 'sans', envelope: false, dress: 'smart', time: '09:00', end: '18:00', plus: 0, maybe: true, menu: false,
    programme: [['09:00', 'registration'], ['10:00', 'keynote'], ['11:00', 'talks'], ['13:00', 'lunch'], ['14:00', 'talks'], ['17:30', 'networking']] },
};
export const SCENARIO_KEYS = Object.keys(SCENARIOS);
export const scenarioIcon = (k) => (SCENARIOS[k] ? SCENARIOS[k].icon : eventType(k).icon);

// A Saturday about two months ahead of today (isoDow: Monday = 0, so 5 = Saturday). Day strings + calendar/date.js,
// not Date objects: no time-zone drift when the day is serialised and read back.
function defaultDay() {
  let d = addDays(localDay(), 60);
  while (isoDow(d) !== 5) d = addDays(d, 1);
  return d;
}
// Intl may be missing or throw in stripped-down runtimes; '' means "floating local time" in the .ics output.
const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } };
// Content language defaults to the UI language when the invitation supports it, else English.
const firstLang = () => ((() => { const l = detectUILang(); return LANGS.includes(l) ? l : 'en'; })());

// The full shape of the state. normalizeEvent() starts from this, so every field always exists (no optional chaining
// needed in the pages). v:1 is the schema version for future migrations.
export function blankEvent() {
  const l = firstLang();
  return {
    v: 1, uid: uid(), updated: '', type: 'wedding', langs: [l],
    title: {}, hosts: {}, message: {},
    day: defaultDay(), time: '16:00', endDay: '', endTime: '', tz: zone(),
    venue: { name: {}, address: {} }, geo: { lat: '', lon: '' },
    programme: [],
    dress: { code: 'formal', note: {}, colors: [] },
    rsvp: { email: '', phone: '', deadline: '', maybe: true, plus: 1, menu: {}, note: {} },
    design: { theme: 'ivory', ornament: 'floral', font: 'script', envelope: true, seal: '', motion: true },
    capacity: 0, link: '', file: 'invitation.html',
    server: { url: '', token: '', event: '', live: false },
    guests: [],
  };
}

// Applies a scenario: texts in every content language, programme, design, dress code and reply options. The date,
// the place, the languages, the contacts and the guests stay.
// Replaces texts unconditionally: switching scenario is an explicit "start over from this template" action.
// Default geo (Tbilisi) only when none is set, so a map preview works out of the box.
// The deadline is reset when missing or after the event: 21 days before is a common RSVP lead time.
export function applyScenario(S, key) {
  const sc = SCENARIOS[key] || SCENARIOS.wedding;
  S.type = key;
  for (const f of ['title', 'hosts', 'message']) { S[f] = {}; for (const l of S.langs) S[f][l] = tl(l, `ei.sc.${key}.${f}`); }
  S.venue = { name: {}, address: {} };
  for (const l of S.langs) { S.venue.name[l] = tl(l, `ei.sc.${key}.venue`); S.venue.address[l] = tl(l, 'ei.sc.address'); }
  if (!S.geo.lat && !S.geo.lon) S.geo = { lat: '41.6941', lon: '44.8008' };
  S.time = sc.time; S.endTime = sc.end; S.endDay = '';
  S.programme = sc.programme.map(([at, k]) => ({ id: uid(6), day: '', at, k, title: Object.fromEntries(S.langs.map((l) => [l, tl(l, 'ei.pg.' + k)])) }));
  S.design = { ...S.design, theme: sc.theme, ornament: sc.ornament, font: sc.font, envelope: sc.envelope, seal: '' };
  S.dress = { code: sc.dress, note: {}, colors: [] };
  if (key === 'wedding') S.dress.colors = ['#e9dcc4', '#c8a97e', '#7d8f69'];
  S.rsvp.maybe = sc.maybe; S.rsvp.plus = sc.plus;
  S.rsvp.menu = sc.menu ? Object.fromEntries(S.langs.map((l) => [l, tl(l, 'ei.sc.menu')])) : {};
  S.rsvp.note = {};
  if (!parseDay(S.rsvp.deadline) || S.rsvp.deadline > S.day) S.rsvp.deadline = parseDay(S.day) ? addDays(S.day, -21) : '';
}

// Fills the empty texts of a language that was just added from the scenario (only what came from it).
// Criterion: the first language's text still equals the scenario text, i.e. the user did not write their own.
// A custom text has no translation source, so the new language stays empty (the UI shows it as missing).
export function fillLanguage(S, l) {
  const key = S.type;
  for (const f of ['title', 'hosts', 'message']) if (!S[f][l] && txt(S[f], S.langs[0]) === tl(S.langs[0], `ei.sc.${key}.${f}`)) S[f][l] = tl(l, `ei.sc.${key}.${f}`);
  for (const p of S.programme) if (p.k && !p.title[l]) p.title[l] = tl(l, 'ei.pg.' + p.k);
  if (!S.venue.address[l] && txt(S.venue.address, S.langs[0]) === tl(S.langs[0], 'ei.sc.address')) S.venue.address[l] = tl(l, 'ei.sc.address');
  if (!S.venue.name[l] && txt(S.venue.name, S.langs[0]) === tl(S.langs[0], `ei.sc.${key}.venue`)) S.venue.name[l] = tl(l, `ei.sc.${key}.venue`);
  if (Object.keys(S.rsvp.menu).length && !S.rsvp.menu[l] && txt(S.rsvp.menu, S.langs[0]) === tl(S.langs[0], 'ei.sc.menu')) S.rsvp.menu[l] = tl(l, 'ei.sc.menu');
}

// --- state ---------------------------------------------------------------------------------------------------------

// Validators of normalizeEvent(). Each returns a safe default instead of throwing: one bad field must not cost the
// user the whole saved event. Length caps keep localStorage (about 5 MB per origin) and exported pages bounded.
const SKEY = 'ei-event';
const str = (v, n = 2000) => (typeof v === 'string' ? v.slice(0, n) : '');
const langMap = (v, n = 2000) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([k, x]) => LANGS.includes(k) && typeof x === 'string').map(([k, x]) => [k, x.slice(0, n)])) : {});
const oneOf = (v, list, d) => (list.includes(v) ? v : d);
const int = (v, a, b, d) => { const n = Math.floor(+v); return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : d; };
const time = (v) => (/^\d{2}:\d{2}$/.test(String(v)) ? String(v) : '');
// All three are required: the token authenticates the host; publishing without it would fail on every request.
export const serverReady = (S) => ONLINE && !!(S.server.url && S.server.event && S.server.token);
// maybeNo = "probably not"; waitlist = over capacity. Order = display order of polls and filters.
export const RESPONSES = ['yes', 'maybe', 'maybeNo', 'no', 'waitlist'];

// rsvp is null when there is no valid response; src records where the reply came from (manual, a pasted reply, the
// server), sid = server reply id used to deduplicate pulls. Ids are reduced to [\w-] because they go into URLs.
export function normalizeGuest(g) {
  const o = g && typeof g === 'object' ? g : {};
  const r = o.rsvp && typeof o.rsvp === 'object' && RESPONSES.includes(o.rsvp.response) ? { response: o.rsvp.response, guests: int(o.rsvp.guests, 0, 20, 0), menu: str(o.rsvp.menu, 80) } : null;
  return {
    id: str(o.id, 24).replace(/[^\w-]/g, '') || uid(8), name: str(o.name, 120), names: langMap(o.names, 120), email: str(o.email, 200).trim(),
    phone: str(o.phone, 40), group: str(o.group, 60), tags: normalizeTags(o.tags), plus: int(o.plus, 0, 9, 0), lang: LANGS.includes(o.lang) ? o.lang : '',
    rsvp: r ? { ...r, src: oneOf(o.rsvp.src, ['manual', 'reply', 'server'], 'manual'), sid: str(o.rsvp.sid, 40), diet: str(o.rsvp.diet, 200) } : null, seat: str(o.seat, 40), note: str(o.note, 400),
  };
}

// Defensive copy of untrusted data into the canonical shape. Caps: 60 programme items, 5 colours, 5000 guests.
// `day: ''` is preserved (user cleared the date on purpose); any other invalid day falls back to the default.
// server.url must be http(s): a javascript: or data: URL would otherwise reach fetch() and exported pages.
export function normalizeEvent(raw) {
  const d = blankEvent();
  const o = raw && typeof raw === 'object' ? raw : {};
  const langs = Array.isArray(o.langs) ? [...new Set(o.langs.filter((l) => LANGS.includes(l)))] : [];
  const S = {
    ...d,
    uid: str(o.uid, 40).replace(/[^\w-]/g, '') || d.uid, updated: str(o.updated, 40),
    type: SCENARIOS[o.type] ? o.type : d.type, langs: langs.length ? langs : d.langs,
    title: langMap(o.title, 200), hosts: langMap(o.hosts, 200), message: langMap(o.message, 1500),
    day: parseDay(o.day) || (o.day === '' ? '' : d.day), time: time(o.time), endDay: parseDay(o.endDay), endTime: time(o.endTime), tz: str(o.tz, 60),
    venue: { name: langMap(o.venue?.name, 200), address: langMap(o.venue?.address, 400) },
    geo: { lat: str(String(o.geo?.lat ?? ''), 20), lon: str(String(o.geo?.lon ?? ''), 20) },
    programme: (Array.isArray(o.programme) ? o.programme : []).slice(0, 60).filter((p) => p && typeof p === 'object')
      .map((p) => ({ id: str(p.id, 12) || uid(6), day: parseDay(p.day), at: time(p.at), k: str(p.k, 30), title: langMap(p.title, 200) })),
    dress: { code: oneOf(o.dress?.code, DRESS_CODES, 'none'), note: langMap(o.dress?.note, 400), colors: (Array.isArray(o.dress?.colors) ? o.dress.colors : []).filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 5) },
    rsvp: {
      email: str(o.rsvp?.email, 200).trim(), phone: str(o.rsvp?.phone, 40), deadline: parseDay(o.rsvp?.deadline), maybe: o.rsvp?.maybe !== false,
      plus: int(o.rsvp?.plus, 0, 9, 1), menu: langMap(o.rsvp?.menu, 300), note: langMap(o.rsvp?.note, 400),
    },
    design: {
      theme: oneOf(o.design?.theme, THEME_KEYS, 'ivory'), ornament: oneOf(o.design?.ornament, ORNAMENTS, 'floral'), font: oneOf(o.design?.font, FONT_KEYS, 'serif'),
      envelope: o.design?.envelope !== false, seal: str(o.design?.seal, 4), motion: o.design?.motion !== false,
    },
    capacity: int(o.capacity, 0, 100000, 0), link: str(o.link, 500).trim(), file: str(o.file, 80) || d.file,
    server: { url: /^https?:\/\/\S+$/.test(str(o.server?.url, 500).trim()) ? str(o.server.url, 500).trim().replace(/\/+$/, '') : '', token: str(o.server?.token, 200).trim(), event: str(o.server?.event, 40).replace(/[^\w-]/g, ''), live: o.server?.live === true },
    guests: (Array.isArray(o.guests) ? o.guests : []).slice(0, 5000).map(normalizeGuest),
  };
  return S;
}

// First visit: a wedding pre-filled, so the preview shows a complete invitation instead of an empty card.
export function loadEvent() {
  const saved = lsGet(SKEY, null);
  if (saved && typeof saved === 'object') return normalizeEvent(saved);
  const S = blankEvent();
  applyScenario(S, 'wedding');
  return S;
}
// updated: ISO without milliseconds; also stamped into exported pages so a guest's reply can be matched to a version.
export function saveEvent(S) {
  S.updated = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  lsSet(SKEY, S);
}
// The other page saved: reload from storage (both pages may be open in tabs). The storage event fires only in
// other tabs, never in the one that wrote, so there is no echo loop.
export function onStorage(fn) { window.addEventListener('storage', (e) => { if (e.key === SKEY) fn(); }); }

// --- invitation data, export ---------------------------------------------------------------------------------------

// Strings the exported page needs (ei.inv.*) in its languages. English always included as the fallback; only the
// ei.inv.* subset is embedded to keep each exported file small.
function inviteStrings(langs) {
  const out = {};
  for (const l of new Set([...langs, 'en'])) {
    const src = { ...ED_I18N.en, ...(ED_I18N[l] || {}) };
    out[l] = Object.fromEntries(Object.entries(src).filter(([k]) => k.startsWith('ei.inv.')));
  }
  return out;
}

// Only what the page renders is copied: guest list, tokens and server credentials never leave the designer.
// State -> the data D of invite.js. o: { guest (state guest), preview: { open, lang } }.
export function inviteData(S, { guest = null, preview = null } = {}) {
  const D = {
    v: 1, uid: S.uid, stamp: S.updated || '', type: S.type, langs: S.langs,
    title: S.title, hosts: S.hosts, message: S.message, day: S.day, time: S.time, endDay: S.endDay, endTime: S.endTime, tz: S.tz,
    venue: S.venue, geo: S.geo, programme: S.programme.map((p) => ({ day: p.day, at: p.at, title: p.title })),
    dress: S.dress, rsvp: S.rsvp, design: S.design, link: S.link, strings: inviteStrings(S.langs), guest: guest ? guestToken(guest) : null, preview,
  };
  // The RSVP server (never in the designer preview, never in offline builds). The token stays out on purpose: the page
  // is public, guests post replies to an endpoint that needs no secret.
  if (ONLINE && !preview && S.server.url && S.server.event) { D.endpoint = S.server.url; D.event = S.server.event; D.live = S.server.live; }
  return D;
}
// Compact guest token for links (#guest=...): short keys keep URLs short. Per-language names only when more than one.
export const guestToken = (g) => ({ i: g.id, n: Object.keys(g.names || {}).length > 1 ? g.names : g.name, p: g.plus, l: g.lang || '' });

// netCode is fetched only when the page will talk to a server, so offline-reply exports carry no network code.
export async function inviteHTML(S, o = {}) {
  const D = inviteData(S, o);
  return pageHTML(D, await runtimeCode(), D.endpoint ? await netCode() : '');
}
export const eventICS = (S, lang) => icsText(inviteData(S), lang || S.langs[0]);

// Safe file name part: drops characters forbidden on Windows / macOS and control characters, collapses whitespace
// to dashes. Non-Latin scripts are kept: a Georgian title should give a Georgian file name.
export const fileSafe = (s, d = 'invitation') => String(s || '').normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || d;
export const eventFile = (S, ext) => fileSafe(txt(S.title, S.langs[0])) + ext;

// The personalised link of a guest: the invitation address (or the file name) + #guest=token.
// A fragment, not a query: never sent to the server hosting the invitation, so guest identities stay off its logs.
export function guestLink(S, g) {
  const base = (S.link || S.file || 'invitation.html').replace(/#.*$/, '');
  return base + '#guest=' + encodeGuest(guestToken(g));
}

// --- widgets ---------------------------------------------------------------------------------------------------

// The font of the PDFs (bytes of a TTF / OTF the user picked; kept for the page session only). Not persisted: font
// files are large and localStorage is small; a module-level object is shared by every picker instance.
export const PDF_FONT = { name: '', bytes: null };
export function fontPicker() {
  const name = h('span', { class: 'ed-hint ei-font-name' }, PDF_FONT.name ? t('ei.x.fontSet', { name: PDF_FONT.name }) : t('ei.x.fontNone'));
  const pick = button('ei.x.font', 'font', async () => {
    const [file] = await pickFiles({ accept: '.ttf,.otf,font/ttf,font/otf' });
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Magic check: 00 01 00 00 = TrueType, 'true' = Apple TrueType.
    // KNOWN DEFECT: CFF-flavoured OpenType ('OTTO') is rejected although `accept` offers .otf. If the PDF writer only
    // embeds glyf outlines this is intended. Fix: drop .otf from accept, or accept 'OTTO' when the writer supports CFF.
    const tag = String.fromCharCode(...bytes.slice(0, 4));
    if (!(bytes[0] === 0 && bytes[1] === 1) && tag !== 'true') { toast(t('ei.x.fontBad'), 'warn'); return; }
    PDF_FONT.name = file.name; PDF_FONT.bytes = bytes;
    // KNOWN DEFECT: $ is querySelector (one element or null, ui/dom.js), not iterable; this for..of throws a TypeError
    // after the font is stored, so the labels never update. Fix: iterate $$('.ei-font-name').
    for (const n of $('.ei-font-name')) n.textContent = t('ei.x.fontSet', { name: file.name });
  });
  pick.classList.add('ed-sm');
  return h('div', { class: 'ei-font' }, h('div', { class: 'ap-row' }, pick, name), h('p', { class: 'ed-hint' }, t('ei.x.fontHint')));
}


// Module counter for unique ids; fine because ids only need to be unique within one page.
let gid = 0;
// Labelled group for non-input controls: the label names the group through aria-labelledby.
export function group(label, control, hint) {
  const id = 'ei-g' + (++gid);
  control.setAttribute('aria-labelledby', id);
  return h('div', { class: 'ed-field' }, h('span', { class: 'ed-label', id }, t(label)), control, hint ? h('div', { class: 'ed-hint' }, t(hint)) : null);
}
