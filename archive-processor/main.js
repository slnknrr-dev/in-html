// archive-processor/main.js - entry of the archive processor. On the page it builds the UI (start screen, archive view
// with summary, file tree, extraction and test; the two-panel commander of commander.js) and drives the engine through
// runner.js; when this same bundled script runs as the engine's worker (no document), it only starts the worker side.
// 
// Key decisions:
// - One bundle, two roles (see the last lines): the single-file build cannot ship a separate worker script.
// - All archive work is a job (job()), retried transparently when a password is needed: the engine throws
//   'password' / 'badPassword', the page asks, the same job runs again with S.password.
// - Views are rebuilt wholesale (renderStart / renderArchive / renderCommander) on navigation and language change;
//   long-lived state lives in S and in the tree, never in the DOM.
// - Settings (sort, output, zip method, view) persist in localStorage; passwords never do.

import './strings.js';
import './strings-fm.js';
import { button, copyText, download, dropZone, seg, select, startApp, t, toast } from '../ui/app.js';
import { contextMenu } from '../ui/contextmenu.js';
import { h, lsGet, lsSet } from '../ui/dom.js';
import { pickFiles } from '../ui/files.js';
import { addIcons, iconEl } from '../ui/icons.js';
import { ED_I18N } from '../ui/i18n.js';
import { openDialog } from '../ui/overlays.js';
import { groupVolumes } from '../archive/detect.js';
import { createCommander } from './commander.js';
import { workerMain } from './engine.js';
import { createList } from './list.js';
import { createRunner } from './runner.js';
import { buildTree, checkState, entriesUnder, matcher, searchRows, selection, setChecked, sortTree, treeRows } from './tree.js';
import { decodePreview, fmtAttrib, fmtCount, fmtCrc, fmtDate, fmtMode, fmtRatio, fmtSize, hexDump, imageMime, kindOf, looksText } from './fmt.js';

const LOGO = 'M3 7h18M5 7v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7M4 3h16v4H4zM10 11h4';
// Legacy name encodings for ZIP/RAR without the UTF-8 flag: DOS code pages for old archives, Windows code pages for newer ones. '=' prefix = literal label, not an i18n key.
const CHARSETS = [['auto', 'ax.cs.auto'], ['utf-8', '=UTF-8'], ['ibm866', '=CP866 (DOS, Cyrillic)'], ['windows-1251', '=Windows-1251 (Cyrillic)'],
  ['cp437', '=CP437 (DOS, Latin)'], ['windows-1252', '=Windows-1252 (Latin)'], ['koi8-r', '=KOI8-R'], ['iso-8859-2', '=ISO 8859-2'],
  ['shift_jis', '=Shift_JIS'], ['gbk', '=GBK'], ['big5', '=Big5'], ['euc-kr', '=EUC-KR']];
const FORMATS = ['ZIP', '7z', 'RAR', 'tar', 'tar.gz', 'gz', 'tar.bz2', 'bz2', 'tar.xz', 'xz', 'tar.zst', 'zst', 'lzma', 'Z', 'ISO', 'ARC'];
// File System Access API (Chromium only): extraction straight into a folder; other browsers fall back to downloads.
const canPickDir = typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

const S = {
  groups: [], cur: -1, arc: null, tree: null, rows: [], query: '', flat: false, sort: lsGet('archproc-sort', { key: 'name', dir: 1 }),
  out: lsGet('archproc-out', 'download'), zip: lsGet('archproc-zip', 'deflate'), charset: 'auto', password: null, busy: null, lastTest: null,
  view: lsGet('archproc-view', 'classic'),
};
let fm = null;
const E = {};
let runner, list;
const main = () => document.querySelector('main');

// --- errors and passwords ----------------------------------------------------------------------------------

// Engine error codes -> localized messages; raw engine messages only appear inside the parameterised texts.
function errText(e) {
  const code = e && e.code, msg = String((e && e.message) || e || '');
  switch (code) {
    case 'format': return /unknown format/.test(msg) ? t('ax.err.format') : t('ax.err.damaged', { msg });
    case 'unsupported': return t('ax.err.unsupported', { what: msg.replace(/^not supported: /, '') });
    case 'password': return t('ax.err.password');
    case 'badPassword': return t('ax.err.badPassword');
    case 'volume': return t('ax.err.volume');
    case 'truncated': return t('ax.err.truncated');
    case 'corrupt': return t('ax.err.damaged', { msg: msg.replace(/^corrupt data: /, '') });
    case 'checksum': return t('ax.err.checksum');
    case 'limit': return t('ax.err.limit', { msg });
    case 'aborted': return t('ax.err.aborted');
    case 'crash': return t('ax.err.crash', { msg });
    default: return t('ax.err.other', { msg });
  }
}

