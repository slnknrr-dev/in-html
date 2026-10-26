// catalog/covers.js - covers of works and collections: the resolution chain (own cover, the container's, an
// embedded / sidecar picture, a video frame, a generated one) and virtual covers — deterministic SVG designs from
// the title and a colour hash (the same title always gets the same cover), collages for playlists, and the
// parameters a small cover editor changes.
//
// Cover refs (work.cover / media.cover / collection.cover):
//   { blob: id, mime }            bytes in the blob store (uploaded, extracted from tags, a converted frame)
//   { loc: { kind: 'fs' | 'fsa' | 'remote' | 'url', mount, path, … } }   a sidecar picture (cover.jpg, folder.jpg, poster…)
//   { frame: { media, at } }      a video frame (made by ffmpeg on the server or a canvas in the browser)
//   { url }                       a picture the user linked (shown only when remote pictures are allowed)
//   { gen: { style, seed, hue, hue2, title, subtitle, text, pattern, dark } }   generated (generatedCover)
//
//   COVER_STYLES = ['gradient', 'vinyl', 'cassette', 'book', 'film', 'wave', 'grid', 'mono']
//   styleFor(kind) -> default style of a kind
//   coverChain(db, node) -> [refs] in order of preference ending with a generated one
//   genParams(node, overrides) -> { style, seed, hue, hue2, title, subtitle, … } (deterministic)
//   generatedCover(params, { size = 512 }) -> SVG text (no external resources, no scripts)
//   collageSVG(images: [href], { size = 512, gap = 0, background }) -> SVG text (1–4 pictures as a 2x2 grid)
//   hashString(s) -> 32-bit hash ; palette(seed, hue?) -> { bg, bg2, fg, accent, muted }
//
// Key decisions:
// - Generated covers are SVG text, not canvas bitmaps: resolution-independent, a few KB, producible without a DOM
//   (backend, tests), and stored as parameters ({ gen }) rather than pixels, so the editor can re-open them.
// - Determinism: every random-looking choice derives from hashString(seed); the same title always yields the same
//   cover across devices and sessions. Math.random would give each replica a different cover for the same work.
// - Colours are picked in OKLCH (perceptually uniform lightness), so foreground/background contrast is the same
//   for every hue; equal-L HSL colours vary wildly in perceived brightness (yellow vs blue) and break legibility.
// - Security: everything interpolated into SVG markup is either a number, a hex colour from toHex, or passed through
//   esc(). Generated SVG contains no scripts and no external references (except collage <image> hrefs the caller
//   provides), so it is safe to inline or use as an <img> data URL.

import { oklchToSrgbMapped } from '../color/space.js';
import { toHex } from '../color/css.js';
import { displayTitle, firstPerson } from './model.js';
import { facts } from './facts.js';

export const COVER_STYLES = ['gradient', 'vinyl', 'cassette', 'book', 'film', 'wave', 'grid', 'mono'];
const KIND_STYLE = { track: 'vinyl', album: 'vinyl', musicvideo: 'film', book: 'book', bookseries: 'book', chapter: 'book', movie: 'film', show: 'film', season: 'film', episode: 'film', podcast: 'wave' };
export const styleFor = (kind) => KIND_STYLE[kind] || 'gradient';

// FNV-1a over code points, then a murmur-style finaliser (xor-shift, multiply, xor-shift). FNV alone has weak
// avalanche in the high bits for short similar strings ("Ep 1" vs "Ep 2"); the finaliser spreads small input changes
// across all 32 bits, which matters because callers slice the hash into several independent bit fields.
export function hashString(s) {
  let h = 2166136261 >>> 0;
  for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15;
  return h >>> 0;
}

// OKLCH -> sRGB with gamut mapping (high-chroma colours at some hues fall outside sRGB and would clip unevenly).
// Hue is wrapped into [0, 360) so callers may add offsets freely.
const hex = (L, C, H) => toHex(oklchToSrgbMapped([L, C, ((H % 360) + 360) % 360]));

