// access/scope.js - session scopes: a mask over the rights of a user, so that
//     effective rights = user rights ∩ session scope
// A scope never adds a right; revoking a user's right takes effect in every session at once. Three axes: panel
// groups the session may open (null = all the user has; a group that cannot be switched off is always added), named
// rights it drops (a drop list, so a right added later is visible and droppable), and read-only (writes refused except
// an allowlist: signing out and narrowing must still work). Narrowing is one-way: a session may only move to a scope
// within its own (a ticket or QR issued from a narrowed session is never wider than it). Lifetime: an absolute expiry
// and an optional idle timeout; polling paths do not count as activity.
//
//   createScopeModel({ rights, groups, always, readonlyAllow, idlePaths, idlePolls }) -> model
//   FULL_SCOPE   normalizeScope(raw, model)   parseScope(json, model)   scopeText(scope)   isFullScope(scope)
//   scopeWithin(inner, outer)   scopeIntersect(a, b, model)   scopeAllowsGroup(scope, group, model)   scopeDrops(scope, right)
//   scopeAllowsWrite(scope, method, path, model)   applyScope(rights, scope)   effectiveRights(rights, scope) -> [names]
//   cleanTtlDays(v, capDays)  cleanIdleSec(v)  sessionAlive(now, expiresAt, idleSec, seenAt, createdAt)
//   shouldTouchSeen(now, seenAt, idleSec)   isIdleSilent(path, search, model)   TTL_CHOICES  IDLE_CHOICES

export const FULL_SCOPE = Object.freeze({ panel: null, drop: Object.freeze([]), readonly: false });

export function createScopeModel({ rights = [], groups = [], always = null, readonlyAllow = [], idlePaths = [], idlePolls = [] } = {}) {
  return { rights: new Set(rights), groups: new Set(groups), groupList: [...groups], always, readonlyAllow: [...readonlyAllow], idlePaths: [...idlePaths], idlePolls: [...idlePolls] };
}

const uniqSorted = (xs) => [...new Set(xs)].sort();

/** Input of an anonymous request: unknown rights and groups are dropped silently (narrowing is always safe). */
// Selecting every group is stored as null ("no restriction"): a group added to the product later is then available,
// instead of being locked out by an old explicit list.
export function normalizeScope(raw, model) {
  const r = raw && typeof raw === 'object' ? raw : {};
  let panel = null;
  if (Array.isArray(r.panel)) {
    panel = uniqSorted([...r.panel.map((x) => String(x ?? '')).filter((x) => model.groups.has(x)), ...(model.always ? [model.always] : [])]);
    // everything chosen is no restriction: stored as null, so a group added later is not locked out
    if (panel.length >= model.groups.size + (model.always && !model.groups.has(model.always) ? 1 : 0)) panel = null;
  }
  const drop = Array.isArray(r.drop) ? uniqSorted(r.drop.map((x) => String(x ?? '')).filter((x) => model.rights.has(x))) : [];
  return { panel, drop, readonly: !!r.readonly };
}

/** Stored scope: '' (or broken JSON) is the full scope - sessions created before scopes existed keep working. */
export function parseScope(json, model) {
  const s = String(json ?? '').trim();
  if (!s) return FULL_SCOPE;
  try { return normalizeScope(JSON.parse(s), model); } catch { return FULL_SCOPE; }
}

export const isFullScope = (s) => s.panel === null && s.drop.length === 0 && !s.readonly;
export const scopeText = (s) => (isFullScope(s) ? '' : JSON.stringify({ panel: s.panel, drop: s.drop, readonly: s.readonly }));

/**
 * inner ⊆ outer. panel: null is wider than any list; drop: the inner scope must drop at least what the outer drops
 * (a superset - the opposite direction of panel); readonly: may be set, never cleared.
 */
export function scopeWithin(inner, outer) {
  if (outer.panel !== null) {
    if (inner.panel === null) return false;
    if (inner.panel.some((g) => !outer.panel.includes(g))) return false;
  }
  if (outer.drop.some((r) => !inner.drop.includes(r))) return false;
  if (outer.readonly && !inner.readonly) return false;
  return true;
}