// Password input: autocomplete off and spellcheck false, so the browser neither stores nor sends it to a spellcheck service.
function askPassword(wrong) {
  const inp = h('input', { type: 'password', class: 'ed-input ax-pw', autocomplete: 'off', spellcheck: 'false', 'aria-label': t('ax.password') });
  const show = h('button', { type: 'button', class: 'ed-iconbtn', title: t('ax.showPassword'), 'aria-label': t('ax.showPassword'), 'aria-pressed': 'false' }, iconEl('eye'));
  show.addEventListener('click', () => { const on = inp.type === 'password'; inp.type = on ? 'text' : 'password'; show.setAttribute('aria-pressed', String(on)); show.replaceChildren(iconEl(on ? 'eyeOff' : 'eye')); inp.focus(); });
  const body = h('div', { class: 'ax-pw-body' },
    h('p', { class: 'ed-dlg-text' }, t('ax.passwordText')),
    wrong ? h('p', { class: 'ax-error', role: 'alert' }, t('ax.err.badPassword')) : null,
    h('label', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('ax.password')), h('span', { class: 'ax-pw-row' }, inp, show)));
  return openDialog({
    title: t('ax.passwordTitle'), body,
    buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('ax.unlock'), value: 'ok', primary: true }],
  }).then((v) => (v === 'ok' ? inp.value : null));
}

/** Runs an engine job; asks for a password (again) when the job needs one. */
// Retry loop: after the first prompt, a second password error is reported as "wrong password" even if the engine says only "password needed".
async function job(spec, { progress, label } = {}) {
  for (let wrong = false; ;) {
    try {
      return await busy(label, (onP) => runner.run({ ...spec, password: S.password }, onP), progress);
    } catch (e) {
      if (e.code !== 'password' && e.code !== 'badPassword') throw e;
      const pw = await askPassword(e.code === 'badPassword' || wrong);
      if (pw == null) throw Object.assign(new Error('cancelled'), { code: 'aborted' });
      S.password = pw;
      wrong = true;
    }
  }
}

// --- progress ------------------------------------------------------------------------------------------------

