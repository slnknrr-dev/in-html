// landing-studio/viewer-design.js - landing design system: theme tokens and derived palettes, fonts, CSS library, buildCSS.
import { CSS_FEAT, FEATURE_ORDER } from './viewer-runtime.js';
import { collectUsage } from '../doc/render.js';
import { ensureDoc, walkBlocks } from '../doc/model.js';
import { langDir, primary } from '../i18n/lang.js';
import { isB64 } from '../codec/base64.js';
import { BLOCK_TYPES, THEMES } from '../doc/product.js';
import { MIME_RE, isObj, num, own, str } from '../util/value.js';
import { parseColor, safeColor } from '../color/color.js';

/* ==========================================================================
   Design system, CSS library and CSS assembly (CONTRACT.md §4, §7, §13).

   Token API for block / runtime / theme authors (set by varsCSS; view mode on :root so drawers, dialogs and the
   floating toolbar outside .lp-root inherit them; edit mode on .lp-root):
     palette  --lp-accent --lp-accent-h (hover) --lp-on-accent --lp-accent2 --lp-on-accent2 --lp-bg --lp-surface
              --lp-text --lp-muted (AA on bg & surface) --lp-border --lp-border-s (≥3:1, inputs) --lp-link (accent
              as AA text) --lp-tint --lp-tint2 (translucent accent washes) --lp-hover (neutral wash) --lp-sel
              --lp-danger --lp-ok --lp-shadow --lp-shadow-lg (+ color-scheme)
     stable   --lp-a0 --lp-on-a0 (designed accent; editor chrome, never redefined by tones/dark)
     type     --lp-font --lp-font-h --lp-fs (px) --lp-lh   (+ optional theme knobs --lp-hw heading weight, --lp-hk
              heading scale factor)
     shape    --lp-radius --lp-radius-s --lp-btn-r (button radius from theme.buttons)
     space    --lp-w (container) --lp-gap (24px) --lp-sec (section padding block, clamp+cqi) --lp-gut (gutter:
              32 / 24 / 20 px by container width) --lp-bs (block rhythm)
     motion   --lp-ease --lp-dur --lp-vh (1vh|1svh view, 7.2px edit)
   Tones `.lp-tone-dark|muted|accent|light` redeclare the whole palette (computed per scheme, AA-checked) and paint
   background/text themselves. Responsive rules use `@container lp (max-width:900px|600px)` only.
   ========================================================================== */

/* ---------- font stacks ----------
   System fonts only. Every stack reaches Latin, Cyrillic and Georgian through per-glyph fallback: the Georgian
   families come before the generic keyword so Mkhedruli never ends up in a random system font. */
// CSS maps of the block parts, filled by viewer.js when the product is registered: CSS_BLOCKS[type] (base rules),
// CSS_VARIANTS[type]['prop=value'] (variant rules), BLOCK_DEPS[type] = [shared chunks], CLASS_OWNER = [[/class
// prefix/, owner], ...] (theme rule shaking).
const CSS_BLOCKS = {};
const CSS_VARIANTS = {};
const BLOCK_DEPS = {};
const CLASS_OWNER = [];

const FS_GEO_SANS = '"Noto Sans Georgian", "BPG Glaho", "BPG Arial", Sylfaen, "DejaVu Sans"';
const FS_GEO_SERIF = '"Noto Serif Georgian", "BPG Nino Medium", Sylfaen, "DejaVu Serif"';
const FONT_STACKS = {
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", ' + FS_GEO_SANS + ', sans-serif',
  humanist: '"Segoe UI", Candara, Optima, "Fira Sans", "PT Sans", Ubuntu, "Noto Sans", ' + FS_GEO_SANS + ', sans-serif',
  geometric: 'Avenir, "Avenir Next", Montserrat, "Century Gothic", Futura, "Trebuchet MS", "Noto Sans", ' + FS_GEO_SANS + ', sans-serif',
  rounded: 'ui-rounded, "SF Pro Rounded", Nunito, "Varela Round", "Segoe UI", "Noto Sans", ' + FS_GEO_SANS + ', sans-serif',
  condensed: '"Bahnschrift SemiCondensed", "Roboto Condensed", "Avenir Next Condensed", "Arial Narrow", "Liberation Sans Narrow", "Noto Sans", ' + FS_GEO_SANS + ', sans-serif',
  serif: 'Charter, "Bitstream Charter", "Sitka Text", Cambria, "PT Serif", Georgia, "Noto Serif", ' + FS_GEO_SERIF + ', serif',
  display: 'Didot, "Bodoni 72", "Bodoni MT", "Playfair Display", "Noto Serif Display", "Iowan Old Style", "Sitka Banner", Constantia, "Times New Roman", ' + FS_GEO_SERIF + ', serif',
  slab: 'Rockwell, "Rockwell Nova", "Roboto Slab", "Zilla Slab", "Noto Serif", Georgia, ' + FS_GEO_SERIF + ', serif',
  mono: 'ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", "Noto Sans Mono", ' + FS_GEO_SANS + ', monospace',
};

/* ---------- theme presets (design-owned; template parts add supra / forge / kvevri / harvest) ----------
   vars seed doc.theme (every §2 theme key); css = one rule per line, every selector prefixed .lp-root.lp-t-<key>,
   shaken per used owner by shakeRules. Theme rules may only use the token API above and shared/base classes. */
const THEMES_BASE = {
  clean: {
    vars: {
      accent: '#2563eb', accent2: '#0ea5e9', bg: '#ffffff', surface: '#f4f6fa', text: '#0f172a', muted: '#526072',
      border: '#e2e7ef', fontBody: 'sans', fontHead: 'sans', baseSize: 17, lineHeight: 1.6, radius: 12,
      buttons: 'solid', headings: 'normal', width: 1160, space: 'normal', scheme: 'light',
    },
    css: `
.lp-root.lp-t-clean{--lp-hw:720}
.lp-root.lp-t-clean .lp-h1{letter-spacing:-.034em}
.lp-root.lp-t-clean .lp-h2{letter-spacing:-.026em}
.lp-root.lp-t-clean:not(.lp-btn-outline) .lp-btn-primary{box-shadow:0 1px 2px rgba(15,23,42,.14),0 10px 24px -12px var(--lp-accent)}
.lp-root.lp-t-clean:not(.lp-btn-outline) .lp-btn-primary:hover{box-shadow:0 2px 4px rgba(15,23,42,.14),0 14px 30px -12px var(--lp-accent)}
.lp-root.lp-t-clean .lp-btn-secondary{background:var(--lp-bg)}
.lp-root.lp-t-clean .lp-icbox{background:linear-gradient(140deg,var(--lp-tint),var(--lp-tint2))}
.lp-root.lp-t-clean .lp-card-hover:hover{border-color:color-mix(in srgb,var(--lp-accent) 38%,var(--lp-border))}
.lp-root.lp-t-clean .lp-chip{background:var(--lp-tint);font-weight:600}
.lp-root.lp-t-clean .lp-input{background:var(--lp-bg);box-shadow:0 1px 2px rgba(15,23,42,.05)}
.lp-root.lp-t-clean .lp-rich blockquote{border-inline-start-color:var(--lp-accent2)}`,
  },
  noir: {
    vars: {
      accent: '#c9a96e', accent2: '#9c7c4c', bg: '#0d0c0b', surface: '#171513', text: '#f3eee6', muted: '#aaa194',
      border: '#2c2823', fontBody: 'humanist', fontHead: 'display', baseSize: 17, lineHeight: 1.65, radius: 2,
      buttons: 'square', headings: 'normal', width: 1160, space: 'airy', scheme: 'dark',
    },
    css: `
.lp-root.lp-t-noir{--lp-hw:400;--lp-hk:1.04}
.lp-root.lp-t-noir .lp-h{letter-spacing:-.004em}
.lp-root.lp-t-noir .lp-h1{line-height:1.03;letter-spacing:-.014em}
.lp-root.lp-t-noir .lp-h4{font-family:var(--lp-font);font-weight:600;letter-spacing:.02em}
.lp-root.lp-t-noir .lp-eyebrow{gap:.95em;font-weight:500;letter-spacing:.3em}
.lp-root.lp-t-noir .lp-eyebrow::before{content:"";width:2.4em;height:1px;background:currentColor;opacity:.7}
.lp-root.lp-t-noir .lp-lead{letter-spacing:.005em}
.lp-root.lp-t-noir .lp-btn{font-size:.8em;font-weight:600;letter-spacing:.16em;text-transform:uppercase;padding:1.15em 2.1em}
.lp-root.lp-t-noir .lp-btn-sm{padding:.9em 1.5em}
.lp-root.lp-t-noir .lp-btn-ghost{padding-inline:.4em;text-decoration:underline;text-decoration-color:var(--lp-accent);text-underline-offset:.45em}
.lp-root.lp-t-noir .lp-card{background:transparent}
.lp-root.lp-t-noir .lp-card-hover:hover{transform:none;box-shadow:none;border-color:var(--lp-accent)}
.lp-root.lp-t-noir .lp-chip{background:transparent;border:1px solid var(--lp-border-s);color:var(--lp-text);font-weight:500;letter-spacing:.12em;text-transform:uppercase;font-size:.7em}
.lp-root.lp-t-noir .lp-badge{background:transparent;color:var(--lp-link);box-shadow:inset 0 0 0 1px currentColor}
.lp-root.lp-t-noir .lp-icbox{background:transparent;border:1px solid var(--lp-border-s);border-radius:50%;color:var(--lp-link)}
.lp-root.lp-t-noir .lp-price-now{font-family:var(--lp-font-h);font-weight:400;font-size:1.55em;letter-spacing:0}
.lp-root.lp-t-noir .lp-input{background:transparent}
.lp-root.lp-t-noir .lp-rich a{text-decoration-color:var(--lp-accent)}
.lp-root.lp-t-noir .lp-rich blockquote{font-family:var(--lp-font-h);font-size:1.15em}`,
  },
};

/* ---------- colour math (palettes are computed in JS so every pair can be AA-checked at build time) ---------- */
const DS_WHITE = [255, 255, 255];
const DS_BLACK = [0, 0, 0];
const DS_INK = [17, 24, 39];
const DS_COLOR_KEYS = ['accent', 'accent2', 'bg', 'surface', 'text', 'muted', 'border'];
// Last-resort colours (the clean preset) when a theme colour is missing or not parseable (hsl(), names…).
const DS_FALLBACK = { accent: '#2563eb', accent2: '#0ea5e9', bg: '#ffffff', surface: '#f4f6fa', text: '#0f172a', muted: '#526072', border: '#e2e7ef' };

