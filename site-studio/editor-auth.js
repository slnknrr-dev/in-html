// site-studio/editor-auth.js - Site → Accounts: sign-up, the ways to sign in and the roles of a backend site
// (doc.auth, viewer-access.js). Pages choose who may open them in their own settings (Page → Who can open the page).
//
// The editor only describes the policy; enforcement lives on the generated server (backend-auth.js). Nothing here is a
// security boundary: a static export ignores doc.auth entirely (editor-export.js strips closed pages instead).
import { h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { S } from '../studio/state.js';
import { commit } from '../studio/history.js';
import { section } from '../studio/fields.js';
import { fieldsBox, renderDocSettings } from '../studio/right.js';

// Role ids end up in JSON, URLs of the admin console and page access lists: lowercase identifiers only.
const ROLE_RE = /^[a-z][a-z0-9-]{0,30}$/;

// render: 'none' (roles do not change the canvas) followed by a settings re-render so selects list the new ids.
function setRoles(fn) {
  commit('doc auth.roles', () => { fn(S.doc.auth.roles); }, { render: 'none' });
  renderDocSettings();
}

// 'admin' and 'member' are structural roles the server relies on: their ids are locked, admin has no parent (it is the
// top of the inheritance chain) and is never offered as a parent (nothing may inherit everything).
// KNOWN DEFECT: renaming or deleting a role updates `parent` links only; doc.auth.defaultRole and the page access
// lists that name the old id keep a dangling reference. Fix: remap those in the same setRoles commit.
function rolesTable() {
  const roles = S.doc.auth.roles;
  const lang = S.doc.defaultLang;
  const rows = roles.map((r, i) => {
    const fixed = r.id === 'admin' || r.id === 'member';
    const id = h('input', { class: 'ed-input ed-mono', value: r.id, disabled: fixed, 'aria-label': t('au.roleId'), size: 10,
      onchange: (e) => {
        const v = String(e.target.value).trim().toLowerCase();
        if (!ROLE_RE.test(v) || roles.some((x, k) => k !== i && x.id === v)) { e.target.value = r.id; return; }
        setRoles((list) => { const old = list[i].id; list[i].id = v; for (const x of list) if (x.parent === old) x.parent = v; });
      } });
    const name = h('input', { class: 'ed-input', value: (r.name && r.name[lang]) || '', 'aria-label': t('au.roleName'),
      onchange: (e) => setRoles((list) => { list[i].name = { ...(list[i].name || {}), [lang]: String(e.target.value).slice(0, 80) }; }) });
    const parent = h('select', { class: 'ed-input', disabled: r.id === 'admin', 'aria-label': t('au.roleParent'),
      onchange: (e) => setRoles((list) => { list[i].parent = e.target.value; }) },
    h('option', { value: '' }, t('au.none')), ...roles.filter((x) => x.id !== r.id && x.id !== 'admin').map((x) => h('option', { value: x.id, selected: x.id === r.parent }, x.id)));
    const del = fixed ? h('span') : h('button', { type: 'button', class: 'ed-btn ed-icon ed-sm', 'aria-label': t('files.delete'), title: t('files.delete'),
      onclick: () => setRoles((list) => { const gone = list[i].id; list.splice(i, 1); for (const x of list) if (x.parent === gone) x.parent = ''; }) }, iconEl('trash'));
    return h('div', { class: 'ss-role' }, id, name, parent, del);
  });
  const add = h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => setRoles((list) => {
    let n = 1;
    while (list.some((x) => x.id === 'role-' + n)) n++;
    // Inserted before the last entry, so the conventional last role (normally 'member') keeps its place at the bottom.
    list.splice(list.length - 1, 0, { id: 'role-' + n, name: {}, parent: 'member' });
  }) }, iconEl('plus'), t('au.addRole'));
  return h('div', {}, h('div', { class: 'ss-roles' }, h('div', { class: 'ss-role ss-role-h' }, h('span', {}, t('au.roleId')), h('span', {}, t('au.roleName')), h('span', {}, t('au.roleParent')), h('span')), ...rows),
    h('p', { class: 'ed-hint' }, t('au.rolesHint')), add);
}

// No doc.auth = a document type without accounts (landing templates): the tab renders empty rather than inventing a
// default policy the user never chose.
export function dsAuth(body) {
  if (!S.doc.auth) return;
  body.append(h('p', { class: 'ed-hint' }, t('au.intro')));
  const roleOpts = S.doc.auth.roles.filter((r) => r.id !== 'admin').map((r) => ({ v: r.id, text: r.id }));
  body.append(section('ds-auth', t('ds.auth'), fieldsBox([
    { key: 'signup', type: 'select', label: 'au.signup', noSeg: true, options: ['open', 'invite', 'closed'].map((v) => ({ v, l: 'au.su.' + v })) },
    { key: 'password', type: 'checkbox', label: 'au.password' },
    { key: 'link', type: 'checkbox', label: 'au.link' },
    { key: 'defaultRole', type: 'select', label: 'au.default', noSeg: true, options: roleOpts },
  ], 'auth', 'none')));
  body.append(section('ds-roles', t('au.roles'), rolesTable()));
}
