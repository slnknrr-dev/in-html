// contract/model.js - the shapes of contract templates and filled documents, their normalization (never throws,
// bounded on hostile input) and JSON import / export.
//
// Template { format: 'in-html-contract', v: 1, id, version, name: {lang}, description: {lang}, kind,
//   langs: ['ru', 'en'], main: 'ru',                      the contract languages; `main` is the source of truth
//   title: {lang},                                        heading of the contract (template text)
//   modifiers: [{ id, label: {lang}, help: {lang}, default }]          toggles (poa, extraServices, nuances)
//   levels: [{ id, label, options: [{ v, label }], default }]           enumerated levels (strictness)
//   groups: [{ id, label }]                               groups of the fields panel (parties, object, money…)
//   fields: [Field]                                       see FIELD_TYPES
//   sections: [{ id, kind: 'numbered' | 'plain' | 'appendix' | 'signatures', title: {lang}, when,
//               clauses: [{ id, title: {lang}, when, by, text: {lang}, variants: { option: {lang} } }] }]
//                                                         `when`: an expression (contract/expr.js); `by`: a level
//                                                         id whose option picks the text of `variants` (else text)
//   validator: 'JS function body (fields, ctx, helpers) -> issues'
//   sample: { values, modifiers, levels }                 example values (the template opened as a document)
//   page: { size: 'A4' | 'Letter' | 'Legal', margins: [top, right, bottom, left] mm, font: 'serif' | 'sans', fontSize }
//   builtin, created, updated }
// Document { format: 'in-html-contract-doc', v: 1, id, name, templateId, templateVersion, values: { fieldId: value },
//   modifiers: { id: bool }, levels: { id: option }, lang, bilingual: '' | lang, created, updated }
//
//   normalizeTemplate(raw) -> Template     normalizeDoc(raw) -> Document     newTemplate(o)   newDocument(tpl, o)
//   FIELD_TYPES  PARTY_PARTS  DOCREF_PARTS  LIST_ITEM_TYPES  isFieldId(s)  isName(s)
//   exportJSON(tpl, doc?) -> string        parseImport(text) -> { template, doc, error }
import { canonLang } from '../i18n/lang.js';
import { normI18n } from '../i18n/text.js';
import { uid } from '../util/id.js';
import { bool, isObj, num, oneOf, str } from '../util/value.js';
import { PAGE_SIZES } from '../paper/base.js';

export const FORMAT = 'in-html-contract';
export const DOC_FORMAT = 'in-html-contract-doc';
export const FIELD_TYPES = ['text', 'longtext', 'number', 'money', 'date', 'period', 'select', 'bool', 'party', 'docref', 'list', 'computed', 'schedule'];
export const LIST_ITEM_TYPES = ['text', 'number', 'money', 'date', 'select', 'bool'];
export const SECTION_KINDS = ['numbered', 'plain', 'appendix', 'signatures'];
// Parts of a party (person or organisation) and of a document reference; the value is an object with these keys.
export const PARTY_PARTS = {
  person: ['name', 'gender', 'birthDate', 'birthPlace', 'passport', 'passportIssuer', 'passportDate', 'passportCode', 'address', 'inn', 'phone', 'email'],
  org: ['name', 'inn', 'ogrn', 'kpp', 'address', 'rep', 'repTitle', 'repBasis', 'bank', 'account', 'bik', 'phone', 'email'],
};
export const DOCREF_PARTS = ['kind', 'number', 'date', 'issuer', 'until'];
export const MASKS = ['', 'passport-ru', 'inn', 'snils', 'ogrn', 'phone', 'email', 'bik', 'account-ru', 'postcode-ru', 'cadastral-ru'];
// RESERVED: names that would collide with the expression language (literals, word operators, loop variables
// `index`/`item` of [[each]]) or with the object model (prototype keys). Rejected at normalization, so neither the
// parser nor the env ever has to disambiguate them.
const RESERVED = new Set(['true', 'false', 'null', 'and', 'or', 'not', 'index', 'item', '__proto__', 'constructor', 'prototype']);