// [r,g,b] from an allowlisted colour, or null (only #hex / rgb() / white / black parse — see core parseColor).
function dsRGB(c) {
  const s = safeColor(c);
  const p = s ? parseColor(s) : null;
  return Array.isArray(p) && p.length >= 3 && p.slice(0, 3).every(Number.isFinite) ? p.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v)))) : null;
}
const dsHex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const dsMix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const dsA = (rgb, a) => `rgba(${rgb.map((v) => Math.round(v)).join(',')},${a})`;
function dsLum(rgb) {
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}
function dsCR(a, b) {
  const x = dsLum(a);
  const y = dsLum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
// Smallest mix of `c` toward `to` (4 % steps) reaching `min`:1 against every colour in `bgs`; `to` when none does.
function dsReach(c, to, bgs, min) {
  for (let k = 0; k <= 25; k++) {
    const x = k ? dsMix(c, to, k / 25) : c;
    if (bgs.every((b) => dsCR(x, b) >= min)) return x;
  }
  return to;
}
// Text colour for a fill: the palette's own light / dark ink first (ivory rather than pure white), then white and
// near-black; the first one reaching 4.5:1 wins, else the best available.
function dsOn(fill, bg, text) {
  const light = dsLum(bg) >= dsLum(text) ? bg : text;
  const dark = light === bg ? text : bg;
  let best = DS_WHITE;
  let bc = 0;
  for (const c of [light, dark, DS_WHITE, DS_INK]) {
    const r = dsCR(c, fill);
    if (r >= 4.5) return c;
    if (r > bc) { bc = r; best = c; }
  }
  return best;
}

/* Complete a palette from its seven base colours. Designed colours are respected; only what fails WCAG AA is
   pushed (text ≥4.5, muted ≥4.5 on bg AND surface, input borders ≥3, link = accent as ≥4.5 text). */
function dsFinish(p) {
  const dark = !!p.dark;
  const ink = dark ? DS_WHITE : DS_BLACK;
  const { bg, surface, accent, accent2 } = p;
  const tintBg = dsMix(bg, accent, dark ? 0.18 : 0.1);
  const text = dsReach(p.text, ink, [bg, surface], 4.5);
  return {
    dark, bg, surface, text, accent, accent2,
    muted: dsReach(p.muted, text, [bg, surface], 4.5),
    border: p.border,
    borderS: dsReach(p.border, text, [bg], 3),
    accentH: dsMix(accent, dark ? DS_WHITE : DS_BLACK, dark ? 0.16 : 0.13),
    onAccent: dsOn(accent, bg, text),
    onAccent2: dsOn(accent2, bg, text),
    link: dsReach(accent, ink, [bg, surface, tintBg], 4.5),
    danger: dsReach(dark ? [249, 112, 102] : [180, 35, 24], ink, [bg, surface], 4.5),
    ok: dsReach(dark ? [74, 222, 128] : [6, 118, 71], ink, [bg, surface], 4.5),
  };
}

// Dark alternative of a light design: ink-tinted near-black page (keeps the theme hue), lifted surface, the light
// page colour as text, accents lifted just enough to stay visible (fills ≥3:1; text links get --lp-link).
function dsDeriveDark(r) {
  const base = dsLum(r.text) < 0.06 ? dsMix(r.text, DS_BLACK, 0.32) : [17, 20, 26];
  const bg = dsMix(base, r.accent, 0.035);
  const surface = dsMix(bg, DS_WHITE, 0.055);
  const text = dsReach(dsMix(dsLum(r.bg) > 0.7 ? r.bg : DS_WHITE, r.text, 0.07), DS_WHITE, [bg, surface], 12);
  return dsFinish({
    dark: true, bg, surface, text, muted: dsMix(text, bg, 0.36), border: dsMix(bg, text, 0.14),
    accent: dsReach(r.accent, DS_WHITE, [bg], 3), accent2: dsReach(r.accent2, DS_WHITE, [bg], 3),
  });
}
// Light alternative of a dark design (noir & co.): warm paper from the light ink, the dark page as text.
function dsDeriveLight(r) {
  const bg = dsLum(r.text) > 0.55 ? dsMix(r.text, DS_WHITE, 0.62) : [250, 250, 249];
  const surface = dsMix(bg, r.bg, 0.04);
  const text = dsReach(dsLum(r.bg) < 0.03 ? r.bg : dsMix(r.bg, DS_BLACK, 0.6), DS_BLACK, [bg, surface], 12);
  return dsFinish({
    dark: false, bg, surface, text, muted: dsMix(text, bg, 0.42), border: dsMix(bg, text, 0.13),
    accent: dsReach(r.accent, DS_BLACK, [bg], 3), accent2: dsReach(r.accent2, DS_BLACK, [bg], 3),
  });
}

// Tone palettes (§5 section tone). `P` is the palette of the scheme the rule applies to.
function dsTonePal(tone, P, pals) {
  switch (tone) {
    case 'muted': {
      let bg = P.surface;
      if (dsCR(bg, P.bg) < 1.04) bg = dsMix(P.bg, P.text, P.dark ? 0.06 : 0.035);
      return dsFinish({ ...P, bg, surface: P.bg });
    }
    case 'dark': {
      if (P.dark) { // a band on a dark page: deeper than the page so it still reads as a band
        const bg = dsMix(P.bg, DS_BLACK, 0.45);
        return dsFinish({ ...P, bg, surface: dsMix(bg, DS_WHITE, 0.06), border: dsMix(bg, P.text, 0.14) });
      }
      const D = pals.D;
      // On a light page the band uses the designed ink when it is dark enough (slate on white, brown on ivory…).
      if (!pals.designedDark && dsLum(pals.L.text) < 0.03) {
        const bg = pals.L.text;
        return dsFinish({ ...D, bg, surface: dsMix(bg, DS_WHITE, 0.06), border: dsMix(bg, D.text, 0.16) });
      }
      return D;
    }
    case 'accent': {
      const bg = P.accent;
      const text = P.onAccent;
      return dsFinish({
        dark: dsLum(bg) < dsLum(text), bg, surface: dsMix(bg, text, 0.1), text, muted: dsMix(text, bg, 0.2),
        border: dsMix(bg, text, 0.24), accent: text, accent2: P.accent2,
      });
    }
    default: return pals.L; // light: always the light palette (a light band on dark pages / dark themes)
  }
}

const dsPalCache = new Map();
// {L, D, designedDark}: L = light palette, D = dark palette. A light design is L and D is derived; a dark design
// (bg luminance < .2, e.g. noir) is D and L is derived. Memoized on the colour inputs.
function dsPalettes(doc) {
  const t = isObj(doc && doc.theme) ? doc.theme : {};
  const th = own(THEMES, t.preset);
  const pv = (isObj(th) && isObj(th.vars) && th.vars) || {};
  const raw = {};
  for (const k of DS_COLOR_KEYS) raw[k] = dsRGB(t[k]) || dsRGB(pv[k]) || dsRGB(DS_FALLBACK[k]);
  const key = DS_COLOR_KEYS.map((k) => dsHex(raw[k])).join('');
  const hit = dsPalCache.get(key);
  if (hit) return hit;
  const designedDark = dsLum(raw.bg) < 0.2;
  const design = dsFinish({ dark: designedDark, ...raw });
  const derived = designedDark ? dsDeriveLight(raw) : dsDeriveDark(raw);
  const out = designedDark ? { L: derived, D: design, designedDark } : { L: design, D: derived, designedDark };
  if (dsPalCache.size > 64) dsPalCache.clear();
  dsPalCache.set(key, out);
  return out;
}
// Palette shown without any data-scheme attribute: D for scheme 'dark', else L ('light' and 'auto').
const dsDefaultDark = (doc) => !!(doc && doc.theme && doc.theme.scheme === 'dark');

// Palette → declarations (custom properties + color-scheme). Values are plain hex/rgba (no color-mix needed).
function dsPalDecl(p) {
  const h = dsHex;
  const tr = p.text.join(',');
  const sh = p.dark ? '0 1px 2px rgba(0,0,0,.45),0 6px 18px -6px rgba(0,0,0,.5)'
    : `0 1px 2px rgba(${tr},.06),0 6px 18px -8px rgba(${tr},.14)`;
  const shl = p.dark ? '0 2px 8px rgba(0,0,0,.4),0 28px 64px -16px rgba(0,0,0,.7)'
    : `0 2px 6px rgba(${tr},.05),0 28px 60px -18px rgba(${tr},.26)`;
  return [
    `--lp-accent:${h(p.accent)}`, `--lp-accent-h:${h(p.accentH)}`, `--lp-on-accent:${h(p.onAccent)}`,
    `--lp-accent2:${h(p.accent2)}`, `--lp-on-accent2:${h(p.onAccent2)}`,
    `--lp-bg:${h(p.bg)}`, `--lp-surface:${h(p.surface)}`, `--lp-text:${h(p.text)}`, `--lp-muted:${h(p.muted)}`,
    `--lp-border:${h(p.border)}`, `--lp-border-s:${h(p.borderS)}`, `--lp-link:${h(p.link)}`,
    `--lp-tint:${dsA(p.accent, p.dark ? 0.18 : 0.1)}`, `--lp-tint2:${dsA(p.accent2, p.dark ? 0.2 : 0.12)}`,
    `--lp-hover:${dsA(p.text, p.dark ? 0.08 : 0.05)}`, `--lp-sel:${dsA(p.accent, p.dark ? 0.4 : 0.24)}`,
    `--lp-danger:${h(p.danger)}`, `--lp-ok:${h(p.ok)}`, `--lp-shadow:${sh}`, `--lp-shadow-lg:${shl}`,
    // Monochrome pictures (logos `mono`): grey on light palettes, a light silhouette on dark ones.
    `--lp-mono:${p.dark ? 'grayscale(1) brightness(0) invert(1)' : 'grayscale(1)'}`,
    `color-scheme:${p.dark ? 'dark' : 'light'}`,
  ].join(';');
}

/* ---------- tokens ---------- */
// Section padding (block axis) per theme.space; cqi resolves against the .lp-root container at the use site.
const DS_SPACE = {
  compact: 'clamp(40px,calc(16px + 4.5cqi),76px)',
  normal: 'clamp(56px,calc(20px + 6.5cqi),112px)',
  airy: 'clamp(72px,calc(28px + 8.5cqi),156px)',
};

function fontStack(doc, key, opts, faces) {
  if (own(FONT_STACKS, key)) return FONT_STACKS[key];
  const m = /^asset:([a-z0-9]{3,32})$/i.exec(String(key || ''));
  const a = m ? own(doc.attachments, m[1]) : null;
  if (!isObj(a)) return FONT_STACKS.sans;
  const id = m[1];
  const fam = 'lpf-' + id;
  let url = '';
  if (opts.mode === 'edit' && typeof opts.attURL === 'function') url = str(opts.attURL(id));
  if (!url && isB64(a.data) && MIME_RE.test(str(a.mime))) url = `data:${a.mime};base64,${a.data}`;
  if (!url && typeof opts.attURL === 'function') url = str(opts.attURL(id));
  // Only a strict data:/blob: URL may reach url("…") (no quote, paren, semicolon or brace → no CSS injection).
  if (!/^(data:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z0-9+/]*={0,2}|blob:[\w.:/%-]+)$/.test(url)) return FONT_STACKS.sans;
  if (!faces.has(fam)) faces.set(fam, `@font-face{font-family:"${fam}";src:url("${url}");font-display:swap}`);
  return `"${fam}", ${FONT_STACKS.sans}`;
}

