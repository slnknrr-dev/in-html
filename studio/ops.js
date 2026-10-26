// studio/ops.js - block operations: insert (with region routing), delete, duplicate, move, copy / paste, the insert
// and block context menus.
//
// Every operation is a single commit(): one undo step, one render, one autosave. Mutations inside commit re-resolve
// the block by id (findBlock in the callback), never reuse the fb found outside: the callback runs on S.doc as it is
// at commit time. Positions are { listPath, index } (see doc.js for list paths); index Infinity = append, clamped by
// Math.min(index, length) at splice time so a stale index can never create holes in the array.
import { own } from '../util/value.js';
import { BLOCK_TYPES, P } from '../doc/product.js';
import { cloneBlock, newBlock, normalizeDoc } from '../doc/model.js';
import { $$, isObj, lsGet, lsSet, setCaret } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { openMenu, toast } from '../ui/overlays.js';
import { S, edKey } from './state.js';
import { anchorMap, eachChildList, findBlock, getList, isTransparent, isWithin, listOwner, mainPath, regionOf, regions, sanitizeDocRich, typeDef, typeIcon, walk } from './doc.js';
import { commit, undo } from './history.js';
import { blockEl } from './canvas.js';
import { scheduleChrome, select } from './select.js';
import { newItem, renderInspector } from './inspector.js';
import { setRightTab } from './right.js';
import { togglePanel } from './shell.js';
import { ED } from './config.js';

// ===========================================================================
// 11. Block operations
// ===========================================================================

function insertPosAfter(bid) {
  const fb = bid && findBlock(bid);
  if (fb && !typeDef(fb.block.type).topLevel) return { listPath: fb.listPath, index: fb.index + 1 };
  return { listPath: mainPath(), index: Infinity };
}
function insertPosBefore(bid) {
  const fb = bid && findBlock(bid);
  if (fb && !typeDef(fb.block.type).topLevel) return { listPath: fb.listPath, index: fb.index };
  return { listPath: mainPath(), index: 0 };
}

// Does the product have block types bound to the header / footer region (registry `region`)?
const hasRegionTypes = () => Object.values(BLOCK_TYPES).some((d) => d.region === 'header' || d.region === 'footer');

// A type that only lives directly in a region list (registry `topLevel`, e.g. the pages of a multi-page product)
// always goes to the end of its region ('main' unless the type names another).
const topLevelPos = (type) => ({ listPath: 'regions.' + (typeDef(type).region || 'main'), index: Infinity });

// Where a new block of `type` really goes when inserted at `pos` from the palette / insert menu: a type that
// belongs to the header or footer (nav, footer) goes to the end of that region; any other type never lands in the
// header / footer region next to the nav / footer, but at the start / end of the main region (the edited page of a
// multi-page product). Nested lists (inside a section or columns) keep the position. Products without region-bound
// types keep `pos`.
function routeInsertPos(type, pos) {
  if (typeDef(type).topLevel) return topLevelPos(type);
  const fallback = { listPath: mainPath(), index: Infinity };
  if (!hasRegionTypes()) return pos || fallback;
  const def = typeDef(type);
  const want = def.region === 'header' || def.region === 'footer' ? def.region : null;
  const here = regionOf(pos?.listPath);
  // A region-bound type flagged `regionStart` (an announcement bar) goes to the start of its region.
  if (want) return here === want ? pos : { listPath: 'regions.' + want, index: def.regionStart ? 0 : Infinity };
  if (here === 'header') return { listPath: mainPath(), index: 0 };
  if (here === 'footer') return { listPath: mainPath(), index: Infinity };
  return pos || fallback;
}

// A copy never takes over the original's anchor (first wins); the product fixes its own unique keys (ED.onCopy).
function prepareCopy(c) {
  if (P.anchors) {
    const used = anchorMap();
    const strip = (b) => {
      if (b.anchor && used.has(b.anchor)) b.anchor = '';
      eachChildList(b, (l) => l.forEach((x) => x && strip(x)));
    };
    strip(c);
  }
  if (ED.onCopy) ED.onCopy(c, S.doc);
  return c;
}

