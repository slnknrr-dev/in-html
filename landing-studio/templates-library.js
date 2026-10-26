// landing-studio/templates-library.js - template "library": a public library with a text and an audio edition
// of its books (en default, ru, uk; theme preset 'folio'), and the generic media primitives the book and audio
// templates share (templates-books.js, templates-audio.js): typographic covers and cover mock-ups, gentle tonal WAV
// sketches, UTF-8 text files, isometric bookcase and furniture specs for the generic scene kit (templates-art.js).
//
// Contract of a template module: each exported template object carries an id, localized names and build(V, ...) ->
// a fresh document; templates.js adds catalogue metadata (group, mode, modules) where the module does not declare it,
// and studio/gallery.js shows the catalogue.
// The viewer API arrives as the argument V instead of an import, so templates are pure document builders that tests
// (test.js renders every template) and the gallery can run without the editor. Generated artwork and sample data are
// derived from seeds (tplHash / tplRand where used), so a template builds the same document on every run.
// Data file: names, texts, figures and art specs dominate; comments mark sections, not individual values.
import { tplHash, tplRand, tplUtf8 } from '../sample/bytes.js';
import { b64encode } from '../codec/base64.js';
import { escapeHTML } from '../html/escape.js';
import { tplKit } from './templates-kit.js';
import { TPL_ART_SVG, tplArtMap, tplArtMix, tplIsoScene } from './templates-art.js';
import { tplAgroPortrait } from './templates-agro.js';
// ===== Template: library — Lindgrove City Library (en default, ru, uk) =====
// Built only from the generic blocks: the catalogue is a `collection` whose items carry their subject in attributes
// (Author, Language, Genre, Age, Year, Pages, Duration, Narrator) and files (Markdown / plain text editions, tonal audio
// chapters, a PDF facsimile). All people, places, books, phone numbers and e-mails below are FICTIONAL; the texts are
// original pastiches written for this template, the pictures and sounds are generated.

/* ==========================================================================
   Generic media primitives (no subject knowledge: callers pass colours, motifs and text as data)
   ========================================================================== */

/** i18n value in en · ru · uk. */
const tplLibT = (en, ru, uk) => ({ en, ru, uk });

/** Rich text: each argument (string or array of paragraphs) becomes <p> paragraphs. */
function tplLibP(en, ru, uk) {
  const p = (a) => (Array.isArray(a) ? a : [a]).map((x) => '<p>' + x + '</p>').join('');
  return { en: p(en), ru: p(ru), uk: p(uk) };
}

/** Bullet list in three languages from parallel arrays. */
function tplLibUl(en, ru, uk) {
  const u = (a) => '<ul>' + a.map((x) => '<li>' + x + '</li>').join('') + '</ul>';
  return { en: u(en), ru: u(ru), uk: u(uk) };
}

/** UTF-8 text (Markdown / plain text file content) → base64. */
const tplLibText = (s) => b64encode(tplUtf8(String(s).replace(/^\n+/, '')));

const tplLibN = (v) => String(Math.round(v * 10) / 10);

/* ---------- typographic covers ---------- */

const TPL_LIB_FONTS = {
  serif: "Georgia,Cambria,'Times New Roman',serif",
  sans: "'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif",
  slab: "Rockwell,'Roboto Slab','Zilla Slab',Georgia,serif",
  mono: "Consolas,'Cascadia Mono','Courier New',monospace",
  display: "Didot,'Bodoni MT','Bodoni 72','Playfair Display',Georgia,serif",
  condensed: "'Bahnschrift SemiCondensed','Roboto Condensed','Arial Narrow',Arial,sans-serif",
};

/** Greedy word wrap by character count. */
function tplLibWrap(text, max) {
  const lines = [];
  let cur = '';
  for (const w of String(text).split(/\s+/).filter(Boolean)) {
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= max) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Decorative motifs: generic shapes drawn into the box {x, y, w, h}. c = {bg, ink, accent, soft}; rnd = seeded.
 * Keys: sun, waves, arches, rings, grid, stripes, leaves, stars, peaks, dial, beam, envelope, wheel, bars, disc, rain.
 */
const TPL_LIB_MOTIFS = {
  sun(b, c, rnd) {
    const cx = b.x + b.w * (0.35 + rnd() * 0.3), cy = b.y + b.h * 0.5, r = Math.min(b.w, b.h) * 0.3;
    let s = '<g stroke="' + c.accent + '" stroke-width="' + tplLibN(r * 0.05) + '" stroke-linecap="round">';
    for (let i = 0; i < 18; i++) {
      const a = Math.PI + (i / 17) * Math.PI;
      s += '<path d="M' + tplLibN(cx + Math.cos(a) * r * 1.25) + ' ' + tplLibN(cy + Math.sin(a) * r * 1.25) + 'L' + tplLibN(cx + Math.cos(a) * r * 1.6) + ' ' + tplLibN(cy + Math.sin(a) * r * 1.6) + '"/>';
    }
    s += '</g><path d="M' + tplLibN(cx - r) + ' ' + tplLibN(cy) + 'A' + tplLibN(r) + ' ' + tplLibN(r) + ' 0 0 1 ' + tplLibN(cx + r) + ' ' + tplLibN(cy) + 'Z" fill="' + c.accent + '"/>';
    for (let i = 0; i < 5; i++) {
      const y = cy + r * 0.18 + i * r * 0.2, k = 1 - i * 0.16;
      s += '<path d="M' + tplLibN(cx - r * k) + ' ' + tplLibN(y) + 'H' + tplLibN(cx + r * k) + '" stroke="' + c.accent + '" stroke-width="' + tplLibN(r * 0.07) + '" opacity="' + (0.8 - i * 0.14).toFixed(2) + '"/>';
    }
    return s + '<path d="M' + b.x + ' ' + tplLibN(cy) + 'H' + (b.x + b.w) + '" stroke="' + c.ink + '" stroke-width="2" opacity=".5"/>';
  },
  waves(b, c, rnd) {
    let s = '';
    const n = 7, amp = b.h * 0.035, per = b.w / (2 + Math.floor(rnd() * 2));
    for (let i = 0; i < n; i++) {
      const y0 = b.y + b.h * 0.12 + (i * b.h * 0.8) / (n - 1), ph = rnd() * per;
      let d = '';
      for (let x = 0; x <= b.w; x += 8) d += (x ? 'L' : 'M') + tplLibN(b.x + x) + ' ' + tplLibN(y0 + Math.sin(((x + ph) / per) * Math.PI * 2) * amp);
      s += '<path d="' + d + '" fill="none" stroke="' + (i % 3 === 1 ? c.accent : c.ink) + '" stroke-width="' + tplLibN(b.h * 0.012 + (i % 2) * 2) + '" stroke-linecap="round" opacity="' + (0.35 + 0.65 * (i / n)).toFixed(2) + '"/>';
    }
    return s;
  },
  arches(b, c) {
    const cx = b.x + b.w / 2, base = b.y + b.h;
    let s = '';
    const n = 4;
    for (let i = 0; i < n; i++) {
      const r = (b.w * 0.42) * (1 - i * 0.2), top = b.y + b.h * 0.12 + i * b.h * 0.11;
      s += '<path d="M' + tplLibN(cx - r) + ' ' + tplLibN(base) + 'V' + tplLibN(top + r) + 'A' + tplLibN(r) + ' ' + tplLibN(r) + ' 0 0 1 ' + tplLibN(cx + r) + ' ' + tplLibN(top + r) + 'V' + tplLibN(base) + 'Z" fill="' + [c.accent, c.soft, c.ink, c.bg][i] + '"' + (i === 2 ? ' opacity=".85"' : '') + '/>';
    }
    return s;
  },
  rings(b, c, rnd) {
    const cx = b.x + b.w * (0.3 + rnd() * 0.4), cy = b.y + b.h * (0.35 + rnd() * 0.3), R = Math.max(b.w, b.h) * 0.6;
    let s = '<g fill="none">';
    for (let i = 1; i <= 9; i++) s += '<circle cx="' + tplLibN(cx) + '" cy="' + tplLibN(cy) + '" r="' + tplLibN((R * i) / 9) + '" stroke="' + (i === 3 ? c.accent : c.ink) + '" stroke-width="' + (i === 3 ? 6 : 1.6) + '" opacity="' + (i === 3 ? 1 : 0.45) + '"/>';
    return s + '</g><circle cx="' + tplLibN(cx) + '" cy="' + tplLibN(cy) + '" r="' + tplLibN(R * 0.07) + '" fill="' + c.accent + '"/>';
  },
  grid(b, c, rnd) {
    const n = 7, m = Math.round(n * (b.h / b.w)), gx = b.w / n, gy = b.h / m;
    let dots = '', acc = '';
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) {
        const x = b.x + gx * (i + 0.5), y = b.y + gy * (j + 0.5);
        if (rnd() < 0.12) acc += '<rect x="' + tplLibN(x - gx * 0.38) + '" y="' + tplLibN(y - gy * 0.38) + '" width="' + tplLibN(gx * 0.76) + '" height="' + tplLibN(gy * 0.76) + '"/>';
        else dots += '<circle cx="' + tplLibN(x) + '" cy="' + tplLibN(y) + '" r="' + tplLibN(Math.min(gx, gy) * 0.09) + '"/>';
      }
    }
    return '<g fill="' + c.ink + '" opacity=".55">' + dots + '</g><g fill="' + c.accent + '">' + acc + '</g>';
  },
  stripes(b, c) {
    let s = '';
    const n = 9, step = (b.w + b.h) / n;
    for (let i = 0; i < n; i++) {
      const x0 = b.x - b.h + i * step;
      s += '<path d="M' + tplLibN(x0) + ' ' + (b.y + b.h) + 'L' + tplLibN(x0 + b.h) + ' ' + b.y + 'H' + tplLibN(x0 + b.h + step * 0.45) + 'L' + tplLibN(x0 + step * 0.45) + ' ' + (b.y + b.h) + 'Z" fill="' + (i % 3 === 1 ? c.accent : c.ink) + '" opacity="' + (i % 3 === 1 ? 1 : 0.22) + '"/>';
    }
    return s;
  },
  leaves(b, c, rnd) {
    let s = '';
    for (let i = 0; i < 9; i++) {
      const x = b.x + b.w * (0.12 + rnd() * 0.76), y = b.y + b.h * (0.12 + rnd() * 0.76), L = Math.min(b.w, b.h) * (0.18 + rnd() * 0.14), a = rnd() * 360;
      const fill = i % 3 === 0 ? c.accent : i % 3 === 1 ? c.ink : c.soft;
      s += '<g transform="translate(' + tplLibN(x) + ' ' + tplLibN(y) + ') rotate(' + tplLibN(a) + ')"><path d="M0 0C' + tplLibN(L * 0.3) + ' ' + tplLibN(-L * 0.35) + ' ' + tplLibN(L * 0.75) + ' ' + tplLibN(-L * 0.3) + ' ' + tplLibN(L) + ' 0C' +
        tplLibN(L * 0.75) + ' ' + tplLibN(L * 0.3) + ' ' + tplLibN(L * 0.3) + ' ' + tplLibN(L * 0.35) + ' 0 0Z" fill="' + fill + '" opacity=".9"/><path d="M' + tplLibN(-L * 0.15) + ' 0H' + tplLibN(L * 0.85) + '" stroke="' + c.bg + '" stroke-width="1.5" opacity=".6"/></g>';
    }
    return s;
  },
  stars(b, c, rnd) {
    const mx = b.x + b.w * 0.68, my = b.y + b.h * 0.34, r = Math.min(b.w, b.h) * 0.2;
    let s = '<circle cx="' + tplLibN(mx) + '" cy="' + tplLibN(my) + '" r="' + tplLibN(r) + '" fill="' + c.accent + '"/>' +
      '<circle cx="' + tplLibN(mx + r * 0.42) + '" cy="' + tplLibN(my - r * 0.22) + '" r="' + tplLibN(r * 0.86) + '" fill="' + c.panel + '"/><g fill="' + c.ink + '">';
    for (let i = 0; i < 26; i++) {
      const x = b.x + rnd() * b.w, y = b.y + rnd() * b.h, k = 3 + rnd() * 7;
      if (Math.hypot(x - mx, y - my) < r * 1.4) continue;
      s += '<path d="M' + tplLibN(x) + ' ' + tplLibN(y - k) + 'L' + tplLibN(x + k * 0.3) + ' ' + tplLibN(y) + 'L' + tplLibN(x) + ' ' + tplLibN(y + k) + 'L' + tplLibN(x - k * 0.3) + ' ' + tplLibN(y) + 'Z" opacity="' + (0.45 + rnd() * 0.55).toFixed(2) + '"/>';
    }
    return s + '</g>';
  },
  // Layered ridges, far → near.
  peaks(b, c, rnd) {
    let s = '';
    const fills = [c.soft, c.accent, c.ink, c.ink], ops = [1, 0.9, 0.5, 0.85];
    for (let i = 0; i < 4; i++) {
      const base = b.y + b.h * (0.5 + i * 0.16);
      const n = 3 + Math.floor(rnd() * 3), step = b.w / n;
      let d = 'M' + b.x + ' ' + tplLibN(base);
      for (let k = 0; k < n; k++) {
        const up = b.h * (0.16 + rnd() * 0.24) * (1 - i * 0.16);
        d += 'L' + tplLibN(b.x + step * (k + 0.5)) + ' ' + tplLibN(base - up) + 'L' + tplLibN(b.x + step * (k + 1)) + ' ' + tplLibN(base - up * rnd() * 0.3);
      }
      s += '<path d="' + d + 'V' + (b.y + b.h) + 'H' + b.x + 'Z" fill="' + fills[i] + '" opacity="' + ops[i] + '"/>';
    }
    return s;
  },
  dial(b, c, rnd) {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, r = Math.min(b.w, b.h) * 0.42;
    let s = '<circle cx="' + tplLibN(cx) + '" cy="' + tplLibN(cy) + '" r="' + tplLibN(r) + '" fill="' + c.soft + '" stroke="' + c.ink + '" stroke-width="' + tplLibN(r * 0.05) + '"/><g stroke="' + c.ink + '" stroke-linecap="round">';
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2, big = i % 5 === 0, r0 = r * (big ? 0.78 : 0.86);
      s += '<path d="M' + tplLibN(cx + Math.cos(a) * r0) + ' ' + tplLibN(cy + Math.sin(a) * r0) + 'L' + tplLibN(cx + Math.cos(a) * r * 0.92) + ' ' + tplLibN(cy + Math.sin(a) * r * 0.92) + '" stroke-width="' + (big ? tplLibN(r * 0.035) : '1.4') + '"/>';
    }
    const h = -Math.PI / 2 + rnd() * Math.PI * 2, m = -Math.PI / 2 + rnd() * Math.PI * 2;
    s += '</g><path d="M' + tplLibN(cx) + ' ' + tplLibN(cy) + 'L' + tplLibN(cx + Math.cos(h) * r * 0.48) + ' ' + tplLibN(cy + Math.sin(h) * r * 0.48) + '" stroke="' + c.ink + '" stroke-width="' + tplLibN(r * 0.07) + '" stroke-linecap="round"/>' +
      '<path d="M' + tplLibN(cx) + ' ' + tplLibN(cy) + 'L' + tplLibN(cx + Math.cos(m) * r * 0.7) + ' ' + tplLibN(cy + Math.sin(m) * r * 0.7) + '" stroke="' + c.accent + '" stroke-width="' + tplLibN(r * 0.04) + '" stroke-linecap="round"/>';
    return s + '<circle cx="' + tplLibN(cx) + '" cy="' + tplLibN(cy) + '" r="' + tplLibN(r * 0.06) + '" fill="' + c.accent + '"/>';
  },
  beam(b, c) {
    const tx = b.x + b.w * 0.3, base = b.y + b.h * 0.86, top = b.y + b.h * 0.3, tw = b.w * 0.07;
    let s = '<path d="M' + tplLibN(tx + tw * 1.4) + ' ' + tplLibN(top + tw * 0.4) + 'L' + (b.x + b.w) + ' ' + tplLibN(b.y + b.h * 0.08) + 'V' + tplLibN(b.y + b.h * 0.42) + 'Z" fill="' + c.accent + '" opacity=".55"/>';
    s += '<path d="M' + tplLibN(tx - tw * 1.6) + ' ' + tplLibN(base) + 'L' + tplLibN(tx - tw) + ' ' + tplLibN(top + tw * 2) + 'H' + tplLibN(tx + tw) + 'L' + tplLibN(tx + tw * 1.6) + ' ' + tplLibN(base) + 'Z" fill="' + c.ink + '"/>';
    s += '<rect x="' + tplLibN(tx - tw * 1.3) + '" y="' + tplLibN(top) + '" width="' + tplLibN(tw * 2.6) + '" height="' + tplLibN(tw * 2) + '" fill="' + c.accent + '"/>';
    s += '<path d="M' + tplLibN(tx - tw * 1.6) + ' ' + tplLibN(top) + 'L' + tplLibN(tx) + ' ' + tplLibN(top - tw * 1.6) + 'L' + tplLibN(tx + tw * 1.6) + ' ' + tplLibN(top) + 'Z" fill="' + c.ink + '"/>';
    for (let i = 0; i < 3; i++) s += '<rect x="' + tplLibN(tx - tw * (1.2 + i * 0.12)) + '" y="' + tplLibN(top + tw * (3 + i * 2.6)) + '" width="' + tplLibN(tw * (2.4 + i * 0.24)) + '" height="' + tplLibN(tw * 0.5) + '" fill="' + c.bg + '" opacity=".7"/>';
    for (let i = 0; i < 4; i++) s += '<path d="M' + b.x + ' ' + tplLibN(base + i * b.h * 0.035) + 'H' + (b.x + b.w) + '" stroke="' + c.ink + '" stroke-width="2" opacity="' + (0.5 - i * 0.1).toFixed(2) + '"/>';
    return s;
  },
  envelope(b, c) {
    const w = b.w * 0.8, h = w * 0.62, x = b.x + (b.w - w) / 2, y = b.y + (b.h - h) / 2;
    return '<rect x="' + tplLibN(x) + '" y="' + tplLibN(y) + '" width="' + tplLibN(w) + '" height="' + tplLibN(h) + '" fill="' + c.accent + '"/>' +
      '<path d="M' + tplLibN(x) + ' ' + tplLibN(y) + 'L' + tplLibN(x + w / 2) + ' ' + tplLibN(y + h * 0.58) + 'L' + tplLibN(x + w) + ' ' + tplLibN(y) + '" fill="none" stroke="' + c.ink + '" stroke-width="3" opacity=".7"/>' +
      '<path d="M' + tplLibN(x) + ' ' + tplLibN(y + h) + 'L' + tplLibN(x + w * 0.4) + ' ' + tplLibN(y + h * 0.45) + 'M' + tplLibN(x + w) + ' ' + tplLibN(y + h) + 'L' + tplLibN(x + w * 0.6) + ' ' + tplLibN(y + h * 0.45) + '" stroke="' + c.ink + '" stroke-width="2" opacity=".45"/>' +
      '<circle cx="' + tplLibN(x + w / 2) + '" cy="' + tplLibN(y + h * 0.6) + '" r="' + tplLibN(w * 0.07) + '" fill="' + c.ink + '"/>';
  },
  wheel(b, c) {
    const cx = b.x + b.w / 2, cy = b.y + b.h * 0.55, r = Math.min(b.w, b.h) * 0.4;
    let s = '<circle cx="' + tplLibN(cx) + '" cy="' + tplLibN(cy) + '" r="' + tplLibN(r) + '" fill="none" stroke="' + c.ink + '" stroke-width="' + tplLibN(r * 0.06) + '"/>' +
      '<circle cx="' + tplLibN(cx) + '" cy="' + tplLibN(cy) + '" r="' + tplLibN(r * 0.62) + '" fill="none" stroke="' + c.ink + '" stroke-width="2" opacity=".5"/><g stroke="' + c.ink + '" stroke-width="' + tplLibN(r * 0.035) + '">';
    let pad = '';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      s += '<path d="M' + tplLibN(cx) + ' ' + tplLibN(cy) + 'L' + tplLibN(cx + Math.cos(a) * r) + ' ' + tplLibN(cy + Math.sin(a) * r) + '"/>';
      const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
      pad += '<rect x="' + tplLibN(px - r * 0.09) + '" y="' + tplLibN(py - r * 0.05) + '" width="' + tplLibN(r * 0.18) + '" height="' + tplLibN(r * 0.1) + '" transform="rotate(' + tplLibN((a * 180) / Math.PI) + ' ' + tplLibN(px) + ' ' + tplLibN(py) + ')"/>';
    }
    s += '</g><g fill="' + c.accent + '">' + pad + '</g><circle cx="' + tplLibN(cx) + '" cy="' + tplLibN(cy) + '" r="' + tplLibN(r * 0.12) + '" fill="' + c.accent + '"/>';
    for (let i = 0; i < 3; i++) s += '<path d="M' + b.x + ' ' + tplLibN(b.y + b.h * (0.9 + i * 0.04)) + 'q' + tplLibN(b.w / 8) + ' -8 ' + tplLibN(b.w / 4) + ' 0t' + tplLibN(b.w / 4) + ' 0t' + tplLibN(b.w / 4) + ' 0t' + tplLibN(b.w / 4) + ' 0" fill="none" stroke="' + c.accent + '" stroke-width="3" opacity="' + (0.8 - i * 0.2).toFixed(2) + '"/>';
    return s;
  },
  bars(b, c, rnd) {
    const n = 15, gw = b.w / n;
    let s = '';
    for (let i = 0; i < n; i++) {
      const env = Math.sin(((i + 0.5) / n) * Math.PI);
      const h = b.h * (0.15 + 0.75 * env * (0.45 + rnd() * 0.55));
      s += '<rect x="' + tplLibN(b.x + i * gw + gw * 0.18) + '" y="' + tplLibN(b.y + (b.h - h) / 2) + '" width="' + tplLibN(gw * 0.64) + '" height="' + tplLibN(h) + '" rx="' + tplLibN(gw * 0.32) + '" fill="' + (i % 4 === 2 ? c.accent : c.ink) + '" opacity="' + (i % 4 === 2 ? 1 : 0.8) + '"/>';
    }
    return s;
  },
  disc(b, c) {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, r = Math.min(b.w, b.h) * 0.46;
    let s = '<circle cx="' + tplLibN(cx) + '" cy="' + tplLibN(cy) + '" r="' + tplLibN(r) + '" fill="' + c.ink + '"/><g fill="none" stroke="' + c.bg + '" opacity=".22">';
    for (let i = 0; i < 10; i++) s += '<circle cx="' + tplLibN(cx) + '" cy="' + tplLibN(cy) + '" r="' + tplLibN(r * (0.45 + i * 0.053)) + '"/>';
    return s + '</g><path d="M' + tplLibN(cx - r * 0.7) + ' ' + tplLibN(cy - r * 0.55) + 'A' + tplLibN(r * 0.9) + ' ' + tplLibN(r * 0.9) + ' 0 0 1 ' + tplLibN(cx + r * 0.1) + ' ' + tplLibN(cy - r * 0.88) + '" fill="none" stroke="' + c.bg + '" stroke-width="' + tplLibN(r * 0.05) + '" opacity=".25" stroke-linecap="round"/>' +
      '<circle cx="' + tplLibN(cx) + '" cy="' + tplLibN(cy) + '" r="' + tplLibN(r * 0.34) + '" fill="' + c.accent + '"/><circle cx="' + tplLibN(cx) + '" cy="' + tplLibN(cy) + '" r="' + tplLibN(r * 0.04) + '" fill="' + c.bg + '"/>';
  },
  rain(b, c, rnd) {
    let s = '<g stroke-linecap="round">';
    for (let i = 0; i < 46; i++) {
      const x = b.x + rnd() * b.w, y = b.y + rnd() * b.h, L = b.h * (0.04 + rnd() * 0.05);
      s += '<path d="M' + tplLibN(x) + ' ' + tplLibN(y) + 'l' + tplLibN(-L * 0.35) + ' ' + tplLibN(L) + '" stroke="' + (i % 5 ? c.ink : c.accent) + '" stroke-width="' + (i % 5 ? 2 : 4) + '" opacity="' + (i % 5 ? 0.5 : 1) + '"/>';
    }
    return s + '</g>';
  },
};

