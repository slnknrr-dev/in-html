// site-studio/templates-site-kit.js - the kit of the Site Studio templates (on templates-kit.js): two-language texts,
// pages with navigation entries and closed sections, the header and footer, requests, and generated artwork (flat SVG
// scenes and pictures from a seed, so every template ships its own images without files).
//
// Shared primitives of the template modules: pure builders (same input, same output; randomness only from seeded
// tplRand / tplHash), returning plain document fragments, SVG strings or bytes. Templates compose them; nothing here
// reads editor state or the DOM, so they run in tests and in Node.
import { tplKit } from './templates-kit.js';
import { TPL_ART_SVG } from './templates-art.js';
import { tplHash, tplRand } from '../sample/bytes.js';

/** Palettes of the artwork: [background top, background bottom, main, second, light accent]. */
const PAL = {
  sea: ['#e6f2f5', '#cfe4ea', '#1f6f86', '#f4a259', '#ffffff'],
  dusk: ['#2b2350', '#4a3a78', '#f2b66d', '#e06c75', '#fff3df'],
  forest: ['#e7f0e2', '#cfe0c6', '#2f6b45', '#d9a441', '#ffffff'],
  clay: ['#f6ebe1', '#ead6c3', '#b5532d', '#3f5866', '#fffaf4'],
  ink: ['#eef1f6', '#dde3ee', '#26324d', '#3b82f6', '#ffffff'],
  rose: ['#fbecef', '#f3d4dc', '#9d2b4f', '#2f7d77', '#ffffff'],
  sand: ['#f8f2e4', '#efe2c6', '#6b4f2a', '#2f7d6b', '#ffffff'],
  night: ['#141b2d', '#1f2a44', '#7dd3fc', '#f472b6', '#e2e8f0'],
};

const n1 = (v) => Math.round(v * 10) / 10;

