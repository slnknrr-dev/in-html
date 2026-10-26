// catalog-rules/engine.js - the project model of Catalog Rules and its evaluation, without DOM (importable in Node):
// a category tree whose nodes define fields (schema/ inheritance: inherit, override, hide) and default values, title
// rules with per-language templates, scales (units/scales.js), tag templates (schema/tags.js) and sample objects.
//
//   normalizeProject(raw) -> project         (never throws; unknown parts are dropped, ids repaired)
//   chainOf(P, id) -> [node root … id]       resolveNode(P, id) -> resolveSchema result (+ decimals, groupLabel)
//   columnKeys(P) -> keys of the sample table (fields of every node in tree order, then rule variables)
//   ruleSet(P) -> { norm: [rule | null per raw rule], active: [rule], toRaw: [raw index per active index] }
//   evalSample(P, sample, lang) -> values, errors, variables, title per language, the winning raw rule, the trace,
//       tags (texts, links, search tokens) and whether the expected title matched
//   samplesToCSV(P, rows) / samplesFromCSV(P, text)
//
// Variables of templates: every field (selects print their option label, numbers the number without its unit, so
// "{area} m²" reads naturally), `category` (the node name) and `path` (the node names root -> leaf). Conditions see
// raw values: option codes, numbers, `category` (the node id) and `path` (the ids of the chain, so "path is dairy"
// holds for milk and cheese). A sample inherits the default values of its category (inheritValues).
//
// Design rules:
// - No DOM, no globals: every function takes the project P explicitly, so the same code runs in the pages, in Node
//   tests and in the CSV import. The app layer (main.js, rules.js) only renders what these functions return.
// - Thin adapter over the libraries (schema/, units/, csv/): this file owns the project *shape* and the glue, the
//   libraries own the semantics (inheritance, rule matching, tag texts). Where a library lacks a feature the gap is
//   patched here and marked (see resolveNode).
// - normalizeProject is the trust boundary: imported JSON, localStorage and demos all pass through it. It caps every
//   collection (300 nodes, 200 fields per node, 40 rules, 60 tags, 2000 samples), repairs ids, breaks parent cycles
//   and deep-copies nested parts (JSON round trip) so later edits never alias the caller's object.
// - Pure recomputation: nothing derived is stored in the project; evalSample recomputes the schema, values, titles
//   and trace on every call. Simple and always consistent; the cost is fine at demo sizes.
// NOTE: the summary above lists evalSample(P, sample, lang), but the function takes (P, sample); per-language output
// comes from varsFor(lang) in its result.

import { cleanFieldKey, cleanKey, i18n, pick } from '../schema/text.js';
import { checkValue, valueText, validateValues } from '../schema/fields.js';
import { inheritValues, resolveSchema } from '../schema/inherit.js';
import { buildRuleTitle, normalizeCond, normalizeRule, renderTemplate, rulesVars, templateVars, traceRules } from '../schema/rules.js';
import { normalizeTagDef, normalizeTagValues, tagIndexTokens, tagLinkUrl, tagText } from '../schema/tags.js';
import { normalizeScales } from '../units/scales.js';
import { formatNumber } from '../units/format.js';
import { parseCSV, serializeCSV, sniffCSV } from '../csv/csv.js';
import { suggestMapping } from '../csv/mapping.js';

export const CONTENT_LANGS = ['ka', 'ru', 'en'];
export const SPECIAL_VARS = ['category', 'path'];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (v == null ? '' : typeof v === 'object' ? '' : String(v));

// --- labels and option lines ('code = English | Русский | ქართული') --------------------------------------------