/**
 * Book / album / episode cover (SVG markup). o = {seed, w (400), h (600), bg, ink, accent, soft, panel, motif
 * (TPL_LIB_MOTIFS key), art: 'top'|'bottom'|'full'|'right' (where the motif goes; 'right' = the right half of a wide
 * picture), title, author, label (imprint / series line), font, fontTitle, weight, italic, caps (title upper case),
 * align: 'left'|'center', idp (id prefix when covers are nested), mark ('' | short text in a circle, e.g. a number)}.
 */
function tplLibCover(o) {
  const W = o.w || 400, H = o.h || 600, p = o.idp || 'c', U = Math.min(W, H);
  const rnd = tplRand(tplHash('cover:' + (o.seed || o.title)));
  const c = { bg: o.bg || '#f3ead8', ink: o.ink || '#1f2a2e', accent: o.accent || '#c0812a' };
  c.soft = o.soft || tplArtMix(c.bg, c.ink, 0.14);
  c.panel = o.art === 'full' ? c.bg : o.panel || c.soft;
  const pad = U * 0.09, F = TPL_LIB_FONTS;
  const art = o.art || 'bottom';
  const square = W === H, wide = art === 'right';
  const box = art === 'full' ? { x: 0, y: 0, w: W, h: H } : wide ? { x: W * 0.54, y: 0, w: W * 0.46, h: H }
    : art === 'top' ? { x: 0, y: 0, w: W, h: H * (square ? 0.58 : 0.56) } : { x: 0, y: H * (square ? 0.44 : 0.42), w: W, h: H * (square ? 0.56 : 0.58) };
  const motif = TPL_LIB_MOTIFS[o.motif] || TPL_LIB_MOTIFS.rings;
  let s = TPL_ART_SVG + 'viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '"><defs>' +
    '<clipPath id="' + p + 'a"><rect x="' + box.x + '" y="' + box.y + '" width="' + box.w + '" height="' + box.h + '"/></clipPath>' +
    '<linearGradient id="' + p + 'g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".14"/></linearGradient>' +
    '</defs><rect width="' + W + '" height="' + H + '" fill="' + c.bg + '"/>';
  if (art !== 'full') s += '<rect x="' + box.x + '" y="' + box.y + '" width="' + box.w + '" height="' + box.h + '" fill="' + c.panel + '"/>';
  s += '<g clip-path="url(#' + p + 'a)">' + motif(box, c, rnd) + '</g>';
  // Text block: label, title (wrapped by an estimate of the face's average glyph width; shrinks to fit), author.
  const txtTop = wide ? H * 0.3 : art === 'top' ? box.y + box.h + pad * 0.9 : pad * 1.25;
  const avail = wide ? H * 0.62 : art === 'full' ? H * 0.42 : art === 'top' ? H - box.h - pad * 2.4 : box.y - pad * 2.2;
  const textW = wide ? box.x - pad * 1.6 : W - pad * 2;
  const fk = o.fontTitle || o.font || 'serif';
  const fam = F[fk] || F.serif;
  const famSmall = F[o.font] || F.sans;
  const em = ({ serif: 0.6, display: 0.56, slab: 0.62, sans: 0.57, condensed: 0.48, mono: 0.62 }[fk] || 0.58) + (o.caps ? 0.08 : 0);
  const title = o.caps ? String(o.title || '').toUpperCase() : String(o.title || '');
  let fs = o.titleSize || U * (square || wide ? 0.085 : 0.1);
  let lines = [];
  for (let k = 0; k < 8; k++) {
    lines = tplLibWrap(title, Math.max(6, Math.floor(textW / (fs * em))));
    if (lines.length * fs * 1.12 + U * 0.13 <= avail && lines.length <= 4 && lines.every((l) => l.length * fs * em <= textW * 1.04)) break;
    fs *= 0.88;
  }
  const anchor = o.align === 'center' && !wide ? 'middle' : 'start';
  const tx = anchor === 'middle' ? W / 2 : pad;
  const ink = o.textInk || c.ink;
  let y = txtTop;
  let t = '';
  if (o.label) {
    t += '<text x="' + tplLibN(tx) + '" y="' + tplLibN(y) + '" font-family="' + famSmall + '" font-size="' + tplLibN(U * 0.034) + '" font-weight="700" letter-spacing="' + tplLibN(U * 0.006) + '" fill="' + (o.labelInk || c.accent) + '" text-anchor="' + anchor + '">' + escapeHTML(String(o.label).toUpperCase()) + '</text>';
    y += U * 0.075;
  }
  for (const line of lines) {
    y += fs;
    t += '<text x="' + tplLibN(tx) + '" y="' + tplLibN(y) + '" font-family="' + fam + '" font-size="' + tplLibN(fs) + '" font-weight="' + (o.weight || 700) + '"' + (o.italic ? ' font-style="italic"' : '') + ' fill="' + ink + '" text-anchor="' + anchor + '"' + (o.caps ? ' letter-spacing="' + tplLibN(fs * 0.04) + '"' : '') + '>' + escapeHTML(line) + '</text>';
    y += fs * 0.12;
  }
  if (o.author) {
    y += U * 0.06;
    t += '<text x="' + tplLibN(tx) + '" y="' + tplLibN(y) + '" font-family="' + famSmall + '" font-size="' + tplLibN(U * 0.045) + '" font-weight="500" fill="' + ink + '" opacity=".85" text-anchor="' + anchor + '">' + escapeHTML(o.author) + '</text>';
  }
  if (art === 'full') t = '<rect x="0" y="0" width="' + W + '" height="' + tplLibN(y + pad) + '" fill="' + c.bg + '" opacity=".82"/>' + t;
  s += t;
  if (o.mark) {
    const r = U * 0.065, mx = W - pad - r, my = art === 'top' ? box.y + box.h - pad * 0.6 - r : H - pad * 0.6 - r;
    s += '<circle cx="' + tplLibN(mx) + '" cy="' + tplLibN(my) + '" r="' + tplLibN(r) + '" fill="' + c.ink + '"/><text x="' + tplLibN(mx) + '" y="' + tplLibN(my + r * 0.36) + '" font-family="' + famSmall + '" font-size="' + tplLibN(r * 1.02) + '" font-weight="700" fill="' + c.bg + '" text-anchor="middle">' + escapeHTML(o.mark) + '</text>';
  }
  // Thin inner frame and a soft sheen.
  s += '<rect x="' + tplLibN(U * 0.03) + '" y="' + tplLibN(U * 0.03) + '" width="' + tplLibN(W - U * 0.06) + '" height="' + tplLibN(H - U * 0.06) + '" fill="none" stroke="' + ink + '" stroke-opacity=".18"/>';
  s += '<rect width="' + W + '" height="' + H + '" fill="url(#' + p + 'g)"/>';
  return s + '</svg>';
}

/**
 * Cover mock-up (4:3 picture for wide cards): the cover standing on a surface with a page edge and a soft shadow.
 * o = cover options + {sceneBg ['#hex', '#hex'] (backdrop gradient), floor '#hex', disc '#hex' (a large circle behind)}.
 */
