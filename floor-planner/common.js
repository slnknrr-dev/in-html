// floor-planner/common.js - shared parts of the editor and the seating page: the shell (pages resolved from the hidden
// anchors of the page HTML, so the build can rewrite them), icons, the document (a plan/ model plus the guest list
// and per-shape locks) with its normalisation and local storage, translated stencil and room-type names, the plan
// SVG with UI-language texts, layers by stencil, the checks (overlaps and narrow aisles that count the chairs around
// tables and ignore pairs in different rooms), and the exports shared by both pages: a standalone SVG at a print
// scale with dimensions and a scale bar, a PNG and printing at scale.
//
// Design rules:
// - Units: plan coordinates are metres (plan/ model). Millimetres appear only at export (mm() for SVG user units,
//   1:ratio for print), so geometry, checks and summaries never deal with scale.
// - The document is { v, plan, guests, locked }: the plan/ model stays reusable by other apps; app-specific data
//   (seating guests, shape locks) lives beside it, not inside shapes.
// - normalizeDoc accepts every format the app has ever written plus a bare plan and the retail planner's files, and
//   never throws, so an old export or a file from a sibling app opens instead of failing.
//
// Side-effect import first: strings.js registers the app's i18n keys before any t() call.
import './strings.js';
import { startApp, t } from '../ui/app.js';
import { h, lsGet, lsSet } from '../ui/dom.js';
import { addIcons } from '../ui/icons.js';
import { UI_STATE } from '../ui/i18n.js';
import { corners, mm, toPlan } from '../plan/geom.js';
import { STENCILS, stencil } from '../plan/stencils.js';
import { fromRetailPlan, normalizePlan, normalizeShape, visibleShapes } from '../plan/model.js';
import { dimensionsSvg, niceLength, pageSVG, planCss } from '../plan/svg.js';
import { SERVICE_ROOMS, areaSummary, contains, isSolid, narrowAisles, outsidePage, overlaps, seatSummary, sleepSummary } from '../plan/summary.js';

export const LOGO = 'M3 3h18v18H3zM3 12h7M14 12h7M10 3v5M10 16v5M14 12v9';

addIcons({
  plan: LOGO,
  seat: 'M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4 21a8 8 0 0 1 16 0',
  pen: 'M4 20l4-1 11-11-3-3L5 16zM14 6l3 3',
  cursor: 'M5 3l14 8-6 2-2 6z',
  hand: 'M8 13V5a1.5 1.5 0 0 1 3 0v6M11 11V3.5a1.5 1.5 0 0 1 3 0V11M14 11V5a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7 6 6 0 0 1-5-3l-2.5-4a1.5 1.5 0 0 1 2.5-1.6L8 13',
  magnet: 'M6 3v8a6 6 0 0 0 12 0V3h-4v8a2 2 0 0 1-4 0V3zM6 7h4M14 7h4',
  angle: 'M4 20h16M4 20L16 6M9 20a6 6 0 0 0-1.5-4',
  ruler: 'M3 17l14-14 4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
  rotate: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  front: 'M4 8h12v12H4zM8 4h12v12',
  dup: 'M9 9h11v11H9zM5 15H4V4h11v1',
  grid: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M18 14a6 6 0 0 1 4 7',
  shuffle: 'M3 7h4l10 10h4M3 17h4l3-3M14 10l3-3h4M18 4l3 3-3 3M18 14l3 3-3 3',
  json: 'M8 4H7a2 2 0 0 0-2 2v4l-2 2 2 2v4a2 2 0 0 0 2 2h1M16 4h1a2 2 0 0 1 2 2v4l2 2-2 2v4a2 2 0 0 1-2 2h-1',
  fit: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
});

// --- shell -----------------------------------------------------------------------------------------------------------

// getAttribute, not a.href: .href is absolute (file:///...), breaking relative links once published.
export function pageHref(id) {
  const a = document.getElementById(id);
  return a ? a.getAttribute('href') : '#';
}

export function startShell(current, onLang) {
  startApp({
    key: 'fp', name: 'fp.name', logo: LOGO, offline: true, onLang,
    pages: [
      { href: pageHref('pg-plan'), label: 'fp.page.plan', current: current === 'plan' },
      { href: pageHref('pg-seating'), label: 'fp.page.seating', current: current === 'seating' },
    ],
  });
}