// Label lines are positional "English | Русский | ქართული"; trailing empty parts are trimmed when formatting so a
// label with only English stays a single word in the editor.
const LABEL_ORDER = ['en', 'ru', 'ka'];
export const parseLabels = (s) => {
  const parts = String(s ?? '').split('|').map((x) => x.trim());
  const out = {};
  LABEL_ORDER.forEach((l, i) => { if (parts[i]) out[l] = parts[i]; });
  return out;
};
export const formatLabels = (o) => {
  const parts = LABEL_ORDER.map((l) => (isObj(o) ? str(o[l]) : ''));
  while (parts.length && !parts[parts.length - 1]) parts.pop();
  return parts.join(' | ');
};
// One option per line: "code = labels" or a bare code. Duplicate codes keep the first occurrence.
export function parseOptions(text) {
  const out = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    const i = s.indexOf('=');
    const v = (i < 0 ? s : s.slice(0, i)).trim();
    if (v && !out.some((o) => o.v === v)) out.push({ v, label: i < 0 ? {} : parseLabels(s.slice(i + 1)) });
  }
  return out;
}
export const formatOptions = (list) => (Array.isArray(list) ? list : []).map((o) => {
  if (typeof o === 'string') return o;
  const l = formatLabels(o.label);
  return l ? `${o.v} = ${l}` : String(o.v ?? '');
}).join('\n');

// --- project ------------------------------------------------------------------------------------------------------

export const emptyProject = () => ({
  version: 1, name: 'Catalogue', srcLang: 'en',
  tree: [{ id: 'root', parent: null, name: { en: 'Catalogue', ru: 'Каталог', ka: 'კატალოგი' }, fields: [], values: {} }],
  scales: [], rules: [], fallback: {}, tags: [], samples: [],
});

// Ids are cleaned to safe keys and de-duplicated with _2, _3 ...; `taken` is shared across the whole tree.
function cleanNodeId(v, taken) {
  let id = cleanKey(v) || 'node';
  if (taken.has(id)) { let i = 2; while (taken.has(id + '_' + i)) i++; id = id + '_' + i; }
  taken.add(id);
  return id;
}

export function normalizeProject(raw) {
  const r = isObj(raw) ? raw : {};
  const P = emptyProject();
  P.name = str(r.name).trim().slice(0, 120) || P.name;
  P.srcLang = CONTENT_LANGS.includes(r.srcLang) ? r.srcLang : 'en';
  const taken = new Set();
  // ren: old id -> cleaned id, so parent references and sample.node can be remapped after cleaning. The first node
  // with a given raw id wins the mapping (duplicates got new ids and cannot be referenced unambiguously).
  const ren = new Map();
  const nodes = [];
  for (const n of (Array.isArray(r.tree) ? r.tree : []).slice(0, 300)) {
    if (!isObj(n)) continue;
    const id = cleanNodeId(n.id, taken);
    if (!ren.has(String(n.id))) ren.set(String(n.id), id);
    nodes.push({
      id, parent: n.parent == null ? null : String(n.parent), name: i18n(n.name, 120),
      fields: (Array.isArray(n.fields) ? n.fields : []).filter(isObj).slice(0, 200).map((f) => JSON.parse(JSON.stringify(f))),
      values: isObj(n.values) ? Object.fromEntries(Object.entries(n.values).filter(([k, v]) => cleanFieldKey(k) && v != null && typeof v !== 'object').map(([k, v]) => [k, v])) : {},
    });
  }
  for (const n of nodes) {
    n.parent = n.parent == null ? null : ren.get(n.parent) || null;
    if (n.parent === n.id) n.parent = null;
  }
  // Break cycles: a node whose chain returns to itself is moved to the root.
  // Cycle breaking walks each node's ancestor chain; nodes.find per step is O(n) but n <= 300, so O(n^2) worst case is
  // negligible and avoids building an index for a one-off repair.
  for (const n of nodes) {
    const seen = new Set([n.id]);
    let p = n.parent;
    while (p) { if (seen.has(p)) { n.parent = null; break; } seen.add(p); p = nodes.find((x) => x.id === p)?.parent || null; }
  }
  if (nodes.length) P.tree = nodes;
  P.scales = (Array.isArray(r.scales) ? r.scales : []).filter(isObj).slice(0, 30).map((s) => JSON.parse(JSON.stringify(s)));
  P.rules = (Array.isArray(r.rules) ? r.rules : []).filter(isObj).slice(0, 40).map((x) => ({
    note: str(x.note).slice(0, 200), off: !!x.off,
    when: (Array.isArray(x.when) ? x.when : []).filter(isObj).slice(0, 12).map((c) => ({ v: str(c.v), op: str(c.op) || 'is', a: Array.isArray(c.a) ? c.a.map(str) : c.a == null ? [] : [str(c.a)] })),
    tpl: Object.fromEntries(CONTENT_LANGS.map((l) => [l, isObj(x.tpl) ? str(x.tpl[l]).slice(0, 200) : ''])),
  }));
  P.fallback = Object.fromEntries(CONTENT_LANGS.map((l) => [l, isObj(r.fallback) ? str(r.fallback[l]).slice(0, 200) : '']));
  const ids = new Set();
  P.tags = (Array.isArray(r.tags) ? r.tags : []).filter(isObj).slice(0, 60).map((x) => {
    // Tag ids must be positive unique integers (they appear in search tokens such as "t3"); collisions get the lowest
    // free id.
    let id = Math.trunc(+x.id);
    if (!(id > 0) || ids.has(id)) { id = 1; while (ids.has(id)) id++; }
    ids.add(id);
    return { ...JSON.parse(JSON.stringify(x)), id };
  });
  const sids = new Set();
  P.samples = (Array.isArray(r.samples) ? r.samples : []).filter(isObj).slice(0, 2000).map((x) => {
    let id = str(x.id).slice(0, 40) || 's';
    if (sids.has(id)) { let i = 2; while (sids.has(id + '_' + i)) i++; id = id + '_' + i; }
    sids.add(id);
    const values = {};
    // Sample values are stored as strings (exactly what the user typed); typing happens at evaluation time.
    if (isObj(x.values)) for (const [k, v] of Object.entries(x.values)) if (cleanFieldKey(k) && v != null && typeof v !== 'object') values[k] = String(v);
    return { id, node: ren.get(str(x.node)) || str(x.node), values, tags: str(x.tags).slice(0, 2000), expect: str(x.expect).slice(0, 300) };
  });
  return P;
}