function tplLibMockup(o) {
  const W = 800, H = 600, cw = 270, ch = 405, x = W * 0.5 - cw * 0.62, y = H * 0.84 - ch;
  const cover = tplLibCover({ ...o, w: 400, h: 600, idp: 'm' }).replace(TPL_ART_SVG + 'viewBox="0 0 400 600" width="400" height="600"',
    '<svg x="' + tplLibN(x) + '" y="' + tplLibN(y) + '" width="' + cw + '" height="' + ch + '" viewBox="0 0 400 600"');
  const bg = o.sceneBg || ['#efe6d4', '#dccfb4'];
  return TPL_ART_SVG + 'viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '"><defs>' +
    '<linearGradient id="sb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + bg[0] + '"/><stop offset="1" stop-color="' + bg[1] + '"/></linearGradient>' +
    '<radialGradient id="sh"><stop offset="0" stop-color="#000" stop-opacity=".38"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>' +
    '<linearGradient id="sp" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".28"/><stop offset=".5" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>' +
    '</defs><rect width="' + W + '" height="' + H + '" fill="url(#sb)"/>' +
    (o.disc ? '<circle cx="' + tplLibN(W * 0.66) + '" cy="' + tplLibN(H * 0.4) + '" r="' + tplLibN(H * 0.34) + '" fill="' + o.disc + '" opacity=".9"/>' : '') +
    '<rect y="' + tplLibN(H * 0.84) + '" width="' + W + '" height="' + tplLibN(H * 0.16) + '" fill="' + (o.floor || '#cbbd9f') + '"/>' +
    '<ellipse cx="' + tplLibN(x + cw * 0.62) + '" cy="' + tplLibN(H * 0.845) + '" rx="' + tplLibN(cw * 0.78) + '" ry="16" fill="url(#sh)"/>' +
    '<path d="M' + tplLibN(x + cw) + ' ' + tplLibN(y + 4) + 'l18 10v' + tplLibN(ch - 6) + 'l-18 -4z" fill="#f4efe4"/>' +
    '<path d="M' + tplLibN(x + cw + 4) + ' ' + tplLibN(y + 14) + 'v' + tplLibN(ch - 24) + 'M' + tplLibN(x + cw + 9) + ' ' + tplLibN(y + 17) + 'v' + tplLibN(ch - 26) + 'M' + tplLibN(x + cw + 14) + ' ' + tplLibN(y + 20) + 'v' + tplLibN(ch - 28) + '" stroke="#d8cfbd" stroke-width="1"/>' +
    cover + '<rect x="' + tplLibN(x) + '" y="' + tplLibN(y) + '" width="16" height="' + ch + '" fill="url(#sp)"/></svg>';
}

/* ---------- gentle tonal sketches (WAV, mono, 22 050 Hz, 16-bit PCM) ---------- */
// Stand-ins for narration (speech cannot be synthesized here): a soft pad, a bell or plucked motif and a low hum,
// seeded per chapter, with a light reverb, normalized to -3 dBFS and faded in / out.

const TPL_LIB_SR = 22050;

function tplLibHz(root, mode, deg) {
  const n = mode.length, o = Math.floor(deg / n), i = ((deg % n) + n) % n;
  return root * Math.pow(2, (mode[i] + 12 * o) / 12);
}

const TPL_LIB_MODES = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11], penta: [0, 2, 4, 7, 9],
};

const TPL_LIB_VOICES = {
  // Struck bell: inharmonic partials with independent decays.
  bell(x, at, f, dur, amp) {
    const P = [[1, 1, 2.6], [2.01, 0.42, 3.8], [2.76, 0.28, 5.2], [4.07, 0.12, 7.5], [5.4, 0.06, 9]];
    const len = Math.min(x.length - at, Math.round((dur + 1.4) * TPL_LIB_SR));
    for (let i = 0; i < len; i++) {
      const t = i / TPL_LIB_SR, a = Math.min(1, i / 60);
      let s = 0;
      for (const [k, g, d] of P) s += g * Math.exp(-t * d) * Math.sin(2 * Math.PI * f * k * t);
      x[at + i] += s * amp * a * 0.55;
    }
  },
  // Plucked string (Karplus–Strong), softened.
  pluck(x, at, f, dur, amp, rnd) {
    const N = Math.max(2, Math.round(TPL_LIB_SR / f));
    const buf = new Float32Array(N);
    let last = 0;
    for (let i = 0; i < N; i++) { last = last * 0.55 + (rnd() * 2 - 1) * 0.45; buf[i] = last; }
    const len = Math.min(x.length - at, Math.round((dur + 0.8) * TPL_LIB_SR));
    let k = 0;
    for (let i = 0; i < len; i++) {
      const a = buf[k], b = buf[(k + 1) % N];
      buf[k] = (a + b) * 0.496;
      x[at + i] += a * amp * (i > len - 600 ? (len - i) / 600 : 1);
      k = (k + 1) % N;
    }
  },
  // Warm pad: three slightly detuned sines + a quiet octave, slow attack and release, gentle tremolo.
  pad(x, at, f, dur, amp) {
    const len = Math.min(x.length - at, Math.round(dur * TPL_LIB_SR));
    const att = Math.min(len / 2, 0.45 * TPL_LIB_SR), rel = Math.min(len / 2, 0.6 * TPL_LIB_SR);
    const ph = [0, 0, 0, 0], fr = [f, f * 1.0035, f * 0.9965, f * 2];
    for (let i = 0; i < len; i++) {
      const t = i / TPL_LIB_SR;
      for (let k = 0; k < 4; k++) ph[k] += (2 * Math.PI * fr[k]) / TPL_LIB_SR;
      const e = Math.min(1, i / att, (len - i) / rel) * (1 + 0.08 * Math.sin(2 * Math.PI * 3.1 * t));
      x[at + i] += (Math.sin(ph[0]) + Math.sin(ph[1]) + Math.sin(ph[2]) + 0.25 * Math.sin(ph[3])) * amp * 0.3 * e;
    }
  },
  // Low hum (drone) with a breathy edge.
  hum(x, at, f, dur, amp, rnd) {
    const len = Math.min(x.length - at, Math.round(dur * TPL_LIB_SR));
    const att = Math.min(len / 2, 0.6 * TPL_LIB_SR);
    let ph = 0, nz = 0;
    for (let i = 0; i < len; i++) {
      ph += (2 * Math.PI * f) / TPL_LIB_SR;
      nz = nz * 0.97 + (rnd() * 2 - 1) * 0.03;
      const e = Math.min(1, i / att, (len - i) / att);
      x[at + i] += (Math.sin(ph) + 0.3 * Math.sin(2 * ph) + nz * 2) * amp * 0.5 * e;
    }
  },
  // Glassy chime: a high sine pair with a long tail.
  chime(x, at, f, dur, amp) {
    const len = Math.min(x.length - at, Math.round((dur + 1.8) * TPL_LIB_SR));
    for (let i = 0; i < len; i++) {
      const t = i / TPL_LIB_SR;
      x[at + i] += (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(2 * Math.PI * f * 3.01 * t) * Math.exp(-t * 4)) * Math.exp(-t * 1.6) * amp * 0.5 * Math.min(1, i / 40);
    }
  },
};

/** Light Schroeder reverb in place (4 combs + 2 all-passes). */
function tplLibReverb(x, wet) {
  const k = TPL_LIB_SR / 44100;
  const combs = [1116, 1188, 1277, 1356].map((d) => ({ b: new Float32Array(Math.round(d * k)), i: 0, f: 0 }));
  const aps = [556, 441].map((d) => ({ b: new Float32Array(Math.round(d * k)), i: 0 }));
  for (let n = 0; n < x.length; n++) {
    const inp = x[n] * 0.25;
    let s = 0;
    for (const c of combs) {
      const y = c.b[c.i];
      c.f = y * 0.7 + c.f * 0.3;
      c.b[c.i] = inp + c.f * 0.82;
      c.i = (c.i + 1) % c.b.length;
      s += y;
    }
    for (const a of aps) {
      const y = a.b[a.i], v = s + y * 0.5;
      a.b[a.i] = v;
      a.i = (a.i + 1) % a.b.length;
      s = y - v * 0.5;
    }
    x[n] = x[n] * (1 - wet * 0.5) + s * wet;
  }
}

/** 16-bit mono PCM WAV bytes (base64) from float samples. */
function tplLibWavB64(x) {
  const n = x.length;
  const bytes = new Uint8Array(44 + n * 2);
  const v = new DataView(bytes.buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, TPL_LIB_SR, true);
  v.setUint32(28, TPL_LIB_SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-32767, Math.min(32767, Math.round(x[i] * 32767))), true);
  return b64encode(bytes);
}

/**
 * Render notes → WAV base64. spec = {seed, sec, bpm, root (Hz), mode (TPL_LIB_MODES key or semitone list), wet,
 * notes: [[beat, voice, degree, beats, amp], …]}.
 */
function tplLibWav(spec) {
  const sec = spec.sec || 2;
  const x = new Float32Array(Math.round(sec * TPL_LIB_SR));
  const rnd = tplRand(tplHash('wav:' + spec.seed));
  const mode = Array.isArray(spec.mode) ? spec.mode : TPL_LIB_MODES[spec.mode] || TPL_LIB_MODES.major;
  const beat = 60 / (spec.bpm || 90);
  for (const [b, voice, deg, len, amp] of spec.notes) {
    const at = Math.round(b * beat * TPL_LIB_SR);
    if (at >= x.length || !TPL_LIB_VOICES[voice]) continue;
    TPL_LIB_VOICES[voice](x, at, tplLibHz(spec.root || 220, mode, deg), len * beat, amp ?? 0.5, rnd);
  }
  tplLibReverb(x, spec.wet ?? 0.3);
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  const g = peak > 0 ? 0.7 / peak : 1;
  const fi = Math.round(0.03 * TPL_LIB_SR), fo = Math.round(Math.min(0.5, sec / 3) * TPL_LIB_SR);
  for (let i = 0; i < x.length; i++) {
    let e = 1;
    if (i < fi) e = i / fi;
    else if (i > x.length - fo) e = (x.length - i) / fo;
    x[i] *= g * e;
  }
  return tplLibWavB64(x);
}

/**
 * A chapter sketch from a seed: a pad chord, a seeded motif on `lead` (bell | pluck | chime) that comes home to the
 * root, a low hum. o = {seed, sec (≈2), root, mode, bpm, lead, chord ([degrees]), hum (bool), notes (motif length)}.
 * Same `root` / `mode` / `lead` across the chapters of one item keep its colour; the seed varies the melody.
 */
function tplLibSketch(o) {
  const rnd = tplRand(tplHash('motif:' + o.seed));
  const bpm = o.bpm || 96, sec = o.sec || 2, beats = (sec * bpm) / 60;
  const notes = [];
  for (const d of o.chord || [0, 2, 4]) notes.push([0, 'pad', d - 7, beats, 0.34]);
  if (o.hum !== false) notes.push([0, 'hum', -14, beats, 0.22]);
  const n = o.notes || 5;
  const step = Math.max(0.5, Math.min(1, (beats - 1.2) / n));
  let deg = Math.floor(rnd() * 5);
  for (let i = 0; i < n; i++) {
    const last = i === n - 1;
    if (last) deg = rnd() < 0.6 ? 7 : 4;
    notes.push([0.15 + i * step, o.lead || 'bell', deg, step * (last ? 2 : 1), last ? 0.5 : 0.36 + rnd() * 0.1]);
    deg = Math.max(0, Math.min(9, deg + [-2, -1, 1, 2, 3][Math.floor(rnd() * 5)]));
  }
  return tplLibWav({ seed: o.seed, sec, bpm, root: o.root || 220, mode: o.mode || 'major', wet: o.wet ?? 0.32, notes });
}

/* ---------- isometric furniture specs for tplIsoScene (templates-art.js) ---------- */

/** Paint triple [top, +y face, +x face] from one colour. */
const tplLibPaint = (hex) => [tplArtMix(hex, '#ffffff', 0.28), hex, tplArtMix(hex, '#000000', 0.3)];

/**
 * Bookcase against a wall, books standing on its shelves. o = {at: [x, y, z], w (length), h, d (depth), shelves (n),
 * seed, wood (paint), colors ['#hex', …], gaps (0..1 share of empty slots), bw: [min, max] book thickness, face: 'y' (front faces +y, runs along x)
 * | 'x' (front faces +x, runs along y)}.
 */
function tplLibBookcase(o) {
  const [X, Y, Z] = o.at || [0, 0, 0];
  const w = o.w || 40, h = o.h || 30, d = o.d || 6, n = o.shelves || 4;
  const wood = o.wood || 'wood';
  const rnd = tplRand(tplHash('case:' + (o.seed || 'x')));
  const cols = (o.colors || ['#8c2f39', '#1f5c72', '#c9a13b', '#2f5d46', '#d8cdb5', '#5a4a7a', '#b8552e']).map(tplLibPaint);
  // Local box (u along the case, v into the room) → scene box.
  const bx = o.face === 'x' ? (u, v, z, lu, lv, lz, c) => ({ box: [X + v, Y + u, z, lv, lu, lz], c }) : (u, v, z, lu, lv, lz, c) => ({ box: [X + u, Y + v, z, lu, lv, lz], c });
  const s = [bx(0, 0, Z, w, 0.8, h, wood), bx(0, 0, Z, 1, d, h, wood)];
  const sh = (h - 1) / n;
  for (let k = 0; k < n; k++) {
    const z = Z + k * sh;
    s.push(bx(1, 0, z, w - 2, d, 0.9, wood));
    let u = 1.4;
    while (u < w - 2.6) {
      const bw = (o.bw ? o.bw[0] : 0.8) + rnd() * (o.bw ? o.bw[1] - o.bw[0] : 1.1);
      if (rnd() < (o.gaps ?? 0.08)) { u += bw * 1.6; continue; }
      const bh = Math.min(sh - 1.6, sh * (0.62 + rnd() * 0.26));
      s.push(bx(u, 0.9, z + 0.9, bw, d - 1.6 - rnd() * 0.8, bh, cols[Math.floor(rnd() * cols.length)]));
      u += bw + 0.05;
    }
  }
  s.push(bx(1, 0, Z + h - 0.9, w - 2, d, 0.9, wood), bx(w - 1, 0, Z, 1, d, h, wood));
  return s;
}

/** Table with a lamp and an open book. o = {at: [x, y], w, d, h, wood, lamp ('#hex' shade) | '', glow (bool)}. */
function tplLibTable(o) {
  const [X, Y] = o.at || [0, 0];
  const w = o.w || 24, d = o.d || 12, h = o.h || 7.5, wood = o.wood || 'wood';
  const s = [{ shadow: [X, Y, X + w, Y + d] }];
  for (const [lx, ly] of [[X + 0.6, Y + 0.6], [X + w - 1.6, Y + 0.6], [X + 0.6, Y + d - 1.6], [X + w - 1.6, Y + d - 1.6]]) s.push({ box: [lx, ly, 0, 1, 1, h - 0.8], c: wood });
  s.push({ box: [X, Y, h - 0.8, w, d, 0.8], c: wood });
  s.push({ box: [X + w * 0.3, Y + d * 0.35, h, 3.2, 4.4, 0.3], c: 'paper' }, { box: [X + w * 0.3 + 3.3, Y + d * 0.35, h, 3.2, 4.4, 0.3], c: 'paper' });
  if (o.lamp !== '') {
    const lx = X + w * 0.78, ly = Y + d * 0.3;
    s.push({ cyl: [lx, ly, h], axis: 'z', r: 1.4, len: 0.4, c: 'brass' }, { cyl: [lx, ly, h + 0.4], axis: 'z', r: 0.22, len: 5, c: 'brass' },
      { cyl: [lx, ly, h + 4.6], axis: 'z', r: 2.6, r1: 1.2, len: 2.2, c: tplLibPaint(o.lamp || '#2f5d46') });
    if (o.glow) s.push({ glow: [lx, ly, h + 2], rx: 14, ry: 8, c0: '#fff3c4', c1: '#f2c45a', a: 0.5 });
  }
  return s;
}

/** Simple chair; the back stands on the far ('x' | 'y') or the near ('-x' | '-y') side. o = {at: [x, y], dir, c}. */
function tplLibChair(o) {
  const [X, Y] = o.at;
  const c = o.c || 'wood';
  const s = [{ box: [X, Y, 0, 0.6, 0.6, 4], c }, { box: [X + 4, Y, 0, 0.6, 0.6, 4], c }, { box: [X, Y + 4, 0, 0.6, 0.6, 4], c }, { box: [X + 4, Y + 4, 0, 0.6, 0.6, 4], c }];
  s.push({ box: [X, Y, 4, 4.6, 4.6, 0.6], c });
  const back = { y: [X, Y, 4.6, 4.6, 0.6, 5], '-y': [X, Y + 4, 4.6, 4.6, 0.6, 5], x: [X, Y, 4.6, 0.6, 4.6, 5], '-x': [X + 4, Y, 4.6, 0.6, 4.6, 5] };
  s.push({ box: back[o.dir] || back.y, c });
  return s;
}

/* ==========================================================================
   Template content
   ========================================================================== */

// ----- text editions (original pastiches; Markdown, one plain-text verse file) -----

