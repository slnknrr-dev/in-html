// site-studio/viewer-access.js - accounts and closed sections of a site (backend exports).
//
// Document: doc.auth = { signup: 'open' | 'invite' | 'closed', password: bool, link: bool, defaultRole,
//   roles: [{ id, name: { lang: text }, parent }] } — the roles of access/roles.js (a role inherits its parent's pages);
// 'admin' always exists, is above every other role and may open the admin console and the constructor.
// Page: access 'public' | 'members' (any signed-in account) | 'roles' (accounts whose role, or a role above it, is in
// page.roles: 'editor, partner').
//
// A closed page is never exported with its content except as a private file of a backend export: every other render
// (single file, serverless site, the public files and 404.html of a backend site) gets the public view of the document
// (publicView), where a closed page keeps its address, title and navigation entry and shows a sign-in note instead.
import { roleChain } from '../access/roles.js';
import { isObj, oneOf, str } from '../util/value.js';

// Security model: access control is enforced by the backend server, never by the page. Static renders therefore must
// not contain closed content at all (publicView); hiding it with CSS or script would publish it to anyone who views
// the source.
const ACCESS = ['public', 'members', 'roles'];
const SIGNUP = ['open', 'invite', 'closed'];
// Role ids appear in URLs, server config and Mermaid diagrams (site-map.js): one strict lowercase charset fits all.
const ROLE_RE = /^[a-z][a-z0-9-]{0,30}$/;

// Roles as a comma / space separated list → valid ids (deduplicated).
const roleList = (v) => [...new Set(str(Array.isArray(v) ? v.join(',') : v).split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter((x) => ROLE_RE.test(x)))].slice(0, 20);

function normAuth(v) {
  const a = isObj(v) ? v : {};
  const roles = [];
  const seen = new Set();
  for (const r of Array.isArray(a.roles) ? a.roles : []) {
    if (!isObj(r) || !ROLE_RE.test(str(r.id)) || seen.has(r.id) || roles.length >= 30) continue;
    seen.add(r.id);
    const name = {};
    if (isObj(r.name)) for (const [l, s] of Object.entries(r.name)) if (typeof s === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(l)) name[l] = s.slice(0, 80);
    roles.push({ id: r.id, name, parent: ROLE_RE.test(str(r.parent)) ? r.parent : '' });
  }
  // 'member' and 'admin' are invariants the server relies on: re-created if a document lost them.
  if (!seen.has('member')) roles.unshift({ id: 'member', name: { en: 'Member', ru: 'Участник' }, parent: '' });
  if (!roles.some((r) => r.id === 'admin')) roles.push({ id: 'admin', name: { en: 'Administrator', ru: 'Администратор' }, parent: '' });
  // A parent must exist and must not make a cycle (access/roleChain stops at cycles; the editor shows the chain).
  const ids = new Set(roles.map((r) => r.id));
  for (const r of roles) if (r.parent && (!ids.has(r.parent) || r.parent === r.id)) r.parent = '';
  // A new account can never default to admin: open sign-up would otherwise hand out the admin console.
  const defaultRole = ids.has(str(a.defaultRole)) && a.defaultRole !== 'admin' ? a.defaultRole : 'member';
  return {
    signup: oneOf(a.signup, SIGNUP, 'open'),
    password: a.password !== false,
    link: a.link !== false,
    defaultRole,
    roles,
  };
}

function normPageAccess(out) {
  out.access = oneOf(out.access, ACCESS, 'public');
  out.roles = out.access === 'roles' ? roleList(out.roles).join(', ') : '';
  if (out.kind === 'notfound') { out.access = 'public'; out.roles = ''; }
}

const isClosed = (p) => isObj(p) && p.type === 'page' && (p.access === 'members' || p.access === 'roles');

// Closed pages of a document (normalized).
const closedPages = (doc) => (Array.isArray(doc && doc.regions && doc.regions.main) ? doc.regions.main.filter(isClosed) : []);

// Roles the account's role stands for: itself and every role below it (a parent → child chain read from the child:
// 'editor' with parent 'member' opens the pages of 'member' too). 'admin' stands for every role.
function rolesOf(doc, role) {
  const roles = (doc && doc.auth && doc.auth.roles) || [];
  if (role === 'admin') return new Set(roles.map((r) => r.id).concat('admin'));
  const map = new Map(roles.map((r) => [r.id, { id: r.id, parent: r.parent || null }]));
  if (!map.has(role)) return new Set();
  return new Set(roleChain(map, role));
}

// May an account (null = a visitor) open a page?
function pageAllowed(doc, page, user) {
  if (!isClosed(page)) return true;
  if (!user || user.blocked) return false;
  if (page.access === 'members') return true;
  const have = rolesOf(doc, user.role);
  return roleList(page.roles).some((r) => have.has(r));
}

// The document without the content of closed pages: each keeps its address, titles and navigation entry and shows
// a sign-in block (backend sites) or a note. `note` = per-language text, `signin` = whether an account block goes in.
function publicView(doc, { signin = false, note = null } = {}) {
  const closed = closedPages(doc);
  if (!closed.length) return doc;
  const d = { ...doc, regions: { ...doc.regions, main: doc.regions.main.map((p) => {
    if (!isClosed(p)) return p;
    const blocks = [];
    const txt = note || { en: '<p>This section is for members.</p>', ru: '<p>Этот раздел — для участников.</p>' };
    blocks.push({ type: 'section', id: p.id + 'x1', pad: 'm', width: 'narrow', title: p.title || {}, eyebrow: {}, lead: {}, blocks: [
      ...(signin ? [{ type: 'account', id: p.id + 'x2', view: 'signin', title: {}, password: true, link: true, after: '' }]
        : [{ type: 'text', id: p.id + 'x3', html: txt }]),
    ] });
    return { ...p, noindex: true, blocks, private: true };
  }) } };
  return d;
}

export { ACCESS, closedPages, isClosed, normAuth, normPageAccess, pageAllowed, publicView, roleList, rolesOf };
