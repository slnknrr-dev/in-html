// site-studio/wiki-ed-blocks.js - the block list of a page version in the editor: block cards (header with type,
// layer and visibility badges, move / duplicate / delete, context menu), forms built from the block schema
// (blocks.js fields), nested columns, list items, the block palette and block operations.
import { h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { ED_I18N, t } from '../ui/i18n.js';
import { openDialog, openMenu } from '../ui/overlays.js';
import { contextMenu } from '../ui/contextmenu.js';
import { BLOCKS, BLOCK_ORDER, CATEGORIES } from './wiki-blocks.js';
import { newBlock, normBlock, uid, walkBlocks } from './wiki-model.js';
import { plainText } from './wiki-markup.js';
import { S, commitTarget, select, target } from './wiki-state.js';
import { check, colorEl, gridEditor, input, lineMarkup, linkInput, layerSelect, layersMulti, markupArea, numInput, row, selectEl } from './wiki-ed-fields.js';
import { mediaPicker } from './wiki-ed-media.js';
import { openDiagramEditor } from './wiki-ed-diagram.js';

// Block icon names (blocks.js) are mapped onto the editor's icon set (ui/icons.js); unknown ones fall back to 'section'.
const ICON_MAP = { book: 'doc', copy: 'copy', chevDown: 'chevDown', info: 'info', terminal: 'terminal', divider: 'divider', keyvalue: 'keyvalue', hash: 'hash', link: 'link', grid: 'grid', table: 'table', timeline: 'timeline', stack: 'stack', image: 'image', gallery: 'gallery', pin: 'pin', hero: 'hero', languages: 'languages', columns: 'columns', type: 'type', heading: 'heading', quote: 'quote', list: 'list', doc: 'doc', users: 'users', megaphone: 'megaphone', check: 'check', search: 'search' };
export const blockIcon = (type) => ICON_MAP[(BLOCKS[type] || {}).icon] || 'section';
export const blockName = (type) => t('b.' + type);

// Where a block lives: { list, index, block } inside the version lists and nested columns of obj.
// Search by id, not by path: a path would be invalidated by any insert/move, an id survives every operation and undo.
export function findBlock(obj, id) {
  let out = null;
  for (const v of (obj && obj.versions) || []) {
    walkBlocks(v.blocks, (b, list, i) => { if (!out && b.id === id) out = { list, index: i, block: b, version: v }; });
    if (out) break;
  }
  return out;
}

// A short summary of a block for collapsed cards.
function summary(b) {
  const pick = b.title || b.text || b.caption || b.summary || b.intro || b.code || (b.items && b.items[0] && (b.items[0].label || b.items[0].text || b.items[0].term || b.items[0].title || b.items[0].front)) || (b.rows && b.rows[0] && (Array.isArray(b.rows[0]) ? b.rows[0].join(' · ') : b.rows[0].label)) || '';
  const s = typeof pick === 'string' ? plainText(pick.split('\n').find((l) => l.trim()) || '', { plain: true }) : '';
  return s.length > 90 ? s.slice(0, 90) + '…' : s;
}

// ---- operations (through commitTarget, which reseals secret payloads)
// Every structural operation (insert, move, remove, duplicate) is a commitTarget with structure:true: one undo step,
// re-seal of secret payloads, full repaint of the list. Field edits use per-field keys instead (see blockForm).
function op(fn, structure = true) { commitTarget((obj) => fn(obj), { structure }); }
export function insertBlock(listOwner, index, type) {
  const b = newBlock(type);
  op((obj) => {
    const list = listOwner(obj);
    if (list) list.splice(index, 0, b);
  });
  select({ blockId: b.id });
  return b;
}
const at = (id, fn) => op((obj) => { const f = findBlock(obj, id); if (f) fn(f); });
export const moveBlock = (id, d) => at(id, (f) => { const j = f.index + d; if (j < 0 || j >= f.list.length) return; f.list.splice(f.index, 1); f.list.splice(j, 0, f.block); });
export const removeBlock = (id) => at(id, (f) => f.list.splice(f.index, 1));
export const duplicateBlock = (id) => at(id, (f) => {
  const c = normBlock(JSON.parse(JSON.stringify(f.block)));
  c.id = uid();
  walkBlocks([c], (x) => { if (x !== c) x.id = uid(); });
  f.list.splice(f.index + 1, 0, c);
});

// The palette: block types by category; resolves with a type or null.
export function pickBlockType() {
  return new Promise((resolve) => {
    let close = () => {};
    let done = false;
    const body = h('div', { class: 'kp-palette' }, CATEGORIES.map((cat) => h('section', {},
      h('h3', { class: 'kp-pal-h' }, t('c.' + cat)),
      h('div', { class: 'kp-pal-g' }, BLOCK_ORDER.filter((k) => BLOCKS[k].cat === cat).map((k) => h('button', {
        type: 'button', class: 'kp-pal-b', onclick: () => { done = true; resolve(k); close(); },
      }, iconEl(blockIcon(k)), h('span', {}, h('b', {}, blockName(k)), h('small', {}, t('bd.' + k)))))))));
    openDialog({ title: t('kp.addBlock'), body, wide: true, buttons: [], onMount: (o) => { close = o.close; } }).then(() => { if (!done) resolve(null); });
  });
}

// ---- forms

// Option labels: a field-specific key ('o.style.block') when the dictionary has one, else the generic 'o.block'.
// Looks the key up in the English reference dictionary (every key must exist there), so a field-specific label is used only if it was defined.
const optLabel = (key, v) => (ED_I18N.en['o.' + key + '.' + v] != null ? t('o.' + key + '.' + v) : t('o.' + v));

// A control for one field of a block (or of a list item). set(value) commits; obj: the edited page object.
function fieldControl(key, f, value, set, ctx) {
  switch (f.k) {
    case 'text':
      if (ctx.block.type === 'code') return h('textarea', { class: 'ed-input ed-textarea ed-code', rows: 8, spellcheck: 'false', oninput: (e) => set(e.target.value) }, value || '');
      return markupArea(value, set, { rows: ctx.block.type === 'verse' ? 8 : 4, obj: ctx.obj, toolbar: ctx.block.type !== 'verse' || key !== 'translation' });
    case 'line': return lineMarkup(value, set);
    case 'plain': return key === 'code' ? h('textarea', { class: 'ed-input ed-textarea ed-code', rows: 8, spellcheck: 'false', oninput: (e) => set(e.target.value) }, value || '') : input(value, set);
    case 'link': return linkInput(value, set);
    case 'day': return input(value, set, { type: 'date' });
    case 'num': return numInput(value, set, { min: f.min, max: f.max, step: f.max <= 100 && f.min >= -1 ? 0.5 : 1 });
    case 'bool': return check(value, set);
    case 'select': return selectEl(f.o.map((v) => ({ v, l: f.ol ? t(f.ol(v)) : /^\d+(:\d+)+$|^\d$/.test(v) ? v : optLabel(key, v) })), value, set);
    case 'media': return mediaPicker(value, set, { accept: key === 'audio' ? 'media' : key === 'image' ? 'image' : '' });
    case 'color': return colorEl(value, set);
    case 'layer': return layerSelect(value, set, ctx.obj);
    case 'layers': return layersMulti(value, (v) => { set(v); ctx.rerender(); }, ctx.obj);
    case 'grid': return gridEditor(value, set);
    case 'tiers': {
      const tiers = (ctx.block.tiers || []);
      const box = h('div', { class: 'kp-tiers' });
      if (!tiers.length) box.append(h('span', { class: 'ed-hint' }, t('kp.tiersHint')));
      const cur = { ...(value || {}) };
      for (const lid of tiers) box.append(row(ctx.layerLabel(lid), lineMarkup(cur[lid] || '', (v) => { cur[lid] = v; set({ ...cur }); })));
      return box;
    }
    case 'list': return listEditor(key, f, value || [], set, ctx);
    case 'cols': return colsEditor(value, ctx);
    case 'pts': return h('span', { class: 'ed-hint' }, t('kp.ptsHint', { n: (value || []).length }));
    default: return h('span');
  }
}

// Short controls are grouped in a compact grid under the wide ones (text, lists), so a block form stays readable.
const COMPACT = new Set(['num', 'bool', 'select', 'color', 'layer']);

function itemTitle(it) {
  const s = it.label || it.title || it.term || it.name || it.text || it.front || it.date || it.link || it.from || '';
  return plainText(String(s), { plain: true }).slice(0, 60);
}

function listEditor(key, f, items, set, ctx) {
  const box = h('div', { class: 'kp-list' });
  let data = items.map((x) => ({ ...x }));
  const emit = () => set(data.map((x) => ({ ...x })));
  const empty = () => { const o = {}; for (const [k, sf] of Object.entries(f.item)) o[k] = sf.k === 'num' ? sf.d ?? null : sf.k === 'bool' ? !!sf.d : sf.k === 'select' ? sf.d ?? sf.o[0] : sf.k === 'tiers' ? {} : sf.k === 'pts' ? [] : ''; return o; };
  const paint = (openIdx = -1) => {
    box.replaceChildren(...data.map((it, i) => {
      const det = h('details', { class: 'kp-li', open: i === openIdx || data.length <= 3 });
      const head = h('summary', { class: 'kp-li-h' }, h('span', { class: 'kp-li-n' }, String(i + 1)), h('span', { class: 'kp-li-t' }, itemTitle(it) || t('kp.item')),
        h('span', { class: 'kp-li-a' },
          h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('kp.moveUp'), 'aria-label': t('kp.moveUp'), disabled: i === 0, onclick: (e) => { e.preventDefault(); [data[i - 1], data[i]] = [data[i], data[i - 1]]; emit(); paint(i - 1); } }, iconEl('up')),
          h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('kp.moveDown'), 'aria-label': t('kp.moveDown'), disabled: i === data.length - 1, onclick: (e) => { e.preventDefault(); [data[i + 1], data[i]] = [data[i], data[i + 1]]; emit(); paint(i + 1); } }, iconEl('down')),
          h('button', { type: 'button', class: 'ed-iconbtn ed-sm ed-danger', title: t('kp.remove'), 'aria-label': t('kp.remove'), onclick: (e) => { e.preventDefault(); data.splice(i, 1); emit(); paint(); } }, iconEl('trash'))));
      const fields = h('div', { class: 'kp-li-f' });
      for (const [k, sf] of Object.entries(f.item)) {
        if (ctx.block.type === 'diagram' && key === 'items' && ['pts'].includes(k)) continue;
        if (ctx.block.type === 'interlinear' && k === 't' && !ctx.block.audio) continue;
        const ctl = fieldControl(k, sf, it[k], (v) => { data[i][k] = v; emit(); if (['label', 'title', 'term', 'text', 'front'].includes(k)) head.querySelector('.kp-li-t').textContent = itemTitle(data[i]) || t('kp.item'); }, { ...ctx, item: it });
        fields.append(row(t(sf.label || 'f.' + k), ctl, sf.hint ? t(sf.hint) : null, !COMPACT.has(sf.k)));
      }
      det.append(head, fields);
      return det;
    }), h('button', { type: 'button', class: 'ed-btn ed-sm kp-add-item', onclick: () => { data.push(empty()); emit(); paint(data.length - 1); } }, iconEl('plus'), t('kp.addItem')));
  };
  paint();
  return box;
}

