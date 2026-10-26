// schema/fields.js - typed fields of catalogue, listing and inventory forms: text, long text, number (with a unit of
// the registry or a free unit label, min / max / decimals, an optional scale), range (from-to), select, multiselect,
// date, bool, and identifiers (MAC / BSSID, IPv4 / IPv6, serial and inventory numbers; ../util/ident.js) that are
// validated, normalised and compacted for search. Units and their conversion come from ../units/. Fields carry roles
// (where they take part: form, filter, card, tile, …), a group, the contexts they apply to, a condition for being
// shown (showIf) and may be computed (filled by the server, never required). Values are checked one by one with
// error codes, not messages: wording belongs to the form.
// Contract templates have their own field kinds (party, period, schedule) in ../contract/fields.js; dates use its
// calendar parser.
//
//   FIELD_TYPES, IDENT_TYPES, TYPE_META, FIELD_ROLES
//   normalizeField(raw) -> field | null          (complete, with defaults; null without a valid key)
//   normalizeFieldDef(raw, { inherited, types }) -> { def, errors }   (partial: null = inherit; for category trees)
//   fieldPatch(raw, { locked, owner }) -> only the touched, allowed properties
//   checkValue(field, v) -> { value, error }     error: 'required' | 'not_number' | 'min' | 'max' | 'not_option' |
//       'not_date' | 'range_order' | 'not_bool' | 'too_long' | 'mac' | 'ip' | 'serial' | 'inventory' | null
//   validateValues(fields, input, { inherited, enforceRequired, scope }) -> { values, errors: { key: code } }
//   fieldVisible(field, values)   isEmptyValue(field, v)   valueText(field, v, lang)
//   fieldsFor(fields, role, ctx) / fieldsWithRole / fieldApplies(field, ctx) / fieldGroups(fields) / sortFields
//   normalizeMac / normalizeIp / normalizeCode / normalizeIdent(type, v) / compactIdent(v)   (re-exported from ../util/ident.js)

import { isoDate } from '../contract/dates.js';
import { cleanFieldKey, i18n, pick, slugList, cleanKey } from './text.js';
import { normalizeCond, condsMatch } from './rules.js';
import { convert, normalizeKind, toNumber as parseNum, unit as unitOf } from '../units/registry.js';
import { formatQuantity } from '../units/format.js';
import { normalizeIdent } from '../util/ident.js';

export { compactIdent, normalizeCode, normalizeIdent, normalizeIp, normalizeMac } from '../util/ident.js';

//
// Two normalisers on purpose: normalizeField produces a complete field (every property with a default) for forms;
// normalizeFieldDef produces a partial one (null = inherit) for category-tree levels. Merging complete fields would
// make every level override everything with defaults, breaking inheritance.
// Values are normalised as they are checked (checkValue returns { value, error }): one function both validates and
// produces the canonical stored form, so the two cannot disagree.
export const IDENT_TYPES = ['mac', 'bssid', 'ip', 'serial', 'inventory'];
export const FIELD_TYPES = ['text', 'longtext', 'number', 'range', 'select', 'multiselect', 'date', 'bool', ...IDENT_TYPES];
// bool counts as numeric so it can carry min/max-free unit-less storage as 0/1 in filters; identifier types carry only
// ident:true and therefore read numeric/options/range as undefined (falsy).
export const TYPE_META = {
  text: { numeric: false, options: false, range: false, many: false }, longtext: { numeric: false, options: false, range: false, many: false },
  number: { numeric: true, options: false, range: false, many: false }, range: { numeric: true, options: false, range: true, many: false },
  select: { numeric: false, options: true, range: false, many: false }, multiselect: { numeric: false, options: true, range: false, many: true },
  date: { numeric: false, options: false, range: false, many: false }, bool: { numeric: true, options: false, range: false, many: false },
  mac: { ident: true }, bssid: { ident: true }, ip: { ident: true }, serial: { ident: true }, inventory: { ident: true },
};
export const FIELD_ROLES = ['form', 'filter', 'card', 'tile', 'room'];
const MAX_LEN = { text: 2000, longtext: 20000 };

