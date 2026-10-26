// site-studio/wiki-templates-wiki.js - the "Solar System Encyclopedia" template: a Wikipedia-style example base in
// English about the Sun, the planets, their moons and the small bodies. It shows infoboxes with images, hatnotes,
// automatic tables of contents, footnotes with citations (sources and a separate group of notes), a sortable comparison
// table, timelines, an annotated diagram of the Solar System whose hotspots link to the articles, annotated pictures
// (Earth's interior, Saturn's rings), a concept map, a disambiguation page, a redirect, navboxes, categories, galleries,
// "Full article" / "Simple English" versions, toggle layers (imperial units, name origins) and one 451 page with
// editors' notes (password 'draft451'). Figures are rounded, well-established values; the illustrations are flat SVG
// drawings made for this template (not photographs, not to scale unless stated).
import { svgMedia } from './wiki-kit.js';

// ---------------------------------------------------------------------------------------------
// Illustrations: flat planets on a night-blue ground, one light source (upper left).

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const FONT = 'font-family="system-ui, sans-serif"';
const f1 = (n) => +n.toFixed(1);
const BG = '<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#121c45"/><stop offset="1" stop-color="#060a1c"/></linearGradient>';
const SHADE = '<radialGradient id="sh" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".3"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset=".8" stop-color="#000" stop-opacity=".22"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>';
const SUNGRAD = '<radialGradient id="sun" cx=".45" cy=".45" r=".55"><stop offset="0" stop-color="#fff7cf"/><stop offset=".55" stop-color="#ffcb3d"/><stop offset="1" stop-color="#f28c1b"/></radialGradient>' +
  '<radialGradient id="glow" cx=".5" cy=".5" r=".5"><stop offset=".55" stop-color="#ffb52e" stop-opacity=".5"/><stop offset="1" stop-color="#ffb52e" stop-opacity="0"/></radialGradient>';

function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}
// Dots as zero-length round-capped path segments in three sizes: compact for hundreds of stars or grains.
// at() -> [x, y] of the next dot.
function dots(n, seed, at, color, widths, opacities) {
  const r = rng(seed);
  const d = ['', '', ''];
  for (let i = 0; i < n; i++) { const [x, y] = at(r); d[(r() * 3) | 0] += `M${f1(x)} ${f1(y)}h0`; }
  return d.map((p, k) => (p ? `<path d="${p}" stroke="${color}" stroke-width="${widths[k]}" stroke-linecap="round" opacity="${opacities[k]}"/>` : '')).join('');
}
const stars = (w, h, n, seed) => dots(n, seed, (r) => [r() * w, r() * h], '#fff', [1, 1.6, 2.2], [0.45, 0.65, 0.9]);
// Scattered small rocks or ice grains in a box (asteroid belt, Kuiper belt).
const grains = (x0, x1, y0, y1, n, color, seed) => dots(n, seed, (r) => [x0 + r() * (x1 - x0), y0 + r() * (y1 - y0)], color, [1.8, 2.6, 3.4], [0.7, 0.85, 1]);
// A sphere: base colour, features clipped to the disc, soft shading on top.
const ball = (cx, cy, r, fill, inner, id) => `<clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath><circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>` +
  `${inner ? `<g clip-path="url(#${id})">${inner}</g>` : ''}<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#sh)"/>`;
// Horizontal cloud bands: [from, to, colour, opacity] in units of the radius (-1 top … 1 bottom).
const bands = (cx, cy, r, list) => list.map(([a, b, c, o]) => `<rect x="${f1(cx - r)}" y="${f1(cy + a * r)}" width="${f1(2 * r)}" height="${f1((b - a) * r)}" fill="${c}"${o ? ` opacity="${o}"` : ''}/>`).join('');
// A flat ring: the area between two ellipses (flattening k).
const ring = (cx, cy, r1, r2, k, fill, o) => `<path fill-rule="evenodd" fill="${fill}"${o ? ` opacity="${o}"` : ''} d="M${f1(cx - r2)} ${cy}a${r2} ${f1(r2 * k)} 0 1 0 ${f1(2 * r2)} 0a${r2} ${f1(r2 * k)} 0 1 0 ${f1(-2 * r2)} 0zM${f1(cx - r1)} ${cy}a${r1} ${f1(r1 * k)} 0 1 0 ${f1(2 * r1)} 0a${r1} ${f1(r1 * k)} 0 1 0 ${f1(-2 * r1)} 0z"/>`;
const doc = (w, h, defs, body) => `<svg ${NS} viewBox="0 0 ${w} ${h}"><defs>${defs}</defs>${body}</svg>`;
const space = (w, h, seed, n = 36) => `<rect width="${w}" height="${h}" rx="10" fill="url(#bg)"/>${stars(w, h, n, seed)}`;
// One planet in the middle of a 240 × 240 picture (radius 92).
const single = (fill, inner, seed, o = {}) => doc(240, 240, BG + SHADE + (o.defs || ''), space(240, 240, seed) + (o.under || '') + ball(120, 120, 92, fill, inner, 'c') + (o.over || ''));

// Saturn's main rings in planet radii (C 1.24-1.53, B 1.53-1.95, Cassini Division 1.95-2.03, A 2.03-2.27): drawn
// once behind the planet and once more, clipped to the near half, in front of it.
const SAT_RINGS = { c: [1.24, 1.53], b: [1.53, 1.95], cd: [1.95, 2.03], a: [2.03, 2.27] };
function saturnRings(cx, cy, r, k, id) {
  const R = (x) => f1(x * r);
  const all = ring(cx, cy, R(SAT_RINGS.c[0]), R(SAT_RINGS.c[1]), k, '#9d8b69', '.75') + ring(cx, cy, R(SAT_RINGS.b[0]), R(SAT_RINGS.b[1]), k, '#ecdcae') +
    ring(cx, cy, R(SAT_RINGS.a[0]), R(SAT_RINGS.a[1]), k, '#cdb98b');
  return { back: all, front: `<clipPath id="${id}"><rect x="${f1(cx - R(2.4))}" y="${cy}" width="${R(4.8)}" height="${R(1.2)}"/></clipPath><g clip-path="url(#${id})">${all}</g>` };
}
const SAT_BANDS = [[-0.95, -0.62, '#d4b06c'], [-0.4, -0.25, '#c9a35e', '.7'], [0.05, 0.22, '#f3e3b8'], [0.42, 0.58, '#d4b06c', '.8'], [0.75, 1, '#c9a35e', '.7']];
const JUP_BANDS = [[-1, -0.78, '#c69b74'], [-0.62, -0.46, '#b07a52'], [-0.3, -0.1, '#a8693f'], [0.08, 0.27, '#b5764b'], [0.42, 0.54, '#c3916a'], [0.68, 0.82, '#c69b74']];

const EARTH_FEATURES = '<path d="M58 70c18-22 52-30 70-16 10 8 2 20 12 30s22 14 14 30c-8 14-28 10-34 24-6 12-20 18-30 8-8-8 0-22-10-30S40 100 46 88s4-12 12-18z" fill="#58a34a"/>' +
  '<path d="M150 118c16-10 40-4 46 14 5 16-6 36-22 44-12 6-26-2-26-16 0-12-10-30 2-42z" fill="#7aa950"/><path d="M104 150c8-4 18 0 18 10s-10 16-18 12-8-18 0-22z" fill="#c8a466"/>' +
  '<g fill="none" stroke="#fff" stroke-linecap="round" opacity=".8"><path d="M40 112q30-12 64-2" stroke-width="7"/><path d="M128 72q26-10 52 0" stroke-width="6"/><path d="M118 196q28 6 58-6" stroke-width="7"/><path d="M60 170q16 8 30 4" stroke-width="5"/></g>' +
  '<ellipse cx="120" cy="30" rx="56" ry="14" fill="#f4f8ff"/><ellipse cx="120" cy="212" rx="50" ry="12" fill="#f4f8ff"/>';

const crater = (x, y, r, dark, light) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${dark}"/><circle cx="${f1(x - r * 0.2)}" cy="${f1(y - r * 0.2)}" r="${f1(r * 0.72)}" fill="${light}"/>`;

const SVG = {
  sun: () => doc(240, 240, BG + SUNGRAD, space(240, 240, 3) + '<circle cx="120" cy="120" r="118" fill="url(#glow)"/><circle cx="120" cy="120" r="86" fill="url(#sun)"/>' +
    '<g fill="none" stroke="#ffe39a" stroke-width="3" stroke-linecap="round" opacity=".6"><path d="M70 92q14-10 30-4"/><path d="M138 70q16 0 24 10"/><path d="M84 160q18 8 34 2"/><path d="M150 150q10-12 22-10"/></g>' +
    '<g fill="#b4561c" opacity=".8"><circle cx="96" cy="112" r="5"/><circle cx="105" cy="116" r="3"/><circle cx="150" cy="134" r="4"/><circle cx="157" cy="129" r="2.5"/></g>'),
  mercury: () => single('#9e9893', '<path d="M28 128c40-18 70 6 100-4s60-22 84-6v92H28z" fill="#aaa49f" opacity=".6"/>' +
    [[90, 82, 14], [150, 68, 9], [136, 142, 18], [78, 150, 10], [172, 118, 8], [110, 184, 7], [58, 110, 6], [176, 168, 11], [118, 44, 6]].map(([x, y, r]) => crater(x, y, r, '#7f7a75', '#938d88')).join(''), 11),
  venus: () => single('#e6c27f', '<path d="M20 70Q70 55 120 72T220 66V86Q170 96 120 84T20 92Z" fill="#f2d9a2" opacity=".8"/><path d="M20 120Q80 100 130 122T220 112V136Q160 150 110 136T20 142Z" fill="#d7a95e" opacity=".6"/>' +
    '<path d="M20 160Q90 150 140 168T220 158V176Q160 190 110 178T20 184Z" fill="#f4dfb0" opacity=".7"/><path d="M20 40Q90 30 140 44T220 36V50Q150 60 100 52T20 56Z" fill="#d7a95e" opacity=".45"/>', 12),
  earth: () => single('#2c6fd1', EARTH_FEATURES, 13),
  moon: () => single('#bdb9b1', '<path d="M70 60c20-10 44-6 50 10s-6 30-26 32-36-10-38-22 4-14 14-20z" fill="#8f8b84"/><path d="M126 92c14-8 34-4 40 8s0 26-14 30-30 0-34-12 0-20 8-26z" fill="#96928b"/>' +
    '<path d="M84 122c12-6 26 0 26 12s-12 20-24 16-14-22-2-28z" fill="#8f8b84"/><path d="M140 46c10-4 22 2 20 12s-14 10-20 4-8-12 0-16z" fill="#999590"/>' +
    [[150, 170, 12], [90, 186, 8], [60, 150, 6], [176, 130, 6], [110, 44, 5]].map(([x, y, r]) => crater(x, y, r, '#a9a59e', '#cfccc5')).join(''), 14),
  mars: () => single('#c4521f', '<path d="M30 130c30-10 50 8 80 0s50-20 80-6 20 30 20 30v60H30z" fill="#9c3d16" opacity=".55"/><path d="M60 70c20-8 40 4 60-2s30-10 44 2c-10 14-34 10-50 16s-40 4-54-16z" fill="#a8461b" opacity=".6"/>' +
    '<path d="M72 122q30-8 56 0t50-6" stroke="#7a2a0e" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="70" cy="100" r="10" fill="#d97a45"/><circle cx="70" cy="100" r="4" fill="#b85a2a"/>' +
    '<ellipse cx="120" cy="32" rx="44" ry="12" fill="#fbf4ee"/><ellipse cx="128" cy="212" rx="30" ry="8" fill="#fbf4ee" opacity=".9"/>', 15),
  jupiter: () => single('#e7cfae', bands(120, 120, 92, JUP_BANDS) +
    '<g fill="none" stroke="#f7ead8" stroke-width="3" stroke-linecap="round" opacity=".7"><path d="M40 98q20-6 40 0t40 0"/><path d="M120 148q22 6 44 0"/></g>' +
    '<ellipse cx="148" cy="150" rx="19" ry="11" fill="#c1543a" stroke="#e9b394" stroke-width="3"/>', 16),
  saturn: () => {
    const R = saturnRings(160, 110, 52, 0.3, 'f');
    return doc(320, 220, BG + SHADE, space(320, 220, 17, 44) + R.back + ball(160, 110, 52, '#e6cf98', bands(160, 110, 52, SAT_BANDS), 'c') + R.front);
  },
  uranus: () => single('#a5e1e8', bands(120, 120, 92, [[-0.25, 0.1, '#bdeef2', '.7'], [0.55, 0.75, '#93d3db', '.6']]), 18, {
    under: '<ellipse cx="120" cy="120" rx="18" ry="114" fill="none" stroke="#d8f3f6" stroke-width="2.5" opacity=".55"/>',
    over: '<clipPath id="u"><rect x="0" y="0" width="120" height="240"/></clipPath><g clip-path="url(#u)" fill="none" stroke="#e6f8fa" opacity=".8"><ellipse cx="120" cy="120" rx="18" ry="114" stroke-width="2.5"/><ellipse cx="120" cy="120" rx="15" ry="104" stroke-width="1.2"/></g>',
  }),
  neptune: () => single('#3b62d4', bands(120, 120, 92, [[-0.55, -0.38, '#5079e6', '.6'], [0.18, 0.32, '#2f50b8', '.8'], [0.6, 0.72, '#4a71dd', '.6']]) +
    '<ellipse cx="96" cy="132" rx="18" ry="10" fill="#1f3590"/><g stroke="#e8f0ff" stroke-linecap="round" fill="none" opacity=".85"><path d="M112 124q16-4 30 0" stroke-width="4"/><path d="M60 86q14-4 28 0" stroke-width="3"/><path d="M140 168q12-3 24 0" stroke-width="3"/></g>', 19),
  pluto: () => single('#c7a07a', '<path d="M28 130c20 8 46 6 66-2 8 10 4 26-10 34-20 10-46 6-58-6z" fill="#6f4a33"/><path d="M40 80c16-6 30-2 40 6-6 10-22 12-34 8z" fill="#a77d5a" opacity=".7"/>' +
    '<path d="M132 112c6-18 30-22 40-8 10 14 2 34-14 50-8 8-16 14-22 22-8-12-20-18-26-28-10-16-4-34 10-38 6-2 10 0 12 2z" fill="#f2e4cf"/><path d="M150 190q20-6 36 4" stroke="#a77d5a" stroke-width="5" fill="none" opacity=".6"/>', 20),
};

// Dwarf planets (and the Moon for scale) drawn to scale: 100 px = 3,475 km.
function dwarfsSVG() {
  const k = 100 / 3475, cy = 80;
  const list = [['Moon (for scale)', 56, 3475, '#bdb9b1'], ['Pluto', 158, 2377, '#c7a07a'], ['Eris', 240, 2326, '#ebe9e4'], ['Makemake', 404, 1430, '#c98b5e'], ['Ceres', 470, 940, '#8a8580']];
  const label = (x, t) => `<text x="${x}" y="152" text-anchor="middle" fill="#dfe6ff" font-size="13" ${FONT}>${t}</text>`;
  let body = space(510, 180, 21, 50);
  list.forEach(([name, x, d, c], i) => { body += ball(x, cy, f1((d * k) / 2), c, '', 'd' + i) + label(x, name); });
  // Haumea is elongated: an ellipse of roughly its longest and middle axes.
  const hm = `cx="322" cy="${cy}" rx="${f1((2300 * k) / 2)}" ry="${f1((1700 * k) / 2)}"`;
  body += `<ellipse ${hm} fill="#dcdde0"/><ellipse ${hm} fill="url(#sh)"/>` + label(322, 'Haumea');
  return doc(510, 180, BG + SHADE, body);
}

// The eight planets to scale (sizes only): Jupiter's diameter = 180 px.
function sizesSVG() {
  const k = 180 / 142984, cy = 120;
  const r = (d) => f1((d * k) / 2);
  let body = space(820, 260, 22, 70);
  const label = (x, y, t, anchor = 'middle') => `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="#dfe6ff" font-size="14" ${FONT}>${t}</text>`;
  [['Mercury', 50, 4879, '#9e9893'], ['Venus', 88, 12104, '#e6c27f'], ['Earth', 132, 12756, '#2c6fd1'], ['Mars', 176, 6792, '#c4521f']].forEach(([n, y, d, c], i) => {
    body += ball(30, y, r(d), c, '', 's' + i) + label(48, y + 5, n, 'start');
  });
  body += ball(190, cy, r(142984), '#e7cfae', bands(190, cy, r(142984), JUP_BANDS) + `<ellipse cx="${f1(190 + 0.3 * r(142984))}" cy="${f1(cy + 0.33 * r(142984))}" rx="18" ry="10" fill="#c1543a"/>`, 'sj') + label(190, 244, 'Jupiter');
  const rs = r(120536), R = saturnRings(470, cy, rs, 0.18, 'sf');
  body += R.back + ball(470, cy, rs, '#e6cf98', bands(470, cy, rs, SAT_BANDS), 'ss') + R.front + label(470, 244, 'Saturn');
  body += ball(700, cy, r(51118), '#a5e1e8', '', 'su') + label(700, 244, 'Uranus');
  body += ball(780, cy, r(49528), '#3b62d4', '', 'sn') + label(780, 244, 'Neptune');
  return doc(820, 260, BG + SHADE, body);
}

// Top view of the orbits (not to scale), with the asteroid belt and the Kuiper belt.
function orbitsSVG() {
  const c = 120;
  const annulus = (r0, r1) => (r) => { const a = r() * 6.2832, d = r0 + r() * (r1 - r0); return [c + d * Math.cos(a), c + d * Math.sin(a)]; };
  let body = space(240, 240, 24, 30);
  body += dots(80, 23, annulus(45, 53), '#a99d8f', [1.4, 1.8, 2.2], [0.7, 0.85, 1]) + dots(140, 25, annulus(106, 117), '#9fb3c8', [1.4, 1.8, 2.2], [0.6, 0.8, 1]);
  body += '<g fill="none" stroke="#8a9ad0" stroke-width=".8" opacity=".55">' + [14, 22, 30, 38, 62, 76, 88, 98].map((d) => `<circle cx="${c}" cy="${c}" r="${d}"/>`).join('') + '</g>';
  body += `<circle cx="${c}" cy="${c}" r="14" fill="url(#glow)"/><circle cx="${c}" cy="${c}" r="7" fill="url(#sun)"/>`;
  [[14, 30, 1.8, '#9e9893'], [22, 200, 2.6, '#e6c27f'], [30, 110, 2.8, '#3b7be0'], [38, 300, 2.2, '#c4521f'], [62, 240, 5, '#e1bf95'], [76, 60, 4.4, '#e6cf98'], [88, 160, 3.4, '#a5e1e8'], [98, 330, 3.3, '#3b62d4']].forEach(([d, deg, s, col]) => {
    const a = (deg * Math.PI) / 180;
    body += `<circle cx="${f1(c + d * Math.cos(a))}" cy="${f1(c + d * Math.sin(a))}" r="${s}" fill="${col}"/>`;
  });
  return doc(240, 240, BG + SUNGRAD, body);
}

