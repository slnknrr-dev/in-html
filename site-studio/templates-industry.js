// site-studio/templates-industry.js - template "metallurgy": a steel and metals works with grades and
// standards tables, certificates, capacities, process, logistics, sustainability figures and an RFQ quote cart
// (ru default, en, de; theme preset 'forge').
//
// Contract of a template module: each exported template object carries an id, localized names and build(V, ...) ->
// a fresh document; templates.js adds catalogue metadata (group, mode, modules) where the module does not declare it,
// and studio/gallery.js shows the catalogue.
// The viewer API arrives as the argument V instead of an import, so templates are pure document builders that tests
// (test.js renders every template) and the gallery can run without the editor. Generated artwork and sample data are
// derived from seeds (tplHash / tplRand where used), so a template builds the same document on every run.
// Data file: names, texts, figures and art specs dominate; comments mark sections, not individual values.
import { tplHash, tplRand } from '../sample/bytes.js';
import { tplKit } from './templates-kit.js';
import { TPL_ART_PROFILE, TPL_ART_SVG, tplArtMap, tplArtWordmark, tplIsoFigure, tplIsoScene, tplIsoStudio } from './templates-art.js';
import { tplAgroPortrait } from './templates-agro.js';
// ===== Template: metallurgy — KRAMOR steel works (ru default, en, de) =====
// Built only from the generic blocks; every picture is data for the generic isometric kit (templates-art.js).
// All companies, people, places, phone numbers, certificates, figures and projects below are FICTIONAL.

// ---------------------------------------------------------------------------
// Pictures as data (generic primitives: box, cyl, prism, disc, glow, sparks, figure, stroke, arc, group)
// ---------------------------------------------------------------------------

/** Paints of the metallurgy pictures (on top of the kit's named paints). */
const TPL_METAL_PAINT = {
  hrc: ['#9aa7b4', '#6c7884', '#4e5864'], plate: ['#93a0ac', '#69747f', '#4c5660'], beam: ['#a7b1ba', '#7b8691', '#58626c'],
  rebar: ['#8d8780', '#625b55', '#47413c'], pipe: ['#e2e8ee', '#aab5c0', '#7c8893'], ingot: ['#8f8984', '#68625d', '#4a4541'],
};

/** Hex bundle of round bars (y, z offsets) inside radius R with spacing d, sorted back to front. */
function tplMetalBundle(R, d) {
  const out = [];
  const h = d * 0.8660254;
  for (let k = -6; k <= 6; k++) {
    for (let j = -6; j <= 6; j++) {
      const u = j * d + (k % 2 ? d / 2 : 0), v = k * h;
      if (Math.hypot(u, v) <= R + 1e-6) out.push([u, v]);
    }
  }
  return out.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
}

/** Lying coil on a saddle (axis y): centre x, start y. */
const tplMetalCoil = (x, y, c = TPL_METAL_PAINT.hrc, r = 10) => [
  { box: [x - r * 0.9, y + 1, 0, r * 1.8, 11, 2.2], c: 'black' },
  { cyl: [x, y, r + 2.2], axis: 'y', r, len: 13, c, hole: r * 0.34, rings: 5, straps: [0.22, 0.78] },
];

/** The products and scenes: name → spec (a list of primitives). */
const TPL_METAL_ART = {
  coils: () => [
    { shadow: [-11, 0, 26, 18] },
    ...tplMetalCoil(0, 0),
    { cyl: [19, 9, 0], axis: 'z', r: 7.4, len: 8.5, c: 'bright', hole: 2.8, rings: 4, straps: [0.5] },
  ],
  plate: () => {
    const rnd = tplRand(tplHash('plate'));
    const s = [{ shadow: [0, -1, 44, 27] }, { box: [4, -1, 0, 3, 28, 2], c: 'wood' }, { box: [37, -1, 0, 3, 28, 2], c: 'wood' }];
    for (let i = 0; i < 6; i++) s.push({ box: [rnd() * 1.2, rnd() * 1.2, 2 + i * 1.3, 44, 26, 1.3], c: TPL_METAL_PAINT.plate });
    s.push({ stroke: [[[6, 4, 9.8], [18, 4, 9.8]], [[6, 7, 9.8], [13, 7, 9.8]]], color: '#f5f2ea', w: 0.5, opacity: 0.75 });
    return s;
  },
  beams: () => {
    const I = TPL_ART_PROFILE.ibeam(8, 10, 0.9, 1.3);
    return [
      { shadow: [0, -4, 48, 14] }, { box: [5, -5, 0, 3, 19, 1.4], c: 'wood' }, { box: [38, -5, 0, 3, 19, 1.4], c: 'wood' },
      { prism: [0, 0, 1.4], axis: 'x', len: 46, profile: I, c: TPL_METAL_PAINT.beam },
      { prism: [0, 9, 1.4], axis: 'x', len: 46, profile: I, c: TPL_METAL_PAINT.beam },
      { prism: [2, 4.5, 11.4], axis: 'x', len: 46, profile: I, c: TPL_METAL_PAINT.beam },
    ];
  },
  rebar: () => {
    const s = [{ shadow: [0, -5, 50, 6] }, { box: [6, -5, 0, 2.6, 10, 1.2], c: 'wood' }, { box: [40, -5, 0, 2.6, 10, 1.2], c: 'wood' }];
    for (const [u, v] of tplMetalBundle(4, 1.6)) s.push({ cyl: [0, u, 5.6 + v], axis: 'x', r: 0.72, len: 50, c: TPL_METAL_PAINT.rebar });
    for (const x of [9, 25, 41]) s.push({ arc: [x, 0, 5.6], axis: 'x', r: 4.9, color: '#c9c2b6', w: 0.42 });
    return s;
  },
  rounds: () => {
    const s = [{ shadow: [0, -5, 42, 6] }, { box: [6, -5, 0, 2.6, 10, 1.2], c: 'wood' }, { box: [32, -5, 0, 2.6, 10, 1.2], c: 'wood' }];
    for (const [u, v] of tplMetalBundle(3.4, 3.3)) s.push({ cyl: [0, u, 5.3 + v], axis: 'x', r: 1.6, len: 40, c: 'bright' });
    for (const x of [10, 30]) s.push({ arc: [x, 0, 5.3], axis: 'x', r: 5.3, color: '#3f6f96', w: 0.5 });
    return s;
  },
  pipes: () => {
    const rows = [[0, 5.2], [8.4, 5.2], [4.2, 12.47], [16.8, 5.2], [12.6, 12.47], [8.4, 19.74]];
    return [{ shadow: [0, -4, 46, 21] }, { box: [5, -4, 0, 3, 25, 1.2], c: 'wood' }, { box: [36, -4, 0, 3, 25, 1.2], c: 'wood' },
      ...rows.map(([y, z]) => ({ cyl: [0, y, z], axis: 'x', r: 4, len: 44, c: TPL_METAL_PAINT.pipe, hole: 3.3, holeFill: '#1b2026' }))];
  },
  castings: () => {
    const T = TPL_ART_PROFILE.trapezoid(5.4, 4.4, 4.8);
    const holes = [];
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.3; holes.push({ disc: [34 + 6 * Math.cos(a), 9 + 6 * Math.sin(a), 2.45], axis: 'z', r: 0.6, fill: '#24201e' }); }
    return [{ shadow: [0, -3, 42, 17] },
      { prism: [0, 0, 0], axis: 'x', len: 20, profile: T, c: TPL_METAL_PAINT.ingot },
      { prism: [0, 6.2, 0], axis: 'x', len: 20, profile: T, c: TPL_METAL_PAINT.ingot },
      { prism: [1, 3.1, 4.8], axis: 'x', len: 20, profile: T, c: TPL_METAL_PAINT.ingot },
      { cyl: [34, 9, 0], axis: 'z', r: 7.6, len: 2.4, c: 'cast' }, ...holes,
      { cyl: [34, 9, 2.4], axis: 'z', r: 4.6, len: 6.5, c: 'cast', hole: 2.4, holeFill: '#24201e' },
      { stroke: [[[3, 3.1, 9.7], [9, 3.1, 9.7]]], color: '#f5f2ea', w: 0.45, opacity: 0.75 }];
  },
  ladle: (o = {}) => {
    const ribs = [];
    for (let a = -20; a <= 110; a += 26) {
      const t = (a * Math.PI) / 180;
      ribs.push([[18 + 10.6 * Math.cos(t), 18 + 10.6 * Math.sin(t), 4.5], [18 + 16.7 * Math.cos(t), 18 + 16.7 * Math.sin(t), 25]]);
    }
    return [
      { shadow: [2, 2, 36, 38] }, { box: [6, 6, 0, 24, 24, 4], c: 'black' },
      { cyl: [18, -4.5, 21], axis: 'y', r: 3, len: 4.5, c: 'dark' },
      { cyl: [18, 18, 4], axis: 'z', r: 10.5, r1: 16.6, len: 21, c: 'cast', noCap: true },
      { stroke: ribs, color: '#38332f', w: 1.3 },
      { cyl: [18, 18, 25], axis: 'z', r: 17.8, len: 2.4, c: 'cast' },
      { disc: [18, 18, 27.4], axis: 'z', r: 16, fill: '@molten' },
      { box: [13.5, 33.2, 16.5, 9, 3, 9], c: 'cast' },
      { cyl: [18, 36.2, 21], axis: 'y', r: 3, len: 4.2, c: 'dark' },
      { glow: [18, 18, 31], rx: 22, ry: 13, c0: '#ffe3a1', c1: '#ff8a1f', a: 0.55 },
      { sparks: [18, 18, 33], d: 16, l: 2.4, n: o.sparks || 16, seed: 31 },
    ];
  },
  furnace: () => {
    const el = [], arms = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4, x = 20 + 3.6 * Math.cos(a), y = 20 + 3.6 * Math.sin(a);
      el.push({ cyl: [x, y, 21], axis: 'z', r: 1.3, len: 15, c: 'bright' });
      arms.push({ box: [-4, y - 0.8, 31 - i * 1.6, x + 4.6, 1.6, 1.4], c: 'blue' });
    }
    return [
      { shadow: [0, 2, 42, 40] }, { box: [-8, 15, 0, 5, 8, 38], c: 'blue' },
      { box: [4, 4, 0, 32, 32, 4], c: 'black' },
      { cyl: [20, 20, 4], axis: 'z', r: 15, len: 11, c: 'dark' },
      { cyl: [20, 20, 15], axis: 'z', r: 15.6, len: 1.4, c: 'black' },
      { glow: [20, 20, 16], rx: 28, ry: 15, c0: '#fff1b8', c1: '#ff7a1a', a: 0.7 },
      { cyl: [20, 20, 16.6], axis: 'z', r: 14, r1: 7.5, len: 4.6, c: 'steel' },
      ...el, ...arms,
      { box: [35, 17, 8, 7, 6, 2.6], c: 'orange' },
      { sparks: [20, 20, 17], d: 24, l: 3, n: 30, seed: 11, a0: -175, a1: -5 },
    ];
  },
  caster: () => {
    const s = [{ shadow: [0, 0, 74, 12] }];
    for (const x of [2, 14]) s.push({ box: [x, -2, 0, 2.4, 2.4, 24], c: 'dark' });
    s.push({ box: [0, 0, 24, 18, 12, 5], c: 'blue' }, { box: [1, 1, 29, 16, 10, 0.5], c: 'hot' });
    s.push({ cyl: [9, 6, 30], axis: 'z', r: 5.5, r1: 7.4, len: 7, c: 'cast', noCap: true }, { disc: [9, 6, 37], axis: 'z', r: 7, fill: '@molten' });
    s.push({ box: [7, 3, 17, 4, 6, 7], c: 'dark' });
    for (let x = 24; x <= 62; x += 3.4) s.push({ cyl: [x, 2, 1.1], axis: 'y', r: 0.9, len: 8, c: 'dark' });
    const n = 12;
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * (Math.PI / 2), x = 23 - 14 * Math.cos(t), z = 17 - 14 * Math.sin(t);
      s.push({ box: [x - 1, 3, z - 1, 2, 6, 2], c: i < 5 ? 'hot' : 'warm' });
    }
    s.push({ box: [23, 3, 2, 34, 6, 2], c: 'warm' }, { box: [61, 3, 2, 13, 6, 2], c: 'rust' });
    s.push({ glow: [12, 6, 20], rx: 18, ry: 12, c0: '#ffe3a1', c1: '#ff8a1f', a: 0.5 }, { sparks: [59, 6, 4], d: 9, l: 1.8, n: 22, seed: 4, a0: -160, a1: -20 });
    return s;
  },
  stand: () => {
    const s = [{ shadow: [-28, -24, 52, 24] }, { box: [6, -26, 0, 12, 9, 12], c: 'blue' }];
    for (const z of [10.6, 6.4]) s.push({ cyl: [13, -17, z], axis: 'y', r: 0.9, len: 15, c: 'steel' });
    for (let x = -28; x <= 50; x += 4.2) if (x < 7 || x > 19) s.push({ cyl: [x, 2, 5.4], axis: 'y', r: 0.9, len: 14, c: 'dark' });
    s.push({ box: [10, -2, 0, 6, 4, 30], c: 'dark' });
    s.push({ cyl: [13, 0, 2.2], axis: 'y', r: 2.6, len: 16, c: 'steel' }, { cyl: [13, 0, 6.4], axis: 'y', r: 1.7, len: 16, c: 'bright' });
    s.push({ box: [-28, 3, 6.4, 39, 10, 2.6], c: 'hot' }, { box: [15, 3, 6.4, 37, 10, 1.4], c: 'warm' });
    s.push({ glow: [0, 8, 9], rx: 20, ry: 10, c0: '#ffe9b0', c1: '#ff8a1f', a: 0.5 });
    s.push({ cyl: [13, 0, 10.6], axis: 'y', r: 1.7, len: 16, c: 'bright' }, { cyl: [13, 0, 15.2], axis: 'y', r: 2.8, len: 16, c: 'steel' });
    s.push({ box: [10, 16, 0, 6, 4, 30], c: 'dark' }, { box: [9.4, -2.6, 30, 7.2, 23.2, 3.4], c: 'orange' });
    return s;
  },
  yard: () => {
    const s = [{ shadow: [-12, -10, 66, 44] }];
    s.push({ box: [-14, -12, 0, 4, 4, 34], c: 'dark' }, { box: [-14, -12, 34, 4, 56, 3.4], c: 'orange' });
    for (const [x, y] of [[0, 0], [22, 0], [44, 0]]) s.push(...tplMetalCoil(x, y));
    s.push({ stroke: [[[-12, 14, 34], [-12, 14, 22]]], color: '#2b3138', w: 0.35 }, { box: [-13.5, 12.5, 19.5, 3, 3, 2.5], c: 'amber' });
    for (const [x, y] of [[11, 20], [33, 20]]) s.push(...tplMetalCoil(x, y, TPL_METAL_PAINT.hrc));
    s.push({ box: [-14, 40, 0, 4, 4, 34], c: 'dark' });
    s.push({ figure: [56, 40, 0], fill: '#0a1118', hat: '#f2b523' });
    return s;
  },
  lab: () => [
    { shadow: [0, 0, 36, 16] },
    { box: [0, 0, 0, 34, 14, 9], c: 'paper' }, { box: [-0.5, -0.5, 9, 35, 15, 0.8], c: 'stone' },
    { box: [2, 1.5, 9.8, 11, 9, 8], c: 'paper' }, { box: [4, 10.55, 13, 6.5, 0.2, 3], c: 'navy' },
    { box: [19, 2.5, 9.8, 6, 5, 1.2], c: 'dark' }, { cyl: [22, 3.6, 11], axis: 'z', r: 0.8, len: 7, c: 'dark' },
    { box: [20, 2.6, 17, 5, 3.2, 2.4], c: 'bright' }, { cyl: [22.4, 6.2, 15], axis: 'z', r: 0.8, len: 2.4, c: 'bright' },
    { cyl: [28, 9, 9.8], axis: 'z', r: 1.6, len: 0.9, c: 'bright' }, { cyl: [31.4, 10.6, 9.8], axis: 'z', r: 1.6, len: 0.9, c: 'bright' },
    { box: [14, 11, 9.8, 10, 1.2, 0.6], c: 'bright' },
    { figure: [38, 18, 0], fill: '#2c3e5c', hat: '' },
  ],
};

