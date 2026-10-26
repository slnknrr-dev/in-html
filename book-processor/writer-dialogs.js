// book-processor/writer-dialogs.js - dialogs of the writer: links (a web address or a place in the book),
// footnotes (label, kind and rich text read back with the same parser as the chapters), new tables, named styles
// (paragraph and character styles with a live preview) and a new book (title, author, language, structure).
import { h } from '../ui/dom.js';
import { t, toast, field, seg, select, toggle } from '../ui/app.js';
import { iconEl } from '../ui/icons.js';
import { openDialog, confirmDialog } from '../ui/overlays.js';
import { SUGGESTED_LANGS, langLabel, LANG_RE } from '../ui/lang.js';
import { UI_STATE } from '../ui/i18n.js';
import { blocksFromHTML, renderBlocks, renderContext } from '../book/html.js';
import { stylesCSS } from '../book/css.js';
import { mapInline, normalizeBook, normStyle, sectionTitle, slug, walkBlocks, walkSections, inlineText } from '../book/model.js';

// --- links --------------------------------------------------------------------------------------------

// Resolves to the new href ('' removes the link) or null (cancelled).
// Return protocol shared by the dialogs: null = cancelled (change nothing), '' = remove, a value = apply. Link
// targets are either an internal anchor (#id of a section or note) or a URL normalised to http(s) / mailto; other
// schemes (javascript:, data:) are never produced, because exported EPUB / FB2 files are opened by other readers.
export async function linkDialog(W, cur = '') {
  const book = W.book;
  const url = h('input', { type: 'text', class: 'ed-input', value: cur.startsWith('#') ? '' : cur, placeholder: 'https://…', inputmode: 'url', spellcheck: 'false', autocomplete: 'off' });
  const opts = [{ v: '', l: '=' + t('wr.link.none') }];
  walkSections(book.sections, (s, depth) => { opts.push({ v: '#' + s.id, l: '=' + ' '.repeat(depth) + (sectionTitle(s) || t('wr.untitled')) }); });
  for (const n of book.notes) opts.push({ v: '#' + n.id, l: '=' + t('wr.link.noteN', { label: inlineText(n.label) }) });
  const place = select(opts, cur.startsWith('#') ? cur : '', (v) => { if (v) url.value = ''; });
  url.addEventListener('input', () => { if (url.value.trim()) place.value = ''; });
  const body = h('div', { class: 'ed-fields wr-dlg' },
    field('wr.link.url', url, 'wr.link.urlHint'),
    field('wr.link.place', place));
  const buttons = [{ label: t('dlg.cancel'), value: null }, { label: t('dlg.ok'), value: 'ok', primary: true }];
  if (cur) buttons.unshift({ label: t('wr.link.remove'), value: 'remove', danger: true, icon: 'trash' });
  const v = await openDialog({ title: t(cur ? 'wr.link.edit' : 'wr.link.add'), body, buttons });
  if (v === 'remove') return '';
  if (v !== 'ok') return null;
  if (place.value) return place.value;
  let href = url.value.trim();
  if (!href) return cur ? '' : null;
  // Bare e-mail -> mailto:, bare domain -> https://; new URL() then rejects what is still malformed before it reaches
  // the book.
  if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(href)) href = 'mailto:' + href;
  else if (!/^(https?:|mailto:|#)/i.test(href)) href = 'https://' + href.replace(/^\/+/, '');
  try { if (/^https?:/i.test(href)) new URL(href); } catch { toast(t('wr.link.bad'), 'error'); return null; }
  return href;
}

// --- footnotes ----------------------------------------------------------------------------------------

// Resolves to 'ok' (saved), 'deleted' (the note was removed) or null (cancelled; a fresh note is removed).
export async function noteDialog(W, id, { fresh = false } = {}) {
  const book = W.book;
  const note = book.notes.find((n) => n.id === id);
  if (!note) return null;
  const label = h('input', { type: 'text', class: 'ed-input wr-note-label', value: inlineText(note.label), maxlength: 12, spellcheck: 'false' });
  let kind = note.kind;
  const kindSeg = seg([{ v: 'note', l: 'wr.note.kind.note' }, { v: 'comment', l: 'wr.note.kind.comment' }], kind, (v) => { kind = v; }, 'wr.note.kind');
  const ctx = renderContext({ editable: true, imgSrc: (x) => W.imgs.url(x), lang: book.meta.lang });
  const ed = h('div', { class: 'wr-note-ed bk-text', contenteditable: 'true', spellcheck: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': t('wr.note.text'), lang: book.meta.lang || null, 'data-ph': t('wr.note.ph') });
  ed.innerHTML = renderBlocks(note.blocks, ctx) || '<p><br></p>';
  ed.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
    document.execCommand('insertText', false, text);
  });
  const body = h('div', { class: 'ed-fields wr-dlg' },
    h('div', { class: 'wr-note-row' }, field('wr.note.label', label), field('wr.note.kind', kindSeg)),
    h('div', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('wr.note.text')), ed),
    h('p', { class: 'ed-hint' }, t('wr.note.hint')));
  const v = await openDialog({
    title: t(fresh ? 'wr.note.new' : 'wr.note.edit'), body, wide: true,
    buttons: [{ label: t('wr.note.delete'), value: 'delete', danger: true, icon: 'trash' }, { label: t('dlg.cancel'), value: null }, { label: t('dlg.ok'), value: 'ok', primary: true }],
    onMount: () => { if (!fresh) return; requestAnimationFrame(() => { ed.focus(); const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); }); },
  });
  if (v === 'delete' || (v == null && fresh)) {
    book.notes = book.notes.filter((n) => n !== note);
    W.changed({ notes: true });
    return 'deleted';
  }
  if (v !== 'ok') return null;
  note.label = [label.value.trim() || inlineText(note.label) || '*'];
  note.kind = kind;
  let blocks = blocksFromHTML(ed.innerHTML, { styles: new Set(book.styles.map((s) => s.id)), image: (src, isId) => (isId && book.images[src] ? src : null) });
  blocks = normalizeBook({ sections: [{ id: 'x', blocks }] }).sections[0].blocks;
  while (blocks.length && blocks[blocks.length - 1].type === 'empty') blocks.pop();
  note.blocks = blocks.length ? blocks : [{ type: 'p', c: [] }];
  W.changed({ notes: true });
  return 'ok';
}