// Identifier grammar: field ids allow up to 5 dotted segments (namespaces like tenant.passport.number); NAME is one
// segment for modifiers, levels, groups and list items; BLOCK_ID (sections/clauses) also allows '-' because it is
// used in URL fragments (#clause-id), never in expressions. All are anchored ASCII: no Unicode lookalikes, no
// characters needing escaping in HTML attributes or CSS selectors.
const FIELD_ID = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*){0,4}$/;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BLOCK_ID = /^[A-Za-z_][\w-]{0,47}$/;
export const isFieldId = (s) => typeof s === 'string' && s.length <= 80 && FIELD_ID.test(s) && !s.split('.').some((p) => RESERVED.has(p));
export const isName = (s) => typeof s === 'string' && s.length <= 48 && NAME.test(s) && !RESERVED.has(s);

// Hard caps on every collection and string: a template is untrusted input (imported file, shared link), and every
// later stage (render, validate, compile) is at least linear in these sizes. Cutting here bounds the whole pipeline
// once instead of guarding each consumer. Values are generous for real contracts (a 300-clause section is extreme).
const LIMITS = { langs: 20, fields: 400, sections: 200, clauses: 300, modifiers: 40, levels: 10, options: 40, text: 20000, label: 400, validator: 50000, items: 30, groups: 60 };
const cut = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '');
const i18n = (v, main, n = LIMITS.label) => {
  const o = normI18n(v, main);
  for (const k of Object.keys(o)) o[k] = cut(o[k], n);
  return o;
};
// uniq: duplicate ids are renamed (id_2, id_3), not dropped: an imported template with a copy-pasted clause keeps
// both clauses. Mutates `seen` so the caller's set tracks every id handed out.
const uniq = (id, seen, base = 'x') => {
  let s = id || base, i = 2;
  while (seen.has(s)) s = (id || base) + '_' + i++;
  seen.add(s);
  return s;
};
const arr = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
const expr = (v) => cut(str(v), 2000).trim();
// isoOrEmpty checks the SHAPE only (2027-02-30 passes); real calendar validation happens when values are read
// (dates.js parseDate via coerceValue), which returns '' for impossible days.
const isoOrEmpty = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');

function normOptions(list, main) {
  const seen = new Set();
  const out = [];
  for (const o of arr(list, LIMITS.options)) {
    const v = isObj(o) ? str(o.v ?? o.value) : str(o);
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push({ v: cut(v, 80), label: i18n(isObj(o) ? o.label : v, main) });
  }
  return out;
}

