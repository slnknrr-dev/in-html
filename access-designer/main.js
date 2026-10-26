// access-designer/main.js - the roles page: roles as a tree with inheritance (a diagram of the chains), the grant
// editor of one role (every section × action granted, revoked or left to the parent; "all actions" per section), the
// sections and actions of the model, the permission matrix of roles or members where every cell tells who granted
// or revoked it (grantMatrix / explainGrant, a trail of every level of the chain), members with their role, objects
// and personal grants each with its own expiry (memberGrant at the simulated date), and the "view as" check
// (canViewAs) with a preview of what the target member gets.
//
// Rendering: renderAll builds the page skeleton; each panel has its own render function so a click repaints only
// what depends on it (e.g. toggling one grant cell repaints the editor, matrix and explanation, not members).
// UI state U (selected role, matrix mode, member, view-as pair) is persisted per page; the selected matrix cell is
// deliberately not persisted (it may not exist after the project changes).
// Access semantics come from access/roles.js: a role inherits its parent's grants; a revoke removes a right
// inherited from above, but a grant at the same or a lower level re-adds it ("ignored" revoke).
import {
  P, actIcon, chip, slugId, checkList, dateInput, fmtDate, group, isDark, memberAccess, memberById, memberOptions, modLabel, note, objLabel,
  onSchemeChange, rightNames, roleById, roleLabel, roleOptions, save, secIds, secLabel, actLabel, selectEl, startShell, uid, viewLevels,
} from './common.js';
import { projectCard } from './doc.js';
import { button, card, field, seg, t, textInput, toast, toggle } from '../ui/app.js';
import { $, $$, h, lsGet, lsSet } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { can, canViewAs, explainGrant, grantMatrix, grantsWithin, roleChain, roleGrants } from '../access/roles.js';
import { applyModules, viewsFor } from '../access/modules.js';
import { createGraph, graphSVG } from '../diagram/graph.js';

const UKEY = 'acd-ui-roles';
const U = { role: '', mode: 'roles', sec: '', member: '', viewer: '', target: '', cell: null, ...lsGet(UKEY, {}) };
const keepUI = () => lsSet(UKEY, { ...U, cell: null });
const changed = () => { save(); renderAll(); };

const main = $('#main');
main.classList.add('acd-page', 'acd-roles');
let els = {};

// ---------------------------------------------------------------------------------------------------------------
// Role tree helpers

const children = (id) => P.roles.filter((r) => (r.parent || null) === id);
// Depth-first order for display. The second loop renders roles that are part of a parent cycle (possible only in
// hand-edited imports) so nothing silently disappears; seen prevents infinite recursion.
function treeOrder() {
  const out = [], seen = new Set();
  const walk = (r, depth) => { if (seen.has(r.id)) return; seen.add(r.id); out.push({ r, depth }); for (const c of children(r.id)) walk(c, depth + 1); };
  for (const r of P.roles) if (!r.parent || !roleById(r.parent)) walk(r, 0);
  for (const r of P.roles) if (!seen.has(r.id)) walk(r, 0); // cycles (imported projects) still show up
  return out;
}
const descendants = (id) => { const out = new Set(); const walk = (x) => { for (const c of children(x)) if (!out.has(c.id)) { out.add(c.id); walk(c.id); } }; walk(id); return out; };

// One cell of a role's own definition: 'grant' | 'revoke' | 'none'.
// Revoke checked before grant: a role that both grants and revokes the same right is shown as revoking.
function ownCell(r, s, a) {
  if ((r.revoke[s] || []).includes(a)) return 'revoke';
  if ((r.grants[s] || []).includes(a)) return 'grant';
  return 'none';
}
// Writes one cell: remove the action from both lists, then add it to the chosen list. Granting "*" replaces the
// section's list with ["*"]; granting a single action removes a present "*" (otherwise the click would do nothing
// visible). Empty lists are deleted to keep the stored project minimal.
function setOwnCell(r, s, a, state) {
  for (const part of ['grants', 'revoke']) {
    const list = (r[part][s] || []).filter((x) => x !== a);
    if (list.length) r[part][s] = list; else delete r[part][s];
  }
  const part = state === 'grant' ? 'grants' : state === 'revoke' ? 'revoke' : null;
  if (!part) return;
  const list = a === '*' ? ['*'] : [...(r[part][s] || []).filter((x) => x !== '*'), a];
  r[part][s] = list;
}
// Click cycle of a grant cell: none -> grant -> revoke -> none.
const NEXT = { none: 'grant', grant: 'revoke', revoke: 'none' };

// ---------------------------------------------------------------------------------------------------------------
// Layout