// Irregular rocks of the asteroid belt.
function asteroidsSVG() {
  const r = rng(31);
  const rock = (cx, cy, s, fill) => {
    let d = '';
    for (let i = 0; i < 10; i++) { const a = (i / 10) * 6.2832, q = s * (0.72 + r() * 0.4); d += (i ? 'L' : 'M') + f1(cx + q * Math.cos(a)) + ' ' + f1(cy + q * 0.8 * Math.sin(a)); }
    return `<path d="${d}Z" fill="${fill}"/><path d="${d}Z" fill="url(#sh)"/>`;
  };
  let body = space(320, 200, 32, 50) + '<circle cx="330" cy="20" r="70" fill="url(#glow)"/>' + grains(0, 320, 20, 190, 70, '#8f8478', 33);
  body += rock(92, 112, 46, '#8b8178') + crater(80, 104, 8, '#6f665e', '#7d746b') + crater(108, 128, 6, '#6f665e', '#7d746b');
  body += rock(214, 70, 24, '#a39484') + rock(250, 150, 16, '#6f6a66') + rock(178, 160, 10, '#9a8a77') + rock(30, 40, 9, '#7c7470') + rock(286, 96, 7, '#9a8a77');
  return doc(320, 200, BG + SHADE + SUNGRAD, body);
}

// A comet near the Sun: the dust tail curves, the ion tail points straight away from the Sun.
function cometSVG() {
  const defs = BG + SUNGRAD + '<linearGradient id="ion" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="#8fd3ff" stop-opacity=".9"/><stop offset="1" stop-color="#8fd3ff" stop-opacity="0"/></linearGradient>' +
    '<linearGradient id="dust" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff1c4" stop-opacity=".9"/><stop offset="1" stop-color="#fff1c4" stop-opacity="0"/></linearGradient>' +
    '<radialGradient id="coma" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="#e9f6ff" stop-opacity=".85"/><stop offset="1" stop-color="#bfe6ff" stop-opacity="0"/></radialGradient>';
  const body = space(320, 200, 41, 60) + '<circle cx="345" cy="74" r="70" fill="url(#glow)"/>' +
    '<path d="M236 66Q120 72 6 150L30 176Q140 102 238 84Z" fill="url(#dust)"/><path d="M236 70L0 50V94Z" fill="url(#ion)"/>' +
    '<circle cx="236" cy="74" r="28" fill="url(#coma)"/><circle cx="236" cy="74" r="4" fill="#fff"/>';
  return doc(320, 200, defs, body);
}

// A Voyager spacecraft: high-gain antenna, bus with the Golden Record, booms.
function voyagerSVG() {
  const body = space(320, 220, 51, 60) +
    '<g stroke-linecap="round"><path d="M150 122L36 206" stroke="#a9b1bd" stroke-width="1.6"/><path d="M178 112L276 156" stroke="#8a94a3" stroke-width="3"/><path d="M124 112L66 146" stroke="#8a94a3" stroke-width="3"/></g>' +
    '<g fill="#cfd5dd" stroke="#7d8794"><rect x="236" y="134" width="16" height="9" rx="2" transform="rotate(24 244 138)"/><rect x="252" y="141" width="16" height="9" rx="2" transform="rotate(24 260 145)"/><rect x="268" y="148" width="16" height="9" rx="2" transform="rotate(24 276 152)"/></g>' +
    '<rect x="44" y="140" width="28" height="18" rx="2" fill="#6b7480"/><rect x="50" y="134" width="10" height="8" fill="#9aa4b2"/>' +
    '<path d="M126 92H176L182 108L176 124H126L120 108Z" fill="#9aa4b2" stroke="#6b7480"/><circle cx="164" cy="108" r="8" fill="#d8ab3a" stroke="#a87d1c"/>' +
    '<path d="M134 92L150 72L166 92" fill="none" stroke="#8a94a3" stroke-width="2"/>' +
    '<ellipse cx="150" cy="70" rx="64" ry="22" fill="#eef1f5" stroke="#b8c0cc" stroke-width="2"/><ellipse cx="150" cy="68" rx="50" ry="16" fill="#dfe4ea"/>' +
    '<path d="M150 68V44" stroke="#8a94a3" stroke-width="3"/><rect x="144" y="38" width="12" height="8" rx="2" fill="#cfd5dd" stroke="#7d8794"/>';
  return doc(320, 220, BG, body);
}

function goldenRecordSVG() {
  const defs = BG + '<radialGradient id="gold" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#f8dd86"/><stop offset=".6" stop-color="#d4a23a"/><stop offset="1" stop-color="#a8751c"/></radialGradient>';
  let grooves = '';
  for (let r = 40; r <= 96; r += 5) grooves += `<circle cx="120" cy="120" r="${r}"/>`;
  const body = space(240, 240, 52, 30) + '<circle cx="120" cy="120" r="100" fill="url(#gold)"/>' +
    `<g fill="none" stroke="#9c6f1e" stroke-width=".8" opacity=".55">${grooves}</g>` +
    '<circle cx="120" cy="120" r="30" fill="#e2bb5a"/><circle cx="120" cy="120" r="4" fill="#3a2a0a"/>' +
    '<path d="M60 70A80 80 0 0 1 120 40" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".35"/>';
  return doc(240, 240, defs, body);
}

// A six-wheeled Mars rover on rusty ground.
function roverSVG() {
  const defs = '<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e2a979"/><stop offset="1" stop-color="#f6dcb8"/></linearGradient>';
  const wheel = (x) => `<circle cx="${x}" cy="152" r="13" fill="#3b3f45"/><circle cx="${x}" cy="152" r="5" fill="#9aa0a6"/>`;
  const body = '<rect width="320" height="200" rx="10" fill="url(#sky)"/><circle cx="262" cy="40" r="10" fill="#fff6dd" opacity=".85"/>' +
    '<path d="M0 120Q60 100 120 116T240 108T320 118V200H0Z" fill="#c46a3a"/><path d="M0 150Q80 136 160 152T320 146V200H0Z" fill="#a9532a"/>' +
    '<path d="M40 176l10-8 14 3 4 7z M262 170l8-7 12 2 3 6z M200 184l6-5 8 2 2 4z" fill="#7d3a1c"/>' +
    '<path d="M108 152L130 128H190L214 152M160 128V152" fill="none" stroke="#5d636b" stroke-width="4" stroke-linejoin="round"/>' +
    wheel(108) + wheel(160) + wheel(214) +
    '<rect x="112" y="104" width="112" height="26" rx="3" fill="#e9e4dc" stroke="#9a948b" stroke-width="2"/><rect x="216" y="96" width="22" height="16" rx="3" fill="#cfcac2" stroke="#9a948b" transform="rotate(-20 227 104)"/>' +
    '<rect x="196" y="58" width="6" height="48" fill="#cfcac2"/><rect x="186" y="48" width="26" height="13" rx="2" fill="#5d636b"/><circle cx="192" cy="54" r="3" fill="#a9d4ff"/><circle cx="204" cy="54" r="3" fill="#a9d4ff"/>' +
    '<path d="M132 104V90" stroke="#9a948b" stroke-width="2"/><ellipse cx="132" cy="88" rx="10" ry="4" fill="#e9e4dc" stroke="#9a948b"/>';
  return doc(320, 200, defs, body);
}

// The eight phases of the Moon, as seen from the Northern Hemisphere.
function moonPhasesSVG() {
  const names = [['New', 'moon'], ['Waxing', 'crescent'], ['First', 'quarter'], ['Waxing', 'gibbous'], ['Full', 'moon'], ['Waning', 'gibbous'], ['Third', 'quarter'], ['Waning', 'crescent']];
  const r = 34, cy = 56;
  let body = space(800, 140, 61, 50);
  names.forEach(([a, b], i) => {
    const cx = 50 + i * 100;
    body += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#2a3150" stroke="#4a5378"/>`;
    if (i === 4) body += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ece8dc"/>`;
    else if (i) {
      const waxing = i < 4, deg = (waxing ? i : 8 - i) * 45, rx = f1(Math.abs(Math.cos((deg * Math.PI) / 180)) * r);
      const outer = `M${cx} ${cy - r}A${r} ${r} 0 0 ${waxing ? 1 : 0} ${cx} ${cy + r}`;
      const crescent = deg < 90;
      const back = deg === 90 ? `L${cx} ${cy - r}` : `A${rx} ${r} 0 0 ${waxing ? (crescent ? 0 : 1) : (crescent ? 1 : 0)} ${cx} ${cy - r}`;
      body += `<path d="${outer}${back}Z" fill="#ece8dc"/>`;
    }
    body += `<text x="${cx}" y="112" text-anchor="middle" fill="#dfe6ff" font-size="12" ${FONT}>${a}</text><text x="${cx}" y="127" text-anchor="middle" fill="#dfe6ff" font-size="12" ${FONT}>${b}</text>`;
  });
  return doc(800, 140, BG, body);
}

// Earth with a cut-away quarter showing its layers (crust thickness exaggerated). Geometry shared with the diagram.
const EL = { w: 600, h: 400, cx: 200, cy: 200, R: 170, crust: 9 };
const elR = (km) => f1((km / 6371) * EL.R);
function earthLayersSVG() {
  const { cx, cy, R } = EL;
  const sector = (r, fill) => `<path d="M${cx} ${cy}L${cx} ${f1(cy - r)}A${r} ${r} 0 0 1 ${f1(cx + r)} ${cy}Z" fill="${fill}"/>`;
  const defs = BG + SHADE + `<radialGradient id="mantle" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${R - EL.crust}"><stop offset=".5" stop-color="#f7a24c"/><stop offset="1" stop-color="#c4471f"/></radialGradient>` +
    `<radialGradient id="oc" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${elR(3480)}"><stop offset=".3" stop-color="#ffd166"/><stop offset="1" stop-color="#f59e2b"/></radialGradient>` +
    `<radialGradient id="ic" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${elR(1220)}"><stop offset="0" stop-color="#fffbe6"/><stop offset="1" stop-color="#ffe066"/></radialGradient>`;
  const body = space(EL.w, EL.h, 71, 60) + `<circle cx="${cx}" cy="${cy}" r="${R + 10}" fill="#7fb8ff" opacity=".28"/>` +
    ball(cx, cy, R, '#2c6fd1', `<g transform="translate(${cx} ${cy}) scale(${f1(R / 92)}) translate(-120 -120)">${EARTH_FEATURES}</g>`, 'e') +
    sector(R, '#8a6446') + sector(R - EL.crust, 'url(#mantle)') + sector(elR(3480), 'url(#oc)') + sector(elR(1220), 'url(#ic)') +
    `<path d="M${cx} ${cy - R}V${cy}H${cx + R}" fill="none" stroke="#5b3d26" stroke-width="2"/>`;
  return doc(EL.w, EL.h, defs, body);
}

// The Sun and the planets in a row (sizes and distances not to scale). Geometry shared with the diagram.
const SS = {
  w: 1000, h: 300, cy: 150,
  // [slug, label, x, radius, colour, label above?]
  planets: [['mercury', 'Mercury', 150, 5, '#9e9893', 1], ['venus', 'Venus', 200, 10, '#e6c27f', 0], ['earth', 'Earth', 255, 11, '#2c6fd1', 1], ['mars', 'Mars', 305, 7, '#c4521f', 0],
    ['jupiter', 'Jupiter', 425, 55, '#e7cfae', 0], ['saturn', 'Saturn', 595, 45, '#e6cf98', 1], ['uranus', 'Uranus', 750, 25, '#a5e1e8', 0], ['neptune', 'Neptune', 840, 24, '#3b62d4', 1]],
  belt: [330, 362, 92, 208], kuiper: [878, 996, 70, 230], pluto: [950, 112, 4],
};
function solarSystemSVG() {
  const { w, h, cy } = SS;
  let body = `<rect width="${w}" height="${h}" fill="url(#bg)"/>` + stars(w, h, 110, 81) + `<circle cx="-60" cy="${cy}" r="215" fill="url(#glow)"/><circle cx="-60" cy="${cy}" r="150" fill="url(#sun)"/>`;
  body += grains(SS.belt[0], SS.belt[1], SS.belt[2], SS.belt[3], 46, '#a99d8f', 82) + grains(SS.kuiper[0], SS.kuiper[1], SS.kuiper[2], SS.kuiper[3], 90, '#9fb3c8', 83);
  for (const [slug, , x, r, col] of SS.planets) {
    let inner = '';
    if (slug === 'jupiter') inner = bands(x, cy, r, JUP_BANDS) + `<ellipse cx="${f1(x + 0.3 * r)}" cy="${f1(cy + 0.33 * r)}" rx="${f1(0.2 * r)}" ry="${f1(0.11 * r)}" fill="#c1543a"/>`;
    if (slug === 'saturn') inner = bands(x, cy, r, SAT_BANDS);
    if (slug === 'earth') inner = `<path d="M${x - 6} ${cy - 5}q5-4 9 0t3 7-6 3-6-10z" fill="#58a34a"/>`;
    if (slug === 'neptune') inner = `<ellipse cx="${x - 6}" cy="${cy + 4}" rx="5" ry="3" fill="#1f3590"/>`;
    if (slug === 'saturn') {
      const R = saturnRings(x, cy, r, 0.28, 'sr');
      body += R.back + ball(x, cy, r, col, inner, 'p' + slug) + R.front;
    } else if (slug === 'uranus') {
      body += ball(x, cy, r, col, inner, 'p' + slug) + `<ellipse cx="${x}" cy="${cy}" rx="6" ry="${r + 12}" fill="none" stroke="#d8f3f6" stroke-width="1.5" opacity=".7"/>`;
    } else body += ball(x, cy, r, col, inner, 'p' + slug);
  }
  body += ball(SS.pluto[0], SS.pluto[1], SS.pluto[2], '#c7a07a', '', 'ppluto');
  return doc(w, h, BG + SHADE + SUNGRAD, body);
}

function bannerSVG() {
  const defs = '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1230"/><stop offset="1" stop-color="#22134a"/></linearGradient>' + SHADE + SUNGRAD;
  const sx = 1140, sy = 180;
  let body = '<rect width="1200" height="360" fill="url(#bg)"/>' + stars(1200, 360, 160, 91) + `<circle cx="${sx}" cy="${sy}" r="230" fill="url(#glow)"/><circle cx="${sx}" cy="${sy}" r="110" fill="url(#sun)"/>`;
  const orbits = [[300, 200, 9, '#3b7be0'], [420, 165, 7, '#c4521f'], [560, 192, 26, '#e7cfae'], [720, 172, 20, '#e6cf98'], [880, 186, 11, '#3b62d4']];
  body += '<g fill="none" stroke="#8fa3d9" stroke-width="1.2" opacity=".28">' + orbits.map(([rx]) => `<ellipse cx="${sx}" cy="${sy}" rx="${rx}" ry="${f1(rx * 0.28)}"/>`).join('') + '</g>';
  orbits.forEach(([rx, deg, r, col], i) => {
    const a = (deg * Math.PI) / 180, x = f1(sx + rx * Math.cos(a)), y = f1(sy + rx * 0.28 * Math.sin(a));
    const inner = i === 2 ? bands(x, y, r, JUP_BANDS) : i === 3 ? bands(x, y, r, SAT_BANDS) : '';
    if (i === 3) { const R = saturnRings(x, y, r, 0.3, 'br'); body += R.back + ball(x, y, r, col, inner, 'b' + i) + R.front; } else body += ball(x, y, r, col, inner, 'b' + i);
  });
  return doc(1200, 360, defs, body);
}

function logoSVG() {
  return doc(64, 64, SHADE, '<rect width="64" height="64" rx="14" fill="#14213d"/><ellipse cx="32" cy="33" rx="25" ry="8" fill="none" stroke="#ffe5a8" stroke-width="3" transform="rotate(-18 32 33)"/>' +
    ball(32, 32, 14, '#f2c46d', '<rect x="18" y="27" width="28" height="4" fill="#d9a54a"/><rect x="18" y="35" width="28" height="3" fill="#f8dc9a"/>', 'l') +
    '<clipPath id="lf"><rect x="0" y="33" width="64" height="31" transform="rotate(-18 32 33)"/></clipPath><ellipse cx="32" cy="33" rx="25" ry="8" fill="none" stroke="#ffe5a8" stroke-width="3" transform="rotate(-18 32 33)" clip-path="url(#lf)"/>');
}

function media() {
  const m = (svg, name, alt) => svgMedia(svg, { name, alt });
  return {
    logo: m(logoSVG(), 'logo.svg', 'A ringed planet'),
    banner: m(bannerSVG(), 'banner.svg', 'The Sun and planets on their orbits against a starry sky'),
    solarsystem: m(solarSystemSVG(), 'solar-system.svg', 'The Sun at the left edge and the eight planets in a row, with the asteroid belt after Mars and the Kuiper belt and Pluto beyond Neptune'),
    orbits: m(orbitsSVG(), 'orbits.svg', 'Top view of the Sun and the circular orbits of the planets, with a ring of asteroids between Mars and Jupiter and a ring of icy bodies beyond Neptune'),
    sun: m(SVG.sun(), 'sun.svg', 'The Sun: a glowing yellow-orange disc with a few dark sunspots'),
    mercury: m(SVG.mercury(), 'mercury.svg', 'Mercury: a grey, heavily cratered planet'),
    venus: m(SVG.venus(), 'venus.svg', 'Venus: a pale yellow planet covered in swirling clouds'),
    earth: m(SVG.earth(), 'earth.svg', 'Earth: blue oceans, green and brown continents, white clouds and polar ice'),
    moon: m(SVG.moon(), 'moon.svg', 'The Moon: a grey disc with dark plains and bright craters'),
    mars: m(SVG.mars(), 'mars.svg', 'Mars: a rusty red planet with dark regions, a long canyon and a white polar cap'),
    jupiter: m(SVG.jupiter(), 'jupiter.svg', 'Jupiter: a striped planet of cream and brown cloud bands with the Great Red Spot'),
    saturn: m(SVG.saturn(), 'saturn.svg', 'Saturn: a pale golden banded planet surrounded by wide, flat rings'),
    uranus: m(SVG.uranus(), 'uranus.svg', 'Uranus: a pale blue-green planet with a thin ring standing almost upright'),
    neptune: m(SVG.neptune(), 'neptune.svg', 'Neptune: a deep blue planet with a dark storm and white clouds'),
    pluto: m(SVG.pluto(), 'pluto.svg', 'Pluto: a beige world with a bright heart-shaped plain and a dark equatorial region'),
    dwarfs: m(dwarfsSVG(), 'dwarf-planets.svg', 'The Moon, Pluto, Eris, Haumea, Makemake and Ceres side by side to scale'),
    sizes: m(sizesSVG(), 'planet-sizes.svg', 'The eight planets drawn to scale: four tiny rocky planets beside giant Jupiter, ringed Saturn, Uranus and Neptune'),
    asteroids: m(asteroidsSVG(), 'asteroids.svg', 'Irregular grey and brown rocks drifting in space'),
    comet: m(cometSVG(), 'comet.svg', 'A comet with a bright head, a curved yellowish dust tail and a straight blue ion tail pointing away from the Sun'),
    voyager: m(voyagerSVG(), 'voyager.svg', 'A Voyager spacecraft with its large white dish antenna, a ten-sided body and long booms'),
    goldenrecord: m(goldenRecordSVG(), 'golden-record.svg', 'A gold-coloured phonograph record'),
    rover: m(roverSVG(), 'rover.svg', 'A six-wheeled rover with a camera mast on reddish Martian ground'),
    moonphases: m(moonPhasesSVG(), 'moon-phases.svg', 'Eight phases of the Moon from new moon to waning crescent'),
    earthlayers: m(earthLayersSVG(), 'earth-layers.svg', 'Earth with a quarter cut away to show the crust, mantle, outer core and inner core'),
  };
}

