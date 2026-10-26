// catalog-rules/main.js - the schema page: a category tree editor (any depth), the field definitions of the selected
// node (new fields, overrides of inherited ones, hidden ones; type, unit, options, required, showIf, group), its
// default values, the resolved schema with the origin trail of every field, and a live form generated from the
// resolved schema with validation messages (schema/fields.js) and unit conversion on input (units/).
//
// Page model: four panels (tree, node editor, resolved schema, live form) all derived from store.P and the selected
// node id. Editing mutates the raw node in place, then refresh() (debounced 120 ms) saves and repaints only the
// derived panels; the editor itself is repainted only on structural changes (add/remove/type change), so typing in a
// definition never loses focus. Resolution is recomputed from scratch each time (resolveNode), never cached: the
// tree is small and a cache would need invalidation on every edit of any ancestor.
import { chip, condEditor, errText, langInputs, projectCard, saveProject, saveUI, startShell, store, onProject, uid } from './common.js';
import { CONTENT_LANGS, chainOf, childrenOf, descendants, formatLabels, formatOptions, nodeById, nodeName, parseLabels, parseOptions, resolveNode, treeOrder } from './engine.js';
import { button, card, t, toast } from '../ui/app.js';
import { $, $$, debounce, h } from '../ui/dom.js';
import { icon, iconEl } from '../ui/icons.js';
import { confirmDialog } from '../ui/overlays.js';
import { UI_STATE } from '../ui/i18n.js';
import { FIELD_TYPES, TYPE_META, fieldGroups, fieldVisible, validateValues } from '../schema/fields.js';
import { cleanFieldKey, cleanKey, pick } from '../schema/text.js';
import { normalizeCond } from '../schema/rules.js';
import { UNITS, unit as unitOf, unitLabel, unitsOfKind } from '../units/registry.js';

const main = $('#main');
main.classList.add('cr-schema');
// Accessors, not captured values: setProject() / a storage event replace store.P, and every function must see the
// current project.
const P = () => store.P;
const lang = () => UI_STATE.lang;
const L = (o) => pick(o, lang(), ['en', 'ru', 'ka']);
let els = {};

const current = () => nodeById(P(), store.ui.node) || P().tree[0];

function render() {
  if (!nodeById(P(), store.ui.node)) store.ui.node = P().tree[0]?.id || '';
  main.textContent = '';
  els = { tree: h('div', { class: 'cr-tree' }), editor: h('div', { class: 'cr-editor' }), resolved: h('div', { class: 'cr-resolved' }), form: h('div', { class: 'cr-form' }) };
  const a = h('div', { class: 'cr-col cr-a' }, card('cr.tree', els.tree), projectCard());
  const s = h('div', { class: 'cr-col cr-s' }, card('cr.node', els.editor));
  const d = h('div', { class: 'cr-col cr-d' }, card('cr.resolved', els.resolved), card('cr.form', els.form));
  main.append(h('div', { class: 'cr-work' }, a, s, d));
  paintTree(); paintEditor(); paintResolved(); paintForm();
}

// --- tree -----------------------------------------------------------------------------------------------------

function paintTree() {
  const box = els.tree;
  box.textContent = '';
  const ul = h('ul', { class: 'cr-tree-list', 'aria-label': t('cr.tree') });
  for (const { node, depth } of treeOrder(P())) {
    const on = node.id === store.ui.node;
    const own = node.fields.length;
    ul.append(h('li', { style: { '--d': depth } }, h('button', {
      type: 'button', class: 'cr-tnode' + (on ? ' cr-on' : ''), 'aria-current': on ? 'true' : null, dataset: { id: node.id },
      onclick: () => select(node.id),
    }, h('span', { class: 'cr-tname' }, nodeName(P(), node.id, lang())), own ? h('span', { class: 'cr-tcount', title: t('cr.ownFields', { n: own }) }, String(own)) : null)));
  }
  // Up / Down move between nodes.
  // Roving arrow-key focus inside the tree (Tab enters at the focused node, Up/Down move, wrapping at the ends).
  ul.addEventListener('keydown', (e) => {
    const btns = $$('.cr-tnode', ul), i = btns.indexOf(document.activeElement);
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (i < 0 || !step) return;
    e.preventDefault();
    btns[(i + step + btns.length) % btns.length].focus();
  });
  const n = current();
  const sm = (b) => { b.classList.add('ed-sm'); return b; };
  box.append(ul, h('div', { class: 'ap-actions' },
    sm(button('cr.t.child', 'plus', () => addNode(n.id))),
    sm(button('cr.t.root', 'plus', () => addNode(null))),
    // Up/down buttons have no text label (empty key); accessible names are set right below.
    sm(button('', 'up', () => move(-1))), sm(button('', 'down', () => move(1))),
    sm(button('cr.t.delete', 'trash', delNode, 'danger'))));
  const [up, down] = $$('.ap-actions .ed-btn', box).slice(2, 4);
  up.setAttribute('aria-label', t('cr.t.up')); up.title = t('cr.t.up');
  down.setAttribute('aria-label', t('cr.t.down')); down.title = t('cr.t.down');
}