function renderAll() {
  if (!roleById(U.role)) U.role = P.roles[0]?.id || '';
  if (!memberById(U.member)) U.member = P.members[0]?.id || '';
  main.textContent = '';
  els = {
    roles: h('div', { class: 'acd-rolelist', role: 'listbox', 'aria-label': t('ad.roles') }),
    editor: h('div', { class: 'acd-editor' }),
    matrix: h('div', { class: 'acd-matrix-wrap', tabindex: '-1' }),
    explain: h('div', { id: 'acd-explain', class: 'acd-explain', role: 'status', 'aria-live': 'polite' }),
    diagram: h('div', { class: 'acd-diagram', id: 'acd-role-diagram' }),
    members: h('div', { class: 'acd-members' }),
    viewas: h('div', { class: 'acd-viewas' }),
  };
  const rolesCard = card('ad.roles', els.roles, h('div', { class: 'ap-actions' },
    small(button('ad.addChild', 'plus', () => addRole(U.role), 'primary')), small(button('ad.addRoot', 'plus', () => addRole(null)))));
  const editCard = card('ad.editRole', els.editor);
  const side = h('div', { class: 'acd-col acd-side' }, rolesCard, editCard, modelCard(), projectCard(renderAll));
  const matrixCard = card('ad.matrix', matrixTools(), els.matrix, legend(), els.explain);
  matrixCard.classList.add('acd-matrix-card');
  const stage = h('div', { class: 'acd-col acd-stage' }, matrixCard, card('ad.inheritance', els.diagram, h('p', { class: 'ed-hint' }, t('ad.inheritanceHint'))),
    card('ad.members', els.members), card('ad.viewAs', els.viewas));
  main.append(h('p', { class: 'ap-lead' }, t('ad.lead.roles')), h('div', { class: 'acd-work' }, side, stage));
  renderRoles(); renderEditor(); renderMatrix(); renderExplain(); renderDiagram(); renderMembers(); renderViewAs();
}
const small = (b) => { b.classList.add('ed-sm'); return b; };

// --- roles list ---------------------------------------------------------------------------------------------------

// Listbox pattern: only the selected item is in the tab order (roving tabindex); Up/Down move selection and focus.
function renderRoles() {
  const box = els.roles;
  box.textContent = '';
  for (const { r, depth } of treeOrder()) {
    const n = P.members.filter((m) => m.roleId === r.id).length;
    box.append(h('button', {
      type: 'button', role: 'option', class: 'acd-roleitem' + (r.id === U.role ? ' acd-on' : ''), 'aria-selected': String(r.id === U.role),
      tabindex: r.id === U.role ? '0' : '-1', dataset: { id: r.id }, style: { '--d': depth },
      onclick: () => selectRole(r.id),
    }, depth ? iconEl('inherit') : iconEl('role'), h('span', { class: 'acd-roleitem-n' }, roleLabel(r.id)), n ? chip(String(n), 'muted', { title: t('ad.nMembers', { n }) }) : null));
  }
  box.onkeydown = (e) => {
    const items = $$('.acd-roleitem', box);
    const i = items.indexOf(document.activeElement);
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (i < 0 || !step) return;
    e.preventDefault();
    const b = items[(i + step + items.length) % items.length];
    selectRole(b.dataset.id);
    $(`.acd-roleitem[data-id="${b.dataset.id}"]`)?.focus();
  };
}
function selectRole(id) {
  U.role = id; keepUI();
  renderRoles(); renderEditor(); renderDiagram();
  for (const th of $$('.acd-matrix thead th[data-col]')) th.classList.toggle('acd-colon', th.dataset.col === id);
}

function addRole(parent) {
  const id = uid('r');
  P.roles.push({ id, name: t('ad.newRole'), parent: parent || null, grants: {}, revoke: {} });
  U.role = id; keepUI();
  changed();
  $('.acd-editor input')?.focus();
}

// --- role editor ----------------------------------------------------------------------------------------------------

// The parent select excludes the role itself and its descendants: choosing one would create an inheritance cycle.
// Cell states: own grant/revoke/none, "all" (covered by an own "*" grant, disabled), plus markers for inherited
// rights and ignored revokes (a revoke that still ends allowed because a grant at this level re-adds the right).
function renderEditor() {
  const box = els.editor;
  box.textContent = '';
  const r = roleById(U.role);
  if (!r) { box.append(h('p', { class: 'ap-empty' }, t('ad.noRole'))); return; }
  const banned = descendants(r.id);
  const parentOpts = [{ v: '', l: t('ad.noParent') }, ...P.roles.filter((x) => x.id !== r.id && !banned.has(x.id)).map((x) => ({ v: x.id, l: roleLabel(x.id) }))];
  box.append(
    field('ad.roleName', textInput(r.name, (v) => { r.name = v; save(); renderRoles(); renderDiagram(); renderMatrix(); }, { placeholder: roleLabel(r.id) })),
    field('ad.parent', selectEl(parentOpts, r.parent || '', (v) => { r.parent = v || null; changed(); })),
    h('div', { class: 'ed-hint' }, t('ad.chainIs', { chain: roleChain(P.roles, r.id).map(roleLabel).join(' → ') })));

  const parentGrants = r.parent ? roleGrants(P.roles, r.parent) : new Map();
  const mine = roleGrants(P.roles, r.id);
  const grid = h('div', { class: 'acd-ggrid', role: 'group', 'aria-label': t('ad.grants'), style: { '--cols': `minmax(90px, 1fr) repeat(${P.actions.length + 1}, 28px)` } });
  grid.append(h('div', { class: 'acd-ggrid-h' }, h('span', {}, t('ad.section')), h('span', { class: 'acd-ggrid-all' }, t('ad.all')), ...P.actions.map((a) => h('span', { title: actLabel(a), class: 'acd-ggrid-a' }, actGlyph(a)))));
  for (const s of secIds()) {
    const row = h('div', { class: 'acd-ggrid-r' }, h('span', { class: 'acd-ggrid-s' }, secLabel(s)));
    const allState = ownCell(r, s, '*');
    row.append(cellBtn(r, s, '*', allState, can(parentGrants, s, '*') && parentGrants.get(s)?.has('*'), false));
    for (const a of P.actions) {
      const st = ownCell(r, s, a);
      const inherited = can(parentGrants, s, a);
      const covered = allState === 'grant';
      const ignored = st === 'revoke' && can(mine, s, a);
      row.append(cellBtn(r, s, a, covered && st === 'none' ? 'all' : st, inherited, ignored));
    }
    grid.append(row);
  }
  box.append(group('ad.grants', grid, t('ad.grantsHint')));
  const ign = secIds().flatMap((s) => P.actions.filter((a) => ownCell(r, s, a) === 'revoke' && can(mine, s, a)).map((a) => `${secLabel(s)} · ${actLabel(a)}`));
  if (ign.length) box.append(note('warn', t('ad.ignoredRevoke', { list: ign.join(', ') })));
  const del = small(button('ad.deleteRole', 'trash', () => deleteRole(r), 'danger'));
  box.append(h('div', { class: 'ap-actions' }, del));
}
const actGlyph = (a) => (actIcon(a) ? iconEl(actIcon(a)) : h('b', {}, actLabel(a).slice(0, 2)));