// --- tree ---------------------------------------------------------------------------------------------------------

export const nodeById = (P, id) => P.tree.find((n) => n.id === id) || null;
export const childrenOf = (P, id) => P.tree.filter((n) => n.parent === id);
export const nodeName = (P, id, lang) => { const n = nodeById(P, id); return n ? pick(n.name, lang, ['en', 'ru', 'ka']) || n.id : id; };

// The seen set protects against a corrupted parent chain at read time too (normalizeProject also breaks cycles).
export function chainOf(P, id) {
  const out = [];
  let n = nodeById(P, id);
  const seen = new Set();
  while (n && !seen.has(n.id)) { seen.add(n.id); out.unshift(n); n = n.parent ? nodeById(P, n.parent) : null; }
  return out;
}

/** Nodes in depth-first order with their depth: [{ node, depth }]. */
export function treeOrder(P) {
  const out = [];
  const walk = (parent, depth) => { for (const n of childrenOf(P, parent)) { out.push({ node: n, depth }); walk(n.id, depth + 1); } };
  walk(null, 0);
  return out;
}

export const descendants = (P, id) => { const out = []; const walk = (p) => { for (const c of childrenOf(P, p)) { out.push(c.id); walk(c.id); } }; walk(id); return out; };

/**
 * resolveSchema over the chain of a node. normalizeFieldDef (schema/) does not carry `decimals` and `groupLabel` of a
 * level, so they are applied here from the raw definitions, the nearest level winning (reported as a library gap).
 */
// Nearest level wins: the loop walks root -> leaf, so later (deeper) definitions overwrite earlier ones; a level that
// hides the field resets decimals.
export function resolveNode(P, id) {
  const chain = chainOf(P, id);
  const res = resolveSchema(chain.map((n) => ({ id: n.id, name: n.name, fields: n.fields, values: n.values })));
  for (const f of res.fields) {
    for (const n of chain) {
      for (const d of n.fields) {
        if (cleanFieldKey(d.key) !== f.key) continue;
        if (d.hidden) { f.decimals = null; continue; }
        if (Number.isInteger(+d.decimals) && d.decimals !== '' && d.decimals != null && +d.decimals >= 0) f.decimals = Math.min(10, +d.decimals);
        const gl = i18n(d.groupLabel, 120);
        if (Object.keys(gl).length) f.groupLabel = gl;
      }
    }
  }
  res.chainNodes = chain;
  return res;
}

