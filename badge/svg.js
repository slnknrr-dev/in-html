// badge/svg.js - badges drawn locally in the five shields.io styles (flat, flat-square, plastic, for-the-badge,
// social): two coloured halves with Verdana-like text widths, so README previews show static badges without the
// network. Logos are not drawn (simple-icons are not bundled); the label keeps its place.
//
//   badgeSVG({ label, message, color, labelColor, style }) -> SVG text
//   badgeDataURI(opts) -> 'data:image/svg+xml,…'      textWidth(text, big) -> px of Verdana 11 px (bold 10 px caps)
//
// Design decisions:
// - Text width is estimated from character classes, not measured with canvas.measureText: the module stays pure
//   (works in Node and workers) and the output is deterministic across machines and installed fonts. The cost is
//   a few pixels of error on unusual glyphs, absorbed by the padding.
// - All interpolated text goes through esc(): label and message are user input embedded in markup.
// KNOWN DEFECT: the clipPath id "r" and gradient id "s" are fixed. Two badges inlined into one HTML document share
// one id space, so the second badge references the first one's clip (wrong width). Harmless for data: URIs in <img>,
// which are isolated documents. Fix: suffix ids with a per-call counter or a hash of the content.

import { colorHex } from './shields.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Width classes approximating Verdana 11px advance widths (shields.io itself uses a measured Verdana table).
const NARROW = new Set("ijl.,:;'|!()[]{}`");
const SEMI = new Set('frtI1 /\\-"');
const WIDE = new Set('mwMW@%');

export function textWidth(text, big = false) {
  let w = 0;
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    if (NARROW.has(ch)) w += 3.4;
    else if (SEMI.has(ch)) w += ch === ' ' ? 3.9 : 4.6;
    else if (WIDE.has(ch)) w += 10.2;
    else if (ch >= 'A' && ch <= 'Z') w += 7.6;
    else if (ch >= '0' && ch <= '9') w += 7;
    else if (c < 0x80) w += 6.6;
    else if (c >= 0x2e80) w += 11; // CJK, emoji
    else w += 7.2;
  }
  // for-the-badge: bold 10px caps is slightly narrower per glyph, but letter-spacing 1.1 adds per character.
  return big ? w * 0.98 + String(text).length * 1.25 : w;
}

// Readable text colour on a badge half (shields.io switches to dark text on light colours).
// Uses Rec. 601 luma, not WCAG relative luminance: cheap, and only a two-way light/dark choice is needed.
// Returns [text fill, shadow fill]; the shadow is the inverse tone so embossed text reads on both.
function textOn(hex) {
  const v = hex.length === 4 ? hex.slice(1).split('').map((x) => parseInt(x + x, 16)) : [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
  const lum = (0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2]) / 255;
  return lum > 0.65 ? ['#333', '#ccc'] : ['#fff', '#010101'];
}

export function badgeSVG({ label = '', message = '', color = '', labelColor = '', style = '' } = {}) {
  const big = style === 'for-the-badge';
  let L = String(label), M = String(message);
  if (big) { L = L.toUpperCase(); M = M.toUpperCase(); }
  const pad = big ? 12 : 6, H = big ? 28 : 20;
  const lw = L ? Math.round(textWidth(L, big) + pad * 2) : 0;
  const mw = Math.round(textWidth(M, big) + pad * 2);
  const W = lw + mw;
  const lc = colorHex(labelColor, '#555555'), mc = colorHex(color, '#007ec6');
  const [lt, ls] = textOn(lc), [mt, ms] = textOn(mc);
  const font = `font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="${big ? 10 : 11}"${big ? ' font-weight="bold" letter-spacing="1.1"' : ''}`;
  const ty = big ? 18 : 14;
  const shadow = style === 'flat' || style === '' || style === 'plastic';
  const txt = (x, s, fill, sh) => (s ? (shadow ? `<text x="${x}" y="${ty + 1}" fill="${sh}" fill-opacity=".3">${esc(s)}</text>` : '') + `<text x="${x}" y="${ty}" fill="${fill}">${esc(s)}</text>` : '');
  const title = `<title>${esc([L, M].filter(Boolean).join(': '))}</title>`;
  // Social style is structurally different (outlined label box plus a speech-bubble counter), so it gets its own
  // template rather than flags threaded through the two-half layout.
  if (style === 'social') {
    const sw = Math.round(textWidth(M) + 12), lw2 = Math.round(textWidth(L || ' ') + 14);
    const w2 = lw2 + (M ? sw + 6 : 0);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w2}" height="20" role="img" aria-label="${esc(L)}">${title}<rect x=".5" y=".5" width="${lw2 - 1}" height="19" rx="2" fill="#fcfcfc" stroke="#d5d5d5"/>` +
      (M ? `<rect x="${lw2 + 6.5}" y=".5" width="${sw - 1}" height="19" rx="2" fill="#fafafa" stroke="#d5d5d5"/><path d="M${lw2 + 6.5} 7.5l-3 2.5 3 2.5" fill="#fafafa" stroke="#d5d5d5"/>` : '') +
      `<g ${font} font-weight="bold" fill="#333"><text x="7" y="14">${esc(L)}</text>${M ? `<text x="${lw2 + 12}" y="14" font-weight="normal">${esc(M)}</text>` : ''}</g></svg>`;
  }
  // Corner radius per style; rounding is applied once by a clipPath over both halves, so the seam stays square.
  const r = style === 'flat-square' || big ? 0 : style === 'plastic' ? 4 : 3;
  const grad = style === 'plastic'
    ? '<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset=".1" stop-color="#aaa" stop-opacity=".1"/><stop offset=".9" stop-opacity=".3"/><stop offset="1" stop-opacity=".5"/></linearGradient>'
    : shadow ? '<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>' : '';
  const Hh = style === 'plastic' ? 18 : H;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hh}" role="img" aria-label="${esc([L, M].filter(Boolean).join(': '))}">${title}${grad}` +
    `<clipPath id="r"><rect width="${W}" height="${Hh}" rx="${r}" fill="#fff"/></clipPath><g clip-path="url(#r)">` +
    (lw ? `<rect width="${lw}" height="${Hh}" fill="${lc}"/>` : '') + `<rect x="${lw}" width="${mw}" height="${Hh}" fill="${mc}"/>` +
    (grad ? `<rect width="${W}" height="${Hh}" fill="url(#s)"/>` : '') + '</g>' +
    `<g text-anchor="middle" ${font}>${txt(lw / 2, L, lt, ls)}${txt(lw + mw / 2, M, mt, ms)}</g></svg>`;
}

// encodeURIComponent rather than base64: shorter for ASCII-heavy SVG and needs no btoa (which fails on non-Latin-1).
export const badgeDataURI = (opts) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(badgeSVG(opts));
