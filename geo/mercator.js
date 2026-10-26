// geo/mercator.js - Web Mercator (EPSG:3857) and slippy-map tile math: longitude / latitude <-> fractional tile
// coordinates and projected metres, tile bounding boxes with a pixel margin, a projector into tile or viewport pixels,
// tiles covering a box, the zoom that fits a box into a viewport, metres per pixel, quadkeys and URL templates.
//
//   lonToTileX(lng, z) / latToTileY(lat, z) / tileXToLon / tileYToLat
//   tileBBox(z, x, y, padPx) -> { south, west, north, east }      tileProjector(z, x, y, size) -> (lat, lng) => [px, py]
//   toMeters({ lat, lng }) -> [x, y]       fromMeters([x, y]) -> { lat, lng }
//   tileCoordOk(z, x, y, maxZoom)          tilesInBBox(bbox, z) -> [[x, y], …]
//   fitBBox(bbox, width, height, { padding, maxZoom }) -> { zoom, center, project, bbox }
//   metersPerPixel(lat, z, size)           quadkey(z, x, y)       tileUrl(template, z, x, y)
//
// Latitude is clamped to ±85.0511° (the poles are at infinity in this projection).

export const TILE_SIZE = 256;
// atan(sinh(pi)): the latitude where the projected world becomes a square, which is what lets zoom 0 be one square
// tile. Beyond it y goes to infinity, so latitudes are clamped.
export const MERCATOR_MAX_LAT = 85.0511287798;
export const EARTH_EQUATOR = 2 * Math.PI * 6378137;   // m, the projection uses the WGS 84 semi-major axis
export const TILE_MAX_ZOOM = 19;

const clampLat = (lat) => Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, lat));

export const lonToTileX = (lon, z) => ((lon + 180) / 360) * 2 ** z;