// Per-type whitelist: only the properties meaningful for the type are copied, each bounded or enumerated. A field of
// type 'money' with a stray `options` key loses it; nothing from the raw object reaches the output by spread.
// Invalid ids drop the whole field (return null) rather than inventing one: a field is referenced by id from texts,
// and a synthetic id would silently break every reference.
// SECURITY NOTE: `pattern` is a user regex kept as a string; its cost when matched (catastrophic backtracking) is
// bounded only by the 300-char source cap, not by a time limit.
function normField(f, main, seen) {
  if (!isObj(f)) return null;
  const type = oneOf(f.type, FIELD_TYPES, 'text');
  const id0 = str(f.id).trim();
  if (!isFieldId(id0)) return null;
  const id = uniq(id0, seen);
  const out = {
    id, type, label: i18n(f.label, main), help: i18n(f.help, main, 2000), group: isName(f.group) ? f.group : '',
    required: bool(f.required, false),
  };
  if (f.placeholder) out.placeholder = i18n(f.placeholder, main);
  if (f.when) out.when = expr(f.when);
  if (type === 'number' || type === 'money') {
    for (const k of ['min', 'max', 'step']) { const n = num(f[k], null); if (n != null) out[k] = n; }
    out.default = num(f.default, null);
    if (type === 'money') out.currency = /^[A-Z]{3}$/.test(str(f.currency)) ? f.currency : 'RUB';
    if (Number.isInteger(f.decimals)) out.decimals = Math.min(Math.max(f.decimals, 0), 4);
    if (f.unit) out.unit = i18n(f.unit, main);
  } else if (type === 'text' || type === 'longtext') {
    out.default = cut(str(f.default), LIMITS.text);
    out.mask = oneOf(f.mask, MASKS, '');
    if (f.pattern && typeof f.pattern === 'string' && f.pattern.length < 300) out.pattern = f.pattern;
    if (Number.isInteger(f.maxLength) && f.maxLength > 0) out.maxLength = Math.min(f.maxLength, LIMITS.text);
  } else if (type === 'date') {
    out.default = isoOrEmpty(f.default) || (f.default === 'today' ? 'today' : '');
    for (const k of ['min', 'max']) { const v = isoOrEmpty(f[k]); if (v) out[k] = v; }
    if (isFieldId(f.after)) out.after = f.after;
  } else if (type === 'select') {
    out.options = normOptions(f.options, main);
    out.default = out.options.some((o) => o.v === f.default) ? f.default : (out.options[0]?.v ?? '');
  } else if (type === 'bool') {
    out.default = bool(f.default, false);
  } else if (type === 'period') {
    out.default = isObj(f.default) ? { start: isoOrEmpty(f.default.start), months: num(f.default.months, null, 1, 1200), end: isoOrEmpty(f.default.end) } : { start: '', months: 11, end: '' };
    for (const k of ['minMonths', 'maxMonths']) { const n = num(f[k], null, 0, 1200); if (n != null) out[k] = n; }
  } else if (type === 'party') {
    out.kinds = arr(f.kinds, 2).filter((k) => k === 'person' || k === 'org');
    if (!out.kinds.length) out.kinds = ['person', 'org'];
    out.parts = isObj(f.parts) ? Object.fromEntries(Object.entries(f.parts).filter(([k, v]) => /^(person|org)$/.test(k) && Array.isArray(v)).map(([k, v]) => [k, v.filter((p) => PARTY_PARTS[k].includes(p))])) : {};
    out.idMask = oneOf(f.idMask, MASKS, 'passport-ru');
  } else if (type === 'docref') {
    // Kinds of the document ({ v, label, issuer }: the phrase before the issuer, "certified by"), matched by value.
    const byV = new Map(arr(f.kinds, LIMITS.options).filter(isObj).map((x) => [str(x.v ?? x.value), x]));
    out.kinds = normOptions(f.kinds, main).map((o) => ({ ...o, issuer: i18n(byV.get(o.v)?.issuer, main) }));
    out.parts = arr(f.parts, DOCREF_PARTS.length).filter((p) => DOCREF_PARTS.includes(p));
    if (!out.parts.length) out.parts = ['kind', 'number', 'date', 'issuer'];
  } else if (type === 'list') {
    const iseen = new Set();
    out.items = [];
    for (const it of arr(f.items, LIMITS.items)) {
      if (!isObj(it) || !isName(it.id) || iseen.has(it.id)) continue;
      iseen.add(it.id);
      const t = oneOf(it.type, LIST_ITEM_TYPES, 'text');
      const item = { id: it.id, type: t, label: i18n(it.label, main), required: bool(it.required, false) };
      if (t === 'select') item.options = normOptions(it.options, main);
      if (t === 'money') item.currency = /^[A-Z]{3}$/.test(str(it.currency)) ? it.currency : (out.currency || 'RUB');
      if (it.width) item.width = num(it.width, null, 5, 100);
      out.items.push(item);
    }
    if (!out.items.length) out.items = [{ id: 'name', type: 'text', label: {}, required: true }];
    for (const k of ['min', 'max']) { const n = num(f[k], null, 0, 500); if (n != null) out[k] = n; }
    out.currency = /^[A-Z]{3}$/.test(str(f.currency)) ? f.currency : 'RUB';
  } else if (type === 'computed') {
    out.expr = expr(f.expr);
    out.format = oneOf(f.format, ['', 'number', 'money', 'date', 'text', 'bool'], '');
    if (out.format === 'money') out.currency = /^[A-Z]{3}$/.test(str(f.currency)) ? f.currency : 'RUB';
  } else if (type === 'schedule') {
    out.term = isFieldId(f.term) ? f.term : 'term';
    out.amount = expr(f.amount) || 'rent';
    out.prorata = bool(f.prorata, true);
    out.anchorDay = num(f.anchorDay, null, 1, 31);
    out.dueOffset = Math.trunc(num(f.dueOffset, 0, -60, 60));
    out.currency = /^[A-Z]{3}$/.test(str(f.currency)) ? f.currency : 'RUB';
  }
  return out;
}

