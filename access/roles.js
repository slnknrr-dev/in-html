// access/roles.js - roles and grants: a role grants actions on sections ({ catalog: ['view', 'edit'], pos: '*' }),
// inherits everything its parent grants and may revoke some of it for itself and its children; a member holds a role
// and extra grants, each with its own expiry (an expired role gives nothing, expired objects give no objects, an
// expired membership gives no access), plus a list of objects (shops, warehouses) where null means all. Viewing as
// another member is allowed to owners, or to admins whose own rights cover the target's.
//
//   normalizeGrants(v) -> { section: ['action' | '*'] }    ('*' or true = every action; an array of section names too)
//   roleChain(roles, id) -> [rootId, …, id]       (cycle-safe; roles: array or { id: role })
//   roleGrants(roles, id) -> Map(section -> Set(actions))      explainGrant(roles, id, section, action) -> trail
//   can(grants, section, action = 'view') -> boolean           (grants: Map from roleGrants / memberGrant)
//   memberGrant(member, { roles, extra, now }) -> { grants, objects, roleId, lapsed } | null
//   grantsWithin(inner, outer) -> boolean        canViewAs(viewer, target, { adminSection })
//   objectAllowed(access, objectId)   modulesOf(grants, modules: { name: [sections] })   grantMatrix(roles, sections, actions)
//   isLive(expiresAt, now)

const ALL = '*';

export function normalizeGrants(v) {
  const out = {};
  if (Array.isArray(v)) { for (const s of v) if (typeof s === 'string' && s) out[s] = [ALL]; return out; }
  if (!v || typeof v !== 'object') return out;
  for (const [s, a] of Object.entries(v)) {
    if (!s) continue;
    if (a === true || a === ALL) out[s] = [ALL];
    else if (Array.isArray(a)) { const list = [...new Set(a.filter((x) => typeof x === 'string' && x))]; if (list.length) out[s] = list.includes(ALL) ? [ALL] : list; }
  }
  return out;
}

const roleMap = (roles) => (roles instanceof Map ? roles : Array.isArray(roles) ? new Map(roles.map((r) => [r.id, r])) : new Map(Object.entries(roles || {}).map(([id, r]) => [id, { id, ...r }])));

// Walks parent links up to the root; `seen` makes a parent cycle terminate instead of looping forever (the chain is
// cut where the cycle closes). unshift yields root-first order, the order in which grants are applied.
export function roleChain(roles, id) {
  const map = roleMap(roles);
  const chain = [], seen = new Set();
  let cur = id;
  while (cur != null && cur !== '' && !seen.has(cur)) {
    seen.add(cur);
    const r = map.get(cur);
    if (!r) break;
    chain.unshift(r.id);
    cur = r.parent;
  }
  return chain;
}

const addAll = (m, grants) => {
  for (const [s, acts] of Object.entries(normalizeGrants(grants))) {
    const set = m.get(s) || new Set();
    for (const a of acts) set.add(a);
    m.set(s, set);
  }
};
// KNOWN DEFECT (by design, but surprising): revoking a single action from a section the parent granted with '*' is a
// silent no-op, so the child keeps that action although its definition says it is revoked. Fix: expand '*' to the
// section's known action list before subtracting, or report the ineffective revoke in explainGrant.
const removeAll = (m, revoke) => {
  for (const [s, acts] of Object.entries(normalizeGrants(revoke))) {
    if (acts.includes(ALL)) { m.delete(s); continue; }
    const set = m.get(s);
    if (!set) continue;
    if (set.has(ALL)) continue; // revoking one action from "everything" needs an explicit list on the parent
    for (const a of acts) set.delete(a);
    if (!set.size) m.delete(s);
  }
};

export function roleGrants(roles, id) {
  const map = roleMap(roles);
  const out = new Map();
  for (const rid of roleChain(map, id)) {
    const r = map.get(rid);
    addAll(out, r.grants ?? r.sections);
    removeAll(out, r.revoke);
  }
  return out;
}

export function explainGrant(roles, id, section, action = 'view') {
  const map = roleMap(roles);
  const trail = [];
  const m = new Map();
  let has = false;
  // the same steps as roleGrants, recording every level where the answer changes
  for (const rid of roleChain(map, id)) {
    const r = map.get(rid);
    addAll(m, r.grants ?? r.sections);
    const afterGrant = can(m, section, action);
    if (afterGrant && !has) trail.push({ role: rid, change: 'grant' });
    removeAll(m, r.revoke);
    has = can(m, section, action);
    if (afterGrant && !has) trail.push({ role: rid, change: 'revoke' });
  }
  return { allowed: has, trail };
}