// Intersection of masks: panels intersect, drop lists union, readonly ORs. This is how a ticket issued from a narrowed
// session stays at most as wide as that session.
export function scopeIntersect(a, b, model) {
  const panel = a.panel === null ? b.panel : b.panel === null ? a.panel : a.panel.filter((g) => b.panel.includes(g));
  return {
    panel: panel === null ? null : uniqSorted([...panel, ...(model && model.always ? [model.always] : [])]),
    drop: uniqSorted([...a.drop, ...b.drop]),
    readonly: a.readonly || b.readonly,
  };
}

export function scopeAllowsGroup(s, group, model) {
  const g = String(group || '').replace(/^grp-/, '');
  if (model && g === model.always) return true;
  return s.panel === null || s.panel.includes(g);
}

export const scopeDrops = (s, right) => s.drop.includes(right);

// Read-only by HTTP method: safe methods pass, writes need an allowlisted path prefix (sign-out, narrowing).
export function scopeAllowsWrite(s, method, path, model) {
  if (!s.readonly) return true;
  const m = String(method || 'GET').toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return true;
  const p = String(path || '');
  return (model ? model.readonlyAllow : []).some((a) => p === a || p.startsWith(a + '/'));
}

/** The only place the intersection is computed: rights { name: boolean } with the dropped ones switched off. */
export function applyScope(rights, s) {
  if (!s.drop.length) return rights;
  const out = { ...rights };
  for (const r of s.drop) if (r in out) out[r] = false;
  return out;
}
export function effectiveRights(rights, s) {
  const e = applyScope(rights, s);
  return Object.keys(e).filter((k) => e[k]).sort();
}

export const TTL_CHOICES = [{ k: '1h', days: 1 / 24 }, { k: '8h', days: 8 / 24 }, { k: '1d', days: 1 }, { k: '30d', days: 30 }];
export const IDLE_CHOICES = [{ k: '0', sec: 0 }, { k: '15m', sec: 900 }, { k: '1h', sec: 3600 }, { k: '8h', sec: 28800 }];

export function cleanTtlDays(v, capDays) {
  const known = TTL_CHOICES.find((t) => t.k === String(v ?? ''));
  const raw = known ? known.days : Number(v);
  const days = Number.isFinite(raw) && raw > 0 ? raw : capDays;
  return capDays > 0 ? Math.min(days, capDays) : days;
}

export function cleanIdleSec(v) {
  const known = IDLE_CHOICES.find((t) => t.k === String(v ?? ''));
  const raw = known ? known.sec : Number(v);
  return Math.min(Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 0, 30 * 86400);
}

/** Alive while now < expiresAt and (no idle timeout or activity within it); an empty seenAt counts from creation. */
// Unparseable expiry = dead (fail closed); unparseable last-seen with an idle timeout = alive, because the absolute
// expiry still bounds the session.
export function sessionAlive(now, expiresAt, idleSec, seenAt = '', createdAt = '') {
  const exp = typeof expiresAt === 'number' ? expiresAt : Date.parse(expiresAt);
  if (!Number.isFinite(exp) || now >= exp) return false;
  if (!idleSec) return true;
  const last = typeof (seenAt || createdAt) === 'number' ? seenAt || createdAt : Date.parse(seenAt || createdAt);
  if (!Number.isFinite(last)) return true;
  return now - last < idleSec * 1000;
}

/** Record activity at most once a minute (or a tenth of the idle timeout): reads must not turn into writes. */
export function shouldTouchSeen(now, seenAt, idleSec) {
  const last = typeof seenAt === 'number' ? seenAt : Date.parse(seenAt || '');
  if (!Number.isFinite(last)) return true;
  return now - last >= Math.min(idleSec > 0 ? (idleSec * 1000) / 10 : 60000, 60000);
}

/**
 * Polling is not activity, or an open tab would keep itself alive forever. A poll is a path (exact or a prefix with
 * '/'), or a path + query parameter pair ({ path: string | RegExp, param, value? }) when the same path is also a user
 * action with other parameters.
 */
export function isIdleSilent(path, search = '', model = null) {
  const p = String(path || '');
  const paths = model ? model.idlePaths : [];
  if (paths.some((a) => p === a || p.startsWith(a + '/'))) return true;
  if (!search || !model) return false;
  let q;
  try { q = new URLSearchParams(String(search)); } catch { return false; }
  return model.idlePolls.some((x) => (typeof x.path === 'string' ? x.path === p : x.path.test(p)) && (x.value === undefined ? q.has(x.param) : q.get(x.param) === x.value));
}