// Mercator y = ln(tan(lat) + sec(lat)), scaled from [pi, -pi] to [0, 1] (north at the top) and then to 2^z tiles.
export function latToTileY(lat, z) {
  const r = (clampLat(lat) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

export const tileXToLon = (x, z) => (x / 2 ** z) * 360 - 180;

export function tileYToLat(y, z) {
  const n = Math.PI * (1 - (2 * y) / 2 ** z);
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

// The tile containing a point.
export const tileOf = (lat, lng, z) => [Math.floor(lonToTileX(lng, z)), Math.floor(latToTileY(lat, z))];

/**
 * Geographic bounds of a tile; `padPx` widens it by screen pixels. Margins are always needed: a 12 px wide road whose
 * node lies outside the tile still touches it with its width, and labels overhang their anchor - without the margin
 * roads break at tile seams.
 */
export function tileBBox(z, x, y, padPx = 0) {
  const p = padPx / TILE_SIZE;
  return { west: tileXToLon(x - p, z), east: tileXToLon(x + 1 + p, z), north: tileYToLat(y - p, z), south: tileYToLat(y + 1 + p, z) };
}

// lat / lng -> pixel inside the tile (a closure: it is called thousands of times).
export function tileProjector(z, x, y, size = TILE_SIZE) {
  const n = 2 ** z;
  return (lat, lng) => [(((lng + 180) / 360) * n - x) * size, (latToTileY(lat, z) - y) * size];
}

// Projected metres (EPSG:3857).
export function toMeters(p) {
  const lat = clampLat(Array.isArray(p) ? p[0] : p.lat), lng = Array.isArray(p) ? p[1] : p.lng ?? p.lon;
  const R = EARTH_EQUATOR / (2 * Math.PI);
  return [(lng * Math.PI * R) / 180, R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];
}

export function fromMeters([x, y]) {
  const R = EARTH_EQUATOR / (2 * Math.PI);
  return { lat: (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI), lng: (x / R) * (180 / Math.PI) };
}

// Ground resolution at a latitude and zoom, metres per pixel.
export const metersPerPixel = (lat, z, size = TILE_SIZE) => (EARTH_EQUATOR * Math.cos((clampLat(lat) * Math.PI) / 180)) / (size * 2 ** z);

// Valid tile address: integers, z in [0, maxZoom], x / y in [0, 2^z).
export function tileCoordOk(z, x, y, maxZoom = TILE_MAX_ZOOM) {
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) return false;
  if (z < 0 || z > maxZoom) return false;
  const n = 2 ** z;
  return x >= 0 && x < n && y >= 0 && y < n;
}

// Tiles of zoom z covering a box (capped at `max` tiles).
// Capped: a world-sized box at high zoom would be billions of tiles; the cap protects tile-prefetch code paths.
export function tilesInBBox(b, z, max = 4096) {
  const n = 2 ** z;
  const x0 = Math.max(0, Math.floor(lonToTileX(b.west, z))), x1 = Math.min(n - 1, Math.floor(lonToTileX(b.east, z)));
  const y0 = Math.max(0, Math.floor(latToTileY(b.north, z))), y1 = Math.min(n - 1, Math.floor(latToTileY(b.south, z)));
  const out = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { out.push([x, y]); if (out.length >= max) return out; }
  return out;
}

/**
 * The largest zoom (fractional with `fractional: true`) at which a box fits a viewport of width x height pixels with
 * `padding` pixels around, and a projector (lat, lng) => [px, py] for that view centred on the box.
 */
// Measures the box in zoom-0 tile units (the projection is linear in x and in Mercator y), so the fitting zoom is
// log2 of the ratio between the available pixels and the box size at zoom 0; floor gives integer tile zooms. The
// centre is also taken in projected space, not as the lat midpoint (Mercator stretches the north).
export function fitBBox(b, width, height, { padding = 16, maxZoom = 19, minZoom = 0, fractional = false } = {}) {
  const w = Math.max(1, width - 2 * padding), h = Math.max(1, height - 2 * padding);
  const dx = Math.max(1e-12, lonToTileX(b.east, 0) - lonToTileX(b.west, 0));
  const dy = Math.max(1e-12, latToTileY(b.south, 0) - latToTileY(b.north, 0));
  let zoom = Math.log2(Math.min(w / (dx * TILE_SIZE), h / (dy * TILE_SIZE)));
  if (!fractional) zoom = Math.floor(zoom);
  zoom = Math.max(minZoom, Math.min(maxZoom, zoom));
  return viewOf({ lat: 0, lng: 0, ...centerOf(b) }, zoom, width, height);
}

const centerOf = (b) => {
  const cx = (lonToTileX(b.west, 0) + lonToTileX(b.east, 0)) / 2, cy = (latToTileY(b.north, 0) + latToTileY(b.south, 0)) / 2;
  return { lat: tileYToLat(cy, 0), lng: tileXToLon(cx, 0) };
};

// A view of a given centre and zoom: { zoom, center, bbox, project(lat, lng) -> [px, py], unproject(px, py) }.
export function viewOf(center, zoom, width, height) {
  const s = TILE_SIZE * 2 ** zoom;
  const cx = lonToTileX(center.lng, 0) * s, cy = latToTileY(center.lat, 0) * s;
  const ox = cx - width / 2, oy = cy - height / 2;
  const project = (lat, lng) => [lonToTileX(lng, 0) * s - ox, latToTileY(lat, 0) * s - oy];
  const unproject = (px, py) => ({ lat: tileYToLat((py + oy) / s, 0), lng: tileXToLon((px + ox) / s, 0) });
  const nw = unproject(0, 0), se = unproject(width, height);
  return { zoom, center: { lat: center.lat, lng: center.lng }, width, height, project, unproject, bbox: { south: se.lat, west: nw.lng, north: nw.lat, east: se.lng } };
}

// Bing-style quadkey of a tile.
// Interleaves x and y bits from the most significant level down: one base-4 digit per zoom level, so a tile's key is
// a prefix of all its children's keys (Bing Maps tile system).
export function quadkey(z, x, y) {
  let q = '';
  for (let i = z; i > 0; i--) {
    const m = 1 << (i - 1);
    q += String((x & m ? 1 : 0) + (y & m ? 2 : 0));
  }
  return q;
}

export function fromQuadkey(q) {
  let x = 0, y = 0;
  const z = q.length;
  for (let i = z; i > 0; i--) {
    const m = 1 << (i - 1), d = +q[z - i];
    if (d & 1) x |= m;
    if (d & 2) y |= m;
  }
  return { z, x, y };
}

// "https://tile.example/{z}/{x}/{y}.png" with {z} {x} {y} {s} (subdomain a/b/c) and {q} (quadkey).
// String.replace with a string pattern replaces only the first occurrence: each placeholder may appear once. The
// {s} subdomain rotates deterministically by tile so the browser cache stays effective.
export const tileUrl = (tmpl, z, x, y) => String(tmpl).replace('{z}', z).replace('{x}', x).replace('{y}', y)
  .replace('{s}', 'abc'[(x + y) % 3]).replace('{q}', quadkey(z, x, y));
