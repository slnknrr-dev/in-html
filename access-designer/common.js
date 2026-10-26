// access-designer/common.js - shared parts of the five pages: the shell (pages resolved from the hidden anchors of the
// page HTML, so the build can rewrite them), app icons, the project (one JSON object in localStorage, migrated from older
// formats; the retail system demo from presets.js when nothing is stored), labels of roles / sections / actions / modules, the bridges from the
// project to the access/ library (role list, member access at the simulated date, policy levels, module view levels,
// the session scope model) and small widgets.
//
// Design rules of this module:
// - The access/ library is the authority on every decision (grants, inheritance, policy modes, module views, session
//   scope); this module only converts the editable project into the library's input shapes. The designer can then
//   never disagree with the runtime that uses the same library.
// - Labels: a user-typed name wins; seeded items carry an i18n key instead, so the demo follows the UI language
//   until the user renames something.
import './strings.js';
import { startApp, t } from '../ui/app.js';
import { h, lsGet, lsSet } from '../ui/dom.js';
import { ED_I18N } from '../ui/i18n.js';
import { addIcons, iconEl } from '../ui/icons.js';
import { memberGrant, normalizeGrants, roleChain } from '../access/roles.js';
import { definePolicy } from '../access/policy.js';
import { createScopeModel } from '../access/scope.js';
import { MODES } from '../access/policy.js';
import { VIEWS } from '../access/modules.js';
import { FORMAT, PRESETS, VERSION, buildProject, emptySpec } from './presets.js';

export const LOGO = 'M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6zM12 10.5v3.5M10.5 9.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0';

addIcons({
  shieldKey: LOGO,
  role: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  tree: 'M12 3v5M6 13v-2h12v2M6 13v3M18 13v3M12 8v3M4 16h4v4H4zM16 16h4v4h-4zM10 3h4v5h-4z',
  module: 'M4 7l8-4 8 4-8 4zM4 7v10l8 4M20 7v10l-8 4M12 11v10',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  revoke: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM5 5l14 14',
  inherit: 'M7 4v10a4 4 0 0 0 4 4h8M15 14l4 4-4 4',
  ok: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8 12l3 3 5-6',
});

// Resolved hrefs of the pages (hidden anchors in the page HTML; the build rewrites their href).
export function pageHref(id) {
  const a = document.getElementById(id);
  return a ? a.getAttribute('href') : '#';
}
export const PAGES = ['roles', 'policies', 'modules', 'sessions', 'config'];

