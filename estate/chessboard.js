// estate/chessboard.js - the "chessboard" of a new-build: units of a building laid out by floor (top floor first,
// as developers draw it and buyers read it) and by position on the floor, with sale statuses; statistics (counts per
// status, price per m² of what can still be bought, in the dominant currency only), layouts grouped by room count
// with "price from", and the regular grid of a building (floors × units per floor, areas and room counts repeating).
// The board is COMPUTED from the units every time: a stored grid would disagree with the listing the day a unit sells.
//
//   unit = { id, flat, floor (null = not given; 0 is a real ground floor), position?, area (m², 0 = unknown),
//            price (integer in one unit, 0 = not given), currency, rooms (0 = studio), status? | sold? }
//   UNIT_STATUSES = ['free', 'reserved', 'sold', 'closed'], unitStatus(u)
//   chessboard(units) -> { rows: [{ floor, cells, slots? }], total, free, reserved, sold, closed, floors, columns }
//   unitStats(units) -> { total, free, reserved, sold, closed, avgM2, minM2, maxM2, currency, avgFrom, areaMin,
//                         areaMax, priceMin, priceMax }
//   unitPlans(units, { sold }) -> [{ rooms, free, sold, areaMin, areaMax, priceFrom, currency }]
//   pricePerM2(unit) -> integer | 0
//   unitPrice(area, ratePerM2, step = 100) -> area × rate rounded to the step (0 when either is missing)
//   unitGrid({ floors, perFloor, firstFloor, firstFlat, areas, rooms, pricePerM2, step }) -> [{ floor, flat,
//            position, area, price, rooms }]
//   UNIT_GRID_MAX = 400

export const UNIT_STATUSES = ['free', 'reserved', 'sold', 'closed'];
export const UNIT_STATUS_I18N = {
  free: { en: 'Available', ru: 'Свободна', ka: 'თავისუფალი' },
  reserved: { en: 'Reserved', ru: 'Бронь', ka: 'დაჯავშნილი' },
  sold: { en: 'Sold', ru: 'Продана', ka: 'გაყიდული' },
  closed: { en: 'Not for sale', ru: 'Не продаётся', ka: 'არ იყიდება' },
};

// The explicit status wins; the older `sold: true` flag reads as 'sold'; anything else is 'free'.
export function unitStatus(u) {
  if (!u) return 'free';
  if (UNIT_STATUSES.includes(u.status)) return u.status;
  return u.sold ? 'sold' : 'free';
}

// floor: null for "not given" (not 0, which is a real ground floor); position only as a positive integer (riser).
const floorOf = (u) => (u.floor == null || u.floor === '' || !Number.isFinite(Number(u.floor)) ? null : Math.trunc(Number(u.floor)));
const positionOf = (u) => (Number.isInteger(Number(u.position)) && Number(u.position) > 0 ? Number(u.position) : null);

// Flat numbers in human order: the number part first ('2' before '10'), then the text ('12' before '12A').
// Comparator layers: riser position, then numeric part, then text, then id (numeric collation) as a final tiebreak,
// so the order is total and deterministic: equal-looking flats never swap between renders.
function flatOrder(a, b) {
  const pa = positionOf(a), pb = positionOf(b);
  if (pa != null && pb != null && pa !== pb) return pa - pb;
  const na = parseInt(String(a.flat ?? '').replace(/^\D+/, ''), 10);
  const nb = parseInt(String(b.flat ?? '').replace(/^\D+/, ''), 10);
  const va = Number.isFinite(na) ? na : Number.MAX_SAFE_INTEGER;
  const vb = Number.isFinite(nb) ? nb : Number.MAX_SAFE_INTEGER;
  if (va !== vb) return va - vb;
  const s = String(a.flat ?? '').localeCompare(String(b.flat ?? ''));
  return s !== 0 ? s : String(a.id ?? '').localeCompare(String(b.id ?? ''), undefined, { numeric: true });
}

/**
 * Units by floor. Units WITHOUT a floor are not dropped: they form the last row (`floor: null`) - otherwise a building
 * of forty flats shows thirty-eight and nobody can say why. When units carry `position` (riser number, 1-based) every
 * row also gets `slots`, an array of `columns` cells with null gaps, so risers line up across floors.
 * The input is not mutated.
 */
