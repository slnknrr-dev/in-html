// geo/sphere.js - distances and directions on the Earth: haversine on a sphere of the mean radius, Vincenty's inverse
// formula on the WGS 84 ellipsoid (millimetre accuracy, falls back to haversine for nearly antipodal points), initial
// and final bearings with compass names in English, Russian and Georgian, destination point, midpoint and great-circle
// interpolation, cross-track distance, path length, spherical polygon area, and bounding boxes.
//
// A point is { lat, lng } (or { lat, lon }, or [lat, lng]); distances are in metres, angles in degrees.
//
//   haversine(a, b) -> m           vincenty(a, b) -> { distance, initial, final } | null (no convergence)
//   distance(a, b, { ellipsoid }) -> m
//   bearing(a, b) -> 0..360        compass(deg, { points: 8 | 16, lang }) -> 'NE' / 'СВ' / 'ჩა'
//   destination(a, bearing, m) -> { lat, lng }    midpoint(a, b)    interpolate(a, b, f)
//   crossTrack(p, a, b) -> m (signed: + right of a -> b)      pathLength(points) -> m
//   polygonArea(ring) -> m²         bboxOf(points) -> { south, west, north, east } | null
//   bboxAround(p, m) / bboxContains / bboxIntersects / bboxUnion / bboxCenter / bboxPad

export const EARTH_RADIUS = 6371008.8;          // mean radius (IUGG), m
export const WGS84 = { a: 6378137, f: 1 / 298.257223563 };

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

// [lat, lng] of any accepted point form; null for garbage.
export function latLng(p) {
  if (!p) return null;
  const lat = Array.isArray(p) ? p[0] : p.lat;
  const lng = Array.isArray(p) ? p[1] : p.lng ?? p.lon;
  return Number.isFinite(+lat) && Number.isFinite(+lng) && lat !== null && lng !== null ? [+lat, +lng] : null;
}

// Longitude into [-180, 180).
export const wrapLng = (lng) => ((((lng + 180) % 360) + 360) % 360) - 180;
const wrap360 = (d) => ((d % 360) + 360) % 360;

// Haversine rather than the spherical law of cosines: acos(cos x) loses all precision for small distances (cos of
// a few metres is 1 - 1e-13), while sin^2 of half-angles stays well conditioned. min(1, ...) guards asin against
// rounding just above 1 for antipodal points.
export function haversine(a, b, radius = EARTH_RADIUS) {
  const p = latLng(a), q = latLng(b);
  if (!p || !q) return NaN;
  const dLat = (q[0] - p[0]) * RAD, dLng = (q[1] - p[1]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p[0] * RAD) * Math.cos(q[0] * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Vincenty's inverse formula on WGS 84: { distance (m), initial, final (degrees) }; null when it does not converge
 * (nearly antipodal points) - distance() then uses haversine.
 */
// Iterates lambda (longitude on the auxiliary sphere) to a fixed point, then applies the series for the geodesic
// length. Works on reduced latitudes U = atan((1-f) tan lat). Known to oscillate for nearly antipodal points,
// hence the iteration cap and null so the caller falls back. cosSqAlpha = 0 means an equatorial line (cos2Sm := 0).
export function vincenty(a, b, { a: A = WGS84.a, f = WGS84.f } = {}) {
  const p = latLng(a), q = latLng(b);
  if (!p || !q) return null;
  const B = A * (1 - f);
  const L = (q[1] - p[1]) * RAD;
  const U1 = Math.atan((1 - f) * Math.tan(p[0] * RAD)), U2 = Math.atan((1 - f) * Math.tan(q[0] * RAD));
  const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1), sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);
  let lambda = L, prev, sinS, cosS, sigma, cosSqAlpha, cos2Sm, sinL, cosL;
  for (let i = 0; i < 200; i++) {
    sinL = Math.sin(lambda); cosL = Math.cos(lambda);
    sinS = Math.sqrt((cosU2 * sinL) ** 2 + (cosU1 * sinU2 - sinU1 * cosU2 * cosL) ** 2);
    if (sinS === 0) return { distance: 0, initial: 0, final: 0 };
    cosS = sinU1 * sinU2 + cosU1 * cosU2 * cosL;
    sigma = Math.atan2(sinS, cosS);
    const sinAlpha = (cosU1 * cosU2 * sinL) / sinS;
    cosSqAlpha = 1 - sinAlpha ** 2;
    cos2Sm = cosSqAlpha ? cosS - (2 * sinU1 * sinU2) / cosSqAlpha : 0;
    const C = (f / 16) * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha));
    prev = lambda;
    lambda = L + (1 - C) * f * sinAlpha * (sigma + C * sinS * (cos2Sm + C * cosS * (-1 + 2 * cos2Sm ** 2)));
    if (Math.abs(lambda - prev) < 1e-12) {
      const uSq = (cosSqAlpha * (A * A - B * B)) / (B * B);
      const k1 = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
      const k2 = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
      const dS = k2 * sinS * (cos2Sm + (k2 / 4) * (cosS * (-1 + 2 * cos2Sm ** 2) - (k2 / 6) * cos2Sm * (-3 + 4 * sinS ** 2) * (-3 + 4 * cos2Sm ** 2)));
      const distance = B * k1 * (sigma - dS);
      const initial = wrap360(Math.atan2(cosU2 * sinL, cosU1 * sinU2 - sinU1 * cosU2 * cosL) * DEG);
      const final = wrap360(Math.atan2(cosU1 * sinL, -sinU1 * cosU2 + cosU1 * sinU2 * cosL) * DEG);
      return { distance, initial, final };
    }
  }
  return null;
}