const TPL_LIB_TEXTS = {
  gull: `
# The Lamp at Gull Point

*Edith Marlowe · 1904*

## I. The Keeper’s Daughter

Nobody on the north shore remembered a winter without the lamp. It turned above Gull Point every night from the first grey of evening to the last grey of morning, and the fishermen of Carrow set their watches by it more readily than by the church clock, which was known to lose a quarter of an hour every Sunday.

Annis Rook was eleven the year her father’s eyes began to fail. She did not say so to anyone, and neither did he; but it was Annis who climbed the hundred and four steps at dusk with the oil can knocking against her knees, Annis who trimmed the wicks with the small brass scissors, and Annis who sat in the lantern room until the light had made its first slow circle over the water and she could be sure it would go on making it without her.

## II. A Ship Without Lights

On the night of the great November gale she saw a shape where no shape should be — a darkness moving against the darkness, low and heavy, beyond the rocks the village called *the Teeth*. It showed no lamp at its masthead and none at its stern.

“Father,” she called down the stairwell, and then, because the wind took the word away, she called it again. He came up slowly, one hand on the rail, and stood beside her with his useless eyes turned to the sea. “Tell me what you see,” he said, “and tell it plain.”

## III. Morning

By morning the gale had blown itself out to the east, and the bay lay flat and pale as a plate of pewter. Seven men came up the path from the shingle, wet to the shoulders, and the first of them took off his cap at the door.

“We saw your lamp,” he said. “We thought it had gone out, and then it came back brighter.” Annis did not tell him that she had turned the wick as high as it would go and held it there with both hands until the glass blackened. She only nodded, and put the kettle on.
`,
  bullfinch: `
# Снегири над Вербной

*Аркадий Ледников · 1912*

## I. Станция

Поезд пришёл на Вербную в шестом часу, когда снег уже синел и в окне станционного буфета зажгли лампу. Сошёл один пассажир — высокий, в старой шинели без погон, с фанерным чемоданом, перевязанным бечёвкой. Начальник станции посмотрел на него из-за двери, решил, что это землемер или учитель, и не вышел.

Пассажир постоял на платформе, послушал, как уходит поезд, — сначала стук, потом гудок, потом одна только тишина, — и пошёл по дороге к селу. Над дорогой, на голых ветлах, сидели снегири, красные, как угольки в остывшей печи, и не улетали.

## II. Письмо

В селе его не ждали, хотя письмо было отправлено ещё в октябре. Письмо лежало у старосты, нераспечатанное, между псалтырью и счётами: староста грамоте разумел плохо и всё откладывал, пока не приедет сын из уезда.

— Вы, стало быть, Николай Петрович, — сказал староста, щурясь на чемодан. — А мы думали, вы весной. Школа-то у нас холодная.

— Ничего, — ответил приезжий. — Печь я сложить умею. А дети пусть приходят завтра, к девяти. И пусть каждый принесёт по полену.
`,
  gate: `
# Зелена брама

*Орися Калинович · оповідання · 1928*

## Зелена брама

Браму пофарбував ще дід, і відтоді її фарбували тільки в зелене — так, ніби інший колір міг накликати біду. Щовесни мати виносила на подвір’я бляшанку з фарбою, і щовесни сусіди казали, що зелена брама — то якось не по-людськи, бо в усіх брами сині.

Ганнуся довго не розуміла, навіщо сперечатися через фарбу. Зрозуміла тієї осені, коли батько не повернувся з ярмарку, а вночі хтось тихо постукав у браму — тричі, як стукав тільки він. Мати не відчинила. Вона стояла біля вікна, дивилася, як місяць срібнить зелені дошки, і сказала тільки: «Це не він. Він знає, що брама не замкнена».

## Сіль

Сіль у хаті тримали в дерев’яній сільничці з різьбленою кришкою, і брати її дозволялося лише дорослим. Хто розсипав сіль — той, казала баба, розсипав сварку.

Коли до хати вперше прийшов Петрів наречений, Ганнуся, хвилюючись, перекинула сільничку просто на вишитий обрус. Усі завмерли. Тоді наречений узяв дрібку солі, кинув собі через ліве плече і всміхнувся: «Ну от, тепер сварка вже позаду».
`,
  salt: `
SONGS OF THE SALT ROAD
Thomas Avery Lane, 1897


THE CARTERS

Before the larks, before the light,
the salt carts leave the shore;
the wheels are wet, the loads are white,
the road is what it was before.

They sing to keep the horses warm,
they sing to keep themselves awake,
and every song outlasts a storm,
and every storm is a mistake.


MILESTONE

Here someone cut a number in the stone
and walked away, and never came this way again.
The number stayed. The moss has made it its own.
I count it anyway: eleven miles from rain.


THE INN AT DUSK

A lamp, a door, a dog that does not bark,
a bowl of broth, a bench beside the fire —
the road gives back at nightfall, in the dark,
a little of the distance it requires.
`,
  clock: `
# The Clockmaker’s Apprentice

*Mabel Finch · 1921 · with pictures by the author*

## 1. Tobias and the Silent Clock

In the town of Pellingham there was a clock in every window of Mr Quarrender’s shop, and every one of them told a different time. “That is so that nobody is ever late,” Mr Quarrender explained, “and nobody is ever early, either. It is a great kindness to people.”

Tobias had come to the shop to learn how clocks were mended. On his first morning Mr Quarrender gave him a cup of cocoa, a feather duster and one small grey clock that did not tick at all. “This one,” he said, “has forgotten what it is for. Your job is to remind it.”

## 2. The Key Under the Stair

Tobias tried everything. He oiled the little wheels, he polished the face, he even sang to it, which made the cat leave the room. The grey clock stayed silent.

On the fourth day he found, under the bottom stair, a key no longer than his little finger, with a bow shaped like a sleeping moon. It fitted the grey clock exactly. When he turned it, the clock gave one deep, astonished *tock* — and then, very politely, it began to tell the right time, which none of the others in the shop had ever done.
`,
  garden: `
# Записки садовника

*Пётр Овсянников · 1915*

## О терпении

Сад учит терпению вернее любого учителя. Яблоню сажают не для себя, а для того, кто придёт после; первое яблоко с моей я снял через одиннадцать лет, и было оно кислое, мелкое и самое вкусное на свете.

Соседи смеются, что я разговариваю с деревьями. Я не разговариваю — я слушаю. Дерево всегда говорит правду: если ему плохо, оно скажет это листом, корой, поздним цветом. Человек же, бывает, молчит до последнего.

## Апрель

В апреле сад похож на дом перед праздником: всё прибрано, всё ждёт. Грачи уже прилетели и спорят на берёзах, под крыльцом проснулась жаба, а в парнике, под старыми рамами, взошли огурцы — бледные, кривые, упрямые.

Я хожу между грядками с лейкой и записываю в тетрадь: «Седьмого — тепло, ветер с юга. Вишня набухла. Скворец у сарая». Через сто лет эти строчки, может быть, никто не прочтёт. Но вишня будет цвести и без них.
`,
  mill: `
# Казки старого млина

*Ярема Довгань · 1909*

## Як млин навчився співати

Стояв над річкою старий млин, і був він сумний, бо не вмів співати. Жаби співали, соловейко співав, навіть мірошник, коли мав добрий настрій, мугикав собі під вуса. А млин тільки рипів.

Якось уночі до млина прилетів вітер і спитав, чого той такий понурий. «Хочу співати, — зітхнув млин, — а виходить саме рипіння». — «То дай мені свої крила», — сказав вітер. Млин розправив крила, вітер дмухнув — і над річкою полинула пісня, тиха й рівна, як хліб, що підходить у діжі.

## Мишка-мірошничка

У тому ж млині жила мишка, така маленька, що її ніхто не помічав. Щоночі вона підбирала розсипані зернятка і складала їх у торбинку з наперстка.

Узимку, коли річка замерзла і млин зупинився, у селі скінчилося борошно. Тоді мишка витягла свою торбинку — і виявилося, що за рік вона назбирала стільки зерна, що вистачило на цілу паляницю. Ту паляницю спекли на Святвечір і розділили на всіх, і кожному дісталося по шматочку, і ще трохи — мишці.
`,
  weather: `
# A Field Guide to Small Weather

*Harriet Quill · 1926*

## On Fog

There is a kind of fog that belongs to one field only. You may walk out of it in twenty paces and turn round and see it lying there, white and folded, like a sheet left out to dry by somebody who has gone indoors for a moment and will be back. I have never once seen the somebody.

Fog of this sort is not weather in the grand manner. It does not trouble the newspapers. It troubles only cows, who stand in it up to their shoulders looking embarrassed, and small boys, who are not troubled at all.

## On the First Snow

The first snow never falls when it is expected. It waits until you have gone to bed certain that it will not come, and then it comes quietly, the way a cat comes into a room.

In the morning the world has been rubbed out and drawn again in a simpler hand. The hedges are only the idea of hedges; the road is a suggestion. It is the one morning in the year when everybody, without exception, goes to the window first.
`,
  envelope: `
# Справа про синій конверт

*Богдан Ясень · детективна повість · 1934*

## I. Лист без марки

Синій конверт приніс не листоноша. Його знайшла під дверима пані Стефа, прибиральниця, о сьомій ранку, коли в редакції «Вечірнього кур’єра» ще пахло вчорашнім тютюном. Ні марки, ні штемпеля — лише адреса, виведена рівним учительським почерком: «Панові Левкові Гаю, особисто».

Левко Гай, репортер відділу пригод, прочитав лист двічі, потім сховав його до кишені й попросив у секретаря редакції розклад потягів.

## II. Потяг о 6:40

У купе другого класу їхало троє: літня пані з кошиком, у якому щось нявкало, молодик у новому капелюсі і чоловік, що весь час дивився у вікно. Гай сів навпроти нього й розгорнув газету.

— Ви теж до кінцевої? — спитав він, не підводячи очей.

— Ні, — відповів чоловік. — Я виходжу раніше.

І тільки тоді Гай помітив на його рукаві синю пляму — від чорнила, яким пишуть адреси на конвертах.
`,
};

// Facsimile sample (ASCII PDF) of the children's book.
const TPL_LIB_FACSIMILE = [
  "> Mabel Finch - The Clockmaker's Apprentice - first edition, 1921 - facsimile sample",
  '',
  '# Chapter 1. Tobias and the Silent Clock',
  "In the town of Pellingham there was a clock in every window of Mr Quarrender's shop, and every one of them told a",
  'different time. "That is so that nobody is ever late," Mr Quarrender explained, "and nobody is ever early, either."',
  '',
  'Tobias had come to the shop to learn how clocks were mended. On his first morning Mr Quarrender gave him a cup of',
  'cocoa, a feather duster and one small grey clock that did not tick at all.',
  '',
  '# Plates in this edition',
  '- Frontispiece: the shop window at dusk',
  '- Plate II: the key under the stair',
  '- Plate III: forty clocks striking noon',
  '',
  '> Sample page generated by the landing template. Lindgrove City Library, special collections. All names are fictional.',
];

// ----- catalogue data (subject lives in attributes and files, never in block fields) -----

const TPL_LIB_LANG = {
  en: tplLibT('English', 'Английский', 'Англійська'),
  ru: tplLibT('Russian', 'Русский', 'Російська'),
  uk: tplLibT('Ukrainian', 'Украинский', 'Українська'),
};