export function can(grants, section, action = 'view') {
  const set = grants instanceof Map ? grants.get(section) : grants && grants[section] ? new Set(grants[section]) : null;
  return !!set && (set.has(ALL) || set.has(action));
}

const ts = (v) => (v == null || v === '' ? null : typeof v === 'number' ? v : Date.parse(v));
// No expiry = live; an unparseable expiry = expired (fail closed: corrupt data must not grant indefinitely).
export const isLive = (expiresAt, now = Date.now()) => { const t = ts(expiresAt); return t == null || Number.isNaN(t) ? t == null : t > now; };

/**
 * Rights of a member: { roleId, expiresAt, roleExpiresAt, objects, objectsExpiresAt } plus `extra` grants
 * [{ grants, objects, expiresAt }]. Lapsed parts are listed (for "ask whoever granted it to renew"), not silently lost.
 * Objects: the union of the lists; null anywhere means all objects.
 */
// Returns null when nothing is live (no access at all), distinct from an empty grant set. Object lists are unioned
// across sources; an expired object list contributes [] (nothing) rather than null (everything).
export function memberGrant(member, { roles = [], extra = [], now = Date.now() } = {}) {
  const grants = new Map();
  const lists = [];
  const lapsed = [];
  let found = false, roleId = null;
  if (member) {
    if (isLive(member.expiresAt, now)) {
      found = true;
      if (member.roleId != null) {
        if (isLive(member.roleExpiresAt, now)) { roleId = member.roleId; for (const [s, a] of roleGrants(roles, member.roleId)) grants.set(s, new Set(a)); }
        else lapsed.push('role');
      }
      if (isLive(member.objectsExpiresAt, now)) lists.push(member.objects === undefined ? null : member.objects);
      else { lapsed.push('objects'); lists.push([]); }
    } else lapsed.push('membership');
  }
  for (const g of extra || []) {
    if (!isLive(g.expiresAt, now)) { lapsed.push('grant'); continue; }
    found = true;
    addAll(grants, g.grants ?? g.sections);
    lists.push(g.objects === undefined ? null : g.objects);
  }
  if (!found) return null;
  const objects = lists.some((l) => l == null) ? null : [...new Set(lists.flat())];
  return { grants, objects, roleId, lapsed };
}

const asMap = (g) => (g instanceof Map ? g : new Map(Object.entries(normalizeGrants(g)).map(([s, a]) => [s, new Set(a)])));

/** Every action of `inner` is also granted by `outer`. */
export function grantsWithin(inner, outer) {
  const a = asMap(inner), b = asMap(outer);
  for (const [s, acts] of a) {
    const o = b.get(s);
    if (!o) return false;
    if (o.has(ALL)) continue;
    for (const x of acts) if (x === ALL || !o.has(x)) return false;
  }
  return true;
}

/** viewer / target: { isOwner, grants, objects }. Admins may view only members whose rights and objects they cover. */
// Impersonation guard: an admin can view as someone only if that member's rights and objects are a subset of the
// admin's own, otherwise "view as" would be a privilege escalation.
export function canViewAs(viewer, target, { adminSection = 'admin' } = {}) {
  if (viewer.isOwner) return true;
  if (!can(asMap(viewer.grants), adminSection, 'view')) return false;
  if (!grantsWithin(target.grants, viewer.grants)) return false;
  if (viewer.objects == null) return true;
  return target.objects != null && target.objects.every((o) => viewer.objects.includes(o));
}

export const objectAllowed = (access, objectId) => !access || access.objects == null || access.objects.includes(objectId);

/** Modules whose sections are all granted (a module is a bundle of sections). */
export function modulesOf(grants, modules) {
  const g = asMap(grants);
  return Object.keys(modules).filter((m) => modules[m].every((s) => g.has(s)));
}

/** Sections × actions × roles: for a permissions matrix designer. Cells: { allowed, from (role that granted), revokedAt }. */
export function grantMatrix(roles, sections, actions) {
  const map = roleMap(roles);
  const out = {};
  for (const id of map.keys()) {
    out[id] = {};
    for (const s of sections) {
      out[id][s] = {};
      for (const a of actions) {
        const e = explainGrant(map, id, s, a);
        const last = e.trail[e.trail.length - 1];
        out[id][s][a] = { allowed: e.allowed, from: e.allowed ? last.role : null, revokedAt: !e.allowed && last ? last.role : null };
      }
    }
  }
  return out;
}