// Metres between two points: haversine (default, 0.3 % error) or the ellipsoid ({ ellipsoid: true }).
export function distance(a, b, { ellipsoid = false } = {}) {
  if (ellipsoid) { const v = vincenty(a, b); if (v) return v.distance; }
  return haversine(a, b);
}

// Initial great-circle bearing from a to b, degrees clockwise from north.
export function bearing(a, b) {
  const p = latLng(a), q = latLng(b);
  if (!p || !q) return NaN;
  const f1 = p[0] * RAD, f2 = q[0] * RAD, dl = (q[1] - p[1]) * RAD;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return wrap360(Math.atan2(y, x) * DEG);
}

// Bearing on arrival at b.
// Arrival bearing = reverse of the initial bearing from b to a: great-circle bearings change along the way, so the
// final bearing differs from the initial one except on meridians and the equator.
export const finalBearing = (a, b) => wrap360(bearing(b, a) + 180);

const COMPASS = {
  en: ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'],
  ru: ['С', 'ССВ', 'СВ', 'ВСВ', 'В', 'ВЮВ', 'ЮВ', 'ЮЮВ', 'Ю', 'ЮЮЗ', 'ЮЗ', 'ЗЮЗ', 'З', 'ЗСЗ', 'СЗ', 'ССЗ'],
  // ჩ(რდილოეთი) north, ს(ამხრეთი) south, ა(ღმოსავლეთი) east, დ(ასავლეთი) west
  ka: ['ჩ', 'ჩჩა', 'ჩა', 'აჩა', 'ა', 'ასა', 'სა', 'სსა', 'ს', 'სსდ', 'სდ', 'დსდ', 'დ', 'დჩდ', 'ჩდ', 'ჩჩდ'],
};
const COMPASS_WORDS = {
  en: ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'],
  ru: ['север', 'северо-восток', 'восток', 'юго-восток', 'юг', 'юго-запад', 'запад', 'северо-запад'],
  ka: ['ჩრდილოეთი', 'ჩრდილო-აღმოსავლეთი', 'აღმოსავლეთი', 'სამხრეთ-აღმოსავლეთი', 'სამხრეთი', 'სამხრეთ-დასავლეთი', 'დასავლეთი', 'ჩრდილო-დასავლეთი'],
};

// Compass point of a bearing: 8 or 16 points as abbreviations, or `words: true` (8 points spelled out).
// Rounds to the nearest sector (Math.round of deg / sector width), so N covers -11.25..11.25 with 16 points; the
// tables hold 16 points and coarser compasses step through them (i * 16 / n).
export function compass(deg, { points = 8, lang = 'en', words = false } = {}) {
  if (!Number.isFinite(deg)) return '';
  if (words) return (COMPASS_WORDS[lang] || COMPASS_WORDS.en)[Math.round(wrap360(deg) / 45) % 8];
  const n = points === 16 ? 16 : points === 4 ? 4 : 8;
  const i = Math.round(wrap360(deg) / (360 / n)) % n;
  return (COMPASS[lang] || COMPASS.en)[i * (16 / n)];
}

// The point `m` metres from `a` on the initial bearing.
export function destination(a, bearingDeg, m, radius = EARTH_RADIUS) {
  const p = latLng(a);
  if (!p) return null;
  const d = m / radius, t = bearingDeg * RAD, f1 = p[0] * RAD, l1 = p[1] * RAD;
  const f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(t));
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(f1), Math.cos(d) - Math.sin(f1) * Math.sin(f2));
  return { lat: f2 * DEG, lng: wrapLng(l2 * DEG) };
}

// The point at fraction f along the great circle from a to b.
// Spherical linear interpolation (slerp) in 3-D unit vectors, then back to lat/lng: correct across the antimeridian
// and near the poles, unlike interpolating degrees. Undefined for exactly antipodal points (sin d = 0, any great
// circle works); coincident points are returned as is.
export function interpolate(a, b, f) {
  const p = latLng(a), q = latLng(b);
  if (!p || !q) return null;
  const d = haversine(p, q) / EARTH_RADIUS;
  if (d < 1e-12) return { lat: p[0], lng: p[1] };
  const f1 = p[0] * RAD, l1 = p[1] * RAD, f2 = q[0] * RAD, l2 = q[1] * RAD;
  const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(f1) * Math.cos(l1) + B * Math.cos(f2) * Math.cos(l2);
  const y = A * Math.cos(f1) * Math.sin(l1) + B * Math.cos(f2) * Math.sin(l2);
  const z = A * Math.sin(f1) + B * Math.sin(f2);
  return { lat: Math.atan2(z, Math.hypot(x, y)) * DEG, lng: Math.atan2(y, x) * DEG };
}

