// geo/polyline.js - compact text forms of point lists: the Google encoded polyline (precision 5 = ~1 m, 6 for
// OSRM / Valhalla), a delta form of many lines at once (one shared precision, lines separated) for embedding map
// data in a page, and the portal's "lat,lng lat,lng" storage form.
//
//   encodePolyline([[lat, lng], …], precision = 5) -> string      decodePolyline(str, precision) -> [[lat, lng], …]
//   encodePts(points, digits = 6) -> '41.651600,41.636700 …'       decodePts(str) -> points (garbage skipped)
//
// Points are [lat, lng] (the polyline order). Rounding happens once per point on the absolute value, so errors do not
// accumulate along the line: every decoded point is within half a unit of the last digit of its original.

// Google polyline: zigzag sign encoding (negative values become odd: ~(v << 1)), then 5-bit chunks from the low
// end, each + 63 into printable ASCII, 0x20 marking "more chunks follow". Bitwise ops are 32-bit signed, which bounds
// |value| to 2^30: fine for precision 5 and 6, overflowing for precision 7 at large longitudes.
function encodeValue(v, out) {
  let n = v < 0 ? ~(v << 1) : v << 1;
  while (n >= 0x20) { out.push(String.fromCharCode((0x20 | (n & 0x1f)) + 63)); n >>>= 5; }
  out.push(String.fromCharCode(n + 63));
}

// Deltas of ROUNDED absolute coordinates (not rounded deltas): the decoder's running sum reproduces each rounded
// point exactly, so error never accumulates over long lines.
export function encodePolyline(points, precision = 5) {
  const k = 10 ** precision;
  const out = [];
  let plat = 0, plng = 0;
  for (const p of points || []) {
    const lat = Math.round((Array.isArray(p) ? p[0] : p.lat) * k), lng = Math.round((Array.isArray(p) ? p[1] : p.lng ?? p.lon) * k);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    encodeValue(lat - plat, out);
    encodeValue(lng - plng, out);
    plat = lat; plng = lng;
  }
  return out.join('');
}

// Decodes; a truncated or broken string yields the points read before the damage.
// Defensive decoder: characters outside the alphabet, truncation, or a chunk run longer than 7 groups stop decoding,
// returning the points read so far instead of garbage coordinates.
export function decodePolyline(str, precision = 5) {
  const s = String(str || '');
  const k = 10 ** precision;
  const out = [];
  let i = 0, lat = 0, lng = 0;
  const next = () => {
    let shift = 0, result = 0, b;
    do {
      if (i >= s.length) return null;
      b = s.charCodeAt(i++) - 63;
      if (b < 0 || b > 63) return null;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && shift < 35);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < s.length) {
    const a = next(), b = next();
    if (a === null || b === null) break;
    lat += a; lng += b;
    out.push([lat / k, lng / k]);
  }
  return out;
}

// Points -> "lat,lng lat,lng" with `digits` decimals (6 ~ 0.11 m, finer than a wall).
export const encodePts = (pts, digits = 6) => (pts || []).map((p) => p[0].toFixed(digits) + ',' + p[1].toFixed(digits)).join(' ');

// "lat,lng lat,lng" -> points; garbage chunks are dropped (a broken row must not break a tile).
export function decodePts(s) {
  const out = [];
  for (const chunk of String(s || '').split(' ')) {
    if (!chunk) continue;
    const c = chunk.indexOf(',');
    if (c < 0) continue;
    const lat = +chunk.slice(0, c), lng = +chunk.slice(c + 1);
    if (chunk.slice(0, c) !== '' && chunk.slice(c + 1) !== '' && Number.isFinite(lat) && Number.isFinite(lng)) out.push([lat, lng]);
  }
  return out;
}

// Many lines in one string: polyline characters are 63..126, so a space never occurs inside one.
export const encodeLines = (lines, precision = 5) => (lines || []).map((l) => encodePolyline(l, precision)).join(' ');
export const decodeLines = (s, precision = 5) => String(s || '').split(' ').filter(Boolean).map((x) => decodePolyline(x, precision));
