// knowledge-processor/ed-pages.js - the page tree of the editor: hierarchy (parent / order), filter, badges (home,
// secret, hidden, redirect, versions), the page actions (new page / child page / secret page, rename, move, order,
// make home, duplicate, make secret / public, delete) from the toolbar, keyboard and the context menu (right click,
// long press, Menu key).
//
// Data model used here: pages form a forest through `parent` (id or '') and `order` (sibling position, may have
// gaps or fractions; sorting by order then label makes any values valid). A parent that no longer exists makes the
// page a root (see `roots`), so a broken link never hides a page.
// 451 (secret) pages: title and slug are inside the encrypted payload; labels and routes come from the unlocked
// payload when available, else a neutral placeholder. Nothing secret is ever shown while locked.
// Tree expansion state is a per-device preference (localStorage), not part of the base or of undo.
import { h, lsGet, lsSet } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { confirmDialog, openDialog, promptDialog, toast } from '../ui/overlays.js';
import { contextMenu } from '../ui/contextmenu.js';
import { S, commit, select } from './state.js';
import { newPage, normPage, pageById, uid, uniqueSlug, walkBlocks } from './model.js';
import { makePublic, makeSecret, newSecretPage, unlockEntry } from './ed-secret.js';
import { selectEl } from './ed-fields.js';

// Filled by main.js (dependency inversion: this panel must not import the shell).
export const hooks = { preview: null, showPane: null };
const open = new Set(lsGet('kp-ed-open', []));
let filter = '';

// Display label. For a 451 page: unlocked title, else the optional public label of the envelope, else placeholder.
export function pageLabel(p) {
  if (p.access === 'secret') {
    const s = p.secrets[0];
    const u = s && S.unlocked.get(s.id);
    return u ? u.payload.title || u.payload.slug : s && s.label ? s.label : t('kp.secretPage');
  }
  return p.title || p.slug;
}
// Reader route of a page: '' for home, slug otherwise; null for a locked 451 page (its slug is unknown), which
// callers treat as "cannot preview".
export const routeOf = (p) => {
  if (p.access === 'secret') { const u = p.secrets[0] && S.unlocked.get(p.secrets[0].id); return u ? u.payload.slug : null; }
  return p.id === S.kb.home ? '' : p.slug;
};

// Sorted children. O(n) per call and called per tree node, so O(n^2) per render: fine for hundreds of pages,
// the tree is rebuilt only on structural changes.
const kids = (id) => S.kb.pages.filter((p) => p.parent === id).sort((a, b) => a.order - b.order || pageLabel(a).localeCompare(pageLabel(b)));
// All descendants; the `out.has` check also stops infinite recursion if data ever contains a parent cycle.
const descendants = (id, out = new Set()) => { for (const c of S.kb.pages.filter((p) => p.parent === id)) if (!out.has(c.id)) { out.add(c.id); descendants(c.id, out); } return out; };

// Slug nests under a public parent's slug (parent/new-page), giving readable URLs; a secret parent's slug is
// unknown, so the child starts at top level. Focus goes to the title after the repaint (next frame), selected,
// so the user types the real title immediately.
export function createPage(parentId = '') {
  const title = t('kp.newPageTitle');
  const p = newPage({ title, parent: parentId, versions: [{ id: 'main', label: '', blocks: [{ type: 'text', text: '' }] }] });
  p.slug = uniqueSlug(S.kb, (parentId && pageById(S.kb, parentId) && pageById(S.kb, parentId).access === 'public' ? pageById(S.kb, parentId).slug + '/' : '') + 'new-page');
  p.order = kids(parentId).length;
  if (parentId) open.add(parentId);
  commit((kb) => { kb.pages.push(p); }, { structure: true });
  select({ pageId: p.id });
  if (hooks.showPane) hooks.showPane('edit');
  requestAnimationFrame(() => { const i = document.querySelector('.kp-pe-title'); if (i) { i.focus(); i.select(); } });
  return p;
}

