// readme-editor/dialogs.js - the editor's dialogs: link (with the heading anchors of the document), block source with
// a live preview (templates for diagrams and formulas), inline formula, new table (size grid, Markdown / HTML, pasted
// CSV / TSV), image (URL or path, a picked file embedded as data: URI, saved into the project folder or kept as a
// path, alt, title, size, alignment, link, Markdown / HTML) and keyboard shortcuts. Each returns a Promise of the
// result (null when cancelled); the caller writes it into the document.
//
// Contract: every dialog is `async (initial) => result | null`. Dialogs never touch S.text; the caller decides
// where the result goes (replaceRange for an edited block, insertBlock / putInline for new content). That keeps
// dialogs reusable from three entry points (toolbar, preview click, drag & drop) and keeps undo in one place.
// Markdown is always generated, never assembled by the caller: buildMedia / tableText own escaping rules.

import { h, esc, debounce } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { seg, select, button } from '../ui/app.js';
import { openDialog, toast } from '../ui/overlays.js';
import { pickFiles } from '../ui/files.js';
import { tableMarkdown } from '../markdown/write.js';
import { S, renderMarkdown, mathHTML } from './doc.js';
import { DIAGRAMS, MATH_SNIPPETS } from './insert.js';
import { F, readDataURL, rememberImage, saveIntoFolder, localURL, isRelative } from './files.js';
import { paintInto } from './preview.js';

// <label> wrapping control + caption: accessible name without ids, and a click on the caption focuses the field.
const lbl = (key, control, hint) => h('label', { class: 'ed-field ed-field-col re-f' }, h('span', { class: 'ed-label' }, t(key)), control, hint ? h('span', { class: 'ed-hint' }, hint) : null);
const input = (value = '', attrs = {}) => h('input', { class: 'ed-input', value, spellcheck: 'false', ...attrs });
const okCancel = (ok = t('dlg.ok')) => [{ label: t('dlg.cancel'), value: null }, { label: ok, value: 'ok', primary: true }];

// --- link -----------------------------------------------------------------------------------
export async function linkDialog(text = '', url = '') {
  // The URL field suggests the document's own heading anchors through a <datalist>: links to sections are the most
  // error-prone (slugs are not obvious) and are exactly what the outline lint flags when broken.
  const ti = input(text), ui = input(url, { list: 're-anchors', placeholder: 'https://… #…' });
  const dl = h('datalist', { id: 're-anchors' }, S.headings.map((x) => h('option', { value: '#' + x.slug }, x.text)));
  const v = await openDialog({ title: t('dlg.link'), body: h('div', { class: 're-form' }, lbl('dlg.linkText', ti), lbl('dlg.linkUrl', ui, t('dlg.linkHint')), dl), buttons: okCancel() });
  return v === 'ok' && ui.value.trim() ? { text: ti.value, url: ui.value.trim() } : null;
}

// --- block source -----------------------------------------------------------------------------
export async function sourceDialog(text, { title, kind } = {}) {
  // Text set both as child and as .value: a textarea's .value is what matters after creation; the child only
  // seeds defaultValue, so the explicit assignment is the authoritative one.
  const ta = h('textarea', { class: 'ed-input ed-textarea re-mono re-src-ta', spellcheck: 'false' }, text);
  ta.value = text;
  const prev = h('div', { class: 'md-body re-src-prev' });
  // Live preview debounced (180 ms): Mermaid/TeX rendering of a large block is too slow to run on every keystroke.
  // onMount uses setTimeout so the first paint happens after the dialog is in the DOM and has its size.
  const upd = () => paintInto(prev, renderMarkdown(ta.value).html);
  ta.addEventListener('input', debounce(upd, 180));
  const tools = h('div', { class: 're-chips' });
  const insertAt = (s) => { ta.setRangeText(s, ta.selectionStart, ta.selectionEnd, 'end'); ta.focus(); upd(); };
  if (kind === 'diagram') for (const k of Object.keys(DIAGRAMS)) tools.append(h('button', { type: 'button', class: 'ed-chip', onclick: () => { ta.value = '```mermaid\n' + DIAGRAMS[k]() + '\n```'; upd(); } }, t('ins.mm-' + k)));
  if (kind === 'math') for (const [k, s] of MATH_SNIPPETS) tools.append(h('button', { type: 'button', class: 'ed-chip', onclick: () => insertAt(s) }, t('math.' + k)));
  const v = await openDialog({ title: title || t('dlg.source'), wide: true, className: 're-dlg-src', body: h('div', {}, h('div', { class: 're-split2' }, ta, prev), tools.children.length ? tools : null), buttons: okCancel(t('dlg.done')), onMount: () => setTimeout(upd) });
  return v === 'ok' ? ta.value : null;
}