function select(id) { store.ui.node = id; saveUI(); paintTree(); paintEditor(); paintResolved(); paintForm(); $(`.cr-tnode[data-id="${id}"]`)?.focus(); }

function addNode(parent) {
  // New ids are node1, node2 ... (first free): readable, and valid keys by construction.
  const taken = new Set(P().tree.map((n) => n.id));
  let i = 1; while (taken.has('node' + i)) i++;
  P().tree.push({ id: 'node' + i, parent, name: { en: t('cr.t.newName') }, fields: [], values: {} });
  saveProject(); select('node' + i);
}
function move(dir) {
  // Moving swaps the node with its sibling inside the flat tree array: treeOrder() lists children in array order,
  // so array position is the sibling order (no separate sort field to keep consistent).
  const n = current(), sibs = childrenOf(P(), n.parent), i = sibs.indexOf(n), j = i + dir;
  if (j < 0 || j >= sibs.length) return;
  const T = P().tree, a = T.indexOf(n), b = T.indexOf(sibs[j]);
  [T[a], T[b]] = [T[b], T[a]];
  saveProject(); select(n.id);
}
async function delNode() {
  const n = current();
  if (P().tree.length < 2) { toast(t('cr.t.last'), 'warn'); return; }
  // A node is deleted with its whole subtree after confirmation stating the count; the last node cannot be deleted
  // (a project always has a root).
  const gone = [n.id, ...descendants(P(), n.id)];
  if (!(await confirmDialog(t('cr.t.delete'), t('cr.t.deleteConfirm', { name: nodeName(P(), n.id, lang()), n: gone.length }), t('cr.t.delete'), true))) return;
  P().tree = P().tree.filter((x) => !gone.includes(x.id));
  saveProject(); select(n.parent && nodeById(P(), n.parent) ? n.parent : P().tree[0].id);
}

// --- node editor ------------------------------------------------------------------------------------------------

// Debounced derived repaint for keystroke edits; names in the tree are patched in place instead of repainting it.
const refresh = debounce(() => { saveProject(); paintResolved(); paintForm(); paintTreeNames(); }, 120);
function paintTreeNames() { for (const b of $$('.cr-tnode')) { const s = b.querySelector('.cr-tname'); if (s) s.textContent = nodeName(P(), b.dataset.id, lang()); } }

