// planogram/model.js - the shelf model in centimetres: products (box dimensions, squeeze % per axis, category,
// brand, prices, daily sales, stock), fixtures (racks / gondolas / wall units) holding shelves or pegboards from top
// to bottom, positions on a shelf (product, facings fx / fy / fz across / up / into the depth, rotation in the front
// plane 0 / 90 / 180 / 270 and the sideways turn that swaps width and depth). Normalisers clamp instead of throwing,
// so a hand-edited JSON file always yields a working model. Planogram types and statuses with the expiry rule.
//
// Units are centimetres everywhere; LIMITS bounds every count and size so a corrupt or hostile file cannot make the
// renderer draw millions of cells. `modelId` is accepted as a legacy alias of productId throughout the folder.

export const ROTATIONS = [0, 90, 180, 270];
export const TURNS = [0, 90];
export const SHELF_KINDS = ['shelf', 'peg'];
export const TYPES = ['main', 'alternative', 'sample', 'temporary'];
export const STATUSES = ['draft', 'active', 'expired', 'archived'];
export const TEMP_DAYS = 3;                       // default lifetime of a temporary planogram
export const LIMITS = { shelves: 30, positions: 200, fx: 100, fy: 50, fz: 50, squeeze: 50, size: 10000 };

const DAY = 86400000;
export const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
// Blank strings are not numbers here (Number('') would be 0, silently zeroing an emptied form field).
const fin = (v, dflt = null) => { const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v); return Number.isFinite(n) ? n : dflt; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const int = (v, lo, hi, dflt) => { const n = fin(v); return n == null ? dflt : clamp(Math.round(n), lo, hi); };
const size = (v, dflt = null) => { const n = fin(v); return n == null || n <= 0 ? dflt : round(Math.min(n, LIMITS.size)); };
const str = (v, max = 200) => (v == null ? '' : String(v).slice(0, max));
let seq = 0;
// Counter + random suffix: unique within a session (counter) and unlikely to collide across sessions that merge
// data (random). Not a UUID; adequate for local records.
export const newId = (prefix = 'i') => prefix + (++seq).toString(36) + Math.random().toString(36).slice(2, 6);

// --- dimensions ----------------------------------------------------------------------------------------------------

// rot turns the pack in the front plane (90 / 270 swap width and height), turn puts it sideways (width <-> depth).
// The turn is applied first, as on the shelf: a pack turned sideways and then laid on its side.
export function effectiveDims(d, rot = 0, turn = 0) {
  let { width: w, height: h, depth: dp } = d;
  if (turn === 90) [w, dp] = [dp, w];
  if (rot === 90 || rot === 270) [w, h] = [h, w];
  return { width: w, height: h, depth: dp };
}

// Squeeze % per axis turns with the pack.
export const effectiveSqueeze = (d, rot = 0, turn = 0) =>
  effectiveDims({ width: d?.squeeze?.x ?? 0, height: d?.squeeze?.y ?? 0, depth: d?.squeeze?.z ?? 0 }, rot, turn);

export const hasDims = (d) => !!d && d.width != null && d.height != null && d.depth != null;

// --- products ------------------------------------------------------------------------------------------------------

