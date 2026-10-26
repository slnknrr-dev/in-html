// mail-composer/main.js - the compose page: From / To / Cc / Bcc / Reply-To with live address checks (invalid
// entries, duplicates, the same Gmail mailbox written differently, IDN domains, masked display), a subject shown as
// its RFC 2047 header, the body as Markdown, rich text or plain text with a generated plain-text alternative, inline
// images (multipart/related, cid:) and attachments (RFC 2231 names), custom headers and options (draft flag for
// Outlook, date, Message-ID, priority, transfer encoding), a mail merge (CSV rows + {{placeholders}} -> a ZIP of .eml
// files), a stage with the rendered message, its source and its MIME structure read back, and exports (.eml,
// mailto: when the message is simple enough, the source, the inspector).
//
// Data flow: S (form state, localStorage) + FILES (binary attachments, IndexedDB) -> update() -> composeMessage()
// (message.js, pure) -> R.built { eml, html, text, addr, warnings } -> painters (chips, preview, source, structure,
// exports). Each keystroke rebuilds the whole .eml (debounced): building is fast for normal mails, and the preview,
// source and checks can then never disagree with the file that is exported.
// Bodies in three editors; switching mode converts the content (Markdown <-> HTML <-> text) so nothing is lost.
import { FIELDS, composeMessage, guessColumns, htmlToText, mailtoFor, markdownHTML, placeholdersOf, rowsOf, sanitizeBody } from './message.js';
import { addrChip, findings, fmtSize, idbDel, idbGet, idbSet, pageHref, previewDoc, previewFrame, renderInspector, startShell, tabs, uid } from './common.js';
import { button, card, copyText, download, dropZone, field, seg, t, textInput, toast, toggle } from '../ui/app.js';
import { $, $$, debounce, h, lsGet, lsSet } from '../ui/dom.js';
import { icon, iconEl } from '../ui/icons.js';
import { confirmDialog, promptDialog } from '../ui/overlays.js';
import { safeAttName } from '../ui/files.js';
import { UI_STATE } from '../ui/i18n.js';
import { maskEmail } from '../mail/address.js';
import { encodeHeaderText } from '../mail/encoding.js';
import { contentTypeOf, emlFileName, foldHeader, parseMessage } from '../mail/mime.js';
import { b64encode } from '../codec/base64.js';
import { htmlToMarkdown } from '../markdown/write.js';
import { parseCSV, sniffCSV } from '../csv/csv.js';
import { decodeBytes as decodeText } from '../csv/encoding.js';
import { writeZip } from '../zip/zip.js';

// ---------------------------------------------------------------------------------------------------------------
// State (persisted in localStorage 'mc-draft'; files in IndexedDB 'files')

const DEF = {
  // Sample addresses use example.* domains (RFC 2606): safe if a user actually sends the sample.
  from: 'Ana Beridze <ana@example.ge>', to: 'Giorgi <giorgi@example.com>', cc: '', bcc: '', replyTo: '',
  subject: '', mode: 'markdown', md: '', rich: '', plain: '', ownText: false, text: '',
  headers: [], draft: true, priority: 'normal', date: true, msgId: true, encoding: 'auto', keepBcc: false,
  mask: false, tab: 'preview',
  // The merge sample includes a dotted Gmail address to demonstrate canonical duplicate detection.
  merge: { on: false, csv: 'email,name,city\ngiorgi@example.com,Giorgi,Tbilisi\nnino@example.org,Nino,Batumi\nv.a.s.y.a@gmail.com,Vasya,Kutaisi\n', emailCol: '', nameCol: '', row: 0 },
};
const SKEY = 'mc-draft';

function loadState() {
  const saved = lsGet(SKEY, null);
  const s = structuredClone(DEF);
  if (!saved || typeof saved !== 'object') { s.subject = t('mc.sample.subject'); s.md = t('mc.sample.md'); return s; }
  // Restore by type per key; enums validated below; nested merge settings and headers restored separately.
  for (const k of Object.keys(DEF)) {
    if (k === 'merge' || k === 'headers') continue;
    if (saved[k] != null && typeof saved[k] === typeof DEF[k]) s[k] = saved[k];
  }
  if (!['markdown', 'rich', 'plain'].includes(s.mode)) s.mode = 'markdown';
  if (!['low', 'normal', 'high'].includes(s.priority)) s.priority = 'normal';
  if (!['auto', 'quoted-printable', 'base64'].includes(s.encoding)) s.encoding = 'auto';
  if (Array.isArray(saved.headers)) s.headers = saved.headers.filter((x) => x && typeof x.name === 'string' && typeof x.value === 'string').slice(0, 40);
  if (saved.merge && typeof saved.merge === 'object') for (const k of Object.keys(DEF.merge)) if (typeof saved.merge[k] === typeof DEF.merge[k]) s.merge[k] = saved.merge[k];
  return s;
}
let S = loadState();
let FILES = [];
const save = debounce(() => lsSet(SKEY, S), 300);
// Files are debounced into IndexedDB as structured clones (Uint8Array data stored natively, no base64).
const saveFiles = debounce(() => idbSet('files', FILES.map((f) => ({ ...f }))), 400);

// One boundary per page session (stable previews); random bytes for Message-ID.
// A stable boundary keeps the source tab from changing on every keystroke (diffable output); it is random per
// session so a boundary string never collides with content predictably.
const BOUNDARY = 'mc' + Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');
const random = (n) => crypto.getRandomValues(new Uint8Array(n));

// Derived results of the last update.
const R = { built: null, merge: null, mailto: null };

// ---------------------------------------------------------------------------------------------------------------
// Layout

