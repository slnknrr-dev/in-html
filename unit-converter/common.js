// unit-converter/common.js - shared parts of the converter and tables pages: the shell (pages resolved from the
// hidden anchors of the page HTML, so the build can rewrite them), app icons, unit labels and names in the UI
// language, the rounding rule of the converter, formulas, compound forms, a unit picker grouped by kind and the
// conversion table element used by both pages.
//
// Design rules of this module (apply to every function below):
// - Pure view helpers: return DOM / strings, never touch global state except reading UI_STATE.lang. Pages own state.
// - Language read at call time (uiLang()), never cached at import: a language switch re-renders, stale caches would not.
// - Fail soft on bad numbers: non-finite input returns '' / empty table, never throws. UI must survive any keystroke;
//   validation is the parser's job (units/parse.js), not the formatter's.
//
// Side-effect import first: strings.js registers this app's i18n keys before any t() call below can run.
import './strings.js';
import { startApp, t } from '../ui/app.js';
import { h } from '../ui/dom.js';
import { addIcons } from '../ui/icons.js';
import { UI_STATE } from '../ui/i18n.js';
import { KINDS, UNITS, conversionOf, convert, unit as unitOf, unitLabel, unitName } from '../units/registry.js';
import { formatCompound, formatNumber, roundSignificant } from '../units/format.js';
import { extraUnitName } from './names.js';

// SVG path data (24×24 viewBox, stroke icons). Strings, not files: zero requests, inlined by the bundler.
export const LOGO = 'M3 17 17 3l4 4L7 21zM7 13l1.5 1.5M10 10l2 2M13 7l1.5 1.5M4 4h5M4 4v5M20 20h-5M20 20v-5';

addIcons({
  ruler: LOGO,
  swap: 'M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  scale: 'M12 3v18M5 21h14M6 7h12M6 7l-3 7a3 3 0 0 0 6 0zM18 7l-3 7a3 3 0 0 0 6 0z',
  home: 'M3 11 12 3l9 8M5 9v12h14V9M10 21v-6h4v6',
  tag: 'M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8zM7 7h.01',
  words: 'M4 6h16M4 12h10M4 18h6M17 15l3 3-3 3',
});

// Resolved hrefs of the pages (hidden anchors in the page HTML; the build rewrites their href).
// getAttribute, not a.href: .href returns an absolute URL (file:///…), breaking relative links after publishing.
// '#' fallback: a missing anchor degrades to a dead link instead of a crash on startup.
export function pageHref(id) {
  const a = document.getElementById(id);
  return a ? a.getAttribute('href') : '#';
}

// One shell config for both pages → identical header/nav. `current` marks the active tab (aria-current in ui/app.js).
// offline:true — shell shows the "works offline" badge (a claim the build audits: policy.js fails on any network API).
export function startShell(current, onLang) {
  startApp({
    key: 'uc', name: 'uc.name', logo: LOGO, offline: true, onLang,
    pages: [
      { href: pageHref('pg-convert'), label: 'uc.page.convert', current: current === 'convert' },
      { href: pageHref('pg-tables'), label: 'uc.page.tables', current: current === 'tables' },
    ],
  });
}

// --- language ------------------------------------------------------------------------------------------------------

export const uiLang = () => UI_STATE.lang || 'en';
// Arrow functions, not constants: re-evaluated per call so a language switch takes effect without reload.
// units/registry.js labels exist in en / ru / ka; the other UI languages use the international (English) symbols.
export const unitLang = () => (['en', 'ru', 'ka'].includes(uiLang()) ? uiLang() : 'en');
export const lab = (code) => unitLabel(code, unitLang());
// Fallback chain: app-specific name (names.js) → registry name in a supported language → English. Never empty.
export function uname(code) {
  const l = uiLang();
  return extraUnitName(code, l) || unitName(code, ['en', 'ru', 'ka'].includes(l) ? l : 'en');
}
export const kindName = (kind) => t('uc.kind.' + kind);