// --- definitions --------------------------------------------------------------------------------------------------

// Option values are strings (compared with ===); numbers are stringified so "3" and 3 are one option. Duplicates are
// dropped keeping the first label. 200 options x 100 chars bounds a stored definition.
function normalizeOptions(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const raw of v.slice(0, 200)) {
    if (raw == null) continue;
    if (typeof raw === 'string' || typeof raw === 'number') {
      const s = String(raw).trim();
      if (s && !out.some((o) => o.v === s)) out.push({ v: s.slice(0, 100), label: {} });
      continue;
    }
    const val = String(raw.v ?? raw.value ?? '').trim();
    if (val && !out.some((o) => o.v === val)) out.push({ v: val.slice(0, 100), label: i18n(raw.label ?? raw.name, 120) });
  }
  return out;
}

/** showIf: a condition list of rules.js, or the legacy { key, equals } / { key, in: [] }. */
export function normalizeShowIf(v) {
  if (v == null || v === false) return null;
  const list = Array.isArray(v) ? v : [v];
  const out = [];
  for (const c of list) {
    if (!c || typeof c !== 'object') continue;
    const legacy = c.key !== undefined && c.v === undefined && c.op === undefined;
    const x = normalizeCond(legacy ? { v: c.key, op: 'is', a: Array.isArray(c.in) ? c.in : [c.equals] } : c);
    if (x) out.push(x);
  }
  return out.length ? out : null;
}

const finite = (v) => (v === '' || v == null ? null : Number.isFinite(+v) ? +v : null);

// Unknown types degrade to 'text' rather than null: the field and its stored values stay visible. A computed field
// is never required (the user cannot fill it). Custom roles are allowed after the known ones, for product extensions.
export function normalizeField(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const key = cleanFieldKey(r.key);
  if (!key) return null;
  const type = FIELD_TYPES.includes(r.type) ? r.type : 'text';
  const meta = TYPE_META[type];
  const computed = cleanKey(r.computed);
  const roles = Array.isArray(r.roles) ? FIELD_ROLES.filter((x) => r.roles.includes(x)).concat(r.roles.filter((x) => typeof x === 'string' && /^[a-z][a-z0-9_]{0,30}$/.test(x) && !FIELD_ROLES.includes(x))) : ['form', 'card'];
  const unit = meta.numeric && unitOf(r.unit) ? r.unit : '';
  return {
    key, type,
    label: i18n(r.label ?? r.name, 200), hint: i18n(r.hint, 400),
    unit, unitText: meta.numeric && !unit ? i18n(r.unitText ?? (typeof r.unit === 'string' ? r.unit : null), 30) : {},
    unitKind: unit ? unitOf(unit).kind : normalizeKind(r.unitKind),
    scale: meta.numeric ? cleanKey(r.scale) : '',
    min: meta.numeric ? finite(r.min) : null, max: meta.numeric ? finite(r.max) : null,
    decimals: meta.numeric && Number.isInteger(+r.decimals) && +r.decimals >= 0 ? Math.min(10, +r.decimals) : null,
    options: meta.options ? normalizeOptions(r.options) : [],
    default: r.default === undefined ? null : r.default,
    required: !!r.required && !computed,
    showIf: normalizeShowIf(r.showIf),
    group: slugList(r.group, 1)[0] || '', groupLabel: i18n(r.groupLabel ?? r.groupName, 120),
    applies: slugList(r.applies), roles,
    scope: typeof r.scope === 'string' && /^[a-z][a-z0-9_]{0,30}$/.test(r.scope) ? r.scope : 'model',
    sort: Number.isFinite(+r.sort) ? +r.sort : Number.isFinite(+r.ord) ? +r.ord : 0,
    computed,
  };
}

/**
 * A field definition of one level of a category tree: unset properties are null (inherit from above). A new key (not
 * inherited) needs a label unless it is hidden; type and scope default only for new keys.
 */
