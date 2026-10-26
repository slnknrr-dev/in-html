// geo/test.js - unit tests of the geo library: `node geo/test.js` (importing the module runs nothing).
// Distances against reference values (haversine, Vincenty on WGS 84), bearings and compass names, destination and
// interpolation, boxes; coordinate parsing in every style and formatting back; Web Mercator and tiles; polyline
// round trips with the Google reference string; clipping, simplification, way chaining, rings and the coastline ->
// sea rule (ported from the portal); OSM classification and styles; the tile and view SVG renderers on a real piece
// of Batumi (geo/fixture.js, ODbL); label placement; routes with precedence and trip sheets (retail API included);
// the place tree with cycles and orphans, paths, selections, gazetteer search; house numbers, korpus twins, street
// keys across scripts, locative phrases and free-text addresses.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bboxAround, bboxContains, bboxIntersects, bboxOf, bboxUnion, bearing, compass, crossTrack, destination, distance,
  finalBearing, haversine, interpolate, midpoint, pathLength, polygonArea, vincenty, wrapLng,
} from './sphere.js';
import { formatLatLng, geoUri, osmUrl, parseAngle, parseLatLng, toDMS } from './coords.js';
import {
  fitBBox, fromMeters, fromQuadkey, latToTileY, lonToTileX, metersPerPixel, quadkey, tileBBox, tileCoordOk, tileOf,
  tileProjector, tileUrl, tileXToLon, tileYToLat, tilesInBBox, toMeters, viewOf,
} from './mercator.js';
import { decodeLines, decodePolyline, decodePts, encodeLines, encodePolyline, encodePts } from './polyline.js';
import {
  boundaryWalk, chainWays, clipRingToBBox, clipSegment, clipToBBox, coastlineWaterRings, lineMidpoint, perimeterT,
  pointInRing, ringCentroid, ringSignedArea, simplify, simplifyRadial,
} from './lines.js';
import { CITY_BBOX, MAP_STYLE, classifyOsmWay, isShapeKind, kindMinZoom, mapOsmBuildingType, namesOf, overpassToShapes, shapeMinZoom, strokeWidth, wayName } from './osm.js';
import { featuresToShapes, labelAngle, labelCellKey, pathD, placeLabels, renderMapSvg, renderTileSvg } from './render.js';
import { distanceMatrix, improveRoute, nearestNeighbour, orderByDistance, planRoute, respects, routeKm, routeLength, tripSheet } from './route.js';
import {
  GEO_KINDS, canNest, gazetteer, geoAncestors, geoBreadcrumbs, geoHref, geoIndex, geoIsWithin, geoLevel, geoLoc, geoName,
  geoPathLabel, geoPathSlugs, geoResolvePath, geoSlug, geoTreeOrder, isGeoKind, normalizeSelection, searchPlaces,
  selectionIds, selectionIsSet, selectionWithin, sortGeo, wouldCycle,
} from './tree.js';
import {
  addressText, houseKey, houseNumberText, korpusTwinSpellings, nearestStreetKey, normStreetName, parseAddress,
  parseHouseNumber, sameStreet, streetKeyIndex, streetLocGuess, streetSkeleton, streetType, streetVariants,
} from './address.js';
import { FIXTURE, FIXTURE_BBOX } from './fixture.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

