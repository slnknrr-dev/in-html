// knowledge-processor/ed-page.js - the page editor (centre column): title, page settings (address, parent,
// categories, summary, image, date, author, visibility, contents, layout, redirect, page-only layers), the 451 variant
// bar of public pages, the version tabs ("difficulty" versions, any number), the block list, and "what links here".
// Secret pages and variants are edited in clear once unlocked; locked ones show their unlock card.
//
// Editing target: state.js target() resolves what the centre column edits from (S.pageId, S.sid):
//   kind 'page' (public page), 'variant' (unlocked 451 variant of a public page), 'secretPage' (unlocked secret
//   page), 'locked' (needs a password; tg.obj is null). Every field writes through commitTarget(), which applies
//   the edit to the right object and re-seals encrypted ones, so this file never touches envelopes itself.
// Exceptions that always use commit() on the page record: slug, parent, hidden, redirect. They belong to the public
// page shell, not to a variant payload.
import { h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { confirmDialog, openDialog, openMenu, promptDialog } from '../ui/overlays.js';
import { contextMenu } from '../ui/contextmenu.js';
import { S, commit, commitTarget, curVersion, select, target } from './state.js';
import { cleanLayerId, cleanSlug, normBlocks, pageById, uid, uniqueSlug, walkBlocks, eachMarkup } from './model.js';
import { scanLinks } from './markup.js';
import { slugify } from '../spa/route.js';
import { check, input, lineMarkup, linkInput, markupArea, row, selectEl } from './ed-fields.js';
import { mediaPicker } from './ed-media.js';
import { blockList } from './ed-blocks.js';
import { addVariant, changePassword, deleteVariant, lockEntry, unlockEntry } from './ed-secret.js';
import { hooks as pageHooks, pageLabel, pageMenuItems, routeOf } from './ed-pages.js';

// Module-level, not per page: the settings panel stays open/closed while moving between pages.
let settingsOpen = false;

// Locked target: only the envelope's public label is shown; the unlock button asks for the password.
function lockedCard(tg) {
  const s = tg.secret;
  return h('div', { class: 'kp-locked' },
    h('div', { class: 'kp-locked-i' }, iconEl('lock')),
    h('h2', {}, tg.page.access === 'secret' ? t('kp.lockedPage') : t('kp.lockedVariant')),
    s.label ? h('p', { class: 'kp-locked-note' }, s.label) : null,
    h('p', { class: 'ed-hint' }, t('kp.lockedHint')),
    h('div', { class: 'kp-row' },
      h('button', { type: 'button', class: 'ed-btn ed-primary', onclick: () => unlockEntry(s.id) }, iconEl('unlock'), t('kp.unlock')),
      tg.kind === 'locked' && tg.page.access === 'public' ? h('button', { type: 'button', class: 'ed-btn', onclick: () => select({ sid: '' }) }, t('kp.backToPublic')) : null,
      tg.page.access === 'public' ? h('button', { type: 'button', class: 'ed-btn ed-danger', onclick: () => deleteVariant(s.id) }, iconEl('trash'), t('kp.deleteVariant')) : null));
}

// Public page with 451 variants: tab 0 is the public content, then one tab per variant. A locked variant tab
// unlocks on click instead of selecting (selecting a locked target would only show the locked card).
function variantBar(page) {
  if (page.access !== 'public') return null;
  const bar = h('div', { class: 'kp-varbar', role: 'tablist', 'aria-label': t('kp.variants') });
  const tab = (sid, label, locked) => h('button', {
    type: 'button', role: 'tab', class: 'kp-vtab' + (S.sid === sid ? ' kp-on' : '') + (sid ? ' kp-vtab-s' : ''), 'aria-selected': String(S.sid === sid), 'data-sid': sid,
    onclick: () => { if (sid && locked) unlockEntry(sid); else select({ sid }); },
  }, sid ? iconEl(locked ? 'lock' : 'unlock') : iconEl('globe'), label);
  bar.append(tab('', t('kp.publicVersion'), false));
  for (const s of page.secrets || []) {
    const u = S.unlocked.get(s.id);
    bar.append(tab(s.id, u ? u.payload.label || s.label || t('kp.secretVersion') : s.label || t('kp.secretVersion'), !u));
  }
  bar.append(h('button', { type: 'button', class: 'ed-btn ed-sm kp-vadd', onclick: () => addVariant(page.id), title: t('kp.newVariantHint') }, iconEl('plus'), t('kp.newVariant')));
  contextMenu(bar, (el) => {
    const sid = el.dataset.sid;
    if (!sid) return null;
    const u = S.unlocked.get(sid);
    return [
      u ? null : { label: t('kp.unlock'), icon: 'unlock', action: () => unlockEntry(sid) },
      // The label exists twice: inside the payload (seen when unlocked) and on the envelope (public, shown while locked),
      // so it is written in both places. Note: that is two commits, i.e. two undo steps for one rename.
      u ? { label: t('kp.renameVariant'), icon: 'type', action: async () => { const v = await promptDialog(t('kp.renameVariant'), t('kp.variantLabel'), u.payload.label || ''); if (v != null) { select({ sid }); commitTarget((o) => { o.label = v; }, { structure: true }); commit((kb) => { for (const p of kb.pages) for (const s of p.secrets) if (s.id === sid) s.label = v; }, { structure: true }); } } } : null,
      u ? { label: t('kp.changePassword'), icon: 'key', action: () => changePassword(sid) } : null,
      u ? { label: t('kp.lock'), icon: 'lock', action: () => lockEntry(sid) } : null,
      { sep: true },
      { label: t('kp.deleteVariant'), icon: 'trash', danger: true, action: () => deleteVariant(sid) },
    ];
  }, { selector: '.kp-vtab' });
  return bar;
}

// Versions ("difficulty" levels: full, simpler, ...) of one page or variant; the reader offers them as tabs.
function versionBar(obj) {
  const vs = obj.versions || [];
  const cur = curVersion(obj);
  const bar = h('div', { class: 'kp-verbar', role: 'tablist', 'aria-label': t('kp.versions') });
  vs.forEach((v, i) => bar.append(h('button', { type: 'button', role: 'tab', class: 'kp-vtab' + (v === cur ? ' kp-on' : ''), 'aria-selected': String(v === cur), 'data-vid': v.id, onclick: () => select({ versionId: v.id }) }, v.label || (vs.length > 1 ? t('kp.versionN', { n: i + 1 }) : t('kp.mainVersion')))));
  const addVersion = async () => {
    const label = h('input', { class: 'ed-input', type: 'text', value: vs.length === 1 ? t('kp.simpler') : t('kp.versionN', { n: vs.length + 1 }) });
    const copy = h('input', { type: 'checkbox', class: 'ed-switch', checked: true });
    const ok = await openDialog({ title: t('kp.newVersion'), body: h('div', { class: 'ed-fields' }, h('p', { class: 'ed-hint' }, t('kp.versionHint')),
      h('label', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('kp.versionLabel')), label),
      h('label', { class: 'ed-field ed-field-check' }, copy, h('span', { class: 'ed-label' }, t('kp.versionCopy')))),
    buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('kp.add'), value: 'ok', primary: true }] });
    if (ok !== 'ok') return;
    // Version id derived from the label, made unique by suffixing '2'; ids appear in reader URLs, so they are readable.
    let id = cleanLayerId(label.value) || 'v' + (vs.length + 1);
    while (vs.some((v) => v.id === id)) id += '2';
    commitTarget((o) => {
      // The first version gets a label once a second one appears: two unnamed tabs would be indistinguishable.
      if (o.versions.length === 1 && !o.versions[0].label) o.versions[0].label = t('kp.fullVersion');
      const src = curVersion(o);
      // Copy blocks deep (JSON) and give them fresh ids: block ids must be unique across versions (preview selection).
      const blocks = copy.checked && src ? normBlocks(JSON.parse(JSON.stringify(src.blocks))) : [];
      if (copy.checked) walkBlocks(blocks, (b) => { b.id = uid(); });
      o.versions.push({ id, label: label.value, blocks });
    }, { structure: true });
    select({ versionId: id });
  };
  bar.append(h('button', { type: 'button', class: 'ed-btn ed-sm kp-vadd', onclick: addVersion, title: t('kp.newVersionHint') }, iconEl('plus'), t('kp.newVersion')));
  contextMenu(bar, (el) => {
    const v = vs.find((x) => x.id === el.dataset.vid);
    if (!v) return null;
    const i = vs.indexOf(v);
    return [
      { label: t('kp.renameVersion'), icon: 'type', action: async () => { const nv = await promptDialog(t('kp.renameVersion'), t('kp.versionLabel'), v.label); if (nv != null) commitTarget((o) => { o.versions.find((x) => x.id === v.id).label = nv; }, { structure: true }); } },
      { label: t('kp.moveLeft'), icon: 'chevLeft', disabled: i === 0, action: () => commitTarget((o) => { const a = o.versions; [a[i - 1], a[i]] = [a[i], a[i - 1]]; }, { structure: true }) },
      { label: t('kp.moveRight'), icon: 'chevRight', disabled: i === vs.length - 1, action: () => commitTarget((o) => { const a = o.versions; [a[i + 1], a[i]] = [a[i], a[i + 1]]; }, { structure: true }) },
      { sep: true },
      { label: t('kp.deleteVersion'), icon: 'trash', danger: true, disabled: vs.length < 2, action: async () => { if (await confirmDialog(t('kp.deleteVersion'), t('kp.deleteVersionQ', { name: v.label || v.id }), t('kp.delete'), true)) { commitTarget((o) => { o.versions = o.versions.filter((x) => x.id !== v.id); }, { structure: true }); select({ versionId: '' }); } } },
    ];
  }, { selector: '.kp-vtab' });
  return bar;
}