const main = $('#main');
main.classList.add('mc-compose');
let els = {};

function render() {
  main.textContent = '';
  els = { chips: {} };
  const form = h('div', { class: 'mc-col mc-form' }, addressCard(), messageCard(), filesCard(), mergeCard(), optionsCard());
  els.summary = h('div', { class: 'mc-stage-meta' });
  els.panel = h('div', { class: 'mc-panel', id: 'mc-panel', role: 'tabpanel' });
  els.tabs = tabs([{ k: 'preview', l: 'mc.tab.preview', icon: 'eye' }, { k: 'source', l: 'mc.tab.source', icon: 'code' }, { k: 'structure', l: 'mc.tab.structure', icon: 'tree' }], S.tab, (k) => { S.tab = k; save(); paintPanel(); }, 'mc.tab.label');
  els.warn = h('div', { class: 'mc-warn' });
  const stage = h('section', { class: 'ap-card mc-stage' }, h('div', { class: 'mc-stage-head' }, els.tabs, els.summary), els.panel);
  const stageCol = h('div', { class: 'mc-col mc-s' }, stage, els.warn, card('mc.export', exportBox()));
  main.append(h('div', { class: 'mc-work' }, form, stageCol));
  update();
}

// --- addresses ---------------------------------------------------------------------------------------------------

function addressCard() {
  const box = h('div', { class: 'ed-fields' });
  for (const f of FIELDS) {
    const multi = f === 'to' || f === 'cc' || f === 'bcc';
    const input = textInput(S[f], (v) => { S[f] = v; changed(); }, { multiline: multi, rows: 1, class: 'ed-input mc-addr-input' + (multi ? ' ed-textarea' : ''), dir: 'auto', autocomplete: 'off', placeholder: t('mc.ph.' + f), id: 'mc-' + f });
    els.chips[f] = h('div', { class: 'mc-chips', 'aria-live': 'polite' });
    // In merge mode the To field comes from the CSV column; the input is disabled and says so.
    const disabled = f === 'to' && S.merge.on;
    if (disabled) { input.disabled = true; input.value = t('mc.merge.toFromCsv'); }
    box.append(h('div', { class: 'ed-field' }, h('label', { class: 'ed-label', for: input.id }, t('mc.f.' + f)), input, els.chips[f]));
  }
  box.append(field('mc.f.mask', toggle(S.mask, (v) => { S.mask = v; save(); paintChips(); }), 'mc.h.mask'));
  return card('mc.addresses', box, h('div', { class: 'ed-hint' }, t('mc.h.addresses')));
}

function paintChips() {
  if (!R.built) return;
  const entries = R.built.addr.entries;
  for (const f of FIELDS) {
    const box = els.chips[f];
    if (!box) continue;
    box.textContent = '';
    for (const e of entries[f]) {
      // Masked display (a***@g***.com) for screenshots and screen sharing; invalid entries stay unmasked so they can be
      // fixed.
      const shown = S.mask && e.status !== 'invalid' ? maskEmail(e.address) || e.address : e.address;
      const note = e.status === 'invalid' ? t('mc.a.invalid') : e.status === 'dup' ? t('mc.a.dup', { f: t('mc.f.' + e.dupOf) }) : e.status === 'canon' ? t('mc.a.canon', { other: S.mask ? maskEmail(e.dupOf) : e.dupOf }) : '';
      const extra = [];
      if (e.unicodeDomain && e.unicodeDomain !== e.domain) extra.push(t('mc.a.idn', { ascii: e.domain }));
      if (e.plusTag) extra.push(t('mc.a.plus', { tag: e.plusTag }));
      const chip = addrChip({ name: e.name, address: shown }, 'mc-a-' + e.status);
      chip.title = [note, ...extra].filter(Boolean).join(' · ') || t('mc.a.ok');
      chip.prepend(iconEl(e.status === 'ok' ? 'check' : e.status === 'invalid' ? 'close' : 'warn'));
      if (note) chip.append(h('span', { class: 'mc-a-note' }, note));
      else if (extra.length) chip.append(h('span', { class: 'mc-a-note mc-a-info' }, extra.join(' · ')));
      box.append(chip);
    }
  }
}

// --- subject and body ----------------------------------------------------------------------------------------

function messageCard() {
  const subj = textInput(S.subject, (v) => { S.subject = v; changed(); paintSubject(); }, { id: 'mc-subject', dir: 'auto', autocomplete: 'off', placeholder: t('mc.ph.subject') });
  els.subjEnc = h('pre', { class: 'mc-enc mc-mono', 'aria-label': t('mc.h.subjectEnc') });
  const modeSeg = seg([{ v: 'markdown', l: 'mc.mode.markdown' }, { v: 'rich', l: 'mc.mode.rich' }, { v: 'plain', l: 'mc.mode.plain' }], S.mode, (v) => switchMode(v), 'mc.f.mode');
  els.editor = h('div', { class: 'mc-editor' });
  els.alt = h('div', { class: 'mc-alt' });
  const box = h('div', { class: 'ed-fields' },
    h('div', { class: 'ed-field' }, h('label', { class: 'ed-label', for: 'mc-subject' }, t('mc.f.subject')), subj, els.subjEnc),
    h('div', { class: 'ed-field' }, h('span', { class: 'ed-label', id: 'mc-mode-l' }, t('mc.f.body')), modeSeg),
    els.editor, els.alt);
  modeSeg.setAttribute('aria-labelledby', 'mc-mode-l');
  renderEditor();
  paintSubject();
  return card('mc.message', box);
}