/** Keys of the sample table: fields of every node in tree order, then rule and fallback variables that are no field. */
// Sample-table columns: every resolved field of every node, then variables used by rules and fallbacks that are not
// fields (so a rule can reference an ad-hoc key and the table still offers a column for it).
export function columnKeys(P) {
  const out = [];
  const add = (k) => { if (k && !out.includes(k) && !SPECIAL_VARS.includes(k)) out.push(k); };
  for (const { node } of treeOrder(P)) for (const f of resolveNode(P, node.id).fields) add(f.key);
  for (const r of ruleSet(P).active) for (const k of rulesVars([r])) add(k);
  for (const l of CONTENT_LANGS) for (const k of templateVars(P.fallback[l])) add(k);
  return out;
}

/** Field definitions per key across the tree (first resolved definition), for column hints and option lists. */
export function fieldIndex(P) {
  const by = new Map();
  for (const { node } of treeOrder(P)) for (const f of resolveNode(P, node.id).fields) if (!by.has(f.key)) by.set(f.key, f);
  return by;
}

// --- rules, scales, tags ------------------------------------------------------------------------------------------

/** Normalized rules per raw rule (null when it has no template) and the active list with its raw indices. */
// toRaw maps an index in the active list back to the user's rule number: the UI numbers rules as the user sees them,
// including disabled or incomplete ones.
export function ruleSet(P) {
  const norm = P.rules.map((r) => normalizeRule(r));
  const active = [], toRaw = [];
  norm.forEach((r, i) => { if (r) { active.push(r); toRaw.push(i); } });
  return { norm, active, toRaw };
}

/** Conditions of a raw rule that normalizeCond drops (a bound that is no number, an empty "is" list, a bad key). */
export const droppedConds = (raw) => (raw.when || []).map((c, i) => (normalizeCond(c) ? -1 : i)).filter((i) => i >= 0);

export const projectScales = (P) => normalizeScales(P.scales);
export const tagDefs = (P) => P.tags.map((x) => { const d = normalizeTagDef(x); return d ? { ...d, id: x.id } : null; }).filter(Boolean);

/** 'sea dist=150 walk=2; mall name=metro' -> [{ def, values, raw }] and the keys of unknown tags. */
// Mini syntax for sample tags: "key k=v k=v; key2 ..." (the tag key or "t<id>"). Unknown keys are collected for a
// warning instead of failing the whole line.
export function parseMarks(text, defs) {
  const marks = [], unknown = [];
  for (const part of String(text ?? '').split(';')) {
    const words = part.trim().split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const key = words[0].toLowerCase();
    const def = defs.find((d) => d.key === key || 't' + d.id === key);
    if (!def) { unknown.push(words[0]); continue; }
    const raw = {};
    for (const w of words.slice(1)) { const i = w.indexOf('='); if (i > 0) raw[w.slice(0, i).toLowerCase()] = w.slice(i + 1); }
    marks.push({ def, raw, values: normalizeTagValues(def, raw) });
  }
  return { marks, unknown };
}

// --- evaluation of a sample ---------------------------------------------------------------------------------------

// Template text of a value: numbers formatted for the language with the field's decimals, options by label.
function varText(f, v, lang) {
  if (v == null || v === '') return '';
  switch (f.type) {
    case 'number': return formatNumber(v, { lang, digits: f.decimals ?? 2 });
    case 'select': case 'multiselect': case 'range': case 'bool': return valueText(f, v, lang);
    default: return Array.isArray(v) ? v.join(', ') : String(v);
  }
}

/**
 * Everything the tester shows about one sample. `lang` is the UI language (option labels of the trace); titles are
 * rendered in every content language. Fallback texts in languages other than the source one are rendered here
 * (buildRuleTitle renders its fallback in the source language only).
 */