function normClause(c, main, seen) {
  if (!isObj(c)) return null;
  const id = uniq(BLOCK_ID.test(str(c.id)) ? c.id : '', seen, 'c' + seen.size);
  const out = { id, text: i18n(c.text, main, LIMITS.text) };
  if (c.title) out.title = i18n(c.title, main);
  if (c.when) out.when = expr(c.when);
  // Variant keys are option values of the level named by `by`; '__proto__' is excluded explicitly because the
  // character class [\w-] would accept it and assigning it on a plain object would set the prototype.
  if (isName(c.by) && isObj(c.variants)) {
    out.by = c.by;
    out.variants = {};
    for (const [k, v] of Object.entries(c.variants).slice(0, LIMITS.options)) if (/^[\w-]{1,80}$/.test(k) && k !== '__proto__') out.variants[k] = i18n(v, main, LIMITS.text);
  }
  return out;
}

// Order matters: languages first (every i18n() needs `main`), then modifiers and levels (their ids reserve names),
// then fields (may not shadow those names), then sections. Language codes are canonicalized and deduplicated; a
// template with no valid language still gets one, so `main` is always a member of `langs`.
export function normalizeTemplate(raw) {
  const r = isObj(raw) ? raw : {};
  let langs = [];
  for (const l of arr(r.langs, LIMITS.langs)) { const c = canonLang(str(l)); if (c && !langs.includes(c)) langs.push(c); }
  if (!langs.length) langs = [canonLang(str(r.main)) || 'en'];
  const main = langs.includes(canonLang(str(r.main))) ? canonLang(str(r.main)) : langs[0];
  const names = new Set();
  const modifiers = [];
  for (const m of arr(r.modifiers, LIMITS.modifiers)) {
    if (!isObj(m) || !isName(m.id) || names.has(m.id)) continue;
    names.add(m.id);
    modifiers.push({ id: m.id, label: i18n(m.label, main), help: i18n(m.help, main, 2000), default: bool(m.default, false) });
  }
  const levels = [];
  for (const l of arr(r.levels, LIMITS.levels)) {
    if (!isObj(l) || !isName(l.id) || names.has(l.id)) continue;
    const options = normOptions(l.options, main);
    if (!options.length) continue;
    names.add(l.id);
    levels.push({ id: l.id, label: i18n(l.label, main), options, default: options.some((o) => o.v === l.default) ? l.default : options[0].v });
  }
  const fseen = new Set(names);
  const fields = [];
  for (const f of arr(r.fields, LIMITS.fields)) {
    // A field may not shadow a modifier or a level (expressions read them by the same names).
    if (isObj(f) && names.has(str(f.id).split('.')[0])) continue;
    const nf = normField(f, main, fseen);
    if (nf) fields.push(nf);
  }
  const gseen = new Set();
  const groups = [];
  for (const g of arr(r.groups, LIMITS.groups)) if (isObj(g) && isName(g.id) && !gseen.has(g.id)) { gseen.add(g.id); groups.push({ id: g.id, label: i18n(g.label, main) }); }
  const sseen = new Set(), cseen = new Set();
  const sections = [];
  for (const s of arr(r.sections, LIMITS.sections)) {
    if (!isObj(s)) continue;
    const sec = { id: uniq(BLOCK_ID.test(str(s.id)) ? s.id : '', sseen, 's' + sseen.size), kind: oneOf(s.kind, SECTION_KINDS, 'numbered'), title: i18n(s.title, main, 2000), clauses: [] };
    if (s.when) sec.when = expr(s.when);
    for (const c of arr(s.clauses, LIMITS.clauses)) { const nc = normClause(c, main, cseen); if (nc) sec.clauses.push(nc); }
    sections.push(sec);
  }
  // Section and clause ids share the {{#id}} namespace: a clause id that repeats a section id is renamed.
  // KNOWN DEFECT: the renamed clause id (c_2) is checked against clause ids only, not against section ids, so it can
  // collide with a section literally named 'c_2'. Fix: loop uniq over the union of sseen and cseen.
  for (const s of sections) for (const c of s.clauses) if (sseen.has(c.id)) c.id = uniq(c.id, cseen);
  const sample = isObj(r.sample) ? { values: cleanValues(r.sample.values), modifiers: cleanFlags(r.sample.modifiers), levels: cleanLevels(r.sample.levels) } : { values: {}, modifiers: {}, levels: {} };
  const pg = isObj(r.page) ? r.page : {};
  const margins = Array.isArray(pg.margins) && pg.margins.length === 4 ? pg.margins.map((m) => num(m, 20, 0, 60)) : [20, 15, 20, 25];
  return {
    format: FORMAT, v: 1,
    id: /^[\w-]{1,64}$/.test(str(r.id)) ? r.id : uid(),
    version: Math.trunc(num(r.version, 1, 1, 1e9)),
    name: i18n(r.name, main), description: i18n(r.description, main, 2000), kind: cut(str(r.kind), 40),
    langs, main, title: i18n(r.title, main, 2000),
    modifiers, levels, groups, fields, sections,
    validator: cut(str(r.validator), LIMITS.validator),
    sample,
    page: { size: oneOf(pg.size, Object.keys(PAGE_SIZES), 'A4'), margins, font: oneOf(pg.font, ['serif', 'sans'], 'serif'), fontSize: num(pg.fontSize, 12, 9, 16) },
    builtin: bool(r.builtin, false), frozen: bool(r.frozen, false),
    created: cut(str(r.created), 40), updated: cut(str(r.updated), 40),
  };
}