function paintSubject() {
  const enc = encodeHeaderText(S.subject);
  // The encoded form is shown only when it differs from the plain subject (i.e. non-ASCII needed RFC 2047 encoding).
  els.subjEnc.textContent = enc === S.subject.trim() ? '' : foldHeader('Subject', enc);
}

// Mode switches carry the content over (Markdown <-> HTML, anything -> text).
function switchMode(v) {
  if (v === S.mode) return;
  const from = S.mode;
  if (v === 'rich') S.rich = from === 'markdown' ? markdownHTML(S.md) : textToHTML(S.plain);
  else if (v === 'markdown') S.md = from === 'rich' ? htmlToMarkdown(S.rich) : S.plain;
  else S.plain = from === 'rich' ? htmlToText(S.rich) : S.md;
  S.mode = v;
  renderEditor();
  changed();
}
const escHTML = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const textToHTML = (s) => String(s || '').split(/\n{2,}/).filter((p) => p.trim()).map((p) => '<p>' + escHTML(p).replace(/\n/g, '<br>') + '</p>').join('');

function toolBtn(label, ic, fn, text) {
  // mousedown preventDefault keeps the focus (and selection) in the editor while a toolbar button is clicked.
  return h('button', { type: 'button', class: 'ed-iconbtn mc-tb', title: t(label), 'aria-label': t(label), html: ic ? icon(ic) : null, onmousedown: (e) => e.preventDefault(), onclick: fn }, text || null);
}

function renderEditor() {
  const box = els.editor;
  box.textContent = '';
  if (S.mode === 'markdown') {
    const ta = h('textarea', { class: 'ed-input ed-textarea mc-md mc-mono', id: 'mc-md', rows: 12, spellcheck: 'true', dir: 'auto', 'aria-label': t('mc.f.body') });
    ta.value = S.md;
    ta.addEventListener('input', () => { S.md = ta.value; changed(); });
    const wrap = (a, b, ph) => () => mdWrap(ta, a, b, ph);
    const line = (p) => () => mdLine(ta, p);
    box.append(h('div', { class: 'mc-toolbar', role: 'toolbar', 'aria-label': t('mc.tb.label') },
      toolBtn('mc.tb.bold', 'bold', wrap('**', '**', t('mc.tb.text'))), toolBtn('mc.tb.italic', 'italic', wrap('_', '_', t('mc.tb.text'))),
      toolBtn('mc.tb.heading', 'heading', line('## ')), toolBtn('mc.tb.list', 'list', line('- ')), toolBtn('mc.tb.listOl', 'listOl', line('1. ')),
      toolBtn('mc.tb.quote', 'quote', line('> ')), toolBtn('mc.tb.link', 'link', async () => { const u = await promptDialog(t('mc.tb.link'), t('mc.tb.url'), 'https://'); if (u) mdWrap(ta, '[', `](${u})`, t('mc.tb.text')); }),
      placeholderMenu((ph) => mdInsert(ta, ph))), ta, h('div', { class: 'ed-hint' }, t('mc.h.markdown')));
    els.bodyInput = ta;
  } else if (S.mode === 'rich') {
    // The rich editor is a contenteditable div: document.execCommand is deprecated but still the only cross-browser
    // way to get native undo-aware formatting without shipping an editor engine.
    const ed = h('div', { class: 'ed-input mc-rich', id: 'mc-rich', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': t('mc.f.body'), spellcheck: 'true', dir: 'auto' });
    richToEditor(ed, S.rich);
    ed.addEventListener('input', () => { S.rich = richFromEditor(ed); changed(); });
    ed.addEventListener('paste', (e) => {
      // Pasted HTML is sanitised and images removed (pasted images would reference remote URLs or huge data: blobs);
      // plain text becomes paragraphs.
      const html = e.clipboardData?.getData('text/html');
      const txt = e.clipboardData?.getData('text/plain');
      if (!html && !txt) return;
      e.preventDefault();
      document.execCommand('insertHTML', false, html ? sanitizeBody(html.replace(/<img\b[^>]*>/gi, '')) : textToHTML(txt));
    });
    ed.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'b' || k === 'i') { e.preventDefault(); exec(k === 'b' ? 'bold' : 'italic'); }
    });
    const exec = (cmd, arg) => { ed.focus(); document.execCommand(cmd, false, arg); S.rich = richFromEditor(ed); changed(); };
    box.append(h('div', { class: 'mc-toolbar', role: 'toolbar', 'aria-label': t('mc.tb.label') },
      toolBtn('mc.tb.bold', 'bold', () => exec('bold')), toolBtn('mc.tb.italic', 'italic', () => exec('italic')),
      toolBtn('mc.tb.heading', 'heading', () => exec('formatBlock', 'h2')), toolBtn('mc.tb.paragraph', null, () => exec('formatBlock', 'p'), '¶'),
      toolBtn('mc.tb.list', 'list', () => exec('insertUnorderedList')), toolBtn('mc.tb.listOl', 'listOl', () => exec('insertOrderedList')),
      toolBtn('mc.tb.quote', 'quote', () => exec('formatBlock', 'blockquote')),
      toolBtn('mc.tb.link', 'link', async () => {
        const sel = window.getSelection();
        const range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
        const u = await promptDialog(t('mc.tb.link'), t('mc.tb.url'), 'https://');
        // Only http(s), mailto: and tel: links: a javascript: URL in a mail body is never legitimate.
        if (!u || !/^(https?:|mailto:|tel:)/i.test(u)) return;
        ed.focus();
        // The prompt dialog steals the selection; the saved range is restored before creating the link.
        if (range) { sel.removeAllRanges(); sel.addRange(range); }
        if (range && !range.collapsed) exec('createLink', u); else exec('insertHTML', `<a href="${escHTML(u)}">${escHTML(u)}</a>`);
      }),
      toolBtn('mc.tb.clear', 'undo', () => exec('removeFormat')),
      placeholderMenu((ph) => exec('insertText', ph))), ed, h('div', { class: 'ed-hint' }, t('mc.h.rich')));
    els.bodyInput = ed;
  } else {
    const ta = h('textarea', { class: 'ed-input ed-textarea mc-md', id: 'mc-plain', rows: 12, spellcheck: 'true', dir: 'auto', 'aria-label': t('mc.f.body') });
    ta.value = S.plain;
    ta.addEventListener('input', () => { S.plain = ta.value; changed(); });
    box.append(h('div', { class: 'mc-toolbar', role: 'toolbar', 'aria-label': t('mc.tb.label') }, placeholderMenu((ph) => mdInsert(ta, ph))), ta, h('div', { class: 'ed-hint' }, t('mc.h.plain')));
    els.bodyInput = ta;
  }
  renderAlt();
}

