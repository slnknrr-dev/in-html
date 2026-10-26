// estate/rooms.js - the rooms of a property as a two-level tree and what is computed from it: room types with zones
// (living / service / non-living) and names in five languages, sleeping places, the summary (rooms, area, sleeping
// capacity, bathrooms, bedrooms, kitchens) and the layout kind (Euro n+1 "apartments", studio, separate rooms).
//
// A ROOM is a top-level node together with its ZONES (`parent` = the room's key): "Hall + Hallway + Kitchen" is one
// room. Only two levels: a zone of a zone, a parent that does not exist or points at itself becomes a room of its own
// (it is never dropped - the property would lose its area and beds). A kitchen alone is not a room; a kitchen-living
// room is. The declared total area of a flat is NOT the sum of rooms (walls, corridors, loggia): `area` here is the
// sum of what the rooms say, for display and checks.
//
//   ROOM_ZONES, ROOM_TYPES, roomTypeDef(type), ROOM_BATH_TYPES, ROOM_SERVICE_TYPES
//   PLACE_TYPES, placeCapacity(place), normalizePlaces(raw)
//   cleanRoomKey(v), roomKeyFromName(name, taken, fallback)       Cyrillic transliterated, repeats get _2, _3
//   normalizeRoom(raw) -> room | null, normalizeRooms(raw) -> rooms, roomZones(rooms, key)
//   roomLabel(room, lang) -> text
//   roomsSummary(rooms) -> { rooms, area, capacity, bath, bedrooms, kitchens }
//   roomsLayout(rooms) -> { layout: 'apartments' | 'studio' | 'rooms' | '', rooms, bedrooms, kitchens, size }
//   ROOMS_LAYOUT_NAME

// Type flags (bedroom, kitchen, bath) rather than type-name checks downstream: aliases and future types then
// participate in the summary without touching roomsSummary / roomsLayout.
export const ROOM_ZONES = ['living', 'service', 'nonliving'];

export const ROOM_TYPES = {
  room: { zone: 'living', icon: '🚪', name: { en: 'Room', ru: 'Комната', ka: 'ოთახი', he: 'חדר', ar: 'غرفة' } },
  bedroom: { zone: 'living', bedroom: true, icon: '🛏', name: { en: 'Bedroom', ru: 'Спальня', ka: 'საძინებელი', he: 'חדר שינה', ar: 'غرفة نوم' } },
  living: { zone: 'living', icon: '🛋', name: { en: 'Living room', ru: 'Гостиная', ka: 'მისაღები', he: 'סלון', ar: 'غرفة المعيشة' } },
  hall: { zone: 'living', icon: '🪑', name: { en: 'Hall', ru: 'Зал', ka: 'დარბაზი', he: 'אולם', ar: 'صالة' } },
  kitchen: { zone: 'living', kitchen: true, icon: '🍳', name: { en: 'Kitchen', ru: 'Кухня', ka: 'სამზარეულო', he: 'מטבח', ar: 'مطبخ' } },
  bath: { zone: 'service', bath: true, icon: '🛁', name: { en: 'Bathroom', ru: 'Санузел', ka: 'სველი წერტილი', he: 'חדר רחצה', ar: 'حمّام' } },
  hallway: { zone: 'service', icon: '🧥', name: { en: 'Hallway', ru: 'Прихожая', ka: 'შესასვლელი', he: 'מבואה', ar: 'مدخل' } },
  corridor: { zone: 'service', icon: '↔', name: { en: 'Corridor', ru: 'Коридор', ka: 'დერეფანი', he: 'מסדרון', ar: 'ممر' } },
  storage: { zone: 'nonliving', icon: '📦', name: { en: 'Storage', ru: 'Кладовая', ka: 'საკუჭნაო', he: 'מחסן', ar: 'مخزن' } },
  balcony: { zone: 'nonliving', icon: '🪴', name: { en: 'Balcony', ru: 'Балкон', ka: 'აივანი', he: 'מרפסת', ar: 'شرفة' } },
  loggia: { zone: 'nonliving', icon: '🪟', name: { en: 'Loggia', ru: 'Лоджия', ka: 'ლოჯია', he: 'לוג׳יה', ar: 'لوجيا' } },
  garage: { zone: 'nonliving', icon: '🚗', name: { en: 'Garage', ru: 'Гараж', ka: 'ავტოფარეხი', he: 'מוסך', ar: 'مرآب' } },
  attic: { zone: 'nonliving', icon: '🏚', name: { en: 'Attic', ru: 'Чердак', ka: 'სხვენი', he: 'עליית גג', ar: 'علّية' } },
};
// Older names of the bathroom are the same type, not four.
const ROOM_TYPE_ALIAS = { toilet: 'bath', wc: 'bath', bathroom: 'bath' };

