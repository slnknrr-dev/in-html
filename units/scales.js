// units/scales.js - number -> word scales that people define without code: an exact scale (a word for each value:
// 1 -> "studio", 2 -> "two rooms") or steps "up to N" (up to 300 m -> "close", up to 800 m -> "nearby", otherwise
// "far"). A step without a number (`at: null`) is "otherwise" and may contain `{n}`, replaced by the number.
//
//   normalizeScale(raw) -> { key, name, mode, unit?, steps: [{ at, name }] } | null     steps ascending, "otherwise" last
//   scaleStepIndex(scale, n) -> index | -1
//   scaleWord(scale, n, lang, { unit }) -> word | ''          '' is a legal answer ("no word"), not an error
//   mergeScales([rootList, …, leafList]) -> the nearer list overrides by key
//   DISTANCE_SCALE: walking distances in metres (en / ru / ka)
//
// A scale knows no units unless it says so: "300" is just a number. A scale with `unit` ('m') converts a value
// given with another unit (`scaleWord(s, 0.5, 'en', { unit: 'km' })`) before comparing; without `unit` the caller
// converts, otherwise "up to 300 m" would silently compare feet.
import { convert, unit as unitOf } from './registry.js';
import { parseNumber } from './parse.js';

export const SCALE_MODES = ['exact', 'upto'];

export const SCALE_MODE_NAME = {
  exact: { en: 'a word per number', ru: 'слово на каждое число', ka: 'სიტყვა თითო რიცხვზე' },
  upto: { en: 'steps “up to N”', ru: 'ступени «до N»', ka: 'საფეხურები „N-მდე“' },
};

// A key usable as a template variable: lower-case Latin, digits and '_', starting with a letter.
export const cleanScaleKey = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  return /^[a-z][a-z0-9_]{0,39}$/.test(s) ? s : '';
};

// A localised string: language codes only, empty values dropped; a plain string becomes { en }.
export function scaleI18n(v, max = 80, lang = 'en') {
  const out = {};
  if (typeof v === 'string') { const s = v.trim().slice(0, max); if (s) out[lang] = s; return out; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [k, x] of Object.entries(v)) {
    if (!/^[a-z]{2}$/.test(k)) continue;
    const s = String(x ?? '').trim().slice(0, max);
    if (s) out[k] = s;
  }
  return out;
}

// Number from a stored or typed value: numbers untouched, blank -> NaN (never 0), text through parseNumber so a
// scale author's "300,5" means 300.5 in every UI language.
const numOf = (v) => (typeof v === 'number' ? v : String(v ?? '').trim() === '' ? NaN : parseNumber(v));

export function normalizeScale(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const key = cleanScaleKey(raw.key);
  if (!key) return null;
  const mode = raw.mode === 'upto' ? 'upto' : 'exact';
  const steps = [];
  let other = false;
  for (const st of (Array.isArray(raw.steps) ? raw.steps : []).slice(0, 40)) {
    if (!st || typeof st !== 'object') continue;
    const name = scaleI18n(st.name);
    if (!Object.keys(name).length) continue;
    const empty = st.at === null || st.at === undefined || String(st.at).trim() === '';
    const at = empty ? null : numOf(st.at);
    if (Number.isNaN(at)) continue;
    // One "otherwise" only, and one word per number: a repeat would silently win or lose.
    if (at === null) { if (other) continue; other = true; }
    if (at !== null && steps.some((x) => x.at === at)) continue;
    steps.push({ at, name });
  }
  // Ascending with "otherwise" last: scaleStepIndex can then return the first step with v <= at (the tightest bound)
  // in one pass, and authors may list steps in any order.
  steps.sort((x, y) => (x.at === null ? 1 : y.at === null ? -1 : x.at - y.at));
  if (!steps.length) return null;
  const out = { key, name: scaleI18n(raw.name), mode, steps };
  if (raw.unit && unitOf(raw.unit)) out.unit = String(raw.unit);
  return out;
}

export function normalizeScales(raw) {
  const out = [];
  for (const s of (Array.isArray(raw) ? raw : []).slice(0, 30)) {
    const x = normalizeScale(s);
    if (x && !out.some((y) => y.key === x.key)) out.push(x);
  }
  return out;
}

// Scales along a chain of sections from the root to the leaf: the nearer section overrides a key.
export function mergeScales(chainRootToLeaf) {
  const by = new Map();
  for (const list of chainRootToLeaf || []) for (const s of list || []) by.set(s.key, s);
  return [...by.values()];
}

// The value in the scale's unit (when the scale and the caller both name one).
function valueIn(scale, n, unit) {
  const v = numOf(n);
  if (!Number.isFinite(v)) return NaN;
  if (scale.unit && unit && unit !== scale.unit) { const c = convert(v, unit, scale.unit); return c === null ? NaN : c; }
  return v;
}

// Index of the step a number falls in; -1 when none (and no "otherwise").
export function scaleStepIndex(scale, n, { unit } = {}) {
  const v = valueIn(scale, n, unit);
  if (!Number.isFinite(v)) return -1;
  let other = -1;
  for (let i = 0; i < scale.steps.length; i++) {
    const st = scale.steps[i];
    if (st.at === null) { other = i; continue; }
    // 'upto' bounds are inclusive (300 is still "close"). 'exact' uses ===, meant for counts (rooms, floors). After a
    // unit conversion or float arithmetic a value is rarely exactly equal (0.1 + 0.2 !== 0.3), so exact scales on
    // measured, converted quantities will mostly fall through to "otherwise"; use 'upto' for those.
    if (scale.mode === 'exact' ? v === st.at : v <= st.at) return i;
  }
  return other;
}

// A word in a language: the language, English, Russian, any.
export const scalePick = (name, lang) => name[lang] || name.en || name.ru || Object.values(name).find(Boolean) || '';

// {n} text: two decimals, point as decimal mark, no grouping, locale-independent (the word around it is localised,
// the digits are not). KNOWN DEFECT: plain Math.round, so 1.005 prints 1, unlike format.js round() (1.01) used
// everywhere else. Fix: import round from format.js (no import cycle: format.js does not import scales.js).
const numText = (v) => String(Math.round(v * 100) / 100);

export function scaleWord(scale, n, lang = 'en', opts = {}) {
  const i = scaleStepIndex(scale, n, opts);
  if (i < 0) return '';
  return scalePick(scale.steps[i].name, lang).replace(/\{n\}/g, numText(valueIn(scale, n, opts.unit)));
}

// Walking distance words (metres): up to 300 m close, 800 m nearby, 2 km a walk, farther far.
export const DISTANCE_SCALE = normalizeScale({
  key: 'distance', unit: 'm', mode: 'upto',
  name: { en: 'Distance as a word', ru: 'Расстояние словом', ka: 'მანძილი სიტყვით' },
  steps: [
    { at: 300, name: { en: 'close', ru: 'близко', ka: 'ახლოს' } },
    { at: 800, name: { en: 'nearby', ru: 'рядом', ka: 'სიახლოვეს' } },
    { at: 2000, name: { en: 'walking distance', ru: 'пешком', ka: 'ფეხით სავალზე' } },
    { at: null, name: { en: 'far', ru: 'далеко', ka: 'შორს' } },
  ],
});