// Progress UI wraps every job: one box, one cancel button. Opening uses a hard kill (listing may sit in one long
// synchronous decode); other jobs cancel softly between chunks.
async function busy(label, fn, kind = 'bytes') {
  const bar = h('i');
  const text = h('div', { class: 'ax-prog-text', 'aria-live': 'polite' }, label);
  const detail = h('div', { class: 'ax-prog-detail' });
  const stop = button('ax.cancel', 'stop', () => { if (kind === 'open') runner.kill(); else runner.cancel(); }, '');
  const box = h('div', { class: 'ax-prog', role: 'status' }, h('div', { class: 'ax-prog-row' }, h('span', { class: 'ed-spinner ax-spin' }), text, h('span', { class: 'ed-spacer' }), stop),
    h('div', { class: 'ap-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, bar), detail);
  const slot = E.progress || main();
  if (E.progress) E.progress.replaceChildren(box); else slot.prepend(box);
  S.busy = box;
  syncBusy();
  const set = (p) => {
    if (p == null) return;
    let f = null;
    if (p.p != null) f = p.p;
    else if (p.total) f = Math.min(1, p.done / p.total);
    if (f != null) { bar.style.width = (f * 100).toFixed(1) + '%'; bar.parentElement.setAttribute('aria-valuenow', String(Math.round(f * 100))); }
    if (p.file != null) {
      text.textContent = label + (p.count > 1 ? ' ' + t('ax.nOfM', { n: fmtCount(Math.min(p.n + 1, p.count)), m: fmtCount(p.count) }) : '');
      detail.textContent = (p.total ? fmtSize(p.done) + ' / ' + fmtSize(p.total) + ' · ' : '') + p.file;
    }
  };
  try { return await fn(set); } finally { box.remove(); S.busy = null; syncBusy(); }
}

// Buttons that must not start a second job carry data-busy-off; one place toggles them all.
function syncBusy() {
  const on = !!S.busy;
  for (const b of document.querySelectorAll('[data-busy-off]')) b.disabled = on;
  document.documentElement.toggleAttribute('data-busy', on);
}

// --- start screen ------------------------------------------------------------------------------------------------

function renderStart(message) {
  S.arc = null; S.tree = null;
  const m = main();
  m.className = 'ap-main ax-main';
  E.progress = null;
  const zone = dropZone({ multiple: true, label: 'ax.drop', onFiles: openFiles });
  zone.classList.add('ax-drop');
  m.replaceChildren(h('section', { class: 'ax-start' },
    h('div', { class: 'ax-hero-icon' }, iconEl('archive')),
    h('h2', { class: 'ax-hero-h' }, t('ax.startTitle')),
    h('p', { class: 'ax-lead' }, t('ax.startLead')),
    message ? h('div', { class: 'ax-alert', role: 'alert' }, iconEl('warn'), h('span', null, message)) : null,
    zone,
    h('div', { class: 'ax-start-actions' }, button('ax.commander', 'columns', () => renderCommander())),
    h('div', { class: 'ax-formats', 'aria-label': t('ax.formats') }, FORMATS.map((f) => h('span', { class: 'ax-fmt' }, f))),
    h('ul', { class: 'ax-notes' },
      h('li', null, iconEl('shield'), t('ax.noteLocal')),
      h('li', null, iconEl('layers'), t('ax.noteVolumes')),
      h('li', null, iconEl('lock'), t('ax.noteRar')))));
  document.title = t('app.name');
}

// --- opening -----------------------------------------------------------------------------------------------------

// groupVolumes() bundles multi-volume sets (.7z.001, .part1.rar, .z01) so a drop of all parts opens one archive.
function openFiles(files) {
  if (!files.length || S.busy) return;
  if (S.view === 'fm' && fm) { fm.addFiles(files); return; }
  const groups = groupVolumes(files.map((f) => f.name)).map((g) => g.map((i) => files[i]));
  S.groups = groups;
  S.password = null;
  S.charset = 'auto';
  openGroup(0);
}

async function openGroup(i, keepPassword = false) {
  S.cur = i;
  if (!keepPassword) S.password = null;
  const files = S.groups[i];
  if (S.arc) E.progress.replaceChildren(); else renderStart();
  let res;
  try {
    res = await job({ op: 'open', files, charset: S.charset }, { label: t('ax.opening', { name: files[0].name }), progress: 'open' });
  } catch (e) {
    // A hard cancel restarts the worker: the archive shown before is gone there too.
    // A soft cancel while an archive is already shown keeps it; a hard kill in worker mode lost it in the worker, so the view must reset.
    if (e.code === 'aborted' && S.arc && runner.mode !== 'worker') return;
    S.arc = null;
    renderStart(e.code === 'aborted' ? null : t('ax.openFailed', { name: files[0].name }) + ' ' + errText(e));
    return;
  }
  S.arc = res;
  S.arc.name = files[0].name;
  S.arc.parts = files.length;
  S.tree = buildTree(res.entries);
  S.query = '';
  S.lastTest = null;
  sortTree(S.tree.root, S.sort.key, S.sort.dir);
  renderArchive();
}

// --- archive view ------------------------------------------------------------------------------------------------

function renderArchive() {
  const m = main();
  m.className = 'ap-main ap-wide ax-main';
  const a = S.arc;
  document.title = a.name + ' · ' + t('app.name');
  E.progress = h('div', { class: 'ax-prog-slot' });
  // Several archives dropped at once: a select switches between them (each open replaces the engine state).
  const switcher = S.groups.length > 1 ? select(S.groups.map((g, i) => ({ v: i, l: '=' + g[0].name + (g.length > 1 ? ` (+${g.length - 1})` : '') })), S.cur, (v) => openGroup(+v)) : null;
  if (switcher) { switcher.classList.add('ax-switch'); switcher.setAttribute('aria-label', t('ax.switchArchive')); switcher.dataset.busyOff = ''; }
  const barBtn = (label, ic, fn) => h('button', { type: 'button', class: 'ed-btn', title: t(label), 'aria-label': t(label), onclick: fn }, iconEl(ic), h('span', { class: 'ax-btn-l' }, t(label)));
  const openBtn = barBtn('ax.openOther', 'upload', async () => openFiles(await pickFiles({ multiple: true })));
  const closeBtn = barBtn('ax.close', 'close', () => { if (!S.busy) { runner.run({ op: 'close' }).catch(() => {}); S.groups = []; renderStart(); } });
  const fmBtn = barBtn('ax.commander', 'columns', () => renderCommander());
  openBtn.dataset.busyOff = ''; closeBtn.dataset.busyOff = '';
  const bar = h('div', { class: 'ax-bar' },
    h('span', { class: 'ax-bar-icon' }, iconEl('archive')),
    h('div', { class: 'ax-title' }, h('h2', { class: 'ax-arcname', title: a.name }, a.name), h('span', { class: 'ed-badge' }, a.label)),
    switcher, h('span', { class: 'ed-spacer' }), fmBtn, openBtn, closeBtn);
  // File list and its tools.
  E.search = h('input', { type: 'search', class: 'ed-input ax-search', placeholder: t('ax.search'), 'aria-label': t('ax.search'), value: S.query });
  E.search.addEventListener('input', () => { S.query = E.search.value; refreshRows(true); });
  E.view = seg([{ v: 'tree', l: 'ax.tree', icon: 'layers' }, { v: 'flat', l: 'ax.flat', icon: 'list' }], S.flat ? 'flat' : 'tree', (v) => { S.flat = v === 'flat'; refreshRows(true); }, 'ax.view');
  E.selInfo = h('span', { class: 'ax-selinfo', 'aria-live': 'polite' });
  E.extractLabel = h('span');
  E.extractBtn = button('', 'download', () => extract(), 'primary');
  E.extractBtn.append(E.extractLabel);
  E.extractBtn.dataset.busyOff = '';
  E.testBtn = button('ax.test', 'check', () => testArchive());
  E.testBtn.dataset.busyOff = '';
  list = createList({
    onOpen: openNode,
    onToggle: toggle,
    onCheck: (n, on) => { setChecked(n, on); list.refresh(); selChanged(); },
    // With a search (or the flat view) the header box selects what is listed; in the tree, everything.
    onSelectAll: (on) => { if (S.query || S.flat) for (const n of S.rows) setChecked(n, on); else setChecked(S.tree.root, on); list.refresh(); selChanged(); },
    // New sort column: names/methods ascending, sizes/dates descending first (largest/newest is the common question).
    onSort: (key) => { S.sort = { key, dir: S.sort.key === key ? -S.sort.dir : key === 'name' || key === 'method' ? 1 : -1 }; lsSet('archproc-sort', S.sort); sortTree(S.tree.root, S.sort.key, S.sort.dir); refreshRows(); },
  });
  // 44px rows on touch: the minimum comfortable target size.
  if (matchMedia('(pointer: coarse)').matches) list.setRowHeight(44);
  // Right click, a long press (touch / pen) or the Menu key on a row: the actions of that file or folder.
  if (E.ctxOff) E.ctxOff();
  // Previous context-menu binding is removed first: renderArchive runs again on every language switch.
  E.ctxOff = contextMenu(list.body, (row, info) => {
    const n = list.nodeOf(row);
    if (!n) return null;
    if (info.via !== 'keyboard') list.activate(n);
    return rowMenu(n, info.via === 'touch' || info.via === 'pen', info.via === 'keyboard');
  }, { selector: '.ax-row', label: (row) => (list.nodeOf(row) || {}).name || null });
  E.status = h('div', { class: 'ax-status' });
  const stage = h('section', { class: 'ap-stage ax-stage', 'aria-label': t('ax.files') },
    h('div', { class: 'ax-tools' },
      h('div', { class: 'ax-search-wrap' }, iconEl('search'), E.search), E.view, h('span', { class: 'ed-spacer' }), E.selInfo, E.testBtn, E.extractBtn),
    list.el, E.status);
  const side = h('aside', { class: 'ap-side ax-side', 'aria-label': t('ax.details') }, summaryCard(), outputCard(), optionsCard(),
    a.info.comment ? commentCard(a.info.comment) : null);
  m.replaceChildren(bar, E.progress, h('div', { class: 'ap-work ap-work-r ax-work' }, stage, side));
  refreshRows(true);
  selChanged();
  syncBusy();
  if (a.info.warnings && a.info.warnings.length) toast(a.info.warnings.join(' · '), 'warn');
}

function toggle(n) { n.open = !n.open; refreshRows(); }
// A folder opens and closes in the tree; from a search or the flat list it is shown in the tree. A file: its preview.
function openNode(n) {
  if (!n.dir) { showEntry(n); return; }
  if (S.flat || S.query) { S.query = ''; E.search.value = ''; S.flat = false; E.view.set('tree'); openTo(n); } else toggle(n);
}

/**
 * The context menu of a row (touch: selecting comes first - a long press is how a phone selects). Opened by the
 * keyboard, actions that stay in the list give the focus back to its active row (rows are re-rendered, so the menu
 * cannot return it to the element it came from).
 */
function rowMenu(n, touch, kb = false) {
  const e = n.entry, busyNow = !!S.busy;
  const back = (fn) => () => { fn(); if (kb) requestAnimationFrame(() => list.focus()); };
  const st = checkState(n), sel = S.sel || { ids: [], files: 0 };
  const inTree = !S.flat && !S.query;
  const selectItem = { label: t(st === 'all' ? 'ax.ctx.deselect' : 'ax.ctx.select'), icon: st === 'all' ? 'minus' : 'check',
    action: back(() => { setChecked(n, st !== 'all'); list.refresh(); selChanged(); }) };
  const items = [];
  if (touch) items.push(selectItem, { sep: true });
  if (n.dir) {
    items.push({ label: t(n.open && inTree ? 'ax.collapse' : 'ax.expand'), icon: n.open && inTree ? 'chevDown' : 'chevRight', action: back(() => openNode(n)) });
    items.push({ label: t('ax.ctx.extractFolder'), icon: 'download', disabled: busyNow, action: () => extract(entriesUnder(n), { name: n.name }) });
    items.push({ label: t('ax.ctx.testFolder'), icon: 'shield', disabled: busyNow || !n.files, action: () => testArchive(entriesUnder(n)) });
  } else {
    items.push({ label: t('ax.ctx.open'), icon: 'eye', action: () => showEntry(n) });
    if (kindOf(n.name) === 'archive' && e.size && !e.unsupported) items.push({ label: t('ax.openInside'), icon: 'archive', disabled: busyNow, action: () => openNested(n) });
    items.push({ label: t('ax.ctx.extractFile'), icon: 'download', disabled: busyNow || !!e.unsupported, action: () => extract([e.id]) });
    items.push({ label: t('ax.ctx.testFile'), icon: 'shield', disabled: busyNow || !!e.unsupported, action: () => testArchive([e.id]) });
  }
  // The row belongs to a larger selection: its actions too.
  if (st !== 'none' && sel.files > (n.dir ? n.files : 1)) {
    items.push({ label: t('ax.extractSel', { n: sel.files }), icon: 'download', disabled: busyNow, action: () => extract() });
  }
  if (!touch) items.push({ sep: true }, selectItem);
  items.push({ sep: true },
    { label: t('ax.ctx.copyName'), icon: 'copy', action: back(() => copyText(n.name)) },
    { label: t('ax.ctx.copyPath'), icon: 'copy', action: back(() => copyText(n.path)) },
    { sep: true },
    { label: t('ax.ctx.properties'), icon: 'info', action: () => showProperties(n) });
  return items;
}
function openTo(n) { for (let p = n; p && p.depth >= 0; p = p.parent) p.open = true; refreshRows(); }

function refreshRows(top = false) {
  const match = matcher(S.query);
  S.rows = match ? searchRows(S.tree.root, match) : S.flat ? searchRows(S.tree.root, (n) => !n.dir) : treeRows(S.tree.root);
  list.setRows(S.rows, { flat: !!match || S.flat, sort: S.sort, top });
  const st = S.arc.stats;
  E.status.textContent = (match ? t('ax.found', { n: S.rows.length }) + ' · ' : '') + t('ax.nFiles', { n: st.files }) + ' · ' + t('ax.nFolders', { n: S.tree.dirs });
}

function selChanged() {
  const sel = selection(S.tree.root);
  S.sel = sel;
  E.selInfo.textContent = sel.files ? t('ax.selected', { n: sel.files, size: fmtSize(sel.size) }) : '';
  E.extractLabel.textContent = sel.ids.length ? t('ax.extractSel', { n: sel.files || sel.ids.length }) : t('ax.extractAll');
}

function kv(rows) {
  return h('dl', { class: 'ap-kv ax-kv' }, rows.filter((r) => r && r[1] !== '' && r[1] != null).flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]));
}

function summaryCard() {
  const a = S.arc, st = a.stats, info = a.info;
  const yes = t('ax.yes');
  const enc = info.headersEncrypted ? t('ax.encHeaders') : st.encrypted ? t('ax.encSome', { n: st.encrypted }) : t('ax.no');
  const rows = [
    [t('ax.format'), a.label],
    [t('ax.files'), fmtCount(st.files)],
    [t('ax.folders'), fmtCount(S.tree.dirs)],
    [t('ax.size'), fmtSize(st.size) + (st.unknownSizes ? ' +' : '')],
    [t('ax.packed'), st.packed ? fmtSize(st.packed) : ''],
    [t('ax.ratio'), st.packed && st.size && !st.unknownSizes ? fmtRatio(st.packed, st.size) : ''],
    [t('ax.methods'), (info.methods || []).join(', ')],
    [t('ax.encryption'), enc],
    [t('ax.solid'), info.solid ? yes : info.solid === false ? t('ax.no') : ''],
    [t('ax.volumes'), info.volumes ? fmtCount(info.volumes) : a.parts > 1 ? fmtCount(a.parts) : ''],
    [t('ax.sfx'), info.sfx ? t('ax.sfxAt', { n: fmtCount(info.sfx) }) : ''],
    ...(info.props || []).filter(([k]) => !/^(Entries|Packed|Solid|Volumes|SFX|Encrypted headers)$/.test(k)).map(([k, v]) => [propLabel(k), v]),
  ];
  return h('section', { class: 'ap-card' }, h('h2', { class: 'ap-card-h' }, t('ax.summary')), kv(rows));
}
// Property labels the format modules report in English; translated when the dictionaries know them.
// Only labels known in the English dictionary are translated; unknown property names pass through instead of showing a raw key.
const propLabel = (k) => { const key = 'ax.prop.' + k.replace(/\s+/g, ''); return ED_I18N.en[key] != null ? t(key) : k; };

// A stored "folder" choice is downgraded when the browser cannot pick folders (setting synced from another browser).
function outputCard() {
  const opts = [{ v: 'download', l: 'ax.out.download', icon: 'download' }];
  if (canPickDir) opts.push({ v: 'folder', l: 'ax.out.folder', icon: 'folder' });
  if (!canPickDir && S.out === 'folder') S.out = 'download';
  const zipRow = h('div', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('ax.zipMethod')),
    seg([{ v: 'store', l: 'ax.zip.store' }, { v: 'deflate', l: 'ax.zip.deflate' }], S.zip, (v) => { S.zip = v; lsSet('archproc-zip', v); }, 'ax.zipMethod'));
  const hint = h('div', { class: 'ed-hint' });
  const sync = () => {
    zipRow.hidden = S.out !== 'download';
    hint.textContent = S.out === 'folder' ? t('ax.out.folderHint') : t('ax.out.downloadHint');
  };
  const out = seg(opts, S.out, (v) => { S.out = v; lsSet('archproc-out', v); sync(); }, 'ax.saveTo');
  sync();
  return h('section', { class: 'ap-card' }, h('h2', { class: 'ap-card-h' }, t('ax.output')),
    h('div', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('ax.saveTo')), out), zipRow, hint,
    canPickDir ? null : h('div', { class: 'ed-hint' }, t('ax.out.noFolder')));
}