// ---------------------------------------------------------------------------------------------
// Sources (only works known to exist; URLs only where certain) and shared blocks.

const SRC = {
  fact: '{{cite|author=David R. Williams|title=Planetary Fact Sheet|website=NASA Space Science Data Coordinated Archive|publisher=NASA Goddard Space Flight Center|url=https://nssdc.gsfc.nasa.gov/planetary/factsheet/}}',
  nasa: '{{cite|title=Solar System|website=NASA Science|publisher=NASA|url=https://science.nasa.gov/solar-system/}}',
  iau: '{{cite|author=International Astronomical Union|title=Resolution B5: Definition of a Planet in the Solar System|work=Resolutions of the XXVI General Assembly, Prague|year=2006}}',
  esss: '{{cite|author=Lucy-Ann McFadden, Paul R. Weissman and Torrence V. Johnson (eds.)|title=Encyclopedia of the Solar System|year=2007|publisher=Academic Press|note=2nd edition.}}',
  sobel: '{{cite|author=Dava Sobel|title=The Planets|year=2005|place=New York|publisher=Viking}}',
  rothery: '{{cite|author=David A. Rothery|title=Planets: A Very Short Introduction|year=2010|place=Oxford|publisher=Oxford University Press}}',
  moons: '{{cite|author=David A. Rothery|title=Moons: A Very Short Introduction|year=2015|place=Oxford|publisher=Oxford University Press}}',
  sagan: '{{cite|author=Carl Sagan|title=Pale Blue Dot: A Vision of the Human Future in Space|year=1994|place=New York|publisher=Random House}}',
  brown: '{{cite|author=Mike Brown|title=How I Killed Pluto and Why It Had It Coming|year=2010|place=New York|publisher=Spiegel & Grau}}',
  stern: '{{cite|author=Alan Stern and David Grinspoon|title=Chasing New Horizons: Inside the Epic First Mission to Pluto|year=2018|place=New York|publisher=Picador}}',
  bell: '{{cite|author=Jim Bell|title=The Interstellar Age: Inside the Forty-Year Voyager Mission|year=2015|place=New York|publisher=Dutton}}',
  murmurs: '{{cite|author=Carl Sagan, Frank Drake, Ann Druyan, Timothy Ferris, Jon Lomberg and Linda Salzman Sagan|title=Murmurs of Earth: The Voyager Interstellar Record|year=1978|place=New York|publisher=Random House}}',
  comet: '{{cite|author=Carl Sagan and Ann Druyan|title=Comet|year=1985|place=New York|publisher=Random House}}',
  chaikin: '{{cite|author=Andrew Chaikin|title=A Man on the Moon: The Voyages of the Apollo Astronauts|year=1994|place=New York|publisher=Viking}}',
  golub: '{{cite|author=Leon Golub and Jay M. Pasachoff|title=Nearest Star: The Surprising Science of Our Sun|year=2001|place=Cambridge, Massachusetts|publisher=Harvard University Press}}',
  sheehan: '{{cite|author=William Sheehan|title=The Planet Mars: A History of Observation and Discovery|year=1996|place=Tucson|publisher=University of Arizona Press}}',
  standage: '{{cite|author=Tom Standage|title=The Neptune File: A Story of Astronomical Rivalry and the Pioneers of Planet Hunting|year=2000|place=New York|publisher=Walker & Company}}',
  bagenal: '{{cite|author=Fran Bagenal, Timothy E. Dowling and William B. McKinnon (eds.)|title=Jupiter: The Planet, Satellites and Magnetosphere|year=2004|place=Cambridge|publisher=Cambridge University Press}}',
  dougherty: '{{cite|author=Michele K. Dougherty, Larry W. Esposito and Stamatios M. Krimigis (eds.)|title=Saturn from Cassini-Huygens|year=2009|publisher=Springer}}',
  galileo: '{{cite|author=Galileo Galilei|title=Sidereus Nuncius|year=1610|place=Venice}}',
  halley: '{{cite|author=Edmond Halley|title=A Synopsis of the Astronomy of Comets|year=1705|place=London}}',
  oort: '{{cite|author=J. H. Oort|title=The structure of the cloud of comets surrounding the Solar System and a hypothesis concerning its origin|work=Bulletin of the Astronomical Institutes of the Netherlands|volume=11|year=1950|pages=91–110}}',
};
// A named footnote: the same source cited twice in a page becomes one reference with back links a, b, ….
const ref = (k) => `{{ref|name=${k}|${SRC[k]}}}`;
const note = (text) => `{{ref|group=note|${text}}}`;
const imp = (text) => `{{layer|imperial|${text}}}`;

const REFS = { type: 'references' };
const NOTES = { type: 'references', group: 'note', title: 'Notes' };
const hat = (text, kind = 'about') => ({ type: 'hatnote', kind, text });
const see = (...items) => ({ type: 'seealso', items: items.map(([link, note]) => ({ link, note: note || '' })) });
// Infobox rows: ['Header'] | [label, value] | [label, value, layer].
const infobox = (title, image, caption, rows) => ({
  type: 'infobox', title, image, caption,
  rows: rows.map((r) => (r.length === 1 ? { header: true, label: r[0] } : { label: r[0], value: r[1], ...(r[2] ? { layer: r[2] } : {}) })),
});

const NAVBOX = {
  type: 'navbox', title: 'The [[solar-system|Solar System]]',
  groups: [
    { label: 'Star', links: '[[sun|Sun]]' },
    { label: '[[planet|Planets]]', links: '[[mercury|Mercury]]\n[[venus|Venus]]\n[[earth|Earth]]\n[[mars|Mars]]\n[[jupiter|Jupiter]]\n[[saturn|Saturn]]\n[[uranus|Uranus]]\n[[neptune|Neptune]]' },
    { label: '[[dwarf-planet|Dwarf planets]]', links: '[[dwarf-planet#Ceres|Ceres]]\n[[pluto|Pluto]]\n[[dwarf-planet#Haumea|Haumea]]\n[[dwarf-planet#Makemake|Makemake]]\n[[dwarf-planet#Eris|Eris]]' },
    { label: '[[natural-satellite|Moons]]', links: '[[moon|Moon]]\n[[natural-satellite#Phobos and Deimos|Phobos and Deimos]]\n[[natural-satellite#Galilean moons|Galilean moons]]\n[[natural-satellite#Titan and the moons of Saturn|Titan]]\n[[natural-satellite#Triton|Triton]]\n[[natural-satellite#Charon|Charon]]' },
    { label: 'Small bodies', links: '[[asteroid-belt|Asteroid belt]]\n[[kuiper-belt|Kuiper belt]]\n[[comet|Comets]]' },
    { label: '[[exploration|Exploration]]', links: '[[exploration#Timeline|Timeline]]\n[[voyager-program|Voyager program]]' },
  ],
};

const PLANETS = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
const NAMES = { mercury: 'Mercury', venus: 'Venus', earth: 'Earth', mars: 'Mars', jupiter: 'Jupiter', saturn: 'Saturn', uranus: 'Uranus', neptune: 'Neptune' };

// The annotated diagram of the Solar System: hotspots over solarsystem.svg, labels alternately above and below.
const pctX = (x) => f1((x / SS.w) * 100), pctY = (y) => f1((y / SS.h) * 100);
const SS_DIAGRAM = {
  type: 'diagram', media: 'solarsystem', align: 'full', labels: 'always',
  alt: 'Diagram of the Solar System: the Sun, the eight planets, the asteroid belt, the Kuiper belt and Pluto in order from the Sun',
  caption: 'The Solar System in order from the Sun. Sizes and distances are **not to scale**. Select a body to open its article.',
  items: [
    { shape: 'rect', x: 0, y: 0, w: 9, h: 100, lx: 4.5, ly: 8, label: 'Sun', link: 'sun', color: '#f2a72e' },
    ...SS.planets.map(([slug, label, x, r, color, up]) => ({ shape: 'circle', x: pctX(x), y: 50, r: f1(r / 10 + 0.6), lx: pctX(x), ly: up ? 10 : 90, label, link: slug, color })),
    { shape: 'rect', x: pctX(SS.belt[0]) - 0.5, y: pctY(SS.belt[2]), w: pctX(SS.belt[1] - SS.belt[0]) + 1, h: pctY(SS.belt[3] - SS.belt[2]), lx: 38, ly: 10, label: 'Asteroid belt', link: 'asteroid-belt', color: '#a99d8f' },
    { shape: 'rect', x: pctX(SS.kuiper[0]), y: pctY(SS.kuiper[2]), w: pctX(SS.kuiper[1] - SS.kuiper[0]), h: pctY(SS.kuiper[3] - SS.kuiper[2]), lx: 91, ly: 90, label: 'Kuiper belt', link: 'kuiper-belt', color: '#9fb3c8' },
    { shape: 'circle', x: pctX(SS.pluto[0]), y: pctY(SS.pluto[1]), r: 1.2, lx: 95, ly: 10, label: 'Pluto', link: 'pluto', color: '#c7a07a' },
  ],
};

// Earth's interior: points along the cut (45° up and right of the centre), labels in a column on the right.
const elPoint = (r, deg) => [f1(((EL.cx + r * Math.cos((deg * Math.PI) / 180)) / EL.w) * 100), f1(((EL.cy - r * Math.sin((deg * Math.PI) / 180)) / EL.h) * 100)];
const EARTH_DIAGRAM = (() => {
  const pt = (r, deg, label, note, ly, lx = 72) => { const [x, y] = elPoint(r, deg); return { shape: 'point', x, y, lx, ly, label, note }; };
  return {
    type: 'diagram', media: 'earthlayers', align: 'center', labels: 'always',
    alt: 'Cut-away drawing of Earth showing the atmosphere, crust, mantle, outer core and inner core',
    caption: "Earth's internal structure. The thickness of the crust is greatly exaggerated; the other layers are drawn to scale.",
    items: [
      pt(EL.R + 5, 135, 'Atmosphere', 'A thin envelope of gas, mostly nitrogen and oxygen', 5, 22),
      pt(EL.R - EL.crust / 2, 45, 'Crust', 'Solid rock, about 5–70 km thick: thinnest under the oceans, thickest under mountain ranges', 12),
      pt((EL.R - EL.crust + elR(3480)) / 2, 45, 'Mantle', 'Hot rock that flows very slowly, down to a depth of about 2,900 km', 32),
      pt((elR(3480) + elR(1220)) / 2, 45, 'Outer core', 'Liquid iron and nickel, about 2,900–5,150 km deep; its motion generates Earth\'s magnetic field', 52),
      pt(elR(1220) / 2, 45, 'Inner core', 'A solid ball of iron and nickel about 1,220 km in radius', 72),
    ],
  };
})();

// Saturn's rings: points on the rings of saturn.svg (planet centre 160, 110, radius 52, flattening 0.3).
const SATURN_DIAGRAM = (() => {
  const cx = 160, cy = 110, r = 52, k = 0.3, W = 320, H = 220;
  const at = (rr, deg) => [f1(((cx + rr * r * Math.cos((deg * Math.PI) / 180)) / W) * 100), f1(((cy + rr * r * k * Math.sin((deg * Math.PI) / 180)) / H) * 100)];
  const mid = (a) => (a[0] + a[1]) / 2;
  const pt = ([x, y], lx, ly, label, note) => ({ shape: 'point', x, y, lx, ly, label, note });
  return {
    type: 'diagram', media: 'saturn', align: 'center', labels: 'always',
    alt: 'Saturn and its main rings with labels for the A ring, the Cassini Division, the B ring and the C ring',
    caption: 'The main rings of Saturn, from the outside in: the A ring, the Cassini Division, the B ring and the C ring.',
    items: [
      pt([50, f1(((cy - 0.82 * r) / H) * 100)], 50, 5, 'Cloud tops', 'Bands of ammonia clouds; Saturn has no solid surface'),
      pt(at(mid(SAT_RINGS.a), 0), 90, 18, 'A ring', 'The outermost of the bright main rings'),
      pt(at(mid(SAT_RINGS.cd), 90), 30, 94, 'Cassini Division', 'A gap about 4,800 km wide between the A and B rings, discovered by Giovanni Domenico Cassini in 1675'),
      pt(at(mid(SAT_RINGS.b), 180), 10, 18, 'B ring', 'The brightest, widest and most massive of the rings'),
      pt(at(mid(SAT_RINGS.c), 40), 74, 94, 'C ring', 'A fainter, darker ring inside the B ring'),
    ],
  };
})();

// ---------------------------------------------------------------------------------------------
// Pages

const MAIN = {
  slug: 'main-page', title: 'Main Page', toc: 'off',
  summary: 'The main page of the Solar System Encyclopedia: the featured article, "Did you know…", the picture of the day and the categories.',
  blocks: [
    { type: 'banner', style: 'overlay', media: 'banner', link: 'solar-system', button: 'Start with the Solar System', title: 'Welcome to the Solar System Encyclopedia',
      text: 'An illustrated encyclopedia of the [[sun|Sun]], its eight [[planet|planets]], their [[natural-satellite|moons]] and the small worlds beyond — written in plain language, with sources.' },
    { type: 'columns', ratio: '2:1', cols: [
      { blocks: [
        { type: 'heading', level: '2', text: "Today's featured article" },
        { type: 'media', media: 'jupiter', link: 'jupiter', align: 'left', width: 140, frame: 'plain', layout: 'float',
          text: `**[[jupiter|Jupiter]]** is the fifth planet from the Sun and by far the largest: it is more than twice as massive as all the other planets combined. A gas giant made mostly of hydrogen and helium, it has no solid surface, and its clouds are drawn out into colourful bands by the fastest rotation of any planet — one turn in less than ten hours. Its best-known feature, the Great Red Spot, is a storm wider than Earth that has been watched for well over a century. The four large moons that Galileo discovered in 1610 were the first objects ever found orbiting another planet. (**[[jupiter|Full article…]]**)` },
        { type: 'heading', level: '2', text: 'Did you know…' },
        { type: 'text', text: `- … that a day on [[venus|Venus]] — one turn on its axis, 243 Earth days — is longer than its year of 225 Earth days?
- … that [[saturn|Saturn]] is less dense than water?
- … that [[uranus|Uranus]] spins on its side, with its axis tilted by about 98 degrees?
- … that [[natural-satellite#Galilean moons|Ganymede]], a moon of Jupiter, is wider than the planet [[mercury|Mercury]]?
- … that sunlight takes about eight minutes to reach [[earth|Earth]]?
- … that [[voyager-program|Voyager 1]] became the first spacecraft to enter interstellar space, in 2012?` },
        { type: 'heading', level: '2', text: 'Selected anniversaries' },
        { type: 'timeline', style: 'compact', items: [
          { date: '13 March 1781', title: 'Discovery of Uranus', link: 'uranus', text: 'William Herschel finds the first planet discovered with a telescope.' },
          { date: '20 July 1969', title: 'Apollo 11', link: 'moon', text: 'The first crewed landing on the Moon.' },
          { date: '25 August 1989', title: 'Voyager 2 at Neptune', link: 'neptune', text: 'The only close-up visit to the outermost planet so far.' },
          { date: '14 July 2015', title: 'New Horizons at Pluto', link: 'pluto', text: 'The first close look at the dwarf planet.' },
        ] },
      ] },
      { blocks: [
        { type: 'heading', level: '2', text: 'In this encyclopedia' },
        { type: 'text', text: `- [[category:planets|Planets]] — the eight major planets
- [[category:dwarf-planets|Dwarf planets]] — Pluto, Ceres, Eris and their kin
- [[category:moons|Moons]] — natural satellites
- [[category:small-bodies|Small bodies]] — asteroids, comets and the Kuiper belt
- [[category:exploration|Exploration]] — telescopes, probes and people
- [[category:solar-system|The Solar System]] — the system as a whole and its star

[[special:all|All articles]] · [[special:categories|All categories]]` },
        { type: 'heading', level: '2', text: 'Picture of the day' },
        { type: 'media', media: 'moonphases', link: 'moon', align: 'center', frame: 'thumb',
          caption: 'The eight traditional **[[moon|phases of the Moon]]** as seen from the Northern Hemisphere. One cycle, from new moon to new moon, takes about 29.5 days.' },
        { type: 'heading', level: '2', text: 'About this site' },
        { type: 'text', text: 'This is an example knowledge base. Read [[about|About this encyclopedia]] to see how it is organised, then start from the [[solar-system|Solar System]] overview, the [[planet|comparison of the planets]] or the [[exploration|timeline of exploration]].' },
      ] },
    ] },
    { type: 'pagelist', title: 'The eight planets', source: 'links', style: 'cards', summary: true, limit: 8, links: PLANETS.map((link) => ({ link })) },
    NAVBOX,
  ],
};

