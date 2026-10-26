// plan/summary.js - what a plan says in numbers: seats and tables per page, room areas per room type (living and
// service rooms apart), the outline area, sleeping places of a room taken from the furniture standing in it,
// shapes inside a room (centre test with the room's rotation and polygon), overlaps of solid items (separating
// axis test on rotated rectangles), items sticking out of the page / outline, and aisles narrower than a minimum.

import { corners, perimeter, pointInPolygon, polygonArea, segDist, toLocal } from './geom.js';
import { shapeArea, stencil } from './stencils.js';
import { normalizePlan } from './model.js';

// Overlap detection uses the separating axis theorem: two convex polygons are disjoint iff some edge normal separates
// their projections; for rectangles only 4 axes need testing, so it is exact and cheap even for rotated items.
export const SERVICE_ROOMS = ['bath', 'balcony', 'storage', 'hallway'];
const r1 = (v) => Math.round(v * 10) / 10;

// Seats and seated items (tables, chair rows) of a page; byKind counts per stencil.
export function seatSummary(page) {
  let tables = 0, seats = 0;
  const byKind = {};
  for (const s of page?.shapes ?? []) {
    if (!stencil(s.kind).seated) continue;
    tables++; seats += +s.seats || 0;
    const k = (byKind[s.kind] ??= { count: 0, seats: 0 });
    k.count++; k.seats += +s.seats || 0;
  }
  return { tables, seats, byKind };
}

/**
 * Room areas: { rooms, area, living, service, byType: { type: { rooms, area } }, outline: { area, perimeter } | null }.
 * service: room types counted apart from the living area (default bath, balcony, storage, hallway).
 */
export function areaSummary(page, { service = SERVICE_ROOMS } = {}) {
  let rooms = 0, total = 0, living = 0, serv = 0;
  const byType = {};
  for (const s of page?.shapes ?? []) {
    const st = stencil(s.kind);
    if (!st.room) continue;
    const a = shapeArea(s), type = s.roomType || st.roomType || 'room';
    rooms++; total += a;
    if (service.includes(type)) serv += a; else living += a;
    const t = (byType[type] ??= { rooms: 0, area: 0 });
    t.rooms++; t.area += a;
  }
  for (const t of Object.values(byType)) t.area = r1(t.area);
  const outline = page?.outline ? { area: r1(polygonArea(page.outline)), perimeter: r1(perimeter(page.outline)) } : null;
  return { rooms, area: r1(total), living: r1(living), service: r1(serv), byType, outline };
}

// Does `room` contain the centre of shape `sh`? The room turns about its centre; polygon rooms test their points.
export function contains(room, sh) {
  const [lx, ly] = toLocal(room, [sh.x + sh.w / 2, sh.y + sh.h / 2]);
  if (Array.isArray(room.pts) && room.pts.length >= 3) return pointInPolygon(room.pts, [lx, ly]);
  return lx >= -1e-9 && ly >= -1e-9 && lx <= room.w + 1e-9 && ly <= room.h + 1e-9;
}

// Shapes standing in a room shape (rooms themselves excluded).
export const shapesInRoom = (page, room) => page.shapes.filter((s) => s !== room && !stencil(s.kind).room && contains(room, s));

/**
 * Sleeping places of a room from the plan: furniture whose centre is inside a room shape with `roomKey`, minus the
 * furniture inside room shapes listed in `except` (a nook has its own list; one bed must not land in two).
 * -> [{ type, label, capacity, note }]   capacity null = the stencil default.
 */
export function roomPlaces(raw, roomKey, except = []) {
  const m = raw?.v && Array.isArray(raw.pages) ? raw : normalizePlan(raw);
  const out = [];
  for (const p of m.pages) {
    const mine = p.shapes.filter((s) => stencil(s.kind).room && s.roomKey === roomKey);
    if (!mine.length) continue;
    const zones = p.shapes.filter((s) => stencil(s.kind).room && s.roomKey && except.includes(s.roomKey));
    for (const s of p.shapes) {
      const st = stencil(s.kind);
      if (!st.sleep || !mine.some((r) => contains(r, s)) || zones.some((z) => contains(z, s))) continue;
      out.push({ type: st.sleep, label: s.label || '', capacity: s.places != null ? s.places : null, note: s.note || null });
    }
  }
  return out;
}

