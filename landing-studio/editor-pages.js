// landing-studio/editor-pages.js - pages in the landing editor (CONTRACT.md §18): the edited page (canvas,
// outline, insert positions: studio hooks mainList / renderOpts / outlineRegion), the page switcher of the stage bar,
// Site → Pages (add, duplicate, rename, address, order, home page, navigation, drafts, delete, the "Not found" page,
// the site path), the address control of the page inspector (validated; links follow a changed address), grouped
// link targets (pages and the sections on them) and the pages / links check before an export. Context menus (right
// click, long press, Menu key; ui/contextmenu.js) on the page switcher and the page list offer the page operations.
// Every change is a commit(), so undo / redo cover page operations.
//
// Design rules of this module:
// - Pages are blocks: a page is a block of type 'page' in regions.main (kind 'page' | 'notfound'), its content in
//   p.blocks. No parallel page table exists, so undo / redo, copy / paste, normalization and export see pages for free;
//   the price is that every page lookup is a filter over regions.main (cheap: a site has tens of pages, not thousands).
// - The home page is positional: the first regular (non-"notfound") page. Moving a page to the top makes it home; there
//   is no `home: true` flag to get out of sync with the order. fixFormerHome() repairs the one invariant this creates
//   (only the home page may lack an address).
// - Addresses are resolved by viewer.js siteRoutes(): the editor shows what the exported site will really serve
//   (normalized, deduplicated, reserved names renamed) instead of re-deriving the rules here and drifting from them.
// - Mutations only inside commit(): the history module snapshots around the callback. Code inside a commit re-finds
//   blocks by id (findBlock) instead of reusing objects captured outside, so it acts on the committed state.
import { cssEsc, h, lsGet, lsSet } from '../ui/dom.js';
import { addIcons, icon, iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { langLabel } from '../ui/lang.js';
import { confirmDialog, openDialog, openMenu, promptDialog, toast } from '../ui/overlays.js';
import { contextMenu } from '../ui/contextmenu.js';
import { S, canvas, edKey, scroller } from '../studio/state.js';
import { blockLabel, eachChildList, findBlock, labelText, pickT, slugify, typeDef } from '../studio/doc.js';
import { commit } from '../studio/history.js';
import { renderCanvas } from '../studio/canvas.js';
import { select } from '../studio/select.js';
import { renderOutline } from '../studio/left.js';
import { fieldsBox, openDocTab } from '../studio/right.js';
import { section } from '../studio/fields.js';
import { prepareCopy } from '../studio/ops.js';
import { ED } from '../studio/config.js';
import { BLOCK_TYPES, RESERVED_SLUGS, cloneBlock, newBlock, normBase, normSlug, normalizeDoc, notFoundPage, routeKey, siteRoutes } from './viewer.js';
import { docSells } from './editor-shop.js';
import { uiText } from '../doc/dict.js';

addIcons({ home: 'M3.5 11 12 4l8.5 7 M5.5 9.5v11h13v-11 M10 20.5v-6h4v6' });

/* ---------- the edited page ---------- */

// Id of the edited page; module state, not in S, because it is view state (never saved in the document, never undone).
let cur = null;

// Defensive shape checks: S.doc can be null (no project open) or a half-loaded import; [] keeps every caller simple.
const pagesOf = (doc = S.doc) => (doc && doc.regions && Array.isArray(doc.regions.main) ? doc.regions.main.filter((b) => b && b.type === 'page') : []);
const regularOf = (doc = S.doc) => pagesOf(doc).filter((p) => p.kind !== 'notfound');

// The edited page: the chosen one, else the one remembered for this project, else the home page.
// Persisted per project as { doc, page }: the doc id guards against restoring a page id of another project that
// shares the localStorage key (edKey is per editor, not per document).
function curPage() {
  const ps = pagesOf();
  if (!ps.length) return null;
  let p = cur && ps.find((x) => x.id === cur);
  if (!p) {
    const saved = lsGet(edKey('page'), null);
    if (saved && S.doc && saved.doc === S.doc.id) p = ps.find((x) => x.id === saved.page);
  }
  p = p || regularOf()[0] || ps[0];
  cur = p.id;
  return p;
}

// The page holding block `bid` (null for header / footer blocks).
// Walks parents upward; findBlock is a tree search per step, O(depth * size), fine for interactive use only.
function pageOfBlock(bid) {
  let fb = bid && findBlock(bid);
  while (fb && fb.block.type !== 'page' && fb.parent) fb = findBlock(fb.parent.id);
  return fb && fb.block.type === 'page' ? fb.block : null;
}

// o.force re-renders even when the page is unchanged (after an insert the canvas must show the new block);
// o.scroll === false keeps the scroll position (used when selection drives the switch, the target scrolls itself).
function setPage(id, o = {}) {
  const p = pagesOf().find((x) => x.id === id);
  if (!p) return;
  const same = cur === p.id;
  cur = p.id;
  lsSet(edKey('page'), { doc: S.doc && S.doc.id, page: p.id });
  if (same && !o.force) { syncBar(); return; }
  const sp = S.sel.bid ? pageOfBlock(S.sel.bid) : null;
  // A selection on another page would leave the inspector editing an invisible block: drop it.
  if (sp && sp.id !== p.id) select(null);
  renderCanvas();
  renderOutline();
  syncBar();
  if (o.scroll !== false) scroller.scrollTop = 0;
}

// Display name of a page: its title in the editing language, else its address.
function pageName(p) {
  const n = labelText(pickT(p.title)).trim();
  if (n) return n;
  if (p.kind === 'notfound') return t('pg.nf');
  if (regularOf()[0] === p) return t('pg.home');
  const s = normSlug(p.slug);
  return s ? '/' + s + '/' : t('pg.untitled');
}

// Address shown for a page (route table of the current document).
function pagePath(p, R = siteRoutes(S.doc)) {
  if (p.kind === 'notfound') return '404.html';
  const e = R.byId.get(p.id);
  if (e) return e.home ? '/' : '/' + e.slug + '/';
  const s = normSlug(p.slug);
  return s ? '/' + s + '/' : '—';
}

// A free address for `base` ('about' → 'about', 'about-2'…), ignoring page `selfId`.
// Reserved first segments (viewer.js RESERVED_SLUGS) collide with paths of the export, so they get a '-page' suffix
// rather than a number. The 1000 cap plus a time-based fallback bounds the loop on pathological documents.
function uniqueSlug(base, selfId = null) {
  const used = new Set(regularOf().filter((p) => p.id !== selfId).map((p) => normSlug(p.slug)).filter(Boolean));
  let s = normSlug(base) || 'page';
  if (RESERVED_SLUGS.has(s.split('/')[0])) s += '-page';
  if (!used.has(s)) return s;
  for (let n = 2; n < 1000; n++) if (!used.has(s + '-' + n)) return s + '-' + n;
  return s + '-' + Date.now().toString(36);
}

// Problem with an address typed for page `p` ('' = fine).
// Criterion: the typed text must already be in normal form (modulo outer slashes). Silently normalizing a typed
// address would surprise the user later; flagging it while they type is fail-fast feedback.
function slugProblem(raw, p) {
  const v = String(raw ?? '').trim();
  if (!v) return '';
  const s = normSlug(v);
  if (!s || s !== v.replace(/^\/+|\/+$/g, '')) return t('pg.slugBad');
  if (RESERVED_SLUGS.has(s.split('/')[0])) return t('pg.slugReserved', { name: s.split('/')[0] });
  if (regularOf().some((x) => x !== p && normSlug(x.slug) === s)) return t('pg.slugDup');
  return '';
}

/* ---------- link remapping ---------- */

// Links to '#/<from>' (also with a trailing slash or an anchor) point at '#/<to>' everywhere (button / nav / item
// hrefs and links inside texts). Returns the count.
// Generic deep walk over regions instead of a per-block-type list of href fields: new block types with links need no
// registration here. Skips `data` (collection rows / payloads, not authored links) and caps depth at 60 against
// absurdly deep input. `from` is regex-escaped: slugs may contain '.' or '/'.
// Two patterns: `exact` for whole-value href fields, `inText` for href="..." inside rich-text HTML; a plain substring
// replace would also rewrite '#/about-us' when renaming 'about', hence the anchored / quote-delimited forms.
function remapRoutes(doc, from, to) {
  if (!from || !to || from === to) return 0;
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exact = new RegExp('^#/' + esc + '/?(#[a-z][a-z0-9-]*)?$', 'i');
  const inText = new RegExp('(href\\s*=\\s*["\'])#/' + esc + '/?(#[a-z][a-z0-9-]*)?(["\'])', 'gi');
  let n = 0;
  const rec = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 60) return;
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === 'string') {
        const m = exact.exec(v);
        if (m) { o[k] = '#/' + to + (m[1] || ''); n++; }
        else if (v.includes('#/')) { const nv = v.replace(inText, (x, a, hs, b) => { n++; return a + '#/' + to + (hs || '') + b; }); if (nv !== v) o[k] = nv; }
      } else if (v && typeof v === 'object' && k !== 'data') rec(v, depth + 1);
    }
  };
  rec(doc.regions, 1);
  return n;
}