function optionsCard() {
  const cs = select(CHARSETS.map(([v, l]) => ({ v, l })), S.charset, (v) => { S.charset = v; openGroup(S.cur, true); });
  cs.dataset.busyOff = '';
  const pwState = h('span', { class: 'ax-pw-state' }, S.password != null ? t('ax.pwSet') : S.arc.stats.encrypted || S.arc.info.headersEncrypted ? t('ax.pwNeeded') : t('ax.pwNone'));
  const pwBtn = button('ax.setPassword', 'key', async () => {
    const pw = await askPassword(false);
    if (pw == null) return;
    S.password = pw;
    pwState.textContent = t('ax.pwSet');
    toast(t('ax.pwSaved'), 'ok');
  });
  return h('section', { class: 'ap-card' }, h('h2', { class: 'ap-card-h' }, t('ax.options')),
    h('div', { class: 'ed-field' }, h('label', { class: 'ed-label' }, t('ax.charset')), cs, h('div', { class: 'ed-hint' }, t('ax.charsetHint'))),
    h('div', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('ax.password')), h('div', { class: 'ap-row' }, pwState, h('span', { class: 'ed-spacer' }), pwBtn)),
    S.lastTest ? h('div', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('ax.lastTest')), h('div', null, S.lastTest)) : null);
}

