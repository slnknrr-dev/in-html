// access-designer/doc.js - exports of the project shared by every page: the project card (JSON export and import, CSV
// of the permission matrix, printable documentation of the access model, demo reset), the CSV itself (every role ×
// section × action with the role that granted or revoked the cell, formula-injection safe) and the documentation
// sheet (sections, roles with chains, the matrix, members, data policy, modules, session scope, configuration).
import { button, card, download, t, toast } from '../ui/app.js';
import { h } from '../ui/dom.js';
import { pickFiles } from '../ui/files.js';
import { confirmDialog } from '../ui/overlays.js';
import { grantMatrix, normalizeGrants, roleChain } from '../access/roles.js';
import { resolvePolicy } from '../access/policy.js';
import { viewsFor } from '../access/modules.js';
import { normalizeScope, scopeText } from '../access/scope.js';
import { serializeCSV } from '../csv/csv.js';
import {
  P, actLabel, fmtDate, presetProject, selectEl, memberAccess, modLabel, normalizeProject, objLabel, policyLevels, policyModel, printNode, replaceProject,
  roleLabel, ruleLabel, scopeModel, secIds, secLabel, viewLevels,
} from './common.js';
import { configSnapshot } from './configmodel.js';
import { PRESETS } from './presets.js';

// Exports are views of the same project through the same access/ library calls the pages use, so the CSV and the
// printed documentation can never disagree with what the designer shows.
const PRESET_IDS = Object.keys(PRESETS);

// Import validates through normalizeProject (null for foreign or broken JSON) before replacing anything; preset and
// empty loads ask for confirmation because they overwrite the whole project.
export function projectCard(onChange) {
  const b = (l, ic, fn, kind) => { const x = button(l, ic, fn, kind); x.classList.add('ed-sm'); return x; };
  const exportJSON = () => download(JSON.stringify(P, null, 2), 'access-model.json', 'application/json');
  const importJSON = async () => {
    const [f] = await pickFiles({ accept: '.json,application/json' });
    if (!f) return;
    let next = null;
    try { next = normalizeProject(JSON.parse(await f.text())); } catch { next = null; }
    if (!next) { toast(t('ad.x.badFile'), 'error'); return; }
    replaceProject(next);
    toast(t('ad.x.imported'), 'ok');
    onChange();
  };
  let choice = P.preset && PRESETS[P.preset] ? P.preset : PRESET_IDS[0];
  const load = async (id) => {
    if (!(await confirmDialog(t('ad.x.loadTitle'), t('ad.x.loadText', { p: t('ad.pr.' + id) }), t('ad.x.load'), true))) return;
    replaceProject(presetProject(id));
    toast(t('ad.x.loaded', { p: t('ad.pr.' + id) }), 'ok');
    onChange();
  };
  const presetSel = selectEl(PRESET_IDS.map((id) => ({ v: id, l: t('ad.pr.' + id) })), choice, (v) => { choice = v; hint.textContent = t('ad.pr.' + v + '.about'); }, { 'aria-label': t('ad.x.presets'), id: 'acd-preset' });
  const hint = h('div', { class: 'ed-hint' }, t('ad.pr.' + choice + '.about'));
  const c = card('ad.x.title',
    h('p', { class: 'ed-hint acd-mt0' }, t('ad.x.hint')),
    h('div', { class: 'ap-actions' },
      b('ad.x.json', 'download', exportJSON, 'primary'), b('ad.x.import', 'upload', importJSON),
      b('ad.x.csv', 'sheet', () => download(matrixCSV(), 'access-matrix.csv', 'text/csv')),
      b('ad.x.docs', 'print', printDocs)),
    h('div', { class: 'acd-presets' }, h('span', { class: 'ed-label' }, t('ad.x.presets')),
      h('div', { class: 'acd-addrow' }, presetSel, (() => { const x = b('ad.x.load', 'refresh', () => load(choice)); x.id = 'acd-load-preset'; return x; })()), hint,
      (() => { const x = b('ad.x.empty', 'filePlus', () => load('empty')); x.id = 'acd-new-empty'; return x; })()));
  c.classList.add('acd-project');
  return c;
}

// --- CSV of the matrix ---------------------------------------------------------------------------------------------

// One row per role x section x action with provenance (which role granted, which revoked): reviewable in a
// spreadsheet. guard: true prefixes cells starting with = + - @ so a spreadsheet does not execute them as formulas
// (role names are user-typed).
export function matrixCSV() {
  const m = grantMatrix(P.roles, secIds(), P.actions);
  const rows = [['role_id', 'role', 'chain', 'section', 'action', 'allowed', 'granted_by', 'revoked_by']];
  for (const r of P.roles) {
    const chain = roleChain(P.roles, r.id).map(roleLabel).join(' > ');
    for (const s of secIds()) for (const a of P.actions) {
      const c = m[r.id][s][a];
      rows.push([r.id, roleLabel(r.id), chain, s, a, c.allowed ? 'yes' : 'no', c.from || '', c.revokedAt || '']);
    }
  }
  return serializeCSV(rows, { guard: true });
}

// --- documentation ------------------------------------------------------------------------------------------------