/** A flat scene 1200×800: background, sun / moon, layered hills or a skyline or waves, and a motif in front. */
function sceneSVG({ seed = 'x', pal = 'sea', motif = 'hills', w = 1200, h = 800 } = {}) {
  const P = PAL[pal] || PAL.sea;
  const r = tplRand(tplHash('scene:' + seed));
  let s = TPL_ART_SVG + `viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P[0]}"/><stop offset="1" stop-color="${P[1]}"/></linearGradient></defs>`;
  s += `<rect width="${w}" height="${h}" fill="url(#g)"/>`;
  s += `<circle cx="${n1(w * (0.62 + r() * 0.25))}" cy="${n1(h * (0.18 + r() * 0.12))}" r="${n1(70 + r() * 50)}" fill="${P[3]}" opacity=".85"/>`;
  const layer = (base, amp, color, op) => {
    let d = `M0 ${h}L0 ${n1(base)}`;
    for (let x = 0; x <= w; x += 60) d += `L${x} ${n1(base + Math.sin(x / (120 + r() * 80) + r() * 6) * amp - r() * amp * 0.4)}`;
    return `<path d="${d}L${w} ${h}Z" fill="${color}" opacity="${op}"/>`;
  };
  if (motif === 'city') {
    let x = 0;
    while (x < w) {
      const bw = 50 + r() * 90, bh = 160 + r() * 330;
      s += `<rect x="${n1(x)}" y="${n1(h - bh)}" width="${n1(bw)}" height="${n1(bh)}" fill="${P[2]}" opacity="${n1(0.55 + r() * 0.4)}"/>`;
      for (let y = h - bh + 20; y < h - 30; y += 34) for (let k = 12; k < bw - 14; k += 26) if (r() > 0.45) s += `<rect x="${n1(x + k)}" y="${n1(y)}" width="12" height="16" fill="${P[4]}" opacity=".7"/>`;
      x += bw + 6;
    }
  } else if (motif === 'waves') {
    for (let k = 0; k < 4; k++) s += layer(h * (0.55 + k * 0.1), 18 + k * 6, k % 2 ? P[2] : P[3], 0.35 + k * 0.15);
  } else if (motif === 'grid') {
    for (let x = 60; x < w; x += 90) s += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="${P[2]}" stroke-opacity=".12"/>`;
    for (let y = 60; y < h; y += 90) s += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="${P[2]}" stroke-opacity=".12"/>`;
    for (let k = 0; k < 9; k++) s += `<rect x="${n1(80 + r() * (w - 300))}" y="${n1(80 + r() * (h - 260))}" width="${n1(120 + r() * 160)}" height="${n1(70 + r() * 110)}" rx="14" fill="${k % 3 ? P[4] : P[2]}" opacity="${k % 3 ? 0.9 : 0.75}" stroke="${P[2]}" stroke-opacity=".2"/>`;
  } else {
    s += layer(h * 0.62, 40, P[2], 0.35) + layer(h * 0.72, 30, P[2], 0.6) + layer(h * 0.84, 22, P[2], 0.9);
  }
  if (motif === 'house') {
    s += layer(h * 0.8, 14, P[2], 0.85);
    const bx = w * 0.32, by = h * 0.42;
    s += `<rect x="${n1(bx)}" y="${n1(by)}" width="420" height="260" fill="${P[4]}"/><path d="M${n1(bx - 30)} ${n1(by)}L${n1(bx + 210)} ${n1(by - 150)}L${n1(bx + 450)} ${n1(by)}Z" fill="${P[3]}"/>`;
    s += `<rect x="${n1(bx + 50)}" y="${n1(by + 60)}" width="90" height="80" fill="${P[2]}" opacity=".8"/><rect x="${n1(bx + 280)}" y="${n1(by + 60)}" width="90" height="80" fill="${P[2]}" opacity=".8"/><rect x="${n1(bx + 170)}" y="${n1(by + 120)}" width="80" height="140" fill="${P[2]}"/>`;
  } else if (motif === 'book') {
    s += `<g transform="translate(${n1(w * 0.3)} ${n1(h * 0.3)})"><path d="M0 40c120-40 220-40 260 10v330c-40-50-140-50-260-10z" fill="${P[4]}"/><path d="M520 40c-120-40-220-40-260 10v330c40-50 140-50 260-10z" fill="${P[4]}" opacity=".92"/>`;
    for (let k = 0; k < 8; k++) s += `<rect x="30" y="${80 + k * 34}" width="${170 - (k % 3) * 30}" height="8" rx="4" fill="${P[2]}" opacity=".35"/><rect x="300" y="${80 + k * 34}" width="${170 - ((k + 1) % 3) * 30}" height="8" rx="4" fill="${P[2]}" opacity=".35"/>`;
    s += '</g>';
  } else if (motif === 'stage') {
    s += `<rect x="0" y="${n1(h * 0.78)}" width="${w}" height="${n1(h * 0.22)}" fill="${P[2]}"/>`;
    for (let k = 0; k < 5; k++) s += `<path d="M${n1(150 + k * 220)} 0L${n1(80 + k * 220)} ${n1(h * 0.78)}L${n1(260 + k * 220)} ${n1(h * 0.78)}Z" fill="${P[4]}" opacity=".12"/>`;
    for (let k = 0; k < 14; k++) s += `<circle cx="${n1(60 + k * 82)}" cy="${n1(h * 0.88 + (k % 2) * 18)}" r="24" fill="${P[1]}" opacity=".9"/>`;
  } else if (motif === 'shop') {
    s += `<rect x="${n1(w * 0.2)}" y="${n1(h * 0.3)}" width="${n1(w * 0.6)}" height="${n1(h * 0.5)}" rx="18" fill="${P[4]}"/>`;
    for (let k = 0; k < 7; k++) s += `<path d="M${n1(w * 0.2 + k * w * 0.6 / 7)} ${n1(h * 0.3)}h${n1(w * 0.6 / 7)}v50a${n1(w * 0.3 / 7)} 30 0 0 1-${n1(w * 0.6 / 7)} 0z" fill="${k % 2 ? P[3] : P[2]}"/>`;
    for (let k = 0; k < 4; k++) s += `<rect x="${n1(w * 0.25 + k * 170)}" y="${n1(h * 0.52)}" width="120" height="150" rx="10" fill="${k % 2 ? P[3] : P[2]}" opacity=".85"/>`;
  }
  return s + '</svg>';
}

/** A square picture for cards: a soft gradient, a big initial or a glyph and a few shapes (600×600). */
function cardSVG({ seed = 'x', pal = 'sea', glyph = '', w = 600, h = 600 } = {}) {
  const P = PAL[pal] || PAL.sea;
  const r = tplRand(tplHash('card:' + seed));
  const a = Math.round(r() * 360);
  let s = TPL_ART_SVG + `viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><defs><linearGradient id="c" gradientTransform="rotate(${a} .5 .5)"><stop offset="0" stop-color="${P[0]}"/><stop offset="1" stop-color="${P[1]}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#c)"/>`;
  for (let k = 0; k < 5; k++) s += `<circle cx="${n1(r() * w)}" cy="${n1(r() * h)}" r="${n1(40 + r() * 160)}" fill="${k % 2 ? P[2] : P[3]}" opacity="${n1(0.08 + r() * 0.18)}"/>`;
  if (glyph) s += `<text x="50%" y="56%" text-anchor="middle" dominant-baseline="middle" font-family="Georgia,'Times New Roman',serif" font-size="${glyph.length > 2 ? 150 : 260}" font-weight="700" fill="${P[2]}" opacity=".85">${glyph.replace(/[<&>"]/g, '')}</text>`;
  return s + '</svg>';
}