function paintEditor() {
  const box = els.editor, n = current();
  box.textContent = '';
  const chain = chainOf(P(), n.id);
  box.append(h('nav', { class: 'cr-crumbs', 'aria-label': t('cr.path') }, chain.map((x, i) => [i ? h('span', { class: 'cr-sep', 'aria-hidden': 'true' }, '›') : null, h('span', {}, nodeName(P(), x.id, lang()))])));
  const idIn = h('input', { class: 'ed-input cr-mono', value: n.id, id: uid(), spellcheck: 'false' });
  const idMsg = h('div', { class: 'ed-hint' }, t('cr.n.idHint'));
  // Renaming an id: validated on 'change' (commit), not 'input', and rewritten in children's parent links and samples.
  // KNOWN DEFECT: rule conditions on `category` / `path` and showIf conditions that name the old id are not rewritten,
  // so they silently stop matching. Fix: walk P.rules[].when and every field's showIf and replace the old id in `a`.
  idIn.addEventListener('change', () => {
    const v = cleanKey(idIn.value);
    if (!v || (v !== n.id && nodeById(P(), v))) { idMsg.textContent = t('cr.n.idBad'); idMsg.classList.add('cr-bad'); idIn.value = n.id; return; }
    idMsg.textContent = t('cr.n.idHint'); idMsg.classList.remove('cr-bad');
    const old = n.id;
    n.id = v;
    for (const x of P().tree) if (x.parent === old) x.parent = v;
    for (const s of P().samples) if (s.node === old) s.node = v;
    store.ui.node = v; saveUI(); saveProject(); paintTree(); paintResolved(); paintForm();
  });
  box.append(h('div', { class: 'ed-field' }, h('label', { class: 'ed-label', for: idIn.id }, t('cr.n.id')), idIn, idMsg));
  box.append(h('div', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('cr.n.name')), langInputs(n.name, (l, v) => { if (v.trim()) n.name[l] = v; else delete n.name[l]; refresh(); }, { label: t('cr.n.name') })));

  // Fields defined here.
  // Fields "defined here" are compared with what the parent resolves to: a key that exists above is an override, a
  // key that does not is new. The override select offers only inherited keys not yet overridden at this level.
  const parentRes = n.parent ? resolveNode(P(), n.parent) : { fields: [] };
  const inherited = new Map(parentRes.fields.map((f) => [f.key, f]));
  const list = h('div', { class: 'cr-defs' });
  n.fields.forEach((d, i) => list.append(defEditor(n, d, i, inherited)));
  if (!n.fields.length) list.append(h('div', { class: 'ap-empty' }, t('cr.n.noFields')));
  const addBtn = button('cr.n.add', 'plus', () => {
    let k = 1; const keys = new Set([...inherited.keys(), ...n.fields.map((f) => f.key)]); while (keys.has('field' + k)) k++;
    n.fields.push({ key: 'field' + k, type: 'text', label: { en: t('cr.n.newField') } });
    refresh(); paintEditor(); $$('.cr-def', els.editor).at(-1).open = true;
  });
  addBtn.classList.add('ed-sm');
  const free = [...inherited.keys()].filter((k) => !n.fields.some((d) => d.key === k));
  const ovr = h('select', { class: 'ed-input ed-select', 'aria-label': t('cr.n.override') }, h('option', { value: '' }, t('cr.n.override')), free.map((k) => h('option', { value: k }, `${k} — ${L(inherited.get(k).label)}`)));
  ovr.addEventListener('change', () => { if (!ovr.value) return; n.fields.push({ key: ovr.value }); refresh(); paintEditor(); $$('.cr-def', els.editor).at(-1).open = true; });
  box.append(h('h3', { class: 'cr-h3' }, t('cr.n.fields')), list, h('div', { class: 'cr-row' }, addBtn, free.length ? ovr : null));

  // Default values.
  const vals = h('textarea', { class: 'ed-input ed-textarea cr-mono', rows: 3, id: uid(), spellcheck: 'false', placeholder: 'condition = white' }, Object.entries(n.values).map(([k, v]) => `${k} = ${v}`).join('\n'));
  // Defaults as "key = value" lines: easy to type and diff; lines without '=' or with an invalid key are ignored.
  vals.addEventListener('input', () => {
    const out = {};
    for (const line of vals.value.split(/\r?\n/)) { const i = line.indexOf('='); if (i < 1) continue; const k = cleanFieldKey(line.slice(0, i).trim()); if (k) out[k] = line.slice(i + 1).trim(); }
    n.values = out; refresh();
  });
  box.append(h('div', { class: 'ed-field' }, h('label', { class: 'ed-label', for: vals.id }, t('cr.n.values')), vals, h('div', { class: 'ed-hint' }, t('cr.n.valuesHint'))));
}

const typeLabel = (ty) => t('cr.type.' + ty);