// Geometry is tested against known values (published distances, round trips through projections and encodings)
// and against the real OSM fixture, so the whole pipeline (Overpass JSON -> shapes -> SVG) runs offline.
export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const near = (name, got, want, eps = 1e-6) => {
    if (typeof got === 'number' && Math.abs(got - want) <= eps) pass++;
    else { fail++; console.log(`FAIL ${name}: got ${got}, want ${want} ± ${eps}`); }
  };
  const ok = (name, cond) => eq(name, !!cond, true);
  const BATUMI = { lat: 41.6516, lng: 41.6367 }, TBILISI = { lat: 41.7151, lng: 44.8271 };

  // --- sphere -----------------------------------------------------------------------------------------------------
  near('haversine Batumi-Tbilisi', haversine(BATUMI, TBILISI) / 1000, 264.6, 0.5);
  near('haversine degree', haversine([0, 0], [0, 1]), 111195, 1);
  near('haversine same', haversine(BATUMI, BATUMI), 0);
  // Vincenty reference: Flinders Peak -> Buninyong (Vincenty 1975): 54 972.271 m, 306°52′05.37″.
  const fp = { lat: -(37 + 57 / 60 + 3.7203 / 3600), lng: 144 + 25 / 60 + 29.5244 / 3600 };
  const bu = { lat: -(37 + 39 / 60 + 10.1561 / 3600), lng: 143 + 55 / 60 + 35.3839 / 3600 };
  const v = vincenty(fp, bu);
  near('vincenty distance', v.distance, 54972.271, 0.01);
  near('vincenty initial', v.initial, 306 + 52 / 60 + 5.37 / 3600, 1e-5);
  // The reference gives the reverse azimuth 127°10′25.07″; the bearing of travel on arrival is 180° more.
  near('vincenty final', v.final, 307 + 10 / 60 + 25.07 / 3600, 1e-5);
  near('distance ellipsoid', distance(BATUMI, TBILISI, { ellipsoid: true }) / 1000, 265.71, 0.05);
  eq('vincenty antipodal fallback', Number.isFinite(distance({ lat: 0, lng: 0 }, { lat: 0.5, lng: 179.7 }, { ellipsoid: true })), true);
  near('bearing east', bearing([0, 0], [0, 1]), 90);
  near('bearing north', bearing([0, 0], [1, 0]), 0);
  near('final bearing', finalBearing([0, 0], [0, 1]), 90);
  eq('compass', [compass(0), compass(44), compass(91, { lang: 'ru' }), compass(225, { points: 16 }), compass(200, { words: true, lang: 'ka' }), compass(NaN)], ['N', 'NE', 'В', 'SW', 'სამხრეთი', '']);
  const d = destination(BATUMI, 90, 1000);
  near('destination back', haversine(BATUMI, d), 1000, 1e-6);
  near('destination bearing', bearing(BATUMI, d), 90, 0.01);
  const mid = midpoint(BATUMI, TBILISI);
  near('midpoint equidistant', haversine(BATUMI, mid) - haversine(mid, TBILISI), 0, 1e-6);
  near('interpolate 0', haversine(interpolate(BATUMI, TBILISI, 0), BATUMI), 0, 1e-6);
  near('cross track', crossTrack({ lat: 0.001, lng: 0.5 }, [0, 0], [0, 1]), -111.2, 0.5);
  near('path length', pathLength([[0, 0], [0, 1], null, [0, 2]]), 2 * 111195, 2);
  near('polygon area 1x1 deg at equator', polygonArea([[0, 0], [0, 1], [1, 1], [1, 0]]) / 1e9, 12.36, 0.05);
  eq('wrapLng', [wrapLng(190), wrapLng(-190), wrapLng(180)], [-170, 170, -180]);
  eq('bboxOf', bboxOf([[1, 2], { lat: 3, lng: 0 }, null]), { south: 1, west: 0, north: 3, east: 2 });
  eq('bboxOf empty', bboxOf([]), null);
  const ba = bboxAround(BATUMI, 1000);
  ok('bboxAround', bboxContains(ba, destination(BATUMI, 45, 900)) && !bboxContains(ba, destination(BATUMI, 0, 1100)));
  eq('bbox ops', [bboxIntersects({ south: 0, west: 0, north: 1, east: 1 }, { south: 0.5, west: 0.5, north: 2, east: 2 }), bboxIntersects({ south: 0, west: 0, north: 1, east: 1 }, { south: 2, west: 2, north: 3, east: 3 }), bboxUnion({ south: 0, west: 0, north: 1, east: 1 }, null, { south: -1, west: 2, north: 0, east: 3 })], [true, false, { south: -1, west: 0, north: 1, east: 3 }]);

  // --- coordinates ------------------------------------------------------------------------------------------------
  const P = (s, o) => { const r = parseLatLng(s, o); return r && [Math.round(r.lat * 1e5) / 1e5, Math.round(r.lng * 1e5) / 1e5]; };
  eq('decimal pairs', ['41.7151, 44.8271', '41,7151 44,8271', '41,7151; 44,8271', '41.7151 44.8271', '(41.7151, 44.8271)', '-33.86, 151.2'].map((s) => P(s)), [[41.7151, 44.8271], [41.7151, 44.8271], [41.7151, 44.8271], [41.7151, 44.8271], [41.7151, 44.8271], [-33.86, 151.2]]);
  eq('lnglat order', P('44.8271, 41.7151', { order: 'lnglat' }), [41.7151, 44.8271]);
  eq('dms', ["41°39'06\"N 41°38'12\"E", '41°39′05.8″N, 41°38′12.1″E', '41 39 06 N 41 38 12 E', 'N 41 39.1 E 41 38.2', '33 52 S 151 12 E', "41°39'06\" с.ш. 41°38'12\" в.д.", 'ჩ 41.65 ა 41.63', '41.6 E 41.7 N', 'С 41 39 В 41 38'].map((s) => P(s)),
    [[41.65167, 41.63667], [41.65161, 41.63669], [41.65167, 41.63667], [41.65167, 41.63667], [-33.86667, 151.2], [41.65167, 41.63667], [41.65, 41.63], [41.7, 41.6], [41.65, 41.63333]]);
  eq('links', ['geo:41.6516,41.6367?z=17', 'https://www.openstreetmap.org/#map=17/41.65160/41.63670', 'https://www.openstreetmap.org/?mlat=41.6516&mlon=41.6367', 'https://www.google.com/maps/@41.6516,41.6367,15z', 'https://maps.google.com/?q=41.6516,41.6367'].map((s) => P(s)), Array(5).fill([41.6516, 41.6367]));
  eq('rejected pairs', ['', null, 'abc', '91, 10', '10, 181', '41 N 42 N', "41°61' N 41 E"].map((s) => parseLatLng(s)), [null, null, null, null, null, null, null]);
  near('angle', parseAngle("41°39'06\"N"), 41.651666667, 1e-8);
  near('angle west', parseAngle('W 3° 30′'), -3.5, 1e-12);
  ok('angle garbage', Number.isNaN(parseAngle('north')));
  eq('toDMS carry', toDMS(41.99999999), { sign: 1, d: 42, m: 0, s: 0 });
  eq('format', [formatLatLng(BATUMI), formatLatLng(BATUMI, { format: 'dms' }), formatLatLng({ lat: -33.86, lng: 151.2 }, { format: 'ddm', lang: 'ru' }), formatLatLng({ lat: 100, lng: 0 })],
    ['41.651600, 41.636700', '41°39′05.8″N 41°38′12.1″E', '33°51.600′ ю. ш. 151°12.000′ в. д.', '']);
  eq('format round trip', P(formatLatLng(BATUMI, { format: 'dms' })), [41.65161, 41.63669]);
  eq('uris', [geoUri(BATUMI), osmUrl([41.65, 41.63], 16)], ['geo:41.651600,41.636700', 'https://www.openstreetmap.org/?mlat=41.650000&mlon=41.630000#map=16/41.650000/41.630000']);

  // --- mercator (ported) ------------------------------------------------------------------------------------------
  near('x of 0', lonToTileX(0, 1), 1); near('y of 0', latToTileY(0, 1), 1); near('x of -180', lonToTileX(-180, 5), 0);
  near('lon round trip', tileXToLon(lonToTileX(41.6367, 14), 14), 41.6367, 1e-9);
  near('lat round trip', tileYToLat(latToTileY(41.6516, 14), 14), 41.6516, 1e-9);
  ok('poles clamp', Number.isFinite(latToTileY(90, 10)) && Number.isFinite(latToTileY(-90, 10)));
  const tb = tileBBox(14, 10307, 6291), tp = tileBBox(14, 10307, 6291, 64);
  ok('tile bbox', tb.north > tb.south && tb.east > tb.west && tp.north > tb.north && tp.south < tb.south && tp.west < tb.west && tp.east > tb.east);
  const c = tileProjector(14, 10307, 6291, 256)((tb.north + tb.south) / 2, (tb.west + tb.east) / 2);
  ok('projector centre', Math.abs(c[0] - 128) < 1.5 && Math.abs(c[1] - 128) < 1.5);
  eq('tile of Batumi', tileOf(41.6516, 41.6367, 14), [10086, 6103]);
  eq('tile coords', [tileCoordOk(0, 0, 0), tileCoordOk(1, 2, 0), tileCoordOk(20, 0, 0), tileCoordOk(1.5, 0, 0)], [true, false, false, false]);
  const m = toMeters(BATUMI);
  near('meters x', m[0], 4634976.24, 0.01); near('meters round trip', fromMeters(m).lat, BATUMI.lat, 1e-9);
  near('m per px z0', metersPerPixel(0, 0), 156543.03392804097, 1e-6);
  const tbox = { south: 41.64, west: 41.62, north: 41.66, east: 41.65 }, tiles = tilesInBBox(tbox, 14), tkey = new Set(tiles.map((t) => t.join()));
  ok('tiles in bbox', [[41.64, 41.62], [41.64, 41.65], [41.66, 41.62], [41.66, 41.65]].every(([la, lo]) => tkey.has(tileOf(la, lo, 14).join())) && tiles.every(([x, y]) => { const b = tileBBox(14, x, y); return b.south <= tbox.north && b.north >= tbox.south && b.west <= tbox.east && b.east >= tbox.west; }));
  eq('quadkey', [quadkey(3, 3, 5), fromQuadkey('213')], ['213', { z: 3, x: 3, y: 5 }]);
  eq('tile url', tileUrl('https://{s}.t/{z}/{x}/{y}.png?{q}', 3, 3, 5), 'https://c.t/3/3/5.png?213');
  const fit = fitBBox(FIXTURE_BBOX, 800, 600, { fractional: true });
  const [x0, y0] = fit.project(FIXTURE_BBOX.north, FIXTURE_BBOX.west), [x1, y1] = fit.project(FIXTURE_BBOX.south, FIXTURE_BBOX.east);
  ok('fit inside', x0 >= 15.9 && y0 >= 15.9 && x1 <= 784.1 && y1 <= 584.1 && (Math.abs(x0 - 16) < 0.01 || Math.abs(y0 - 16) < 0.01));
  const vw = viewOf(BATUMI, 15, 400, 300);
  eq('view centre', vw.project(BATUMI.lat, BATUMI.lng).map((x) => Math.round(x)), [200, 150]);
  near('view unproject', vw.unproject(200, 150).lng, BATUMI.lng, 1e-9);

  // --- polyline ---------------------------------------------------------------------------------------------------
  // The reference example of Google's documentation.
  const ref = [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]];
  eq('polyline encode', encodePolyline(ref), '_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  eq('polyline decode', decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), ref);
  eq('polyline precision 6', decodePolyline(encodePolyline([[41.651612, 41.636734]], 6), 6), [[41.651612, 41.636734]]);
  let seed = 11;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const line = Array.from({ length: 200 }, () => [+(rnd() * 170 - 85).toFixed(5), +(rnd() * 360 - 180).toFixed(5)]);
  eq('polyline random', decodePolyline(encodePolyline(line)), line);
  eq('polyline broken', decodePolyline('_p~iF~ps|U_ulL'), [[38.5, -120.2]]);
  eq('lines', decodeLines(encodeLines([ref, ref.slice(1)])), [ref, ref.slice(1)]);
  eq('pts round trip', decodePts(encodePts([[41.6516, 41.6367], [41.6402, 41.6229]])), [[41.6516, 41.6367], [41.6402, 41.6229]]);
  eq('pts garbage', [decodePts('41.6,41.6 broken 41.7,41.7 ,5'), decodePts('')], [[[41.6, 41.6], [41.7, 41.7]], []]);

  // --- lines (ported coastline rule + own) ------------------------------------------------------------------------
  const BOX = { south: 0, west: 0, north: 1, east: 1 };
  eq('clip segment', [clipSegment([0.5, -1], [0.5, 2], BOX), clipSegment([2, 2], [3, 3], BOX)], [[[0.5, 0], [0.5, 1]], null]);
  const runs = clipToBBox([[0.5, -1], [0.5, 0.5], [0.5, 2]], BOX);
  eq('clip runs', [runs.length, runs[0][0], runs[0][runs[0].length - 1]], [1, [0.5, 0], [0.5, 1]]);
  eq('clip ring', clipRingToBBox([[-1, -1], [-1, 2], [0.5, 2], [0.5, -1], [-1, -1]], BOX).length >= 4, true);
  near('clip ring area', Math.abs(ringSignedArea(clipRingToBBox([[-1, -1], [-1, 2], [0.5, 2], [0.5, -1], [-1, -1]], BOX))), 0.5, 1e-12);
  eq('chain', chainWays([[[0, 0], [0, 1]], [[0, 1], [0, 2]], [[5, 5], [5, 6]]]), [[[0, 0], [0, 1], [0, 2]], [[5, 5], [5, 6]]]);
  eq('chain order-free (Batumi case)', chainWays([[[0, 1], [0, 2]], [[0, 2], [0, 3]], [[0, 0], [0, 1]]]), [[[0, 0], [0, 1], [0, 2], [0, 3]]]);
  const ring = [[0, 0], [0, 1], [1, 1], [0, 0]];
  eq('chain ring', chainWays([ring]), [ring]);
  eq('chain reverse', chainWays([[[0, 0], [0, 1]], [[0, 2], [0, 1]]], { reverse: true }), [[[0, 0], [0, 1], [0, 2]]]);
  const ccw = [[0, 0], [0, 1], [1, 1], [1, 0]];
  ok('ring orientation', ringSignedArea(ccw) > 0 && ringSignedArea(ccw.slice().reverse()) < 0);
  eq('perimeter', [perimeterT([0, 0], BOX), perimeterT([0, 1], BOX), perimeterT([1, 1], BOX), perimeterT([1, 0], BOX)], [0, 1, 2, 3]);
  eq('boundary walk', [boundaryWalk(0.5, 2.5, BOX, true), boundaryWalk(0.5, 2.5, BOX, false)], [[[0, 1], [1, 1]], [[0, 0], [1, 0]]]);
  const west = coastlineWaterRings([[[2, 0.5], [0.5, 0.5], [-1, 0.5]]], BOX);
  eq('coast north->south: water west', [west.length, ringSignedArea(west[0]) < 0, Math.min(...west[0].map((p) => p[1])), Math.max(...west[0].map((p) => p[1]))], [1, true, 0, 0.5]);
  const east = coastlineWaterRings([[[-1, 0.5], [0.5, 0.5], [2, 0.5]]], BOX);
  eq('coast reversed: water east', [Math.min(...east[0].map((p) => p[1])), Math.max(...east[0].map((p) => p[1]))], [0.5, 1]);
  const two = coastlineWaterRings([[[0.4, -1], [0.4, 2]], [[0.6, 2], [0.6, -1]]], BOX);
  const lats = two.map((r) => r.reduce((s, p) => s + p[0], 0) / r.length).sort((a, b) => a - b);
  eq('coast two entries', [two.length, two.every((r) => ringSignedArea(r) < 0), lats[0] < 0.4, lats[1] > 0.6], [2, true, true, true]);
  eq('coast ambiguous skipped', [coastlineWaterRings([[[0.2, 0.2], [0.2, 0.8], [0.8, 0.8], [0.2, 0.2]]], BOX), coastlineWaterRings([[[-1, 0.5], [0.5, 0.5]]], BOX), coastlineWaterRings([[[5, 5], [6, 6]]], BOX)], [[], [], []]);
  near('line midpoint by length', lineMidpoint([[0, 0], [0, 0.1], [0, 1]])[1], 0.5, 1e-9);
  eq('point in ring', [pointInRing([0.5, 0.5], ccw), pointInRing([1.5, 0.5], ccw), pointInRing([0.5, 0.5], [ccw, [[0.4, 0.4], [0.4, 0.6], [0.6, 0.6], [0.6, 0.4]]])], [true, false, false]);
  eq('centroid', ringCentroid([[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]]), [1, 1]);
  // Douglas-Peucker: a straight line with jitter below tolerance keeps its ends only; a corner is kept.
  const straight = Array.from({ length: 50 }, (_, i) => [41.65 + i * 1e-5, 41.63 + (i % 2) * 1e-7]);
  eq('simplify straight', simplify(straight, 1).length, 2);
  eq('simplify corner', simplify([[41.65, 41.63], [41.651, 41.63], [41.651005, 41.631], [41.651, 41.632]], 2), [[41.65, 41.63], [41.651, 41.63], [41.651, 41.632]]);
  eq('simplify keeps ends', (() => { const s = simplify(line, 1e5); return [s[0], s[s.length - 1]]; })(), [line[0], line[line.length - 1]]);
  eq('simplify radial', simplifyRadial([[0, 0], [0, 1e-6], [0, 2e-6], [0, 1]], 1).length, 2);

  // --- osm (ported) -----------------------------------------------------------------------------------------------
  eq('classify', [classifyOsmWay({ natural: 'water', landuse: 'residential' }), classifyOsmWay({ building: 'yes', landuse: 'residential' }), classifyOsmWay({ building: 'no' }), classifyOsmWay({ highway: 'residential' }), classifyOsmWay({ highway: 'primary' }), classifyOsmWay({ highway: 'proposed' }), classifyOsmWay({ leisure: 'park' }), classifyOsmWay({ natural: 'beach' }), classifyOsmWay({}), classifyOsmWay(null)],
    ['water', 'building', null, 'road_minor', 'road_trunk', null, 'green', 'beach', null, null]);
  eq('way name', [wayName({ 'name:ru': 'Руставели', 'name:en': 'Rustaveli', name: 'რუსთაველი' }), wayName({ 'name:en': 'Rustaveli', name: 'რუსთაველი' }), wayName({ name: 'რუსთაველი' }), wayName({}), wayName({ 'name:ru': 'Р', 'name:ka': 'რ' }, ['ka'])], ['Руставели', 'Rustaveli', 'რუსთაველი', '', 'რ']);
  eq('names of', namesOf({ name: 'a', 'name:ru': 'b', 'name:zh-Hans': 'x', alt_name: 'c' }), { '': 'a', ru: 'b', alt_name: 'c' });
  ok('minzoom order', kindMinZoom('water') < kindMinZoom('road_minor') && kindMinZoom('road_minor') < kindMinZoom('building'));
  ok('kinds', Object.keys(MAP_STYLE).every(isShapeKind) && !isShapeKind('teleport'));
  const sea = { south: 41.5, west: 41.5, north: 41.8, east: 41.8 }, pond = { south: 41.6, west: 41.6, north: 41.6008, east: 41.6008 };
  ok('generalisation', shapeMinZoom('water', sea) < shapeMinZoom('water', pond) && shapeMinZoom('water', sea) === kindMinZoom('water') && shapeMinZoom('road_minor', pond) === kindMinZoom('road_minor'));
  ok('stroke width', strokeWidth(6, 16) === 6 && strokeWidth(6, 18) > 6 && strokeWidth(6, 12) < 6 && strokeWidth(6, 0) >= 0.25 && strokeWidth(6, 22) <= 48);
  eq('building types', [mapOsmBuildingType({ building: 'apartments' }), mapOsmBuildingType({ building: 'HOUSE' }).type, mapOsmBuildingType({ building: 'kiosk' }), mapOsmBuildingType({ building: 'yes' }), mapOsmBuildingType(null, null), mapOsmBuildingType({ building: 'x' }, { x: 'mine' }).type],
    [{ type: 'apartments', unknownTag: '' }, 'house', { type: '', unknownTag: 'kiosk' }, { type: '', unknownTag: '' }, { type: '', unknownTag: '' }, 'mine']);
  eq('city boxes', Object.values(CITY_BBOX).every((b) => b[0] < b[2] && b[1] < b[3]), true);
  const osm = overpassToShapes(FIXTURE, { langs: ['ru', 'en'] });
  eq('overpass shapes', [osm.shapes.length, osm.shapes.filter((s) => s.kind === 'building').length > 5, osm.addresses.length >= 8, osm.shapes.some((s) => s.name === 'улица Шота Руставели')], [FIXTURE.elements.length, true, true, true]);
  eq('overpass dedupe + nodes', overpassToShapes({ elements: [...FIXTURE.elements.slice(0, 2), FIXTURE.elements[0], { type: 'node', id: 1, lat: 41.65, lon: 41.63, tags: { place: 'city', name: 'ბათუმი', 'name:en': 'Batumi' } }, { type: 'node', id: 2, lat: 41.65, lon: 41.63, tags: { 'addr:housenumber': '5', 'addr:street': 'X' } }] }, { langs: ['en'] }),
    { shapes: overpassToShapes({ elements: FIXTURE.elements.slice(0, 2) }, { langs: ['en'] }).shapes, places: [{ id: 1, kind: 'city', rank: 1, name: 'Batumi', names: { '': 'ბათუმი', en: 'Batumi' }, pt: [41.65, 41.63] }], addresses: [...overpassToShapes({ elements: FIXTURE.elements.slice(0, 2) }, { langs: ['en'] }).addresses, { id: 'n2', street: 'X', house: '5', city: '', pt: [41.65, 41.63] }], coastline: [] });
  eq('overpass relation', overpassToShapes({ elements: [{ type: 'relation', id: 9, tags: { natural: 'water' }, members: [{ role: 'outer', geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }, { lat: 0, lon: 0 }] }, { role: 'inner', geometry: [{ lat: 0.1, lon: 0.1 }] }] }] }).shapes.map((s) => [s.id, s.kind, s.pts.length]), [['r9', 'water', 4]]);

  // --- render (ported tile tests + view) ----------------------------------------------------------------------------
  eq('label angle', [labelAngle([0, 0], [10, 0]), labelAngle([0, 0], [10, 10]), labelAngle([0, 0], [-10, -10]), Math.abs(labelAngle([0, 0], [0, 100]))], [0, 45, 45, 90]);
  const k1 = labelCellKey('Абашидзе', [41.651, 41.636]), k2 = labelCellKey('Абашидзе', [41.6511, 41.6361]), k3 = labelCellKey('Абашидзе', [41.656, 41.641]);
  ok('label cells', k1 === k2 && k1 !== k3 && k1 !== labelCellKey('Пушкина', [41.651, 41.636]));
  eq('path d', [pathD([[0, 0], [0.1, 0.1], [0.2, 0.2], [50, 50]], false), pathD([[0, 0]], false), pathD([[0, 0], [10, 0], [10, 10]], true).endsWith('Z')], ['M0 0L50 50', '', true]);
  {
    const z = 17, x = lonToTileX(41.6367, z) | 0, y = latToTileY(41.6516, z) | 0;
    const b = tileBBox(z, x, y);
    const mid2 = [(b.north + b.south) / 2, (b.west + b.east) / 2];
    const svg = renderTileSvg([
      { kind: 'building', pts: [[b.south, b.west], mid2, [b.north, b.east], [b.south, b.west]] },
      { kind: 'road_minor', name: 'Руставели', pts: [[b.south, b.west], [b.north, b.east]] },
    ], { z, x, y });
    ok('tile svg', svg.startsWith('<svg xmlns=') && svg.includes('#f4f1ea') && svg.includes('Руставели') && svg.indexOf(MAP_STYLE.road_minor.casing) < svg.indexOf('stroke="' + MAP_STYLE.road_minor.stroke));
    const esc = renderTileSvg([{ kind: 'road_minor', name: '<script>&"', pts: [[b.south, b.west], [b.north, b.east]] }], { z, x, y });
    ok('tile escapes', !esc.includes('<script>') && esc.includes('&lt;script&gt;&amp;&quot;'));
    const z12 = 12, x12 = lonToTileX(41.6367, z12) | 0, y12 = latToTileY(41.6516, z12) | 0, b12 = tileBBox(z12, x12, y12);
    const low = renderTileSvg([{ kind: 'building', pts: [[b12.south, b12.west], [b12.north, b12.east], [b12.south, b12.east], [b12.south, b12.west]] }, { kind: 'road_minor', name: 'Руставели', pts: [[b12.south, b12.west], [b12.north, b12.east]] }], { z: z12, x: x12, y: y12 });
    ok('tile low zoom', !low.includes(MAP_STYLE.building.fill) && !low.includes('Руставели'));
    ok('tile garbage kind', renderTileSvg([{ kind: 'teleport', pts: [[41, 41], [42, 42]] }], { z: 16, x: 1, y: 1 }).startsWith('<svg'));
  }
  const map = renderMapSvg(osm.shapes, { width: 800, height: 600, bbox: FIXTURE_BBOX, markers: [{ lat: (FIXTURE_BBOX.south + FIXTURE_BBOX.north) / 2, lng: (FIXTURE_BBOX.west + FIXTURE_BBOX.east) / 2, label: 'Europe Square', text: '1' }], route: [[FIXTURE_BBOX.south + 0.0003, FIXTURE_BBOX.west + 0.0003], [FIXTURE_BBOX.north - 0.0003, FIXTURE_BBOX.east - 0.0003]], title: 'Batumi' });
  ok('view svg', map.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"') && map.svg.endsWith('</svg>') && map.svg.includes('OpenStreetMap contributors') && map.svg.includes('<title>Batumi</title>'));
  ok('view zoom', map.view.zoom > 16 && map.view.zoom < 19);
  ok('view labels', map.labels.some((l) => l.text === 'Europe Square') && map.labels.some((l) => /Руставели|Абашидзе|Гамсахурдия|Бараташвили|Думбадзе/.test(l.text)));
  ok('view street label once per spacing', map.labels.filter((l) => l.text === 'улица Шота Руставели').length <= 3);
  ok('view balanced tags', (map.svg.match(/<g[ >]/g) || []).length === (map.svg.match(/<\/g>/g) || []).length && (map.svg.match(/<text/g) || []).length === (map.svg.match(/<\/text>/g) || []).length);
  ok('view no attribution', !renderMapSvg(osm.shapes, { bbox: FIXTURE_BBOX, attribution: false }).svg.includes('OpenStreetMap'));
  const gj = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[41.63, 41.65], [41.64, 41.66]] }, properties: { kind: 'road_major', name: 'A' } }, { type: 'Feature', geometry: { type: 'Point', coordinates: [41.63, 41.65] }, properties: { name: 'P' } }, { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[41.63, 41.65], [41.64, 41.65], [41.64, 41.66], [41.63, 41.65]]] }, properties: { kind: 'water' } }] };
  eq('features to shapes', featuresToShapes(gj).map((s) => [s.kind, s.pts?.[0] || s.pt]), [['road_major', [41.65, 41.63]], ['point', [41.65, 41.63]], ['water', [41.65, 41.63]]]);
  ok('geojson view', renderMapSvg(gj, { width: 300, height: 200 }).svg.includes(MAP_STYLE.water.fill));
  const coastView = renderMapSvg([], { width: 200, height: 200, bbox: { south: 0, west: 0, north: 1, east: 1 }, coastline: [[[2, 0.5], [0.5, 0.5], [-1, 0.5]]] });
  ok('view coastline water', coastView.svg.includes(MAP_STYLE.water.fill));
  const placed = placeLabels([{ text: 'A', x: 50, y: 50, angle: 0, w: 40, h: 12, priority: 1 }, { text: 'B', x: 55, y: 52, angle: 0, w: 40, h: 12, priority: 2 }, { text: 'C', x: 150, y: 50, angle: 90, w: 40, h: 12, priority: 2 }, { text: 'D', x: 3, y: 50, angle: 0, w: 40, h: 12 }, { text: 'A', x: 120, y: 120, angle: 0, w: 40, h: 12, priority: 1 }]);
  eq('placement', placed.map((p) => p.text), ['A', 'C']);
  ok('rotated boxes do not collide', placeLabels([{ text: 'X', x: 50, y: 50, angle: 90, w: 60, h: 10 }, { text: 'Y', x: 70, y: 50, angle: 90, w: 60, h: 10 }]).length === 2);

  // --- routes -----------------------------------------------------------------------------------------------------
  // Five points on a line, given shuffled: the order must walk along it.
  const lineStops = [0, 3, 1, 4, 2].map((k) => ({ id: 'p' + k, lat: 41.6, lng: 41.6 + k * 0.01 }));
  const plan = planRoute(lineStops);
  eq('plan line', plan.order.map((i) => lineStops[i].id), ['p0', 'p1', 'p2', 'p3', 'p4']);
  near('plan km', plan.km, 3.3, 0.05);
  eq('plan legs', plan.legs.length, 4);
  // Pickup before delivery: p4 must precede p1 (index 3 before index 2).
  const pd = planRoute(lineStops, { before: [[3, 2]] });
  eq('precedence kept', [pd.valid, pd.order.indexOf(3) < pd.order.indexOf(2), pd.order[0]], [true, true, 0]);
  const closedPlan = planRoute(lineStops, { closed: true });
  near('closed route', closedPlan.km, 6.7, 0.1);
  const endPlan = planRoute(lineStops, { start: 2, end: 0 });
  eq('fixed start and end', [lineStops[endPlan.order[0]].id, lineStops[endPlan.order[4]].id], ['p1', 'p0']);
  const withMissing = planRoute([{ lat: 41.6, lng: 41.6 }, { name: 'no coords' }, { lat: 41.6, lng: 41.61 }]);
  eq('missing coords last', withMissing.order, [0, 2, 1]);
  eq('missing start first', planRoute([{ name: 'depot' }, { lat: 41.6, lng: 41.62 }, { lat: 41.6, lng: 41.61 }, { lat: 41.6, lng: 41.63 }]).order, [0, 1, 2, 3]);
  eq('empty plan', planRoute([]), { order: [], km: 0, legs: [], valid: true });
  // 2-opt untangles a crossing on a square.
  const sq = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 }, { lat: 1, lng: 0 }];
  const dsq = distanceMatrix(sq);
  const better = improveRoute([0, 2, 1, 3], dsq, { closed: true });
  ok('2-opt', routeLength(better, dsq, true) < routeLength([0, 2, 1, 3], dsq, true) - 1);
  eq('nn precedence', nearestNeighbour(dsq, { start: 0, before: [[2, 1]] }), [0, 3, 2, 1]);
  eq('respects', [respects([0, 1, 2], [[0, 2]]), respects([2, 1, 0], [[0, 2]])], [true, false]);
  // Random instances: improvement never worsens and constraints always hold.
  for (let t = 0; t < 20; t++) {
    const pts = Array.from({ length: 9 }, () => ({ lat: 41.6 + rnd() * 0.1, lng: 41.6 + rnd() * 0.1 }));
    const before = [[1 + (t % 4), 5 + (t % 4)], [2, 8]];
    const dm = distanceMatrix(pts);
    const nn = nearestNeighbour(dm, { before });
    const im = improveRoute(nn, dm, { before });
    if (!(routeLength(im, dm) <= routeLength(nn, dm) + 1e-6 && respects(im, before) && im[0] === 0 && new Set(im).size === 9)) { fail++; console.log('FAIL random route ' + t); } else pass++;
  }
  const sheet = tripSheet(lineStops, plan.order, { start: '08:30', speedKmh: 30, serviceMin: 10, roadFactor: 1 });
  eq('trip sheet', [sheet.rows.length, sheet.rows[0].arrive, sheet.rows[0].depart, sheet.rows[1].legKm, sheet.km, sheet.rows[4].serviceMin], [5, '08:30', '08:30', 0.8, 3.3, 10]);
  eq('trip sheet times', [sheet.rows[1].arrive, sheet.end, sheet.minutes], ['08:32', '09:17', 47]);
  eq('trip sheet closed', tripSheet(lineStops, plan.order, { closed: true, roadFactor: 1 }).rows.length, 6);
  // Retail API.
  eq('routeKm', routeKm([{ lat: 41.6, lng: 41.6 }, null, { lat: 41.6, lng: 41.61 }]), 0.8);
  const coords = { A: { lat: 41.6, lng: 41.6 }, B: { lat: 41.6, lng: 41.7 }, C: { lat: 41.6, lng: 41.61 }, D: null };
  eq('retail order', orderByDistance(['A', 'B', 'C', 'D'], [], (id) => coords[id]), ['A', 'C', 'B', 'D']);
  // Sender before receiver: C receives from B, so B comes first despite being farther.
  eq('retail sender first', orderByDistance(['A', 'B', 'C'], [{ from_object: 'B', to_object: 'C' }], (id) => coords[id]), ['A', 'B', 'C']);
  eq('retail short', orderByDistance(['A', 'B'], [], (id) => coords[id]), ['A', 'B']);

  // --- tree (ported) ----------------------------------------------------------------------------------------------
  const GE = { id: 1, kind: 'country', parentId: null, name: { ru: 'Грузия', en: 'Georgia', ka: 'საქართველო' }, slug: 'georgia' };
  const AJ = { id: 2, kind: 'region', parentId: 1, name: { ru: 'Аджария', en: 'Adjara' }, slug: 'adjara' };
  const BAT = { id: 3, kind: 'city', parentId: 2, name: { ru: 'Батуми', en: 'Batumi', ka: 'ბათუმი', ru_in: 'в Батуми' }, slug: 'batumi' };
  const RUST = { id: 4, kind: 'street', parentId: 3, name: { ru: 'проспект Руставели', ka: 'რუსთაველის გამზირი' }, slug: 'rustaveli' };
  const TBI = { id: 5, kind: 'city', parentId: 1, name: { ru: 'Тбилиси', en: 'Tbilisi' }, slug: 'tbilisi' };
  const ORPHAN = { id: 6, kind: 'city', parentId: 999, name: { ru: 'Сирота' } };
  const H65 = { id: 7, kind: 'building', parentId: 4, name: { ru: '65' }, slug: '65' };
  const KOB = { id: 8, kind: 'city', parentId: 2, name: { ru: 'Кобулети', en: 'Kobuleti' }, slug: 'kobuleti' };
  const RUST2 = { id: 9, kind: 'street', parentId: 5, name: { ru: 'проспект Руставели' }, slug: 'rustaveli' };
  const ALL = [GE, AJ, BAT, RUST, TBI, ORPHAN, H65, KOB, RUST2];
  const IDX = geoIndex(ALL);
  eq('kinds', [GEO_KINDS, geoLevel('country'), geoLevel('building'), geoLevel('district'), isGeoKind('region'), isGeoKind('district')], [['country', 'region', 'city', 'street', 'building'], 0, 4, -1, true, false]);
  eq('nesting', [canNest('city', 'region'), canNest('city', 'country'), canNest('building', 'street'), canNest('country', null), canNest('city', ''), canNest('city', 'city'), canNest('region', 'city'), canNest('city', 'district'), canNest('village', 'country')], [true, true, true, true, true, false, false, false, false]);
  eq('ancestors', [geoAncestors(7, IDX).map((n) => n.id), geoBreadcrumbs(4, IDX).map((n) => n.id), geoAncestors(1, IDX), geoBreadcrumbs(777, IDX), geoAncestors(6, IDX), geoBreadcrumbs(6, IDX).map((n) => n.id)], [[1, 2, 3, 4], [1, 2, 3, 4], [], [], [], [6]]);
  const looped = new Map(IDX);
  looped.set(1, { ...GE, parentId: 3 });
  eq('cycle stops', geoAncestors(4, looped).map((n) => n.id), [1, 2, 3]);
  eq('within', [geoIsWithin(3, 2, IDX), geoIsWithin(3, 1, IDX), geoIsWithin(5, 1, IDX), geoIsWithin(3, 3, IDX), geoIsWithin(5, 2, IDX), geoIsWithin(1, 3, IDX), geoIsWithin(0, 1, IDX)], [true, true, true, true, false, false, false]);
  eq('would cycle', [wouldCycle(1, 3, IDX), wouldCycle(2, 2, IDX), wouldCycle(5, 2, IDX), wouldCycle(3, 0, IDX)], [true, true, false, false]);
  eq('names', [geoName(BAT, 'en'), geoName(BAT, 'ka'), geoName(TBI, 'ka'), geoName(RUST, 'en'), geoName({ id: 9, name: { ka: 'ქუთაისი' } }, 'en'), geoName({ id: 9, name: {} }), geoName({ id: 9, name: { ru_in: 'в X' } }), geoName(null)], ['Batumi', 'ბათუმი', 'Tbilisi', 'проспект Руставели', 'ქუთაისი', '#9', '#9', '']);
  eq('locative', [geoLoc(BAT, 'ru'), geoLoc(BAT, 'en')], ['в Батуми', '']);
  eq('path label', [geoPathLabel(3, IDX, 'ru'), geoPathLabel(3, IDX, 'en'), geoPathLabel(5, IDX, 'ru', ' / ')], ['Грузия · Аджария · Батуми', 'Georgia · Adjara · Batumi', 'Грузия / Тбилиси']);
  const src = [RUST, TBI, GE, BAT, AJ];
  const before = src.slice();
  eq('sort', [sortGeo(src, 'ru').map((n) => n.id), src], [[1, 2, 3, 5, 4], before]);
  const tree = geoTreeOrder([RUST, TBI, GE, BAT, AJ], 'ru');
  eq('tree order', [tree.map((x) => x.node.id), tree.map((x) => x.depth)], [[1, 2, 3, 4, 5], [0, 1, 2, 3, 1]]);
  const full = geoTreeOrder(ALL, 'ru');
  eq('orphan kept', [full.length, full.find((x) => x.node.id === 6).depth], [ALL.length, 0]);
  eq('mutual cycle kept', geoTreeOrder([{ id: 10, kind: 'city', parentId: 11, name: { ru: 'А' } }, { id: 11, kind: 'city', parentId: 10, name: { ru: 'Б' } }]).length, 2);
  eq('slugs', [geoSlug('რუსთაველის გამზირი'), geoSlug('Шерифа Химшиашвили'), geoSlug('')], ['rustavelis-gamziri', 'sherifa-khimshiashvili', 'x']);
  eq('path slugs', [geoPathSlugs(7, IDX), geoPathSlugs(2, IDX), geoHref(4, IDX, '/map'), geoHref(6, IDX)], [['georgia', 'batumi', 'rustaveli', '65'], ['georgia'], '/map/georgia/batumi/rustaveli', '']);
  const res = geoResolvePath(['georgia', 'tbilisi', 'rustaveli'], ALL);
  eq('resolve', [res.node.id, res.depth, geoResolvePath(['georgia', 'batumi', 'rustaveli'], ALL).node.id, geoResolvePath(['georgia', 'nowhere'], ALL), geoResolvePath([], ALL)], [9, 3, 4, null, null]);
  eq('selection parse', [normalizeSelection(3), normalizeSelection('3'), normalizeSelection('{"include":[2],"exclude":[3,3,"x"]}'), normalizeSelection([1, -2, 'a']), normalizeSelection('garbage{'), normalizeSelection('')], [{ include: [3], exclude: [] }, { include: [3], exclude: [] }, { include: [2], exclude: [3] }, { include: [1], exclude: [] }, { include: [], exclude: [] }, { include: [], exclude: [] }]);
  const sel = { include: [2], exclude: [3] };
  eq('selection', [selectionWithin(8, sel, IDX), selectionWithin(3, sel, IDX), selectionWithin(4, sel, IDX), selectionWithin(5, sel, IDX), selectionWithin(5, { include: [], exclude: [3] }, IDX), selectionIds(sel, IDX).sort(), selectionIsSet({ include: [], exclude: [] })], [true, false, false, false, true, [8], false]);
  const gz = gazetteer(ALL);
  const hit = (q, o) => searchPlaces(gz, q, o).map((r) => r.node.id);
  eq('gazetteer', [hit('Батуми')[0], hit('batum')[0], hit('ბათუმი')[0], hit('Руставели').sort(), hit('Руставели Тбилиси')[0], hit('rustaveli batumi')[0], hit('Руставели', { kinds: ['city'] }), hit(''), hit('zzz')], [3, 3, 3, [4, 9], 9, 4, [], [], []]);
  eq('gazetteer path', searchPlaces(gz, 'Кобулети', { lang: 'en' })[0].path, 'Georgia · Adjara · Kobuleti');

  // --- addresses (ported) -----------------------------------------------------------------------------------------
  const hn = (s) => { const n = parseHouseNumber(s); return [n.house, n.korpus, n.fraction]; };
  eq('house plain', hn('65'), ['65', '', '']);
  eq('house letter forms are one house', ['65б', '65 б', '  65   б  ', '65-б'].map(hn), Array(4).fill(['65', 'б', '']));
  eq('house scripts', ['65a', '65а', '65ა', '65Б', '37 G'].map(hn), [['65', 'a', ''], ['65', 'а', ''], ['65', 'ა', ''], ['65', 'б', ''], ['37', 'g', '']]);
  eq('house fractions', ['65/1', '65б/1', '65 \\ 1', '18/34'].map(hn), [['65', '', '1'], ['65', 'б', '1'], ['65', '', '1'], ['18', '', '34']]);
  eq('house korpus', ['65 к2', '65к2', '65 корп. 2', '65 корпус 2', '65, кор 2', '65 bldg 2', '12 კორპ. 2', '5 block 2'].map((s) => hn(s).slice(0, 2)), Array(8).fill(null).map((_, i) => [['65', '65', '65', '65', '65', '65', '12', '5'][i], '2']));
  eq('house letter k', hn('65к'), ['65', 'к', '']);
  eq('house zeros', [parseHouseNumber('065').house, parseHouseNumber('65/01').fraction], ['65', '1']);
  eq('house empty and odd', [parseHouseNumber('').house, parseHouseNumber(null).house, parseHouseNumber('дом у моря').house, parseHouseNumber('дом у моря').raw], ['', '', 'дом у моря', 'дом у моря']);
  eq('house range', hn('1-3'), ['1', '', '3']);
  eq('house key', houseKey('rustaveli', parseHouseNumber('65 б')) === houseKey('rustaveli', parseHouseNumber('65б')), true);
  eq('house text', [houseNumberText({ house: '65', fraction: '1', korpus: '2' }), houseNumberText({ house: '65', korpus: '2' }, 'en'), houseNumberText({ house: '65', korpus: '2' }, 'ka'), houseNumberText({ korpus: '2' })], ['65/1 к2', '65 bldg 2', '65 კორპ. 2', '']);
  for (const s of ['65', '65/1', '65 к2', '65/1 к2', '65б']) { const n = parseHouseNumber(s); eq('house text round trip ' + s, hn(houseNumberText(n)), hn(s)); }
  eq('address text', [addressText({ city: 'Батуми', street: 'Шерифа Химшиашвили', house: '65', korpus: '2', flat: '44' }), addressText({ street: 'Rustaveli Ave', house: '65', flat: '4' }, { lang: 'en' }), addressText({ city: 'Батуми', street: 'X', flat: '1' }, { city: false, flat: false })], ['Батуми, Шерифа Химшиашвили, 65 к2, кв. 44', 'Rustaveli Ave, 65, apt 4', 'X']);
  eq('korpus twins', [korpusTwinSpellings('б'), korpusTwinSpellings('ბ'), korpusTwinSpellings('b'), korpusTwinSpellings('в'), korpusTwinSpellings('c'), korpusTwinSpellings('Б'), korpusTwinSpellings('Ა'), korpusTwinSpellings('2а'), korpusTwinSpellings('2'), korpusTwinSpellings('й'), korpusTwinSpellings('аb')], [['ბ', 'b'], ['б', 'b'], ['б', 'ბ'], ['გ', 'c'], ['в', 'გ'], ['ბ', 'b'], ['а', 'a'], ['2ა', '2a'], [], [], []]);
  eq('korpus ё', korpusTwinSpellings('ё'), korpusTwinSpellings('е'));
  const kk = normStreetName('Шериф Химшиашвили');
  eq('street keys', [normStreetName('ул. Шериф Химшиашвили'), normStreetName('Шериф Химшиашвили улица'), normStreetName('  ШЕРИФ   ХИМШИАШВИЛИ ')], [kk, kk, kk]);
  eq('street keys en', normStreetName('Sherif Khimshiashvili St.'), normStreetName('Sherif Khimshiashvili street'));
  ok('street order', normStreetName('Ленина Горького') !== normStreetName('Горького Ленина'));
  eq('street generic only', [normStreetName('улица'), normStreetName('')], ['улица', '']);
  eq('street types', [streetType('ул. Ленина'), streetType('Adlia 3rd Dead End'), streetType('ზღვისპირის შესახვევი'), streetType('რუსთაველის გამზ.'), streetType('Ленина')], ['street', 'dead_end', 'lane', 'avenue', '']);
  eq('skeleton', [streetSkeleton('რუსთაველის გამზირი'), streetSkeleton('проспект Руставели'), streetSkeleton('Rustaveli Avenue')], [['rustavel'], ['rustaveli'], ['rustaveli']]);
  eq('same street', [sameStreet('რუსთაველის გამზირი', 'проспект Руставели'), sameStreet('Шерифа Химшиашвили улица', 'შერიფ ხიმშიაშვილის ქუჩა'), sameStreet('Sherif Khimshiashvili Street', 'ул. Шерифа Химшиашвили'), sameStreet('X Street', 'X Lane'), sameStreet('Ленина', 'Горького'), sameStreet('ლორთქიფანიძე გრიგოლის ქ.', 'Grigol Lortkipanidze Street'), sameStreet('ლორთქიფანიძე გრიგოლის ქ.', 'Grigol Lortkipanidze Street', { anyOrder: true })], [true, true, true, false, false, false, true]);
  eq('variants', [streetVariants('რუსთაველის გამზირი'), streetVariants('улица Руставели'), streetVariants('Rustaveli')], [{ ka: 'რუსთაველის გამზირი', lat: 'rustavelis gamziri', ru: 'руставэлис гамзири' }, { ru: 'улица Руставели', lat: 'ulitsa rustaveli' }, { lat: 'Rustaveli' }]);
  const sidx = streetKeyIndex([{ id: 1, kind: 'street', name: { ka: 'ადლიას ქუჩა' } }, { id: 2, kind: 'street', name: { ka: 'ანა კალანდაძის ქუჩა', en: 'Ana Kalandadze Street' } }, { id: 3, kind: 'city', name: { ka: 'ბათუმი' } }]);
  eq('street index', [[...sidx.byKey.entries()], [...sidx.hasKa]], [[['ადლიას', 1], ['ana kalandadze', 2], ['ანა კალანდაძის', 2]], [1, 2]]);
  const keys = [...sidx.byKey.keys()];
  eq('nearest street', [nearestStreetKey(keys, 'ადლიის ქუჩა'), nearestStreetKey(keys, 'ანა კალანდაძეს ქუჩა'), nearestStreetKey(keys, 'მაჭახლის ქუჩა'), nearestStreetKey(keys, '')], ['ადლიას', 'ანა კალანდაძის', '', '']);
  // The real fixture: an addr:street in another case finds its street.
  const fixStreets = [...new Set(FIXTURE.elements.filter((e) => e.tags.highway).map((e) => normStreetName(e.tags.name)))];
  eq('fixture case mismatch', nearestStreetKey(fixStreets, 'მემედ აბაშიძეს ქუჩა'), 'მემედ აბაშიძის');
  eq('loc ru', [streetLocGuess('улица Руставели'), streetLocGuess('переулок Тбилисский'), streetLocGuess('Бульвар'), streetLocGuess('площадь Свободы'), streetLocGuess('3-й тупик Адлиа'), streetLocGuess('1-й переулок Ангиса'), streetLocGuess('1-я улица Мира'), streetLocGuess('улица 26 Мая')],
    ['на улице Руставели', 'в переулке Тбилисский', 'на бульваре', 'на площади Свободы', 'в 3-м тупике Адлиа', 'в 1-м переулке Ангиса', 'на 1-й улице Мира', 'на улице 26 Мая']);
  eq('loc closed dictionary', [streetLocGuess('Шерифа Химшиашвили'), streetLocGuess('Old Runway 05/23', 'en'), streetLocGuess(''), streetLocGuess('   ')], ['', '', '', '']);
  eq('loc ka', [streetLocGuess('რუსთაველის ქუჩა', 'ka'), streetLocGuess('ადლიის მე-3 ჩიხი', 'ka'), streetLocGuess('ზღვისპირის შესახვევი', 'ka'), streetLocGuess('უცნობი სიტყვა', 'ka')], ['რუსთაველის ქუჩაზე', 'ადლიის მე-3 ჩიხში', 'ზღვისპირის შესახვევში', '']);
  eq('loc en', [streetLocGuess('Adlia Street', 'en'), streetLocGuess('Adlia 3rd Dead End', 'en'), streetLocGuess('Zhiuli Shartava Avenue', 'en')], ['on Adlia Street', 'in Adlia 3rd Dead End', 'on Zhiuli Shartava Avenue']);
  const pa = (s, o) => { const r = parseAddress(s, o); return [r.city, r.street, r.house, r.korpus, r.fraction, r.flat]; };
  eq('free text', [pa('Batumi, Rustaveli Ave 65b, apt 4'), pa('г. Батуми, ул. Руставели, д. 65 к2, кв. 4'), pa('ბათუმი, რუსთაველის გამზ. 12, ბ. 3'), pa('Руставели 12/3'), pa('Batumi, Gorgiladze 45'), pa('ბათუმი, ბაგრატიონის 5'), pa('Batumi', { cities: ['batumi'] })],
    [['Batumi', 'Rustaveli Ave', '65', 'b', '', '4'], ['Батуми', 'ул. Руставели', '65', '2', '', '4'], ['ბათუმი', 'რუსთაველის გამზ.', '12', '', '', '3'], ['', 'Руставели', '12', '', '3', ''], ['Batumi', 'Gorgiladze', '45', '', '', ''], ['ბათუმი', 'ბაგრატიონის', '5', '', '', ''], ['Batumi', '', '', '', '', '']]);

  console.log(`geo: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