// Two hues: the base and a second one 35..144 degrees away (from different hash bits), giving an analogous-to-
// complementary gradient without ever landing on the same hue. Lightness is fixed per role, so fg on bg keeps a
// large L gap (0.96 vs 0.32 dark, 0.22 vs 0.9 light) whatever the hue: legible text by construction.
export function palette(seed, hue, { dark = true, hue2 } = {}) {
  const h = hashString(seed);
  const H = Number.isFinite(hue) ? hue : h % 360;
  const H2 = Number.isFinite(hue2) ? hue2 : H + 35 + ((h >>> 9) % 110);
  return dark
    ? { bg: hex(0.32, 0.09, H), bg2: hex(0.22, 0.07, H2), fg: hex(0.96, 0.02, H), accent: hex(0.78, 0.15, H2), muted: hex(0.72, 0.05, H), hue: H, hue2: H2 }
    : { bg: hex(0.9, 0.06, H), bg2: hex(0.8, 0.09, H2), fg: hex(0.22, 0.04, H), accent: hex(0.55, 0.18, H2), muted: hex(0.4, 0.05, H), hue: H, hue2: H2 };
}

// Parameters of a generated cover; overrides are what the cover editor changed. The seed includes the kind, so a
// book and its film adaptation with the same title still get different covers.
export function genParams(node, overrides = {}) {
  const title = (overrides.title ?? (node && (displayTitle(node) || node.name))) || '';
  const subtitle = overrides.subtitle ?? (node ? (firstPerson(node, 'albumartist') || firstPerson(node, 'artist') || firstPerson(node, 'author') || (node.year ? String(node.year) : '')) : '');
  const seed = overrides.seed || (node ? `${node.kind || node.type}:${title}` : title);
  const h = hashString(seed);
  return {
    style: COVER_STYLES.includes(overrides.style) ? overrides.style : styleFor(node && node.kind),
    seed, title, subtitle, text: overrides.text || '',
    hue: Number.isFinite(overrides.hue) ? overrides.hue : h % 360,
    hue2: Number.isFinite(overrides.hue2) ? overrides.hue2 : undefined,
    pattern: Number.isFinite(overrides.pattern) ? overrides.pattern : (h >>> 5) % 4,
    dark: overrides.dark !== false,
  };
}

// Candidates in preference order; the renderer tries each and falls through on failure (missing blob, unreachable
// file, remote pictures disabled). The chain always ends with a generated cover, so the fallback never fails.
// Order: own real cover > media covers (embedded art) > nearest containers' real covers > a video frame at 10% of
// the duration clamped to 5..120 s (skips cold opens / black leaders without seeking deep into long files) >
// own generated cover. A track / episode / chapter without its own generated cover borrows its parent's generated
// design (when the parent has no real cover), so an album's tracks share one look instead of N random ones.
export function coverChain(db, node) {
  const out = [];
  if (!node) return out;
  if (node.cover && !node.cover.gen) out.push(node.cover);
  if (node.type === 'work') {
    for (const m of db.mediaOf(node.id)) if (m.cover) out.push(m.cover);
    let p = node.parent ? db.get(node.parent) : null;
    for (let i = 0; p && i < 4; i++) { if (p.cover && !p.cover.gen) out.push(p.cover); p = p.parent ? db.get(p.parent) : null; }
    const f = facts(db, node);
    if (f.has.has('video')) { const v = db.mediaOf(node.id).find((m) => m.video && m.presence === 'file'); if (v) out.push({ frame: { media: v.id, at: Math.min(120, Math.max(5, (v.duration || 60) * 0.1)) } }); }
  }
  if (node.cover && node.cover.gen) out.push(node.cover);
  else {
    const top = node.type === 'work' && node.parent && ['track', 'episode', 'chapter'].includes(node.kind) ? db.get(node.parent) : null;
    out.push({ gen: genParams(top && !(top.cover && !top.cover.gen) ? top : node) });
  }
  return out;
}

