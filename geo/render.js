// geo/render.js - maps as SVG strings: one slippy-map tile (the portal's own tile renderer) or a whole view of any
// size from shapes or GeoJSON-like features, with water rings built from coastline, street labels placed along the
// streets without collisions, place labels, markers, a route overlay and the OSM attribution. No DOM: the result is a
// string for innerHTML, an <img> data URI, a file, or a rasteriser.
//
//   renderTileSvg(shapes, { z, x, y, size, labels }) -> '<svg …>'
//   renderMapSvg(input, { width, height, bbox | center + zoom, padding, labels, coastline, markers, route, places,
//                         style, land, attribution, title }) -> { svg, view, labels }
//   featuresToShapes(geojson) -> shapes        shapes: [{ kind, name?, pts: [[lat, lng], …] }]
//   placeLabels(candidates, { width, height }) -> accepted candidates (greedy by priority, rotated boxes)
//   pathD(px, close) / labelAngle(a, b) / labelCellKey(name, pt) / labelFontSize(z) / escXml(s)
//
// Rendering rules from the portal: layers are sorted here (callers need not remember ORDER BY); road casings go in a
// pass before road fills; points closer than 0.4 px collapse (a building at z12 is 3 points, not 30) but the last
// point is always kept (tile seams); a label halo is a second <text> under the text (paint-order is not everywhere).
import { MAP_STYLE, LAND_COLOR, OSM_ATTRIBUTION, isShapeKind, strokeWidth } from './osm.js';
import { TILE_SIZE, fitBBox, tileProjector, viewOf } from './mercator.js';
import { chainWays, coastlineWaterRings, lineMidpoint } from './lines.js';
import { bboxPad } from './sphere.js';

const r1 = (v) => Math.round(v * 10) / 10;
const MIN_STEP = 0.4;

export const escXml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// The d attribute of a path in pixels; points closer than MIN_STEP collapse, the last one stays.
export function pathD(px, close) {
  if (px.length < 2) return '';
  const out = [];
  let lx = NaN, ly = NaN;
  for (let i = 0; i < px.length; i++) {
    const [x, y] = px[i];
    if (i && i < px.length - 1 && Math.abs(x - lx) < MIN_STEP && Math.abs(y - ly) < MIN_STEP) continue;
    out.push((out.length ? 'L' : 'M') + r1(x) + ' ' + r1(y));
    lx = x; ly = y;
  }
  if (out.length < 2) return '';
  return out.join('') + (close ? 'Z' : '');
}

// Label angle along a chord in PIXELS, in [-90, 90] so text is never upside down.
export function labelAngle(a, b) {
  let deg = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  if (deg > 90) deg -= 180;
  if (deg <= -90) deg += 180;
  return Math.round(deg * 10) / 10;
}

/**
 * Label thinning cell of about 250 m: one street is a dozen OSM ways with the same name. Deciding per cell of a grid
 * fixed to coordinates (not per tile) keeps neighbouring tiles from picking different pieces and cutting a label.
 */
export const LABEL_CELL_DEG = 0.0025;
export const labelCellKey = (name, p) => name + '@' + Math.round(p[0] / LABEL_CELL_DEG) + ',' + Math.round(p[1] / LABEL_CELL_DEG);

export const labelFontSize = (z) => (z >= 18 ? 13 : z >= 17 ? 12 : 11);

const textW = (s, fs) => [...String(s)].length * fs * 0.58;

function labelSvg(text, x, y, angle, fs, { color = '#4a4a48', halo = LAND_COLOR, weight } = {}) {
  const t = escXml(text);
  const common = `text-anchor="middle" dy="${(fs / 3).toFixed(1)}" font-family="sans-serif" font-size="${fs}"${weight ? ` font-weight="${weight}"` : ''}`;
  return `<g transform="translate(${r1(x)} ${r1(y)})${angle ? ` rotate(${angle})` : ''}">` +
    `<text ${common} stroke="${halo}" stroke-width="3" stroke-linejoin="round" fill="none">${t}</text>` +
    `<text ${common} fill="${color}">${t}</text></g>`;
}