// Category chips; a new category is created in the base and assigned in one action (two commits). The menu lists
// only categories not yet assigned.
function catsEditor(obj) {
  const box = h('div', { class: 'kp-chips' });
  const paint = () => {
    box.replaceChildren(...(obj.cats || []).map((slug) => {
      const c = S.kb.cats.find((x) => x.slug === slug);
      return h('span', { class: 'ed-chip ed-on' }, c ? c.name : slug, h('button', { type: 'button', class: 'kp-chip-x', 'aria-label': t('kp.remove'), onclick: () => { commitTarget((o) => { o.cats = o.cats.filter((x) => x !== slug); }); paint(); } }, '×'));
    }), h('button', { type: 'button', class: 'ed-chip', onclick: (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      openMenu({ x: r.left, y: r.bottom }, [
        ...S.kb.cats.filter((c) => !(obj.cats || []).includes(c.slug)).map((c) => ({ label: c.name, action: () => { commitTarget((o) => { o.cats = [...(o.cats || []), c.slug]; }); paint(); } })),
        { sep: true },
        { label: t('kp.newCategory'), icon: 'plus', action: async () => {
          const name = await promptDialog(t('kp.newCategory'), t('kp.categoryName'), '');
          if (!name) return;
          const slug = cleanSlug(name);
          commit((kb) => { if (!kb.cats.some((c) => c.slug === slug)) kb.cats.push({ slug, name, desc: '' }); });
          commitTarget((o) => { o.cats = [...new Set([...(o.cats || []), slug])]; });
          paint();
        } },
      ]);
    } }, '+ ' + t('kp.category')));
  };
  paint();
  return box;
}

