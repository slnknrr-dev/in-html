// geo/osm.js - OpenStreetMap data for small offline maps: way classification by tags into a closed set of kinds, the
// style table (colours, widths, layer order, minimum zooms), zoom generalisation by size, stroke widths per zoom,
// names in a language order, the building-type mapping, default city boxes of Georgia, and the conversion of an
// Overpass JSON answer ("out geom") into shapes, places and addresses.
//
//   classifyOsmWay(tags) -> kind | null       MAP_STYLE: { kind: { order, minzoom, area, fill, stroke, width, casing, … } }
//   wayName(tags, langs) -> name               shapeMinZoom(kind, bbox)    strokeWidth(base, z)
//   overpassToShapes(json, { langs, bbox }) -> { shapes: [{ kind, name, pts, id }], places, addresses, coastline }
//   mapOsmBuildingType(tags, map) -> { type, unknownTag }      BUILDING_TYPES, CITY_BBOX
//   OSM_ATTRIBUTION
//
// Licence: OSM data is © OpenStreetMap contributors under the ODbL 1.0. Any map or gazetteer built from it must show
// the attribution and, when the derived database is distributed (an embedded dataset is), offer it under the ODbL.
// The style below is our own and not covered by the ODbL.

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors (ODbL)';
export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';

// Version of the style: grows with every change of colours, widths or order (it belongs in tile cache keys).
export const STYLE_VERSION = 1;

export const LAND_COLOR = '#f4f1ea';

/**
 * The style is data, not code. Layer order follows ordinary cartography: land use -> green -> water -> buildings ->
 * rail -> roads (all casings first, then all fills, otherwise the casing of one road cuts the fill of the previous one
 * at every crossing) -> paths -> labels. `width` is the stroke at zoom 16.
 */
export const MAP_STYLE = {
  landuse: { order: 1, minzoom: 12, area: true, fill: '#e8e4dd' },
  green: { order: 2, minzoom: 11, area: true, fill: '#cfe6b4' },
  beach: { order: 3, minzoom: 12, area: true, fill: '#f3e5b5' },
  water: { order: 4, minzoom: 6, area: true, fill: '#a8cfe0' },
  coastline: { order: 5, minzoom: 8, area: false, stroke: '#7fb0c6', width: 1 },
  waterway: { order: 6, minzoom: 12, area: false, stroke: '#a8cfe0', width: 3 },
  building: { order: 7, minzoom: 15, area: true, fill: '#dcd3ca', stroke: '#c6b9ad', width: 0.7 },
  rail: { order: 8, minzoom: 11, area: false, stroke: '#9a9a9a', width: 2, dash: '6 4' },
  road_service: { order: 9, minzoom: 15, area: false, stroke: '#ffffff', width: 3.5, casing: '#dcdad6', casingWidth: 5.5 },
  road_minor: { order: 10, minzoom: 13, area: false, stroke: '#ffffff', width: 6, casing: '#ccc9c4', casingWidth: 8.5, label: true },
  road_major: { order: 11, minzoom: 11, area: false, stroke: '#f8fabf', width: 8, casing: '#c9c78d', casingWidth: 11, label: true },
  road_trunk: { order: 12, minzoom: 9, area: false, stroke: '#fbd6a4', width: 10, casing: '#d9a463', casingWidth: 13, label: true },
  path: { order: 13, minzoom: 15, area: false, stroke: '#bda58f', width: 1.6, dash: '4 3' },
};