async function rename(p) {
  if (p.access === 'secret') { select({ pageId: p.id }); return; }
  const v = await promptDialog(t('kp.rename'), t('kp.pageTitle'), p.title);
  if (v == null || !v.trim()) return;
  commit((kb) => { pageById(kb, p.id).title = v.trim(); }, { structure: true });
}

// Target list excludes the page and its descendants: moving a page under its own child would create a cycle.
// The page is appended last among its new siblings; old siblings keep their (now gapped) order values.
async function move(p) {
  const bad = descendants(p.id);
  bad.add(p.id);
  const opts = [{ v: '', l: t('kp.topLevel') }, ...S.kb.pages.filter((x) => !bad.has(x.id)).map((x) => ({ v: x.id, l: pageLabel(x) }))];
  let val = p.parent;
  const sel = selectEl(opts, p.parent, (v) => { val = v; });
  const ok = await openDialog({ title: t('kp.moveTo'), body: h('label', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('kp.parentPage')), sel), buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('kp.move'), value: 'ok', primary: true }] });
  if (ok !== 'ok') return;
  commit((kb) => { const x = pageById(kb, p.id); x.parent = val; x.order = kb.pages.filter((y) => y.parent === val && y.id !== x.id).length; }, { structure: true });
  if (val) open.add(val);
}

// Swap with the neighbour, then renumber all siblings 0..n-1 so gaps and fractions from other operations vanish.
function reorder(p, d) {
  const sib = kids(p.parent);
  const i = sib.findIndex((x) => x.id === p.id);
  const j = i + d;
  if (j < 0 || j >= sib.length) return;
  commit((kb) => {
    [sib[i], sib[j]] = [sib[j], sib[i]];
    sib.forEach((x, k) => { pageById(kb, x.id).order = k; });
  }, { structure: true });
}

// Deep copy through JSON (the model is plain data), new ids for the page and for every block (block ids are
// referenced by preview selection and anchors, duplicates would collide). 451 variants are not copied: they are
// sealed to their envelope and cannot be re-sealed without the password. order + 0.5 places the copy right
// after the original, then siblings are renumbered.
function duplicate(p) {
  if (p.access === 'secret') { toast(t('kp.cannotDuplicateSecret'), 'warn'); return; }
  const c = normPage(JSON.parse(JSON.stringify({ ...p, id: uid(), secrets: [], title: p.title + ' ' + t('kp.copySuffix') })));
  c.slug = uniqueSlug(S.kb, p.slug);
  for (const v of c.versions) walkBlocks(v.blocks, (b) => { b.id = uid(); });
  c.order = p.order + 0.5;
  commit((kb) => { kb.pages.push(c); kids(p.parent).forEach((x, k) => { pageById(kb, x.id).order = k; }); }, { structure: true });
  select({ pageId: c.id });
}

// Children are re-parented to the grandparent instead of deleted: deleting a page never silently deletes more.
// Its unlocked secrets are dropped from memory so no decrypted payload outlives the page.
async function remove(p) {
  if (p.id === S.kb.home) { toast(t('kp.cannotDeleteHome'), 'warn'); return; }
  const n = descendants(p.id).size;
  if (!(await confirmDialog(t('kp.deletePage'), n ? t('kp.deletePageKids', { title: pageLabel(p), n }) : t('kp.deletePageQ', { title: pageLabel(p) }), t('kp.delete'), true))) return;
  commit((kb) => {
    for (const c of kb.pages) if (c.parent === p.id) c.parent = p.parent;
    kb.pages = kb.pages.filter((x) => x.id !== p.id);
  }, { structure: true });
  for (const s of p.secrets || []) S.unlocked.delete(s.id);
  if (S.pageId === p.id) select({ pageId: p.parent || S.kb.home });
}