// Squeeze: how much a soft pack (bags, pouches) may be compressed per axis, 0-50 %: a tight fit is not an overflow.
export function normalizeProduct(raw = {}) {
  const sq = raw.squeeze && typeof raw.squeeze === 'object' ? raw.squeeze : {};
  const pct = (v) => clamp(fin(v, 0), 0, LIMITS.squeeze);
  const p = {
    id: str(raw.id ?? newId('p'), 64),
    name: str(raw.name) || '?',
    code: raw.code == null ? null : str(raw.code, 64),
    category: raw.category == null || raw.category === '' ? null : str(raw.category, 100),
    brand: raw.brand == null || raw.brand === '' ? null : str(raw.brand, 100),
    width: size(raw.width), height: size(raw.height), depth: size(raw.depth),
    squeeze: { x: pct(sq.x ?? raw.squeeze_x), y: pct(sq.y ?? raw.squeeze_y), z: pct(sq.z ?? raw.squeeze_z) },
    price: fin(raw.price), cost: fin(raw.cost), dailySales: fin(raw.dailySales), stock: fin(raw.stock),
  };
  if (raw.color != null && /^#[0-9a-f]{3,8}$/i.test(String(raw.color))) p.color = String(raw.color);
  if (raw.caseUnits != null) p.caseUnits = int(raw.caseUnits, 1, 10000, 1);
  return p;
}

// A lookup id -> product from an array, a Map, an object or a function.
export function productLookup(products) {
  if (typeof products === 'function') return products;
  if (products instanceof Map) return (id) => products.get(id);
  if (Array.isArray(products)) { const m = new Map(products.map((p) => [p.id, p])); return (id) => m.get(id); }
  const o = products || {};
  return (id) => (Object.prototype.hasOwnProperty.call(o, id) ? o[id] : undefined);
}

// --- positions, shelves, fixtures ----------------------------------------------------------------------------------

export function normalizePosition(raw = {}) {
  const rot = Number(raw.rot ?? 0), turn = Number(raw.turn ?? 0);
  const p = {
    productId: str(raw.productId ?? raw.modelId, 64),
    fx: int(raw.fx ?? raw.facings, 1, LIMITS.fx, 1),
    fy: int(raw.fy, 1, LIMITS.fy, 1),
    fz: int(raw.fz, 1, LIMITS.fz, 1),
    rot: ROTATIONS.includes(rot) ? rot : 0,
    turn: TURNS.includes(turn) ? turn : 0,
  };
  if (raw.ref != null) p.ref = str(raw.ref, 64);            // a unit of equipment standing on the shelf
  return p;
}

// height is the clearance above the board; pegboards (kind 'peg') hang packs on hooks at a hole pitch.
export function normalizeShelf(raw = {}) {
  const positions = Array.isArray(raw.positions) ? raw.positions.slice(0, LIMITS.positions).map(normalizePosition) : [];
  const s = {
    id: str(raw.id ?? newId('s'), 40),
    kind: SHELF_KINDS.includes(raw.kind) ? raw.kind : 'shelf',
    width: size(raw.width, 100), height: size(raw.height, 30), depth: size(raw.depth, 40),
    thickness: clamp(fin(raw.thickness, 3), 0, 20),
    positions,
  };
  if (s.kind === 'peg') s.pitch = clamp(fin(raw.pitch, 2.5), 0.5, 20);
  if (raw.label != null && raw.label !== '') s.label = str(raw.label, 100);
  return s;
}

export function normalizeFixture(raw = {}) {
  const f = {
    id: str(raw.id ?? newId('f'), 40),
    name: str(raw.name),
    width: size(raw.width, 100), height: size(raw.height, 200), depth: size(raw.depth, 40),
    base: clamp(fin(raw.base, 10), 0, 100),
    shelves: Array.isArray(raw.shelves) ? raw.shelves.slice(0, LIMITS.shelves).map(normalizeShelf) : [],
  };
  if (!Array.isArray(raw.shelves)) f.shelves = defaultShelves(f, raw.shelfCount);
  return f;
}

// Default shelves from the fixture dimensions: equal clearances over the height above a 10 cm plinth.
export function defaultShelves(fixture, count = 4) {
  const n = int(count, 1, LIMITS.shelves, 4);
  const width = fixture.width || 100, depth = fixture.depth || 40, height = fixture.height || 200;
  const gap = round(Math.max(10, (height - 10) / n), 0);
  return Array.from({ length: n }, () => normalizeShelf({ width, depth, height: gap }));
}

// --- planogram versions --------------------------------------------------------------------------------------------

// A date-only expiry ('2026-10-31') means the end of that day in UTC, so the planogram stays valid all day. `now` is
// injectable for deterministic tests of the temporary-planogram default.
export function normalizePlanogram(raw = {}, now = Date.now()) {
  const type = TYPES.includes(raw.type) ? raw.type : 'main';
  let expiresAt = raw.expiresAt == null || raw.expiresAt === '' ? null : typeof raw.expiresAt === 'number' ? raw.expiresAt
    : /^\d{4}-\d{2}-\d{2}$/.test(raw.expiresAt) ? Date.parse(`${raw.expiresAt}T23:59:59.999Z`) : fin(Date.parse(raw.expiresAt));
  if (type === 'temporary' && expiresAt == null) expiresAt = now + TEMP_DAYS * DAY;
  return {
    id: str(raw.id ?? newId('g'), 40), name: str(raw.name), type,
    status: STATUSES.includes(raw.status) ? raw.status : 'draft', expiresAt,
    version: int(raw.version, 1, 1e9, 1),
    fixture: normalizeFixture(raw.fixture ?? {}),
  };
}

// A temporary planogram past its date counts as expired even when nobody changed its status.
export function effectiveStatus(p, now = Date.now()) {
  const exp = p.expiresAt ?? p.expires_at;
  if ((p.status === 'draft' || p.status === 'active') && exp != null && exp < now) return 'expired';
  return p.status;
}