function commentCard(text) {
  return h('section', { class: 'ap-card' }, h('h2', { class: 'ap-card-h' }, t('ax.comment')), h('pre', { class: 'ap-pre ax-comment', dir: 'auto' }, text));
}

// --- extraction ----------------------------------------------------------------------------------------------

const baseName = (p) => p.slice(p.lastIndexOf('/') + 1);
// Archive name without volume and (double) extension: "data.part1.tar.gz" -> "data", the default name of derived files.
const stem = (name) => name.replace(/(\.part\d+)?(\.(tar\.)?[a-z0-9]{1,5})+$/i, '') || 'archive';

// Output mode: folder when chosen and supported; a single file is saved as itself; several files become one ZIP built in
// the engine (browsers prompt or block on many simultaneous downloads).
async function extract(ids, { name } = {}) {
  if (S.busy) return;
  const sel = ids ? { ids } : S.sel && S.sel.ids.length ? S.sel : { ids: null };
  const fileCount = sel.ids ? sel.ids.filter((id) => !S.arc.entries[id].dir).length : S.arc.stats.files;
  if (!fileCount && !(sel.ids && sel.ids.length)) { toast(t('ax.nothing'), 'warn'); return; }
  let mode = S.out === 'folder' && canPickDir ? 'dir' : fileCount === 1 ? 'files' : 'zip';
  let dir = null;
  if (mode === 'dir') {
    try { dir = await window.showDirectoryPicker({ mode: 'readwrite', id: 'archproc' }); } catch (e) { if (e && e.name === 'AbortError') return; toast(errText(e), 'error'); return; }
  }
  try {
    const res = await job({ op: 'extract', ids: sel.ids, mode, zipMethod: S.zip, dir }, { label: t('ax.extracting') });
    if (res.mode === 'files') for (const f of res.files) download(f.blob, baseName(f.path));
    if (res.mode === 'zip') download(res.blob, (name || stem(S.arc.name) + (sel.ids && sel.files < S.arc.stats.files ? '-' + t('ax.selectionSuffix') : '')) + '.zip');
    const n = res.mode === 'files' ? res.files.length : res.count;
    if (res.errors.length) reportErrors(t('ax.extractErrors', { n: res.errors.length }), res.errors, n);
    else toast(res.mode === 'dir' ? t('ax.extractedDir', { n }) : t('ax.extracted', { n }), 'ok');
    if (res.skipped && res.skipped.length) toast(t('ax.skipped', { n: res.skipped.length }), 'info');
  } catch (e) { if (e.code !== 'aborted') toast(errText(e), 'error'); else toast(t('ax.err.aborted'), 'info'); }
}