function colsEditor(cols, ctx) {
  const box = h('div', { class: 'kp-cols-ed' });
  (cols || []).forEach((c, ci) => {
    box.append(h('div', { class: 'kp-col-ed' }, h('div', { class: 'kp-col-h' }, t('kp.columnN', { n: ci + 1 })),
      blockList((obj) => { const f = findBlock(obj, ctx.block.id); return f ? f.block.cols[ci].blocks : null; }, c.blocks, ctx.obj, ctx.depth + 1)));
  });
  return box;
}

// The form of a block.
// The form is generated from the block schema: one control per field. Each setter re-finds the block by id inside
// the committed object and coalesces by blockId:field, so typing in one field is one undo step. Only the selected
// block shows its form (accordion): rendering forms for hundreds of blocks would make every repaint slow.
function blockForm(b, obj, depth, rerender) {
  const T = BLOCKS[b.type];
  const form = h('div', { class: 'kp-bf' });
  const ctx = { block: b, obj, depth, rerender, layerLabel: (id) => { const l = [...(S.kb.layers || []), ...((obj && obj.layers) || [])].find((x) => x.id === id); return l ? l.label : id; } };
  if (b.type === 'diagram') {
    form.append(h('div', { class: 'kp-row' }, h('button', { type: 'button', class: 'ed-btn ed-primary ed-sm', onclick: () => openDiagramEditor(b.id) }, iconEl('pin'), t('kp.editDiagram')), h('span', { class: 'ed-hint' }, t('kp.diagramHint'))));
  }
  const compact = h('div', { class: 'kp-bf-compact' });
  for (const [key, f] of Object.entries(T.fields)) {
    const set = (v) => commitTarget((o) => { const x = findBlock(o, b.id); if (x) x.block[key] = v; }, { key: b.id + ':' + key });
    const ctl = fieldControl(key, f, b[key], set, ctx);
    const r = row(t(f.label || 'f.' + key), ctl, f.k === 'layers' && b.type === 'interlinear' ? t('kp.tiersPick') : f.hint ? t(f.hint) : null, !COMPACT.has(f.k));
    if (COMPACT.has(f.k)) compact.append(r); else form.append(r);
  }
  // Every block: shown with a layer only, hidden.
  compact.append(row(t('kp.blockLayer'), layerSelect(b.layer || '', (v) => commitTarget((o) => { const x = findBlock(o, b.id); if (x) { if (v) x.block.layer = v; else delete x.block.layer; } }, { structure: true }), obj), null));
  if (compact.childNodes.length) form.append(compact);
  return form;
}