// The stylesheet of plan/svg.js, once per document.
// Inline <style> (not a file): the same CSS string is embedded into exported SVGs, so screen and file match.
export function ensurePlanCss() {
  if (document.getElementById('fp-plan-css')) return;
  document.head.append(h('style', { id: 'fp-plan-css' }, planCss()));
}

// --- names ---------------------------------------------------------------------------------------------------------

export const stName = (key) => t('fp.st.' + key);
export const ROOM_TYPES = ['room', 'bedroom', 'kitchen', 'bath', 'hallway', 'balcony', 'storage'];
export const ROOM_KINDS = { room: 'room', bedroom: 'bedroom', kitchen: 'kitchen', bath: 'bath', hallway: 'hallway', balcony: 'balcony', storage: 'storage' };
export const roomTypeName = (type) => t('fp.rt.' + (ROOM_TYPES.includes(type) ? type : 'room'));
// Kitchens are not living space in the usual flat paperwork: living = rooms and bedrooms.
export const SERVICE = [...SERVICE_ROOMS, 'kitchen'];
export const shapeName = (sh) => (sh.label ? sh.label : stName(sh.kind));

// Default layers of new pages; their names follow the UI language until the author renames them.
// Detection: a layer whose stored name still equals the English default is shown translated; a renamed one is the
// author's text and stays as typed.
export const LAYERS = [
  { id: 'rooms', name: 'Rooms', visible: true, locked: false },
  { id: 'furniture', name: 'Furniture', visible: true, locked: false },
  { id: 'labels', name: 'Labels', visible: true, locked: false },
];
export function layerName(l) {
  const d = LAYERS.find((x) => x.id === l.id);
  return d && d.name === l.name ? t('fp.layer.' + l.id) : l.name;
}
export function layerFor(page, kind) {
  if (!page.layers) return undefined;
  const st = stencil(kind);
  // Layer by stencil semantics: rooms / zones / building elements -> rooms, annotations -> labels, the rest -> furniture.
  // If the page lacks that layer, the second layer (or the only one) is used.
  const want = st.room || st.zone || kind === 'wall' || kind === 'door' || kind === 'window' || kind === 'stairs' ? 'rooms' : kind === 'text' || kind === 'arrow' || kind === 'line' ? 'labels' : 'furniture';
  return page.layers.some((l) => l.id === want) ? want : page.layers[page.layers.length > 1 ? 1 : 0].id;
}
export const layerOf = (page, sh) => (page.layers && page.layers.some((l) => l.id === sh.layer) ? sh.layer : page.layers ? page.layers[0].id : null);

// --- the document --------------------------------------------------------------------------------------------------

const DKEY = 'fp-doc';
const cleanId = (v) => String(v ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);

// Detection order: our own file ({ plan }), the retail planner ({ items } without pages), else a bare plan/ model.
/** Any JSON -> { v, plan, guests: [{ id, name, table }], locked: [ids] }: our files, a bare plan, old seating charts, retail plans. */
export function normalizeDoc(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  let plan;
  if (d.plan && typeof d.plan === 'object') plan = normalizePlan(d.plan);
  else if (Array.isArray(d.items) && !Array.isArray(d.pages)) plan = fromRetailPlan(d);
  else plan = normalizePlan(d);
  // Pages from bare plans get the default layers so the layer panel always has something to show.
  for (const p of plan.pages) if (!p.layers) p.layers = structuredClone(LAYERS);
  const ids = new Set(plan.pages.flatMap((p) => p.shapes.map((s) => s.id)));
  const guests = (Array.isArray(d.guests) ? d.guests : []).slice(0, 2000).map((g, i) => {
    const name = String(g?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!name) return null;
    // A guest's table must be a shape id that exists; dangling references (deleted tables) become "unseated".
    const table = cleanId(g.table);
    // Fallback id = index + random suffix: unique enough within one document, and never empty.
    return { id: cleanId(g.id) || 'g' + i + Math.random().toString(36).slice(2, 6), name, table: table && ids.has(table) ? table : null };
  }).filter(Boolean);
  // Locks referencing deleted shapes are dropped.
  const locked = (Array.isArray(d.locked) ? d.locked : []).map(cleanId).filter((x) => ids.has(x));
  return { v: 1, plan, guests, locked };
}