// Limitation of the null-means-inherit encoding: a level cannot reset min / max / default back to "none", because
// null already means "not set here". Note sort uses Number.isFinite without coercion here (strings are ignored),
// unlike normalizeField, which coerces with +r.sort.
export function normalizeFieldDef(raw, { inherited = false, types = FIELD_TYPES } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const errors = [];
  const key = cleanFieldKey(r.key);
  if (!key) return { def: null, errors: ['key'] };
  const isNew = !(inherited === true || (inherited instanceof Set && inherited.has(key)));
  if (r.type != null && !types.includes(r.type)) errors.push('type');
  if (isNew && !r.hidden && !Object.keys(i18n(r.label ?? r.name)).length) errors.push('label');
  if (r.options != null && !Array.isArray(r.options)) errors.push('options');
  const def = {
    key,
    type: r.type != null && types.includes(r.type) ? r.type : isNew ? 'text' : null,
    label: r.label != null || r.name != null ? i18n(r.label ?? r.name, 200) : null,
    hint: r.hint != null ? i18n(r.hint, 400) : null,
    scope: typeof r.scope === 'string' ? r.scope : isNew ? 'model' : null,
    required: r.required == null ? null : !!r.required,
    unit: r.unit != null ? String(r.unit).slice(0, 32) : null,
    options: Array.isArray(r.options) ? normalizeOptions(r.options) : null,
    default: r.default === undefined ? null : r.default,
    showIf: r.showIf != null ? normalizeShowIf(r.showIf) : null,
    min: finite(r.min), max: finite(r.max),
    group: r.group != null ? slugList(r.group, 1)[0] || '' : null,
    roles: Array.isArray(r.roles) ? r.roles.filter((x) => typeof x === 'string') : null,
    hidden: !!r.hidden,
    sort: Number.isFinite(r.sort) ? r.sort : null,
  };
  return { def: errors.length ? null : def, errors };
}

/**
 * The part of an edit that may be written: properties absent from `raw` stay absent ("not touched" differs from
 * "cleared"); locked properties (key, type, computed by default) need { owner: true }; garbage is cut, not refused.
 */
export function fieldPatch(raw, { locked = ['key', 'type', 'computed'], owner = false } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const has = (k) => Object.prototype.hasOwnProperty.call(r, k) && (owner || !locked.includes(k));
  const out = {};
  if (has('key')) { const k = cleanFieldKey(r.key); if (k) out.key = k; }
  if (has('type') && FIELD_TYPES.includes(r.type)) out.type = r.type;
  if (has('computed')) out.computed = cleanKey(r.computed);
  for (const k of ['label', 'hint', 'groupLabel', 'unitText']) if (has(k)) out[k] = i18n(r[k]);
  if (has('group')) out.group = slugList(r.group, 1)[0] || '';
  if (has('applies')) out.applies = slugList(r.applies);
  if (has('unit')) out.unit = unitOf(r.unit) ? r.unit : '';
  if (has('options')) out.options = normalizeOptions(r.options);
  if (has('required')) out.required = !!r.required;
  if (has('sort')) out.sort = Number.isFinite(+r.sort) ? +r.sort : 0;
  if (has('showIf')) out.showIf = normalizeShowIf(r.showIf);
  if (has('roles')) out.roles = Array.isArray(r.roles) ? FIELD_ROLES.filter((x) => r.roles.includes(x)) : null;
  for (const k of ['min', 'max']) if (has(k)) out[k] = finite(r[k]);
  return out;
}

// --- values -------------------------------------------------------------------------------------------------------

export function isEmptyValue(f, v) {
  if (v == null || v === '') return true;
  if (f.type === 'range') { const p = Array.isArray(v) ? v : [v?.min, v?.max]; return p.every((x) => x == null || String(x).trim() === ''); }
  if (Array.isArray(v)) return v.length === 0;
  return typeof v === 'string' && v.trim() === '';
}

