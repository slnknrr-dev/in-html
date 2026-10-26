// book-processor/library.js - the library: shelf of books kept in IndexedDB (grid or list, search, sort,
// continue reading), import by picker / drop / paste, the sample book, details, exports, delete, storage use.
import { h, lsGet, lsSet, debounce } from '../ui/dom.js';
import { button, download, dropZone, t, toast } from '../ui/app.js';
import { iconEl } from '../ui/icons.js';
import { openDialog, confirmDialog, openMenu } from '../ui/overlays.js';
import { contextMenu } from '../ui/contextmenu.js';
import { fmtBytes, pickFiles } from '../ui/files.js';
import { langLabel } from '../ui/lang.js';
import { ACCEPT } from '../book/open.js';
import { bookStats, inlineText } from '../book/model.js';
import { sampleBook } from '../book/sample.js';
import { FB2_GENRES } from '../book/fb2.js';
import { S, fmtWhen, pct, genreLabel } from './state.js';
import { db } from './db.js';
import { newDraftFrom } from './writer.js';
import { EXPORTS, coverSVGFor, exportBook, importFiles, saveToLibrary, svgURL } from './io.js';

const PREFS = 'bk-lib';
const prefs = () => ({ sort: 'opened', view: 'grid', q: '', ...lsGet(PREFS, {}) });
const setPref = (k, v) => lsSet(PREFS, { ...prefs(), [k]: v });
const thumbURLs = new Map(); // shelf id -> object URL of the thumbnail
let detachGrid = null;
const FMT_LABEL = { epub: 'EPUB', fb2: 'FB2', 'fb2.zip': 'FB2', zip: 'ZIP', markdown: 'MD', text: 'TXT', html: 'HTML', json: 'JSON', sample: 'EPUB' };

// Thumbnail object URLs are cached per book and re-created only when the Blob changes (identity check), so
// re-rendering the library does not leak a URL per card per render. Coverless books get the generated SVG cover.
function coverEl(rec, cls = 'bk-cover') {
  if (rec.thumb instanceof Blob) {
    let u = thumbURLs.get(rec.id);
    if (!u || u.blob !== rec.thumb) { if (u) URL.revokeObjectURL(u.url); u = { url: URL.createObjectURL(rec.thumb), blob: rec.thumb }; thumbURLs.set(rec.id, u); }
    return h('img', { class: cls, src: u.url, alt: '', loading: 'lazy', decoding: 'async' });
  }
  const fake = { meta: { title: rec.title, subtitle: '', authors: rec.authors ? [{ nick: rec.authors }] : [], series: [], coverDesign: rec.cover } };
  return h('img', { class: cls, src: svgURL(coverSVGFor(fake, rec.cover)), alt: '', loading: 'lazy' });
}

export async function importAndReport(files) {
  if (!files.length) return [];
  const many = files.length > 1;
  if (many) toast(t('lib.importing', { n: files.length }), 'info');
  const res = await importFiles(files, { onError: (name, e) => toast(t('lib.importFail', { name, msg: e.message }), 'error') });
  const added = res.filter((r) => !r.duplicate);
  const dups = res.filter((r) => r.duplicate);
  if (added.length === 1) toast(t('lib.added1', { title: added[0].title }), 'ok', { label: t('lib.readNow'), fn: () => S.hooks.go('read', added[0].id) });
  else if (added.length) toast(t('lib.addedN', { n: added.length }), 'ok');
  if (dups.length) toast(t('lib.duplicate', { title: dups[0].title }), 'info', { label: t('lib.readNow'), fn: () => S.hooks.go('read', dups[0].id) });
  if (S.view === 'library') await renderLibrary(document.getElementById('bk-main'));
  return res;
}

async function addSample() {
  const id = await saveToLibrary(sampleBook(), { format: 'sample', fileName: 'sample.epub' });
  toast(t('lib.sampleAdded'), 'ok');
  await renderLibrary(document.getElementById('bk-main'));
  return id;
}

const SORTS = {
  opened: (a, b) => String(b.opened || b.added).localeCompare(String(a.opened || a.added)),
  added: (a, b) => String(b.added).localeCompare(String(a.added)),
  title: (a, b) => a.title.localeCompare(b.title),
  author: (a, b) => (a.authors || '￿').localeCompare(b.authors || '￿') || a.title.localeCompare(b.title),
  progress: (a, b) => (b.progress || 0) - (a.progress || 0),
};