// Values: plain JSON data of bounded size (the template decides later how each one is read: fields.js coerceValue).
// Depth 3 and breadth caps (500 array items, 60 keys) bound a hostile document; keys are restricted to a safe
// charset and '__proto__' is refused for the same prototype-pollution reason as variants above.
function cleanValue(v, depth) {
  if (v == null) return null;
  if (typeof v === 'string') return v.slice(0, LIMITS.text);
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v;
  if (depth > 3) return null;
  if (Array.isArray(v)) return v.slice(0, 500).map((x) => cleanValue(x, depth + 1));
  if (isObj(v)) {
    const o = {};
    for (const [k, x] of Object.entries(v).slice(0, 60)) if (/^[\w.-]{1,80}$/.test(k) && k !== '__proto__') o[k] = cleanValue(x, depth + 1);
    return o;
  }
  return null;
}
export function cleanValues(v) {
  const out = {};
  if (!isObj(v)) return out;
  for (const [k, x] of Object.entries(v).slice(0, LIMITS.fields)) if (isFieldId(k)) out[k] = cleanValue(x, 0);
  return out;
}
const cleanFlags = (v) => Object.fromEntries(Object.entries(isObj(v) ? v : {}).filter(([k, x]) => isName(k) && typeof x === 'boolean').slice(0, LIMITS.modifiers));
const cleanLevels = (v) => Object.fromEntries(Object.entries(isObj(v) ? v : {}).filter(([k, x]) => isName(k) && typeof x === 'string' && x.length <= 80).slice(0, LIMITS.levels));

