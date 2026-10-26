// schema/rules.js - rule-based text from field values, written by people in an editor rather than by programmers:
// conditions with six readable operators (is one of / is none of / at least / at most / is set / is not set), templates
// with {key} and {key:scale} substitutions and the segment rule (a segment between '·', ',', '—' or '|' whose
// substitution came out empty is dropped whole, so "{rooms}-room · {area} m²" never prints "2-room · m²"), and ordered
// title rules: the first rule whose conditions hold and whose template renders in the source language wins, then a
// fallback template. No expression engine: no eval, no loops.
//
//   COND_OPS, COND_OP_NAME, COND_BARE        normalizeCond({ v, op, a }) -> cond | null
//   condMatches(cond, values) / condsMatch(conds, values)     ('' among the values of 'is' also means "not set";
//       0 is a value, false and '' are "not set"; '2' equals '2.0'; a list matches by any member)
//   templateVars(tpl)  templateScales(tpl)  renderTemplate(tpl, vars, { scales, raw, lang, fallbacks, max })
//   normalizeRule(raw) / normalizeRules(list) -> [{ when, tpl: { lang: text }, off, note }]
//   ruleMatches(rule, values)
//   buildRuleTitle(rules, values, varsFor(lang), { scales, fallback, srcLang }) -> { i18n, rule } (rule -1: fallback, -2: none)
//   traceRules(rules, values, varsFor, opts) -> per rule: { index, off, conds: [{ …cond, ok }], matched, texts, won }
//   rulesVars(rules) -> variable names used        mainText(i18n, srcLang, fallbacks)

//
// Why no expression language: rules are authored by non-programmers and stored server-side. A closed set of
// operators is total (always terminates, never throws), safe (no eval / injection surface) and explainable
// (traceRules can show per condition why a rule did or did not fire). Anything that needs arithmetic belongs in a
// computed field, not in a title rule.
import { cleanKey, pick } from './text.js';
import { scaleWord } from '../units/scales.js';

export const COND_OPS = ['is', 'not', 'min', 'max', 'has', 'none'];
export const COND_OP_NAME = {
  is: { en: 'is one of', ru: 'равно одному из', ka: 'ერთ-ერთია' },
  not: { en: 'is none of', ru: 'не равно ни одному из', ka: 'არცერთია' },
  min: { en: 'at least', ru: 'не меньше', ka: 'მინიმუმ' },
  max: { en: 'at most', ru: 'не больше', ka: 'მაქსიმუმ' },
  has: { en: 'is set', ru: 'указано', ka: 'მითითებულია' },
  none: { en: 'is not set', ru: 'не указано', ka: 'არ არის მითითებული' },
};
export const COND_BARE = ['has', 'none'];

// Operands are strings (max 30 x 80 chars). Decimal comma is accepted for min/max bounds and stored canonical
// ("2,5" -> "2.5"), so later comparisons are plain numeric.
export function normalizeCond(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = cleanKey(raw.v ?? raw.key);
  if (!v) return null;
  const op = COND_OPS.includes(raw.op) ? raw.op : 'is';
  const list = Array.isArray(raw.a) ? raw.a : raw.a == null ? [] : [raw.a];
  const a = [];
  for (const x of list.slice(0, 30)) { const s = String(x ?? '').trim().slice(0, 80); if (!a.includes(s)) a.push(s); }
  if (COND_BARE.includes(op)) return { v, op, a: [] };
  if (op === 'min' || op === 'max') {
    // exactly one number; a bound that is not a number would make a rule that silently never fires
    const n = a.find((s) => s !== '' && Number.isFinite(+s.replace(',', '.')));
    return n === undefined ? null : { v, op, a: [String(+n.replace(',', '.'))] };
  }
  return a.length ? { v, op, a } : null;
}