function reportErrors(title, errors, ok) {
  const body = h('div', { class: 'ax-report' },
    h('p', { class: 'ed-dlg-text' }, t('ax.okCount', { n: ok })),
    h('ul', { class: 'ax-errlist' }, errors.slice(0, 500).map((x) => h('li', null, h('b', null, x.path), h('span', null, errText(x))))));
  openDialog({ title, body, wide: true });
}

async function testArchive(ids) {
  if (S.busy) return;
  const sel = Array.isArray(ids) ? ids : S.sel && S.sel.ids.length ? S.sel.ids : null;
  try {
    const res = await job({ op: 'test', ids: sel }, { label: t('ax.testing') });
    const bad = res.results.filter((r) => !r.ok);
    const secs = Math.max(0.001, res.ms / 1000);
    const speed = fmtSize(res.bytes / secs) + '/' + t('ax.u.s');
    S.lastTest = bad.length ? t('ax.testBad', { n: bad.length }) : t('ax.testOk', { n: res.results.length });
    const head = h('div', { class: 'ax-test-head ' + (bad.length ? 'ax-bad' : 'ax-good') }, iconEl(bad.length ? 'warn' : 'check'),
      h('div', null, h('b', null, S.lastTest), h('div', { class: 'ax-muted' }, t('ax.testStats', { size: fmtSize(res.bytes), secs: secs.toFixed(1), speed }))));
    const rows = res.results.map((r) => h('tr', { class: r.ok ? '' : 'ax-bad' }, h('td', { class: 'ax-st' }, r.ok ? t('ax.ok') : t('ax.error')), h('td', { class: 'ax-p' }, r.path), h('td', null, r.ok ? fmtSize(r.size) : errText(r))));
    const table = h('div', { class: 'ap-table-wrap ax-test-table' }, h('table', { class: 'ap-table' },
      h('thead', null, h('tr', null, h('th', null, t('ax.status')), h('th', null, t('ax.col.name')), h('th', null, t('ax.result')))),
      h('tbody', null, (bad.length ? [...rows.filter((r, i) => !res.results[i].ok), ...rows.filter((r, i) => res.results[i].ok)] : rows).slice(0, 2000))));
    const report = () => res.results.map((r) => (r.ok ? 'OK     ' : 'ERROR  ') + r.path + (r.ok ? '' : '  ' + errText(r))).join('\n') + '\n';
    openDialog({
      title: t('ax.testTitle'), body: h('div', { class: 'ax-report' }, head, table), wide: true,
      buttons: [{ label: t('ax.saveReport'), icon: 'download', onClick: () => { download(report(), stem(S.arc.name) + '-test.txt', 'text/plain'); return false; } }, { label: t('dlg.close'), value: null, primary: true }],
    });
    // Refresh the options card (it shows the last test). Positional selector: breaks silently if the side card order changes.
    const opts = document.querySelector('.ax-side .ap-card:nth-child(3)');
    if (opts) opts.replaceWith(optionsCard());
  } catch (e) { if (e.code !== 'aborted') toast(errText(e), 'error'); else toast(t('ax.err.aborted'), 'info'); }
}