// Theme → custom properties. View: on :root (everything in the document inherits, incl. drawers, dialogs and the
// floating toolbar rendered outside .lp-root); edit: on .lp-root (the editor document must stay untouched).
function varsCSS(doc, opts = {}, faces = new Map()) {
  const t = isObj(doc.theme) ? doc.theme : {};
  const edit = opts.mode === 'edit';
  const pals = dsPalettes(doc);
  const P = dsDefaultDark(doc) ? pals.D : pals.L;
  const designed = pals.designedDark ? pals.D : pals.L;
  const radius = num(t.radius, 10, 0, 28);
  const rs = Math.min(radius, Math.round(radius * 0.5 + 2));
  const btnR = t.buttons === 'pill' ? '999px' : t.buttons === 'square' ? '0px' : rs + 'px';
  const v = [
    dsPalDecl(P),
    `--lp-a0:${dsHex(designed.accent)}`, `--lp-on-a0:${dsHex(designed.onAccent)}`,
    `--lp-font:${fontStack(doc, t.fontBody, opts, faces)}`, `--lp-font-h:${fontStack(doc, t.fontHead, opts, faces)}`,
    `--lp-fs:${num(t.baseSize, 17, 14, 22)}px`, `--lp-lh:${num(t.lineHeight, 1.6, 1.2, 2)}`,
    `--lp-radius:${radius}px`, `--lp-radius-s:${rs}px`, `--lp-btn-r:${btnR}`,
    `--lp-w:${num(t.width, 1160, 880, 1440)}px`, '--lp-gap:24px', `--lp-sec:${own(DS_SPACE, t.space) || DS_SPACE.normal}`,
    `--lp-vh:${edit ? '7.2px' : '1vh'}`, '--lp-ease:cubic-bezier(.2,.7,.2,1)', '--lp-dur:.2s',
  ];
  let s = `${edit ? '.lp-root' : ':root'}{${v.join(';')}}`;
  // Small-viewport unit where supported: hero heights do not jump when mobile browser bars collapse.
  if (!edit) s += '\n@supports (height:1svh){:root{--lp-vh:1svh}}';
  return s;
}

const DS_TONES = ['muted', 'dark', 'accent', 'light'];
// Tone rules under prefix `pre` ('' view base, '.lp-root ' edit, 'html[data-scheme=dark] ' alternatives…).
// `alt` = an alternative scheme block: the light tone never changes, so it is not repeated there.
function tonesCSS(doc, P, pre, tones, alt) {
  const pals = dsPalettes(doc);
  let s = '';
  for (const tone of DS_TONES) {
    if (!tones.has(tone) || (alt && tone === 'light')) continue;
    s += `${pre}.lp-tone-${tone}{${dsPalDecl(dsTonePal(tone, P, pals))}}\n`;
  }
  return s;
}

// Theme-toggle icons: moon while light (switch to dark), sun while dark.
const dsIcons = (dark, pre) => (dark
  ? `${pre}.lp-i-moon{display:none}${pre}.lp-i-sun{display:inline-block}`
  : `${pre}.lp-i-sun{display:none}${pre}.lp-i-moon{display:inline-block}`);

// One scheme block: palette `P` on `sel` (html selector in view, `<pre> .lp-root` in edit) + tones (+ toggle icons).
function darkBlock(doc, pre, o = {}) {
  const pals = dsPalettes(doc);
  const P = o.light ? pals.L : pals.D;
  const edit = !!o.edit;
  const root = edit ? `${pre} .lp-root` : pre;
  const tones = o.tones || new Set(DS_TONES);
  return `${root}{${dsPalDecl(P)}}\n` + tonesCSS(doc, P, root + ' ', tones, true)
    + (o.icons ? dsIcons(P.dark, root + ' ') + '\n' : '');
}

// Alternative scheme for exports: scheme light (+toggle) → dark under html[data-scheme=dark]; scheme dark (+toggle)
// → light under html[data-scheme=light]; auto → dark for [data-scheme=dark] and prefers-color-scheme:dark unless the
// visitor picked light. Screen only: print always uses the light palette (printCSS).
function darkCSS(doc, o = {}) {
  const sch = doc.theme.scheme;
  const toggle = !!doc.output.themeToggle;
  if (sch === 'dark') return toggle ? `@media screen{${darkBlock(doc, 'html[data-scheme=light]', { ...o, light: true })}}\n` : '';
  if (sch !== 'auto' && !toggle) return '';
  let s = `@media screen{${darkBlock(doc, 'html[data-scheme=dark]', o)}}\n`;
  if (sch === 'auto') s += `@media screen and (prefers-color-scheme:dark){${darkBlock(doc, 'html:not([data-scheme=light])', o)}}\n`;
  return s;
}

/* ---------- CSS library ---------- */