export const cleanRoomKey = (v) => String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40);

export const roomTypeDef = (t) => {
  const k = cleanRoomKey(t);
  return ROOM_TYPES[ROOM_TYPE_ALIAS[k] || k] || null;
};

export const ROOM_BATH_TYPES = ['bath', 'bathroom', 'wc', 'toilet'];
export const ROOM_SERVICE_TYPES = [...ROOM_BATH_TYPES, ...Object.keys(ROOM_TYPES).filter((k) => ROOM_TYPES[k].zone !== 'living' && !ROOM_BATH_TYPES.includes(k))];

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
};

// A key from a room name, free among the taken ones: two "Bedrooms" are normal, the second becomes bedroom_2. A name
// with nothing left (emoji) gives `fallback`: a room without a key cannot be referred to.
export function roomKeyFromName(name, taken = [], fallback = 'room') {
  const base = cleanRoomKey(String(name ?? '').trim().toLowerCase().replace(/[а-яё]/g, (ch) => TRANSLIT[ch] ?? '')
    .replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')) || cleanRoomKey(fallback) || 'room';
  const busy = new Set([...taken].map(String));
  if (!busy.has(base)) return base;
  for (let n = 2; n < 1000; n++) { const k = (base + '_' + n).slice(0, 40); if (!busy.has(k)) return k; }
  return base;
}

function i18nObj(v, max = 200) {
  const out = {};
  if (typeof v === 'string') { const s = v.trim().slice(0, max); if (s) out.en = s; return out; }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v)) { const s = String(val ?? '').trim(); if (s && /^[a-z]{2}$/.test(k)) out[k] = s.slice(0, max); }
  }
  return out;
}

// Sleeping places as a list: type, label, places (null = the type's default; an explicit 0 stays 0), circumstances.
export const PLACE_TYPES = {
  single: { cap: 1, icon: '🛏', name: { en: 'Single bed', ru: 'Односпальная кровать', ka: 'ერთადგილიანი საწოლი' } },
  double: { cap: 2, icon: '🛏', name: { en: 'Double bed', ru: 'Двуспальная кровать', ka: 'ორადგილიანი საწოლი' } },
  bunk: { cap: 2, icon: '🪜', name: { en: 'Bunk bed', ru: 'Двухъярусная кровать', ka: 'ორსართულიანი საწოლი' } },
  sofa: { cap: 2, icon: '🛋', name: { en: 'Sofa bed', ru: 'Диван-раскладной', ka: 'დივან-საწოლი' } },
  armchair: { cap: 1, icon: '💺', name: { en: 'Pull-out armchair', ru: 'Кресло-раскладное', ka: 'გასაშლელი სავარძელი' } },
  crib: { cap: 1, icon: '👶', name: { en: 'Crib', ru: 'Детская кроватка', ka: 'საბავშვო საწოლი' } },
};
export const placeCapacity = (p) => (p.capacity != null ? p.capacity : (PLACE_TYPES[p.type] && PLACE_TYPES[p.type].cap) || 0);

