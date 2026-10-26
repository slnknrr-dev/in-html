// landing-studio/editor-collection.js - inspector controls of the collection block (ED.fieldControls): `kvlist` (an
// item's label–value attributes), `filelist` (an item's files: attachment, label, how it opens; multi-file upload) and
// `clkeys` (the block's filter / range / sort keys picked from the attributes its items use).
//
// Contract of a field control (studio ED.fieldControls): (f, v, onChange, id, ctx) -> Element. `v` is the current value,
// onChange(next, typing) commits it (typing = true coalesces keystrokes into one undo step), `id` labels the control
// for the inspector's <label for>, ctx.bid names the edited block.
// Design rule: each control keeps a private working copy (`rows`) and emits a fresh deep-enough copy on every change.
// Emitting the working array itself would let the history snapshot and the control share objects, so a later keystroke
// would silently rewrite an already committed undo state.
import { h } from '../ui/dom.js';
import { pickFiles } from '../ui/files.js';
import { icon, iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { S } from '../studio/state.js';
import { attList, findBlock, pickT } from '../studio/doc.js';
import { addFiles } from '../studio/attach.js';
import { fieldUploadOpts } from '../studio/fields.js';
import { CL_KINDS, clLabelKey, clNum } from './viewer-blocks-collection.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
// Accepts legacy plain strings and lifts them into the editing language, so old documents edit without migration.
const i18nCopy = (v) => (isObj(v) ? { ...v } : typeof v === 'string' && v ? { [S.lang]: v } : {});
// Text of an i18n value in the editing language ('' when missing) and its fallback (for placeholders).
// Inputs show only the editing language; the fallback (another language) goes to the placeholder, so the user sees a
// translation is missing instead of mistaking the fallback for this language's text.
const inLang = (v) => (isObj(v) && typeof v[S.lang] === 'string' ? v[S.lang] : '');
const fallback = (v) => (isObj(v) ? pickT(v) || '' : '');
const blockOf = (ctx) => (ctx && ctx.bid ? findBlock(ctx.bid)?.block : null);

// Small icon button of a row (move / remove).
function rowBtn(ic, label, fn, o = {}) {
  return h('button', {
    type: 'button', class: 'ed-iconbtn ed-sm' + (o.danger ? ' ed-danger' : ''), title: label, 'aria-label': label,
    disabled: !!o.disabled, html: icon(ic), onclick: fn,
  });
}

// Up / down / remove buttons of row i of `rows` (re-renders through `again`, commits through `emit`).
// Out-of-range moves cannot happen: the first row's up and the last row's down are rendered disabled.
function rowActs(rows, i, again, emit) {
  const move = (d) => { const j = i + d; [rows[i], rows[j]] = [rows[j], rows[i]]; emit(false); again(); };
  return h('span', { class: 'ed-cl-acts' },
    rowBtn('up', t('cl.ed.up'), () => move(-1), { disabled: i === 0 }),
    rowBtn('down', t('cl.ed.down'), () => move(1), { disabled: i === rows.length - 1 }),
    rowBtn('trash', t('cl.ed.remove'), () => { rows.splice(i, 1); emit(false); again(); }, { danger: true }));
}

/* ---------- attributes ---------- */

// Attribute labels of the block's items: [{ key, label (i18n) }] in order of first use.
// Labels are compared by clLabelKey (the normalized key the viewer filters on), so 'Color' and ' color ' are one
// attribute, the same rule the published page uses. `item` / `a` are returned for callers that need the source row.
function blockLabels(block) {
  const out = [];
  const seen = new Set();
  for (const it of Array.isArray(block?.items) ? block.items : []) {
    for (const a of Array.isArray(it?.attrs) ? it.attrs : []) {
      if (!isObj(a)) continue;
      const k = clLabelKey(pickT(a.label) || '');
      if (k && !seen.has(k)) { seen.add(k); out.push({ key: k, label: a.label, item: it, a }); }
    }
  }
  return out;
}

// The <datalist> offers labels already used by sibling items: consistent wording is what makes filtering work.
function kvlistControl(f, v, onChange, id, ctx) {
  const rows = (Array.isArray(v) ? v : []).filter(isObj).map((a) => ({ label: i18nCopy(a.label), value: i18nCopy(a.value) }));
  const box = h('div', { class: 'ed-cl-list', id, role: 'group' });
  const list = h('div', { class: 'ed-cl-rows' });
  const dlId = id + '-labels';
  const dl = h('datalist', { id: dlId });
  const more = h('div', { class: 'ed-cl-more' });
  const emit = (typing) => onChange(rows.map((r) => ({ label: { ...r.label }, value: { ...r.value } })), typing);
  const field = (r, k, cls, label, extra = {}) => {
    const inp = h('input', {
      type: 'text', class: 'ed-input ' + cls, value: inLang(r[k]), placeholder: fallback(r[k]) || label, 'aria-label': label,
      lang: S.lang, dir: 'auto', spellcheck: 'true', ...extra,
    });
    inp.addEventListener('input', () => { r[k] = { ...r[k], [S.lang]: inp.value }; emit(true); });
    inp.addEventListener('change', () => { emit(false); if (k === 'label') suggest(); });
    return inp;
  };
  const render = () => {
    list.textContent = '';
    rows.forEach((r, i) => list.append(h('div', { class: 'ed-cl-row ed-cl-kv' },
      field(r, 'label', 'ed-cl-k', t('cl.ed.label'), { list: dlId }), field(r, 'value', 'ed-cl-v', t('cl.ed.value')),
      rowActs(rows, i, render, emit))));
    if (!rows.length) list.append(h('p', { class: 'ed-muted ed-cl-none' }, t('cl.ed.noAttrs')));
    suggest();
  };
  // Labels other items use and this one lacks: one click adds them (same wording in every language).
  // Recomputed from the live block, not cached: other items may have been edited since this control rendered. Capped at
  // 12 chips to keep the inspector compact.
  const suggest = () => {
    const used = blockLabels(blockOf(ctx));
    dl.textContent = '';
    for (const u of used) dl.append(h('option', { value: pickT(u.label) }));
    const mine = new Set(rows.map((r) => clLabelKey(pickT(r.label) || '')));
    const miss = used.filter((u) => !mine.has(u.key));
    more.textContent = '';
    if (!miss.length) return;
    more.append(h('span', { class: 'ed-hint' }, t('cl.ed.used')),
      ...miss.slice(0, 12).map((u) => h('button', {
        type: 'button', class: 'ed-chip', onclick: () => { rows.push({ label: { ...u.label }, value: {} }); emit(false); render(); list.querySelector('.ed-cl-row:last-child .ed-cl-v')?.focus(); },
      }, '+ ' + (pickT(u.label) || u.key))));
  };
  const add = h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => {
    rows.push({ label: {}, value: {} });
    emit(false);
    render();
    list.querySelector('.ed-cl-row:last-child .ed-cl-k')?.focus();
  } }, iconEl('plus'), t('cl.ed.addAttr'));
  render();
  box.append(list, dl, more, h('div', { class: 'ed-row ed-cl-add' }, add));
  return box;
}