// Accepts { value, unit } from unit-aware inputs and converts to the field's unit, so "5 ft" into a metre field is
// stored as 1.524. Plain input goes through the registry parser (units/registry.js toNumber).
const toNumber = (f, v) => {
  if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v) {
    if (f.unit && v.unit && unitOf(v.unit)) return convert(v.value, v.unit, f.unit);
    v = v.value;
  }
  const n = parseNum(v);
  return Number.isFinite(n) ? n : null;
};
// Without declared decimals, round to 1e-10 to wash out binary noise (0.1 + 0.2) before comparing with min / max.
const roundTo = (n, d) => (d == null ? Math.round(n * 1e10) / 1e10 : Math.round(n * 10 ** d) / 10 ** d);
const bounds = (f, n) => (f.min != null && n < f.min ? 'min' : f.max != null && n > f.max ? 'max' : null);

// Note: the default branch can also return 'not_text' (objects or arrays for a text field), not listed in the header.
export function checkValue(f, v) {
  if (isEmptyValue(f, v)) return { value: null, error: f.required && !f.computed ? 'required' : null };
  switch (f.type) {
    case 'number': {
      const n = toNumber(f, v);
      if (n == null) return { value: null, error: 'not_number' };
      const r = roundTo(n, f.decimals);
      return { value: r, error: bounds(f, r) };
    }
    case 'range': {
      const pair = Array.isArray(v) ? v : typeof v === 'object' ? [v.min, v.max] : [v, null];
      const out = [];
      for (const x of pair.slice(0, 2)) {
        if (x == null || String(x).trim() === '') { out.push(null); continue; }
        const n = toNumber(f, x);
        if (n == null) return { value: null, error: 'not_number' };
        out.push(roundTo(n, f.decimals));
      }
      while (out.length < 2) out.push(null);
      if (out[0] != null && out[1] != null && out[0] > out[1]) return { value: out, error: 'range_order' };
      return { value: out, error: out.map((n) => (n == null ? null : bounds(f, n))).find(Boolean) || null };
    }
    case 'bool': {
      const s = String(v).trim().toLowerCase();
      if (v === true || v === 1 || ['1', 'true', 'yes', 'on'].includes(s)) return { value: true, error: null };
      if (v === false || v === 0 || ['0', 'false', 'no', 'off'].includes(s)) return { value: false, error: null };
      return { value: null, error: 'not_bool' };
    }
    case 'select': {
      const s = String(v);
      return f.options.length && !f.options.some((o) => o.v === s) ? { value: null, error: 'not_option' } : { value: s, error: null };
    }
    case 'multiselect': {
      const list = (Array.isArray(v) ? v : String(v).split(',')).map((x) => String(x).trim()).filter(Boolean);
      const uniq = [...new Set(list)];
      if (f.options.length && uniq.some((x) => !f.options.some((o) => o.v === x))) return { value: null, error: 'not_option' };
      return { value: uniq, error: null };
    }
    case 'date': {
      const d = isoDate(String(v).trim());
      return d ? { value: d, error: null } : { value: null, error: 'not_date' };
    }
    case 'mac': case 'bssid': case 'ip': case 'serial': case 'inventory': {
      const n = normalizeIdent(f.type, v);
      return n == null ? { value: null, error: f.type === 'bssid' ? 'mac' : f.type } : { value: n, error: null };
    }
    default: {
      const s = typeof v === 'string' ? v.trim() : typeof v === 'number' || typeof v === 'boolean' ? String(v) : null;
      if (s == null) return { value: null, error: 'not_text' };
      return s.length > (MAX_LEN[f.type] || 2000) ? { value: null, error: 'too_long' } : { value: s, error: null };
    }
  }
}

export const fieldVisible = (f, values) => !f.showIf || condsMatch(f.showIf, values || {});

/**
 * Check a whole form. `inherited` are values set higher up the tree ({ key: value } or { key: { value } }); a field
 * hidden by showIf is skipped, a computed field is never taken from input, and a default satisfies `required`.
 */
