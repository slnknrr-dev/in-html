// batumi-map/tools/build-data.js - builds the embedded data modules of Batumi Map from a folder of Overpass JSON
// answers (OpenStreetMap, "out geom" / "out center"): the map layers without buildings (data-map.js) and the street
// gazetteer with house numbers (data-gazetteer.js). Vanilla Node, the geo/ library does the OSM work.
//
//   node batumi-map/tools/build-data.js <osm-cache dir> [--date 2026-08-23]
//
// The source folder is only read. Files named batumi-*.json and map-batumi-*.json are used; elements are merged by
// type + id. Lines are simplified with Douglas-Peucker (1 m) and stored as Google polylines (precision 5, ~1.1 m).
// The sea is built once from the coastline for the map box (geo/lines.js coastlineWaterRings).
//
// BM_DEBUG=1 lists the fuzzy street matches of addr:street values (skeleton, case ending, address-only streets).
//
// The output is a derived database of OpenStreetMap: © OpenStreetMap contributors, ODbL 1.0. Both modules carry the
//
// Pipeline: read + dedupe -> map layers (clip, simplify, round) -> streets from named ways -> addresses matched to
// streets through a ladder of increasingly fuzzy lookups -> drop empty streets, renumber alphabetically -> write two
// ES modules as JSON literals. Output size is the constraint that drives every choice: the app is one offline HTML
// file, so 1 m Douglas-Peucker + precision-5 polylines (about 1.1 m grid) trade invisible accuracy for a several-fold
// smaller payload; buildings are left out entirely (they would dominate the size).
// Determinism: files are processed sorted, ids follow sorted names, so the same input yields byte-identical output
// (clean diffs when the data is refreshed).
// notice in their header; the code of this script is under the licence of the repository.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { overpassToShapes, namesOf } from '../../geo/osm.js';
import { simplify, chainWays, coastlineWaterRings, clipToBBox, insideBBox } from '../../geo/lines.js';
import { encodePolyline, encodeLines } from '../../geo/polyline.js';
import { normStreetName, parseHouseNumber, sameStreet, streetType, nearestStreetKey, houseKey } from '../../geo/address.js';
import { fold } from '../../portal/text.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..');
const argv = process.argv.slice(2);
// The positional argument is the first non-flag that is not the value of --date.
const src = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--date');
const dateArg = argv[argv.indexOf('--date') + 1];
if (!src || !fs.existsSync(src)) {
  console.error('usage: node batumi-map/tools/build-data.js <osm-cache dir> [--date YYYY-MM-DD]');
  process.exit(1);
}

// The map box: the city from the airport to Makhinjauri, the hills above it and the coast to Gonio's north edge.
const BOX = { south: 41.575, west: 41.575, north: 41.666, east: 41.715 };
const TOL = 1;          // simplification tolerance, metres
const PREC = 5;         // polyline precision

// --- read -----------------------------------------------------------------------------------------------------

// Overpass answers overlap (several queries over the same area); elements are merged by type+id. The newest
// osm_base timestamp across files becomes the data date shown in the app's attribution.
const files = fs.readdirSync(src).filter((f) => /^(?:map-)?batumi-[\w-]+\.json$/.test(f)).sort();
const seen = new Map();
let stamp = '';
for (const f of files) {
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(src, f), 'utf8')); } catch { console.warn('skipped (not JSON):', f); continue; }
  const ts = j?.osm3s?.timestamp_osm_base || '';
  if (ts > stamp) stamp = ts;
  for (const e of j.elements || []) {
    const k = e.type + e.id;
    const old = seen.get(k);
    // Keep the richest copy (one with geometry wins over a tags-only answer).
    if (!old || (!old.geometry && e.geometry) || (!old.center && !old.geometry && e.center)) seen.set(k, e);
  }
}
const elements = [...seen.values()];
const DATE = dateArg && /^\d{4}-\d\d-\d\d$/.test(dateArg) ? dateArg : stamp.slice(0, 10) || 'unknown';
console.log(`${files.length} files, ${elements.length} unique elements, OSM base ${stamp || '?'}`);

