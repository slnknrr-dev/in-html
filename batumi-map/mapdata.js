// batumi-map/mapdata.js - the embedded map decoded once: shapes { kind, pts, sid, box } for geo/render.js (roads
// know their street id), the sea, street lines by id, the light and dark map styles (geo/osm.js MAP_STYLE plus the
// highlight of a selected street) and Web Mercator helpers in world units (0..1 at zoom 0) for panning and zooming.
//
// Why a separate module: data-map.js is generated and licensed as data (ODbL); this file is code that turns it into
// render-ready shapes. Decoding is deferred to the first mapData() call and memoised: ~100 000 points are decoded
// once per page life, never at import time; the street-list page does not import this module at all, so it never
// pays for the map data.
import { MAP_STYLE, LAND_COLOR } from '../geo/osm.js';
import { decodeLines } from '../geo/polyline.js';
import { latToTileY, lonToTileX, tileXToLon, tileYToLat } from '../geo/mercator.js';
import { LAYERS, MAP_BBOX, MAP_DATE, PLACES, ROAD_STREETS, SEA } from './data-map.js';

export { MAP_DATE };
export const BOX = { south: MAP_BBOX[0], west: MAP_BBOX[1], north: MAP_BBOX[2], east: MAP_BBOX[3] };
// The view of the whole city at the start: the centre from the port to the airport.
export const CITY = { south: 41.6, west: 41.592, north: 41.664, east: 41.672 };

// Bounding box per shape [south, west, north, east], computed once: viewport culling in main.js then costs four
// comparisons per shape instead of a pass over its points.
const boxOf = (pts) => {
  let s = 90, w = 180, n = -90, e = -180;
  for (const p of pts) { if (p[0] < s) s = p[0]; if (p[0] > n) n = p[0]; if (p[1] < w) w = p[1]; if (p[1] > e) e = p[1]; }
  return [s, w, n, e];
};

let DATA = null;
/** { shapes, byStreet: Map(sid -> [pts]), places } (decoded on first use, ~100 000 points). */
export function mapData() {
  if (DATA) return DATA;
  const shapes = [], byStreet = new Map();
  for (const pts of decodeLines(SEA)) shapes.push({ kind: 'water', pts, sid: -1, box: boxOf(pts) });
  // Shapes keep their street id (sid) from ROAD_STREETS (parallel array, same order as the encoded lines); byStreet
  // groups a street's lines for highlighting and for fitting the view to a street.
  for (const [kind, enc] of Object.entries(LAYERS)) {
    const ids = ROAD_STREETS[kind] || [];
    decodeLines(enc).forEach((pts, i) => {
      const sid = ids[i] ?? -1;
      shapes.push({ kind, pts, sid, name: '', box: boxOf(pts) });
      if (sid >= 0) { if (!byStreet.has(sid)) byStreet.set(sid, []); byStreet.get(sid).push(pts); }
    });
  }
  const places = PLACES.map(([name, en, ru, rank, lat, lng]) => ({ names: { ka: name, en, ru }, rank, pt: [lat, lng] }));
  DATA = { shapes, byStreet, places };
  return DATA;
}

// The box of a street (its lines and houses), or null.
export function streetBox(lines, houses) {
  const pts = [...(lines || []).flat(), ...(houses || []).map((h) => h.pt)];
  if (!pts.length) return null;
  const [s, w, n, e] = boxOf(pts);
  return { south: s, west: w, north: n, east: e };
}

// --- styles -----------------------------------------------------------------------------------------------------

// Highlight layer of the selected street: order 14 draws it above all roads, a white casing separates it from
// roads of similar colour. Same rose as the house markers (app.css).
const HL = { order: 14, minzoom: 0, area: false, stroke: '#e11d48', width: 9, casing: '#ffffff', casingWidth: 13 };
export const LIGHT = { land: LAND_COLOR, style: { ...MAP_STYLE, hl: HL } };

// Dark: the same table with night colours (our own style, not covered by the ODbL).
// Dark style = the light table with fills/strokes replaced per layer; layers without an override keep their light
// colours. Own colours, not OSM's: the ODbL covers the data, not a style.
const darken = {
  landuse: { fill: '#24272c' }, green: { fill: '#1d2e22' }, beach: { fill: '#39342a' }, water: { fill: '#16324a' },
  coastline: { stroke: '#2b5468' }, waterway: { stroke: '#1f4560' }, rail: { stroke: '#7b8088' },
  road_service: { stroke: '#3a3f47', casing: '#2a2e34' }, road_minor: { stroke: '#4b525c', casing: '#30353c' },
  road_major: { stroke: '#77703f', casing: '#4d4930' }, road_trunk: { stroke: '#9a6a34', casing: '#5f4424' },
  path: { stroke: '#6d6355' },
};
export const DARK = {
  land: '#1a1d21',
  style: { ...Object.fromEntries(Object.entries(MAP_STYLE).map(([k, v]) => [k, { ...v, ...(darken[k] || {}) }])), hl: { ...HL, stroke: '#fb7185', casing: '#111317' } },
};

// --- world units (Web Mercator, 0..1 at zoom 0) -------------------------------------------------------------------

// World units: x, y in 0..1 for the whole Mercator square at zoom 0 (tile coordinates at z = 0). Screen pixels =
// world units x 256 x 2^z, so zooming is a single multiplication and panning a subtraction.
export const toWorld = (lat, lng) => [lonToTileX(lng, 0), latToTileY(lat, 0)];
export const fromWorld = (x, y) => ({ lat: tileYToLat(y, 0), lng: tileXToLon(x, 0) });
export const worldScale = (z) => 256 * 2 ** z;