/* ---------- page operations (commits: undo / redo) ---------- */

// A localized string with only the editing language set; other languages fall back at render time.
const L1 = (s) => ({ [S.lang]: s });

// Index in regions.main where a new page goes: after the edited regular page, else before the "Not found" page.
function insertIndex() {
  const main = S.doc.regions.main;
  const c = curPage();
  if (c && c.kind !== 'notfound') return main.indexOf(c) + 1;
  const nf = main.findIndex((b) => b && b.type === 'page' && b.kind === 'notfound');
  return nf >= 0 ? nf : main.length;
}

// The new block is built outside commit (pure) and inserted inside; ED.onNewBlock lets the product configuration seed
// defaults exactly as for blocks inserted from the palette.
function addPage() {
  if (!BLOCK_TYPES.page) return;
  const name = t('pg.new');
  const p = newBlock('page', {
    title: L1(name), slug: uniqueSlug(slugify(name) || 'page'),
    blocks: [newBlock('hero', { title: L1(name), layout: 'left', height: 'auto' }), newBlock('section', { blocks: [newBlock('text')] })],
  });
  if (ED.onNewBlock) for (const b of p.blocks) ED.onNewBlock(b, S.doc);
  const at = insertIndex();
  commit('page add', () => {
    // The home page of a one-page site gets a name now: it appears in the navigation next to the new page.
    const home = regularOf()[0];
    if (home && !labelText(pickT(home.title)).trim()) home.title = { ...(home.title || {}), [S.lang]: uiText('pgHome', S.lang, S.doc) };
    S.doc.regions.main.splice(at, 0, p);
  }, { select: p.id });
  setPage(p.id, { force: true });
  select(p.id, null, { force: true });
}