// --- map layers ---------------------------------------------------------------------------------------------------

const { shapes, places, coastline } = overpassToShapes({ elements }, { langs: ['ka'], bbox: BOX });
const KEEP = ['landuse', 'green', 'beach', 'water', 'waterway', 'rail', 'road_service', 'road_minor', 'road_major', 'road_trunk', 'path'];

// Lines are cut to the box (with a margin) so far-away road ends do not count.
// Lines are cut to the box (with a ~400 m margin) so far-away road ends do not count. Areas are kept whole: clipping
// a polygon by a polyline clipper would produce open shapes that fill wrongly.
const CLIP = { south: BOX.south - 0.004, west: BOX.west - 0.004, north: BOX.north + 0.004, east: BOX.east + 0.004 };
// Rounding to 5 decimals here, before encoding, makes the duplicate-vertex filter below exact.
const r5 = (p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5];

// Way id -> tags (for street names in every language).
const tagsOf = new Map(elements.filter((e) => e.type === 'way').map((e) => [e.type[0] + e.id, e.tags || {}]));

// --- streets ------------------------------------------------------------------------------------------------------

const streets = [];           // { ka, en, ru, alt: [], kind, ways: [], houses: Map }
const streetByName = new Map();
const nameOf = (tags) => String(tags.name || tags['name:ka'] || '').trim();
// Streets are keyed by the folded (case/diacritics-insensitive) primary name; one OSM street is usually many ways,
// all mapped to the same id. Script detection by Unicode ranges decides which language slot a bare name fills.
function streetFor(tags) {
  const n = nameOf(tags);
  if (!n) return -1;
  const key = fold(n);
  if (streetByName.has(key)) return streetByName.get(key);
  const nm = namesOf(tags);
  const id = streets.length;
  const ka = /[ა-ჿ]/.test(n) ? n : String(nm.ka || '');
  streets.push({
    ka, en: String(nm.en || (/[a-z]/i.test(n) && !ka ? n : '')), ru: String(nm.ru || (/[а-яё]/i.test(n) && !ka ? n : '')),
    alt: [nm.alt_name, nm.old_name].filter(Boolean).map(String), ways: [], houses: new Map(), pts: [],
  });
  streetByName.set(key, id);
  return id;
}