const SOLAR_SYSTEM = {
  slug: 'solar-system', title: 'Solar System', cats: ['solar-system'],
  versions: [
    { id: 'full', label: 'Full article', blocks: [
      hat('This article is about the Sun and the objects that orbit it. For the list and comparison of the major planets, see [[planet|Planet]].'),
      infobox('Solar System', 'orbits', 'The orbits of the planets around the Sun (not to scale)', [
        ['Age', `About 4.6 billion years${ref('nasa')}`],
        ['Location', 'Orion Arm of the Milky Way galaxy'],
        ['Distance to the galactic centre', 'About 26,000 light-years'],
        ['Star', '[[sun|Sun]], a G-type main-sequence star'],
        ['Planets', '8: [[mercury|Mercury]], [[venus|Venus]], [[earth|Earth]], [[mars|Mars]], [[jupiter|Jupiter]], [[saturn|Saturn]], [[uranus|Uranus]], [[neptune|Neptune]]'],
        ['Dwarf planets', `5 recognised by the {{abbr|IAU|International Astronomical Union}}: [[dwarf-planet#Ceres|Ceres]], [[pluto|Pluto]], [[dwarf-planet#Haumea|Haumea]], [[dwarf-planet#Makemake|Makemake]], [[dwarf-planet#Eris|Eris]]${ref('iau')}`],
        ['Nearest star system', 'Alpha Centauri, about 4.4 light-years away'],
        ['Edge of the heliosphere', 'About 120 AU from the Sun, crossed by [[voyager-program|Voyager 1]] in 2012'],
      ]),
      { type: 'text', text: `The **Solar System** is the [[sun|Sun]] and everything bound to it by gravity: the eight [[planet|planets]], their [[natural-satellite|moons]], the [[dwarf-planet|dwarf planets]], and countless [[asteroid-belt|asteroids]], [[comet|comets]] and grains of dust. It formed about 4.6 billion years ago from the collapse of a cloud of gas and dust.${ref('nasa')}

The Sun holds about 99.8% of the system's mass. The four inner planets — [[mercury|Mercury]], [[venus|Venus]], [[earth|Earth]] and [[mars|Mars]] — are small worlds of rock and metal. The four outer planets are giants: [[jupiter|Jupiter]] and [[saturn|Saturn]] are made mostly of hydrogen and helium, while [[uranus|Uranus]] and [[neptune|Neptune]] contain large amounts of water, ammonia and methane ices.${ref('fact')} Between Mars and Jupiter lies the [[asteroid-belt|asteroid belt]]; beyond Neptune, the [[kuiper-belt|Kuiper belt]] holds icy bodies such as [[pluto|Pluto]].` },
      SS_DIAGRAM,
      { type: 'text', text: `## Formation
The Solar System began when part of a giant cloud of gas and dust collapsed under its own gravity. Most of the material gathered at the centre and became the Sun; the rest flattened into a spinning disc in which grains stuck together to form ever larger bodies.${ref('esss')} Close to the young Sun it was too warm for ices to survive, so the inner planets formed from rock and metal. Farther out, ices were plentiful, and the cores of the giant planets grew large enough to capture vast envelopes of gas.

This history explains a striking pattern: the planets orbit close to one plane, and all of them travel around the Sun in the same direction — the direction in which the original disc rotated.

## The Sun` },
      hat('[[sun|Sun]]', 'main'),
      { type: 'text', text: `The Sun is an ordinary star of middle size and middle age. Nuclear fusion in its core turns hydrogen into helium and releases the energy that lights and warms the planets. Its gravity holds the whole system together, and the solar wind — a stream of charged particles flowing from it — fills a vast bubble called the heliosphere.

## Inner Solar System
The inner planets are rocky, with solid surfaces, few or no moons and no rings. [[earth|Earth]] is the largest of them and the only one known to have liquid water on its surface and life. [[mars|Mars]], the [[red-planet|Red Planet]], has two tiny moons; [[mercury|Mercury]] and [[venus|Venus]] have none. Beyond Mars, the [[asteroid-belt|asteroid belt]] contains millions of rocky bodies, including the dwarf planet [[dwarf-planet#Ceres|Ceres]].

## Outer Solar System
The four giant planets hold almost all of the mass that is not in the Sun. All four have ring systems — Saturn's are by far the brightest — and large families of moons, among them [[natural-satellite#Galilean moons|Ganymede]] and [[natural-satellite#Titan and the moons of Saturn|Titan]], which are larger than the planet Mercury.${ref('fact')}

## Beyond Neptune` },
      hat('[[kuiper-belt|Kuiper belt]]', 'main'),
      { type: 'text', text: `Past the orbit of Neptune lies the [[kuiper-belt|Kuiper belt]], a broad ring of icy bodies that includes [[pluto|Pluto]], [[dwarf-planet#Haumea|Haumea]] and [[dwarf-planet#Makemake|Makemake]]. Farther still, the scattered disc holds objects on long, tilted orbits, such as [[dwarf-planet#Eris|Eris]]. Long-period [[comet|comets]] are thought to come from the Oort cloud, a hypothetical shell of icy bodies far beyond the planets that has never been observed directly.

## Distances and scale
Distances in the Solar System are often given in {{tip|astronomical units|One astronomical unit (AU) is the average distance between Earth and the Sun. Since 2012 it has been defined as exactly 149,597,870,700 metres.}} (AU). Light, the fastest thing there is, needs minutes to hours to cross it:` },
      { type: 'table', caption: 'Average distance from the Sun and travel time of sunlight', head: 'row', sortable: true, striped: true, compact: true, rows: [
        ['Object', 'Distance from the Sun (AU)', 'Distance (million km)', 'Sunlight arrives after'],
        ['[[mercury|Mercury]]', '0.39', '57.9', 'about 3 minutes'],
        ['[[earth|Earth]]', '1.00', '149.6', 'about 8 minutes 20 seconds'],
        ['[[jupiter|Jupiter]]', '5.20', '778.5', 'about 43 minutes'],
        ['[[neptune|Neptune]]', '30.1', '4,515', 'about 4 hours'],
        ['[[pluto|Pluto]]', '39.5', '5,900', 'about 5½ hours'],
      ] },
      { type: 'text', text: `Even these distances are tiny compared with the gap to the nearest other stars: the light of the Alpha Centauri system takes more than four years to reach us.

## Exploration` },
      hat('[[exploration|Exploration of the Solar System]]', 'main'),
      { type: 'text', text: 'Every planet has been visited by at least one spacecraft, and people have walked on the [[moon|Moon]]. The twin [[voyager-program|Voyager]] probes, launched in 1977, flew past the four giant planets and have since left the heliosphere.' },
      { type: 'gallery', title: 'Members of the Solar System', style: 'grid', size: 's', items: [
        { media: 'sun', caption: 'The [[sun|Sun]]', link: 'sun' },
        { media: 'earth', caption: '[[earth|Earth]]', link: 'earth' },
        { media: 'moon', caption: 'The [[moon|Moon]]', link: 'moon' },
        { media: 'pluto', caption: '[[pluto|Pluto]]', link: 'pluto' },
        { media: 'asteroids', caption: '[[asteroid-belt|Asteroids]]', link: 'asteroid-belt' },
        { media: 'comet', caption: 'A [[comet|comet]]', link: 'comet' },
      ] },
      see(['planet', 'basic data of the eight planets'], ['dwarf-planet'], ['natural-satellite'], ['exploration'], ['about', 'how this encyclopedia is organised']),
      REFS,
      NAVBOX,
    ] },
    { id: 'simple', label: 'Simple English', blocks: [
      { type: 'text', text: `The **Solar System** is the [[sun|Sun]] and all the things that go around it. The Sun's gravity holds them all together.

Eight [[planet|planets]] go around the Sun. In order from the Sun they are [[mercury|Mercury]], [[venus|Venus]], [[earth|Earth]], [[mars|Mars]], [[jupiter|Jupiter]], [[saturn|Saturn]], [[uranus|Uranus]] and [[neptune|Neptune]]. The first four are small and made of rock. The other four are very big and are made mostly of gas and ice.

Many planets have [[natural-satellite|moons]]. Earth has one moon, the [[moon|Moon]].` },
      SS_DIAGRAM,
      { type: 'text', text: `## Smaller things
There are also many smaller things in the Solar System. [[dwarf-planet|Dwarf planets]] like [[pluto|Pluto]] are round, but they are small. Rocks called [[asteroid-belt|asteroids]] go around the Sun between Mars and Jupiter. [[comet|Comets]] are balls of ice and dust. When a comet comes near the Sun, it grows a long tail.

## How old and how big?
The Solar System is about 4.6 billion years old. It formed from a big cloud of gas and dust.${ref('nasa')}

The Solar System is very big. Light from the Sun takes about 8 minutes to reach Earth, and about 4 hours to reach Neptune.

## Remembering the order
Some people remember the order of the planets with a sentence: "**M**y **V**ery **E**ducated **M**other **J**ust **S**erved **U**s **N**achos." The first letter of each word is the first letter of a planet.` },
      REFS,
      NAVBOX,
    ] },
  ],
};

const SUN = {
  slug: 'sun', title: 'Sun', parent: 'solar-system', cats: ['solar-system'],
  blocks: [
    hat('This article is about the star at the centre of the Solar System. For everything that orbits it, see [[solar-system|Solar System]].'),
    infobox('Sun', 'sun', 'The Sun (illustration)', [
      ['Seen from Earth'],
      ['Mean distance', `149.6 million km (1 AU)${imp(' — 93.0 million mi')}`],
      ['Light travel time', 'About 8 minutes 20 seconds'],
      ['Physical characteristics'],
      ['Type', 'G-type main-sequence star (G2V)'],
      ['Age', 'About 4.6 billion years'],
      ['Diameter', `About 1.39 million km, 109 times Earth's${imp(' — about 865,000 mi')}${ref('fact')}`],
      ['Mass', "About 333,000 times Earth's; about 99.8% of the Solar System's mass"],
      ['Surface temperature', `About 5,500 °C${imp(' (about 9,900 °F)')}`],
      ['Core temperature', `About 15 million °C${imp(' (about 27 million °F)')}`],
      ['Composition', 'Mostly hydrogen (about three quarters of the mass) and helium (about one quarter)'],
      ['Rotation', 'About 25 days at the equator, about 35 days near the poles'],
      ['Name origin', 'Old English *sunne*; the Latin name is *Sol*', 'names'],
    ]),
    { type: 'text', text: `The **Sun** is the star at the centre of the [[solar-system|Solar System]]. It is a nearly perfect sphere of hot plasma, heated by nuclear fusion in its core, and it is by far the most important source of energy for life on [[earth|Earth]]. The Sun contains about 99.8% of the mass of the Solar System${ref('nasa')} and is about 109 times as wide as Earth.${ref('fact')}

## Structure
Energy is produced in the **core**, where the temperature is about 15 million °C. It travels outward first as radiation through the **radiative zone**, and then by rising and sinking currents of hot gas in the **convective zone**. The visible surface, the **photosphere**, has a temperature of about 5,500 °C. Above it lie the thin **chromosphere** and the faint, extremely hot **corona** — more than a million degrees — which can be seen with the naked eye only during a total solar eclipse.${ref('golub')}

## Energy
In the core, hydrogen nuclei fuse into helium. Each second the Sun turns about four million tonnes of matter into energy, as described by Einstein's equation E = mc^2^. Sunlight leaving the surface takes about 8 minutes and 20 seconds to reach Earth.

## Solar activity
The Sun's magnetic field produces **sunspots** — cooler, darker patches on the photosphere — whose number rises and falls in a cycle of about 11 years. Around the peak of the cycle, solar flares and huge eruptions of plasma called coronal mass ejections are common. The **solar wind**, a constant stream of charged particles, flows outward through the whole Solar System. When bursts of it reach Earth they can cause aurorae and disturb satellites and power grids.${ref('golub')}

## Life cycle
The Sun is roughly halfway through its life as a main-sequence star. In about 5 billion years, when the hydrogen in its core runs out, it will swell into a red giant. It will then shed its outer layers and end as a small, dense white dwarf. The Sun is not massive enough to explode as a supernova.${ref('nasa')}

## Observation and exploration` },
    { type: 'callout', kind: 'warning', title: 'Never look directly at the Sun', text: 'Looking at the Sun, even briefly and especially through binoculars or a telescope, can permanently damage your eyes. Use certified solar filters or project its image onto a sheet of paper.' },
    { type: 'text', text: `Space observatories watch the Sun continuously. The European–American SOHO spacecraft, launched in 1995, has observed it for decades. NASA's Parker Solar Probe, launched in 2018, has flown closer to the Sun than any earlier spacecraft, and the European Solar Orbiter, launched in 2020, was designed to give the first views of the Sun's polar regions.` },
    see(['solar-system'], ['earth', 'the planet whose climate the Sun drives'], ['comet', 'why comet tails point away from the Sun']),
    REFS,
    NAVBOX,
  ],
};

const PLANET = {
  slug: 'planet', title: 'Planet', parent: 'solar-system', cats: ['planets', 'solar-system'],
  blocks: [
    hat('This article is about the planets of the Solar System. For smaller round worlds such as Pluto, see [[dwarf-planet|Dwarf planet]].'),
    { type: 'text', text: `A **planet** is a large, round body that orbits the [[sun|Sun]] and has cleared the neighbourhood around its orbit of other objects of comparable size. Under the definition adopted by the International Astronomical Union in 2006,${ref('iau')} the [[solar-system|Solar System]] has eight planets: [[mercury|Mercury]], [[venus|Venus]], [[earth|Earth]], [[mars|Mars]], [[jupiter|Jupiter]], [[saturn|Saturn]], [[uranus|Uranus]] and [[neptune|Neptune]].

The word comes from the Greek *planētēs*, "wanderer": to ancient sky-watchers the planets were the lights that wandered slowly against the background of fixed stars.

## Definition
According to the {{abbr|IAU|International Astronomical Union}}, a planet is a celestial body that:
1. is in orbit around the Sun;
2. has enough mass for its own gravity to pull it into a nearly round shape;
3. has cleared the neighbourhood around its orbit.

A body that meets the first two conditions but not the third, and is not a moon, is a [[dwarf-planet|dwarf planet]]. Bodies that orbit planets or dwarf planets are [[natural-satellite|moons]]; most other objects, such as [[asteroid-belt|asteroids]] and [[comet|comets]], are called small Solar System bodies.` },
    { type: 'diagram', aspect: '16:9', bg: '#f4f6fb', labels: 'always', align: 'center',
      alt: 'Concept map: planets, dwarf planets and small bodies orbit the Sun; moons orbit planets and dwarf planets; small bodies include asteroids, comets and Kuiper belt objects',
      caption: 'How the IAU definitions sort the bodies of the Solar System. Arrows point from a body to what it orbits.',
      items: [
        { id: 'sun', shape: 'rect', x: 38, y: 5, w: 24, h: 13, label: 'Sun', link: 'sun', color: '#f2a72e' },
        { id: 'pl', shape: 'rect', x: 3, y: 42, w: 26, h: 13, label: 'Planets (8)', link: 'planet#The eight planets', color: '#3366cc' },
        { id: 'dw', shape: 'rect', x: 37, y: 42, w: 26, h: 13, label: 'Dwarf planets', link: 'dwarf-planet', color: '#8a5a44' },
        { id: 'sb', shape: 'rect', x: 71, y: 42, w: 26, h: 13, label: 'Small bodies', note: 'Asteroids, comets and most objects beyond Neptune', color: '#6b7280' },
        { id: 'mo', shape: 'rect', x: 3, y: 80, w: 26, h: 13, label: 'Moons', link: 'natural-satellite', color: '#64748b' },
        { id: 'as', shape: 'rect', x: 50, y: 80, w: 14, h: 13, label: 'Asteroids', link: 'asteroid-belt', color: '#8b8178' },
        { id: 'co', shape: 'rect', x: 66, y: 80, w: 14, h: 13, label: 'Comets', link: 'comet', color: '#3a8fc8' },
        { id: 'kb', shape: 'rect', x: 82, y: 80, w: 16, h: 13, label: 'Kuiper belt objects', link: 'kuiper-belt', color: '#7d8fb0' },
      ],
      edges: [
        { from: 'pl', to: 'sun', label: 'orbit' }, { from: 'dw', to: 'sun', label: 'orbit' }, { from: 'sb', to: 'sun', label: 'orbit' },
        { from: 'mo', to: 'pl', label: 'orbit' }, { from: 'mo', to: 'dw', style: 'dashed' },
        { from: 'sb', to: 'as', style: 'line' }, { from: 'sb', to: 'co', style: 'line' }, { from: 'sb', to: 'kb', style: 'line' },
      ] },
    { type: 'text', text: '## The eight planets\nThe table below compares the basic properties of the planets. Select a column heading to sort the table.' },
    { type: 'table', head: 'row', sortable: true, striped: true, caption: `Basic data of the planets${ref('fact')}`, rows: [
      ['Planet', 'Type', 'Mean distance from the Sun (AU)', 'Equatorial diameter (km)', 'Mass (Earth = 1)', 'Orbital period (years)', `Rotation period (hours)${note('A negative rotation period means that the planet spins in the opposite direction to its orbit (retrograde rotation).')}`, 'Rings'],
      ['[[mercury|Mercury]]', 'Terrestrial', '0.39', '4,879', '0.055', '0.24', '1,407.6', 'No'],
      ['[[venus|Venus]]', 'Terrestrial', '0.72', '12,104', '0.815', '0.62', '−5,832.5', 'No'],
      ['[[earth|Earth]]', 'Terrestrial', '1.00', '12,756', '1', '1.00', `23.9${note("Rotation relative to the distant stars. Earth's solar day — from noon to noon — is 24 hours.")}`, 'No'],
      ['[[mars|Mars]]', 'Terrestrial', '1.52', '6,792', '0.107', '1.88', '24.6', 'No'],
      ['[[jupiter|Jupiter]]', 'Gas giant', '5.20', '142,984', '317.8', '11.9', '9.9', 'Yes'],
      ['[[saturn|Saturn]]', 'Gas giant', '9.58', '120,536', '95.2', '29.4', '10.7', 'Yes'],
      ['[[uranus|Uranus]]', 'Ice giant', '19.2', '51,118', '14.5', '84.0', '−17.2', 'Yes'],
      ['[[neptune|Neptune]]', 'Ice giant', '30.1', '49,528', '17.1', '164.8', '16.1', 'Yes'],
    ] },
    { type: 'callout', kind: 'info', title: 'Where the names come from', layer: 'names', text: `- **Mercury** — the Roman messenger god
- **Venus** — the Roman goddess of love and beauty
- **Earth** — from Old English *eorþe*, "ground, soil"; the only planet not named after a god
- **Mars** — the Roman god of war
- **Jupiter** — the king of the Roman gods
- **Saturn** — the Roman god of sowing and agriculture, father of Jupiter
- **Uranus** — the Greek god of the sky; the only planet named after a Greek rather than a Roman god
- **Neptune** — the Roman god of the sea` },
    { type: 'text', text: `## Terrestrial and giant planets
The four planets closest to the Sun are **terrestrial planets**: compact worlds of rock and metal with solid surfaces. Earth is the largest of them; [[mars|Mars]], the [[red-planet|Red Planet]], is about half its width. The outer four are **giant planets**. [[jupiter|Jupiter]] and [[saturn|Saturn]] are *gas giants* made mostly of hydrogen and helium; [[uranus|Uranus]] and [[neptune|Neptune]] are *ice giants*, rich in water, ammonia and methane beneath their hydrogen-helium atmospheres.${ref('rothery')}

## Sizes` },
    { type: 'media', media: 'sizes', align: 'center', frame: 'thumb', caption: 'The eight planets drawn **to scale** (their sizes only; distances between them are not to scale). Jupiter is about 11 times as wide as Earth.' },
    { type: 'text', text: `## History
Five planets — Mercury, Venus, Mars, Jupiter and Saturn — are easily visible to the naked eye and have been known since prehistoric times. In 1543 Nicolaus Copernicus argued that Earth itself is a planet orbiting the Sun. Telescopes then added new worlds: [[uranus|Uranus]] in 1781 and [[neptune|Neptune]] in 1846. [[dwarf-planet#Ceres|Ceres]], found in 1801, was counted as a planet for about half a century, and [[pluto|Pluto]], found in 1930, was called the ninth planet until 2006.${ref('sobel')}` },
    { type: 'gallery', title: 'The planets', style: 'grid', size: 's', items: PLANETS.map((p) => ({ media: p, caption: `[[${p}|${NAMES[p]}]]`, link: p })) },
    see(['dwarf-planet'], ['natural-satellite'], ['solar-system', 'overview, distances and scale']),
    NOTES,
    REFS,
    NAVBOX,
  ],
};