function focusFirstField(bid) {
  // synchronous: the canvas is rendered synchronously by commit()
  const be = blockEl(bid);
  if (!be) return;
  const f = $$('[data-f]', be).find((x) => x.closest('[data-bid]') === be) || be.querySelector('[data-f]');
  if (f) { try { f.focus(); setCaret(f, 1e9); } catch { /* ignore */ } }
}

// opts.route: palette / insert menu insertion (routeInsertPos).
// own(BLOCK_TYPES, type): the type may come from a palette drag, menu or clipboard; only registered types insert.
function insertBlock(type, pos = insertPosAfter(S.sel.bid), overrides, opts = {}) {
  if (!own(BLOCK_TYPES, type)) return null;
  if (opts.route || typeDef(type).topLevel) pos = routeInsertPos(type, pos);
  let b;
  try { b = newBlock(type, overrides); } catch (e) { toast(t('err.generic', { msg: e.message }), 'error'); return null; }
  // Item-based blocks (contacts, features, products…) start with one item: an empty list renders 0 px tall.
  const def = own(BLOCK_TYPES, type);
  if (Array.isArray(b.items) && !b.items.length && def.itemDefaults && !(overrides && 'items' in overrides)) b.items.push(newItem(def));
  if (ED.onNewBlock) ED.onNewBlock(b, S.doc);
  commit('insert ' + type, () => {
    const list = getList(pos.listPath) || getList(mainPath());
    list.splice(Math.min(pos.index ?? list.length, list.length), 0, b);
  }, { select: b.id });
  select(b.id, null, { scroll: true, force: true });
  focusFirstField(b.id);
  return b;
}

function insertBlockObject(b, pos) {
  if (typeDef(b.type).topLevel) pos = topLevelPos(b.type);
  commit('paste', () => {
    const list = getList(pos.listPath) || getList(mainPath());
    list.splice(Math.min(pos.index ?? list.length, list.length), 0, b);
  }, { select: b.id });
  select(b.id, null, { scroll: true, force: true });
}

// No confirmation dialog: delete is instant and the toast offers Undo (cheaper for the user than a modal on every
// delete, and just as safe because history holds the full snapshot). Selection moves to a neighbour so keyboard
// users can keep pressing Delete.
function deleteBlock(bid) {
  const fb = findBlock(bid);
  if (!fb) return;
  const next = fb.list[fb.index + 1]?.id || fb.list[fb.index - 1]?.id || (fb.parent && !isTransparent(fb.parent) ? fb.parent.id : null);
  commit('delete', () => {
    const f = findBlock(bid);
    if (f) f.list.splice(f.index, 1);
  }, { select: next });
  toast(t('blk.deleted'), 'info', { label: t('dlg.undo'), fn: undo });
}

function duplicateBlock(bid) {
  const fb = findBlock(bid);
  if (!fb) return;
  let c;
  try { c = prepareCopy(cloneBlock(fb.block)); } catch (e) { toast(t('err.generic', { msg: e.message }), 'error'); return; }
  commit('duplicate', () => {
    const f = findBlock(bid);
    f.list.splice(f.index + 1, 0, c);
  }, { select: c.id });
  select(c.id, null, { scroll: true, force: true });
}

// Move block to listPath at index (index refers to the list BEFORE removal).
// Guards, cheapest first: structural rules (topLevel types only in regions), cycles (a block into its own subtree
// would detach it from the tree entirely), a missing target, and no-op moves (same slot) that would only add an
// empty undo step.
function moveBlockTo(bid, listPath, index) {
  const fb = findBlock(bid);
  if (!fb) return false;
  // Region-only types (pages) stay in a region list; while the main region is a list of such containers (ED.mainList),
  // other blocks never land in it directly.
  if (typeDef(fb.block.type).topLevel ? !regionOf(listPath) : listPath === 'regions.main' && mainPath() !== 'regions.main') return false;
  const owner = listOwner(listPath);
  if (owner && isWithin(owner, bid)) return false; // never into itself
  const target = getList(listPath);
  if (!target) return false;
  if (target === fb.list && (index === fb.index || index === fb.index + 1)) return false;
  commit('move', () => {
    const f = findBlock(bid);
    const tgt = getList(listPath);
    let at = Math.min(index, tgt.length);
    if (tgt === f.list && f.index < at) at--;
    f.list.splice(f.index, 1);
    tgt.splice(at, 0, f.block);
  }, { select: bid });
  return true;
}