// After a click the editor is rebuilt; focus is restored to the same cell by data attributes ("*" must be escaped in
// the attribute selector, hence the backslash).
function cellBtn(r, s, a, state, inherited, ignored) {
  const label = `${secLabel(s)} · ${a === '*' ? t('ad.all') : actLabel(a)}: ${t('ad.own.' + state)}${inherited ? ' · ' + t('ad.fromParent') : ''}`;
  const b = h('button', {
    type: 'button', class: `acd-g acd-g-${state}` + (inherited ? ' acd-g-inh' : '') + (ignored ? ' acd-g-ign' : ''), title: label, 'aria-label': label,
    dataset: { sec: s, act: a, state }, disabled: state === 'all',
    onclick: () => { setOwnCell(r, s, a, NEXT[state] || 'grant'); save(); renderEditor(); renderMatrix(); renderExplain(); $(`.acd-g[data-sec="${s}"][data-act="${a === '*' ? '\\*' : a}"]`)?.focus(); },
  }, state === 'grant' || state === 'all' ? iconEl('check') : state === 'revoke' ? iconEl('revoke') : inherited ? h('i', { class: 'acd-dot' }) : null);
  return b;
}

// Deleting a role re-parents its children and members to its parent: the hierarchy closes over the gap instead of
// orphaning subtrees, and members keep the closest remaining access.
function deleteRole(r) {
  for (const c of children(r.id)) c.parent = r.parent || null;
  for (const m of P.members) if (m.roleId === r.id) m.roleId = r.parent || null;
  P.roles = P.roles.filter((x) => x.id !== r.id);
  delete P.policy.roles[r.id];
  delete P.modules.roles[r.id];
  toast(t('ad.roleDeleted', { name: roleLabel(r.id) }), 'ok');
  U.role = r.parent || P.roles[0]?.id || '';
  changed();
}

// --- sections and actions -----------------------------------------------------------------------------------------

// Removing a section or action also scrubs it from every role's grants/revokes; the last action cannot be removed
// (a model needs at least one).
function modelCard() {
  const box = h('div', { class: 'acd-model' });
  const secList = h('div', { class: 'acd-list' });
  for (const s of P.sections) {
    const rm = h('button', { type: 'button', class: 'ed-iconbtn', title: t('ad.remove'), 'aria-label': t('ad.remove') + ': ' + secLabel(s.id), onclick: () => {
      P.sections = P.sections.filter((x) => x !== s);
      for (const r of P.roles) { delete r.grants[s.id]; delete r.revoke[s.id]; }
      changed();
    } }, iconEl('close'));
    secList.append(h('div', { class: 'acd-list-r' }, textInput(s.name, (v) => { s.name = v; save(); }, { placeholder: secLabel(s.id), 'aria-label': t('ad.section') + ' ' + s.id }), rm));
  }
  const newSec = textInput('', () => {}, { placeholder: t('ad.newSection'), 'aria-label': t('ad.newSection') });
  const addSec = small(button('ad.add', 'plus', () => {
    const name = newSec.value.trim();
    if (!name) return;
    const id = slugId(name, P.sections.map((x) => x.id), 's');
    P.sections.push({ id, name, key: '' });
    changed();
  }));
  const acts = h('div', { class: 'acd-chips' }, P.actions.map((a) => h('span', { class: 'acd-chip acd-chip-x' }, actGlyph(a), actLabel(a),
    h('button', { type: 'button', class: 'acd-chip-rm', 'aria-label': t('ad.remove') + ': ' + actLabel(a), onclick: () => {
      if (P.actions.length < 2) return;
      P.actions = P.actions.filter((x) => x !== a);
      delete P.actionInfo[a];
      if (P.readAction === a) P.readAction = P.actions[0];
      for (const r of P.roles) for (const part of ['grants', 'revoke']) for (const k of Object.keys(r[part])) { r[part][k] = r[part][k].filter((x) => x !== a); if (!r[part][k].length) delete r[part][k]; }
      changed();
    } }, '×'))));
  const newAct = textInput('', () => {}, { placeholder: t('ad.newAction'), 'aria-label': t('ad.newAction') });
  const addAct = small(button('ad.add', 'plus', () => {
    const name = newAct.value.trim();
    if (!name) return;
    const a = slugId(name, P.actions, 'a');
    P.actions.push(a);
    P.actionInfo[a] = { name, key: '', icon: '' };
    changed();
  }));
  const secOpts = [{ v: '', l: t('ad.none') }, ...secIds().map((x) => ({ v: x, l: secLabel(x) }))];
  box.append(field('ad.projectName', textInput(P.name, (v) => { P.name = v; save(); }, { placeholder: t('ad.doc.title') })),
    group('ad.sections', secList), h('div', { class: 'acd-addrow' }, newSec, addSec), group('ad.actions', acts), h('div', { class: 'acd-addrow' }, newAct, addAct),
    field('ad.readAction', selectEl(P.actions.map((a) => ({ v: a, l: actLabel(a) })), P.readAction, (v) => { P.readAction = v; changed(); }), 'ad.readActionHint'),
    field('ad.viewAsSection', selectEl(secOpts, P.viewAsSection, (v) => { P.viewAsSection = v; changed(); }), 'ad.viewAsSectionHint'));
  const d = h('details', { class: 'acd-details' }, h('summary', {}, iconEl('chevRight'), h('span', {}, t('ad.model'))), box);
  return h('section', { class: 'ap-card' }, d);
}

