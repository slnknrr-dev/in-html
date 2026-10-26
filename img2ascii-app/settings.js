// img2ascii-app/settings.js - remembered settings (defaults, validation, storage) and the preview look.
// Schema by tables: DEFAULTS defines the keys and types, RANGES clamps numbers, CHOICES whitelists enums. sanitize()
// derives everything from these three tables, so adding a setting is one line per table, not new validation code.
// Validation is per key and fail-soft: a bad value falls back to its default while valid neighbours are kept.
import { lsGet, lsSet } from '../ui/dom.js';
import { RAMP_IDS } from '../ascii/ramps.js';
import { COLOR_MODES, DITHERS } from '../ascii/convert.js';
import { luma, parseHex } from '../ascii/palette.js';

export const STORE = 'img2ascii-settings';

// Frozen: callers copy it ({ ...DEFAULTS }) and can never mutate the defaults by accident. Flat (no nested objects),
// so a shallow copy is a full copy. contrast 10 and vivid 60: a slight boost reads better as text art than neutral.
// aspect 2: terminal cells are about twice as tall as wide, so every column samples a 1 x 2 pixel area.
export const DEFAULTS = Object.freeze({
  ramp: 'classic', chars: '@%#*+=-:. ', order: 'auto', columns: 120, aspect: 2,
  brightness: 0, contrast: 10, gamma: 1, invert: false, autoLevels: false,
  dither: 'none', edges: 0, edgeGlyphs: false, edgeThreshold: 30,
  color: 'truecolor', target: 'fg', vivid: 60, bgMode: 'auto', bgCustom: '#13261f',
  fontSize: 10, fit: true, pngCell: 14, copyFmt: 'text', srcTab: 'image', mirror: true,
});

const RANGES = {
  columns: [20, 400], aspect: [1, 3], brightness: [-100, 100], contrast: [-100, 100], gamma: [0.2, 3],
  edges: [0, 100], edgeThreshold: [5, 90], vivid: [0, 100], fontSize: [3, 40], pngCell: [6, 32],
};
const CHOICES = {
  ramp: RAMP_IDS, order: ['auto', 'dense', 'sparse'], dither: DITHERS, color: COLOR_MODES, target: ['fg', 'bg'],
  bgMode: ['auto', 'dark', 'light', 'custom'], copyFmt: ['text', 'ansi', 'html'], srcTab: ['image', 'camera'],
};

// Any stored object → complete, valid settings.
// Iterates DEFAULTS' keys, not raw's: unknown keys from old versions or tampering are dropped. Numbers are coerced
// with + and clamped (a stored "120" string still works); NaN keeps the default. chars capped at 200 characters:
// a ramp longer than the distinct density levels gains nothing and a huge string would slow every conversion.
export function sanitize(raw) {
  const s = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object') return s;
  for (const k of Object.keys(DEFAULTS)) {
    const v = raw[k];
    if (v === undefined) continue;
    if (RANGES[k]) { const n = +v; if (Number.isFinite(n)) s[k] = Math.min(RANGES[k][1], Math.max(RANGES[k][0], n)); }
    else if (CHOICES[k]) { if (CHOICES[k].includes(v)) s[k] = v; }
    else if (typeof DEFAULTS[k] === 'boolean') s[k] = !!v;
    else if (k === 'bgCustom') { if (parseHex(v)) s[k] = String(v); }
    else if (k === 'chars') s[k] = String(v).slice(0, 200);
  }
  return s;
}

export const loadSettings = () => sanitize(lsGet(STORE, null));
export const saveSettings = (s) => lsSet(STORE, s);

/**
 * Colours of the preview (and of exports): { bg, fg, paper, ink }. 'auto' follows the page colour scheme: a dark
 * terminal in dark mode, paper in light mode. Light ink on dark backgrounds, dark ink on light ones.
 */
// Custom backgrounds choose ink by luma > 0.5 (relative luminance of the colour) so text always contrasts.
// Paper '#f7f3ea' and terminal '#0b0f14' are slightly tinted, not pure white/black: pure extremes make dense glyph
// areas glare (light) or look like holes (dark).
export function previewLook(s, schemeDark) {
  let bg, paper;
  if (s.bgMode === 'custom') {
    bg = s.bgCustom;
    const c = parseHex(bg) || [0, 0, 0];
    paper = luma(c[0], c[1], c[2]) > 0.5;
  } else {
    paper = s.bgMode === 'light' || (s.bgMode === 'auto' && !schemeDark);
    bg = paper ? '#f7f3ea' : '#0b0f14';
  }
  return { bg, fg: paper ? '#1f1b16' : '#dbe4ef', paper, ink: paper ? 'dark' : 'light' };
}