export async function renderLibrary(main) {
  main.className = 'ap-main bk-main bk-lib-main';
  const shelf = await db.shelf();
  S.shelf = shelf;
  const p = prefs();
  main.textContent = '';
  const head = h('div', { class: 'bk-lib-head' },
    h('div', { class: 'bk-lib-title' }, h('h2', {}, t('lib.title')), shelf.length ? h('span', { class: 'ed-badge' }, String(shelf.length)) : null),
    h('div', { class: 'bk-lib-actions' },
      button('lib.add', 'plus', async () => { const files = await pickFiles({ accept: ACCEPT, multiple: true }); if (files.length) importAndReport(files); }, 'primary'),
      button('lib.write', 'feather', () => S.hooks.go('write')),
      button('lib.sample', 'sparkle', addSample)));
  main.append(head);
  if (!shelf.length) {
    main.append(h('section', { class: 'bk-empty' },
      h('div', { class: 'bk-empty-art', html: emptyArt() }),
      h('h3', {}, t('lib.emptyTitle')),
      h('p', { class: 'ap-lead' }, t('lib.emptyText')),
      dropZone({ onFiles: importAndReport, accept: ACCEPT, multiple: true, label: 'lib.drop' }),
      h('p', { class: 'bk-formats' }, t('lib.formats'))));
    main.append(storageLine());
    return;
  }
  // Continue reading.
  // "Finished" at 99.5%, not 100%: the last page rarely registers as exactly 1 because positions mark the first
  // visible character, not the last.
  const recent = shelf.filter((r) => r.opened && (r.progress || 0) < 0.995).sort(SORTS.opened)[0];
  if (recent) {
    main.append(h('section', { class: 'bk-continue', 'aria-label': t('lib.continue') },
      h('button', { type: 'button', class: 'bk-continue-btn', onclick: () => S.hooks.go('read', recent.id) },
        coverEl(recent, 'bk-cover bk-cover-sm'),
        h('span', { class: 'bk-continue-text' },
          h('span', { class: 'bk-kicker' }, t('lib.continue')),
          h('strong', {}, recent.title),
          h('span', { class: 'ed-muted' }, [recent.authors, fmtWhen(recent.opened)].filter(Boolean).join(' · ')),
          h('span', { class: 'bk-progress' }, h('i', { style: { width: pct(recent.progress) } })),
          h('span', { class: 'bk-pct' }, pct(recent.progress))),
        iconEl('arrowRight'))));
  }
  // Toolbar: search, sort, view.
  const search = h('input', { type: 'search', class: 'ed-input bk-search', placeholder: t('lib.searchPh'), 'aria-label': t('lib.search'), value: p.q });
  const sort = h('select', { class: 'ed-input ed-select bk-sort', 'aria-label': t('lib.sort') },
    Object.keys(SORTS).map((k) => h('option', { value: k, selected: k === p.sort }, t('lib.sort.' + k))));
  const viewSeg = h('div', { class: 'ed-seg', role: 'radiogroup', 'aria-label': t('lib.view') },
    [['grid', 'grid'], ['list', 'list']].map(([v, ic]) => h('button', { type: 'button', role: 'radio', class: 'ed-seg-btn' + (p.view === v ? ' ed-on' : ''), 'aria-checked': String(p.view === v), title: t('lib.view.' + v), 'aria-label': t('lib.view.' + v), onclick: () => { setPref('view', v); renderLibrary(main); } }, iconEl(ic))));
  main.append(h('div', { class: 'bk-lib-tools' }, search, sort, viewSeg));
  const list = h('div', { class: p.view === 'list' ? 'bk-list' : 'bk-grid', role: 'list' });
  main.append(list);
  detachGrid?.();
  // One delegated context menu on the list instead of one per card: cards are rebuilt on every keystroke of the
  // search, and the previous binding is detached first so menus do not stack across renders.
  detachGrid = contextMenu(list, (el) => { const r = shelf.find((x) => x.id === el.dataset.id); return r ? bookItems(r) : null; }, { selector: '.bk-card' });
  const paint = () => {
    const q = search.value.trim().toLowerCase();
    const items = shelf.filter((r) => !q || [r.title, r.authors, r.series].some((x) => String(x || '').toLowerCase().includes(q))).sort(SORTS[sort.value] || SORTS.opened);
    list.textContent = '';
    for (const r of items) list.append(card(r, p.view));
    if (!items.length) list.append(h('p', { class: 'ap-empty' }, t('lib.noMatch')));
  };
  search.addEventListener('input', debounce(() => { setPref('q', search.value); paint(); }, 150));
  sort.addEventListener('change', () => { setPref('sort', sort.value); paint(); });
  paint();
  main.append(h('div', { class: 'bk-lib-drop' }, dropZone({ onFiles: importAndReport, accept: ACCEPT, multiple: true, label: 'lib.drop' })));
  main.append(storageLine());
}

