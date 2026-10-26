// estate/scales.js - number -> word scales a seller defines without code. Two kinds: `exact` (a word per value:
// 2 -> 'Euro 1+1', the Euro layout words) and `upto` (a word per range: up to 300 -> 'close', up to 800 -> 'near',
// otherwise 'far' - distance tags searchable by step). A step without a number (`at: null`) is the one "otherwise";
// its word may contain `{n}`, replaced by the number itself. A scale knows no units: the caller converts first.
//
//   SCALE_MODES, cleanScaleKey(v), scaleI18n(v)
//   normalizeScale(raw) -> scale | null        steps ascending, "otherwise" last and single, duplicates dropped
//   normalizeScales(raw) -> scales             unique keys
//   mergeScales([rootScales, ..., leafScales]) the nearer level overrides by key
//   scaleStepIndex(scale, n) -> index | -1
//   scalePick(name, lang) -> word              lang -> en -> ru -> first
//   scaleWord(scale, n, lang) -> word | ''
//   EURO_SCALE                                 Euro layout words by size (= bedrooms + 1, rooms.js roomsLayout)

// Why steps instead of formulas: sellers think in buckets ("walking distance", "near"), and buckets make search tokens
// finite (schema/tags.js tagIndexTokens indexes the step number, not the raw distance).
export const SCALE_MODES = ['exact', 'upto'];

export const cleanScaleKey = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  return /^[a-z][a-z0-9_]{0,39}$/.test(s) ? s : '';
};

// Words by language code; a plain string is Russian when it has Cyrillic, else English.
export function scaleI18n(v, max = 80) {
  const out = {};
  if (typeof v === 'string') { const s = v.trim().slice(0, max); if (s) out[/[а-яё]/i.test(s) ? 'ru' : 'en'] = s; return out; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [k, x] of Object.entries(v)) {
    if (!/^[a-z]{2}$/.test(k)) continue;
    const s = String(x ?? '').trim().slice(0, max);
    if (s) out[k] = s;
  }
  return out;
}

// Bad steps are skipped individually (no name, non-numeric at, duplicate at, second "otherwise"): one typo should
// not discard the seller's whole scale. Sorting makes 'upto' lookup a first-match scan.
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
    const a = String(st.at ?? '').trim().replace(',', '.');
    const at = a === '' ? null : Number.isFinite(+a) ? +a : NaN;
    if (Number.isNaN(at)) continue;
    if (at === null) { if (other) continue; other = true; }
    if (at !== null && steps.some((x) => x.at === at)) continue;
    steps.push({ at, name });
  }
  steps.sort((x, y) => (x.at === null ? 1 : y.at === null ? -1 : x.at - y.at));
  if (!steps.length) return null;
  return { key, name: scaleI18n(raw.name), mode, steps };
}

export function normalizeScales(raw) {
  const out = [];
  for (const s of (Array.isArray(raw) ? raw : []).slice(0, 30)) {
    const x = normalizeScale(s);
    if (x && !out.some((y) => y.key === x.key)) out.push(x);
  }
  return out;
}

export function mergeScales(chainRootToLeaf) {
  const by = new Map();
  for (const list of chainRootToLeaf || []) for (const s of list || []) by.set(s.key, s);
  return [...by.values()];
}

// Linear scan: at most 40 steps. 'exact' uses strict ===, so 2.0 matches 2 but 2.0000001 does not; inputs are
// counts (rooms), not measurements. 'upto' boundaries are inclusive (300 is still "close").
export function scaleStepIndex(scale, n) {
  const v = typeof n === 'number' ? n : +String(n ?? '').trim().replace(',', '.');
  if (String(n ?? '').trim() === '' || !Number.isFinite(v)) return -1;
  let other = -1;
  for (let i = 0; i < scale.steps.length; i++) {
    const st = scale.steps[i];
    if (st.at === null) { other = i; continue; }
    if (scale.mode === 'exact' ? v === st.at : v <= st.at) return i;
  }
  return other;
}

export const scalePick = (name, lang = 'en') => name[lang] || name.en || name.ru || Object.values(name).find(Boolean) || '';

const numText = (v) => String(Math.round(v * 100) / 100);

// '' means "no word" - a fair answer: a title template then drops the segment.
export function scaleWord(scale, n, lang = 'en') {
  const i = scaleStepIndex(scale, n);
  if (i < 0) return '';
  const v = typeof n === 'number' ? n : +String(n).trim().replace(',', '.');
  return scalePick(scale.steps[i].name, lang).replace(/\{n\}/g, numText(v));
}

// Euro layout words by size (bedrooms + 1): the Russian words of the old site and their English n+1 counterparts.
export const EURO_SCALE = {
  key: 'euro',
  name: { en: 'Euro layout as a word', ru: 'Евро-планировка словом', ka: 'ევრო-გეგმარება სიტყვით' },
  mode: 'exact',
  steps: [
    { at: 1, name: { en: 'Euro studio', ru: 'Евроодношка' } },
    { at: 2, name: { en: 'Euro 1+1', ru: 'Евродвушка' } },
    { at: 3, name: { en: 'Euro 2+1', ru: 'Евротрёшка' } },
    { at: 4, name: { en: 'Euro 3+1', ru: 'Еврочетырёшка' } },
    { at: 5, name: { en: 'Euro 4+1', ru: 'Европятишка' } },
    { at: 6, name: { en: 'Euro 5+1', ru: 'Еврошестишка' } },
    { at: null, name: { en: 'Euro {n}-room', ru: 'Евро{n}-комн.' } },
  ],
};