// showIf is evaluated on inherited + input values merged, so a condition can depend on a value set higher up.
// Values of hidden fields are not returned: a stale answer to a question no longer shown must not be saved.
export function validateValues(fields, input, { inherited = {}, enforceRequired = true, scope = null } = {}) {
  const inh = {};
  for (const [k, v] of Object.entries(inherited || {})) inh[k] = v && typeof v === 'object' && 'value' in v ? v.value : v;
  const all = { ...inh, ...(input || {}) };
  const values = {}, errors = {};
  for (const f of fields) {
    if (scope && f.scope !== scope) continue;
    if (f.computed || !fieldVisible(f, all)) continue;
    const v = input ? input[f.key] : undefined;
    const req = enforceRequired && f.required && inh[f.key] == null && f.default == null;
    const r = checkValue({ ...f, required: req }, v);
    if (r.error) errors[f.key] = r.error;
    else if (r.value != null) values[f.key] = r.value;
  }
  return { values, errors };
}

export function valueText(f, v, lang = 'en') {
  if (isEmptyValue(f, v)) return '';
  const withUnit = (n) => (f.unit ? formatQuantity(n, f.unit, { lang }) : (() => { const u = pick(f.unitText, lang); const t = String(Math.round(n * 100) / 100); return u ? t + ' ' + u : t; })());
  switch (f.type) {
    case 'select': { const o = f.options.find((x) => x.v === String(v)); return o ? pick(o.label, lang) || o.v : String(v); }
    case 'multiselect': return (Array.isArray(v) ? v : [v]).map((x) => { const o = f.options.find((y) => y.v === String(x)); return o ? pick(o.label, lang) || o.v : String(x); }).join(', ');
    case 'number': return Number.isFinite(+v) ? withUnit(+v) : '';
    case 'range': {
      const [a, b] = Array.isArray(v) ? v : [v.min, v.max];
      if (a != null && b != null) return a === b ? withUnit(a) : `${String(Math.round(a * 100) / 100)}–${withUnit(b)}`;
      return a != null ? '≥ ' + withUnit(a) : '≤ ' + withUnit(b);
    }
    case 'bool': return v === true || v === 'true' ? ({ ru: 'да', ka: 'კი' }[lang] || 'yes') : ({ ru: 'нет', ka: 'არა' }[lang] || 'no');
    default: return String(v);
  }
}

// --- selection ----------------------------------------------------------------------------------------------------

// Stable total order: sort number, then key. Without the key tie-break equal sorts would order by input order,
// which differs between levels and makes forms jump.
export const sortFields = (fields) => [...fields].sort((a, b) => (a.sort || 0) - (b.sort || 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

/** Does a field make sense in this context? An empty `applies` means everywhere; otherwise any named value matches. */
export function fieldApplies(f, ctx = {}) {
  if (!f.applies || !f.applies.length) return true;
  return Object.values(ctx).some((v) => v != null && f.applies.includes(String(v).trim().toLowerCase()));
}

export const fieldsWithRole = (fields, role) => sortFields(fields.filter((f) => (f.roles || []).includes(role)));
export const fieldsFor = (fields, role, ctx = {}) => sortFields(fields.filter((f) => (f.roles || []).includes(role) && fieldApplies(f, ctx)));

/** Fields grouped for a form; a group's label is the first non-empty one in sort order; ungrouped fields come last. */
export function fieldGroups(fields) {
  const order = [];
  const by = new Map();
  for (const f of sortFields(fields)) {
    const g = by.get(f.group);
    if (g) { if (!Object.keys(g.label).length) g.label = f.groupLabel || {}; g.fields.push(f); }
    else { order.push(f.group); by.set(f.group, { key: f.group, label: f.groupLabel || {}, fields: [f] }); }
  }
  return order.filter((k) => k).map((k) => by.get(k)).concat(by.has('') ? [by.get('')] : []);
}