// Always (view and edit). Nothing here targets html/body: the editor injects this into its own document.
const CSS_BASE = `
.lp-root{container:lp/inline-size;position:relative;isolation:isolate;display:flex;flex-direction:column;min-height:calc(var(--lp-vh) * 100);overflow-x:clip;background:var(--lp-bg);color:var(--lp-text);font-family:var(--lp-font);font-size:var(--lp-fs);line-height:var(--lp-lh);font-kerning:normal;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;-webkit-text-size-adjust:100%;text-size-adjust:100%;overflow-wrap:break-word;--lp-gut:32px;--lp-bs:clamp(18px,calc(12px + 1.4cqi),30px)}
.lp-root *,.lp-root *::before,.lp-root *::after{box-sizing:border-box}
.lp-header{position:relative;z-index:30;flex:none}
.lp-main{flex:1 0 auto;min-width:0}
.lp-footer{flex:none}
.lp-root :where(h1,h2,h3,h4,h5,h6){margin:0;font-family:var(--lp-font-h);font-weight:var(--lp-hw,700);line-height:1.2;color:inherit}
.lp-root :where(p){margin:0 0 .9em}
.lp-root :where(figure,blockquote,dl,dd){margin:0}
.lp-root :where(img,video){max-width:100%;height:auto}
.lp-root :where(button,input,select,textarea){font:inherit;color:inherit}
.lp-root :where(table){border-collapse:collapse}
.lp-root :where(hr){height:0;margin:1.6em 0;border:0;border-top:1px solid var(--lp-border)}
.lp-root :where(summary){cursor:pointer}
.lp-root :where(a){color:var(--lp-link);text-decoration-line:underline;text-decoration-thickness:max(1px,.07em);text-underline-offset:.2em;text-decoration-color:color-mix(in srgb,currentColor 42%,transparent);transition:color var(--lp-dur) var(--lp-ease),text-decoration-color var(--lp-dur) var(--lp-ease)}
.lp-root :where(a:hover){text-decoration-color:currentColor}
.lp-root :where([hidden]){display:none!important}
.lp-root ::selection{background:var(--lp-sel)}
.lp-root :focus-visible{outline:2px solid var(--lp-link);outline-offset:2px}
.lp-root code{padding:.08em .34em;border-radius:4px;background:var(--lp-hover);font:.88em/1.4 ui-monospace,"Cascadia Code","SF Mono",Menlo,Consolas,monospace}
.lp-wrap{width:100%;max-width:calc(var(--lp-w) + var(--lp-gut) * 2);margin-inline:auto;padding-left:max(var(--lp-gut),env(safe-area-inset-left,0px));padding-right:max(var(--lp-gut),env(safe-area-inset-right,0px))}
.lp-wrap-narrow{max-width:calc(min(var(--lp-w),760px) + var(--lp-gut) * 2)}
.lp-wrap-wide{max-width:calc(var(--lp-w) + 200px + var(--lp-gut) * 2)}
.lp-wrap-full{max-width:none}
.lp-solo{padding-block:calc(var(--lp-sec) * .45)}
.lp-b{--lp-mt:initial;--lp-mb:initial;min-width:0;margin:var(--lp-mt,0) 0 var(--lp-mb,var(--lp-bs))}
.lp-b:last-child{margin-bottom:var(--lp-mb,0)}
.lp-root :is(.lp-header,.lp-main,.lp-footer)>.lp-b{margin:var(--lp-mt,0) 0 var(--lp-mb,0)}
.lp-tone-muted,.lp-tone-dark,.lp-tone-accent,.lp-tone-light{background-color:var(--lp-bg);color:var(--lp-text)}
.lp-cbg{--lp-bg:var(--lp-cbg);--lp-text:currentColor;--lp-link:currentColor;--lp-muted:color-mix(in srgb,currentColor 76%,transparent);--lp-border:color-mix(in srgb,currentColor 18%,transparent);--lp-border-s:color-mix(in srgb,currentColor 42%,transparent);--lp-surface:color-mix(in srgb,currentColor 7%,transparent);--lp-hover:color-mix(in srgb,currentColor 8%,transparent);background-color:var(--lp-cbg)}
.lp-ic{width:1.15em;height:1.15em;flex:none;vertical-align:-.2em;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
.lp-sr{position:absolute!important;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
.lp-muted{color:var(--lp-muted)}
.lp-a-left{text-align:left}
.lp-a-center{text-align:center}
.lp-a-right{text-align:right}
.lp-a-center :is(.lp-btns,.lp-chips){justify-content:center}
.lp-a-right :is(.lp-btns,.lp-chips){justify-content:flex-end}
.lp-a-center :is(.lp-lead,.lp-measure){margin-inline:auto}
.lp-a-center .lp-rich :is(ul,ol){display:inline-block;text-align:start}
.lp-eyebrow{display:inline-flex;align-items:center;gap:.6em;margin:0 0 .95rem;color:var(--lp-link);font-size:.78em;font-weight:700;line-height:1.35;letter-spacing:.14em;text-transform:uppercase}
.lp-h{margin:0;font-family:var(--lp-font-h);font-weight:var(--lp-hw,700);line-height:1.18;letter-spacing:-.012em;text-wrap:balance}
.lp-h1{font-size:calc(var(--lp-hk,1) * clamp(calc(var(--lp-fs) * 2.1),calc(var(--lp-fs) * 1.15 + 4.2cqi),calc(var(--lp-fs) * 4)));line-height:1.06;letter-spacing:-.028em}
.lp-h2{font-size:calc(var(--lp-hk,1) * clamp(calc(var(--lp-fs) * 1.6),calc(var(--lp-fs) * 1.05 + 2.4cqi),calc(var(--lp-fs) * 2.7)));line-height:1.12;letter-spacing:-.022em}
.lp-h3{font-size:calc(var(--lp-hk,1) * clamp(calc(var(--lp-fs) * 1.2),calc(var(--lp-fs) * .98 + .9cqi),calc(var(--lp-fs) * 1.55)));line-height:1.25;letter-spacing:-.012em}
.lp-h4{font-size:calc(var(--lp-hk,1) * clamp(calc(var(--lp-fs) * 1.06),calc(var(--lp-fs) * .98 + .35cqi),calc(var(--lp-fs) * 1.22)));line-height:1.35;letter-spacing:-.004em}
.lp-lead{margin:0 0 1em;color:var(--lp-muted);font-size:clamp(calc(var(--lp-fs) * 1.06),calc(var(--lp-fs) * .94 + .5cqi),calc(var(--lp-fs) * 1.28));line-height:1.55;text-wrap:pretty}
.lp-measure{max-width:44em}
.lp-rich{text-wrap:pretty}
.lp-rich>:last-child,.lp-rich>:last-child>:last-child{margin-bottom:0}
.lp-rich :is(ul,ol){margin:0 0 .9em;padding-inline-start:1.35em}
.lp-rich li{margin:.3em 0}
.lp-rich li::marker{color:var(--lp-link)}
.lp-rich strong,.lp-rich b{font-weight:700}
.lp-rich h3{margin:1.3em 0 .5em;font-size:1.28em;line-height:1.3}
.lp-rich h4{margin:1.1em 0 .4em;font-size:1.08em;line-height:1.35}
.lp-rich>:is(h3,h4):first-child{margin-top:0}
.lp-rich blockquote{margin:1.1em 0;padding:.2em 0;padding-inline-start:1.1em;border-inline-start:3px solid var(--lp-accent);color:var(--lp-muted);font-style:italic}
.lp-rich pre{margin:1em 0;padding:.9em 1.1em;overflow:auto;border-radius:var(--lp-radius-s);background:var(--lp-hover);white-space:pre-wrap;font:.86em/1.5 ui-monospace,"Cascadia Code","SF Mono",Consolas,monospace}
.lp-rich pre code{padding:0;background:none}
.lp-rich hr{margin:1.4em 0}
.lp-rich img{display:block;height:auto;border-radius:var(--lp-radius-s)}
.lp-rich mark{padding:0 .15em;border-radius:3px;background:#fde68a;color:#1f2937}
.lp-rich a{overflow-wrap:anywhere}
.lp-i1{margin-inline-start:1.6em!important}
.lp-i2{margin-inline-start:3.2em!important}
.lp-i3{margin-inline-start:4.8em!important}
.lp-i4{margin-inline-start:6.4em!important}
.lp-btns{display:flex;flex-wrap:wrap;align-items:center;gap:12px}
.lp-btns-center{justify-content:center}
.lp-btns-right{justify-content:flex-end}
.lp-btn{display:inline-flex;align-items:center;justify-content:center;gap:.55em;min-height:2.85em;max-width:100%;padding:.72em 1.4em;border:1.5px solid var(--lp-border-s);border-radius:var(--lp-btn-r);background:transparent;color:var(--lp-text);font:inherit;font-size:.95em;font-weight:600;line-height:1.2;letter-spacing:.005em;text-align:center;text-decoration:none;cursor:pointer;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;transition:background-color var(--lp-dur) var(--lp-ease),border-color var(--lp-dur) var(--lp-ease),color var(--lp-dur) var(--lp-ease),box-shadow var(--lp-dur) var(--lp-ease),transform var(--lp-dur) var(--lp-ease)}
.lp-btn:hover{border-color:var(--lp-text);background:var(--lp-hover);color:var(--lp-text)}
.lp-btn:active{transform:translateY(1px)}
.lp-btn:focus-visible{outline:2px solid var(--lp-link);outline-offset:3px}
.lp-btn .lp-ic{width:1.15em;height:1.15em;margin-inline:-.1em}
.lp-btn-primary{border-color:var(--lp-accent);background:var(--lp-accent);color:var(--lp-on-accent)}
.lp-btn-primary:hover{border-color:var(--lp-accent-h);background:var(--lp-accent-h);color:var(--lp-on-accent);transform:translateY(-1px)}
.lp-btn-secondary{border-color:var(--lp-border-s);background:transparent;color:var(--lp-text)}
.lp-btn-ghost{border-color:transparent;background:transparent;color:var(--lp-link);padding-inline:.9em}
.lp-btn-ghost:hover{border-color:transparent;background:var(--lp-tint);color:var(--lp-link)}
.lp-btn-sm{min-height:2.4em;padding:.5em 1em;font-size:.86em}
.lp-btn-lg{min-height:3.25em;padding:.92em 1.8em;font-size:1.04em}
.lp-btn:is([disabled],[aria-disabled="true"]){opacity:.5;cursor:not-allowed;transform:none}
@container lp (max-width:900px){.lp-header,.lp-main,.lp-footer{--lp-gut:24px}}
@container lp (max-width:600px){.lp-header,.lp-main,.lp-footer{--lp-gut:20px;font-size:min(var(--lp-fs),max(15px,calc(var(--lp-fs) * .94)))}.lp-btns{gap:10px}.lp-h1,.lp-h2{hyphens:auto}.lp-i3,.lp-i4{margin-inline-start:3.2em!important}}
@media (prefers-reduced-motion:reduce){.lp-root *,.lp-root *::before,.lp-root *::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}
`;

// View only: document-level rules an export needs (never shipped into the editor document).
const CSS_VIEW = `
html{background:var(--lp-bg);-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--lp-bg)}
html:not(.lp-js) .lp-js-only{display:none!important}
[hidden]{display:none!important}
:focus-visible{outline:2px solid var(--lp-link);outline-offset:2px}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}
`;

// Heading styles (theme.headings). Emitted for the doc's style only, unscoped: the editor refreshes CSS without
// re-rendering markup on theme edits, so root classes may lag while doc-driven CSS never does.
const DS_HEADS = {
  normal: '',
  caps: `.lp-root{--lp-hk:.9}
:is(.lp-h1,.lp-h2,.lp-h3){text-transform:uppercase;letter-spacing:.012em}
.lp-h1{letter-spacing:-.005em}`,
  italic: `:is(.lp-h1,.lp-h2){font-style:italic;letter-spacing:-.01em}`,
  underline: `.lp-h2{text-decoration-line:underline;text-decoration-color:var(--lp-accent);text-decoration-thickness:max(3px,.07em);text-underline-offset:.24em;text-decoration-skip-ink:none}`,
  eyebrow: `.lp-eyebrow{padding:.45em 1em;border-radius:999px;background:var(--lp-tint);letter-spacing:.08em}
.lp-h2{letter-spacing:-.03em}`,
};

// Button shapes (theme.buttons). Radius comes from --lp-btn-r (varsCSS); only outline needs rules.
const DS_BTNS = {
  solid: '',
  pill: '',
  square: '',
  outline: `.lp-btn-primary{border-width:2px;border-color:var(--lp-link);background:transparent;color:var(--lp-link)}
.lp-btn-primary:hover{border-color:var(--lp-accent);background:var(--lp-accent);color:var(--lp-on-accent)}`,
};

// Reveal states (output.motion), only under html.lp-reveal (set by rtReveal) and only without reduced motion.
// The first main block and the header are never hidden (no flash of an empty first screen, LCP stays visible).
const DS_REVEAL = {
  fade: '@media (prefers-reduced-motion:no-preference){html.lp-reveal .lp-rv{opacity:0;transition:opacity .9s var(--lp-ease)}html.lp-reveal .lp-rv.lp-in{opacity:1}}',
  rise: '@media (prefers-reduced-motion:no-preference){html.lp-reveal .lp-rv{opacity:0;transform:translate3d(0,28px,0);transition:opacity .8s var(--lp-ease),transform .8s var(--lp-ease)}html.lp-reveal .lp-rv.lp-in{opacity:1;transform:none}}',
};
const DS_REVEAL_KEEP = 'html.lp-reveal :is(.lp-header .lp-rv,.lp-main>.lp-rv:first-child){opacity:1;transform:none}\n@media print{html.lp-reveal .lp-rv{opacity:1!important;transform:none!important}}';

// Device visibility (common prop device): phones = .lp-root container ≤600px.
const DS_DEVICE = '@container lp (max-width:600px){.lp-dev-desktop{display:none!important}}\n@container lp (min-width:601px){.lp-dev-mobile{display:none!important}}';