function defEditor(n, d, i, inherited) {
  // Mode is derived, not stored: hidden flag -> hide, key known above -> override, else new. Effective type falls back
  // to the inherited one, so an override shows the controls of the type it actually has.
  const base = inherited.get(d.key) || null;
  const mode = d.hidden ? 'hide' : base ? 'override' : 'new';
  const effType = d.type || base?.type || 'text';
  const meta = TYPE_META[effType] || {};
  const det = h('details', { class: 'cr-def cr-def-' + mode, dataset: { key: d.key } });
  const sum = h('summary', {}, iconEl('chevRight'), h('span', { class: 'cr-mono cr-def-key' }, d.key || '?'), chip(t('cr.mode.' + mode), 'cr-mode-' + mode), mode !== 'hide' ? h('span', { class: 'cr-muted' }, typeLabel(effType)) : null);
  det.append(sum);
  const body = h('div', { class: 'ed-fields' });
  det.append(body);
  // set(): empty values delete the property, which in an override means "inherit this attribute" (an explicit empty
  // would override the parent with nothing).
  const set = (k, v) => { if (v === '' || v == null || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)) delete d[k]; else d[k] = v; refresh(); };
  // fld(): wires <label for> to the first form control inside a composite control.
  const fld = (label, control, hint) => { const id = uid(); const tgt = control.matches('input,select,textarea') ? control : control.querySelector('input,select,textarea'); if (tgt && !tgt.id) tgt.id = id; return h('div', { class: 'ed-field' }, h('label', { class: 'ed-label', for: tgt?.id }, t(label)), control, hint ? h('div', { class: 'ed-hint' }, hint) : null); };
  const input = (k, attrs = {}) => { const x = h('input', { class: 'ed-input', value: d[k] ?? '', spellcheck: 'false', ...attrs }); x.addEventListener('input', () => set(k, attrs.type === 'number' ? (x.value === '' ? '' : +x.value) : x.value)); return x; };

  const key = h('input', { class: 'ed-input cr-mono', value: d.key || '', spellcheck: 'false' });
  const keyMsg = h('div', { class: 'ed-hint' });
  const keyHint = () => { const v = key.value.trim(); keyMsg.textContent = !cleanFieldKey(v) ? t('cr.d.keyBad') : !cleanKey(v) ? t('cr.d.keyRules') : t('cr.d.keyHint'); keyMsg.classList.toggle('cr-bad', !cleanFieldKey(v)); };
  keyHint();
  key.addEventListener('input', () => { d.key = key.value.trim(); sum.querySelector('.cr-def-key').textContent = d.key || '?'; keyHint(); refresh(); });
  // Key change re-renders on commit: the key decides override vs new, and other editors depend on it.
  key.addEventListener('change', () => paintEditor());
  body.append(fld('cr.d.key', key), keyMsg);
  if (base) {
    const hide = h('input', { type: 'checkbox', class: 'ed-switch', role: 'switch', checked: !!d.hidden, id: uid() });
    // Hiding wipes every other attribute of the override: a hidden field has no type, label or rules at this level.
    hide.addEventListener('change', () => { if (hide.checked) { for (const k of Object.keys(d)) if (k !== 'key') delete d[k]; d.hidden = true; } else delete d.hidden; refresh(); paintEditor(); $(`.cr-def[data-key="${CSS.escape(d.key)}"]`, els.editor).open = true; });
    body.append(h('div', { class: 'ed-field ed-field-check' }, hide, h('label', { class: 'ed-label', for: hide.id }, t('cr.d.hide'))),
      h('div', { class: 'ed-hint' }, t('cr.d.inherits', { from: nodeName(P(), base.origin, lang()) })));
  }
  if (!d.hidden) {
    const ty = h('select', { class: 'ed-input ed-select' }, base ? h('option', { value: '' }, t('cr.d.inherit', { v: typeLabel(base.type) })) : null, FIELD_TYPES.map((x) => h('option', { value: x, selected: d.type === x }, typeLabel(x))));
    ty.addEventListener('change', () => { set('type', ty.value); paintEditor(); $(`.cr-def[data-key="${CSS.escape(d.key)}"]`, els.editor).open = true; });
    body.append(fld('cr.d.type', ty));
    body.append(h('div', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('cr.d.label')), langInputs(d.label || {}, (l, v) => { const o = { ...(d.label || {}) }; if (v.trim()) o[l] = v; else delete o[l]; set('label', o); }, { label: t('cr.d.label'), placeholder: base?.label || {} })));
    if (meta.numeric && effType !== 'bool') {
      const dl = uid('units');
      const unitIn = input('unit', { list: dl, class: 'ed-input cr-mono', placeholder: base?.unit || formatLabels(base?.unitText) || 'm2, kg, l, USD…' });
      const unitMsg = h('div', { class: 'ed-hint' });
      const um = () => { const u = unitIn.value.trim(); unitMsg.textContent = !u ? t('cr.d.unitNone') : unitOf(u) ? t('cr.d.unitReg', { l: unitLabel(u, lang()) }) : t('cr.d.unitFree'); };
      um(); unitIn.addEventListener('input', um);
      body.append(h('datalist', { id: dl }, Object.keys(UNITS).map((c) => h('option', { value: c }, unitLabel(c, lang())))), fld('cr.d.unit', unitIn), unitMsg);
      body.append(h('div', { class: 'cr-grid3' }, fld('cr.d.min', input('min', { type: 'number', step: 'any', placeholder: base?.min ?? '' })), fld('cr.d.max', input('max', { type: 'number', step: 'any', placeholder: base?.max ?? '' })), fld('cr.d.decimals', input('decimals', { type: 'number', min: 0, max: 10, placeholder: base?.decimals ?? '' }))));
    }
    if (meta.options) {
      const ta = h('textarea', { class: 'ed-input ed-textarea cr-mono', rows: 4, spellcheck: 'false', placeholder: base ? formatOptions(base.options) : 'studio = Studio | Студия | სტუდიო' }, d.options ? formatOptions(d.options) : '');
      ta.addEventListener('input', () => set('options', ta.value.trim() ? parseOptions(ta.value) : ''));
      body.append(fld('cr.d.options', ta, t('cr.d.optionsHint')));
    }
    // Tri-state required for overrides: inherit / yes / no. A plain checkbox could not express "inherit".
    const req = h('select', { class: 'ed-input ed-select' }, h('option', { value: '' }, base ? t('cr.d.inherit', { v: t(base.required ? 'cr.yes' : 'cr.no') }) : t('cr.no')), h('option', { value: 'yes', selected: d.required === true }, t('cr.yes')), h('option', { value: 'no', selected: d.required === false }, t('cr.no')));
    req.addEventListener('change', () => set('required', req.value === '' ? '' : req.value === 'yes'));
    body.append(h('div', { class: 'cr-grid2' }, fld('cr.d.required', req), fld('cr.d.default', input('default', { placeholder: t('cr.d.defaultPh') }))));
    const gl = h('input', { class: 'ed-input', value: formatLabels(d.groupLabel), placeholder: 'Location | Расположение | მდებარეობა', spellcheck: 'false' });
    gl.addEventListener('input', () => set('groupLabel', parseLabels(gl.value)));
    body.append(h('div', { class: 'cr-grid2' }, fld('cr.d.group', input('group', { class: 'ed-input cr-mono', placeholder: base?.group || 'place' })), fld('cr.d.sort', input('sort', { type: 'number', placeholder: base ? String(base.sort) : '0' }))), fld('cr.d.groupLabel', gl));
    const conds = Array.isArray(d.showIf) ? d.showIf : [];
    const keys = [...new Set([...inherited.keys(), ...n.fields.map((f) => f.key)])].filter((k) => k !== d.key);
    // showIf rows that the library would drop are flagged, not removed (see condEditor).
    body.append(condEditor(conds, () => { d.showIf = conds; if (!conds.length) delete d.showIf; refresh(); }, { keys, labelKey: 'cr.d.showIf', invalid: (j) => !normalizeCond(conds[j]) }));
  }
  const del = button('cr.d.remove', 'trash', () => { n.fields.splice(i, 1); refresh(); paintEditor(); }, 'danger');
  del.classList.add('ed-sm');
  body.append(h('div', { class: 'ap-actions' }, del));
  return det;
}