export const loadDoc = (fallback) => { const v = lsGet(DKEY, null); return v ? normalizeDoc(v) : fallback(); };
export const saveDoc = (doc) => lsSet(DKEY, doc);
export const DOC_KEY = DKEY;
// `app` marker in saved files lets the importer recognise its own format among JSON files.
export const fileOf = (doc) => ({ app: 'floor-planner', ...doc });

// Seated tables of a page with their guests.
export function tablesOf(doc, page) {
  return page.shapes.filter((s) => stencil(s.kind).seated).map((s) => ({ sh: s, guests: doc.guests.filter((g) => g.table === s.id) }));
}

// --- numbers -------------------------------------------------------------------------------------------------------

const loc = () => UI_STATE.lang || 'en';
// Fixed fraction digits (min = max) so columns of areas line up; locale-aware separators.
export const fmtNum = (v, d = 1) => Number(v).toLocaleString(loc(), { maximumFractionDigits: d, minimumFractionDigits: d });
export const fmtArea = (v) => t('fp.u.m2', { v: fmtNum(v, 1) });
export const fmtLen = (v) => t('fp.u.m', { v: fmtNum(v, 2) });

// --- SVG -----------------------------------------------------------------------------------------------------------

// plan/stencils.js writes a few words into the drawing in English: the sleeping places and the entrance default.
// Coupling note: the regexes match plan/stencils.js output text exactly; changing those words there silently
// leaves them untranslated here. Replacements are escaped because they go back into SVG markup.
export function localizeSvg(svg) {
  return svg.replace(/>(\d+) places?</g, (m, n) => '>' + escText(t('fp.places', { n: +n })) + '<')
    .replace(/>entrance</g, '>' + escText(t('fp.st.entrance').toLowerCase()) + '<');
}
const escText = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

// Edge lengths of room polygons (or the sides of rectangular rooms), in plan coordinates.
export function roomDims(page, ids = null) {
  let out = '';
  for (const sh of visibleShapes(page)) {
    if (!stencil(sh.kind).room) continue;
    if (ids && !ids.has(sh.id)) continue;
    const pts = Array.isArray(sh.pts) ? sh.pts.map((p) => toPlan(sh, p)) : corners(sh);
    out += dimensionsSvg(pts, { size: 0.2, offset: -0.2 });
  }
  return out;
}

export const planSvg = (page, opts) => localizeSvg(pageSVG(page, opts));

/**
 * A standalone SVG of a page for files and print: the plan's stylesheet inside, sizes in millimetres at 1:ratio
 * (0 = free size), edge lengths of the outline and of every room, the page size, a scale bar and a title line.
 */
// Post-processing by string: the plan stylesheet is inserted right after the root <svg> tag and extra layers
// (room dimensions, title, optional seating overlay) before </svg>. The regexes assume pageSVG returns a string
// starting with <svg and ending with </svg>, which plan/svg.js guarantees.
export function exportSvg(doc, page, { ratio = 100, roomDimensions = true, sub = null } = {}) {
  let svg = planSvg(page, { unit: ratio ? 'mm' : undefined, ratio: ratio || 100, scale: true, ruler: true, dims: true, layers: true, title: page.name });
  const a = areaSummary(page, { service: SERVICE }), s = seatSummary(page);
  const parts = [doc.plan.name, page.name, ratio ? '1:' + ratio : '', a.area ? fmtArea(a.area) : '', s.seats ? t('fp.sum.seatsN', { n: s.seats }) : ''].filter(Boolean);
  const len = niceLength(page.w / 4);
  const title = `<text x="${mm(len + 0.8)}" y="${mm(page.h + 0.75)}" font-size="0.3" fill="#334155">${escText(parts.join(' · '))}</text>`;
  const extra = (roomDimensions ? `<g class="fp-dims">${roomDims(page)}</g>` : '') + title + (sub || '');
  svg = svg.replace(/^<svg([^>]*)>/, (m) => `${m}<style>${planCss()}.fp-dims text{fill:#475569}</style>`).replace(/<\/svg>$/, extra + '</svg>');
  return svg;
}