// --- tables -------------------------------------------------------------------------------------------

export async function tableDialog() {
  const num = (value, max) => h('input', { type: 'number', class: 'ed-input ed-num', min: 1, max, step: 1, value, inputmode: 'numeric' });
  const rows = num(3, 60), cols = num(3, 12);
  let header = true;
  const body = h('div', { class: 'ed-fields wr-dlg' },
    h('div', { class: 'wr-note-row' }, field('wr.tbl.rows', rows), field('wr.tbl.cols', cols)),
    field('wr.tbl.headerRow', toggle(true, (v) => { header = v; })));
  const v = await openDialog({ title: t('wr.tbl.insert'), body, buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('wr.tbl.insertBtn'), value: 'ok', primary: true }] });
  if (v !== 'ok') return null;
  const n = (el, max) => Math.max(1, Math.min(max, Math.round(+el.value) || 1));
  return { rows: n(rows, 60), cols: n(cols, 12), header };
}

// --- named styles -------------------------------------------------------------------------------------

const PROP_CHOICES = {
  font: ['', 'serif', 'sans', 'mono', 'script'], size: ['', 'xs', 's', 'm', 'l', 'xl'], align: ['', 'left', 'center', 'right', 'justify'],
  indent: ['', 'none', 'first', 'hanging', 'block'], spaceBefore: ['', '0', '0.5', '1', '2'], spaceAfter: ['', '0', '0.5', '1', '2'],
};
const FLAGS = ['bold', 'italic', 'smallCaps', 'underline'];