// --- matrix ---------------------------------------------------------------------------------------------------------

function matrixTools() {
  return h('div', { class: 'acd-tools' },
    seg([{ v: 'roles', l: 'ad.byRoles' }, { v: 'members', l: 'ad.byMembers' }], U.mode, (v) => { U.mode = v; U.cell = null; keepUI(); renderMatrix(); renderExplain(); }, 'ad.matrix'),
    selectEl([{ v: '', l: t('ad.allSections') }, ...secIds().map((s) => ({ v: s, l: secLabel(s) }))], U.sec, (v) => { U.sec = v; keepUI(); renderMatrix(); }, { 'aria-label': t('ad.section') }));
}
function legend() {
  const it = (cls, l) => h('span', { class: 'acd-leg' }, h('span', { class: 'acd-c acd-c-' + cls, 'aria-hidden': 'true' }, cls === 'rev' ? iconEl('revoke') : cls === 'none' ? null : iconEl('check')), t(l));
  return h('div', { class: 'acd-legend' }, it('own', 'ad.leg.own'), it('inh', 'ad.leg.inh'), it('rev', 'ad.leg.rev'), it('lapsed', 'ad.leg.lapsed'), it('none', 'ad.leg.none'));
}

// Cells of one column: { [sec]: { [act]: { state, from, revokedAt, via } } }
// Matrix column of a role from grantMatrix: own (granted here), inh (inherited, from = granting role), rev (revoked
// at revokedAt), none.
function roleColumn(gm, id) {
  const col = {};
  for (const s of secIds()) {
    col[s] = {};
    for (const a of P.actions) {
      const c = gm[id][s][a];
      col[s][a] = { state: c.allowed ? (c.from === id ? 'own' : 'inh') : c.revokedAt ? 'rev' : 'none', from: c.from, revokedAt: c.revokedAt };
    }
  }
  return col;
}
// Matrix column of a member: allowed rights split into via role (inh) and personal (own); otherwise revoked by the
// role chain, lapsed (an expired personal grant or an expired role assignment that would have allowed it), or none.
// Personal grants are converted to the Map<section, Set> shape that can() expects.
function memberColumn(gm, m) {
  const acc = memberAccess(m);
  const col = {};
  const roleLive = acc && acc.roleId;
  for (const s of secIds()) {
    col[s] = {};
    for (const a of P.actions) {
      const rc = m.roleId && gm[m.roleId] ? gm[m.roleId][s][a] : null;
      const viaRole = !!(roleLive && rc && rc.allowed);
      const viaExtra = !!acc && m.extra.some((g) => can(new Map(Object.entries(g.grants).map(([k, v]) => [k, new Set(v)])), s, a) && isLiveDate(g.expiresAt));
      const lapsedExtra = m.extra.some((g) => can(new Map(Object.entries(g.grants).map(([k, v]) => [k, new Set(v)])), s, a) && !isLiveDate(g.expiresAt));
      const allowed = !!acc && can(acc.grants, s, a);
      col[s][a] = {
        state: allowed ? (viaRole ? 'inh' : 'own') : rc && rc.revokedAt && roleLive ? 'rev' : (lapsedExtra || (rc && rc.allowed && !roleLive)) ? 'lapsed' : 'none',
        from: viaRole ? rc.from : viaExtra ? 'personal' : null, revokedAt: rc ? rc.revokedAt : null,
      };
    }
  }
  return col;
}
// Expiry semantics: an empty date never expires; a date is live while it is later than the simulated "now" (noon
// UTC of P.now, see common.js nowMs).
const isLiveDate = (d) => !d || Date.parse(d) > Date.parse(P.now + 'T12:00:00Z');