export function chessboard(units) {
  const by = new Map();
  const count = { free: 0, reserved: 0, sold: 0, closed: 0 };
  let positioned = false;
  for (const u of units || []) {
    if (!u) continue;
    const f = floorOf(u);
    if (!by.has(f)) by.set(f, []);
    const status = unitStatus(u);
    by.get(f).push({ ...u, floor: f, status });
    count[status]++;
    if (positionOf(u) != null) positioned = true;
  }
  const floors = [...by.keys()].filter((f) => f != null).sort((a, b) => b - a);
  const rows = floors.map((f) => ({ floor: f, cells: by.get(f).sort(flatOrder) }));
  if (by.has(null)) rows.push({ floor: null, cells: by.get(null).sort(flatOrder) });
  let columns = rows.reduce((m, r) => Math.max(m, r.cells.length), 0);
  // Slot assignment: a unit goes to its riser column; collisions and unpositioned units fill the first free slot
  // (or extend the row), so no unit is ever hidden by bad position data.
  if (positioned) {
    columns = Math.max(columns, ...rows.flatMap((r) => r.cells.map((c) => positionOf(c) || 0)));
    for (const r of rows) {
      const slots = Array(columns).fill(null);
      const loose = [];
      for (const c of r.cells) {
        const p = positionOf(c);
        if (p != null && !slots[p - 1]) slots[p - 1] = c; else loose.push(c);
      }
      for (const c of loose) { const i = slots.indexOf(null); if (i >= 0) slots[i] = c; else slots.push(c); }
      r.slots = slots;
    }
    columns = rows.reduce((m, r) => Math.max(m, r.slots.length), columns);
  }
  const total = count.free + count.reserved + count.sold + count.closed;
  return { rows, total, ...count, floors: floors.length, columns };
}

export const pricePerM2 = (u) => (u && +u.price > 0 && +u.area > 0 ? Math.round(+u.price / +u.area) : 0);

const curOf = (u) => String((u && u.currency) || '').trim().toUpperCase();

// The most frequent currency among units with a price (ties: alphabetical) - an average over lari and dollars means
// nothing, so only one currency is averaged and `avgFrom` says over how many units.
function dominantCurrency(list) {
  const cnt = new Map();
  for (const u of list) { const c = curOf(u); if (c && +u.price > 0) cnt.set(c, (cnt.get(c) || 0) + 1); }
  let best = '', n = 0;
  for (const [c, k] of cnt) if (k > n || (k === n && c < best)) { best = c; n = k; }
  return best;
}

/**
 * Counts and prices of a set of units. Prices and areas come from the FREE units only: "price per m² in this
 * building" answers "what will it cost me", and a flat sold half a year ago does not answer that. No free units, no
 * average (0) - not "then over all", which would be a price nobody can buy at.
 */
export function unitStats(units) {
  const out = { total: 0, free: 0, reserved: 0, sold: 0, closed: 0, avgM2: 0, minM2: 0, maxM2: 0, currency: '', avgFrom: 0, areaMin: 0, areaMax: 0, priceMin: 0, priceMax: 0 };
  const live = [];
  for (const u of units || []) {
    if (!u) continue;
    out.total++;
    const s = unitStatus(u);
    out[s]++;
    if (s !== 'free') continue;
    live.push(u);
    const a = +u.area || 0;
    if (a > 0) { out.areaMin = out.areaMin ? Math.min(out.areaMin, a) : a; out.areaMax = Math.max(out.areaMax, a); }
  }
  const cur = dominantCurrency(live.filter((u) => +u.area > 0));
  if (!cur) return out;
  let sum = 0, n = 0;
  for (const u of live) {
    if (!(+u.price > 0) || !(+u.area > 0) || curOf(u) !== cur) continue;
    const m2 = +u.price / +u.area;
    sum += m2; n++;
    out.minM2 = out.minM2 ? Math.min(out.minM2, Math.round(m2)) : Math.round(m2);
    out.maxM2 = Math.max(out.maxM2, Math.round(m2));
    out.priceMin = out.priceMin ? Math.min(out.priceMin, +u.price) : +u.price;
    out.priceMax = Math.max(out.priceMax, +u.price);
  }
  if (n) { out.avgM2 = Math.round(sum / n); out.currency = cur; out.avgFrom = n; }
  return out;
}