// A list of block cards; owner(obj) returns the live array to edit (version blocks or a column's blocks).
// Card header: role=button + tabindex=0 with Enter/Space handling (a <button> cannot contain the nested action
// buttons). Action buttons stopPropagation so they do not also toggle selection. The context menu is scoped to this
// list's own cards (card.parentNode === box) so nested column lists do not open their parent's menu.
export function blockList(owner, blocks, obj, depth = 0) {
  const box = h('div', { class: 'kp-blocks' + (depth ? ' kp-blocks-nested' : '') });
  const addAt = async (i) => { const type = await pickBlockType(); if (type) insertBlock(owner, i, type); };
  (blocks || []).forEach((b, i) => {
    const sel = S.blockId === b.id;
    const card = h('div', { class: 'kp-bc' + (sel ? ' kp-sel' : '') + (b.off ? ' kp-off' : ''), 'data-bid': b.id });
    const head = h('div', { class: 'kp-bh', tabindex: '0', role: 'button', 'aria-expanded': String(sel) },
      iconEl(blockIcon(b.type)), h('span', { class: 'kp-bh-t' }, blockName(b.type)),
      b.layer ? h('span', { class: 'kp-badge' }, iconEl('layers'), b.layer) : null,
      b.off ? h('span', { class: 'kp-badge kp-badge-off' }, iconEl('eyeOff'), t('kp.hidden')) : null,
      sel ? null : h('span', { class: 'kp-bh-s' }, summary(b)),
      h('span', { class: 'kp-bh-a' },
        h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('kp.moveUp'), 'aria-label': t('kp.moveUp'), disabled: i === 0, onclick: (e) => { e.stopPropagation(); moveBlock(b.id, -1); } }, iconEl('up')),
        h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('kp.moveDown'), 'aria-label': t('kp.moveDown'), disabled: i === blocks.length - 1, onclick: (e) => { e.stopPropagation(); moveBlock(b.id, 1); } }, iconEl('down')),
        h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('kp.more'), 'aria-label': t('kp.more'), onclick: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); openBlockMenu(b, { x: r.left, y: r.bottom }); } }, iconEl('more'))));
    const toggle = () => select({ blockId: sel ? '' : b.id });
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    card.append(head);
    if (sel) card.append(blockForm(b, obj, depth, () => select({ blockId: b.id })));
    box.append(h('button', { type: 'button', class: 'kp-ins', title: t('kp.insertHere'), 'aria-label': t('kp.insertHere'), onclick: () => addAt(i) }, iconEl('plus')), card);
  });
  box.append(h('button', { type: 'button', class: 'ed-btn kp-add-block', onclick: () => addAt((blocks || []).length) }, iconEl('plus'), t('kp.addBlock')));
  contextMenu(box, (el) => {
    const card = el.closest('.kp-bc');
    if (!card || card.parentNode !== box) return null;
    const tg = target();
    const f = tg && tg.obj ? findBlock(tg.obj, card.dataset.bid) : null;
    return f ? blockMenuItems(f.block) : null;
  }, { selector: '.kp-bh' });
  return box;
}