// --- one entry: details and preview ----------------------------------------------------------------------------

function entryDetails(n) {
  const e = n.entry;
  return kv([
    [t('ax.path'), e.path],
    [t('ax.size'), e.size == null ? '—' : fmtSize(e.size) + (e.size >= 1024 ? ` (${fmtCount(e.size)} ${t('ax.u.b')})` : '')],
    [t('ax.packed'), e.packed != null && (e.packed || !e.solid) ? fmtSize(e.packed) : e.solid ? t('ax.inSolid') : ''],
    [t('ax.ratio'), e.packed && e.size ? fmtRatio(e.packed, e.size) : ''],
    [t('ax.modified'), fmtDate(e.mtime, true)], [t('ax.created'), fmtDate(e.ctime, true)], [t('ax.accessed'), fmtDate(e.atime, true)],
    [t('ax.method'), e.method], [t('ax.crc'), fmtCrc(e.crc)],
    [t('ax.attributes'), [fmtAttrib(e.attrib), fmtMode(e.mode)].filter(Boolean).join('  ')],
    [t('ax.linkTo'), e.link || ''], [t('ax.encryption'), e.encrypted ? t('ax.yes') : ''],
    [t('ax.problem'), e.unsupported ? t('ax.unsupportedItem', { what: e.unsupported }) : e.unsafe ? t('ax.unsafePath') : ''],
    [t('ax.comment'), e.comment || ''],
  ]);
}

/** Properties of a file (its details) or of a folder (what it holds). */
function showProperties(n) {
  let body;
  if (n.dir) {
    let dirs = 0, solid = false;
    const walk = (x) => { for (const c of x.list) { if (c.dir) { dirs++; walk(c); } else if (c.entry.solid) solid = true; } };
    walk(n);
    const e = n.entry;
    // Files of a solid block share their packed size: no per-folder figure then.
    body = kv([
      [t('ax.path'), n.path], [t('ax.files'), fmtCount(n.files)], [t('ax.folders'), fmtCount(dirs)],
      [t('ax.size'), fmtSize(n.size)], [t('ax.packed'), solid ? t('ax.inSolid') : n.packed ? fmtSize(n.packed) : ''],
      [t('ax.ratio'), !solid && n.packed && n.size ? fmtRatio(n.packed, n.size) : ''],
      [t('ax.modified'), fmtDate(n.mtime, true)],
      [t('ax.attributes'), e ? [fmtAttrib(e.attrib), fmtMode(e.mode)].filter(Boolean).join('  ') : ''],
    ]);
  } else body = entryDetails(n);
  const buttons = [];
  if (!n.dir) buttons.push({ label: t('ax.preview'), icon: 'eye', onClick: () => { showEntry(n); return true; } });
  buttons.push({ label: t('dlg.close'), value: null, primary: true });
  openDialog({ title: n.name, body: h('div', { class: 'ax-entry' }, body), wide: true, buttons, className: 'ax-dlg' });
}

// Images up to 40 MiB are previewed whole; everything else reads only 512 KiB. Closing the dialog cancels a still-running preview job and revokes the object URL.
function showEntry(n) {
  const e = n.entry;
  const kind = kindOf(n.name);
  const details = entryDetails(n);
  const pv = h('div', { class: 'ax-preview', 'aria-live': 'polite' });
  let url = null;
  const load = async () => {
    if (e.unsupported) { pv.replaceChildren(h('div', { class: 'ax-muted' }, t('ax.unsupportedItem', { what: e.unsupported }))); return; }
    if (!e.size) { pv.replaceChildren(h('div', { class: 'ax-muted' }, t('ax.emptyFile'))); return; }
    const img = imageMime(n.name);
    const max = img && (e.size || 0) <= 40 << 20 ? 40 << 20 : 512 << 10;
    pv.replaceChildren(h('div', { class: 'ax-muted ax-loading' }, h('span', { class: 'ed-spinner ax-spin' }), t('ax.loadingPreview')));
    try {
      const r = await job({ op: 'preview', entry: e.id, max }, { label: t('ax.previewing', { name: n.name }) });
      const b = r.bytes;
      if (img && !r.truncated) {
        url = URL.createObjectURL(new Blob([b], { type: img }));
        const im = h('img', { src: url, alt: n.name, class: 'ax-img' });
        im.addEventListener('error', () => pv.replaceChildren(h('div', { class: 'ax-muted' }, t('ax.noPreview'))));
        pv.replaceChildren(im);
      } else if (looksText(b)) {
        pv.replaceChildren(...[h('pre', { class: 'ap-pre ax-text', dir: 'auto', tabindex: '0' }, decodePreview(b)), r.truncated ? h('div', { class: 'ax-muted' }, t('ax.truncated', { size: fmtSize(b.length) })) : null].filter(Boolean));
      } else {
        pv.replaceChildren(h('div', { class: 'ax-muted' }, t('ax.binary')), h('pre', { class: 'ap-pre ax-hex', tabindex: '0' }, hexDump(b)));
      }
    } catch (err) {
      pv.replaceChildren(h('div', { class: 'ax-error' }, errText(err)));
    }
  };
  const buttons = [];
  if (kind === 'archive' && e.size) buttons.push({ label: t('ax.openInside'), icon: 'archive', onClick: () => { openNested(n); return true; } });
  buttons.push({ label: t('ax.download'), icon: 'download', primary: true, onClick: () => { extract([e.id]); return true; } });
  openDialog({ title: n.name, body: h('div', { class: 'ax-entry' }, details, h('h3', { class: 'ax-sub' }, t('ax.preview')), pv), wide: true, buttons, className: 'ax-dlg' })
    .then(() => { if (url) URL.revokeObjectURL(url); runner.cancel(); });
  load();
}