// Placeholder buttons of the merge columns (shown only in merge mode).
function placeholderMenu(insert) {
  const box = h('span', { class: 'mc-phs' });
  if (!S.merge.on) return box;
  const { columns } = mergeData();
  for (const c of columns.slice(0, 12)) box.append(h('button', { type: 'button', class: 'mc-ph', onmousedown: (e) => e.preventDefault(), onclick: () => insert(`{{${c}}}`), title: t('mc.merge.insert') }, `{{${c}}}`));
  return box;
}

function mdWrap(ta, a, b, ph) {
  const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e) || ph;
  ta.setRangeText(a + sel + b, s, e, 'end');
  ta.setSelectionRange(s + a.length, s + a.length + sel.length);
  ta.focus();
  ta.dispatchEvent(new Event('input'));
}
function mdLine(ta, prefix) {
  const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
  const ls = v.lastIndexOf('\n', s - 1) + 1;
  const le = v.indexOf('\n', e) < 0 ? v.length : v.indexOf('\n', e);
  // Numbered list prefixes count per selected line.
  const lines = v.slice(ls, le).split('\n').map((l, i) => (prefix === '1. ' ? `${i + 1}. ` : prefix) + l);
  ta.setRangeText(lines.join('\n'), ls, le, 'end');
  ta.focus();
  ta.dispatchEvent(new Event('input'));
}
function mdInsert(ta, text) {
  ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
  ta.focus();
  ta.dispatchEvent(new Event('input'));
}

// Rich editor <-> stored HTML: cid: images are shown from the files (data: URLs) and remote images are not loaded
// (their address waits in data-remote).
// src is renamed to data-src before parsing, so no remote request happens even for an instant. Hardening note: the
// stored HTML is assumed to be sanitised already (every writer passes sanitizeBody); a value tampered with in
// localStorage would reach the live editor unsanitised. Fix if needed: run sanitizeBody(html) here first.
const dataURL = (f) => 'data:' + f.type + ';base64,' + b64encode(f.data);
function richToEditor(ed, html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html || '').replace(/(<img\b[^>]*?\s)src(\s*=)/gi, '$1data-src$2');
  for (const img of tpl.content.querySelectorAll('img')) {
    const src = img.getAttribute('data-src') || '';
    img.removeAttribute('data-src');
    if (/^cid:/i.test(src)) {
      const cid = src.slice(4);
      const f = FILES.find((x) => x.cid === cid);
      img.dataset.cid = cid;
      if (f && /^image\//.test(f.type)) img.src = dataURL(f);
    } else if (src) { img.dataset.remote = src; img.alt = img.alt || src; }
  }
  ed.textContent = '';
  ed.append(tpl.content);
}
function richFromEditor(ed) {
  const c = ed.cloneNode(true);
  for (const img of c.querySelectorAll('img')) {
    if (img.dataset.cid) img.setAttribute('src', 'cid:' + img.dataset.cid);
    else if (img.dataset.remote) img.setAttribute('src', img.dataset.remote);
    else img.remove();
  }
  // Images without a cid or remote address (e.g. pasted data: images) are dropped before sanitising.
  return sanitizeBody(c.innerHTML);
}

// The plain-text alternative: generated (shown read-only) or own.
function renderAlt() {
  const box = els.alt;
  box.textContent = '';
  if (S.mode === 'plain') return;
  // Switching to an own text starts from the generated one, so the user edits instead of retyping.
  const own = toggle(S.ownText, (v) => { S.ownText = v; if (v && !S.text && R.built) S.text = R.built.text; renderAlt(); changed(); });
  const area = h('textarea', { class: 'ed-input ed-textarea mc-alt-text mc-mono', rows: 6, dir: 'auto', 'aria-label': t('mc.f.altText'), readonly: !S.ownText });
  area.value = S.ownText ? S.text : R.built ? R.built.text : '';
  area.addEventListener('input', () => { if (S.ownText) { S.text = area.value; changed(); } });
  els.altArea = area;
  box.append(h('details', { class: 'mc-details', open: S.ownText }, h('summary', {}, iconEl('chevRight'), h('span', {}, t('mc.f.altText'))),
    h('div', { class: 'ed-fields' }, field('mc.f.ownText', own, 'mc.h.altText'), area)));
}

// --- files -------------------------------------------------------------------------------------------------------

function filesCard() {
  els.files = h('ul', { class: 'mc-files-list' });
  const zone = dropZone({ multiple: true, onFiles: addFiles, label: 'mc.files.drop' });
  zone.classList.add('mc-drop');
  paintFiles();
  const c = card('mc.files', zone, els.files, h('div', { class: 'ed-hint' }, t('mc.h.files')));
  c.classList.add('mc-files');
  return c;
}