// SVG markup -> PNG Blob at `pxPerMetre` (the SVG gets an explicit pixel size first).
// The SVG's width/height attributes are replaced by explicit pixel sizes: an <img> of an SVG without them may
// rasterise at a default 300x150. White background first: PNG transparency would show as black in some viewers.
// Canvas size limits (about 16k px per side in most browsers) cap pxPerMetre for very large plans.
export function svgToPng(svg, pxPerMetre = 100) {
  const vb = /viewBox="([^"]+)"/.exec(svg)[1].split(' ').map(Number);
  const w = Math.max(1, Math.round(vb[2] * pxPerMetre)), hh = Math.max(1, Math.round(vb[3] * pxPerMetre));
  const sized = svg.replace(/^<svg[^>]*>/, (m) => m.replace(/ (?:width|height)="[^"]*"/g, '').replace('<svg', `<svg width="${w}" height="${hh}"`));
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = w; c.height = hh;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, hh);
      ctx.drawImage(img, 0, 0, w, hh);
      // Revoke as soon as the image is decoded; the canvas holds the pixels from here on.
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('svg')); };
    img.src = url;
  });
}

// --- print ---------------------------------------------------------------------------------------------------------

export const PAPERS = { A4: [210, 297], A3: [297, 420] };
export const RATIOS = [20, 25, 50, 75, 100, 150, 200, 250, 500];

// Size of a page's export in mm at 1:ratio (the SVG viewBox: page + margins + scale bar).
// mm on paper per metre at 1:ratio = 1000 / ratio. The +1.2 m / +0.9 m margins match pageSVG's padding, ruler and
// scale bar, so the computed size equals the exported SVG.
export function printSize(page, ratio) {
  const k = 1000 / ratio;
  return { w: (page.w + 1.2) * k, h: (page.h + 1.2 + 0.9) * k };
}
// The largest standard scale whose drawing fits the printable area (margins 10 mm) of the paper.
export function fitRatio(page, paper, landscape) {
  const [pw, ph] = paperArea(paper, landscape);
  // RATIOS are ascending (largest drawing first), so find() returns the most detailed standard scale that fits;
  // 1:1000 as the last resort.
  return RATIOS.find((r) => { const s = printSize(page, r); return s.w <= pw && s.h <= ph; }) || 1000;
}
export function paperArea(paper, landscape) {
  const [a, b] = PAPERS[paper] || PAPERS.A4;
  return landscape ? [b - 20, a - 20] : [a - 20, b - 20];
}

// Prints `content` (an element) alone on pages of `paper`; the @page rule comes and goes with the print.
// @page is injected only for this print (paper and orientation chosen by the user) and removed afterwards, so
// later browser prints use the defaults again. Cleanup as in the other apps: afterprint plus a timer fallback.
export function printContent(content, { paper = 'A4', landscape = false } = {}) {
  document.getElementById('fp-print')?.remove();
  document.getElementById('fp-page-css')?.remove();
  const box = h('div', { id: 'fp-print', class: 'fp-print' }, content);
  const css = h('style', { id: 'fp-page-css' }, `@page { size: ${paper} ${landscape ? 'landscape' : 'portrait'}; margin: 10mm; }`);
  document.head.append(css);
  document.body.append(box);
  document.body.classList.add('fp-printing');
  const done = () => { document.body.classList.remove('fp-printing'); box.remove(); css.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { window.print(); setTimeout(done, 1000); }, 50);
}

// --- checks --------------------------------------------------------------------------------------------------------

// Chairs stand around a table, outside its box: aisles are measured from the chair backs.
// 0.38 m: depth of a pulled-out dining chair. Round tables grow on every side; rectangular tables on the long sides,
// and on the short ends only when chairs sit there (`ends`).
const CHAIR = 0.38;
export function footprint(sh) {
  const st = stencil(sh.kind);
  if (!st.seated || !(sh.seats > 0)) return sh;
  if (sh.kind === 'table-round') return { ...sh, x: sh.x - CHAIR, y: sh.y - CHAIR, w: sh.w + 2 * CHAIR, h: sh.h + 2 * CHAIR };
  if (sh.kind === 'table-rect') {
    const ex = sh.ends && sh.seats >= 2 ? CHAIR : 0, bottom = sh.seats - (sh.ends ? 2 : 0) > 1 ? CHAIR : 0;
    return { ...sh, x: sh.x - ex, y: sh.y - CHAIR, w: sh.w + 2 * ex, h: sh.h + CHAIR + bottom };
  }
  return sh;
}
// Items that stand against others on purpose (chairs at tables, fixtures in a bathroom) are not aisles.
const AISLE_SKIP = new Set(['chair', 'tv', 'toilet', 'sink', 'shower', 'bathtub', 'washer', 'wall', 'column', 'plant', 'basket-stand']);
export const AISLE_DEFAULT = { floor: 0.6, hall: 0.9, shop: 1 };

