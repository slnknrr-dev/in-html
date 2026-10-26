// sample/svg.js - sample SVG artwork: gradient avatars with initials, abstract illustrations.
import { tplHash, tplHexToHsl, tplHsl, tplRand, tplUtf8 } from './bytes.js';
import { b64encode } from '../codec/base64.js';
import { escapeHTML } from '../html/escape.js';

/** Gradient avatar with initials → base64 SVG (256×256, square; the renderer crops the shape). */
// Colours are derived in HSL from one brand colour, so avatars harmonise with it; initials are escaped because they
// come from user names and are embedded in markup. Gradient ids are fixed ('g', 'h'), safe here because the SVG is
// delivered as a separate image (base64 data URI), never inlined next to another copy.
function tplAvatarSVG(initials, color = '#0f766e') {
  const [h, s, l] = tplHexToHsl(color);
  const c1 = tplHsl(h - 12, Math.min(90, s + 8), Math.min(62, l + 12));
  const c2 = tplHsl(h + 38, Math.min(85, s + 4), Math.max(22, l - 10));
  const txt = escapeHTML(String(initials || '?').trim().slice(0, 3).toUpperCase());
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">' +
    '<defs>' +
    '<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + c1 + '"/>' +
    '<stop offset="1" stop-color="' + c2 + '"/></linearGradient>' +
    '<radialGradient id="h" cx=".28" cy=".22" r=".85"><stop offset="0" stop-color="#fff" stop-opacity=".38"/>' +
    '<stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>' +
    '</defs>' +
    '<rect width="256" height="256" fill="url(#g)"/>' +
    '<circle cx="222" cy="34" r="96" fill="#fff" opacity=".09"/>' +
    '<circle cx="18" cy="236" r="84" fill="#000" opacity=".09"/>' +
    '<path d="M0 196 C 70 168 150 226 256 182 L256 256 L0 256 Z" fill="#000" opacity=".07"/>' +
    '<rect width="256" height="256" fill="url(#h)"/>' +
    '<text x="128" y="128" dy=".35em" text-anchor="middle" fill="#fff" font-size="100" font-weight="600" letter-spacing="2" ' +
    'font-family="system-ui,-apple-system,\'Segoe UI\',Roboto,\'Helvetica Neue\',Arial,sans-serif">' + txt + '</text>' +
    '</svg>';
  return b64encode(tplUtf8(svg));
}

/**
 * Abstract portfolio artwork → base64 SVG (800×520). Decoration is derived deterministically from the
 * label; `variant` picks the composition: 0 = phone mock-up, 1 = poster/sun, 2 = tile grid (default: from label).
 */