/* ---------- files ---------- */

// Rows without an attachment are kept in the UI (a row being set up) but filtered out of the emitted value, so the
// document never holds a file entry pointing at nothing.
function filelistControl(f, v, onChange, id, ctx) {
  const rows = (Array.isArray(v) ? v : []).filter(isObj).map((x) => ({ att: x.att || null, label: i18nCopy(x.label), kind: CL_KINDS.includes(x.kind) ? x.kind : 'auto' }));
  const box = h('div', { class: 'ed-cl-list', id, role: 'group' });
  const list = h('div', { class: 'ed-cl-rows' });
  const emit = (typing) => onChange(rows.filter((r) => r.att).map((r) => ({ att: r.att, label: { ...r.label }, kind: r.kind })), typing);
  const atts = () => attList();
  const render = () => {
    list.textContent = '';
    const all = atts();
    rows.forEach((r, i) => {
      const a = all.find((x) => x.id === r.att);
      const sel = h('select', { class: 'ed-input ed-select ed-cl-att', 'aria-label': t('f.att') },
        h('option', { value: '' }, '— ' + t('fld.none') + ' —'),
        all.map((x) => h('option', { value: x.id }, x.title + (x.title !== x.name ? ` (${x.name})` : ''))));
      sel.value = a ? a.id : '';
      sel.addEventListener('change', () => { r.att = sel.value || null; emit(false); render(); });
      const name = a ? a.title || a.name : '';
      const lab = h('input', {
        type: 'text', class: 'ed-input ed-cl-fl', value: inLang(r.label), placeholder: fallback(r.label) || name.replace(/\.[a-z0-9]{1,6}$/i, '') || t('cl.ed.fileLabel'),
        'aria-label': t('cl.ed.fileLabel'), lang: S.lang, dir: 'auto',
      });
      lab.addEventListener('input', () => { r.label = { ...r.label, [S.lang]: lab.value }; emit(true); });
      lab.addEventListener('change', () => emit(false));
      const kind = h('select', { class: 'ed-input ed-select ed-cl-kind', 'aria-label': t('cl.ed.kind'), title: t('cl.ed.kind') },
        CL_KINDS.map((k) => h('option', { value: k }, t('o.fk.' + k))));
      kind.value = r.kind;
      kind.addEventListener('change', () => { r.kind = kind.value; emit(false); });
      list.append(h('div', { class: 'ed-cl-row ed-cl-file' },
        h('span', { class: 'ed-cl-n', 'aria-hidden': 'true' }, String(i + 1)), sel, rowActs(rows, i, render, emit), lab, kind));
    });
    if (!rows.length) list.append(h('p', { class: 'ed-muted ed-cl-none' }, t('cl.ed.noFiles')));
  };
  const add = h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => {
    const used = new Set(rows.map((r) => r.att));
    const free = atts().find((x) => !used.has(x.id));
    rows.push({ att: free ? free.id : null, label: {}, kind: 'auto' });
    emit(false);
    render();
    list.querySelector('.ed-cl-row:last-child select')?.focus();
  } }, iconEl('plus'), t('cl.ed.addFile'));
  // Upload path: files become document attachments (addFiles), then rows reference them by id. ctx.rerender refreshes
  // the inspector because the attachment list other selects offer has changed.
  const up = h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: async () => {
    const files = await pickFiles({ multiple: true });
    if (!files.length) return;
    // Chapters keep the order of their names (01-intro.mp3, 02-…).
    // numeric: true makes '10-x' sort after '9-x'; plain string order would put chapter 10 before chapter 2.
    files.sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true }));
    const ids = await addFiles(files, { quiet: true, ...fieldUploadOpts(f, ctx) });
    for (const aid of ids) rows.push({ att: aid, label: {}, kind: 'auto' });
    if (ids.length) { emit(false); render(); ctx.rerender?.(); }
  } }, iconEl('upload'), t('cl.ed.upload'));
  render();
  box.append(list, h('div', { class: 'ed-row ed-cl-add' }, add, up));
  return box;
}

