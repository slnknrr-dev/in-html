// rain/params.js - parameters of the digital rain: defaults, schema, normalization, presets, random sets and the
// compact share code (URL hash).
import { SET_KEYS, glyphChars } from './glyphs.js';

export const DEFAULTS = Object.freeze({
  sets: ['kata', 'digits', 'symbols'], custom: '', font: 'gothic', size: 18, mirror: true, bold: false,
  spacing: 1, drops: 0.9, speed: 12, variance: 0.5, trail: 22, fade: 1.6, mutate: 0.5, flicker: 0.1, direction: 'down',
  colorMode: 'gradient', color1: '#5dff8a', color2: '#00561b', head: '#e6ffe8', rainbowSpeed: 0.08,
  glow: 0.5, headGlow: 0.85, bloom: 0.3,
  bgMode: 'color', bg: '#010702', bgImage: '', bgDim: 0.55,
  layers: 2, depth: 0.6, parallax: 0.3,
  msg: '', msgStyle: 'big', msgHold: 6,
  fps: 0, motion: 'respect', seed: 0,
});

// [key, share code, type, a, b, step] — num: a..b with step; enum: a = values; text: a = max length.
// One table drives normalisation, the share code (short keys keep URLs small) and the editor's controls, so a new
// parameter is added in exactly one place.
export const SCHEMA = [
  ['sets', 'g', 'sets'], ['custom', 'x', 'text', 200], ['font', 'f', 'enum', ['gothic', 'mono', 'sans', 'serif']],
  ['size', 's', 'num', 8, 64, 1], ['mirror', 'm', 'bool'], ['bold', 'b', 'bool'],
  ['spacing', 'sp', 'num', 0.6, 2.5, 0.05], ['drops', 'dr', 'num', 0.1, 3, 0.05], ['speed', 'v', 'num', 1, 60, 0.5],
  ['variance', 'va', 'num', 0, 1, 0.01], ['trail', 't', 'num', 3, 80, 1], ['fade', 'fd', 'num', 0.3, 4, 0.1],
  ['mutate', 'mu', 'num', 0, 4, 0.05], ['flicker', 'fl', 'num', 0, 1, 0.01], ['direction', 'd', 'enum', ['down', 'up']],
  ['colorMode', 'cm', 'enum', ['gradient', 'rainbow']], ['color1', 'c1', 'color'], ['color2', 'c2', 'color'],
  ['head', 'h', 'color'], ['rainbowSpeed', 'rs', 'num', 0, 1, 0.01], ['glow', 'gl', 'num', 0, 1, 0.01],
  ['headGlow', 'hg', 'num', 0, 1, 0.01], ['bloom', 'bl', 'num', 0, 1, 0.01],
  ['bgMode', 'bm', 'enum', ['color', 'transparent', 'image']], ['bg', 'bg', 'color'], ['bgImage', '', 'image'],
  ['bgDim', 'bd', 'num', 0, 1, 0.01], ['layers', 'l', 'num', 1, 3, 1], ['depth', 'dp', 'num', 0, 1, 0.01],
  ['parallax', 'px', 'num', 0, 1, 0.01], ['msg', 'ms', 'text', 40], ['msgStyle', 'mt', 'enum', ['big', 'inline']],
  ['msgHold', 'mh', 'num', 0, 30, 1], ['fps', 'fps', 'enum', [0, 60, 30, 24, 15]], ['motion', 'mo', 'enum', ['respect', 'ignore']],
  ['seed', 'sd', 'num', 0, 4294967295, 1],
];
const BY_KEY = Object.fromEntries(SCHEMA.map((s) => [s[0], s]));
const BY_CODE = Object.fromEntries(SCHEMA.filter((s) => s[1]).map((s) => [s[1], s]));

const COLOR_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
function normColor(v, d) {
  const m = COLOR_RE.exec(String(v ?? '').trim());
  if (!m) return d;
  const s = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
  return '#' + s.toLowerCase();
}
const decimals = (step) => (String(step).split('.')[1] || '').length;