// CSS-only back-to-top (<a class="lp-totop" href="#top">): fades in after scrolling where scroll-driven animations
// exist, always visible elsewhere. `bottom` is set by buildCSS so it clears floating tools / cart button.
const DS_TOTOP = `
.lp-totop{position:fixed;z-index:1000;inset-inline-end:16px;display:grid;place-items:center;width:46px;height:46px;border:1px solid var(--lp-border);border-radius:50%;background:var(--lp-bg);color:var(--lp-text);box-shadow:var(--lp-shadow-lg);text-decoration:none;transition:background-color var(--lp-dur) var(--lp-ease),color var(--lp-dur) var(--lp-ease),border-color var(--lp-dur) var(--lp-ease)}
.lp-totop:hover{border-color:var(--lp-accent);background:var(--lp-accent);color:var(--lp-on-accent)}
.lp-totop:focus-visible{outline:2px solid var(--lp-link);outline-offset:3px}
.lp-totop .lp-ic{width:20px;height:20px}
.lp-totop:not(:has(svg))::before{content:"";width:11px;height:11px;margin-top:5px;border-top:2px solid currentColor;border-left:2px solid currentColor;transform:rotate(45deg)}
@media (prefers-reduced-motion:no-preference){@supports (animation-timeline:scroll()){.lp-totop{animation:lp-totop linear both;animation-timeline:scroll(root);animation-range:120px 520px}}}
@keyframes lp-totop{from{opacity:0;visibility:hidden;transform:translateY(14px) scale(.9)}to{opacity:1;visibility:visible;transform:none}}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
`;

/* Shared chunks (CONTRACT.md §13), shipped when a used block type lists them in BLOCK_DEPS or a used runtime feature
   needs them (DS_FEAT_DEPS). Classes per chunk are mapped in CLASS_OWNER_BASE for theme-rule shaking. */
const CSS_SHARED = {
  grid: `
.lp-grid{display:grid;grid-template-columns:repeat(var(--lp-cols,3),minmax(0,1fr));gap:var(--lp-ggap,var(--lp-gap))}
.lp-grid-fit{grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--lp-min,15rem)),1fr))}
@container lp (max-width:900px){.lp-grid:not(.lp-grid-fit){grid-template-columns:repeat(min(var(--lp-cols,3),2),minmax(0,1fr))}}
@container lp (max-width:600px){.lp-grid:not(.lp-grid-fit){grid-template-columns:minmax(0,1fr)}.lp-grid{gap:min(var(--lp-ggap,var(--lp-gap)),18px)}}
`,
  card: `
.lp-card{position:relative;min-width:0;padding:var(--lp-card-p,24px);border:1px solid var(--lp-border);border-radius:var(--lp-radius);background:var(--lp-surface);color:var(--lp-text)}
.lp-card-hover{transition:transform var(--lp-dur) var(--lp-ease),box-shadow var(--lp-dur) var(--lp-ease),border-color var(--lp-dur) var(--lp-ease)}
.lp-card-hover:is(:hover,:focus-within){transform:translateY(-3px);border-color:var(--lp-border-s);box-shadow:var(--lp-shadow-lg)}
@container lp (max-width:600px){.lp-card{padding:var(--lp-card-p,20px)}}
`,
  media: `
.lp-media{position:relative;display:block;aspect-ratio:var(--lp-ratio,4/3);overflow:hidden;border-radius:var(--lp-radius);background:var(--lp-hover)}
.lp-media>img,.lp-media>video,.lp-media>picture>img{display:block;width:100%;height:100%;object-fit:var(--lp-fit,cover)}
.lp-media-round{aspect-ratio:1/1;border-radius:50%}
.lp-media-flat{border-radius:0}
.lp-ph{display:flex;align-items:center;justify-content:center;width:100%;height:100%;min-height:96px;background:repeating-linear-gradient(-45deg,transparent 0 10px,rgba(127,127,127,.07) 10px 20px),var(--lp-tint);color:var(--lp-link)}
.lp-ph .lp-ic{width:34px;height:34px;stroke-width:1.5;opacity:.8}
`,
  chip: `
.lp-chips{display:flex;flex-wrap:wrap;gap:6px}
.lp-chip{display:inline-flex;align-items:center;gap:.35em;max-width:100%;padding:.3em .8em;border-radius:999px;background:var(--lp-hover);color:var(--lp-text);font-size:.8em;font-weight:550;line-height:1.3;overflow-wrap:anywhere}
.lp-chip .lp-ic{width:1em;height:1em}
.lp-badge{display:inline-flex;align-items:center;gap:.35em;padding:.32em .72em;border-radius:999px;background:var(--lp-accent);color:var(--lp-on-accent);font-size:.7em;font-weight:700;line-height:1.2;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}
.lp-badge-soft{background:var(--lp-tint);color:var(--lp-link)}
.lp-badge-ok{background:var(--lp-ok);color:var(--lp-bg)}
.lp-badge-danger{background:var(--lp-danger);color:var(--lp-bg)}
.lp-badge-muted{background:var(--lp-hover);color:var(--lp-text)}
`,
  icbox: `
.lp-icbox{display:inline-flex;align-items:center;justify-content:center;flex:none;width:48px;height:48px;border-radius:calc(var(--lp-radius-s) + 4px);background:var(--lp-tint);color:var(--lp-link)}
.lp-icbox .lp-ic{width:24px;height:24px;stroke-width:1.75}
.lp-icbox-lg{width:64px;height:64px}
.lp-icbox-lg .lp-ic{width:30px;height:30px}
.lp-icbox-solid{background:var(--lp-accent);color:var(--lp-on-accent)}
`,
  price: `
.lp-price{display:flex;flex-wrap:wrap;align-items:baseline;gap:.1em .55em;line-height:1.2;font-variant-numeric:tabular-nums}
.lp-price-now{color:var(--lp-text);font-size:1.3em;font-weight:700;letter-spacing:-.01em}
.lp-price-old{color:var(--lp-muted);font-size:.9em;text-decoration:line-through;text-decoration-thickness:1px}
.lp-price-unit{color:var(--lp-muted);font-size:.86em}
.lp-price-req{color:var(--lp-link);font-weight:650}
`,
  qty: `
.lp-qty{display:inline-flex;align-items:stretch;height:2.75em;overflow:hidden;vertical-align:middle;border:1px solid var(--lp-border-s);border-radius:var(--lp-btn-r);background:var(--lp-bg);color:var(--lp-text)}
.lp-qty button{-webkit-appearance:none;appearance:none;display:grid;place-items:center;width:2.6em;margin:0;padding:0;border:0;background:none;color:inherit;font:inherit;font-size:1.1em;line-height:1;cursor:pointer;transition:background-color var(--lp-dur) var(--lp-ease)}
.lp-qty button:hover{background:var(--lp-hover)}
.lp-qty button:disabled{opacity:.4;cursor:default}
.lp-qty input{width:3.4em;min-width:0;margin:0;padding:0 .25em;border:0;border-inline:1px solid var(--lp-border);border-radius:0;background:none;color:inherit;font:inherit;font-size:max(16px,1em);font-weight:600;text-align:center;-moz-appearance:textfield;appearance:textfield}
.lp-qty input::-webkit-inner-spin-button,.lp-qty input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
.lp-qty :focus-visible{outline:2px solid var(--lp-link);outline-offset:-3px}
.lp-qty:focus-within{border-color:var(--lp-link)}
`,
  kv: `
.lp-kv{display:grid;grid-template-columns:minmax(0,max-content) minmax(0,1fr);margin:0;font-size:.94em;line-height:1.45}
.lp-kv>div{display:contents}
.lp-kv :is(dt,dd){margin:0;padding:.55em 0;border-bottom:1px solid var(--lp-border)}
.lp-kv dt{padding-inline-end:1.25em;color:var(--lp-muted)}
.lp-kv dd{font-weight:600;text-align:end;overflow-wrap:anywhere}
.lp-kv>dt:last-of-type,.lp-kv>dd:last-of-type,.lp-kv>div:last-child>*{border-bottom:0}
`,
  form: `
.lp-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px 16px;margin:0}
.lp-field{grid-column:1/-1;display:flex;flex-direction:column;gap:7px;min-width:0}
.lp-field-half{grid-column:span 1}
.lp-label{color:var(--lp-text);font-size:.9em;font-weight:600;line-height:1.35}
.lp-label :is(abbr,.lp-req){color:var(--lp-danger);text-decoration:none;cursor:help}
.lp-input{display:block;width:100%;min-height:2.9em;margin:0;padding:.68em .9em;border:1px solid var(--lp-border-s);border-radius:var(--lp-radius-s);background:var(--lp-bg);color:var(--lp-text);font:inherit;font-size:max(16px,.95em);line-height:1.4;outline:2px solid transparent;outline-offset:1px;transition:border-color var(--lp-dur) var(--lp-ease),box-shadow var(--lp-dur) var(--lp-ease)}
.lp-input::placeholder{color:var(--lp-muted);opacity:.85}
.lp-input:hover{border-color:var(--lp-text)}
.lp-input:focus{border-color:var(--lp-link);box-shadow:0 0 0 3px var(--lp-tint);outline:none}
.lp-input:focus-visible{outline:none}
.lp-input[aria-invalid="true"]{border-color:var(--lp-danger);box-shadow:0 0 0 3px color-mix(in srgb,var(--lp-danger) 16%,transparent)}
.lp-input:disabled{opacity:.55;cursor:not-allowed}
textarea.lp-input{min-height:8.5em;resize:vertical}
select.lp-input{-webkit-appearance:none;appearance:none;padding-inline-end:2.6em;background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);background-position:calc(100% - 1.25em) 52%,calc(100% - .9em) 52%;background-size:.36em .36em,.36em .36em;background-repeat:no-repeat;cursor:pointer}
[dir=rtl] select.lp-input{background-position:1.25em 52%,.9em 52%}
.lp-check{display:flex;align-items:flex-start;gap:.65em;font-size:.93em;line-height:1.45;cursor:pointer}
.lp-check input{flex:none;width:1.15em;height:1.15em;margin:.18em 0 0;accent-color:var(--lp-accent);cursor:pointer}
.lp-check .lp-rich{font-size:inherit}
.lp-err{color:var(--lp-danger);font-size:.84em;font-weight:500;line-height:1.35}
.lp-err:empty{display:none}
.lp-form-result{grid-column:1/-1;padding:.85em 1.05em;border:1px solid transparent;border-radius:var(--lp-radius-s);font-size:.95em;line-height:1.5}
.lp-form-result:empty{display:none}
.lp-form-result[data-state=ok]{border-color:color-mix(in srgb,var(--lp-ok) 35%,transparent);background:color-mix(in srgb,var(--lp-ok) 10%,transparent)}
.lp-form-result[data-state=err]{border-color:color-mix(in srgb,var(--lp-danger) 35%,transparent);background:color-mix(in srgb,var(--lp-danger) 9%,transparent)}
.lp-form-result[data-state=queued]{border-color:color-mix(in srgb,var(--lp-accent) 30%,transparent);background:var(--lp-tint)}
.lp-form>:is(.lp-btn,.lp-btns,.lp-form-foot){grid-column:1/-1;justify-self:start}
@container lp (max-width:600px){.lp-form{grid-template-columns:minmax(0,1fr)}.lp-field-half{grid-column:1/-1}.lp-form>.lp-btn{justify-self:stretch}}
`,
  dlg: `
.lp-dlg,.lp-backdrop{position:fixed;inset:0;z-index:1200;background:rgba(8,10,14,.66);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);animation:lp-fade .2s var(--lp-ease)}
.lp-dlg{display:flex;align-items:center;justify-content:center;padding:max(16px,3vmin);overscroll-behavior:contain}
.lp-dlg-panel{position:relative;display:flex;flex-direction:column;width:min(100%,720px);max-height:100%;overflow:auto;border:1px solid var(--lp-border);border-radius:var(--lp-radius);background:var(--lp-bg);color:var(--lp-text);box-shadow:var(--lp-shadow-lg);font-family:var(--lp-font);font-size:var(--lp-fs);line-height:var(--lp-lh);animation:lp-pop .24s var(--lp-ease)}
.lp-dlg-media{background:rgba(5,6,8,.92)}
.lp-dlg-media .lp-dlg-panel{width:auto;max-width:100%;border:0;background:transparent;box-shadow:none;overflow:visible}
.lp-dlg-media :is(img,video){display:block;max-width:100%;max-height:calc(100vh - 120px);object-fit:contain;border-radius:4px}
.lp-dlg-x{position:absolute;top:10px;inset-inline-end:10px;z-index:2;display:grid;place-items:center;width:40px;height:40px;margin:0;padding:0;border:0;border-radius:50%;background:var(--lp-hover);color:inherit;font:600 22px/1 system-ui,sans-serif;cursor:pointer;transition:background-color var(--lp-dur) var(--lp-ease)}
.lp-dlg-x:hover{background:color-mix(in srgb,currentColor 16%,transparent)}
.lp-dlg-x .lp-ic{width:20px;height:20px}
.lp-dlg-media .lp-dlg-x{position:fixed;top:14px;inset-inline-end:14px;background:rgba(255,255,255,.14);color:#fff}
:is(.lp-dlg,.lp-drawer,.lp-backdrop)[hidden]{display:none!important}
html.lp-lock,html.lp-lock body{overflow:hidden}
@keyframes lp-fade{from{opacity:0}}
@keyframes lp-pop{from{opacity:0;transform:translateY(10px) scale(.98)}}
`,
  att: `
.lp-att{min-width:0;overflow:hidden;border:1px solid var(--lp-border);border-radius:var(--lp-radius);background:var(--lp-surface);color:var(--lp-text);container:lp-att/inline-size}
.lp-att-head{display:flex;flex-wrap:wrap;align-items:center;gap:.6em .9em;padding:.85em 1em}
.lp-att-ic{width:2.6em;height:2.6em;padding:.58em;border-radius:calc(var(--lp-radius-s) + 2px);background:var(--lp-tint);color:var(--lp-link);stroke-width:1.7}
.lp-att-meta{flex:1 1 min(16em,calc(100% - 3.5em));min-width:0}
.lp-att-title{font-weight:650;line-height:1.3;overflow-wrap:anywhere}
.lp-att-desc{margin-top:.15em;color:var(--lp-muted);font-size:.92em}
.lp-att-info{margin-top:.15em;color:var(--lp-muted);font-size:.8em;overflow-wrap:anywhere}
.lp-att-btns{display:flex;flex-wrap:wrap;gap:.4em;justify-content:flex-end;margin-inline-start:auto}
.lp-att-btns .lp-btn{min-height:2.45em;padding:.5em .95em;font-size:.82em}
.lp-att-prev{border-top:1px solid var(--lp-border);background:var(--lp-bg)}
.lp-att-obj{display:block;width:100%;border:0;background:var(--lp-hover)}
.lp-att-img{padding:.8em;text-align:center}
.lp-att-img img{display:inline-block;max-height:calc(var(--lp-vh) * 80);border-radius:calc(var(--lp-radius-s) * .6)}
.lp-att-prev :is(video,audio){display:block;width:100%}
.lp-att-prev audio{padding:.85em 1em}
.lp-att-see{padding:.6em 1em;font-size:.88em}
.lp-att-see a{display:inline-flex;align-items:center;gap:.45em}
.lp-att-fb{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:.6em .9em;min-height:5em;height:100%;padding:1.4em;color:var(--lp-muted);font-size:.9em;text-align:center}
@container lp-att (max-width:30em){.lp-att-btns{flex-basis:100%;justify-content:flex-start;padding-inline-start:calc(2.6em + .9em)}}
`,
};