// --- inline formula ----------------------------------------------------------------------------
export async function mathDialog(tex) {
  const ta = h('textarea', { class: 'ed-input ed-textarea re-mono', rows: 4, spellcheck: 'false' });
  ta.value = tex;
  const prev = h('div', { class: 'md-body re-math-prev' });
  const err = h('div', { class: 'ed-hint ed-hint-warn' });
  // Display-mode rendering for the preview even for inline formulas: larger and easier to check while editing.
  // mathml comes from math/tex.js (generated markup, not user HTML), hence innerHTML is acceptable here.
  const upd = () => { const m = mathHTML(ta.value, true); prev.innerHTML = m.mathml; err.textContent = m.error || ''; };
  ta.addEventListener('input', upd);
  const chips = h('div', { class: 're-chips' }, MATH_SNIPPETS.map(([k, s]) => h('button', { type: 'button', class: 'ed-chip', onclick: () => { ta.setRangeText(s, ta.selectionStart, ta.selectionEnd, 'end'); ta.focus(); upd(); } }, t('math.' + k))));
  const v = await openDialog({ title: t('dlg.math'), body: h('div', { class: 're-form' }, lbl('dlg.tex', ta), prev, err, chips), buttons: okCancel(), onMount: upd });
  return v === 'ok' ? ta.value.trim() : null;
}