async function addFiles(list) {
  for (const f of list) {
    try {
      const data = new Uint8Array(await f.arrayBuffer());
      // safeAttName strips path separators and control characters: a file name never becomes a path when saved.
      const name = safeAttName(f.name, f.name) || 'file';
      FILES.push({ id: uid('f'), name, type: f.type || contentTypeOf(name), data, inline: false, cid: '' });
    } catch (e) { toast(t('ap.fileErr', { name: f.name, msg: e.message }), 'error'); }
  }
  paintFiles(); filesChanged();
}

function newCid(name) {
  // Content-IDs derived from file names (readable in the source), made unique with a numeric suffix.
  const base = String(name).toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'image';
  let n = 1, c = base;
  while (FILES.some((f) => f.cid === c)) c = base + '-' + (++n);
  return c;
}

function paintFiles() {
  const ul = els.files;
  if (!ul) return;
  ul.textContent = '';
  for (const f of FILES) {
    const isImg = /^image\//.test(f.type);
    const thumb = isImg && f.data.length < 3e6 ? h('img', { class: 'mc-thumb', alt: '', src: dataURL(f) }) : h('span', { class: 'mc-thumb mc-thumb-file', html: icon('file') });
    const name = h('input', { class: 'ed-input mc-fname', value: f.name, 'aria-label': t('mc.files.name'), dir: 'auto', spellcheck: 'false' });
    name.addEventListener('change', () => { const n = safeAttName(name.value, f.name); if (n) { f.name = n; f.type = f.type || contentTypeOf(n); } name.value = f.name; filesChanged(); });
    const del = h('button', { type: 'button', class: 'ed-iconbtn ed-danger mc-fdel', title: t('mc.files.remove'), 'aria-label': t('mc.files.remove') + ' ' + f.name, html: icon('trash'), onclick: () => { FILES = FILES.filter((x) => x !== f); paintFiles(); filesChanged(); } });
    const meta = h('div', { class: 'ed-hint' }, [f.type, fmtSize(f.data.length), /[^\x20-\x7e]/.test(f.name) ? t('mc.files.rfc2231') : ''].filter(Boolean).join(' · '));
    const row = h('li', { class: 'mc-file' }, thumb, h('div', { class: 'mc-file-main' }, name, meta), del);
    if (isImg && S.mode !== 'plain') {
      // Turning "inline" on assigns a Content-ID once; the image can then be placed in the body by reference.
      const inl = toggle(f.inline, (v) => { f.inline = v; if (v && !f.cid) f.cid = newCid(f.name); paintFiles(); filesChanged(); });
      const opts = h('div', { class: 'mc-file-opts' }, field('mc.files.inline', inl));
      if (f.inline) {
        opts.append(h('code', { class: 'mc-chip mc-mono' }, 'cid:' + f.cid));
        const ins = button('mc.files.insert', 'image', () => insertImage(f));
        ins.classList.add('ed-sm');
        opts.append(ins);
      }
      row.append(opts);
    }
    ul.append(row);
  }
}

function insertImage(f) {
  // Markdown alt text loses [ ] so the image syntax cannot be broken by the file name.
  if (S.mode === 'markdown' && els.bodyInput) mdInsert(els.bodyInput, `![${f.name.replace(/[[\]]/g, '')}](cid:${f.cid})`);
  else if (S.mode === 'rich' && els.bodyInput) {
    const ed = els.bodyInput;
    ed.focus();
    const sel = window.getSelection();
    // No caret inside the editor: insert at the end instead of wherever the document selection happens to be.
    if (!sel.rangeCount || !ed.contains(sel.anchorNode)) { const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); }
    // The editor shows the image from a data: URL but remembers its cid; richFromEditor writes src="cid:..." back.
    document.execCommand('insertHTML', false, `<img src="${dataURL(f)}" data-cid="${escHTML(f.cid)}" alt="${escHTML(f.name)}">`);
    S.rich = richFromEditor(ed);
    changed();
  }
}

const filesChanged = () => { saveFiles(); updateSoon(); };

// --- mail merge --------------------------------------------------------------------------------------------------

// Memo by CSV text identity: parsing runs once per change of the CSV, not on every update.
let mergeMemo = { csv: null, data: null };
function mergeData() {
  if (mergeMemo.csv === S.merge.csv) return mergeMemo.data;
  let data = { columns: [], rows: [] };
  try {
    const text = S.merge.csv;
    const { delimiter } = sniffCSV(text);
    data = rowsOf(parseCSV(text, { delimiter }));
  } catch { /* empty */ }
  mergeMemo = { csv: S.merge.csv, data };
  return data;
}