// Alt+↑/↓: move within list; at the boundary move out of the parent container.
function moveBlockBy(bid, dir) {
  const fb = findBlock(bid);
  if (!fb) return;
  const ni = fb.index + dir;
  if (ni >= 0 && ni < fb.list.length) {
    moveBlockTo(bid, fb.listPath, dir > 0 ? ni + 1 : ni);
  } else if (fb.parent && !isTransparent(fb.parent)) {
    const pf = findBlock(fb.parent.id);
    if (pf) moveBlockTo(bid, pf.listPath, dir > 0 ? pf.index + 1 : pf.index);
  } else if (!typeDef(fb.block.type).topLevel) {
    // top-level (a region, or the edited page of a multi-page product): hop between regions (header → main → …)
    const order = regions().map((r) => (r === 'main' ? mainPath() : 'regions.' + r));
    const oi = order.indexOf(fb.listPath) + dir;
    if (oi >= 0 && oi < order.length) {
      const target = getList(order[oi]);
      if (target) moveBlockTo(bid, order[oi], dir > 0 ? 0 : target.length);
    }
  }
  scheduleChrome();
  const be = blockEl(bid);
  if (be) be.scrollIntoView({ block: 'nearest' });
}

function toggleBlockProp(bid, key) {
  commit('toggle ' + key, () => { const b = findBlock(bid)?.block; if (b) b[key] = !b[key]; }, { render: bid });
  renderInspector();
}

// Two clipboards: localStorage (structured, survives reload, shared by editor tabs of this product) is the source of
// truth for paste; the system clipboard gets the JSON as text best-effort (permission may be denied silently).
function copyBlock(bid) {
  const fb = findBlock(bid);
  if (!fb) return;
  S.clip = JSON.stringify(fb.block);
  lsSet(edKey('clip'), S.clip);
  try { navigator.clipboard?.writeText?.(S.clip).catch(() => {}); } catch { /* ignore */ }
  toast(t('blk.copied'), 'ok');
}
// A clipboard block may come from another tab or project (localStorage): normalize it inside a temporary document
// (props, items, tables, attachment refs that do not exist here → none) and sanitize its rich text, like an import.
function cleanClipBlock(b) {
  const only = (x) => Object.fromEntries(regions().map((r) => [r, r === 'main' ? [x] : []]));
  const tmp = normalizeDoc({
    format: P.format, version: 1, langs: S.doc.langs, defaultLang: S.doc.defaultLang,
    attachments: S.doc.attachments, requests: S.doc.requests, regions: only(b),
  });
  // The product may wrap the block while normalizing (a multi-page product puts it on a page): find it by id, else
  // the first block of its type.
  let nb = null;
  if (isObj(tmp) && isObj(tmp.regions)) {
    walk((x) => { if (x.id === b.id) { nb = x; return true; } return false; }, tmp);
    if (!nb) walk((x) => { if (x.type === b.type) { nb = x; return true; } return false; }, tmp);
  }
  if (!isObj(nb)) return null;
  sanitizeDocRich({ regions: only(nb) });
  return nb;
}

// Clipboard content is untrusted (any tab, older version): parse, check the type, normalise and sanitise, then
// cloneBlock gives fresh ids so pasting twice never yields duplicate ids. Any failure reads as an empty clipboard.
function pasteBlock(pos) {
  const raw = S.clip || lsGet(edKey('clip'), null);
  if (!raw) { toast(t('clip.empty')); return; }
  try {
    const b = JSON.parse(raw);
    if (!isObj(b) || !own(BLOCK_TYPES, b.type)) throw new Error('bad clip');
    const nb = cleanClipBlock(b);
    if (!nb) throw new Error('bad clip');
    const c = prepareCopy(cloneBlock(nb));
    insertBlockObject(c, pos || routeInsertPos(c.type, insertPosAfter(S.sel.bid)));
  } catch { toast(t('clip.empty')); }
}