function card(r, view) {
  const open = () => S.hooks.go('read', r.id);
  const more = h('button', { type: 'button', class: 'ed-iconbtn bk-card-more', title: t('lib.more'), 'aria-label': t('lib.moreFor', { title: r.title }), onclick: (e) => { e.stopPropagation(); bookMenu(r, more); } }, iconEl('dots'));
  const done = (r.progress || 0) >= 0.995;
  const meta = h('div', { class: 'bk-card-meta' },
    h('strong', { class: 'bk-card-title' }, r.title),
    r.authors ? h('span', { class: 'bk-card-author' }, r.authors) : null,
    view === 'list' && r.series ? h('span', { class: 'ed-muted' }, r.series) : null,
    h('span', { class: 'bk-card-foot' },
      h('span', { class: 'bk-progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round((r.progress || 0) * 100), 'aria-label': t('lib.progress') }, h('i', { style: { width: pct(r.progress) } })),
      h('span', { class: 'bk-pct' }, done ? t('lib.finished') : r.opened ? pct(r.progress) : t('lib.new')),
      FMT_LABEL[r.format] ? h('span', { class: 'bk-fmt' }, FMT_LABEL[r.format]) : null));
  return h('div', { class: 'bk-card' + (done ? ' bk-done' : ''), role: 'listitem', dataset: { id: r.id } },
    h('button', { type: 'button', class: 'bk-card-open', onclick: open, 'aria-label': t('lib.readTitle', { title: r.title }) }, coverEl(r)),
    meta, more);
}

function bookMenu(r, anchor) { openMenu(anchor, bookItems(r)); }
function bookItems(r) {
  return [
    { header: true, label: r.title },
    { label: t('lib.read'), icon: 'read', action: () => S.hooks.go('read', r.id) },
    { label: t('lib.edit'), icon: 'feather', action: () => editInWriter(r) },
    { label: t('lib.details'), icon: 'info', action: () => details(r) },
    { sep: true },
    { header: true, label: t('lib.export') },
    ...EXPORTS.map(([f, label]) => ({ label, icon: 'download', action: () => exportFromShelf(r, f) })),
    { label: t('lib.original'), icon: 'file', action: () => downloadOriginal(r) },
    { sep: true },
    { label: (r.progress || 0) >= 0.995 ? t('lib.markUnread') : t('lib.markRead'), icon: 'check', action: () => markRead(r) },
    { label: t('lib.delete'), icon: 'trash', danger: true, action: () => removeBook(r) },
  ];
}

async function exportFromShelf(r, format) {
  const c = await db.getContent(r.id);
  if (!c) return toast(t('lib.missing'), 'error');
  try { await exportBook(c.book, format); } catch (e) { toast(t('err.generic', { msg: e.message }), 'error'); }
}

async function downloadOriginal(r) {
  const c = await db.getContent(r.id);
  if (!c || !c.original) { toast(t('lib.noOriginal'), 'info'); return exportFromShelf(r, 'epub'); }
  download(c.original, c.originalName || r.fileName || 'book', 'application/octet-stream');
}

async function markRead(r) {
  const rec = await db.getShelf(r.id);
  rec.progress = (rec.progress || 0) >= 0.995 ? 0 : 1;
  if (rec.progress === 0) rec.pos = null;
  await db.putShelf(rec);
  renderLibrary(document.getElementById('bk-main'));
}

async function removeBook(r) {
  if (!await confirmDialog(t('lib.deleteTitle'), t('lib.deleteText', { title: r.title }), t('lib.delete'), true)) return;
  await db.deleteBook(r.id);
  const u = thumbURLs.get(r.id);
  if (u) { URL.revokeObjectURL(u.url); thumbURLs.delete(r.id); }
  toast(t('lib.deleted', { title: r.title }), 'ok');
  renderLibrary(document.getElementById('bk-main'));
}

// Opens the book in the writer: the draft made from it earlier, or a new one. sel: a pane to open ({ kind, id }).
// Editing a library book reopens its newest draft instead of forking a new copy each time; the library copy stays
// untouched until the draft is saved back, so a botched edit never damages the original.
export async function editInWriter(r, sel = null) {
  const existing = (await db.drafts()).filter((d) => d.libraryId === r.id).sort((a, b) => String(b.updated).localeCompare(String(a.updated)))[0];
  let id = existing && existing.id;
  if (!id) {
    const c = await db.getContent(r.id);
    if (!c) return toast(t('lib.missing'), 'error');
    id = await newDraftFrom(c.book, { libraryId: r.id });
  } else toast(t('lib.draftContinue'), 'info');
  S.writerSelect = sel;
  S.hooks.go('write', id);
}

async function details(r) {
  const c = await db.getContent(r.id);
  if (!c) return toast(t('lib.missing'), 'error');
  const b = c.book, m = b.meta, st = bookStats(b);
  const genres = new Map(FB2_GENRES);
  const row = (k, v) => (v ? [h('dt', {}, t(k)), h('dd', {}, v)] : null);
  const body = h('div', { class: 'bk-details' },
    coverEl(r, 'bk-cover bk-cover-lg'),
    h('div', {},
      h('h3', { class: 'bk-details-title' }, m.title),
      m.subtitle ? h('p', { class: 'ed-muted' }, m.subtitle) : null,
      h('dl', { class: 'ap-kv' },
        row('meta.authors', r.authors),
        row('meta.translators', m.translators.map((p) => [p.first, p.last].filter(Boolean).join(' ') || p.nick).join(', ')),
        row('meta.series', r.series),
        row('meta.lang', m.lang ? langLabel(m.lang) : ''),
        row('meta.genres', [...m.genres.map((g) => genreLabel(g, genres.get(g))), ...m.subjects].join(', ')),
        row('meta.publisher', [m.publisher, m.city, m.year || m.date].filter(Boolean).join(', ')),
        row('meta.isbn', m.isbn),
        row('lib.stats', t('lib.statsText', { words: st.words.toLocaleString(), min: st.minutes, sections: st.sections, notes: st.notes })),
        row('lib.file', [String(r.format || '').toUpperCase(), r.size ? fmtBytes(r.size) : ''].filter(Boolean).join(' · ')),
        row('lib.addedOn', fmtWhen(r.added)),
        row('lib.openedOn', r.opened ? fmtWhen(r.opened) : ''),
      ),
      m.annotation.length ? h('div', { class: 'bk-annotation' }, m.annotation.map((x) => h('p', {}, inlineText(x.c || [])))) : null));
  const v = await openDialog({
    title: t('lib.details'), body, wide: true,
    buttons: [{ label: t('lib.edit'), value: 'edit', icon: 'feather' }, { label: t('lib.read'), value: 'read', primary: true, icon: 'read' }],
  });
  if (v === 'read') S.hooks.go('read', r.id);
  else if (v === 'edit') editInWriter(r);
}

// Storage transparency: memory mode is a warning (data disappears with the tab); otherwise usage / quota and a
// button for persistent storage, which must be requested from a click (some browsers require a user gesture).
function storageLine() {
  const line = h('div', { class: 'bk-storage' }, iconEl('shield'), h('span', {}, t('lib.private')));
  (async () => {
    const est = await db.estimate();
    if (db.memory) { line.append(h('span', { class: 'bk-warn' }, t('lib.memory'))); return; }
    if (est && est.usage != null) line.append(h('span', { class: 'ed-muted' }, t('lib.usage', { used: fmtBytes(est.usage), quota: fmtBytes(est.quota || 0) })));
    if (!(await db.persisted())) {
      line.append(h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: async (e) => {
        const ok = await db.persist();
        toast(ok ? t('lib.persistOk') : t('lib.persistNo'), ok ? 'ok' : 'info');
        if (ok) e.target.remove();
      } }, t('lib.persist')));
    }
  })();
  return line;
}

function emptyArt() {
  return '<svg viewBox="0 0 220 120" width="220" height="120" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">'
    + '<rect x="20" y="20" width="22" height="86" rx="2"/><rect x="46" y="12" width="26" height="94" rx="2"/><rect x="76" y="28" width="20" height="78" rx="2"/>'
    + '<path d="M102 32l18-5 20 76-18 5z"/><path d="M150 106c8-4 18-4 26 0V40c-8-4-18-4-26 0zM176 106c8-4 18-4 26 0V40c-8-4-18-4-26 0z"/><path d="M10 106h200"/></g></svg>';
}