// The room a shape stands in (the topmost room containing its centre) or null.
// Topmost first (reverse paint order): with nested rooms the innermost drawn one wins.
function roomOf(page, sh) {
  for (let i = page.shapes.length - 1; i >= 0; i--) {
    const r = page.shapes[i];
    if (r !== sh && stencil(r.kind).room && contains(r, sh)) return r.id;
  }
  return null;
}

/** { overlaps: [{ a, b, depth }], aisles: [{ a, b, gap }], outside: [ids] } of a page. */
// Checks on inflated footprints (tables with their chairs). Aisle candidates ignore items that touch others by
// design; gaps below 12 cm are treated as "touching" (deliberate placement), not as a narrow aisle; pairs in
// different rooms are separated by a wall, so their distance is no aisle either.
export function checkPage(page, aisle) {
  const solid = page.shapes.filter(isSolid);
  const inflated = { ...page, shapes: solid.map(footprint) };
  const ov = overlaps(inflated);
  const rooms = new Map(solid.map((s) => [s.id, roomOf(page, s)]));
  const ai = aisle > 0 ? narrowAisles({ ...page, shapes: inflated.shapes.filter((s) => !AISLE_SKIP.has(s.kind)) }, aisle)
    .filter((x) => x.gap > 0.12 && rooms.get(x.a) === rooms.get(x.b)) : [];
  // Flat items (rugs, zones) and building elements may legitimately reach the page edge.
  const out = outsidePage(page, { filter: (s) => !stencil(s.kind).flat && !['door', 'window', 'wall', 'entrance'].includes(s.kind) });
  return { overlaps: ov, aisles: ai, outside: out };
}

// --- palette previews ----------------------------------------------------------------------------------------------

// A stencil drawn at its default size into a small square SVG (palette buttons, template cards).
// The preview is drawn by the stencil's own draw() at default size, centred in a square; seated stencils get more
// padding for their chairs. Text labels are stripped: at thumbnail size they are noise.
export function stencilPreview(key) {
  const st = STENCILS[key];
  const sh = normalizeShape({ kind: key, x: 0, y: 0, w: st.w, h: st.h, seats: st.seats, label: '' });
  if (st.flat) sh.h = 0;
  const pad = st.seated ? 0.45 : 0.1, w = Math.max(sh.w, 0.3), hh = Math.max(sh.h, 0.3);
  const size = Math.max(w, hh) + pad * 2;
  const ox = (size - sh.w) / 2, oy = (size - sh.h) / 2;
  const body = localizeSvg(st.draw(sh, sh.w, sh.h)).replace(/<text class="plan-s"[^>]*>[^<]*<\/text>/g, '');
  return `<svg viewBox="0 0 ${mm(size)} ${mm(size)}" aria-hidden="true" focusable="false"><g transform="translate(${mm(ox)} ${mm(oy)})">${body}</g></svg>`;
}

export { normalizePlan, normalizeShape, stencil, STENCILS, areaSummary, seatSummary, sleepSummary };

// --- guests --------------------------------------------------------------------------------------------------------

let gseq = 0;
// Time + counter + random: unique across rapid additions in one session and across sessions.
export const guestId = () => 'g' + Date.now().toString(36).slice(-5) + (++gseq).toString(36) + Math.random().toString(36).slice(2, 5);

/** Pasted text -> [{ name, tableLabel }]: one guest per line, "Name; table" or "Name<TAB>table" assigns. */
// Tab first-class because a column copied from a spreadsheet arrives tab-separated.
export function parseGuests(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const [name, table] = line.split(/\t|;/).map((s) => s.replace(/\s+/g, ' ').trim());
    if (name) out.push({ name: name.slice(0, 80), tableLabel: table || '' });
  }
  return out.slice(0, 2000);
}