function mergeCard() {
  const m = S.merge;
  const box = h('div', { class: 'ed-fields' });
  els.mergeBox = box;
  const paint = () => {
    box.textContent = '';
    box.append(field('mc.merge.on', toggle(m.on, (v) => { m.on = v; render(); changed(); }), 'mc.h.merge'));
    if (!m.on) return;
    const ta = h('textarea', { class: 'ed-input ed-textarea mc-mono', rows: 5, id: 'mc-csv', spellcheck: 'false', 'aria-label': t('mc.merge.csv') });
    ta.value = m.csv;
    // CSV edits are debounced separately (parsing large lists per keystroke would lag).
    ta.addEventListener('input', debounce(() => { m.csv = ta.value; fixColumns(); paintSelectors(); changed(); }, 250));
    const zone = dropZone({ accept: '.csv,.tsv,.txt,text/csv', onFiles: async ([f]) => { const r = decodeText(new Uint8Array(await f.arrayBuffer())); m.csv = r.text; ta.value = m.csv; fixColumns(); paintSelectors(); changed(); }, label: 'mc.merge.drop', paste: false });
    zone.classList.add('mc-drop-sm');
    const sel = h('div', { class: 'ed-grid2' });
    els.mergeInfo = h('div', { class: 'ed-hint mc-merge-info' });
    box.append(field('mc.merge.csv', ta, 'mc.h.csv'), zone, sel, els.mergeInfo);
    function paintSelectors() {
      const { columns, rows } = mergeData();
      sel.textContent = '';
      const opt = (v, cur) => h('option', { value: v, selected: v === cur }, v || '—');
      const email = h('select', { class: 'ed-input ed-select', id: 'mc-ecol' }, columns.map((c) => opt(c, m.emailCol)));
      email.addEventListener('change', () => { m.emailCol = email.value; changed(); });
      const name = h('select', { class: 'ed-input ed-select', id: 'mc-ncol' }, ['', ...columns].map((c) => opt(c, m.nameCol)));
      name.addEventListener('change', () => { m.nameCol = name.value; changed(); });
      const rowSel = h('select', { class: 'ed-input ed-select', id: 'mc-row' }, rows.map((r, i) => h('option', { value: String(i), selected: i === m.row }, `${i + 1}. ${String(r[m.emailCol] ?? '').slice(0, 40)}`)));
      rowSel.addEventListener('change', () => { m.row = +rowSel.value; changed(); });
      sel.append(field('mc.merge.emailCol', email), field('mc.merge.nameCol', name), h('div', { class: 'ed-field ed-field-wide' }, h('label', { class: 'ed-label', for: 'mc-row' }, t('mc.merge.preview')), rowSel));
    }
    fixColumns();
    paintSelectors();
  };
  paint();
  return card('mc.merge', box);
}

function fixColumns() {
  const m = S.merge, { columns, rows } = mergeData();
  const g = guessColumns(columns, rows);
  // New columns: guess the address and name columns again; otherwise keep the user's choice.
  if (!columns.includes(m.emailCol)) { m.emailCol = g.email || columns[0] || ''; m.nameCol = g.name; }
  if (m.nameCol && !columns.includes(m.nameCol)) m.nameCol = '';
  if (m.row >= rows.length) m.row = 0;
}

// --- options and headers -----------------------------------------------------------------------------------------

function optionsCard() {
  const box = h('div', { class: 'ed-fields' });
  box.append(
    field('mc.o.draft', toggle(S.draft, (v) => { S.draft = v; changed(); }), 'mc.h.draft'),
    h('div', { class: 'ed-grid2' },
      field('mc.o.date', toggle(S.date, (v) => { S.date = v; changed(); })),
      field('mc.o.msgId', toggle(S.msgId, (v) => { S.msgId = v; changed(); }))),
    field('mc.o.keepBcc', toggle(S.keepBcc, (v) => { S.keepBcc = v; changed(); }), 'mc.h.keepBcc'),
    group('mc.o.priority', seg([{ v: 'low', l: 'mc.o.low' }, { v: 'normal', l: 'mc.o.normal' }, { v: 'high', l: 'mc.o.high' }], S.priority, (v) => { S.priority = v; changed(); }, 'mc.o.priority')),
    group('mc.o.encoding', seg([{ v: 'auto', l: 'mc.o.auto' }, { v: 'quoted-printable', l: '=Quoted-printable' }, { v: 'base64', l: '=Base64' }], S.encoding, (v) => { S.encoding = v; changed(); }, 'mc.o.encoding'), 'mc.h.encoding'));
  els.headers = h('div', { class: 'mc-headers' });
  paintHeaders();
  const add = button('mc.o.addHeader', 'plus', () => { S.headers.push({ name: 'X-', value: '' }); paintHeaders(); changed(); $$('.mc-hname', els.headers).at(-1)?.focus(); });
  add.classList.add('ed-sm');
  box.append(h('div', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('mc.o.headers')), els.headers, h('div', { class: 'ap-row' }, add), h('div', { class: 'ed-hint' }, t('mc.h.headers'))));
  return card('mc.options', box);
}

let gseq = 0;
function group(label, control, hint) {
  const id = 'mc-g' + (++gseq);
  control.setAttribute('aria-labelledby', id);
  return h('div', { class: 'ed-field' }, h('span', { class: 'ed-label', id }, t(label)), control, hint ? h('div', { class: 'ed-hint' }, t(hint)) : null);
}

function paintHeaders() {
  const box = els.headers;
  box.textContent = '';
  S.headers.forEach((hd, i) => {
    const n = h('input', { class: 'ed-input mc-mono mc-hname', value: hd.name, 'aria-label': t('mc.o.hName'), spellcheck: 'false', autocomplete: 'off' });
    n.addEventListener('input', () => { hd.name = n.value; changed(); });
    const v = h('textarea', { class: 'ed-input mc-hvalue', rows: 1, 'aria-label': t('mc.o.hValue'), spellcheck: 'false', dir: 'auto' });
    v.value = hd.value;
    v.addEventListener('input', () => { hd.value = v.value; changed(); });
    const del = h('button', { type: 'button', class: 'ed-iconbtn ed-danger', title: t('mc.o.removeHeader'), 'aria-label': t('mc.o.removeHeader'), html: icon('trash'), onclick: () => { S.headers.splice(i, 1); paintHeaders(); changed(); } });
    box.append(h('div', { class: 'mc-hrow' }, n, v, del));
  });
}

