// contract/fields.js - the fields of a template: values of each type, the places a template text reads them from,
// and the "extraction" of fields from the text: a placeholder written into a clause that names no field yet becomes a
// new field whose type is guessed from its name.
//
//   coerceValue(field, v) -> the value in the shape of the field type      isEmptyValue(field, v)
//   defaultValue(field, today?)       fieldById(tpl)  -> Map id -> field
//   resolvePath(tpl | byId, path) -> { field, sub: 'name' | '', id } | null   (longest field id that prefixes the path)
//   collectRefs(tpl) -> Map path -> [{ section, clause, where }]   every path read by texts, titles, conditions, variants,
//                                                                   computed expressions and schedule settings
//   syncFields(tpl, { lang }) -> { template, added: [ids], unknown: [paths], unused: [ids] }
//   inferField(path, lang) -> Field (type guessed from the name, label from the path)
//   partsOf(field, kind) -> party parts shown for a person / an organisation      labelOf(field, lang, main)
import { isoDate } from './dates.js';
import { parseExpr, refsOf } from './expr.js';
import { DOCREF_PARTS, PARTY_PARTS, isFieldId } from './model.js';
import { parseText, textRefs } from './syntax.js';
import { isObj } from '../util/value.js';

// Coercion is the single gate between stored document JSON (hand-edited, imported, from an older template version)
// and the renderer: every value leaves coerceValue in the exact shape of its field type, so render/validate code never
// type-checks. Rule: never throw, never keep a value of the wrong type; degrade to the type's empty value.
// S: only scalars become text; objects/arrays become '' (no "[object Object]" in a contract).
// N: accepts human input "50 000,5" (comma decimal, space or NBSP grouping). KNOWN LIMIT: only the FIRST comma is
// replaced, so "1,000,000" (English grouping) is rejected as null, and "1.000,5" (German) parses wrongly via
// +"1.000.5" -> NaN -> null. Both fail safe (null), not to a wrong number.
const S = (v) => (v == null ? '' : typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');
const N = (v) => (v === '' || v == null ? null : Number.isFinite(+String(v).replace(',', '.').replace(/[\s ]/g, '')) ? +String(v).replace(',', '.').replace(/[\s ]/g, '') : null);

export function coerceValue(f, v) {
  switch (f.type) {
    case 'text': case 'longtext': return S(v);
    case 'number': case 'money': return N(v);
    case 'date': return isoDate(S(v)) || '';
    case 'bool': return v === true || v === 'true' || v === 1;
    case 'select': return (f.options || []).some((o) => o.v === v) ? v : '';
    case 'period': {
      const o = isObj(v) ? v : {};
      const months = N(o.months);
      return { start: isoDate(S(o.start)), months: months != null && months > 0 ? Math.trunc(months) : null, end: isoDate(S(o.end)) };
    }
    case 'party': {
      const o = isObj(v) ? v : {};
      const kind = f.kinds && f.kinds.includes(o.kind) ? o.kind : (f.kinds && f.kinds[0]) || 'person';
      const out = { kind };
      for (const p of PARTY_PARTS[kind]) out[p] = p.endsWith('Date') ? isoDate(S(o[p])) : S(o[p]);
      if (out.gender && out.gender !== 'm' && out.gender !== 'f') out.gender = '';
      return out;
    }
    case 'docref': {
      const o = isObj(v) ? v : {};
      const out = {};
      for (const p of DOCREF_PARTS) out[p] = p === 'date' || p === 'until' ? isoDate(S(o[p])) : S(o[p]);
      if (!(f.kinds || []).some((k) => k.v === out.kind)) out.kind = (f.kinds && f.kinds[0] && f.kinds[0].v) || '';
      return out;
    }
      // 500-row cap: bounds render and validation cost of a pasted or hostile document. Each row is rebuilt from the
      // field's item definitions, so unknown keys in stored rows are dropped.
    case 'list': {
      const rows = Array.isArray(v) ? v.slice(0, 500) : [];
      return rows.filter(isObj).map((r) => {
        const o = {};
        for (const it of f.items || []) o[it.id] = coerceValue({ ...it, options: it.options }, r[it.id]);
        return o;
      });
    }
      // Per-document schedule settings, each bounded: anchor day 1..31 (month-end clamping is period.js's job),
      // payment offset -60..60 days; absent or invalid falls back to the template's field settings.
    case 'schedule': {
      const o = isObj(v) ? v : {};
      const anchor = N(o.anchorDay);
      return {
        prorata: typeof o.prorata === 'boolean' ? o.prorata : f.prorata,
        anchorDay: anchor != null && anchor >= 1 && anchor <= 31 ? Math.trunc(anchor) : f.anchorDay ?? null,
        dueOffset: N(o.dueOffset) != null ? Math.max(-60, Math.min(60, Math.trunc(N(o.dueOffset)))) : f.dueOffset || 0,
      };
    }
    default: return v ?? null;
  }
}

export function defaultValue(f, today = '') {
  if (f.type === 'date') return f.default === 'today' ? today : f.default || '';
  if (f.type === 'list') return [];
  if (f.type === 'party' || f.type === 'docref' || f.type === 'schedule') return coerceValue(f, {});
  if (f.type === 'period') return coerceValue(f, f.default || {});
  return coerceValue(f, f.default);
}

// "Empty" per type, used by the required-field check and by placeholder chips. bool is never empty (false is an
// answer); a party is empty without a name; a period needs a start plus either months or an end.
export function isEmptyValue(f, v) {
  if (v == null || v === '') return true;
  if (f.type === 'bool') return false;
  if (f.type === 'list') return !Array.isArray(v) || !v.length;
  if (f.type === 'party') return !v.name;
  if (f.type === 'docref') return !v.number && !v.date && !v.issuer;
  if (f.type === 'period') return !v.start || (!v.months && !v.end);
  return false;
}

export const fieldById = (tpl) => new Map((tpl.fields || []).map((f) => [f.id, f]));

// Longest-prefix match: field ids may contain dots ('tenant.name'), and a path may also descend into a composite
// value ('term.end'). Trying the longest prefix first makes a dotted field id win over a same-named sub-value.
// O(k) Map lookups for k path segments; paths are short.
export function resolvePath(src, path) {
  const byId = src instanceof Map ? src : fieldById(src);
  const parts = String(path).split('.');
  for (let n = parts.length; n > 0; n--) {
    const id = parts.slice(0, n).join('.');
    const f = byId.get(id);
    if (f) return { field: f, id, sub: parts.slice(n).join('.') };
  }
  return null;
}

const exprRefs = (src) => { const p = parseExpr(src); return p.ast ? refsOf(p.ast) : new Set(); };

export function collectRefs(tpl) {
  const out = new Map();
  const add = (paths, where) => { for (const p of paths) { if (!out.has(p)) out.set(p, []); out.get(p).push(where); } };
  const texts = (o) => Object.values(o || {});
  for (const t of texts(tpl.title)) add(textRefs(parseText(t).nodes), { where: 'title' });
  for (const s of tpl.sections || []) {
    if (s.when) add(exprRefs(s.when), { section: s.id, where: 'when' });
    for (const t of texts(s.title)) add(textRefs(parseText(t).nodes), { section: s.id, where: 'title' });
    for (const c of s.clauses) {
      if (c.when) add(exprRefs(c.when), { section: s.id, clause: c.id, where: 'when' });
      for (const t of texts(c.title)) add(textRefs(parseText(t).nodes), { section: s.id, clause: c.id, where: 'title' });
      for (const t of texts(c.text)) add(textRefs(parseText(t).nodes), { section: s.id, clause: c.id, where: 'text' });
      if (c.by) {
        add([c.by], { section: s.id, clause: c.id, where: 'by' });
        for (const v of Object.values(c.variants || {})) for (const t of texts(v)) add(textRefs(parseText(t).nodes), { section: s.id, clause: c.id, where: 'variant' });
      }
    }
  }
  for (const f of tpl.fields || []) {
    if (f.type === 'computed') add(exprRefs(f.expr), { field: f.id, where: 'expr' });
    if (f.when) add(exprRefs(f.when), { field: f.id, where: 'when' });
    if (f.type === 'schedule') { add([f.term], { field: f.id, where: 'term' }); add(exprRefs(f.amount), { field: f.id, where: 'amount' }); }
  }
  return out;
}

// Name-based guesses (English and Russian stems): the type and the mask of a new field.
// Ordered: first match wins, so specific rules must precede general ones (bool before date: "isStarted" contains
// "start"; date before number: "days" in "daysOff" vs "deadline"). The patterns test only the LAST path segment.
// Russian entries are stems ("сумм", "плат") to match all case endings without a morphology library.
// KNOWN LIMIT: /tel/ also matches "hotel", /rent/ matches "parent"; a wrong guess only sets an initial type the
// author can change, so precision was traded for recall.
const GUESS = [
  [/(^|\.)(is|has|allow|can|with)[A-Z_]|(^|\.)(pets|smoking|furnished|parking)$/i, { type: 'bool' }],
  [/date|_at$|At$|start|since|until|deadline|дата|день/i, { type: 'date' }],
  [/price|rent|amount|sum|fee|deposit|cost|total|salary|penalty|fine|payment|цена|сумм|плат|стоим|залог|штраф/i, { type: 'money' }],
  [/count|qty|quantity|number_of|days|months|percent|rate|area|floor|rooms|количество|срок|площад|этаж/i, { type: 'number' }],
  [/passport|паспорт/i, { type: 'text', mask: 'passport-ru' }],
  [/(^|\.)inn$|tin$|инн/i, { type: 'text', mask: 'inn' }],
  [/phone|tel|телефон/i, { type: 'text', mask: 'phone' }],
  [/e?mail|почт/i, { type: 'text', mask: 'email' }],
  [/address|notes|description|comment|terms|адрес|описан|примеч/i, { type: 'longtext' }],
];

// Label from the identifier: dots/underscores to spaces, camelCase split, sentence case. The group is the first
// segment sanitized to a valid group id, so extracted 'tenant.phone' lands next to 'tenant.name' in the form.
export function inferField(path, lang = 'en') {
  const last = String(path).split('.').pop();
  let def = { type: 'text' };
  for (const [re, d] of GUESS) if (re.test(last)) { def = d; break; }
  const words = String(path).replace(/[._]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim().toLowerCase();
  const label = words.charAt(0).toUpperCase() + words.slice(1);
  const f = { id: path, type: def.type, label: { [lang]: label }, help: {}, group: path.includes('.') ? path.split('.')[0].replace(/[^A-Za-z0-9_]/g, '') : '', required: false };
  if (def.mask) f.mask = def.mask;
  if (def.type === 'money') f.currency = 'RUB';
  return f;
}

// Paths that are not fields: modifiers, levels, schedule sub-values of known fields are fine; a path whose head is
// unknown names a new field. Function-like names inside each-loops are filtered by textRefs already.
export function syncFields(tpl, o = {}) {
  const refs = collectRefs(tpl);
  const byId = fieldById(tpl);
  const names = new Set([...tpl.modifiers.map((m) => m.id), ...tpl.levels.map((l) => l.id)]);
  const unknown = [];
  for (const p of refs.keys()) {
    if (names.has(p.split('.')[0])) continue;
    if (resolvePath(byId, p)) continue;
    // A path under a field group that is not a field itself ("tenant" when only "tenant.name" exists) is a namespace.
    if ([...byId.keys()].some((id) => id.startsWith(p + '.'))) continue;
    if (isFieldId(p)) unknown.push(p);
  }
  const added = [];
  let template = tpl;
  if (o.add !== false && unknown.length) {
    template = { ...tpl, fields: [...tpl.fields] };
    for (const p of unknown) {
      // Add the shortest new path once ("services.0.price" -> "services" would be wrong: keep exact paths).
      if (template.fields.some((f) => f.id === p)) continue;
      template.fields.push(inferField(p, o.lang || tpl.main));
      added.push(p);
    }
  }
  // Fields read anywhere (texts, conditions, other fields: computed values, schedules) count as used.
  const usedIds = new Set();
  const byId2 = fieldById(template);
  for (const p of refs.keys()) { const r = resolvePath(byId2, p); if (r) usedIds.add(r.id); }
  const unused = template.fields.filter((f) => !usedIds.has(f.id)).map((f) => f.id);
  return { template, added, unknown, unused };
}

// Filters the canonical part list (keeping its order), not the template's list: a template cannot reorder parts or
// inject unknown ones. 'name' is always shown: a party without a name is not a party.
export function partsOf(f, kind) {
  const all = PARTY_PARTS[kind] || PARTY_PARTS.person;
  const pick = f.parts && Array.isArray(f.parts[kind]) && f.parts[kind].length ? f.parts[kind] : all;
  return all.filter((p) => pick.includes(p) || p === 'name');
}

// Label fallback: exact language -> primary subtag -> main language -> any non-empty -> the id (never blank).
export function labelOf(f, lang, main) {
  const l = f.label || {};
  return l[lang] || l[String(lang).split('-')[0]] || l[main] || Object.values(l).find(Boolean) || f.id;
}