export function evalSample(P, sample) {
  const node = nodeById(P, sample.node);
  const res = node ? resolveNode(P, node.id) : { fields: [], values: {}, chainNodes: [], hidden: [], errors: [] };
  const byKey = new Map(res.fields.map((f) => [f.key, f]));
  // Only non-empty inputs are validated: an empty cell means "not given" (inherit the category default), not "".
  const input = {};
  for (const [k, v] of Object.entries(sample.values || {})) if (String(v).trim() !== '') input[k] = v;
  const { values: checked, errors } = validateValues(res.fields, input, { inherited: res.values });
  // Defaults of the category, typed by their field; fields hidden by showIf drop their default too.
  const defaults = {};
  for (const [k, d] of Object.entries(res.values)) { const f = byKey.get(k); defaults[k] = f ? checkValue({ ...f, required: false }, d.value).value : d.value; }
  const extra = {};
  for (const [k, v] of Object.entries(input)) if (!byKey.has(k) && !SPECIAL_VARS.includes(k)) extra[k] = String(v).trim();
  // Layering: category defaults first, sample values on top; `from` remembers the origin of every value for the UI's
  // origin trail ('sample' or the node that defined the default).
  const inh = inheritValues([{ id: '@node', values: defaults }, { id: '@sample', values: { ...extra, ...checked } }]);
  const values = { ...inh.values };
  const from = {};
  for (const [k, src] of Object.entries(inh.from)) from[k] = src === '@node' ? res.values[k]?.from || node?.id : 'sample';
  // category / path are raw ids for conditions and display names for templates (varsFor), see the header.
  if (node) { values.category = node.id; values.path = res.chainNodes.map((n) => n.id); }
  // varsFor(lang) is memoised per language: a sample is rendered in three content languages plus the UI language.
  const cache = new Map();
  const varsFor = (lang) => {
    if (cache.has(lang)) return cache.get(lang);
    const out = {};
    for (const [k, v] of Object.entries(values)) {
      if (SPECIAL_VARS.includes(k)) continue;
      const f = byKey.get(k);
      out[k.toLowerCase()] = f ? varText(f, v, lang) : String(v);
    }
    if (node) {
      out.category = nodeName(P, node.id, lang);
      out.path = res.chainNodes.map((n) => pick(n.name, lang, ['en', 'ru', 'ka']) || n.id).join(' / ');
    }
    cache.set(lang, out);
    return out;
  };
  const scales = projectScales(P);
  const rs = ruleSet(P);
  const src = P.srcLang;
  const fallback = P.fallback[src] || '';
  const opts = { scales, srcLang: src, fallback, fallbacks: ['en'] };
  const built = buildRuleTitle(rs.active, values, varsFor, opts);
  const titles = { ...built.i18n };
  // Fallback title (no rule matched, rule === -1): the library renders only the source language, so the other content
  // languages are rendered here.
  if (built.rule === -1) {
    for (const l of CONTENT_LANGS) {
      if (l === src || !P.fallback[l]) continue;
      const t = renderTemplate(P.fallback[l], varsFor(l), { scales, raw: values, lang: l });
      if (t) titles[l] = t;
    }
  }
  const traced = traceRules(rs.active, values, varsFor, opts);
  // Trace aligned with the user's rule list: incomplete rules (no template) appear as incomplete instead of vanishing.
  const trace = P.rules.map((raw, i) => {
    const ai = rs.toRaw.indexOf(i);
    if (ai < 0) return { index: i, incomplete: true, off: raw.off, note: raw.note, conds: [], matched: false, texts: {}, won: false };
    return { ...traced[ai], index: i };
  });
  const winner = built.rule >= 0 ? rs.toRaw[built.rule] : built.rule;
  const defs = tagDefs(P);
  const { marks, unknown } = parseMarks(sample.tags, defs);
  const mainTitle = titles[src] || '';
  const tags = marks.map((m) => ({
    def: m.def, values: m.values,
    texts: Object.fromEntries(CONTENT_LANGS.map((l) => [l, tagText(m.def, m.values, l, { scales })])),
    link: tagLinkUrl(m.def, m.values, src, { prop: mainTitle }, scales),
    tokens: tagIndexTokens(m.def.id, m.def, m.values, scales),
  }));
  const expect = String(sample.expect || '').trim();
  return {
    node, res, values, from, errors, varsFor, titles, mainTitle, rule: built.rule, winner, trace, tags, unknownTags: unknown,
    // expectOk: null when no expectation was given, so the UI can distinguish "not checked" from "failed".
    tokens: tags.flatMap((t) => t.tokens), expect, expectOk: expect ? expect === mainTitle : null,
  };
}

