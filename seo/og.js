// seo/og.js - the Open Graph card: a 1200×630 SVG (the 1.91:1 size Open Graph and Twitter expect) with a gradient,
// a title of up to three lines, a subtitle, a badge and the site name, laid out without fonts: text width is
// estimated per character class (narrow / capital / wide letters, Cyrillic and Mkhedruli wider than Latin), words
// wider than a line are cut by characters and a cut tail gets an ellipsis. Rasterising is the caller's business
// (canvas, resvg, a browser); the cache name fingerprints the content, so a renamed page gets a new picture.
import { escapeXML } from '../xml/xml.js';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
export const OG_STYLE_VERSION = 1;

export const OG_THEMES = {
  site: ['#0f172a', '#020617'], teal: ['#0f766e', '#065f46'], blue: ['#1d4ed8', '#1e3a8a'], amber: ['#b45309', '#7c2d12'],
  indigo: ['#4338ca', '#312e81'], rose: ['#be185d', '#831843'], green: ['#15803d', '#14532d'],
};
export const OG_FONTS = "'Noto Sans','DejaVu Sans','Segoe UI',system-ui,sans-serif";

// Why estimate widths instead of measuring: the SVG is produced where no font engine exists (build scripts, workers)
// and rasterised elsewhere with an unknown fallback font. A per-class estimate with safe margins wraps nearly the
// same everywhere; real measurement would only be exact for one font anyway.
const NARROW = new Set([...' iljtfr.,;:\'!|()[]']);
const WIDE_UP = new Set([...'MWÆŒШЩЖЮЫМФ']);
const WIDE_LO = new Set([...'mwшщжюыф']);
// Width of a string in "average lower-case Latin letters" of a bold sans-serif.
export function textWidth(s) {
  let w = 0;
  for (const ch of String(s == null ? '' : s)) {
    const c = ch.codePointAt(0);
    if (c >= 0x10a0 && c <= 0x10ff) w += 1.15;
    else if (NARROW.has(ch)) w += 0.5;
    else if (WIDE_UP.has(ch)) w += 1.6;
    else if (WIDE_LO.has(ch)) w += 1.4;
    else if (c >= 0x0400 && c <= 0x04ff) w += ch !== ch.toLowerCase() ? 1.3 : 1.05;
    else if (c < 0x80) w += (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') ? 1.25 : 1;
    else if ((c >= 0x2e80 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af) || c >= 0x1f000) w += 2;
    else w += 1.2;
  }
  return w;
}

// At most `maxLines` lines of width `maxW` (in textWidth units); long words are cut, a cut tail ends with '…'.
// Greedy line filling (first fit), the same strategy browsers use for normal text; optimal (Knuth-Plass) breaking is
// not worth it for three lines. The ellipsis check compares total widths to detect that text was dropped.
export function wrapText(s, maxW, maxLines) {
  const src = String(s == null ? '' : s).trim();
  const words = src.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  const push = () => { if (cur) { lines.push(cur); cur = ''; } };
  outer: for (const w0 of words) {
    let w = w0;
    while (textWidth(w) > maxW) {
      push();
      let take = '';
      for (const ch of w) { if (textWidth(take + ch) > maxW) break; take += ch; }
      if (!take) take = [...w][0];
      lines.push(take);
      w = w.slice(take.length);
      if (lines.length >= maxLines) break outer;
    }
    if (!w) continue;
    const next = cur ? cur + ' ' + w : w;
    if (textWidth(next) > maxW) { push(); if (lines.length >= maxLines) break; cur = w; } else cur = next;
  }
  push();
  if (lines.length > maxLines) lines.length = maxLines;
  if (lines.length === maxLines && textWidth(lines.join(' ')) < textWidth(src) - 0.5) {
    let last = lines[maxLines - 1];
    while (last && textWidth(last + '…') > maxW) last = [...last].slice(0, -1).join('');
    lines[maxLines - 1] = last.replace(/[\s,.;:—-]+$/, '') + '…';
  }
  return lines;
}

// Card { title, subtitle?, badge?, brand?, theme? (OG_THEMES key or [from, to]), accent?, fonts? } -> SVG text.
export function ogCardSvg(card = {}) {
  const tint = Array.isArray(card.theme) ? card.theme : OG_THEMES[card.theme] || OG_THEMES.site;
  const fonts = card.fonts || OG_FONTS;
  const title = wrapText(card.title || '', 26, 3);
  const sub = card.subtitle ? wrapText(card.subtitle, 44, 1) : [];
  const badge = wrapText(String(card.badge || '').slice(0, 60), 40, 1)[0] || '';
  const brand = wrapText(String(card.brand || '').slice(0, 80), 54, 1)[0] || '';
  const x = (s) => escapeXML(s).replace(/"/g, '&quot;');
  // Vertical centring of 1-3 title lines around y = 300: each extra line moves the block up by half a line height.
  const titleTop = 300 - (title.length - 1) * 34;
  const rows = title.map((ln, i) => `<text x="72" y="${titleTop + i * 78}" font-family="${x(fonts)}" font-size="66" font-weight="700" fill="#ffffff">${x(ln)}</text>`);
  const subY = titleTop + Math.max(0, title.length - 1) * 78 + 74;
  const subRows = sub.map((ln) => `<text x="72" y="${subY}" font-family="${x(fonts)}" font-size="34" fill="#e2e8f0">${x(ln)}</text>`);
  const badgeW = badge ? Math.round(28 + textWidth(badge) * 19) : 0;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">`,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${x(tint[0])}"/><stop offset="1" stop-color="${x(tint[1])}"/></linearGradient></defs>`,
    `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#g)"/>`,
    '<circle cx="1080" cy="560" r="300" fill="#ffffff" fill-opacity="0.06"/>', '<circle cx="150" cy="80" r="180" fill="#ffffff" fill-opacity="0.05"/>',
  ];
  if (badge) parts.push(`<rect x="72" y="64" width="${badgeW}" height="52" rx="26" fill="#ffffff" fill-opacity="0.18"/>`,
    `<text x="${72 + badgeW / 2}" y="99" text-anchor="middle" font-family="${x(fonts)}" font-size="26" font-weight="600" fill="#ffffff">${x(badge)}</text>`);
  parts.push(...rows, ...subRows);
  if (brand) parts.push(`<text x="72" y="558" font-family="${x(fonts)}" font-size="28" font-weight="600" fill="#ffffff" fill-opacity="0.85">${x(brand)}</text>`);
  parts.push(`<rect x="0" y="${OG_HEIGHT - 10}" width="${OG_WIDTH}" height="10" fill="${x(card.accent || '#ffffff')}" fill-opacity="0.25"/>`, '</svg>');
  return parts.join('\n');
}

// 32-bit FNV-1a of a string, base 36.
// FNV-1a: tiny, fast, well distributed for short strings; a cache key, not a security hash. Math.imul gives the
// 32-bit multiply that plain * would lose to float rounding.
export function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
// Cache file name of a card: '<theme>-v<style>-<fingerprint>.png' (fields joined by U+001F, which no text holds,
// so 'A' + '' and '' + 'A' differ).
export function ogCacheName(card = {}, ext = 'png') {
  const theme = Array.isArray(card.theme) ? card.theme.join('').replace(/#/g, '') : OG_THEMES[card.theme] ? card.theme : 'site';
  const src = [theme, card.title || '', card.subtitle || '', card.badge || '', card.brand || ''].join('\u001F');
  return `${theme}-v${OG_STYLE_VERSION}-${fnv1a(src)}.${ext}`;
}
// A data: URI of the SVG (for <img> previews and og:image of local builds).
export const svgDataUri = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