/** Hero: melt → cast → roll on one blueprint stage (ladle, rolling stand, finished coils). */
const tplMetalHeroSpec = () => [
  { group: [-80, 22, 0], items: TPL_METAL_ART.ladle({ sparks: 22 }) },
  { figure: [-40, 52, 0], fill: '#0a1118', hat: '#f2b523', lean: -2 },
  { group: [0, 0, 0], items: TPL_METAL_ART.stand() },
  { group: [72, -4, 0], items: [...tplMetalCoil(0, 0), ...tplMetalCoil(0, 17)] },
  { figure: [86, 34, 0], fill: '#0a1118', hat: '#ea5b0c' },
];

/** Studio shot of a product spec. */
const tplMetalShot = (name) => tplIsoStudio(TPL_METAL_ART[name](), { seed: tplHash('kramor:' + name) });

/** Chat avatar (160×160): an engineer figure in a hard hat on the blueprint backdrop (kit figure primitive). */
function tplMetalAvatarSVG() {
  return TPL_ART_SVG + 'viewBox="0 0 160 160" width="160" height="160"><defs>' +
    '<linearGradient id="a" x1="0" y1="0" x2=".3" y2="1"><stop offset="0" stop-color="#1b3247"/><stop offset="1" stop-color="#0b1520"/></linearGradient>' +
    '<pattern id="g" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M16 0H0V16" fill="none" stroke="#5f9bc4" stroke-opacity=".18"/></pattern>' +
    '<radialGradient id="l" cx=".5" cy=".42" r=".55"><stop offset="0" stop-color="#ff9a4a" stop-opacity=".45"/><stop offset="1" stop-color="#ff9a4a" stop-opacity="0"/></radialGradient></defs>' +
    '<rect width="160" height="160" fill="url(#a)"/><rect width="160" height="160" fill="url(#g)"/><rect width="160" height="160" fill="url(#l)"/>' +
    '<rect y="138" width="160" height="22" fill="#ea5b0c"/><path d="M0 138h160" stroke="#15191e" stroke-width="3"/>' +
    tplIsoFigure(80, 150, 118, '#e3e9ee', '#ea5b0c') + '</svg>';
}