// Sleeping places of a whole page: { places, beds, byType }.
export function sleepSummary(page) {
  let places = 0, beds = 0;
  const byType = {};
  for (const s of page?.shapes ?? []) {
    const st = stencil(s.kind);
    if (!st.sleep) continue;
    const n = s.places != null ? s.places : st.cap || 0;
    beds++; places += n; byType[st.sleep] = (byType[st.sleep] ?? 0) + n;
  }
  return { places, beds, byType };
}

// --- collisions ----------------------------------------------------------------------------------------------------

// Solid items take floor space; rooms, zones, labels, lines, doors, windows and dance floors do not collide.
export function isSolid(s) {
  const st = stencil(s.kind);
  return !(st.room || st.zone || st.flat || st.plain || ['door', 'window', 'dancefloor', 'rect', 'ellipse'].includes(st.key));
}

// Penetration depth of two convex polygons along the separating axes (<= 0: apart or touching).
function penetration(a, b) {
  let best = Infinity;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const n = [q[1] - p[1], p[0] - q[0]], l = Math.hypot(n[0], n[1]) || 1;
      const ax = [n[0] / l, n[1] / l];
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const v of a) { const d = v[0] * ax[0] + v[1] * ax[1]; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
      for (const v of b) { const d = v[0] * ax[0] + v[1] * ax[1]; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
      best = Math.min(best, Math.min(a1, b1) - Math.max(a0, b0));
      if (best <= 0) return best;
    }
  }
  return best;
}

// Shortest distance between two convex polygons (0 when they touch or overlap).
export function polygonGap(a, b) {
  if (penetration(a, b) >= 0) return 0;          // convex: no separating axis means they meet
  let d = Infinity;
  for (let i = 0; i < a.length; i++) for (const v of b) d = Math.min(d, segDist(v, a[i], a[(i + 1) % a.length]));
  for (let i = 0; i < b.length; i++) for (const v of a) d = Math.min(d, segDist(v, b[i], b[(i + 1) % b.length]));
  return d;
}

/**
 * Overlapping solid items of a page: [{ a, b, depth }] (ids, penetration in metres > tol).
 *   filter(shape) -> boolean   which shapes take part (default isSolid)
 */
export function overlaps(page, { filter = isSolid, tol = 1e-6 } = {}) {
  const list = page.shapes.filter(filter).map((s) => ({ s, c: corners(s) }));
  const out = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const d = penetration(list[i].c, list[j].c);
    if (d > tol) out.push({ a: list[i].s.id, b: list[j].s.id, depth: Math.round(d * 1000) / 1000 });
  }
  return out;
}

// Pairs of items closer than `min` metres without touching (aisles too narrow for a trolley or a wheelchair).
export function narrowAisles(page, min = 0.9, { filter = isSolid } = {}) {
  const list = page.shapes.filter(filter).map((s) => ({ s, c: corners(s) }));
  const out = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const g = polygonGap(list[i].c, list[j].c);
    if (g > 1e-6 && g < min - 1e-9) out.push({ a: list[i].s.id, b: list[j].s.id, gap: Math.round(g * 1000) / 1000 });
  }
  return out;
}

// Shapes with a corner outside the page outline (or the page rectangle): ids.
export function outsidePage(page, { filter = (s) => !stencil(s.kind).flat } = {}) {
  const poly = page.outline ?? [[0, 0], [page.w, 0], [page.w, page.h], [0, page.h]];
  return page.shapes.filter(filter).filter((s) => corners(s).some((p) => !pointInPolygon(poly, p, 1e-6))).map((s) => s.id);
}