const MERCURY = {
  slug: 'mercury', title: 'Mercury', parent: 'planet', cats: ['planets'],
  blocks: [
    hat('This article is about the planet. For other uses, see [[mercury-disambiguation|Mercury (disambiguation)]].'),
    infobox('Mercury', 'mercury', 'Mercury (illustration)', [
      ['Orbital characteristics'],
      ['Mean distance from the Sun', `57.9 million km (0.39 AU)${imp(' — 36.0 million mi')}`],
      ['Orbital period', '88 days'],
      ['Known moons', 'None'],
      ['Physical characteristics'],
      ['Equatorial diameter', `4,879 km${imp(' (3,032 mi)')}`],
      ['Mass', '0.055 Earths'],
      ['Rotation period', '58.6 days'],
      ['Solar day', '176 Earth days'],
      ['Surface temperature', `About −180 °C to 430 °C${imp(' (−292 °F to 806 °F)')}`],
      ['Named after', 'Mercury, the messenger of the Roman gods', 'names'],
    ]),
    { type: 'text', text: `**Mercury** is the smallest planet in the [[solar-system|Solar System]] and the closest to the [[sun|Sun]]. It circles the Sun every 88 days, faster than any other planet,${ref('fact')} which suits its name: Mercury was the swift messenger of the Roman gods. The planet has no moons and almost no atmosphere.

## Orbit and rotation
Mercury's orbit is the most elongated of all the planets: its distance from the Sun ranges from about 46 to 70 million km.${ref('fact')} The planet turns on its axis exactly three times for every two trips around the Sun. Because of this 3:2 spin–orbit resonance, one solar day on Mercury — from one sunrise to the next — lasts 176 Earth days, two of its years.

Seen from Earth, Mercury never strays far from the Sun, so it can be seen only low in the sky shortly after sunset or before sunrise.

## Surface
Mercury looks much like the [[moon|Moon]]: it is covered in craters. The largest, the Caloris Basin, is about 1,550 km across. Long cliffs hundreds of kilometres in length cross the surface; they formed as the planet's interior cooled and the whole planet shrank slightly.${ref('esss')}

## Interior
For its size Mercury is very dense — second only to [[earth|Earth]] among the planets — because it has an enormous iron core that fills most of its interior. The core generates a weak global magnetic field.

## Temperature and ice
With no real atmosphere to hold heat, Mercury has the largest temperature swings of any planet: about 430 °C${imp(' (806 °F)')} in the day and −180 °C${imp(' (−292 °F)')} at night.${ref('nasa')} Even so, craters near its poles that never see sunlight hold water ice, as the MESSENGER spacecraft confirmed.

## Exploration
Only a few spacecraft have visited Mercury, because reaching it requires losing a great deal of orbital speed. *Mariner 10* flew past it three times in 1974–1975. *MESSENGER* became the first spacecraft to orbit Mercury, from 2011 to 2015, and mapped the whole planet. *BepiColombo*, a joint European and Japanese mission, was launched in 2018.` },
    see(['venus', 'the next planet out'], ['mercury-disambiguation', 'other uses of the name']),
    REFS,
    NAVBOX,
  ],
};

const VENUS = {
  slug: 'venus', title: 'Venus', parent: 'planet', cats: ['planets'],
  blocks: [
    infobox('Venus', 'venus', 'Venus, wrapped in clouds (illustration)', [
      ['Orbital characteristics'],
      ['Mean distance from the Sun', `108.2 million km (0.72 AU)${imp(' — 67.2 million mi')}`],
      ['Orbital period', '224.7 days'],
      ['Known moons', 'None'],
      ['Physical characteristics'],
      ['Equatorial diameter', `12,104 km${imp(' (7,521 mi)')}`],
      ['Mass', '0.815 Earths'],
      ['Rotation period', '243 days (retrograde)'],
      ['Mean surface temperature', `About 465 °C${imp(' (869 °F)')}`],
      ['Surface pressure', "About 92 times Earth's"],
      ['Atmosphere', 'About 96.5% carbon dioxide'],
      ['Named after', 'Venus, the Roman goddess of love and beauty', 'names'],
    ]),
    { type: 'text', text: `**Venus** is the second planet from the [[sun|Sun]]. Nearly the same size as [[earth|Earth]], it is sometimes called Earth's sister planet, but it is a hostile world: its surface is the hottest of any planet — about 465 °C, hot enough to melt lead — beneath a crushing atmosphere of carbon dioxide and clouds of sulfuric acid.${ref('nasa')}

## Atmosphere and climate
The atmosphere of Venus is made almost entirely of carbon dioxide (CO,,2,,). At the surface its pressure is about 92 times that at sea level on Earth${ref('fact')} — similar to the pressure about 900 m under the ocean. The thick atmosphere traps heat in a runaway greenhouse effect, which makes Venus hotter than [[mercury|Mercury]], even though Mercury is closer to the Sun. The planet is completely covered by clouds of sulfuric acid droplets; high in the atmosphere, winds carry them around the planet in only about four Earth days.

## Rotation
Venus spins very slowly and backwards compared with most planets: one rotation takes 243 Earth days, longer than its year of 225 days. On Venus the Sun would rise in the west and set in the east.

## Surface
Radar can see through the clouds. Maps made this way show a surface shaped by volcanoes, with vast lava plains, thousands of volcanoes and fewer than a thousand impact craters. So few craters means that the surface is geologically young — perhaps several hundred million years old.${ref('esss')}

## Observation
After the [[moon|Moon]], Venus is the brightest natural object in the night sky. Because its orbit lies inside Earth's, it is seen only in the evening after sunset or in the morning before sunrise, which is why it has long been called the "evening star" and the "morning star". In 1610 Galileo Galilei saw that Venus shows phases like the Moon — strong evidence that it orbits the Sun.

## Exploration
*Mariner 2* made the first successful flyby of another planet when it passed Venus in 1962. The Soviet *Venera 7* became the first spacecraft to send data from the surface of another planet in 1970, and *Venera 9* returned the first pictures from the surface in 1975. NASA's *Magellan* mapped almost the entire planet by radar between 1990 and 1994, and Japan's *Akatsuki* reached orbit in 2015.` },
    see(['earth', "Venus's near twin in size"], ['mercury'], ['exploration']),
    REFS,
    NAVBOX,
  ],
};

const EARTH_INFOBOX = infobox('Earth', 'earth', 'Earth (illustration)', [
  ['Orbital characteristics'],
  ['Mean distance from the Sun', `149.6 million km (1 AU)${imp(' — 93.0 million mi')}`],
  ['Orbital period', '365.25 days'],
  ['Natural satellites', '1, the [[moon|Moon]]'],
  ['Physical characteristics'],
  ['Equatorial diameter', `12,756 km${imp(' (7,926 mi)')}`],
  ['Mass', '5.97 × 10^24^ kg'],
  ['Rotation period', '23 h 56 min (relative to the stars)'],
  ['Axial tilt', '23.4°'],
  ['Surface covered by water', 'About 71%'],
  ['Atmosphere', 'Nitrogen about 78%, oxygen about 21%'],
  ['Age', 'About 4.5 billion years'],
  ['Name origin', 'Old English *eorþe*, "ground, soil"', 'names'],
]);

const EARTH = {
  slug: 'earth', title: 'Earth', parent: 'planet', cats: ['planets'],
  versions: [
    { id: 'full', label: 'Full article', blocks: [
      hat('This article is about the planet. For its natural satellite, see [[moon|Moon]].'),
      EARTH_INFOBOX,
      { type: 'text', text: `**Earth** is the third planet from the [[sun|Sun]] and the only place in the universe known to harbour life. About 71% of its surface is covered by water, mostly in oceans; the rest consists of continents and islands.${ref('nasa')} Earth is the largest and the densest of the four rocky planets${ref('fact')} and has one natural satellite, the [[moon|Moon]].

## Orbit and rotation
Earth orbits the Sun at an average distance of about 149.6 million km${imp(' (93.0 million mi)')} — one astronomical unit — and completes an orbit in about 365.25 days; the extra quarter day is why calendars add a leap day every four years. The planet spins once on its axis in 23 hours 56 minutes relative to the stars, giving the 24-hour cycle of day and night.

Earth's axis is tilted by about 23.4°. As Earth travels around the Sun, first one hemisphere and then the other leans towards the Sun, and this tilt — not a change in distance — causes the seasons. Earth is in fact closest to the Sun in early January, during the northern winter.

## Structure
Earth is built in layers. A thin, rocky **crust** floats on the hot, slowly flowing rock of the **mantle**. Beneath lies the **outer core** of liquid iron and nickel, whose churning generates Earth's magnetic field, and at the centre a solid **inner core**.${ref('esss')} The magnetic field deflects most of the solar wind and so protects the atmosphere.` },
      EARTH_DIAGRAM,
      { type: 'text', text: `## Atmosphere
The air is about 78% nitrogen and 21% oxygen, with small amounts of argon, carbon dioxide and water vapour. A layer of ozone high in the atmosphere absorbs most of the Sun's harmful ultraviolet light. Carbon dioxide and water vapour trap heat in the greenhouse effect: without it, the average surface temperature would be well below freezing instead of about 15 °C${imp(' (59 °F)')}.

## Water and life
About 97% of Earth's water is in the oceans. Liquid water, a protective atmosphere and a steady supply of energy from the Sun have allowed life to flourish: the oldest widely accepted evidence of life is at least 3.5 billion years old.

## The Moon` },
      hat('[[moon|Moon]]', 'main'),
      { type: 'text', text: `The [[moon|Moon]] is unusually large compared with its planet. Its gravity raises the ocean tides, and it helps to keep the tilt of Earth's axis stable over long periods, which keeps the climate steadier than it would otherwise be.

## Earth seen from space
Photographs of Earth from space have changed how people see their planet. On 24 December 1968 the crew of *Apollo 8* photographed Earth rising above the Moon's horizon — the famous *Earthrise*. On 14 February 1990 [[voyager-program|Voyager 1]], about 6 billion km away, turned its camera back and caught Earth as a tiny point of light, later called the *Pale Blue Dot*.${ref('sagan')}` },
      see(['moon'], ['mars', 'the next planet out'], ['solar-system']),
      REFS,
      NAVBOX,
    ] },
    { id: 'simple', label: 'Simple English', blocks: [
      infobox('Earth', 'earth', 'Earth (illustration)', [
        ['Distance from the Sun', `About 150 million km${imp(' (93 million mi)')}`],
        ['One year', 'About 365 days'],
        ['One day', '24 hours'],
        ['Moons', '1, the [[moon|Moon]]'],
        ['Width', `12,756 km${imp(' (7,926 mi)')}`],
        ['Covered by water', 'About 71%'],
      ]),
      { type: 'text', text: `**Earth** is the planet we live on. It is the third planet from the [[sun|Sun]]. It is the only planet where we know there is life.

Most of Earth is covered by water. The oceans cover about seven tenths of it. The rest is land.

Earth goes around the Sun once a year. It also spins around once a day. When our side of Earth faces the Sun, it is day. When our side faces away from the Sun, it is night.

## Inside Earth
Earth has layers, a little like an onion. On the outside is a thin skin of rock called the crust. Under it is the mantle, made of very hot rock. In the middle is the core, made of iron and nickel.` },
      EARTH_DIAGRAM,
      { type: 'text', text: `## Air
The air around Earth is called the atmosphere. It is mostly nitrogen and oxygen. People and animals need the oxygen to breathe. The atmosphere also keeps Earth warm and protects us from harmful light from the Sun.

## The Moon
Earth has one [[moon|Moon]]. The Moon goes around Earth about once a month. It makes the water in the seas rise and fall. This is called the tide.${ref('nasa')}` },
      REFS,
      NAVBOX,
    ] },
  ],
};

const MOON = {
  slug: 'moon', title: 'Moon', parent: 'earth', cats: ['moons'],
  blocks: [
    hat("This article is about Earth's natural satellite. For moons in general, see [[natural-satellite|Natural satellite]]."),
    infobox('Moon', 'moon', 'The Moon (illustration)', [
      ['Orbital characteristics'],
      ['Mean distance from Earth', `384,400 km${imp(' (238,855 mi)')}`],
      ['Orbital period', '27.3 days (relative to the stars)'],
      ['Synodic month', '29.5 days (new moon to new moon)'],
      ['Physical characteristics'],
      ['Mean diameter', `3,475 km, 27% of Earth's${imp(' (2,159 mi)')}`],
      ['Mass', "About 1.2% of Earth's"],
      ['Surface gravity', "About one sixth of Earth's"],
      ['Age', 'About 4.5 billion years'],
      ['Name origin', 'Old English *mōna*; the Latin name is *Luna*', 'names'],
    ]),
    { type: 'text', text: `The **Moon** is [[earth|Earth]]'s only natural satellite. It is the fifth-largest moon in the [[solar-system|Solar System]]${ref('moons')} and, after the [[sun|Sun]], the brightest object in the sky. The Moon always keeps the same face turned towards Earth, and it is the only place beyond Earth where humans have set foot.

## Formation
The leading explanation for the Moon's origin is the giant-impact hypothesis: about 4.5 billion years ago a body roughly the size of [[mars|Mars]] struck the young Earth, and the Moon formed from the debris thrown into orbit. Rock samples brought back by the Apollo astronauts, which are very similar to rocks of Earth's mantle, support this idea.${ref('moons')}

## Orbit and phases
The Moon orbits Earth at an average distance of 384,400 km${imp(' (238,855 mi)')}. It turns on its axis exactly once per orbit, so the same side always faces us — its far side was first photographed by the Soviet probe *Luna 3* in 1959. As the Moon travels around Earth, we see different parts of its sunlit half, which produces its phases; one full cycle takes about 29.5 days.` },
    { type: 'media', media: 'moonphases', align: 'center', frame: 'thumb', caption: 'The phases of the Moon as seen from the Northern Hemisphere. In the Southern Hemisphere the picture is reversed left to right.' },
    { type: 'text', text: `When the Moon passes exactly between the Sun and Earth, it causes a solar eclipse; when Earth's shadow falls on the Moon, there is a lunar eclipse. Measurements with laser beams bounced off reflectors left by the Apollo astronauts show that the Moon is slowly moving away from Earth, by about 3.8 cm a year.

## Surface
The dark patches visible to the naked eye are the **maria** (Latin for "seas"): plains of solidified lava that flooded huge basins more than three billion years ago. The brighter **highlands** are older and covered in craters. The whole surface is blanketed by fine, powdery dust and broken rock called regolith. With almost no atmosphere, the Moon has no weather, and footprints left on it can last for millions of years. Craters near the poles that never receive sunlight contain water ice.

## Tides
The Moon's gravity pulls on Earth's oceans, raising two bulges of water on opposite sides of the planet. As Earth turns, most coasts pass through them twice a day, giving two high tides and two low tides. The Sun raises smaller tides of its own; when Sun and Moon line up, at new and full moon, the tides are strongest.

## Exploration` },
    { type: 'timeline', style: 'compact', items: [
      { date: '1959', title: '*Luna 2* and *Luna 3*', text: 'The first spacecraft to reach the Moon, and the first photographs of its far side.' },
      { date: '1966', title: '*Luna 9*', text: 'The first soft landing on the Moon.' },
      { date: '1968', title: '*Apollo 8*', text: 'The first crewed spacecraft to orbit the Moon.' },
      { date: '1969', title: '*Apollo 11*', text: 'Neil Armstrong and Buzz Aldrin become the first people to walk on the Moon (20 July).' },
      { date: '1972', title: '*Apollo 17*', text: 'The last crewed landing so far; twelve astronauts in all walked on the Moon.' },
      { date: '2019', title: "*Chang'e 4*", text: 'The first soft landing on the far side.' },
      { date: '2023', title: '*Chandrayaan-3*', text: 'The first landing near the lunar south pole.' },
    ] },
    { type: 'quote', style: 'block', text: "That's one small step for [a] man, one giant leap for mankind.", author: 'Neil Armstrong', source: 'on stepping onto the Moon, 20 July 1969' },
    { type: 'text', text: `Between 1969 and 1972 six Apollo missions landed on the Moon, and twelve astronauts explored its surface.${ref('chaikin')}` },
    see(['earth'], ['natural-satellite', 'moons of the other planets'], ['exploration']),
    REFS,
    NAVBOX,
  ],
};

const MARS = {
  slug: 'mars', title: 'Mars', parent: 'planet', cats: ['planets'],
  blocks: [
    infobox('Mars', 'mars', 'Mars (illustration)', [
      ['Orbital characteristics'],
      ['Mean distance from the Sun', `227.9 million km (1.52 AU)${imp(' — 141.6 million mi')}`],
      ['Orbital period', '687 days (1.88 years)'],
      ['Known moons', '2: [[natural-satellite#Phobos and Deimos|Phobos and Deimos]]'],
      ['Physical characteristics'],
      ['Equatorial diameter', `6,792 km${imp(' (4,220 mi)')}`],
      ['Mass', '0.107 Earths'],
      ['Length of day', '24 h 37 min'],
      ['Axial tilt', '25.2°'],
      ['Surface gravity', "About 38% of Earth's"],
      ['Mean temperature', `About −60 °C${imp(' (−76 °F)')}`],
      ['Named after', 'Mars, the Roman god of war', 'names'],
    ]),
    { type: 'text', text: `**Mars** is the fourth planet from the [[sun|Sun]]. Often called the Red Planet, it owes its colour to iron oxide — rust — in its dust and rocks.${ref('nasa')} Mars is a cold desert world about half as wide as [[earth|Earth]], with a thin atmosphere, polar ice caps, the largest volcano in the Solar System and clear signs that liquid water once flowed on its surface.

## Geography
The volcano **Olympus Mons** is about 22 km high, roughly two and a half times the height of Mount Everest above sea level. It is one of several giant volcanoes in the Tharsis region. Nearby, the canyon system **Valles Marineris** stretches for more than 4,000 km and is up to 7 km deep — nearly as long as the United States is wide. Both poles are capped with ice made of water and frozen carbon dioxide.${ref('sheehan')}

## Atmosphere and climate
The air on Mars is very thin, with a surface pressure less than 1% of Earth's, and consists mostly of carbon dioxide. Temperatures average about −60 °C${imp(' (−76 °F)')}. Because its axis is tilted much like Earth's, Mars has seasons, each roughly twice as long as ours. Dust storms are common and sometimes grow to cover the whole planet.

## Water
Dry river valleys, deltas and ancient lake beds show that liquid water once flowed across Mars. Today the low pressure means that water cannot stay liquid on the surface for long, but large amounts of ice remain in the polar caps and frozen underground.${ref('esss')}

## Moons` },
    hat('[[natural-satellite#Phobos and Deimos|Phobos and Deimos]]', 'main'),
    { type: 'text', text: `Mars has two small, irregular moons, **Phobos** (about 22 km across) and **Deimos** (about 12 km), discovered by Asaph Hall in 1877. Their names mean "fear" and "dread" in Greek. Phobos is slowly spiralling inwards and will be torn apart or crash into Mars in tens of millions of years.

## Exploration` },
    { type: 'media', media: 'rover', align: 'right', width: 280, frame: 'thumb', caption: 'A six-wheeled Mars rover (illustration)', layout: 'float',
      text: `Mars is the most explored planet after Earth. *Mariner 4* sent back the first close-up pictures in 1965, and *Mariner 9* became the first spacecraft to orbit another planet in 1971. The two *Viking* landers worked on the surface from 1976. Since 1997 a series of rovers has driven across the plains: *Sojourner*, *Spirit* and *Opportunity*, *Curiosity* (landed 2012 in Gale crater) and *Perseverance* (landed 2021 in Jezero crater, once a lake). *Perseverance* carried *Ingenuity*, a small helicopter that made the first powered flight on another planet in April 2021. China's *Zhurong* rover landed in the same year.` },
    see(['earth', 'the previous planet'], ['jupiter', 'the next planet out'], ['asteroid-belt', 'the belt beyond Mars'], ['exploration']),
    REFS,
    NAVBOX,
  ],
};