// One value of the schema, coerced / clamped; the default when it cannot be used.
// Numbers are clamped and snapped to the control's step, so a decoded share code always lands on a value the UI can
// show; toFixed(decimals(step)) removes float noise such as 0.15000000000000002.
function normValue(spec, v, d) {
  const [, , type, a, b, step] = spec;
  switch (type) {
    case 'num': {
      const n = Number(v);
      if (v === '' || v == null || !Number.isFinite(n)) return d;
      const q = Math.round(Math.min(b, Math.max(a, n)) / step) * step;
      return +q.toFixed(decimals(step));
    }
    case 'enum': { const i = a.map(String).indexOf(String(v)); return i >= 0 ? a[i] : d; }
    case 'bool': return v === true || v === 1 || v === '1' || v === 'true';
    case 'color': return normColor(v, d);
    case 'text': return String(v ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').slice(0, a);
    // Only base64 raster data URIs: no remote URLs (exports must stay offline) and no SVG (scriptable).
    case 'image': return typeof v === 'string' && /^data:image\/(png|jpeg|webp|gif|avif);base64,[a-z0-9+/=\s]+$/i.test(v) ? v.replace(/\s+/g, '') : '';
    case 'sets': {
      const list = (Array.isArray(v) ? v : String(v ?? '').split(',')).map((x) => String(x).trim()).filter((x) => SET_KEYS.includes(x));
      const uniq = SET_KEYS.filter((k) => list.includes(k));
      return uniq.length ? uniq : d.slice();
    }
    default: return d;
  }
}

// A complete, valid parameter object (unknown keys dropped).
// Object.hasOwn so that keys from the prototype ('constructor') can never be read as parameters.
export function normalizeParams(p = {}) {
  const out = {};
  for (const spec of SCHEMA) {
    const k = spec[0];
    out[k] = p && Object.hasOwn(p, k) ? normValue(spec, p[k], DEFAULTS[k]) : (Array.isArray(DEFAULTS[k]) ? DEFAULTS[k].slice() : DEFAULTS[k]);
  }
  if (out.bgMode === 'image' && !out.bgImage) out.bgMode = 'color';
  return out;
}

// What rainEngine() takes: normalized parameters plus the resolved glyph string.
export function engineParams(p) {
  const n = normalizeParams(p);
  n.chars = glyphChars(n);
  return n;
}

export const paramSpec = (k) => BY_KEY[k] || null;

// ---- share code: 'r1.' + base64url(UTF-8 JSON of the non-default values under short codes) ---------------------
function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

// The background image never travels in the code (too large for a URL); an image background falls back to colour.
// Only non-default values are encoded: share codes stay short and keep working if a default changes later only for
// the keys the sender actually set. The 'r1.' prefix versions the format.
export function encodeParams(p) {
  const n = normalizeParams(p);
  const o = {};
  for (const [k, code, type] of SCHEMA) {
    if (!code) continue;
    const v = n[k], d = DEFAULTS[k];
    if (JSON.stringify(v) === JSON.stringify(d)) continue;
    o[code] = type === 'sets' ? v.join(',') : type === 'color' ? v.slice(1) : type === 'bool' ? (v ? 1 : 0) : v;
  }
  if (o.bm === 'image') delete o.bm;
  return 'r1.' + b64url(new TextEncoder().encode(JSON.stringify(o)));
}

// Parameters from a share code (also accepts a whole URL or '#…'); null when it is not a valid code.
// Strict decoding (fatal UTF-8, object-only JSON, unknown keys skipped) followed by full normalisation: a share code
// is untrusted input from a URL.
export function decodeParams(code) {
  const s = String(code || '').trim();
  const at = s.lastIndexOf('r1.');
  const body = at >= 0 ? s.slice(at + 3) : '';
  if (!body || !/^[A-Za-z0-9_-]+$/.test(body)) return null;
  let o;
  try { o = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(unb64url(body))); } catch { return null; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const p = {};
  for (const [code, v] of Object.entries(o)) {
    const spec = BY_CODE[code];
    if (!spec) continue;
    p[spec[0]] = spec[2] === 'color' ? '#' + String(v) : v;
  }
  return normalizeParams(p);
}

// ---- presets ------------------------------------------------------------------------------------------------------
export const PRESETS = [
  { id: 'classic', p: {} },
  { id: 'message', p: { msg: 'WAKE UP', msgStyle: 'big', msgHold: 6, drops: 1.1 } },
  { id: 'amber', p: { sets: ['latin', 'digits', 'symbols'], font: 'mono', mirror: false, color1: '#ffc24a', color2: '#5c2c00', head: '#fff4d6', bg: '#110801', glow: 0.6, headGlow: 0.9, bloom: 0.4, layers: 1, speed: 9, trail: 28, flicker: 0.3, size: 17 } },
  { id: 'cyberpunk', p: { sets: ['kata', 'latin', 'symbols'], color1: '#ff3ad8', color2: '#2547ff', head: '#eafcff', bg: '#07020f', glow: 0.8, headGlow: 1, bloom: 0.55, layers: 3, depth: 0.7, parallax: 0.5, speed: 16, trail: 24 } },
  { id: 'blueprint', p: { sets: ['hex', 'symbols'], font: 'mono', mirror: false, color1: '#e2f1ff', color2: '#5b8ad6', head: '#ffffff', bg: '#0b3a8c', glow: 0.12, headGlow: 0.35, bloom: 0, layers: 1, spacing: 1.35, trail: 30, speed: 7, fade: 1.1, size: 15, flicker: 0 } },
  { id: 'mono', p: { color1: '#f0f0f0', color2: '#2e2e2e', head: '#ffffff', bg: '#000000', glow: 0.3, headGlow: 0.6, bloom: 0.2 } },
  { id: 'rainbow', p: { sets: ['kata', 'latin', 'digits'], colorMode: 'rainbow', rainbowSpeed: 0.08, head: '#ffffff', bg: '#050505', glow: 0.6, bloom: 0.4 } },
  { id: 'binary', p: { sets: ['binary'], font: 'mono', mirror: false, speed: 22, variance: 0.75, drops: 1.4, trail: 32, color1: '#3dff7a', color2: '#003b12', size: 14, layers: 3, depth: 0.75, bloom: 0.35 } },
  { id: 'ice', p: { sets: ['kata', 'symbols'], color1: '#86f7ff', color2: '#00395a', head: '#f2ffff', bg: '#00060c', glow: 0.7, bloom: 0.45, speed: 10, layers: 3 } },
  { id: 'ascend', p: { sets: ['latin', 'symbols'], font: 'serif', mirror: false, direction: 'up', color1: '#ffd76e', color2: '#5a2900', head: '#fffbea', bg: '#0b0603', glow: 0.75, bloom: 0.5, speed: 7, trail: 18, drops: 0.7 } },
  { id: 'crimson', p: { sets: ['kata', 'cyrillic'], color1: '#ff4040', color2: '#470000', head: '#ffe6e6', bg: '#0a0000', glow: 0.65, bloom: 0.4, speed: 14 } },
  { id: 'sakura', p: { sets: ['kata'], color1: '#ffb3dc', color2: '#6b1d5a', head: '#fff3fa', bg: '#12051a', glow: 0.7, headGlow: 0.9, bloom: 0.45, speed: 5, trail: 14, drops: 0.55, fade: 1.2, layers: 3, depth: 0.8, parallax: 0.6 } },
];

// Full parameters of a preset; `keep` carries values of the current set that presets do not own (background image,
// frame-rate cap, motion preference).
export function presetParams(id, keep = {}) {
  const pr = PRESETS.find((x) => x.id === id) || PRESETS[0];
  const p = { ...DEFAULTS, ...pr.p };
  for (const k of ['fps', 'motion']) if (keep[k] != null) p[k] = keep[k];
  if (keep.bgImage && keep.bgMode === 'image' && !pr.p.bgMode) Object.assign(p, { bgMode: 'image', bgImage: keep.bgImage, bgDim: keep.bgDim ?? p.bgDim });
  return normalizeParams(p);
}

// Which preset the parameters match exactly (ignoring the kept values), or ''.
export function matchPreset(p) {
  const n = normalizeParams(p);
  const skip = new Set(['fps', 'motion', 'bgImage', 'bgMode', 'bgDim', 'seed']);
  for (const pr of PRESETS) {
    const q = normalizeParams({ ...DEFAULTS, ...pr.p });
    if (SCHEMA.every(([k]) => skip.has(k) || JSON.stringify(q[k]) === JSON.stringify(n[k]))) return pr.id;
  }
  return '';
}

// ---- random sets ----------------------------------------------------------------------------------------------------
// Compact HSL -> RGB formula (the CSS Color 4 reference algorithm).
function hsl2hex(h, s, l) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const f = (n) => { const k = (n + h / 30) % 12; const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(c * 255).toString(16).padStart(2, '0'); };
  return '#' + f(0) + f(8) + f(4);
}