// --- numbers -------------------------------------------------------------------------------------------------------

// Superscript map for "× 10⁻⁶". Unicode superscripts, not <sup>: result stays a plain string (copyable, usable in
// <option>, title, clipboard) — markup would lock it to innerHTML contexts.
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

/**
 * The converter's rounding rule. 'auto': two decimals from 1 up, four significant digits below 1 (0.3048, 0.01049),
 * scientific form outside 1e-6 … 1e15. A number: that many decimals.
 * Why significant digits below 1: fixed 2 decimals would print 0.0003048 as "0.00" — information loss.
 * Why scientific beyond 1e15: doubles lose integer precision past 2^53 ≈ 9e15; grouped digits would look exact but lie.
 * Order of checks matters: non-finite → '' first, so toExponential never sees NaN/Infinity.
 */
export function fmt(v, prec = 'auto', { grouping = true } = {}) {
  if (!Number.isFinite(v)) return '';
  const lang = uiLang();
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-6 || a >= 1e15)) {
    const [m, e] = v.toExponential(prec === 'auto' ? 3 : Math.max(0, +prec)).split('e');
    return formatNumber(+m, { lang, digits: 6 }) + ' × 10' + String(+e).replace(/./g, (c) => SUP[c] || c);
  }
  if (prec !== 'auto') return formatNumber(v, { lang, digits: +prec, grouping });
  if (a >= 1 || a === 0) return formatNumber(v, { lang, digits: 2, grouping });
  return formatNumber(roundSignificant(v, 4), { lang, digits: 12, grouping });
}

// Round-trip contract: fmt() is for eyes, plainNumber() is for the input field. Mixing them breaks re-parsing
// (grouping spaces / "× 10⁶" are not parseable). 10 significant digits: hides float noise (0.1+0.2), keeps precision.
// A number that parseQuantity reads back exactly (no grouping, the UI language's decimal mark, 10 significant digits).
export function plainNumber(v) {
  const s = String(roundSignificant(v, 10));
  return /e/i.test(s) || uiLang() === 'en' ? s : s.replace('.', ',');
}

export const qty = (v, code, prec) => `${fmt(v, prec)} ${lab(code)}`;

// Two shapes: pure factor (most units) vs affine factor+offset (temperature). Affine cannot be "1 X = n Y" —
// 0 °C ≠ 0 °F — so it is printed as an equation. '−' (U+2212) not '-': typographic minus, same width as '+'.
// "1 m² = 10.76391042 sq ft" or "°F = °C × 1.8 + 32" with the numbers of the UI language.
export function formula(from, to) {
  const k = conversionOf(from, to);
  if (!k) return '';
  const num = (v) => formatNumber(v, { lang: uiLang(), significant: 10, grouping: false });
  if (!k.offset) return `1 ${lab(from)} = ${num(k.factor)} ${lab(to)}`;
  return `${lab(to)} = ${lab(from)} × ${num(k.factor)} ${k.offset < 0 ? '−' : '+'} ${num(Math.abs(k.offset))}`;
}

// Table of decompositions, largest part first. Only where people really think in mixed units; a generic algorithm
// would produce nonsense like "1 km 3 m 40 cm".
// Compound forms worth showing next to a unit: 5.9 ft -> 5 ft 11 in, 1.5 h -> 1 h 30 min.
export const COMPOUND = { ft: ['ft', 'in'], yd: ['yd', 'ft', 'in'], mi: ['mi', 'ft'], lb: ['lb', 'oz'], st: ['st', 'lb'], h: ['h', 'min'], min: ['min', 's'], d: ['d', 'h', 'min'], wk: ['wk', 'd', 'h'], m: ['m', 'cm'], kg: ['kg', 'g'] };
export function compound(v, code) {
  const parts = COMPOUND[code];
  if (!parts || !Number.isFinite(v)) return '';
  const s = formatCompound(v, code, parts, { lang: unitLang(), digits: 0 });
  // A single part says nothing new ("6 ft").
  return s && s.trim().split(/\s+/).length > 2 ? s : '';
}