/* ---------- filter / range / sort keys ---------- */

// '$'-prefixed keys are built-in item properties (tags, kind, price, title, date), not attributes; the prefix cannot
// collide with clLabelKey output of a user label.
const KEY_SPECIAL = { filter: ['$tags', '$kind'], range: ['$price'], sort: ['$title', '$date', '$price'] };

// Keys no longer present in any item are shown as "gone" chips rather than dropped: removing them silently on render
// would change the document without a user action. Toggling patches the chip in place (no re-render) so keyboard focus
// stays on the pressed chip.
function clkeysControl(f, v, onChange, id, ctx) {
  const mode = KEY_SPECIAL[f.mode] ? f.mode : 'filter';
  let cur = Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  const block = blockOf(ctx) || (ctx.getObj ? ctx.getObj() : null);
  const labels = blockLabels(block).filter((u) => {
    if (mode !== 'range') return true;
    // Ranges: attributes with numbers in their values.
    return (block.items || []).some((it) => (it.attrs || []).some((a) => clLabelKey(pickT(a.label) || '') === u.key && clNum(pickT(a.value)) != null));
  });
  const opts = [...KEY_SPECIAL[mode].map((k) => ({ key: k, text: t('cl.ed.k' + k.slice(1)) })),
    ...labels.map((u) => ({ key: u.key, text: (isObj(u.label) && (u.label[S.lang] || pickT(u.label))) || u.key }))];
  for (const k of cur) if (!opts.some((o) => o.key === k)) opts.push({ key: k, text: k, gone: true });
  const g = h('div', { class: 'ed-chips ed-cl-keys', id, role: 'group' });
  for (const o of opts) {
    const on = cur.includes(o.key);
    g.append(h('button', {
      type: 'button', class: 'ed-chip' + (on ? ' ed-on' : '') + (o.gone ? ' ed-cl-gone' : ''), 'aria-pressed': String(on),
      title: o.gone ? t('cl.ed.gone') : o.text,
      onclick: (e) => {
        const b = e.currentTarget;
        const was = cur.includes(o.key);
        cur = was ? cur.filter((k) => k !== o.key) : [...cur, o.key];
        b.classList.toggle('ed-on', !was);
        b.setAttribute('aria-pressed', String(!was));
        onChange(cur.slice(), false);
      },
    }, o.text));
  }
  if (!labels.length && mode !== 'sort') g.append(h('p', { class: 'ed-hint ed-cl-none' }, t('cl.ed.noKeys')));
  return g;
}

export const COLLECTION_CONTROLS = { kvlist: kvlistControl, filelist: filelistControl, clkeys: clkeysControl };