// Shared chunks a runtime feature needs even when no block type lists them (drawer, dialogs, checkout form…).
const DS_FEAT_DEPS = { cart: ['dlg', 'qty', 'price', 'form'], checkout: ['form'], form: ['form'], lightbox: ['dlg'], agegate: ['dlg'], embed: ['att'] };

/* Language switcher / theme toggle (nav tools slot `.lp-tools` and the floating `.lp-toolbar`). Controls follow the
   renderToolbar markup: button.lp-tb-lang[data-set-lang] (.lp-tb-ln name + .lp-tb-lc code), select.lp-tb-sel
   [data-set-lang], button.lp-tb-btn[data-lp-scheme] (.lp-i-moon / .lp-i-sun icons), .lp-tb-sep, .lp-tb-txt. In the
   nav they inherit the nav colours (washes are currentColor based, the active language uses the accent). */
const CSS_TOOLS = `
.lp-tools{display:flex;flex:none;align-items:center;gap:4px;min-width:0}
.lp-tools>*{flex:none}
.lp-tb-lang,.lp-tb-btn{-webkit-appearance:none;appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:36px;min-height:36px;margin:0;padding:6px 11px;border:0;border-radius:999px;background:none;color:inherit;font:inherit;font-size:.86em;font-weight:600;line-height:1;letter-spacing:.01em;white-space:nowrap;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background-color var(--lp-dur) var(--lp-ease),color var(--lp-dur) var(--lp-ease)}
.lp-tb-lang:hover,.lp-tb-btn:hover{background:color-mix(in srgb,currentColor 11%,transparent)}
.lp-tb-lang[aria-pressed="true"]{background:var(--lp-accent);color:var(--lp-on-accent)}
.lp-tb-btn{width:38px;height:38px;padding:0}
.lp-tb-btn .lp-ic{width:18px;height:18px}
.lp-tb-sel{-webkit-appearance:none;appearance:none;min-height:36px;margin:0;padding:6px 2.1em 6px 12px;border:1px solid color-mix(in srgb,currentColor 24%,transparent);border-radius:999px;background-color:transparent;background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);background-position:calc(100% - 15px) 52%,calc(100% - 10px) 52%;background-size:5px 5px,5px 5px;background-repeat:no-repeat;color:inherit;font:inherit;font-size:.86em;font-weight:600;cursor:pointer}
.lp-tb-sel option{background:var(--lp-bg);color:var(--lp-text)}
.lp-tb-sep{flex:none;width:1px;height:20px;margin:0 4px;background:currentColor;opacity:.2}
.lp-tb-lc{display:none}
.lp-tb-txt{margin-inline-start:2px}
:is(.lp-tools,.lp-toolbar) :focus-visible{outline:2px solid var(--lp-link);outline-offset:1px}
@container lp (max-width:900px){.lp-tools .lp-tb-lc{display:inline}.lp-tools :is(.lp-tb-ln,.lp-tb-txt){position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.lp-tools .lp-tb-lang{min-width:34px;padding:6px 8px}}
/* Phones: the nav keeps brand, menu and tools on one row - the cart button shows its icon and count only, and on the
   narrowest screens the theme toggle steps aside (the page then follows the system colour scheme). */
@container lp (max-width:600px){.lp-tools .lp-cartbtn{padding:8px 10px}.lp-tools .lp-cartbtn-t{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}}
@container lp (max-width:430px){.lp-tools .lp-tb-btn{display:none}}
`;
// Floating pill (no nav to host the tools, or toolbarPos ≠ 'nav'). Outside .lp-root: plain viewport positioning.
const CSS_TOOLBAR = `
.lp-toolbar{position:fixed;z-index:1100;top:calc(14px + env(safe-area-inset-top,0px));right:14px;display:flex;flex-wrap:nowrap;align-items:center;gap:2px;max-width:calc(100vw - 28px);padding:4px;overflow-x:auto;scrollbar-width:none;border:1px solid var(--lp-border);border-radius:999px;background:var(--lp-bg);background:color-mix(in srgb,var(--lp-bg) 84%,transparent);-webkit-backdrop-filter:blur(14px) saturate(1.5);backdrop-filter:blur(14px) saturate(1.5);box-shadow:var(--lp-shadow-lg);color:var(--lp-text);font:500 15px/1.2 var(--lp-font)}
.lp-toolbar::-webkit-scrollbar{display:none}
.lp-toolbar>*{flex:none}
.lp-tb-bottom-right,.lp-tb-bottom-left{top:auto;bottom:calc(14px + env(safe-area-inset-bottom,0px))}
.lp-tb-bottom-left{right:auto;left:14px}
`;

/* Editor canvas affordances (edit mode only; scoped by .lp-root[data-mode=edit]). The canvas renders at real device
   widths, so nothing is fixed/sticky here, reveal is off and device-hidden blocks stay visible (faded). */