const layers = {};
const roadStreet = {};
let pointsIn = 0, pointsOut = 0;
// roadStreet[kind][i] is the street id of the i-th line of that layer: the app uses it to highlight a street and to
// label roads, without storing names per line.
for (const s of shapes) {
  if (!KEEP.includes(s.kind)) continue;
  const area = ['landuse', 'green', 'beach', 'water'].includes(s.kind);
  const pieces = area ? [s.pts] : clipToBBox(s.pts, CLIP);
  for (const piece of pieces) {
    if (piece.length < 2) continue;
    pointsIn += piece.length;
    let pts = simplify(piece, TOL).map(r5);
    // Consecutive duplicate points (after rounding) are removed: they add bytes and zero-length segments.
    pts = pts.filter((p, i) => !i || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
    if (pts.length < 2 || (area && pts.length < 4)) continue;
    pointsOut += pts.length;
    (layers[s.kind] ||= []).push(pts);
    if (s.kind.startsWith('road_') || s.kind === 'path') {
      const sid = streetFor(tagsOf.get(s.id) || {});
      (roadStreet[s.kind] ||= []).push(sid);
      if (sid >= 0) streets[sid].ways.push(pts);
    }
  }
}

// The sea from the coastline, closed along the box edge; one ring per piece of sea.
const sea = coastlineWaterRings(chainWays(coastline), BOX).map((r) => simplify(r, TOL).map(r5));
console.log(`coastline pieces ${coastline.length}, sea rings ${sea.length}`);

// --- addresses ----------------------------------------------------------------------------------------------------

const addresses = [];
for (const e of elements) {
  const t = e.tags || {};
  if (!t['addr:housenumber']) continue;
  // Point of an address: node position, else the Overpass center, else the mean of the outline, else the bounds centre.
  let pt = null;
  if (e.type === 'node' && Number.isFinite(e.lat)) pt = [e.lat, e.lon];
  else if (e.center && Number.isFinite(e.center.lat)) pt = [e.center.lat, e.center.lon];
  else if (e.geometry?.length) {
    const g = e.geometry.filter((p) => Number.isFinite(p.lat));
    if (g.length) pt = [g.reduce((a, p) => a + p.lat, 0) / g.length, g.reduce((a, p) => a + p.lon, 0) / g.length];
  } else if (e.bounds) pt = [(e.bounds.minlat + e.bounds.maxlat) / 2, (e.bounds.minlon + e.bounds.maxlon) / 2];
  if (!pt || !insideBBox(pt, BOX)) continue;
  const street = String(t['addr:street'] || t['addr:place'] || '').trim();
  if (!street) continue;
  addresses.push({ street, streetEn: String(t['addr:street:en'] || '').trim(), house: String(t['addr:housenumber']).trim(), pt: r5(pt) });
}

// Street lookups: exact folded names in every language, then keys without generic words, then the cross-script
// skeleton (nearest street of that name wins), then a Georgian case-inflected key.
const exact = new Map(), byKey = new Map();
const addLookup = (m, k, id) => { if (!k) return; if (!m.has(k)) m.set(k, []); if (!m.get(k).includes(id)) m.get(k).push(id); };
streets.forEach((s, id) => {
  for (const n of [s.ka, s.en, s.ru, ...s.alt]) { addLookup(exact, fold(n), id); addLookup(byKey, normStreetName(n), id); }
});
// Of several streets with one name, the one with a line nearest to the address.
// Manhattan distance in degrees is enough to rank candidates for the same name (all within one city).
function nearestOf(ids, pt) {
  let best = ids[0], bd = Infinity;
  for (const id of ids) {
    let d = Infinity;
    for (const w of streets[id].ways) for (const p of w) d = Math.min(d, Math.abs(p[0] - pt[0]) + Math.abs(p[1] - pt[1]));
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}
// Georgian keys whose words all agree up to a case ending ('ადლიის' ~ 'ადლიას'); nearestStreetKey alone matched
// "X 3rd dead end" with "X 1st lane" (half of the words), so every word and the street type must agree here.
const kaKeys = [...byKey.keys()].filter((k) => /[ა-ჿ]/.test(k));
const kaStem = (w) => w.replace(/(ის|ას|ეს|ოს|ს)$/u, '');
const wordsAlike = (a, b) => a === b || (/[ა-ჿ]/.test(a) && kaStem(a).length >= 3 && kaStem(a) === kaStem(b));
function caseKey(raw) {
  const want = normStreetName(raw).split(' ');
  const t = streetType(raw);
  const k = nearestStreetKey(kaKeys, raw);
  if (!k) return '';
  const have = k.split(' ');
  if (have.length !== want.length || !want.every((w, i) => wordsAlike(w, have[i]))) return '';
  return (byKey.get(k) || []).some((id) => { const st = streetType(streets[id].ka); return !t || !st || t === st; }) ? k : '';
}
const stat = { exact: 0, key: 0, skeleton: 0, nearest: 0, own: 0 };
const ownStreets = new Map();
const matchCache = new Map();
// Ladder: exact name -> generic-word-free key (same street type required) -> cross-script skeleton -> Georgian case
// ending -> a new geometry-less street. Results are cached per (street, street:en) text because thousands of
// addresses repeat the same street string; the nearest-of-several choice still runs per address.
function matchStreet(a) {
  const ck = a.street + '\u0000' + a.streetEn;
  if (matchCache.has(ck)) { const v = matchCache.get(ck); return v.length > 1 ? [nearestOf(v, a.pt), 'cached'] : [v[0], 'cached']; }
  let ids = exact.get(fold(a.street)) || (a.streetEn && exact.get(fold(a.streetEn))), how = 'exact';
  if (!ids) {
    const k = normStreetName(a.street);
    const cand = (byKey.get(k) || []).filter((id) => { const t = streetType(a.street); const st = streetType(streets[id].ka || streets[id].en || streets[id].ru); return !t || !st || t === st; });
    if (cand.length) { ids = cand; how = 'key'; }
  }
  if (!ids) {
    const cand = [];
    streets.forEach((s, id) => { if ([s.ka, s.en, s.ru].some((n) => n && sameStreet(a.street, n, { anyOrder: true }))) cand.push(id); });
    if (cand.length) { ids = cand; how = 'skeleton'; }
  }
  if (!ids && /[ა-ჿ]/.test(a.street)) {
    const k = caseKey(a.street);
    if (k) { ids = byKey.get(k); how = 'nearest'; }
  }
  if (!ids) {
    // A street that exists only in addresses (no named way in the data): keep it, without geometry.
    const fk = fold(a.street);
    if (!ownStreets.has(fk)) {
      const n = a.street;
      ownStreets.set(fk, streets.length);
      streets.push({ ka: /[ა-ჿ]/.test(n) ? n : '', en: /[ა-ჿа-яё]/i.test(n) ? a.streetEn : n, ru: /[а-яё]/i.test(n) ? n : '', alt: [], ways: [], houses: new Map(), pts: [] });
    }
    ids = [ownStreets.get(fk)]; how = 'own';
  }
  matchCache.set(ck, ids);
  stat[how]++;
  if (process.env.BM_DEBUG && (how === 'nearest' || how === 'own' || how === 'skeleton')) console.log(how, a.street, '->', how === 'own' ? '' : streets[ids[0]].ka || streets[ids[0]].en);
  return [ids.length > 1 ? nearestOf(ids, a.pt) : ids[0], how];
}

let dupes = 0;
for (const a of addresses) {
  const [id] = matchStreet(a);
  const s = streets[id];
  const n = parseHouseNumber(a.house);
  // One address per (street, house number) key; the first wins, later duplicates (node + building) are counted.
  const hk = houseKey('', n);
  if (s.houses.has(hk)) { dupes++; continue; }
  // Labels are capped at 24 characters: a stray long value must not bloat the '|'-joined string.
  s.houses.set(hk, { label: a.house.replace(/\s+/g, ' ').slice(0, 24), pt: a.pt });
}
console.log(`addresses ${addresses.length} (duplicates ${dupes}); street match`, stat);

// --- order, filter, write -----------------------------------------------------------------------------------------

// Streets with neither geometry nor houses are dropped; ids are re-numbered in Georgian alphabetical order.
const keep = streets.map((s, id) => ({ s, id })).filter(({ s }) => s.ways.length || s.houses.size);
const sortName = (s) => s.ka || s.en || s.ru;
keep.sort((a, b) => sortName(a.s).localeCompare(sortName(b.s), 'ka'));
const newId = new Map(keep.map(({ id }, i) => [id, i]));

// KNOWN DEFECT: centre() is never called; the gazetteer row below has 5 fields, while batumi-map/common.js reads the
// street point from r[5] (the header text below promises it too). Every street's centre is therefore null: the map
// page's nearestAddress() skips all streets (a map click never names the nearest address) and the street CSV export
// has empty lat/lng. Fix: append encodePolyline([centre(s, hs)], PREC) as the sixth field of each row and rebuild.
// The point of a street shown for it: the vertex of its lines nearest to their mean (on the street, also for a bent
// one), else the mean of its houses.
function centre(s, hs) {
  const pts = s.ways.length ? s.ways.flat() : hs.map((h) => h.pt);
  const m = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
  if (!s.ways.length) return r5(m);
  let best = pts[0], bd = Infinity;
  for (const p of pts) { const d = (p[0] - m[0]) ** 2 + (p[1] - m[1]) ** 2; if (d < bd) { bd = d; best = p; } }
  return best;
}
const houseNum = (label) => { const m = String(label).match(/\d+/); return m ? +m[0] : 1e9; };
const gaz = keep.map(({ s }) => {
  const hs = [...s.houses.values()].sort((a, b) => houseNum(a.label) - houseNum(b.label) || a.label.localeCompare(b.label));
  // '|' inside a label would break the join, so it is replaced by '/', which house numbers use anyway (36/38).
  return [s.ka, s.en, s.ru, hs.map((h) => h.label.replace(/\|/g, '/')).join('|'), encodePolyline(hs.map((h) => h.pt), PREC)];
});

const roadIds = {};
for (const [k, list] of Object.entries(roadStreet)) roadIds[k] = list.map((id) => (id >= 0 && newId.has(id) ? newId.get(id) : -1));

const placeList = places.filter((p) => insideBBox(p.pt, BOX)).map((p) => [p.names[''] || p.name, p.names.en || '', p.names.ru || '', p.rank, ...r5(p.pt)]);

// The licence notice is written into both generated files: ODbL requires attribution to travel with the data.
const NOTICE = (what) => `// batumi-map/${what} - GENERATED by batumi-map/tools/build-data.js from OpenStreetMap data (Overpass, OSM base
// ${stamp || DATE}). Do not edit by hand: rebuild with \`node batumi-map/tools/build-data.js <osm-cache dir>\`.
//
// DATA LICENCE: this file is a derived database of OpenStreetMap. © OpenStreetMap contributors. It is made available
// under the Open Database Licence 1.0 (ODbL, https://opendatacommons.org/licenses/odbl/1-0/); see
// https://www.openstreetmap.org/copyright. Any rights in individual contents of the database are licensed under the
// Database Contents Licence. Keep this notice when you copy or adapt the data. The application code is not covered.
`;

const js = (v) => JSON.stringify(v);
const order = ['landuse', 'green', 'beach', 'water', 'waterway', 'rail', 'road_service', 'road_minor', 'road_major', 'road_trunk', 'path'];
let map = NOTICE('data-map.js') + `
// Layers: kind -> polylines (precision ${PREC}) separated by spaces; ROAD_STREETS: kind -> street id of every line
// (an index into STREETS of data-gazetteer.js, -1 unnamed); SEA: water rings from the coastline; PLACES: [name, en,
// ru, rank, lat, lng].
export const MAP_DATE = ${js(DATE)};
export const MAP_BBOX = ${js([BOX.south, BOX.west, BOX.north, BOX.east])};
export const SEA = ${js(encodeLines(sea, PREC))};
export const LAYERS = {
${order.filter((k) => layers[k]).map((k) => `  ${k}: ${js(encodeLines(layers[k], PREC))},`).join('\n')}
};
export const ROAD_STREETS = {
${Object.keys(roadIds).map((k) => `  ${k}: ${js(roadIds[k])},`).join('\n')}
};
export const PLACES = ${js(placeList)};
`;
let gz = NOTICE('data-gazetteer.js') + `
// STREETS: [name ka, name en, name ru, house numbers separated by '|', house points as one polyline (precision ${PREC},
// in the order of the numbers), the street's own point as a polyline of one point]. Street ids are the indexes (Georgian alphabetical order).
export const GAZETTEER_DATE = ${js(DATE)};
export const STREETS = [
${gaz.map((r) => '  ' + js(r) + ',').join('\n')}
];
`;
fs.writeFileSync(path.join(OUT, 'data-map.js'), map);
fs.writeFileSync(path.join(OUT, 'data-gazetteer.js'), gz);

const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(1) + ' KB';
console.log(`points ${pointsIn} -> ${pointsOut}`);
for (const k of order) if (layers[k]) console.log(`  ${k.padEnd(13)} ${String(layers[k].length).padStart(6)} lines ${kb(encodeLines(layers[k], PREC))}`);
console.log(`streets ${gaz.length} (with geometry ${keep.filter(({ s }) => s.ways.length).length}), houses ${gaz.reduce((n, r) => n + (r[3] ? r[3].split('|').length : 0), 0)}`);
console.log(`data-map.js ${kb(map)}, data-gazetteer.js ${kb(gz)}, total ${kb(map + gz)}`);