// --- CSV ----------------------------------------------------------------------------------------------------------

export function samplesToCSV(P, keys) {
  // Computed columns (titles per language, winning rule) are exported for review; samplesFromCSV ignores them on
  // import, so an exported file round-trips. guard: true neutralises formula-like cells (CSV injection).
  const head = ['id', 'category', ...keys, 'tags', 'expect', ...CONTENT_LANGS.map((l) => 'title_' + l), 'rule'];
  const rows = [head];
  for (const s of P.samples) {
    const e = evalSample(P, s);
    rows.push([s.id, s.node, ...keys.map((k) => s.values[k] ?? ''), s.tags, s.expect, ...CONTENT_LANGS.map((l) => e.titles[l] || ''),
      e.winner >= 0 ? String(e.winner + 1) : e.winner === -1 ? 'fallback' : '']);
  }
  return serializeCSV(rows, { guard: true });
}

/**
 * Samples from CSV text with a header row. Columns named like a key (or a field label in any language, through
 * csv/mapping.js) become values; `category` takes a node id or name; `tags`, `expect` and `id` are read as such;
 * computed columns of an export (title_*, rule) are ignored.
 */
export function samplesFromCSV(P, text) {
  const { delimiter } = sniffCSV(text);
  // The BOM is stripped before parsing so the first header is "id", not "﻿id". Blank lines are dropped.
  const rows = parseCSV(String(text).replace(/^﻿/, ''), { delimiter }).filter((r) => r.some((c) => String(c).trim() !== ''));
  if (rows.length < 2) return { samples: [], columns: {} };
  const head = rows[0].map((h) => String(h).trim());
  const keys = columnKeys(P);
  const idx = fieldIndex(P);
  const special = { id: 'id', category: 'category', node: 'category', tags: 'tags', expect: 'expect' };
  const columns = {};
  const rest = [];
  // Column mapping: special names, ignored computed columns, exact keys; everything else goes to csv/mapping.js, which
  // matches headers against field labels in every language (e.g. "Площадь" to area). Unmatched headers become new keys.
  for (const h of head) {
    const k = h.toLowerCase();
    if (special[k]) columns[h] = '@' + special[k];
    else if (/^title_[a-z]{2}$/.test(k) || k === 'rule') columns[h] = '';
    else if (keys.includes(h) || keys.includes(k)) columns[h] = keys.includes(h) ? h : k;
    else rest.push(h);
  }
  if (rest.length) {
    const targets = keys.filter((k) => !Object.values(columns).includes(k)).map((k) => {
      const f = idx.get(k);
      return { key: k, label: f ? pick(f.label, 'en') : k, synonyms: f ? Object.values(f.label) : [] };
    });
    const m = suggestMapping(rest, targets);
    for (const h of rest) columns[h] = m.columns[h] || cleanFieldKey(h.replace(/\s+/g, '_').toLowerCase()) || '';
  }
  const byName = (s) => {
    const v = String(s ?? '').trim();
    if (!v) return '';
    const low = v.toLowerCase();
    return (P.tree.find((n) => n.id === low) || P.tree.find((n) => Object.values(n.name).some((x) => x.toLowerCase() === low)))?.id || low;
  };
  const taken = new Set(P.samples.map((s) => s.id));
  const samples = rows.slice(1).map((r, i) => {
    const s = { id: '', node: '', values: {}, tags: '', expect: '' };
    head.forEach((h, c) => {
      const to = columns[h], v = String(r[c] ?? '').trim();
      if (!to || v === '') return;
      if (to === '@id') s.id = v.slice(0, 40);
      else if (to === '@category') s.node = byName(v);
      else if (to === '@tags') s.tags = v;
      else if (to === '@expect') s.expect = v;
      else s.values[to] = v;
    });
    // Missing or duplicate ids become csv1, csv2 ... (never collide with existing samples); a missing category falls back
    // to the root node so the row still evaluates.
    if (!s.id || taken.has(s.id)) { let n = i + 1; while (taken.has('csv' + n)) n++; s.id = 'csv' + n; }
    taken.add(s.id);
    if (!s.node) s.node = P.tree[0]?.id || '';
    return s;
  });
  return { samples, columns };
}