// ARIA grid with roving focus: every cell button has tabindex -1 except the current one, so Tab enters the grid once
// and arrow keys move inside it (bindGridKeys).
function renderMatrix() {
  const box = els.matrix;
  box.textContent = '';
  const gm = grantMatrix(P.roles, secIds(), P.actions);
  const cols = U.mode === 'members'
    ? P.members.map((m) => ({ id: m.id, label: m.name, sub: roleLabel(m.roleId), cells: memberColumn(gm, m) }))
    : treeOrder().map(({ r, depth }) => ({ id: r.id, label: roleLabel(r.id), sub: r.parent ? '↑ ' + roleLabel(r.parent) : '', depth, cells: roleColumn(gm, r.id) }));
  const secs = U.sec ? [U.sec] : secIds();
  const table = h('table', { class: 'acd-matrix', role: 'grid', 'aria-label': t('ad.matrix') });
  table.append(h('thead', {}, h('tr', {}, h('th', { scope: 'col', class: 'acd-m-corner' }, t('ad.section')),
    cols.map((c) => h('th', { scope: 'col', dataset: { col: c.id }, class: c.id === U.role && U.mode === 'roles' ? 'acd-colon' : null }, h('span', { class: 'acd-m-h' }, c.label), c.sub ? h('span', { class: 'acd-m-sub' }, c.sub) : null)))));
  const body = h('tbody');
  for (const s of secs) {
    const tr = h('tr', {}, h('th', { scope: 'row', class: 'acd-m-sec' }, secLabel(s)));
    for (const c of cols) {
      const td = h('td', {}, h('div', { class: 'acd-acts' }, P.actions.map((a) => {
        const cell = c.cells[s][a];
        const desc = cellText(c, s, a, cell);
        return h('button', {
          type: 'button', class: `acd-c acd-c-${cell.state}`, tabindex: '-1', title: desc, 'aria-label': desc,
          dataset: { col: c.id, sec: s, act: a, state: cell.state, from: cell.from || '', revoked: cell.revokedAt || '' },
          onclick: () => { U.cell = { col: c.id, sec: s, act: a }; paintCurrent(); renderExplain(); },
        }, cell.state === 'rev' ? iconEl('revoke') : cell.state === 'none' ? null : (actIcon(a) ? iconEl(actIcon(a)) : h('b', { class: 'acd-c-t' }, actLabel(a).slice(0, 1))));
      })));
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(body);
  box.append(table);
  bindGridKeys(table);
  paintCurrent();
}
function cellText(c, s, a, cell) {
  const what = `${c.label} · ${secLabel(s)} · ${actLabel(a)}: `;
  switch (cell.state) {
    case 'own': return what + (cell.from === 'personal' ? t('ad.cell.personal') : t('ad.cell.own'));
    case 'inh': return what + t('ad.cell.inh', { role: roleLabel(cell.from) });
    case 'rev': return what + t('ad.cell.rev', { role: roleLabel(cell.revokedAt) });
    case 'lapsed': return what + t('ad.cell.lapsed');
    default: return what + t('ad.cell.none');
  }
}
function paintCurrent() {
  const btns = $$('.acd-matrix .acd-c', els.matrix);
  let cur = U.cell && btns.find((b) => b.dataset.col === U.cell.col && b.dataset.sec === U.cell.sec && b.dataset.act === U.cell.act);
  for (const b of btns) { b.classList.remove('acd-cur'); b.tabIndex = -1; }
  if (cur) cur.classList.add('acd-cur');
  (cur || btns[0])?.setAttribute('tabindex', '0');
}
// Roving focus: arrows move across actions and columns of a row, up / down to the same cell of the next section.
function bindGridKeys(table) {
  table.addEventListener('keydown', (e) => {
    const b = e.target.closest('.acd-c');
    if (!b) return;
    const rows = $$('tbody tr', table).map((tr) => $$('.acd-c', tr));
    const ri = rows.findIndex((r) => r.includes(b)), ci = rows[ri].indexOf(b);
    let n = null;
    if (e.key === 'ArrowRight') n = rows[ri][ci + 1];
    else if (e.key === 'ArrowLeft') n = rows[ri][ci - 1];
    else if (e.key === 'ArrowDown') n = rows[ri + 1]?.[ci];
    else if (e.key === 'ArrowUp') n = rows[ri - 1]?.[ci];
    else if (e.key === 'Home') n = rows[ri][0];
    else if (e.key === 'End') n = rows[ri].at(-1);
    if (!n) return;
    e.preventDefault();
    b.tabIndex = -1; n.tabIndex = 0; n.focus();
  });
}

// --- explanation ------------------------------------------------------------------------------------------------------

function renderExplain() {
  const box = els.explain;
  box.textContent = '';
  const c = U.cell;
  if (!c) { box.append(h('p', { class: 'ed-hint acd-mt0' }, t('ad.explainHint'))); delete box.dataset.verdict; return; }
  const what = `${secLabel(c.sec)} · ${actLabel(c.act)}`;
  if (U.mode === 'members') return explainMember(box, memberById(c.col), c.sec, c.act, what);
  explainRole(box, c.col, c.sec, c.act, what, roleLabel(c.col));
}

// Explanation = library trail (explainGrant: the decisive grant/revoke steps) plus the full chain with what each
// level does and the result after it, so the user sees exactly where a right appears or disappears.
function explainRole(box, roleId, s, a, what, who) {
  const ex = explainGrant(P.roles, roleId, s, a);
  const last = ex.trail.at(-1);
  box.dataset.verdict = ex.allowed ? 'allowed' : 'denied';
  box.dataset.source = ex.allowed ? last.role : last ? last.role : '';
  const verdict = ex.allowed
    ? (last.role === roleId ? t('ad.ex.own', { who }) : t('ad.ex.inh', { who, role: roleLabel(last.role) }))
    : last ? t('ad.ex.rev', { who, role: roleLabel(last.role), first: roleLabel(ex.trail.find((x) => x.change === 'grant')?.role) }) : t('ad.ex.none', { who });
  box.append(h('div', { class: 'acd-ex-h' }, h('span', { class: 'acd-verdict acd-verdict-' + (ex.allowed ? 'ok' : 'no') }, ex.allowed ? t('ad.allowed') : t('ad.denied')), h('b', {}, what)), h('p', { class: 'acd-ex-v' }, verdict));
  const decisive = new Set(ex.trail.map((x) => x.role + ':' + x.change));
  const ol = h('ol', { class: 'acd-trail' });
  for (const id of roleChain(P.roles, roleId)) {
    const r = roleById(id);
    const g = ownCell({ grants: r.grants, revoke: {} }, s, a) === 'grant' || ownCell({ grants: r.grants, revoke: {} }, s, '*') === 'grant';
    const rv = ownCell({ grants: {}, revoke: r.revoke }, s, a) === 'revoke' || ownCell({ grants: {}, revoke: r.revoke }, s, '*') === 'revoke';
    const after = can(roleGrants(P.roles, id), s, a);
    const tags = [];
    if (g) tags.push(chip(t('ad.tr.grants'), 'ok'));
    if (rv) tags.push(chip(after ? t('ad.tr.ignored') : t('ad.tr.revokes'), after ? 'warn' : 'bad'));
    if (!g && !rv) tags.push(chip(t('ad.tr.nothing'), 'muted'));
    const dec = decisive.has(id + ':grant') || decisive.has(id + ':revoke');
    ol.append(h('li', { class: 'acd-tr' + (dec ? ' acd-tr-dec' : ''), dataset: { role: id } }, h('span', { class: 'acd-tr-n' }, roleLabel(id)), ...tags,
      h('span', { class: 'acd-tr-r ' + (after ? 'acd-ok' : 'acd-no') }, after ? t('ad.tr.allowedAfter') : t('ad.tr.deniedAfter'))));
  }
  box.append(h('div', { class: 'acd-ex-sub' }, t('ad.ex.chain')), ol);
  if (ex.trail.some((x) => x.change === 'revoke')) box.append(note('info', t('ad.ex.revokeWins')));
}

// Member explanation: no access at all (membership ended), or the role path and each personal grant that would give
// the right, with lapsed parts flagged.
function explainMember(box, m, s, a, what) {
  if (!m) return;
  const acc = memberAccess(m);
  const allowed = !!acc && can(acc.grants, s, a);
  box.dataset.verdict = allowed ? 'allowed' : 'denied';
  box.append(h('div', { class: 'acd-ex-h' }, h('span', { class: 'acd-verdict acd-verdict-' + (allowed ? 'ok' : 'no') }, allowed ? t('ad.allowed') : t('ad.denied')), h('b', {}, `${m.name} · ${what}`)));
  const ul = h('ul', { class: 'acd-trail' });
  if (!acc) ul.append(h('li', { class: 'acd-tr' }, chip(t('ad.noAccess'), 'bad'), m.expiresAt ? t('ad.membershipEnded', { d: fmtDate(m.expiresAt) }) : null));
  else {
    if (m.roleId) {
      const live = !!acc.roleId;
      const ex = explainGrant(P.roles, m.roleId, s, a);
      const last = ex.trail.at(-1);
      ul.append(h('li', { class: 'acd-tr' }, h('span', { class: 'acd-tr-n' }, t('ad.viaRole', { role: roleLabel(m.roleId) })),
        !live ? chip(t('ad.lapsed.role'), 'warn') : ex.allowed ? chip(last.role === m.roleId ? t('ad.tr.grants') : t('ad.cell.inh', { role: roleLabel(last.role) }), 'ok') : last ? chip(t('ad.cell.rev', { role: roleLabel(last.role) }), 'bad') : chip(t('ad.tr.nothing'), 'muted')));
    }
    m.extra.forEach((g, i) => {
      const gives = can(new Map(Object.entries(g.grants).map(([k, v]) => [k, new Set(v)])), s, a);
      if (!gives) return;
      const live = isLiveDate(g.expiresAt);
      ul.append(h('li', { class: 'acd-tr' }, h('span', { class: 'acd-tr-n' }, t('ad.personalN', { n: i + 1 })),
        chip(live ? t('ad.tr.grants') : t('ad.lapsed.grant'), live ? 'ok' : 'warn'), g.expiresAt ? h('span', { class: 'ed-hint' }, t('ad.until', { d: fmtDate(g.expiresAt) })) : null));
    });
  }
  box.append(ul);
  if (acc && acc.lapsed.length) box.append(note('warn', t('ad.askRenew', { list: acc.lapsed.map((l) => t('ad.lapsed.' + l)).join(', ') })));
}

// --- inheritance diagram ------------------------------------------------------------------------------------------

// Inheritance diagram: the selected role's chain is accented and its edges thickened. Nodes are made keyboard
// operable (tabindex, role=button, Enter/Space) because the SVG library renders plain groups.
function renderDiagram() {
  const g = createGraph({ direction: 'TB' });
  const chain = new Set(roleChain(P.roles, U.role));
  for (const r of P.roles) {
    const n = g.node(r.id, roleLabel(r.id), { shape: 'round', tooltip: roleChain(P.roles, r.id).map(roleLabel).join(' → ') });
    if (chain.has(r.id)) n.accent = 0;
    if (r.id === U.role) n.style = isDark() ? 'stroke:#5eead4,stroke-width:3px' : 'stroke:#0f766e,stroke-width:3px';
  }
  for (const r of P.roles) if (r.parent && roleById(r.parent)) g.edge(r.parent, r.id, { line: chain.has(r.id) && chain.has(r.parent) ? 'thick' : 'solid' });
  let svg = '';
  try { svg = graphSVG(g.graph, { theme: isDark() ? 'dark' : 'light', fontSize: 13 }); } catch { svg = ''; }
  els.diagram.innerHTML = svg;
  for (const n of $$('.dg-node', els.diagram)) {
    n.setAttribute('tabindex', '0'); n.setAttribute('role', 'button');
    n.setAttribute('aria-label', roleLabel(n.dataset.id));
    n.addEventListener('click', () => selectRole(n.dataset.id));
    n.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectRole(n.dataset.id); } });
  }
}