/** A portrait silhouette 400×400 (head and shoulders) for team cards. */
function personSVG({ seed = 'x', pal = 'sea' } = {}) {
  const P = PAL[pal] || PAL.sea;
  const r = tplRand(tplHash('person:' + seed));
  const skin = ['#f1c7a5', '#d9a07a', '#a86b48', '#f6d8bf', '#8d5a3b'][Math.floor(r() * 5)];
  const hair = ['#2b1d16', '#6b4a2b', '#c9a15f', '#1b1b1b', '#8a8a8a'][Math.floor(r() * 5)];
  return TPL_ART_SVG + `viewBox="0 0 400 400" width="400" height="400"><rect width="400" height="400" fill="${P[0]}"/><circle cx="200" cy="420" r="170" fill="${P[2]}"/>`
    + `<rect x="170" y="230" width="60" height="50" fill="${skin}"/><ellipse cx="200" cy="175" rx="78" ry="92" fill="${skin}"/>`
    + `<path d="M120 170c0-70 40-110 82-110s80 40 80 110c-10-40-40-62-80-62s-72 22-82 62z" fill="${hair}"/>`
    + `<circle cx="172" cy="182" r="7" fill="#2b2b2b"/><circle cx="228" cy="182" r="7" fill="#2b2b2b"/><path d="M178 225q22 16 44 0" stroke="#7a3b2e" stroke-width="5" fill="none" stroke-linecap="round"/></svg>`;
}

/**
 * Site kit: the landing kit plus
 *   T(en, ru, more?)       two-language text ({ en, ru } + optional other languages)
 *   P(en, ru)              the same as paragraphs
 *   page(slug, title, blocks, o)   a page (o: nav, navLabel, access, roles, metaDesc)
 *   art.scene / art.card / art.person (name, options) → attachment id of a generated picture
 *   req(name, url, method) → a configured request (id)
 *   links(rows)            footer link list html per language
 */
function siteKit(V, langs = ['en', 'ru']) {
  const K = tplKit(V, langs);
  const { B, L } = K;
  const T = (en, ru, more = {}) => ({ en, ru: ru == null ? en : ru, ...more });
  const P = (en, ru, more = {}) => {
    const o = { en: '<p>' + en + '</p>', ru: '<p>' + (ru == null ? en : ru) + '</p>' };
    for (const [k, v] of Object.entries(more)) o[k] = '<p>' + v + '</p>';
    return o;
  };
  const art = {
    scene: (name, o) => K.svg(name + '.svg', sceneSVG(o), { title: o.title || '' }),
    card: (name, o) => K.svg(name + '.svg', cardSVG(o), { title: o.title || '' }),
    person: (name, o) => K.svg(name + '.svg', personSVG(o), { title: '' }),
  };
  const requests = [];
  const req = (name, url, method = 'POST') => {
    const id = K.id();
    requests.push({ id, name, method, url, headers: [], credentials: url.startsWith('local:') ? 'omit' : 'same-origin', timeout: 8000, retries: 1, itemsPath: 'items' });
    return id;
  };
  const page = (slug, title, blocks, o = {}) => B('page', {
    slug, title: L(title), navLabel: L(o.navLabel || title), nav: o.nav !== false, metaDesc: L(o.metaDesc || ''),
    access: o.access || 'public', roles: o.roles || '', blocks,
  });
  const baseSec = K.sec;
  const sec = (o, blocks) => baseSec({ pad: 'm', width: 'wide', ...o }, blocks);
  const links = (rows) => {
    const out = {};
    for (const l of langs) out[l] = '<ul>' + rows.map(([href, label]) => '<li><a href="' + href + '">' + (typeof label === 'object' ? (label[l] || label.en) : label) + '</a></li>').join('') + '</ul>';
    return out;
  };
  const baseItem = K.item;
  const item = (o) => baseItem(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v && typeof v === 'object' && !Array.isArray(v) && 'en' in v ? L(v) : v])));
  return Object.assign(K, { T, P, art, req, requests, page, sec, links, item });
}

export { PAL, cardSVG, personSVG, sceneSVG, siteKit };