const DS_ICON_IMG = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='3' width='18' height='18' rx='2.5'/%3E%3Ccircle cx='9' cy='9' r='2'/%3E%3Cpath d='M21 15l-5-5L5 21'/%3E%3C/svg%3E\")";
const CSS_EDIT = `
.lp-root[data-mode=edit] .lp-f{outline:none;cursor:text;border-radius:3px;min-width:1ch;transition:background-color .12s,box-shadow .12s}
.lp-root[data-mode=edit] span.lp-f:empty{display:inline-block;min-width:2em}
.lp-root[data-mode=edit] .lp-f:empty::before{content:attr(data-ph);color:currentColor;opacity:.5;font-style:italic;font-weight:400;text-transform:none;letter-spacing:normal;pointer-events:none}
.lp-root[data-mode=edit] .lp-f:hover{background-color:color-mix(in srgb,currentColor 7%,transparent)}
.lp-root[data-mode=edit] .lp-f:focus{background-color:color-mix(in srgb,var(--lp-a0) 9%,transparent);box-shadow:0 0 0 2px color-mix(in srgb,var(--lp-a0) 55%,transparent)}
.lp-root[data-mode=edit] .lp-opt:empty::before{opacity:.32}
.lp-root[data-mode=edit] .lp-missing{box-shadow:inset 0 -2px 0 rgba(217,119,6,.65)}
.lp-root[data-mode=edit] .lp-missing:empty::before{color:#d97706;opacity:.95}
.lp-root[data-mode=edit] .lp-hidden{opacity:.4;background-image:repeating-linear-gradient(-45deg,rgba(100,116,139,.15) 0 6px,transparent 6px 12px)}
.lp-root[data-mode=edit] .lp-langhidden{opacity:.55;outline:1.5px dashed rgba(217,119,6,.85);outline-offset:-2px}
.lp-root[data-mode=edit] .lp-b{min-height:1.2em}
.lp-root[data-mode=edit] .lp-empty{display:flex;align-items:center;justify-content:center;min-height:56px;margin:6px 0;padding:12px;border:1.5px dashed color-mix(in srgb,currentColor 30%,transparent);border-radius:8px;color:inherit;opacity:.72;font:13px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Georgian",Sylfaen,sans-serif;text-align:center;-webkit-user-select:none;user-select:none}
.lp-root[data-mode=edit] :is(.lp-header,.lp-main,.lp-footer)>.lp-empty{min-height:76px;margin:12px var(--lp-gut)}
.lp-root[data-mode=edit] .lp-add-item{min-height:0;padding:.7em;cursor:pointer}
.lp-root[data-mode=edit] .lp-add-item:hover{border-color:var(--lp-a0);color:var(--lp-a0);opacity:1}
.lp-root[data-mode=edit] .lp-btn{cursor:default;transform:none!important}
.lp-root[data-mode=edit] .lp-btn .lp-f{cursor:text}
.lp-root[data-mode=edit] :is(.lp-header,.lp-header>.lp-b,[class*="-sticky"]){position:relative!important;top:auto!important}
.lp-root[data-mode=edit] :is(.lp-totop,.lp-toolbar,.lp-drawer,.lp-dlg){display:none!important}
.lp-root[data-mode=edit] .lp-rv{opacity:1!important;transform:none!important}
.lp-root[data-mode=edit] [data-att-key]{cursor:pointer}
.lp-root[data-mode=edit] [data-att-key]:hover{outline:2px dashed color-mix(in srgb,var(--lp-a0) 75%,transparent);outline-offset:-2px}
.lp-root[data-mode=edit] .lp-media[data-att-key]::after{content:"";position:absolute;top:8px;inset-inline-end:8px;width:30px;height:30px;border-radius:50%;background:rgba(17,24,39,.78) ${DS_ICON_IMG} center/16px no-repeat;box-shadow:0 1px 4px rgba(0,0,0,.3);opacity:0;transform:scale(.85);transition:opacity .15s,transform .15s;pointer-events:none}
.lp-root[data-mode=edit] .lp-media[data-att-key]:hover::after{opacity:1;transform:none}
.lp-root[data-mode=edit] .lp-ph{cursor:pointer}
.lp-root[data-mode=edit] .lp-att-missing{display:flex;align-items:center;justify-content:center;gap:.5em;min-height:4.5em;padding:1em;border:1.5px dashed var(--lp-border-s);border-radius:var(--lp-radius);color:var(--lp-muted);font-size:.9em;text-align:center}
.lp-root[data-mode=edit] .lp-b-spacer{background-image:repeating-linear-gradient(-45deg,rgba(100,116,139,.1) 0 5px,transparent 5px 10px)}
.lp-root[data-mode=edit] :is(.lp-dev-desktop,.lp-dev-mobile){--lp-devhint:1}
@container lp (max-width:600px){.lp-root[data-mode=edit] .lp-dev-desktop{opacity:.42;outline:1.5px dashed rgba(100,116,139,.75);outline-offset:-2px}}
@container lp (min-width:601px){.lp-root[data-mode=edit] .lp-dev-mobile{opacity:.42;outline:1.5px dashed rgba(100,116,139,.75);outline-offset:-2px}}
`;

/* Georgian: uppercase would turn Mkhedruli into Mtavruli (common fallback fonts lack it → tofu / mixed fonts) and
   caps-style tracking spreads the wide glyphs apart. :lang() follows the runtime language switch (html[lang]) and
   catches Georgian fallback spans (lang="ka") inside other languages; !important beats theme and block rules. */
function kaNoCapsCSS(edit) {
  const sel = edit ? '.lp-root:lang(ka),.lp-root :lang(ka)' : ':lang(ka)';
  return `${sel}{text-transform:none!important;font-variant-caps:normal!important;letter-spacing:normal!important}`;
}

function langCSS(langs) {
  const ok = langs.filter((l) => /^[A-Za-z0-9-]+$/.test(l));
  const rtl = ok.filter((l) => langDir(l) === 'rtl');
  return '.lp-rich>[data-l]>:last-child{margin-bottom:0}\n' + ok
    .map((l) => `html[lang="${l}"] [data-l]:not([data-l~="${l}"]){display:none!important}`).join('\n')
    + (rtl.length ? '\n' + rtl.map((l) => `html[lang="${l}"]`).join(',') + '{direction:rtl}' : '');
}

// Minimal print: light palette, no chrome (tools, cart, dialogs, back-to-top), colour bands kept, cards unbroken.
function printCSS(doc) {
  const light = dsDefaultDark(doc) ? `:root{${dsPalDecl(dsPalettes(doc).L)}}` : '';
  return `@media print{${light}
html,body{background:#fff!important}
.lp-root{overflow:visible;min-height:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
:is(.lp-tools,.lp-toolbar,.lp-totop,.lp-cartbtn,.lp-drawer,.lp-dlg,.lp-backdrop,.lp-nav-m,.lp-js-only),#lp-age{display:none!important}
.lp-header,.lp-header>.lp-b{position:static!important}
:is(.lp-card,.lp-att,.lp-media,.lp-kv>div,.lp-price,.lp-form,figure,blockquote,tr){break-inside:avoid}
:is(.lp-h,h1,h2,h3,h4){break-after:avoid}
*,*::before,*::after{animation:none!important;transition:none!important}}`;
}

/* ---------- tree shaking of theme rules ---------- */
// Class prefix → owner (block type, shared chunk, runtime feature or flag 'tools' / 'totop'). Core merges this with
// the block parts' OWN_* lists into CLASS_OWNER. A selector is kept when every matching owner is used.
const CLASS_OWNER_BASE = [
  [/\.lp-grid\b/, 'grid'], [/\.lp-card\b/, 'card'], [/\.lp-(media|ph)\b/, 'media'], [/\.lp-(chips?|badge)\b/, 'chip'],
  [/\.lp-icbox\b/, 'icbox'], [/\.lp-price\b/, 'price'], [/\.lp-qty\b/, 'qty'], [/\.lp-kv\b/, 'kv'],
  [/\.lp-(form|field|label|input|check|err)\b/, 'form'], [/\.lp-(dlg|drawer|backdrop)\b/, 'dlg'], [/\.lp-att\b/, 'att'],
  [/\.lp-(tools|toolbar|tb-[a-z]+|i-sun|i-moon)\b/, 'tools'], [/\.lp-totop\b/, 'totop'], [/\.lp-cartbtn\b/, 'cart'],
];
// Split a selector list on top-level commas (not inside :is()/:not()/[attr="a,b"]).
function splitSelectors(s) {
  const out = [];
  let depth = 0;
  let q = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '\\') i++; else if (ch === q) q = ''; continue; }
    if (ch === '"' || ch === "'") q = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out;
}
// Theme rules are one per line: plain `selectors{body}` rules keep the selectors whose owners are all used; at-rules
// (@media/@supports/@container…) and lines without '{' are kept or dropped whole. `sets` = Sets of used owners.
function shakeRules(css, ...sets) {
  const has = (o) => sets.some((s) => s && typeof s.has === 'function' && s.has(o));
  const table = Array.isArray(CLASS_OWNER) && CLASS_OWNER.length ? CLASS_OWNER : CLASS_OWNER_BASE;
  const used = (sel) => {
    for (const [re, owner] of table) if (re.test(sel) && !has(owner)) return false;
    return true;
  };
  const out = [];
  for (const line of String(css).split('\n')) {
    const t = line.trim();
    const b = t.indexOf('{');
    if (!t || t[0] === '@' || b < 0) {
      if (t && used(line)) out.push(line);
      continue;
    }
    const keep = splitSelectors(t.slice(0, b)).filter(used);
    if (keep.length) out.push(keep.join(',') + t.slice(b));
  }
  return out.join('\n');
}

/* ---------- buildCSS helpers ---------- */
const dsSet = (v) => (v instanceof Set ? v : new Set(Array.isArray(v) ? v : []));

// Doc facts the usage object does not carry: tone values in use, device-restricted blocks, background media
// (hero / section / cta backgrounds usually pair with dark/light tones). Walks section blocks and column lists.
function dsScan(doc) {
  const r = { tones: new Set(), device: false, bgMedia: false };
  const walk = (list, depth) => {
    if (!Array.isArray(list) || depth > 8) return;
    for (const b of list) {
      if (!isObj(b)) continue;
      if (typeof b.tone === 'string') r.tones.add(b.tone);
      if (b.device === 'desktop' || b.device === 'mobile') r.device = true;
      if (['bg', 'bgImage', 'bgVideo'].some((k) => typeof b[k] === 'string' && b[k])) r.bgMedia = true;
      walk(b.blocks, depth + 1);
      if (Array.isArray(b.cols)) for (const c of b.cols) if (isObj(c)) walk(c.blocks, depth + 1);
    }
  };
  const R = isObj(doc.regions) ? doc.regions : {};
  for (const k of Object.keys(R)) walk(R[k], 0);
  return r;
}