// Book: key, title (original, every language), author, lang, genre, age, year, pages, tags, html, cover (tplLibCover
// options), text {file, mime, label}, audio {narrator, duration, root, mode, lead, chapters} | null, pdf (bool).
const TPL_LIB_BOOKS = [
  {
    key: 'gull', title: 'The Lamp at Gull Point', lang: 'en', age: '12+', year: '1904', pages: '286',
    author: tplLibT('Edith Marlowe', 'Эдит Марлоу', 'Едіт Марлоу'),
    genre: tplLibT('Novel', 'Роман', 'Роман'),
    tags: tplLibT('sea, lighthouse, family, storm', 'море, маяк, семья, шторм', 'море, маяк, родина, шторм'),
    html: tplLibP('An eleven-year-old keeps her failing father’s lighthouse burning through the great November gale. A quiet, salt-bitten classic of the north shore.',
      'Одиннадцатилетняя девочка тайком поддерживает огонь маяка за слепнущего отца — и в великий ноябрьский шторм. Тихая, просоленная классика северного берега.',
      'Одинадцятирічна дівчинка потай підтримує вогонь маяка замість батька, що втрачає зір, — навіть у великий листопадовий шторм. Тиха, просолена класика північного берега.'),
    cover: { motif: 'beam', bg: '#173f4d', ink: '#f3ead8', accent: '#e3a63c', font: 'sans', fontTitle: 'serif', art: 'bottom', label: 'A Novel' },
    text: { file: 'the-lamp-at-gull-point.md', mime: 'text/markdown' },
    audio: {
      narrator: tplLibT('Clara Penhallow', 'Клара Пенхаллоу', 'Клара Пенхаллоу'), duration: tplLibT('7 h 40 min', '7 ч 40 мин', '7 год 40 хв'),
      root: 196, mode: 'major', lead: 'bell',
      chapters: [tplLibT('I. The Keeper’s Daughter', 'I. Дочь смотрителя', 'I. Донька доглядача'), tplLibT('II. A Ship Without Lights', 'II. Корабль без огней', 'II. Корабель без вогнів'), tplLibT('III. Morning', 'III. Утро', 'III. Ранок')],
    },
  },
  {
    key: 'bullfinch', title: 'Снегири над Вербной', lang: 'ru', age: '12+', year: '1912', pages: '164',
    author: tplLibT('Arkady Lednikov', 'Аркадий Ледников', 'Аркадій Ледников'),
    genre: tplLibT('Novella', 'Повесть', 'Повість'),
    tags: tplLibT('winter, village, school, teacher', 'зима, деревня, школа, учитель', 'зима, село, школа, учитель'),
    html: tplLibP('A new teacher steps off the evening train at a snowed-in halt and promises a village a warm school by morning.',
      'Новый учитель сходит с вечернего поезда на занесённой снегом станции и обещает селу тёплую школу к утру.',
      'Новий учитель сходить із вечірнього потяга на засніженій станції й обіцяє селу теплу школу до ранку.'),
    cover: { motif: 'stars', bg: '#efe6d6', ink: '#2c3440', accent: '#b8342c', font: 'serif', fontTitle: 'serif', art: 'bottom', label: 'Повесть' },
    text: { file: 'snegiri-nad-verbnoy.md', mime: 'text/markdown' },
    audio: {
      narrator: tplLibT('Miron Zvyagintsev', 'Мирон Звягинцев', 'Мирон Звягінцев'), duration: tplLibT('4 h 15 min', '4 ч 15 мин', '4 год 15 хв'),
      root: 174.61, mode: 'minor', lead: 'pluck',
      chapters: [tplLibT('I. The Station', 'I. Станция', 'I. Станція'), tplLibT('II. The Letter', 'II. Письмо', 'II. Лист')],
    },
  },
  {
    key: 'gate', title: 'Зелена брама', lang: 'uk', age: '16+', year: '1928', pages: '212',
    author: tplLibT('Orysia Kalynovych', 'Орыся Калинович', 'Орися Калинович'),
    genre: tplLibT('Short stories', 'Рассказы', 'Оповідання'),
    tags: tplLibT('village, family, folk beliefs', 'деревня, семья, народные поверья', 'село, родина, народні вірування'),
    html: tplLibP('Stories of a village where the gate is painted green every spring — and of the rules, salt and silences that hold a family together.',
      'Рассказы о селе, где ворота каждую весну красят в зелёный, — и о приметах, соли и молчании, на которых держится семья.',
      'Оповідання про село, де браму щовесни фарбують у зелене, — і про прикмети, сіль та мовчання, на яких тримається родина.'),
    cover: { motif: 'arches', bg: '#e9e1cc', ink: '#24423a', accent: '#3f7d5c', font: 'sans', fontTitle: 'serif', art: 'bottom', label: 'Оповідання' },
    text: { file: 'zelena-brama.md', mime: 'text/markdown' },
  },
  {
    key: 'salt', title: 'Songs of the Salt Road', lang: 'en', age: '12+', year: '1897', pages: '96',
    author: tplLibT('Thomas Avery Lane', 'Томас Эйвери Лейн', 'Томас Ейвері Лейн'),
    genre: tplLibT('Poetry', 'Поэзия', 'Поезія'),
    tags: tplLibT('road, travel, ballads', 'дорога, путешествие, баллады', 'дорога, подорож, балади'),
    html: tplLibP('Walking songs of the carters who hauled salt inland before the railway: milestones, inns at dusk and the weather of the road.',
      'Дорожные песни возчиков, что возили соль вглубь страны до железной дороги: верстовые камни, трактиры в сумерках и погода пути.',
      'Дорожні пісні візників, що возили сіль углиб країни до залізниці: верстові камені, корчми в сутінках і погода шляху.'),
    cover: { motif: 'waves', bg: '#f2ece0', ink: '#22303c', accent: '#c0812a', font: 'sans', fontTitle: 'serif', art: 'bottom', label: 'Poems', italic: true },
    text: { file: 'songs-of-the-salt-road.txt', mime: 'text/plain' },
    audio: {
      narrator: tplLibT('Clara Penhallow', 'Клара Пенхаллоу', 'Клара Пенхаллоу'), duration: tplLibT('1 h 5 min', '1 ч 5 мин', '1 год 5 хв'),
      root: 220, mode: 'dorian', lead: 'pluck',
      chapters: [tplLibT('The Carters', 'Возчики', 'Візники'), tplLibT('Milestone · The Inn at Dusk', 'Верстовой камень · Трактир в сумерках', 'Верстовий камінь · Корчма в сутінках')],
    },
  },
  {
    key: 'clock', title: 'The Clockmaker’s Apprentice', lang: 'en', age: '6+', year: '1921', pages: '128',
    author: tplLibT('Mabel Finch', 'Мейбл Финч', 'Мейбл Фінч'),
    genre: tplLibT('Children’s', 'Детская', 'Дитяча'),
    tags: tplLibT('clocks, apprentice, kindness', 'часы, ученик, доброта', 'годинники, учень, доброта'),
    html: tplLibP('Tobias learns his trade in a shop where every clock tells a different time — and finds the key that teaches one of them to tell the right one.',
      'Тобиас учится ремеслу в лавке, где все часы показывают разное время, — и находит ключ, который учит одни из них показывать верное.',
      'Тобіас навчається ремесла в крамниці, де всі годинники показують різний час, — і знаходить ключ, що вчить один із них показувати правильний.'),
    cover: { motif: 'dial', bg: '#f4d9a8', ink: '#3a2a22', accent: '#b8342c', font: 'sans', fontTitle: 'slab', art: 'bottom', label: 'A Story for Children', align: 'center' },
    text: { file: 'the-clockmakers-apprentice.md', mime: 'text/markdown' },
    pdf: true,
  },
  {
    key: 'garden', title: 'Записки садовника', lang: 'ru', age: '12+', year: '1915', pages: '190',
    author: tplLibT('Pyotr Ovsyannikov', 'Пётр Овсянников', 'Петро Овсянніков'),
    genre: tplLibT('Essays', 'Очерки', 'Нариси'),
    tags: tplLibT('garden, seasons, patience', 'сад, времена года, терпение', 'сад, пори року, терпіння'),
    html: tplLibP('A gardener’s notebook of small observations — apples that take eleven years, April rooks and cucumbers under old glass.',
      'Тетрадь садовника: маленькие наблюдения — яблоки, которых ждут одиннадцать лет, апрельские грачи и огурцы под старыми рамами.',
      'Зошит садівника: дрібні спостереження — яблука, яких чекають одинадцять років, квітневі граки й огірки під старими рамами.'),
    cover: { motif: 'leaves', bg: '#e4ead8', ink: '#2c3b2a', accent: '#c46a2b', font: 'serif', fontTitle: 'serif', art: 'full', label: 'Очерки' },
    text: { file: 'zapiski-sadovnika.md', mime: 'text/markdown' },
  },
  {
    key: 'mill', title: 'Казки старого млина', lang: 'uk', age: '0+', year: '1909', pages: '112',
    author: tplLibT('Yarema Dovhan', 'Ярема Довгань', 'Ярема Довгань'),
    genre: tplLibT('Fairy tales', 'Сказки', 'Казки'),
    tags: tplLibT('fairy tales, mill, bedtime', 'сказки, мельница, на ночь', 'казки, млин, на ніч'),
    html: tplLibP('Bedtime tales from an old water mill that learned to sing, with a mouse who saved the village bread.',
      'Сказки на ночь о старой мельнице, которая научилась петь, и о мышке, спасшей деревенский хлеб.',
      'Казки на ніч про старий млин, що навчився співати, і про мишку, яка врятувала сільський хліб.'),
    cover: { motif: 'wheel', bg: '#f6ead0', ink: '#3b2f25', accent: '#d0632f', font: 'sans', fontTitle: 'slab', art: 'bottom', label: 'Казки', align: 'center' },
    text: { file: 'kazky-staroho-mlyna.md', mime: 'text/markdown' },
    audio: {
      narrator: tplLibT('Larysa Hnatiuk', 'Лариса Гнатюк', 'Лариса Гнатюк'), duration: tplLibT('2 h 30 min', '2 ч 30 мин', '2 год 30 хв'),
      root: 261.63, mode: 'penta', lead: 'chime',
      chapters: [tplLibT('How the Mill Learned to Sing', 'Как мельница научилась петь', 'Як млин навчився співати'), tplLibT('The Miller Mouse', 'Мышка-мельничиха', 'Мишка-мірошничка')],
    },
  },
  {
    key: 'weather', title: 'A Field Guide to Small Weather', lang: 'en', age: '12+', year: '1926', pages: '154',
    author: tplLibT('Harriet Quill', 'Гарриет Квилл', 'Гаррієт Квілл'),
    genre: tplLibT('Essays', 'Очерки', 'Нариси'),
    tags: tplLibT('nature, fog, snow, humour', 'природа, туман, снег, юмор', 'природа, туман, сніг, гумор'),
    html: tplLibP('Short, dry-humoured essays on the weather nobody reports: one-field fogs, the first snow and other quiet events.',
      'Короткие очерки с суховатым юмором о погоде, о которой не пишут газеты: туманы на одно поле, первый снег и другие тихие события.',
      'Короткі нариси з сухуватим гумором про погоду, про яку не пишуть газети: тумани на одне поле, перший сніг та інші тихі події.'),
    cover: { motif: 'rain', bg: '#e7ecef', ink: '#26323b', accent: '#2a6f97', font: 'sans', fontTitle: 'display', art: 'bottom', label: 'Essays' },
    text: { file: 'a-field-guide-to-small-weather.md', mime: 'text/markdown' },
  },
  {
    key: 'envelope', title: 'Справа про синій конверт', lang: 'uk', age: '16+', year: '1934', pages: '240',
    author: tplLibT('Bohdan Yasen', 'Богдан Ясень', 'Богдан Ясень'),
    genre: tplLibT('Detective', 'Детектив', 'Детектив'),
    tags: tplLibT('mystery, newspaper, train', 'загадка, газета, поезд', 'загадка, газета, потяг'),
    html: tplLibP('A crime reporter receives a letter with no stamp and boards the 6:40 train — sharing a compartment with a man who has ink on his sleeve.',
      'Репортёр криминальной хроники получает письмо без марки и садится на поезд 6:40 — в купе с человеком, у которого чернила на рукаве.',
      'Репортер кримінальної хроніки отримує лист без марки й сідає на потяг о 6:40 — у купе з чоловіком, у якого чорнило на рукаві.'),
    cover: { motif: 'envelope', bg: '#1c2a3d', ink: '#f1ead9', accent: '#4f86c6', font: 'sans', fontTitle: 'condensed', art: 'bottom', label: 'Детектив', caps: true },
    text: { file: 'sprava-pro-syniy-konvert.md', mime: 'text/markdown' },
  },
];

/* ----- pictures as data (isometric kit) ----- */

const TPL_LIB_SPINES = ['#8c2f39', '#0e5a6b', '#c9a13b', '#2f5d46', '#e2d6bd', '#5a4a7a', '#b8552e', '#1f3550'];

/** Reading room for the hero: two bookcases in a corner, a ladder, a rug, a reading table, people. */
function tplLibHeroSpec() {
  const s = [
    ...tplLibBookcase({ at: [0, 9, 0], w: 34, h: 30, d: 6, shelves: 4, face: 'x', seed: 'hero-side', colors: TPL_LIB_SPINES, bw: [1.9, 3.2] }),
    ...tplLibBookcase({ at: [8, 0, 0], w: 54, h: 30, d: 6, shelves: 4, seed: 'hero-back', colors: TPL_LIB_SPINES, bw: [1.9, 3.2] }),
  ];
  for (const x of [48, 52.6]) s.push({ box: [x, 7.2, 0, 0.6, 0.6, 31], c: 'brass' });
  for (let z = 3; z < 30; z += 3.4) s.push({ box: [48.6, 7.3, z, 4, 0.4, 0.35], c: 'brass' });
  s.push({ box: [12, 14, 0, 40, 26, 0.18], c: tplLibPaint('#0e5a6b') }, { box: [14, 16, 0.18, 36, 22, 0.06], c: tplLibPaint('#c9a13b') });
  s.push(...tplLibChair({ at: [20, 16], dir: 'y' }), ...tplLibChair({ at: [32, 16], dir: 'y' }));
  s.push(...tplLibTable({ at: [16, 21], w: 30, d: 10, glow: true, lamp: '#0e5a6b' }));
  s.push(...tplLibChair({ at: [26, 32], dir: '-y' }));
  s.push({ figure: [55, 12, 9.5], fill: '#24343b', h: 15 }, { figure: [44, 36, 0], fill: '#8c2f39', h: 16, lean: -1 }, { figure: [50, 38, 0], fill: '#2f5d46', h: 10 });
  return s;
}

/** Room vignettes for the reading-room cards (corner layouts for 16:9 pictures). */
const TPL_LIB_ROOMS = {
  quiet: () => [
    ...tplLibBookcase({ at: [0, 7, 0], w: 30, h: 16, shelves: 2, face: 'x', seed: 'quiet-side', colors: TPL_LIB_SPINES, bw: [2, 3.4] }),
    ...tplLibBookcase({ at: [7, 0, 0], w: 40, h: 16, shelves: 2, seed: 'quiet', colors: TPL_LIB_SPINES, bw: [2, 3.4] }),
    ...tplLibChair({ at: [14, 12], dir: 'y' }), ...tplLibChair({ at: [28, 12], dir: 'y' }),
    ...tplLibTable({ at: [10, 17], w: 30, d: 10, glow: true, lamp: '#0e5a6b' }),
    ...tplLibChair({ at: [21, 28], dir: '-y' }),
    { figure: [44, 30, 0], fill: '#24343b', h: 15 },
  ],
  kids: () => {
    const kidsCols = ['#e3a63c', '#d0632f', '#3f7d5c', '#2a6f97', '#b8342c', '#e9d36b'];
    const s = [
      ...tplLibBookcase({ at: [0, 6, 0], w: 30, h: 11, d: 5, shelves: 2, face: 'x', seed: 'kids-side', colors: kidsCols, bw: [1.6, 2.8] }),
      ...tplLibBookcase({ at: [6, 0, 0], w: 34, h: 11, d: 5, shelves: 2, seed: 'kids', colors: kidsCols, bw: [1.6, 2.8] }),
      { disc: [22, 20, 0.05], axis: 'z', r: 13, fill: '#e3a63c', opacity: 0.85 }, { disc: [22, 20, 0.1], axis: 'z', r: 9, fill: '#f4d9a8' },
      { cyl: [13, 16, 0], axis: 'z', r: 3.2, len: 1.8, c: tplLibPaint('#d0632f') }, { cyl: [31, 25, 0], axis: 'z', r: 3.2, len: 1.8, c: tplLibPaint('#2a6f97') },
    ];
    for (const [c, x] of [['#b8342c', 0], ['#3f7d5c', 2.6], ['#e3a63c', 5.2]]) s.push({ box: [34 + x * 0.2, 9 + x, 0, 2.4, 2.4, 2.4], c: tplLibPaint(c) });
    s.push({ box: [34.6, 11.6, 2.4, 2.4, 2.4, 2.4], c: tplLibPaint('#2a6f97') });
    s.push({ figure: [20, 26, 0], fill: '#24343b', h: 15 }, { figure: [25, 27, 0], fill: '#d0632f', h: 9 }, { figure: [16, 29, 0], fill: '#3f7d5c', h: 8 });
    return s;
  },
  listen: () => {
    const rec = ['#1f3550', '#c9a13b', '#8c2f39', '#2f2f2f', '#e2d6bd'];
    const s = [
      ...tplLibBookcase({ at: [0, 6, 0], w: 26, h: 14, d: 5, shelves: 2, face: 'x', seed: 'records-side', colors: rec, gaps: 0.02, bw: [1.4, 2.4] }),
      ...tplLibBookcase({ at: [6, 0, 0], w: 24, h: 14, d: 5, shelves: 2, seed: 'records', colors: rec, gaps: 0.02, bw: [1.4, 2.4] }),
    ];
    s.push({ box: [9, 9, 0, 24, 20, 0.18], c: tplLibPaint('#8c2f39') });
    const chair = tplLibPaint('#0e5a6b');
    s.push({ box: [13, 11, 0, 11, 2.2, 10], c: chair }, { box: [13, 13.2, 0, 2, 8.8, 6.5], c: chair }, { box: [15, 13.2, 0, 7, 8.8, 4.6], c: tplLibPaint('#2b7c8f') }, { box: [22, 13.2, 0, 2, 8.8, 6.5], c: chair });
    s.push({ cyl: [30, 16, 0], axis: 'z', r: 2.4, len: 6.5, c: 'wood' }, { box: [27.7, 13.7, 6.5, 4.6, 4.6, 1.1], c: 'dark' }, { disc: [30, 16, 7.65], axis: 'z', r: 1.9, fill: '#151515' }, { disc: [30, 16, 7.7], axis: 'z', r: 0.6, fill: '#c9a13b' });
    s.push({ cyl: [9, 26, 0], axis: 'z', r: 1.6, len: 0.4, c: 'brass' }, { cyl: [9, 26, 0.4], axis: 'z', r: 0.2, len: 15, c: 'brass' }, { cyl: [9, 26, 15], axis: 'z', r: 3, r1: 1.6, len: 2.6, c: tplLibPaint('#c9a13b') });
    s.push({ glow: [11, 24, 12], rx: 16, ry: 9, c0: '#fff3c4', c1: '#f2c45a', a: 0.45 });
    return s;
  },
};

/** Library mark: an open book under an arch (64×64). */
function tplLibBrandSVG() {
  return TPL_ART_SVG + 'viewBox="0 0 64 64" width="64" height="64"><rect width="64" height="64" rx="14" fill="#0e5a6b"/>' +
    '<path d="M14 46V27a18 18 0 0 1 36 0v19" fill="none" stroke="#e3a63c" stroke-width="3"/>' +
    '<path d="M32 49C27 45 19 44 12 45V30c7-1 15 0 20 4 5-4 13-5 20-4v15c-7-1-15 0-20 4Z" fill="#f6efe2"/>' +
    '<path d="M32 34v15" stroke="#0e5a6b" stroke-width="2"/><path d="M38 33v9l2.5-2 2.5 2v-10" fill="#c8553d"/></svg>';
}

