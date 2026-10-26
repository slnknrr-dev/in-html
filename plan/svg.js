// plan/svg.js - a plan page as an SVG string: the floor (page rectangle or polygon outline) under an optional grid,
// shapes of visible layers in drawing order (each a translated and rotated <g> around the stencil drawing, carrying
// data-sh and the room key as data-room), selection / highlight / clickable classes, edge-length labels of the
// outline, the page size along the edges, and a scale bar of a round length. The viewBox is in metres; the outer
// size is free (CSS), in px per metre, or in mm at a print scale 1:N. planCss() is the stylesheet, inserted once per
// document however many plans it shows.

import { centroid, edgeMidpoints, mm } from './geom.js';
import { esc, num, stencil } from './stencils.js';
import { normalizePage, visibleShapes } from './model.js';

// Security: every user string reaching the SVG goes through esc(), numbers through num() and colours through the
// allowlist in stencils.js; the output is inserted as markup, so this module is the injection boundary.
const fmtM = (v) => `${Math.round(v * 100) / 100} m`;

// The largest 1 / 2 / 5 x 10^n not above `max`.
export function niceLength(max) {
  if (!(max > 0)) return 0;
  const e = 10 ** Math.floor(Math.log10(max));
  return [5, 2, 1].map((k) => k * e).find((v) => v <= max + 1e-12);
}

function gridDefs(step, id) {
  return `<defs><pattern id="${id}" width="${mm(step)}" height="${mm(step)}" patternUnits="userSpaceOnUse">`
    + `<path d="M${mm(step)} 0L0 0 0 ${mm(step)}" fill="none" stroke="rgba(100,116,139,.28)" stroke-width="0.012"></path></pattern></defs>`;
}

// Page size along the top and left edges, so "16 x 10 m" is seen rather than implied.
export function rulerSvg(p) {
  return `<text class="plan-r" x="${mm(p.w / 2)}" y="-0.16" font-size="0.3" text-anchor="middle">${fmtM(p.w)}</text>`
    + `<text class="plan-r" x="-0.16" y="${mm(p.h / 2)}" font-size="0.3" text-anchor="middle" transform="rotate(-90 -0.16 ${mm(p.h / 2)})">${fmtM(p.h)}</text>`;
}

