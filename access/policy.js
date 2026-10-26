// access/policy.js - data visibility and editing policy with modes and an explanation of every decision. Modes:
// open (sees and edits everything), medium (sees everything, edits own records), closed (sees and edits own records).
// "Own" means the user is named in one of the entity's own-fields (author, responsible, seller…). The cascade runs
// organisation -> roles from root to leaf -> member: the nearest level that sets a mode wins, and action overrides
// ('receipts.edit': 'all' | 'own', 'sidebar.edit': 'allow' | 'deny') apply on top of it from that level down - a mode
// set lower resets the overrides above it. Every rule remembers the level that decided it.
//
//   MODES, MODE_RULES, DEFAULT_MODE
//   definePolicy({ entities: { name: { own: [fields] } }, permissions: { key: { open, medium, closed } }, defaultMode })
//       -> model { entities, permissions, actions, overrideValues(key) }
//   resolvePolicy(model, levels: [{ scope, id, label, mode, overrides }]) -> { mode, modeFrom, rules: { key: { value,
//       from } }, chain }      (from: 'default' | 'mode' | the level object)
//   explainRule(resolved, key) -> [{ level, mode, override, decided }]   a readable trace of one rule
//   policyAccess(model, resolved, { ref, exempt }) -> access
//   isOwn(access, entity, row)  canView(access, entity, row)  canEdit(access, entity, row)  allowed(access, key)
//   filterVisible(access, entity, rows)

export const MODES = ['open', 'medium', 'closed'];
export const DEFAULT_MODE = 'medium';
export const MODE_RULES = {
  open: { view: 'all', edit: 'all' },
  medium: { view: 'all', edit: 'own' },
  closed: { view: 'own', edit: 'own' },
};

export function definePolicy({ entities = {}, permissions = {}, defaultMode = DEFAULT_MODE } = {}) {
  const actions = Object.keys(entities).flatMap((e) => [`${e}.view`, `${e}.edit`]);
  return {
    entities, permissions, actions, defaultMode: MODES.includes(defaultMode) ? defaultMode : DEFAULT_MODE,
    overrideValues: (key) => (permissions[key] ? ['allow', 'deny'] : actions.includes(key) ? ['all', 'own'] : null),
  };
}

// Two passes: first find the nearest (last) level that sets a mode, then apply action overrides only from that level
// down. Overrides above a lower mode are discarded, so a member-level 'closed' cannot be undone by a role-level
// 'edit: all' set higher up. Overrides are validated against the values the key accepts.
export function resolvePolicy(model, levels = []) {
  const chain = levels.map((l) => ({ ...l, mode: MODES.includes(l.mode) ? l.mode : null, overrides: l.overrides && typeof l.overrides === 'object' ? l.overrides : {} }));
  let mode = model.defaultMode, modeFrom = 'default', modeIdx = -1;
  chain.forEach((l, i) => { if (l.mode) { mode = l.mode; modeFrom = l; modeIdx = i; } });
  const rules = {};
  for (const e of Object.keys(model.entities)) for (const k of ['view', 'edit']) rules[`${e}.${k}`] = { value: MODE_RULES[mode][k], from: 'mode' };
  for (const [k, byMode] of Object.entries(model.permissions)) rules[k] = { value: byMode[mode], from: 'mode' };
  chain.forEach((l, i) => {
    if (i < modeIdx) return; // a mode set lower down resets the overrides above it
    for (const [act, v] of Object.entries(l.overrides)) if (rules[act] && model.overrideValues(act)?.includes(v)) rules[act] = { value: v, from: l };
  });
  return { mode, modeFrom, rules, chain };
}

export function explainRule(resolved, key) {
  const modeIdx = resolved.modeFrom === 'default' ? -1 : resolved.chain.indexOf(resolved.modeFrom);
  const rule = resolved.rules[key];
  const out = [{ level: 'default', mode: resolved.modeFrom === 'default' ? resolved.mode : null, override: null, decided: rule && rule.from === 'mode' && resolved.modeFrom === 'default' }];
  resolved.chain.forEach((l, i) => {
    const ov = Object.prototype.hasOwnProperty.call(l.overrides, key) ? l.overrides[key] : null;
    out.push({
      level: l.label || `${l.scope}${l.id != null ? ':' + l.id : ''}`, mode: l.mode, override: ov,
      ignored: ov != null && i < modeIdx,
      decided: !!rule && (rule.from === l || (rule.from === 'mode' && resolved.modeFrom === l)),
    });
  });
  return out;
}

export function policyAccess(model, resolved, { ref = null, exempt = false } = {}) {
  return { model, ref, exempt: !!exempt, rules: resolved ? Object.fromEntries(Object.entries(resolved.rules).map(([k, v]) => [k, v.value])) : {} };
}

// Strict equality between the row's own-field and the user ref: callers must use one id type consistently (a numeric
// 7 and a string '7' do not match, which fails closed).
export const isOwn = (a, entity, row) => !!a.ref && (a.model.entities[entity]?.own || []).some((f) => row && row[f] != null && row[f] === a.ref);
export const allowed = (a, key) => a.exempt || a.rules[key] === 'allow';
export const canView = (a, entity, row) => a.exempt || a.rules[`${entity}.view`] === 'all' || isOwn(a, entity, row);
// Editing requires visibility too: a rule 'edit: all' never lets a user edit a record they are not allowed to see.
export function canEdit(a, entity, row) {
  if (a.exempt) return true;
  const own = isOwn(a, entity, row);
  return (a.rules[`${entity}.view`] === 'all' || own) && (a.rules[`${entity}.edit`] === 'all' || own);
}
export const filterVisible = (a, entity, rows) => rows.filter((r) => canView(a, entity, r));