function tplBuildLibrary(V) {
  const K = tplKit(V, ['en', 'ru', 'uk']);
  const { B, L } = K;
  const T = tplLibT;
  const P = tplLibP;
  const img = (name, svg, title) => K.svg(name, svg, { title });
  const col = (w, blocks) => ({ id: K.id(), w, blocks });
  const field = (key, type, label, o = {}) => K.item({ key, type, label: L(label), ph: L(o.ph || ''), options: L(o.options || ''), required: !!o.required, half: !!o.half });
  const sample = T('Tonal sketch in place of the narration · sample', 'Звуковой эскиз вместо начитки · образец', 'Звуковий ескіз замість начитки · зразок');

  // ----- pictures -----
  const brand = img('lindgrove-library-mark.svg', tplLibBrandSVG(), T('Lindgrove City Library mark', 'Знак городской библиотеки Линдгроува', 'Знак міської бібліотеки Ліндгроува'));
  const hero = img('lindgrove-reading-room.svg', tplIsoScene(1200, 960, tplLibHeroSpec(), { light: true, pad: 56, dy: 8, bg0: '#f7f1e5', bg1: '#e8dcc4', grid: '#0e5a6b', glow: [0.5, 0.55, 0.5], glowC0: '#fff6dc', glowC1: '#ecd9a8' }),
    T('The main reading room: bookcases, a ladder and the long table', 'Главный читальный зал: стеллажи, лестница и длинный стол', 'Головна читальна зала: стелажі, драбина й довгий стіл'));
  const room = (k, title) => img('room-' + k + '.svg', tplIsoScene(800, 450, TPL_LIB_ROOMS[k](), { light: true, pad: 22, dy: 4, bg0: '#f7f1e5', bg1: '#ebe0ca', grid: '#0e5a6b' }), title);
  const rooms = {
    quiet: room('quiet', T('Quiet reading room', 'Тихий читальный зал', 'Тиха читальна зала')),
    kids: room('kids', T('Children’s room', 'Детская комната', 'Дитяча кімната')),
    listen: room('listen', T('Listening corner', 'Уголок для слушания', 'Куточок для слухання')),
  };
  const map = img('lindgrove-library-map.svg', tplArtMap({ seed: 'lindgrove', river: true, ground: '#efe8da', block: '#e2d9c6', building: '#d4c8b0', park: '#cfdcbf', water: '#b4cfd6', road: '#ffffff', pins: [[620, 420, '#0e5a6b', 1.4]] }),
    T('Map: 3 Orchard Row, Lindgrove', 'Карта: Орчард-Роу, 3, Линдгроув', 'Мапа: Орчард-Роу, 3, Ліндгроув'));
  const portrait = (seed, o) => img('librarian-' + seed + '.svg', tplAgroPortrait({ seed, bg: ['#e9dfca', '#cdb98f'], shirt: '#0e5a6b', shirt2: '#0a4552', collar: '#f6efe2', ...o }), '');
  const people = {
    margaret: portrait('ellery', { skin: '#f1d0b8', skin2: '#e2b597', hair: '#9a948c', style: 'bun', glasses: true }),
    daniel: portrait('osei', { skin: '#8d5a3b', skin2: '#774a30', hair: '#1f1712', style: 'buzz', beard: true, shirt: '#2f5d46', shirt2: '#24493a' }),
    olena: portrait('kravets', { skin: '#f0cdb4', skin2: '#e0b394', hair: '#6b3f26', style: 'long', shirt: '#8c2f39', shirt2: '#6f242d' }),
    priya: portrait('lal', { skin: '#c99671', skin2: '#b58360', hair: '#22160f', style: 'curly', shirt: '#c9a13b', shirt2: '#a8852c', collar: '#fff' }),
  };

  // ----- editions: covers, mock-ups, text / audio / PDF files -----
  const ed = {};
  for (const bk of TPL_LIB_BOOKS) {
    const cv = { seed: bk.key, title: bk.title, author: bk.author[bk.lang] || bk.author.en, ...bk.cover };
    const e = { bk, files: [] };
    e.cover = img('cover-' + bk.key + '.svg', tplLibCover(cv), T('Cover: ' + bk.title, 'Обложка: ' + bk.title, 'Обкладинка: ' + bk.title));
    e.mock = null; // 4:3 mock-up, made on demand (wide cards)
    e.cv = cv;
    if (bk.audio) {
      bk.audio.chapters.forEach((ch, i) => {
        const att = K.addAtt({
          name: bk.text.file.replace(/\.(md|txt)$/, '') + '-' + (i + 1) + '.wav', mime: 'audio/wav',
          data: tplLibSketch({ seed: bk.key + ':' + i, sec: 1.3 + (i % 2) * 0.2, notes: 4, root: bk.audio.root, mode: bk.audio.mode, lead: bk.audio.lead }),
          title: T(ch.en, ch.ru, ch.uk), desc: sample,
        });
        e.files.push({ att, label: L(T(ch.en + ' (sample)', ch.ru + ' (образец)', ch.uk + ' (зразок)')), kind: 'audio' });
      });
    }
    const verse = bk.text.mime === 'text/plain';
    const txt = K.addAtt({
      name: bk.text.file, mime: bk.text.mime, data: tplLibText(TPL_LIB_TEXTS[bk.key]),
      title: T(bk.title, bk.title, bk.title),
      desc: verse ? T('Poems · plain text', 'Стихи · простой текст', 'Вірші · простий текст') : T('Excerpt · Markdown', 'Отрывок · Markdown', 'Уривок · Markdown'),
    });
    e.files.push({ att: txt, label: L(verse ? T('Poems · text edition', 'Стихи · текстовое издание', 'Вірші · текстове видання') : T('Text edition · excerpt', 'Текстовое издание · отрывок', 'Текстове видання · уривок')), kind: 'text' });
    if (bk.pdf) {
      const pdf = K.addAtt({
        name: bk.text.file.replace(/\.md$/, '') + '-facsimile-1921.pdf', mime: 'application/pdf',
        data: K.files.makePDF("The Clockmaker's Apprentice - first edition, 1921", TPL_LIB_FACSIMILE, { accent: '#0e5a6b', band: 'LINDGROVE CITY LIBRARY - SPECIAL COLLECTIONS' }),
        title: T('First edition, 1921 · facsimile', 'Первое издание, 1921 · факсимиле', 'Перше видання, 1921 · факсиміле'), desc: T('Sample pages · PDF', 'Пробные страницы · PDF', 'Пробні сторінки · PDF'),
      });
      e.files.push({ att: pdf, label: L(T('First edition, 1921 · facsimile (PDF)', 'Первое издание, 1921 · факсимиле (PDF)', 'Перше видання, 1921 · факсиміле (PDF)')), kind: 'pdf' });
    }
    ed[bk.key] = e;
  }
  const mockup = (key, o) => {
    const e = ed[key];
    if (!e.mock) e.mock = img('mockup-' + key + '.svg', tplLibMockup({ ...e.cv, ...o }), T(e.bk.title, e.bk.title, e.bk.title));
    return e.mock;
  };

  // Attributes by key, in the order asked for.
  const A = (label, value) => ({ label: L(label), value: L(value) });
  const ATTR = {
    author: (bk) => A(T('Author', 'Автор', 'Автор'), bk.author),
    genre: (bk) => A(T('Genre', 'Жанр', 'Жанр'), bk.genre),
    lang: (bk) => A(T('Language', 'Язык', 'Мова'), TPL_LIB_LANG[bk.lang]),
    year: (bk) => A(T('Year', 'Год', 'Рік'), bk.year),
    age: (bk) => A(T('Age', 'Возраст', 'Вік'), bk.age),
    pages: (bk) => A(T('Pages', 'Страниц', 'Сторінок'), bk.pages),
    duration: (bk) => (bk.audio ? A(T('Duration', 'Длительность', 'Тривалість'), bk.audio.duration) : null),
    narrator: (bk) => (bk.audio ? A(T('Narrator', 'Читает', 'Читає'), bk.audio.narrator) : null),
  };
  const attrs = (bk, keys, extra = []) => [...extra, ...keys.map((k) => ATTR[k](bk))].filter(Boolean);
  const CAT_KEYS = ['author', 'genre', 'lang', 'year', 'age', 'pages', 'duration', 'narrator'];
  const entry = (key, o = {}) => {
    const e = ed[key], bk = e.bk;
    return K.item({
      title: L(bk.title), subtitle: L(bk.author), cover: o.cover || e.cover, badge: L(o.badge || ''), html: L(o.html || bk.html), tags: L(bk.tags),
      attrs: attrs(bk, o.keys || CAT_KEYS, o.extra), files: e.files.map((f) => ({ ...f })), date: o.date || '', href: '', price: null, old: null, unit: L(''), sku: '',
    });
  };

  // ----- requests (browser-local endpoints; e-mail is the human fallback) -----
  const R = (name, url) => ({ id: K.id(), name, method: 'POST', url, headers: [], credentials: 'omit', timeout: 8000, retries: 1, itemsPath: 'items' });
  const rqApply = R('Card applications and event sign-ups (browser storage)', 'local:applications');
  const rqOrder = R('Memberships (browser storage)', 'local:orders');

  const d = K.doc({
    name: 'Lindgrove City Library — read and listen', preset: 'folio', defaultLang: 'en',
    author: 'Lindgrove City Library',
    keywords: 'public library, e-books, audiobooks, reading room, library card, book club, story hour, Lindgrove',
    title: T('Lindgrove City Library — read and listen', 'Городская библиотека Линдгроува — читать и слушать', 'Міська бібліотека Ліндгроува — читати й слухати'),
    description: T(
      'A public library with a text and an audio edition of its books: catalogue with search and filters, reading rooms and events, free reader card, librarians and contacts.',
      'Публичная библиотека с текстовыми и аудиоизданиями книг: каталог с поиском и фильтрами, читальные залы и события, бесплатный читательский билет, библиотекари и контакты.',
      'Публічна бібліотека з текстовими та аудіовиданнями книжок: каталог із пошуком і фільтрами, читальні зали й події, безкоштовний читацький квиток, бібліотекарі та контакти.'),
    meta: { favicon: brand },
    theme: { scheme: 'auto' },
    output: { autodetect: true, switcher: 'buttons', langLabels: 'code', themeToggle: true, toolbarPos: 'nav', uiFallback: 'en', motion: 'fade', backToTop: true },
    shop: {
      currency: 'GBP', mode: 'cart', cartButton: 'auto', sync: 'local', policy: 'newest', ttlDays: 30,
      checkout: {
        method: 'request', req: rqOrder.id, fallback: 'mailto', email: 'friends@lindgrove-library.example', phone: '+44 000 000 1911', minTotal: 0,
        note: T('We confirm memberships by e-mail within one working day; the first payment is taken only after that.',
          'Мы подтверждаем членство письмом в течение рабочего дня; первый платёж списывается только после этого.',
          'Ми підтверджуємо членство листом протягом робочого дня; перший платіж списується лише після цього.'),
        success: T('Thank you for supporting the library! A confirmation is on its way to your inbox.',
          'Спасибо, что поддерживаете библиотеку! Подтверждение уже летит на вашу почту.',
          'Дякуємо, що підтримуєте бібліотеку! Підтвердження вже летить на вашу пошту.'),
        fields: [
          field('name', 'text', T('Full name', 'Имя и фамилия', 'Ім’я та прізвище'), { required: true, half: true }),
          field('email', 'email', T('E-mail', 'E-mail', 'E-mail'), { required: true, half: true }),
          field('card', 'text', T('Reader card number (if you have one)', 'Номер читательского билета (если есть)', 'Номер читацького квитка (якщо є)'), { ph: 'LG-000000' }),
          field('note', 'textarea', T('Comment', 'Комментарий', 'Коментар')),
        ],
      },
    },
    requests: [rqApply, rqOrder],
  });
  d.meta.ogImage = hero;

  // ----- header -----
  d.regions.header = [B('nav', {
    brand: L(T('Lindgrove Library', 'Библиотека Линдгроува', 'Бібліотека Ліндгроува')), logo: brand, logoH: 38, sticky: true, overlay: false, variant: 'bar',
    items: [
      K.item({ label: L(T('Catalogue', 'Каталог', 'Каталог')), href: '#catalogue' }),
      K.item({ label: L(T('Events', 'События', 'Події')), href: '#events' }),
      K.item({ label: L(T('Membership', 'Членство', 'Членство')), href: '#membership' }),
      K.item({ label: L(T('Visit', 'Адрес', 'Адреса')), href: '#visit' }),
    ],
    ctaLabel: L(T('Get a card', 'Получить билет', 'Отримати квиток')), ctaHref: '#register',
  })];

  // ----- main -----
  const heroB = B('hero', {
    layout: 'split', media: hero, height: 'auto',
    badge: L(T('Open daily · 9:00–20:00', 'Открыто ежедневно · 9:00–20:00', 'Відчинено щодня · 9:00–20:00')),
    eyebrow: L(T('Lindgrove City Library · since 1911', 'Городская библиотека Линдгроува · с 1911 года', 'Міська бібліотека Ліндгроува · з 1911 року')),
    title: L(T('Read it, listen to it — free, all year round', 'Читайте и слушайте — бесплатно, круглый год', 'Читайте й слухайте — безкоштовно, цілий рік')),
    text: L(P('Forty-eight thousand books in English, Ukrainian and Russian, with text and audio editions you can open right here in the browser. Your card is free; so is the tea in the reading room.',
      'Сорок восемь тысяч книг на английском, украинском и русском — с текстовыми и аудиоизданиями, которые открываются прямо в браузере. Читательский билет бесплатный, как и чай в читальном зале.',
      'Сорок вісім тисяч книжок англійською, українською та російською — з текстовими й аудіовиданнями, що відкриваються просто в браузері. Читацький квиток безкоштовний, як і чай у читальній залі.')),
    items: [
      K.btn(T('Browse the catalogue', 'Открыть каталог', 'Відкрити каталог'), '#catalogue', 'primary', K.icon('book')),
      K.btn(T('Get a free card', 'Получить бесплатный билет', 'Отримати безкоштовний квиток'), '#register', 'secondary', K.icon('idcard')),
    ],
  });

  const stats = K.sec({ pad: 's' }, [B('stats', {
    variant: 'band', columns: 4,
    items: [
      K.item({ value: '48 000', suffix: L(''), label: L(T('books on the shelves', 'книг на полках', 'книжок на полицях')) }),
      K.item({ value: '2 600', suffix: L(''), label: L(T('audiobooks to stream', 'аудиокниг онлайн', 'аудіокнижок онлайн')) }),
      K.item({ value: '3', suffix: L(''), label: L(T('languages of the collection', 'языка фонда', 'мови фонду')) }),
      K.item({ value: '120', suffix: L('+'), label: L(T('events a year', 'событий в год', 'подій на рік')) }),
    ],
  })]);

  const newArrivals = K.sec({
    anchor: 'new', eyebrow: T('New arrivals', 'Новые поступления', 'Нові надходження'),
    title: T('Just catalogued', 'Только что в каталоге', 'Щойно в каталозі'),
    lead: P('Fresh from the binding room: a new audio edition, two books back in print and a detective story everyone has been asking for.',
      'Прямо из переплётной: новое аудиоиздание, две переизданные книги и детектив, о котором все спрашивали.',
      'Просто з палітурні: нове аудіовидання, дві перевидані книжки й детектив, про який усі питали.'),
  }, [B('collection', {
    variant: 'feature', columns: 2, ratio: '4/3', cardAttrs: 2, details: 'modal', media: 'reader',
    items: [
      entry('gull', { cover: mockup('gull', { sceneBg: ['#f3ead8', '#e4d5b6'], floor: '#cdbb98', disc: '#e3a63c' }), badge: T('New audio edition', 'Новое аудиоиздание', 'Нове аудіовидання'), date: '2026-10-01', keys: ['genre', 'duration', 'author', 'lang', 'year', 'age', 'pages', 'narrator'],
        html: P('The lighthouse classic is back — now with an audio edition read by Clara Penhallow. Listen to the sample chapters right here, or open the text edition and read along.',
          'Классика о маяке вернулась — теперь и в аудиоиздании, читает Клара Пенхаллоу. Слушайте образцы глав прямо здесь или откройте текстовое издание и читайте вместе.',
          'Класика про маяк повернулася — тепер і в аудіовиданні, читає Клара Пенхаллоу. Слухайте зразки розділів просто тут або відкрийте текстове видання й читайте разом.') }),
      entry('envelope', { cover: mockup('envelope', { sceneBg: ['#e6ebef', '#cfd8df'], floor: '#aebbc6', disc: '#4f86c6' }), badge: T('New', 'Новинка', 'Новинка'), date: '2026-09-24', keys: ['genre', 'lang', 'author', 'year', 'age', 'pages'] }),
      entry('weather', { cover: mockup('weather', { sceneBg: ['#eef1ee', '#d9e0dc'], floor: '#b9c4bf', disc: '#9dc0d6' }), badge: T('Back in print', 'Переиздание', 'Перевидання'), date: '2026-09-17', keys: ['genre', 'lang', 'author', 'year', 'age', 'pages'] }),
    ],
  })]);

  const catalogue = K.sec({
    anchor: 'catalogue', tone: 'muted', width: 'wide',
    eyebrow: T('Catalogue', 'Каталог', 'Каталог'),
    title: T('Every book has a text and many have an audio edition', 'У каждой книги есть текст, у многих — аудиоиздание', 'Кожна книжка має текст, багато — аудіовидання'),
    lead: P('Search by title, author or theme; filter by language, format, genre and age; press a cover for the details. Audio editions here are short tonal samples standing in for the narration.',
      'Ищите по названию, автору или теме; фильтруйте по языку, формату, жанру и возрасту; нажмите на обложку, чтобы увидеть подробности. Аудиоиздания здесь — короткие звуковые образцы вместо начитки.',
      'Шукайте за назвою, автором чи темою; фільтруйте за мовою, форматом, жанром і віком; натисніть на обкладинку, щоб побачити подробиці. Аудіовидання тут — короткі звукові зразки замість начитки.'),
  }, [B('collection', {
    variant: 'shelf', columns: 5, ratio: '2/3', details: 'modal', media: 'reader',
    search: true, filters: ['Author', 'Language', '$kind', 'Genre', 'Age'], ranges: ['Year', 'Pages', 'Duration'], sorts: ['$title', 'Author', 'Year', 'Pages'],
    empty: L(T('Nothing on this shelf matches. Try fewer filters — or ask a librarian to order the book.', 'На этой полке ничего не нашлось. Уберите часть фильтров — или попросите библиотекаря заказать книгу.', 'На цій полиці нічого не знайшлося. Приберіть частину фільтрів — або попросіть бібліотекаря замовити книжку.')),
    items: TPL_LIB_BOOKS.map((bk) => entry(bk.key)),
  })]);

  const picks = K.sec({
    anchor: 'picks', width: 'normal',
    eyebrow: T('Librarians’ picks', 'Выбор библиотекарей', 'Вибір бібліотекарів'),
    title: T('Three books we keep pressing into people’s hands', 'Три книги, которые мы всем советуем', 'Три книжки, які ми всім радимо'),
  }, [B('collection', {
    variant: 'list', ratio: '2/3', cardAttrs: 3, details: 'modal', media: 'reader',
    items: [
      entry('salt', { keys: ['genre', 'year', 'lang', 'author', 'duration'], extra: [A(T('Picked by', 'Выбор', 'Вибір'), T('Margaret Ellery', 'Маргарет Эллери', 'Маргарет Еллері'))],
        html: P('“Read one aloud on a walk and you will understand why the carters sang. Then listen to Clara Penhallow do it better.” The poems come as plain text, so they keep their lines in the reader.',
          '«Прочтите одно стихотворение вслух на прогулке — и поймёте, почему возчики пели. А потом послушайте, как это делает Клара Пенхаллоу». Стихи — простым текстом, поэтому в читалке сохраняют строки.',
          '«Прочитайте один вірш уголос на прогулянці — і зрозумієте, чому візники співали. А потім послухайте, як це робить Клара Пенхаллоу». Вірші — простим текстом, тож у читалці зберігають рядки.') }),
      entry('garden', { keys: ['genre', 'year', 'lang', 'author', 'pages'], extra: [A(T('Picked by', 'Выбор', 'Вибір'), T('Olena Kravets', 'Елена Кравец', 'Олена Кравець'))],
        html: P('“The calmest book in the building. I give it to anyone who says they have no time to read: one entry takes two minutes and stays with you all day.”',
          '«Самая спокойная книга в здании. Даю её всем, кто говорит, что им некогда читать: одна запись — две минуты, а помнится весь день».',
          '«Найспокійніша книжка в будівлі. Даю її всім, хто каже, що не має часу читати: один запис — дві хвилини, а пам’ятається весь день».') }),
      entry('clock', { keys: ['genre', 'year', 'age', 'author', 'pages'], extra: [A(T('Picked by', 'Выбор', 'Вибір'), T('Priya Lal', 'Прия Лал', 'Прія Лал'))],
        html: P('“Our story-hour favourite for a hundred years. Look at the first-edition facsimile from special collections — the plates are lovely.”',
          '«Любимица детских чтений уже сто лет. Посмотрите факсимиле первого издания из отдела редких книг — иллюстрации чудесные».',
          '«Улюблениця дитячих читань уже сто років. Погляньте на факсиміле першого видання з відділу рідкісних книжок — ілюстрації чудові».') }),
    ],
  })]);

  const ev = (date, time, title, venue, status = 'on') => K.item({ date, time, title: L(title), venue: L(venue), city: L(T('Lindgrove', 'Линдгроув', 'Ліндгроув')), href: '#register', price: null, sku: '', status });
  const events = K.sec({
    anchor: 'events', tone: 'dark',
    eyebrow: T('Reading rooms & events', 'Читальные залы и события', 'Читальні зали й події'),
    title: T('Room to read, people to read with', 'Место, где читать, и люди, с кем читать', 'Місце, де читати, і люди, з ким читати'),
    lead: P('Three rooms for three kinds of quiet, and a calendar that is never quite empty. All events are free; please sign up so we can set out enough chairs.',
      'Три зала для трёх видов тишины и календарь, который никогда не пустует. Все события бесплатные; запишитесь, чтобы мы поставили достаточно стульев.',
      'Три зали для трьох видів тиші й календар, що ніколи не порожніє. Усі події безкоштовні; запишіться, щоб ми поставили досить стільців.'),
  }, [
    B('features', {
      variant: 'cards', columns: 3,
      items: [
        K.item({ icon: K.icon('book'), image: rooms.quiet, title: L(T('Quiet reading room', 'Тихий читальный зал', 'Тиха читальна зала')),
          html: L(P('Forty desks with green lamps, power at every seat and a strict whisper rule. Reference books and newspapers stay here.',
            'Сорок столов с зелёными лампами, розетки у каждого места и строгое правило шёпота. Справочники и газеты — здесь.',
            'Сорок столів із зеленими лампами, розетки біля кожного місця й суворе правило шепоту. Довідники й газети — тут.')) }),
        K.item({ icon: K.icon('star'), image: rooms.kids, title: L(T('Children’s room', 'Детская комната', 'Дитяча кімната')),
          html: L(P('Picture books at toddler height, a reading rug and story hour every Saturday. Noise is welcome until noon.',
            'Книжки с картинками на уровне малышей, ковёр для чтения и сказочный час по субботам. До полудня шуметь можно.',
            'Книжки з малюнками на рівні малюків, килим для читання й казкова година щосуботи. До полудня шуміти можна.')) }),
        K.item({ icon: K.icon('headphones'), image: rooms.listen, title: L(T('Listening corner', 'Уголок для слушания', 'Куточок для слухання')),
          html: L(P('Armchairs, headphones and a record player. Borrow a tablet with the whole audio collection for the afternoon.',
            'Кресла, наушники и проигрыватель. Можно взять планшет со всей аудиоколлекцией на целый день.',
            'Крісла, навушники й програвач. Можна взяти планшет з усією аудіоколекцією на цілий день.')) }),
      ],
    }),
    B('spacer', { h: 28 }),
    B('events', {
      variant: 'list', hidePast: false, linkLabel: L(T('Sign up', 'Записаться', 'Записатися')),
      items: [
        ev('2026-10-24', '11:00', T('Saturday story hour (ages 4–7)', 'Субботний сказочный час (4–7 лет)', 'Суботня казкова година (4–7 років)'), T('Children’s room', 'Детская комната', 'Дитяча кімната'), 'few'),
        ev('2026-10-29', '18:30', T('Book club: The Lamp at Gull Point', 'Книжный клуб: «The Lamp at Gull Point»', 'Книжковий клуб: «The Lamp at Gull Point»'), T('Quiet reading room', 'Тихий читальный зал', 'Тиха читальна зала')),
        ev('2026-11-07', '15:00', T('Listening afternoon with headphones', 'Вечер слушания в наушниках', 'Вечір слухання в навушниках'), T('Listening corner', 'Уголок для слушания', 'Куточок для слухання')),
        ev('2026-11-14', '12:00', T('Family history workshop with the archive', 'Мастерская семейной истории с архивом', 'Майстерня родинної історії з архівом'), T('Special collections', 'Отдел редких книг', 'Відділ рідкісних книжок')),
        ev('2026-11-21', '19:00', T('Poetry night: Songs of the Salt Road read aloud', 'Вечер поэзии: «Songs of the Salt Road» вслух', 'Вечір поезії: «Songs of the Salt Road» вголос'), T('Main hall', 'Главный зал', 'Головна зала')),
        ev('2026-12-05', '10:00', T('Winter book swap', 'Зимний книгообмен', 'Зимовий книгообмін'), T('Main hall', 'Главный зал', 'Головна зала')),
      ],
    }),
  ]);

  const borrow = K.sec({
    anchor: 'borrow', eyebrow: T('How to borrow', 'Как взять книгу', 'Як узяти книжку'),
    title: T('Four steps, no fines for the first week', 'Четыре шага и никаких штрафов первую неделю', 'Чотири кроки й жодних штрафів першого тижня'),
  }, [B('steps', {
    variant: 'numbers',
    items: [
      K.item({ icon: K.icon('idcard'), title: L(T('Get a free card', 'Получите бесплатный билет', 'Отримайте безкоштовний квиток')),
        html: L(P('Apply online below or at the front desk with proof of address. Children under 16 join with a parent.',
          'Подайте заявку онлайн ниже или на стойке с подтверждением адреса. Дети до 16 лет — вместе с родителем.',
          'Подайте заявку онлайн нижче або на стійці з підтвердженням адреси. Діти до 16 років — разом із батьками.')) }),
      K.item({ icon: K.icon('search'), title: L(T('Find it in the catalogue', 'Найдите в каталоге', 'Знайдіть у каталозі')),
        html: L(P('Search by title, author or theme and filter by language, format and age.', 'Ищите по названию, автору или теме, фильтруйте по языку, формату и возрасту.', 'Шукайте за назвою, автором чи темою, фільтруйте за мовою, форматом і віком.')) }),
      K.item({ icon: K.icon('headphones'), title: L(T('Read or listen right away', 'Читайте или слушайте сразу', 'Читайте чи слухайте одразу')),
        html: L(P('Text and audio editions open in the browser and remember where you stopped.', 'Текстовые и аудиоиздания открываются в браузере и помнят, где вы остановились.', 'Текстові й аудіовидання відкриваються в браузері й пам’ятають, де ви зупинилися.')) }),
      K.item({ icon: K.icon('calendar'), title: L(T('Borrow, renew, return', 'Берите, продлевайте, возвращайте', 'Беріть, продовжуйте, повертайте')),
        html: L(P('Paper books are yours for three weeks; renew twice online and return to any book drop in town.', 'Бумажные книги — на три недели; продлить можно дважды онлайн, вернуть — в любой книжный ящик города.', 'Паперові книжки — на три тижні; подовжити можна двічі онлайн, повернути — до будь-якої книжкової скриньки міста.')) }),
    ],
  })]);

  const plan = (name, price, period, featured, sku, label, href, html) => K.item({ name: L(name), price, period: L(period), featured, label: L(label), href, sku, html: L(html) });
  const month = T('month', 'месяц', 'місяць');
  const membership = K.sec({
    anchor: 'membership', tone: 'muted', align: 'center',
    eyebrow: T('Membership', 'Членство', 'Членство'),
    title: T('The card is free. Friendship keeps the lights on.', 'Билет бесплатный. Дружба помогает держать свет включённым.', 'Квиток безкоштовний. Дружба допомагає тримати світло ввімкненим.'),
    lead: P('Everyone who lives, works or studies in Lindgrove gets a free reader card. Friends and families add a little each month for new books, longer hours and the events programme.',
      'Каждый, кто живёт, работает или учится в Линдгроуве, получает бесплатный билет. Друзья и семьи добавляют немного каждый месяц — на новые книги, долгие часы работы и события.',
      'Кожен, хто живе, працює чи навчається в Ліндгроуві, отримує безкоштовний квиток. Друзі й родини додають трохи щомісяця — на нові книжки, довші години роботи й події.'),
  }, [B('pricing', {
    columns: 3,
    items: [
      plan(T('Reader card', 'Читательский билет', 'Читацький квиток'), 0, T('year', 'год', 'рік'), false, '', T('Apply', 'Оформить', 'Оформити'), '#register',
        tplLibUl(['12 books or audiobooks at a time', 'Read and listen online, anywhere', 'Reading rooms and Wi-Fi', 'All events, free'],
          ['12 книг или аудиокниг одновременно', 'Чтение и слушание онлайн где угодно', 'Читальные залы и Wi-Fi', 'Все события бесплатно'],
          ['12 книжок чи аудіокнижок одночасно', 'Читання й слухання онлайн будь-де', 'Читальні зали та Wi-Fi', 'Усі події безкоштовно'])),
      plan(T('Friend of the library', 'Друг библиотеки', 'Друг бібліотеки'), 4, month, true, 'lib-friend-monthly', T('Become a Friend', 'Стать другом', 'Стати другом'), '',
        tplLibUl(['Everything on the reader card', 'Early booking for events', 'New arrivals newsletter', 'Your name on the Friends’ shelf'],
          ['Всё, что даёт читательский билет', 'Ранняя запись на события', 'Рассылка о новинках', 'Ваше имя на полке друзей'],
          ['Усе, що дає читацький квиток', 'Ранній запис на події', 'Розсилка про новинки', 'Ваше ім’я на полиці друзів'])),
      plan(T('Family card', 'Семейный билет', 'Родинний квиток'), 6, month, false, 'lib-family-monthly', T('Join as a family', 'Оформить для семьи', 'Оформити для родини'), '',
        tplLibUl(['Up to five cards on one account', '30 items at a time', 'Children’s workshops included', 'Holiday reading challenge kit'],
          ['До пяти билетов на одном аккаунте', '30 изданий одновременно', 'Детские мастерские включены', 'Набор для каникулярного чтения'],
          ['До п’яти квитків на одному акаунті', '30 видань одночасно', 'Дитячі майстерні включено', 'Набір для канікулярного читання'])),
    ],
  })]);

  const member = (photo, name, role, html) => K.item({ photo, name: L(name), role: L(role), html: L(html), href: '' });
  const team = K.sec({
    anchor: 'librarians', align: 'center',
    eyebrow: T('Librarians', 'Библиотекари', 'Бібліотекарі'),
    title: T('People who know where everything is', 'Люди, которые знают, где что лежит', 'Люди, які знають, де що лежить'),
  }, [B('team', {
    variant: 'round', columns: 4,
    items: [
      member(people.margaret, T('Margaret Ellery', 'Маргарет Эллери', 'Маргарет Еллері'), T('Head librarian', 'Директор библиотеки', 'Директорка бібліотеки'),
        P('Thirty years at Lindgrove; still re-shelves the poetry herself.', 'Тридцать лет в Линдгроуве; поэзию до сих пор расставляет сама.', 'Тридцять років у Ліндгроуві; поезію досі розставляє сама.')),
      member(people.daniel, T('Daniel Osei', 'Дэниел Осеи', 'Деніел Осеї'), T('Audio & digital collections', 'Аудио и цифровые фонды', 'Аудіо та цифрові фонди'),
        P('Records the audio editions and runs the listening corner.', 'Записывает аудиоиздания и ведёт уголок для слушания.', 'Записує аудіовидання й веде куточок для слухання.')),
      member(people.olena, T('Olena Kravets', 'Елена Кравец', 'Олена Кравець'), T('Ukrainian & Russian collections', 'Украинский и русский фонды', 'Український і російський фонди'),
        P('Builds the Slavic shelves and hosts the book club.', 'Собирает славянские полки и ведёт книжный клуб.', 'Збирає слов’янські полиці й веде книжковий клуб.')),
      member(people.priya, T('Priya Lal', 'Прия Лал', 'Прія Лал'), T('Children’s librarian', 'Детский библиотекарь', 'Дитяча бібліотекарка'),
        P('Story hour, holiday challenges and the reading rug.', 'Сказочный час, каникулярные челленджи и ковёр для чтения.', 'Казкова година, канікулярні челенджі й килим для читання.')),
    ],
  })]);

  const faqItems = [
    [T('Is the reader card really free?', 'Читательский билет правда бесплатный?', 'Читацький квиток справді безкоштовний?'),
      P('Yes — for everyone who lives, works or studies in Lindgrove. Friends and family memberships are optional and support the library.', 'Да — для всех, кто живёт, работает или учится в Линдгроуве. Членство «Друг» и семейное — по желанию, оно поддерживает библиотеку.', 'Так — для всіх, хто живе, працює чи навчається в Ліндгроуві. Членство «Друг» і родинне — за бажанням, воно підтримує бібліотеку.')],
    [T('How many books can I borrow, and for how long?', 'Сколько книг можно взять и на какой срок?', 'Скільки книжок можна взяти й на який термін?'),
      P('Twelve items at a time for three weeks; renew twice online. The first week after the due date is fine-free.', 'Двенадцать изданий на три недели; продлить можно дважды онлайн. Первая неделя после срока — без штрафа.', 'Дванадцять видань на три тижні; подовжити можна двічі онлайн. Перший тиждень після терміну — без штрафу.')],
    [T('Do the audio editions here have real narration?', 'В аудиоизданиях здесь настоящая начитка?', 'В аудіовиданнях тут справжня начитка?'),
      P('On this demo page the chapters are short tonal samples. In the library app you hear the full narration; the player, speed and bookmarks work the same way.', 'На этой демонстрационной странице главы — короткие звуковые образцы. В приложении библиотеки звучит полная начитка; плеер, скорость и закладки работают так же.', 'На цій демонстраційній сторінці розділи — короткі звукові зразки. У застосунку бібліотеки звучить повна начитка; плеєр, швидкість і закладки працюють так само.')],
    [T('Will the reader remember my page?', 'Читалка запомнит мою страницу?', 'Читалка запам’ятає мою сторінку?'),
      P('Yes. The text reader remembers your place, font size and page colour; the audio player resumes the chapter where you paused — on this device.', 'Да. Читалка помнит место, размер шрифта и цвет страницы; плеер продолжит главу с того места, где вы остановились, — на этом устройстве.', 'Так. Читалка пам’ятає місце, розмір шрифту й колір сторінки; плеєр продовжить розділ із того місця, де ви зупинилися, — на цьому пристрої.')],
    [T('Do you have large print and books in other languages?', 'Есть ли книги крупным шрифтом и на других языках?', 'Чи є книжки великим шрифтом та іншими мовами?'),
      P('Large-print shelves are next to the front desk. Beyond English, Ukrainian and Russian we order books in any language through the regional network — just ask.', 'Полки с крупным шрифтом — у стойки. Кроме английского, украинского и русского, мы заказываем книги на любом языке через региональную сеть — просто спросите.', 'Полиці з великим шрифтом — біля стійки. Окрім англійської, української та російської, ми замовляємо книжки будь-якою мовою через регіональну мережу — просто запитайте.')],
    [T('Can I suggest a book for the library to buy?', 'Можно предложить книгу для закупки?', 'Чи можна запропонувати книжку для закупівлі?'),
      P('Please do — through “Ask a librarian” or the form below. Most suggestions arrive within a month.', 'Конечно — через «Спросите библиотекаря» или форму ниже. Большинство книг приходит в течение месяца.', 'Звісно — через «Запитайте бібліотекаря» або форму нижче. Більшість книжок надходить протягом місяця.')],
  ];
  const faq = B('faq', { variant: 'details', openFirst: true, items: faqItems.map(([q, a]) => K.item({ q: L(q), html: L(a) })) });
  const chat = V.BLOCK_TYPES && V.BLOCK_TYPES.chat ? B('chat', {
    display: 'inline', avatar: people.olena,
    title: L(T('Ask a librarian', 'Спросите библиотекаря', 'Запитайте бібліотекаря')),
    operator: L(T('Olena and Daniel · reference desk', 'Елена и Дэниел · справочная служба', 'Олена й Деніел · довідкова служба')),
    welcome: L(T('Hello! Looking for a book, a fact or help with your card? Leave us a message.', 'Здравствуйте! Ищете книгу, факт или помощь с билетом? Оставьте сообщение.', 'Вітаємо! Шукаєте книжку, факт чи допомогу з квитком? Залиште повідомлення.')),
    offline: L(T('We reply by e-mail within one working day.', 'Мы ответим по e-mail в течение рабочего дня.', 'Ми відповімо e-mail протягом робочого дня.')),
    nameField: 'optional', contactField: 'required', sendReq: null, pollReq: null, fallback: 'mailto', to: 'ask@lindgrove-library.example',
  }) : null;
  const ask = K.sec({
    anchor: 'ask', eyebrow: T('Questions', 'Вопросы', 'Питання'),
    title: T('Ask a librarian', 'Спросите библиотекаря', 'Запитайте бібліотекаря'),
  }, [chat ? B('columns', { gap: 40, valign: 'top', cols: [col(46, [chat]), col(54, [faq])] }) : faq]);

  const purposes = T('Free reader card\nStory hour (24 Oct)\nBook club (29 Oct)\nListening afternoon (7 Nov)\nPoetry night (21 Nov)\nWinter book swap (5 Dec)\nSuggest a book',
    'Бесплатный читательский билет\nСказочный час (24 окт.)\nКнижный клуб (29 окт.)\nВечер слушания (7 нояб.)\nВечер поэзии (21 нояб.)\nЗимний книгообмен (5 дек.)\nПредложить книгу',
    'Безкоштовний читацький квиток\nКазкова година (24 жовт.)\nКнижковий клуб (29 жовт.)\nВечір слухання (7 лист.)\nВечір поезії (21 лист.)\nЗимовий книгообмін (5 груд.)\nЗапропонувати книжку');
  const register = K.sec({
    anchor: 'register', tone: 'muted', width: 'narrow',
    eyebrow: T('Card & sign-ups', 'Билет и запись', 'Квиток і запис'),
    title: T('Apply for a card or save a seat', 'Оформите билет или займите место', 'Оформіть квиток або займіть місце'),
    lead: P('One form for everything: a new reader card, an event or a book you would like us to buy. We answer within one working day.',
      'Одна форма для всего: новый читательский билет, событие или книга, которую вы хотите, чтобы мы купили. Отвечаем в течение рабочего дня.',
      'Одна форма для всього: новий читацький квиток, подія чи книжка, яку ви хочете, щоб ми купили. Відповідаємо протягом робочого дня.'),
  }, [B('form', {
    variant: 'card',
    title: L(T('Your request', 'Ваша заявка', 'Ваша заявка')), submit: L(T('Send', 'Отправить', 'Надіслати')),
    req: rqApply.id, fallback: 'mailto', to: 'hello@lindgrove-library.example',
    success: L(T('Thank you! We will confirm by e-mail within one working day.', 'Спасибо! Мы подтвердим по e-mail в течение рабочего дня.', 'Дякуємо! Ми підтвердимо e-mail протягом робочого дня.')),
    consent: L(T('I agree that the library uses my details only to answer this request.', 'Я согласен(на), что библиотека использует мои данные только для ответа на эту заявку.', 'Я погоджуюся, що бібліотека використовує мої дані лише для відповіді на цю заявку.')),
    items: [
      field('name', 'text', T('Full name', 'Имя и фамилия', 'Ім’я та прізвище'), { required: true, half: true }),
      field('email', 'email', T('E-mail', 'E-mail', 'E-mail'), { required: true, half: true }),
      field('topic', 'select', T('I would like…', 'Я хочу…', 'Я хочу…'), { options: purposes, required: true }),
      field('people', 'number', T('Number of people', 'Сколько человек', 'Скільки людей'), { half: true, ph: '1' }),
      field('phone', 'tel', T('Phone', 'Телефон', 'Телефон'), { half: true, ph: '+44 …' }),
      field('message', 'textarea', T('Anything else?', 'Что-нибудь ещё?', 'Щось іще?')),
    ],
  })]);

  const cta = B('cta', {
    variant: 'split', tone: 'accent',
    title: L(T('Can’t find a book? We will get it.', 'Не нашли книгу? Мы её достанем.', 'Не знайшли книжку? Ми її дістанемо.')),
    html: L(P('Interlibrary loans from the whole region arrive in about a week — free with any card.', 'Межбиблиотечный абонемент со всего региона — примерно за неделю, бесплатно с любым билетом.', 'Міжбібліотечний абонемент з усього регіону — приблизно за тиждень, безкоштовно з будь-яким квитком.')),
    items: [K.btn(T('Ask a librarian', 'Спросить библиотекаря', 'Запитати бібліотекаря'), '#ask', 'primary', K.icon('chat'))],
  });

  const visit = K.sec({
    anchor: 'visit', eyebrow: T('Visit', 'Как добраться', 'Як дістатися'),
    title: T('On Orchard Row, by the river', 'На Орчард-Роу, у реки', 'На Орчард-Роу, біля річки'),
  }, [B('contact', {
    variant: 'split', labels: true, map, mapHref: '',
    items: [
      K.item({ kind: 'address', value: '3 Orchard Row\nLindgrove LG1 4QT', label: L(T('Main library', 'Центральная библиотека', 'Центральна бібліотека')), href: '' }),
      K.item({ kind: 'hours', value: '9:00–20:00', label: L(T('Every day; Sundays until 17:00', 'Ежедневно; в воскресенье до 17:00', 'Щодня; у неділю до 17:00')), href: '' }),
      K.item({ kind: 'phone', value: '+44 000 000 1911', label: L(T('Front desk', 'Стойка выдачи', 'Стійка видачі')), href: '' }),
      K.item({ kind: 'email', value: 'hello@lindgrove-library.example', label: L(T('General questions', 'Общие вопросы', 'Загальні питання')), href: '' }),
      K.item({ kind: 'email', value: 'ask@lindgrove-library.example', label: L(T('Reference desk', 'Справочная служба', 'Довідкова служба')), href: '' }),
    ],
  })]);

  d.regions.main = [heroB, stats, newArrivals, catalogue, picks, events, borrow, cta, membership, team, ask, register, visit];

  // ----- footer -----
  const links = (rows) => '<p>' + rows.map(([h, x]) => '<a href="' + h + '">' + x + '</a>').join('<br>') + '</p>';
  d.regions.footer = [B('footer', {
    variant: 'columns', tone: 'dark', logo: brand, logoH: 44,
    brand: L(T('Lindgrove City Library', 'Городская библиотека Линдгроува', 'Міська бібліотека Ліндгроува')),
    text: L(P('A public library since 1911. Books, audiobooks, reading rooms and a kettle that is always on.', 'Публичная библиотека с 1911 года. Книги, аудиокниги, читальные залы и всегда горячий чайник.', 'Публічна бібліотека з 1911 року. Книжки, аудіокнижки, читальні зали й завжди гарячий чайник.')),
    items: [
      K.item({ title: L(T('Collections', 'Фонды', 'Фонди')), html: L(T(
        links([['#catalogue', 'Catalogue'], ['#new', 'New arrivals'], ['#picks', 'Librarians’ picks']]),
        links([['#catalogue', 'Каталог'], ['#new', 'Новые поступления'], ['#picks', 'Выбор библиотекарей']]),
        links([['#catalogue', 'Каталог'], ['#new', 'Нові надходження'], ['#picks', 'Вибір бібліотекарів']]))) }),
      K.item({ title: L(T('Library', 'Библиотека', 'Бібліотека')), html: L(T(
        links([['#events', 'Reading rooms & events'], ['#membership', 'Membership'], ['#librarians', 'Librarians'], ['#cart', 'Your basket']]),
        links([['#events', 'Залы и события'], ['#membership', 'Членство'], ['#librarians', 'Библиотекари'], ['#cart', 'Корзина']]),
        links([['#events', 'Зали й події'], ['#membership', 'Членство'], ['#librarians', 'Бібліотекарі'], ['#cart', 'Кошик']]))) }),
      K.item({ title: L(T('Contact', 'Контакты', 'Контакти')), html: L(T(
        '<p>3 Orchard Row, Lindgrove<br><a href="tel:+440000001911">+44 000 000 1911</a><br><a href="mailto:hello@lindgrove-library.example">hello@lindgrove-library.example</a></p>',
        '<p>Орчард-Роу, 3, Линдгроув<br><a href="tel:+440000001911">+44 000 000 1911</a><br><a href="mailto:hello@lindgrove-library.example">hello@lindgrove-library.example</a></p>',
        '<p>Орчард-Роу, 3, Ліндгроув<br><a href="tel:+440000001911">+44 000 000 1911</a><br><a href="mailto:hello@lindgrove-library.example">hello@lindgrove-library.example</a></p>')) }),
    ],
    copy: L(T('© 2026 Lindgrove City Library · A fictional library: names, books and samples are made up.', '© 2026 Городская библиотека Линдгроува · Вымышленная библиотека: имена, книги и образцы придуманы.', '© 2026 Міська бібліотека Ліндгроува · Вигадана бібліотека: імена, книжки та зразки вигадані.')),
  })];
  return V.normalizeDoc(d);
}