// Every value is reduced to a list of non-empty trimmed strings: scalars, multiselect arrays and booleans then share
// one matching path. false counts as "not set" because an unchecked checkbox is the absence of the feature.
function condValues(x) {
  if (Array.isArray(x)) return x.map((v) => String(v ?? '').trim()).filter((v) => v !== '');
  if (x == null || x === false) return [];
  const s = String(x).trim();
  return s === '' ? [] : [s];
}
const isNum = (s) => s !== '' && Number.isFinite(+s);
const same = (x, y) => x === y || (isNum(x) && isNum(y) && +x === +y);

// KNOWN DEFECT: values is a plain object read by key, so a field named 'constructor' (valid per
// cleanKey) resolves to an Object.prototype member when unset. Fix: read with Object.hasOwn(values, c.v).
export function condMatches(c, values) {
  const vals = condValues(values ? values[c.v] : undefined);
  switch (c.op) {
    case 'has': return vals.length > 0;
    case 'none': return vals.length === 0;
    case 'is': case 'not': {
      const hit = vals.length === 0 ? c.a.includes('') : vals.some((v) => c.a.some((a) => a !== '' && same(v, a)));
      return c.op === 'is' ? hit : !hit;
    }
    case 'min': case 'max': {
      const lim = +c.a[0];
      if (!Number.isFinite(lim)) return false;
      return vals.some((v) => isNum(v) && (c.op === 'min' ? +v >= lim : +v <= lim));
    }
  }
  return false;
}
export const condsMatch = (conds, values) => (conds || []).every((c) => condMatches(c, values));

// --- templates ----------------------------------------------------------------------------------------------------

const VAR_RE = /\{([a-z][a-z0-9_]{0,39})(?::([a-z][a-z0-9_]{0,39}))?\}/gi;

export function templateVars(tpl) {
  const out = [];
  for (const m of String(tpl ?? '').matchAll(VAR_RE)) { const k = m[1].toLowerCase(); if (!out.includes(k)) out.push(k); }
  return out;
}
export function templateScales(tpl) {
  const out = [];
  for (const m of String(tpl ?? '').matchAll(VAR_RE)) { const s = String(m[2] || '').toLowerCase(); if (s && !out.includes(s)) out.push(s); }
  return out;
}

// The segment rule is the core idea: a template is split on separators BEFORE substitution, and a segment with any
// empty variable disappears entirely together with its literal words ("{area} m²"). Consequences: separators are
// normalised to ' · ' on output, and a literal comma inside a segment ("3,5") also splits it.
// Same 'constructor' caveat as condMatches applies to vars[k].
export function renderTemplate(tpl, vars, { scales = [], raw = null, lang = 'en', fallbacks = ['en'], max = 200 } = {}) {
  const src = String(tpl ?? '').trim();
  if (!src) return '';
  const val = (k) => {
    const v = vars[k.toLowerCase()];
    if (v == null || v === false) return '';
    if (Array.isArray(v)) return v.map((x) => String(x ?? '').trim()).filter(Boolean).join('–');
    return String(v).trim();
  };
  // a scale reads the raw number, not its label (a select's label is the option name)
  const viaScale = (k, s) => {
    const sc = scales.find((x) => x.key === s.toLowerCase());
    if (!sc) return '';
    const key = k.toLowerCase();
    const r = raw && raw[key] !== undefined ? raw[key] : vars[key];
    return scaleWord(sc, Array.isArray(r) ? r[0] : r, lang);
  };
  const parts = [];
  for (const rawSeg of src.split(/\s*[·|,—]\s*/)) {
    const seg = rawSeg.trim();
    if (!seg) continue;
    let missing = false;
    const done = seg.replace(VAR_RE, (_m, k, s) => { const v = s ? viaScale(k, s) : val(k); if (!v) missing = true; return v; });
    if (missing) continue;
    const clean = done.replace(/\s{2,}/g, ' ').trim();
    if (clean) parts.push(clean);
  }
  return parts.join(' · ').slice(0, max);
}

// --- title rules --------------------------------------------------------------------------------------------------