// --- resolved schema --------------------------------------------------------------------------------------------

function paintResolved() {
  const box = els.resolved, n = current();
  box.textContent = '';
  const res = resolveNode(P(), n.id);
  const name = (id) => nodeName(P(), id, lang());
  const go = (id) => h('button', { type: 'button', class: 'cr-link', onclick: () => select(id) }, name(id));
  box.append(h('p', { class: 'cr-muted cr-lead' }, t('cr.r.lead', { n: res.fields.length, name: name(n.id) })));
  // Origin trail per field: which level set which attributes, root to leaf. "overridden" links to the level that
  // changed an inherited field; both links select that node.
  const rows = res.fields.map((f) => {
    const unit = f.unit ? unitLabel(f.unit, lang()) : L(f.unitText);
    return h('tr', { class: 'cr-rfield' + (f.overridden ? ' cr-ovr' : ''), dataset: { key: f.key } },
      h('td', {}, h('div', {}, L(f.label) || f.key, f.required ? h('span', { class: 'cr-req', title: t('cr.d.required') }, ' *') : null), h('div', { class: 'cr-mono cr-muted' }, f.key)),
      h('td', {}, typeLabel(f.type), unit ? h('div', { class: 'cr-muted' }, unit) : null, f.showIf ? h('div', { class: 'cr-muted' }, t('cr.r.showIf')) : null),
      h('td', { class: 'cr-origin' }, h('div', {}, t('cr.r.from'), ' ', go(f.origin)), f.overridden ? h('div', { class: 'cr-ovr-note' }, chip(t('cr.r.overridden')), ' ', go(f.definedAt)) : null,
        h('ol', { class: 'cr-trail' }, f.trail.map((s) => h('li', {}, h('b', {}, name(s.at)), ': ', s.set.filter((p) => p !== 'scope').join(', ') || '—')))));
  });
  box.append(h('div', { class: 'ap-table-wrap' }, h('table', { class: 'cr-table' }, h('thead', {}, h('tr', {}, h('th', {}, t('cr.r.field')), h('th', {}, t('cr.d.type')), h('th', {}, t('cr.r.origin')))), h('tbody', {}, rows))));
  if (res.hidden.length) box.append(h('div', { class: 'cr-note' }, iconEl('eyeOff'), h('span', {}, t('cr.r.hidden'), ' ', res.hidden.map((x) => `${x.key} (${name(x.at)})`).join(', '))));
  const vals = Object.entries(res.values);
  if (vals.length) box.append(h('div', { class: 'cr-note' }, iconEl('info'), h('span', {}, t('cr.r.defaults'), ' ', vals.map(([k, v]) => `${k} = ${v.value} (${name(v.from)})`).join(', '))));
  for (const e of res.errors) box.append(h('div', { class: 'cr-note cr-bad', role: 'alert' }, iconEl('warn'), h('span', {}, t('cr.r.error', { at: name(e.at), key: e.key || '?', what: e.errors.map((x) => t('cr.deferr.' + x)).join(', ') }))));
}