export const SHAPE_KINDS = Object.keys(MAP_STYLE);
export const isShapeKind = (k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(MAP_STYLE, k);
export const kindMinZoom = (kind) => MAP_STYLE[kind].minzoom;

/**
 * Zoom from which a particular area is worth drawing: an object makes sense from about 8 screen pixels, so
 * z >= log2(360 * 8 / (256 * size in degrees)). Only for areas: streets are cut into 100-300 m segments in OSM, and
 * hiding short segments would erase half the street grid.
 */
export function shapeMinZoom(kind, box) {
  const base = MAP_STYLE[kind].minzoom;
  if (!MAP_STYLE[kind].area) return base;
  const size = Math.max(box.north - box.south, box.east - box.west);
  if (!(size > 0)) return Math.max(base, 17);
  return Math.max(base, Math.min(19, Math.ceil(Math.log2((360 * 8) / (256 * size)))));
}

// Stroke width at zoom z from the width at 16; 2^0.55 per zoom (2^1 gives roads half a screen wide at 19).
// Geometry doubles per zoom level but strokes should not: growing by 2^0.55 (~1.47x) per level keeps roads readable
// when zoomed out and not absurdly wide when zoomed in. Clamped to [0.25, 48] px, rounded to 0.01 for stable SVG.
export function strokeWidth(base, z) {
  const w = base * 2 ** ((z - 16) * 0.55);
  return Math.max(0.25, Math.min(48, Math.round(w * 100) / 100));
}

// highway=* -> kind. A closed list: an unknown value is not drawn (exotic tagging must not arrive in a random style).
const HIGHWAY = {
  motorway: 'road_trunk', motorway_link: 'road_trunk', trunk: 'road_trunk', trunk_link: 'road_trunk', primary: 'road_trunk', primary_link: 'road_trunk',
  secondary: 'road_major', secondary_link: 'road_major', tertiary: 'road_major', tertiary_link: 'road_major',
  residential: 'road_minor', unclassified: 'road_minor', living_street: 'road_minor', road: 'road_minor',
  service: 'road_service', track: 'road_service',
  footway: 'path', path: 'path', steps: 'path', cycleway: 'path', pedestrian: 'path', bridleway: 'path',
};
const LANDUSE_GREEN = new Set(['forest', 'grass', 'meadow', 'orchard', 'vineyard', 'village_green', 'recreation_ground', 'cemetery', 'allotments', 'plant_nursery']);
const LEISURE_GREEN = new Set(['park', 'garden', 'golf_course', 'pitch', 'playground', 'nature_reserve', 'dog_park']);
const NATURAL_GREEN = new Set(['wood', 'scrub', 'grassland', 'heath', 'wetland']);
const RAILWAY = new Set(['rail', 'light_rail', 'subway', 'tram', 'narrow_gauge', 'funicular']);
const WATERWAY = new Set(['river', 'stream', 'canal', 'ditch', 'drain']);

/**
 * Tags -> kind or null. The order matters: water wins over land use, a building over the land use under it.
 */
// Closed vocabulary on purpose: OSM tagging is open-ended, and drawing unknown values would put arbitrary objects
// into arbitrary styles. Precedence encodes cartographic priority when a way carries several tags.
export function classifyOsmWay(tags) {
  const t = tags || {};
  if (t.natural === 'coastline') return 'coastline';
  if (t.natural === 'water' || t.water || t.landuse === 'reservoir' || t.landuse === 'basin') return 'water';
  if (t.building && t.building !== 'no') return 'building';
  if (t.highway && HIGHWAY[t.highway]) return HIGHWAY[t.highway];
  if (t.railway && RAILWAY.has(t.railway)) return 'rail';
  if (t.waterway && WATERWAY.has(t.waterway)) return 'waterway';
  if (t.natural === 'beach' || t.natural === 'sand') return 'beach';
  if (NATURAL_GREEN.has(t.natural)) return 'green';
  if (t.leisure && LEISURE_GREEN.has(t.leisure)) return 'green';
  if (t.landuse && LANDUSE_GREEN.has(t.landuse)) return 'green';
  if (t.landuse || t.amenity === 'parking') return 'landuse';
  return null;
}

// Name for a label in a language order; names are never machine-translated (no "Sheriff" for Sherif).
export function wayName(tags, langs = ['ru', 'en']) {
  const t = tags || {};
  for (const l of langs) if (t['name:' + l]) return String(t['name:' + l]).trim().slice(0, 80);
  return String(t.name || '').trim().slice(0, 80);
}

// All names of an element: { '': name, ka, en, ru, … } (for gazetteers that search every language).
export function namesOf(tags) {
  const out = {};
  for (const [k, v] of Object.entries(tags || {})) {
    if (k === 'name') out[''] = v;
    else if (/^name:[a-z]{2}$/.test(k)) out[k.slice(5)] = v;
    else if (k === 'old_name' || k === 'alt_name') out[k] = v;
  }
  return out;
}

/**
 * Default boxes [south, west, north, east] of Georgian places for import runs (approximate, meant to be overridden).
 * Gonio and Ureki are villages and Kobuleti a town, but an address reads the same: place -> street -> house.
 */
export const CITY_BBOX = {
  batumi: [41.6, 41.58, 41.7, 41.68],
  kobuleti: [41.78, 41.74, 41.9, 41.82],
  gonio: [41.54, 41.54, 41.6, 41.6],
  ureki: [41.96, 41.74, 42.02, 41.8],
  tbilisi: [41.63, 44.68, 41.83, 45.0],
  kutaisi: [42.22, 42.63, 42.32, 42.76],
  rustavi: [41.5, 44.96, 41.59, 45.07],
  zugdidi: [42.46, 41.81, 42.55, 41.93],
};

// OSM building=* -> a small neutral vocabulary (data, override per project).
export const BUILDING_TYPES = {
  apartments: 'apartments', residential: 'apartments', house: 'house', detached: 'house', semidetached_house: 'house',
  terrace: 'house', bungalow: 'house', villa: 'house', hotel: 'hotel', commercial: 'commercial', retail: 'commercial',
  office: 'office', industrial: 'industrial', warehouse: 'industrial', school: 'education', university: 'education',
  kindergarten: 'education', hospital: 'health', church: 'religious', mosque: 'religious', cathedral: 'religious',
  garage: 'garage', garages: 'garage', shed: 'outbuilding', hut: 'outbuilding', construction: 'construction', public: 'public',
};

/**
 * building=* -> type through a map. An unknown value leaves the type empty and is returned as `unknownTag` for the
 * import report (the map grows from real data, it is not guessed in advance); 'yes' says nothing and is not reported.
 */
export function mapOsmBuildingType(tags, map = BUILDING_TYPES) {
  const v = String((tags || {}).building ?? '').trim().toLowerCase();
  if (!v || v === 'yes') return { type: '', unknownTag: '' };
  const hit = String((map || {})[v] ?? '').trim();
  return hit ? { type: hit, unknownTag: '' } : { type: '', unknownTag: v };
}

// Place nodes worth a label, with a rank for label priority (lower = more important).
const PLACE_RANK = { city: 1, town: 2, suburb: 3, village: 3, quarter: 4, neighbourhood: 5, hamlet: 5, locality: 6, square: 6 };

/**
 * An Overpass JSON answer ("out geom" / "out body geom") -> shapes for the renderer, place labels, house addresses
 * (from nodes and ways with addr:housenumber, at the node or the centre of the way) and the raw coastline pieces.
 * Ways whose kind is unknown are skipped; closed area ways keep their ring. `bbox` drops shapes entirely outside.
 * Multipolygon relations are read from their outer members.
 */
// Overpass may return the same element twice (overlapping queries, recursion): de-duplicated by type + id.
// Multipolygon relations contribute only their outer rings (holes are ignored: a lake inside a park is drawn on
// top by layer order anyway). An address on a way is placed at the vertex average, a cheap centroid stand-in that
// is good enough for label placement on compact buildings.
export function overpassToShapes(json, { langs = ['ru', 'en'], bbox = null } = {}) {
  const shapes = [], places = [], addresses = [], coastline = [];
  const seen = new Set();
  const geomOf = (e) => (e.geometry || []).filter((g) => g && Number.isFinite(g.lat) && Number.isFinite(g.lon)).map((g) => [g.lat, g.lon]);
  const outside = (pts) => bbox && pts.every((p) => p[0] < bbox.south || p[0] > bbox.north || p[1] < bbox.west || p[1] > bbox.east);
  for (const e of (json && json.elements) || []) {
    const key = e.type + e.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const t = e.tags || {};
    if (e.type === 'node') {
      if (t.place && PLACE_RANK[t.place] && t.name) places.push({ id: e.id, kind: t.place, rank: PLACE_RANK[t.place], name: wayName(t, langs), names: namesOf(t), pt: [e.lat, e.lon] });
      if (t['addr:housenumber']) addresses.push({ id: 'n' + e.id, street: t['addr:street'] || '', house: t['addr:housenumber'], city: t['addr:city'] || '', pt: [e.lat, e.lon] });
      continue;
    }
    const kind = classifyOsmWay(t);
    const parts = e.type === 'relation' ? (e.members || []).filter((m) => m.role === 'outer' && m.geometry).map(geomOf) : [geomOf(e)];
    for (const pts of parts) {
      if (pts.length < 2 || outside(pts)) continue;
      if (kind === 'coastline') coastline.push(pts);
      if (kind) shapes.push({ id: e.type[0] + e.id, kind, name: MAP_STYLE[kind].label ? wayName(t, langs) : '', pts });
    }
    if (t['addr:housenumber'] && parts[0]?.length) {
      const p = parts[0];
      const c = [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
      addresses.push({ id: e.type[0] + e.id, street: t['addr:street'] || '', house: t['addr:housenumber'], city: t['addr:city'] || '', pt: c, building: mapOsmBuildingType(t).type });
    }
  }
  return { shapes, places, addresses, coastline };
}