export function normalizePlaces(raw) {
  const out = [];
  for (const p of (Array.isArray(raw) ? raw : []).slice(0, 20)) {
    if (!p || typeof p !== 'object') continue;
    const c = String(p.capacity ?? '').trim();
    const n = Math.trunc(+c);
    out.push({
      type: PLACE_TYPES[String(p.type)] ? String(p.type) : '',
      label: String(p.label ?? '').trim().slice(0, 60),
      capacity: c === '' || !Number.isFinite(n) ? null : Math.max(0, Math.min(20, n)),
      note: i18nObj(p.note),
    });
  }
  return out;
}

export function normalizeRoom(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const key = cleanRoomKey(r.key);
  if (!key) return null;
  const num = (v, max) => { const n = +String(v ?? '').trim(); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0; };
  const types = [...new Set((Array.isArray(r.types) ? r.types : r.type != null ? [r.type] : []).map(cleanRoomKey).filter(Boolean))].slice(0, 8);
  const places = normalizePlaces(r.places);
  const parent = cleanRoomKey(r.parent);
  return {
    key,
    name: i18nObj(r.name),
    ord: Number.isFinite(+r.ord) ? +r.ord | 0 : 0,
    parent: parent === key ? '' : parent,
    types,
    type: types[0] || '',
    area: num(r.area, 100000),
    // Two writers of one number - the place list and the "beds" field - do not argue: a list, when there is one, counts.
    beds: places.length ? Math.min(99, places.reduce((s, p) => s + placeCapacity(p), 0)) : Math.trunc(num(r.beds, 99)),
    places,
    bath: !!r.bath,
  };
}

// Rooms deduplicated by key (the last wins), ordered by `ord` (stable: equal ord keeps the list order), with the
// two-level rule applied.
// Two-level rule enforced here, after dedup: a parent must exist AND be top-level itself; otherwise the node is
// promoted to a room. Array.prototype.sort is stable (ES2019), which the "equal ord keeps list order" promise needs.
export function normalizeRooms(raw) {
  const seen = new Map();
  for (const r of Array.isArray(raw) ? raw : []) { const x = normalizeRoom(r); if (x) seen.set(x.key, x); }
  const out = [...seen.values()].sort((a, b) => a.ord - b.ord);
  const top = new Set(out.filter((x) => !x.parent).map((x) => x.key));
  for (const x of out) if (x.parent && !top.has(x.parent)) x.parent = '';
  return out;
}

export const roomZones = (rooms, key) => rooms.filter((r) => r.parent === key);

/**
 * Room label in the page language: a name typed in that language wins; a name that is the WORD OF ITS OWN TYPE in
 * any language ('Спальня 2', 'Bedroom') is translated with its number; no name - the type's word; any other free text
 * is shown as typed (en -> ru -> first).
 */
export function roomLabel(r, lang = 'en') {
  if (!r) return '';
  const name = r.name && typeof r.name === 'object' ? r.name : {};
  const own = String(name[lang] ?? '').trim();
  if (own) return own;
  const defs = [];
  for (const t of [...(Array.isArray(r.types) ? r.types : []), r.type || '']) {
    const d = t ? roomTypeDef(t) : null;
    if (d && !defs.includes(d)) defs.push(d);
  }
  const word = (d) => d.name[lang] || d.name.en || d.name.ru || '';
  const vals = Object.values(name).map((v) => String(v ?? '').trim()).filter(Boolean);
  if (!vals.length) return defs.length ? word(defs[0]) : '';
  for (const v of vals) {
    const m = v.match(/^(.*?)(?:\s+(\d{1,2}))?$/);
    const base = ((m && m[1]) || v).toLowerCase();
    const num = m && m[2] ? ' ' + m[2] : '';
    for (const d of defs) if (Object.values(d.name).some((w) => String(w).toLowerCase() === base)) return word(d) + num;
  }
  return String(name.en || name.ru || vals[0]).trim();
}

const livingOrUnknown = (t) => { const d = roomTypeDef(t); return d ? d.zone === 'living' : !ROOM_SERVICE_TYPES.includes(t); };