// Resolves to true when the styles changed (the book's styles are replaced; usages of deleted styles are removed).
export async function stylesDialog(W) {
  const book = W.book;
  let list = structuredClone(book.styles);
  const deleted = new Set();
  let cur = list[0] ? list[0].id : null;
  const listEl = h('div', { class: 'wr-st-list', role: 'listbox', 'aria-label': t('wr.st.list') });
  const form = h('div', { class: 'wr-st-form' });
  const css = h('style');
  const body = h('div', { class: 'wr-st' }, css, h('div', { class: 'wr-st-side' }, listEl,
    h('div', { class: 'wr-st-add' },
      h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => add('block') }, iconEl('plus'), t('wr.st.newBlock')),
      h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => add('inline') }, iconEl('plus'), t('wr.st.newInline')))), form);
  function add(kind) {
    const taken = new Set(list.map((s) => s.id));
    const base = kind === 'block' ? t('wr.st.blockName') : t('wr.st.inlineName');
    let n = 1, name = base;
    while (list.some((s) => s.name === name)) name = base + ' ' + ++n;
    let id = slug(name) || (kind === 'block' ? 'para' : 'char');
    for (let i = 2; taken.has(id) || deleted.has(id); i++) id = (slug(name) || 'style') + '-' + i;
    list.push({ id, name, kind, props: kind === 'block' ? { indent: 'none' } : { italic: true } });
    cur = id;
    paint();
    requestAnimationFrame(() => form.querySelector('input')?.select());
  }
  function paint() {
    css.textContent = stylesCSS(list, { scope: '.wr-st-prev' });
    listEl.textContent = '';
    for (const kind of ['block', 'inline']) {
      const items = list.filter((s) => s.kind === kind);
      listEl.append(h('div', { class: 'wr-st-h' }, t(kind === 'block' ? 'wr.st.blocks' : 'wr.st.inlines')));
      if (!items.length) listEl.append(h('p', { class: 'ed-hint' }, t('wr.st.none')));
      for (const s of items) {
        listEl.append(h('button', { type: 'button', role: 'option', class: 'wr-st-item' + (s.id === cur ? ' ed-on' : ''), 'aria-selected': String(s.id === cur), onclick: () => { cur = s.id; paint(); } },
          h('span', { class: 'wr-st-swatch wr-st-prev' }, h(kind === 'block' ? 'p' : 'span', { class: 's-' + s.id }, 'Aa')), h('span', {}, s.name)));
      }
    }
    paintForm();
  }
  function paintForm() {
    form.textContent = '';
    const s = list.find((x) => x.id === cur);
    if (!s) { form.append(h('p', { class: 'ap-empty' }, t('wr.st.pick'))); return; }
    const upd = () => { const n = normStyle({ ...s, props: s.props }); if (n) Object.assign(s, { name: n.name, props: n.props }); css.textContent = stylesCSS(list, { scope: '.wr-st-prev' }); paintPreview(); for (const b of listEl.querySelectorAll('.wr-st-item.ed-on span:last-child')) b.textContent = s.name; };
    const name = h('input', { type: 'text', class: 'ed-input', value: s.name, maxlength: 60 });
    name.addEventListener('input', () => { s.name = name.value.trim() || s.id; upd(); });
    const label = (prop, v) => (!v ? 'wr.st.inherit' : /^space/.test(prop) ? '=' + v + ' em' : 'wr.st.' + prop + '.' + v);
    const sel = (prop) => select(PROP_CHOICES[prop].map((v) => ({ v, l: label(prop, v) })), s.props[prop] || '', (v) => { if (v) s.props[prop] = v; else delete s.props[prop]; upd(); });
    const flags = h('div', { class: 'ed-chips wr-st-flags' }, FLAGS.map((f) => {
      const b = h('button', { type: 'button', class: 'ed-chip' + (s.props[f] ? ' ed-on' : ''), 'aria-pressed': String(!!s.props[f]), onclick: () => { s.props[f] = !s.props[f]; if (!s.props[f]) delete s.props[f]; b.classList.toggle('ed-on', !!s.props[f]); b.setAttribute('aria-pressed', String(!!s.props[f])); upd(); } }, t('wr.st.' + f));
      return b;
    }));
    const colorOn = h('input', { type: 'checkbox', checked: !!s.props.color, 'aria-label': t('wr.st.useColor') });
    const color = h('input', { type: 'color', class: 'ap-color', value: s.props.color || '#7c4a1e', 'aria-label': t('wr.st.color') });
    const setColor = () => { if (colorOn.checked) s.props.color = color.value; else delete s.props.color; upd(); };
    colorOn.addEventListener('change', setColor);
    color.addEventListener('input', () => { colorOn.checked = true; setColor(); });
    const del = h('button', { type: 'button', class: 'ed-btn ed-sm ed-danger', onclick: async () => {
      if (!await confirmDialog(t('wr.st.deleteTitle'), t('wr.st.deleteText', { name: s.name }), t('dlg.delete'), true)) return;
      list = list.filter((x) => x !== s);
      deleted.add(s.id);
      cur = list[0] ? list[0].id : null;
      paint();
    } }, iconEl('trash'), t('dlg.delete'));
    const prev = h('div', { class: 'wr-st-prev bk-text wr-st-sample', lang: book.meta.lang || null });
    const paintPreview = () => {
      prev.textContent = '';
      const sample = t('wr.st.sample');
      if (s.kind === 'block') prev.append(h('p', {}, sample), h('p', { class: 's-' + s.id }, sample), h('p', {}, sample));
      else prev.append(h('p', {}, sample.slice(0, 40) + ' ', h('span', { class: 's-' + s.id }, sample.slice(40, 90)), ' ' + sample.slice(90)));
    };
    paintPreview();
    form.append(h('div', { class: 'ed-fields' },
      field('wr.st.name', name),
      h('p', { class: 'ed-hint' }, t(s.kind === 'block' ? 'wr.st.kindBlock' : 'wr.st.kindInline')),
      h('div', { class: 'wr-note-row' }, field('wr.st.font', sel('font')), field('wr.st.size', sel('size'))),
      s.kind === 'block' ? h('div', { class: 'wr-note-row' }, field('wr.st.align', sel('align')), field('wr.st.indent', sel('indent'))) : null,
      s.kind === 'block' ? h('div', { class: 'wr-note-row' }, field('wr.st.spaceBefore', sel('spaceBefore')), field('wr.st.spaceAfter', sel('spaceAfter'))) : null,
      field('wr.st.look', flags),
      h('div', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('wr.st.color')), h('span', { class: 'ap-row' }, colorOn, color)),
      prev,
      h('div', { class: 'ap-row' }, h('span', { class: 'ed-spacer' }), del)));
  }
  paint();
  const v = await openDialog({ title: t('wr.st.title'), body, wide: true, className: 'wr-st-dlg', buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('dlg.apply'), value: 'ok', primary: true }] });
  if (v !== 'ok') return false;
  book.styles = list.map(normStyle).filter(Boolean);
  if (deleted.size) stripStyles(book, deleted);
  W.changed({ styles: true });
  return true;
}