// An archive inside the archive is extracted to a Blob and opened as a new group right after the current one.
async function openNested(n) {
  try {
    const res = await job({ op: 'extract', ids: [n.entry.id], mode: 'files' }, { label: t('ax.extracting') });
    if (!res.files.length) { if (res.errors.length) toast(errText(res.errors[0]), 'error'); return; }
    const f = new File([res.files[0].blob], n.name, { lastModified: n.entry.mtime || Date.now() });
    S.groups.splice(S.cur + 1, 0, [f]);
    openGroup(S.cur + 1);
  } catch (e) { if (e.code !== 'aborted') toast(errText(e), 'error'); }
}

/** The node of a path in the tree (tests and automation). */
function findNode(path) {
  let hit = null;
  const walk = (x) => { for (const c of x.list) { if (hit) return; if (c.path === path) hit = c; else if (c.dir) walk(c); } };
  if (S.tree) walk(S.tree.root);
  return hit;
}

// --- commander ---------------------------------------------------------------------------------------------------

/** The two-panel view; the archives opened in the classic view join its workspace the first time. */
function renderCommander() {
  const first = !fm;
  S.view = 'fm';
  lsSet('archproc-view', 'fm');
  const m = main();
  m.className = 'ap-main ap-wide ax-main fm-main';
  if (!fm) fm = createCommander({ job, errText, onClassic: leaveCommander });
  E.progress = fm.progressEl;
  m.replaceChildren(fm.el);
  document.title = t('fm.title') + ' · ' + t('app.name');
  if (first && S.groups.length) fm.addFiles(S.groups.flat());
  fm.focus();
}

function leaveCommander() {
  S.view = 'classic';
  lsSet('archproc-view', 'classic');
  if (S.arc && S.tree) renderArchive(); else renderStart();
}

// --- page --------------------------------------------------------------------------------------------------------

// Language switch: the commander is recreated from the old one's state (workspace, mounts, locations), so nothing is lost.
function relabel() {
  if (S.view === 'fm' && fm) { fm = createCommander({ job, errText, onClassic: leaveCommander, state: fm.state }); renderCommander(); return; }
  if (S.arc && S.tree) { renderArchive(); } else renderStart();
}

function boot() {
  addIcons({ archive: LOGO, key: 'M15 7a4 4 0 1 1-3.9 4.9L3 20v-3h3v-3h3l1.9-1.9A4 4 0 0 1 15 7zM16.5 9.5h.01' });
  startApp({ key: 'archproc', name: 'app.name', logo: LOGO, offline: true, onLang: relabel });
  runner = createRunner({ onMode: (mode) => { document.documentElement.dataset.engine = mode; } });
  if (S.view === 'fm') renderCommander(); else renderStart();
  // Files dropped anywhere on the page open too (also while an archive is shown).
  // Document-level drop: preventDefault on dragover is what makes an element a drop target; only file drags are accepted.
  document.addEventListener('dragover', (ev) => { if (ev.dataTransfer && [...ev.dataTransfer.types].includes('Files')) ev.preventDefault(); });
  document.addEventListener('drop', (ev) => { if (ev.defaultPrevented || !ev.dataTransfer || !ev.dataTransfer.files.length) return; ev.preventDefault(); openFiles([...ev.dataTransfer.files]); });
  // Test hooks for automated checks (e2e scenarios): open files, read the state.
  // Test hooks for the e2e scenarios (e2e-*.js): read-only access to state plus entry points; not used by the UI.
  window.__archproc = { openFiles, state: S, runner: () => runner, extract, testArchive, commander: () => fm, renderCommander, leaveCommander, rowMenu: (path, touch) => { const n = findNode(path); return n ? rowMenu(n, !!touch).filter((x) => x && x.label).map((x) => x.label) : null; } };
}

// Page: the UI. Worker (this bundle re-run from a Blob): the engine side. Anywhere else (Node): nothing.
if (typeof document !== 'undefined') boot();
else if (typeof WorkerGlobalScope !== 'undefined') workerMain();