// Edge lengths of a polygon, written outside each edge (away from the centroid).
export function dimensionsSvg(pts, { size = 0.26, offset = 0.22 } = {}) {
  const c = centroid(pts);
  return edgeMidpoints(pts).map(({ i, at, length }) => {
    if (length < 1e-6) return '';
    const p = pts[i], q = pts[(i + 1) % pts.length];
    let n = [(q[1] - p[1]) / length, -(q[0] - p[0]) / length];
    if ((at[0] - c[0]) * n[0] + (at[1] - c[1]) * n[1] < 0) n = [-n[0], -n[1]];
    let ang = (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI;
    if (ang > 90) ang -= 180; else if (ang < -90) ang += 180;
    const x = at[0] + n[0] * offset, y = at[1] + n[1] * offset;
    return `<text class="plan-dim" x="${mm(x)}" y="${mm(y)}" font-size="${size}" text-anchor="middle" dominant-baseline="central" transform="rotate(${mm(ang)} ${mm(x)} ${mm(y)})">${fmtM(length)}</text>`;
  }).join('');
}

// A scale bar of `len` metres at (x, y): four alternating segments, 0 and the length written above.
export function scaleBarSvg(x, y, len, { size = 0.24 } = {}) {
  const seg = len / 4, hh = Math.max(0.06, size * 0.4);
  let out = '';
  for (let i = 0; i < 4; i++) out += `<rect x="${mm(x + i * seg)}" y="${mm(y)}" width="${mm(seg)}" height="${mm(hh)}" fill="${i % 2 ? '#ffffff' : '#334155'}" stroke="#334155" stroke-width="0.01"></rect>`;
  return `<g class="plan-scale">${out}<text x="${mm(x)}" y="${mm(y - size * 0.4)}" font-size="${size}" text-anchor="middle" fill="#334155">0</text>`
    + `<text x="${mm(x + len)}" y="${mm(y - size * 0.4)}" font-size="${size}" text-anchor="middle" fill="#334155">${fmtM(len)}</text></g>`;
}

/**
 * SVG of a page.
 *   grid     grid step in metres (0 / missing: none)       pad   margin around the page in metres (default 0.6:
 *            chairs of a round table stick out of its frame and would be clipped by the viewBox)
 *   sel      ids of selected shapes ('on')                 hl    room keys to highlight ('hl')
 *   has      room keys that respond to clicks ('kg-has')   cls   extra class of the root
 *   ruler    page size along the edges                     dims  edge lengths of the outline
 *   scale    a scale bar (true = a round length about 1/4 of the page width, or metres)
 *   unit     'mm' with ratio (1:N, default 100) for print, or pxPerMetre for a pixel size; otherwise CSS sizes it
 *   layers   false draws every shape regardless of layer visibility        title  accessible name
 */
export function pageSVG(page, opts = {}) {
  const p = page && Array.isArray(page.shapes) ? page : normalizePage(page || {}, 0);
  const pad = num(opts.pad, 0, 10, 0.6);
  const extra = opts.scale ? 0.9 : 0;
  const vb = [-pad, -pad, p.w + pad * 2, p.h + pad * 2 + extra];
  const sel = new Set(opts.sel ?? []), hl = new Set(opts.hl ?? []), has = new Set(opts.has ?? []);
  const gid = esc(opts.gridId ?? 'plan-g');
  let out = '';
  if (opts.grid) out += gridDefs(num(opts.grid, 0.05, 10, 0.5), gid);
  // The floor is a node of its own UNDER the grid: without it the grid floats on a dark theme and prints transparent.
  const floor = p.outline ? `<polygon class="plan-floor" points="${p.outline.map((q) => mm(q[0]) + ',' + mm(q[1])).join(' ')}"></polygon>`
    : `<rect class="plan-floor" x="0" y="0" width="${mm(p.w)}" height="${mm(p.h)}"></rect>`;
  out += floor;
  if (opts.grid) out += floor.replace('class="plan-floor"', `class="plan-grid" fill="url(#${gid})"`);
  if (p.outline) out += `<polygon class="plan-wall" points="${p.outline.map((q) => mm(q[0]) + ',' + mm(q[1])).join(' ')}" fill="none" stroke="#334155" stroke-width="0.08" stroke-linejoin="round"></polygon>`;

  for (const sh of opts.layers === false ? p.shapes : visibleShapes(p)) {
    const st = stencil(sh.kind);
    const body = st.draw(sh, sh.w, sh.h);
    const rot = sh.rot ? ` rotate(${sh.rot} ${mm(sh.w / 2)} ${mm(sh.h / 2)})` : '';
    const rk = sh.roomKey || '';
    const cls = 'plan-sh' + (sel.has(sh.id) ? ' on' : '') + (sh.mine ? ' me' : '') + (rk && hl.has(rk) ? ' hl' : '') + (rk && has.has(rk) ? ' kg-has' : '');
    out += `<g class="${cls}" data-sh="${esc(sh.id)}"${rk ? ` data-room="${esc(rk)}"` : ''}${sh.ref ? ` data-ref="${esc(sh.ref)}"` : ''} transform="translate(${mm(sh.x)} ${mm(sh.y)})${rot}">${body}</g>`;
  }
  if (opts.dims && p.outline) out += dimensionsSvg(p.outline);
  if (opts.ruler) out += rulerSvg(p);
  if (opts.scale) {
    const len = typeof opts.scale === 'number' ? opts.scale : niceLength(p.w / 4);
    out += scaleBarSvg(0, p.h + 0.6, len);
  }
  let size = '';
  if (opts.unit === 'mm') { const k = 1000 / (opts.ratio ?? 100); size = ` width="${mm(vb[2] * k)}mm" height="${mm(vb[3] * k)}mm"`; }
  else if (opts.pxPerMetre) size = ` width="${mm(vb[2] * opts.pxPerMetre)}" height="${mm(vb[3] * opts.pxPerMetre)}"`;
  return `<svg class="plan-svg${opts.cls ? ' ' + esc(opts.cls) : ''}" viewBox="${vb.map(mm).join(' ')}"${size} preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"`
    + ` font-family="system-ui, sans-serif" role="img" aria-label="${esc(opts.title ?? p.name)}">${out}</svg>`;
}

// The stylesheet of plans (class names above).
export function planCss() {
  return [
    '.plan-svg{display:block;width:100%;height:auto;overflow:visible;font-family:inherit}',
    '.plan-floor{fill:#fff}',
    '.plan-sh .plan-t{font-weight:700;pointer-events:none}',
    '.plan-sh .plan-s{pointer-events:none}',
    '.plan-r,.plan-dim{fill:#64748b}',
    '.plan-sh.on rect,.plan-sh.on circle,.plan-sh.on ellipse,.plan-sh.on polygon{stroke:#2563eb;stroke-width:.06}',
    // a guest's own table is marked by fill and stroke, not only text colour: plans are read on the go, on phones
    '.plan-sh.me circle,.plan-sh.me rect,.plan-sh.me ellipse{stroke:#16a34a;stroke-width:.09}',
    '.plan-sh.me .plan-t{fill:#15803d}',
    '.plan-sh.hl>rect,.plan-sh.hl>polygon{fill:rgba(37,99,235,.2);stroke:#2563eb;stroke-width:.1}',
    '.plan-go .kg-has{cursor:pointer}',
    '.plan-go .kg-has:hover>rect,.plan-go .kg-has:hover>polygon{stroke:#2563eb;stroke-width:.08}',
    '@media print{.plan-floor{fill:#fff}}',
  ].join('');
}