/**
 * One tile: shapes (any order) -> SVG string. Labels from zoom 16; a label whose anchor lies in a neighbouring tile is
 * drawn by that tile (both compute the same anchor), here only a margin for the text width.
 */
export function renderTileSvg(shapes, opts) {
  const size = opts.size || TILE_SIZE;
  const z = opts.z;
  const project = tileProjector(z, opts.x, opts.y, size);
  const withLabels = opts.labels !== false && z >= 16;
  const visible = (shapes || []).filter((s) => isShapeKind(s.kind) && z >= MAP_STYLE[s.kind].minzoom && s.pts.length >= 2);
  visible.sort((a, b) => MAP_STYLE[a.kind].order - MAP_STYLE[b.kind].order);
  const areas = [], casings = [], lines = [], labels = [];
  for (const s of visible) {
    const st = MAP_STYLE[s.kind];
    const px = s.pts.map((p) => project(p[0], p[1]));
    const d = pathD(px, st.area);
    if (!d) continue;
    if (st.area) {
      areas.push(`<path d="${d}" fill="${st.fill}"${st.stroke ? ` stroke="${st.stroke}" stroke-width="${strokeWidth(st.width || 1, z)}"` : ''}/>`);
      continue;
    }
    if (st.casing) casings.push(`<path d="${d}" stroke="${st.casing}" stroke-width="${strokeWidth(st.casingWidth || (st.width || 1) + 2, z)}"/>`);
    lines.push(`<path d="${d}" stroke="${st.stroke}" stroke-width="${strokeWidth(st.width || 1, z)}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}/>`);
    if (withLabels && st.label && s.name) {
      const a = lineMidpoint(s.pts);
      if (!a) continue;
      const [lx, ly] = project(a[0], a[1]);
      if (lx < -size || lx > size * 2 || ly < -20 || ly > size + 20) continue;
      const p0 = project(s.pts[0][0], s.pts[0][1]), p1 = project(s.pts[s.pts.length - 1][0], s.pts[s.pts.length - 1][1]);
      labels.push(labelSvg(s.name, lx, ly, labelAngle(p0, p1), labelFontSize(z)));
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" fill="${LAND_COLOR}"/>` +
    `<g fill-rule="evenodd">${areas.join('')}</g>` +
    `<g fill="none" stroke-linecap="round" stroke-linejoin="round">${casings.join('')}${lines.join('')}</g>` +
    labels.join('') + '</svg>';
}

/**
 * GeoJSON-like features -> shapes. Coordinates are GeoJSON [lng, lat]; the kind comes from properties.kind, or from
 * the OSM tags in properties (classifyOsmWay is applied by the caller - here unknown kinds are kept and later
 * ignored by the renderer). Points become { kind: 'point', pt, name, props }.
 */
export function featuresToShapes(input) {
  const feats = Array.isArray(input) ? input : input?.type === 'FeatureCollection' ? input.features : input?.type === 'Feature' ? [input] : [];
  const out = [];
  const sw = (c) => [c[1], c[0]];
  for (const f of feats || []) {
    const g = f?.geometry, p = f?.properties || {};
    if (!g) continue;
    const base = { kind: p.kind, name: p.name || '', props: p };
    if (g.type === 'Point') out.push({ ...base, kind: p.kind || 'point', pt: sw(g.coordinates) });
    else if (g.type === 'MultiPoint') for (const c of g.coordinates) out.push({ ...base, kind: p.kind || 'point', pt: sw(c) });
    else if (g.type === 'LineString') out.push({ ...base, pts: g.coordinates.map(sw) });
    else if (g.type === 'MultiLineString') for (const l of g.coordinates) out.push({ ...base, pts: l.map(sw) });
    else if (g.type === 'Polygon') out.push({ ...base, pts: g.coordinates[0].map(sw), holes: g.coordinates.slice(1).map((r) => r.map(sw)) });
    else if (g.type === 'MultiPolygon') for (const poly of g.coordinates) out.push({ ...base, pts: poly[0].map(sw), holes: poly.slice(1).map((r) => r.map(sw)) });
  }
  return out;
}

// Corners of a rotated label box (for collision tests).
function boxOf(c) {
  const a = (c.angle * Math.PI) / 180, w = c.w / 2 + (c.pad ?? 2), h = c.h / 2 + (c.pad ?? 2);
  const cos = Math.cos(a), sin = Math.sin(a);
  return [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => [c.x + x * cos - y * sin, c.y + x * sin + y * cos]);
}

// Separating axis test of two convex quadrilaterals.
// Separating axis theorem: two convex polygons are disjoint iff some edge normal of either separates their
// projections. Rotated label boxes need this; axis-aligned rectangle tests would reject or overlap along streets.
function overlap(p, q) {
  for (const poly of [p, q]) {
    for (let i = 0; i < 4; i++) {
      const a = poly[i], b = poly[(i + 1) % 4];
      const nx = b[1] - a[1], ny = a[0] - b[0];
      let pMin = Infinity, pMax = -Infinity, qMin = Infinity, qMax = -Infinity;
      for (const v of p) { const d = v[0] * nx + v[1] * ny; if (d < pMin) pMin = d; if (d > pMax) pMax = d; }
      for (const v of q) { const d = v[0] * nx + v[1] * ny; if (d < qMin) qMin = d; if (d > qMax) qMax = d; }
      if (pMax < qMin || qMax < pMin) return false;
    }
  }
  return true;
}

/**
 * Greedy label placement: candidates { text, x, y, angle, w, h, priority (lower first), group? } are accepted in
 * priority order when their rotated box stays inside the view and overlaps no accepted box; one text repeats only
 * `spacing` px apart (one street, many ways). Returns the accepted candidates.
 */
// Greedy by priority (major roads first, then longer text) is not optimal but deterministic and O(n * accepted),
// which matters because neighbouring tiles must make the same decisions.
export function placeLabels(candidates, { width = Infinity, height = Infinity, spacing = 220, margin = 2 } = {}) {
  const list = (candidates || []).slice().sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9) || b.w - a.w);
  const done = [], boxes = [], byText = new Map();
  for (const c of list) {
    const box = boxOf(c);
    if (box.some(([x, y]) => x < margin || y < margin || x > width - margin || y > height - margin)) continue;
    const same = byText.get(c.text) || [];
    if (same.some((o) => Math.hypot(o.x - c.x, o.y - c.y) < spacing)) continue;
    if (boxes.some((b) => overlap(b, box))) continue;
    done.push(c); boxes.push(box); same.push(c); byText.set(c.text, same);
  }
  return done;
}