// Page-only layers: ids must not collide with base layers either: the reader merges both lists into one Map and a page layer would shadow a base layer.
function pageLayersEditor(obj) {
  const box = h('div', { class: 'kp-layers-ed' });
  const paint = () => {
    box.replaceChildren(...(obj.layers || []).map((l, i) => h('div', { class: 'kp-row' },
      input(l.label, (v) => commitTarget((o) => { o.layers[i].label = v; }, { key: 'pl' + i })),
      h('code', { class: 'kp-code-id' }, l.id),
      h('label', { class: 'kp-row kp-tiny' }, check(l.on, (v) => commitTarget((o) => { o.layers[i].on = v; })), t('kp.onByDefault')),
      h('button', { type: 'button', class: 'ed-iconbtn ed-sm', 'aria-label': t('kp.remove'), onclick: () => { commitTarget((o) => { o.layers.splice(i, 1); }, { structure: true }); } }, iconEl('trash')))),
    h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: async () => {
      const label = await promptDialog(t('kp.newLayer'), t('kp.layerName'), '');
      if (!label) return;
      let id = cleanLayerId(label) || 'layer';
      const taken = new Set([...(S.kb.layers || []), ...(obj.layers || [])].map((l) => l.id));
      while (taken.has(id)) id += '2';
      commitTarget((o) => { o.layers = [...(o.layers || []), { id, label, on: true }]; }, { structure: true });
    } }, iconEl('plus'), t('kp.newLayer')));
  };
  paint();
  return box;
}