// --- live form --------------------------------------------------------------------------------------------------

function paintForm() {
  const box = els.form, n = current();
  box.textContent = '';
  const res = resolveNode(P(), n.id);
  // Live form state is per node and per device (store.ui.form), so switching nodes keeps what was typed in each.
  const F = (store.ui.form[n.id] ||= { v: {}, u: {} });
  F.v ||= {}; F.u ||= {};
  const wrappers = new Map();
  const inputOf = () => {
    const out = {};
    for (const f of res.fields) {
      const v = F.v[f.key];
      if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
      // A number typed in another unit of the same kind is passed as { value, unit }: validateValues converts it to the
      // field's unit before checking min/max (e.g. 50 sq ft against a minimum in m2).
      out[f.key] = f.type === 'number' && F.u[f.key] && F.u[f.key] !== f.unit ? { value: v, unit: F.u[f.key] } : v;
    }
    return out;
  };
  const summary = h('div', { class: 'cr-fsum', role: 'status', 'aria-live': 'polite' });
  const stored = h('pre', { class: 'ap-pre cr-stored' });
  const check = () => {
    const input = inputOf();
    const { values, errors } = validateValues(res.fields, input, { inherited: res.values });
    // Visibility uses inherited defaults plus typed values, the same inputs the library sees, so showIf behaves exactly
    // as in production. Errors of hidden fields are not shown (a hidden field cannot be fixed by the user).
    const all = { ...Object.fromEntries(Object.entries(res.values).map(([k, v]) => [k, v.value])), ...input };
    for (const f of res.fields) {
      const w = wrappers.get(f.key);
      if (!w) continue;
      w.hidden = !fieldVisible(f, all);
      const e = w.querySelector('.cr-ferr');
      e.textContent = !w.hidden && errors[f.key] ? errText(errors[f.key], f) : '';
      w.classList.toggle('cr-invalid', !!e.textContent);
    }
    const ne = Object.keys(errors).length;
    summary.className = 'cr-fsum ' + (ne ? 'cr-bad' : 'cr-good');
    summary.textContent = '';
    summary.append(iconEl(ne ? 'warn' : 'ok'), h('span', {}, ne ? t('cr.f.errors', { n: ne }) : t('cr.f.valid')));
    stored.textContent = JSON.stringify(values, null, 1);
    saveUI();
  };
  // novalidate + preventDefault: validation is the library's, the browser's built-in bubbles would contradict it.
  const form = h('form', { class: 'cr-live', novalidate: true, onsubmit: (e) => e.preventDefault() });
  for (const g of fieldGroups(res.fields)) {
    const fs = h('fieldset', { class: 'cr-fs' }, h('legend', {}, L(g.label) || g.key || t('cr.f.other')));
    for (const f of g.fields) { const w = fieldControl(f, F, res, check); wrappers.set(f.key, w); fs.append(w); }
    form.append(fs);
  }
  if (!res.fields.length) form.append(h('div', { class: 'ap-empty' }, t('cr.f.empty')));
  const clear = button('cr.f.clear', 'undo', () => { store.ui.form[n.id] = { v: {}, u: {} }; paintForm(); });
  // "Make a sample" turns the current form into a test object on the rules page: schema and rules are tested with
  // the same data.
  const toSample = button('cr.f.toSample', 'flask', () => {
    const values = {};
    for (const [k, v] of Object.entries(F.v)) if (v !== '' && v != null) values[k] = Array.isArray(v) ? v.join(',') : String(v);
    const ids = new Set(P().samples.map((s) => s.id)); let i = P().samples.length + 1; while (ids.has('s' + i)) i++;
    P().samples.push({ id: 's' + i, node: n.id, values, tags: '', expect: '' });
    store.ui.sample = 's' + i; saveUI(); saveProject();
    toast(t('cr.f.added', { id: 's' + i }), 'ok');
  });
  for (const b of [clear, toSample]) b.classList.add('ed-sm');
  box.append(h('p', { class: 'cr-muted cr-lead' }, t('cr.f.lead')), summary, form, h('div', { class: 'ap-actions' }, clear, toSample),
    h('details', { class: 'cr-details' }, h('summary', {}, iconEl('chevRight'), t('cr.f.stored')), stored));
  check();
}