// --- members ----------------------------------------------------------------------------------------------------------

// The simulated date drives every expiry check on the page; changing it re-evaluates all members.
function renderMembers() {
  const box = els.members;
  box.textContent = '';
  box.append(h('div', { class: 'acd-tools' },
    field('ad.today', dateInput(P.now, (v) => { if (v) { P.now = v; changed(); } })),
    small(button('ad.addMember', 'plus', () => {
      const id = uid('m');
      P.members.push({ id, name: t('ad.newMember'), roleId: P.roles.at(-1)?.id || null, isOwner: false, objects: [], expiresAt: '', roleExpiresAt: '', objectsExpiresAt: '', extra: [] });
      U.member = id; keepUI(); changed();
    }))), h('p', { class: 'ed-hint' }, t('ad.todayHint')));
  const list = h('div', { class: 'acd-mlist', role: 'list' });
  for (const m of P.members) {
    const acc = memberAccess(m);
    const status = !acc ? chip(t('ad.noAccess'), 'bad') : acc.lapsed.length ? chip(acc.lapsed.map((l) => t('ad.lapsed.' + l)).join(', '), 'warn') : chip(t('ad.live'), 'ok');
    list.append(h('button', { type: 'button', role: 'listitem', class: 'acd-mitem' + (m.id === U.member ? ' acd-on' : ''), 'aria-current': m.id === U.member ? 'true' : null, onclick: () => { U.member = m.id; keepUI(); renderMembers(); } },
      h('span', { class: 'acd-mitem-n' }, m.name, m.isOwner ? chip(t('ad.owner'), 'acc') : null), h('span', { class: 'acd-mitem-r' }, roleLabel(m.roleId)), status));
  }
  box.append(list);
  const m = memberById(U.member);
  if (m) box.append(memberEditor(m));
}