const JUPITER = {
  slug: 'jupiter', title: 'Jupiter', parent: 'planet', cats: ['planets'],
  blocks: [
    infobox('Jupiter', 'jupiter', 'Jupiter with the Great Red Spot (illustration)', [
      ['Orbital characteristics'],
      ['Mean distance from the Sun', `778.5 million km (5.2 AU)${imp(' — 483.7 million mi')}`],
      ['Orbital period', '11.86 years'],
      ['Known moons', 'Dozens, including the four [[natural-satellite#Galilean moons|Galilean moons]]'],
      ['Physical characteristics'],
      ['Equatorial diameter', `142,984 km${imp(' (88,846 mi)')}`],
      ['Mass', '317.8 Earths'],
      ['Rotation period', '9.9 hours'],
      ['Composition', 'Mostly hydrogen and helium'],
      ['Named after', 'Jupiter, the king of the Roman gods', 'names'],
    ]),
    { type: 'text', text: `**Jupiter** is the fifth planet from the [[sun|Sun]] and the largest in the [[solar-system|Solar System]]. It is a gas giant more than twice as massive as all the other planets combined,${ref('nasa')} and about 11 times as wide as [[earth|Earth]]. After the [[moon|Moon]] and [[venus|Venus]], it is usually the brightest object in the night sky.

## Composition and structure
Jupiter is made mostly of hydrogen and helium, much like the Sun, and has no solid surface. Deep inside, the enormous pressure squeezes hydrogen into a liquid that conducts electricity like a metal. The planet may also have a dense core of heavier material.${ref('bagenal')}

## Atmosphere
Jupiter spins faster than any other planet — once in less than ten hours — which stretches its clouds into light **zones** and dark **belts** that run parallel to the equator. The clouds are made largely of ammonia ice. The **Great Red Spot** is a giant storm, larger than Earth, that has been observed continuously since at least the 19th century; in recent decades it has been shrinking.

## Magnetosphere and rings
Jupiter has the strongest magnetic field of all the planets. It traps charged particles in intense radiation belts and produces bright aurorae around the poles. A faint system of dusty rings was discovered by [[voyager-program|Voyager 1]] in 1979.

## Moons` },
    hat('[[natural-satellite#Galilean moons|Galilean moons]]', 'main'),
    { type: 'text', text: `Jupiter has dozens of known moons, and new small ones are still being found. The four largest were discovered by Galileo Galilei in January 1610 — the first objects ever seen orbiting another planet.${ref('galileo')} **Io** is the most volcanically active body in the Solar System. **Europa** has an icy crust that probably covers a global ocean of salty water. **Ganymede**, the largest moon in the Solar System, is wider than the planet [[mercury|Mercury]]. **Callisto** is one of the most heavily cratered bodies known.

## Exploration
*Pioneer 10* made the first flyby of Jupiter in 1973, followed by *Pioneer 11* in 1974 and both [[voyager-program|Voyager]] probes in 1979. The *Galileo* spacecraft orbited Jupiter from 1995 to 2003 and dropped a probe into its atmosphere. *Juno* has orbited the planet since 2016. Two missions to Jupiter's icy moons are on their way: the European *JUICE*, launched in 2023, and NASA's *Europa Clipper*, launched in 2024.

In July 1994 the fragments of comet Shoemaker–Levy 9 crashed into Jupiter, leaving dark scars in its clouds — the first collision between two Solar System bodies ever observed (see [[comet|Comet]]).` },
    see(['saturn', 'the other gas giant'], ['natural-satellite'], ['voyager-program']),
    REFS,
    NAVBOX,
  ],
};

const SATURN = {
  slug: 'saturn', title: 'Saturn', parent: 'planet', cats: ['planets'],
  blocks: [
    infobox('Saturn', 'saturn', 'Saturn and its main rings (illustration)', [
      ['Orbital characteristics'],
      ['Mean distance from the Sun', `About 1.43 billion km (9.6 AU)${imp(' — about 890 million mi')}`],
      ['Orbital period', '29.4 years'],
      ['Known moons', 'Dozens; the largest is [[natural-satellite#Titan and the moons of Saturn|Titan]]'],
      ['Physical characteristics'],
      ['Equatorial diameter', `120,536 km${imp(' (74,898 mi)')}`],
      ['Mass', '95.2 Earths'],
      ['Rotation period', 'About 10.7 hours'],
      ['Mean density', '0.69 g/cm³ — less than water'],
      ['Named after', 'Saturn, the Roman god of agriculture and father of Jupiter', 'names'],
    ]),
    { type: 'text', text: `**Saturn** is the sixth planet from the [[sun|Sun]] and the second largest after [[jupiter|Jupiter]]. A gas giant made mostly of hydrogen and helium, it is the least dense of all the planets — less dense than water${ref('fact')} — and is famous for its bright system of rings.

## Physical characteristics
Saturn spins so fast that it bulges at the equator: it is about 10% wider across the equator than from pole to pole. Its pale golden cloud bands are more muted than Jupiter's. At its north pole, a six-sided jet stream known as the hexagon has been observed since the [[voyager-program|Voyager]] flybys of the early 1980s.${ref('dougherty')}

## Rings
Saturn's rings are made of countless pieces of water ice, from tiny grains to chunks the size of a house. They extend hundreds of thousands of kilometres across but are extremely thin: the main rings are typically only about ten metres thick.${ref('nasa')} Galileo saw them in 1610 but could not make out their shape; Christiaan Huygens explained them as a flat ring in the 1650s. In 1675 Giovanni Domenico Cassini discovered the dark gap between the two brightest rings, now called the Cassini Division.${ref('dougherty')}` },
    SATURN_DIAGRAM,
    { type: 'text', text: `## Moons
Saturn has dozens of known moons. **Titan**, discovered by Huygens in 1655, is larger than the planet [[mercury|Mercury]] and is the only moon with a thick atmosphere; on its surface there are lakes of liquid methane and ethane. **Enceladus** sprays jets of water ice from cracks near its south pole, fed by an ocean beneath its crust. **Mimas** bears a crater so large that it makes the moon look like an eye, and **Iapetus** has one dark and one bright hemisphere.

## Exploration
*Pioneer 11* flew past Saturn in 1979, followed by [[voyager-program|Voyager 1]] in 1980 and Voyager 2 in 1981. The *Cassini* spacecraft orbited Saturn from 2004 to 2017, and in January 2005 its European *Huygens* probe landed on Titan — the first landing on a moon of another planet. *Cassini* ended its mission in September 2017 by diving into Saturn's atmosphere.` },
    see(['jupiter', 'the largest gas giant'], ['natural-satellite#Titan and the moons of Saturn', 'Titan and the other moons'], ['uranus', 'the next planet out']),
    REFS,
    NAVBOX,
  ],
};

const URANUS = {
  slug: 'uranus', title: 'Uranus', parent: 'planet', cats: ['planets'],
  blocks: [
    infobox('Uranus', 'uranus', 'Uranus with its nearly upright rings (illustration)', [
      ['Discovery'],
      ['Discovered by', 'William Herschel'],
      ['Discovery date', '13 March 1781'],
      ['Orbital characteristics'],
      ['Mean distance from the Sun', `About 2.87 billion km (19.2 AU)${imp(' — about 1.78 billion mi')}`],
      ['Orbital period', '84 years'],
      ['Known moons', 'Many; five major moons'],
      ['Physical characteristics'],
      ['Equatorial diameter', `51,118 km${imp(' (31,763 mi)')}`],
      ['Mass', '14.5 Earths'],
      ['Rotation period', '17.2 hours (retrograde)'],
      ['Axial tilt', '97.8°'],
      ['Lowest atmospheric temperature', `About −224 °C${imp(' (−371 °F)')}`],
      ['Named after', 'Uranus (Ouranos), the Greek god of the sky', 'names'],
    ]),
    { type: 'text', text: `**Uranus** is the seventh planet from the [[sun|Sun]]. It was the first planet discovered with a telescope, by William Herschel in 1781.${ref('sobel')} An ice giant with a pale blue-green colour, Uranus is tipped on its side: its axis is tilted by about 98 degrees, so it rolls around the Sun rather than spinning like a top.

## Discovery
On 13 March 1781 William Herschel, observing from his home in Bath, England, noticed an object that moved slowly against the stars. He first took it for a comet, but its nearly circular orbit soon showed that it was a new planet — the first found since ancient times. Herschel wanted to name it after King George III; the name Uranus, proposed by the German astronomer Johann Elert Bode, was eventually adopted.

## Structure and atmosphere
Uranus is an ice giant: beneath an atmosphere of hydrogen and helium lies a deep layer of water, ammonia and methane, around a small rocky core. Methane in the upper atmosphere absorbs red light, giving the planet its blue-green colour. Uranus has the coldest atmosphere of any planet, falling to about −224 °C${imp(' (−371 °F)')}.${ref('fact')}

## Tilt and seasons
Because Uranus lies on its side, each pole has about 42 years of continuous sunlight followed by 42 years of darkness during its 84-year orbit. Astronomers think that a collision with a large body early in the planet's history knocked it over.

## Rings and moons
Uranus has a system of narrow, dark rings, discovered in 1977. Its moons are named after characters from the works of William Shakespeare and Alexander Pope. The five major moons are **Miranda**, **Ariel**, **Umbriel**, **Titania** and **Oberon**; Herschel himself discovered Titania and Oberon in 1787.

## Exploration
Only one spacecraft has visited Uranus: [[voyager-program|Voyager 2]] flew past in January 1986, discovering new moons and rings and returning the only close-up images of the planet so far.` },
    see(['neptune', 'the other ice giant'], ['saturn', 'the previous planet'], ['voyager-program']),
    REFS,
    NAVBOX,
  ],
};

const NEPTUNE = {
  slug: 'neptune', title: 'Neptune', parent: 'planet', cats: ['planets'],
  blocks: [
    infobox('Neptune', 'neptune', 'Neptune with a dark storm (illustration)', [
      ['Discovery'],
      ['Discovered by', 'Johann Galle, from predictions by Urbain Le Verrier'],
      ['Discovery date', '23 September 1846'],
      ['Orbital characteristics'],
      ['Mean distance from the Sun', `About 4.5 billion km (30.1 AU)${imp(' — about 2.8 billion mi')}`],
      ['Orbital period', '164.8 years'],
      ['Known moons', 'Many; the largest is [[natural-satellite#Triton|Triton]]'],
      ['Physical characteristics'],
      ['Equatorial diameter', `49,528 km${imp(' (30,775 mi)')}`],
      ['Mass', '17.1 Earths'],
      ['Rotation period', '16.1 hours'],
      ['Named after', 'Neptune, the Roman god of the sea', 'names'],
    ]),
    { type: 'text', text: `**Neptune** is the eighth and farthest known planet from the [[sun|Sun]]. It was the first planet found by mathematical prediction rather than by searching the sky,${ref('standage')} and it has the strongest winds measured on any planet. Like [[uranus|Uranus]], it is an ice giant; methane in its atmosphere gives it a deep blue colour.

## Discovery
In the early 19th century astronomers noticed that Uranus was not moving exactly as expected, as if another planet were pulling on it. The French mathematician Urbain Le Verrier calculated where the unseen planet should be, and on 23 September 1846 Johann Galle at the Berlin Observatory found it within about one degree of the predicted position. The English astronomer John Couch Adams had made a similar calculation independently. Galileo had in fact seen Neptune in 1612 and 1613 but took it for a star.${ref('standage')}

Neptune takes almost 165 years to orbit the Sun; in 2011 it completed its first full orbit since its discovery.

## Atmosphere and weather
Although Neptune receives very little sunlight, its weather is violent: winds of more than 2,000 km/h${imp(' (1,200 mph)')} sweep its clouds of frozen methane around the planet.${ref('nasa')} In 1989 [[voyager-program|Voyager 2]] photographed a huge storm called the Great Dark Spot; images from the Hubble Space Telescope showed that it had vanished by 1994.

## Moons and rings
Neptune's largest moon, **Triton**, was discovered by William Lassell only 17 days after the planet itself. Triton orbits in the opposite direction to Neptune's rotation, which suggests that it is a captured [[kuiper-belt|Kuiper belt]] object. Voyager 2 found geysers of nitrogen on its frozen surface, one of the coldest places measured in the Solar System. Neptune also has a few faint, dark rings.

## Exploration
[[voyager-program|Voyager 2]] is the only spacecraft to have visited Neptune; it flew past on 25 August 1989.` },
    see(['uranus', 'the other ice giant'], ['kuiper-belt', 'the region beyond Neptune'], ['pluto']),
    REFS,
    NAVBOX,
  ],
};

const SATELLITE = {
  slug: 'natural-satellite', title: 'Natural satellite', parent: 'solar-system', cats: ['moons'],
  blocks: [
    hat("This article is about moons in general. For Earth's moon, see [[moon|Moon]]."),
    { type: 'text', text: `A **natural satellite**, or **moon**, is a natural body that orbits a planet, a [[dwarf-planet|dwarf planet]] or a smaller body. In the [[solar-system|Solar System]], [[mercury|Mercury]] and [[venus|Venus]] have no moons, [[earth|Earth]] has one and [[mars|Mars]] has two, while each of the giant planets has dozens; new small moons of the giants are still being discovered, so their totals keep changing.${ref('nasa')}

## Moons by planet
### Earth's Moon` },
    hat('[[moon|Moon]]', 'main'),
    { type: 'text', text: `The [[moon|Moon]] is the fifth-largest moon in the Solar System and very large compared with its planet.

### Phobos and Deimos
The two moons of [[mars|Mars]] are small, dark and potato-shaped: Phobos is about 22 km across and Deimos about 12 km. Asaph Hall discovered both in 1877. They may be captured asteroids or debris from an ancient impact on Mars; their origin is still debated.

### Galilean moons
The four large moons of [[jupiter|Jupiter]] — **Io**, **Europa**, **Ganymede** and **Callisto** — were discovered by Galileo Galilei in 1610.${ref('galileo')} Io is covered in active volcanoes, Europa probably hides an ocean of liquid water beneath its icy crust, Ganymede is the largest moon in the Solar System and the only one known to have its own magnetic field, and Callisto is an ancient, heavily cratered world.${ref('moons')}

### Titan and the moons of Saturn
**Titan**, the largest moon of [[saturn|Saturn]], is bigger than Mercury and wrapped in a thick, hazy atmosphere of nitrogen. The *Huygens* probe landed on it in 2005. Among Saturn's many other moons are **Enceladus**, whose icy geysers are fed by an underground ocean, **Rhea** and **Iapetus**.

### Moons of Uranus
The five major moons of [[uranus|Uranus]] — Miranda, Ariel, Umbriel, Titania and Oberon — are named after characters from Shakespeare and Alexander Pope.

### Triton
**Triton**, the largest moon of [[neptune|Neptune]], circles its planet backwards. It is probably a body captured from the [[kuiper-belt|Kuiper belt]], and it has active geysers of nitrogen.

### Charon
**Charon**, the largest moon of [[pluto|Pluto]], is about half as wide as Pluto itself. The two always keep the same faces turned towards each other.

## Largest moons` },
    { type: 'table', caption: `The twelve largest moons of the Solar System${ref('moons')}`, head: 'row', sortable: true, striped: true, rows: [
      ['Moon', 'Orbits', 'Mean diameter (km)', 'Discovered'],
      ['Ganymede', '[[jupiter|Jupiter]]', '5,268', '1610, Galileo Galilei'],
      ['Titan', '[[saturn|Saturn]]', '5,150', '1655, Christiaan Huygens'],
      ['Callisto', '[[jupiter|Jupiter]]', '4,821', '1610, Galileo Galilei'],
      ['Io', '[[jupiter|Jupiter]]', '3,643', '1610, Galileo Galilei'],
      ['[[moon|Moon]]', '[[earth|Earth]]', '3,475', 'Known since prehistory'],
      ['Europa', '[[jupiter|Jupiter]]', '3,122', '1610, Galileo Galilei'],
      ['Triton', '[[neptune|Neptune]]', '2,707', '1846, William Lassell'],
      ['Titania', '[[uranus|Uranus]]', '1,577', '1787, William Herschel'],
      ['Rhea', '[[saturn|Saturn]]', '1,527', '1672, Giovanni Domenico Cassini'],
      ['Oberon', '[[uranus|Uranus]]', '1,523', '1787, William Herschel'],
      ['Iapetus', '[[saturn|Saturn]]', '1,469', '1671, Giovanni Domenico Cassini'],
      ['Charon', '[[pluto|Pluto]]', '1,212', '1978, James Christy'],
    ] },
    { type: 'text', text: `## Formation
Moons form in several ways. The large regular moons of the giant planets, such as the Galilean moons, grew from discs of gas and dust around their young planets. Earth's Moon and Pluto's Charon probably formed from debris after giant collisions. Other moons, such as Triton, were captured: they were once independent bodies that strayed too close to a planet.${ref('moons')}` },
    see(['moon'], ['jupiter'], ['saturn'], ['planet']),
    REFS,
    NAVBOX,
  ],
};

const DWARF = {
  slug: 'dwarf-planet', title: 'Dwarf planet', parent: 'solar-system', cats: ['dwarf-planets'],
  blocks: [
    hat('This article is about the class of objects. For the best-known dwarf planet, see [[pluto|Pluto]].'),
    infobox('Dwarf planets', 'dwarfs', 'The Moon and five dwarf planets drawn to scale', [
      ['Defined by', 'International Astronomical Union, 24 August 2006'],
      ['Recognised dwarf planets', '[[dwarf-planet#Ceres|Ceres]], [[pluto|Pluto]], [[dwarf-planet#Haumea|Haumea]], [[dwarf-planet#Makemake|Makemake]], [[dwarf-planet#Eris|Eris]]'],
      ['Largest', 'Pluto (by diameter); Eris (by mass)'],
      ['Where they are', 'Ceres in the [[asteroid-belt|asteroid belt]]; the others beyond Neptune'],
    ]),
    { type: 'text', text: `A **dwarf planet** is a body that orbits the [[sun|Sun]] and is massive enough to be pulled into a nearly round shape by its own gravity, but has not cleared the neighbourhood around its orbit and is not a moon. The category was created by the International Astronomical Union (IAU) in 2006,${ref('iau')} when [[pluto|Pluto]] was reclassified from a planet to a dwarf planet.

## Definition
The IAU definition of a [[planet|planet]] has three conditions. A dwarf planet meets the first two — it orbits the Sun and is nearly round — but fails the third: it shares its orbital zone with many other objects of similar size. Pluto, for example, is one of thousands of icy bodies in the [[kuiper-belt|Kuiper belt]].` },
    { type: 'callout', kind: 'note', title: 'Why the definition was needed', text: 'In 2005 astronomers announced the discovery of [[dwarf-planet#Eris|Eris]], an icy world about as large as Pluto and more massive. Either it had to become the tenth planet — with many more likely to follow — or the word "planet" needed a precise definition. The IAU chose the second option.' + ref('brown') },
    { type: 'text', text: '## Recognised dwarf planets' },
    { type: 'table', head: 'row', sortable: true, striped: true, caption: 'The five dwarf planets recognised by the IAU', rows: [
      ['Name', 'Discovered', 'Region', 'Mean diameter (km)'],
      ['[[dwarf-planet#Ceres|Ceres]]', '1801', '[[asteroid-belt|Asteroid belt]]', '940'],
      ['[[pluto|Pluto]]', '1930', '[[kuiper-belt|Kuiper belt]]', '2,377'],
      ['[[dwarf-planet#Haumea|Haumea]]', '2004–2005', '[[kuiper-belt|Kuiper belt]]', 'about 1,600 (elongated)'],
      ['[[dwarf-planet#Makemake|Makemake]]', '2005', '[[kuiper-belt|Kuiper belt]]', 'about 1,430'],
      ['[[dwarf-planet#Eris|Eris]]', '2005', 'Scattered disc', '2,326'],
    ] },
    { type: 'text', text: `### Ceres
Ceres was discovered by Giuseppe Piazzi on 1 January 1801 and was counted as a planet for about half a century, until many similar bodies had been found in the same region. With a diameter of about 940 km${imp(' (584 mi)')} it is the largest object in the [[asteroid-belt|asteroid belt]] and the only dwarf planet in the inner Solar System. NASA's *Dawn* spacecraft orbited Ceres from 2015 to 2018 and found bright deposits of salts in its craters.

### Pluto` },
    hat('[[pluto|Pluto]]', 'main'),
    { type: 'text', text: `Pluto was the ninth planet from its discovery in 1930 until 2006. It is the largest known dwarf planet by diameter and has five known moons, the largest of which is [[natural-satellite#Charon|Charon]].

### Haumea
Haumea spins so fast — once in about four hours — that it is stretched into an elongated, egg-like shape. It has two small moons and, as observations in 2017 revealed, a ring. It is named after the Hawaiian goddess of childbirth.

### Makemake
Makemake was discovered in 2005 by the team of Mike Brown, Chad Trujillo and David Rabinowitz, and named after the creator god of the people of Rapa Nui (Easter Island). It has a reddish-brown surface and one known moon.

### Eris
Eris was discovered in 2005 by the same team in images taken in 2003. It is almost the same size as Pluto, though slightly smaller, but about a quarter more massive. Its orbit is long and steeply tilted, taking it out to almost 100 AU from the Sun, and one orbit takes about 560 years. It is named after the Greek goddess of strife and discord, and its moon is called Dysnomia.${ref('brown')}

## Other candidates
Many other objects beyond Neptune, such as Gonggong, Quaoar and Sedna, may be round enough to qualify, but their shapes are hard to measure from Earth, and the IAU has not formally recognised them.` },
    see(['pluto'], ['kuiper-belt'], ['planet', 'the definition of a planet']),
    REFS,
    NAVBOX,
  ],
};