/** Brand mark: hex nut with a "K" (64×64). */
function tplMetalBrandSVG() {
  return TPL_ART_SVG + 'viewBox="0 0 64 64" width="64" height="64">' +
    '<path d="M32 1.5L58.4 16.8V47.2L32 62.5L5.6 47.2V16.8Z" fill="#ea5b0c"/>' +
    '<path d="M32 8.6L52.3 20.4V43.6L32 55.4L11.7 43.6V20.4Z" fill="#15191e"/>' +
    '<path d="M21.5 19.5h6.2v10.1l9.6-10.1h7.9L34.6 30.6l11.3 14h-8.1l-8-10.3-2.1 2.2v8.1h-6.2Z" fill="#f4f6f8"/>' +
    '<path d="M51 41.6l2.2 1.3M13 22.4l-2.2-1.3" stroke="#15191e" stroke-width="1.6"/></svg>';
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

function tplBuildMetallurgy(V) {
  const K = tplKit(V, ['ru', 'en', 'de']);
  const { B, L } = K;
  const t = (ru, en, de) => ({ ru, en, de });
  const p = (ru, en, de) => t('<p>' + ru + '</p>', '<p>' + en + '</p>', '<p>' + de + '</p>');
  const img = (name, svg, title) => K.svg(name, svg, { title });
  const pdf = (name, title, lines, band, ttl, desc) => K.addAtt({
    name, mime: 'application/pdf', data: K.files.makePDF(title, lines, { accent: '#ea5b0c', band }), title: ttl, desc,
  });
  const col = (w, blocks) => ({ id: K.id(), w, blocks });
  const field = (key, type, label, ph, o = {}) => K.item({ key, type, label: L(label), ph: L(ph || ''), options: L(o.options || ''), required: !!o.required, half: !!o.half });
  const cell = (v, o) => K.cell(v, o);
  const th = (v, o = {}) => K.cell(v, { th: true, ...o });

  // ----- pictures -----
  const brand = img('kramor-mark.svg', tplMetalBrandSVG(), t('Знак КРАМОР', 'KRAMOR mark', 'KRAMOR-Zeichen'));
  const hero = img('kramor-melt-cast-roll.svg', tplIsoScene(1200, 900, tplMetalHeroSpec(), { pad: 64, dy: 18, glow: [0.42, 0.5, 0.5], glowC0: '#ff9a4a', glowC1: '#7a2d06' }),
    t('Ковш с жидкой сталью, прокатная клеть и готовые рулоны', 'Ladle of liquid steel, rolling stand and finished coils', 'Pfanne mit flüssigem Stahl, Walzgerüst und fertige Coils'));
  const shot = {};
  for (const k of ['coils', 'plate', 'beams', 'rebar', 'rounds', 'pipes', 'castings']) shot[k] = img('product-' + k + '.svg', tplMetalShot(k), '');
  const scene = (name, o = {}) => img('process-' + name + '.svg', tplIsoScene(900, 900, TPL_METAL_ART[name](), { pad: 92, dy: 12, glow: [0.5, 0.56, 0.46], ...o }), '');
  const scenes = {
    furnace: scene('furnace', { glowC0: '#ff9a4a', glowC1: '#7a2d06', bg0: '#211913', bg1: '#0c0907' }),
    ladle: scene('ladle', { glowC0: '#ffcf7a', glowC1: '#ff6a1a', bg0: '#211913', bg1: '#0c0907' }),
    caster: scene('caster', { pad: 70 }),
    stand: scene('stand', { pad: 70, bg0: '#1a2433', bg1: '#0b1119' }),
    yard: scene('yard', { pad: 80, bg0: '#16262f', bg1: '#0a1217' }),
    lab: scene('lab', { light: true, pad: 110, glow: [0.5, 0.5, 0.5] }),
  };
  const band = img('kramor-melt-shop.svg', tplIsoScene(1600, 520, [{ anchor: [-58, 50, 0] }, { anchor: [70, -12, 0] }, ...TPL_METAL_ART.ladle({ sparks: 40 }),
    { figure: [2, 40, 0], fill: '#050607', hat: '#ea5b0c', lean: 2 }, { figure: [-6, 45, 0], fill: '#050607', hat: '#f2b523', lean: 2 }],
  { pad: 64, dy: 26, glow: [0.6, 0.46, 0.36], glowC0: '#ffcf7a', glowC1: '#ff6a1a', bg0: '#1d1712', bg1: '#090706' }), '');
  const map = img('kramor-logistics-map.svg', tplArtMap({ seed: 'kramor', rail: true, coast: 'right', river: true, ground: '#e8ecef', block: '#d8dee4', building: '#c5cdd6', park: '#cfdccb', water: '#9fc2da',
    pins: [[330, 520, '#ea5b0c', 1.3], [610, 300, '#2e6a94', 1], [1010, 640, '#2e6a94', 1]] }),
  t('Схема: комбинат, железнодорожная станция и морской терминал', 'Map: the works, rail station and sea terminal', 'Karte: Werk, Bahnhof und Seeterminal'));
  const site = img('kramor-site.svg', tplArtMap({ seed: 'ferrovsk', river: true, rail: true, ground: '#e8ecef', block: '#d8dee4', building: '#c5cdd6', park: '#cfdccb', water: '#9fc2da', pins: [[640, 470, '#ea5b0c', 1.4]] }),
    t('Комбинат и офис продаж на карте', 'The works and sales office on the map', 'Werk und Vertrieb auf der Karte'));
  const people = [
    img('team-orlova.svg', tplAgroPortrait({ seed: 'orlova', bg: ['#d7e1ea', '#9fb3c6'], skin: '#f0cdb4', skin2: '#e0b394', hair: '#5a3a2a', style: 'bun', shirt: '#2b3a4a', shirt2: '#1d2833', collar: '#f3f5f7' }), ''),
    img('team-belov.svg', tplAgroPortrait({ seed: 'belov', bg: ['#dbe3ea', '#a7b8c8'], skin: '#e9c3a6', skin2: '#d9a988', hair: '#3b302a', style: 'short', shirt: '#3f5a73', shirt2: '#2c4256', collar: '#e9eef2', glasses: true }), ''),
    img('team-safin.svg', tplAgroPortrait({ seed: 'safin', bg: ['#e2e7ec', '#aebccb'], skin: '#d9a77f', skin2: '#c48f68', hair: '#1f1b18', style: 'short', beard: true, shirt: '#253141', shirt2: '#18202b', collar: '#e9eef2' }), ''),
    img('team-lind.svg', tplAgroPortrait({ seed: 'lind', bg: ['#e4e9ee', '#b4c3d0'], skin: '#f1d0b8', skin2: '#e2b597', hair: '#b88a4a', style: 'long', shirt: '#2f3d4b', vest: '#ea5b0c', collar: '#f2b523' }), ''),
  ];
  const clients = [
    ['peak', 'MOSTOSTROY-5', '#5d7286'], ['gear', 'NORDKRAN', '#6a6f78'], ['drop', 'PIPELINE EAST', '#5f7488'],
    ['wave', 'IRON BAY PORT', '#5a7090'], ['bars', 'STALKONSTRUKT', '#6b7382'], ['hex', 'POLAR ORE', '#587083'],
  ].map(([k, n, c]) => ({ id: img('client-' + n.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.svg', tplArtWordmark(k, n, c), n), name: n }));

  // ----- documents (sample PDFs, ASCII text) -----
  const catalogue = pdf('kramor-steel-catalogue-2026.pdf', 'KRAMOR - Steel products catalogue 2026', [
    '> KRAMOR steel works - Ferrovsk - electric arc furnace route, 2.4 Mt of steel per year',
    '',
    '# Flat products',
    '- Hot-rolled coil: 1.5-16 mm x 900-1850 mm, coil weight up to 28 t',
    '- Heavy plate: 6-120 mm x 1500-2800 mm x 6-12 m, normalised or TMCP',
    '# Long products',
    '- Beams 10B1-60B1 and HEA/HEB 100-600, channels, angles',
    '- Rebar A500C / B500C, 8-40 mm, bars 11.7 m or coils',
    '- Rounds 16-250 mm in carbon and alloy grades (40Kh / 41Cr4, 12Kh18N10T / 1.4541)',
    '# Pipes',
    '- Longitudinally welded pipes 530-1420 mm, K52-K60 / API 5L X52-X70',
    '- Seamless pipes 57-426 mm',
    '# Castings and ingots',
    '- Steel castings 50 kg - 60 t to customer drawings; ingots 3-28 t for forging',
    '',
    '# Certification',
    '- Inspection certificates EN 10204 3.1 for every heat; 3.2 with third-party inspection on request',
    '- ISO 9001, ISO 14001, ISO 45001, ISO 50001',
    '',
    'Sales: +7 (000) 000-68-00 - sales@kramor.example - rfq@kramor.example',
    '',
    '> Sample document generated by the landing template. All names, figures and data are fictional.',
  ], 'PRODUCT CATALOGUE 2026', t('Каталог продукции 2026', 'Product catalogue 2026', 'Produktkatalog 2026'),
  t('Плоский и сортовой прокат, трубы, литьё и слитки', 'Flat and long products, pipes, castings and ingots', 'Flach- und Langprodukte, Rohre, Guss und Blöcke'));
  const mtc = pdf('inspection-certificate-3-1-sample.pdf', 'Inspection certificate EN 10204 3.1 - sample', [
    '> Certificate No. KR-3.1-2026-084412 - sample document',
    '',
    '# Product',
    '- Hot-rolled plate 20 x 2500 x 12000 mm, grade S355J2+N (EN 10025-2)',
    '- Heat No. 61-48207, 14 plates, 66.2 t',
    '# Chemical composition, % (ladle analysis)',
    '- C 0.16 - Mn 1.42 - Si 0.31 - P 0.012 - S 0.004 - Cu 0.12 - Al 0.034 - CEV 0.41',
    '# Mechanical properties (transverse)',
    '- Yield strength ReH 392 MPa (min. 355)',
    '- Tensile strength Rm 541 MPa (470-630)',
    '- Elongation A 27 % (min. 22)',
    '- Impact KV at -20 C: 148 / 156 / 139 J (min. 27)',
    '# Inspection',
    '- Ultrasonic testing EN 10160 S1E1: passed',
    '- Surface and dimensions EN 10029 class B: passed',
    '',
    'We hereby certify that the products comply with the order and the standards named above.',
    '',
    '> Sample document. All data are illustrative and fictional.',
  ], 'MILL TEST CERTIFICATE', t('Сертификат 3.1 по EN 10204 (образец)', 'EN 10204 3.1 certificate (sample)', 'Abnahmeprüfzeugnis 3.1 nach EN 10204 (Muster)'),
  t('Что приходит вместе с каждой плавкой', 'What comes with every heat', 'Was jede Schmelze begleitet'));
  const iso = pdf('kramor-management-certificates.pdf', 'KRAMOR - Management system certificates', [
    '# Certificates in force (sample)',
    '- ISO 9001:2015 quality management - certificate KR-QMS-0417, valid until 2028-03',
    '- ISO 14001:2015 environmental management - KR-EMS-0212, valid until 2027-11',
    '- ISO 45001:2018 occupational health and safety - KR-OHS-0108, valid until 2028-01',
    '- ISO 50001:2018 energy management - KR-EnMS-0031, valid until 2027-06',
    '# Product approvals',
    '- CE marking of structural steels to EN 10025 (factory production control)',
    '- Pipe line pipe approvals to EN ISO 3183 / API 5L PSL2',
    '- Ship and offshore steels approved by two marine classification societies',
    '',
    '> Sample document generated by the landing template. All names and numbers are fictional.',
  ], 'CERTIFICATES', t('Сертификаты систем менеджмента', 'Management system certificates', 'Managementsystem-Zertifikate'),
  t('ISO 9001, 14001, 45001, 50001 и допуски продукции', 'ISO 9001, 14001, 45001, 50001 and product approvals', 'ISO 9001, 14001, 45001, 50001 und Produktzulassungen'));
  const esgReport = pdf('kramor-sustainability-2025.pdf', 'KRAMOR - Sustainability report 2025 (summary)', [
    '# Climate',
    '- 0.62 t CO2e per tonne of crude steel (scope 1+2), -38 % versus 2015',
    '- 92 % recycled scrap in the furnace charge',
    '- 64 % of electricity from own gas-fired CHP and contracted wind power',
    '# Water and air',
    '- Closed water loop: 100 % of process water recycled',
    '- Dust emissions 4.1 g per tonne of steel after the new bag filter (2024)',
    '# People',
    '- Lost time injury frequency 0.38 per million hours',
    '- 1,850 employees, 214 apprentices in the works school',
    '',
    '> Sample document generated by the landing template. All figures are fictional.',
  ], 'SUSTAINABILITY', t('Отчёт об устойчивом развитии 2025', 'Sustainability report 2025', 'Nachhaltigkeitsbericht 2025'),
  t('Выбросы, вода, энергия и безопасность', 'Emissions, water, energy and safety', 'Emissionen, Wasser, Energie und Sicherheit'));

  // ----- requests (browser-local endpoints; mailto is the human fallback) -----
  const reqRfq = K.id();
  const reqInbox = K.id();
  const R = (id, name, url) => ({ id, name, method: 'POST', url, headers: [], credentials: 'omit', timeout: 8000, retries: 0, itemsPath: 'items' });

  const d = K.doc({
    name: 'KRAMOR — steel works', preset: 'forge', defaultLang: 'ru',
    author: 'KRAMOR', keywords: 'steel, hot-rolled coil, heavy plate, beams, rebar, pipes, castings, alloy steel, EN 10204, RFQ',
    title: t('КРАМОР — сталь, прокат, трубы и литьё', 'KRAMOR — steel, rolled products, pipes and castings', 'KRAMOR — Stahl, Walzprodukte, Rohre und Guss'),
    description: t(
      'Металлургический комбинат КРАМОР: рулон и лист, балка и арматура, трубы, литьё и слитки из собственной стали. Марки по ГОСТ, EN и ASTM, сертификат 3.1 на каждую плавку. Запросите предложение онлайн.',
      'KRAMOR steel works: coil and plate, beams and rebar, pipes, castings and ingots from our own melt. GOST, EN and ASTM grades, a 3.1 certificate with every heat. Request a quotation online.',
      'Stahlwerk KRAMOR: Coil und Blech, Träger und Betonstahl, Rohre, Guss und Blöcke aus eigener Schmelze. Güten nach GOST, EN und ASTM, 3.1-Zeugnis zu jeder Schmelze. Fordern Sie online ein Angebot an.'),
    meta: { favicon: brand },
    theme: { scheme: 'auto' },
    output: { autodetect: true, switcher: 'buttons', langLabels: 'code', themeToggle: true, toolbarPos: 'nav', motion: 'rise', backToTop: true },
    shop: {
      currency: 'RUB', mode: 'quote', cartButton: 'auto', sync: 'local', ttlDays: 60,
      checkout: {
        method: 'request', req: reqRfq, fallback: 'mailto', email: 'rfq@kramor.example', phone: '+7 000 000-68-00', minTotal: 0,
        note: L(t('Цены зависят от марки, размеров, объёма и базиса поставки — менеджер пришлёт предложение в течение одного рабочего дня.',
          'Prices depend on grade, sizes, volume and delivery terms — a sales manager will send you an offer within one working day.',
          'Die Preise hängen von Güte, Abmessungen, Menge und Lieferbedingung ab – ein Vertriebsmitarbeiter sendet Ihnen binnen eines Arbeitstages ein Angebot.')),
        success: L(t('Спасибо! Запрос зарегистрирован, менеджер свяжется с вами в течение рабочего дня.',
          'Thank you! Your request has been registered; a sales manager will contact you within one working day.',
          'Vielen Dank! Ihre Anfrage ist eingegangen; ein Vertriebsmitarbeiter meldet sich innerhalb eines Arbeitstages.')),
        fields: [
          field('company', 'text', t('Компания', 'Company', 'Firma'), t('ООО «Ваш проект»', 'Your Company Ltd', 'Ihre Firma GmbH'), { required: true, half: true }),
          field('name', 'text', t('Контактное лицо', 'Contact person', 'Ansprechpartner'), '', { required: true, half: true }),
          field('email', 'email', t('E-mail', 'E-mail', 'E-Mail'), 'name@company.example', { required: true, half: true }),
          field('phone', 'tel', t('Телефон', 'Phone', 'Telefon'), '+7 000 000-00-00', { half: true }),
          field('standard', 'select', t('Требуемый стандарт', 'Required standard', 'Gefordertes Regelwerk'), '', {
            half: true, options: t('ГОСТ / ТУ\nEN\nASTM / API\nПо согласованию', 'GOST / TU\nEN\nASTM / API\nTo be agreed', 'GOST / TU\nEN\nASTM / API\nNach Absprache'),
          }),
          field('incoterms', 'select', t('Условия поставки', 'Delivery terms', 'Lieferbedingungen'), '', {
            half: true,
            options: t('FCA станция Ферровск\nCPT до станции назначения\nFOB морской терминал\nDAP до объекта', 'FCA Ferrovsk station\nCPT to destination station\nFOB sea terminal\nDAP to site', 'FCA Bahnhof Ferrowsk\nCPT bis Zielbahnhof\nFOB Seeterminal\nDAP bis Baustelle'),
          }),
          field('certificate', 'select', t('Документ о качестве', 'Inspection document', 'Prüfbescheinigung'), '', {
            half: true, options: t('3.1 по EN 10204\n3.2 по EN 10204\nСертификат по ГОСТ', '3.1 to EN 10204\n3.2 to EN 10204\nGOST certificate', '3.1 nach EN 10204\n3.2 nach EN 10204\nGOST-Zertifikat'),
          }),
          field('date', 'date', t('Желаемая дата отгрузки', 'Required shipping date', 'Gewünschter Versandtermin'), '', { half: true }),
          field('comment', 'textarea', t('Спецификация и комментарий', 'Specification and notes', 'Spezifikation und Anmerkungen'),
            t('Марка, размеры, допуски, объём, график поставок…', 'Grade, sizes, tolerances, volume, delivery schedule…', 'Güte, Abmessungen, Toleranzen, Menge, Lieferplan…')),
        ],
      },
    },
    requests: [R(reqRfq, 'Request for quotation (browser storage)', 'local:rfq'), R(reqInbox, 'Contact form (browser storage)', 'local:inbox')],
  });

  // ----- header -----
  d.regions.header = [
    B('nav', {
      brand: L(t('КРАМОР', 'KRAMOR', 'KRAMOR')), logo: brand, logoH: 38, sticky: true, variant: 'bar', tone: 'dark',
      items: [
        K.item({ label: L(t('Продукция', 'Products', 'Produkte')), href: '#products' }),
        K.item({ label: L(t('Марки', 'Grades', 'Güten')), href: '#grades' }),
        K.item({ label: L(t('Производство', 'Production', 'Produktion')), href: '#process' }),
        K.item({ label: L(t('Логистика', 'Logistics', 'Logistik')), href: '#logistics' }),
        K.item({ label: L(t('Контакты', 'Contact', 'Kontakt')), href: '#contact' }),
      ],
      ctaLabel: L(t('Запросить КП', 'Get a quote', 'Angebot anfordern')), ctaHref: '#rfq',
    }),
  ];

  // ----- catalogue -----
  const unitT = t('т', 't', 't');
  const products = [
    ['coils', 'KR-HRC', t('Рулон горячекатаный', 'Hot-rolled coil', 'Warmband im Coil'), null, 'in', t('Широкополосный стан 1700', '1700 hot strip mill', 'Warmbreitbandstraße 1700'),
      p('Для гибки, профилирования и производства труб. Травлёный и промасленный рулон — по запросу.', 'For bending, roll forming and pipe making. Pickled and oiled coil on request.', 'Zum Biegen, Profilieren und für die Rohrfertigung. Gebeizt und geölt auf Anfrage.'),
      t('Толщина: 1,5–16 мм\nШирина: 900–1850 мм\nМасса рулона: до 28 т\nМарки: Ст3сп, 09Г2С, S235–S355', 'Thickness: 1.5–16 mm\nWidth: 900–1850 mm\nCoil weight: up to 28 t\nGrades: S235–S355, St3sp, 09G2S', 'Dicke: 1,5–16 mm\nBreite: 900–1850 mm\nCoilgewicht: bis 28 t\nGüten: S235–S355, St3sp, 09G2S'), 20],
    ['plate', 'KR-PLATE', t('Толстолистовой прокат', 'Heavy plate', 'Grobblech'), null, 'in', t('Нормализация и TMCP', 'Normalised or TMCP', 'Normalisiert oder TM'),
      p('Мосты, краны, сосуды под давлением и судостроение; УЗК каждого листа.', 'Bridges, cranes, pressure vessels and shipbuilding; every plate ultrasonically tested.', 'Brücken, Krane, Druckbehälter und Schiffbau; jedes Blech ultraschallgeprüft.'),
      t('Толщина: 6–120 мм\nШирина: 1500–2800 мм\nДлина: 6–12 м\nМарки: S355J2, 09Г2С, A572 Gr.50', 'Thickness: 6–120 mm\nWidth: 1500–2800 mm\nLength: 6–12 m\nGrades: S355J2, 09G2S, A572 Gr.50', 'Dicke: 6–120 mm\nBreite: 1500–2800 mm\nLänge: 6–12 m\nGüten: S355J2, 09G2S, A572 Gr.50'), 5],
    ['beams', 'KR-BEAM', t('Балка двутавровая', 'H and I beams', 'Doppel-T-Träger'), null, 'pre', '',
      p('Горячекатаные балки нормального и широкополочного сортамента для каркасов и мостов.', 'Hot-rolled standard and wide-flange beams for frames and bridges.', 'Warmgewalzte Normal- und Breitflanschträger für Tragwerke und Brücken.'),
      t('Сортамент: 10Б1–60Б1, HEA/HEB 100–600\nДлина: 6–24 м\nМарки: С255–С345, S355JR', 'Sizes: 10B1–60B1, HEA/HEB 100–600\nLength: 6–24 m\nGrades: S235–S355JR', 'Profile: 10B1–60B1, HEA/HEB 100–600\nLänge: 6–24 m\nGüten: S235–S355JR'), 2],
    ['rebar', 'KR-REBAR', t('Арматура A500C', 'Rebar A500C / B500C', 'Betonstahl B500C'), null, 'in', t('Склад: 24 000 т', 'Stock: 24,000 t', 'Lager: 24.000 t'),
      p('Свариваемая арматура периодического профиля в прутках и бунтах.', 'Weldable ribbed bars, straight lengths or coils.', 'Schweißbarer gerippter Betonstahl, Stäbe oder Ringe.'),
      t('Диаметр: 8–40 мм\nДлина: 11,7 м или бунты\nКласс: A500C, B500C\nПакет: 3–5 т', 'Diameter: 8–40 mm\nLength: 11.7 m or coils\nClass: A500C, B500C\nBundle: 3–5 t', 'Durchmesser: 8–40 mm\nLänge: 11,7 m oder Ringe\nKlasse: A500C, B500C\nBund: 3–5 t'), 5],
    ['pipes', 'KR-PIPE', t('Трубы стальные', 'Steel pipes', 'Stahlrohre'), null, 'pre', '',
      p('Прямошовные трубы большого диаметра и бесшовные трубы для трубопроводов и конструкций.', 'Large-diameter longitudinally welded pipes and seamless pipes for pipelines and structures.', 'Längsnahtgeschweißte Großrohre und nahtlose Rohre für Leitungen und Konstruktionen.'),
      t('Сварные: Ø 530–1420 мм\nБесшовные: Ø 57–426 мм\nКлассы: К52–К60, X52–X70\nИзоляция: 3LPE', 'Welded: Ø 530–1420 mm\nSeamless: Ø 57–426 mm\nGrades: K52–K60, X52–X70\nCoating: 3LPE', 'Geschweißt: Ø 530–1420 mm\nNahtlos: Ø 57–426 mm\nGüten: K52–K60, X52–X70\nUmhüllung: 3LPE'), 10],
    ['castings', 'KR-CAST', t('Литьё и слитки', 'Castings and ingots', 'Guss und Blöcke'), null, 'in', t('До 60 т', 'Up to 60 t', 'Bis 60 t'),
      p('Отливки по чертежам заказчика и слитки для свободной ковки из углеродистых и легированных марок.', 'Castings to customer drawings and forging ingots in carbon and alloy grades.', 'Gussteile nach Kundenzeichnung und Schmiedeblöcke aus unlegierten und legierten Güten.'),
      t('Отливки: 50 кг – 60 т\nСлитки: 3–28 т\nМарки: 20–35Л, 35ХМЛ, 110Г13Л', 'Castings: 50 kg – 60 t\nIngots: 3–28 t\nGrades: carbon, CrMo, Mn13', 'Guss: 50 kg – 60 t\nBlöcke: 3–28 t\nGüten: C-Stahl, CrMo, Mn13'), 1],
  ].map(([k, sku, name, price, stock, badge, html, specs, min]) => K.item({
    sku, name: L(name), html: L(html), price, old: null, unit: L(unitT), image: shot[k], badge: L(badge || ''), specs: L(specs), min, step: 1, stock,
  }));

  const stock = [
    ['plate', 'KR-S-P10', t('Лист 10 × 2000 × 6000, S355J2', 'Plate 10 × 2000 × 6000, S355J2', 'Blech 10 × 2000 × 6000, S355J2'), t('ГОСТ 19903 / EN 10025-2', 'EN 10025-2', 'EN 10025-2'), 89400, 5, 'in'],
    ['plate', 'KR-S-P20', t('Лист 20 × 2500 × 12000, 09Г2С', 'Plate 20 × 2500 × 12000, 09G2S', 'Blech 20 × 2500 × 12000, 09G2S'), t('ГОСТ 19281', 'GOST 19281', 'GOST 19281'), 92800, 5, 'in'],
    ['coils', 'KR-S-C4', t('Рулон 4 × 1500, Ст3сп', 'Coil 4 × 1500, St3sp', 'Coil 4 × 1500, St3sp'), t('ГОСТ 16523', 'GOST 16523', 'GOST 16523'), 71900, 20, 'in'],
    ['beams', 'KR-S-B30', t('Балка 30Б1, С255', 'Beam 30B1, S235JR', 'Träger 30B1, S235JR'), t('СТО АСЧМ 20-93', 'GOST 57837', 'GOST 57837'), 98500, 2, 'low'],
    ['rebar', 'KR-S-R12', t('Арматура Ø 12 A500C, 11,7 м', 'Rebar Ø 12 A500C, 11.7 m', 'Betonstahl Ø 12 A500C, 11,7 m'), t('ГОСТ 34028', 'GOST 34028', 'GOST 34028'), 64300, 5, 'in'],
    ['rounds', 'KR-S-K100', t('Круг Ø 100, 40Х', 'Round Ø 100, 40Kh (41Cr4)', 'Rundstahl Ø 100, 40Ch (41Cr4)'), t('ГОСТ 4543', 'GOST 4543 / EN 10083-3', 'GOST 4543 / EN 10083-3'), 118000, 1, 'in'],
    ['pipes', 'KR-S-T530', t('Труба 530 × 8, К52', 'Pipe 530 × 8, K52 (X52)', 'Rohr 530 × 8, K52 (X52)'), t('ГОСТ 20295', 'GOST 20295 / API 5L', 'GOST 20295 / API 5L'), null, 10, 'pre'],
  ].map(([k, sku, name, specs, price, min, st]) => K.item({
    sku, name: L(name), html: L(''), price, old: null, unit: L(unitT), image: shot[k], badge: L(''), specs: L(t('Стандарт: ' + specs.ru, 'Standard: ' + specs.en, 'Norm: ' + specs.de)), min, step: 1, stock: st,
  }));

  // ----- grades & standards tables -----
  const gradeRows = [
    [t('Ст3сп', 'St3sp', 'St3sp'), 'S235JR', 'A36', t('Строительные конструкции, сварные каркасы', 'Structures, welded frames', 'Stahlbau, geschweißte Tragwerke')],
    [t('09Г2С', '09G2S', '09G2S'), 'S355J2', 'A572 Gr. 50', t('Мосты, краны, сосуды при низких температурах', 'Bridges, cranes, low-temperature vessels', 'Brücken, Krane, Behälter für tiefe Temperaturen')],
    [t('40Х', '40Kh', '40Ch'), '41Cr4 (1.7035)', 'AISI 5140', t('Валы, оси, шестерни после закалки', 'Shafts, axles, gears (hardened)', 'Wellen, Achsen, Zahnräder (vergütet)')],
    [t('12Х18Н10Т', '12Kh18N10T', '12Ch18N10T'), 'X6CrNiTi18-10 (1.4541)', 'AISI 321', t('Химическое и пищевое оборудование', 'Chemical and food equipment', 'Chemie- und Lebensmittelanlagen')],
    [t('110Г13Л', '110G13L', '110G13L'), 'GX120Mn13 (1.3802)', 'A128 Gr. A', t('Износостойкое литьё', 'Wear-resistant castings', 'Verschleißfester Guss')],
    [t('К52', 'K52', 'K52'), 'L360 (EN ISO 3183)', 'API 5L X52', t('Магистральные трубопроводы', 'Transmission pipelines', 'Fernleitungen')],
  ];
  const gradesTable = K.table([
    [th(t('Марка (ГОСТ)', 'Grade (GOST)', 'Güte (GOST)')), th('EN'), th('ASTM / AISI / API'), th(t('Применение', 'Typical use', 'Einsatz'))],
    ...gradeRows.map(([g, en, astm, use]) => [cell(t('<strong>' + g.ru + '</strong>', '<strong>' + g.en + '</strong>', '<strong>' + g.de + '</strong>')), cell(en), cell(astm), cell(use)]),
  ], [18, 26, 20, 36], {
    header: 'row', variant: 'minimal', compact: false, width: 100,
    caption: L(t('Соответствие марок приблизительное; химический состав и свойства подтверждаются сертификатом на плавку.', 'Equivalents are approximate; chemistry and properties are confirmed by the heat certificate.', 'Die Entsprechungen sind Näherungen; Chemie und Eigenschaften bestätigt das Schmelzzeugnis.')),
  });
  const propsTable = K.table([
    [th(t('Свойство', 'Property', 'Eigenschaft')), th(t('Требование EN 10025-2', 'EN 10025-2 requirement', 'Anforderung EN 10025-2'), { align: 'right' }), th(t('Наш прокат', 'Our mill', 'Unser Werk'), { align: 'right' })],
    [cell(t('Предел текучести ReH, МПа', 'Yield strength ReH, MPa', 'Streckgrenze ReH, MPa')), cell('≥ 355', { align: 'right' }), cell('<strong>385–420</strong>', { align: 'right' })],
    [cell(t('Временное сопротивление Rm, МПа', 'Tensile strength Rm, MPa', 'Zugfestigkeit Rm, MPa')), cell('470–630', { align: 'right' }), cell('<strong>520–560</strong>', { align: 'right' })],
    [cell(t('Относительное удлинение A, %', 'Elongation A, %', 'Bruchdehnung A, %')), cell('≥ 22', { align: 'right' }), cell('<strong>26–30</strong>', { align: 'right' })],
    [cell(t('Ударная вязкость KV при −20 °C, Дж', 'Impact energy KV at −20 °C, J', 'Kerbschlagarbeit KV bei −20 °C, J')), cell('≥ 27', { align: 'right' }), cell('<strong>90–160</strong>', { align: 'right' })],
    [cell(t('Углеродный эквивалент CEV', 'Carbon equivalent CEV', 'Kohlenstoffäquivalent CEV')), cell(t('≤ 0,47', '≤ 0.47', '≤ 0,47'), { align: 'right' }), cell(t('<strong>0,40–0,43</strong>', '<strong>0.40–0.43</strong>', '<strong>0,40–0,43</strong>'), { align: 'right' })],
  ], [52, 24, 24], { header: 'row', variant: 'striped', compact: false, width: 100 });
  const capTable = K.table([
    [th(t('Агрегат', 'Unit', 'Anlage')), th(t('Мощность в год', 'Capacity per year', 'Jahreskapazität'), { align: 'right' }), th(t('Продукция', 'Products', 'Produkte'))],
    ...[
      [t('Дуговая сталеплавильная печь 150 т', '150 t electric arc furnace', '150-t-Elektrolichtbogenofen'), t('2,4 млн т', '2.4 Mt', '2,4 Mio. t'), t('Жидкая сталь, 180+ марок', 'Liquid steel, 180+ grades', 'Flüssigstahl, 180+ Güten')],
      [t('Ковш-печь и вакууматор', 'Ladle furnace and vacuum degasser', 'Pfannenofen und Vakuumanlage'), t('2,4 млн т', '2.4 Mt', '2,4 Mio. t'), t('Доводка, низкий водород', 'Refining, low hydrogen', 'Feinbehandlung, niedriger Wasserstoff')],
      [t('МНЛЗ слябовая и сортовая', 'Slab and billet casters', 'Brammen- und Knüppelanlage'), t('2,3 млн т', '2.3 Mt', '2,3 Mio. t'), t('Сляб 250 мм, заготовка 150 мм', 'Slab 250 mm, billet 150 mm', 'Bramme 250 mm, Knüppel 150 mm')],
      [t('Толстолистовой стан 2800', '2800 plate mill', 'Grobblechstraße 2800'), t('0,9 млн т', '0.9 Mt', '0,9 Mio. t'), t('Лист 6–120 мм', 'Plate 6–120 mm', 'Blech 6–120 mm')],
      [t('Широкополосный стан 1700', '1700 hot strip mill', 'Warmbreitbandstraße 1700'), t('1,1 млн т', '1.1 Mt', '1,1 Mio. t'), t('Рулон 1,5–16 мм', 'Coil 1.5–16 mm', 'Coil 1,5–16 mm')],
      [t('Сортовой стан 350', '350 bar and section mill', 'Stab- und Profilstraße 350'), t('0,6 млн т', '0.6 Mt', '0,6 Mio. t'), t('Арматура, круг, балка, уголок', 'Rebar, rounds, beams, angles', 'Betonstahl, Rundstahl, Träger, Winkel')],
      [t('Трубоэлектросварочный цех', 'Welded pipe mill', 'Rohrschweißwerk'), t('0,45 млн т', '0.45 Mt', '0,45 Mio. t'), t('Трубы Ø 530–1420 мм', 'Pipes Ø 530–1420 mm', 'Rohre Ø 530–1420 mm')],
      [t('Литейный цех', 'Foundry', 'Gießerei'), t('40 тыс. т', '40 kt', '40 Tsd. t'), t('Отливки до 60 т, слитки', 'Castings up to 60 t, ingots', 'Guss bis 60 t, Blöcke')],
    ].map(([u, c, pr]) => [cell(u), cell(c, { align: 'right' }), cell(pr)]),
  ], [40, 20, 40], { header: 'row', variant: 'lines', compact: true, width: 100 });

  d.regions.main = [
    B('hero', {
      layout: 'split', media: hero, height: 'auto', tone: 'dark',
      badge: L(t('Сертификат 3.1 по EN 10204 на каждую плавку', 'EN 10204 3.1 certificate with every heat', 'Abnahmeprüfzeugnis 3.1 zu jeder Schmelze')),
      eyebrow: L(t('Металлургический комбинат полного цикла · с 1968 года', 'Integrated steel works · since 1968', 'Integriertes Stahlwerk · seit 1968')),
      title: L(t('Прокат, трубы и литьё из собственной стали', 'Rolled steel, pipes and castings from our own melt', 'Walzstahl, Rohre und Guss aus eigener Schmelze')),
      text: L(p('Выплавляем 2,4 млн тонн стали в год и доводим её до готовой продукции на одной площадке: рулон и лист, балка и арматура, трубы, отливки и слитки — по ГОСТ, EN и ASTM.',
        'We melt 2.4 million tonnes of steel a year and take it to finished products on one site: coil and plate, beams and rebar, pipes, castings and ingots — to GOST, EN and ASTM.',
        'Wir erschmelzen 2,4 Mio. Tonnen Stahl pro Jahr und verarbeiten ihn an einem Standort zu Fertigprodukten: Coil und Blech, Träger und Betonstahl, Rohre, Guss und Blöcke – nach GOST, EN und ASTM.')),
      items: [
        K.btn(t('Продукция и склад', 'Products and stock', 'Produkte und Lager'), '#products', 'primary', K.icon('arrowRight')),
        K.btn(t('Марки и стандарты', 'Grades and standards', 'Güten und Normen'), '#grades', 'secondary'),
      ],
    }),
    K.sec({ pad: 's', style: { mt: -84 } }, [
      B('stats', {
        variant: 'band', columns: 5, items: [
          K.item({ value: '2,4', suffix: L(t('млн т', 'Mt', 'Mio. t')), label: L(t('стали в год', 'of steel a year', 'Stahl pro Jahr')) }),
          K.item({ value: '180+', suffix: L(''), label: L(t('марок стали и сплавов', 'steel and alloy grades', 'Stahl- und Legierungsgüten')) }),
          K.item({ value: '6–120', suffix: L(t('мм', 'mm', 'mm')), label: L(t('толщина листа', 'plate thickness', 'Blechdicke')) }),
          K.item({ value: '1420', suffix: L(t('мм', 'mm', 'mm')), label: L(t('максимальный диаметр трубы', 'maximum pipe diameter', 'maximaler Rohrdurchmesser')) }),
          K.item({ value: '37', suffix: L(t('стран', 'countries', 'Länder')), label: L(t('получают нашу сталь', 'receive our steel', 'beziehen unseren Stahl')) }),
        ],
      }),
    ]),
    K.sec({
      anchor: 'products', pad: 'm',
      eyebrow: t('01 — Продукция', '01 — Products', '01 — Produkte'),
      title: t('Плоский и сортовой прокат, трубы, литьё', 'Flat and long products, pipes, castings', 'Flach- und Langprodukte, Rohre, Guss'),
      lead: p('Добавьте позиции в запрос — менеджер подтвердит наличие, марку, допуски и цену в течение одного рабочего дня.',
        'Add items to your request — a sales manager confirms availability, grade, tolerances and price within one working day.',
        'Legen Sie Positionen in Ihre Anfrage – der Vertrieb bestätigt Verfügbarkeit, Güte, Toleranzen und Preis binnen eines Arbeitstages.'),
    }, [
      B('products', { variant: 'cards', columns: 3, ratio: '1/1', qty: false, items: products }),
      B('spacer', { h: 36 }),
      K.head(t('Складская программа', 'Stock programme', 'Lagerprogramm'), 3,
        { eyebrow: L(t('Отгрузка со склада за 48 часов · цены за тонну без НДС', 'Dispatch from stock within 48 hours · prices per tonne excl. VAT', 'Versand ab Lager binnen 48 Stunden · Preise je Tonne ohne MwSt.')) }),
      B('products', { variant: 'table', columns: 3, qty: false, items: stock }),
    ]),
    K.sec({
      anchor: 'grades', tone: 'muted', pad: 'm',
      eyebrow: t('02 — Марки и стандарты', '02 — Grades and standards', '02 — Güten und Normen'),
      title: t('Говорим на языке ваших стандартов', 'We speak your standard', 'Wir sprechen Ihre Norm'),
      lead: p('Поставляем по ГОСТ, EN, ASTM и API; ниже — самые востребованные марки и типичные свойства листа S355J2.',
        'We supply to GOST, EN, ASTM and API; below are our most requested grades and typical properties of S355J2 plate.',
        'Wir liefern nach GOST, EN, ASTM und API; unten die gefragtesten Güten und typische Eigenschaften von Blech S355J2.'),
    }, [
      gradesTable,
      B('spacer', { h: 16 }),
      B('columns', {
        gap: 40, valign: 'top', cols: [
          col(56, [K.head(t('Лист S355J2+N: механические свойства', 'S355J2+N plate: mechanical properties', 'Blech S355J2+N: mechanische Eigenschaften'), 4), propsTable]),
          col(44, [
            K.head(t('Стандарты и допуски', 'Standards and approvals', 'Normen und Zulassungen'), 4),
            B('features', {
              variant: 'list', columns: 2, items: [
                K.item({ icon: '', title: L('EN 10025 · EN 10083'), html: L(p('Конструкционные и улучшаемые стали', 'Structural and quenched & tempered steels', 'Bau- und Vergütungsstähle')) }),
                K.item({ icon: '', title: L('ASTM A36 · A572'), html: L(p('Американский сортамент', 'US specifications', 'US-Spezifikationen')) }),
                K.item({ icon: '', title: L('API 5L · EN ISO 3183'), html: L(p('Трубы для трубопроводов', 'Line pipe', 'Leitungsrohre')) }),
                K.item({ icon: '', title: L('EN 10204 3.1 / 3.2'), html: L(p('Документы о приёмочном контроле', 'Inspection documents', 'Prüfbescheinigungen')) }),
              ],
            }),
          ]),
        ],
      }),
    ]),
    K.sec({
      anchor: 'process', tone: 'dark', pad: 'l',
      eyebrow: t('03 — Производство', '03 — Production', '03 — Produktion'),
      title: t('От лома до сертификата — на одной площадке', 'From scrap to certificate — on one site', 'Vom Schrott zum Zeugnis – an einem Standort'),
      lead: p('Электросталеплавильный цикл: 92 % лома в шихте, вакуумирование, непрерывная разливка и прокатка без промежуточных складов.',
        'Electric steelmaking route: 92 % scrap in the charge, vacuum degassing, continuous casting and rolling without intermediate storage.',
        'Elektrostahlroute: 92 % Schrott im Einsatz, Vakuumbehandlung, Strangguss und Walzen ohne Zwischenlager.'),
    }, [
      B('steps', {
        variant: 'line', items: [
          K.item({ icon: K.icon('flame'), title: L(t('Выплавка', 'Melting', 'Schmelzen')), html: L(p('Дуговая печь 150 т: лом, ферросплавы, 52 минуты от завалки до выпуска.', '150 t arc furnace: scrap and ferroalloys, 52 minutes tap-to-tap.', '150-t-Lichtbogenofen: Schrott und Ferrolegierungen, 52 Minuten Abstich zu Abstich.')) }),
          K.item({ icon: K.icon('drop'), title: L(t('Доводка', 'Refining', 'Feinbehandlung')), html: L(p('Ковш-печь и вакууматор: точная химия, водород ниже 2 ppm.', 'Ladle furnace and degasser: precise chemistry, hydrogen below 2 ppm.', 'Pfannenofen und Vakuum: exakte Analyse, Wasserstoff unter 2 ppm.')) }),
          K.item({ icon: K.icon('bars'), title: L(t('Разливка', 'Casting', 'Gießen')), html: L(p('Слябы 250 мм и заготовка 150 мм на машинах непрерывного литья.', '250 mm slabs and 150 mm billets on continuous casters.', '250-mm-Brammen und 150-mm-Knüppel aus Stranggießanlagen.')) }),
          K.item({ icon: K.icon('layout'), title: L(t('Прокатка', 'Rolling', 'Walzen')), html: L(p('Лист, рулон, сорт и трубы; нормализация и закалка в линии.', 'Plate, coil, sections and pipes; in-line normalising and quenching.', 'Blech, Coil, Profile und Rohre; Normalisieren und Härten in Linie.')) }),
          K.item({ icon: K.icon('check'), title: L(t('Контроль', 'Testing', 'Prüfung')), html: L(p('Лаборатория, УЗК, испытания образцов и сертификат 3.1 на плавку.', 'Laboratory, ultrasonic testing, specimen tests and a 3.1 certificate per heat.', 'Labor, Ultraschall, Probenprüfung und 3.1-Zeugnis je Schmelze.')) }),
        ],
      }),
      B('spacer', { h: 28 }),
      B('gallery', {
        variant: 'mosaic', columns: 3, gap: 14, zoom: true, items: [
          K.item({ att: scenes.furnace, caption: L(t('Электросталеплавильный цех · ДСП-150', 'Melt shop · 150 t EAF', 'Stahlwerk · 150-t-EAF')) }),
          K.item({ att: scenes.ladle, caption: L(t('Ковш 150 т перед вакууматором', '150 t ladle before degassing', '150-t-Pfanne vor der Vakuumbehandlung')) }),
          K.item({ att: scenes.caster, caption: L(t('Машина непрерывного литья заготовок', 'Continuous caster', 'Stranggießanlage')) }),
          K.item({ att: scenes.stand, caption: L(t('Клеть толстолистового стана 2800', '2800 plate mill stand', 'Gerüst der Grobblechstraße 2800')) }),
          K.item({ att: scenes.yard, caption: L(t('Склад рулонов · 60 000 т', 'Coil yard · 60,000 t', 'Coillager · 60.000 t')) }),
          K.item({ att: scenes.lab, caption: L(t('Центральная лаборатория', 'Central laboratory', 'Zentrallabor')) }),
        ],
      }),
      B('spacer', { h: 28 }),
      K.head(t('Производственные мощности', 'Production capacities', 'Produktionskapazitäten'), 3),
      capTable,
    ]),
    K.sec({
      anchor: 'quality', pad: 'm',
      eyebrow: t('04 — Качество', '04 — Quality', '04 — Qualität'),
      title: t('Каждая плавка — с паспортом', 'Every heat comes with a passport', 'Jede Schmelze mit Pass'),
      lead: p('Аккредитованная лаборатория проверяет химию, механику и сплошность; результаты попадают в сертификат 3.1, который вы получаете вместе с металлом.',
        'Our accredited laboratory checks chemistry, mechanical properties and soundness; results go into the 3.1 certificate that ships with the metal.',
        'Unser akkreditiertes Labor prüft Chemie, Mechanik und Innenbeschaffenheit; die Ergebnisse stehen im 3.1-Zeugnis, das mit dem Material kommt.'),
    }, [
      B('features', {
        variant: 'cards', columns: 4, items: [
          K.item({ icon: K.icon('target'), title: L(t('Спектральный анализ', 'Spectral analysis', 'Spektralanalyse')), html: L(p('Химия каждой плавки — за 3 минуты.', 'Chemistry of every heat in 3 minutes.', 'Analyse jeder Schmelze in 3 Minuten.')) }),
          K.item({ icon: K.icon('bolt'), title: L(t('УЗК 100 %', '100 % ultrasonic testing', '100 % Ultraschall')), html: L(p('Каждый лист по EN 10160, класс до S3E4.', 'Every plate to EN 10160, up to class S3E4.', 'Jedes Blech nach EN 10160, bis Klasse S3E4.')) }),
          K.item({ icon: K.icon('chart'), title: L(t('Механические испытания', 'Mechanical tests', 'Mechanische Prüfung')), html: L(p('Растяжение, удар до −60 °C, Z-свойства.', 'Tensile, impact down to −60 °C, Z-properties.', 'Zug, Kerbschlag bis −60 °C, Z-Güte.')) }),
          K.item({ icon: K.icon('award'), title: L(t('Сертификаты', 'Certificates', 'Zeugnisse')), html: L(p('3.1 на плавку, 3.2 — с инспекцией заказчика.', '3.1 per heat, 3.2 with your inspector.', '3.1 je Schmelze, 3.2 mit Ihrem Inspektor.')) }),
        ],
      }),
      B('spacer', { h: 12 }),
      B('columns', {
        gap: 24, valign: 'top', cols: [
          col(36, [
            B('embed', { att: mtc, display: 'card', player: 'object', height: 520, ratio: 'auto', caption: L(''), dl: true, op: true }),
            B('embed', { att: iso, display: 'card', player: 'object', height: 520, ratio: 'auto', caption: L(''), dl: true, op: true }),
            B('quote', {
              variant: 'callout', tone: 'accent', icon: K.icon('info'), author: L(''),
              html: L(p('Документы — на русском, английском и немецком; электронные сертификаты доступны по номеру плавки.', 'Documents in Russian, English and German; electronic certificates are available by heat number.', 'Dokumente auf Russisch, Englisch und Deutsch; elektronische Zeugnisse über die Schmelzennummer.')),
            }),
          ]),
          col(64, [B('embed', { att: catalogue, display: 'embed', player: 'object', height: 600, ratio: 'auto', caption: L(''), dl: true, op: true })]),
        ],
      }),
    ]),
    K.sec({
      anchor: 'logistics', tone: 'muted', pad: 'm',
      eyebrow: t('05 — Логистика', '05 — Logistics', '05 — Logistik'),
      title: t('Отгружаем вагонами, судами и автотранспортом', 'Shipped by rail, sea and road', 'Versand per Bahn, Schiff und Lkw'),
    }, [
      B('features', {
        variant: 'split', columns: 2, items: [
          K.item({ icon: K.icon('truck'), image: map,
            title: L(t('Своя станция и морской терминал', 'Our own station and sea terminal', 'Eigener Bahnhof und Seeterminal')),
            html: L(t(
              '<p>Комбинат примыкает к магистрали: 14 путей станции, 600 вагонов в сутки. Экспорт идёт через терминал в 120 км с причалом на 40 тысяч тонн.</p><ul><li>Упаковка от коррозии и маркировка по требованию</li><li>Отгрузка от 1 вагона или 1 автомобиля</li><li>FCA, CPT, FOB и DAP; страхование груза</li></ul>',
              '<p>The works sit on the main line: a 14-track station handling 600 wagons a day. Export cargo goes through a terminal 120 km away with a 40,000 t berth.</p><ul><li>Corrosion protection and marking to your requirements</li><li>From a single wagon or truck</li><li>FCA, CPT, FOB and DAP; cargo insurance</li></ul>',
              '<p>Das Werk liegt an der Hauptstrecke: Bahnhof mit 14 Gleisen und 600 Wagen pro Tag. Exportware geht über ein Terminal in 120 km Entfernung mit einem 40.000-t-Liegeplatz.</p><ul><li>Korrosionsschutz und Kennzeichnung nach Wunsch</li><li>Ab einem Waggon oder Lkw</li><li>FCA, CPT, FOB und DAP; Transportversicherung</li></ul>')) }),
        ],
      }),
      B('spacer', { h: 8 }),
      B('stats', {
        variant: 'cards', columns: 4, items: [
          K.item({ value: '600', suffix: L(t('вагонов', 'wagons', 'Wagen')), label: L(t('в сутки через станцию', 'a day through our station', 'pro Tag über unseren Bahnhof')) }),
          K.item({ value: '48', suffix: L(t('ч', 'h', 'h')), label: L(t('отгрузка со склада', 'dispatch from stock', 'Versand ab Lager')) }),
          K.item({ value: '120', suffix: L(t('т', 't', 't')), label: L(t('крупнейшее место краном', 'heaviest single lift', 'schwerstes Einzelstück')) }),
          K.item({ value: '9', suffix: L(''), label: L(t('портов назначения в Европе и Азии', 'destination ports in Europe and Asia', 'Zielhäfen in Europa und Asien')) }),
        ],
      }),
    ]),
    K.sec({
      anchor: 'esg', tone: 'dark', pad: 'm',
      eyebrow: t('06 — Устойчивое развитие', '06 — Sustainability', '06 — Nachhaltigkeit'),
      title: t('Сталь с низким углеродным следом', 'Low-carbon steel', 'Stahl mit niedrigem CO₂-Fußabdruck'),
      lead: p('Электродуговая печь и лом вместо руды и кокса: на тонну стали мы выбрасываем в три раза меньше CO₂, чем доменный передел.',
        'An electric arc furnace and scrap instead of ore and coke: we emit a third of the CO₂ per tonne of a blast-furnace route.',
        'Lichtbogenofen und Schrott statt Erz und Koks: Wir emittieren pro Tonne ein Drittel des CO₂ der Hochofenroute.'),
    }, [
      B('stats', {
        variant: 'plain', columns: 4, items: [
          K.item({ value: '0,62', suffix: L(t('т CO₂', 't CO₂', 't CO₂')), label: L(t('на тонну стали (охват 1+2)', 'per tonne of steel (scope 1+2)', 'je Tonne Stahl (Scope 1+2)')) }),
          K.item({ value: '−38', suffix: L('%'), label: L(t('выбросов к уровню 2015 года', 'emissions versus 2015', 'Emissionen gegenüber 2015')) }),
          K.item({ value: '92', suffix: L('%'), label: L(t('лома в шихте', 'scrap in the charge', 'Schrott im Einsatz')) }),
          K.item({ value: '100', suffix: L('%'), label: L(t('оборотного водоснабжения', 'process water recycled', 'Prozesswasser im Kreislauf')) }),
        ],
      }),
      B('spacer', { h: 20 }),
      B('columns', {
        gap: 28, valign: 'center', cols: [
          col(60, [B('quote', {
            variant: 'pull', tone: 'accent', icon: '',
            html: L(p('К 2030 году мы переведём прокатные печи на водородную смесь и доведём долю ветровой энергии до 80 %.', 'By 2030 we will switch our reheating furnaces to a hydrogen blend and raise the share of wind power to 80 %.', 'Bis 2030 stellen wir die Wärmöfen auf eine Wasserstoffmischung um und erhöhen den Windstromanteil auf 80 %.')),
            author: L(t('Ирина Орлова, генеральный директор', 'Irina Orlova, managing director', 'Irina Orlowa, Geschäftsführerin')),
          })]),
          col(40, [B('embed', { att: esgReport, display: 'card', player: 'object', height: 520, ratio: 'auto', caption: L(''), dl: true, op: true })]),
        ],
      }),
    ]),
    K.sec({
      anchor: 'clients', pad: 'm', align: 'center',
      eyebrow: t('07 — Клиенты', '07 — Customers', '07 — Kunden'),
      title: t('Из нашей стали строят мосты, краны и трубопроводы', 'Our steel goes into bridges, cranes and pipelines', 'Aus unserem Stahl entstehen Brücken, Krane und Leitungen'),
    }, [
      B('testimonials', {
        variant: 'cards', columns: 3, items: [
          K.item({ rating: 0, photo: null,
            html: L(p('Лист S355J2 для пролётов моста пришёл с УЗК каждого листа и сертификатами 3.2 — приёмка у технадзора прошла с первого раза.', 'S355J2 plate for the bridge spans arrived ultrasonically tested with 3.2 certificates — the inspector accepted it first time.', 'Das S355J2-Blech für die Brückenfelder kam ultraschallgeprüft mit 3.2-Zeugnissen – die Abnahme gelang beim ersten Mal.')),
            name: L(t('Олег Ржевский', 'Oleg Rzhevsky', 'Oleg Rschewski')), role: L(t('Главный инженер, «Мостострой-5»', 'Chief engineer, Mostostroy-5', 'Chefingenieur, Mostostroi-5')) }),
          K.item({ rating: 0, photo: null,
            html: L(p('Берём трубы 1020 × 14 К60 четвёртый год. Геометрия и изоляция стабильные, вагоны приходят по графику.', 'We have been buying 1020 × 14 K60 pipe for four years. Geometry and coating are consistent and the wagons arrive on schedule.', 'Wir beziehen seit vier Jahren Rohr 1020 × 14 K60. Geometrie und Umhüllung sind konstant, die Waggons kommen pünktlich.')),
            name: L(t('Алия Темирова', 'Aliya Temirova', 'Alija Temirowa')), role: L(t('Директор по закупкам, Pipeline East', 'Procurement director, Pipeline East', 'Einkaufsleiterin, Pipeline East')) }),
          K.item({ rating: 0, photo: null,
            html: L(p('Литые колёса для наших кранов выдерживают третий срок службы. Химия и твёрдость — точно по чертежу.', 'Cast wheels for our cranes are into their third service life. Chemistry and hardness exactly to the drawing.', 'Die Gussräder unserer Krane sind im dritten Lebenszyklus. Chemie und Härte exakt nach Zeichnung.')),
            name: L(t('Маттиас Кёлер', 'Matthias Köhler', 'Matthias Köhler')), role: L(t('Руководитель сервиса, Nordkran', 'Head of service, Nordkran', 'Leiter Service, Nordkran')) }),
        ],
      }),
      B('spacer', { h: 20 }),
      B('logos', { variant: 'strip', mono: true, items: clients.map((c) => K.item({ att: c.id, name: L(c.name), href: '' })) }),
    ]),
    B('cta', {
      variant: 'split', tone: 'dark', bg: band, overlay: 40,
      title: L(t('Нужна марка, которой нет в каталоге?', 'Need a grade that is not in the catalogue?', 'Sie brauchen eine Güte, die nicht im Katalog steht?')),
      html: L(p('Пришлите спецификацию — металлурги подберут химию и режим прокатки, а пробную плавку сделаем за три недели.', 'Send us the specification — our metallurgists will design the chemistry and rolling schedule, with a trial heat within three weeks.', 'Senden Sie uns die Spezifikation – unsere Metallurgen legen Analyse und Walzprogramm fest, eine Probeschmelze folgt binnen drei Wochen.')),
      items: [
        K.btn(t('Отправить запрос', 'Send a request', 'Anfrage senden'), '#rfq', 'primary', K.icon('send')),
        K.btn('+7 000 000-68-00', 'tel:+70000006800', 'secondary', K.icon('phone')),
      ],
    }),
    K.sec({
      anchor: 'team', pad: 'm',
      eyebrow: t('08 — Отдел продаж', '08 — Sales', '08 — Vertrieb'),
      title: t('Ваш менеджер по группе продукции', 'Your manager for each product group', 'Ihr Ansprechpartner je Produktgruppe'),
    }, [
      B('team', {
        variant: 'list', columns: 2, items: [
          K.item({ photo: people[0], name: L(t('Ирина Орлова', 'Irina Orlova', 'Irina Orlowa')), role: L(t('Генеральный директор', 'Managing director', 'Geschäftsführerin')),
            html: L(p('Стратегические контракты и долгосрочные поставки.', 'Strategic contracts and long-term supply.', 'Strategische Verträge und langfristige Lieferungen.')), href: 'mailto:office@kramor.example' }),
          K.item({ photo: people[1], name: L(t('Денис Белов', 'Denis Belov', 'Denis Below')), role: L(t('Плоский прокат', 'Flat products', 'Flachprodukte')),
            html: L(p('Рулон и толстый лист, судостроительные и мостовые марки.', 'Coil and heavy plate, ship and bridge grades.', 'Coil und Grobblech, Schiffbau- und Brückengüten.')), href: 'mailto:flat@kramor.example' }),
          K.item({ photo: people[2], name: L(t('Руслан Сафин', 'Ruslan Safin', 'Ruslan Safin')), role: L(t('Трубы и сорт', 'Pipes and long products', 'Rohre und Langprodukte')),
            html: L(p('Трубы большого диаметра, балка, арматура, круг.', 'Large-diameter pipe, beams, rebar and rounds.', 'Großrohre, Träger, Betonstahl und Rundstahl.')), href: 'mailto:long@kramor.example' }),
          K.item({ photo: people[3], name: L(t('Анна Линд', 'Anna Lind', 'Anna Lind')), role: L(t('Литьё и экспорт в ЕС', 'Castings and EU export', 'Guss und EU-Export')),
            html: L(p('Отливки по чертежам, слитки, сертификация CE.', 'Castings to drawing, ingots, CE certification.', 'Guss nach Zeichnung, Blöcke, CE-Zertifizierung.')), href: 'mailto:export@kramor.example' }),
        ],
      }),
    ]),
    K.sec({
      anchor: 'rfq', tone: 'muted', pad: 'm',
      eyebrow: t('09 — Запрос предложения', '09 — Request for quotation', '09 — Angebotsanfrage'),
      title: t('Ваш запрос', 'Your request', 'Ihre Anfrage'),
      lead: p('Список позиций хранится в этом браузере. Укажите стандарт, документ о качестве и базис поставки — и отправьте запрос.',
        'Your list is kept in this browser. Add the standard, inspection document and delivery terms — then send the request.',
        'Ihre Liste bleibt in diesem Browser gespeichert. Geben Sie Norm, Prüfbescheinigung und Lieferbedingung an – und senden Sie die Anfrage.'),
    }, [B('cart', { title: L(''), text: L(''), form: true })]),
    K.sec({
      anchor: 'faq', pad: 'm', align: 'center',
      eyebrow: t('10 — Вопросы и ответы', '10 — FAQ', '10 — Häufige Fragen'),
      title: t('Коротко о главном', 'The essentials', 'Das Wichtigste in Kürze'),
    }, [
      B('faq', {
        variant: 'details', openFirst: true, items: [
          K.item({ q: L(t('Какой минимальный объём заказа?', 'What is the minimum order?', 'Was ist die Mindestmenge?')),
            html: L(p('Со склада — от одной тонны по сортовому прокату и от 5 тонн по листу. Под заказ прокатываем от 20 тонн на позицию, трубы — от 10 тонн.', 'From stock: from one tonne of long products and 5 t of plate. Made to order: from 20 t per item, pipes from 10 t.', 'Ab Lager: ab einer Tonne Langprodukte und 5 t Blech. Auf Bestellung: ab 20 t je Position, Rohre ab 10 t.')) }),
          K.item({ q: L(t('Каковы сроки изготовления?', 'What are the lead times?', 'Wie lang sind die Lieferzeiten?')),
            html: L(p('Прокат из текущей программы — 3–5 недель, трубы — 6–8 недель, литьё — от 8 недель. Срок фиксируется в договоре.', 'Rolled products from the current programme 3–5 weeks, pipes 6–8 weeks, castings from 8 weeks. The date is fixed in the contract.', 'Walzprodukte aus dem laufenden Programm 3–5 Wochen, Rohre 6–8 Wochen, Guss ab 8 Wochen. Der Termin wird vertraglich fixiert.')) }),
          K.item({ q: L(t('Какие документы о качестве вы выдаёте?', 'Which inspection documents do you issue?', 'Welche Prüfbescheinigungen stellen Sie aus?')),
            html: L(p('Сертификат 3.1 по EN 10204 на каждую плавку, сертификат по ГОСТ, а по запросу — 3.2 с участием независимой инспекции или вашего представителя.', 'An EN 10204 3.1 certificate for every heat, a GOST certificate and, on request, 3.2 with an independent inspector or your representative.', 'Ein Abnahmeprüfzeugnis 3.1 nach EN 10204 für jede Schmelze, ein GOST-Zertifikat und auf Wunsch 3.2 mit unabhängiger Inspektion oder Ihrem Vertreter.')) }),
          K.item({ q: L(t('Можно ли заказать марку по собственной спецификации?', 'Can I order a grade to my own specification?', 'Kann ich eine Güte nach eigener Spezifikation bestellen?')),
            html: L(p('Да. Металлурги разработают химию и режим прокатки, а пробную плавку с испытаниями мы проводим за три недели.', 'Yes. Our metallurgists design the chemistry and rolling schedule; a trial heat with testing takes three weeks.', 'Ja. Unsere Metallurgen legen Analyse und Walzprogramm fest; eine Probeschmelze mit Prüfung dauert drei Wochen.')) }),
          K.item({ q: L(t('Как устроена отгрузка на экспорт?', 'How does export shipping work?', 'Wie läuft der Export?')),
            html: L(p('Через собственную станцию и морской терминал в 120 км на условиях FCA, CPT, FOB или DAP; упаковка и маркировка — по вашим требованиям.', 'Via our own station and a sea terminal 120 km away on FCA, CPT, FOB or DAP terms; packing and marking to your requirements.', 'Über unseren Bahnhof und ein Seeterminal in 120 km zu FCA, CPT, FOB oder DAP; Verpackung und Kennzeichnung nach Ihren Vorgaben.')) }),
          K.item({ q: L(t('Нужна ли регистрация, чтобы отправить запрос?', 'Do I need an account to send a request?', 'Brauche ich ein Konto für eine Anfrage?')),
            html: L(p('Нет. Список позиций хранится в вашем браузере, а запрос уходит прямо со страницы. Если отправка не удалась, мы предложим письмо на rfq@kramor.example с готовым текстом.', 'No. Your list is kept in your browser and the request is sent right from this page. If sending fails, we offer an e-mail to rfq@kramor.example with the text prepared.', 'Nein. Ihre Liste bleibt in Ihrem Browser, und die Anfrage geht direkt von dieser Seite. Klappt das nicht, bieten wir eine E-Mail an rfq@kramor.example mit vorbereitetem Text an.')) }),
        ],
      }),
    ]),
    K.sec({
      anchor: 'contact', tone: 'muted', pad: 'm',
      eyebrow: t('11 — Контакты', '11 — Contact', '11 — Kontakt'),
      title: t('Свяжитесь с отделом продаж', 'Contact our sales team', 'Kontaktieren Sie unseren Vertrieb'),
    }, [
      B('columns', {
        gap: 40, valign: 'top', cols: [
          col(42, [
            B('contact', {
              variant: 'list', labels: true, map: site, mapHref: '', langs: ['ru'], items: [
                K.item({ kind: 'address', value: 'Металлургов пр., 1\n000000, Ферровск', label: L('Комбинат и офис продаж'), href: '' }),
                K.item({ kind: 'phone', value: '+7 (000) 000-68-00', label: L('Отдел продаж'), href: '' }),
                K.item({ kind: 'email', value: 'sales@kramor.example', label: L('Продажи'), href: '' }),
                K.item({ kind: 'email', value: 'rfq@kramor.example', label: L('Запросы предложений'), href: '' }),
                K.item({ kind: 'hours', value: 'Пн–Пт, 8:00–17:00 (UTC+5)', label: L('Часы работы'), href: '' }),
              ],
            }),
            B('contact', {
              variant: 'list', labels: true, map: site, mapHref: '', langs: ['en', 'de'], items: [
                K.item({ kind: 'address', value: '1 Metallurgov Ave\n000000 Ferrovsk', label: L(t('', 'Works and sales office', 'Werk und Vertrieb')), href: '' }),
                K.item({ kind: 'phone', value: '+7 (000) 000-68-00', label: L(t('', 'Sales', 'Vertrieb')), href: '' }),
                K.item({ kind: 'email', value: 'sales@kramor.example', label: L(t('', 'Sales', 'Vertrieb')), href: '' }),
                K.item({ kind: 'email', value: 'rfq@kramor.example', label: L(t('', 'Requests for quotation', 'Angebotsanfragen')), href: '' }),
                K.item({ kind: 'hours', value: '8:00–17:00 (UTC+5)', label: L(t('', 'Office hours, Mon–Fri', 'Bürozeiten, Mo–Fr')), href: '' }),
              ],
            }),
          ]),
          col(58, [
            B('form', {
              variant: 'card', req: reqInbox, fallback: 'mailto', to: 'sales@kramor.example',
              title: L(t('Задать вопрос металлургу', 'Ask a metallurgist', 'Frage an einen Metallurgen')),
              submit: L(t('Отправить сообщение', 'Send message', 'Nachricht senden')),
              success: L(t('Спасибо! Мы ответим в течение рабочего дня.', 'Thank you! We will reply within one working day.', 'Vielen Dank! Wir antworten innerhalb eines Arbeitstages.')),
              consent: L(p('Отправляя форму, вы соглашаетесь на обработку контактных данных для ответа на ваш вопрос.', 'By sending the form you agree that we process your contact details to answer your question.', 'Mit dem Absenden stimmen Sie der Verarbeitung Ihrer Kontaktdaten zur Beantwortung Ihrer Frage zu.')),
              items: [
                field('name', 'text', t('Имя', 'Name', 'Name'), '', { required: true, half: true }),
                field('company', 'text', t('Компания', 'Company', 'Firma'), '', { half: true }),
                field('email', 'email', t('E-mail', 'E-mail', 'E-Mail'), 'name@company.example', { required: true, half: true }),
                field('phone', 'tel', t('Телефон', 'Phone', 'Telefon'), '+7 000 000-00-00', { half: true }),
                field('topic', 'select', t('Тема', 'Topic', 'Thema'), '', {
                  options: t('Марки и свойства\nНаличие и цены\nСертификаты\nЛогистика', 'Grades and properties\nStock and prices\nCertificates\nLogistics', 'Güten und Eigenschaften\nBestand und Preise\nZeugnisse\nLogistik'),
                }),
                field('message', 'textarea', t('Сообщение', 'Message', 'Nachricht'), t('Марка, размеры, объём, сроки', 'Grade, sizes, volume, timing', 'Güte, Abmessungen, Menge, Termine'), { required: true }),
              ],
            }),
          ]),
        ],
      }),
    ]),
  ];
  // Floating "Ask a sales engineer" chat: no external API here — a static page leaves the message by e-mail, a backend
  // export answers it live (the export check offers both).
  if (V.BLOCK_TYPES && V.BLOCK_TYPES.chat) {
    const avatar = img('chat-sales-engineer.svg', tplMetalAvatarSVG(), t('Инженер отдела продаж', 'Sales engineer', 'Vertriebsingenieur'));
    d.regions.main.push(B('chat', {
      display: 'bubble', side: 'right', avatar,
      title: L(t('Спросите инженера', 'Ask a sales engineer', 'Fragen Sie einen Vertriebsingenieur')),
      operator: L(t('Денис Белов и отдел продаж', 'Denis Belov and the sales team', 'Denis Below und das Vertriebsteam')),
      welcome: L(t('Здравствуйте! Подскажем марку, размеры и наличие на складе, рассчитаем отгрузку. Пишите — инженер ответит в рабочее время.',
        'Hello! We can help with grades, sizes, stock and shipping. Write to us — a sales engineer replies during office hours.',
        'Guten Tag! Wir helfen bei Güte, Abmessungen, Lagerbestand und Versand. Schreiben Sie uns – ein Vertriebsingenieur antwortet zu den Bürozeiten.')),
      offline: L(t('Мы на связи пн–пт с 8:00 до 17:00 (UTC+5). Оставьте вопрос с e-mail или телефоном — ответим в течение рабочего дня.',
        'We are online Mon–Fri, 8:00–17:00 (UTC+5). Leave your question with an e-mail or phone number and we will reply within one working day.',
        'Wir sind Mo–Fr von 8:00 bis 17:00 Uhr (UTC+5) erreichbar. Hinterlassen Sie Ihre Frage mit E-Mail oder Telefon – wir antworten innerhalb eines Arbeitstages.')),
      nameField: 'optional', contactField: 'required', fallback: 'mailto', to: 'sales@kramor.example',
    }));
  }

  // ----- footer -----
  const ul = (rows) => '<ul>' + rows.map(([h, x]) => '<li><a href="' + h + '">' + x + '</a></li>').join('') + '</ul>';
  const contacts = '<p><a href="tel:+70000006800">+7 (000) 000-68-00</a><br><a href="mailto:sales@kramor.example">sales@kramor.example</a></p>';
  d.regions.footer = [
    B('footer', {
      variant: 'columns', tone: 'dark', logo: brand, logoH: 44,
      brand: L(t('КРАМОР', 'KRAMOR', 'KRAMOR')),
      text: L(t('<p>Металлургический комбинат полного цикла в Ферровске: сталь, прокат, трубы и литьё с 1968 года.</p>' + contacts,
        '<p>Integrated steel works in Ferrovsk: steel, rolled products, pipes and castings since 1968.</p>' + contacts,
        '<p>Integriertes Stahlwerk in Ferrowsk: Stahl, Walzprodukte, Rohre und Guss seit 1968.</p>' + contacts)),
      items: [
        K.item({ title: L(t('Продукция', 'Products', 'Produkte')), html: L(t(
          ul([['#products', 'Рулон и лист'], ['#products', 'Балка и арматура'], ['#products', 'Трубы'], ['#products', 'Литьё и слитки']]),
          ul([['#products', 'Coil and plate'], ['#products', 'Beams and rebar'], ['#products', 'Pipes'], ['#products', 'Castings and ingots']]),
          ul([['#products', 'Coil und Blech'], ['#products', 'Träger und Betonstahl'], ['#products', 'Rohre'], ['#products', 'Guss und Blöcke']]))) }),
        K.item({ title: L(t('Комбинат', 'The works', 'Das Werk')), html: L(t(
          ul([['#grades', 'Марки и стандарты'], ['#process', 'Производство'], ['#logistics', 'Логистика'], ['#esg', 'Устойчивое развитие']]),
          ul([['#grades', 'Grades and standards'], ['#process', 'Production'], ['#logistics', 'Logistics'], ['#esg', 'Sustainability']]),
          ul([['#grades', 'Güten und Normen'], ['#process', 'Produktion'], ['#logistics', 'Logistik'], ['#esg', 'Nachhaltigkeit']]))) }),
        K.item({ title: L(t('Документы', 'Documents', 'Dokumente')), html: L(t(
          ul([['#att-' + catalogue, 'Каталог 2026'], ['#att-' + mtc, 'Образец сертификата 3.1'], ['#att-' + iso, 'Сертификаты ISO'], ['#att-' + esgReport, 'Отчёт ESG']]),
          ul([['#att-' + catalogue, 'Catalogue 2026'], ['#att-' + mtc, 'Sample 3.1 certificate'], ['#att-' + iso, 'ISO certificates'], ['#att-' + esgReport, 'Sustainability report']]),
          ul([['#att-' + catalogue, 'Katalog 2026'], ['#att-' + mtc, 'Muster-Zeugnis 3.1'], ['#att-' + iso, 'ISO-Zertifikate'], ['#att-' + esgReport, 'Nachhaltigkeitsbericht']]))) }),
      ],
      copy: L(t('© 1968–2026 АО «КРАМОР», Ферровск', '© 1968–2026 KRAMOR JSC, Ferrovsk', '© 1968–2026 KRAMOR AG, Ferrowsk')),
    }),
  ];
  return V.normalizeDoc(d);
}

const TPL_METALLURGY = {
  id: 'metallurgy',
  name: { en: 'Metallurgy', ru: 'Металлургия', de: 'Metallurgie', fr: 'Métallurgie', es: 'Metalurgia', uk: 'Металургія', ka: 'მეტალურგია' },
  desc: {
    en: 'Steel and metals works: products with “price on request” and a stock table, RFQ quote cart, grades and standards tables, certificates as PDF, capacities, process gallery, logistics map, sustainability figures, sales team, FAQ and contact form.',
    ru: 'Металлургический комбинат: продукция с «ценой по запросу» и складская таблица, корзина запроса КП, таблицы марок и стандартов, сертификаты в PDF, мощности, галерея производства, логистика, показатели устойчивого развития, отдел продаж, FAQ и форма связи.',
    de: 'Stahl- und Metallwerk: Produkte mit „Preis auf Anfrage“ und Lagertabelle, Anfragekorb (RFQ), Güten- und Normentabellen, Zeugnisse als PDF, Kapazitäten, Produktionsgalerie, Logistikkarte, Nachhaltigkeitskennzahlen, Vertriebsteam, FAQ und Kontaktformular.',
    fr: 'Usine sidérurgique : produits « prix sur demande » et tableau de stock, panier de demande de devis, tableaux de nuances et normes, certificats PDF, capacités, galerie de production, carte logistique, indicateurs durables, équipe commerciale, FAQ et formulaire.',
    es: 'Planta siderúrgica: productos con «precio a consultar» y tabla de stock, carrito de cotización, tablas de calidades y normas, certificados en PDF, capacidades, galería de producción, mapa logístico, cifras de sostenibilidad, equipo comercial, FAQ y formulario.',
    uk: 'Металургійний комбінат: продукція з «ціною за запитом» і складська таблиця, кошик запиту КП, таблиці марок і стандартів, сертифікати в PDF, потужності, галерея виробництва, логістика, показники сталого розвитку, відділ продажів, FAQ і форма зв’язку.',
    ka: 'მეტალურგიული კომბინატი: პროდუქცია „ფასი მოთხოვნით“ და საწყობის ცხრილი, შეთავაზების მოთხოვნის კალათა, მარკებისა და სტანდარტების ცხრილები, PDF სერტიფიკატები, სიმძლავრეები, წარმოების გალერეა, ლოგისტიკა, მდგრადობის მაჩვენებლები, გაყიდვების გუნდი, FAQ და საკონტაქტო ფორმა.',
  },
  langs: ['ru', 'en', 'de'],
  build: tplBuildMetallurgy,
};

export {
  TPL_METALLURGY,
  TPL_METAL_ART,
  TPL_METAL_PAINT,
  tplBuildMetallurgy,
  tplMetalAvatarSVG,
  tplMetalBrandSVG,
  tplMetalBundle,
  tplMetalCoil,
  tplMetalHeroSpec,
  tplMetalShot
};