// null = all objects (no restriction), [] = none: distinct states, hence the separate "all" switch.
function objectsPicker(list, onChange) {
  const all = list == null;
  const wrap = h('div', { class: 'acd-objs' });
  const checks = checkList(P.objects.map((o) => ({ v: o.id, l: o.name })), list || [], (v) => onChange(v), t('ad.objects'));
  if (all) checks.hidden = true;
  wrap.append(h('label', { class: 'acd-check' }, toggleEl(all, (v) => onChange(v ? null : [])), h('span', {}, t('ad.allObjects'))), checks);
  return wrap;
}
const toggleEl = (v, fn) => toggle(v, fn);

function memberEditor(m) {
  const acc = memberAccess(m);
  const box = h('div', { class: 'acd-medit', dataset: { id: m.id } });
  box.append(h('div', { class: 'acd-grid2' },
    field('ad.memberName', textInput(m.name, (v) => { m.name = v; save(); })),
    field('ad.role', selectEl(roleOptions(t('ad.noRoleOpt')), m.roleId || '', (v) => { m.roleId = v || null; changed(); })),
    field('ad.membershipUntil', dateInput(m.expiresAt, (v) => { m.expiresAt = v; changed(); }), 'ad.untilHint'),
    field('ad.roleUntil', dateInput(m.roleExpiresAt, (v) => { m.roleExpiresAt = v; changed(); }))),
  h('div', { class: 'acd-grid2' },
    group('ad.objects', objectsPicker(m.objects, (v) => { m.objects = v; changed(); })),
    h('div', {}, field('ad.objectsUntil', dateInput(m.objectsExpiresAt, (v) => { m.objectsExpiresAt = v; changed(); })),
      field('ad.isOwner', toggle(m.isOwner, (v) => { m.isOwner = v; changed(); }), 'ad.isOwnerHint'))));

  const grants = h('div', { class: 'acd-extra' });
  m.extra.forEach((g, i) => {
    const sec = Object.keys(g.grants)[0] || secIds()[0];
    const acts = g.grants[sec] || [];
    const live = isLiveDate(g.expiresAt);
    grants.append(h('div', { class: 'acd-extra-r' + (live ? '' : ' acd-lapsed') },
      h('div', { class: 'acd-extra-top' }, h('b', {}, t('ad.personalN', { n: i + 1 })), live ? null : chip(t('ad.lapsed.grant'), 'warn'), h('span', { class: 'ed-spacer' }),
        h('button', { type: 'button', class: 'ed-iconbtn', 'aria-label': t('ad.remove'), title: t('ad.remove'), onclick: () => { m.extra.splice(i, 1); changed(); } }, iconEl('trash'))),
      h('div', { class: 'acd-grid2' },
        field('ad.section', selectEl(secIds().map((s) => ({ v: s, l: secLabel(s) })), sec, (v) => { g.grants = { [v]: acts.length ? acts : [P.readAction] }; changed(); })),
        field('ad.until0', dateInput(g.expiresAt, (v) => { g.expiresAt = v; changed(); }))),
      group('ad.actions', checkList(P.actions.map((a) => ({ v: a, l: actLabel(a) })), acts.includes('*') ? P.actions : acts, (v) => { if (v.length) g.grants = { [sec]: v }; else delete g.grants[sec]; changed(); }, t('ad.actions'))),
      group('ad.objects', objectsPicker(g.objects, (v) => { g.objects = v; changed(); }))));
  });
  box.append(h('h3', { class: 'acd-h3' }, t('ad.personal')), grants,
    small(button('ad.addGrant', 'plus', () => { m.extra.push({ grants: secIds().length ? { [secIds()[0]]: [P.readAction] } : {}, objects: null, expiresAt: '' }); changed(); })));

  // Summary of the computed access.
  const sum = h('div', { class: 'acd-sum' });
  if (!acc) sum.append(note('error', t('ad.noAccessWhy')));
  else {
    sum.append(h('div', { class: 'acd-sum-h' }, t('ad.effective', { n: rightNames(acc.grants).length }), ' · ',
      acc.objects == null ? t('ad.allObjects') : t('ad.objectsN', { n: acc.objects.length, list: acc.objects.map(objLabel).join(', ') || '—' })));
    if (acc.lapsed.length) sum.append(note('warn', t('ad.askRenew', { list: acc.lapsed.map((l) => t('ad.lapsed.' + l)).join(', ') })));
  }
  const del = small(button('ad.removeMember', 'trash', () => { P.members = P.members.filter((x) => x !== m); delete P.policy.members[m.id]; delete P.modules.members[m.id]; changed(); }, 'danger'));
  box.append(sum, h('div', { class: 'ap-actions' }, del));
  return box;
}