const PLUTO = {
  slug: 'pluto', title: 'Pluto', parent: 'dwarf-planet', cats: ['dwarf-planets', 'small-bodies'],
  blocks: [
    hat('This article is about the dwarf planet. For the class of objects it belongs to, see [[dwarf-planet|Dwarf planet]].'),
    infobox('Pluto', 'pluto', 'Pluto with its heart-shaped plain (illustration)', [
      ['Discovery'],
      ['Discovered by', 'Clyde Tombaugh, Lowell Observatory'],
      ['Discovery date', '18 February 1930'],
      ['Category', '[[dwarf-planet|Dwarf planet]], [[kuiper-belt|Kuiper belt]] object'],
      ['Orbital characteristics'],
      ['Mean distance from the Sun', `About 5.9 billion km (39.5 AU)${imp(' — about 3.7 billion mi')}`],
      ['Orbital period', '248 years'],
      ['Known moons', '5: [[natural-satellite#Charon|Charon]], Nix, Hydra, Kerberos and Styx'],
      ['Physical characteristics'],
      ['Mean diameter', `2,377 km${imp(' (1,477 mi)')}`],
      ['Rotation period', '6.4 days (retrograde)'],
      ['Surface temperature', `About −230 °C${imp(' (−382 °F)')}`],
      ['Named after', 'Pluto, the Roman god of the underworld; the name was suggested by Venetia Burney, an 11-year-old schoolgirl from Oxford', 'names'],
    ]),
    { type: 'text', text: `**Pluto** is a [[dwarf-planet|dwarf planet]] in the [[kuiper-belt|Kuiper belt]], a ring of icy bodies beyond the orbit of [[neptune|Neptune]]. Discovered in 1930, it was counted as the ninth planet for 76 years, until the International Astronomical Union reclassified it in 2006.${ref('iau')} Pluto is smaller than Earth's [[moon|Moon]] and is made of rock and ice.

## Discovery
At the start of the 20th century Percival Lowell, founder of the Lowell Observatory in Flagstaff, Arizona, searched for a hypothetical "Planet X" beyond Neptune. Years after his death, the young astronomer Clyde Tombaugh found Pluto by comparing photographs of the same patch of sky taken several nights apart; the discovery was made on 18 February 1930. The name was suggested by Venetia Burney, an 11-year-old girl from Oxford; its first two letters also honour Percival Lowell.

## Orbit
Pluto's orbit is elongated and tilted by about 17° to the plane of the planets. For part of each orbit it comes closer to the Sun than Neptune does — most recently between 1979 and 1999. The two can never collide, however: Pluto goes around the Sun exactly twice for every three orbits of Neptune, a resonance that keeps them far apart.

## Reclassification
From the 1990s onwards astronomers found more and more icy bodies in Pluto's region, and in 2005 they found [[dwarf-planet#Eris|Eris]], which is more massive than Pluto. In 2006 the IAU defined the word "planet" for the first time. Because Pluto shares its orbital zone with many other Kuiper belt objects, it did not meet the new definition and became a dwarf planet.${ref('brown')} Some scientists still disagree with the decision.

## Surface and atmosphere
The surface of Pluto is covered in ices of nitrogen, methane and carbon monoxide. Its most striking feature is a bright, heart-shaped region named Tombaugh Regio; the western half of the heart is Sputnik Planitia, a vast plain of slowly churning nitrogen ice. Mountains of water ice rise several kilometres high, and a thin nitrogen atmosphere with layers of blue haze surrounds the planet.${ref('stern')}

## Moons
Pluto has five known moons. **Charon**, discovered by James Christy in 1978, is about half as wide as Pluto, so the pair are sometimes called a double system; each always shows the same face to the other. The four small moons — Nix, Hydra, Kerberos and Styx — were discovered between 2005 and 2012.

## New Horizons
NASA's *New Horizons* spacecraft, launched on 19 January 2006, flew past Pluto on 14 July 2015 at a distance of about 12,500 km and returned the first detailed images of its surface. It then continued deeper into the Kuiper belt.${ref('stern')}` },
    { type: 'callout', kind: 'note', title: 'A traveller to Pluto', text: 'A small portion of the ashes of Clyde Tombaugh, who died in 1997, travelled past Pluto aboard *New Horizons*.' },
    see(['dwarf-planet'], ['kuiper-belt'], ['neptune']),
    REFS,
    NAVBOX,
  ],
};

const ASTEROIDS = {
  slug: 'asteroid-belt', title: 'Asteroid belt', parent: 'solar-system', cats: ['small-bodies'],
  blocks: [
    infobox('Asteroid belt', 'asteroids', 'Asteroids (illustration; real asteroids are far apart)', [
      ['Location', 'Between the orbits of [[mars|Mars]] and [[jupiter|Jupiter]]'],
      ['Distance from the Sun', 'About 2.2 to 3.2 AU'],
      ['Largest member', '[[dwarf-planet#Ceres|Ceres]], about 940 km across'],
      ['Other large members', 'Vesta, Pallas and Hygiea'],
      ['Total mass', "Only a few per cent of the Moon's mass"],
    ]),
    { type: 'text', text: `The **asteroid belt** is a ring-shaped region of the [[solar-system|Solar System]] between the orbits of [[mars|Mars]] and [[jupiter|Jupiter]], where millions of rocky and metallic bodies called **asteroids** orbit the [[sun|Sun]].${ref('nasa')} The largest, [[dwarf-planet#Ceres|Ceres]], is a dwarf planet; most of the others are irregular lumps of rock, many of them smaller than a city.

## Origin
The asteroids are leftovers from the formation of the planets. In this region the strong gravity of Jupiter stirred up the young bodies so much that they collided too violently to merge into a planet. Over billions of years, much of the original material has been broken up or thrown out of the belt.${ref('esss')}

## Composition
Most asteroids fall into three broad groups. **C-type** asteroids, the most common, are dark and rich in carbon. **S-type** asteroids are made of stony materials, and **M-type** asteroids appear to be largely metallic — perhaps pieces of the cores of shattered bodies.

## Structure
Asteroids are not spread evenly through the belt. At certain distances, where an asteroid would orbit the Sun an exact fraction of the times Jupiter does, Jupiter's repeated pulls have cleared out gaps, called Kirkwood gaps after the astronomer who noticed them in the 19th century. Despite the vast number of asteroids, the belt is mostly empty space: neighbouring asteroids are usually hundreds of thousands of kilometres apart, and spacecraft cross it without danger. *Pioneer 10* was the first to do so, in 1972–1973.

## Exploration
The *Galileo* spacecraft, on its way to Jupiter, made the first close flyby of an asteroid, Gaspra, in 1991, and in 1993 discovered that the asteroid Ida has its own tiny moon, Dactyl. NASA's *Dawn* orbited Vesta in 2011–2012 and then [[dwarf-planet#Ceres|Ceres]] from 2015 to 2018. The *Psyche* mission, launched in 2023, is travelling to a large metal-rich asteroid of the same name.` },
    see(['kuiper-belt', 'the icy belt beyond Neptune'], ['comet'], ['dwarf-planet']),
    REFS,
    NAVBOX,
  ],
};

const KUIPER = {
  slug: 'kuiper-belt', title: 'Kuiper belt', parent: 'solar-system', cats: ['small-bodies'],
  blocks: [
    infobox('Kuiper belt', 'orbits', 'The Kuiper belt is the outer dotted ring beyond the orbit of Neptune (not to scale)', [
      ['Location', 'Beyond the orbit of [[neptune|Neptune]]'],
      ['Distance from the Sun', 'About 30 to 50 AU'],
      ['First member found after Pluto', '1992 QB1 (now called Albion), in 1992'],
      ['Notable members', '[[pluto|Pluto]], [[dwarf-planet#Haumea|Haumea]], [[dwarf-planet#Makemake|Makemake]], Arrokoth'],
      ['Named after', 'Gerard Kuiper, Dutch-American astronomer', 'names'],
    ]),
    { type: 'text', text: `The **Kuiper belt** is a vast ring of icy bodies beyond the orbit of [[neptune|Neptune]], about 30 to 50 astronomical units from the [[sun|Sun]].${ref('nasa')} It resembles the [[asteroid-belt|asteroid belt]] but is far wider and more massive, and its members are made mostly of frozen water, methane and ammonia. The dwarf planets [[pluto|Pluto]], [[dwarf-planet#Haumea|Haumea]] and [[dwarf-planet#Makemake|Makemake]] are among its largest members.

## Discovery
Pluto, found in 1930, was the first known member of the belt, though nobody realised it at the time. In the 1940s and 1950s Kenneth Edgeworth and Gerard Kuiper speculated about icy bodies beyond Neptune, and the belt is named after Kuiper. The first Kuiper belt object other than Pluto and its moon Charon, 1992 QB1, was discovered in 1992 by David Jewitt and Jane Luu. Thousands are known today.${ref('esss')}

## Structure
Most Kuiper belt objects travel on fairly circular orbits close to the plane of the planets. Others, like Pluto, are locked in resonances with Neptune — Pluto and the many bodies that share its resonance are nicknamed "plutinos". Beyond and overlapping the belt lies the scattered disc, whose members, such as [[dwarf-planet#Eris|Eris]], follow long, tilted orbits.

## Source of comets
Many short-period [[comet|comets]] — those that return to the inner Solar System within 200 years — are thought to begin as icy bodies of the Kuiper belt and the scattered disc that were nudged inwards by the gravity of the giant planets.

## Exploration
NASA's *New Horizons* flew past Pluto in 2015 and then, on 1 January 2019, past the small Kuiper belt object Arrokoth — the most distant object yet explored up close. Arrokoth turned out to be made of two lobes gently joined together, about 36 km long in all.${ref('stern')}` },
    see(['pluto'], ['dwarf-planet'], ['asteroid-belt'], ['comet']),
    REFS,
    NAVBOX,
  ],
};

const COMET = {
  slug: 'comet', title: 'Comet', parent: 'solar-system', cats: ['small-bodies'],
  blocks: [
    infobox('Comet', 'comet', 'A comet near the Sun, with its two tails (illustration)', [
      ['Made of', 'Ice, dust and rock'],
      ['Size of the nucleus', 'Typically a few kilometres to a few tens of kilometres'],
      ['Parts', 'Nucleus, coma, dust tail, ion tail'],
      ['Sources', '[[kuiper-belt|Kuiper belt]] and scattered disc (short-period comets); Oort cloud (long-period comets)'],
      ['Well-known examples', "Halley's Comet, Hale–Bopp, Shoemaker–Levy 9"],
      ['Name origin', 'Greek *komētēs*, "long-haired"', 'names'],
    ]),
    { type: 'text', text: `A **comet** is a small icy body that, when it passes close to the [[sun|Sun]], warms up and releases gas and dust, producing a glowing cloud called a coma and often one or two long tails.${ref('comet')} Comets are leftovers from the formation of the [[solar-system|Solar System]], and they come mainly from two distant reservoirs: the [[kuiper-belt|Kuiper belt]] with the scattered disc, and the far more distant Oort cloud.

## Structure
The solid heart of a comet, the **nucleus**, is a loose mixture of ice, dust and rock — described by the astronomer Fred Whipple in 1950 as a "dirty snowball". As the comet nears the Sun, its ices turn directly into gas, which forms the **coma**, a cloud that can be larger than a planet. Sunlight pushes dust out of the coma into a broad, curved **dust tail**, while the solar wind sweeps electrically charged gas into a straight, bluish **ion tail**. Both tails point away from the Sun, whichever way the comet is moving, and they can stretch for millions of kilometres.

## Orbits
Short-period comets complete an orbit in less than 200 years and return again and again. Long-period comets fall in from the outer edges of the Solar System on orbits that take thousands or even millions of years.

## Halley's Comet
In 1705 Edmond Halley showed that the comets seen in 1531, 1607 and 1682 were one and the same object, and predicted that it would return in 1758.${ref('halley')} It reappeared as predicted, sixteen years after his death, and has carried his name ever since. Halley's Comet returns about every 76 years; it last passed close to the Sun in 1986 and will next do so in 2061. In March 1986 the European probe *Giotto* flew within about 600 km of its nucleus.

## Comets and meteor showers
Comets leave trails of dust along their orbits. When Earth passes through such a trail, the grains burn up in the atmosphere as a meteor shower. The Perseids of August come from comet Swift–Tuttle, and Halley's Comet is the source of two showers, the Eta Aquariids in May and the Orionids in October.

## Exploration
After *Giotto*, NASA's *Deep Impact* fired a projectile into comet Tempel 1 in 2005, and *Stardust* brought dust from comet Wild 2 back to Earth in 2006. The European *Rosetta* spacecraft orbited comet 67P/Churyumov–Gerasimenko from 2014 to 2016, and its lander *Philae* made the first soft landing on a comet in November 2014.

In July 1994 the fragments of comet Shoemaker–Levy 9, torn apart by [[jupiter|Jupiter]]'s gravity, crashed into the planet one after another — the first collision of two Solar System bodies ever observed.` },
    see(['kuiper-belt'], ['asteroid-belt'], ['sun', 'why the tails point away from the Sun']),
    REFS,
    NAVBOX,
  ],
};

const EXPLORATION = {
  slug: 'exploration', title: 'Exploration of the Solar System', cats: ['exploration'],
  blocks: [
    infobox('Exploration of the Solar System', 'voyager', 'A Voyager spacecraft (illustration)', [
      ['Telescopic era', 'Since 1609–1610'],
      ['First flyby of another planet', '*Mariner 2*, Venus, 1962'],
      ['First crewed Moon landing', '*Apollo 11*, 20 July 1969'],
      ['Planets visited by spacecraft', 'All eight'],
      ['Most distant spacecraft', '[[voyager-program|Voyager 1]]'],
    ]),
    { type: 'text', text: `The **exploration of the Solar System** began with naked-eye observations in prehistoric times, entered a new era when Galileo Galilei turned a telescope to the sky in 1609–1610,${ref('galileo')} and was transformed by the space age: since the 1960s robotic spacecraft have visited every planet, and twelve people have walked on the [[moon|Moon]].

## Timeline` },
    { type: 'timeline', style: 'line', items: [
      { date: '1610', title: 'Moons of Jupiter', link: 'natural-satellite#Galilean moons', text: 'Galileo Galilei discovers four moons orbiting Jupiter — the first moons found around another planet.' },
      { date: '1655', title: 'Titan', link: 'saturn', text: "Christiaan Huygens discovers Saturn's largest moon." },
      { date: '1781', title: 'Uranus', link: 'uranus', text: 'William Herschel discovers the first planet found with a telescope.' },
      { date: '1801', title: 'Ceres', link: 'dwarf-planet#Ceres', text: 'Giuseppe Piazzi finds the first object of the asteroid belt.' },
      { date: '1846', title: 'Neptune', link: 'neptune', text: 'Johann Galle finds Neptune where Urbain Le Verrier predicted it.' },
      { date: '1930', title: 'Pluto', link: 'pluto', text: 'Clyde Tombaugh discovers Pluto.' },
      { date: '1959', title: '*Luna 2* and *Luna 3*', link: 'moon', text: 'The first spacecraft to reach the Moon, and the first pictures of its far side.' },
      { date: '1962', title: '*Mariner 2*', link: 'venus', text: 'The first successful flyby of another planet, Venus.' },
      { date: '1965', title: '*Mariner 4*', link: 'mars', text: 'The first close-up pictures of Mars.' },
      { date: '1969', title: '*Apollo 11*', link: 'moon', text: 'Neil Armstrong and Buzz Aldrin become the first people to walk on the Moon.' },
      { date: '1970', title: '*Venera 7*', link: 'venus', text: 'The first spacecraft to send data from the surface of another planet.' },
      { date: '1973', title: '*Pioneer 10*', link: 'jupiter', text: 'The first flyby of Jupiter.' },
      { date: '1974', title: '*Mariner 10*', link: 'mercury', text: 'The first flyby of Mercury.' },
      { date: '1976', title: '*Viking 1*', link: 'mars', text: 'The first spacecraft to work for years on the surface of Mars.' },
      { date: '1977', title: 'Voyager launches', link: 'voyager-program', text: '*Voyager 2* and *Voyager 1* set off for the outer planets.' },
      { date: '1979', title: '*Pioneer 11*', link: 'saturn', text: 'The first flyby of Saturn.' },
      { date: '1986', title: '*Voyager 2* at Uranus', link: 'uranus', text: 'The only visit to Uranus so far. In the same year *Giotto* flies past [[comet|Halley\'s Comet]].' },
      { date: '1989', title: '*Voyager 2* at Neptune', link: 'neptune', text: 'The only visit to Neptune so far.' },
      { date: '1990', title: 'Pale Blue Dot', link: 'earth#Earth seen from space', text: '*Voyager 1* photographs Earth from about 6 billion km away.' },
      { date: '1992', title: 'Kuiper belt', link: 'kuiper-belt', text: 'The first Kuiper belt object besides Pluto and Charon is discovered.' },
      { date: '1995', title: '*Galileo* at Jupiter', link: 'jupiter', text: 'The first spacecraft to orbit Jupiter.' },
      { date: '1997', title: '*Mars Pathfinder*', link: 'mars', text: 'Its small rover *Sojourner* is the first to drive on Mars.' },
      { date: '2004', title: '*Cassini* at Saturn', link: 'saturn', text: 'The first spacecraft to orbit Saturn.' },
      { date: '2005', title: '*Huygens* on Titan', link: 'natural-satellite#Titan and the moons of Saturn', text: 'The first landing on a moon of another planet.' },
      { date: '2006', title: 'Pluto reclassified', link: 'dwarf-planet', text: 'The IAU defines "planet"; Pluto becomes a dwarf planet.' },
      { date: '2011', title: '*MESSENGER* at Mercury', link: 'mercury', text: 'The first spacecraft to orbit Mercury.' },
      { date: '2012', title: 'Interstellar space', link: 'voyager-program', text: '*Voyager 1* crosses the edge of the heliosphere.' },
      { date: '2014', title: '*Rosetta* and *Philae*', link: 'comet', text: 'The first soft landing on a comet.' },
      { date: '2015', title: '*New Horizons* at Pluto', link: 'pluto', text: 'The first flyby of Pluto; the same year *Dawn* begins to orbit Ceres.' },
      { date: '2019', title: 'Arrokoth', link: 'kuiper-belt', text: '*New Horizons* flies past the most distant object yet explored up close.' },
      { date: '2021', title: '*Perseverance* and *Ingenuity*', link: 'mars', text: 'The first powered flight on another planet.' },
    ] },
    { type: 'text', text: `## Telescopic era
For most of history the planets were points of light. Galileo's small telescope revealed the moons of Jupiter, the phases of Venus and the craters of the Moon, and it supported the idea that the planets orbit the Sun. Larger telescopes added [[uranus|Uranus]], [[neptune|Neptune]], [[pluto|Pluto]] and hundreds of moons and asteroids. Since 1990 the Hubble Space Telescope has observed the planets from above Earth's blurring atmosphere.

## Robotic spacecraft
Robotic missions come in several kinds: **flybys** pass a world once, **orbiters** circle it for years, **landers** set down on its surface and **rovers** drive across it. Flybys of every planet were achieved by 1989; orbiters have since studied Mercury, Venus, Mars, Jupiter and Saturn, and rovers have explored [[mars|Mars]] and the [[moon|Moon]].` },
    { type: 'media', media: 'rover', align: 'right', width: 260, frame: 'thumb', caption: 'Rovers have explored Mars since 1997 (illustration).' },
    { type: 'text', text: `## Crewed spaceflight
Only the [[moon|Moon]] has been visited by people. Between 1968 and 1972 nine Apollo crews travelled to it, and six of them landed. The challenge had been set by President John F. Kennedy in 1962:` },
    { type: 'quote', style: 'block', text: 'We choose to go to the Moon in this decade and do the other things, not because they are easy, but because they are hard.', author: 'John F. Kennedy', source: 'speech at Rice University, 12 September 1962' },
    { type: 'text', text: `## Beyond the planets` },
    hat('[[voyager-program|Voyager program]]', 'main'),
    { type: 'text', text: `The twin [[voyager-program|Voyager]] spacecraft, launched in 1977, explored the giant planets and then left the heliosphere, becoming the first human-made objects in interstellar space. *New Horizons* reached [[pluto|Pluto]] in 2015 and continued into the [[kuiper-belt|Kuiper belt]].${ref('bell')}` },
    see(['voyager-program'], ['moon', 'the Apollo landings'], ['mars', 'rovers on Mars'], ['solar-system']),
    REFS,
    NAVBOX,
  ],
};