function addNotFound() {
  if (pagesOf().some((p) => p.kind === 'notfound')) return;
  const p = notFoundPage(S.doc, S.doc.langs);
  commit('page add 404', () => { S.doc.regions.main.push(p); }, { select: p.id });
  setPage(p.id, { force: true });
}

// prepareCopy gives fresh ids to every nested block (duplicate ids would break selection, anchors and #b- links).
// A copy of the 404 page becomes a regular page hidden from navigation: there can be only one "not found" page.
function duplicatePage(id) {
  const p = pagesOf().find((x) => x.id === id);
  if (!p) return;
  let c;
  try { c = prepareCopy(cloneBlock(p)); } catch (e) { toast(t('err.generic', { msg: e.message }), 'error'); return; }
  c.kind = 'page';
  c.nav = p.kind === 'notfound' ? false : p.nav;
  const name = pageName(p);
  c.title = { ...(p.title || {}), [S.lang]: t('pg.copyOf', { name }) };
  c.slug = uniqueSlug((normSlug(p.slug) || slugify(name) || 'page') + '-copy');
  commit('page duplicate', () => {
    const main = S.doc.regions.main;
    main.splice(main.indexOf(main.find((x) => x && x.id === id)) + 1, 0, c);
  }, { select: c.id });
  setPage(c.id, { force: true });
}

// Renaming only changes the title in the editing language; it never rewrites an existing address (that would break
// external links). Only an address-less non-home page gets one, because it would otherwise be unreachable.
async function renamePage(id) {
  const p = pagesOf().find((x) => x.id === id);
  if (!p) return;
  const v = await promptDialog(t('pg.rename'), t('f.pageTitle') + ' (' + langLabel(S.lang) + ')', pickT(p.title) || '');
  if (v == null || !v.trim()) return;
  commit('page rename', () => {
    const x = findBlock(id)?.block;
    if (!x) return;
    x.title = { ...(x.title || {}), [S.lang]: v.trim() };
    // A page without an address (other than the home page) takes one from its new name.
    if (x.kind !== 'notfound' && !normSlug(x.slug) && regularOf()[0] !== x) x.slug = uniqueSlug(slugify(v) || 'page', x.id);
  });
}

// Index computed twice: once outside to bail early (no empty history entry), once inside on the committed state.
function movePage(id, dir) {
  const main = S.doc.regions.main;
  const i = main.findIndex((b) => b && b.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= main.length) return;
  commit('page move', () => {
    const m = S.doc.regions.main;
    const a = m.findIndex((b) => b && b.id === id);
    const [x] = m.splice(a, 1);
    m.splice(a + dir, 0, x);
    fixFormerHome();
  });
}

// The first regular page is the home page: an earlier home page without an address gets one now.
function fixFormerHome() {
  const reg = regularOf();
  for (let k = 1; k < reg.length; k++) {
    const p = reg[k];
    if (!normSlug(p.slug)) p.slug = uniqueSlug(slugify(labelText(pickT(p.title))) || 'page', p.id);
  }
}

// A draft cannot be the home page (the site would have no entry point), hence hidden = false.
function makeHome(id) {
  const main = S.doc.regions.main;
  const i = main.findIndex((b) => b && b.id === id);
  if (i < 0) return;
  commit('page home', () => {
    const m = S.doc.regions.main;
    const a = m.findIndex((b) => b && b.id === id);
    const [x] = m.splice(a, 1);
    x.hidden = false;
    m.unshift(x);
    fixFormerHome();
  });
}

// 'nav' is stored as opt-out (absent = shown), so toggling means "becomes false iff it was not false".
function togglePageProp(id, key) {
  commit('page ' + key, () => { const x = findBlock(id)?.block; if (x) x[key] = key === 'nav' ? x.nav === false : !x[key]; });
}