// --- new table -------------------------------------------------------------------------------------
// Minimal RFC 4180-style parser for pasted spreadsheet data. Separator detection: any tab means TSV (what Excel and
// Google Sheets put on the clipboard); otherwise ';' if it outnumbers ',' on the first line (European CSV, where
// ',' is the decimal mark), else ','. Quotes: a field starting with '"' is quoted until the closing quote; '""'
// inside is a literal quote. Newlines inside quotes are kept, so multi-line cells survive.
export function parseDelimited(text) {
  const s = text.replace(/\r\n?/g, '\n').trim();
  if (!s) return null;
  const sep = s.includes('\t') ? '\t' : (s.split('\n')[0].match(/;/g) || []).length > (s.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; continue; }
    if (c === '"' && !cur) q = true;
    else if (c === sep) { row.push(cur.trim()); cur = ''; }
    else if (c === '\n') { row.push(cur.trim()); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  row.push(cur.trim());
  rows.push(row);
  return rows;
}
// Markdown via markdown/write.js (padded columns for readable source); HTML as an indented <table>.
// Cell text is inserted raw: in a README, cells legitimately contain inline Markdown/HTML, and the rendered preview
// is sanitised by markdown/gfm.js anyway.
export function tableText(rows, align, fmt) {
  const n = Math.max(...rows.map((r) => r.length));
  if (fmt === 'md') return tableMarkdown(rows[0], rows.slice(1), align, { pad: true });
  const at = (k) => (align[k] ? ` align="${align[k]}"` : '');
  const row = (r, tag) => '    <tr>\n' + Array.from({ length: n }, (_, k) => `      <${tag}${at(k)}>${r[k] ?? ''}</${tag}>`).join('\n') + '\n    </tr>';
  return `<table>\n  <thead>\n${row(rows[0], 'th')}\n  </thead>\n  <tbody>\n${rows.slice(1).map((r) => row(r, 'td')).join('\n')}\n  </tbody>\n</table>`;
}
export async function tableDialog(fmt0 = 'md') {
  let R = 3, C = 3, fmt = fmt0;
  const size = h('div', { class: 'ed-hint' });
  const grid = h('div', { class: 're-tgrid' });
  // 8 x 10 size grid: hover previews the size, click picks it and closes the dialog at once (one-click insert, like
  // word processors). close is captured from onMount because openDialog only exposes it there.
  const paint = (r, c) => { for (const x of grid.children) x.classList.toggle('re-on', +x.dataset.r <= r && +x.dataset.c <= c); size.textContent = t('dlg.tableSize', { c, r }); };
  for (let r = 1; r <= 8; r++) for (let c = 1; c <= 10; c++) grid.append(h('button', { type: 'button', dataset: { r, c }, 'aria-label': `${c} × ${r}` }));
  grid.addEventListener('mouseover', (e) => { const d = e.target.dataset; if (d.r) paint(+d.r, +d.c); });
  grid.addEventListener('mouseleave', () => paint(R, C));
  const csv = h('textarea', { class: 'ed-input ed-textarea re-mono', rows: 3, placeholder: 'Name,Age\nAnna,30' });
  let close;
  grid.addEventListener('click', (e) => { const d = e.target.dataset; if (d.r) { R = +d.r; C = +d.c; paint(R, C); close('ok'); } });
  const v = await openDialog({
    title: t('dlg.table'), body: h('div', { class: 're-form' }, grid, size, lbl('dlg.format', seg([{ v: 'md', l: '=Markdown' }, { v: 'html', l: '=HTML' }], fmt, (x) => { fmt = x; })), lbl('dlg.csv', csv)),
    buttons: okCancel(t('dlg.insert')), onMount: ({ close: c }) => { close = c; paint(R, C); },
  });
  if (v !== 'ok') return null;
  // Pasted CSV wins over the grid size. Without it: a header row of "Column n" plus empty rows (at least one body row,
  // since a Markdown table with only a header is easy to miss). Ragged rows are padded to the widest row.
  const rows = parseDelimited(csv.value) || Array.from({ length: Math.max(2, R) }, (_, r) => Array.from({ length: C }, (_, c) => (r ? '' : t('tbl.column', { n: c + 1 }))));
  const n = Math.max(...rows.map((r) => r.length));
  for (const r of rows) while (r.length < n) r.push('');
  return tableText(rows, Array(n).fill(null), fmt);
}

// --- media (images and badges in Markdown or HTML) -----------------------------------------------------
// Parses one image/badge snippet back into fields. HTML goes through an inert <template> (no requests, no scripts
// run) and attributes are read from the first <a> and <img>. Markdown: optional link wrapper [![alt](src "title")](href);
// the alt group allows escaped characters (\]), the src may be wrapped in <...> per CommonMark.
export function parseMedia(raw) {
  raw = raw.trim();
  const r = { fmt: 'md', src: '', alt: '', title: '', link: '', width: '', height: '', align: '', center: false };
  if (raw.startsWith('<')) {
    r.fmt = 'html';
    const tp = document.createElement('template');
    tp.innerHTML = raw;
    const a = tp.content.querySelector('a'), im = tp.content.querySelector('img');
    if (a) r.link = a.getAttribute('href') || '';
    if (im) for (const k of ['src', 'alt', 'title', 'width', 'height', 'align']) r[k] = im.getAttribute(k) || '';
    return r;
  }
  const m = /^(\[)?!\[((?:[^\]\\]|\\.)*)\]\(\s*<?([^)\s>]*)>?(?:\s+"([^"]*)")?\s*\)(?:\]\(\s*([^)\s]*)\s*\))?$/.exec(raw);
  if (m) { r.alt = m[2].replace(/\\(.)/g, '$1'); r.src = m[3]; r.title = m[4] || ''; r.link = m[5] || ''; }
  return r;
}
const attrEsc = (s) => esc(s);
// Markdown is preferred (it survives every renderer); HTML is forced only by what Markdown cannot express: size and
// left/right alignment. Spaces in src become %20 because a raw space ends the URL in Markdown. Centring needs an
// HTML <p align="center"> wrapper (GitHub drops CSS), so even a Markdown image is emitted as <img> inside it:
// Markdown is not parsed inside an HTML block that starts on the same line.
export function buildMedia(o) {
  const html = o.fmt === 'html' || o.width || o.height || (o.align && o.align !== 'center');
  let out;
  if (!html) {
    const im = `![${o.alt.replace(/[[\]]/g, '\\$&')}](${o.src.replace(/ /g, '%20')}${o.title ? ` "${o.title.replace(/"/g, '\\"')}"` : ''})`;
    out = o.link ? `[${im}](${o.link})` : im;
  } else {
    let im = `<img src="${attrEsc(o.src)}" alt="${attrEsc(o.alt)}"`;
    if (o.title) im += ` title="${attrEsc(o.title)}"`;
    if (o.width) im += ` width="${attrEsc(o.width)}"`;
    if (o.height) im += ` height="${attrEsc(o.height)}"`;
    if (o.align && o.align !== 'center') im += ` align="${o.align}"`;
    im += '>';
    out = o.link ? `<a href="${attrEsc(o.link)}">${im}</a>` : im;
  }
  return o.align === 'center' ? `<p align="center">\n  ${o.fmt === 'md' && !html ? buildMedia({ ...o, fmt: 'html', align: '' }) : out}\n</p>` : out;
}
// What the dialog preview may load: relative paths via the project folder, remote URLs only with permission.
export async function previewSrc(src) {
  if (!src) return '';
  if (isRelative(src)) return (await localURL(src)) || '';
  if (/^https?:/i.test(src) && !S.remote) return '';
  return src;
}