export function startShell(current, onLang) {
  startApp({
    key: 'ad', name: 'ad.name', logo: LOGO, offline: true, onLang,
    pages: PAGES.map((p) => ({ href: pageHref('pg-' + p), label: 'ad.page.' + p, current: current === p })),
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The project (localStorage 'ad-project', the key of every format version)

// One key for every format version: the format/version fields inside the object drive migration, so an old
// browser profile upgrades in place instead of losing data.
const KEY = 'ad-project';
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const strs = (v) => (Array.isArray(v) ? [...new Set(v.map(str).filter(Boolean))] : []);
const named = (o, id) => ({ id: str(id), name: str(o && o.name), key: str(o && o.key) });
const TYPES = ['string', 'number', 'bool', 'list', 'object'];
export const CONFIG_TYPES = TYPES;

/**
 * Format 1 (the first release) stored names only when renamed, labels came from fixed dictionary prefixes, and the
 * module names, the config keys, the view-as section and the action path were fixed in code: they are written into
 * the project here, from the retail preset that format 1 always described.
 */
function migrate1(raw) {
  const ref = buildProject(PRESETS.retail);
  const p = { ...raw, version: VERSION, preset: 'retail' };
  const k = (prefix, id, o) => ({ ...o, id, name: str(o && o.name), key: o && o.name ? '' : prefix + id });
  p.sections = (raw.sections || []).filter(isObj).map((s) => k('ad.sec.', s.id, s));
  p.roles = (raw.roles || []).filter(isObj).map((r) => k('ad.role.', r.id, r));
  const acts = strs(raw.actions);
  p.actions = acts;
  p.actionInfo = Object.fromEntries(acts.map((a) => [a, ref.actionInfo[a] || { name: '', key: 'ad.act.' + a, icon: '' }]));
  p.readAction = 'view'; p.viewAsSection = 'admin';
  const pol = raw.policy || {};
  p.policy = { ...pol,
    entities: Object.fromEntries(Object.entries(pol.entities || {}).map(([id, e]) => [id, { name: '', key: 'ad.ent.' + id, own: strs(e && e.own) }])),
    permissions: Object.fromEntries(Object.entries(pol.permissions || {}).map(([id, v]) => [id, { name: '', key: 'ad.perm.' + id, ...v }])) };
  const mods = raw.modules || {};
  p.modules = { ...mods, catalog: Object.fromEntries(Object.entries(mods.catalog || {}).map(([id, m]) => [id, { name: ref.modules.catalog[id]?.name || id, key: '', purpose: '', purposeKey: 'ad.mod.' + id, ...m }])) };
  p.sessions = { ...ref.sessions, ...(raw.sessions || {}), actionPath: '/catalog' };
  p.config = { ...ref.config, ...(raw.config || {}), schema: ref.config.schema };
  return p;
}

/** A loaded or imported project of any format version, migrated and checked; null when it is not one. */
// Whitelist normalisation of any stored or imported object: unknown fields are dropped, enums are checked against
// the library's constants (MODES, VIEWS), references are filtered to existing ids, and missing parts come from an
// empty base project. Returns null for objects of a different format so an import can refuse foreign JSON.
// '*' is not a real action (it is the wildcard), entity ids may not contain '.', because rule names are
// "<entity>.<verb>" and a dot would make them ambiguous.
export function normalizeProject(input) {
  if (!isObj(input) || input.format !== FORMAT) return null;
  const raw = (input.version || 1) < 2 ? migrate1(input) : input;
  const base = buildProject(emptySpec(''));
  const p = { ...base, preset: str(raw.preset), name: str(raw.name) };
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.now || '')) p.now = raw.now;
  p.actions = strs(raw.actions).filter((a) => a !== '*');
  if (!p.actions.length) p.actions = [...base.actions];
  const ai = isObj(raw.actionInfo) ? raw.actionInfo : {};
  p.actionInfo = Object.fromEntries(p.actions.map((a) => [a, { name: str(ai[a]?.name), key: str(ai[a]?.key), icon: str(ai[a]?.icon) }]));
  p.readAction = p.actions.includes(raw.readAction) ? raw.readAction : p.actions[0];
  p.sections = (Array.isArray(raw.sections) ? raw.sections : []).filter((s) => isObj(s) && s.id).map((s) => named(s, s.id));
  p.viewAsSection = p.sections.some((s) => s.id === raw.viewAsSection) ? raw.viewAsSection : '';
  p.objects = (Array.isArray(raw.objects) ? raw.objects : []).filter((o) => isObj(o) && o.id).map((o) => ({ id: str(o.id), name: str(o.name) }));
  p.roles = (Array.isArray(raw.roles) ? raw.roles : []).filter((r) => isObj(r) && r.id).map((r) => ({ ...named(r, r.id), parent: r.parent ? str(r.parent) : null, grants: normalizeGrants(r.grants), revoke: normalizeGrants(r.revoke) }));
  if (!p.roles.length) p.roles = base.roles;
  p.members = (Array.isArray(raw.members) ? raw.members : []).filter((m) => isObj(m) && m.id).map((m) => ({
    id: str(m.id), name: str(m.name), roleId: m.roleId ? str(m.roleId) : null, isOwner: !!m.isOwner,
    objects: Array.isArray(m.objects) ? m.objects.map(str) : null,
    expiresAt: str(m.expiresAt), roleExpiresAt: str(m.roleExpiresAt), objectsExpiresAt: str(m.objectsExpiresAt),
    extra: Array.isArray(m.extra) ? m.extra.filter(isObj).map((g) => ({ grants: normalizeGrants(g.grants), objects: Array.isArray(g.objects) ? g.objects.map(str) : null, expiresAt: str(g.expiresAt) })) : [],
  }));
  const pol = isObj(raw.policy) ? raw.policy : {};
  const lvl = (v) => (isObj(v) ? { mode: MODES.includes(v.mode) ? v.mode : null, overrides: isObj(v.overrides) ? { ...v.overrides } : {} } : { mode: null, overrides: {} });
  const bag = (o) => Object.fromEntries(Object.entries(isObj(o) ? o : {}).map(([k, v]) => [k, lvl(v)]));
  p.policy = {
    entities: Object.fromEntries(Object.entries(isObj(pol.entities) ? pol.entities : {}).filter(([id]) => id && !id.includes('.')).map(([id, e]) => [id, { ...named(e, id), own: strs(e && e.own) }])),
    permissions: Object.fromEntries(Object.entries(isObj(pol.permissions) ? pol.permissions : {}).filter(([, v]) => isObj(v)).map(([id, v]) => [id, { ...named(v, id), ...Object.fromEntries(MODES.map((m) => [m, v[m] === 'allow' ? 'allow' : 'deny'])) }])),
    org: { ...lvl(pol.org), mode: lvl(pol.org).mode || 'medium' }, roles: bag(pol.roles), members: bag(pol.members),
    records: (Array.isArray(pol.records) ? pol.records : []).filter((r) => isObj(r) && r.entity && r.id),
  };
  for (const e of Object.values(p.policy.entities)) delete e.id;
  for (const v of Object.values(p.policy.permissions)) delete v.id;
  const mods = isObj(raw.modules) ? raw.modules : {};
  const cat = {};
  for (const [id, m] of Object.entries(isObj(mods.catalog) ? mods.catalog : {})) {
    if (!isObj(m)) continue;
    const views = strs(m.views).filter((v) => VIEWS.includes(v));
    cat[id] = { name: str(m.name), key: str(m.key), purpose: str(m.purpose), purposeKey: str(m.purposeKey), sections: strs(m.sections), deps: strs(m.deps), carriers: strs(m.carriers),
      views: views.length ? views : [...VIEWS], default: VIEWS.includes(m.default) ? m.default : 'standalone', embeds: strs(m.embeds) };
  }
  const viewBag = (o) => Object.fromEntries(Object.entries(isObj(o) ? o : {}).filter(([, v]) => isObj(v)).map(([k, v]) => [k, { ...v }]));
  p.modules = { catalog: cat, enabled: strs(mods.enabled).filter((m) => cat[m]), org: isObj(mods.org) ? { ...mods.org } : {}, roles: viewBag(mods.roles), members: viewBag(mods.members) };
  p.sessions = { ...base.sessions, ...(isObj(raw.sessions) ? raw.sessions : {}) };
  const c = isObj(raw.config) ? raw.config : {};
  p.config = {
    schema: (Array.isArray(c.schema) ? c.schema : []).filter((x) => isObj(x) && x.key).map((x) => ({ key: str(x.key), type: TYPES.includes(x.type) ? x.type : 'string', secret: !!x.secret })),
    defaults: isObj(c.defaults) ? c.defaults : {}, site: isObj(c.site) ? c.site : {},
    hosts: (Array.isArray(c.hosts) ? c.hosts : []).filter(isObj).map((r) => ({ host: str(r.host), enabled: r.enabled !== false, isPrimary: !!r.isPrimary, aliases: strs(r.aliases), values: isObj(r.values) ? r.values : {} })),
    probe: str(c.probe),
  };
  return p;
}

export const presetProject = (id) => normalizeProject(id === 'empty' || !PRESETS[id] ? buildProject(emptySpec(t('ad.pr.ownerName'))) : buildProject(PRESETS[id]));
export const freshProject = () => presetProject('retail');
// P is a live binding shared by every module of the page: replaceProject mutates it in place (delete keys, assign)
// instead of rebinding, because other modules imported the object reference, not the variable.
export const P = normalizeProject(lsGet(KEY, null)) || freshProject();
export const save = () => lsSet(KEY, P);
export function replaceProject(next) {
  for (const k of Object.keys(P)) delete P[k];
  Object.assign(P, next);
  save();
}

// The simulated date of the project (expiries of members and grants are checked at it).
// Simulated date at noon UTC: noon keeps the same calendar day in every time zone from UTC-12 to UTC+12, so date-only
// expiries compare the same everywhere.
export const nowMs = () => Date.parse(P.now + 'T12:00:00Z');

// ---------------------------------------------------------------------------------------------------------------
// Labels: a user-entered `name` (plain text), else the dictionary `key` of a seeded item, else the id.

// A dictionary key is used only if it exists in the English reference; otherwise a stale key would render as a
// humanised key name. Falls back to the id.
export const labelOf = (o, fallback) => (o && o.name) || (o && o.key && ED_I18N.en[o.key] != null ? t(o.key) : fallback);

export const roleById = (id) => P.roles.find((r) => r.id === id) || null;
export const memberById = (id) => P.members.find((m) => m.id === id) || null;
export const roleLabel = (id) => labelOf(roleById(id), id || '—');
export const secLabel = (id) => labelOf(P.sections.find((x) => x.id === id), id);
export const actLabel = (a) => labelOf(P.actionInfo[a], a);
export const actIcon = (a) => (P.actionInfo[a] && P.actionInfo[a].icon) || '';
export const modLabel = (id) => labelOf(P.modules.catalog[id], id);
export const modPurpose = (id) => { const m = P.modules.catalog[id]; return m ? m.purpose || (m.purposeKey && ED_I18N.en[m.purposeKey] != null ? t(m.purposeKey) : '') : ''; };
export const entLabel = (e) => labelOf(P.policy.entities[e], e);
export const permLabel = (k) => labelOf(P.policy.permissions[k], k);
// Entity rules of the policy library are '<entity>.view' and '<entity>.edit' (its two fixed verbs).
export const ruleLabel = (k) => { const i = k.lastIndexOf('.'); const e = k.slice(0, i), a = k.slice(i + 1); return P.policy.entities[e] && (a === 'view' || a === 'edit') ? `${entLabel(e)} · ${t('ad.rule.' + a)}` : permLabel(k); };
export const objLabel = (id) => (P.objects.find((o) => o.id === id) || {}).name || id;
export const memberLabel = (id) => (memberById(id) || {}).name || id;
/** A new id from a typed name: lower case letters and digits, unique among `taken`. */
// Unicode-aware slug (\p{L}\p{N}): Georgian or Cyrillic names give readable ids instead of empty strings.
export function slugId(name, taken, prefix = 'x') {
  let id = String(name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '') || prefix;
  const base = id;
  for (let i = 2; taken.includes(id); i++) id = base + '_' + i;
  return id;
}

// ---------------------------------------------------------------------------------------------------------------
// Bridges to the access/ library

export const secIds = () => P.sections.map((s) => s.id);

/** memberGrant at the project date; null when the member has no live access. */
// Effective grants of a member at the simulated date: role chain + extra grants, minus expired parts (library).
export function memberAccess(m) {
  if (!m) return null;
  return memberGrant(m, { roles: P.roles, extra: m.extra, now: nowMs() });
}

/** 'section.action' names of a grants Map, '*' expanded to the project actions. */
// Expands the grants Map into "section.action" names for the scope model and previews; "*" means every action.
export function rightNames(grants) {
  const out = [];
  if (!grants) return out;
  for (const s of secIds()) {
    const set = grants.get(s);
    if (!set) continue;
    for (const a of P.actions) if (set.has('*') || set.has(a)) out.push(`${s}.${a}`);
  }
  return out;
}

export const policyModel = () => definePolicy({ entities: P.policy.entities, permissions: P.policy.permissions });

const level = (scope, id, label, cfg) => ({ scope, id, label, mode: cfg && cfg.mode ? cfg.mode : null, overrides: { ...(cfg && cfg.overrides) } });
/** Policy levels of a member (org -> roles root to leaf -> member) or of a role alone. */
// Policy cascade order matters: organisation -> each role from root to leaf -> member. Later levels override
// earlier ones in the library, so the most specific setting wins.
export function policyLevels({ member = null, roleId = member ? member.roleId : null } = {}) {
  const out = [level('org', null, t('ad.lvl.org'), P.policy.org)];
  for (const id of roleChain(P.roles, roleId)) out.push(level('role', id, roleLabel(id), P.policy.roles[id]));
  if (member) out.push(level('member', member.id, member.name, P.policy.members[member.id]));
  return out;
}

/** Module view levels of a member or a role, in the same cascade. */
export function viewLevels({ member = null, roleId = member ? member.roleId : null } = {}) {
  const out = [{ scope: 'org', label: t('ad.lvl.org'), views: { ...P.modules.org } }];
  for (const id of roleChain(P.roles, roleId)) out.push({ scope: 'role', id, label: roleLabel(id), views: { ...P.modules.roles[id] } });
  if (member) out.push({ scope: 'member', id: member.id, label: member.name, views: { ...P.modules.members[member.id] } });
  return out;
}

export const ALWAYS_GROUP = 'profile';
// Session scope: the full right list, one group per section and "profile" as the always-available group (a user can
// always reach their own profile, even in a narrowed session).
export function scopeModel() {
  const s = P.sessions;
  return createScopeModel({
    rights: secIds().flatMap((x) => P.actions.map((a) => `${x}.${a}`)), groups: secIds(), always: ALWAYS_GROUP,
    readonlyAllow: s.readonlyAllow || [], idlePaths: s.idlePaths || [], idlePolls: s.idlePolls || [],
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Widgets

let gid = 0;
export const uid = (p = 'x') => p + Date.now().toString(36).slice(-4) + (++gid).toString(36);

// Labelled group for non-input controls: the label names the group through aria-labelledby.
export function group(label, control, hint) {
  const id = 'acd-g' + (++gid);
  control.setAttribute('aria-labelledby', id);
  return h('div', { class: 'ed-field' }, h('span', { class: 'ed-label', id }, label.startsWith('=') ? label.slice(1) : t(label)), control, hint ? h('div', { class: 'ed-hint' }, hint) : null);
}

export function note(kind, text, extra) {
  return h('div', { class: 'acd-note acd-note-' + kind, role: kind === 'error' ? 'alert' : null }, iconEl(kind === 'ok' ? 'ok' : kind === 'info' ? 'info' : 'warn'), h('span', {}, text, extra || null));
}

export const chip = (text, kind = '', attrs = {}) => h('span', { class: 'acd-chip' + (kind ? ' acd-chip-' + kind : ''), ...attrs }, text);

export function dateInput(value, onChange, attrs = {}) {
  const i = h('input', { type: 'date', class: 'ed-input acd-date', value: value || '', ...attrs });
  i.addEventListener('change', () => onChange(i.value));
  return i;
}

export function selectEl(options, value, onChange, attrs = {}) {
  const s = h('select', { class: 'ed-input ed-select', ...attrs }, options.map((o) => h('option', { value: o.v, selected: String(o.v) === String(value ?? '') }, o.l)));
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

export const memberOptions = () => P.members.map((m) => ({ v: m.id, l: `${m.name} · ${roleLabel(m.roleId)}` }));
export const roleOptions = (none) => [...(none ? [{ v: '', l: none }] : []), ...P.roles.map((r) => ({ v: r.id, l: roleLabel(r.id) }))];

export function checkList(items, chosen, onChange, aria) {
  const box = h('div', { class: 'acd-checks', role: 'group', 'aria-label': aria || null });
  for (const it of items) {
    const c = h('input', { type: 'checkbox', checked: chosen.includes(it.v), value: it.v });
    c.addEventListener('change', () => onChange([...box.querySelectorAll('input:checked')].map((x) => x.value)));
    box.append(h('label', { class: 'acd-check' + (it.cls ? ' ' + it.cls : '') }, c, h('span', {}, it.l)));
  }
  return box;
}

// Plain dark / light of the page (for diagrams drawn with fixed colours).
export function isDark() {
  const th = document.documentElement.getAttribute('data-theme');
  return th ? th === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}
export function onSchemeChange(fn) {
  new MutationObserver(fn).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', fn);
}

// Printing one element: the page hides everything else while the print dialog is open.
// Print one element alone (see app.css @media print); afterprint plus a 1 s fallback for browsers that skip it.
export function printNode(node) {
  document.getElementById('acd-print')?.remove();
  const sheet = h('div', { id: 'acd-print', class: 'acd-print' }, node);
  document.body.append(sheet);
  document.body.classList.add('acd-printing');
  const done = () => { document.body.classList.remove('acd-printing'); sheet.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { window.print(); setTimeout(done, 1000); }, 50);
}

// Formats ISO dates in UTC: they are calendar dates, formatting in local time could show the previous day.
export const fmtDate = (iso) => {
  const d = Date.parse(iso);
  if (!Number.isFinite(d)) return '—';
  try { return new Date(d).toLocaleDateString(document.documentElement.lang || 'en', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }); } catch { return iso; }
};