export function normalizeDoc(raw) {
  const r = isObj(raw) ? raw : {};
  return {
    format: DOC_FORMAT, v: 1,
    id: /^[\w-]{1,64}$/.test(str(r.id)) ? r.id : uid(),
    name: cut(str(r.name), 200),
    templateId: /^[\w-]{1,64}$/.test(str(r.templateId)) ? r.templateId : '',
    templateVersion: Math.trunc(num(r.templateVersion, 1, 1, 1e9)),
    values: cleanValues(r.values), modifiers: cleanFlags(r.modifiers), levels: cleanLevels(r.levels),
    lang: canonLang(str(r.lang)) || '', bilingual: canonLang(str(r.bilingual)) || '',
    created: cut(str(r.created), 40), updated: cut(str(r.updated), 40),
  };
}

export function newTemplate(o = {}) {
  const main = canonLang(o.main) || 'en';
  return normalizeTemplate({
    langs: [main], main, name: { [main]: o.name || 'New template' }, title: { [main]: o.title || o.name || 'AGREEMENT' },
    sections: [{ id: 'subject', title: { [main]: o.section || 'Subject' }, clauses: [{ id: 'c1', text: { [main]: '' } }] }],
    created: o.now || '', updated: o.now || '',
  });
}

// A document of a template: its sample values (or the defaults), modifier and level defaults.
// `?? m.default`: a sample may omit some modifiers; o.empty ignores the sample entirely (a blank form) but still
// applies template defaults, so modifiers and levels always have a defined state.
export function newDocument(tpl, o = {}) {
  const t = normalizeTemplate(tpl);
  const modifiers = {}, levels = {};
  for (const m of t.modifiers) modifiers[m.id] = o.empty ? m.default : (t.sample.modifiers[m.id] ?? m.default);
  for (const l of t.levels) levels[l.id] = o.empty ? l.default : (t.sample.levels[l.id] ?? l.default);
  return normalizeDoc({
    name: o.name || '', templateId: t.id, templateVersion: t.version,
    values: o.empty ? {} : JSON.parse(JSON.stringify(t.sample.values)), modifiers, levels, lang: t.main,
    created: o.now || '', updated: o.now || '',
  });
}

// One JSON file for a template, or for a document together with its template.
export function exportJSON(tpl, doc) {
  const t = normalizeTemplate(tpl);
  if (!doc) return JSON.stringify(t, null, 2);
  return JSON.stringify({ format: DOC_FORMAT + '-bundle', v: 1, document: normalizeDoc(doc), template: t }, null, 2);
}

// Accepts a bare template or a document bundle; anything else is 'format'. A leading BOM (Windows editors) is
// stripped: JSON.parse rejects it. On a bundle the document is re-pointed to the imported template's id/version,
// because normalizeTemplate may have assigned a fresh id (invalid or missing one), which would orphan the document.
export function parseImport(text) {
  let raw;
  try { raw = JSON.parse(String(text || '').replace(/^﻿/, '')); } catch (e) { return { template: null, doc: null, error: 'json' }; }
  if (!isObj(raw)) return { template: null, doc: null, error: 'format' };
  if (raw.format === FORMAT) return { template: normalizeTemplate(raw), doc: null, error: null };
  if (raw.format === DOC_FORMAT + '-bundle' && isObj(raw.template)) {
    const template = normalizeTemplate(raw.template);
    const doc = normalizeDoc(raw.document);
    doc.templateId = template.id;
    doc.templateVersion = template.version;
    return { template, doc, error: null };
  }
  return { template: null, doc: null, error: 'format' };
}