// Feature CSS for the editor canvas: drop rules aimed at html / body / :root (they would restyle the editor itself,
// e.g. a repeated js-only rule or a scroll lock). Nested @media/@supports/@container blocks are filtered recursively.
function dsEditSafe(css) {
  const s = String(css || '');
  let out = '';
  let i = 0;
  while (i < s.length) {
    // Read a prelude up to '{' or ';' at depth 0 (strings and comments skipped).
    let j = i;
    let q = '';
    let par = 0;
    while (j < s.length) {
      const ch = s[j];
      if (q) { if (ch === '\\') j++; else if (ch === q) q = ''; } else if (ch === '"' || ch === "'") q = ch;
      else if (ch === '/' && s[j + 1] === '*') { const e = s.indexOf('*/', j + 2); j = e < 0 ? s.length : e + 1; } else if (ch === '(') par++;
      else if (ch === ')') par--;
      else if (par <= 0 && (ch === '{' || ch === ';' || ch === '}')) break;
      j++;
    }
    const pre = s.slice(i, j).trim();
    if (j >= s.length || s[j] === ';' || s[j] === '}') { if (pre) out += pre + (s[j] === ';' ? ';' : ''); i = j + 1; continue; }
    // Matching close brace of the block.
    let k = j + 1;
    let depth = 1;
    q = '';
    while (k < s.length && depth) {
      const ch = s[k];
      if (q) { if (ch === '\\') k++; else if (ch === q) q = ''; } else if (ch === '"' || ch === "'") q = ch;
      else if (ch === '/' && s[k + 1] === '*') { const e = s.indexOf('*/', k + 2); k = e < 0 ? s.length : e + 1; } else if (ch === '{') depth++;
      else if (ch === '}') depth--;
      k++;
    }
    const body = s.slice(j + 1, depth ? s.length : k - 1);
    if (/^@(media|supports|container|layer)\b/i.test(pre)) {
      const inner = dsEditSafe(body);
      if (inner.trim()) out += `${pre}{${inner}}\n`;
    } else if (pre[0] === '@') {
      out += `${pre}{${body}}\n`;
    } else {
      const keep = splitSelectors(pre).map((x) => x.trim()).filter((x) => x && !/^(html|body|:root)(?![\w-])/i.test(x));
      if (keep.length) out += `${keep.join(',')}{${body}}\n`;
    }
    i = k;
  }
  return out;
}
// Runtime-only features whose CSS has no static look-alike on the canvas.
const DS_EDIT_SKIP_FEAT = ['reveal', 'agegate', 'pages'];

/* buildCSS(doc, opts{mode:'edit'|'view', usage, attURL, darkPreview}) → stylesheet text.
   View order (§7): @font-face, vars (+tones), base (+view, headings, buttons, device, reveal, back-to-top), shared
   chunks, block chunks, variant chunks, theme css (shaken), ka, tools, features, lang, alternative scheme, print.
   Edit: every type / variant / chunk, tools, features minus runtime-only ones (html/body rules dropped), CSS_EDIT
   last, plus the dark palette scoped to [data-scheme=dark] when opts.darkPreview. */
function buildCSS(doc, opts = {}) {
  doc = ensureDoc(doc);
  const edit = opts.mode === 'edit';
  const use = edit ? null : opts.usage || collectUsage(doc, opts);
  const theme = doc.theme;
  const output = isObj(doc.output) ? doc.output : {};
  const scan = dsScan(doc);
  const faces = new Map();
  const out = [];

  const types = new Set(edit ? Object.keys(BLOCK_TYPES) : dsSet(use.types));
  const feats = edit ? new Set(Object.keys(CSS_FEAT).filter((f) => !DS_EDIT_SKIP_FEAT.includes(f))) : dsSet(use.features);
  const variants = edit ? new Set() : dsSet(use.variants);
  const shared = new Set();
  for (const t of types) for (const c of own(BLOCK_DEPS, t) || []) shared.add(c);
  for (const f of feats) for (const c of own(DS_FEAT_DEPS, f) || []) shared.add(c);
  if (edit) for (const c of Object.keys(CSS_SHARED)) shared.add(c);
  const pos = own({ nav: 1, 'top-right': 1, 'bottom-right': 1, 'bottom-left': 1 }, output.toolbarPos) ? output.toolbarPos : 'nav';
  const tools = edit || !!(use.tools || use.toolbar);
  const floating = !edit && !!use.toolbar && !(use.tools && pos === 'nav');
  const flags = new Set();
  if (tools) flags.add('tools');
  if (!edit && output.backToTop) flags.add('totop');

  // Tones actually used (renderers may also report them via use.tones or a `<type>:tone=<x>` variant).
  const tones = new Set();
  if (edit) for (const t of DS_TONES) tones.add(t);
  else {
    for (const t of scan.tones) tones.add(t);
    for (const t of dsSet(use.tones)) tones.add(t);
    for (const v of variants) { const m = /:tone=([a-z]+)$/.exec(v); if (m) tones.add(m[1]); }
    if (scan.bgMedia) { tones.add('dark'); tones.add('light'); }
  }
  const darkDefault = dsDefaultDark(doc);
  const pals = dsPalettes(doc);
  const P = darkDefault ? pals.D : pals.L;

  // Variables, tones, base.
  const vars = varsCSS(doc, { ...opts, mode: edit ? 'edit' : 'view' }, faces);
  for (const f of faces.values()) out.push(f);
  out.push(vars, tonesCSS(doc, P, edit ? '.lp-root ' : '', tones, false), CSS_BASE);
  if (!edit) out.push(CSS_VIEW);
  out.push(own(DS_HEADS, theme.headings) || '', own(DS_BTNS, theme.buttons) || '');
  if (!edit) {
    if (scan.device) out.push(DS_DEVICE);
    const rv = own(DS_REVEAL, output.motion);
    if (rv) out.push(rv, DS_REVEAL_KEEP);
    if (output.backToTop) {
      // Clear the floating toolbar (bottom-right), a floating cart button (bottom-right, no nav to host it) and a chat bubble.
      const sh = isObj(doc.shop) ? doc.shop : {};
      let b = 16;
      if (floating && pos === 'bottom-right') b += 58;
      if (feats.has('cart') && (sh.cartButton === 'floating' || (sh.cartButton !== 'nav' && !use.tools))) b += 66;
      // A floating chat bubble on the same side (58px button + gap).
      let bubble = false;
      if (feats.has('chat')) walkBlocks(doc, (x) => { if (x.type === 'chat' && !x.hidden && x.display === 'bubble' && x.side !== 'left') bubble = true; });
      if (bubble) b += 80;
      out.push(DS_TOTOP, `.lp-totop{bottom:calc(${b}px + env(safe-area-inset-bottom,0px))}`);
    }
  }

  // Shared chunks, block chunks, variant chunks (registry order keeps the cascade stable).
  for (const k of Object.keys(CSS_SHARED)) if (shared.has(k)) out.push(CSS_SHARED[k]);
  for (const k of Object.keys(CSS_BLOCKS)) if (types.has(k) && CSS_BLOCKS[k]) out.push(CSS_BLOCKS[k]);
  for (const t of Object.keys(CSS_VARIANTS)) {
    if (!types.has(t) || !isObj(CSS_VARIANTS[t])) continue;
    for (const k of Object.keys(CSS_VARIANTS[t])) if ((edit || variants.has(t + ':' + k)) && CSS_VARIANTS[t][k]) out.push(CSS_VARIANTS[t][k]);
  }

  // Theme preset rules (shaken by owner in view mode).
  const th = own(THEMES, theme.preset);
  if (isObj(th) && typeof th.css === 'string' && th.css) out.push(edit ? th.css : shakeRules(th.css, types, shared, feats, variants, flags));

  const langs = edit ? [] : dsSet(use.langs).size ? [...dsSet(use.langs)] : Array.isArray(use.langs) ? use.langs : [];
  if (edit || [...langs, ...(Array.isArray(doc.langs) ? doc.langs : [])].some((l) => primary(l) === 'ka')) out.push(kaNoCapsCSS(edit));

  if (tools) {
    out.push(CSS_TOOLS, dsIcons(P.dark, edit ? '.lp-root ' : ''));
    if (floating) out.push(CSS_TOOLBAR);
  }

  // Runtime feature CSS in FEATURE_ORDER (edit: static look-alikes only, sanitized for the editor document).
  const order = Array.isArray(FEATURE_ORDER) ? FEATURE_ORDER : [];
  for (const f of [...order, ...Object.keys(CSS_FEAT).filter((k) => !order.includes(k))]) {
    const c = feats.has(f) ? own(CSS_FEAT, f) : '';
    if (c) out.push(edit ? dsEditSafe(c) : c);
  }

  if (edit) {
    out.push(CSS_EDIT);
    // Editor dark preview: #ed-canvas carries data-scheme="dark" (whatever doc.theme.scheme is).
    if (opts.darkPreview) out.push(darkBlock(doc, '[data-scheme=dark]', { edit: true, tones, icons: true }));
  } else {
    if (langs.length > 1) out.push(langCSS(langs));
    out.push(darkCSS(doc, { tones, icons: tools }));
    out.push(printCSS(doc));
  }
  return out.filter(Boolean).join('\n').replace(/\n{2,}/g, '\n').trim() + '\n';
}

export {
  BLOCK_DEPS,
  CLASS_OWNER,
  CLASS_OWNER_BASE,
  CSS_BASE,
  CSS_BLOCKS,
  CSS_EDIT,
  CSS_SHARED,
  CSS_TOOLBAR,
  CSS_TOOLS,
  CSS_VARIANTS,
  CSS_VIEW,
  DS_BLACK,
  DS_BTNS,
  DS_COLOR_KEYS,
  DS_DEVICE,
  DS_EDIT_SKIP_FEAT,
  DS_FALLBACK,
  DS_FEAT_DEPS,
  DS_HEADS,
  DS_ICON_IMG,
  DS_INK,
  DS_REVEAL,
  DS_REVEAL_KEEP,
  DS_SPACE,
  DS_TONES,
  DS_TOTOP,
  DS_WHITE,
  FONT_STACKS,
  FS_GEO_SANS,
  FS_GEO_SERIF,
  THEMES_BASE,
  buildCSS,
  darkBlock,
  darkCSS,
  dsA,
  dsCR,
  dsDefaultDark,
  dsDeriveDark,
  dsDeriveLight,
  dsEditSafe,
  dsFinish,
  dsHex,
  dsIcons,
  dsLum,
  dsMix,
  dsOn,
  dsPalCache,
  dsPalDecl,
  dsPalettes,
  dsRGB,
  dsReach,
  dsScan,
  dsSet,
  dsTonePal,
  fontStack,
  kaNoCapsCSS,
  langCSS,
  printCSS,
  shakeRules,
  splitSelectors,
  tonesCSS,
  varsCSS
};