// Slug field: the typed text is cleaned and made unique on each input, but the field is rewritten with the stored
// value only on 'change' (blur/Enter): rewriting on every keystroke would fight the user's typing.
function settings(obj, tg) {
  const isPublic = tg.kind === 'page';
  const page = tg.page;
  const parents = [{ v: '', l: t('kp.topLevel') }, ...S.kb.pages.filter((p) => p.id !== page.id).map((p) => ({ v: p.id, l: pageLabel(p) }))];
  const slugIn = input(obj.slug, (v) => {
    const s = cleanSlug(v);
    if (isPublic) commit((kb) => { pageById(kb, page.id).slug = uniqueSlug(kb, s, page.id); }, { key: 'slug' + page.id });
    else commitTarget((o) => { o.slug = s; }, { key: 'slug' + page.id });
  }, { spellcheck: 'false' });
  slugIn.addEventListener('change', () => { slugIn.value = isPublic ? pageById(S.kb, page.id).slug : tg.obj.slug; });
  const det = h('details', { class: 'kp-pset', open: settingsOpen });
  det.addEventListener('toggle', () => { settingsOpen = det.open; });
  const isVariant = tg.kind === 'variant';
  det.append(h('summary', {}, iconEl('settings'), t('kp.pageSettings')),
    h('div', { class: 'kp-pset-g' },
      !isVariant ? row(t('kp.slug'), h('div', { class: 'kp-row' }, slugIn, h('button', { type: 'button', class: 'ed-btn ed-sm', title: t('kp.slugFromTitle'), onclick: () => { slugIn.value = slugify(obj.title || '', { slash: false }); slugIn.dispatchEvent(new Event('input')); slugIn.dispatchEvent(new Event('change')); } }, t('kp.fromTitle'))), page.id === S.kb.home ? t('kp.slugHome') : t('kp.slugHint'), true) : null,
      row(t('kp.displayTitle'), lineMarkup(obj.display, (v) => commitTarget((o) => { o.display = v; }, { key: 'disp' })), t('kp.displayHint'), true),
      !isVariant ? row(t('kp.parentPage'), selectEl(parents, page.parent, (v) => commit((kb) => { pageById(kb, page.id).parent = v; }, { structure: true }))) : null,
      row(t('kp.categories'), catsEditor(obj), null, true),
      row(t('kp.summary'), markupArea(obj.summary, (v) => commitTarget((o) => { o.summary = v; }, { key: 'sum' }), { rows: 2, multiline: false }), t('kp.summaryHint'), true),
      row(t('kp.image'), mediaPicker(obj.image, (v) => commitTarget((o) => { o.image = v; }), { accept: 'image' }), t('kp.imageHint'), true),
      h('div', { class: 'kp-pset-row' },
        // Date accepts YYYY, YYYY-MM or YYYY-MM-DD; partial typing keeps the last valid value instead of storing junk.
        row(t('kp.date'), input(obj.date, (v) => commitTarget((o) => { o.date = /^\d{4}(-\d{2}(-\d{2})?)?$/.test(v) ? v : o.date; }, { key: 'date' }), { placeholder: 'YYYY-MM-DD' })),
        row(t('kp.author'), input(obj.author, (v) => commitTarget((o) => { o.author = v; }, { key: 'author' })))),
      h('div', { class: 'kp-pset-row' },
        row(t('kp.toc'), selectEl(['auto', 'on', 'off'].map((v) => ({ v, l: t('o.toc.' + v) })), obj.toc, (v) => commitTarget((o) => { o.toc = v; }))),
        row(t('kp.layout'), selectEl(['default', 'wide', 'full'].map((v) => ({ v, l: t('o.layout.' + v) })), obj.layout, (v) => commitTarget((o) => { o.layout = v; })))),
      isPublic ? h('div', { class: 'kp-pset-row' },
        row(t('kp.hiddenPage'), check(page.hidden, (v) => commit((kb) => { pageById(kb, page.id).hidden = v; }, { structure: true })), t('kp.hiddenHint')),
        row(t('kp.redirect'), check(page.kind === 'redirect', (v) => commit((kb) => { pageById(kb, page.id).kind = v ? 'redirect' : 'page'; }, { structure: true })))) : null,
      isPublic && page.kind === 'redirect' ? row(t('kp.redirectTarget'), linkInput(page.target, (v) => commit((kb) => { pageById(kb, page.id).target = v; }, { key: 'tgt' })), null, true) : null,
      row(t('kp.pageLayers'), pageLayersEditor(obj), t('kp.pageLayersHint'), true)));
  return det;
}