// Seeded by label + hue, so the same project title always gets the same artwork.
function tplImageSVG(label, hue = 200, variant = null) {
  const rnd = tplRand(tplHash(label + ':' + hue));
  if (![0, 1, 2].includes(variant)) variant = tplHash(label) % 3;
  const H = hue;
  const parts = [];
  parts.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520" width="800" height="520">');
  parts.push('<defs>' +
    '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + tplHsl(H, 72, 60) + '"/>' +
    '<stop offset="1" stop-color="' + tplHsl(H + 48, 70, 34) + '"/></linearGradient>' +
    '<linearGradient id="card" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".96"/>' +
    '<stop offset="1" stop-color="#fff" stop-opacity=".82"/></linearGradient>' +
    '<pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="2" fill="#fff" opacity=".16"/></pattern>' +
    '</defs>');
  parts.push('<rect width="800" height="520" fill="url(#bg)"/><rect width="800" height="520" fill="url(#dots)"/>');
  // Soft floating circles.
  for (let i = 0; i < 5; i++) {
    const cx = Math.round(rnd() * 800), cy = Math.round(rnd() * 420), r = Math.round(40 + rnd() * 150);
    const fill = i % 2 ? '#fff' : tplHsl(H + 160 + rnd() * 60, 85, 66);
    parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + fill + '" opacity="' + (0.1 + rnd() * 0.22).toFixed(2) + '"/>');
  }
  parts.push('<path d="M0 ' + (360 + Math.round(rnd() * 40)) + ' C 220 ' + (290 + Math.round(rnd() * 40)) + ' 420 ' +
    (450 + Math.round(rnd() * 30)) + ' 800 ' + (340 + Math.round(rnd() * 40)) + ' L800 520 L0 520 Z" fill="' +
    tplHsl(H + 24, 60, 22) + '" opacity=".5"/>');
  const ink = tplHsl(H + 30, 55, 30);
  const accent = tplHsl(H + 180, 80, 55);
  if (variant === 0) {
    // Phone mock-up with UI lines.
    parts.push('<g transform="rotate(-6 590 230)"><rect x="480" y="40" width="220" height="380" rx="30" fill="url(#card)"/>' +
      '<rect x="500" y="76" width="180" height="96" rx="14" fill="' + tplHsl(H, 70, 62) + '"/>' +
      '<rect x="500" y="190" width="130" height="12" rx="6" fill="' + ink + '" opacity=".75"/>' +
      '<rect x="500" y="212" width="170" height="10" rx="5" fill="' + ink + '" opacity=".35"/>' +
      '<rect x="500" y="230" width="150" height="10" rx="5" fill="' + ink + '" opacity=".35"/>' +
      '<rect x="500" y="262" width="80" height="80" rx="14" fill="' + accent + '" opacity=".85"/>' +
      '<rect x="590" y="262" width="80" height="80" rx="14" fill="' + tplHsl(H + 40, 70, 55) + '" opacity=".85"/>' +
      '<rect x="500" y="364" width="170" height="34" rx="17" fill="' + ink + '"/></g>');
  } else if (variant === 1) {
    // Poster: big sun + stripes.
    parts.push('<circle cx="560" cy="210" r="150" fill="' + accent + '" opacity=".9"/>');
    for (let i = 0; i < 6; i++) {
      parts.push('<rect x="410" y="' + (150 + i * 26) + '" width="300" height="10" fill="' + tplHsl(H + 10, 65, 25) + '" opacity="' + (0.15 + i * 0.1).toFixed(2) + '"/>');
    }
    parts.push('<rect x="380" y="60" width="360" height="300" fill="none" stroke="#fff" stroke-width="3" opacity=".7"/>');
  } else {
    // Tile grid (brand system).
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) {
        const shade = tplHsl(H + (r * 4 + c) * 23, 70, 45 + ((r + c) % 3) * 10);
        const shape = (r + c) % 3;
        const x = 420 + c * 84, yy = 60 + r * 96;
        if (shape === 0) parts.push('<rect x="' + x + '" y="' + yy + '" width="72" height="84" rx="12" fill="' + shade + '"/>');
        else if (shape === 1) parts.push('<circle cx="' + (x + 36) + '" cy="' + (yy + 42) + '" r="36" fill="' + shade + '"/>');
        else parts.push('<path d="M' + x + ' ' + (yy + 84) + ' L' + (x + 36) + ' ' + yy + ' L' + (x + 72) + ' ' + (yy + 84) + ' Z" fill="' + shade + '"/>');
      }
    }
  }
  const font = 'font-family="system-ui,-apple-system,\'Segoe UI\',Roboto,\'Helvetica Neue\',Arial,sans-serif"';
  parts.push('<text x="48" y="404" fill="#fff" opacity=".85" font-size="16" letter-spacing="6" ' + font + '>PORTFOLIO</text>');
  parts.push('<text x="48" y="456" fill="#fff" font-size="42" font-weight="700" ' + font + '>' + escapeHTML(label) + '</text>');
  parts.push('</svg>');
  return b64encode(tplUtf8(parts.join('')));
}

export {
  tplAvatarSVG,
  tplImageSVG
};
