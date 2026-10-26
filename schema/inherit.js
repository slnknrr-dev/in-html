// schema/inherit.js - schemas that are inherited down a category tree (root -> leaf): each level adds fields,
// overrides properties of inherited ones (an unset property inherits) or hides them, and every resulting field records
// where it came from (origin), where it was last changed (definedAt) and the trail of levels that touched it. Values
// set on a level (a model's defaults) are inherited the same way. On top of a resolved schema, an overlay lets a second
// party (an agency, a shop) relabel, reorder and hide fields and add its own - but never hide a required field and never
// take a key the schema already uses. Values of a building flow down to its units the same way, key by key.
//
//   resolveSchema(chain: [{ id, name, fields: [rawDef], values: { key: value } }]) ->
//       { chain: [{ id, name }], fields: [field + { origin, definedAt, overridden, trail }], values: { key: { value, from } },
//         hidden: [{ key, at }], errors: [{ at, key, errors }] }
//   normalizeOverlay(raw | json) -> { own: [field], over: [{ key, label, hint, hidden, sort }] }
//   applyOverlay(fields, overlay) -> fields       overlayRefused(fields, overlay) -> [{ key, why: 'required' | 'taken' }]
//   inheritValues(levels: [{ id, values }]) -> { values, from }   (a key absent = inherit, present (even null) = override)
//   mergeByKey(lists) -> the last definition of every key, in first-seen order

//
// Model choice: partial definitions with null = "inherit" (see fields.js normalizeFieldDef) merged root to leaf, like
// CSS cascade by depth. Alternative rejected: copying full fields into each level, which freezes a child at the
// parent's state of the day it was created and makes parent edits invisible below.
// Provenance (origin / definedAt / trail) is kept because an inherited form is otherwise undebuggable: "why is this
// field required here?" must have an answer naming the level.
import { normalizeField, normalizeFieldDef, sortFields } from './fields.js';
import { cleanFieldKey, i18n } from './text.js';

// One pass over the chain; a Map keeps first-insertion order, so an inherited field keeps its position even when a
// lower level overrides it. Hiding deletes from the map: a lower level can re-add the key as a fresh field.
// Invalid definitions are collected in errors (with level and key) instead of throwing: one bad level must not take
// down every form beneath it.
export function resolveSchema(chain, opts = {}) {
  const fields = new Map();
  const values = {};
  const hidden = [];
  const errors = [];
  for (const node of chain) {
    for (const raw of node.fields || []) {
      const { def, errors: errs } = normalizeFieldDef(raw, { inherited: new Set(fields.keys()), types: opts.types });
      if (!def) { errors.push({ at: node.id, key: raw && raw.key, errors: errs }); continue; }
      if (def.hidden) { if (fields.delete(def.key)) hidden.push({ key: def.key, at: node.id }); continue; }
      const base = fields.get(def.key);
      const merged = { ...(base || {}) };
      const set = [];
      for (const [k, v] of Object.entries(def)) if (v != null && k !== 'hidden' && k !== 'key') { merged[k] = v; set.push(k); }
      merged.key = def.key;
      merged.origin = base ? base.origin : node.id;
      merged.definedAt = node.id;
      merged.overridden = !!base;
      merged.trail = [...(base ? base.trail : []), { at: node.id, set }];
      fields.set(def.key, merged);
    }
    for (const [k, v] of Object.entries(node.values || {})) values[k] = { value: v, from: node.id };
  }
  // Final normalizeField fills defaults for everything no level set; provenance is re-attached because
  // normalizeField returns only the field contract.
  const list = [...fields.values()].map((m) => ({ ...normalizeField(m), origin: m.origin, definedAt: m.definedAt, overridden: m.overridden, trail: m.trail }));
  return { chain: chain.map((n) => ({ id: n.id, name: n.name })), fields: sortFields(list), values, hidden, errors };
}

// --- overlay ------------------------------------------------------------------------------------------------------

// Caps (40 own fields, 200 overrides) bound a stored overlay coming from an untrusted second party.
export function normalizeOverlay(raw) {
  let r = raw;
  if (typeof r === 'string') { try { r = JSON.parse(r || '{}'); } catch { r = {}; } }
  if (!r || typeof r !== 'object') return { own: [], over: [] };
  const own = [], seen = new Set();
  for (const x of (Array.isArray(r.own) ? r.own : []).slice(0, 40)) {
    // own fields are plain fields of the form only: they take no part in filters or computed values
    const f = normalizeField({ ...(x && typeof x === 'object' ? x : {}), roles: ['form', 'card'], computed: '' });
    if (!f || seen.has(f.key)) continue;
    seen.add(f.key); own.push(f);
  }
  const over = [], seenOver = new Set();
  for (const x of (Array.isArray(r.over) ? r.over : []).slice(0, 200)) {
    const key = cleanFieldKey(x && x.key);
    if (!key || seenOver.has(key)) continue;
    seenOver.add(key);
    over.push({ key, label: i18n(x.label ?? x.name), hint: i18n(x.hint), hidden: !!x.hidden, sort: Number.isFinite(+x.sort) ? +x.sort : 0 });
  }
  return { own, over };
}

/**
 * Applied at display time, not at save time: when the schema later makes a field required, hiding it stops working
 * at once, everywhere. Empty labels do not override ("not touched", not "make nameless"). A required field of the
 * schema cannot be hidden; an own field whose key the schema already uses is dropped (one key, one meaning).
 */
export function applyOverlay(fields, overlay) {
  if (!overlay || (!overlay.own.length && !overlay.over.length)) return sortFields(fields);
  const by = new Map(overlay.over.map((o) => [o.key, o]));
  const out = [], taken = new Set();
  for (const f of fields) {
    taken.add(f.key);
    const o = by.get(f.key);
    if (!o) { out.push(f); continue; }
    if (o.hidden && !f.required) continue;
    out.push({ ...f, label: Object.keys(o.label).length ? o.label : f.label, hint: Object.keys(o.hint).length ? o.hint : f.hint, sort: o.sort || f.sort });
  }
  for (const f of overlay.own) if (!taken.has(f.key)) out.push(f);
  return sortFields(out);
}

/** What of an overlay does not take effect (for the settings screen: a refusal that is not explained looks broken). */
export function overlayRefused(fields, overlay) {
  if (!overlay) return [];
  const by = new Map(fields.map((f) => [f.key, f]));
  const out = [];
  for (const o of overlay.over) if (o.hidden && by.get(o.key)?.required) out.push({ key: o.key, why: 'required' });
  for (const f of overlay.own) if (by.has(f.key)) out.push({ key: f.key, why: 'taken' });
  return out;
}

// --- values down a hierarchy --------------------------------------------------------------------------------------

// Three states per key, which a plain Object.assign cannot express: absent (inherit), null (cleared here: removes the
// inherited value), value (override). The trailing loop drops provenance of cleared keys.
export function inheritValues(levels) {
  const values = {}, from = {};
  for (const l of levels) {
    for (const [k, v] of Object.entries(l.values || {})) {
      if (v === undefined) continue;
      if (v === null) { delete values[k]; from[k] = l.id; continue; } // explicitly cleared at this level
      values[k] = v; from[k] = l.id;
    }
  }
  for (const k of Object.keys(from)) if (!(k in values)) delete from[k];
  return { values, from };
}

/** Definitions collected root -> leaf: a repeated key is inheritance, the nearest level wins. */
export function mergeByKey(lists, key = (x) => x.key) {
  const by = new Map();
  for (const list of lists) for (const x of list || []) { const k = key(x); if (k) by.set(k, x); }
  return [...by.values()];
}