// One action list shared by the context menu (right click, long press, Menu key); null entries are skipped by
// the menu. The home page cannot be deleted or made secret: the site needs a public entry point.
export function pageMenuItems(p) {
  const route = routeOf(p);
  const locked = p.access === 'secret' && route == null;
  return [
    { label: t('kp.open'), icon: 'edit', action: () => { select({ pageId: p.id }); if (hooks.showPane) hooks.showPane('edit'); } },
    { label: t('kp.preview'), icon: 'eye', disabled: route == null, action: () => { select({ pageId: p.id }); if (hooks.preview) hooks.preview(route); } },
    locked ? { label: t('kp.unlock'), icon: 'unlock', action: () => unlockEntry(p.secrets[0].id) } : null,
    { label: t('kp.rename'), icon: 'type', disabled: p.access === 'secret', action: () => rename(p) },
    { sep: true },
    { label: t('kp.newChild'), icon: 'filePlus', action: () => createPage(p.id) },
    { label: t('kp.newSecretChild'), icon: 'lock', action: () => newSecretPage(p.id) },
    { sep: true },
    { label: t('kp.moveTo'), icon: 'folder', action: () => move(p) },
    { label: t('kp.moveUp'), icon: 'up', action: () => reorder(p, -1) },
    { label: t('kp.moveDown'), icon: 'down', action: () => reorder(p, 1) },
    p.access === 'public' ? { label: t('kp.makeHome'), icon: 'star', disabled: p.id === S.kb.home, action: () => commit((kb) => { kb.home = p.id; }, { structure: true }) } : null,
    { label: t('kp.duplicate'), icon: 'copy', disabled: p.access === 'secret', action: () => duplicate(p) },
    p.access === 'public' ? { label: t('kp.makeSecret'), icon: 'lock', disabled: p.id === S.kb.home, action: () => makeSecret(p.id) } : { label: t('kp.makePublic'), icon: 'unlock', disabled: locked, action: () => makePublic(p.id) },
    { sep: true },
    { label: t('kp.delete'), icon: 'trash', danger: true, disabled: p.id === S.kb.home, action: () => remove(p) },
  ];
}