// --- export ------------------------------------------------------------------------------------------------------

function exportBox() {
  els.dl = button('mc.x.eml', 'download', downloadEml, 'primary');
  els.dl.id = 'mc-download';
  els.zip = button('mc.x.zip', 'zip', downloadZip, 'primary');
  els.mailto = button('mc.x.mailto', 'send', openMailto);
  els.mailto.id = 'mc-mailto';
  els.mailtoNote = h('div', { class: 'ed-hint mc-mailto-note' });
  const copy = button('mc.x.copy', 'copy', () => R.built && copyText(R.built.eml, t('mc.x.copied')));
  const insp = button('mc.x.inspect', 'inspect', inspectThis);
  const reset = button('mc.x.new', 'filePlus', newMessage);
  return h('div', { class: 'mc-export' },
    h('div', { class: 'ap-row' }, S.merge.on ? els.zip : null, els.dl, els.mailto), els.mailtoNote,
    h('div', { class: 'ap-row' }, copy, insp, reset),
    h('div', { class: 'ed-hint' }, t('mc.h.export')));
}

function downloadEml() {
  if (!R.built) return;
  download(R.built.eml, emlFileName(R.built.subject), 'message/rfc822');
}

async function downloadZip() {
  const { rows } = mergeData();
  if (!rows.length) { toast(t('mc.merge.noRows'), 'warn'); return; }
  const out = [], skipped = [];
  const used = new Set();
  // Each row is built with the same composer (fresh Message-ID per row); rows without a valid recipient are skipped
  // and reported by number. File names: row number + sanitised address, made unique.
  rows.forEach((row, i) => {
    const b = build(row);
    const email = String(row[S.merge.emailCol] ?? '').trim();
    if (!b.addr.valid.to.length) { skipped.push(i + 1); return; }
    let name = `${String(i + 1).padStart(3, '0')}-${email.replace(/[^\w.@+-]+/g, '_')}.eml`;
    while (used.has(name)) name = name.replace(/\.eml$/, '-x.eml');
    used.add(name);
    out.push({ name, data: b.eml });
  });
  if (!out.length) { toast(t('mc.merge.noneValid'), 'error'); return; }
  try {
    const zip = await writeZip(out);
    download(zip, 'mail-merge.zip', 'application/zip');
    toast(t('mc.merge.done', { n: out.length }) + (skipped.length ? ' ' + t('mc.merge.skipped', { n: skipped.length, rows: skipped.join(', ') }) : ''), skipped.length ? 'warn' : 'ok');
  } catch (e) { toast(t('err.generic', { msg: e.message }), 'error'); }
}