function cleanTpl(v) {
  const out = {};
  if (typeof v === 'string') { const s = v.trim().slice(0, 200); if (s) out.en = s; return out; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [k, x] of Object.entries(v)) {
    if (!/^[a-z]{2}$/.test(k)) continue;
    const s = String(x ?? '').trim().slice(0, 200);
    if (s) out[k] = s;
  }
  return out;
}

export function normalizeRule(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const tpl = cleanTpl(raw.tpl);
  if (!Object.keys(tpl).length) return null;
  const when = [];
  for (const c of (Array.isArray(raw.when) ? raw.when : []).slice(0, 12)) { const x = normalizeCond(c); if (x) when.push(x); }
  return { when, tpl, off: !!raw.off, note: String(raw.note ?? '').trim().slice(0, 200) };
}

export function normalizeRules(raw) {
  const out = [];
  for (const r of (Array.isArray(raw) ? raw : []).slice(0, 40)) { const x = normalizeRule(r); if (x) out.push(x); }
  return out;
}

export const ruleMatches = (r, values) => !r.off && condsMatch(r.when, values);

function renderRule(r, values, vars, opts) {
  const out = {};
  for (const [lang, tpl] of Object.entries(r.tpl)) {
    const t = renderTemplate(tpl, vars(lang), { scales: opts.scales, raw: values, lang, fallbacks: opts.fallbacks });
    if (t) out[lang] = t;
  }
  return out;
}

// A rule wins only when it rendered in the source language (a Russian listing must not get an English title because
// the Russian template had a missing variable); a rule with no template in that language wins with any language.
const wins = (r, out, src) => (r.tpl[src] !== undefined ? !!out[src] : Object.keys(out).length > 0);

// varsFor(lang) may be expensive (formats every field for a language); a rule set calls it per rule per language.
function cachedVars(varsFor) {
  const cache = new Map();
  return (lang) => { if (!cache.has(lang)) cache.set(lang, varsFor(lang) || {}); return cache.get(lang); };
}

export function buildRuleTitle(rules, values, varsFor, opts = {}) {
  const src = opts.srcLang || 'en';
  const vars = cachedVars(varsFor);
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (!ruleMatches(r, values)) continue;
    const out = renderRule(r, values, vars, opts);
    if (wins(r, out, src)) return { i18n: out, rule: i };
  }
  if (opts.fallback) {
    const t = renderTemplate(opts.fallback, vars(src), { scales: opts.scales, raw: values, lang: src, fallbacks: opts.fallbacks });
    if (t) return { i18n: { [src]: t }, rule: -1 };
  }
  return { i18n: {}, rule: -2 };
}

// Mirrors buildRuleTitle step by step (same ruleMatches / wins logic) but evaluates every rule, for the editor's
// "why this title?" panel. Keep the two in sync: a trace that disagrees with the real winner is worse than none.
export function traceRules(rules, values, varsFor, opts = {}) {
  const src = opts.srcLang || 'en';
  const vars = cachedVars(varsFor);
  let decided = false;
  return rules.map((r, index) => {
    const conds = r.when.map((c) => ({ ...c, ok: condMatches(c, values) }));
    const matched = !r.off && conds.every((c) => c.ok);
    const texts = matched ? renderRule(r, values, vars, opts) : {};
    const won = !decided && matched && wins(r, texts, src);
    if (won) decided = true;
    return { index, off: r.off, note: r.note, conds, matched, texts, won };
  });
}

export const mainText = (i18n, srcLang = 'en', fallbacks = ['en']) => pick(i18n, srcLang, fallbacks);

export function rulesVars(rules) {
  const out = [];
  const add = (k) => { if (k && !out.includes(k)) out.push(k); };
  for (const r of rules) {
    for (const c of r.when) add(c.v);
    for (const t of Object.values(r.tpl)) for (const k of templateVars(t)) add(k);
  }
  return out;
}