const table = (head, rows, cls = '') => h('table', { class: 'acd-doc-t ' + cls }, h('thead', {}, h('tr', {}, head.map((x) => h('th', {}, x)))), h('tbody', {}, rows.map((r) => h('tr', {}, r.map((x) => h('td', {}, x))))));
const grantText = (g) => Object.entries(normalizeGrants(g)).map(([s, a]) => `${secLabel(s)}: ${a.includes('*') ? t('ad.all') : a.map(actLabel).join(', ')}`).join('; ') || '—';

// Documentation sheet: every section uses the library to compute effective values (grant matrix, resolved policy,
// module views per role), not raw stored settings. Matrix marks: dot = own grant, arrow = inherited from the named
// role, cross = revoked at the named role.
export function docNode() {
  const out = h('article', { class: 'acd-doc' });
  const sec = (title, ...kids) => out.append(h('section', {}, h('h2', {}, t(title)), ...kids));
  out.append(h('h1', {}, P.name || t('ad.doc.title')), h('p', { class: 'acd-doc-sub' }, t('ad.doc.sub', { date: fmtDate(P.now) })));

  sec('ad.doc.sections', table([t('ad.sections'), t('ad.actions')], [[secIds().map(secLabel).join(', '), P.actions.map(actLabel).join(', ')]]));
  sec('ad.doc.roles', table([t('ad.role'), t('ad.chain'), t('ad.grants'), t('ad.revokes')],
    P.roles.map((r) => [roleLabel(r.id), roleChain(P.roles, r.id).map(roleLabel).join(' → '), grantText(r.grants), grantText(r.revoke)])));

  const m = grantMatrix(P.roles, secIds(), P.actions);
  const mark = (c, id) => (c.allowed ? (c.from === id ? '●' : '↑ ' + roleLabel(c.from)) : c.revokedAt ? '✕ ' + roleLabel(c.revokedAt) : '');
  sec('ad.doc.matrix', h('p', { class: 'acd-doc-sub' }, t('ad.doc.legend')),
    table([t('ad.sections'), ...P.roles.map((r) => roleLabel(r.id))],
      secIds().flatMap((s) => P.actions.map((a) => [`${secLabel(s)} · ${actLabel(a)}`, ...P.roles.map((r) => mark(m[r.id][s][a], r.id))])), 'acd-doc-m'));

  sec('ad.doc.members', table([t('ad.member'), t('ad.role'), t('ad.objects'), t('ad.personal'), t('ad.status')],
    P.members.map((mb) => {
      const acc = memberAccess(mb);
      return [mb.name + (mb.isOwner ? ` (${t('ad.owner')})` : ''), roleLabel(mb.roleId),
        mb.objects == null ? t('ad.allObjects') : mb.objects.map(objLabel).join(', ') || '—',
        mb.extra.map((g) => grantText(g.grants) + (g.expiresAt ? ` (${t('ad.until', { d: fmtDate(g.expiresAt) })})` : '')).join('; ') || '—',
        !acc ? t('ad.noAccess') : acc.lapsed.length ? acc.lapsed.map((l) => t('ad.lapsed.' + l)).join(', ') : t('ad.live')];
    })));

  const model = policyModel();
  sec('ad.doc.policy', table([t('ad.member'), t('ad.mode'), t('ad.overrides')],
    P.members.map((mb) => {
      const res = resolvePolicy(model, policyLevels({ member: mb }));
      const ov = Object.entries(res.rules).filter(([, r]) => r.from !== 'mode').map(([k, r]) => `${ruleLabel(k)} = ${t('ad.val.' + r.value)} (${r.from.label})`);
      return [mb.name, `${t('ad.mode.' + res.mode)} (${res.modeFrom === 'default' ? t('ad.lvl.default') : res.modeFrom.label})`, ov.join('; ') || '—'];
    })));

  const cat = P.modules.catalog;
  sec('ad.doc.modules', table([t('ad.module'), t('ad.on'), t('ad.deps'), ...P.roles.map((r) => roleLabel(r.id))],
    Object.keys(cat).map((id) => [modLabel(id), P.modules.enabled.includes(id) ? '✓' : '—', (cat[id].deps || []).map(modLabel).join(', ') || '—',
      ...P.roles.map((r) => { const v = viewsFor(cat, P.modules.enabled, viewLevels({ roleId: r.id })).views[id]; return t('ad.view.' + v); })])));

  const sm = scopeModel(), s = P.sessions;
  sec('ad.doc.sessions', table([t('ad.s.scope'), t('ad.s.ttl'), t('ad.s.idle'), t('ad.s.allow')],
    [[scopeText(normalizeScope(s.scope, sm)) || t('ad.s.full'), t('ad.ttl.' + s.ttl), t('ad.idle.' + s.idle), (s.readonlyAllow || []).join(', ')]]));

  const snap = configSnapshot();
  sec('ad.doc.config', table([t('ad.c.key'), t('ad.c.value'), t('ad.c.source')],
    Object.entries(snap.snapshot).map(([k, v]) => [k, v.value === undefined ? '—' : JSON.stringify(v.value), v.source || '—'])));
  return out;
}

export const printDocs = () => printNode(docNode());