// While a filter is active every matching branch is shown expanded (open state ignored), and a parent stays
// visible if any descendant matches, so a match is never hidden inside a collapsed node.
export function renderPagesPanel(box) {
  const q = h('input', { type: 'search', class: 'ed-input ed-search', placeholder: t('kp.filterPages'), 'aria-label': t('kp.filterPages'), value: filter });
  const tree = h('ul', { class: 'kp-tree', role: 'tree', 'aria-label': t('kp.pages') });
  const f = () => filter.trim().toLowerCase();
  const matches = (p) => !f() || pageLabel(p).toLowerCase().includes(f()) || (p.slug || '').includes(f());
  const subtreeMatches = (p) => matches(p) || kids(p.id).some(subtreeMatches);
  const item = (p, depth) => {
    const ch = kids(p.id).filter(subtreeMatches);
    const expanded = !!f() || open.has(p.id);
    // ARIA tree pattern: role=tree / treeitem / group, aria-expanded only on nodes that have children.
    const li = h('li', { role: 'treeitem', 'aria-expanded': ch.length ? String(expanded) : null, 'aria-selected': String(p.id === S.pageId) });
    const badges = [];
    if (p.id === S.kb.home) badges.push(h('span', { class: 'kp-tb', title: t('kp.homePage') }, iconEl('star')));
    if (p.access === 'secret') badges.push(h('span', { class: 'kp-tb kp-tb-s', title: t('kp.secretPage') }, iconEl(S.unlocked.has(p.secrets[0] && p.secrets[0].id) ? 'unlock' : 'lock')));
    else if ((p.secrets || []).length) badges.push(h('span', { class: 'kp-tb kp-tb-s', title: t('kp.hasVariants', { n: p.secrets.length }) }, '451'));
    if (p.versions && p.versions.length > 1) badges.push(h('span', { class: 'kp-tb', title: t('kp.versionsN', { n: p.versions.length }) }, 'v' + p.versions.length));
    if (p.hidden) badges.push(h('span', { class: 'kp-tb', title: t('kp.hiddenPage') }, iconEl('eyeOff')));
    if (p.kind === 'redirect') badges.push(h('span', { class: 'kp-tb', title: t('kp.redirect') }, '↪'));
    // Indentation as inline padding by depth (14px per level): the nested <ul> carry no padding (editor.css).
    // The twisty is tabindex=-1: keyboard users expand with ArrowRight/Left, Tab goes straight to the next label.
    const row = h('div', { class: 'kp-tr' + (p.id === S.pageId ? ' kp-on' : ''), 'data-id': p.id, style: { paddingLeft: 6 + depth * 14 + 'px' } },
      ch.length ? h('button', { type: 'button', class: 'kp-tw', 'aria-label': expanded ? t('kp.collapse') : t('kp.expand'), tabindex: '-1', onclick: (e) => { e.stopPropagation(); if (open.has(p.id)) open.delete(p.id); else open.add(p.id); lsSet('kp-ed-open', [...open]); renderPagesPanel(box); } }, iconEl(expanded ? 'chevDown' : 'chevRight')) : h('span', { class: 'kp-tw' }),
      h('button', { type: 'button', class: 'kp-tl', onclick: () => { select({ pageId: p.id }); if (hooks.showPane) hooks.showPane('edit'); } }, h('span', { class: 'kp-tl-t' + (p.access === 'secret' ? ' kp-tl-secret' : '') }, pageLabel(p))),
      ...badges);
    li.append(row);
    if (ch.length && expanded) li.append(h('ul', { role: 'group' }, ch.map((c) => item(c, depth + 1))));
    return li;
  };
  // Roots: no parent or a missing parent. The home page is always first.
  const roots = S.kb.pages.filter((p) => !p.parent || !pageById(S.kb, p.parent)).sort((a, b) => (a.id === S.kb.home ? -1 : b.id === S.kb.home ? 1 : a.order - b.order || pageLabel(a).localeCompare(pageLabel(b)))).filter(subtreeMatches);
  tree.append(...roots.map((p) => item(p, 0)));
  // Filtering re-renders into a detached box and swaps only the <ul>: the search input stays the same element, so it
  // keeps focus and caret while typing.
  q.addEventListener('input', () => { filter = q.value; const c = box.querySelector('.kp-tree'); const nb = h('div'); renderPagesPanel(nb); c.replaceWith(nb.querySelector('.kp-tree')); });
  const actions = h('div', { class: 'kp-row kp-pages-act' },
    h('button', { type: 'button', class: 'ed-btn ed-sm ed-primary', onclick: () => createPage(S.pageId && pageById(S.kb, S.pageId) && pageById(S.kb, S.pageId).id !== S.kb.home ? pageById(S.kb, S.pageId).parent : '') }, iconEl('filePlus'), t('kp.newPage')),
    h('button', { type: 'button', class: 'ed-btn ed-sm', title: t('kp.newSecretPage'), onclick: () => newSecretPage('') }, iconEl('lock'), t('kp.secret')));
  box.replaceChildren(h('div', { class: 'kp-panel-h' }, h('h2', {}, t('kp.pages')), h('span', { class: 'ed-hint' }, t('kp.pagesCount', { n: S.kb.pages.length }))), actions, q, tree);
  contextMenu(tree, (el) => { const p = pageById(S.kb, el.dataset.id); return p ? pageMenuItems(p) : null; }, { selector: '.kp-tr' });
  // Keyboard: arrows move through the visible rows, Enter opens.
  tree.addEventListener('keydown', (e) => {
    const rows = [...tree.querySelectorAll('.kp-tl')];
    const i = rows.indexOf(document.activeElement);
    if (i < 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const r = rows[i + (e.key === 'ArrowDown' ? 1 : -1)]; if (r) r.focus(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const id = rows[i].closest('.kp-tr').dataset.id;
      if (e.key === 'ArrowRight') open.add(id); else open.delete(id);
      lsSet('kp-ed-open', [...open]);
      renderPagesPanel(box);
      const again = box.querySelector(`.kp-tr[data-id="${id}"] .kp-tl`);
      if (again) again.focus();
    } else if (e.key === 'Delete') { const p = pageById(S.kb, rows[i].closest('.kp-tr').dataset.id); if (p) remove(p); }
  });
}

// Opens every ancestor so the selected page is visible in the tree.
export function expandTo(pageId) {
  for (let p = pageById(S.kb, pageId); p && p.parent; p = pageById(S.kb, p.parent)) open.add(p.parent);
}