// --- unit picker ---------------------------------------------------------------------------------------------------

// Linear scan over UNITS: ~hundreds of entries, called on render only — an index would be premature.
export function unitOptions(kind) {
  return Object.keys(UNITS).filter((c) => UNITS[c].kind === kind);
}

/** <select> of every unit grouped by kind (or of one kind); onChange(code). */
export function unitSelect(value, onChange, { kind, aria } = {}) {
  const s = h('select', { class: 'ed-input ed-select uc-unit-sel', 'aria-label': aria || null });
  const kinds = kind ? [kind] : KINDS;
  for (const k of kinds) {
    const opts = unitOptions(k).map((c) => h('option', { value: c, selected: c === value }, `${lab(c)} — ${uname(c)}`));
    s.append(...(kind ? opts : [h('optgroup', { label: kindName(k) }, opts)]));
  }
  // Set after options exist: assigning .value before append is a no-op (no matching option yet). `selected` above
  // covers initial paint; this line covers unknown/duplicate edge cases deterministically.
  s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

// --- tables --------------------------------------------------------------------------------------------------------

// A round step near `x`: 1, 2, 2.5, 5 × 10^n. Rounds UP (m ≤ …): a step never smaller than requested, so a table
// never exceeds its intended row count. Guard returns 1 for 0/negative/NaN instead of log10 → -Infinity.
export function niceStep(x) {
  if (!(x > 0) || !Number.isFinite(x)) return 1;
  const p = 10 ** Math.floor(Math.log10(x));
  const m = x / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

// Values start, start + step, … up to end (inclusive), at most `max`; floating noise removed.
// start + i*step, not accumulation (v += step): accumulation compounds rounding error each iteration.
// toPrecision(12) strips 0.30000000000000004-style noise. Tolerance 1e-9·step on the end check: without it, an end
// value that lands at 9.999999999 instead of 10 would be dropped. `max` — hard cap against step≈0 / huge ranges.
export function series(start, end, step, max = 200) {
  const out = [];
  if (![start, end, step].every(Number.isFinite) || step === 0) return out;
  const s = end >= start ? Math.abs(step) : -Math.abs(step);
  for (let i = 0; i < max; i++) {
    const v = +(start + i * s).toPrecision(12);
    if (s > 0 ? v > end + Math.abs(s) * 1e-9 : v < end - Math.abs(s) * 1e-9) break;
    out.push(v);
  }
  return out;
}

/**
 * Two-column conversion table: tableEl('m2', 'sqft', [10, 20], { digits, compound, mark }). Headers carry the unit
 * labels, cells only numbers (easier to read on a printed sheet); `mark` highlights one source value.
 */
export function tableEl(from, to, values, { digits = 2, useCompound = false, mark, caption } = {}) {
  const head = h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, lab(from)), h('th', { scope: 'col' }, lab(to))));
  const body = h('tbody', {});
  for (const v of values) {
    const r = convert(v, from, to);
    if (r === null) continue;
    const c = useCompound ? compound(r, to) : '';
    body.append(h('tr', { class: mark != null && Math.abs(v - mark) < 1e-12 ? 'uc-cur' : null, dataset: { v: String(v) } },
      // 1e-12 tolerance: exact === on floats fails for values produced by series().
      h('td', {}, fmt(v, digits)), h('td', {}, c || fmt(r, digits))));
  }
  return h('table', { class: 'uc-table' }, caption ? h('caption', {}, caption) : null, head, body);
}

// Kind of a unit code ('' when unknown). Optional chaining: unknown codes from old localStorage must not throw.
export const kindOfUnit = (code) => unitOf(code)?.kind || '';