export async function imageDialog(media, { file, existing = false } = {}) {
  const m = { fmt: 'md', src: '', alt: '', title: '', link: '', width: '', height: '', align: '', ...(media || {}) };
  let pending = null;
  const src = input(m.src, { placeholder: 'https://… ./docs/screenshot.png' });
  const alt = input(m.alt), title = input(m.title), link = input(m.link, { placeholder: 'https://…' });
  const w = input(m.width, { placeholder: 'auto', size: 6 }), hh = input(m.height, { placeholder: 'auto', size: 6 });
  const al = select([{ v: '', l: 'img.alignNone' }, { v: 'left', l: 'img.left' }, { v: 'right', l: 'img.right' }, { v: 'center', l: 'img.center' }], m.align, () => upd());
  let fmt = m.fmt;
  // Storage choice for a picked file: data: URI (self-contained, but GitHub does not render data: images in READMEs,
  // hence the lint hint), the project folder (written on Done), or just a path (user copies the file manually).
  const store = select([{ v: 'data', l: 'img.storeData' }, { v: 'folder', l: 'img.storeFolder' }, { v: 'path', l: 'img.storePath' }], F.dir ? 'folder' : 'data', () => { if (pending) take(pending); });
  store.querySelector('[value=folder]').disabled = !F.dir;
  const sub = input('images', { size: 8, title: t('img.subfolder') });
  const prev = h('img', { class: 're-img-prev', alt: '' });
  const note = h('div', { class: 'ed-hint' });
  const code = h('textarea', { class: 'ed-input ed-textarea re-mono', rows: 2, readonly: true });
  const collect = () => ({ fmt, src: src.value.trim(), alt: alt.value, title: title.value, link: link.value.trim(), width: w.value.trim(), height: hh.value.trim(), align: al.value });
  const upd = async () => {
    const o = collect();
    const c = buildMedia(o);
    // The code preview shortens a data: URI to 48 chars: a 300 KB base64 string in a textarea would freeze layout.
    code.value = o.src.startsWith('data:') ? c.replace(/data:[^"')]{60,}/, (x) => x.slice(0, 48) + '…') : c;
    const u = await previewSrc(o.src);
    if (u) { prev.src = u; prev.hidden = false; } else { prev.removeAttribute('src'); prev.hidden = true; }
    note.textContent = /^https?:/i.test(o.src) && !S.remote ? t('img.remoteNote') : o.src.startsWith('data:') ? t('lint.dataImage') : isRelative(o.src) && !u ? t('img.notFound') : '';
  };
  const take = async (f) => {
    // Clipboard images arrive as "image.png" with no useful name; they get a timestamped name instead. Spaces become
    // dashes because an unescaped space in a path breaks Markdown links.
    pending = f;
    const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    const name = (f.name && !/^image\.\w+$/.test(f.name) ? f.name : `image-${Date.now()}.${ext}`).replace(/\s+/g, '-');
    if (!alt.value) alt.value = name.replace(/\.\w+$/, '');
    if (store.value === 'data') {
      // 300 KB warning: a data: URI is about 4/3 of the file size and lives inside the README text.
      if (f.size > 300e3) toast(t('img.big', { kb: Math.round(f.size / 1024) }), 'warn');
      src.value = await readDataURL(f);
    } else {
      const d = sub.value.trim().replace(/^\.?\/|\/$/g, '');
      src.value = './' + (d ? d + '/' : '') + name;
      rememberImage(src.value, f);
    }
    upd();
  };
  const pick = button('img.pick', 'image', async () => { const [f] = await pickFiles({ accept: 'image/*' }); if (f) take(f); });
  for (const x of [src, alt, title, link, w, hh]) x.addEventListener('input', upd);
  const body = h('div', { class: 're-form' },
    lbl('img.src', src), h('div', { class: 're-row' }, pick, store, sub),
    h('div', { class: 're-grid2' }, lbl('img.alt', alt), lbl('img.title', title)),
    h('div', { class: 're-row' }, lbl('img.width', w), lbl('img.height', hh), lbl('img.align', al)),
    lbl('img.link', link), lbl('dlg.format', seg([{ v: 'md', l: '=Markdown' }, { v: 'html', l: '=HTML' }], fmt, (x) => { fmt = x; upd(); })),
    h('div', { class: 're-prevbox' }, prev, note), lbl('dlg.code', code));
  const buttons = [...(existing ? [{ label: t('dlg.delete'), value: 'delete', danger: true, className: 're-left' }] : []), ...okCancel(t('dlg.done'))];
  const v = await openDialog({ title: t('dlg.image'), body, buttons, onMount: () => { if (file) take(file); else upd(); } });
  if (v === 'delete') return { delete: true };
  if (v !== 'ok') return null;
  const o = collect();
  if (!o.src) { toast(t('img.needSrc'), 'warn'); return null; }
  // The folder write happens only on Done, not on pick: cancelling the dialog must leave the folder untouched.
  if (pending && store.value === 'folder' && F.dir && !o.src.startsWith('data:')) {
    try { await saveIntoFolder(o.src, pending); toast(t('img.savedTo', { path: o.src }), 'ok'); } catch (e) { toast(t('img.saveFail', { msg: e.message }), 'error'); }
  }
  return { code: buildMedia(o), block: o.align === 'center' };
}

// --- shortcuts --------------------------------------------------------------------------------------
export function helpDialog() {
  // Shortcut list mirrors main.js keydown handling; keep both in sync when adding a binding.
  const rows = [['Ctrl+S', 'help.save'], ['Ctrl+Shift+S', 'help.saveAs'], ['Ctrl+O', 'help.open'], ['Ctrl+Z / Ctrl+Y', 'help.undo'], ['Ctrl+B / Ctrl+I', 'help.bold'], ['Ctrl+K', 'help.link'],
    ['Ctrl+Enter', 'help.done'], ['Esc', 'help.cancel'], ['Tab', 'help.tab'], ['Enter', 'help.list'], ['Ctrl+Alt+1 / 2 / 3', 'help.views'], ['F1', 'help.help']];
  const tips = ['help.t1', 'help.t2', 'help.t3', 'help.t4', 'help.t5', 'help.t6', 'help.t7'];
  return openDialog({
    title: t('dlg.help'), wide: true,
    body: h('div', { class: 're-help' }, h('ul', {}, tips.map((k) => h('li', {}, t(k)))),
      h('table', { class: 'ap-table' }, h('tbody', {}, rows.map(([k, d]) => h('tr', {}, h('td', {}, h('kbd', { class: 'ed-kbd' }, k)), h('td', {}, t(d))))))),
    buttons: [{ label: t('dlg.gotIt'), value: null, primary: true }],
  });
}