// The point and direction `dist` pixels along a pixel line.
function along(px, dist) {
  let acc = 0;
  for (let i = 1; i < px.length; i++) {
    const d = Math.hypot(px[i][0] - px[i - 1][0], px[i][1] - px[i - 1][1]);
    if (acc + d >= dist && d > 0) {
      const k = (dist - acc) / d;
      return { x: px[i - 1][0] + (px[i][0] - px[i - 1][0]) * k, y: px[i - 1][1] + (px[i][1] - px[i - 1][1]) * k, i };
    }
    acc += d;
  }
  return null;
}

const ROAD_PRIORITY = { road_trunk: 2, road_major: 3, road_minor: 4, road_service: 6, path: 7 };

/**
 * A whole map view: shapes (or GeoJSON features) fitted to `bbox` or centred on `center` at `zoom`, `width` x
 * `height` px. Optional: `coastline` chains (water rings are built for the view), `markers` [{ lat, lng, label,
 * color }], `route` [[lat, lng], …] drawn on top, `places` [{ name, pt, rank }], `style` (a MAP_STYLE-like table),
 * `land` colour, `labels: false`, `attribution: false`, `title`. Returns { svg, view, labels }.
 */
export function renderMapSvg(input, opts = {}) {
  const width = Math.round(opts.width || 800), height = Math.round(opts.height || 600);
  const style = opts.style || MAP_STYLE;
  const shapes = Array.isArray(input) && (!input.length || input[0].pts || input[0].pt) ? input : featuresToShapes(input);
  let view;
  if (opts.center && Number.isFinite(opts.zoom)) view = viewOf(opts.center, opts.zoom, width, height);
  else {
    let b = opts.bbox;
    if (!b) {
      let s = 90, w = 180, n = -90, e = -180;
      for (const sh of shapes) for (const p of sh.pts || [sh.pt]) { if (!p) continue; s = Math.min(s, p[0]); n = Math.max(n, p[0]); w = Math.min(w, p[1]); e = Math.max(e, p[1]); }
      for (const m of opts.markers || []) { s = Math.min(s, m.lat); n = Math.max(n, m.lat); w = Math.min(w, m.lng); e = Math.max(e, m.lng); }
      for (const p of opts.route || []) { s = Math.min(s, p[0]); n = Math.max(n, p[0]); w = Math.min(w, p[1]); e = Math.max(e, p[1]); }
      b = s <= n ? { south: s, west: w, north: n, east: e } : { south: -60, west: -180, north: 75, east: 180 };
    }
    view = fitBBox(b, width, height, { padding: opts.padding ?? 16, fractional: opts.fractional ?? true, maxZoom: opts.maxZoom ?? 19 });
  }
  const z = view.zoom;
  const P = (p) => view.project(p[0], p[1]);
  const land = opts.land || LAND_COLOR;
  const areas = [], casings = [], lines = [], cands = [], points = [];

  // Water from coastline, for a box a little larger than the view (so the edge walk happens off screen).
  if (opts.coastline?.length) {
    for (const ring of coastlineWaterRings(chainWays(opts.coastline), bboxPad(view.bbox, 0.05))) {
      const d = pathD(ring.map(P), true);
      if (d) areas.push({ order: style.water?.order ?? 4, svg: `<path d="${d}" fill="${style.water?.fill || '#a8cfe0'}"/>` });
    }
  }
  const visible = shapes.filter((s) => s.pts && s.pts.length >= 2 && style[s.kind] && z >= style[s.kind].minzoom - 0.5);
  visible.sort((a, b) => style[a.kind].order - style[b.kind].order);
  const named = new Map();
  for (const s of visible) {
    const st = style[s.kind];
    const px = s.pts.map(P);
    let d = pathD(px, st.area);
    if (!d) continue;
    if (st.area) {
      for (const h of s.holes || []) { const hd = pathD(h.map(P), true); if (hd) d += hd; }
      areas.push({ order: st.order, svg: `<path d="${d}" fill="${st.fill}"${st.stroke && z >= 16 ? ` stroke="${st.stroke}" stroke-width="${strokeWidth(st.width || 1, z)}"` : ''}/>` });
      continue;
    }
    if (st.casing) casings.push(`<path d="${d}" stroke="${st.casing}" stroke-width="${strokeWidth(st.casingWidth || (st.width || 1) + 2, z)}"/>`);
    lines.push(`<path d="${d}" stroke="${st.stroke}" stroke-width="${strokeWidth(st.width || 1, z)}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}/>`);
    if (st.label && s.name) { if (!named.has(s.name)) named.set(s.name, { kind: s.kind, ways: [] }); named.get(s.name).ways.push(s.pts); }
  }
  // Street labels: ways of one name are chained, then labelled every ~300 px where the text fits.
  if (opts.labels !== false && z >= 14) {
    const fs = labelFontSize(Math.round(z));
    for (const [name, { kind, ways }] of named) {
      for (const chain of chainWays(ways, { reverse: true })) {
        const px = chain.map(P);
        let len = 0;
        for (let i = 1; i < px.length; i++) len += Math.hypot(px[i][0] - px[i - 1][0], px[i][1] - px[i - 1][1]);
        const w = textW(name, fs);
        if (len < w * 1.1) continue;
        const n = Math.max(1, Math.floor(len / 300));
        for (let k = 0; k < n; k++) {
          const at = along(px, (len * (k + 0.5)) / n);
          if (!at) continue;
          const a = along(px, Math.max(0, (len * (k + 0.5)) / n - w / 2)) || at, b = along(px, Math.min(len, (len * (k + 0.5)) / n + w / 2)) || at;
          cands.push({ text: name, x: at.x, y: at.y, angle: labelAngle([a.x, a.y], [b.x, b.y]), w, h: fs * 1.2, fs, priority: ROAD_PRIORITY[kind] ?? 5 });
        }
      }
    }
  }
  for (const pl of opts.places || []) {
    const [x, y] = P(pl.pt);
    const fs = pl.rank <= 1 ? 16 : pl.rank <= 2 ? 14 : 12;
    cands.push({ text: pl.name, x, y, angle: 0, w: textW(pl.name, fs), h: fs * 1.2, fs, priority: pl.rank ?? 1, weight: pl.rank <= 2 ? 'bold' : '', color: '#333' });
  }
  // Markers are always drawn; their labels compete with the others but first.
  for (const [i, m] of (opts.markers || []).entries()) {
    const [x, y] = P([m.lat, m.lng]);
    const color = m.color || '#d33';
    points.push(`<g transform="translate(${r1(x)} ${r1(y)})"><path d="M0 0C-2 -6 -8 -9 -8 -15A8 8 0 1 1 8 -15C8 -9 2 -6 0 0Z" fill="${color}" stroke="#fff" stroke-width="1.5"/>` +
      (m.text ? `<text y="-12" text-anchor="middle" font-family="sans-serif" font-size="10" font-weight="bold" fill="#fff">${escXml(m.text)}</text>` : '') + '</g>');
    if (m.label) cands.push({ text: m.label, x, y: y + 12, angle: 0, w: textW(m.label, 12), h: 14, fs: 12, priority: 0, color: '#222', id: i });
  }
  const accepted = opts.labels === false ? cands.filter((c) => c.priority === 0) : placeLabels(cands, { width, height });
  let route = '';
  if (opts.route?.length > 1) {
    const d = pathD(opts.route.map(P), false);
    if (d) route = `<path d="${d}" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/>` +
      `<path d="${d}" fill="none" stroke="${opts.routeColor || '#2a6ad8'}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  areas.sort((a, b) => a.order - b.order);
  const attr = opts.attribution === false ? '' : `<text x="${width - 4}" y="${height - 4}" text-anchor="end" font-family="sans-serif" font-size="10" fill="#555" stroke="${land}" stroke-width="3" paint-order="stroke">${escXml(opts.attributionText || OSM_ATTRIBUTION)}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"${opts.title ? ` role="img" aria-label="${escXml(opts.title)}"` : ''}>` +
    (opts.title ? `<title>${escXml(opts.title)}</title>` : '') +
    `<rect width="${width}" height="${height}" fill="${land}"/>` +
    `<g fill-rule="evenodd">${areas.map((a) => a.svg).join('')}</g>` +
    `<g fill="none" stroke-linecap="round" stroke-linejoin="round">${casings.join('')}${lines.join('')}</g>` +
    route + points.join('') +
    accepted.map((c) => labelSvg(c.text, c.x, c.y, c.angle, c.fs, { color: c.color, halo: land, weight: c.weight })).join('') +
    attr + '</svg>';
  return { svg, view, labels: accepted };
}