// The last regular page cannot be deleted: a site without a home page has no index.html. The 404 page always can.
async function deletePage(id) {
  const p = pagesOf().find((x) => x.id === id);
  if (!p) return;
  if (p.kind !== 'notfound' && regularOf().length < 2) { toast(t('pg.lastPage'), 'info'); return; }
  if (!(await confirmDialog(t('pg.del'), t('pg.delQ', { name: pageName(p) }), t('pg.del'), true))) return;
  commit('page delete', () => {
    const m = S.doc.regions.main;
    const a = m.findIndex((b) => b && b.id === id);
    if (a >= 0) m.splice(a, 1);
    fixFormerHome();
  }, { select: null });
  if (cur === id) { cur = null; setPage(curPage().id, { force: true }); }
  toast(t('blk.deleted'), 'info');
}

// The page's settings in the inspector (the page block is selected; the canvas shows the page).
function pageSettings(id) {
  setPage(id);
  select(id, null, { force: true });
}

// Items of the block menu (toolbar "more", canvas context menu) for a block on a page: that page's settings.
function pageBlockMenu(b) {
  const p = b && pageOfBlock(b.id);
  return p ? [{ sep: true }, { label: t('pg.settings'), icon: 'file', action: () => pageSettings(p.id) }] : [];
}

/* ---------- stage bar: page switcher ---------- */

// Signature of the last rendered option list: rebuilding a focused <select> on every syncBar would close it under the
// user's pointer and lose keyboard position, so the DOM is touched only when the visible content changed.
let barSig = '';

function syncBar() {
  const sel = document.getElementById('ed-page-sel');
  if (!sel || !S.doc) return;
  const ps = pagesOf();
  const c = curPage();
  const R = siteRoutes(S.doc);
  const items = ps.map((p) => {
    const e = R.byId.get(p.id);
    const mark = p.kind === 'notfound' ? '404 · ' : e && e.home ? '⌂ ' : '';
    return [p.id, mark + pageName(p) + (p.hidden ? ' · ' + t('pg.draft') : '')];
  });
  const sig = JSON.stringify([items, c && c.id, S.uiLang]);
  if (sig === barSig && sel.options.length) return;
  barSig = sig;
  sel.textContent = '';
  for (const [v, l] of items) sel.append(h('option', { value: v }, l));
  // '*' is a sentinel option: choosing it opens Site → Pages instead of switching (see the change handler).
  sel.append(h('option', { value: '*' }, t('pg.manage')));
  sel.value = c ? c.id : '';
  sel.disabled = !ps.length;
}

// Wraps the device stage: the page switcher (and an "add page" button) before the device buttons.
// Decorator over the studio's device stage: keeps its bar (device buttons) and prepends the page controls.
function pageStage(base) {
  return {
    ...base,
    bar(onPick) {
      const sel = h('select', { id: 'ed-page-sel', class: 'ed-input ed-select ed-page-sel', 'aria-label': t('pg.current'), title: t('pg.current') });
      sel.addEventListener('change', () => {
        const v = sel.value;
        if (v === '*') { barSig = ''; syncBar(); openDocTab('pages'); return; }
        setPage(v);
      });
      const add = h('button', { type: 'button', class: 'ed-iconbtn ed-page-add', title: t('pg.add'), 'aria-label': t('pg.add'), html: icon('filePlus'), onclick: () => addPage() });
      barSig = '';
      // Deferred: the select is not in the document yet; syncBar finds it by id.
      queueMicrotask(syncBar);
      const bar = h('div', { class: 'ed-pagebar' }, sel, add, base.bar ? base.bar(onPick) : null);
      // Context menu of the switcher: the edited page's operations, add page, all pages.
      contextMenu(bar, () => {
        const p = S.doc ? curPage() : null;
        if (!p) return null;
        return [
          ...pageMenuItems(p, { edited: true }),
          { sep: true },
          { label: t('pg.add'), icon: 'filePlus', action: () => addPage() },
          { label: t('pg.manage'), icon: 'file', action: () => openDocTab('pages') },
        ];
      }, { selector: '.ed-page-sel, .ed-page-add', fields: true });
      return bar;
    },
  };
}

/* ---------- Site → Pages ---------- */