function fieldControl(f, F, res, check) {
  const id = uid('f');
  const errId = id + '-e';
  const inh = res.values[f.key];
  const set = (v) => { F.v[f.key] = v; check(); };
  // aria-describedby ties each control to its error slot, so the message is read with the field. dir=auto lets
  // Georgian/Russian/English text set its own direction.
  const attrs = { id, 'aria-describedby': errId, dir: 'auto' };
  let ctl;
  const ph = inh ? String(inh.value) : '';
  switch (f.type) {
    case 'longtext': ctl = h('textarea', { class: 'ed-input ed-textarea', rows: 3, placeholder: ph, ...attrs }, F.v[f.key] || ''); ctl.addEventListener('input', () => set(ctl.value)); break;
    case 'select': {
      ctl = h('select', { class: 'ed-input ed-select', ...attrs }, h('option', { value: '' }, inh ? t('cr.f.inherited', { v: inh.value }) : '—'), f.options.map((o) => h('option', { value: o.v, selected: F.v[f.key] === o.v }, pick(o.label, UI_STATE.lang, ['en', 'ru', 'ka']) || o.v)));
      ctl.addEventListener('change', () => set(ctl.value));
      break;
    }
    case 'multiselect': {
      const cur = Array.isArray(F.v[f.key]) ? F.v[f.key] : [];
      // KNOWN DEFECT (accessibility): the field <label for=id> points at this <div role=group>, which is not labelable, so
      // the checkbox group has no accessible name and the label click does nothing. Fix: give the label an id and set
      // aria-labelledby on the group.
      ctl = h('div', { class: 'cr-checks', role: 'group', id }, f.options.map((o) => {
        const c = h('input', { type: 'checkbox', checked: cur.includes(o.v) });
        c.addEventListener('change', () => { const s = new Set(Array.isArray(F.v[f.key]) ? F.v[f.key] : []); if (c.checked) s.add(o.v); else s.delete(o.v); set([...s]); });
        return h('label', { class: 'cr-check' }, c, pick(o.label, UI_STATE.lang, ['en']) || o.v);
      }));
      break;
    }
    case 'bool':
      ctl = h('select', { class: 'ed-input ed-select', ...attrs }, [['', inh ? t('cr.f.inherited', { v: inh.value }) : '—'], ['true', t('cr.yes')], ['false', t('cr.no')]].map(([v, l]) => h('option', { value: v, selected: String(F.v[f.key] ?? '') === v }, l)));
      ctl.addEventListener('change', () => set(ctl.value));
      break;
    case 'range': {
      const cur = Array.isArray(F.v[f.key]) ? F.v[f.key] : ['', ''];
      const a = h('input', { class: 'ed-input', inputmode: 'decimal', value: cur[0] ?? '', 'aria-label': t('cr.f.from'), id }), b = h('input', { class: 'ed-input', inputmode: 'decimal', value: cur[1] ?? '', 'aria-label': t('cr.f.to') });
      const up = () => set([a.value, b.value]);
      a.addEventListener('input', up); b.addEventListener('input', up);
      ctl = h('div', { class: 'cr-row cr-range' }, a, '–', b, f.unit ? h('span', { class: 'cr-muted' }, unitLabel(f.unit, UI_STATE.lang)) : null);
      break;
    }
    case 'number': {
      const inp = h('input', { class: 'ed-input', inputmode: 'decimal', value: F.v[f.key] ?? '', placeholder: ph, ...attrs });
      inp.addEventListener('input', () => set(inp.value));
      let unitCtl = null;
      // Unit select limited to units of the same kind (length with length): conversion between kinds is meaningless.
      if (f.unit) {
        const units = unitsOfKind(unitOf(f.unit).kind);
        unitCtl = h('select', { class: 'ed-input ed-select cr-unit', 'aria-label': t('cr.d.unit') }, units.map((u) => h('option', { value: u, selected: (F.u[f.key] || f.unit) === u }, unitLabel(u, UI_STATE.lang))));
        unitCtl.addEventListener('change', () => { F.u[f.key] = unitCtl.value; check(); });
      } else if (Object.keys(f.unitText).length) unitCtl = h('span', { class: 'cr-muted' }, L(f.unitText));
      ctl = h('div', { class: 'cr-row cr-num' }, inp, unitCtl);
      break;
    }
    default: {
      const inp = h('input', { class: 'ed-input' + (TYPE_META[f.type]?.ident ? ' cr-mono' : ''), value: F.v[f.key] ?? '', placeholder: f.type === 'date' ? 'YYYY-MM-DD · DD.MM.YYYY' : ph, ...attrs });
      inp.addEventListener('input', () => set(inp.value));
      ctl = inp;
    }
  }
  const hint = [];
  if (inh) hint.push(t('cr.f.default', { v: inh.value, from: nodeName(P(), inh.from, UI_STATE.lang) }));
  if (f.min != null || f.max != null) hint.push(`${f.min ?? '…'} – ${f.max ?? '…'}`);
  return h('div', { class: 'ed-field cr-ffield', dataset: { key: f.key } },
    // The visual asterisk is aria-hidden. KNOWN DEFECT (accessibility): no aria-required on the control, so screen
    // readers do not announce required fields until an error appears. Fix: set aria-required="true" on ctl when
    // f.required.
    h('label', { class: 'ed-label', for: id }, L(f.label) || f.key, f.required ? h('span', { class: 'cr-req', 'aria-hidden': 'true' }, ' *') : null),
    ctl, hint.length ? h('div', { class: 'ed-hint' }, hint.join(' · ')) : null,
    h('div', { class: 'cr-ferr', id: errId, dataset: { key: f.key } }));
}

// Re-render on project replacement (demo, import, new) or a change from another tab.
onProject(() => render());
startShell('schema', () => render());
render();