function openMailto() {
  if (!R.mailto || !R.mailto.ok) return;
  // A temporary <a> click instead of location.href: assigning location would count as a navigation of this page.
  const a = h('a', { href: R.mailto.href, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  a.remove();
}

async function inspectThis() {
  if (!R.built) return;
  // Hand-over to the inspect page through IndexedDB (the .eml may be megabytes, too large for a URL).
  await idbSet('inspect', { name: emlFileName(R.built.subject), text: R.built.eml });
  location.href = pageHref('pg-inspect') + '#from=compose';
}

async function newMessage() {
  if (!(await confirmDialog(t('mc.x.new'), t('mc.x.newConfirm'), t('mc.x.newOk')))) return;
  // "New message" keeps sender and preferences, clears recipients, body and files.
  const keep = { from: S.from, merge: S.merge, mask: S.mask, draft: S.draft, encoding: S.encoding };
  S = { ...structuredClone(DEF), ...keep, to: '', merge: { ...S.merge, on: false } };
  FILES = [];
  saveFiles();
  render();
  save();
  $('#mc-to')?.focus();
}

// ---------------------------------------------------------------------------------------------------------------
// Update: state -> message -> stage, chips, warnings

const changed = () => { save(); updateSoon(); };
const updateSoon = debounce(() => update(), 180);

function build(row) {
  // offset = minutes east of UTC (getTimezoneOffset is west-positive, hence the minus) for the Date header.
  return composeMessage(S, FILES, { now: Date.now(), offset: -new Date().getTimezoneOffset(), random, boundary: BOUNDARY, row, lang: UI_STATE.lang });
}

function update() {
  let row = null;
  if (S.merge.on) {
    const { rows } = mergeData();
    // The preview shows the selected merge row (or the first); an empty object when the CSV has no rows.
    row = rows[S.merge.row] || rows[0] || {};
  }
  try { R.built = build(row); } catch (e) { R.built = null; toast(t('err.generic', { msg: e.message }), 'error'); return; }
  R.mailto = mailtoFor(S, R.built, FILES);
  paintChips();
  paintSummary();
  paintWarnings();
  paintPanel();
  paintExport();
  if (S.mode !== 'plain' && !S.ownText && els.altArea) els.altArea.value = R.built.text;
  if (S.merge.on && els.mergeInfo) {
    const { columns, rows } = mergeData();
    // Placeholders used anywhere in the message, listed so the user sees which columns matter.
    const used = new Set([S.subject, S.md, S.rich, S.plain, S.text, S.cc, S.bcc, S.replyTo, ...S.headers.map((x) => x.value)].flatMap(placeholdersOf).map((x) => x.toLowerCase()));
    els.mergeInfo.textContent = t('mc.merge.info', { n: rows.length, cols: columns.length }) + ' ' + (used.size ? t('mc.merge.used', { list: [...used].map((x) => `{{${x}}}`).join(' ') }) : t('mc.merge.noneUsed'));
  }
}

function paintSummary() {
  const b = R.built, box = els.summary;
  box.textContent = '';
  const chip = (s) => h('span', { class: 'mc-chip' }, s);
  const shape = b.model.attachments.some((a) => !a.inline) ? 'multipart/mixed' : b.html ? (b.inline.length ? 'multipart/alternative + related' : 'multipart/alternative') : 'text/plain';
  const rc = b.addr.valid.to.length + b.addr.valid.cc.length + b.addr.valid.bcc.length;
  // Size in bytes as encoded (Blob size), not string length.
  box.append(chip(fmtSize(new Blob([b.eml]).size)), chip(shape), chip(t('mc.s.rcpt', { n: rc })));
  if (S.merge.on) box.append(chip(t('mc.s.mergeRow', { i: S.merge.row + 1, n: mergeData().rows.length })));
}

function paintWarnings() {
  const box = els.warn;
  box.textContent = '';
  if (R.built.warnings.length) box.append(findings(R.built.warnings, 'mc.w.'));
}

function paintPanel() {
  const b = R.built, box = els.panel;
  if (!b || !box) return;
  els.tabs.set(S.tab);
  box.textContent = '';
  if (S.tab === 'source') {
    const pre = h('pre', { class: 'ap-pre mc-raw mc-source', tabindex: '0', 'aria-label': t('mc.tab.source') });
    // Very large sources are cut for display only; the exported file is complete.
    pre.textContent = b.eml.length > 300000 ? b.eml.slice(0, 300000) + '\n…' : b.eml;
    box.append(pre);
    if (b.eml.length > 300000) box.append(h('div', { class: 'ed-hint' }, t('mc.s.cut', { size: fmtSize(b.eml.length) })));
    return;
  }
  if (S.tab === 'structure') {
    // The structure tab parses the generated .eml back with the same parser the inspector uses: a round-trip check.
    const msg = parseMessage(b.eml);
    renderInspector(box, msg, b.eml, { compact: true });
    return;
  }
  // Preview: a mail-client style head and the body.
  const m = b.model;
  const list = (l) => l.map((a) => (a.name ? `${a.name} <${S.mask ? maskEmail(a.address) : a.address}>` : S.mask ? maskEmail(a.address) : a.address)).join(', ');
  const row = (k, v) => (v ? h('div', { class: 'mc-pv-row' }, h('span', { class: 'mc-pv-k' }, t(k)), h('span', { class: 'mc-pv-v', dir: 'auto' }, v)) : null);
  box.append(h('div', { class: 'mc-pv-head' },
    h('div', { class: 'mc-pv-subject', dir: 'auto' }, b.subject || t('mc.i.noSubject')),
    row('mc.f.from', list(m.from)), row('mc.f.to', list(m.to)), row('mc.f.cc', list(m.cc)), row('mc.f.bcc', list(m.bcc)), row('mc.f.replyTo', list(m.replyTo)),
    m.priority === 'high' ? h('div', { class: 'mc-chip mc-chip-hi' }, t('mc.o.high')) : null));
  if (b.body) {
    // Inline images are resolved in the preview from the files by Content-ID.
    const pv = previewDoc(b.html, FILES.filter((f) => f.cid).map((f) => ({ cid: f.cid, contentType: f.type, data: f.data })));
    box.append(previewFrame(pv.doc, t('mc.tab.preview')));
  } else box.append(h('pre', { class: 'ap-pre mc-textbody', dir: 'auto' }, b.text));
  const att = m.attachments.filter((a) => !a.inline);
  if (att.length) box.append(h('div', { class: 'mc-pv-atts' }, att.map((a) => h('span', { class: 'mc-chip' }, iconEl('clip'), a.filename))));
}

function paintExport() {
  const ok = !!R.built && !R.built.addr.issues.some((i) => i.level === 'error');
  els.dl.classList.toggle('ed-primary', !S.merge.on);
  els.mailto.disabled = !R.mailto.ok;
  const note = els.mailtoNote;
  note.textContent = '';
  const keys = R.mailto.ok ? R.mailto.notes : R.mailto.reasons;
  if (keys.length) note.textContent = (R.mailto.ok ? t('mc.mt.notes') : t('mc.mt.no')) + ' ' + keys.map((k) => t('mc.mt.' + k)).join(' ');
  note.classList.toggle('mc-bad', !R.mailto.ok);
  els.dl.title = ok ? '' : t('mc.x.withIssues');
  if (S.merge.on) {
    const { rows } = mergeData();
    els.zip.lastChild.textContent = t('mc.x.zipN', { n: rows.length });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Start: the saved files, a draft handed over by the inspector (#from=inspect)

async function start() {
  const saved = await idbGet('files');
  // IndexedDB returns structured clones; entries are type-checked before use.
  if (Array.isArray(saved)) FILES = saved.filter((f) => f && f.data instanceof Uint8Array && typeof f.name === 'string');
  if (/from=inspect/.test(location.hash)) {
    // The hand-over is consumed once: the hash is removed so a reload does not re-import it.
    history.replaceState(null, '', location.pathname + location.search);
    const hand = await idbGet('handoff');
    if (hand && hand.state) {
      S = { ...structuredClone(DEF), ...hand.state, from: hand.state.from || S.from, merge: { ...S.merge, on: false } };
      FILES = (hand.files || []).map((f) => ({ id: uid('f'), name: f.name, type: f.type || contentTypeOf(f.name), data: f.data, inline: !!f.inline, cid: f.cid || '' }));
      await idbDel('handoff');
      save(); saveFiles();
      setTimeout(() => toast(t('mc.fromInspect'), 'ok'), 300);
    }
  }
  render();
}

startShell('compose', () => render());
start();