// The operations of page `p` as openMenu items (the "more" button of Site → Pages, the context menus of that list and
// of the page switcher).
function pageMenuItems(p, o = {}) {
  const R = siteRoutes(S.doc);
  const e = R.byId.get(p.id);
  const nf = p.kind === 'notfound';
  const main = S.doc.regions.main;
  const i = main.indexOf(p);
  return [
    o.edited ? null : { label: t('pg.open'), icon: 'edit', action: () => setPage(p.id) },
    { label: t('pg.settings'), icon: 'sliders', action: () => pageSettings(p.id) },
    { label: t('pg.rename'), icon: 'type', action: () => renamePage(p.id) },
    { sep: true },
    { label: t('pg.up'), icon: 'up', disabled: i <= 0, action: () => movePage(p.id, -1) },
    { label: t('pg.down'), icon: 'down', disabled: i >= main.length - 1, action: () => movePage(p.id, 1) },
    nf ? null : { label: t('pg.setHome'), icon: 'home', disabled: !!(e && e.home), action: () => makeHome(p.id) },
    { sep: true },
    nf ? null : { label: t('pg.toggleNav'), checked: p.nav !== false, action: () => togglePageProp(p.id, 'nav') },
    { label: t('pg.toggleDraft'), checked: !!p.hidden, action: () => togglePageProp(p.id, 'hidden') },
    { label: t('pg.dup'), icon: 'copy', action: () => duplicatePage(p.id) },
    { sep: true },
    { label: t('pg.del'), icon: 'trash', danger: true, action: () => deletePage(p.id) },
  ].filter(Boolean);
}

const pageMenu = (p, anchor) => openMenu(anchor, pageMenuItems(p));

// Context menu of the page list (right click, long press, Menu key): the page's operations. The list is rebuilt with
// the tab, so the previous one's handlers are released first.
let detachPgList = null;
function pageListMenu(list) {
  if (detachPgList) detachPgList();
  detachPgList = contextMenu(list, (li) => {
    const p = pagesOf().find((x) => x.id === li.getAttribute('data-pg'));
    return p ? pageMenuItems(p) : null;
  }, { selector: '.ed-pg[data-pg]' });
}

function dsPages(body) {
  body.append(h('p', { class: 'ed-hint' }, t('pg.intro')));
  const R = siteRoutes(S.doc);
  const c = curPage();
  const list = h('ul', { class: 'ed-pg-list', role: 'list' });
  for (const p of pagesOf()) {
    const e = R.byId.get(p.id);
    const nf = p.kind === 'notfound';
    const badges = [];
    if (e && e.home) badges.push(t('pg.home'));
    if (nf) badges.push('404');
    if (p.hidden) badges.push(t('pg.draft'));
    else if (!nf && p.nav === false) badges.push(t('pg.hiddenNav'));
    list.append(h('li', { class: 'ed-pg' + (c && c.id === p.id ? ' ed-on' : '') + (p.hidden ? ' ed-pg-draft' : ''), 'data-pg': p.id },
      h('button', { type: 'button', class: 'ed-pg-main', title: t('pg.open'), 'aria-current': c && c.id === p.id ? 'true' : null, onclick: () => setPage(p.id) },
        iconEl(nf ? 'warn' : e && e.home ? 'home' : 'file'),
        h('span', { class: 'ed-pg-t' }, h('strong', {}, pageName(p)), h('small', { class: 'ed-mono' }, pagePath(p, R))),
        badges.length ? h('span', { class: 'ed-pg-badges' }, badges.map((x) => h('span', { class: 'ed-tag' }, x))) : null),
      h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('pg.settings'), 'aria-label': t('pg.settings') + ': ' + pageName(p), html: icon('sliders'), onclick: () => pageSettings(p.id) }),
      h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('top.more'), 'aria-label': t('top.more') + ': ' + pageName(p), 'aria-haspopup': 'menu', html: icon('more'), onclick: (ev) => pageMenu(p, ev.currentTarget) })));
  }
  body.append(list);
  pageListMenu(list);
  const hasNF = pagesOf().some((p) => p.kind === 'notfound');
  body.append(h('div', { class: 'ed-pg-acts' },
    h('button', { type: 'button', class: 'ed-btn', onclick: () => addPage() }, iconEl('filePlus'), t('pg.add')),
    hasNF ? null : h('button', { type: 'button', class: 'ed-btn', onclick: () => addNotFound() }, iconEl('warn'), t('pg.addNF'))));
  if (!hasNF) body.append(h('p', { class: 'ed-hint' }, t('pg.nfIntro')));
  body.append(section('ds-pg-route', t('pg.routing'), fieldsBox([
    { key: 'basePath', type: 'text', label: 'pg.basePath', hint: 'pg.basePathH', placeholderText: '/repo/',
      check: (v) => (!v || normBase(v) ? '' : t('pg.basePathBad')) },
  ], 'output', 'none')));
}

/* ---------- inspector: the page address ---------- */