// Categories in palette order (ED.categories; unknown categories follow in registry order).
function blockTypesByCat() {
  const cats = {};
  for (const [type, def] of Object.entries(BLOCK_TYPES || {})) {
    if (def.palette === false) continue; // legacy types kept for old documents (migrated on load), never offered
    const c = def.category || ED.categories[0] || 'blocks';
    (cats[c] ||= []).push(type);
  }
  const rank = (c) => { const i = ED.categories.indexOf(c); return i < 0 ? 99 : i; };
  return Object.keys(cats).sort((a, b) => rank(a) - rank(b)).map((c) => [c, cats[c]]);
}

function openInsertMenu(anchor, pos) {
  const items = [];
  for (const [cat, types] of blockTypesByCat()) {
    items.push({ header: true, label: t('c.' + cat) });
    for (const type of types) items.push({ label: t('b.' + type), iconHTML: typeIcon(type), action: () => insertBlock(type, pos, undefined, { route: true }) });
  }
  openMenu(anchor, items, { className: 'ed-menu-insert' });
}

// Menu label without the trailing shortcut hint, e.g. "Duplicate (Ctrl+D)" → "Duplicate".
const tNoKbd = (key) => t(key).replace(/\s*\([^)]*\)\s*$/, '');

// The block menu (toolbar "more" button, context menu of the canvas): openMenu items; insert submenus open at
// anchorOrPoint.
function blockMenuItems(bid, anchorOrPoint) {
  const fb = findBlock(bid);
  if (!fb) return null;
  const b = fb.block;
  const hasClip = !!(S.clip || lsGet(edKey('clip'), null));
  return [
    { label: t('blk.props'), icon: 'sliders', action: () => { select(bid); setRightTab('block'); if (S.noRight) togglePanel('right'); } },
    { sep: true },
    { label: t('blk.insertAbove'), icon: 'up', action: () => openInsertMenu(anchorOrPoint, insertPosBefore(bid)) },
    { label: t('blk.insertBelow'), icon: 'down', action: () => openInsertMenu(anchorOrPoint, insertPosAfter(bid)) },
    { sep: true },
    { label: tNoKbd('blk.dup'), icon: 'copy', kbd: 'Ctrl+D', action: () => duplicateBlock(bid) },
    { label: t('blk.copy'), icon: 'clip', kbd: 'Ctrl+C', action: () => copyBlock(bid) },
    { label: t('blk.paste'), icon: 'paste', kbd: 'Ctrl+V', disabled: !hasClip, action: () => pasteBlock(insertPosAfter(bid)) },
    { sep: true },
    { label: tNoKbd('blk.up'), icon: 'up', action: () => moveBlockBy(bid, -1) },
    { label: tNoKbd('blk.down'), icon: 'down', action: () => moveBlockBy(bid, 1) },
    fb.parent && !isTransparent(fb.parent) ? { label: t('blk.parent'), icon: 'parent', action: () => select(fb.parent.id, null, { scroll: true }) } : null,
    { sep: true },
    { label: b.hidden ? t('blk.show') : t('blk.hide'), icon: b.hidden ? 'eye' : 'eyeOff', action: () => toggleBlockProp(bid, 'hidden') },
    // product items (print flags, device visibility…)
    ...(ED.blockMenu ? ED.blockMenu(b) : []),
    { sep: true },
    { label: tNoKbd('blk.del'), icon: 'trash', danger: true, action: () => deleteBlock(bid) },
  ].filter(Boolean);
}

function openBlockMenu(bid, anchorOrPoint) {
  const items = blockMenuItems(bid, anchorOrPoint);
  if (items) openMenu(anchorOrPoint, items);
}

export {
  blockMenuItems,
  blockTypesByCat,
  copyBlock,
  deleteBlock,
  duplicateBlock,
  focusFirstField,
  insertBlock,
  insertBlockObject,
  insertPosAfter,
  moveBlockBy,
  moveBlockTo,
  openBlockMenu,
  openInsertMenu,
  pasteBlock,
  prepareCopy,
  routeInsertPos,
  toggleBlockProp
};