function blockMenuItems(b) {
  const tg = target();
  const layers = [...(S.kb.layers || []), ...((tg && tg.obj && tg.obj.layers) || [])];
  return [
    { label: t('kp.edit'), icon: 'edit', action: () => select({ blockId: b.id }) },
    { label: t('kp.moveUp'), icon: 'up', action: () => moveBlock(b.id, -1) },
    { label: t('kp.moveDown'), icon: 'down', action: () => moveBlock(b.id, 1) },
    { label: t('kp.duplicate'), icon: 'copy', action: () => duplicateBlock(b.id) },
    { label: b.off ? t('kp.show') : t('kp.hide'), icon: b.off ? 'eye' : 'eyeOff', action: () => at(b.id, (f) => { if (f.block.off) delete f.block.off; else f.block.off = true; }) },
    { sep: true },
    { header: true, label: t('kp.blockLayer') },
    { label: t('kp.noLayer'), checked: !b.layer, action: () => at(b.id, (f) => { delete f.block.layer; }) },
    ...layers.map((l) => ({ label: l.label || l.id, checked: b.layer === l.id, action: () => at(b.id, (f) => { f.block.layer = l.id; }) })),
    { sep: true },
    { label: t('kp.delete'), icon: 'trash', danger: true, action: () => removeBlock(b.id) },
  ];
}

function openBlockMenu(b, pt) {
  openMenu(pt, blockMenuItems(b));
}
