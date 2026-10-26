// crypto-tool/shell.js - the shell shared by the pages of the application: header with the page links, language and
// colour scheme, small formatting helpers (digest encodings, sizes, numbers) and the KeePassXC-style strength meter.
// Imported by every page entry; importing it also registers the UI strings (side-effect import of strings.js first).
import './strings.js';
import { startApp, t } from '../ui/app.js';
import { $$, h } from '../ui/dom.js';
import { bytesToBase64, bytesToHex } from '../crypto/encoding.js';

export const LOGO = 'M12 3l7 3v5c0 4.6-3 8.4-7 10-4-1.6-7-5.4-7-10V6zM9.5 12l2 2 3.5-4';

// The page links come from <nav id="ct-pages" hidden> in the markup: the build rewrites <a href> between pages to
// the artifact names, which links created in script would miss.
// One key (crypto-tools) for all five pages: language and theme preferences are shared between them.
export function startShell(page, onLang) {
  const pages = $$('#ct-pages a').map((a) => ({ href: a.getAttribute('href'), label: a.dataset.k, current: a.dataset.k === 'nav.' + page }));
  const title = () => { document.title = page === 'home' ? t('app.name') : `${t('nav.' + page)} · ${t('app.name')}`; };
  startApp({
    key: 'crypto-tools', name: 'app.name', logo: LOGO, pages, offline: true,
    onLang: () => { title(); if (onLang) onLang(); },
  });
  title();
}

// Decimal number in the UI language (KeePassXC prints entropy with two decimals).
// Intl formatter built per call: the language can change at runtime; caching it would freeze the old locale.
export const fmtNum = (n, digits = 0) => new Intl.NumberFormat(document.documentElement.lang || 'en', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);

// KeePassXC-style strength meter: a bar over 0..200 bits coloured by the quality, marks at the quality thresholds
// (40, 75, 100 bits), "Entropy: N bit" and "Password quality: Q". `note` is an optional line under it.
// role=meter with aria-valuenow: assistive tech reads the entropy as a value, not as a decorative bar.
export function strengthMeter(bits, quality, note) {
  const pct = Math.max(0, Math.min(100, (bits / 200) * 100));
  return h('div', { class: 'ct-sm', 'data-q': quality },
    h('div', { class: 'ct-sm-bar', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '200', 'aria-valuenow': String(Math.round(bits)), 'aria-label': t('pw.entropyL') },
      h('i', { style: { width: pct + '%' } }), ...[40, 75, 100].map((b) => h('b', { style: { left: b / 2 + '%' } }))),
    h('div', { class: 'ct-sm-text' },
      h('span', { class: 'ct-sm-bits' }, t('pw.entropy', { bits: fmtNum(bits, 2) })),
      h('span', { class: 'ct-q' }, t('pw.quality', { q: t('q.' + quality) }))),
    note ? h('div', { class: 'ed-hint' }, note) : null);
}

export function formatDigest(bytes, format) {
  if (format === 'base64') return bytesToBase64(bytes);
  const h = bytesToHex(bytes);
  return format === 'HEX' ? h.toUpperCase() : h;
}

// Binary units; 2 decimals below 10, 1 below 100, none above: about three significant digits.
export function fmtSize(n) {
  if (n < 1024) return t('u.bytes', { n });
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)} ${units[i]}`;
}

// Display order of algorithm families across pages; unknown groups sort first (indexOf −1) — add new groups here.
export const GROUP_ORDER = ['sha2', 'sha3', 'blake2', 'legacy', 'checksum', 'mac', 'kdf', 'aes', 'chacha', 'salsa',
  'b64', 'b32', 'num', 'radix', 'b85', 'special', 'check', 'mail', 'web'];
// numeric collation: digit runs compare by value, so AES-128 < AES-192 < AES-256 and SHA-224 < SHA-256 < SHA-512.
const natural = (a, b) => a.label.localeCompare(b.label, 'en', { numeric: true });
// Registry entries grouped in display order: [[group, [defs]], ...].
export function grouped(defs) {
  const m = new Map();
  for (const d of [...defs].sort(natural)) { if (!m.has(d.group)) m.set(d.group, []); m.get(d.group).push(d); }
  return [...m].sort((a, b) => GROUP_ORDER.indexOf(a[0]) - GROUP_ORDER.indexOf(b[0]));
}

export { t };