// Field type 'pageslug': '/ <slug> /' with live validation; a change is one commit that also moves the links.
// onChange is deliberately unused: the generic field path would commit only the slug, while an address change must
// also move the links in one commit (one undo step restores both). `page()` re-resolves the block on every event
// because the inspector can outlive a document replacement.
// 'input' only validates (cheap, no history); 'change' (blur / Enter) commits, so typing is not one undo step per key.
function slugControl(f, v, onChange, id, ctx) {
  const bid = ctx && ctx.bid;
  const page = () => (bid ? findBlock(bid)?.block : null);
  const p0 = page();
  const R = siteRoutes(S.doc);
  const e = p0 ? R.byId.get(p0.id) : null;
  const inp = h('input', { type: 'text', id, class: 'ed-input ed-mono', value: v || '', placeholder: t('pl.slug'), spellcheck: 'false', autocomplete: 'off', dir: 'ltr' });
  const warn = h('div', { class: 'ed-hint ed-hint-warn', role: 'status', hidden: true });
  const note = e && e.home ? h('div', { class: 'ed-hint' }, t('pg.slugHome')) : null;
  const paint = () => {
    const msg = slugProblem(inp.value, page());
    warn.hidden = !msg;
    warn.textContent = msg;
    if (msg) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid');
  };
  inp.addEventListener('input', paint);
  inp.addEventListener('change', () => {
    const p = page();
    if (!p) return;
    const nv = normSlug(inp.value);
    const old = (siteRoutes(S.doc).byId.get(p.id) || {}).slug || normSlug(p.slug);
    inp.value = nv;
    paint();
    if (nv === (p.slug || '')) return;
    commit('page address', () => {
      const x = findBlock(p.id)?.block;
      if (!x) return;
      x.slug = nv;
      if (old && nv && old !== nv) remapRoutes(S.doc, old, nv);
    });
  });
  paint();
  return h('div', { class: 'ed-slug-box' }, h('div', { class: 'ed-slug' }, h('span', { class: 'ed-slug-pre', 'aria-hidden': 'true' }, '/'), inp,
    h('span', { class: 'ed-slug-pre', 'aria-hidden': 'true' }, '/')), warn, note);
}

// The page type's address field uses the control above (registry objects are shared; the viewer ignores `type`
// changes of editor-only controls because normalization reads the defaults).
// Mutates the shared registry at import time: order-dependent (this module must load before the inspector builds a
// page form), accepted because the viewer only reads keys and defaults from the schema.
if (BLOCK_TYPES.page) for (const f of BLOCK_TYPES.page.schema) if (f.key === 'slug') f.type = 'pageslug';

/* ---------- link targets (href fields, link picker) ---------- */

// Pages with their sections, grouped by page; then the header / footer and the special targets.
// pageOfId maps every block id to its page in one pass, so grouping the studio's flat target list is O(n), not a
// tree search per target. Dedup by href at the end: the same anchor can be offered by two sources.
function linkTargets(doc, targets) {
  const out = [];
  const R = siteRoutes(doc);
  const pageOfId = new Map();
  for (const p of pagesOf(doc)) {
    const visit = (list) => { for (const b of list || []) { if (!b) continue; pageOfId.set(b.id, p.id); eachChildList(b, visit); } };
    pageOfId.set(p.id, p.id);
    visit(p.blocks);
  }
  for (const p of pagesOf(doc)) {
    const e = R.byId.get(p.id);
    if (!e && p.kind !== 'notfound') continue;
    const group = pageName(p) + (p.hidden ? ' · ' + t('pg.draft') : '');
    if (e) out.push({ href: '#/' + e.slug, label: t('pg.lk.whole'), group });
    for (const x of targets) if (x.id !== p.id && pageOfId.get(x.id) === p.id) out.push({ href: x.href, label: x.label, group });
  }
  const shared = t('pg.lk.shared');
  for (const x of targets) if (!pageOfId.has(x.id)) out.push({ href: x.href, label: x.label, group: shared });
  const sp = t('pg.lk.special');
  out.push({ href: '#top', label: t('rt.link.top'), group: sp });
  if (docSells(doc)) out.push({ href: '#cart', label: t('rt.link.cart'), group: sp });
  if (doc.langs.length > 1) for (const l of doc.langs) out.push({ href: '#lang=' + l, label: t('rt.link.lang', { lang: langLabel(l) }), group: sp });
  const seen = new Set();
  return out.filter((x) => (seen.has(x.href) ? false : (seen.add(x.href), true)));
}

/* ---------- check before an export ---------- */