// XML escaping for text nodes and attribute values (both quote styles), the only gate between titles and markup.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Title lines for a box: words wrapped by a rough character budget, at most `max` lines (ellipsis).
// Character count, not measured width: no DOM / font metrics are available when generating on a backend, and SVG
// <text> does not wrap by itself. CJK glyphs are about twice as wide as Latin, so such titles may overflow; the
// final map hard-truncates any single overlong word so one long token cannot run off the cover.
function lines(text, perLine, max) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const out = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > perLine && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
    if (out.length === max) break;
  }
  if (cur && out.length < max) out.push(cur);
  if (out.length === max && words.join(' ').length > out.join(' ').length) out[max - 1] = out[max - 1].replace(/.{0,2}$/, '…');
  return out.map((l) => (l.length > perLine + 6 ? l.slice(0, perLine + 4) + '…' : l));
}

function textBlock(ls, { x, y, size, fill, anchor = 'start', weight = 700, lh = 1.12 }) {
  return ls.map((l, i) => `<text x="${x}" y="${(y + i * size * lh).toFixed(1)}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(l)}</text>`).join('');
}

// All designs are drawn on a fixed 512 x 512 user space (S) and scaled by width / height = size: one coordinate set
// per design, any output size. r(n, k) draws "random" integers from different bit offsets of one hash.
// The gradient id is derived from the hash so two covers inlined in one HTML document rarely clash on id (ids
// are document-global, and url(#id) would pick the first one); collisions remain possible, 1 in 1e6.
// Note: `...params` is spread after genParams, so raw params override the validated values; an unknown style falls
// to the default branch and non-numeric hues are re-checked in palette(), so this stays safe for markup.
export function generatedCover(params, { size = 512 } = {}) {
  const p = { ...genParams(null, params), ...params };
  const c = palette(p.seed, p.hue, { dark: p.dark, hue2: p.hue2 });
  const S = 512;
  const h = hashString(p.seed);
  const r = (n, k = 0) => ((h >>> (k % 24)) % n);
  const title = lines(p.title || '?', 16, 3);
  const sub = p.subtitle ? lines(p.subtitle, 26, 1) : [];
  let art = '';
  let txt = '';
  const id = 'g' + (h % 1e6).toString(36);
  const defs = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.bg}"/><stop offset="1" stop-color="${c.bg2}"/></linearGradient></defs>`;
  switch (p.style) {
    case 'vinyl': {
      const cx = 256 + (r(5) - 2) * 6;
      art = `<circle cx="${cx}" cy="230" r="170" fill="#0d0d10"/>` +
        [150, 135, 120, 105, 90].map((rr) => `<circle cx="${cx}" cy="230" r="${rr}" fill="none" stroke="#24242a" stroke-width="2"/>`).join('') +
        `<circle cx="${cx}" cy="230" r="62" fill="${c.accent}"/><circle cx="${cx}" cy="230" r="7" fill="#0d0d10"/>` +
        `<path d="M${cx - 120} 120 A170 170 0 0 1 ${cx + 40} 62" fill="none" stroke="#ffffff22" stroke-width="10" stroke-linecap="round"/>`;
      txt = textBlock(title, { x: 256, y: 444, size: 34, fill: c.fg, anchor: 'middle' }) + textBlock(sub, { x: 256, y: 444 + title.length * 38 + 4, size: 22, fill: c.muted, anchor: 'middle', weight: 500 });
      break;
    }
    case 'cassette':
      art = `<rect x="66" y="120" width="380" height="240" rx="22" fill="#18181c"/><rect x="96" y="148" width="320" height="96" rx="10" fill="${c.accent}"/>` +
        `<circle cx="186" cy="300" r="34" fill="#2a2a30"/><circle cx="326" cy="300" r="34" fill="#2a2a30"/><circle cx="186" cy="300" r="12" fill="${c.bg}"/><circle cx="326" cy="300" r="12" fill="${c.bg}"/>` +
        `<rect x="220" y="284" width="72" height="30" rx="6" fill="#0e0e12"/>`;
      txt = textBlock(lines(p.title, 18, 2), { x: 256, y: 186, size: 26, fill: '#101014', anchor: 'middle' }) + textBlock(sub, { x: 256, y: 430, size: 24, fill: c.fg, anchor: 'middle', weight: 500 });
      break;
    case 'book':
      art = `<rect x="0" y="0" width="54" height="512" fill="${c.bg2}"/><rect x="54" y="0" width="6" height="512" fill="#00000033"/>` +
        `<rect x="98" y="300" width="360" height="3" fill="${c.accent}"/><rect x="98" y="80" width="360" height="3" fill="${c.accent}"/>` +
        (p.pattern % 2 ? `<circle cx="400" cy="420" r="46" fill="none" stroke="${c.accent}" stroke-width="3"/>` : `<path d="M98 440 l40-40 40 40 40-40 40 40" fill="none" stroke="${c.accent}" stroke-width="3"/>`);
      txt = textBlock(lines(p.title, 14, 4), { x: 98, y: 140, size: 40, fill: c.fg, weight: 700 }) + textBlock(sub, { x: 98, y: 350, size: 24, fill: c.muted, weight: 500 });
      break;
    case 'film': {
      const holes = Array.from({ length: 9 }, (_, i) => `<rect x="${18 + i * 56}" y="14" width="30" height="20" rx="4" fill="#00000066"/><rect x="${18 + i * 56}" y="478" width="30" height="20" rx="4" fill="#00000066"/>`).join('');
      art = `<rect x="0" y="0" width="512" height="48" fill="#0b0b0e"/><rect x="0" y="464" width="512" height="48" fill="#0b0b0e"/>${holes}` +
        `<circle cx="${380 - r(60)}" cy="${180 + r(40, 3)}" r="${70 + r(40, 6)}" fill="${c.accent}" opacity=".85"/>` +
        `<path d="M0 400 L${140 + r(80)} ${300 - r(60, 4)} L${260 + r(60, 2)} 380 L${360 + r(50, 8)} ${290 - r(40, 5)} L512 390 L512 464 L0 464 Z" fill="#00000055"/>`;
      txt = textBlock(lines(p.title, 15, 3), { x: 40, y: 120, size: 42, fill: c.fg }) + textBlock(sub, { x: 40, y: 444, size: 22, fill: c.muted, weight: 500 });
      break;
    }
    case 'wave': {
      const waves = Array.from({ length: 6 }, (_, i) => {
        const y = 250 + i * 16, a = 20 + ((h >>> i) % 40);
        return `<path d="M0 ${y} C 128 ${y - a}, 256 ${y + a}, 384 ${y - a / 2} S 512 ${y + a / 3}, 512 ${y}" fill="none" stroke="${i % 2 ? c.accent : c.fg}" stroke-width="${3 + (i % 3)}" opacity="${(0.9 - i * 0.12).toFixed(2)}"/>`;
      }).join('');
      art = waves + `<circle cx="430" cy="90" r="36" fill="${c.accent}"/>`;
      txt = textBlock(lines(p.title, 18, 2), { x: 40, y: 400, size: 38, fill: c.fg }) + textBlock(sub, { x: 40, y: 470, size: 22, fill: c.muted, weight: 500 });
      break;
    }
    case 'grid': {
      const cells = [];
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        const k = (h >>> ((x + y * 4) % 24)) & 3;
        const X = x * 128, Y = y * 128;
        cells.push(k === 0 ? `<circle cx="${X + 64}" cy="${Y + 64}" r="48" fill="${c.accent}" opacity=".8"/>` : k === 1 ? `<path d="M${X} ${Y + 128} L${X + 128} ${Y} L${X + 128} ${Y + 128} Z" fill="${c.bg2}"/>` : k === 2 ? `<rect x="${X + 24}" y="${Y + 24}" width="80" height="80" fill="none" stroke="${c.fg}" stroke-width="4" opacity=".5"/>` : '');
      }
      art = cells.join('') + `<rect x="0" y="330" width="512" height="182" fill="${c.bg}" opacity=".92"/>`;
      txt = textBlock(lines(p.title, 18, 2), { x: 36, y: 392, size: 38, fill: c.fg }) + textBlock(sub, { x: 36, y: 480, size: 22, fill: c.muted, weight: 500 });
      break;
    }
    // Initials via [...w][0] (code points), not w[0]: w[0] would split a surrogate pair and emit half an emoji or a
    // broken astral CJK character.
    case 'mono': {
      const initials = (p.title || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]).join('').toUpperCase();
      art = `<text x="256" y="330" font-size="230" font-weight="800" fill="${c.accent}" text-anchor="middle" opacity=".9">${esc(initials)}</text>`;
      txt = textBlock(lines(p.title, 22, 2), { x: 256, y: 430, size: 28, fill: c.fg, anchor: 'middle' }) + textBlock(sub, { x: 256, y: 484, size: 20, fill: c.muted, anchor: 'middle', weight: 500 });
      break;
    }
    default: {
      art = `<circle cx="${100 + r(320)}" cy="${80 + r(200, 7)}" r="${120 + r(80, 3)}" fill="${c.accent}" opacity=".35"/>` +
        `<circle cx="${80 + r(300, 11)}" cy="${200 + r(180, 2)}" r="${90 + r(70, 5)}" fill="${c.bg2}" opacity=".6"/>`;
      txt = textBlock(lines(p.title, 16, 3), { x: 40, y: 330, size: 44, fill: c.fg }) + textBlock(sub, { x: 40, y: 330 + Math.min(3, title.length) * 50 + 10, size: 24, fill: c.muted, weight: 500 });
    }
  }
  const extra = p.text ? textBlock(lines(p.text, 30, 1), { x: 476, y: 44, size: 18, fill: c.muted, anchor: 'end', weight: 600 }) : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${size}" height="${size}" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', sans-serif">${defs}` +
    `<rect width="${S}" height="${S}" fill="url(#${id})"/>${art}${txt}${extra}</svg>`;
}

// Layouts: 1 = full, 2 = halves, 3 = one tall + two stacked, 4 = 2x2. preserveAspectRatio "slice" crops pictures
// to fill their cell (like CSS object-fit: cover) instead of letterboxing. `gap` insets each cell by gap/2 on every
// side. Hrefs are escaped but not filtered: the caller decides which URLs are allowed (blob:, data:, remote).
export function collageSVG(images, { size = 512, gap = 0, background = '#111' } = {}) {
  const list = images.filter(Boolean).slice(0, 4);
  const S = 512;
  const cells = list.length <= 1 ? [[0, 0, S, S]] : list.length === 2 ? [[0, 0, S / 2, S], [S / 2, 0, S / 2, S]]
    : list.length === 3 ? [[0, 0, S / 2, S], [S / 2, 0, S / 2, S / 2], [S / 2, S / 2, S / 2, S / 2]]
      : [[0, 0, S / 2, S / 2], [S / 2, 0, S / 2, S / 2], [0, S / 2, S / 2, S / 2], [S / 2, S / 2, S / 2, S / 2]];
  const g = gap / 2;
  const body = list.map((href, i) => {
    const [x, y, w, hh] = cells[i];
    return `<image href="${esc(href)}" x="${x + g}" y="${y + g}" width="${w - gap}" height="${hh - gap}" preserveAspectRatio="xMidYMid slice"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${size}" height="${size}"><rect width="${S}" height="${S}" fill="${esc(background)}"/>${body}</svg>`;
}