/**
 * "Which flats are there and from what price": groups by ROOM COUNT (0 = studio), areas as a range. Counts, areas and
 * "price from" use the free units; a sold-out layout is left out unless `sold: true` (then the list answers "what was
 * built" and the ranges cover all units). Ordered by room count, as developers list them.
 */
export function unitPlans(units, { sold = false } = {}) {
  const by = new Map();
  for (const u of units || []) {
    if (!u) continue;
    const r = Math.max(0, Math.trunc(+u.rooms || 0));
    if (!by.has(r)) by.set(r, []);
    by.get(r).push(u);
  }
  const out = [];
  for (const [rooms, list] of by) {
    const free = list.filter((u) => unitStatus(u) === 'free');
    if (!free.length && !sold) continue;
    let areaMin = 0, areaMax = 0;
    for (const u of sold ? list : free) {
      const a = +u.area || 0;
      if (a > 0) { areaMin = areaMin ? Math.min(areaMin, a) : a; areaMax = Math.max(areaMax, a); }
    }
    const currency = dominantCurrency(free);
    let priceFrom = 0;
    for (const u of free) if (+u.price > 0 && curOf(u) === currency) priceFrom = priceFrom ? Math.min(priceFrom, +u.price) : +u.price;
    out.push({ rooms, free: free.length, sold: list.length - free.length, areaMin, areaMax, priceFrom, currency });
  }
  return out.sort((a, b) => a.rooms - b.rooms);
}

// One rounding rule for the grid and for imported tables: two roundings would give one flat two prices.
export const unitPrice = (area, ratePerM2, step = 100) => {
  const a = +area, r = +ratePerM2, s = Math.max(1, Math.trunc(+step) || 1);
  return r > 0 && a > 0 ? Math.round((a * r) / s) * s : 0;
};

// Shared cap with table.js unitTable: one limit for "units of one building" whichever way they are created.
export const UNIT_GRID_MAX = 400;

/**
 * A regular building: `floors × perFloor` units numbered through (from `firstFlat`), from `firstFloor` up (2 when the
 * ground floor is commercial). Areas and room counts repeat per floor in the given order - a developer lists three
 * types, not forty lines. The cap is hard: a typo in "floors" must not create ten thousand listings.
 */
export function unitGrid(spec) {
  const floors = Math.max(0, Math.min(200, Math.trunc(Number(spec && spec.floors)) || 0));
  const per = Math.max(0, Math.min(40, Math.trunc(Number(spec && spec.perFloor)) || 0));
  if (!floors || !per) return [];
  const first = Math.trunc(Number(spec.firstFloor));
  const from = Number.isFinite(first) && first !== 0 ? first : 1;
  const ff = Math.trunc(Number(spec.firstFlat));
  let flat = Number.isFinite(ff) && ff > 0 ? ff : 1;
  const areas = (Array.isArray(spec.areas) ? spec.areas : []).map(Number).filter((x) => Number.isFinite(x) && x > 0);
  const rooms = (Array.isArray(spec.rooms) ? spec.rooms : []).map((x) => Math.trunc(+x)).filter((x) => Number.isFinite(x) && x >= 0);
  const rate = Math.max(0, +(spec.pricePerM2 ?? 0) || 0);
  const step = spec.step ?? 100;
  const out = [];
  for (let f = 0; f < floors; f++) {
    for (let i = 0; i < per; i++) {
      if (out.length >= UNIT_GRID_MAX) return out;
      const area = areas.length ? areas[i % areas.length] : 0;
      out.push({ floor: from + f, flat: String(flat++), position: i + 1, area, price: unitPrice(area, rate, step), rooms: rooms.length ? rooms[i % rooms.length] : 0 });
    }
  }
  return out;
}