export const midpoint = (a, b) => interpolate(a, b, 0.5);

// Distance of p from the great circle through a and b; positive when p is right of the direction a -> b.
export function crossTrack(p, a, b, radius = EARTH_RADIUS) {
  const d13 = haversine(a, p) / radius;
  const t13 = bearing(a, p) * RAD, t12 = bearing(a, b) * RAD;
  return Math.asin(Math.sin(d13) * Math.sin(t13 - t12)) * radius;
}

// Length of a path of points (points that are not points are skipped).
export function pathLength(points) {
  let m = 0, prev = null;
  for (const x of points || []) {
    const p = latLng(x);
    if (!p) continue;
    if (prev) m += haversine(prev, p);
    prev = p;
  }
  return m;
}

// Area of a closed ring on the sphere (m², always positive); the ring may repeat its first point.
// Area of a spherical polygon via the line integral used by GIS libraries (Chamberlain & Duquette): sum of
// dLng * (2 + sin lat1 + sin lat2). Exact for edges along parallels of the integration, accurate for city-scale
// polygons; the absolute value makes ring orientation irrelevant.
export function polygonArea(ring, radius = EARTH_RADIUS) {
  const pts = (ring || []).map(latLng).filter(Boolean);
  if (pts.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [la1, lo1] = pts[i], [la2, lo2] = pts[(i + 1) % pts.length];
    s += (lo2 - lo1) * RAD * (2 + Math.sin(la1 * RAD) + Math.sin(la2 * RAD));
  }
  return Math.abs((s * radius * radius) / 2);
}

// --- bounding boxes { south, west, north, east } -----------------------------------------------------------------

// KNOWN LIMIT for all bbox helpers: boxes are plain west <= east intervals; a box crossing the antimeridian
// (west 170, east -170) is not representable and bboxContains/bboxIntersects give wrong answers for it.
export function bboxOf(points) {
  let s = 90, w = 180, n = -90, e = -180, any = false;
  for (const x of points || []) {
    const p = latLng(x);
    if (!p) continue;
    any = true;
    if (p[0] < s) s = p[0]; if (p[0] > n) n = p[0];
    if (p[1] < w) w = p[1]; if (p[1] > e) e = p[1];
  }
  return any ? { south: s, west: w, north: n, east: e } : null;
}

// A box of `m` metres around a point (in every direction).
// Longitude degrees shrink with cos(lat), so the box widens towards the poles; the 1e-9 floor avoids division by zero
// at a pole (where the box covers every longitude anyway).
export function bboxAround(p, m) {
  const q = latLng(p);
  if (!q) return null;
  const dLat = (m / EARTH_RADIUS) * DEG;
  const dLng = dLat / Math.max(1e-9, Math.cos(q[0] * RAD));
  return { south: Math.max(-90, q[0] - dLat), west: q[1] - dLng, north: Math.min(90, q[0] + dLat), east: q[1] + dLng };
}

export function bboxContains(b, p) {
  const q = latLng(p);
  return !!b && !!q && q[0] >= b.south && q[0] <= b.north && q[1] >= b.west && q[1] <= b.east;
}

export const bboxIntersects = (a, b) => !!a && !!b && a.south <= b.north && b.south <= a.north && a.west <= b.east && b.west <= a.east;

export function bboxUnion(...boxes) {
  const list = boxes.flat().filter(Boolean);
  if (!list.length) return null;
  return {
    south: Math.min(...list.map((b) => b.south)), west: Math.min(...list.map((b) => b.west)),
    north: Math.max(...list.map((b) => b.north)), east: Math.max(...list.map((b) => b.east)),
  };
}

export const bboxCenter = (b) => (b ? { lat: (b.south + b.north) / 2, lng: (b.west + b.east) / 2 } : null);

// A box grown by a fraction of its size on every side.
export function bboxPad(b, f = 0.1) {
  if (!b) return null;
  const v = (b.north - b.south) * f, h = (b.east - b.west) * f;
  return { south: b.south - v, west: b.west - h, north: b.north + v, east: b.east + h };
}

// A box as an array [south, west, north, east] (the Overpass order) and back.
export const bboxToArray = (b) => [b.south, b.west, b.north, b.east];
export const bboxFromArray = (a) => (Array.isArray(a) && a.length === 4 ? { south: +a[0], west: +a[1], north: +a[2], east: +a[3] } : null);