// Hrefs of a block's own props (fields named href / *Href, and links inside texts), not those of nested blocks.
// Own props only (child lists skipped at depth 0): nested blocks are visited separately by pageProblems, so recursing
// into them here would report each link once per ancestor.
function hrefsOf(b) {
  const out = [];
  const lists = new Set((typeDef(b.type).lists || []).map((s) => s.split('.')[0]));
  const rec = (o, depth, key) => {
    if (!o || depth > 30) return;
    if (typeof o === 'string') {
      if (/href$/i.test(key || '') && /^#/.test(o.trim())) out.push(o.trim());
      for (const m of o.matchAll(/href\s*=\s*["'](#[^"']*)["']/gi)) out.push(m[1]);
      return;
    }
    if (typeof o !== 'object') return;
    for (const k of Object.keys(o)) {
      if (depth === 0 && lists.has(k)) continue;
      if (k === 'data' || k === 'style') continue;
      rec(o[k], depth + 1, Array.isArray(o) ? key : k);
    }
  };
  rec(b, 0, '');
  return out;
}

// Problems of pages and internal links in the editor's document: [{ msg, bid?, page? }].
// Routes come from a normalized copy (what the export will serve) but links from the raw doc, so problem rows point
// at block ids the user can select. Link kinds: '#/slug[#anchor]' page routes, '#b-<id>' block links, '#att-<id>'
// attachments, '#cart', '#top' / '#' / '#lang=', bare '#anchor'. External URLs are not this check's business.
// "Broken" and "points into a draft" are reported apart because the fix differs (publish vs. retarget).
function pageProblems(doc) {
  const out = [];
  const pages = pagesOf(doc);
  if (!pages.length) return out;
  const d = normalizeDoc(doc);
  const R = siteRoutes(d);
  const name = (p) => pageName(p);
  // Addresses as typed: duplicates, missing, reserved (normalization renames them; say so).
  const final = new Map(R.list.map((e) => [e.id, e.slug]));
  const seen = new Map();
  const reg = pages.filter((p) => p.kind !== 'notfound' && !p.hidden);
  reg.forEach((p, i) => {
    const s = normSlug(p.slug);
    const to = final.get(p.id) || '';
    if (i === 0) return; // the home page lives at the site address
    if (!s) { out.push({ msg: t('pg.chk.empty', { a: name(p), to }), page: p.id }); return; }
    if (RESERVED_SLUGS.has(s.split('/')[0])) out.push({ msg: t('pg.chk.reserved', { a: name(p), slug: s, to }), page: p.id });
    else if (seen.has(s)) out.push({ msg: t('pg.chk.dup', { a: name(seen.get(s)), b: name(p), slug: s, to }), page: p.id });
    if (!seen.has(s)) seen.set(s, p);
  });
  // Visible blocks and anchors (drafts and hidden blocks excluded) and the links found in them.
  const visible = new Set();
  const anchors = new Map();
  const blockPage = new Map();
  const links = [];
  const visit = (list, page, shown) => {
    for (const b of list || []) {
      if (!b) continue;
      const on = shown && !b.hidden;
      if (on) visible.add(b.id);
      if (on && b.anchor && !anchors.has(b.anchor)) anchors.set(b.anchor, b.id);
      if (page) blockPage.set(b.id, page);
      if (on) for (const href of hrefsOf(b)) links.push({ href, b, page });
      eachChildList(b, (l) => visit(l, page, on));
    }
  };
  visit(doc.regions.header, null, true);
  visit(doc.regions.footer, null, true);
  for (const p of pages) { blockPage.set(p.id, p); if (!p.hidden) visible.add(p.id); visit(p.blocks, p, !p.hidden); }
  const atts = doc.attachments || {};
  const sells = docSells(doc);
  const linked = new Set();
  for (const { href, b, page } of links) {
    const where = (page ? name(page) + ' · ' : '') + t('b.' + b.type) + (blockLabel(b) ? ' “' + blockLabel(b) + '”' : '');
    let bad = false;
    let draft = false;
    let m;
    if ((m = /^#\/([^#]*?)\/?(?:#([a-z][a-z0-9-]*))?$/i.exec(href))) {
      const key = routeKey(m[1]);
      const e = R.bySlug.get(key);
      if (e) linked.add(e.id);
      else {
        const raw = pages.find((p) => p.kind !== 'notfound' && normSlug(p.slug) === key);
        if (raw && raw.hidden) draft = true; else bad = true;
      }
      if (m[2] && !anchors.has(m[2])) bad = true;
    } else if ((m = /^#b-([a-z0-9]+)$/i.exec(href))) {
      const tb = findBlock(m[1], doc);
      if (!tb) bad = true;
      else if (!visible.has(m[1])) draft = true;
      else if (tb.block.type === 'page') linked.add(m[1]);
    } else if ((m = /^#att-([a-z0-9]+)$/i.exec(href))) {
      if (!atts[m[1]]) bad = true;
    } else if (href === '#top' || href === '#' || /^#lang=/.test(href)) {
      // always there
    } else if (href === '#cart') {
      if (!sells) bad = true;
    } else if ((m = /^#([a-z][a-z0-9-]*)$/.exec(href))) {
      if (!anchors.has(m[1])) {
        let any = false;
        for (const p of pages) if (p.hidden) { const f = (l) => (l || []).some((x) => x && (x.anchor === m[1] || (Array.isArray(x.blocks) && f(x.blocks)))); if (f(p.blocks)) any = true; }
        if (any) draft = true; else bad = true;
      }
    }
    if (bad || draft) out.push({ msg: t(draft ? 'pg.chk.linkHidden' : 'pg.chk.link', { where, href }), bid: b.id });
  }
  // Pages nobody reaches: not in a navigation with page links and no link to them.
  const navs = [];
  const findNav = (list) => { for (const b of list || []) if (b && b.type === 'nav' && !b.hidden && b.pages !== false) navs.push(b); };
  findNav(doc.regions.header);
  findNav(doc.regions.footer);
  for (const p of pages) findNav(p.blocks);
  // A nav with a single page entry renders no page links, hence the >= 2 requirement.
  const navOK = navs.length > 0 && R.navList.length >= 2;
  for (const e of R.list) {
    if (e.home || linked.has(e.id) || (navOK && e.nav)) continue;
    out.push({ msg: t('pg.chk.unreach', { a: name(e.b) }), page: e.id });
  }
  return out;
}

// The dialog of the check (ED.exportCheck runs it first): true = go on, false = stay in the export dialog, null = the
// user chose to fix something (the export dialog closes).
// The per-row "show" button cannot resolve the dialog itself (openDialog owns resolution), so it records the pick and
// clicks a hidden dialog button that resolves with 'show'. The tri-state result lets the export dialog tell cancel
// (stay) from "go fix it" (close).
async function pagesCheck(doc) {
  const probs = pageProblems(doc);
  if (!probs.length) return true;
  let pick = null;
  const rows = probs.map((x) => h('li', { class: 'ed-bx-row' },
    h('span', { class: 'ed-bx-ic' }, iconEl('warn')),
    h('span', { class: 'ed-bx-txt' }, x.msg),
    h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: (e) => { pick = x; e.currentTarget.closest('.ed-dialog')?.querySelector('[data-pg-show]')?.click(); } }, t('pg.chk.show'))));
  const v = await openDialog({
    title: t('pg.chkT'), className: 'ed-dlg-bx ed-dlg-pg',
    body: h('div', { class: 'ed-bx' }, h('p', {}, t('pg.chkIntro')), h('ul', { class: 'ed-bx-list' }, rows)),
    buttons: [
      { label: t('dlg.cancel'), value: null },
      { label: t('pg.chk.show'), value: 'show', className: 'ed-pg-show', onClick: () => true },
      { label: t('pg.chk.go'), value: 'go', primary: true },
    ],
    onMount: ({ el }) => { const b = el.querySelector('.ed-pg-show'); if (b) { b.setAttribute('data-pg-show', ''); b.hidden = true; } },
  });
  if (v === 'go') return true;
  if (v === 'show') {
    const x = pick || probs[0];
    if (x.bid) select(x.bid, null, { scroll: true, force: true });
    else if (x.page) pageSettings(x.page);
    return null;
  }
  return false;
}

/* ---------- wiring ---------- */

// Selecting a block of another page (outline, check dialogs, link targets) shows that page.
document.addEventListener('ed-select', (e) => {
  const bid = e.detail && e.detail.bid;
  if (!bid || !S.doc) return;
  const p = pageOfBlock(bid);
  const c = curPage();
  // A selected page block itself (its settings in the inspector) does not move the canvas; the page operations
  // switch pages explicitly.
  if (!p || !c || p.id === c.id || p.id === bid) return;
  setPage(p.id, { scroll: false });
  select(bid, e.detail.item ?? null, { scroll: true, force: true });
});

// Page links of the navigation on the canvas switch the edited page.
if (canvas) {
  // Capture phase plus stopPropagation: the canvas' own click handler would otherwise select the nav block instead.
  canvas.addEventListener('click', (e) => {
    const x = e.target && e.target.closest ? e.target.closest('[data-lp-edit-page]') : null;
    if (!x || !canvas.contains(x)) return;
    e.preventDefault();
    e.stopPropagation();
    setPage(x.getAttribute('data-lp-edit-page'));
  }, true);
}

// Studio hooks of the landing editor configuration.
// mainList / outlineRegion redirect the studio's "main region" to the edited page's block list, so insert, paste and
// outline operate inside the page without the studio knowing pages exist.
const PAGES_EDITOR = {
  mainList: () => { const p = S.doc ? curPage() : null; return p ? p.id + ':blocks' : 'regions.main'; },
  renderOpts: () => { const p = S.doc ? curPage() : null; return p ? { page: p.id } : {}; },
  outlineRegion: (r, doc) => {
    if (r !== 'main' || !doc) return null;
    const p = curPage();
    return p ? { list: p.blocks || [], listPath: p.id + ':blocks', label: t('pg.outline', { name: pageName(p) }) } : null;
  },
  linkTargets,
  fieldControls: { pageslug: slugControl },
};

export {
  PAGES_EDITOR,
  addNotFound,
  addPage,
  curPage,
  dsPages,
  pageName,
  pageProblems,
  pageStage,
  pagesCheck,
  pageBlockMenu,
  pagesOf,
  remapRoutes,
  setPage,
  syncBar
};