// "What links here": a link matches by slug, by lower-cased title or by slugified title, the same forms the markup
// resolver accepts. Only public pages are scanned: 451 content is encrypted, and listing it would leak it.
// Cost: O(pages x markup size) per render of the editor; acceptable because it runs only on structural repaints.
function backlinksOf(page, obj) {
  const keys = new Set([obj.slug, (obj.title || '').toLowerCase(), slugify(obj.title || '')].filter(Boolean));
  const out = [];
  for (const p of S.kb.pages) {
    if (p.id === page.id || p.access !== 'public') continue;
    let hit = false;
    for (const v of p.versions) eachMarkup(v.blocks, (text) => { if (!hit) for (const l of scanLinks(text)) { const k = l.replace(/^\/+|\/+$/g, ''); if (keys.has(k) || keys.has(k.toLowerCase()) || keys.has(slugify(k, { slash: true }))) { hit = true; break; } } });
    if (hit) out.push(p);
  }
  return out;
}

// Builds the whole centre column. Order: title + actions, variant bar, (locked card | settings, versions, blocks,
// backlinks). Redirect pages stop after settings: they have no body.
export function renderPageEditor(box) {
  const tg = target();
  if (!tg) { box.replaceChildren(h('p', { class: 'ed-hint kp-pad' }, t('kp.noPage'))); return; }
  const page = tg.page;
  const head = h('div', { class: 'kp-pe-head' });
  const titleText = tg.obj ? tg.obj.title : pageLabel(page);
  const title = h('input', { class: 'kp-pe-title', type: 'text', value: titleText || '', 'aria-label': t('kp.pageTitle'), placeholder: t('kp.pageTitle'), disabled: !tg.obj, dir: 'auto' });
  // Undo key includes page id and S.sid: typing in titles of different targets never merges into one undo step.
  // dir=auto on the input: right-to-left titles (Arabic, Hebrew) display correctly.
  title.addEventListener('input', () => commitTarget((o) => { o.title = title.value; }, { key: 'title' + page.id + S.sid }));
  title.addEventListener('change', () => { const tree = document.querySelector(`.kp-tr[data-id="${page.id}"] .kp-tl-t`); if (tree) tree.textContent = pageLabel(page); });
  const badges = h('div', { class: 'kp-pe-badges' },
    page.id === S.kb.home ? h('span', { class: 'kp-badge' }, iconEl('star'), t('kp.homePage')) : null,
    page.access === 'secret' ? h('span', { class: 'kp-badge kp-badge-s' }, iconEl('lock'), t('kp.secretPage')) : null,
    tg.kind === 'variant' ? h('span', { class: 'kp-badge kp-badge-s' }, iconEl('lock'), t('kp.secretVersion')) : null,
    page.hidden ? h('span', { class: 'kp-badge' }, iconEl('eyeOff'), t('kp.hiddenPage')) : null,
    routeOf(page) != null ? h('code', { class: 'kp-pe-route' }, '/' + routeOf(page)) : null);
  const menuBtn = h('button', { type: 'button', class: 'ed-iconbtn', title: t('kp.more'), 'aria-label': t('kp.pageActions'), onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); openMenu({ x: r.right - 220, y: r.bottom }, [
    ...pageMenuItems(page),
    tg.kind === 'secretPage' ? { label: t('kp.changePassword'), icon: 'key', action: () => changePassword(tg.secret.id) } : null,
    tg.kind === 'secretPage' ? { label: t('kp.lock'), icon: 'lock', action: () => lockEntry(tg.secret.id) } : null,
  ]); } }, iconEl('more'));
  const previewBtn = h('button', { type: 'button', class: 'ed-iconbtn', title: t('kp.preview'), 'aria-label': t('kp.preview'), disabled: routeOf(page) == null, onclick: () => pageHooks.preview && pageHooks.preview(routeOf(page)) }, iconEl('eye'));
  head.append(h('div', { class: 'kp-row kp-pe-tr' }, title, previewBtn, menuBtn), badges);
  const parts = [head, variantBar(page)];
  if (!tg.obj) { parts.push(lockedCard(tg)); box.replaceChildren(...parts.filter(Boolean)); return; }
  if (tg.kind === 'secretPage') parts.push(h('p', { class: 'ed-hint kp-secret-hint' }, iconEl('lock'), t('kp.secretPageEditing')));
  if (tg.kind === 'variant') parts.push(h('p', { class: 'ed-hint kp-secret-hint' }, iconEl('lock'), t('kp.variantEditing')));
  parts.push(settings(tg.obj, tg));
  if (tg.kind === 'page' && page.kind === 'redirect') { box.replaceChildren(...parts.filter(Boolean)); return; }
  parts.push(versionBar(tg.obj));
  const ver = curVersion(tg.obj);
  const vid = ver ? ver.id : '';
  // blockList gets a resolver, not the array: after commit() the target object is a new one (state is replaced on
  // undo), so the block array is looked up again inside each edit by version id.
  parts.push(blockList((o) => { const v = (o.versions || []).find((x) => x.id === vid) || (o.versions || [])[0]; return v ? v.blocks : null; }, ver ? ver.blocks : [], tg.obj));
  if (tg.kind === 'page') {
    const bl = backlinksOf(page, tg.obj);
    const list = h('div', { class: 'kp-backlinks' }, h('h3', {}, iconEl('link'), t('kp.whatLinksHere'), h('span', { class: 'ed-hint' }, ' ' + bl.length)),
      bl.length ? h('div', { class: 'kp-chips' }, bl.map((p) => h('button', { type: 'button', class: 'ed-chip', 'data-id': p.id, onclick: () => select({ pageId: p.id }) }, pageLabel(p)))) : h('p', { class: 'ed-hint' }, t('kp.noBacklinks')));
    contextMenu(list, (el) => { const p = pageById(S.kb, el.dataset.id); return p ? pageMenuItems(p) : null; }, { selector: '.ed-chip' });
    parts.push(list);
  }
  box.replaceChildren(...parts.filter(Boolean));
}