const VOYAGER = {
  slug: 'voyager-program', title: 'Voyager program', parent: 'exploration', cats: ['exploration'],
  blocks: [
    infobox('Voyager program', 'voyager', 'One of the two identical Voyager spacecraft (illustration)', [
      ['Operator', 'NASA, Jet Propulsion Laboratory'],
      ['Spacecraft', '*Voyager 1* and *Voyager 2*'],
      ['Launched', '*Voyager 2*: 20 August 1977\n*Voyager 1*: 5 September 1977'],
      ['Launch vehicle', 'Titan IIIE–Centaur'],
      ['Power', 'Radioisotope thermoelectric generators'],
      ['Planets visited', '*Voyager 1*: [[jupiter|Jupiter]], [[saturn|Saturn]]\n*Voyager 2*: [[jupiter|Jupiter]], [[saturn|Saturn]], [[uranus|Uranus]], [[neptune|Neptune]]'],
      ['Entered interstellar space', '*Voyager 1*: 25 August 2012\n*Voyager 2*: 5 November 2018'],
    ]),
    { type: 'text', text: `The **Voyager program** is a NASA mission of two robotic space probes, *Voyager 1* and *Voyager 2*, launched in 1977 to study the outer planets.${ref('bell')} Between them they flew past [[jupiter|Jupiter]], [[saturn|Saturn]], [[uranus|Uranus]] and [[neptune|Neptune]] — Voyager 2 remains the only spacecraft to have visited the last two — and both later became the first human-made objects to reach interstellar space.` },
    { type: 'callout', kind: 'tip', title: 'Why "1" came second', text: '*Voyager 1* was launched sixteen days after *Voyager 2*, but on a faster path, so it reached Jupiter first — hence its number.' },
    { type: 'text', text: `## Background
In the late 1970s the outer planets lined up in a way that happens only about once every 175 years, so that a single spacecraft could swing from one planet to the next, using each planet's gravity to bend its path and gain speed. Voyager 2 used this rare opportunity to visit all four giant planets.

## Voyager 1
*Voyager 1* passed Jupiter in March 1979 and Saturn in November 1980, where it made a close flyby of the large moon Titan. That path bent its course up out of the plane of the planets. On 14 February 1990 it turned its cameras back to take a "family portrait" of the planets, including the image of [[earth|Earth]] known as the *Pale Blue Dot*.${ref('sagan')} In 1998 it became the most distant human-made object, and on 25 August 2012 it crossed the heliopause, where the solar wind gives way to interstellar space.

## Voyager 2
*Voyager 2* flew past Jupiter in July 1979, Saturn in August 1981, [[uranus|Uranus]] in January 1986 and [[neptune|Neptune]] in August 1989. It discovered new moons and rings at both of the ice giants and photographed Neptune's Great Dark Spot and the geysers of [[natural-satellite#Triton|Triton]]. It crossed the heliopause on 5 November 2018.

## The Golden Record` },
    { type: 'media', media: 'goldenrecord', align: 'left', width: 200, frame: 'thumb', layout: 'float', caption: 'The Golden Record (illustration)',
      text: `Each Voyager carries a 12-inch gold-plated copper phonograph record, a message for any intelligent beings that might one day find the spacecraft. The records hold sounds and images chosen to portray life and culture on Earth: greetings in 55 languages, music from many cultures and eras, and natural sounds such as wind, surf and birdsong. The contents were selected by a committee chaired by Carl Sagan.${ref('murmurs')}` },
    { type: 'text', text: `## Mission status
Both spacecraft continued to send data back to Earth more than four decades after launch, although their instruments have been switched off one by one as their nuclear power supply slowly weakens. Their radio signals, travelling at the speed of light, take many hours to reach Earth.` },
    { type: 'gallery', title: 'Worlds visited by the Voyagers', style: 'grid', size: 's', items: ['jupiter', 'saturn', 'uranus', 'neptune'].map((p) => ({ media: p, caption: `[[${p}|${NAMES[p]}]]`, link: p })) },
    see(['exploration', 'timeline of Solar System exploration'], ['neptune'], ['uranus']),
    REFS,
    NAVBOX,
  ],
};

const DISAMBIG = {
  slug: 'mercury-disambiguation', title: 'Mercury (disambiguation)', cats: ['disambiguation'],
  summary: 'Mercury may refer to the planet, the Roman god, the chemical element or the American human spaceflight programme.',
  blocks: [
    { type: 'disambig', intro: '**Mercury** may refer to:', items: [
      { link: 'mercury', label: 'Mercury (planet)', desc: 'the smallest planet of the Solar System and the closest to the Sun' },
      { label: 'Mercury (mythology)', desc: 'the Roman god of messengers, merchants and travellers, after whom the planet is named' },
      { label: 'Mercury (element)', desc: 'the chemical element with the symbol Hg, a metal that is liquid at room temperature' },
      { label: 'Project Mercury', desc: 'the first human spaceflight programme of the United States (1958–1963)' },
    ] },
    { type: 'text', text: 'Only the planet has an article in this encyclopedia. See also: [[planet|Planet]], [[solar-system|Solar System]].' },
    { type: 'callout', kind: 'info', title: 'Disambiguation page', text: 'This page lists articles associated with the same title. If an internal link led you here, you may wish to change the link to point directly to the intended article.' },
  ],
};

const REDIRECT = { slug: 'red-planet', title: 'Red Planet', kind: 'redirect', target: 'mars' };

const ABOUT = {
  slug: 'about', title: 'About this encyclopedia', image: 'logo',
  summary: 'How the Solar System Encyclopedia is organised: articles, versions, layers, sources and the hidden 451 page.',
  blocks: [
    { type: 'text', text: `The **Solar System Encyclopedia** is an example knowledge base in the style of an online encyclopedia. It covers the [[sun|Sun]], the [[planet|planets]], their [[natural-satellite|moons]], the [[dwarf-planet|dwarf planets]], the [[asteroid-belt|asteroids]], [[comet|comets]] and [[kuiper-belt|Kuiper belt]], and the [[exploration|exploration]] of the [[solar-system|Solar System]]. Replace, extend or delete anything: it is meant as a starting point for your own base.

## How articles are organised
Most articles begin with a short **lead** that summarises the topic; its first paragraph also appears in the preview when you hover over a link. An **infobox** on the right gives the key figures. Articles with three or more sections get an automatic **table of contents**. **Hatnotes** in italics at the top point to other articles with similar names, such as [[mercury-disambiguation|Mercury (disambiguation)]]. Small numbers in square brackets are **footnotes**: they lead to the list of references at the end. Every article about a body of the Solar System ends with the **Solar System** navigation box, and every page lists its categories at the bottom.

## Versions and layers
The articles [[solar-system|Solar System]] and [[earth|Earth]] also have a *Simple English* version, written with short sentences and common words; switch between them with the **Version** buttons under the title.

The **Show** bar switches optional layers on and off. *Imperial units* adds miles and degrees Fahrenheit next to metric values; *Name origins* shows where the names of the planets and moons come from.

## Numbers and sources
Figures are rounded to sensible precision. Distances are average distances from the Sun, and diameters are measured at the equator unless stated otherwise. Most planetary data follow the NASA Planetary Fact Sheet; the numbers of small moons of the giant planets change as new ones are found, so they are not given here. The illustrations are simplified flat drawings, not photographs, and they are not to scale unless the caption says so.

## Hidden pages (451)
This encyclopedia also contains a page that ordinary readers cannot see: the editors' notes, with a draft article. Without the password its address simply shows "page not found". To open it, add \`#?451=draft451\` to the end of the address of the encyclopedia, or enter the password \`draft451\` on the **Unlock** page in the tools menu. The hidden page then opens at \`#/editors-notes\`.` },
    { type: 'glossary', title: 'Glossary', layout: 'table', items: [
      { term: 'Astronomical unit (AU)', meaning: 'The average distance between Earth and the Sun, about 149.6 million km', link: 'solar-system#Distances and scale' },
      { term: 'Dwarf planet', meaning: 'A round body orbiting the Sun that has not cleared its orbit', link: 'dwarf-planet' },
      { term: 'Flyby', meaning: 'A mission that passes a world once without stopping', link: 'exploration#Robotic spacecraft' },
      { term: 'Gas giant', meaning: 'A giant planet made mostly of hydrogen and helium: Jupiter and Saturn', link: 'jupiter' },
      { term: 'Ice giant', meaning: 'A giant planet rich in water, ammonia and methane: Uranus and Neptune', link: 'neptune' },
      { term: 'Light-year', meaning: 'The distance light travels in a year, about 9.46 trillion km' },
      { term: 'Natural satellite', meaning: 'A moon: a natural body orbiting a planet or a smaller body', link: 'natural-satellite' },
      { term: 'Orbital period', meaning: 'The time a body takes to go once around the body it orbits', link: 'planet#The eight planets' },
      { term: 'Retrograde', meaning: 'Turning or orbiting in the direction opposite to most planets', link: 'venus#Rotation' },
      { term: 'Terrestrial planet', meaning: 'A rocky planet with a solid surface: Mercury, Venus, Earth and Mars', link: 'planet#Terrestrial and giant planets' },
    ] },
    { type: 'callout', kind: 'tip', title: 'Make it yours', text: 'Use this base as a model: add a page for each topic, link pages with double square brackets, group them with categories, and give the most important articles an infobox and a list of sources.' },
  ],
};

const EDITORS = {
  slug: 'editors-notes', title: "Editors' notes", parent: 'about',
  secret: { password: 'draft451', note: "Editors' notes and a draft article on the Oort cloud" },
  blocks: [
    { type: 'callout', kind: 'important', title: 'A 451 page', text: 'This page exists only for readers who know the password: everyone else gets "page not found". It holds work in progress that is not yet ready for the encyclopedia.' },
    { type: 'text', text: `## To do
- [x] Check the planet data against the NASA Planetary Fact Sheet
- [x] Write a Simple English version of [[earth|Earth]]
- [ ] Give [[dwarf-planet#Ceres|Ceres]] and [[dwarf-planet#Eris|Eris]] their own articles
- [ ] Write a Simple English version of [[pluto|Pluto]]
- [ ] Draw an illustration of the Oort cloud
- [ ] Finish the draft below and move it to its own page

## Style notes
- Round figures to two or three significant digits and say "about".
- Give numbers of moons only for Earth, Mars and Pluto: the counts for the giant planets change as new small moons are found.
- Prefer years to words such as "currently" or "recently", which go out of date.
- Cite a source for every figure in an infobox.

## Draft: Oort cloud
The **Oort cloud** is a hypothesised, roughly spherical cloud of icy bodies thought to surround the [[sun|Sun]] at distances from a few thousand to perhaps 100,000 astronomical units — far beyond the [[kuiper-belt|Kuiper belt]]. It has never been observed directly; its existence is inferred from the orbits of long-period [[comet|comets]], which fall towards the Sun from all directions.${ref('oort')}

The idea is named after the Dutch astronomer Jan Oort, who proposed it in 1950; Ernst Öpik had suggested a similar idea in 1932. {{placeholder|Add a citation for Öpik's paper.}}

{{placeholder|Section on how the cloud formed: icy bodies scattered outwards by the giant planets.}}

{{placeholder|Illustration: the Oort cloud compared with the orbits of the planets.}}` },
    REFS,
  ],
};

// ---------------------------------------------------------------------------------------------

// Structure (data module, commented at header level only): helpers above build markup strings and SVG artwork
// (generated in code rather than shipped as files: zero binary assets, deterministic, diffable); the default export
// is the template descriptor { id, icon, name, desc, spec({ lang }) } consumed by wiki-templates.js, whose spec() returns
// a kit spec (wiki-kit.js) - pages by slug, blocks as plain objects, media from SVG text, secret pages/variants with
// their demo passwords. buildKB normalises everything, so content here need not be perfectly shaped.
export default {
  id: 'wiki',
  icon: 'book',
  name: {
    en: 'Solar System encyclopedia', ru: 'Энциклопедия Солнечной системы', uk: 'Енциклопедія Сонячної системи', de: 'Enzyklopädie des Sonnensystems',
    fr: 'Encyclopédie du Système solaire', es: 'Enciclopedia del sistema solar', ka: 'მზის სისტემის ენციკლოპედია',
  },
  desc: {
    en: 'A Wikipedia-style encyclopedia of the Sun, planets and moons with infoboxes, footnotes, diagrams and navboxes (in English).',
    ru: 'Энциклопедия в стиле Википедии о Солнце, планетах и спутниках: карточки, сноски, схемы и навигационные шаблоны (на английском).',
    uk: 'Енциклопедія в стилі Вікіпедії про Сонце, планети й супутники: картки, виноски, схеми та навігаційні шаблони (англійською).',
    de: 'Eine Enzyklopädie im Wikipedia-Stil über Sonne, Planeten und Monde mit Infoboxen, Fußnoten, Diagrammen und Navigationsleisten (auf Englisch).',
    fr: 'Une encyclopédie à la Wikipédia sur le Soleil, les planètes et les lunes, avec infobox, notes, schémas et palettes de navigation (en anglais).',
    es: 'Una enciclopedia al estilo de Wikipedia sobre el Sol, los planetas y las lunas, con fichas, notas, diagramas y plantillas de navegación (en inglés).',
    ka: 'ვიკიპედიის სტილის ენციკლოპედია მზის, პლანეტებისა და თანამგზავრების შესახებ: ინფოდაფები, სქოლიოები, სქემები და სანავიგაციო თარგები (ინგლისურად).',
  },
  spec() {
    return {
      title: 'Solar System Encyclopedia', tagline: 'The illustrated encyclopedia of the Sun and its worlds',
      lang: 'en', uiLang: 'en', theme: 'encyclopedia', accent: '#3366cc', logo: 'logo', home: 'main-page',
      nav: [{ label: 'Solar System', link: 'solar-system' }, { label: 'Planets', link: 'planet' }, { label: 'Exploration', link: 'exploration' }, { label: 'About', link: 'about' }],
      footer: 'The **Solar System Encyclopedia** is an example knowledge base. Figures are rounded and taken from the sources cited in each article; the illustrations are simplified drawings, not photographs. [[about|About this encyclopedia]]',
      license: 'Text is available under the [Creative Commons Attribution-ShareAlike 4.0 License](https://creativecommons.org/licenses/by-sa/4.0/); additional terms may apply.',
      layers: [{ id: 'imperial', label: 'Imperial units', on: false }, { id: 'names', label: 'Name origins', on: true }],
      cats: [
        { slug: 'planets', name: 'Planets', desc: 'The eight major planets of the Solar System, from [[mercury|Mercury]] to [[neptune|Neptune]]. See also the [[planet|comparison of the planets]].' },
        { slug: 'dwarf-planets', name: 'Dwarf planets', desc: 'Round worlds that orbit the Sun but have not cleared their orbits. See [[dwarf-planet|Dwarf planet]].' },
        { slug: 'moons', name: 'Moons', desc: 'Natural satellites of the planets and dwarf planets. See [[natural-satellite|Natural satellite]].' },
        { slug: 'small-bodies', name: 'Small bodies', desc: 'Asteroids, comets and the icy bodies of the Kuiper belt.' },
        { slug: 'exploration', name: 'Exploration', desc: 'Telescopes, spacecraft and crewed missions that explored the Solar System. See the [[exploration|timeline of exploration]].' },
        { slug: 'solar-system', name: 'Solar System', desc: 'Articles about the Solar System as a whole and about its star, the Sun.' },
        { slug: 'disambiguation', name: 'Disambiguation pages', desc: 'Pages that list the different meanings of one name.' },
      ],
      media: media(),
      pages: [MAIN, SOLAR_SYSTEM, SUN, PLANET, MERCURY, VENUS, EARTH, MOON, MARS, JUPITER, SATURN, URANUS, NEPTUNE, SATELLITE, DWARF, PLUTO, ASTEROIDS, KUIPER, COMET,
        EXPLORATION, VOYAGER, DISAMBIG, REDIRECT, ABOUT, EDITORS],
    };
  },
};
