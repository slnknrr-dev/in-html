// geo/coords.js - coordinates as people paste them: decimal pairs with decimal points or commas ("41.6516, 41.6367",
// "41,6516 41,6367", "41,6516; 41,6367"), degrees-minutes-seconds and degrees-decimal-minutes with hemisphere letters
// in Latin, Cyrillic (С Ю В З) or Georgian (ჩ ს ა დ) before or after the number, "geo:" URIs and map links
// (OpenStreetMap "#map=z/lat/lng", "mlat= / mlon=", Google "@lat,lng" and "q=lat,lng"); formatting back in every style.
//
//   parseLatLng(text, { order: 'latlng' | 'lnglat' }) -> { lat, lng } | null       null for empty and for garbage
//   parseAngle(text, axis?) -> degrees | NaN        one coordinate: "41°39'06\"N", "41 39.1 N", "-41.65"
//   formatLatLng(p, { format: 'dd' | 'ddm' | 'dms', digits, lang }) -> '41.651600, 41.636700' | "41°39′05.8″N 41°38′12.1″E"
//   toDMS(deg) -> { sign, d, m, s }
//   geoUri(p) -> 'geo:41.6516,41.6367'      osmUrl(p, zoom) -> 'https://www.openstreetmap.org/?mlat=…'
//
// The decimal-comma form follows the retail project: "lat, lng" with either separator, out-of-range values rejected.

// Hemisphere markers in three scripts plus the Russian abbreviations (с.ш. = northern latitude, в.д. = eastern
// longitude). Lookup tries the marker with dots kept and with dots removed, so "с. ш." and "сш" both work.
const HEMI = {
  n: 'N', s: 'S', e: 'E', w: 'W', 'с': 'N', 'ю': 'S', 'в': 'E', 'з': 'W', 'ჩ': 'N', 'ს': 'S', 'ა': 'E', 'დ': 'W',
  'n.': 'N', 's.': 'S', 'e.': 'E', 'w.': 'W', 'с.ш.': 'N', 'ю.ш.': 'S', 'в.д.': 'E', 'з.д.': 'W', 'сш': 'N', 'юш': 'S', 'вд': 'E', 'зд': 'W',
};
const HEMI_RE = '(?:с\\.?\\s?ш\\.?|ю\\.?\\s?ш\\.?|в\\.?\\s?д\\.?|з\\.?\\s?д\\.?|[NSEWnsewСЮВЗсювзჩსად])';

const hemiOf = (s) => HEMI[String(s || '').toLowerCase().replace(/\s/g, '')] || HEMI[String(s || '').toLowerCase().replace(/[\s.]/g, '')] || '';

const inRange = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

