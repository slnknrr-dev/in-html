// calendar/event.js - the language of events: the free "when" field ('2026-08-14', '2026-08-14 16:00') parsed by
// hand (new Date on a partial string shifts the day across zones), dates in words in English, Russian (genitive
// months) and Georgian with an Intl fallback for other languages, poster badges, "when" buckets and filters by
// calendar days (today / tomorrow / weekend / week / later / past, never overlapping), fullness against a capacity,
// time-based phases of an invitation (before N days / after N days / default, the latest reached wins), a multi-day
// schedule laid out by days with gaps, and the catalogue of event types and categories.
import { addDays, dayDiff, isoDow, parseDay, splitDateTime } from './date.js';

// '2026-08-14', '2026-08-14T16:00', '2026-08-14 16:00' -> { date, time ('' or 'HH:MM'), y, m, d } or null.
export function parseWhen(raw) {
  const p = splitDateTime(raw);
  return p ? { date: p.day, time: p.time.slice(0, 5), y: p.y, m: p.m, d: p.d } : null;
}
export const whenDay = (raw) => (parseWhen(raw) || {}).date || '';

// --- dates in words ----------------------------------------------------------------------------------------------

// Month names: [genitive / format form, stand-alone form, short]; weekdays Monday first: [long, short].
// Own tables for en / ru / ka instead of Intl: the Russian genitive ("3 октября") and Georgian forms must be exact
// on every engine, and trimmed-ICU builds lack 'ka' (see i18n/intl.js). Intl serves only the other languages.
export const MONTHS = {
  en: [['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'], null,
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']],
  ru: [['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
    ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'],
    ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']],
  ka: [['იანვარი', 'თებერვალი', 'მარტი', 'აპრილი', 'მაისი', 'ივნისი', 'ივლისი', 'აგვისტო', 'სექტემბერი', 'ოქტომბერი', 'ნოემბერი', 'დეკემბერი'], null,
    ['იან', 'თებ', 'მარ', 'აპრ', 'მაი', 'ივნ', 'ივლ', 'აგვ', 'სექ', 'ოქტ', 'ნოე', 'დეკ']],
};
export const WEEKDAYS = {
  en: [['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']],
  ru: [['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'], ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']],
  ka: [['ორშაბათი', 'სამშაბათი', 'ოთხშაბათი', 'ხუთშაბათი', 'პარასკევი', 'შაბათი', 'კვირა'], ['ორშ', 'სამ', 'ოთხ', 'ხუთ', 'პარ', 'შაბ', 'კვი']],
};
const base = (lang) => String(lang || 'en').toLowerCase().split(/[-_]/)[0];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export const monthName = (m, lang = 'en', form = 'format') => {
  const t = MONTHS[base(lang)] || MONTHS.en;
  return form === 'short' ? t[2][m - 1] : form === 'standalone' ? (t[1] || t[0])[m - 1] : t[0][m - 1];
};
export const weekdayName = (dow, lang = 'en', short = false) => (WEEKDAYS[base(lang)] || WEEKDAYS.en)[short ? 1 : 0][dow];

// Date in words, the year always printed (an invitation never changes its text on January 1):
// en 'October 3, 2026', ru '3 октября 2026', ka '3 ოქტომბერი, 2026'; other languages through Intl, an unknown
// locale falls back to the ISO day. Options: weekday (prefix the weekday name), time (append ', HH:MM' when set).
export function formatEventDate(raw, lang = 'en', { weekday = false, time = true } = {}) {
  const w = parseWhen(raw);
  if (!w) return '';
  const l = base(lang);
  let out;
  if (l === 'en') out = `${MONTHS.en[0][w.m - 1]} ${w.d}, ${w.y}`;
  else if (l === 'ru') out = `${w.d} ${MONTHS.ru[0][w.m - 1]} ${w.y}`;
  else if (l === 'ka') out = `${w.d} ${MONTHS.ka[0][w.m - 1]}, ${w.y}`;
  else {
    try { out = new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC', ...(weekday ? { weekday: 'long' } : {}) }).format(new Date(Date.UTC(w.y, w.m - 1, w.d))); } catch { out = w.date; }
  }
  if (weekday && WEEKDAYS[l]) out = cap(weekdayName(isoDow(w.date), l)) + ', ' + out;
  return time && w.time ? out + ', ' + w.time : out;
}

// Poster badge { d: '14', mo: 'Aug' }.
export function dayBadge(raw, lang = 'en') {
  const w = parseWhen(raw);
  return w ? { d: String(w.d), mo: monthName(w.m, lang, 'short') } : null;
}

// 'Today' / 'Tomorrow' / 'Yesterday' / 'in 3 days' / '3 days ago' (en / ru / ka), or '' beyond `within` days.
const RELATIVE = {
  en: ['Today', 'Tomorrow', 'Yesterday', (n) => `in ${n} days`, (n) => `${n} days ago`],
  ru: ['Сегодня', 'Завтра', 'Вчера', (n) => `через ${n} ${plural(n, 'день', 'дня', 'дней')}`, (n) => `${n} ${plural(n, 'день', 'дня', 'дней')} назад`],
  ka: ['დღეს', 'ხვალ', 'გუშინ', (n) => `${n} დღეში`, (n) => `${n} დღის წინ`],
};
// East Slavic plural rule: 1, 21, 31 ... (not 11) -> one; 2-4, 22-24 ... (not 12-14) -> few; the rest -> many.
function plural(n, one, few, many) { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many; }
export function relativeDay(day, today, lang = 'en', within = 7) {
  const d = dayDiff(day, today);
  if (!Number.isFinite(d) || Math.abs(d) > within) return '';
  const t = RELATIVE[base(lang)] || RELATIVE.en;
  return d === 0 ? t[0] : d === 1 ? t[1] : d === -1 ? t[2] : d > 0 ? t[3](d) : t[4](-d);
}

// --- "when" buckets and filters ----------------------------------------------------------------------------------

export const WHEN_MODES = ['any', 'today', 'tomorrow', 'weekend', 'week', 'month', 'past'];
export const BUCKETS = ['today', 'tomorrow', 'weekend', 'week', 'later', 'past', 'nodate'];

// Bucket of an event day relative to `today` (both 'YYYY-MM-DD'): weekend and week never overlap.
// Buckets partition the timeline (every day falls in exactly one), so a list grouped by bucket never shows an
// event twice; "weekend" only covers the coming 6 days, a weekend further out is "later".
export function eventBucket(day, today) {
  if (!day) return 'nodate';
  const d = dayDiff(day, today);
  if (!Number.isFinite(d)) return 'nodate';
  if (d < 0) return 'past';
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d <= 6) return isoDow(day) >= 5 ? 'weekend' : 'week';
  return 'later';
}

// Does a day pass the "when" filter? 'any' passes undated and past events; the day filters never pass undated ones.
export function passesWhen(day, when, today) {
  if (when === 'any' || !WHEN_MODES.includes(when)) return true;
  if (!day) return false;
  const d = dayDiff(day, today);
  if (!Number.isFinite(d)) return false;
  if (when === 'past') return d < 0;
  if (when === 'today') return d === 0;
  if (when === 'tomorrow') return d === 1;
  if (when === 'weekend') return d >= 0 && d <= 6 && isoDow(day) >= 5;
  if (when === 'week') return d >= 0 && d <= 6;
  return d >= 0 && d <= 31;
}

// Fullness against a capacity, or null when there is no capacity (an empty bar would read as "no seats").
export function fullness(going, capacity) {
  const max = Math.max(0, Math.min(100000, Math.floor(+capacity || 0)));
  if (!max) return null;
  const g = Math.max(0, Math.floor(+going || 0));
  const pct = Math.min(100, Math.round((g / max) * 100));
  return { cap: max, going: g, pct, left: Math.max(0, max - g), almost: pct >= 90 && g < max, full: g >= max };
}

// --- phases --------------------------------------------------------------------------------------------------------

// A phase is { at: { mode: 'default' | 'before' | 'after', days } , for? (an addressee token) }. Its point on the time
// axis: -Infinity (default), event start ∓ days, NaN when it needs a date the event lacks or is picked by addressee.
const DAY_MS = 86400000;
export const isAddressed = (p) => !!(p && (p.for || p.forParty));
export function phaseAt(p, startMs) {
  if (isAddressed(p)) return NaN;
  const at = (p && p.at) || {};
  const mode = String(at.mode || 'default');
  if (mode === 'default') return -Infinity;
  if (!Number.isFinite(startMs)) return NaN;
  const days = Math.max(0, Math.min(3650, +at.days || 0));
  return mode === 'after' ? startMs + days * DAY_MS : startMs - days * DAY_MS;
}
// The event start as wall-clock milliseconds (UTC arithmetic on the local time; midnight when there is no time).
// Deliberately not a real instant: both the event start and "now" are wall-clock values in the event's zone, so
// phase comparisons ignore time zones and DST entirely (an invitation switches phase at local midnight).
export function whenMs(raw) {
  const w = parseWhen(raw);
  if (!w) return NaN;
  const [h, m] = (w.time || '00:00').split(':').map(Number);
  return Date.UTC(w.y, w.m - 1, w.d, h, m);
}
// Phases in order of arrival (stable; the ones impossible without a date go last).
export function sortPhases(phases, startsAt) {
  const ms = whenMs(startsAt);
  return (phases || []).map((p, i) => ({ p, i, k: phaseAt(p, ms) }))
    .sort((a, b) => { const ak = Number.isNaN(a.k) ? Infinity : a.k, bk = Number.isNaN(b.k) ? Infinity : b.k; return ak === bk ? a.i - b.i : ak - bk; })
    .map((x) => x.p);
}
// The phase to show at `now` (wall-clock ms in the event's zone, as whenMs builds it): an addressee's own phase wins,
// else the latest reached, else the first on the axis. Returns { phase, index } or null.
// Ties (two phases at the same point) go to the later one in the list (k >= bestK), so an author can override a
// phase by adding another below it.
export function activePhase(phases, startsAt, now, who = '') {
  const list = (phases || []).filter(Boolean);
  if (!list.length) return null;
  if (who) { const own = list.find((p) => String(p.for || p.forParty || '') === String(who)); if (own) return { phase: own, index: phases.indexOf(own) }; }
  const ms = whenMs(startsAt);
  let best = null, bestK = -Infinity;
  for (const p of list) {
    const k = phaseAt(p, ms);
    if (Number.isNaN(k)) continue;
    if (k <= now && (best === null || k >= bestK)) { best = p; bestK = k; }
  }
  if (!best) { const plain = list.filter((p) => !isAddressed(p)); best = sortPhases(plain, startsAt)[0] || null; }
  return best ? { phase: best, index: phases.indexOf(best) } : null;
}

// --- multi-day schedule ------------------------------------------------------------------------------------------

// Items { day?, at? ('HH:MM'), title, … } -> groups [{ day ('' for undated, first), items (sorted by time),
// gapBefore (empty days before this one) }]. Days accept 'YYYY-MM-DD…' and 'DD.MM.YYYY'.
export function scheduleDays(items) {
  const undated = { day: '', items: [], gapBefore: 0 };
  const byDay = new Map();
  for (const it of (items || []).slice(0, 500)) {
    if (!it || typeof it !== 'object') continue;
    const day = parseDay(it.day);
    if (!day) { undated.items.push(it); continue; }
    if (!byDay.has(day)) byDay.set(day, { day, items: [], gapBefore: 0 });
    byDay.get(day).items.push(it);
  }
  const dated = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
  for (let i = 1; i < dated.length; i++) dated[i].gapBefore = Math.max(0, dayDiff(dated[i].day, dated[i - 1].day) - 1);
  for (const g of dated) g.items.sort((x, y) => String(x.at || '').localeCompare(String(y.at || '')));
  return (undated.items.length ? [undated] : []).concat(dated);
}

// Days an event occupies: its start day, the schedule days and extra days, unique and sorted.
export function eventDays(startsAt, items = [], extra = []) {
  const set = new Set();
  for (const v of [startsAt, ...items.map((x) => x && x.day), ...extra]) { const d = parseDay(v); if (d) set.add(d); }
  return [...set].sort();
}
// The days from start to end inclusive of a multi-day event.
export function spanDays(start, end) {
  const a = whenDay(start), b = whenDay(end) || a;
  if (!a) return [];
  const out = [];
  for (let d = a; d <= b && out.length < 366; d = addDays(d, 1)) out.push(d);
  return out;
}

// --- event types and categories ------------------------------------------------------------------------------------

const L = (en, ru, ka) => ({ en, ru, ka });
// [slug, names, icon]
export const EVENT_CATEGORIES = [
  ['family', L('Family', 'Семейное', 'ოჯახური'), '👨‍👩‍👧'], ['wedding', L('Weddings', 'Свадьбы', 'ქორწილები'), '💍'],
  ['party', L('Parties', 'Праздники', 'წვეულებები'), '🎉'], ['business', L('Business', 'Деловое', 'ბიზნესი'), '💼'],
  ['edu', L('Learning', 'Обучение', 'სწავლა'), '📚'], ['culture', L('Culture', 'Культура', 'კულტურა'), '🎭'],
  ['music', L('Music', 'Музыка', 'მუსიკა'), '🎵'], ['sport', L('Sport', 'Спорт', 'სპორტი'), '⚽'],
  ['food', L('Food & Wine', 'Еда и вино', 'საკვები და ღვინო'), '🍷'], ['kids', L('Kids', 'Детское', 'ბავშვები'), '🧸'],
  ['charity', L('Charity', 'Благотворительность', 'ქველმოქმედება'), '🤝'], ['memorial', L('Memorial', 'Памятное', 'ხსოვნა'), '🕯'],
].map(([slug, name, icon], ord) => ({ slug, name, icon, ord }));

// [slug, names, icon, default category, scenario]: the scenario says which blocks an invitation starts with
// (celebration: countdown and RSVP; memorial: no countdown, no games; online: a stream link).
export const EVENT_TYPES = [
  ['wedding', L('Wedding', 'Свадьба / венчание', 'ქორწილი'), '💍', 'wedding', 'wedding'],
  ['engagement', L('Engagement', 'Помолвка', 'დანიშვნა'), '💐', 'wedding', 'wedding'],
  ['anniversary', L('Anniversary', 'Годовщина', 'იუბილე'), '🥂', 'family', 'celebration'],
  ['birthday', L('Birthday', 'День рождения', 'დაბადების დღე'), '🎂', 'party', 'celebration'],
  ['kids-party', L('Kids party', 'Детский праздник', 'საბავშვო წვეულება'), '🧸', 'kids', 'celebration'],
  ['baby-shower', L('Baby shower', 'Ожидание малыша', 'ბეიბი შაუერი'), '🍼', 'family', 'celebration'],
  ['housewarming', L('Housewarming', 'Новоселье', 'ახალი სახლი'), '🏡', 'family', 'gathering'],
  ['graduation', L('Graduation', 'Выпускной', 'გამოსაშვები'), '🎓', 'edu', 'celebration'],
  ['party', L('Party', 'Вечеринка', 'წვეულება'), '🎉', 'party', 'gathering'],
  ['dinner', L('Dinner', 'Ужин / посиделки', 'ვახშამი'), '🍽', 'food', 'gathering'],
  ['corporate', L('Corporate party', 'Корпоратив', 'კორპორატივი'), '🏢', 'business', 'corporate'],
  ['conference', L('Conference', 'Конференция', 'კონფერენცია'), '🎤', 'business', 'conference'],
  ['meetup', L('Meetup', 'Встреча / митап', 'შეხვედრა'), '🤝', 'business', 'meetup'],
  ['webinar', L('Webinar', 'Вебинар / эфир', 'ვებინარი'), '💻', 'edu', 'online'],
  ['workshop', L('Workshop', 'Мастер-класс', 'მასტერკლასი'), '🛠', 'edu', 'workshop'],
  ['concert', L('Concert', 'Концерт', 'კონცერტი'), '🎶', 'music', 'show'],
  ['exhibition', L('Exhibition', 'Выставка', 'გამოფენა'), '🖼', 'culture', 'show'],
  ['tasting', L('Tasting', 'Дегустация', 'დეგუსტაცია'), '🍷', 'food', 'workshop'],
  ['sport', L('Sport event', 'Спортивное событие', 'სპორტული ღონისძიება'), '⚽', 'sport', 'meetup'],
  ['charity', L('Charity event', 'Благотворительный сбор', 'საქველმოქმედო'), '🤍', 'charity', 'gathering'],
  ['memorial', L('Memorial', 'Памятный день', 'ხსოვნის დღე'), '🕯', 'memorial', 'memorial'],
  ['other', L('Other', 'Другое', 'სხვა'), '📌', '', 'blank'],
].map(([slug, name, icon, category, scenario]) => ({ slug, name, icon, category, scenario }));

export const eventType = (slug) => EVENT_TYPES.find((t) => t.slug === slug) || EVENT_TYPES[EVENT_TYPES.length - 1];
export const eventCategory = (slug) => EVENT_CATEGORIES.find((c) => c.slug === slug) || null;
// A localized name with the usual chain: the language, English, any.
export const localName = (names, lang = 'en') => (names && (names[base(lang)] || names.en || Object.values(names).find(Boolean))) || '';