// A pleasing random set (dark backgrounds, one hue family or a duotone); message, background image, frame-rate cap
// and motion preference come from `keep`.
export function randomParams(rand = Math.random, keep = {}) {
  const r = (a, b) => a + (b - a) * rand();
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const hue = r(0, 360);
  const duo = rand() < 0.35;
  const rainbow = rand() < 0.1;
  const hue2 = duo ? hue + pick([-1, 1]) * r(90, 180) : hue + r(-25, 25);
  const sets = [];
  for (const [k, pr] of [['kata', 0.7], ['digits', 0.55], ['latin', 0.35], ['symbols', 0.35], ['binary', 0.08], ['hex', 0.1], ['cyrillic', 0.1]]) if (rand() < pr) sets.push(k);
  if (!sets.length) sets.push(pick(['kata', 'latin', 'binary']));
  const p = {
    sets, font: sets.includes('kata') && rand() < 0.75 ? 'gothic' : pick(['mono', 'mono', 'sans', 'serif']),
    mirror: sets.includes('kata') ? rand() < 0.8 : rand() < 0.2, bold: rand() < 0.15,
    size: Math.round(r(12, 30)), spacing: r(0.85, 1.4), drops: r(0.5, 1.6), speed: r(6, 24), variance: r(0.2, 0.8),
    trail: Math.round(r(10, 40)), fade: r(0.8, 2.4), mutate: r(0.2, 1.4), flicker: rand() < 0.5 ? 0 : r(0.05, 0.3),
    direction: rand() < 0.12 ? 'up' : 'down', colorMode: rainbow ? 'rainbow' : 'gradient',
    color1: hsl2hex(hue, r(80, 100), r(58, 72)), color2: hsl2hex(hue2, r(70, 100), r(14, 26)), head: hsl2hex(hue, r(60, 100), r(90, 96)),
    rainbowSpeed: r(0.03, 0.2), glow: r(0.2, 0.9), headGlow: r(0.5, 1), bloom: rand() < 0.25 ? 0 : r(0.15, 0.6),
    bg: hsl2hex(hue, r(30, 80), r(1.5, 6)), layers: 1 + Math.floor(rand() * 3), depth: r(0.3, 0.85), parallax: r(0, 0.6),
    bgMode: 'color',
  };
  for (const k of ['msg', 'msgStyle', 'msgHold', 'fps', 'motion']) if (keep[k] != null) p[k] = keep[k];
  if (keep.bgMode === 'image' && keep.bgImage) Object.assign(p, { bgMode: 'image', bgImage: keep.bgImage, bgDim: keep.bgDim });
  if (keep.bgMode === 'transparent') p.bgMode = 'transparent';
  return normalizeParams(p);
}