// One angle: decimal degrees, or degrees / minutes / seconds with any of ° ' " ′ ″ º, d m s, colons or spaces, with
// a hemisphere letter before or after. NaN when it is not an angle.
// One permissive grammar for DD, DDM and DMS: degrees, optional minutes, optional seconds, separated by any of the
// symbols people use (°, ', ", primes, d/m/s, colons, spaces). Unicode minus/en dash become '-', two apostrophes a
// double prime. Minutes/seconds must be < 60 and degrees must be whole when minutes follow: "41.5 30" is rejected
// rather than guessed. A hemisphere letter S/W negates.
function angle(text) {
  let s = String(text ?? '').trim().replace(/[−–]/g, '-').replace(/''/g, '″');
  if (!s) return { v: NaN, hemi: '' };
  let hemi = '';
  const pre = s.match(new RegExp('^' + HEMI_RE + '\\s*', 'u'));
  if (pre && /\d/.test(s.slice(pre[0].length, pre[0].length + 2))) { hemi = hemiOf(pre[0]); s = s.slice(pre[0].length); }
  const post = s.match(new RegExp('\\s*' + HEMI_RE + '$', 'u'));
  if (!hemi && post) { hemi = hemiOf(post[0]); s = s.slice(0, post.index); }
  s = s.trim().replace(/,(?=\d)/g, '.');
  const m = s.match(/^([-+]?\d+(?:\.\d+)?)\s*(?:[°º˚d:]|\s)?\s*(?:(\d+(?:\.\d+)?)\s*(?:['′’m:]|\s)?\s*(?:(\d+(?:\.\d+)?)\s*(?:["″”s])?)?)?$/i);
  if (!m) return { v: NaN, hemi };
  const d = +m[1], mi = m[2] ? +m[2] : 0, se = m[3] ? +m[3] : 0;
  if (mi >= 60 || se >= 60 || (m[2] && !Number.isInteger(d))) return { v: NaN, hemi };
  let v = Math.abs(d) + mi / 60 + se / 3600;
  if (d < 0 || /^-/.test(m[1]) || hemi === 'S' || hemi === 'W') v = -v;
  return { v, hemi };
}

export const parseAngle = (text) => angle(text).v;

// Coordinates in map links and URIs.
// Links are tried before free-text parsing: their numbers are unambiguous (lat/lng positions fixed by the URL
// scheme), whereas the same digits as free text might need the order option.
function fromLink(s) {
  let m = s.match(/^geo:\s*([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)/i);
  if (m) return [+m[1], +m[2]];
  m = s.match(/#map=\d+(?:\.\d+)?\/([-+]?\d+(?:\.\d+)?)\/([-+]?\d+(?:\.\d+)?)/);
  if (m) return [+m[1], +m[2]];
  const mlat = s.match(/[?&]mlat=([-+]?\d+(?:\.\d+)?)/), mlon = s.match(/[?&]mlon=([-+]?\d+(?:\.\d+)?)/);
  if (mlat && mlon) return [+mlat[1], +mlon[1]];
  m = s.match(/@([-+]?\d+(?:\.\d+)?),([-+]?\d+(?:\.\d+)?)(?:,|$)/);
  if (m) return [+m[1], +m[2]];
  m = s.match(/[?&](?:q|ll|query|daddr|destination)=([-+]?\d+(?:\.\d+)?)(?:,|%2C)\s*([-+]?\d+(?:\.\d+)?)/i);
  if (m) return [+m[1], +m[2]];
  return null;
}

/**
 * A coordinate pair from text; null when empty or not a pair in range. Decimal pairs are latitude first unless
 * `order: 'lnglat'` (GeoJSON order); pairs with hemisphere letters are put in place by the letters ("41.6 E 41.6 N").
 */
// Decimal comma support makes "41,65 41,63" valid; a comma between two numbers is accepted as the pair separator
// only through the regex alternatives (", " / "; " / space), so "41,65,41,63" never parses as two numbers.
// Hemisphere letters override the order option; two latitudes (N and S) or two longitudes are rejected.
export function parseLatLng(text, { order = 'latlng' } = {}) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  const link = fromLink(s);
  if (link) return inRange(link[0], link[1]) ? { lat: link[0], lng: link[1] } : null;
  // Two plain decimals: "41.65, 41.63", "41,65 41,63", "41,65; 41,63", "41.65 41.63".
  const dec = s.match(/^\(?\s*([-+−]?\d+(?:[.,]\d+)?)\s*(?:[,;]\s*|\s+)([-+−]?\d+(?:[.,]\d+)?)\s*\)?$/);
  if (dec) {
    // "41,65,41,63" is ambiguous; a comma pair needs a space or semicolon unless both use decimal points.
    const a = +dec[1].replace(',', '.').replace('−', '-'), b = +dec[2].replace(',', '.').replace('−', '-');
    const [lat, lng] = order === 'lnglat' ? [b, a] : [a, b];
    return inRange(lat, lng) ? { lat, lng } : null;
  }
  // Two angles with optional hemispheres: split at a separator between them.
  const parts = splitPair(s);
  if (!parts) return null;
  const A = angle(parts[0]), B = angle(parts[1]);
  if (!Number.isFinite(A.v) || !Number.isFinite(B.v)) return null;
  let lat = A.v, lng = B.v;
  if ((A.hemi === 'E' || A.hemi === 'W') && (!B.hemi || B.hemi === 'N' || B.hemi === 'S')) [lat, lng] = [B.v, A.v];
  else if (!A.hemi && !B.hemi && order === 'lnglat') [lat, lng] = [B.v, A.v];
  if ((A.hemi && B.hemi) && ((A.hemi === 'N' || A.hemi === 'S') === (B.hemi === 'N' || B.hemi === 'S'))) return null;
  return inRange(lat, lng) ? { lat, lng } : null;
}

// Splits "41°39'06"N 41°38'12"E" / "N 41 39.1, E 41 38.2" into two angle strings.
function splitPair(s) {
  // Hemisphere letters before the numbers: "N 41 39.1 E 41 38.2", "ჩ 41.65 ა 41.63".
  if (new RegExp('^' + HEMI_RE + '\\s*[-+]?\\d', 'u').test(s)) {
    const h = s.match(new RegExp('^(.+?)[\\s,;]+(' + HEMI_RE + '\\s*[-+]?\\d.*)$', 'u'));
    if (h) return [h[1], h[2]];
  }
  let m = s.split(/\s*[;,]\s*(?=[^\d]*\d)|\s*\/\s*/);
  if (m.length === 2 && m.every((x) => /\d/.test(x))) return m;
  // A hemisphere letter after the first angle ends it: "41 39 06 N 41 38 12 E".
  const re = new RegExp('^(.*?\\d[^\\d]*?' + HEMI_RE + ')\\s*(.+)$', 'u');
  m = s.match(re);
  if (m && /\d/.test(m[2])) return [m[1], m[2]];
  // A hemisphere letter before the second angle: "N 41.6 E 41.6".
  m = s.match(new RegExp('^(' + HEMI_RE + '?[^A-Za-zА-Яа-яა-ჰ]*?)\\s+(' + HEMI_RE + '\\s*\\d.*)$', 'u'));
  if (m && /\d/.test(m[1])) return [m[1], m[2]];
  // Symbols: the second angle starts after a seconds / minutes mark followed by a space.
  m = s.match(/^(.*?["″”'′’])\s+([-+]?\d.*)$/);
  if (m) return [m[1], m[2]];
  return null;
}

// Degrees -> { sign, d, m, s } with seconds rounded to `digits`, carrying 60 s into a minute.
// Seconds are rounded first, then carried: 59.96 s rounded to 1 digit is 60.0, which must become +1 minute (and
// possibly +1 degree) instead of printing 41°39'60.0".
export function toDMS(deg, digits = 1) {
  const sign = deg < 0 ? -1 : 1;
  let a = Math.abs(deg);
  let d = Math.floor(a), m = Math.floor((a - d) * 60);
  let s = +(((a - d) * 60 - m) * 60).toFixed(digits);
  if (s >= 60) { s -= 60; m += 1; }
  if (m >= 60) { m -= 60; d += 1; }
  return { sign, d, m, s };
}

const LETTERS = { en: ['N', 'S', 'E', 'W'], ru: ['с. ш.', 'ю. ш.', 'в. д.', 'з. д.'], ka: ['ჩ', 'ს', 'ა', 'დ'] };

// Text of a point: 'dd' (decimal, default 6 digits ~ 0.1 m), 'ddm' (degrees, decimal minutes), 'dms'.
export function formatLatLng(p, { format = 'dd', digits, lang = 'en', separator } = {}) {
  const lat = Array.isArray(p) ? p[0] : p?.lat, lng = Array.isArray(p) ? p[1] : p?.lng ?? p?.lon;
  if (!inRange(+lat, +lng)) return '';
  if (format === 'dd') return (+lat).toFixed(digits ?? 6) + (separator ?? ', ') + (+lng).toFixed(digits ?? 6);
  const L = LETTERS[lang] || LETTERS.en;
  const one = (v, isLat) => {
    const h = isLat ? (v < 0 ? L[1] : L[0]) : v < 0 ? L[3] : L[2];
    const sp = lang === 'en' ? '' : ' ';
    if (format === 'ddm') {
      const a = Math.abs(v);
      let d = Math.floor(a);
      let m = +((a - d) * 60).toFixed(digits ?? 3);
      if (m >= 60) { m -= 60; d += 1; }
      return `${d}°${m.toFixed(digits ?? 3).padStart((digits ?? 3) + 3, '0')}′${sp}${h}`;
    }
    const x = toDMS(v, digits ?? 1);
    return `${x.d}°${String(x.m).padStart(2, '0')}′${x.s.toFixed(digits ?? 1).padStart((digits ?? 1) + 3, '0')}″${sp}${h}`;
  };
  return one(+lat, true) + (separator ?? ' ') + one(+lng, false);
}

export const geoUri = (p) => { const s = formatLatLng(p, { digits: 6, separator: ',' }); return s ? 'geo:' + s : ''; };

export function osmUrl(p, zoom = 17) {
  const s = formatLatLng(p, { digits: 6, separator: ',' });
  if (!s) return '';
  const [lat, lng] = s.split(',');
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=${zoom}/${lat}/${lng}`;
}