// --- view as --------------------------------------------------------------------------------------------------------

// "View as" (impersonation) is allowed by canViewAs only when the viewer is an owner, or has view on the configured
// admin section AND the target's rights and objects are within the viewer's - you cannot borrow rights you do not
// have. The explanation below mirrors those checks in the same order to name the failing one.
function renderViewAs() {
  const box = els.viewas;
  box.textContent = '';
  if (!memberById(U.viewer)) U.viewer = P.members[0]?.id;
  if (!memberById(U.target)) U.target = P.members.at(-1)?.id;
  box.append(h('div', { class: 'acd-grid2' },
    field('ad.viewer', selectEl(memberOptions(), U.viewer, (v) => { U.viewer = v; keepUI(); renderViewAs(); })),
    field('ad.target', selectEl(memberOptions(), U.target, (v) => { U.target = v; keepUI(); renderViewAs(); }))));
  const vm = memberById(U.viewer), tm = memberById(U.target);
  if (!vm || !tm) return;
  const va = memberAccess(vm), ta = memberAccess(tm);
  let ok = false, why;
  if (!va) why = t('ad.va.viewerNone', { who: vm.name });
  else if (!ta) why = t('ad.va.targetNone', { who: tm.name });
  else {
    const viewer = { isOwner: vm.isOwner, grants: va.grants, objects: va.objects }, target = { isOwner: tm.isOwner, grants: ta.grants, objects: ta.objects };
    ok = canViewAs(viewer, target, { adminSection: P.viewAsSection });
    if (vm.isOwner) why = t('ad.va.owner');
    // KNOWN DEFECT: the explanation hardcodes the action 'view', while the model's read action is configurable
    // (P.readAction); after renaming it the reason shown can disagree with canViewAs. Fix: use P.readAction here (and
    // pass it to canViewAs if the library accepts it).
    else if (!P.viewAsSection || !can(va.grants, P.viewAsSection, 'view')) why = P.viewAsSection ? t('ad.va.noAdmin', { s: secLabel(P.viewAsSection) }) : t('ad.va.noSection');
    else if (!grantsWithin(ta.grants, va.grants)) {
      const mine = new Set(rightNames(va.grants));
      const wider = rightNames(ta.grants).filter((x) => !mine.has(x)).map((x) => { const [s, a] = x.split('.'); return `${secLabel(s)} · ${actLabel(a)}`; });
      why = t('ad.va.wider', { list: wider.slice(0, 8).join(', ') + (wider.length > 8 ? '…' : '') });
    } else if (va.objects != null && (ta.objects == null || ta.objects.some((o) => !va.objects.includes(o)))) {
      why = ta.objects == null ? t('ad.va.allObjects') : t('ad.va.objects', { list: ta.objects.filter((o) => !va.objects.includes(o)).map(objLabel).join(', ') });
    } else why = t('ad.va.covered');
  }
  box.append(h('div', { class: 'acd-va', dataset: { allowed: String(ok) } }, note(ok ? 'ok' : 'error', (ok ? t('ad.va.yes', { a: vm.name, b: tm.name }) : t('ad.va.no', { a: vm.name, b: tm.name })) + ' ' + why)));
  if (!ok || !ta) return;
  // Preview: what the target gets, after the modules of their views (hidden / off modules give no rights).
  // Sections whose module is hidden or switched off are shown dimmed with the module responsible.
  const lv = viewsFor(P.modules.catalog, P.modules.enabled, viewLevels({ member: tm }));
  const kept = applyModules(secIds(), lv.views, P.modules.catalog);
  const grid = h('div', { class: 'acd-preview' });
  for (const s of secIds()) {
    const set = ta.grants.get(s);
    if (!set) continue;
    const acts = P.actions.filter((a) => set.has('*') || set.has(a));
    const off = !kept.has(s);
    const mod = Object.keys(P.modules.catalog).find((id) => (P.modules.catalog[id].sections || []).includes(s));
    grid.append(h('div', { class: 'acd-pv' + (off ? ' acd-pv-off' : '') }, h('b', {}, secLabel(s)), h('span', { class: 'acd-pv-a' }, acts.map((a) => h('span', { title: actLabel(a), class: 'acd-pv-i' }, actGlyph(a)))),
      off ? chip(t('ad.va.byModule', { m: modLabel(mod) }), 'muted') : null));
  }
  box.append(h('h3', { class: 'acd-h3' }, t('ad.va.preview', { who: tm.name })), grid,
    h('p', { class: 'ed-hint' }, ta.objects == null ? t('ad.allObjects') : t('ad.objectsN', { n: ta.objects.length, list: ta.objects.map(objLabel).join(', ') || '—' }), ' · ', t('ad.va.readOnly')));
}

startShell('roles', () => renderAll());
onSchemeChange(() => renderDiagram());
renderAll();