const TPL_LIBRARY = {
  id: 'library',
  name: { en: 'Library', ru: 'Библиотека', uk: 'Бібліотека', de: 'Bibliothek', fr: 'Bibliothèque', es: 'Biblioteca', ka: 'ბიბლიოთეკა' },
  desc: {
    en: 'Public library with text and audio editions: shelf catalogue with search, filters, ranges and sorting, reader and audio player, new arrivals, librarians’ picks, reading rooms and events, free card and memberships, ask a librarian, FAQ and map.',
    ru: 'Публичная библиотека с текстовыми и аудиоизданиями: каталог-полка с поиском, фильтрами, диапазонами и сортировкой, читалка и аудиоплеер, новинки, выбор библиотекарей, залы и события, бесплатный билет и членство, вопрос библиотекарю, FAQ и карта.',
    uk: 'Публічна бібліотека з текстовими та аудіовиданнями: каталог-полиця з пошуком, фільтрами, діапазонами й сортуванням, читалка й аудіоплеєр, новинки, вибір бібліотекарів, зали й події, безкоштовний квиток і членство, питання бібліотекарю, FAQ і мапа.',
    de: 'Öffentliche Bibliothek mit Text- und Hörbuchausgaben: Regal-Katalog mit Suche, Filtern, Bereichen und Sortierung, Leser und Audioplayer, Neuerwerbungen, Empfehlungen, Lesesäle und Veranstaltungen, kostenloser Ausweis und Mitgliedschaften, Auskunft, FAQ und Karte.',
    fr: 'Bibliothèque publique avec éditions texte et audio : catalogue en rayonnage avec recherche, filtres, plages et tri, liseuse et lecteur audio, nouveautés, coups de cœur, salles de lecture et événements, carte gratuite et adhésions, question au bibliothécaire, FAQ et plan.',
    es: 'Biblioteca pública con ediciones de texto y audio: catálogo en estantería con búsqueda, filtros, rangos y orden, lector y reproductor, novedades, recomendaciones, salas de lectura y eventos, carné gratuito y membresías, pregunta al bibliotecario, FAQ y mapa.',
    ka: 'საჯარო ბიბლიოთეკა ტექსტური და აუდიო გამოცემებით: კატალოგი-თარო ძიებით, ფილტრებით, დიაპაზონებითა და დალაგებით, მკითხველი და აუდიოპლეერი, სიახლეები, ბიბლიოთეკართა რჩეული, სამკითხველოები და ღონისძიებები, უფასო ბარათი და წევრობა, კითხვა ბიბლიოთეკარს, FAQ და რუკა.',
  },
  langs: ['en', 'ru', 'uk'],
  build: tplBuildLibrary,
};

export {
  TPL_LIBRARY,
  TPL_LIB_BOOKS,
  TPL_LIB_FONTS,
  TPL_LIB_MODES,
  TPL_LIB_MOTIFS,
  TPL_LIB_TEXTS,
  tplBuildLibrary,
  tplLibBookcase,
  tplLibBrandSVG,
  tplLibChair,
  tplLibCover,
  tplLibHeroSpec,
  tplLibMockup,
  tplLibP,
  tplLibPaint,
  tplLibSketch,
  tplLibT,
  tplLibTable,
  tplLibText,
  tplLibUl,
  tplLibWav,
  tplLibWrap
};