// Applies fix(inline) -> inline to every inline array of the book: titles, paragraphs, captions, verses, cells,
// authors, the front matter and the notes.
// Visits every inline run of the book in place (titles, paragraphs, verses, table cells, nested blocks, notes).
// One traversal shared by style deletion and similar fixes, so a new block kind is handled in one place.
export function eachInline(book, fix) {
  const fixBlock = (b) => {
    if (b.c) b.c = fix(b.c);
    if (b.title && b.type === 'image') b.title = fix(b.title);
    else if (b.title) b.title = b.title.map(fix);
    if (b.authors) b.authors = b.authors.map(fix);
    if (b.stanzas) for (const s of b.stanzas) { if (s.title) s.title = s.title.map(fix); if (s.subtitle) s.subtitle = fix(s.subtitle); s.lines = s.lines.map(fix); }
    if (b.rows) for (const r of b.rows) for (const c of r.cells) c.c = fix(c.c);
    for (const x of b.blocks || []) fixBlock(x);
    for (const x of b.epigraphs || []) fixBlock(x);
    for (const it of b.items || []) it.forEach(fixBlock);
  };
  if (book.title) book.title = book.title.map(fix);
  book.front.forEach(fixBlock);
  walkSections(book.sections, (s) => { if (s.title) s.title = s.title.map(fix); s.blocks.forEach(fixBlock); });
  for (const n of book.notes) n.blocks.forEach(fixBlock);
}

// Removes paragraph style classes and character style spans of deleted styles from the whole book.
// Deleting a named style unwraps its spans (keeps the text) instead of leaving dangling references the exporters
// would have to guess about.
export function stripStyles(book, ids) {
  walkBlocks(book, (b) => { if (b.style && ids.has(b.style)) delete b.style; });
  eachInline(book, (inl) => mapInline(inl, (x) => (x && x.t === 'style' && ids.has(x.name) ? x.c : undefined)));
}

// --- new book -----------------------------------------------------------------------------------------

export const TEMPLATES = ['blank', 'novel', 'stories', 'poetry'];

// Resolves to { title, author, lang, template } or null.
export async function newBookDialog() {
  const title = h('input', { type: 'text', class: 'ed-input', value: '', placeholder: t('wr.new.titlePh'), maxlength: 300 });
  const author = h('input', { type: 'text', class: 'ed-input', value: '', placeholder: t('wr.new.authorPh'), maxlength: 200, autocomplete: 'name' });
  const ui = UI_STATE.lang;
  const langs = [...new Set([ui, ...SUGGESTED_LANGS])];
  const lang = h('input', { type: 'text', class: 'ed-input', value: ui, list: 'wr-langs', maxlength: 35, spellcheck: 'false', autocomplete: 'off' });
  const dl = h('datalist', { id: 'wr-langs' }, langs.map((l) => h('option', { value: l }, langLabel(l))));
  let template = 'novel';
  const tpl = h('div', { class: 'wr-tpls', role: 'radiogroup', 'aria-label': t('wr.new.structure') }, TEMPLATES.map((k) => h('button', {
    type: 'button', role: 'radio', class: 'wr-tpl' + (k === template ? ' ed-on' : ''), 'aria-checked': String(k === template), dataset: { k },
    onclick: (e) => { template = k; for (const b of tpl.children) { const on = b.dataset.k === k; b.classList.toggle('ed-on', on); b.setAttribute('aria-checked', String(on)); } e.currentTarget.focus(); },
  }, h('strong', {}, t('wr.tpl.' + k)), h('small', {}, t('wr.tpl.' + k + '.d')))));
  const body = h('div', { class: 'ed-fields wr-dlg' }, dl,
    field('wr.new.title', title), field('wr.new.author', author, 'wr.new.authorHint'), field('wr.new.lang', lang),
    h('div', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('wr.new.structure')), tpl));
  const v = await openDialog({ title: t('wr.new.dlg'), body, wide: true, buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('wr.new.create'), value: 'ok', primary: true, icon: 'feather' }] });
  if (v !== 'ok') return null;
  const lv = lang.value.trim();
  return { title: title.value.trim(), author: author.value.trim(), lang: LANG_RE.test(lv) ? lv : ui, template };
}