/**
 * What the rooms say about the property. A room (top-level node with its zones) counts when it has a living or an
 * unknown type (an unknown type is more honestly a room than a lost one) other than a lone kitchen. Area: the room's
 * own area, else the sum of its zones (never both), rounded to 0.1. Capacity: all sleeping places. 0 means "not
 * computed" - a caller should not write such a value.
 */
// Re-normalises its input (idempotent) so callers may pass raw stored rooms; cost is negligible for a flat.
export function roomsSummary(rooms) {
  const list = normalizeRooms([...(rooms || [])]);
  let area = 0, capacity = 0, bath = 0, roomsN = 0, bedrooms = 0, kitchens = 0;
  for (const room of list.filter((r) => !r.parent)) {
    const members = [room, ...roomZones(list, room.key)];
    const types = members.flatMap((m) => (m.types.length ? m.types : ['']));
    const counted = types.filter(livingOrUnknown);
    if (counted.length && counted.some((t) => !(roomTypeDef(t) && roomTypeDef(t).kitchen))) roomsN++;
    if (types.some((t) => roomTypeDef(t) && roomTypeDef(t).bedroom)) bedrooms++;
    if (types.some((t) => roomTypeDef(t) && roomTypeDef(t).kitchen)) kitchens++;
    const own = room.area > 0 ? room.area : members.slice(1).reduce((s, z) => s + (z.area > 0 ? z.area : 0), 0);
    if (own > 0) area += own;
    for (const m of members) {
      capacity += m.beds;
      if (m.bath || m.types.some((t) => ROOM_BATH_TYPES.includes(t))) bath++;
    }
  }
  return { rooms: roomsN, area: Math.round(area * 10) / 10, capacity, bath, bedrooms, kitchens };
}

/**
 * The layout kind: `apartments` (Euro, n+1) - bedrooms, exactly one kitchen, and every other living space sits in one
 * room with the kitchen ("Hall + Hallway + Kitchen"); `studio` - no bedrooms and one room; `rooms` - anything else;
 * '' - no rooms at all (a layout is not guessed from a room count). `size` = bedrooms + 1, the number the Euro words
 * go by (scales.js EURO_SCALE). A zone without a type is a corner of its room, not "another living space".
 */
export function roomsLayout(rooms) {
  const list = normalizeRooms([...(rooms || [])]);
  if (!list.length) return { layout: '', rooms: 0, bedrooms: 0, kitchens: 0, size: 0 };
  const s = roomsSummary(list);
  const isKitchen = (t) => !!(roomTypeDef(t) && roomTypeDef(t).kitchen);
  const isBedroom = (t) => !!(roomTypeDef(t) && roomTypeDef(t).bedroom);
  const groupHasKitchen = (top) => list.some((m) => (m.key === top || m.parent === top) && m.types.some(isKitchen));
  const otherLiving = list.filter((n) => {
    if (!n.types.length) return !n.parent;
    if (n.types.some(isKitchen)) return false;
    return n.types.some((t) => livingOrUnknown(t) && !isBedroom(t));
  });
  const euro = s.bedrooms > 0 && s.kitchens === 1 && otherLiving.every((n) => groupHasKitchen(n.parent || n.key));
  const layout = euro ? 'apartments' : s.bedrooms === 0 && s.rooms === 1 ? 'studio' : 'rooms';
  return { layout, rooms: s.rooms, bedrooms: s.bedrooms, kitchens: s.kitchens, size: s.bedrooms + 1 };
}

export const ROOMS_LAYOUT_NAME = {
  apartments: { en: 'Euro layout (n+1)', ru: 'Евро-планировка (n+1)', ka: 'ევრო-გეგმარება (n+1)' },
  studio: { en: 'Studio', ru: 'Студия', ka: 'სტუდიო' },
  rooms: { en: 'Separate rooms', ru: 'Отдельные комнаты', ka: 'ცალკე ოთახები' },
};
