// contract/env.js - the evaluation scope of a template filled by a document: what a path in a placeholder or a
// condition means. Modifiers and levels by their ids, field values by field id (dotted ids and the parts of composite
// values: `tenant.name`, `term.end`, `schedule.total`), computed fields evaluated lazily with cycle detection, payment
// schedules computed from their term and amount. Every field read is recorded (`used`), so the fields panel can show
// exactly the fields the active text needs.
//
//   const env = createEnv(tpl, doc, { lang, today })
//   env.get(path) -> value (for contract/expr.js)    env.valueOf(fieldId)    env.used: Set of field ids
//   env.call(name, args) (words, money, fmtDate, plural, initials)       env.errors: [{ code, field?, msg }]
//   env.modifier(id) -> bool    env.level(id) -> option    env.snapshot() -> nested plain values (JS validators)
//   env.byId: Map id -> field   env.lang, env.main, env.today
import { evaluate, parseExpr } from './expr.js';
import { coerceValue, defaultValue, fieldById, resolvePath } from './fields.js';
import { formatDate, initials, moneyText, plural } from './format.js';
import { billingSchedule, termOf } from './period.js';
import { numberWords } from './words.js';

// Security note: paths come from template text (user-authored). Every property walk goes through own()/dig(), which
// read own properties only and refuse __proto__/constructor/prototype, so `{{x.constructor.constructor}}` cannot reach
// Function and a placeholder can only see data, never the object model. `length` is whitelisted for arrays only
// (list fields: `items.length` in conditions).
const own = (o, k) => (o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const BAD = new Set(['__proto__', 'constructor', 'prototype']);
function dig(v, sub) {
  if (!sub) return v;
  for (const k of sub.split('.')) {
    if (v == null || typeof v !== 'object' || BAD.has(k)) return null;
    if (Array.isArray(v) && k === 'length') { v = v.length; continue; }
    v = Object.prototype.hasOwnProperty.call(v, k) ? v[k] : null;
  }
  return v ?? null;
}

// Parse cache keyed by source text: the same placeholder/condition strings are re-evaluated on every keystroke
// (each render builds a fresh env). Crude bound: clear all at 1000 entries; an LRU would be fairer but the working
// set of one template is far below the bound, so the clear only matters across many templates in one session.
const exprCache = new Map();
function compiled(src) {
  let p = exprCache.get(src);
  if (!p) { p = parseExpr(src); if (exprCache.size > 1000) exprCache.clear(); exprCache.set(src, p); }
  return p;
}

// One env per render: `cache` memoizes field values for this document snapshot only, so there is no invalidation
// problem (a new keystroke builds a new env). `computing` is the DFS stack of in-progress computed/schedule fields;
// meeting an id already on it means a cycle.
export function createEnv(tpl, doc = {}, o = {}) {
  const byId = fieldById(tpl);
  const lang = o.lang || doc.lang || tpl.main;
  const today = o.today || '';
  const cache = new Map();
  const computing = new Set();
  const used = new Set();
  const errors = [];
  const mods = new Map(tpl.modifiers.map((m) => [m.id, m]));
  const levels = new Map(tpl.levels.map((l) => [l.id, l]));
  const values = doc.values || {};

  // Document values are validated against the template on read, not trusted: a modifier must be a real boolean, a
  // level must be one of its options, else the template default. A stale document (template changed since) degrades
  // to defaults instead of producing an impossible state.
  const modifier = (id) => { const v = own(doc.modifiers, id); return typeof v === 'boolean' ? v : !!mods.get(id)?.default; };
  const level = (id) => {
    const l = levels.get(id);
    const v = own(doc.levels, id);
    return l && l.options.some((x) => x.v === v) ? v : l ? l.default : null;
  };

  function raw(f) {
    const v = own(values, f.id);
    return v === undefined ? defaultValue(f, today) : coerceValue(f, v);
  }

  function valueOf(id) {
    if (cache.has(id)) return cache.get(id);
    const f = byId.get(id);
    if (!f) return null;
    let v;
    if (f.type === 'computed') {
      // Cycle: report and return null WITHOUT caching, so the field that closed the loop is not frozen as null for
      // readers outside the cycle; the outer evaluation still completes (fail soft, keep rendering).
      if (computing.has(id)) { errors.push({ code: 'cycle', field: id }); return null; }
      computing.add(id);
      const p = compiled(f.expr);
      if (p.error) errors.push({ code: 'expr', field: id, msg: p.error });
      v = p.ast ? evaluate(p.ast, { get, lang, today, call, onError: (m) => errors.push({ code: 'expr', field: id, msg: m }) }) : null;
      computing.delete(id);
      // A period exposes the computed term (end, last day, months, days) plus the raw input; an incomplete input
      // still yields an object with the same keys so `term.end` in a template prints empty rather than erroring.
    } else if (f.type === 'period') {
      const r = raw(f);
      const t = termOf(r);
      v = t ? { ...t, input: r } : { start: r.start, end: r.end || '', last: '', months: r.months, days: null, input: r };
    } else if (f.type === 'schedule') {
      if (computing.has(id)) { errors.push({ code: 'cycle', field: id }); return null; }
      computing.add(id);
      const set = raw(f);
      const term = get(f.term) || {};
      const p = compiled(f.amount);
      // NOTE: unlike computed fields, no onError here: evaluation errors in a schedule's amount expression are not
      // reported in env.errors, the schedule just gets amount null. A parse error (p.error) is dropped too.
      const amount = p.ast ? evaluate(p.ast, { get, lang, today, call }) : null;
      const r = billingSchedule({ start: term.start, months: term.input ? term.input.months : term.months, end: term.input ? term.input.end : term.end, anchorDay: set.anchorDay, amount, prorata: set.prorata, dueOffset: set.dueOffset });
      v = { ...r, amount, currency: f.currency, settings: set, first: r.periods[0] || null, lastPeriod: r.periods[r.periods.length - 1] || null };
      computing.delete(id);
    } else v = raw(f);
    cache.set(id, v);
    return v;
  }

  function get(path) {
    const p = String(path);
    const head = p.split('.')[0];
    // Resolution order: modifiers, levels, then fields. Ids share one namespace; a field named like a modifier is
    // shadowed. Modifiers/levels are scalars, so a dotted path under them is null rather than an error.
    if (mods.has(head)) return p === head ? modifier(head) : null;
    if (levels.has(head)) return p === head ? level(head) : null;
    const r = resolvePath(byId, p);
    if (r) { used.add(r.id); return dig(valueOf(r.id), r.sub); }
    // A namespace of dotted field ids ("tenant" with tenant.name, tenant.phone): an object of its fields.
    const kids = [...byId.keys()].filter((id) => id.startsWith(p + '.'));
    if (kids.length) {
      const out = {};
      for (const id of kids) { used.add(id); out[id.slice(p.length + 1)] = valueOf(id); }
      return out;
    }
    return null;
  }

  // Closed whitelist of functions available to template expressions. Language is bound from the env, not passed by
  // the template, so the same template text renders correctly in each contract language.
  function call(name, a) {
    switch (name) {
      case 'words': return numberWords(a[0], lang, a[1] || 'm');
      case 'money': return moneyText(a[0], { lang, currency: a[1] || 'RUB', words: a[2] !== false });
      case 'fmtDate': return formatDate(a[0], lang, a[1] || 'long');
      case 'plural': return plural(lang, a[0], a.slice(1));
      case 'initials': return initials(a[0], lang);
    }
    return null;
  }

  // Nested plain values of every field (computed ones included), the modifiers and the levels.
  function snapshot() {
    const out = {};
    for (const id of byId.keys()) {
      const parts = id.split('.');
      let o = out;
      for (let i = 0; i < parts.length - 1; i++) {
        if (o[parts[i]] == null || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
        o = o[parts[i]];
      }
      const v = valueOf(id);
      // Deep copy through JSON: the snapshot goes to a Worker (structured clone) and to user validator code; a copy
      // guarantees the validator cannot mutate the env's cache. Also drops undefined/functions.
      // KNOWN DEFECT: if both a field 'a' and a dotted field 'a.b' exist, whichever comes later in byId order wins:
      // 'a' after 'a.b' overwrites the namespace object, 'a.b' after 'a' replaces the scalar. Fix: reject such id
      // pairs in template validation, or store scalars of namespaces under a reserved key.
      o[parts[parts.length - 1]] = v == null ? null : JSON.parse(JSON.stringify(v));
    }
    return out;
  }

  return {
    get, valueOf, call, used, errors, byId, lang, main: tpl.main, today, modifier, level, snapshot,
    modifiers: () => Object.fromEntries(tpl.modifiers.map((m) => [m.id, modifier(m.id)])),
    levels: () => Object.fromEntries(tpl.levels.map((l) => [l.id, level(l.id)])),
  };
}
